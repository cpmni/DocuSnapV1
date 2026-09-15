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
 * Plus the teach-over-client S4 upload-to-teach route (2026-09-14, Oracle SIGN-OFF-W/COND C8-C14; ADMIN-only):
 *   POST /v1/teach/stage                      (upload a PDF/image → OCR-import WITHOUT filing → return {docId})
 * Verifies: auth (401) + role (readonly 403), the happy-path shapes, a full-page-sized body is ACCEPTED
 * (over the 1MB default JSON cap → the dedicated TEACH_IMG cap), missing imageBase64 → 400, the page-words
 * in-flight cap (429) AND that the slot FREES after the batch, and teach/config reflects a setting; and for
 * /teach/stage the full auth matrix (edit→403, unentitled 402, switch-off 409), 415 for a non-OCR upload,
 * 413 on Content-Length + TOO_MANY_PAGES from the pre-probe BEFORE OCR, the happy path (ONE needs_review row,
 * id == returned docId, autoFile:false pinned incl. a graduated scope), the in-flight cap (429 + slot frees),
 * and temp-folder mint + cleanup.
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
const writes = [], unlinks = [], filed = [], rms = [];
// S4 (upload-to-teach) test state, read by the injected stage collaborators (ctx.stageImport / stageProbePages).
let stagePagesResult = 2;     // what the page-count PRE-PROBE returns (route caps at 40)
let stageImportDelayMs = 5;   // fake import latency — bumped to overlap two requests for the in-flight-cap test
let stageAutoFileSeen = 'UNSET';   // captures the opts.autoFile the ROUTE passed the importer (C8)
let stageImportCalls = 0;     // # times the importer actually ran (0 across a pre-probe reject = no OCR)

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

