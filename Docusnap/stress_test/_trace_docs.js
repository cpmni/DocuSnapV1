'use strict';
/*
 * _trace_docs.js — reprocess a SMALL set of doc ids from the live DB and dump, per field,
 * the method + confidence + value + validation_note, plus the auto-file gate decision.
 * READ-ONLY on the DB (same snapshot approach as realdoc_regression.js). Scratch/diagnostic.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/_trace_docs.js 404 446 143 156 60
 */
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
const trust = require(path.join(REPO, 'database', 'modules', 'trust.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}
const w = (tag, d) => { const f = path.join(os.tmpdir(), `tr_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };

function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return dts;
}
function snapArgs(db) {
  const dts = docTypesWithFields(db);
  let anchors = safe(() => learning.getAllAnchors(db), []);
  // DROP_MISTAUGHT=1 simulates removing the end-of-session mis-taught invoice_number anchor
  // (the only invoice_number anchor; authoritative Cloud VPS) WITHOUT touching the live DB.
  if (process.env.DROP_MISTAUGHT) anchors = anchors.filter(a => a.field_key !== 'invoice_number');
  return ['--fields-file', w('f', dts.flatMap(d => d.fields)),
    '--hints-file', w('h', safe(() => learning.getHints(db), [])),
    '--anchors-file', w('a', anchors),
    '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
    '--doc-types-file', w('d', dts),
    '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
    '--templates-file', w('t', safe(() => templates.getAll(db), [])),
    '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
    '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
}
function runOne(folder, args, fname) {
  const extra = process.env.TRACE ? ['--trace'] : [];
  return new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', w('sh', [fname]), '--mode', 'fast', '--tesseract', TESS, ...extra, ...args], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
}

(async () => {
  const ids = process.argv.slice(2).map(Number).filter(Boolean);
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const roles = {}; for (const r of db.prepare('SELECT slug, ref_field_key, date_field_key FROM document_types').all()) roles[r.slug] = r;
  const slugToId = {}; for (const r of db.prepare('SELECT id, slug FROM document_types').all()) slugToId[r.slug] = r.id;
  const args = snapArgs(db);
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));
  for (const id of ids) {
    const d = db.prepare(`SELECT d.id, d.supplier_name, d.reference_number, d.doc_date, d.overall_confidence, d.working_path, d.stored_path, dt.slug type_slug
      FROM documents d LEFT JOIN document_types dt ON dt.id=d.document_type_id WHERE d.id=?`).get(id);
    if (!d) { console.log(`#${id} not found`); continue; }
    const src = (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
    if (!src) { console.log(`#${id} no file`); continue; }
    const fname = `doc${id}${path.extname(src) || '.pdf'}`;
    fs.copyFileSync(src, path.join(RR, fname));
    const out = await runOne(RR, args, fname);
    let m = null; const traces = [];
    for (const ln of out.split('\n')) { const t = ln.trim(); if (t[0] === '{') { try { const j = JSON.parse(t); if (j.type === 'file_done') m = j; else if (j.type === 'trace') traces.push(j); } catch {} } }
    if (process.env.TRACE) {
      const F = process.env.TRACE_FIELD || 'invoice_number';
      console.log(`  --- TRACE events mentioning ${F} ---`);
      for (const t of traces) { const s = JSON.stringify(t); if (s.includes(F)) console.log('    | ' + s); }
    }
    const role = roles[d.type_slug] || {};
    console.log(`\n===== #${id}  supplier(want=${JSON.stringify(d.supplier_name)}) type=${d.type_slug} =====`);
    console.log(`  WANT ref=${JSON.stringify(d.reference_number)} date=${JSON.stringify(d.doc_date)}  stored_overall=${d.overall_confidence}`);
    if (!m) { console.log('  NO RESULT'); continue; }
    console.log(`  GOT supplier=${JSON.stringify(m.supplier_name)} overall=${m.overall_confidence} needs_review=${m.needs_review} template=${m._template_id||m.template_id||null} slug=${m._document_slug||null}`);
    const ex = m.extractions || {};
    for (const k of Object.keys(ex)) {
      const e = ex[k] || {};
      const star = (k === role.ref_field_key || k === role.date_field_key) ? ' <<CRITICAL' : '';
      console.log(`    [${k}] value=${JSON.stringify(e.value)} conf=${e.confidence} method=${e.method} note=${JSON.stringify(e.validation_note||null)}${star}`);
    }
    if (process.env.GREP && m.ocr_text) {
      const pats = process.env.GREP.split(',');
      console.log('  --- OCR lines matching [' + process.env.GREP + '] ---');
      for (const ln of m.ocr_text.split('\n')) { if (pats.some(p => ln.includes(p))) console.log('    | ' + ln.trim()); }
    }
    // gate decision
    const detId = slugToId[m._document_slug || null];
    if (detId != null && m.overall_confidence != null) {
      const rex = Object.entries(ex).map(([k, e]) => ({ field_key: k, display_value: (e && typeof e === 'object') ? e.value : e, validation_note: (e && typeof e === 'object') ? e.validation_note : null, confidence: (e && typeof e === 'object') ? e.confidence : null }));
      const fakeDoc = { id: d.id, supplier_name: m.supplier_name, document_type_id: detId, overall_confidence: m.overall_confidence };
      let g; try { g = trust.isAutoFileEligible(db, fakeDoc, { extractions: rex }); } catch (e) { g = { error: e.message }; }
      console.log(`  GATE: ${JSON.stringify(g)}`);
    }
  }
  fs.rmSync(RR, { recursive: true, force: true });
  db.close();
})();
