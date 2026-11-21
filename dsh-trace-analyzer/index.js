/**
 * Host half of the Trace analyzer bundle: the Host `sessionQuery` read APIs as
 * read-only JSON routes behind the connection trust fence (same pattern as
 * `@deepseek-ai/dsh-host-open-in-app`). Loading is phase-split: `/runs` (first
 * paint), `/run` (step index), `/step` (one step) and `/event` (one raw event).
 */
import { buildRunsPayload, buildRunsPayloadFrom, buildRunDetail, buildStepContent } from './lib/project.js';
import { elapsed, runBench } from './lib/bench.js';

export const inject = ['webServer', 'connection', 'sessionQuery'];

const PREFIX = '/api/trace-analyzer';
const SNAPSHOT_MAX = 4;
const EVENT_CACHE_MAX = 256;
/** Bumped whenever the Host half changes; the loopback health probe reports it. */
const HOST_REV = 'm9.0';

const ok = (body) => ({ status: 200, body });
const fail = (status, code, message) => ({ status, body: { code, message } });

/** One small LRU behind both caches: writes refresh recency, overflow evicts oldest. */
function lruMap(max) {
  const map = new Map();
  return {
    get: (key) => map.get(key),
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      while (map.size > max) map.delete(map.keys().next().value);
    },
    get size() { return map.size; },
    values: () => [...map.values()],
  };
}

/** The four business routes: each owns its validation and its response body. */
const ROUTES = {
  /** Run list + KPI; `?since=<seq>` is answered with a 40 B `unchanged` (F140). */
  async runs(r) {
    const snapshot = await r.snapshotFor(r.sessionId);
    const since = Number(r.url.searchParams.get('since'));
    if (Number.isInteger(since) && since >= 0 && snapshot.seq === since) {
      r.state.unchangedHits += 1;
      return ok({ ok: true, unchanged: true, seq: snapshot.seq, serverMs: elapsed(r.started) });
    }
    return ok(buildRunsPayloadFrom(snapshot.tree, snapshot.tokens, snapshot.tools, { header: snapshot.header, eventCount: snapshot.eventCount, sessionId: r.sessionId, seq: snapshot.seq, serverMs: elapsed(r.started), generatedAt: Date.now() }));
  },
  async run(r) {
    const idx = Number(r.url.searchParams.get('idx'));
    if (!Number.isInteger(idx) || idx < 0) return fail(400, 'bad-request', 'idx is required');
    const snapshot = await r.snapshotFor(r.sessionId);
    const detail = buildRunDetail(snapshot.tree, snapshot.tools, idx, { serverMs: elapsed(r.started) });
    return detail == null ? fail(404, 'not-found', `run ${idx} does not exist`) : ok(detail);
  },
  async step(r) {
    const idx = Number(r.url.searchParams.get('idx'));
    const stepIdx = Number(r.url.searchParams.get('step'));
    if (!Number.isInteger(idx) || idx < 0 || !Number.isInteger(stepIdx) || stepIdx < 0) return fail(400, 'bad-request', 'idx and step are required');
    const snapshot = await r.snapshotFor(r.sessionId);
    const content = buildStepContent(snapshot.tree, snapshot.tools, idx, stepIdx, { serverMs: elapsed(r.started) });
    return content == null ? fail(404, 'not-found', `run ${idx} step ${stepIdx} does not exist`) : ok(content);
  },
  async event(r) {
    const seq = Number(r.url.searchParams.get('seq'));
    if (!Number.isFinite(seq)) return fail(400, 'bad-request', 'seq is required');
    const before = Number(r.url.searchParams.get('before') ?? 0);
    const after = Number(r.url.searchParams.get('after') ?? 0);
    // F201: raw events never change once written — cache per session/seq/window.
    const key = [r.sessionId, seq, before, after].join('::');
    const cached = r.eventCache.get(key);
    if (cached !== undefined) return ok(cached);
    const value = await r.sessionQuery.readEvent({ sessionId: r.sessionId, seq, before, after });
    r.eventCache.set(key, value);
    return ok(value);
  },
};
const HEALTH_ROUTES = [...Object.keys(ROUTES), 'health', 'bench'];

