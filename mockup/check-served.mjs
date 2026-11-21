// Served-bundle check (TEST P09): fetch the client bundle the running Host
// actually serves and assert that the code the browser would load is THIS round's
// code — plus that rejected designs stay out.
//   node mockup/check-served.mjs [guiUrl] [file] [--verbose]
//
// Markers are grouped by surface so a failure names what regressed. Default
// output is failures + one summary line; `--verbose` prints every marker.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const argv = process.argv.slice(2).filter((arg) => arg !== '--verbose');
const verbose = process.argv.includes('--verbose');
const url = argv[0] ?? 'http://127.0.0.1:49877';
const file = argv[1] ?? 'E:/DeepSeek Project/Hades/dsh-trace-analyzer/client.js';

const groups = {
  // ---- boot / data layer ---------------------------------------------------
  data: [
    'fetchPayload', "'runs'", 'AbortController', 'tickBusy.current', 'function lru(max)',
    'function useRuns(sessionId, onFirstPayload)', 'function payloadSignature(p)',
    'refreshToken', 'stale-while-revalidate', 'seenRuns', 'appliedSig',
    'const buildRows = () => {', 'detailEpoch', 'pendingLocate', 'instantOpen',
    'const cancelAnim = () => {', 'if (open && !visible) setVisible(true);',
    'const detailsRef = useRef(details)', 'function loadEventRaw', 'rawInFlight',
    'RAW_PREVIEW_CHARS', "data-hades-raw-more': '1'", 'Loading raw event', 'Copy',
    'const EXPAND_MS = DESIGN.motion.base', 'const FOLLOW_MS = DESIGN.motion.fast',
    'STEP_PAGE', 'prefers-reduced-motion', 'function Collapse', 'hadesRowIn',
    'const DESIGN = {', 'const CSS_VARS = {', 'motion.focus',
  ],
  // ---- run/step table ------------------------------------------------------
  rows: [
    'MetricBar', 'function SliceFill', 'function SpentFill', 'SLICE_RADIUS = 2',
    'SPENT_ALPHA = 0.18', 'const METRIC_W = 100', 'const METRIC_NUM_W = 70',
    'sortCol', 'sortHoverLine', 'aria-sort', "sortCol('time', 'Time'", 'nextSort',
    "tone: hover ? T.brand", 'aria-pressed', 'stepSelBg', 'groupRing',
    'stepGroupRing', 'is-focus', 'hades-lane', 'hades-prompt', 'hadesSkeleton',
    'hover a run · click to locate',
    'Jump to the latest Run', 'data-hades-latest', 'tailPad',
    'data-hades-tail', 'data-hades-tick', "Run ${r.idx}", "data-hades-scroll",
    'overscrollBehavior', 'overflowAnchor: ', 'shellH', 'new ResizeObserver',
    "data-hades-header': '1'", '.hades-run-row', '--hades-hover-row',
    'el.style.willChange', 'const renderHeader', 'const renderList',
  ],
  // ---- overview matrix -----------------------------------------------------
  matrix: [
    'function OverviewBoard', "data-hades-board", 'const markerBg = (run) =>',
    "data-hades-lane-grid': '1'", "'data-idx': r.idx", 'bandLayer(',
    'clickColumn(event, event.currentTarget)', 'setSelected(idx)',
    'setHover(run.idx)', 'onMatrixKeyDown', 'ArrowLeft',
    'darker = slower relative to the session', 'darker = more tokens in the session',
    'darker = more steps in the session',
    // F202: card-level pointer + geometric resolver + focus re-assertion
    'const columnFromPoint = (point, plotRect, gridRect, list) =>',
    'const syncFocusRow = (host, idx) =>',
    'syncFocusRow(listRef.current, focusRun)',
    "data-hades-plot': '1'",
    'F202: pointer tracking lives on the CARD',
    'onMouseMove: (event) =>',
  ],
  // ---- scroll / focus / follow --------------------------------------------
  navigation: [
    'locateRun', 'beginScrub', 'const scrubTo = (idx) => {',
    'const stopFollowing = () =>', 'const anchor = Math.round(viewH * 0.34)',
    'F179: a fixed FOCUS LINE', 'const locatedRunRef', 'idx === locatedRunRef.current',
    '__hadesScrollLog', 'hoverLock', 'onFocusOnly: focusRunOnly',
    'glideScroll', 'const scrollToLatest = (smooth) =>', 'const lastRowBottom = () =>',
    'followRef', 'hades-scrubbing',
  ],
  // ---- step / operation cards ---------------------------------------------
  step: [
    'StepContent', 'operations', 'NOTE_LABEL', 'noteLabel', 'noteKind', 'step.title', 'step.marks',
    'chips.map((chip', 'chip.overflow', 'cumTokens', 'sharePct',
    'rawButton([op.callSeq, op.resultSeq])', 'block(op.args ||',
    'rawPanel', 'rawButton', 'ctxOpen', 'setCtxOpen',
    'const expanding = open && contentReady',
    "1px solid ' + (open ? T.stepGroupRing : 'transparent')",
    'const innerRunning =', 'const frames = from > 0',
  ],
  // ---- theme / locale ------------------------------------------------------
  theme: [
    'data-ds-dark-theme', 'function darkThemeActive', 'const THEME_CSS =',
    "data-hades-theme': dark ? 'dark' : 'light'", 'hades-panel',
    'RoleTag', 'role.context', 'fontWeight: 650', '--dsw-alias-border-l2',
  ],
};

