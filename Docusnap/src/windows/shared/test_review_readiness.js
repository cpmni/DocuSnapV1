#!/usr/bin/env node
'use strict';

/**
 * src/windows/shared/test_review_readiness.js
 * -------------------------------------------
 * Q4b of the Chris round-14 queue (card: Home "20 ready to file" over 20 untyped docs; "No suppliers
 * file automatically yet" after 34 self-filed). gary → Oracle SIGN-OFF-W/COND C4b.1–C4b.3:
 *   ONE classifier (shared/reviewReadiness.js) behind BOTH Home's split and File All's dialog;
 *   the dashboard's "senders file by themselves" asks scopeReadiness.isReady (the Review badge's
 *   predicate), one getFieldFormats scan, memoised.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/windows/shared/test_review_readiness.js
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..', '..');
const RR = require('./reviewReadiness');
const documents = require(path.join(ROOT, 'database', 'modules', 'documents'));

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }

console.log('§1 the classifier (pure)');
const clean = { type_slug: 'invoice', review_flag_count: 0, below_threshold_count: 0, missing_required_labels: '' };
check('typed clean → ready', RR.classify(clean) === 'ready');
check('UNTYPED clean → noType (the "20 ready" exhibit)', RR.classify({ ...clean, type_slug: null }) === 'noType');
check('flag → flagged', RR.classify({ ...clean, review_flag_count: 1 }) === 'flagged');
check('ACKNOWLEDGED flag → ready (File All exempts it; the split now does too)', RR.classify({ ...clean, review_flag_count: 1, review_acknowledged_at: '2026-08-22' }) === 'ready');
check('below-threshold (any) → flagged when valuedOnly is off', RR.classify({ ...clean, below_threshold_count: 1, below_threshold_valued_count: 0 }) === 'flagged');
check('below-threshold EMPTY read → ready when valuedOnly is on', RR.classify({ ...clean, below_threshold_count: 1, below_threshold_valued_count: 0 }, { valuedOnly: true }) === 'ready');
check('below-threshold VALUED read → flagged when valuedOnly is on', RR.classify({ ...clean, below_threshold_count: 1, below_threshold_valued_count: 1 }, { valuedOnly: true }) === 'flagged');
check('missing required → missing', RR.classify({ ...clean, missing_required_labels: 'Invoice Date' }) === 'missing');
check('ORDER: flagged beats noType beats missing (File All\'s skip order)',
      RR.classify({ type_slug: null, review_flag_count: 1, missing_required_labels: 'x' }) === 'flagged'
      && RR.classify({ type_slug: null, review_flag_count: 0, missing_required_labels: 'x' }) === 'noType');
check('null row → missing (never ready)', RR.classify(null) === 'missing');
const parts = RR.partition([clean, { ...clean, type_slug: null }, { ...clean, review_flag_count: 2 }, { ...clean, missing_required_labels: 'Ref' }]);
check('partition sums to the input', parts.ready.length === 1 && parts.noType.length === 1 && parts.flagged.length === 1 && parts.missing.length === 1);

console.log('§2 getReviewSplit uses it (the Home number)');
{
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, ref_field_key TEXT, date_field_key TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY, document_type_id INTEGER, key TEXT, label TEXT, type TEXT DEFAULT 'text',
      required INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, confidence_threshold INTEGER);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, document_type_id INTEGER, status TEXT, overall_confidence INTEGER,
      supplier_name TEXT, template_id INTEGER, confirmed_at TEXT, confirmed_via TEXT, processed_at TEXT DEFAULT '2026-08-22',
      review_acknowledged_at TEXT);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT, raw_value TEXT, display_value TEXT,
      confidence INTEGER, extraction_method TEXT, validation_note TEXT, corrected_to TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT, original_value TEXT, corrected_value TEXT);
    CREATE TABLE template_hidden_fields (template_id INTEGER, field_key TEXT);
  `);
  db.prepare("INSERT INTO document_types (id, name, slug, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 'invoice_number', 'invoice_date')").run();
  const f = db.prepare('INSERT INTO fields (document_type_id, key, label, required) VALUES (1, ?, ?, ?)');
  f.run('supplier_name', 'Document Issuer', 0); f.run('invoice_number', 'Invoice Number', 0); f.run('invoice_date', 'Invoice Date', 0);
  const ins = db.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const full = (id) => { for (const [k, v] of [['supplier_name', 'Acme'], ['invoice_number', 'INV-1'], ['invoice_date', '01-08-2026']]) ins.run(id, k, v, v, 98, 'keyword', null); };
  // 1: typed clean (ready) · 2: UNTYPED clean (noType) · 3: typed, flagged + acknowledged (ready) · 4: typed, flagged (need)
  db.prepare("INSERT INTO documents (id, document_type_id, status, overall_confidence, supplier_name) VALUES (1, 1, 'needs_review', 100, 'Acme')").run(); full(1);
  db.prepare("INSERT INTO documents (id, document_type_id, status, overall_confidence, supplier_name) VALUES (2, NULL, 'needs_review', 100, NULL)").run();
  db.prepare("INSERT INTO documents (id, document_type_id, status, overall_confidence, supplier_name, review_acknowledged_at) VALUES (3, 1, 'needs_review', 100, 'Acme', '2026-08-22')").run(); full(3);
  ins.run(3, 'invoice_number', 'INV-3', 'INV-3', 98, 'keyword', 'please check');
  db.prepare("INSERT INTO documents (id, document_type_id, status, overall_confidence, supplier_name) VALUES (4, 1, 'needs_review', 100, 'Acme')").run(); full(4);
  ins.run(4, 'invoice_number', 'INV-4', 'INV-4', 98, 'keyword', 'please check');
  const split = documents.getReviewSplit(db);
  check('total 4', split.total === 4);
  check('UNTYPED clean doc counts as NEED (noType=1), not ready', split.noType === 1);
  check('acknowledged flag counts as READY (ack exemption folded in, Oracle C4b.1)', split.ready === 2);
  check('un-acknowledged flag counts as need (flagged=1)', split.flagged === 1 && split.need === 2);
  const q = documents.getReviewQueue(db);
  const p2 = RR.partition(q, { valuedOnly: false });
  check('File All\'s partition of the SAME rows gives the SAME numbers (never-disagree)', p2.ready.length === split.ready && p2.noType.length === split.noType && p2.flagged.length === split.flagged && p2.missing.length === split.missing);
}

console.log('§3 the dashboard "senders file by themselves" tally = scopeReadiness.isReady');
{
  const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
  const db = new Database(':memory:');
  runMigrations(db);
  const learning = require(path.join(ROOT, 'database', 'modules', 'learning'));
  const readiness = require(path.join(ROOT, 'database', 'modules', 'scopeReadiness'));
  db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
  db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (7, 'Readyco invoice', 'readyco-invoice', 'invoice')").run();
  db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value) VALUES (7, 'supplier_name', 'Readyco')").run();
  const ins = db.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, ?, ?, ?, 98, ?)');
  const mk = (sup, i, tpl) => {
    const id = Number(documents.insert(db, { original_filename: `${sup}-${i}.pdf`, folder_path: '/in', status: 'confirmed', supplier_name: sup, document_type_id: 1, template_id: tpl }).lastInsertRowid);
    db.prepare("UPDATE documents SET confirmed_at = datetime('now') WHERE id = ?").run(id);
    ins.run(id, 'supplier_name', sup, sup, 'template_fixed'); ins.run(id, 'invoice_number', `R-${i}`, `R-${i}`, 'keyword'); ins.run(id, 'invoice_date', `0${i}-02-2026`, `0${i}-02-2026`, 'keyword');
    return id;
  };
  for (let i = 1; i <= 4; i++) mk('Readyco', i, 7);          // a layout + solid role groups → READY (not graduated)
  for (let i = 1; i <= 4; i++) mk('Nolayout', i, null);      // solid groups but NO template → not ready
  const ready = readiness.isReady(db, 'Readyco', 'invoice'), notReady = readiness.isReady(db, 'Nolayout', 'invoice');
  check('fixture: Readyco ready (' + ready.reason + '), Nolayout not (' + notReady.reason + ')', ready.ready === true && notReady.ready === false && notReady.reason === 'no-template');
  const search = require(path.join(ROOT, 'src', 'modules', 'search', 'handler'));
  const x = search._selfFilingSenders(db, { noMemo: true });
  check('selfFilingSenders = 1 sender (Readyco), 1 scope — ready-not-graduated COUNTS; the no-layout sender does not', x.senders === 1 && x.scopes === 1);
  const trust = require(path.join(ROOT, 'database', 'modules', 'trust'));
  check('the graduation roster (old headline) is 0 here — the two notions differ; the headline is the badge\'s', (trust.listGraduatedScopes(db) || []).length === 0);
  const memo1 = search._selfFilingSenders(db); mk('Another', 9, 7); const memo2 = search._selfFilingSenders(db);
  check('memoised (a second call within 10 s returns the cached tally)', memo1 === memo2);
  const src = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'search', 'handler.js'), 'utf8');
  check('ONE getFieldFormats passed via opts.formats + the IPC consumes it (Oracle C4b.2)', /readiness\.isReady\(db, r\.supplier, r\.slug, \{ formats \}\)/.test(src) && /out\.selfFilingSenders = _selfFilingSenders\(db\)/.test(src));
}

console.log('§4 source contract');
{
  const rend = fs.readFileSync(path.join(ROOT, 'src', 'windows', 'review', 'renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'src', 'windows', 'review', 'index.html'), 'utf8');
  const docsJs = fs.readFileSync(path.join(ROOT, 'database', 'modules', 'documents.js'), 'utf8');
  const mainR = fs.readFileSync(path.join(ROOT, 'src', 'windows', 'main', 'renderer.js'), 'utf8');
  check('File All partitions with window.ReviewReadiness (no private re-implementation)', /window\.ReviewReadiness\.partition\(docs/.test(rend) && !/docs\.filter\(d => isFlagged\(d\) && !d\.review_acknowledged_at\)/.test(rend));
  check('Review loads the shared module before renderer.js', html.indexOf('shared/reviewReadiness.js') > -1 && html.indexOf('shared/reviewReadiness.js') < html.indexOf('src="renderer.js"'));
  check('getReviewSplit requires the same file', /shared\/reviewReadiness'\)\.partition\(rows/.test(docsJs));
  check('Home headline reads selfFilingSenders', /selfFilingSenders/.test(mainR) && /files by itself|file by themselves/.test(mainR));
}

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
