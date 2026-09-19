#!/usr/bin/env node
'use strict';
/**
 * test_migration163_deskew_false_absent_reflag.js — mig 163 seeds `deskew_false_absent_reflag` OFF (2026-09-12;
 * gary → Oracle: SEND BACK the note-DROP/auto-file "release" leg, SIGN OFF WITH CONDITIONS on this HOLD leg;
 * docs/designs/DESKEW_FALSE_ABSENT_REFLAG_2026-09-12.md). Phase-1: the straighten retry replaces a FALSE page-absent
 * note on a corroborated, unchanged role value with a truthful "— confirm once." hold. Removes no checkpoint.
 * Pins here (Electron-as-Node):
 *   1. mig stamped, seeded 'false', in TEST_SWITCH_KEYS, no force-ON twin, not in ALL_ON_DEFAULTS_93, a later
 *      manual ON survives the next start;
 *   2. the env bridge is NESTED under the parent deskew_review_retry_enabled (the C7 child pattern);
 *   3. Oracle P2 — the truthful note is a LANE-HOLD ("— confirm once.", handler._isLaneHoldNote family) AND is out
 *      of every classFixService CLEARABLE_NOTE_MARKS entry (bilingual: the Python note text vs the JS clearer set),
 *      so a role note is never machine-cleared and (being a role note) never soft → mig 142 cannot dissolve it;
 *   4. the RELEASE (auto-file) leg stays UNBUILT + its SEND-BACK conditions (H1 + C-Q2 value-parity + C-Q6) are
 *      recorded in dark_switches.js; the process_docs reflag path only REPLACES the note (never drops it, never
 *      writes _overall_confidence — the Q2 seam is not present).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration163_deskew_false_absent_reflag.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
const H = require(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'));
const classFix = require(path.join(ROOT, 'src', 'services', 'classFixService.js'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };
const KEY = 'deskew_false_absent_reflag', PARENT = 'deskew_review_retry_enabled';
const ENV = 'DESKEW_FALSE_ABSENT_REFLAG', PENV = 'DESKEW_REVIEW_RETRY';

// ── 1. the seed ──────────────────────────────────────────────────────────────────────────────────────
console.log('\n1. mig 163 seed');
const db = new Database(':memory:');
const logs = []; { const o = console.log; console.log = (m) => logs.push(String(m)); runMigrations(db); console.log = o; }
const get = (d, k) => { const r = d.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 163 stamped', applied.has(163));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 163 applied/.test(l) && /seeded OFF/.test(l)));
check(`a fresh (non-TEST) install ends with ${KEY} === 'false' (DARK)`, get(db, KEY) === 'false');
check(`${KEY} is in TEST_SWITCH_KEYS`, TEST_SWITCH_KEYS.includes(KEY));
check('TEST_SWITCH_KEYS is now 49 (+taught_ref_disagree_suppress mig 186 2026-09-19; +ref_badge_verify_state mig 185 2026-09-18; mig 163 + departments_enabled + mig 166 date-yield + mig 167 date_forms_wide; direct_intake_enabled graduated via mig 171 2026-09-15; name_role_nonname_flag + ref_confusable_flag + template_pad_date_adopt + watch_separate_enabled graduated via migs 172-175 2026-09-16, all delisted; +segment_pair_hold (180) 2026-09-17; segment_continuation_veto (177→181) + segment_title_slug (178→182) + segment_known_supplier_change (179→183) GRADUATED 2026-09-17 + delisted)', TEST_SWITCH_KEYS.length === 49);
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 163 is an INSERT OR IGNORE seed of false', new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${KEY}', 'false'\\)`).test(src));
check('NO numbered force-ON twin exists', !new RegExp(`VALUES \\('${KEY}', 'true'\\)`).test(src));
check('not in ALL_ON_DEFAULTS_93', !new RegExp(`ALL_ON_DEFAULTS_93 = \\[[\\s\\S]*?'${KEY}'[\\s\\S]*?\\];`).test(src));

// ── 2. the nested bridge ─────────────────────────────────────────────────────────────────────────────
console.log('\n2. _reconcileEnv nesting (child never outlives the parent)');
const setS = (d, k, v) => d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
setS(db, PARENT, 'false'); setS(db, KEY, 'true');
let e = H._reconcileEnv(db);
check('parent OFF + child ON → neither env var', !(PENV in e) && !(ENV in e));
setS(db, PARENT, 'true'); setS(db, KEY, 'false');
e = H._reconcileEnv(db);
check("parent ON + child OFF → parent '1', child absent", e[PENV] === '1' && !(ENV in e));
setS(db, KEY, 'true');
e = H._reconcileEnv(db);
check("both ON → both '1'", e[PENV] === '1' && e[ENV] === '1');
setS(db, KEY, 'true'); setS(db, PARENT, 'false');
quiet(() => runMigrations(db));
check("a later manual ON survives the next start (mig 137's one-shot reset never re-fires)", get(db, KEY) === 'true');

// ── 3. Oracle P2 — the truthful note: lane-hold + never machine-clearable (bilingual) ──────────────────
console.log('\n3. the truthful note (P2, bilingual)');
const pd = fs.readFileSync(path.join(ROOT, 'python_backend', 'process_docs.py'), 'utf8');
const m = pd.match(/_DESKEW_VERIFIED_NOTE\s*=\s*"([^"]+)"/);
check('_DESKEW_VERIFIED_NOTE is defined in process_docs.py', !!m);
const VN = m ? m[1].replace('{val}', 'DN-92961') : '';
check('the note is a lane-hold ("— confirm once.")', VN.includes('— confirm once.'));
check('the note is NOT in any classFixService CLEARABLE_NOTE_MARKS (never machine-cleared)',
      !classFix.CLEARABLE_NOTE_MARKS.some(mark => VN.includes(mark)), VN);
check('the note does NOT contain the Gate-C absent mark (it replaces it)', !VN.includes("doesn't appear on this page as written"));

// ── 4. the RELEASE (auto-file) leg is SEND BACK + its conditions recorded ──────────────────────────────
console.log('\n4. the release leg stays unbuilt; the send-back conditions are on the record');
const ds = fs.readFileSync(path.join(ROOT, 'database', 'dark_switches.js'), 'utf8');
check('dark_switches records the release leg as SEND BACK with H1 + the required-field value-parity (C-Q2)',
      /deskew_false_absent_reflag[\s\S]{0,1400}SEND BACK/.test(ds) && /deskew_false_absent_reflag[\s\S]{0,1400}value-parity/.test(ds));
check('the reflag call site REPLACES the note only — it never DROPS the note nor writes _overall_confidence',
      /_deskew_retry_false_absent_reflag/.test(pd)
      && /d0\["validation_note"\] = _DESKEW_VERIFIED_NOTE\.format\(val=now\)/.test(pd)
      && !/reflag[\s\S]{0,400}_overall_confidence\s*=/.test(pd));
check('no deskew_hold_release (auto-file) SWITCH exists (the send-back leg is not built) — a comment/census-path mention is fine',
      !TEST_SWITCH_KEYS.includes('deskew_hold_release')
      && !/INSERT OR IGNORE INTO settings \(key, value\) VALUES \('deskew_hold_release'/.test(src));

console.log(`\n${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} (${fails} bad)`);
process.exit(fails ? 1 : 0);
