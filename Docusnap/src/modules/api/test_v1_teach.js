#!/usr/bin/env node
'use strict';
/**
 * test_v1_teach.js — the teach-over-client S1 /v1 READ routes (2026-09-14, contract 1.7.0):
 *   POST /v1/documents/:id/ocr-region-boxes   (⊕/teach auto-label; {text,box,words,lines})
 *   POST /v1/documents/:id/ocr-page-words     (typed-value locate; {w,h,words}) — its OWN in-flight cap
 *   POST /v1/documents/:id/page-deskew        (straighten; {angle,image,measured}) — region.py expand=False (Oracle C3)
 *   GET  /v1/teach/config                     (the wizard's feature flags; a fixed allowlist)
 * Plus the teach-over-client S2 doc-type CREATE routes (2026-09-14, contract 1.7.0; ADMIN-only — a create is
 * the strictest desktop gate):
 *   POST /v1/doc-types                        (create a type + fields + structural roles; reuses createTypeWithFields)
 *   GET  /v1/doc-types/catalog                (the preset catalog + already_present flags)
 *   POST /v1/doc-types/presets                (add ticked catalog presets)
 * Verifies: auth (401) + role (readonly 403), the happy-path shapes, a full-page-sized body is ACCEPTED
 * (over the 1MB default JSON cap → the dedicated TEACH_IMG cap), missing imageBase64 → 400, the page-words
 * in-flight cap (429) AND that the slot FREES after the batch, and teach/config reflects a setting.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/api/test_v1_teach.js
 */
const http = require('http');
const { EventEmitter } = require('events');
const Database = require('better-sqlite3');
const api = require('./handler');
const pw  = require('../auth/password');
const { runMigrations } = require('../../../database/index');
const learning  = require('../../../database/modules/learning');
const licensing = require('../licensing/handler');

const PWD = 'Teach-Test-9';
let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };
licensing.licenseDenied = () => null;

let entitled = true;
let spawnDelayMs = 5;
const writes = [], unlinks = [], filed = [];

// Fake region.py: routes stdout by the flag in argv, emits close after spawnDelayMs so concurrent
// requests overlap for the in-flight-cap test.
function fakeSpawn(_exe, args) {
  const ee = new EventEmitter(); ee.stdout = new EventEmitter(); ee.stderr = new EventEmitter();
  const a = (args || []).join(' ');
  let out;
  if (a.includes('--boxes'))          out = JSON.stringify({ text: 'ACME LTD', box: [10, 20, 80, 18], words: [{ t: 'ACME', b: [10, 20, 40, 18] }], lines: ['ACME LTD'] });
  else if (a.includes('--page-words')) out = JSON.stringify({ w: 1000, h: 1400, words: [{ t: 'ACME', b: [10, 20, 40, 18], c: 91 }] });
  else if (a.includes('--deskew'))     out = JSON.stringify({ angle: 0, image: null });
  else                                 out = 'PLAIN TEXT';
  setTimeout(() => { ee.stdout.emit('data', Buffer.from(out)); ee.emit('close', 0); }, spawnDelayMs);
  return ee;
}

function seedDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function request(port, method, path, { token, body, rawBody } = {}) {
  return new Promise((resolve) => {
    const data = rawBody != null ? rawBody : (body != null ? JSON.stringify(body) : null);
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
    } }, (res) => { let buf = ''; res.on('data', c => (buf += c)); res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch {} resolve({ status: res.statusCode, json }); }); });
    r.on('error', () => resolve({ status: 0, json: null }));
    if (data) r.write(data);
    r.end();
  });
}

const IMG = Buffer.from('a fake png').toString('base64');

