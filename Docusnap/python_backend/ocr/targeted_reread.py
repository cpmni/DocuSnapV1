"""Targeted gate-failure re-read (Stage-4.5 withhold escalation).

When Stage 4.5 WITHHOLDS a structured value on format grounds (engine sets value=None,
conf 0, note "doesn't match the expected format — please enter manually"), take ONE bounded
second look: locate the garbled value's region on the page from a full-page image_to_data
pass, tight-crop re-read via the existing anchor crop ladder, and adopt ONLY a read that
passes the exact gate the original FAILED (learned-format clean + kinship to the garble).
Review-bound by construction upstream (the engine caps conf and notes it); this module never
emits a silent value and abstains whenever the evidence is ambiguous.

Design: REREAD_ESCALATION_DESIGN_2026-07-11 (Oracle SIGN OFF WITH CONDITIONS). This module is
PURE / INJECTABLE by construction — the heavy dependencies (the anchor crop ladder, PIL
cropping, pytesseract.image_to_data) are passed in as callables, so the decision logic
(adoption predicate + locate + orchestration seam) is unit-testable with no images. The engine
supplies the real callables in Slice 2.

Oracle seams honoured:
  #1 ladder return contract — `_ocr_crop_laddered` returns `best_seg or None`, and best_seg may
     be a GATE-FAILING segment (the best failing rung). So the adoption predicate is applied
     BOTH as the ladder's verify_fn (rung selection) AND re-applied to the ladder's return
     (authority). Non-None is never treated as "adopted".
  #2 frame invariant — locate and crop MUST come from the SAME image instance. This module
     reads image_to_data from a page image and crops from that SAME object; it never re-renders.
  #3 multi-word garbles — an inserted-space garble ("1 102V03NL1") locates as a word SEQUENCE,
     so locate matches contiguous n-grams of adjacent words within a row.

No new dependencies: stdlib only here; pytesseract/PIL live behind the injected callables.
"""
from __future__ import annotations

import re


# ── small pure helpers ────────────────────────────────────────────────────────
def _alnum(s) -> str:
    """Lower-cased alphanumeric-only projection — the compare frame for kinship/similarity
    (separators and case are OCR-noisy and not the signal we gate on)."""
    return ''.join(ch for ch in str(s or '').lower() if ch.isalnum())


def _levenshtein(a: str, b: str, cap: int = 3) -> int:
    """Levenshtein edit distance, bounded: returns the true distance if <= cap, else cap+1.
    The cap keeps it cheap (we only ever ask "is it <= max_edits") and lets us early-exit a row
    whose whole minimum already exceeds cap."""
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if abs(la - lb) > cap:
        return cap + 1
    prev = list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i] + [0] * lb
        ca = a[i - 1]
        row_min = cur[0]
        for j in range(1, lb + 1):
            cost = 0 if ca == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if cur[j] < row_min:
                row_min = cur[j]
        if row_min > cap:
            return cap + 1
        prev = cur
    return prev[lb]


def _similarity(a, b) -> float:
    """1.0 = identical alnum forms; else 1 - editdistance/maxlen on the alnum projections."""
    aa, bb = _alnum(a), _alnum(b)
    if not aa or not bb:
        return 0.0
    if aa == bb:
        return 1.0
    m = max(len(aa), len(bb))
    d = _levenshtein(aa, bb, cap=m)
    return 1.0 - (d / m)


