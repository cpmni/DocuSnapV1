'use strict';

// ── Extractions ───────────────────────────────────────────────────────────────

function insertExtractions(db, document_id, rows) {
  const stmt = db.prepare(`
    INSERT INTO extractions
      (document_id, field_key, raw_value, display_value,
       confidence, extraction_method, validation_note, corrected_to, anchor_label, candidates)
    VALUES
      (@document_id, @field_key, @raw_value, @display_value,
       @confidence, @extraction_method, @validation_note, @corrected_to, @anchor_label, @candidates)
  `);
  const insertMany = db.transaction((rows) => {
    // corrected_to is the proposed (not-yet-applied) correction candidate from
    // Stage 4.5; anchor_label records the label an anchor-based read used (for the
    // review "From anchor:" note); candidates is the disambiguation-picker JSON (migration
    // 48). All default to null so callers that don't set them are unaffected — and the null
    // default is REQUIRED (better-sqlite3 throws "missing named parameter" without it).
    for (const row of rows) stmt.run({ document_id, corrected_to: null, anchor_label: null, candidates: null, ...row });
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
                         supplier_name, document_type, allValues, taughtFields = []) {
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
        if (!taught.has(field_key)) {
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
           page_zone, x_norm, y_norm, w_norm, h_norm,
           offset_dx_norm, offset_dy_norm, last_authoritative_at)
        VALUES
          (@supplier_name, @document_type, @field_key, @anchor_label, @direction,
           @page_zone, @x_norm, @y_norm, @w_norm, @h_norm,
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
         direction, page_zone, x_norm, y_norm, w_norm, h_norm)
      VALUES
        (@supplier_name, @document_type, @field_key, @anchor_label,
         @direction, @page_zone, @x_norm, @y_norm, @w_norm, @h_norm)
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
        last_seen   = datetime('now')
    WHERE id = @id
  `).run({ id: existing.id, page_zone: incoming.page_zone, ...next });
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
    WHERE (@sn IS NULL OR supplier_name = @sn) AND (@dt IS NULL OR document_type = @dt)
  `).run({ sn, dt });
}

function clearSupplierHintsForScope(db, { supplier_name, document_type } = {}) {
  const sn = supplier_name || null, dt = document_type || null;
  if (!sn && !dt) return { changes: 0 };
  return db.prepare(`
    DELETE FROM supplier_hints
    WHERE (@sn IS NULL OR supplier_name = @sn) AND (@dt IS NULL OR document_type = @dt)
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
    WHERE (@sn IS NULL OR supplier_name = @sn) AND (@dt IS NULL OR document_type = @dt)
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
    WHERE (@sn IS NULL OR supplier_name = @sn) AND (@dt IS NULL OR document_type = @dt)
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

function getFieldFormats(db) {
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
      fld.type       AS field_type
    FROM extractions e
    JOIN  documents      d  ON d.id  = e.document_id
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    LEFT JOIN fields        fld ON fld.document_type_id = d.document_type_id
                               AND fld.key = e.field_key
    LEFT JOIN corrections   c  ON c.document_id = e.document_id
                               AND c.field_key  = e.field_key
    WHERE d.status          = 'confirmed'
      AND (e.display_value IS NOT NULL OR c.corrected_value IS NOT NULL)
      -- Never learn from SHADOW reconciliation reads: they back the "verified" total check
      -- for fields the type doesn't define, and are unconfirmed by the user.
      AND (e.extraction_method IS NULL OR e.extraction_method <> 'shadow_reconcile')
    ORDER BY d.confirmed_at DESC, d.id DESC
  `).all();

  const groups = {};
  const addTo = (supplierKey, docType, fieldKey, value) => {
    const key = `${supplierKey}|${docType}|${fieldKey}`;
    let g = groups[key];
    if (!g) {
      g = groups[key] = {
        supplier_name: supplierKey, document_type: docType, field_key: fieldKey,
        _values: new Set(), _valueCounts: new Map(), _count: 0,
      };
    }
    g._values.add(value);
    g._valueCounts.set(value, (g._valueCounts.get(value) || 0) + 1);
    g._count += 1;
  };

  for (const row of rows) {
    const finalValue = (row.corrected_value || row.display_value || '').trim();
    if (!finalValue) continue;
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
      addTo(supplier, docType, row.field_key, finalValue);
    }
    // Doc-type-scoped — always, across every supplier (incl. none).
    if (docType) {
      addTo('', docType, row.field_key, finalValue);
    }
  }

  // Emit a group when EITHER: 3+ DISTINCT confirmed values (enough to learn a VARIABLE
  // pattern), OR the SAME value recurs strongly (3+ confirmations, few distinct) — a
  // CONSTANT field like a model/serial code whose value OCR keeps misreading. The latter
  // is what enables ocr_corrector's O→0/I→1 character fix for constant-value fields, which
  // by definition have <3 distinct values (mirrors ocr_corrector.MIN_CONFIRMED_FOR_SINGLE_SHAPE=3).
  // confirmed_count (total confirmed instances, not deduped) is carried so consumers can
  // apply their own stricter thresholds (e.g. the noise-profile gate needs 10+).
  return Object.values(groups)
    .filter(g => g._values.size >= 3 || g._count >= 3)
    .map(({ _values, _valueCounts, _count, ...rest }) => ({
      ...rest,
      sample_values:   [..._values].slice(0, 20),
      confirmed_count: _count,
      // Per-value confirmed-document counts (newest distinct first, capped) so
      // the Python shape model can learn the SET of shapes each confirmed enough
      // times, not just one unanimous shape — letting a field legitimately carry
      // more than one structure (e.g. a 4- and a 5-digit reference).
      value_counts:    Object.fromEntries([..._valueCounts].slice(0, 200)),
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
  });
  tx();
  return { renamed: 1, before, after: getSupplierScopeCounts(db, to) };
}

module.exports = {
  insertExtractions, deleteExtractions,
  getFieldValueHistory, getDocumentsForFieldValue, purgeFieldValue, renameFieldValue,
  getSupplierScopeCounts, renameSupplier,
  saveCorrections, getHints, getAllHints, isPlausibleSupplierName, isPlausibleSupplierNameBase, isNameLikeField, nameQuality, normalizeSupplierName,
  saveAnchor, sanitizeAnchorLabel, clearAnchors, getAllAnchors, getAnchorsForScope, getTaughtFieldKeys, deleteAnchor,
  saveLogoFingerprint, getAllLogos, findLogoMatch,
  getFieldFormats, getDigitsOnlyFields,
  getRecoverySummary, getRecoveryDetail, getMemoryInventory, resetAllLearning,
  resetToFreshInstall, getLearningFootprintForDocuments,
  clearFieldAnchorsForScope, clearSupplierHintsForScope, clearCorrectionsForScope,
  saveFieldRule, getFieldRules, clearFieldRulesForScope,
  getSetting, setSetting,
  getAcceptedNames, addAcceptedName, removeAcceptedName,
  getAcceptedIssuers, addAcceptedIssuer, removeAcceptedIssuer,
};
