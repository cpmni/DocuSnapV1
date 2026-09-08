#!/usr/bin/env node
'use strict';
/**
 * scripts/build-release.js — the ONE build orchestrator (pre-deployment audit 2026-09-07 P0-3; plan
 * docs/designs/AUDIT_FIX_PLAN_2026-09-08.md §3 slice 2.7; Oracle C5). Composes the env deterministically
 * and runs the gates in order, so a release can never ship plaintext JS, a test-build force-ON, an open
 * HIGH advisory, or an unbootable artifact by a forgotten shell variable.
 *
 *   node scripts/build-release.js nsis            # RELEASE installer (hardened, gates, verified)
 *   node scripts/build-release.js appx            # RELEASE Store package (hardened, gates; no smoke — unsigned appx)
 *   node scripts/build-release.js nsis --test     # TEST build: plain, TEST_BUILD=1, artifact + About box say -TEST
 *
 * RELEASE env: SET  HARDEN_JS=1 HARDEN_JS_STRINGS=1 RELEASE_BUILD=1 CSC_IDENTITY_AUTO_DISCOVERY=false (SIGN=1 inverts —
 *              post-incorporation signing is one switch); DELETE TEST_BUILD SHIP_PY_SOURCE HARDEN_JS_NOBYTECODE
 *              (a shell's leftover test env must not leak in). HARDEN_JS=0 in the shell stays an explicit
 *              plain-release escape for bisecting (printed loudly). SKIP_SMOKE / AUDIT_OFFLINE_OK are scrubbed too;
 *              --skip-smoke / --audit-offline-ok are the only (loud) re-enables.
 *              SIGNING: CSC_IDENTITY_AUTO_DISCOVERY only silences electron-builder's keychain hunt (and the vendor-binary
 *              signtool EBUSY trap); Windows Authenticode signing is WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (or a
 *              signtoolOptions block) once the owner holds an OV/EV cert — SIGN=1 does not sign by itself.
 * TEST env:    today's plain path + TEST_BUILD=1 + BUILD_REV=<rev>-TEST (build-electron.js bakes
 *              extraMetadata.testBuild=true → the DARK test switches arm at runtime).
 * Order:       1 check-release-migrations → 2 check-vendor-python → 3 check-licenses → 4 check-npm-audit (release)
 *              → 5 compile-python-bytecode → 6 test_no_shipped_py_source → 7 build-electron → 8 verify-release-artifact (release nsis)
 * Pre-flight + post-flight: package.json must be clean in git (build-electron.js swaps build.files and restores in
 * `finally`; a Ctrl-C between the two leaves it swapped).
 */
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

/** composeEnv(mode, base) → a NEW env object. mode = 'release' | 'test'. Pure. */
function composeEnv(mode, base = process.env) {
  const env = { ...base };
  if (mode === 'test') {
    env.TEST_BUILD = '1';
    delete env.RELEASE_BUILD;
    if (!env.BUILD_REV) env.BUILD_REV = require('./build-rev').buildRev();
    if (!/-TEST$/.test(env.BUILD_REV)) env.BUILD_REV += '-TEST';
    return env;
  }
  // Every variable that WEAKENS a gate is scrubbed from the inherited shell (re-audit 2026-09-08: a leftover
  // SKIP_SMOKE=1 / AUDIT_OFFLINE_OK=1 silently degraded two gates). Re-enable only by explicit CLI flag.
  for (const k of ['TEST_BUILD', 'SHIP_PY_SOURCE', 'HARDEN_JS_NOBYTECODE', 'SKIP_SMOKE', 'AUDIT_OFFLINE_OK', 'HARDEN_JS_ESCAPE']) delete env[k];
  env.RELEASE_BUILD = '1';
  if (env.HARDEN_JS === '0') { env.HARDEN_JS_ESCAPE = '1'; delete env.HARDEN_JS; delete env.HARDEN_JS_STRINGS; }   // explicit plain-release escape (bisecting) — set AFTER the scrub above
  else { env.HARDEN_JS = '1'; env.HARDEN_JS_STRINGS = '1'; }
  env.CSC_IDENTITY_AUTO_DISCOVERY = env.SIGN === '1' ? 'true' : 'false';
  if (env.BUILD_REV && /-TEST$/.test(env.BUILD_REV)) env.BUILD_REV = env.BUILD_REV.replace(/-TEST$/, '');
  return env;
}

