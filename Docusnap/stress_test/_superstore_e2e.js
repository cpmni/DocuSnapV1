'use strict';
/*
 * _superstore_e2e.js — E2E for the ISSUER positional-read DROP (condition #2, 2026-07-15).
 *
 * Reprocesses the 14 SuperStore needs_review docs whose issuer read is cross-supplier positional
 * junk (anchor_registration onto "Item"/"Shin To:"/a product row) through the LIVE pipeline with
 * the full learned snapshot, and reports each doc's resolved supplier_name (value/method/conf).
 *
 * PASS = every doc resolves to the CORRECT issuer (SuperStore, via logo/template_identity/keyword/
 * hint) OR to EMPTY (→ review), and NEVER to a different WRONG supplier.
 *
 * Set IDENTITY_POSITIONAL_DROP=0 to see the BEFORE (base) reads for comparison.
 * Read-only on the DB (never mutates). Session-local scratch — safe to delete.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/_superstore_e2e.js
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const TARGET_IDS = [265, 270, 271, 275, 279, 284, 286, 287, 288, 295, 296, 303, 306, 311];

const w = (tag, d) => { const f = path.join(os.tmpdir(), `ss_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };

function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return dts;
}

function snapArgs(db) {
  const dts = docTypesWithFields(db);
  return [
    '--fields-file', w('f', dts.flatMap(d => d.fields)),
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

function runP(folder, args, files) {
  const N = 6; const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const sf = shards.filter(x => x.length).map(names => w('shard', names));
  const one = shardFile => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile, '--mode', 'fast', '--tesseract', TESS, ...args], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(sf.map(one)).then(outs => {
    const docs = {}; for (const o of outs) for (const ln of o.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; }
    return docs;
  });
}

(async () => {
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const rows = db.prepare(`SELECT id, original_filename, stored_path, working_path FROM documents WHERE id IN (${TARGET_IDS.join(',')})`).all();
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-e2e-'));
  const resolveFile = d => (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
  const files = []; const idByFile = {};
  for (const d of rows) {
    const src = resolveFile(d); if (!src) { console.log(`#${d.id} NO FILE`); continue; }
    const fname = `doc${d.id}${path.extname(src) || '.pdf'}`;
    try { fs.copyFileSync(src, path.join(RR, fname)); files.push(fname); idByFile[fname] = d.id; } catch { console.log(`#${d.id} copy fail`); }
  }
  const args = snapArgs(db);
  db.close();

  const res = await runP(RR, args, files);
  fs.rmSync(RR, { recursive: true, force: true });

  const drop = process.env.IDENTITY_POSITIONAL_DROP === '0' ? 'BASE (drop OFF)' : 'FIX (drop ON)';
  console.log(`\n=== SuperStore issuer E2E — ${drop} ===`);
  console.log('id   | supplier_name        | method              | conf | needs_review | note?');
  console.log('-----|----------------------|---------------------|------|--------------|------');
  const wrong = [];
  for (const fname of files.sort((a, b) => idByFile[a] - idByFile[b])) {
    const m = res[fname]; const id = idByFile[fname];
    if (!m) { console.log(`#${id} NO RESULT`); continue; }
    const sn = (m.extractions && m.extractions.supplier_name) || {};
    const val = sn.value == null ? '(empty)' : sn.value;
    const method = sn.method || '';
    const conf = sn.confidence == null ? '-' : sn.confidence;
    const note = sn.validation_note ? 'Y' : '';
    console.log(`#${String(id).padEnd(4)}| ${String(val).padEnd(21).slice(0,21)}| ${String(method).padEnd(20).slice(0,20)}| ${String(conf).padEnd(5)}| ${String(!!m.needs_review).padEnd(13)}| ${note}`);
    if (process.env.DUMP_RAW) console.log(`      raw: ${JSON.stringify({anchor: sn.anchor, located: sn.located, label: sn.label, all_keys: Object.keys(sn)})}`);
    // A WRONG supplier = a non-empty value that is NOT SuperStore.
    const norm = String(val).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (val !== '(empty)' && norm && !norm.includes('superstore')) wrong.push(`#${id} '${val}' via ${method}`);
  }
  console.log('\nNon-empty NON-SuperStore issuer reads (must be 0):', wrong.length);
  for (const x of wrong) console.log('  WRONG:', x);
})();
