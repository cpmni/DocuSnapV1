'use strict';
/*
 * superstore_charset_trace.js — the ANCHOR_CHARSET_DEBRIS live gate (Oracle C1, 2026-07-27).
 *
 * Replays the REAL process_docs on docs BY ID (read-only, live training data) and prints the
 * doc-type REF-ROLE field's value/method/conf/note per doc, so the charset-debris arm can be
 * A/B'd OFF vs ON on the held SuperStore invoices (which realdoc_regression cannot see — they
 * are needs_review). Oracle C1 requires the DISJUNCTION per doc, and every OFF→ON disagreement
 * human-adjudicated (recovery-wrong = ship blocker; recovery-right = recorded win):
 *   ON outcome A: method anchor_crop_recovered, conf ≤87 noteless (or 90-95 vector-corroborated)
 *   ON outcome B: keyword stays winner, ownership note GONE (ledger corroboration exemption)
 *
 * Run: [ANCHOR_CHARSET_DEBRIS=0|1] ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe \
 *        stress_test/superstore_charset_trace.js <docId> [<docId> ...]
 *   RR_DB=<db>  optional override (default = the live DB, opened read-only).
 * Carries no data — safe to commit. Output prints real values → keep console output local.
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
if (!IDS.length) { console.error('usage: superstore_charset_trace.js <id> [<id> ...]'); process.exit(2); }
const w = (tag, d) => { const f = path.join(os.tmpdir(), `sc_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
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

(async () => {
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const refRole = {};   // type name -> ref_field_key
  for (const r of db.prepare('SELECT name, ref_field_key FROM document_types').all()) refRole[r.name] = r.ref_field_key;
  const args = snapArgs(db);
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
  const rows = [];
  for (const id of IDS) {
    const d = db.prepare(`SELECT d.id, d.status, d.supplier_name, d.working_path, d.stored_path, d.original_filename
      FROM documents d WHERE d.id = ?`).get(id);
    if (!d) { rows.push({ id, err: 'no such doc' }); continue; }
    const src = (d.working_path && fs.existsSync(d.working_path)) ? d.working_path
              : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
    if (!src) { rows.push({ id, err: 'no file' }); continue; }
    const fname = `doc${id}${path.extname(src) || '.pdf'}`;
    fs.copyFileSync(src, path.join(RR, fname));
    const m = await runOne(RR, fname, args);
    const rk = m ? (refRole[m.document_type] || 'invoice_number') : 'invoice_number';
    const e = m && m.extractions ? m.extractions[rk] : null;
    rows.push({ id, file: d.original_filename, overall: m ? m.overall_confidence : null,
                key: rk, val: e ? (e.value ?? null) : null, conf: e ? e.confidence : null,
                method: e ? (e.method || '') : '', note: e && e.validation_note ? String(e.validation_note).slice(0, 44) : '' });
  }
  fs.rmSync(RR, { recursive: true, force: true });
  db.close();
  console.log(`# SuperStore charset trace (ANCHOR_CHARSET_DEBRIS=${process.env.ANCHOR_CHARSET_DEBRIS ?? '1 (default)'})  DB=${path.basename(LIVE_DB)}`);
  console.log('| id | overall | field | value | conf | method | note | file |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    if (r.err) { console.log(`| ${r.id} | — | ${r.err} | | | | | |`); continue; }
    console.log(`| ${r.id} | ${r.overall} | ${r.key} | ${r.val} | ${r.conf} | ${r.method} | ${r.note} | ${r.file} |`);
  }
})();
