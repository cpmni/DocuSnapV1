'use strict';
/*
 * Tests for shared/suggestTeach.js — the pure classifier behind the SUGGESTED-TEACH picker (Slice 1).
 *
 * It decides ONE thing from a field's candidate value(s) + the page words: none / unique / multiple,
 * which drives the three UI states (manual draw / single suggestion / picker). The battery is written
 * around the Oracle census finding: the whole measured ambiguity is SAME-VALUE-multiple-boxes
 * (Ironclad statements, Pelican repeat-ref), so a single [currentValue] must already produce the
 * `multiple` state on those layouts, and `unique` everywhere else.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/windows/shared/test_suggest_teach.js
 */
const assert = require('assert');

global.window = global;                       // both modules publish onto `window`
require('./valueLocate.js');                  // sets window.ValueLocate first
const { suggestTeachState, MAX_BOXES } = require('./suggestTeach.js');

const NAT_W = 1700, NAT_H = 2200;
let passed = 0;
const ok = (n) => { console.log(`  ok  ${n}`); passed++; };

function W(text, xn, row, wn = 0.06, hn = 0.011) {
  return { t: text, b: [xn * NAT_W, row * NAT_H, wn * NAT_W, hn * NAT_H] };
}
const state = (vals, words) => suggestTeachState(vals, { words, natW: NAT_W, natH: NAT_H });

// ── 1. Unique — the value sits in exactly one place ──────────────────────────
{
  const words = [W('Invoice', 0.10, 0.20), W('INV-34177', 0.30, 0.20)];
  const r = state(['INV-34177'], words);
  assert.strictEqual(r.state, 'unique', 'one location → unique');
  assert.strictEqual(r.boxes.length, 1, 'one box');
  assert.strictEqual(r.boxes[0].value, 'INV-34177', 'box tagged with the candidate value');
  ok('unique: one location');
}

// ── 2. Multiple — the SAME value printed twice (Pelican repeat-ref) ──────────
// The census's load-bearing case: no engine change, one value → two boxes → the picker.
{
  const words = [W('PI/25', 0.40, 0.10, 0.05), W('/5193', 0.46, 0.10, 0.05),
                 W('PI/25', 0.40, 0.60, 0.05), W('/5193', 0.46, 0.60, 0.05)];
  const r = state(['PI/25/5193'], words);
  assert.strictEqual(r.state, 'multiple', 'two locations of one value → multiple (the picker case)');
  assert.strictEqual(r.boxes.length, 2, 'two boxes');
  assert.ok(r.boxes[0].box.y < r.boxes[1].box.y, 'reading order preserved (top first)');
  ok('multiple: same value printed twice → picker');
}

// ── 3. Multiple — a statement lists the account ref several times ────────────
{
  const words = [W('ITH-0093', 0.30, 0.15), W('ITH-0093', 0.30, 0.45), W('ITH-0093', 0.30, 0.75)];
  const r = state(['ITH-0093'], words);
  assert.strictEqual(r.state, 'multiple', 'a statement ref recurs → multiple');
  assert.strictEqual(r.boxes.length, 3, 'all three occurrences offered');
  ok('multiple: statement ref recurs');
}

// ── 4. None — the value is not printed on this frame ────────────────────────
// The NOT-FOUND tail (real scans, OCR split/merge): the caller must fall back to a manual draw.
{
  const words = [W('Invoice', 0.10, 0.20), W('Total', 0.30, 0.20)];
  const r = state(['INV-99999'], words);
  assert.strictEqual(r.state, 'none', 'value absent → none (manual draw fallback)');
  assert.strictEqual(r.boxes.length, 0, 'no boxes');
  ok('none: value absent');
}

