#!/usr/bin/env node
/*
 * remediate-corrob-queue-20260815.js
 * -----------------------------------
 * Resolve the STORED review-queue documents that are held by a validation note / vacuous
 * corrected_to even though the DB already carries the correct answer (the persisted
 * extractions.corroboration record + the confirmed-corpus dominance). Oracle-recommended
 * delivery for the live backlog: read the ALREADY-PERSISTED import-time evidence and apply
 * the class predicates, instead of a reprocess (which can re-bake from a sparse ledger).
 *
 * SAFE BY DEFAULT: dry-run. Pass a DB path (never the live DB unless you mean it) and --apply
 * to write. Reuses trust.js `_corrobLicensed` (the same independence bet the gate uses).
 *
 *   node scripts/remediate-corrob-queue-20260815.js <db-path> [--apply]
 *
 * Per-class predicates (fail toward Review — any weak leg leaves the field untouched):
 *   A inferred-company : corrob_licensed(supplier) AND value==dominant issuer AND graduated(>=W, >=0.9)
 *   B I/1 ref rawwitness: value letter-skeleton == scope dominant (share>=0.90, n>=5); clear note+vacuous/1-confusable corrected_to
 *   C corroborated total: corrob_licensed(total) AND net*(1+r)==total to the penny (r in {0.20,0.05}); clear note ONLY (value fixed)
 *   D confusable-char code: single dominant constant (share>=0.95) 1-confusable from value AND independent hint/memory carries it; adopt
 *   E name suggestion    : corrected_to==dominant confirmed value (share>=0.9,n>=5) AND independent keyword family==corrected_to; adopt
 *   F ref-not-on-page    : LEAVE HELD (weak, independent_agree false)
 *   G weak-critical-floor : handled by trust.js critfield_corrob_floor_relax (not a note) — reported, not written here
 */
'use strict';
const path = require('path');
const REPO = 'C:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const trust = require(path.join(REPO, 'database', 'modules', 'trust.js'));
const { normaliseForTokens } = require(path.join(REPO, 'database', 'modules', 'text_normalise.js'));

const dbPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!dbPath) { console.error('usage: node remediate-corrob-queue.js <db-path> [--apply]'); process.exit(2); }

const db = new Database(dbPath, { fileMustExist: true });

// ---- helpers ----
const norm = (s) => normaliseForTokens(s == null ? '' : String(s));
const letterSkel = (v) => (String(v || '').match(/[A-Za-z]/g) || []).join('');
function parseAmount(s) {
  if (s == null) return null;
  const m = String(s).replace(/[£$€,\s]/g, '');
  if (!/^-?\d*\.?\d+$/.test(m)) return null;
  const f = parseFloat(m);
  return Number.isFinite(f) ? f : null;
}
const pennies = (x) => Math.round(x * 100);
// confusable single-position: symbol/letter misreads of a digit and the reverse, plus I/l/1, O/0.
// NOTE (Oracle condition): the CODE-STRUCTURAL separators '/' and '\\' are deliberately EXCLUDED —
// treating a printed separator as a confusable corrupts structured codes (the CODE_SEPARATOR / I->1
// lesson). ']' '[' '|' stay (genuine glyph confusions of '1', not separators inside real codes).
const CONFUSE = new Map([
  [']','1'],['[','1'],['|','1'],['l','1'],['I','1'],['i','1'],
  ['O','0'],['o','0'],['S','5'],['B','8'],['Z','2'],
]);
function oneConfusableDiff(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diffs = 0, ok = true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    diffs++;
    const ca = a[i], cb = b[i];
    const pair = (CONFUSE.get(ca) === cb) || (CONFUSE.get(cb) === ca) ||
                 (ca.toUpperCase() === cb.toUpperCase());
    if (!pair) ok = false;
  }
  return diffs === 1 && ok;
}

// ---- scope substrate (confirmed corpus) ----
const dtypes = {};
for (const r of db.prepare('SELECT id, name, slug, ref_field_key, date_field_key FROM document_types').all()) dtypes[r.id] = r;

