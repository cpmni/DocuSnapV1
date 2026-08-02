#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_search_contract.js
 * ----------------------------------------
 * Contract test that FREEZES the current `search-documents` IPC seam ahead of
 * any future detached read-only Search client. Pins, against today's runtime
 * code (no production changes):
 *   - accepted request params (company/reference/fullText/dateFrom/dateTo/
 *     docType/includeUncommitted) each take effect,
 *   - response is exactly { confirmed, uncommitted },
 *   - the essential row fields a detached client needs are present,
 *   - auth shaping: confirmed for any logged-in role; uncommitted only for
 *     admin/edit and only when requested; not logged in -> rejected,
 *   - status split (uncommitted = needs_review + deferred), ordering
 *     (confirmed_at DESC, processed_at DESC) and the LIMIT 200 cap.
 *
 * Exercises the real handler over the real documents.search(), with a FAKE
 * auth module injected via require.cache so roles can be simulated without the
 * Electron session/bcrypt stack (the handler reads requireLogin/hasRole at
 * register() time, so the stub is in place before register() runs).
 *
 * Why Electron-as-Node: better-sqlite3 is a native addon built against
 * Electron's ABI (see other database/modules/test_*.js).
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_search_contract.js
 */

const Database = require('better-sqlite3');

// ── Inject a fake auth module BEFORE the search handler resolves it ───────────
let _session = null;  // { role } | null  — flip per test to simulate the caller
const fakeAuth = {
  requireLogin() {
    if (!_session) throw Object.assign(new Error('Login required.'), { code: 'UNAUTHENTICATED' });
    return _session;
  },
  hasRole(...roles) { return !!_session && roles.includes(_session.role); },
  requireRole(...roles) {
    if (!_session || !roles.includes(_session.role)) throw new Error('forbidden');
    return _session;
  },
  getCurrentUser() { return _session; },
};
const authPath = require.resolve('../../src/modules/auth/handler');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const searchHandler = require('../../src/modules/search/handler');