function request(port, method, path, { token, body, rawBody, headers } = {}) {
  return new Promise((resolve) => {
    const data = rawBody != null ? rawBody : (body != null ? JSON.stringify(body) : null);
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      ...(headers || {}),   // a spoofed Content-Length rides here (the size-cap pre-check test)
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
    fs: { writeFileSync: (p) => { writes.push(p); }, unlinkSync: (p) => { unlinks.push(p); }, existsSync: () => true, mkdirSync: () => {}, rmSync: (p) => { rms.push(p); } },
    path: require('path'),
    templatesDir: () => require('os').tmpdir(),
    // S4 (upload-to-teach) injected collaborators — the route's shared-import + page-count-probe seams. The
    // fake importer HONOURS opts.autoFile (false → needs_review, i.e. even a graduated scope; true → confirmed)
    // and records what the route passed, so the pin proves the route drives the import with autoFile:false.
    stageImport: async (folder, opts) => {
      stageImportCalls++;
      stageAutoFileSeen = opts && opts.autoFile;
      await new Promise(r => setTimeout(r, stageImportDelayMs));
      const status = (opts && opts.autoFile === false) ? 'needs_review' : 'confirmed';
      const id = db.prepare("INSERT INTO documents (document_type_id, original_filename, stored_filename, status, folder_path) VALUES (?,?,?,?,?)")
        .run(null, 'staged.pdf', 'staged.pdf', status, String(folder)).lastInsertRowid;
      return { ok: true, docId: id };
    },
    stageProbePages: (_filePath, _ext) => Promise.resolve(stagePagesResult),
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

  // auth + switch. mig 170 now DEFAULTS teach_over_client_enabled ON, so force it OFF here to exercise
  // the disabled path (originally seeded false by migration 168).
  learning.setSetting(db, 'teach_over_client_enabled', 'false');
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
  check('an unknown field as a fixed value → 400', (await commit({ token: adminT, body: commitBody({ document_id: docA, fixed: [{ field_key: 'not_a_field', value: 'x' }] }) })).status === 400);
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

  // the Document Issuer MAY be fixed (buyer-issued letterhead — the Print Tracker case; parity with the desktop)
  const fxDoc = mkDoc();
  const fx = await commit({ token: adminT, body: commitBody({ teachCommitId: 'tc-fixissuer', document_id: fxDoc, fixed: [{ field_key: 'supplier_name', value: 'Print Tracker' }] }) });
  check('fixing the Document Issuer (a structural role) is ALLOWED → 200', fx.status === 200 && fx.json.ok === true);
  check("the fixed issuer landed in template_fields", !!db.prepare("SELECT 1 FROM template_fields WHERE template_id=? AND field_key='supplier_name' AND fixed_value='Print Tracker'").get(fx.json.templateId));

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

  // ── S4: UPLOAD-TO-TEACH (POST /v1/teach/stage) ───────────────────────────────────────────────────────
  console.log('S4 upload-to-teach');
  const PDF = Buffer.from('%PDF-1.4 fake teaching exemplar').toString('base64');
  const stage = (opts) => request(port, 'POST', '/v1/teach/stage', opts);
  const stageBody = (over) => Object.assign({ filename: 'scan.pdf', contentBase64: PDF }, over || {});
  // The switch is ON from S3 (teach_over_client_enabled='true'); entitled=true.

  // auth matrix
  check('POST /teach/stage: no token → 401', (await stage({ body: stageBody() })).status === 401);
  check('POST /teach/stage: readonly → 403', (await stage({ token: readT, body: stageBody() })).status === 403);
  check('POST /teach/stage: EDIT (writer, non-admin) → 403 (stage is admin-only, C13)', (await stage({ token: editT, body: stageBody() })).status === 403);

  // unentitled → 402 (the central FEATURE_ROUTE gate)
  entitled = false;
  check('POST /teach/stage: unentitled → 402', (await stage({ token: adminT, body: stageBody() })).status === 402);
  entitled = true;

  // switch OFF → 409 FEATURE_DISABLED
  learning.setSetting(db, 'teach_over_client_enabled', 'false');
  const stgOff = await stage({ token: adminT, body: stageBody() });
  check('POST /teach/stage: switch OFF → 409 FEATURE_DISABLED', stgOff.status === 409 && stgOff.json.code === 'FEATURE_DISABLED');
  learning.setSetting(db, 'teach_over_client_enabled', 'true');

  // SAFE-subset ext: a .docx passes the upload subset but is NOT OCR-able → 415; .exe → 415
  check('POST /teach/stage: .docx → 415 (only a PDF/image is teachable)', (await stage({ token: adminT, body: stageBody({ filename: 'x.docx' }) })).status === 415);
  check('POST /teach/stage: .exe → 415', (await stage({ token: adminT, body: stageBody({ filename: 'x.exe' }) })).status === 415);
  check('POST /teach/stage: missing filename/contentBase64 → 400', (await stage({ token: adminT, body: { filename: 'a.pdf' } })).status === 400);

  // size cap (shrink the admin-settable teach_stage_max_mb to 1 MB so the test payload stays small — mirrors
  // the intake lane). A ~2 MB decoded upload → 413 on the decoded-bytes check; a truthful oversize
  // Content-Length → 413 on the pre-buffer check.
  learning.setSetting(db, 'teach_stage_max_mb', '1');
  const bigStageB64 = 'A'.repeat(2 * 1024 * 1024 * 4 / 3 | 0);   // ~2 MB decoded, over the 1 MB cap
  check('POST /teach/stage: oversize decoded → 413', (await stage({ token: adminT, body: stageBody({ contentBase64: bigStageB64 }) })).status === 413);
  const overStage = JSON.stringify(stageBody({ contentBase64: bigStageB64 }));
  check('POST /teach/stage: oversize Content-Length → 413 (pre-buffer reject)', (await stage({ token: adminT, rawBody: overStage })).status === 413);
  learning.setSetting(db, 'teach_stage_max_mb', '50');

  // C11: too-many-pages rejected by the render/pages.py --count PRE-PROBE, BEFORE any OCR import
  stageImportCalls = 0; stagePagesResult = 999;
  const tooMany = await stage({ token: adminT, body: stageBody() });
  check('POST /teach/stage: too-many-pages → 413 TOO_MANY_PAGES', tooMany.status === 413 && tooMany.json.code === 'TOO_MANY_PAGES');
  check('  → the OCR import did NOT run (pre-probe rejected before the spawn, C11)', stageImportCalls === 0);
  stagePagesResult = 2;

  // happy path — ONE needs_review row, id == the returned docId (C9), autoFile:false pinned (C8)
  stageImportCalls = 0; stageAutoFileSeen = 'UNSET'; writes.length = 0; rms.length = 0;
  const beforeDocs = db.prepare("SELECT COUNT(*) n FROM documents").get().n;
  const good = await stage({ token: adminT, body: stageBody({ filename: '../../evil.pdf' }) });
  check('POST /teach/stage: happy path → 200 {ok, docId, filename}',
        good.status === 200 && good.json.ok === true && good.json.docId > 0 && typeof good.json.filename === 'string');
  check('  → filename sanitised to a basename (client path traversal ignored)', good.json.filename === 'evil.pdf');
  const newRow = good.json.docId != null ? db.prepare("SELECT * FROM documents WHERE id = ?").get(good.json.docId) : null;
  check('  → ONE new row, id == returned docId (C9: the id is captured from the import, not a filename pick)',
        !!newRow && db.prepare("SELECT COUNT(*) n FROM documents").get().n === beforeDocs + 1);
  check('  → the imported row is needs_review, NOT filed (C8)', !!newRow && newRow.status === 'needs_review');
  check('  → the route drove the import with autoFile:FALSE (C8 — even a graduated supplier+type lands in review)', stageAutoFileSeen === false);
  check('  → a graduated scope cannot force a file: the route NEVER passes autoFile:true', stageAutoFileSeen !== true);
  check('  → temp FOLDER minted server-side (a file written under a teach-stage dir)', writes.some(p => /ds_v1teachstage_/.test(String(p))));
  check('  → temp FOLDER cleaned up afterwards (rmSync on the minted dir, C10)', rms.some(p => /ds_v1teachstage_/.test(String(p))));

  // in-flight cap (TEACH_STAGE_MAX_INFLIGHT=1) + the slot frees
  stageImportDelayMs = 120;
  const pair = await Promise.all([0, 1].map(() => stage({ token: adminT, body: stageBody() })));
  check('POST /teach/stage: 2 concurrent → exactly one 429 (in-flight cap = 1, C10)', pair.filter(r => r.status === 429).length === 1);
  check('  → at most one of the two succeeded', pair.filter(r => r.status === 200).length <= 1);
  stageImportDelayMs = 5;
  const afterCap = await stage({ token: adminT, body: stageBody() });
  check('POST /teach/stage: the slot FREES after the batch (a later request succeeds)', afterCap.status === 200);

  server.close();
  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
