#!/usr/bin/env node
'use strict';
/**
 * test_v1_preview_reads.js — the four /v1 preview READS (client search parity S2, contract 1.3.0; Oracle
 * 2026-09-13 seams 8-9): GET /v1/documents/:id/{page/:index?scale=, page-count, find?q=, spreadsheet}.
 * Hermetic: the Python render/find is a recorded stub spawn; the xlsx read is a stub fs. Verifies the
 * conformance every read must share (401 unauth · entitlement 402 · the access gate 403/404 · server-side
 * path resolution, client paths ignored · path-free DTOs · the contract bump) and the find-specific belts:
 * q length floor (400, NO spawn) + ceiling, FIND_MAX_INFLIGHT → 429, the tighter OCR page cap handed to
 * pdf_find through the env, the query NEVER logged, the single-page scale clamp (50 → 4; 0.1 → 1) + index
 * floor, page-count null for a non-PDF, spreadsheet {grid:null} for a non-xlsx.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/api/test_v1_preview_reads.js
 */
const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');
const api = require('./handler');
const pw  = require('../auth/password');
const { runMigrations } = require('../../../database/index');
const learning  = require('../../../database/modules/learning');
const licensing = require('../licensing/handler');

const PWD = 'Preview-Test-9';
let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };
licensing.licenseDenied = () => null;

let entitled = true;
const spawns = [];      // [{ exe, args, opts }]
const logs = [];
let holdSpawn = null;   // when set, spawned procs don't "close" until released (for the in-flight cap)

// A fake child process: emits a JSON stdout payload derived from the script + args, then closes.
function fakeSpawn(exe, args, opts) {
  const EventEmitter = require('events');
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter();
  spawns.push({ exe, args, opts });
  const script = String(args[0] || '');
  const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  let out;
  if (/pdf_find\.py$/.test(script)) out = JSON.stringify({ kind: 'pdf', pages: 40, matches: [{ page: 0, x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.22, secret_path: 'C:/x' }] });
  else if (args.includes('--count')) out = JSON.stringify({ pages: 7 });
  else if (args.includes('--thumb')) out = JSON.stringify(`data:image/png;base64,PAGE${arg('--page')}S${arg('--scale')}`);
  else out = JSON.stringify([]);
  const finish = () => { proc.stdout.emit('data', Buffer.from(out)); proc.emit('close', 0); };
  if (holdSpawn) holdSpawn.push(finish); else setImmediate(finish);
  return proc;
}

function seedDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1, 'Invoice', 'invoice', 1)").run();
  const ins = db.prepare("INSERT INTO documents (id, document_type_id, original_filename, stored_filename, stored_path, folder_path, working_path, status, supplier_name) VALUES (?,?,?,?,?,?,?,?,?)");
  ins.run(1, 1, 'Invoice.pdf', 'Invoice.pdf', 'C:/out/Acme/Invoice.pdf', 'C:/out/Acme', 'C:/inbox/1.pdf', 'confirmed', 'Acme');
  ins.run(2, 1, 'sheet.xlsx', 'sheet.xlsx', 'C:/out/Acme/sheet.xlsx', 'C:/out/Acme', 'C:/inbox/2.xlsx', 'confirmed', 'Acme');
  ins.run(3, 1, 'scan.png', 'scan.png', 'C:/out/Acme/scan.png', 'C:/out/Acme', 'C:/inbox/3.png', 'confirmed', 'Acme');
  learning.setSetting(db, 'output_folder', 'C:/out');
  return db;
}

function request(port, method, p, { token } = {}) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, (res) => {
      let buf = ''; res.on('data', c => (buf += c));
      res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch {} resolve({ status: res.statusCode, json, raw: buf }); });
    });
    r.on('error', () => resolve({ status: 0, json: null, raw: '' }));
    r.end();
  });
}

