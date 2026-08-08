'use strict';
/*
 * test_template_merge_plan.js — M3 read-only cleanup engine (templateMerge.js):
 *   • findMergeCandidates — duplicate clusters + canonical pick + STRUCTURE gate (merge vs group)
 *   • planBackfill / applyBackfill — LINK template-less confirmed docs to their branding template
 * (docs/designs/TEMPLATE_CONVERGENCE_2026-07-17.md).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 <electron> database/modules/test_template_merge_plan.js
 */
const Database = require('better-sqlite3');
const templates = require('./templates');
const merge     = require('./templateMerge');

let failures = 0;
function check(label, cond) { console.log((cond ? '  OK  ' : '  BAD ') + label); if (!cond) failures++; return cond; }
function section(t) { console.log('\n' + t); }

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      document_type_slug TEXT, logo_phash TEXT, keyword_fingerprint TEXT,
      sample_document_id INTEGER, confirmed_count INTEGER NOT NULL DEFAULT 0, ocr_auto_params TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE template_fields (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, field_key TEXT, anchor_label TEXT, direction TEXT, fixed_value TEXT, is_variable INTEGER, fixed_locked INTEGER DEFAULT 0);
    CREATE TABLE template_field_mappings (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, field_key TEXT,
      target_x_norm REAL, target_y_norm REAL, target_w_norm REAL, target_h_norm REAL, enabled INTEGER DEFAULT 1);
    CREATE TABLE template_landmarks (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, label_text TEXT, x_norm REAL, y_norm REAL, w_norm REAL, h_norm REAL, ocr_conf REAL, page_number INTEGER);
    CREATE TABLE template_logo_hashes (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, phash TEXT, detail_hash TEXT, UNIQUE(template_id, phash));
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, name TEXT);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, document_type_id INTEGER, template_id INTEGER, keyword_fingerprint TEXT);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, display_value TEXT);
  `);
  db.prepare("INSERT INTO document_types (id, slug, name) VALUES (1,'invoice','Invoice'), (2,'wsht','Worksheet')").run();
  return db;
}

const FP_A     = ['copperfield', 'electrical', 'ballymena', 'mill'];   // supplier A
const FP_A2    = ['copperfield', 'electrical', 'ballymena'];           // supplier A, one token thinner (Jaccard 3/4 = 0.75)
const FP_OTHER = ['northgate', 'textiles', 'antrim', 'road'];          // supplier B (0 shared with A)
const FP_THIN  = ['acme', 'ltd'];                                      // <3 distinctive tokens

let tSeq = 0;
function mkT(db, name, slug, fp, { sample = null } = {}) {
  const s = `${slug}_${++tSeq}`;
  return db.prepare("INSERT INTO templates (name, slug, document_type_slug, keyword_fingerprint, sample_document_id) VALUES (?,?,?,?,?)")
    .run(name, s, slug, JSON.stringify(fp), sample).lastInsertRowid;
}
function addLandmarks(db, tId, pts) {   // pts = [[label,x,y], ...]
  const st = db.prepare("INSERT INTO template_landmarks (template_id, label_text, x_norm, y_norm, page_number) VALUES (?,?,?,?,0)");
  for (const [label, x, y] of pts) st.run(tId, label, x, y);
}
function mkDoc(db, { status = 'confirmed', typeId, templateId = null, fp }) {
  return db.prepare("INSERT INTO documents (status, document_type_id, template_id, keyword_fingerprint) VALUES (?,?,?,?)")
    .run(status, typeId, templateId, JSON.stringify(fp)).lastInsertRowid;
}
function confirmedFor(db, tId, n) { for (let i = 0; i < n; i++) mkDoc(db, { typeId: 1, templateId: tId, fp: FP_A }); }
const LM3 = [['invoice', 0.1, 0.1], ['date', 0.5, 0.1], ['total', 0.8, 0.9]];

// ── findMergeCandidates ──────────────────────────────────────────────────────
section('findMergeCandidates: same-supplier same-type duplicates with COMPATIBLE layout → merge');
{
  const db = makeDb();
  const big   = mkT(db, 'Copperfield', 'invoice', FP_A, { sample: 1 });
  const small = mkT(db, 'Copperfield', 'invoice', FP_A);
  confirmedFor(db, big, 3); confirmedFor(db, small, 1);
  addLandmarks(db, big, LM3); addLandmarks(db, small, LM3);   // identical constellation → compatible
  const c = merge.findMergeCandidates(db);
  check('exactly one cluster found', c.length === 1);
  check('canonical is the higher-live-count template', c[0] && c[0].canonical.id === big);
  check('the other member is the smaller template', c[0] && c[0].members.length === 1 && c[0].members[0].id === small);
  check("suggestedAction = 'merge' (compatible + strong branding)", c[0] && c[0].suggestedAction === 'merge');
}

section('findMergeCandidates: same branding but DIVERGENT layout → group_or_review (NOT merge)');
{
  const db = makeDb();
  const a = mkT(db, 'Copperfield', 'invoice', FP_A);
  const b = mkT(db, 'Copperfield', 'invoice', FP_A);
  confirmedFor(db, a, 2); confirmedFor(db, b, 2);
  addLandmarks(db, a, LM3);
  addLandmarks(db, b, [['invoice', 0.9, 0.9], ['date', 0.1, 0.8], ['total', 0.2, 0.2]]);   // same labels, far positions
  const c = merge.findMergeCandidates(db);
  check('one cluster (branding matches)', c.length === 1);
  check("suggestedAction = 'group_or_review' (structure divergent)", c[0] && c[0].suggestedAction === 'group_or_review');
  check('member structure = divergent', c[0] && c[0].members[0].structure === 'divergent');
}

section('findMergeCandidates: high branding, layout UNVERIFIABLE (insufficient) → merge_review (owner-confirmed)');
{
  // Post-2026-07-25: `insufficient` means "can't verify the layout" (independent re-teaches rarely share
  // 3+ landmark labels), NOT "different layout". At near-identical branding it becomes an owner-confirmed,
  // backup-first merge (merge_review) instead of being hidden behind a false "different layouts" warning.
  const db = makeDb();
  mkT(db, 'Copperfield', 'invoice', FP_A);
  mkT(db, 'Copperfield', 'invoice', FP_A);
  const c = merge.findMergeCandidates(db);
  check('one cluster', c.length === 1);
  check("insufficient + jaccard>=0.85 → merge_review (surfaced+confirmable, NOT auto-merge)", c[0] && c[0].suggestedAction === 'merge_review');
  check('member structure = insufficient', c[0] && c[0].members[0].structure === 'insufficient');
}

section('findMergeCandidates: insufficient layout + jaccard in [0.75,0.85) → review (surfaced, no merge button)');
{
  const db = makeDb();
  mkT(db, 'Copperfield', 'invoice', FP_A);    // 4 tokens
  mkT(db, 'Copperfield', 'invoice', FP_A2);   // 3-token subset → distinctiveJaccard 3/4 = 0.75
  const c = merge.findMergeCandidates(db);
  check('one cluster', c.length === 1);
  check('jaccard 0.75 (< 0.85 merge_review bar) → review, NOT merge_review', c[0] && c[0].suggestedAction === 'review');
}

section('findMergeCandidates: DIVERGENT layout is NEVER merge_review, even at branding 1.00');
{
  const db = makeDb();
  const a = mkT(db, 'Copperfield', 'invoice', FP_A);
  const b = mkT(db, 'Copperfield', 'invoice', FP_A);   // jaccard 1.00
  addLandmarks(db, a, LM3);
  addLandmarks(db, b, [['invoice', 0.9, 0.9], ['date', 0.1, 0.8], ['total', 0.2, 0.2]]);  // same labels, far apart
  const c = merge.findMergeCandidates(db);
  check("divergent structure → group_or_review (not merge / not merge_review)", c[0] && c[0].suggestedAction === 'group_or_review');
}

section('findMergeCandidates: FIELD-ZONE gate DEMOTES a shared-branding cluster whose fields sit in different places');
{
  // Landmark labels disagree (< 3 shared) → structureVerdict = insufficient; but the field mappings share
  // 2 field_keys in DIFFERENT target zones → fieldZoneVerdict = divergent → fused layout = divergent →
  // group_or_review. This is Oracle #3's genuinely-different-layout-of-one-supplier case, caught by data.
  const db = makeDb();
  const a = mkT(db, 'Copperfield', 'invoice', FP_A);
  const b = mkT(db, 'Copperfield', 'invoice', FP_A);
  const mp = (tId, key, tx, ty) => db.prepare(
    "INSERT INTO template_field_mappings (template_id, field_key, target_x_norm, target_y_norm, target_w_norm, target_h_norm, enabled) VALUES (?,?,?,?,0.1,0.03,1)"
  ).run(tId, key, tx, ty);
  mp(a, 'invoice_number', 0.10, 0.10); mp(a, 'invoice_date', 0.10, 0.20);
  mp(b, 'invoice_number', 0.80, 0.85); mp(b, 'invoice_date', 0.80, 0.75);   // same keys, far zones
  const c = merge.findMergeCandidates(db);
  check('field-zone divergence → group_or_review (demoted out of merge_review)', c[0] && c[0].suggestedAction === 'group_or_review');
  check('member structure reported divergent', c[0] && c[0].members[0].structure === 'divergent');
}

section('findMergeCandidates: FIELD-ZONE gate PROMOTES agreeing zones to a confident merge (no landmarks needed)');
{
  const db = makeDb();
  const a = mkT(db, 'Copperfield', 'invoice', FP_A);
  const b = mkT(db, 'Copperfield', 'invoice', FP_A);
  confirmedFor(db, a, 3); confirmedFor(db, b, 1);
  const mp = (tId, key, tx, ty) => db.prepare(
    "INSERT INTO template_field_mappings (template_id, field_key, target_x_norm, target_y_norm, target_w_norm, target_h_norm, enabled) VALUES (?,?,?,?,0.1,0.03,1)"
  ).run(tId, key, tx, ty);
  mp(a, 'invoice_number', 0.10, 0.10); mp(a, 'invoice_date', 0.10, 0.20);
  mp(b, 'invoice_number', 0.11, 0.11); mp(b, 'invoice_date', 0.10, 0.21);   // same keys, same zones
  const c = merge.findMergeCandidates(db);
  check('agreeing field zones → compatible → merge', c[0] && c[0].suggestedAction === 'merge');
}

section('richness-first canonical: the landmark-rich row wins over a higher-live thin row (Thornbury fix)');
{
  const db = makeDb();
  const rich = mkT(db, 'Copperfield', 'invoice', FP_A);
  const poor = mkT(db, 'Copperfield', 'invoice', FP_A);
  confirmedFor(db, rich, 1); confirmedFor(db, poor, 5);   // poor has MORE live docs
  addLandmarks(db, rich, [['a',0.1,0.1],['b',0.2,0.2],['c',0.3,0.3],['d',0.4,0.4],['e',0.5,0.5]]);  // 5
  addLandmarks(db, poor, [['a',0.1,0.1]]);                                                            // 1
  db.prepare('UPDATE templates SET confirmed_count=? WHERE id=?').run(3, rich);
  db.prepare('UPDATE templates SET confirmed_count=? WHERE id=?').run(7, poor);
  const c = merge.findMergeCandidates(db);
  check('canonical = the 5-landmark row despite fewer live docs', c[0] && c[0].canonical.id === rich);
  const r = templates.mergeInto(db, poor, rich);
  check('mergeInto ok', r && r.ok);
  check('survivor keeps its 5 landmarks (adopt-if-empty would have dropped them under live-first)', templates.getLandmarks(db, rich).length === 5);
  check('confirmed_count summed (3+7=10) — none lost by the richer-canonical choice', templates.getById(db, rich).confirmed_count === 10);
}

section('KILL SWITCH OFF (TEMPLATE_MERGE_REVIEW=0): legacy verdicts restored, byte-identical');
{
  process.env.TEMPLATE_MERGE_REVIEW = '0';
  const db = makeDb();
  mkT(db, 'Copperfield', 'invoice', FP_A);
  mkT(db, 'Copperfield', 'invoice', FP_A);   // insufficient
  const c = merge.findMergeCandidates(db);
  check('OFF: insufficient → group_or_review (legacy)', c[0] && c[0].suggestedAction === 'group_or_review');

  const db2 = makeDb();
  const a = mkT(db2, 'Copperfield', 'invoice', FP_A);
  const b = mkT(db2, 'Copperfield', 'invoice', FP_A);
  confirmedFor(db2, a, 3); confirmedFor(db2, b, 1);
  addLandmarks(db2, a, LM3); addLandmarks(db2, b, LM3);
  const c2 = merge.findMergeCandidates(db2);
  check('OFF: compatible → merge (legacy, canonical = higher-live)', c2[0] && c2[0].suggestedAction === 'merge' && c2[0].canonical.id === a);
  delete process.env.TEMPLATE_MERGE_REVIEW;
}

section('findMergeCandidates: DIFFERENT suppliers of the same type do NOT cluster');
{
  const db = makeDb();
  mkT(db, 'Copperfield', 'invoice', FP_A);
  mkT(db, 'Northgate', 'invoice', FP_OTHER);
  check('no cluster (0 shared distinctive tokens)', merge.findMergeCandidates(db).length === 0);
}

section('findMergeCandidates: same branding, DIFFERENT type is not clustered (slug-scoped)');
{
  const db = makeDb();
  mkT(db, 'Copperfield', 'invoice', FP_A);
  mkT(db, 'Copperfield', 'wsht', FP_A);
  check('no cross-type cluster', merge.findMergeCandidates(db).length === 0);
}

section('findMergeCandidates: a thin-identity template (<3 distinctive tokens) is never a member');
{
  const db = makeDb();
  mkT(db, 'Acme', 'invoice', FP_THIN);
  mkT(db, 'Acme', 'invoice', FP_THIN);
  check('no cluster from thin identities', merge.findMergeCandidates(db).length === 0);
}

section('findMergeCandidates: 0.75-Jaccard pair with compatible layout → merge');
{
  const db = makeDb();
  const a = mkT(db, 'Copperfield', 'invoice', FP_A);    // 4 tokens
  const b = mkT(db, 'Copperfield', 'invoice', FP_A2);   // 3 tokens, subset → Jaccard 3/4 = 0.75
  confirmedFor(db, a, 5); confirmedFor(db, b, 1);
  addLandmarks(db, a, LM3); addLandmarks(db, b, LM3);
  const c = merge.findMergeCandidates(db);
  check('one cluster', c.length === 1);
  check('canonical = the 5-confirm template', c[0] && c[0].canonical.id === a);
  check("action = 'merge' at Jaccard 0.75 + compatible", c[0] && c[0].suggestedAction === 'merge');
}

// ── planBackfill / applyBackfill ─────────────────────────────────────────────
section('planBackfill/applyBackfill: a template-less confirmed doc LINKS to its branding template');
{
  const db = makeDb();
  const t = mkT(db, 'Copperfield', 'invoice', FP_A);
  const linkable   = mkDoc(db, { status: 'confirmed', typeId: 1, templateId: null, fp: FP_A });      // matches T
  const noMatch    = mkDoc(db, { status: 'confirmed', typeId: 1, templateId: null, fp: FP_OTHER });  // matches nothing
  const alreadyLnk = mkDoc(db, { status: 'confirmed', typeId: 1, templateId: t, fp: FP_A });          // already linked
  const pending    = mkDoc(db, { status: 'pending',   typeId: 1, templateId: null, fp: FP_A });       // not confirmed

  const plan = merge.planBackfill(db);
  check('plan has exactly the one linkable doc', plan.length === 1 && plan[0].docId === linkable && plan[0].templateId === t);

  const res = merge.applyBackfill(db);
  check('applyBackfill linked exactly 1', res.linked === 1);
  const link = id => db.prepare('SELECT template_id FROM documents WHERE id=?').get(id).template_id;
  check('the linkable doc is now linked to T', link(linkable) === t);
  check('the no-match doc stays template-less', link(noMatch) === null);
  check('the already-linked doc is untouched', link(alreadyLnk) === t);
  check('the pending doc is NOT linked', link(pending) === null);

  check('re-running applyBackfill links 0 more (idempotent)', merge.applyBackfill(db).linked === 0);
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' check(s) FAILED'));
process.exit(failures === 0 ? 0 : 1);
