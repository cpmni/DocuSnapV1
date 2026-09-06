#!/usr/bin/env node
'use strict';
/**
 * src/modules/review/test_template_file_sync.js
 * ---------------------------------------------
 * Chris round 15 card 2 (2026-08-22): the four header-cut copies read perfectly at teach time and
 * came back "Couldn't match this document to a saved layout" on re-import. ROOT CAUSE:
 * templates.learnTemplateOnCommit (identity convergence on every human confirm) intersects the
 * template's keyword_fingerprint in the DB — and the Python matcher reads the template FILE
 * (_writeTemplateFile's JSON dump), which nothing rewrote. DS: DB 5 tokens, file 7 tokens →
 * header-cut copies 5/7 = 0.71 < 0.75. Fix: both learn-on-commit callers (the review confirm dep
 * and the import auto-file door) rewrite the file after the intersection; env
 * TEMPLATE_FILE_SYNC_ON_COMMIT=0 disables. Plus: a DOCUSNAP_USERDATA sandbox gets its own
 * templatesDir (rounds ≤15 shared the repo's dev templates/ folder with the owner's live app).
 *
 * 2026-09-05 (log review 5a): §2's source-text regex PINNED THE BUG — register()'s ctx destructure
 * never bound `templatesDir`, so the dep threw ReferenceError inside its try/catch on every confirm
 * ("template file sync (commit): templatesDir is not defined" x35 in processing.log) and the file
 * never synced. §4 EXECUTES the dep through register() + the real confirm (a warn spy + the file on
 * disk; a poisoned templatesDir proves the spy sees dep failures); §5 lints every ctx helper called
 * bare inside register() against its destructure (the 77e674e class: a call-time ReferenceError no
 * module-load smoke can catch).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/modules/review/test_template_file_sync.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const documents = require(path.join(ROOT, 'database', 'modules', 'documents'));
const templates = require(path.join(ROOT, 'database', 'modules', 'templates'));
const learning = require(path.join(ROOT, 'database', 'modules', 'learning'));
const review = require('./handler');

let fails = 0;
const check = (label, cond, detail) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && detail ? '\n      ' + detail : ''}`); if (!cond) fails++; return cond; };

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1, 'Service Worksheet', 'service_worksheet', 0)").run();
learning.setSetting(db, 'template_learn_on_confirm', 'true');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tplsync-'));
const SEED = ['SERVICE', 'WORKSHEET', 'DOCUMENT', 'Ticket', 'Location', 'Work', 'Address'];
const tid = templates.create(db, { name: 'DOCUMENT SOLUTIONS', document_type_slug: 'service_worksheet', keyword_fingerprint: SEED, fields: [] });
db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value) VALUES (?, 'supplier_name', 'DOCUMENT SOLUTIONS')").run(tid);
review._writeTemplateFileForSync(db, tid, dir);
const file = () => { const f = fs.readdirSync(dir).find(n => n.endsWith('.json')); return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); };
check('the template file carries the seed (7 tokens)', file().keyword_fingerprint.length === 7);

// a header-cut copy: its fingerprint lacks SERVICE/WORKSHEET
const HEADCUT = ['DOCUMENT', 'SOLUTIONS', 'Ticket', 'Location', 'Work', 'Address', 'Beaumont', 'Care', 'Homes', 'Ltd'];
const docId = Number(documents.insert(db, { original_filename: 'cut.pdf', folder_path: '/in', status: 'confirmed', supplier_name: 'DOCUMENT SOLUTIONS', document_type_id: 1, template_id: tid, keyword_fingerprint: JSON.stringify(HEADCUT) }).lastInsertRowid);

console.log('§1 learnTemplateOnCommit intersects the DB row and now RETURNS the template id');
const r = templates.learnTemplateOnCommit(db, docId, { document_type_slug: 'service_worksheet', supplier_name: 'DOCUMENT SOLUTIONS' });
const dbFp = JSON.parse(db.prepare('SELECT keyword_fingerprint FROM templates WHERE id = ?').get(tid).keyword_fingerprint);
check('DB fingerprint intersected to 5 tokens (the exhibit)', dbFp.length === 5 && !dbFp.includes('SERVICE'));
check('returns the enriched template id', r === tid);
check('…and the FILE is still stale (7 tokens) — the bug, before the caller syncs', file().keyword_fingerprint.length === 7);

console.log('§2 the review dep mirrors it into the file');
// the dep is private to register(); exercise the same two public pieces it composes
const tid2 = templates.learnTemplateOnCommit(db, docId, { document_type_slug: 'service_worksheet', supplier_name: 'DOCUMENT SOLUTIONS' });
if (tid2 && process.env.TEMPLATE_FILE_SYNC_ON_COMMIT !== '0') review._writeTemplateFileForSync(db, tid2, dir);
check('after the sync the file equals the DB (5 tokens)', JSON.stringify(file().keyword_fingerprint) === JSON.stringify(dbFp));
const src = fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8');
const dep = src.slice(src.indexOf('learnTemplateOnCommit: (db, docId, info) =>'), src.indexOf('learnTemplateOnCommit: (db, docId, info) =>') + 700);
check('review/handler dep: learnTemplateOnCommit → _writeTemplateFile (env TEMPLATE_FILE_SYNC_ON_COMMIT=0 disables)', /_writeTemplateFile\(db, tid, path, fs, templatesDir\(\)\)/.test(dep) && /TEMPLATE_FILE_SYNC_ON_COMMIT !== '0'/.test(dep));
const ph = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
check('processing auto-file door: the same sync after its learnTemplateOnCommit', /_writeTemplateFileForSync\(db, tid, _templatesDirFn\(\)\)/.test(ph) && /_templatesDirFn = typeof ctx\.templatesDir === 'function'/.test(ph));

console.log('§3 a DOCUSNAP_USERDATA sandbox owns its templatesDir');
const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const td = main.slice(main.indexOf('function templatesDir()'), main.indexOf('function templatesDir()') + 900);
check('templatesDir(): sandboxed (dev + DOCUSNAP_USERDATA) → <userData>/templates; packaged unchanged; plain dev unchanged',
      /const sandboxed = !app\.isPackaged && !!process\.env\.DOCUSNAP_USERDATA;/.test(td) && /\(app\.isPackaged \|\| sandboxed\)/.test(td) && /resourcePath\('templates'\)/.test(td));

(async () => {
  console.log('§4 EXECUTING: register() + the real confirm writes the template file (no "template file sync" warn)');
  // 5a (2026-09-05): the §2 regex above matched the exact call text of the BUGGY source too — the dep read
  // `templatesDir` bare while register()'s destructure never bound it, so every confirm logged
  // "template file sync (commit): templatesDir is not defined" and the file stayed stale. Drive the dep
  // through register() itself: a warn spy + the file landing in the ctx's templatesDir.
  const warns = [];
  const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tplsync-ctx-'));
  const outDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'tplsync-out-'));
  const inDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'tplsync-in-'));
  let poison = false;
  const fakeAuth = { requireLogin() { return { username: 'sarah', role: 'admin' }; }, requireRole() { return { username: 'sarah', role: 'admin' }; },
                     getCurrentUser() { return { username: 'sarah', role: 'admin' }; }, hasRole() { return true; }, logAudit() {} };
  const authPath = require.resolve('../auth/handler');
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };
  const licPath = require.resolve('../licensing/handler');
  require.cache[licPath] = { id: licPath, filename: licPath, loaded: true, exports: new Proxy({ licenseDenied: () => null }, { get: (t, k) => (k in t ? t[k] : () => null) }) };
  review.register({
    ipcMain: { handle: () => {}, on: () => {} },
    getDb: () => db,
    resourcePath: (...p) => path.join(ROOT, ...p), pythonExe: () => 'py', pythonArgs: (...a) => a,
    tesseractPath: () => 'tesseract', backendScript: () => path.join(ROOT, 'python_backend', 'process_docs.py'),
    configPath: () => path.join(ROOT, 'config', 'keyword_patterns.json'),
    templatesDir: () => { if (poison) throw new Error('poisoned templatesDir'); return syncDir; },
    createWindow: () => null, getMainWindow: () => null,
    notifyMainWindow: () => {}, notifyAllWindows: () => {}, safeSend: () => {},
    notifyDevInspector: () => {}, notifyReview: () => {}, notifyWorkflowEvent: () => {},
    reviewTraceActive: false, devSliceDir: path.join(os.tmpdir(), 'ds-devslices-test'),
    windows: {}, app: null, fs, path,
    logger: { log: () => {}, warn: (m) => warns.push(String(m)), err: (m) => warns.push(String(m)) },
    spawn: () => { throw new Error('spawn must not run in this test'); },
  });
  learning.setSetting(db, 'output_folder', outDir);
  const mkDoc = (name, fp) => {
    fs.writeFileSync(path.join(inDir, name), 'not really a pdf');
    return Number(documents.insert(db, { original_filename: name, folder_path: inDir, status: 'needs_review',
      supplier_name: 'DOCUMENT SOLUTIONS', document_type_id: 1, template_id: tid, keyword_fingerprint: JSON.stringify(fp) }).lastInsertRowid);
  };
  const confirmDoc = (id) => review.getReviewService().confirm(db, { username: 'sarah', role: 'admin' }, {
    document_id: id, corrections: {}, taught_fields: [], bulk: true,
    allValues: { supplier_name: 'DOCUMENT SOLUTIONS', ticket_number: 'T-1' },
    supplier_name: 'DOCUMENT SOLUTIONS', document_type: 'Service Worksheet', document_type_slug: 'service_worksheet' });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const syncFiles = () => fs.readdirSync(syncDir).filter(n => n.endsWith('.json'));

  const d1 = mkDoc('a.pdf', ['DOCUMENT', 'SOLUTIONS', 'Ticket', 'Location', 'Work', 'Beaumont']);
  const r1 = await confirmDoc(d1);
  await sleep(150);   // the learn-on-commit hook is detached (Promise.resolve().then)
  check('the confirm filed the doc', r1 && r1.success === true, JSON.stringify(r1).slice(0, 200));
  check('the template FILE landed in ctx.templatesDir()', syncFiles().length === 1, JSON.stringify(syncFiles()));
  check('…and it mirrors the DB intersection (4 tokens)', (() => {
    const f = syncFiles()[0]; if (!f) return false;
    const fileFp = JSON.parse(fs.readFileSync(path.join(syncDir, f), 'utf8')).keyword_fingerprint;
    const dbFp2 = JSON.parse(db.prepare('SELECT keyword_fingerprint FROM templates WHERE id = ?').get(tid).keyword_fingerprint);
    return JSON.stringify(fileFp) === JSON.stringify(dbFp2) && dbFp2.length === 4;
  })());
  check('NO "template file sync" warn (the old source logged "templatesDir is not defined" here)',
        !warns.some(w => /template file sync/.test(w)), JSON.stringify(warns));

  console.log('§4b SENSITIVITY CONTROL: a poisoned templatesDir surfaces as the same warn (the spy sees dep failures)');
  poison = true;
  const d2 = mkDoc('b.pdf', ['DOCUMENT', 'SOLUTIONS', 'Ticket', 'Location', 'Work']);
  await confirmDoc(d2);
  await sleep(150);
  check('the poisoned dep is caught and logged as "template file sync (commit): …"',
        warns.some(w => /template file sync \(commit\): poisoned templatesDir/.test(w)), JSON.stringify(warns));
  check('…and no new file was written', syncFiles().length === 1);
  poison = false;

  console.log('§5 LINT: every ctx helper called BARE inside register() is bound by its destructure (the 77e674e class)');
  const body = src.slice(src.indexOf('function register(ctx) {'));
  const destr = (body.match(/const\s*\{([^}]*)\}\s*=\s*ctx;/) || [, ''])[1];
  const bound = new Set(destr.split(',').map(t => t.trim().split(/[:=]/)[0].trim()).filter(Boolean));
  const HELPERS = ['templatesDir', 'resourcePath', 'backendScript', 'configPath', 'pythonExe', 'pythonArgs', 'tesseractPath', 'spawn', 'notifyMainWindow'];
  const unbound = [];
  for (const h of HELPERS) {
    const bareUse = new RegExp('(?<![.\\w$])' + h + '\\s*\\(').test(body);
    const declared = bound.has(h) || new RegExp('\\b(?:const|let|var)\\s+' + h + '\\b').test(body) || new RegExp('\\b' + h + '\\s*=\\s*ctx\\.').test(body);
    if (bareUse && !declared) unbound.push(h);
  }
  check('destructure covers every bare helper call: ' + HELPERS.join('/'), unbound.length === 0, 'UNBOUND: ' + unbound.join(','));
  check('…the lint is live (templatesDir is both used bare and bound)', /(?<![.\w$])templatesDir\s*\(/.test(body) && bound.has('templatesDir'));

  for (const d of [dir, syncDir, outDir, inDir]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
