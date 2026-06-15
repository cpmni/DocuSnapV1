"""
extraction/page_geometry.py
---------------------------
Pure, deterministic page-geometry landmarks in NORMALISED page coordinates
([0,1] x [0,1]). Content-free — these points depend only on the page rectangle,
never on what is printed. Used solely as a coarse SEARCH PRIOR for the
template-mapper drift fallback (see template_mapper._drift_fallback): a stable
reference lattice to re-seed a target zone when local anchor relocation has
already failed. Never relocates a located anchor, never sets a value, never
changes confidence or precedence.

Landmarks (13, fixed order):
    - page centre                          (1)
    - 4 page corners                       (4)
    - 4 corners of the centred 50% box     (4)  -> at 0.25 / 0.75
    - 4 corners of the centred 75% box     (4)  -> at 0.125 / 0.875
The centred-box corners lie on the page diagonals (a centred square's corners
sit on y=x and y=1-x), so they double as the box<->diagonal intersection points.
"""


def _box_corners(frac):
    """Corners of a `frac`-of-page box centred on the page, clockwise from top-left."""
    lo = (1.0 - frac) / 2.0
    hi = 1.0 - lo
    return [(lo, lo), (hi, lo), (hi, hi), (lo, hi)]


def landmarks():
    """Return the fixed, deterministic list of normalised landmark points."""
    pts = [(0.5, 0.5)]                                       # page centre
    pts += [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]  # page corners
    pts += _box_corners(0.5)                                 # centred 50% box
    pts += _box_corners(0.75)                                # centred 75% box
    return pts


def nearest_landmark(x, y):
    """
    Return (landmark_point, (dx, dy)) for the landmark closest to (x, y), where
    (dx, dy) = (x - lx, y - ly) is the landmark-RELATIVE offset of the point.
    Deterministic: ties resolve to the earliest landmark in `landmarks()` order.
    Round-trips exactly — landmark_point + (dx, dy) == (x, y).
    """
    best = None
    best_d = None
    for (lx, ly) in landmarks():
        d = (x - lx) ** 2 + (y - ly) ** 2
        if best_d is None or d < best_d:
            best_d = d
            best = (lx, ly)
    return best, (x - best[0], y - best[1])
