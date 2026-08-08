'use strict';
/*
 * teach_label_reread_probe.js — offline gate for the teach-wizard PASS-2 label re-read
 * (2026-07-31, gary + Oracle SIGN-OFF-W/COND; the live "Sales Order No." → "oe ee No." garble).
 *
 * Drives the SAME pure decision chain the wizard uses (shared/anchorLabel.js: nearestRowTo →
 * nearestLeftCluster → extractLabel → sanitizeAnchorLabel → clusterTouchesClipEdge →
 * labelRereadRect → accept rule incl. isTypeHeadingLabel) over REAL OCR of doc 182 (the
 * Ironbridge sales order in the live inbox), with the band geometry mirrored from
 * teach/renderer.js autoLabel (left band: x 0..value.x, 1.8× the DRAWN box height centred —
 * keep in sync with renderer.js:794-801). OCR via stress_test/teach_label_probe_crops.py
 * (region.py --boxes, the wizard's exact recipe).
 *
 * PINS (Oracle condition 6):
 *   - every CLIPPED draw variant ends at the clean 'Sales Order No.' label;
 *   - the TIGHT draw triggers pass-2 ZERO times (byte-identical claim, tested);
 *   - the fully-DECAPITATED variant NEVER adopts the big 'SALES ORDER' type heading
 *     (position-only / forced-suspicious is the correct outcome there);
 *   - a clip-trigger whose pass-2 is rejected forces suspicious=true (never junk-as-legit).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/teach_label_reread_probe.js
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawnSync } = require('child_process');
global.window = global;
const A = require(path.join(__dirname, '..', 'src', 'windows', 'shared', 'anchorLabel.js'));

const PY = process.env.TEACH_PROBE_PY || 'py';
const PY_ARGS = process.env.TEACH_PROBE_PY ? [] : ['-3.12'];
const CROPS = path.join(__dirname, 'teach_label_probe_crops.py');
const TYPE_NAMES = ['Sales Order', 'Purchase Order', 'Invoice'];   // install defaults

// The value word "SO-30288" on doc 182's scale-4 render (measured; the PDF is a fixed fixture).
const PAGE = { W: 2385, H: 3372 };
const VAL = { x: 1927 / PAGE.W, y: 474 / PAGE.H, w: 211 / PAGE.W, h: 33 / PAGE.H };

// Draw variants: how a user's value box lands around those glyphs (the repro matrix).
const v = VAL;
const VARIANTS = {
  tight:         { x: v.x, y: v.y, w: v.w, h: v.h },
  pad20pct:      { x: v.x - v.w * 0.1, y: v.y - v.h * 0.2, w: v.w * 1.2, h: v.h * 1.4 },
  down_half_h:   { x: v.x, y: v.y + v.h * 0.5, w: v.w, h: v.h },
  up_half_h:     { x: v.x, y: v.y - v.h * 0.5, w: v.w, h: v.h },
  short_xheight: { x: v.x, y: v.y + v.h * 0.35, w: v.w, h: v.h * 0.55 },
  down_full_h:   { x: v.x, y: v.y + v.h, w: v.w, h: v.h },   // fully decapitated
};

// LEFT band — MIRROR of teach/renderer.js autoLabel (keep in sync).
function leftBand(box) {
  const lPad = box.h * 0.4;
  const lY = Math.max(0, box.y - lPad);
  return { x: 0, y: lY, w: Math.max(0, box.x), h: Math.min(1 - lY, box.h + 2 * lPad), dir: 'left' };
}

function ocrRects(rects) {
  const rf = path.join(os.tmpdir(), `tlp_r_${Date.now()}.json`);
  const of = path.join(os.tmpdir(), `tlp_o_${Date.now()}.json`);
  fs.writeFileSync(rf, JSON.stringify(rects.map(r => [r.x, r.y, r.w, r.h])));
  const p = spawnSync(PY, [...PY_ARGS, CROPS, '--rects-file', rf, '--out', of],
                      { encoding: 'utf8', timeout: 300000 });
  if (p.stderr && p.stderr.trim()) console.error('[crops stderr]', p.stderr.trim());
  if (p.status !== 0) { console.error(p.stdout); throw new Error('crop OCR failed'); }
  const out = JSON.parse(fs.readFileSync(of, 'utf8'));
  fs.unlinkSync(rf); fs.unlinkSync(of);
  return out;
}

// Pass-1: the wizard's picker chain over a band's words (native ds=1.0).
function pass1(band, valueBox, words, cropH) {
  const cY = ((valueBox.y + valueBox.h / 2) - band.y) * PAGE.H;   // ds=1.0 (TEACH_NATIVE_CROP)
  const rowWords = A.nearestRowTo(words, cY);
  const cluster = A.nearestLeftCluster(rowWords || words);
  const rawText = (cluster ? cluster.text : '').trim();
  const label = A.sanitizeAnchorLabel(A.extractLabel(rawText) || '');
  let abox = null;
  if (cluster && cluster.box) {
    const [l, t, w, h] = cluster.box;
    abox = { x: band.x + l / PAGE.W, y: band.y + t / PAGE.H, w: w / PAGE.W, h: h / PAGE.H };
  }
  const clipped = !!(cluster && cluster.box)
    && A.clusterTouchesClipEdge(cluster.box, cropH, band.dir);
  return { label, abox, clipped, suspicious: label ? A.labelLooksSuspicious(label) : true };
}

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

(function main() {
  const names = Object.keys(VARIANTS);
  const bands = names.map(n => leftBand(VARIANTS[n]));
  console.log('OCR pass 1 (bands)…');
  const b1 = ocrRects(bands);

  // Phase A: pass-1 + trigger per variant.
  const st = {};
  names.forEach((n, i) => {
    const r = b1.results[i];
    st[n] = pass1(bands[i], VARIANTS[n], r.words, r.crop_h);
    st[n].trigger = !!st[n].label && (st[n].clipped || st[n].suspicious);
    console.log(`  ${n}: pass1=${JSON.stringify(st[n].label)} clipped=${st[n].clipped} ` +
                `suspicious=${st[n].suspicious} trigger=${st[n].trigger}`);
  });

  check("TIGHT draw: pass-2 count 0 (clean unclipped read — byte-identical claim)",
        st.tight.trigger === false && st.tight.label === 'Sales Order No.');

  // Phase B: pass-2 re-read for triggered variants with a usable cluster box.
  const trig = names.filter(n => st[n].trigger && st[n].abox);
  const rects = trig.map(n => A.labelRereadRect(st[n].abox, VARIANTS[n]));
  console.log(`OCR pass 2 (${trig.length} tight re-reads)…`);
  const b2 = trig.length ? ocrRects(rects) : { results: [] };
  trig.forEach((n, i) => {
    const rect = rects[i], words = b2.results[i].words;
    const cY = ((VARIANTS[n].y + VARIANTS[n].h / 2) - rect.y) * PAGE.H;
    const rowWords = A.nearestRowTo(words, cY);
    const cluster = A.nearestLeftCluster(rowWords || words);
    const text = A.sanitizeAnchorLabel(A.extractLabel(String((cluster && cluster.text) || '').trim()) || '');
    const ok = !!text && !A.labelLooksSuspicious(text) && !A.isTypeHeadingLabel(text, TYPE_NAMES)
      && cluster && Array.isArray(cluster.box);
    if (ok) { st[n].final = text; st[n].finalSuspicious = false; }
    else { st[n].final = st[n].label; st[n].finalSuspicious = true; }   // forced-suspicious path
    console.log(`  ${n}: pass2=${JSON.stringify(text)} accepted=${ok}`);
  });
  for (const n of names) {
    if (st[n].final === undefined) { st[n].final = st[n].label; st[n].finalSuspicious = st[n].suspicious; }
  }

  console.log('\nPINS:');
  for (const n of ['pad20pct', 'down_half_h', 'up_half_h', 'short_xheight']) {
    check(`${n}: final label is the clean 'Sales Order No.'`,
          st[n].final === 'Sales Order No.' && st[n].finalSuspicious === false);
  }
  check("down_full_h (decapitated): NEVER adopts the 'SALES ORDER' type heading",
        String(st.down_full_h.final || '').toUpperCase() !== 'SALES ORDER'
        && !A.isTypeHeadingLabel(st.down_full_h.final, TYPE_NAMES)
        || st.down_full_h.finalSuspicious === true);
  check('down_full_h: clean recovery OR forced-suspicious (never junk-as-legit)',
        st.down_full_h.final === 'Sales Order No.' ? st.down_full_h.finalSuspicious === false
                                                   : st.down_full_h.finalSuspicious === true);

  console.log(fails ? `\n${fails} FAILED` : '\nALL PINS PASS');
  process.exit(fails ? 1 : 0);
})();
