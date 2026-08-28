'use strict';
/*
 * exportService.js — read-only export of CONFIRMED document data to CSV / JSON.
 * -----------------------------------------------------------------------------
 * The user picks suppliers, document types and fields (from a Home → Export
 * window); we pivot the one-row-per-field `extractions` store into one row PER
 * DOCUMENT (one column per selected field), preferring the human's confirmed
 * answer (correction → display_value → raw_value, via
 * documents.getConfirmedFieldValues). This module ONLY reads + shapes +
 * serialises; the export IPC handler owns the OS save dialog and the file write.
 *
 * Design decisions (advisor consensus barry/bob/eric → Oracle, 2026-08-27 night):
 *  - CSV is the guaranteed format (UTF-8 BOM so Excel opens it cleanly; CRLF;
 *    RFC-4180 quoting; CSV-formula-injection neutralised). JSON keeps list fields
 *    as real arrays for a clean database import.
 *  - Scope defaults to status='confirmed' (reviewed data only). A cap
 *    (EXPORT_ROW_CAP) protects against an accidental whole-corpus dump; the
 *    caller surfaces `truncated` with a "narrow your filter" note.
 *  - Path columns: `folder_path` (the user's OWN filed location) is OPT-IN and
 *    OFF by default; `stored_path` / `working_path` are NEVER exported (the same
 *    fields the /v1 DTO deliberately hides).
 */

const documents = require('../../database/modules/documents');
const document_types = require('../../database/modules/document_types');

const EXPORT_ROW_CAP = 10000;

// The universal metadata spine. `from` reads the value off a confirmed-documents
// row. `def` = ticked by default in the picker. folder_path is opt-in (off).
const META_COLUMNS = [
  { key: '_supplier',   label: 'Document Issuer', def: true,  from: (d) => d.supplier_name },
  { key: '_type',       label: 'Document type',   def: true,  from: (d) => d.type_name },
  { key: '_date',       label: 'Date',            def: true,  from: (d) => d.doc_date },
  { key: '_reference',  label: 'Reference',       def: true,  from: (d) => d.reference_number },
  { key: '_filename',   label: 'File name',       def: true,  from: (d) => d.original_filename },
  { key: '_confidence', label: 'Confidence',      def: false, from: (d) => (d.overall_confidence == null ? '' : d.overall_confidence) },
  { key: '_filed_at',   label: 'Date filed',      def: false, from: (d) => d.confirmed_at },
  { key: '_folder',     label: 'Filed folder',    def: false, from: (d) => d.folder_path },
];
const META_BY_KEY = new Map(META_COLUMNS.map((m) => [m.key, m]));

// ── Pickers ──────────────────────────────────────────────────────────────────
// Everything the Export window needs to build its selectors, in one read.
function listOptions(db) {
  const suppliers = db.prepare(`
    SELECT d.supplier_name AS name, COUNT(*) AS docs
    FROM documents d
    WHERE d.status = 'confirmed' AND d.supplier_name IS NOT NULL AND TRIM(d.supplier_name) <> ''
    GROUP BY LOWER(TRIM(d.supplier_name))
    ORDER BY docs DESC, name COLLATE NOCASE
  `).all();

  // confirmed-doc count per type slug (drives the "(N documents)" hint)
  const counts = new Map();
  try {
    for (const r of db.prepare(`
      SELECT LOWER(dt.slug) AS slug, COUNT(*) AS n
      FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
      WHERE d.status = 'confirmed'
      GROUP BY LOWER(dt.slug)
    `).all()) counts.set(r.slug, r.n);
  } catch { /* best-effort */ }

  // Types with their NON-structural fields (the three structural roles ship in
  // the metadata spine, so they're not offered again as pickable field columns).
  const types = (document_types.getAllWithFields(db) || []).map((t) => {
    const structural = new Set(['supplier_name', t.ref_field_key, t.date_field_key].filter(Boolean));
    const fields = (t.fields || [])
      .filter((f) => f.enabled !== 0 && !structural.has(f.key))
      .map((f) => ({ key: f.key, label: f.label, type: f.type }));
    return { slug: t.slug, name: t.name, docs: counts.get(String(t.slug).toLowerCase()) || 0, fields };
  });

  return {
    suppliers,
    types,
    meta: META_COLUMNS.map(({ key, label, def }) => ({ key, label, def })),
  };
}

