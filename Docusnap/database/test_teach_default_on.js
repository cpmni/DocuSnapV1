'use strict';
/*
 * test_teach_default_on.js — migration 170: teach-over-client ON by default (2026-09-15 owner decision).
 *
 * mig 168 seeded teach_over_client_enabled 'false'; mig 170 UPSERT-forces it 'true', so a new OR existing
 * install has remote teaching from the search client enabled out of the box (still admin + entitlement +
 * license gated at the /v1 routes; a deliberate 'false' still turns it off). This pin is its home: a
 * future dev cannot silently drop the flip (returning customer installs to teach-off) without going red.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/test_teach_default_on.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('./index');

let pass = 0, fail = 0;
const check = (n, ok) => { if (ok) { pass++; console.log(`  ok  ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const get = (db, k) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) || {}).value;

console.log('1. a fresh install has teach-over-client ON');
{
  const db = new Database(':memory:');
  runMigrations(db);
  check("teach_over_client_enabled is 'true' for a new install", get(db, 'teach_over_client_enabled') === 'true');
  check('mig 170 stamped', !!db.prepare('SELECT 1 FROM migrations WHERE version = 170').get());
  db.close();
}

console.log('\n2. an existing install seeded false by mig 168 is flipped ON on upgrade');
{
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("UPDATE settings SET value='false' WHERE key='teach_over_client_enabled'").run();
  db.prepare('DELETE FROM migrations WHERE version=170').run();
  runMigrations(db);
  check('the mig-168 false is UPSERT-flipped to true', get(db, 'teach_over_client_enabled') === 'true');
  db.close();
}

console.log('\n3. the flip is a real UPSERT migration in index.js');
{
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  check('mig 170 block present', /applied\.has\(170\)/.test(src));
  check("UPSERTs teach_over_client_enabled to 'true'",
    /INSERT INTO settings \(key, value\) VALUES \('teach_over_client_enabled', 'true'\) ON CONFLICT\(key\) DO UPDATE SET value = 'true'/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
