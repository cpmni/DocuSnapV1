'use strict';
/*
 * demo_rightgrow_ab.js — TARGETED A/B for the crop RIGHT-GROW fix (ANCHOR_VALUE_RIGHT_GROW).
 *
 * WHY: the full 493-doc corpus A/B (realdoc_regression.js) came back byte-identical because NO
 * confirmed doc overflows its taught box — so it proved zero-regression but nothing about the HEAL.
 * The chop-class lives in the Demo Docs (Northgate POs). This runner feeds an arbitrary FOLDER of
 * PDFs through process_docs.py with the flag OFF then ON (explicit spawn env), and diffs the
 * extracted ref/type/supplier per doc so a right-grow FIRING is visible and judgeable.
 *
 * READ-ONLY: the live DB is opened readonly; it is only used to export the learned training data
 * (same snap() as realdoc_regression.js) and to look up each file's CONFIRMED ref as GT. The DB is
 * never modified. Demo PDFs are read in place (process_docs reads, never writes them). Output goes
 * to stress_test/out/ (gitignored) — contains real values, do NOT commit.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/demo_rightgrow_ab.js \
 *        ["C:/Users/cmccu/Desktop/Demo Docs/Northgate Textiles/purchase_order"]
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap', ST = path.join(REPO, 'stress_test');
const OUT = path.join(ST, 'out'), CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = process.env.RR_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const DEFAULT_FOLDER = 'C:/Users/cmccu/Desktop/Demo Docs/Northgate Textiles/purchase_order';
const FOLDER = process.argv[2] || DEFAULT_FOLDER;
// Which crop kill-switch to A/B (default the right-grow). Generalised so the sibling clamp
// (ANCHOR_LABEL_LEFT_CLAMP) can be smoked the same way: AB_FLAG=ANCHOR_LABEL_LEFT_CLAMP.
const AB_FLAG = process.env.AB_FLAG || 'ANCHOR_VALUE_RIGHT_GROW';

const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const normRef = s => String(s || '').toUpperCase().replace(/\s+/g, '');
const w = (tag, d) => { const f = path.join(os.tmpdir(), `dg_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
const ef = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e.value : (k && m[k] != null ? m[k] : null); };

// Doc-types + fields via DIRECT SQL (getAllWithFields runs a WRITE-y repair; unsafe on a ro handle).
function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return dts;
}

// snap() — identical training export to realdoc_regression.js (keep in lockstep).
function snap(db) {
  const dts = docTypesWithFields(db);
  const anchors = safe(() => learning.getAllAnchors(db), []);
  return { args: [
    '--fields-file', w('f', dts.flatMap(d => d.fields)),
    '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
    '--anchors-file', w('a', anchors),
    '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
    '--doc-types-file', w('d', dts),
    '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
    '--templates-file', w('t', safe(() => templates.getAll(db), [])),
    '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
    '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'] };
}

// Run process_docs over `files` in `folder` with the right-grow flag set to `arm` ('0'|'1').
function runArm(folder, snapArgs, files, arm) {
  const N = 4; const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const sf = shards.filter(x => x.length).map(names => w('shard', names));
  const childEnv = { ...process.env, [AB_FLAG]: arm };
  const one = shardFile => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile, '--mode', 'fast', '--tesseract', TESS, ...snapArgs],
      { windowsHide: true, env: childEnv });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(sf.map(one)).then(outs => {
    const docs = {}; for (const o of outs) for (const ln of o.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; }
    return docs;
  });
}

(async () => {
  if (!fs.existsSync(LIVE_DB)) { console.error('live DB not found:', LIVE_DB); process.exit(1); }
  if (!fs.existsSync(FOLDER)) { console.error('folder not found:', FOLDER); process.exit(1); }
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const roles = {}; for (const r of db.prepare('SELECT slug, ref_field_key FROM document_types').all()) roles[r.slug] = r.ref_field_key;
  const nameToSlug = {}; for (const r of db.prepare('SELECT name, slug FROM document_types').all()) nameToSlug[r.name] = r.slug;
  // GT by filename: the owner-confirmed ref for a Demo doc already imported + confirmed in the DB.
  const gtRef = {};
  for (const r of db.prepare(`SELECT original_filename, reference_number FROM documents WHERE status='confirmed' AND reference_number IS NOT NULL`).all())
    if (r.original_filename) gtRef[r.original_filename] = r.reference_number;

  const files = fs.readdirSync(FOLDER).filter(f => /\.(pdf|png|jpg|jpeg|tif|tiff)$/i.test(f));
  if (!files.length) { console.error('no docs in', FOLDER); process.exit(1); }

  const snapObj = snap(db);
  const off = await runArm(FOLDER, snapObj.args, files, '0');
  const on  = await runArm(FOLDER, snapObj.args, files, '1');
  db.close();

  // Full-field OFF→ON diff: the right-grow must ONLY move the ref crop. Any OTHER field/type/
  // supplier that differs between arms is a violation of the grow-only, ref-scoped guarantee.
  const fieldVal = (m, k) => { const e = m && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e.value : (e != null ? e : null); };
  const collateral = [];
  for (const f of files) {
    const mo = off[f], mn = on[f]; if (!mo || !mn) continue;
    const keys = new Set([...Object.keys(mo.extractions || {}), ...Object.keys(mn.extractions || {})]);
    const slug = mo._document_slug || nameToSlug[mo.document_type] || null;
    const rk = roles[slug];
    const moved = [];
    for (const k of keys) { if (k === rk) continue; if (String(fieldVal(mo, k) ?? '') !== String(fieldVal(mn, k) ?? '')) moved.push(`${k}:'${fieldVal(mo, k)}'->'${fieldVal(mn, k)}'`); }
    if ((mo._document_slug || mo.document_type) !== (mn._document_slug || mn.document_type)) moved.push(`TYPE:'${mo.document_type}'->'${mn.document_type}'`);
    if (String(mo.supplier_name ?? '') !== String(mn.supplier_name ?? '')) moved.push(`SUPPLIER:'${mo.supplier_name}'->'${mn.supplier_name}'`);
    if (moved.length) collateral.push(`- ${f}: ${moved.join(' · ')}`);
  }

  const rows = [], diffs = [];
  for (const f of files) {
    const mo = off[f], mn = on[f];
    const slug = mo ? (mo._document_slug || nameToSlug[mo.document_type] || null) : null;
    const rk = roles[slug];
    const refOff = mo ? ef(mo, rk) : null;
    const refOn  = mn ? ef(mn, rk) : null;
    const gt = gtRef[f] != null ? gtRef[f] : '';
    const changed = normRef(refOff) !== normRef(refOn);
    const offMatchesGt = gt && normRef(refOff) === normRef(gt);
    const onMatchesGt  = gt && normRef(refOn)  === normRef(gt);
    const verdict = !changed ? '' : (onMatchesGt && !offMatchesGt) ? 'HEAL' : (offMatchesGt && !onMatchesGt) ? 'REGRESS' : 'CHANGED';
    rows.push({ f, slug, gt, refOff, refOn, changed, verdict });
    if (changed) diffs.push({ f, gt, refOff, refOn, verdict });
  }

  const out = [];
  out.push(`# Crop-flag targeted A/B (${AB_FLAG}) — ${FOLDER}`);
  out.push(`(${files.length} docs; flag OFF vs ON; GT = owner-confirmed ref from the live DB where present.)`);
  out.push('');
  out.push('| file | type | GT ref | OFF | ON | diff |');
  out.push('|---|---|---|---|---|---|');
  for (const r of rows) out.push(`| ${r.f} | ${r.slug || '?'} | ${r.gt || '—'} | ${r.refOff || '—'} | ${r.refOn || '—'} | ${r.verdict || (r.changed ? 'CHANGED' : '')} |`);
  out.push('');
  out.push(`**Docs where ON ≠ OFF (right-grow FIRED): ${diffs.length}.**`);
  for (const d of diffs) out.push(`- ${d.f}: OFF='${d.refOff}' ON='${d.refOn}' GT='${d.gt}' → ${d.verdict}`);
  const heals = diffs.filter(d => d.verdict === 'HEAL').length;
  const regs  = diffs.filter(d => d.verdict === 'REGRESS').length;
  out.push('');
  out.push(`**HEAL (ON matches GT, OFF did not): ${heals} · REGRESS (ON breaks a GT-correct read): ${regs} · other CHANGED: ${diffs.length - heals - regs}.**`);
  out.push('');
  out.push(`**Collateral (non-ref field/type/supplier that moved OFF→ON — MUST be 0 for grow-only): ${collateral.length}.**`);
  for (const c of collateral) out.push(c);
  if (!diffs.length) out.push(`\n⚠ The flag fired on NOTHING here — no doc in this folder overflows its taught box. Try the scanned/skewed rendition or another type.`);
  const txt = out.join('\n');
  fs.writeFileSync(path.join(OUT, 'demo_rightgrow_ab.md'), txt);
  console.log(txt);
})();
