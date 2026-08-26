'use strict';

// ── Extractions ───────────────────────────────────────────────────────────────

function insertExtractions(db, document_id, rows) {
  const stmt = db.prepare(`
    INSERT INTO extractions
      (document_id, field_key, raw_value, display_value,
       confidence, extraction_method, validation_note, corrected_to, anchor_label, candidates, suggested_supplier, corroboration)
    VALUES
      (@document_id, @field_key, @raw_value, @display_value,
       @confidence, @extraction_method, @validation_note, @corrected_to, @anchor_label, @candidates, @suggested_supplier, @corroboration)
  `);
  const insertMany = db.transaction((rows) => {
    // corrected_to is the proposed (not-yet-applied) correction candidate from
    // Stage 4.5; anchor_label records the label an anchor-based read used (for the
    // review "From anchor:" note); candidates is the disambiguation-picker JSON (migration
    // 48); corroboration is the independent method-family agreement record (owner principle
    // 2026-08-11 — record-only, nothing gates on it). All default to null so callers that
    // don't set them are unaffected — and the null default is REQUIRED (better-sqlite3
    // throws "missing named parameter" without it).
    for (const row of rows) stmt.run({ document_id, corrected_to: null, anchor_label: null, candidates: null, suggested_supplier: null, corroboration: null, ...row });
  });
  insertMany(rows);
}

function deleteExtractions(db, document_id) {
  return db.prepare(
    'DELETE FROM extractions WHERE document_id = ?'
  ).run(document_id);
}

// ── Corrections & hints ───────────────────────────────────────────────────────

