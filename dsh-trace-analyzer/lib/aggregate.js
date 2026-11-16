/**
 * Pure aggregation over a DSH session's raw SessionEvent[] (full events).
 *
 * Every function here is synchronous, side-effect-free, and accepts plain
 * events (from `sessionQuery.readSession`). They live in a separate file so
 * the Host/Client can share them and unit tests can run them with bare Node.
 */

/** Group events into [{ turn, steps: [{ step, events: [] }] }], ordered by seq. */
export function groupTimeline(events) {
  const turns = [];
  let turn = null;
  let step = null;

  const push = (event) => {
    if (turn === null) { turn = { turn: 0, steps: [] }; turns.push(turn); }
    if (step === null) { step = { step: 0, events: [] }; turn.steps.push(step); }
    step.events.push(event);
  };

  for (const event of events) {
    const data = event.data ?? {};
    if (event.type === 'turn/start') {
      turn = { turn: data.turn, steps: [] };
      turns.push(turn);
      step = null;
      continue;
    }
    if (event.type === 'step/start') {
      if (turn !== null) { step = { step: data.step, events: [] }; turn.steps.push(step); }
      continue;
    }
    if (typeof data.turn === 'number') {
      if (turn === null || turn.turn !== data.turn) {
        turn = { turn: data.turn, steps: [] };
        turns.push(turn);
        step = null;
      }
      if (typeof data.step === 'number') {
        if (step === null || step.step !== data.step) {
          step = { step: data.step, events: [] };
          turn.steps.push(step);
        }
      }
    }
    push(event);
  }
  return turns;
}

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
    const turn = event.data?.turn ?? 0;
    add(turn, usage);
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
      // First wins: a resumed session can re-deliver the same call/result pair,
      // and taking the last one pairs a call with a result hours later (that is
      // the 27,000-second "tool duration" bug).
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

/**
 * Classify one tool-call pair as an anomaly under the given thresholds.
 * Returns a kind string or null.
 */
export function judgeToolAnomaly(pair, thresholds) {
  if (pair.error != null) return 'error';
  if (typeof pair.durationMs === 'number' && pair.durationMs > (thresholds.toolDurationMs ?? 0)) return 'duration';
  if (typeof pair.result?.data?.message?.content === 'string') {
    // Token-based highlighting is computed from usage deltas elsewhere;
    // tool-level token threshold is not applicable to a single result.
  }
  return null;
}

/** Flatten a SessionLineageTrace into a renderable node list (rooted at ancestors[0]). */
export function normalizeLineage(trace) {
  if (trace == null) return [];
  const nodes = [];
  const seen = new Set();
  const addRecord = (record, depth, role) => {
    if (record == null) return;
    const id = record.header?.id;
    if (id != null && seen.has(id)) return;
    if (id != null) seen.add(id);
    nodes.push({ record, depth, role });
  };
  const walkDescendants = (children, depth) => {
    for (const child of children ?? []) {
      addRecord(child.session, depth, 'descendant');
      walkDescendants(child.descendants, depth + 1);
    }
  };
  (trace.ancestors ?? []).forEach((record, index) => addRecord(record, index, 'ancestor'));
  addRecord(trace.target, (trace.ancestors ?? []).length, 'target');
  walkDescendants(trace.descendants, (trace.ancestors ?? []).length + 1);
  return nodes;
}

/** Extract the visible text from a message's content blocks. */
function textOf(message) {
  const blocks = message?.content;
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}


/** Bound a step caption; it is one line in the panel, so longer text is noise. */
const MESSAGE_TEXT_MAX = 400;

/** Bound of the tool arguments / result text shown in a step's content panel. */
const DETAIL_TEXT_MAX = 400;

function truncateText(value, max = MESSAGE_TEXT_MAX) {
  const raw = String(value ?? '');
  // Collapse whitespace on a bounded head only: tool results can be megabytes,
  // and a full-string regex would dominate the snapshot build.
  const head = raw.length > max + 64 ? raw.slice(0, max + 64) : raw;
  const text = head.replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/** Normalize a `TokenUsage` into the panel's fixed shape (missing fields = 0). */
function normalizeUsage(usage) {
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
    reasoning: usage.reasoningTokens ?? 0,
  };
}

/** The message payload that carries visible text for this event, if any. */
function messageOf(event) {
  switch (event.type) {
    case 'user/message':
      return event.data ?? null;
    case 'assistant/message':
    case 'system/message':
    case 'developer/message':
      return event.data?.message ?? null;
    default:
      return null;
  }
}

/**
 * Who speaks in this event (SPEC F131). The vocabulary is the built-in
 * Trajectory's cell kinds, so the panel's role tags match that view exactly:
 * `user` (real user), `assistant` (model output and requests), `context`
 * (developer messages and runtime injections), `system` (system prompt) and
 * `tool` (calls and results).
 */
