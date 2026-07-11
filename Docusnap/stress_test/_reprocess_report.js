'use strict';
// READ-ONLY reprocess-and-report: reprocess ALL docs in the live DB with the CURRENT learning
// snapshot (now that a few docs are confirmed), then (a) score the CONFIRMED docs vs their
// confirmed values and (b) report what every doc pulls. Never writes the live DB (opens readonly,
// stages copies to a temp dir). Safe to run with the app open (WAL readers coexist).
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap', ST = path.join(REPO, 'stress_test');
const OUT = path.join(ST, 'out'), CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const DB_PATH = path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const nSup = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const nRef = s => String(s || '').toUpperCase().replace(/\s+/g, '');
const nMoney = s => { const v = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return isNaN(v) ? null : v.toFixed(2); };
const nDate = s => String(s || '').replace(/[^0-9]/g, '');
const safe = (fn, d) => { try { return fn(); } catch { return d; } };
const w = (tag, d) => { const f = path.join(os.tmpdir(), `rp_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
const roles = {}; for (const r of db.prepare('SELECT slug, ref_field_key, date_field_key FROM document_types').all()) roles[r.slug] = { ref: r.ref_field_key, date: r.date_field_key };
const nameToSlug = {}; for (const r of db.prepare('SELECT name, slug FROM document_types').all()) nameToSlug[r.name] = r.slug;

// doc-types + fields read-only (mirror getAllWithFields without its repair WRITE)
const dts = db.prepare('SELECT * FROM document_types').all();
const byType = {}; for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
for (const dt of dts) dt.fields = byType[dt.id] || [];

const snapArgs = [
  '--fields-file', w('f', dts.flatMap(d => d.fields)),
  '--hints-file', w('h', safe(() => learning.getHints(db), [])),
  '--anchors-file', w('a', safe(() => learning.getAllAnchors(db), [])),
  '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
  '--doc-types-file', w('d', dts),
  '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
  '--templates-file', w('t', safe(() => templates.getAll(db), [])),
  '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
  '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
  '--config-file', CFG, '--registration', '--born-digital', '--multiline',
];

const docs = db.prepare(`SELECT d.id, d.status, d.supplier_name, d.reference_number, d.doc_date,
  d.stored_path, d.working_path, dt.slug type_slug
  FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
  WHERE d.status IN ('confirmed','needs_review')`).all();
const exByDoc = {};
for (const e of db.prepare(`SELECT e.document_id, e.field_key, e.display_value FROM extractions e
  JOIN documents d ON d.id = e.document_id WHERE d.status='confirmed'`).all())
  (exByDoc[e.document_id] || (exByDoc[e.document_id] = {}))[e.field_key] = e.display_value;
// A field the user FILLED in Review that was empty at extraction time (e.g. total/subtotal, which
// had no extraction row) is recorded as a CORRECTION (""→value), NOT an extraction. So the confirmed
// ground truth = the correction's corrected_value when present, else the extraction display_value.
const corrByDoc = {};
for (const c of db.prepare(`SELECT c.document_id, c.field_key, c.corrected_value FROM corrections c
  JOIN documents d ON d.id = c.document_id WHERE d.status='confirmed'`).all())
  (corrByDoc[c.document_id] || (corrByDoc[c.document_id] = {}))[c.field_key] = c.corrected_value;
const finalVal = (docId, key) => {
  const c = corrByDoc[docId] && corrByDoc[docId][key];
  if (c != null && String(c).trim()) return c;
  const e = exByDoc[docId] && exByDoc[docId][key];
  return e;
};

const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'reproc-'));
const resolveFile = d => (d.working_path && fs.existsSync(d.working_path)) ? d.working_path
                       : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
const gt = {}, files = []; let noFile = 0;
for (const d of docs) {
  const src = resolveFile(d); if (!src) { noFile++; continue; }
  const fname = `doc${d.id}${path.extname(src) || '.pdf'}`;
  try { fs.copyFileSync(src, path.join(RR, fname)); } catch { noFile++; continue; }
  files.push(fname);
  gt[fname] = { id: d.id, status: d.status, type_slug: d.type_slug, supplier: d.supplier_name,
    ref: d.reference_number, date: d.doc_date,
    total: finalVal(d.id, 'total') != null ? finalVal(d.id, 'total') : finalVal(d.id, 'total_amount'),
    subtotal: finalVal(d.id, 'subtotal') };
}
db.close();

function runP(folder, files) {
  const N = 8; const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const sf = shards.filter(x => x.length).map(names => w('shard', names));
  const one = shardFile => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile, '--mode', 'fast',
      '--tesseract', TESS, ...snapArgs], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(sf.map(one)).then(outs => {
    const docs = {}; for (const o of outs) for (const ln of o.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; }
    return docs;
  });
}
const ef = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e.value : (k && m[k] != null ? m[k] : null); };

(async () => {
  const res = await runP(RR, files);
  const F = ['supplier', 'ref', 'date', 'total', 'subtotal'];
  const fill = { supplier: 0, ref: 0, date: 0, total: 0, subtotal: 0, type: 0 };
  const confAcc = {}; for (const f of F) confAcc[f] = { ok: 0, n: 0 };
  const confRows = [], sampleRows = [];
  for (const fname of files) {
    const m = res[fname]; const g = gt[fname]; if (!m) continue;
    const rk = (roles[g.type_slug] || {}).ref, dk = (roles[g.type_slug] || {}).date;
    const detSlug = m._document_slug || nameToSlug[m.document_type] || null;
    const got = {
      type: m.document_type || null,
      supplier: m.supplier_name || ef(m, 'supplier_name'),
      ref: rk ? ef(m, rk) : (ef(m, 'invoice_number') || ef(m, 'reference_number')),
      date: dk ? ef(m, dk) : ef(m, 'invoice_date'),
      total: ef(m, 'total') != null ? ef(m, 'total') : ef(m, 'total_amount'),
      subtotal: ef(m, 'subtotal'),
    };
    if (got.supplier && String(got.supplier).trim()) fill.supplier++;
    if (got.ref && String(got.ref).trim()) fill.ref++;
    if (got.date && String(got.date).trim()) fill.date++;
    if (got.total != null && String(got.total).trim()) fill.total++;
    if (got.subtotal != null && String(got.subtotal).trim()) fill.subtotal++;
    if (detSlug) fill.type++;
    if (g.status === 'confirmed') {
      const s = {
        supplier: nSup(got.supplier) === nSup(g.supplier),
        ref: (g.ref != null) ? nRef(got.ref) === nRef(g.ref) : null,
        date: (g.date != null) ? nDate(got.date) === nDate(g.date) : null,
        total: (g.total != null) ? nMoney(got.total) === nMoney(g.total) : null,
        subtotal: (g.subtotal != null) ? nMoney(got.subtotal) === nMoney(g.subtotal) : null,
      };
      for (const f of F) { if (s[f] == null) continue; confAcc[f].n++; if (s[f]) confAcc[f].ok++; }
      const cell = (ok, want, gotv) => ok == null ? '-' : ok ? 'ok' : `MISS want '${want}' got '${gotv}'`;
      confRows.push(`- #${g.id} ${g.type_slug}: supplier ${cell(s.supplier, g.supplier, got.supplier)} · ref ${cell(s.ref, g.ref, got.ref)} · date ${cell(s.date, g.date, got.date)} · total ${cell(s.total, g.total, got.total)} · subtotal ${cell(s.subtotal, g.subtotal, got.subtotal)}`);
    }
    sampleRows.push(`#${g.id} [${g.status.slice(0, 4)}] ${m.document_type || '(untyped)'} | sup=${JSON.stringify(got.supplier || null)} ref=${JSON.stringify(got.ref || null)} date=${JSON.stringify(got.date || null)} total=${JSON.stringify(got.total != null ? String(got.total) : null)} subtotal=${JSON.stringify(got.subtotal != null ? String(got.subtotal) : null)} conf=${m.overall_confidence}`);
  }
  fs.rmSync(RR, { recursive: true, force: true });
  const pct = (o, n) => n ? (100 * o / n).toFixed(0) + '%' : '-';
  const nTot = files.length;
  const out = [];
  out.push(`# Reprocess report — ${nTot} docs reprocessed with CURRENT learning (${Object.keys(exByDoc).length} confirmed)`);
  out.push(`(${noFile} docs had no resolvable file.)\n`);
  out.push(`## Accuracy on the CONFIRMED docs (reprocess vs your confirmed values)`);
  out.push('| field | correct | scored | acc |'); out.push('|---|---|---|---|');
  for (const f of F) out.push(`| ${f} | ${confAcc[f].ok} | ${confAcc[f].n} | ${pct(confAcc[f].ok, confAcc[f].n)} |`);
  out.push(''); confRows.forEach(r => out.push(r));
  out.push(`\n## What all ${nTot} docs pull — fill rate`);
  out.push('| field | filled | of | % |'); out.push('|---|---|---|---|');
  for (const f of ['type', 'supplier', 'ref', 'date', 'total', 'subtotal']) out.push(`| ${f} | ${fill[f]} | ${nTot} | ${pct(fill[f], nTot)} |`);
  out.push(`\n## Per-doc pulled values (all ${nTot})`);
  sampleRows.forEach(r => out.push(r));
  const txt = out.join('\n');
  fs.writeFileSync(path.join(OUT, 'reprocess_report.md'), txt);
  // print the summary (not the full per-doc dump)
  console.log(out.slice(0, out.indexOf(`\n## Per-doc pulled values (all ${nTot})`) === -1 ? 60 : undefined).join('\n').split(`\n## Per-doc pulled values`)[0]);
  console.log(`\n(full per-doc list written to stress_test/out/reprocess_report.md — ${nTot} rows)`);
})();