// ── The confirmed-documents query (filtered) ─────────────────────────────────
// Read-only. Filters: suppliers[] (exact, case-insensitive), typeSlugs[],
// includeNeedsReview (default false → confirmed only), filedFrom/filedTo (ISO,
// on confirmed_at — a reliably sortable timestamp, unlike the display doc_date).
function _buildDocQuery(filters = {}) {
  const where = [];
  const params = [];
  const statuses = filters.includeNeedsReview ? ['confirmed', 'needs_review'] : ['confirmed'];
  where.push(`d.status IN (${statuses.map(() => '?').join(',')})`);
  params.push(...statuses);

  const sups = (filters.suppliers || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  if (sups.length) {
    where.push(`LOWER(TRIM(COALESCE(d.supplier_name,''))) IN (${sups.map(() => '?').join(',')})`);
    params.push(...sups);
  }
  const slugs = (filters.typeSlugs || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  if (slugs.length) {
    where.push(`LOWER(COALESCE(dt.slug,'')) IN (${slugs.map(() => '?').join(',')})`);
    params.push(...slugs);
  }
  // "Date filed" = confirmed_at (ISO timestamp). '￿' makes <= cover the whole final day.
  if (filters.filedFrom) { where.push('d.confirmed_at >= ?'); params.push(String(filters.filedFrom)); }
  if (filters.filedTo)   { where.push('d.confirmed_at <= ?'); params.push(String(filters.filedTo) + '￿'); }
  // "Document date" = doc_date, stored canonical DD-MM-YYYY (filing.normaliseDate). Reformat to a
  // sortable YYYY-MM-DD to compare against the ISO date input; a shape guard means only genuinely
  // DD-MM-YYYY dates participate (an undated / odd-format doc is excluded when a doc-date range is set).
  const DOC_DD = "d.doc_date GLOB '[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9]'";
  const DOC_ISO = "(substr(d.doc_date,7,4)||'-'||substr(d.doc_date,4,2)||'-'||substr(d.doc_date,1,2))";
  if (filters.docFrom) { where.push(`(${DOC_DD} AND ${DOC_ISO} >= ?)`); params.push(String(filters.docFrom)); }
  if (filters.docTo)   { where.push(`(${DOC_DD} AND ${DOC_ISO} <= ?)`); params.push(String(filters.docTo)); }

  const sql = `
    SELECT d.id, d.supplier_name, d.doc_date, d.reference_number, d.original_filename,
           d.folder_path, d.overall_confidence, d.confirmed_at,
           dt.name AS type_name, dt.slug AS type_slug
    FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE ${where.join(' AND ')}
    ORDER BY d.confirmed_at DESC, d.id DESC`;
  return { sql, params };
}

// How many documents match (cheap COUNT for the live preview count).
function countMatches(db, filters = {}) {
  const { sql, params } = _buildDocQuery(filters);
  const countSql = `SELECT COUNT(*) AS n FROM (${sql.replace(/ORDER BY[\s\S]*$/, '')})`;
  try { return db.prepare(countSql).get(...params).n; }
  catch { return 0; }
}

// Format a date VALUE for output per the app's Settings → "Date format (region)"
// choice (`region_date_order`: dmy | mdy | ymd). String-based (no Date parsing
// pitfalls), deterministic. `kind` = 'ddmmyyyy' (doc_date / date-type fields, the
// stored canonical) or 'iso' (confirmed_at timestamp). A value that doesn't match
// the expected shape is returned unchanged.
function _fmtDate(value, kind, order) {
  if (value == null || value === '') return '';
  let y, mo, da;
  if (kind === 'iso') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (!m) return String(value);
    y = m[1]; mo = m[2]; da = m[3];
  } else {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(value));
    if (!m) return String(value);
    da = m[1]; mo = m[2]; y = m[3];
  }
  switch (order) {
    case 'mdy': return `${mo}/${da}/${y}`;
    case 'ymd': return `${y}-${mo}-${da}`;
    default:    return `${da}/${mo}/${y}`;   // dmy (default)
  }
}

