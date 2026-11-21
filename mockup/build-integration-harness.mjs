// F175 integration harness: the REAL shipped code (onWheel / scrubTo / beginScrub /
// stopFollowing / topVisibleRunIdx) extracted verbatim from client.js, driven by a
// faithful mirror of Body's follow integration (scroll listener + programmatic
// guard + F170 cursor effect + realtime tick) and of the panel's focus dimming.
//   node mockup/build-integration-harness.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync('E:/DeepSeek Project/Hades/dsh-trace-analyzer/client.js', 'utf8');

function extract(name) {
  const start = source.indexOf(`const ${name} = (`);
  if (start < 0) throw new Error(`missing ${name}`);
  const braceStart = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const body = source.slice(braceStart, i + 1);
        const paramsEnd = source.indexOf('=>', start);
        const head = source.slice(start + `const ${name} = `.length, paramsEnd).trim();
        return { head, body };
      }
    }
  }
  throw new Error(`unbalanced ${name}`);
}

const shipped = ['glideScroll', 'scrubTo', 'beginScrub', 'stopFollowing', 'topVisibleRunIdx']
  .map((n) => {
    const { head, body } = extract(n);
    return `  function ${n}${head.slice(head.indexOf('('))} ${body}`;
  })
  .join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>F175 integration</title>
