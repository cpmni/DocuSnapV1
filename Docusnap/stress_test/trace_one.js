'use strict';
/* trace_one.js — reprocess ONE doc with --trace and dump the candidate ledger for a field.
 * Read-only (live DB opened readonly, only the learned training data is exported). Used to
 * confirm the po_number keyword candidate's LEDGER confidence (Oracle's verify-at-source gate
 * for the prefix-garble adopt). Run:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/trace_one.js \
 *     "C:/Users/cmccu/Desktop/Demo Docs/Northgate Textiles/purchase_order" NorthgateTextiles_purchase_order_18.pdf po_number
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
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const FOLDER = process.argv[2];
const FILE   = process.argv[3];
const FIELD  = process.argv[4] || 'po_number';
const w = (tag, d) => { const f = path.join(os.tmpdir(), `t1_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };

const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
const dts = db.prepare('SELECT * FROM document_types').all();
const byType = {}; for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
for (const dt of dts) dt.fields = byType[dt.id] || [];
const snapArgs = [
  '--fields-file', w('f', dts.flatMap(d => d.fields)),
  '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
  '--anchors-file', w('a', safe(() => { let a = learning.getAllAnchors(db) || []; if (process.env.DROP_ANCHOR) a = a.filter(x => x.field_key !== process.env.DROP_ANCHOR); return a; }, [])),
  '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
  '--doc-types-file', w('d', dts),
  '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
  '--templates-file', w('t', safe(() => templates.getAll(db), [])),
  '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
  '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
  '--config-file', CFG, '--registration', '--born-digital', '--multiline',
];
db.close();

const sliceDir = fs.mkdtempSync(path.join(os.tmpdir(), 't1slice-'));
const filesFile = w('files', [FILE]);
const deskew = process.env.DESKEW ? ['--deskew-pages', '--deskew-min-angle', String(process.env.DESKEW_MIN || '0.5')] : [];
// The app's reprocess passes the KNOWN template via --reprocess-manifest (basename ->
// {known_template_id, known_doc_slug}) so Stage 0.5 applies it directly; a fresh --folder import
// re-matches from scratch and, when the logo/fingerprint match fails, SKIPS Stage 0.5 (the
// harness-fidelity gap). Set KNOWN_TEMPLATE to reproduce the app's reprocess faithfully.
const known = [];
if (process.env.KNOWN_TEMPLATE) {
  const manifest = { [FILE]: { known_template_id: parseInt(process.env.KNOWN_TEMPLATE, 10),
                               known_doc_slug: process.env.KNOWN_SLUG || null } };
  known.push('--reprocess-manifest', w('manifest', manifest));
}
const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', FOLDER, '--files-file', filesFile,
  '--mode', 'fast', '--tesseract', TESS, '--trace', '--slice-dir', sliceDir, ...deskew, ...known, ...snapArgs], { windowsHide: true });
let out = '';
p.stdout.on('data', d => out += d); p.stderr.on('data', () => {});
p.on('close', () => {
  const cands = [], merges = []; let winner = null;
  for (const ln of out.split('\n')) {
    const t = ln.trim(); if (t[0] !== '{') continue;
    let m; try { m = JSON.parse(t); } catch { continue; }
    if (m.type === 'trace' && m.field === FIELD) {
      if (m.event === 'candidate') cands.push({ stage: m.stage, method: m.method, value: m.value, confidence: m.confidence });
      if (m.event === 'merge') merges.push({ stage: m.stage, outcome: m.outcome, value: m.value });
    }
    if (m.type === 'file_done') { const e = m.extractions && m.extractions[FIELD]; winner = e && typeof e === 'object' ? e : (m[FIELD] != null ? { value: m[FIELD] } : null); }
  }
  console.log(`=== candidate ledger for ${FIELD} (${FILE}) ===`);
  for (const c of cands) console.log(`  ${c.stage.padEnd(14)} ${String(c.method).padEnd(18)} value=${JSON.stringify(c.value)} conf=${c.confidence}`);
  console.log(`=== WINNER ===`); console.log('  ' + JSON.stringify(winner));
  fs.rmSync(sliceDir, { recursive: true, force: true });
});
