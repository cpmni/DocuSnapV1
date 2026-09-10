#!/usr/bin/env node
'use strict';
/**
 * test_migration158_note_topic_dedup.js — mig 158 seeds `note_topic_dedup` OFF (2026-09-10 night; gary →
 * Oracle SIGN-OFF-W/COND). composeNote collapses stacked same-topic ref-recheck notes to one. DARK; the JS
 * merge sites read the setting directly (getSetting), so there is NO Python env-map for it. Pins: mig stamped,
 * seeded 'false', IN TEST_SWITCH_KEYS, NO force-ON twin, not in ALL_ON_DEFAULTS_93, a later manual ON survives.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration158_note_topic_dedup.js
 */
const path = require('path'), fs = require('fs'), Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };
const db = new Database(':memory:');
const logs = []; const orig = console.log; console.log = (m) => { logs.push(String(m)); };
runMigrations(db); console.log = orig;
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 158 stamped', applied.has(158));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 158 applied/.test(l) && /seeded OFF/.test(l)));
check('fresh install: note_topic_dedup === false', get('note_topic_dedup') === 'false');
check('in TEST_SWITCH_KEYS', TEST_SWITCH_KEYS.includes('note_topic_dedup'));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('INSERT OR IGNORE seed of false', /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('note_topic_dedup', 'false'\)/.test(src));
check('NO force-ON twin', !/VALUES \('note_topic_dedup', 'true'\)/.test(src));
check('not in ALL_ON_DEFAULTS_93', !/ALL_ON_DEFAULTS_93 = \[[\s\S]*?'note_topic_dedup'[\s\S]*?\];/.test(src));
check('composeNote helper exists + reads the setting via getSetting (JS-main, no Python env)',
      fs.existsSync(path.join(ROOT, 'src', 'modules', 'processing', 'composeNote.js'))
      && /getSetting\(db, 'note_topic_dedup', 'false'\)/.test(fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'composeNote.js'), 'utf8')));
db.prepare("UPDATE settings SET value = 'true' WHERE key = 'note_topic_dedup'").run();
console.log = () => {}; runMigrations(db); console.log = orig;
check('a later manual ON survives the next start', get('note_topic_dedup') === 'true');
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
