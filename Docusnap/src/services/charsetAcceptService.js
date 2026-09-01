'use strict';
/**
 * charsetAcceptService.js — "These characters are fine" (2026-09-01; reggie+gary → Oracle S-O-W/COND).
 *
 * When the operator vouches a charset-flagged character is legitimate, this:
 *   1. adds it to the per-field-TYPE allowlist (learning.addAcceptedFieldChars — garble-guarded);
 *   2. clears the "unexpected characters (…)" note LIVE on the current doc AND every needs_review
 *      sibling whose flagged chars are ALL now accepted (per that field's resolved TYPE spec-key);
 *   3. restores each cleared field to its OWN pre-cap confidence (from charset_flag_meta.precap — the
 *      note capped it to 70 and the pre-cap value is otherwise lost: the 08-15 fc_delta lesson);
 *   4. recomputes documents.overall_confidence JS-side as a FAITHFUL LOWER BOUND (no boost, no
 *      exclude_keys) stored as max(stored, recompute) — never lowers, never over-files.
 *
 * It does NOT file anything: the caller (renderer) triggers the normal scope-sweep afterwards, so the
 * now-eligible cleared siblings file through the existing C8-compliant offer→accept path (Oracle).
 *
 * Legacy rows (charset_flag_meta NULL — flagged before this feature shipped): the note is cleared but
 * the confidence is KEPT and the doc's overall is NOT recomputed (fail-toward-review; a reprocess
 * re-populates the meta if full restore is wanted).
 */
const path = require('path');
const learning = require('../../database/modules/learning');

const _FC_MISMATCH_BASE = 12, _FC_MISMATCH_STEP = 6, _FC_MISMATCH_CAP = 25;   // = validator.py:896-898

function _charsetKeys() {
  try {
    const cfg = require(path.join(__dirname, '..', '..', 'config', 'keyword_patterns.json'));
    return new Set(Object.keys((cfg && cfg.field_charsets) || {}));
  } catch { return new Set(); }
}
/** The spec-key the engine's flag used: the field TYPE if it has its own spec, else 'default'. */
function specKey(fieldType, csKeys) {
  const t = String(fieldType == null ? '' : fieldType);
  return csKeys.has(t) ? t : 'default';
}
/** The chars a row was flagged for + its pre-cap confidence. Prefers the structural meta; falls back
 *  to parsing the note (legacy rows, precap unknown). null when the row carries no charset flag. */
function flaggedFor(row) {
  const meta = row.charset_flag_meta;
  if (meta) {
    try {
      const m = typeof meta === 'string' ? JSON.parse(meta) : meta;
      if (m && Array.isArray(m.chars)) return { chars: m.chars.map(String), precap: Number.isFinite(m.precap) ? m.precap : null };
    } catch { /* fall through to note parse */ }
  }
  const mm = /^unexpected characters \((.+)\) - please verify$/.exec(String(row.validation_note || ''));
  if (mm) return { chars: mm[1].split(' ').filter(Boolean), precap: null };
  return null;
}
/** JS port of validator.overall_confidence + format_consistency_delta — a conservative LOWER BOUND:
 *  omits the positive boost and omits exclude_keys (hidden empty fields count as 0). Returns 0..100. */
function recomputeOverall(extrByKey, fieldDefs) {
  const req = fieldDefs.filter(f => f.required).map(f => f.key);
  const keyFields = req.length ? req : fieldDefs.map(f => f.key);
  if (!keyFields.length) return 0;
  let sum = 0, n = 0, mismatched = 0;
  for (const k of keyFields) {
    const d = extrByKey[k];
    const valued = d && d.value != null && String(d.value) !== '';
    if (valued) { sum += Number(d.confidence) || 0; n++; if (d.validation_note) mismatched++; }
    else { sum += 0; n++; }                              // schema field with no value → 0 (from_schema path)
  }
  const base = n ? Math.round(sum / n) : 0;
  const delta = mismatched ? -Math.min(_FC_MISMATCH_CAP, _FC_MISMATCH_BASE + _FC_MISMATCH_STEP * (mismatched - 1)) : 0;
  return Math.max(0, Math.min(100, base + delta));
}

/**
 * Apply an operator char-accept across the review queue.
 * @returns {{ok, accepted:string[], typeKey, clearedDocs:number[], clearedFields:number, error?}}
 */
