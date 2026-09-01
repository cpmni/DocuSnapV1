'use strict';
/**
 * test_normalise_date_predicate.js — the INVALID-DATE guard's predicate (Chris 2026-08-25 Card 1;
 * gary + Oracle WRONG-LAYER). reviewService.confirm and _autoFileDoc now REFUSE a present-but-
 * unparseable DATE-ROLE value instead of letting the folder builder silently substitute
 * "Unknown Year"/"Unknown Month". Both gate on filing.normaliseDate — the EXACT parser the folder
 * builder uses — so the guard has ZERO divergence from what actually produces Unknown.
 *
 * These pins lock the two-sided contract Oracle named:
 *   (a) every value that WOULD file to Unknown returns null (so the guard refuses it), and
 *   (b) every value the builder CAN render returns non-null (so the guard never false-blocks /
 *       dead-ends a legitimate date — the pin that stops a future dev swapping in a stricter
 *       predicate that drops _datePreclean and breaks OCR-spaced dates).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/filing/test_normalise_date_predicate.js
 */
const { normaliseDate } = require('./handler');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`  x ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

// (a) MUST refuse (null) — each of these files to Company/Unknown Year/Unknown Month on the
// unpatched code. Includes the literal Card-1 value "1/ 2026" and the fig-leaf values the LOOSE
// validation_patterns test (year \d{2,4}, substring, full-month) would have wrongly passed.
for (const bad of [
  '1/ 2026',            // the customer's exact clipped taught value
  '15/12/202',          // right-clipped year (3 digits) — loose \d{2,4} passes, builder can't
  '15/12/25',           // 2-digit year — loose passes, builder needs 4
  '2025/12/15',         // slash-ISO — renderer/loose accept, builder ISO is dash-only
  '12-2025',            // single separator (month/year only)
  '15-12',              // single separator (day/month only)
  'Date: 15/12/2025',   // label prefix — substring-valid, anchored parser refuses
  'whenever',           // free text
  'INV-2939',           // a reference misread into the date field
]) eq(`refuse "${bad}"`, normaliseDate(bad), null);

// (b) MUST still file (non-null → NOT refused) — the negative controls against over-tightening.
eq('accept 15/12/2025',                normaliseDate('15/12/2025'),      '15-12-2025');
eq('accept 3/8/2012',                  normaliseDate('3/8/2012'),        '03-08-2012');
eq('accept ISO 2012-08-03',            normaliseDate('2012-08-03'),      '03-08-2012');
eq('accept text month Aug 03 2012',    normaliseDate('Aug 03 2012'),     '03-08-2012');
// FULL month names must file (2026-09-01: teach read "July 28, 2026" was refused → Unknown Year/
// Month; the central parser now accepts every month form validator.py + the review renderer accept).
eq('accept full month "July 28, 2026"', normaliseDate('July 28, 2026'),  '28-07-2026');
eq('accept full month "15 August 2024"', normaliseDate('15 August 2024'), '15-08-2024');
eq('accept "3 September 2025"',          normaliseDate('3 September 2025'), '03-09-2025');
eq('accept OCR-split "1 5/12/2025"',   normaliseDate('1 5/12/2025'),     '15-12-2025');
eq('accept OCR-spaced "15 / 12 / 2025"', normaliseDate('15 / 12 / 2025'), '15-12-2025');

console.log(`\nnormaliseDate predicate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
