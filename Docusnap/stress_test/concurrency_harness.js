#!/usr/bin/env node
'use strict';

/**
 * stress_test/concurrency_harness.js
 * ----------------------------------
 * Multi-user (4 "staff") concurrency stress test of the REAL /v1 review/confirm/file
 * path — the exact server contract the detached client drives. Fully SANDBOXED per run
 * (throwaway temp DB + temp import/inbox/output). Never touches the live app DB.
 *
 * HARD INVARIANT: no document is ever lost, and every document is filed EXACTLY ONCE to
 * its correct computed location; the import folder ends empty.
 *
 * Design informed by an adversarial test-matrix design pass. Two strongest oracles:
 *   • per-working-copy UNIQUE CONTENT MARKER  → each filed PDF must contain ITS OWN doc's
 *     marker (catches cross-doc copy mixups / overwrites that identical files would hide).
 *   • BIJECTION  → the set of confirmed stored_paths ≡ the set of physical PDFs on disk
 *     (catches loss, double-file, overwrite, orphan in one assertion).
 *
 * Lifecycle modelled (mirrors the real flow):
 *   import/orig_<id>.pdf  original scan (must end EMPTY — removed on confirm via the injected
 *                         onScheduleSourceMove hook, like the desktop's removeSourceFile)
 *   inbox/<id>.pdf        app-managed working copy (consumed by filing, then deleted)
 *   output/<Supplier>/<Year>/<Month>/Invoice.<DD-MM-YYYY>.<Ref>.pdf   the filed doc
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe stress_test/concurrency_harness.js
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const Database = require('better-sqlite3');

const { runMigrations } = require('../database/index');
const documents = require('../database/modules/documents');
const learning  = require('../database/modules/learning');
const doctypes  = require('../database/modules/document_types');
const filing    = require('../src/modules/filing/handler');
const api       = require('../src/modules/api/handler');
const pw        = require('../src/modules/auth/password');
const reviewServiceMod = require('../src/services/reviewService');
const presenceMod      = require('../src/services/presenceService');
const licensing        = require('../src/modules/licensing/handler');

const N_DOCS = 400;
const STAFF  = ['alice', 'bob', 'carol', 'dave'];
const PWD    = 'Staff-Pass-1';
const BATCH  = 30;
const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'assets', 'tutorial-samples', 'sample1.pdf'));
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let fail = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${extra ? '  ' + extra : ''}`); if (!cond) fail++; };
const san = (s) => String(s).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-');
const pad = (n) => String(n).padStart(2, '0');
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

function request(port, method, urlPath, { token, body } = {}) {
  return new Promise((resolve) => {
    const data = body != null ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, agent, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
    } }, (res) => {
      let buf = ''; res.on('data', c => (buf += c));
      res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch {} resolve({ status: res.statusCode, json }); });
    });
    req.on('error', (e) => resolve({ status: 0, json: null, err: e.message }));
    if (data) req.write(data);
    req.end();
  });
}
const confirmBody = (d, supplierOverride) => ({
  document_type_slug: 'invoice',
  supplier_name: supplierOverride || d.supplier,
  allValues: { supplier_name: supplierOverride || d.supplier, invoice_number: d.ref, invoice_date: d.date },
  corrections: {},
});

function workingCopyBytes(id) {
  // Real PDF bytes + a UNIQUE marker after %%EOF (harmless trailing bytes) so we can prove
  // each filed file carries ITS OWN doc's content.
  return Buffer.concat([SAMPLE, Buffer.from(`\n%%PDFDOC:${id}:${Math.random().toString(36).slice(2)}\n`)]);
}

// ── Isolated environment (temp DB + dirs + real /v1 server + logged-in staff) ────
async function makeEnv() {
  const ROOT   = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-stress-'));
  const IMPORT = path.join(ROOT, 'import'), INBOX = path.join(ROOT, 'inbox'), OUTPUT = path.join(ROOT, 'output');
  for (const d of [IMPORT, INBOX, OUTPUT]) fs.mkdirSync(d, { recursive: true });

  const db = new Database(path.join(ROOT, 'stress.db'));
  runMigrations(db);
  doctypes.seedBuiltInTypes(db);
  learning.setSetting(db, 'output_folder', OUTPUT);

  const _origDenied = licensing.licenseDenied;
  licensing.licenseDenied = () => null;

  const srcRemovals = [];
  const reviewService = reviewServiceMod.createReviewService({
    documents, learning, doctypes, filing, fs, path, logger: null,
    audit: () => {}, notifyCounts: () => {}, releaseDelayMs: 0,
    onScheduleSourceMove: ({ srcPath }) => {
      try { if (srcPath && fs.existsSync(srcPath)) { fs.unlinkSync(srcPath); srcRemovals.push(srcPath); } } catch {}
    },
  });
  const server = api.createServer({
    getDb: () => db,
    learning: { getDigitsOnlyFields: () => [] },
    reviewService,
    presence: presenceMod.createPresenceService(),
    checkEntitlement: () => ({ entitled: true, feature: 'detached_client',
      search: { entitled: true, seats: 99 }, workflow: { entitled: true, seats: 99 } }),
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const h = await pw.hashPassword(PWD);
  const insU = db.prepare("INSERT INTO users (username, display_name, password_hash, role, is_active) VALUES (?,?,?,?,1)");
  for (const u of STAFF) insU.run(u, u[0].toUpperCase() + u.slice(1), h, 'edit');
  const tokens = {};
  for (const u of STAFF) tokens[u] = (await request(port, 'POST', '/v1/auth/login', { body: { username: u, password: PWD } })).json?.token;

  const invId = db.prepare("SELECT id FROM document_types WHERE slug='invoice'").get().id;
  async function cleanup() {
    await new Promise(r => server.close(r));
    db.close(); licensing.licenseDenied = _origDenied;
    if (!process.env.KEEP) { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {} }
  }
  return { ROOT, IMPORT, INBOX, OUTPUT, db, port, tokens, invId, srcRemovals, cleanup };
}

// Seed one needs_review doc with a marked working copy + import original. Returns docId.
function seedDoc(env, { supplier, ref, date, workingPathOverride, missingWorkingCopy }) {
  const r = documents.insert(env.db, {
    original_filename: `orig_TBD.pdf`, folder_path: env.IMPORT, document_type_id: env.invId,
    supplier_name: supplier, overall_confidence: 80, status: 'needs_review', page_count: 1,
  });
  const id = r.lastInsertRowid;
  const orig = `orig_${id}.pdf`;
  fs.writeFileSync(path.join(env.IMPORT, orig), SAMPLE);
  env.db.prepare('UPDATE documents SET original_filename=? WHERE id=?').run(orig, id);
  let wc = workingPathOverride || path.join(env.INBOX, `${id}.pdf`);
  if (!missingWorkingCopy) fs.writeFileSync(wc, workingCopyBytes(id));
  documents.update(env.db, id, { working_path: missingWorkingCopy ? path.join(env.INBOX, `${id}_MISSING.pdf`) : wc });
  return id;
}

function countPdfs(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.metadata') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(countPdfs(full));
    else if (e.name.endsWith('.pdf')) out.push(full);
  }
  return out;
}

// ── MAIN 400-DOC STRESS ───────────────────────────────────────────────────────
async function runMainStress() {
  console.log('\n=== MAIN STRESS: 400 docs, 4 staff, real /v1 + real filing ===');
  const env = await makeEnv();

  // Plan: unique (supplier,date,ref) per doc → distinct location. Last 8 form 4 collision
  // pairs (identical target name) to prove -DUPLICATE handling under concurrency.
  const plan = [];
  for (let i = 1; i <= N_DOCS; i++) {
    const supplier = `Stress Supplier ${i % 40}`;
    const year = 2020 + (i % 6), month = i % 12, day = (i % 27) + 1;
    plan.push({ n: i, supplier, supplierFolder: san(supplier), year, monthName: MONTHS[month],
      date: `${pad(day)}-${pad(month + 1)}-${year}`, ref: `INV-${100000 + i}` });
  }
  for (let k = 0; k < 4; k++) {                    // docs 397..400 collide with 393..396
    const s = plan[392 + k], d = plan[396 + k];
    Object.assign(d, { supplier: s.supplier, supplierFolder: s.supplierFolder, year: s.year,
      monthName: s.monthName, date: s.date, ref: s.ref, isDupOf: s.n });
  }
  for (const d of plan) d.docId = seedDoc(env, d);

  const q0 = await request(env.port, 'GET', '/v1/review/queue', { token: env.tokens.alice });
  check('queue starts with all 400 docs needs_review', q0.json && q0.json.queue.length === N_DOCS, `(${q0.json && q0.json.queue.length})`);

  // PHASE A — docs 1..360: all 4 staff confirm the SAME doc simultaneously.
  const phaseA = plan.slice(0, 360), phaseB = plan.slice(360, 392), phaseC = plan.slice(392);
  console.log(`PHASE A — 4-way simultaneous confirm on ${phaseA.length} docs (${phaseA.length * 4} requests)…`);
  let multiWinner = 0, zeroWinner = 0, winners = 0;
  for (let s = 0; s < phaseA.length; s += BATCH) {
    await Promise.all(phaseA.slice(s, s + BATCH).map(async (d) => {
      const res = await Promise.all(STAFF.map(u => request(env.port, 'POST', `/v1/documents/${d.docId}/confirm`, { token: env.tokens[u], body: confirmBody(d) })));
      const ok = res.filter(r => r.status === 200);
      if (ok.length === 1) winners++;
      if (ok.length > 1) { multiWinner++; console.log(`  !! doc ${d.docId}: ${ok.length} WINNERS — double-file`); }
      if (ok.length === 0) { zeroWinner++; console.log(`  !! doc ${d.docId}: 0 winners statuses=${res.map(r=>r.status)}`); }
    }));
  }
  check('PHASE A: no doc had >1 winner (no double-file)', multiWinner === 0, `(${multiWinner})`);
  check('PHASE A: no doc had 0 winners (no lost doc)', zeroWinner === 0, `(${zeroWinner})`);
  check('PHASE A: exactly one winner per doc', winners === phaseA.length, `(${winners}/${phaseA.length})`);

  // PHASE B — docs 361..392: defer/undefer perturbation vs confirm (confirm may claim a
  // deferred doc, so it should still win); a cleanup sweep files any straggler.
  console.log(`PHASE B — defer/undefer vs confirm on ${phaseB.length} docs…`);
  for (let s = 0; s < phaseB.length; s += BATCH) {
    await Promise.all(phaseB.slice(s, s + BATCH).map(d => Promise.all([
      request(env.port, 'POST', `/v1/documents/${d.docId}/defer`,   { token: env.tokens.alice }),
      request(env.port, 'POST', `/v1/documents/${d.docId}/confirm`, { token: env.tokens.bob,   body: confirmBody(d) }),
      request(env.port, 'POST', `/v1/documents/${d.docId}/confirm`, { token: env.tokens.carol, body: confirmBody(d) }),
      request(env.port, 'POST', `/v1/documents/${d.docId}/undefer`, { token: env.tokens.dave }),
    ])));
  }
  let swept = 0;
  for (const d of phaseB) {
    const row = documents.getById(env.db, d.docId);
    if (row.status !== 'confirmed') {
      if (row.status === 'deferred') await request(env.port, 'POST', `/v1/documents/${d.docId}/undefer`, { token: env.tokens.alice });
      if ((await request(env.port, 'POST', `/v1/documents/${d.docId}/confirm`, { token: env.tokens.alice, body: confirmBody(d) })).status === 200) swept++;
    }
  }
  console.log(`  (cleanup sweep filed ${swept} straggler(s))`);

  // PHASE C — the 8 collision docs confirmed ALL AT ONCE (R10: filename-collision race).
  console.log(`PHASE C — concurrent filename-collision burst (${phaseC.length} docs, 4 colliding pairs)…`);
  await Promise.all(phaseC.map(d => request(env.port, 'POST', `/v1/documents/${d.docId}/confirm`, { token: env.tokens[STAFF[d.n % 4]], body: confirmBody(d) })));

  // ── INVARIANTS ──
  console.log('\nVERIFY — end-state invariants…');
  const rows = env.db.prepare('SELECT id, status, stored_path, working_path, confirmed_by_username, confirmed_at, supplier_name, reference_number FROM documents ORDER BY id').all();
  const byId = new Map(rows.map(r => [r.id, r]));

  check('A1 doc count unchanged (none lost/phantom)', rows.length === N_DOCS, `(${rows.length})`);
  check('A2 every doc CONFIRMED', rows.every(r => r.status === 'confirmed'), `(${rows.filter(r=>r.status==='confirmed').length}/${N_DOCS})`);
  check('B4 no half-confirmed row (stored_path+confirmed_by+confirmed_at all set)',
    rows.every(r => r.stored_path && r.confirmed_by_username && r.confirmed_at));
  check('B5 confirmed_by is one of the 4 staff', rows.every(r => STAFF.includes(r.confirmed_by_username)));
  check('B6 no confirmed row still holds a working_path', rows.every(r => !r.working_path));

  const stored = rows.map(r => r.stored_path);
  check('C9 every stored file exists on disk', stored.every(p => fs.existsSync(p)));
  const storedSet = new Set(stored);
  check('C10a stored_path unique per doc', storedSet.size === stored.length, `(${storedSet.size}/${stored.length})`);
  const physical = countPdfs(env.OUTPUT);
  const physicalSet = new Set(physical.map(p => path.resolve(p)));
  const storedResolved = new Set(stored.map(p => path.resolve(p)));
  check('C8 physical PDF count == confirmed count', physical.length === N_DOCS, `(${physical.length}/${N_DOCS})`);
  const bijection = physicalSet.size === storedResolved.size && [...storedResolved].every(p => physicalSet.has(p)) && [...physicalSet].every(p => storedResolved.has(p));
  check('C10 BIJECTION stored_paths ≡ physical files (no loss/dupe/orphan)', bijection);

  // C11 correct computed location + C12 content marker (each file carries ITS OWN doc's bytes)
  let wrongLoc = 0, wrongContent = 0;
  for (const d of plan) {
    const row = byId.get(d.docId);
    const expectDir = path.join(env.OUTPUT, d.supplierFolder, String(d.year), d.monthName);
    const nameOk = row.stored_path && path.basename(row.stored_path).includes(d.ref);
    if (path.resolve(path.dirname(row.stored_path || '')) !== path.resolve(expectDir) || !nameOk) {
      if (++wrongLoc <= 5) console.log(`   loc? doc ${d.docId}: want ${expectDir}\\..${d.ref} got ${row.stored_path}`);
    }
    try { if (!fs.readFileSync(row.stored_path).toString('latin1').includes(`PDFDOC:${d.docId}:`)) {
      if (++wrongContent <= 5) console.log(`   content? doc ${d.docId}: filed file lacks its own marker → ${row.stored_path}`);
    } } catch { wrongContent++; }
  }
  check('C11 every doc filed to its CORRECT location (supplier/year/month + ref)', wrongLoc === 0, `(${wrongLoc} misfiled)`);
  check('C12 every filed PDF contains ITS OWN doc marker (no cross-doc/overwrite mixup)', wrongContent === 0, `(${wrongContent} wrong)`);

  // C13 duplicates
  let dupOk = 0;
  for (const d of plan.filter(x => x.isDupOf)) {
    const row = byId.get(d.docId);
    if (row && /-DUPLICATE/.test(path.basename(row.stored_path)) && fs.existsSync(row.stored_path)) dupOk++;
  }
  check('C13 the 4 collision docs got -DUPLICATE names + both copies exist', dupOk === 4, `(${dupOk}/4)`);

  // E inbox/source
  check('E15 all working copies consumed (inbox empty)', fs.readdirSync(env.INBOX).filter(f => f.endsWith('.pdf')).length === 0);
  check('E15 the original IMPORT folder is EMPTY', fs.readdirSync(env.IMPORT).filter(f => f.endsWith('.pdf')).length === 0, `(${fs.readdirSync(env.IMPORT).filter(f=>f.endsWith('.pdf')).length} left)`);

  // F counts
  check('F16 getReviewCount == 0 and getDeferredCount == 0', documents.getReviewCount(env.db) === 0 && documents.getDeferredCount(env.db) === 0);

  const dist = {}; for (const r of rows) dist[r.confirmed_by_username] = (dist[r.confirmed_by_username] || 0) + 1;
  console.log('  winner distribution across staff:', JSON.stringify(dist));

  if (process.env.KEEP) console.log(`  (KEEP=1 → sandbox at ${env.ROOT})`);
  await env.cleanup();
}

// ── FOCUSED ADVERSARIAL RACES (each on dedicated docs, own assertions) ──────────
async function runFocusedRaces() {
  console.log('\n=== FOCUSED ADVERSARIAL RACES ===');
  const env = await makeEnv();
  const { port, tokens, db } = env;

  // R6 defer vs defer
  {
    const id = seedDoc(env, { supplier: 'R6 Co', ref: 'R6-1', date: '01-01-2024' });
    const [a, b] = await Promise.all([
      request(port, 'POST', `/v1/documents/${id}/defer`, { token: tokens.alice }),
      request(port, 'POST', `/v1/documents/${id}/defer`, { token: tokens.bob }),
    ]);
    const oks = [a, b].filter(r => r.status === 200).length;
    check('R6 defer-vs-defer: exactly one 200, one 409', oks === 1 && [a, b].some(r => r.status === 409));
    check('R6 doc ends deferred, unfiled', documents.getById(db, id).status === 'deferred');
  }
  // R7 undefer vs undefer
  {
    const id = seedDoc(env, { supplier: 'R7 Co', ref: 'R7-1', date: '01-01-2024' });
    await request(port, 'POST', `/v1/documents/${id}/defer`, { token: tokens.alice });
    const [a, b] = await Promise.all([
      request(port, 'POST', `/v1/documents/${id}/undefer`, { token: tokens.alice }),
      request(port, 'POST', `/v1/documents/${id}/undefer`, { token: tokens.bob }),
    ]);
    check('R7 undefer-vs-undefer: exactly one 200, one 409', [a, b].filter(r => r.status === 200).length === 1 && [a, b].some(r => r.status === 409));
    check('R7 doc back to needs_review', documents.getById(db, id).status === 'needs_review');
  }
  // R8 re-confirm an already-filed doc → 409 (never re-file/overwrite over /v1)
  {
    const id = seedDoc(env, { supplier: 'R8 Co', ref: 'R8-1', date: '01-01-2024' });
    const first = await request(port, 'POST', `/v1/documents/${id}/confirm`, { token: tokens.alice, body: confirmBody({ supplier: 'R8 Co', ref: 'R8-1', date: '01-01-2024' }) });
    const filedPath = documents.getById(db, id).stored_path;
    const before = fs.readFileSync(filedPath);
    const again = await request(port, 'POST', `/v1/documents/${id}/confirm`, { token: tokens.bob, body: confirmBody({ supplier: 'R8 Co', ref: 'R8-1', date: '01-01-2024' }) });
    check('R8 first confirm 200, re-confirm 409 ALREADY_FILED', first.status === 200 && again.status === 409 && again.json.code === 'ALREADY_FILED');
    check('R8 filed file unchanged (no overwrite)', Buffer.compare(before, fs.readFileSync(filedPath)) === 0);
    check('R8 still exactly one physical file for the doc', countPdfs(env.OUTPUT).filter(p => p.includes('R8')).length === 1);
  }
  // R11 filing-failure rollback (BOTH working copy AND import original missing → commitDocument
  // finds no source → fails → the row must revert cleanly, never strand as confirmed-without-file)
  {
    const id = seedDoc(env, { supplier: 'R11 Co', ref: 'R11-1', date: '01-01-2024', missingWorkingCopy: true });
    try { fs.unlinkSync(path.join(env.IMPORT, documents.getById(db, id).original_filename)); } catch {}
    const r = await request(port, 'POST', `/v1/documents/${id}/confirm`, { token: tokens.alice, body: confirmBody({ supplier: 'R11 Co', ref: 'R11-1', date: '01-01-2024' }) });
    const row = documents.getById(db, id);
    check('R11 filing failure does NOT return success', r.status !== 200);
    check('R11 doc rolled back to needs_review (not stranded confirmed)', row.status === 'needs_review');
    check('R11 rollback cleared stored_path/confirmed_by/confirmed_at', !row.stored_path && !row.confirmed_by_username && !row.confirmed_at);
  }
  // R13 workflow-locked confirm → 409 WORKFLOW_LOCKED, no claim leaks
  {
    const id = seedDoc(env, { supplier: 'R13 Co', ref: 'R13-1', date: '01-01-2024' });
    db.prepare(`INSERT INTO document_routes (document_id, from_user_id, from_username, to_user_id, to_username, action_required, state)
                VALUES (?, 1, 'alice', 2, 'bob', 'approve', 'pending')`).run(id);
    const res = await Promise.all(STAFF.map(u => request(port, 'POST', `/v1/documents/${id}/confirm`, { token: tokens[u], body: confirmBody({ supplier: 'R13 Co', ref: 'R13-1', date: '01-01-2024' }) })));
    check('R13 all 4 confirms on a locked doc → 409 WORKFLOW_LOCKED', res.every(r => r.status === 409 && r.json && r.json.code === 'WORKFLOW_LOCKED'));
    check('R13 doc stays needs_review (no claim leaked past the guard)', documents.getById(db, id).status === 'needs_review');
  }
  // E6 value divergence — two staff confirm one doc with DIFFERENT suppliers; the filed
  // location + stored value must be the WINNER's, never a blend.
  {
    const id = seedDoc(env, { supplier: 'Default Co', ref: 'E6-1', date: '01-01-2024' });
    const res = await Promise.all([
      request(port, 'POST', `/v1/documents/${id}/confirm`, { token: tokens.alice, body: confirmBody({ ref: 'E6-1', date: '01-01-2024' }, 'Alice Supplier') }),
      request(port, 'POST', `/v1/documents/${id}/confirm`, { token: tokens.bob,   body: confirmBody({ ref: 'E6-1', date: '01-01-2024' }, 'Bob Supplier') }),
    ]);
    const winner = res.filter(r => r.status === 200);
    const row = documents.getById(db, id);
    const supOk = row.supplier_name === 'Alice Supplier' || row.supplier_name === 'Bob Supplier';
    const locOk = row.stored_path && row.stored_path.includes(san(row.supplier_name));
    check('E6 exactly one winner on divergent-value confirm', winner.length === 1);
    check('E6 stored value is one racer\'s (no blend)', supOk, `(${row.supplier_name})`);
    check('E6 filed location matches the stored winner value', locOk);
    check('E6 exactly one physical file for the doc', countPdfs(env.OUTPUT).filter(p => p.includes('E6-1')).length === 1);
  }

  await env.cleanup();
}

async function main() {
  await runFocusedRaces();
  await runMainStress();
  agent.destroy();
  console.log(`\n${fail === 0 ? '✅ ALL INVARIANTS HELD — no docs lost, every doc filed exactly once to the right place, import folder empty.' : '❌ ' + fail + ' CHECK(S) FAILED'}`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
