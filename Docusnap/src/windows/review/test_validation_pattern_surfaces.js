'use strict';
/*
 * test_validation_pattern_surfaces.js — the shared validation patterns must agree across the THREE
 * surfaces that consume them, for the two types where they demonstrably did not.
 *
 * THE DEFECT THIS PINS (reggie 2026-08-08, Oracle SIGN OFF, fixed the same day).
 *
 *   IBAN — `validation_patterns.iban` was `^[A-Za-z]{2}\d{2}[A-Za-z0-9]{11,30}$`, which rejects
 *   every IBAN as it is actually PRINTED, in four-character groups. The consequence was not a
 *   silent near-miss, it was two surfaces openly disagreeing about the same correct value:
 *   `database/modules/trust.js` strips whitespace before its mod-97 check and ACCEPTED
 *   "GB29 NWBK 6016 1331 9268 19", while the Review window's on-blur validator scored it 0%
 *   coverage and WARNED the operator that their correct IBAN was wrong.
 *
 *   IP ADDRESS — the IPv6 leg accepted a CLOCK TIME ("09:30:15") and rejected "fe80::1", the
 *   example the type's own tooltip prints. The clock time is the dangerous half: `ip_address` is in
 *   `anchor._PRECISE_VAL_TYPES`, so a >=95%-coverage match is graded TYPE-AUTHORITATIVE and skips
 *   the charset and learned-shape checks.
 *
 * SCOPE NOTE — an honest deviation from the letter of Oracle's condition, which asked for the IBAN
 * pinned "through the renderer's fieldWarning". `fieldValidationError` lives in review/renderer.js,
 * a browser-scoped file that touches the DOM at load, so it cannot be required under node. This
 * pin therefore does BOTH halves of the next best thing: it MIRRORS the renderer's rule (same
 * compile flags, same >=0.8 longest-match coverage metric) against the real config, AND statically
 * asserts that the renderer still implements that exact rule — so if the renderer's rule ever
 * changes, this mirror is flagged as stale instead of quietly testing a fiction.
 *
 *   node src/windows/review/test_validation_pattern_surfaces.js
 */
const fs = require('fs');
const path = require('path');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const cfg = require(path.join(__dirname, '..', '..', '..', 'config', 'keyword_patterns.json'));
const VP = cfg.validation_patterns;

// Mirror of ensureValidationPatterns (review/renderer.js): every key but currency_code compiles
// with the 'i' flag, matching Python's re.IGNORECASE.
const compile = (key) => (VP[key] || [])
  .map(p => { try { return new RegExp(p, key === 'currency_code' ? '' : 'i'); } catch { return null; } })
  .filter(Boolean);

// Mirror of fieldValidationError's non-date/currency branch: longest single match over the value,
// as a fraction of its length; >= 0.8 passes, anything less warns.
const coverage = (key, v) => {
  let best = 0;
  for (const re of compile(key)) {
    let m = null; try { m = String(v).match(re); } catch { m = null; }
    if (m && m[0]) best = Math.max(best, m[0].length / String(v).length);
  }
  return best;
};
const rendererWarns = (key, v) => coverage(key, v) < 0.8;

console.log('\nIBAN — a correctly-printed IBAN must not be warned about');
const SPACED = 'GB29 NWBK 6016 1331 9268 19';
check(`the renderer no longer warns on ${SPACED}`, rendererWarns('iban', SPACED) === false);
check('...at full coverage, not a lucky partial', coverage('iban', SPACED) === 1);
check('the compact form still passes', rendererWarns('iban', 'GB29NWBK60161331926819') === false);
check('a German spaced IBAN passes', rendererWarns('iban', 'DE89 3704 0044 0532 0130 00') === false);
check('a truncated IBAN is still warned about', rendererWarns('iban', 'GB29') === true);
check('a bare account body with no country/check digits is still warned about',
      rendererWarns('iban', 'NWBK60161331926819') === true);
check('a sort code is not mistaken for an IBAN', rendererWarns('iban', '60-16-13') === true);