// Strip leading/trailing quote/apostrophe/replacement-char noise from a supplier
// name so the same real supplier always keys to ONE learning bucket. JS mirror
// of keyword.normalize_supplier_name in the Python extractor: a stray OCR smart
// quote ("‘Cloud VPS") otherwise splits a supplier's corrections/hints/anchors
// across two spellings, so neither accumulates and reprocess never improves.
// Only edge noise is removed (interior chars and a legitimate trailing "." like
// "Inc." are preserved); falls back to the trimmed original if it would empty.
function normalizeSupplierName(name) {
  if (name == null) return name;
  const s = String(name).trim();
  const cleaned = s.replace(/^[\s'‘’“”‛′‵`�]+|[\s'‘’“”‛′‵`�]+$/g, '');
  return cleaned || s;
}

// Is `value` plausible as a SUPPLIER IDENTITY (not a generic field value)?
// JS mirror of keyword._is_plausible_supplier_name in the Python extractor:
// a bare 2-3 char all-caps no-digit token ("IN"/"INV" from "INVOICE") is a
// document-structure fragment, never a company name. Shape test only — no
// supplier is hardcoded. Short all-caps brands ("IBM") are flagged here too;
// callers apply "unless uniquely supported" (we only block the PASSED-THROUGH,
// un-corrected supplier identity — an explicit user correction still persists).
// Word-quality mirror of python_backend/extraction/value_quality.name_quality —
// compact heuristic (no word list: supplier names are Title-case, so proper-noun +
// abbreviation shape covers them). A token is "good" if it's a known abbreviation,
// or a Title-case proper noun (>=4, with a vowel, no 4+ consonant run); fragments
// ("Fr"), digit/symbol-only ("67"), gibberish and mixed-case junk ("OMe") are bad.
const _VQ_ABBREV = new Set(['ltd','inc','plc','llc','llp','co','corp','gmbh','srl','sa','sas',
  'ag','bv','nv','pty','pvt','spa','oy','ab','ni','uk','us','usa','eu','ie','roi','uae','&']);
const _VQ_VOWELS = new Set(['a','e','i','o','u','y']);
function _vqLongConsonantRun(low) {
  let run = 0;
  for (const c of low) {
    if (c >= 'a' && c <= 'z' && !_VQ_VOWELS.has(c)) { if (++run >= 4) return true; }
    else run = 0;
  }
  return false;
}
function _vqTokenGood(tok) {
  const t = tok.replace(/^[.,;:()[\]{}'"`/\\|]+|[.,;:()[\]{}'"`/\\|]+$/g, '');
  if (!t) return null;
  if (t.includes('�')) return false;
  const low = t.toLowerCase();
  if (_VQ_ABBREV.has(low)) return true;
  if (!/[A-Za-z]/.test(t)) return false;          // digit/symbol-only ("67")
  if (t.length <= 2) return false;                // fragment ("Fr","St","WM")
  if (![...low].some(c => _VQ_VOWELS.has(c))) return false;  // consonant gibberish
  // Proper-noun shape (len>=4, no 4+ consonant run): Title-case ("Beaumont") OR
  // ALL-CAPS ("BEAUMONT") — many invoices print the company name in capitals, so an
  // all-caps alphabetic token is real name content. Mirrors value_quality._token_good.
  if (t.length >= 4 && !_vqLongConsonantRun(low)) {
    const titleCase = t[0] === t[0].toUpperCase() && t[0] !== t[0].toLowerCase()
                      && t.slice(1) === t.slice(1).toLowerCase();
    const allCaps   = /^[A-Za-z]+$/.test(t) && t === t.toUpperCase();
    if (titleCase || allCaps) return true;
  }
  return false;
}
// TEACH-TIME PLAUSIBILITY WARNING for a taught ISSUER read (Chris round 2, 2026-08-11).
//
// THE DEFECT IT ANSWERS. A ⊕ teach read `@a eens Ee` off the page, showed a green
// "Captured the Document Issuer position from this layout" toast, flagged nothing, and let the
// operator file — producing two output folders (`@a-eens-Ee` and `a-eens-Ee`) that differ only by a
// leading `@`. His diagnosis is the one worth keeping: **every guard in this product is pointed at
// ABSENCE, none at CONFIDENT NONSENSE.** The app warns plainly when the issuer is EMPTY and says
// nothing at all when it is gibberish. A taught read is deliberately exempt from the shape gates
// (`shape_mode='ignore'` — a human drew the box) but the human drew a BOX; they did not verify the
// READ, and the toast told them it had worked.
//
// WHY NOT `isPlausibleSupplierName`, which already exists: MEASURED, it rejects `BP`, `IBM` and any
// other <=3-char all-caps name on a rule written for a different job (extraction-time filtering of
// caption fragments). Using it here would nag a customer whose supplier really is BP, on a correct
// value, at the exact moment they are being helpful. So this is a NARROWER, warning-only predicate.
//
// THE RULE, and every clause is there because a real name failed without it:
//   * a value with NO letters at all is never a company name;
//   * a SINGLE-token value is never judged — that is what makes `BP` / `IBM` / `3M` / `H&M`
//     structurally immune, and it is why this cannot inherit the <=3-char defect above;
//   * one-letter tokens are dropped before scoring, because `J S Bloggs` and `A J Smith Ltd` are
//     ordinary UK small-business names and their initials are not gibberish;
//   * only then is the shared `nameQuality` consulted, on the substantive tokens.
//
// MEASURED 2026-08-11: 0 false positives over 22 real company names (BP, IBM, 3M, H&M, P&O
// Ferries, W H Smith, J S Bloggs, E.ON UK plc, Marks & Spencer plc and the seven corpus suppliers);
// catches 10 of 11 junk reads observed in Chris's round, including the one that made the folders.
// KNOWN MISS, stated rather than tuned away: a garble whose tokens are individually word-shaped
// (`RENN ERNE, Nh`) scores 0.67 and passes. Tightening the floor to catch it costs real names.
//
// WARNING ONLY. It must never block a confirm, rewrite a value, or reject a teach — the app's
// review-not-reject posture, and the same posture the EMPTY-issuer note already takes.
function issuerReadLooksImplausible(value) {
  const t = String(value == null ? '' : value).trim();
  if (!t) return false;                       // empty is the OTHER guard's job, and it has one
  if (!/[A-Za-z]/.test(t)) return true;
  // Leading DEBRIS: a company name does not begin with punctuation. Same signal the crop
  // credibility check already uses for free text ('>alifornia', '. Ship Mode:'), and it is what
  // catches '=state -', whose only substantive token would otherwise leave nothing to score.
  // Safe against every real name tested: they all begin with a letter or a digit (3M, 24/7).
  if (!/^[A-Za-z0-9]/.test(t)) return true;
  if (!/\s/.test(t)) {
    // Single token -> not judged (the BP/IBM immunity) — with ONE carve-out (owner exhibit
    // 2026-08-11: a drawn box caught the word 'Order' off "ORDER CONFIRMATION" and the teach
    // congratulated itself): a bare DOCUMENT-CHROME word is a page title fragment, never a
    // company. The closed chrome set can't collide with BP/IBM/3M — none are chrome words.
    return _DOC_CHROME_WORDS.has(t.toLowerCase().replace(/[^a-z]/g, ''));
  }
  const kept = t.split(/\s+/).filter(w => w.replace(/[^A-Za-z0-9]/g, '').length > 1);
  if (kept.length < 2) return false;          // nothing substantive left to judge
  return nameQuality(kept.join(' ')) < 0.5;
}

// ── "That is one character off a company you already use" ────────────────────────────────────
// THE SIGNAL THE PLAUSIBILITY CHECK ABOVE CANNOT CARRY, and Chris named it himself in round 4:
// `B8ramblewood Joinery Ltd` *looks* like a company name — it passes `issuerReadLooksImplausible`
// by construction — so shape can never catch it. What is wrong with it is that the customer
// already files 38 documents under `Bramblewood Joinery Ltd`. The catching signal is NEAR MATCH TO
// A KNOWN COMPANY.
//
// This is the READ-BACK half of the write guard shipped in `dc4bf1d`: `templates._upsertFields`
// now silently KEEPS the incumbent frozen identity when the incoming value is a near match, and a
// refusal nobody can see is indistinguishable from the app ignoring the operator. Same comparison
// module (`name_proximity`, the JS twin of Python's `name_match`), so the sentence on screen and
// the decision in the database can never disagree.
//
// TWO SOURCES, TWO TIERS.
//
// TIER A — HUMAN CONFIRMS (`source: 'confirms'`). `documents.supplier_name` on CONFIRMED documents,
// excluding every machine `confirmed_via` — because the exhibit's own 20 poisoned documents were
// machine-stamped at 95, and a machine cohort must never become the "name you already use" that the
// app offers back. `minConfirms` defaults to 3 so a single earlier typo cannot become the target.
//
// TIER B — FROZEN TEMPLATE IDENTITIES (`source: 'template'`, Chris round 5 card 3). A FRESH install
// has ZERO confirmed documents, so Tier A is empty and the challenge never fired for the person
// holding the pen — yet the correct spelling was sitting right there, frozen on the sender's own
// taught layout (`template_fields.fixed_value`, the seeded/curated identity). Tier B surfaces it so
// the ASK fires from document one. It is ASK-ONLY: Tier A OUTRANKS it (a frozen value can itself be
// a prior garble), and the >= minConfirms human-confirm bar still governs everything that WRITES
// (the write guard `teach_identity_near_match_keep` is unchanged).
//
// ADVISORY ONLY: returns a verdict, changes nothing, blocks nothing. The caller decides whether to
// offer the incumbent; the operator decides whether to take it.
function findNearMatchIdentity(db, candidate, { minConfirms = 3, templateId = null } = {}) {
  const { nearMatchIdentity, tokenSubrunIdentity } = require('./name_proximity');
  const v = String(candidate == null ? '' : candidate).trim();
  if (!v) return { near: false, reason: 'empty' };
  // Older DBs / fixtures predate confirmed_via (migration 57) — fall back to counting every
  // confirmed row rather than failing the query, exactly as trust.js does.
  let hasVia = true;
  try { db.prepare('SELECT confirmed_via FROM documents LIMIT 0'); } catch { hasVia = false; }
  const { MACHINE_VIAS_SQL } = require('./machine_vias');
  let best = null;
  // Ranking (Chris r17 card 3): Tier A (confirms) > Tier B (template); within a tier an EDIT hit
  // (kind 'edit') > a SUB-RUN hit (kind 'subrun'); within the same kind, the closer match. A sub-run hit
  // on the document's OWN template (opts.templateId) is reported as source 'prefix-template' — the
  // wizard's strongest sentence ("the name this layout already uses").
  const consider = (existing, n, source, tplId = null) => {
    if (!existing) return;
    let verdict = nearMatchIdentity(v, existing);
    let kind = 'edit';
    if (!verdict.near) { verdict = tokenSubrunIdentity(v, existing); kind = 'subrun'; }
    if (!verdict.near) return;
    const tier = (s) => (s === 'confirms' ? 2 : 1);
    const rank = (b) => tier(b.source === 'prefix-template' ? 'template' : b.source) * 10 + (b.kind === 'edit' ? 1 : 0);
    const cand = { near: true, existing, confirms: n, similarity: verdict.similarity, distance: verdict.distance, kind,
                   source: (kind === 'subrun' && source === 'template' && templateId != null && Number(tplId) === Number(templateId)) ? 'prefix-template' : source };
    if (!best || rank(cand) > rank(best) || (rank(cand) === rank(best) && cand.similarity > best.similarity)) best = cand;
  };
  // Tier A — human confirms.
  try {
    for (const r of db.prepare(`
      SELECT TRIM(supplier_name) AS v, COUNT(*) AS n
      FROM documents
      WHERE status = 'confirmed' AND supplier_name IS NOT NULL AND TRIM(supplier_name) <> ''
        ${hasVia ? `AND COALESCE(confirmed_via, '') NOT IN (${MACHINE_VIAS_SQL})` : ''}
      GROUP BY LOWER(TRIM(supplier_name))
    `).all()) {
      if (r.v && r.n >= minConfirms) consider(r.v, r.n, 'confirms');
    }
  } catch { /* fall through to Tier B rather than failing the whole challenge */ }
  // Tier B — frozen template identities (ASK-only; the fresh-install source).
  try {
    for (const r of db.prepare(`
      SELECT TRIM(fixed_value) AS v, template_id AS tid
      FROM template_fields
      WHERE field_key = 'supplier_name' AND is_variable = 0
        AND fixed_value IS NOT NULL AND TRIM(fixed_value) <> ''
    `).all()) {
      consider(r.v, null, 'template', r.tid);
    }
  } catch { /* older DBs without template_fields — any Tier A result still stands */ }
  return best || { near: false, reason: 'no-near-match' };
}

function nameQuality(value) {
  if (!value) return 1.0;
  let good = 0, bad = 0;
  for (const m of String(value).split(/\s+/)) {
    const r = _vqTokenGood(m);
    if (r === true) good++; else if (r === false) bad++;
  }
  const total = good + bad;
  return total === 0 ? 1.0 : good / total;
}

// Document-chrome / TITLE words a large page heading garbles into — a closed,
// supplier-agnostic set. Mirror of _DOC_CHROME_WORDS in
// python_backend/extraction/keyword.py (keep in lockstep).
const _DOC_CHROME_WORDS = new Set([
  'invoice', 'statement', 'purchase', 'order', 'sales', 'delivery', 'docket',
  'note', 'receipt', 'credit', 'debit', 'quote', 'quotation', 'remittance',
  'worksheet', 'bill', 'advice', 'proforma', 'estimate', 'ticket', 'memo',
  'packing', 'slip',
]);

function _boundedLevenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[n];
}

// Mirror of keyword._is_doc_chrome_fragment — a short OCR near-form of a title-word prefix.
function _isDocChromeFragment(core) {
  if (_DOC_CHROME_WORDS.has(core)) return true;         // a whole title word read as the supplier
  const L = core.length;
  if (L < 2 || L > 5) return false;
  const budget = L <= 3 ? 1 : 2;
  for (const w of _DOC_CHROME_WORDS) {
    if (w.length >= L && _boundedLevenshtein(core, w.slice(0, L)) <= budget) return true;
  }
  return false;
}

// SHAPE-only plausibility (the base rules WITHOUT the document-chrome layer). Used where a
// chrome-SHAPED but genuine short name ("Dell"/"Sage", edit-1 from a title prefix) must NOT be
// demoted — judging an already-RESOLVED / CONFIRMED identity (template-name adopt, repair-suspect
// scan). The chrome layer is an EXTRACTION-time filter (see isPlausibleSupplierName). Mirror of
// keyword._is_plausible_supplier_name_base (Python).
function isPlausibleSupplierNameBase(value) {
  const t = String(value == null ? '' : value).trim().replace(/:+$/, '');
  if (!t) return false;
  if (t.length <= 3 && !/\s/.test(t) && t === t.toUpperCase() && !/\d/.test(t)) {
    return false;
  }
  // Digit-dominant reference misread: 2+ digits AND <3 letters. Keeps letter-rich names that
  // merely contain digits ("3M", "G2 Environmental", "24/7 Services").
  const nAlpha = (t.match(/[A-Za-z]/g) || []).length;
  const nDigit = (t.match(/\d/g) || []).length;
  if (nAlpha < 3 && nDigit >= 2) return false;
  // Word-quality gate (MULTI-word only): a mostly-gibberish multi-token read is not a supplier.
  if (/\s/.test(t) && nameQuality(t) < 0.5) return false;
  return true;
}

// = the shape BASE test PLUS a document-CHROME near-form reject (kill switch
// SUPPLIER_CHROME_FRAGMENT_GUARD). A large TITLE ("INVOICE") OCR-garbles into a short token
// ("INi"/"INGE"/"IN \") that slips the all-caps guard and wins the supplier field. Demote it so a
// garble is never PERSISTED as a learned hint (the hint-persist caller uses THIS full form).
// CORROBORATED-value callers (template-name adopt, repair-suspect) use isPlausibleSupplierNameBase
// so a real short name is never chrome-demoted (Oracle 2026-07-14). Mirror of keyword._is_plausible_supplier_name.
function isPlausibleSupplierName(value) {
  if (!isPlausibleSupplierNameBase(value)) return false;
  if (process.env.SUPPLIER_CHROME_FRAGMENT_GUARD !== '0') {
    const t = String(value == null ? '' : value).trim().replace(/:+$/, '');
    const core = t.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (t.split(/\s+/).length <= 2 && _isDocChromeFragment(core)) return false;
  }
  return true;
}

// FAITHFUL JS mirror of python_backend/extraction/value_quality.py `is_name_like_field`
// (the .py docstring pointer to a value_quality.js is STALE — no such file existed; this is it).
// True for a field that holds a NAME / company / person / POSTAL address. Keyed on field key + label
// so it works for custom fields too. Semantics are MIXED (Oracle C3): SUBSTRING match for the
// inclusion words, SUBSTRING "address" gated by a WHOLE-WORD technical-address exclusion (mac/ip/…),
// and WHOLE-WORD "cust". Separators are normalised to spaces so "mac_address"/"bill_to" tokenise as
// whole words. Used by the template-field builder to NEVER freeze a recipient name (only the issuer
// is legitimately constant). Guarded by database/modules/test_build_template_fields.js.
function isNameLikeField(key, label) {
  const hay = `${key || ''} ${label || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const INCLUDE = ['name', 'supplier', 'customer', 'company', 'client', 'vendor',
                   'person', 'contact', 'payee', 'bill to', 'ship to'];
  if (INCLUDE.some(tok => hay.includes(tok))) return true;
  if (hay.includes('address') &&
      !/\b(mac|ip|ipv4|ipv6|hardware|physical|network|gateway|subnet|dns|host|port)\b/.test(hay)) return true;
  return hay.split(/\s+/).filter(Boolean).includes('cust');
}

function saveCorrections(db, document_id, corrections,
                         supplier_name, document_type, allValues, taughtFields = [], opts = {}) {
  // The confirmed/edited supplier_name field (allValues.supplier_name) is the
  // identity the user just reviewed and accepted — the same source
  // _buildTemplateFields() uses for the template corpus. The `supplier_name`
  // parameter reflects the document's PRE-CONFIRM extracted identity, which
  // can differ when the user corrects a misread supplier name in this same
  // cycle. Preferring the stale value here split learning rows (hints,
  // corrections, anchors) across multiple spellings of "the same" supplier —
  // none ever accumulating enough usage_count to be applied — while templates
  // converged correctly on the corrected name. Preferring the confirmed value
  // keeps both corpora keyed to the same identity going forward.
  const effectiveSupplier = normalizeSupplierName(
    (allValues && String(allValues.supplier_name || '').trim()) || supplier_name || '__global__'
  );
  const taught = new Set(taughtFields);
  // Batch-audit / "Quick check" grid (2026-08-24, Oracle SIGN-OFF-W/COND Condition 2): the grid fixes
  // VALUE misreads (I/1, O/0, slash-drop) where the anchor POSITION was CORRECT — the read was wrong,
  // not the placement. The default clearAnchors-on-correct below assumes "corrected ⇒ the anchor was
  // wrong", which is FALSE for that surface; wiping the scope's learned position per correction across a
  // batch degrades future extraction (the opposite of the goal). When the caller marks the whole call
  // value-only (server-side only — reviewService threads it from its INTERNAL arg, never a client
  // payload), preserve every field's anchor. Killable via BATCH_AUDIT_PRESERVE_ANCHORS at the caller.
  const _preserveAllAnchors = !!(opts && opts.preserveAllAnchors);

  const insertCorr = db.prepare(`
    INSERT INTO corrections
      (document_id, field_key, original_value, corrected_value,
       supplier_name, document_type)
    VALUES
      (@document_id, @field_key, @original_value, @corrected_value,
       @supplier_name, @document_type)
  `);

  // Reflect a confirmed edit back onto the STORED extraction. getWithExtractions
  // (the Review / Search / Learning-History reload) reads extractions.display_value
  // and does NOT merge the corrections table — so without this an edit made on an
  // already-confirmed doc (Learning History "Open in Review", Learning Repair
  // send-back) persisted only in corrections/hints/the re-filed copy and looked
  // "lost" when the doc was reopened. No-op when the field has no extraction row.
  const updateExtractionValue = db.prepare(`
    UPDATE extractions SET display_value = @corrected_value, was_corrected = 1
    WHERE document_id = @document_id AND field_key = @field_key
  `);

  // CONFIRM-UPSERT (Oracle-signed, 2026-07-10): a value typed into a field that the
  // engine never READ has NO extraction row — the import only inserts rows for fields
  // it extracted, and the UPDATE above is a no-op without a row. The typed value then
  // lived ONLY in corrections, and every learning reader (getFieldFormats /
  // getFieldValueHistory / getDocumentsForFieldValue / dominant-snap) selects FROM
  // extractions with corrections merely LEFT-JOINed — so confirmed values were
  // INVISIBLE to learning ("worksheets are no longer learning values": two confirmed
  // docs, an empty Learning-history modal), invisible to search, and lost when the
  // doc was reopened. Insert the missing row as an explicit MANUAL read: method
  // 'manual' (exempt from the recipient-caption issuer guard; never consulted by any
  // auto-file path — those run at PROCESSING time, this row is born at CONFIRM time),
  // confidence 100 (a human typed it), corrected_to NULL (that column is the engine's
  // auto-correction signal — the Review "corrected" chip keys off it).
  const insertManualExtraction = db.prepare(`
    INSERT INTO extractions
      (document_id, field_key, raw_value, display_value, confidence,
       extraction_method, was_corrected, validation_note, corrected_to, anchor_label)
    VALUES
      (@document_id, @field_key, NULL, @corrected_value, 100,
       'manual', 1, NULL, NULL, NULL)
  `);

  const upsertHint = db.prepare(`
    INSERT INTO supplier_hints
      (supplier_name, document_type, field_key, hint_value, usage_count, last_seen)
    VALUES
      (@supplier_name, @document_type, @field_key, @hint_value, 1, datetime('now'))
    ON CONFLICT(supplier_name, document_type, field_key, hint_value) DO UPDATE SET
      usage_count = usage_count + 1,
      last_seen   = datetime('now')
  `);

  db.transaction(() => {
    // Save explicit corrections
    for (const [field_key, { original_value, corrected_value }]
         of Object.entries(corrections)) {
      insertCorr.run({
        document_id, field_key, original_value, corrected_value,
        supplier_name: effectiveSupplier, document_type: document_type || null,
      });
      // Keep the stored extraction in step with the confirmed value (see above).
      const _upd = updateExtractionValue.run({ document_id, field_key, corrected_value: corrected_value ?? '' });
      // No row to update → the field was never read: persist the typed value as a
      // manual extraction row so it exists for learning/search/reopen (see above).
      if (_upd.changes === 0 && corrected_value && String(corrected_value).trim()) {
        insertManualExtraction.run({ document_id, field_key, corrected_value: String(corrected_value) });
      }
      if (corrected_value) {
        upsertHint.run({
          supplier_name: effectiveSupplier, document_type: document_type || null,
          field_key, hint_value: corrected_value,
        });
        // Also save as global
        if (effectiveSupplier !== '__global__') {
          upsertHint.run({
            supplier_name: '__global__', document_type: document_type || null,
            field_key, hint_value: corrected_value,
          });
        }
        // Clear bad anchors — if the user had to manually correct this field,
        // the stored anchor position was wrong. Wipe it so a correct one can
        // be re-learned. EXCEPT: when the new value came from the ⊕ highlight/
        // zone-OCR teaching tool in this same cycle, captureAnchorContext()
        // already saved the anchor for that exact position moments ago — that
        // is the system *learning*, not evidence of a *wrong* anchor. Treating
        // it as a correction would wipe the anchor immediately after teaching
        // it, so anchors could never survive a single confirm cycle for ANY
        // supplier/template (the dominant lifecycle bug — not specific to one
        // document or field). Skipping the wipe here is what lets future
        // teachings accumulate via saveAnchor's usage_count/confidence upsert.
        if (!taught.has(field_key) && !_preserveAllAnchors) {
          clearAnchors(db, {
            supplier_name: effectiveSupplier,
            document_type: document_type || null,
            field_key,
          });
        }
      }
    }

    // Save all confirmed values as hints — includes custom fields
    if (allValues) {
      for (const [field_key, val] of Object.entries(allValues)) {
        if (val && String(val).trim() && !corrections[field_key]) {
          // Supplier-identity guard (scoped to supplier_name only): a
          // passed-through, un-corrected supplier name that is an implausible
          // short fragment ("IN"/"INV" seeded by a stale template) must not
          // become reusable identity memory — that self-hint is exactly what
          // engine.py's Stage 2.5a text-scan reads back to RE-identify a
          // supplier, so persisting it re-poisons every future run. An
          // explicit user correction goes through the corrections loop above
          // and is preserved as normal (handles legitimately short names the
          // user actually typed). Other fields are untouched.
          if (field_key === 'supplier_name' && !isPlausibleSupplierName(val)) {
            continue;
          }
          upsertHint.run({
            supplier_name: effectiveSupplier,
            document_type: document_type || null,
            field_key, hint_value: String(val).trim(),
          });
        }
      }
    }
  })();
}

// ── retractConfirmHints — the INVERSE of saveCorrections' hint plants (Oracle-signed 2026-07-23,
// C1-C3; co-located DIRECTLY below the plant so the pair can't drift). deconfirmDocument reverses
// only the LIVE-derived half of confirm learning; the stored-increment half (supplier_hints) had
// no inverse — a poisoned confirm's hints kept filling fields at usage>=2 after send-back.
// Decrement-by-one is the ONLY faithful semantics: usage_count is NOT a pure function of current
// confirmed docs (renameSupplier merges, mig-45 deletions, cycle-scoped increments), so a full
// re-derive would silently rewrite untouched suppliers' counts install-wide. Mirrors the plant
// branch-for-branch:
//   corrections-path: LATEST corrections row per field → retract (supplier, UNTRIMMED exact) and,
//     only when the scope isn't '__global__', the '__global__' twin (C3 — the plant skipped the
//     separate global upsert for a null-supplier doc).
//   allValues-path (fields with no corrections row): TRIMMED display_value, supplier-scoped only,
//     with the SAME isPlausibleSupplierName skip on supplier_name (C2 — a passthrough-'IN' doc
//     never planted, so its retract must never touch a corrected-'IN' row another doc planted).
// C1: AT MOST ONE row per (scope, field, value) — exact match first, TRIM(hint_value) fallback
// ONLY when exact missed (the :279 plant stores untrimmed while :328 trims; a single OR-match
// could decrement BOTH variants = over-removal of another doc's contribution). A missing row is
// 0 changes, never negative — other docs' contributions are arithmetic residue, untouched.
// Guarded by database/modules/test_repair_unplant.js (round-trip vs a pristine plant of doc B).
function retractConfirmHints(db, document_id) {
  const doc = db.prepare(`
    SELECT d.supplier_name, dt.slug AS type_slug
    FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.id = ?`).get(document_id);
  if (!doc) return { decremented: 0, deleted: 0 };
  const eff = normalizeSupplierName(String(doc.supplier_name || '').trim() || '__global__');
  const dt = doc.type_slug || null;

  const pickExact = db.prepare(`
    SELECT id, usage_count FROM supplier_hints
    WHERE supplier_name = @s AND COALESCE(document_type, '') = COALESCE(@dt, '')
      AND field_key = @f AND hint_value = @v
    ORDER BY id LIMIT 1`);
  const pickTrim = db.prepare(`
    SELECT id, usage_count FROM supplier_hints
    WHERE supplier_name = @s AND COALESCE(document_type, '') = COALESCE(@dt, '')
      AND field_key = @f AND TRIM(hint_value) = @v
    ORDER BY id LIMIT 1`);
  const delRow = db.prepare('DELETE FROM supplier_hints WHERE id = ?');
  const decRow = db.prepare('UPDATE supplier_hints SET usage_count = usage_count - 1 WHERE id = ?');

  let decremented = 0, deleted = 0;
  const retractOne = (scope, field, value) => {
    const v = String(value == null ? '' : value);
    if (!v) return;
    let row = pickExact.get({ s: scope, dt, f: field, v });
    if (!row) row = pickTrim.get({ s: scope, dt, f: field, v: v.trim() });
    if (!row) return;
    if ((row.usage_count || 0) <= 1) { delRow.run(row.id); deleted++; }
    else { decRow.run(row.id); decremented++; }
  };

  // corrections-path (C2): the LATEST corrections row per field is what the last confirm planted.
  const latest = new Map();
  for (const r of db.prepare(
    'SELECT field_key, corrected_value FROM corrections WHERE document_id = ? ORDER BY rowid'
  ).all(document_id)) {
    latest.set(r.field_key, r.corrected_value);
  }
  for (const [field, v] of latest) {
    if (!v) continue;
    retractOne(eff, field, v);
    if (eff !== '__global__') retractOne('__global__', field, v);
  }
  // allValues-path: final confirmed values, minus corrected fields (the plant skipped them here).
  for (const r of db.prepare(
    'SELECT field_key, display_value FROM extractions WHERE document_id = ?'
  ).all(document_id)) {
    if (latest.has(r.field_key)) continue;
    const v = String(r.display_value || '').trim();
    if (!v) continue;
    if (r.field_key === 'supplier_name' && !isPlausibleSupplierName(v)) continue;
    retractOne(eff, r.field_key, v);
  }
  return { decremented, deleted };
}

// ── replantConfirmHints — the inverse of retractConfirmHints, for the recycle-bin RESTORE of a
// doc whose DELETE retracted (C6, owner-ruled 2026-07-23). Restore returns a filed doc to
// 'confirmed', so its hint votes must return too, or delete→restore silently un-learns a good
// doc. Mirrors retract's traversal EXACTLY (corrections-path latest-row untrimmed + __global__
// twin only when scoped; allValues-path trimmed display, plausibility skip) using the SAME
// upsert semantics as the original plant (+1 or insert-at-1). MUST only run when
// documents.learning_retracted_at proves the delete actually retracted — a blind re-plant on a
// pre-feature deletion double-counts forever (pinned). Round trip pinned: retract∘replant ==
// identity on supplier_hints (modulo last_seen).
function replantConfirmHints(db, document_id) {
  const doc = db.prepare(`
    SELECT d.supplier_name, dt.slug AS type_slug
    FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.id = ?`).get(document_id);
  if (!doc) return { planted: 0 };
  const eff = normalizeSupplierName(String(doc.supplier_name || '').trim() || '__global__');
  const dt = doc.type_slug || null;
  const upsert = db.prepare(`
    INSERT INTO supplier_hints
      (supplier_name, document_type, field_key, hint_value, usage_count, last_seen)
    VALUES (@s, @dt, @f, @v, 1, datetime('now'))
    ON CONFLICT(supplier_name, document_type, field_key, hint_value) DO UPDATE SET
      usage_count = usage_count + 1, last_seen = datetime('now')`);
  let planted = 0;
  const plantOne = (s, f, v) => { if (v) { upsert.run({ s, dt, f, v: String(v) }); planted++; } };

  const latest = new Map();
  for (const r of db.prepare(
    'SELECT field_key, corrected_value FROM corrections WHERE document_id = ? ORDER BY rowid'
  ).all(document_id)) {
    latest.set(r.field_key, r.corrected_value);
  }
  for (const [field, v] of latest) {
    if (!v) continue;
    plantOne(eff, field, v);
    if (eff !== '__global__') plantOne('__global__', field, v);
  }
  for (const r of db.prepare(
    'SELECT field_key, display_value FROM extractions WHERE document_id = ?'
  ).all(document_id)) {
    if (latest.has(r.field_key)) continue;
    const v = String(r.display_value || '').trim();
    if (!v) continue;
    if (r.field_key === 'supplier_name' && !isPlausibleSupplierName(v)) continue;
    plantOne(eff, r.field_key, v);
  }
  return { planted };
}

// The TRAINING dump — every hint row, uncapped (2026-07-10). buildTrainingArgs used the
// bare getHints(db) below, whose default LIMIT 100 (by usage_count DESC) silently
// STARVED the engine once the corpus grew past 100 rows: every new supplier's usage-1/2
// hints — exactly the learning a fresh confirm creates — never reached _apply_hints,
// the 2.5a identity text-scan, the variability evidence guard, or the identity rescue
// (535 rows live, 435 invisible when this was caught). "No silent caps": the engine
// must see the whole corpus; the capped form remains for scoped/display callers.
function getAllHints(db) {
  return db.prepare('SELECT * FROM supplier_hints ORDER BY usage_count DESC').all();
}

function getHints(db, { supplier_name, document_type, limit = 100 } = {}) {
  if (supplier_name && document_type) {
    return db.prepare(`
      SELECT * FROM supplier_hints
      WHERE (supplier_name = ? OR supplier_name = '__global__')
        AND (document_type = ? OR document_type IS NULL)
      ORDER BY usage_count DESC LIMIT ?
    `).all(supplier_name, document_type, limit);
  }
  return db.prepare(`
    SELECT * FROM supplier_hints
    ORDER BY usage_count DESC LIMIT ?
  `).all(limit);
}

// ── Field anchors ─────────────────────────────────────────────────────────────

function clearAnchors(db, { supplier_name, document_type, field_key }) {
  // Clear for the specific supplier AND for '__unknown__' / null suppliers,
  // since anchors are often saved before the supplier is identified.
  const stmt = db.prepare(`
    DELETE FROM field_anchors
    WHERE field_key = @field_key
      AND (
        supplier_name = @supplier_name
        OR supplier_name = '__unknown__'
        OR supplier_name IS NULL
      )
  `);
  return stmt.run({
    supplier_name: supplier_name || '__unknown__',
    field_key,
  });
}

// "Same spot" tolerance floor (normalized page-fraction) for anchors saved
// without usable w_norm/h_norm — keeps the distance check meaningful even
// when the stored box has zero/near-zero recorded dimensions.
const ANCHOR_MIN_TOLERANCE = 0.015;

// ── CONFIRM PERSISTS APPROVED VALUES (gary design → Oracle SIGN-OFF-W/COND C1-C5, 2026-08-18) ──
// A TAUGHT document contributed NOTHING to learning. The confirm-upsert
// (`insertManualExtraction`) fires only from the CORRECTIONS loop, and the teach wizard sends
// `corrections: []` by design — it has nothing to "correct", the operator pointed at values and
// approved them. Every taught value therefore travelled the allValues path, which plants hints
// only, and `getFieldFormats` reads FROM extractions — so the most deliberate act in the product
// was invisible to the evidence that decides whether a sender can file itself. Measured on the
// owner's install: 9 of 10 taught documents had no supplier_name row; several had none at all.
//
// This mints a row for an approved value that has NO row yet. INSERT-ONLY-WHEN-ABSENT is
// load-bearing: an existing row may carry `+confirmed_adopt` / `+name_repair` provenance whose
// unconditional exclusions (see getFieldFormats) depend on that row surviving untouched.
// NEVER add an UPDATE or backfill arm — pinned in test_confirmed_value_rows.js.
// C5 read pattern (env wins both directions, setting is the product truth) — the same shape
// trust.js uses for its arms, so a harness can force either state without a DB write.
// SCOPE, stated because silence is how a fix creeps (Oracle C4): this de-duplicates the
// corrections join in getFieldFormats ONLY. The identical fan-out in getFieldValueHistory's
// COUNT(*) and getPrefixModelForScope is OUT of scope for this slice and left untouched —
// neither feeds the filing gate; logged in pendingfeatures.
function _dedupeCorrections(db) {
  const env = process.env.FORMAT_CORRECTIONS_DEDUPE;
  if (env === '1') return true;
  if (env === '0') return false;
  try { return getSetting(db, 'format_corrections_dedupe', 'false') === 'true'; } catch { return false; }
}

// Slice 0 (Oracle SIGN-OFF-W/COND 2026-08-19): exclude values that a REWRITE created from the two
// corpora that judge rewrites. DEFAULT OFF — unlike the three unconditional marker clauses, this one
// shrinks a live corpus (`+snapped` rows have existed since July), which can de-graduate a scope.
// The shrink direction is fail-safe, so the code ships ahead of the census that licenses the flip.
function _excludeRewriteMarkers(db) {
  const env = process.env.LEARNING_EXCLUDE_REWRITE_MARKERS;
  if (env === '1') return true;
  if (env === '0') return false;
  try { return getSetting(db, 'learning_exclude_rewrite_markers', 'false') === 'true'; } catch { return false; }
}

function persistConfirmedValues(db, document_id, allValues) {
  if (!document_id || !allValues || typeof allValues !== 'object') return 0;
  const has = db.prepare('SELECT 1 FROM extractions WHERE document_id = ? AND field_key = ? LIMIT 1');
  const ins = db.prepare(`
    INSERT INTO extractions
      (document_id, field_key, raw_value, display_value, confidence,
       extraction_method, was_corrected, validation_note, corrected_to, anchor_label)
    VALUES
      (@document_id, @field_key, NULL, @display_value, NULL,
       'operator_confirmed', 0, NULL, NULL, NULL)`);
  let n = 0;
  db.transaction(() => {
    for (const [field_key, raw] of Object.entries(allValues)) {
      const val = String(raw == null ? '' : raw).trim();
      if (!val) continue;
      // Oracle C2: the SAME refusal the hint plant makes (this file, the allValues loop) and that
      // the retract/replant pair mirrors — a passthrough implausible issuer ("IN"/"INV" from a
      // garbled title) must never become reusable identity memory. An extraction row is a WIDER
      // channel than a hint (it feeds the format corpus, value history and the dominant readers),
      // so the guard matters more here, not less.
      if (field_key === 'supplier_name' && !isPlausibleSupplierName(val)) continue;
      if (has.get(document_id, field_key)) continue;      // never touch an existing row
      ins.run({ document_id, field_key, display_value: val });
      n++;
    }
  })();
  return n;
}

// How many confirmed documents a (supplier, type, field) group needs before its learned format is
// SOLID rather than provisional — and therefore before `trust.docTrustGate` will verify a value
// against it at all (the gate reads the non-provisional list by design). Named and exported
// 2026-08-18 because it is the number a customer actually experiences: below it, a correctly-read
// document from a new sender cannot auto-file at any confidence under 100, and until today nothing
// on screen said so (Chris: "a hold with no visible cause is the worst state in the app").
// Mirrors ocr_corrector.MIN_CONFIRMED_FOR_SINGLE_SHAPE.
const FORMAT_SOLID_MIN = 3;

function _centerDistance(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

// Strip DOCUMENT-SPECIFIC tokens (reference numbers, dates, serials) from an
// auto-detected anchor label so the stored label is a STABLE caption that
// generalises across documents. An auto-detected label such as
// "2605-0769-1 Work Address" bakes in ONE document's reference number, so the
// anchor can never be re-located on a document with a different reference — the
// "anchor won't drift with the page" failure. A token is document-specific when
// it carries no letter (a bare number / reference / date) or is a code-like
// serial (>= 3 digits). Returns the cleaned caption, or '' when nothing stable
// remains. Reusable for every supplier/field; no per-document logic.
// MIRROR PAIR: src/windows/shared/anchorLabel.js sanitizeAnchorLabel MUST stay identical —
// a divergence here re-strips a renderer-approved label AND nulls its drift offset below.
function sanitizeAnchorLabel(label) {
  if (!label || typeof label !== 'string') return '';
  const kept = label.trim().split(/\s+/).filter(tok => {
    // A STANDALONE '#' is caption punctuation ("SO #", "Item #"), never a value — keep it:
    // it's the uniqueness that makes a 2-char stem locatable (reggie, 2026-07-10).
    if (/^#[.:]?$/.test(tok)) return true;
    if (!/[a-zA-Z]/.test(tok)) return false;                // bare number / ref / date
    if ((tok.match(/\d/g) || []).length >= 3) return false; // code-like serial
    return true;
  });
  if (!kept.some(t => /[a-zA-Z]/.test(t))) return '';       // a label must carry letters
  return kept.join(' ').trim();
}

function saveAnchor(db, {
  supplier_name, document_type, field_key,
  anchor_label, direction, page_zone, x_norm, y_norm,
  w_norm = 0, h_norm = 0, authoritative = false,
  offset_dx_norm = null, offset_dy_norm = null,
  label_detected = false
}) {
  // Keep only the stable caption. If sanitising changes the label, the stored
  // drift-invariant offset was measured against the POLLUTED label's position
  // (e.g. a reference number's left edge), so it no longer matches the caption
  // we'll re-locate at extraction time — drop it so extraction falls back to the
  // geometric guess (value adjacent to the located clean caption).
  const _clean = sanitizeAnchorLabel(anchor_label);
  if (_clean && _clean !== (anchor_label || '').trim()) {
    anchor_label  = _clean;
    offset_dx_norm = null;
    offset_dy_norm = null;
  }
  // Drop a PHANTOM field-name label — one SYNTHESISED from the field name (the ⊕
  // fallback when no caption could be OCR'd, "Supplier Name" for the supplier_name
  // field) — because the page never says it, so the anchor would blind-crop stale
  // coordinates forever and (if authoritative) shadow a correct mapping. But a label
  // OCR'd FROM THE PAGE (label_detected) that merely HAPPENS to equal the field key is
  // a REAL, locatable caption and must be KEPT — a custom field named exactly what the
  // document says ("Make" → on-page "Make", "Serial Number" → "Serial number") is the
  // common case, and dropping it left the field a label-less blind crop that drifts.
  if (anchor_label && field_key && !label_detected) {
    const ln = anchor_label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (ln === String(field_key).toLowerCase()) {
      anchor_label   = '';
      offset_dx_norm = null;
      offset_dy_norm = null;
    }
  }
  // Same phantom class via the field's DISPLAY LABEL (Oracle-signed belt-and-braces,
  // 2026-07-10): migration 38 renamed the identity display to "Document Issuer" while
  // the KEYS stayed supplier_name/customer_name, so the field-key check above never
  // caught a label synthesised from the display name — "Document Issuer" anchors
  // reached the DB, and the anchor engine then silently dropped their reads on every
  // doc (the "my issuer teach never sticks" loop). A label OCR'd FROM THE PAGE
  // (label_detected) that merely equals the display label is a REAL caption — kept,
  // exactly like the field-key check. Lookup is best-effort (minimal test DBs may
  // lack the fields tables — treat as no-match).
  if (anchor_label && field_key && !label_detected) {
    let displayLabel = null;
    try {
      const row = db.prepare(`
        SELECT f.label AS label FROM fields f
        JOIN document_types dt ON dt.id = f.document_type_id
        WHERE dt.slug = ? AND f.key = ?
      `).get(String(document_type || ''), String(field_key));
      displayLabel = row && row.label;
    } catch { /* fields tables absent (minimal fixture) → no-match */ }
    if (displayLabel) {
      const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (norm(anchor_label) === norm(displayLabel)) {
        anchor_label   = '';
        offset_dx_norm = null;
        offset_dy_norm = null;
      }
    }
  }

  const key = {
    supplier_name: supplier_name || '__unknown__',
    document_type: document_type || null,
    field_key, anchor_label, direction,
  };
  const incoming = {
    page_zone,
    x_norm: x_norm || 0, y_norm: y_norm || 0,
    w_norm: w_norm || 0, h_norm: h_norm || 0,
    // Drift-invariant label→value offset (only the ⊕ teach supplies it; passive
    // auto-learn leaves it null). Stored on the authoritative path below.
    offset_dx_norm: (offset_dx_norm === null || offset_dx_norm === undefined) ? null : offset_dx_norm,
    offset_dy_norm: (offset_dy_norm === null || offset_dy_norm === undefined) ? null : offset_dy_norm,
  };

  // ── Authoritative re-teach (operator EXPLICITLY redrew the box via ⊕) ────────
  // An explicit human correction is the highest-quality signal we ever get and
  // must take effect immediately — never be averaged toward a stale position or
  // out-voted by a high passive usage_count. So we TRUST the drawn coordinates
  // outright (no tolerance test, no usage-weighted blend) and COLLAPSE every
  // other anchor for this (supplier, doc_type, field): a previous teach can have
  // produced a sibling row under a slightly different auto-derived anchor_label,
  // and _filter_anchors would otherwise keep selecting the stale sibling by
  // usage_count. Stamping last_authoritative_at lets extraction prefer this row.
  // A mis-teach is cheap to recover from — just redraw again (also authoritative).
  if (authoritative) {
    // Remove sibling anchors for the SAME field + doc_type + THIS SUPPLIER that are
    // not this exact label+direction, so the just-drawn box is the single source of
    // truth for the field's position for this supplier and no stale same-supplier row
    // can win selection.
    //
    // Scope is (field_key, document_type, supplier_name) — the sweep is SUPPLIER-SCOPED
    // (gary Slice 1, 2026-07-09). It used to run ACROSS ALL SUPPLIERS on the premise
    // "the doc-type IS the layout", but that is FALSE for a multi-supplier type like
    // Invoice: teaching one supplier's field then DELETED every other supplier's learned
    // anchor for that field ("I taught one Anconia doc and it broke my other suppliers").
    // A teach is tagged to the confirmed supplier (review/renderer.js), so it belongs to
    // that supplier's layout, not to every sender of the type. The companion fix that
    // stops a cross-supplier authoritative anchor from OUT-RANKING a supplier's own anchor
    // at read time is _filter_anchors' supplier-aware auth priority (anchor.py) + the
    // located-at-taught-position gate; a genuinely shared single-layout type opts in via
    // the __global__ sentinel supplier. Guarded by database/modules/test_saveanchor_scope.js.
    db.prepare(`
      DELETE FROM field_anchors
      WHERE field_key = @field_key
        AND ((document_type IS @document_type) OR document_type = @document_type)
        AND supplier_name = @supplier_name
        AND NOT (anchor_label = @anchor_label AND direction = @direction)
    `).run(key);

    const existingAuth = db.prepare(`
      SELECT id FROM field_anchors
      WHERE supplier_name = @supplier_name AND document_type = @document_type
        AND field_key = @field_key AND anchor_label = @anchor_label AND direction = @direction
    `).get(key);

    if (existingAuth) {
      db.prepare(`
        UPDATE field_anchors
        SET page_zone = @page_zone, x_norm = @x_norm, y_norm = @y_norm,
            w_norm = @w_norm, h_norm = @h_norm,
            max_w_norm = MAX(COALESCE(max_w_norm, 0), @w_norm),
            offset_dx_norm = @offset_dx_norm, offset_dy_norm = @offset_dy_norm,
            usage_count = usage_count + 1,
            confidence  = 1.0,
            last_seen   = datetime('now'),
            last_authoritative_at = datetime('now')
        WHERE id = @id
      `).run({ id: existingAuth.id, page_zone: incoming.page_zone, ...incoming });
    } else {
      db.prepare(`
        INSERT INTO field_anchors
          (supplier_name, document_type, field_key, anchor_label, direction,
           page_zone, x_norm, y_norm, w_norm, h_norm, max_w_norm,
           offset_dx_norm, offset_dy_norm, last_authoritative_at)
        VALUES
          (@supplier_name, @document_type, @field_key, @anchor_label, @direction,
           @page_zone, @x_norm, @y_norm, @w_norm, @h_norm, @w_norm,
           @offset_dx_norm, @offset_dy_norm, datetime('now'))
      `).run({ ...key, ...incoming });
    }
    return;
  }

  // `=` (not `IS`) deliberately mirrors the NULL-never-matches semantics of
  // the unique index this replaces — ON CONFLICT(supplier_name, document_type,
  // field_key, anchor_label, direction) never fires when any key column is
  // NULL (SQLite treats each NULL as distinct), so those anchors always
  // inserted fresh. Using `=` here reproduces that exactly: NULL = NULL is
  // NULL/false, so such rows still always take the insert branch below.
  const existing = db.prepare(`
    SELECT id, x_norm, y_norm, w_norm, h_norm, usage_count
    FROM field_anchors
    WHERE supplier_name = @supplier_name AND document_type = @document_type
      AND field_key = @field_key AND anchor_label = @anchor_label AND direction = @direction
  `).get(key);

  if (!existing) {
    db.prepare(`
      INSERT INTO field_anchors
        (supplier_name, document_type, field_key, anchor_label,
         direction, page_zone, x_norm, y_norm, w_norm, h_norm, max_w_norm)
      VALUES
        (@supplier_name, @document_type, @field_key, @anchor_label,
         @direction, @page_zone, @x_norm, @y_norm, @w_norm, @h_norm, @w_norm)
    `).run({ ...key, ...incoming });
    return;
  }

  // "Same spot?" is judged PER-AXIS, each axis against its OWN stored dimension
  // (half the width horizontally, half the height vertically, both floored at
  // ANCHOR_MIN_TOLERANCE). A single radial tolerance taken from max(w,h) let the
  // box WIDTH set the vertical threshold — value boxes are wide and short, so a
  // deliberate one-text-line-down correction (a small dy) fell inside half the
  // width and was misclassified as a refinement, then blended away on a
  // high-usage anchor. Component-wise tolerance keeps a vertical line move a
  // genuine correction while still absorbing true jitter. (Passive path only —
  // an explicit ⊕ re-teach is handled authoritatively above.)
  const tolX = Math.max(existing.w_norm, ANCHOR_MIN_TOLERANCE) / 2;
  const tolY = Math.max(existing.h_norm, ANCHOR_MIN_TOLERANCE) / 2;
  const withinSpot = Math.abs(incoming.x_norm - existing.x_norm) <= tolX
                  && Math.abs(incoming.y_norm - existing.y_norm) <= tolY;

  let next;
  if (withinSpot) {
    // Refinement: usage-weighted running average. A well-established anchor
    // (high usage_count) barely moves on each new consistent sample and
    // converges/stabilizes — instead of being perturbed by a fixed 50% on
    // every re-teach forever, which is how drift accumulated previously.
    const n = existing.usage_count || 1;
    const blend = (oldVal, inVal) => (oldVal * n + inVal) / (n + 1);
    next = {
      x_norm: blend(existing.x_norm, incoming.x_norm),
      y_norm: blend(existing.y_norm, incoming.y_norm),
      w_norm: incoming.w_norm > 0 ? blend(existing.w_norm, incoming.w_norm) : existing.w_norm,
      h_norm: incoming.h_norm > 0 ? blend(existing.h_norm, incoming.h_norm) : existing.h_norm,
    };
  } else {
    // Correction: the new box sits materially away from the stored one — the
    // user redrew it somewhere else on purpose. Trust it outright rather than
    // diluting it into the very position it's correcting (blending a
    // correction into a wrong position is what produces two fields' anchors
    // overlapping and cropping near-identical garbage).
    next = {
      x_norm: incoming.x_norm,
      y_norm: incoming.y_norm,
      w_norm: incoming.w_norm > 0 ? incoming.w_norm : existing.w_norm,
      h_norm: incoming.h_norm > 0 ? incoming.h_norm : existing.h_norm,
    };
  }

  db.prepare(`
    UPDATE field_anchors
    SET usage_count = usage_count + 1,
        confidence  = MIN(1.0, confidence + 0.1),
        page_zone   = @page_zone,
        x_norm      = @x_norm,
        y_norm      = @y_norm,
        w_norm      = @w_norm,
        h_norm      = @h_norm,
        max_w_norm  = MAX(COALESCE(max_w_norm, 0), @incoming_w_raw),
        last_seen   = datetime('now')
    WHERE id = @id
  `).run({ id: existing.id, page_zone: incoming.page_zone, incoming_w_raw: incoming.w_norm || 0, ...next });
  // ↑ max_w_norm binds the RAW drawn width (incoming.w_norm), NOT the blended next.w_norm
  //   (:614 blends toward narrower samples) — this is the one line that makes the high-water
  //   monotonic, so a later narrow re-teach can never shrink the field and re-truncate a long
  //   value. (Oracle: the load-bearing line of the passive path.)
}

function getAllAnchors(db) {
  return db.prepare(
    'SELECT * FROM field_anchors ORDER BY usage_count DESC, confidence DESC'
  ).all();
}

// The learned ANCHORS that would apply for a (supplier, doc-type, field) scope — this supplier's
// own rows PLUS the global/unresolved ones (saved before the supplier was identified, mirroring
// clearAnchors' scope). Powers the Learning-history "learned anchors" panel so an operator can SEE
// where a field is being read from and DELETE an anchor stored at the wrong spot. Read-only.
function getAnchorsForScope(db, { supplier_name, document_type, field_key } = {}) {
  if (!field_key) return [];
  return db.prepare(`
    SELECT id, supplier_name, document_type, field_key, anchor_label, direction, page_zone,
           x_norm, y_norm, w_norm, h_norm, usage_count, confidence,
           last_authoritative_at, offset_dx_norm, offset_dy_norm
    FROM field_anchors
    WHERE field_key = @field_key
      AND (@document_type IS NULL OR COALESCE(document_type, '') = COALESCE(@document_type, ''))
      AND (LOWER(TRIM(COALESCE(supplier_name, ''))) = LOWER(TRIM(COALESCE(@supplier_name, '')))
           OR supplier_name IN ('__unknown__', '__global__') OR supplier_name IS NULL OR TRIM(supplier_name) = '')
    ORDER BY (last_authoritative_at IS NOT NULL) DESC, usage_count DESC, confidence DESC
  `).all({ supplier_name: supplier_name || '', document_type: document_type ?? null, field_key });
}

// The field_keys that have at least one learned anchor applicable to a (supplier, doc-type) scope —
// same scope rule as getAnchorsForScope (this supplier's own rows PLUS global/unresolved ones).
// Powers the Review per-field "position taught" dot so an operator can see at a glance which fields
// Scan Finder already knows where to read. `authoritative` is 1 when any in-scope anchor for that
// field came from an explicit ⊕ re-teach (vs a passively auto-learned position). Read-only.
function getTaughtFieldKeys(db, { supplier_name, document_type } = {}) {
  return db.prepare(`
    SELECT field_key,
           MAX(CASE WHEN last_authoritative_at IS NOT NULL THEN 1 ELSE 0 END) AS authoritative
    FROM field_anchors
    WHERE (@document_type IS NULL OR COALESCE(document_type, '') = COALESCE(@document_type, ''))
      AND (LOWER(TRIM(COALESCE(supplier_name, ''))) = LOWER(TRIM(COALESCE(@supplier_name, '')))
           OR supplier_name IN ('__unknown__', '__global__') OR supplier_name IS NULL OR TRIM(supplier_name) = '')
    GROUP BY field_key
  `).all({ supplier_name: supplier_name || '', document_type: document_type ?? null });
}

// Delete ONE learned anchor by id (Learning-history "learned anchors" panel → 🗑). Precise, reversible
// only by re-teaching (a mis-drawn anchor is cheap to redraw). Returns {removed}. Admin/edit, audited
// at the IPC edge.
function deleteAnchor(db, id) {
  const _id = parseInt(id, 10);
  if (!_id) return { removed: 0 };
  return { removed: db.prepare('DELETE FROM field_anchors WHERE id = ?').run(_id).changes };
}

// ── Logo fingerprints ─────────────────────────────────────────────────────────

// A NEW phash this many bits CLOSER to another supplier than to X's own = a cross-plant (poison).
const LOGO_CROSSPLANT_MARGIN = 4;

// DETAIL-space (256-bit isolated-mark) cross-plant guard (Oracle C1, 2026-07-15). Once the detail hash
// is promoted to a PRIMARY supplier picker (logo_detail.classify_supplier), one poisoned enrolled mark
// flips a real PICK — a mis-FILE — not a harmless abstain. So refuse to enrol OR backfill a detail mark
// that POSITIVELY belongs to a DIFFERENT supplier. Mirrors logo_detail.detail_cross_plant_closer
// (accept 80 / margin 24, measured). Must gate BOTH branches: the collide-at-8 COALESCE backfill path
// pre-empts the coarse insert guard (Cascade↔Northgate coarse phash = 8 ≤ 10), so the insert-branch
// coarse guard alone leaves the detail set open to poison.
const DETAIL_ACCEPT_DIST       = 80;
const DETAIL_CROSSPLANT_MARGIN = 24;

// 256-bit hex Hamming. Large sentinel on length-mismatch/empty — NOT 64 (which is a valid mid-range
// detail distance and would masquerade as a moderate match; hammingDistance's 64 fallback is for the
// 64-bit coarse phash only).
function detailHamming(h1, h2) {
  if (!h1 || !h2 || h1.length !== h2.length) return 1e9;
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    const xor = parseInt(h1[i], 16) ^ parseInt(h2[i], 16);
    dist += xor.toString(2).split('1').length - 1;
  }
  return dist;
}

// True → the incoming detail mark is decisively a DIFFERENT supplier's (matches a rival's enrolled set
// within accept AND is > margin closer to that rival than to this supplier's own set) → refuse to plant
// it under `supplier_name`. COLD-START SAFE: with no own detail yet (minOwn = ∞), a genuine first mark
// sits FAR from every rival (inter ~108 > accept 80) → not refused; only a mark that positively matches
// a rival is refused. FAIL-SAFE: missing detail / no rival detail → false (nothing to poison).
function _detailCrossPlantCloser(db, supplier_name, detail_hash) {
  if (!detail_hash) return false;
  let minOwn = Infinity;
  for (const r of db.prepare(
    'SELECT detail_hash FROM logo_fingerprints WHERE supplier_name = ? AND detail_hash IS NOT NULL'
  ).all(supplier_name)) {
    const d = detailHamming(detail_hash, r.detail_hash);
    if (d < minOwn) minOwn = d;
  }
  let minOther = Infinity;
  for (const r of db.prepare(
    'SELECT detail_hash FROM logo_fingerprints WHERE supplier_name <> ? AND detail_hash IS NOT NULL'
  ).all(supplier_name)) {
    const d = detailHamming(detail_hash, r.detail_hash);
    if (d < minOther) minOther = d;
  }
  if (minOther === Infinity) return false;                 // no rival detail to be closer to
  return minOther <= DETAIL_ACCEPT_DIST && (minOther + DETAIL_CROSSPLANT_MARGIN) < minOwn;
}

function saveLogoFingerprint(db, { supplier_name, phash, ahash, detail_hash, manual }) {
  const existing = db.prepare(
    'SELECT id, phash FROM logo_fingerprints WHERE supplier_name = ?'
  ).all(supplier_name);

  for (const row of existing) {
    if (hammingDistance(row.phash, phash) <= 10) {
      // Slice B: opportunistically BACKFILL the isolated-mark detail hash — a pre-migration print
      // has NULL detail_hash; COALESCE fills it from this confirm without overwriting an existing one
      // (the discriminator is a hash of the same mark, so any confirm's is equivalent). phash path
      // unchanged.
      // C1 (Oracle 2026-07-15): but REFUSE the backfill when this detail mark decisively belongs to a
      // RIVAL — the collide-at-8 coarse path lands HERE (before the insert cross-plant guard), so a
      // Northgate doc mis-confirmed under Cascade would otherwise poison Cascade's picker set. Pass
      // null so COALESCE leaves the row's detail_hash untouched; MANUAL bypasses (operator authority).
      const backfill = (detail_hash && !manual && _detailCrossPlantCloser(db, supplier_name, detail_hash))
        ? null : (detail_hash || null);
      db.prepare(`
        UPDATE logo_fingerprints
        SET match_count = match_count + 1, last_seen = datetime('now'),
            detail_hash = COALESCE(detail_hash, ?)
        WHERE id = ?
      `).run(backfill, row.id);
      return;
    }
  }
  // CROSS-PLANT GUARD (Oracle 2026-07-12) — stop the logo-collision poisoning loop: refuse to plant a
  // NEW phash under supplier X when it sits decisively CLOSER (by > MARGIN bits) to a DIFFERENT
  // supplier's existing print than to any of X's own — the signature of a mis-resolved doc appending a
  // rival's logo under X (a Thornbury "TF" mark saved under Cascade). Applies ONLY to the INSERT-new
  // branch (the UPDATE / match_count++ path above is untouched) and ONLY when X ALREADY has >=1 own
  // print — a supplier's FIRST-EVER logo is always planted (else a look-alike newcomer could never
  // learn a logo) — and an explicit operator MANUAL supplier assignment bypasses (operator authority).
  // Pure hash-space; no OCR. Defence-in-depth behind the engine branding-conflict flag (which routes a
  // mis-resolved doc to review BEFORE the confirm that would plant the poison).
  if (!manual && existing.length >= 1) {
    let minOwn = 64;
    for (const row of existing) minOwn = Math.min(minOwn, hammingDistance(row.phash, phash));
    let minOther = 64, otherName = null;
    for (const row of db.prepare(
      'SELECT supplier_name, phash FROM logo_fingerprints WHERE supplier_name <> ?'
    ).all(supplier_name)) {
      const d = hammingDistance(row.phash, phash);
      if (d < minOther) { minOther = d; otherName = row.supplier_name; }
    }
    if (minOther + LOGO_CROSSPLANT_MARGIN < minOwn) {
      return { skipped: true, reason: 'cross_plant', closerTo: otherName, minOther, minOwn };
    }
  }
  // C1: even when the coarse phash passes the cross-plant guard above, refuse to plant a detail mark
  // that decisively belongs to a rival (contradictory coarse-vs-detail evidence) — insert the phash
  // (coarse-vetted) but with a null detail rather than poisoning the picker set. MANUAL bypasses.
  const insDetail = (detail_hash && !manual && _detailCrossPlantCloser(db, supplier_name, detail_hash))
    ? null : (detail_hash || null);
  db.prepare(`
    INSERT INTO logo_fingerprints (supplier_name, phash, ahash, detail_hash)
    VALUES (?, ?, ?, ?)
  `).run(supplier_name, phash, ahash, insDetail);
}

function getAllLogos(db) {
  return db.prepare(
    'SELECT * FROM logo_fingerprints ORDER BY match_count DESC'
  ).all();
}

function hammingDistance(h1, h2) {
  if (!h1 || !h2 || h1.length !== h2.length) return 64;
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    const xor = parseInt(h1[i], 16) ^ parseInt(h2[i], 16);
    dist += xor.toString(2).split('1').length - 1;
  }
  return dist;
}

function findLogoMatch(db, phash, threshold = 12) {
  const all = getAllLogos(db);
  let best = null, bestDist = threshold + 1;
  for (const row of all) {
    const dist = hammingDistance(row.phash, phash);
    if (dist < bestDist) {
      bestDist = dist;
      best = { ...row, distance: dist, confidence: Math.max(0, 100 - dist * 6) };
    }
  }
  return best;
}

// ── Learning Recovery (Settings tab) ─────────────────────────────────────────
// Read-only inspection + small targeted cleanup for the AUTOMATIC learning
// corpora (field_anchors, supplier_hints, corrections, logo_fingerprints).
// Deliberately separate from database/modules/templates.js — managed
// templates are a distinct, admin-curated store and are not touched by the
// clear* functions below.

function getRecoverySummary(db, { supplier_name, document_type } = {}) {
  if (!supplier_name) return null;
  const dt = document_type || null;

  const anchors = db.prepare(`
    SELECT COUNT(*) AS n FROM field_anchors
    WHERE supplier_name = @supplier_name AND (@dt IS NULL OR document_type = @dt)
  `).get({ supplier_name, dt }).n;

  const hints = db.prepare(`
    SELECT COUNT(*) AS n FROM supplier_hints
    WHERE supplier_name = @supplier_name AND (@dt IS NULL OR document_type = @dt)
  `).get({ supplier_name, dt }).n;

  const corrections = db.prepare(`
    SELECT COUNT(*) AS n FROM corrections
    WHERE supplier_name = @supplier_name AND (@dt IS NULL OR document_type = @dt)
  `).get({ supplier_name, dt }).n;

  const logos = db.prepare(`
    SELECT COUNT(*) AS n FROM logo_fingerprints WHERE supplier_name = @supplier_name
  `).get({ supplier_name }).n;

  const rules = db.prepare(`
    SELECT COUNT(*) AS n FROM field_rules
    WHERE supplier_name = @supplier_name AND (@dt IS NULL OR document_type = @dt)
  `).get({ supplier_name, dt }).n;

  return { anchors, hints, corrections, logos, rules };
}

function getRecoveryDetail(db, { supplier_name, document_type } = {}, limit = 25) {
  if (!supplier_name) return null;
  const dt = document_type || null;

  const anchors = db.prepare(`
    SELECT field_key, anchor_label, direction, document_type, usage_count, confidence, last_seen
    FROM field_anchors
    WHERE supplier_name = @supplier_name AND (@dt IS NULL OR document_type = @dt)
    ORDER BY usage_count DESC LIMIT @limit
  `).all({ supplier_name, dt, limit });

  const hints = db.prepare(`
    SELECT field_key, hint_value, document_type, usage_count, last_seen
    FROM supplier_hints
    WHERE supplier_name = @supplier_name AND (@dt IS NULL OR document_type = @dt)
    ORDER BY usage_count DESC LIMIT @limit
  `).all({ supplier_name, dt, limit });

  const corrections = db.prepare(`
    SELECT field_key, original_value, corrected_value, document_type, corrected_at
    FROM corrections
    WHERE supplier_name = @supplier_name AND (@dt IS NULL OR document_type = @dt)
    ORDER BY corrected_at DESC LIMIT @limit
  `).all({ supplier_name, dt, limit });

  const logos = db.prepare(`
    SELECT phash, match_count, last_seen FROM logo_fingerprints
    WHERE supplier_name = @supplier_name
    ORDER BY match_count DESC LIMIT @limit
  `).all({ supplier_name, limit });

  const rules = db.prepare(`
    SELECT field_key, rule_type, token_norm, created_from, side, document_type, usage_count, created_at
    FROM field_rules
    WHERE supplier_name = @supplier_name AND (@dt IS NULL OR document_type = @dt)
    ORDER BY created_at DESC LIMIT @limit
  `).all({ supplier_name, dt, limit });

  return { anchors, hints, corrections, logos, rules };
}

// Read-only: the confirmed VALUES the given documents contributed to the learned model
// (via their extractions/corrections), for the recovery preview's "what will setting
// these aside reach" transparency. NOTE supplier_hints/field_anchors/field_rules carry no
// document_id — they aggregate by scope — so setting a doc aside removes its pull on the
// DERIVED format/value model (getFieldFormats/getFieldValueHistory are confirmed-only) but
// not on those already-aggregated artifacts, which re-learn from the remaining good docs.
function getLearningFootprintForDocuments(db, ids) {
  const list = (Array.isArray(ids) ? ids : []).map(n => parseInt(n, 10)).filter(Number.isInteger);
  if (!list.length) return { documentIds: [], values: [] };
  const ph = list.map(() => '?').join(',');
  const values = db.prepare(`
    SELECT e.document_id, e.field_key,
           TRIM(COALESCE(c.corrected_value, e.display_value, e.raw_value)) AS value,
           d.supplier_name, dt.slug AS document_type
    FROM extractions e
    JOIN documents d ON d.id = e.document_id
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    LEFT JOIN corrections c ON c.document_id = e.document_id AND c.field_key = e.field_key
    WHERE e.document_id IN (${ph})
    ORDER BY e.document_id, e.field_key
  `).all(...list);
  return { documentIds: list, values: values.filter(v => v.value) };
}

// Scope deleters — supplier_name AND/OR document_type. At least one must be given
// (never wipe the whole table). Passing only document_type (slug) clears that whole
// doc-type across ALL suppliers — the "reset a document type" case — and naturally
// sweeps the '__global__' fill-empty hint copies saveCorrections also writes.
function clearFieldAnchorsForScope(db, { supplier_name, document_type } = {}) {
  const sn = supplier_name || null, dt = document_type || null;
  if (!sn && !dt) return { changes: 0 };
  return db.prepare(`
    DELETE FROM field_anchors
    WHERE (@sn IS NULL OR supplier_name = @sn COLLATE NOCASE) AND (@dt IS NULL OR document_type = @dt)
  `).run({ sn, dt });
}

function clearSupplierHintsForScope(db, { supplier_name, document_type } = {}) {
  const sn = supplier_name || null, dt = document_type || null;
  if (!sn && !dt) return { changes: 0 };
  return db.prepare(`
    DELETE FROM supplier_hints
    WHERE (@sn IS NULL OR supplier_name = @sn COLLATE NOCASE) AND (@dt IS NULL OR document_type = @dt)
  `).run({ sn, dt });
}

// Extreme-use recovery only — corrections are the audit trail behind
// supplier_hints/field_anchors AND getFieldFormats()'s format-anomaly
// learning (see Stage 7 in CLAUDE.md). Clearing them does not undo any
// hints/anchors already derived from them; it only stops them counting
// toward future format-consensus and audit history for this exact scope.
function clearCorrectionsForScope(db, { supplier_name, document_type } = {}) {
  const sn = supplier_name || null, dt = document_type || null;
  if (!sn && !dt) return { changes: 0 };
  return db.prepare(`
    DELETE FROM corrections
    WHERE (@sn IS NULL OR supplier_name = @sn COLLATE NOCASE) AND (@dt IS NULL OR document_type = @dt)
  `).run({ sn, dt });
}

// ── Field cleanup rules (Review right-click toolkit) ─────────────────────────
// Operator-taught per-(supplier, doctype, field) rules that strip an adjacent
// heading/column OCR bled into a field. Applied at extraction time (engine Stage
// 4.5 via python_backend/extraction/field_rules.py). Two rule types: 'remove_text'
// (a learned leaked caption) and 'keep_block' (keep the single pattern-matching
// token). Scoped like the other corpora; reversible in Learning Recovery.

const FIELD_RULE_TOKEN_CAP = 40;
// MIRRORS python_backend/extraction/field_rules.normalize_token so the stored match
// key is byte-identical to what the engine compares against (casefold + collapse
// internal whitespace + cap).
function normalizeFieldRuleToken(raw) {
  if (!raw) return '';
  return String(raw).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, FIELD_RULE_TOKEN_CAP);
}

function saveFieldRule(db, { supplier_name, document_type, field_key, rule_type,
                            token, side, min_prefix } = {}) {
  if (!field_key) return { changes: 0 };
  if (rule_type !== 'remove_text' && rule_type !== 'keep_block' && rule_type !== 'multiline_continue') return { changes: 0 };
  const supplier  = normalizeSupplierName(supplier_name || '__global__') || '__global__';
  const dt        = document_type || null;
  // token_norm: the literal to remove (remove_text), or the trailing continuation chars
  // (multiline_continue; default "-"). keep_block carries none.
  let tokenNorm = null;
  if (rule_type === 'remove_text') {
    tokenNorm = normalizeFieldRuleToken(token);
    if (!tokenNorm) return { changes: 0 };
  } else if (rule_type === 'multiline_continue') {
    tokenNorm = (typeof token === 'string' && token.trim()) ? token.trim() : '-';
  }
  const sideVal   = side === 'leading' ? 'leading' : 'trailing';
  const mp        = parseInt(min_prefix, 10);
  const minPrefix = Number.isFinite(mp) ? Math.max(0, Math.min(50, mp)) : 3;
  const createdFrom = rule_type === 'remove_text' ? String(token || '') : null;

  // Null-safe upsert (SQLite `IS` matches NULL == NULL) — one row per
  // (supplier, doctype, field, rule_type, token_norm).
  const existing = db.prepare(`
    SELECT id FROM field_rules
    WHERE supplier_name = @supplier AND field_key = @field_key AND rule_type = @rule_type
      AND document_type IS @dt AND token_norm IS @tokenNorm
  `).get({ supplier, field_key, rule_type, dt, tokenNorm });
  if (existing) {
    return db.prepare(`
      UPDATE field_rules SET usage_count = usage_count + 1, created_from = @createdFrom,
             side = @sideVal, min_prefix = @minPrefix WHERE id = @id
    `).run({ id: existing.id, createdFrom, sideVal, minPrefix });
  }
  return db.prepare(`
    INSERT INTO field_rules
      (supplier_name, document_type, field_key, rule_type, token_norm, created_from, side, min_prefix)
    VALUES (@supplier, @dt, @field_key, @rule_type, @tokenNorm, @createdFrom, @sideVal, @minPrefix)
  `).run({ supplier, dt, field_key, rule_type, tokenNorm, createdFrom, sideVal, minPrefix });
}

// All rules, flat — loaded into the per-batch training snapshot and indexed by the
// engine on (supplier, doctype, field).
function getFieldRules(db) {
  return db.prepare(`
    SELECT supplier_name, document_type, field_key, rule_type, token_norm, side, min_prefix
    FROM field_rules ORDER BY field_key, rule_type
  `).all();
}

function clearFieldRulesForScope(db, { supplier_name, document_type } = {}) {
  const sn = supplier_name || null, dt = document_type || null;
  if (!sn && !dt) return { changes: 0 };
  return db.prepare(`
    DELETE FROM field_rules
    WHERE (@sn IS NULL OR supplier_name = @sn COLLATE NOCASE) AND (@dt IS NULL OR document_type = @dt)
  `).run({ sn, dt });
}

// ── Format templates (OCR correction) ────────────────────────────────────────

// Lightweight "does this look like a date?" test — a JS gate to keep non-dates
// (e.g. a reference like "2605-0849-1") out of a date field's learned format.
// Matches D/M/Y & ISO numeric dates and month-name dates; deliberately loose
// (the Python validator is the real parser) but enough to reject reference shapes.
const _MONTHS_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
function _looksDateish(v) {
  const s = String(v || '');
  if (/\d{1,2}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{2,4}/.test(s)) return true; // 20/02/2026 · 20-02-2026
  if (/\d{4}[/\-]\d{2}[/\-]\d{2}/.test(s)) return true;                     // 2026-02-20 (ISO)
  if (_MONTHS_RE.test(s) && /\d/.test(s)) return true;                      // 6 Aug 2026
  return false;
}

// LEARNING_EXCLUDE_MACHINE_CONFIRMS (machine-feed arc slice 1; gary → Oracle SIGN-OFF-W/COND
// C1-C6, 2026-08-13; DEFAULT OFF). When armed, getFieldFormats stops counting MACHINE-confirmed
// rows (confirmed_via in MACHINE_VIAS) into sample_values/value_counts/confirmed_count — the
// substrate behind the Stage-4.5 name lexicon, dominance snap, CONFADOPT counts, shape classes
// and the noise/prefix/length indices. The T3 principle one level down: a conf-100 machine file
// of a garbled read must not manufacture the learning evidence the machine then consumes (the
// Quillstone lexicon was diluted below the 0.9 STRONG bar by the machine's own confirms).
// C2 carve-out (Oracle, RETAIN): a row with a HUMAN correction (corrections.corrected_value)
// stays counted even on a machine-stamped doc — a correction row is a human act (machine
// confirms never write one), and it is the remediation mechanism's own lever.
// Flip mechanism = the trust_shadow_row_skip C5 pattern: a SETTING read here (not env-at-startup,
// the stale-main-process class), env retained as the dev/harness escape winning BOTH directions.
// SEAM (Oracle C5): the exclusion is BLIND when `autofile_gate_unify` is OFF — machine files then
// stamp via NULL and read as human. Requires gate-unify ON (said in the toggle copy).
function _excludeMachineConfirmsEnabled(db) {
  const env = process.env.LEARNING_EXCLUDE_MACHINE_CONFIRMS;
  if (env === '1') return true;
  if (env === '0') return false;
  try { return getSetting(db, 'learning_exclude_machine_confirms', 'false') === 'true'; }
  catch { return false; }
}

function _hasConfirmedViaColumn(db) {
  try {
    return db.prepare("SELECT 1 FROM pragma_table_info('documents') WHERE name='confirmed_via'")
             .get() != null;
  } catch { return false; }
}

function getFieldFormats(db, opts) {
  // opts.includeProvisional (default FALSE — S2 leak fix, 2026-08-04 morning): the provisional
  // (sub-≥3-confirm) groups exist ONLY for the Python consent channel. Every OTHER consumer —
  // trust.js auto-file gates, getDigitsOnlyFields, the renderer eligibility path — must see the
  // exact pre-provisional list, so the default EXCLUDES them; only the training-file build in
  // processing/handler.js opts in.
  const includeProvisional = !!(opts && opts.includeProvisional);
  // Machine-confirm exclusion (slice 1): armed only when the flag is on AND the via column
  // exists (pre-mig-57 fixture DBs keep the legacy behaviour, no throw).
  const excludeMachine = _excludeMachineConfirmsEnabled(db) && _hasConfirmedViaColumn(db);
  const machineVias = require('./machine_vias').MACHINE_VIAS_SET;
  // Collect final confirmed values (corrected value if the user edited, else the
  // extracted display value) for every confirmed document. Built into TWO kinds
  // of group:
  //   • supplier-scoped  (supplier_name, doc_type, field)  — when a real supplier
  //     is known (supplier-centric workflows);
  //   • doc-type-scoped  ('', doc_type, field)            — ALWAYS, aggregating
  //     across every supplier (and documents with none). This makes format
  //     learning DOCUMENT-AGNOSTIC: a doc type whose supplier is never identified
  //     (e.g. a worksheet where the supplier is implicit/constant) still learns
  //     its reference/date/field shapes, so the qualification gate can reject a
  //     garbage value by doc-type alone. The empty supplier_name is the
  //     doc-type-scoped key the Python index/engine fall back to.
  const rows = db.prepare(`
    SELECT
      e.document_id,
      d.supplier_name,
      dt.slug        AS document_type,
      e.field_key,
      e.display_value,
      c.corrected_value,
      fld.type       AS field_type${excludeMachine ? ",\n      COALESCE(d.confirmed_via, '') AS confirmed_via" : ''}
    FROM extractions e
    JOIN  documents      d  ON d.id  = e.document_id
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    LEFT JOIN fields        fld ON fld.document_type_id = d.document_type_id
                               AND fld.key = e.field_key
    LEFT JOIN corrections   c  ON c.document_id = e.document_id
                               AND c.field_key  = e.field_key${_dedupeCorrections(db) ? `
                               -- FAN-OUT FIX (Oracle C4, 2026-08-18; format_corrections_dedupe).
                               -- insertCorr appends on EVERY confirm while the extraction row is
                               -- written once, so a document corrected three times produced THREE
                               -- result rows and reached the >=3 solid-format bar on its own —
                               -- i.e. \`confirmed_count\` was not counting documents at all. Keep
                               -- the LATEST correction per (document, field), the same
                               -- "last confirm wins" rule retractConfirmHints already uses.
                               -- Shipped WITH persistConfirmedValues deliberately: minting rows
                               -- into a miscounting counter would green its promise for the
                               -- wrong reason, and de-duplication alone can DE-graduate a scope.
                               AND c.id = (SELECT MAX(c2.id) FROM corrections c2
                                            WHERE c2.document_id = e.document_id
                                              AND c2.field_key  = e.field_key)` : ''}
    WHERE d.status          = 'confirmed'
      AND (e.display_value IS NOT NULL OR c.corrected_value IS NOT NULL)
      -- Never learn from SHADOW reconciliation reads: they back the "verified" total check
      -- for fields the type doesn't define, and are unconfirmed by the user.
      AND (e.extraction_method IS NULL OR e.extraction_method <> 'shadow_reconcile')
      -- Never learn from CONFIRMED-DOMINANT ADOPTIONS (Oracle B3, 2026-08-12): the adopted value
      -- IS the learned dominant, so counting it would let dominance vote for itself — machine
      -- echoes would lock the literal in past a real-world change and permanently mask emerging
      -- variety (the strict variability clause could never see a genuine second value). A human
      -- EDIT of an adopted value changes the method via corrections and re-enters learning
      -- normally. Unconditional. (The 2026-08-12 "via cannot separate machine files" clause is
      -- SUPERSEDED — gate-unify T3 stamps + the remediation scripts made via separable; the
      -- doc-level machine exclusion is the ARMED filter in the accumulation loop below, C6.)
      AND (e.extraction_method IS NULL OR e.extraction_method NOT LIKE '%+confirmed\\_adopt' ESCAPE '\\')
      -- B7 (2026-08-13), UNCONDITIONAL and deliberately not behind a flag: a value produced by the
      -- Stage-4.5 NAME REPAIR may never count as evidence FOR that repair. Otherwise the route
      -- manufactures the history it consumes — confirm 20 auto-corrected documents and the
      -- correction becomes its own proof, which is precisely how Chris's 20 poisoned documents
      -- moved the canonical to 38/59 = 0.64 (Oracle O6). learning_exclude_machine_confirms does
      -- NOT cover this: those documents were HUMAN-confirmed, so no machine via marks them.
      -- (No backticks in this comment: it lives inside a JS template literal.)
      -- The METHOD suffix is the carrier because it survives confirm, where validation_note and
      -- corrected_to are both cleared. Same shape and same reason as the CONFADOPT clause above.
      AND (e.extraction_method IS NULL OR e.extraction_method NOT LIKE '%+name\\_repair' ESCAPE '\\')
      -- CLASS FIX (2026-08-19), UNCONDITIONAL, same family and same reason as the two clauses
      -- above: a value the CLASS FIX wrote may not count as evidence for that class fix. One
      -- correction propagates to up to 25 documents; confirm them and the single human decision
      -- has manufactured 25 votes for its own premise, which then licenses the engine's automatic
      -- arm to do it unasked. That is the B7 loop verbatim.
      --
      -- THE CARVE-OUT IS NOT OPTIONAL (Oracle C2). updateExtractionValue sets display_value and
      -- was_corrected but NEVER extraction_method, so a row the operator later corrects by hand
      -- keeps this marker forever and would be excluded for the life of the install — actively
      -- fighting persistConfirmedValues, which exists because the corpus was missing exactly such
      -- human-approved values. A corrections row re-admits the document. (The identical claim in
      -- the CONFADOPT comment above is STALE for the same reason and is filed for repair; do not
      -- copy it, and do not "fix" it here — that clause has its own history.)
      AND (e.extraction_method IS NULL
           OR e.extraction_method NOT LIKE '%+prefix\\_class\\_fix' ESCAPE '\\'
           OR c.corrected_value IS NOT NULL)
      -- NAME SUFFIX-SNAP (2026-08-24), UNCONDITIONAL, same B7 family as the three clauses above: a value
      -- the suffix-snap silently adopted (the scope's confirmed dominant spelling) may never count as
      -- evidence FOR the dominant that produced it, or the snap manufactures the history it consumes.
      -- New marker => no historic row carries it, so it ships unconditional; UNANCHORED (Oracle) so a
      -- stacked method suffix cannot escape it, with the corrections carve-out so a later human edit
      -- re-admits the document. (No backticks in this comment: it lives inside a JS template literal.)
      AND (e.extraction_method IS NULL
           OR e.extraction_method NOT LIKE '%+name\\_snap%' ESCAPE '\\'
           OR c.corrected_value IS NOT NULL)
      ${_excludeRewriteMarkers(db) ? `
      -- SLICE 0 (gary → Oracle SIGN-OFF-W/COND, 2026-08-19; \`learning_exclude_rewrite_markers\`).
      -- THE HOLE: the engine writes SIX corpus-derived rewrite markers and this query excluded
      -- THREE. \`+snapped\` (the Stage-2.5d dominant snap, which rewrites to the confirmed dominant
      -- with NO page witness), \`+snap_corrob\`, \`+name_corrob_adopt\` and \`+prefix_confusable_adopt\`
      -- had no clause at all — so a value the corpus itself produced votes for the belief that
      -- produced it. That is the B7 loop, and it was ALREADY OPEN on the HUMAN channel: a human who
      -- confirms a snapped document without editing it writes no corrections row, so the row counts,
      -- marker and all. The machine-confirm exclusion was masking it, not preventing it.
      -- ORACLE S0-C1: the twin clause lives in getPrefixModelForScope — the confirm-time guard was
      -- grading its own homework over the same rewritten rows. The two readers keep DIFFERENT
      -- snapshots (this one provenance-filtered and deduped, that one live and machine-inclusive by
      -- design) but must share ONE provenance policy.
      -- FLAG-GATED, unlike the three clauses above, and deliberately: those shipped unconditional
      -- because no historic row carried them. \`+snapped\` has shipped since July, so rows DO exist
      -- and this clause SHRINKS live corpora — which can make a field unverifiable and de-graduate
      -- a scope. The shrink direction is fail-safe (a vanished group ⇒ the sub-100 gate refuses ⇒
      -- MORE review, never a wrong file), so the code ships now and the flip waits on the census.
      -- Patterns are UNANCHORED (Oracle): the shipped '%+marker' form is end-anchored, so a stacked
      -- suffix like 'anchor_crop+name_repair+snapped' escaped every one of them.
      AND (e.extraction_method IS NULL OR c.corrected_value IS NOT NULL OR (
               e.extraction_method NOT LIKE '%+snapped%'
           AND e.extraction_method NOT LIKE '%+snap\\_corrob%' ESCAPE '\\'
           AND e.extraction_method NOT LIKE '%+name\\_corrob\\_adopt%' ESCAPE '\\'
           AND e.extraction_method NOT LIKE '%+prefix\\_confusable\\_adopt%' ESCAPE '\\'))` : ''}
    ORDER BY d.confirmed_at DESC, d.id DESC
  `).all();

  const groups = {};
  const addTo = (supplierKey, docType, fieldKey, value, isMachine) => {
    const key = `${supplierKey}|${docType}|${fieldKey}`;
    let g = groups[key];
    if (!g) {
      g = groups[key] = {
        supplier_name: supplierKey, document_type: docType, field_key: fieldKey,
        _values: new Set(), _valueCounts: new Map(), _count: 0,
        _machineValueCounts: new Map(),
      };
    }
    if (isMachine) {
      // ARMED path only: machine-confirmed evidence is recorded in a SEPARATE additive channel
      // (machine_value_counts) consumed by NOTHING in slice 1 (pinned inert) — it exists so a
      // slice-2 refusal-side union (CONFADOPT second-key variability, charset) can read it
      // without re-touching this query. It never feeds sample_values/value_counts/confirmed_count.
      g._machineValueCounts.set(value, (g._machineValueCounts.get(value) || 0) + 1);
      return;
    }
    g._values.add(value);
    g._valueCounts.set(value, (g._valueCounts.get(value) || 0) + 1);
    g._count += 1;
  };

  for (const row of rows) {
    const finalValue = (row.corrected_value || row.display_value || '').trim();
    if (!finalValue) continue;
    // Machine-confirm exclusion (armed only): a machine-stamped doc's row leaves the counted
    // substrate UNLESS a human correction exists for it (C2 carve-out — a correction row is a
    // human act; machine confirms never write one, verified at _autoFileDoc/reviewService).
    const isMachine = excludeMachine && machineVias.has(row.confirmed_via || '')
                      && row.corrected_value == null;
    // Guard: never LEARN a non-date into a date-typed field's format. A mis-aimed
    // anchor that once read (and got confirmed as) a reference number must not
    // pollute the date field's learned shape — that turns the date class into
    // "freetext" and disables date qualification entirely. Only date-shaped
    // values contribute to a date field's format model.
    if (row.field_type === 'date' && !_looksDateish(finalValue)) continue;
    const docType  = row.document_type || '';
    const supplier = (row.supplier_name || '').trim();
    // Supplier-scoped — only for a real, non-placeholder supplier (unchanged).
    if (supplier && supplier !== '__global__') {
      addTo(supplier, docType, row.field_key, finalValue, isMachine);
    }
    // Doc-type-scoped — always, across every supplier (incl. none).
    if (docType) {
      addTo('', docType, row.field_key, finalValue, isMachine);
    }
  }

  // Emit a group when EITHER: 3+ DISTINCT confirmed values (enough to learn a VARIABLE
  // pattern), OR the SAME value recurs strongly (3+ confirmations, few distinct) — a
  // CONSTANT field like a model/serial code whose value OCR keeps misreading. The latter
  // is what enables ocr_corrector's O→0/I→1 character fix for constant-value fields, which
  // by definition have <3 distinct values (mirrors ocr_corrector.MIN_CONFIRMED_FOR_SINGLE_SHAPE=3).
  // confirmed_count (total confirmed instances, not deduped) is carried so consumers can
  // apply their own stricter thresholds (e.g. the noise-profile gate needs 10+).
  // PROVISIONAL channel (Oracle NIGHT 2026-08-03, S2): groups BELOW the ≥3 bar are now
  // emitted too, tagged `provisional: true`. Python keeps them OUT of the main format
  // index (build_format_class_index skips the tag — the ≥3-confirm VETO direction is
  // preserved verbatim) and builds a SEPARATE consent-only skeleton index from them,
  // consumed exclusively by the mapper's clean-commit consent ladder. This is what lets
  // sibling #1 of a freshly-taught template corroborate against the TAUGHT value's
  // skeleton instead of a cold "usual format".
  return Object.values(groups)
    .map(g => ({ ...g, _ok: g._values.size >= FORMAT_SOLID_MIN || g._count >= FORMAT_SOLID_MIN }))
    .filter(g => g._ok || includeProvisional)
    .map(({ _values, _valueCounts, _count, _ok, _machineValueCounts, ...rest }) => ({
      ...rest,
      ...(_ok ? {} : { provisional: true }),
      sample_values:   [..._values].slice(0, 20),
      confirmed_count: _count,
      // Per-value confirmed-document counts (newest distinct first, capped) so
      // the Python shape model can learn the SET of shapes each confirmed enough
      // times, not just one unanimous shape — letting a field legitimately carry
      // more than one structure (e.g. a 4- and a 5-digit reference).
      value_counts:    Object.fromEntries([..._valueCounts].slice(0, 200)),
      // ARMED ONLY (slice 1, pinned inert — no consumer reads it): the machine-confirmed
      // counts the exclusion removed, kept visible for the slice-2 refusal-side union.
      ...(excludeMachine
        ? { machine_value_counts: Object.fromEntries([..._machineValueCounts].slice(0, 200)) }
        : {}),
    }));
}

// Which fields for this (supplier, document_type) have a learned format of
// digits-only — used by Review to warn before confirming a non-digit value on
// such a field. Mirrors the digits_only branch of the Python classifier
// (format_anomaly_checker.classify_format): a field qualifies only with ≥3
// distinct confirmed values whose 3 newest are all pure digits. Read-side only;
// never mutates and never constrains free-text fields.
function _isDigitsOnlyFormat(sampleValues) {
  if (!Array.isArray(sampleValues) || sampleValues.length < 3) return false;
  return sampleValues.slice(0, 3).every(v => /^\d+$/.test(String(v).trim()));
}

function getDigitsOnlyFields(db, supplier_name, document_type) {
  if (!supplier_name) return [];
  const s  = String(supplier_name).toLowerCase().trim();
  const dt = String(document_type || '').toLowerCase().trim();
  return getFieldFormats(db)
    .filter(f =>
      String(f.supplier_name).toLowerCase().trim() === s &&
      String(f.document_type || '').toLowerCase().trim() === dt &&
      _isDigitsOnlyFormat(f.sample_values))
    .map(f => f.field_key);
}

// Developer reset — wipe ALL learning state in a single transaction. Clears the
// automatic-learning corpora (supplier_hints, field_anchors, logo_fingerprints,
// corrections) AND the learned/managed template store (templates plus their
// fields, mappings, and groups), unlinking documents from any removed template
// (documents.template_id has no cascade). Deliberately leaves intact: the
// settings table (UI/output-folder/processing-mode — none are learning state),
// document_types/fields, and the documents + their extractions themselves —
// only the template_id link is cleared. Idempotent: re-running on a clean DB
// matches zero rows everywhere. Returns per-table deleted counts so the
// confirmation can report exactly what was removed.
function resetAllLearning(db) {
  const counts = {};
  const del = (sql) => db.prepare(sql).run().changes;
  db.transaction(() => {
    counts.supplier_hints          = del('DELETE FROM supplier_hints');
    counts.field_anchors           = del('DELETE FROM field_anchors');
    counts.logo_fingerprints       = del('DELETE FROM logo_fingerprints');
    counts.corrections             = del('DELETE FROM corrections');
    counts.field_rules             = del('DELETE FROM field_rules');
    counts.documents_unlinked      = db.prepare(
      'UPDATE documents SET template_id = NULL WHERE template_id IS NOT NULL').run().changes;
    counts.template_field_mappings = del('DELETE FROM template_field_mappings');
    counts.template_fields         = del('DELETE FROM template_fields');
    counts.templates               = del('DELETE FROM templates');
    counts.template_groups         = del('DELETE FROM template_groups');
  })();
  return counts;
}

// Developer reset — "fresh install, keep the document corpus". A superset of
// resetAllLearning: in one transaction it additionally removes the CUSTOM schema
// (custom document types + custom fields, re-seeding only the built-ins) and
// strips every learned attribute back off the kept documents, sending confirmed/
// deferred docs back to the review queue. The binary files (documents.working_path)
// and the document rows themselves are preserved, so re-processing those same
// files re-learns the system from zero — the point of the test.
//
// KEEPS (untouched): settings (config + licensing flags), users/recovery/audit,
// license_tokens/device_registrations, and the documents + extractions rows.
// extractions are left in place — a reprocess overwrites them; meanwhile learning
// reads only from CONFIRMED docs, and every doc has just been moved out of that
// state, so the learning corpus is genuinely empty until the user re-confirms.
//
// Order matters: documents holds FKs to BOTH templates(id) (template_id) and
// document_types(id) (document_type_id), neither with an ON DELETE action. So the
// documents UPDATE runs FIRST, nulling those links before the template and
// custom-type deletes below — otherwise either delete trips an FK constraint
// while a document still references the row. Idempotent. Returns per-table counts.
function resetToFreshInstall(db) {
  const counts = {};
  const del = (sql) => db.prepare(sql).run().changes;
  const docTypes = require('./document_types');
  db.transaction(() => {
    // 1. Strip learned identity off every kept document and requeue confirmed/
    //    deferred ones. Must precede the deletes: clears the template_id and
    //    document_type_id FKs so the rows they point at can be removed.
    counts.documents_reset = db.prepare(`
      UPDATE documents SET
        template_id            = NULL,
        logo_phash             = NULL,
        keyword_fingerprint    = NULL,
        supplier_name          = NULL,
        document_type_id       = NULL,
        ocr_text               = NULL,
        confirmed_at           = NULL,
        review_acknowledged_at = NULL,
        status = CASE WHEN status IN ('confirmed','deferred') THEN 'needs_review' ELSE status END
      WHERE template_id IS NOT NULL OR logo_phash IS NOT NULL
         OR keyword_fingerprint IS NOT NULL OR supplier_name IS NOT NULL
         OR document_type_id IS NOT NULL OR ocr_text IS NOT NULL
         OR confirmed_at IS NOT NULL OR review_acknowledged_at IS NOT NULL
         OR status IN ('confirmed','deferred')
    `).run().changes;
    // 2. Automatic-learning corpora.
    counts.supplier_hints          = del('DELETE FROM supplier_hints');
    counts.field_anchors           = del('DELETE FROM field_anchors');
    counts.logo_fingerprints       = del('DELETE FROM logo_fingerprints');
    counts.corrections             = del('DELETE FROM corrections');
    counts.field_rules             = del('DELETE FROM field_rules');
    // 3. Learned/managed template store (children before parents).
    counts.template_field_mappings = del('DELETE FROM template_field_mappings');
    counts.template_fields         = del('DELETE FROM template_fields');
    counts.templates               = del('DELETE FROM templates');
    counts.template_groups         = del('DELETE FROM template_groups');
    // 4. Custom schema → fresh-install schema (built-ins only). fields cascade
    //    from their type, but custom fields can also hang off a built-in type,
    //    so delete by the built_in flag explicitly, then re-seed the built-ins.
    counts.custom_fields           = del('DELETE FROM fields WHERE built_in = 0');
    counts.custom_document_types   = del('DELETE FROM document_types WHERE built_in = 0');
    docTypes.seedBuiltInTypes(db);
  })();
  return counts;
}

// ── Learned-memory inventory (read-only) ─────────────────────────────────────
// Grouped counts of what the automatic-learning corpora currently hold, keyed
// by the REAL learning-group identity each table uses — supplier_name +
// document_type + field_key for hints/anchors/corrections (the exact tuple
// engine.py scopes lookups by), supplier_name for logo fingerprints. Computed
// entirely in SQL (no renderer-side raw dumps). Purely informational: the
// Learning Recovery search box remains the way to act on any key shown here.
function getMemoryInventory(db) {
  const rows = [];
  rows.push(...db.prepare(`
    SELECT 'hint' AS type, supplier_name, document_type, field_key,
           COUNT(*) AS records, COUNT(DISTINCT hint_value) AS distinct_values,
           MAX(last_seen) AS last_seen
    FROM supplier_hints
    GROUP BY supplier_name, document_type, field_key
  `).all());
  rows.push(...db.prepare(`
    SELECT 'anchor' AS type, supplier_name, document_type, field_key,
           COUNT(*) AS records, NULL AS distinct_values,
           MAX(last_seen) AS last_seen
    FROM field_anchors
    GROUP BY supplier_name, document_type, field_key
  `).all());
  rows.push(...db.prepare(`
    SELECT 'correction' AS type, supplier_name, document_type, field_key,
           COUNT(*) AS records, COUNT(DISTINCT corrected_value) AS distinct_values,
           MAX(corrected_at) AS last_seen
    FROM corrections
    GROUP BY supplier_name, document_type, field_key
  `).all());
  rows.push(...db.prepare(`
    SELECT 'logo' AS type, supplier_name, NULL AS document_type, NULL AS field_key,
           COUNT(*) AS records, NULL AS distinct_values,
           MAX(last_seen) AS last_seen
    FROM logo_fingerprints
    GROUP BY supplier_name
  `).all());
  rows.push(...db.prepare(`
    SELECT 'rule' AS type, supplier_name, document_type, field_key,
           COUNT(*) AS records, NULL AS distinct_values,
           MAX(created_at) AS last_seen
    FROM field_rules
    GROUP BY supplier_name, document_type, field_key
  `).all());
  rows.sort((a, b) =>
    (b.records - a.records) ||
    String(a.supplier_name || '').localeCompare(String(b.supplier_name || '')));
  return rows;
}

// ── Settings ──────────────────────────────────────────────────────────────────

function getSetting(db, key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setSetting(db, key, value) {
  return db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, value);
}

// ── Operator-accepted NAME allowlist ────────────────────────────────────────────
// Exact name values the user has explicitly marked "this IS a valid name" via the Review
// "This name is correct" button, so the free-text wordness/truncation flags skip them
// (e.g. an acronym-bearing company like "Cloud VPS" whose "VPS" token reads low on the
// character-language model). Stored as ONE settings JSON array of canonical forms; the
// Python engine (engine._accept_norm / set_accepted_names) uses the SAME canonical form.
const ACCEPTED_NAMES_KEY = 'accepted_name_values';
function _acceptNorm(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
}
function getAcceptedNames(db) {
  try { const a = JSON.parse(getSetting(db, ACCEPTED_NAMES_KEY, '[]') || '[]'); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
/** Add a name to the allowlist (canonicalised, de-duplicated). Returns the updated list. */
function addAcceptedName(db, value) {
  const norm = _acceptNorm(value);
  if (!norm) return getAcceptedNames(db);
  const list = getAcceptedNames(db);
  if (!list.includes(norm)) { list.push(norm); setSetting(db, ACCEPTED_NAMES_KEY, JSON.stringify(list)); }
  return list;
}
/** Remove a name from the allowlist (canonicalised). Returns the updated list. */
function removeAcceptedName(db, value) {
  const norm = _acceptNorm(value);
  const list = getAcceptedNames(db).filter(n => n !== norm);
  setSetting(db, ACCEPTED_NAMES_KEY, JSON.stringify(list));
  return list;
}

// Operator-accepted ISSUER allowlist — resolved supplier names the user explicitly marked as a
// valid issuer via the "Issuer is correct" button on an identity-conflict flag. A supplier in
// this set is trusted over a letterhead name that merely matches another known supplier (the
// recipient/customer/printer in the header), so the conflict flag skips it immediately — the
// explicit, one-click complement to the automatic "established after N confirmations" fallback.
// Same canonical form + settings-JSON-array shape as the accepted-names list; the Python engine
// (engine.set_accepted_issuers / _accept_norm) uses the SAME canonical form.
const ACCEPTED_ISSUERS_KEY = 'accepted_issuer_values';
function getAcceptedIssuers(db) {
  try { const a = JSON.parse(getSetting(db, ACCEPTED_ISSUERS_KEY, '[]') || '[]'); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
/** Add a resolved-supplier name to the issuer allowlist (canonicalised, de-duplicated). */
function addAcceptedIssuer(db, value) {
  const norm = _acceptNorm(value);
  if (!norm) return getAcceptedIssuers(db);
  const list = getAcceptedIssuers(db);
  if (!list.includes(norm)) { list.push(norm); setSetting(db, ACCEPTED_ISSUERS_KEY, JSON.stringify(list)); }
  return list;
}
/** Remove a supplier from the issuer allowlist (canonicalised). Returns the updated list. */
function removeAcceptedIssuer(db, value) {
  const norm = _acceptNorm(value);
  const list = getAcceptedIssuers(db).filter(n => n !== norm);
  setSetting(db, ACCEPTED_ISSUERS_KEY, JSON.stringify(list));
  return list;
}

// Distinct confirmed VALUES learned for a (supplier, doc-type, field) scope — the same final
// values getFieldFormats learns shapes from (the user's corrected value if they edited, else
// the extracted display value). Powers the "View learning history" table so a value that
// shouldn't exist for the field (e.g. a drift artifact like "Booking" on a reference field)
// can be spotted and purged.
function getFieldValueHistory(db, { supplier_name, document_type, field_key } = {}) {
  if (!field_key) return [];
  return db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(c.corrected_value), ''), e.display_value) AS value,
           COUNT(*) AS count, MAX(d.confirmed_at) AS last_seen
    FROM extractions e
    JOIN documents d ON d.id = e.document_id
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    LEFT JOIN corrections   c  ON c.document_id = e.document_id AND c.field_key = e.field_key
    WHERE d.status = 'confirmed' AND e.field_key = ?
      AND COALESCE(d.supplier_name, '') = COALESCE(?, '')
      AND COALESCE(dt.slug, '')         = COALESCE(?, '')
    GROUP BY value
    HAVING value IS NOT NULL AND TRIM(value) <> ''
    ORDER BY count DESC, value ASC
  `).all(field_key, supplier_name || '', document_type || '');
}

// PREFIX-OUTLIER model for ONE scope (Slice 1 confirm-time cold-start gate). Runs the same scoped
// confirmed-value query as getFieldValueHistory to get {value: confirmedCount}, then feeds the JS
// mirror prefix_outlier.buildScopeRec — so the CONFIRM-time check uses the SAME dominant-prefix rule
// as the Python extraction guard, against LIVE confirmed history (which the extraction index misses
// on a first bulk import). Returns the scope rec {dominant,known,counts,total} or null (disarmed /
// no supplier / no field). Supplier match is EXACT (per-supplier prefix convention, no cross-
// supplier fallback); do NOT lowercase (the SQL is COALESCE-equality on the stored value).
function getPrefixModelForScope(db, supplier_name, document_type_slug, field_key) {
  if (!field_key || !supplier_name) return null;
  const rows = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(c.corrected_value), ''), e.display_value) AS value, COUNT(*) AS count
    FROM extractions e
    JOIN documents d ON d.id = e.document_id
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    LEFT JOIN corrections   c  ON c.document_id = e.document_id AND c.field_key = e.field_key
    WHERE d.status = 'confirmed' AND e.field_key = ?
      AND COALESCE(d.supplier_name, '') = COALESCE(?, '')
      AND COALESCE(dt.slug, '')         = COALESCE(?, '')
      ${_excludeRewriteMarkers(db) ? `
      -- ORACLE S0-C1 (2026-08-19), the twin of the clause in getFieldFormats. This model is the
      -- evidence for the CONFIRM-TIME prefix-outlier guard (reviewService.confirm). It applies no
      -- via filter — correctly, since its whole purpose is to read the live corpus, machine files
      -- included. But reading rows that a REWRITE created means the guard grades its own homework:
      -- the snap writes the dominant prefix onto a value, the document files, and the guard then
      -- counts that value as proof the prefix is established. Same four markers, same carve-out,
      -- same flag — one provenance policy over two different snapshots.
      AND (e.extraction_method IS NULL OR c.corrected_value IS NOT NULL OR (
               e.extraction_method NOT LIKE '%+snapped%'
           AND e.extraction_method NOT LIKE '%+snap\\_corrob%' ESCAPE '\\'
           AND e.extraction_method NOT LIKE '%+name\\_corrob\\_adopt%' ESCAPE '\\'
           AND e.extraction_method NOT LIKE '%+prefix\\_confusable\\_adopt%' ESCAPE '\\'
           AND e.extraction_method NOT LIKE '%+prefix\\_class\\_fix%' ESCAPE '\\'))` : ''}
    GROUP BY value
    HAVING value IS NOT NULL AND TRIM(value) <> ''
  `).all(field_key, supplier_name || '', document_type_slug || '');
  const counts = {};
  for (const row of rows) counts[row.value] = row.count;
  return require('./prefix_outlier').buildScopeRec(counts);
}

// List the CONFIRMED documents whose final value for this (supplier, doc-type, field) scope
// equals `value` — so the Learning-history modal can jump from a learned value to the source
// documents that taught it (to re-check/correct them via "Edit in Review"). Same scope +
// final-value expression getFieldValueHistory groups by, so a value shown there maps back to
// exactly these docs. Returns [{id, original_filename, confirmed_at}], newest first.
function getDocumentsForFieldValue(db, { supplier_name, document_type, field_key, value } = {}) {
  if (!field_key || value == null || value === '') return [];
  return db.prepare(`
    SELECT d.id, d.original_filename, d.confirmed_at
    FROM extractions e
    JOIN documents d ON d.id = e.document_id
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    LEFT JOIN corrections   c  ON c.document_id = e.document_id AND c.field_key = e.field_key
    WHERE d.status = 'confirmed' AND e.field_key = ?
      AND COALESCE(d.supplier_name, '') = COALESCE(?, '')
      AND COALESCE(dt.slug, '')         = COALESCE(?, '')
      AND COALESCE(NULLIF(TRIM(c.corrected_value), ''), e.display_value) = ?
    ORDER BY d.confirmed_at DESC, d.id DESC
  `).all(field_key, supplier_name || '', document_type || '', value);
}

// Purge a learned VALUE from every learning source for the scope: the confirmed extractions
// that carry it (so the format/shape sample drops it), plus any corrections and supplier-hint
// rows that produce it. Filed documents keep their files — only this field's stored value is
// cleared on the affected docs (it was a wrong value anyway; reprocess re-reads it). Returns
// the number of rows removed. Wrapped in a transaction.
function purgeFieldValue(db, { supplier_name, document_type, field_key, value } = {}) {
  if (!field_key || value == null || value === '') return 0;
  const sn = supplier_name || '', dts = document_type || '';
  const tx = db.transaction(() => {
    let n = 0;
    n += db.prepare(`
      DELETE FROM extractions WHERE field_key = ? AND display_value = ?
        AND document_id IN (
          SELECT d.id FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
          WHERE d.status = 'confirmed' AND COALESCE(d.supplier_name,'') = ? AND COALESCE(dt.slug,'') = ?
        )`).run(field_key, value, sn, dts).changes;
    n += db.prepare(`DELETE FROM corrections    WHERE field_key = ? AND corrected_value = ? AND COALESCE(supplier_name,'') = ? AND COALESCE(document_type,'') = ?`).run(field_key, value, sn, dts).changes;
    n += db.prepare(`DELETE FROM supplier_hints WHERE field_key = ? AND hint_value      = ? AND COALESCE(supplier_name,'') = ? AND COALESCE(document_type,'') = ?`).run(field_key, value, sn, dts).changes;
    return n;
  });
  return tx();
}

// Rename a learned VALUE for a (supplier, doc-type, field) scope: oldValue → newValue across
// the confirmed extractions and corrections that carry it (so the format/shape learner and
// future reads see the corrected spelling — e.g. an OCR slip "$O2" → "SO2"). The stale hint
// for the old value is dropped (the corrected value re-learns naturally; avoids a unique
// clash). Filed documents keep their files — only the stored field value changes. Returns the
// number of rows touched. Wrapped in a transaction.
function renameFieldValue(db, { supplier_name, document_type, field_key, oldValue, newValue } = {}) {
  if (!field_key || !oldValue || newValue == null || newValue === '' || oldValue === newValue) return 0;
  const sn = supplier_name || '', dts = document_type || '';
  const tx = db.transaction(() => {
    let n = 0;
    n += db.prepare(`
      UPDATE extractions SET display_value = ?, raw_value = ?
       WHERE field_key = ? AND display_value = ?
         AND document_id IN (
           SELECT d.id FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
           WHERE d.status = 'confirmed' AND COALESCE(d.supplier_name,'') = ? AND COALESCE(dt.slug,'') = ?
         )`).run(newValue, newValue, field_key, oldValue, sn, dts).changes;
    n += db.prepare(`UPDATE corrections SET corrected_value = ? WHERE field_key = ? AND corrected_value = ? AND COALESCE(supplier_name,'') = ? AND COALESCE(document_type,'') = ?`).run(newValue, field_key, oldValue, sn, dts).changes;
    // Drop the stale hint for the OLD value (the corrected value re-learns on future confirms).
    db.prepare(`DELETE FROM supplier_hints WHERE field_key = ? AND hint_value = ? AND COALESCE(supplier_name,'') = ? AND COALESCE(document_type,'') = ?`).run(field_key, oldValue, sn, dts);
    return n;
  });
  return tx();
}

// Count the rows that key off a given supplier IDENTITY, per learning table — for the
// Learning-Recovery "rename supplier" preview (so an admin sees the blast radius before
// applying). COALESCE so a NULL supplier_name matches an empty-string query symmetrically.
function getSupplierScopeCounts(db, name) {
  const s = (name || '').trim();
  const one = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE COALESCE(supplier_name,'') = ?`).get(s).n;
  return {
    documents:         one('documents'),
    supplier_hints:    one('supplier_hints'),
    field_anchors:     one('field_anchors'),
    logo_fingerprints: one('logo_fingerprints'),
    corrections:       one('corrections'),
  };
}

