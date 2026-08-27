'use strict';
/*
 * xlsxWriter.js — minimal, dependency-free .xlsx (OOXML SpreadsheetML) writer.
 * -----------------------------------------------------------------------------
 * Produces a single-sheet workbook where EVERY cell is an inline string
 * (t="inlineStr"). That is deliberate: a data export's headline columns are
 * reference / invoice / account numbers, and Excel destroys those on open of a
 * CSV or a numeric cell — "007123" -> 7123, "1234567890123456" -> 1.23457E+15.
 * inlineStr preserves the exact text. No sharedStrings.xml, no styles.xml.
 *
 * The container is a ZIP built with the STORE method (no compression), so there
 * is NO deflate-correctness surface — only the ZIP headers + a self-contained
 * CRC-32 (Electron's bundled Node may predate zlib.crc32, so we don't rely on
 * it). A fixed 1980-01-01 DOS timestamp makes the output byte-deterministic
 * (pin-friendly) and needs no clock.
 *
 * NOTE: the accompanying pin (test_xlsx_writer.js) unzips + validates the parts
 * with Node, which is MORE LENIENT than Excel's OOXML parser. The Node pin does
 * NOT certify Excel-open compatibility — that must be verified by opening a real
 * file in Excel once (see the 2026-08-27 night handover).
 */

// ── CRC-32 (IEEE 802.3), table-based ─────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── XML text escaping (values + attributes; strip XML-illegal control chars) ──
// Built via new RegExp with \u escapes so the SOURCE carries no literal control
// bytes. XML 1.0 forbids 0x00-08, 0x0B, 0x0C, 0x0E-1F; \t \n \r are kept.
const XML_ILLEGAL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');
function xmlEsc(v) {
  return String(v == null ? '' : v)
    .replace(XML_ILLEGAL, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// 0-based column index -> A, B, ... Z, AA, AB, ...
function colLetter(n) {
  let s = '';
  n = n + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ── Sheet XML: header row + one inlineStr cell per column per row ─────────────
function _cell(ref, value) {
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
}
function sheetXml(columns, rows) {
  const parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  parts.push(`<row r="1">${columns.map((c, i) => _cell(colLetter(i) + '1', c.label)).join('')}</row>`);
  rows.forEach((row, ri) => {
    const rn = ri + 2;
    parts.push(`<row r="${rn}">${columns.map((c, i) => _cell(colLetter(i) + rn, row[c.key])).join('')}</row>`);
  });
  parts.push('</sheetData></worksheet>');
  return parts.join('');
}

function _sheetName(name) {
  const s = String(name || 'Export').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31);
  return s || 'Export';
}

// ── ZIP (STORE method, fixed 1980-01-01 timestamp) ───────────────────────────
const DOS_TIME = 0;       // 00:00:00
const DOS_DATE = 0x0021;  // 1980-01-01 (year 0 = 1980, month 1, day 1)

function _zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = e.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // flags: bit 11 = UTF-8 names
    local.writeUInt16LE(0, 8);            // method 0 = STORE
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra len
    chunks.push(local, nameBuf, data);

    const cdir = Buffer.alloc(46);
    cdir.writeUInt32LE(0x02014b50, 0);    // central dir signature
    cdir.writeUInt16LE(20, 4);            // version made by
    cdir.writeUInt16LE(20, 6);            // version needed
    cdir.writeUInt16LE(0x0800, 8);        // flags: UTF-8
    cdir.writeUInt16LE(0, 10);            // method STORE
    cdir.writeUInt16LE(DOS_TIME, 12);
    cdir.writeUInt16LE(DOS_DATE, 14);
    cdir.writeUInt32LE(crc, 16);
    cdir.writeUInt32LE(data.length, 20);
    cdir.writeUInt32LE(data.length, 24);
    cdir.writeUInt16LE(nameBuf.length, 28);
    cdir.writeUInt16LE(0, 30);            // extra len
    cdir.writeUInt16LE(0, 32);            // comment len
    cdir.writeUInt16LE(0, 34);            // disk number start
    cdir.writeUInt16LE(0, 36);            // internal attrs
    cdir.writeUInt32LE(0, 38);            // external attrs
    cdir.writeUInt32LE(offset, 42);       // local header offset
    central.push(Buffer.concat([cdir, nameBuf]));

    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);      // EOCD signature
  eocd.writeUInt16LE(0, 4);               // disk
  eocd.writeUInt16LE(0, 6);               // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);  // entries this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);         // central dir offset
  eocd.writeUInt16LE(0, 20);              // comment len
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '</Types>';
const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
  + '</Relationships>';
const WORKBOOK_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
  + '</Relationships>';

function buildXlsx(columns, rows, sheetName) {
  const cols = columns || [];
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets><sheet name="${xmlEsc(_sheetName(sheetName))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels',         data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'xl/workbook.xml',     data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WORKBOOK_RELS, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml',   data: Buffer.from(sheetXml(cols, rows || []), 'utf8') },
  ];
  return _zip(entries);
}

module.exports = { buildXlsx, crc32, colLetter, xmlEsc, sheetXml, _zip };
