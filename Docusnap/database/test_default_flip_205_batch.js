'use strict';
/*
 * test_default_flip_205_batch.js — migration 205: the 2026-09-22 BATCH graduation. Owner directive: "flip any
 * that are deemed safe or currently inert and I will test — the software is only with test clients … they can
 * report any issues." 34 fail-toward-review DARK switches (recover-into-review / flag / hold-more / evidence-
 * gated soften / presentation / refuse / abstain — none can cause a NEW *silent* wrong file) become customer
 * defaults and LEAVE dark_switches.js in the same commit. All 34 are a subset of the 37-key HEAL union censused
 * M=0 on the 605 corpus at RR_APP_ENV=1 (TESTING/_measure/flip_census_20260921/).
 *
 * Pins, for EVERY flipped key: fresh install ON · an existing 'false' is UPSERT-flipped ON on upgrade · a
 * deliberate 'false' AFTER the flip survives (kill durable, mig 205 one-shot) · the key LEFT TEST_SWITCH_KEYS.
 * Plus: the @DEFAULT_FLIP 205 block shape the release gate accepts, and the gate raises 0 hits. And the
 * INVARIANT that the 10 held-out keys STAY dark (listed + default OFF). (mig-204's disarm was flipped ON at mig 206.)
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/test_default_flip_205_batch.js
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

const FLIP = [
  'format_variance_relax', 'template_fragment_containment_yield', 'template_locate_role_qualifier',
  'format_variance_relax_ref', 'format_variance_relax_ref_inline', 'filing_sanity_ref_corrob_soften',
  'resolve_ref_near_miss', 'resolve_ref_positional', 'filing_sanity_ref_history_soften',
  'anchor_bare_label_fuzzy', 'anchor_labelless_currency_refuse', 'type_uninstalled_heading_fold',
  'teach_angle_compose_null_abstain', 'template_date_left_clip_grow', 'template_pad_date_containment_flag',
  'template_clip_commit_left_slack', 'inline_disagree_corrob_soften', 'template_name_grow_band_pick',
  'template_name_cut_defer_cap', 'keyword_superstring_name_note', 'template_code_read_widen',
  'type_split_teach_scope_suppress', 'sweep_inview_recheck', 'template_edge_clip_heal',
  'role_disagree_refuse_at100', 'template_taught_corrob_adopt', 'anchor_axis_lock',
  'filing_sanity_ref_reinstate', 'template_code_left_grow', 'deskew_retry_field_adopt',
  'deskew_false_absent_reflag', 'template_date_invalid_yield_lowconf', 'date_forms_wide',
  'ref_badge_verify_state',
];
// Held out of the batch (still DARK): the auto-file looseners, value-changers, the feature master,
// segmentation, and the two ungated arcs. Every one of these MUST stay listed + default OFF.
// (ref_confusable_confirmed_literal_disarm left HELD when it was flipped ON at mig 206, 2026-09-22.)
const HELD = [
  'deskew_corrob_autofile', 'optional_soft_flag_autofile', 'corrob_autofile_band88',
  'filing_sanity_confusable_prefix_autofile', 'confusion_precedence', 'buyer_issued_convention_one_confirm',
  'format_class_join', 'departments_enabled', 'segment_pair_hold', 'issuer_undetected_blank',
  // added AFTER the mig-205 batch (not part of it): new DARK keys, seeded OFF by their own migrations.
  'corrob_date_fold_wide',         // mig 208, 2026-09-23 — worded-date corroboration fold
  'recon_singlechar_misread_flag', // mig 209, 2026-09-23 — arithmetic-witness single-digit total misread
  'quiet_redetect_on_type_change', // mig 216, 2026-09-24 evening 2 — a type/override change re-reads the held unrecognised docs on the Quick road (DARK)
  'issuer_sibling_dominant_hold',  // mig 218, 2026-09-25 — Tier C converging-siblings issuer hold (Chris card 5)
  'type_owner_uninstalled_block',  // mig 217, 2026-09-25 — an uninstalled shipped title BLOCKS the owner-precedence steal (Ironclad statements typed Invoice)
  'keyword_label_tail_bound',      // mig 219, 2026-09-25 — a multi-word label stops prefix-hitting its own printed heading (Chris card 4)
  'glyph_confusable_release',      // mig 211, 2026-09-23 — second-reader agree + wide re-read POPS the soften note (auto-file loosener; yield 1/9 → stays DARK)
  // (glyph_fallback_enabled 207, glyph_confusable_resolve 210, glyph_slice_integrity 212, name_value_label_flag 213,
  //  taught_name_disagree_refuse 214 GRADUATED via the 215 batch, 2026-09-24 evening — see test_default_flip_215.js.)
];

console.log('== mig 205 BATCH graduation (34 fail-toward-review switches) ==');

console.log(`0. the batch is exactly ${FLIP.length} keys and the two sets are disjoint + cover the list`);
check('FLIP is 34 distinct keys', new Set(FLIP).size === 34);
check('HELD is 17 distinct keys', new Set(HELD).size === 17);   // 16 → 17: keyword_label_tail_bound (mig 219, 2026-09-25)   // 15 → 16: issuer_sibling_dominant_hold (mig 218, 2026-09-25)   // 14 → 15: type_owner_uninstalled_block (mig 217, 2026-09-25)
check('FLIP ∩ HELD = ∅', FLIP.every(k => !HELD.includes(k)));
check('TEST_SWITCH_KEYS == HELD (every flipped key delisted, every held key kept)',
  TEST_SWITCH_KEYS.length === 17 && HELD.every(k => TEST_SWITCH_KEYS.includes(k)) && TEST_SWITCH_KEYS.every(k => HELD.includes(k)));

console.log('1. a fresh install has every flipped key ON, every held key OFF');
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  check('migs 205 + 204 both stamped', !!db.prepare('SELECT 1 FROM migrations WHERE version = 205').get() && !!db.prepare('SELECT 1 FROM migrations WHERE version = 204').get());
  const notOn = FLIP.filter(k => get(db, k) !== 'true');
  check(`all 34 flipped keys are 'true' on a fresh install${notOn.length ? ' — ' + notOn.join(',') : ''}`, notOn.length === 0);
  const notOff = HELD.filter(k => get(db, k) !== 'false');
  check(`all 10 held keys are 'false' on a fresh install${notOff.length ? ' — ' + notOff.join(',') : ''}`, notOff.length === 0);
  db.close();
}

console.log('2. an existing install with the flipped keys OFF is upgraded ON by mig 205');
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  for (const k of FLIP) db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(k);
  db.prepare('DELETE FROM migrations WHERE version = 205').run();
  quiet(() => runMigrations(db));
  const notOn = FLIP.filter(k => get(db, k) !== 'true');
  check(`mig 205 UPSERT-flips all 34 to 'true' on upgrade${notOn.length ? ' — ' + notOn.join(',') : ''}`, notOn.length === 0);
  db.close();
}

console.log("3. kill durable — a deliberate 'false' after the flip survives the next start");
{
  const db = new Database(':memory:');
  quiet(() => runMigrations(db));
  db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(FLIP[0]);
  quiet(() => runMigrations(db));
  check(`${FLIP[0]} stays 'false' across a relaunch (mig 205 one-shot)`, get(db, FLIP[0]) === 'false');
  db.close();
}

console.log('4. the flip is a labelled UPSERT block the release gate accepts (0 hits)');
{
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  check('// @DEFAULT_FLIP 205 sits directly above if (!applied.has(205))',
    /\/\/ @DEFAULT_FLIP 205\s*\n\s*if \(!applied\.has\(205\)\)/.test(src));
  check('mig 205 block writes true by UPSERT',
    /VALUES \(\?, 'true'\) ON CONFLICT\(key\) DO UPDATE SET value = 'true'/.test(src));
  const hits = scan({ indexSrc: src, otherFiles: [], pkgJson: {} }).hits;
  check('the release gate raises 0 hits on database/index.js', hits.length === 0);
  // and no flipped key still appears in TEST_SWITCH_KEYS (belt v cannot fire on them)
  check('no flipped key remains in TEST_SWITCH_KEYS', FLIP.every(k => !TEST_SWITCH_KEYS.includes(k)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
