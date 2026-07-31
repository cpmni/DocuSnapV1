'use strict';
/*
 * geom_witness_probe.js — G's fails-on-inert gate (TEMPLATE_IDENTITY_GEOM_WITNESS;
 * gary→Oracle SIGN-OFF-W/COND 2026-07-31, condition G5: an inert outcome is a FAIL).
 *
 * The owner's doc-170 class: a template-identity FILL resolves the supplier whose name is
 * PRINTED in the letterhead, yet carries "Company inferred from one previously filed
 * document — please confirm before filing." Processes the live working copy TWICE (G OFF /
 * G ON, everything else live defaults): OFF must reproduce the noted fill; ON must shed it
 * (method template_identity_corroborated @85, no note, SAME value).
 *
 * Read-only on the live DB; the doc's PDF copied to temp. Doc overridable: GW_PROBE_DOC
 * (default: find the newest needs_review doc whose supplier_name row carries the fill note).
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/geom_witness_probe.js
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
const safe = (fn, d) => { try { return fn(); } catch { return d; } };
const w = (tag, d) => { const f = path.join(os.tmpdir(), `gwp_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };

function snap(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const by = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (by[f.document_type_id] || (by[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = by[dt.id] || [];
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

function runOne(folder, fname, snapArgs, env) {
  return new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', w('s', [fname]),
                           '--mode', 'fast', '--tesseract', TESS, ...snapArgs],
                    { windowsHide: true, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', () => {});
    p.on('close', () => {
      for (const ln of out.split('\n')) {
        const t = ln.trim();
        if (t[0] !== '{') continue;
        let m; try { m = JSON.parse(t); } catch { continue; }
        if (m.type === 'file_done') return res(m);
      }
      res(null);
    });
    p.on('error', () => res(null));
  });
}

let fails = 0;
const check = (l, c) => { console.log(`${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

(async () => {
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  let docId = process.env.GW_PROBE_DOC ? parseInt(process.env.GW_PROBE_DOC, 10) : null;
  if (!docId) {
    const r = db.prepare(`SELECT d.id FROM documents d JOIN extractions e ON e.document_id = d.id
      WHERE d.status = 'needs_review' AND e.field_key = 'supplier_name'
        AND e.validation_note LIKE 'Company inferred%' ORDER BY d.id DESC LIMIT 1`).get();
    docId = r ? r.id : null;
  }
  if (!docId) { console.error('no fill-noted needs_review doc found — pass GW_PROBE_DOC'); process.exit(2); }
  const row = db.prepare('SELECT working_path, original_filename FROM documents WHERE id = ?').get(docId);
  const src = row && row.working_path && fs.existsSync(row.working_path) ? row.working_path : null;
  if (!src) { console.error(`doc ${docId}: no working copy`); process.exit(2); }
  console.log(`probe doc ${docId} (${row.original_filename})`);
  const snapArgs = snap(db);
  db.close();

  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gwprobe-'));
  const fname = `doc${docId}${path.extname(src) || '.pdf'}`;
  fs.copyFileSync(src, path.join(DIR, fname));

  const off = await runOne(DIR, fname, snapArgs, { TEMPLATE_IDENTITY_GEOM_WITNESS: '0' });
  const on = await runOne(DIR, fname, snapArgs, { TEMPLATE_IDENTITY_GEOM_WITNESS: '1' });
  try { fs.rmSync(DIR, { recursive: true }); } catch {}
  if (!off || !on) { console.error('run failed'); process.exit(2); }

  const so = off.extractions && off.extractions.supplier_name || {};
  const sn = on.extractions && on.extractions.supplier_name || {};
  console.log(`OFF: ${JSON.stringify(so)}`);
  console.log(`ON:  ${JSON.stringify(sn)}`);
  check('OFF reproduces the noted fill (method template_identity + "Company inferred" note)',
        so.method === 'template_identity' && /Company inferred/i.test(so.validation_note || ''));
  // Conf: EMITTED at 85 (pinned at source in test_template_identity_geom_witness.py); the generic
  // Stage-4.5 learned-agreement boost may lift it a few points EXACTLY as it lifts a
  // hint_text_match@85 (the parity the 85 was chosen for) — what matters here is sub-floor (<95).
  check('ON sheds it: method template_identity_corroborated, conf in [85,95), NO note (G5 fails-on-inert)',
        sn.method === 'template_identity_corroborated'
        && sn.confidence >= 85 && sn.confidence < 95
        && !(sn.validation_note || '').trim());
  check('ON keeps the SAME value (shed only removes the hedge, never swaps supplier)',
        (sn.value || '') === (so.value || '') && !!sn.value);
  console.log(fails ? `\n${fails} FAILED` : '\nALL PINS PASS');
  process.exit(fails ? 1 : 0);
})();
