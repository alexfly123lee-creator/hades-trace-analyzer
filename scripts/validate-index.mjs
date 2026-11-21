// Validate a plugin-market index with the validator shipped in the running DSH.
//
// The validator lives inside the Desktop app.asar, so this must run on the DSH
// Electron binary as Node:
//   $env:ELECTRON_RUN_AS_NODE='1'
//   & "$env:DSH_NODE_EXECUTABLE" scripts/validate-index.mjs plugin-index.json
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const indexPath = process.argv[2] ?? 'plugin-index.json';
const installDir = process.env.DSH_INSTALL_DIR;
if (!installDir) {
  console.error('DSH_INSTALL_DIR is not set — run this through the DSH Electron binary (ELECTRON_RUN_AS_NODE=1).');
  process.exit(2);
}

const pkgFile = require.resolve('@deepseek-ai/dsh-plugin-market-index/package.json', { paths: [installDir] });
const pkgDir = dirname(pkgFile);
const mod = await import(new URL('file://' + join(pkgDir, 'lib', 'index.js').replace(/\\/g, '/')));
const { parseMarketIndex, marketInstallTarget, MarketIndexError } = mod;

const value = JSON.parse(readFileSync(indexPath, 'utf8'));
const indexUrl = 'https://example.com/plugin-index.json';
try {
  const parsed = parseMarketIndex(value, indexUrl);
  console.log(`OK  format ${parsed.format} · ${parsed.plugins.length} plugin(s)`);
  console.log(`    index title: ${JSON.stringify(parsed.title)}`);
  for (const plugin of parsed.plugins) {
    console.log(`    ${plugin.name}`);
    console.log(`      title: ${JSON.stringify(plugin.title)}`);
    console.log(`      category: ${plugin.metadata.category ?? '(none)'} · labels: ${plugin.metadata.labels.join(',') || '(none)'}`);
    console.log(`      versions (desc): ${plugin.versions.map((v) => v.version).join(', ')}`);
    for (const version of plugin.versions) {
      const target = marketInstallTarget(plugin.name, version);
      console.log(`      ${version.version} -> spec ${target.spec}${target.registry ? ' first@' + target.registry : ''}`);
      console.log(`      engines.dsh ${version.engines.dsh ?? '(any)'} · published ${new Date(version.publishTimestamp * 1000).toISOString()}`);
    }
  }
} catch (error) {
  if (error instanceof MarketIndexError || error?.name === 'MarketIndexError') {
    console.error(`FAIL ${indexPath}: ${error.path} ${error.reason}`);
    process.exit(1);
  }
  throw error;
}
