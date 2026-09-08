#!/usr/bin/env node
'use strict';
/**
 * scripts/test_verify_release_artifact.js — pins the post-build verifier's pure evaluate()/parseFuseText()
 * (slice 2.6 of docs/designs/AUDIT_FIX_PLAN_2026-09-08.md): bytecode present, stub main.js, no plaintext
 * module under src/modules|services|lib|database while preload + windows stay plain, every declared fuse
 * matches, the boot smoke must exit 0 (or be skipped LOUDLY), and the test-build identity both ways.
 *
 *   node scripts/test_verify_release_artifact.js
 */
const path = require('path');
const { evaluate, parseFuseText } = require(path.join(__dirname, 'verify-release-artifact.js'));
let pass = 0, fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log(`  OK  ${n}`); } else { fail++; console.log(`  FAIL ${n}${extra ? ' — ' + extra : ''}`); } };
const has = (probs, re) => probs.some(p => re.test(p));

const FUSE_TEXT = `Analyzing app: ScanFinder.exe
Fuse Version: 1
  RunAsNode is Disabled
  EnableCookieEncryption is Enabled
  EnableNodeOptionsEnvironmentVariable is Disabled
  EnableNodeCliInspectArguments is Disabled
  EnableEmbeddedAsarIntegrityValidation is Enabled
  OnlyLoadAppFromAsar is Enabled
`;
const expectedFuses = { runAsNode: false, enableCookieEncryption: true, enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false, enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true };
const GOOD = {
  entries: ['/package.json', '/src/main.js', '/src/main.jsc', '/src/preload.js', '/src/windows/main/renderer.js', '/src/windows/shared/theme.css', '/config/keyword_patterns.json'],
  mainJs: "'use strict';\nrequire('bytenode');\nmodule.exports = require('./main.jsc');\n",
  fuses: parseFuseText(FUSE_TEXT), expectedFuses, smokeExit: 0, pkg: { version: '2.0.0', buildRev: '20260908-1500-abc1234' }, testBuild: false,
};

console.log('verify-release-artifact:');
check('parseFuseText reads Enabled/Disabled lines', GOOD.fuses.RunAsNode === false && GOOD.fuses.OnlyLoadAppFromAsar === true && Object.keys(GOOD.fuses).length === 6);
check('a good hardened release artifact has no problems', evaluate(GOOD).length === 0, evaluate(GOOD).join(' | '));
check('missing /src/main.jsc → not hardened', has(evaluate({ ...GOOD, entries: GOOD.entries.filter(e => e !== '/src/main.jsc') }), /main\.jsc missing/));
check('a real main.js (not the stub) → refused', has(evaluate({ ...GOOD, mainJs: "const { app } = require('electron');" }), /not the bytenode stub/));
check('a readable database/modules/trust.js → refused', has(evaluate({ ...GOOD, entries: [...GOOD.entries, '/database/modules/trust.js'] }), /readable module/));
check('a readable src/lib/license/token.js → refused', has(evaluate({ ...GOOD, entries: [...GOOD.entries, '/src/lib/license/token.js'] }), /readable module/));
check('preload.js + src/windows/** plain source are allowed by design', !has(evaluate(GOOD), /readable module/));
check('a fuse flipped the wrong way → refused', has(evaluate({ ...GOOD, fuses: { ...GOOD.fuses, OnlyLoadAppFromAsar: false } }), /OnlyLoadAppFromAsar is Disabled/));
check('a declared fuse not reported → refused', has(evaluate({ ...GOOD, fuses: (({ RunAsNode, ...rest }) => rest)(GOOD.fuses) }), /RunAsNode not reported/));
check('boot smoke exit 3 → refused (bricking class)', has(evaluate({ ...GOOD, smokeExit: 3 }), /boot-smoke/));
check('boot smoke timeout (null) → refused', has(evaluate({ ...GOOD, smokeExit: null }), /boot-smoke/));
check('SKIP_SMOKE is honoured (loud, not a failure)', !has(evaluate({ ...GOOD, smokeExit: null, smokeSkipped: true }), /boot-smoke/));
check('a testBuild package.json on a RELEASE verify → refused', has(evaluate({ ...GOOD, pkg: { ...GOOD.pkg, testBuild: true } }), /identity: .*testBuild=true/));
check('TEST_BUILD=1 verify of a package.json WITHOUT testBuild → refused (metadata did not bake)', has(evaluate({ ...GOOD, testBuild: true }), /lacks testBuild/));
check('TEST_BUILD=1 verify of a test build passes', evaluate({ ...GOOD, testBuild: true, pkg: { ...GOOD.pkg, testBuild: true } }).length === 0);
// Source pins: the --smoke-boot road in src/main.js (throwaway userData BEFORE the single-instance lock; exit inside whenReady).
const fs = require('fs');
const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const iSmokeDir = mainSrc.indexOf('scanfinder-smoke-'), iLock = mainSrc.indexOf('app.requestSingleInstanceLock()'), iExit = mainSrc.search(/if \(_smokeBoot\) \{\s*\r?\n\s*try \{\s*\r?\n?\s*getDb\(\);/);
check('main.js re-points userData to a scanfinder-smoke-<pid> temp dir BEFORE the single-instance lock', iSmokeDir > 0 && iLock > iSmokeDir);
check('main.js exits the smoke inside whenReady right after the DB open (getDb + app.exit(0))', iExit > iLock && /app\.exit\(0\)/.test(mainSrc.slice(iExit, iExit + 700)));
check('the smoke prints the resolved arming identity (build_arming.resolveIdentity) for the verifier', /smoke-boot identity ' \+ JSON\.stringify\(require\('\.\.\/database\/build_arming'\)\.resolveIdentity\(\)\)/.test(mainSrc));
// HTML asset belt (eric re-audit 2026-09-08): every shipped .html's relative script/link/img must be an asar entry.
const { htmlAssetProblems } = require(path.join(__dirname, 'verify-release-artifact.js'));
const ENTRIES = ['/src/windows/review/index.html', '/src/windows/review/renderer.js', '/src/windows/shared/theme.js', '/src/windows/shared/reviewReadiness.js'];
const HTML_OK = { '/src/windows/review/index.html': '<link rel="stylesheet" href="../shared/theme.css"><script src="../shared/theme.js"></script><script src="../shared/reviewReadiness.js"></script><script src="renderer.js"></script><script src="https://cdn.example/x.js"></script>' };
check('html-asset: a page whose script refs all resolve passes (external/absolute refs ignored)', htmlAssetProblems([...ENTRIES, '/src/windows/shared/theme.css'], HTML_OK).length === 0);
const HTML_BAD = { '/src/windows/review/index.html': '<script src="../shared/theme.js"></script><script src="../shared/listCaption.js"></script>' };
check('html-asset: a deleted renderer-served script (the hardened-build P0) → refused, naming the resolved path', (() => { const p = htmlAssetProblems(ENTRIES, HTML_BAD); return p.length === 1 && /\/src\/windows\/shared\/listCaption\.js/.test(p[0]); })());
check('evaluate() runs the asset belt when htmlByPath is given', has(evaluate({ ...GOOD, htmlByPath: HTML_BAD }), /html-asset/));
check('identity: the smoke-resolved buildRev must equal the packaged package.json (bundle can see the manifest)', has(evaluate({ ...GOOD, smokeIdentity: { testBuild: false, buildRev: 'packaged' } }), /cannot see the packaged package\.json/) && !has(evaluate({ ...GOOD, smokeIdentity: { testBuild: false, buildRev: GOOD.pkg.buildRev } }), /identity:/));
console.log(`\nverify-release-artifact: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
