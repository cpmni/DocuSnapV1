'use strict';
/*
 * test_default_flip_206.js — migration 206: ref_confusable_confirmed_literal_disarm (seeded OFF by mig 204)
 * GRADUATES to a customer default (2026-09-22, owner "flip mig 204"). A reference that EXACTLY equals a
 * scope-confirmed literal the <3-distinct format index can't hold no longer nags (>=2 confirms disarm fully;
 * a SINGLE confirm drops the nag but caps <=69, still held). Supplier-strict. HARD dep ref_confusable_flag.
 *
 *   Vet: the behaviour is pinned by python_backend/tests/test_ref_confusable_confirmed_literal_disarm.py (6/6,
 *   incl. the cross-supplier isolation + the 1-confirm cap). The flip census (M=0 / byte-identical-inert on the
 *   700 corpus) is TESTING/_measure/ref_disarm_census_20260922/RESULT.md — the owner accepted the narrow
 *   >=2-confirm auto-file LIFT path. Same flip-home contract as test_default_flip_203.js.
 *   Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/test_default_flip_206.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('./index');
const { TEST_SWITCH_KEYS } = require('./dark_switches');
const { scan } = require(path.join(REPO, 'scripts', 'check-release-migrations'));

let pass = 0, fail = 0;
const check = (n, ok) => { if (ok) { pass++; console.log(`  ok  ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };
const get = (db, k) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) || {}).value;
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };

const key = 'ref_confusable_confirmed_literal_disarm', seed = 204, flip = 206;

console.log(`== ${key} (mig ${seed} seed → mig ${flip} flip) ==`);

console.log('1. a fresh install has it ON');
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  check(`${key} is 'true' for a new install`, get(db, key) === 'true');
  check(`migs ${flip} + ${seed} both stamped`,
    !!db.prepare('SELECT 1 FROM migrations WHERE version = ?').get(flip) && !!db.prepare('SELECT 1 FROM migrations WHERE version = ?').get(seed));
  db.close();
}

console.log(`2. an existing install seeded false (mig ${seed}) is flipped ON on upgrade`);
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(key);
  db.prepare('DELETE FROM migrations WHERE version = ?').run(flip);
  quiet(() => runMigrations(db));
  check(`the mig-${seed} 'false' is UPSERT-flipped to 'true' by mig ${flip}`, get(db, key) === 'true');
  db.close();
}

console.log("3. kill durable — a deliberate 'false' AFTER the flip survives the next start");
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(key);
  quiet(() => runMigrations(db));
  check(`${key} stays 'false' across a relaunch`, get(db, key) === 'false');
  db.close();
}

console.log('4. the key LEFT dark_switches.js');
check(`${key} is not in TEST_SWITCH_KEYS`, !TEST_SWITCH_KEYS.includes(key));

console.log('5. the flip is a labelled UPSERT migration the release gate accepts');
{
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  check(`mig ${flip} block present + labelled @DEFAULT_FLIP directly above it`,
    new RegExp(`// @DEFAULT_FLIP ${flip}\\s*\\n\\s*if \\(!applied\\.has\\(${flip}\\)\\)`).test(src));
  check(`mig ${flip} UPSERTs ${key} to 'true'`,
    new RegExp(`INSERT INTO settings \\(key, value\\) VALUES \\('${key}', 'true'\\) ON CONFLICT\\(key\\) DO UPDATE SET value = 'true'`).test(src));
  const hits = scan({ indexSrc: src, otherFiles: [], pkgJson: {} }).hits.filter(h => new RegExp(key).test(String(h.detail)));
  check(`the release gate raises NO hit on ${key}`, hits.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