export function actorOf(event) {
  switch (event.type) {
    case 'assistant/message':
    case 'request/header':
    case 'request/context':
      return 'assistant';
    case 'tool/call':
    case 'tool/result':
      return 'tool';
    case 'user/message':
      return event.data?.source?.kind === 'user' ? 'user' : 'context';
    case 'developer/message':
      return 'context';
    case 'system/message':
      return 'system';
    default:
      return 'system';
  }
}

/**
 * A short, human-readable preview of a tool call's arguments: the first string
 * argument (command, path, pattern …) rather than the raw JSON blob.
 */
function toolArgPreview(argumentsText) {
  const raw = String(argumentsText ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const value of Object.values(parsed)) {
        if (typeof value === 'string' && value.trim().length > 0) return truncateText(value, 60);
      }
    }
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return truncateText(raw, 60);
}

/** 1.2k / 980 / 12k — the compact form used inside step titles. */
function shortTokens(value) {
  const n = Number(value) || 0;
  if (n >= 100000) return Math.round(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function fileBase(path) {
  const parts = String(path ?? '').split(/[\\/]/);
  return parts[parts.length - 1] || String(path ?? '');
}

/**
 * The event types that carry a `note`. Checked before `eventNote` is called:
 * the tree build sees ~13k events, and only a few dozen of them are these —
 * a switch on every event was measurable in the first-paint budget (P02).
 */
const NOTE_EVENT_TYPES = new Set([
  'assistant/attempt', 'llm/retry', 'compaction/prune', 'compaction/summary',
  'workspace/changes', 'command/run', 'plan/mode', 'todo/write',
  'deliverables/presented', 'approval/asked',
]);

/**
 * The one-line note carried by events that have no visible text of their own
 * (compaction, retries, workspace changes, slash commands, approvals …).
 * These used to be dropped entirely; they are the second half of a step's
 * story, so `/run` shows them as title marks and `/step` as muted rows.
 * Returns `{ kind, text }` or null.
 */
function eventNote(event) {  const data = event.data ?? {};
  switch (event.type) {
    case 'assistant/attempt': {
      const stream = Array.isArray(data.stream) ? data.stream : [];
      const failure = stream.find((s) => s?.chunk?.reason?.kind === 'error')?.chunk.reason.failure;
      if (!failure) return null;
      const code = failure.code ?? (failure.status != null ? String(failure.status) : '');
      return { kind: 'fail', text: code ? `失败 ${code}` : '失败' };
    }
    case 'llm/retry': {
      const n = data.retry ?? 1;
      const max = data.maxRetries ?? 5;
      // The failure code lives on `assistant/attempt` (a "fail" note), so the
      // retry note stays a pure counter and the two never repeat each other.
      return { kind: 'retry', text: `重试 ${n}/${max}` };
    }
    case 'compaction/prune': {
      const tokens = data.shadowedTokenCount ?? 0;
      return { kind: 'compact', text: tokens > 0 ? `压缩 ${shortTokens(tokens)} tok` : '压缩上下文' };
    }
    case 'compaction/summary':
      return { kind: 'compact', text: '压缩摘要' };
    case 'workspace/changes':
      return { kind: 'workspace', text: '文件变更' };
    case 'command/run':
      return { kind: 'command', text: data.name ? `命令 /${data.name}` : '命令' };
    case 'plan/mode':
      return { kind: 'plan', text: data.active ? '计划模式' : '退出计划' };
    case 'todo/write': {
      const n = Array.isArray(data.todos) ? data.todos.length : 0;
      return { kind: 'todo', text: n > 0 ? `清单 ${n} 项` : '更新清单' };
    }
    case 'deliverables/presented': {
      const files = Array.isArray(data.files) ? data.files : [];
      if (files.length === 1) return { kind: 'deliver', text: `交付 ${fileBase(files[0]?.path)}` };
      if (files.length > 1) return { kind: 'deliver', text: `交付 ${files.length} 个文件` };
      return { kind: 'deliver', text: '交付' };
    }
    case 'approval/asked':
      return { kind: 'approval', text: data.toolName ? `审批 ${data.toolName}` : '审批' };
    default:
      return null;
  }
}

/** A short, human-readable label for one raw event. */

/**
 * Build the trace tree aligned to DSH's native model:
 * session → run (一次指令；run0 = 系统提示词) → step (一次 agent loop).
 *
 * Run splitting rule: only a REAL user message opens a new run, i.e.
 * `user/message` with `data.source.kind === 'user'`. Runtime context injections
 * (`runtime-context` / `skill-catalog` / `time-context` …) do NOT open a run.
 * Everything before the first real user message becomes run0 (system prompt).
 *
 * Step grouping rule (SPEC F133): a step's window is bracketed by the log's own
 * `step/start` / `step/end` markers. Events are attached by `data.step` when it
 * is present; events without it join the step that is currently open, and a
 * turn's trailing events (e.g. `workspace/changes` after `step/end`) join that
 * turn's last step. Events that arrive after `turn/end` — the next user message
 * is spliced in *after* the turn closes — are NOT glued to the last step any
 * more; that bug made a step's duration include the idle time until the user
 * spoke again (it inflated 1775 of 1900 steps on the reference session).
 *
 * Because the window comes from the markers, `timeMs` is the real step duration
 * and the model call (step/start → assistant/message) is no longer cut off. When
 * a log has no markers, the window falls back to the leaf events' min/max.
 *
 * Each leaf carries `token` (input+output of an `assistant/message` usage, 0
 * otherwise) so later stages never need the raw event again — the run table can
 * be built from the tree alone (see `buildRunsPayloadFrom`).
 *
 * Returns [{ prompt, isSystemPrompt, steps: [{ step, startSeq, endSeq, startTime, endTime, events: [leaf] }] }].
 */
export function buildTraceTree(events) {
  const runs = [];
  let run = null;
  let stepsByNum = new Map();
  let current = null;    // step opened by step/start, closed by step/end
  let turnOpen = false;  // between turn/start and turn/end
  let tailStep = null;   // the step that just ended in the CURRENT turn
  let pendingTurn = null;
  // Markers live outside runs: `step/start` for a turn may precede the user
  // message that opens that turn's run (F133).
  const markers = new Map();

  const isRealUser = (event) => event.type === 'user/message' && event.data?.source?.kind === 'user';
  const markerKey = (turn, step) => turn + ':' + step;

  const applyMarker = (s, marker) => {
    if (marker == null) return;
    s.marked = true;
    if (marker.startTime != null) s.startTime = marker.startTime;
    if (marker.startSeq != null) s.startSeq = marker.startSeq;
    if (marker.endTime != null) s.endTime = marker.endTime;
    if (marker.endSeq != null) s.endSeq = marker.endSeq;
  };

  const stepFor = (stepNum) => {
    let s = stepsByNum.get(stepNum);
    if (s === undefined) {
      s = { step: stepNum, startSeq: null, startTime: null, endSeq: null, endTime: null, events: [], marked: false };
      stepsByNum.set(stepNum, s);
      run.steps.push(s);
      // run0 is the synthetic system-prompt preamble; keep it on leaf times.
      if (!run.isSystemPrompt) applyMarker(s, markers.get(markerKey(run.turn, stepNum)));
    }
    return s;
  };

  const openRun = (props) => {
    run = { ...props, turn: pendingTurn, steps: [] };
    runs.push(run);
    stepsByNum = new Map();
    current = null;
    return run;
  };

  // Fallback only: when a step has no `step/start`/`step/end` marker pair, its
  // window is the min/max of its own leaves.
  const touch = (s, event) => {
    if (s.marked) return;
    if (event.time != null) {
      if (s.startTime === null || event.time < s.startTime) s.startTime = event.time;
      if (s.endTime === null || event.time > s.endTime) s.endTime = event.time;
    }
    if (event.seq != null) {
      if (s.startSeq === null || event.seq < s.startSeq) s.startSeq = event.seq;
      if (s.endSeq === null || event.seq > s.endSeq) s.endSeq = event.seq;
    }
  };

  for (const event of events) {
    const data = event.data ?? {};
    if (event.type === 'turn/start') {
      pendingTurn = data.turn ?? pendingTurn;
      turnOpen = true;
      current = null;
      tailStep = null;
      if (run === null) openRun({ prompt: null, isSystemPrompt: true });
      continue;
    }
    if (event.type === 'turn/end') {
      turnOpen = false;
      current = null;
      tailStep = null;
      continue;
    }
    // The next user message is queued as an agent/inbox/spliced event; it is
    // never part of the current step (it used to stretch the last step's time by
    // the user's thinking time). The real user/message opens the next run.
    if (event.type === 'agent/inbox/spliced') continue;
    if (isRealUser(event)) {
      openRun({ prompt: textOf(data), isSystemPrompt: false });
      continue;
    }
    if (event.type === 'step/start' || event.type === 'step/end') {
      const num = typeof data.step === 'number' ? data.step : (current ? current.step : 1);
      const turn = data.turn ?? pendingTurn;
      const key = markerKey(turn, num);
      const marker = markers.get(key) ?? {};
      if (event.type === 'step/start') {
        marker.startTime = event.time ?? null;
        marker.startSeq = event.seq ?? null;
      } else {
        marker.endTime = event.time ?? null;
        marker.endSeq = event.seq ?? null;
      }
      markers.set(key, marker);
      // Only materialise the step when the open run owns this turn; otherwise
      // the marker waits for that run to be created (see `stepFor`).
      if (run !== null && !run.isSystemPrompt && run.turn === turn) {
        const s = stepFor(num);
        applyMarker(s, marker);
        if (event.type === 'step/start') current = s;
        else { current = null; tailStep = s; }
      }
      continue;
    }
    if (run === null) openRun({ prompt: null, isSystemPrompt: true });

    let s = null;
    if (typeof data.step === 'number') s = stepFor(data.step);
    else if (current) s = current;
    // run0 is the system-prompt preamble: keep its content on a synthetic step 1.
    else if (run.isSystemPrompt) s = stepFor(1);
    // Head of a run before its first `data.step` event (request/header, injections).
    else if (turnOpen && run.steps.length === 0) s = stepFor(1);
    // Turn tail (e.g. `workspace/changes` after step/end): shown on this turn's
    // last step, but it must not extend that step's time window.
    else if (turnOpen && run.steps.length > 0) s = run.steps[run.steps.length - 1];
    if (s === null) continue; // late echo from a closed turn (user splice, acks …)
    touch(s, event);
    const usage = event.type === 'assistant/message' ? event.data?.usage : undefined;
    const message = messageOf(event);
    const text = message == null ? '' : truncateText(textOf(message), MESSAGE_TEXT_MAX);
    const headerConfig = event.type === 'request/header' ? event.data?.header?.config : undefined;
    const note = NOTE_EVENT_TYPES.has(event.type) ? eventNote(event) : null;
    s.events.push({
      seq: event.seq,
      type: event.type,
      time: event.time,
      surface: event.surface,
      actor: actorOf(event),
      error: event.data?.error != null,
      token: usage ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) : 0,
      // The fields below stay Host-side: `/run` ships step metadata only, and
      // `/step` folds these into the step's content panel on demand.
      ...(text ? { text } : {}),
      ...(usage ? { usage: normalizeUsage(usage) } : {}),
      ...(event.type === 'tool/call'
        ? {
          toolName: data.name ?? '',
          toolArgs: toolArgPreview(data.arguments),
          argsText: truncateText(String(data.arguments ?? ''), DETAIL_TEXT_MAX),
        }
        : {}),
      ...(event.type === 'tool/result'
        ? {
          resultText: truncateText(textOf(data.message), DETAIL_TEXT_MAX),
          isError: data.message?.isError === true,
        }
        : {}),
      ...(headerConfig != null ? { provider: headerConfig.provider ?? null, model: headerConfig.model ?? null } : {}),
      ...(note != null ? { note: note.text, noteKind: note.kind } : {}),
    });
  }
  // Renumber steps sequentially by appearance order: raw step numbers can
  // interleave or reset under subagent delegation, so they are not monotonic.
  for (const run of runs) {
    run.steps.forEach((s, idx) => { s.step = idx + 1; });
  }
  return runs;
}

const DEFAULT_SLOW_MS = 5000;

/**
 * Project paired tool calls to a compact, serializable shape (no raw events).
 * `error` is a code/name string (or null) so it survives JSON and can drive UI.
 */
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

/**
 * Phase-1 projection: the run list + KPI for the panel's first paint.
 * Pure tree math — no raw events needed, so a Host can cache `tree/tokens/tools`
 * and re-project cheaply on every request.
 */
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
      // Run duration = sum of its steps' execution time (model + tools, waiting
      // excluded) — the same unit each step row shows (F133).
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
      // F150: waiting for the human is not a slow operation (see the kpi note).
      if (isHumanWaitTool(tool)) continue;
      if (typeof tool.durationMs === 'number' && tool.durationMs > slowMs) hasSlow = true;
    }
    // F142 (corrected): the *step* rows carry the distribution — each step's
    // token track is the run's total and steps fill it cumulatively in order, so
    // no per-step payload is needed here; see `stepTokenSlices`.
    return {
      idx,
      prompt: run.prompt ?? null,
      isSystemPrompt: Boolean(run.isSystemPrompt),
      // The run's subject: the system prompt (run 0) or the user who asked.
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

  // F150: "slow" and "slowest" must mean *work*, not "the user took 13 minutes
  // to answer". A waiting call (ask_user_question / approval) whose delta is a
  // human pause would otherwise win `slowest` — in this session a 13.1min
  // ask_user_question was reported as the slowest operation, which sends the
  // reader looking for a bottleneck in the wrong place.
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
      // R1 realtime (SPEC F140): the log offset this payload was built at, so the
      // client can ask `?since=<seq>` and the Host can answer `unchanged` in 40 B.
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
 * Phase-2 projection: one run's step index, for in-place expansion.
 *
 * Step content (captions, tool arguments/results, model, usage) is served by
 * `buildStepContent` on demand, so this payload stays a few KB per run.
 * Returns null when `idx` is out of range.
 */
/**
 * Step duration exactly as the official trajectory module computes it (SPEC
 * F133 alignment): `assistant/message.time − step/start.time`.
 *
 * Tool execution and "waiting for the human" are NOT part of it — the official
 * UI shows model time on the assistant record and per-tool time on tool records.
 * Returns null when the step has no assistant message (official shows no total).
 */
/**
 * Tools whose duration is a human waiting (answering a question, approving a
 * plan/plugin install). Their time is shown as a separate "wait" figure, never
 * folded into the step's execution time.
 */
const HUMAN_WAIT_TOOLS = new Set(['ask_user_question', 'exit_plan_mode', 'plugin_manager']);
/** A human cannot answer faster than this; below it the call is ordinary work. */
const HUMAN_WAIT_MIN_MS = 5000;
/** True when a tool's duration is a human pause, not execution time (F133/F150). */
function isHumanWaitTool(tool) {
  return HUMAN_WAIT_TOOLS.has(tool.name) && (tool.durationMs ?? 0) >= HUMAN_WAIT_MIN_MS;
}
export function stepModelMs(step) {
  const messages = step.events.filter((leaf) => leaf.type === 'assistant/message' && leaf.time != null);
  if (messages.length === 0) return null;
  const completed = messages[messages.length - 1].time;
  const started = step.startTime;
  if (started == null) return null;
  return Math.max(0, completed - started);
}
/**
 * Split one step's wall time into the parts the UI shows (SPEC F133):
 * `modelMs` (official assistant total), `toolMs` (real tool execution),
 * `waitMs` (human answering/approving) and `timeMs = model + tool`.
 * Waiting is deliberately excluded from `timeMs`.
 */
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
      // Row title (verb + object) and its chip row / status marks (F23.1,
      // F137); `text` stays the raw caption and becomes the row tooltip.
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
    // The run's subject: the system prompt (run 0) or the user who asked.
    actor: run.isSystemPrompt ? 'system' : 'user',
    startTime: minTime === Infinity ? null : minTime,
    endTime: maxTime === -Infinity ? null : maxTime,
    slowMs,
    steps,
    serverMs: opts.serverMs ?? null,
  };
}