// ── 5. Cap — a value printed more than MAX_BOXES times is bounded ────────────
{
  const words = [];
  for (let k = 0; k < MAX_BOXES + 3; k++) words.push(W('REF-1', 0.30, 0.05 + k * 0.05));
  const r = state(['REF-1'], words);
  assert.strictEqual(r.state, 'multiple', 'still multiple');
  assert.strictEqual(r.boxes.length, MAX_BOXES, `capped at MAX_BOXES (${MAX_BOXES})`);
  ok('cap: bounded at MAX_BOXES');
}

// ── 6. Cross-value dedupe — the same physical box is never offered twice ─────
// Two candidate values that resolve to the SAME box (here: the identical value passed twice, the
// degenerate form) collapse to one pick. Guards the Slice-2 seam where two labels can name one value.
{
  const words = [W('DN-88213', 0.30, 0.20)];
  const r = state(['DN-88213', 'DN-88213'], words);
  assert.strictEqual(r.boxes.length, 1, 'the same box is not double-offered');
  assert.strictEqual(r.state, 'unique', 'one physical location → unique');
  ok('cross-value dedupe: one physical box, one pick');
}

// ── 7. Slice-1 input shape — a bare string and a one-element array agree ─────
{
  const words = [W('Order', 0.10, 0.30), W('SO-4412', 0.30, 0.30)];
  const a = state('SO-4412', words);
  const b = state(['SO-4412'], words);
  assert.strictEqual(a.state, 'unique', 'bare string accepted');
  assert.deepStrictEqual(a.boxes[0].box, b.boxes[0].box, 'bare string === one-element array');
  ok('input shape: bare string and one-element array agree');
}

// ── 8. Degenerate inputs → none, never a throw ──────────────────────────────
{
  assert.strictEqual(state([''], []).state, 'none', 'empty value + no words');
  assert.strictEqual(state([null], [W('X', 0.1, 0.2)]).state, 'none', 'null value ignored');
  assert.strictEqual(state([], [W('X', 0.1, 0.2)]).state, 'none', 'no candidates');
  assert.strictEqual(suggestTeachState(['X'], null).state, 'none', 'no opts');
  ok('degenerate inputs return none without throwing');
}

// ── 9. Geometry only — a box carries no verdict field ───────────────────────
// Inherit ValueLocate's census condition: a location is WHERE, never WHETHER. The reducer adds the
// candidate `value` (for the picker copy) but must not fabricate a score/confidence/verified flag.
{
  const words = [W('VAT', 0.10, 0.70, 0.03), W('No:', 0.14, 0.70, 0.03)];
  const r = state(['VAT'], words);
  assert.strictEqual(r.boxes.length, 1, 'a caption-only value still locates (presence is not correctness)');
  assert.deepStrictEqual(Object.keys(r.boxes[0]).sort(), ['box', 'text', 'value', 'wordCount'],
    'a candidate carries geometry + its source value only — no score/confidence/verdict');
  ok('CONDITION: a candidate is WHERE + which value, never WHETHER');
}

