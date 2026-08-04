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

  const snapArgs = ['--fields-file', w('f', dts.flatMap(d => d.fields)),
                    '--doc-types-file', w('d', dts),
                    '--hints-file', w('h', []), '--anchors-file', w('a', []), '--logos-file', w('l', []),
                    '--formats-file', w('fm', []), '--templates-file', w('t', []),
                    '--config-file', CFG, '--registration', '--born-digital', '--multiline'];

  // ── 3. Flat tmp folder of sampled files (unique names → GT mapping) ───────
  const runDir = path.join(os.tmpdir(), `ccs_run_${Date.now()}`);
  fs.mkdirSync(runDir, { recursive: true });
  const byName = {};
  sampled.forEach((e, i) => {
    const name = `ccs_${String(i).padStart(4, '0')}.pdf`;
    fs.copyFileSync(path.join(CORPUS, e.file), path.join(runDir, name));
    byName[name] = e;
  });

  // ── 4. Shard + spawn (env inherited — the arm's switches ride through) ────
  const N = 8; const shards = Array.from({ length: N }, () => []);
  Object.keys(byName).forEach((f, i) => shards[i % N].push(f));
  const heals = [];                              // every heal/verify log line → per-fire census
  const HEAL_RE = /(Name-unclip reconcile|Universal verify|Crosscheck-outlier|edge-clean|Snap|clip commit|frag)/i;
  const run1 = files => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', runDir, '--files-file', w('shard', files),
                           '--mode', 'fast', '--tesseract', TESS, ...snapArgs], { windowsHide: true });
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