# ── adoption predicate (the ONE gate) ─────────────────────────────────────────
def is_adoptable(candidate, fmt_entry, garble, config_pattern=None, max_edits=2) -> bool:
    """Adopt a re-read ONLY when it is:
      (a) non-empty;
      (b) CLEAN against the field's LEARNED format — check_value(...) is None means the value
          satisfies class + charset (_disallowed_chars) + date/currency parse + the learned
          SHAPE set. This is the EXACT gate the withheld read failed, re-run on the candidate;
      (c) a match for the field TYPE's config validation pattern, when one is supplied (many
          ref/code fields have none — then this step is skipped);
      (d) KIN to the garble — edit distance <= max_edits on alnum-collapsed forms — so a
          gate-VALID but WRONG-INSTANCE value (a different real ref that merely fits the shape)
          can never be adopted in place of the withheld one.
    check_value is imported lazily to avoid any ocr<->extraction load-order coupling."""
    if candidate is None:
        return False
    cand = str(candidate).strip()
    if not cand:
        return False
    from extraction.format_anomaly_checker import check_value
    if check_value(cand, fmt_entry) is not None:     # (b) learned-format clean
        return False
    if config_pattern:                               # (c) field-type pattern (optional)
        try:
            if not re.fullmatch(config_pattern, cand):
                return False
        except re.error:
            pass  # a broken pattern must never block a format-clean, kin candidate
    if _levenshtein(_alnum(cand), _alnum(garble), cap=max_edits) > max_edits:   # (d) kinship
        return False
    return True


# ── locate ────────────────────────────────────────────────────────────────────
def _group_lines(page_data) -> dict:
    """image_to_data DICT -> {(block,par,line): [word,...]} where each word is
    {text,left,top,width,height,word_num}. Drops empty tokens and conf<0 rows (mirrors
    tesseract._words / anchor line grouping)."""
    txt = page_data.get('text') or []
    n = len(txt)
    conf = page_data.get('conf') or []
    wn = page_data.get('word_num') or [0] * n
    lines: dict = {}
    for i in range(n):
        t = (txt[i] or '').strip()
        if not t:
            continue
        try:
            c = float(conf[i])
        except (TypeError, ValueError, IndexError):
            c = -1.0
        if c < 0:
            continue
        key = (page_data['block_num'][i], page_data['par_num'][i], page_data['line_num'][i])
        lines.setdefault(key, []).append({
            'text': t,
            'left': int(page_data['left'][i]), 'top': int(page_data['top'][i]),
            'width': int(page_data['width'][i]), 'height': int(page_data['height'][i]),
            'word_num': int(wn[i]) if i < len(wn) else 0,
        })
    for k in lines:
        lines[k].sort(key=lambda w: (w['word_num'], w['left']))
    return lines


def _union_box(words):
    left = min(w['left'] for w in words)
    top = min(w['top'] for w in words)
    right = max(w['left'] + w['width'] for w in words)
    bot = max(w['top'] + w['height'] for w in words)
    return (left, top, right - left, bot - top)


def _label_boxes(lines, label):
    """Boxes of contiguous word-runs that fuzzy-match the label text (per line)."""
    if not label:
        return []
    llen = len(_alnum(label))
    hits = []
    for words in lines.values():
        nW = len(words)
        for i in range(nW):
            for j in range(i, nW):
                joined = ''.join(w['text'] for w in words[i:j + 1])
                if _similarity(joined, label) >= 0.75:
                    hits.append(_union_box(words[i:j + 1]))
                    break
                if len(_alnum(joined)) > llen + 3:
                    break
    return hits


def _nearest_label_pick(cands, lines, label):
    """Among tied candidates, pick the one geometrically nearest a label word (value sits to
    the right of / below the label → weight vertical proximity, prefer value right-of label).
    Returns the chosen candidate, or None to ABSTAIN when the label can't be found."""
    labs = _label_boxes(lines, label)
    if not labs:
        return None

    def dist(box):
        bl, bt, bw, bh = box
        bcx, bcy = bl + bw / 2.0, bt + bh / 2.0
        best = None
        for (ll, lt, lw, lh) in labs:
            lcx, lcy = ll + lw / 2.0, lt + lh / 2.0
            d = abs(bcy - lcy) * 2.0 + max(0.0, lcx - bcx) * 0.5 + abs(bcx - lcx) * 0.1
            best = d if best is None else min(best, d)
        return best
    return min(cands, key=lambda c: dist(c[1]))