console.log('\nIBAN — and the OTHER surface already accepted it, which is why this was a live bug');
{
  // trust.js strips whitespace before the mod-97 check, so it accepted the spaced form all along.
  // Reproduce that normalisation here to show the two surfaces now AGREE rather than merely both
  // being lenient. (mod-97 over the rearranged, digit-expanded string.)
  const norm = SPACED.replace(/\s+/g, '').toUpperCase();
  const re = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
  check('the whitespace-stripped form is what trust.js validates', re.test(norm));
  const moved = norm.slice(4) + norm.slice(0, 4);
  const expanded = moved.replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of expanded) rem = (rem * 10 + Number(ch)) % 97;
  check('...and it is a genuinely valid IBAN (mod-97 == 1), not a shape-only pass', rem === 1);
}

console.log('\nIP ADDRESS — a clock time must not read as an address');
// This one matters beyond a warning: ip_address is a PRECISE val type, so a high-coverage match is
// graded type-authoritative and skips downstream checks.
check('09:30:15 scores below the 0.8 authority bar', coverage('ip_address', '09:30:15') < 0.8);
check('...and would be warned about', rendererWarns('ip_address', '09:30:15') === true);
check('12:45:00 likewise', rendererWarns('ip_address', '12:45:00') === true);
check('fe80::1 — the example the UI itself prints — is accepted',
      rendererWarns('ip_address', 'fe80::1') === false);
check('a compressed IPv6 address is accepted',
      rendererWarns('ip_address', '2001:db8::8a2e:370:7334') === false);
check('a full IPv6 address is accepted',
      rendererWarns('ip_address', '2001:0db8:0000:0000:0000:8a2e:0370:7334') === false);
check('the IPv4 leg is untouched', rendererWarns('ip_address', '192.168.1.200') === false);

console.log('\nTHE MIRROR MUST NOT GO STALE — the renderer still implements the rule tested above');
{
  const r = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  check("renderer still compiles with 'i' for every key but currency_code",
        /const flags = key === 'currency_code' \? '' : 'i';/.test(r));
  check('renderer still uses the >= 0.8 longest-match coverage rule',
        /best = Math\.max\(best, m\[0\]\.length \/ v\.length\)/.test(r) && /best >= 0\.8/.test(r));
  check('renderer still sources the patterns from the shared config over IPC',
        /getValidationPatterns\(\)/.test(r));
  check('currency still takes the substring branch, not the coverage branch',
        /valKey === 'currency' \|\| valKey === 'currency_code'/.test(r));
  // Card A (Chris 2026-08-25 re-verify): the date field-note accepts whatever the folder builder can
  // actually file — the substring pattern OR the preclean parser (_parseDrawnDate) — so an OCR-spaced
  // "15 / 12 / 2025" no longer shows a spurious "Not a valid date" while the Confirm button files it.
  // Still a substring/parse branch, NOT the >=0.8 coverage rule.
  check('date note aligns with the preclean parser (Card A), not the coverage rule',
        /valKey === 'date'/.test(r) && /_parseDrawnDate\(v, _regionDateOrder \|\| 'dmy'\)/.test(r));
}

