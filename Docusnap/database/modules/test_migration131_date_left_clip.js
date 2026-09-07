#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration131_date_left_clip.js — mig 131 seeds `template_date_left_clip_grow` OFF
 * (gary A1 → Oracle C9-C11, 2026-09-07): a LEFT-cut one-digit-first-component date may grow (strict comparator).
 * DARK until the OFF→ON realdoc M=0 + fire census are read — pins: seeded 'false', NO force-ON twin, not in ALL_ON_DEFAULTS_93,
 * a later manual ON survives the next start.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration131_date_left_clip.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const db = new Database(':memory:');
const origLog = console.log; console.log = () => {};
runMigrations(db);
console.log = origLog;
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 131 stamped', applied.has(131));
check("a fresh install ends with template_date_left_clip_grow === 'false' (DARK)", get('template_date_left_clip_grow') === 'false');
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 131 is an INSERT OR IGNORE seed of false', /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('template_date_left_clip_grow', 'false'\)/.test(src));
check('NO force-ON twin exists', !/VALUES \('template_date_left_clip_grow', 'true'\)/.test(src));
check('not in ALL_ON_DEFAULTS_93', !/ALL_ON_DEFAULTS_93 = \[[\s\S]*?'template_date_left_clip_grow'[\s\S]*?\];/.test(src));
db.prepare("UPDATE settings SET value = 'true' WHERE key = 'template_date_left_clip_grow'").run();
console.log = () => {}; runMigrations(db); console.log = origLog;
check('a later manual ON survives the next start', get('template_date_left_clip_grow') === 'true');
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
