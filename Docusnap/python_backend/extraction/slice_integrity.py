"""
Slice integrity — S1 of Part A of the Paddle corroboration arc (007 + oscar design → Oracle SIGN-OFF W/COND C2/C3,
2026-09-23 night; docs/designs/PADDLE_CORROBORATION_ARC_2026-09-23.md §2).

Before a second reader re-reads a value crop, SNAP the crop rect to the page-level WORD boxes on the value's own row
band. The failure this closes is measured, not hypothetical: on the owner's 727 documents the second reader's 16 false
holds were 5 boxes that CUT a glyph (an `S` cut in half reads as `5`), 4 boxes that BLED into the next line, and
Tesseract's own +20 px crop (the C1 stop-gap) made the reader pick up neighbouring ink instead. The page-level
`image_to_data` pass saw the whole word — its box is the rect the reader should get.

Contract (pure; never raises; never touches a value or a note):
  snap_rect_to_words(rect, lines) -> {
      'rect': {x_norm,y_norm,w_norm,h_norm}   the rect to read (== input when nothing is admitted or on a cap),
      'integrity': 'no_lines' | 'no_words' | 'clean' | 'healed' | 'unhealed',
      'n_words': int, 'grown': bool, 'edges': {'left': bool, 'right': bool, 'top': bool, 'bottom': bool}}
  - lines: the mapper's page-word lines (template_mapper._ocr_lines shape: [{'words': [{'text','x_norm','y_norm',
    'w_norm','h_norm'}, …]}]) in the SAME frame as `rect` (page-norm, top-left).
  - ROW BAND: a word belongs to the value's row when its vertical centre is within 0.6 × max(word_h, rect_h) of the
    rect's centre — the Slice-B convention `template_mapper._find_edge_cut_words` / `_snap_box_to_words` use.
  - ADMIT a row-band word when at least HALF A GLYPH of it lies inside the rect horizontally (glyph width = word
    width / len(text)); a neighbour merely touched by an over-wide rect is left out (Oracle C2: never grow into a
    non-intersecting neighbour).
  - The snapped rect is the UNION of the admitted words' boxes: a cut glyph is restored (the word's own box), a
    next-line bleed is removed (the row's own height). 'healed' when the rect moved by more than a hairline on any
    edge, else 'clean'.
  - CAP (the mapper's B-C3 rule): a union wider than 3× the rect or taller than 2.5× it is not a snap licence — a tiny
    box nicking a long line — → 'unhealed', rect UNCHANGED (the caller keeps today's read; Oracle C3: no note, no cap).
The ink-at-edge sensor of the design is DETECT-only and not in this slice (Oracle C2: add it only when the 727
histogram shows a class the word snap misses).
"""
from __future__ import annotations

ROW_BAND = 0.6          # × max(word_h, rect_h) — the Slice-B convention
ADMIT_GLYPHS = 0.5      # a word is admitted when ≥ this many of its glyphs lie inside the rect
HAIRLINE = 0.0015       # page-norm; below this an edge move is 'clean', not 'healed'
CAP_W, CAP_H = 3.0, 2.5  # union caps relative to the rect (B-C3)


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _alnum(s):
    return ''.join(ch for ch in str(s or '') if ch.isalnum()).upper()


def word_is_value(text, committed):
    """VALUE-TEXT FILTER (S1 v3, 2026-09-23 night): is this page word part of the committed value's ink, rather than
    its LABEL? The S1 v2 census showed the bare mapping rect (the rung's expanded read area) already covers "No:" on
    many layouts, so a purely geometric admit swallowed the label into the reader's crop on 28 of 38 length abstains.
    Content test on the alnum cores: containment either way (a split value `PO 12345`, a glued `No:SO-82482` word),
    or the same length with ≤ 2 differing characters (the page pass's own misread of the value, `S0-82482` for
    `SO-82482`, must still count as the value's word). A label ("NO", "DELIVERYNOTENO") fails both."""
    a, c = _alnum(text), _alnum(committed)
    if not a or not c:
        return False
    if len(a) >= 3 and (a in c or c in a):
        return True
    if len(a) == 2 and (c.startswith(a) or c.endswith(a)):
        return True                                       # a split value's 2-letter prefix token (`PO 12345`)
    if len(a) == len(c) and sum(x != y for x, y in zip(a, c)) <= 2:
        return True
    return False


def snap_rect_to_words(rect, lines, committed=None):
    out = {'rect': rect, 'integrity': 'no_lines', 'n_words': 0, 'grown': False,
           'edges': {'left': False, 'right': False, 'top': False, 'bottom': False}}
    try:
        if not lines or not isinstance(rect, dict):
            return out
        x1, y1, w, h = (_f(rect.get('x_norm')), _f(rect.get('y_norm')), _f(rect.get('w_norm')), _f(rect.get('h_norm')))
        if None in (x1, y1, w, h) or w <= 0 or h <= 0:
            return out
        x2, y2 = x1 + w, y1 + h
        cy = y1 + h / 2.0
        admitted = []
        for ln in lines:
            for wd in (ln.get('words') or ()) if isinstance(ln, dict) else ():
                wx1, wy1, ww, wh = (_f(wd.get('x_norm')), _f(wd.get('y_norm')), _f(wd.get('w_norm')), _f(wd.get('h_norm')))
                if None in (wx1, wy1, ww, wh) or ww <= 0 or wh <= 0:
                    continue
                if abs((wy1 + wh / 2.0) - cy) > max(wh, h) * ROW_BAND:
                    continue                                   # another row's word
                g = ww / max(1, len(str(wd.get('text') or '')))
                overlap = min(x2, wx1 + ww) - max(x1, wx1)
                if overlap < ADMIT_GLYPHS * g:
                    continue                                   # touched, not read
                if committed is not None and not word_is_value(wd.get('text'), committed):
                    continue                                   # the label (or a neighbour), not the value's ink
                admitted.append((wx1, wy1, wx1 + ww, wy1 + wh))
        out['integrity'] = 'no_words'
        if not admitted:
            return out
        ux1 = min(a[0] for a in admitted); uy1 = min(a[1] for a in admitted)
        ux2 = max(a[2] for a in admitted); uy2 = max(a[3] for a in admitted)
        out['n_words'] = len(admitted)
        if (ux2 - ux1) > CAP_W * w or (uy2 - uy1) > CAP_H * h:
            out['integrity'] = 'unhealed'                      # a nick on a long line is not a licence
            return out
        edges = {'left': ux1 < x1 - HAIRLINE, 'right': ux2 > x2 + HAIRLINE,
                 'top': uy1 < y1 - HAIRLINE, 'bottom': uy2 > y2 + HAIRLINE}
        moved = any((abs(ux1 - x1), abs(uy1 - y1), abs(ux2 - x2), abs(uy2 - y2))[i] > HAIRLINE for i in range(4))
        out.update({'rect': {'x_norm': max(0.0, ux1), 'y_norm': max(0.0, uy1),
                             'w_norm': min(1.0, ux2) - max(0.0, ux1), 'h_norm': min(1.0, uy2) - max(0.0, uy1)},
                    'integrity': 'healed' if moved else 'clean', 'grown': any(edges.values()), 'edges': edges})
        return out
    except Exception:
        return out
