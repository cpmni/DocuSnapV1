'use strict';
/*
 * test_drawn_date_parse.js — Lever X (2026-08-20, reggie → Oracle SIGN OFF).
 * The drawn/teach date parser must EXTRACT a date from a longer captured line (trailing time,
 * ordinal, leading caption) — Attempt-1 whole-string first (byte-identical), then leftmost-valid
 * SEARCH. Evals the ACTUAL functions out of renderer.js (no re-typed copy → no drift).
 * Run: node src/windows/review/test_drawn_date_parse.js
 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
const start = src.indexOf('const _DRAWN_MONTHS');
const end = src.indexOf('let _regionDateOrder');
if (start < 0 || end < 0) { console.log('BAD could not locate the date-parse block'); process.exit(1); }
const parse = new Function(src.slice(start, end) + '\nreturn _parseDrawnDate;')();

let fails = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  console.log((ok ? 'OK  ' : 'BAD ') + label + `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
  if (!ok) fails++;
};

// dmy (default region order)
eq('owner: "12 June 2026 21:29" -> date, time dropped', parse('12 June 2026 21:29', 'dmy'), '12-06-2026');
eq('owner: "1st may 2026 14:32pm" -> ordinal + time', parse('1st may 2026 14:32pm', 'dmy'), '01-05-2026');
eq('Attempt-1 label trim "Invoice Date: 05/11/2026"', parse('Invoice Date: 05/11/2026', 'dmy'), '05-11-2026');
eq('Attempt-1 byte-identical "16/03/2026"', parse('16/03/2026', 'dmy'), '16-03-2026');
eq('ISO "2026-06-12"', parse('2026-06-12', 'dmy'), '12-06-2026');
eq('ISO + time "2026-06-12 14:30"', parse('2026-06-12 14:30', 'dmy'), '12-06-2026');
eq('MMM DD "June 30, 2026 3:00pm"', parse('June 30, 2026 3:00pm', 'dmy'), '30-06-2026');
eq('caption longer than trim "Sent: 12 June 2026"', parse('Sent: 12 June 2026', 'dmy'), '12-06-2026');
eq('two dates -> LEFTMOST "Invoice 12 June 2026 due 30 June 2026"', parse('Invoice 12 June 2026 due 30 June 2026', 'dmy'), '12-06-2026');
eq('ordinal long date "31st January 2026"', parse('31st January 2026', 'dmy'), '31-01-2026');
// region order still governs via the strict gate
eq('mdy order "03/04/2026" -> 04-03-2026', parse('03/04/2026', 'mdy'), '04-03-2026');

// MUST NOT locate (fail-safe -> null -> caller keeps raw)
eq('no 2-sep numeric "Order 12 06 for 2026 units" -> null', parse('Order 12 06 for 2026 units', 'dmy'), null);
eq('time colon only "Total 14:32 items 5" -> null', parse('Total 14:32 items 5', 'dmy'), null);
eq('no date "Sent from my iPhone" -> null', parse('Sent from my iPhone', 'dmy'), null);
// a right-CHOPPED date is Y's job, NOT X — strict gate needs a 4-digit year, so X leaves it null
eq('chopped year "31 June 202" -> null (Y territory)', parse('31 June 202', 'dmy'), null);

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
