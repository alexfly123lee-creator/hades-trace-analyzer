import test from 'node:test';
import assert from 'node:assert/strict';
import { actorOf, buildTraceTree } from '../lib/trace.js';
import { stepTitle } from '../lib/titles.js';
import {
  aggregateTokens,
  pairToolCalls,
  buildRunsPayload,
  buildRunsPayloadFrom,
  buildRunDetail,
  buildStepContent,
  slimToolPairs,
} from '../lib/project.js';

test('aggregateTokens sums usage across turns', () => {
  const events = [
    { type: 'assistant/message', seq: 1, time: 1, data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 2 } } },
    { type: 'assistant/message', seq: 2, time: 2, data: { turn: 2, step: 1, usage: { inputTokens: 20, outputTokens: 7, cacheReadTokens: 3 } } },
  ];
  const { total, byTurn } = aggregateTokens(events);
  assert.equal(total.input, 30);
  assert.equal(total.output, 12);
  assert.equal(total.reasoning, 2);
  assert.equal(total.cacheRead, 3);
  assert.equal(total.cacheWrite, 0);
  assert.equal(byTurn.length, 2);
});

test('aggregateTokens ignores events without usage', () => {
  const { total, byTurn } = aggregateTokens([{ type: 'user/message', seq: 1, time: 1, data: {} }]);
  assert.deepEqual(total, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 });
  assert.deepEqual(byTurn, []);
});

test('pairToolCalls pairs by callId and computes duration', () => {
  const events = [
    { type: 'tool/call', seq: 1, time: 3, data: { callId: 'c1', name: 'read', arguments: '{}' } },
    { type: 'tool/result', seq: 2, time: 8, data: { message: { source: { callId: 'c1' } } } },
    { type: 'tool/call', seq: 3, time: 10, data: { callId: 'c2', name: 'write', arguments: '{}' } },
  ];
  const pairs = pairToolCalls(events);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].durationMs, 5);
  assert.equal(pairs[1].durationMs, null);
});

test('buildTraceTree groups by real user prompt (system prompt = run 0)', () => {
  const events = [
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
    { type: 'step/start', seq: 2, time: 2, data: { turn: 1, step: 1 } },
    { type: 'system/message', seq: 3, time: 3, data: { message: { content: [{ type: 'text', text: 'You are an AI' }] } } },
    { type: 'user/message', seq: 4, time: 4, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我读文件' }] } },
    { type: 'user/message', seq: 5, time: 5, data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'ctx' }] } },
    { type: 'request/header', seq: 6, time: 6, data: { header: { config: { provider: 'deepseek', model: 'v4' } } } },
    { type: 'assistant/message', seq: 7, time: 7, data: { usage: { inputTokens: 10, outputTokens: 5 } } },
  ];
  const runs = buildTraceTree(events);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].isSystemPrompt, true);
  assert.equal(runs[0].prompt, null);
  assert.equal(runs[1].isSystemPrompt, false);
  assert.equal(runs[1].prompt, '帮我读文件');
  assert.equal(runs[0].steps.length, 1);
  assert.equal(runs[0].steps[0].events.length, 1); // system/message
  assert.equal(runs[1].steps[0].events.length, 3); // ctx user/message, request/header, assistant/message
});

test('buildTraceTree ignores non-user context injections as new runs', () => {
  const events = [
    { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] } },
    { type: 'user/message', seq: 2, time: 2, data: { source: { kind: 'time-context' }, content: [{ type: 'text', text: 'time' }] } },
    { type: 'assistant/message', seq: 3, time: 3, data: { usage: {} } },
  ];
  const runs = buildTraceTree(events);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].prompt, 'hi');
});

test('buildTraceTree tolerates empty input', () => {
  assert.deepEqual(buildTraceTree([]), []);
});

test('buildTraceTree groups steps by data.step, honours step markers, renumbers sequentially', () => {
  const events = [
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
    { type: 'step/start', seq: 2, time: 2, data: { turn: 1, step: 1 } },
    { type: 'system/message', seq: 3, time: 3, data: { message: { content: [{ type: 'text', text: 'sys' }] } } },
    { type: 'user/message', seq: 4, time: 4, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'prompt' }] } },
    { type: 'request/header', seq: 5, time: 5, data: { header: { config: { provider: 'x', model: 'y' } } } },
    { type: 'assistant/message', seq: 6, time: 6, data: { step: 1, usage: {} } },
    { type: 'tool/call', seq: 7, time: 7, data: { step: 1, callId: 'c1', name: 'read' } },
    { type: 'step/end', seq: 8, time: 8, data: { turn: 1, step: 1 } },
    { type: 'step/start', seq: 9, time: 9, data: { turn: 1, step: 2 } },
    { type: 'assistant/message', seq: 10, time: 10, data: { step: 2, usage: {} } },
    // next turn: step/start(step 1) precedes the next user message (must NOT append to run 1)
    { type: 'turn/end', seq: 11, time: 11, data: { turn: 1 } },
    { type: 'turn/start', seq: 12, time: 12, data: { turn: 2 } },
    { type: 'step/start', seq: 13, time: 13, data: { turn: 2, step: 1 } },
    { type: 'user/message', seq: 14, time: 14, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'prompt2' }] } },
    { type: 'assistant/message', seq: 15, time: 15, data: { step: 1, usage: {} } },
  ];
  const runs = buildTraceTree(events);
  assert.equal(runs.length, 3); // system, user1, user2
  const r1 = runs[1];
  assert.deepEqual(r1.steps.map((s) => s.step), [1, 2]); // renumbered, no empty step from turn 2\n  assert.equal(r1.steps[0].startTime, 2); // step/start marker (seq 2)\n  assert.equal(r1.steps[0].endTime, 8);   // step/end marker (seq 8), not the last leaf time
  assert.equal(r1.steps[0].events.length, 3); // request/header + assistant + tool
  assert.equal(r1.steps[1].events.length, 1); // assistant
  assert.deepEqual(runs[2].steps.map((s) => s.step), [1]);
});