/** gateSequence(mode, target) → [[script, args]] in run order. Pure. */
function gateSequence(mode, target = 'nsis') {
  const seq = [
    ['scripts/check-release-migrations.js', []],
    ['scripts/check-vendor-python.js', []],
    ['scripts/check-licenses.js', []],
  ];
  if (mode === 'release') seq.push(['scripts/check-npm-audit.js', []]);
  seq.push(['scripts/compile-python-bytecode.js', []], ['scripts/test_no_shipped_py_source.js', []]);
  seq.push(['scripts/build-electron.js', target === 'appx' ? ['appx'] : []]);
  // The verifier reads dist/win-unpacked, which BOTH targets pack from — the Store artifact gets the same
  // source-protection / fuse / boot-smoke / html-asset gate (re-audit 2026-09-08: it had none).
  if (mode === 'release') seq.push(['scripts/verify-release-artifact.js', []]);
  return seq;
}

/** applyFlags(env, argv) → env with the explicit, LOUD re-enables (after the scrub). Pure. */
function applyFlags(env, argv = []) {
  const out = { ...env };
  if (argv.includes('--skip-smoke')) out.SKIP_SMOKE = '1';
  if (argv.includes('--audit-offline-ok')) out.AUDIT_OFFLINE_OK = '1';
  return out;
}

function packageJsonClean() {
  try { execFileSync('git', ['diff', '--quiet', '--', 'package.json'], { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const target = args.includes('appx') ? 'appx' : 'nsis';
  const mode = args.includes('--test') ? 'test' : 'release';
  const env = applyFlags(composeEnv(mode, process.env), args);
  const tag = mode === 'test' ? 'TEST build' : (env.HARDEN_JS_ESCAPE ? 'RELEASE build — HARDEN_JS=0 ESCAPE: PLAINTEXT JS (bisecting only)' : 'RELEASE build (hardened)');
  const flags = [env.SKIP_SMOKE === '1' ? 'SKIP_SMOKE' : '', env.AUDIT_OFFLINE_OK === '1' ? 'AUDIT_OFFLINE_OK' : ''].filter(Boolean);
  console.log(`[build-release] ${tag} · target ${target} · BUILD_REV ${env.BUILD_REV || '(from build-rev.js)'} · signing ${env.CSC_IDENTITY_AUTO_DISCOVERY === 'true' ? 'ON' : 'off'}${flags.length ? ' · WEAKENED BY FLAG: ' + flags.join(', ') : ''}`);
  if (!packageJsonClean()) { console.error('[build-release] package.json is dirty in git — commit or restore it first (build-electron.js swaps build.files during the pack).'); process.exit(1); }
  for (const [script, sargs] of gateSequence(mode, target)) {
    console.log(`\n[build-release] ▶ ${script} ${sargs.join(' ')}`);
    const r = spawnSync(process.execPath, [path.join(ROOT, script), ...sargs], { cwd: ROOT, env, stdio: 'inherit' });
    if (r.status !== 0) { console.error(`[build-release] ✖ ${script} exited ${r.status} — build refused.`); process.exit(r.status || 1); }
  }
  if (!packageJsonClean()) { console.error('[build-release] package.json was left modified by the pack (the build.files swap did not restore) — `git checkout -- package.json` and investigate.'); process.exit(1); }
  console.log(`\n[build-release] ✔ ${tag} complete.`);
}

module.exports = { composeEnv, gateSequence, applyFlags };
