'use strict';
/*
 * src/lib/csvParse.js — a small, dependency-free RFC-4180-ish CSV parser for the Quick File Records-list
 * IMPORT (design QUICKFILE_LOOKUP_LISTS_2026-09-21.md). Handles: UTF-8 BOM strip, delimiter auto-detect
 * (comma / semicolon [EU Excel] / tab), quoted fields with embedded delimiter+newline, doubled-quote escape,
 * CRLF. Row 1 = headers. Row/field caps guard memory. Pure (string in, rows out) so it pins directly.
 */
function parseCsv(text, { maxRows = 50000, maxCols = 200, maxCellLen = 2000 } = {}) {
  text = String(text || '');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);            // strip UTF-8 BOM (Excel exports carry it)
  // Delimiter: the one that appears most on the first physical line.
  const nl = text.indexOf('\n');
  const first = nl >= 0 ? text.slice(0, nl) : text;
  const count = (s, c) => (s.split(c).length - 1);
  let delim = ',', best = count(first, ',');
  for (const d of [';', '\t']) { const n = count(first, d); if (n > best) { delim = d; best = n; } }

  const rows = [];
  let row = [], field = '', inQ = false, truncated = false;
  const pushField = () => { row.push(field.length > maxCellLen ? field.slice(0, maxCellLen) : field); field = ''; };
  const pushRow = () => { pushField(); if (row.length > maxCols) { row = row.slice(0, maxCols); truncated = true; } rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') { inQ = true; }
    else if (ch === delim) { pushField(); }
    else if (ch === '\r') { /* CRLF: handled on \n */ }
    else if (ch === '\n') { pushRow(); if (rows.length >= maxRows) { truncated = true; break; } }
    else field += ch;
  }
  if (field.length || row.length) pushRow();
  // Drop a trailing all-empty row (a file ending in a newline).
  while (rows.length && rows[rows.length - 1].every((c) => String(c).trim() === '')) rows.pop();
  return { rows, delimiter: delim, truncated };
}

module.exports = { parseCsv };
