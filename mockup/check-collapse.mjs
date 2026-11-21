// F188: run the REAL Collapse effect bodies (extracted from client.js) against a
// fake element, and assert the two jump-preventing rules:
//   1. while a descendant height animation is running, the outer panel must NOT
//      start its own height animation (out-of-order Step opening);
//   2. a re-run on an already-open panel must grow FROM the current height, never
//      from 0 (no collapse-then-grow).
//   node mockup/check-collapse.mjs
import { readFileSync } from 'node:fs';

const sourcePath = process.argv[2] ?? 'E:/DeepSeek Project/Hades/dsh-trace-analyzer/client.js';
const source = readFileSync(sourcePath, 'utf8');

function extractEffect(afterMarker, depsMarker) {
  const start = source.indexOf(afterMarker);
  if (start < 0) throw new Error(`missing marker: ${afterMarker}`);
  const open = source.indexOf('useLayoutEffect(() => {', start);
  if (open < 0) throw new Error('effect start not found');
  const bodyStart = source.indexOf('{', open);
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error('unbalanced effect');
  const body = source.slice(bodyStart + 1, end);
  if (!source.slice(end, end + 200).includes(depsMarker)) throw new Error(`deps ${depsMarker} not found`);
  return body;
}

const openBody = extractEffect('const cancelAnim = () => {', '[open, expandMs, collapseMs]');
const followBody = extractEffect('F144/F163: the step/run detail arrives asynchronously', '[children, open, visible, expandMs]');

// The effect body starts with `const el = ref.current;` — in the harness the
// element is injected, so resolve `ref.current` to the fake element.
const makeEffect = (body) => new Function('ctx', `with (ctx) { ${body.replace(/const el = ref\.current;/, 'const el = ctx.el;')} }`);

// ---------------------------------------------------------------- fakes ----
const DUR = { EXPAND_MS: 300, COLLAPSE_MS: 120, FOLLOW_MS: 120 };

function fakeAnimation(frames, opts, el) {
  const heights = (frames || []).map((f) => f.height);
  return {
    playState: 'running',
    frames,
    duration: opts && opts.duration,
    effect: { getKeyframes: () => frames || [] },
    cancel() { this.playState = 'idle'; },
    finish() { this.playState = 'finished'; if (this.onfinish) this.onfinish(); },
  };
}

function makeEl(contentHeight) {
  const el = {
    scrollHeight: contentHeight,
    style: {},
    animations: [],
    animate(frames, opts) {
      const anim = fakeAnimation(frames, opts, el);
      el.animations.push(anim);
      return anim;
    },
    getAnimations({ subtree } = {}) {
      return subtree ? el.animations.concat(el.childAnimations) : el.animations;
    },
    childAnimations: [],
  };
  return el;
}

const motions = { reduced: false };
const motionReduced = () => motions.reduced;

function runOpen(el, { open, expandMs, animRef, heightRef, visible, setVisible }) {
  const cancelAnim = () => { if (animRef.current != null) { animRef.current.cancel(); animRef.current = null; } };
  const fn = makeEffect(openBody);
  return fn({
    el, open, expandMs, collapseMs: DUR.COLLAPSE_MS, animRef, heightRef, visible, setVisible,
    motionReduced, EXPAND_MS: DUR.EXPAND_MS, COLLAPSE_MS: DUR.COLLAPSE_MS, FOLLOW_MS: DUR.FOLLOW_MS,
    cancelAnim,
  });
}

function runFollow(el, { children, open, expandMs, animRef, heightRef, visible }) {
  const fn = makeEffect(followBody);
  return fn({
    el, children, open, visible, expandMs, animRef, heightRef,
    motionReduced, FOLLOW_MS: DUR.FOLLOW_MS, EXPAND_MS: DUR.EXPAND_MS, COLLAPSE_MS: DUR.COLLAPSE_MS,
  });
}

const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); };

// ---- scenario 1: a descendant height animation is running ---------------
{
  const el = makeEl(400);
  const animRef = { current: null };
  const heightRef = { current: 200 };
  const childAnim = fakeAnimation([{ height: '0px' }, { height: '180px' }], { duration: 300 });
  el.childAnimations.push(childAnim);

  const before = el.animations.length;
  runFollow(el, { children: ['a'], open: true, expandMs: DUR.EXPAND_MS, animRef, heightRef, visible: true });
  check(el.animations.length === before, 'outer panel animated while a descendant height animation was running');
  check(heightRef.current === 400, 'the height baseline must be refreshed even when the follow-up is skipped');
}

// ---- scenario 2: no inner animation → async arrival still animates ------
{
  const el = makeEl(400);
  const animRef = { current: null };
  const heightRef = { current: 200 };
  const before = el.animations.length;
  runFollow(el, { children: ['a'], open: true, expandMs: DUR.EXPAND_MS, animRef, heightRef, visible: true });
  check(el.animations.length === before + 1, 'async content growth must still animate');
  const frames = el.animations[el.animations.length - 1].frames;
  check(frames[0].height === '200px' && frames[1].height === '400px', `follow-up must animate 200→400, got ${JSON.stringify(frames)}`);
}

// ---- scenario 3: re-run on an already-open panel grows from current -----
{
  const el = makeEl(520);
  const animRef = { current: null };
  const heightRef = { current: 300 };
  const visible = { value: true };
  runOpen(el, { open: true, expandMs: DUR.EXPAND_MS, animRef, heightRef, visible, setVisible: () => {} });
  const frames = el.animations[0].frames;
  check(frames[0].height === '300px', `re-open must start at the current height, got ${JSON.stringify(frames[0])}`);
  check(frames[1].height === '520px', 're-open must grow to the measured height');
}

// ---- scenario 4: first open still grows from 0 --------------------------
{
  const el = makeEl(520);
  const animRef = { current: null };
  const heightRef = { current: null };
  const visible = { value: true };
  runOpen(el, { open: true, expandMs: DUR.EXPAND_MS, animRef, heightRef, visible, setVisible: () => {} });
  const frames = el.animations[0].frames;
  check(frames[0].height === '0px', 'a first open must still start from 0');
  check(frames[1].height === '520px', 'a first open must end at the measured height');
}

console.log(`scenarios: 4 · problems: ${problems.length}`);
if (problems.length > 0) {
  for (const p of problems) console.log('FAIL  ' + p);
  process.exitCode = 1;
} else {
  console.log('OK: Collapse never collapses-then-grows, and never stacks on an inner height animation');
}
