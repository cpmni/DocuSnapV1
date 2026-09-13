'use strict';
/*
 * src/lib/ooxmlText.js — dependency-free plain-text extraction from OOXML (docx / xlsx / pptx), the
 * READER twin of xlsxWriter.js (QuickFile+Departments plan §3 Q2 / eric B.4). Used to fill a Quick File
 * doc's searchable text WITHOUT OCR or any new dependency: a minimal ZIP central-directory reader
 * (STORE + DEFLATE) + a tag strip over the text-bearing parts. Everything is capped (zip-bomb guard:
 * inflate maxOutputLength per part; total output clipped) and pure (takes a Buffer, no fs/net), so it
 * can run anywhere and be pinned directly. NOT a full office parser — it captures the words for search.
 */
const zlib = require('zlib');

const PART_CAP = 8 * 1024 * 1024;   // per-entry inflate ceiling (zip-bomb guard)
const TEXT_CAP = 200000;            // total characters kept

// ── minimal ZIP reader (central directory) ───────────────────────────────────
function _open(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return null;
  // EOCD: scan back for the signature (comment can push it up to 64k off the end).
  let eo = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eo = i; break; }
  }
  if (eo < 0) return null;
  let count, cdOff;
  try { count = buf.readUInt16LE(eo + 10); cdOff = buf.readUInt32LE(eo + 16); } catch { return null; }
  const entries = {};
  let p = cdOff;
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries[name] = { method, compSize, lho };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { buf, entries };
}
function _readEntry(z, name) {
  const e = z.entries[name];
  if (!e) return null;
  const buf = z.buf;
  if (e.lho + 30 > buf.length || buf.readUInt32LE(e.lho) !== 0x04034b50) return null;
  const nameLen = buf.readUInt16LE(e.lho + 26);
  const extraLen = buf.readUInt16LE(e.lho + 28);
  const start = e.lho + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return raw.subarray(0, PART_CAP);
  if (e.method === 8) { try { return zlib.inflateRawSync(raw, { maxOutputLength: PART_CAP }); } catch { return null; } }
  return null;   // unsupported method
}

// ── XML → text ────────────────────────────────────────────────────────────────
function _decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(+d); } catch { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ' '; } })
    .replace(/&amp;/g, '&');   // last, so &amp;lt; doesn't double-decode
}
function stripTags(xml) {
  return _decode(String(xml || '').replace(/<[^>]+>/g, ' ')).replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').trim();
}
function _clip(s) { return s.length > TEXT_CAP ? s.slice(0, TEXT_CAP) : s; }

// Which parts carry the words, per format.
function _partsFor(ext, names) {
  if (ext === '.docx') return names.filter(n => n === 'word/document.xml' || /^word\/(header|footer)\d*\.xml$/.test(n));
  if (ext === '.xlsx') return names.filter(n => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (ext === '.pptx') return names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n) || /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
  return [];
}

/** Extract searchable text from an OOXML buffer. Returns '' on anything unrecognised (never throws). */
function extractOoxml(buf, ext) {
  try {
    const z = _open(buf);
    if (!z) return '';
    const parts = _partsFor(String(ext || '').toLowerCase(), Object.keys(z.entries));
    const out = [];
    let total = 0;
    for (const n of parts.sort()) {
      const b = _readEntry(z, n);
      if (!b) continue;
      const t = stripTags(b.toString('utf8'));
      if (t) { out.push(t); total += t.length; if (total > TEXT_CAP) break; }
    }
    return _clip(out.join('\n'));
  } catch { return ''; }
}

// Additive exports of the ZIP primitives so the sibling grid reader (ooxmlGrid.js) reuses ONE
// central-directory reader instead of a second copy. Non-breaking (test_ooxml_text.js pins
// extractOoxml/stripTags only). `_decode` is the shared XML-entity decoder.
module.exports = { extractOoxml, stripTags, TEXT_CAP, PART_CAP, openZip: _open, readZipEntry: _readEntry, decodeXml: _decode };
