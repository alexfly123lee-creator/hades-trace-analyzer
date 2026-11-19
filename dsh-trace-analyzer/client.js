window.__ModuleLoader__.load({
  id: '@local/dsh-trace-analyzer',
  factory(require) {
    const React = require('react');
    const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React;
    const h = React.createElement;

    const NS = 'traceAnalyzer';
    const VIEW_ID = 'hades-eye';
    const PREFIX = '/api/trace-analyzer';
    const DEFAULT_SLOW_MS = 5000;

    const T = {
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      faint: 'var(--dsw-alias-label-caption)',
      border: 'var(--dsw-alias-border-l1)',
      // Row dividers inside the tinted Step container: l1 is nearly invisible
      // over the accent tint, so container-local separators use l2.
      divider: 'var(--dsw-alias-border-l2)',
      surface: 'var(--dsw-alias-bg-layer-1)',
      error: 'var(--dsw-alias-state-error-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      brand: 'var(--dsw-alias-trajectory-accent)',
      success: 'var(--dsw-alias-state-success-primary)',
      token: 'var(--dsw-alias-chart-tools)',
      font: 'var(--dsw-font-family)',
      mono: 'var(--ds-font-family-code)',
      radiusSm: 'var(--dsw-radius-sm)',
      radiusMd: 'var(--dsw-radius-md)',
      radiusXs: 'var(--dsw-radius-xs)',
      // Palette "outline brackets, no box fill": the rounded bracket outline is
      // kept exactly as designed; only the container fill is gone, so only the
      // expanded rows carry color.
      rail: 'var(--dsw-alias-trajectory-accent)',
      groupRing: 'color-mix(in srgb, var(--dsw-alias-trajectory-accent) 25%, transparent)',
      stepGroupRing: 'color-mix(in srgb, var(--dsw-alias-trajectory-accent) 38%, transparent)',
      // Expanded Run row: fill only.
      runSelBg: 'color-mix(in srgb, var(--dsw-alias-trajectory-accent) 12%, var(--dsw-alias-bg-layer-1))',
      // F148 hover: a 6% tint was too close to "nothing" on a light surface, so
      // hover now reads as a real state — deeper tint (no outline; a 1px ring
      // was tried and rejected as too heavy). Selection keeps a stronger fill
      // plus the left rail, so hover never outranks it.
      runHoverBg: 'color-mix(in srgb, var(--dsw-alias-trajectory-accent) 9%, var(--dsw-alias-bg-layer-1))',
      // Expanded Step row: strongest fill, container itself stays transparent.
      stepSelBg: 'color-mix(in srgb, var(--dsw-alias-trajectory-accent) 22%, transparent)',
      stepHoverBg: 'color-mix(in srgb, var(--dsw-alias-trajectory-accent) 10%, transparent)',
      // Column header = sort control. The hover tint covers the whole column and
      // a 1px underline carries the affordance (a 6% tint alone is invisible).
      sortHoverBg: 'color-mix(in srgb, var(--dsw-alias-trajectory-accent) 14%, transparent)',
      sortHoverLine: 'color-mix(in srgb, var(--dsw-alias-trajectory-accent) 80%, transparent)',
    };

    // ---------------------------------------------------------------------
    // F149: hover and selection tints are theme-dependent.
    // The same 9% accent over a white surface is a readable tint; over the dark
    // layer-1 (#232324) it is ~#252b39 — i.e. invisible. Dark therefore needs
    // its own alphas (~2.4×). The platform marks dark mode with
    // `body[data-ds-dark-theme]`, so the palette is resolved in JS and swapped
    // in place: the panel may live inside a shadow root, where a `body[...]`
    // descendant selector would never match.
    // ---------------------------------------------------------------------
    const TINT_BASE = {
      run: 'var(--dsw-alias-bg-layer-1)',
      step: 'transparent',
    };
    const LIGHT_TINT = { runHover: 9, runSel: 12, stepHover: 10, stepSel: 22, sortHover: 14, sortLine: 80 };
    const DARK_TINT = { runHover: 22, runSel: 30, stepHover: 26, stepSel: 36, sortHover: 26, sortLine: 90 };
    const tintOf = (pct, base) => `color-mix(in srgb, var(--dsw-alias-trajectory-accent) ${pct}%, ${base})`;

    function darkThemeActive() {
      const body = typeof document === 'undefined' ? null : document.body;
      return Boolean(body && body.hasAttribute('data-ds-dark-theme'));
    }

    /** Point the shared palette at the current theme; returns true when it moved. */
    let paletteDark = null;
    function applyThemePalette() {
      const dark = darkThemeActive();
      if (paletteDark === dark) return false;
      paletteDark = dark;
      const p = dark ? DARK_TINT : LIGHT_TINT;
      T.runHoverBg = tintOf(p.runHover, TINT_BASE.run);
      T.runSelBg = tintOf(p.runSel, TINT_BASE.run);
      T.stepHoverBg = tintOf(p.stepHover, TINT_BASE.step);
      T.stepSelBg = tintOf(p.stepSel, TINT_BASE.step);
      T.sortHoverBg = tintOf(p.sortHover, TINT_BASE.step);
      T.sortHoverLine = tintOf(p.sortLine, TINT_BASE.step);
      return true;
    }

    // Indent for the Step level: Step rows and their bracket sit one level in
    // from the Run group, so nesting reads by position, not only by color.
    const STEP_INDENT = 12;
    // F138: a run may hold 200+ steps; render them in pages so a single expand
    // cannot mount thousands of nodes at once.
    const STEP_PAGE = 80;
    // F141: live-appended rows fade in instead of popping in.
    const ROW_ANIM_CSS = '@keyframes hadesRowIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}'
      // F158: run-row hover lives in CSS, not React state. Colours come from
      // variables set on the panel root (they are theme-dependent, see
      // applyThemePalette) — sweeping the pointer across 175 rows no longer
      // re-renders the list.
      + '.hades-run-row{transition:background 120ms ease}'
      + '.hades-run-row:hover{background:var(--hades-hover-row)}'
      + '.hades-run-row.is-open,.hades-run-row.is-open:hover{background:var(--hades-sel-row)}'
      + '.hades-run-row .hades-idx{color:var(--hades-muted)}'
      + '.hades-run-row:hover .hades-idx,.hades-run-row.is-open .hades-idx{color:var(--hades-text)}'
      + '.hades-run-row:hover .hades-caret,.hades-run-row.is-open .hades-caret{color:var(--hades-brand)}';

    // F144 expand motion (plan C, tightened): height + fade, one uniform curve,
    // no stagger. Opening is short enough to feel immediate (160ms); closing is
    // shorter still (120ms) so the list snaps back instead of lingering.
    const EXPAND_MS = 160;
    const COLLAPSE_MS = 120;
    // Content that arrives *after* the open (the /step and /run fetches) must not
    // pop the panel taller — it follows at this short duration instead.
    const FOLLOW_MS = 120;
    // A 200-step run is ~7k px tall; animating that height costs layout every
    // frame, so big runs fade in instead of measuring/growing.
    const BIG_RUN_STEPS = 60;
    const motionReduced = () => typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /**
     * Height + fade expander (F144).
     *
     * Children mount only while open (or collapsing), so closed runs still cost
     * nothing in the DOM — the opposite of the CSS `0fr → 1fr` trick. The height
     * is measured once per transition and handed to WAAPI, which keeps the
     * animation off the layout path after the first frame.
     */
    function Collapse({ open, children, expandMs = EXPAND_MS, collapseMs = COLLAPSE_MS }) {
      const ref = useRef(null);
      const [visible, setVisible] = useState(open);
      // Closing must animate the content that is going away, so keep the last
      // open children around for the collapse.
      const lastChildren = useRef(children);
      if (open) lastChildren.current = children;
      // Height we last rendered at, used to follow async content smoothly.
      const heightRef = useRef(null);
      useEffect(() => {
        if (open) setVisible(true);
        else heightRef.current = null;
      }, [open]);
      useLayoutEffect(() => {
        const el = ref.current;
        if (el == null) return undefined;
        if (motionReduced()) {
          el.style.height = open ? 'auto' : '0px';
          el.style.opacity = open ? '1' : '0';
          if (!open) setVisible(false);
          return undefined;
        }
        if (open) {
          if (expandMs <= 0) {
            // Big run: no height animation, just a quick fade over the new rows.
            el.style.height = 'auto';
            el.style.opacity = '1';
            const fade = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'cubic-bezier(.2,.7,.3,1)' });
            return () => fade.cancel();
          }
          const height = el.scrollHeight;
          el.style.height = 'auto';
          const anim = el.animate(
            [{ height: '0px', opacity: 0 }, { height: height + 'px', opacity: 1 }],
            { duration: expandMs, easing: 'cubic-bezier(.2,.7,.3,1)' },
          );
          anim.onfinish = () => { el.style.height = 'auto'; el.style.opacity = '1'; };
          heightRef.current = height;
          return () => anim.cancel();
        }
        if (!visible) return undefined;
        const height = el.scrollHeight;
        heightRef.current = null;
        const anim = el.animate(
          [{ height: height + 'px', opacity: 1 }, { height: '0px', opacity: 0 }],
          { duration: collapseMs, easing: 'cubic-bezier(.4,0,1,1)' },
        );
        anim.onfinish = () => setVisible(false);
        return () => anim.cancel();
      }, [open, visible, expandMs, collapseMs]);
      // F144: the step/run detail arrives asynchronously. When it lands while the
      // panel is open, grow/shrink into the new height instead of jumping.
      useLayoutEffect(() => {
        const el = ref.current;
        if (el == null || !open || !visible) return undefined;
        const height = el.scrollHeight;
        const prev = heightRef.current;
        heightRef.current = height;
        if (prev == null || motionReduced() || expandMs <= 0 || Math.abs(height - prev) < 8) return undefined;
        const anim = el.animate([{ height: prev + 'px' }, { height: height + 'px' }], { duration: FOLLOW_MS, easing: 'cubic-bezier(.2,.7,.3,1)' });
        anim.onfinish = () => { el.style.height = 'auto'; };
        return () => anim.cancel();
      }, [children, open, visible, expandMs]);
      if (!visible) return null;
      return h('div', { ref, style: { overflow: 'hidden', height: open ? 'auto' : 0, opacity: open ? 1 : 0 } },
        open ? children : lastChildren.current);
    }

    /** The ▸/▾ affordance as one glyph that rotates, so expanding never reflows. */
    function Caret({ open, tone, ms = 160 }) {
      return h('span', {
        style: {
          display: 'inline-block', width: 10, flex: '0 0 10px', textAlign: 'center',
          // F148: the caret turns accent on hover — the cheapest "this row is
          // clickable" cue, and it costs no layout.
          color: tone ?? 'inherit',
          transition: `transform ${ms}ms cubic-bezier(.2,.7,.3,1), color 120ms ease`,
          transform: open ? 'rotate(90deg)' : 'none',
        },
      }, '▸');
    }

    // Short tag for the explanation-only rows a step panel gained in F23.2
    // (compaction / retry / file changes / slash commands / approvals …).
    const NOTE_TAG = { compact: '压缩', retry: '重试', fail: '失败', workspace: '变更', command: '命令', plan: '计划', todo: '清单', deliver: '交付', approval: '审批', note: '事件' };
    // Same English vocabulary as the step/role tags (F136); Chinese stays in the tooltip.
    const NOTE_TAG_EN = { compact: 'COMPACT', retry: 'RETRY', fail: 'FAIL', workspace: 'FILES', command: 'CMD', plan: 'PLAN', todo: 'TODO', deliver: 'DELIVER', approval: 'APPROVAL', note: 'EVENT' };

    // Session-scoped caches: reopening the tab, switching sessions back and forth,
    // or re-expanding a run must not hit the network again (SPEC F123).
    // Bounded (F138): an unbounded map keeps every step of every session a user
    // ever opened alive in the renderer heap, which shows up as GC pressure on
    // the whole app hours later. Oldest entry wins the eviction.
    const cache = {
      runs: new Map(),
      run: new Map(),
      step: new Map(),
      event: new Map(),
    };
    const CACHE_MAX = { runs: 6, run: 40, step: 240, event: 160 };

    function cacheSet(map, key, value, max) {
      map.delete(key);
      map.set(key, value);
      while (map.size > max) map.delete(map.keys().next().value);
    }

    function buildUrl(op, params) {
      const url = new URL(PREFIX + '/' + op, window.location.origin);
      for (const [key, value] of Object.entries(params ?? {})) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      }
      return url.toString();
    }

    /** Fetch + parse, reporting the real payload size and wall time for the header readout. */
    async function fetchPayload(op, params, signal) {
      const started = performance.now();
      const resp = await fetch(buildUrl(op, params), signal === undefined ? undefined : { signal });
      const text = await resp.text();
      const ms = performance.now() - started;
      if (!resp.ok) throw new Error('HTTP ' + resp.status + (text ? ': ' + text : ''));
      const json = JSON.parse(text);
      return { json, bytes: new TextEncoder().encode(text).byteLength, ms };
    }

    // Durations are stored in ms everywhere; the UI shows them all in seconds
    // (two decimals under 10s so sub-second steps keep their precision).
    /** Waiting-for-human durations read better in minutes once past ~90s. */
    function fmtWait(ms) {
      if (ms == null || !Number.isFinite(ms) || ms < 1000) return null;
      return ms >= 90000 ? `${(ms / 60000).toFixed(1)}min` : fmtMs(ms);
    }
    function fmtMs(ms) {
      if (ms == null || !Number.isFinite(ms)) return '—';
      return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + 's';
    }
    function fmtClock(t) {
      if (t == null || !Number.isFinite(t)) return '—';
      const d = new Date(t);
      const p = (x) => String(x).padStart(2, '0');
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }
    function fmtK(n) {
      if (n == null) return '—';
      if (n < 1000) return String(n);
      return (n / 1000).toFixed(1) + 'k';
    }

    // Role tags (SPEC F131) mirror the built-in Trajectory's `kindTag` exactly:
    // same kind vocabulary, same labels, same colors and tag geometry.
    const ROLE = {
      user: {
        key: 'role.user', fallback: '用户',
        color: 'var(--dsw-alias-state-business-primary)',
        background: 'var(--dsw-alias-state-business-tertiary)',
      },
      assistant: {
        key: 'role.assistant', fallback: '助手',
        color: 'color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color) 60%, var(--dsw-alias-state-error-secondary))',
        background: 'color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color) 55%, var(--dsw-alias-state-error-secondary)) 15%, var(--dsw-alias-bg-layer-1))',
      },
      context: {
        key: 'role.context', fallback: '上下文',
        color: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 68%, var(--dsw-alias-label-secondary))',
        background: 'var(--dsw-alias-state-success-tertiary)',
      },
      system: {
        key: 'role.system', fallback: '系统',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-module-platform)',
      },
      tool: {
        key: 'role.tool', fallback: '工具',
        color: 'var(--dsw-alias-state-warn-label)',
        background: 'var(--dsw-alias-state-warn-tertiary)',
      },
    };

    /** One role tag, styled after the platform's trajectory `.kindTag`. */
    /**
     * One tag geometry for every row (F136): role tags on Turn rows and action
     * tags on Step rows share size, padding, radius, weight and spacing — the
     * two levels must read as a single tag system.
     */
    function RowTag({ text, color, background, title }) {
      return h('span', {
        title: title ?? text,
        style: {
          display: 'inline-flex', alignItems: 'center', flex: '0 0 auto',
          height: 20, padding: '0 6px', boxSizing: 'border-box',
          border: '1px solid transparent', borderRadius: 'var(--dsw-radius-xs)',
          color, background,
          fontSize: 11, lineHeight: '17px', fontWeight: 650, letterSpacing: '0.035em',
          userSelect: 'none', whiteSpace: 'nowrap',
        },
      }, text);
    }

    // Tag chips speak one language across both levels (F136): run/step/Time/Token
    // are English, so tags are too; the Chinese wording stays in the tooltip.
    const ROLE_EN = { user: 'USER', assistant: 'ASSISTANT', context: 'CONTEXT', system: 'SYSTEM', tool: 'TOOL' };

    function RoleTag({ actor, label }) {
      const role = ROLE[actor] ?? ROLE.system;
      const text = ROLE_EN[actor] ?? ROLE_EN.system;
      const zh = label ? label(role.key, role.fallback) : role.fallback;
      return h(RowTag, { text, color: role.color, background: role.background, title: zh });
    }

    // ---------------------------------------------------------------------
    // F151 top overview — two modules instead of one card:
    //   KpiSummary     the numbers — its own bordered module
    //   OverviewBoard  numbers + picture in ONE pinned block (F153): both stay
    //                  at the panel top while the run list scrolls underneath
    // ---------------------------------------------------------------------
    function KpiSummary({ kpi, label }) {
      const items = [
        [String(kpi.runs), label('stat.runs', 'Run（指令）')],
        [String(kpi.steps), label('stat.steps', 'Step（迭代）')],
        [String(kpi.events), label('stat.events', '事件')],
        [fmtK(kpi.tokenTotal), label('stat.tokens', 'Token')],
        [String(kpi.errors), label('stat.errors', '错误'), T.error],
        [String(kpi.slow), label('stat.slow', '慢操作'), T.warn],
        [String(kpi.abnormal), label('stat.abnormal', '异常 Run'), T.warn],
        [kpi.slowest ? fmtMs(kpi.slowest.durationMs) : '—', label('stat.slowest', '最慢操作'), T.warn, kpi.slowest?.name],
      ];
      return h('div', {
        style: {
          display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap',
          border: '1px solid ' + T.border, borderRadius: T.radiusMd,
          padding: '9px 12px', background: T.surface, marginBottom: 10,
        },
      }, items.map(([num, lbl, tone, sub], i) => h('span', {
        key: 'kpi-' + i, style: { display: 'inline-flex', alignItems: 'baseline', gap: 4, minWidth: 0 },
      },
        h('b', { style: { fontSize: 15, fontWeight: 600, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', color: tone ?? T.text, letterSpacing: '-.01em' } }, num),
        h('span', { style: { fontSize: 11, color: T.muted, whiteSpace: 'nowrap' } }, lbl),
        sub ? h('span', { style: { fontSize: 11, color: T.faint, fontFamily: T.mono } }, sub) : null,
      )));
    }

    // Matrix geometry: a fixed label column, then one track per run with 1px
    // gaps. The hover band is positioned from these numbers so its edges sit
    // exactly on the cell borders (a plain `i/n` percentage ignores the gaps and
    // drifts across the cell centres as the count grows).
    const MX_LABEL_W = 46;
    const MX_GAP = 8;

    /**
     * F150/F151 heat matrix: four rows × one column per run.
     *
     * Shading is rank-based, not linear: token goes 13.4k (median) → 691k (max)
     * in this session — a 52× skew — so a linear ramp would paint one dark cell
     * and 173 invisible ones.
     *
     * F150..F153 heat matrix: four rows × one column per run, rendered together
     * with the KPI summary inside a single pinned block (F153: the user wants the
     * numbers pinned too, not just the picture).
     *
     * Shading is rank-based, not linear: token goes 13.4k (median) → 691k (max)
     * in this session — a 52× skew — so a linear ramp would paint one dark cell
     * and 173 invisible ones.
     *
     * Why the pin is JS and not `position: sticky`: the panel's scroll owner is
     * not knowable up-front (in the shipped GUI the *conversation page* scrolls,
     * not our box) and any ancestor with `overflow: hidden` silently turns into a
     * non-scrolling sticky container — the card then scrolls away with the page,
     * which is exactly what happened. Translating the block inside a same-size
     * placeholder is layout-space independent: it does not care which ancestor
     * scrolls, it never shifts the list, and it cannot create a fixed-position
     * containing-block surprise.
     */
    function OverviewBoard({ kpi, rows, label, onLocate }) {
      const [hover, setHover] = useState(null);
      // F155: the clicked column stays highlighted, so "which Run did I pick?" is
      // answerable after the pointer leaves the matrix.
      const [selected, setSelected] = useState(null);
      const wrapRef = useRef(null);
      const cardRef = useRef(null);
      // F156: the parent re-renders on every realtime tick, so a captured
      // `onLocate` would invalidate the memoised grid each time. Call through a
      // ref instead.
      const locateRef = useRef(onLocate);
      locateRef.current = onLocate;
      const n = rows.length;
      const ranks = useMemo(() => {
        const rank = (pick) => {
          const order = rows.map((r, i) => [pick(r) ?? 0, i]).sort((a, b) => a[0] - b[0]);
          const out = new Array(order.length);
          order.forEach(([, i], pos) => { out[i] = order.length > 1 ? pos / (order.length - 1) : 1; });
          return out;
        };
        return {
          time: rank((r) => r.time),
          token: rank((r) => r.token),
          steps: rank((r) => r.stepCount),
        };
      }, [rows]);
      // 8% floor keeps the smallest run visible; 88% ceiling keeps the largest
      // from turning into a solid block.
      const shade = (tone, rank) => `color-mix(in srgb, ${tone} ${Math.round(8 + 80 * rank)}%, var(--dsw-alias-bg-layer-1))`;
      const rowsDef = [
        { key: 'time', text: label('col.time', 'Time'), tone: T.brand, values: ranks.time },
        { key: 'token', text: label('col.token', 'Token'), tone: T.token, values: ranks.token },
        { key: 'steps', text: label('mx.steps', '步数'), tone: T.success, values: ranks.steps },
      ];
      // Flag lane: translucent red / amber — solid semantic colours on a 3px cell
      // are far too loud next to the pastel metric rows (F152).
      const flagBg = (run) => (run.hasError
        ? `color-mix(in srgb, ${T.error} 58%, transparent)`
        : run.hasSlow
          ? `color-mix(in srgb, ${T.warn} 58%, transparent)`
          : `color-mix(in srgb, ${T.muted} 10%, transparent)`);
      const rowTexts = rowsDef.map((row) => row.text).join(',');
      // F156: 700 cells are expensive to rebuild, and nothing about them changes
      // on hover/selection — only the overlay band does. Memoise them so a click
      // costs one band move instead of a full grid re-render.
      const grid = useMemo(() => [
        ...rowsDef.map((row) => h('div', { key: row.key, style: { display: 'flex', alignItems: 'center', gap: MX_GAP, marginBottom: 3 } },
          h('span', {
            style: { flex: `0 0 ${MX_LABEL_W}px`, textAlign: 'right', font: `11px/1 ${T.mono}`, color: T.muted },
          }, row.text),
          h('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 1 } },
            rows.map((r, i) => h('div', {
              key: r.idx,
              onMouseEnter: () => setHover(i),
              onClick: () => { setSelected(i); setTimeout(() => locateRef.current(r.idx), 0); },
              title: `Run ${r.idx}`,
              style: { height: 11, borderRadius: 1, cursor: 'pointer', background: shade(row.tone, row.values[i]) },
            })),
          ),
        )),
        h('div', { key: 'flags', style: { display: 'flex', alignItems: 'center', gap: MX_GAP } },
          h('span', {
            style: { flex: `0 0 ${MX_LABEL_W}px`, textAlign: 'right', font: `11px/1 ${T.mono}`, color: T.muted },
          }, label('mx.flags', '异常')),
          h('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 1 } },
            rows.map((r, i) => h('div', {
              key: 'flag-' + r.idx,
              onMouseEnter: () => setHover(i),
              onClick: () => { setSelected(i); setTimeout(() => locateRef.current(r.idx), 0); },
              title: `Run ${r.idx}`,
              style: { height: 11, borderRadius: 1, cursor: 'pointer', background: flagBg(r) },
            })),
          ),
        ),
        // Callbacks are stable through refs, so they stay out of the deps.
      ], [rows, ranks, n, rowTexts]);
      if (n === 0) return null;
      const active = hover == null ? selected : hover;
      const hovered = active == null || rows[active] == null ? null : rows[active];
      const summary = hovered
        ? `Run ${hovered.idx} · ${fmtMs(hovered.time)} · ${fmtK(hovered.token)} tok · ${hovered.stepCount} 步`
          + (hovered.hasError ? ' · 有错误' : '') + (hovered.hasSlow ? ' · 有慢操作' : '')
          + (hovered.prompt ? ' — ' + String(hovered.prompt).replace(/\s+/g, ' ').slice(0, 56) : '')
        : '';
      const gaps = Math.max(0, n - 1);
      const track = `(100% - ${MX_LABEL_W + MX_GAP + gaps}px) / ${n}`;
      // Column geometry, gap-aware: the highlight edges must land exactly on the
      // cell borders (a plain i/n percentage ignores the 1px gaps and drifts).
      const bandAt = (i) => ({
        left: `calc(${MX_LABEL_W + MX_GAP}px + ${i} * ((${track}) + 1px))`,
        width: `calc(${track})`,
      });
      // F152: three separate rectangles instead of one bordered box. A 1px border
      // on a 2–4px wide element collapses into a tapered wedge as the column count
      // grows (the "梯形" artefact), while independent 1px lines stay crisp. They
      // are painted after the cells so the highlight reads as one column.
      const bandLayer = (key, style) => h('div', {
        key,
        style: Object.assign({ position: 'absolute', top: -2, bottom: -2, pointerEvents: 'none' }, style),
      });
      const legendItem = (tone, text) => h('span', {
        key: 'lg-' + text,
        style: { display: 'inline-flex', alignItems: 'center', gap: 4, color: T.muted },
      }, h('i', { style: { width: 9, height: 9, borderRadius: 2, background: tone, display: 'inline-block' } }), text);
      return h('div', {
        ref: wrapRef,
        // F153: the wrapper paints the surface colour so the seam between the KPI
        // card and the matrix card never shows the list behind it.
        style: { marginBottom: 12, background: T.surface },
      },
        h('div', { ref: cardRef, 'data-hades-board': '1', style: { zIndex: 3 } },
          h(KpiSummary, { kpi, label }),
          h('div', {
            style: {
              border: '1px solid ' + T.border, borderRadius: T.radiusMd,
              padding: '8px 12px 7px', background: T.surface,
              boxShadow: `0 10px 18px -14px color-mix(in srgb, ${T.text} 55%, transparent)`,
            },
            onMouseLeave: () => setHover(null),
          },
            h('div', { style: { position: 'relative' } },
              grid,
              // F157: two distinct states, both readable at a glance —
              //   selected (clicked): 26% fill + 2px edges, stays after the
              //                       pointer leaves;
              //   hover:              18% fill + 1px edges, follows the pointer.
              // Previously both used the same faint 14%/1px band, so hovering felt
              // like nothing happened and a selection was indistinguishable.
              selected != null ? bandLayer('sel-fill', {
                left: bandAt(selected).left, width: bandAt(selected).width,
                background: `color-mix(in srgb, ${T.brand} 26%, transparent)`,
              }) : null,
              selected != null ? bandLayer('sel-l', { left: bandAt(selected).left, width: 2, background: T.brand }) : null,
              selected != null ? bandLayer('sel-r', {
                left: `calc(${bandAt(selected).left} + (${bandAt(selected).width}) - 2px)`, width: 2, background: T.brand,
              }) : null,
              hover != null && hover !== selected ? bandLayer('hov-fill', {
                left: bandAt(hover).left, width: bandAt(hover).width,
                background: `color-mix(in srgb, ${T.brand} 18%, transparent)`,
              }) : null,
              hover != null && hover !== selected ? bandLayer('hov-l', { left: bandAt(hover).left, width: 1, background: T.brand }) : null,
              hover != null && hover !== selected ? bandLayer('hov-r', {
                left: `calc(${bandAt(hover).left} + (${bandAt(hover).width}) - 1px)`, width: 1, background: T.brand,
              }) : null,
            ),
            h('div', {
              style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 7, font: `11px/1.2 ${T.mono}`, minHeight: 16 },
            },
              legendItem(T.brand, label('col.time', 'Time')),
              legendItem(T.token, label('col.token', 'Token')),
              legendItem(T.success, label('mx.steps', '步数')),
              h('span', {
                title: label('mx.ramp', '颜色越深 = 该 Run 在全会话里的排位越高'),
                style: {
                  flex: '0 0 84px', height: 6, borderRadius: 3,
                  background: `linear-gradient(90deg, color-mix(in srgb, ${T.brand} 8%, var(--dsw-alias-bg-layer-1)), color-mix(in srgb, ${T.brand} 88%, var(--dsw-alias-bg-layer-1)))`,
                },
              }),
              legendItem(T.error, label('mx.error', '有错误')),
              legendItem(T.warn, label('mx.slow', '有慢操作')),
              // F157: an explicit selection chip, so "what is currently selected"
              // is answered in words as well as by the 30%/2px column band.
              selected != null && rows[selected] ? h('span', {
                key: 'sel-chip',
                style: {
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  height: 17, padding: '0 5px 0 6px', borderRadius: 4,
                  border: '1px solid ' + T.brand,
                  background: `color-mix(in srgb, ${T.brand} 10%, transparent)`,
                  color: T.brand, whiteSpace: 'nowrap',
                },
              },
                `Run ${rows[selected].idx}`,
                h('button', {
                  type: 'button',
                  title: label('mx.clearSel', '取消选中'),
                  onClick: () => setSelected(null),
                  style: { border: 'none', background: 'transparent', color: T.brand, cursor: 'pointer', font: 'inherit', padding: 0, lineHeight: 1 },
                }, '✕'),
              ) : null,
              h('span', {
                title: hovered ? summary : '',
                style: {
                  marginLeft: 'auto', minWidth: 0, maxWidth: '46%', textAlign: 'right',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  color: hovered ? T.text : T.faint,
                },
              }, hovered ? summary : label('mx.hint', '悬停看这个 Run · 点击定位')),
            ),
          ),
        ),
      );
    }

    // Fixed column widths: the same two tracks are shown on every row (Run and
    // Step), so time and tokens are compared side by side instead of toggling.
    // F139 grew the tracks with the type; F146 makes the two columns *equal* —
    // a narrower Token column made the pair read as a primary metric plus an
    // appendix, and a 112px track squeezed the cumulative slices of F142.
    // Both columns: 150 track + 6 gap + 70 number = 226px.
    const METRIC_W = 150;
    const METRIC_NUM_W = 70;
    // Kept as named aliases so call sites stay readable (and a future split
    // stays a one-line change).
    const RUN_IDX_W = 78;

    function DualBarChart({ rows, sort, onSort, sysLabel, expanded, onToggleRun, renderDetail, hasDetail, label }) {
      const listRef = useRef(null);
      const prevTops = useRef(new Map());
      const first = useRef(true);
      const lastOrder = useRef(null);
      const seenRuns = useRef(new Set());
      // F158: run-row hover moved to CSS (see ROW_ANIM_CSS) — React state here
      // meant every pointer move re-rendered the whole list. Only the sort
      // header still tracks hover (it changes an icon and a border).
      const [hoverSort, setHoverSort] = useState(null);
      const sorted = useMemo(() => {
        const arr = [...rows];
        if (sort) {
          const k = sort.key;
          const sign = sort.dir === 'asc' ? 1 : -1;
          arr.sort((a, b) => sign * (((a[k] ?? 0)) - ((b[k] ?? 0))));
        } else arr.sort((a, b) => a.idx - b.idx);
        return arr;
      }, [rows, sort]);
      const maxTime = useMemo(() => Math.max(1, ...rows.map((r) => r.time)), [rows]);
      const maxToken = useMemo(() => Math.max(1, ...rows.map((r) => r.token)), [rows]);

      useLayoutEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const els = Array.from(list.querySelectorAll('[data-run]'));
        // F141: during a live tick the payload object is replaced every 2 s even
        // when nothing moved. Measuring + animating 155 rows then reads as "the
        // page just refreshed". Only a real order change earns the FLIP pass.
        const order = els.map((el) => el.getAttribute('data-run')).join('|');
        if (lastOrder.current === order) return;
        lastOrder.current = order;
        if (!first.current) {
          els.forEach((el) => {
            const id = el.getAttribute('data-run');
            const prevTop = prevTops.current.get(id);
            if (prevTop == null) return;
            // offsetTop (layout-relative) instead of getBoundingClientRect
            // (viewport-relative): scrolling between two measurements must not
            // read as "every row moved".
            const dy = prevTop - el.offsetTop;
            if (Math.abs(dy) > 1) {
              // F158: promote the row only while it actually animates — a standing
              // `will-change` on 175 rows costs compositing memory and is a classic
              // scroll-jank source.
              el.style.willChange = 'transform';
              el.style.transition = 'none';
              el.style.transform = 'translateY(' + dy + 'px)';
              void el.offsetHeight; // force reflow so the transform applies before the transition
              el.style.transition = 'transform .3s cubic-bezier(.4,0,.2,1)';
              el.style.transform = 'translateY(0)';
              const cleanup = () => { el.style.transition = ''; el.style.transform = ''; el.style.willChange = ''; el.removeEventListener('transitionend', cleanup); };
              el.addEventListener('transitionend', cleanup);
            }
          });
        }
        const next = new Map();
        els.forEach((el) => next.set(el.getAttribute('data-run'), el.offsetTop));
        prevTops.current = next;
        first.current = false;
      }, [sort, sorted]);

      // Column header *is* the sort control (SPEC F132). The whole column — bar
      // slot + number slot — is one hit area, so the click target is the whole
      // 246px / 168px column instead of just the label text. A standing ⇅ pair
      // says "sortable"
      // even while idle; only the active direction lights up. The label is the
      // last flex child, so its right edge lands exactly on the numbers' right
      // edge (header and data share one baseline).
      const nextSort = (key) => {
        if (!sort || sort.key !== key) return { key, dir: 'desc' };
        return sort.dir === 'desc' ? { key, dir: 'asc' } : null;
      };

      const chevron = (dir, hovered) => {
        const dim = hovered ? 0.55 : 0.35;
        const up = dir === 'asc' ? 1 : dir === 'desc' ? 0.22 : dim;
        const down = dir === 'desc' ? 1 : dir === 'asc' ? 0.22 : dim;
        const tri = (edge, opacity) => h('i', {
          key: edge,
          style: {
            display: 'block', width: 0, height: 0, opacity,
            borderLeft: '3px solid transparent', borderRight: '3px solid transparent',
            [edge === 'up' ? 'borderBottom' : 'borderTop']: '3.5px solid currentColor',
          },
        });
        return h('span', {
          style: { display: 'inline-flex', flexDirection: 'column', gap: 1, width: 7, flex: '0 0 7px', alignItems: 'center', marginLeft: 3 },
        }, tri('up', up), tri('down', down));
      };

      // The header labels the *bar* column: the button covers just the track
      // (150px / 100px) and the label starts flush with the track's left edge,
      // so it sits over the bars instead of over the numbers (F132).
      const sortCol = (key, text, tone, barW) => {
        const active = !!sort && sort.key === key;
        const dir = active ? sort.dir : null;
        const hovered = hoverSort === key;
        return h('button', {
          key,
          type: 'button',
          onClick: () => onSort(nextSort(key)),
          onMouseEnter: () => setHoverSort(key),
          onMouseLeave: () => setHoverSort((prev) => (prev === key ? null : prev)),
          onFocus: () => setHoverSort(key),
          onBlur: () => setHoverSort((prev) => (prev === key ? null : prev)),
          'aria-sort': dir === 'desc' ? 'descending' : dir === 'asc' ? 'ascending' : 'none',
          title: dir === 'desc' ? `${text} 降序 · 再点改升序` : dir === 'asc' ? `${text} 升序 · 再点取消排序` : `按 ${text} 排序`,
          style: {
            flex: `0 0 ${barW}px`, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 0,
            background: hovered ? T.sortHoverBg : 'transparent',
            border: 'none', borderBottom: '1px solid ' + (hovered ? T.sortHoverLine : 'transparent'),
            padding: '1px 0', borderRadius: '3px 3px 0 0', cursor: 'pointer',
            color: active ? tone : T.muted,
            font: 'inherit', fontSize: 11, lineHeight: 1, fontFamily: T.mono, letterSpacing: '.04em',
            userSelect: 'none', minWidth: 0, whiteSpace: 'nowrap',
          },
        }, text, chevron(dir, hovered));
      };

      // Sort state is shown in words too: after scrolling a long list there is no
      // other way to tell which key is driving the order, and ✕ clears it in one
      // click instead of "click it once more and hope".
      const sortClear = () => {
        const text = sort.key === 'time' ? label('col.time', 'Time') : label('col.token', 'Token');
        const tone = sort.key === 'time' ? T.brand : T.token;
        return h('div', {
          key: 'sortClear',
          style: {
            flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 4, height: 17,
            padding: '0 4px 0 6px', boxSizing: 'border-box', whiteSpace: 'nowrap',
            border: '1px solid ' + T.border, borderRadius: T.radiusXs, background: T.surface,
            fontSize: 11, lineHeight: '1', fontFamily: T.mono, letterSpacing: '.04em', color: T.muted,
          },
        },
          label('sort.by', '已按'),
          h('b', { style: { fontWeight: 400, color: tone } }, `${text} ${sort.dir === 'asc' ? '↑' : '↓'}`),
          label('sort.on', '排序'),
          h('button', {
            type: 'button',
            title: label('sort.clear', '清除排序'),
            onClick: () => onSort(null),
            style: { flex: '0 0 auto', border: 'none', background: 'transparent', color: T.faint, cursor: 'pointer', font: 'inherit', padding: 0, lineHeight: 1 },
          }, '✕'),
        );
      };

      return h('div', null,
        // Header doubles as the sort control: both metric columns are always
        // visible, clicking a column sorts by it (desc → asc → off).
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 12,
            // 3px = the group's left border, so header and rows share x offsets.
            padding: '0 0 3px 3px', borderBottom: '1px solid ' + T.border, marginBottom: 6,
          },
        },
          h('span', { style: { flex: `0 0 ${RUN_IDX_W}px` } }),
          // Cells mirror the row cells exactly (bar slot + number slot) so the
          // bar-aligned labels land on the same x as the track below; the label
          // itself only covers the track.
          h('div', { key: 'h-time', style: { flex: `0 0 ${METRIC_W + 6 + METRIC_NUM_W}px`, display: 'flex', alignItems: 'center', minWidth: 0 } },
            sortCol('time', label('col.time', 'Time'), T.brand, METRIC_W)),
          h('div', { key: 'h-token', style: { flex: `0 0 ${METRIC_W + 6 + METRIC_NUM_W}px`, display: 'flex', alignItems: 'center', minWidth: 0 } },
            sortCol('token', label('col.token', 'Token'), T.token, METRIC_W)),
          sort ? sortClear() : null,
        ),
        h('div', { ref: listRef }, sorted.map((r) => {
          const tPct = (r.time / maxTime * 100).toFixed(1);
          const kPct = (r.token / maxToken * 100).toFixed(1);
          const runKey = 'run-' + r.idx;
          const open = expanded.has(runKey);
          const abnormal = r.hasError;
          // Highlight follows expansion (SPEC F128): an open Run keeps its row lit
          // while its group is open, and an open Step keeps its own row lit.
          const runSelected = open;
          // Bracket outline unchanged (1px accent ring + 3px rail + radius); only
          // the fill is gone. Collapsed rows keep transparent borders, so
          // expanding never shifts content sideways.
          const groupStyle = {
            borderTop: '1px solid ' + (open ? T.groupRing : 'transparent'),
            borderRight: '1px solid ' + (open ? T.groupRing : 'transparent'),
            borderBottom: open ? '1px solid ' + T.groupRing : 'none',
            borderLeft: '3px solid ' + (open ? T.rail : 'transparent'),
            padding: open ? '0 0 6px' : '6px 0',
            // F158: no standing `will-change` — 175 permanently promoted layers
            // are a scroll-jank source. FLIP adds it only while animating.
            borderRadius: T.radiusMd,
            overflow: open ? 'hidden' : 'visible',
            background: 'transparent',
          };
          // F141: a row that appears after the first paint is a live addition —
          // fade it in so "a new run arrived" reads as growth, not as a repaint.
          const isNewRow = !first.current && !seenRuns.current.has(r.idx);
          if (isNewRow) seenRuns.current.add(r.idx);
          // F144: animate the height only when the step index is already loaded.
          // A first open would otherwise animate a one-line "载入 step…" placeholder
          // and then grow again when the data lands — that double growth is what
          // reads as "slow". Uncached expands appear at once and follow the data.
          const detailReady = hasDetail ? hasDetail(r.idx) : false;
          return h('div', {
            key: r.idx,
            'data-run': String(r.idx),
            style: isNewRow ? { ...groupStyle, animation: 'hadesRowIn .22s ease-out' } : groupStyle,
          },
            h('div', {
              onClick: () => onToggleRun(r.idx),
              // F158: hover is CSS (:hover) — no React state, so moving the
              // pointer across the list no longer re-renders 175 rows.
              className: 'hades-run-row' + (runSelected ? ' is-open' : ''),
              style: {
                display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', minWidth: 0,
                // No row separators: the outline look relies on the bracket + spacing.
              },
            },
              h('span', {
                className: 'hades-idx',
                style: { flex: `0 0 ${RUN_IDX_W}px`, minWidth: 0, color: abnormal ? T.error : undefined, fontVariantNumeric: 'tabular-nums', userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 2 },
              },
                r.stepCount ? h(Caret, { key: 'caret', open }) : null,
                `Run ${r.idx}`),
              // F145: both columns are the same slice (left 0, width = share of
              // the session max); only `tone` differs.
              h(MetricBar, {
                width: METRIC_W,
                numWidth: METRIC_NUM_W,
                tone: T.brand,
                fill: h(SliceFill, { tone: T.brand, left: 0, width: Number(tPct), tip: fmtMs(r.time) }),
                valueText: fmtMs(r.time),
                tip: fmtMs(r.time),
              }),
              // F142 (corrected): the run row keeps the plain magnitude bar; the
              // *distribution* lives on the step rows, where each step's track is
              // the run's total and the steps fill it cumulatively in order.
              h(MetricBar, {
                width: METRIC_W,
                numWidth: METRIC_NUM_W,
                tone: T.token,
                fill: h(SliceFill, { tone: T.token, left: 0, width: Number(kPct), tip: fmtK(r.token) + ' tok' }),
                valueText: fmtK(r.token),
                tip: fmtK(r.token) + ' tok',
              }),
              h(RoleTag, { actor: r.actor, label }),
              // F147: the whole prompt goes into the cell; the column clips it
              // with CSS (`text-overflow: ellipsis`) instead of a character
              // budget, so the cut always happens at the real width — and
              // widening the window immediately reveals more of it.
              h('span', { title: r.isSystemPrompt ? sysLabel : (r.prompt ?? ''), style: { flex: '1 1 auto', minWidth: 0, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.isSystemPrompt ? sysLabel : (r.prompt || '…')),
              abnormal ? h('span', { style: { flex: '0 0 8px', width: 8, height: 8, borderRadius: '50%', background: T.error } }) : null,
            ),
            // F144: opening a run grows its bracket instead of snapping it in;
            // a very long run (200+ steps, ~7k px) fades instead of animating
            // height, which would relayout every frame.
            // F158: build the step list ONLY while the row is open. `renderDetail`
            // was being called for all 175 rows on every render — for an expanded
            // 80-step run that built 80 step rows per row per render, which is the
            // single most expensive thing a re-render could do.
            h(Collapse, { open, expandMs: detailReady && (r.stepCount ?? 0) <= BIG_RUN_STEPS ? EXPAND_MS : 0 }, open ? renderDetail(r) : null),
          );
        })),
      );
    }

    // ---------------------------------------------------------------------
    // F145: Time and Token are ONE instrument in two hues.
    // Every fill in every column is painted by the two helpers below, so the
    // height (full track), the rounding (SLICE_RADIUS) and the faint "already
    // consumed before this row" underlay can never drift apart again. The bar
    // had grown three different looks — full-height run fill, a 6px inset pill
    // for Step time, a full-height slice for Step token — which read as three
    // different widgets instead of one metric pair. Colour is the only
    // difference left.
    // ---------------------------------------------------------------------
    const SLICE_RADIUS = 2;
    const SPENT_ALPHA = 0.18;

    /** Track area consumed *before* this row's own segment (faint underlay). */
    function SpentFill({ tone, pct }) {
      if (!(pct > 0.05)) return null;
      return h('div', {
        style: {
          position: 'absolute', left: 0, top: 0, bottom: 0, width: pct + '%',
          background: tone, opacity: SPENT_ALPHA, transition: 'width .25s ease',
        },
      });
    }

    /** This row's own segment: full track height, one rounding, solid tone. */
    function SliceFill({ tone, left = 0, width, tip }) {
      if (!(width > 0)) return null;
      return h('div', {
        title: tip,
        style: {
          position: 'absolute', left: left + '%', width: width + '%', top: 0, bottom: 0,
          boxSizing: 'border-box', background: tone, borderRadius: SLICE_RADIUS,
          transition: 'left .25s ease, width .25s ease',
        },
      });
    }

    /**
     * One fixed-width metric track, value right-aligned INSIDE the bar.
     * Run rows and Step rows share it, so the two metric columns line up.
     */
    /**
     * Fixed-length metric bar + its number in a fixed, right-aligned cell to the
     * right of the bar. The bar's *track* length never changes (so numbers stay
     * put), only the colored portion inside it reflects the value.
     */
    function MetricBar({ tone, fill, valueText, tip, width = METRIC_W, numWidth = METRIC_NUM_W }) {
      return h('div', {
        title: tip,
        style: { flex: `0 0 ${width + numWidth + 6}px`, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
      },
        h('div', {
          style: {
            position: 'relative', flex: `0 0 ${width}px`, height: 8, borderRadius: 99,
            overflow: 'hidden', background: `color-mix(in srgb, ${tone} 12%, transparent)`,
          },
        }, fill),
        h('span', {
          style: {
            flex: `0 0 ${numWidth}px`, textAlign: 'right', fontSize: 11, lineHeight: '1',
            fontVariantNumeric: 'tabular-nums', fontFamily: T.mono, color: T.text,
          },
        }, valueText),
      );
    }

    /**
     * One Step row under an expanded Run.
     *
     * Columns match the Run row exactly: index, a 150px time track, a 110px token
     * track, then the step caption and the error dot. The index cell is narrowed
     * by the bracket indent so both bar columns align with the Run row above.
     */
    // Tag-style step names (F135). Colours come from the SAME palette as the
    // Turn role tags (F136): tool work → 工具色, model prose → 助手色, injected
    // context → 上下文色, system prompt → 系统色, failures → error.
    const STEP_TAG_ROLE = {
      回复: 'assistant', 空回复: 'assistant',
      系统提示词: 'system',
      仅注入上下文: 'context',
    };
    const STEP_TAG_ERROR = {
      color: T.error,
      background: `color-mix(in srgb, ${T.error} 12%, transparent)`,
    };

    function stepNameParts(title, tag) {
      const raw = String(title ?? '').trim();
      if (raw === '' || raw === '—' || !tag) return { tag: null, label: raw };
      const label = raw.startsWith(tag) ? raw.slice(tag.length).trim().replace(/^·\s*/, '') : raw;
      return { tag, label };
    }

    const STEP_TAG_EN = {
      读取: 'READ', 看图: 'IMAGE', 修改: 'EDIT', 写: 'WRITE', 搜: 'GREP', 找: 'GLOB',
      运行: 'RUN', 交付: 'DELIVER', 插件: 'PLUGIN', 技能: 'SKILL', 清单: 'TODO', 提问: 'ASK',
      搜网: 'SEARCH', 抓: 'FETCH', 查: 'INSPECT', 计划: 'PLAN', 派发: 'AGENT',
      建目标: 'GOAL', 读目标: 'GOAL', 目标: 'GOAL', 定时: 'CRON', 看定时: 'CRON',
      取运行环境: 'ENV', 提交计划: 'PLAN', 压缩: 'COMPACT', 重试: 'RETRY', 失败: 'FAIL',
      空回复: 'EMPTY', 仅注入上下文: 'CONTEXT', 上下文压缩: 'COMPACT', 系统提示词: 'SYSTEM',
      返回结果: 'RESULT', 工具: 'TOOL', 回复: 'REPLY',
    };

    /**
     * One step action chip. A step may now carry several (F137): distinct
     * actions in call order, a repeated action folded into `×n`, and a `+N`
     * chip when the row ran out of room.
     */
    function StepTag({ tag, count, overflow, label }) {
      const role = STEP_TAG_ROLE[tag];
      const palette = tag === '失败'
        ? STEP_TAG_ERROR
        : overflow
          ? { color: T.faint, background: `color-mix(in srgb, ${T.muted} 9%, transparent)` }
          : (ROLE[role] ?? ROLE.tool);
      const text = overflow ? tag : (STEP_TAG_EN[tag] ?? tag) + (count > 1 ? ' ×' + count : '');
      const zh = overflow ? `${count} 个动作未显示` : `${tag}${count > 1 ? ' ×' + count : ''}${label ? ' · ' + label : ''}`;
      return h(RowTag, { text, color: palette.color, background: palette.background, title: zh });
    }
    function StepRow({ step, selected, open, onSelect, idxWidth, timeMetric, tokenMetric, text, title, tag, tags, marks, waitMs, hasError, content, contentReady }) {
      const [hover, setHover] = useState(false);
      const background = selected ? T.stepSelBg : (hover ? T.stepHoverBg : 'transparent');
      // Title = verb + object (F23.1); the chip row carries every action the
      // step performed (F137). `text` stays the raw caption and is the tooltip.
      const titleColor = selected ? T.text : T.text;
      const chips = (tags && tags.length > 0) ? tags : (tag ? [{ tag, count: 1 }] : []);
      const name = stepNameParts(title, chips[0]?.tag ?? null);
      const caption = h('span', {
        title: text,
        style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected || hover ? T.text : T.muted, transition: 'color 120ms ease' },
      },
        name.label ? h('b', { style: { fontWeight: 400, color: titleColor } }, name.label) : null,
        (marks ?? []).map((mark, i) => h('span', {
          key: 'mark-' + i,
          style: {
            color: mark.tone === 'error' ? T.error : mark.tone === 'warn' ? T.warn : T.muted,
            fontFamily: T.mono, fontSize: 11,
          },
        }, ' · ' + mark.text)),
        // Waiting for the human is shown, but never added to the step's time.
        fmtWait(waitMs) != null ? h('span', { style: { color: T.faint, fontFamily: T.mono, fontSize: 11 } }, ' · ⏸ ' + fmtWait(waitMs)) : null,
      );
      const row = h('div', {
        onClick: onSelect,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onKeyDown: (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onSelect();
        },
        role: 'button',
        tabIndex: 0,
        'aria-expanded': open ? 'true' : 'false',
        'aria-pressed': selected ? 'true' : 'false',
        style: {
          display: 'flex', alignItems: 'center', gap: 12, minHeight: 30, padding: '1px 0',
          cursor: 'pointer', background,
          // F148: fill only (no outline) — hover is 10%, open is 22%.
          transition: 'background 120ms ease',
        },
      },
        h('span', { style: { flex: `0 0 ${idxWidth}px`, minWidth: 0, color: selected || hover ? T.text : T.muted, fontSize: 12, userSelect: 'none', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', display: 'inline-flex', alignItems: 'center', gap: 2 } },
          h(Caret, { key: 'caret', open, tone: hover ? T.brand : undefined }),
          `Step ${step.step}`),
        timeMetric,
        tokenMetric,
        chips.map((chip, i) => h(StepTag, {
          key: 'tag-' + i,
          tag: chip.tag,
          count: chip.count ?? 1,
          overflow: chip.overflow === true,
          label: i === 0 ? name.label : null,
        })),
        caption,
        hasError ? h('span', { style: { flex: '0 0 8px', width: 8, height: 8, borderRadius: '50%', background: T.error } }) : null,
      );
      return h('div', {
        style: open
          ? {
            // Step bracket (F129): outline unchanged (1px ring + 3px rail +
            // radius + clip), only the fill is gone. Indented one level.
            borderTop: '1px solid ' + T.stepGroupRing,
            borderRight: '1px solid ' + T.stepGroupRing,
            borderBottom: '1px solid ' + T.stepGroupRing,
            borderLeft: '3px solid ' + T.rail,
            borderRadius: T.radiusMd,
            overflow: 'hidden',
            padding: '0 0 2px',
            margin: `2px 0 2px ${STEP_INDENT}px`,
            background: 'transparent',
          }
          // Closed Steps keep the same indent, so toggling never shifts rows;
          // no separator either — spacing alone separates them.
          : { marginLeft: `${STEP_INDENT}px` },
      },
      row, h(Collapse, { open, expandMs: contentReady ? EXPAND_MS : 0 }, content));
    }

    /**
     * The Step's expanded container (SPEC F129): a card with a composition
     * header, then one row per activity in event order — model call, tool call,
     * context/system injection — each tagged with its role. Raw JSON stays an
     * optional per-row link.
     */
    function StepContent({ sessionId, runIdx, stepIdx, runPrompt, runActor, t, refreshToken }) {
      const key = sessionId + '::' + runIdx + '::' + stepIdx;
      const [nonce, setNonce] = useState(0);
      const [state, setState] = useState(() => (cache.step.has(key)
        ? { data: cache.step.get(key), loading: false, error: null }
        : { data: null, loading: true, error: null }));
      const [rawOpen, setRawOpen] = useState(() => new Set());
      // F159: context/system injections collapse into one row by default.
      const [ctxOpen, setCtxOpen] = useState(false);
      // F140: the parent bumps this token when the session log grew, so an open
      // panel shows a running tool call turning into "finished + duration"
      // without the user closing and reopening the step.
      const seenToken = useRef(refreshToken ?? 0);

      useEffect(() => {
        const stale = seenToken.current !== (refreshToken ?? 0);
        if (stale) {
          seenToken.current = refreshToken ?? 0;
          cache.step.delete(key);
        }
        if (cache.step.has(key)) return undefined;
        let cancelled = false;
        // F141: a live refresh must not blank the panel — keep the previous
        // content on screen ("stale-while-revalidate") and swap it in place when
        // the new slice arrives. Only a first load shows 载入 step 内容….
        setState((prev) => (stale && prev.data != null
          ? { data: prev.data, loading: false, error: null, refreshing: true }
          : { data: null, loading: true, error: null, refreshing: false }));
        fetchPayload('step', { sessionId, idx: runIdx, step: stepIdx })
          .then(({ json }) => {
            cacheSet(cache.step, key, json, CACHE_MAX.step);
            if (!cancelled) setState({ data: json, loading: false, error: null, refreshing: false });
          })
          .catch((err) => {
            if (!cancelled) {
              setState((prev) => (prev.data != null
                ? { data: prev.data, loading: false, error: null, refreshing: false }
                : { data: null, loading: false, error: String((err && err.message) || err), refreshing: false }));
            }
          });
        return () => { cancelled = true; };
      }, [key, nonce, refreshToken, sessionId, runIdx, stepIdx]);

      const label = (k, fb) => (t ? t(k) : fb);
      // The Step bracket (StepRow wrapper) already supplies the tint + rail, so
      // the detail block itself is transparent and only indents/divides rows.
      const cardStyle = {
        marginLeft: 74, marginTop: 0, marginBottom: 4,
        padding: '2px 10px 4px 12px',
      };

      if (state.loading) return h('div', { style: { ...cardStyle, fontSize: 12, color: T.muted } }, label('step.loading', '载入 Step 内容…'));
      if (state.error != null) {
        return h('div', { style: { ...cardStyle, fontSize: 12, color: T.error } },
          state.error,
          h('button', {
            type: 'button',
            onClick: () => { cache.step.delete(key); setNonce((value) => value + 1); },
            style: { marginLeft: 8, font: 'inherit', fontSize: 11, color: T.text, background: T.surface, border: '1px solid ' + T.border, borderRadius: T.radiusSm, padding: '1px 8px', cursor: 'pointer' },
          }, label('step.retry', '重试')),
        );
      }

      const data = state.data;
      const slowMs = data.slowMs ?? DEFAULT_SLOW_MS;
      const usage = data.usage ?? {};
      const counts = data.counts ?? { models: 0, tools: 0, contexts: 0 };

      const toggleRaw = (rawKey) => setRawOpen((prev) => {
        const next = new Set(prev);
        if (next.has(rawKey)) next.delete(rawKey); else next.add(rawKey);
        return next;
      });
      // F159: the raw JSON panel belongs to the card that owns the seqs.
      const rawPanel = (seqs) => {
        const rawKey = seqs.filter((value) => value != null).join(',');
        if (rawKey === '' || !rawOpen.has(rawKey)) return null;
        return h(EventDetail, { sessionId, seqs });
      };

      // F159 (option B+E): one summary strip, then a timeline of small cards.
      // Context/system injections are runtime noise — they collapse into a single
      // row and only expand on request.
      const palette = (role) => ROLE[role] ?? ROLE.system;
      const chipOf = (text, role, title) => h(RowTag, {
        text,
        color: palette(role).color,
        background: palette(role).background,
        title: title ?? text,
      });
      const mono11 = { fontFamily: T.mono, fontSize: 11 };
      const cardBox = (extra) => Object.assign({
        border: '1px solid ' + T.border, borderRadius: T.radiusSm,
        padding: '5px 9px 6px', background: T.surface, minWidth: 0,
      }, extra ?? {});
      const capRow = (left, right) => h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 } },
        left,
        h('span', { style: { flex: '1 1 auto' } }),
        right ?? null);

      // ---- E: summary strip -------------------------------------------------
      const sumChip = (text, role, title) => h('span', {
        key: 'sum-' + text,
        style: { display: 'inline-flex', alignItems: 'baseline', gap: 5, color: palette(role).color },
      },
        h('b', { style: { fontSize: 12, fontWeight: 600 } }, text),
        title ? h('span', { style: { fontSize: 11, color: T.muted } }, title) : null);

      const tokenText = 'in ' + fmtK(usage.input) + ' / out ' + fmtK(usage.output)
        + ((usage.cacheRead ?? 0) > 0 ? ` · cache ${fmtK(usage.cacheRead)}` : '')
        + ((usage.reasoning ?? 0) > 0 ? ` · think ${fmtK(usage.reasoning)}` : '');
      const strip = h('div', {
        key: 'strip',
        style: {
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '5px 10px', marginBottom: 8,
          border: '1px solid ' + T.border, borderRadius: T.radiusSm, background: T.surface,
        },
      },
        sumChip(`模型 ${counts.models ?? 0}`, 'assistant', data.model ? [data.model.provider, data.model.model].filter(Boolean).join('/') : null),
        h('span', { style: { width: 1, height: 11, background: T.border } }),
        sumChip(`工具 ${counts.tools ?? 0}`, 'tool'),
        (counts.contexts ?? 0) > 0 ? h('span', { style: { width: 1, height: 11, background: T.border } }) : null,
        (counts.contexts ?? 0) > 0 ? sumChip(`上下文 ${counts.contexts}`, 'context') : null,
        h('span', { style: { flex: '1 1 auto' } }),
        h('span', { style: { ...mono11, color: T.muted } }, `计时 ${fmtMs(data.timeMs)} · ${tokenText}`),
      );

      // ---- B: timeline ------------------------------------------------------
      // Group the injections so a step with six system-reminders still reads as
      // "reply + tools" instead of a wall of context.
      const items = [];
      let ctxGroup = null;
      for (const op of data.operations ?? []) {
        if (op.kind === 'context' || op.kind === 'system') {
          if (!ctxGroup) {
            ctxGroup = { kind: 'ctxGroup', list: [], seqs: [] };
            items.push(ctxGroup);
          }
          ctxGroup.list.push(op);
          ctxGroup.seqs.push(op.seq);
          continue;
        }
        items.push(op);
      }

      const DOT = {
        user: T.brand, assistant: palette('assistant').color, tool: palette('tool').color,
        context: palette('context').color, note: T.muted, error: T.error,
      };
      const dotOf = (role) => h('span', {
        style: {
          position: 'absolute', left: -13, top: 8, width: 7, height: 7, borderRadius: '50%',
          background: DOT[role] ?? T.muted,
        },
      });

      const rawButton = (seqs) => {
        const rawKey = seqs.filter((value) => value != null).join(',');
        if (rawKey === '') return null;
        const open = rawOpen.has(rawKey);
        return h('button', {
          type: 'button',
          onClick: () => toggleRaw(rawKey),
          style: { font: 'inherit', fontSize: 11, color: open ? T.text : T.faint, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 },
        }, label('step.original', '原文'));
      };

      const timeline = [];

      if (stepIdx === 0 && runActor === 'user' && runPrompt) {
        timeline.push(h('div', { key: 'instruction', style: { position: 'relative', marginBottom: 8 } },
          dotOf('user'),
          h('div', { style: cardBox() },
            capRow(chipOf('USER', 'user', label('step.instruction', '指令')),
              h('span', { style: { ...mono11, color: T.faint } }, `${runPrompt.length} 字`)),
            // F147: full instruction text; the block scrolls, it is not cut.
            h('div', {
              title: runPrompt,
              style: { marginTop: 2, fontSize: 12, lineHeight: 1.55, color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 96, overflow: 'auto' },
            }, runPrompt),
          ),
        ));
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'ctxGroup') {
          const n = item.list.length;
          const open = ctxOpen;
          timeline.push(h('div', { key: 'ctx-group', style: { position: 'relative', marginBottom: 8 } },
            dotOf('context'),
            h('div', {
              style: cardBox({ borderStyle: 'dashed', background: T.surface, cursor: 'pointer' }),
              onClick: () => setCtxOpen((value) => !value),
              title: open ? '收起注入内容' : '展开注入内容',
            },
              capRow(
                h('span', { style: { display: 'inline-flex', alignItems: 'baseline', gap: 8 } },
                  chipOf('CTX', 'context'),
                  h('span', { style: { fontSize: 12, ...mono11 } }, `注入 ×${n}`),
                  h('span', { style: { ...mono11, color: T.muted } }, open ? '收起' : '展开'),
                ),
                rawButton(item.seqs),
              ),
              open ? item.list.map((op, k) => h('div', {
                key: 'ctx-' + (op.seq ?? k),
                style: { marginTop: 4, fontSize: 12, lineHeight: 1.5, color: T.muted, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 96, overflow: 'auto' },
                title: op.text,
              }, op.text)) : null,
              rawPanel(item.seqs),
            ),
          ));
          continue;
        }
        const op = item;
        if (op.kind === 'assistant') {
          const value = op.usage ?? {};
          timeline.push(h('div', { key: 'op-' + op.seq, style: { position: 'relative', marginBottom: 8 } },
            dotOf('assistant'),
            h('div', { style: cardBox() },
              capRow(
                h('span', { style: { display: 'inline-flex', alignItems: 'baseline', gap: 8 } },
                  chipOf('REPLY', 'assistant', label('step.modelCall', '模型调用')),
                  h('span', { style: { fontSize: 12, ...mono11 } }, label('step.modelCall', '模型调用'))),
                h('span', { style: { display: 'inline-flex', alignItems: 'baseline', gap: 8 } },
                  h('span', { style: { ...mono11, color: T.muted } }, `in ${fmtK(value.input)} · out ${fmtK(value.output)}`),
                  rawButton([op.seq])),
              ),
              op.text ? h('div', {
                title: op.text,
                style: { marginTop: 2, fontSize: 12, lineHeight: 1.55, color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 132, overflow: 'auto' },
              }, op.text) : null,
              rawPanel([op.seq]),
            ),
          ));
          continue;
        }
        if (op.kind === 'tool') {
          const failed = op.error != null || op.isError;
          const isSlow = typeof op.durationMs === 'number' && op.durationMs > slowMs;
          const errorText = failed ? (op.error ?? 'error') : (isSlow ? label('step.slow', '慢') : null);
          timeline.push(h('div', { key: 'op-' + op.seq, style: { position: 'relative', marginBottom: 8 } },
            dotOf(failed ? 'error' : 'tool'),
            h('div', { style: cardBox(failed ? { borderColor: T.error } : null) },
              capRow(
                h('span', { style: { display: 'inline-flex', alignItems: 'baseline', gap: 8, minWidth: 0 } },
                  chipOf('TOOL', 'tool'),
                  h('span', { style: { fontSize: 12, ...mono11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, String(op.name ?? ''))),
                h('span', { style: { display: 'inline-flex', alignItems: 'baseline', gap: 8 } },
                  errorText != null ? h('span', { style: { fontSize: 11, color: failed ? T.error : T.warn } }, errorText) : null,
                  h('span', { style: { ...mono11, color: T.muted } }, op.durationMs != null ? fmtMs(op.durationMs) : '—'),
                  rawButton([op.callSeq, op.resultSeq])),
              ),
              op.args ? h('div', {
                title: op.args,
                style: { marginTop: 3, ...mono11, color: T.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
              }, op.args) : null,
              op.result ? h('div', {
                title: op.result,
                style: { marginTop: 1, ...mono11, color: failed ? T.error : T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
              }, op.result) : (op.durationMs != null ? h('div', { style: { marginTop: 1, ...mono11, color: T.faint } }, '无结果') : null),
              rawPanel([op.callSeq, op.resultSeq]),
            ),
          ));
          continue;
        }
        // note rows keep the compact one-liner look (they are annotations, not work)
        const noteKey = 'op-' + op.seq;
        const tone = op.noteKind === 'fail' ? T.error : op.noteKind === 'retry' ? T.warn : T.muted;
        const notePalette = op.noteKind === 'fail'
          ? STEP_TAG_ERROR
          : (op.noteKind === 'retry' || op.noteKind === 'compact' ? ROLE.tool : ROLE.system);
        timeline.push(h('div', { key: noteKey, style: { position: 'relative', marginBottom: 8 } },
          dotOf(op.noteKind === 'fail' ? 'error' : 'note'),
          h('div', { style: cardBox({ padding: '3px 9px', background: 'transparent', borderStyle: 'dotted' }) },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
              h(RowTag, {
                text: NOTE_TAG_EN[op.noteKind] ?? 'EVENT',
                color: notePalette.color,
                background: notePalette.background,
                title: label('note.' + (op.noteKind ?? 'note'), NOTE_TAG[op.noteKind] ?? '事件'),
              }),
              h('span', { title: op.text, style: { fontSize: 12, ...mono11, color: tone, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, op.text),
            ),
          ),
        ));
      }

      const empty = timeline.length === 0;
      return h('div', { style: cardStyle },
        strip,
        empty
          ? h('div', { style: { marginTop: 4, fontSize: 12, color: T.muted } }, label('step.empty', '该 Step 无内容'))
          : h('div', { style: { position: 'relative', paddingLeft: 14 } },
            h('span', {
              style: { position: 'absolute', left: 4, top: 6, bottom: 6, width: 1, background: 'color-mix(in srgb, ' + T.text + ' 12%, transparent)' },
            }),
            timeline,
          ),
      );
    }


    /**
     * Raw event JSON, fetched only when the user opens an operation (SPEC F121/NF6).
     * Accepts one or more seqs (a tool call shows call + result together).
     */
    function EventDetail({ sessionId, seqs }) {
      const list = seqs.filter((s) => s != null);
      const key = sessionId + '::' + list.join(',');
      const [state, setState] = useState(() => (cache.event.has(key) ? { value: cache.event.get(key), loading: false, error: null } : { value: null, loading: true, error: null }));
      useEffect(() => {
        if (cache.event.has(key) || list.length === 0) return undefined;
        let cancelled = false;
        setState({ value: null, loading: true, error: null });
        Promise.all(list.map((seq) => fetchPayload('event', { sessionId, seq })))
          .then((results) => {
            const value = results.length === 1 ? (results[0].json?.target ?? results[0].json) : results.map((r) => r.json?.target ?? r.json);
            cacheSet(cache.event, key, value, CACHE_MAX.event);
            if (!cancelled) setState({ value, loading: false, error: null });
          })
          .catch((err) => { if (!cancelled) setState({ value: null, loading: false, error: String((err && err.message) || err) }); });
        return () => { cancelled = true; };
      }, [key]);

      if (state.loading) return h('div', { style: { padding: '4px 0', fontSize: 12, color: T.muted } }, '载入原文…');
      if (state.error != null) return h('div', { style: { padding: '4px 0', fontSize: 12, color: T.error } }, state.error);
      let text;
      try { text = JSON.stringify(state.value, null, 2); } catch { text = String(state.value); }
      return h('pre', { style: { margin: '4px 0 0 0', padding: '6px 10px', fontSize: 12, lineHeight: 1.4, fontFamily: T.mono, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflow: 'auto', background: T.surface, border: '1px solid ' + T.border, borderRadius: T.radiusSm } }, text);
    }

    function Body({ sessionId, t }) {
      // F149: keep the hover/selection palette in sync with the live theme. This
      // runs during render (cheap attribute read) and the observer below forces a
      // re-render when the user flips light/dark.
      applyThemePalette();
      const [, setThemeTick] = useState(0);
      useEffect(() => {
        if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return undefined;
        const observer = new MutationObserver(() => {
          if (applyThemePalette()) setThemeTick((n) => n + 1);
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ds-theme-source', 'style'] });
        return () => observer.disconnect();
      }, []);
      const [fullRuns, setFullRuns] = useState(() => new Set());
      // F150: scroll container, so "locate this run" can bring the row into view
      // without touching the document (another slot instance may be mounted).
      const scrollRef = useRef(null);
      const rootRef = useRef(null);
      // F155 app-shell height: without a definite height the panel just grows and
      // the *page* scrolls, carrying the header away no matter how it is pinned.
      // Give the shell the viewport space below its own top edge, capped by the
      // parent's visible box, so the list gets a real scrollport of its own.
      const [shellH, setShellH] = useState(null);
      const [payload, setPayload] = useState(null);
      const [error, setError] = useState(null);
      const [loading, setLoading] = useState(false);
      const [sort, setSort] = useState(null);
      const [expanded, setExpanded] = useState(() => new Set());
      const [details, setDetails] = useState(() => new Map());
      const [detailLoading, setDetailLoading] = useState(() => new Set());
      const [detailErrors, setDetailErrors] = useState(() => new Map());
      // Handle of the running "glide to this run" tween (F151) and of the delay
      // that waits for a just-opened run's height animation (F156).
      const glideRaf = useRef(null);
      const glideTimer = useRef(null);
      useEffect(() => {
        const root = rootRef.current;
        if (!root || typeof window === 'undefined') return undefined;
        const fit = () => {
          const rootTop = Math.max(0, root.getBoundingClientRect().top);
          const parent = root.parentElement;
          const parentRect = parent ? parent.getBoundingClientRect() : null;
          const availView = Math.max(0, window.innerHeight - rootTop);
          const availParent = parentRect ? Math.max(0, parentRect.bottom - rootTop) : availView;
          const h = Math.max(320, Math.min(availView, availParent || availView));
          setShellH((prev) => (prev != null && Math.abs(prev - h) < 2 ? prev : Math.round(h)));
        };
        fit();
        window.addEventListener('resize', fit);
        // The slot may be laid out a frame or two after mount.
        const id = window.setTimeout(fit, 250);
        return () => {
          window.removeEventListener('resize', fit);
          window.clearTimeout(id);
        };
      }, []);
      // F140 realtime: `seq` is the log offset the current payload was built at.
      const seqRef = useRef(null);
      const tickBusy = useRef(false);
      const expandedRef = useRef(expanded);
      expandedRef.current = expanded;
      // step key -> counter; bumping it makes an open StepContent refetch.
      const [stepTokens, setStepTokens] = useState(() => ({}));

      const load = useCallback((force) => {
        if (!sessionId) { setPayload(null); setError(null); setLoading(false); return undefined; }
        if (!force && cache.runs.has(sessionId)) {
          const hit = cache.runs.get(sessionId);
          seqRef.current = hit.payload?.meta?.seq ?? null;
          setPayload(hit.payload); setError(null); setLoading(false);
          return undefined;
        }
        let cancelled = false;
        // F138: a pending /runs must not keep a socket (or a 17k-event session's
        // JSON parse) alive after the user has already switched away.
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        setLoading(true); setError(null);
        setDetails(new Map()); setDetailLoading(new Set()); setDetailErrors(new Map());
        fetchPayload('runs', { sessionId }, controller?.signal).then(({ json, bytes, ms }) => {
          if (cancelled) return;
          const info = {
            ms: Math.round(ms * 10) / 10,
            bytes,
            serverMs: json?.meta?.serverMs ?? null,
            parseMs: null,
            cached: false,
          };
          cacheSet(cache.runs, sessionId, { payload: json, info }, CACHE_MAX.runs);
          seqRef.current = json?.meta?.seq ?? null;
          appliedSig.current = payloadSig(json);
          setPayload(json); setLoading(false);
        }).catch((err) => {
          if (cancelled) return;
          if (err && err.name === 'AbortError') { setLoading(false); return; }
          setError(String((err && err.message) || err)); setLoading(false);
        });
        return () => { cancelled = true; controller?.abort(); };
      }, [sessionId]);

      useEffect(() => load(false), [load]);

      /**
       * F158: how much "visible change" is in a payload? The 2 s tick can deliver
       * a new seq while every number on screen is identical; re-rendering 175 rows
       * and 700 matrix cells for that is pure waste. Signature covers the counts,
       * the token totals and the tail run (the row that actually grows while a
       * turn is running).
       */
      const payloadSig = (p) => {
        if (!p) return '';
        const total = p.tokens?.total ?? {};
        const last = p.runs && p.runs.length ? p.runs[p.runs.length - 1] : null;
        return [
          p.counts?.runs, p.counts?.steps, p.counts?.events, total.input, total.output,
          last ? `${last.idx}:${last.token}:${last.time}:${last.stepCount}` : '',
        ].join('|');
      };
      const appliedSig = useRef('');
      // Last time the user scrolled the list. A payload that lands mid-scroll is
      // applied after the gesture ends, so the update never steals frames from the
      // scroll itself.
      const scrollAt = useRef(0);
      const pendingCommit = useRef(null);

      const commitRunsPayload = (json) => {
        seqRef.current = json?.meta?.seq ?? null;
        cacheSet(cache.runs, sessionId, {
          payload: json,
          info: { ms: 0, bytes: 0, serverMs: json?.meta?.serverMs ?? null, cached: true },
        }, CACHE_MAX.runs);
        const sig = payloadSig(json);
        if (sig === appliedSig.current) return false; // nothing visible changed
        appliedSig.current = sig;
        setPayload(json);
        return true;
      };

      useEffect(() => {
        const host = scrollRef.current;
        if (!host) return undefined;
        const onScroll = () => { scrollAt.current = Date.now(); };
        host.addEventListener('scroll', onScroll, { passive: true });
        return () => host.removeEventListener('scroll', onScroll);
      }, []);

      /**
       * F140: one cheap poll. Sends the offset we already hold, so an unchanged
       * session costs the Host ~1 ms and ~40 B, and nothing re-renders. When the
       * log did grow: replace the run table, refresh the expanded run's step
       * index, and bump every open Step panel so a running tool call turns into
       * "finished + duration" in place.
       */
      const tick = useCallback(async () => {
        if (!sessionId || tickBusy.current) return;
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        tickBusy.current = true;
        try {
          const since = seqRef.current;
          const { json } = await fetchPayload('runs', since == null ? { sessionId } : { sessionId, since });
          if (!json || json.unchanged === true) {
            // F141: a quiet tick must not write state. Returning `prev` from the
            // updater lets React bail out, so the 150+ row table is not rebuilt
            // (and does not re-measure) every 2 s while the session is idle.
            return;
          }
          seqRef.current = json?.meta?.seq ?? null;
          cacheSet(cache.runs, sessionId, {
            payload: json,
            info: { ms: 0, bytes: 0, serverMs: json?.meta?.serverMs ?? null, cached: true },
          }, CACHE_MAX.runs);
          // F158: apply now, or after the user stops scrolling.
          const applyNow = async () => {
            pendingCommit.current = null;
            if (!commitRunsPayload(json)) return;
            const openKeys = [...expandedRef.current];
            for (const key of openKeys) {
              if (!key.startsWith('run-')) continue;
              const idx = Number(key.slice(4));
              if (!Number.isInteger(idx)) continue;
              try {
                const { json: detail } = await fetchPayload('run', { sessionId, idx });
                cacheSet(cache.run, sessionId + '::' + idx, detail, CACHE_MAX.run);
                setDetails((prev) => new Map(prev).set(idx, detail));
              } catch { /* keep the previous detail for this run */ }
            }
            const openSteps = openKeys.filter((key) => !key.startsWith('run-'));
            if (openSteps.length > 0) {
              setStepTokens((prev) => {
                const next = { ...prev };
                for (const key of openSteps) next[key] = (next[key] ?? 0) + 1;
                return next;
              });
            }
          };
          if (Date.now() - scrollAt.current < 220) {
            if (pendingCommit.current != null) clearTimeout(pendingCommit.current);
            pendingCommit.current = setTimeout(() => { void applyNow(); }, 240);
          } else {
            void applyNow();
          }
        } catch {
          // A failed tick is not an error state: keep the last good table and
          // let the next tick try again.
        } finally {
          tickBusy.current = false;
        }
      }, [sessionId]);

      useEffect(() => {
        if (!sessionId) return undefined;
        const EVERY = 2000;
        let timer = null;
        let cancelled = false;
        const schedule = (delay) => {
          if (cancelled) return;
          if (timer != null) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
              schedule(EVERY);
              return;
            }
            tick().finally(() => schedule(EVERY));
          }, delay);
        };
        const onVisibility = () => {
          if (typeof document === 'undefined') return;
          if (document.visibilityState === 'visible') {
            schedule(400); // come back: catch up right away, then resume the rhythm
          } else {
          }
        };
        schedule(EVERY);
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
        return () => {
          cancelled = true;
          if (timer != null) clearTimeout(timer);
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
        };
      }, [sessionId, tick]);

      const openRun = (idx) => {
        const runKey = 'run-' + idx;
        const willOpen = !expanded.has(runKey);
        setExpanded((prev) => { const n = new Set(prev); if (n.has(runKey)) n.delete(runKey); else n.add(runKey); return n; });
        if (!willOpen || !sessionId) return;
        const key = sessionId + '::' + idx;
        if (cache.run.has(key)) {
          const hit = cache.run.get(key);
          setDetails((prev) => new Map(prev).set(idx, hit));
          return;
        }
        setDetailLoading((prev) => new Set(prev).add(idx));
        fetchPayload('run', { sessionId, idx }).then(({ json }) => {
          cacheSet(cache.run, key, json, CACHE_MAX.run);
          setDetails((prev) => new Map(prev).set(idx, json));
        }).catch((err) => {
          setDetailErrors((prev) => new Map(prev).set(idx, String((err && err.message) || err)));
        }).finally(() => {
          setDetailLoading((prev) => { const n = new Set(prev); n.delete(idx); return n; });
        });
      };

      /**
       * F150/F151/F156: a click on the overview matrix locates a run — it opens
       * the run (never toggles it closed, unlike a click on the row itself) and
       * glides its row into view.
       *
       * The glide is animated by hand instead of `scrollIntoView({behavior:
       * 'smooth'})`: the native version is jumpy on long distances, cannot be
       * cancelled, and (in this panel) sometimes does not move at all. A rAF
       * tween with easeInOutCubic is deterministic, ~260–700 ms by distance, and
       * a new click simply replaces the running animation.
       */
      const locateRun = (idx) => {
        const wasOpen = expanded.has('run-' + idx);
        if (!wasOpen) openRun(idx);
        const host = scrollRef.current;
        if (!host) return;
        const reduce = typeof window !== 'undefined' && window.matchMedia
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const glide = () => {
          const el = host.querySelector('[data-run="' + idx + '"]');
          if (!el) return;
          // F155: the list box is the only scroller now (the header block is a
          // flex sibling above it), so this is plain scrollTop arithmetic.
          const viewH = host.clientHeight;
          const current = host.scrollTop;
          const maxScroll = Math.max(0, host.scrollHeight - host.clientHeight);
          const board = rootRef.current ? rootRef.current.querySelector('[data-hades-board]') : null;
          const boardH = board ? board.offsetHeight : 0;
          const anchor = Math.min(viewH * 0.6, Math.max(viewH * 0.32, boardH + 16));
          const offset = el.getBoundingClientRect().top - host.getBoundingClientRect().top;
          const target = Math.max(0, Math.min(maxScroll, current + offset - anchor));
          const delta = target - current;
          if (Math.abs(delta) < 2) return;
          if (reduce || typeof requestAnimationFrame !== 'function') { host.scrollTop = target; return; }
          const duration = Math.min(700, Math.max(260, Math.abs(delta) * 0.5));
          const t0 = performance.now();
          const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
          if (glideRaf.current != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(glideRaf.current);
          const step = (now) => {
            const p = Math.min(1, (now - t0) / duration);
            host.scrollTop = current + delta * ease(p);
            glideRaf.current = p < 1 ? requestAnimationFrame(step) : null;
          };
          glideRaf.current = requestAnimationFrame(step);
        };
        // F156: when the run still has to open, its 160ms height animation and
        // the scroll tween compete for the main thread — and the list keeps
        // growing underneath the tween. Let the expansion land first, then glide.
        const kick = () => {
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(glide));
          else glide();
        };
        if (wasOpen) { kick(); return; }
        if (glideTimer.current != null) clearTimeout(glideTimer.current);
        glideTimer.current = setTimeout(() => { glideTimer.current = null; kick(); }, 200);
      };

      /** Toggle one Step's panel; its row highlight follows the open state. */
      const selectStep = (runIdx, stepIdx) => {
        const key = `${runIdx}::${stepIdx}`;
        setExpanded((prev) => {
          const n = new Set(prev);
          if (n.has(key)) n.delete(key); else n.add(key);
          return n;
        });
      };

      const label = (k, fb) => (t ? t(k) : fb);

      const kpi = useMemo(() => {
        if (!payload) return null;
        const total = payload.tokens?.total ?? {};
        return {
          runs: payload.counts?.runs ?? payload.runs?.length ?? 0,
          steps: payload.counts?.steps ?? 0,
          events: payload.counts?.events ?? 0,
          tokenTotal: (total.input ?? 0) + (total.output ?? 0),
          errors: payload.kpi?.errors ?? 0,
          slow: payload.kpi?.slow ?? 0,
          abnormal: payload.kpi?.abnormal ?? 0,
          slowest: payload.kpi?.slowest ?? null,
          slowMs: payload.meta?.slowMs ?? DEFAULT_SLOW_MS,
        };
      }, [payload]);

      const renderDetail = (run) => {
        const detail = details.get(run.idx);
        if (!detail) {
          if (detailErrors.has(run.idx)) return h('div', { style: { padding: '4px 0 6px 74px', fontSize: 12, color: T.error } }, detailErrors.get(run.idx));
          return h('div', { style: { padding: '4px 0 6px 74px', fontSize: 12, color: T.muted } }, detailLoading.has(run.idx) ? label('loadingDetail', '载入 step…') : '');
        }
        const min = detail.startTime ?? run.startTime ?? 0;
        const max = detail.endTime ?? run.endTime ?? 0;
        const maxStepTime = Math.max(1, ...detail.steps.map((s) => s.timeMs ?? 0));
        // F143: a Step's token track is the RUN's total, and steps fill it from
        // the left in order — step k occupies [cum(k-1), cum(k)] of that total.
        // The faint fill shows how much of the run is already spent by the time
        // this step starts; the solid slice is this step's own share.
        const stepTokens = detail.steps.map((s) => s.token ?? 0);
        const runTokenTotal = Math.max(1, stepTokens.reduce((a, b) => a + b, 0));
        const cumTokens = [];
        stepTokens.reduce((acc, t) => { const next = acc + t; cumTokens.push(next); return next; }, 0);
        // The bracket's 16px indent + 3px rail shifts the Step content right, so
        // its index cell is narrowed by that amount to keep both bar columns
        // aligned with the Run row above.
        const stepIdxWidth = RUN_IDX_W - (STEP_INDENT + 3);
        // F138: one run can hold 200+ steps (this session has a 211-step run).
        // Mounting all of them at once is the only place where our own panel can
        // jank while scrolling, so long runs open in pages of STEP_PAGE.
        const showAll = fullRuns.has(run.idx);
        const shown = showAll ? detail.steps.length : Math.min(detail.steps.length, STEP_PAGE);
        const hidden = detail.steps.length - shown;
        return h('div', { style: { margin: '2px 0 0 0' } },
          detail.steps.slice(0, shown).map((step, stepIdx) => {
            const skey = `${run.idx}::${stepIdx}`;
            const sopen = expanded.has(skey);
            // Highlight follows expansion: an open Step keeps its row lit.
            const selected = sopen;
            const sToken = step.token ?? 0;
            const timeText = step.timeMs != null ? fmtMs(step.timeMs) : '—';
            const tokenText = sToken > 0 ? fmtK(sToken) : '—';
            const stepTimePct = step.timeMs != null ? Math.max((step.timeMs / maxStepTime) * 100, 0.5) : 0;
            const cumPct = (cumTokens[stepIdx] / runTokenTotal) * 100;
            const beforePct = ((cumTokens[stepIdx] - sToken) / runTokenTotal) * 100;
            const ownPct = Math.max(cumPct - beforePct, sToken > 0 ? 0.6 : 0);
            const sharePct = Math.round((sToken / runTokenTotal) * 1000) / 10;
            // F145: Time and Token use the same two fills — a faint "consumed
            // before this step" underlay plus this step's own solid slice — so
            // the columns differ in colour only. Time keeps its gantt meaning
            // (start/end on the run timeline); token keeps its cumulative
            // meaning (token k sits at [cum(k-1), cum(k)] of the run total).
            const timeRange = (max - min) || 1;
            const timeLeftPct = Math.min(100, Math.max(0, step.startTime != null ? ((step.startTime - min) / timeRange) * 100 : 0));
            const timeWidthPct = Math.max(0, Math.min(100 - timeLeftPct,
              (step.startTime != null && step.endTime != null)
                ? Math.max(((step.endTime - step.startTime) / timeRange) * 100, 1.5)
                : stepTimePct));
            const timeFill = h('div', null,
              h(SpentFill, { tone: T.brand, pct: timeLeftPct }),
              h(SliceFill, {
                tone: T.brand, left: timeLeftPct, width: timeWidthPct,
                tip: (step.startTime != null && step.endTime != null)
                  ? `${timeText} · ${fmtClock(step.startTime)} → ${fmtClock(step.endTime)}`
                  : timeText,
              }),
            );
            const tokenFill = h('div', null,
              // spent before this step (same underlay as the time column)
              h(SpentFill, { tone: T.token, pct: beforePct }),
              // this step's own slice
              h(SliceFill, { tone: T.token, left: beforePct, width: ownPct, tip: `${tokenText} tok · ${sharePct}% of Run · 累计 ${fmtK(cumTokens[stepIdx])} (${Math.round(cumPct)}%)` }),
            );
            return h(StepRow, {
              key: stepIdx,
              step,
              selected,
              open: sopen,
              onSelect: () => selectStep(run.idx, stepIdx),
              idxWidth: stepIdxWidth,
              timeMetric: h(MetricBar, {
                width: METRIC_W, numWidth: METRIC_NUM_W, tone: T.brand, fill: timeFill, valueText: timeText,
                // Split tooltip: execution = model + tools, waiting shown separately (F133).
                tip: [timeText]
                  .concat(step.modelMs != null ? ['模型 ' + fmtMs(step.modelMs)] : [])
                  .concat(step.toolMs > 0 ? ['工具 ' + fmtMs(step.toolMs)] : [])
                  .concat(fmtWait(step.waitMs) != null ? ['等待 ' + fmtWait(step.waitMs)] : [])
                  .join(' · '),
              }),
              tokenMetric: h(MetricBar, {
                width: METRIC_W, numWidth: METRIC_NUM_W, tone: T.token, fill: tokenFill, valueText: tokenText,
                // F143: the track is the run's total, so the tip says where this
                // step sits inside it and how much of the run is spent already.
                tip: `${tokenText} tok · ${sharePct}% of Run · 累计 ${fmtK(cumTokens[stepIdx])} (${Math.round(cumPct)}%)`,
              }),
              text: step.text ?? '—',
              title: step.title ?? step.text ?? '—',
              tag: step.tag ?? null,
              tags: step.tags ?? null,
              marks: step.marks ?? [],
              waitMs: step.waitMs ?? 0,
              // F144: only animate the height when this step's slice is cached.
              contentReady: cache.step.has(sessionId + '::' + run.idx + '::' + stepIdx),
              hasError: step.hasError,
              content: sopen
                ? h(StepContent, {
                  sessionId,
                  runIdx: run.idx,
                  stepIdx,
                  runPrompt: run.prompt,
                  runActor: run.actor,
                  t,
                  refreshToken: stepTokens[skey] ?? 0,
                })
                : null,
            });
          }),
          hidden > 0
            ? h('div', { key: 'more', style: { padding: '2px 0 4px ' + RUN_IDX_W + 'px' } },
              h('button', {
                type: 'button',
                onClick: () => setFullRuns((prev) => new Set(prev).add(run.idx)),
                style: {
                  font: 'inherit', fontSize: 11, fontFamily: T.mono, color: T.muted,
                  background: T.surface, border: '1px solid ' + T.border, borderRadius: T.radiusSm,
                  padding: '2px 8px', cursor: 'pointer',
                },
              }, `显示全部 ${detail.steps.length} 步（还有 ${hidden} 步）`))
            : null,
        );
      };

      // F155: split the panel into an app shell — the header block (KPI + matrix)
      // is a flex child ABOVE the scroller, so it cannot scroll: no listeners, no
      // transforms, nothing that a shadow boundary or an `overflow: hidden`
      // ancestor can defeat. Only the Run list scrolls.
      const renderHeader = () => {
        if (error != null || !payload) return null;
        if ((payload.counts?.events ?? 0) === 0) return null;
        return h(OverviewBoard, {
          kpi,
          rows: payload.runs ?? [],
          label,
          onLocate: locateRun,
        });
      };

      const renderList = () => {
        if (error != null) return h('div', { style: { color: T.error } }, String(error));
        if (loading && !payload) return h('div', { style: { color: T.muted } }, label('loading', '加载中…'));
        if (!payload) return null;
        if ((payload.counts?.events ?? 0) === 0) return h('div', { style: { color: T.muted } }, label('empty', '该会话暂无事件'));
        return h(DualBarChart, {
          rows: payload.runs ?? [],
          sort,
          onSort: setSort,
          sysLabel: label('system', '系统提示词'),
          expanded,
          onToggleRun: openRun,
          renderDetail,
          hasDetail: (idx) => details.has(idx),
          label,
        });
      };

      return h('div', {
        ref: rootRef,
        style: {
          height: shellH ? shellH + 'px' : '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
          boxSizing: 'border-box', fontSize: 13, lineHeight: 1.6, color: T.text, fontFamily: T.font,
          // F158: consumed by the injected hover rules (see ROW_ANIM_CSS).
          '--hades-hover-row': T.runHoverBg,
          '--hades-sel-row': T.runSelBg,
          '--hades-muted': T.muted,
          '--hades-text': T.text,
          '--hades-brand': T.brand,
        },
      },
        h('style', { key: 'hades-row-anim' }, ROW_ANIM_CSS),
        // F151: no header bar — the "cache hit / server ms / live badge / refresh
        // button" chrome was developer telemetry sitting on top of the product,
        // and the 2 s realtime tick makes a manual refresh unnecessary.
        h('div', { style: { flex: '0 0 auto', padding: '10px 12px 0', background: T.surface } }, renderHeader()),
        h('div', {
          ref: scrollRef,
          'data-hades-scroll': '1',
          style: {
            flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
            padding: '0 12px 12px',
            // F157: stop scroll chaining. Without this, one extra wheel tick at
            // the bottom of the list scrolled the *page* — which carried the whole
            // panel (header included) off-screen, and it looked like the matrix
            // had "stopped sticking" when scrolling back up.
            overscrollBehavior: 'contain',
          },
        },
          renderList(),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, {
          zh: {
            'view.title': 'Hades Lab',
            'loading': '加载中…', 'empty': '该会话暂无事件',
            'run': 'Run ', 'step': 'Step ', 'followup': '续跑', 'system': '系统提示词',
            'stat.runs': 'Run（指令）', 'stat.steps': 'Step（迭代）', 'stat.events': '事件', 'stat.tokens': 'Token',
            'stat.errors': '错误', 'stat.slow': '慢操作', 'stat.abnormal': '异常 Run', 'stat.slowest': '最慢操作',
            'mx.steps': '步数', 'mx.flags': '异常', 'mx.hint': '悬停看这个 Run · 点击定位', 'mx.clearSel': '取消选中',
            'mx.ramp': '颜色越深 = 该 Run 在全会话里的排位越高',
            'mx.error': '有错误', 'mx.slow': '有慢操作',
            'loadingDetail': '载入 Step…',
            'step.model': '模型', 'step.timing': '计时', 'step.tokens': 'Token', 'step.summary': '概述',
            'step.args': '参数', 'step.result': '结果', 'step.original': '原文', 'step.loading': '载入 Step 内容…',
            'step.retry': '重试', 'step.empty': '该 Step 无内容', 'step.instruction': '指令',
            'step.countModels': '模型调用', 'step.countTools': '工具调用', 'step.countContexts': '上下文',
            'step.modelCall': '模型调用', 'step.injected': '注入', 'step.systemPrompt': '系统提示词', 'step.slow': '慢',
            'role.user': '用户', 'role.assistant': '助手', 'role.context': '上下文',
            'role.tool': '工具', 'role.system': '系统',
            'steps': ' 步',
            'col.time': 'Time', 'col.token': 'Token',
            'sort.by': '已按', 'sort.on': '排序', 'sort.clear': '清除排序',
            'note.compact': '压缩', 'note.retry': '重试', 'note.fail': '失败', 'note.workspace': '变更',
            'note.command': '命令', 'note.plan': '计划', 'note.todo': '清单', 'note.deliver': '交付',
            'note.approval': '审批', 'note.note': '事件',
          },
          en: {
            'view.title': 'Hades Lab',
            'loading': 'Loading…', 'empty': 'No events in this session',
            'run': 'Run ', 'step': 'Step ', 'followup': 'follow-up', 'system': 'system prompt',
            'stat.runs': 'Runs', 'stat.steps': 'Steps', 'stat.events': 'Events', 'stat.tokens': 'Tokens',
            'stat.errors': 'Errors', 'stat.slow': 'Slow ops', 'stat.abnormal': 'Abnormal runs', 'stat.slowest': 'Slowest',
            'mx.steps': 'Steps', 'mx.flags': 'Flags', 'mx.hint': 'hover a Run · click to locate', 'mx.clearSel': 'clear selection',
            'mx.ramp': 'darker = higher rank within the session',
            'mx.error': 'has error', 'mx.slow': 'has slow op',
            'loadingDetail': 'loading Steps…',
            'step.model': 'model', 'step.timing': 'elapsed', 'step.tokens': 'tokens', 'step.summary': 'summary',
            'step.args': 'args', 'step.result': 'result', 'step.original': 'raw', 'step.loading': 'loading Step…',
            'step.retry': 'Retry', 'step.empty': 'Empty Step', 'step.instruction': 'instruction',
            'step.countModels': 'model calls', 'step.countTools': 'tool calls', 'step.countContexts': 'context',
            'step.modelCall': 'model call', 'step.injected': 'injected', 'step.systemPrompt': 'system prompt', 'step.slow': 'slow',
            'role.user': 'USER', 'role.assistant': 'ASSISTANT', 'role.context': 'CONTEXT',
            'role.tool': 'TOOL', 'role.system': 'SYSTEM',
            'steps': ' steps',
            'col.time': 'Time', 'col.token': 'Token',
            'sort.by': 'sorted by', 'sort.on': '', 'sort.clear': 'clear sort',
            'note.compact': 'compact', 'note.retry': 'retry', 'note.fail': 'fail', 'note.workspace': 'files',
            'note.command': 'cmd', 'note.plan': 'plan', 'note.todo': 'todo', 'note.deliver': 'deliver',
            'note.approval': 'approval', 'note.note': 'event',
          },
        }), 'trace-analyzer: locale');

        const t = ctx.locale.bind(NS);

        ctx.effect(() => {
          const disposeView = ctx.slots.inject('conversation.view', () => ctx.slots.register({
            name: 'conversation.view',
            id: VIEW_ID,
            order: 11,
            locale: NS,
            label: () => t('view.title'),
            inject: (sessionId) => ({ sessionId }),
          }, Body));
          return () => { disposeView(); };
        }, 'trace-analyzer: registration');
      },
    };
  },
});
