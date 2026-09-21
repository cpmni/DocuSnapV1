'use strict';
/**
 * database/modules/lookup.js — Quick File RECORDS LISTS (auto-fill lookup). Reference datasets keyed by a
 * master field that PRE-FILL a Quick File form's fields (mig 197; design QUICKFILE_LOOKUP_LISTS_2026-09-21.md,
 * Oracle SIGN-OFF-W/COND). DARK behind lookup_lists_enabled (the IPC edge gates; this pure DB module doesn't).
 *
 * SAFETY (Oracle C7 / PIN 1): this module NEVER reads or writes any LEARNING store, never calls a learning
 * reader, and never touches the auto-file eligibility check. It only manages the lookup_* tables + resolves a
 * chosen record into a {field_key: value} PREFILL map. The prefilled values are submitted through
 * directIntakeService as an intake='direct' row already excluded from every learning reader (Q-C1). Records
 * are USER-OWNED deterministic data, the opposite of ML learning. (The pin greps this file for the banned
 * identifiers, so this note deliberately names none of them verbatim.)
 *
 * Record identity is the SURROGATE id — master_value is NOT unique, so two "John Doe" are two rows that can
 * never merge (Oracle/reggie). Typeahead is token-PREFIX via src/lib/nameLookup (Oracle C3), never a
 * substring/first-token degrade.
 */
const nameLookup = require('../../src/lib/nameLookup');

const MAX_SUGGEST_SCAN = 20000;   // list rows scanned per keystroke (lists cap at 50k on import; debounced)
const _json = (s, d) => { try { const v = JSON.parse(s); return v == null ? d : v; } catch { return d; } };
const _now = () => new Date().toISOString();

// ── Lists ──────────────────────────────────────────────────────────────────────────────────────
function createList(db, { name, master_key, columns, disambiguator_key = null, upsert_key = null }) {
  const nm = String(name || '').trim();
  const mk = String(master_key || '').trim();
  if (!nm || !mk) return { ok: false, error: 'bad_request' };
  const cols = Array.isArray(columns) ? columns : [];
  const id = db.prepare(`INSERT INTO lookup_lists (name, master_key, columns_json, upsert_key_json, disambiguator_key, created_at, updated_at)
                         VALUES (?,?,?,?,?,?,?)`)
    .run(nm, mk, JSON.stringify(cols), upsert_key ? JSON.stringify(upsert_key) : null, disambiguator_key || null, _now(), _now())
    .lastInsertRowid;
  return { ok: true, id };
}
function _hydrateList(r) {
  if (!r) return null;
  return { id: r.id, name: r.name, master_key: r.master_key, disambiguator_key: r.disambiguator_key,
           columns: _json(r.columns_json, []), upsert_key: _json(r.upsert_key_json, null),
           created_at: r.created_at, updated_at: r.updated_at };
}
function getList(db, id) { return _hydrateList(db.prepare('SELECT * FROM lookup_lists WHERE id = ?').get(id)); }
function listLists(db) {
  return db.prepare(`SELECT l.*, (SELECT COUNT(*) FROM lookup_records r WHERE r.list_id = l.id) AS record_count
                     FROM lookup_lists l ORDER BY l.name COLLATE NOCASE`).all()
    .map(r => ({ ..._hydrateList(r), record_count: r.record_count }));
}
function updateList(db, id, changes = {}) {
  const allowed = { name: 'name', master_key: 'master_key' };
  const sets = []; const args = {};
  for (const k in allowed) if (k in changes) { sets.push(`${allowed[k]} = @${k}`); args[k] = String(changes[k] || '').trim(); }
  if ('columns' in changes) { sets.push('columns_json = @columns'); args.columns = JSON.stringify(Array.isArray(changes.columns) ? changes.columns : []); }
  if ('disambiguator_key' in changes) { sets.push('disambiguator_key = @dk'); args.dk = changes.disambiguator_key || null; }
  if ('upsert_key' in changes) { sets.push('upsert_key_json = @uk'); args.uk = changes.upsert_key ? JSON.stringify(changes.upsert_key) : null; }
  if (!sets.length) return { ok: true };
  sets.push('updated_at = @ua'); args.ua = _now(); args.id = id;
  db.prepare(`UPDATE lookup_lists SET ${sets.join(', ')} WHERE id = @id`).run(args);
  return { ok: true };
}
function deleteList(db, id) { db.prepare('DELETE FROM lookup_lists WHERE id = ?').run(id); return { ok: true }; }   // records + maps cascade

