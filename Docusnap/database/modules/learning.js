'use strict';

// ── Extractions ───────────────────────────────────────────────────────────────

function insertExtractions(db, document_id, rows) {
  const stmt = db.prepare(`
    INSERT INTO extractions
      (document_id, field_key, raw_value, display_value,
       confidence, extraction_method, validation_note)
    VALUES
      (@document_id, @field_key, @raw_value, @display_value,
       @confidence, @extraction_method, @validation_note)
  `);
  const insertMany = db.transaction((rows) => {
    for (const row of rows) stmt.run({ document_id, ...row });
  });
  insertMany(rows);
}

function deleteExtractions(db, document_id) {
  return db.prepare(
    'DELETE FROM extractions WHERE document_id = ?'
  ).run(document_id);
}

// ── Corrections & hints ───────────────────────────────────────────────────────

function saveCorrections(db, document_id, corrections,
                         supplier_name, document_type, allValues, taughtFields = []) {
  const effectiveSupplier = supplier_name
    || (allValues && allValues.supplier_name)
    || '__global__';
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
  saveCorrections, getHints,
  saveAnchor, clearAnchors, getAllAnchors,
  saveLogoFingerprint, getAllLogos, findLogoMatch,
  getFieldFormats,
  getRecoverySummary, getRecoveryDetail,
  clearFieldAnchorsForScope, clearSupplierHintsForScope, clearCorrectionsForScope,
  getSetting, setSetting,
};
