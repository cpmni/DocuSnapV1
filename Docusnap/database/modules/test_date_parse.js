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

console.log('§6 extractDate — pull the fileable date out of a noisy whole-line capture (2026-09-26)');
check("the BUG string 'February 1, 2027 (159 days remaining)' → 01-02-2027",
  dp.extractDate('February 1, 2027 (159 days remaining)') === '01-02-2027'
  && filing.extractDate('February 1, 2027 (159 days remaining)') === '01-02-2027');
check("'Due: 31/12/2026' → 31-12-2026",                 dp.extractDate('Due: 31/12/2026') === '31-12-2026');
check("'Expires 1 Jan 2027' → 01-01-2027",              dp.extractDate('Expires 1 Jan 2027') === '01-01-2027');
check("'Depletion date 15-08-2026 (est.)' → 15-08-2026", dp.extractDate('Depletion date 15-08-2026 (est.)') === '15-08-2026');
check("ISO within text 'Received 2026-08-15' → 15-08-2026", dp.extractDate('Received 2026-08-15') === '15-08-2026');
check("two forms of ONE day dedup → the single date",   dp.extractDate('Dated 01/02/2026 (01 Feb 2026)') === '01-02-2026');
// SILENT-MISFILE SAFETY — a true non-date / impossible date MUST return null so the guard still refuses
// (a future dev cannot broaden extractDate to swallow non-dates without turning these red):
check("'Unknown' → null",                               dp.extractDate('Unknown') === null);
check("'see attached' → null",                          dp.extractDate('see attached') === null);
check("'3.5.2' → null (no 4-digit year survives parseDate)", dp.extractDate('3.5.2') === null);
check("'1,234.56' → null (comma ∉ separator class)",    dp.extractDate('1,234.56') === null);
check("'ref 12-34-5678' → null (month 34 rolls over)",  dp.extractDate('ref 12-34-5678') === null);
check("'31/04/2026 xyz' → null (Apr has 30 days)",      dp.extractDate('31/04/2026 xyz') === null);
// AMBIGUITY — ≥2 DISTINCT dates → null. This feeds the FILING door, so it REFUSES and lets the human
// resolve; a wrong pick files silently to the wrong Year/Month folder. DELIBERATELY DIFFERENT from the
// Python review-bound salvage (_salvage_date_value picks CLOSEST-TO-TODAY, conf 80) AND the renderer
// draw-door (_parseDrawnDate picks LEFTMOST). DO NOT "align" the SELECTION policy — that re-opens a
// silent-misfile class at the filing door.
check("ambiguous 'Invoice 01/02/2026 due 05/03/2026' → null", dp.extractDate('Invoice 01/02/2026 due 05/03/2026') === null);
check("ambiguous '1/2/2026 3/4/2026' → null",           dp.extractDate('1/2/2026 3/4/2026') === null);
// FALLBACK PRECEDENCE — a clean whole-string date returns identical to normaliseDate (extractDate is a
// fallback the caller only reaches on a normaliseDate miss; the 99% path is byte-identical):
check("clean '15-12-2025' extractDate === normaliseDate", dp.extractDate('15-12-2025') === dp.normaliseDate('15-12-2025'));
// ReDoS belt — a long pathological repeat returns promptly (bounded, non-backtracking scan):
{ const t0 = Date.now(); const r = dp.extractDate('1/1/'.repeat(3000)); check('long repeat bounded + null', r === null && (Date.now() - t0) < 1000); }

console.log('§7 AUTO-FILE BOUNDARY — extractDate is NOT reachable from the auto-file gate (Oracle C4)');
// The CONFIRM gate (a human is present) rescues an annotated date; the AUTO-FILE gate (no human) must
// stay STRICT and hold it toward review. trust.validDate delegates to the anchored parseDate, never to
// extractDate; processing/handler.js holds on normaliseDate===null. Lock both so nobody wires extractDate in.
check("trust.validDate stays FALSE on the annotated form (auto-file gate strict)",
  trust.validDate('February 1, 2027 (159 days remaining)') === false);
check("normaliseDate stays null on the annotated form (the processing/handler date-hold stays armed)",
  dp.normaliseDate('February 1, 2027 (159 days remaining)') === null
  && filing.normaliseDate('February 1, 2027 (159 days remaining)') === null);

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
