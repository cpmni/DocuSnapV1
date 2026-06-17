#!/usr/bin/env python3
"""
tests/test_registration.py
--------------------------
Unit tests for extraction.registration — the pure-NumPy "register, then read"
transform fit (P4 core). No OCR, no images: geometry only, so this runs without
Tesseract. Verifies that:

  - a known similarity (translation+scale+rotation) is recovered from clean pts,
  - a single outlier landmark is rejected by RANSAC (the redundancy the old
    single-anchor model lacked),
  - affine recovers shear/anisotropic scale,
  - box mapping honours scale (and rotation grows the AABB),
  - degenerate / too-few / coincident inputs return None (clean fall-through),
  - confidence rises with inliers and falls with residual.

Usage:  py -3.12 python_backend/tests/test_registration.py
Exit 0 = pass.
"""

import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import registration  # noqa: E402


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def _similarity_matrix(scale, deg, tx, ty):
    th = math.radians(deg)
    c, s = math.cos(th), math.sin(th)
    return np.array([[scale * c, -scale * s, tx],
                     [scale * s,  scale * c, ty]])


def _apply(M, pts):
    pts = np.asarray(pts, float)
    return (np.hstack([pts, np.ones((pts.shape[0], 1))]) @ M.T)


def test_recovers_similarity():
    failures = 0
    print("fit_transform: recovers a known similarity (scale+rotation+translation)")
    rng = np.random.default_rng(42)
    src = rng.random((6, 2))
    M_true = _similarity_matrix(1.35, 12.0, 0.07, -0.04)
    dst = _apply(M_true, src)

    t = registration.fit_transform(src, dst, kind="similarity")
    if not check("returns a Transform", t is not None):
        return failures + 1
    if not check("all 6 points are inliers", t.n_inliers == 6):
        failures += 1
    if not check(f"residual ~0 (got {t.residual:.2e})", t.residual < 1e-6):
        failures += 1
    # The fitted transform maps src onto dst.
    proj = _apply(t.matrix, src)
    if not check("fitted transform reproduces dst", np.allclose(proj, dst, atol=1e-6)):
        failures += 1
    print()
    return failures


def test_rejects_outlier():
    failures = 0
    print("fit_transform: RANSAC rejects a single misread landmark")
    rng = np.random.default_rng(7)
    src = rng.random((6, 2))
    M_true = _similarity_matrix(1.1, -8.0, 0.02, 0.05)
    dst = _apply(M_true, src)
    # Corrupt ONE correspondence (a mislocated/duplicate label).
    dst[3] = dst[3] + np.array([0.4, -0.35])

    t = registration.fit_transform(src, dst, kind="similarity")
    if not check("returns a Transform despite the outlier", t is not None):
        return failures + 1
    if not check(f"5 of 6 are inliers (outlier rejected, got {t.n_inliers})", t.n_inliers == 5):
        failures += 1
    if not check(f"inlier residual stays small (got {t.residual:.2e})", t.residual < 1e-6):
        failures += 1
    # The good points still map correctly.
    good = [0, 1, 2, 4, 5]
    proj = _apply(t.matrix, src[good])
    if not check("non-outlier points map onto dst", np.allclose(proj, dst[good], atol=1e-5)):
        failures += 1
    print()
    return failures


def test_affine_shear():
    failures = 0
    print("fit_transform: affine recovers shear / anisotropic scale")
    rng = np.random.default_rng(11)
    src = rng.random((8, 2))
    M_true = np.array([[1.2, 0.15, 0.03],
                       [0.05, 0.9, -0.02]])   # non-similarity (shear + aniso)
    dst = _apply(M_true, src)
    t = registration.fit_transform(src, dst, kind="affine")
    if not check("affine returns a Transform", t is not None):
        return failures + 1
    if not check("affine reproduces the sheared dst", np.allclose(_apply(t.matrix, src), dst, atol=1e-6)):
        failures += 1
    # Similarity (4 DOF) cannot model shear -> should NOT fit all points tightly.
    ts = registration.fit_transform(src, dst, kind="similarity", residual_thresh=0.001)
    if not check("similarity cannot fit a sheared scene at tight tolerance",
                 ts is None or ts.n_inliers < 8):
        failures += 1
    print()
    return failures