const _cache = {};
function scopeConfirmedCount(supplier, slug) {
  const k = 'cc|' + supplier + '|' + slug;
  if (_cache[k] != null) return _cache[k];
  const n = db.prepare(`SELECT COUNT(*) c FROM documents d JOIN document_types dt ON dt.id=d.document_type_id
                        WHERE d.status='confirmed' AND d.supplier_name=? AND dt.slug=?`).get(supplier, slug).c;
  return (_cache[k] = n);
}
function fieldValues(supplier, slug, field) {
  const k = 'fv|' + supplier + '|' + slug + '|' + field;
  if (_cache[k]) return _cache[k];
  const rows = db.prepare(`SELECT e.display_value v FROM extractions e JOIN documents d ON d.id=e.document_id
      JOIN document_types dt ON dt.id=d.document_type_id
      WHERE d.status='confirmed' AND d.supplier_name=? AND dt.slug=? AND e.field_key=? AND e.display_value IS NOT NULL AND TRIM(e.display_value)<>''`).all(supplier, slug, field).map(r => r.v);
  return (_cache[k] = rows);
}
function dominantValue(supplier, slug, field) {
  const vals = fieldValues(supplier, slug, field);
  if (!vals.length) return null;
  const counts = new Map();
  for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  let top = null, topN = 0;
  for (const [v, n] of counts) if (n > topN) { topN = n; top = v; }
  const realDistinct = [...counts.entries()].filter(([, n]) => n >= 2).length; // >=2 = not a lone garble
  return { value: top, count: topN, total: vals.length, share: topN / vals.length, realDistinct };
}
function dominantLetterSkeleton(supplier, slug, field) {
  const vals = fieldValues(supplier, slug, field);
  if (!vals.length) return null;
  const counts = new Map();
  for (const v of vals) { const s = letterSkel(v); counts.set(s, (counts.get(s) || 0) + 1); }
  let top = null, topN = 0;
  for (const [s, n] of counts) if (n > topN) { topN = n; top = s; }
  return { skel: top, count: topN, total: vals.length, share: topN / vals.length };
}

const GRAD_WINDOW = 5; // matches live graduation_window
function parseCorrob(raw) { try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; } }

// ---- per-doc resolution ----
const queue = db.prepare(`SELECT id, document_type_id, supplier_name, overall_confidence FROM documents WHERE status='needs_review' ORDER BY id`).all();
const getExt = db.prepare('SELECT * FROM extractions WHERE document_id=?');

const changes = [];    // {docId, field, class, action, from, to}
const report = [];

