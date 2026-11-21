// F168 smoke test: load the client bundle with a stubbed React and a fake Cordis
// context, to catch definition-time / apply-time errors that `node --check`
// cannot see (missing identifiers, bad DESIGN wiring, locale table typos).
//   node mockup/smoke-load.mjs
import { readFileSync } from 'node:fs';

const source = readFileSync('E:/DeepSeek Project/Hades/dsh-trace-analyzer/client.js', 'utf8');

const captured = { spec: null };
const fakeDocument = {
  body: { hasAttribute: () => false, style: {}, appendChild() {} },
  documentElement: { hasAttribute: () => false, style: {} },
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  visibilityState: 'visible',
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
};
const fakeWindow = {
  __ModuleLoader__: { load(spec) { captured.spec = spec; return spec.id; } },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout,
  requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 0),
  cancelAnimationFrame: clearTimeout,
  devicePixelRatio: 1,
};
const fakeNavigator = { clipboard: { writeText: async () => {} } };

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
const requireStub = (id) => {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
};

new Function('window', 'document', 'navigator', source)(fakeWindow, fakeDocument, fakeNavigator);
if (!captured.spec) throw new Error('module did not register with the loader');
const mod = captured.spec.factory(requireStub);
console.log('id:', captured.spec.id);
console.log('inject:', JSON.stringify(mod.inject));

const effects = [];
let ViewComponent = null;
const ctx = {
  effect(fn, label) {
    effects.push(label);
    fn();
    return () => {};
  },
  locale: {
    register(ns, tables) {
      if (!tables.zh || !tables.en) throw new Error('locale table missing');
      if (tables.zh !== tables.en) throw new Error('locale tables must be identical (English-only UI)');
      console.log('locale ns:', ns, 'keys:', Object.keys(tables.en).length);
      return () => {};
    },
    bind() { return (k, fb) => fb; },
  },
  slots: {
    inject(name, fn) { console.log('slot inject:', name); return fn(); },
    register(spec, component) {
      console.log('slot register:', spec.id, 'order', spec.order);
      ViewComponent = component;
      return () => {};
    },
  },
};

mod.apply(ctx);
console.log('effects:', effects.join(' | '));

// Render the view shell once: catches JSX-path errors (missing identifiers,
// undefined tokens) that a syntax check cannot see.
if (typeof ViewComponent !== 'function') throw new Error('view component was not registered');
const tree = ViewComponent({ sessionId: 'smoke-session', t: null });
const describe = (node) => {
  if (node == null) return 'null';
  if (Array.isArray(node)) return '[' + node.map(describe).join(',') + ']';
  if (typeof node !== 'object') return typeof node;
  const children = node.children ?? [];
  return String(node.type) + '(' + children.map(describe).join(',') + ')';
};
console.log('shell:', describe(tree).slice(0, 400));
// F202: the theme is an attribute on the panel root + a CSS-variable stylesheet,
// not a palette object rewritten during render.
const cls = String(tree?.props?.className ?? '');
if (!cls.includes('hades-panel')) throw new Error('the panel root must carry the hades-panel class (theme scope)');
const theme = tree?.props?.['data-hades-theme'];
if (theme !== 'light' && theme !== 'dark') throw new Error('the panel root must declare data-hades-theme, got ' + theme);
const styleText = (tree?.children ?? []).map((child) => (typeof child?.children?.[0] === 'string' ? child.children[0] : '')).join('');
if (!styleText.includes('--hades-hover-row:')) throw new Error('the theme stylesheet must define the tint variables');
if (!styleText.includes('[data-hades-theme="dark"]')) throw new Error('the theme stylesheet must carry the dark overrides');
console.log('theme:', theme, '· stylesheet bytes:', styleText.length);
console.log('OK: module loaded, applied and rendered');
