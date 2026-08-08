'use strict';
/*
 * _rejectcrop_measure.js — SCRATCH MEASUREMENT for the "ref-hold guard" design (2026-07-24).
 *
 * QUESTION: when a taught anchor's rigid CROP read of a field is DISCARDED (not_credible /
 * format) and a NON-crop rung commits the value instead, the discarded read is a dissent
 * witness that is thrown away. How often would holding on that dissent fire, how many of those
 * docs are actually WRONG today (reward), and how many are RIGHT today (review-volume cost)?
 *
 * It scores the TWO rival predicates from the 2026-07-24 advisor round, because they disagree:
 *   P_REGGIE — digit projection vs letter projection compared SEPARATELY (separator-immune);
 *              uniqueness gate (exactly ONE same-length digit token); k<=2 AND k/n<=2/5; n>=4.
 *   P_GARY   — longest-pattern-span extraction, then raw shape_signature equality + every
 *              non-'#' position character-identical + ndiff <= min(2, (ndigits-1)//2).
 * ...across the THREE rival scopes: role ref key only / role ref+date / every ref-like field.
 *
 * DECISIVE OUTPUT: delta(would-auto-file). trust.js:554-559 turns any validation_note into a
 * hold BEFORE the confidence floor, so every fire costs one document of throughput. An
 * M-neutral change that holds 60 extra documents is a throughput regression, not a win.
 *
 * NOTE ON --trace: on_reject is bound only when tracing (engine.py:3093, :3601), so the reject
 * stream is ONLY observable with --trace on. Trace is documented behaviour-neutral; this script
 * self-checks that by reporting would-auto-file, which must match the untraced baseline (387).
 *
 * READ-ONLY on the live DB. Files copied to a temp dir and deleted. Output to stress_test/out/
 * (gitignored) — it contains real values, never commit it.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/_rejectcrop_measure.js
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap', ST = path.join(REPO, 'stress_test');
const OUT = path.join(ST, 'out'), CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = process.env.RR_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
const trust = require(path.join(REPO, 'database', 'modules', 'trust.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}
let GT_OVERRIDES = {}; try { GT_OVERRIDES = JSON.parse(fs.readFileSync(path.join(ST, 'gt_overrides.json'), 'utf8')); } catch {}
const VPATS = (JSON.parse(fs.readFileSync(CFG, 'utf8')).validation_patterns) || {};

const w = (tag, d) => { const f = path.join(os.tmpdir(), `rc_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
const normSupplier = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normRef = s => String(s || '').toUpperCase().replace(/\s+/g, '');
const normDate = s => String(s || '').replace(/[^0-9]/g, '');

// ── P_REGGIE ──────────────────────────────────────────────────────────────────
const R_MIN_DIGITS = 4, R_MAX_DIFFS = 2, R_RATIO_NUM = 2, R_RATIO_DEN = 5, R_SHORT_ALPHA = 3;
const digitProj  = s => (String(s || '').match(/\d+/g) || []).join('');
const letterProj = s => (String(s || '').match(/[A-Za-z]+/g) || []).join('').toUpperCase();

function pReggie(discardedRaw, committed) {
  const dc = digitProj(committed), n = dc.length;
  if (n < R_MIN_DIGITS) return { fire: false, k: null, n, why: 'min_digits' };
  const cands = String(discardedRaw || '').split(/\s+/).filter(t => digitProj(t).length === n);
  if (cands.length !== 1) return { fire: false, k: null, n, why: cands.length ? 'not_unique' : 'no_candidate' };
  const dr = digitProj(cands[0]);
  let k = 0; for (let i = 0; i < n; i++) if (dr[i] !== dc[i]) k++;
  if (k === 0) return { fire: false, k: 0, n, why: 'agreed' };
  if (k > R_MAX_DIFFS) return { fire: false, k, n, why: 'too_many_diffs' };
  if (k * R_RATIO_DEN > n * R_RATIO_NUM) return { fire: false, k, n, why: 'ratio' };
  const la = letterProj(committed), lb = letterProj(discardedRaw);
  if (la.length >= 2) { if (!(lb.includes(la) || la.includes(lb))) return { fire: false, k, n, why: 'alpha' }; }
  else if (lb.length > R_SHORT_ALPHA) return { fire: false, k, n, why: 'short_alpha' };
  return { fire: true, k, n, why: 'FIRE' };
}

// ── P_GARY ────────────────────────────────────────────────────────────────────
// Raw shape signature: letters -> '@', digits -> '#', everything else literal (mirrors
// format_anomaly_checker.shape_signature, which maps EVERY letter to '@').
const shapeSig = s => String(s || '').replace(/[A-Za-z]/g, '@').replace(/[0-9]/g, '#');
// Longest span matching ANY validation pattern for the type. gary's pin: _pattern_coverage uses
// re.search (FIRST match) and would return "No." here — this must use finditer/global, longest wins.
function longestSpan(raw, valType) {
  const pats = VPATS[valType || 'alphanumeric'] || VPATS.alphanumeric || [];
  let best = null;
  for (const p of pats) {
    let re; try { re = new RegExp(p, 'gi'); } catch { continue; }
    let m; while ((m = re.exec(String(raw || ''))) !== null) {
      if (m[0] && (!best || m[0].length > best.length)) best = m[0];
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return best;
}
function pGary(discardedRaw, committed, valType, maxDiff = 2) {
  const span = longestSpan(discardedRaw, valType);
  if (!span || !committed) return { fire: false, k: null, span, why: 'no_span' };
  const a = String(span), b = String(committed);
  if (a.length !== b.length) return { fire: false, k: null, span, why: 'len' };
  const sa = shapeSig(a), sb = shapeSig(b);
  if (sa !== sb) return { fire: false, k: null, span, why: 'shape' };
  let k = 0, nd = 0;
  for (let i = 0; i < a.length; i++) {
    if (sa[i] === '#') { nd++; if (a[i] !== b[i]) k++; }
    else if (a[i].toUpperCase() !== b[i].toUpperCase()) return { fire: false, k: null, span, why: 'nondigit_differs' };
  }
  if (k === 0) return { fire: false, k: 0, span, why: 'agreed' };
  const cap = Math.min(maxDiff, Math.floor((nd - 1) / 2));   // strict-majority-of-digits rule
  if (k > cap) return { fire: false, k, span, why: 'half_rule' };
  return { fire: true, k, span, why: 'FIRE' };
}

function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return dts;
}
function snapArgs(db) {
  const dts = docTypesWithFields(db);
  return ['--fields-file', w('f', dts.flatMap(d => d.fields)),
    '--hints-file', w('h', safe(() => learning.getHints(db), [])),
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
  const N = 8; const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const sf = shards.filter(x => x.length).map(names => w('shard', names));
  const one = shardFile => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile, '--mode', 'fast',
      '--tesseract', TESS, '--trace', ...args], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(sf.map(one)).then(outs => {
    const docs = {}, rejects = {}, rescues = {};
    for (const o of outs) for (const ln of o.split('\n')) {
      const t = ln.trim(); if (t[0] !== '{') continue;
      let m; try { m = JSON.parse(t); } catch { continue; }
      if (m.type === 'file_done') docs[m.original_filename] = m;
      else if (m.type === 'trace' && m.event === 'anchor_reject' && m.doc)
        (rejects[m.doc] || (rejects[m.doc] = [])).push({ field: m.field, method: m.method, value: m.value, reason: m.reason });
      else if (m.type === 'trace' && m.event === 'late_anchor_rescue' && m.doc)
        (rescues[m.doc] || (rescues[m.doc] = [])).push({ field: m.field, value: m.value, conf: m.conf });
    }
    return { docs, rejects, rescues };
  });
}
const ef = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e.value : (k && m[k] != null ? m[k] : null); };
// gary's scope filter: the committed read must be an INDEPENDENT rung, not the crop lineage.
const INDEP = new Set(['anchor_inline', 'anchor_crop_relocated', 'anchor_registration', 'anchor']);
const isRefLike = k => /(_number|_no)$/.test(String(k || '')) || String(k || '').includes('reference');

(async () => {
  if (!fs.existsSync(LIVE_DB)) { console.error('live DB not found:', LIVE_DB); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const nameToSlug = {}; for (const r of db.prepare('SELECT name, slug FROM document_types').all()) nameToSlug[r.name] = r.slug;
  const roles = {}; for (const r of db.prepare('SELECT slug, ref_field_key, date_field_key FROM document_types').all()) roles[r.slug] = { ref: r.ref_field_key, date: r.date_field_key };
  const slugToId = {}; for (const r of db.prepare('SELECT id, slug FROM document_types').all()) slugToId[r.slug] = r.id;
  const fieldType = {}; for (const f of db.prepare('SELECT key, type FROM fields').all()) if (!fieldType[f.key]) fieldType[f.key] = f.type;
  const conf = db.prepare(`SELECT d.id, d.supplier_name, d.reference_number, d.doc_date, d.original_filename, d.stored_path, d.working_path, dt.slug type_slug
    FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id WHERE d.status = 'confirmed'`).all();

  const taught = new Set();
  for (const a of safe(() => learning.getAllAnchors(db), []))
    if (a.last_authoritative_at) taught.add(`${normSupplier(a.supplier_name)}|${a.document_type}|${a.field_key}`);

  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'rejectcrop-'));
  const resolveFile = d => (d.working_path && fs.existsSync(d.working_path)) ? d.working_path
                         : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
  const gt = {}; const files = [];
  for (const d of conf) {
    const src = resolveFile(d); if (!src) continue;
    const fname = `doc${d.id}${path.extname(src) || '.pdf'}`;
    try { fs.copyFileSync(src, path.join(RR, fname)); } catch { continue; }
    files.push(fname);
    gt[fname] = { id: d.id, type_slug: d.type_slug, supplier: d.supplier_name, ref: d.reference_number, date: d.doc_date, fn: d.original_filename };
    const ov = GT_OVERRIDES[String(d.id)];
    if (ov && typeof ov === 'object') {
      const fnameOk = ov.fname_has == null || String(d.original_filename || '').includes(ov.fname_has);
      const refOk   = ov.poisoned_ref  == null || normRef(d.reference_number) === normRef(ov.poisoned_ref);
      const dateOk  = ov.poisoned_date == null || normDate(d.doc_date) === normDate(ov.poisoned_date);
      const supOk   = ov.poisoned_supplier == null || normSupplier(d.supplier_name) === normSupplier(ov.poisoned_supplier);
      if (fnameOk && refOk && dateOk && supOk) {
        if (ov.ref != null) gt[fname].ref = ov.ref;
        if (ov.date != null) gt[fname].date = ov.date;
        if (ov.supplier != null) gt[fname].supplier = ov.supplier;
      }
    }
  }

  const { docs: res, rejects, rescues } = await runP(RR, snapArgs(db), files);

  // ── Stage-2.6 LATE-RESCUE CAP LEAK (the 2026-07-24 finding) ─────────────────
  // engine.py:3572-3576 states the invariant "a rescued ref/date can never auto-file at any
  // threshold" and enforces it at :3628 with min(conf, _LATE_RESCUE_CAP=85). But two later
  // lifts undo it silently: Stage-2.5b conformance (ocr_corrector boost_table{0:8} — a boost
  // of 8 for ZERO fixes, i.e. merely MATCHING the learned shape) then the Stage-4.5 learned-
  // agreement boost (+5, engine.py:4358). 85 -> 93 -> 98. A valid-shaped misread matches the
  // learned shape BY CONSTRUCTION, so the lift rewards the very property that makes it
  // dangerous. This section measures how many docs the leak actually puts above the floor.
  const rescueRows = [];
  for (const fname of files) {
    const m = res[fname], g = gt[fname];
    if (!m || !g || !(rescues[fname] || []).length) continue;
    const role = roles[g.type_slug] || {};
    for (const r of rescues[fname]) {
      const key = r.field; if (!key) continue;
      const e = (m.extractions || {})[key] || {};
      const isRoleRef = key === role.ref, isRoleDate = key === role.date;
      const want = isRoleRef ? g.ref : (isRoleDate ? g.date : null);
      const got = ef(m, key);
      const correct = want == null ? null
        : (isRoleDate ? normDate(got) === normDate(want) : normRef(got) === normRef(want));
      rescueRows.push({
        id: g.id, type: g.type_slug, key, critical: isRoleRef || isRoleDate,
        rescueConf: r.conf, finalConf: e.confidence != null ? e.confidence : null,
        leaked: (e.confidence != null && e.confidence > 85),
        note: !!(e.validation_note && String(e.validation_note).trim()),
        value: got, want, correct,
      });
    }
  }

  const rows = []; let autoFiled = 0, scored = 0;
  for (const fname of files) {
    const m = res[fname], g = gt[fname]; if (!m) continue;
    scored++;
    const role = roles[g.type_slug] || {};
    const detSlug = m._document_slug || nameToSlug[m.document_type] || null;
    const detId = slugToId[detSlug];
    let wouldFile = false;
    if (detId != null && m.overall_confidence != null) {
      const rex = Object.entries(m.extractions || {}).map(([k, e]) => ({
        field_key: k, display_value: (e && typeof e === 'object') ? e.value : e,
        validation_note: (e && typeof e === 'object') ? e.validation_note : null,
        confidence: (e && typeof e === 'object') ? e.confidence : null,
      }));
      try { wouldFile = trust.isAutoFileEligible(db, { id: g.id, supplier_name: m.supplier_name, document_type_id: detId, overall_confidence: m.overall_confidence }, { extractions: rex }).eligible; } catch {}
    }
    if (wouldFile) autoFiled++;

    for (const r of (rejects[fname] || [])) {
      if (r.method !== 'anchor_crop') continue;                       // the RIGID crop only
      if (!['not_credible', 'format'].includes(r.reason)) continue;   // the two stash sites
      const key = r.field; if (!key) continue;
      const e = (m.extractions || {})[key] || {};
      const committed = ef(m, key);
      if (!committed) continue;                                       // nothing committed -> nothing to dissent from
      const method = e.method || null;
      const vt = key === role.date ? 'date' : (fieldType[key] || 'alphanumeric');
      const isRoleRef = key === role.ref, isRoleDate = key === role.date;
      const want = isRoleRef ? g.ref : (isRoleDate ? g.date : null);
      const correct = want == null ? null
        : (isRoleDate ? normDate(committed) === normDate(want) : normRef(committed) === normRef(want));
      rows.push({
        id: g.id, fn: g.fn, type: g.type_slug, key, vt, wouldFile,
        taught: taught.has(`${normSupplier(m.supplier_name)}|${g.type_slug}|${key}`),
        indep: INDEP.has(method), method, conf: e.confidence != null ? e.confidence : null,
        hasNote: !!(e.validation_note && String(e.validation_note).trim()),
        committed, want, correct, isRoleRef, isRoleDate, refLike: isRefLike(key),
        rejRaw: r.value, rejReason: r.reason,
        R: pReggie(r.value, committed), G: pGary(r.value, committed, vt),
      });
    }
  }
  fs.rmSync(RR, { recursive: true, force: true });
  db.close();

  // A fire only COSTS anything on a doc that would auto-file today and is not already held.
  const eligible = rows.filter(r => r.wouldFile && !r.hasNote && r.taught && r.indep);
  const scopes = {
    'role ref only':          r => r.isRoleRef,
    'role ref + role date':   r => r.isRoleRef || r.isRoleDate,
    'any ref-like + any date': r => r.refLike || r.vt === 'date',
  };
  const L = [];
  L.push(`# Late-rescue CAP LEAK + rejected-crop dissent — ${scored} docs scored, ${autoFiled} would auto-file`);
  L.push('');
  L.push('## A. Stage-2.6 late-rescue cap leak (engine.py:3628 caps 85; 2.5b +8 and 4.5 +5 undo it)');
  const leaked = rescueRows.filter(r => r.leaked);
  const leakedCrit = leaked.filter(r => r.critical);
  L.push(`- late-rescue fields seen: **${rescueRows.length}** across ${new Set(rescueRows.map(r => r.id)).size} docs`);
  L.push(`- rescued fields whose FINAL confidence exceeds the 85 cap: **${leaked.length}** (critical ref/date: **${leakedCrit.length}**)`);
  L.push(`- of the leaked CRITICAL ones: wrong **${leakedCrit.filter(r => r.correct === false).length}**, correct **${leakedCrit.filter(r => r.correct === true).length}**, unscored ${leakedCrit.filter(r => r.correct === null).length}`);
  L.push(`- leaked critical fields ABOVE the 88 critical floor with no note (i.e. the cap alone would hold them): **${leakedCrit.filter(r => !r.note && r.finalConf >= 88).length}**`);
  L.push('');
  L.push('| id | type | field | rescue conf | final conf | value | want | correct |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of rescueRows.sort((a, b) => a.id - b.id))
    L.push(`| #${r.id} | ${r.type} | ${r.key}${r.critical ? ' **(critical)**' : ''} | ${r.rescueConf} | ${r.finalConf}${r.leaked ? ' **LEAK**' : ''} | \`${r.value}\` | \`${r.want}\` | ${r.correct === null ? '-' : r.correct} |`);
  L.push('');
  L.push('## B. Rejected-crop dissent (the ref-hold guard proposal)');
  L.push(`(untraced baseline was 387/514 — if this differs, --trace is NOT behaviour-neutral and the run is void.)`);
  L.push(`Rigid-crop rejects on a committed field: **${rows.length}**; of those, eligible to fire (would-auto-file, not already held, taught anchor, independent winner): **${eligible.length}**`);
  L.push('');
  L.push('## Cost / reward matrix — newly HELD documents');
  L.push('| predicate | scope | newly held | WRONG today (reward) | CORRECT today (cost) | unscored |');
  L.push('|---|---|---|---|---|---|');
  const uniq = set => new Set(set.map(r => r.id)).size;
  for (const [pn, pf] of [['P_REGGIE', r => r.R.fire], ['P_GARY', r => r.G.fire]])
    for (const [sn, sf] of Object.entries(scopes)) {
      const hit = eligible.filter(r => sf(r) && pf(r));
      L.push(`| ${pn} | ${sn} | ${uniq(hit)} | ${uniq(hit.filter(r => r.correct === false))} | ${uniq(hit.filter(r => r.correct === true))} | ${uniq(hit.filter(r => r.correct === null))} |`);
    }
  L.push('');
  L.push('## Bound sweep (P_REGGIE, role ref only) — how many diffs to allow');
  for (const K of [1, 2, 3, 4]) {
    const hit = eligible.filter(r => r.isRoleRef && r.R.k != null && r.R.k > 0 && r.R.k <= K && r.R.why !== 'no_candidate' && r.R.why !== 'not_unique' && r.R.n >= R_MIN_DIGITS);
    L.push(`- K=${K}: held ${uniq(hit)} — wrong ${uniq(hit.filter(r => r.correct === false))}, correct ${uniq(hit.filter(r => r.correct === true))}`);
  }
  L.push('');
  L.push('## Refusal attribution (eligible rows that did NOT fire) — where each predicate stops');
  for (const [pn, sel] of [['P_REGGIE', r => r.R.why], ['P_GARY', r => r.G.why]]) {
    const c = {}; for (const r of eligible) { const k = sel(r); if (k !== 'FIRE') c[k] = (c[k] || 0) + 1; }
    L.push(`- ${pn}: ` + (Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'));
  }
  L.push('');
  L.push('## Every eligible row (the decision set)');
  L.push('| id | type | field | committed | rejected crop | reason | R.k | R | G.k | G | correct today |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of eligible.sort((a, b) => a.id - b.id))
    L.push(`| #${r.id} | ${r.type} | ${r.key} | \`${r.committed}\` | ${JSON.stringify(r.rejRaw)} | ${r.rejReason} | ${r.R.k == null ? '-' : r.R.k} | ${r.R.fire ? '**FIRE**' : r.R.why} | ${r.G.k == null ? '-' : r.G.k} | ${r.G.fire ? '**FIRE**' : r.G.why} | ${r.correct === null ? '-' : r.correct} |`);
  L.push('');
  L.push('## Canary #259 (must fire under the shipped predicate)');
  for (const r of rows.filter(r => r.id === 259))
    L.push(`- ${r.key}: committed \`${r.committed}\` vs crop ${JSON.stringify(r.rejRaw)} — R=${r.R.fire ? 'FIRE' : r.R.why}(k=${r.R.k}) G=${r.G.fire ? 'FIRE' : r.G.why}(k=${r.G.k}) wouldFile=${r.wouldFile} hasNote=${r.hasNote} taught=${r.taught} indep=${r.indep} method=${r.method}`);

  const txt = L.join('\n');
  fs.writeFileSync(path.join(OUT, 'rejectcrop_measure.md'), txt);
  console.log(txt);
})();
