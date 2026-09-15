'use strict';
/**
 * test_date_parse.js — the shared date parser (database/modules/date_parse.js) + the DRIFT GUARD proving
 * trust.validDate delegates to it and filing.normaliseDate re-exports it byte-identically.
 *
 * Pins (2026-09-15, reggie+gary -> Oracle SIGN-OFF-W/COND):
 *  §1 accept vectors: date_parse.normaliseDate(in) === out; validDate(in) === true; filing.normaliseDate(in) === out.
 *  §2 refuse_js vectors: normaliseDate → null; validDate → false (both parsers agree with the confirm door).
 *  §3 DRIFT GUARD: for every vector, trust.validDate(v) === (date_parse.parseDate(v) != null) — the year-blind
 *     third copy that caused the owner's noise note can never come back.
 *  §4 the flipped classes (year now REQUIRED): 2-digit numeric, 3-digit clipped, non-leap 29-Feb, absent year.
 *  §5 filing.normaliseDate is the SAME function (re-export identity) — proves the extraction moved nothing and
 *     the internal commitDocument callers (parseDate/formatDate) resolve live bindings (Oracle cond 1).
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_date_parse.js
 */
const fs = require('fs');
const path = require('path');
const dp = require('./date_parse');
const trust = require('./trust');
const filing = require('../../src/modules/filing/handler');

const V = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'python_backend', 'tests', 'date_forms_vectors.json'), 'utf8'));
let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

console.log('§1 accept vectors — parse to the canonical DD-MM-YYYY; valid; filing agrees');
for (const { in: input, out } of V.accept) {
  check(`accept ${JSON.stringify(input)} → ${out}`,
    dp.normaliseDate(input) === out && trust.validDate(input) === true && filing.normaliseDate(input) === out);
}

console.log('§2 refuse_js vectors — confirm door rejects → gate rejects');
for (const input of V.refuse_js) {
  check(`refuse ${JSON.stringify(input)}`,
    dp.normaliseDate(input) === null && trust.validDate(input) === false && filing.normaliseDate(input) === null);
}

console.log('§3 DRIFT GUARD — validDate === (parseDate != null) for every vector');
{
  let drift = 0;
  for (const input of [...V.accept.map(a => a.in), ...V.refuse_js, '9/8/25', '29-02-2025', 'October 14, 202', '05-06-2026', '29-02-2024']) {
    if (trust.validDate(input) !== (dp.parseDate(input) != null)) { drift++; console.log(`    DRIFT: ${JSON.stringify(input)}`); }
  }
  check('trust.validDate never drifts from date_parse.parseDate', drift === 0);
}

console.log('§4 the flipped classes — year is now REQUIRED');
check("numeric 2-digit year '9/8/25' → invalid",        trust.validDate('9/8/25') === false);
check("numeric 2-digit year '14-10-20' → invalid",      trust.validDate('14-10-20') === false);
check("3-digit clipped year 'October 14, 202' → invalid", trust.validDate('October 14, 202') === false);
check("numeric 3-digit year '14-10-202' → invalid",     trust.validDate('14-10-202') === false);
check("non-leap 29-02-2025 → invalid",                  trust.validDate('29-02-2025') === false);
check("absent year 'October 14' → invalid",             trust.validDate('October 14') === false);
check("valid 4-digit 'October 14, 2026' → valid",       trust.validDate('October 14, 2026') === true);
check("valid month-name 2-digit '6 Aug 26' → valid",    trust.validDate('6 Aug 26') === true);
check("valid leap 29-02-2024 → valid",                  trust.validDate('29-02-2024') === true);

console.log('§5 re-export identity — filing.normaliseDate IS date_parse.normaliseDate');
check('filing.normaliseDate === date_parse.normaliseDate', filing.normaliseDate === dp.normaliseDate);

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