function applyCharsetAccept(db, { docId, fieldKey }) {
  if (!docId || !fieldKey) return { ok: false, error: 'bad-args' };
  const csKeys = _charsetKeys();

  // ── the current field: its flagged chars + resolved type key ──────────────────────────────────
  const cur = db.prepare(`SELECT e.confidence, e.validation_note, e.charset_flag_meta, d.document_type_id
                          FROM extractions e JOIN documents d ON d.id = e.document_id
                          WHERE e.document_id = ? AND e.field_key = ?`).get(docId, fieldKey);
  if (!cur) return { ok: false, error: 'no-field' };
  const flagged = flaggedFor(cur);
  if (!flagged || !flagged.chars.length) return { ok: false, error: 'not-charset-flagged' };
  const curType = _fieldType(db, cur.document_type_id, fieldKey);
  const typeKey = specKey(curType, csKeys);

  // ── garble guard: refuse the WHOLE accept if ANY candidate is not a plain ASCII symbol ─────────
  const bad = flagged.chars.filter(c => !learning.isAcceptableFieldChar(c));
  if (bad.length) return { ok: false, error: 'unreadable-characters', chars: bad };

  // ── persist (idempotent, garble-guarded again inside) ─────────────────────────────────────────
  const { added } = learning.addAcceptedFieldChars(db, typeKey, flagged.chars);
  const acceptedNow = learning.getAcceptedFieldChars(db);   // full object, post-add

  // ── live clear/restore across the queue, then recompute affected docs ─────────────────────────
  const rows = db.prepare(`SELECT e.id, e.document_id, e.field_key, e.confidence, e.validation_note,
                                  e.charset_flag_meta, d.document_type_id
                           FROM extractions e JOIN documents d ON d.id = e.document_id
                           WHERE d.status = 'needs_review'
                             AND (e.charset_flag_meta IS NOT NULL OR e.validation_note LIKE 'unexpected characters (%')`).all();
  const clearNote = db.prepare('UPDATE extractions SET validation_note = NULL, charset_flag_meta = NULL WHERE id = ?');
  const clearNoteRestore = db.prepare('UPDATE extractions SET validation_note = NULL, charset_flag_meta = NULL, confidence = ? WHERE id = ?');
  const affected = new Map();   // docId -> {restored:bool}

  const tx = db.transaction(() => {
    for (const r of rows) {
      const f = flaggedFor(r);
      if (!f) continue;
      const tk = specKey(_fieldType(db, r.document_type_id, r.field_key), csKeys);
      const acc = new Set(Array.isArray(acceptedNow[tk]) ? acceptedNow[tk] : []);
      if (!f.chars.every(c => acc.has(c))) continue;      // a still-unaccepted char → leave held
      if (f.precap != null) { clearNoteRestore.run(f.precap, r.id); markAffected(affected, r.document_id, true); }
      else { clearNote.run(r.id); markAffected(affected, r.document_id, false); }   // legacy: keep confidence
    }
    // recompute overall ONLY for docs that had a real (precap) restore (Oracle cond 3: legacy → hold)
    for (const [id, st] of affected) {
      if (!st.restored) continue;
      const defs = _fieldDefs(db, id);
      const ex = {};
      for (const e of db.prepare('SELECT field_key, display_value AS value, confidence, validation_note FROM extractions WHERE document_id = ?').all(id))
        ex[e.field_key] = e;
      const recomputed = recomputeOverall(ex, defs);
      const stored = db.prepare('SELECT overall_confidence AS o FROM documents WHERE id = ?').get(id).o || 0;
      const next = Math.max(stored, recomputed);
      if (next !== stored) db.prepare('UPDATE documents SET overall_confidence = ? WHERE id = ?').run(next, id);
    }
  });
  tx();

  return { ok: true, accepted: added, typeKey, clearedDocs: [...affected.keys()], clearedFields: rows.length ? [...affected.keys()].length : 0 };
}

function markAffected(map, id, restored) {
  const cur = map.get(id);
  if (cur) { cur.restored = cur.restored || restored; } else { map.set(id, { restored }); }
}
function _fieldType(db, documentTypeId, fieldKey) {
  const r = db.prepare('SELECT type FROM fields WHERE document_type_id = ? AND key = ?').get(documentTypeId, fieldKey);
  return r ? r.type : null;
}
function _fieldDefs(db, docId) {
  return db.prepare(`SELECT f.key, f.type, f.required FROM fields f
                     JOIN documents d ON d.document_type_id = f.document_type_id WHERE d.id = ?`).all(docId)
    .map(f => ({ key: f.key, type: f.type, required: !!f.required }));
}

module.exports = { applyCharsetAccept, recomputeOverall, flaggedFor, specKey };
