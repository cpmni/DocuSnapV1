'use strict';
/* _issuer_report.js — before/after for the text-first issuer graduation. Reprocesses the 54
 * SuperStore template_identity+note docs and reports how supplier_name resolves (method / conf /
 * note / needs_review / overall). PASS after the fix = value stays SuperStore, note gone on the
 * graduated ones, 0 wrong supplier. Read-only DB. Session-local scratch. */
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

const TARGET_IDS = [161,162,163,165,166,169,170,175,185,189,190,191,197,200,204,206,209,212,213,216,219,220,222,223,225,226,228,229,231,235,236,238,241,250,251,255,256,257,258,260,263,265,267,268,270,272,273,274,276,279,281,283,285,286];

const w = (t, d) => { const f = path.join(os.tmpdir(), `ir_${t}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, d) => { try { return fn(); } catch { return d; } };
function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all(); const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || []; return dts;
}
function snapArgs(db) {
  const dts = docTypesWithFields(db);
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
  const N = 8; const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const sf = shards.filter(x => x.length).map(n => w('shard', n));
  const one = shardFile => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile, '--mode', 'fast', '--tesseract', TESS, ...args], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(sf.map(one)).then(outs => { const docs = {}; for (const o of outs) for (const ln of o.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; } return docs; });
}
(async () => {
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const rows = db.prepare(`SELECT id, original_filename, stored_path, working_path FROM documents WHERE id IN (${TARGET_IDS.join(',')})`).all();
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-'));
  const rf = d => (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
  const files = []; const idBy = {};
  for (const d of rows) { const s = rf(d); if (!s) continue; const fn = `doc${d.id}${path.extname(s) || '.pdf'}`; fs.copyFileSync(s, path.join(RR, fn)); files.push(fn); idBy[fn] = d.id; }
  const args = snapArgs(db); db.close();
  const res = await runP(RR, args, files); fs.rmSync(RR, { recursive: true, force: true });
  let noted = 0, wrong = 0, filed = 0, superstore = 0;
  const details = [];
  for (const fn of files.sort((a, b) => idBy[a] - idBy[b])) {
    const m = res[fn]; const id = idBy[fn]; if (!m) { details.push(`#${id} NO RESULT`); continue; }
    const sn = (m.extractions && m.extractions.supplier_name) || {};
    const val = sn.value == null ? '(empty)' : sn.value;
    const isSS = String(val).toLowerCase().replace(/[^a-z0-9]/g, '').includes('superstore');
    if (isSS) superstore++; else if (val !== '(empty)') wrong++;
    if (sn.validation_note) noted++;
    if (!m.needs_review) filed++;
    details.push(`#${String(id).padEnd(4)} ${String(val).padEnd(13).slice(0,13)} ${String(sn.method||'').padEnd(18)} c=${String(sn.confidence).padEnd(4)} note=${sn.validation_note?'Y':'.'} review=${m.needs_review?'Y':'.'} overall=${m.overall_confidence}`);
  }
  console.log(`\n=== Issuer report over ${files.length} SuperStore fill docs ===`);
  for (const d of details) console.log(' ', d);
  console.log(`\nSUMMARY: resolved SuperStore=${superstore}  WRONG supplier=${wrong}  still-noted=${noted}  not-needs_review(=would-clear-review)=${filed}`);
})();