for (const doc of queue) {
  const dt = dtypes[doc.document_type_id];
  if (!dt) continue;
  const slug = dt.slug;
  const exts = getExt.all(doc.id);
  const byKey = new Map(exts.map(e => [e.field_key, e]));
  const docChanges = [];

  for (const e of exts) {
    const note = String(e.validation_note || '').trim();
    const field = e.field_key;
    const corrob = parseCorrob(e.corroboration);
    const val = e.display_value;

    // ---------- Class A: inferred company ----------
    if (note.startsWith('Company inferred') && (field === 'supplier_name')) {
      const dom = dominantValue(doc.supplier_name, slug, field);   // note: supplier scope == the value itself
      const cc = scopeConfirmedCount(doc.supplier_name, slug);
      const licensed = trust._corrobLicensed(e.corroboration);
      const valEqSupplier = norm(val) === norm(doc.supplier_name) && norm(val).length > 0;
      if (licensed && valEqSupplier && cc >= GRAD_WINDOW) {
        docChanges.push({ field, class: 'A', action: 'clear-note+method', from: `note; method=${e.extraction_method} conf=${e.confidence}`, to: 'template_identity_corroborated @85', _set: { validation_note: null, extraction_method: 'template_identity_corroborated', confidence: 85 } });
      } else {
        report.push(`  [A DECLINE] doc ${doc.id} ${field}: licensed=${licensed} valEqSupplier=${valEqSupplier} confirms=${cc}`);
      }
      continue;
    }

    // ---------- Class B: I/1 rawwitness on the ref role ----------
    if (note.includes('one character differs') && String(e.extraction_method || '').includes('rawwitness')) {
      const ds = dominantLetterSkeleton(doc.supplier_name, slug, field);
      const ok = ds && ds.count >= 5 && ds.share >= 0.90 && letterSkel(val) === ds.skel;
      const ct = String(e.corrected_to || '');
      const vacuousOrOneConf = !ct.trim() || ct === String(val) || oneConfusableDiff(ct, String(val));
      if (ok && vacuousOrOneConf) {
        docChanges.push({ field, class: 'B', action: 'clear-note+corrected_to', from: `note; corrected_to=${e.corrected_to}; method=${e.extraction_method}`, to: `${val} (skeleton ${ds.skel} = ${(ds.share*100).toFixed(0)}% of ${ds.total})`, _set: { validation_note: null, corrected_to: null, was_corrected: 0, extraction_method: String(e.extraction_method || '').replace('_rawwitness', '') } });
      } else {
        report.push(`  [B DECLINE] doc ${doc.id} ${field}: skelMatch=${ok} vacuous/1conf=${vacuousOrOneConf} dom=${ds ? ds.skel+'@'+(ds.share*100).toFixed(0)+'%' : 'none'}`);
      }
      continue;
    }

    // ---------- Class C: corroborated total ----------
    if (note.includes('was read the same way by two independent methods')) {
      const licensed = trust._corrobLicensed(e.corroboration);
      const total = parseAmount(val);
      const operands = ['subtotal', 'vat_tax', 'net', 'tax'].map(k => byKey.get(k)).filter(Boolean).map(x => parseAmount(x.display_value)).filter(v => v != null);
      let vatOk = false, matched = null;
      if (total != null) for (const r of [0.20, 0.05]) {
        const net = Math.round(total / (1 + r) * 100) / 100;
        const vat = Math.round((total - net) * 100) / 100;
        for (const op of operands) if (pennies(op) === pennies(net) || pennies(op) === pennies(vat)) { vatOk = true; matched = { r, op }; }
      }
      if (licensed && vatOk) {
        docChanges.push({ field, class: 'C', action: 'clear-note (value fixed)', from: `note; total=${val}`, to: `total unchanged; VAT-reconciled @${(matched.r*100)}% via operand ${matched.op}`, _set: { validation_note: null, was_corrected: 0, corrected_to: null, extraction_method: String(e.extraction_method || '') + '+corrob_clear' } });
      } else {
        report.push(`  [C DECLINE] doc ${doc.id} ${field}: licensed=${licensed} vatReconcile=${vatOk}`);
      }
      continue;
    }

    // ---------- Class D: confusable-char code (unexpected characters) ----------
    if (note.startsWith('unexpected characters')) {
      const dom = dominantValue(doc.supplier_name, slug, field);
      const singleCanonical = dom && dom.share >= 0.95 && dom.realDistinct <= 1;
      const oneConf = dom && oneConfusableDiff(val, dom.value);
      // independent family (hint/memory) carrying the dominant constant, from the corrob disagree list
      const indep = corrob && Array.isArray(corrob.disagree) &&
        corrob.disagree.some(d => ['hint', 'memory'].includes(d.family) && norm(d.value) === norm(dom && dom.value));
      if (singleCanonical && oneConf && indep) {
        docChanges.push({ field, class: 'D', action: 'adopt-constant', from: `${val} (note)`, to: `${dom.value} (${(dom.share*100).toFixed(0)}% single canonical, hint/memory agree)`, _set: { display_value: dom.value, raw_value: dom.value, validation_note: null, corrected_to: null, was_corrected: 1, extraction_method: String(e.extraction_method || '') + '+snap_corrob' } });
      } else {
        report.push(`  [D DECLINE] doc ${doc.id} ${field}: singleCanonical=${singleCanonical} oneConf=${oneConf} indepFamily=${indep}`);
      }
      continue;
    }

    // ---------- Class E: name suggestion adopt ----------
    if (note.startsWith('Suggested name correction:')) {
      const repaired = String(e.corrected_to || '').trim();
      const dom = dominantValue(doc.supplier_name, slug, field);
      const p1 = repaired && dom && dom.share >= 0.9 && dom.count >= 5 && norm(repaired) === norm(dom.value);
      const p2 = corrob && Array.isArray(corrob.disagree) &&
        corrob.disagree.some(d => d.family === 'keyword' && norm(d.value) === norm(repaired));
      const p3 = repaired && norm(repaired) !== norm(val);
      // never identity (supplier_name)
      if (field !== 'supplier_name' && p1 && p2 && p3) {
        docChanges.push({ field, class: 'E', action: 'adopt-repaired', from: `${val} (garble)`, to: `${repaired} (${(dom.share*100).toFixed(0)}% dominant + keyword agrees)`, _set: { display_value: repaired, validation_note: null, corrected_to: null, was_corrected: 1, extraction_method: String(e.extraction_method || '') + '+name_corrob_adopt' } });
      } else {
        report.push(`  [E DECLINE] doc ${doc.id} ${field}: p1=${p1} p2(keyword)=${p2} p3=${p3}`);
      }
      continue;
    }

    // ---------- Class F: ref not on page ----------
    if (note.includes("doesn't appear on this page")) {
      report.push(`  [F HOLD] doc ${doc.id} ${field}: left held (weak evidence, correct)`);
      continue;
    }
  }

  if (docChanges.length) changes.push({ docId: doc.id, supplier: doc.supplier_name, type: dt.name, changes: docChanges });
}

