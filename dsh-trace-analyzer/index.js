/**
 * Host half of the Trace analyzer bundle.
 *
 * Exposes the Host `sessionQuery` read APIs to the Client through read-only
 * JSON routes behind the connection trust fence, following the exact pattern
 * of `@deepseek-ai/dsh-host-open-in-app` (webServer routes + requestRejection).
 *
 * Loading is phase-split (see agent.md §4.7): the panel first asks for the
 * lightweight run list (`/runs`), then one run's steps on expansion (`/run`),
 * then a single raw event only when the user opens its JSON (`/event`).
 * Raw session events never travel in bulk, so the payload stays KB-sized.
 */
import {
  buildRunsPayload,
  buildRunsPayloadFrom,
  buildRunDetail,
  buildStepContent,
} from './lib/aggregate.js';

export const inject = ['webServer', 'connection', 'sessionQuery'];

const PREFIX = '/api/trace-analyzer';
const SNAPSHOT_MAX = 4;
/** Bumped whenever the Host half changes; the loopback health probe reports it. */
const HOST_REV = 'm8.10';
const ROUTES = ['runs', 'run', 'step', 'event', 'events', 'session', 'lineage', 'event-trace'];

export function apply(ctx) {
  // sessionId -> { seqCount, header, eventCount, tree, tokens, tools }
  // Keyed by the event count so a growing (live) session is re-read exactly
  // once per change, not once per request.
  const snapshots = new Map();
  /** Last cold rebuild: { ms, events, at } — reported by the loopback probe. */
  let lastBuild = null;
  /** F140: how many polls were answered with a 40 B unchanged reply. */
  let unchangedHits = 0;

  /**
   * Snapshot cache footprint. The cache holds ONE entry per session (the latest
   * log offset), so the bound is sessions × (tree + tokens + tools). On this
   * machine one entry of a 17k-event session measures ~5.9 MB, i.e. the whole
   * cache tops out at ~24 MB with SNAPSHOT_MAX = 4 instead of ~47 MB at 8.
   */
  const cacheStats = () => ({
    sessions: snapshots.size,
    max: SNAPSHOT_MAX,
    events: [...snapshots.values()].reduce((sum, entry) => sum + (entry.eventCount ?? 0), 0),
    seqs: [...snapshots.values()].map((entry) => entry.eventCount ?? 0),
    unchangedHits,
    lastBuild,
  });

  const touch = (key, value) => {
    snapshots.delete(key);
    snapshots.set(key, value);
    while (snapshots.size > SNAPSHOT_MAX) {
      snapshots.delete(snapshots.keys().next().value);
    }
  };

  /**
   * Read one session's header + events through the cheapest correct path.
   *
   * The built-in trajectory reads the live Session's in-memory log; for a live
   * session the same log is reachable here via `inspectSession`, which costs
   * ~0 ms instead of the persistence read + replay validation (~900 ms on a
   * 5 MB live log). Cold/persisted sessions fall back to `readSession`.
   */
  const readSessionEvents = async (sessionId) => {
    try {
      const live = await ctx.sessionQuery.inspectSession(sessionId, (session) => ({
        header: session.header,
        events: session.snapshotEvents(),
      }));
      if (live != null && Array.isArray(live.events) && live.events.length > 0) {
        return { events: live.events, header: slimHeader(live.header) };
      }
    } catch {
      // Cold, not-live or unavailable: fall back to the persistence read below.
    }
    const snapshot = await ctx.sessionQuery.readSession(sessionId);
    return { events: snapshot.events, header: slimHeader(snapshot.session) };
  };

  const snapshotFor = async (sessionId) => {
    // Cheap version probe: the live/cold session's current log offset. Never
    // pulls the event payload, so a cache hit costs a few microseconds.
    let seq = null;
    try {
      seq = await ctx.sessionQuery.inspectSession(sessionId, (session) => session.seq);
    } catch {
      seq = null;
    }
    const hit = snapshots.get(sessionId);
    if (hit !== undefined && seq != null && hit.seq === seq) {
      touch(sessionId, hit);
      return hit;
    }
    const { events, header } = await readSessionEvents(sessionId);
    const buildStarted = performance.now();
    const built = buildRunsPayload(events, { header, eventCount: events.length });
    lastBuild = { ms: Math.round((performance.now() - buildStarted) * 10) / 10, events: events.length, at: Date.now() };
    const entry = {
      seq: seq ?? events.length,
      header,
      eventCount: events.length,
      tree: built.tree,
      tokens: built.tokens,
      tools: built.tools,
    };
    touch(sessionId, entry);
    return entry;
  };

  const sendJson = (res, status, payload) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
  };

  const rejected = (req, res) => {
    const rejection = ctx.connection.requestRejection(req);
    if (rejection === undefined) return false;
    res.statusCode = rejection;
    res.end();
    return true;
  };

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      const started = performance.now();
      const url = new URL(String(req.url), 'http://localhost');
      const op = url.pathname.slice(PREFIX.length).replace(/^\//, '');
      // Loopback-only liveness probe: constant metadata, no session data, so it
      // can stay outside the connection fence and prove which Host build is
      // actually loaded (acceptance evidence, see TEST P09).
      if (op === 'health' && isLoopback(req)) {
        // `cache` makes the plugin's own Host-side footprint observable: after a
        // lag report we can tell whether the snapshots are the thing growing.
        sendJson(res, 200, { ok: true, plugin: '@local/dsh-trace-analyzer', hostRev: HOST_REV, routes: ROUTES, cache: cacheStats(), uptimeMs: Math.round(performance.now()) });
        return;
      }
      // Loopback-only bench: measures the real route code path (readSession →
      // projection → JSON.stringify) and reports sizes/timings/counts only.
      // It returns no session content, so it can sit outside the fence and make
      // the performance acceptance (TEST §5) re-runnable against the live Host.
      if (op === 'bench' && isLoopback(req)) {
        try {
        const benchSessionArg = url.searchParams.get('sessionId') ?? '';
        let benchSession = benchSessionArg;
        let resolved = null;
        if (benchSessionArg === '' || benchSessionArg === 'latest') {
          const records = await ctx.sessionQuery.listSessions();
          const liveRecords = records.filter((record) => record.live);
          // "latest" = the live session with the most events (the one the user is
          // working in), measured through the cheap seq probe.
          let best = null;
          for (const record of liveRecords) {
            const id = record.header?.id;
            if (id == null) continue;
            let seq = 0;
            try {
              seq = await ctx.sessionQuery.inspectSession(id, (session) => session.seq);
            } catch {
              seq = 0;
            }
            if (best == null || seq > best.seq) best = { id, seq };
          }
          benchSession = best?.id ?? records[0]?.header?.id ?? '';
          resolved = { total: records.length, live: liveRecords.length, pickedLive: best != null, seq: best?.seq ?? null };
        }
        const probeStarted = performance.now();
        let probeSeq = null;
        let probeError = null;
        try {
          probeSeq = await ctx.sessionQuery.inspectSession(benchSession, (session) => session.seq);
        } catch (error) {
          probeError = String(error && typeof error === 'object' && 'message' in error ? error.message : error).slice(0, 200);
        }
        const probeMs = elapsed(probeStarted);
        // Production path timing: exactly what `/runs` does (probe + live-log
        // read + projection + stringify), plus the cold `readSession` for contrast.
        const prodStarted = performance.now();
        const prodSnapshot = await snapshotFor(benchSession);
        const prodPayload = buildRunsPayloadFrom(prodSnapshot.tree, prodSnapshot.tokens, prodSnapshot.tools, {
          header: prodSnapshot.header,
          eventCount: prodSnapshot.eventCount,
          sessionId: benchSession,
        });
        const prodText = JSON.stringify(prodPayload);
        const prodMs = elapsed(prodStarted);
        const coldStarted = performance.now();
        let coldReadMs = null;
        let coldError = null;
        try {
          await ctx.sessionQuery.readSession(benchSession);
        } catch (error) {
          coldError = String(error && typeof error === 'object' && 'message' in error ? error.message : error).slice(0, 200);
        }
        coldReadMs = elapsed(coldStarted);
        const tree = prodSnapshot.tree;
        const tools = prodSnapshot.tools;
        const detailStarted = performance.now();
        const detailSizes = [];
        const titleSamples = [];
        let stepsSeen = 0;
        let stepsWithMarks = 0;
        let stepsWithChips = 0;
        let stepsWithMultiChips = 0;
        let streamHits = (prodText.match(/"stream"/g) ?? []).length;
        for (let i = 0; i < tree.length; i++) {
          const detail = buildRunDetail(tree, tools, i);
          const text = JSON.stringify(detail);
          detailSizes.push(Buffer.byteLength(text));
          streamHits += (text.match(/"stream"/g) ?? []).length;
          for (const step of detail.steps) {
            stepsSeen += 1;
            if ((step.marks ?? []).length > 0) stepsWithMarks += 1;
            const chips = step.tags ?? [];
            if (chips.length > 0) stepsWithChips += 1;
            if (chips.length > 1) stepsWithMultiChips += 1;
            if (titleSamples.length < 10) {
              const marks = (step.marks ?? []).map((mark) => mark.text);
              const chipText = chips.map((chip) => (chip.overflow ? chip.tag : chip.tag + (chip.count > 1 ? '×' + chip.count : ''))).join(' ');
              titleSamples.push(`run ${i}/step ${step.step}  [${chipText}] ${step.title}${marks.length > 0 ? '  「' + marks.join(' · ') + '」' : ''}`);
            }
          }
        }
        const detailMs = elapsed(detailStarted);
        const stepStarted = performance.now();
        const stepSizes = [];
        const noteSamples = [];
        let noteOps = 0;
        for (let runIdx = 0; runIdx < tree.length; runIdx++) {
          const run = tree[runIdx];
          for (let stepIdx = 0; stepIdx < run.steps.length; stepIdx++) {
            const content = buildStepContent(tree, tools, runIdx, stepIdx);
            if (content == null) continue;
            const text = JSON.stringify(content);
            stepSizes.push(Buffer.byteLength(text));
            streamHits += (text.match(/"stream"/g) ?? []).length;
            for (const op of content.operations ?? []) {
              if (op.kind !== 'note') continue;
              noteOps += 1;
              if (noteSamples.length < 8) noteSamples.push(`${op.noteKind}: ${op.text}`);
            }
          }
        }
        const stepMs = elapsed(stepStarted);
        const sortedSteps = [...stepSizes].sort((a, b) => a - b);
        const sorted = [...detailSizes].sort((a, b) => a - b);
        sendJson(res, 200, {
          ok: true,
          hostRev: HOST_REV,
          sessionId: benchSession,
          resolved,
          probeSeq,
          probeMs,
          probeError,
          events: prodSnapshot.eventCount,
          runs: tree.length,
          steps: prodPayload.counts.steps,
          runsPayloadBytes: Buffer.byteLength(prodText),
          runsRouteMs: prodMs,
          coldReadMs,
          coldError,
          detailBytes: {
            median: sorted[Math.floor(sorted.length / 2)] ?? 0,
            p90: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? 0,
            max: sorted[sorted.length - 1] ?? 0,
            all: detailSizes.reduce((a, b) => a + b, 0),
          },
          detailMs,
          stepBytes: {
            median: sortedSteps[Math.floor(sortedSteps.length / 2)] ?? 0,
            p95: sortedSteps[Math.min(sortedSteps.length - 1, Math.floor(sortedSteps.length * 0.95))] ?? 0,
            max: sortedSteps[sortedSteps.length - 1] ?? 0,
            all: stepSizes.reduce((a, b) => a + b, 0),
          },
          stepMs,
          streamHits,
          titles: { steps: stepsSeen, withMarks: stepsWithMarks, withChips: stepsWithChips, multiChips: stepsWithMultiChips, samples: titleSamples },
          notes: { total: noteOps, samples: noteSamples },
          kpi: prodPayload.kpi,
          tokens: prodPayload.tokens.total,
        });
        } catch (error) {
          sendJson(res, 500, { code: 'bench-error', message: error && typeof error === 'object' && 'stack' in error ? String(error.stack).slice(0, 600) : String(error) });
        }
        return;
      }
      if (rejected(req, res)) return;
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('allow', 'GET');
        res.end();
        return;
      }
      const sessionId = url.searchParams.get('sessionId') ?? '';
      const seq = Number(url.searchParams.get('seq'));
      const idx = Number(url.searchParams.get('idx'));
      const before = Number(url.searchParams.get('before') ?? 0);
      const after = Number(url.searchParams.get('after') ?? 0);
      try {
        switch (op) {
          case 'runs': {
            const snapshot = await snapshotFor(sessionId);
            // R1 realtime (SPEC F140): a polling client sends the offset it
            // already has. Unchanged ⇒ answer in ~40 B instead of 50 KB, and the
            // client skips parsing + re-rendering entirely.
            const since = Number(url.searchParams.get('since'));
            if (Number.isInteger(since) && since >= 0 && snapshot.seq === since) {
              unchangedHits += 1;
              sendJson(res, 200, { ok: true, unchanged: true, seq: snapshot.seq, serverMs: elapsed(started) });
              return;
            }
            sendJson(res, 200, buildRunsPayloadFrom(snapshot.tree, snapshot.tokens, snapshot.tools, {
              header: snapshot.header,
              eventCount: snapshot.eventCount,
              sessionId,
              seq: snapshot.seq,
              serverMs: elapsed(started),
              generatedAt: Date.now(),
            }));
            return;
          }
          case 'run': {
            if (!Number.isInteger(idx) || idx < 0) {
              sendJson(res, 400, { code: 'bad-request', message: 'idx is required' });
              return;
            }
            const snapshot = await snapshotFor(sessionId);
            const detail = buildRunDetail(snapshot.tree, snapshot.tools, idx, { serverMs: elapsed(started) });
            if (detail == null) {
              sendJson(res, 404, { code: 'not-found', message: `run ${idx} does not exist` });
              return;
            }
            sendJson(res, 200, detail);
            return;
          }
          case 'step': {
            const stepIdx = Number(url.searchParams.get('step'));
            if (!Number.isInteger(idx) || idx < 0 || !Number.isInteger(stepIdx) || stepIdx < 0) {
              sendJson(res, 400, { code: 'bad-request', message: 'idx and step are required' });
              return;
            }
            const snapshot = await snapshotFor(sessionId);
            const content = buildStepContent(snapshot.tree, snapshot.tools, idx, stepIdx, {
              serverMs: elapsed(started),
            });
            if (content == null) {
              sendJson(res, 404, { code: 'not-found', message: `run ${idx} step ${stepIdx} does not exist` });
              return;
            }
            sendJson(res, 200, content);
            return;
          }
          case 'events':
            sendJson(res, 200, await ctx.sessionQuery.listEvents(sessionId));
            return;
          case 'session':
            sendJson(res, 200, await ctx.sessionQuery.readSession(sessionId));
            return;
          case 'event':
            if (!Number.isFinite(seq)) {
              sendJson(res, 400, { code: 'bad-request', message: 'seq is required' });
              return;
            }
            sendJson(res, 200, await ctx.sessionQuery.readEvent({ sessionId, seq, before, after }));
            return;
          case 'lineage':
            sendJson(res, 200, await ctx.sessionQuery.traceSession(sessionId));
            return;
          case 'event-trace':
            if (!Number.isFinite(seq)) {
              sendJson(res, 400, { code: 'bad-request', message: 'seq is required' });
              return;
            }
            sendJson(res, 200, await ctx.sessionQuery.traceEvent({ sessionId, seq }));
            return;
          default:
            sendJson(res, 404, { code: 'not-found', message: `unknown operation: ${op}` });
            return;
        }
      } catch (error) {
        const message = error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error);
        sendJson(res, 500, { code: 'error', message });
      }
    },
  }), 'trace-analyzer: sessionQuery routes');
}

function elapsed(started) {
  return Math.round((performance.now() - started) * 10) / 10;
}

/** True only for a request that came in over the loopback interface. */
function isLoopback(req) {
  const remote = req.socket?.remoteAddress ?? '';
  const address = remote.startsWith('::ffff:') ? remote.slice(7) : remote;
  if (address !== '127.0.0.1' && address !== '::1') return false;
  const host = String(req.headers?.host ?? '').toLowerCase();
  return host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('[::1]');
}

/** Keep only the header fields the panel shows; never ship the whole record. */
function slimHeader(session) {
  if (session == null) return null;
  const header = session.header ?? session;
  return {
    id: header.id ?? null,
    createdAt: header.createdAt ?? null,
    cwd: header.cwd ?? null,
    parentSession: header.parentSession ?? null,
    agentPreset: header.agentPreset ?? null,
    delegationDepth: header.delegationDepth ?? null,
    origin: header.origin ?? null,
  };
}
