/**
 * Projections from a cached trace tree: `/runs` (first paint), `/run` (step
 * index) and `/step` (one step's activity trace). Pure tree math — no raw event
 * is needed, so the Host caches tree/tokens/tools and re-projects cheaply.
 */
import { buildTraceTree } from './trace.js';
import { stepTitle } from './titles.js';

const DEFAULT_SLOW_MS = 5000;

/** Sum token usage across `assistant/message` events. */
export function aggregateTokens(events) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  const byTurn = new Map();
  const add = (turn, usage) => {
    total.input += usage.inputTokens ?? 0;
    total.output += usage.outputTokens ?? 0;
    total.cacheRead += usage.cacheReadTokens ?? 0;
    total.cacheWrite += usage.cacheWriteTokens ?? 0;
    total.reasoning += usage.reasoningTokens ?? 0;
    const row = byTurn.get(turn) ?? { turn, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
    row.input += usage.inputTokens ?? 0;
    row.output += usage.outputTokens ?? 0;
    row.cacheRead += usage.cacheReadTokens ?? 0;
    row.cacheWrite += usage.cacheWriteTokens ?? 0;
    row.reasoning += usage.reasoningTokens ?? 0;
    byTurn.set(turn, row);
  };
  for (const event of events) {
    if (event.type !== 'assistant/message') continue;
    const usage = event.data?.usage;
    if (usage == null) continue;
    add(event.data?.turn ?? 0, usage);
  }
  return { total, byTurn: [...byTurn.values()].sort((a, b) => a.turn - b.turn) };
}

/** Pair `tool/call` with its `tool/result` by callId, computing durationMs. */
export function pairToolCalls(events) {
  const calls = new Map();
  const results = new Map();
  for (const event of events) {
    if (event.type === 'tool/call') {
      const callId = event.data?.callId;
      // First wins: a resumed session can re-deliver the same pair, and taking
      // the last one yields the 27,000-second "tool duration" bug.
      if (callId != null && !calls.has(callId)) calls.set(callId, event);
    } else if (event.type === 'tool/result') {
      const callId = event.data?.message?.source?.callId ?? event.data?.message?.toolCallId;
      if (callId != null && !results.has(callId)) results.set(callId, event);
    }
  }
  const pairs = [];
  for (const [callId, call] of calls) {
    const result = results.get(callId);
    pairs.push({
      callId,
      name: call.data?.name ?? '',
      call,
      result,
      durationMs: result != null ? Math.max(0, result.time - call.time) : null,
      error: result?.data?.error ?? undefined,
    });
  }
  pairs.sort((a, b) => (a.call.time ?? 0) - (b.call.time ?? 0));
  return pairs;
}

/** Compact serializable shape (no raw events); `error` is a code/name string. */
export function slimToolPairs(pairs) {
  return pairs.map((pair) => ({
    callSeq: pair.call?.seq ?? null,
    resultSeq: pair.result?.seq ?? null,
    name: pair.name ?? '',
    durationMs: pair.durationMs ?? null,
    error: pair.error == null ? null : (pair.error.code ?? pair.error.name ?? 'error'),
    startTime: pair.call?.time ?? null,
    endTime: pair.result?.time ?? null,
  }));
}

// Answering a question / approving a plan or install is a human pause, shown as
// "wait" and never folded into execution time (F133/F150).
const HUMAN_WAIT_TOOLS = new Set(['ask_user_question', 'exit_plan_mode', 'plugin_manager']);
/** A human cannot answer faster than this; below it the call is ordinary work. */
const HUMAN_WAIT_MIN_MS = 5000;
function isHumanWaitTool(tool) {
  return HUMAN_WAIT_TOOLS.has(tool.name) && (tool.durationMs ?? 0) >= HUMAN_WAIT_MIN_MS;
}

/**
 * Step duration exactly as the official trajectory computes it (SPEC F133):
 * `assistant/message.time − step/start.time`; tool time is shown separately.
 * Returns null when the step has no assistant message.
 */
export function stepModelMs(step) {
  const messages = step.events.filter((leaf) => leaf.type === 'assistant/message' && leaf.time != null);
  if (messages.length === 0) return null;
  const completed = messages[messages.length - 1].time;
  if (step.startTime == null) return null;
  return Math.max(0, completed - step.startTime);
}

/** `modelMs`, `toolMs`, `waitMs` and `timeMs = model + tool` for one step. */
export function stepTimeParts(step, stepTools) {
  const modelMs = stepModelMs(step);
  let toolMs = 0;
  let waitMs = 0;
  for (const tool of stepTools) {
    const duration = tool.durationMs ?? 0;
    if (isHumanWaitTool(tool)) waitMs += duration;
    else toolMs += duration;
  }
  const timeMs = modelMs == null && toolMs === 0 ? null : (modelMs ?? 0) + toolMs;
  return { modelMs, toolMs, waitMs, timeMs };
}