/**
 * Phase-3 projection: one step's ordered activity trace, for the expanded
 * container — no nesting, no separate per-type groups.
 *
 * `operations` follows the step's leaf `seq` order and folds each `tool/result`
 * into its `tool/call` row. Fields follow the native data contract (SPEC §1.1.2):
 * 概述 (`assistant.text`), 参数 (`tool.args`), 结果 (`tool.result`), 计时, Token,
 * 模型. Returns null when the run or step index is out of range.
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
  const pairedResultSeqs = new Set();
  for (const tool of toolByCall.values()) {
    if (tool.resultSeq != null) pairedResultSeqs.add(tool.resultSeq);
  }

  const counts = { models: 0, tools: 0, contexts: 0 };
  // Tool names in this step: a `deliverables`/`todo` note is skipped when the
  // matching tool row (present / todo_write) is already on screen.
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
      // Already folded into its call row (SPEC F129).
      if (pairedResultSeqs.has(leaf.seq)) continue;
      continue;
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
    // Events with no text of their own (compaction, retries, file changes,
    // slash commands, approvals …) used to be dropped here; they carry the
    // explanation for a slow or empty-looking step (F23.2).
    if (leaf.note) {
      // Do not repeat what the tool row right above already says.
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
    // `request/header` events only mark epoch starts, so fall back to the most
    // recent header at or before the step (including earlier runs).
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

/**
 * The model that served this step: the nearest `request/header` at or before it.
 * `request/header` marks epoch changes (not every call), so a step usually has
 * none of its own; walk back through the run and then earlier runs.
 */
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

