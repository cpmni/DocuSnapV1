'use strict';
/**
 * src/lib/test_file_kinds.js — pins the ONE shared file-extension policy (QuickFile+Departments, eric B.1).
 * The load-bearing invariant is OPEN_EXTS ∩ NEVER_OPEN = ∅ (an allowlisted ext can never also be a
 * never-open ext), plus: OCR_EXTS is byte-equal to the historical OCR list (collapsing the copies is
 * zero behaviour change), an executable/shortcut/macro-Office is never openable, and an office doc is
 * openable-but-not-renderable.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/lib/test_file_kinds.js   (plain node also fine)
 */
const fk = require('./fileKinds');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const eqSet = (s, arr) => s.size === arr.length && arr.every((e) => s.has(e));

console.log('§1 the load-bearing invariant');
check('OPEN_EXTS ∩ NEVER_OPEN = ∅', [...fk.OPEN_EXTS].every((e) => !fk.NEVER_OPEN.has(e)));

console.log('§2 OCR_EXTS byte-equal to the historical list (zero behaviour change on collapse)');
check('OCR_EXTS = pdf/png/jpg/jpeg/tiff/tif/bmp',
  eqSet(fk.OCR_EXTS, ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp']));
check('the prior ALLOWED_OPEN_EXTS (ocr + xml) is a SUBSET of the new OPEN_EXTS',
  ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.xml'].every((e) => fk.OPEN_EXTS.has(e)));

console.log('§3 normExt — filename, bare ext, leading-dot, double-ext');
check("normExt('Invoice.PDF') = .pdf", fk.normExt('Invoice.PDF') === '.pdf');
check("normExt('pdf') = .pdf", fk.normExt('pdf') === '.pdf');
check("normExt('.PDF') = .pdf", fk.normExt('.PDF') === '.pdf');
check("normExt('invoice.pdf.exe') = .exe (double ext)", fk.normExt('invoice.pdf.exe') === '.exe');
check("normExt('') = '' ", fk.normExt('') === '');

console.log('§4 classifiers');
check('isOcr(.pdf) / !isOcr(.docx)', fk.isOcr('.pdf') && !fk.isOcr('.docx'));
check('isIntake(.docx) / isIntake(.eml) / !isIntake(.exe)', fk.isIntake('a.docx') && fk.isIntake('m.eml') && !fk.isIntake('x.exe'));
check('isOpenable(.docx) true (office doc)', fk.isOpenable('report.docx'));
check('isOpenable(.pdf) / isOpenable(.xml sidecar)', fk.isOpenable('x.pdf') && fk.isOpenable('meta.xml'));
check('isOpenable(.exe/.lnk/.docm) FALSE (never-open)', !fk.isOpenable('x.exe') && !fk.isOpenable('x.lnk') && !fk.isOpenable('x.docm'));
check('isOpenable(invoice.pdf.exe) FALSE (double-ext resolves to .exe)', !fk.isOpenable('invoice.pdf.exe'));
check('isRenderable(.pdf/.png) true; office NOT renderable', fk.isRenderable('x.pdf') && fk.isRenderable('x.png') && !fk.isRenderable('x.docx') && !fk.isRenderable('x.txt'));
check('macro-enabled Office is never-open AND not intake', fk.isNeverOpen('x.docm') && !fk.isIntake('x.docm'));

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
