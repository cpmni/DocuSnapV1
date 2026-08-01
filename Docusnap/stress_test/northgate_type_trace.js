'use strict';
/*
 * northgate_type_trace.js — CONTRASTIVE type-resolution trace for task #5 (Lever 1 / Lever 3).
 *
 * The confirmed-corpus gate (realdoc_regression.js) scores status='confirmed' docs only, so it CANNOT
 * show the Northgate PO→Invoice fix — the mis-typed POs sit in needs_review. This drives the REAL
 * process_docs on a handful of docs BY ID (any status), read-only, and prints per doc: GT type,
 * RESOLVED type + confidence, and which TYPE guard (if any) held it. Run it OFF vs ON (via the
 * kill-switch env, inherited by the spawned python) to see 675/673 recover while 670/667/685 are
 * unchanged.
 *
 * Carries no data — safe to commit. Output prints real supplier/type names → keep console output local.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/northgate_type_trace.js 675 673 674 670 667 685
 *   RR_DB=<frozen.db>            optional DB override (use the frozen snapshot for a clean A/B)
 *   HEADING_FUZZY_VOCAB=0|1      Lever 1 kill switch (inherited by python)
 *   KW_TYPE_NONDISTINCTIVE_HOLD  Lever 3 kill switch (inherited by python)
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

const IDS = process.argv.slice(2).map(Number).filter(Boolean);
if (!IDS.length) { console.error('usage: northgate_type_trace.js <id> [<id> ...]'); process.exit(2); }
const w = (tag, d) => { const f = path.join(os.tmpdir(), `nt_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
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
  return [
    '--fields-file', w('f', dts.flatMap(d => d.fields)),
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
function runOne(folder, fname, args) {
  return new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', w('fl', [fname]),
      '--mode', 'fast', '--tesseract', TESS, ...args], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {});
    p.on('close', () => { let m = null; for (const ln of out.split('\n')) { const t = ln.trim(); if (t[0] === '{') { try { const j = JSON.parse(t); if (j.type === 'file_done') m = j; } catch {} } } res(m); });
    p.on('error', () => res(null));
  });
}
const TYPE_GUARD = m => {
  for (const e of Object.values((m && m.extractions) || {})) {
    const n = (e && typeof e === 'object' && e.validation_note) ? String(e.validation_note) : '';
    if (n.includes('used for several document types')) return 'ambiguity';
    if (n.includes("names a document type that doesn't match") || n.includes("match this document to")) return 'refuse';
  }
  return null;
};

(async () => {
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const nameToSlug = {}; for (const r of db.prepare('SELECT name, slug FROM document_types').all()) nameToSlug[r.name] = r.slug;
  const args = snapArgs(db);
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-'));
  const rows = [];
  for (const id of IDS) {
    const d = db.prepare(`SELECT d.id, d.status, d.supplier_name, d.working_path, d.stored_path, d.original_filename, dt.slug gt_slug
      FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id WHERE d.id = ?`).get(id);
    if (!d) { rows.push({ id, err: 'no such doc' }); continue; }
    const src = (d.working_path && fs.existsSync(d.working_path)) ? d.working_path
              : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
    if (!src) { rows.push({ id, err: 'no file' }); continue; }
    const fname = `doc${id}${path.extname(src) || '.pdf'}`;
    fs.copyFileSync(src, path.join(RR, fname));
    const m = await runOne(RR, fname, args);
    const got = m ? (m._document_slug || nameToSlug[m.document_type] || m.document_type || null) : null;
    const _pe = m && m.extractions ? (m.extractions.po_number || m.extractions.reference_number) : null;
    rows.push({ id, status: d.status, supplier: d.supplier_name, gt: d.gt_slug, file: d.original_filename,
                got, conf: m ? m.overall_confidence : null, guard: TYPE_GUARD(m), ok: got === d.gt_slug,
                ref: _pe ? (_pe.value ?? null) : null, refmethod: _pe ? (_pe.method || '') : '',
                refflag: _pe && _pe.validation_note ? 'FLAG' : '' });
  }
  fs.rmSync(RR, { recursive: true, force: true });
  db.close();
  const sw = `FUZZY=${process.env.HEADING_FUZZY_VOCAB || '1'} NONDISTINCT=${process.env.KW_TYPE_NONDISTINCTIVE_HOLD || '1'}`;
  console.log(`# Northgate type trace (${sw})  DB=${path.basename(LIVE_DB)}`);
  console.log('| id | status | GT | resolved | conf | guard | ref(po/ref) | method | flag | file |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    if (r.err) { console.log(`| ${r.id} | — | — | ${r.err} | | | | | | |`); continue; }
    console.log(`| ${r.id} | ${r.status} | ${r.gt} | ${r.got} | ${r.conf} | ${r.guard || ''} | ${r.ref} | ${r.refmethod} | ${r.refflag} | ${r.file} |`);
  }
})();
