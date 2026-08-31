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
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/review/test_template_file_sync.js
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
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; };

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

try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
