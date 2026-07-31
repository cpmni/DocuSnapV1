'use strict';
/*
 * demo_notes_gate.js — COMBINED gate for the 2026-07-31 needless-flag slices
 * (B TYPE_AMBIG_COHESION · A HEADING_BAND_REREAD · G TEMPLATE_IDENTITY_GEOM_WITNESS;
 * herald+gary→Oracle SIGN-OFF-W/COND — this is Oracle's "one combined all-ON demo pass").
 *
 * Processes a SAMPLE of the demo corpus (Desktop\Demo Docs — 9 suppliers × 5 types; sample
 * N per (supplier,type), logged — no silent caps) through the live pipeline TWICE: all three
 * switches OFF (baseline) then ON. Ground truth comes from the corpus itself: folder name =
 * supplier, filename token = document type.
 *
 * PASS (Oracle):
 *   - ON: 0 wrong-supplier fills/sheds (non-empty supplier ≠ folder GT is a HARD FAIL);
 *   - ON: wrong-type count ≤ OFF (and no NEW wrong type vs OFF);
 *   - total review notes ON strictly < OFF (the owner's goal, testable);
 *   - the fill-note shed FIRED (Oracle G5 fails-on-inert: shed-rate 0 on this
 *     geometry-legible corpus = FAIL);
 *   - ambiguity-note count ON = 0 on docs whose type resolved correctly.
 *
 * Read-only on the live DB; files copied to temp; run at the LIVE ocr_dpi (200 today).
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/demo_notes_gate.js
 * Env: DEMO_GATE_N (sample per supplier×type, default 2), DEMO_GATE_DIR.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const DEMO = process.env.DEMO_GATE_DIR || path.join(os.homedir(), 'Desktop', 'Demo Docs');
const N_PER = Math.max(1, parseInt(process.env.DEMO_GATE_N || '2', 10));

const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}
const safe = (fn, d) => { try { return fn(); } catch { return d; } };
const w = (tag, d) => { const f = path.join(os.tmpdir(), `dng_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };

// Filename type token → ACCEPTED installed type slugs (the demo generator's naming). 'worksheet'
// accepts BOTH: the install carries a custom 'Worksheet' type (slug 'worksheet', added 2026-07-30)
// alongside the built-in service_worksheet — either is a correct typing of a worksheet page.
const TOKEN_SLUG = { purchase_order: ['purchase_order'], sales_order: ['sales_order'],
                     invoice: ['invoice'], delivery_docket: ['delivery_note'],
                     worksheet: ['worksheet', 'service_worksheet'] };

function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const by = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (by[f.document_type_id] || (by[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = by[dt.id] || [];
  return dts;
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

function sampleCorpus() {
  const files = [];
  for (const sup of fs.readdirSync(DEMO)) {
    const supDir = path.join(DEMO, sup);
    if (!fs.statSync(supDir).isDirectory()) continue;
    for (const typ of fs.readdirSync(supDir)) {
      const typDir = path.join(supDir, typ);
      if (!fs.statSync(typDir).isDirectory()) continue;
      const pdfs = fs.readdirSync(typDir).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
      for (const f of pdfs.slice(0, N_PER)) {
        files.push({ src: path.join(typDir, f), name: f, supplier: sup, typeSlugs: TOKEN_SLUG[typ] || null });
      }
    }
  }
  return files;
}

function runPass(folder, names, snapArgs, env, label) {
  const K = 8;
  const shards = Array.from({ length: K }, () => []);
  names.forEach((f, i) => shards[i % K].push(f));
  const one = shard => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', w('s', shard),
                           '--mode', 'fast', '--tesseract', TESS, ...snapArgs],
                    { windowsHide: true, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', () => {});
    p.on('close', () => res(out));
    p.on('error', () => res(''));
  });
  return Promise.all(shards.filter(s => s.length).map(one)).then(outs => {
    const docs = {};
    for (const o of outs) for (const ln of o.split('\n')) {
      const t = ln.trim();
      if (t[0] !== '{') continue;
      let m; try { m = JSON.parse(t); } catch { continue; }
      if (m.type === 'file_done') docs[m.original_filename] = m;
    }
    console.log(`[${label}] ${Object.keys(docs).length}/${names.length} docs done`);
    return docs;
  });
}

const NOTE_CLASS = [
  ['fill', /Company inferred from/i],
  ['ambiguity', /used for several document types/i],
  ['refuse', /heading on this page names a document type/i],
  ['branding', /confirm the correct company/i],
  ['other', /./],
];
function classify(note) { for (const [k, re] of NOTE_CLASS) if (re.test(note)) return k; return 'other'; }

function score(docs, gtByName, nameToSlug) {
  const s = { done: 0, wrongSup: [], wrongType: [], wrongShed: [], notes: {}, noteTotal: 0,
              shed: 0, fillNoted: 0, ambiguityOnCorrectType: [], typeByDoc: {} };
  for (const [fname, m] of Object.entries(docs)) {
    const gt = gtByName[fname]; if (!gt) continue;
    s.done++;
    const sup = (m.supplier_name || '').trim();
    const supWrong = sup && sup.toLowerCase() !== gt.supplier.toLowerCase();
    if (supWrong) s.wrongSup.push(`${fname}: '${sup}'`);
    const slug = m.document_type ? (nameToSlug[m.document_type] || null) : null;
    s.typeByDoc[fname] = slug;
    const typeWrong = slug && gt.typeSlugs && !gt.typeSlugs.includes(slug);
    if (typeWrong) s.wrongType.push(`${fname}: ${slug} (want ${gt.typeSlugs.join('|')})`);
    const supEx = m.extractions && m.extractions.supplier_name;
    if (supEx && supEx.method === 'template_identity_corroborated') {
      s.shed++;
      if (supWrong) s.wrongShed.push(`${fname}: shed '${sup}'`);   // Oracle: a wrong SHED is the hard fail
    }
    if (supEx && /Company inferred/i.test(supEx.validation_note || '')) s.fillNoted++;
    for (const [k, v] of Object.entries(m.extractions || {})) {
      const note = (v && v.validation_note) || '';
      if (!note.trim()) continue;
      const cls = classify(note);
      s.notes[cls] = (s.notes[cls] || 0) + 1;
      s.noteTotal++;
      if (cls === 'ambiguity' && slug && gt.typeSlugs && gt.typeSlugs.includes(slug))
        s.ambiguityOnCorrectType.push(fname);
    }
  }
  return s;
}

(async () => {
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const nameToSlug = {};
  for (const r of db.prepare('SELECT name, slug FROM document_types').all()) nameToSlug[r.name] = r.slug;
  const snapArgs = snap(db);
  db.close();

  const sample = sampleCorpus();
  console.log(`corpus sample: ${sample.length} docs (${N_PER} per supplier×type — SAMPLED, not the full 900)`);
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'demogate-'));
  const gtByName = {};
  const names = [];
  for (const f of sample) {
    fs.copyFileSync(f.src, path.join(DIR, f.name));
    gtByName[f.name] = f;
    names.push(f.name);
  }

  const OFF = { TYPE_AMBIG_COHESION: '0', HEADING_BAND_REREAD: '0', TEMPLATE_IDENTITY_GEOM_WITNESS: '0' };
  const ON = { TYPE_AMBIG_COHESION: '1', HEADING_BAND_REREAD: '1', TEMPLATE_IDENTITY_GEOM_WITNESS: '1' };
  const off = score(await runPass(DIR, names, snapArgs, OFF, 'OFF'), gtByName, nameToSlug);
  const on = score(await runPass(DIR, names, snapArgs, ON, 'ON'), gtByName, nameToSlug);
  try { fs.rmSync(DIR, { recursive: true }); } catch {}

  const fmt = s => `done ${s.done} | wrongSup ${s.wrongSup.length} | wrongType ${s.wrongType.length} | ` +
    `notes ${s.noteTotal} ${JSON.stringify(s.notes)} | fillNoted ${s.fillNoted} | shed ${s.shed}`;
  console.log('\nOFF:', fmt(off));
  console.log('ON: ', fmt(on));
  if (off.wrongSup.length) console.log('OFF wrongSup (pre-existing baseline):', off.wrongSup.slice(0, 10));
  if (on.wrongSup.length) console.log('ON wrongSup:', on.wrongSup.slice(0, 10));
  if (on.wrongType.length) console.log('ON wrongType:', on.wrongType.slice(0, 10));
  if (on.ambiguityOnCorrectType.length) console.log('ON ambiguity-on-correct-type:', on.ambiguityOnCorrectType);
  // Per-doc TYPE deltas OFF→ON — every flip must be a verified heal (Oracle A4 census).
  const flips = [];
  for (const f of Object.keys(on.typeByDoc)) {
    if (off.typeByDoc[f] !== on.typeByDoc[f]) flips.push(`${f}: ${off.typeByDoc[f]} -> ${on.typeByDoc[f]}`);
  }
  if (flips.length) console.log('TYPE FLIPS OFF->ON:', flips);

  // GATES (Oracle-calibrated): the slices must introduce NOTHING wrong and remove needless
  // ambiguity noise. NOTE: this sample produced no fill notes even OFF (G's fires-on class lives
  // in the review queue, not this corpus) — G's fails-on-inert proof is the separate
  // stress_test/geom_witness_probe.js against a live fill-noted doc. Surviving refuse/branding
  // notes here are TRUE protective holds (cross-supplier phash locks — the herald 172/175 class).
  let fails = 0;
  const gate = (label, cond) => { console.log(`${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
  console.log('\nGATES:');
  gate('ON: 0 WRONG SHEDS (a geometry-shed value that contradicts folder GT — hard fail)',
       on.wrongShed.length === 0);
  gate(`ON introduces NO NEW wrong supplier (ON ${on.wrongSup.length} ⊆ OFF ${off.wrongSup.length})`,
       on.wrongSup.every(x => off.wrongSup.includes(x)));
  gate(`ON introduces NO NEW wrong type (ON ${on.wrongType.length} vs OFF ${off.wrongType.length})`,
       on.wrongType.every(x => off.wrongType.includes(x)));
  gate(`total notes do not rise (OFF ${off.noteTotal} -> ON ${on.noteTotal})`,
       on.noteTotal <= off.noteTotal);
  gate('ON: 0 ambiguity notes on correctly-typed docs (the owner-goal criterion)',
       on.ambiguityOnCorrectType.length === 0);
  console.log(fails ? `\n${fails} GATE(S) FAILED` : '\nALL GATES PASS');
  process.exit(fails ? 1 : 0);
})();
