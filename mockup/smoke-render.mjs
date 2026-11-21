// F168 render smoke test: after loading the bundle with stubs, call the three
// components that changed most (OverviewBoard / DualBarChart) with
// synthetic data. Catches render-path errors a syntax check cannot see.
//   node mockup/smoke-render.mjs
import { readFileSync } from 'node:fs';

let source = readFileSync('E:/DeepSeek Project/Hades/dsh-trace-analyzer/client.js', 'utf8');
// Harness-only transform: expose the internal components (keep the declarations
// intact so their intra-closure references still resolve).
const anchor = "    return {\n      inject: ['slots', 'locale'],";
if (!source.includes(anchor)) throw new Error('factory return anchor not found');
source = source.replace(anchor, `    globalThis.__internals = { OverviewBoard, DualBarChart, StepRow, Collapse, StepContent, EventDetail, cache };\n${anchor}`);

const captured = { spec: null };
const fakeDocument = {
  body: { hasAttribute: () => false, style: {}, appendChild() {} },
  documentElement: { hasAttribute: () => false, style: {} },
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null, visibilityState: 'visible',
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
};
const fakeWindow = {
  __ModuleLoader__: { load(spec) { captured.spec = spec; return spec.id; } },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  innerHeight: 800, addEventListener() {}, removeEventListener() {},
  setTimeout: (fn) => setTimeout(fn, 0), clearTimeout,
  requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 0),
  cancelAnimationFrame: clearTimeout, devicePixelRatio: 1,
};
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useRef: (init) => ({ current: init }),
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useLayoutEffect: () => {},
  Fragment: 'fragment',
};
new Function('window', 'document', 'navigator', source)(
  fakeWindow,
  fakeDocument,
  { clipboard: { writeText: async () => {} } },
);
captured.spec.factory((id) => {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
});

const label = (k, fb) => fb;
const rows = Array.from({ length: 12 }, (_, i) => ({
  idx: 100 + i,
  time: 1000 + i * 1500,
  token: 1200 + i * 9000,
  stepCount: 3 + (i % 5),
  prompt: 'prompt ' + i,
  actor: i % 3 === 0 ? 'user' : 'assistant',
  hasError: i === 3,
  hasSlow: i === 7,
  isSystemPrompt: i === 0,
}));

const count = (node) => {
  if (node == null || typeof node !== 'object') return 1;
  if (Array.isArray(node)) return node.reduce((n, child) => n + count(child), 0);
  return 1 + (node.children ?? []).reduce((n, child) => n + count(child), 0);
};
const walk = (node, fn) => {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((c) => walk(c, fn)); return; }
  // F189: expand function components too — their markup (the Step card's tab bar
  // lives inside ViewTabs) is part of what the panel renders.
  if (typeof node.type === 'function') {
    try {
      walk(node.type(node.props ?? {}), fn);
      return;
    } catch { /* component needs more context than the harness has */ }
  }
  fn(node);
  (node.children ?? []).forEach((c) => walk(c, fn));
};

const matrixTree = globalThis.__internals.OverviewBoard({
  rows, label, onLocate: () => {}, onScrub: () => {}, onFocusOnly: () => {},
  followLatest: false, baseRun: () => null,
});
const listTree = globalThis.__internals.DualBarChart({
  rows, sort: null, onSort: () => {}, sysLabel: 'System prompt', expanded: new Set(),
  onToggleRun: () => {}, renderDetail: () => null, hasDetail: () => false,
  label, detailEpoch: {}, instantRef: { current: new Set() }, focusRun: null,
});

let lanes = 0;
let promptFades = 0;
let tickSpans = 0;
let laneGrids = 0;
let rowGrids = 0;
let handCursors = 0;
for (const tree of [matrixTree, listTree]) {
  walk(tree, (node) => {
    const cls = node.props?.className;
    if (typeof cls === 'string') {
      if (cls.includes('hades-lane')) lanes += 1;
      if (cls.includes('hades-prompt')) promptFades += 1;
    }
    if (node.props?.['data-hades-tick'] != null) tickSpans += 1;
    // F185: the click surface is the lane/row container, and it shows the hand.
    if (node.props?.['data-hades-lane-grid'] != null) laneGrids += 1;
    if (node.props?.['data-hades-row-grid'] != null) rowGrids += 1;
    if (node.props?.style?.cursor === 'pointer') handCursors += 1;
  });
}

