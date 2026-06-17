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
    // corrected_to is the proposed (not-yet-applied) correction candidate from
    // Stage 4.5; anchor_label records the label an anchor-based read used (for the
    // review "From anchor:" note). Both default to null so callers that don't set
    // them are unaffected.
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
function sanitizeAnchorLabel(label) {
  if (!label || typeof label !== 'string') return '';
  const kept = label.trim().split(/\s+/).filter(tok => {
    if (!/[a-zA-Z]/.test(tok)) return false;                // bare number / ref / date
    if ((tok.match(/\d/g) || []).length >= 3) return false; // code-like serial
    return true;
  });
  return kept.join(' ').trim();
}

function saveAnchor(db, {
  supplier_name, document_type, field_key,
  anchor_label, direction, page_zone, x_norm, y_norm,
  w_norm = 0, h_norm = 0, authoritative = false,
  offset_dx_norm = null, offset_dy_norm = null
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
    // Remove sibling anchors for the SAME field/supplier/doc_type that are not
    // this exact label+direction, so the just-drawn box is the single source of
    // truth for the field's position and no stale row can win selection.
    //
    // Scope is (field_key, document_type) ACROSS ALL SUPPLIERS — deliberately
    // NOT restricted to this teach's supplier. The doc-type IS the layout here;
    // an operator teaching where a field sits is correcting it for that layout,
    // not for one resolved supplier identity. Without the cross-supplier sweep,
    // a stale anchor saved under a supplier the template/logo resolves to
    // (supplier-exact = higher selection priority) survives and out-ranks this
    // supplier-agnostic teach — the exact failure that made re-teaching look
    // broken. Superseding by (field, doc-type) makes the explicit teach win for
    // every future document of this type regardless of resolved supplier, which
    // is the intended supplier-optional, doc-type-driven behaviour.
    db.prepare(`
      DELETE FROM field_anchors
      WHERE field_key = @field_key
        AND ((document_type IS @document_type) OR document_type = @document_type)
        AND NOT (supplier_name = @supplier_name
                 AND anchor_label = @anchor_label AND direction = @direction)
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

  // Only return groups with 3+ distinct confirmed values (enough to learn a pattern).
  // confirmed_count (total confirmed instances, not deduped) lets consumers like
  // ocr_corrector's noise-profile inference enforce their own, stricter "enough
  // examples" thresholds without a second DB round-trip.
  return Object.values(groups)
    .filter(g => g._values.size >= 3)
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
  saveAnchor, sanitizeAnchorLabel, clearAnchors, getAllAnchors,
  saveLogoFingerprint, getAllLogos, findLogoMatch,
  getFieldFormats, getDigitsOnlyFields,
  getRecoverySummary, getRecoveryDetail, getMemoryInventory, resetAllLearning,
  resetToFreshInstall,
  clearFieldAnchorsForScope, clearSupplierHintsForScope, clearCorrectionsForScope,
  getSetting, setSetting,
};
