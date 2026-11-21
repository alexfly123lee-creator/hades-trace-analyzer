// Generate the detail-page feature image (docs/preview.svg): a geometric
// illustration of the panel, text-free and readable on light and dark themes.
//   node scripts/build-preview.mjs
import { writeFileSync } from 'node:fs';

const W = 640;
const H = 300;
const parts = [];
const rect = (x, y, w, h, fill, opts = {}) => {
  const rx = opts.rx ?? 2;
  const opacity = opts.opacity == null ? '' : ` opacity="${opts.opacity}"`;
  const stroke = opts.stroke ? ` stroke="${opts.stroke}" stroke-width="${opts.sw ?? 1.5}" fill="none"` : ` fill="${fill}"`;
  parts.push(`  <rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${rx}"${stroke}${opacity}/>`);
};
const round = (v) => Math.round(v * 100) / 100;

// --- card -------------------------------------------------------------------
rect(32, 32, 576, 236, '#f8fafc', { rx: 14, stroke: '#cbd5e1', sw: 1.5 });
// readout pill + legend swatches
rect(48, 46, 148, 12, '#3b82f6', { rx: 6, opacity: 0.9 });
const swatches = [['#3b82f6', 452, 10], ['#c7d7f5', 468, 26], ['#a78bfa', 506, 10], ['#ddd3fb', 522, 26], ['#22c55e', 560, 10], ['#c8ecd4', 576, 16]];
for (const [fill, x, w] of swatches) rect(x, 47, w, 10, fill, { rx: 3, opacity: 0.8 });

// --- matrix: marker lane + three metric rows of cells -----------------------
const LEFT = 48;
const RIGHT = 592;
const N = 46;
const GAP = 1.6;
const CELL = (RIGHT - LEFT - (N - 1) * GAP) / N;
const cellX = (i) => LEFT + i * (CELL + GAP);
const SHADES = [0.18, 0.26, 0.34, 0.42, 0.52, 0.62, 0.72, 0.84];
// deterministic pseudo-random so the picture is stable between builds
let seed = 20261121;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

rect(LEFT - 4, 70, RIGHT - LEFT + 8, 4, '#f1f5f9', { rx: 2 });
for (let i = 0; i < N; i++) {
  const r = rnd();
  if (r > 0.93) rect(cellX(i), 70, CELL, 4, '#ef4444', { rx: 2 });
  else if (r > 0.855) rect(cellX(i), 70, CELL, 4, '#f59e0b', { rx: 2 });
}
const ROWS = [
  { y: 80, tone: '#3b82f6' },
  { y: 98, tone: '#a78bfa' },
  { y: 116, tone: '#22c55e' },
];
for (const row of ROWS) {
  for (let i = 0; i < N; i++) {
    const shade = SHADES[Math.floor(rnd() * SHADES.length)];
    rect(cellX(i), row.y, CELL, 12, row.tone, { rx: 2, opacity: shade });
  }
}

// --- hover band over one column: three rectangles, never a bordered box ------
const bandX = cellX(19);
rect(bandX, 64, CELL, 70, '#3b82f6', { rx: 0, opacity: 0.26 });
rect(bandX, 64, 1.4, 70, '#3b82f6', { rx: 0 });
rect(bandX + CELL - 1.4, 64, 1.4, 70, '#3b82f6', { rx: 0 });

// --- run rows: index, time bar, token bar, tag, prompt ----------------------
const runRow = (y, timeW, tokenW, tagFill, promptW) => {
  rect(40, y + 3, 7, 7, '#94a3b8', { rx: 2 });
  rect(60, y, 132, 8, '#e2e8f0', { rx: 4 });
  rect(60, y, timeW, 8, '#3b82f6', { rx: 4 });
  rect(202, y, 132, 8, '#ede9fe', { rx: 4 });
  rect(202, y, tokenW, 8, '#a78bfa', { rx: 4 });
  rect(344, y - 2, 36, 12, tagFill, { rx: 4 });
  rect(390, y - 2, promptW, 12, '#e2e8f0', { rx: 6 });
};
runRow(152, 44, 96, '#dbeafe', 202);
runRow(172, 86, 40, '#fef3c7', 168);
runRow(192, 26, 14, '#dcfce7', 196);

// --- one expanded run: bracket + two step rows ------------------------------
rect(52, 212, 540, 44, null, { rx: 10, stroke: '#93c5fd', sw: 1.5 });
rect(52, 212, 3, 44, '#3b82f6', { rx: 1.5 });
const stepRow = (y, timeW, tokenW, tagFill, promptW) => {
  rect(66, y + 3, 6, 6, '#94a3b8', { rx: 2 });
  rect(82, y, 100, 8, '#e2e8f0', { rx: 4 });
  rect(82, y, timeW, 8, '#3b82f6', { rx: 4 });
  rect(196, y, 100, 8, '#ede9fe', { rx: 4 });
  rect(196, y, tokenW, 8, '#a78bfa', { rx: 4 });
  rect(310, y - 2, 32, 12, tagFill, { rx: 4 });
  rect(350, y - 2, promptW, 12, '#e2e8f0', { rx: 6 });
};
stepRow(219, 40, 66, '#dbeafe', 190);
stepRow(235, 22, 18, '#fee2e2', 158);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${parts.join('\n')}
</svg>
`;
writeFileSync('dsh-trace-analyzer/docs/preview.svg', svg);
console.log(`preview.svg written 路 ${svg.length} B 路 ${parts.length} shapes`);