// ---- M6 phase-split projections (SPEC §15, TEST U15–U18) ----

const phaseEvents = () => [
  { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
  { type: 'step/start', seq: 2, time: 2, data: { turn: 1, step: 1 } },
  { type: 'system/message', seq: 3, time: 3, data: { message: { content: [{ type: 'text', text: 'sys' }] } } },
  { type: 'user/message', seq: 4, time: 4, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '读文件' }] } },
  { type: 'request/header', seq: 5, time: 5, data: { header: { config: { provider: 'p', model: 'm' } } } },
  { type: 'assistant/message', seq: 6, time: 6, data: { step: 1, usage: { inputTokens: 10, outputTokens: 5 }, stream: [{ texts: ['x'.repeat(4096)] }] } },
  { type: 'tool/call', seq: 7, time: 7, data: { step: 1, callId: 'c1', name: 'read' } },
  { type: 'tool/result', seq: 8, time: 20, data: { step: 1, message: { source: { callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] }, error: { code: 'E_TIMEOUT' } } },
  { type: 'step/end', seq: 9, time: 21, data: { turn: 1, step: 1 } },
  { type: 'user/message', seq: 10, time: 30, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '再来' }] } },
  { type: 'assistant/message', seq: 11, time: 31, data: { step: 1, usage: { inputTokens: 2, outputTokens: 3 } } },
];

test('buildRunsPayload ships no raw events and stays small', () => {
  const { payload } = buildRunsPayload(phaseEvents(), { slowMs: 5000 });
  const text = JSON.stringify(payload);
  assert.equal('events' in payload, false);
  assert.equal(text.includes('"stream"'), false);
  assert.ok(text.length < 8192, `payload too large: ${text.length}`);
  assert.equal(payload.counts.events, 11);
  assert.equal(payload.counts.runs, 3);
  assert.equal(payload.counts.steps, 3);
});

test('buildRunsPayload numbers match the full-snapshot baseline', () => {
  const events = phaseEvents();
  const { payload } = buildRunsPayload(events, { slowMs: 5000 });
  const tree = buildTraceTree(events);
  const tokens = aggregateTokens(events);
  const pairs = slimToolPairs(pairToolCalls(events));

  const baselineSlow = pairs.filter((p) => typeof p.durationMs === 'number' && p.durationMs > 5000).length;
  const baselineErrors = pairs.filter((p) => p.error != null).length;
  assert.equal(payload.tokens.total.input, tokens.total.input);
  assert.equal(payload.tokens.total.output, tokens.total.output);
  assert.equal(payload.kpi.errors, baselineErrors);
  assert.equal(payload.kpi.slow, baselineSlow);
  assert.equal(payload.runs.length, tree.length);
  assert.equal(payload.runs.reduce((a, r) => a + r.stepCount, 0), tree.reduce((a, r) => a + r.steps.length, 0));

  const run1 = payload.runs[1];
  assert.equal(run1.prompt, '读文件');
  assert.equal(run1.token, 15); // assistant usage of run 1
  assert.equal(run1.hasError, true); // tool/result carries error
  assert.equal(run1.hasSlow, false);
  // F133: run time = Σ step(model + tool), waiting excluded. Step window is
  // step/start 2 .. assistant/message 6 → model 4ms, tool 20−7 = 13ms → 17ms.
  assert.equal(run1.time, 17);
  assert.equal(payload.kpi.abnormal, 1);
  assert.equal(payload.kpi.slowest.name, 'read');
  assert.equal(payload.kpi.slowest.durationMs, 13);
});

// ---- F150: "slow" means work, never "the human took 10 minutes to answer" ----