// ── Records ────────────────────────────────────────────────────────────────────────────────────
function _hydrateRecord(r) {
  if (!r) return null;
  return { id: r.id, list_id: r.list_id, master_value: r.master_value, values: _json(r.values_json, {}),
           disambiguator: r.disambiguator, source: r.source, updated_at: r.updated_at };
}
// A record's master_value is the DENORMALISED master column (so the index can serve prefix scans); values
// holds the non-master columns. Caller passes {values:{colKey:val}, ...}; we derive master_value from the list.
function addRecord(db, listId, { values = {}, disambiguator = null, source = null } = {}) {
  const list = getList(db, listId);
  if (!list) return { ok: false, error: 'unknown_list' };
  const master = String((values[list.master_key] != null ? values[list.master_key] : '')).trim();
  if (!master) return { ok: false, error: 'blank_master' };
  const id = db.prepare(`INSERT INTO lookup_records (list_id, master_value, values_json, disambiguator, source, updated_at)
                         VALUES (?,?,?,?,?,?)`)
    .run(listId, master, JSON.stringify(values), disambiguator, source, _now()).lastInsertRowid;
  return { ok: true, id };
}
function updateRecord(db, id, { values, disambiguator } = {}) {
  const cur = _hydrateRecord(db.prepare('SELECT * FROM lookup_records WHERE id = ?').get(id));
  if (!cur) return { ok: false, error: 'not_found' };
  const list = getList(db, cur.list_id);
  const nextVals = (values && typeof values === 'object') ? values : cur.values;
  const master = String((nextVals[list.master_key] != null ? nextVals[list.master_key] : cur.master_value)).trim();
  if (!master) return { ok: false, error: 'blank_master' };
  db.prepare('UPDATE lookup_records SET master_value=?, values_json=?, disambiguator=?, updated_at=? WHERE id=?')
    .run(master, JSON.stringify(nextVals), disambiguator != null ? disambiguator : cur.disambiguator, _now(), id);
  return { ok: true };
}
function deleteRecord(db, id) { db.prepare('DELETE FROM lookup_records WHERE id = ?').run(id); return { ok: true }; }
function countRecords(db, listId) { return db.prepare('SELECT COUNT(*) n FROM lookup_records WHERE list_id = ?').get(listId).n; }
function getRecords(db, listId, { offset = 0, limit = 100 } = {}) {
  return db.prepare('SELECT * FROM lookup_records WHERE list_id = ? ORDER BY master_value COLLATE NOCASE LIMIT ? OFFSET ?')
    .all(listId, Math.max(1, Math.min(500, limit)), Math.max(0, offset)).map(_hydrateRecord);
}

// Typeahead: token-PREFIX (Oracle C3), ranked, capped. Scans the list's rows (bounded) and matches in JS via
// nameLookup — NOT a SQL LIKE (which would degrade to first-token-only). Returns { rows, total } for "+N more".
function suggest(db, listId, query, { limit = 8 } = {}) {
  if (!query || String(query).trim().length < 3) return { rows: [], total: 0 };   // 3-char minimum
  const scan = db.prepare('SELECT id, master_value, disambiguator, values_json FROM lookup_records WHERE list_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(listId, MAX_SUGGEST_SCAN)
    .map(r => ({ id: r.id, master_value: r.master_value, disambiguator: r.disambiguator, values: _json(r.values_json, {}) }));
  return nameLookup.rankMatches(scan, query, { limit });
}

// ── Field maps (which list column fills which doc-type field) — ONE list per type (Oracle C6) ────
function getFieldMaps(db, documentTypeId) {
  return db.prepare('SELECT field_key, column_key, is_trigger, list_id FROM lookup_field_maps WHERE document_type_id = ?').all(documentTypeId);
}
function getListForType(db, documentTypeId) {
  const r = db.prepare('SELECT list_id FROM lookup_field_maps WHERE document_type_id = ? LIMIT 1').get(documentTypeId);
  return r ? r.list_id : null;
}
// Replace the whole map set for a type. C6: every map references the SAME list_id (enforced here, not a bad
// UNIQUE(document_type_id) — the table is one row per field). Empty maps → unbind the type.
function setFieldMaps(db, documentTypeId, listId, maps) {
  const rows = Array.isArray(maps) ? maps.filter(m => m && m.field_key && m.column_key) : [];
  if (rows.length && listId == null) return { ok: false, error: 'bad_request' };
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM lookup_field_maps WHERE document_type_id = ?').run(documentTypeId);
    if (!rows.length) return;
    const list = getList(db, listId);
    if (!list) throw new Error('unknown_list');
    const ins = db.prepare('INSERT INTO lookup_field_maps (document_type_id, list_id, field_key, column_key, is_trigger) VALUES (?,?,?,?,?)');
    for (const m of rows) ins.run(documentTypeId, listId, m.field_key, m.column_key, (m.column_key === list.master_key || m.is_trigger) ? 1 : 0);
  });
  try { tx(); } catch (e) { return { ok: false, error: e.message }; }
  return { ok: true };
}

// Resolve a chosen record into the doc-type's {field_key: value} PREFILL map (read-only; the caller sends it
// to directIntakeService as ordinary typed values — never a learning write).
function resolveRecordForType(db, documentTypeId, recordId) {
  const rec = _hydrateRecord(db.prepare('SELECT * FROM lookup_records WHERE id = ?').get(recordId));
  if (!rec) return { ok: false, error: 'not_found' };
  const list = getList(db, rec.list_id);
  const maps = getFieldMaps(db, documentTypeId).filter(m => m.list_id === rec.list_id);
  const out = {};
  for (const m of maps) {
    const v = (m.column_key === list.master_key) ? rec.master_value : rec.values[m.column_key];
    if (v != null && String(v).trim() !== '') out[m.field_key] = String(v);
  }
  return { ok: true, fields: out };
}

module.exports = {
  createList, getList, listLists, updateList, deleteList,
  addRecord, updateRecord, deleteRecord, getRecords, countRecords, suggest,
  getFieldMaps, getListForType, setFieldMaps, resolveRecordForType,
  MAX_SUGGEST_SCAN,
};
