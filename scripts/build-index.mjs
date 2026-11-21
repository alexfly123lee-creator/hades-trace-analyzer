// Build the plugin-market index (format 1) for this bundle.
//   node scripts/build-index.mjs [--name <npmName>] [--out <path>] [--registry <url>]
//
// The icon is embedded as a `data:` URL (≤ 32 KiB decoded, format limit), so the
// index is a single self-contained file that can be served from anywhere.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at >= 0 && argv[at + 1] != null ? argv[at + 1] : fallback;
};

const pkgDir = join(root, 'dsh-trace-analyzer');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const en = JSON.parse(readFileSync(join(pkgDir, 'locale', 'en.json'), 'utf8'));
const zh = JSON.parse(readFileSync(join(pkgDir, 'locale', 'zh.json'), 'utf8'));
const iconSvg = readFileSync(join(pkgDir, 'icon.svg'));
const iconData = 'data:image/svg+xml;base64,' + iconSvg.toString('base64');
const MAX_INLINE_ICON_BYTES = 32 * 1024;
if (iconSvg.length > MAX_INLINE_ICON_BYTES) {
  throw new Error(`icon is ${iconSvg.length} B, the format caps an inline icon at ${MAX_INLINE_ICON_BYTES} B`);
}

const name = arg('--name', 'dsh-trace-analyzer');
const registry = arg('--registry', '');
const out = arg('--out', join(root, 'plugin-index.json'));

const shortEn = en.meta.description.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.');
const shortZh = zh.meta.description.split('。').slice(0, 2).join('。').replace(/。?$/, '。');

const index = {
  format: 1,
  title: { en: 'Hades plug-ins', zh: 'Hades 插件' },
  description: {
    en: 'Bundles for DeepSeek Harness, published by the Trace Lab author.',
    zh: 'DeepSeek Harness 的组合包，由 Trace Lab 作者发布。',
  },
  metadata: {
    categories: {
      observability: { title: { en: 'Observability', zh: '可观测性' } },
    },
    labels: {
      trace: { title: { en: 'Trace', zh: '轨迹' } },
      session: { title: { en: 'Session', zh: '会话' } },
    },
    sortKeys: {},
  },
  plugins: [
    {
      name,
      title: { en: en.meta.title, zh: zh.meta.title },
      description: { en: shortEn, zh: shortZh },
      icon: iconData,
      author: pkg.author,
      homepage: pkg.homepage,
      repository: {
        url: (pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, ''),
        directory: pkg.repository?.directory,
      },
      metadata: {
        category: 'observability',
        keywords: pkg.keywords ?? [],
        labels: ['trace', 'session'],
        sortKeys: {},
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp: Math.floor(Date.now() / 1000),
          source: registry === '' ? { type: 'npm' } : { type: 'npm', registry },
          engines: { dsh: pkg.engines?.dsh ?? '>=0.2.2-rc.1' },
        },
      ],
    },
  ],
};

writeFileSync(out, JSON.stringify(index, null, 2) + '\n');
console.log(`index: ${out}`);
console.log(`plugin: ${name}@${pkg.version} · ${iconSvg.length} B icon inlined · source npm${registry ? ' @ ' + registry : ''}`);
