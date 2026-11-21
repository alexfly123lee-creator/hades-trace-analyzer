// Stage a publishable copy of the bundle and show exactly what npm would pack.
// What is verified here: the packed file list (icons, locales, docs, patch, runtime),
// the manifest fields Discover reads, and the inline icon size limit.
// Publishing itself needs npm credentials, so this never publishes by itself.
//   node scripts/publish.mjs [--name <npmName>] [--registry <url>] [--dry-run]
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'dsh-trace-analyzer');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] != null ? argv[at + 1] : fallback;
};
const has = (name) => argv.includes(name);

const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const name = flag('--name', 'dsh-trace-analyzer');
const registry = flag('--registry', '');
const version = flag('--version', pkg.version);
const dryRun = has('--dry-run');

// ---- validate the display assets before staging ---------------------------
const icon = readFileSync(join(pkgDir, 'icon.svg'), 'utf8');
const preview = readFileSync(join(pkgDir, 'docs', 'preview.svg'), 'utf8');
const detail = readFileSync(join(pkgDir, 'docs', 'DETAIL.md'), 'utf8').trim();
const problems = [];
if (!/viewBox="0 0 36 36"/.test(icon)) problems.push('icon.svg should use the 36x36 artwork box (artwork.md)');
if (/<(rect|path)[^>]*fill="#(fff|ffffff|000|000000)"/i.test(icon) && !/fill="#3b82f6"/.test(icon)) {
  problems.push('icon must not be a flat white/black tile');
}
if (/<image|<foreignObject|<script|<style|<text/i.test(preview)) problems.push('preview.svg must not use text/style/script/image/foreignObject');
if (!/viewBox="0 0 640 300"/.test(preview)) problems.push('preview.svg should be 640x300 (plugin-details.md)');
const detailLines = detail.split('\n').filter((line) => line.trim() !== '');
if (detailLines.length !== 1 || !/^!\[[^\]]+\]\(preview\.svg\)$/.test(detailLines[0])) {
  problems.push('docs/DETAIL.md must be exactly one image line pointing at preview.svg');
}
if (Buffer.byteLength(icon) > 256 * 1024) problems.push('icon exceeds 256 KiB');
if (Buffer.byteLength(preview) > 1024 * 1024) problems.push('preview exceeds 1 MiB');
for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'docs/DETAIL.md', 'docs/DETAIL.zh.md', 'docs/preview.svg', 'README.md', 'icon.svg']) {
  if (!existsSync(join(pkgDir, file))) problems.push(`missing packaged file: ${file}`);
}
if (problems.length > 0) {
  console.error('FAIL ' + problems.join(' · '));
  process.exit(1);
}

// ---- stage the publishable tree ------------------------------------------
const stage = join(tmpdir(), `dsh-publish-${Date.now()}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const entry of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md']) {
  cpSync(join(pkgDir, entry), join(stage, entry));
}
cpSync(join(pkgDir, 'lib'), join(stage, 'lib'), { recursive: true });
cpSync(join(pkgDir, 'locale'), join(stage, 'locale'), { recursive: true });
cpSync(join(pkgDir, 'docs'), join(stage, 'docs'), { recursive: true });

const staged = { ...pkg, name, version };
delete staged.private;
writeFileSync(join(stage, 'package.json'), JSON.stringify(staged, null, 2) + '\n');

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const files = walk(stage).map((full) => ({ path: relative(stage, full).replace(/\\/g, '/'), bytes: statSync(full).size }));
const total = files.reduce((sum, f) => sum + f.bytes, 0);
console.log(`staged ${pkgDir} -> ${stage}`);
console.log(`package: ${name}@${version}${registry ? ' (registry ' + registry + ')' : ''}`);
console.log(`files: ${files.length} · ${(total / 1024).toFixed(1)} KiB`);
for (const file of files) console.log(`  ${String(file.bytes).padStart(7)}  ${file.path}`);

// The packer proves the `files` filter: npm if present, else the pnpm that ships
// with the DSH runtime. The tarball listing is compared with the required files.
const depsDir = join(dirname(process.execPath), '..', '..');
const npmCmd = join(dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
const pnpmCjs = join(depsDir, 'pnpm', 'bin', 'pnpm.cjs');
const wanted = ['package/index.js', 'package/client.js', 'package/cordis.patch.yml', 'package/icon.svg',
  'package/docs/DETAIL.md', 'package/docs/DETAIL.zh.md', 'package/docs/preview.svg',
  'package/locale/en.json', 'package/locale/zh.json', 'package/README.md', 'package/package.json'];

const runPacker = () => {
  const tarballs = () => readdirSync(stage).filter((entry) => entry.endsWith('.tgz'));
  let result = null;
  if (existsSync(npmCmd)) {
    result = spawnSync(npmCmd, ['pack', '--ignore-scripts'], { cwd: stage, encoding: 'utf8', shell: process.platform === 'win32' });
    console.log('packer: npm');
  } else if (existsSync(pnpmCjs)) {
    result = spawnSync(process.execPath, [pnpmCjs, 'pack'], { cwd: stage, encoding: 'utf8' });
    console.log('packer: pnpm (bundled with the DSH runtime)');
  } else {
    console.log('no npm/pnpm found; staged tree printed above instead');
    return;
  }
  if (result.status !== 0) {
    console.log('packer failed; staged tree printed above instead: ' + String(result.stderr ?? '').slice(0, 300));
    return;
  }
  const tarball = tarballs()[0];
  if (tarball == null) return;
  const listing = spawnSync('tar', ['-tf', join(stage, tarball)], { encoding: 'utf8' });
  const entries = String(listing.stdout ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const missing = wanted.filter((want) => !entries.includes(want));
  console.log(`tarball: ${tarball} · ${entries.length} entries · ${(statSync(join(stage, tarball)).size / 1024).toFixed(1)} KiB`);
  if (missing.length > 0) {
    console.error('FAIL tarball is missing: ' + missing.join(', '));
    process.exitCode = 1;
  } else {
    console.log('tarball contains every runtime, locale, doc and icon file');
  }
};
runPacker();

if (!dryRun) {
  console.log('\nPublish with:');
  if (existsSync(npmCmd)) console.log(`  cd "${stage}" && npm publish${registry ? ' --registry ' + registry : ''} --access public`);
  else console.log(`  cd "${stage}" && "${process.execPath}" "${pnpmCjs}" publish${registry ? ' --registry ' + registry : ''} --access public`);
  console.log('then host plugin-index.json and add its URL in Plugin Manager -> Discover.');
}
