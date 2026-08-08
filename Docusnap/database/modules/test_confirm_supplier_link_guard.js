'use strict';
/*
 * test_confirm_supplier_link_guard.js — Oracle condition A on the template-misfile fix
 * (TEMPLATE_SUPPLIER_LINK_GUARD, 2026-07-20): the confirm-time reinforcement loop.
 *
 * A doc Stage-0-matched to ANOTHER supplier's template keeps that template_id through confirm —
 * Part D detaches on TYPE mismatch only, so an invoice mis-matched to a foreign invoice template
 * survives. The stale link then poisons the wrong template through FOUR doors:
 *   plain confirm:  (1) live confirmed_count (matcher tiebreaks, 277a107)
 *                   (2) dominant_supplier dilution (identity keying for the branding banks/gates)
 *                   (3) captureSample — the foreign page becomes a LANDMARK SAMPLE of the template
 *   taught confirm: (4) templates.update — phash APPENDED into the wrong reference set (the
 *                       misfiled docs sit at hamming 4-6, inside LOGO_APPEND_BAND), fingerprint
 *                       intersect, fields rewrite, stored count bump.
 * This test pins both arms of the guard: the reviewService confirm-seam detach (arm 1) and the
 * _upsertTemplate reuse refusal (arm 2). Proven RED against pre-guard HEAD.
 *
 *   ELECTRON_RUN_AS_NODE=1 <electron> database/modules/test_confirm_supplier_link_guard.js
 */
const Database  = require('better-sqlite3');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const { runMigrations } = require('../index');
const documents = require('./documents');
const templates = require('./templates');
const { createReviewService } = require('../../src/services/reviewService');
const { _upsertTemplate } = require('../../src/modules/review/handler.js');

let failures = 0;
function check(label, cond) { console.log((cond ? '  OK  ' : '  BAD ') + label); if (!cond) failures++; return cond; }
function section(t) { console.log('\n' + t); }
const flush = () => new Promise(r => setTimeout(r, 0));

const COPPER = 'Copperfield Electrical';
const VELLUM = 'Vellum & Crane Stationers';
const LOGO      = 'bc4cc3b3c7385c46';   // the live tpl-2 primary
const LOGO_NEAR = 'bc4cc3b3c7385c40';   // hamming 4 from LOGO — inside the strict accept AND the append band

