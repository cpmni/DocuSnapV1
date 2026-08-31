'use strict';

/*
 * database/modules/logoDetail.js — JS arithmetic for the 256-bit ISOLATED-MARK logo detail
 * hash (migration 47; produced by python_backend/logo_detail.py). Consumed by
 * templates.identifyByFingerprint's detail-hash VETO (Oracle-signed 2026-07-23).
 *
 * ⚠ DELIBERATE DIVERGENCE from Stage-0 (Oracle C1 — this is NOT drift, do not "fix" it):
 * Python's template gate (template_matcher._logo_detail_veto) uses logo_detail.veto_by_detail,
 * the refined POSITIVE-RIVAL semantic — it vetoes only when the query mark positively matches a
 * RIVAL's enrolled set, because a bare far-from-pick veto trips on isolation garble
 * mid-pipeline (pinned by tests/test_logo_detail_veto.py). THIS module is the bare
 * FAR-FROM-PICK veto (min-over-set distance > veto dist ⇒ veto), and that is INTENTIONAL:
 * its consumers — the Review "Template available" recheck, the Template Wizard save-target,
 * graduation linking — are exactly where a COLD true supplier lives (template_id null,
 * pre-graduation, often NO rival detail set anywhere), and the positive-rival semantic fails
 * OPEN there, leaving a wrong pill standing (the 2026-07-23 Thornbury-on-Copperfield
 * incident: 64-bit phash 2/64 from the impostor, 256-bit detail 114-124/256). A false bare
 * veto here falls through to the keyword arm / Teach CTA / graduation's C2-C3 gates — toward
 * a human, never a silent wrong value. Pinned by test_template_detail_veto.js (the
 * no-rival-detail-anywhere case VETOES here, unlike Stage-0).
 *
 * ⚠ Deliberately NOT learning.detailHamming and NOT templates.hammingDistance: both return
 * LARGE-NUMBER missing-data sentinels (1e9 / 64) that are fail-safe under their
 * "accept if <= threshold" consumers but INVERT under a "veto if > threshold" consumer —
 * missing data would wrongly VETO. Here missing/mismatched input yields null, and a null
 * distance NEVER vetoes (fail-open, mirroring Python detail_distance returning None).
 */

function detailDistance(h1, h2) {
  if (!h1 || !h2 || h1.length !== h2.length) return null;
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    const a = parseInt(h1[i], 16);
    const b = parseInt(h2[i], 16);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    const xor = a ^ b;
    dist += (xor & 1) + ((xor >> 1) & 1) + ((xor >> 2) & 1) + ((xor >> 3) & 1);
  }
  return dist;
}

function minOverSet(queryDetail, storedDetails) {
  let min = null;
  for (const h of storedDetails || []) {
    const d = detailDistance(queryDetail, h);
    if (d !== null && (min === null || d < min)) min = d;
  }
  return min;
}

// The SAME env var Python reads (logo_detail.py _veto_dist), so a tuning override reaches both
// sides at once (Python children inherit Electron's env). The '72' default is parity-pinned
// against the Python source text by test_template_detail_veto.js — either side changing its
// default goes red.
function vetoDist() {
  const v = parseInt(process.env.LOGO_DETAIL_VETO_DIST || '', 10);
  return Number.isFinite(v) && v > 0 ? v : 72;
}

// True ⇒ the query mark is decisively NOT this template's mark (measured impostor distances
// 114-124/256 vs genuine same-mark scan drift 30-56). Fail-open: no query hash, empty stored
// set, or unparseable input ⇒ false — never veto on missing evidence.
function shouldVetoLogo(queryDetail, storedDetails, threshold) {
  const d = minOverSet(queryDetail, storedDetails);
  if (d === null) return false;
  return d > (threshold == null ? vetoDist() : threshold);
}

module.exports = { detailDistance, minOverSet, vetoDist, shouldVetoLogo };
