'use strict';
/*
 * Tests for shared/valueLocate.js — finding a TYPED teach value in the page's word geometry so a
 * manual entry still teaches a POSITION instead of a frozen constant.
 *
 * The battery is written around the two halves of the 2026-08-10 census that motivated the feature:
 * the values ARE on the page (so the matcher must cope with how OCR splits them), and presence is
 * NOT correctness (so the module must return geometry and nothing that reads as a verdict).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/windows/shared/test_value_locate.js
 */
const assert = require('assert');

global.window = global;                       // the module publishes onto `window`
const { locateValueInWords } = require('./valueLocate.js');

const NAT_W = 1700, NAT_H = 2200;
let passed = 0;
const ok = (n) => { console.log(`  ok  ${n}`); passed++; };

// Words as the `ocr-page-words` IPC delivers them: text + box in IMAGE PIXELS.
// `row` is a y in page-normalised units; every word on a row shares it.
function W(text, xn, row, wn = 0.06, hn = 0.011) {
  return { t: text, b: [xn * NAT_W, row * NAT_H, wn * NAT_W, hn * NAT_H] };
}
const find = (v, words) => locateValueInWords(v, { words, natW: NAT_W, natH: NAT_H });

// ── 1. Single token, exact ───────────────────────────────────────────────────
{
  const words = [W('Invoice', 0.10, 0.20), W('GB651002784', 0.30, 0.20)];
  const hits = find('GB651002784', words);
  assert.strictEqual(hits.length, 1, 'one hit');
  assert.ok(hits[0].box.x <= 0.30 + 1e-6, 'box starts at the word');
  assert.ok(hits[0].box.w >= 0.06 - 1e-6, 'box spans the word');
  ok('single token located');
}

// ── 2. Multi-token run on one row ────────────────────────────────────────────
{
  const words = [W('Bramblewood', 0.10, 0.30, 0.11), W('Joinery', 0.22, 0.30, 0.07),
                 W('Ltd', 0.30, 0.30, 0.03), W('Unit', 0.60, 0.30, 0.04)];
  const hits = find('Bramblewood Joinery Ltd', words);
  assert.strictEqual(hits.length, 1, 'one hit');
  assert.ok(hits[0].wordCount === 3, 'three words consumed');
  assert.ok(hits[0].box.x <= 0.10 + 1e-6 && hits[0].box.x + hits[0].box.w >= 0.33 - 1e-6,
    'box spans the whole run');
  assert.ok(hits[0].box.x + hits[0].box.w < 0.60, 'the unrelated neighbour is NOT swallowed');
  ok('multi-token run located, neighbour excluded');
}

// ── 3. OCR split the value differently — the whitespace-free form matches ────
// The exhibit class: 'PI/26/6000' comes back as two word boxes.
{
  const words = [W('PI/26', 0.40, 0.25, 0.05), W('/6000', 0.46, 0.25, 0.05)];
  const hits = find('PI/26/6000', words);
  assert.strictEqual(hits.length, 1, 'split value still located');
  assert.strictEqual(hits[0].wordCount, 2, 'both fragments consumed');
  ok('value split across word boxes located');
}

// ── 4. Case and edge punctuation fold ────────────────────────────────────────
{
  const words = [W('ACME', 0.10, 0.40, 0.05), W('Supplies', 0.16, 0.40, 0.08), W('Ltd.', 0.25, 0.40, 0.04)];
  const hits = find('acme supplies ltd', words);
  assert.strictEqual(hits.length, 1, 'case + trailing period folded');
  ok('case and edge punctuation folded');
}

// ── 5. A value is never assembled ACROSS rows ────────────────────────────────
{
  const words = [W('Bramblewood', 0.10, 0.30, 0.11), W('Joinery', 0.10, 0.32, 0.07)];
  const hits = find('Bramblewood Joinery', words);
  assert.strictEqual(hits.length, 0, 'no cross-row run');
  ok('cross-row run refused');
}

// ── 6. CONTROL for 5 — the same words on ONE row DO match ───────────────────
// Without this, test 5 could pass because the matcher is broken rather than because the row test
// is working. Only the y coordinate differs between the two cases.
{
  const words = [W('Bramblewood', 0.10, 0.30, 0.11), W('Joinery', 0.22, 0.30, 0.07)];
  const hits = find('Bramblewood Joinery', words);
  assert.strictEqual(hits.length, 1, 'same words, same row, matches');
  ok('CONTROL: the row split is what refused case 5');
}

// ── 7. Printed twice → both offered, in reading order ───────────────────────
// The owner's own case: the issuer in the letterhead AND again in the footer. The caller shows the
// operator each one rather than silently picking, so both must come back and the order must be
// stable (top of page first).
{
  const words = [W('Pelican', 0.10, 0.05, 0.07), W('Interiors', 0.18, 0.05, 0.08),
                 W('Pelican', 0.10, 0.94, 0.07), W('Interiors', 0.18, 0.94, 0.08)];
  const hits = find('Pelican Interiors', words);
  assert.strictEqual(hits.length, 2, 'both occurrences returned');
  assert.ok(hits[0].box.y < hits[1].box.y, 'reading order: letterhead before footer');
  ok('two occurrences returned in reading order');
}