/** Phase-1 projection: the run list + KPI for the panel's first paint. */
export function buildRunsPayloadFrom(tree, tokens, tools, opts = {}) {
  const slowMs = opts.slowMs ?? DEFAULT_SLOW_MS;

  const toolsByRun = new Map();
  const owner = new Map();
  tree.forEach((run, runIdx) => {
    run.steps.forEach((step) => {
      for (const leaf of step.events) if (leaf.seq != null) owner.set(leaf.seq, runIdx);
    });
  });
  for (const tool of tools) {
    const runIdx = tool.callSeq != null ? owner.get(tool.callSeq) : undefined;
    if (runIdx === undefined) continue;
    if (!toolsByRun.has(runIdx)) toolsByRun.set(runIdx, []);
    toolsByRun.get(runIdx).push(tool);
  }

  const runs = tree.map((run, idx) => {
    let minTime = Infinity;
    let maxTime = -Infinity;
    let token = 0;
    let hasError = false;
    let time = 0;
    const runTools = toolsByRun.get(idx) ?? [];
    for (const step of run.steps) {
      token += sumStepTokens(step);
      // Run duration = sum of its steps' execution time (waiting excluded).
      const seqs = new Set(step.events.map((leaf) => leaf.seq));
      const stepTools = runTools.filter((tool) => tool.callSeq != null && seqs.has(tool.callSeq));
      time += stepTimeParts(step, stepTools).timeMs ?? 0;
      if (step.startTime != null && step.startTime < minTime) minTime = step.startTime;
      if (step.endTime != null && step.endTime > maxTime) maxTime = step.endTime;
      for (const leaf of step.events) if (leaf.error) hasError = true;
    }
    let hasSlow = false;
    for (const tool of runTools) {
      if (tool.error != null) hasError = true;
      if (isHumanWaitTool(tool)) continue; // F150: a human pause is not slow work
      if (typeof tool.durationMs === 'number' && tool.durationMs > slowMs) hasSlow = true;
    }
    // F142: step rows carry the distribution; the run total is their sum.
    return {
      idx,
      prompt: run.prompt ?? null,
      isSystemPrompt: Boolean(run.isSystemPrompt),
      actor: run.isSystemPrompt ? 'system' : 'user',
      stepCount: run.steps.length,
      token,
      time,
      startTime: minTime === Infinity ? null : minTime,
      endTime: maxTime === -Infinity ? null : maxTime,
      hasError,
      hasSlow,
    };
  });

  // F150: "slow"/"slowest" mean work, never "the user took 13 minutes to answer".
  const workTools = tools.filter((tool) => !isHumanWaitTool(tool));
  const errorCount = tools.filter((tool) => tool.error != null).length;
  const slowCount = workTools.filter((tool) => typeof tool.durationMs === 'number' && tool.durationMs > slowMs).length;
  const slowest = workTools.reduce((acc, tool) => (
    typeof tool.durationMs === 'number' && (acc == null || tool.durationMs > acc.durationMs) ? tool : acc
  ), null);

  return {
    header: opts.header ?? null,
    meta: {
      sessionId: opts.sessionId ?? opts.header?.id ?? null,
      slowMs,
      serverMs: opts.serverMs ?? null,
      generatedAt: opts.generatedAt ?? null,
      // F140: the log offset this payload was built at, so the client can poll
      // with `?since=<seq>` and get the 40 B `unchanged` reply.
      seq: opts.seq ?? null,
    },
    counts: {
      events: opts.eventCount ?? tree.reduce((acc, run) => acc + countLeaves(run), 0),
      runs: tree.length,
      steps: tree.reduce((acc, run) => acc + run.steps.length, 0),
    },
    tokens: { total: tokens?.total ?? emptyUsage() },
    kpi: {
      errors: errorCount,
      slow: slowCount,
      abnormal: runs.filter((run) => run.hasError).length,
      slowest: slowest == null ? null : { name: slowest.name, durationMs: slowest.durationMs },
    },
    runs,
  };
}

/** Phase-1 entry point over raw events: tree + tokens + tools, then project. */
export function buildRunsPayload(events, opts = {}) {
  const tree = buildTraceTree(events);
  const tokens = aggregateTokens(events);
  const tools = slimToolPairs(pairToolCalls(events));
  return {
    payload: buildRunsPayloadFrom(tree, tokens, tools, { ...opts, eventCount: opts.eventCount ?? events.length }),
    tree,
    tokens,
    tools,
  };
}

