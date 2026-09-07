#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration134_test_force_on.js — mig 134 is the TEST-BUILD force-ON of the five 2026-09-07
 * afternoon DARK switches (owner order "rebuild the app with all the new settings on"). Pins: the five seeds (129-133)
 * run BEFORE 134, a fresh install ends with all five 'true', the console line says TEST-BUILD, a later manual OFF
 * survives the next start. ⚠ Delete this pin with the migration when it is reverted before a customer build.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration134_test_force_on.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const KEYS = ['teach_angle_compose_null_abstain', 'reread_hold_corrob_release', 'template_date_left_clip_grow', 'template_pad_date_containment_flag', 'template_clip_commit_left_slack'];
const db = new Database(':memory:');
const logs = []; const origLog = console.log; console.log = (m) => { logs.push(String(m)); };
runMigrations(db);
console.log = origLog;
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migrations 129-134 stamped', [129, 130, 131, 132, 133, 134].every(v => applied.has(v)));
const i134 = logs.findIndex(l => /migration 134 applied/.test(l));
check('every seed (129-133) ran before 134', [129, 130, 131, 132, 133].every(v => { const i = logs.findIndex(l => new RegExp(`migration ${v} applied`).test(l)); return i >= 0 && i < i134; }));
check("a fresh install ends with all five === 'true' (the TEST build)", KEYS.every(k => get(k) === 'true'));
check('the 134 console line says TEST-BUILD', /TEST-BUILD/.test(logs[i134] || ''));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 134 carries the revert caveat', /migration 134:[\s\S]{0,900}TEST-ONLY \/ REVERSIBLE/.test(src));
db.prepare("UPDATE settings SET value = 'false' WHERE key = 'teach_angle_compose_null_abstain'").run();
console.log = () => {}; runMigrations(db); console.log = origLog;
check('a later manual OFF survives the next start', get('teach_angle_compose_null_abstain') === 'false');
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
