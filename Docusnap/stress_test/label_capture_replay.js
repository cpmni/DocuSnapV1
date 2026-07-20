'use strict';
/*
 * label_capture_replay.js — LABEL-AS-VALUE replay probe (permanent gate for the caption-capture class).
 *
 * WHY: `realdoc_regression.js` only replays CONFIRMED documents, so it is STRUCTURALLY BLIND to the
 * label-capture class — the 12 Ridgeway dockets that read their own "Deliver To" caption as the
 * customer sit in the review queue (unconfirmed) precisely BECAUSE the read is wrong. This probe
 * replays an arbitrary doc-id RANGE through the live pipeline with the live learning snapshot and
 * reports the NAME-field reads (value / method / confidence / review note), so a fix can be proven
 * to (a) stop committing the caption and (b) not lose the docs that already read correctly.
 *
 * PRIVACY / SAFETY: live DB opened STRICTLY READ-ONLY (never modified); files copied to a temp dir
 * that is deleted; output (real values) goes only to stress_test/out/ (gitignored).
 *
 * Run:  ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/label_capture_replay.js
 * Env:  REPLAY_IDS=81-100        doc-id range or comma list (default 81-100)
 *       REPLAY_TAG=baseline      names the output files (default 'run')
 *       REPLAY_FIELDS=customer_name,supplier_name   fields reported (default those two)
 *       plus any pipeline kill switches, which are inherited by the spawned python.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = path.resolve(__dirname, '..'), ST = path.join(REPO, 'stress_test');
const OUT = path.join(ST, 'out'), CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const TAG = process.env.REPLAY_TAG || 'run';
const FIELDS = (process.env.REPLAY_FIELDS || 'customer_name,supplier_name').split(',').map(s => s.trim()).filter(Boolean);
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
const w = (tag, d) => { const f = path.join(os.tmpdir(), `lc_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };

function parseIds(spec) {
  const out = [];
  for (const part of String(spec || '81-100').split(',')) {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.push(i); }
    else if (/^\d+$/.test(part.trim())) out.push(+part.trim());
  }
  return out;
}

// Doc-types + fields via DIRECT SQL — getAllWithFields runs repairStructuralRoles (a WRITE).
function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return dts;
}

// Identical snapshot to realdoc_regression.snap — same learning the live app hands the engine.
function snap(db) {
  const dts = docTypesWithFields(db);
  return { args: [
    '--fields-file', w('f', dts.flatMap(d => d.fields)),
    '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
    '--anchors-file', w('a', safe(() => learning.getAllAnchors(db), [])),
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
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile, '--mode', 'fast',
                           '--tesseract', TESS, ...snapArgs], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(sf.map(one)).then(outs => {
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
  if (!fs.existsSync(LIVE_DB)) { console.error('live DB not found:', LIVE_DB); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const ids = parseIds(process.env.REPLAY_IDS);
  const rows = db.prepare(`SELECT d.id, d.original_filename, d.status, d.stored_path, d.working_path, d.supplier_name,
                                  d.overall_confidence, dt.slug type_slug
                           FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
                           WHERE d.id IN (${ids.map(() => '?').join(',')}) ORDER BY d.id`).all(...ids);
  // Current DB reads (what the app shows today) — the "before" column, so a diff is self-contained.
  const cur = {};
  for (const e of db.prepare(`SELECT document_id, field_key, display_value, confidence, extraction_method, validation_note
                              FROM extractions WHERE document_id IN (${ids.map(() => '?').join(',')})`).all(...ids))
    (cur[e.document_id] || (cur[e.document_id] = {}))[e.field_key] = e;

  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'labelcap-'));
  const resolveFile = d => (d.working_path && fs.existsSync(d.working_path)) ? d.working_path
                         : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
  const byFile = {}; const files = []; let noFile = 0;
  for (const d of rows) {
    const src = resolveFile(d); if (!src) { noFile++; continue; }
    const fname = `doc${d.id}${path.extname(src) || '.pdf'}`;
    try { fs.copyFileSync(src, path.join(RR, fname)); } catch { noFile++; continue; }
    files.push(fname); byFile[fname] = d;
  }
  const res = await runP(RR, snap(db).args, files);
  try { fs.rmSync(RR, { recursive: true, force: true }); } catch {}

  const recs = [];
  for (const fname of files) {
    const m = res[fname], d = byFile[fname];
    const rec = { id: d.id, file: d.original_filename, status: d.status, ok: !!m,
                  type: m ? m.document_type : null, conf: m ? m.overall_confidence : null, fields: {} };
    for (const k of FIELDS) {
      const e = m && m.extractions ? m.extractions[k] : null;
      const c = (cur[d.id] || {})[k] || null;
      rec.fields[k] = {
        was: c ? c.display_value : null, was_method: c ? c.extraction_method : null, was_conf: c ? c.confidence : null,
        now: e && typeof e === 'object' ? e.value : (e != null ? e : null),
        method: e && typeof e === 'object' ? e.method : null,
        confidence: e && typeof e === 'object' ? e.confidence : null,
        note: e && typeof e === 'object' ? (e.validation_note || null) : null,
      };
    }
    recs.push(rec);
  }

  const jsonPath = path.join(OUT, `label_capture_replay_${TAG}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(recs, null, 1));
  const L = [];
  L.push(`# label-capture replay — tag='${TAG}'  ids=${ids[0]}..${ids[ids.length - 1]}  docs=${recs.length}${noFile ? `  (no-file: ${noFile})` : ''}`);
  L.push('');
  for (const k of FIELDS) {
    L.push(`## ${k}`);
    L.push('| doc | status | was (db) | now (replay) | method | conf | note |');
    L.push('|---|---|---|---|---|---|---|');
    for (const r of recs) {
      const f = r.fields[k];
      const chg = String(f.was || '') === String(f.now || '') ? '' : ' **Δ**';
      L.push(`| ${r.id} | ${r.status} | ${f.was || '—'} | ${f.now || '—'}${chg} | ${f.method || '—'} | ${f.confidence != null ? f.confidence : '—'} | ${(f.note || '').replace(/\|/g, '/')} |`);
    }
    L.push('');
  }
  const mdPath = path.join(OUT, `label_capture_replay_${TAG}.md`);
  fs.writeFileSync(mdPath, L.join('\n'));
  console.log(L.join('\n'));
  console.log(`\nwrote ${mdPath}\nwrote ${jsonPath}`);
})();
