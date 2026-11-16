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
      runSelBg: 'color-mix(in srgb, var(--dsw-alias-trajectory-accent) 8%, var(--dsw-alias-bg-layer-1))',
      // Hover: same hue as the expanded/selected state, one notch lighter.
      runHoverBg: 'color-mix(in srgb, var(--dsw-alias-trajectory-accent) 6%, var(--dsw-alias-bg-layer-1))',
      // Expanded Step row: strongest fill, container itself stays transparent.
      stepSelBg: 'color-mix(in srgb, var(--dsw-alias-trajectory-accent) 22%, transparent)',
      stepHoverBg: 'color-mix(in srgb, var(--dsw-alias-trajectory-accent) 6%, transparent)',
      // Column header = sort control. The hover tint covers the whole column and
      // a 1px underline carries the affordance (a 6% tint alone is invisible).
      sortHoverBg: 'color-mix(in srgb, var(--dsw-alias-trajectory-accent) 8%, transparent)',
      sortHoverLine: 'color-mix(in srgb, var(--dsw-alias-trajectory-accent) 55%, transparent)',
    };

    // Indent for the Step level: Step rows and their bracket sit one level in
    // from the Run group, so nesting reads by position, not only by color.
    const STEP_INDENT = 12;
    // F138: a run may hold 200+ steps; render them in pages so a single expand
    // cannot mount thousands of nodes at once.
    const STEP_PAGE = 80;
    // Last Body build cost (ms). Written during render, read one frame later by
    // the header caption, so the number is attributable without extra renders.
    const perf = { lastBuildMs: null };
    // F141: live-appended rows fade in instead of popping in.
    const ROW_ANIM_CSS = '@keyframes hadesRowIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}';

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
    function Caret({ open }) {
      return h('span', {
        style: {
          display: 'inline-block', width: 10, flex: '0 0 10px', textAlign: 'center',
          transition: 'transform 160ms cubic-bezier(.2,.7,.3,1)',
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

    function clearSessionCache(sessionId) {
      for (const map of [cache.runs, cache.run, cache.step, cache.event]) {
        for (const key of [...map.keys()]) {
          if (key === sessionId || key.startsWith(sessionId + '::')) map.delete(key);
        }
      }
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
    function fmtBytes(n) {
      if (n == null || !Number.isFinite(n)) return '—';
      if (n < 1024) return n + ' B';
      return (n / 1024).toFixed(0) + ' KB';
    }
    function truncate(s, n) {
      const x = String(s ?? '').replace(/\s+/g, ' ').trim();
      return x.length > n ? x.slice(0, n) + '…' : x;
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

    function StatCard({ num, lbl, sub, tone, title }) {
      return h('div', { title, style: { border: '1px solid ' + T.border, borderRadius: T.radiusMd, padding: '10px 12px', background: T.surface, minWidth: 0 } },
        h('div', { style: { fontSize: 32, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: tone ?? T.text, letterSpacing: '-.01em' } }, num),
        h('div', { style: { fontSize: 12, color: T.muted, marginTop: 2 } }, lbl),
        sub ? h('div', { style: { fontSize: 11, color: T.muted, marginTop: 1 } }, sub) : null,
      );
    }

    // Fixed column widths: the same two tracks are shown on every row (Run and
    // Step), so time and tokens are compared side by side instead of toggling.
    // F139: tracks grew with the type (170 / 112) so `19.10s` and `126k` keep
    // their breathing room, and the index cell grew so `▸ step 199` fits.
    const RUN_IDX_W = 78;
    const TIME_W = 170;
    const TIME_NUM_W = 70;
    const TOKEN_W = 112;
    const TOKEN_NUM_W = 50;

    function DualBarChart({ rows, sort, onSort, sysLabel, expanded, onToggleRun, renderDetail, hasDetail, label }) {
      const listRef = useRef(null);
      const prevTops = useRef(new Map());
      const first = useRef(true);
      const lastOrder = useRef(null);
      const seenRuns = useRef(new Set());
      // Hover tint is the same hue as the expanded state, one notch lighter.
      const [hoverRun, setHoverRun] = useState(null);
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
              el.style.transition = 'none';
              el.style.transform = 'translateY(' + dy + 'px)';
              void el.offsetHeight; // force reflow so the transform applies before the transition
              el.style.transition = 'transform .3s cubic-bezier(.4,0,.2,1)';
              el.style.transform = 'translateY(0)';
              const cleanup = () => { el.style.transition = ''; el.style.transform = ''; el.removeEventListener('transitionend', cleanup); };
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
          h('div', { key: 'h-time', style: { flex: `0 0 ${TIME_W + 6 + TIME_NUM_W}px`, display: 'flex', alignItems: 'center', minWidth: 0 } },
            sortCol('time', label('col.time', 'Time'), T.brand, TIME_W)),
          h('div', { key: 'h-token', style: { flex: `0 0 ${TOKEN_W + 6 + TOKEN_NUM_W}px`, display: 'flex', alignItems: 'center', minWidth: 0 } },
            sortCol('token', label('col.token', 'Token'), T.token, TOKEN_W)),
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
            willChange: 'transform',
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
              onMouseEnter: () => setHoverRun(r.idx),
              onMouseLeave: () => setHoverRun((prev) => (prev === r.idx ? null : prev)),
              style: {
                display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', minWidth: 0,
                // No row separators: the outline look relies on the bracket + spacing.
                // Fill only: the group's overflow clips it to the outer radius.
                // Hover uses the same hue as the expanded state, one notch lighter.
                background: runSelected ? T.runSelBg : (hoverRun === r.idx ? T.runHoverBg : 'transparent'),
              },
            },
              h('span', { style: { flex: `0 0 ${RUN_IDX_W}px`, minWidth: 0, color: abnormal ? T.error : (runSelected ? T.text : T.muted), fontVariantNumeric: 'tabular-nums', userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 2 } },
                r.stepCount ? h(Caret, { key: 'caret', open }) : null,
                `run ${r.idx}`),
              h(MetricBar, {
                width: TIME_W,
                numWidth: TIME_NUM_W,
                tone: T.brand,
                fill: h('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: tPct + '%', transition: 'width .25s ease', background: T.brand } }),
                valueText: fmtMs(r.time),
                tip: fmtMs(r.time),
              }),
              // F142 (corrected): the run row keeps the plain magnitude bar; the
              // *distribution* lives on the step rows, where each step's track is
              // the run's total and the steps fill it cumulatively in order.
              h(MetricBar, {
                width: TOKEN_W,
                numWidth: TOKEN_NUM_W,
                tone: T.token,
                fill: h('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: kPct + '%', transition: 'width .25s ease', background: T.token } }),
                valueText: fmtK(r.token),
                tip: fmtK(r.token) + ' tok',
              }),
              h(RoleTag, { actor: r.actor, label }),
              h('span', { title: r.isSystemPrompt ? sysLabel : (r.prompt ?? ''), style: { flex: '1 1 auto', minWidth: 0, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.isSystemPrompt ? sysLabel : (truncate(r.prompt, 80) || '…')),
              abnormal ? h('span', { style: { flex: '0 0 8px', width: 8, height: 8, borderRadius: '50%', background: T.error } }) : null,
            ),
            // F144: opening a run grows its bracket instead of snapping it in;
            // a very long run (200+ steps, ~7k px) fades instead of animating
            // height, which would relayout every frame.
            h(Collapse, { open, expandMs: detailReady && (r.stepCount ?? 0) <= BIG_RUN_STEPS ? EXPAND_MS : 0 }, renderDetail(r)),
          );
        })),
      );
    }

    function TimeBar({ start, end, min, max, color, dashed, marker, tip }) {
      const range = (max - min) || 1;
      const left = ((start - min) / range) * 100;
      if (marker) return h('div', { title: tip, style: { position: 'absolute', left: `calc(${left}% - 1px)`, top: 2, bottom: 2, width: 2, background: color, borderRadius: T.radiusXs, opacity: .9 } });
      const width = Math.max(((end - start) / range) * 100, 1.5);
      return h('div', { title: tip, style: { position: 'absolute', left: left + '%', width: width + '%', transition: 'left .25s linear, width .25s linear', top: 1, bottom: 1, boxSizing: 'border-box', background: color, borderRadius: 99, opacity: 1, border: dashed ? '1px dashed ' + color : undefined } });
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
    function MetricBar({ tone, fill, valueText, tip, width = 170, numWidth = 50 }) {
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
        style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? T.text : T.muted },
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
        },
      },
        h('span', { style: { flex: `0 0 ${idxWidth}px`, minWidth: 0, color: selected ? T.text : T.muted, fontSize: 12, userSelect: 'none', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', display: 'inline-flex', alignItems: 'center', gap: 2 } },
          h(Caret, { key: 'caret', open }),
          `step ${step.step}`),
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

      if (state.loading) return h('div', { style: { ...cardStyle, fontSize: 12, color: T.muted } }, label('step.loading', '载入 step 内容…'));
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

      const headerParts = [];
      if (data.model != null) {
        const who = [data.model.provider, data.model.model].filter(Boolean).join('/');
        if (who) headerParts.push(`${label('step.model', '模型')} ${who}`);
      }
      headerParts.push(`${label('step.countModels', '模型调用')} ${counts.models}`);
      headerParts.push(`${label('step.countTools', '工具调用')} ${counts.tools}`);
      if ((counts.contexts ?? 0) > 0) headerParts.push(`${label('step.countContexts', '上下文')} ${counts.contexts}`);
      headerParts.push(`${label('step.timing', '计时')} ${fmtMs(data.timeMs)}`);
      headerParts.push(`${label('step.tokens', 'Token')} in ${fmtK(usage.input)} · out ${fmtK(usage.output)}`
        + ((usage.cacheRead ?? 0) > 0 ? ` · cache ${fmtK(usage.cacheRead)}` : '')
        + ((usage.reasoning ?? 0) > 0 ? ` · think ${fmtK(usage.reasoning)}` : ''));

      const toggleRaw = (rawKey) => setRawOpen((prev) => {
        const next = new Set(prev);
        if (next.has(rawKey)) next.delete(rawKey); else next.add(rawKey);
        return next;
      });

      /** One activity row: role tag + title + meta + optional 原文 link. */
      const renderRow = (rowKey, actor, title, meta, errorText, seqs, body) => {
        const rawKey = seqs.filter((value) => value != null).join(',');
        const open = rawOpen.has(rawKey);
        return h('div', { key: rowKey },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 } },
            h(RoleTag, { actor, label }),
            h('span', { style: { fontSize: 12, fontFamily: T.mono, color: errorText != null ? T.error : T.text, flex: '0 0 auto' } }, title),
            meta != null ? h('span', { style: { fontSize: 11, fontFamily: T.mono, color: T.muted, flex: '0 0 auto' } }, meta) : null,
            errorText != null ? h('span', { style: { fontSize: 11, color: T.error, flex: '0 0 auto' } }, errorText) : null,
            h('span', { style: { flex: '1 1 auto' } }),
            rawKey !== ''
              ? h('button', {
                type: 'button',
                onClick: () => toggleRaw(rawKey),
                style: { font: 'inherit', fontSize: 11, color: T.muted, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 },
              }, label('step.original', '原文'))
              : null,
          ),
          body,
          open ? h(EventDetail, { sessionId, seqs }) : null,
        );
      };

      const children = [
        h('div', { key: 'head', style: { display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, fontFamily: T.mono, color: T.muted } },
          headerParts.map((part) => h('span', { key: part }, part))),
      ];

      const pushRow = (rowKey, node) => children.push(h('div', {
        key: rowKey,
        style: { marginTop: 8 },
      }, node));

      // The run's instruction belongs to this step's details (SPEC F131).
      let hasInstruction = false;
      if (stepIdx === 0 && runActor === 'user' && runPrompt) {
        hasInstruction = true;
        children.push(h('div', { key: 'instruction', style: { marginTop: 8 } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
            h(RoleTag, { actor: 'user', label }),
            h('span', { style: { fontSize: 11, color: T.muted } }, label('step.instruction', '指令'))),
          h('div', { title: runPrompt, style: { marginTop: 2, fontSize: 12, lineHeight: 1.5, color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 96, overflow: 'auto' } }, truncate(runPrompt, 400)),
        ));
      }

      for (const op of data.operations ?? []) {
        if (op.kind === 'assistant') {
          const value = op.usage ?? {};
          pushRow('op-' + op.seq, renderRow(
            'op-' + op.seq,
            'assistant',
            label('step.modelCall', '模型调用'),
            `in ${fmtK(value.input)} · out ${fmtK(value.output)}`,
            null,
            [op.seq],
            op.text
              ? h('div', { title: op.text, style: { marginTop: 2, fontSize: 12, lineHeight: 1.5, color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 132, overflow: 'auto' } }, op.text)
              : null,
          ));
          continue;
        }
        if (op.kind === 'tool') {
          const failed = op.error != null || op.isError;
          const isSlow = typeof op.durationMs === 'number' && op.durationMs > slowMs;
          const errorText = failed ? (op.error ?? 'error') : (isSlow ? label('step.slow', '慢') : null);
          pushRow('op-' + op.seq, renderRow(
            'op-' + op.seq,
            'tool',
            `tool · ${op.name}`,
            op.durationMs != null ? fmtMs(op.durationMs) : '—',
            errorText,
            [op.callSeq, op.resultSeq],
            h('div', null,
              op.args
                ? h('div', { style: { marginTop: 2, fontSize: 12, minWidth: 0 } },
                  h('span', { style: { fontSize: 11, color: T.muted, marginRight: 6 } }, label('step.args', '参数')),
                  h('span', { title: op.args, style: { fontFamily: T.mono, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, op.args))
                : null,
              op.result
                ? h('div', { style: { marginTop: 2, fontSize: 12, minWidth: 0, color: failed ? T.error : T.text } },
                  h('span', { style: { fontSize: 11, color: T.muted, marginRight: 6 } }, label('step.result', '结果')),
                  h('span', { title: op.result, style: { fontFamily: T.mono, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 96, overflow: 'auto', display: 'block' } }, op.result))
                : null,
            ),
          ));
          continue;
        }
        if (op.kind === 'note') {
          // Explanation rows use the SAME tag component and language as every
          // other row (F136): English chip, Chinese wording in the tooltip.
          const tone = op.noteKind === 'fail' ? T.error : op.noteKind === 'retry' ? T.warn : T.muted;
          const palette = op.noteKind === 'fail'
            ? STEP_TAG_ERROR
            : (op.noteKind === 'retry' || op.noteKind === 'compact' ? ROLE.tool : ROLE.system);
          const zh = label('note.' + (op.noteKind ?? 'note'), NOTE_TAG[op.noteKind] ?? '事件');
          pushRow('op-' + op.seq, h('div', {
            key: 'note-' + op.seq,
            style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
          },
            h(RowTag, { text: NOTE_TAG_EN[op.noteKind] ?? 'EVENT', color: palette.color, background: palette.background, title: zh }),
            h('span', { title: op.text, style: { fontSize: 12, fontFamily: T.mono, color: tone, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, op.text),
          ));
          continue;
        }
        if (op.kind === 'context' || op.kind === 'system') {
          pushRow('op-' + op.seq, renderRow(
            'op-' + op.seq,
            op.kind,
            op.kind === 'context' ? label('step.injected', '注入') : label('step.systemPrompt', '系统提示词'),
            null,
            null,
            [op.seq],
            h('div', { title: op.text, style: { marginTop: 2, fontSize: 12, lineHeight: 1.5, color: op.kind === 'system' ? T.text : T.muted, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 96, overflow: 'auto' } }, op.text),
          ));
        }
      }

      if (children.length === 1 && !hasInstruction) {
        children.push(h('div', { key: 'empty', style: { marginTop: 6, fontSize: 12, color: T.muted } }, label('step.empty', '该 step 无内容')));
      }

      return h('div', { style: cardStyle }, children);
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
      const renderStart = performance.now();
      const [fullRuns, setFullRuns] = useState(() => new Set());
      const [payload, setPayload] = useState(null);
      const [error, setError] = useState(null);
      const [loading, setLoading] = useState(false);
      const [loadInfo, setLoadInfo] = useState(null);
      const [sort, setSort] = useState(null);
      const [expanded, setExpanded] = useState(() => new Set());
      const [details, setDetails] = useState(() => new Map());
      const [detailLoading, setDetailLoading] = useState(() => new Set());
      const [detailErrors, setDetailErrors] = useState(() => new Map());
      // F140 realtime: `seq` is the log offset the current payload was built at,
      // `live` mirrors the tick health, `lastAt` feeds the header badge.
      const seqRef = useRef(null);
      const tickBusy = useRef(false);
      const expandedRef = useRef(expanded);
      expandedRef.current = expanded;
      const [realtime, setRealtime] = useState({ live: true, paused: false, lastAt: null });
      // step key -> counter; bumping it makes an open StepContent refetch.
      const [stepTokens, setStepTokens] = useState(() => ({}));

      const load = useCallback((force) => {
        if (!sessionId) { setPayload(null); setError(null); setLoading(false); setLoadInfo(null); return undefined; }
        if (!force && cache.runs.has(sessionId)) {
          const hit = cache.runs.get(sessionId);
          seqRef.current = hit.payload?.meta?.seq ?? null;
          setPayload(hit.payload); setLoadInfo({ ...hit.info, cached: true }); setError(null); setLoading(false);
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
          setPayload(json); setLoadInfo(info); setLoading(false);
        }).catch((err) => {
          if (cancelled) return;
          if (err && err.name === 'AbortError') { setLoading(false); return; }
          setError(String((err && err.message) || err)); setLoading(false);
        });
        return () => { cancelled = true; controller?.abort(); };
      }, [sessionId]);

      useEffect(() => load(false), [load]);

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
            setRealtime((prev) => (prev.live && !prev.paused ? prev : { live: true, paused: false, lastAt: Date.now() }));
            return;
          }
          seqRef.current = json?.meta?.seq ?? null;
          cacheSet(cache.runs, sessionId, {
            payload: json,
            info: { ms: 0, bytes: 0, serverMs: json?.meta?.serverMs ?? null, cached: true },
          }, CACHE_MAX.runs);
          setPayload(json);
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
          setRealtime({ live: true, paused: false, lastAt: Date.now() });
        } catch {
          // A failed tick is not an error state: keep the last good table and
          // just mark the badge as not-live.
          setRealtime((prev) => ({ ...prev, live: false }));
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
              setRealtime((prev) => ({ ...prev, paused: true }));
              schedule(EVERY);
              return;
            }
            tick().finally(() => schedule(EVERY));
          }, delay);
        };
        const onVisibility = () => {
          if (typeof document === 'undefined') return;
          if (document.visibilityState === 'visible') {
            setRealtime((prev) => ({ ...prev, paused: false }));
            schedule(400); // come back: catch up right away, then resume the rhythm
          } else {
            setRealtime((prev) => ({ ...prev, paused: true }));
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

      const refresh = () => { if (sessionId) clearSessionCache(sessionId); load(true); };

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
            const timeFill = (step.startTime != null && step.endTime != null)
              ? h(TimeBar, { start: step.startTime, end: step.endTime, min, max, color: T.brand, tip: `${timeText} · ${fmtClock(step.startTime)} → ${fmtClock(step.endTime)}` })
              : h('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: stepTimePct + '%', transition: 'width .25s ease', background: T.brand, borderRadius: 99 } });
            const tokenFill = h('div', null,
              // spent before this step
              h('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: cumPct + '%', transition: 'width .25s ease', background: T.token, opacity: 0.18 } }),
              // this step's own slice
              h('div', { style: { position: 'absolute', left: beforePct + '%', width: ownPct + '%', top: 0, bottom: 0, background: T.token, borderRadius: 2, transition: 'left .25s ease, width .25s ease' } }),
            );
            return h(StepRow, {
              key: stepIdx,
              step,
              selected,
              open: sopen,
              onSelect: () => selectStep(run.idx, stepIdx),
              idxWidth: stepIdxWidth,
              timeMetric: h(MetricBar, {
                width: TIME_W, numWidth: TIME_NUM_W, tone: T.brand, fill: timeFill, valueText: timeText,
                // Split tooltip: execution = model + tools, waiting shown separately (F133).
                tip: [timeText]
                  .concat(step.modelMs != null ? ['模型 ' + fmtMs(step.modelMs)] : [])
                  .concat(step.toolMs > 0 ? ['工具 ' + fmtMs(step.toolMs)] : [])
                  .concat(fmtWait(step.waitMs) != null ? ['等待 ' + fmtWait(step.waitMs)] : [])
                  .join(' · '),
              }),
              tokenMetric: h(MetricBar, {
                width: TOKEN_W, numWidth: TOKEN_NUM_W, tone: T.token, fill: tokenFill, valueText: tokenText,
                // F143: the track is the run's total, so the tip says where this
                // step sits inside it and how much of the run is spent already.
                tip: `${tokenText} tok · ${sharePct}% of run · 累计 ${fmtK(cumTokens[stepIdx])} (${Math.round(cumPct)}%)`,
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

      const caption = () => {
        if (!loadInfo) return null;
        const parts = [];
        if (loadInfo.cached) parts.push(label('cacheHit', '缓存命中'));
        else parts.push(`${label('firstPaint', '首屏')} ${loadInfo.ms} ms`);
        if (!loadInfo.cached) parts.push(fmtBytes(loadInfo.bytes));
        if (loadInfo.serverMs != null) parts.push(`${label('server', '服务端')} ${loadInfo.serverMs} ms`);
        // F138: our own build cost, so "is Hades Lab the slow thing?" is a number
        // on screen instead of a guess. Only shown when it is big enough to feel.
        if (perf.lastBuildMs != null && perf.lastBuildMs >= 8) parts.push(`${label('render', '渲染')} ${Math.round(perf.lastBuildMs)} ms`);
        return parts.join(' · ');
      };

      const renderContent = () => {
        if (error != null) return h('div', { style: { color: T.error } }, String(error));
        if (loading && !payload) return h('div', { style: { color: T.muted } }, label('loading', '加载中…'));
        if (!payload) return null;
        if ((payload.counts?.events ?? 0) === 0) return h('div', { style: { color: T.muted } }, label('empty', '该会话暂无事件'));
        return h('div', null,
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 14 } },
            h(StatCard, { num: String(kpi.runs), lbl: label('stat.runs', 'run（指令）') }),
            h(StatCard, { num: String(kpi.steps), lbl: label('stat.steps', 'step（迭代）') }),
            h(StatCard, { num: String(kpi.events), lbl: label('stat.events', '事件') }),
            h(StatCard, { num: fmtK(kpi.tokenTotal), lbl: label('stat.tokens', 'Token') }),
            h(StatCard, { num: String(kpi.errors), lbl: label('stat.errors', '错误'), tone: T.error }),
            h(StatCard, { num: String(kpi.slow), lbl: label('stat.slow', '慢操作'), tone: T.warn }),
            h(StatCard, { num: String(kpi.abnormal), lbl: label('stat.abnormal', '异常 run'), tone: T.warn }),
            h(StatCard, { num: kpi.slowest ? fmtMs(kpi.slowest.durationMs) : '—', lbl: label('stat.slowest', '最慢操作'), sub: kpi.slowest?.name, tone: T.warn }),
          ),
          h(DualBarChart, {
            rows: payload.runs ?? [],
            sort,
            onSort: setSort,
            sysLabel: label('system', '系统提示词'),
            expanded,
            onToggleRun: openRun,
            renderDetail,
            hasDetail: (idx) => details.has(idx),
            label,
          }),
        );
      };

      perf.lastBuildMs = performance.now() - renderStart;
      return h('div', { style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', boxSizing: 'border-box', fontSize: 13, lineHeight: 1.6, color: T.text, fontFamily: T.font } },
        h('style', { key: 'hades-row-anim' }, ROW_ANIM_CSS),
        h('div', { style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid ' + T.border, padding: '6px 12px', minHeight: 30 } },
          h('span', { style: { fontSize: 11, color: T.faint, fontVariantNumeric: 'tabular-nums', fontFamily: T.mono } }, caption() ?? ''),
          // F140: the panel says out loud whether it is following the log.
          h('span', {
            title: realtime.paused
              ? label('realtime.tipPaused', '页面不可见时暂停轮询；切回来会立刻补一次')
              : label('realtime.tip', '每 2 秒检查一次日志偏移；没有新事件时服务端只回 ~40 B'),
            style: { display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 'auto', fontSize: 11, fontFamily: T.mono, color: realtime.live && !realtime.paused ? T.muted : T.warn },
          },
            h('span', { style: { width: 6, height: 6, borderRadius: 3, background: realtime.paused ? T.faint : (realtime.live ? T.success : T.warn) } }),
            realtime.paused ? label('realtime.paused', '已暂停') : (realtime.live ? label('realtime.live', '实时') : label('realtime.stalled', '实时中断')),
          ),
          h('button', { type: 'button', onClick: refresh, style: { font: 'inherit', color: T.text, background: T.surface, border: '1px solid ' + T.border, borderRadius: T.radiusSm, padding: '2px 10px', cursor: 'pointer' } }, label('refresh', '刷新')),
        ),
        h('div', { style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 12 } },
          renderContent(),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, {
          zh: {
            'view.title': 'Hades Lab',
            'loading': '加载中…', 'refresh': '刷新', 'empty': '该会话暂无事件',
            'run': 'run ', 'step': 'step ', 'followup': '续跑', 'system': '系统提示词',
            'stat.runs': 'run（指令）', 'stat.steps': 'step（迭代）', 'stat.events': '事件', 'stat.tokens': 'Token',
            'stat.errors': '错误', 'stat.slow': '慢操作', 'stat.abnormal': '异常 run', 'stat.slowest': '最慢操作',
            'firstPaint': '首屏', 'server': '服务端', 'cacheHit': '缓存命中', 'render': '渲染', 'loadingDetail': '载入 step…',
            'realtime.live': '实时', 'realtime.paused': '已暂停', 'realtime.stalled': '实时中断',
            'realtime.tip': '每 2 秒检查一次日志偏移；没有新事件时服务端只回 ~40 B',
            'realtime.tipPaused': '页面不可见时暂停轮询；切回来会立刻补一次',
            'step.model': '模型', 'step.timing': '计时', 'step.tokens': 'Token', 'step.summary': '概述',
            'step.args': '参数', 'step.result': '结果', 'step.original': '原文', 'step.loading': '载入 step 内容…',
            'step.retry': '重试', 'step.empty': '该 step 无内容', 'step.instruction': '指令',
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
            'loading': 'Loading…', 'refresh': 'Refresh', 'empty': 'No events in this session',
            'run': 'run ', 'step': 'step ', 'followup': 'follow-up', 'system': 'system prompt',
            'stat.runs': 'runs', 'stat.steps': 'steps', 'stat.events': 'events', 'stat.tokens': 'Tokens',
            'stat.errors': 'errors', 'stat.slow': 'slow', 'stat.abnormal': 'abnormal runs', 'stat.slowest': 'slowest',
            'firstPaint': 'first paint', 'server': 'server', 'cacheHit': 'cache hit', 'render': 'render', 'loadingDetail': 'loading steps…',
            'realtime.live': 'live', 'realtime.paused': 'paused', 'realtime.stalled': 'not live',
            'realtime.tip': 'Checks the log offset every 2 s; an unchanged session answers in ~40 B',
            'realtime.tipPaused': 'Polling pauses while the page is hidden and catches up at once',
            'step.model': 'model', 'step.timing': 'elapsed', 'step.tokens': 'tokens', 'step.summary': 'summary',
            'step.args': 'args', 'step.result': 'result', 'step.original': 'raw', 'step.loading': 'loading step…',
            'step.retry': 'Retry', 'step.empty': 'Empty step', 'step.instruction': 'instruction',
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