// ── 10. WIRING — the reducer is reached from the Review teach path, with the Oracle conditions ──
// A pure reducer nothing calls is a dead guard whose unit tests all pass. These scan renderer source
// (no jsdom) so a missing link — the switch gate, the frame back-transform, the verify, the position-
// only ceiling — turns the feature off or unsafe silently. Each maps to an Oracle condition (C1-C6).
{
  const fs = require('fs'), path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', p), 'utf8');
  const rend = read('src/windows/review/renderer.js');
  const html = read('src/windows/review/index.html');
  // load order — valueLocate BEFORE suggestTeach, both before renderer
  assert.ok(html.indexOf('shared/valueLocate.js') < html.indexOf('shared/suggestTeach.js')
            && html.indexOf('shared/suggestTeach.js') < html.indexOf('src="renderer.js"'),
    'index.html loads valueLocate → suggestTeach → renderer, in order');
  // the switch gate (byte-identical OFF) — enterZoneMode only suggests when the setting is on
  assert.ok(/window\.__suggestTeachOn = false;/.test(rend) && /getSetting\('suggested_teach_enabled'\)/.test(rend),
    'the setting is read into __suggestTeachOn, defaulting OFF');
  assert.ok(/if \(window\.__suggestTeachOn\) \{ try \{ suggestTeachBoxes\(/.test(rend),
    'enterZoneMode fires suggestTeachBoxes ONLY when the switch is on (OFF = byte-identical arm)');
  // manual-draw-wins race + doc/frame aborts
  assert.ok(/activeField !== fieldKey \|\| isDragging \|\| pendingAnchors\[fieldKey\]/.test(rend),
    'suggestTeachBoxes bails if the operator drew / a box is already staged (manual draw wins)');
  assert.ok(/currentDoc\?\.id !== openDocId \|\| currentPage !== openPage \|\| deskewPageAngle !== openAngle/.test(rend),
    'aborts on any doc / page / straighten change under the page-words await');
  // reconstruction is on the DISPLAY frame via the page-words IPC, classified by the reducer
  assert.ok(/window\.docusnap\.ocrPageWords/.test(rend) && /ocrPageWords/.test(read('src/preload.js')),
    'reconstruction spawns ocr-page-words (bridged)');
  assert.ok(/window\.SuggestTeach\.suggestTeachState\(\[value\]/.test(rend),
    'the field CURRENT value drives the reducer (Slice 1 — no engine candidate retention)');
  // C4 — the verify is a FRESH RAW crop OCR, not the cached display words
  assert.ok(/async function _verifySuggestedRaw/.test(rend) && /getRawPageBase64\(\)/.test(rend)
            && /window\.docusnap\.ocrRegion\(/.test(rend),
    'C4: the placement verify reads a fresh crop off the RAW page (getRawPageBase64 → ocrRegion)');
  assert.ok(/cropSq\.length <= valSq\.length \* 1\.6 \+ 4/.test(rend),
    'C4: the verify rejects a crop that reads far more than the value (a half-box offset fails)');
  assert.ok(/const ok = await _verifySuggestedRaw\(rawTL, value\);[^\n]*\n\s*if \(!ok\) return;/.test(rend),
    'C4: UNIQUE stages ONLY after the verify passes (fail toward the manual draw)');
  // C1 — the picker path back-transforms display → raw BEFORE the shared resolve overlay
  assert.ok(/function _suggestBoxDisplayToRaw/.test(rend)
            && /AnchorLabel\?\.deskewFinalizeAnchor\?\.\(\{ x_norm: cx, y_norm: cy \}, snap, live\)/.test(rend),
    'C1: display→raw back-transform reuses deskewFinalizeAnchor (drops on frame change = C3)');
  assert.ok(/const rawTL = _suggestBoxDisplayToRaw\(b\.box, snap\);\s*\n\s*if \(!rawTL\) return;[\s\S]*?openResolveOverlay\(fieldKey, cands/.test(rend),
    'C1: every picker candidate is back-transformed to raw before openResolveOverlay');
  // C5 — UNIQUE is position-only: it must NOT mutate the field value or clear the server flag
  const uniqBody = rend.slice(rend.indexOf('async function _suggestUnique'), rend.indexOf('function _suggestMultiple'));
  assert.ok(uniqBody && !/input\.value\s*=/.test(uniqBody) && !/validation_note\s*=\s*null/.test(uniqBody)
            && !/dispatchEvent/.test(uniqBody),
    'C5: the UNIQUE suggestion never writes the field value nor clears the server review flag');
  // C6 — stages through the IDENTICAL hand-draw writer (captureAnchorContext), never a louder one
  assert.ok(/const detected = await captureAnchorContext\(rect, fieldKey, value/.test(rend),
    'C6: UNIQUE stages via captureAnchorContext (the same pendingAnchors → saveFieldAnchor path a hand-draw uses)');
  ok('WIRING: switch-gated, frame-safe (C1/C3), verified (C4), position-only (C5), authority-equal (C6)');
}

console.log(`\n${passed} checks passed`);
