// F202: does the heat matrix keep its hover while the pointer moves around it?
//   node mockup/cdp-hover-check.mjs <wsUrl>
//
// Drives the SHIPPED `columnFromPoint` (extracted from client.js into the harness)
// with real mouse moves over the real card geometry: legend above, marker lane,
// three metric rows separated by 4px margins, 1px column gaps, a 46px label
// gutter, a footer line below.
//
// The five invariants are the ones the user's report maps onto:
//   1. entering through a 1px gap resolves to the column the gap sits between;
//   2. a gap/row-margin move updates instead of freezing on the old column;
//   3. drifting off the ~52px plot strip into the card's dead zones keeps the
//      last column (that drift used to clear hover AND the list focus);
//   4. nothing is cleared until the pointer leaves the card;
//   5. the focus highlight is restored after something wipes the class.
import { connect, verdict } from './cdp-lib.mjs';

const wsUrl = process.argv[2];
if (!wsUrl) { console.error('usage: node cdp-hover-check.mjs <wsUrl>'); process.exit(2); }

const { evaluate, move, close } = await connect(wsUrl);

try {
  const geo = await evaluate('window.__geo("new")');
  const idxOf = [0, 1, 2, 40, 41, 100, 173, 174];
  await evaluate('window.__reset()');
  const problems = [];
  const state = () => evaluate('window.__state()');

  const hover = async () => (await state()).new.hover;
  const leaves = async () => (await state()).new.leaves;

  // 1. enter through a column centre, then a 1px gap
  await move(geo.colX[3], geo.rowY);
  let s = await state();
  if (s.new.hover !== idxOf[3]) problems.push(`entering at column ${idxOf[3]} resolved ${s.new.hover}`);

  // F203: the band must be painted on the column under the pointer, at the
  // geometry the cells use — and it must not wait for a render.
  const band = await evaluate('window.__band("new")');
  const expectBand = await evaluate(`window.__expectBand(${idxOf[3]}, "new")`);
  if (!band.visible) problems.push('no hover band was painted under the pointer');
  if (Math.abs(band.left - expectBand.left) > 1) problems.push(`band left ${band.left} vs expected ${expectBand.left}`);
  if (Math.abs(band.width - expectBand.width) > 1) problems.push(`band width ${band.width} vs expected ${expectBand.width}`);

  await move(geo.gapX, geo.rowY);
  const expectedGap = await evaluate(`window.__expectedAt(${geo.gapX}, ${geo.rowY}, "new")`);
  s = await state();
  if (expectedGap == null) problems.push('a 1px column gap resolved to nothing');
  if (s.new.hover !== expectedGap) problems.push(`a move into the 1px gap kept ${s.new.hover} instead of ${expectedGap}`);
  if (s.new.hover === idxOf[3]) problems.push('the gap move froze on the previous column');

  // 2. drift into the dead zones: legend, label gutter, card padding, footer
  const held = s.new.hover;
  for (const [name, x, y] of [
    ['legend', geo.colX[5], geo.legendY],
    ['label gutter', geo.gutterX, geo.rowY],
    ['card padding', geo.padX, geo.rowY],
    ['card footer', geo.colX[5], geo.footerY],
  ]) {
    await move(x, y);
    const now = await state();
    if (now.new.hover == null) problems.push(`hover was cleared over the ${name}`);
    else if (now.new.hover !== held) problems.push(`hover moved to ${now.new.hover} over the ${name} (expected to hold ${held})`);
  }

  // 3. the 4px gap between rows still resolves to its column
  await move(geo.colX[4], geo.gapY);
  s = await state();
  const expectedGapY = await evaluate(`window.__expectedAt(${geo.colX[4]}, ${geo.gapY}, "new")`);
  if (s.new.hover !== expectedGapY) problems.push(`a move into the row gap resolved ${s.new.hover}, expected ${expectedGapY}`);

  // 4. wobble: a hand never stays on one horizontal line
  let lostDuringWobble = 0;
  for (let i = 0; i < 24; i++) {
    const x = geo.colX[i % idxOf.length];
    const dead = i % 3 === 0;
    await move(x, dead ? geo.legendY : geo.rowY);
    const now = await state();
    if (now.new.hover == null) {
      lostDuringWobble += 1;
      if (lostDuringWobble <= 3) problems.push(`hover went null during wobble step ${i}`);
      continue;
    }
    if (!dead) {
      const expected = await evaluate(`window.__expectedAt(${x}, ${geo.rowY}, "new")`);
      if (now.new.hover !== expected) problems.push(`wobble step ${i} landed on ${now.new.hover}, expected ${expected}`);
    }
  }
  if (lostDuringWobble > 0) problems.push(`hover was lost ${lostDuringWobble} times during a 24-step wobble`);

  // 5. only leaving the card clears it
  if ((await leaves()) !== 0) problems.push(`the card reported ${await leaves()} leaves while the pointer never left it`);
  await move(geo.outsideX, geo.outsideY);
  await move(geo.outsideX, Math.max(2, geo.outsideY - 10));
  s = await state();
  if (s.new.hover != null) problems.push('leaving the card did not clear the hover');
  if (s.new.leaves < 1) problems.push('leaving the card did not fire a single mouseleave');
  const bandGone = await evaluate('window.__band("new")');
  if (bandGone.visible) problems.push('the hover band stayed visible after leaving the card');

  // 6. the focus highlight must come back after a className rewrite wipes it
  const focusOf = async () => (await state()).focus.join(',');
  await evaluate('window.__focus(3)');
  if ((await focusOf()) !== '3') problems.push(`syncFocusRow(3) left focus [${await focusOf()}]`);
  await evaluate('window.__wipeFocus()');
  if ((await focusOf()) !== '') problems.push('the control failed to wipe the focus class');
  await evaluate('window.__focus(3)');
  if ((await focusOf()) !== '3') problems.push('syncFocusRow did not restore the wiped highlight');
  await evaluate('window.__focus(4)');
  if ((await focusOf()) !== '4') problems.push(`moving the focus left [${await focusOf()}], expected [4]`);
  await evaluate('window.__focus(null)');
  if ((await focusOf()) !== '') problems.push('clearing the focus left a highlighted row');

  console.log(JSON.stringify({ geo, state: await state() }, null, 2));
  verdict(problems, 'the matrix holds its hover across gaps, dead zones and a wobble sweep, and the focus highlight survives a class wipe');
} finally {
  close();
}
