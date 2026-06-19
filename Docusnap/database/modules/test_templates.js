#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_templates.js
 * -----------------------------------
 * Direct test of the template-management additions to database/modules/templates.js
 * — create (slug derivation), rename (cosmetic metadata only), and remove
 * (scoped delete with no spillover into other templates, documents, or
 * unrelated learning data).
 *
 * Runs against an in-memory better-sqlite3 database whose schema is a
 * verbatim copy of the relevant parts of migrations 4 and 8 (see
 * database/index.js, runJsMigrations) — including the ON DELETE CASCADE
 * foreign keys on template_fields/template_field_mappings and the
 * un-cascaded documents.template_id reference that templates.remove must
 * null out before deleting, with foreign_keys = ON exactly as the app runs it.
 *
 * Why Electron-as-Node: better-sqlite3 here is a native addon rebuilt against
 * Electron's bundled Node ABI — loading it from system Node fails with a
 * NODE_MODULE_VERSION mismatch (see test_auth.js for the same note).
 *
 * Usage (from the project root):
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_templates.js
 *
 * Exit code 0 = behaves as expected. Exit code 1 = regression.
 */

const Database  = require('better-sqlite3');
const templates = require('./templates');

function check(label, condition) {
  console.log(`  ${condition ? 'OK ' : 'BAD'} ${label}`);
  return condition;
}

function section(title) {
  console.log(`\n${title}`);
}