// Rename a SUPPLIER IDENTITY everywhere it is a learning-scope key, atomically. The per-field
// learning-history tools (purge/rename) can't repair the identity field itself, because they
// are SCOPED BY supplier — the supplier IS the scope key. This rewrites that key across every
// table that carries it so a wrong/merged identity (e.g. a supplier read that swallowed the
// customer, "Profile Construction ACME Inc" -> "Profile Construction") can be corrected in one
// move and stops propagating via the logo/hint scope.
//
//   • documents.supplier_name          — the universal learning scope + folder key
//   • supplier_hints / field_anchors   — UNIQUE(supplier,…): rename what doesn't collide with an
//                                        existing row under the new name, DROP the leftover old
//                                        duplicate (merge). No usage_count sum — the surviving
//                                        new row's count stands (precision over a rare merge).
//   • logo_fingerprints / corrections  — plain rename (no scope-unique constraint)
//   • the stored supplier_name FIELD value (extractions + corrections) on those docs, where it
//     still equals the OLD identity — so the value shown/learned matches the renamed scope.
//
// FILES ARE NOT MOVED: a confirmed doc already filed under the old company folder keeps its
// file (still reachable via stored_path); only the DB identity changes. Re-file via reprocess
// if folder consolidation is wanted. Wrapped in a transaction. Returns before/after scope counts.
// (customer_name-identity types — sales orders — are out of scope here; supplier_name is the
// universal scope key. NOTE: not version-stamped — a schema-free data operation.)
function renameSupplier(db, { oldName, newName } = {}) {
  const from = (oldName || '').trim(), to = (newName || '').trim();
  if (!from || !to || from === to) return { renamed: 0, before: null, after: null };
  const before = getSupplierScopeCounts(db, from);
  const tx = db.transaction(() => {
    // UNIQUE-scoped learning tables: rename non-colliding rows, drop leftover old duplicates.
    for (const t of ['supplier_hints', 'field_anchors']) {
      db.prepare(`UPDATE OR IGNORE ${t} SET supplier_name = @to WHERE supplier_name = @from`).run({ to, from });
      db.prepare(`DELETE FROM ${t} WHERE supplier_name = @from`).run({ from });
    }
    // Plain rename (no scope-unique constraint).
    db.prepare(`UPDATE logo_fingerprints SET supplier_name = @to WHERE supplier_name = @from`).run({ to, from });
    db.prepare(`UPDATE corrections        SET supplier_name = @to WHERE COALESCE(supplier_name,'') = @from`).run({ to, from });
    db.prepare(`UPDATE documents          SET supplier_name = @to WHERE COALESCE(supplier_name,'') = @from`).run({ to, from });
    // The stored IDENTITY value on those docs (only where it still equals the old name), so the
    // supplier_name field value matches the renamed scope + re-learns cleanly.
    db.prepare(`UPDATE extractions SET display_value = @to, raw_value = @to
                 WHERE field_key = 'supplier_name' AND display_value = @from`).run({ to, from });
    db.prepare(`UPDATE corrections SET corrected_value = @to
                 WHERE field_key = 'supplier_name' AND corrected_value = @from`).run({ to, from });
    // THE GAP THAT MADE THIS ROUTE UNABLE TO FINISH THE JOB (2026-08-13): a template's FROZEN
    // identity was untouched, so a rename fixed six learning tables and left the one value that
    // gets STAMPED onto every future document of that layout still saying the old name — the
    // rename would appear to work and then quietly undo itself on the next import. Scoped to the
    // identity field, and only where the stored value still IS the old name.
    // `fixed_locked` rows are included deliberately: an admin who typed the wrong literal is
    // exactly who is using this screen, and leaving their own typo untouched by their own rename
    // would be the same silent half-fix.
    try {
      db.prepare(`UPDATE template_fields SET fixed_value = @to
                   WHERE field_key = 'supplier_name' AND fixed_value = @from`).run({ to, from });
    } catch { /* a schema without template_fields (fixture) must not fail the rename */ }
  });
  tx();
  return { renamed: 1, before, after: getSupplierScopeCounts(db, to) };
}