// ── 2026-09-14: the WIDE month-name date family (config `date_wide`; reggie design → Oracle) ──────────────────
// One rule on every surface: a day (optional ordinal), a month NAME (optional trailing dot, keyed on its first
// three letters), a 2- or 4-digit year, with optional whitespace and AT MOST ONE of , . / \ - between the tokens
// (none = OCR-glued). Numeric dates are NOT widened. The Python twin reads the same vectors.
{
  const V = require(path.join(__dirname, '..', '..', '..', 'python_backend', 'tests', 'date_forms_vectors.json'));
  const wide = (VP.date_wide || []).map(p => new RegExp(p, 'i'));
  check('config carries two `date_wide` patterns that compile under the renderer\'s flags', wide.length === 2);
  const hits = (s) => wide.some(re => re.test(s));
  for (const v of V.accept) check(`date_wide matches the accept vector ${JSON.stringify(v.in)} (substring, as the crop gate / badge use it)`, hits(v.in));
  for (const s of ['REF23AUG2026', '1,234.56', '12-34-5678', '23 Ma 2026', 'Aug 2026', 'Aug2026', '23,,Aug 26']) check(`date_wide refuses ${JSON.stringify(s)} (the alnum lookbehind fence / the single-separator rule / digits→digits never glued)`, !hits(s));
  check('date_wide tolerates a longer line around the date (substring — the badge, not the door)', hits('Sent: 23-Aug-26 14:30'));
  // The three JS readers carry the SAME month-name regex fragment as the canonical door, so the badge/wizard/drawn
  // reader can never disagree with what confirm files.
  const FRAG = '(?:st|nd|rd|th)?\\s*[,./\\\\-]?\\s*([A-Za-z]{3,9})\\.?\\s*[,./\\\\-]?\\s*(\\d{2}|\\d{4})$/i';
  for (const [label, rel] of [['database/modules/date_parse.js parseDate (the confirm door)', ['..', '..', '..', 'database', 'modules', 'date_parse.js']],
                              ['review/renderer.js _matchStrictDate (drawn dates)', ['renderer.js']],
                              ['teach-ui/teach.js _parsesAsDate (the wizard\'s date check)', ['..', 'shared', 'teach-ui', 'teach.js']]]) {
    const src = fs.readFileSync(path.join(__dirname, ...rel), 'utf8');
    check(`${label} carries the wide month-name day-first regex`, src.includes(FRAG));
    check(`${label} strips a leading day name`, /Mon\(\?:day\)\?\|Tue\(\?:sday\)\?/.test(src));
    check(`${label} pivots a 2-digit year at 69 (strptime %y twin)`, /y >= 69 \? 1900 : 2000/.test(src));
  }
  // Oracle C3 (2026-09-14): the MONTH-FIRST fragment is pinned LITERALLY too — its day→year separator is the one
  // place the rule must NOT allow "nothing" (digits→digits: "Aug 2026" would otherwise split into 20 + 26).
  const FRAG_MDY = '(?:(?:st|nd|rd|th)\\s*[,./\\\\-]?\\s*|\\s*[,./\\\\-]\\s*|\\s+)(\\d{2}|\\d{4})$/i';
  for (const [label, rel] of [['database/modules/date_parse.js parseDate', ['..', '..', '..', 'database', 'modules', 'date_parse.js']],
                              ['review/renderer.js _matchStrictDate', ['renderer.js']],
                              ['teach-ui/teach.js _parsesAsDate', ['..', 'shared', 'teach-ui', 'teach.js']]]) {
    const src = fs.readFileSync(path.join(__dirname, ...rel), 'utf8');
    check(`${label} carries the month-first fragment with the NON-EMPTY day→year separator (verbatim)`, src.includes(FRAG_MDY));
  }
  const rr = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8').replace(/\r\n/g, '\n');
  // Oracle C2: ONE helper widens the date list for BOTH renderer readers of the shared config — the on-blur badge
  // (compiled RegExps) and the Quick-check grid's _baValPats (raw strings) — so the two can never drift.
  check('review renderer defines the shared `_widenDatePatterns` helper exactly once',
        (rr.match(/\nfunction _widenDatePatterns\(pats\) \{/g) || []).length === 1);
  check('...ensureValidationPatterns (the badge / on-blur check) routes through it',
        /_widenDatePatterns\(validationPatterns\);/.test(rr));
  check('...and the Quick-check grid\'s _baValPats routes through the SAME helper',
        /_baValPats = _widenDatePatterns\(await window\.docusnap\.getValidationPatterns\(\)\);/.test(rr));
  check('no other reader concatenates date_wide by hand', (rr.match(/\.concat\(pats\.date_wide\)|\.concat\([A-Za-z_.]*date_wide\)/g) || []).length === 1);
  // The renderer functions are browser-scoped, but these particular ones are pure — lift them out of the source and
  // RUN them (the same "mirror that cannot go stale" idea as the coverage rule above, one step stronger).
  const vm = require('vm');
  const grab = (src, re, what) => { const m = src.match(re); if (!m) throw new Error(`could not lift ${what}`); return m[0]; };
  const lifted = [
    grab(rr, /\nconst _DRAWN_MONTHS = \{[^\n]*\};\n/, '_DRAWN_MONTHS'),
    grab(rr, /\nfunction _fmtDMY\([^)]*\) \{[^\n]*\}\n/, '_fmtDMY'),
    grab(rr, /\nfunction _realDMY\([^)]*\) \{[\s\S]*?\n\}\n/, '_realDMY'),
    grab(rr, /\nfunction _matchStrictDate\([^)]*\) \{[\s\S]*?\n\}\n/, '_matchStrictDate'),
    grab(rr, /\nfunction _widenDatePatterns\([^)]*\) \{[\s\S]*?\n\}\n/, '_widenDatePatterns'),
  ].join('\n');
  const R = vm.runInNewContext(lifted + '\n;({ _matchStrictDate, _widenDatePatterns })', {});
  const DAYNAME = /^(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s*,?\s*/i;   // _parseDrawnDate's Attempt-1 strip
  // Oracle C1: a drawn date the Review reader accepts must be a REAL calendar date (the door's `real` + strptime refuse a
  // rolled-over "31 Apr"); JS Date alone would have said 1 May.
  for (const s of ['31 Apr 2026', '31/04/2026', '2026-02-30', '29 Feb 2026', 'Feb 30, 2026', '30.02.2026', '00 Aug 2026', '0/08/2026'])
    check(`_matchStrictDate refuses the impossible ${JSON.stringify(s)} (calendar round-trip)`, R._matchStrictDate(s, 'dmy') === null);
  check('_matchStrictDate keeps a real leap day (29 Feb 2024)', R._matchStrictDate('29 Feb 2024', 'dmy') === '29-02-2024');
  check('_matchStrictDate keeps 31/03/2026', R._matchStrictDate('31/03/2026', 'dmy') === '31-03-2026');
  for (const v of V.accept) check(`_matchStrictDate reads ${JSON.stringify(v.in)} → ${v.out} (the door's answer)`, R._matchStrictDate(v.in.replace(DAYNAME, ''), 'dmy') === v.out);
  for (const s of V.refuse_js.filter(x => !/^Date: |14:30$/.test(x)))   // Attempt 2's search / Attempt 1's label trim handle those two, not the strict gate
    check(`_matchStrictDate refuses ${JSON.stringify(s)} (whole-string, as the door does)`, R._matchStrictDate(s, 'dmy') === null);
  check('_matchStrictDate has no return that bypasses the round-trip', !/_fmtDMY\(/.test(grab(rr, /\nfunction _matchStrictDate\([^)]*\) \{[\s\S]*?\n\}\n/, '')));
  // Oracle C2, run for real: the Quick-check grid's date rule (_baDateOk = any raw `date` pattern matches, 'i') over the
  // widened RAW config accepts every vector the door files.
  const baPats = R._widenDatePatterns(JSON.parse(JSON.stringify(VP)));
  const baDateOk = (v) => (baPats.date || []).some(p => { try { return new RegExp(p, 'i').test(v); } catch { return false; } });
  check('the widened raw config carries the date_wide patterns inside `date`', baPats.date.length === (VP.date || []).length + VP.date_wide.length);
  check('...and does not touch the other keys', JSON.stringify(baPats.iban) === JSON.stringify(VP.iban) && JSON.stringify(baPats.date_wide) === JSON.stringify(VP.date_wide));
  for (const v of V.accept) check(`Quick-check grid date rule accepts ${JSON.stringify(v.in)}`, baDateOk(v.in));
  check('Quick-check grid still warns on a non-date', !baDateOk('INV-2939') && !baDateOk('whenever'));
  check('_widenDatePatterns is a no-op on a config with no date_wide', JSON.stringify(R._widenDatePatterns({ date: ['x'] })) === JSON.stringify({ date: ['x'] }));
  check('_widenDatePatterns survives a null (the grid\'s catch path)', R._widenDatePatterns(null) === null);
  // The Teach wizard's date check is likewise pure — lift it and run it against the same vectors.
  const tr = fs.readFileSync(path.join(__dirname, '..', 'shared', 'teach-ui', 'teach.js'), 'utf8').replace(/\r\n/g, '\n');
  const T = vm.runInNewContext(grab(tr, /\nfunction _parsesAsDate\([^)]*\)\{[\s\S]*?\n\}\n/, '_parsesAsDate') + '\n;({ _parsesAsDate })', {});
  for (const v of V.accept) check(`teach _parsesAsDate accepts ${JSON.stringify(v.in)}`, T._parsesAsDate(v.in) === true);
  for (const s of ['31 Apr 2026', '31/04/2026', '2026-02-30', '29 Feb 2026', 'Aug 2026', 'Aug2026', '23 Ma 2026', '3.5.2', '1,234.56', 'INV-2939', '23 Aug 202'])
    check(`teach _parsesAsDate refuses ${JSON.stringify(s)}`, T._parsesAsDate(s) === false);
  check('teach _parsesAsDate still takes either numeric order (the wizard is region-blind)', T._parsesAsDate('08/23/2026') === true && T._parsesAsDate('23/08/2026') === true);
  const py = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'python_backend', 'extraction', 'validator.py'), 'utf8');
  check('the Python twin uses the same separator rule (\\s*[,./\\\\-]?\\s*) behind its DATE_FORMS_WIDE switch', py.includes("_WIDE_SEP = r'\\s*[,./\\\\-]?\\s*'") && py.includes("if DATE_FORMS_WIDE:"));
  check('the Python twin keeps the digits→digits separator NON-EMPTY (twin of FRAG_MDY)', py.includes("_WIDE_SEP_D2D = r'(?:\\s*[,./\\\\-]\\s*|\\s+)'"));

  // ── EMBEDDED-DATE EXTRACTION (2026-09-26, Oracle C1-C3): the FINDER regexes are twin-aligned across
  // date_parse.js extractDate, the renderer draw-door (Lever X) and the teach coherence check; the
  // SELECTION policy is deliberately NOT aligned (extractDate refuses ≥2, the door picks). ──────────
  const dpSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'database', 'modules', 'date_parse.js'), 'utf8');
  const NUM_FINDER = '/\\d{1,4}\\s*[/.\\-]\\s*\\d{1,2}\\s*[/.\\-]\\s*\\d{1,4}/g';
  check('date_parse.js extractDate carries the numeric finder (twin)', dpSrc.includes(NUM_FINDER));
  check('renderer Lever-X carries the SAME numeric finder', rr.includes(NUM_FINDER));
  check('teach coherence check carries the SAME numeric finder', tr.includes(NUM_FINDER));
  check('date_parse.js exports extractDate + extractDateDetail', /extractDate,\s*extractDateDetail\s*\}/.test(dpSrc));
  // extractDate is pure + node-requireable — assert the refuse-on-ambiguity SELECTION here too (the
  // one thing a future dev must not "align" with the picking doors):
  const DP = require(path.join(__dirname, '..', '..', '..', 'database', 'modules', 'date_parse.js'));
  check('extractDate rescues the bug string → 01-02-2027', DP.extractDate('February 1, 2027 (159 days remaining)') === '01-02-2027');
  check('extractDate REFUSES ≥2 distinct (feeds the filing door — must not pick)', DP.extractDate('Invoice 01/02/2026 due 05/03/2026') === null);
  // teach surface (C3): the coherence warn no longer nags a whole-line capture that WILL file, and the
  // date-field prompt reassures the operator it is safe to include the whole line.
  check('teach _dateCoherenceWarn gates the isDate warn on _embeddedDateReads (no false "not a date")',
        /isDate && !reads && !_embeddedDateReads\(value\)/.test(tr));
  check('teach date-field prompt reassures a whole-line capture is safe',
        /you can include the whole line[\s\S]{0,80}pick out the date/.test(tr));
}

console.log(fails ? `\n${fails} CHECK(S) FAILED\n` : '\nall validation-surface pins passed\n');
process.exit(fails ? 1 : 0);
