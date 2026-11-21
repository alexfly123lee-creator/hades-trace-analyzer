// F202 hover harness: REAL card geometry (legend · marker lane · three metric
// rows with 1px column gaps and 4px row gaps · 46px label gutter · footer line
// below) driven by the SHIPPED `columnFromPoint` / `syncFocusRow`, extracted
// verbatim from client.js. The legacy wiring (plot-level mouseleave + closest()
// on the cell) sits next to it as a control, so a check can prove the defect is
// still reproducible when the fix is reverted.
//   node mockup/build-hover-harness.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const source = readFileSync('E:/DeepSeek Project/Hades/dsh-trace-analyzer/client.js', 'utf8');

function extract(name) {
  const start = source.indexOf(`const ${name} = (`);
  if (start < 0) throw new Error(`missing ${name}`);
  const arrow = source.indexOf('=>', start);
  if (arrow < 0) throw new Error(`no arrow for ${name}`);
  const braceStart = source.indexOf('{', arrow);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const params = source.slice(start + `const ${name} = `.length, arrow).trim();
        return { params, body: source.slice(braceStart, i + 1) };
      }
    }
  }
  throw new Error(`unbalanced ${name}`);
}

const shipped = ['columnFromPoint', 'syncFocusRow']
  .map((name) => {
    const { params, body } = extract(name);
    return `function ${name}${params.slice(params.indexOf('('))} ${body}`;
  })
  .join('\n');

const CSS = [
  ':host{display:block;font:13px/1.6 -apple-system,sans-serif;color:#0f1115}',
  '.card{background:#fff;border:1px solid #0000001a;border-radius:12px;padding:10px 12px;margin-bottom:14px;width:620px}',
  '.legend{display:flex;align-items:center;gap:8px;min-height:18px;margin-bottom:8px;font:11px/1.2 Consolas,monospace;color:#61666b}',
  '.legend b{color:#3b82f6;font-weight:600}',
  '.plot{position:relative;cursor:pointer}',
  '.lane{display:flex;align-items:center;gap:8px;height:4px;margin-bottom:4px}',
  '.lane .lbl{flex:0 0 46px}',
  '.lane .grid{flex:1 1 auto;min-width:0;display:grid;gap:1px;cursor:pointer}',
  '.lane i{display:block;height:3px;border-radius:1px;background:color-mix(in srgb,#ef4444 62%,#fff)}',
  '.mrow{display:flex;align-items:center;gap:8px;margin-bottom:4px}',
  '.mrow .lbl{flex:0 0 46px;text-align:right;font:11px/1 Consolas,monospace;color:#61666b}',
  '.mrow .grid{flex:1 1 auto;min-width:0;display:grid;gap:1px;cursor:pointer}',
  '.mrow i{display:block;height:11px;border-radius:1px;background:color-mix(in srgb,#3b82f6 22%,#fff)}',
  '.footer{display:flex;align-items:center;gap:10px;min-height:18px;margin-top:8px;padding-top:8px;border-top:1px solid #00000014;font:11px/1.2 Consolas,monospace;color:#61666b}',
  '.band{position:absolute;top:-8px;bottom:-2px;pointer-events:none;display:none;background:color-mix(in srgb,#3b82f6 18%,transparent);border-left:1px solid #3b82f6;border-right:1px solid #3b82f6}',
  '.out{font:11px/1.2 Consolas,monospace;color:#61666b;margin-top:6px}',
  '.list{margin-top:4px;border-top:1px solid #00000014}',
  '.hades-run-group{display:flex;align-items:center;height:22px;padding:0 4px;font:11px/1 Consolas,monospace;color:#3f4650}',
  '.hades-run-group.is-focus{background:color-mix(in srgb,#3b82f6 16%,transparent);border-left:3px solid #3b82f6}',
  '.cap{font:11px/1.4 Consolas,monospace;color:#8b9199;margin:0 0 6px}',
].join('');

