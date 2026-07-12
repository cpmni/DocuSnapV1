/*
 * test_logo_source.js — the confirm-time supplier logo fingerprint (and the on-load logo match)
 * MUST come from the RAW page render, never from the on-screen docImg. When "Straighten" (display
 * deskew) or "OCR Preview" is active, docImg is a rotated/enhanced bitmap whose phash drifts
 * double-digit Hamming from the learned RAW fingerprints — fingerprinting it on confirm would INSERT
 * a drifted logo_fingerprints row that poisons anchor.try_logo_supplier_match for every future raw
 * import (Oracle C1, 2026-07-12; the door the Python raw_page0 guard does NOT cover).
 *
 * This is the test that would have gone RED on that leak — the earlier test_deskew_pages.py logo
 * check guards the Python persistence channel and could never fail on this renderer one.
 *
 * Run:  node src/windows/shared/test_logo_source.js
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const LogoSource = require('./logoSource.js');

let fails = 0;
function check(name, cond) { console.log((cond ? 'OK  ' : 'BAD ') + name); if (!cond) fails++; }

// ── the pure selector: always the RAW page payload, independent of the display ──────────────────
const RAW_PAYLOAD  = 'RAWpage0bytes==';
const DESK_PAYLOAD = 'DESKEWEDbytes==';               // what a straightened docImg→canvas would give
const pageImages   = [`data:image/png;base64,${RAW_PAYLOAD}`, 'data:image/png;base64,PAGE2=='];

check("selector returns the RAW page-0 payload (header stripped)",
      LogoSource.rawPageBase64(pageImages, 0) === RAW_PAYLOAD);
// The leak reproduction: the on-screen image is the DESKEWED payload, but the confirm-time logo
// source takes pageImages (not docImg), so it can never hand the deskewed bytes to the fingerprint.
check("logo source is NOT the deskewed on-screen payload (the leak stays shut)",
      LogoSource.rawPageBase64(pageImages, 0) !== DESK_PAYLOAD);
check("bare base64 (no data-URL header) passes through", LogoSource.rawPageBase64([RAW_PAYLOAD], 0) === RAW_PAYLOAD);
check("selector picks the requested page", LogoSource.rawPageBase64(pageImages, 1) === 'PAGE2==');
check("empty / missing page -> null (no throw)",
      LogoSource.rawPageBase64([], 0) === null && LogoSource.rawPageBase64(pageImages, 9) === null
      && LogoSource.rawPageBase64(null, 0) === null);

// ── wiring guard: renderer.js must fingerprint the logo from the RAW selector, never docImg ─────
const renderer = fs.readFileSync(path.join(__dirname, '..', 'review', 'renderer.js'), 'utf8');
check("renderer never CALLS a docImg→canvas logo capture (getPageBase64 removed)",
      !/getPageBase64\s*\(/.test(renderer));
check("confirm-time logo capture uses the RAW selector",
      /const\s+logoB64\s*=\s*getRawPageBase64\(/.test(renderer));
check("getRawPageBase64 delegates to the shared pure selector",
      /getRawPageBase64[\s\S]{0,80}LogoSource\.rawPageBase64\(pageImages/.test(renderer));

console.log();
console.log(fails ? `${fails} FAILED` : 'All logo-source checks passed');
process.exit(fails ? 1 : 0);
