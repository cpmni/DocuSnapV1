'use strict';
/*
 * test_ooxml_text.js — pins the dependency-free OOXML text extractor (QuickFile Q2). Builds real ZIP
 * containers (STORE via xlsxWriter._zip, and a hand-built DEFLATE zip) for docx/xlsx/pptx, and asserts
 * the text is recovered, tags stripped, entities decoded, both compression methods handled, and that
 * junk / unsupported input returns '' without throwing (fail-safe).
 *   node src/lib/test_ooxml_text.js
 */
const zlib = require('zlib');
const ooxml = require('./ooxmlText');
const { _zip, crc32 } = require('./xlsxWriter');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

// A DEFLATE (method 8) zip — mirrors xlsxWriter._zip's layout but compresses each entry, so the
// reader's inflate path is exercised (real Office files are deflated, not stored).
function zipDeflate(entries) {
  const DOS_TIME = 0, DOS_DATE = 0x0021;
  const chunks = [], central = []; let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const comp = zlib.deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10); c.writeUInt16LE(DOS_TIME, 12); c.writeUInt16LE(DOS_DATE, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([c, nameBuf]));
    offset += local.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

const B = (s) => Buffer.from(s, 'utf8');
const docxXml = (t) => `<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:body></w:document>`;
const sharedXml = (t) => `<sst><si><t>${t}</t></si><si><t>second cell</t></si></sst>`;
const slideXml = (t) => `<p:sld><p:cSld><p:spTree><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>`;

console.log('§1 docx — STORE and DEFLATE both recover the body text');
{
  const store = _zip([{ name: '[Content_Types].xml', data: B('<x/>') }, { name: 'word/document.xml', data: B(docxXml('Office lease agreement 2026')) }]);
  check('STORE docx: body text recovered', ooxml.extractOoxml(store, '.docx').includes('Office lease agreement 2026'));
  const defl = zipDeflate([{ name: 'word/document.xml', data: B(docxXml('Confidential supply contract')) }]);
  check('DEFLATE docx: body text recovered (inflate path)', ooxml.extractOoxml(defl, '.docx').includes('Confidential supply contract'));
  check('tags are gone (no <w:t> in the output)', !/<w:t>/.test(ooxml.extractOoxml(store, '.docx')));
}

console.log('§2 xlsx (sharedStrings) + pptx (slides)');
{
  const xlsx = _zip([{ name: 'xl/sharedStrings.xml', data: B(sharedXml('Quarterly revenue report')) },
                     { name: 'xl/worksheets/sheet1.xml', data: B('<worksheet/>') }]);
  const xt = ooxml.extractOoxml(xlsx, '.xlsx');
  check('xlsx: sharedStrings text recovered', xt.includes('Quarterly revenue report') && xt.includes('second cell'));
  const pptx = _zip([{ name: 'ppt/slides/slide1.xml', data: B(slideXml('Board meeting minutes')) }]);
  check('pptx: slide text recovered', ooxml.extractOoxml(pptx, '.pptx').includes('Board meeting minutes'));
}

console.log('§3 entities + whitespace + wrong-ext + junk (fail-safe)');
{
  const ent = _zip([{ name: 'word/document.xml', data: B(docxXml('Jones &amp; Partners &#163;500 &lt;final&gt;')) }]);
  const et = ooxml.extractOoxml(ent, '.docx');
  check('entities decoded (& £ < >)', et.includes('Jones & Partners') && et.includes('£500') && et.includes('<final>'));
  const store = _zip([{ name: 'word/document.xml', data: B(docxXml('hello')) }]);
  check('wrong ext (.xlsx over a docx zip) → no docx part matched → ""', ooxml.extractOoxml(store, '.xlsx') === '');
  check('junk buffer → "" (no throw)', ooxml.extractOoxml(Buffer.from('not a zip at all'), '.docx') === '');
  check('empty/By-non-buffer → "" (no throw)', ooxml.extractOoxml(null, '.docx') === '' && ooxml.extractOoxml(Buffer.alloc(0), '.docx') === '');
  check('stripTags collapses runs + spaces words across tags', ooxml.stripTags('<a>one</a><b>two</b>') === 'one two');
}

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
