'use strict';
/*
 * demo_supplier_learning.js — does a supplier's identity STICK once you confirm one document?
 *
 * THE QUESTION (owner, 2026-07-20): import each Demo Docs subfolder one at a time and check
 *   (1) COLD  — on the very first pass, with nothing learned, is the issuer read CORRECT, or is it
 *                wrong (assigned to a DIFFERENT supplier — the damaging case) or empty (→ review,
 *                the safe case)?
 *   (2) WARM  — after ONE document of that supplier+type is confirmed, do the remaining documents
 *                pick up the CORRECT supplier? They must not sit unmatched, and they must never
 *                DRIFT to a different supplier.
 *
 * The corpus is ground-truthed by its own layout: <Supplier Name>/<type>/<Supplier>_<type>_NN.pdf.
 *
 * FIDELITY. This drives the REAL pipeline (process_docs.py) with the REAL learned-snapshot args the
 * app builds, against a FRESH temp DB — so it reproduces a clean install, not the owner's trained
 * one. The WARM pass simulates a confirm the way the app does: supplier hints + logo fingerprint +
 * a template, written through the same JS modules the confirm path uses. It NEVER touches the live
 * DB and never writes into the Demo Docs folder.
 *
 * Run:  ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/demo_supplier_learning.js
 * Env:  DEMO_ROOT=<folder>   ONLY=<substring>   PER_TYPE=<n, default 6>   TYPES=<csv of type dirs>
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');

const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const CFG  = path.join(REPO, 'config', 'keyword_patterns.json');
const PROC = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const DEMO = process.env.DEMO_ROOT || path.join(os.homedir(), 'Desktop', 'Demo Docs');
const PER_TYPE = parseInt(process.env.PER_TYPE || '6', 10);

const dbmod     = require(path.join(REPO, 'database', 'index.js'));
const learning  = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
const doctypes  = require(path.join(REPO, 'database', 'modules', 'document_types.js'));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-sup-'));
const w = (tag, obj) => { const p = path.join(tmpDir, `${tag}.json`); fs.writeFileSync(p, JSON.stringify(obj)); return p; };
const safe = (fn, d) => { try { return fn(); } catch { return d; } };
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ── fresh DB: a clean install, plus the doc types this corpus needs ──────────────────────────
// ⚠ THE DB PATH MUST BE UNIQUE PER CALL. The first version of this used a constant filename, so
// every "fresh" DB re-opened the SAME file and learning ACCUMULATED across suppliers — which
// silently turned an isolated first-contact test into a cumulative one and produced cross-supplier
// results (a Marlowe PO resolving to "Copperfield Electrical", a company not on the page) that I
// then mis-attributed to page text. Isolation you assert but don't enforce is worse than none.
//
// ISOLATE=0 deliberately restores the cumulative behaviour, which is its own valid experiment: it
// models a real install where suppliers are added over time and CAN collide with each other.
let _dbSeq = 0;
function freshDb() {
  const f = process.env.ISOLATE === '0'
    ? path.join(tmpDir, 'shared.db')
    : path.join(tmpDir, `demo_${++_dbSeq}.db`);
  const db = new Database(f);
  dbmod.runMigrations(db);
  // ⚠ runMigrations creates ZERO document types and ZERO fields — the built-ins are seeded
  // separately (database/index.js seedDefaults → seedBuiltInTypes, not exported). A harness that
  // skips this runs every document against an EMPTY field set: "Stage 1: 0/0 fields found", no
  // invoice/PO/sales-order type exists at all, and any custom type's fields get applied to every
  // document (a purchase order matching a worksheet_date). Every number from such a run is void.
  doctypes.seedBuiltInTypes(db);
  // delivery_docket + worksheet are NOT built-in. Without them the corpus would exercise the
  // detected-but-not-installed hole instead of the identity question we're asking here.
  const ensure = (name, slug, ref, date) => {
    if (db.prepare('SELECT 1 FROM document_types WHERE slug = ?').get(slug)) return;
    const id = db.prepare('INSERT INTO document_types (name, slug, built_in, ref_field_key, date_field_key) VALUES (?,?,0,?,?)')
      .run(name, slug, ref, date).lastInsertRowid;
    const add = (k, l, t, r) => db.prepare('INSERT INTO fields (document_type_id, key, label, type, required) VALUES (?,?,?,?,?)').run(id, k, l, t, r ? 1 : 0);
    add('supplier_name', 'Document Issuer', 'text', 1);
    add(ref, ref.replace(/_/g, ' '), 'text', 0);
    add(date, date.replace(/_/g, ' '), 'date', 0);
    add('customer_name', 'Customer', 'text', 0);
  };
  ensure('Delivery Docket', 'delivery_docket', 'delivery_number', 'delivery_date');
  ensure('Worksheet',       'worksheet',       'worksheet_number', 'worksheet_date');
  // SELF-CHECK. A harness that measures against a mis-seeded DB reports confident nonsense, and
  // this one did: three separate runs were published before the missing seed was found. Fail loud
  // rather than measure quietly — every type must exist AND carry fields.
  const bad = db.prepare(`SELECT dt.slug, COUNT(f.id) n FROM document_types dt
                          LEFT JOIN fields f ON f.document_type_id = dt.id
                          GROUP BY dt.id HAVING n = 0`).all();
  const nTypes = db.prepare('SELECT COUNT(*) n FROM document_types').get().n;
  if (nTypes < 5 || bad.length) {
    console.error(`FATAL: fixture DB is not viable — ${nTypes} types, field-less: ${bad.map(b => b.slug).join(',') || 'none'}`);
    process.exit(3);
  }
  return db;
}

function snapshot(db) {
  const dts = safe(() => doctypes.getAllWithFieldsAll(db), []) || [];
  return ['--fields-file', w('f', dts.flatMap(d => d.fields || [])),
          '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
          '--anchors-file', w('a', safe(() => learning.getAllAnchors(db), [])),
          '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
          '--doc-types-file', w('d', dts),
          '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
          '--templates-file', w('t', safe(() => templates.getAll(db), [])),
          '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
          '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
}

function runBatch(folder, files, snapArgs) {
  return new Promise((resolve) => {
    const listFile = w(`files_${Math.abs(folder.length + files.length)}_${files[0]}`.replace(/[^a-z0-9_]/gi, ''), files);
    const out = [];
    const p = spawn('py', ['-3.12', PROC, '--folder', folder, '--files-file', listFile,
                           '--mode', 'fast', '--tesseract', TESS, ...snapArgs], { windowsHide: true });
    let buf = '';
    p.stdout.on('data', (c) => {
      buf += c.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        try { const m = JSON.parse(line); if (m.type === 'file_done') out.push(m); } catch {}
      }
    });
    p.stderr.on('data', () => {});
    p.on('close', () => resolve(out));
  });
}

// Simulate the app's CONFIRM for one document: the learning writes that make a supplier stick.
function simulateConfirm(db, msg, supplier, slug, folder) {
  const dt = db.prepare('SELECT id FROM document_types WHERE slug = ?').get(slug);
  const docId = db.prepare(
    `INSERT INTO documents (original_filename, folder_path, document_type_id, supplier_name, status,
                            overall_confidence, logo_phash, logo_detail_hash, keyword_fingerprint, ocr_text, confirmed_at)
     VALUES (?,?,?,?, 'confirmed', ?,?,?,?,?, datetime('now'))`
  ).run(msg.original_filename, folder, dt ? dt.id : null, supplier, msg.overall_confidence || 100,
        msg.logo_phash || null, msg.logo_detail_hash || null,
        msg.keyword_fingerprint ? JSON.stringify(msg.keyword_fingerprint) : null,
        msg.ocr_text || null).lastInsertRowid;

  const rows = [];
  for (const [k, v] of Object.entries(msg.extractions || {})) {
    const val = v && typeof v === 'object' ? v.value : v;
    // The operator's confirm asserts the CORRECT issuer even when the cold read got it wrong —
    // that is exactly the correction whose ripple we are testing.
    const finalV = (k === 'supplier_name') ? supplier : val;
    if (finalV == null || String(finalV).trim() === '') continue;
    rows.push({ field_key: k, raw_value: String(finalV), display_value: String(finalV),
                confidence: (v && v.confidence) || 90, extraction_method: (v && v.method) || 'keyword' });
  }
  if (!rows.some(r => r.field_key === 'supplier_name'))
    rows.push({ field_key: 'supplier_name', raw_value: supplier, display_value: supplier, confidence: 95, extraction_method: 'manual' });
  safe(() => learning.insertExtractions(db, docId, rows), null);
  for (const r of rows) safe(() => learning.saveHint(db, supplier, slug, r.field_key, r.display_value), null);
  if (msg.logo_phash) safe(() => learning.saveLogoFingerprint(db, { supplier_name: supplier, phash: msg.logo_phash, ahash: msg.logo_ahash || null }), null);
  safe(() => templates.create(db, {
    name: supplier, document_type_slug: slug,
    logo_phash: msg.logo_phash || null, logo_detail_hash: msg.logo_detail_hash || null,
    keyword_fingerprint: msg.keyword_fingerprint || [],
    fields: rows.filter(r => r.field_key === 'supplier_name')
                .map(r => ({ field_key: r.field_key, anchor_label: null, direction: 'right',
                             fixed_value: r.display_value, is_variable: false })),
  }), null);
  return docId;
}

const verdict = (got, want) => {
  const g = norm(got), t = norm(want);
  if (!g) return 'EMPTY';
  if (g === t || g.includes(t) || t.includes(g)) return 'OK';
  return 'WRONG';
};

(async () => {
  if (!fs.existsSync(DEMO)) { console.log(`Demo root not found: ${DEMO}`); process.exit(2); }
  const suppliers = fs.readdirSync(DEMO, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
    .filter(n => !process.env.ONLY || n.toLowerCase().includes(process.env.ONLY.toLowerCase()));
  const typeFilter = process.env.TYPES ? process.env.TYPES.split(',').map(s => s.trim()) : null;

  console.log(`Demo root: ${DEMO}`);
  console.log(`${suppliers.length} supplier folder(s); ${PER_TYPE} docs per type (1 confirmed, rest tested warm)\n`);

  const summary = [];
  for (const sup of suppliers) {
    const supDir = path.join(DEMO, sup);
    let types = fs.readdirSync(supDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    if (typeFilter) types = types.filter(t => typeFilter.includes(t));
    for (const type of types) {
      const dir = path.join(supDir, type);
      const files = fs.readdirSync(dir).filter(f => /\.(pdf|png|jpe?g)$/i.test(f)).sort().slice(0, PER_TYPE);
      if (!files.length) continue;
      const slug = type === 'delivery_docket' ? 'delivery_docket'
                 : type === 'worksheet' ? 'worksheet' : type;

      // A FRESH DB per supplier+type: nothing this supplier or any other has taught leaks in, so
      // the cold pass is a genuine first-contact read.
      const db = freshDb();
      // Record HOW the issuer was read, not just what — a wrong value's (method, label) pair is
      // what tells you whether to fix a caption, a guard, or a whole missing producer. Without it
      // the run says "54 wrong" and gives you nowhere to start.
      const how = (m) => { const e = (m.extractions || {}).supplier_name || {};
                           return `${e.method || '-'}${e.label ? '/' + e.label : ''}`; };
      const cold = await runBatch(dir, files, snapshot(db));
      const coldRes = cold.map(m => ({ file: m.original_filename, got: m.supplier_name || '',
                                       how: how(m), v: verdict(m.supplier_name, sup) }));

      // Confirm the FIRST document as the operator would, asserting the correct issuer.
      const first = cold.find(m => m.original_filename === files[0]) || cold[0];
      if (first) simulateConfirm(db, first, sup, slug, dir);

      const warm = await runBatch(dir, files.slice(1), snapshot(db));
      const warmRes = warm.map(m => ({ file: m.original_filename, got: m.supplier_name || '',
                                       how: how(m), v: verdict(m.supplier_name, sup) }));
      db.close();

      const c = (arr, k) => arr.filter(x => x.v === k).length;
      summary.push({ sup, type,
        coldOK: c(coldRes, 'OK'), coldEmpty: c(coldRes, 'EMPTY'), coldWrong: c(coldRes, 'WRONG'),
        warmOK: c(warmRes, 'OK'), warmEmpty: c(warmRes, 'EMPTY'), warmWrong: c(warmRes, 'WRONG'),
        wrongCold: coldRes.filter(x => x.v === 'WRONG'), wrongWarm: warmRes.filter(x => x.v === 'WRONG'),
        emptyWarm: warmRes.filter(x => x.v === 'EMPTY') });
      const s = summary[summary.length - 1];
      console.log(`${sup} / ${type}`);
      console.log(`   COLD (first contact): ${s.coldOK} ok · ${s.coldEmpty} empty · ${s.coldWrong} WRONG`);
      console.log(`   WARM (after 1 confirm): ${s.warmOK} ok · ${s.warmEmpty} empty · ${s.warmWrong} WRONG`);
      for (const x of s.wrongWarm) console.log(`      ✗ DRIFT ${x.file} -> "${x.got}"`);
      for (const x of s.emptyWarm) console.log(`      · unmatched ${x.file}`);
    }
  }

  // TRIAGE — group every WRONG read by HOW it was produced. Both advisors (reggie, 007) asked for
  // this before any new code: if the wrong reads concentrate on seller/vendor captions, the fix is
  // an existing guard plus config, not a new producer — a fraction of the blast radius.
  console.log('\n=========== WRONG READS BY METHOD/LABEL ===========');
  const byHow = new Map();
  for (const s of summary)
    for (const x of [...s.wrongCold, ...s.wrongWarm])
      byHow.set(x.how, (byHow.get(x.how) || 0) + 1);
  if (!byHow.size) console.log('  (none)');
  for (const [k, v] of [...byHow.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(v).padStart(4)}  ${k}`);

  console.log('\n================ SUMMARY ================');
  const tot = (k) => summary.reduce((a, s) => a + s[k], 0);
  console.log(`COLD: ${tot('coldOK')} ok · ${tot('coldEmpty')} empty · ${tot('coldWrong')} WRONG`);
  console.log(`WARM: ${tot('warmOK')} ok · ${tot('warmEmpty')} empty · ${tot('warmWrong')} WRONG`);
  const bad = summary.filter(s => s.warmWrong > 0);
  const stuck = summary.filter(s => s.warmEmpty > 0);
  if (bad.length) { console.log(`\nDRIFT after a confirm (the damaging failure) in ${bad.length} folder(s):`); for (const s of bad) console.log(`  ${s.sup} / ${s.type}: ${s.warmWrong}`); }
  if (stuck.length) { console.log(`\nStill unmatched after a confirm in ${stuck.length} folder(s):`); for (const s of stuck) console.log(`  ${s.sup} / ${s.type}: ${s.warmEmpty}`); }
  if (!bad.length && !stuck.length) console.log('\nPASS — every supplier stuck after one confirm, with no drift.');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
})();
