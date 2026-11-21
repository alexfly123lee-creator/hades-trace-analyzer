/**
 * Trace tree: raw SessionEvent[] -> run -> step -> leaf (synchronous, pure).
 * Leaves keep text, usage, tool args/results and notes so the projections in
 * project.js never touch a raw event again.
 */

/** Extract the visible text from a message's content blocks. */
function textOf(message) {
  const blocks = message?.content;
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

const MESSAGE_TEXT_MAX = 400;
const DETAIL_TEXT_MAX = 400;

export function truncateText(value, max = MESSAGE_TEXT_MAX) {
  const raw = String(value ?? '');
  // Collapse whitespace on a bounded head only: results can be megabytes.
  const head = raw.length > max + 64 ? raw.slice(0, max + 64) : raw;
  const text = head.replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}

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

/** Who speaks (SPEC F131), in the built-in Trajectory's cell vocabulary. */
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

/** First string argument (command, path, pattern) instead of the raw JSON. */
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

export function fileBase(path) {
  const parts = String(path ?? '').split(/[\\/]/);
  return parts[parts.length - 1] || String(path ?? '');
}

// Only these events carry a note; checked before eventNote() so the per-event
// switch stays off the first-paint path (P02).
const NOTE_EVENT_TYPES = new Set([
  'assistant/attempt', 'llm/retry', 'compaction/prune', 'compaction/summary',
  'workspace/changes', 'command/run', 'plan/mode', 'todo/write',
  'deliverables/presented', 'approval/asked',
]);

/** `{ kind, text }` for events with no visible text of their own, or null. */
function eventNote(event) {
  const data = event.data ?? {};
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
      // The failure code lives on assistant/attempt; keep this a pure counter.
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

/**
 * Build session -> run (run0 = system prompt) -> step, aligned to DSH's model.
 *
 * Only a REAL user message (`data.source.kind === 'user'`) opens a run; context
 * injections do not. A step's window is bracketed by the log's own step/start /
 * step/end markers (SPEC F133): events attach by `data.step`, otherwise they
 * join the open step, and a turn's tail joins its last step but never extends
 * its window. Events after turn/end (the next user splice) are never glued on.
 * Steps are renumbered by appearance order (raw numbers reset under delegation).
 */
export function buildTraceTree(events) {
  const runs = [];
  let run = null;
  let stepsByNum = new Map();
  let current = null;    // step opened by step/start, closed by step/end
  let turnOpen = false;  // between turn/start and turn/end
  let tailStep = null;   // the step that just ended in the CURRENT turn
  let pendingTurn = null;
  // Markers live outside runs: a turn's step/start can precede its user message.
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

  // Fallback only: without a marker pair the window is the leaves' min/max.
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
    // The queued next message must not stretch the current step's time.
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
      // Only materialise when the open run owns this turn; else wait for it.
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
    // Turn tail: shown on this turn's last step, without extending its window.
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
      // Host-side only: `/run` ships step metadata, `/step` folds these on demand.
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
  for (const run of runs) {
    run.steps.forEach((s, idx) => { s.step = idx + 1; });
  }
  return runs;
}