const waitEvents = () => [
  { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
  { type: 'step/start', seq: 2, time: 2, data: { turn: 1, step: 1 } },
  { type: 'user/message', seq: 3, time: 3, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '问我' }] } },
  { type: 'assistant/message', seq: 4, time: 5, data: { step: 1, usage: { inputTokens: 1, outputTokens: 1 } } },
  { type: 'tool/call', seq: 5, time: 6, data: { step: 1, callId: 'a', name: 'ask_user_question' } },
  { type: 'tool/result', seq: 6, time: 600006, data: { step: 1, message: { source: { callId: 'a' }, content: [{ type: 'text', text: 'ok' }] } } },
  { type: 'tool/call', seq: 7, time: 600007, data: { step: 1, callId: 'b', name: 'pwsh' } },
  { type: 'tool/result', seq: 8, time: 660007, data: { step: 1, message: { source: { callId: 'b' }, content: [{ type: 'text', text: 'ok' }] } } },
  { type: 'step/end', seq: 9, time: 660008, data: { turn: 1, step: 1 } },
];

test('F150 kpi.slow / slowest ignore human-waiting tools', () => {
  const events = waitEvents();
  const { payload } = buildRunsPayload(events, { slowMs: 5000 });
  // A 10-minute ask_user_question is a human pause: it must not be reported as
  // the slowest *operation* (that misleads "where is the bottleneck?").
  assert.equal(payload.kpi.slowest.name, 'pwsh');
  assert.equal(payload.kpi.slowest.durationMs, 60000);
  assert.equal(payload.kpi.slow, 1);
  assert.equal(payload.runs[1].hasSlow, true);

  // ...and the pause is still surfaced separately as waiting.
  const tree = buildTraceTree(events);
  const tools = slimToolPairs(pairToolCalls(events));
  const detail = buildRunDetail(tree, tools, 1);
  assert.equal(detail.steps[0].waitMs, 600000);
  assert.equal(detail.steps[0].toolMs, 60000);
});

test('buildRunDetail returns the run step index without event or tool rows', () => {  const events = phaseEvents();
  const tree = buildTraceTree(events);
  const tools = slimToolPairs(pairToolCalls(events));
  const detail = buildRunDetail(tree, tools, 1, { serverMs: 1 });

  assert.equal(detail.idx, 1);
  assert.equal(detail.prompt, '读文件');
  assert.equal(detail.steps.length, 1);
  assert.equal(detail.steps[0].step, 1);
  assert.equal(detail.steps[0].token, 15);
  assert.equal(detail.steps[0].hasError, true);
  assert.equal('events' in detail.steps[0], false); // step content moves to /step
  assert.equal('tools' in detail, false);
  const text = JSON.stringify(detail);
  assert.equal(text.includes('"stream"'), false);
  assert.equal(text.includes('"arguments"'), false);
  assert.equal(text.includes('"result"'), false);
});

test('buildRunDetail returns null for an out-of-range index', () => {
  const events = phaseEvents();
  const tree = buildTraceTree(events);
  const tools = slimToolPairs(pairToolCalls(events));
  assert.equal(buildRunDetail(tree, tools, 99), null);
  assert.equal(buildRunDetail([], [], 0), null);
});

test('buildRunsPayloadFrom is re-projectable from a cached tree', () => {
  const { tree, tokens, tools } = buildRunsPayload(phaseEvents());
  const payload = buildRunsPayloadFrom(tree, tokens, tools, { eventCount: 11, sessionId: 's1' });
  assert.equal(payload.meta.sessionId, 's1');
  assert.equal(payload.counts.events, 11);
  assert.equal(payload.runs.length, 3);
  assert.equal(payload.kpi.abnormal, 1);
});

// ---- realtime (SPEC F140): the payload carries the log offset the client polls with ----

// ---- token slices on the step rows (SPEC F142) ----

test('a run detail carries every step token, and the steps add up to the run total', () => {
  const events = [
    { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] } },
  ];
  for (let step = 1; step <= 5; step += 1) {
    const seq = step * 3 + 1;
    events.push({ type: 'step/start', seq, time: seq, data: { turn: 1, step } });
    events.push({
      type: 'assistant/message',
      seq: seq + 1,
      time: seq + 1,
      data: { turn: 1, step, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }, usage: { inputTokens: step * 100, outputTokens: step * 10 } },
    });
    events.push({ type: 'step/end', seq: seq + 2, time: seq + 2, data: { turn: 1, step } });
  }
  const built = buildRunsPayload(events, { eventCount: events.length });
  const payload = buildRunsPayloadFrom(built.tree, built.tokens, built.tools, { eventCount: events.length });
  const detail = buildRunDetail(built.tree, built.tools, 0);
  const stepTokens = detail.steps.map((step) => step.token);
  // The step rows draw their tracks as the run total, so this invariant is what
  // keeps the cumulative slices meaningful.
  assert.deepEqual(stepTokens, [110, 220, 330, 440, 550]);
  assert.equal(stepTokens.reduce((a, b) => a + b, 0), payload.runs[0].token);
  // Cum-slices are monotone and end exactly at the total.
  let acc = 0;
  const cums = stepTokens.map((token) => { acc += token; return acc; });
  assert.deepEqual(cums, [110, 330, 660, 1100, 1650]);
  assert.equal(cums[cums.length - 1], payload.runs[0].token);
});
test('buildRunsPayloadFrom reports the log offset it was built at', () => {
  const { tree, tokens, tools } = buildRunsPayload(phaseEvents());
  const withSeq = buildRunsPayloadFrom(tree, tokens, tools, { eventCount: 11, sessionId: 's1', seq: 4242 });
  assert.equal(withSeq.meta.seq, 4242);
  // Without an offset the field is present but null, so the client never polls
  // with a bogus `since` (it would otherwise hit the `unchanged` shortcut).
  const withoutSeq = buildRunsPayloadFrom(tree, tokens, tools, { eventCount: 11, sessionId: 's1' });
  assert.equal(withoutSeq.meta.seq, null);
});

