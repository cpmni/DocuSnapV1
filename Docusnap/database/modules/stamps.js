'use strict';
/**
 * database/modules/stamps.js
 * --------------------------
 * Data-access for the stamp CATALOG (stamp_types) and, from slice 1, the append-only stamp
 * RECORD (stamp_events). Pure data layer — the permission policy lives in
 * src/modules/auth/stampPermission.js, the placement/render/hashing in src/services/pdfStamp.js.
 *
 * stamp_types is a mutable catalog; a PLACED stamp snapshots its label/colour into stamp_events so a
 * later rename/delete can never rewrite history (see database/index.js). Slice 0 wires only the catalog
 * reads + create; the stamp_events INSERT (atomic artifact + record + audit cross-link) is slice 1.
 */

const BUILT_IN_KEYS = ['paid', 'approved', 'rejected', 'received', 'on_hold', 'void'];
// A custom stamp may not re-use a built-in DECISION word — those carry approval-flow meaning.
const RESERVED_LABELS = ['APPROVED', 'REJECTED', 'VOID'];

function _slugKey(label) {
  return String(label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function listStampTypes(db, { includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE active = 1';
  return db.prepare(
    `SELECT id, key, label, color, category, built_in, active, created_by, created_at
       FROM stamp_types ${where} ORDER BY built_in DESC, id ASC`).all();
}

function getStampType(db, id) {
  return db.prepare('SELECT * FROM stamp_types WHERE id = ?').get(id);
}

function getStampTypeByKey(db, key) {
  return db.prepare('SELECT * FROM stamp_types WHERE key = ?').get(String(key || '').trim().toLowerCase());
}

/**
 * Create a custom stamp type. Returns { ok:true, id } or a refusal { ok:false, code, error }.
 * Guards (barry's spec): non-empty word; length cap; no exact-duplicate label; no built-in decision
 * word. The 5 house colours are enforced by the caller/UI; here we only require a hex string.
 */
function createStampType(db, { label, color, category = null, createdBy = null } = {}) {
  const word = String(label || '').trim().toUpperCase();
  if (!word) return { ok: false, code: 'EMPTY', error: 'A stamp needs a word.' };
  if (word.length > 16) return { ok: false, code: 'TOO_LONG', error: 'Keep the stamp word to 16 characters or fewer.' };
  if (RESERVED_LABELS.includes(word)) {
    return { ok: false, code: 'RESERVED', error: `"${word}" is a built-in stamp — pick a different word.` };
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(String(color || ''))) {
    return { ok: false, code: 'BAD_COLOR', error: 'Pick a colour for the stamp.' };
  }
  const existing = db.prepare('SELECT id FROM stamp_types WHERE UPPER(label) = ?').get(word);
  if (existing) return { ok: false, code: 'DUPLICATE', error: `You already have a "${word}" stamp.` };
  let key = _slugKey(word) || `stamp_${Date.now()}`;
  if (getStampTypeByKey(db, key)) key = `${key}_${Date.now()}`;   // key collision on a punctuation-fold
  const info = db.prepare(
    `INSERT INTO stamp_types (key, label, color, category, built_in, active, created_by, created_at)
     VALUES (?, ?, ?, ?, 0, 1, ?, datetime('now'))`).run(key, word, color, category, createdBy);
  return { ok: true, id: info.lastInsertRowid, key };
}

// ── stamp_events: the append-only record of truth (slice 1) ────────────────────
// Write-once rows (INSERT only — UPDATE/DELETE are trigger-blocked). The orchestration (render the
// artifact, hash source+artifact, cross-link an audit row) lives in src/services/stampService.js; this
// is just the parameterised INSERT + the ordered reads the cumulative render + history use.
const STAMP_EVENT_COLS = ['document_id', 'stamp_type_id', 'type_key_snapshot', 'type_label_snapshot',
  'type_color_snapshot', 'placed_by_user_id', 'placed_by_username_snapshot', 'placed_at', 'placement_json',
  'note', 'source_sha256', 'artifact_path', 'artifact_sha256', 'route_id', 'content_sha256', 'audit_ref',
  'created_at'];

function insertStampEvent(db, row = {}) {
  const r = {};
  for (const c of STAMP_EVENT_COLS) r[c] = row[c] === undefined ? null : row[c];
  const info = db.prepare(
    `INSERT INTO stamp_events (${STAMP_EVENT_COLS.join(', ')})
     VALUES (${STAMP_EVENT_COLS.map(c => '@' + c).join(', ')})`).run(r);
  return info.lastInsertRowid;
}

// Every stamp on a document, oldest first (the order the cumulative render applies them).
function listStampEventsForDoc(db, documentId) {
  return db.prepare('SELECT * FROM stamp_events WHERE document_id = ? ORDER BY id ASC').all(documentId);
}

// The most recent stamp on a document (its artifact is the current stamped view + the next base).
function latestStampEvent(db, documentId) {
  return db.prepare('SELECT * FROM stamp_events WHERE document_id = ? ORDER BY id DESC LIMIT 1').get(documentId);
}

function countStampsForDoc(db, documentId) {
  return db.prepare('SELECT COUNT(*) AS n FROM stamp_events WHERE document_id = ?').get(documentId).n;
}

module.exports = {
  listStampTypes, getStampType, getStampTypeByKey, createStampType,
  insertStampEvent, listStampEventsForDoc, latestStampEvent, countStampsForDoc,
  STAMP_EVENT_COLS, BUILT_IN_KEYS, RESERVED_LABELS,
};
