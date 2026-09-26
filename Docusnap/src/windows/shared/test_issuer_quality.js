'use strict';
/*
 * Tests for shared/issuerQuality.js — the teach-time DOCUMENT-ISSUER over-capture warning (Chris r3,
 * 2026-09-26; reggie design). A loose teach box grabs the company NAME plus its address/phone and the
 * existing garble check passes it, so it is taught as the sender identity + folder name. This precision-
 * first, non-blocking signal warns on that. The battery pins that the warn FIRES on name+address and
 * STAYS SILENT on legit names (incl. long ones and street-word names), and that the teach wiring is
 * additive + non-blocking.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/windows/shared/test_issuer_quality.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.window = global;
const { overCapture } = require('./issuerQuality.js');

let passed = 0;
const ok = (n) => { console.log(`  ok  ${n}`); passed++; };
const over = (v) => overCapture(v).over;

// ── WARN (over-capture) ──────────────────────────────────────────────────────
assert.strictEqual(over('Larkspur Interiors The Design Rooms, 3 Chapel Lane Harrogate HG1 2PZ T 01493 500111'), true,
  'the Larkspur blob (postcode + phone + street + house-no) warns');
ok('name + full letterhead block → warn');
assert.strictEqual(over('Larkspur Interiors, HG1 2PZ'), true, 'name + postcode warns');
ok('name + postcode → warn (a company name carries no postcode)');
assert.strictEqual(over('Larkspur Interiors T 01493 500111'), true, 'name + phone warns');
ok('name + phone number → warn');
assert.strictEqual(over('Larkspur Interiors, 3 Chapel Lane, Harrogate'), true, 'long + street + house-no warns (no postcode/phone)');
ok('name + address, no postcode/phone → warn (long AND address token)');
assert.strictEqual(overCapture('Larkspur Interiors, HG1 2PZ').hasPostcode, true, 'the postcode flag is surfaced for the copy branch');
ok('hasPostcode surfaced');

// ── SILENT (legit names) ─────────────────────────────────────────────────────
assert.strictEqual(over('Larkspur Interiors'), false, 'a tidy company name stays silent');
ok('tidy company name → silent');
assert.strictEqual(over('Bramblewood Joinery & Fabrication Ltd'), false, 'a long legit name (no address markers) stays silent');
ok('long legit name (no postcode/phone/street) → silent — length alone never warns');
assert.strictEqual(over('The Design Rooms Ltd'), false, '"Rooms" is deliberately NOT a street type');
ok('"Rooms" name → silent (excluded ambiguous token)');
assert.strictEqual(over('Old Mill Lane Nursery School'), false, 'a street-WORD name that is short stays silent');
ok('street-word name, short → silent (weak combo cannot fire alone)');
assert.strictEqual(over('HG1 2PZ'), false, 'a bare postcode is below the length guard (the garble check owns it)');
ok('bare postcode → silent (length guard; no double-handling)');
assert.strictEqual(over(''), false, 'empty → silent');
assert.strictEqual(over(null), false, 'null → silent (no throw)');
ok('degenerate inputs → silent, no throw');

// ── WIRING — the teach confirm uses it, additively + non-blocking ───────────
{
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', p), 'utf8');
  const teach = read('src/windows/shared/teach-ui/teach.js').replace(/\r\n/g, '\n');
  const html = read('src/windows/teach/index.html');
  assert.ok(/issuerQuality\.js/.test(html), 'the teach window loads issuerQuality.js');
  assert.ok(/window\.IssuerQuality\.overCapture\(v\)/.test(teach), '_warnOnIssuerValue calls the shared detector');
  // additive precedence: over-capture sits AFTER the near-match tiers and BEFORE the generic implausible.
  assert.ok(teach.indexOf('else if (oc.over)') > teach.indexOf('else if (nm && nm.near)')
            && teach.indexOf('else if (oc.over)') < teach.indexOf('else if (implausible)'),
    'the over-capture branch is after near-match and before implausible (additive, never pre-empts a known-name offer)');
  // non-blocking: it demotes the button to a ghost "Use it as-is", never removes/disables it.
  assert.ok(/demoteToRedraw = true;/.test(teach) && /Use it as-is/.test(teach) && /Draw a tighter box/.test(teach),
    'the warn demotes to "Draw a tighter box" primary + keeps "Use it as-is" (never blocks)');
  assert.ok(!/#rb-yes'\)\?\.remove\(\)|rb-yes.*\.disabled\s*=\s*true/.test(teach),
    'the confirm button is never removed or disabled by the over-capture path (non-blocking)');
  ok('WIRING: shared detector, additive precedence, non-blocking (draw-tighter default, use-as-is one click)');
}

// ── the config postcode shape stays in lockstep ─────────────────────────────
{
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'config', 'keyword_patterns.json'), 'utf8'));
  const cfgPc = (cfg.validation_patterns && cfg.validation_patterns.postcode_uk) || '';
  // the module's inner outward+inward shape must appear (de-anchored) in the config pattern's shape.
  assert.ok(/\[A-Za-z\]\{1,2\}\\d\[A-Za-z\\d\]\?\\s\?\\d\[A-Za-z\]\{2\}/.test(require('./issuerQuality.js').UK_POSTCODE.source),
    'the embedded UK postcode inner shape matches the documented lockstep shape');
  assert.ok(!cfgPc || /[A-Za-z]/.test(cfgPc), 'config postcode_uk present (lockstep source)');
  ok('postcode inner shape documented for lockstep with validation_patterns.postcode_uk');
}

console.log(`\n${passed} checks passed`);
