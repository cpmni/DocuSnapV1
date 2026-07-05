'use strict';
/*
 * Detection stress test — drives the REAL extraction (process_docs.py) and the
 * REAL learning modules (learning.saveCorrections / getFieldFormats, templates,
 * document_types) against a throwaway DB. No app code is modified.
 *
 * Loop: import all -> {submit one doc per type (confirm with ground truth) ->
 * reprocess all -> score vs ground truth + record confidence} until every doc is
 * fully correct at 100% confidence (or CYCLES cap).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/run_stress.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const REPO = 'c:/GIT Projects/Docusnap';
const ST = path.join(REPO, 'stress_test');
const CORPUS = path.join(ST, 'corpus');
const OUT = path.join(ST, 'out');
const DBPATH = path.join(ST, 'stress.db');
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const MODE = process.env.MODE || 'fast';
const CYCLES = parseInt(process.env.CYCLES || '8', 10);

const { runMigrations } = require(path.join(REPO, 'database', 'index.js'));
const documents = require(path.join(REPO, 'database', 'modules', 'documents.js'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const docTypes = require(path.join(REPO, 'database', 'modules', 'document_types.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const SCORED = {
  invoice:        { ref: 'invoice_number',      date: 'invoice_date' },
  sales_order:    { ref: 'sales_order_number',  date: 'order_date' },
  purchase_order: { ref: 'po_number',           date: 'po_date' },
};
const MONEY_FIELDS = ['subtotal', 'total_amount'];

// ── helpers ───────────────────────────────────────────────────────────────────
const normSupplier = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normMoney = (s) => { const m = String(s || '').replace(/[^0-9.]/g, ''); const v = parseFloat(m); return isNaN(v) ? null : v.toFixed(2); };
const normDate = (s) => String(s || '').trim();
const normRef = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');

function writeTempJson(tag, data) {
  const f = path.join(os.tmpdir(), `st_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(f, JSON.stringify(data));
  return f;
}

function buildSnapshot(db) {
  const allDocTypes = docTypes.getAllWithFields(db);
  const allHints = learning.getHints(db);
  const allAnchors = learning.getAllAnchors(db);
  const allLogos = learning.getAllLogos(db);
  const allTemplates = templates.getAll(db);
  let allFormats = []; try { allFormats = learning.getFieldFormats(db); } catch {}
  let allLO = []; try { allLO = labelOverrides ? labelOverrides.getForExtraction(db) : []; } catch {}
  let allFR = []; try { allFR = learning.getFieldRules(db); } catch {}
  const files = [];
  const w = (tag, d) => { const f = writeTempJson(tag, d); files.push(f); return f; };
  const args = [
    '--fields-file', w('fields', allDocTypes.flatMap(dt => dt.fields)),
    '--hints-file', w('hints', allHints),
    '--anchors-file', w('anchors', allAnchors),
    '--logos-file', w('logos', allLogos),
    '--doc-types-file', w('dt', allDocTypes),
    '--formats-file', w('formats', allFormats),
    '--templates-file', w('templates', allTemplates),
    '--label-overrides-file', w('lo', allLO),
    '--field-rules-file', w('fr', allFR),
    '--config-file', CFG,
    '--registration', '--born-digital', '--multiline',
  ];
  return { args, files, formatCount: allFormats.length };
}

const NSHARD = parseInt(process.env.NSHARD || '8', 10);

// Run process_docs across NSHARD parallel workers (round-robin file shards via
// --files-file), then merge file_done by filename. Mirrors the app's worker pool.
function runProcessParallel(snapshot, files) {
  const shards = Array.from({ length: NSHARD }, () => []);
  files.forEach((f, i) => shards[i % NSHARD].push(f));
  const shardFiles = shards.filter(s => s.length).map((names, k) => {
    const p = path.join(os.tmpdir(), `st_shard_${k}_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(p, JSON.stringify(names));
    return p;
  });
  const runOne = (shardFile) => new Promise((resolve) => {
    const args = ['-3.12', PROCESS_DOCS, '--folder', CORPUS, '--files-file', shardFile,
      '--mode', MODE, '--tesseract', TESS, '--ocr-threads', '1', ...snapshot.args];
    const proc = spawn('py', args, { windowsHide: true });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('close', () => resolve({ out, err }));
    proc.on('error', (e) => resolve({ out: '', err: String(e) }));
  });
  return Promise.all(shardFiles.map(runOne)).then((rs) => {
    for (const f of snapshot.files) { try { fs.unlinkSync(f); } catch {} }
    for (const f of shardFiles) { try { fs.unlinkSync(f); } catch {} }
    const docs = {}; let stderrAll = '';
    for (const r of rs) {
      stderrAll += r.err || '';
      for (const line of (r.out || '').split('\n')) {
        const s = line.trim(); if (!s || s[0] !== '{') continue;
        let m; try { m = JSON.parse(s); } catch { continue; }
        if (m.type === 'file_done') docs[m.original_filename] = m;
      }
    }
    if (Object.keys(docs).length === 0) console.error('parallel stderr:', stderrAll.slice(-800));
    return docs;
  });
}

// ── setup ───────────────────────────────────────────────────────────────────
function fresh() {
  for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(DBPATH + ext); } catch {} }
  const db = new Database(DBPATH);
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
  runMigrations(db);
  docTypes.seedBuiltInTypes(db);
  // add subtotal + total_amount currency fields to each of the 3 types
  const rows = db.prepare('SELECT id, slug FROM document_types').all();
  const slugToId = {};
  for (const r of rows) slugToId[r.slug] = r.id;
  for (const slug of Object.keys(SCORED)) {
    const id = slugToId[slug]; if (!id) continue;
    for (const [key, label] of [['subtotal', 'Subtotal'], ['total_amount', 'Total']]) {
      try { docTypes.addField(db, { document_type_id: id, key, label, type: 'currency', required: 0, sort_order: 40 }); } catch {}
    }
  }
  learning.setSetting(db, 'output_folder', OUT);
  return { db, slugToId };
}

function slugFromName(m, nameToSlug) {
  return m._document_slug || m.document_slug || nameToSlug[m.document_type] || null;
}

function extractField(m, key) {
  const e = m.extractions && m.extractions[key];
  if (e && typeof e === 'object') return e.value;
  return (m[key] != null ? m[key] : null);
}

function scoreDoc(truth, m, nameToSlug) {
  const detSlug = slugFromName(m, nameToSlug);
  const s = {};
  s.type = detSlug === truth.type_slug;
  s.supplier = normSupplier(m.supplier_name) === normSupplier(truth.company);
  s.ref = normRef(extractField(m, SCORED[truth.type_slug].ref)) === normRef(truth.ref);
  s.date = normDate(extractField(m, SCORED[truth.type_slug].date)) === normDate(truth.date);
  s.subtotal = normMoney(extractField(m, 'subtotal')) === normMoney('$' + truth.subtotal.toFixed(2));
  s.total_amount = normMoney(extractField(m, 'total_amount')) === normMoney('$' + truth.total.toFixed(2));
  s.conf = m.overall_confidence != null ? m.overall_confidence : 0;
  s.all = s.type && s.supplier && s.ref && s.date && s.subtotal && s.total_amount;
  s.perfect = s.all && s.conf >= 100;
  return s;
}

function moneyStr(v) { return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function main() {
  const truth = JSON.parse(fs.readFileSync(path.join(CORPUS, 'ground_truth.json'), 'utf8'));
  const allFiles = truth.map(t => t.filename);
  const byFile = {}; for (const t of truth) byFile[t.filename] = t;
  const { db, slugToId } = fresh();
  const nameToSlug = {};
  for (const r of db.prepare('SELECT name, slug FROM document_types').all()) nameToSlug[r.name] = r.slug;

  const log = [];
  const say = (s) => { console.log(s); log.push(s); };
  say(`# Detection stress test — ${truth.length} docs, mode=${MODE}, cap=${CYCLES} cycles`);
  say(`Corpus: ${truth.filter(t => t.variant === 'text').length} text + ${truth.filter(t => t.variant === 'scanned').length} scanned`);

  // ── IMPORT ──
  say(`\n## Import (cold, no learning)`);
  const snap0 = buildSnapshot(db);
  const imp = await runProcessParallel(snap0, allFiles);
  const idByFile = {};
  const phashByFile = {};
  for (const t of truth) {
    const m = imp[t.filename];
    if (!m) { say(`  MISSING import result: ${t.filename}`); continue; }
    phashByFile[t.filename] = m.logo_phash || null;
    const detSlug = slugFromName(m, nameToSlug);
    const info = documents.insert(db, {
      original_filename: t.filename, folder_path: CORPUS,
      document_type_id: slugToId[detSlug] || slugToId[t.type_slug] || null,
      supplier_name: m.supplier_name || null,
      overall_confidence: m.overall_confidence || null, status: 'needs_review',
      ocr_text: null, page_count: 1,
    });
    const id = info.lastInsertRowid;
    idByFile[t.filename] = id;
    const rows = [];
    for (const [k, e] of Object.entries(m.extractions || {})) {
      rows.push({ field_key: k, raw_value: e && e.value != null ? String(e.value) : null,
        display_value: e && e.value != null ? String(e.value) : null,
        confidence: e && e.confidence != null ? e.confidence : null,
        extraction_method: e && e.method || null, validation_note: e && e.validation_note || null });
    }
    if (rows.length) learning.insertExtractions(db, id, rows);
  }
  const scoreAll = (results) => {
    const per = { type: 0, supplier: 0, ref: 0, date: 0, subtotal: 0, total_amount: 0 };
    let allOk = 0, perfect = 0, confSum = 0, conf100 = 0, n = 0;
    const bad = [];
    for (const t of truth) {
      const m = results[t.filename]; if (!m) continue;
      const s = scoreDoc(t, m, nameToSlug); n++;
      for (const k of Object.keys(per)) if (s[k]) per[k]++;
      if (s.all) allOk++; if (s.perfect) perfect++;
      confSum += s.conf; if (s.conf >= 100) conf100++;
      if (!s.perfect) bad.push({ t, s, m });
    }
    return { per, allOk, perfect, confSum, conf100, n, bad };
  };
  const fmtRow = (label, r) => `| ${label} | ${r.perfect}/${r.n} | ${r.allOk}/${r.n} | ${(r.confSum / r.n).toFixed(1)}% | ${r.conf100}/${r.n} | ${r.per.type}/${r.n} | ${r.per.supplier}/${r.n} | ${r.per.ref}/${r.n} | ${r.per.date}/${r.n} | ${r.per.subtotal}/${r.n} | ${r.per.total_amount}/${r.n} |`;

  const rImp = scoreAll(imp);
  say('\n| Stage | 100%✓ | fields✓ | mean conf | conf=100 | type | supplier | ref | date | subtotal | total |');
  say('|---|---|---|---|---|---|---|---|---|---|---|');
  say(fmtRow('Import (cold)', rImp));

  // ── CYCLES ──
  const confirmedFiles = new Set();
  const unconfirmedByType = (slug) => truth.filter(t => t.type_slug === slug && !confirmedFiles.has(t.filename));
  let lastResults = imp;
  for (let cy = 1; cy <= CYCLES; cy++) {
    // submit one doc per type
    let submitted = 0;
    for (const slug of Object.keys(SCORED)) {
      const cand = unconfirmedByType(slug)[0]; if (!cand) continue;
      const id = idByFile[cand.filename]; if (!id) continue;
      const m = lastResults[cand.filename] || {};
      const sc = SCORED[slug];
      const gt = {
        supplier_name: cand.company, customer_name: cand.company,
        [sc.ref]: cand.ref, [sc.date]: cand.date,
        subtotal: moneyStr(cand.subtotal), total_amount: moneyStr(cand.total),
      };
      const corrections = {};
      for (const [k, v] of Object.entries(gt)) {
        const ex = extractField(m, k);
        if (String(ex || '').trim() !== String(v).trim()) corrections[k] = { original_value: ex == null ? '' : String(ex), corrected_value: String(v) };
      }
      documents.update(db, id, { supplier_name: cand.company, document_type_id: slugToId[slug] });
      learning.saveCorrections(db, id, corrections, cand.company, slug, gt, []);
      documents.confirmIfReviewable(db, id, { confirmed_by_username: 'tester' });
      // Persist the logo fingerprint the engine computed for this doc (the renderer's
      // save-logo-fingerprint step, done here with the engine's own phash so reprocess
      // matches consistently). ahash is stored but unused by findLogoMatch.
      const ph = phashByFile[cand.filename];
      if (ph) { try { learning.saveLogoFingerprint(db, { supplier_name: cand.company, phash: ph, ahash: ph }); } catch {} }
      confirmedFiles.add(cand.filename); submitted++;
    }
    const snap = buildSnapshot(db);
    const res = await runProcessParallel(snap, allFiles);
    lastResults = res;
    const r = scoreAll(res);
    say(fmtRow(`Cycle ${cy} (+${submitted} submit=${confirmedFiles.size} total, ${snap.formatCount} fmt groups)`, r));
    if (r.perfect === r.n) { say(`\n**All ${r.n} docs at 100% after ${confirmedFiles.size} submits / ${cy} reprocess cycles.**`); break; }
  }

  // ── final issue breakdown ──
  const rFinal = scoreAll(lastResults);
  say(`\n## Remaining imperfect docs (final cycle): ${rFinal.bad.length}`);
  const reasonTally = {};
  for (const b of rFinal.bad.slice(0, 40)) {
    const miss = ['type', 'supplier', 'ref', 'date', 'subtotal', 'total_amount'].filter(k => !b.s[k]);
    for (const k of miss) reasonTally[k] = (reasonTally[k] || 0) + 1;
    const detail = miss.map(k => {
      if (k === 'type') return `type[det=${slugFromName(b.m, nameToSlug)} want=${b.t.type_slug}]`;
      if (k === 'supplier') return `supplier[det='${b.m.supplier_name}' want='${b.t.company}']`;
      if (k === 'subtotal') return `subtotal[det='${extractField(b.m, 'subtotal')}' want='${moneyStr(b.t.subtotal)}']`;
      if (k === 'total_amount') return `total[det='${extractField(b.m, 'total_amount')}' want='${moneyStr(b.t.total)}']`;
      if (k === 'ref') return `ref[det='${extractField(b.m, SCORED[b.t.type_slug].ref)}' want='${b.t.ref}']`;
      if (k === 'date') return `date[det='${extractField(b.m, SCORED[b.t.type_slug].date)}' want='${b.t.date}']`;
      return k;
    });
    const confNote = b.s.all ? ` conf=${b.s.conf}%` : '';
    say(`  - ${b.t.variant}/${b.t.type_slug}/${b.t.company} ${b.t.ref}: ${detail.join(', ')}${confNote}`);
  }
  say(`\n### Miss tally by field (final): ${JSON.stringify(reasonTally)}`);

  fs.writeFileSync(path.join(OUT, 'results.md'), log.join('\n'));
  console.log('\nWrote', path.join(OUT, 'results.md'));
  db.close();
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