// ── "These two look like the same company" (the B9 census, as a product surface) ──────────────
// Preventive fixes leave a customer whose filing tree is ALREADY split with nothing telling them
// (Oracle O7). This is that missing surface: every pair of known sender scopes that are one or two
// characters apart, with the weight behind each side so the operator can see which is the real one.
//
// REPORT-ONLY, and deliberately so. It never merges, never renames, never writes. It hands the
// pair to the existing admin + audited rename route and lets a human decide which name survives —
// the same posture as every other Learning Repair tool.
//
// Uses the SAME `name_proximity` comparison as the teach-time challenge and the write guard, so
// all three agree about what "the same company, misread" means.
// A DIGIT INSIDE AN ALPHABETIC TOKEN — the machine signature (`B8ramblewood`, `Ir0nclad`). Near-
// zero in a real company name, and unlike the wordness model it is immune to both classes Oracle
// named in O5: brand orthography (`Kwik-Fit`, `Xpress`) and Welsh/Irish names, neither of which
// carries an interior digit. A token that is ALL digits, or starts with one (`3M`, `24/7`), is not
// this signature and is excluded.
function _digitInAlphaToken(name) {
  for (const tok of String(name || '').split(/\s+/)) {
    const t = tok.replace(/[^0-9A-Za-z]/g, '');
    if (t.length < 3) continue;                       // too short to judge (3M, O2)
    if (!/[0-9]/.test(t) || !/[A-Za-z]/.test(t)) continue;
    if (/^[0-9]/.test(t)) continue;                   // '3M', '24hr' — a leading digit is ordinary
    if (/[0-9]/.test(t.slice(1, -1))) return true;    // a digit INSIDE the word
  }
  return false;
}

