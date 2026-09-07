#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration133_clip_left_slack.js — mig 133 seeds `template_clip_commit_left_slack` OFF
 * (2026-09-07; the Oracle-signed trailing slack mirrored): the leading-glyph mirror of the trailing clip-commit edge slack.
 * DARK until its OFF→ON realdoc M=0 + fire census are read — pins: seeded 'false', NO force-ON twin, not in ALL_ON_DEFAULTS_93,
 * a later manual ON survives the next start.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration133_clip_left_slack.js
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
check('migration 133 stamped', applied.has(133));
check("a fresh install ends with template_clip_commit_left_slack === 'false' (DARK)", get('template_clip_commit_left_slack') === 'false');
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 133 is an INSERT OR IGNORE seed of false', /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('template_clip_commit_left_slack', 'false'\)/.test(src));
check('NO force-ON twin exists', !/VALUES \('template_clip_commit_left_slack', 'true'\)/.test(src));
check('not in ALL_ON_DEFAULTS_93', !/ALL_ON_DEFAULTS_93 = \[[\s\S]*?'template_clip_commit_left_slack'[\s\S]*?\];/.test(src));
db.prepare("UPDATE settings SET value = 'true' WHERE key = 'template_clip_commit_left_slack'").run();
console.log = () => {}; runMigrations(db); console.log = origLog;
check('a later manual ON survives the next start', get('template_clip_commit_left_slack') === 'true');
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
