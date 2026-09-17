'use strict';
/*
 * test_default_flip_178_179.js — migrations 182 + 183: the separator's title cascade and known-supplier-change rule
 * GRADUATE to customer defaults (2026-09-17 evening, owner go).
 *
 *   mig 182  segment_title_slug             (seeded OFF by mig 178) — the separator reads each page's own printed title
 *                                                                     before matching it (a cascade that can never lose
 *                                                                     today's boundary); stacks 72 → 79/95, 0 lost
 *   mig 183  segment_known_supplier_change  (seeded OFF by mig 179) — a page naming a DIFFERENT known supplier + a
 *                                                                     labelled number/date starts a new document;
 *                                                                     stacks 79 → 91/95, 0 lost, 0 over-splits
 *
 * Gates: docs/designs/SEPARATOR_ACCURACY_2026-09-16.md + TESTING/_measure/watch_separate_soak_20260916/RESULT.md (census with
 * the shipped functions, controls1-5, real_34 34/34, the owner's own PDFs, the e2e truncation metric 0). This pin is the
 * flips' home — a future dev cannot silently drop a flip or re-list a graduated key (which would let build_arming disarm
 * it on the first release launch) without going red.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/test_default_flip_178_179.js
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
  { key: 'segment_title_slug',            seed: 178, flip: 182, flag: '--title-slug' },
  { key: 'segment_known_supplier_change', seed: 179, flip: 183, flag: '--known-supplier-change' },
];

console.log('1. a fresh install has both graduates ON');
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  for (const f of FLIPS) {
    check(`${f.key} is 'true' for a new install`, get(db, f.key) === 'true');
    check(`mig ${f.flip} stamped (and the mig-${f.seed} seed history kept)`, !!db.prepare('SELECT 1 FROM migrations WHERE version = ?').get(f.flip) && !!db.prepare('SELECT 1 FROM migrations WHERE version = ?').get(f.seed));
  }
  db.close();
}

console.log('\n2. an existing install seeded false (mig 178 / 179) is flipped ON on upgrade');
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  for (const f of FLIPS) {
    db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(f.key);
    db.prepare('DELETE FROM migrations WHERE version = ?').run(f.flip);
  }
  quiet(() => runMigrations(db));
  for (const f of FLIPS) check(`the mig-${f.seed} 'false' is UPSERT-flipped to 'true' by mig ${f.flip}`, get(db, f.key) === 'true');
  db.close();
}

console.log("\n3. kill durable — a deliberate 'false' AFTER the flip survives the next start (one-shot, not a sweep)");
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  for (const f of FLIPS) db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(f.key);
  quiet(() => runMigrations(db));
  for (const f of FLIPS) check(`${f.key} stays 'false' across a relaunch`, get(db, f.key) === 'false');
  db.close();
}

console.log('\n4. both keys LEFT dark_switches.js (a listed key is disarmed on every release launch)');
for (const f of FLIPS) check(`${f.key} is not in TEST_SWITCH_KEYS`, !TEST_SWITCH_KEYS.includes(f.key));

console.log('\n5. the flips are labelled UPSERT migrations that the release gate accepts');
{
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  for (const f of FLIPS) {
    check(`mig ${f.flip} block present + labelled @DEFAULT_FLIP directly above it`, new RegExp(`// @DEFAULT_FLIP ${f.flip}\\s*\\n\\s*if \\(!applied\\.has\\(${f.flip}\\)\\)`).test(src));
    check(`mig ${f.flip} UPSERTs ${f.key} to 'true'`, new RegExp(`INSERT INTO settings \\(key, value\\) VALUES \\('${f.key}', 'true'\\) ON CONFLICT\\(key\\) DO UPDATE SET value = 'true'`).test(src));
    check(`mig ${f.seed} seed of 'false' is still an INSERT OR IGNORE (history kept for the upgrade path)`, new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${f.key}', 'false'\\)`).test(src));
  }
  const hits = scan({ indexSrc: src, otherFiles: [], pkgJson: {} }).hits.filter(h => /\b1(?:7[89]|8[23])\b/.test(String(h.detail)) || /segment_title_slug|segment_known_supplier_change/.test(String(h.detail)));
  check('the release gate raises NO hit on migrations 178/179/182/183 (labelled + delisted = a legitimate default)', hits.length === 0);
  if (hits.length) console.log('    ' + hits.map(h => `${h.belt}:${h.line} ${h.detail}`).join('\n    '));
}

console.log('\n6. the switches are still LIVE — the handler reads each setting into the pre-pass argv (argv is the only kill)');
{
  const hsrc = fs.readFileSync(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
  check("_separationOpts reads segment_title_slug (default 'false' — the row exists after mig 182)", /titleSlug: learn\.getSetting\(db, 'segment_title_slug', 'false'\) === 'true'/.test(hsrc));
  check("_separationOpts reads segment_known_supplier_change and asks learning.getKnownSupplierNames at minConfirms 3", /learn\.getSetting\(db, 'segment_known_supplier_change', 'false'\) === 'true'/.test(hsrc) && /learn\.getKnownSupplierNames\(db, \{ minConfirms: 3 \}\)/.test(hsrc));
  const sp = fs.readFileSync(path.join(REPO, 'src', 'modules', 'processing', 'split_plan.js'), 'utf8');
  check('buildSegmentArgs emits --title-slug (with the doc-types file) and the known-supplier pair when ON',
    sp.includes("if (titleSlug && docTypesFile) {") && sp.includes("args.push('--known-suppliers-file', knownSuppliersFile, '--known-supplier-change');"));
  const py = fs.readFileSync(path.join(REPO, 'python_backend', 'segment_docs.py'), 'utf8');
  for (const f of FLIPS) check(`segment_docs.py takes ${f.flag}`, py.includes(`"${f.flag}"`));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