// ---- eligibility projection (both G off and G on) ----
function projectEligible(doc, applied, gOn) {
  const rows = getExt.all(doc.id).map(e => ({ ...e }));
  for (const ch of applied) { const r = rows.find(x => x.field_key === ch.field); if (r) Object.assign(r, ch._set); }
  const opts = {
    extractions: rows, corrobAutoFile: true, gateUnify: true,
    vacuousCorrectedToIgnore: true, critFieldCorrobRelax: gOn, gradOn: true,
  };
  try { return trust.isAutoFileEligible(db, doc, opts); } catch (e) { return { eligible: false, reason: 'err:' + e.message }; }
}

// ---- print ----
console.log(`\n=== CORROBORATION QUEUE REMEDIATION (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
console.log(`DB: ${dbPath}`);
console.log(`needs_review docs: ${queue.length}\n`);
let eligOff = 0, eligOn = 0;
for (const c of changes) {
  const doc = queue.find(d => d.id === c.docId);
  const off = projectEligible(doc, c.changes, false);
  const on  = projectEligible(doc, c.changes, true);
  if (off.eligible) eligOff++; if (on.eligible) eligOn++;
  console.log(`DOC ${c.docId}  ${c.supplier} / ${c.type}  ->  eligible(Goff)=${off.eligible}${off.eligible ? '' : ' ('+off.reason+')'}  eligible(Gon)=${on.eligible}${on.eligible ? '' : ' ('+on.reason+')'}`);
  for (const ch of c.changes) console.log(`    [${ch.class}] ${ch.field}: ${ch.action}\n         ${ch.from}\n      -> ${ch.to}`);
}
console.log(`\nDECLINES / HOLDS:`);
for (const r of report) console.log(r);
console.log(`\nSUMMARY: docs with proposed changes = ${changes.length}; would become eligible with G OFF = ${eligOff}; with G ON = ${eligOn}; of ${queue.length} held.`);

// ---- apply ----
if (APPLY) {
  const upd = db.prepare('UPDATE extractions SET display_value=COALESCE(@display_value,display_value), raw_value=COALESCE(@raw_value,raw_value), validation_note=@validation_note, corrected_to=@corrected_to, was_corrected=COALESCE(@was_corrected,was_corrected), extraction_method=COALESCE(@extraction_method,extraction_method) WHERE document_id=@docId AND field_key=@field');
  const tx = db.transaction(() => {
    for (const c of changes) for (const ch of c.changes) {
      upd.run({ docId: c.docId, field: ch.field,
        display_value: ch._set.display_value ?? null, raw_value: ch._set.raw_value ?? null,
        validation_note: ch._set.validation_note ?? null, corrected_to: ch._set.corrected_to ?? null,
        was_corrected: ch._set.was_corrected ?? null, extraction_method: ch._set.extraction_method ?? null });
    }
  });
  tx();
  console.log(`\nAPPLIED ${changes.reduce((n, c) => n + c.changes.length, 0)} field changes across ${changes.length} docs.`);
}
db.close();
