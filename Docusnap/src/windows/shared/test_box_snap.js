'use strict';
/*
 * Tests for shared/boxSnap.js — the drawn-box word-snap shared by the teach wizard and the
 * Template Manager.
 *
 * This battery exists because the algorithm was EXTRACTED from teach/renderer.js (2026-08-10),
 * where it had been live and default-ON since 2026-08-04 with no unit coverage of its own. A
 * refactor of live behaviour needs its guards pinned, not just its happy path — every one of them
 * fails CLOSED to the human's drawn box, and a guard that silently stopped failing closed would
 * let a snap swallow the neighbouring column.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/windows/shared/test_box_snap.js
 */
const assert = require('assert');

global.window = global;                       // the module publishes onto `window`
const { snapBoxToWords } = require('./boxSnap.js');

const NAT_W = 1700, NAT_H = 2200;
let passed = 0;
const ok = (n) => { console.log(`  ok  ${n}`); passed++; };

// A harness that behaves like the real crop+OCR pair: cropB64 records the band the algorithm
// asked for, and ocrRegionBoxes returns the page-level words that fall inside it, expressed in
// CROP PIXELS — exactly the frame region.py returns and the module has to convert back.
function harness(pageWords) {
  let band = null;
  return {
    natW: NAT_W, natH: NAT_H,
    cropB64: async (b) => { band = b; return 'fake-b64'; },
    ocrRegionBoxes: async () => ({
      words: pageWords
        .filter((w) => w.x + w.w > band.x && w.x < band.x + band.w
                    && w.y + w.h > band.y && w.y < band.y + band.h)
        .map((w) => ({
          text: w.text,
          box: [(w.x - band.x) * NAT_W, (w.y - band.y) * NAT_H, w.w * NAT_W, w.h * NAT_H],
        })),
    }),
    getBand: () => band,
  };
}

