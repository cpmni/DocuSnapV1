'use strict';
/*
 * realdoc_regression.js — REAL-DOC regression corpus.
 *
 * Reprocesses the user's own CONFIRMED documents through the live pipeline and scores the
 * result against their CONFIRMED (ground-truth) values, so the exact real cases that exposed
 * bugs (City Office et al.) are permanently guarded: a code change that makes the pipeline
 * mis-read a doc it previously filed correctly shows up here as a regression.
 *
 * PRIVACY / SAFETY (this touches real business data):
 *   - The live DB is opened STRICTLY READ-ONLY; doc-types are read via direct SQL to avoid
 *     getAllWithFields' repair WRITE. The DB is never modified.
 *   - Files are copied to a TEMP dir, reprocessed, and the temp dir is deleted.
 *   - Output (which contains real values) goes only to stress_test/out/ (gitignored). NEVER
 *     commit it. This script itself carries no data — safe to commit.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/realdoc_regression.js
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap', ST = path.join(REPO, 'stress_test');
const OUT = path.join(ST, 'out'), CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const normSupplier = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normRef = s => String(s || '').toUpperCase().replace(/\s+/g, '');
const normMoney = s => { const v = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return isNaN(v) ? null : v.toFixed(2); };
const normDate = s => String(s || '').replace(/[^0-9]/g, '');   // digit-strip: tolerant of separator format
const w = (tag, d) => { const f = path.join(os.tmpdir(), `rr_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };

// Doc-types + fields via DIRECT SQL — getAllWithFields runs repairStructuralRoles (a WRITE),
// which would throw on a read-only handle. This reproduces its {..., fields:[...]} shape read-only.
function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return dts;
}

function snap(db) {
  const dts = docTypesWithFields(db);
  let anchors = safe(() => learning.getAllAnchors(db), []);
  // Ablation: NO_IDENTITY_ANCHORS=1 drops supplier_name/customer_name anchors — proves whether
  // an identity anchor (which is supplier-specific) is helping or hurting when swept cross-supplier.
  if (process.env.NO_IDENTITY_ANCHORS) anchors = anchors.filter(a => !['supplier_name', 'customer_name'].includes(a.field_key));
  return { args: [
    '--fields-file', w('f', dts.flatMap(d => d.fields)),
    '--hints-file', w('h', safe(() => learning.getHints(db), [])),
    '--anchors-file', w('a', anchors),
    '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
    '--doc-types-file', w('d', dts),
    '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
    '--templates-file', w('t', safe(() => templates.getAll(db), [])),
    '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
    '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'] };
}

function runP(folder, snapArgs, files) {
  const N = 8; const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const sf = shards.filter(x => x.length).map(names => w('shard', names));
  const one = shardFile => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile, '--mode', 'fast', '--tesseract', TESS, '--ocr-threads', '1', ...snapArgs], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(sf.map(one)).then(outs => {
    const docs = {}; for (const o of outs) for (const ln of o.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; }
    return docs;
  });
}
const ef = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e.value : (k && m[k] != null ? m[k] : null); };

(async () => {
  if (!fs.existsSync(LIVE_DB)) { console.error('live DB not found:', LIVE_DB); process.exit(1); }
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const nameToSlug = {}; for (const r of db.prepare('SELECT name, slug FROM document_types').all()) nameToSlug[r.name] = r.slug;
  const roles = {}; for (const r of db.prepare('SELECT slug, ref_field_key, date_field_key FROM document_types').all()) roles[r.slug] = { ref: r.ref_field_key, date: r.date_field_key };
  const conf = db.prepare(`SELECT d.id, d.supplier_name, d.reference_number, d.doc_date, d.stored_path, d.working_path, dt.slug type_slug
    FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id WHERE d.status = 'confirmed'`).all();
  const exByDoc = {};
  for (const e of db.prepare(`SELECT e.document_id, e.field_key, e.display_value FROM extractions e JOIN documents d ON d.id = e.document_id WHERE d.status = 'confirmed'`).all())
    (exByDoc[e.document_id] || (exByDoc[e.document_id] = {}))[e.field_key] = e.display_value;

  // Stage the confirmed files into a temp folder keyed by doc<id><ext> (map back by filename).
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'realdoc-'));
  const resolveFile = d => (d.working_path && fs.existsSync(d.working_path)) ? d.working_path
                         : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
  const gt = {}; const files = []; let noFile = 0;
  for (const d of conf) {
    const src = resolveFile(d); if (!src) { noFile++; continue; }
    const fname = `doc${d.id}${path.extname(src) || '.pdf'}`;
    try { fs.copyFileSync(src, path.join(RR, fname)); } catch { noFile++; continue; }
    files.push(fname);
    const ex = exByDoc[d.id] || {};
    gt[fname] = { id: d.id, type_slug: d.type_slug, supplier: d.supplier_name, ref: d.reference_number, date: d.doc_date,
                  total: ex.total != null ? ex.total : ex.total_amount, subtotal: ex.subtotal };
  }
  const snapObj = snap(db);
  const res = await runP(RR, snapObj.args, files);

  const F = ['type', 'supplier', 'ref', 'date', 'total', 'subtotal'];
  const acc = {}; for (const f of F) acc[f] = { ok: 0, n: 0 };
  const regress = [];
  let silentWrong = 0;
  for (const fname of files) {
    const m = res[fname]; const g = gt[fname]; if (!m) continue;
    const rk = (roles[g.type_slug] || {}).ref, dk = (roles[g.type_slug] || {}).date;
    const detSlug = m._document_slug || nameToSlug[m.document_type] || null;
    const s = {
      type: detSlug === g.type_slug,
      supplier: normSupplier(m.supplier_name) === normSupplier(g.supplier),
      ref: (rk && g.ref != null) ? normRef(ef(m, rk)) === normRef(g.ref) : null,
      date: (dk && g.date != null) ? normDate(ef(m, dk)) === normDate(g.date) : null,
      total: g.total != null ? normMoney(ef(m, 'total') != null ? ef(m, 'total') : ef(m, 'total_amount')) === normMoney(g.total) : null,
      subtotal: g.subtotal != null ? normMoney(ef(m, 'subtotal')) === normMoney(g.subtotal) : null,
    };
    for (const f of F) { if (s[f] == null) continue; acc[f].n++; if (s[f]) acc[f].ok++; }
    // Regressions on the filing-critical fields; flag whether the wrong read carried a review note (SILENT = didn't).
    for (const [f, key, want] of [['supplier', 'supplier_name', g.supplier], ['ref', rk, g.ref], ['date', dk, g.date]]) {
      if (s[f] === false) {
        const exr = key && m.extractions && m.extractions[key];
        const got = f === 'supplier' ? m.supplier_name : ef(m, key);
        // A wrong value is only truly SILENT if it carries NO review note AND is above the
        // review threshold (70) — i.e. it would actually auto-file. Below-threshold reads
        // surface as needs-a-check in the app, so they're caught, not silent.
        const flagged = !!(exr && (String(exr.validation_note || '').trim() || (exr.confidence != null && exr.confidence < 70)));
        if (!flagged) silentWrong++;
        regress.push(`#${g.id} ${g.type_slug} ${f}: want '${want}' got '${got}'${flagged ? ' [flagged]' : ' [SILENT]'}`);
      }
    }
  }
  fs.rmSync(RR, { recursive: true, force: true });
  db.close();

  const pct = (o, n) => n ? (100 * o / n).toFixed(1) + '%' : '-';
  const out = [];
  out.push(`# Real-doc regression — ${files.length} confirmed docs reprocessed vs their confirmed values`);
  out.push(`(${noFile} confirmed docs had no resolvable file and were skipped.)\n`);
  out.push('| Field | correct | scored | accuracy |');
  out.push('|---|---|---|---|');
  for (const f of F) out.push(`| ${f} | ${acc[f].ok} | ${acc[f].n} | ${pct(acc[f].ok, acc[f].n)} |`);
  out.push(`\n**Regressions (a confirmed value the pipeline no longer reproduces): ${regress.length}** — of which ${silentWrong} SILENT (wrong + no review flag).`);
  for (const r of regress.slice(0, 60)) out.push(`- ${r}`);
  const txt = out.join('\n');
  fs.writeFileSync(path.join(OUT, 'realdoc_regression.md'), txt);
  console.log(txt);

  if (process.env.GATE === '1' && silentWrong > 0) process.exit(1);   // any SILENT real-doc regression fails the gate
})();
