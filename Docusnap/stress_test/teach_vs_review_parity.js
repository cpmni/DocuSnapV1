'use strict';
/* teach_vs_review_parity.js — proves the Teach/Template validator is (a) INDEPENDENT of Review's
 * detection pipe and (b) AT LEAST as good. For each docket it reads delivery_number TWICE through the
 * full pipeline:
 *   REVIEW pipe : templates DISABLED  -> value comes from keyword/anchor (Review's own path)
 *   TEACH  pipe : templates ENABLED + inline-code reconcile ON -> value comes from template_mapping
 * A DIFFERENT method on each side = genuinely separate pipelines (not the same detector echoed, which
 * would make the cross-check a false qualifier). Equal correct values = independent corroboration.
 * Read-only. Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/teach_vs_review_parity.js
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = process.env.RR_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}
const IDS = (process.env.PROBE_ID || '142,143,144,145,146,147,148,149,150,151').split(',').map(s => parseInt(s.trim(), 10));
const w = (t, d) => { const f = path.join(os.tmpdir(), `pv_${t}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, d) => { try { return fn(); } catch { return d; } };
const FMT = /^DN-\d{5}$/;

function snap(db, withTemplates) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {}; for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return ['--fields-file', w('f', dts.flatMap(d => d.fields)), '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
    '--anchors-file', w('a', safe(() => learning.getAllAnchors(db), [])), '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
    '--doc-types-file', w('d', dts), '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
    '--templates-file', w('t', withTemplates ? safe(() => templates.getAll(db), []) : []),
    '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
    '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
}

function run(db, files, folder, withTemplates, reconcile) {
  const snapArgs = snap(db, withTemplates);
  return new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--mode', 'fast', '--tesseract', TESS, ...snapArgs],
      { windowsHide: true, env: { ...process.env, TEMPLATE_INLINE_CODE_RECONCILE: reconcile } });
    let b = ''; p.stdout.on('data', d => b += d); p.stderr.on('data', () => {}); p.on('close', () => res(b)); p.on('error', () => res(''));
  }).then(out => {
    const done = {}; for (const ln of out.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') done[m.original_filename] = m; }
    return done;
  });
}
const del = m => { const e = (m && m.extractions || {})['delivery_number'] || {}; return { v: e.value || e.display_value || e.raw_value || (m && m.delivery_number) || '', method: e.method || '∅' }; };

(async () => {
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const FOLDER = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'));
  const resolveFile = d => (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
  const nameToId = {}; const files = [];
  for (const id of IDS) {
    const d = db.prepare('SELECT id, working_path, stored_path FROM documents WHERE id=?').get(id);
    const src = d && resolveFile(d); if (!src) continue;
    const fn = `doc${id}${path.extname(src) || '.pdf'}`; fs.copyFileSync(src, path.join(FOLDER, fn));
    nameToId[fn] = id; files.push(fn);
  }
  const review = await run(db, files, FOLDER, false, '0');   // templates OFF -> Review pipe
  const teach  = await run(db, files, FOLDER, true,  '1');   // templates ON + reconcile -> Teach pipe
  db.close();
  fs.rmSync(FOLDER, { recursive: true, force: true });

  console.log('\nid      REVIEW pipe (kw/anchor)            TEACH pipe (template_mapping)        indep?  agree?  teach>=review?');
  let indep = 0, agree = 0, teachOk = 0, reviewOk = 0, n = 0;
  for (const fn of files) {
    const id = nameToId[fn]; const r = del(review[fn]), t = del(teach[fn]); n++;
    const rOk = FMT.test(r.v), tOk = FMT.test(t.v);
    const isIndep = r.method !== t.method && r.method !== '∅' && t.method !== '∅';
    const isAgree = r.v && r.v === t.v;
    if (isIndep) indep++; if (isAgree) agree++; if (tOk) teachOk++; if (rOk) reviewOk++;
    console.log(String('#' + id).padEnd(7),
      `${(r.v || '∅').padEnd(11)}${('(' + r.method + ')').padEnd(22)}`,
      `${(t.v || '∅').padEnd(11)}${('(' + t.method + ')').padEnd(24)}`,
      (isIndep ? 'yes' : 'NO ').padEnd(7), (isAgree ? 'yes' : 'no ').padEnd(7), (tOk && tOk >= rOk ? 'yes' : (tOk ? 'yes' : 'NO')));
  }
  console.log(`\nindependent methods: ${indep}/${n}   values agree: ${agree}/${n}   correct: review ${reviewOk}/${n}, teach ${teachOk}/${n}`);
  console.log(`teach >= review: ${teachOk >= reviewOk ? 'YES' : 'NO'} (teach must not read fewer correctly than review)`);
})();