(async () => {
  // ── 1. Finishes a nicked word ──────────────────────────────────────────────
  // The drawn box clips 'Studio' halfway; the snap must return the WHOLE word.
  {
    const words = [{ text: 'Studio', x: 0.300, y: 0.500, w: 0.080, h: 0.012 }];
    const h = harness(words);
    const drawn = { x: 0.300, y: 0.501, w: 0.040, h: 0.010 };   // covers only the left half
    const res = await snapBoxToWords(drawn, h);
    assert.ok(res, 'a touched word snaps');
    assert.ok(res.box.w > drawn.w, 'snapped box is wider than the clipping draw');
    assert.ok(res.box.x <= 0.300 + 1e-6 && res.box.x + res.box.w >= 0.380 - 1e-6,
      'snapped box spans the whole word');
    assert.strictEqual(res.text, 'Studio');
    ok('finishes a nicked word and returns its text');
  }

  // ── 2. NEVER reaches out to an untouched token (the core invariant) ────────
  {
    const words = [
      { text: 'INV-001',  x: 0.300, y: 0.500, w: 0.060, h: 0.012 },
      { text: '£1,234.00', x: 0.560, y: 0.500, w: 0.080, h: 0.012 },   // next column, untouched
    ];
    const h = harness(words);
    const drawn = { x: 0.305, y: 0.501, w: 0.050, h: 0.010 };
    const res = await snapBoxToWords(drawn, h);
    assert.ok(res, 'snapped');
    assert.strictEqual(res.text, 'INV-001', 'the neighbouring column is NOT absorbed');
    assert.ok(res.box.x + res.box.w < 0.560, 'snapped box stops before the next column');
    ok('never reaches out to a token the drawn box did not touch');
  }
  // ...and the band DOES see that neighbour, so exclusion is the admission test doing its job,
  // not the band being too small to notice — otherwise this test would pass for the wrong reason.
  {
    const words = [
      { text: 'INV-001',  x: 0.300, y: 0.500, w: 0.060, h: 0.012 },
      { text: 'NEIGHBOUR', x: 0.368, y: 0.500, w: 0.030, h: 0.012 },
    ];
    const h = harness(words);
    await snapBoxToWords({ x: 0.305, y: 0.501, w: 0.050, h: 0.010 }, h);
    const band = h.getBand();
    assert.ok(band.x + band.w > 0.368, 'the re-read band genuinely includes the neighbour');
    ok('the exclusion is the admission test, not a too-small band');
  }

  // ── 3. Left-label cut ──────────────────────────────────────────────────────
  {
    const words = [
      { text: 'Invoice',  x: 0.240, y: 0.500, w: 0.050, h: 0.012 },   // the label tail
      { text: 'INV-001',  x: 0.300, y: 0.500, w: 0.060, h: 0.012 },
    ];
    const h = harness(words);
    const drawn = { x: 0.285, y: 0.501, w: 0.080, h: 0.010 };          // brushes the label
    const loose = await snapBoxToWords(drawn, h);
    assert.strictEqual(loose.text, 'Invoice INV-001', 'without the cut the label tail is absorbed');
    const cut = await snapBoxToWords(drawn, { ...h, labelRightEdge: 0.290 });
    assert.strictEqual(cut.text, 'INV-001', 'the cut drops the label tail');
    assert.ok(cut.box.x >= 0.290, 'snapped box starts right of the label');
    ok('labelRightEdge drops a brushed label tail');
  }

  // ── 4. Multi-row draw keeps the drawn box (single-row scope) ───────────────
  {
    const words = [
      { text: 'Unit',      x: 0.30, y: 0.500, w: 0.040, h: 0.012 },
      { text: 'Sawpit',    x: 0.30, y: 0.520, w: 0.050, h: 0.012 },   // a second row
      { text: 'Draymarket', x: 0.30, y: 0.540, w: 0.070, h: 0.012 },
    ];
    const h = harness(words);
    const res = await snapBoxToWords({ x: 0.295, y: 0.498, w: 0.090, h: 0.055 }, h);
    assert.strictEqual(res, null, 'an address block is left alone');
    ok('a multi-row draw returns null (keeps the drawn box)');
  }

  // ── 5. Over-grab cap ───────────────────────────────────────────────────────
  {
    const words = [{ text: 'VERYWIDEHEADING', x: 0.10, y: 0.500, w: 0.700, h: 0.020 }];
    const h = harness(words);
    // A tiny draw touching a huge word would quadruple the area — that is a mistake, not a fix.
    const res = await snapBoxToWords({ x: 0.40, y: 0.505, w: 0.010, h: 0.008 }, h);
    assert.strictEqual(res, null, 'a >4x area grab is refused');
    ok('the over-grab cap refuses a runaway snap');
  }

  // ── 6/7. Nothing to snap to, and bad wiring ────────────────────────────────
  {
    assert.strictEqual(await snapBoxToWords({ x: .3, y: .5, w: .05, h: .01 }, harness([])), null,
      'no words ⇒ null');
    const far = harness([{ text: 'ELSEWHERE', x: 0.05, y: 0.05, w: 0.05, h: 0.012 }]);
    assert.strictEqual(await snapBoxToWords({ x: .6, y: .8, w: .05, h: .01 }, far), null,
      'no ADMITTED words ⇒ null');
    ok('no words / no admitted words ⇒ keep the drawn box');
  }
  {
    const h = harness([{ text: 'x', x: .3, y: .5, w: .05, h: .012 }]);
    const box = { x: .3, y: .5, w: .05, h: .01 };
    assert.strictEqual(await snapBoxToWords(null, h), null, 'no box');
    assert.strictEqual(await snapBoxToWords(box, { ...h, natW: 0 }), null, 'no natural width');
    assert.strictEqual(await snapBoxToWords(box, { ...h, cropB64: null }), null, 'no cropper');
    assert.strictEqual(await snapBoxToWords(box, { ...h, ocrRegionBoxes: null }), null, 'no OCR');
    assert.strictEqual(await snapBoxToWords(box, {
      ...h, cropB64: async () => { throw new Error('boom'); },
    }), null, 'a throwing crop is swallowed, not propagated');
    ok('missing/broken wiring fails closed to the drawn box');
  }

  // ── 8. Word order is left-to-right regardless of OCR order ─────────────────
  {
    const words = [
      { text: 'World', x: 0.360, y: 0.500, w: 0.040, h: 0.012 },
      { text: 'Hello', x: 0.300, y: 0.500, w: 0.050, h: 0.012 },
    ];
    const h = harness(words);
    const res = await snapBoxToWords({ x: 0.295, y: 0.501, w: 0.110, h: 0.010 }, h);
    assert.strictEqual(res.text, 'Hello World', 'text is assembled left-to-right');
    ok('assembled text is ordered by x, not by OCR order');
  }

  // ── 8b. Trailing-edge pad floor — and ONLY the trailing edge ───────────────
  // A single-line box's height-scaled pad (~0.002) is thinner than sibling drift (0.003-0.005),
  // so a flush right edge shears the final glyph on drifted siblings ('Ltd' reads 'Ltc'). The
  // RIGHT edge gets a flat 0.004 floor. The asymmetry is deliberate and load-bearing: the left
  // edge stays snug (a wider left pad re-absorbs label tails) and the vertical pads stay snug
  // (a taller box admits the row below — the Pelican 2.2-line-height exhibit). A future
  // "simplification" back to a uniform pad re-mints the flush-edge class.
  {
    const words = [{ text: 'Ltd', x: 0.300, y: 0.500, w: 0.030, h: 0.012 }];
    const h = harness(words);
    const drawn = { x: 0.299, y: 0.501, w: 0.033, h: 0.010 };   // single-line: pad = h*0.15 ≈ 0.0015
    const res = await snapBoxToWords(drawn, h);
    assert.ok(res, 'snapped');
    const rightPad = (res.box.x + res.box.w) - 0.330;           // word right edge = 0.330
    const leftPad  = 0.300 - res.box.x;
    const topPad   = 0.500 - res.box.y;
    assert.ok(rightPad > 0.004 - 1e-6, `trailing pad has the 0.004 floor (got ${rightPad.toFixed(4)})`);
    assert.ok(leftPad < 0.002, `left pad stays height-scaled snug (got ${leftPad.toFixed(4)})`);
    assert.ok(topPad < 0.002, `vertical pad stays height-scaled snug (got ${topPad.toFixed(4)})`);
    ok('trailing edge floored at 0.004; left/vertical stay snug (pinned asymmetry)');
  }

  // ── 9. ONE implementation — a second copy must not regrow ──────────────────
  // The whole point of extracting this was that teach and the Template Manager stop drifting.
  // A future edit that re-inlines the maths in either renderer would pass every test above while
  // recreating exactly the problem this solved, so the source is checked directly.
  {
    const fs = require('fs'), path = require('path');
    const here = __dirname;
    const read = (p) => fs.readFileSync(path.join(here, '..', p), 'utf8');
    const teachJs = read('teach/renderer.js');
    const setJs   = read('settings/renderer.js');
    const teachHtml = read('teach/index.html');
    const setHtml   = read('settings/index.html');

    for (const [name, html] of [['teach', teachHtml], ['settings', setHtml]]) {
      assert.ok(/shared\/boxSnap\.js/.test(html), `${name}/index.html loads shared/boxSnap.js`);
    }
    assert.ok(/BoxSnap\.snapBoxToWords/.test(teachJs), 'teach delegates to the shared snap');
    assert.ok(/BoxSnap\.snapBoxToWords/.test(setJs),   'the Template Manager uses the shared snap');
    // The admission test is the algorithm's fingerprint — if this string appears in a renderer,
    // someone has pasted the maths back in.
    const ADMISSION = /touches the DRAWN box|Math\.min\(bx2,\s*wd\.x \+ wd\.w\)/;
    assert.ok(!ADMISSION.test(teachJs), 'teach does NOT carry its own copy of the admission maths');
    assert.ok(!ADMISSION.test(setJs),   'settings does NOT carry its own copy of the admission maths');
    ok('one shared implementation — no second copy in either renderer');
  }

  console.log(`\nAll boxSnap checks passed (${passed}).`);
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