/**
 * The step's own visible text: assistant → user → developer/system.
 * Returns null for tool-only steps.
 */
function stepNarrativeLeaf(step) {
  for (const type of ['assistant/message', 'user/message', 'developer/message', 'system/message']) {
    const leaf = step.events.find((event) => event.type === type && event.text);
    if (leaf !== undefined) return leaf;
  }
  return undefined;
}

/** The step's narrative text, or null for tool-only steps. */
function stepNarrative(step) {
  const leaf = stepNarrativeLeaf(step);
  return leaf === undefined ? null : leaf.text;
}

/**
 * The step's one-line caption: its narrative text, or the tools it called.
 * Returns null when the step has neither.
 */
function stepCaption(step, stepTools) {
  const narrative = stepNarrative(step);
  if (narrative != null) return narrative;
  const names = [...new Set(stepTools.map((tool) => tool.name).filter(Boolean))];
  if (names.length === 0) return null;
  // A single tool call reads best with its argument preview; several calls only
  // have room for their names.
  if (names.length === 1) {
    const call = step.events.find((event) => event.type === 'tool/call' && event.toolArgs);
    return call === undefined ? `tool · ${names[0]}` : `tool · ${names[0]} · ${call.toolArgs}`;
  }
  return `tool · ${names.slice(0, 3).join(', ')}`;
}