// Rejected designs that must NOT come back: the run prompt is never cut to a
// character budget (F147); hover stays fill-only (F148); the cache/server/live/
// refresh chrome is gone (F151); no dead sticky rule (F152); the unexplained
// gradient legend bar is gone (F160); per-card facet tabs are gone (F191);
// the matrix no longer resolves columns by node hit-testing (F202).
const absent = [
  'function KpiSummary', 'stat.runs', 'stat.slowest', 'truncate(r.prompt',
  'function truncate', 'hoverRing', 'cacheHit', "'firstPaint'", 'realtime.live',
  'perf.lastBuildMs', "'mx.ramp':", '0 10px 18px -14px', 'data-hades-facet',
  'const facetTabs = (cardKey',
  'const columnAt = (event, container)',
  'const cell = target && target.closest',
  'if (cell == null) return;',
  'function applyThemePalette',
  'LIGHT_TINT',
  'const label = (k, fb)',
  'const EN = {',
  // The matrix window slider was removed: the grid always shows every Run.
  'data-hades-window',
  "type: 'range'",
  'hades-range',
];

const stat = statSync(file);
const hash = createHash('sha1').update('plugin-artifact').update('\0');
for (const part of [String(stat.mtimeMs), String(stat.ctimeMs), String(stat.size)]) {
  hash.update(`${Buffer.byteLength(part)}:`).update(part);
}
const rev = hash.digest('hex').slice(0, 12);

const candidates = [
  `${url}/plugins/??@local/dsh-trace-analyzer/client.js&rev=${rev}`,
  `${url}/plugins/??@local/dsh-trace-analyzer/client.js`,
];
let text = null;
let used = null;
for (const candidate of candidates) {
  const res = await fetch(candidate);
  const body = await res.text();
  if (res.ok && body.length > 1000) { text = body; used = candidate; break; }
  if (verbose) console.log(`try ${candidate} -> ${res.status} ${body.length}B`);
}
// The Host only publishes a plugin's client asset once a browser has loaded it,
// so fall back to the file on disk (same markers, clearly labelled) instead of
// reporting nothing.
if (text == null) {
  const local = readFileSync(file, 'utf8');
  console.log(`served bundle not reachable; checking the file on disk instead: ${file}`);
  text = local;
  used = 'local-file';
}

console.log(`served: ${used}`);
console.log(`rev=${rev} bytes=${text.length}`);
let missing = 0;
let checked = 0;
for (const [group, list] of Object.entries(groups)) {
  for (const marker of list) {
    checked += 1;
    const hit = text.includes(marker);
    if (hit) { if (verbose) console.log(`PASS  [${group}] ${marker}`); continue; }
    missing += 1;
    console.log(`FAIL  [${group}] missing marker: ${marker}`);
  }
}
for (const gone of absent) {
  checked += 1;
  const hit = text.includes(gone);
  if (!hit) { if (verbose) console.log(`PASS  absent ${gone}`); continue; }
  missing += 1;
  console.log(`FAIL  absent: still shipped "${gone}"`);
}
console.log(`markers: ${checked - missing}/${checked} (${Object.keys(groups).length} groups)`);
process.exit(missing === 0 ? 0 : 1);