// ---- step captions + selected-step UI data (SPEC F128) ----

const captionEvents = () => [
  { type: 'system/message', seq: 1, time: 1, data: { step: 1, message: { role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'sys prompt' }] } } },
  { type: 'developer/message', seq: 2, time: 2, data: { step: 1, message: { role: 'developer', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'dev ' + 'y'.repeat(400) }] } } },
  { type: 'user/message', seq: 3, time: 3, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我看一下 ' + 'x'.repeat(400) }] } },
  { type: 'assistant/message', seq: 4, time: 4, data: { step: 1, usage: { inputTokens: 1, outputTokens: 1 }, message: { role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: '  我先读文件\n然后分析  ' }] } } },
  { type: 'tool/call', seq: 5, time: 5, data: { step: 2, callId: 'c1', name: 'read', arguments: '{"path":"src/a.ts"}' } },
  { type: 'tool/result', seq: 6, time: 7, data: { step: 2, message: { source: { callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] } } },
  { type: 'assistant/message', seq: 7, time: 8, data: { step: 3, usage: { inputTokens: 2, outputTokens: 2 }, message: { role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: 'done' }] } } },
];

test('buildTraceTree keeps a bounded text on message leaves only', () => {
  const tree = buildTraceTree(captionEvents());
  const leaves = tree.flatMap((run) => run.steps.flatMap((step) => step.events));
  const byType = (type) => leaves.find((leaf) => leaf.type === type);
  assert.equal(byType('system/message').text, 'sys prompt');
  assert.equal(byType('assistant/message').text, '我先读文件 然后分析'); // whitespace collapsed
  assert.equal(byType('tool/call').text, undefined);
  assert.equal(byType('tool/result').text, undefined);
  // A real user message opens a run, so it is never a leaf row.
  assert.equal(byType('user/message'), undefined);
  const developer = byType('developer/message');
  assert.equal(developer.text.endsWith('…'), true);
  assert.equal(developer.text.length, 401); // 400 chars + ellipsis
});

test('buildRunDetail gives each step a one-line caption', () => {
  const events = captionEvents();
  const tree = buildTraceTree(events);
  const tools = slimToolPairs(pairToolCalls(events));
  const detail = buildRunDetail(tree, tools, 1); // run 1 = the user prompt run
  const [step1, step2, step3] = detail.steps;

  assert.equal(step1.text, '我先读文件 然后分析'); // assistant text wins over the user prompt
  assert.equal(step2.text, 'tool · read · src/a.ts'); // tool-only step: name + argument preview
  assert.equal(step3.text, 'done');
  // Step time = model + tool (SPEC F133), waiting excluded.
  assert.equal(step1.timeMs, 0); // assistant leaf only, no tool
  assert.equal(step2.timeMs, 2); // tool-only step: the read call's own duration
  assert.equal(step2.modelMs, null); // no assistant message → no model segment
  assert.equal(step1.token, 2);
  assert.equal(step2.token, 0);

  // Step rows carry metadata only; content is fetched per step.
  assert.equal(detail.steps.some((step) => 'events' in step), false);
  assert.equal(detail.steps.some((step) => 'tools' in step), false);
});

test('buildRunDetail caption is null when a step has neither text nor tools', () => {
  const events = [
    { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] } },
    { type: 'request/header', seq: 2, time: 2, data: { step: 1, header: { config: { provider: 'p', model: 'm' } } } },
  ];
  const tree = buildTraceTree(events);
  const detail = buildRunDetail(tree, [], 0); // the user message opens run 0 here
  assert.equal(detail.steps.length, 1);
  assert.equal(detail.steps[0].text, null);
});

// ---- step content panel data (SPEC F129) ----

test('buildStepContent projects an ordered activity trace without nesting', () => {
  const events = captionEvents();
  const tree = buildTraceTree(events);
  const tools = slimToolPairs(pairToolCalls(events));

  const textual = buildStepContent(tree, tools, 1, 0); // run 1 / step 1: assistant text + usage
  assert.equal(textual.step, 1);
  assert.equal(textual.operations.length, 1);
  assert.equal(textual.operations[0].kind, 'assistant');
  assert.equal(textual.operations[0].text, '我先读文件 然后分析');
  assert.deepEqual(textual.operations[0].usage, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 });
  assert.deepEqual(textual.counts, { models: 1, tools: 0, contexts: 0 });
  assert.deepEqual(textual.usage, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 });
  assert.equal(textual.timeMs, 0);

  const toolStep = buildStepContent(tree, tools, 1, 1); // run 1 / step 2: one tool call
  assert.equal(toolStep.operations.length, 1);
  const tool = toolStep.operations[0];
  assert.equal(tool.kind, 'tool');
  assert.equal(tool.name, 'read');
  assert.equal(tool.args, '{"path":"src/a.ts"}');
  assert.equal(tool.result, 'ok');
  assert.equal(tool.isError, false);
  assert.equal(tool.error, null);
  assert.equal(tool.durationMs, 2);
  assert.deepEqual(toolStep.counts, { models: 0, tools: 1, contexts: 0 });
});

