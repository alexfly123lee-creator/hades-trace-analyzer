// One-command regression for the Trace Lab panel (agent.md §0 交付铁律).
//   node mockup/regress.mjs [guiUrl]
//
// Order: syntax · unit · module smoke · render smoke · Collapse probe ·
// harness build · served markers · four CDP interaction harnesses. Children use
// inherited stdio (piped stdio is blocked in this sandbox), so the verdict is the
// child's exit code; each cdp-* script asserts its own invariants.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CLIENT = 'dsh-trace-analyzer/client.js';
const TEST_FILE = 'dsh-trace-analyzer/test/trace.test.js';
const LIB_FILES = ['trace', 'titles', 'project', 'bench'].map((name) => `dsh-trace-analyzer/lib/${name}.js`);
const gui = process.argv[2] ?? process.env.DSH_WEB_URL ?? 'http://127.0.0.1:49877';
const NODE = process.execPath;

const results = [];
const record = (label, ok, ms, status) => results.push({ label, ok, ms, status });
const run = (label, args) => {
  const started = Date.now();
  const res = spawnSync(NODE, args, { stdio: 'inherit', cwd: process.cwd() });
  record(label, res.status === 0, Date.now() - started, res.status);
  return res.status === 0;
};
const header = (text) => console.log(`\n=== ${text} ===`);

// ---------------------------------------------------------------- static ----
header('1/5 syntax + unit tests');
run('syntax', ['--check', CLIENT]);
run('syntax:host', ['--check', 'dsh-trace-analyzer/index.js']);
for (const file of LIB_FILES) run('syntax:lib', ['--check', file]);
run('unit', ['--test', TEST_FILE]);

header('2/5 module + render smoke');
run('smoke:load', ['mockup/smoke-load.mjs']);
run('smoke:render', ['mockup/smoke-render.mjs']);
// F188: the Collapse effect bodies are executed here against a fake element, so
// "expands then jumps" style regressions fail without a browser.
run('collapse', ['mockup/check-collapse.mjs']);

// The interaction harnesses EMBED shipped code extracted from client.js (F175,
// F202), so they are regenerated before they run — a stale harness would happily
// pass while the product changed underneath it.
header('3/5 harness build');
run('build:harness', ['mockup/build-integration-harness.mjs']);
run('build:hover', ['mockup/build-hover-harness.mjs']);
run('build:follow', ['mockup/build-follow-harness.mjs']);

header('4/5 served bundle + docs');
run('served', ['mockup/check-served.mjs', gui]);
run('docs', ['mockup/check-docs.mjs']);

// ------------------------------------------------------------- CDP pages ----
const harnesses = [
  { label: 'cdp:focus', page: 'mockup/integration-harness.html', script: 'mockup/cdp-integration-check.mjs' },
  { label: 'cdp:hover', page: 'mockup/hover-harness.html', script: 'mockup/cdp-hover-check.mjs' },
  // F202 control: the legacy wiring must still reproduce the defect, otherwise
  // cdp:hover's assertions have no teeth.
  { label: 'control:hover', page: 'mockup/hover-harness.html', script: 'mockup/control-hover.mjs' },
  { label: 'cdp:follow', page: 'mockup/follow-harness.html', script: 'mockup/cdp-follow-check.mjs' },
];

const waitForPage = async (port, needle) => {
  for (let i = 0; i < 48; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((p) => p.type === 'page' && String(p.url).includes(needle));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* browser not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
};

header('5/5 CDP interaction harnesses');
let port = 9300;
let broken = false;
for (const h of harnesses) {
  if (broken) {
    record(h.label, false, 0, 'skipped (earlier failure)');
    continue;
  }
  if (!existsSync(h.page)) {
    record(h.label, false, 0, 'missing page');
    broken = true;
    continue;
  }
  port += 1;
  const profile = mkdtempSync(join(tmpdir(), 'dsh-regress-'));
  const abs = join(process.cwd(), h.page).replace(/\\/g, '/');
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--window-size=900,700', `file:///${abs}`,
  ], { stdio: 'ignore' });
  const ws = await waitForPage(port, h.page.split('/').pop());
  const started = Date.now();
  if (!ws) {
    record(h.label, false, Date.now() - started, 'no devtools page');
    broken = true;
  } else {
    const res = spawnSync(NODE, [h.script, ws], { stdio: 'inherit', cwd: process.cwd() });
    // exit 0 = script passed; 1 = its invariants failed (treat as a failed check)
    results.push({ label: h.label, ok: res.status === 0, ms: Date.now() - started, status: res.status });
    if (res.status !== 0) broken = true;
  }
  try { edge.kill(); } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, 300));
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* file locks */ }
}

// ---------------------------------------------------------------- summary ---
header('summary');
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label.padEnd(14)} ${String(r.ms).padStart(5)}ms  ${r.status ?? ''}`);
}
console.log(`\n${failed === 0 ? 'ALL GREEN' : `${failed} FAILED`} (${results.length} checks)`);
process.exit(failed === 0 ? 0 : 1);
