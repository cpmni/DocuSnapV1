'use strict';
/*
 * test_rewrite_marker_exclusion.js — Slice 0 + the invariant that killed Slice 1.
 * (gary design → Oracle SPLIT ruling 2026-08-19: SIGN-OFF-W/COND on Slice 0, SEND BACK on Slice 1.)
 *
 * THE HOLE. The engine writes SIX corpus-derived rewrite markers; the learned-format query excluded
 * THREE. `+snapped` — the Stage-2.5d dominant snap, which rewrites a value to the confirmed dominant
 * with NO page witness — plus `+snap_corrob`, `+name_corrob_adopt` and `+prefix_confusable_adopt`
 * had no clause at all. So a value the corpus produced voted for the belief that produced it.
 *
 * And it was ALREADY OPEN on the HUMAN channel, which is the part that makes it urgent rather than
 * theoretical: a human who confirms a snapped document without editing it writes no corrections row,
 * so the row counts, marker and all. The machine-confirm exclusion was masking it, not preventing it.
 *
 * THE INVARIANT, stated once here because it is what makes the whole design fall out:
 *   1. a REFUSAL test may use the fullest evidence available (human + all machine);
 *   2. a LICENSING / rewrite-permission test may use human-attested evidence only;
 *   3. NEITHER may use evidence that a rewrite created;
 *   4. an index serving both roles may never be amplified — split the input, not the switch.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_rewrite_marker_exclusion.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..', '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const { runMigrations } = require('../index');
const learning = require('./learning');
const prefixOutlier = require('./prefix_outlier');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) "
             + "VALUES (1,'Invoice','invoice',1,'invoice_number','invoice_date')").run();
  for (const [k, t] of [['supplier_name', 'text'], ['invoice_number', 'reference_code'], ['invoice_date', 'date']])
    db.prepare('INSERT OR IGNORE INTO fields (document_type_id, key, label, type, required, built_in) VALUES (1,?,?,?,1,1)').run(k, k, t);
  return db;
}
const SUP = 'Pelican Office Interiors';
let seq = 0;
function addConfirmed(db, value, method, opts = {}) {
  const id = ++seq;
  db.prepare(`INSERT INTO documents (id, document_type_id, original_filename, folder_path, status,
              supplier_name, overall_confidence, confirmed_via) VALUES (?,1,?,'/in','confirmed',?,92,?)`)
    .run(id, `d${id}.pdf`, SUP, opts.via || null);
  db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence,
              extraction_method) VALUES (?,'invoice_number',?,?,92,?)`).run(id, value, value, method);
  if (opts.corrected) {
    db.prepare('INSERT INTO corrections (document_id, field_key, original_value, corrected_value, supplier_name, document_type) VALUES (?,?,?,?,?,?)')
      .run(id, 'invoice_number', value, opts.corrected, SUP, 'invoice');
  }
  return id;
}
const grpOf = db => (learning.getFieldFormats(db) || []).find(g =>
  g.field_key === 'invoice_number' && String(g.supplier_name).toLowerCase().includes('pelican'));
const countOf = (db, v) => { const g = grpOf(db); return g ? (g.value_counts || {})[v] || 0 : 0; };

// ── 1. the four markers that had no clause ──────────────────────────────────────────────────────
console.log('the four unclaused rewrite markers');
{
  const db = freshDb(); seq = 0;
  for (const v of ['PI/26/1001', 'PI/26/1002', 'PI/26/1003']) addConfirmed(db, v, 'template_mapping');
  addConfirmed(db, 'PI/26/2001', 'anchor_crop+snapped');
  addConfirmed(db, 'PI/26/2002', 'template_mapping+snap_corrob');
  addConfirmed(db, 'PI/26/2003', 'anchor_crop+name_corrob_adopt');
  addConfirmed(db, 'PI/26/2004', 'template_mapping+prefix_confusable_adopt');

  // Precondition — assert the group EXISTS and counts, so a 0 below means EXCLUDED, not ABSENT.
  // (A pin asserting an absence against a group that was never emitted greens on nothing.)
  process.env.LEARNING_EXCLUDE_REWRITE_MARKERS = '0';
  check('precondition: OFF, the group exists and counts all seven',
        !!grpOf(db) && grpOf(db).confirmed_count === 7 && countOf(db, 'PI/26/2001') === 1);

  process.env.LEARNING_EXCLUDE_REWRITE_MARKERS = '1';
  check('ON: a +snapped value is not counted — the snap rewrote to the dominant with no page '
        + 'witness, so counting it lets the dominant vote for itself', countOf(db, 'PI/26/2001') === 0);
  check('ON: +snap_corrob is not counted', countOf(db, 'PI/26/2002') === 0);
  check('ON: +name_corrob_adopt is not counted', countOf(db, 'PI/26/2003') === 0);
  check('ON: +prefix_confusable_adopt is not counted', countOf(db, 'PI/26/2004') === 0);
  check('ON: the plain human rows are untouched — the exclusion is by PROVENANCE, not by value',
        countOf(db, 'PI/26/1001') === 1 && grpOf(db).confirmed_count === 3);
  db.close();
}

// ── 2. the corrections carve-out (the C2 lesson, applied here too) ──────────────────────────────
console.log('\nthe corrections carve-out — a human edit re-admits the row');
{
  const db = freshDb(); seq = 0;
  for (const v of ['PI/26/1001', 'PI/26/1002', 'PI/26/1003']) addConfirmed(db, v, 'template_mapping');
  addConfirmed(db, 'PI/26/9001', 'anchor_crop+snapped', { corrected: 'PI/26/9001' });
  process.env.LEARNING_EXCLUDE_REWRITE_MARKERS = '1';
  check('a marked row the human CORRECTED is counted again. updateExtractionValue never rewrites '
        + 'extraction_method, so without this the row is excluded for the life of the install',
        countOf(db, 'PI/26/9001') === 1);
  db.close();
}

// ── 3. the end-anchor defect ────────────────────────────────────────────────────────────────────
console.log('\nthe end-anchor defect (a stacked suffix escaped every shipped clause)');
{
  const db = freshDb(); seq = 0;
  for (const v of ['PI/26/1001', 'PI/26/1002', 'PI/26/1003']) addConfirmed(db, v, 'template_mapping');
  addConfirmed(db, 'PI/26/3001', 'anchor_crop+snapped+corrected');
  process.env.LEARNING_EXCLUDE_REWRITE_MARKERS = '1';
  check("a marker that is not the LAST suffix is still excluded — the shipped '%+marker' patterns "
        + 'are end-anchored, so anchor_crop+snapped+corrected matched none of them',
        countOf(db, 'PI/26/3001') === 0);
  db.close();
}

// ── 4. OFF is byte-identical ────────────────────────────────────────────────────────────────────
console.log('\nOFF is inert');
{
  const db = freshDb(); seq = 0;
  // mig 93 promotes learning_exclude_rewrite_markers to 'true' (index.js UPDATE at ~line 2276),
  // overriding mig 75's 'false'. This section pins the OFF/unset arm mig 75 established, so restore it.
  learning.setSetting(db, 'learning_exclude_rewrite_markers', 'false');
  for (const v of ['PI/26/1001', 'PI/26/1002', 'PI/26/1003']) addConfirmed(db, v, 'template_mapping');
  addConfirmed(db, 'PI/26/2001', 'anchor_crop+snapped');
  process.env.LEARNING_EXCLUDE_REWRITE_MARKERS = '0';
  const off = JSON.stringify(grpOf(db));
  delete process.env.LEARNING_EXCLUDE_REWRITE_MARKERS;
  check('unset behaves exactly as OFF (migration 75 seeds the setting false)',
        JSON.stringify(grpOf(db)) === off);
  check('...and the marked row IS counted when off — so section 1 measured a real change',
        countOf(db, 'PI/26/2001') === 1);
  db.close();
}

// ── 5. S0-C1 — the CONFIRM-TIME guard must share the same provenance policy ─────────────────────
console.log('\nS0-C1 — getPrefixModelForScope was grading its own homework');
{
  const db = freshDb(); seq = 0;
  // Six plainly-read human rows, so the model still builds after the exclusion and the assertion
  // measures a COUNT rather than the model vanishing (buildScopeRec returns null below its bars).
  for (let i = 0; i < 6; i++) addConfirmed(db, `DN/26/${i}`, 'template_mapping');
  // Ten documents the SNAP rewrote to the dominant prefix, which then machine-filed.
  for (let i = 0; i < 10; i++) addConfirmed(db, `DN/26/9${i}`, 'anchor_crop+snapped', { via: 'auto_threshold' });
  const model = () => learning.getPrefixModelForScope(db, SUP, 'invoice', 'invoice_number');

  process.env.LEARNING_EXCLUDE_REWRITE_MARKERS = '0';
  const before = model();
  check('precondition: today the confirm-time model counts the rewritten rows as evidence',
        !!before && before.total === 16);
  process.env.LEARNING_EXCLUDE_REWRITE_MARKERS = '1';
  const after = model();
  check('ON: the rewritten rows leave the confirm-time model too — one provenance policy across '
        + 'both readers, even though they deliberately keep different SNAPSHOTS',
        !!after && after.total === 6);
  check('...and this reader keeps its machine-INCLUSIVE character, which is its whole purpose: a '
        + 'plainly-read SWEPT document still counts. Only rewrite-created rows go',
        (() => { addConfirmed(db, 'DN/26/50', 'template_mapping', { via: 'scope_sweep' });
                 const m = model(); return !!m && m.total === 7; })());
  db.close();
}

// ── 6. THE INVARIANT PIN — this is what killed Slice 1, and it must stay red against it ─────────
console.log('\nTHE INVARIANT — a licensing index may never be amplified with machine counts');
// Oracle 2026-08-19, gate item 1. The rejected design would have unioned machine counts into
// `prefix_index` under an "amplify, never introduce" rule: admit a machine value only if its prefix
// is already human-attested. That rule governs WHICH prefixes enter; it does not govern COUNTS or
// TOTAL, and those are what the guards actually read.
//
// The scenario: a scope whose dominant is DN, where a human ONCE confirmed a skew misread `IN`, and
// thirty machine files then carried `IN`. `IN` is human-attested, so the rule admits all thirty.
{
  const human = { 'DN/26/1': 40, 'IN/26/9': 1 };
  const machine = {};
  for (let i = 0; i < 30; i++) machine[`IN/26/1${i}`] = 1;

  const recToday = prefixOutlier.buildScopeRec(human);
  const unioned  = { ...human, ...machine };            // what "amplify, never introduce" would allow
  const recAfter = prefixOutlier.buildScopeRec(unioned);

  check('TODAY the guard catches the stray misread: IN is an outlier against a DN scope',
        prefixOutlier.isPrefixOutlier('IN', recToday) === true);
  check('AMPLIFIED, the guard goes SILENT on the very prefix it exists to catch — the counts clear '
        + 'its own exemption bar (max(3, ceil(0.10*total))). This is why Slice 1 was sent back, and '
        + 'this pin must stay RED against any future attempt to union machine counts into a '
        + 'licensing index',
        prefixOutlier.isPrefixOutlier('IN', recAfter) === false);
  // The dilution leg, which happens even with the rule fully honoured and NO misread involved:
  // build_prefix_index arms a scope only at dom_n >= 0.80 * total. Machine rows inflate the
  // denominator, so a scope that flags today can stop flagging entirely — silently, no note.
  const diluted = prefixOutlier.buildScopeRec({ 'DN/26/1': 40, 'IN/26/9': 1, ...Object.fromEntries(
    Array.from({ length: 15 }, (_, i) => [`IN/26/2${i}`, 1])) });
  check('...and dilution alone DISARMS the scope outright — 40 of 56 is under the 0.80 share, so '
        + 'buildScopeRec returns null and every field in that scope stops being checked at all. '
        + 'No note, no flag, nothing said. This needs no misread to happen, only volume',
        recToday !== null && diluted === null);
  // The Python twin of prefix_confirmed carries the REWRITE-permission half of this invariant and
  // is pinned in python_backend/tests/test_prefix_amplification_invariant.py — same scenario,
  // asserted against ocr_corrector directly, because that is the module the rewrite lane reads.
}

// ── 7. the invariant, stated in code so it survives this file ───────────────────────────────────
console.log('\nthe invariant is written down where the next reader will find it');
{
  const src = fs.readFileSync(path.join(REPO, 'database', 'modules', 'learning.js'), 'utf8');
  check('the rewrite-marker clause explains that the loop was already open on the HUMAN channel '
        + '(a future dev who thinks this only guards machine rows will delete it)',
        /already open on the HUMAN channel|ALREADY OPEN on the HUMAN channel/i.test(src));
  check('both readers carry the clause', (src.match(/\+snap\\\\_corrob%/g) || []).length >= 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