export function apply(ctx) {
  // sessionId -> { seq, header, eventCount, tree, tokens, tools }, keyed by the
  // live log offset so a growing session is re-read once per change, not per call.
  const snapshots = lruMap(SNAPSHOT_MAX);
  const eventCache = lruMap(EVENT_CACHE_MAX);
  const state = { unchangedHits: 0, lastBuild: null };

  /** Cache footprint for the loopback probe (~5.9 MB per 17k-event session). */
  const cacheStats = () => {
    const values = [...snapshots.values()];
    return { sessions: snapshots.size, max: SNAPSHOT_MAX, events: values.reduce((sum, entry) => sum + (entry.eventCount ?? 0), 0), seqs: values.map((entry) => entry.eventCount ?? 0), unchangedHits: state.unchangedHits, lastBuild: state.lastBuild };
  };

  /** Header + events from the live in-memory log (~0 ms) or, cold, from disk. */
  const readSessionEvents = async (sessionId) => {
    try {
      const live = await ctx.sessionQuery.inspectSession(sessionId, (s) => ({ header: s.header, events: s.snapshotEvents() }));
      if (live != null && Array.isArray(live.events) && live.events.length > 0) return { events: live.events, header: slimHeader(live.header) };
    } catch {
      // Cold, not-live or unavailable: fall through to the persistence read.
    }
    const snapshot = await ctx.sessionQuery.readSession(sessionId);
    return { events: snapshot.events, header: slimHeader(snapshot.session) };
  };

  const snapshotFor = async (sessionId) => {
    // Cheap version probe: the current log offset, never the event payload.
    let seq = null;
    try { seq = await ctx.sessionQuery.inspectSession(sessionId, (s) => s.seq); } catch { seq = null; }
    const hit = snapshots.get(sessionId);
    if (hit !== undefined && seq != null && hit.seq === seq) { snapshots.set(sessionId, hit); return hit; }
    const { events, header } = await readSessionEvents(sessionId);
    const started = performance.now();
    const built = buildRunsPayload(events, { header, eventCount: events.length });
    state.lastBuild = { ms: elapsed(started), events: events.length, at: Date.now() };
    const entry = { seq: seq ?? events.length, header, eventCount: events.length, tree: built.tree, tokens: built.tokens, tools: built.tools };
    snapshots.set(sessionId, entry);
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

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: async (req, res) => {
    const started = performance.now();
    const url = new URL(String(req.url), 'http://localhost');
    const op = url.pathname.slice(PREFIX.length).replace(/^\//, '');
    // Loopback-only probes: constant metadata / sizes and timings, no content.
    if (op === 'health' && isLoopback(req)) {
      sendJson(res, 200, { ok: true, plugin: '@local/dsh-trace-analyzer', hostRev: HOST_REV, routes: HEALTH_ROUTES, cache: cacheStats(), uptimeMs: Math.round(performance.now()) });
      return;
    }
    if (op === 'bench' && isLoopback(req)) {
      try {
        sendJson(res, 200, await runBench(ctx, { sessionQuery: ctx.sessionQuery, snapshotFor, buildRunsPayloadFrom, buildRunDetail, buildStepContent, hostRev: HOST_REV, sessionArg: url.searchParams.get('sessionId') ?? '' }));
      } catch (error) {
        sendJson(res, 500, { code: 'bench-error', message: error && typeof error === 'object' && 'stack' in error ? String(error.stack).slice(0, 600) : String(error) });
      }
      return;
    }
    if (rejected(req, res)) return;
    if (req.method !== 'GET') { res.statusCode = 405; res.setHeader('allow', 'GET'); res.end(); return; }
    try {
      const route = ROUTES[op];
      if (route === undefined) { sendJson(res, 404, { code: 'not-found', message: `unknown operation: ${op}` }); return; }
      const result = await route({ url, started, sessionId: url.searchParams.get('sessionId') ?? '', snapshotFor, eventCache, state, sessionQuery: ctx.sessionQuery });
      sendJson(res, result.status, result.body);
    } catch (error) {
      sendJson(res, 500, { code: 'error', message: error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error) });
    }
  } }), 'trace-analyzer: sessionQuery routes');
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
  const h = session.header ?? session;
  return { id: h.id ?? null, createdAt: h.createdAt ?? null, cwd: h.cwd ?? null, parentSession: h.parentSession ?? null, agentPreset: h.agentPreset ?? null, delegationDepth: h.delegationDepth ?? null, origin: h.origin ?? null };
}
