'use strict';

// ── Extractions ───────────────────────────────────────────────────────────────

function insertExtractions(db, document_id, rows) {
  const stmt = db.prepare(`
    INSERT INTO extractions
      (document_id, field_key, raw_value, display_value,
       confidence, extraction_method)
    VALUES
      (@document_id, @field_key, @raw_value, @display_value,
       @confidence, @extraction_method)
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
                         supplier_name, document_type, allValues) {
  const effectiveSupplier = supplier_name
    || (allValues && allValues.supplier_name)
    || '__global__';

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
        // Clear bad anchors — if the user had to correct this field, the stored
        // anchor position was wrong. Wipe it so a correct one can be re-learned.
        clearAnchors(db, {
          supplier_name: effectiveSupplier,
          document_type: document_type || null,
          field_key,
        });
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

function saveAnchor(db, {
  supplier_name, document_type, field_key,
  anchor_label, direction, page_zone, x_norm, y_norm,
  w_norm = 0, h_norm = 0
}) {
  return db.prepare(`
    INSERT INTO field_anchors
      (supplier_name, document_type, field_key, anchor_label,
       direction, page_zone, x_norm, y_norm, w_norm, h_norm)
    VALUES
      (@supplier_name, @document_type, @field_key, @anchor_label,
       @direction, @page_zone, @x_norm, @y_norm, @w_norm, @h_norm)
    ON CONFLICT(supplier_name, document_type, field_key, anchor_label, direction)
    DO UPDATE SET
      usage_count = usage_count + 1,
      confidence  = MIN(1.0, confidence + 0.1),
      x_norm      = (@x_norm + x_norm) / 2.0,
      y_norm      = (@y_norm + y_norm) / 2.0,
      w_norm      = CASE WHEN @w_norm > 0 THEN (@w_norm + w_norm) / 2.0 ELSE w_norm END,
      h_norm      = CASE WHEN @h_norm > 0 THEN (@h_norm + h_norm) / 2.0 ELSE h_norm END,
      last_seen   = datetime('now')
  `).run({
    supplier_name: supplier_name || '__unknown__',
    document_type: document_type || null,
    field_key, anchor_label, direction, page_zone,
    x_norm: x_norm || 0, y_norm: y_norm || 0,
    w_norm: w_norm || 0, h_norm: h_norm || 0,
  });
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
      };
    }
    groups[key]._values.add(finalValue);
  }

  // Only return groups with 3+ distinct confirmed values (enough to learn a pattern)
  return Object.values(groups)
    .filter(g => g._values.size >= 3)
    .map(({ _values, ...rest }) => ({
      ...rest,
      sample_values: [..._values].slice(0, 20),
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
  getSetting, setSetting,
};
