// F170 harness: replicate the live-edge following mechanics (lastRowBottom via
// rects, follow detection, pill) and drive them through CDP.
//   node mockup/build-follow-harness.mjs
import { writeFileSync } from 'node:fs';

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>F170 follow</title>
<style>html,body{margin:0;background:#eceef1}#host{display:block}</style></head><body>
<div id="host"></div>
<script>
  const CSS = \`
    :host{display:block;font:13px/1.6 -apple-system,"Segoe UI",sans-serif;color:#0f1115}
    .shell{position:relative;display:flex;flex-direction:column;height:520px;background:#fff;border:1px solid #0000001a;border-radius:12px;overflow:hidden}
    .hdr{flex:0 0 auto;height:88px;background:#fff;border-bottom:1px solid #0000001a;display:flex;align-items:center;justify-content:center;font:11px Consolas,monospace;color:#61666b}
    .list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 12px 12px;overscroll-behavior:contain}
    .row{display:flex;align-items:center;gap:12px;height:28px;padding:4px 0;box-sizing:border-box;border-bottom:1px solid #0000000d;font-size:12px}
    .idx{flex:0 0 78px;color:#61666b;font-family:Consolas,monospace}
    .txt{flex:1 1 0;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    .pill{position:absolute;right:20px;bottom:16px;height:28px;padding:0 12px;border-radius:999px;border:1px solid #0000001a;background:#fff;font:11px Consolas,monospace;display:inline-flex;align-items:center;gap:6px;cursor:pointer;box-shadow:0 6px 16px -8px rgba(15,17,21,.45)}
    .pill b{color:#3b82f6}
    .hidden{display:none}
  \`;
  const host = document.getElementById('host');
  const root = host.attachShadow({ mode: 'open' });
  const st = document.createElement('style'); st.textContent = CSS; root.appendChild(st);
  const wrap = document.createElement('div');
  wrap.innerHTML = '<div class="shell"><div class="hdr">KPI + matrix (fixed)</div>'
    + '<div class="list" data-list="1"></div>'
    + '<button class="pill hidden" data-pill="1"><b>↓</b> Latest</button></div>';
  root.appendChild(wrap);

  const list = root.querySelector('[data-list]');
  const pill = root.querySelector('[data-pill]');
  let n = 0;
  let follow = true;
  let programmatic = false;

  function addRow(prompt) {
    const el = document.createElement('div');
    el.className = 'row';
    el.setAttribute('data-run', String(n));
    el.innerHTML = '<span class="idx">Run ' + n + '</span><span class="txt">' + prompt + '</span>';
    list.appendChild(el);
    n += 1;
  }
  const tail = document.createElement('div');
  tail.setAttribute('data-tail', '1');
  list.appendChild(tail);
  function sizeTail() { tail.style.height = Math.max(0, list.clientHeight - 40) + 'px'; }

  function lastRowBottom() {
    const rows = list.querySelectorAll('[data-run]');
    if (!rows.length) return null;
    const last = rows[rows.length - 1];
    return last.getBoundingClientRect().bottom - list.getBoundingClientRect().top + list.scrollTop;
  }
  function scrollToLatest(smooth) {
    const bottom = lastRowBottom();
    if (bottom == null) return;
    const target = Math.max(0, bottom - list.clientHeight + 16);
    if (Math.abs(target - list.scrollTop) < 2) return;
    if (smooth) {
      programmatic = true;
      list.scrollTo({ top: target, behavior: 'smooth' });
      setTimeout(() => { programmatic = false; }, 320);
    } else {
      list.scrollTop = target;
    }
  }
  function paintPill() { pill.classList.toggle('hidden', follow); }

  list.addEventListener('scroll', () => {
    if (programmatic) return;
    const bottom = lastRowBottom();
    if (bottom == null) return;
    const atEdge = bottom - (list.scrollTop + list.clientHeight) <= 8;
    if (atEdge !== follow) { follow = atEdge; paintPill(); }
  }, { passive: true });

  pill.addEventListener('click', () => {
    follow = true; paintPill(); scrollToLatest(true);
  });

  // seed
  for (let i = 0; i < 20; i++) addRow('message ' + i);
  sizeTail();
  scrollToLatest(false);

  window.__push = (k) => {
    for (let i = 0; i < k; i++) addRow('streamed message ' + n);
    sizeTail();
    if (follow) scrollToLatest(false);   // the tick's follow path
    paintPill();
  };
  window.__userScroll = (delta) => {
    programmatic = false;
    list.scrollTop = list.scrollTop + delta;
  };
  window.__clickPill = () => pill.click();
  window.__state = () => {
    const bottom = lastRowBottom();
    return {
      rows: n,
      follow,
      pillVisible: !pill.classList.contains('hidden'),
      scrollTop: Math.round(list.scrollTop),
      maxScroll: Math.round(list.scrollHeight - list.clientHeight),
      lastRowBottom: bottom == null ? null : Math.round(bottom),
      distanceToEdge: bottom == null ? null : Math.round(bottom - (list.scrollTop + list.clientHeight)),
      viewport: list.clientHeight,
    };
  };
</script></body></html>`;

writeFileSync('C:/Users/18610/AppData/Local/Temp/dsm/follow-harness.html', html);
writeFileSync('mockup/follow-harness.html', html);
console.log('follow harness written');