const PAGE = `
  const COLS = 175;
  const LIST = Array.from({ length: COLS }, (_, i) => ({ idx: i }));
  const host = document.getElementById('host');
  const root = host.attachShadow({ mode: 'open' });
  const st = document.createElement('style');
  st.textContent = ${JSON.stringify(CSS)};
  root.appendChild(st);

  const state = {
    new: { hover: null, leaves: 0, moves: 0, frozen: 0 },
    old: { hover: null, leaves: 0, moves: 0, frozen: 0 },
  };

  function cells(count) {
    let out = '';
    for (let i = 0; i < count; i++) out += '<i data-idx="' + i + '"></i>';
    return out;
  }
  function plotBody(count) {
    const cols = 'grid-template-columns:repeat(' + count + ',minmax(0,1fr))';
    let out = '<div class="lane"><span class="lbl"></span><div class="grid" data-lane-grid="1" style="' + cols + '">' + cells(count) + '</div></div>';
    for (const name of ['Time', 'Token', 'Steps']) {
      out += '<div class="mrow"><span class="lbl">' + name + '</span>'
        + '<div class="grid" data-row-grid="1" style="' + cols + '">' + cells(count) + '</div></div>';
    }
    return out;
  }
  function buildCard(mode, caption) {
    const el = document.createElement('div');
    el.className = 'card';
    el.setAttribute('data-card', mode);
    el.innerHTML = '<div class="legend"><b data-readout="' + mode + '">hover a run</b><span style="flex:1 1 auto"></span><span>Time</span><span>Token</span><span>Steps</span></div>'
      + '<div class="plot" data-plot="' + mode + '">' + plotBody(COLS) + '<span class="band" data-band="' + mode + '"></span></div>'
      + '<div class="footer">every run \u00b7 one column each</div>'
      + '<div class="out" data-out="' + mode + '">hover: —</div>'
      + '<div class="cap">' + caption + '</div>';
    root.appendChild(el);
    return el;
  }

  ${shipped}

  const cardNew = buildCard('new', 'F202 · pointer on the card + geometric column resolver (shipped)');
  const cardOld = buildCard('old', 'legacy · plot-level mouseleave + closest(data-idx) (control)');

  const q = (sel) => root.querySelector(sel);
  const cardRect = (mode) => q('[data-card="' + mode + '"]').getBoundingClientRect();
  const plotRect = (mode) => q('[data-plot="' + mode + '"]').getBoundingClientRect();
  const gridRect = (mode) => q('[data-card="' + mode + '"] [data-row-grid="1"]').getBoundingClientRect();

  function paint(mode, idx) {
    state[mode].hover = idx;
    const band = q('[data-band="' + mode + '"]');
    const out = q('[data-out="' + mode + '"]');
    const readout = q('[data-readout="' + mode + '"]');
    if (idx == null) {
      band.style.display = 'none';
      out.textContent = 'hover: —';
      readout.textContent = 'hover a run';
      return;
    }
    const grid = gridRect(mode);
    const plot = plotRect(mode);
    const track = (grid.width - (COLS - 1)) / COLS;
    band.style.display = 'block';
    band.style.left = (grid.left - plot.left + idx * (track + 1)) + 'px';
    band.style.width = track + 'px';
    out.textContent = 'hover: Run ' + idx;
    readout.textContent = 'Run ' + idx + ' · 12.3s · 45.6k tok';
  }

  // --- shipped wiring: pointer events on the CARD, geometry on the plot ------
  cardNew.addEventListener('mousemove', (event) => {
    state.new.moves += 1;
    const idx = columnFromPoint(
      { x: event.clientX, y: event.clientY },
      plotRect('new'),
      gridRect('new'),
      LIST,
    );
    if (idx == null || idx === state.new.hover) { state.new.frozen += 1; return; }
    paint('new', idx);
  });
  cardNew.addEventListener('mouseleave', () => {
    state.new.leaves += 1;
    paint('new', null);
  });

  // --- legacy wiring (control): plot-level leave + closest() -----------------
  const legacyPlot = q('[data-plot="old"]');
  legacyPlot.addEventListener('mousemove', (event) => {
    state.old.moves += 1;
    const cell = event.target && event.target.closest ? event.target.closest('[data-idx]') : null;
    if (cell == null) { state.old.frozen += 1; return; }
    const next = Number(cell.getAttribute('data-idx'));
    if (!Number.isFinite(next) || next === state.old.hover) return;
    paint('old', next);
  });
  legacyPlot.addEventListener('mouseleave', () => {
    state.old.leaves += 1;
    paint('old', null);
  });

  // focus list for the shipped syncFocusRow
  const focusHost = document.createElement('div');
  focusHost.className = 'list';
  for (let i = 0; i < 6; i++) {
    const row = document.createElement('div');
    row.className = 'hades-run-group';
    row.setAttribute('data-run', String(i));
    row.textContent = 'Run ' + i;
    focusHost.appendChild(row);
  }
  root.appendChild(focusHost);

  window.__state = () => ({
    new: { ...state.new },
    old: { ...state.old },
    focus: [...focusHost.querySelectorAll('.hades-run-group.is-focus')].map((el) => Number(el.getAttribute('data-run'))),
  });
  window.__reset = () => {
    for (const mode of ['new', 'old']) {
      state[mode].hover = null; state[mode].leaves = 0; state[mode].moves = 0; state[mode].frozen = 0;
      paint(mode, null);
    }
  };
  window.__geo = (modeArg) => {
    const mode = modeArg || 'new';
    const card = cardRect(mode);
    const plot = plotRect(mode);
    const grid = gridRect(mode);
    const legend = q('[data-card="' + mode + '"] .legend').getBoundingClientRect();
    const footer = q('[data-card="' + mode + '"] .footer').getBoundingClientRect();
    const lane = q('[data-card="' + mode + '"] [data-lane-grid="1"]').getBoundingClientRect();
    const track = (grid.width - (COLS - 1)) / COLS;
    return {
      card: { left: card.left, top: card.top, right: card.right, bottom: card.bottom },
      plot: { left: plot.left, top: plot.top, right: plot.right, bottom: plot.bottom },
      grid: { left: grid.left, top: grid.top, right: grid.right, bottom: grid.bottom, width: grid.width },
      track,
      colX: [0, 1, 2, 40, 41, 100, 173, 174].map((i) => grid.left + i * (track + 1) + track / 2),
      gapX: grid.left + track + 0.5,
      rowY: grid.top + 5,
      // the 4px margin BETWEEN the first and the second metric row (12px of the
      // 49px plot height — the largest dead area the old closest() hit-testing
      // treated as "no column")
      gapY: grid.bottom + 2,
      // the 46px label gutter, left of the grid, inside the plot box
      gutterX: (plot.left + grid.left) / 2,
      laneY: lane.top + 1.5,
      legendY: legend.top + legend.height / 2,
      footerY: footer.top + footer.height / 2,
      padX: card.left + 4,
      outsideX: Math.max(2, card.left - 30),
      outsideY: Math.max(2, card.top - 20),
    };
  };
  window.__expectedAt = (x, y, mode) => columnFromPoint(
    { x, y },
    plotRect(mode || 'new'),
    gridRect(mode || 'new'),
    LIST,
  );
  window.__focus = (idx) => syncFocusRow(focusHost, idx);
  window.__wipeFocus = () => {
    const el = focusHost.querySelector('.hades-run-group.is-focus');
    if (el != null) el.classList.remove('is-focus');
  };
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>F202 hover</title>
<style>html,body{margin:0;background:#eceef1;padding:12px}#host{display:block}</style></head><body>
<div id="host"></div>
<script>${PAGE}</script></body></html>`;

mkdirSync('C:/Users/18610/AppData/Local/Temp/dsm', { recursive: true });
writeFileSync('C:/Users/18610/AppData/Local/Temp/dsm/hover-harness.html', html);
writeFileSync('mockup/hover-harness.html', html);
console.log('hover harness rewritten for F202 (shipped columnFromPoint + syncFocusRow)');
