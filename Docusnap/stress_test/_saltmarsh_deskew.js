'use strict';
/* _saltmarsh_deskew.js — reproduce doc #337 (Saltmarsh worksheet) raw vs straightened.
 * DESKEW=1 adds --deskew-pages (the "Straighten + Reprocess" read). Reports template/slug + each
 * field's method/conf/note so we can see what straightening breaks. Read-only DB. Session scratch. */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require(path.join('c:/GIT Projects/Docusnap', 'node_modules', 'better-sqlite3'));
const REPO = 'c:/GIT Projects/Docusnap';
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}
const ID = 337;
const w = (t, d) => { const f = path.join(os.tmpdir(), `sd_${t}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, d) => { try { return fn(); } catch { return d; } };
function dtf(db) { const dts = db.prepare('SELECT * FROM document_types').all(); const b = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (b[f.document_type_id] || (b[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = b[dt.id] || []; return dts; }
function snapArgs(db) { const dts = dtf(db);
  return ['--fields-file', w('f', dts.flatMap(d => d.fields)),
    '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
    '--anchors-file', w('a', safe(() => learning.getAllAnchors(db), [])),
    '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
    '--doc-types-file', w('d', dts),
    '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
    '--templates-file', w('t', safe(() => templates.getAll(db), [])),
    '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
    '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
}
function runP(folder, args, files) {
  return new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', w('shard', files), '--mode', 'fast', '--tesseract', TESS, ...args], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => { const docs = {}; for (const ln of out.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; } res(docs); }); p.on('error', () => res({}));
  });
}
(async () => {
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const d = db.prepare(`SELECT id, original_filename, stored_path, working_path FROM documents WHERE id=?`).get(ID);
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-'));
  const src = (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : d.stored_path;
  const fn = `doc${d.id}${path.extname(src) || '.pdf'}`; fs.copyFileSync(src, path.join(RR, fn));
  const args = snapArgs(db); db.close();
  const extra = process.env.DESKEW === '1' ? ['--deskew-pages', '--deskew-min-angle', '0.2'] : [];
  const res = await runP(RR, [...args, ...extra], [fn]); fs.rmSync(RR, { recursive: true, force: true });
  const m = res[fn] || {};
  console.log(`\n=== #${ID} ${process.env.DESKEW === '1' ? 'STRAIGHTENED (--deskew-pages)' : 'RAW'} ===`);
  console.log(`document_type=${m.document_type}  _document_slug=${m._document_slug}  _template_id=${m._template_id}  overall=${m.overall_confidence}  needs_review=${m.needs_review}`);
  for (const k of ['supplier_name', 'reference_number', 'date', 'customer', 'order_date']) {
    const e = (m.extractions && m.extractions[k]); if (!e) continue;
    console.log(`  ${k.padEnd(17)} = ${String(e.value).padEnd(22).slice(0,22)} c=${String(e.confidence).padEnd(4)} ${String(e.method||'').padEnd(18)} ${e.validation_note ? 'NOTE:'+e.validation_note.slice(0,45) : ''}`);
  }
})();