// ── In-memory DB — verbatim copy of the templates/documents slice of
// migrations 4 and 8, so cascade behaviour and FK enforcement are real.
function makeTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE templates (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      name                 TEXT    NOT NULL,
      slug                 TEXT    NOT NULL UNIQUE,
      document_type_slug   TEXT,
      logo_phash           TEXT,
      keyword_fingerprint  TEXT,
      sample_document_id   INTEGER REFERENCES documents(id),
      confirmed_count      INTEGER NOT NULL DEFAULT 0,
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE template_fields (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id  INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      field_key    TEXT    NOT NULL,
      anchor_label TEXT,
      direction    TEXT    NOT NULL DEFAULT 'right',
      fixed_value  TEXT,
      is_variable  INTEGER NOT NULL DEFAULT 1,
      UNIQUE(template_id, field_key)
    );
    CREATE TABLE template_field_mappings (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id      INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      field_key        TEXT    NOT NULL,
      page_number      INTEGER NOT NULL DEFAULT 0,
      anchor_text      TEXT,
      anchor_x_norm REAL, anchor_y_norm REAL, anchor_w_norm REAL, anchor_h_norm REAL,
      target_x_norm REAL, target_y_norm REAL, target_w_norm REAL, target_h_norm REAL,
      offset_dx_norm REAL, offset_dy_norm REAL,
      ocr_type         TEXT    NOT NULL DEFAULT 'text',
      search_expansion REAL    NOT NULL DEFAULT 0.04,
      region_hint      TEXT,
      enabled          INTEGER NOT NULL DEFAULT 1,
      UNIQUE(template_id, field_key)
    );
    CREATE TABLE documents (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      original_filename TEXT,
      stored_filename   TEXT,
      stored_path       TEXT,
      folder_path       TEXT,
      status            TEXT,
      supplier_name     TEXT,
      doc_date          TEXT,
      reference_number  TEXT,
      template_id       INTEGER REFERENCES templates(id)
    );
    -- migration 22: getById() reads landmarks, so the table must exist here too.
    CREATE TABLE template_landmarks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id  INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      label_text   TEXT, x_norm REAL, y_norm REAL, w_norm REAL, h_norm REAL,
      ocr_conf     REAL, page_number INTEGER DEFAULT 0
    );
    -- migration 26: create()/getById()/findByLogoHash() touch the logo-hash set.
    CREATE TABLE template_logo_hashes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      phash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(template_id, phash)
    );
  `);
  return db;
}

function main() {
  let failures = 0;
  const db = makeTestDb();

  // ── create(): slug derivation + field seeding ──────────────────────────────
  section('create(): name → slug derivation, fields seeded');
  const acmeId = templates.create(db, {
    name: 'Acme Corp Invoice!! v2',
    document_type_slug: 'invoice',
    fields: [{ field_key: 'invoice_number', anchor_label: 'Invoice No', direction: 'right' }],
  });
  const acme = templates.getById(db, acmeId);
  if (!check('slug derived from name (lowercased, punctuation collapsed)', acme.slug === 'acme_corp_invoice_v2')) failures++;
  if (!check('seeded field persisted', acme.fields.length === 1 && acme.fields[0].field_key === 'invoice_number')) failures++;

  // A second template, to prove rename/delete never touch siblings.
  const otherId = templates.create(db, { name: 'Contoso Receipt', document_type_slug: 'invoice' });
  db.prepare(`
    INSERT INTO template_field_mappings (template_id, field_key, anchor_x_norm, anchor_y_norm, anchor_w_norm, anchor_h_norm, target_x_norm, target_y_norm, target_w_norm, target_h_norm)
    VALUES (?, 'invoice_number', 0.1, 0.1, 0.1, 0.05, 0.25, 0.1, 0.15, 0.05)
  `).run(otherId);

  // ── rename(): cosmetic only — slug, fields, mappings untouched ─────────────
  section('rename(): updates display name only, leaves the functional slug alone');
  const renamed = templates.rename(db, acmeId, 'Acme Corporation — Sales Invoice');
  if (!check('name updated', renamed.name === 'Acme Corporation — Sales Invoice')) failures++;
  if (!check('slug unchanged (functional identifier untouched)', renamed.slug === 'acme_corp_invoice_v2')) failures++;
  if (!check('field rows untouched', renamed.fields.length === 1 && renamed.fields[0].field_key === 'invoice_number')) failures++;
  const otherAfterRename = templates.getById(db, otherId);
  if (!check('sibling template name untouched', otherAfterRename.name === 'Contoso Receipt')) failures++;

  // ── remove(): scoped delete, no spillover ──────────────────────────────────
  section('remove(): deletes only this template + its own rows; unlinks but never deletes documents');
  db.prepare(`
    INSERT INTO template_field_mappings (template_id, field_key, anchor_x_norm, anchor_y_norm, anchor_w_norm, anchor_h_norm, target_x_norm, target_y_norm, target_w_norm, target_h_norm)
    VALUES (?, 'invoice_number', 0.1, 0.1, 0.1, 0.05, 0.25, 0.1, 0.15, 0.05)
  `).run(acmeId);
  const linkedDoc = db.prepare(
    `INSERT INTO documents (original_filename, status, supplier_name, template_id) VALUES ('a.pdf', 'confirmed', 'Acme Corp', ?)`
  ).run(acmeId);
  const unrelatedDoc = db.prepare(
    `INSERT INTO documents (original_filename, status, supplier_name, template_id) VALUES ('b.pdf', 'confirmed', 'Other Co', ?)`
  ).run(otherId);

  templates.remove(db, acmeId);

  if (!check('template row gone', templates.getById(db, acmeId) === null)) failures++;
  if (!check('its template_fields cascade-deleted',
             db.prepare('SELECT COUNT(*) n FROM template_fields WHERE template_id = ?').get(acmeId).n === 0)) failures++;
  if (!check('its template_field_mappings cascade-deleted',
             db.prepare('SELECT COUNT(*) n FROM template_field_mappings WHERE template_id = ?').get(acmeId).n === 0)) failures++;

  const linked = db.prepare('SELECT * FROM documents WHERE id = ?').get(linkedDoc.lastInsertRowid);
  if (!check('linked document still exists (not deleted)', !!linked && linked.original_filename === 'a.pdf')) failures++;
  if (!check('linked document.template_id nulled (dangling FK cleared, not left dangling)', linked.template_id === null)) failures++;
  if (!check('linked document otherwise untouched (status/supplier preserved)',
             linked.status === 'confirmed' && linked.supplier_name === 'Acme Corp')) failures++;

  const sibling = templates.getById(db, otherId);
  if (!check('sibling template untouched', !!sibling && sibling.name === 'Contoso Receipt')) failures++;
  if (!check('sibling template keeps its own mapping',
             db.prepare('SELECT COUNT(*) n FROM template_field_mappings WHERE template_id = ?').get(otherId).n === 1)) failures++;

  const unrelated = db.prepare('SELECT * FROM documents WHERE id = ?').get(unrelatedDoc.lastInsertRowid);
  if (!check("unrelated document's template_id left intact (no spillover)", unrelated.template_id === otherId)) failures++;

  // ── Imported sample file (brand-new template, no confirmed documents yet) ──
  // Mirrors import-template-sample-file in templates/handler.js: a minimal
  // documents row is created in place (no copy) under a dedicated
  // 'template_sample' status, then pinned via setSampleDocument — proving the
  // round trip persists and that getById's sample_document projection resolves
  // it the same way it resolves a normal confirmed sample.
  section("imported sample: minimal 'template_sample' row pins and round-trips through getById");
  const blankId = templates.create(db, { name: 'Brand New Co Invoice', document_type_slug: 'invoice' });
  const sampleDoc = db.prepare(`
    INSERT INTO documents (original_filename, folder_path, status, template_id)
    VALUES ('sample-scan.pdf', 'C:\\Scans\\BrandNewCo', 'template_sample', ?)
  `).run(blankId);

  templates.setSampleDocument(db, blankId, sampleDoc.lastInsertRowid);
  const blankWithSample = templates.getById(db, blankId);
  if (!check('sample_document_id persisted on the template', blankWithSample.sample_document_id === sampleDoc.lastInsertRowid)) failures++;
  if (!check('sample_document resolves via getById (same projection as a confirmed sample)',
             !!blankWithSample.sample_document && blankWithSample.sample_document.original_filename === 'sample-scan.pdf'
             && blankWithSample.sample_document.folder_path === 'C:\\Scans\\BrandNewCo')) failures++;
  if (!check("sample_document carries the 'template_sample' status through to the renderer",
             blankWithSample.sample_document.status === 'template_sample')) failures++;

  // ── Invisibility: 'template_sample' rows must never surface where only
  // confirmed/queue-filtered documents are expected (review queue, deferred
  // queue, counts, search, get-template-sample-candidates — every one of
  // those filters with exact-match equality against a known status string).
  section("imported sample: 'template_sample' status stays invisible to status-filtered queries");
  const candidateStyleQuery = db.prepare(
    `SELECT id FROM documents WHERE template_id = ? AND status = 'confirmed'`
  ).all(blankId);
  if (!check('absent from a get-template-sample-candidates-style confirmed-only query',
             candidateStyleQuery.length === 0)) failures++;

  const reviewQueueStyleQuery = db.prepare(
    `SELECT id FROM documents WHERE status = 'needs_review'`
  ).all();
  if (!check('absent from a review-queue-style needs_review query',
             !reviewQueueStyleQuery.some(r => r.id === sampleDoc.lastInsertRowid))) failures++;

  // ── Upsert convergence (the duplication fix) ───────────────────────────────
  // _upsertTemplate (review/handler.js) is an unexported internal of the
  // confirm-review IPC handler — exercising it directly would mean mocking
  // the whole confirm flow (filing, OCR docs, learning writes). The smallest
  // faithful proxy is to mirror its exact new decision sequence here against
  // a real database, using the same templates.findByLogoHash/update/create
  // primitives and the same >= 65 confidence gate it now applies.
  function simulateUpsert(db, doc, tmpl) {
    let templateId = doc.template_id || null;
    if (!templateId && doc.logo_phash) {
      const reuse = templates.findByLogoHash(db, doc.logo_phash);
      if (reuse && reuse.confidence >= 65) templateId = reuse.id;
    }
    if (templateId) {
      templates.update(db, templateId, {
        logo_phash: doc.logo_phash, keyword_fingerprint: doc.keyword_fingerprint, fields: tmpl.fields,
      });
      return templateId;
    }
    return templates.create(db, { ...tmpl, logo_phash: doc.logo_phash, keyword_fingerprint: doc.keyword_fingerprint });
  }

  section('upsert convergence: 4 same-layout confirms reuse one template instead of spawning duplicates');
  const bigCoFields = [{ field_key: 'invoice_number', anchor_label: 'Invoice No', direction: 'right' }];
  const bigCoTmpl   = { name: 'BigCo Invoice', document_type_slug: 'invoice', fields: bigCoFields };

  // All four hashes sit within Hamming distance <= 2 of EVERY other one
  // (each flips exactly one bit off the shared "aabbccdd1122334" root, in
  // disjoint nibbles) — simulating the OCR-noise-level phash drift between
  // repeat scans/renders of the very same supplier letterhead, while the
  // logo crop itself is unchanged. All comfortably clear the >= 65 / <= 5
  // accept gate no matter which one ends up as the template's "current"
  // stored hash after each reuse overwrites it.
  // Shared, stable supplier branding (BIGCO / INVOICE / LTD) recurs on every
  // scan; the customer name, invoice number and date are per-document noise.
  const docA = { template_id: null, logo_phash: 'aabbccdd11223344', keyword_fingerprint: ['BIGCO', 'INVOICE', 'LTD', 'CUSTOMERONE',   'INV1001', '01JAN2026'] };
  const docB = { template_id: null, logo_phash: 'aabbccdd11223345', keyword_fingerprint: ['BIGCO', 'INVOICE', 'LTD', 'CUSTOMERTWO',   'INV1002', '02JAN2026'] };
  const docC = { template_id: null, logo_phash: 'aabbccdd11223144', keyword_fingerprint: ['BIGCO', 'INVOICE', 'LTD', 'CUSTOMERTHREE', 'INV1003', '03JAN2026'] };
  const docD = { template_id: null, logo_phash: 'aabbccdd11323344', keyword_fingerprint: ['BIGCO', 'INVOICE', 'LTD', 'CUSTOMERFOUR',  'INV1004', '04JAN2026'] };

  if (!check('fixture sanity: every pair of "repeat scan" hashes is within the <= 5 accept-gate distance',
             [[docA, docB], [docA, docC], [docA, docD], [docB, docC], [docB, docD], [docC, docD]]
               .every(([x, y]) => templates.hammingDistance(x.logo_phash, y.logo_phash) <= 5))) failures++;

  // Each of #2-#4 mirrors the realistic batch-processing timing gap: Stage 0
  // matched (or rather, failed to match) them against the template list as it
  // stood when the *batch* was OCR'd — before #1's confirm had created BigCo's
  // template — so each still carries template_id = null at confirm time, even
  // though a same-layout template now exists by the time it's confirmed.
  const tplA = simulateUpsert(db, docA, bigCoTmpl);
  const tplB = simulateUpsert(db, docB, bigCoTmpl);
  const tplC = simulateUpsert(db, docC, bigCoTmpl);
  const tplD = simulateUpsert(db, docD, bigCoTmpl);

  if (!check('all four confirms converge on the SAME template id (no duplicates spawned)',
             tplA === tplB && tplB === tplC && tplC === tplD)) failures++;
  if (!check('exactly one "BigCo Invoice" template exists in the database',
             db.prepare(`SELECT COUNT(*) n FROM templates WHERE name = 'BigCo Invoice'`).get().n === 1)) failures++;

  const bigCo = templates.getById(db, tplA);
  if (!check('confirmed_count reflects the 3 reuses on top of the initial create (0 -> 3)',
             bigCo.confirmed_count === 3)) failures++;
  // Identity STABILISES across confirms (the regression fix): the stored
  // fingerprint converges to the tokens that RECUR (stable branding), while
  // every sample's per-document noise is pruned away — NOT overwritten with the
  // latest sample's raw tokens. So no single customer name survives, and the
  // established logo_phash is kept rather than clobbered by each later render.
  if (!check("stored fingerprint converges to the recurring stable branding (BIGCO/INVOICE/LTD)",
             ['BIGCO', 'INVOICE', 'LTD'].every(t => bigCo.keyword_fingerprint.includes(t)))) failures++;
  if (!check("per-document noise (every sample's customer name, invoice no, date) is pruned, not accumulated",
             !['CUSTOMERONE','CUSTOMERTWO','CUSTOMERTHREE','CUSTOMERFOUR',
               'INV1001','INV1004','01JAN2026','04JAN2026'].some(t => bigCo.keyword_fingerprint.includes(t)))) failures++;
  if (!check("established logo_phash is kept stable across confirms, not overwritten by each later render",
             bigCo.logo_phash === docA.logo_phash)) failures++;

  // ── A materially different layout must still be free to start its own template ──
  section('upsert convergence: a materially different logo does not get folded into an unrelated template');
  const smallCoTmpl = { name: 'SmallCo Statement', document_type_slug: 'invoice',
                        fields: [{ field_key: 'invoice_number', anchor_label: 'Statement No', direction: 'right' }] };
  const docE = { template_id: null, logo_phash: '00112233ffeeddcc',
                 keyword_fingerprint: ['SMALLCO', 'STATEMENT', 'SOMECUSTOMER', 'STMT9001'] };

  if (!check('fixture sanity: the unrelated-supplier hash truly is far from BigCo\'s (> 5, i.e. would NOT pass the reuse gate)',
             templates.hammingDistance(docE.logo_phash, bigCo.logo_phash) > 5)) failures++;

  const tplE = simulateUpsert(db, docE, smallCoTmpl);
  if (!check('a materially different logo creates its OWN template rather than reusing BigCo\'s',
             tplE !== tplA)) failures++;
  if (!check('both supplier templates now coexist, untouched by each other',
             db.prepare(`SELECT COUNT(*) n FROM templates WHERE name IN ('BigCo Invoice','SmallCo Statement')`).get().n === 2
             && templates.getById(db, tplA).logo_phash === docA.logo_phash)) failures++;

  // ── Identity-stability helpers (the regression fix, tested in isolation) ──────
  // Pure functions, no DB: stabiliseFingerprint / chooseLogoPhash are the
  // reusable rules update() applies on every confirm. Reproduces the real
  // Document-Solutions case where confirming a noisy scan overwrote a known-good
  // fingerprint with OCR garble and stranded the learned anchors.
  section('identity stability: a noisy confirm cannot erase a known-good keyword fingerprint');

  const goodIdentity = ['DOCUMENT','SOLUTIONS','Ticket','Location','Work','Address','Beaumont','Care','Homes','Ltd'];
  const noisySample  = ['SERVICE','WORKSHEET','bol','OOH','DOCUMENT','OLUTIONS','TAs','Ticket','Location','Work'];
  const merged = templates.stabiliseFingerprint(goodIdentity, noisySample);

  if (!check('intersection keeps the tokens that RECUR across both (DOCUMENT/Ticket/Location/Work)',
             ['DOCUMENT','Ticket','Location','Work'].every(t => merged.includes(t)))) failures++;
  if (!check('non-reproducible OCR garble from the one noisy sample is dropped (bol/OOH/OLUTIONS/TAs)',
             !['bol','OOH','OLUTIONS','TAs','SERVICE','WORKSHEET'].some(t => merged.includes(t)))) failures++;
  if (!check('single-sample customer/address leakage is dropped (Beaumont/Care/Homes)',
             !['Beaumont','Care','Homes'].some(t => merged.includes(t)))) failures++;
  if (!check('the merged identity still has enough tokens to identify (>= floor)',
             merged.length >= 3)) failures++;

  // Floor guard: when the intersection is too thin to identify, keep the proven
  // identity rather than collapse to it.
  const eroded = templates.stabiliseFingerprint(['ALPHA','BETA','GAMMA','DELTA'], ['ALPHA','ZETA','ETA','THETA']);
  if (!check('a confirm sharing too few tokens (1 < floor) keeps the established identity, does not erode it',
             eroded.length === 4 && eroded.includes('BETA') && eroded.includes('DELTA'))) failures++;

  // Seeding + empties.
  if (!check('first identity (nothing established) is seeded from the sample as-is',
             JSON.stringify(templates.stabiliseFingerprint([], ['X','Y','Z'])) === JSON.stringify(['X','Y','Z']))) failures++;
  if (!check('an empty/unreadable incoming sample never wipes the established identity',
             JSON.stringify(templates.stabiliseFingerprint(['X','Y','Z'], [])) === JSON.stringify(['X','Y','Z']))) failures++;
  if (!check('case-insensitive intersection (matcher lowercases both sides) — "work" matches "Work"',
             templates.stabiliseFingerprint(['DOCUMENT','Ticket','Work','Location'], ['document','ticket','work','location']).length >= 3)) failures++;

  section('identity stability: an established logo_phash is not clobbered on every confirm');
  if (!check('a populated logo_phash is kept when a later confirm brings a drifted hash',
             templates.chooseLogoPhash('aabbccdd11223344', 'ffee00112233aabb') === 'aabbccdd11223344')) failures++;
  if (!check('an empty logo_phash IS seeded from the first sample that has one',
             templates.chooseLogoPhash('', 'ffee00112233aabb') === 'ffee00112233aabb'
             && templates.chooseLogoPhash(null, 'ffee00112233aabb') === 'ffee00112233aabb')) failures++;

  console.log();
  if (failures) {
    console.log(`${failures} check(s) failed — templates create/rename/remove regressed.`);
    process.exitCode = 1;
    return;
  }
  console.log('All checks passed — templates create/rename/remove behave as expected.');
}

main();
