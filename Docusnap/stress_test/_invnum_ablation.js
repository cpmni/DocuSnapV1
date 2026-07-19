'use strict';
/* _invnum_ablation.js — prove removing SuperStore's position-only invoice_number anchor (id=70)
 * makes invoice_number read correctly via keyword. ABLATE_ANCHOR_ID=70 drops that one anchor from
 * the snapshot (no DB write). Read-only. Session-local scratch. */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const TARGET_IDS = [161, 162, 163, 164, 165, 166];
const ABLATE = process.env.ABLATE_ANCHOR_ID ? parseInt(process.env.ABLATE_ANCHOR_ID, 10) : null;

const w = (t, d) => { const f = path.join(os.tmpdir(), `iv_${t}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, d) => { try { return fn(); } catch { return d; } };

function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all(); const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || []; return dts;
}
function snapArgs(db) {
  const dts = docTypesWithFields(db);
  let anchors = safe(() => learning.getAllAnchors(db), []);
  if (ABLATE != null) anchors = anchors.filter(a => a.id !== ABLATE);
  return ['--fields-file', w('f', dts.flatMap(d => d.fields)),
    '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
    '--anchors-file', w('a', anchors),
    '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
    '--doc-types-file', w('d', dts),
    '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
    '--templates-file', w('t', safe(() => templates.getAll(db), [])),
    '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
    '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
}
function runP(folder, args, files) {
  const one = shardFile => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile, '--mode', 'fast', '--tesseract', TESS, ...args], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return one(w('shard', files)).then(o => { const docs = {}; for (const ln of o.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; } return docs; });
}
(async () => {
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const rows = db.prepare(`SELECT id, original_filename, stored_path, working_path, reference_number FROM documents WHERE id IN (${TARGET_IDS.join(',')})`).all();
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-'));
  const resolveFile = d => (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
  const files = []; const meta = {};
  for (const d of rows) { const src = resolveFile(d); if (!src) continue; const fn = `doc${d.id}${path.extname(src) || '.pdf'}`; fs.copyFileSync(src, path.join(RR, fn)); files.push(fn); meta[fn] = d; }
  const args = snapArgs(db); db.close();
  const res = await runP(RR, args, files); fs.rmSync(RR, { recursive: true, force: true });
  console.log(`\n=== invoice_number ${ABLATE != null ? `(anchor id=${ABLATE} ABLATED)` : '(baseline, all anchors)'} ===`);
  console.log('id   | confirmed_ref | read              | method              | conf | overall | review');
  for (const fn of files.sort((a, b) => meta[a].id - meta[b].id)) {
    const m = res[fn]; const d = meta[fn]; if (!m) { console.log(`#${d.id} NO RESULT`); continue; }
    const e = (m.extractions && m.extractions.invoice_number) || {};
    console.log(`#${String(d.id).padEnd(4)}| ${String(d.reference_number).padEnd(14)}| ${String(e.value == null ? '(empty)' : e.value).padEnd(18)}| ${String(e.method || '').padEnd(20)}| ${String(e.confidence == null ? '-' : e.confidence).padEnd(5)}| ${String(m.overall_confidence).padEnd(8)}| ${!!m.needs_review}`);
  }
})();