test('buildStepContent folds tool results into their call row', () => {
  const events = captionEvents();
  const tree = buildTraceTree(events);
  const tools = slimToolPairs(pairToolCalls(events));
  const content = buildStepContent(tree, tools, 1, 1);
  // The step holds tool/call (seq 5) and tool/result (seq 6): one row, not two.
  assert.deepEqual(content.operations.map((op) => op.kind), ['tool']);
  assert.equal(content.operations[0].callSeq, 5);
  assert.equal(content.operations[0].resultSeq, 6);
});

test('buildStepContent carries the model and the tool error', () => {
  const events = phaseEvents();
  const tree = buildTraceTree(events);
  const tools = slimToolPairs(pairToolCalls(events));
  const content = buildStepContent(tree, tools, 1, 0); // phaseEvents run 1 step 1 holds request/header + tool error

  assert.deepEqual(content.model, { provider: 'p', model: 'm' });
  assert.equal(content.counts.tools, 1);
  assert.equal(content.operations.find((op) => op.kind === 'tool').error, 'E_TIMEOUT');
  assert.equal(content.usage.input, 10);
  assert.equal(content.usage.output, 5);
});

test('buildStepContent falls back to the last known model of an earlier run', () => {
  const events = [
    { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] } },
    { type: 'request/header', seq: 2, time: 2, data: { step: 1, header: { config: { provider: 'p', model: 'm' } } } },
    { type: 'assistant/message', seq: 3, time: 3, data: { step: 1, usage: { inputTokens: 1, outputTokens: 1 }, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } } },
    { type: 'user/message', seq: 4, time: 10, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] } },
    { type: 'assistant/message', seq: 5, time: 11, data: { step: 1, usage: { inputTokens: 2, outputTokens: 2 }, message: { role: 'assistant', content: [{ type: 'text', text: 'again' }] } } },
  ];
  const tree = buildTraceTree(events);
  const content = buildStepContent(tree, [], 1, 0); // second run has no header of its own
  assert.deepEqual(content.model, { provider: 'p', model: 'm' });
});

test('buildStepContent returns null for out-of-range run or step', () => {
  const tree = buildTraceTree(captionEvents());
  const tools = slimToolPairs(pairToolCalls(captionEvents()));
  assert.equal(buildStepContent(tree, tools, 99, 0), null);
  assert.equal(buildStepContent(tree, tools, 1, 99), null);
});

test('tree leaves keep usage, tool args/result text and the model for the panel', () => {
  const tree = buildTraceTree(phaseEvents());
  const leaves = tree.flatMap((run) => run.steps.flatMap((step) => step.events));
  const assistant = leaves.find((leaf) => leaf.type === 'assistant/message' && leaf.usage != null);
  assert.deepEqual(assistant.usage, { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0 });

  const call = leaves.find((leaf) => leaf.type === 'tool/call');
  assert.equal(call.toolName, 'read');
  assert.equal(call.argsText, ''); // phaseEvents has no arguments

  const result = leaves.find((leaf) => leaf.type === 'tool/result');
  assert.equal(result.resultText, 'ok');
  assert.equal(result.isError, false);

  const header = leaves.find((leaf) => leaf.type === 'request/header');
  assert.equal(header.provider, 'p');
  assert.equal(header.model, 'm');
});

// ---- role tags (SPEC F131) ----

test('actorOf maps every event type to its trajectory kind', () => {
  assert.equal(actorOf({ type: 'user/message', data: { source: { kind: 'user' } } }), 'user');
  assert.equal(actorOf({ type: 'user/message', data: { source: { kind: 'runtime-context' } } }), 'context');
  assert.equal(actorOf({ type: 'user/message', data: { source: { kind: 'skill-catalog' } } }), 'context');
  assert.equal(actorOf({ type: 'developer/message', data: {} }), 'context');
  assert.equal(actorOf({ type: 'system/message', data: {} }), 'system');
  assert.equal(actorOf({ type: 'assistant/message', data: {} }), 'assistant');
  assert.equal(actorOf({ type: 'request/header', data: {} }), 'assistant');
  assert.equal(actorOf({ type: 'request/context', data: {} }), 'assistant');
  assert.equal(actorOf({ type: 'tool/call', data: {} }), 'tool');
  assert.equal(actorOf({ type: 'tool/result', data: {} }), 'tool');
});

