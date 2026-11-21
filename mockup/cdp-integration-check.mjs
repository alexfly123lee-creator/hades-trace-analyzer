// F175..F180 integration check: drives the REAL shipped focus path.
// Phases: open → hover (fixed line) → hover off-line → wheel ignored → ticks →
// click + detail growth + pointer leaves (list must not move by itself).
//   node mockup/cdp-integration-check.mjs <wsUrl>
const wsUrl = process.argv[2];
if (!wsUrl) { console.error('usage: node cdp-integration-check.mjs <wsUrl>'); process.exit(2); }
const ws = new WebSocket(wsUrl);
let seq = 0;
const pending = new Map();
const send = (method, params) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (!msg.id || !pending.has(msg.id)) return;
  const { resolve, reject } = pending.get(msg.id);
  pending.delete(msg.id);
  if (msg.error) reject(new Error(JSON.stringify(msg.error)));
  else resolve(msg.result);
});
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});
const evaluate = async (expression) => {
  const out = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (out.exceptionDetails) throw new Error(JSON.stringify(out.exceptionDetails.exception?.description ?? out.exceptionDetails));
  return out.result?.value;
};
const wheel = async (x, y, deltaY) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, pointerType: 'mouse' });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await send('Runtime.enable');
  const geo = await evaluate(`(() => {
    const a = document.getElementById('host').shadowRoot.querySelector('[data-matrix]').getBoundingClientRect();
    return { x: Math.round(a.left + a.width / 2), y: Math.round(a.top + a.height / 2) };
  })()`);

  const opened = await evaluate('window.__state()');

  // 1) hovering a far column glides the list so the row lands on the focus line
  await evaluate('window.__hover(120)');
  await sleep(90);
  const midFlight = await evaluate('window.__state()');
  await sleep(420);
  const settled = await evaluate('window.__state()');

  // 2) hovering a row that is off the focus line must scroll it onto the line
  const offLine = await evaluate('window.__runAtPct(75)');
  const beforeBand = await evaluate('window.__state()');
  await evaluate(`window.__hover(${offLine})`);
  await sleep(420);
  const afterBand = await evaluate('window.__state()');

  // 3) the wheel no longer touches the focus
  await wheel(geo.x, geo.y, 120);
  await wheel(geo.x, geo.y, 120);
  await sleep(220);
  const afterWheel = await evaluate('window.__state()');

  // 4) realtime ticks must not snap the focus away
  await evaluate('window.__tick()');
  await sleep(140);
  await evaluate('window.__tick()');
  await sleep(200);
  const afterTicks = await evaluate('window.__state()');

  // 5) F180: click (open) → the detail grows → the pointer leaves the matrix.
  const beforeClick = await evaluate('window.__state()');
  await evaluate(`window.__click(${afterTicks.focus})`);
  await sleep(200);
  const afterClick = await evaluate('window.__state()');
  await evaluate(`window.__grow(${afterTicks.focus}, 240)`);
  await sleep(260);
  const afterGrow = await evaluate('window.__state()');
  // F181: re-hovering the SAME column must not drag the located row off the top.
  await evaluate(`window.__hover(${afterTicks.focus})`);
  await sleep(300);
  const afterRehover = await evaluate('window.__state()');
  // F183: hovering a DIFFERENT column right after the click must only highlight —
  // this is the "row slides back to the middle" bug the scroll log exposed.
  const otherColumn = afterTicks.focus - 7;
  await evaluate(`window.__hover(${otherColumn})`);
  await sleep(360);
  const afterOtherColumn = await evaluate('window.__state()');
  await evaluate('window.__leave()');
  await sleep(260);
  const afterLeave = await evaluate('window.__state()');

  const trace = await evaluate('window.__trace()');

  console.log(JSON.stringify({
    opened, midFlight, settled, offLine, beforeBand, afterBand,
    afterWheel, afterTicks, beforeClick, afterClick, afterGrow, afterLeave,
  }, null, 2));

  const problems = [];
  const onLine = (st) => st.focusPct != null && Math.abs(st.focusPct - 34) <= 6;

  if (!opened.follow) problems.push('the panel did not open following the live edge');
  if (settled.focus !== 120) problems.push(`hovering did not focus Run 120 (got ${settled.focus})`);
  if (!settled.dim) problems.push('hovering did not dim the list');
  if (settled.focusedRows !== 1) problems.push(`${settled.focusedRows} rows highlighted, expected 1`);
  if (!onLine(settled)) problems.push(`the focused row parked at ${settled.focusPct}%, expected the 34% focus line`);
  if (midFlight.scrollTop === settled.scrollTop) problems.push('the glide finished instantly (not slowed down)');
  if (!onLine(afterBand)) problems.push(`after hovering off the line it parked at ${afterBand.focusPct}%, expected ~34%`);
  if (afterBand.scrollTop === beforeBand.scrollTop) problems.push('hovering a row off the line did not scroll the list');
  if (afterWheel.focus !== afterBand.focus) problems.push(`the wheel moved the focus ${afterBand.focus} → ${afterWheel.focus}`);
  if (afterWheel.scrollTop !== afterBand.scrollTop) problems.push('the wheel scrolled the list');
  if (afterTicks.focus !== afterBand.focus) problems.push(`a realtime tick moved the focus ${afterBand.focus} → ${afterTicks.focus}`);
  if (afterTicks.focusedRows !== 1) problems.push(`${afterTicks.focusedRows} rows highlighted after ticks, expected 1`);
  if (afterClick.scrollTop === beforeClick.scrollTop) problems.push('clicking did not scroll the opened row into place');
  if (afterGrow.scrollTop !== afterClick.scrollTop) {
    problems.push(`the detail growing above the viewport moved the list (${afterClick.scrollTop} → ${afterGrow.scrollTop})`);
  }
  if (afterLeave.scrollTop !== afterGrow.scrollTop) {
    problems.push(`leaving the matrix moved the list (${afterGrow.scrollTop} → ${afterLeave.scrollTop})`);
  }
  // F181: the clicked Run must stay where the click put it.
  if (afterRehover.scrollTop !== afterClick.scrollTop) {
    problems.push(`re-hovering the clicked column moved the list (${afterClick.scrollTop} → ${afterRehover.scrollTop})`);
  }
  // F183: crossing another column after the click must not scroll either.
  if (afterOtherColumn.scrollTop !== afterClick.scrollTop) {
    problems.push(`hovering another column after the click moved the list (${afterClick.scrollTop} → ${afterOtherColumn.scrollTop})`);
  }
  if (afterOtherColumn.focus !== otherColumn) {
    problems.push(`the highlight did not follow the pointer after the click (focus ${afterOtherColumn.focus})`);
  }

  if (problems.length > 0) {
    console.log('FAIL: ' + problems.join(' · '));
    console.log('trace tail:', JSON.stringify(trace.slice(-6)));
    process.exitCode = 1;
  } else {
    console.log('OK: fixed focus line, wheel ignored, ticks stable, click/grow/leave do not move the list');
  }
} finally {
  ws.close();
}