// ── Capture the IPC handler ───────────────────────────────────────────────────
const _handlers = {};
function bindHandler(db) {
  searchHandler.register({ ipcMain: { handle: (n, fn) => { _handlers[n] = fn; } }, getDb: () => db });
  return (params) => _handlers['search-documents']({}, params);
}

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT);
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY, supplier_name TEXT, reference_number TEXT, doc_date TEXT,
      document_type_id INTEGER, status TEXT, ocr_text TEXT, overall_confidence INTEGER,
      original_filename TEXT, stored_filename TEXT, stored_path TEXT, folder_path TEXT,
      confirmed_at TEXT, processed_at TEXT
    );
    -- Full-text search now also spans extracted + corrected field VALUES (money/dates/codes),
    -- so the search contract must exercise those tables too (always present in the real schema).
    CREATE TABLE extractions (document_id INTEGER, field_key TEXT, display_value TEXT, raw_value TEXT);
    CREATE TABLE corrections (document_id INTEGER, field_key TEXT, corrected_value TEXT);
  `);
  db.prepare(`INSERT INTO document_types (id,name,slug) VALUES (1,'Invoice','invoice'),(2,'Purchase Order','purchase_order')`).run();
  return db;
}

function seedSmall(db) {
  const ins = db.prepare(`INSERT INTO documents
    (id,supplier_name,reference_number,doc_date,document_type_id,status,ocr_text,
     overall_confidence,original_filename,stored_filename,stored_path,folder_path,confirmed_at,processed_at)
    VALUES (@id,@s,@r,@d,@dt,@st,@o,@c,@of,@sf,@sp,@fp,@ca,@pa)`);
  // stored_path/folder_path left null so the search handler's file-existence
  // filter (documents.filterExisting) keeps these rows — this test pins the
  // request/response/auth contract, not on-disk existence (covered separately
  // by test_stale_document_refs.js).
  const row = (id, st, over) => ({
    id, s: `Supplier ${id}`, r: `REF-${id}`, d: '16-03-2026', dt: 1, st, o: `ocr alpha ${id}`,
    c: over, of: `orig_${id}.pdf`, sf: `Invoice.${id}.pdf`, sp: null,
    fp: null, ca: `2026-03-1${id}`, pa: `2026-03-1${id}`,
  });
  ins.run(row(1, 'confirmed', 91));
  ins.run(row(2, 'confirmed', 92));
  ins.run({ ...row(3, 'needs_review', 40), s: 'ReviewCo', r: 'RV-3', o: 'beta review' });
  ins.run({ ...row(4, 'deferred', 30),     s: 'DeferCo',  r: 'DF-4', o: 'gamma defer' });
}

const ESSENTIAL = ['id', 'supplier_name', 'reference_number', 'doc_date', 'status',
  'type_name', 'type_slug', 'overall_confidence', 'original_filename', 'stored_filename'];

function main() {
  let fail = 0;
  const db = freshDb(); seedSmall(db);
  const search = bindHandler(db);

  // ── Auth: not logged in -> rejected ─────────────────────────────────────────
  _session = null;
  let threw = false;
  try { search({}); } catch { threw = true; }
  fail += !check('not logged in -> search rejected (requireLogin enforced)', threw);

  // ── Response shape + essential fields (any logged-in role) ──────────────────
  _session = { role: 'read' };
  const r = search({});
  fail += !check('response top-level shape is exactly { confirmed, uncommitted }',
    JSON.stringify(Object.keys(r).sort()) === JSON.stringify(['confirmed', 'uncommitted']));
  fail += !check('confirmed available to a non-admin/edit logged-in role', r.confirmed.length === 2);
  const sample = r.confirmed[0] || {};
  fail += !check(`row exposes all essential detached-client fields [${ESSENTIAL.join(', ')}]`,
    ESSENTIAL.every(k => k in sample));
  fail += !check('row carries joined type_name/type_slug', sample.type_name === 'Invoice' && sample.type_slug === 'invoice');
  // ── DE-PATHING pins (owner 2026-08-02): search rows must NEVER carry filesystem paths,
  // the full ocr_text, or the learning hashes — they were the sequential-filename browsing
  // surface and a 200-doc payload per keystroke. has_file replaces stored_path truthiness.
  const FORBIDDEN = ['stored_path', 'working_path', 'folder_path', 'ocr_text', 'keyword_fingerprint', 'logo_phash'];
  fail += !check(`confirmed row carries NONE of [${FORBIDDEN.join(', ')}]`,
    FORBIDDEN.every(k => !(k in sample)));
  fail += !check('confirmed row carries has_file as a boolean', typeof sample.has_file === 'boolean');
  {
    _session = { role: 'admin' };
    const u = search({ includeUncommitted: true }).uncommitted[0] || {};
    fail += !check('uncommitted row is projected identically (no paths/ocr_text)',
      FORBIDDEN.every(k => !(k in u)) && typeof u.has_file === 'boolean');
    _session = { role: 'read' };
  }

  // ── Auth shaping of uncommitted ─────────────────────────────────────────────
  _session = { role: 'read' };
  fail += !check('read-only role: uncommitted excluded even when requested',
    search({ includeUncommitted: true }).uncommitted.length === 0);
  _session = { role: 'admin' };
  fail += !check('admin: uncommitted excluded when NOT requested',
    search({ includeUncommitted: false }).uncommitted.length === 0);
  const adminU = search({ includeUncommitted: true }).uncommitted;
  fail += !check('admin: uncommitted = needs_review + deferred when requested',
    adminU.length === 2 && adminU.some(d => d.status === 'needs_review') && adminU.some(d => d.status === 'deferred'));
  _session = { role: 'edit' };
  fail += !check('edit: uncommitted included when requested',
    search({ includeUncommitted: true }).uncommitted.length === 2);

  // ── Accepted request params each take effect (confirmed scope) ──────────────
  _session = { role: 'admin' };
  fail += !check('param: company filters by supplier_name', search({ company: 'Supplier 1' }).confirmed.length === 1);
  fail += !check('param: reference filters by reference_number', search({ reference: 'REF-2' }).confirmed.length === 1);
  fail += !check('param: fullText filters by ocr_text', search({ fullText: 'alpha 1' }).confirmed.length === 1);
  fail += !check('param: docType filters by type slug', search({ docType: 'purchase_order' }).confirmed.length === 0);
  fail += !check('param: dateFrom/dateTo filter (DD-MM-YYYY doc_date vs ISO input)',
    search({ dateFrom: '2026-03-01', dateTo: '2026-03-31' }).confirmed.length === 2
    && search({ dateFrom: '2026-04-01' }).confirmed.length === 0);
  fail += !check('param: includeUncommitted toggles the uncommitted set',
    search({ includeUncommitted: false }).uncommitted.length === 0
    && search({ includeUncommitted: true }).uncommitted.length === 2);
  db.close();

  // ── Ordering + LIMIT 200 cap (fresh DB) ─────────────────────────────────────
  const db2 = freshDb();
  const ins2 = db2.prepare(`INSERT INTO documents (id,status,confirmed_at,processed_at,document_type_id)
                            VALUES (?, 'confirmed', ?, ?, 1)`);
  for (let i = 1; i <= 205; i++) ins2.run(i, `2026-03-${String(i).padStart(3, '0')}`, `2026-03-${String(i).padStart(3, '0')}`);
  const search2 = bindHandler(db2);
  _session = { role: 'admin' };
  const capped = search2({}).confirmed;
  fail += !check('LIMIT caps confirmed results at 200', capped.length === 200);
  fail += !check('ordering is confirmed_at DESC (most recent first)', capped[0].id === 205 && capped[199].id === 6);
  db2.close();

  console.log(fail ? `\n${fail} check(s) FAILED — search-documents contract changed.` : '\nAll search-documents contract checks passed.');
  return fail ? 1 : 0;
}

process.exit(main());