// ── Gather → { columns, rows, count, truncated } ─────────────────────────────
// columns: [{ key, label, isField, fieldType }]  rows: [{ [colKey]: value }]
// metaKeys: which META_COLUMNS to include (in META order). fields: [{key,label,type}]
// (already resolved by the caller from the selected types' field sets).
function gather(db, filters = {}, sel = {}) {
  const metaKeys = Array.isArray(sel.metaKeys) ? sel.metaKeys : META_COLUMNS.filter((m) => m.def).map((m) => m.key);
  const fields = Array.isArray(sel.fields) ? sel.fields : [];
  const limit = Math.min(sel.limit || EXPORT_ROW_CAP, EXPORT_ROW_CAP);
  const order = sel.dateOrder || 'dmy';   // Settings → "Date format (region)"

  const columns = [];
  for (const m of META_COLUMNS) if (metaKeys.includes(m.key)) columns.push({ key: m.key, label: m.label, isField: false });
  const seenField = new Set();
  for (const f of fields) {
    if (!f || !f.key || seenField.has(f.key)) continue;
    seenField.add(f.key);
    columns.push({ key: f.key, label: f.label || f.key, isField: true, fieldType: f.type || 'text' });
  }

  const { sql, params } = _buildDocQuery(filters);
  const docRows = db.prepare(sql).all(...params);
  const count = docRows.length;
  const use = docRows.slice(0, limit);

  const rows = [];
  for (const d of use) {
    const rec = {};
    for (const key of metaKeys) {
      const m = META_BY_KEY.get(key); if (!m) continue;
      let v = m.from(d);
      if (key === '_date') v = _fmtDate(v, 'ddmmyyyy', order);       // document date (stored DD-MM-YYYY)
      else if (key === '_filed_at') v = _fmtDate(v, 'iso', order);   // confirmed_at (ISO timestamp)
      rec[key] = v;
    }
    if (seenField.size) {
      const vals = documents.getConfirmedFieldValues(db, d.id) || [];
      const map = new Map(vals.map((v) => [v.field_key, v.value]));
      for (const f of fields) if (seenField.has(f.key)) {
        let v = map.has(f.key) ? map.get(f.key) : '';
        if (f.type === 'date') v = _fmtDate(v, 'ddmmyyyy', order);   // a date-type field (normalised DD-MM-YYYY)
        rec[f.key] = v;
      }
    }
    rows.push(rec);
  }
  return { columns, rows, count, truncated: count > use.length, cap: limit };
}

// ── Serialisers ──────────────────────────────────────────────────────────────
// RFC-4180 CSV cell + CSV-formula-injection neutralisation. A cell that begins
// with = + - @ (or a control char) is executed as a formula when opened in
// Excel; prefix a lone apostrophe UNLESS the cell is a plain number (so a
// negative amount like "-50.00" is left intact).
function _csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(?:[.,]\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// A truncation marker (Oracle F1-C1: a capped export must be self-identifying in
// the artifact, not silently partial). `trunc` = { exported, total } | null.
function _truncNote(trunc) {
  return trunc
    ? `TRUNCATED: exported the first ${trunc.exported} of ${trunc.total} matching rows — narrow the filter to export the rest.`
    : '';
}

function toCsv(columns, rows, trunc) {
  const header = columns.map((c) => _csvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => _csvCell(r[c.key])).join(','));
  // Leading UTF-8 BOM so Excel double-click opens it as UTF-8; CRLF line breaks.
  let out = '﻿' + [header, ...body].join('\r\n') + (body.length ? '\r\n' : '');
  if (trunc) out += '# ' + _truncNote(trunc) + '\r\n';
  return out;
}

function toJson(columns, rows, trunc) {
  const out = rows.map((r) => {
    const o = {};
    for (const c of columns) {
      let v = r[c.key];
      if (c.isField && c.fieldType === 'list' && typeof v === 'string' && v.trim()) {
        v = v.split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean);
      }
      o[c.label] = v == null || v === '' ? null : v;
    }
    return o;
  });
  if (trunc) out.push({ _truncated: true, _exported: trunc.exported, _total: trunc.total });
  return JSON.stringify(out, null, 2);   // NO BOM (JSON is not the Excel-CSV path)
}

// Real .xlsx (dependency-free, every cell inline text so reference/invoice
// numbers survive Excel's on-open type coercion). Returns a Buffer.
function toXlsx(columns, rows, trunc) {
  const xlsxWriter = require('../lib/xlsxWriter');
  let xr = rows;
  if (trunc && columns.length) {
    const note = {}; note[columns[0].key] = _truncNote(trunc);
    xr = rows.concat([note]);
  }
  return xlsxWriter.buildXlsx(columns, xr, 'Scan Finder export');
}

// Plain-English one-liner of the applied filters, for the audit record (WHAT left,
// not just how many rows — Oracle). Names counts only, never the sender values.
function filterSummary(filters = {}) {
  const p = [];
  p.push((filters.suppliers && filters.suppliers.length) ? `${filters.suppliers.length} sender(s)` : 'all senders');
  p.push((filters.typeSlugs && filters.typeSlugs.length) ? `${filters.typeSlugs.length} type(s)` : 'all types');
  if (filters.includeNeedsReview) p.push('incl. in-review');
  if (filters.docFrom || filters.docTo) p.push(`doc-date ${filters.docFrom || '…'}..${filters.docTo || '…'}`);
  if (filters.filedFrom || filters.filedTo) p.push(`filed ${filters.filedFrom || '…'}..${filters.filedTo || '…'}`);
  return p.join(', ');
}

module.exports = {
  EXPORT_ROW_CAP,
  META_COLUMNS,
  listOptions,
  countMatches,
  gather,
  toCsv,
  toJson,
  toXlsx,
  filterSummary,
  _csvCell,      // exported for the pin test
  _fmtDate,      // exported for the pin test
  _buildDocQuery,
};
