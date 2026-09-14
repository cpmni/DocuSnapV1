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
const writes = [], unlinks = [];

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
    fs: { writeFileSync: (p) => { writes.push(p); }, unlinkSync: (p) => { unlinks.push(p); }, existsSync: () => true },
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

  server.close();
  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
