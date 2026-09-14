#!/usr/bin/env node
'use strict';
/**
 * test_v1_teach_equivalence.js — the teach-over-client S3 DB-EQUIVALENCE gate (Oracle C1 / T1, 2026-09-14).
 *
 * Proves a REMOTELY-taught template (via POST /v1/teach/commit → reviewHandler.teachCommit) writes rows
 * BYTE-IDENTICAL to a LOCALLY-taught one (the desktop promote-to-template core + the wizard's commit loops),
 * given the SAME document + SAME drawn boxes. If the rows match, a remote-taught template reads identically to
 * a local one, so realdoc_regression is provably unaffected — no full corpus run needed for this slice.
 *
 * Method: two SEPARATE in-memory DBs seeded identically (a doc-type with a mapped/fixed/hidden/list field + one
 * teachable doc). DB1 gets the DESKTOP sequence (_promoteTemplateCoreSync + saveMapping/setFieldFixedValue/
 * setHiddenField/addLabelOverride loops — exactly what the promote-to-template IPC + doCommit run). DB2 gets the
 * /v1 sequence (teachCommit with the batch payload the client's doCommit builds). Compare the six tables the
 * design names, modulo ids/timestamps/document refs.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/api/test_v1_teach_equivalence.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../../../database/index');
const doctypes = require('../../../database/modules/document_types');
const templates = require('../../../database/modules/templates');
const labelOverrides = require('../../../database/modules/label_overrides');
const reviewHandler = require('../review/handler');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

// A ctx with no async enrichment (both paths skip it identically) + a no-op fs for the template JSON file.
const ctx = {
  path: require('path'),
  fs: { writeFileSync: () => {}, existsSync: () => false, mkdirSync: () => {} },
  templatesDir: () => require('os').tmpdir(),
  logger: { log: () => {}, warn: () => {} },
};
// The stub reviewService for teachCommit's file step (marks the doc confirmed; the template rows come from the
// tx, exactly as on the desktop where the confirm is a separate step that doesn't touch template rows here).
const stubReviewSvc = { confirm: async (db, _a, p) => { db.prepare("UPDATE documents SET status='confirmed' WHERE id=?").run(p.document_id); return { ok: true, filename: 'X.pdf' }; } };

function seed() {
  const db = new Database(':memory:');
  runMigrations(db);
  // A custom type with: supplier_name (issuer, mapped), ref (mapped), terms (fixed), notes (hidden), lines (list caption).
  const r = doctypes.createTypeWithFields(db, {
    name: 'Equiv Type',
    fields: [
      { label: 'Document Issuer', key: 'supplier_name', type: 'text' },
      { label: 'Ref', key: 'ref', type: 'reference' },
      { label: 'Terms', key: 'terms', type: 'text' },
      { label: 'Notes', key: 'notes', type: 'text' },
      { label: 'Lines', key: 'lines', type: 'list' },
      { label: 'Date', key: 'date', type: 'date' },
    ],
    ref_field_key: 'Ref', date_field_key: 'Date',
  });
  if (!r.success) throw new Error('seed type failed: ' + r.error);
  const docId = db.prepare("INSERT INTO documents (document_type_id, original_filename, stored_filename, status, folder_path, logo_phash, keyword_fingerprint) VALUES (?,?,?,?,?,?,?)")
    .run(r.id, 'ex.pdf', 'ex.pdf', 'needs_review', '/inbox', null, '[]').lastInsertRowid;
  return { db, slug: r.type.slug, docId };
}

// The one shared teaching (same document content + same drawn boxes on both paths).
const TEACH = {
  supplier: 'Acme Widgets Ltd',
  allValues: { supplier_name: 'Acme Widgets Ltd', ref: 'REF-9', terms: 'Net 30', lines: 'A; B' },
  mappings: [
    { field_key: 'supplier_name', page_number: 0, anchor_text: null, anchor_x_norm: 0.1, anchor_y_norm: 0.05, anchor_w_norm: 0.3, anchor_h_norm: 0.06, target_x_norm: 0.1, target_y_norm: 0.05, target_w_norm: 0.3, target_h_norm: 0.06, search_expansion: 0.04 },
    { field_key: 'ref', page_number: 0, anchor_text: 'Ref', anchor_x_norm: 0.6, anchor_y_norm: 0.2, anchor_w_norm: 0.08, anchor_h_norm: 0.04, target_x_norm: 0.7, target_y_norm: 0.2, target_w_norm: 0.15, target_h_norm: 0.04, search_expansion: 0.04 },
  ],
  // includes the Document Issuer as a FIXED value (buyer-issued letterhead — the case that broke in the
  // owner's live client test; proves the desktop and /v1 both allow it and write identical rows).
  fixed: [{ field_key: 'terms', value: 'Net 30' }, { field_key: 'supplier_name', value: 'Fixed Issuer Ltd' }],
  hidden: ['notes'],
  listCaptions: [{ field_key: 'lines', label: 'Line Item' }],
};

// DESKTOP path — exactly what the promote-to-template IPC + doCommit loops do.
function teachDesktop(env) {
  const { db, slug, docId } = env;
  const dtInfo = doctypes.getWithFields(db, slug);
  const result = reviewHandler._promoteTemplateCoreSync(ctx, db, docId, {
    allValues: TEACH.allValues, document_type_slug: slug, supplier_name: TEACH.supplier, dtInfo,
    wizardAngle: { angle: 0, measured: false },
  });
  const tid = result.templateId;
  for (const c of TEACH.listCaptions) labelOverrides.addLabelOverride(db, { doc_type_slug: slug, field_key: c.field_key, label: c.label, exclusive: 0, template_id: 0 });
  for (const f of TEACH.fixed) templates.setFieldFixedValue(db, tid, f.field_key, f.value);
  for (const k of TEACH.hidden) templates.setHiddenField(db, tid, k, true);
  for (const m of TEACH.mappings) templates.saveMapping(db, tid, m);
  return tid;
}

// /v1 path — teachCommit with the batch payload the client's doCommit builds.
async function teachV1(env) {
  const { db, slug, docId } = env;
  const r = await reviewHandler.teachCommit(ctx, db, {
    teachCommitId: 'equiv-1', document_id: docId, document_type_slug: slug, supplier_name: TEACH.supplier,
    allValues: TEACH.allValues, sample_deskew_angle: 0, angle_measured: false,
    listCaptions: TEACH.listCaptions, fixed: TEACH.fixed, hidden: TEACH.hidden, mappings: TEACH.mappings,
    acknowledgeTypeSplit: true, acknowledgeIssuerNearMatch: true, taught_fields: ['supplier_name', 'ref'],
  }, { userId: 1, username: 'admin', role: 'admin' }, stubReviewSvc);
  if (!r.ok) throw new Error('teachCommit failed: ' + JSON.stringify(r));
  return r.templateId;
}

// Read a template's rows across the six tables, stripped of volatile columns, canonicalised for compare.
const STRIP = new Set(['id', 'template_id', 'created_at', 'updated_at', 'last_authoritative_at', 'sample_document_id', 'document_id', 'created', 'sample_deskew_angle']);
function stripRow(row) {
  const o = {};
  for (const k of Object.keys(row).sort()) if (!STRIP.has(k)) o[k] = row[k];
  return o;
}
function tableRows(db, sql, args) {
  return db.prepare(sql).all(...args).map(stripRow).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function snapshot(db, tid, slug) {
  return {
    templates: tableRows(db, 'SELECT * FROM templates WHERE id=?', [tid]),
    template_fields: tableRows(db, 'SELECT * FROM template_fields WHERE template_id=?', [tid]),
    template_field_mappings: tableRows(db, 'SELECT * FROM template_field_mappings WHERE template_id=?', [tid]),
    template_hidden_fields: tableRows(db, 'SELECT * FROM template_hidden_fields WHERE template_id=?', [tid]),
    template_landmarks: tableRows(db, 'SELECT * FROM template_landmarks WHERE template_id=?', [tid]),
    field_label_overrides: tableRows(db, 'SELECT * FROM field_label_overrides WHERE doc_type_slug=?', [slug]),
  };
}

async function main() {
  const e1 = seed(); const tid1 = teachDesktop(e1);
  const e2 = seed(); const tid2 = await teachV1(e2);
  const s1 = snapshot(e1.db, tid1, e1.slug);
  const s2 = snapshot(e2.db, tid2, e2.slug);
  for (const tbl of Object.keys(s1)) {
    const a = JSON.stringify(s1[tbl]), b = JSON.stringify(s2[tbl]);
    check(`${tbl}: desktop-taught == /v1-taught (${s1[tbl].length} row(s))`, a === b);
    if (a !== b) { console.log('    desktop:', a); console.log('    /v1    :', b); }
  }
  // Sanity: the teaching actually wrote something (guards against a vacuous all-empty "match").
  check('the mappings table is non-empty (the teaching landed)', s1.template_field_mappings.length === 2 && s2.template_field_mappings.length === 2);
  check('the hidden field landed on both', s1.template_hidden_fields.length >= 1 && s2.template_hidden_fields.length >= 1);
  check('the list caption landed on both', s1.field_label_overrides.length >= 1 && s2.field_label_overrides.length >= 1);

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
