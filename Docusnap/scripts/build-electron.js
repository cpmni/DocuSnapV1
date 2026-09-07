'use strict';
/*
 * build-electron.js — the electron-builder invocation, factored out of the inline `node -e` so the
 * OPT-IN source-protection path (HARDEN_JS=1, Build 2/3) can remap `files` to ship the bundled +
 * bytecoded main process from build_js/.
 *
 *   npm run build                 # default — byte-identical to the old inline invocation
 *   HARDEN_JS=1 npm run build     # bundle + V8-bytecode the main process (needs a live packaged smoke)
 *   HARDEN_JS=1 HARDEN_JS_NOBYTECODE=1 npm run build   # Build 2 only (bundle, no bytecode)
 *
 * DEFAULT (HARDEN_JS unset): unchanged — spawns the same electron-builder CLI the repo always used, so a
 * normal release is identical. Kill switch for the hardened path = don't set HARDEN_JS (or git revert).
 */
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.env.BUILD_REV = process.env.BUILD_REV || require('./build-rev').buildRev();
const HARDEN = process.env.HARDEN_JS === '1';

if (!HARDEN) {
  // Unchanged default path.
  execFileSync('npx', ['electron-builder', '--win', '--x64',
      '--config.extraMetadata.buildRev=' + process.env.BUILD_REV],
    { stdio: 'inherit', cwd: ROOT, env: process.env, shell: true });
  process.exit(0);
}

// ── Hardened path ─────────────────────────────────────────────────────────────
// 1. Stage build_js/ (bundle, + bytecode unless HARDEN_JS_NOBYTECODE).
const hardenArgs = [path.join('scripts', 'harden-js.js')];
if (process.env.HARDEN_JS_NOBYTECODE !== '1') hardenArgs.push('--bytecode');
execFileSync(process.execPath, hardenArgs, { stdio: 'inherit', cwd: ROOT, env: process.env });

// 2. Build with `files` remapped so src/ + database/ come from build_js/ (the bundled tree) — NOT the repo.
//    The programmatic-config approach was WRONG: electron-builder still reads package.json's `build` field
//    and MERGES it, so the repo's `src/**` + `database/**` shipped ALONGSIDE the bundle (the crown-jewel
//    source landed in the asar next to main.jsc). The only deterministic override is package.json itself:
//    swap build.files to the build_js remap for the CLI build, then restore the EXACT original bytes.
const fs = require('fs');
const pkgPath = path.join(ROOT, 'package.json');
const origPkg = fs.readFileSync(pkgPath, 'utf8');
const pkgObj = JSON.parse(origPkg);
pkgObj.build.files = [
  { from: 'build_js/src', to: 'src', filter: ['**/*'] },
  { from: 'build_js/database', to: 'database', filter: ['**/*'] },
  'assets/**/*',
  'package.json',
  '!**/test_*.js',
  '!**/*.test.js',
  '!**/__tests__/**',
  '!**/*.map',
];
fs.writeFileSync(pkgPath, JSON.stringify(pkgObj, null, 2) + '\n');
try {
  execFileSync('npx', ['electron-builder', '--win', '--x64',
      '--config.extraMetadata.buildRev=' + process.env.BUILD_REV],
    { stdio: 'inherit', cwd: ROOT, env: process.env, shell: true });
  console.log('[build-electron] HARDENED build complete.');
} finally {
  fs.writeFileSync(pkgPath, origPkg);   // restore the exact original package.json regardless of outcome
}
