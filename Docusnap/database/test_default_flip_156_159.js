'use strict';
/*
 * test_default_flip_156_159.js — migrations 172 + 173 + 174: the flip-census graduates of 2026-09-16.
 *
 *   mig 172  name_role_nonname_flag  (seeded OFF by mig 156)  — flag+hold a name-role field that reads as a bare
 *                                                                postcode / email / VAT / IBAN
 *   mig 173  ref_confusable_flag     (seeded OFF by mig 159)  — flag a class-outlier O/0, I/1, S/5 confusable on
 *                                                                the REF role so it can't auto-file a wrong filename
 *   mig 174  template_pad_date_adopt (seeded OFF by mig 143)  — swap a clipped taught date for the corroborated
 *                                                                wider read (the one adopt == GT, twice)
 *
 * All three passed the 700-doc flip census twice (2026-09-12 at mig 163, 2026-09-16 at mig 171): M=0, real fires
 * on the injected/real failure shapes, never a new wrong file (172/173 file→hold only; 174's single value change
 * is the correct date). The owner approved the customer-default flips on 2026-09-16. This pin is their home — a
 * future dev cannot silently drop a flip (returning customer installs to the silent-misfile behaviour) or re-list
 * a graduated key (which would let build_arming disarm it on the first release launch) without going red.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/test_default_flip_156_159.js
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
  { key: 'name_role_nonname_flag', seed: 156, flip: 172, env: 'NAME_ROLE_NONNAME_FLAG' },
  { key: 'ref_confusable_flag',    seed: 159, flip: 173, env: 'REF_CONFUSABLE_FLAG' },
  { key: 'template_pad_date_adopt', seed: 143, flip: 174, env: 'TEMPLATE_PAD_DATE_ADOPT' },
];

console.log('1. a fresh install has both graduates ON');
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  for (const f of FLIPS) {
    check(`${f.key} is 'true' for a new install`, get(db, f.key) === 'true');
    check(`mig ${f.flip} stamped`, !!db.prepare('SELECT 1 FROM migrations WHERE version = ?').get(f.flip));
  }
  db.close();
}

console.log('\n2. an existing install seeded false (mig 156 / 159) is flipped ON on upgrade');
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
    check(`mig ${f.flip} block present + labelled @DEFAULT_FLIP directly above it`,
      new RegExp(`// @DEFAULT_FLIP ${f.flip}\\s*\\n\\s*if \\(!applied\\.has\\(${f.flip}\\)\\)`).test(src));
    check(`mig ${f.flip} UPSERTs ${f.key} to 'true'`,
      new RegExp(`INSERT INTO settings \\(key, value\\) VALUES \\('${f.key}', 'true'\\) ON CONFLICT\\(key\\) DO UPDATE SET value = 'true'`).test(src));
    check(`mig ${f.seed} seed of 'false' is still an INSERT OR IGNORE (history kept for the upgrade path)`,
      new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${f.key}', 'false'\\)`).test(src));
  }
  const hits = scan({ indexSrc: src, otherFiles: [], pkgJson: {} }).hits;
  const mine = hits.filter(h => /17[234]/.test(String(h.detail)) || /name_role_nonname_flag|ref_confusable_flag|template_pad_date_adopt/.test(String(h.detail)));
  check('the release gate raises NO hit on migrations 172/173/174 (labelled + delisted = a legitimate default)', mine.length === 0);
  if (mine.length) console.log('    ' + mine.map(h => `${h.belt}:${h.line} ${h.detail}`).join('\n    '));
}

console.log('\n6. the Python bridge still reads the setting (the graduate is not a dead seed)');
{
  const hsrc = fs.readFileSync(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
  for (const f of FLIPS) {
    check(`handler maps ${f.key} → env.${f.env}`,
      new RegExp(`getSetting\\(db, '${f.key}', 'false'\\) === 'true'\\) env\\.${f.env} = '1'`).test(hsrc));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
