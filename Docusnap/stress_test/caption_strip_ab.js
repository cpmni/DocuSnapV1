'use strict';
/*
 * caption_strip_ab.js — A/B harness for the caption-prefix strip (kill ANCHOR_CAPTION_PREFIX_STRIP).
 *
 * Reprocesses a folder of PDFs through the REAL pipeline (process_docs.py) with the LIVE learned
 * snapshot, twice — OFF (default) then ON (ANCHOR_CAPTION_PREFIX_STRIP=1) — and diffs every committed
 * field per doc. It answers the flip gate (Oracle, 2026-07-25): (1) OFF must be byte-identical; (2) ON,
 * enumerate every doc whose committed date/ref VALUE changes (the flip-set) so each can be page-verified.
 *
 * The live DB is opened READ-ONLY; no file is written into the source folder; output goes to stdout only.
 *
 * Run:  ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/caption_strip_ab.js [folder]
 * Env:  DEMO_FOLDER=<path>   (default: Demo Docs/Saltmarsh Seafoods/delivery_docket)   MAX=<n>
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawnSync } = require('child_process');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PY = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';

const FOLDER = process.argv[2] || process.env.DEMO_FOLDER
  || path.join(os.homedir(), 'Desktop', 'Demo Docs', 'Saltmarsh Seafoods', 'delivery_docket');
const MAX = parseInt(process.env.MAX || '0', 10);

const db = new Database(path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db'), { readonly: true });
const safe = (fn, d) => { try { return fn(); } catch { return d; } };
const dts = db.prepare('SELECT * FROM document_types').all();
const byType = {}; for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
for (const dt of dts) dt.fields = byType[dt.id] || [];
const w = (tag, d) => { const p = path.join(os.tmpdir(), `csab_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(p, JSON.stringify(d)); return p; };

let files = process.env.FILES ? process.env.FILES.split(',')
  : fs.readdirSync(FOLDER).filter(f => f.toLowerCase().endsWith('.pdf'));
if (MAX > 0) files = files.slice(0, MAX);
const snapArgs = [
  '--fields-file', w('f', dts.flatMap(d => d.fields)),
  '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
  '--anchors-file', w('a', safe(() => learning.getAllAnchors(db), [])),
  '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
  '--doc-types-file', w('d', dts),
  '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
  '--templates-file', w('t', safe(() => templates.getAll(db), [])),
  '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
  '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
];
db.close();

function run(on) {
  const args = ['-3.12', PY, '--folder', FOLDER, '--files-file', w('files', files), '--mode', 'fast',
    '--tesseract', TESS, ...snapArgs, '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
  // KNOWN_SLUG reproduces the live REPROCESS path (the app passes the assigned type on reprocess);
  // the strip fires there because the taught anchor is applied and captures the caption.
  if (process.env.KNOWN_SLUG) args.push('--known-doc-slug', process.env.KNOWN_SLUG, '--known-doc-slug-authority', 'machine');
  const env = { ...process.env };
  if (on) env.ANCHOR_CAPTION_PREFIX_STRIP = '1'; else delete env.ANCHOR_CAPTION_PREFIX_STRIP;
  const r = spawnSync('py', args, { encoding: 'utf8', maxBuffer: 3e8, windowsHide: true, env });
  const out = {};
  for (const line of (r.stdout || '').split('\n')) {
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'file_done') {
      const ex = {};
      for (const [k, v] of Object.entries(ev.extractions || {})) ex[k] = { value: v && v.value, method: v && v.method, conf: v && v.confidence };
      out[ev.original_filename] = { supplier: ev.supplier_name, type: ev.document_type, conf: ev.overall_confidence, ex };
    }
  }
  return out;
}

console.log(`caption_strip_ab: ${files.length} files in ${FOLDER}\n`);
const OFF = run(false);
const ON = run(true);

let changed = 0, sameCount = 0, regressed = 0, methodOnly = 0;
const CRIT = new Set(['delivery_number', 'delivery_date', 'invoice_number', 'invoice_date', 'po_number', 'po_date',
  'sales_order_number', 'order_date', 'reference_number']);
for (const fn of files) {
  const a = OFF[fn], b = ON[fn];
  if (!a || !b) { console.log(`  ${fn}: MISSING (${a ? '' : 'OFF'} ${b ? '' : 'ON'})`); continue; }
  const diffs = []; let methodDelta = false;
  const keys = new Set([...Object.keys(a.ex), ...Object.keys(b.ex)]);
  for (const k of keys) {
    const av = (a.ex[k] || {}).value ?? null, bv = (b.ex[k] || {}).value ?? null;
    if (String(av) !== String(bv)) diffs.push({ k, av, bv, am: (a.ex[k] || {}).method, bm: (b.ex[k] || {}).method });
    else if ((a.ex[k] || {}).method !== (b.ex[k] || {}).method) methodDelta = true;   // recovered read, same value
  }
  if (!diffs.length) { sameCount++; if (methodDelta) methodOnly++; continue; }
  changed++;
  console.log(`  ${fn}  [conf ${a.conf}->${b.conf}]`);
  for (const d of diffs) {
    const flag = CRIT.has(d.k) ? '  <<CRIT — PAGE-VERIFY' : '';
    console.log(`     ${d.k}: OFF ${JSON.stringify(d.av)}(${d.am}) -> ON ${JSON.stringify(d.bv)}(${d.bm})${flag}`);
    // crude regression signal: ON went from a non-empty value to empty
    if (d.av && !d.bv) regressed++;
  }
}
console.log(`\n=== summary: ${files.length} docs | value-unchanged: ${sameCount} (of which method-only-recovered: ${methodOnly}) | value-changed: ${changed} | ON-emptied-a-value: ${regressed} ===`);
console.log('OFF must equal ON except where the strip recovers a caption-prefixed structured read.');
console.log('Every CRIT change must be PAGE-VERIFIED before flipping ANCHOR_CAPTION_PREFIX_STRIP on.');