<style>html,body{margin:0;background:#eceef1}#host{display:block}</style></head><body>
<div id="host"></div>
<script>
  const ROWS = 200;
  const CSS = \`
    :host{display:block;font:13px/1.6 -apple-system,sans-serif;color:#0f1115}
    .shell{display:flex;flex-direction:column;height:560px;background:#fff;border:1px solid #0000001a;border-radius:12px;overflow:hidden}
    .card{flex:0 0 auto;height:110px;display:flex;align-items:center;justify-content:center;font:11px Consolas,monospace;color:#61666b;border-bottom:1px solid #0000001a}
    .list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 12px;overscroll-behavior:contain;overflow-anchor:none}
    .row{display:flex;align-items:center;height:28px;padding:4px 0;box-sizing:border-box;border-bottom:1px solid #0000000d;font-size:12px;transition:opacity 160ms ease}
    .list.dim .row{opacity:.22}
    .list.dim .row.focus{opacity:1;background:color-mix(in srgb,#3b82f6 16%,transparent);border-left:3px solid #3b82f6}
    .idx{flex:0 0 78px;font-family:Consolas,monospace;color:#61666b}
  \`;
  const host = document.getElementById('host');
  const root = host.attachShadow({ mode: 'open' });
  const st = document.createElement('style'); st.textContent = CSS; root.appendChild(st);
  const wrap = document.createElement('div');
  wrap.innerHTML = '<div class="shell"><div class="card" data-matrix="1">wheel / pointer target</div><div class="list" data-list="1"></div></div>';
  root.appendChild(wrap);

  const matrix = root.querySelector('[data-matrix]');
  const list = root.querySelector('[data-list]');
  const rows = [];
  const shown = [];
  const tail = document.createElement('div');
  list.appendChild(tail);
  function addRow(i) {
    const el = document.createElement('div');
    el.className = 'row';
    el.setAttribute('data-run', String(i));
    el.innerHTML = '<span class="idx">Run ' + i + '</span>';
    list.insertBefore(el, tail);
    rows.push(el);
    shown.push({ idx: i });
  }
  for (let i = 0; i < ROWS; i++) addRow(i);
  const sizeTail = () => { tail.style.height = Math.max(0, list.clientHeight - 40) + 'px'; };
  sizeTail();

  // ---- state the shipped code closes over -------------------------------
  const shownRef = { current: shown };
  const hoverRef = { current: null };          // F175: the single focused Run
  const selectedRef = { current: null };        // the clicked Run
  const wheelAcc = { current: 0 };
  const lastWheelAt = { current: 0 };
  const baseRunRef = { current: null };
  const flashTickRef = { current: () => {} };
  const scrubRef = { current: null };
  const DESIGN = { motion: { fast: 120, focus: 300, glide: 260 } };
  const motionReduced = () => false;
  const scrollRef = { current: list };
  const scrubCancel = { current: null };
  const scrubTimer = { current: null };
  const scrubTarget = { current: null };
  const scrubAt = { current: 0 };
  const followRef = { current: true };
  const programmatic = { current: false };
  const programmaticTimer = { current: null };
  const trace = [];
  let ticks = 0;

  function paint() {
    const focus = hoverRef.current;
    list.classList.toggle('dim', focus != null);
    rows.forEach((el, i) => el.classList.toggle('focus', shown[i].idx === focus));
  }
  function setHover(idx) {
    hoverRef.current = idx;
    paint();
    trace.push({ kind: 'focus', idx, scrollTop: Math.round(list.scrollTop), follow: followRef.current });
  }
  function setSelected(idx) { selectedRef.current = idx; }
  function setFollow(v) { followRef.current = v; }
  function setFocusRun(v) { setHover(v); }
  // F180: the product marks the row node directly; the harness paints through
  // setHover, so this only needs to keep the ref in sync.
  const focusRunRef = { current: null };
  const markFocusedRow = (idx) => { focusRunRef.current = idx; };
  // F181: the Run a click parked at the top.
  const locatedRunRef = { current: null };
  const logScroll = () => {}; // shipped diagnostics are inert in the harness
  function lastRowBottom() {
    const els = list.querySelectorAll('[data-run]');
    if (els.length === 0) return null;
    const last = els[els.length - 1];
    return last.getBoundingClientRect().bottom - list.getBoundingClientRect().top + list.scrollTop;
  }

  // ---- shipped code, verbatim -------------------------------------------
${shipped}

  // ---- Body integration mirror (F170 / F174) ----------------------------
  function markProgrammatic(ms = 260) {
    programmatic.current = true;
    if (programmaticTimer.current != null) clearTimeout(programmaticTimer.current);
    programmaticTimer.current = setTimeout(() => { programmaticTimer.current = null; programmatic.current = false; }, ms);
  }
  function scrollToLatest() {
    const bottom = lastRowBottom();
    if (bottom == null) return;
    const target = Math.max(0, bottom - list.clientHeight + 16);
    if (Math.abs(target - list.scrollTop) < 2) return;
    markProgrammatic(120);
    list.scrollTop = target;
  }
  list.addEventListener('scroll', () => {
    if (programmatic.current) return;
    const bottom = lastRowBottom();
    if (bottom == null) return;
    const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
    const atEdge = list.scrollTop >= maxScroll - 8 || bottom - (list.scrollTop + list.clientHeight) <= 8;
    if (atEdge !== followRef.current) { followRef.current = atEdge; trace.push({ kind: 'follow', value: atEdge }); }
  }, { passive: true });

  scrubRef.current = (idx) => beginScrub(idx);
  baseRunRef.current = topVisibleRunIdx;

  function applyFollowEffect() {
    if (!followRef.current) return;
    const last = shown[shown.length - 1];
    if (last && selectedRef.current !== last.idx) {
      selectedRef.current = last.idx;
      trace.push({ kind: 'follow-snap', idx: last.idx });
    }
  }
  window.__tick = () => {
    ticks += 1;
    addRow(ROWS + ticks);
    sizeTail();
    applyFollowEffect();
    if (followRef.current) scrollToLatest();
  };
  // mirror the shipped pointer handler: hovering a column focuses + scrolls, the
  // same path the wheel takes (F175).
  // F183: after a click parks a Run at the top, hovering only highlights.
  let hoverLock = false;
  window.__hover = (idx) => {
    setHover(idx);
    if (hoverLock) { setFocusRun(idx); return; }
    beginScrub(idx);
  };
  window.__leave = () => {
    hoverLock = false;
    setHover(null);
    beginScrub(null);
  };

  // F176: the wheel does nothing on the matrix any more — only record it so the
  // check can prove the focus did NOT move.
  matrix.addEventListener('wheel', (event) => {
    trace.push({ kind: 'wheel', dy: event.deltaY, mode: event.deltaMode, focus: hoverRef.current });
  }, { passive: true });

  // seed like F170: open at the live edge, cursor on the newest Run
  selectedRef.current = shown[shown.length - 1].idx;
  scrollToLatest();
  paint();

  window.__state = () => {
    const bottom = lastRowBottom();
    const focusEl = hoverRef.current == null ? null : rows.find((el) => Number(el.getAttribute('data-run')) === hoverRef.current);
    const focusPct = focusEl
      ? Math.round(((focusEl.getBoundingClientRect().top - list.getBoundingClientRect().top) / list.clientHeight) * 100)
      : null;
    return {
      focus: hoverRef.current,
      selected: selectedRef.current,
      follow: followRef.current,
      scrollTop: Math.round(list.scrollTop),
      maxScroll: Math.round(list.scrollHeight - list.clientHeight),
      distanceToEdge: bottom == null ? null : Math.round(bottom - (list.scrollTop + list.clientHeight)),
      dim: list.classList.contains('dim'),
      focusedRows: rows.filter((el) => el.classList.contains('focus')).length,
      focusPct,
      rows: shown.length,
      pageScrollY: window.scrollY,
    };
  };
  window.__visibleRun = () => topVisibleRunIdx();
  // F180 scenario: hover → click (open the row + scroll it to the top) → the detail
  // grows → the pointer leaves. The list must not move by itself at any step.
  window.__click = (idx) => {
    hoverLock = true; // mirrors the click handler
    setSelected(idx);
    locatedRunRef.current = idx; // mirrors locateRun
    const el = rows.find((row) => Number(row.getAttribute('data-run')) === idx);
    if (el && !el.querySelector('[data-detail]')) {
      const detail = document.createElement('div');
      detail.setAttribute('data-detail', '1');
      detail.style.height = '180px';
      detail.style.background = 'color-mix(in srgb, #3b82f6 6%, transparent)';
      el.appendChild(detail);
    }
    // mirror locateRun: scroll the row to the top
    const top = el.getBoundingClientRect().top - list.getBoundingClientRect().top;
    markProgrammatic(120);
    list.scrollTop = Math.max(0, list.scrollTop + top - 2);
    trace.push({ kind: 'click', idx, scrollTop: Math.round(list.scrollTop) });
  };
  // F182: simulate "something else moved the list" while the pointer is away.
  window.__externalScroll = (top) => {
    programmatic.current = false;
    list.scrollTop = top;
  };
  window.__grow = (idx, px) => {
    const el = rows.find((row) => Number(row.getAttribute('data-run')) === idx);
    const detail = el && el.querySelector('[data-detail]');
    if (!detail) return;
    detail.style.height = (parseInt(detail.style.height, 10) + px) + 'px';
  };
  // The Run sitting at the given percentage of the viewport (used to prove that a
  // focus inside the comfort band does not scroll the list at all).
  window.__runAtPct = (pct) => {
    const target = list.getBoundingClientRect().top + (list.clientHeight * pct) / 100;
    for (const el of rows) {
      const r = el.getBoundingClientRect();
      if (r.top <= target && r.bottom >= target) return Number(el.getAttribute('data-run'));
    }
    return topVisibleRunIdx();
  };
  window.__trace = () => trace;
</script></body></html>`;

writeFileSync('C:/Users/18610/AppData/Local/Temp/dsm/integration-harness.html', html);
writeFileSync('mockup/integration-harness.html', html);
console.log('integration harness rewritten for F175 focus model');
