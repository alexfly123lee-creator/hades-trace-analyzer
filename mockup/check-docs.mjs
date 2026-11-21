// Doc-size gate (G4): every document must stay under 2000 字.
//   node mockup/check-docs.mjs [--verbose]
//
// 字 = CJK characters + ASCII words. Chinese prose is counted per character, which
// is how "2000 字" is normally read; inline code and identifiers count as words.
// The point of the gate is that the docs stay a summary — the rationale that used
// to live in 40-line comment blocks now has nowhere to hide.
import { readFileSync } from 'node:fs';

const LIMIT = 2000;
const DOCS = [
  'agent.md',
  'docs/SPEC.md',
  'docs/TEST.md',
  'docs/DESIGN.md',
  'README.md',
  'dsh-trace-analyzer/docs/DETAIL.md',
];

const verbose = process.argv.includes('--verbose');

function count(text) {
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/g) ?? []).length;
  // Everything that is not CJK, then latin/digit runs as words.
  const latin = (text.replace(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/g, ' ')
    .match(/[A-Za-z0-9_$][A-Za-z0-9_.$/-]*/g) ?? []).length;
  return { cjk, latin, total: cjk + latin };
}

let over = 0;
const rows = [];
for (const file of DOCS) {
  const text = readFileSync(file, 'utf8');
  const { cjk, latin, total } = count(text);
  const bad = total > LIMIT;
  if (bad) over += 1;
  rows.push({ file, cjk, latin, total, bad });
}
const width = Math.max(...rows.map((r) => r.file.length));
console.log('doc'.padEnd(width), 'total  cjk  words  verdict');
for (const r of rows) {
  console.log(
    r.file.padEnd(width),
    String(r.total).padStart(5),
    String(r.cjk).padStart(4),
    String(r.latin).padStart(6),
    ` ${r.bad ? `OVER by ${r.total - LIMIT}` : 'ok'}`,
  );
  if (r.bad) console.log(`  -> ${r.file} must lose ${r.total - LIMIT} 字`);
}
if (verbose) console.log('(limit ' + LIMIT + ' 字 per document)');
if (over > 0) {
  console.log(`FAIL: ${over} document(s) over ${LIMIT} 字`);
  process.exitCode = 1;
} else {
  console.log(`OK: all ${rows.length} documents are under ${LIMIT} 字`);
}
