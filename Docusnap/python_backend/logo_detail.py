#!/usr/bin/env python3
"""
logo_detail.py — INTERIOR mark-isolation detail hash (the logo-collision discriminator).

The coarse 64-bit region phash (`logo_hash.logo_phash`) hashes the whole top-left LETTERHEAD
region, so two similar monogram marks (a circular "NT" vs a circular "CW") collide — and, being
a region hash, it also drifts wildly for the SAME supplier as the surrounding text varies per
document. This module ISOLATES the actual mark (the compact ink blob, dropping the horizontal
letterhead text) and hashes it at 256-bit, which SEPARATES look-alike monograms while staying
STABLE across the same supplier's documents.

Measured (GATE-0, 2026-07-14, on the live Northgate/Cascade colliding pair): coarse region64
collided (same-supplier drift 30 > inter-supplier 14); mark-isolated 256-bit SEPARATED with a
~94-bit margin (same-supplier drift 26-34, inter 128) — and byte-IDENTICALLY on a bitonal/B&W
scan (shape survives black-and-white scanning; the discriminator is colour-free by construction).

DESIGN INTENT (Oracle/Phillip/oscar, 2026-07-14): this is a DISAMBIGUATOR, not a primary matcher.
It is meant to be used ONLY to break an already-ambiguous ≥2-supplier logo cluster by ABSTAINING
when the isolated marks disagree — never to pick a supplier or raise confidence. Returns None
(fail-safe → the caller skips the gate) whenever isolation is unreliable, so a degraded scan can
never cause a false abstain. Dependency-free: NumPy + Pillow + imagehash only (all BSD/MIT/HPND).
"""
import os
from PIL import Image, ImageOps
import numpy as np
import imagehash

# Slice C veto threshold (min-over-set Hamming on the 256-bit detail hash). MEASURED, not guessed
# (GATE-0 calibration 2026-07-14, Northgate/Cascade colliding pair): a same-supplier scan lands ≤44
# bits from the supplier's stored set (max; p95 ≤20), while a look-alike collision sits ~114 apart.
# 72 gives ~28 bits headroom above the worst same-supplier drift (no false veto) and ~42 below the
# collision (catches it), on colour AND B&W. Env-overridable for tuning.
def _veto_dist():
    try:
        return int(os.environ.get('LOGO_DETAIL_VETO_DIST', '72'))
    except Exception:
        return 72

# The isolation runs on a downscaled copy of the region (speed + scale-normalisation); the mark
# only needs to be localized, then the ORIGINAL-resolution crop is hashed.
_CC_MAX_DIM   = 192      # cap the region's long side before connected-component labelling
_INK_THRESH   = 128      # < this (0-255) on the autocontrasted greyscale = ink
_DETAIL_HASH_SIZE = 16   # 16 → internal 64×64 DCT, keep 16×16 low-freq block = 256 bits


