'use strict';
/*
 * src/services/lookupImport.js — CSV / XLSX import for Quick File Records lists (design
 * QUICKFILE_LOOKUP_LISTS_2026-09-21.md; Oracle C4/C5). Transport-agnostic + injectable so the IPC edge and a
 * future /v1 lane share it. Parse-in-caller (MAIN); this is pure logic over a Buffer + a list definition.
 *
 * Safety: NO learning touch (records are a reference store). Transactional apply — any throw rolls back, so a
 * bad row never leaves a half-imported list (fail-toward: the list is unchanged on error). Dedupe on a
 * COMPOSITE key only (folded master + a disambiguator); with no upsert key configured it INSERTS everything
 * and reports name collisions — it NEVER silently merges two same-named subjects (reggie).
 */
const fileKinds = require('../lib/fileKinds');
const { parseCsv } = require('../lib/csvParse');
const ooxmlGrid = require('../lib/ooxmlGrid');
const { normaliseDate } = require('../../database/modules/date_parse');
const { foldIdentity } = require('../../database/modules/name_proximity');

const COMMIT_CAPS = { maxSheets: 1, maxRows: 50000, maxCols: 200, maxCellLen: 2000, maxTotalCells: 5_000_000 };

// Excel serial → DD-MM-YYYY (C5: 1900 leap-year bug + Mac/1904 date system). null on a non-date serial.
function excelSerialToDMY(serial, date1904) {
  const n = Number(serial);
  if (!isFinite(n) || n < 0 || n > 400000) return null;
  let days = Math.floor(n);
  let epochMs;
  if (date1904) { epochMs = Date.UTC(1904, 0, 1); }
  else { epochMs = Date.UTC(1899, 11, 31); if (days >= 60) days -= 1; }   // drop phantom 1900-02-29
  const d = new Date(epochMs + days * 86400000);
  if (isNaN(d.getTime())) return null;
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
}

// Parse a staged import buffer → { ok, headers, rows, date1904, isXlsx, truncated } (rows = DATA rows).
function parseBuffer(buf, ext) {
  const e = fileKinds.normExt(ext);
  if (e === '.csv') {
    const { rows, truncated } = parseCsv(buf.toString('utf8'), { maxRows: COMMIT_CAPS.maxRows, maxCols: COMMIT_CAPS.maxCols });
    if (!rows.length) return { ok: false, error: 'empty' };
    return { ok: true, headers: rows[0].map((h) => String(h).trim()), rows: rows.slice(1), date1904: false, isXlsx: false, truncated };
  }
  if (e === '.xlsx') {
    const g = ooxmlGrid.extractGrid(buf, COMMIT_CAPS);
    if (!g || !g.sheets.length || !g.sheets[0].rows.length) return { ok: false, error: 'empty' };
    const rows = g.sheets[0].rows;
    return { ok: true, headers: rows[0].map((h) => String(h).trim()), rows: rows.slice(1), date1904: !!g.date1904, isXlsx: true, truncated: g.truncated };
  }
  return { ok: false, error: 'unsupported_type' };
}

// Coerce one imported cell for a target list column. Date columns → serial/DMY through the every-door
// normaliser; anything unparseable → { value:'', dateError:true } (import blank + flag, never store a bad date).
function _coerce(cell, colType, { isXlsx, date1904 }) {
  const raw = String(cell == null ? '' : cell).trim();   // edge-trim (internal whitespace/newlines preserved by CSV/xlsx already)
  if (colType !== 'date' || raw === '') return { value: raw };
  let dmy = null;
  if (isXlsx && /^\d+(\.\d+)?$/.test(raw)) dmy = excelSerialToDMY(raw, date1904);   // an Excel serial
  const norm = normaliseDate(dmy || raw);
  if (!norm) return { value: '', dateError: true, raw };
  return { value: norm };
}

/**
 * Build + APPLY an import into a list, transactionally.
 * @param db
 * @param list         hydrated list { id, master_key, columns:[{key,type}], upsert_key:[colKey]|null }
 * @param parsed       { headers, rows, date1904, isXlsx }
 * @param columnMap    { [listColumnKey]: headerIndex }  — which CSV/xlsx column fills each list column
 * @param opts         { mode:'append'|'replace' }
 * @returns { ok, inserted, updated, skipped, dateFlags, collisions, errors[] }
 */
