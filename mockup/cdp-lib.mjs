// Shared CDP plumbing for the mockup harnesses (F202).
//
// Each script still owns its assertions and its exit code — this only removes the
// repeated socket / Runtime.evaluate / Input.dispatchMouseEvent boilerplate that
// every cdp-*.mjs had grown its own copy of.
export async function connect(wsUrl) {
  if (!wsUrl) throw new Error('usage: <script> <wsUrl>');
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
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
  await send('Runtime.enable');

  const evaluate = async (expression) => {
    const out = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (out.exceptionDetails) {
      throw new Error(JSON.stringify(out.exceptionDetails.exception?.description ?? out.exceptionDetails));
    }
    return out.result?.value;
  };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** One real pointer move; 16 ms so the browser can dispatch it like a hand. */
  const move = async (x, y) => {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'none', pointerType: 'mouse',
    });
    await pause(16);
  };
  return { evaluate, move, close: () => ws.close() };
}

/** Print a PASS/FAIL verdict and set the exit code. */
export function verdict(problems, okText) {
  if (problems.length === 0) {
    console.log('OK: ' + okText);
    return;
  }
  console.log('FAIL: ' + problems.join(' · '));
  process.exitCode = 1;
}
