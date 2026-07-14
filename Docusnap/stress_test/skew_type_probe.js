'use strict';
/* skew_type_probe.js — synthetic-skew TYPE-flip probe: the ship gate for Fix A (type-ambiguity HOLD)
 * and Fix B1 (ref-prefix type SUGGESTION). Renders a spread of confirmed same-letterhead docs, rotates
 * each by {0,0.5,1,2}° (image-only → OCR path, i.e. a scanned copy tilted by that angle), and runs the
 * REAL extraction pipeline in THREE modes: guards OFF (today's silent flip), Fix A only (flip → HELD,
 * coin-flip suggestion), Fix A + Fix B1 (flip → HELD, but the TYPE auto-corrected from the doc's own
 * reference prefix). Certifies: A holds every flip (0 auto-file); B1 moves the suggestion TOWARD GT,
 * never AWAY, never clears A's hold, and never perturbs a non-ambiguous doc. DB read-only; temp cleaned.
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/skew_type_probe.js
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn, spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap', ST = path.join(REPO, 'stress_test');
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const RENDER = path.join(ST, '_render_rotate.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}
const safe = (fn, d) => { try { return fn(); } catch { return d; } };
const w = (tag, d) => { const f = path.join(os.tmpdir(), `sp_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };

const ANGLES = [0, 0.5, 1.0, 2.0];
const angLbl = a => String(a).replace('.', 'p').replace('-', 'm');

function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all(); const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || []; return dts;
}
function snap(db) {
  const dts = docTypesWithFields(db);
  return ['--fields-file', w('f', dts.flatMap(d => d.fields)),
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
function runP(folder, snapArgs, files, envOverride) {
  const N = 6; const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const sf = shards.filter(x => x.length).map(names => w('shard', names));
  const env = { ...process.env, ...(envOverride || {}) };
  const one = shardFile => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile, '--mode', 'fast', '--tesseract', TESS, ...snapArgs], { windowsHide: true, env });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(sf.map(one)).then(outs => {
    const docs = {}; for (const o of outs) for (const ln of o.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; }
    return docs;
  });
}

(async () => {
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const rows = db.prepare(`SELECT d.id, d.original_filename, d.stored_path, d.working_path, d.reference_number gtref, d.doc_date gtdate, d.supplier_name gtsup, dt.slug, dt.name typename
    FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.status = 'confirmed' AND LOWER(d.supplier_name) LIKE 'cascade%'
    GROUP BY dt.slug`).all();
  const resolve = d => (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
  const sel = []; for (const r of rows) { const src = resolve(r); if (src) sel.push({ id: r.id, src, gt: r.slug, gtname: r.typename, gtref: r.gtref, gtdate: r.gtdate, gtsup: r.gtsup }); }
  console.log('selected docs:', sel.map(s => `#${s.id}=${s.gt}`).join(', '));

  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'skewprobe-'));
  const mf = w('manifest', sel.map(s => ({ id: s.id, src: s.src, angles: ANGLES })));
  const rr = spawnSync('py', ['-3.12', RENDER, mf, outdir], { encoding: 'utf8' });
  console.log('render:', (rr.stdout || '').trim(), rr.stderr ? ('ERR: ' + rr.stderr.slice(0, 300)) : '');
  const files = fs.readdirSync(outdir).filter(f => f.endsWith('.png'));
  if (!files.length) { console.log('no rendered files — aborting'); db.close(); return; }

  const snapArgs = snap(db);
  // THREE runs on the SAME rendered/rotated docs:
  //   off = today's silent flip (both guards off); a = Fix A only (flip → HELD, coin-flip suggestion);
  //   b1 = Fix A + Fix B1 (flip → HELD, but the TYPE is auto-corrected from the doc's ref-prefix).
  console.log('running pipeline (Fix A OFF, B1 OFF)…'); const off = await runP(outdir, snapArgs, files, { TYPE_AMBIGUITY_GUARD: '0', REF_PREFIX_RETYPE: '0' });
  console.log('running pipeline (Fix A ON,  B1 OFF)…'); const aRun = await runP(outdir, snapArgs, files, { TYPE_AMBIGUITY_GUARD: '1', REF_PREFIX_RETYPE: '0' });
  console.log('running pipeline (Fix A ON,  B1 ON)…');  const b1  = await runP(outdir, snapArgs, files, { TYPE_AMBIGUITY_GUARD: '1', REF_PREFIX_RETYPE: '1' });

  const norm = t => String(t || '').toLowerCase();
  const AMBIG = 'could not be confirmed';                      // substring of the Fix-A note
  const hasNote = m => !!m && !!m.extractions && Object.values(m.extractions).some(e => String(e && e.validation_note || '').includes(AMBIG));
  const held    = m => !!m && (m.needs_review === true || hasNote(m));   // ANY hold (Fix A OR another guard)

  console.log('\n| doc | GT type | angle | type(A) | type(B1) | heldA | heldB1 | verdict |');
  console.log('|---|---|---|---|---|---|---|---|');
  // Fix A metrics (a-run vs off, unchanged) + Fix B1 metrics (b1-run vs a-run).
  let flipUnheld = 0, overFire0 = 0, killSwitchLeak = 0;
  let b1Corrected = 0, b1AwayFromGt = 0, b1ClearedHold = 0, b1SingleTypeDrift = 0, b1CorrectedUnheld = 0;
  for (const s of sel) {
    const gtn = norm(s.gtname);
    for (const ang of ANGLES) {
      const fn = `doc${s.id}_a${angLbl(ang)}.png`;
      const ta = norm((aRun[fn] || {}).document_type), tb = norm((b1[fn] || {}).document_type);
      const wrongA = ta && ta !== gtn, wrongB = tb && tb !== gtn;
      const hA = held(aRun[fn]), hB = held(b1[fn]);
      // Fix A gate (unchanged): a flip must be held; the note must not leak with the guard off.
      if (wrongA && !hA) flipUnheld++;
      if (hasNote(off[fn])) killSwitchLeak++;
      if (!wrongA && hasNote(aRun[fn]) && ang === 0) overFire0++;
      // Fix B1 gate (b1 vs a):
      if (wrongA && !wrongB) b1Corrected++;          // B1 auto-corrected a flipped suggestion to GT (the win)
      if (wrongA && !wrongB && !hB) b1CorrectedUnheld++;  // a B1 correction that is NOT held → split-brain (must be 0, Oracle C2/gary)
      if (!wrongA && wrongB) b1AwayFromGt++;          // B1 turned a correct type WRONG (must be 0)
      if (hA && !hB)          b1ClearedHold++;         // B1 cleared a hold A had set → auto-file risk (must be 0)
      if (!hA && (tb !== ta)) b1SingleTypeDrift++;     // a non-ambiguous (unheld) doc changed type under B1 (must be 0 — backward-compat)
      let verdict = 'ok';
      if (wrongA && !wrongB && hB) verdict = 'B1 CORRECTS (held)';
      else if (wrongA && wrongB && hB) verdict = 'still flipped (held)';
      else if (wrongA && !hA) verdict = 'FLIP AUTO-FILES (A gate fail)';
      else if (hA && !hB) verdict = 'B1 CLEARED HOLD (fail)';
      else if (!wrongA && wrongB) verdict = 'B1 AWAY FROM GT (fail)';
      console.log(`| #${s.id} | ${s.gt} | ${ang}deg | ${(aRun[fn] || {}).document_type} | ${(b1[fn] || {}).document_type} | ${hA} | ${hB} | ${verdict} |`);
    }
  }
  console.log(`\nGATE A (unchanged): flips that auto-file: ${flipUnheld} (must be 0) · over-fire @0°: ${overFire0} (must be 0) · kill-switch leaks: ${killSwitchLeak} (must be 0)`);
  console.log(`GATE B1: type auto-CORRECTED toward GT: ${b1Corrected} (the usability win, must be >0) · corrected-but-UNHELD: ${b1CorrectedUnheld} (split-brain, must be 0) · flipped AWAY from GT: ${b1AwayFromGt} (must be 0) · cleared a Fix-A hold: ${b1ClearedHold} (must be 0) · single-type drift: ${b1SingleTypeDrift} (must be 0, backward-compat)`);
  const pass = flipUnheld === 0 && overFire0 === 0 && killSwitchLeak === 0 &&
               b1Corrected > 0 && b1CorrectedUnheld === 0 &&
               b1AwayFromGt === 0 && b1ClearedHold === 0 && b1SingleTypeDrift === 0;
  console.log(pass ? 'GATE PASS' : 'GATE FAIL');
  console.log('\nNOTE: the garbled-own-ref + clean-quoted-other-sibling CONTAMINATION shape (Oracle) is not in this' +
              ' corpus — the "cleared a Fix-A hold = 0" assertion covers it generically (B1 never auto-files an' +
              ' ambiguous doc). A constructed contamination image remains a HYPOTHESIS follow-up.');
  try { fs.rmSync(outdir, { recursive: true }); } catch {}
  db.close();
})();
