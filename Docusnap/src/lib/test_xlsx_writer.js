'use strict';
/**
 * test_xlsx_writer.js
 * Golden-file pin for the dependency-free .xlsx writer (src/lib/xlsxWriter.js).
 * Unzips the produced workbook with a self-contained STORE reader, verifies the
 * CRC-32 of every entry, and asserts the OOXML parts + that values survive as
 * TEXT (leading zeros, long digit strings, XML-special chars, unicode).
 *
 * IMPORTANT: this is a NODE-level pin. Node's ZIP/XML parsing is MORE LENIENT
 * than Excel's OOXML reader — a green run here does NOT certify that Excel opens
 * the file. Verify an Excel-open once by hand (see the 2026-08-27 night handover).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron src/lib/test_xlsx_writer.js
 * (pure JS — plain `node src/lib/test_xlsx_writer.js` also works.)
 */
const X = require('./xlsxWriter');

let FAILS = 0;
const check = (label, cond) => { if (!cond) FAILS++; console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); };

// Minimal STORE-zip reader: walk the central directory, verify each CRC, return {name:text}.
function readZip(buf) {
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) throw new Error('no EOCD');
  const nEnt = buf.readUInt16LE(i + 10);
  let cd = buf.readUInt32LE(i + 16);
  const out = {};
  for (let e = 0; e < nEnt; e++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('bad central-dir signature');
    const method = buf.readUInt16LE(cd + 10);
    const crc = buf.readUInt32LE(cd + 16);
    const csize = buf.readUInt32LE(cd + 20);
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 30);
    const cmtLen = buf.readUInt16LE(cd + 32);
    const lho = buf.readUInt32LE(cd + 42);
    const name = buf.toString('utf8', cd + 46, cd + 46 + nameLen);
    const lnameLen = buf.readUInt16LE(lho + 26);
    const lextraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lnameLen + lextraLen;
    const data = buf.slice(dataStart, dataStart + csize);
    if (method !== 0) throw new Error('entry not STORE: ' + name);
    if (X.crc32(data) !== crc) throw new Error('CRC mismatch: ' + name);
    out[name] = data.toString('utf8');
    cd += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

console.log('buildXlsx → valid STORE zip:');
const cols = [{ key: 'ref', label: 'Reference' }, { key: 'code', label: 'Code & <x>' }];
const rows = [
  { ref: '007123', code: '1234567890123456' },
  { ref: 'A"B\'C', code: 'café — residual' },
];
const buf = X.buildXlsx(cols, rows, 'My/Sheet:Name*ok');
check('returns a Buffer', Buffer.isBuffer(buf));
check('starts with PK local-file signature', buf.readUInt32LE(0) === 0x04034b50);

let parts;
try { parts = readZip(buf); check('unzips + every CRC verifies', true); }
catch (e) { check('unzips + every CRC verifies (' + e.message + ')', false); parts = {}; }

check('has [Content_Types].xml', !!parts['[Content_Types].xml']);
check('has _rels/.rels', !!parts['_rels/.rels']);
check('has xl/workbook.xml', !!parts['xl/workbook.xml']);
check('has xl/_rels/workbook.xml.rels', !!parts['xl/_rels/workbook.xml.rels']);
check('has xl/worksheets/sheet1.xml', !!parts['xl/worksheets/sheet1.xml']);

const sheet = parts['xl/worksheets/sheet1.xml'] || '';
console.log('values survive as TEXT (the whole point):');
check('leading-zero ref "007123" verbatim', sheet.includes('>007123<'));
check('16-digit number NOT scientific', sheet.includes('>1234567890123456<'));
check('every cell is inlineStr (6 = 2 cols × 3 rows)', (sheet.match(/t="inlineStr"/g) || []).length === 6);
console.log('XML escaping + unicode:');
check('& < > escaped in header', sheet.includes('Code &amp; &lt;x&gt;'));
check('double-quote escaped', sheet.includes('A&quot;B'));
check('apostrophe escaped', sheet.includes('B&apos;C'));
check('unicode round-trips (café, em dash)', sheet.includes('café — residual'));
console.log('workbook wiring + sheet-name sanitising:');
check('sheet name stripped of []:*?/\\', (parts['xl/workbook.xml'] || '').includes('name="My Sheet Name ok"'));

console.log('column letters:');
check('A/Z/AA/AB/AZ/BA', ['A', 'Z', 'AA', 'AB', 'AZ', 'BA'].every((v, k) => X.colLetter([0, 25, 26, 27, 51, 52][k]) === v));

console.log('deterministic (fixed 1980 timestamp → byte-identical):');
check('same input → identical bytes', X.buildXlsx(cols, rows, 'My/Sheet:Name*ok').equals(buf));

console.log(FAILS ? `\n${FAILS} FAILED` : '\nALL PASS');
process.exit(FAILS ? 1 : 0);