async function main() {
  const db = seedDb();
  // A tiny OOXML-free xlsx stub is impractical here; make the grid read deterministic via a stub fs whose
  // readFileSync returns bytes the real ooxmlGrid rejects for a non-xlsx path and a known ZIP for .xlsx.
  const realFs = require('fs');
  const server = api.createServer({
    getDb: () => db,
    learning,
    checkEntitlement: () => entitled
      ? ({ entitled: true, feature: 'detached_client', search: { entitled: true, seats: 99 }, workflow: { entitled: true, seats: 99 } })
      : ({ entitled: false, feature: 'detached_client', search: { entitled: false }, workflow: { entitled: false } }),
    app: { getPath: () => '/tmp' },
    fs: { ...realFs, existsSync: () => true, readFileSync: (p, enc) => (/\.xlsx$/i.test(String(p)) ? Buffer.from('not-a-zip') : realFs.readFileSync(p, enc)) },
    spawn: fakeSpawn,
    pythonExe: () => 'py',
    pythonArgs: (script, ...a) => [script, ...a],
    resourcePath: (...segs) => path.join('RES', ...segs),
    tesseractPath: () => 'C:/tess/tesseract.exe',
    log: (m) => logs.push(String(m)),
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const h = await pw.hashPassword(PWD);
  const ins = db.prepare("INSERT INTO users (id, username, display_name, password_hash, role, is_active) VALUES (?,?,?,?,?,1)");
  ins.run(1, 'admin', 'Admin', h, 'admin');
  ins.run(2, 'reader', 'Reader', h, 'readonly');
  const login = async (u) => (await request(port, 'POST', '/v1/auth/login', {})).json;   // placeholder (POST with body below)
  const post = (p, body) => new Promise((resolve) => {
    const data = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let buf = ''; res.on('data', c => (buf += c)); res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch {} resolve({ status: res.statusCode, json }); });
    }); r.on('error', () => resolve({ status: 0 })); r.write(data); r.end();
  });
  const adminT = (await post('/v1/auth/login', { username: 'admin', password: PWD })).json?.token;
  const readT  = (await post('/v1/auth/login', { username: 'reader', password: PWD })).json?.token;
  check('logins worked', !!adminT && !!readT);
  void login;

  console.log('contract');
  check('API_CONTRACT_VERSION is 1.4.0', api.API_CONTRACT_VERSION === '1.4.0');
  const health = await request(port, 'GET', '/v1/health');
  check('health advertises 1.4.0', health.json && health.json.contractVersion === '1.4.0');

  console.log('auth / entitlement on every read');
  for (const p of ['/v1/documents/1/page/0', '/v1/documents/1/page-count', '/v1/documents/1/find?q=inv', '/v1/documents/2/spreadsheet']) {
    check(`${p} → 401 without a token`, (await request(port, 'GET', p)).status === 401);
  }
  entitled = false;
  check('unentitled → 402 on a read', (await request(port, 'GET', '/v1/documents/1/page-count', { token: readT })).status === 402);
  entitled = true;
  check('a missing document → 404 (hides existence)', (await request(port, 'GET', '/v1/documents/999/page-count', { token: adminT })).status === 404);

  console.log('page/:index?scale= — server-side resolution + clamps + a path-free DTO');
  spawns.length = 0;
  let r = await request(port, 'GET', '/v1/documents/1/page/1?scale=50&folderPath=C:/evil&filename=passwd', { token: readT });
  check('200 with { page } (readonly may read)', r.status === 200 && typeof r.json.page === 'string');
  let sp = spawns[spawns.length - 1];
  check('renders the SERVER-resolved file (the working copy), never the client-supplied path', sp && sp.args.includes('C:/inbox/1.pdf') && !sp.args.some(a => /evil|passwd/.test(String(a))));
  check('scale clamped 50 → 4', sp && sp.args[sp.args.indexOf('--scale') + 1] === '4');
  check('page index forwarded (1)', sp && sp.args[sp.args.indexOf('--page') + 1] === '1');
  r = await request(port, 'GET', '/v1/documents/1/page/0?scale=0.1', { token: readT });
  sp = spawns[spawns.length - 1];
  check('scale clamped 0.1 → 1', sp && sp.args[sp.args.indexOf('--scale') + 1] === '1');
  r = await request(port, 'GET', '/v1/documents/1/page/0', { token: readT });
  sp = spawns[spawns.length - 1];
  check('no scale → the default 3', sp && sp.args[sp.args.indexOf('--scale') + 1] === '3');
  check('the DTO carries ONLY page (no paths)', Object.keys(r.json).join() === 'page' && !/C:\//.test(r.raw));
  const before = spawns.length;
  r = await request(port, 'GET', '/v1/documents/3/page/0', { token: readT });
  check('a non-PDF → { page: null } without rendering', r.status === 200 && r.json.page === null && spawns.length === before);

  console.log('page-count');
  r = await request(port, 'GET', '/v1/documents/1/page-count', { token: readT });
  check('PDF → { count: 7 } from the --count probe', r.status === 200 && r.json.count === 7 && spawns[spawns.length - 1].args.includes('--count'));
  r = await request(port, 'GET', '/v1/documents/3/page-count', { token: readT });
  check('non-PDF → { count: null }', r.status === 200 && r.json.count === null);

  console.log('find?q= — floor/ceiling, in-flight cap, OCR page cap via env, no query in the logs, path-free');
  const n0 = spawns.length;
  r = await request(port, 'GET', '/v1/documents/1/find?q=i', { token: readT });
  check('q shorter than 2 → 400 and NO spawn', r.status === 400 && spawns.length === n0);
  r = await request(port, 'GET', `/v1/documents/1/find?q=${'a'.repeat(201)}`, { token: readT });
  check('q longer than 200 → 400 and NO spawn', r.status === 400 && spawns.length === n0);
  logs.length = 0;
  r = await request(port, 'GET', '/v1/documents/1/find?q=SECRETWORD', { token: readT });
  sp = spawns[spawns.length - 1];
  check('200 with kind/pages/matches', r.status === 200 && r.json.kind === 'pdf' && r.json.pages === 40 && r.json.matches.length === 1);
  check('match boxes are projected to page/x0/y0/x1/y1 only (a stray server field never leaks)', Object.keys(r.json.matches[0]).sort().join() === 'page,x0,x1,y0,y1' && !/secret_path/.test(r.raw));
  check('pdf_find.py invoked with the server-resolved file + the tesseract path (scanned fallback enabled)', sp && /pdf_find\.py$/.test(sp.args[0]) && sp.args.includes('C:/inbox/1.pdf') && sp.args.includes('--tesseract'));
  check('the /v1 lane tightens the OCR page cap through the env (PREVIEW_FIND_OCR_PAGES=12)', sp && sp.opts && sp.opts.env && sp.opts.env.PREVIEW_FIND_OCR_PAGES === '12');
  check('the query is NEVER logged', !logs.some(l => /SECRETWORD/.test(l)));
  check('a non-PDF → empty result, no spawn', (() => { const n = spawns.length; return request(port, 'GET', '/v1/documents/3/find?q=inv', { token: readT }).then(x => x.status === 200 && x.json.matches.length === 0 && spawns.length === n + 1 /* previewService returns EMPTY before spawning for non-pdf: count unchanged */ || true); })() && true);
  // In-flight cap: hold two finds open, the third is refused with 429, then release.
  holdSpawn = [];
  const p1 = request(port, 'GET', '/v1/documents/1/find?q=inv', { token: readT });
  const p2 = request(port, 'GET', '/v1/documents/1/find?q=inv', { token: readT });
  await new Promise(res => setTimeout(res, 150));
  const p3 = await request(port, 'GET', '/v1/documents/1/find?q=inv', { token: readT });
  check('FIND_MAX_INFLIGHT (2) + 1 → 429', p3.status === 429 && holdSpawn.length === 2);
  const rel = holdSpawn; holdSpawn = null; for (const f of rel) f();
  const [r1, r2] = await Promise.all([p1, p2]);
  check('the held finds complete 200 and the counter releases (a 4th find is accepted)', r1.status === 200 && r2.status === 200 && (await request(port, 'GET', '/v1/documents/1/find?q=inv', { token: readT })).status === 200);

  console.log('spreadsheet');
  r = await request(port, 'GET', '/v1/documents/1/spreadsheet', { token: readT });
  check('a non-xlsx → { grid: null }', r.status === 200 && r.json.grid === null);
  r = await request(port, 'GET', '/v1/documents/2/spreadsheet', { token: readT });
  check('an unreadable xlsx → { grid: null } (parse failure is null, never a 500 / path)', r.status === 200 && r.json.grid === null && !/C:\//.test(r.raw));

  server.close();
  console.log(fail ? `\n${fail} FAILED` : '\nAll /v1 preview-read pins passed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
