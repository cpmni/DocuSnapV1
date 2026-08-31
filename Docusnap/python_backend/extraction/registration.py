"""
extraction/registration.py
---------------------------
"Register, then read": fit a robust geometric transform from a template's TAUGHT
landmark positions onto an INCOMING page, so taught target boxes follow the page
even when the scan is shifted, skewed, or scaled (different registration).

This replaces the old "single fuzzy text anchor + translation-only offset + page-
corner drift prior" model — a 2-D scene transform modelled with one point and a
slide — with a proper multi-anchor fit:

  * locate several taught landmark labels on the incoming page,
  * pair taught->found centroids,
  * fit a SIMILARITY (translation + uniform scale + rotation; >=2 pts) or AFFINE
    (>=3 pts) transform with a small RANSAC loop so one misread landmark is
    rejected as an outlier instead of corrupting the fit,
  * map each taught target box through the transform.

Pure NumPy (BSD-3-Clause) — NO OpenCV, no new dependency, free for commercial use.
Everything works in NORMALISED [0,1] page coordinates, so the teach->run render-
scale (DPI) difference cancels in the fit and aspect-ratio differences are
absorbed by the affine fallback.

This module is geometry only: no OCR, no I/O, no image handling — so it is fully
unit-testable without Tesseract (see tests/test_registration.py).
"""

import os

import numpy as np

# Inlier threshold in NORMALISED page units (~2% of the page diagonal). A located
# landmark whose projected position lands within this of its taught position is an
# inlier; beyond it is treated as a misread/wrong-token outlier.
_DEFAULT_RESIDUAL = 0.02
_DEFAULT_MAX_ITERS = 200
# Minimal-sample sizes per model.
_SAMPLE = {"similarity": 2, "affine": 3}


class Transform:
    """A fitted 2x3 affine matrix mapping TAUGHT (template) normalised coords onto
    the incoming page, plus the fit quality used to gate/score the result."""

    __slots__ = ("matrix", "residual", "n_inliers", "n_points", "kind")

    def __init__(self, matrix, residual, n_inliers, n_points, kind):
        self.matrix    = matrix       # np.ndarray, shape (2, 3)
        self.residual  = residual     # RMS inlier residual, normalised units
        self.n_inliers = n_inliers
        self.n_points  = n_points
        self.kind      = kind         # 'similarity' | 'affine'

    def apply_point(self, x, y):
        m = self.matrix
        return (float(m[0, 0] * x + m[0, 1] * y + m[0, 2]),
                float(m[1, 0] * x + m[1, 1] * y + m[1, 2]))

    def apply_box(self, box):
        """Map a normalised {x,y,w,h} box through the transform and return the
        axis-aligned bounding box of the mapped corners (so rotation/scale are
        honoured — the result box grows to contain the rotated quad)."""
        x, y, w, h = box["x_norm"], box["y_norm"], box["w_norm"], box["h_norm"]
        corners = [self.apply_point(cx, cy) for cx, cy in
                   ((x, y), (x + w, y), (x, y + h), (x + w, y + h))]
        xs = [c[0] for c in corners]
        ys = [c[1] for c in corners]
        x0, y0 = min(xs), min(ys)
        return {"x_norm": x0, "y_norm": y0,
                "w_norm": max(xs) - x0, "h_norm": max(ys) - y0}


def box_divergence(transform, box):
    """Normalised CENTRE-distance between a box and its transform-mapped image —
    how far the fitted page transform says this box has MOVED relative to the
    taught (drawn) frame. 0.0 for a None/identity transform (a clean page where
    registration agrees with the drawn coordinates → caller keeps the absolute
    read, byte-identical), growing as the page registers differently from the
    taught frame (the drawn box is reading the wrong place → caller should prefer
    the registration read). Pure / unit-testable; no OCR."""
    if transform is None:
        return 0.0
    cx = box["x_norm"] + box["w_norm"] / 2.0
    cy = box["y_norm"] + box["h_norm"] / 2.0
    mapped = transform.apply_box(box)
    mx = mapped["x_norm"] + mapped["w_norm"] / 2.0
    my = mapped["y_norm"] + mapped["h_norm"] / 2.0
    return float(((mx - cx) ** 2 + (my - cy) ** 2) ** 0.5)


def _fit_similarity(src, dst):
    """Closed-form least-squares 2-D similarity (Umeyama, reflection-free).
    Handles N>=2. Returns a 2x3 matrix or None if degenerate (coincident pts)."""
    src = np.asarray(src, float)
    dst = np.asarray(dst, float)
    n = src.shape[0]
    if n < 2:
        return None
    mu_s = src.mean(axis=0)
    mu_d = dst.mean(axis=0)
    s_c = src - mu_s
    d_c = dst - mu_d
    var_s = float((s_c ** 2).sum()) / n
    if var_s < 1e-12:
        return None
    sigma = (d_c.T @ s_c) / n            # 2x2 covariance
    U, D, Vt = np.linalg.svd(sigma)
    S = np.eye(2)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        S[1, 1] = -1.0
    R = U @ S @ Vt
    c = float((D * np.diag(S)).sum()) / var_s   # uniform scale
    if not np.isfinite(c) or c <= 1e-9:
        return None
    t = mu_d - c * (R @ mu_s)
    M = np.empty((2, 3))
    M[:, :2] = c * R
    M[:, 2] = t
    return M


def _fit_affine(src, dst):
    """Least-squares affine (6 DOF). Handles N>=3. Rejects near-collinear minimal
    sets (no area) so an exact-but-meaningless 3-point fit isn't trusted."""
    src = np.asarray(src, float)
    dst = np.asarray(dst, float)
    n = src.shape[0]
    if n < 3:
        return None
    if n == 3:
        # Triangle area — guard against collinear correspondences.
        a, b, c = src
        area = abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]))
        if area < 1e-9:
            return None
    A = np.hstack([src, np.ones((n, 1))])      # n x 3
    P, *_ = np.linalg.lstsq(A, dst, rcond=None)  # 3 x 2
    if not np.all(np.isfinite(P)):
        return None
    return P.T                                   # 2 x 3


