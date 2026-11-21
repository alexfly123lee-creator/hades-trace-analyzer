/**
 * Loopback-only benchmark probe (`/bench`).
 *
 * Measures the real route code path (readSession → projection → JSON.stringify)
 * and reports sizes/timings/counts only. It returns no session content, so the
 * route can sit outside the connection fence and make the performance
 * acceptance (TEST §5) re-runnable against the live Host. `mockup/bench-live.mjs`
 * consumes the response shape below verbatim — keep the field names stable.
 */

/** One decimal place of elapsed milliseconds; shared with the Host routes. */
export function elapsed(started) {
  return Math.round((performance.now() - started) * 10) / 10;
}

/**
 * Run the probe for one session and return the exact JSON `/bench` answers with.
 * `sessionArg` is the raw `?sessionId=` value: '' or 'latest' resolves to the
 * live session with the most events (measured through the cheap seq probe).
 */
export async function runBench(ctx, deps) {
  const { snapshotFor, buildRunsPayloadFrom, buildRunDetail, buildStepContent, hostRev, sessionArg = '' } = deps;
  const query = deps.sessionQuery ?? ctx.sessionQuery;

  let benchSession = sessionArg;
  let resolved = null;
  if (sessionArg === '' || sessionArg === 'latest') {
    const records = await query.listSessions();
    const liveRecords = records.filter((record) => record.live);
    let best = null;
    for (const record of liveRecords) {
      const id = record.header?.id;
      if (id == null) continue;
      let seq = 0;
      try {
        seq = await query.inspectSession(id, (session) => session.seq);
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
    probeSeq = await query.inspectSession(benchSession, (session) => session.seq);
  } catch (error) {
    probeError = String(error && typeof error === 'object' && 'message' in error ? error.message : error).slice(0, 200);
  }
  const probeMs = elapsed(probeStarted);

  // Production path timing: exactly what `/runs` does (probe + live-log read +
  // projection + stringify), plus the cold `readSession` for contrast.
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
    await query.readSession(benchSession);
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
  return {
    ok: true,
    hostRev,
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
  };
}
