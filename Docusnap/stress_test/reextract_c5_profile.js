'use strict';
/*
 * reextract_c5_profile.js — C5 SPAWN-COST PROFILE for the fast on-open re-extract (Slice B).
 *
 * Times the COLD spawn (spawn → file_done) of a --reextract run against BOTH interpreters:
 *   - vendor/python  — the packaged EMBEDDABLE Python the shipped app actually spawns (and the
 *                      sys.path trap: if process_docs isn't path-safe here, it emits no file_done).
 *   - py -3.12       — the dev interpreter, for the embeddable delta.
 * Uses REAL live-DB training data (via snap) so the arg-file load cost is realistic. This is the
 * per-open latency the on-open trigger pays until the warm worker (Slice C) removes it.
 *
 * Read-only DB; temp dirs cleaned. Carries no data — safe to commit.
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/reextract_c5_profile.js
 * Env: C5_N=<runs each> (default 7); RR_DB overrides the DB.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const VENDOR_PY = path.join(REPO, 'vendor', 'python', 'python.exe');
const LIVE_DB = process.env.RR_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning  = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}
const N = parseInt(process.env.C5_N, 10) || 7;

const w = (tag, d) => { const f = path.join(os.tmpdir(), `c5_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
const stats = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const med = s[Math.floor(s.length / 2)];
  return { min: s[0], med, max: s[s.length - 1], mean: Math.round(a.reduce((x, y) => x + y, 0) / a.length) }; };
const fmt = st => st ? `min ${st.min}ms · median ${st.med}ms · mean ${st.mean}ms · max ${st.max}ms` : '(no data)';

function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return dts;
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

// One COLD spawn: time from spawn to the file_done line (what the IPC waits for).
function timeReextract(pyExe, folder, cachedFile, snapArgs, extra) {
  return new Promise(res => {
    const t0 = Date.now();
    const p = spawn(pyExe, [PROCESS_DOCS, '--folder', folder, '--mode', 'fast', '--tesseract', TESS,
      ...snapArgs, '--reextract', '--cached-ocr-file', cachedFile, ...extra], { windowsHide: true });
    let done = null, buf = '';
    p.stdout.on('data', d => { buf += d.toString(); for (const ln of buf.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; try { const m = JSON.parse(t); if (m.type === 'file_done' && done == null) done = Date.now() - t0; } catch {} } });
    p.on('close', () => res(done));
    p.on('error', () => res(null));
  });
}
// Bare interpreter startup (import nothing) — the irreducible floor.
function timeBare(pyExe, prefixArgs) {
  return new Promise(res => {
    const t0 = Date.now();
    const p = spawn(pyExe, [...prefixArgs, '-c', 'pass'], { windowsHide: true });
    p.on('close', () => res(Date.now() - t0)); p.on('error', () => res(null));
  });
}
const series = async (fn) => { const out = []; for (let i = 0; i < N; i++) { const v = await fn(); if (v != null) out.push(v); } return out; };

(async () => {
  if (!fs.existsSync(LIVE_DB)) { console.error('live DB not found:', LIVE_DB); process.exit(1); }
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const nameToSlug = {}; for (const r of db.prepare('SELECT name, slug FROM document_types').all()) nameToSlug[r.name] = r.slug;
  // A representative doc: real cached OCR + (ideally) a linked template, so the known-id honour path runs.
  const doc = db.prepare(`SELECT d.id, d.ocr_text, d.template_id, dt.slug type_slug
    FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.ocr_text IS NOT NULL AND length(d.ocr_text) > 80
    ORDER BY (d.template_id IS NOT NULL) DESC, length(d.ocr_text) DESC LIMIT 1`).get();
  if (!doc) { console.error('no doc with cached OCR found'); process.exit(1); }
  const snapArgs = snap(db);
  db.close();

  const PLACE = fs.mkdtempSync(path.join(os.tmpdir(), 'c5-'));
  fs.writeFileSync(path.join(PLACE, 'doc.pdf'), '');
  const cachedFile = path.join(PLACE, 'cached.txt');
  fs.writeFileSync(cachedFile, doc.ocr_text, 'utf8');
  const extra = [];
  if (doc.template_id) extra.push('--known-template-id', String(doc.template_id));
  if (doc.type_slug)   extra.push('--known-doc-slug', doc.type_slug);

  const vendorOk = fs.existsSync(VENDOR_PY);
  console.log(`[C5] doc #${doc.id} (ocr ${doc.ocr_text.length} chars, template ${doc.template_id || 'none'}); ${N} cold spawns each…`);

  // Warm the FS/OS caches once (first-ever spawn pays disk read) so the measured runs are steady-cold.
  if (vendorOk) await timeReextract(VENDOR_PY, PLACE, cachedFile, snapArgs, extra);

  // py -3.12 needs the version selector as the FIRST arg before the script — handle separately.
  const timePy = () => new Promise(res => {
    const t0 = Date.now();
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', PLACE, '--mode', 'fast', '--tesseract', TESS,
      ...snapArgs, '--reextract', '--cached-ocr-file', cachedFile, ...extra], { windowsHide: true });
    let done = null, buf = '';
    p.stdout.on('data', d => { buf += d.toString(); for (const ln of buf.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; try { const m = JSON.parse(t); if (m.type === 'file_done' && done == null) done = Date.now() - t0; } catch {} } });
    p.on('close', () => res(done)); p.on('error', () => res(null));
  });
  await timePy();   // warm caches

  const vendorTimes = vendorOk ? await series(() => timeReextract(VENDOR_PY, PLACE, cachedFile, snapArgs, extra)) : [];
  const pyTimes     = await series(timePy);
  const vendorBare  = vendorOk ? await series(() => timeBare(VENDOR_PY, [])) : [];
  const pyBare      = await series(() => timeBare('py', ['-3.12']));

  fs.rmSync(PLACE, { recursive: true, force: true });

  const o = [];
  o.push('# Fast re-extract — C5 cold-spawn profile');
  o.push(`doc #${doc.id}, cached OCR ${doc.ocr_text.length} chars, template ${doc.template_id || 'none'}; ${N} runs each (post-warm).`);
  o.push('');
  o.push('| interpreter | spawn → file_done | bare startup |');
  o.push('|---|---|---|');
  o.push(`| vendor/python (packaged) | ${vendorOk ? fmt(stats(vendorTimes)) : 'ABSENT'} | ${vendorOk ? fmt(stats(vendorBare)) : '-'} |`);
  o.push(`| py -3.12 (dev) | ${fmt(stats(pyTimes))} | ${fmt(stats(pyBare))} |`);
  o.push('');
  if (vendorOk && !vendorTimes.length) o.push('⚠ vendor/python produced NO file_done — the embeddable sys.path trap likely fired. Investigate before shipping.');
  const med = stats(vendorTimes)?.med ?? stats(pyTimes)?.med ?? null;
  if (med != null) {
    const perceived = med + 450;   // + the renderer debounce
    o.push(`**Per-open cost (vendor median): ~${med}ms spawn→result; ~${perceived}ms perceived after the 450ms debounce.**`);
    o.push(med <= 1500
      ? '→ Acceptable for a fire-and-forget on-open fill (non-blocking; pills appear a beat after landing).'
      : '→ Slow for on-open-auto — gate harder or land the Slice C warm worker before flipping.');
  }
  const txt = o.join('\n');
  try { fs.mkdirSync(path.join(REPO, 'stress_test', 'out'), { recursive: true }); } catch {}
  fs.writeFileSync(path.join(REPO, 'stress_test', 'out', 'reextract_c5_profile.md'), txt);
  console.log('\n' + txt);
})();
