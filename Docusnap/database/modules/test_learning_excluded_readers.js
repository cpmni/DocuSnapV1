'use strict';
/*
 * test_learning_excluded_readers.js — PINs for the Learning Repair "start fresh" HARD predicate
 * (slice 0: mig 90 `documents.learning_excluded_at` + machine_vias.learningExcludedSql; gary design →
 * Oracle SIGN-OFF-W/COND 2026-08-26; switch DEFAULT ON, inert until a document is stamped).
 *
 * A stamped document stays FILED, SEARCHABLE and REPAIRABLE but STOPS TEACHING: every learning-feeding
 * reader of status='confirmed' rows carries the ONE fragment; the search / browse / counter / writer
 * readers must NOT. machine_vias.js houses two sentinel families (the SOFT machine-via post-filter and
 * this HARD predicate); this suite enumerates the HARD one per site — source contract (with the alias
 * each site must use), a positive-control behaviour run on a mig-90 fixture, the kill switch both ways,
 * and the pre-mig-90 (column-absent) fixture where the fragment must be empty and nothing may throw.
 *
 * Run:  ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_learning_excluded_readers.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const learning = require('./learning');
const trust = require('./trust');
const templates = require('./templates');
const documents = require('./documents');
const typeSplit = require('./typeSplit');
const namePresence = require('./namePresence');
const typePresence = require('./typePresence');
const templateMerge = require('./templateMerge');
const repairSuspects = require('../../src/services/repairSuspects');
const { _buildTemplateFields } = require('../../src/modules/review/handler');
const { learningExcludedSql, learningExcludeEnabled, _hasLearningExcludedColumn } = require('./machine_vias');

let passed = 0, failed = 0;
const check = (name, ok) => {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL ${name}`); }
};

const REPO = path.join(__dirname, '..', '..');
// CRLF trap (this checkout is core.autocrlf=true): normalise BEFORE slicing on '\n}'.
const src = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');
// The body of a top-level `function NAME(` up to the first column-0 closing brace.
function fnBody(text, name) {
  const i = text.indexOf(`function ${name}(`);
  if (i < 0) return null;
  const j = text.indexOf('\n}', i);
  return text.slice(i, j < 0 ? text.length : j + 2);
}
const count = (text, needle) => text.split(needle).length - 1;

console.log('1. SOURCE CONTRACT — every learning-feeding reader carries the ONE fragment, with the alias its query uses');
{
  const SITES = [
    // [file, function, the exact call form (alias!), minimum occurrences inside that function]
    ['database/modules/learning.js',     'findNearMatchIdentity',       "learningExcludedSql(db, '')", 1],   // bare FROM documents
    ['database/modules/learning.js',     'getFieldFormats',             'learningExcludedSql(db)',     1],
    ['database/modules/learning.js',     'getFieldValueHistory',        'learningExcludedSql(db)',     1],
    ['database/modules/learning.js',     'getPrefixModelForScope',      'learningExcludedSql(db)',     1],
    ['database/modules/learning.js',     'getDocumentsForFieldValue',   'learningExcludedSql(db)',     1],
    ['database/modules/trust.js',        'scopeTrust',                  'learningExcludedSql(db)',     1],   // _confirmedSql: window AND span
    ['database/modules/trust.js',        'listGraduatedScopes',         'learningExcludedSql(db)',     1],
    ['database/modules/templates.js',    'liveConfirmedCounts',         "learningExcludedSql(db, '')", 1],
    ['database/modules/templates.js',    'confirmedDocCount',           "learningExcludedSql(db, '')", 1],
    ['database/modules/templates.js',    'getDominantSupplier',         "learningExcludedSql(db, '')", 1],
    ['database/modules/namePresence.js', 'supplierNamePresenceRatio',   "learningExcludedSql(db, '')", 1],
    ['database/modules/typePresence.js', 'templateTypeHeadingPresence', "learningExcludedSql(db, '')", 1],
    ['database/modules/typeSplit.js',    'checkTypeSplit',              'learningExcludedSql(db)',     1],
    ['database/modules/templateMerge.js','planBackfill',                'learningExcludedSql(db)',     1],
    ['database/modules/documents.js',    'getFieldValueSuggestions',    'learningExcludedSql(db)',     1],
    ['src/modules/review/handler.js',    '_fieldsWithMultipleConfirmedValues', 'learningExcludedSql(db)', 1],
    ['src/services/repairSuspects.js',   'computeSuspects',             'learningExcludedSql(db)',     2],
  ];
  for (const [file, fn, form, n] of SITES) {
    const body = fnBody(src(file), fn);
    check(`${file} ${fn}: ${form} x>=${n} inside the function`, body != null && count(body, form) >= n);
  }
  // The hold-reason IPC (get-auto-file-reason): TWO bare-table scope counts. Oracle (vi): the fragment sits
  // AFTER the supplier clause, so test_cold_start_countdown.js's <=120-char regex between
  // `document_type_id = ?` and `supplier_name` keeps holding.
  const h = src('src/modules/review/handler.js');
  const ipc = h.slice(h.indexOf("ipcMain.handle('get-auto-file-reason'"), h.indexOf("ipcMain.handle('get-scope-readiness'"));
  check('get-auto-file-reason: both scope counts carry the bare-table form', count(ipc, "learningExcludedSql(db, '')") === 2);
  check('get-auto-file-reason: the fragment sits AFTER the supplier clause (Oracle vi)',
        (ipc.match(/LOWER\(TRIM\(supplier_name\)\) = LOWER\(TRIM\(\?\)\)\$\{learningExcludedSql\(db, ''\)\}/g) || []).length === 2);
  check('cold-start countdown regex still holds (<=120 chars between the type clause and supplier_name)',
        /status = 'confirmed' AND document_type_id = \?[\s\S]{0,120}supplier_name/.test(h));
  // Every threaded file imports the ONE predicate — no inline copy of the filter anywhere.
  for (const f of ['database/modules/learning.js', 'database/modules/trust.js', 'database/modules/templates.js',
                   'database/modules/namePresence.js', 'database/modules/typePresence.js', 'database/modules/typeSplit.js',
                   'database/modules/templateMerge.js', 'database/modules/documents.js']) {
    check(`${f} imports learningExcludedSql from ./machine_vias`,
          /\{[^}]*learningExcludedSql[^}]*\}\s*=\s*require\('\.\/machine_vias'\)/.test(src(f)));
  }
  check('review/handler.js imports it from database/modules/machine_vias',
        /learningExcludedSql[^\n]*require\('\.\.\/\.\.\/\.\.\/database\/modules\/machine_vias'\)/.test(h));
  check('repairSuspects.js imports it from database/modules/machine_vias',
        /learningExcludedSql[^\n]*require\('\.\.\/\.\.\/database\/modules\/machine_vias'\)/.test(src('src/services/repairSuspects.js')));
  check('the FILTER literal lives ONLY in machine_vias.js (no inline copy in any production file)', (() => {
    let hits = 0;
    const scan = dir => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) { if (!/node_modules|__pycache__/.test(f.name)) scan(p); }
        else if (/\.js$/.test(f.name) && !/^test_/.test(f.name) && f.name !== 'machine_vias.js'
                 && /learning_excluded_at IS NULL/.test(fs.readFileSync(p, 'utf8'))) hits++;
      }
    };
    for (const r of ['database', 'src']) scan(path.join(REPO, r));
    return hits === 0;
  })());
}

console.log('2. NEGATIVE — the readers that must NOT carry it (a stamped document stays filed, searchable, repairable)');
{
  const d = src('database/modules/documents.js');
  for (const fn of ['search', 'getConfirmedDocsForScope', 'getConfirmedDocsByIds', 'getReviewCount', 'getReviewSplit',
                    'getDeletedQueue', 'getDeletedCount', 'getFiledCounts', 'requeueConfirmedDocsForScope', 'deconfirmDocument']) {
    const body = fnBody(d, fn);
    check(`documents.${fn} is untouched`, body != null && body.length > 40 && !body.includes('learningExcludedSql('));
  }
  const l = src('database/modules/learning.js');
  for (const fn of ['purgeFieldValue', 'renameFieldValue', 'renameSupplier']) {
    const body = fnBody(l, fn);
    check(`learning.${fn} (a WRITER — acts on everything) is untouched`, body != null && body.length > 40 && !body.includes('learningExcludedSql('));
  }
  for (const f of ['src/services/searchService.js', 'src/modules/search/handler.js', 'src/modules/workflow/handler.js']) {
    const p = path.join(REPO, f);
    check(`${f} never references the predicate (search / dashboard / workflow)`, fs.existsSync(p) && !src(f).includes('learningExcludedSql'));
  }
  // Positive control for the slicer itself: the SAME helper must SEE the fragment where it is — an absence
  // assertion is otherwise satisfied by a mis-sliced body (the vacuous-pin trap).
  check('control: the slicer sees the fragment in documents.getFieldValueSuggestions',
        (fnBody(d, 'getFieldValueSuggestions') || '').includes('learningExcludedSql('));
}

// ── Fixture: ONE sender × invoice, FIVE human confirms (A B C E F), graduated at W=3 (trust._configuredWindow
// clamps the dial to >=3), a template linking all five, a no-op correction on A (exercises the corrections
// join without revoking trust), two distinct `site` values on A/B (the type-wide freeze judgement), and a
// QUEUED doc Q the type-ahead is asked from. FIVE because the prefix model (prefix_outlier.buildScopeRec)
// needs DOMINANT_MIN_COUNT=5 confirms to exist at all — one stamp then drops it below its own floor.
const SUP = 'Anconia Corporation';
const ALL = ['INV1001', 'INV1002', 'INV1003', 'INV1004', 'INV1005'];
// runMigrations does NOT seed the built-in types (open() does, index.js) — seed the real Invoice shape
// (three REQUIRED fields) the same way on both fixtures.
function seedInvoiceType(db) {
  const inv = db.prepare("INSERT INTO document_types (name, slug, ref_field_key, date_field_key, built_in) VALUES ('Invoice','invoice','invoice_number','invoice_date',1)").run().lastInsertRowid;
  const addF = db.prepare('INSERT INTO fields (document_type_id, key, label, type, required, built_in) VALUES (?,?,?,?,1,1)');
  addF.run(inv, 'supplier_name', 'Document Issuer', 'text');
  addF.run(inv, 'invoice_date', 'Invoice Date', 'date');
  addF.run(inv, 'invoice_number', 'Invoice Number', 'text');
  return inv;
}
function seedScope(db) {
  const inv = seedInvoiceType(db);
  learning.setSetting(db, 'graduation_window', '3');
  const tid = db.prepare(`INSERT INTO templates (name, slug, document_type_slug, keyword_fingerprint)
                          VALUES (?, 'anconia-corporation-invoice', 'invoice', '["anconia","corporation","invoice"]')`).run(SUP).lastInsertRowid;
  const ex = db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method)
                         VALUES (?, ?, ?, ?, 95, ?)`);
  const mkDoc = (i, site) => {
    const ref = `INV100${i}`, when = `0${i}-06-2026`;
    const id = db.prepare(`INSERT INTO documents (document_type_id, original_filename, folder_path, status, supplier_name,
                             overall_confidence, confirmed_at, template_id, ocr_text, reference_number, doc_date, logo_phash, keyword_fingerprint)
                           VALUES (?, ?, '/in', 'confirmed', ?, 96, ?, ?, ?, ?, ?, 'a1b2c3d4e5f60718', '["anconia","corporation","invoice"]')`)
      .run(inv, `doc${i}.pdf`, SUP, `2026-06-0${i}T10:00:00Z`, tid,
           `INVOICE\n${SUP}\n12 Mill Lane\nInvoice Number ${ref}\nInvoice Date ${when}\nTotal 10${i}.50`, ref, when).lastInsertRowid;
    ex.run(id, 'supplier_name', SUP, SUP, 'template_fixed');
    ex.run(id, 'invoice_number', ref, ref, 'keyword');
    ex.run(id, 'invoice_date', when, when, 'keyword');
    if (site) ex.run(id, 'site', site, site, 'keyword');
    return id;
  };
  const A = mkDoc(1, 'Reservoir Works');
  const B = mkDoc(2, 'Springfield Depot');
  const C = mkDoc(3, null);
  const E = mkDoc(4, null);
  const F = mkDoc(5, null);
  db.prepare(`INSERT INTO corrections (document_id, field_key, original_value, corrected_value, supplier_name, document_type)
              VALUES (?, 'invoice_number', 'INV1001', 'INV1001', ?, 'invoice')`).run(A, SUP);
  const Q = db.prepare(`INSERT INTO documents (document_type_id, original_filename, folder_path, status)
                        VALUES (?, 'queued.pdf', '/in', 'needs_review')`).run(inv).lastInsertRowid;
  return { inv, tid, A, B, C, E, F, Q };
}
const dtInfo = (inv) => ({
  id: inv, ref_field_key: 'invoice_number', date_field_key: 'invoice_date',
  fields: [{ key: 'supplier_name', label: 'Document Issuer', is_variable: 0 }, { key: 'site', label: 'Site', is_variable: 0 }],
});
// One reading of EVERY threaded reader (plus the two NEGATIVE readers) — the same function in every arm.
function snapshot(db, s) {
  const grp = (learning.getFieldFormats(db, { includeProvisional: true }) || [])
    .find(g => g.supplier_name === SUP && g.field_key === 'invoice_number');
  const scope = { supplier_name: SUP, document_type: 'invoice', field_key: 'invoice_number' };
  const siteRow = _buildTemplateFields(db, { supplier_name: SUP, site: 'Reservoir Works' }, dtInfo(s.inv)).find(r => r.field_key === 'site');
  return {
    values:   grp ? Object.keys(grp.value_counts).sort() : [],
    grpCount: grp ? grp.confirmed_count : 0,
    trust:    trust.scopeTrust(db, SUP, 'invoice'),
    roster:   trust.listGraduatedScopes(db).filter(r => r.supplier === SUP && r.slug === 'invoice').length,
    dom:      templates.getDominantSupplier(db, s.tid),
    docCount: templates.confirmedDocCount(db, s.tid),
    live:     templates.liveConfirmedCounts(db).get(s.tid) || 0,
    split:    typeSplit.checkTypeSplit(db, SUP, 'purchase_order'),
    nameN:    namePresence.supplierNamePresenceRatio(db, SUP).count,
    typeN:    typePresence.templateTypeHeadingPresence(db, { id: s.tid, document_type_slug: 'invoice' }).count,
    suggest:  documents.getFieldValueSuggestions(db, s.Q, 'invoice_number'),
    history:  learning.getFieldValueHistory(db, scope).map(r => r.value).sort(),
    docsFor:  learning.getDocumentsForFieldValue(db, { ...scope, value: 'INV1001' }).map(r => r.id),
    prefix:   (learning.getPrefixModelForScope(db, SUP, 'invoice', 'invoice_number') || {}).total || 0,
    near:     learning.findNearMatchIdentity(db, 'Anconia Corporatoin', { minConfirms: 1 }),   // 2 edits of the stored name
    siteVar:  siteRow ? siteRow.is_variable : null,
    suspects: repairSuspects.computeSuspects(db, { document_type_slug: 'invoice' }),
    backfill: templateMerge.planBackfill(db),
    search:   documents.search(db, { docType: 'invoice' }).length,                                             // NEGATIVE
    browse:   documents.getConfirmedDocsForScope(db, { supplier_name: 'Anconia', document_type_slug: 'invoice' }).length,   // NEGATIVE
  };
}
const without = (v) => ALL.filter(x => x !== v).join();

console.log('3. BEHAVIOUR (mig 90 fixture) — positive control, ONE stamp, then ALL');
const armed = new Database(':memory:');
runMigrations(armed);
// mig 93 seeds template_freeze_issuer_only ON, which forces EVERY non-issuer field variable
// (the nonIssuerBlocked arm in _buildTemplateFields) so `site` could never freeze. Restore the
// switch's code-default OFF — this suite pins the freeze/unfreeze behaviour when a multi-valued
// witness leaves learning, not the seed.
learning.setSetting(armed, 'template_freeze_issuer_only', 'false');
const S = seedScope(armed);
{
  const db = armed, s = S;
  check('mig 90 column present, switch ON by default, fragment carries the alias it was given',
        _hasLearningExcludedColumn(db) && learningExcludeEnabled(db)
        && learningExcludedSql(db) === ' AND d.learning_excluded_at IS NULL'
        && learningExcludedSql(db, '') === ' AND learning_excluded_at IS NULL'
        && learningExcludedSql(db, 'x') === ' AND x.learning_excluded_at IS NULL');
  const s0 = snapshot(db, s);
  check('control: the scope is GRADUATED before any stamp (5 human confirms, W=3, clean)' + (s0.trust.trusted ? '' : ` (got ${JSON.stringify(s0.trust)})`),
        s0.trust.trusted === true && s0.trust.confirmedCount === 5);
  check('control: the format group holds all five values', s0.values.join() === ALL.join() && s0.grpCount === 5);
  check('control: the graduation roster lists the scope', s0.roster === 1);
  check('control: dominant supplier 5/5, per-template count 5, live counts 5',
        s0.dom && s0.dom.count === 5 && s0.dom.total === 5 && s0.docCount === 5 && s0.live === 5);
  check('control: the type-split ask fires (5 invoices; a PO would split the sender)', s0.split.split === true && s0.split.count === 5);
  check('control: name-presence and type-heading samples are 5', s0.nameN === 5 && s0.typeN === 5);
  check('control: the Review type-ahead offers all five', s0.suggest.join() === ALL.join());
  check('control: learning history 5 values; INV1001 -> doc A; prefix model total 5 (at its 5-count floor)',
        s0.history.length === 5 && s0.docsFor.join() === String(s.A) && s0.prefix === 5);
  check('control: the near-match gazetteer sees 5 human confirms', s0.near.near === true && s0.near.confirms === 5 && s0.near.source === 'confirms');
  check('control: `site` is VARIABLE (two distinct confirmed values in the type)', s0.siteVar === true);
  check('control: suspects + backfill run with the fragment armed (the SQL is valid)',
        s0.suspects && typeof s0.suspects.count === 'number' && Array.isArray(s0.backfill));
  check('control: search + the Repair browse list see all five', s0.search === 5 && s0.browse === 5);

  db.prepare("UPDATE documents SET learning_excluded_at = datetime('now') WHERE id = ?").run(s.B);
  const s1 = snapshot(db, s);
  check("stamp B: the format group drops B's value and keeps the other four", s1.values.join() === without('INV1002') && s1.grpCount === 4);
  check('stamp B: scopeTrust confirmedCount drops by ONE (5 -> 4; still >= W so still graduated)',
        s1.trust.trusted === true && s1.trust.confirmedCount === 4);
  check('stamp B: the roster still lists the scope (4 >= W)', s1.roster === 1);
  check('stamp B: the dominant supplier still counts the others (4/4); per-template + live counts 4',
        s1.dom && s1.dom.count === 4 && s1.dom.total === 4 && s1.docCount === 4 && s1.live === 4);
  check('stamp B: the type-split history counts 4', s1.split.split === true && s1.split.count === 4);
  check('stamp B: presence samples are 4', s1.nameN === 4 && s1.typeN === 4);
  check("stamp B: the type-ahead no longer offers B's value", s1.suggest.join() === without('INV1002'));
  check('stamp B: history 4 values; gazetteer confirms 4', s1.history.length === 4 && s1.near.confirms === 4);
  check('stamp B: the prefix model loses its evidence (4 < the 5-count dominance floor -> no model)', s1.prefix === 0);
  check('stamp B: `site` FREEZES again (the multi-valued witness left learning)', s1.siteVar === false);
  check('stamp B: search + the Repair browse list STILL see all five (filed, searchable, repairable)', s1.search === 5 && s1.browse === 5);

  db.prepare("UPDATE documents SET learning_excluded_at = datetime('now') WHERE id IN (?, ?, ?, ?)").run(s.A, s.C, s.E, s.F);
  const s2 = snapshot(db, s);
  check('all stamped: scopeTrust = {trusted:false, reason:volume, confirmedCount:0}',
        s2.trust.trusted === false && s2.trust.reason === 'volume' && s2.trust.confirmedCount === 0);
  check('all stamped: no format group, no dominant supplier, zero template counts, roster empty',
        s2.values.length === 0 && s2.dom === null && s2.docCount === 0 && s2.live === 0 && s2.roster === 0);
  check('all stamped: split count 0, presence 0, type-ahead empty, history empty, no source doc, prefix 0',
        s2.split.count === 0 && s2.nameN === 0 && s2.typeN === 0 && s2.suggest.length === 0
        && s2.history.length === 0 && s2.docsFor.length === 0 && s2.prefix === 0);
  check('all stamped: the gazetteer is EMPTY (Tier A gone; no frozen Tier B identity)', s2.near.near === false);
  check('all stamped: search + the Repair browse list STILL see all five', s2.search === 5 && s2.browse === 5);
}

console.log('4. KILL — env LEARNING_EXCLUDE_DOCS=0 / setting learning_exclude_docs=false RE-ADMIT the stamped docs (env wins both ways)');
{
  const db = armed, s = S;
  process.env.LEARNING_EXCLUDE_DOCS = '0';
  const fragOff = learningExcludedSql(db);
  const k = snapshot(db, s);
  delete process.env.LEARNING_EXCLUDE_DOCS;
  check('env=0: the fragment is empty', fragOff === '');
  check('env=0: everything is counted again (graduated 5, 5 values, dominant 5/5, gazetteer 5, prefix 5, site variable)',
        k.trust.trusted === true && k.trust.confirmedCount === 5 && k.values.length === 5
        && k.dom && k.dom.count === 5 && k.near.confirms === 5 && k.prefix === 5 && k.siteVar === true);
  learning.setSetting(db, 'learning_exclude_docs', 'false');
  const k2 = snapshot(db, s);
  check('setting=false alone re-admits them', k2.trust.confirmedCount === 5 && k2.values.length === 5 && k2.live === 5);
  process.env.LEARNING_EXCLUDE_DOCS = '1';
  const k3 = snapshot(db, s);
  delete process.env.LEARNING_EXCLUDE_DOCS;
  check('env=1 beats setting=false (harness arms unambiguous)', k3.trust.confirmedCount === 0 && k3.values.length === 0 && k3.live === 0);
  db.prepare("DELETE FROM settings WHERE key = 'learning_exclude_docs'").run();
  const k4 = snapshot(db, s);
  check('setting removed: excluded again — the STAMP is durable, only the switch was off', k4.trust.confirmedCount === 0 && k4.values.length === 0);
  check('the switch never un-stamps: all five rows still carry learning_excluded_at',
        db.prepare("SELECT COUNT(*) n FROM documents WHERE learning_excluded_at IS NOT NULL").get().n === 5);
  armed.close();
}

console.log('5. COLUMN ABSENT (pre-mig-90 fixture) — the fragment is empty, every reader runs, legacy counts');
{
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE, ref_field_key TEXT,
                                 date_field_key TEXT, title_aliases TEXT, built_in INTEGER DEFAULT 1);
    CREATE TABLE fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT, label TEXT,
                         type TEXT DEFAULT 'text', required INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, built_in INTEGER DEFAULT 1);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, original_filename TEXT, folder_path TEXT, supplier_name TEXT,
                            document_type_id INTEGER, status TEXT, confirmed_at TEXT, processed_at TEXT, template_id INTEGER,
                            overall_confidence INTEGER, ocr_text TEXT, logo_phash TEXT, keyword_fingerprint TEXT,
                            reference_number TEXT, doc_date TEXT, stored_filename TEXT, stored_path TEXT, working_path TEXT);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, raw_value TEXT,
                              display_value TEXT, confidence INTEGER, extraction_method TEXT, validation_note TEXT, corrected_to TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER, field_key TEXT, original_value TEXT,
                              corrected_value TEXT, supplier_name TEXT, document_type TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT, document_type_slug TEXT, logo_phash TEXT,
                            keyword_fingerprint TEXT, confirmed_count INTEGER DEFAULT 0);
    CREATE TABLE template_fields (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER, field_key TEXT, anchor_label TEXT,
                                  direction TEXT, fixed_value TEXT, is_variable INTEGER DEFAULT 1);
  `);
  const s = seedScope(db);
  check('no column: the probe says absent and BOTH alias forms are empty',
        !_hasLearningExcludedColumn(db) && learningExcludedSql(db) === '' && learningExcludedSql(db, '') === '');
  process.env.LEARNING_EXCLUDE_DOCS = '1';
  const forced = learningExcludedSql(db);
  delete process.env.LEARNING_EXCLUDE_DOCS;
  check('no column: env=1 still yields an empty fragment (never references a column that is not there)', forced === '');
  let snap = null, threw = null;
  try { snap = snapshot(db, s); } catch (e) { threw = e.message; }
  check('no column: every reader runs without throwing' + (threw ? ` — threw: ${threw}` : ''), threw === null);
  check('no column: legacy counts (graduated 5, 5 values, dominant 5/5, gazetteer 5, prefix 5, site variable, search 5)',
        snap && snap.trust.trusted === true && snap.trust.confirmedCount === 5 && snap.values.length === 5
        && snap.dom && snap.dom.count === 5 && snap.near.confirms === 5 && snap.prefix === 5 && snap.siteVar === true && snap.search === 5);
  db.close();
}

console.log(`\n${passed} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