async function main() {
  const db = seedDb();
  const server = api.createServer({
    getDb: () => db,
    learning,
    checkEntitlement: () => entitled
      ? ({ entitled: true, feature: 'detached_client', search: { entitled: true, seats: 99 }, workflow: { entitled: true, seats: 99 } })
      : ({ entitled: false, feature: 'detached_client', search: { entitled: false }, workflow: { entitled: false } }),
    app: { getPath: () => '/tmp' },
    fs: { writeFileSync: (p) => { writes.push(p); }, unlinkSync: (p) => { unlinks.push(p); }, existsSync: () => true, mkdirSync: () => {} },
    path: require('path'),
    templatesDir: () => require('os').tmpdir(),
    // A stub reviewService for the teach-commit filing step (teachCommit calls reviewSvc.confirm): mark the
    // doc confirmed + return a filename, so the /v1 route's filing is exercised without real PDF I/O.
    reviewService: {
      confirm: async (_db, _actor, payload) => { filed.push(payload.document_id); db.prepare("UPDATE documents SET status='confirmed' WHERE id=?").run(payload.document_id); return { ok: true, filename: `TAUGHT-${payload.document_id}.pdf` }; },
      queue: () => [], deferred: () => [],
    },
    spawn: fakeSpawn,
    pythonExe: () => 'py',
    pythonArgs: (script, ...a) => [script, ...a],
    tesseractPath: () => 'tess',
    resourcePath: (...p) => p.join('/'),
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const h = await pw.hashPassword(PWD);
  const ins = db.prepare("INSERT INTO users (id, username, display_name, password_hash, role, is_active) VALUES (?,?,?,?,?,1)");
  ins.run(1, 'admin', 'Admin', h, 'admin');
  ins.run(2, 'reader', 'Reader', h, 'readonly');
  ins.run(3, 'editor', 'Editor', h, 'edit');
  const login = async (u) => (await request(port, 'POST', '/v1/auth/login', { body: { username: u, password: PWD } })).json?.token;
  const adminT = await login('admin'); const readT = await login('reader'); const editT = await login('editor');

  const post = (route, opts) => request(port, 'POST', `/v1/documents/1/${route}`, opts);

  // ── auth / role (all three image routes share isWriter) ──────────────────────────
  for (const route of ['ocr-region-boxes', 'ocr-page-words', 'page-deskew']) {
    check(`${route}: no token → 401`, (await post(route, { body: { imageBase64: IMG } })).status === 401);
    check(`${route}: readonly → 403`, (await post(route, { token: readT, body: { imageBase64: IMG } })).status === 403);
    check(`${route}: missing imageBase64 → 400`, (await post(route, { token: adminT, body: {} })).status === 400);
  }

  // ── happy-path shapes ────────────────────────────────────────────────────────────
  const boxes = await post('ocr-region-boxes', { token: adminT, body: { imageBase64: IMG } });
  check('ocr-region-boxes → 200 {text, box, words, lines}', boxes.status === 200 && boxes.json.text === 'ACME LTD' && Array.isArray(boxes.json.box) && Array.isArray(boxes.json.words));
  const words = await post('ocr-page-words', { token: adminT, body: { imageBase64: IMG } });
  check('ocr-page-words → 200 {w, h, words}', words.status === 200 && words.json.w === 1000 && Array.isArray(words.json.words) && words.json.words[0].t === 'ACME');
  const deskew = await post('page-deskew', { token: adminT, body: { imageBase64: IMG } });
  check('page-deskew → 200 {angle, image, measured:true} (a parsed result means the detector ran)',
        deskew.status === 200 && deskew.json.measured === true && deskew.json.angle === 0 && deskew.json.image === null);

  // ── the dedicated higher body cap: a full-page-sized (~2MB) body is ACCEPTED (would 413 under the 1MB default) ──
  const bigImg = 'A'.repeat(2 * 1024 * 1024);   // ~2MB base64 payload
  const big = await post('page-deskew', { token: adminT, body: { imageBase64: bigImg } });
  check('page-deskew: a ~2MB image body is accepted (TEACH_IMG cap, not the 1MB JSON default)', big.status === 200);

  // ── page-words in-flight cap (its OWN cap, PAGEWORDS_MAX_INFLIGHT=2) + the slot frees ──
  spawnDelayMs = 120;
  const three = await Promise.all([0, 1, 2].map(() => post('ocr-page-words', { token: adminT, body: { imageBase64: IMG } })));
  check('ocr-page-words: 3 concurrent → at least one 429 (own in-flight cap)', three.filter(r => r.status === 429).length >= 1);
  check('ocr-page-words: at most 2 of the 3 succeeded (cap = 2)', three.filter(r => r.status === 200).length <= 2);
  spawnDelayMs = 5;
  const after = await post('ocr-page-words', { token: adminT, body: { imageBase64: IMG } });
  check('ocr-page-words: the slot FREES after the batch (a later request succeeds)', after.status === 200);

  // ── temp minted server-side + cleaned ──────────────────────────────────────────────
  check('temp files minted under tmp with a teach prefix', writes.some(p => /ds_v1(boxes|pw|deskew)_/.test(String(p))));
  check('temp files cleaned (unlink called at least once per completed spawn)', unlinks.length >= 3);

  // ── teach/config: a fixed allowlist, reflects a setting, isWriter ────────────────────
  check('teach/config: no token → 401', (await request(port, 'GET', '/v1/teach/config')).status === 401);
  // Assert the fixed allowlist is present as strings (values reflect the DB; migrations may pre-seed some).
  const cfg0 = await request(port, 'GET', '/v1/teach/config', { token: adminT });
  const KEYS = ['teach_typed_value_locate', 'teach_box_word_snap', 'list_field_scan', 'barcode_field'];
  check('teach/config → 200 with exactly the four allowlisted flags, all string-valued',
        cfg0.status === 200 && KEYS.every(k => typeof cfg0.json[k] === 'string')
        && Object.keys(cfg0.json).length === KEYS.length);
  learning.setSetting(db, 'list_field_scan', 'true');
  const cfg1 = await request(port, 'GET', '/v1/teach/config', { token: adminT });
  check('teach/config reflects a live setting change (list_field_scan → true)', cfg1.json.list_field_scan === 'true');

  // ── S2: create a document type (POST /v1/doc-types) — ADMIN-only ─────────────────────────────────────
  const draft = { name: 'Client Test Type', fields: [
    { label: 'Document Issuer', key: 'supplier_name', type: 'text' },
    { label: 'Widget Reference', type: 'reference' },
    { label: 'Date', type: 'date' },
  ], ref_field_key: 'Widget Reference', date_field_key: 'Date' };
  const dtPost = (opts) => request(port, 'POST', '/v1/doc-types', opts);
  check('POST /doc-types: no token → 401', (await dtPost({ body: draft })).status === 401);
  check('POST /doc-types: readonly → 403', (await dtPost({ token: readT, body: draft })).status === 403);
  check('POST /doc-types: EDIT (writer, non-admin) → 403 (create is admin-only)', (await dtPost({ token: editT, body: draft })).status === 403);
  check('POST /doc-types: missing name → 400', (await dtPost({ token: adminT, body: { fields: draft.fields } })).status === 400);
  check('POST /doc-types: no fields → 400', (await dtPost({ token: adminT, body: { name: 'Empty' } })).status === 400);
  const created = await dtPost({ token: adminT, body: draft });
  check('POST /doc-types: admin happy path → 200 {success, id, type}',
        created.status === 200 && created.json.success === true && created.json.id > 0 && created.json.type && created.json.type.slug);
  // The type is real: it reads back through GET /doc-types with its fields + the structural roles bound.
  const listed = await request(port, 'GET', '/v1/doc-types', { token: adminT });
  const madeType = (listed.json.types || []).find(t => t.id === created.json.id);
  check('created type appears in GET /doc-types with its ref/date roles bound',
        !!madeType && madeType.ref_field_key === 'widget_reference' && madeType.date_field_key === 'date'
        && (madeType.fields || []).some(f => f.key === 'supplier_name'));
  // A duplicate NAME clashes → 400 {error} (inline, not a throw): mirrors the core create.
  const dup = await dtPost({ token: adminT, body: draft });
  check('POST /doc-types: duplicate name → 400 {error} (atomic rollback, shown inline)', dup.status === 400 && typeof dup.json.error === 'string');

  // ── S2: the catalog + preset add ────────────────────────────────────────────────────────────────────
  check('GET /doc-types/catalog: readonly → 403', (await request(port, 'GET', '/v1/doc-types/catalog', { token: readT })).status === 403);
  const cat = await request(port, 'GET', '/v1/doc-types/catalog', { token: adminT });
  check('GET /doc-types/catalog → 200 {catalog:[...]}', cat.status === 200 && Array.isArray(cat.json.catalog) && cat.json.catalog.length > 0);
  const addable = (cat.json.catalog || []).find(p => p.already_present === false);
  check('the catalog offers an addable (not-yet-installed) preset', !!addable);
  const prPost = (opts) => request(port, 'POST', '/v1/doc-types/presets', opts);
  check('POST /doc-types/presets: EDIT (non-admin) → 403', (await prPost({ token: editT, body: { slugs: [addable && addable.slug] } })).status === 403);
  check('POST /doc-types/presets: empty slugs → 400', (await prPost({ token: adminT, body: { slugs: [] } })).status === 400);
  const added = await prPost({ token: adminT, body: { slugs: [addable.slug] } });
  check('POST /doc-types/presets: admin adds a preset → 200 {success, results: [added]}',
        added.status === 200 && added.json.success === true
        && (added.json.results || []).some(r => r.slug === addable.slug && r.status === 'added'));
  const listed2 = await request(port, 'GET', '/v1/doc-types', { token: adminT });
  check('the added preset now appears in GET /doc-types', (listed2.json.types || []).some(t => t.slug === addable.slug));

  // ── S3: the transactional teach commit (POST /v1/teach/commit) ───────────────────────────────────────
  console.log('S3 the transactional teach commit');
  const typeSlug = created.json.type.slug;   // 'client-test-type' from the S2 create
  const typeId   = created.json.id;
  const commitBody = (over) => Object.assign({
    teachCommitId: 'tc-fixed-1', document_id: null, document_type_slug: typeSlug, supplier_name: 'Widgetworks Ltd',
    allValues: { supplier_name: 'Widgetworks Ltd', widget_reference: 'WR-100' },
    sample_deskew_angle: 0, angle_measured: false,
    listCaptions: [], fixed: [], hidden: [],
    mappings: [{ field_key: 'widget_reference', page_number: 0, anchor_text: 'Ref',
      anchor_x_norm: 0.1, anchor_y_norm: 0.1, anchor_w_norm: 0.1, anchor_h_norm: 0.05,
      target_x_norm: 0.25, target_y_norm: 0.1, target_w_norm: 0.2, target_h_norm: 0.05, search_expansion: 0.04 }],
    acknowledgeTypeSplit: true, acknowledgeIssuerNearMatch: true, taught_fields: ['widget_reference'],
  }, over || {});
  const commit = (opts) => request(port, 'POST', '/v1/teach/commit', opts);
  const mkDoc = () => db.prepare("INSERT INTO documents (document_type_id, original_filename, stored_filename, status, folder_path, logo_phash, keyword_fingerprint) VALUES (?,?,?,?,?,?,?)")
    .run(typeId, 'exemplar.pdf', 'exemplar.pdf', 'needs_review', '/inbox', null, '[]').lastInsertRowid;

  // auth + switch (the switch is still OFF here — seeded false by migration 168)
  const docA = mkDoc();
  check('POST /teach/commit: no token → 401', (await commit({ body: commitBody({ document_id: docA }) })).status === 401);
  check('POST /teach/commit: readonly → 403', (await commit({ token: readT, body: commitBody({ document_id: docA }) })).status === 403);
  check('POST /teach/commit: EDIT (writer, non-admin) → 403 (teach is admin-only)', (await commit({ token: editT, body: commitBody({ document_id: docA }) })).status === 403);
  const off = await commit({ token: adminT, body: commitBody({ document_id: docA }) });
  check('POST /teach/commit: switch OFF → 409 FEATURE_DISABLED', off.status === 409 && off.json.code === 'FEATURE_DISABLED');

  // enable the operator switch
  learning.setSetting(db, 'teach_over_client_enabled', 'true');

  // validation
  check('unknown doc type → 400', (await commit({ token: adminT, body: commitBody({ document_id: docA, document_type_slug: 'no-such-type' }) })).status === 400);
  check('unknown field in a mapping → 400', (await commit({ token: adminT, body: commitBody({ document_id: docA, mappings: [{ field_key: 'not_a_field', page_number: 0, anchor_x_norm: 0.1, anchor_y_norm: 0.1, anchor_w_norm: 0.1, anchor_h_norm: 0.05, target_x_norm: 0.2, target_y_norm: 0.1, target_w_norm: 0.1, target_h_norm: 0.05 }] }) })).status === 400);
  check('off-page target box → 400', (await commit({ token: adminT, body: commitBody({ document_id: docA, mappings: [{ field_key: 'widget_reference', page_number: 0, anchor_x_norm: 0.1, anchor_y_norm: 0.1, anchor_w_norm: 0.1, anchor_h_norm: 0.05, target_x_norm: 0.9, target_y_norm: 0.1, target_w_norm: 0.5, target_h_norm: 0.05 }] }) })).status === 400);
  check('a structural role as a fixed value → 400', (await commit({ token: adminT, body: commitBody({ document_id: docA, fixed: [{ field_key: 'supplier_name', value: 'x' }] }) })).status === 400);
  const confirmedDoc = mkDoc(); db.prepare("UPDATE documents SET status='confirmed' WHERE id=?").run(confirmedDoc);
  check('a non-teachable (already-filed) document → 4xx', [400, 409].includes((await commit({ token: adminT, body: commitBody({ teachCommitId: 'tc-x', document_id: confirmedDoc }) })).status));

  // happy path
  const tCountBefore = db.prepare('SELECT COUNT(*) c FROM templates').get().c;
  const ok1 = await commit({ token: adminT, body: commitBody({ document_id: docA }) });
  check('happy path → 200 {ok, templateId, filename}', ok1.status === 200 && ok1.json.ok === true && ok1.json.templateId > 0 && typeof ok1.json.filename === 'string');
  const tid = ok1.json.templateId;
  check('a template row was created', !!db.prepare('SELECT id FROM templates WHERE id=?').get(tid));
  check('the mapping was written for widget_reference', !!db.prepare("SELECT 1 FROM template_field_mappings WHERE template_id=? AND field_key='widget_reference'").get(tid));
  check('the teach_commits ledger is done + carries the templateId', (() => { const r = db.prepare("SELECT status, template_id FROM teach_commits WHERE commit_id='tc-fixed-1'").get(); return r && r.status === 'done' && r.template_id === tid; })());
  check('the exemplar was filed (reviewService.confirm ran)', filed.includes(docA));

  // idempotency — replay the SAME teachCommitId returns the SAME template, no second template
  const ok2 = await commit({ token: adminT, body: commitBody({ document_id: docA }) });
  check('idempotent replay → same templateId', ok2.status === 200 && ok2.json.templateId === tid);
  check('no second template was created on replay', db.prepare('SELECT COUNT(*) c FROM templates').get().c === tCountBefore + 1);

  // ack enforcement (monkeypatch the near-match + type-split lookups to FIRE)
  const learnMod = require('../../../database/modules/learning');
  const tsMod = require('../../../database/modules/typeSplit');
  const _nm = learnMod.findNearMatchIdentity, _ts = tsMod.checkTypeSplit;
  learnMod.findNearMatchIdentity = () => ({ near: true, existing: 'Widgetworks Limited' });
  const nmDoc = mkDoc();
  const nmRes = await commit({ token: adminT, body: commitBody({ teachCommitId: 'tc-nm', document_id: nmDoc, acknowledgeIssuerNearMatch: false }) });
  check('a firing near-match without the ack → 409 ISSUER_NEAR_MATCH', nmRes.status === 409 && nmRes.json.code === 'ISSUER_NEAR_MATCH');
  learnMod.findNearMatchIdentity = _nm;
  tsMod.checkTypeSplit = () => ({ split: true });
  const tsDoc = mkDoc();
  const tsRes = await commit({ token: adminT, body: commitBody({ teachCommitId: 'tc-ts', document_id: tsDoc, acknowledgeTypeSplit: false }) });
  check('a firing type-split without the ack → 409 TYPE_SPLIT', tsRes.status === 409 && tsRes.json.code === 'TYPE_SPLIT');
  check('type-split gate OFF → no 409 (parity with the desktop setting)', (() => { learning.setSetting(db, 'type_split_confirm_gate', 'false'); const r = commitBody({ teachCommitId: 'tc-ts2', document_id: mkDoc(), acknowledgeTypeSplit: false }); return true; })());
  const tsOff = await commit({ token: adminT, body: commitBody({ teachCommitId: 'tc-ts2', document_id: mkDoc(), acknowledgeTypeSplit: false }) });
  check('with type_split_confirm_gate OFF the type-split ack is not enforced', tsOff.status === 200);
  tsMod.checkTypeSplit = _ts; learning.setSetting(db, 'type_split_confirm_gate', 'true');

  server.close();
  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
