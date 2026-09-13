'use strict';
/*
 * src/lib/ooxmlGrid.js — dependency-free .xlsx → cell GRID, the visual-preview twin of ooxmlText.js
 * (which extracts words for search). Route 1 of the 2026-09-13 spreadsheet-preview decision: no new
 * dependency, no external converter — reuse the ooxmlText ZIP reader + a small XML parse to produce a
 * capped 2-D grid the renderer draws as an HTML table. NOT a full spreadsheet engine: values only, no
 * number-format/style/merge/chart fidelity (that would need styles.xml — a later route if wanted).
 *
 * Pure (takes a Buffer, no fs/net) so it can be pinned directly. Everything is capped (rows/cols/cells/
 * sheets/cell-length) so a monster workbook can't blow memory or the IPC payload. Only .xlsx (OOXML);
 * legacy .xls / .ods are a different container and yield null (caller shows "no preview").
 */
const { openZip, readZipEntry, decodeXml } = require('./ooxmlText');

const MAX_SHEETS    = 12;
const MAX_ROWS      = 200;     // per sheet
const MAX_COLS      = 40;      // per sheet
const MAX_CELL_LEN  = 300;     // per cell (chars)
const MAX_TOTAL_CELLS = 20000; // across all sheets (payload guard)

// "A" → 0, "Z" → 25, "AA" → 26 …
function colToIdx(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}
function clipCell(s) {
  s = String(s == null ? '' : s);
  return s.length > MAX_CELL_LEN ? s.slice(0, MAX_CELL_LEN) + '…' : s;
}

// xl/sharedStrings.xml → array of plain strings (rich-text runs concatenated).
function parseSharedStrings(xml) {
  const out = [];
  if (!xml) return out;
  const siRe = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    if (m[1] == null) { out.push(''); continue; }       // <si/>
    const parts = [];
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRe.exec(m[1]))) parts.push(decodeXml(t[1]));
    out.push(parts.join(''));
  }
  return out;
}

// Map sheet display names → worksheet part path, in tab order. Falls back to numeric enumeration.
function sheetOrder(names, workbookXml, relsXml) {
  const order = [];
  if (workbookXml && relsXml) {
    const rels = {};
    let r;
    const relRe = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/?>/g;
    while ((r = relRe.exec(relsXml))) {
      let target = r[2].replace(/^\/?xl\//, '').replace(/^\//, '');
      rels[r[1]] = target.startsWith('worksheets/') ? 'xl/' + target : (target.includes('worksheets/') ? 'xl/' + target.slice(target.indexOf('worksheets/')) : 'xl/' + target);
    }
    let s;
    const sheetRe = /<sheet\b[^>]*\bname="([^"]*)"[^>]*?(?:r:id|r:ID|id)="([^"]+)"[^>]*\/?>/g;
    while ((s = sheetRe.exec(workbookXml))) {
      const part = rels[s[2]];
      if (part && names.includes(part)) order.push({ name: decodeXml(s[1]) || `Sheet ${order.length + 1}`, part });
    }
  }
  if (order.length) return order;
  // Fallback: every xl/worksheets/sheetN.xml in numeric order, generic names.
  return names
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => (+(a.match(/(\d+)/)[1]) - +(b.match(/(\d+)/)[1])))
    .map((part, i) => ({ name: `Sheet ${i + 1}`, part }));
}

// One worksheet XML → { rows:[[cell,…]], truncated } (sparse cells filled, capped).
function parseSheet(xml, shared, budget) {
  const grid = [];
  let maxCol = -1, truncated = false;
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    if (grid.length >= MAX_ROWS) { truncated = true; break; }
    const rowCells = [];
    const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cRe.exec(rm[2]))) {
      const attrs = cm[1] || '';
      const inner = cm[2] || '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
      const col = ref ? colToIdx(ref[1]) : rowCells.length;
      if (col >= MAX_COLS) { truncated = true; continue; }
      const t = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
      let val = '';
      if (t === 'inlineStr') {
        const is = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
        val = is ? decodeXml(is[1]) : '';
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        const raw = v ? decodeXml(v[1]) : '';
        if (t === 's') val = shared[parseInt(raw, 10)] || '';
        else if (t === 'b') val = raw === '1' ? 'TRUE' : (raw === '0' ? 'FALSE' : raw);
        else val = raw;
      }
      rowCells[col] = clipCell(val);
      if (col > maxCol) maxCol = col;
      if (--budget.cells <= 0) { truncated = true; break; }
    }
    grid.push(rowCells);
    if (budget.cells <= 0) { truncated = true; break; }
  }
  // Normalise every row to the same width (fill sparse gaps with '').
  const width = Math.min(maxCol + 1, MAX_COLS);
  const rows = grid.map((r) => { const o = []; for (let i = 0; i < width; i++) o.push(r[i] || ''); return o; });
  return { rows, truncated };
}

/**
 * Parse an .xlsx buffer into a capped grid for preview.
 * @param {Buffer} buf
 * @returns {{sheets:Array<{name:string, rows:string[][]}>, truncated:boolean}|null}
 *          null when the buffer is not a readable OOXML spreadsheet.
 */
function extractGrid(buf) {
  try {
    const z = openZip(buf);
    if (!z) return null;
    const names = Object.keys(z.entries);
    if (!names.some((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) return null;   // not an xlsx

    const ssBuf = readZipEntry(z, 'xl/sharedStrings.xml');
    const shared = parseSharedStrings(ssBuf ? ssBuf.toString('utf8') : '');

    const wbBuf   = readZipEntry(z, 'xl/workbook.xml');
    const relsBuf = readZipEntry(z, 'xl/_rels/workbook.xml.rels');
    const order = sheetOrder(names, wbBuf && wbBuf.toString('utf8'), relsBuf && relsBuf.toString('utf8'));

    const budget = { cells: MAX_TOTAL_CELLS };
    let truncated = order.length > MAX_SHEETS;
    const sheets = [];
    for (const { name, part } of order.slice(0, MAX_SHEETS)) {
      const b = readZipEntry(z, part);
      if (!b) continue;
      const { rows, truncated: t } = parseSheet(b.toString('utf8'), shared, budget);
      sheets.push({ name, rows });
      if (t) truncated = true;
      if (budget.cells <= 0) { truncated = true; break; }
    }
    if (!sheets.length) return null;
    return { sheets, truncated };
  } catch { return null; }
}

module.exports = { extractGrid, colToIdx, parseSharedStrings, MAX_ROWS, MAX_COLS, MAX_SHEETS };
