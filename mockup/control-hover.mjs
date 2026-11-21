// F202 control: prove the hover check has teeth.
//   node mockup/control-hover.mjs <wsUrl>
//
// The harness ships the legacy wiring (plot-level mouseleave + closest() on the
// cell) next to the fixed one. This script drives the LEGACY card and asserts the
// defect still reproduces there:
//   1. a move into the 4px margin between two metric rows is swallowed, so the
//      readout freezes on the previous column (24% of the plot's height);
//   2. a 3px drift off the plot strip into the legend clears the hover — and with
//      it the list focus, because the same handler releases both;
//   3. re-entering over that margin leaves the matrix with no hover at all, since
//      nothing but a real cell node can resolve a column.
// If any of those stops happening, cdp-hover-check's assertions may be vacuous,
// so this script fails instead of passing silently.
import { connect, verdict } from './cdp-lib.mjs';

const wsUrl = process.argv[2];
if (!wsUrl) { console.error('usage: node control-hover.mjs <wsUrl>'); process.exit(2); }

const { evaluate, move, close } = await connect(wsUrl);

try {
  const geo = await evaluate('window.__geo("old")');
  const idxOf = [0, 1, 2, 40, 41, 100, 173, 174];
  await evaluate('window.__reset()');
  const problems = [];
  const hover = async () => (await evaluate('window.__state()')).old.hover;

  // baseline: the legacy card does hover when the pointer is on a cell
  await move(geo.colX[3], geo.rowY);
  const entered = await hover();
  if (entered !== idxOf[3]) problems.push(`legacy hover did not engage: ${entered} !== ${idxOf[3]}`);

  // defect 1: the row margin is a dead area — the column freezes
  await move(geo.colX[4], geo.gapY);
  const afterMargin = await hover();
  const expectedMargin = await evaluate(`window.__expectedAt(${geo.colX[4]}, ${geo.gapY}, "old")`);
  const froze = afterMargin === entered && expectedMargin !== null && expectedMargin !== entered;
  if (!froze) {
    problems.push(`legacy row-margin move no longer freezes (hover ${afterMargin}, entered ${entered}, expected ${expectedMargin})`);
  }

  // defect 2: drifting into the legend clears the hover (plot-level mouseleave)
  await move(geo.colX[5], geo.legendY);
  const afterDrift = await hover();
  if (afterDrift != null) problems.push(`legacy hover survived a drift into the legend (${afterDrift})`);

  // defect 3: re-entering over the row margin leaves no hover at all
  await move(geo.colX[4], geo.gapY);
  const afterReentry = await hover();
  if (afterReentry != null) problems.push(`legacy re-entry over the row margin resolved ${afterReentry} instead of nothing`);

  console.log(JSON.stringify({ entered, afterMargin, expectedMargin, afterDrift, afterReentry }, null, 2));
  verdict(problems, 'the legacy wiring still reproduces all three hover defects — the F202 assertions are not vacuous');
} finally {
  close();
}
