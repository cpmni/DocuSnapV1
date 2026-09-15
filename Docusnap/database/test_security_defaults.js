'use strict';
/*
 * test_security_defaults.js — migration 169: the two 2026-09-15 security fixes enforced BY DEFAULT.
 *
 * WHY IT EXISTS. Both fixes shipped DARK (byte-identical OFF) the night of 2026-09-15 and each was
 * recommended ON by its designer. Mig 169 seeds them '1' so every install enforces (fail-secure):
 *   • v1_force_password_change  — a never-changed temp-password /v1 session is refused (A1, eric)
 *   • backup_import_seat_only   — a backup restore needs a verified paid seat (Chris card 7, gary)
 * Value is '1' (read `=== '1'`), NOT the 'true' engine-switch convention, so these are not in the
 * ALL_ON_DEFAULTS promotion lists. This pin is their home: a future dev cannot silently drop the seed
 * (turning a customer install back into the vulnerable default) without going red here.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/test_security_defaults.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('./index');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };
const get = (db, k) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) || {}).value;
const KEYS = ['v1_force_password_change', 'backup_import_seat_only'];

console.log('\n1. a fresh install enforces both security fixes by default');
{
  const db = new Database(':memory:');
  runMigrations(db);
  for (const k of KEYS) check(`${k} is '1' (enforced) for a new install`, get(db, k) === '1');
  check('mig 169 is stamped', !!db.prepare('SELECT 1 FROM migrations WHERE version = 169').get());
  db.close();
}

console.log('\n2. an existing install is upgraded on next start; a deliberate OFF is respected');
{
  const db = new Database(':memory:');
  runMigrations(db);
  // Simulate an admin who deliberately turned one OFF, and pretend 169 never ran, then upgrade.
  db.prepare("UPDATE settings SET value = '0' WHERE key = 'v1_force_password_change'").run();
  db.prepare("DELETE FROM settings WHERE key = 'backup_import_seat_only'").run();  // key absent (pre-169 state)
  db.prepare('DELETE FROM migrations WHERE version = 169').run();
  runMigrations(db);
  check('a deliberately-disabled switch stays OFF (INSERT OR IGNORE respects a choice)', get(db, 'v1_force_password_change') === '0');
  check('an absent key is seeded ON on upgrade (the hole closes)', get(db, 'backup_import_seat_only') === '1');
  db.close();
}

console.log('\n3. the seed is a real migration in index.js, both keys named');
{
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  check('mig 169 block present', /applied\.has\(169\)/.test(src));
  for (const k of KEYS) check(`${k} seeded '1' in mig 169`, new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${k}', '1'\\)`).test(src));
}

console.log('\n4. both keys have a live consumer (no dead seed)');
{
  const readers = ['src/modules/api/handler.js', 'src/modules/settings/handler.js']
    .map(f => fs.readFileSync(path.join(REPO, f), 'utf8')).join('\n');
  for (const k of KEYS) check(`${k} is read by a consumer`, readers.includes(`'${k}'`));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