console.log('OverviewBoard nodes:', count(matrixTree));
console.log('DualBarChart nodes:', count(listTree));
console.log('marker lanes:', lanes, '路 prompt fades:', promptFades, '路 tick spans:', tickSpans);
console.log('lane grids:', laneGrids, '路 row grids:', rowGrids, '路 hand cursors:', handCursors);
if (lanes !== 1) throw new Error('expected exactly one marker lane');
if (laneGrids !== 1) throw new Error('the marker lane must own one click container');
if (rowGrids !== 3) throw new Error('each metric row must own one click container');
if (handCursors < 4) throw new Error('the matrix plot area must show the hand cursor');
if (promptFades !== rows.length) throw new Error('every run row must carry the prompt fade class');
// F202/F203: pointer tracking belongs to the whole matrix BLOCK (card + the 12px
// gap under it) — one handler, high in the tree. The ~52px plot strip must own
// none: a 3px drift off it used to clear the hover.
{
  const matrixNodes = [];
  walk(matrixTree, (node) => matrixNodes.push(node));
  let cards = 0;
  let plots = 0;
  let moveHandlers = 0;
  let blockOwns = false;
  for (const node of matrixNodes) {
    if (node.props?.className === 'hades-matrix') {
      cards += 1;
      if (node.props.onMouseMove != null) throw new Error('the matrix card must not own a second pointer handler');
    }
    if (node.props?.['data-hades-plot'] != null) {
      plots += 1;
      if (node.props.onMouseLeave != null) throw new Error('the plot strip must not clear the hover on leave');
      if (node.props.onMouseMove != null) throw new Error('the plot strip must not own the pointer handler');
    }
    if (typeof node.props?.onMouseMove === 'function') {
      moveHandlers += 1;
      if (node.props.style?.marginBottom === 12 && node.props.onMouseLeave != null) blockOwns = true;
    }
  }
  console.log('matrix cards:', cards, '· plot surfaces:', plots, '· pointer handlers:', moveHandlers);
  if (cards !== 1) throw new Error('expected exactly one matrix card');
  if (plots !== 1) throw new Error('expected exactly one plot surface');
  if (moveHandlers !== 1) throw new Error('expected exactly one pointer handler on the matrix block');
  if (!blockOwns) throw new Error('the pointer handler must sit on the matrix block wrapper');
}
// F186: the Step bracket must reserve its border widths and margins in BOTH
// states, otherwise opening a step shifts the row by ~7px before the height
// animation starts ("the box moves up, then expands down").
const stepBase = {
  step: { idx: 0, title: 'pwsh', timeMs: 1200, token: 900 },
  selected: false, onSelect: () => {}, idxWidth: 60,
  timeMetric: { pct: 30, text: '1.2s' }, tokenMetric: { pct: 20, text: '900' },
  text: 'pwsh -Command ls', title: 'pwsh', tag: 'tool', tags: [], marks: [], waitMs: null,
  hasError: false, content: null, contentReady: true,
};
const closedTree = globalThis.__internals.StepRow({ ...stepBase, open: false });
const openTree = globalThis.__internals.StepRow({ ...stepBase, open: true });
const boxOf = (tree) => tree.props.style;
const closed = boxOf(closedTree);
const openBox = boxOf(openTree);
const geometry = (box) => {
  const width = (v) => String(v ?? '').split(' ')[0];
  return {
    top: width(box.borderTop), right: width(box.borderRight),
    bottom: width(box.borderBottom), left: width(box.borderLeft),
    margin: box.margin, paddingTop: width(box.padding),
  };
};
const closedGeo = geometry(closed);
const openGeo = geometry(openBox);
console.log('step closed box:', closedGeo);
console.log('step open box  :', openGeo);
const sameGeo = JSON.stringify(closedGeo) === JSON.stringify(openGeo);
if (!sameGeo) throw new Error('opening a Step must not change its box geometry');
// F192: args and result are expanded inside the tool card; raw is a collapsed
// disclosure (caret + "raw") in every operation card.
const stepData = {
  idx: 3, step: 0, startTime: 1000, endTime: 2600, timeMs: 1600,
  modelMs: 600, toolMs: 800, waitMs: 200,
  model: { provider: 'deepseek', model: 'deepseek-chat' },
  usage: { input: 1200, output: 300, cacheRead: 100, reasoning: 0 },
  counts: { models: 1, tools: 1, contexts: 0 },
  operations: [
    { kind: 'assistant', seq: 11, time: 1000, text: 'plan the next step', usage: { input: 1200, output: 300 } },
    { kind: 'tool', seq: 12, callSeq: 12, resultSeq: 13, name: 'pwsh', args: '{"command":"ls"}', result: 'file-a', durationMs: 800, startTime: 1100, endTime: 1900 },
    { kind: 'context', seq: 14, time: 2100, text: 'injected reminder' },
  ],
  slowMs: 5000,
};
globalThis.__internals.cache.step.set('s::3::0', stepData);
const stepTree = globalThis.__internals.StepContent({
  sessionId: 's', runIdx: 3, stepIdx: 0, runPrompt: 'hello', runActor: 'user',
  t: null, refreshToken: 0,
});
const nodes = [];
walk(stepTree, (node) => nodes.push(node));
const textOf = (node) => (typeof node === 'string' ? node : (node?.children ?? []).map(textOf).join(' '));
const stepText = nodes.map(textOf).join(' ');
let rawToggles = 0;
const rawLabels = [];
let facetProps = 0;
for (const node of nodes) {
  if (node.props?.['data-hades-facet'] != null) facetProps += 1;
  if (node.type !== 'button' || typeof node.props?.onClick !== 'function') continue;
  const labelText = textOf(node).trim();
  if (/raw/i.test(labelText) && (labelText.includes('▸') || labelText.includes('▾'))) {
    rawToggles += 1;
    rawLabels.push(labelText);
  }
}
console.log('step raw toggles:', rawToggles, '· labels:', rawLabels.join(' | '), '· facet props:', facetProps);
if (!stepText.includes('plan the next step')) throw new Error('the assistant card must show the reply');
if (!stepText.includes('{"command":"ls"}')) throw new Error('the tool card must show the arguments expanded');
if (!stepText.includes('file-a')) throw new Error('the tool card must show the result expanded');
if (stepText.includes('TOOL')) throw new Error('the step panel must not label a tool as "TOOL"');
if (stepText.includes('model call')) throw new Error('the reply chip already says REPLY — drop the duplicate label');
if (stepText.includes('chars')) throw new Error('the instruction card must not print a character count');
if (rawToggles < 2) throw new Error('each operation card must carry a raw disclosure toggle');
let stripNodes = 0;
for (const node of nodes) if (node.props?.key === 'strip') stripNodes += 1;
console.log('step strip nodes:', stripNodes);
if (stripNodes !== 0) throw new Error('the Step summary strip must be gone');
if (/tools \d/.test(stepText)) throw new Error('the step panel must not print a tools count');
// F196: reading order is header (chip + numbers) → RAW (left) → ARGS/RESULT.
const iTokens = stepText.indexOf('in 1.2k');
const iRaw = stepText.indexOf('RAW');
const iArgs = stepText.indexOf('args');
const iResult = stepText.indexOf('result');
console.log('order: tokens', iTokens, '· raw', iRaw, '· args', iArgs, '· result', iResult);
if (iTokens < 0) throw new Error('the reply card must show the in/out numbers');
if (!(iTokens < iRaw)) throw new Error('the numbers must sit before the raw disclosure');
if (!(iRaw < iArgs)) throw new Error('raw must come before the args block');
if (!(iArgs < iResult)) throw new Error('args must come before result');
// F197: every card ends with its raw disclosure — the tool card's after RESULT,
// the CTX card's after its injection content.
const iRawLast = stepText.lastIndexOf('RAW');
if (!(iRawLast > iResult)) throw new Error('the tool card raw must sit below result');
const iInjected = stepText.indexOf('injected');
if (iInjected < 0) throw new Error('the context card must render');
const iCtxRaw = stepText.indexOf('RAW', iInjected);
if (iCtxRaw < 0 || !(iCtxRaw > iInjected)) throw new Error('the context raw must sit below the injected line');
if (rawToggles !== 3) throw new Error('expected three raw disclosures (reply, tool, context), got ' + rawToggles);
// F198: chips are uppercase too — the tool chip computes it in CSS.
let chipChecked = 0;
for (const node of nodes) {
  const text = textOf(node).trim();
  if (text !== 'pwsh') continue;
  if (node.props?.style?.textTransform !== 'uppercase') {
    throw new Error('the tool chip must be uppercase: ' + JSON.stringify(node.props?.style));
  }
  chipChecked += 1;
}
if (chipChecked !== 1) throw new Error('expected exactly one tool chip, got ' + chipChecked);
// F194: labels are uppercase throughout the card.
for (const rawLabel of rawLabels) {
  if (rawLabel !== rawLabel.toUpperCase()) throw new Error('the raw label must be uppercase: ' + rawLabel);
}
if (facetProps !== 0) throw new Error('the per-card facet tabs must be gone');
// F199: both metric tracks are a third shorter (100px), header and rows alike.
const listNodes = [];
walk(listTree, (node) => listNodes.push(node));
let tracks100 = 0;
let tracks150 = 0;
let headerCols = 0;
for (const node of listNodes) {
  const flex = node.props?.style?.flex;
  if (typeof flex !== 'string') continue;
  if (flex.includes('0 0 100px')) tracks100 += 1;
  if (flex.includes('0 0 150px')) tracks150 += 1;
  if (flex.includes('0 0 176px')) headerCols += 1;
}
console.log('tracks 100px:', tracks100, '· 150px:', tracks150, '· header cols 176px:', headerCols);
if (tracks150 !== 0) throw new Error('no metric track may still be 150px');
if (tracks100 < 2) throw new Error('the time and token tracks must be 100px');
if (headerCols < 2) throw new Error('the header slots must follow the 100px track');
// F200: the run ordinal must not be tinted by status (red "Run 3" is gone).
const listNodes2 = [];
walk(listTree, (node) => listNodes2.push(node));
const ordinalNodes = listNodes2.filter((node) => typeof node.props?.className === 'string' && node.props.className.includes('hades-idx'));
const tintedOrdinals = ordinalNodes.filter((node) => node.props?.style?.color != null).length;
console.log('run ordinal cells:', ordinalNodes.length, '· tinted:', tintedOrdinals);
if (ordinalNodes.length === 0) throw new Error('the run rows must carry an ordinal cell');
if (tintedOrdinals !== 0) throw new Error('the run ordinal must not be tinted by status');
// F201: a 60k-char payload must render a bounded preview + a "show all" affordance.
const bigText = 'x'.repeat(60000);
globalThis.__internals.cache.event.set('s::900,901', { value: { a: 1 }, text: bigText });
const rawTree = globalThis.__internals.EventDetail({ sessionId: 's', seqs: [900, 901] });
const rawNodes = [];
walk(rawTree, (node) => rawNodes.push(node));
const preNode = rawNodes.find((node) => node.type === 'pre');
if (preNode == null) throw new Error('the raw panel must render a pre block');
const preText = rawNodes.filter((node) => node.type === 'pre').map((node) => (node.children ?? []).join('')).join('');
let moreButton = null;
for (const node of rawNodes) {
  if (node.type === 'button' && node.props?.['data-hades-raw-more'] != null) moreButton = node;
}
console.log('raw preview chars:', preText.length, '· show-all button:', moreButton != null);
if (preText.length > 20000) throw new Error('the raw preview must be capped at 20000 chars, got ' + preText.length);
if (moreButton == null) throw new Error('a truncated payload must offer "show all"');
const cachedEntry = globalThis.__internals.cache.event.get('s::900,901');
if (typeof cachedEntry?.text !== 'string') throw new Error('the cache must keep the pretty-printed text with the value');
console.log('OK: render paths execute and carry the F168 hooks');