def _residuals(M, src, dst):
    src = np.asarray(src, float)
    dst = np.asarray(dst, float)
    proj = np.hstack([src, np.ones((src.shape[0], 1))]) @ M.T
    return np.linalg.norm(proj - dst, axis=1)


def fit_transform(src_pts, dst_pts, *, kind="similarity",
                  residual_thresh=_DEFAULT_RESIDUAL, max_iters=_DEFAULT_MAX_ITERS,
                  min_inliers=2, seed=0):
    """Fit a robust transform mapping taught `src_pts` -> located `dst_pts`
    (both Nx2, paired by index, in normalised page coords).

    Returns a Transform, or None when there is too little/too poor evidence
    (caller then falls through to the existing single-label / fast-path logic —
    a missing transform must never be worse than today's behaviour).
    """
    src = np.asarray(src_pts, float)
    dst = np.asarray(dst_pts, float)
    if src.ndim != 2 or src.shape[1] != 2 or src.shape != dst.shape:
        return None
    n = src.shape[0]
    sample = _SAMPLE.get(kind)
    if sample is None:
        return None
    fit = _fit_similarity if kind == "similarity" else _fit_affine
    if n < sample or n < min_inliers:
        return None

    # Exactly the minimal sample (or fewer than needed for RANSAC to vary): a
    # single deterministic fit; trust it only if it's self-consistent.
    if n <= sample:
        M = fit(src, dst)
        if M is None:
            return None
        res = _residuals(M, src, dst)
        if int((res <= residual_thresh).sum()) < min_inliers:
            return None
        return Transform(M, float(np.sqrt((res ** 2).mean())), n, n, kind)

    rng = np.random.default_rng(seed)   # seeded -> deterministic, testable
    best_inl = None
    best_k = -1
    for _ in range(max_iters):
        idx = rng.choice(n, sample, replace=False)
        M = fit(src[idx], dst[idx])
        if M is None:
            continue
        res = _residuals(M, src, dst)
        inl = res <= residual_thresh
        k = int(inl.sum())
        if k > best_k:
            best_k = k
            best_inl = inl

    if best_inl is None or best_k < min_inliers:
        return None
    M = fit(src[best_inl], dst[best_inl])   # refit on the full inlier set
    if M is None:
        return None
    res = _residuals(M, src[best_inl], dst[best_inl])
    rms = float(np.sqrt((res ** 2).mean())) if res.size else 0.0
    return Transform(M, rms, int(best_inl.sum()), n, kind)


MIN_VERIFIABLE_INLIERS = 3      # one point MORE than the 2-point minimal similarity sample


def is_unfalsifiable(transform, min_inliers=MIN_VERIFIABLE_INLIERS):
    """True when a fit carries ZERO verification and must be refused.

    A similarity fit surviving on `n_inliers <= _SAMPLE['similarity']` (=2) is EXACTLY DETERMINED:
    `fit_transform` scores it on the very points that produced it, so its residual is 0.0 BY
    CONSTRUCTION and `registration_confidence` returns a flat 78 no matter how wrong the fit is.
    A single false correspondence is then indistinguishable from a perfect one.

    THE PREDICATE IS ON INLIERS, NOT ON len(src): RANSAC over 5 landmarks can still collapse to a
    2-inlier consensus and refit on it, producing the identical degenerate object (measured:
    residual 1.1e-16, conf 78). Gating on the number of landmarks would miss that.

    THIS IS THE ONE SHARED DEFINITION. It exists because the same gate was written inline at
    `engine.py`'s Stage-2 call site on 2026-08-01 and NOT at `template_mapper._fit_page_transform`'s
    Stage-0.5 call site — so `template_registration` kept consuming exactly the fits Stage 2 was
    refusing, which is the 2026-08-06 Castellan incident (2 landmarks, one of them the 3-char table
    header 'Qty' false-matched onto the supplier line; the resulting transform displaced the taught
    supplier box by 0.277 of the page and overwrote a CORRECT read on 15 of 22 documents).
    Both call sites MUST consume this helper — do not re-inline the condition.

    Kill switch `REG_MIN_INLIERS_GATE=0` restores the pre-gate behaviour byte-for-byte (read at call
    time, matching the 2026-08-01 precedent). Default ON."""
    if transform is None:
        return False
    if os.environ.get('REG_MIN_INLIERS_GATE', '1') == '0':
        return False
    return int(getattr(transform, 'n_inliers', 0) or 0) < min_inliers


def registration_confidence(transform, *, base=90, floor=55, cap=95):
    """Map a fit's quality (inlier count + RMS residual) to an extraction
    confidence for the registration rung. More inliers and a tighter residual =>
    higher confidence; a 2-inlier fit with a large residual is review-forced via
    the caller's existing credibility/format gates.

    Pure function of the Transform so it is unit-testable and consistent."""
    if transform is None:
        return floor
    # Inlier term: 2 pts -> modest, >=4 -> full trust.
    inlier_term = min(1.0, (transform.n_inliers - 1) / 3.0)   # 2->0.33, 4->1.0
    # Residual term: 0 -> 1.0, _DEFAULT_RESIDUAL -> 0.0.
    res_term = max(0.0, 1.0 - (transform.residual / _DEFAULT_RESIDUAL))
    quality = 0.5 * inlier_term + 0.5 * res_term
    return int(round(floor + (base - floor) * quality)) if quality < 1.0 else cap