test('runs carry their actor while steps no longer do', () => {
  const events = captionEvents();
  const tree = buildTraceTree(events);
  const tools = slimToolPairs(pairToolCalls(events));
  const { payload } = buildRunsPayload(events);
  assert.equal(payload.runs[0].actor, 'system'); // run 0 = system prompt
  assert.equal(payload.runs[1].actor, 'user');

  const detail = buildRunDetail(tree, tools, 1);
  assert.equal(detail.actor, 'user');
  // Roles live on the step's detail rows, never on the step row itself.
  assert.equal(detail.steps.some((step) => 'actor' in step), false);

  const toolStep = buildStepContent(tree, tools, 1, 1);
  assert.deepEqual(toolStep.operations.map((op) => op.kind), ['tool']);

  const textual = buildStepContent(tree, tools, 1, 0);
  assert.deepEqual(textual.operations.map((op) => op.kind), ['assistant']);
});

test('runtime-injected text appears as a context operation', () => {
  const events = [
    { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'ask' }] } },
    { type: 'user/message', seq: 2, time: 2, data: { step: 1, source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: 'catalog' }] } },
  ];
  const tree = buildTraceTree(events);
  const content = buildStepContent(tree, [], 0, 0); // the user prompt opens run 0 here
  assert.deepEqual(content.operations.map((op) => op.kind), ['context']);
  assert.equal(content.operations[0].text, 'catalog');
  assert.deepEqual(content.counts, { models: 0, tools: 0, contexts: 1 });
});

test('step operations keep event order and count injections next to the narrative', () => {
  const events = [
    { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'ask' }] } },
    { type: 'user/message', seq: 2, time: 2, data: { step: 1, source: { kind: 'time-context' }, content: [{ type: 'text', text: 'now is 12:00' }] } },
    { type: 'assistant/message', seq: 3, time: 3, data: { step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'sure' }] } } },
  ];
  const tree = buildTraceTree(events);
  const content = buildStepContent(tree, [], 0, 0);
  assert.deepEqual(content.operations.map((op) => op.kind), ['context', 'assistant']);
  assert.equal(content.operations[0].text, 'now is 12:00');
  assert.equal(content.operations[1].text, 'sure');
  assert.deepEqual(content.counts, { models: 1, tools: 0, contexts: 1 });
});

// ---- step row titles (SPEC F23.1) and explanation rows (F23.2) ----

const titleEvents = (steps) => [
  { type: 'user/message', seq: 1, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] } },
  ...steps,
];

const detailOf = (events) => {
  const tree = buildTraceTree(events);
  const tools = slimToolPairs(pairToolCalls(events));
  return buildRunDetail(tree, tools, 0);
};

const call = (seq, step, name, args) => [
  { type: 'tool/call', seq, time: seq, data: { step, callId: 'c' + seq, name, arguments: JSON.stringify(args) } },
  { type: 'tool/result', seq: seq + 1, time: seq + 1, data: { step, message: { source: { callId: 'c' + seq }, content: [{ type: 'text', text: 'ok' }] } } },
];

test('step title: a tool-only step reads as verb + object, from the full arguments', () => {
  const events = titleEvents([
    ...call(2, 1, 'read', { file_path: 'E:/w/src/a.ts', offset: 20 }),
    // `argsText` is truncated to 400 chars, which would break JSON.parse: the
    // title must be derived before truncation.
    ...call(4, 2, 'edit', { file_path: 'E:/w/src/b.ts', old_string: 'x'.repeat(600), new_string: 'y' }),
    ...call(6, 3, 'pwsh', { command: 'node --test', description: 'Run unit tests' }),
    ...call(8, 4, 'mystery', {}),
  ]);
  const steps = detailOf(events).steps;
  assert.deepEqual(steps.map((step) => step.title), ['读取 a.ts:20', '修改 b.ts', '运行 · Run unit tests', 'tool · mystery']);
  assert.equal(steps.every((step) => step.marks === undefined), true);
  // The raw caption is still shipped for the row tooltip.
  assert.equal(steps[0].text, 'tool · read · E:/w/src/a.ts');
});

test('step title: the merged verb table keeps exit_plan_mode / load_workspace_dependencies', () => {
  // `TOOL_VERB` and `CALL_VERB` used to disagree on exactly these two tools
  // (`计划`/`取环境` vs `提交计划`/`取运行环境`); the switch returned the title
  // literal, so the observable wording was the chip-table one. One table must
  // still produce that same title *and* chip.
  const titleOf = (events) => stepTitle(buildTraceTree(events)[0].steps[0]);

  const plan = titleOf(titleEvents([...call(2, 1, 'exit_plan_mode', {})]));
  assert.equal(plan.title, '提交计划');
  assert.deepEqual(plan.tags, [{ tag: '提交计划', count: 1 }]);
  assert.equal(plan.tag, '提交计划');

  const deps = titleOf(titleEvents([...call(2, 1, 'load_workspace_dependencies', {})]));
  assert.equal(deps.title, '取运行环境');
  assert.deepEqual(deps.tags, [{ tag: '取运行环境', count: 1 }]);
  assert.equal(deps.tag, '取运行环境');

  // Repeated calls fold into one chip instead of splitting into two names.
  const repeated = titleOf(titleEvents([
    ...call(2, 1, 'load_workspace_dependencies', {}),
    ...call(4, 1, 'load_workspace_dependencies', {}),
    ...call(6, 1, 'read', { file_path: 'E:/w/a.ts' }),
  ]));
  assert.equal(repeated.title, '取运行环境');
  assert.deepEqual(repeated.tags, [{ tag: '取运行环境', count: 2 }, { tag: '读取', count: 1 }]);
});

