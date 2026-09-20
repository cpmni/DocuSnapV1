'use strict';
/*
 * test_default_flip_191.js — migration 191: taught_ref_disagree_suppress (mig 186 seed)
 * GRADUATES to a customer default (2026-09-20, owner go after the live VM verify).
 *
 *   Live-proven on the owner's VM: the Castellan "Service Worksheet" batch (a taught custom REF field winning
 *   over the page's different-shape "Job Ref" competitor) filed 4/4 on confirm instead of holding forever.
 *   Corpus census M=0 (SAFETY, TESTING/_measure/flip_census_20260919/RESULT.md — the synthetic corpus does not
 *   exercise it). mig 191 UPSERTs it to 'true'. Same flip-home contract as test_default_flip_189_190.js.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/test_default_flip_191.js
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

const FLIPS = [
  { key: 'taught_ref_disagree_suppress', seed: 186, flip: 191 },
];

for (const { key, seed, flip } of FLIPS) {
  console.log(`\n== ${key} (mig ${seed} seed → mig ${flip} flip) ==`);

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
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
