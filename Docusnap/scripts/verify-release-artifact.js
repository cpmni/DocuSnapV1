#!/usr/bin/env node
'use strict';
/**
 * scripts/verify-release-artifact.js — POST-BUILD RELEASE GATE on the packaged app (pre-deployment audit
 * 2026-09-07 P0-3 / P1-5; plan docs/designs/AUDIT_FIX_PLAN_2026-09-08.md §3 slice 2.6; Oracle C5).
 *
 * Reads dist/win-unpacked (what electron-builder packed — the installer copies it verbatim) and asserts:
 *   1. SOURCE PROTECTION — resources/app.asar holds /src/main.jsc, /src/main.js is the bytenode stub, and
 *      NO readable .js survives under /src/modules, /src/services, /src/lib or /database (preload.js and
 *      /src/windows/** ship as plain source by design — harden-js.js:15-17).
 *   2. FUSES — `electron-fuses read --app ScanFinder.exe` reports every fuse exactly as package.json
 *      build.electronFuses declares (a mismatch = packaging fault or tamper).
 *   3. BOOT SMOKE — the packaged exe started with --smoke-boot (src/main.js: throwaway userData, DB open +
 *      migrations, exit 0, no window) exits 0 within 60 s. This is the bricking check for the asar-integrity
 *      fuses + V8 bytecode on THIS binary. SKIP_SMOKE=1 skips it (loudly).
 *   4. IDENTITY — the packaged package.json is not a test build (no testBuild) unless TEST_BUILD=1.
 * Writes dist/release-manifest-<rev>.json (rev, version, installer sha256, gates) for the release log.
 * evaluate() is pure and pinned by scripts/test_verify_release_artifact.js.
 *
 *   node scripts/verify-release-artifact.js [dist/win-unpacked]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

const PLAINTEXT_FORBIDDEN = /^\/(src\/(modules|services|lib)|database)\/.*\.js$/;
const FUSE_NAMES = {
  runAsNode: 'RunAsNode', enableCookieEncryption: 'EnableCookieEncryption',
  enableNodeOptionsEnvironmentVariable: 'EnableNodeOptionsEnvironmentVariable',
  enableNodeCliInspectArguments: 'EnableNodeCliInspectArguments',
  enableEmbeddedAsarIntegrityValidation: 'EnableEmbeddedAsarIntegrityValidation',
  onlyLoadAppFromAsar: 'OnlyLoadAppFromAsar',
  loadBrowserProcessSpecificV8Snapshot: 'LoadBrowserProcessSpecificV8Snapshot',
  grantFileProtocolExtraPrivileges: 'GrantFileProtocolExtraPrivileges',
};

/** Parse `electron-fuses read` text → { FuseName: true|false } */
function parseFuseText(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9]+)\s+is\s+(Enabled|Disabled)/i.exec(line);
    if (m) out[m[1]] = /enabled/i.test(m[2]);
  }
  return out;
}

/**
 * htmlAssetProblems(entries, htmlByPath) → problems[]: for every shipped .html, every relative <script src> /
 * <link href> (and <img src>) must resolve to an asar entry. Pure. (eric re-audit 2026-09-08 — the hardened
 * build had deleted two renderer-served scripts; the boot smoke never reaches a window, so only an asset walk sees it.)
 */
function htmlAssetProblems(entries, htmlByPath) {
  const set = new Set(entries.map(e => String(e).replace(/\\/g, '/')));
  const out = [];
  for (const [htmlPath, html] of Object.entries(htmlByPath || {})) {
    const dir = htmlPath.replace(/[^/]*$/, '');
    const refs = [];
    const re = /<(?:script|link|img)\b[^>]*?\s(?:src|href)=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html))) refs.push(m[1]);
    for (const ref of refs) {
      if (/^(?:https?:|data:|#|mailto:)/i.test(ref) || ref.startsWith('/')) continue;
      const parts = (dir + ref.split('?')[0].split('#')[0]).split('/');
      const stack = [];
      for (const p of parts) { if (p === '..') stack.pop(); else if (p !== '.' && p !== '') stack.push(p); }
      const resolved = '/' + stack.join('/');
      if (!set.has(resolved)) out.push(`html-asset: ${htmlPath} references ${ref} → ${resolved} which is NOT in the asar (a deleted/unpacked renderer asset — the window would load broken)`);
    }
  }
  return out;
}