def _region(page_image: "Image.Image") -> "Image.Image":
    """The same top-left letterhead region the coarse logo hash uses (logo_hash.logo_phash)."""
    w, h = page_image.size
    return page_image.crop((0, 0, w // 2, h // 5))


def _label_components(mask: "np.ndarray"):
    """Pure-NumPy 4-connectivity connected-component labelling (two-pass union-find). `mask` is a
    2-D bool array. Returns (labels int32 array, count). No scipy/OpenCV — runs on the small
    downscaled region so the Python scan is cheap."""
    h, w = mask.shape
    labels = np.zeros((h, w), np.int32)
    parent = [0]                                    # union-find; slot 0 = background

    def find(x):
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:                    # path compression
            parent[x], x = root, parent[x]
        return root

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    nxt = 1
    for y in range(h):
        row = mask[y]
        for x in range(w):
            if not row[x]:
                continue
            up   = labels[y - 1, x] if y > 0 else 0
            left = labels[y, x - 1] if x > 0 else 0
            if up and left:
                labels[y, x] = up if up < left else left
                if up != left:
                    union(up, left)
            elif up:
                labels[y, x] = up
            elif left:
                labels[y, x] = left
            else:
                labels[y, x] = nxt
                parent.append(nxt)
                nxt += 1
    if nxt == 1:
        return labels, 0
    # Second pass: flatten each pixel to its representative root, renumbered 1..k.
    roots = np.array([find(i) for i in range(nxt)], np.int32)
    remap = {}
    out = np.zeros((h, w), np.int32)
    ys, xs = np.nonzero(labels)
    k = 0
    for y, x in zip(ys.tolist(), xs.tolist()):
        r = roots[labels[y, x]]
        lab = remap.get(r)
        if lab is None:
            k += 1
            lab = remap[r] = k
        out[y, x] = lab
    return out, k


def _mark_bbox(gray: "Image.Image"):
    """Locate the most LOGO-like ink blob inside the region: large, compact, square-ish — NOT a
    thin horizontal text strip or a vertical rule. Returns a bbox in the ORIGINAL greyscale's
    coordinates, or None when nothing sufficiently mark-shaped is found (fail-safe)."""
    ow, oh = gray.size
    scale = min(1.0, _CC_MAX_DIM / max(ow, oh))
    sw, sh = max(1, int(ow * scale)), max(1, int(oh * scale))
    small = ImageOps.autocontrast(gray.resize((sw, sh), Image.LANCZOS), cutoff=2)
    mask = np.asarray(small) < _INK_THRESH
    if mask.sum() < 16:
        return None                                  # near-blank region → no mark
    labels, n = _label_components(mask)
    if n == 0:
        return None
    best, best_score = None, -1.0
    for i in range(1, n + 1):
        ys, xs = np.where(labels == i)
        if ys.size < 12:
            continue
        y0, y1 = int(ys.min()), int(ys.max())
        x0, x1 = int(xs.min()), int(xs.max())
        bh, bw = (y1 - y0 + 1), (x1 - x0 + 1)
        if bw < 8 or bh < 8:
            continue
        aspect = bw / bh
        if aspect > 4.0 or aspect < 0.25:            # drop thin text lines / vertical rules
            continue
        fill = ys.size / float(bh * bw)
        score = ys.size * fill * min(aspect, 1.0 / aspect)   # large, dense, square-ish
        if score > best_score:
            best_score = score
            best = (x0, y0, x1 + 1, y1 + 1)
    if best is None:
        return None
    inv = 1.0 / scale                                # map the small-space bbox back to original
    return (int(best[0] * inv), int(best[1] * inv), int(best[2] * inv), int(best[3] * inv))


def detail_hash(page_image: "Image.Image"):
    """256-bit perceptual hash of the ISOLATED logo mark — the collision discriminator. Returns a
    hex string, or None on any failure / when the mark can't be reliably isolated (fail-safe:
    the caller then skips the disambiguation gate, never abstains on a missing hash). Colour-free
    (operates on greyscale), so it is identical on a colour or a black-and-white scan."""
    try:
        gray = _region(page_image).convert('L')
        bbox = _mark_bbox(gray)
        if bbox is None:
            return None
        mark = gray.crop(bbox)
        if min(mark.size) < 8:
            return None
        mark = ImageOps.autocontrast(mark, cutoff=1).resize((128, 128), Image.LANCZOS)
        return str(imagehash.phash(mark, hash_size=_DETAIL_HASH_SIZE))
    except Exception:
        return None


def detail_distance(h1: str, h2: str):
    """Hamming distance between two 256-bit hex detail hashes, or None if either is missing/malformed
    (so the caller treats 'not computed' as skip-the-gate, never as a distance)."""
    if not h1 or not h2 or len(h1) != len(h2):
        return None
    try:
        return int(imagehash.hex_to_hash(h1) - imagehash.hex_to_hash(h2))
    except Exception:
        return None


def min_over_set(query_detail, stored_details):
    """Smallest detail-hash distance between the scanned mark and a candidate's stored detail SET (the
    multi-reference set absorbs per-scan drift). None when it can't be computed (missing query / empty
    or all-null set) → the caller treats that as 'don't judge', never a distance."""
    if not query_detail or not stored_details:
        return None
    dists = [d for d in (detail_distance(query_detail, s) for s in stored_details) if d is not None]
    return min(dists) if dists else None


def should_veto_logo(query_detail, stored_details, threshold=None):
    """Slice C: does the scanned mark DISAGREE with the coarse-logo-picked candidate's stored mark set?
    True → the coarse pick is a look-alike collision → the caller ABSTAINS the logo identity (falls to
    keyword/hint + the branding net + review). NEVER picks another candidate, never raises confidence.

    FAIL-SAFE = never veto on missing data: a None query hash (isolate-fail / low-detail scan) or an
    empty/all-null stored set → False (keep the coarse pick, byte-identical to pre-Slice-C). So a missing
    detail hash can only DISABLE the veto, never drop a real supplier to review. Threshold is measured
    (_veto_dist, ~72) with headroom over same-supplier drift."""
    d = min_over_set(query_detail, stored_details)
    if d is None:
        return False
    return d > (threshold if threshold is not None else _veto_dist())


# ── Slice D: PRIMARY resolver ────────────────────────────────────────────────
# Promote the isolated-mark hash from an abstain-VETO to a PRIMARY supplier picker: given the scanned
# mark and every supplier's enrolled detail SET, POSITIVELY name the nearest supplier (min-over-set),
# so a look-alike coarse collision (Cascade↔Northgate) resolves to the RIGHT company instead of a
# coin-flip. Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-15 (Phillip/oscar/gary consensus). Kept fail-safe
# and REVIEW-BOUND at the call site (conf 69 + note); this function only classifies. Env-tunable
# thresholds (measured, not guessed): accept 80 sits ~16 above worst same-supplier drift (64) and ~28
# below the closest different-supplier distance (108); confident 48 is above p95 intra (~20) and far
# below inter; margin 24 abstains a genuine ≤margin near-tie (a collision the detail hash ALSO can't
# split) to review rather than guessing.
def _accept_dist():
    try:
        return int(os.environ.get('LOGO_DETAIL_ACCEPT_DIST', '80'))
    except Exception:
        return 80


def _confident_dist():
    try:
        return int(os.environ.get('LOGO_DETAIL_CONFIDENT_DIST', '48'))
    except Exception:
        return 48


def _accept_margin():
    try:
        return int(os.environ.get('LOGO_DETAIL_ACCEPT_MARGIN', '24'))
    except Exception:
        return 24


def classify_supplier(query_detail, by_supplier_details,
                      accept_thr=None, confident_thr=None, margin=None):
    """PRIMARY supplier resolver by nearest isolated-mark detail hash.

    query_detail:        the scanned doc's 256-bit detail hex, or None (no isolable mark).
    by_supplier_details: {supplier_name: [enrolled detail hex, ...]} for DISTINCT suppliers.
    Returns (supplier|None, dist|None, band) where band in {'confident','review',None}.

    FAIL-SAFE — returns (None, None, None) (→ the caller keeps the coarse/text path, byte-identical)
    whenever it cannot confidently PICK:
      - query None / no supplier has any usable enrolled detail → cold-start, fall to coarse;
      - nearest supplier > accept_thr → the mark matches NO known supplier well;
      - NEAR-TIE: the two nearest DISTINCT suppliers are BOTH ≤ accept_thr AND within `margin` of each
        other → a real ambiguity the detail hash can't split → abstain (never pick-nearest on a tie).
    A returned pick's `band` is 'confident' only when dist ≤ confident_thr AND the winning supplier has
    ≥ 2 enrolled marks (its drift envelope is proven); otherwise 'review'. The band is advisory — the
    call site is REVIEW-BOUND on first ship regardless (a supplier re-route is highest blast radius).
    Pure/deterministic; min-over-set within a supplier (absorbs per-scan drift; NOT mean/k-nearest,
    which would dilute a genuine single-reference match)."""
    accept_thr    = _accept_dist()    if accept_thr    is None else accept_thr
    confident_thr = _confident_dist() if confident_thr is None else confident_thr
    margin        = _accept_margin()  if margin         is None else margin
    if not query_detail or not by_supplier_details:
        return (None, None, None)
    scored = []
    for sup, dets in by_supplier_details.items():
        d = min_over_set(query_detail, dets)
        if d is not None:
            n = sum(1 for x in (dets or []) if x)      # count of usable (non-null) marks
            scored.append((sup, d, n))
    if not scored:
        return (None, None, None)                      # no enrolled detail anywhere → coarse
    scored.sort(key=lambda t: t[1])
    s1, d1, n1 = scored[0]
    if d1 > accept_thr:
        return (None, d1, None)                        # matches no supplier well → coarse
    if len(scored) > 1:
        _, d2, _ = scored[1]                            # nearest DIFFERENT supplier (keys are distinct)
        if d2 <= accept_thr and (d2 - d1) < margin:
            return (None, d1, None)                    # viable near-tie → abstain → coarse/review
    band = 'confident' if (d1 <= confident_thr and n1 >= 2) else 'review'
    return (s1, d1, band)


def detail_cross_plant_closer(query_detail, own_details, other_details_by_supplier,
                              accept_thr=None, margin=None):
    """ENROLMENT guard (Oracle C1): is an incoming detail mark POSITIVELY a DIFFERENT supplier's — i.e.
    it matches some rival's enrolled set within accept_thr AND is decisively closer to that rival than
    to this supplier's own set (by > margin)? True → refuse to enrol/backfill it under this supplier
    (it would poison the picker). Cold-start safe: when the supplier has no own detail yet (min-own =
    ∞), a mark that is FAR from every rival (a genuine first mark, inter ~108) is NOT ≤ accept_thr, so
    this returns False and the legit first mark is planted; only a mark that positively matches a rival
    is refused. FAIL-SAFE: missing query → False (nothing to poison)."""
    accept_thr = _accept_dist()   if accept_thr is None else accept_thr
    margin     = _accept_margin() if margin     is None else margin
    if not query_detail:
        return False
    min_own = min_over_set(query_detail, own_details)
    if min_own is None:
        min_own = float('inf')                         # no own detail yet → cold-start
    best_other = None
    for dets in (other_details_by_supplier or {}).values():
        m = min_over_set(query_detail, dets)
        if m is not None and (best_other is None or m < best_other):
            best_other = m
    if best_other is None:
        return False                                   # no rival detail to be closer to
    return best_other <= accept_thr and (best_other + margin) < min_own


def veto_by_detail(query_detail, pick_details, other_details_by_supplier, threshold=None):
    """SLICE C (refined 2026-07-14). ABSTAIN the coarse logo pick when the scanned mark POSITIVELY
    belongs to a DIFFERENT supplier — its 256-bit detail hash is FAR from the picked supplier's enrolled
    set (min-over-set > threshold) AND CLOSE to some OTHER supplier's set (≤ threshold). This catches a
    look-alike collision even when the TRUE supplier's coarse phash drifted OUT of the pick's band (the
    doc-193 case: a Northgate scan whose phash is dist-4 from Cascade while Northgate's own prints sit
    >band away — so the ≥2-supplier coarse gate never fired, yet the mark is unmistakably Northgate's).

    Abstain-only, and SAFE for recall: a genuine single-supplier match's mark AGREES with its own set
    (pick min ≤ threshold) → returns False FIRST → byte-identical. It only fires when the mark both
    disagrees with the pick AND agrees with a known rival — a positive cross-supplier identity, not a
    mere 'far from pick' (which an isolation-fail could trip). FAIL-SAFE: missing query/pick set → False;
    no rival mark matches (novel/garbled) → False. other_details_by_supplier = {supplier: [hashes]} for
    the NON-pick suppliers."""
    t = threshold if threshold is not None else _veto_dist()
    pm = min_over_set(query_detail, pick_details)
    if pm is None or pm <= t:
        return False                      # can't judge, or the pick's own mark agrees → keep
    for dets in (other_details_by_supplier or {}).values():
        m = min_over_set(query_detail, dets)
        if m is not None and m <= t:
            return True                   # the mark matches a DIFFERENT supplier → abstain the pick
    return False
