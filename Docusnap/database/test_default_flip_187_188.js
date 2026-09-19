'use strict';
/*
 * test_default_flip_187_188.js — migrations 187/188: trust_ref_role_shape (154) + template_drift_override_guard
 * (157) GRADUATE to customer defaults (2026-09-19, owner go after the flip census).
 *
 *   Flip census @ HEAD mig 186 over the 400 test docs of the 700 corpus
 *   (TESTING/_measure/flip_census_20260919/RESULT.md): BOTH M=0 (nothing right→wrong). 154 byte-identical on the
 *   corpus (live value = the 20 held Thornbury invoices); 157 sends 2/400 credit-notes to review with a
 *   "verify the total balances" note (ref+date still correct — fail-toward-review; live value = the CH1 2HU
 *   customer_name postcode-drift root fix). mig 187/188 UPSERT each to 'true'. This pin is the flip's home: a
 *   future dev cannot silently drop a flip, or re-list a key (which would let build_arming disarm it on a release
 *   launch), without going red.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/test_default_flip_187_188.js
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
  { key: 'trust_ref_role_shape',           seed: 154, flip: 187 },
  { key: 'template_drift_override_guard',  seed: 157, flip: 188 },
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

  console.log("3. kill durable — a deliberate 'false' AFTER the flip survives the next start (one-shot, not a sweep)");
  {
    const db = new Database(':memory:');
    quiet(() => runMigrations(db));
    db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(key);
    quiet(() => runMigrations(db));
    check(`${key} stays 'false' across a relaunch`, get(db, key) === 'false');
    db.close();
  }

  console.log('4. the key LEFT dark_switches.js (a listed key is disarmed on every release launch)');
  check(`${key} is not in TEST_SWITCH_KEYS`, !TEST_SWITCH_KEYS.includes(key));

  console.log('5. the flip is a labelled UPSERT migration the release gate accepts');
  {
    const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    check(`mig ${flip} block present + labelled @DEFAULT_FLIP directly above it`,
      new RegExp(`// @DEFAULT_FLIP ${flip}\\s*\\n\\s*if \\(!applied\\.has\\(${flip}\\)\\)`).test(src));
    check(`mig ${flip} UPSERTs ${key} to 'true'`,
      new RegExp(`INSERT INTO settings \\(key, value\\) VALUES \\('${key}', 'true'\\) ON CONFLICT\\(key\\) DO UPDATE SET value = 'true'`).test(src));
    const hits = scan({ indexSrc: src, otherFiles: [], pkgJson: {} }).hits.filter(h => new RegExp(key).test(String(h.detail)));
    check(`the release gate raises NO hit on ${key} (labelled + delisted = a legitimate default)`, hits.length === 0);
    if (hits.length) console.log('    ' + hits.map(h => `${h.belt}:${h.line} ${h.detail}`).join('\n    '));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
