'use strict';
/* live_identity_shadow.js — READ-ONLY identity_fusion shadow measurement over the LIVE DB.
 * For each CONFIRMED doc, re-run process_docs --identity-shadow over its filed PDF with the REAL
 * learned gazetteer (logos/hints/anchors), and compare the text-led supplier against the CONFIRMED
 * supplier (ground truth). The live DB is opened READ-ONLY (cannot write); each filed PDF is COPIED
 * to a temp staging dir before processing, so originals are never touched. Definitive real-doc test.
 * Run (PowerShell):
 *   $env:ELECTRON_RUN_AS_NODE=1; & node_modules/electron/dist/electron.exe stress_test/live_identity_shadow.js
 *   LIVE_DB=<path>  LIMIT=n (random-sample cap; default = all)  MODE=fast|smart
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const REPO = 'c:/GIT Projects/Docusnap';
const LIVE_DB = process.env.LIVE_DB || path.join(os.homedir(), 'AppData', 'Roaming', 'ScanFinder', 'docusnap.db');
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const MODE = process.env.MODE || 'fast';
const CAP = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 0;   // 0 = all
const STAGE = path.join(os.tmpdir(), 'live_shadow_stage');
const OUT = path.join(REPO, 'stress_test', 'out'); fs.mkdirSync(OUT, { recursive: true });

const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';

if (!fs.existsSync(LIVE_DB)) { console.error('LIVE DB not found:', LIVE_DB); process.exit(2); }
const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });   // READ-ONLY — cannot write

const wj = (tag, d) => { const f = path.join(os.tmpdir(), `live_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, def) => { try { return fn(); } catch (e) { console.warn('  (getter fell back):', String(e.message).slice(0, 100)); return def; } };

function snapshot() {
  // doc types + fields via raw SELECT (NOT getAllWithFields — it can WRITE via repairStructuralRoles)
  const dtRows = db.prepare('SELECT id,name,slug,built_in,ref_field_key,date_field_key FROM document_types').all();
  const fieldRows = db.prepare('SELECT id,document_type_id,key,label,type,required,built_in,sort_order FROM fields').all();
  const byType = {}; for (const f of fieldRows) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  const dts = dtRows.map(d => ({ ...d, fields: byType[d.id] || [] }));
  const hints = safe(() => learning.getHints(db), []);
  const anchors = safe(() => learning.getAllAnchors(db), []);
  const logos = safe(() => learning.getAllLogos(db), []);
  const fmt = safe(() => learning.getFieldFormats(db), []);
  const fr = safe(() => learning.getFieldRules(db), []);
  const lo = safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], []);
  const tpl = safe(() => templates.getAll(db), []);
  const args = ['--fields-file', wj('f', fieldRows), '--hints-file', wj('h', hints),
    '--anchors-file', wj('a', anchors), '--logos-file', wj('l', logos),
    '--doc-types-file', wj('d', dts), '--formats-file', wj('fm', fmt), '--templates-file', wj('t', tpl),
    '--label-overrides-file', wj('lo', lo), '--field-rules-file', wj('fr', fr), '--config-file', CFG,
    '--registration', '--born-digital', '--multiline'];
  return { args, nLogos: logos.length, nHints: hints.length, nAnchors: anchors.length };
}

function pickPath(d) {
  for (const p of [d.working_path, d.stored_path]) if (p && fs.existsSync(p)) return p;
  if (d.folder_path && d.stored_filename) { const p = path.join(d.folder_path, d.stored_filename); if (fs.existsSync(p)) return p; }
  return null;
}

function shardRun(args, folder, files) {
  const N = 8; const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const one = names => new Promise(res => {
    const sf = wj('shard', names);
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', sf, '--mode', MODE,
      '--tesseract', TESS, '--identity-shadow', ...args], { windowsHide: true, env: { ...process.env, OMP_THREAD_LIMIT: '1' } });
    let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', () => { try { fs.unlinkSync(sf); } catch {} res({ out, err }); }); p.on('error', e => res({ out: '', err: String(e) }));
  });
  return Promise.all(shards.filter(s => s.length).map(one)).then(rs => {
    const docs = {}; let errAll = '';
    for (const r of rs) { errAll += r.err || ''; for (const ln of (r.out || '').split('\n')) { const s = ln.trim(); if (s[0] !== '{') continue; let m; try { m = JSON.parse(s); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; } }
    if (!Object.keys(docs).length) console.error('EXTRACTION STDERR tail:', errAll.slice(-1500));
    return docs;
  });
}

(async () => {
  const snap = snapshot();
  const rows = db.prepare("SELECT id,supplier_name,stored_path,working_path,folder_path,stored_filename FROM documents WHERE status='confirmed' AND supplier_name IS NOT NULL AND TRIM(supplier_name)<>''").all();
  const totalConfirmed = rows.length;
  let docs = []; for (const d of rows) { const f = pickPath(d); if (f) docs.push({ ...d, file: f }); }
  const resolvable = docs.length;
  let sampled = false;
  if (CAP && docs.length > CAP) { for (let i = docs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [docs[i], docs[j]] = [docs[j], docs[i]]; } docs = docs.slice(0, CAP); sampled = true; }
  fs.rmSync(STAGE, { recursive: true, force: true }); fs.mkdirSync(STAGE, { recursive: true });
  for (const d of docs) { const ext = path.extname(d.file) || '.pdf'; d.staged = `${d.id}${ext}`; try { fs.copyFileSync(d.file, path.join(STAGE, d.staged)); } catch { d.staged = null; } }
  docs = docs.filter(d => d.staged);
  console.log(`Live DB: ${LIVE_DB}`);
  console.log(`Confirmed w/ supplier ${totalConfirmed} · resolvable ${resolvable} · ${sampled ? `RANDOM SAMPLE ${docs.length}` : `processing ${docs.length}`}`);
  console.log(`Gazetteer: logos ${snap.nLogos} · hints ${snap.nHints} · anchors ${snap.nAnchors}`);
  if (!docs.length) { console.log('nothing to process'); process.exit(0); }

  const res = await shardRun(snap.args, STAGE, docs.map(d => d.staged));

  const S = { n: 0, verdict: 0, accepted: 0, abstain: 0, right: 0, wrong: 0, knownSum: 0, confSum: 0,
    pipeRight: 0, pipeEmpty: 0, pipeWrong: 0, agree: 0, conflict: 0, catch: 0, falseAlarm: 0, recover: 0,
    wrongEx: [], catchEx: [], recoverEx: [] };
  for (const d of docs) {
    const m = res[d.staged]; if (!m) continue; S.n++; S.confSum += (m.overall_confidence || 0);
    const gt = d.supplier_name, pipe = m.supplier_name, pipePresent = pipe && String(pipe).trim();
    if (!pipePresent) S.pipeEmpty++; else if (normName(pipe) === normName(gt)) S.pipeRight++; else S.pipeWrong++;
    const sh = m.identity_shadow; if (!sh) continue;
    S.verdict++; S.knownSum += sh.known_n || 0;
    if (!sh.accepted) { S.abstain++; continue; }
    S.accepted++;
    const textOk = normName(sh.text_led) === normName(gt);
    if (textOk) S.right++; else { S.wrong++; if (S.wrongEx.length < 10) S.wrongEx.push(`#${d.id} CONFIRMED='${gt}' text-led='${sh.text_led}' (pipeline='${pipe}')`); }
    if (pipePresent && normName(sh.text_led) === normName(pipe)) S.agree++;
    if (pipePresent && normName(sh.text_led) !== normName(pipe)) {
      S.conflict++;
      if (textOk) { S.catch++; if (S.catchEx.length < 10) S.catchEx.push(`#${d.id} pipeline WRONG='${pipe}' -> text-led RIGHT='${gt}'`); }
      else S.falseAlarm++;
    }
    if (!pipePresent && textOk) { S.recover++; if (S.recoverEx.length < 10) S.recoverEx.push(`#${d.id} pipeline EMPTY -> text-led RIGHT='${gt}'`); }
  }

  const o = [];
  o.push(`# Live-DB identity_fusion SHADOW — ${S.n} confirmed docs processed (mode=${MODE})`);
  o.push(`Source: ${LIVE_DB}`);
  o.push(`Confirmed w/ supplier ${totalConfirmed} · resolvable ${resolvable}${sampled ? ` · random sample ${docs.length}` : ''} · gazetteer logos ${snap.nLogos}/hints ${snap.nHints}/anchors ${snap.nAnchors}`);
  o.push(`Mean fresh-extraction confidence: ${S.n ? (S.confSum / S.n).toFixed(1) : '-'}`);
  o.push(`\n## Fresh pipeline supplier vs CONFIRMED (ground truth)`);
  o.push(`- correct ${S.pipeRight}/${S.n} (${pct(S.pipeRight, S.n)}) · empty ${S.pipeEmpty} · wrong ${S.pipeWrong}`);
  o.push(`\n## identity_fusion text-led vs CONFIRMED — THE precision question`);
  o.push(`- gazetteer verdict on ${S.verdict}/${S.n} · avg known ${S.verdict ? (S.knownSum / S.verdict).toFixed(1) : '-'}`);
  o.push(`- ACCEPTED ${S.accepted}/${S.verdict} (${pct(S.accepted, S.verdict)}) · abstained ${S.abstain}`);
  o.push(`- of accepted: **RIGHT ${S.right}** · **WRONG=silent-wrong ${S.wrong}**  (precision ${pct(S.right, S.accepted)})`);
  o.push(`\n## text-led vs the fresh pipeline`);
  o.push(`- AGREE ${S.agree} · CONFLICT ${S.conflict} -> **CATCH ${S.catch}** (pipeline wrong, text-led right) · false-alarm ${S.falseAlarm}`);
  o.push(`- **RECOVER ${S.recover}** (pipeline left supplier EMPTY, text-led filled it correctly)`);
  if (S.wrongEx.length) o.push(`\n### silent-wrong (text-led accepted a supplier != confirmed)\n- ` + S.wrongEx.join('\n- '));
  if (S.catchEx.length) o.push(`\n### catches\n- ` + S.catchEx.join('\n- '));
  if (S.recoverEx.length) o.push(`\n### recoveries (sample)\n- ` + S.recoverEx.slice(0, 6).join('\n- '));
  const rep = o.join('\n');
  fs.writeFileSync(path.join(OUT, 'live_identity_shadow.md'), rep);
  console.log('\n' + rep);
  console.log('\nWrote', path.join(OUT, 'live_identity_shadow.md'));
  try { fs.rmSync(STAGE, { recursive: true, force: true }); } catch {}
})().catch(e => { console.error('FATAL', e); process.exit(1); });
