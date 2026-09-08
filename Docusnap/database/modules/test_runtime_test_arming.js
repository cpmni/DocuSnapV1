#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_runtime_test_arming.js — pins database/build_arming.js (slice 1.4 of
 * docs/designs/AUDIT_FIX_PLAN_2026-09-08.md; Oracle C2/C3): the runtime road that replaced the numbered
 * TEST-BUILD force-ON migrations.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_runtime_test_arming.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
const arming = require(path.join(ROOT, 'database', 'build_arming'));
const { scan } = require(path.join(ROOT, 'scripts', 'check-release-migrations'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };
const get = (db, k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const allAre = (db, v) => TEST_SWITCH_KEYS.every(k => get(db, k) === v);
const REL = { testBuild: false, buildRev: '20260908-1200-abc1234' };
const REL2 = { testBuild: false, buildRev: '20260909-0900-def5678' };
const T1 = { testBuild: true, buildRev: '20260908-1300-abc1234-TEST' };
const T2 = { testBuild: true, buildRev: '20260908-1400-bbb2222-TEST' };

// Fresh DB through the real runMigrations road with an injected identity.
const db = new Database(':memory:');
quiet(() => runMigrations(db, { identity: REL }));
check('release identity on a fresh DB: every test switch OFF, no marker', allAre(db, 'false') && get(db, arming.MARKER) === null);
check("money_sign_capture stays 'true' (not a test switch)", get(db, 'money_sign_capture') === 'true');

const untouchedBefore = { msc: get(db, 'money_sign_capture'), opi: get(db, 'ocr_parallel_import_enabled') };   // mig 93 default / mig 139 promotion
let r = arming.armTestSwitches(db, T1);
check('test build T1 arms every switch + stamps the marker', r.action === 'armed' && allAre(db, 'true') && get(db, arming.MARKER) === T1.buildRev);
r = arming.armTestSwitches(db, T1);
check('same test rev again: noop', r.action === 'noop');
db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(TEST_SWITCH_KEYS[3]);
r = arming.armTestSwitches(db, T1);
check("an operator's OFF made after arming stands on the same test rev", r.action === 'noop' && get(db, TEST_SWITCH_KEYS[3]) === 'false');
r = arming.armTestSwitches(db, T2);
check('a NEW test rev re-arms everything', r.action === 'armed' && allAre(db, 'true') && get(db, arming.MARKER) === T2.buildRev);
check('money_sign_capture (mig 93 default) + ocr_parallel_import_enabled (mig 139 promotion) untouched by arming', get(db, 'money_sign_capture') === untouchedBefore.msc && get(db, 'ocr_parallel_import_enabled') === untouchedBefore.opi && untouchedBefore.msc === 'true');

r = arming.armTestSwitches(db, REL);
check('a release build after a test build DISARMS once + drops the marker (the reference-DB road, C3)', r.action === 'disarmed' && allAre(db, 'false') && get(db, arming.MARKER) === null);
r = arming.armTestSwitches(db, REL);
check('release again: noop (no marker)', r.action === 'noop');

// The SFDEV / interim road: marker written as manual@<rev of the build that wrote it>.
db.prepare("UPDATE settings SET value = 'true' WHERE key = ?").run(TEST_SWITCH_KEYS[0]);
arming.writeArmMarker(db, 'manual@' + REL.buildRev);
r = arming.armTestSwitches(db, REL);
check("an SFDEV hand on THIS release build is never fought (same rev → noop, the switch stays ON)", r.action === 'noop' && get(db, TEST_SWITCH_KEYS[0]) === 'true');
r = arming.armTestSwitches(db, REL2);
check('…but a DIFFERENT release build disarms it (marker from another build)', r.action === 'disarmed' && allAre(db, 'false') && get(db, arming.MARKER) === null);

// Dev: stable rev 'dev' — a new commit never disarms the owner's dev DB.
arming.armTestSwitches(db, { testBuild: true, buildRev: 'dev' });
r = arming.armTestSwitches(db, { testBuild: false, buildRev: 'dev' });
check("plain dev after `TEST_BUILD=1 npm start`: noop (marker 'dev' == rev 'dev'); explicit --off is the dev disarm road", r.action === 'noop' && allAre(db, 'true'));
r = arming.disarmTestSwitches(db);
check('disarmTestSwitches (the --off road) forces OFF + drops the marker', r.action === 'disarmed' && allAre(db, 'false') && get(db, arming.MARKER) === null);

// resolveIdentity under Electron-as-Node = not packaged → dev.
const id = arming.resolveIdentity();
check("resolveIdentity() under Electron-as-Node: rev 'dev', testBuild follows TEST_BUILD env", id.buildRev === 'dev' && id.testBuild === (process.env.TEST_BUILD === '1'));
check('markerRev strips the manual@ prefix', arming.markerRev('manual@r9') === 'r9' && arming.markerRev('r9') === 'r9' && arming.markerRev(null) === null);

// Source pins.
const idx = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('runMigrations calls armTestSwitches after the JS migrations (unstamped, every start)', /runJsMigrations\(db, applied\);[\s\S]{0,1200}armTestSwitches\(db,/.test(idx));
const sh = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'settings', 'handler.js'), 'utf8');
check('set-setting stamps the manual@<rev> marker when an SFDEV hand turns a listed key ON (C3)', /TEST_SWITCH_KEYS\.includes\(key\)[\s\S]{0,300}writeArmMarker\(db, ['`]manual@/.test(sh));
const be = fs.readFileSync(path.join(ROOT, 'scripts', 'build-electron.js'), 'utf8');
check('build-electron.js bakes extraMetadata.testBuild + a -TEST rev only under TEST_BUILD=1', /TEST_BUILD === '1'/.test(be) && /extraMetadata\.testBuild=true/.test(be) && /-TEST/.test(be));
const armSrc = fs.readFileSync(path.join(ROOT, 'database', 'build_arming.js'), 'utf8');
// Positive control (Oracle re-vet 2026-09-08): a 0-hits result is only meaningful if scan() actually FIRES.
const _plantArm = "db.prepare(\"INSERT OR REPLACE INTO settings (key,value) VALUES ('" + TEST_SWITCH_KEYS[0] + "','true')\").run();";
check('positive control: scan() CATCHES a planted key-write in build_arming.js (belt vi) — not a dead guard', scan({ indexSrc: '', otherFiles: [{ file: 'database/build_arming.js', src: _plantArm }] }).hits.some(h => h.belt === 'vi'));
check('the arming module carries no key literal (the release gate cannot be bypassed through it)', scan({ indexSrc: '', otherFiles: [{ file: 'database/build_arming.js', src: armSrc }] }).hits.length === 0);
check('repo package.json has no testBuild', !Object.prototype.hasOwnProperty.call(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')), 'testBuild'));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
