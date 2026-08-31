/** Trace ONE document through the real pipeline and dump the raw trace, for diagnosing a single
 *  bad read. Built 2026-08-09 to chase a tax figure of 774209.55 on a Pelican invoice whose page
 *  prints "VAT @ 20%  £1,398.24" and a letterhead "VAT GB 774 2093 55".
 *
 *  Uses the app's OWN env builders (_reconcileEnv / _anchorCropEnv from processing/handler.js) so
 *  the run matches what the app would do with the operator's current toggles — replicating that
 *  mapping by hand is how a diagnosis ends up describing a configuration nobody runs.
 *
 *    ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe stress_test/trace_one_doc.js <doc-id|filename-substring> [grep]
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null;
try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const DB_PATH = process.env.TRACE_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const w = (t, d) => { const f = path.join(os.tmpdir(), `t1_${t}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, d) => { try { return fn(); } catch { return d; } };

const target = process.argv[2];
const needle = (process.argv[3] || '').toLowerCase();
if (!target) { console.error('usage: trace_one_doc.js <doc-id|filename-substring> [grep]'); process.exit(1); }

const db = new Database(DB_PATH, { readonly: true });
const row = /^\d+$/.test(target)
  ? db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(target))
  : db.prepare('SELECT * FROM documents WHERE original_filename LIKE ?').get('%' + target + '%');
if (!row) { console.error('no such document'); process.exit(1); }
const src = (row.working_path && fs.existsSync(row.working_path)) ? row.working_path : row.stored_path;
console.log(`doc #${row.id}  ${row.original_filename}  type=${row.document_type_id} template=${row.template_id}`);

const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'trace1-'));
fs.copyFileSync(src, path.join(RR, row.original_filename));
const slices = fs.mkdtempSync(path.join(os.tmpdir(), 'slices-'));

const dts = db.prepare('SELECT * FROM document_types').all();
const fby = {};
for (const f of db.prepare('SELECT * FROM fields').all()) (fby[f.document_type_id] ||= []).push(f);
for (const t of dts) t.fields = fby[t.id] || [];
const typeSlug = (dts.find(t => t.id === row.document_type_id) || {}).slug || null;

const args = ['--fields-file', w('f', dts.flatMap(t => t.fields)),
  '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
  '--anchors-file', w('a', safe(() => learning.getAllAnchors(db), [])),
  '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
  '--doc-types-file', w('d', dts),
  '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
  '--templates-file', w('t', safe(() => templates.getAll(db), [])),
  '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
  '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
  '--reprocess-manifest', w('m', { [row.original_filename]: { known_template_id: row.template_id, known_doc_slug: typeSlug } }),
  '--config-file', CFG, '--registration', '--born-digital', '--multiline',
  '--trace', '--slice-dir', slices];

// the app's own env builders — same toggles the operator sees
let env = { ...process.env };
try {
  const h = require(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'));
  Object.assign(env, h._anchorCropEnv ? h._anchorCropEnv(db) : {}, h._reconcileEnv ? h._reconcileEnv(db) : {});
  console.log('env from the app\'s builders:', Object.keys(env).filter(k => k === k.toUpperCase() && /^[A-Z_]+$/.test(k) && env[k] === '1').sort().join(', ') || '(none)');
} catch (e) { console.log('could not load handler env builders:', e.message); }
// RENDER DPI — the gap that made `teach_run_ab.js` measure a pipeline the app does not run
// (2026-08-09 NIGHT). `_reconcileEnv` does NOT carry it: the app applies `_ocrDpiEnv` separately at
// every extraction spawn, so without this the trace renders at ocr/tesseract.py's 300 default while
// the app renders at the operator's `ocr_dpi` (200 here) — and a trace at the wrong DPI diagnoses a
// read that never happened. Mirrors `_ocrDpiEnv`: emit only when it differs from the 300 default.
try {
  const _dpi = parseInt(safe(() => learning.getSetting(db, 'ocr_dpi', '300'), '300'), 10);
  if (Number.isFinite(_dpi) && _dpi > 0 && _dpi !== 300) {
    env.OCR_RENDER_DPI = String(_dpi);
    console.log(`[dpi] OCR_RENDER_DPI=${_dpi} (matching the app; trace default was 300)`);
  }
} catch {}

const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', RR, '--files-file', w('s', [row.original_filename]),
  '--mode', 'smart', '--tesseract', TESS, ...args], { windowsHide: true, env });
let out = '';
p.stdout.on('data', d => out += d);
p.stderr.on('data', d => process.stderr.write(d));
p.on('close', () => {
  const lines = out.split('\n');
  console.log(`\n=== ${lines.length} output lines; filtering on ${needle ? JSON.stringify(needle) : 'tax/vat/total'} ===\n`);
  for (const ln of lines) {
    const t = ln.trim(); if (!t) continue;
    const hay = t.toLowerCase();
    const hit = needle ? hay.includes(needle)
                       : (hay.includes('tax') || hay.includes('vat') || hay.includes('774') || hay.includes('shadow'));
    if (!hit) continue;
    if (t[0] === '{') {
      let m; try { m = JSON.parse(t); } catch { console.log(t.slice(0, 400)); continue; }
      if (m.type === 'log') console.log('LOG  ', String(m.text).slice(0, 300));
      else if (m.type === 'trace') console.log('TRACE', JSON.stringify(m).slice(0, 400));
      else console.log(m.type, JSON.stringify(m).slice(0, 300));
    } else console.log(t.slice(0, 300));
  }
  try { fs.rmSync(RR, { recursive: true, force: true }); } catch {}
  console.log(`\nslices kept for inspection: ${slices}`);
});
