#!/usr/bin/env node
'use strict';
/**
 * test_migration162_deskew_field_adopt.js — mig 162 seeds `deskew_retry_field_adopt` OFF (2026-09-12; gary →
 * Oracle SIGN-OFF-W/COND C1-C11, docs/designs/DESKEW_RETRY_FIELD_ADOPT_2026-09-12.md). The review-bound straighten
 * retry gains a ROLE-note door + a field-scoped keyword-corroborated adopt (the Ridgeway #358 skew exhibit).
 * Pins here (Electron-as-Node):
 *   1. mig stamped, seeded 'false', in TEST_SWITCH_KEYS, no force-ON twin, not in ALL_ON_DEFAULTS_93, a later
 *      manual ON survives the next start (the mig-154 pin shape);
 *   2. the env bridge is NESTED under the parent (parent OFF + child ON → env absent; both ON → '1'; parent ON +
 *      child OFF → absent) — the C7 child-never-outlives-parent pattern;
 *   3. Oracle C7: on a GRADUATED scope with optional_soft_flag_autofile + corroboration_autofile +
 *      critfield_corrob_floor_relax ON, an ADOPTED ref-role row (TCA note, licensed mapping+keyword record, @82,
 *      shape-ok) is refused as `flagged`; the SAME row with the note stripped is ELIGIBLE — the note is the SOLE
 *      checkpoint (the 88 floor is relaxed for a licensed record), so it must always be written;
 *   4. Oracle C8: what a Quick (imageless) reprocess does to an adopted `template_mapping_corrobadopt` row — the
 *      IMAGELESS PRESERVE keeps the stored read (image family) and marks it CONTESTED on a non-taught key, keeps it
 *      silently on a taught key; a FULL reprocess lets the fresh read win (the arc then re-heals it when ON).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration162_deskew_field_adopt.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
const H = require(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'));
const trust = require(path.join(ROOT, 'database', 'modules', 'trust'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };
const KEY = 'deskew_retry_field_adopt', PARENT = 'deskew_review_retry_enabled';
const ENV = 'DESKEW_RETRY_FIELD_ADOPT', PENV = 'DESKEW_REVIEW_RETRY';

// ── 1. the seed ──────────────────────────────────────────────────────────────────────────────────────
console.log('\n1. mig 162 seed');
const db = new Database(':memory:');
const logs = []; { const o = console.log; console.log = (m) => logs.push(String(m)); runMigrations(db); console.log = o; }
const get = (d, k) => { const r = d.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 162 stamped', applied.has(162));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 162 applied/.test(l) && /seeded OFF/.test(l)));
check(`a fresh (non-TEST) install ends with ${KEY} === 'false' (DARK)`, get(db, KEY) === 'false');
check(`${KEY} is in TEST_SWITCH_KEYS (armed by the runtime test-build road)`, TEST_SWITCH_KEYS.includes(KEY));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 162 is an INSERT OR IGNORE seed of false', new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${KEY}', 'false'\\)`).test(src));
check('NO numbered force-ON twin exists', !new RegExp(`VALUES \\('${KEY}', 'true'\\)`).test(src));
check('not in ALL_ON_DEFAULTS_93', !new RegExp(`ALL_ON_DEFAULTS_93 = \\[[\\s\\S]*?'${KEY}'[\\s\\S]*?\\];`).test(src));
check('mig 162 carries its ⚑ FLIP GATE line + the HARD dep (mig 153 + template_pad_window_code)',
      /migration 162:[\s\S]{0,2400}FLIP GATE/.test(src) && /migration 162:[\s\S]{0,2400}template_taught_corrob_adopt/.test(src));
const ds = fs.readFileSync(path.join(ROOT, 'database', 'dark_switches.js'), 'utf8');
check('dark_switches names the HARD dep + the C10 mig-142 flip precondition',
      /deskew_retry_field_adopt[\s\S]{0,1600}template_taught_corrob_adopt/.test(ds) && /NAMED FLIP PRECONDITION[\s\S]{0,600}_isLaneHoldNote/.test(ds));

// ── 2. the nested bridge ─────────────────────────────────────────────────────────────────────────────
console.log('\n2. _reconcileEnv nesting (child never outlives the parent)');
const setS = (d, k, v) => d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
setS(db, PARENT, 'false'); setS(db, KEY, 'true');
let e = H._reconcileEnv(db);
check('parent OFF + child ON → neither env var', !(PENV in e) && !(ENV in e));
setS(db, PARENT, 'true'); setS(db, KEY, 'false');
e = H._reconcileEnv(db);
check("parent ON + child OFF → parent '1', child absent (parent output unchanged)", e[PENV] === '1' && !(ENV in e));
setS(db, KEY, 'true');
e = H._reconcileEnv(db);
check("both ON → both '1'", e[PENV] === '1' && e[ENV] === '1');
setS(db, KEY, 'true'); setS(db, PARENT, 'false');
quiet(() => runMigrations(db));
check("a later manual ON survives the next start (mig 137's one-shot reset never re-fires)", get(db, KEY) === 'true');

// ── 3. C7 — the note is the SOLE checkpoint on a graduated scope ─────────────────────────────────────
console.log('\n3. C7 — adopted ref-role row: note → flagged; note stripped → eligible');
function makeDb() {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE, ref_field_key TEXT, date_field_key TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT, label TEXT, type TEXT DEFAULT 'text', required INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, document_type_id INTEGER, status TEXT, confirmed_at TEXT, template_id INTEGER, overall_confidence INTEGER);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, display_value TEXT, raw_value TEXT, confidence INTEGER, extraction_method TEXT, validation_note TEXT, corrected_to TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, original_value TEXT, corrected_value TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  `);
  return d;
}
{
  const d = makeDb();
  const tid = d.prepare("INSERT INTO document_types (name, slug, ref_field_key, date_field_key) VALUES ('Worksheet','worksheet','reference_number','date')").run().lastInsertRowid;
  const add = (key, type, req) => d.prepare('INSERT INTO fields (document_type_id, key, type, required) VALUES (?,?,?,?)').run(tid, key, type, req ? 1 : 0);
  add('supplier_name', 'text', 1); add('date', 'date', 1); add('reference_number', 'text', 1);
  const seedDoc = ({ status = 'confirmed', when, conf = 100, fields }) => {
    const id = d.prepare('INSERT INTO documents (supplier_name, document_type_id, status, confirmed_at, template_id, overall_confidence) VALUES (?,?,?,?,?,?)')
      .run('Ridgeway Plant Hire', tid, status, when, 16, conf).lastInsertRowid;
    for (const [k, v] of Object.entries(fields))
      d.prepare('INSERT INTO extractions (document_id, field_key, display_value, confidence, extraction_method) VALUES (?,?,?,?,?)').run(id, k, v, null, 'keyword');
    return id;
  };
  for (let i = 1; i <= 12; i++)   // a GRADUATED scope: 12 clean confirms, WS-##### refs (the learned code shape)
    seedDoc({ when: `2026-06-01T10:00:${String(i).padStart(2, '0')}Z`,
              fields: { supplier_name: 'Ridgeway Plant Hire', date: `0${(i % 9) + 1}-06-2026`, reference_number: `WS-${73600 + i}` } });
  const docId = seedDoc({ status: 'needs_review', when: '2026-09-12T10:00:00Z', conf: 98,
                          fields: { supplier_name: 'Ridgeway Plant Hire', date: '13-04-2026', reference_number: 'WS-73673' } });
  const doc = { ...d.prepare('SELECT * FROM documents WHERE id = ?').get(docId), overall_confidence: 98 };
  for (const k of ['optional_soft_flag_autofile', 'corroboration_autofile', 'critfield_corrob_floor_relax']) setS(d, k, 'true');
  const t = trust.scopeTrust(d, 'Ridgeway Plant Hire', 'worksheet');
  check('precondition: the scope is graduated', t.trusted === true, JSON.stringify(t));
  const LIC = '{"winner_family":"mapping","agree":["keyword"],"disagree":[],"independent_agree":true}';
  const TCA = "Corrected from the taught box's clipped read to 'WS-73673' — an independent reading of the page agrees. Please confirm.";
  const rows = (note) => ([
    { field_key: 'supplier_name',    display_value: 'Ridgeway Plant Hire', confidence: 95, extraction_method: 'template_fixed' },
    { field_key: 'date',             display_value: '13-04-2026', confidence: 96, extraction_method: 'template_mapping' },
    { field_key: 'reference_number', display_value: 'WS-73673', confidence: 82, extraction_method: 'template_mapping_corrobadopt',
      validation_note: note, corroboration: LIC },
  ]);
  const opts = (note) => ({ extractions: rows(note), templateMatched: true, critFieldCorrobRelax: true, optionalSoftFlag: true });
  const held = trust.isAutoFileEligible(d, doc, opts(TCA));
  check("with the TCA note the adopted row is refused as 'flagged' (mig 142 + corrob autofile + floor relax all ON)",
        held.eligible === false && held.reason === 'flagged', JSON.stringify(held));
  const open = trust.isAutoFileEligible(d, doc, opts(null));
  check('the SAME row with the note stripped is ELIGIBLE (@82 < 88 relaxed by the licensed+shape-matched record) — the note is the SOLE checkpoint',
        open.eligible === true, JSON.stringify(open));
  const lane = trust.isAutoFileEligible(d, doc, opts("Read differently after straightening — was 'VS-72672', now 'WS-73673' — confirm once."));
  check("the deskew lane-hold note on the ref ROLE is also 'flagged' under mig 142 (a role note is never soft)",
        lane.eligible === false && lane.reason === 'flagged', JSON.stringify(lane));
  d.close();
}

// ── 4. C8 — what a Quick (imageless) reprocess does to an adopted row ────────────────────────────────
console.log('\n4. C8 — Quick reprocess on an adopted template_mapping_corrobadopt row');
{
  const ex = { field_key: 'reference_number', raw_value: 'WS-73673', display_value: 'WS-73673', confidence: 82,
               extraction_method: 'template_mapping_corrobadopt',
               validation_note: "Corrected from the taught box's clipped read to 'WS-73673' — an independent reading of the page agrees. Please confirm.",
               corrected_to: null };
  const fresh = { field_key: 'reference_number', display_value: 'VS-72672', confidence: 95, extraction_method: 'template_mapping',
                  validation_note: "'VS-72672' doesn't appear on this page as written — please check the reference before filing." };
  const contested = [], stats = {};
  const q = H._mergeReprocessRows([ex], [{ ...fresh }], null, null, null, { imageless: true, taughtKeys: new Set(), contestedOut: contested, stats });
  check('Quick (imageless), non-taught key: the stored adopted read is KEPT (image family) …', q[0].display_value === 'WS-73673');
  check('… and marked CONTESTED (held out of consent/auto-accept), not silently filed',
        contested.length === 1 && contested[0].field === 'reference_number' && stats.imagelessKept === 1);
  const contested2 = [];
  const qt = H._mergeReprocessRows([ex], [{ ...fresh }], null, null, null, { imageless: true, taughtKeys: new Set(['reference_number']), contestedOut: contested2, stats: {} });
  check('Quick (imageless), TAUGHT key: kept silently (operator-blessed key abstains)', qt[0].display_value === 'WS-73673' && contested2.length === 0);
  const full = H._mergeReprocessRows([ex], [{ ...fresh }]);
  check('FULL reprocess: the fresh read wins (VS-72672 + its absent note → still held; the arc re-heals it when ON)',
        full[0].display_value === 'VS-72672' && /doesn't appear on this page/.test(String(full[0].validation_note || '')));
}

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
