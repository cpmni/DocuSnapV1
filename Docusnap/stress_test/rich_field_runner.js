'use strict';
/*
 * Rich-field, full-config accuracy + real-gate convergence runner.
 * Extends run_stress/analyze to (a) MANY fields incl. customer_name + hard custom
 * fields, (b) all 3 corpora via a GT adapter, (c) the REAL auto-file gate
 * trust.isAutoFileEligible at thresholds 100 AND 98, (d) per-type/per-stage/
 * empty-vs-wrong-vs-silent scoring. Throwaway DB only; never touches the live DB.
 *
 * Run (PowerShell):
 *   $env:ELECTRON_RUN_AS_NODE=1; $env:RUN="validate"; & node_modules/electron/dist/electron.exe stress_test/rich_field_runner.js
 *   RUN = validate (400 vs analyze) | stress (400) | hard (200) | harness (1000) | all
 *   CYCLES=n (teach cycles, default 2)   LIMIT=n (cap docs, for smoke)
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const REPO = 'c:/GIT Projects/Docusnap', ST = path.join(REPO, 'stress_test');
const OUT = path.join(ST, 'out'); const TMP = path.join(os.tmpdir(), 'rich_run');
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const HARNESS = path.join(REPO, 'python_backend', 'artifacts', 'test_harness', 'corpus');
const MODE = process.env.MODE || 'fast';
const CYCLES = parseInt(process.env.CYCLES || '2', 10);
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 0;

const { runMigrations } = require(path.join(REPO, 'database', 'index.js'));
const documents = require(path.join(REPO, 'database', 'modules', 'documents.js'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const docTypes = require(path.join(REPO, 'database', 'modules', 'document_types.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
const trust = require(path.join(REPO, 'database', 'modules', 'trust.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

// ── normalizers (mirror analyze.js exactly for the validation gate) ─────────────
const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normMoney = s => { const v = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return isNaN(v) ? null : v.toFixed(2); };
const normRef = s => String(s || '').toUpperCase().replace(/\s+/g, '');
const normDate = s => String(s || '').trim();
const normPlain = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');   // barcode: strip punctuation
const moneyStr = v => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NORM = { name: normName, money: normMoney, ref: normRef, date: normDate, plain: normPlain, text: normName };

// ── GT adapters → uniform truth rows ────────────────────────────────────────────
// row = { id, file, folder, type_slug, type_name, variant, low_quality, edge,
//         ref_key, date_key, company_key, fields:{ key:{value,kind} } }
function loadStressLike(corpusDir) {
  const arr = JSON.parse(fs.readFileSync(path.join(corpusDir, 'ground_truth.json'), 'utf8'));
  const REFK = { invoice: 'invoice_number', sales_order: 'sales_order_number', purchase_order: 'po_number' };
  const DATEK = { invoice: 'invoice_date', sales_order: 'order_date', purchase_order: 'po_date' };
  return arr.map(t => {
    const rk = REFK[t.type_slug], dk = DATEK[t.type_slug];
    const fields = {
      supplier_name: { value: t.company, kind: 'name' },
      [rk]: { value: t.ref, kind: 'ref' },
      [dk]: { value: t.date, kind: 'date' },
      subtotal: { value: moneyStr(t.subtotal), kind: 'money' },
      total_amount: { value: moneyStr(t.total), kind: 'money' },
    };
    return { id: t.filename, file: t.filename, folder: corpusDir, type_slug: t.type_slug,
      type_name: null, variant: t.variant, low_quality: false, edge: null,
      ref_key: rk, date_key: dk, company_key: 'supplier_name', fields };
  });
}
function loadHarness() {
  const rows = [];
  const dirs = fs.readdirSync(HARNESS).filter(d => /^DOC_/.test(d)).sort();
  for (const d of dirs) {
    const gtp = path.join(HARNESS, d, 'ground_truth.json');
    const pdf = path.join(HARNESS, d, 'document.pdf');
    if (!fs.existsSync(gtp) || !fs.existsSync(pdf)) continue;
    let g; try { g = JSON.parse(fs.readFileSync(gtp, 'utf8')); } catch { continue; }
    const F = g.fields || {};
    const fields = {};
    const put = (k, v, kind) => { if (v != null && String(v).trim() !== '') fields[k] = { value: String(v), kind }; };
    put(g.company_key || 'supplier_name', (F.supplier_name && F.supplier_name.value) || g.company && g.company.name, 'name');
    put('customer_name', g.customer_name || (F.customer_name && F.customer_name.value), 'name');
    if (g.ref_field_key) put(g.ref_field_key, g.reference || (F[g.ref_field_key] && F[g.ref_field_key].value), 'ref');
    if (g.date_field_key) put(g.date_field_key, g.date || (F[g.date_field_key] && F[g.date_field_key].value), 'date');
    put('total_amount', g.total_amount || (F.total_amount && F.total_amount.value), 'money');
    put('currency', g.currency, 'plain');
    // HARD custom fields: a barcode value (ref w/o punctuation) + line-item count — the
    // engine has no barcode/line-item field extraction, so these probe "does it invent values?"
    if (F._barcode_value && F._barcode_value.value) put('barcode_ref', F._barcode_value.value, 'plain');
    if (Array.isArray(g.line_items)) put('line_item_count', String(g.line_items.length), 'plain');
    rows.push({ id: g.doc_id, file: g.doc_id + '.pdf', folder: TMP, type_slug: g.doc_type,
      type_name: g.doc_type_name || g.doc_type, variant: g.modality,
      low_quality: !!(g.features && g.features.low_quality), edge: g.edge_case || null,
      ref_key: g.ref_field_key || null, date_key: g.date_field_key || null,
      company_key: g.company_key || 'supplier_name', pdfSrc: pdf, fields });
  }
  return rows;
}

// ── DB with the rich schema (9 types, every GT-backed field + 2 hard customs) ────
const FIELD_META = {   // key -> {label, type, kind}
  customer_name: { label: 'Customer', type: 'text', kind: 'name' },
  total_amount: { label: 'Total', type: 'currency', kind: 'money' },
  subtotal: { label: 'Subtotal', type: 'currency', kind: 'money' },
  currency: { label: 'Currency', type: 'text', kind: 'plain' },
  barcode_ref: { label: 'Barcode ref', type: 'text', kind: 'plain' },
  line_item_count: { label: 'Line item count', type: 'number', kind: 'plain' },
};
function fresh(truth, dbFile) {
  const dbPath = path.join(ST, dbFile || 'rich.db');   // per-corpus DB so concurrent runs don't collide
  for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + ext); } catch {} }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
  runMigrations(db); docTypes.seedBuiltInTypes(db);
  const idBySlug = {}; for (const r of db.prepare('SELECT id, slug, name FROM document_types').all()) idBySlug[r.slug] = r.id;
  // discover per-type field keys from GT
  const perType = {};   // slug -> { name, ref_key, date_key, keys:Set }
  for (const t of truth) {
    const pt = perType[t.type_slug] || (perType[t.type_slug] = { name: t.type_name || t.type_slug, ref_key: null, date_key: null, keys: new Set() });
    if (t.ref_key) pt.ref_key = t.ref_key; if (t.date_key) pt.date_key = t.date_key;
    for (const k of Object.keys(t.fields)) pt.keys.add(k);
  }
  const ins = db.prepare('INSERT INTO document_types (name, slug, built_in, ref_field_key, date_field_key) VALUES (?,?,0,?,?)');
  for (const [slug, pt] of Object.entries(perType)) {
    if (idBySlug[slug] == null) { const r = ins.run(pt.name, slug, pt.ref_key, pt.date_key); idBySlug[slug] = r.lastInsertRowid; }
    else { try { db.prepare('UPDATE document_types SET ref_field_key=COALESCE(ref_field_key,?), date_field_key=COALESCE(date_field_key,?) WHERE id=?').run(pt.ref_key, pt.date_key, idBySlug[slug]); } catch {} }
    const typeId = idBySlug[slug];
    const existing = new Set(db.prepare('SELECT key FROM fields WHERE document_type_id=?').all(typeId).map(r => r.key));
    let so = 20;
    for (const key of pt.keys) {
      if (existing.has(key)) continue;
      const meta = FIELD_META[key] || {};
      const label = meta.label || (key === pt.ref_key ? 'Reference' : key === pt.date_key ? 'Date' : key.replace(/_/g, ' '));
      const type = meta.type || (key === pt.date_key ? 'date' : 'text');
      try { docTypes.addField(db, { document_type_id: typeId, key, label, type, required: 0, sort_order: so++ }); } catch {}
    }
    try { docTypes.ensureStructuralRoles && docTypes.ensureStructuralRoles(db, typeId); } catch {}
  }
  learning.setSetting(db, 'output_folder', OUT);
  return { db, idBySlug, perType };
}

// ── extraction (full config, 8-way shard) ───────────────────────────────────────
const wj = (tag, d) => { const f = path.join(os.tmpdir(), `rich_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
function snapshot(db) {
  const dts = docTypes.getAllWithFields(db);
  let fmt = []; try { fmt = learning.getFieldFormats(db); } catch {}
  let lo = []; try { lo = labelOverrides ? labelOverrides.getForExtraction(db) : []; } catch {}
  let fr = []; try { fr = learning.getFieldRules(db); } catch {}
  const args = ['--fields-file', wj('f', dts.flatMap(d => d.fields)), '--hints-file', wj('h', learning.getHints(db)),
    '--anchors-file', wj('a', learning.getAllAnchors(db)), '--logos-file', wj('l', learning.getAllLogos(db)),
    '--doc-types-file', wj('d', dts), '--formats-file', wj('fm', fmt), '--templates-file', wj('t', templates.getAll(db)),
    '--label-overrides-file', wj('lo', lo), '--field-rules-file', wj('fr', fr), '--config-file', CFG,
    '--registration', '--born-digital', '--multiline'];
  return { args, formatCount: fmt.length };
}
function runProcess(snap, truth) {
  const N = 8; const byFolder = {};
  for (const t of truth) (byFolder[t.folder] || (byFolder[t.folder] = [])).push(t.file);
  // all rows in one run share a folder (stress/hard) or the staged TMP (harness)
  const folder = truth[0].folder, files = truth.map(t => t.file);
  const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const one = (names) => new Promise(res => {
    const sf = wj('shard', names);
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', sf, '--mode', MODE,
      '--tesseract', TESS, '--identity-shadow', ...(process.env.CONFLICT ? ['--identity-conflict'] : []), ...snap.args], { windowsHide: true, env: { ...process.env, OMP_THREAD_LIMIT: '1' } });
    let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', () => { try { fs.unlinkSync(sf); } catch {} res({ out, err }); }); p.on('error', e => res({ out: '', err: String(e) }));
  });
  return Promise.all(shards.filter(s => s.length).map(one)).then(rs => {
    const docs = {}; let errAll = '';
    for (const r of rs) { errAll += r.err || ''; for (const ln of (r.out || '').split('\n')) { const s = ln.trim(); if (s[0] !== '{') continue; let m; try { m = JSON.parse(s); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; } }
    if (!Object.keys(docs).length) console.error('EXTRACTION STDERR tail:', errAll.slice(-1200));
    return docs;
  });
}

const ef = (m, k) => { const e = m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e.value : (m[k] != null ? m[k] : null); };
const STAGE = mth => /^template_mapping/.test(mth) ? '0.5 mapping' : /^template_/.test(mth) ? '0 template' : mth === 'keyword' ? '1 keyword'
  : mth === 'keyword_override' ? '1 admin-label' : (/^anchor/.test(mth) || mth === 'logo') ? '2 anchor' : mth === 'ocr_corrector' ? '2.5 ocr-fix'
  : mth === 'llm' ? '3 llm' : mth === 'hint' ? 'hint' : mth;

// ── scoring ─────────────────────────────────────────────────────────────────────
function scoreAll(truth, res, nameToSlug, idBySlug, db) {
  const perField = {};   // key -> {n,ok,empty,wrong,silent,ex[]}
  const perType = {};    // slug -> {n, typeOk, fieldsOk}
  const methodStats = {};
  const conf = [], confByVar = {};
  const wouldFile = { 100: 0, 98: 0 }; const silentAutoFile = { 100: 0, 98: 0 };
  // identity_fusion SHADOW tally: text-led supplier vs the pipeline's resolved supplier AND vs GT.
  const shadow = { verdict: 0, accepted: 0, agree: 0, conflict: 0, abstain: 0, knownSum: 0, ex: [],
                   textRight: 0, textWrong: 0, catch: 0, falseConflict: 0, catchEx: [], flagFired: 0 };
  let n = 0, typeOk = 0, allFieldsOk = 0;
  const setThreshold = th => { try { learning.setSetting(db, 'auto_file_threshold', String(th)); } catch {} };
  for (const t of truth) {
    const m = res[t.file]; if (!m) continue; n++;
    const sh = m.identity_shadow;
    if (sh) {
      shadow.verdict++; shadow.knownSum += sh.known_n || 0;
      if (sh.accepted) {
        shadow.accepted++; if (sh.agree) shadow.agree++;
        // cross-check text-led vs GROUND TRUTH supplier — is a conflict a real CATCH or a false alarm?
        const gtSup = (t.fields[t.company_key] || t.fields.supplier_name || {}).value;
        const textOk = gtSup != null && normName(sh.text_led) === normName(gtSup);
        if (gtSup != null) { if (textOk) shadow.textRight++; else shadow.textWrong++; }
        if (sh.conflict) {
          shadow.conflict++;
          // ACTIVE-flag firing proof (CONFLICT=1): did the doc come back carrying the identity note?
          const _idf = (m.extractions && (m.extractions.supplier_name || m.extractions.customer_name)) || {};
          if (/Letterhead may read/.test(_idf.validation_note || '')) shadow.flagFired++;
          if (textOk) { shadow.catch++; if (shadow.catchEx.length < 6) shadow.catchEx.push(`${t.file}: pipeline WRONG='${sh.resolved}' -> text-led RIGHT='${sh.text_led}'`); }
          else { shadow.falseConflict++; if (shadow.ex.length < 6) shadow.ex.push(`${t.file}: pipeline='${sh.resolved}' text-led='${sh.text_led}' GT='${gtSup}' (${sh.confidence})`); }
        }
      } else shadow.abstain++;
    }
    const detSlug = m._document_slug || nameToSlug[m.document_type] || null;
    const tHit = detSlug === t.type_slug; if (tHit) typeOk++;
    const pt = perType[t.type_slug] || (perType[t.type_slug] = { n: 0, typeOk: 0, fieldsOk: 0, fields: {} });
    pt.n++; if (tHit) pt.typeOk++;
    let docFieldsOk = true;
    for (const [key, gt] of Object.entries(t.fields)) {
      const norm = NORM[gt.kind] || normName;
      const raw = ef(m, key);
      const ok = norm(raw) === norm(gt.value) && norm(gt.value) !== '';
      const ex = m.extractions && m.extractions[key];
      const mth = ex && ex.method ? ex.method : (ex ? '(no-method)' : '(no-extraction)');
      const F = perField[key] || (perField[key] = { n: 0, ok: 0, empty: 0, wrong: 0, silent: 0, ex: [] });
      F.n++; pt.fields[key] = pt.fields[key] || { n: 0, ok: 0 }; pt.fields[key].n++;
      // per-stage attribution
      const M = methodStats[mth] || (methodStats[mth] = { n: 0, ok: 0 }); M.n++;
      if (ok) { F.ok++; pt.fields[key].ok++; M.ok++; }
      else {
        docFieldsOk = false;
        const empty = (raw == null || String(raw).trim() === '');
        const flagged = !!(ex && (String(ex.validation_note || '').trim() || (ex.confidence != null && ex.confidence < 70)));
        if (empty) F.empty++; else { F.wrong++; if (!flagged) F.silent++; if (F.ex.length < 4) F.ex.push(`[${mth}${flagged ? ' flag' : ' SILENT'}] want '${gt.value}' got '${raw}'`); }
      }
    }
    if (docFieldsOk && tHit) allFieldsOk++;
    const cv = m.overall_confidence || 0; conf.push(cv); (confByVar[t.variant] || (confByVar[t.variant] = [])).push(cv);
    // real auto-file gate at 100 and 98
    const detId = idBySlug[detSlug];
    if (detId != null && m.overall_confidence != null) {
      const rex = Object.entries(m.extractions || {}).map(([k, e]) => ({ field_key: k, display_value: (e && typeof e === 'object') ? e.value : e, validation_note: (e && typeof e === 'object') ? e.validation_note : null }));
      const fakeDoc = { id: 1, supplier_name: m.supplier_name, document_type_id: detId, overall_confidence: m.overall_confidence };
      for (const th of [100, 98]) {
        setThreshold(th);
        let elig = false; try { elig = trust.isAutoFileEligible(db, fakeDoc, { extractions: rex }).eligible; } catch {}
        if (elig) { wouldFile[th]++; if (!(docFieldsOk && tHit)) silentAutoFile[th]++; }
      }
    }
  }
  return { n, typeOk, allFieldsOk, perField, perType, methodStats, conf, confByVar, wouldFile, silentAutoFile, shadow };
}

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
const cstat = a => a.length ? `min ${Math.min(...a)} / mean ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)} / max ${Math.max(...a)} / >=98: ${a.filter(x => x >= 98).length} / ==100: ${a.filter(x => x >= 100).length}` : '-';

function report(tag, truth, R, extra) {
  const o = [];
  o.push(`# Rich-field run — ${tag} (${R.n} docs, mode=${MODE})`);
  if (extra) o.push(extra);
  o.push(`\nType detection: ${R.typeOk}/${R.n} (${pct(R.typeOk, R.n)}) · all fields + type correct: ${R.allFieldsOk}/${R.n} (${pct(R.allFieldsOk, R.n)})`);
  o.push(`Confidence: ${cstat(R.conf)}`);
  for (const [v, a] of Object.entries(R.confByVar)) o.push(`  - ${v}: ${cstat(a)}`);
  const S = R.shadow || {};
  if (S.verdict) {
    o.push(`\n## identity_fusion SHADOW (text-led supplier vs pipeline + vs GROUND TRUTH — records only)`);
    o.push(`- docs with a gazetteer verdict: **${S.verdict}/${R.n}**  (avg known-suppliers ${(S.knownSum / S.verdict).toFixed(1)})`);
    o.push(`- text-led ACCEPTED ${S.accepted}/${S.verdict} (${pct(S.accepted, S.verdict)}) · abstained ${S.abstain}`);
    o.push(`- accepted vs GROUND TRUTH: **RIGHT ${S.textRight}** · **WRONG=silent-wrong ${S.textWrong}**  <- must be ~0 (precision)`);
    o.push(`- vs pipeline: AGREE ${S.agree} · CONFLICT ${S.conflict}  →  of conflicts: **CATCH ${S.catch}** (pipeline wrong, text-led right) · false-alarm ${S.falseConflict}`);
    if (process.env.CONFLICT) o.push(`- ACTIVE flag fired (identity note present) on **${S.flagFired}/${S.conflict}** conflict docs`);
    if (S.catchEx.length) o.push(`- catches: ${S.catchEx.join('  ·  ')}`);
    if (S.ex.length) o.push(`- false-alarms: ${S.ex.join('  ·  ')}`);
  }
  o.push(`\n## Would auto-file (REAL trust.isAutoFileEligible gate)`);
  o.push(`- threshold 100: **${R.wouldFile[100]}/${R.n}** (${pct(R.wouldFile[100], R.n)})  — of which wrong/silent: ${R.silentAutoFile[100]}`);
  o.push(`- threshold 98:  **${R.wouldFile[98]}/${R.n}** (${pct(R.wouldFile[98], R.n)})  — of which wrong/silent: ${R.silentAutoFile[98]}`);
  o.push(`\n## Per-field accuracy (correct / empty=recall gap / wrong=precision gap / silent)`);
  o.push('| Field | n | correct | empty | wrong | silent | examples |');
  o.push('|---|---|---|---|---|---|---|');
  for (const [k, F] of Object.entries(R.perField).sort((a, b) => b[1].n - a[1].n))
    o.push(`| ${k} | ${F.n} | ${F.ok} (${pct(F.ok, F.n)}) | ${F.empty} | ${F.wrong} | ${F.silent} | ${F.ex.slice(0, 2).join(' ; ') || '—'} |`);
  o.push(`\n## Per-stage attribution (which method won a field, and its precision)`);
  o.push('| Method (stage) | wins | correct | precision |');
  o.push('|---|---|---|---|');
  for (const [mth, M] of Object.entries(R.methodStats).sort((a, b) => b[1].n - a[1].n))
    o.push(`| \`${mth}\` (${STAGE(mth)}) | ${M.n} | ${M.ok} | ${pct(M.ok, M.n)} |`);
  const totalSilent = Object.values(R.perField).reduce((s, F) => s + F.silent, 0);
  const totalWrong = Object.values(R.perField).reduce((s, F) => s + F.wrong, 0);
  o.push(`\n**Silent mis-reads: ${totalSilent} of ${totalWrong} wrong values carried no review flag.**`);
  o.push(`\n## Per-type breakdown`);
  o.push('| Type | n | type-detect | ' + '');
  o.push('|---|---|---|');
  for (const [slug, P] of Object.entries(R.perType).sort((a, b) => b[1].n - a[1].n))
    o.push(`| ${slug} | ${P.n} | ${pct(P.typeOk, P.n)} |`);
  return o.join('\n');
}

// ── teach one doc per type from GT (generic) ────────────────────────────────────
function teachCycle(db, truth, res, idBySlug, confirmed, idByFile, phashByFile) {
  const bySlug = {}; for (const t of truth) if (!confirmed.has(t.file)) (bySlug[t.type_slug] || (bySlug[t.type_slug] = [])).push(t);
  let submitted = 0;
  for (const [slug, list] of Object.entries(bySlug)) {
    const t = list[0]; const id = idByFile[t.file]; if (!id) continue;
    const m = res[t.file] || {};
    const gt = {}; for (const [k, v] of Object.entries(t.fields)) gt[k] = v.value;
    const corrections = {};
    for (const [k, v] of Object.entries(gt)) { const cur = ef(m, k); if (String(cur || '').trim() !== String(v).trim()) corrections[k] = { original_value: cur == null ? '' : String(cur), corrected_value: String(v) }; }
    const company = gt[t.company_key] || gt.supplier_name;
    try { documents.update(db, id, { supplier_name: company, document_type_id: idBySlug[slug] }); } catch {}
    try { learning.saveCorrections(db, id, corrections, company, slug, gt, []); } catch {}
    try { documents.confirmIfReviewable(db, id, { confirmed_by_username: 'tester' }); } catch {}
    const ph = phashByFile[t.file]; if (ph) { try { learning.saveLogoFingerprint(db, { supplier_name: company, phash: ph, ahash: ph }); } catch {} }
    confirmed.add(t.file); submitted++;
  }
  return submitted;
}

async function runCorpus(tag, truth) {
  if (LIMIT) truth = truth.slice(0, LIMIT);
  if (tag.startsWith('harness')) { fs.mkdirSync(TMP, { recursive: true }); for (const t of truth) { try { if (!fs.existsSync(path.join(TMP, t.file))) fs.copyFileSync(t.pdfSrc, path.join(TMP, t.file)); } catch {} } }
  const { db, idBySlug } = fresh(truth, 'rich_' + tag + '.db');
  const nameToSlug = {}; for (const r of db.prepare('SELECT name, slug FROM document_types').all()) nameToSlug[r.name] = r.slug;
  const reports = [];
  // COLD
  let res = await runProcess(snapshot(db), truth);
  const idByFile = {}, phashByFile = {};
  for (const t of truth) {
    const m = res[t.file]; if (!m) continue; phashByFile[t.file] = m.logo_phash || null;
    const det = m._document_slug || nameToSlug[m.document_type] || null;
    const info = documents.insert(db, { original_filename: t.file, folder_path: t.folder, document_type_id: idBySlug[det] || idBySlug[t.type_slug] || null, supplier_name: m.supplier_name || null, overall_confidence: m.overall_confidence || null, status: 'needs_review', page_count: 1 });
    idByFile[t.file] = info.lastInsertRowid;
    const rows = Object.entries(m.extractions || {}).map(([k, e]) => ({ field_key: k, raw_value: e && e.value != null ? String(e.value) : null, display_value: e && e.value != null ? String(e.value) : null, confidence: e && e.confidence != null ? e.confidence : null, extraction_method: e && e.method || null, validation_note: e && e.validation_note || null }));
    if (rows.length) learning.insertExtractions(db, info.lastInsertRowid, rows);
  }
  reports.push(report(`${tag} — COLD (attempt 0, no learning)`, truth, scoreAll(truth, res, nameToSlug, idBySlug, db)));
  // TEACH cycles
  const confirmed = new Set();
  for (let cy = 1; cy <= CYCLES; cy++) {
    const sub = teachCycle(db, truth, res, idBySlug, confirmed, idByFile, phashByFile);
    res = await runProcess(snapshot(db), truth);
    reports.push(report(`${tag} — after cycle ${cy} (+${sub} taught = ${confirmed.size} total)`, truth, scoreAll(truth, res, nameToSlug, idBySlug, db)));
  }
  db.close();
  return reports.join('\n\n---\n\n');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const RUN = (process.env.RUN || 'validate').toLowerCase();
  const jobs = [];
  if (RUN === 'validate' || RUN === 'stress' || RUN === 'all') jobs.push(['stress', () => loadStressLike(path.join(ST, 'corpus'))]);
  if (RUN === 'hard' || RUN === 'all') jobs.push(['hard', () => loadStressLike(path.join(ST, 'corpus_hard'))]);
  if (RUN === 'harness' || RUN === 'all') jobs.push(['harness', loadHarness]);
  let full = '';
  for (const [tag0, load] of jobs) {
    console.log(`\n### RUNNING ${tag0} ...`);
    let truth; try { truth = load(); } catch (e) { console.error(`load ${tag0} failed`, e); continue; }
    if (process.env.MODALITY) truth = truth.filter(t => (t.variant || '') === process.env.MODALITY);
    const tag = process.env.MODALITY ? `${tag0}_${process.env.MODALITY}` : tag0;
    console.log(`  ${truth.length} docs loaded`);
    if (!truth.length) { console.log(`  (no ${process.env.MODALITY || ''} docs — skip)`); continue; }
    const rep = await runCorpus(tag, truth);
    full += rep + '\n\n===================\n\n';
    fs.writeFileSync(path.join(OUT, `rich_${tag}.md`), rep);
    console.log(rep);
  }
  fs.writeFileSync(path.join(OUT, 'rich_all.md'), full);
  console.log('\nWrote', path.join(OUT, 'rich_all.md'));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