function findDuplicateSupplierPairs(db, { minDocs = 1 } = {}) {
  const { nearMatchIdentity } = require('./name_proximity');
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT TRIM(supplier_name) AS name, COUNT(*) AS docs
      FROM documents
      WHERE supplier_name IS NOT NULL AND TRIM(supplier_name) <> '' AND status <> 'deleted'
      GROUP BY LOWER(TRIM(supplier_name))
      ORDER BY docs DESC
    `).all();
  } catch { return []; }
  const names = rows.filter(r => r.docs >= minDocs);
  const out = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const v = nearMatchIdentity(names[i].name, names[j].name);
      if (!v.near) continue;
      // STRICTER THAN THE WRITE GUARD, DELIBERATELY, and its own test proved why. The guard's
      // budget is 2 edits, and at 2 edits REAL companies collide: `Northgate Motors Ltd` vs
      // `Southgate Motors Ltd` is d=2 at similarity 0.889 and passes it. At the guard's seam that
      // costs a declined overwrite; HERE it would put two real companies on screen under the words
      // "look like duplicates" and invite the operator to merge them — the silent-merge harm this
      // whole arc exists to prevent, dressed as a helpful suggestion (Oracle O2, measured).
      // So: one edit, or two edits ONLY when one side carries the machine signature — a DIGIT
      // inside an alphabetic token (`B8ramblewood`), which is near-zero in a real company name and
      // is the round-4 exhibit's own shape (Oracle O5's preferred narrow arm).
      // NAMED COST: a two-character garble with no digit (a doubled or dropped letter) is not
      // reported. That is the safe direction — a missed pair leaves today's behaviour, a false pair
      // merges two customers.
      if (v.distance > 1 && !(_digitInAlphaToken(names[i].name) || _digitInAlphaToken(names[j].name))) continue;
      // The heavier side is offered as the likely-correct one — it is the name the customer has
      // actually been filing under. Offered, not chosen: a garble CAN be the heavier side (Chris's
      // 20 poisoned documents outnumbered a fresh correct scope), so the operator still decides.
      const [keep, other] = names[i].docs >= names[j].docs ? [names[i], names[j]] : [names[j], names[i]];
      out.push({
        likelyCorrect: keep.name, likelyCorrectDocs: keep.docs,
        other: other.name,        otherDocs: other.docs,
        distance: v.distance, similarity: v.similarity,
        otherScope: getSupplierScopeCounts(db, other.name),
      });
    }
  }
  return out;
}

// ── SUPPLIER HARD-IDENTIFIER REGISTRY (slice 1a; reggie+gary → Oracle SIGN-OFF-W/COND 2026-08-26) ──
// Learn a supplier's stable identity keys (VAT / company_no / phone) at confirm, from the ISSUER region
// only, and ONLY when the confirmed supplier's own name is co-located in that region (C2: the name gate
// that substitutes for the missing "is-this-the-issuer" check a raw number has none of — it closes the
// buyer-issued case, where a Bramblewood letterhead confirmed as Quillstone would otherwise learn the
// wrong VAT). DARK behind `identifier_registry` (env IDENTIFIER_REGISTRY wins) — OFF ⇒ no rows, inert.
// Slice 1a LEARNS ONLY; nothing consumes the registry until slice 1b wires the match (kept out of the
// auto-file corroboration-licensing math — Oracle C1).
const _ID_GENERIC = new Set(('ltd limited plc llp inc co company the and services service group holdings '
  + 'uk gb solutions systems trading international global supplies supply').split(' '));
function _identifierRegistryOn(db) {
  const env = process.env.IDENTIFIER_REGISTRY;
  if (env === '1') return true;
  if (env === '0') return false;
  try { return getSetting(db, 'identifier_registry', 'false') === 'true'; } catch { return false; }
}
function _distinctiveTokens(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(t => t.length >= 4 && !_ID_GENERIC.has(t));
}
function _headerText(ocrText) {
  const lines = String(ocrText == null ? '' : ocrText).split('\n');
  let firstRec = null;
  for (let i = 0; i < lines.length; i++) {
    if (/\b(?:bill\s*to|ship\s*to|sold\s*to|deliver(?:ed)?\s*to|invoice\s*to|customer|client)\b/i.test(lines[i])) { firstRec = i; break; }
  }
  const end = Math.min(firstRec == null ? 8 : firstRec, 8);
  return lines.slice(0, Math.max(1, end)).join(' ').toLowerCase();
}
// The (supplier, ocrText) → learned identifier rows this confirm plants. Returns {learned}.
function saveSupplierIdentifiers(db, { supplierName, ocrText, documentId } = {}) {
  if (!_identifierRegistryOn(db)) return { learned: 0 };
  const scope = normalizeSupplierName(String(supplierName || '').trim());
  if (!scope || !ocrText) return { learned: 0 };
  const toks = _distinctiveTokens(supplierName);
  const htext = _headerText(ocrText);
  const nameInHeader = toks.length ? toks.some(t => htext.includes(t)) : false;
  if (!nameInHeader) return { learned: 0 };   // C2 name-gate — no self-name in the header ⇒ never learn
  let ids;
  try { ids = require('./identifierExtract').extractIdentifiers(ocrText); } catch { return { learned: 0 }; }
  const up = db.prepare(`INSERT INTO supplier_identifiers (supplier_name, kind, value_norm, source_doc_id, issuer_region)
      VALUES (@s, @k, @v, @d, 'header')
      ON CONFLICT(supplier_name, kind, value_norm)
      DO UPDATE SET times_seen = times_seen + 1, last_seen = datetime('now'), source_doc_id = @d`);
  let learned = 0;
  for (const idn of ids) {
    if (idn.position.region !== 'header') continue;     // slice 1a: top-band-only learn (footer deferred, Oracle C2)
    up.run({ s: scope, k: idn.kind, v: idn.value_norm, d: documentId || null });
    learned++;
  }
  return { learned };
}
// Inverse (deconfirm): re-derive this doc's learned identifiers and decrement/delete them — mirrors
// retractConfirmHints. Idempotent by construction; a row at times_seen<=1 is deleted.
function retractSupplierIdentifiers(db, documentId) {
  if (!_identifierRegistryOn(db)) return { decremented: 0, deleted: 0 };
  let doc;
  try { doc = db.prepare('SELECT supplier_name, ocr_text FROM documents WHERE id = ?').get(documentId); } catch { doc = null; }
  if (!doc) return { decremented: 0, deleted: 0 };
  const scope = normalizeSupplierName(String(doc.supplier_name || '').trim());
  if (!scope || !doc.ocr_text) return { decremented: 0, deleted: 0 };
  let ids;
  try { ids = require('./identifierExtract').extractIdentifiers(doc.ocr_text); } catch { return { decremented: 0, deleted: 0 }; }
  const pick = db.prepare('SELECT id, times_seen FROM supplier_identifiers WHERE supplier_name = ? AND kind = ? AND value_norm = ?');
  const del = db.prepare('DELETE FROM supplier_identifiers WHERE id = ?');
  const dec = db.prepare("UPDATE supplier_identifiers SET times_seen = times_seen - 1, last_seen = datetime('now') WHERE id = ?");
  let decremented = 0, deleted = 0;
  for (const idn of ids) {
    if (idn.position.region !== 'header') continue;
    const row = pick.get(scope, idn.kind, idn.value_norm);
    if (!row) continue;
    if ((row.times_seen || 0) <= 1) { del.run(row.id); deleted++; }
    else { dec.run(row.id); decremented++; }
  }
  return { decremented, deleted };
}

// The learned registry, for the slice-1b MATCH path (threaded to Python as --identifiers-file). Only
// meaningful rows (times_seen>=1). Table-guarded so an older DB / fixture returns []. The caller gates
// the LOAD on the DARK switch, so an un-armed install ships an empty file (engine no-ops → inert).
function getAllSupplierIdentifiers(db) {
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='supplier_identifiers'").get()) return [];
    return db.prepare('SELECT supplier_name, kind, value_norm, times_seen FROM supplier_identifiers WHERE times_seen >= 1').all();
  } catch { return []; }
}

module.exports = {
  FORMAT_SOLID_MIN, persistConfirmedValues,
  saveSupplierIdentifiers, retractSupplierIdentifiers, getAllSupplierIdentifiers,
  insertExtractions, deleteExtractions,
  getFieldValueHistory, getDocumentsForFieldValue, purgeFieldValue, renameFieldValue, getPrefixModelForScope,
  getSupplierScopeCounts, renameSupplier, findDuplicateSupplierPairs,
  saveCorrections, retractConfirmHints, replantConfirmHints, getHints, getAllHints, isPlausibleSupplierName, isPlausibleSupplierNameBase, isNameLikeField, nameQuality, issuerReadLooksImplausible, findNearMatchIdentity, normalizeSupplierName,
  saveAnchor, sanitizeAnchorLabel, clearAnchors, getAllAnchors, getAnchorsForScope, getTaughtFieldKeys, deleteAnchor,
  saveLogoFingerprint, getAllLogos, findLogoMatch,
  detailCrossPlantCloser: _detailCrossPlantCloser,   // exported for the detail-backfill script's final anti-poison check (2026-07-23)
  getFieldFormats, getDigitsOnlyFields,
  getRecoverySummary, getRecoveryDetail, getMemoryInventory, resetAllLearning,
  resetToFreshInstall, getLearningFootprintForDocuments,
  clearFieldAnchorsForScope, clearSupplierHintsForScope, clearCorrectionsForScope,
  saveFieldRule, getFieldRules, clearFieldRulesForScope,
  getSetting, setSetting,
  getAcceptedNames, addAcceptedName, removeAcceptedName,
  getAcceptedIssuers, addAcceptedIssuer, removeAcceptedIssuer,
};
