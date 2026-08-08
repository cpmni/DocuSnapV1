/** ref_role_digit_ab.js — REF_ROLE_DIGIT_GATE A/B over the REVIEW QUEUE.
 *
 *  WHY THIS EXISTS: realdoc_regression.js scores CONFIRMED documents, and a confirmed document by
 *  definition has a value someone accepted — so the caption-as-reference class this flag targets
 *  barely lives there (the armed realdoc lane was byte-identical on 714 docs). The captions live in
 *  the REVIEW QUEUE. This runs every needs_review document in two arms and diffs EVERY field, so
 *  both sides of the trade are visible: captions dropped (the win) and real codes lost (the risk).
 *
 *  Read-only: live DB opened readonly, documents run from temp copies, no writes.
 *  Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe stress_test/ref_role_digit_ab.js
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require('better-sqlite3');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null;
try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const w = (t, d) => { const f = path.join(os.tmpdir(), `rr_${t}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, d) => { try { return fn(); } catch { return d; } };
const ef = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e : {}; };
const sv = v => (v == null || v === '' ? '—' : String(v));
const DIGIT = /\d\S*\d/;

function runP(folder, args, files, manifest, extraEnv) {
  return new Promise(resolve => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', w('s', files),
      '--mode', 'smart', '--tesseract', TESS, '--reprocess-manifest', w('m', manifest), ...args],
      { windowsHide: true, env: { ...process.env, ...extraEnv } });
    let out = '';
    p.stdout.on('data', d => out += d);
    p.on('close', () => {
      const docs = {};
      for (const ln of out.split('\n')) {
        const t = ln.trim(); if (t[0] !== '{') continue;
        let m; try { m = JSON.parse(t); } catch { continue; }
        if (m.type === 'file_done') docs[m.original_filename] = m;
      }
      resolve(docs);
    });
  });
}

(async () => {
  const db = new Database(path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db'), { readonly: true });
  const rows = db.prepare(`SELECT id, working_path, stored_path, template_id,
                             (SELECT slug FROM document_types WHERE id=document_type_id) type_slug
                           FROM documents WHERE status='needs_review' ORDER BY id`).all();
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'refrole-'));
  const files = [], manifest = {}, idOf = {};
  for (const d of rows) {
    const src = (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : d.stored_path;
    if (!src || !fs.existsSync(src)) continue;
    const f = `doc${d.id}.pdf`;
    fs.copyFileSync(src, path.join(RR, f));
    manifest[f] = { known_template_id: d.template_id, known_doc_slug: d.type_slug };
    idOf[f] = d.id; files.push(f);
  }
  const dts = db.prepare('SELECT * FROM document_types').all();
  const fby = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (fby[f.document_type_id] ||= []).push(f);
  for (const t of dts) t.fields = fby[t.id] || [];
  const args = ['--fields-file', w('f', dts.flatMap(t => t.fields)),
    '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
    '--anchors-file', w('a', safe(() => learning.getAllAnchors(db), [])),
    '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
    '--doc-types-file', w('d', dts),
    '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
    '--templates-file', w('t', safe(() => templates.getAll(db), [])),
    '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
    '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
  db.close();
  console.log(`REF_ROLE_DIGIT_GATE A/B — ${files.length} needs_review documents\n`);

  const A = await runP(RR, args, files, manifest, {});
  const B = await runP(RR, args, files, manifest, { REF_ROLE_DIGIT_GATE: '1' });
  try { fs.rmSync(RR, { recursive: true, force: true }); } catch {}

  let dropped = 0, changed = 0, appeared = 0;
  const droppedVals = [];
  for (const f of files) {
    const a = A[f] || {}, b = B[f] || {};
    const keys = new Set([...Object.keys(a.extractions || {}), ...Object.keys(b.extractions || {})]);
    for (const k of keys) {
      const av = sv(ef(a, k).value), bv = sv(ef(b, k).value);
      if (av === bv) continue;
      if (bv === '—') {
        dropped++;
        droppedVals.push([idOf[f], k, av, ef(a, k).confidence, ef(a, k).method]);
      } else if (av === '—') { appeared++; console.log(`  #${idOf[f]} ${k}: — -> ${bv}   <<< APPEARED (unexpected)`); }
      else { changed++; console.log(`  #${idOf[f]} ${k}: ${av} -> ${bv}   <<< CHANGED (unexpected — this gate only drops)`); }
    }
  }

  console.log(`\n  DROPPED (value withheld -> field routes to review): ${dropped}`);
  // The whole judgement: every dropped value should FAIL the digit predicate, i.e. be a caption or
  // prose, never a real code. Any dropped value that CONTAINS a 2-digit spaceless run would mean the
  // gate is misfiring — print that separately and loudly.
  let captions = 0, codes = 0;
  for (const [id, k, v, c, m] of droppedVals) {
    const isCode = DIGIT.test(v);
    if (isCode) codes++; else captions++;
    console.log(`    #${id} ${k.padEnd(20)} ${String(v).padEnd(24)} conf=${String(c).padEnd(4)} ${String(m).slice(0, 26)}` +
                (isCode ? '   <<< A REAL CODE WAS DROPPED — GATE MISFIRE' : ''));
  }
  console.log(`\n  of the dropped: ${captions} caption/prose (the intended win) · ${codes} digit-bearing codes (MUST be 0)`);
  console.log(`  values CHANGED to a different value: ${changed} (must be 0 — this gate can only withhold)`);
  console.log(`  values APPEARED: ${appeared} (must be 0)`);
})();
