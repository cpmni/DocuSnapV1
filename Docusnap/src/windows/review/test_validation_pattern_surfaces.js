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

console.log(fails ? `\n${fails} CHECK(S) FAILED\n` : '\nall validation-surface pins passed\n');
process.exit(fails ? 1 : 0);