// ── 8. No fuzzy tier ─────────────────────────────────────────────────────────
// A near-miss must NOT locate. Putting the box on nearly-right words is worse than the
// position-less status quo, because the box is what every future document is read from.
{
  const words = [W('Acme', 0.10, 0.50, 0.05), W('Supplies', 0.16, 0.50, 0.08)];
  assert.strictEqual(find('Acme Supplied', words).length, 0, 'one-letter difference does not match');
  assert.strictEqual(find('Acme Supplies Ltd', words).length, 0, 'a longer target does not match');
  ok('near misses refused (no fuzzy tier)');
}

// ── 9. Degenerate inputs ─────────────────────────────────────────────────────
{
  const words = [W('A', 0.10, 0.60, 0.01)];
  assert.strictEqual(find('A', words).length, 0, 'a one-character value is not a position');
  assert.strictEqual(find('', words).length, 0, 'empty value');
  assert.strictEqual(find('Acme', []).length, 0, 'no words');
  assert.strictEqual(locateValueInWords('Acme', { words, natW: 0, natH: NAT_H }).length, 0, 'no frame');
  ok('degenerate inputs return no hits');
}

// ── 10. THE CENSUS CONDITION — a hit is geometry, never a verdict ───────────
// Two of the 17 "printed" fixed values are known to be WRONG (`vat_no = 'VAT'` matches the
// CAPTION). Locating one must therefore stay possible AND must not hand the caller anything that
// could be read as corroboration — no score, no confidence, no "verified" flag.
{
  const words = [W('VAT', 0.10, 0.70, 0.03), W('No:', 0.14, 0.70, 0.03)];
  const hits = find('VAT', words);
  assert.strictEqual(hits.length, 1, 'a caption-only value still locates (presence is not correctness)');
  assert.deepStrictEqual(Object.keys(hits[0]).sort(), ['box', 'text', 'wordCount'],
    'a hit carries geometry only — no score/confidence/verdict field');
  ok('CONDITION: a hit is evidence about WHERE, never about WHETHER');
}

// ── 11. Overlapping runs are not double-reported ─────────────────────────────
{
  const words = [W('X1', 0.10, 0.80, 0.02), W('X1', 0.13, 0.80, 0.02)];
  const hits = find('X1', words);
  assert.strictEqual(hits.length, 2, 'two distinct printings both reported');
  assert.notStrictEqual(hits[0].box.x, hits[1].box.x, 'distinct boxes');
  ok('repeated adjacent printings stay distinct');
}

// ── 12. WIRING — the module is reachable from the surface that needs it ──────
// A pure matcher that nothing calls is a dead guard whose unit tests all pass. These scan source
// rather than behaviour, because the wiring spans a renderer, a preload and a main-process handler
// and any one of the four links going missing turns the feature off silently.
{
  const fs = require('fs'), path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', p), 'utf8');
  const html = read('src/windows/teach/index.html');
  const rend = read('src/windows/teach/renderer.js');
  const pre  = read('src/preload.js');
  const hdl  = read('src/modules/processing/handler.js');
  const py   = read('python_backend/ocr/region.py');
  assert.ok(/valueLocate\.js/.test(html), 'the teach window loads valueLocate.js');
  assert.ok(/ValueLocate\.locateValueInWords/.test(rend), 'the teach wizard calls the matcher');
  assert.ok(/ocrPageWords/.test(rend) && /ocrPageWords/.test(pre), 'the page-words call is bridged');
  assert.ok(/'ocr-page-words'/.test(hdl), 'the main process registers the page-words handler');
  assert.ok(/--page-words|page_words/.test(py), 'region.py implements the page-words mode');
  // The fallback is the whole safety story: no hit must still store the typed value exactly as
  // before. If this disappears, a value that cannot be located is lost rather than kept.
  assert.ok(/saveAsFixed/.test(rend) && /status:'fixed'/.test(rend),
    'the typed-value fallback survives');
  // And the kill switch must still short-circuit BEFORE the search runs.
  assert.ok(/if\(!TYPED_LOCATE_ON\)\{\s*saveAsFixed/.test(rend),
    'teach_typed_value_locate=false restores the old path without an OCR round trip');
  ok('WIRING: renderer → preload → handler → region.py, with the fallback and kill switch intact');
}

// ── 13. Trailing-edge pad floor — and ONLY the trailing edge ─────────────────
// Mirrors the boxSnap.js pin: a single-line hit's height-scaled pad (~0.002) is thinner than
// sibling drift (0.003-0.005), so a flush stored right edge shears the final glyph on drifted
// siblings ('Ltd' reads 'Ltc'). Right edge floored at 0.004; left/vertical stay snug (a wider
// left pad re-absorbs label tails, a taller box admits the row below).
{
  const words = [W('Invoice', 0.10, 0.20), W('GB651002784', 0.30, 0.20)];
  const hits = find('GB651002784', words);
  assert.strictEqual(hits.length, 1, 'located');
  const b = hits[0].box;
  const rightPad = (b.x + b.w) - 0.36;      // word right edge = 0.30 + 0.06
  const leftPad  = 0.30 - b.x;
  const topPad   = 0.20 - b.y;
  assert.ok(rightPad > 0.004 - 1e-6, `trailing pad has the 0.004 floor (got ${rightPad.toFixed(4)})`);
  assert.ok(leftPad < 0.002, `left pad stays height-scaled snug (got ${leftPad.toFixed(4)})`);
  assert.ok(topPad < 0.002, `vertical pad stays height-scaled snug (got ${topPad.toFixed(4)})`);
  ok('trailing edge floored at 0.004; left/vertical snug (pinned asymmetry)');
}

console.log(`\n${passed} checks passed`);