// ── §1 arm 1: the reviewService confirm-seam detach ─────────────────────────────────────────────
(async () => {
  section('§1 arm 1 — plain corrected confirm detaches a supplier-disjoint template link');
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1, 'Invoice', 'invoice', 1)").run();

  const tplId = templates.create(db, {
    name: COPPER, document_type_slug: 'invoice', logo_phash: LOGO,
    keyword_fingerprint: ['Copperfield', 'Electrical', 'Faraday', 'Industrial', 'Park', 'Coventry', 'INV'],
    fields: [{ field_key: 'supplier_name', fixed_value: COPPER, is_variable: 0 }],
  });
  // Dominant evidence: 4 genuine Copperfield docs confirmed under the template.
  for (let i = 0; i < 4; i++) {
    const id = Number(documents.insert(db, { original_filename: `c${i}.pdf`, folder_path: '/in', status: 'confirmed' }).lastInsertRowid);
    documents.update(db, id, { template_id: tplId, supplier_name: COPPER });
  }
  const newLinkedDoc = (status = 'needs_review') => {
    const id = Number(documents.insert(db, { original_filename: 'v.pdf', folder_path: '/in', status }).lastInsertRowid);
    documents.update(db, id, { template_id: tplId });
    return id;
  };

  const calls = { captured: 0 };
  const svc = createReviewService({
    documents, templates,
    learning: { getSetting: () => '/out', saveCorrections: () => {} },
    doctypes: { getWithFields: () => ({ id: 1, name: 'Invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date' }) },
    filing: {
      normaliseDate: (v) => v,
      commitDocument: async () => ({ success: true, filename: 'F.pdf', filePath: '/out/F.pdf', metadataPath: '/out/.m/F.xml', srcPath: '/in/v.pdf' }),
    },
    fs: { existsSync: () => false, unlinkSync: () => {} },
    path, logger: null, audit: () => {},
    captureSample: async () => { calls.captured++; },
    notifyCounts: () => {}, releaseDelayMs: 0,
  });
  const payload = (id, supplier) => ({
    document_id: id, folder_path: '/in', original_filename: 'v.pdf',
    corrections: {}, allValues: { supplier_name: supplier, invoice_number: 'INV-1', invoice_date: '01-01-2026' },
    supplier_name: supplier, document_type: 'Invoice', document_type_slug: 'invoice', taught_fields: [],
  });
  const linkOf = (id) => db.prepare('SELECT template_id FROM documents WHERE id = ?').get(id).template_id;

  // The incident shape: a foreign (Vellum) doc linked to the Copperfield template.
  const d1 = newLinkedDoc();
  const r1 = await svc.confirm(db, { username: 'u', role: 'admin' }, payload(d1, VELLUM));
  await flush();
  check('confirm succeeds', !!r1 && r1.ok === true);
  check('DETACH: foreign-supplier confirm clears the stale template link', linkOf(d1) === null);
  check('captureSample never ran for the wrong template (no foreign landmark sample)', calls.captured === 0);
  const dom = templates.getDominantSupplier(db, tplId);
  check('dominant_supplier distribution undiluted (still 4/4 Copperfield)',
    !!dom && dom.value === COPPER && dom.total === 4);
  check('live confirmed_count for the wrong template unchanged (4, not 5)',
    (templates.liveConfirmedCounts(db) || new Map()).get(tplId) === 4);

  // Variant spelling shares a token → NOT disjoint → link kept (precision-first).
  const d2 = newLinkedDoc();
  await svc.confirm(db, { username: 'u', role: 'admin' }, payload(d2, 'Copperfield Electrical Ltd'));
  await flush();
  check('variant of the SAME supplier keeps the link (shared token ⇒ not disjoint)', linkOf(d2) === tplId);

  // Unjudgeable template identity (no confirmed docs, no frozen supplier) → keep.
  const bareId = templates.create(db, { name: 'Bare', document_type_slug: 'invoice', logo_phash: null, keyword_fingerprint: [], fields: [] });
  const d3 = Number(documents.insert(db, { original_filename: 'b.pdf', folder_path: '/in', status: 'needs_review' }).lastInsertRowid);
  documents.update(db, d3, { template_id: bareId });
  await svc.confirm(db, { username: 'u', role: 'admin' }, payload(d3, VELLUM));
  await flush();
  check('identity-less template is unjudgeable ⇒ link kept (fail toward today)', linkOf(d3) === bareId);

  // Kill switch restores pre-guard behaviour byte-identically.
  process.env.TEMPLATE_SUPPLIER_LINK_GUARD = '0';
  const d4 = newLinkedDoc();
  await svc.confirm(db, { username: 'u', role: 'admin' }, payload(d4, VELLUM));
  await flush();
  delete process.env.TEMPLATE_SUPPLIER_LINK_GUARD;
  check('kill switch off ⇒ stale link kept (pre-guard behaviour)', linkOf(d4) === tplId);

  // ── §3 arm 1 — THE SELF-REFERENCE (TEMPLATE_GUARD_SELF_INDEPENDENT, red-first on HEAD) ────────
  // §1 seeded FOUR genuine Copperfield confirms, so the intruder's self-vote is out-voted and the
  // bug is masked. The real incident is a template whose ONLY confirmed doc would be the intruder:
  // the guard runs AFTER the doc is confirmed + linked + supplier_name=VELLUM, so a plain
  // establishedIdentity counts the doc AGAINST ITSELF (dominant=VELLUM), compares VELLUM to VELLUM,
  // finds them equal, and never detaches — permanently poisoning the template's dominant. Judging
  // identity from the OTHER confirmed docs (here: none → the frozen COPPER value) detaches instead.
  section('§3 arm 1 — self-reference: first foreign confirm on a frozen-only template still detaches');
  const frozenId = (name) => templates.create(db, {
    name, document_type_slug: 'invoice', logo_phash: LOGO_NEAR,
    keyword_fingerprint: ['Copperfield', 'Electrical', 'Coventry'],
    fields: [{ field_key: 'supplier_name', fixed_value: COPPER, is_variable: 0 }],
  });
  const linkedTo = (tid, fn = 's3.pdf') => {
    const id = Number(documents.insert(db, { original_filename: fn, folder_path: '/in', status: 'needs_review' }).lastInsertRowid);
    documents.update(db, id, { template_id: tid });
    return id;
  };
  const fTpl = frozenId('Frozen Copper A');
  const s3 = linkedTo(fTpl);
  await svc.confirm(db, { username: 'u', role: 'admin' }, payload(s3, VELLUM));
  await flush();
  check('SELF-REF DETACH: a foreign confirm on a template with NO other confirmed docs still detaches',
    linkOf(s3) === null);
  check('SELF-REF: the template dominant is NOT poisoned to the intruder (self excluded)',
    (templates.getDominantSupplier(db, fTpl) || {}).value !== VELLUM);

  // Kill-switch OFF ⇒ the self-reference bug returns verbatim (the poisoned link is KEPT). This is
  // the byte-identical-OFF gate for the new switch, and proves the pins above are red-first.
  const fTpl2 = frozenId('Frozen Copper B');
  const s3b = linkedTo(fTpl2, 's3b.pdf');
  process.env.TEMPLATE_GUARD_SELF_INDEPENDENT = '0';
  await svc.confirm(db, { username: 'u', role: 'admin' }, payload(s3b, VELLUM));
  await flush();
  delete process.env.TEMPLATE_GUARD_SELF_INDEPENDENT;
  check('SELF-REF kill switch off ⇒ pre-fix bug returns (self-poisoned link KEPT)', linkOf(s3b) === fTpl2);

  // TRADE-OFF PIN (a): a template's very first confirm by its GENUINE supplier KEEPS the link — the
  // self-exclude falls to the frozen COPPER value, disjoint(COPPER,COPPER) is false. Proves we did
  // not turn every first-confirm into a detach.
  const fTpl3 = frozenId('Frozen Copper C');
  const s3c = linkedTo(fTpl3, 's3c.pdf');
  await svc.confirm(db, { username: 'u', role: 'admin' }, payload(s3c, COPPER));
  await flush();
  check('TRADE-OFF: a genuine first-confirm (matching frozen identity) KEEPS the link', linkOf(s3c) === fTpl3);

  // TRADE-OFF PIN (b): a name-only cold template (no frozen supplier, no other confirmed docs) KEEPS
  // the link even for a disjoint issuer — self-exclude → null → unjudgeable → keep. Proves we did
  // NOT add a `name` fallback: a dev who "fixes" the fully-cold residual by consulting the template
  // name would turn this red by over-detaching a legitimate cold first-confirm.
  const nameOnly = templates.create(db, { name: COPPER, document_type_slug: 'invoice', logo_phash: LOGO_NEAR, keyword_fingerprint: [], fields: [] });
  const s3d = linkedTo(nameOnly, 's3d.pdf');
  await svc.confirm(db, { username: 'u', role: 'admin' }, payload(s3d, VELLUM));
  await flush();
  check('TRADE-OFF: name-only cold template is unjudgeable ⇒ link KEPT (no name fallback)', linkOf(s3d) === nameOnly);

  // NO-RIPPLE PIN: with NO excludeDocId the tally is byte-identical to the pre-fix positional query —
  // getAll and the Python matcher's dominant_supplier are untouched by this change.
  const domA = templates.getDominantSupplier(db, tplId);
  const domB = templates.getDominantSupplier(db, tplId, null);
  const domC = templates.getDominantSupplier(db, tplId, 999999);   // exclude a non-existent doc
  // The 4 genuine Copperfield confirms still dominate (over §1's kept 'Ltd' variant + kill-switch
  // Vellum), so value stays COPPER, count 4 — total is whatever §1 accumulated; the point is that
  // the three exclude-variants are IDENTICAL, so getAll (no-exclude) is untouched by the change.
  check('NO-RIPPLE: no-exclude dominant is still COPPER (count 4)', !!domA && domA.value === COPPER && domA.count === 4);
  check('NO-RIPPLE: excludeDocId=null is byte-identical to no-exclude',
    !!domB && domB.value === domA.value && domB.count === domA.count && domB.total === domA.total);
  check('NO-RIPPLE: excluding a non-existent doc is byte-identical to no-exclude',
    !!domC && domC.value === domA.value && domC.count === domA.count && domC.total === domA.total);

  // ── §2 arm 2: _upsertTemplate refuses to REUSE a supplier-disjoint template ──────────────────
  section('§2 arm 2 — taught-confirm/promote must not reinforce a foreign template');
  const makeDb = () => {
    const fdb = new Database(':memory:');
    fdb.pragma('foreign_keys = ON');
    fdb.exec(`
      CREATE TABLE templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
        document_type_slug TEXT, logo_phash TEXT, keyword_fingerprint TEXT,
        sample_document_id INTEGER, confirmed_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE template_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
        field_key TEXT NOT NULL, anchor_label TEXT, direction TEXT NOT NULL DEFAULT 'right',
        fixed_value TEXT, is_variable INTEGER NOT NULL DEFAULT 1, fixed_locked INTEGER NOT NULL DEFAULT 0,
        UNIQUE(template_id, field_key)
      );
      CREATE TABLE documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT, original_filename TEXT, status TEXT,
        document_type_id INTEGER, template_id INTEGER, logo_phash TEXT, logo_detail_hash TEXT,
        keyword_fingerprint TEXT, supplier_name TEXT
      );
      CREATE TABLE template_field_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
        field_key TEXT NOT NULL, page_number INTEGER NOT NULL DEFAULT 0, anchor_text TEXT,
        anchor_x_norm REAL, anchor_y_norm REAL, anchor_w_norm REAL, anchor_h_norm REAL,
        target_x_norm REAL, target_y_norm REAL, target_w_norm REAL, target_h_norm REAL,
        offset_dx_norm REAL, offset_dy_norm REAL, ocr_type TEXT NOT NULL DEFAULT 'text',
        search_expansion REAL NOT NULL DEFAULT 0.04, region_hint TEXT, enabled INTEGER NOT NULL DEFAULT 1,
        UNIQUE(template_id, field_key)
      );
      CREATE TABLE template_landmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
        label_text TEXT, x_norm REAL, y_norm REAL, w_norm REAL, h_norm REAL,
        ocr_conf REAL, page_number INTEGER
      );
      CREATE TABLE template_logo_hashes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
        phash TEXT, detail_hash TEXT, UNIQUE(template_id, phash)
      );
      CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, display_value TEXT);
      CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, corrected_value TEXT);
    `);
    return fdb;
  };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slg-parte-'));
  const ctx = { path, fs, templatesDir: () => tmpDir };
  const INV_DT = {
    id: 1, name: 'Invoice', slug: 'invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date',
    fields: [{ key: 'supplier_name', is_variable: 0 }, { key: 'invoice_number', is_variable: 1 }, { key: 'invoice_date', is_variable: 1 }],
  };
  const vals = (supplier) => ({ supplier_name: supplier, invoice_number: 'INV-9', invoice_date: '02-02-2026' });
  const mkForeignTpl = (fdb) => {
    const id = templates.create(fdb, {
      name: COPPER, document_type_slug: 'invoice', logo_phash: LOGO,
      keyword_fingerprint: ['Copperfield', 'Electrical', 'Coventry'],
      fields: [{ field_key: 'supplier_name', fixed_value: COPPER, is_variable: 0 }],
    });
    for (let i = 0; i < 2; i++) {
      fdb.prepare("INSERT INTO documents (original_filename, status, template_id, supplier_name) VALUES (?, 'confirmed', ?, ?)")
        .run(`c${i}.pdf`, id, COPPER);
    }
    return id;
  };
  const mkDoc = (fdb, templateId, logo) => Number(fdb.prepare(
    "INSERT INTO documents (original_filename, status, document_type_id, template_id, logo_phash, keyword_fingerprint) " +
    "VALUES ('v.pdf', 'needs_review', 1, ?, ?, '[]')").run(templateId, logo).lastInsertRowid);
  const logoRows = (fdb, id) => fdb.prepare('SELECT COUNT(*) n FROM template_logo_hashes WHERE template_id = ?').get(id).n;
  const storedCount = (fdb, id) => fdb.prepare('SELECT confirmed_count n FROM templates WHERE id = ?').get(id).n;

  // E1: linked foreign template, same type — detach + CREATE, no reinforcement.
  let fdb = makeDb();
  let foreign = mkForeignTpl(fdb);
  let docA = mkDoc(fdb, foreign, LOGO_NEAR);
  const before = { logos: logoRows(fdb, foreign), count: storedCount(fdb, foreign) };
  const rA = await _upsertTemplate(ctx, fdb, docA, { allValues: vals(VELLUM), document_type_slug: 'invoice', supplier_name: VELLUM, dtInfo: INV_DT });
  check('E1: foreign-supplier taught-confirm CREATES its own template (not reuse)', !!rA && rA.created === true);
  check('E1: doc re-points to the NEW template', fdb.prepare('SELECT template_id FROM documents WHERE id=?').get(docA).template_id === rA.templateId && rA.templateId !== foreign);
  check('E1: foreign template phash set NOT appended (the collision does not get stronger)', logoRows(fdb, foreign) === before.logos);
  check('E1: foreign template stored count NOT bumped', storedCount(fdb, foreign) === before.count);
  check('E1: foreign template supplier field untouched',
    fdb.prepare("SELECT fixed_value FROM template_fields WHERE template_id=? AND field_key='supplier_name'").get(foreign).fixed_value === COPPER);

  // E2: a variant of the SAME supplier still reuses (no over-detach).
  fdb = makeDb();
  foreign = mkForeignTpl(fdb);
  const docB = mkDoc(fdb, foreign, LOGO_NEAR);
  const rB = await _upsertTemplate(ctx, fdb, docB, { allValues: vals('Copperfield Electrical Ltd'), document_type_slug: 'invoice', supplier_name: 'Copperfield Electrical Ltd', dtInfo: INV_DT });
  check('E2: same-supplier variant still REUSES (created:false)', !!rB && rB.created === false);

  // E3: unlinked doc whose logo would findByLogoHash-REACQUIRE the foreign template.
  fdb = makeDb();
  foreign = mkForeignTpl(fdb);
  const docC = mkDoc(fdb, null, LOGO_NEAR);
  const rC = await _upsertTemplate(ctx, fdb, docC, { allValues: vals(VELLUM), document_type_slug: 'invoice', supplier_name: VELLUM, dtInfo: INV_DT });
  check('E3: logo-band reacquire of a supplier-disjoint template is REFUSED (created:true)', !!rC && rC.created === true);
  check('E3: foreign template phash set NOT appended via the reacquire door', logoRows(fdb, foreign) === before.logos);

  // E4: kill switch restores reuse byte-identically.
  fdb = makeDb();
  foreign = mkForeignTpl(fdb);
  const docD = mkDoc(fdb, foreign, LOGO_NEAR);
  process.env.TEMPLATE_SUPPLIER_LINK_GUARD = '0';
  const rD = await _upsertTemplate(ctx, fdb, docD, { allValues: vals(VELLUM), document_type_slug: 'invoice', supplier_name: VELLUM, dtInfo: INV_DT });
  delete process.env.TEMPLATE_SUPPLIER_LINK_GUARD;
  check('E4: kill switch off ⇒ foreign template reused (pre-guard behaviour)', !!rD && rD.created === false);

  // E5: identity judged from the FROZEN supplier value when no confirmed docs exist.
  fdb = makeDb();
  const frozenOnly = templates.create(fdb, {
    name: 'X', document_type_slug: 'invoice', logo_phash: LOGO, keyword_fingerprint: [],
    fields: [{ field_key: 'supplier_name', fixed_value: COPPER, is_variable: 0 }],
  });
  const docE = mkDoc(fdb, frozenOnly, LOGO_NEAR);
  const rE = await _upsertTemplate(ctx, fdb, docE, { allValues: vals(VELLUM), document_type_slug: 'invoice', supplier_name: VELLUM, dtInfo: INV_DT });
  check('E5: frozen supplier value alone is enough identity to refuse the reuse', !!rE && rE.created === true);

  // §4 arm 2 — THE SELF-REFERENCE in the taught-confirm path (red-first on HEAD). The E-tests above
  // use needs_review docs, so the doc under judgement is never counted and the self-reference is
  // masked — but production runs _upsertTemplate from the DETACHED onTaughtConfirm hook AFTER the
  // doc is confirmed. Reproduce that state: the linked doc is already status='confirmed' with
  // supplier_name=VELLUM, on a frozen-COPPER template with no OTHER confirmed docs. On HEAD the
  // confirmed self IS counted → dominant=VELLUM → establishedIdentity=VELLUM → _supplierLinkOk true
  // → self-reuse (created:false, the poisoning). Self-excluded → frozen COPPER → detach → create.
  section('§4 arm 2 — self-reference: _upsertTemplate on an ALREADY-CONFIRMED foreign doc still detaches');
  fdb = makeDb();
  const frozen4 = templates.create(fdb, {
    name: 'X4', document_type_slug: 'invoice', logo_phash: LOGO, keyword_fingerprint: [],
    fields: [{ field_key: 'supplier_name', fixed_value: COPPER, is_variable: 0 }],
  });
  const logos4Before = logoRows(fdb, frozen4), count4Before = storedCount(fdb, frozen4);
  const docS4 = Number(fdb.prepare(
    "INSERT INTO documents (original_filename, status, document_type_id, template_id, logo_phash, keyword_fingerprint, supplier_name) " +
    "VALUES ('s4.pdf', 'confirmed', 1, ?, ?, '[]', ?)").run(frozen4, LOGO_NEAR, VELLUM).lastInsertRowid);
  const rS4 = await _upsertTemplate(ctx, fdb, docS4, { allValues: vals(VELLUM), document_type_slug: 'invoice', supplier_name: VELLUM, dtInfo: INV_DT });
  check('SELF-REF arm 2: an already-confirmed foreign doc still detaches + CREATES (not self-reuse)', !!rS4 && rS4.created === true);
  check('SELF-REF arm 2: foreign template phash NOT appended', logoRows(fdb, frozen4) === logos4Before);
  check('SELF-REF arm 2: foreign template stored count NOT bumped', storedCount(fdb, frozen4) === count4Before);

  // Kill-switch OFF ⇒ the arm-2 self-reference bug returns verbatim (self-reuse, created:false).
  fdb = makeDb();
  const frozen4b = templates.create(fdb, {
    name: 'X4b', document_type_slug: 'invoice', logo_phash: LOGO, keyword_fingerprint: [],
    fields: [{ field_key: 'supplier_name', fixed_value: COPPER, is_variable: 0 }],
  });
  const docS4b = Number(fdb.prepare(
    "INSERT INTO documents (original_filename, status, document_type_id, template_id, logo_phash, keyword_fingerprint, supplier_name) " +
    "VALUES ('s4b.pdf', 'confirmed', 1, ?, ?, '[]', ?)").run(frozen4b, LOGO_NEAR, VELLUM).lastInsertRowid);
  process.env.TEMPLATE_GUARD_SELF_INDEPENDENT = '0';
  const rS4b = await _upsertTemplate(ctx, fdb, docS4b, { allValues: vals(VELLUM), document_type_slug: 'invoice', supplier_name: VELLUM, dtInfo: INV_DT });
  delete process.env.TEMPLATE_GUARD_SELF_INDEPENDENT;
  check('SELF-REF arm 2 kill switch off ⇒ pre-fix bug returns (self-reuse, created:false)', !!rS4b && rS4b.created === false);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' check(s) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
