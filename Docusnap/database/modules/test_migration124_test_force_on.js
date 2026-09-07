#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration124_test_force_on.js
 * ---------------------------------------------------
 * The 2026-09-07 TEST BUILD ("rebuild the app with all the new settings on"): mig 124 FORCE-flips the 2026-09-04
 * arcs ON — confusion_precedence (119 seeds OFF), format_class_join (120 seeds OFF), resolve_ref_near_miss +
 * resolve_ref_positional (121 FORCES OFF). Pins the ORDER (121 before 124 — a fresh install must end ON), the
 * four keys, and the visible TEST-BUILD console line. ⚠ Delete this pin with the migration when it is reverted.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration124_test_force_on.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const KEYS = ['confusion_precedence', 'format_class_join', 'resolve_ref_near_miss', 'resolve_ref_positional'];
const db = new Database(':memory:');
const logs = [];
const origLog = console.log;
console.log = (m) => { logs.push(String(m)); };
runMigrations(db);
console.log = origLog;
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));

console.log('§1 a fresh install ends with the four switches ON');
for (const k of KEYS) check(`${k} === 'true'`, get(k) === 'true');
check('migrations 121 and 124 both stamped', applied.has(121) && applied.has(124));
const i121 = logs.findIndex(l => /migration 121 applied/.test(l)), i124 = logs.findIndex(l => /migration 124 applied/.test(l));
check('121 (force OFF) ran BEFORE 124 (force ON)', i121 >= 0 && i124 > i121);
check('the 124 console line says TEST-BUILD', /TEST-BUILD/.test(logs[i124] || ''));

console.log('§2 the source: marked TEST-ONLY / REVERSIBLE, exactly the four keys');
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
const blk = src.slice(src.indexOf('migration 124:'), src.indexOf('applied.has(124)') + 900);
check('the comment carries the revert caveat', /TEST-ONLY \/ REVERSIBLE/.test(blk));
check('the key list is exactly the four', KEYS.every(k => blk.includes(`'${k}'`)));

console.log('§3 an install that already had them ON by hand is untouched in effect, and a later manual OFF survives');
const db2 = new Database(':memory:');
console.log = () => {};
runMigrations(db2);
console.log = origLog;
db2.prepare("UPDATE settings SET value = 'false' WHERE key = 'confusion_precedence'").run();
console.log = () => {};
runMigrations(db2);
console.log = origLog;
check('a later manual OFF survives the next start (124 does not re-run)', db2.prepare("SELECT value FROM settings WHERE key = 'confusion_precedence'").get().value === 'false');

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