test('step title: a model sentence leads and the actions become chips', () => {
  const events = titleEvents([
    { type: 'assistant/message', seq: 2, time: 2, data: { step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '先读两处实现（含长括号（不该被切断）。后面还有正文。' }] } } },
    ...call(3, 1, 'read', { file_path: 'E:/a.ts' }),
    ...call(5, 1, 'read', { file_path: 'E:/b.ts' }),
  ]);
  const [step] = detailOf(events).steps;
  assert.equal(step.title, '先读两处实现（含长括号（不该被切断）。');
  // F137: the actions are chips now, not a text suffix.
  assert.deepEqual(step.tags, [{ tag: '回复', count: 1 }, { tag: '读取', count: 2 }]);
  assert.equal(step.suffix, undefined);
});

test('step title: several tool calls build one chip per distinct action', () => {
  const events = titleEvents([
    ...call(2, 1, 'edit', { file_path: 'E:/w/DESIGN.md' }),
    ...call(4, 1, 'pwsh', { command: 'x', description: 'y' }),
    ...call(6, 1, 'edit', { file_path: 'E:/w/SPEC.md' }),
  ]);
  const [step] = detailOf(events).steps;
  assert.equal(step.title, '修改 DESIGN.md');
  // First call names the object and leads; the repeats fold into its count.
  assert.deepEqual(step.tags, [{ tag: '修改', count: 2 }, { tag: '运行', count: 1 }]);
  assert.equal(step.tag, '修改');
  assert.equal(step.suffix, undefined);
});

test('step title: repeated calls of one action stay a single chip', () => {
  const events = titleEvents([
    ...call(2, 1, 'edit', { file_path: 'E:/w/a.js' }),
    ...call(4, 1, 'edit', { file_path: 'E:/w/b.js' }),
    ...call(6, 1, 'edit', { file_path: 'E:/w/c.js' }),
    ...call(8, 1, 'edit', { file_path: 'E:/w/d.js' }),
  ]);
  const [step] = detailOf(events).steps;
  assert.deepEqual(step.tags, [{ tag: '修改', count: 4 }]);
  assert.equal(step.suffix, undefined);
});

test('step title: a fourth distinct action folds into an overflow chip', () => {
  const events = titleEvents([
    ...call(2, 1, 'read', { file_path: 'E:/w/a.js' }),
    ...call(4, 1, 'edit', { file_path: 'E:/w/a.js' }),
    ...call(6, 1, 'pwsh', { command: 'node -c a.js', description: 'check' }),
    ...call(8, 1, 'grep', { pattern: 'needle' }),
  ]);
  const [step] = detailOf(events).steps;
  assert.deepEqual(step.tags, [
    { tag: '读取', count: 1 }, { tag: '修改', count: 1 }, { tag: '运行', count: 1 },
    { tag: '+1', count: 1, overflow: true },
  ]);
});

test('step title: explanation events become marks, capped at two with tones', () => {
  const events = titleEvents([
    ...call(2, 1, 'read', { file_path: 'E:/a.ts' }),
    { type: 'workspace/changes', seq: 10, time: 10, data: { step: 1, turn: 1 } },
    { type: 'todo/write', seq: 11, time: 11, data: { step: 1, todos: [{ content: 'a' }, { content: 'b' }] } },
    { type: 'agent/inbox/spliced', seq: 12, time: 12, data: { step: 1, target: 'next-turn', inserted: [] } },
  ]);
  const [step] = detailOf(events).steps;
  assert.equal(step.title, '读取 a.ts');
  assert.deepEqual(step.marks.map((mark) => mark.text), ['文件变更', '清单 2 项']);
  assert.equal(step.marks.every((mark) => mark.tone === 'muted'), true);
});