function applyImport(db, list, parsed, columnMap, opts = {}) {
  if (!list || !list.master_key) return { ok: false, error: 'bad_list' };
  const masterCol = list.master_key;
  if (columnMap[masterCol] == null) return { ok: false, error: 'no_master_mapping' };
  const colType = {};
  for (const c of (list.columns || [])) colType[c.key] = c.type || 'text';
  const upsertKeys = Array.isArray(list.upsert_key) && list.upsert_key.length ? list.upsert_key : null;
  const composite = (values) => (upsertKeys || []).map((k) => foldIdentity(String(values[k] || ''))).join('\u0001');

  // Pre-build the record set (bounded already by parse caps). Validate the master here.
  const staged = [];
  const errors = [];
  let skipped = 0, dateFlags = 0;
  parsed.rows.forEach((row, i) => {
    const values = {};
    let dateErr = false;
    for (const colKey of Object.keys(columnMap)) {
      const idx = columnMap[colKey];
      const c = _coerce(row[idx], colType[colKey], parsed);
      values[colKey] = c.value;
      if (c.dateError) { dateErr = true; dateFlags++; errors.push({ row: i + 2, error: 'bad_date', column: colKey, raw: c.raw }); }
    }
    const master = String(values[masterCol] || '').trim();
    if (!master) { skipped++; errors.push({ row: i + 2, error: 'blank_master' }); return; }   // +2: header + 1-based
    staged.push({ values, master });
    void dateErr;   // a bad date does not reject the row (imported blank + flagged) — reggie
  });

  const now = new Date().toISOString();
  let inserted = 0, updated = 0, collisions = 0;
  const tx = db.transaction(() => {
    if (opts.mode === 'replace') db.prepare('DELETE FROM lookup_records WHERE list_id = ?').run(list.id);

    // Existing composite index (for upsert). Only built when an upsert key is configured.
    const existing = new Map();
    if (upsertKeys && opts.mode !== 'replace') {
      for (const r of db.prepare('SELECT id, master_value, values_json FROM lookup_records WHERE list_id = ?').all(list.id)) {
        let vals; try { vals = JSON.parse(r.values_json); } catch { vals = {}; }
        existing.set(composite(vals), r.id);
      }
    }
    const ins = db.prepare('INSERT INTO lookup_records (list_id, master_value, values_json, disambiguator, source, updated_at) VALUES (?,?,?,?,?,?)');
    const upd = db.prepare('UPDATE lookup_records SET master_value=?, values_json=?, updated_at=? WHERE id=?');
    const disamb = (values) => (list.disambiguator_key ? String(values[list.disambiguator_key] || '') || null : null);
    const seenThisImport = new Map();
    for (const rec of staged) {
      const key = upsertKeys ? composite(rec.values) : null;
      if (upsertKeys && existing.has(key)) { upd.run(rec.master, JSON.stringify(rec.values), now, existing.get(key)); updated++; continue; }
      if (upsertKeys && seenThisImport.has(key)) { upd.run(rec.master, JSON.stringify(rec.values), now, seenThisImport.get(key)); updated++; continue; }
      const id = ins.run(list.id, rec.master, JSON.stringify(rec.values), disamb(rec.values), 'import', now).lastInsertRowid;
      inserted++;
      if (upsertKeys) seenThisImport.set(key, id);
      // No upsert key: a row whose master collides with something already present is reported (never merged).
      if (!upsertKeys) {
        const dup = db.prepare('SELECT COUNT(*) n FROM lookup_records WHERE list_id=? AND master_value=? COLLATE NOCASE').get(list.id, rec.master).n;
        if (dup > 1) collisions++;
      }
    }
  });
  try { tx(); } catch (e) { return { ok: false, error: 'apply_failed', detail: e.message }; }
  return { ok: true, inserted, updated, skipped, dateFlags, collisions, errors: errors.slice(0, 200) };
}

module.exports = { parseBuffer, applyImport, excelSerialToDMY, COMMIT_CAPS };