def test_apply_box():
    failures = 0
    print("Transform.apply_box: maps a box under scale/translation")
    # Pure scale x2 about origin + translate.
    M = np.array([[2.0, 0.0, 0.1],
                  [0.0, 2.0, 0.2]])
    t = registration.Transform(M, 0.0, 4, 4, "similarity")
    box = {"x_norm": 0.1, "y_norm": 0.1, "w_norm": 0.2, "h_norm": 0.05}
    out = t.apply_box(box)
    ok = (abs(out["x_norm"] - 0.3) < 1e-9 and abs(out["y_norm"] - 0.4) < 1e-9
          and abs(out["w_norm"] - 0.4) < 1e-9 and abs(out["h_norm"] - 0.1) < 1e-9)
    if not check("scaled+translated box maps correctly", ok):
        failures += 1
    # 90deg rotation grows the AABB to contain the rotated quad.
    Mr = _similarity_matrix(1.0, 90.0, 0.0, 0.0)
    tr = registration.Transform(Mr, 0.0, 3, 3, "similarity")
    outr = tr.apply_box({"x_norm": 0.0, "y_norm": 0.0, "w_norm": 0.2, "h_norm": 0.1})
    if not check("rotated box AABB swaps w/h (within tol)",
                 abs(outr["w_norm"] - 0.1) < 1e-6 and abs(outr["h_norm"] - 0.2) < 1e-6):
        failures += 1
    print()
    return failures


def test_degenerate_inputs():
    failures = 0
    print("fit_transform: degenerate / insufficient inputs -> None (clean fall-through)")
    if not check("fewer than 2 points -> None",
                 registration.fit_transform([[0.1, 0.1]], [[0.2, 0.2]]) is None):
        failures += 1
    if not check("mismatched shapes -> None",
                 registration.fit_transform([[0.1, 0.1], [0.2, 0.2]], [[0.2, 0.2]]) is None):
        failures += 1
    coincident = [[0.5, 0.5], [0.5, 0.5]]
    if not check("coincident source points -> None",
                 registration.fit_transform(coincident, [[0.1, 0.1], [0.9, 0.9]]) is None):
        failures += 1
    # 2 clean points -> a valid similarity (minimal case).
    t2 = registration.fit_transform([[0.2, 0.2], [0.6, 0.5]],
                                    [[0.25, 0.22], [0.65, 0.52]], kind="similarity")
    if not check("2 clean points -> valid minimal similarity", t2 is not None and t2.n_inliers == 2):
        failures += 1
    print()
    return failures


def test_confidence_monotonic():
    failures = 0
    print("registration_confidence: rises with inliers, falls with residual")
    hi = registration.Transform(np.eye(2, 3), residual=0.0,  n_inliers=5, n_points=5, kind="similarity")
    lo = registration.Transform(np.eye(2, 3), residual=0.018, n_inliers=2, n_points=5, kind="similarity")
    c_hi = registration.registration_confidence(hi)
    c_lo = registration.registration_confidence(lo)
    if not check(f"strong fit scores high (got {c_hi})", c_hi >= 90):
        failures += 1
    if not check(f"weak fit scores lower (got {c_lo} < {c_hi})", c_lo < c_hi):
        failures += 1
    if not check("None transform -> floor", registration.registration_confidence(None) == 55):
        failures += 1
    print()
    return failures


def main():
    failures = 0
    failures += test_recovers_similarity()
    failures += test_rejects_outlier()
    failures += test_affine_shear()
    failures += test_apply_box()
    failures += test_degenerate_inputs()
    failures += test_confidence_monotonic()
    if failures:
        print(f"{failures} check(s) failed — registration regressed.")
        return 1
    print("All checks passed — registration transform fit behaves as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