// ---------------------------------------------------------------------------
// Step title (SPEC F23.1). The row shows "verb + object" plus a muted suffix
// and at most two status marks; the raw caption stays in `text` and becomes the
// row's tooltip, so nothing is lost by compressing the title.
// ---------------------------------------------------------------------------

const TOOL_VERB = {
  read: '读取', read_image: '看图', edit: '修改', write: '写', grep: '搜', glob: '找',
  pwsh: '运行', present: '交付', plugin_manager: '插件', skill: '技能', todo_write: '清单',
  ask_user_question: '提问', web_search: '搜网', web_fetch: '抓', cordis_inspect_query: '查',
  cordis_inspect_list: '查', exit_plan_mode: '计划', load_workspace_dependencies: '取环境',
  subagent: '派发', subagent_fork: '派发', create_goal: '建目标', get_goal: '读目标',
  update_goal: '目标', schedule_create: '定时', schedule_list: '看定时', update_plan: '计划',
};

const NOTE_PRIORITY = {
  fail: 0, retry: 1, compact: 2, deliver: 3, command: 4, workspace: 5,
  plan: 6, todo: 7, approval: 8, inject: 9,
};

function clipLine(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/** First real command line of a shell script (drops leading VAR=… statements). */
function cmdHead(command) {
  const lines = String(command ?? '').replace(/\r/g, '').split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const isAssignment = (line) => /^\$?[\w-]+\s*=/.test(line);
  const line = lines.find((candidate) => !isAssignment(candidate)) ?? '';
  return line.replace(/\s+/g, ' ').trim();
}

function urlLabel(value) {
  try {
    const url = new URL(String(value));
    return url.pathname && url.pathname !== '/' ? fileBase(url.pathname) : url.host;
  } catch {
    return clipLine(value, 24);
  }
}

/** First string of a top-level array of strings (e.g. `web_search.queries`). */
function argFirstArrayString(text, key) {
  const raw = String(text ?? '');
  const at = raw.indexOf('"' + key + '"');
  if (at < 0) return null;
  const start = raw.indexOf('[', at);
  if (start < 0) return null;
  const open = raw.indexOf('"', start);
  if (open < 0) return null;
  let out = '';
  for (let i = open + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\') { out += raw[i + 1] ?? ''; i += 1; continue; }
    if (ch === '"') return out;
    out += ch;
  }
  return out;
}

/**
 * Read one top-level field out of an arguments JSON text *without parsing it*.
 *
 * Leaves keep only a 400-char head of the arguments (`argsText`), which
 * `JSON.parse` rejects on every write/edit call — parsing there would also cost
 * several ms on the first-paint budget (P02). These scanners walk the head and
 * tolerate truncation.
 */
function argString(text, key) {
  const raw = String(text ?? '');
  const at = raw.indexOf('"' + key + '"');
  if (at < 0) return null;
  let i = raw.indexOf(':', at + key.length + 2);
  if (i < 0) return null;
  i += 1;
  while (i < raw.length && raw[i] !== '"') {
    if (!/\s/.test(raw[i])) return null; // not a string value
    i += 1;
  }
  if (i >= raw.length) return null;
  i += 1;
  let out = '';
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\') {
      const next = raw[i + 1];
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next ?? '';
      i += 2;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
    i += 1;
  }
  return out; // truncated head: use what we have
}