def locate_value_region(page_data, garble, label=None, min_similarity=0.62, ambiguity_margin=0.08):
    """Find the garble's region on the page. Returns (left, top, w, h) in PIXELS, or None
    (ABSTAIN). Abstains on: no candidate over the similarity floor; OR a near-tie between two
    DIFFERENT lines that the label adjacency can't break. Contiguous-n-gram matching within a
    row handles the inserted-space class (OCR split one value across words)."""
    if not garble:
        return None
    lines = _group_lines(page_data)
    gl = len(_alnum(garble))
    if gl == 0:
        return None
    cands = []  # (score, box, line_key)
    for key, words in lines.items():
        nW = len(words)
        for i in range(nW):
            for j in range(i, nW):
                grp = words[i:j + 1]
                joined = ''.join(w['text'] for w in grp)
                if len(_alnum(joined)) > gl + 4:      # n-gram outgrew the target — stop extending
                    break
                s = _similarity(joined, garble)
                if s >= min_similarity:
                    cands.append((s, _union_box(grp), key))
    if not cands:
        return None
    cands.sort(key=lambda c: -c[0])
    best = cands[0]
    rivals = [c for c in cands if c[2] != best[2] and (best[0] - c[0]) <= ambiguity_margin]
    if rivals:
        if not label:
            return None                               # ambiguous, nothing to disambiguate with
        pick = _nearest_label_pick([best] + rivals, lines, label)
        return None if pick is None else pick[1]
    return best[1]


# ── orchestration ──────────────────────────────────────────────────────────────
def reread_field_value(page_images, garbled, label, val_type, fmt_entry, cache,
                       config_pattern=None, max_edits=2, located_page=None,
                       page_ok=None, i2d_fn=None, read_region_fn=None):
    """Run the bounded re-read. Returns the adopted string, or None (abstain/withhold — the
    caller keeps its byte-identical withheld dict).

    Injected callables (engine supplies real ones; tests supply stubs):
      i2d_fn(page_image)                              -> image_to_data DICT (cached per page)
      read_region_fn(page_image, box_px, val_type, verify_fn) -> best_seg or None
                                                        (crop the located region + crop-ladder it,
                                                        using verify_fn for rung selection)
      page_ok(page_index)                             -> bool; the PROVENANCE gate — only OCR'd
                                                        pages are eligible. Missing/None provenance
                                                        must resolve to False (abstain), so the
                                                        re-read never fires on born-digital text.

    `cache` is a dict shared across fields of one extract() so each page is OCR'd ONCE.
    Seam #1: the reader return is re-checked with is_adoptable (a crop-ladder returns its best
    FAILING segment when no rung passes, so non-None != adopted). Seam #2: read_region_fn crops
    the SAME page_image i2d_fn read (one instance — the engine passes the raw page image to both)."""
    if not garbled or not page_images:
        return None
    if i2d_fn is None or read_region_fn is None:
        return None

    def adoptable(seg):
        return is_adoptable(seg, fmt_entry, garbled, config_pattern=config_pattern, max_edits=max_edits)

    pages = range(len(page_images)) if located_page is None else [located_page]
    for pidx in pages:
        if pidx < 0 or pidx >= len(page_images):
            continue
        if page_ok is not None and not page_ok(pidx):    # provenance gate (born-digital -> skip)
            continue
        img = page_images[pidx]
        if pidx not in cache:
            cache[pidx] = i2d_fn(img)                     # one image_to_data pass per page per extract
        box = locate_value_region(cache[pidx], garbled, label=label)
        if box is None:
            continue
        seg = read_region_fn(img, box, val_type, adoptable)   # crop + ladder, verify_fn = adoptable
        if seg and adoptable(seg):                            # seam #1: re-apply to the return
            return str(seg).strip()
    return None
