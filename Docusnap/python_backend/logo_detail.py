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
from PIL import Image, ImageOps
import numpy as np
import imagehash

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
