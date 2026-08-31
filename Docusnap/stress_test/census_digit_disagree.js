'use strict';
/*
 * census_digit_disagree.js — D1 pre-build census (Oracle condition, 2026-08-01).
 *
 * Measures the fire-rate of the PROPOSED in-band digit-disagreement flag over the whole
 * confirmed corpus BEFORE the arm is built: for every confirmed doc's ref-role field,
 * re-runs the live pipeline with --trace and applies the D1 predicate offline —
 * winner vs distinct-stage candidate-ledger reads with an identical non-digit skeleton,
 * same length, differing at 1..MAX_DIGIT_DIFF digit positions.
 *
 * Verdict bar (Oracle): false-fires (winner already == GT) ≤3% of scored docs HARD,
 * ≤2% target; pre-agreed tightener to 1 digit position if the 2-digit rate exceeds it.
 * Reports BOTH variants + the witness-confidence distribution (sets the conf floor).
 *
 * PRIVACY/SAFETY: live DB opened READ-ONLY; files copied to temp dirs; output (real
 * values) only to stress_test/out/ (gitignored). The script itself carries no data.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/census_digit_disagree.js
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const REPO = path.join(__dirname, '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const OUT = path.join(__dirname, 'out');
const CHUNK = 25, LANES = 3, MAX_DIGIT_DIFF = 2;
// Pixels-verified printed truth for confirmed rows known to be GT-poison (Oracle 2026-08-01
// reclassification; exhibits in out/stroke_sub_2026-08-01/zooms). Classification only — the
// DB is untouched; remove entries once the owner remediates via Learning Repair.
const PRINTED_TRUTH = { 154: 'DN-38884', 285: 'WS-43842' };

const norm = s => String(s || '').toUpperCase().replace(/\s+/g, '');
const isDig = c => c >= '0' && c <= '9';
// D1 skeleton comparator: same length, identical at every non-digit position (both sides
// non-digit and equal), digit positions aligned (both digits), count of differing digits.
// Returns -1 when the skeletons differ, else the digit-diff count (0 = identical value).
function digitDiff(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const da = isDig(a[i]), db = isDig(b[i]);
    if (da && db) { if (a[i] !== b[i]) d++; continue; }
    if (a[i] !== b[i]) return -1;
  }
  return d;
}
const w = (tag, data) => { const f = path.join(os.tmpdir(), `cen_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(data)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };

const db = new Database(path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db'), { readonly: true, fileMustExist: true });
function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return dts;
}
const dts = docTypesWithFields(db);
const roles = {}; for (const r of db.prepare('SELECT slug, ref_field_key FROM document_types').all()) roles[r.slug] = r.ref_field_key;
const snapArgs = [
  '--fields-file', w('f', dts.flatMap(x => x.fields)),
  '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
  '--anchors-file', w('a', safe(() => learning.getAllAnchors(db), [])),
  '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
  '--doc-types-file', w('d', dts),
  '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
  '--templates-file', w('t', safe(() => templates.getAll(db), [])),
  '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
  '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
  '--config-file', CFG, '--registration', '--born-digital', '--multiline',
];
const docs = db.prepare(`SELECT d.id, d.stored_path, d.working_path, d.reference_number, dt.slug type_slug
  FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
  WHERE d.status = 'confirmed'`).all()
  .map(d => {
    d.ref_key = roles[d.type_slug] || null;
    d.src = (d.working_path && fs.existsSync(d.working_path)) ? d.working_path
          : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
    return d;
  })
  .filter(d => d.src && d.ref_key && norm(d.reference_number));
db.close();
console.log(`census: ${docs.length} confirmed docs with a ref role + file present`);

const chunks = [];
for (let i = 0; i < docs.length; i += CHUNK) chunks.push(docs.slice(i, i + CHUNK));

function runChunk(chunk, ci) {
  return new Promise(resolve => {
    const RR = fs.mkdtempSync(path.join(os.tmpdir(), `cen${ci}-`));
    const names = {};
    for (const d of chunk) {
      const fname = `doc${d.id}${path.extname(d.src) || '.pdf'}`;
      fs.copyFileSync(d.src, path.join(RR, fname));
      names[fname] = d;
    }
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', RR, '--files-file', w('s', Object.keys(names)),
      '--mode', 'fast', '--tesseract', TESS, '--trace', '--file-timeout', '240', ...snapArgs],
      { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let buf = ''; const perDoc = {};   // fname -> {final, cands:[]}
    let cur = null;
    p.stdout.on('data', ch => {
      buf += ch;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (line[0] !== '{') continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type === 'file_begin') { cur = m.filename; perDoc[cur] = { final: null, cands: [] }; }
        else if (m.type === 'trace' && m.event === 'candidate') {
          const rec = perDoc[m.doc || cur];
          const d = names[m.doc || cur];
          if (rec && d && m.field === d.ref_key && m.value)
            rec.cands.push({ stage: m.stage, method: m.method, value: String(m.value), conf: m.confidence || 0 });
        } else if (m.type === 'file_done') {
          const rec = perDoc[m.original_filename || cur];
          if (rec) {
            const ex = (m.extractions || {})[names[m.original_filename || cur].ref_key];
            rec.final = ex ? { value: ex.value, conf: ex.confidence, method: ex.method, note: ex.validation_note || null } : null;
          }
        }
      }
    });
    let err = ''; p.stderr.on('data', ch => { err += ch; });
    p.on('close', code => {
      try { fs.rmSync(RR, { recursive: true, force: true }); } catch {}
      if (code !== 0) console.log(`chunk ${ci}: exit ${code} ${String(err).slice(-300)}`);
      resolve({ names, perDoc });
    });
  });
}

(async () => {
  const t0 = Date.now();
  const results = [];
  let next = 0, done = 0;
  async function lane() {
    while (next < chunks.length) {
      const ci = next++;
      const r = await runChunk(chunks[ci], ci);
      results.push(r);
      done++;
      console.log(`chunk ${ci + 1}/${chunks.length} done (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(LANES, chunks.length) }, lane));

  // ── offline D1 predicate ──
  const fires = [], noFinal = [];
  let scored = 0;
  for (const { names, perDoc } of results) {
    for (const [fname, d] of Object.entries(names)) {
      const rec = perDoc[fname];
      if (!rec || !rec.final || !rec.final.value) { noFinal.push(d.id); continue; }
      scored++;
      const W = norm(rec.final.value);
      const gt = norm(PRINTED_TRUTH[d.id] || d.reference_number);
      // winner's producing stage = the candidate event matching value+method (if any)
      const winEv = rec.cands.find(c => norm(c.value) === W && c.method === rec.final.method);
      const winStage = winEv ? winEv.stage : null;
      // strongest distinct-stage witness per distinct value
      const byVal = {};
      for (const c of rec.cands) {
        const V = norm(c.value);
        if (!V || V === W) continue;
        if (winStage && c.stage === winStage) continue;
        const diff = digitDiff(W, V);
        if (diff < 1 || diff > MAX_DIGIT_DIFF) continue;
        if (!byVal[V] || c.conf > byVal[V].conf) byVal[V] = { ...c, diff };
      }
      for (const [V, c] of Object.entries(byVal)) {
        fires.push({
          doc: d.id, winner: rec.final.value, winner_conf: rec.final.conf, winner_method: rec.final.method,
          witness: c.value, witness_conf: c.conf, witness_stage: c.stage, witness_method: c.method,
          digit_diff: c.diff, gt: gt,
          verdict: W === gt ? 'FALSE_FIRE' : (V === gt ? 'TRUE_CATCH' : 'BOTH_WRONG'),
          poison_adjusted: d.id in PRINTED_TRUTH,
        });
      }
    }
  }
  const firedDocs = new Set(fires.map(f => f.doc));
  const ffDocs = new Set(fires.filter(f => f.verdict === 'FALSE_FIRE').map(f => f.doc));
  const fires1 = fires.filter(f => f.digit_diff === 1);
  const ffDocs1 = new Set(fires1.filter(f => f.verdict === 'FALSE_FIRE').map(f => f.doc));
  const pct = n => (100 * n / Math.max(1, scored)).toFixed(2) + '%';
  const lines = [];
  lines.push(`# D1 digit-disagreement census — ${new Date().toISOString()}`);
  lines.push(`Docs scored: ${scored} (no final ref on: ${noFinal.length ? noFinal.join(',') : 'none'})`);
  lines.push(``);
  lines.push(`## ≤${MAX_DIGIT_DIFF}-digit variant: ${fires.length} fires on ${firedDocs.size} docs (${pct(firedDocs.size)}) — FALSE fires ${ffDocs.size} docs (${pct(ffDocs.size)})`);
  lines.push(`## 1-digit-only variant: ${fires1.length} fires on ${new Set(fires1.map(f => f.doc)).size} docs — FALSE fires ${ffDocs1.size} docs (${pct(ffDocs1.size)})`);
  lines.push(`Bar: FALSE ≤3% hard / ≤2% target.`);
  lines.push(``);
  lines.push(`| doc | verdict | diff | winner (m@c) | witness (stage/m@c) | GT |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const f of fires.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.doc - b.doc))
    lines.push(`| ${f.doc}${f.poison_adjusted ? '*' : ''} | ${f.verdict} | ${f.digit_diff} | ${f.winner} (${f.winner_method}@${f.winner_conf}) | ${f.witness} (${f.witness_stage}/${f.witness_method}@${f.witness_conf}) | ${f.gt} |`);
  lines.push(``);
  lines.push(`(*) = poison-adjusted GT (printed-truth override, pixels-verified).`);
  lines.push(`Witness-conf distribution (all fires): ${fires.map(f => f.witness_conf).sort((a, b) => a - b).join(', ') || 'n/a'}`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'census_digit_disagree.json'), JSON.stringify({ scored, noFinal, fires }, null, 1));
  fs.writeFileSync(path.join(OUT, 'census_digit_disagree.md'), lines.join('\n'));
  console.log(lines.slice(0, 8).join('\n'));
  console.log(`full report: stress_test/out/census_digit_disagree.md (${((Date.now() - t0) / 60000).toFixed(1)} min total)`);
})();
