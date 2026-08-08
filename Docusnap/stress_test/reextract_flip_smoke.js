'use strict';
/*
 * reextract_flip_smoke.js — FLIP reextract_fast_enabled ON + headless end-to-end smoke.
 *
 * 1. Sets settings.reextract_fast_enabled = 'true' in the live DB (reversible kill switch).
 * 2. Confirms the IPC's own gate now passes (getSetting === 'true').
 * 3. Proves the ENABLED server path end-to-end, production-faithful: for real docs it runs the
 *    actual `process_docs --reextract` fed each doc's STORED ocr_text + template_id (what the IPC
 *    passes), then FORCE-EMPTIES a filled, non-anchored field and confirms the REAL
 *    mergeReextractRows suggests it back with the value the doc actually holds — i.e. when a field
 *    is genuinely empty (learning advanced since import), the fill is correct.
 *
 * NOTE the renderer PAINT (⟳ pills) is NOT smoked here — it needs a live Review window (restart the
 * app to load the B-2 changes). On a stable corpus a normal open shows no pills (fire-rate 0).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/reextract_flip_smoke.js
 * Env: SMOKE_N=<docs sampled> (default 30); RR_DB overrides the DB; UNFLIP=1 sets it back to false.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = process.env.RR_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning  = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}
const { _mergeReextractRows: mergeReextract } = require(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'));
const N = parseInt(process.env.SMOKE_N, 10) || 30;

const w = (tag, d) => { const f = path.join(os.tmpdir(), `fs_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
const ef = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e.value : null; };
const norm = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();

function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all(); const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || []; return dts;
}
function snap(db) {
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
function runFast(folder, snapArgs, manifestFile, files) {
  const NSH = 6; const shards = Array.from({ length: NSH }, () => []); files.forEach((f, i) => shards[i % NSH].push(f));
  const sf = shards.filter(x => x.length).map(names => w('shard', names));
  const one = shardFile => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile, '--mode', 'fast',
      '--tesseract', TESS, ...snapArgs, '--reextract', '--reprocess-manifest', manifestFile], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(sf.map(one)).then(outs => { const docs = {};
    for (const o of outs) for (const ln of o.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; }
    return docs; });
}

(async () => {
  if (!fs.existsSync(LIVE_DB)) { console.error('live DB not found:', LIVE_DB); process.exit(1); }
  const db = new Database(LIVE_DB, { fileMustExist: true });   // READ-WRITE (we flip a setting)
  db.pragma('busy_timeout = 4000');

  // ── 1. FLIP ────────────────────────────────────────────────────────────────
  const KEY = 'reextract_fast_enabled';
  if (process.env.UNFLIP === '1') { learning.setSetting(db, KEY, 'false'); console.log(`[flip] ${KEY} set back to 'false'.`); db.close(); return; }
  const before = learning.getSetting(db, KEY, 'false');
  learning.setSetting(db, KEY, 'true');
  const after = learning.getSetting(db, KEY, 'false');
  // The EXACT gate the IPC uses.
  const gateOn = process.env.REEXTRACT_TEXT_ONLY === '1' || learning.getSetting(db, KEY, 'false') === 'true';
  console.log(`[flip] ${KEY}: '${before}' -> '${after}'.  IPC gate now ${gateOn ? 'ENABLED' : 'DISABLED'}.`);

  // ── 2. Sample real docs with cached OCR + stored extractions ─────────────────
  const nameToSlug = {}; for (const r of db.prepare('SELECT name, slug FROM document_types').all()) nameToSlug[r.name] = r.slug;
  const docs = db.prepare(`SELECT d.id, d.supplier_name, d.original_filename, d.ocr_text, d.template_id, dt.slug type_slug
    FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.ocr_text IS NOT NULL AND length(d.ocr_text) > 80 AND d.status IN ('confirmed','needs_review')
    ORDER BY (d.template_id IS NOT NULL) DESC LIMIT ?`).all(N);
  const storedEx = {};
  for (const e of db.prepare('SELECT document_id, field_key, display_value, validation_note FROM extractions').all())
    (storedEx[e.document_id] || (storedEx[e.document_id] = [])).push(e);

  const snapArgs = snap(db);
  const PLACE = fs.mkdtempSync(path.join(os.tmpdir(), 'flipsmoke-'));
  const manifest = {}; const files = []; const byFname = {};
  for (const d of docs) {
    const fname = `doc${d.id}.pdf`;
    fs.writeFileSync(path.join(PLACE, fname), '');
    manifest[fname] = { ocr_text: d.ocr_text, known_template_id: d.template_id || null, known_doc_slug: d.type_slug || null };
    files.push(fname); byFname[fname] = d;
  }
  console.log(`[smoke] running --reextract over ${files.length} docs (stored ocr + template, as the IPC would)…`);
  const B = await runFast(PLACE, snapArgs, w('mani', manifest), files);

  // ── 3. Demonstrate correct fills: force-empty a filled, non-anchored field → merge suggests it back ──
  const examples = []; let docsWithFast = 0;
  for (const fname of files) {
    const b = B[fname], d = byFname[fname]; if (!b || !b.extractions) continue;
    if (Object.keys(b.extractions).length) docsWithFast++;
    const anchored = new Set(safe(() => learning.getTaughtFieldKeys(db, {
      supplier_name: d.supplier_name || '', document_type: d.type_slug || null }).map(r => r.field_key), []));
    const stored = storedEx[d.id] || [];
    const storedVal = k => { const r = stored.find(x => x.field_key === k); return r ? r.display_value : null; };
    for (const [k, e] of Object.entries(b.extractions)) {
      const fastVal = (e && typeof e === 'object') ? e.value : null;
      if (!fastVal || String(fastVal).trim() === '') continue;
      if (e && e.validation_note) continue;                         // Stage-4 clean only
      if (anchored.has(k)) continue;                                // non-anchored only
      const sv = storedVal(k);
      if (!sv || norm(sv) !== norm(fastVal)) continue;              // fast agrees with the doc's real value
      // Force-empty this field, then run the REAL merge and confirm it suggests the value back.
      const existingMinus = stored.filter(r => r.field_key !== k);
      const sug = mergeReextract(existingMinus, b.extractions, anchored).find(s => s.field_key === k);
      if (sug && norm(sug.value) === norm(sv)) examples.push(`#${d.id} ${d.type_slug || '∅'} ${k}: '${sug.value}' (== the doc's real value; would fill if empty)`);
      if (examples.length >= 8) break;
    }
    if (examples.length >= 8) break;
  }
  fs.rmSync(PLACE, { recursive: true, force: true });
  db.close();

  console.log(`\n[smoke] ${docsWithFast}/${files.length} docs produced fast extractions.`);
  console.log(`[smoke] demonstrable correct fills (forced-empty → merge suggests the real value): ${examples.length}`);
  for (const x of examples) console.log(`   ✓ ${x}`);
  const pass = gateOn && after === 'true' && examples.length > 0;
  console.log(`\n${pass ? 'SMOKE PASS — flag ON, IPC gate enabled, and the fill path returns correct suggestions.'
                        : 'SMOKE INCOMPLETE — ' + (gateOn ? 'no demonstrable fill found in the sample (raise SMOKE_N).' : 'gate did not enable.')}`);
  console.log('(Renderer ⟳ pills: restart the app + open Review to confirm visually; a stable-corpus open shows none.)');
  process.exit(pass ? 0 : 1);
})();