test('step title: a step with nothing visible is named by its explanation event', () => {
  const compaction = titleEvents([
    { type: 'compaction/prune', seq: 2, time: 2, data: { step: 1, shadowedTokenCount: 12491 } },
  ]);
  assert.equal(detailOf(compaction).steps[0].title, '压缩 12.5k tok');

  const retry = titleEvents([
    { type: 'assistant/attempt', seq: 2, time: 2, data: { step: 1, stream: [{ chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', status: 429 } } } }] } },
    { type: 'llm/retry', seq: 3, time: 3, data: { step: 1, retry: 2, maxRetries: 5, failure: { code: 'RATE_LIMIT' } } },
  ]);
  const step = detailOf(retry).steps[0];
  assert.equal(step.title, '失败 RATE_LIMIT');
  assert.deepEqual(step.marks, [{ text: '重试 2/5', tone: 'warn' }]);
});

test('step title: empty model reply, injection-only step and present/deliverables', () => {
  const empty = titleEvents([
    { type: 'assistant/message', seq: 2, time: 2, data: { step: 1, message: { role: 'assistant', content: [] } } },
  ]);
  assert.equal(detailOf(empty).steps[0].title, '空回复');

  const injected = titleEvents([
    { type: 'user/message', seq: 2, time: 2, data: { step: 1, source: { kind: 'time-context' }, content: [{ type: 'text', text: 'now is 12:00' }] } },
  ]);
  assert.equal(detailOf(injected).steps[0].title, '仅注入上下文');

  const delivered = titleEvents([
    ...call(2, 1, 'present', { files: [{ path: 'E:/w/out/x.html' }] }),
    { type: 'deliverables/presented', seq: 5, time: 5, data: { step: 1, files: [{ path: 'E:/w/out/x.html' }] } },
  ]);
  assert.equal(detailOf(delivered).steps[0].title, '交付 x.html');
});

test('buildStepContent surfaces explanation events as note rows in order', () => {
  const events = titleEvents([
    { type: 'tool/call', seq: 2, time: 2, data: { step: 1, callId: 'c2', name: 'pwsh', arguments: '{"command":"a","description":"b"}' } },
    { type: 'tool/result', seq: 3, time: 3, data: { step: 1, message: { source: { callId: 'c2' }, content: [{ type: 'text', text: 'ok' }] } } },
    { type: 'compaction/prune', seq: 4, time: 4, data: { step: 1, shadowedTokenCount: 2048 } },
    { type: 'workspace/changes', seq: 5, time: 5, data: { step: 1, turn: 1 } },
    { type: 'command/run', seq: 6, time: 6, data: { step: 1, name: 'export' } },
  ]);
  const tree = buildTraceTree(events);
  const tools = slimToolPairs(pairToolCalls(events));
  const content = buildStepContent(tree, tools, 0, 0);
  assert.deepEqual(content.operations.map((op) => op.kind), ['tool', 'note', 'note', 'note']);
  assert.deepEqual(content.operations.slice(1).map((op) => [op.noteKind, op.text]), [
    ['compact', '压缩 2k tok'],
    ['workspace', '文件变更'],
    ['command', '命令 /export'],
  ]);
});
test('buildStepContent does not repeat a note the tool row already shows', () => {
  const events = titleEvents([
    ...call(2, 1, 'present', { files: [{ path: 'E:/w/x.html' }] }),
    { type: 'deliverables/presented', seq: 5, time: 5, data: { step: 1, files: [{ path: 'E:/w/x.html' }] } },
    ...call(6, 1, 'todo_write', { todos: [{ content: 'a' }] }),
    { type: 'todo/write', seq: 9, time: 9, data: { step: 1, todos: [{ content: 'a' }] } },
    { type: 'workspace/changes', seq: 10, time: 10, data: { step: 1, turn: 1 } },
  ]);
  const tree = buildTraceTree(events);
  const tools = slimToolPairs(pairToolCalls(events));
  const content = buildStepContent(tree, tools, 0, 0);
  const notes = content.operations.filter((op) => op.kind === 'note');
  assert.deepEqual(notes.map((op) => op.noteKind), ['workspace']);
});
// ---- step windows from the log's own markers (SPEC F133) ----

test('buildTraceTree takes the step window from step/start..step/end', () => {
  const events = [
    { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
    { type: 'step/start', seq: 2, time: 1000, data: { turn: 1, step: 1 } },
    { type: 'user/message', seq: 3, time: 1001, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'go' }] } },
    { type: 'assistant/message', seq: 4, time: 11000, data: { step: 1, usage: {} } },  // 模型思考 10 s
    { type: 'tool/call', seq: 5, time: 11001, data: { step: 1, callId: 'c1', name: 'read' } },
    { type: 'tool/result', seq: 6, time: 11500, data: { step: 1, message: { source: { callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] } } },
    { type: 'step/end', seq: 7, time: 11510, data: { turn: 1, step: 1 } },
    { type: 'workspace/changes', seq: 8, time: 11600, data: { turn: 1 } },   // 回合尾部事件：不延长窗口
    { type: 'turn/end', seq: 9, time: 11601, data: { turn: 1 } },
    { type: 'agent/inbox/spliced', seq: 10, time: 300000, data: { target: 'next-turn' } }, // 用户 5 分钟后才回
    { type: 'turn/start', seq: 11, time: 300000, data: { turn: 2 } },
  ];
  const runs = buildTraceTree(events);
  const run1 = runs.find((r) => r.prompt === 'go');
  assert.equal(run1.steps.length, 1);
  const st = run1.steps[0];
  assert.equal(st.startTime, 1000);   // step/start，模型时间不再被切掉
  assert.equal(st.endTime, 11510);    // step/end，而不是下一条用户消息的 300000
  assert.equal(st.events.some((e) => e.type === 'workspace/changes'), true);  // 回合尾部事件仍归最后一步
  assert.equal(st.events.some((e) => e.type === 'agent/inbox/spliced'), false); // 但下一回合的注入不再粘上来
});