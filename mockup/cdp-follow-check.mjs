// F170: drive the follow harness through CDP and report each state transition.
//   node mockup/cdp-follow-check.mjs <wsUrl>
const wsUrl = process.argv[2];
if (!wsUrl) { console.error('usage: node cdp-follow-check.mjs <wsUrl>'); process.exit(2); }
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await send('Runtime.enable');
  const initial = await evaluate('window.__state()');
  await evaluate('window.__push(3)');
  await sleep(120);
  const afterPush = await evaluate('window.__state()');
  await evaluate('window.__userScroll(-260)');
  await sleep(120);
  const afterScrollUp = await evaluate('window.__state()');
  await evaluate('window.__push(3)');
  await sleep(120);
  const pushWhileAway = await evaluate('window.__state()');
  await evaluate('window.__clickPill()');
  await sleep(600);
  const afterPill = await evaluate('window.__state()');
  console.log(JSON.stringify({ initial, afterPush, afterScrollUp, pushWhileAway, afterPill }, null, 2));
  // --- invariants (regression gate) -------------------------------------
  const problems = [];
  const atEdge = (st) => st.distanceToEdge != null && st.distanceToEdge <= 8;
  if (!initial.follow || !atEdge(initial)) problems.push('opening did not land on the live edge');
  if (!afterPush.follow || !atEdge(afterPush)) problems.push('a new payload did not stay on the live edge');
  if (afterScrollUp.follow) problems.push('scrolling up did not release following');
  if (!afterScrollUp.pillVisible) problems.push('the Latest pill did not appear');
  if (pushWhileAway.scrollTop !== afterScrollUp.scrollTop) problems.push('a payload moved the viewport while the user was reading');
  if (!afterPill.follow || !atEdge(afterPill)) problems.push('the pill did not return to the live edge');
  if (afterPill.pillVisible) problems.push('the pill stayed visible after re-attaching');
  if (problems.length > 0) {
    console.log('FAIL: ' + problems.join(' · '));
    process.exitCode = 1;
  } else {
    console.log('OK: opens at the live edge, follows, releases on scroll-up, pill re-attaches');
  }
} finally {
  ws.close();
}