/**
 * evaluate({ entries, mainJs, fuses, expectedFuses, smokeExit, pkg, testBuild, htmlByPath, smokeIdentity }) → problems[]
 * entries: asar paths ('/src/main.js' …); mainJs: text of /src/main.js; fuses: parsed {name:bool};
 * expectedFuses: package.json build.electronFuses; smokeExit: number|null (null = skipped); pkg: packaged package.json.
 */
function evaluate({ entries = [], mainJs = '', fuses = {}, expectedFuses = {}, smokeExit = null, smokeSkipped = false, pkg = {}, testBuild = false, htmlByPath = null, smokeIdentity = null } = {}) {
  const p = [];
  if (htmlByPath) p.push(...htmlAssetProblems(entries, htmlByPath));
  // The smoke prints the arming identity the packaged bundle resolved; it must see the packaged package.json
  // (buildRev) — a silent resolve failure would leave a TEST build unarmed / a release never disarming.
  if (!smokeSkipped && smokeIdentity && pkg && pkg.buildRev && smokeIdentity.buildRev !== pkg.buildRev) {
    p.push(`identity: the running binary resolved buildRev ${JSON.stringify(smokeIdentity.buildRev)} but the packaged package.json says ${JSON.stringify(pkg.buildRev)} — build_arming.resolveIdentity() cannot see the packaged package.json`);
  }
  const set = new Set(entries.map(e => String(e).replace(/\\/g, '/')));
  if (!set.has('/src/main.jsc')) p.push('source-protection: /src/main.jsc missing — the build is NOT hardened (HARDEN_JS=1)');
  if (!/require\(['"]\.\/main\.jsc['"]\)/.test(mainJs)) p.push('source-protection: /src/main.js is not the bytenode stub (real source shipped)');
  const leaks = [...set].filter(e => PLAINTEXT_FORBIDDEN.test(e));
  if (leaks.length) p.push(`source-protection: ${leaks.length} readable module(s) under src/modules|services|lib or database: ${leaks.slice(0, 8).join(', ')}${leaks.length > 8 ? '…' : ''}`);
  for (const [key, want] of Object.entries(expectedFuses || {})) {
    const name = FUSE_NAMES[key] || (key[0].toUpperCase() + key.slice(1));
    if (!(name in fuses)) p.push(`fuses: ${name} not reported by electron-fuses read`);
    else if (fuses[name] !== !!want) p.push(`fuses: ${name} is ${fuses[name] ? 'Enabled' : 'Disabled'}, package.json declares ${want}`);
  }
  if (!smokeSkipped && smokeExit !== 0) p.push(`boot-smoke: --smoke-boot exit ${smokeExit === null ? 'none/timeout' : smokeExit} (the packaged binary did not reach a DB open — bricking class)`);
  if (!testBuild && (pkg.testBuild === true || pkg.testBuild === 'true')) p.push('identity: the packaged package.json carries testBuild=true but TEST_BUILD is unset — this is a TEST build, not a release');
  if (testBuild && !(pkg.testBuild === true || pkg.testBuild === 'true')) p.push('identity: TEST_BUILD=1 but the packaged package.json lacks testBuild=true (the arming metadata did not bake)');
  return p;
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

/** Read the fuse wire in-process via @electron/fuses (no shell — the npx.cmd spawn returned no stdout on Windows). */
async function readFuses(exe) {
  const { getCurrentFuseWire, FuseV1Options, FuseState } = require('@electron/fuses');
  const wire = await getCurrentFuseWire(exe);
  const out = {};
  for (const [k, v] of Object.entries(wire || {})) {
    if (k === 'version') continue;
    const name = FuseV1Options[k] || k;
    if (v === FuseState.ENABLE) out[name] = true;
    else if (v === FuseState.DISABLE) out[name] = false;
    // REMOVED / INHERIT are neither: left unreported → the declared-fuse check refuses loudly.
  }
  return out;
}

if (require.main === module) (async () => {
  const unpacked = path.resolve(ROOT, process.argv[2] || path.join('dist', 'win-unpacked'));
  const asarPath = path.join(unpacked, 'resources', 'app.asar');
  const exe = path.join(unpacked, 'ScanFinder.exe');
  if (!fs.existsSync(asarPath) || !fs.existsSync(exe)) { console.error(`[verify-release-artifact] ${unpacked} has no resources/app.asar + ScanFinder.exe — build first.`); process.exit(2); }
  const asar = require('@electron/asar');
  const entries = asar.listPackage(asarPath).map(e => String(e).replace(/\\/g, '/'));
  const read = (f) => { try { return asar.extractFile(asarPath, f.replace(/^\//, '')).toString('utf8'); } catch { return ''; } };
  const mainJs = read('/src/main.js');
  let pkg = {}; try { pkg = JSON.parse(read('/package.json')); } catch {}
  const htmlByPath = {};
  for (const e of entries) if (/\.html$/i.test(e)) htmlByPath[e] = read(e);
  const expectedFuses = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).build || {}).electronFuses || {};
  let fuses = {};
  try { fuses = await readFuses(exe); } catch (e) { console.error(`[verify-release-artifact] fuse read failed: ${e && e.message}`); }
  let smokeExit = null, smokeIdentity = null; const smokeSkipped = process.env.SKIP_SMOKE === '1';
  if (!smokeSkipped) {
    const sr = spawnSync(exe, ['--smoke-boot'], { cwd: unpacked, encoding: 'utf8', timeout: 60000, windowsHide: true });
    smokeExit = sr.error ? null : sr.status;
    try {
      const line = String(sr.stdout || '').split(/\r?\n/).find(l => l.startsWith('smoke-boot identity '));
      if (line) smokeIdentity = JSON.parse(line.slice('smoke-boot identity '.length));
    } catch { smokeIdentity = null; }
    try { for (const d of fs.readdirSync(require('os').tmpdir())) if (/^scanfinder-smoke-\d+$/.test(d)) fs.rmSync(path.join(require('os').tmpdir(), d), { recursive: true, force: true }); } catch {}
  } else console.log('[verify-release-artifact] SKIP_SMOKE=1 — the boot smoke was NOT run (say so in the release notes).');
  const testBuild = process.env.TEST_BUILD === '1';
  const problems = evaluate({ entries, mainJs, fuses, expectedFuses, smokeExit, smokeSkipped, pkg, testBuild, htmlByPath, smokeIdentity });
  const rev = pkg.buildRev || 'unknown';
  const installer = fs.existsSync(path.join(ROOT, 'dist')) ? fs.readdirSync(path.join(ROOT, 'dist')).filter(f => /\.(exe|appx)$/i.test(f) && f.includes(rev) && !/\.REFUSED\./.test(f)).map(f => path.join(ROOT, 'dist', f)) : [];
  const manifest = { rev, version: pkg.version, testBuild: !!pkg.testBuild, verifiedAt: new Date().toISOString(),
    fuses, smoke: smokeSkipped ? 'skipped' : smokeExit, asarEntries: entries.length,
    installers: installer.map(f => ({ file: path.basename(f), sha256: sha256(f) })), problems };
  try { fs.writeFileSync(path.join(ROOT, 'dist', `release-manifest-${rev}.json`), JSON.stringify(manifest, null, 2)); } catch {}
  if (problems.length) {
    // A refused release must not sit in dist/ looking shippable: rename the finished installer(s).
    for (const f of installer) { try { fs.renameSync(f, f.replace(/(\.(exe|appx))$/i, '.REFUSED$1')); } catch {} }
    console.error(`[verify-release-artifact] REFUSED — ${problems.length} problem(s) (installer renamed *.REFUSED.*):\n  ${problems.join('\n  ')}`); process.exit(1);
  }
  console.log(`[verify-release-artifact] OK — rev ${rev}: bytecode present, no plaintext modules, ${Object.keys(fuses).length} fuses read (${Object.keys(expectedFuses).length} declared, all as declared), boot smoke ${smokeSkipped ? 'skipped' : 'exit 0'}. Manifest dist/release-manifest-${rev}.json`);
})().catch((e) => { console.error(`[verify-release-artifact] crashed: ${e && e.stack || e}`); process.exit(1); });

module.exports = { evaluate, parseFuseText, readFuses, htmlAssetProblems, PLAINTEXT_FORBIDDEN, FUSE_NAMES };