/**
 * Phase-2 projection: one run's step index for in-place expansion. Step content
 * is served by `buildStepContent` on demand, so this stays a few KB per run.
 * Returns null when `idx` is out of range.
 */
export function buildRunDetail(tree, tools, idx, opts = {}) {
  const run = tree[idx];
  if (run == null) return null;
  const slowMs = opts.slowMs ?? DEFAULT_SLOW_MS;

  const stepOfSeq = new Map();
  run.steps.forEach((step, stepIdx) => {
    for (const leaf of step.events) if (leaf.seq != null) stepOfSeq.set(leaf.seq, stepIdx);
  });
  const toolsByStep = new Map();
  for (const tool of tools) {
    const stepIdx = tool.callSeq != null ? stepOfSeq.get(tool.callSeq) : undefined;
    if (stepIdx === undefined) continue;
    if (!toolsByStep.has(stepIdx)) toolsByStep.set(stepIdx, []);
    toolsByStep.get(stepIdx).push(tool);
  }

  const steps = run.steps.map((step, stepIdx) => {
    const stepTools = toolsByStep.get(stepIdx) ?? [];
    const hasToolError = stepTools.some((tool) => tool.error != null);
    const titleInfo = stepTitle(step);
    const timing = stepTimeParts(step, stepTools);
    return {
      step: step.step,
      startTime: step.startTime,
      endTime: step.endTime,
      // 执行耗时 = 模型 + 工具（不含人机等待），与官方两处数字同源（F133）。
      timeMs: timing.timeMs,
      modelMs: timing.modelMs,
      toolMs: timing.toolMs,
      waitMs: timing.waitMs,
      token: sumStepTokens(step),
      hasError: hasToolError || step.events.some((leaf) => leaf.error),
      // Title (verb + object) + chip row / status marks (F23.1/F137); `text` is
      // the raw caption and becomes the row tooltip.
      title: titleInfo.title,
      tag: titleInfo.tag ?? null,
      ...(titleInfo.tags?.length > 0 ? { tags: titleInfo.tags } : {}),
      ...(titleInfo.marks.length > 0 ? { marks: titleInfo.marks } : {}),
      text: stepCaption(step, stepTools),
    };
  });

  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const step of run.steps) {
    for (const leaf of step.events) {
      if (leaf.time == null) continue;
      if (leaf.time < minTime) minTime = leaf.time;
      if (leaf.time > maxTime) maxTime = leaf.time;
    }
  }

  return {
    idx,
    prompt: run.prompt ?? null,
    isSystemPrompt: Boolean(run.isSystemPrompt),
    actor: run.isSystemPrompt ? 'system' : 'user',
    startTime: minTime === Infinity ? null : minTime,
    endTime: maxTime === -Infinity ? null : maxTime,
    slowMs,
    steps,
    serverMs: opts.serverMs ?? null,
  };
}

/**
 * Phase-3 projection: one step's ordered activity trace, no nesting. Each
 * `tool/result` folds into its `tool/call` row; fields follow the native data
 * contract (概述, 参数, 结果, 计时, Token, 模型). Null when out of range.
 */
