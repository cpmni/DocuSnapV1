'use strict';
/*
 * CUSTOMER DOC TEST corpus scorer — the Oracle-C6 GT gate (built 2026-08-04).
 *
 * Scores extraction against the Desktop corpus's ground_truth.json — the ONLY gate whose GT
 * covers NAMES (issuer), NUMERIC (total), STRUCTURED (vat_no) and CUSTOM refs (account_no,
 * job_ref, po_ref) — the lanes the 522-doc realdoc gate cannot fail on. Unlocks the flips of:
 * NAME_UNCLIP_RECONCILE, Slice-2 2b (UNIVERSAL_VERIFY_NUMERIC), 2c (UNIVERSAL_VERIFY_FLAG).
 *
 * COLD-INSTALL model: a throwaway DB gets the corpus's doc types (built-ins + presets +
 * service_worksheet) + the custom extra fields, NO learning/templates/anchors — extraction runs
 * exactly as a fresh customer's would. Never touches the live DB.
 *
 * Run (Git Bash; electron.exe directly — never the .cmd shim):
 *   ELECTRON_RUN_AS_NODE=1 [SAMPLE=300] [SET=both|digital|scanned] [TAG=base] [SEED=7] \
 *     [heal/verify env switches for the arm under test] \
 *     "node_modules/electron/dist/electron.exe" stress_test/customer_corpus_score.js
 * Outputs: stress_test/out/customer_score_<TAG>.md + .jsonl (one row per doc, per-field verdicts
 * + every engine heal/verify log line captured for the per-fire census).
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const REPO = 'c:/GIT Projects/Docusnap', ST = path.join(REPO, 'stress_test');
const OUT = path.join(ST, 'out');
const CORPUS = path.join(os.homedir(), 'Desktop', 'Customer Doc Test');
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const { runMigrations } = require(path.join(REPO, 'database', 'index.js'));
const docTypes = require(path.join(REPO, 'database', 'modules', 'document_types.js'));

const SAMPLE = parseInt(process.env.SAMPLE || '300', 10);
const SET = (process.env.SET || 'both').toLowerCase();          // digital | scanned | both
const TAG = process.env.TAG || 'base';
const SEED = parseInt(process.env.SEED || '7', 10);
const TEACH = process.env.TEACH === '1';                        // TAUGHT arm: derive Stage-0.5
// mappings from ONE digital "To be manually confirmed" doc per (issuer,type) via teach_from_gt.py,
// insert templates+mappings into the throwaway DB, and pin every sampled doc to its template with
// --reprocess-manifest (the app's faithful Reprocess-All shape). This is what lets the mapper
// heal/verify stack — incl. NAME_UNCLIP — actually FIRE on this corpus (cold fires no Stage 0.5).
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));

const w = (tag, d) => { const f = path.join(os.tmpdir(), `ccs_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const normRef = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normMoney = s => { const v = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return isNaN(v) ? null : v.toFixed(2); };
const normDate = s => String(s || '').replace(/[^0-9]/g, '');
const normName = s => String(s || '').toLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g, ' ').trim();

// Deterministic shuffle (mulberry32) — reruns sample the SAME docs (comparable arms).
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function main() {
  // ── 1. Ground truth + stratified deterministic sample ─────────────────────
  const gt = JSON.parse(fs.readFileSync(path.join(CORPUS, 'ground_truth.json'), 'utf8'));
  let pool = gt.filter(e => SET === 'both' || String(e.rendition || '').toLowerCase().startsWith(SET === 'digital' ? 'digital' : 'scan'));
  const strata = {};
  for (const e of pool) (strata[`${e.type_slug}|${e.rendition}`] || (strata[`${e.type_slug}|${e.rendition}`] = [])).push(e);
  const keys = Object.keys(strata).sort();
  const rand = rng(SEED);
  for (const k of keys) strata[k].sort((a, b) => (a.file < b.file ? -1 : 1)).sort(() => rand() - 0.5);
  const per = Math.max(1, Math.floor(SAMPLE / keys.length));
  let sampled = keys.flatMap(k => strata[k].slice(0, per));
  if (sampled.length > SAMPLE) sampled = sampled.slice(0, SAMPLE);
  console.log(`[ccs] sampled ${sampled.length} docs across ${keys.length} strata (SET=${SET}, SEED=${SEED})`);

  // ── 2. Throwaway cold-install DB: types + custom fields, zero learning ────
  const dbPath = path.join(os.tmpdir(), `ccs_db_${Date.now()}.db`);
  const db = new Database(dbPath);
  runMigrations(db); docTypes.seedBuiltInTypes(db);
  try { docTypes.addPresetTypes(db, ['delivery_note', 'quote', 'credit_note', 'statement']); }
  catch (e) { console.log('[ccs] preset add:', e.message); }
  if (!db.prepare(`SELECT 1 FROM document_types WHERE slug='service_worksheet'`).get()) {
    const r = docTypes.addType(db, { name: 'Service Worksheet' });
    docTypes.addField(db, { document_type_id: r.lastInsertRowid, key: 'worksheet_number', label: 'Worksheet No', type: 'reference' });
    docTypes.addField(db, { document_type_id: r.lastInsertRowid, key: 'worksheet_date', label: 'Date', type: 'date' });
    docTypes.ensureStructuralRoles(db, r.lastInsertRowid);
    db.prepare(`UPDATE document_types SET ref_field_key='worksheet_number', date_field_key='worksheet_date' WHERE id=?`).run(r.lastInsertRowid);
  }
  // Custom extras on every corpus type (GT nulls simply skip scoring).
  const EXTRAS = [['vat_no', 'VAT No', 'vat_gb'], ['account_no', 'Account No', 'reference'],
                  ['job_ref', 'Job Ref', 'reference'], ['po_ref', 'Your PO', 'reference']];
  for (const dt of db.prepare('SELECT id, slug FROM document_types').all()) {
    for (const [key, label, type] of EXTRAS) {
      if (!db.prepare('SELECT 1 FROM fields WHERE document_type_id=? AND key=?').get(dt.id, key)) {
        try { docTypes.addField(db, { document_type_id: dt.id, key, label, type }); } catch {}
      }
    }
  }
  const dts = db.prepare('SELECT * FROM document_types').all();
  const fieldsByType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (fieldsByType[f.document_type_id] || (fieldsByType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = fieldsByType[dt.id] || [];
  const refKeyBySlug = {}, dateKeyBySlug = {};
  for (const dt of dts) { refKeyBySlug[dt.slug] = dt.ref_field_key; dateKeyBySlug[dt.slug] = dt.date_field_key; }

  // ── 2b. TAUGHT arm: teach one digital manual doc per (issuer,type) from GT ─
  const tmplBySlugIssuer = {};                     // `${issuer}|${type_slug}` -> template_id
  if (TEACH) {
    const pairs = {};
    for (const e of sampled) (pairs[`${e.issuer}|${e.type_slug}`] = true);
    const teachDocs = {};
    for (const e of gt) {                          // teach doc = digital + "manually confirmed"
      const k = `${e.issuer}|${e.type_slug}`;
      if (!pairs[k] || teachDocs[k]) continue;
      if (String(e.rendition || '').toLowerCase().startsWith('digital')
          && /manually confirmed/i.test(e.file)) teachDocs[k] = e;
    }
    const teachOne = ([k, e]) => new Promise(res => {
      const refKey = refKeyBySlug[e.type_slug], dateKey = dateKeyBySlug[e.type_slug];
      const fields = {};
      if (refKey && e.ref != null) fields[refKey] = e.ref;
      if (dateKey && e.date != null) fields[dateKey] = e.date;
      if (e.issuer != null) fields.supplier_name = e.issuer;
      if (e.total != null) fields.total_amount = e.total;
      for (const x of ['vat_no', 'account_no', 'job_ref', 'po_ref'])
        if (e[x] != null) fields[x] = e[x];
      const job = w('job', { pdf: path.join(CORPUS, e.file), fields });
      const p = spawn('py', ['-3.12', path.join(ST, 'teach_from_gt.py'),
                             '--job', job, '--tesseract', TESS], { windowsHide: true });
      let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {});
      p.on('close', () => { try { res([k, e, JSON.parse(out)]); } catch { res([k, e, null]); } });
      p.on('error', () => res([k, e, null]));
    });
    const entries = Object.entries(teachDocs);
    console.log(`[ccs] TEACH: deriving mappings for ${entries.length} (issuer,type) pairs…`);
    const taught = [];
    for (let i = 0; i < entries.length; i += 8)
      taught.push(...await Promise.all(entries.slice(i, i + 8).map(teachOne)));
    let ok = 0, missTotal = 0;
    for (const [k, e, res] of taught) {
      if (!res || !res.mappings || !res.mappings.length) continue;
      const dt = dts.find(d => d.slug === e.type_slug); if (!dt) continue;
      const info = db.prepare(`INSERT INTO templates (name, slug, document_type_slug, confirmed_count)
                               VALUES (?, ?, ?, 3)`)
        .run(e.issuer, `ccs_${k.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, e.type_slug);
      const tid = info.lastInsertRowid;
      const typeByKey = {}; for (const f of dt.fields) typeByKey[f.key] = (f.type || '').toLowerCase();
      const OCR_TYPE = { date: 'date', currency: 'currency', number: 'currency',
                        reference: 'alphanumeric', reference_code: 'reference_code',
                        vat_gb: 'text', alphanumeric: 'alphanumeric' };
      for (const m of res.mappings) {
        // TEACH_JITTER=0.18: shrink the taught target's RIGHT edge — recreates the human
        // cutting-draw disease (mid-token cut of the last word) so the heal stack has a real
        // class to act on and GT arbitrates every fire. 0/unset = the GT-perfect boxes.
        const J = parseFloat(process.env.TEACH_JITTER || '0');
        if (J > 0) m.target.w = m.target.w * (1 - J);
        templates.saveMapping(db, tid, {
          field_key: m.field_key, page_number: 0, anchor_text: m.anchor_text,
          anchor_x_norm: m.anchor.x, anchor_y_norm: m.anchor.y,
          anchor_w_norm: m.anchor.w, anchor_h_norm: m.anchor.h,
          target_x_norm: m.target.x, target_y_norm: m.target.y,
          target_w_norm: m.target.w, target_h_norm: m.target.h,
          ocr_type: OCR_TYPE[typeByKey[m.field_key]] || 'text',
        });
      }
      tmplBySlugIssuer[k] = tid; ok++; missTotal += (res.misses || []).length;
    }
    console.log(`[ccs] TEACH: ${ok}/${entries.length} templates stored (${missTotal} field misses)`);
  }

  // PROVISIONAL SEEDING PARITY (2026-08-04, owner GO): in the LIVE app the teach wizard's
  // commit ENDS IN A CONFIRM, so the taught values become count-1 confirmed rows that
  // getFieldFormats emits as `provisional:true` — arming the consent ladder from sibling #1.
  // The harness's throwaway DB has no confirmed rows, so the taught arm must emit the same
  // provisional entries itself (supplier-scoped + doc-type-scoped, mirroring getFieldFormats)
  // or every consent-gated heal is structurally dead here (the jitter-crater mechanism 1).
  const provFormats = [];
  if (TEACH) {
    const seen = new Set();
    for (const [k, tid] of Object.entries(tmplBySlugIssuer)) {
      const [issuer, slug] = k.split('|');
      const e = gt.find(x => x.issuer === issuer && x.type_slug === slug
                             && /manually confirmed/i.test(x.file)
                             && String(x.rendition || '').toLowerCase().startsWith('digital'));
      if (!e) continue;
      const refKey = refKeyBySlug[slug], dateKey = dateKeyBySlug[slug];
      const vals = {};
      if (refKey && e.ref != null) vals[refKey] = String(e.ref);
      if (dateKey && e.date != null) vals[dateKey] = String(e.date);
      if (e.total != null) vals.total_amount = String(e.total);
      for (const x of ['vat_no', 'account_no', 'job_ref', 'po_ref'])
        if (e[x] != null) vals[x] = String(e[x]);
      for (const [fk, v] of Object.entries(vals)) {
        for (const sup of [issuer, '']) {                 // supplier + doc-type scope, like live
          const dk = `${sup}|${slug}|${fk}`;
          if (seen.has(dk)) continue; seen.add(dk);
          provFormats.push({ supplier_name: sup, document_type: slug, field_key: fk,
                            provisional: true, sample_values: [v], confirmed_count: 1,
                            value_counts: { [v]: 1 } });
        }
      }
    }
    console.log(`[ccs] TEACH: seeded ${provFormats.length} provisional format rows (live-confirm parity)`);
  }

  const snapArgs = ['--fields-file', w('f', dts.flatMap(d => d.fields)),
                    '--doc-types-file', w('d', dts),
                    '--hints-file', w('h', []), '--anchors-file', w('a', []), '--logos-file', w('l', []),
                    '--formats-file', w('fm', provFormats),
                    '--templates-file', w('t', TEACH ? templates.getAll(db) : []),
                    '--config-file', CFG, '--registration', '--born-digital', '--multiline'];

  // ── 3. Flat tmp folder of sampled files (unique names → GT mapping) ───────
  const runDir = path.join(os.tmpdir(), `ccs_run_${Date.now()}`);
  fs.mkdirSync(runDir, { recursive: true });
  const byName = {}, manifest = {};
  sampled.forEach((e, i) => {
    const name = `ccs_${String(i).padStart(4, '0')}.pdf`;
    fs.copyFileSync(path.join(CORPUS, e.file), path.join(runDir, name));
    byName[name] = e;
    const tid = tmplBySlugIssuer[`${e.issuer}|${e.type_slug}`];
    if (tid) manifest[name] = { known_template_id: tid, known_doc_slug: e.type_slug };
  });
  const manifestArgs = Object.keys(manifest).length
    ? ['--reprocess-manifest', w('manifest', manifest)] : [];

  // ── 4. Shard + spawn (env inherited — the arm's switches ride through) ────
  const N = 8; const shards = Array.from({ length: N }, () => []);
  Object.keys(byName).forEach((f, i) => shards[i % N].push(f));
  const heals = [];                              // every heal/verify log line → per-fire census
  const HEAL_RE = /(Name-unclip reconcile|Universal verify|Crosscheck-outlier|edge-clean|Snap|clip commit|frag)/i;
  const run1 = files => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', runDir, '--files-file', w('shard', files),
                           '--mode', 'fast', '--tesseract', TESS, ...manifestArgs, ...snapArgs], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {});
    p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  const outs = await Promise.all(shards.filter(s => s.length).map(run1));
  const docs = {};
  for (const o of outs) for (const ln of o.split('\n')) {
    const t = ln.trim(); if (t[0] !== '{') continue;
    let m; try { m = JSON.parse(t); } catch { continue; }
    if (m.type === 'file_done') docs[m.original_filename] = m;
    else if (m.type === 'log' && HEAL_RE.test(m.text || '')) heals.push(m.text.trim());
  }

  // ── 5. Score ──────────────────────────────────────────────────────────────
  const LANES = ['ref', 'date', 'total', 'issuer', 'vat_no', 'account_no', 'job_ref', 'po_ref', 'type'];
  const tally = {};
  const bump = (lane, rend, ok) => { const k = `${lane}|${rend}`; (tally[k] || (tally[k] = { ok: 0, n: 0 })); tally[k].n++; if (ok) tally[k].ok++; };
  const rows = [];
  const exVal = (m, key) => { const e = (m.extractions || {})[key]; return e ? (e.display_value || e.value || '') : (m[key] || ''); };
  for (const [name, e] of Object.entries(byName)) {
    const m = docs[name];
    const rend = String(e.rendition || '').toLowerCase().startsWith('scan') ? 'scanned' : 'digital';
    const row = { file: e.file, rendition: rend, type_gt: e.type_slug, processed: !!m, verdicts: {} };
    if (!m) { rows.push(row); continue; }
    const slug = String(m.document_type_slug || '').toLowerCase() ||
      (dts.find(d => d.name === m.document_type) || {}).slug || '';
    const refKey = refKeyBySlug[e.type_slug], dateKey = dateKeyBySlug[e.type_slug];
    const checks = {
      type:       slug === e.type_slug,
      ref:        e.ref     != null && normRef(exVal(m, refKey) || m.reference_number) === normRef(e.ref),
      date:       e.date    != null && normDate(exVal(m, dateKey) || m.doc_date) === normDate(e.date),
      total:      e.total   != null && normMoney(exVal(m, 'total_amount') || m.total_amount) === normMoney(e.total),
      issuer:     e.issuer  != null && normName(m.supplier_name || exVal(m, 'supplier_name')) === normName(e.issuer),
      vat_no:     e.vat_no     != null && normRef(exVal(m, 'vat_no')) === normRef(e.vat_no),
      account_no: e.account_no != null && normRef(exVal(m, 'account_no')) === normRef(e.account_no),
      job_ref:    e.job_ref    != null && normRef(exVal(m, 'job_ref')) === normRef(e.job_ref),
      po_ref:     e.po_ref     != null && normRef(exVal(m, 'po_ref')) === normRef(e.po_ref),
    };
    for (const lane of LANES) {
      const gtHas = lane === 'type' || e[lane === 'issuer' ? 'issuer' : lane] != null;
      if (!gtHas) continue;
      bump(lane, rend, !!checks[lane]);
      row.verdicts[lane] = !!checks[lane];
      if (!checks[lane]) row[`${lane}_got`] = lane === 'type' ? slug
        : (lane === 'ref' ? (exVal(m, refKey) || m.reference_number)
          : lane === 'date' ? (exVal(m, dateKey) || m.doc_date)
          : lane === 'issuer' ? m.supplier_name
          : lane === 'total' ? (exVal(m, 'total_amount') || m.total_amount) : exVal(m, lane));
    }
    rows.push(row);
  }

  // ── 6. Report ─────────────────────────────────────────────────────────────
  fs.mkdirSync(OUT, { recursive: true });
  const jl = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, `customer_score_${TAG}.jsonl`), jl);
  let md = `# Customer-corpus score — TAG=${TAG} (SET=${SET}, SAMPLE=${sampled.length}, SEED=${SEED})\n\n`;
  md += `Processed ${Object.keys(docs).length}/${sampled.length} sampled docs (cold install — no learning/templates).\n\n`;
  md += `| lane | digital | scanned | overall |\n|---|---|---|---|\n`;
  for (const lane of LANES) {
    const d = tally[`${lane}|digital`] || { ok: 0, n: 0 }, s = tally[`${lane}|scanned`] || { ok: 0, n: 0 };
    const f = x => x.n ? `${x.ok}/${x.n} (${(100 * x.ok / x.n).toFixed(1)}%)` : '—';
    md += `| ${lane} | ${f(d)} | ${f(s)} | ${f({ ok: d.ok + s.ok, n: d.n + s.n })} |\n`;
  }
  md += `\n## Heal/verify fires captured (${heals.length}) — the per-fire census input\n`;
  for (const h of heals.slice(0, 200)) md += `- ${h}\n`;
  fs.writeFileSync(path.join(OUT, `customer_score_${TAG}.md`), md);
  console.log(md.split('\n').slice(0, 16).join('\n'));
  console.log(`[ccs] reports: customer_score_${TAG}.md / .jsonl · heals captured: ${heals.length}`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
