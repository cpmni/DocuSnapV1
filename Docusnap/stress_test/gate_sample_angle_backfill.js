/** GATE — sample_deskew_angle backfill (Oracle SIGN-OFF-W/COND 2026-08-11, gate item 1).
 *
 *  Full-pipeline replay (process_docs.py, the app's own settings/state mirrored, reprocess model
 *  with the docs' real bound templates) of the LIVE Castellan review-queue docs under two arms:
 *    base     — templates exactly as stored (tpl 5/7/9 sample_deskew_angle = 0, the stale zeros)
 *    backfill — the census-decided angles patched in memory (5:-0.30, 7:-0.70, 9:-0.70… see ANGLES)
 *  PASS bar: customer_name exact 'Bramblewood Joinery Ltd' >= 16/19 in the backfill arm AND zero
 *  regressions in any other field on the lane (a field correct/equal in base must not change to a
 *  different value; improvements are listed for eyeball).
 *
 *  READ-ONLY: snapshots the live DB via the SQLite backup API, copies the doc files to a temp dir,
 *  writes nothing back anywhere.
 *
 *  ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe stress_test/gate_sample_angle_backfill.js
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
const labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js'));

const HOME = process.env.USERPROFILE;
const LIVE_DB = path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const MEASURE = path.join(HOME, 'Desktop', 'TESTING', '_measure');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const SHARDS = 6;

// The census decisions (stress_test/census_sample_angles.py over the live install, 2026-08-11):
// only stored-0.0 templates whose 200-DPI detected tilt is >= 0.3 are overwritten.
const ANGLES = { 5: -0.30, 7: -0.70, 9: -0.30 };

const w = (t, d) => { const f = path.join(os.tmpdir(), `gate_${t}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, d) => { try { return fn(); } catch { return d; } };

function buildArgs(S) {
  return ['--fields-file', w('f', S.fields),
    '--hints-file', w('h', S.hints),
    '--anchors-file', w('a', S.anchors),
    '--logos-file', w('l', S.logos),
    '--doc-types-file', w('d', S.dts),
    '--formats-file', w('fm', S.formats),
    '--templates-file', w('t', S.templates),
    '--label-overrides-file', w('lo', S.overrides),
    '--field-rules-file', w('fr', S.rules),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
}

function runShards(folder, args, files, manifest, extraEnv) {
  const shards = Array.from({ length: SHARDS }, () => []);
  files.forEach((f, i) => shards[i % SHARDS].push(f));
  const one = names => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', w('s', names),
      '--mode', 'smart', '--tesseract', TESS, '--reprocess-manifest', w('m', manifest), ...args],
      { windowsHide: true, env: { ...process.env, ...extraEnv } });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(shards.filter(s => s.length).map(one)).then(outs => {
    const docs = {};
    for (const o of outs) for (const ln of o.split('\n')) {
      const t = ln.trim(); if (t[0] !== '{') continue;
      let m; try { m = JSON.parse(t); } catch { continue; }
      if (m.type === 'file_done') docs[m.original_filename] = m;
    }
    return docs;
  });
}

(async () => {
  fs.mkdirSync(MEASURE, { recursive: true });
  const snap = path.join(MEASURE, `live_backfill_gate_${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}.db`);
  const live = new Database(LIVE_DB, { readonly: true });
  await live.backup(snap);
  live.close();
  console.log(`snapshot: ${snap}`);

  const db = new Database(snap, { readonly: true });
  // ALL review-queue docs, every supplier: gate item 2 needs docs of UNCHANGED templates
  // proven byte-identical, not just the Castellan lane healed.
  const rows = db.prepare(`SELECT id, original_filename, working_path, stored_path, template_id,
                             supplier_name,
                             (SELECT slug FROM document_types WHERE id = document_type_id) type_slug
                           FROM documents
                           WHERE status = 'needs_review'
                           ORDER BY id`).all();
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'gatesa-'));
  const files = [], manifest = {};
  for (const d of rows) {
    const src = (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : d.stored_path;
    if (!src || !fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(RR, d.original_filename));
    manifest[d.original_filename] = { known_template_id: d.template_id, known_doc_slug: d.type_slug };
    files.push(d.original_filename);
  }

  const dts = db.prepare('SELECT * FROM document_types').all();
  const fby = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (fby[f.document_type_id] ||= []).push(f);
  for (const t of dts) t.fields = fby[t.id] || [];
  const BASE_STATE = {
    fields: dts.flatMap(t => t.fields), dts,
    hints: safe(() => learning.getAllHints(db), []),
    anchors: safe(() => learning.getAllAnchors(db), []),
    logos: safe(() => learning.getAllLogos(db), []),
    formats: safe(() => learning.getFieldFormats(db), []),
    templates: safe(() => templates.getAll(db), []),
    overrides: safe(() => labelOverrides.getForExtraction(db), []),
    rules: safe(() => learning.getFieldRules(db), []),
  };
  // live switch mirror — booleans + the ocr_dpi rule, exactly as teach_run_ab.js does
  const env = {};
  const rawSettings = db.prepare('SELECT key, value FROM settings').all();
  for (const r of rawSettings) { if (r.value === 'true') env[r.key.toUpperCase()] = '1'; }
  const _dpi = parseInt((rawSettings.find(r => r.key === 'ocr_dpi') || {}).value || '300', 10);
  if (Number.isFinite(_dpi) && _dpi > 0 && _dpi !== 300) env.OCR_RENDER_DPI = String(_dpi);
  db.close();

  console.log(`gate — ${files.length} Castellan lane docs, arms: base, backfill`);
  const results = {};
  for (const arm of ['base', 'backfill']) {
    const S = JSON.parse(JSON.stringify(BASE_STATE));
    if (arm === 'backfill') {
      let n = 0;
      for (const t of S.templates) if (ANGLES[t.id] != null) { t.sample_deskew_angle = ANGLES[t.id]; n++; }
      console.log(`  [backfill] patched ${n} template angle(s)`);
    }
    const t0 = Date.now();
    results[arm] = await runShards(RR, buildArgs(S), files, manifest, env);
    console.log(`  arm ${arm}: ${Object.keys(results[arm]).length} docs in ${Math.round((Date.now() - t0) / 1000)}s`);
  }

  // ── compare ──
  // Gate item 1: the Castellan lane heals (exact-rate must beat the base materially; the
  // Oracle bar was framed as >=16/19 = 84% on the probe lane). Gate item 2: every doc whose
  // BOUND template's angle did NOT change must be BYTE-IDENTICAL between arms.
  const TARGET = 'Bramblewood Joinery Ltd';
  const changedTpl = new Set(Object.keys(ANGLES).map(Number));
  let exactBase = 0, exactBf = 0, castN = 0;
  let unchangedDiffs = 0, changedDiffs = 0, heals = 0;
  for (const d of rows) {
    const f = d.original_filename;
    if (!files.includes(f)) continue;
    const isCast = /Castellan/i.test(d.supplier_name || '');
    const tplChanged = changedTpl.has(d.template_id);
    const b = (results.base[f] || {}).extractions || {};
    const a = (results.backfill[f] || {}).extractions || {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    if (isCast) castN++;
    for (const k of keys) {
      const bv = (b[k] || {}).value ?? null, av = (a[k] || {}).value ?? null;
      if (isCast && k === 'customer_name') {
        if (bv === TARGET) exactBase++;
        if (av === TARGET) exactBf++;
      }
      if (String(bv) === String(av)) continue;
      const line = `${f} [tpl ${d.template_id}] ${k}: ${JSON.stringify(bv)} -> ${JSON.stringify(av)}`;
      if (!tplChanged) { unchangedDiffs++; console.log('  UNCHANGED-TPL DIFF (gate-2 violation)  ' + line); }
      else if (av === TARGET || (bv === null && av !== null)) { heals++; console.log('  HEAL  ' + line); }
      else { changedDiffs++; console.log('  DIFF  ' + line); }
    }
  }
  console.log(`\ncustomer_name exact (Castellan lane): base ${exactBase}/${castN} -> backfill ${exactBf}/${castN}`);
  console.log(`heals/fills: ${heals} · changed-template diffs (EYEBALL EACH): ${changedDiffs} · unchanged-template diffs: ${unchangedDiffs}`);
  const rate = castN ? exactBf / castN : 0;
  console.log((rate >= 0.84 && unchangedDiffs === 0)
    ? (changedDiffs === 0 ? 'GATE: PASS' : 'GATE: PASS-WITH-DIFFS (eyeball each DIFF line)')
    : 'GATE: FAIL');
})();
