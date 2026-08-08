'use strict';
/* type_reprocess_probe.js — read-only: run the FULL pipeline on one doc and print the emitted
 * type + any type-refuse/hold signal. Settles "does the armed TYPE_PRESENCE_VETO actually hold
 * the SO worksheet fossils end-to-end, not just the bare predicate" (Oracle blocking Q1).
 * No DB write. Run: PROBE_ID=108 ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/type_reprocess_probe.js
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = process.env.RR_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}
const IDS = (process.env.PROBE_ID || '108,101').split(',').map(s => parseInt(s.trim(), 10));
const w = (t, d) => { const f = path.join(os.tmpdir(), `tp_${t}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, d) => { try { return fn(); } catch { return d; } };

function snap(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {}; for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return ['--fields-file', w('f', dts.flatMap(d => d.fields)), '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
    '--anchors-file', w('a', safe(() => learning.getAllAnchors(db), [])), '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
    '--doc-types-file', w('d', dts), '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
    '--templates-file', w('t', safe(() => templates.getAll(db), [])),
    '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
    '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
}

(async () => {
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const snapArgs = snap(db);
  const FOLDER = fs.mkdtempSync(path.join(os.tmpdir(), 'typeprobe-'));
  const resolveFile = d => (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
  const nameToDoc = {}; const files = [];
  for (const id of IDS) {
    const d = db.prepare('SELECT id, working_path, stored_path, supplier_name, template_id, (SELECT slug FROM document_types dt WHERE dt.id=documents.document_type_id) type_slug FROM documents WHERE id=?').get(id);
    const src = d && resolveFile(d); if (!src) { console.log(`#${id}: no file`); continue; }
    const fn = `doc${id}${path.extname(src) || '.pdf'}`; fs.copyFileSync(src, path.join(FOLDER, fn));
    nameToDoc[fn] = d; files.push(fn);
  }
  db.close();
  if (!files.length) { console.log('no files'); return; }
  const out = await new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', FOLDER, '--mode', 'fast', '--tesseract', TESS, ...snapArgs], { windowsHide: true });
    let b = ''; p.stdout.on('data', d => b += d); p.stderr.on('data', () => {}); p.on('close', () => res(b)); p.on('error', () => res(''));
  });
  const done = {}; for (const ln of out.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') done[m.original_filename] = m; }
  fs.rmSync(FOLDER, { recursive: true, force: true });

  console.log('\nid    stored-type      EMITTED-type       _slug         notes');
  for (const fn of files) {
    const d = nameToDoc[fn], m = done[fn]; if (!m) { console.log(`#${d.id}: no file_done`); continue; }
    const notes = Object.entries(m.extractions || {}).map(([k, e]) => (e && e.validation_note) ? `${k}:${String(e.validation_note).slice(0, 40)}` : null).filter(Boolean).slice(0, 2).join(' | ');
    console.log(String('#' + d.id).padEnd(6), String(d.type_slug || '∅').padEnd(16), String(m.document_type || 'UNTYPED/None').padEnd(18), String(m._document_slug || '∅').padEnd(13), notes || '');
  }
  console.log('\n(EMITTED-type UNTYPED/None or ≠ stored sales_order => the armed veto HOLDS the fossil on a fresh full-pipeline run.)');
})();
