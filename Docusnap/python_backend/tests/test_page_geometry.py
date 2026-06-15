#!/usr/bin/env python3
"""
tests/test_page_geometry.py
---------------------------
Unit test for extraction.page_geometry — the pure, deterministic normalised
page-landmark helper used only as a SEARCH PRIOR for template-mapper drift
fallback seeding. No Tesseract, no images: the helper is pure arithmetic.

Coverage:
  - landmark count and exact normalised positions (deterministic order)
  - nearest_landmark correctness for known points (incl. exact-landmark and
    Voronoi-cell membership)
  - round-trip identity: landmark + offset == point
  - scale-style invariance: the landmark-relative offset scales linearly when a
    point is perturbed about its nearest landmark (stays in the same cell)

Usage:
    py -3.12 python_backend/tests/test_page_geometry.py
Exit code 0 = pass, 1 = regression.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extraction import page_geometry  # noqa: E402


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def test_landmarks():
    failures = 0
    print("landmarks: count + exact normalised positions")
    pts = page_geometry.landmarks()

    if not check("exactly 13 landmarks", len(pts) == 13):
        failures += 1

    expected = [
        (0.5, 0.5),                                              # centre
        (0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0),          # page corners
        (0.25, 0.25), (0.75, 0.25), (0.75, 0.75), (0.25, 0.75),  # centred 50% box
        (0.125, 0.125), (0.875, 0.125), (0.875, 0.875), (0.125, 0.875),  # centred 75% box
    ]
    if not check("landmark points match the expected fixed lattice (and order)",
                 pts == expected):
        failures += 1

    # All landmarks lie within the unit square.
    if not check("every landmark is within [0,1]x[0,1]",
                 all(0.0 <= x <= 1.0 and 0.0 <= y <= 1.0 for x, y in pts)):
        failures += 1

    # Determinism: two calls return identical structures.
    if not check("landmarks() is deterministic across calls",
                 page_geometry.landmarks() == pts):
        failures += 1

    print()
    return failures


def test_nearest_landmark():
    failures = 0
    print("nearest_landmark: closest point + landmark-relative offset")

    # A point in the upper-left: the centred-75% corner (0.125,0.125) is nearest
    # (closer than the page corner (0,0) or the 50% corner (0.25,0.25)).
    lm, off = page_geometry.nearest_landmark(0.10, 0.20)
    if not check("(0.10,0.20) -> nearest is the 75% box corner (0.125,0.125)",
                 lm == (0.125, 0.125)):
        failures += 1
    if not check("returned offset is (x-lx, y-ly)",
                 abs(off[0] - (0.10 - 0.125)) < 1e-12 and abs(off[1] - (0.20 - 0.125)) < 1e-12):
        failures += 1

    # An exact landmark returns itself with a zero offset.
    lm2, off2 = page_geometry.nearest_landmark(0.5, 0.5)
    if not check("an exact landmark maps to itself with zero offset",
                 lm2 == (0.5, 0.5) and abs(off2[0]) < 1e-12 and abs(off2[1]) < 1e-12):
        failures += 1

    # Near a page corner: (0.05,0.95) is closest to the (0,1) corner.
    lm3, _ = page_geometry.nearest_landmark(0.05, 0.95)
    if not check("(0.05,0.95) -> nearest page corner (0.0,1.0)", lm3 == (0.0, 1.0)):
        failures += 1

    # Round-trip identity for a scatter of points: landmark + offset == point.
    roundtrip_ok = True
    for x, y in [(0.10, 0.20), (0.49, 0.51), (0.80, 0.10), (0.90, 0.90), (0.30, 0.70)]:
        (lx, ly), (dx, dy) = page_geometry.nearest_landmark(x, y)
        if abs((lx + dx) - x) > 1e-12 or abs((ly + dy) - y) > 1e-12:
            roundtrip_ok = False
    if not check("landmark + offset reconstructs the original point exactly", roundtrip_ok):
        failures += 1

    print()
    return failures


def test_offset_scale_invariance():
    """The landmark-relative offset is a pure displacement from a FIXED reference,
    so perturbing a point about its nearest landmark (a scale-style change that
    keeps it in the same Voronoi cell) scales the offset linearly and leaves the
    chosen landmark unchanged. This is the property the drift-fallback prior
    relies on: re-seeding from `landmark + offset` is stable under page scale."""
    failures = 0
    print("offset invariance: scaling about the nearest landmark scales the offset")

    base_lm, base_off = page_geometry.nearest_landmark(0.13, 0.13)  # near (0.125,0.125)
    if not check("base point sits in the 75%-corner cell", base_lm == (0.125, 0.125)):
        failures += 1

    consistent = True
    for k in (0.5, 1.5, 2.0):
        # Scale the point about its landmark by k -> offset should be k * base_off.
        px = base_lm[0] + base_off[0] * k
        py = base_lm[1] + base_off[1] * k
        lm, off = page_geometry.nearest_landmark(px, py)
        if lm != base_lm:
            consistent = False
        if abs(off[0] - base_off[0] * k) > 1e-12 or abs(off[1] - base_off[1] * k) > 1e-12:
            consistent = False
    if not check("offset scales linearly with the perturbation, landmark fixed", consistent):
        failures += 1

    print()
    return failures


def main():
    failures = 0
    failures += test_landmarks()
    failures += test_nearest_landmark()
    failures += test_offset_scale_invariance()

    if failures:
        print(f"{failures} check(s) failed — page_geometry regressed.")
        return 1
    print("All checks passed — page_geometry landmarks behave as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
