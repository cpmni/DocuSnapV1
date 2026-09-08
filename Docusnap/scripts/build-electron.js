'use strict';
/*
 * build-electron.js — the electron-builder invocation for BOTH the NSIS installer and the MSIX/Store
 * (appx) package, so the OPT-IN source-protection path (HARDEN_JS=1) protects them identically. The JS
 * bundling/bytecode + build_js/ files-remap is target-agnostic — the difference is only the
 * electron-builder target args.
 *
 *   npm run build                                   # NSIS, plain
 *   HARDEN_JS=1 HARDEN_JS_STRINGS=1 npm run build   # NSIS, hardened (bundle + V8 bytecode + string-array)
 *   npm run build:store                             # MSIX/appx, plain
 *   HARDEN_JS=1 HARDEN_JS_STRINGS=1 npm run build:store   # MSIX/appx, hardened (SAME protection as NSIS)
 *   HARDEN_JS=1 HARDEN_JS_NOBYTECODE=1 …            # bundle only (no bytecode)
 *
 * DEFAULT (HARDEN_JS unset): unchanged — the same electron-builder CLI the repo always used. Kill switch
 * for the hardened path = don't set HARDEN_JS (or git revert). Target = `node build-electron.js appx`
 * for the Store package, else NSIS.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGET = process.argv[2] === 'appx' ? 'appx' : 'nsis';
process.env.BUILD_REV = process.env.BUILD_REV || require('./build-rev').buildRev();
// TEST BUILD (TEST_BUILD=1): the artifact filename + About box carry -TEST and the packaged package.json
// carries extraMetadata.testBuild=true, which is what arms the DARK test switches at runtime
// (database/test_build_arming.js). A release build never sets either — the release gate
// (scripts/check-release-migrations.js) already refused any force-ON without TEST_BUILD=1.
const TEST_BUILD = process.env.TEST_BUILD === '1';
if (TEST_BUILD && !/-TEST$/.test(process.env.BUILD_REV)) process.env.BUILD_REV += '-TEST';
const HARDEN = process.env.HARDEN_JS === '1';

// electron-builder target args (+ the MSIX 4-part version, which the appx target requires).
const ebArgs = ['electron-builder', '--win'];
if (TARGET === 'appx') {
  ebArgs.push('appx', '--config.extraMetadata.buildRev=' + process.env.BUILD_REV,
              '--config.extraMetadata.version=' + require('./build-rev').msixVersion());
} else {
  ebArgs.push('--x64', '--config.extraMetadata.buildRev=' + process.env.BUILD_REV);
}
if (TEST_BUILD) ebArgs.push('--config.extraMetadata.testBuild=true');
const runBuilder = () => execFileSync('npx', ebArgs, { stdio: 'inherit', cwd: ROOT, env: process.env, shell: true });

if (!HARDEN) {
  runBuilder();                                    // plain path — unchanged
  process.exit(0);
}

// ── Hardened path (shared by NSIS + appx) ─────────────────────────────────────
// 1. Stage build_js/ (bundle, + bytecode unless HARDEN_JS_NOBYTECODE).
const hardenArgs = [path.join('scripts', 'harden-js.js')];
if (process.env.HARDEN_JS_NOBYTECODE !== '1') hardenArgs.push('--bytecode');
execFileSync(process.execPath, hardenArgs, { stdio: 'inherit', cwd: ROOT, env: process.env });

// 2. Remap `files` so src/ + database/ ship from build_js/ (the bundled tree), NOT the repo. electron-
//    builder still reads + MERGES package.json's `build.files`, so a programmatic override leaves the
//    crown-jewel source in the asar next to main.jsc — the only deterministic override is package.json
//    itself: swap build.files for the CLI build, restore the exact original bytes after. Applies to both
//    targets (electron-builder reads `files` regardless of --win nsis vs --win appx).
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
  runBuilder();
  console.log(`[build-electron] HARDENED ${TARGET} build complete.`);
} finally {
  fs.writeFileSync(pkgPath, origPkg);   // restore the exact original package.json regardless of outcome
}
