'use strict';
/*
 * score_hard_set.js — score the ADVERSARIAL Hard Set (gen_hard_set.py) against its ground_truth.json,
 * per CLASS × RENDITION, with the app's real configuration.
 *
 * Arms:  node …\electron score_hard_set.js digital cold
 *        node …\electron score_hard_set.js scan cold
 *        node …\electron score_hard_set.js scan warm       (loads the DB copy's learning READ-ONLY —
 *                                                           measures bleed onto brand-new issuers)
 * Env: RR_DB = the db.backup() COPY (required — never point this at the live DB);
 *      OCR_RENDER_DPI is forced to 200 (the product DPI) unless already set; the app spawn env is
 *      mirrored from the copy (handler._autoTitleEnv/_anchorCropEnv/_reconcileEnv — the realdoc pattern).
 * Reads the DB copy read-only (doc types via direct SQL — getAllWithFields would WRITE); copies the
 * corpus to a temp dir; writes "<Hard Set>/score_<rendition>_<arm>.md" + a per-doc .jsonl for triage.
 * The gate hook: exits 2 if any CONTROL row scores wrong (read no class number until controls are clean).
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const ROOT = process.env.HARDSET_OUT || path.join(process.env.USERPROFILE, 'Desktop', 'Hard Set');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
const trust = require(path.join(REPO, 'database', 'modules', 'trust.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const REND = (process.argv[2] || 'scan').toLowerCase();
const ARM = (process.argv[3] || 'cold').toLowerCase();
if (!['digital', 'scan'].includes(REND) || !['cold', 'warm'].includes(ARM)) {
  console.error('usage: score_hard_set.js <digital|scan> <cold|warm>'); process.exit(1);
}
if (!process.env.RR_DB) { console.error('RR_DB must point at a db.backup() COPY — never the live DB.'); process.exit(1); }

const normSupplier = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normRef = s => String(s || '').toUpperCase().replace(/\s+/g, '');
const normMoney = s => { const v = parseFloat(String(s || '').replace(/[^0-9.\-]/g, '')); return isNaN(v) ? null : v.toFixed(2); };
const normDate = s => String(s || '').replace(/[^0-9]/g, '');
const w = (tag, d) => { const f = path.join(os.tmpdir(), `hs_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
const ef = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e.value : null; };

function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return dts;
}

function snapArgs(db) {
  const dts = docTypesWithFields(db);
  const cold = ARM === 'cold';
  return ['--fields-file', w('f', dts.flatMap(d => d.fields)),
    '--hints-file', w('h', cold ? [] : safe(() => learning.getAllHints(db), [])),
    '--anchors-file', w('a', cold ? [] : safe(() => learning.getAllAnchors(db), [])),
    '--logos-file', w('l', cold ? [] : safe(() => learning.getAllLogos(db), [])),
    '--doc-types-file', w('d', dts),
    '--formats-file', w('fm', cold ? [] : safe(() => learning.getFieldFormats(db), [])),
    '--templates-file', w('t', cold ? [] : safe(() => templates.getAll(db), [])),
    '--label-overrides-file', w('lo', cold ? [] : safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
    '--field-rules-file', w('fr', cold ? [] : safe(() => learning.getFieldRules(db), [])),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
}

function appEnv(db) {
  // the realdoc _appSpawnEnv pattern: mirror the real spawn builders from the COPY + force the product DPI
  const H = require(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'));
  const e = { ...safe(() => H._autoTitleEnv(db), {}), ...safe(() => H._anchorCropEnv(db), {}), ...safe(() => H._reconcileEnv(db), {}) };
  if (!process.env.OCR_RENDER_DPI) e.OCR_RENDER_DPI = '200';
  return e;
}

function runShards(folder, args, files, env) {
  const N = 8; const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const done = {}; let ndone = 0;
  const one = names => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', w('shard', names),
      '--mode', 'smart', '--tesseract', TESS, ...args], { windowsHide: true, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', () => {});
    p.on('close', () => {
      for (const ln of out.split('\n')) {
        const t = ln.trim(); if (t[0] !== '{') continue;
        let m; try { m = JSON.parse(t); } catch { continue; }
        if (m.type === 'file_done') { done[m.original_filename] = m; ndone++; }
      }
      res();
    });
    p.on('error', () => res());
  });
  return Promise.all(shards.filter(s => s.length).map(one)).then(() => { console.log(`  ${ndone} docs processed`); return done; });
}

(async () => {
  const gtAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'ground_truth.json'), 'utf8'));
  const rows = gtAll.filter(r => r.rendition === REND);
  if (!rows.length) { console.error(`no ${REND} rows in ground_truth.json`); process.exit(1); }
  const db = new Database(process.env.RR_DB, { readonly: true, fileMustExist: true });
  const nameToSlug = {}; const slugToId = {}; const roles = {};
  for (const r of db.prepare('SELECT id, name, slug, ref_field_key, date_field_key FROM document_types').all()) {
    nameToSlug[r.name] = r.slug; slugToId[r.slug] = r.id; roles[r.slug] = { ref: r.ref_field_key, date: r.date_field_key };
  }
  const fieldTypesBySlug = {};
  for (const r of db.prepare(`SELECT dt.slug s, f.key k, f.type t FROM fields f JOIN document_types dt ON dt.id = f.document_type_id`).all())
    (fieldTypesBySlug[r.s] || (fieldTypesBySlug[r.s] = {}))[r.k] = r.t;

  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), `hardset-${REND}-${ARM}-`));
  const files = [];
  for (const r of rows) {
    const src = path.join(ROOT, r.file);
    const base = path.basename(r.file);
    fs.copyFileSync(src, path.join(TMP, base));
    files.push(base);
    r._base = base;
  }
  console.log(`${REND} ${ARM}: ${files.length} docs -> ${TMP}`);
  const done = await runShards(TMP, snapArgs(db), files, appEnv(db));

  // ── score ──
  const F = ['type', 'supplier', 'ref', 'date', 'total'];
  const agg = {};   // cls -> {n, ok per field, silent, wouldFile, wrongWouldFile, controls{n, bad}}
  const mism = {}; const jl = [];
  let controlBad = 0;
  for (const r of rows) {
    const m = done[r._base];
    const cls = r.cls;
    const a = agg[cls] || (agg[cls] = { n: 0, ok: Object.fromEntries(F.map(f => [f, 0])), scored: Object.fromEntries(F.map(f => [f, 0])), silent: 0, wouldFile: 0, wrongWouldFile: 0, cn: 0, cbad: 0 });
    a.n++;
    if (r.control) a.cn++;
    if (!m) { (mism[cls] || (mism[cls] = [])).push(`${r._base}: NO RESULT`); if (r.control) { a.cbad++; controlBad++; } continue; }
    const detSlug = nameToSlug[m.document_type] || null;
    const rk = (roles[r.type_slug] || {}).ref, dk = (roles[r.type_slug] || {}).date;
    // TOTAL is scored ONLY where the GT type actually DEFINES a total-ish field (the 2026-07-29 rig's
    // lesson, re-learned on the first run's controls: the installed types mostly have NO total field, so
    // the engine never extracts one — scoring it marked every clean control "wrong").
    const ftypes = fieldTypesBySlug[r.type_slug] || {};
    const totalKey = ['total_amount', 'total', 'balance_due', 'amount_due'].find(k => k in ftypes) || null;
    const gotTotal = totalKey ? (ef(m, totalKey) ?? ef(m, 'total_amount') ?? ef(m, 'total')) : null;
    const s = {
      type: detSlug === r.type_slug,
      supplier: normSupplier(m.supplier_name) === normSupplier(r.issuer),
      ref: r.ref != null && rk ? normRef(ef(m, rk)) === normRef(r.ref) : null,
      date: r.date != null && dk ? normDate(ef(m, dk)) === normDate(r.date) : null,
      total: r.total != null && totalKey ? normMoney(gotTotal) === normMoney(r.total) : null,
    };
    for (const f of F) if (s[f] !== null) { a.scored[f]++; if (s[f]) a.ok[f]++; }
    // A wrong field splits THREE ways (the first run conflated them): EMPTY (a miss — the app committed
    // nothing, the doc holds: safe), FLAGGED wrong (a wrong value with a note / sub-70 conf: caught), and
    // SILENT wrong (a non-empty wrong value, no note, conf >= 70 — the only dangerous kind).
    let silent = false, miss = false;
    const flaggedInfo = {};
    for (const [f, key, want] of [['supplier', 'supplier_name', r.issuer], ['ref', rk, r.ref], ['date', dk, r.date], ['total', totalKey, r.total]]) {
      if (s[f] !== false) continue;
      const got = f === 'supplier' ? m.supplier_name : (f === 'total' ? gotTotal : ef(m, key));
      const e = key && m.extractions && m.extractions[key];
      if (got == null || String(got).trim() === '') {
        miss = true;
        flaggedInfo[f] = 'empty';
        (mism[cls] || (mism[cls] = [])).push(`${r._base} [${r.variant}${r.control ? ' CONTROL' : ''}] ${f}: want '${want}' got EMPTY [held]`);
        continue;
      }
      const flagged = !!(e && (String(e.validation_note || '').trim() || (e.confidence != null && e.confidence < 70)));
      flaggedInfo[f] = flagged;
      if (!flagged) silent = true;
      (mism[cls] || (mism[cls] = [])).push(`${r._base} [${r.variant}${r.control ? ' CONTROL' : ''}] ${f}: want '${want}' got '${got}'${flagged ? ' [flagged]' : ' [SILENT]'}`);
    }
    if (silent) a.silent++;
    if (miss) a.miss = (a.miss || 0) + 1;
    // would-auto-file through the ONE predicate
    let wouldFile = false, afReason = null;
    const detId = slugToId[detSlug];
    if (detId) {
      const rex = Object.entries(m.extractions || {}).map(([k, e]) => ({
        field_key: k, display_value: e && e.value, confidence: e && e.confidence,
        extraction_method: (e && (e.method || e.extraction_method)) || null,
        validation_note: (e && e.validation_note) || null, corrected_to: (e && e.corrected_to) || null,
        corroboration: (e && typeof e === 'object') ? (e.corroboration ?? null) : null,
      }));
      // id must be TRUTHY: isAutoFileEligible refuses `!doc.id` as 'no-type' (trust.js:983) — the first
      // run passed 0 and disabled the whole would-file lane.
      const fake = { id: 999999, supplier_name: m.supplier_name, document_type_id: detId, overall_confidence: m.overall_confidence };
      try { const v = trust.isAutoFileEligible(db, fake, { extractions: rex }); wouldFile = v.eligible; afReason = v.reason; } catch {}
    }
    if (wouldFile) a.wouldFile++;
    if (wouldFile && F.some(f => s[f] === false)) a.wrongWouldFile++;
    // a CONTROL is bad only on a SILENT wrong value or a wrong TYPE — an empty/flagged field on a
    // control is a held doc, which is a finding, not a broken harness
    if (r.control && (silent || s.type === false)) { a.cbad++; controlBad++; }
    jl.push({ file: r._base, cls, variant: r.variant, control: !!r.control, type_ok: s.type, supplier_ok: s.supplier,
      ref_ok: s.ref, date_ok: s.date, total_ok: s.total, wouldFile, afReason, overall: m.overall_confidence,
      got: { type: detSlug, supplier: m.supplier_name, ref: rk ? ef(m, rk) : null, date: dk ? ef(m, dk) : null, total: gotTotal },
      flagged: flaggedInfo });
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  db.close();

  const pct = (o, n) => n ? (100 * o / n).toFixed(0) + '%' : '-';
  const out = [`# Hard Set score — ${REND} ${ARM} (${rows.length} docs, DPI ${process.env.OCR_RENDER_DPI || 200}, app env mirrored)`, ''];
  out.push('| class | n | type | supplier | ref | date | total | EMPTY-held docs | SILENT-wrong docs | would-file | wrong+would-file | controls bad |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const cls of Object.keys(agg).sort()) {
    const a = agg[cls];
    out.push(`| ${cls} | ${a.n} | ${pct(a.ok.type, a.scored.type)} | ${pct(a.ok.supplier, a.scored.supplier)} | ${pct(a.ok.ref, a.scored.ref)} | ${pct(a.ok.date, a.scored.date)} | ${pct(a.ok.total, a.scored.total)} | ${a.miss || 0} | ${a.silent} | ${a.wouldFile} | ${a.wrongWouldFile} | ${a.cbad}/${a.cn} |`);
  }
  out.push('');
  for (const cls of Object.keys(mism).sort()) {
    out.push(`## ${cls} mismatches`);
    for (const l of mism[cls].slice(0, 25)) out.push(`- ${l}`);
    out.push('');
  }
  const md = out.join('\n');
  fs.writeFileSync(path.join(ROOT, `score_${REND}_${ARM}.md`), md);
  fs.writeFileSync(path.join(ROOT, `score_${REND}_${ARM}.jsonl`), jl.map(o => JSON.stringify(o)).join('\n'));
  console.log(md);
  if (controlBad > 0) { console.error(`\n!! ${controlBad} CONTROL row(s) scored wrong — fix the harness/env before reading class numbers.`); process.exit(2); }
})();