function argNumber(text, key) {
  const raw = String(text ?? '');
  const at = raw.indexOf('"' + key + '"');
  if (at < 0) return null;
  const i = raw.indexOf(':', at + key.length + 2);
  if (i < 0) return null;
  const match = /^\s*(-?\d+(?:\.\d+)?)/.exec(raw.slice(i + 1, i + 32));
  return match ? Number(match[1]) : null;
}

/** Length of a top-level array of objects (files / todos / questions). */
function argArrayLength(text, key) {
  const raw = String(text ?? '');
  const at = raw.indexOf('"' + key + '"');
  if (at < 0) return 0;
  const start = raw.indexOf('[', at);
  if (start < 0) return 0;
  let depth = 0;
  let count = 0;
  for (let i = start + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      i += 1;
      while (i < raw.length && raw[i] !== '"') { if (raw[i] === '\\') i += 1; i += 1; }
      continue;
    }
    if (ch === '{') {
      if (depth === 0) count += 1;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
    } else if (ch === ']' && depth <= 0) {
      return count;
    }
  }
  return count;
}

/** "读取 client.js:226" — the object is the first named field, never the raw JSON. */
function toolTitle(name, argsText) {
  const text = String(argsText ?? '');
  const str = (key) => argString(text, key);
  const file = str('file_path') ?? str('path') ?? str('filename') ?? str('file');
  const verb = TOOL_VERB[name];
  switch (name) {
    case 'read': {
      if (!file) return '读取文件';
      // DSH spills oversized tool output to `dsh-spill-*/<uuid>-<tool>.txt`;
      // those names are unreadable, the concept is not.
      if (/[\\/]dsh-spill[^\\/]*[\\/]/.test(file)) return '读取 工具输出';
      const base = fileBase(file);
      const clipped = clipLine(base, 26);
      // A clipped name keeps no line number: `…cordis_inspe…:1720` is noise.
      const offset = argNumber(text, 'offset');
      const at = offset != null && offset > 0 && clipped === base ? ':' + offset : '';
      return `读取 ${clipped}${at}`;
    }
    case 'read_image': return file ? `看图 ${clipLine(fileBase(file), 26)}` : '看图';
    case 'edit': return file ? `修改 ${clipLine(fileBase(file), 26)}` : '修改文件';
    case 'write': return file ? `写 ${clipLine(fileBase(file), 26)}` : '写文件';
    case 'grep': {
      const pattern = clipLine(str('pattern'), 20);
      return pattern ? `搜 「${pattern}」` : '搜索';
    }
    case 'glob': {
      const pattern = str('pattern');
      return pattern ? `找 ${clipLine(pattern, 26)}` : '找文件';
    }
    case 'pwsh': {
      const desc = clipLine(str('description'), 34);
      if (desc) return `运行 · ${desc}`;
      const head = cmdHead(str('command'));
      return head ? `运行 · ${clipLine(head, 30)}` : '运行命令';
    }
    case 'present': {
      const n = argArrayLength(text, 'files');
      return n > 1 ? `交付 ${n} 个文件` : '交付文件';
    }
    case 'plugin_manager': {
      const action = str('action');
      return action ? `插件 ${action}` : '插件管理';
    }
    case 'skill': {
      const skill = str('name');
      return skill ? `技能 ${clipLine(skill, 24)}` : '加载技能';
    }
    case 'todo_write': {
      const n = argArrayLength(text, 'todos');
      return n > 0 ? `清单 ${n} 项` : '更新清单';
    }
    case 'ask_user_question': {
      const n = argArrayLength(text, 'questions');
      return n > 0 ? `提问 ${n} 问` : '提问';
    }
    case 'web_search': return `搜网 ${clipLine(argFirstArrayString(text, 'queries'), 22)}`;
    case 'web_fetch': {
      const url = str('url');
      return url ? `抓 ${urlLabel(url)}` : '抓网页';
    }
    case 'cordis_inspect_query': {
      const method = str('method');
      return method ? `查 ${clipLine(method, 22)}` : '查运行时';
    }
    case 'cordis_inspect_list': return '查运行时清单';
    case 'load_workspace_dependencies': return '取运行环境';
    case 'exit_plan_mode': return '提交计划';
    default:
      if (verb) return verb;
      return name ? `tool · ${name}` : 'tool';
  }
}
/** First sentence, markdown stripped; never cuts inside an unclosed bracket. */
function firstSentence(text) {
  const flat = truncateText(text, MESSAGE_TEXT_MAX)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/[>*#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return '';
  let cut = flat;
  const match = flat.match(/^(.{0,60}?[。！？；!?;])/);
  if (match) cut = match[1];
  if (cut.length > 42) {
    const head = cut.slice(0, 42);
    const open = Math.max(head.lastIndexOf('（'), head.lastIndexOf('('));
    const close = Math.max(head.lastIndexOf('）'), head.lastIndexOf(')'));
    let at = Math.max(head.lastIndexOf('，'), head.lastIndexOf('、'), head.lastIndexOf('；'), head.lastIndexOf('：'), head.lastIndexOf(' '));
    if (open > close && open > 12) at = open;
    if (at < 14) at = 41;
    cut = head.slice(0, at).replace(/[，、；：\s]+$/, '') + '…';
  }
  return cut;
}

/**
 * Distinct actions of one step, in first-call order (F137).
 *
 * A step used to show **one** chip, which hid the steps that do two different
 * things (read then run, inspect then fetch). Each distinct verb becomes its own
 * chip; repeats of the same verb fold into a count (`修改 ×6`) instead of eating
 * a second slot — most multi-call steps are repeats, so the row stays at one or
 * two chips almost everywhere.
 */
const MAX_STEP_CHIPS = 3;

// Fallback titles ("运行命令", "写文件", …) collapse into a short chip so the
// row does not repeat the same word twice (F135).
const LEAD_TAG = {
  运行命令: '运行', 写文件: '写', 读取文件: '读取', 修改文件: '修改', 找文件: '找',
  交付文件: '交付', 查运行时: '查', 查运行时清单: '查', 抓网页: '抓', 搜索: '搜',
};

const leadTag = (value) => {
  const word = String(value).split(' ')[0];
  if (word === 'tool') return '工具';
  return LEAD_TAG[word] ?? word;
};

/**
 * A chip is always named the way this step's lead chip would be named, so a
 * step can never show `取运行环境` and `取环境` as two different actions, and
 * every chip resolves through the same `STEP_TAG_EN` table the client renders.
 *
 * The table is the *title-word* form of each tool (not `TOOL_VERB`): chips need
 * no argument scan, which keeps the first-paint build (P02) flat — the 92% of
 * steps with one call never enter this function at all.
 */
const CALL_VERB = {
  read: '读取', read_image: '看图', edit: '修改', write: '写', grep: '搜', glob: '找',
  pwsh: '运行', present: '交付', plugin_manager: '插件', skill: '技能', todo_write: '清单',
  ask_user_question: '提问', web_search: '搜网', web_fetch: '抓', cordis_inspect_query: '查',
  cordis_inspect_list: '查', load_workspace_dependencies: '取运行环境', exit_plan_mode: '提交计划',
  subagent: '派发', subagent_fork: '派发', create_goal: '建目标', get_goal: '读目标',
  update_goal: '目标', schedule_create: '定时', schedule_list: '看定时', update_plan: '计划',
};

function actionChips(calls) {
  const order = [];
  const counts = new Map();
  for (const call of calls) {
    const verb = CALL_VERB[call.toolName] ?? '工具';
    if (!counts.has(verb)) {
      counts.set(verb, 0);
      order.push(verb);
    }
    counts.set(verb, counts.get(verb) + 1);
  }
  return order.map((verb) => ({ tag: verb, count: counts.get(verb) }));
}

/**
 * Lead chip + up to two action chips, then one overflow chip (`+N`) so a step
 * can never unbalance the row. The lead keeps its own count when it also owns
 * tool calls (so `EDIT ×6` still reads as one action, not six chips).
 */
function packChips(lead, chips) {
  const out = lead != null ? [{ ...lead }] : [];
  for (const chip of chips) {
    const same = lead != null ? out.find((shown) => shown.tag === lead.tag) : null;
    if (lead != null && chip.tag === lead.tag) {
      // The lead names the same action: fold the calls into its count.
      same.count = Math.max(same.count ?? 1, chip.count);
      continue;
    }
    if (out.length >= MAX_STEP_CHIPS) break;
    out.push(chip);
  }
  const shown = new Set(out.map((chip) => chip.tag));
  const rest = chips.filter((chip) => !shown.has(chip.tag)).length;
  if (rest > 0) out.push({ tag: '+' + rest, count: 1, overflow: true });
  return out;
}

/** `{ title, suffix, marks: [{ text, tone }] }` for one step row. */
export function stepTitle(step) {
  const calls = step.events.filter((event) => event.type === 'tool/call');
  const texts = step.events.filter((event) => event.type === 'assistant/message' && event.text);
  const notes = [];
  const seenNote = new Set();
  const seenKind = new Set();
  for (const leaf of step.events) {
    if (!leaf.note || seenNote.has(leaf.note)) continue;
    seenNote.add(leaf.note);
    const kind = leaf.noteKind ?? 'note';
    // One mark per kind: retries would otherwise repeat as "重试 1/5 · 重试 2/5".
    if (seenKind.has(kind)) continue;
    seenKind.add(kind);
    notes.push({ kind, text: leaf.note });
  }
  notes.sort((a, b) => (NOTE_PRIORITY[a.kind] ?? 20) - (NOTE_PRIORITY[b.kind] ?? 20));
  const deliver = notes.find((note) => note.kind === 'deliver');

  // Tag-style naming (F135): every title is a chip row (`tags`) plus an object
  // text. F137 lets that row carry the step's distinct actions instead of one.
  let title = '';
  let tag = null;
  let tags = [];
  if (texts.length > 0) {
    title = firstSentence(texts[0].text);
    tag = '回复';
    tags = packChips({ tag, count: 1 }, actionChips(calls));
  } else if (calls.length === 1) {
    title = toolTitle(calls[0].toolName, calls[0].argsText);
    if (calls[0].toolName === 'present' && deliver) title = deliver.text;
    tag = leadTag(title);
    // One call = one chip, already named by the title: skip the per-call scan
    // (this is 92% of steps, and it is on the first-paint path — P02).
    tags = [{ tag, count: 1 }];
  } else if (calls.length > 1) {
    title = toolTitle(calls[0].toolName, calls[0].argsText);
    tag = leadTag(title);
    tags = packChips({ tag, count: 1 }, actionChips(calls));
  } else if (notes.length > 0) {
    title = notes[0].text;
    tag = leadTag(title);
    tags = [{ tag, count: 1 }];
  } else if (step.events.some((event) => event.type === 'assistant/message')) {
    // A model call that returned no text and no tool calls: the step burned
    // time and produced nothing, which is exactly what the row should say.
    title = '空回复';
    tag = '空回复';
    tags = [{ tag, count: 1 }];
  } else if (step.events.some((event) => event.type === 'system/message' && event.text)) {
    title = '系统提示词';
    tag = '系统提示词';
    tags = [{ tag, count: 1 }];
  } else if (step.events.some((event) => (event.actor === 'context' || event.actor === 'system') && event.text)) {
    title = '仅注入上下文';
    tag = '仅注入上下文';
    tags = [{ tag, count: 1 }];
  } else if (step.events.some((event) => event.type === 'tool/result')) {
    title = '返回结果';
    tag = '返回结果';
    tags = [{ tag, count: 1 }];
  } else {
    title = '—';
    tags = [];
  }

  const marks = notes
    .filter((note) => note.text !== title && !title.includes(note.text))
    .filter((note) => !(note.kind === 'inject' && notes.length > 1))
    .slice(0, 2)
    .map((note) => ({ text: note.text, tone: note.kind === 'fail' ? 'error' : note.kind === 'retry' ? 'warn' : 'muted' }));

  return { title: clipLine(title, 46) || '—', tag, tags, marks };
}

function sumStepTokens(step) {  let total = 0;
  for (const leaf of step.events) total += leaf.token ?? 0;
  return total;
}

function countLeaves(run) {
  let total = 0;
  for (const step of run.steps) total += step.events.length;
  return total;
}
