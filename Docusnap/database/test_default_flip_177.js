'use strict';
/*
 * test_default_flip_177.js — migration 181: segment_continuation_veto GRADUATES to a customer default (2026-09-17, owner go).
 *
 *   mig 177 seeded it 'false' (DARK, 2026-09-16; Oracle (B) slice 1) — a page that declares itself a continuation
 *   ("Page 2 of 2", "continued", "brought forward") is never cut off as a new document by the multi-document separator.
 *   Gate (C8) green: 0/14 repeat-letterhead controls cut, stacks + real_34 lost-vs-base 0, end-to-end truncation 0.
 *   mig 181 UPSERTs it to 'true'. This pin is the flip's home — a future dev cannot silently drop the flip (returning
 *   customer installs to the silent truncation) or re-list the key (which would let build_arming disarm it on the first
 *   release launch) without going red.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/test_default_flip_177.js
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
const KEY = 'segment_continuation_veto', SEED = 177, FLIP = 181;

console.log('1. a fresh install has the veto ON');
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  check(`${KEY} is 'true' for a new install`, get(db, KEY) === 'true');
  check(`mig ${FLIP} stamped (and mig ${SEED} too — the seed history is kept)`, !!db.prepare('SELECT 1 FROM migrations WHERE version = ?').get(FLIP) && !!db.prepare('SELECT 1 FROM migrations WHERE version = ?').get(SEED));
  db.close();
}

console.log(`\n2. an existing install seeded false (mig ${SEED}) is flipped ON on upgrade`);
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(KEY);
  db.prepare('DELETE FROM migrations WHERE version = ?').run(FLIP);
  quiet(() => runMigrations(db));
  check(`the mig-${SEED} 'false' is UPSERT-flipped to 'true' by mig ${FLIP}`, get(db, KEY) === 'true');
  db.close();
}

console.log("\n3. kill durable — a deliberate 'false' AFTER the flip survives the next start (one-shot, not a sweep)");
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(KEY);
  quiet(() => runMigrations(db));
  check(`${KEY} stays 'false' across a relaunch`, get(db, KEY) === 'false');
  db.close();
}

console.log('\n4. the key LEFT dark_switches.js (a listed key is disarmed on every release launch)');
check(`${KEY} is not in TEST_SWITCH_KEYS`, !TEST_SWITCH_KEYS.includes(KEY));

console.log('\n5. the flip is a labelled UPSERT migration that the release gate accepts');
{
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  check(`mig ${FLIP} block present + labelled @DEFAULT_FLIP directly above it`, new RegExp(`// @DEFAULT_FLIP ${FLIP}\\s*\\n\\s*if \\(!applied\\.has\\(${FLIP}\\)\\)`).test(src));
  check(`mig ${FLIP} UPSERTs ${KEY} to 'true'`, new RegExp(`INSERT INTO settings \\(key, value\\) VALUES \\('${KEY}', 'true'\\) ON CONFLICT\\(key\\) DO UPDATE SET value = 'true'`).test(src));
  check(`mig ${SEED} seed of 'false' is still an INSERT OR IGNORE (history kept for the upgrade path)`, new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${KEY}', 'false'\\)`).test(src));
  const hits = scan({ indexSrc: src, otherFiles: [], pkgJson: {} }).hits.filter(h => /\b18[01]\b|\b177\b/.test(String(h.detail)) || /segment_continuation_veto/.test(String(h.detail)));
  check(`the release gate raises NO hit on migrations ${SEED}/${FLIP} (labelled + delisted = a legitimate default)`, hits.length === 0);
  if (hits.length) console.log('    ' + hits.map(h => `${h.belt}:${h.line} ${h.detail}`).join('\n    '));
}

console.log('\n6. the switch is still LIVE — the handler reads the setting into the pre-pass argv (argv is the only kill)');
{
  const hsrc = fs.readFileSync(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
  check("_separationOpts reads segment_continuation_veto (default 'false' — the row exists after mig 181)", /continuationVeto: learn\.getSetting\(db, 'segment_continuation_veto', 'false'\) === 'true'/.test(hsrc));
  const sp = fs.readFileSync(path.join(REPO, 'src', 'modules', 'processing', 'split_plan.js'), 'utf8');
  check('buildSegmentArgs emits --continuation-veto when ON', sp.includes("if (continuationVeto) args.push('--continuation-veto');"));
  const seg = fs.readFileSync(path.join(REPO, 'python_backend', 'ocr', 'segmentation.py'), 'utf8');
  check('segmentation applies the veto only for i > 0 (page 0 is always document 1)', seg.includes('bool(continuation_veto and i > 0 and is_continuation_page(text))'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
