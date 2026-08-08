'use strict';
/* delivery_reconcile_probe.js — read-only real-OCR gate for the Stage 0.5 inline-code reconcile
 * (TEMPLATE_INLINE_CODE_RECONCILE). Reprocesses the taught Ridgeway delivery dockets through the
 * FULL pipeline over the LIVE template mapping and checks delivery_number reads the full DN-#####
 * (a clipped 'N-93159'/'39550' or garbage 'HAL7ea7ca' FAILS ^DN-\d{5}$ — this is the Seam-A catcher).
 * No DB write. Run BOTH:
 *   RECONCILE=0 PROBE_ID=142,143,144,145,146,147,148,149,150,151 ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/delivery_reconcile_probe.js
 *   RECONCILE=1 (same) — the fixed run.
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
const IDS = (process.env.PROBE_ID || '142,143,144,145,146,147,148,149,150,151').split(',').map(s => parseInt(s.trim(), 10));
const RECONCILE = process.env.RECONCILE || '1';
const w = (t, d) => { const f = path.join(os.tmpdir(), `dr_${t}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
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
  const FOLDER = fs.mkdtempSync(path.join(os.tmpdir(), 'delprobe-'));
  const resolveFile = d => (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
  const nameToDoc = {}; const files = [];
  for (const id of IDS) {
    const d = db.prepare('SELECT id, working_path, stored_path, reference_number FROM documents WHERE id=?').get(id);
    const src = d && resolveFile(d); if (!src) { console.log(`#${id}: no file`); continue; }
    const fn = `doc${id}${path.extname(src) || '.pdf'}`; fs.copyFileSync(src, path.join(FOLDER, fn));
    nameToDoc[fn] = d; files.push(fn);
  }
  db.close();
  if (!files.length) { console.log('no files'); return; }
  const out = await new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', FOLDER, '--mode', 'fast', '--tesseract', TESS, ...snapArgs],
      { windowsHide: true, env: { ...process.env, TEMPLATE_INLINE_CODE_RECONCILE: RECONCILE } });
    let b = ''; p.stdout.on('data', d => b += d); p.stderr.on('data', () => {}); p.on('close', () => res(b)); p.on('error', () => res(''));
  });
  const done = {}; for (const ln of out.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') done[m.original_filename] = m; }
  fs.rmSync(FOLDER, { recursive: true, force: true });

  const FMT = /^DN-\d{5}$/;
  let pass = 0, fail = 0;
  console.log(`\nRECONCILE=${RECONCILE}   (expect delivery_number == /^DN-\\d{5}$/)`);
  console.log('id      was(stored)   read              method                      OK?  note');
  for (const fn of files) {
    const d = nameToDoc[fn], m = done[fn]; if (!m) { console.log(`#${d.id}: no file_done`); fail++; continue; }
    const e = (m.extractions || {})['delivery_number'] || {};
    const val = e.value || e.display_value || e.raw_value || m.delivery_number || '';
    const ok = FMT.test(String(val));
    ok ? pass++ : fail++;
    const note = e.validation_note ? String(e.validation_note).slice(0, 34) : '';
    console.log(String('#' + d.id).padEnd(7), String(d.reference_number || '∅').padEnd(13), String(val || '∅').padEnd(17),
      String(e.method || '∅').padEnd(27), ok ? 'OK ' : 'BAD', note);
  }
  console.log(`\n${pass}/${pass + fail} full DN-##### ${fail ? '— ' + fail + ' STILL CLIPPED/GARBAGE' : '— ALL CLEAN'}`);
})();
