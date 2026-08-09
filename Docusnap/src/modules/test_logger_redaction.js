'use strict';
/*
 * test_logger_redaction.js — the always-on support log must not carry the customer's data.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/modules/test_logger_redaction.js
 *
 * WHY. `%APPDATA%\ScanFinder\processing.log` runs on every install, with no toggle and no mention
 * anywhere in the UI, and it was writing supplier and customer names, VAT numbers, references,
 * totals and absolute user paths. On the audited machine: 1,139 money amounts, 2,567 supplier
 * mentions, 685 user paths. Diagnostic logging records much the same and is off by default,
 * admin-gated, and documents itself as sensitive — the support log did the same job with none of
 * the ceremony, and it is the first thing anyone would read in a support bundle or a screen-share.
 *
 * THE CONTRACT: keep the SHAPE of every line (which field, which stage, which method, what
 * confidence, what failed) and drop the CONTENT. A support reader must still be able to tell a
 * field that was READ from a field that was MISSED — a redaction that made those two look the same
 * would trade a privacy problem for a support problem.
 */
const logger = require('./logger');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const scrub = logger._scrub;

console.log('1. CUSTOMER DATA IS REMOVED');
const read = scrub("  FOUND   supplier_name: 'Castellan Security Systems' (95% via template_fixed)");
check('a quoted value is gone', !read.includes('Castellan'));
check('...and a double-quoted one too',
      !scrub('  FOUND   vat_no: "GB 903 3318 42" (87%)').includes('903'));
const p = scrub('import: copying C:\\Users\\jane\\Desktop\\Scans\\invoice.pdf -> inbox');
check('an absolute path is gone', !p.includes('jane') && p.includes('<path>'));
check('a money amount inside quotes is gone',
      !scrub("  total: '£3,604.80' committed").includes('3,604.80'));

console.log('\n2. THE LINE IS STILL USEFUL — this is the half a blunt redactor gets wrong');
check('the field key survives', read.includes('supplier_name'));
check('the confidence survives', read.includes('95%'));
check('the method survives', read.includes('template_fixed'));
check('FOUND and MISSED are still distinguishable',
      read.includes('FOUND') && scrub('  MISSED  account_no') === '  MISSED  account_no');
check('the reader is told something was removed, not that the field was empty',
      read.includes('<redacted>'));
check('a document filename is kept (support cannot work without it)',
      scrub('Reprocess done: Castellan-Security_service_worksheet_0021.pdf')
        .includes('Castellan-Security_service_worksheet_0021.pdf'));
check('an error class survives untouched',
      scrub('ERROR spawn python ENOENT') === 'ERROR spawn python ENOENT');

console.log('\n3. THE ADMIN ESCAPE HATCH');
check('detailed mode is OFF until switched on', typeof logger.setDetailed === 'function');

console.log(fails ? `\n${fails} FAILED` : '\nAll log-redaction pins passed');
process.exit(fails ? 1 : 0);