export function buildStepContent(tree, tools, idx, stepIdx, opts = {}) {
  const run = tree[idx];
  if (run == null) return null;
  const step = run.steps[stepIdx];
  if (step == null) return null;

  const seqOfStep = new Set();
  for (const leaf of step.events) if (leaf.seq != null) seqOfStep.add(leaf.seq);

  const toolByCall = new Map();
  for (const tool of tools) {
    if (tool.callSeq != null && seqOfStep.has(tool.callSeq)) toolByCall.set(tool.callSeq, tool);
  }

  const counts = { models: 0, tools: 0, contexts: 0 };
  // A deliverable/todo note is skipped when its tool row is already on screen.
  const toolNames = new Set(step.events.filter((leaf) => leaf.type === 'tool/call').map((leaf) => leaf.toolName));
  const operations = [];
  for (const leaf of step.events) {
    if (leaf.seq == null) continue;
    if (leaf.type === 'assistant/message') {
      counts.models += 1;
      operations.push({
        kind: 'assistant',
        seq: leaf.seq,
        time: leaf.time,
        text: leaf.text ?? '',
        usage: leaf.usage ?? null,
      });
      continue;
    }
    if (leaf.type === 'tool/call') {
      const tool = toolByCall.get(leaf.seq);
      if (tool === undefined) continue;
      counts.tools += 1;
      const resultLeaf = tool.resultSeq != null ? findLeaf(step, tool.resultSeq) : undefined;
      operations.push({
        kind: 'tool',
        seq: leaf.seq,
        callSeq: leaf.seq,
        resultSeq: tool.resultSeq ?? null,
        name: tool.name,
        args: leaf.argsText ?? '',
        result: resultLeaf?.resultText ?? '',
        error: tool.error ?? null,
        isError: resultLeaf?.isError === true,
        durationMs: tool.durationMs,
        startTime: tool.startTime,
        endTime: tool.endTime,
      });
      continue;
    }
    if (leaf.type === 'tool/result') {
      continue; // already folded into its call row (SPEC F129)
    }
    if (leaf.actor === 'context' && leaf.text) {
      counts.contexts += 1;
      operations.push({ kind: 'context', seq: leaf.seq, time: leaf.time, text: leaf.text });
      continue;
    }
    if (leaf.actor === 'system' && leaf.text) {
      operations.push({ kind: 'system', seq: leaf.seq, time: leaf.time, text: leaf.text });
      continue;
    }
    // Textless events (compaction, retries, changes, commands, approvals …)
    // explain a slow or empty-looking step (F23.2), unless a tool row says it.
    if (leaf.note) {
      const covered = (leaf.noteKind === 'deliver' && toolNames.has('present'))
        || (leaf.noteKind === 'todo' && toolNames.has('todo_write'));
      if (!covered) operations.push({ kind: 'note', noteKind: leaf.noteKind ?? 'note', seq: leaf.seq, time: leaf.time, text: leaf.note });
    }
  }

  const stepTiming = stepTimeParts(step, [...toolByCall.values()]);
  return {
    idx,
    step: step.step,
    startTime: step.startTime,
    endTime: step.endTime,
    timeMs: stepTiming.timeMs,
    modelMs: stepTiming.modelMs,
    toolMs: stepTiming.toolMs,
    waitMs: stepTiming.waitMs,
    // request/header only marks epoch starts: fall back to the last known model.
    model: stepModel(tree, idx, stepIdx),
    usage: sumStepUsage(step),
    counts,
    operations,
    slowMs: opts.slowMs ?? DEFAULT_SLOW_MS,
    serverMs: opts.serverMs ?? null,
  };
}

function findLeaf(step, seq) {
  if (seq == null) return undefined;
  return step.events.find((leaf) => leaf.seq === seq);
}

/** The nearest `request/header` at or before this step (walks earlier runs). */
function stepModel(tree, runIdx, stepIdx) {
  for (let run = runIdx; run >= 0; run--) {
    const steps = tree[run].steps;
    for (let step = run === runIdx ? stepIdx : steps.length - 1; step >= 0; step--) {
      for (const leaf of steps[step].events) {
        if (leaf.type !== 'request/header') continue;
        if (leaf.provider == null && leaf.model == null) continue;
        return { provider: leaf.provider ?? null, model: leaf.model ?? null };
      }
    }
  }
  return null;
}

/** Token usage breakdown for this step. */
function sumStepUsage(step) {
  const total = emptyUsage();
  for (const leaf of step.events) {
    if (leaf.usage == null) continue;
    total.input += leaf.usage.input ?? 0;
    total.output += leaf.usage.output ?? 0;
    total.cacheRead += leaf.usage.cacheRead ?? 0;
    total.cacheWrite += leaf.usage.cacheWrite ?? 0;
    total.reasoning += leaf.usage.reasoning ?? 0;
  }
  return total;
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
}

/** The step's one-line caption: narrative text, else the tools it called. */
function stepCaption(step, stepTools) {
  for (const type of ['assistant/message', 'user/message', 'developer/message', 'system/message']) {
    const leaf = step.events.find((event) => event.type === type && event.text);
    if (leaf !== undefined) return leaf.text;
  }
  const names = [...new Set(stepTools.map((tool) => tool.name).filter(Boolean))];
  if (names.length === 0) return null;
  // One call reads best with its argument preview; several fit names only.
  if (names.length === 1) {
    const call = step.events.find((event) => event.type === 'tool/call' && event.toolArgs);
    return call === undefined ? `tool · ${names[0]}` : `tool · ${names[0]} · ${call.toolArgs}`;
  }
  return `tool · ${names.slice(0, 3).join(', ')}`;
}

function sumStepTokens(step) {
  let total = 0;
  for (const leaf of step.events) total += leaf.token ?? 0;
  return total;
}

function countLeaves(run) {
  let total = 0;
  for (const step of run.steps) total += step.events.length;
  return total;
}
