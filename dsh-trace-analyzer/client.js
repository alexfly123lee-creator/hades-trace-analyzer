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
      // F168: scrub-focus fill (overwritten by applyThemePalette from the tokens).
      focusRow: 'color-mix(in srgb, var(--dsw-alias-trajectory-accent) 16%, transparent)',
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
    // ---------------------------------------------------------------------
    // F168 design tokens. Everything tunable lives here: one edit changes the
    // whole panel's rhythm instead of hunting inline numbers.
    //   space  — 4px grid only (no more 3/5/6/7/10 one-offs)
    //   motion — milliseconds; `glide` is the *cap*, distance no longer stretches it
    //   ease   — two curves: settle (out) and dismiss (in)
    //   alpha  — [light, dark] pairs for every tinted state
    // ---------------------------------------------------------------------
    const DESIGN = {
      space: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16 },
      motion: { fast: 120, base: 160, slow: 240, glide: 260, focus: 300, dimHold: 700 },
      ease: { out: 'cubic-bezier(.2,.7,.3,1)', in: 'cubic-bezier(.4,0,1,1)' },
      alpha: {
        hover: [9, 22],
        selected: [12, 30],
        focus: [16, 34],
        stepHover: [10, 26],
        stepSel: [22, 36],
        sortHover: [14, 26],
        sortLine: [80, 90],
        // F204: at 250 runs a column is ~6–12px wide, so a 18/26% wash over the
        // already-tinted cells was invisible: the band read as two hairlines rather
        // than "this column". The fill is the signal; the edges only frame it.
        bandSel: 42,
        bandHover: 26,
        scrubDim: 0.22,
        marker: 0.85,
      },
      // Row rhythm: 28px rows on a 4px baseline grid.
      row: { height: 28, pad: 4 },
    };
    const alphaOf = (pair, dark) => (Array.isArray(pair) ? pair[dark ? 1 : 0] : pair);

    const TINT_BASE = {
      run: 'var(--dsw-alias-bg-layer-1)',
      step: 'transparent',
    };
    const LIGHT_TINT = {
      runHover: DESIGN.alpha.hover[0], runSel: DESIGN.alpha.selected[0],
      stepHover: DESIGN.alpha.stepHover[0], stepSel: DESIGN.alpha.stepSel[0],
      sortHover: DESIGN.alpha.sortHover[0], sortLine: DESIGN.alpha.sortLine[0],
    };
    const DARK_TINT = {
      runHover: DESIGN.alpha.hover[1], runSel: DESIGN.alpha.selected[1],
      stepHover: DESIGN.alpha.stepHover[1], stepSel: DESIGN.alpha.stepSel[1],
      sortHover: DESIGN.alpha.sortHover[1], sortLine: DESIGN.alpha.sortLine[1],
    };
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
      // F168: scrub-focus fill comes from the token table too, so the focus tint
      // scales with the theme like every other state.
      T.focusRow = tintOf(alphaOf(DESIGN.alpha.focus, dark), TINT_BASE.run);
      return true;
    }

    // Indent for the Step level: Step rows and their bracket sit one level in
    // from the Run group, so nesting reads by position, not only by color.
    const STEP_INDENT = 12;
    // F138: a run may hold 200+ steps; render them in pages so a single expand
    // cannot mount thousands of nodes at once.
    const STEP_PAGE = 80;
    // F168: CSS variables carrying the token values, so the injected stylesheets
    // (ROW_ANIM_CSS / MATRIX_CSS) stay free of magic numbers.
    const CSS_VARS = {
      '--hades-ms-fast': DESIGN.motion.fast + 'ms',
      '--hades-ms-base': DESIGN.motion.base + 'ms',
      '--hades-ms-slow': DESIGN.motion.slow + 'ms',
      '--hades-ease-out': DESIGN.ease.out,
      '--hades-ease-in': DESIGN.ease.in,
      '--hades-dim': String(DESIGN.alpha.scrubDim),
      '--hades-row-h': DESIGN.row.height + 'px',
    };

    // F141: live-appended rows fade in instead of popping in.
    const ROW_ANIM_CSS = '@keyframes hadesRowIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}'
      // F158: run-row hover lives in CSS, not React state. Colours come from
      // variables set on the panel root (they are theme-dependent, see
      // applyThemePalette) — sweeping the pointer across 175 rows no longer
      // re-renders the list.
      + '.hades-run-row{transition:background var(--hades-ms-fast) var(--hades-ease-out)}'
      + '.hades-run-row:hover{background:var(--hades-hover-row)}'
      + '.hades-run-row.is-open,.hades-run-row.is-open:hover{background:var(--hades-sel-row)}'
      + '.hades-run-row .hades-idx{color:var(--hades-muted)}'
      + '.hades-run-row:hover .hades-idx,.hades-run-row.is-open .hades-idx{color:var(--hades-text)}'
      + '.hades-run-row:hover .hades-caret,.hades-run-row.is-open .hades-caret{color:var(--hades-brand)}'
      // F166: wheel-scrub. The whole list fades and the focused Run steps forward.
      + '.hades-run-group{transition:opacity var(--hades-ms-base) var(--hades-ease-out)}'
      + '.hades-scrubbing .hades-run-group{opacity:var(--hades-dim)}'
      + '.hades-scrubbing .hades-run-group.is-focus{opacity:1}'
      // F168 state precedence: focus wins over hover, open wins over focus — the
      // later rule in this list is the louder one.
      + '.hades-run-group.is-focus .hades-run-row{background:var(--hades-focus-row)}'
      + '.hades-scrubbing .hades-run-group.is-focus .hades-run-row .hades-idx{color:var(--hades-brand)}'
      + '.hades-scrubbing .hades-run-group.is-open .hades-run-row{background:var(--hades-sel-row)}'
      // F168: long prompts fade out instead of being chopped by an ellipsis.
      + '.hades-prompt{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent)}'
      // F168: first-paint skeleton rows.
      + '@keyframes hadesSkeleton{0%{opacity:.55}50%{opacity:1}100%{opacity:.55}}'
      + '.hades-skeleton{animation:hadesSkeleton 1.2s ease-in-out infinite}';

    // F165: matrix control styling. A native range input reads as a prototype —
    // we draw the track (filled up to the value via --fill), the thumb, the hover
    // and focus states ourselves. Only colours vary by theme; geometry is fixed.
    const MATRIX_CSS = `
      .hades-range{-webkit-appearance:none;appearance:none;background:transparent;height:18px;margin:0 6px 0 0;padding:0;cursor:pointer}
      .hades-range:focus{outline:none}
      .hades-range::-webkit-slider-runnable-track{
        height:3px;border-radius:999px;
        background:linear-gradient(90deg,var(--hades-brand) 0,var(--hades-brand) var(--fill,100%),var(--hades-track) var(--fill,100%),var(--hades-track) 100%);
      }
      .hades-range::-webkit-slider-thumb{
        -webkit-appearance:none;appearance:none;width:12px;height:12px;margin-top:-4.5px;
        border-radius:999px;background:var(--hades-surface);
        border:1.5px solid var(--hades-brand);
        box-shadow:0 1px 2px color-mix(in srgb,var(--hades-text) 22%,transparent);
        transition:transform 120ms ease,box-shadow 120ms ease;
      }
      .hades-range:hover::-webkit-slider-thumb{transform:scale(1.15)}
      .hades-range:active::-webkit-slider-thumb{transform:scale(1.05)}
      .hades-range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px color-mix(in srgb,var(--hades-brand) 22%,transparent)}
      .hades-range::-moz-range-track{height:3px;border-radius:999px;background:var(--hades-track)}
      .hades-range::-moz-range-progress{height:3px;border-radius:999px;background:var(--hades-brand)}
      .hades-range::-moz-range-thumb{width:12px;height:12px;border-radius:999px;background:var(--hades-surface);border:1.5px solid var(--hades-brand);box-shadow:0 1px 2px color-mix(in srgb,var(--hades-text) 22%,transparent)}
      .hades-mx-reset{font:inherit;color:var(--hades-muted);background:transparent;border:1px solid var(--hades-border);border-radius:999px;padding:1px 8px;cursor:pointer;transition:color 120ms ease,border-color 120ms ease}
      .hades-mx-reset:hover{color:var(--hades-text);border-color:var(--hades-brand)}
      .hades-mx-reset:focus-visible{outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--hades-brand) 22%,transparent)}
      /* F168: the matrix is a control surface — it can take focus and be driven
         by the arrow keys. */
      .hades-matrix:focus{outline:none}
      .hades-matrix:focus-visible{outline:2px solid color-mix(in srgb,var(--hades-brand) 38%,transparent);outline-offset:2px;border-radius:10px}
      .hades-tick{font-variant-numeric:tabular-nums;color:var(--hades-brand)}
    `;

    // F144 expand motion (plan C, tightened): height + fade, one uniform curve,
    // no stagger. Opening is short enough to feel immediate (160ms); closing is
    // shorter still (120ms) so the list snaps back instead of lingering.
    const EXPAND_MS = DESIGN.motion.base;
    const COLLAPSE_MS = DESIGN.motion.fast;
    // Content that arrives *after* the open (the /step and /run fetches) must not
    // pop the panel taller — it follows at this short duration instead.
    const FOLLOW_MS = DESIGN.motion.fast;
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
      // F163: flip `visible` during render instead of in an effect. The old
      // `useEffect` round-trip changed a layout-effect dependency, so the open
      // animation started twice in a row — that is the "expands, jumps, expands
      // again" the user was seeing.
      if (open && !visible) setVisible(true);
      // Closing must animate the content that is going away, so keep the last
      // open children around for the collapse.
      const lastChildren = useRef(children);
      if (open) lastChildren.current = children;
      // Height we last rendered at, used to follow async content smoothly.
      const heightRef = useRef(null);
      // The height animation currently in flight. A second WAAPI animation on the
      // same property does not replace the first one — it composites with it —
      // which is the other half of the "repeated/stuttering" look.
      const animRef = useRef(null);
      const cancelAnim = () => {
        if (animRef.current != null) { animRef.current.cancel(); animRef.current = null; }
      };
      useLayoutEffect(() => {
        const el = ref.current;
        if (el == null) return undefined;
        cancelAnim();
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
          // Measured once, from the real content — the panel opens already filled,
          // so there is no second "grow into the loaded content" pass.
          const height = el.scrollHeight;
          el.style.height = 'auto';
          el.style.opacity = '1';
          // F188: when this effect re-runs on a panel that is ALREADY open (content
          // arrived, expandMs changed), grow from the current height instead of
          // collapsing to 0 first — that collapse-then-grow is the visible "jump"
          // when steps are opened out of order.
          const from = heightRef.current != null ? Math.max(0, Math.min(heightRef.current, height)) : 0;
          const frames = from > 0
            ? [{ height: from + 'px' }, { height: height + 'px' }]
            : [{ height: '0px', opacity: 0 }, { height: height + 'px', opacity: 1 }];
          const anim = el.animate(
            frames,
            { duration: expandMs, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'none' },
          );
          animRef.current = anim;
          anim.onfinish = () => { el.style.height = 'auto'; el.style.opacity = '1'; if (animRef.current === anim) animRef.current = null; };
          heightRef.current = height;
          return () => { anim.cancel(); if (animRef.current === anim) animRef.current = null; };
        }
        if (!visible) return undefined;
        const height = el.scrollHeight;
        heightRef.current = null;
        const anim = el.animate(
          [{ height: height + 'px', opacity: 1 }, { height: '0px', opacity: 0 }],
          { duration: collapseMs, easing: 'cubic-bezier(.4,0,1,1)', fill: 'none' },
        );
        animRef.current = anim;
        anim.onfinish = () => { if (animRef.current === anim) animRef.current = null; setVisible(false); };
        return () => { anim.cancel(); if (animRef.current === anim) animRef.current = null; };
      }, [open, expandMs, collapseMs]);
      // F144/F163: the step/run detail arrives asynchronously. When it lands while
      // the panel is open, grow/shrink into the new height instead of jumping —
      // but never on top of the open animation.
      useLayoutEffect(() => {
        const el = ref.current;
        if (el == null || !open || !visible || animRef.current != null) return undefined;
        const height = el.scrollHeight;
        const prev = heightRef.current;
        heightRef.current = height;
        // F188: a descendant Collapse (the Step panel) animating its own height is
        // the reason this box used to jump when steps were opened out of order: the
        // outer panel then animated from a stale `prev` to a target the inner
        // animation was still moving. Let the inner animation own the geometry —
        // only the async-data case below animates the outer box.
        const innerRunning = typeof el.getAnimations === 'function'
          && el.getAnimations({ subtree: true }).some((a) => {
            if (a === animRef.current || a.playState !== 'running') return false;
            const frames = a.effect && typeof a.effect.getKeyframes === 'function' ? a.effect.getKeyframes() : [];
            return frames.some((frame) => frame.height != null);
          });
        if (innerRunning) return undefined;
        if (prev == null || motionReduced() || expandMs <= 0 || Math.abs(height - prev) < 8) return undefined;
        const anim = el.animate([{ height: prev + 'px' }, { height: height + 'px' }], { duration: FOLLOW_MS, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'none' });
        animRef.current = anim;
        anim.onfinish = () => { el.style.height = 'auto'; if (animRef.current === anim) animRef.current = null; };
        return () => { anim.cancel(); if (animRef.current === anim) animRef.current = null; };
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

    /**
     * F202: the ONE pointer → Run resolver for the heat matrix.
     *
     * Geometry, not hit-testing. With ~175 columns the plot is mostly 1px column
     * gaps and 4px row gaps, and `closest('[data-idx]')` returns null on every one
     * of them: that froze the readout on the previous column (a fast diagonal sweep
     * stopped following) and, after re-entering through a gap, left the matrix with
     * no hover at all. Resolving by x-position makes gaps land on the column they
     * sit between, which is what the eye already assumes.
     *
     * `y` must be inside the plot band (tiny pad allowed) so the legend and the
     * window slider above/below it stay dead zones; `x` must be inside the grid.
     * Returns the Run idx, or null when the point is not on the plot.
     */
    const columnFromPoint = (point, plotRect, gridRect, list) => {
      if (plotRect == null || gridRect == null || !Array.isArray(list) || list.length === 0) return null;
      if (!(gridRect.width > 0)) return null;
      const pad = 4;
      if (point.y < plotRect.top - pad || point.y > plotRect.bottom + pad) return null;
      if (point.x < gridRect.left - pad || point.x > gridRect.right + pad) return null;
      const ratio = (point.x - gridRect.left) / gridRect.width;
      const pos = Math.max(0, Math.min(list.length - 1, Math.floor(ratio * list.length)));
      return list[pos] == null ? null : list[pos].idx;
    };

    /**
     * F202: keep the list's focus highlight in step with the matrix after every
     * commit, instead of writing the class once and hoping it survives.
     *
     * `is-focus` is the only visual that says "this row is the hovered column".
     * It used to be set imperatively; any later React write to that row's
     * className (opening or closing the Run) dropped it, leaving the list dimmed
     * with no focused row — the half of "hover disappeared" that outlived the
     * pointer. Re-asserting is two lookups, and it never rebuilds a row (a
     * declarative version did, and re-ran the open animation on the expanded row).
     */
    const syncFocusRow = (host, idx) => {
      if (host == null || typeof host.querySelector !== 'function') return;
      const previous = host.querySelector('.hades-run-group.is-focus');
      if (previous != null) previous.classList.remove('is-focus');
      if (idx == null) return;
      const el = host.querySelector('[data-run="' + idx + '"]');
      if (el != null) el.classList.add('is-focus');
    };

    // Short tag for the explanation-only rows a step panel gained in F23.2
    // (compaction / retry / file changes / slash commands / approvals …).
    const NOTE_TAG = { compact: 'compact', retry: 'retry', fail: 'fail', workspace: 'files', command: 'command', plan: 'plan', todo: 'todo', deliver: 'deliver', approval: 'approval', note: 'events' };
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
        key: 'role.user', fallback: 'user',
        color: 'var(--dsw-alias-state-business-primary)',
        background: 'var(--dsw-alias-state-business-tertiary)',
      },
      assistant: {
        key: 'role.assistant', fallback: 'assistant',
        color: 'color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color) 60%, var(--dsw-alias-state-error-secondary))',
        background: 'color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color) 55%, var(--dsw-alias-state-error-secondary)) 15%, var(--dsw-alias-bg-layer-1))',
      },
      context: {
        key: 'role.context', fallback: 'context',
        color: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 68%, var(--dsw-alias-label-secondary))',
        background: 'var(--dsw-alias-state-success-tertiary)',
      },
      system: {
        key: 'role.system', fallback: 'system',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-module-platform)',
      },
      tool: {
        key: 'role.tool', fallback: 'tools',
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
      // F168: one chip geometry for the whole panel — the matrix legend swatch
      // matches this height/radius, so tags and legend read as one system.
      return h('span', {
        title: title ?? text,
        style: {
          display: 'inline-flex', alignItems: 'center', flex: '0 0 auto',
          height: 18, padding: '0 6px', boxSizing: 'border-box',
          border: '1px solid transparent', borderRadius: DESIGN.space.xs,
          color, background,
          // F198: labels are uppercase everywhere, including tool names.
          fontSize: 11, lineHeight: '16px', fontWeight: 650, letterSpacing: '0.035em',
          textTransform: 'uppercase',
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
    //   OverviewBoard  one pinned block: the run heat matrix (F153) stays at the
    // ---------------------------------------------------------------------
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
     * the numbers pinned too, not just the picture).
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
    function OverviewBoard({ rows, label, onLocate, onScrub, onFocusOnly, followLatest, baseRun }) {
      // F164: hover/selection are stored as Run idx (not column position), so they
      // survive a change of the visible window.
      const [hover, setHover] = useState(null);
      // F155: the clicked column stays highlighted, so "which Run did I pick?" is
      // answerable after the pointer leaves the matrix.
      const [selected, setSelected] = useState(null);
      // F164: how many of the most recent runs the matrix shows. null = all.
      const [windowN, setWindowN] = useState(null);
      // F168: transient "Run 112 / 175" ticker while the wheel / arrow keys step
      // through runs; it clears itself after DESIGN.motion.dimHold.
      const [tick, setTick] = useState(false);
      const tickTimer = useRef(null);
      const flashTick = useCallback(() => {
        setTick(true);
        if (tickTimer.current != null) clearTimeout(tickTimer.current);
        tickTimer.current = setTimeout(() => {
          tickTimer.current = null;
          setTick(false);
        }, DESIGN.motion.dimHold);
      }, []);
      const wrapRef = useRef(null);
      const cardRef = useRef(null);
      // F156: the parent re-renders on every realtime tick, so a captured
      // `onLocate` would invalidate the memoised grid each time. Call through a
      // ref instead.
      const locateRef = useRef(onLocate);
      locateRef.current = onLocate;
      // F166: a stable handle for the wheel handler (attached once, natively).
      const scrubRef = useRef(onScrub);
      scrubRef.current = onScrub;
      // F183: hover moves the highlight without scrolling once a click has parked a
      // Run at the top; the lock ends when the pointer leaves the matrix.
      const focusOnlyRef = useRef(onFocusOnly);
      focusOnlyRef.current = onFocusOnly;
      const hoverLock = useRef(false);
      // F172: where the list is currently reading — the wheel steps from here when
      // the pointer is not over a column (otherwise one notch could teleport the
      // list to the stale selection's region).
      const baseRunRef = useRef(baseRun);
      baseRunRef.current = baseRun;

      const total = rows.length;
      // A "window" is the newest N runs — where a session's dense tail lives, and
      // the part worth reading at 1 column per run.
      const shown = useMemo(() => {
        if (windowN == null || windowN >= total) return rows;
        return rows.slice(Math.max(0, total - windowN));
      }, [rows, windowN, total]);
      const n = shown.length;
      // F168: rank against the WHOLE session, not the visible window. Dragging the
      // slider then only crops the picture — a Run never changes colour because
      // you zoomed, and the matrix stops recomputing 175×3 ranks per drag step.
      const ranks = useMemo(() => {
        const rank = (pick) => {
          const order = rows.map((r, i) => [pick(r) ?? 0, i]).sort((a, b) => a[0] - b[0]);
          const out = new Map();
          order.forEach(([, i], pos) => {
            out.set(rows[i].idx, order.length > 1 ? pos / (order.length - 1) : 1);
          });
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
        { key: 'time', text: label('col.time', 'Time'), tone: T.brand, rankOf: (r) => ranks.time.get(r.idx) ?? 0 },
        { key: 'token', text: label('col.token', 'Token'), tone: T.token, rankOf: (r) => ranks.token.get(r.idx) ?? 0 },
        { key: 'steps', text: label('mx.steps', 'Steps'), tone: T.success, rankOf: (r) => ranks.steps.get(r.idx) ?? 0 },
      ];
      // F168: errors and slow ops are MARKERS, not a fourth metric — a 3px lane
      // above the grid, so the matrix reads as three comparable rows plus flags.
      const markerBg = (run) => {
        if (run.hasError) return T.error;
        if (run.hasSlow) return T.warn;
        return 'transparent';
      };
      const rowTexts = rowsDef.map((row) => row.text).join(',');
      // F165: 4px columns can only carry a 1px radius; wide ones read as chips.
      const cellRadius = n > 48 ? 1 : 2;
      // F156: 700 cells are expensive to rebuild, and nothing about them changes
      // on hover/selection — only the overlay band does. Memoise them so a click
      // costs one band move instead of a full grid re-render.
      // F185/F202: one geometric resolver for hover AND clicks, so a pointer on a
      // 1px gap / 4px row margin / the 46px label gutter still lands on the column
      // it visually belongs to instead of being swallowed.
      const plotRef = useRef(null);
      const indexAt = (event, gridEl) => {
        const plot = plotRef.current;
        const plotRect = plot != null && typeof plot.getBoundingClientRect === 'function'
          ? plot.getBoundingClientRect() : null;
        const gridRect = gridEl != null && typeof gridEl.getBoundingClientRect === 'function'
          ? gridEl.getBoundingClientRect() : null;
        return columnFromPoint({ x: event.clientX, y: event.clientY }, plotRect, gridRect, shownRef.current);
      };
      const clickColumn = (event, container) => {
        const idx = indexAt(event, container);
        if (idx == null) return;
        // F183: the click parks this Run at the top; keep it there while the
        // pointer moves around the matrix.
        hoverLock.current = true;
        setSelected(idx);
        setTimeout(() => locateRef.current(idx), 0);
      };

      const grid = useMemo(() => [
        h('div', { key: 'lane', className: 'hades-lane', style: { display: 'flex', alignItems: 'center', gap: MX_GAP, height: 4, marginBottom: 4 } },
          h('span', { style: { flex: `0 0 ${MX_LABEL_W}px` } }),
          h('div', {
            'data-hades-lane-grid': '1',
            onClick: (event) => clickColumn(event, event.currentTarget),
            style: { flex: '1 1 auto', minWidth: 0, display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 1, cursor: 'pointer' },
          },
            shown.map((r) => h('div', {
              key: 'mk-' + r.idx,
              // F171: hover is resolved by the grid wrapper from `data-idx` — per
              // cell mouseenter events get dropped when the pointer sweeps fast
              // across 2400 tiny siblings. No `title` either: 700 native tooltips
              // fire while sweeping and the tooltip window steals mouseover, which
              // is the other half of "the hover band vanishes".
              'data-idx': r.idx,
              style: { height: 3, borderRadius: 1, cursor: 'pointer', background: markerBg(r) },
            })),
          ),
        ),
        ...rowsDef.map((row) => h('div', { key: row.key, style: { display: 'flex', alignItems: 'center', gap: MX_GAP, marginBottom: 4 } },
          h('span', {
            style: { flex: `0 0 ${MX_LABEL_W}px`, textAlign: 'right', font: `11px/1 ${T.mono}`, color: T.muted },
          }, row.text),
          h('div', {
            'data-hades-row-grid': '1',
            onClick: (event) => clickColumn(event, event.currentTarget),
            style: { flex: '1 1 auto', minWidth: 0, display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 1, cursor: 'pointer' },
          },
            shown.map((r) => h('div', {
              key: r.idx,
              'data-idx': r.idx,
              style: { height: 11, borderRadius: cellRadius, cursor: 'pointer', background: shade(row.tone, row.rankOf(r)) },
            })),
          ),
        )),
        // Callbacks are stable through refs, so they stay out of the deps.
      ], [shown, ranks, n, rowTexts, cellRadius]);
      // F167: wheel over the grid = scrub the list. One notch walks one Run and the
      // list below dims to a single focused row.
      //
      // Two fixes over the first cut:
      //  * the listener is attached by a CALLBACK REF, not a mount effect — an
      //    effect with [] deps silently did nothing when the matrix mounted on a
      //    later render (the ref was still null on its only run);
      //  * the effect used to sit AFTER the `n === 0` early return, which breaks
      //    the hook order as soon as the run table is empty once.
      const shownRef = useRef(shown);
      shownRef.current = shown;
      const selectedRef = useRef(selected);
      selectedRef.current = selected;
      const hoverRef = useRef(hover);
      hoverRef.current = hover;
      // F168: the matrix is a control surface — arrows step, Enter locates.
      const onMatrixKeyDown = (event) => {
        const list = shownRef.current;
        if (!list.length) return;
        const key = event.key;
        if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Enter') return;
        event.preventDefault();
        if (key === 'Enter') {
          // F175: Enter opens the focused Run (what a click does).
          const target = hoverRef.current != null ? hoverRef.current : selectedRef.current;
          if (target != null) locateRef.current(target);
          return;
        }
        const dir = key === 'ArrowRight' ? 1 : -1;
        // F175: same focus the pointer/wheel use; Enter opens the focused Run.
        const cur = list.findIndex((r) => r.idx === hoverRef.current);
        const at = baseRunRef.current ? list.findIndex((r) => r.idx === baseRunRef.current()) : -1;
        const from = cur >= 0 ? cur : at >= 0 ? at : 0;
        const next = Math.max(0, Math.min(list.length - 1, from + dir));
        const run = list[next];
        if (run == null) return;
        setHover(run.idx);
        flashTickRef.current();
        if (scrubRef.current) scrubRef.current(run.idx);
      };

      // F170: while the panel follows the live edge, the matrix cursor rides the
      // newest Run. It is a hook, so it must sit before the empty-table return.
      useEffect(() => {
        if (!followLatest) return;
        const last = shownRef.current[shownRef.current.length - 1];
        if (last == null) return;
        setSelected((prev) => (prev === last.idx ? prev : last.idx));
      }, [followLatest, rows, windowN]);

      // F202: the window slider changes which Runs the columns stand for, so a
      // hover/selection captured against the old columns points at nothing.
      useEffect(() => {
        hoverLock.current = false;
        setHover(null);
        if (scrubRef.current) scrubRef.current(null);
      }, [windowN]);

      if (n === 0) return null;
      const posOf = (idx) => (idx == null ? -1 : shown.findIndex((r) => r.idx === idx));
      const selectedPos = posOf(selected);
      const hoverPos = posOf(hover);
      // The column the readout describes: whatever the pointer is on, else the
      // stored selection.
      const activePos = hoverPos >= 0 ? hoverPos : selectedPos;
      const hovered = activePos >= 0 ? shown[activePos] : null;
      // F168: structured readout only — the prompt excerpt moved out of the header
      // (it is data, not chrome; the row tooltip still carries it).
      const summary = hovered
        ? `Run ${hovered.idx} · ${fmtMs(hovered.time)} · ${fmtK(hovered.token)} tok · ${hovered.stepCount} steps`
          + (hovered.hasError ? ' · error' : '') + (hovered.hasSlow ? ' · slow' : '')
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
        // F168: the band reaches up over the marker lane (top -8) so a selected
        // column is framed from its flag down to its last metric row.
        key,
        style: Object.assign({ position: 'absolute', top: -8, bottom: -2, pointerEvents: 'none' }, style),
      });
      // F160: the legend explains "darker = higher rank" per row, through the
      // tooltip — the unexplained gradient bar it used to have read like a stray
      // progress bar, so it is gone.
      const legendItem = (tone, text, title) => h('span', {
        key: 'lg-' + text,
        title: title ?? text,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 5, flex: '0 0 auto',
          color: T.muted, fontSize: 11, lineHeight: '16px', letterSpacing: '.01em',
        },
      }, h('i', {
        style: { width: 8, height: 8, borderRadius: 2, background: tone, display: 'inline-block', flex: '0 0 8px' },
      }), text);
      // F164/F165: the card header carries the readout on the left and the legend
      // on the right. The legend is grouped — metric rows first, then a hairline
      // divider, then the two flag swatches — so "what the colours mean" reads as
      // two sets instead of five loose chips.
      const legendRow = h('div', {
        key: 'legend',
        style: {
          display: 'flex', alignItems: 'center', gap: 10,
          font: `11px/1.2 ${T.mono}`, minHeight: 18, marginBottom: 8,
        },
      },
        h('span', {
          key: 'readout',
          title: hovered ? summary : '',
          style: {
            minWidth: 0, flex: '1 1 auto', textAlign: 'left',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            fontVariantNumeric: 'tabular-nums',
            color: hovered ? T.text : T.faint,
          },
        }, tick && selected != null
          ? h('span', { key: 'tick', className: 'hades-tick', 'data-hades-tick': '1' }, `Run ${selected} / ${total}`)
          : hovered
            ? [
              h('b', { key: 'rid', style: { fontWeight: 600, color: T.brand } }, `Run ${hovered.idx}`),
              ` · ${fmtMs(hovered.time)} · ${fmtK(hovered.token)} tok · ${hovered.stepCount} steps`
              + (hovered.hasError ? ' · error' : '') + (hovered.hasSlow ? ' · slow' : ''),
            ]
            : label('mx.hint', 'hover a run · click to locate')),
        // F157: an explicit selection chip, so "what is currently selected" is
        // answered in words as well as by the 26%/2px column band.
        selectedPos >= 0 && shown[selectedPos] ? h('span', {
          key: 'sel-chip',
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 0 auto',
            height: 18, padding: '0 4px 0 7px', borderRadius: 999,
            border: '1px solid ' + T.brand,
            background: `color-mix(in srgb, ${T.brand} 9%, transparent)`,
            color: T.brand, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
          },
        },
          `Run ${shown[selectedPos].idx}`,
          h('button', {
            type: 'button',
            title: label('mx.clearSel', 'clear selection'),
            onClick: () => setSelected(null),
            style: {
              border: 'none', background: 'transparent', color: T.brand, cursor: 'pointer',
              font: 'inherit', fontSize: 11, lineHeight: 1, padding: '0 2px', borderRadius: 999,
            },
          }, '✕'),
        ) : null,
        h('span', { key: 'legend-items', style: { display: 'inline-flex', alignItems: 'center', gap: 12, flex: '0 0 auto' } },
          legendItem(T.brand, label('col.time', 'Time'), label('mx.rampTime', 'darker = slower relative to the session')),
          legendItem(T.token, label('col.token', 'Token'), label('mx.rampToken', 'darker = more tokens in the session')),
          legendItem(T.success, label('mx.steps', 'Steps'), label('mx.rampSteps', 'darker = more steps in the session')),
          h('span', {
            key: 'lg-sep',
            style: { width: 1, height: 11, background: T.border, flex: '0 0 1px' },
          }),
          legendItem(T.error, label('mx.error', 'Error')),
          legendItem(T.warn, label('mx.slow', 'Slow')),
        ),
      );
      // F164/F165: window control. 1 column per run stops being readable past a few
      // dozen runs, so the matrix can focus on the newest N. Drawn as a product
      // control — own track/thumb (.hades-range), value on the left, reset pill on
      // the right — instead of a stock <input type=range>.
      const windowPct = total > 12 ? Math.round(((n - 12) / Math.max(1, total - 12)) * 100) : 100;
      const windowLabel = windowN == null || windowN >= total
        ? `${label('mx.showAll', 'all')} ${total} ${label('mx.runsUnit', 'runs')}`
        : `${label('mx.showRecent', 'latest')} ${n} / ${total} ${label('mx.runsUnit', 'runs')}`;
      const sliderRow = total > 12 ? h('div', {
        key: 'window',
        style: {
          display: 'flex', alignItems: 'center', gap: 10,
          marginTop: 8, paddingTop: 8, borderTop: '1px solid ' + T.border,
          font: `11px/1.2 ${T.mono}`, color: T.muted,
        },
      },
        h('span', {
          key: 'wlabel',
          style: { flex: '0 0 auto', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', letterSpacing: '.01em' },
        }, windowLabel),
        h('input', {
          key: 'wrange',
          type: 'range',
          className: 'hades-range',
          min: 12,
          max: total,
          step: 1,
          value: n,
          'data-hades-window': '1',
          'aria-label': label('mx.windowHint', 'Drag to choose how many of the latest runs the matrix shows'),
          title: label('mx.windowHint', 'Drag to choose how many of the latest runs the matrix shows'),
          onChange: (e) => {
            const value = Number(e.target.value);
            setWindowN(value >= total ? null : value);
          },
          style: { flex: '1 1 auto', maxWidth: 220, minWidth: 80, '--fill': windowPct + '%' },
        }),
        h('span', {
          key: 'wend',
          style: { flex: '0 0 auto', color: T.faint, fontVariantNumeric: 'tabular-nums' },
        }, windowN == null ? '' : `12–${total}`),
        windowN == null
          ? null
          : h('button', {
            key: 'wall',
            type: 'button',
            className: 'hades-mx-reset',
            onClick: () => setWindowN(null),
          }, label('mx.showAll', 'all')),
      ) : null;
      return h('div', {
        ref: wrapRef,
        // F153/F187: the wrapper paints the surface colour so no seam shows the
        // list behind it; the matrix is the only card above the list now.
        style: { marginBottom: 12, background: T.surface },
      },
        // F165: the custom range styling lives with the card, not the page shell.
        h('style', { key: 'mx-css' }, MATRIX_CSS),
        h('div', { ref: cardRef, 'data-hades-board': '1', style: { zIndex: 3 } },
          h('div', {
            className: 'hades-matrix',
            tabIndex: 0,
            role: 'group',
            'aria-label': 'run heat matrix',
            onKeyDown: onMatrixKeyDown,
            // F202: pointer tracking lives on the CARD, not on the ~52px plot
            // strip. The strip is thinner than a mouse wobbles: one 3px drift up
            // into the legend used to fire mouseleave and drop the hover plus the
            // whole list focus. Off-plot moves now keep the last column; only
            // leaving the card clears it.
            onMouseMove: (event) => {
              const gridEl = cardRef.current != null && typeof cardRef.current.querySelector === 'function'
                ? cardRef.current.querySelector('[data-hades-row-grid]')
                : null;
              const next = indexAt(event, gridEl);
              if (next == null || next === hoverRef.current) return;
              setHover(next);
              if (hoverLock.current) {
                if (focusOnlyRef.current) focusOnlyRef.current(next);
              } else if (scrubRef.current) scrubRef.current(next);
            },
            onMouseLeave: () => {
              hoverLock.current = false;
              setHover(null);
              if (scrubRef.current) scrubRef.current(null);
            },
            style: {
              border: '1px solid ' + T.border, borderRadius: T.radiusMd,
              padding: '10px 12px 10px', background: T.surface,
              // F177: no drop shadow. The matrix is a fixed instrument panel at the
              // top of the view, not a floating card — the shadow made it read as
              // something hovering over the list.
            },
          },
            legendRow,
            // F175/F202: the plot is one surface — the lane, three metric rows and
            // their 1px/4px gaps all resolve through `columnFromPoint`. Cells only
            // carry `data-idx`; nothing hangs per-cell listeners.
            h('div', {
              ref: plotRef,
              'data-hades-plot': '1',
              // F185: the whole plot area is clickable — hand cursor everywhere,
              // including the 1px gaps and the 4px row margins.
              style: { position: 'relative', overscrollBehavior: 'contain', cursor: 'pointer' },
            },
              grid,
              // F157/F168: two distinct states — selected (26% fill + 2px edges,
              // stays) and hover (18% + 1px, follows). Fill strengths come from
              // the DESIGN table so the two can never drift apart.
              // F204: the hover band is drawn on the column under the pointer even
              // when that column is the selected one. Suppressing it there meant
              // "click a column → the matrix stops highlighting" for as long as the
              // pointer stayed inside that column (at 244 runs a column is ~3px, so
              // "inside" is most of the time). All six layers are borderless
              // rectangles — a bordered box on a 3px column renders as a wedge.
              selectedPos >= 0 ? bandLayer('sel-fill', {
                left: bandAt(selectedPos).left, width: bandAt(selectedPos).width,
                background: `color-mix(in srgb, ${T.brand} ${DESIGN.alpha.bandSel}%, transparent)`,
              }) : null,
              selectedPos >= 0 ? bandLayer('sel-l', { left: bandAt(selectedPos).left, width: 2, background: T.brand }) : null,
              selectedPos >= 0 ? bandLayer('sel-r', {
                left: `calc(${bandAt(selectedPos).left} + (${bandAt(selectedPos).width}) - 2px)`, width: 2, background: T.brand,
              }) : null,
              hoverPos >= 0 ? bandLayer('hov-fill', {
                left: bandAt(hoverPos).left, width: bandAt(hoverPos).width,
                background: `color-mix(in srgb, ${T.brand} ${DESIGN.alpha.bandHover}%, transparent)`,
              }) : null,
              hoverPos >= 0 ? bandLayer('hov-l', { left: bandAt(hoverPos).left, width: 1, background: T.brand }) : null,
              hoverPos >= 0 ? bandLayer('hov-r', {
                left: `calc(${bandAt(hoverPos).left} + (${bandAt(hoverPos).width}) - 1px)`, width: 1, background: T.brand,
              }) : null,
            ),
            sliderRow,
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
    // F199: the tracks were long enough to dominate the row; a third shorter
    // (100 px) still fits the widest value at the mono 11 px size.
    const METRIC_W = 100;
    const METRIC_NUM_W = 70;
    // Kept as named aliases so call sites stay readable (and a future split
    // stays a one-line change).
    const RUN_IDX_W = 78;

    function DualBarChart({ rows, sort, onSort, sysLabel, expanded, onToggleRun, renderDetail, hasDetail, label, detailEpoch, instantRef, focusRun }) {
      const listRef = useRef(null);
      const prevTops = useRef(new Map());
      const first = useRef(true);
      const lastOrder = useRef(null);
      const seenRuns = useRef(new Set());
      // F202: the focus highlight is derived, not remembered. Re-asserting it after
      // every commit repairs the one case that used to lose it — React rewriting
      // that row's className when the Run opens or closes (`hades-run-group` →
      // `… is-open`), which silently dropped the hand-set `is-focus` and left the
      // list dimmed with no highlighted row.
      useLayoutEffect(() => {
        syncFocusRow(listRef.current, focusRun);
      });
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
            if (Math.abs(dy) > 1 && !motionReduced()) {
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
          title: dir === 'desc' ? `${text} desc · click for asc` : dir === 'asc' ? `${text} asc · click to clear` : `sort by ${text}`,
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
          label('sort.by', 'sorted by'),
          h('b', { style: { fontWeight: 400, color: tone } }, `${text} ${sort.dir === 'asc' ? '↑' : '↓'}`),
          label('sort.on', 'sort'),
          h('button', {
            type: 'button',
            title: label('sort.clear', 'clear sort'),
            onClick: () => onSort(null),
            style: { flex: '0 0 auto', border: 'none', background: 'transparent', color: T.faint, cursor: 'pointer', font: 'inherit', padding: 0, lineHeight: 1 },
          }, '✕'),
        );
      };

      // F162: cache the built row elements. A click used to rebuild all 175 rows
      // twice — once for `expanded`, once when the fetched detail landed. React
      // skips a subtree entirely when its element object is identical, so caching
      // the element makes a click rebuild exactly the one row that changed.
      const rowCache = useRef({ rows: null, sort: null, langKey: null, firstDone: null, map: new Map() });
      // An open row's content also depends on its detail payload and on which
      // Steps are open; those change without the run table changing, so they get
      // their own epoch that only open rows check. It is computed by the parent
      // (it owns details/stepTokens) and handed down as a stable object.
      const openEpoch = detailEpoch;
      // Language is carried by closures, not by data: derive a cheap signature so
      // a locale switch invalidates the cache without depending on `label`'s
      // identity (a new closure every render).
      const langKey = label('col.time', 'Time') + '|' + label('col.token', 'Token') + '|' + sysLabel;

      const buildRow = (r, open) => {
        const tPct = (r.time / maxTime * 100).toFixed(1);
        const kPct = (r.token / maxToken * 100).toFixed(1);
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
        // F141: a row that appears after the first paint is a live addition — fade
        // it in so "a new run arrived" reads as growth, not as a repaint.
        const isNewRow = !first.current && !seenRuns.current.has(r.idx);
        if (isNewRow) seenRuns.current.add(r.idx);
        // F144: animate the height only when the step index is already loaded.
        const detailReady = hasDetail ? hasDetail(r.idx) : false;
        const instant = !!(instantRef && instantRef.current && instantRef.current.has(r.idx));
        return h('div', {
          key: r.idx,
          'data-run': String(r.idx),
          // F166: the wheel-scrub focus lives on the group so its whole detail
          // block dims with it, not just the header line.
          className: 'hades-run-group',
          style: isNewRow ? { ...groupStyle, animation: 'hadesRowIn .22s ease-out' } : groupStyle,
        },
          h('div', {
            onClick: () => onToggleRun(r.idx),
            // F158: hover is CSS (:hover) — no React state, so moving the pointer
            // across the list no longer re-renders 175 rows.
            className: 'hades-run-row' + (runSelected ? ' is-open' : ''),
            style: {
              display: 'flex', alignItems: 'center', gap: DESIGN.space.md, cursor: 'pointer', minWidth: 0,
              minHeight: DESIGN.row.height, padding: `${DESIGN.row.pad}px 0`, boxSizing: 'border-box',
            },
          },
            h('span', {
              className: 'hades-idx',
              // F200: the title colour is neutral — status is carried by the dot
              // at the end of the row, not by tinting the ordinal.
              style: { flex: `0 0 ${RUN_IDX_W}px`, minWidth: 0, fontVariantNumeric: 'tabular-nums', userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 2 },
            },
              r.stepCount ? h(Caret, { key: 'caret', open }) : null,
              `Run ${r.idx}`),
            // F145: both columns are the same slice (left 0, width = share of the
            // session max); only `tone` differs.
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
            // F147/F168: the whole prompt goes into the cell and the column clips
            // it at the real width; F168 adds a linear fade (`.hades-prompt`) so
            // long prompts dissolve instead of ending in a hard ellipsis.
            h('span', {
              className: 'hades-prompt',
              title: r.isSystemPrompt ? sysLabel : (r.prompt ?? ''),
              style: { flex: '1 1 0', minWidth: 0, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontVariantNumeric: 'normal' },
            }, r.isSystemPrompt ? sysLabel : (r.prompt || '…')),
            abnormal ? h('span', { style: { flex: '0 0 8px', width: 8, height: 8, borderRadius: '50%', background: T.error } }) : null,
          ),
          // F144: opening a run grows its bracket instead of snapping it in;
          // a very long run (200+ steps, ~7k px) fades instead of animating
          // height, which would relayout every frame.
          // F158: build the step list ONLY while the row is open.
          h(Collapse, { open, expandMs: !instant && detailReady && (r.stepCount ?? 0) <= BIG_RUN_STEPS ? EXPAND_MS : 0 }, open ? renderDetail(r) : null),
        );
      };

      const buildRows = () => {
        const c = rowCache.current;
        const firstDone = !first.current;
        if (c.rows !== rows || c.sort !== sort || c.langKey !== langKey || c.firstDone !== firstDone) {
          c.map.clear();
          c.rows = rows; c.sort = sort; c.langKey = langKey; c.firstDone = firstDone;
        }
        return sorted.map((r) => {
          const open = expanded.has('run-' + r.idx);
          const hit = c.map.get(r.idx);
          if (hit && hit.open === open && (!open || hit.epoch === openEpoch)) return hit.el;
          const el = buildRow(r, open);
          c.map.set(r.idx, { open, epoch: openEpoch, el });
          return el;
        });
      };

      return h('div', null,
        // Header doubles as the sort control: both metric columns are always
        // visible, clicking a column sorts by it (desc → asc → off).
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: DESIGN.space.md,
            // 3px = the group's left border, so header and rows share x offsets.
            padding: `0 0 ${DESIGN.space.xs}px 3px`, borderBottom: '1px solid ' + T.border, marginBottom: DESIGN.space.sm,
          },
        },
          h('span', { style: { flex: `0 0 ${RUN_IDX_W}px` } }),
          // Cells mirror the row cells exactly (bar slot + number slot) so the
          // bar-aligned labels land on the same x as the track below; the label
          // itself only covers the track. F169: fixed width, same as MetricBar.
          h('div', { key: 'h-time', style: { flex: `0 0 ${METRIC_W + 6 + METRIC_NUM_W}px`, display: 'flex', alignItems: 'center', minWidth: 0 } },
            sortCol('time', label('col.time', 'Time'), T.brand, METRIC_W)),
          h('div', { key: 'h-token', style: { flex: `0 0 ${METRIC_W + 6 + METRIC_NUM_W}px`, display: 'flex', alignItems: 'center', minWidth: 0 } },
            sortCol('token', label('col.token', 'Token'), T.token, METRIC_W)),
          sort ? sortClear() : null,
        ),
        h('div', { ref: listRef }, buildRows()),
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
      // F169: back to a fixed track. Stretching the bar to the panel width gave the
      // eye a 600px ruler to read a value that is only compared *within* its own
      // column — the length added no information, so the original 150px track is
      // restored (number keeps its own 70px gutter so digits stay aligned).
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
     * Columns match the Run row exactly: index, a 100px time track, a 100px token
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
      const palette = tag === 'fail'
        ? STEP_TAG_ERROR
        : overflow
          ? { color: T.faint, background: `color-mix(in srgb, ${T.muted} 9%, transparent)` }
          : (ROLE[role] ?? ROLE.tool);
      const text = overflow ? tag : (STEP_TAG_EN[tag] ?? tag) + (count > 1 ? ' ×' + count : '');
      const zh = overflow ? `${count} actions hidden` : `${tag}${count > 1 ? ' ×' + count : ''}${label ? ' · ' + label : ''}`;
      return h(RowTag, { text, color: palette.color, background: palette.background, title: zh });
    }
    function StepRow({ step, selected, open, onSelect, idxWidth, timeMetric, tokenMetric, text, title, tag, tags, marks, waitMs, hasError, content, contentReady }) {
      const [hover, setHover] = useState(false);
      // F186: animate only a real open/close of settled content. While the step's
      // payload is still arriving the box must snap to its final height instead of
      // animating placeholder → content (that two-phase move is the "jump").
      const wasReady = useRef(false);
      const expanding = open && contentReady && wasReady.current;
      if (contentReady) wasReady.current = true;
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
        // F186: the bracket's border widths and margins are reserved in BOTH
        // states (transparent when closed). Toggling now only changes colours, so
        // the box cannot shift up/down by the 3px border + 4px margins before the
        // height animation even starts.
        style: {
          borderTop: '1px solid ' + (open ? T.stepGroupRing : 'transparent'),
          borderRight: '1px solid ' + (open ? T.stepGroupRing : 'transparent'),
          borderBottom: '1px solid ' + (open ? T.stepGroupRing : 'transparent'),
          borderLeft: '3px solid ' + (open ? T.rail : 'transparent'),
          borderRadius: T.radiusMd,
          overflow: 'hidden',
          padding: open ? '0 0 2px' : '0',
          margin: `2px 0 2px ${STEP_INDENT}px`,
          background: 'transparent',
        },
      },
      row, h(Collapse, { open, expandMs: expanding ? EXPAND_MS : 0 }, content));
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

      if (state.loading) return h('div', { style: { ...cardStyle, fontSize: 12, color: T.muted } }, label('step.loading', 'Loading step…'));
      if (state.error != null) {
        return h('div', { style: { ...cardStyle, fontSize: 12, color: T.error } },
          state.error,
          h('button', {
            type: 'button',
            onClick: () => { cache.step.delete(key); setNonce((value) => value + 1); },
            style: { marginLeft: 8, font: 'inherit', fontSize: 11, color: T.text, background: T.surface, border: '1px solid ' + T.border, borderRadius: T.radiusSm, padding: '1px 8px', cursor: 'pointer' },
          }, label('step.retry', 'retry')),
        );
      }

      const data = state.data;
      const slowMs = data.slowMs ?? DEFAULT_SLOW_MS;

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
          // F201: hovering the toggle starts the read; the click then opens an
          // already-cached payload instead of a spinner.
          onMouseEnter: () => { loadEventRaw(sessionId, seqs).catch(() => {}); },
          onFocus: () => { loadEventRaw(sessionId, seqs).catch(() => {}); },
          onClick: (event) => { event.stopPropagation(); toggleRaw(rawKey); },
          // F194: every label in the card is uppercase (ARGS / RESULT / USER …);
          // the raw disclosure follows the same rule.
          style: {
            font: `11px/1 ${T.mono}`, letterSpacing: '.03em', textTransform: 'uppercase',
            color: open ? T.text : T.faint, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
          },
        }, (open ? '▾ ' : '▸ ') + label('step.original', 'RAW'));
      };

      const timeline = [];

      if (stepIdx === 0 && runActor === 'user' && runPrompt) {
        timeline.push(h('div', { key: 'instruction', style: { position: 'relative', marginBottom: 8 } },
          dotOf('user'),
          h('div', { style: cardBox() },
            capRow(chipOf('USER', 'user', label('step.instruction', 'instruction'))),
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
              title: open ? 'collapse injections' : 'expand injections',
            },
              h('span', { style: { display: 'inline-flex', alignItems: 'baseline', gap: 8 } },
                chipOf('CTX', 'context'),
                h('span', { style: { fontSize: 12, ...mono11, textTransform: 'uppercase', letterSpacing: '.03em' } }, `injected ×${n}`),
                h('span', { style: { ...mono11, color: T.muted } }, open ? '▾' : '▸'),
              ),
              open ? item.list.map((op, k) => h('div', {
                key: 'ctx-' + (op.seq ?? k),
                style: { marginTop: 4, fontSize: 12, lineHeight: 1.5, color: T.muted, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 96, overflow: 'auto' },
                title: op.text,
              }, op.text)) : null,
              h('div', { style: { marginTop: 4 } }, rawButton(item.seqs)),
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
              // F196: chip + token text on one line, raw on the left below it.
              h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flexWrap: 'wrap' } },
                chipOf('REPLY', 'assistant', label('step.modelCall', 'model call')),
                h('span', { style: { ...mono11, color: T.muted } }, `in ${fmtK(value.input)} · out ${fmtK(value.output)}`)),
              op.text ? h('div', {
                title: op.text,
                style: { marginTop: 4, fontSize: 12, lineHeight: 1.55, color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto' },
              }, op.text) : null,
              h('div', { style: { marginTop: 4 } }, rawButton([op.seq])),
              rawPanel([op.seq]),
            ),
          ));
          continue;
        }
        if (op.kind === 'tool') {
          const failed = op.error != null || op.isError;
          const isSlow = typeof op.durationMs === 'number' && op.durationMs > slowMs;
          const errorText = failed ? (op.error ?? 'error') : (isSlow ? label('step.slow', 'slow') : null);
          const block = (text, tone, cap, maxHeight) => h('div', { style: { marginTop: 4 } },
            h('div', { style: { ...mono11, color: T.faint, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 1 } }, cap),
            h('div', {
              title: text,
              style: { ...mono11, color: tone, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight, overflow: 'auto' },
            }, text));
          timeline.push(h('div', { key: 'op-' + op.seq, style: { position: 'relative', marginBottom: 8 } },
            dotOf(failed ? 'error' : 'tool'),
            h('div', { style: cardBox(failed ? { borderColor: T.error } : null) },
              // F196: chip + duration on one line, raw on the left below it.
              h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flexWrap: 'wrap' } },
                chipOf(String(op.name ?? 'tool'), 'tool'),
                h('span', { style: { ...mono11, color: T.muted } }, op.durationMs != null ? fmtMs(op.durationMs) : '—'),
                errorText != null ? h('span', { style: { fontSize: 11, color: failed ? T.error : T.warn } }, errorText) : null),
              // F192/F197: both facets are expanded in the card; raw is the
              // collapsed disclosure at the BOTTOM.
              block(op.args || label('step.noArgs', '(no arguments)'), T.text, label('step.facet.args', 'args'), 160),
              block(op.result || label('step.noOutput', '(no output)'), failed ? T.error : T.text, label('step.facet.result', 'result'), 200),
              h('div', { style: { marginTop: 4 } }, rawButton([op.callSeq, op.resultSeq])),
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
                title: label('note.' + (op.noteKind ?? 'note'), NOTE_TAG[op.noteKind] ?? 'events'),
              }),
              h('span', { title: op.text, style: { fontSize: 12, ...mono11, color: tone, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, op.text),
            ),
          ),
        ));
      }

      const empty = timeline.length === 0;
      return h('div', { style: cardStyle },
        empty
          ? h('div', { style: { marginTop: 4, fontSize: 12, color: T.muted } }, label('step.empty', 'No content in this step'))
          : h('div', { style: { position: 'relative', paddingLeft: 14 } },
            h('span', {
              style: { position: 'absolute', left: 4, top: 6, bottom: 6, width: 1, background: 'color-mix(in srgb, ' + T.text + ' 12%, transparent)' },
            }),
            timeline,
          ),
      );
    }


    /**
     * F201: ONE loader for raw events. It dedupes concurrent requests (hover
     * prefetch + click), caches the pretty-printed text with the value, and is
     * also what the RAW toggle warms on hover — the panel then opens instantly.
     */
    const RAW_PREVIEW_CHARS = 20000;
    const rawInFlight = new Map();
    const rawKeyOf = (sessionId, seqs) => sessionId + '::' + seqs.filter((value) => value != null).join(',');
    const stringifyRaw = (value) => {
      try { return JSON.stringify(value, null, 2); } catch { return String(value); }
    };
    function loadEventRaw(sessionId, seqs) {
      const list = seqs.filter((value) => value != null);
      const key = rawKeyOf(sessionId, list);
      const hit = cache.event.get(key);
      if (hit != null) return Promise.resolve(hit);
      if (rawInFlight.has(key)) return rawInFlight.get(key);
      const task = Promise.all(list.map((seq) => fetchPayload('event', { sessionId, seq })))
        .then((results) => {
          const value = results.length === 1
            ? (results[0].json?.target ?? results[0].json)
            : results.map((result) => result.json?.target ?? result.json);
          const entry = { value, text: stringifyRaw(value) };
          cacheSet(cache.event, key, entry, CACHE_MAX.event);
          rawInFlight.delete(key);
          return entry;
        })
        .catch((err) => {
          rawInFlight.delete(key);
          throw err;
        });
      rawInFlight.set(key, task);
      return task;
    }

    /**
     * Raw event JSON, fetched only when the user opens an operation (SPEC F121/NF6).
     * Accepts one or more seqs (a tool call shows call + result together).
     */
    function EventDetail({ sessionId, seqs }) {
      const list = seqs.filter((s) => s != null);
      const key = rawKeyOf(sessionId, list);
      const [state, setState] = useState(() => (cache.event.has(key)
        ? { entry: cache.event.get(key), loading: false, error: null }
        : { entry: null, loading: true, error: null }));
      const [showAll, setShowAll] = useState(false);
      useEffect(() => {
        if (cache.event.has(key) || list.length === 0) return undefined;
        let cancelled = false;
        setState({ entry: null, loading: true, error: null });
        loadEventRaw(sessionId, list)
          .then((entry) => { if (!cancelled) setState({ entry, loading: false, error: null }); })
          .catch((err) => { if (!cancelled) setState({ entry: null, loading: false, error: String((err && err.message) || err) }); });
        return () => { cancelled = true; };
      }, [key]);

      if (state.loading) return h('div', { style: { padding: '4px 0', fontSize: 12, color: T.muted } }, 'Loading raw event…');
      if (state.error != null) return h('div', { style: { padding: '4px 0', fontSize: 12, color: T.error } }, state.error);
      const text = state.entry != null && typeof state.entry.text === 'string'
        ? state.entry.text
        : stringifyRaw(state.entry != null ? state.entry.value : state.entry);
      // F201: a huge payload would block layout; render a bounded preview first.
      const truncated = !showAll && text.length > RAW_PREVIEW_CHARS;
      const shown = truncated ? text.slice(0, RAW_PREVIEW_CHARS) : text;
      // F168: the raw payload can be large — a copy affordance is what makes it
      // usable outside the panel (paste into an editor, diff two events, …).
      const copy = (event) => {
        event.stopPropagation();
        const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
        if (!clip || typeof clip.writeText !== 'function') return;
        clip.writeText(text).catch(() => {});
      };
      return h('div', { style: { marginTop: 4 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: DESIGN.space.sm, marginBottom: DESIGN.space.xxs } },
          h('span', { style: { font: `11px/1 ${T.mono}`, color: T.faint } }, `${text.length} chars`),
          h('span', { style: { flex: '1 1 auto' } }),
          h('button', {
            type: 'button',
            onClick: copy,
            title: 'Copy raw JSON',
            style: {
              font: `11px/1 ${T.mono}`, color: T.muted, background: 'transparent',
              border: '1px solid ' + T.border, borderRadius: 999, padding: '2px 8px', cursor: 'pointer',
            },
          }, 'Copy'),
        ),
        h('pre', {
          style: {
            margin: 0, padding: '6px 10px', fontSize: 11.5, lineHeight: 1.45, fontFamily: T.mono,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflow: 'auto',
            background: T.surface, border: '1px solid ' + T.border, borderRadius: T.radiusSm,
            // F201: keep the paint cost of a long payload off the scroll path.
            contain: 'content', contentVisibility: 'auto',
          },
        }, shown),
        truncated ? h('button', {
          type: 'button',
          'data-hades-raw-more': '1',
          onClick: () => setShowAll(true),
          style: {
            marginTop: DESIGN.space.xs, font: `11px/1 ${T.mono}`, color: T.muted, background: 'transparent',
            border: '1px solid ' + T.border, borderRadius: 999, padding: '2px 8px', cursor: 'pointer',
          },
        }, `show all ${text.length} chars`) : null,
      );
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
      // F161: how much empty space to keep under the last row. Without it the
      // list simply ends, so a Run in the last screenful can never be scrolled to
      // the top — "click a cell, the row comes to the top" would be true only for
      // the first rows. One viewport of tail space makes it true for every row.
      const [tailPad, setTailPad] = useState(0);
      const [payload, setPayload] = useState(null);
      const [error, setError] = useState(null);
      const [loading, setLoading] = useState(false);
      const [sort, setSort] = useState(null);
      const [expanded, setExpanded] = useState(() => new Set());
      const [details, setDetails] = useState(() => new Map());
      const [detailLoading, setDetailLoading] = useState(() => new Set());
      const [detailErrors, setDetailErrors] = useState(() => new Map());
      // F162: a locate that is waiting for its run detail to arrive, plus the
      // tween handle and the safety timer.
      const pendingLocate = useRef(null);
      const glideRaf = useRef(null);
      const glideTimer = useRef(null);
      // F162: runs opened by a matrix click expand without a height animation, so
      // the locate tween never fights it.
      const instantOpen = useRef(new Set());
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
          const sc = scrollRef.current;
          if (sc) {
            // One row (≈ 40px) of slack so even the last Run can reach the top.
            const pad = Math.max(0, sc.clientHeight - 40);
            setTailPad((prev) => (Math.abs(prev - pad) < 2 ? prev : Math.round(pad)));
          }
        };
        fit();
        window.addEventListener('resize', fit);
        // The slot may be laid out a frame or two after mount.
        const id = window.setTimeout(fit, 250);
        // F177: the host can resize the slot without a window resize (side panels,
        // the composer growing). Without this the shell kept a stale height and the
        // page — not the list — started scrolling, which carried the matrix away.
        let ro = null;
        const parent = root.parentElement;
        if (parent && typeof ResizeObserver === 'function') {
          ro = new ResizeObserver(() => fit());
          ro.observe(parent);
        }
        return () => {
          if (ro) ro.disconnect();
          window.removeEventListener('resize', fit);
          window.clearTimeout(id);
        };
      }, []);
      // F140 realtime: `seq` is the log offset the current payload was built at.
      const seqRef = useRef(null);
      const tickBusy = useRef(false);
      const expandedRef = useRef(expanded);
      expandedRef.current = expanded;
      // F163: same reason as expandedRef — cached rows and async callbacks must
      // read the live detail map, not the snapshot their closure captured.
      const detailsRef = useRef(details);
      detailsRef.current = details;
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
          // F170: first paint lands on the live edge (newest Run at the bottom).
          followRef.current = true;
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => requestAnimationFrame(() => scrollToLatest(false)));
          }
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
      // F170: live-edge following — "最新一 Run 始终在视口底部"。
      const [follow, setFollow] = useState(true);
      const followRef = useRef(true);
      followRef.current = follow;
      const programmatic = useRef(false);
      const programmaticTimer = useRef(null);
      // F182: a small ring buffer of scroll activity, readable from the console via
      // `__hadesScrollLog()`. It is the only way to see *who* moved the list in the
      // real host, where the CDP harness cannot reach.
      const scrollLogRef = useRef([]);
      const logScroll = (src, extra) => {
        const log = scrollLogRef.current;
        const host = scrollRef.current;
        log.push({
          t: Math.round(typeof performance !== 'undefined' ? performance.now() : Date.now()),
          src,
          top: host ? Math.round(host.scrollTop) : null,
          sh: host ? host.scrollHeight : null,
          ...extra,
        });
        if (log.length > 80) log.splice(0, log.length - 80);
      };

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

      /**
       * F170: open on the live edge. The panel starts "following" — the newest Run
       * stays at the bottom of the viewport and the matrix cursor rides it as the
       * conversation streams. Scrolling up (or clicking / scrubbing) hands control
       * back to the user; the pill re-attaches.
       */
      const lastRowBottom = () => {
        const host = scrollRef.current;
        if (!host) return null;
        const rows = host.querySelectorAll('[data-run]');
        if (rows.length === 0) return null;
        const last = rows[rows.length - 1];
        // Content-space coordinate: offsetTop is relative to the nearest positioned
        // ancestor (the panel root), which also holds the header — measuring via
        // rects keeps the arithmetic in the scroller's own space.
        return last.getBoundingClientRect().bottom - host.getBoundingClientRect().top + host.scrollTop;
      };
      // F174: mark our own scroll writes. Without this the scroll listener read
      // every tween frame as "the user scrolled", re-enabled following, and F170's
      // "cursor rides the newest run" effect then yanked the cursor back — so the
      // wheel advanced one Run and snapped back, forever.
      const markProgrammatic = (ms = 260) => {
        programmatic.current = true;
        if (programmaticTimer.current != null) clearTimeout(programmaticTimer.current);
        programmaticTimer.current = setTimeout(() => {
          programmaticTimer.current = null;
          programmatic.current = false;
        }, ms);
      };
      const scrollToLatest = (smooth) => {
        const host = scrollRef.current;
        const bottom = lastRowBottom();
        if (!host || bottom == null) return;
        // Land the last Run just above the viewport edge; the tail padding below
        // it stays out of frame so the list never looks "empty at the bottom".
        const target = Math.max(0, bottom - host.clientHeight + DESIGN.space.md + 4);
        if (Math.abs(target - host.scrollTop) < 2) return;
        markProgrammatic(smooth && !motionReduced() ? 420 : 120);
        if (!smooth || motionReduced()) { host.scrollTop = target; return; }
        host.scrollTo({ top: target, behavior: 'smooth' });
      };

      useEffect(() => {
        const host = scrollRef.current;
        if (!host) return undefined;
        const onScroll = () => {
          scrollAt.current = Date.now();
          logScroll('scroll', { top: Math.round(host.scrollTop), prog: programmatic.current, focus: focusRunRef.current });
          // Ignore the scroll events our own follow/glide produce.
          if (programmatic.current) return;
          const bottom = lastRowBottom();
          if (bottom == null) return;
          // F174: "at the live edge" means the newest Run is in view. F161's tail
          // padding makes `bottom - (scrollTop + clientHeight)` hugely negative near
          // the end, so the old test also answered "at the edge" while the user was
          // scrubbing inside the tail — that is what flipped following back on.
          const maxScroll = Math.max(0, host.scrollHeight - host.clientHeight);
          const atEdge = host.scrollTop >= maxScroll - DESIGN.space.sm
            || bottom - (host.scrollTop + host.clientHeight) <= DESIGN.space.sm;
          setFollow((prev) => (prev === atEdge ? prev : atEdge));
          followRef.current = atEdge;
        };
        host.addEventListener('scroll', onScroll, { passive: true });
        // F184: keep logging real user input; it is how a "who moved the list"
        // report can tell the user apart from our own animations.
        const noteInput = () => logScroll('user-input');
        host.addEventListener('wheel', noteInput, { passive: true });
        host.addEventListener('pointerdown', noteInput, { passive: true });
        host.addEventListener('keydown', noteInput, { passive: true });
        return () => {
          host.removeEventListener('scroll', onScroll);
          host.removeEventListener('wheel', noteInput);
          host.removeEventListener('pointerdown', noteInput);
          host.removeEventListener('keydown', noteInput);
        };
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
            // F170: a new payload while following keeps the newest Run in view.
            if (followRef.current) {
              if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => scrollToLatest(false));
              else scrollToLatest(false);
            }
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

      // F166: scrub focus + the short detent tween the wheel handler drives.
      const [focusRun, setFocusRun] = useState(null);
      const scrubRaf = useRef(null);
      const scrubTimer = useRef(null);
      // F172: where the previous tween was heading. Stepping faster than the tween
      // finishes used to restart the ease from a mid-flight position, so the list
      // crawled behind the selection (the wheel "felt broken" on a fast flick).
      const scrubTarget = useRef(null);
      const scrubAt = useRef(0);
      const scrubTo = (idx) => {
        const host = scrollRef.current;
        if (!host) return;
        const el = host.querySelector('[data-run="' + idx + '"]');
        if (!el) return;
        const current = host.scrollTop;
        const maxScroll = Math.max(0, host.scrollHeight - host.clientHeight);
        const offset = el.getBoundingClientRect().top - host.getBoundingClientRect().top;
        const viewH = host.clientHeight;
        // F179: a fixed FOCUS LINE. The highlighted Run always sits at 34% of the
        // viewport; the rows scroll underneath it, so sweeping the matrix reads as
        // "the list is moving", not "the highlight is jumping between rows".
        // (F178 tried minimal band scrolling — the highlight then travelled up and
        // down the viewport, which is the opposite of what a scanner line should do.)
        const anchor = Math.round(viewH * 0.34);
        let target = current + offset - anchor;
        target = Math.max(0, Math.min(maxScroll, Math.round(target)));
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        // Compose with the tween in flight: start from its target instead of the
        // current (lagging) scrollTop, so consecutive moves read as one motion.
        const pending = (now - scrubAt.current < 260 && scrubTarget.current != null) ? scrubTarget.current : null;
        const from = pending != null ? pending : current;
        scrubTarget.current = target;
        scrubAt.current = now;
        const delta = target - from;
        if (Math.abs(delta) < 1) {
          if (Math.abs(target - current) >= 1) host.scrollTop = target;
          return;
        }
        logScroll('scrub', { idx, from: Math.round(from), to: Math.round(target) });
        // F168: reduced motion turns every tween into an instant move.
        if (typeof requestAnimationFrame !== 'function' || motionReduced()) { host.scrollTop = target; return; }
        if (scrubRaf.current != null) cancelAnimationFrame(scrubRaf.current);
        // F174: our own writes must not be read as "the user scrolled".
        markProgrammatic(DESIGN.motion.focus + 160);
        if (Math.abs(from - current) >= 1) host.scrollTop = from; // skip ahead to the composed start
        // F176: 300ms with an ease-in-out curve — the 120ms cubic-out was over
        // before the eye could follow which row the pointer had picked.
        const duration = DESIGN.motion.focus;
        const t0 = now;
        const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
        const tick = (frameNow) => {
          const p = Math.min(1, (frameNow - t0) / duration);
          host.scrollTop = from + delta * ease(p);
          scrubRaf.current = p < 1 ? requestAnimationFrame(tick) : null;
        };
        scrubRaf.current = requestAnimationFrame(tick);
      };
      // F170: any explicit navigation (wheel scrub, row click, matrix click) hands
      // the scroll position back to the user — following stops until they return
      // to the live edge (or press the pill).
      if (typeof window !== 'undefined') {
        window.__hadesScrollLog = () => scrollLogRef.current.slice();
      }
      const stopFollowing = () => {
        if (!followRef.current) return;
        followRef.current = false;
        setFollow(false);
      };

      /**
       * F172: which Run is the user "at" right now? The topmost row visible in the
       * list. Stepping must start here — starting from the (possibly far away)
       * selection made one wheel notch teleport the list to a completely different
       * region, which read as "the wheel is broken".
       */
      const topVisibleRunIdx = () => {
        const host = scrollRef.current;
        if (!host) return null;
        const rows = host.querySelectorAll('[data-run]');
        if (rows.length === 0) return null;
        const top = host.getBoundingClientRect().top;
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].getBoundingClientRect().bottom > top + 4) return Number(rows[i].getAttribute('data-run'));
        }
        return Number(rows[rows.length - 1].getAttribute('data-run'));
      };

      // F175: one focus path for the pointer, the wheel and the arrow keys.
      // `null` means "the pointer left the matrix" → un-dim.
      // F180/F202: the row is NOT rebuilt on focus (that re-ran the expanded
      // Collapse and shifted the list). The class itself is re-asserted by
      // `syncFocusRow` from the rendered `focusRun`; this only records it.
      const focusRunRef = useRef(null);
      // F181: the Run a click parked at the top; its column no longer re-scrolls.
      const locatedRunRef = useRef(null);
      const markFocusedRow = (idx) => {
        focusRunRef.current = idx;
        logScroll('focus', { idx });
      };
      const beginScrub = (idx) => {
        if (idx == null) {
          setFocusRun(null);
          markFocusedRow(null);
          return;
        }
        stopFollowing();
        setFocusRun(idx);
        markFocusedRow(idx);
        // F181: a click-located Run lives at the TOP of the list. Re-scrolling it to
        // the 34% focus line just because the pointer is still over its column is
        // what made the row slide back to the middle when the pointer left the
        // matrix. Leave it alone; the next column the pointer picks moves normally.
        if (idx === locatedRunRef.current) return;
        locatedRunRef.current = null;
        scrubTo(idx);
      };

      /**
       * F183: same focus visuals as a hover, but it never scrolls the list. Used
       * while a click-located Run must stay parked at the top.
       */
      const focusRunOnly = (idx) => {
        if (idx == null) {
          setFocusRun(null);
          markFocusedRow(null);
          return;
        }
        setFocusRun(idx);
        markFocusedRow(idx);
      };

      const openRun = (idx) => {
        stopFollowing();
        const runKey = 'run-' + idx;
        // F162: read the live Set. Cached row elements keep the closure they were
        // built with, so a captured `expanded` would decide "open or close?" from
        // a stale snapshot.
        const willOpen = !expandedRef.current.has(runKey);
        if (!willOpen || !sessionId) {
          setExpanded((prev) => { const n = new Set(prev); n.delete(runKey); return n; });
          return;
        }
        const key = sessionId + '::' + idx;
        // F163: a cached detail can open right away — the panel mounts already
        // filled, so its height animation is a single clean pass.
        if (cache.run.has(key) || detailsRef.current.has(idx)) {
          if (cache.run.has(key)) {
            const hit = cache.run.get(key);
            setDetails((prev) => (prev.has(idx) ? prev : new Map(prev).set(idx, hit)));
          }
          setExpanded((prev) => { const n = new Set(prev); n.add(runKey); return n; });
          return;
        }
        // F163: when the detail still has to be fetched, fetch FIRST and open with
        // the content already in place. Opening first showed a one-line "载入 step…"
        // placeholder that then grew into the real panel — that double growth is
        // the "expands, then expands again" stutter.
        setDetailLoading((prev) => new Set(prev).add(idx));
        fetchPayload('run', { sessionId, idx }).then(({ json }) => {
          cacheSet(cache.run, key, json, CACHE_MAX.run);
          setDetails((prev) => new Map(prev).set(idx, json));
          setExpanded((prev) => { const n = new Set(prev); n.add(runKey); return n; });
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
        stopFollowing();
        // F181: remember that this Run was parked at the TOP by a click; hovering
        // its column must not drag it back down to the focus line.
        locatedRunRef.current = idx;
        logScroll('locate', { idx });
        const wasOpen = expandedRef.current.has('run-' + idx);
        if (!wasOpen) { instantOpen.current.add(idx); openRun(idx); }
        const host = scrollRef.current;
        if (!host) return;
        const reduce = typeof window !== 'undefined' && window.matchMedia
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const glide = () => {
          const el = host.querySelector('[data-run="' + idx + '"]');
          if (!el) return;
          // F155: the list box is the only scroller now (the header block is a
          // flex sibling above it), so this is plain scrollTop arithmetic.
          const current = host.scrollTop;
          const maxScroll = Math.max(0, host.scrollHeight - host.clientHeight);
          // F161: land the selected Run at the TOP of the list, not somewhere in
          // the middle — the header is outside the scroller, so nothing can cover
          // the row any more, and putting it at the top leaves the whole expanded
          // detail below it (the reason the old 32–60% anchor existed is gone).
          const offset = el.getBoundingClientRect().top - host.getBoundingClientRect().top;
          const target = Math.max(0, Math.min(maxScroll, current + offset - 2));
          const delta = target - current;
          if (Math.abs(delta) < 2) return;
          logScroll('glide', { idx, from: Math.round(current), to: Math.round(target) });
          if (reduce || typeof requestAnimationFrame !== 'function') { host.scrollTop = target; return; }
          // F174: same guard as scrubTo — a locate glide must not look like a user
          // scroll, or following flips back on and the cursor gets yanked.
          markProgrammatic(DESIGN.motion.glide + 200);
          // F168: one duration for every distance — the curve does the work, so a
          // long jump lands as crisply as a short one.
          const duration = Math.min(DESIGN.motion.glide, Math.max(DESIGN.motion.base, Math.abs(delta) * 0.35));
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
        // F162: start moving as early as the layout allows, instead of sitting on
        // a fixed 200 ms timer — that timer was the "click feels laggy" part.
        //  - run already open (or its detail cached): the layout is final → glide
        //    on the next frame;
        //  - run still loading: glide as soon as its detail lands (pendingLocate
        //    effect), with a timer as the safety net if the fetch never answers.
        const kick = () => {
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(glide));
          else glide();
        };
        if (glideTimer.current != null) { clearTimeout(glideTimer.current); glideTimer.current = null; }
        // A cached detail is applied in this same batch, so the layout is final.
        const detailCached = cache.run.has(sessionId + '::' + idx);
        if (wasOpen || detailCached) { kick(); return; }
        pendingLocate.current = idx;
        glideTimer.current = setTimeout(() => {
          glideTimer.current = null;
          if (pendingLocate.current === idx) pendingLocate.current = null;
          kick();
        }, 400);
      };

      /**
       * F162: when the detail for a pending locate lands, glide immediately —
       * the list height is final at that point, so the target is exact.
       */
      useEffect(() => {
        const idx = pendingLocate.current;
        if (idx == null || !details.has(idx)) return;
        pendingLocate.current = null;
        if (glideTimer.current != null) { clearTimeout(glideTimer.current); glideTimer.current = null; }
        locateRun(idx);
      }, [details]);

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

      // F162: identity token for everything an OPEN row's content depends on
      // (its detail payload, which Steps are open, live step refreshes). Closed
      // rows ignore it, so a click no longer rebuilds the whole list.
      const detailEpoch = useMemo(() => ({}), [details, detailLoading, detailErrors, stepTokens, expanded]);


      const renderDetail = (run) => {
        const detail = details.get(run.idx);
        if (!detail) {
          if (detailErrors.has(run.idx)) return h('div', { style: { padding: '4px 0 6px 74px', fontSize: 12, color: T.error } }, detailErrors.get(run.idx));
          return h('div', { style: { padding: '4px 0 6px 74px', fontSize: 12, color: T.muted } }, detailLoading.has(run.idx) ? label('loadingDetail', 'Loading steps…') : '');
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
              h(SliceFill, { tone: T.token, left: beforePct, width: ownPct, tip: `${tokenText} tok · ${sharePct}% of Run · cum ${fmtK(cumTokens[stepIdx])} (${Math.round(cumPct)}%)` }),
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
                  .concat(step.modelMs != null ? ['model ' + fmtMs(step.modelMs)] : [])
                  .concat(step.toolMs > 0 ? ['tools ' + fmtMs(step.toolMs)] : [])
                  .concat(fmtWait(step.waitMs) != null ? ['wait ' + fmtWait(step.waitMs)] : [])
                  .join(' · '),
              }),
              tokenMetric: h(MetricBar, {
                width: METRIC_W, numWidth: METRIC_NUM_W, tone: T.token, fill: tokenFill, valueText: tokenText,
                // F143: the track is the run's total, so the tip says where this
                // step sits inside it and how much of the run is spent already.
                tip: `${tokenText} tok · ${sharePct}% of Run · cum ${fmtK(cumTokens[stepIdx])} (${Math.round(cumPct)}%)`,
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
              }, `show all ${detail.steps.length} steps (${hidden} more)`))
            : null,
        );
      };

      // F155/F187: split the panel into an app shell — the header block (the
      // is a flex child ABOVE the scroller, so it cannot scroll: no listeners, no
      // transforms, nothing that a shadow boundary or an `overflow: hidden`
      // ancestor can defeat. Only the Run list scrolls.
      const renderHeader = () => {
        if (error != null || !payload) return null;
        if ((payload.counts?.events ?? 0) === 0) return null;
        return h(OverviewBoard, {
          rows: payload.runs ?? [],
          label,
          onLocate: locateRun,
          onScrub: beginScrub,
          onFocusOnly: focusRunOnly,
          followLatest: follow,
          baseRun: topVisibleRunIdx,
        });
      };

      // F168: a bare "Loading…" line reads as a prototype. The first paint shows
      // skeleton rows at the real row height, so the list never jumps when data
      // lands. Empty and error states get the same centred card treatment.
      const stateCard = (key, tone, text, extra) => h('div', {
        key,
        style: {
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: DESIGN.space.xs, padding: `${DESIGN.space.lg * 2}px ${DESIGN.space.md}px`,
          minHeight: 160, color: tone, textAlign: 'center', fontSize: 12,
        },
      },
        h('span', {
          style: {
            width: 28, height: 28, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid ' + T.border, color: tone, font: `13px/1 ${T.mono}`,
          },
        }, key === 'err' ? '!' : '∅'),
        h('span', null, text),
        extra ?? null,
      );

      const skeleton = () => h('div', { key: 'skeleton', 'data-hades-skeleton': '1' },
        Array.from({ length: 10 }).map((_, i) => h('div', {
          key: 'sk-' + i,
          className: 'hades-skeleton',
          style: {
            display: 'flex', alignItems: 'center', gap: DESIGN.space.md,
            minHeight: DESIGN.row.height, padding: `${DESIGN.row.pad}px 0`, boxSizing: 'border-box',
          },
        },
          h('span', { style: { flex: `0 0 ${RUN_IDX_W}px`, height: 9, borderRadius: 3, background: `color-mix(in srgb, ${T.text} 8%, transparent)` } }),
          h('span', { style: { flex: '1 1 0', height: 8, borderRadius: 99, background: `color-mix(in srgb, ${T.text} 7%, transparent)` } }),
          h('span', { style: { flex: '1 1 0', height: 8, borderRadius: 99, background: `color-mix(in srgb, ${T.text} 7%, transparent)` } }),
          h('span', { style: { flex: '1 1 0', height: 9, borderRadius: 3, background: `color-mix(in srgb, ${T.text} 6%, transparent)` } }),
        )),
      );

      const renderList = () => {
        if (error != null) {
          return stateCard('err', T.error, String(error), h('button', {
            type: 'button',
            onClick: () => load(true),
            style: {
              marginTop: DESIGN.space.xs, font: `11px/1 ${T.mono}`, color: T.text,
              background: T.surface, border: '1px solid ' + T.border, borderRadius: 999, padding: '3px 10px', cursor: 'pointer',
            },
          }, label('step.retry', 'Retry')));
        }
        if (loading && !payload) return skeleton();
        if (!payload) return null;
        if ((payload.counts?.events ?? 0) === 0) return stateCard('empty', T.muted, label('empty', 'No events in this session'));
        return h('div', null,
          h(DualBarChart, {
            rows: payload.runs ?? [],
            sort,
            onSort: setSort,
            sysLabel: label('system', 'system prompt'),
            expanded,
            onToggleRun: openRun,
            renderDetail,
            hasDetail: (idx) => details.has(idx),
            label,
            detailEpoch,
            instantRef: instantOpen,
            focusRun,
          }),
          // F161: breathing room so the last Run can still be scrolled to the top.
          tailPad > 0 ? h('div', { key: 'tail', 'data-hades-tail': '1', style: { height: tailPad } }) : null,
        );
      };

      return h('div', {
        ref: rootRef,
        // F166: while scrubbing the list fades (see ROW_ANIM_CSS).
        className: focusRun != null ? 'hades-scrubbing' : undefined,
        style: {
          height: shellH ? shellH + 'px' : '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
          boxSizing: 'border-box', fontSize: 13, lineHeight: 1.6, color: T.text, fontFamily: T.font,
          position: 'relative',
          // F158: consumed by the injected hover rules (see ROW_ANIM_CSS).
          '--hades-hover-row': T.runHoverBg,
          '--hades-sel-row': T.runSelBg,
          '--hades-muted': T.muted,
          '--hades-text': T.text,
          '--hades-brand': T.brand,
          // F165: matrix slider/surface tokens.
          '--hades-track': `color-mix(in srgb, ${T.text} 12%, transparent)`,
          '--hades-focus-row': T.focusRow,
          '--hades-surface': T.surface,
          '--hades-border': T.border,
          // F168: design tokens consumed by the injected stylesheets.
          ...CSS_VARS,
        },
      },
        h('style', { key: 'hades-row-anim' }, ROW_ANIM_CSS),
        // F151: no header bar — the "cache hit / server ms / live badge / refresh
        // button" chrome was developer telemetry sitting on top of the product,
        // and the 2 s realtime tick makes a manual refresh unnecessary.
        // F177: the header block is a flex sibling above the scroller (F155), so it
        // is already structurally pinned; `sticky` + z-index is the second belt for
        // the case where the host lets the *page* scroll instead.
        h('div', {
          'data-hades-header': '1',
          style: {
            flex: '0 0 auto', position: 'sticky', top: 0, zIndex: 4,
            padding: '10px 12px 0', background: T.surface,
          },
        }, renderHeader()),
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
            // F180: we own the scroll position. Chrome's scroll anchoring silently
            // adjusts scrollTop when content above the viewport grows (an expanded
            // row's detail), which made the list shift under the pointer.
            overflowAnchor: 'none',
          },
        },
          renderList(),
        ),
        // F170: while the user is reading history, this pill is the way back to
        // the live edge (same affordance every log viewer has).
        !follow && (payload?.runs?.length ?? 0) > 0 ? h('button', {
          key: 'latest',
          type: 'button',
          'data-hades-latest': '1',
          title: label('mx.jumpLatest', 'Jump to the latest Run'),
          onClick: () => {
            followRef.current = true;
            setFollow(true);
            scrollToLatest(true);
          },
          style: {
            position: 'absolute', right: 20, bottom: 16, zIndex: 6,
            display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 12px',
            borderRadius: 999, cursor: 'pointer',
            border: '1px solid ' + T.border, background: T.surface, color: T.text,
            font: `11px/1 ${T.mono}`, letterSpacing: '.02em',
            boxShadow: `0 6px 16px -8px color-mix(in srgb, ${T.text} 45%, transparent)`,
          },
        },
          h('span', { style: { color: T.brand } }, '↓'),
          label('mx.latest', 'Latest'),
        ) : null,
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // F165: the product ships English-only. Both locale slots carry the same
        // table so a Chinese UI language cannot produce half-English labels.
        const EN = {
          'view.title': 'Trace Lab',
          'loading': 'Loading…', 'empty': 'No events in this session',
          'run': 'Run ', 'step': 'Step ', 'followup': 'follow-up', 'system': 'System prompt',
          'mx.steps': 'Steps', 'mx.flags': 'Flags', 'mx.hint': 'hover a run · click to locate', 'mx.clearSel': 'Clear selection',
          'mx.showAll': 'all', 'mx.showRecent': 'latest', 'mx.runsUnit': 'runs',
          'mx.latest': 'Latest', 'mx.jumpLatest': 'Jump to the latest Run',
          'mx.windowHint': 'Drag to choose how many of the latest runs the matrix shows',
          'mx.rampTime': 'darker = slower relative to the session',
          'mx.rampToken': 'darker = more tokens in the session',
          'mx.rampSteps': 'darker = more steps in the session',
          'mx.error': 'Error', 'mx.slow': 'Slow',
          'loadingDetail': 'loading Steps…',
          'step.model': 'model', 'step.timing': 'elapsed', 'step.tokens': 'tokens', 'step.summary': 'summary',
          'step.args': 'args', 'step.result': 'result', 'step.original': 'RAW', 'step.loading': 'loading Step…',
          'step.facet.args': 'args', 'step.facet.result': 'result',
          'step.noArgs': '(no arguments)', 'step.noOutput': '(no output)',
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
        };
        ctx.effect(() => ctx.locale.register(NS, { zh: EN, en: EN }), 'trace-analyzer: locale');

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
