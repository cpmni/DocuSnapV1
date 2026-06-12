'use strict';

// ── Extractions ───────────────────────────────────────────────────────────────

function insertExtractions(db, document_id, rows) {
  const stmt = db.prepare(`
    INSERT INTO extractions
      (document_id, field_key, raw_value, display_value,
       confidence, extraction_method, validation_note, corrected_to, anchor_label)
    VALUES
      (@document_id, @field_key, @raw_value, @display_value,
       @confidence, @extraction_method, @validation_note, @corrected_to, @anchor_label)
  `);
  const insertMany = db.transaction((rows) => {
    for (const row of rows) stmt.run({ document_id, corrected_to: null, anchor_label: null, ...row });
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
function isPlausibleSupplierName(value) {
  const t = String(value == null ? '' : value).trim().replace(/:+$/, '');
  if (!t) return false;
  if (t.length <= 3 && !/\s/.test(t) && t === t.toUpperCase() && !/\d/.test(t)) {
    return false;
  }
  // Digit-dominant reference shapes misread into the supplier field ("t 38/07",
  // "36552", "12/345") — reject when there are 2+ digits AND fewer than 3
  // letters. Keeps letter-rich names that merely contain digits ("3M",
  // "G2 Environmental", "24/7 Services"). Mirrors keyword._is_plausible_supplier_name.
  const nAlpha = (t.match(/[A-Za-z]/g) || []).length;
  const nDigit = (t.match(/\d/g) || []).length;
  if (nAlpha < 3 && nDigit >= 2) return false;
  return true;
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
  // Only clear COORDINATE-based anchors (x_norm > 0 OR y_norm > 0).
  // Text-only anchors (x_norm = 0, y_norm = 0) are position-independent —
  // they are anchored to the label string's presence in OCR text, not to a
  // saved pixel position, so they are unaffected by scan-registration drift.
  // Clearing them when a correction is made would throw away learned label
  // relationships that are still correct (e.g. "Work Address" -> customer_name)
  // just because the crop coordinates from a different scan were stale.
  const stmt = db.prepare(`
    DELETE FROM field_anchors
    WHERE field_key = @field_key
      AND (x_norm > 0 OR y_norm > 0)
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

function saveAnchor(db, {
  supplier_name, document_type, field_key,
  anchor_label, direction, page_zone, x_norm, y_norm,
  w_norm = 0, h_norm = 0
}) {
  const key = {
    supplier_name: supplier_name || '__unknown__',
    document_type: document_type || null,
    field_key, anchor_label, direction,
  };
  const incoming = {
    page_zone,
    x_norm: x_norm || 0, y_norm: y_norm || 0,
    w_norm: w_norm || 0, h_norm: h_norm || 0,
  };

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

  // Tolerance is derived from the anchor's OWN stored footprint (half its
  // larger dimension, floored at ANCHOR_MIN_TOLERANCE) — so "is this the same
  // spot" scales with each field's value-box size for any supplier, field, or
  // future template, rather than using one fixed distance for every anchor.
  const tolerance = Math.max(existing.w_norm, existing.h_norm, ANCHOR_MIN_TOLERANCE) / 2;
  const distance  = _centerDistance(incoming.x_norm, incoming.y_norm, existing.x_norm, existing.y_norm);

  let next;
  if (distance <= tolerance) {
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

// ── Auto-label discovery from confirmed documents ─────────────────────────────
//
// At confirmation time, scan the stored OCR text to find what label precedes
// each confirmed field value. Save discovered labels as text-only anchors
// (x_norm=0, y_norm=0) — these are position-independent and drift-tolerant.
//
// This closes the gap where the ⊕ tool teaches coordinate anchors that work
// well when page-registration is stable but break when the same document type
// appears with different scan margins. Text-only anchors find the value via the
// label string wherever it actually appears in the OCR, regardless of position.
//
// The discovery is a simple "what immediately precedes this value on the same
// OCR line?" search, with two separator patterns:
//   1. Colon-separated:  "Work Address: Beaumont Care Homes Ltd - Tudordale"
//   2. Multi-space:      "Work Address   Beaumont Care Homes Ltd - Tudordale"
//      (column layout where Tesseract streams two columns on one output line)
//
// Anchors accumulate usage_count through saveAnchor's upsert — after two or
// three confirmations the same label is seen consistently, making it a reliable
// extraction signal for future documents of the same supplier/type.

function learnAnchorsFromText(db, {
  supplier_name, document_type, document_id, confirmedValues, taughtFields = []
}) {
  if (!supplier_name || !document_type || !confirmedValues) return;

  const row = db.prepare('SELECT ocr_text FROM documents WHERE id = ?').get(document_id);
  const ocrText = row && row.ocr_text;
  if (!ocrText) return;

  const effectiveSup = normalizeSupplierName(supplier_name);
  const taught = new Set(taughtFields);
  const lines  = ocrText.split('\n');

  for (const [field_key, rawValue] of Object.entries(confirmedValues)) {
    if (taught.has(field_key)) continue;      // ⊕-taught: already has a precise anchor
    const value = String(rawValue || '').trim();
    if (value.length < 4) continue;           // too short to anchor reliably

    const label = _discoverLabel(lines, value);
    if (!label) continue;

    saveAnchor(db, {
      supplier_name: effectiveSup,
      document_type: document_type || null,
      field_key,
      anchor_label:  label,
      direction:     'right',
      page_zone:     null,
      x_norm:        0,
      y_norm:        0,
      w_norm:        0,
      h_norm:        0,
    });
  }
}

// Scan OCR lines for the first occurrence of `value` that has a label-like
// text immediately to its left (colon-separated, or 3+-space column separator).
function _discoverLabel(lines, value) {
  const valueLower = value.toLowerCase();
  for (const line of lines) {
    const idx = line.toLowerCase().indexOf(valueLower);
    if (idx <= 0) continue;

    const before = line.substring(0, idx);

    // Primary: "Label: Value" (most common form field pattern)
    const colonPos = before.lastIndexOf(':');
    if (colonPos >= 0) {
      const label = _extractTrailingLabel(before.substring(0, colonPos));
      if (label) return label;
    }

    // Fallback: column-separated "Label   Value" (3+ spaces = OCR column gap)
    const m = before.match(/([A-Za-z][A-Za-z.\-/]*(?:\s[A-Za-z][A-Za-z.\-/]*){0,2})\s{3,}$/);
    if (m) {
      const label = m[1].trim();
      if (label.length >= 2 && label.length <= 35 && /[A-Za-z]{2,}/.test(label)) return label;
    }

    // no label found on this occurrence — keep searching later lines
  }
  return null;
}

// Extract the last 1–3-word alphabetic phrase from the end of a string.
// "...   Work Address" -> "Work Address"   "...2603-1351-1   Ticket No." -> "Ticket No."
function _extractTrailingLabel(text) {
  const m = text.trimEnd().match(/([A-Za-z][A-Za-z.\-/]*(?:\s[A-Za-z][A-Za-z.\-/]*){0,2})$/);
  if (!m) return null;
  const label = m[1].trim();
  if (label.length < 2 || label.length > 35) return null;
  if (!/[A-Za-z]{2,}/.test(label)) return null;
  return label;
}

function getAllAnchors(db) {
  return db.prepare(
    'SELECT * FROM field_anchors ORDER BY usage_count DESC, confidence DESC'
  ).all();
}

// ── Logo fingerprints ─────────────────────────────────────────────────────────

function saveLogoFingerprint(db, { supplier_name, phash, ahash }) {
  const existing = db.prepare(
    'SELECT id, phash FROM logo_fingerprints WHERE supplier_name = ?'
  ).all(supplier_name);

  for (const row of existing) {
    if (hammingDistance(row.phash, phash) <= 10) {
      db.prepare(`
        UPDATE logo_fingerprints
        SET match_count = match_count + 1, last_seen = datetime('now')
        WHERE id = ?
      `).run(row.id);
      return;
    }
  }
  db.prepare(`
    INSERT INTO logo_fingerprints (supplier_name, phash, ahash)
    VALUES (?, ?, ?)
  `).run(supplier_name, phash, ahash);
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

  return { anchors, hints, corrections, logos };
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

  return { anchors, hints, corrections, logos };
}

function clearFieldAnchorsForScope(db, { supplier_name, document_type } = {}) {
  if (!supplier_name) return { changes: 0 };
  const dt = document_type || null;
  return db.prepare(`
    DELETE FROM field_anchors
    WHERE supplier_name = @supplier_name AND (@dt IS NULL OR document_type = @dt)
  `).run({ supplier_name, dt });
}

function clearSupplierHintsForScope(db, { supplier_name, document_type } = {}) {
  if (!supplier_name) return { changes: 0 };
  const dt = document_type || null;
  return db.prepare(`
    DELETE FROM supplier_hints
    WHERE supplier_name = @supplier_name AND (@dt IS NULL OR document_type = @dt)
  `).run({ supplier_name, dt });
}

// Extreme-use recovery only — corrections are the audit trail behind
// supplier_hints/field_anchors AND getFieldFormats()'s format-anomaly
// learning (see Stage 7 in CLAUDE.md). Clearing them does not undo any
// hints/anchors already derived from them; it only stops them counting
// toward future format-consensus and audit history for this exact scope.
function clearCorrectionsForScope(db, { supplier_name, document_type } = {}) {
  if (!supplier_name) return { changes: 0 };
  const dt = document_type || null;
  return db.prepare(`
    DELETE FROM corrections
    WHERE supplier_name = @supplier_name AND (@dt IS NULL OR document_type = @dt)
  `).run({ supplier_name, dt });
}

// ── Format templates (OCR correction) ────────────────────────────────────────

function getFieldFormats(db) {
  // For each supplier+doctype+field, collect the final confirmed values
  // (corrected value if user edited, otherwise the extracted display value).
  const rows = db.prepare(`
    SELECT
      e.document_id,
      d.supplier_name,
      dt.slug        AS document_type,
      e.field_key,
      e.display_value,
      c.corrected_value
    FROM extractions e
    JOIN  documents      d  ON d.id  = e.document_id
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    LEFT JOIN corrections   c  ON c.document_id = e.document_id
                               AND c.field_key  = e.field_key
    WHERE d.status          = 'confirmed'
      AND d.supplier_name   IS NOT NULL
      AND d.supplier_name   != ''
      AND d.supplier_name   != '__global__'
      AND (e.display_value IS NOT NULL OR c.corrected_value IS NOT NULL)
    ORDER BY d.confirmed_at DESC, d.id DESC
  `).all();

  const groups = {};
  for (const row of rows) {
    const finalValue = (row.corrected_value || row.display_value || '').trim();
    if (!finalValue) continue;

    const key = `${row.supplier_name}|${row.document_type || ''}|${row.field_key}`;
    if (!groups[key]) {
      groups[key] = {
        supplier_name: row.supplier_name,
        document_type: row.document_type || '',
        field_key:     row.field_key,
        _values:       new Set(),
        _count:        0,
      };
    }
    groups[key]._values.add(finalValue);
    groups[key]._count += 1;
  }

  // Only return groups with 3+ distinct confirmed values (enough to learn a pattern).
  // confirmed_count (total confirmed instances, not deduped) lets consumers like
  // ocr_corrector's noise-profile inference enforce their own, stricter "enough
  // examples" thresholds without a second DB round-trip.
  return Object.values(groups)
    .filter(g => g._values.size >= 3)
    .map(({ _values, _count, ...rest }) => ({
      ...rest,
      sample_values:   [..._values].slice(0, 20),
      confirmed_count: _count,
    }));
}

// Confirmed-history association of supplier → its most common document type.
// Used as a CONSERVATIVE fallback type signal (engine.py Fix B "type bridge"):
// when a document's supplier is identified (logo fingerprint, template, hint or
// anchor vote) but neither on-page keyword/heading detection nor a template
// produced a document type, the type the supplier has most often been CONFIRMED
// under fills the gap. Returns one row per supplier — the single dominant type
// — with the confirmed instance count so the consumer can gate on a minimum
// history. Reusable + schema-driven: works for any supplier and any (built-in
// or custom) document type, no hardcoded names. Read-only.
function getSupplierDocTypes(db) {
  const rows = db.prepare(`
    SELECT d.supplier_name AS supplier_name,
           dt.slug          AS document_type_slug,
           COUNT(*)         AS confirmed_count
    FROM documents d
    JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.status        = 'confirmed'
      AND d.supplier_name IS NOT NULL
      AND d.supplier_name != ''
      AND d.supplier_name != '__global__'
      AND dt.slug         IS NOT NULL
    GROUP BY d.supplier_name, dt.slug
  `).all();

  // Reduce to the dominant type per supplier (most confirmed instances).
  // Keyed by the normalised supplier identity so the same supplier always maps
  // to one bucket regardless of OCR edge-noise spelling.
  const bySupplier = {};
  for (const r of rows) {
    const key = normalizeSupplierName(r.supplier_name);
    const cur = bySupplier[key];
    if (!cur || r.confirmed_count > cur.confirmed_count) {
      bySupplier[key] = {
        supplier_name:      key,
        document_type_slug: r.document_type_slug,
        confirmed_count:    r.confirmed_count,
      };
    }
  }
  return Object.values(bySupplier);
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
    counts.documents_unlinked      = db.prepare(
      'UPDATE documents SET template_id = NULL WHERE template_id IS NOT NULL').run().changes;
    counts.template_field_mappings = del('DELETE FROM template_field_mappings');
    counts.template_fields         = del('DELETE FROM template_fields');
    counts.templates               = del('DELETE FROM templates');
    counts.template_groups         = del('DELETE FROM template_groups');
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

module.exports = {
  insertExtractions, deleteExtractions,
  saveCorrections, getHints, isPlausibleSupplierName, normalizeSupplierName,
  saveAnchor, clearAnchors, getAllAnchors, learnAnchorsFromText,
  saveLogoFingerprint, getAllLogos, findLogoMatch,
  getFieldFormats, getDigitsOnlyFields, getSupplierDocTypes,
  getRecoverySummary, getRecoveryDetail, getMemoryInventory, resetAllLearning,
  clearFieldAnchorsForScope, clearSupplierHintsForScope, clearCorrectionsForScope,
  getSetting, setSetting,
};
