/** shadow_row_skip_ab.js — TRUST_SHADOW_ROW_SKIP live-DB re-judge (Oracle C2, BLOCKING).
 *
 *  WHY THIS EXISTS. realdoc_regression scores CONFIRMED documents and reports 536 -> 538. Oracle
 *  refused that as the whole gate for a trust.js LENIENCY, because the precedent flip in this same
 *  file (TRUST_NONROLE_SHAPE_LENIENT, trust.js:278-283) cleared a corpus A/B *plus* a live-DB
 *  re-judge — "29 documents flip, 0 with a ROLE blocking key". This is that second half.
 *
 *  PASS CRITERIA (all three, Oracle C2):
 *    (a) every newly-eligible document's OFF reason is exactly `unverifiable-value:<k>` where k is
 *        one of the four money roles the shadow writer can emit;
 *    (b) k is not a field of that document's type and not a structural role key — ZERO newly
 *        eligible documents with a ROLE blocking key;
 *    (c) the visible fields of every newly-eligible document are printed for a human spot-check.
 *
 *  TWO ARMS, because the class is transient:
 *    ARM 1  STORED rows over needs_review + deferred — the population Oracle named. Shadow rows are
 *           DELETED at confirm, so whether this arm is even non-empty depends on what is in the
 *           queue right now. If it is flat, the report says so AND says why, rather than passing.
 *    ARM 2  FRESH extraction over that queue PLUS every document whose type does not define the
 *           money roles (where the shadow writer actually fires), judged through the same overlay
 *           realdoc uses — with extraction_method threaded, or the gate is vacuously green.
 *
 *  Read-only: the live DB is opened readonly, documents run from temp copies, nothing is written.
 *  Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe stress_test/shadow_row_skip_ab.js
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require('better-sqlite3');
const trust = require(path.join(REPO, 'database', 'modules', 'trust.js'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null;
try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
// engine.py:2820 — the ONLY keys the shadow writer can emit. A blocking key outside this set on a
// newly-eligible document would mean the skip is firing on something it was never scoped to.
const MONEY_ROLES = new Set(['subtotal', 'vat_tax', 'shipping', 'discount']);

const w = (t, d) => { const f = path.join(os.tmpdir(), `sr_${t}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, d) => { try { return fn(); } catch { return d; } };

function runP(folder, args, files, manifest) {
  return new Promise(resolve => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', w('s', files),
      '--mode', 'smart', '--tesseract', TESS, '--reprocess-manifest', w('m', manifest), ...args],
      { windowsHide: true, env: { ...process.env } });
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
  // The env var wins over the setting in BOTH directions (trust.js _shadowRowSkipEnabled), so the
  // two arms are unambiguous no matter what the live setting says.
  const db = new Database(path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db'), { readonly: true });

  const typeFields = new Map();     // document_type_id -> Set(field keys)
  for (const r of db.prepare('SELECT document_type_id, key FROM fields').all()) {
    if (!typeFields.has(r.document_type_id)) typeFields.set(r.document_type_id, new Set());
    typeFields.get(r.document_type_id).add(r.key);
  }
  const dtById = new Map(db.prepare('SELECT * FROM document_types').all().map(t => [t.id, t]));
  const COMPANY_KEYS = require(path.join(REPO, 'database', 'modules', 'document_types.js')).COMPANY_KEYS;
  const roleKeysOf = (typeId) => {
    const t = dtById.get(typeId) || {};
    return new Set([...COMPANY_KEYS, t.ref_field_key, t.date_field_key].filter(Boolean));
  };

  const judge = (doc, extractions, armed) => {
    const opts = { shadowRowSkip: armed };
    if (extractions) opts.extractions = extractions;
    try { return trust.isAutoFileEligible(db, doc, opts); }
    catch (e) { return { eligible: false, reason: 'threw:' + e.message }; }
  };

  const verdict = (label, moved, rows) => {
    console.log(`\n  ${label}: ${moved.length} document(s) newly eligible`);
    let badReason = 0, roleBlock = 0;
    for (const m of moved) {
      const k = String(m.offReason || '').startsWith('unverifiable-value:')
        ? m.offReason.slice('unverifiable-value:'.length) : null;
      const inSet = k && MONEY_ROLES.has(k);
      const isRole = k && roleKeysOf(m.doc.document_type_id).has(k);
      const isDefined = k && (typeFields.get(m.doc.document_type_id) || new Set()).has(k);
      if (!inSet) badReason++;
      if (isRole || isDefined) roleBlock++;
      console.log(`    #${m.doc.id} OFF=${m.offReason}  key=${k || '-'}`
        + `  money-role=${inSet ? 'yes' : 'NO <<<'}  role-key=${isRole ? 'YES <<<' : 'no'}`
        + `  defined-field=${isDefined ? 'YES <<<' : 'no'}`);
      const vis = (rows.get(m.doc.id) || []).filter(e => (typeFields.get(m.doc.document_type_id) || new Set()).has(e.field_key));
      console.log(`       visible fields: ` + (vis.length
        ? vis.map(e => `${e.field_key}=${JSON.stringify(e.display_value)}`).join('  ') : '(none)'));
    }
    console.log(`    (a) reasons all unverifiable-value on a money role: ${badReason === 0 ? 'PASS' : 'FAIL (' + badReason + ')'}`);
    console.log(`    (b) zero blocked on a ROLE or DEFINED key:          ${roleBlock === 0 ? 'PASS' : 'FAIL (' + roleBlock + ')'}`);
  };

  // ─────────────────────────── ARM 1 — stored rows, the queue ───────────────────────────
  const queue = db.prepare(`SELECT id, supplier_name, document_type_id, overall_confidence, status,
                                   working_path, stored_path, template_id
                              FROM documents WHERE status IN ('needs_review','deferred') ORDER BY id`).all();
  console.log(`ARM 1 — STORED rows, ${queue.length} needs_review/deferred documents`);
  const storedRows = new Map();
  let queueShadow = 0;
  for (const d of queue) {
    const rows = db.prepare('SELECT field_key, display_value, raw_value, validation_note, extraction_method, confidence FROM extractions WHERE document_id = ?').all(d.id);
    storedRows.set(d.id, rows);
    queueShadow += rows.filter(r => r.extraction_method === 'shadow_reconcile').length;
  }
  const moved1 = [];
  for (const d of queue) {
    const off = judge(d, null, false), on = judge(d, null, true);
    if (!off.eligible && on.eligible) moved1.push({ doc: d, offReason: off.reason });
  }
  console.log(`  shadow_reconcile rows resident on that queue: ${queueShadow}`);
  if (queueShadow === 0) {
    console.log('  EXPLAINED FLAT LANE: shadow rows are DELETED at confirm and none of the queued');
    console.log('  documents currently hold one, so the skip has nothing to fire on here. This arm');
    console.log('  proves NO REGRESSION on the queue; the heal evidence is ARM 2, which re-extracts.');
  }
  verdict('ARM 1', moved1, storedRows);

  // ───────── ARM 2 — fresh extraction where the shadow writer actually fires ─────────
  // Every document whose TYPE does not define the money roles is a candidate; the queue is included
  // whatever its type so the population Oracle named is never dropped.
  const all = db.prepare(`SELECT id, supplier_name, document_type_id, overall_confidence, status,
                                 working_path, stored_path, template_id,
                                 (SELECT slug FROM document_types WHERE id=document_type_id) type_slug
                            FROM documents WHERE status != 'deleted' ORDER BY id`).all();
  // A document only mints a shadow row when the PAGE actually carries the money figures the type
  // has no field for — "the type lacks the role" alone selects almost the whole corpus and mostly
  // picks documents with no totals on them at all, which is how the first run of this harness came
  // back VACUOUS over 60 documents. Prefer documents that carry a money value today.
  const hasMoney = new Set(db.prepare(`
      SELECT DISTINCT document_id FROM extractions
       WHERE field_key IN ('total_amount','total','amount_due','subtotal','vat_tax')
         AND TRIM(COALESCE(display_value,'')) <> ''`).all().map(r => r.document_id));
  const explicit = String(process.env.SR_IDS || '').split(',').map(s => s.trim()).filter(Boolean).map(Number);
  const lacksRole = (d) => {
    const f = typeFields.get(d.document_type_id) || new Set();
    return [...MONEY_ROLES].some(k => !f.has(k));
  };
  const candidates = explicit.length
    ? all.filter(d => explicit.includes(d.id))
    : all.filter(d => (d.status === 'needs_review' || d.status === 'deferred')
                      || (lacksRole(d) && hasMoney.has(d.id)));
  const LIMIT = Number(process.env.SR_LIMIT || 60);
  const chosen = candidates.slice(0, LIMIT);
  console.log(`\nARM 2 — FRESH extraction, ${chosen.length} of ${candidates.length} candidate documents`
    + (candidates.length > LIMIT ? `  (capped by SR_LIMIT=${LIMIT}; raise it for the full population)` : ''));

  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'shadowab-'));
  const files = [], manifest = {}, docOf = {};
  for (const d of chosen) {
    const src = (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : d.stored_path;
    if (!src || !fs.existsSync(src)) continue;
    const f = `doc${d.id}.pdf`;
    fs.copyFileSync(src, path.join(RR, f));
    manifest[f] = { known_template_id: d.template_id, known_doc_slug: d.type_slug };
    docOf[f] = d; files.push(f);
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

  const R = await runP(RR, args, files, manifest);
  try { fs.rmSync(RR, { recursive: true, force: true }); } catch {}

  const freshRows = new Map();
  const moved2 = [];
  let shadowSeen = 0, docsWithShadow = 0;
  for (const f of files) {
    const m = R[f]; const d = docOf[f];
    if (!m || m.overall_confidence == null) continue;
    // The SAME overlay realdoc builds — extraction_method threaded, or the gate tests nothing.
    const rex = Object.entries(m.extractions || {}).map(([k, e]) => ({
      field_key: k,
      display_value: (e && typeof e === 'object') ? e.value : e,
      raw_value: null,
      validation_note: (e && typeof e === 'object') ? e.validation_note : null,
      confidence: (e && typeof e === 'object') ? e.confidence : null,
      extraction_method: (e && typeof e === 'object') ? e.method : null,
    }));
    freshRows.set(d.id, rex);
    const sh = rex.filter(r => r.extraction_method === 'shadow_reconcile');
    shadowSeen += sh.length; if (sh.length) docsWithShadow++;
    const fake = { id: d.id, supplier_name: m.supplier_name, document_type_id: d.document_type_id,
                   overall_confidence: m.overall_confidence, template_id: d.template_id };
    const off = judge(fake, rex, false), on = judge(fake, rex, true);
    if (!off.eligible && on.eligible) moved2.push({ doc: fake, offReason: off.reason });
    if (off.eligible && !on.eligible) console.log(`  #${d.id} REVERSE MOVE — eligible OFF, blocked ON <<< IMPOSSIBLE, investigate`);
  }
  console.log(`  shadow_reconcile rows minted by the fresh run: ${shadowSeen} across ${docsWithShadow} documents`);
  if (shadowSeen === 0) console.log('  <<< ARM 2 IS VACUOUS — no shadow rows were produced, so nothing was tested.');
  verdict('ARM 2', moved2, freshRows);
  db.close();
})();
