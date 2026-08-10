"""
extraction/anchor.py
--------------------
Stage 2 extraction — spatial anchor matching.
Uses learned label positions to find field values directly in OCR text.
Faster and more accurate than LLM for known document layouts.
"""

import math
import os
import re

from PIL import Image

from extraction import registration   # pure NumPy; no cycle (registration imports nothing here)
from extraction import number_format   # region-aware amount normaliser (no cycle)


def _qualify_against_format(value, field_key, format_lookup, text_field_keys=None,
                            val_type=None, validation_patterns=None):
    """Qualify a learned-anchor value against the field's LEARNED format (the same
    doc-type-scoped shape model Stage 4.5 uses). Returns the value to commit —
    possibly TRIMMED to the learned shape (e.g. a column-bleed read reduced to the
    reference) — or None when it's inconsistent with the learned format and no
    accepted-shape substring can be recovered (so a confidently-wrong crop like
    "Bookinc" is rejected instead of committed). No lookup / no learned format /
    already-consistent value → returned unchanged. Only ever TIGHTENS for fields
    that have actually learned a format; never loosens. Lazy import avoids any
    module-load cycle.

    FREE-TEXT EXEMPTION: a free-text, non-ref field (name/company/address — the
    `text_field_keys` set, the SAME set the Stage 4.5 free-text guard uses) has a
    legitimately variable shape, so the learned-SHAPE veto must NOT withhold it HERE — it
    exists to trim column-bleed off STRUCTURED refs. Without this a clean "Beaumont Care
    Homes Ltd - <new site>" was dropped on "format" at Stage 2 before Stage 4.5's softer
    flag-not-withhold could ever run. Structured refs (NOT in text_field_keys) keep the veto.

    PRECISE-PATTERN AUTHORITY: a value that FULLY matches a field's PRECISE validation
    pattern (mac/ip — see _PRECISE_VAL_TYPES) is type-authoritative; the regex IS the
    format, so the learned digit-position SHAPE must not veto/trim it (a new device's MAC,
    or an IP with different octet lengths, just differs in shape from history). The generic
    'alphanumeric' is excluded on purpose. Only fires when the caller threads val_type +
    validation_patterns; legacy callers stay byte-identical."""
    if not value or format_lookup is None:
        return value
    if text_field_keys and field_key in text_field_keys:
        return value
    if val_type in _PRECISE_VAL_TYPES and validation_patterns:
        _pats = validation_patterns.get(val_type)
        if _pats and _pattern_coverage(str(value), _pats) >= _PATTERN_AUTHORITATIVE_MIN:
            return value
    try:
        entry = format_lookup(field_key)
    except Exception:
        return value
    if not entry:
        return value
    from extraction.format_anomaly_checker import check_value, extract_accepted_shape
    if check_value(str(value), entry) is None:
        return value
    cleaned = extract_accepted_shape(str(value), entry)
    return cleaned or None


def _digit_free_on_digit_field(value, field_key, format_lookup) -> bool:
    """True when `value` carries NO digit yet the field's learned shape is uniformly
    digit-bearing (shape_requires_digit). Used to REFUSE resurrecting a credible-but-
    learned-shape-rejected anchor read: the resurrection rule exists to keep a
    legitimately-variable CODE (a new MAC/serial — which has digits) that merely differs
    in shape from history, but it must NOT keep a digit-free word read off a neighbouring
    row (e.g. "Field" / "Booking" on a reference field whose values are all NNNN-NNNN-N).
    Lets the existing inline-harvest/relocation seat the real digit-bearing value instead.
    Data-driven and reusable; no learned shape (thin/varied history) → False (unchanged)."""
    if not value or format_lookup is None:
        return False
    if any(c.isdigit() for c in str(value)):
        return False
    try:
        entry = format_lookup(field_key)
    except Exception:
        return False
    from extraction.format_anomaly_checker import shape_requires_digit
    return shape_requires_digit(entry)


def _partial_of_uniform_shape(value, field_key, format_lookup) -> bool:
    """True when `value`'s shape is a strict contiguous SUB-RUN of a SINGLE uniform
    digit-bearing learned shape — a TRUNCATED/partial read of a structured reference
    ("849-4" = ###-# of the uniform "####-####-#"), NOT a legitimately-new code. Used
    (alongside _digit_free_on_digit_field) to REFUSE resurrecting a digit-BEARING fragment
    that a global-transform/relocate read off a NEIGHBOURING row, while leaving a genuinely-
    new full code (different group structure -> not a sub-run) untouched. Refusal leaves the
    field empty -> review, never a wrong value. INERT on multi-shape / thin / alpha-only
    history (mirrors _digit_free_on_digit_field). Data-driven and reusable across every field."""
    if not value or format_lookup is None:
        return False
    try:
        entry = format_lookup(field_key)
    except Exception:
        return False
    from extraction.format_anomaly_checker import (shape_requires_digit, shape_signature,
                                                   _shape_canonical)
    if not shape_requires_digit(entry):
        return False
    shapes = (entry or {}).get('shapes') or []
    fams = {_shape_canonical(s) for s in shapes}
    if len(fams) != 1:                       # not a single uniform shape -> don't judge
        return False
    sig = shape_signature(str(value))
    if not sig or sig in shapes:             # value already IS a confirmed shape -> not a fragment
        return False
    csig, full = _shape_canonical(sig), next(iter(fams))
    return csig != full and csig in full     # strict contiguous sub-run of the uniform shape


def _slipfix_to_shape(value, field_key, format_lookup, val_type, validation_patterns,
                      label=None, text_field_keys=None):
    """Recover a crop read that FAILED the credibility gate when it is exactly ONE known OCR-
    confusion substitution away from the field's UNIFORM learned shape — e.g. "$02" -> "S02"
    when every confirmed value is "@##" (the "$"→"S" misread). Returns the repaired value, or
    None (leave it rejected). Precision-first: fires ONLY when the field is structured with a
    single uniform learned shape, exactly ONE position violates that shape, the offending char
    has a KNOWN-confusion replacement for the EXPECTED class, and the result then matches BOTH
    the shape AND the field regex. Reusable across every code field; INERT on thin/varied/free-
    text history. (reggie-designed. The confusion maps mirror review/renderer.js _OCR_PAIRS.)"""
    if not value or format_lookup is None:
        return None
    if text_field_keys and field_key in text_field_keys:
        return None
    try:
        entry = format_lookup(field_key)
    except Exception:
        return None
    if not entry:
        return None
    from extraction.format_anomaly_checker import shape_signature, _shape_canonical
    from extraction.ocr_corrector import SYMBOL_TO_UPPER, DIGIT_TO_UPPER, LETTER_TO_DIGIT
    shapes = (entry or {}).get('shapes') or []
    if not shapes or len({_shape_canonical(s) for s in shapes}) != 1:
        return None
    v = str(value)
    for s in shapes:
        if len(s) != len(v):
            continue
        bad = []
        for i, (cv, cs) in enumerate(zip(v, s)):
            if cs == '@':
                if not cv.isalpha(): bad.append(i)
            elif cs == '#':
                if not cv.isdigit(): bad.append(i)
            elif cv != cs:           # separator literal
                bad.append(i)
        if len(bad) != 1:
            continue
        i = bad[0]; cv = v[i]; cs = s[i]
        repl = None
        if cs == '@':                # expected a letter
            if not cv.isalnum():     # a symbol where a letter belongs (the "$"→"S" class)
                repl = SYMBOL_TO_UPPER.get(cv)
            elif cv.isdigit():
                repl = DIGIT_TO_UPPER.get(cv)
            elif cv.islower():
                repl = cv.upper()
        elif cs == '#':              # expected a digit
            if cv.isalpha():
                repl = LETTER_TO_DIGIT.get(cv)
        if not repl:
            continue
        candidate = v[:i] + repl + v[i + 1:]
        if shape_signature(candidate) in shapes \
                and _crop_is_credible(candidate, val_type, validation_patterns, label) \
                and _qualify_against_format(candidate, field_key, format_lookup,
                                            text_field_keys, val_type, validation_patterns):
            return candidate
    return None


# Single-token code/ref types with NO legitimate internal whitespace — a SPACE in such a read
# means OCR CLIP-DEBRIS (a clipped label tail / a hallucinated separator at the crop edge), never
# part of the value. EXCLUDES types whose patterns embed \s (job_reference / vat_gb / postcode_uk),
# date/currency (substring/salvage path, never coverage-gated), mac/ip (precise), and free text.
_RECOVERABLE_TOKEN_TYPES = frozenset({"alphanumeric", "reference_code"})
_MAX_DEBRIS_TOKEN_LEN = 2      # a clipped label tail / stray separator is 1-2 chars ("-R", ". =")
_MAX_DEBRIS_CHARS     = 3      # total non-space debris chars tolerated


_CHARSET_DEBRIS_MIN_SUPPORT = 10   # mirrors the noise-profile 10+ (learning.js) + trust W=10


def _charset_excludes(token, charset) -> bool:
    """True when EVERY character of `token` is impossible under the scope's learned charset —
    letters need has_letter False, digits need has_digit False, anything else must be absent
    from the learned literals. One in-charset char ⇒ False (could be a split-off value piece)."""
    for c in token:
        if c.isalpha():
            if charset.get('has_letter'):
                return False
        elif c.isdigit():
            if charset.get('has_digit'):
                return False
        elif c in (charset.get('literals') or ()):
            return False
    return True


def _alnum_debris_admissible(token, side, field_key, format_lookup, edge_contact) -> bool:
    """ANCHOR_CHARSET_DEBRIS (Oracle SIGN-OFF-W/COND 2026-07-27): may this bare-ALNUM ≤2-char
    token be treated as clip-debris? ALL of (fail toward refuse → today's reject → review):
      * kill switch on;
      * the scope's learned-format entry exists with support ≥ 10 confirms and a charset
        descriptor derived from ALL raw distinct confirmed values (UNANIMITY — one lettered
        confirm anywhere puts letters in-charset and permanently refuses letter debris for the
        scope; Oracle ruling over dominance: a real "F-14266"-style prefix must never be
        stripped, the abstain cost is only the status-quo review);
      * has_space False (a space-bearing history makes token-level recovery unsafe);
      * every char of the token outside the charset (a mixed "F3" on a digit scope has an
        in-charset char → refuse the WHOLE recovery — it could be a split-off value piece);
      * EDGE-CONTACT on the token's side (iris/Oracle C3): clipped-glyph debris abuts the crop
        boundary by physical necessity; an INTERIOR letter token is real page content (format
        drift) and must keep refusing. No edge metadata ⇒ refuse."""
    if os.environ.get("ANCHOR_CHARSET_DEBRIS", "1") == "0":
        return False
    if format_lookup is None or not field_key:
        return False
    try:
        entry = format_lookup(field_key) or {}
    except Exception:
        return False
    if int(entry.get('support') or 0) < _CHARSET_DEBRIS_MIN_SUPPORT:
        return False
    charset = entry.get('charset')
    if not charset or charset.get('has_space'):
        return False
    if not _charset_excludes(token, charset):
        return False
    if not edge_contact:
        return False
    return bool(edge_contact[0] if side == 'left' else edge_contact[1])


def _recover_clean_token(value, val_type, validation_patterns, label=None,
                         field_key=None, format_lookup=None, edge_contact=None,
                         allow_alnum_debris=False, debris_out=None):
    """Recover the clean value from an anchor read that FAILED the credibility/coverage gate only
    because it is ONE clean pattern-matching token wrapped in SHORT clip-debris
    (". = 317437" / "-R 317437"). Regex-only base arm (no learned history → works on document #1).
    PRECISION-FIRST: returns the token ONLY when EXACTLY ONE whitespace-token fully matches the
    field pattern AND every other token is clip-debris: len<=2 AND EITHER carries a non-alphanumeric
    char (the original arm) OR — ANCHOR_CHARSET_DEBRIS, Oracle-signed 2026-07-27 — is a bare-ALNUM
    token the scope's confirmed history proves impossible (see _alnum_debris_admissible: charset
    unanimity, support ≥10, edge-contact, rigid site only via allow_alnum_debris). That arm exists
    because a caption glyph clipped by the crop pad OCRs as a LETTER ("#" → "F 33504" — the
    SuperStore 61-doc class) which the original refusal routed to a permanent 69-cap hold. A
    bare-alnum fragment WITHOUT that evidence (the leading "2" in "2 317437", a lone "R") is still
    REFUSED — it could be a space-split part of the real value. A multi-value read ("Total 250.00
    317437", a real drift) is refused (not exactly one value token). Charset-stripped tokens are
    reported via debris_out['alnum'] = [(token, side)] so the caller can run the vector-refutation
    check (Oracle C4). The caller commits the recovered value FLAGGED + conf-capped (or the
    Oracle-gated confident tiers), mirroring _slipfix_to_shape — never silently.
    reggie-designed; guarded by tests/test_recover_clean_token.py."""
    if not value or val_type not in _RECOVERABLE_TOKEN_TYPES:
        return None
    pats = (validation_patterns or {}).get(val_type)
    if not pats:
        return None
    tokens = str(value).split()
    if len(tokens) < 2:                                   # single token already judged by credibility
        return None
    matches = [any(re.fullmatch(p, t, re.IGNORECASE) for p in pats) for t in tokens]
    value_idxs = [i for i, m in enumerate(matches) if m]
    if len(value_idxs) != 1:                              # zero or ambiguous → refuse
        return None
    vi = value_idxs[0]
    debris_chars, alnum_debris = 0, []
    for i, t in enumerate(tokens):
        if i == vi:
            continue
        if len(t) > _MAX_DEBRIS_TOKEN_LEN:
            return None                                   # a real word → refuse
        if not any(not c.isalnum() for c in t):
            # bare-alnum fragment: refuse UNLESS the learned-charset arm admits it
            side = 'left' if i < vi else 'right'
            if not (allow_alnum_debris
                    and _alnum_debris_admissible(t, side, field_key, format_lookup, edge_contact)):
                return None
            alnum_debris.append((t, side))
        debris_chars += len(t)
        if debris_chars > _MAX_DEBRIS_CHARS:
            return None
    token = tokens[vi]
    if not _crop_is_credible(token, val_type, validation_patterns, label):
        return None
    if debris_out is not None and alnum_debris:
        debris_out['alnum'] = alnum_debris
    return token


def _matches_learned_shape(value, field_key, format_lookup) -> bool:
    """True when `value`'s shape signature is one the scope has CONFIRMED for this field — the
    corroboration that lets a debris-recovered read commit CONFIDENT (drop the 'please verify' flag)
    instead of recover-and-flag. The Oracle's condition 3c: an OFF-shape read (a systematic misread
    that garbled the value) keeps the flag. Conservative — thin/free-text history (no learned shapes)
    → False → keep the flag. Reuses format_anomaly_checker.shape_signature (the same shapes
    _slipfix_to_shape trusts). Pure aside from the lazy import."""
    if not value or format_lookup is None:
        return False
    try:
        entry = format_lookup(field_key) or {}
    except Exception:
        return False
    shapes = entry.get('shapes') or []
    if not shapes:
        return False
    try:
        # CLASS-level match: the stored shapes are length-agnostic ('#' = digits, any length; the
        # model collapses run-lengths), while shape_signature produces the length-specific '######'.
        # Fold each digit/letter RUN to a single char (keeping SEPARATORS, so structure like
        # '#-#-#' is still distinguished) so '######' matches the learned '#'. A garbled/off-class
        # read ('@@###', letters where digits are learned) does NOT match → keeps the flag.
        from extraction.format_anomaly_checker import shape_signature
        cls = lambda sh: re.sub(r'([#@])\1*', r'\1', sh or '')
        return cls(shape_signature(str(value))) in {cls(s) for s in shapes}
    except Exception:
        return False


def _exact_text_corroborates(value, anchor, y_norm, page_text_lines) -> bool:
    """Independent exact-text corroboration for a debris-recovered read (Oracle
    condition #4). The recovered token came from an IMAGE-crop OCR (debris-prone,
    hence the conservative confidence). `page_text_lines` is the born-digital VECTOR
    text layer — a FULLY INDEPENDENT source (it is NEVER OCR: process_docs only
    populates it from born_digital.page_lines on a page that passes the text-layer
    gate, and leaves it None for scanned/image-only pages). So its mere presence is
    the born-digital provenance signal, and this can NEVER fire on a scanned doc
    (where the full-page read and the crop are the SAME pixels — correlated, not
    independent). Returns True when that exact vector text carries the SAME token as
    a BOUNDED whole word on the value's OWN taught row (within ~1.5 label-heights of
    y_norm) — i.e. the value sits at its own taught position in the independent text,
    not merely somewhere on the page. That double confirmation (crop recovery + exact
    vector text at the taught row) lets the read clear the auto-file floor; a scanned
    debris-recovery keeps the one-glance review checkpoint (page_text_lines None →
    False → capped)."""
    if not page_text_lines or value is None:
        return False
    cv = str(value).strip()
    if not cv:
        return False
    try:
        pat = re.compile(r'(?<![0-9A-Za-z])' + re.escape(cv) + r'(?![0-9A-Za-z])')
    except re.error:
        return False
    h  = float(anchor.get("h_norm") or 0.0) or 0.02
    y0 = float(y_norm or 0.0) + h / 2.0            # taught value-box CENTRE
    band = max(h * 1.5, 0.03)
    for ln in page_text_lines:
        try:
            lcy = float(ln.get("y_norm", 0.0)) + float(ln.get("h_norm", 0.0)) / 2.0
        except Exception:
            continue
        if abs(lcy - y0) > band:
            continue
        if pat.search(ln.get("text", "") or ""):
            return True
    return False


def _vector_refutes_strip(value, alnum_debris, anchor, y_norm, page_text_lines) -> bool:
    """Vector-REFUTATION of a charset-debris strip (Oracle C4, 2026-07-27). The born-digital text
    layer corroborates that the REMAINDER is printed at the taught row — but it can also positively
    prove the stripped token was REAL INK: when the printed alnum run adjacent to the matched value
    on the stripped side equals the stripped debris (case-insensitive, ≤2 non-alnum separator chars
    tolerated — covers "F 14266" and "F-14266"), the strip destroyed genuine content. The caller
    then caps ≤70 + the verify note (never noteless, never tier 3). For the target class the
    adjacent ink is "#" (non-alnum) ≠ "F" → no refutation. Same row-band frame as
    _exact_text_corroborates; None/scanned page_text_lines ⇒ False (tier 3 can't fire there anyway)."""
    if not page_text_lines or not alnum_debris:
        return False
    cv = str(value or "").strip()
    if not cv:
        return False
    try:
        pat = re.compile(r'(?<![0-9A-Za-z])' + re.escape(cv) + r'(?![0-9A-Za-z])')
    except re.error:
        return False
    h  = float(anchor.get("h_norm") or 0.0) or 0.02
    y0 = float(y_norm or 0.0) + h / 2.0
    band = max(h * 1.5, 0.03)
    for ln in page_text_lines:
        try:
            lcy = float(ln.get("y_norm", 0.0)) + float(ln.get("h_norm", 0.0)) / 2.0
        except Exception:
            continue
        if abs(lcy - y0) > band:
            continue
        text = ln.get("text", "") or ""
        for m in pat.finditer(text):
            for tok, side in alnum_debris:
                if side == 'left':
                    seg = re.sub(r'[^0-9A-Za-z]{0,2}$', '', text[:m.start()])
                    run = re.search(r'[0-9A-Za-z]{1,2}$', seg)
                else:
                    seg = re.sub(r'^[^0-9A-Za-z]{0,2}', '', text[m.end():])
                    run = re.match(r'[0-9A-Za-z]{1,2}', seg)
                if run and run.group(0).casefold() == str(tok).casefold():
                    return True
    return False


def _eval_field_group(group_anchors, field_patterns, format_lookup, identity_labels,
                      line_cache, lines, multiline_lookup, on_reject, page0,
                      page_text_lines, page_transform, slice_capture, supplier_name,
                      text_field_keys, validation_patterns):
    """Evaluate ONE field_key GROUP: run its anchors in _filter_anchors priority order,
    committing the first value that qualifies (the `if field_key in results: continue`
    short-circuit, now per-group). Move-only extraction of the former extract_with_anchors
    per-anchor loop (C Stage 2a, 2026-07-17) — the body below is verbatim. Fields are
    independent (every results access is this group's own key), so groups merge disjoint
    keys; Option C parallelises the groups across cores (DS_OCR_PARALLEL_FIELDS)."""
    results = {}
    # Label-relocation caption guard (group-level): a RE-READ that lands on a page CAPTION word nulls
    # the value; if nothing else fills the field, an empty+note row is emitted after the loop so the
    # doc routes to review (never a silent blank auto-file). See the guard + after-loop emit. Oracle C2.
    _caption_detected, _caption_field, _caption_note = False, None, None
    # Dev-trace only: every reject below is raised INSIDE one anchor's iteration, so the
    # caption that rung was answering is `anchor["anchor_label"]` — known here and at none
    # of the ~20 raise sites. Rebind `on_reject` per iteration FROM THE ORIGINAL (never from
    # the previous wrapper, which would nest one closure per anchor) so the raise sites keep
    # their 4-argument call unchanged. None stays None: off-trace this loop is inert.
    _on_reject_orig = on_reject
    for anchor in group_anchors:
        field_key   = anchor["field_key"]
        label       = anchor["anchor_label"].lower().strip()
        if _on_reject_orig is not None:
            on_reject = (lambda fk, st, v, r, _f=_on_reject_orig, _c=anchor.get("anchor_label"):
                         _f(fk, st, v, r, _c))
        direction   = anchor["direction"]
        usage_count = anchor.get("usage_count", 1)
        conf_factor = anchor.get("confidence", 0.5)
        x_norm      = anchor.get("x_norm") or 0.0
        y_norm      = anchor.get("y_norm") or 0.0

        if field_key in results:
            continue  # already found by higher-priority anchor

        value    = None
        method   = "anchor"
        val_type = (field_patterns or {}).get(field_key, {}).get("validation")
        # OCR quality of the crop that produced the WINNING value (None for the
        # text-fallback / inline paths, which don't crop+re-OCR). Threaded into the
        # confidence so a garbled read scores low instead of riding usage_count.
        ocr_conf = None
        ocr_min  = None

        # Multi-line continuation descriptor (Phase 1): present ONLY when this field has a
        # multiline_continue rule AND it's a free-text field (the val_type gate already
        # excludes structured/date/currency; the ref-key check excludes a text-typed ref).
        # None → every read is single-line / byte-identical.
        continuation = None
        if (multiline_lookup is not None and val_type in (None, "text", "multiline_text")
                and not _is_ref_like_key(field_key)):
            _ml = multiline_lookup(field_key)
            if _ml:
                _fe = format_lookup(field_key) if format_lookup else None
                continuation = {"pattern_chars": _ml.get("pattern_chars"),
                                "name_lex": (_fe or {}).get("name_lexicon"),
                                "fmt_entry": _fe}

        # "Did this crop read a value we'd actually commit?" — the same
        # credibility + learned-format gate the merge below applies. Passed into
        # the crop reader so a degraded TEXT line that fails it triggers the
        # heavier denoise/adaptive re-read (text fields only); a passing read
        # short-circuits with zero extra work.
        def _verify(t, _vt=val_type, _fk=field_key, _lbl=label):
            return (bool(t)
                    and _crop_is_credible(t, _vt, validation_patterns, _lbl)
                    and bool(_qualify_against_format(t, _fk, format_lookup, text_field_keys,
                                                     _vt, validation_patterns)))

        # SKIP THE RIGID CROP for a currency anchor with a real label + stored offset: its
        # value lives in a VARIABLE totals block (a Discount line shifts Total down), so the
        # absolute box misses on most docs — reading garbage ("Oo") or a valid-but-WRONG
        # neighbouring row ("$111.94" from Shipping). The "Total:" label is the reliable
        # anchor, so go STRAIGHT to the label-based read: value stays None here, the label-lock
        # below no-ops (needs a value), and the drift-recovery rung relocates + reads beside the
        # located label (same credibility + format gates). Saves the always-wasted rigid OCR and
        # the trace no longer shows a scary "anchor_crop rejected". Free-text keeps its rigid-
        # first path (its multi-line completeness guard compares to the rigid). If the label
        # genuinely can't be found the field is left for review — better than a wrong rigid read.
        _skip_rigid = (val_type == "currency"
                       and (anchor.get("anchor_label") or "").strip()
                       and anchor.get("offset_dy_norm") is not None
                       and page0 is not None)

        # CROSS-SUPPLIER ABSOLUTE-READ GATE (007① applied BEFORE the crop; Oracle-scoped, 2026-07-09).
        # A NAMED cross-supplier AUTHORITATIVE anchor's ABSOLUTE reads — the rigid crop and the
        # registration map of the taught box — are the ones that drift onto a wrong region of a
        # DIFFERENT supplier's layout (Anconia's top-right box reading Cloud VPS's mid-page cell →
        # "OO"). Suppress those absolute attempts unless the caption is at the TAUGHT position (same
        # layout). This is a SUBSET of what the post-crop 007① gate already concludes for the rigid
        # read (kept below as defence-in-depth), moved earlier so the wrong crop isn't attempted at
        # all AND — the residual the post-crop gate missed — so a credible-but-wrong cross-supplier
        # REGISTRATION read can't commit. The LABEL-RELATIVE reads (inline / drift-relocate / text
        # fallback) are NOT gated: they read beside the caption LOCATED on THIS doc and self-validate,
        # which is how a genuine shared layout at a SHIFTED position still fills (per the Oracle — do
        # not trade a wrong value for a mysterious empty field). Reuses line_cache: one cheap locate,
        # and it SAVES the heavy rigid + registration crop OCR when the skip fires. Passive anchors are
        # untouched (authoritative-only, this slice).
        _xsup_absolute_ok = True
        _plc = None   # the cross-supplier placement locate, reused by the left clamp below
        if (_named_cross_supplier(anchor, supplier_name)
                and anchor.get("last_authoritative_at")
                and (anchor.get("anchor_label") or "").strip() and page0 is not None):
            _plc = _locate_for_relocation(
                page0, (anchor.get("anchor_label") or "").strip(), direction,
                (x_norm, y_norm, anchor.get("w_norm") or 0.0, anchor.get("h_norm") or 0.0),
                page_text_lines, line_cache=line_cache)
            _xsup_absolute_ok = _located_at_taught_position(
                _plc, x_norm, y_norm, anchor.get("offset_dx_norm"), anchor.get("offset_dy_norm"))
            if not _xsup_absolute_ok and on_reject:
                on_reject(field_key, "anchor_crop", None, "cross_supplier_placement_skip")

        # ── Primary: image crop + re-OCR (accurate, avoids column bleed) ──────
        if not _skip_rigid and _xsup_absolute_ok and x_norm > 0 and y_norm > 0 and page0 is not None:
            w_norm   = anchor.get("w_norm") or 0.0
            h_norm   = anchor.get("h_norm") or 0.0
            _cap = ((lambda c: slice_capture(field_key, "anchor_crop", 0,
                       (x_norm, y_norm, w_norm, h_norm), c, "target")) if slice_capture else None)
            _m = {}
            # ANCHOR_LABEL_LEFT_CLAMP at the RIGID site (C2 full gate): the rigid crop reads
            # the TAUGHT box, so a LOCATED-frame boundary is only coherent when the located
            # caption sits AT the taught position (frames coincide) — a drifted page keeps
            # the rigid read unclamped (the drift rung's located-frame crop clamps instead).
            # The locate is paid ONLY when the switch is armed and the preconditions hold
            # (OFF ⇒ byte-identical, no extra OCR); line_cache makes the later :1391
            # authoritative-locate verification a cache hit, not a second page OCR (C7).
            _lclamp = None
            _rlim = None
            # Arm the located frame for EITHER the left clamp OR the right grow (C-frame + arming-OR,
            # Oracle 2026-08-02): both boundaries are only coherent when the located caption sits AT
            # the taught position (frames coincide), so a drifted page keeps the rigid read
            # unclamped/ungrown. Extend the arming to RIGHT_GROW so flipping it alone still computes
            # the locate (else the right grow is silently inert on the rigid rung).
            _want_lclamp = os.environ.get("ANCHOR_LABEL_LEFT_CLAMP", "0") != "0"
            _want_rgrow  = os.environ.get("ANCHOR_VALUE_RIGHT_GROW", "0") != "0"
            if ((_want_lclamp or _want_rgrow)
                    and direction == "right" and val_type in _LEFT_CLAMP_TYPES
                    and anchor.get("last_authoritative_at")
                    and (anchor.get("anchor_label") or "").strip()):
                _cloc = _plc if _plc is not None else _locate_for_relocation(
                    page0, (anchor.get("anchor_label") or "").strip(), direction,
                    (x_norm, y_norm, w_norm, h_norm), page_text_lines, line_cache=line_cache)
                if _cloc and _located_at_taught_position(
                        _cloc, x_norm, y_norm,
                        anchor.get("offset_dx_norm"), anchor.get("offset_dy_norm")):
                    if _want_lclamp:
                        _lclamp = _label_left_limit(_cloc, anchor, direction, val_type)
                    if _want_rgrow:
                        _rlim = _label_right_limit(field_key, _cloc, anchor, direction, val_type, validation_patterns)
            crop_value = _crop_and_ocr(page0, x_norm, y_norm, w_norm, h_norm, val_type, capture=_cap, verify_fn=_verify, meta=_m, continuation=continuation, max_w_norm=anchor.get("max_w_norm"), left_limit_norm=_lclamp, right_limit_norm=_rlim)
            # CAPTION-PREFIX STRIP (kill ANCHOR_CAPTION_PREFIX_STRIP, DEFAULT OFF => byte-identical).
            # A rigid crop can capture its own caption ("Date 22/07/2026", "No. DN-36457"), which then
            # fails the credibility / learned-format gate below (the correct value is DISCARDED) OR — on a
            # cold supplier with no learned format — commits DIRTY into the filename ("...Date 22-07-2026..").
            # Recover the value by stripping the field's own taught label prefix. RECOVERY not pre-emption
            # (Oracle SEAM B): keep the ORIGINAL whenever it already qualifies against real history; use the
            # stripped value only when the original would be REJECTED, or when there is NO learned format at
            # all (the cold-supplier dirty-commit). Structured non-currency only (Oracle SEAM A). The stripped
            # value still faces the UNCHANGED gates below and commits as a plain anchor_crop, so a disagreeing
            # Stage-1 keyword read still flags/holds it (the strip is never authoritative).
            if (crop_value and val_type in _CAPTION_STRIP_TYPES
                    and os.environ.get("ANCHOR_CAPTION_PREFIX_STRIP", "0") != "0"):
                _stripped = _strip_caption_prefix(crop_value, label, val_type, validation_patterns)
                if _stripped != crop_value:
                    _orig_ok = bool(_crop_is_credible(crop_value, val_type, validation_patterns, label)
                                    and _qualify_against_format(crop_value, field_key, format_lookup,
                                                                text_field_keys, val_type, validation_patterns))
                    _no_history = True
                    if format_lookup is not None:
                        try: _no_history = not format_lookup(field_key)
                        except Exception: _no_history = True
                    if (not _orig_ok) or _no_history:
                        crop_value = _stripped
            # A fixed crop is positionally rigid: when an upstream line wraps or
            # the block shifts on a sibling layout, the box can land off-target
            # and return a NON-EMPTY but wrong value (e.g. ">alifornia" from the
            # line below the name). Keep the crop only when it is credible for
            # this field; otherwise leave value=None so the anchor_label +
            # direction search below runs and gets a chance to relocate it.
            if crop_value and not _crop_is_credible(crop_value, val_type, validation_patterns, label):
                # SLIP-FIX: recover a read that's ONE known OCR-confusion substitution from the
                # field's uniform learned shape ("$02"->"S02") instead of discarding it. Recover-
                # and-flag — the result block caps conf <=70 + notes it for review.
                _slip = _slipfix_to_shape(crop_value, field_key, format_lookup, val_type,
                                          validation_patterns, label, text_field_keys)
                if _slip:
                    value, method = _slip, "anchor_crop_slipfix"
                    ocr_conf, ocr_min = _m.get('conf'), _m.get('min_conf')
                else:
                    # DEBRIS RECOVERY: a clean single token wrapped in short clip-debris
                    # (". = 317437" → "317437") — recover-and-flag, else reject to review.
                    # The RIGID site additionally arms the learned-charset bare-alnum arm
                    # (ANCHOR_CHARSET_DEBRIS — the clipped-"#"-reads-as-"F" class); the
                    # registration fallback site keeps the original refusal (Oracle C3).
                    _rec_meta = {}
                    _rec = _recover_clean_token(crop_value, val_type, validation_patterns, label,
                                                field_key=field_key, format_lookup=format_lookup,
                                                edge_contact=_m.get('edge_contact'),
                                                allow_alnum_debris=True, debris_out=_rec_meta)
                    if _rec:
                        value, method = _rec, "anchor_crop_recovered"
                        ocr_conf, ocr_min = _m.get('conf'), _m.get('min_conf')
                        _rec_alnum_debris = _rec_meta.get('alnum') or []
                    elif on_reject:
                        on_reject(field_key, "anchor_crop", crop_value, "not_credible")
            elif crop_value:
                # Also qualify against the learned format: a fixed crop that drifted
                # onto the wrong row reads a NON-EMPTY, credible-looking but wrong
                # value ("Bookinc" where the reference is shaped "####-####-#").
                # Reject/trim it so value stays None and the label search below gets
                # a chance to relocate the right value, instead of committing the
                # garbage at high confidence.
                qualified = _qualify_against_format(crop_value, field_key, format_lookup,
                                                    text_field_keys, val_type, validation_patterns)
                if qualified:
                    value  = qualified
                    method = "anchor_crop"
                    ocr_conf, ocr_min = _m.get('conf'), _m.get('min_conf')
                elif on_reject:
                    on_reject(field_key, "anchor_crop", crop_value, "format")

        # ── LABEL LOCK (labelled free-text): the value FOLLOWS its located label ──
        # The operator's model: if the anchor LABEL is found on the page, the value sits at
        # located-label + the stored offset — full stop, no "did it drift far enough" gate.
        # A rigid crop reads ABSOLUTE coordinates, so on a variable-layout doc (rows shift)
        # it lands on a NEIGHBOURING row and reads a plausible free-text word that passes the
        # loose credibility gate — committing the wrong row at high confidence while the
        # label sits one row away. So whenever the label LOCATES (real label + stored
        # offset), re-read the value beside the LOCATED label and PREFER it — but ONLY when
        # that relocated read is itself credible AND actually DIFFERS from the rigid read.
        # On a clean page the located label is at its learned spot, so located-label + offset
        # ≈ the rigid box → the same value → no replacement → byte-identical. This replaces
        # the old _value_drifted_from_box THRESHOLD (which could miss a sub-threshold one-row
        # drift): the value now locks to the label, it isn't gated on a drift magnitude.
        # Free-text AND CURRENCY: free-text has a loose gate, but a CURRENCY value in a
        # stacked totals block is the OTHER case where "regex-valid" doesn't mean "right
        # row" — Subtotal/Discount/Shipping/Total are ALL valid currency, so a rigid crop
        # that drifts one row (a Discount line pushed Total down) reads e.g. the Shipping
        # "$111.94" and PASSES the currency gate, committing the wrong total while the
        # "Total:" label sits a row below. So currency locks to its located label too;
        # date/ref stay pattern-trusted (their neighbours are rarely same-type + they carry
        # their own digit-parity/partial-shape guards on the later rungs). Needs a non-null
        # offset (legacy rows untouched); reuses line_cache so a clean on-row read pays one locate.
        # Layer-A note slot (007+gary, 2026-07-10): SEPARATE from _xcheck_note — the
        # crosscheck block can later FLIP the value, and this note describes the KEPT-RIGID
        # (or junk-relocate) case only. Applied at the result build when no other note landed.
        _relocate_guard_note = None
        _name_guard_junk_note = False   # True ONLY for the :586 clean-rigid-vs-junk-sibling note ->
                                        # marks the result for engine.NAME_GUARD_KEYWORD_CLEAR
        _caption_bleed = False   # fix #2: the relocate read the field's OWN caption (landed on the label)
        _read_box = None         # picker: the winning read's VALUE box (top-left norm) for name candidates
        _rec_alnum_debris = []   # charset-debris strips from THIS anchor's rigid recovery (Oracle C4 refutation)
        if value and val_type in (None, "text", "multiline_text", "currency") \
                and (anchor.get("anchor_label") or "").strip() \
                and anchor.get("offset_dy_norm") is not None and page0 is not None:
            try:
                _dh = anchor.get("h_norm") or 0.0
                _dw = anchor.get("w_norm") or 0.0
                # VALUE-AGREEMENT: when the rigid crop already read a STRICTLY-CREDIBLE
                # value at the taught box, pass it as confirm_value so the locate prefers
                # the label occurrence whose line CARRIES that value (the real row, even if
                # OCR garbled its "Item"→"ttem" and dropped its score) over a higher-scoring
                # section header ("Item Information") whose neighbour is a different word.
                # If NO occurrence carries the value (a genuinely DRIFTED rigid read), the
                # locate is unchanged and relocation still fixes the drift.
                _cv = value if _strict_credible(value, val_type, validation_patterns, ocr_conf=ocr_conf) else None
                _dloc = _locate_for_relocation(page0, anchor["anchor_label"], direction,
                                               (x_norm, y_norm, _dw, _dh), page_text_lines,
                                               line_cache=line_cache, confirm_value=_cv)
                # (C) POSITION VETO on the label-lock locate (007+Oracle 2026-07-14): the page-wide
                # fallback in _locate_for_relocation can find a WRONG "Customer" occurrence; the drift
                # rung already verifies the located caption sits at the taught position but THIS rung did
                # not — a mis-locate would seat the caption-exclusion clamp (P) / relocate crop wrong.
                # Verify with the SAME loose tolerances + the offset-present precondition (a legacy
                # no-offset anchor is NEVER vetoed → byte-identical for those).
                _llodx, _llody = anchor.get("offset_dx_norm"), anchor.get("offset_dy_norm")
                if _dloc and (_llodx is not None and _llody is not None and (_llodx or _llody)) \
                        and not _located_at_taught_position(_dloc, x_norm, y_norm, _llodx, _llody,
                                                            tol_x=_RELOC_TOL_X, tol_y=_RELOC_TOL_Y):
                    if on_reject:
                        on_reject(field_key, "anchor_relocate", (_dloc or {}).get("matched_text"),
                                  "label_off_taught_position")
                    _dloc = None
                _dlb = (_dloc or {}).get("label_box")
                if _dlb:   # label LOCATED -> lock the value to it (no drift threshold)
                    _dcand = None
                    _drelo = None      # slice B: pre-bound — the inline branch below leaves it unset,
                    _dinline = False   # and the commit block read it (NameError, swallowed at :598)
                    _dband_reject = False
                    # Part A (007, 2026-07-14): capture the relocate crop's measured word
                    # confidence so the field-conf cap (~1057) + the engine Tier-A OCR gate
                    # aren't BLIND to a garbled clip (this rung uniquely NULLED it — the
                    # outlier vs the sibling relocate rungs at 839/902 which already keep it).
                    _dm = {}
                    # 1) inline harvest off the located label's line (value shares the row)
                    _div = (_dloc.get("inline_value") or "").strip()
                    # Door 1 of 2: the harvested value must sit at the TAUGHT offset from the located
                    # label, else it is another column's text sharing the OCR row (see
                    # _inline_at_taught_offset). Dropping it falls through to the crop read below,
                    # which is seated at that same taught offset.
                    if _div and not _inline_at_taught_offset(
                            _dloc, direction, (x_norm, y_norm, _dw, _dh),
                            (anchor.get("offset_dx_norm"), anchor.get("offset_dy_norm"))):
                        if on_reject:
                            on_reject(field_key, "anchor_inline", _div, "inline_off_taught_position")
                        _div = ""
                    if _div:
                        _dc = _clean_text_fallback(_div, val_type, validation_patterns) or clean_crop_segment(_div, val_type)
                        if _dc and val_type in (None, "text", "multiline_text"):
                            from extraction.value_quality import strip_name_edges
                            _dc = strip_name_edges(_dc)   # name edge-trim would eat a currency "$"
                        if _dc and not _name_field_code_reject(_dc, field_key) \
                                and _crop_is_credible(_dc, val_type, validation_patterns, label) \
                                and _qualify_against_format(_dc, field_key, format_lookup, text_field_keys):
                            _dcand = _dc
                            _dinline = True
                    # 2) else re-read a crop seated beside the LOCATED label
                    if not _dcand:
                        _drelo = _place_from_located(_dloc, direction, (x_norm, y_norm, _dw, _dh),
                                     offset=(anchor.get("offset_dx_norm"), anchor.get("offset_dy_norm")))
                        if _drelo:
                            _drelo = _widen_relocated_crop(_drelo, val_type)
                            _tl = _caption_top_limit(_dlb, direction, _drelo)   # (P) exclude the located caption band
                            # Left clamp + right grow (C4): this rung's types (free-text/currency) are
                            # DISJOINT from _LEFT_CLAMP_TYPES / the ref-like|date right-grow scope today, so
                            # both helpers return None here — passed anyway so a future type-set widening
                            # can't silently leave this site unclamped/ungrown (rung-discipline pin).
                            _drv = _crop_and_ocr(page0, _drelo[0], _drelo[1], _drelo[2], _drelo[3],
                                                 val_type, verify_fn=_verify, meta=_dm, continuation=continuation,
                                                 top_limit_norm=_tl, max_w_norm=anchor.get("max_w_norm"),
                                                 left_limit_norm=_label_left_limit(_dloc, anchor, direction, val_type),
                                                 right_limit_norm=_label_right_limit(field_key, _dloc, anchor, direction, val_type, validation_patterns))
                            if _drv and not _name_field_code_reject(_drv, field_key) \
                                    and _crop_is_credible(_drv, val_type, validation_patterns, label):
                                _dq = _qualify_against_format(_drv, field_key, format_lookup, text_field_keys)
                                # (C) COMPOSED CAPTION-BAND REJECT: the read is a garbled caption AND
                                # the window that produced it still overlaps the located caption band
                                # -> it is the LABEL, not the value. Keep the rigid read; never commit.
                                if _dq and _is_caption_band_read(_dq, anchor.get("anchor_label"), field_key,
                                                                _dlb, _drelo, val_type, page0.size, _tl):
                                    _dband_reject = True
                                    if on_reject:
                                        on_reject(field_key, "anchor_crop_relocated", _dq, "caption_band_read")
                                elif _dq:
                                    _dcand = _dq
                    if _dcand and _dcand.strip().lower() != (value or "").strip().lower():
                        _rv, _dv = (value or "").strip(), _dcand.strip()
                        # Don't replace a MORE-COMPLETE rigid read with a TRUNCATED relocate:
                        # the multi-line case where the rigid joined "…Ltd - Jordanstown" but the
                        # label-lock relocate got only "…Ltd -". A genuinely DIFFERENT relocate
                        # (the rigid drifted to a wrong row) does NOT prefix-match the rigid, so it
                        # still wins — preserving the drift fix this lock exists for.
                        if _rv.lower().startswith(_dv.lower()) and len(_rv) > len(_dv):
                            pass   # rigid is the relocate value + a continuation — keep it
                        elif _strict_credible(value, val_type, validation_patterns, ocr_conf=ocr_conf) \
                                and _digit_free_on_digit_field(_dcand, field_key, format_lookup) \
                                and not _digit_free_on_digit_field(value, field_key, format_lookup):
                            # DEFENSE-IN-DEPTH backstop (reggie): even when the label
                            # locates unambiguously, a digit-free WORD ("Information")
                            # must not displace a strictly-credible, code-shaped rigid
                            # read ("1102V03NL1") on a field whose confirmed history is
                            # UNIFORMLY digit-bearing. Inert unless that shape is learned,
                            # so variable free-text (a drifted NAME) and currency drift
                            # fixes are untouched. Complements the ambiguous-label guard.
                            pass   # keep the rigid read
                        elif (val_type in (None, "text", "multiline_text")
                                and len(_rv.split()) >= 2
                                and not _name_junk_shaped(_rv, field_key)
                                and _name_junk_shaped(_dv, field_key)):
                            # NAME-GUARD BACKSTOP — Layer A (007+gary, 2026-07-10): for a
                            # below/above-direction anchor the inline harvest is CROSS-COLUMN
                            # content BY CONSTRUCTION, and no name-quality comparison existed
                            # here — so a junk-shaped candidate ('Sso#' harvested off the
                            # caption row's neighbour column) silently REPLACED a rigid read
                            # that scores as a real multi-word name ('Formby & Sons',
                            # MP_sal_35, rejected as off_row_drift). KEEP the rigid read and
                            # flag it (cap ≤70 + note at the confidence block) — disagreement
                            # is a REVIEW event, never a coin toss. The 2026-07-06 drift-fix
                            # class (a credible multi-word relocate) does not trip this: its
                            # candidate isn't junk-shaped. Guarded by
                            # test_anchor_name_lock_guard.py.
                            if on_reject:
                                on_reject(field_key, "anchor_crop_relocated", _dv,
                                          "name_guard_junk_candidate")
                            _relocate_guard_note = ("The value found beside this document's own "
                                                    "caption disagreed with the taught position "
                                                    "— please verify.")
                            _name_guard_junk_note = True   # kept value is an independently-clean name
                                                           # -> a Stage-1 keyword that AGREES clears it
                        else:
                            if on_reject:
                                on_reject(field_key, "anchor_crop", value, "off_row_drift")
                            value = _dcand
                            method = "anchor_crop_relocated"
                            # (B) SLICE B — the swallowed NameError. Everything from here down used
                            # to be DEAD whenever the candidate came from the INLINE HARVEST: that
                            # branch never bound `_drelo`, so the next line raised NameError, which
                            # the bare `except` at the end of this guard swallowed — AFTER value +
                            # method had already committed. Consequences, all silent: the provenance
                            # box was lost; the RIGID crop's ocr_conf/ocr_min were carried over onto
                            # a read the rigid crop did not produce (corrupting the free-text
                            # confidence cap and the engine's Tier-A OCR gate); and the caption-bleed
                            # demotion below never ran for inline reads. Branch-aware now — the
                            # inline box is already TOP-LEFT (centre=False). Kill switch
                            # LABELLOCK_INLINE_PROVENANCE=0 restores the crash-truncated behaviour
                            # for the inline sub-case only (crop reads are unaffected either way).
                            if not _dinline or os.environ.get("LABELLOCK_INLINE_PROVENANCE", "1") != "0":
                              _read_box = (_norm_box_dict((_dloc or {}).get("inline_box"), False) if _dinline
                                           else _norm_box_dict(_drelo, True))   # picker: where the read came from
                              # Part A: keep the crop's measured confidence (was NULLED here).
                              # _dm stays {} when _dcand came from the INLINE HARVEST (no crop
                              # ran) -> .get returns None -> the documented "clean located read".
                              ocr_conf, ocr_min = _dm.get('conf'), _dm.get('min_conf')
                              # CAPTION-BLEED demotion (fix #2, RELOCATE_CAPTION_DEMOTE): the
                              # relocate's LEADING tokens ARE the taught caption (e.g. "Customer
                              # Site tee" vs label "Customer Site") -> the crop landed on the
                              # LABEL, not the value. name_quality can't catch it (real caption
                              # words score >=0.6, colliding with a legit mixed-case name), so
                              # FLAG it: the engine merge guard then prefers the clean keyword,
                              # and the note makes it review-bound even with no keyword incumbent.
                              # Free-text only (a caption is never a currency). Kill switch below.
                              if val_type in (None, "text", "multiline_text") \
                                      and os.environ.get("RELOCATE_CAPTION_DEMOTE", "1") != "0" \
                                      and _is_caption_bleed(_dcand, anchor.get("anchor_label")):
                                  _caption_bleed = True
                                  if not _relocate_guard_note:
                                      _relocate_guard_note = ("The taught box landed on this field's "
                                                              "label, not its value — please verify.")
                    # (C) The relocate read its own caption and was refused above. The rigid read we
                    # KEPT disagreed with it by construction, so the anchor's two reads contradict
                    # each other -> flag for review (cap <=70 at the confidence block). No note when
                    # nothing was rejected, so a clean corroborated read is untouched.
                    if _dband_reject and not _relocate_guard_note:
                        _relocate_guard_note = ("The value beside this document's own caption was the "
                                                "caption itself — please verify.")
            except Exception:
                pass  # dev/robustness: the guard must never break a read

        # ── AUTHORITATIVE-CROP CROSS-CHECK (structured ref + date fields) ─────
        # A taught (authoritative) rigid crop that reads a VALID-SHAPED ref number wins
        # OUTRIGHT at Tier-A (a structured value is regex-validated, never conf-capped), so
        # when the 2× upscale/sharpen crop OCR MANGLES a digit (City Office invoice
        # "152574" → "192074" — both valid shapes) the WRONG value files SILENTLY at 97%,
        # unflagged. The full-page native-DPI OCR reads the same "Invoice No." line
        # correctly, so cross-check: locate the label and harvest its inline value off the
        # full page; if that read is credible AND DISAGREES with the crop, the crop may NOT
        # win silently — prefer the full-page value + recover-and-flag for review (the same
        # posture as slip-fix). INVARIANT (oscar): an authoritative anchor wins silently ONLY
        # when two INDEPENDENT reads of the field AGREE; on disagreement -> review. A digit
        # whitelist can't fix this (both reads are digits) — the reusable guard is the cross-
        # read agreement, not a per-field recipe, so it covers every supplier/ref field.
        # Byte-identical when the reads agree, the label can't be cross-read, or the harvest
        # isn't a credible DIFFERENT value. Covers REF + DATE fields + authoritative + a plain
        # rigid anchor_crop (the free-text/currency label-lock above already covers those types).
        # DATE was pattern-trusted, but the cross-supplier FALSE-LOCATE residual breaks that: the
        # taught caption also exists on ANOTHER supplier's layout at a DIFFERENT position, so the
        # rigid ABSOLUTE crop reads a wrong-but-valid-shaped DATE (shape check can't catch it) while
        # the label cross-read off the real caption gets the right date → DISAGREEMENT flips+flags.
        # The date disagreement compares CALENDAR dates (parse_date), so a format-only difference
        # (29/05/2026 vs 29-05-2026) is NOT a flip. Reuses line_cache — one locate per label per page.
        _xcheck_note = None   # flag-only note (value-below-label false-locate); set below, applied at the result build
        _xcheck_preflip = None  # C1: credible PRE-FLIP crop read, stashed (gated) as an independent crop-family witness for the engine's post-merge crosscheck-outlier reconcile
        if value and method == "anchor_crop" and (_is_ref_like_key(field_key) or val_type == "date") \
                and anchor.get("last_authoritative_at") \
                and (anchor.get("anchor_label") or "").strip() and page0 is not None:
            try:
                _xh = anchor.get("h_norm") or 0.0
                _xw = anchor.get("w_norm") or 0.0
                # UNBIASED locate (no confirm_value): we want the label's TRUE inline value,
                # not the label occurrence that happens to carry the possibly-wrong crop read.
                _xloc = _locate_for_relocation(page0, anchor["anchor_label"], direction,
                                               (x_norm, y_norm, _xw, _xh), page_text_lines,
                                               line_cache=line_cache)
                # SEAM, deliberate: this THIRD inline consumer is NOT covered by the taught-offset
                # veto. It never commits the harvest — it only compares it to the crop read and
                # FLAGS a disagreement — so a wrong-column harvest here costs a needless review, not
                # a wrong value. Guarding it would move ref/date flag counts and needs its own corpus
                # arm; the two COMMITTING doors are guarded.
                _xiv = ((_xloc or {}).get("inline_value") or "").strip()
                if _xiv:
                    _xc = _clean_text_fallback(_xiv, val_type, validation_patterns) \
                          or clean_crop_segment(_xiv, val_type)
                    if _xc and _crop_is_credible(_xc, val_type, validation_patterns, label) \
                            and _qualify_against_format(_xc, field_key, format_lookup, text_field_keys) \
                            and _reads_disagree(_xc, value, val_type):
                        # Two independent reads DISAGREE (calendar-aware for dates) -> the taught crop
                        # can't win silently: prefer the full-page native read + flag for review.
                        if on_reject:
                            on_reject(field_key, "anchor_crop", value, "crop_fullpage_disagree")
                        if os.environ.get("CROSSCHECK_OUTLIER_RECONCILE", "0") != "0":
                            # Oracle C1: the fresh full-page locate can ITSELF be the garbler (doc-09:
                            # correct crop PO-83150 flipped to a lone-outlier PO-83160). Preserve the
                            # credible pre-flip CROP read so the engine's post-merge reconcile has an
                            # independent crop-family witness — WITHOUT it the fix only heals mapping-
                            # backed docs and leaves the ⊕-anchor-only sibling broken (a document fix,
                            # not a system fix). Gated: the OFF path never adds the key (byte-identical,
                            # ledger included). Consumed + popped in engine._reconcile_crosscheck_outlier.
                            _xcheck_preflip = value
                        value  = _xc.strip()             # prefer the full-page native read
                        method = "anchor_crop_crosscheck"
                        ocr_conf, ocr_min = None, None
                elif _xloc and _xloc.get("label_box") \
                        and (_xloc.get("match_score") or 0) >= 0.9 \
                        and anchor.get("offset_dx_norm") is not None \
                        and _named_cross_supplier(anchor, supplier_name):
                    # FLAG-ONLY geometric detector — the value-BELOW-label cross-supplier false-locate.
                    # The label LOCATED with high confidence but its value is NOT on the label's line
                    # (inline harvest empty -> a label-above layout), so the rigid ABSOLUTE crop may have
                    # read a DIFFERENT supplier's field at the taught box. Re-read a crop seated at
                    # located-label + stored offset. On disagreement we do NOT trust this re-OCR enough
                    # to REPLACE a value that drives filing + learning (unlike the inline read, taken off
                    # the label's OWN OCR line) -> so KEEP the rigid value and only cap + flag for review,
                    # never a silent confident-wrong file. SCOPED to a NAMED different supplier (a
                    # same-supplier re-read can mis-seat and cry wolf; a genuine same-supplier drift
                    # already fails credibility and is handled by the drift-recovery rung below);
                    # match_score >= 0.9 so a MIS-located label can't manufacture a spurious flag.
                    # 007-reviewed: flag-only, NOT flip -- the geometric read is a weaker signal than the
                    # inline twin and the real-doc A/B is structurally blind to this path, so we DETECT a
                    # disagreement, never SUBSTITUTE.
                    _gbox = _place_from_located(_xloc, direction, (x_norm, y_norm, _xw, _xh),
                                                offset=(anchor.get("offset_dx_norm"),
                                                        anchor.get("offset_dy_norm")))
                    _gv = (_crop_and_ocr(page0, _gbox[0], _gbox[1], _gbox[2], _gbox[3], val_type,
                                         verify_fn=_verify, continuation=continuation,
                                         top_limit_norm=_caption_top_limit(_xloc.get("label_box"),
                                                                           direction, _gbox),
                                         left_limit_norm=_label_left_limit(_xloc, anchor, direction, val_type)) if _gbox else None)
                    _gc = (_clean_text_fallback(_gv, val_type, validation_patterns)
                           or clean_crop_segment(_gv, val_type)) if _gv else None
                    if _gc and _crop_is_credible(_gc, val_type, validation_patterns, label) \
                            and _qualify_against_format(_gc, field_key, format_lookup, text_field_keys) \
                            and _reads_disagree(_gc, value, val_type):
                        if on_reject:
                            on_reject(field_key, "anchor_crop", value, "crop_belowlabel_disagree")
                        _xcheck_note = ("The taught position and the value beside this document's "
                                        "own label disagreed - please verify.")
            except Exception:
                pass  # robustness: a cross-check failure must never break the read

        # ── Drift recovery: locate the label, then read the value beside it ───
        # The fixed crop is positionally RIGID — on a shifted/cropped scan (the
        # page registered higher, a top band clipped) the value moves off the
        # stored box and the rigid crop reads the wrong row, which the
        # credibility/format gates above then REJECT (value stays None). Here we
        # re-find the TAUGHT label on this page and re-derive the value crop from
        # where the label ACTUALLY sits + the taught direction, so the value
        # FOLLOWS the label however far the page drifted. This is the same
        # anchor+relative-target model Stage 0.5 (template_mapper) uses, brought
        # to ⊕-taught anchors so coordinates are only a HINT. Runs ONLY after the
        # rigid crop already failed, so the fast happy path is unchanged; the
        # relocated value still must clear the same credibility + learned-format
        # gates before it can win. Generic to every supplier/field.
        # Fires when the rigid read is empty, a weak free-text fragment, not
        # STRICTLY credible (high-DPI crop garbage like "cield wu" that slips
        # through the loose gate), OR — for free-text — a LOW-confidence crop read
        # (a clipped/drifted name like "Danirmant fara WMamac" @ conf 34 that the
        # loose floor accepts but OCR confidence flags): _strict_credible now folds
        # the rigid read's ocr_conf in. A cleanly-read rigid value (conf >= 60,
        # strictly credible) skips the rung, so the fast happy path stays
        # byte-identical (no extra OCR on good reads).
        # Dev trace: show WHERE the taught label resolves on this page as a
        # kind="anchor" slice — emitted EVEN when the rigid crop already succeeded —
        # so the inspector / review console can draw the anchor box ALONGSIDE the value
        # box and reveal a label that isn't locating, or that locates on the wrong row.
        # Trace-only (slice_capture set); reuses line_cache so the relocate rung below
        # pays no extra OCR. Never affects extraction.
        if slice_capture and page0 is not None and (anchor.get("anchor_label") or "").strip():
            try:
                _lw = anchor.get("w_norm") or 0.0
                _lh = anchor.get("h_norm") or 0.0
                _loc = _locate_for_relocation(page0, anchor["anchor_label"], direction,
                                              (x_norm, y_norm, _lw, _lh), page_text_lines,
                                              line_cache=line_cache)
                _lb = (_loc or {}).get("label_box")
                if _lb:
                    _W, _H = page0.size[0], page0.size[1]
                    _lcrop = page0.crop((int(_lb["x_norm"] * _W), int(_lb["y_norm"] * _H),
                                         int((_lb["x_norm"] + _lb["w_norm"]) * _W),
                                         int((_lb["y_norm"] + _lb["h_norm"]) * _H)))
                    # C4: if the position veto (below) would REJECT this locate, tag the slice
                    # "anchor_vetoed" so "Show where it reads" shows the caption was FOUND-but-rejected
                    # (wrong column) instead of a misleading amber box — the surface the original false
                    # report came from. Same predicate as the extraction veto; dev-only (--trace).
                    _tdx, _tdy = anchor.get("offset_dx_norm"), anchor.get("offset_dy_norm")
                    _t_vetoed = (_tdx is not None and _tdy is not None and (_tdx or _tdy)
                                 and not _located_at_taught_position(_loc, x_norm, y_norm, _tdx, _tdy,
                                                                     tol_x=_RELOC_TOL_X, tol_y=_RELOC_TOL_Y))
                    slice_capture(field_key, "anchor_label", 0,
                                  (_lb["x_norm"], _lb["y_norm"], _lb["w_norm"], _lb["h_norm"]),
                                  _lcrop, "anchor_vetoed" if _t_vetoed else "anchor")
            except Exception:
                pass  # dev-only diagnostic; never disrupt extraction

        if (not value or _is_weak_read(value, val_type)
                or not _strict_credible(value, val_type, validation_patterns, ocr_conf=ocr_conf)) \
                and page0 is not None and (anchor.get("anchor_label") or "").strip():
            w_norm = anchor.get("w_norm") or 0.0
            h_norm = anchor.get("h_norm") or 0.0
            vbox    = (x_norm, y_norm, w_norm, h_norm)
            located = _locate_for_relocation(page0, anchor["anchor_label"], direction, vbox, page_text_lines,
                                             line_cache=line_cache)
            # POSITION VETO (Oracle 2026-07-12). On a skewed/clipped scan the true caption can fragment
            # below the fuzzy threshold in the local band, so the PAGE-WIDE relocate fallback grabs a
            # same-PREFIX caption in the WRONG COLUMN ("Delivery Note No." → "Deliver To") and then inline-
            # harvests a wrong-column value — a confident-wrong read no cross-supplier gate catches (a
            # supplier's own doc bypasses them all). When this ⊕ anchor carries a usable label→value OFFSET
            # (migration 21), verify the RE-LOCATED caption is at its TAUGHT position (value_centre − offset,
            # looser _RELOC tolerances); if it landed a whole column/section away, DROP the relocation → the
            # field keeps its weak rigid read → review. Only ever sets located=None (never selects) →
            # fail-toward-review. C1 (load-bearing): gate on the offset being PRESENT + non-zero as a
            # SEPARATE precondition — _located_at_taught_position ALSO returns False for a NO-offset (legacy)
            # anchor, so a naive `if not _located_...` would veto EVERY pre-migration-21 anchor. No usable
            # offset → no veto → byte-identical.
            _reloc_odx, _reloc_ody = anchor.get("offset_dx_norm"), anchor.get("offset_dy_norm")
            _reloc_can_verify = (_reloc_odx is not None and _reloc_ody is not None
                                 and (_reloc_odx or _reloc_ody))
            if located and _reloc_can_verify and not _located_at_taught_position(
                    located, x_norm, y_norm, _reloc_odx, _reloc_ody,
                    tol_x=_RELOC_TOL_X, tol_y=_RELOC_TOL_Y):
                if on_reject:
                    on_reject(field_key, "anchor_relocate",
                              (located or {}).get("matched_text"), "label_off_taught_position")
                located = None
            if located:
                # 1. INLINE HARVEST: in a key/value row the value shares the located
                # label's OCR line ("label …gap… value") and sits in a far column the
                # adjacency guess can't reach — so read it STRAIGHT off the located
                # line. Cleaned/narrowed (date pattern, column-gap split) and held to
                # the SAME credibility + learned-format gates as a crop read, so it
                # can never commit something a crop read would have rejected.
                iv = located.get("inline_value")
                # Door 2 of 2 for the taught-offset veto (see _inline_at_taught_offset): the label
                # located here can be exactly right while the harvest comes from the NEXT BLOCK on the
                # same OCR row. Drops the harvest only; the crop read seated at the taught offset (2)
                # below then runs.
                if iv and not _inline_at_taught_offset(located, direction, vbox,
                                                       (_reloc_odx, _reloc_ody)):
                    if on_reject:
                        on_reject(field_key, "anchor_inline", iv, "inline_off_taught_position")
                    iv = None
                # 007-A (ANCHOR_INLINE_FULLRES_REREAD, default ON — owner+007 2026-07-27): inline_value is
                # harvested from the label-LOCATE pass, which _prep_for_lines downscales to ~120 DPI for
                # locate SPEED (_MAX=1100). At that resolution a printed digit can flip (measured 9->0 on a
                # good, mildly-skewed scan: PO-78399 -> PO-78309, committed silently). The KNOWN inline_box is
                # in page coords, so re-read it at FULL render resolution with the SAME crop ladder the DRAW
                # TOOL / _crop_and_ocr use (resolution-adaptive: full-res for codes, preview-scale for degraded
                # free-text — the owner's "the draw box seldom fails OCR" recipe). Prefer the full-res read
                # ONLY when it is itself CREDIBLE, so a garbled re-read never displaces a correct harvest
                # (non-monotonicity guard — downscale can incidentally rescue a noisy glyph; Oracle Q2). No
                # inline_box / OFF => the low-res harvest stands (byte-identical). Value-only: position + gates
                # below are unchanged.
                # ⚠ DARK (default '0') — the corpus A/B REGRESSED: re-cropping full-res at the inline_box
                # (which is derived from the LOW-RES locate pass, so its edges are ~120-DPI coarse) and
                # re-OCRing corrupted many reads (ref 97.6->86.8%, date 95.5->90.0%, silentAutoFile 3->27
                # 2026-07-27) — the non-monotonic re-OCR Oracle warned of (Q2), at scale. The box-precision
                # problem must be solved (re-locate the value at full res, not re-crop the coarse box)
                # before this can re-enable. reggie's independent Stage-1 reader (PO_ORDER_NO_LABELS) makes
                # the target case fail-toward-review meanwhile. =1 to experiment.
                if (iv and page0 is not None and located.get("inline_box")
                        and os.environ.get('ANCHOR_INLINE_FULLRES_REREAD', '0') != '0'):
                    try:
                        _ib0 = located["inline_box"]
                        _W0, _H0 = page0.size[0], page0.size[1]
                        _fcrop = page0.crop((int(_ib0["x_norm"] * _W0), int(_ib0["y_norm"] * _H0),
                                             int((_ib0["x_norm"] + _ib0["w_norm"]) * _W0),
                                             int((_ib0["y_norm"] + _ib0["h_norm"]) * _H0)))
                        _frv = _ocr_crop_laddered(_fcrop, val_type, meta={}, page=page0,
                                                  box=(_ib0["x_norm"], _ib0["y_norm"], _ib0["w_norm"], _ib0["h_norm"]))
                        if _frv and _frv.strip():
                            _frc = _clean_text_fallback(_frv, val_type, validation_patterns) or clean_crop_segment(_frv, val_type)
                            if _frc and _crop_is_credible(_frc, val_type, validation_patterns, label):
                                iv = _frv.strip()   # credible full-res re-read replaces the low-res harvest
                    except Exception:
                        pass   # any failure -> keep the low-res harvest (byte-identical fallback)
                if iv:
                    hv = _clean_text_fallback(iv, val_type, validation_patterns) or clean_crop_segment(iv, val_type)
                    # A code-like value column ("2602-0768-1 Work Address …") is a
                    # single token; keep the first (the harvest already excludes the
                    # label, so the first token is the value, not a caption).
                    if hv and val_type == "alphanumeric" and " " in hv:
                        hv = hv.split()[0]
                    # Strip leading OCR edge-junk ("--«", ">>") that scan noise / handwriting
                    # bleeds onto the harvested line — otherwise a CORRECT value
                    # ("--« Beaumont Care Homes Ltd -") is rejected by the credibility gate
                    # (which requires an alphanumeric first char) and the field falls through to
                    # a wrong-column read. Same strip_name_edges already applied at the Stage 1
                    # keyword capture + Stage 4.5 catch-all; bring it to the inline harvest too.
                    # Free-text only; over-strip-guarded inside strip_name_edges.
                    if hv and val_type in (None, "text", "multiline_text"):
                        from extraction.value_quality import strip_name_edges
                        hv = strip_name_edges(hv)
                    # Cross-field guard: never inline-harvest a code/reference-shaped value
                    # into a NAME field (the merged-row "Work Address" line also carries the
                    # ticket reference). See _name_field_code_reject.
                    if hv and _name_field_code_reject(hv, field_key):
                        if on_reject: on_reject(field_key, "anchor_inline", hv, "cross_field_code")
                        hv = None
                    if hv and _crop_is_credible(hv, val_type, validation_patterns, label):
                        q = _qualify_against_format(hv, field_key, format_lookup, text_field_keys)
                        if q and _should_replace(value, q, val_type, validation_patterns, inc_ocr_conf=ocr_conf):
                            value  = q
                            method = "anchor_inline"
                            _read_box = _norm_box_dict(located.get("inline_box"), False)   # picker: inline value box (top-left)
                            # The value now comes off the located LINE, not a crop —
                            # restore the documented "None for inline reads" invariant
                            # so the confidence cap and the placement rung below treat
                            # it as a clean located read, not the (possibly low) rigid
                            # crop conf it's replacing.
                            ocr_conf, ocr_min = None, None
                            # Dev trace: emit a slice for the harvested value's region
                            # so the inspector can highlight where an inline read came
                            # from (these reads don't crop+re-OCR, so without this the
                            # winning value has no box). Only fires under --trace.
                            _ib = located.get("inline_box")
                            if slice_capture and _ib:
                                try:
                                    _ibox = (_ib["x_norm"], _ib["y_norm"], _ib["w_norm"], _ib["h_norm"])
                                    _icrop = page0.crop((int(_ib["x_norm"] * page0.size[0]),
                                                         int(_ib["y_norm"] * page0.size[1]),
                                                         int((_ib["x_norm"] + _ib["w_norm"]) * page0.size[0]),
                                                         int((_ib["y_norm"] + _ib["h_norm"]) * page0.size[1])))
                                    slice_capture(field_key, "anchor_inline", 0, _ibox, _icrop, "target")
                                except Exception:
                                    pass   # dev-only; never disrupt extraction
                    elif hv and on_reject:
                        on_reject(field_key, "anchor_inline", hv, "not_credible")
                # 2. PLACEMENT + CROP: value not on the label's line (label-above
                # layouts) or harvest failed — seat a crop relative to the LABEL box
                # (not the whole line) and re-OCR it.
                if not value or _is_weak_read(value, val_type) \
                        or not _strict_credible(value, val_type, validation_patterns, ocr_conf=ocr_conf):
                    relo = _place_from_located(located, direction, vbox,
                        offset=(anchor.get("offset_dx_norm"), anchor.get("offset_dy_norm")))
                    if relo:
                        # Widen a touch (centre-preserved) so a value marginally
                        # wider than the tight taught box isn't sheared.
                        relo = _widen_relocated_crop(relo, val_type)
                        _rcap = ((lambda c: slice_capture(field_key, "anchor_relocate", 0,
                                    relo, c, "target")) if slice_capture else None)
                        _mr = {}
                        # (P) slice A: the drift rung's relocate crop was NEVER clamped — the
                        # exclusion was produced at exactly one call site (the label-lock rung).
                        # Same geometry, same failure: a padded below-anchor crop balloons up into
                        # the caption it was seated beneath. Rides RELOCATE_CAPTION_EXCLUDE.
                        _rtl = _caption_top_limit(located.get("label_box"), direction, relo)
                        rval = _crop_and_ocr(page0, relo[0], relo[1], relo[2], relo[3],
                                             val_type, capture=_rcap, verify_fn=_verify, meta=_mr,
                                             continuation=continuation, top_limit_norm=_rtl,
                                             max_w_norm=anchor.get("max_w_norm"),
                                             left_limit_norm=_label_left_limit(located, anchor, direction, val_type),
                                             right_limit_norm=_label_right_limit(field_key, located, anchor, direction, val_type, validation_patterns))
                        _xfield = bool(rval) and _name_field_code_reject(rval, field_key)
                        if rval and (_xfield or not _crop_is_credible(rval, val_type, validation_patterns, label)):
                            _rec = None if _xfield else _recover_clean_token(rval, val_type, validation_patterns, label)
                            if _rec and _should_replace(value, _rec, val_type, validation_patterns, inc_ocr_conf=ocr_conf):
                                value  = _rec
                                method = "anchor_crop_recovered"
                                ocr_conf, ocr_min = _mr.get('conf'), _mr.get('min_conf')
                            elif on_reject:
                                on_reject(field_key, "anchor_crop_relocated", rval,
                                          "cross_field_code" if _xfield else "not_credible")
                        elif rval:
                            q = _qualify_against_format(rval, field_key, format_lookup,
                                                        text_field_keys, val_type, validation_patterns)
                            # Label-CONFIRMED relocation: the value was read beside the
                            # LOCATED label and cleared credibility + the cross-field /
                            # column-bleed guards above. A learned-SHAPE mismatch (a device
                            # serial that differs from history — the "H571Y07217 rejected
                            # format" bug) must NOT discard it; keep the credible value (a
                            # column-bleed substring was already trimmed into `q` when one
                            # existed). The shape veto stays on the UN-anchored rigid path
                            # so a drifted "Bookinc" is still caught.
                            # EXCEPTION (same as the registration rung): never resurrect a
                            # DIGIT-FREE read on a uniformly digit-bearing field — a wrong-row
                            # word, not a variable code.
                            if not q and not _digit_free_on_digit_field(rval, field_key, format_lookup) \
                                    and not _partial_of_uniform_shape(rval, field_key, format_lookup):
                                q = rval
                            # (C) COMPOSED CAPTION-BAND REJECT — the second commit point. Same rule as
                            # the label-lock rung: a garbled caption read from a window that still
                            # overlaps the located caption band is the LABEL, not the value.
                            if q and _is_caption_band_read(q, anchor.get("anchor_label"), field_key,
                                                          located.get("label_box"), relo, val_type,
                                                          page0.size, _rtl):
                                if on_reject:
                                    on_reject(field_key, "anchor_crop_relocated", q, "caption_band_read")
                                if not _relocate_guard_note:
                                    _relocate_guard_note = ("The value beside this document's own caption "
                                                            "was the caption itself — please verify.")
                                q = None
                            if q and _should_replace(value, q, val_type, validation_patterns, inc_ocr_conf=ocr_conf):
                                value  = q
                                method = "anchor_crop_relocated"
                                _read_box = _norm_box_dict(relo, True)   # picker: where the relocate read
                                ocr_conf, ocr_min = _mr.get('conf'), _mr.get('min_conf')

        # ── Registration recovery (FALLBACK): map the taught value box through the
        # per-page transform (fitted from the template's landmarks) so the value
        # FOLLOWS a shifted/skewed/scaled page even when the field's OWN label can't
        # be re-found — the failure that leaves a worksheet date empty. This now runs
        # AFTER the label-based drift-recovery above (2026-06 "Stage 2 anchor arbiter"
        # reorder): the LOCAL precise label read is tried FIRST, because a GLOBAL
        # similarity fit's ~2% page residual exceeds the tight row pitch in a dense
        # label block and lands a row off (the "849-4" from "2605-0849-1" bug). So
        # registration is the fallback its own design always intended — it fires only
        # when the relocate above left the value None/weak (relocate only assigns
        # inside its credibility+format+_should_replace gates, so a failed/uncredible
        # relocate leaves value None, which this `not value` trigger already covers;
        # no extra trigger clause is needed). The mapped read still clears the SAME
        # credibility + learned-format gates. INERT (byte-identical) when no transform
        # was fitted (flag off / no landmarks / poor fit).
        if (not value or _is_weak_read(value, val_type)) and _xsup_absolute_ok and page_transform is not None \
                and x_norm > 0 and y_norm > 0 and page0 is not None:
            w_norm = anchor.get("w_norm") or 0.0
            h_norm = anchor.get("h_norm") or 0.0
            # field_anchors stores the value CENTRE; Transform.apply_box wants a
            # top-left box. Convert in → map → recentre, KEEPING the original tight
            # w/h (apply_box's AABB can inflate under rotation; we only want the
            # corrected POSITION, not a ballooned crop).
            tl = {"x_norm": x_norm - w_norm / 2.0, "y_norm": y_norm - h_norm / 2.0,
                  "w_norm": w_norm, "h_norm": h_norm}
            mapped = page_transform.apply_box(tl)
            rcx = mapped["x_norm"] + mapped["w_norm"] / 2.0
            rcy = mapped["y_norm"] + mapped["h_norm"] / 2.0
            _gcap = ((lambda c: slice_capture(field_key, "anchor_registration", 0,
                        (rcx, rcy, w_norm, h_norm), c, "target")) if slice_capture else None)
            _mg = {}
            gval = _crop_and_ocr(page0, rcx, rcy, w_norm, h_norm, val_type, capture=_gcap, verify_fn=_verify, meta=_mg, continuation=continuation)
            if gval and not _crop_is_credible(gval, val_type, validation_patterns, label):
                _rec = _recover_clean_token(gval, val_type, validation_patterns, label)
                if _rec and _should_replace(value, _rec, val_type, validation_patterns, inc_ocr_conf=ocr_conf):
                    value  = _rec
                    method = "anchor_crop_recovered"
                    ocr_conf, ocr_min = _mg.get('conf'), _mg.get('min_conf')
                elif on_reject:
                    on_reject(field_key, "anchor_registration", gval, "not_credible")
            elif gval:
                q = _qualify_against_format(gval, field_key, format_lookup, text_field_keys,
                                            val_type, validation_patterns)
                # Landmark-CONFIRMED read: the value was mapped through the page transform
                # and cleared credibility. A learned-SHAPE mismatch (a variable code that
                # differs from history) must NOT discard it — keep the credible value (a
                # column-bleed substring was already trimmed into `q` above when one
                # existed). The shape veto stays on the UN-anchored rigid path.
                # EXCEPTION: don't resurrect a DIGIT-FREE read (a wrong-row word like
                # "Field") OR a digit-bearing FRAGMENT of a uniform learned shape
                # ("849-4" of "####-####-#") on a uniformly digit-bearing field — leave
                # value empty so the (already-run) relocate, or review, seats the real value.
                if not q and not _digit_free_on_digit_field(gval, field_key, format_lookup) \
                        and not _partial_of_uniform_shape(gval, field_key, format_lookup):
                    q = gval
                if q and _should_replace(value, q, val_type, validation_patterns, inc_ocr_conf=ocr_conf):
                    value  = q
                    method = "anchor_registration"
                    ocr_conf, ocr_min = _mg.get('conf'), _mg.get('min_conf')

        # ── Fallback: text-based search in full OCR output ────────────────────
        if not value:
            pattern = _label_pattern(label)
            for i, line in enumerate(lines):
                m = pattern.search(line.lower()) if pattern else None
                if not m:
                    continue

                if direction == "right":
                    remainder = line[m.end():].strip().lstrip(":").strip()
                    if remainder:
                        value = remainder

                elif direction == "below":
                    for j in range(i + 1, min(i + 4, len(lines))):
                        candidate = lines[j].strip()
                        if candidate:
                            value = candidate
                            break

                elif direction == "above":
                    for j in range(i - 1, max(i - 4, -1), -1):
                        candidate = lines[j].strip()
                        if candidate:
                            value = candidate
                            break

                if value:
                    break

        # Text-fallback values (method 'anchor') are raw line slices that never
        # went through the crop paths' shared cleaning, so a label-band
        # over-capture ("2605-0769-1 Work Address Beaumont…") would commit whole.
        # Narrow a structured field to its pattern match and clean a free-text
        # field with the shared segment cleaner. Crop/relocate/registration values
        # are already cleaned, so only the text path is touched. Reusable.
        if value and method == "anchor":
            value = _clean_text_fallback(value, val_type, validation_patterns) or value

        # Never commit an implausible value — whether from a drifted crop or a
        # fallback line that landed on an adjacent label (e.g. ". Ship Mode:").
        # Leaving the field empty routes it to review/manual entry instead of a
        # confidently-wrong read; a credible value (the normal case) is kept.
        if value and not _crop_is_credible(value, val_type, validation_patterns, label):
            value = None

        # CAPTION-CONTINUATION GUARD (label relocation): a RE-READ (text-fallback / inline / relocate /
        # registration) that landed on a page CAPTION word — the "Item Information" heading stealing the
        # "Item" label and reading 'information' — must NEVER commit. Null it; a rigid taught crop
        # (method 'anchor_crop') is deliberately NOT in the method set, so a clean rigid read is
        # preserved and auto-files unflagged. Content-only predicate (val_type-aware); if no anchor
        # fills the field, the after-loop branch emits an empty+note row -> review. This is the ONE
        # convergence point (no read after it re-sources a value). Kill switch
        # ANCHOR_CAPTION_HARVEST_GUARD=0 (OFF => byte-identical). (Oracle SIGN-OFF-WITH-CONDITIONS.)
        if (value and method in ("anchor", "anchor_inline", "anchor_crop_relocated", "anchor_registration")
                and os.environ.get("ANCHOR_CAPTION_HARVEST_GUARD", "1") != "0"):
            from extraction.keyword import is_caption_continuation
            if is_caption_continuation(value, val_type, anchor.get("anchor_label")):
                value, _caption_detected, _caption_field = None, True, field_key
                _caption_note = ("The label matched a heading on the page, not a value — "
                                 "please check this field.")

        # Final learned-format gate — also covers the text-fallback value, so a
        # label-search read that grabbed the wrong token is rejected/trimmed too.
        # SKIP for the label-confirmed rungs (inline/relocated/registration): they
        # already qualified their read and deliberately KEEP a credible value the
        # learned-SHAPE veto would otherwise drop (a variable code differing from
        # history); re-running it here would re-null the value. The UN-anchored rigid
        # crop / text fallback still pass through the veto.
        if value and method not in _LABEL_CONFIRMED_METHODS:
            value = _qualify_against_format(value, field_key, format_lookup, text_field_keys,
                                            val_type, validation_patterns)

        # Name-quality gate (Part 3): a NAME/company/address field whose read is a
        # garbled MULTI-WORD string ("Fr eanehae Crane", "67 Boucher Cre") is OCR
        # junk, not a real name — DROP it so it can't win (Tier-A / confidence)
        # over a credible mapping / keyword / learned hint, and so the empty field
        # falls to hint-recovery. Single-token brands ("3M", "IBM") aren't judged.
        # Reusable for every name-like field. See extraction/value_quality.py.
        if value and len(str(value).split()) >= 2:
            from extraction.value_quality import is_name_like_field, name_quality
            if is_name_like_field(field_key) and name_quality(value) < 0.5:
                value = None

        # Guard B (fuzzy caption bleed, RIGID anchor_crop — Oracle 2026-07-15): a rigid taught crop that
        # landed on the field's own CAPTION and OCR-garbled it ("Veliver 10°" from "Deliver To") slips the
        # token-EXACT _is_caption_bleed (relocate-only) AND the multi-word name null above (name_quality
        # 0.5, not < 0.5), then WINS Tier-A over the correct keyword. Fuzzy-detect it and set BOTH the flag
        # (so engine._name_relocate_should_hold keeps the clean keyword) AND _relocate_guard_note (which
        # caps conf <= 70 at the anchor_crop guard below AND persists a note, so it's review-bound even
        # with NO keyword incumbent — Oracle C1). Gated to name_quality < 0.6 (Oracle C3: real names like
        # "Denver Trading"/"Delivery Solutions Ltd" score 1.0 and survive). Kill switch ANCHOR_CAPTION_BLEED_GUARD.
        # 2026-07-20 — WIDENED to the RELOCATED crop (owner report, Northgate delivery dockets).
        # The two caption guards had a hole exactly between them: the token-EXACT check
        # (_is_caption_bleed) is relocate-scoped but can't match a caption OCR mangled it, and this
        # FUZZY check caught the garble but only on the RIGID crop — so a GARBLED RELOCATE walked
        # through both. Live trace: taught label "Deliver To" (direction below) produced
        # anchor_crop "Wenver i0" (rejected off_row_drift) and anchor_crop_relocated "Vetiver 10"
        # @80, which BEAT the correct keyword read "Halcyon Leisure Group" @78 and filed the label
        # as the customer. "vetiver" vs "deliver" = 2/7 = 0.29 <= 0.35, so the predicate always
        # recognised it — only the method gate kept it out. The name_quality < 0.6 condition below
        # is what keeps REAL names safe here ("Denver Trading"/"Delivery Solutions Ltd" fuzzy-match
        # a caption but score 1.0), so widening the method set cannot demote a clean name.
        if (value and method in ("anchor_crop", "anchor_crop_relocated")
                and val_type in (None, "text", "multiline_text")
                and os.environ.get("ANCHOR_CAPTION_BLEED_GUARD", "1") != "0"):
            from extraction.value_quality import is_name_like_field as _isnl2, name_quality as _nq2
            if (_isnl2(field_key) and field_key != "supplier_name"
                    and _is_fuzzy_caption_bleed(value, anchor.get("anchor_label"), field_key)
                    and _nq2(value) < 0.6):
                _caption_bleed = True
                if not _relocate_guard_note:
                    _relocate_guard_note = ("The taught box landed on this field's label, not its "
                                            "value — please verify.")

        if value:
            conf = min(95, 55 + (usage_count * 5) + int(conf_factor * 20))
            if method == "anchor_crop":
                conf = min(97, conf + 5)  # image crop is more reliable
            elif method == "anchor_inline":
                # Value read directly off the located label's OCR line — a clean
                # text read, no crop drift; reliable, ranks with a good rigid crop.
                conf = min(93, conf + 5)
            elif method == "anchor_crop_relocated":
                # Drift-relocated crop: more reliable than a blind text-line grab,
                # but a touch below a clean rigid crop since the page had shifted.
                conf = min(92, conf + 2)
            elif method == "anchor_registration":
                # Multi-landmark page transform — score by the FIT quality (inliers
                # + residual), not usage_count. Ranks above single-label relocate
                # (stronger geometry) and below a clean rigid crop.
                conf = min(93, registration.registration_confidence(page_transform))
            elif method == "anchor_crop_slipfix":
                conf = min(70, conf)   # recover-and-flag: a gate-rejected read repaired to the learned shape
            # anchor_crop_recovered is capped/flagged AFTER the located gate (see _rec_confident):
            # a LOCATED, shape-matching recovery commits CONFIDENT (no flag); else capped to 70 + flagged.
            elif method == "anchor_crop_crosscheck":
                conf = min(70, conf)   # cross-read disagreement: full-page value preferred, routed to review
            # NAME-CREDIBILITY BAR for WANDERED reads — Layer B (007+gary, 2026-07-10): a
            # RELOCATED/INLINE commit on a name-like free-text field whose value is junk-shaped
            # is capped ≤70 + noted, never trusted at the synthetic 87-92. These paths null
            # ocr_conf by design (the OCR-quality cap below is blind to them) and the
            # multi-word name gate above skips single tokens — this closes exactly that hole
            # ('Sso'/'Sso#' @87-91 unflagged, MP_sal_35). A clean multi-word relocated name
            # (the drift-fix class) passes the bar untouched. Composes with the Stage-2.6
            # rescue's min()-cap (a rescued junk name stays 70+note). DELIBERATE residual: a
            # legit ≤3-alpha brand ('IBM') via these methods flags every time — fail-toward-
            # review; the accepted-names allowlist doesn't reach anchor.py yet (future
            # plumbing, noted in test row f).
            if (method in ("anchor_crop_relocated", "anchor_inline")
                    and val_type in (None, "text", "multiline_text")
                    and _name_junk_shaped(value, field_key)):
                conf = min(70, conf)
                if not _relocate_guard_note:
                    _relocate_guard_note = ("This value was read after the taught position "
                                            "shifted and doesn't look like a real name — "
                                            "please verify.")
            # Layer A kept the rigid read over a junk relocate: flag it for review. Skipped
            # when the crosscheck later flipped/noted (method no longer anchor_crop or
            # _xcheck_note set) — that path carries its own note.
            if _relocate_guard_note and method == "anchor_crop" and not _xcheck_note:
                conf = min(70, conf)
            if _xcheck_note:
                conf = min(70, conf)   # flag-only value-below-label disagreement: keep the value, route to review
            # ── OCR-QUALITY CAP (FREE-TEXT ONLY): for a name/address field there is
            # no regex to validate the read, so the crop's mean OCR confidence is the
            # only quality signal — without this a garbled crop ("Aaiumant Care Homes
            # Ltd - Galaorm") scored in the 90s on usage_count alone. Cap the field
            # confidence at the crop's mean word confidence + a small margin: a clean
            # crop (mean ~90) is unaffected (cap ≥ 95), a poor read (mean ~65) drops
            # to ~70 and is routed to review.
            # SCOPED TO FREE-TEXT: a STRUCTURED value (date/currency/alphanumeric
            # reference) that already passed its regex/type gate is validated by the
            # PATTERN, not by Tesseract's per-glyph confidence — which is routinely
            # low on isolated digit groups and dashes. Applying the cap there sank a
            # correct reference "2602-0768-1" to 18% (mean conf ~13). For those fields
            # the regex IS the trust signal, so the cap (and the Tier-A min-conf
            # signal below) is skipped.
            _is_free_text = val_type in (None, "text", "multiline_text")
            if ocr_conf is not None and _is_free_text:
                conf = min(conf, int(ocr_conf) + 5)
            # ── LOCATED gate: Tier-A trust requires the anchor to be on THIS page ──
            # A label/landmark-confirmed read (text-fallback / inline / relocated /
            # registration) is located by construction. A RIGID anchor_crop is
            # located only if it has NO label (a pure-coordinate anchor, trusted by
            # design) OR its label is actually present here. An AUTHORITATIVE anchor
            # that resolved rigidly with a label gets that label CONFIRMED — a label
            # that can't be found (e.g. the field's own name "Supplier Name", never
            # printed on the page) means the box is a BLIND read of stale coordinates
            # reading the wrong row ("a? Boucher Gres" off the address line). Such a
            # read must NOT win Tier-A over a located mapping, and can't carry a high
            # confidence. Cost (one locate) is paid ONLY for authoritative rigid
            # anchors — the Tier-A claimants; passive/label-less anchors are unchanged.
            located_ok = method in ("anchor", "anchor_inline",
                                    "anchor_crop_relocated", "anchor_registration",
                                    "anchor_crop_crosscheck")
            if not located_ok:                            # a RIGID anchor_crop read
                if not anchor.get("last_authoritative_at"):
                    located_ok = True                     # passive: 'located' never consulted (Tier-A needs authoritative)
                else:
                    # An AUTHORITATIVE rigid read is trustworthy ONLY if its label is
                    # CONFIRMED on this page. A LABEL-LESS anchor (nothing to verify —
                    # e.g. a field-name caption sanitised to empty) is a BLIND
                    # coordinate read that can't self-verify or drift-correct and
                    # silently reads the wrong row ("57 Boucher Crescent" off the
                    # address), so it must NOT be treated as located. A labelled
                    # anchor must have its label actually found here.
                    _lbl = (anchor.get("anchor_label") or "").strip()
                    _loc = (_locate_for_relocation(
                        page0, _lbl, direction,
                        (x_norm, y_norm, anchor.get("w_norm") or 0.0, anchor.get("h_norm") or 0.0),
                        page_text_lines, line_cache=line_cache) if _lbl else None)
                    located_ok = bool(_loc)
                    # 007① (Oracle-corrected): a NAMED cross-supplier authoritative anchor counts
                    # as 'located' ONLY if its caption is at the TAUGHT position — a generic caption
                    # ("Invoice Number") on a DIFFERENT supplier's layout false-locates at a different
                    # absolute position and must NOT certify the rigid absolute-box read (the #1
                    # invoice_number cross-supplier bleed, e.g. Anconia's top-right box reading City
                    # Office's mid-page cell). Same-supplier anchors keep the presence-only test
                    # (their caption IS on their own layout). Below, not-located → conf capped 50 +
                    # the cross-supplier drop, so the field resolves from THIS doc's own reads.
                    if located_ok and _named_cross_supplier(anchor, supplier_name):
                        if not _located_at_taught_position(
                                _loc, x_norm, y_norm,
                                anchor.get("offset_dx_norm"), anchor.get("offset_dy_norm")):
                            located_ok = False
                    # SAME_SUPPLIER_LAYOUT_GATE (gary-designed, Oracle-pending; DARK, default OFF) —
                    # a SAME-supplier authoritative rigid ABSOLUTE read is certified Tier-A on caption
                    # PRESENCE alone (located_ok = bool(_loc) above), so a digital doc that reuses a
                    # scanned template's geometry reads the WRONG region and, if it OCRs credibly, can
                    # auto-file silently. When on, require the caption at the TAUGHT position too — the
                    # looser relocate budget (_RELOC_TOL) + an offset-present precondition so legacy
                    # no-offset anchors (pre-mig-21) are NEVER vetoed. A displaced caption drops through
                    # to conf<=50 + review (value still commits capped / loses to a better read, never
                    # blanked). Own-layout reads keep winning (the caption IS at the taught position).
                    # OFF -> byte-identical. Flip only after Oracle + realdoc M=0 with the switch ON.
                    elif (located_ok
                          and os.environ.get("SAME_SUPPLIER_LAYOUT_GATE", "0") != "0"
                          and anchor.get("offset_dx_norm") is not None
                          and anchor.get("offset_dy_norm") is not None
                          and (anchor.get("offset_dx_norm") or anchor.get("offset_dy_norm"))
                          and not _located_at_taught_position(
                                  _loc, x_norm, y_norm,
                                  anchor.get("offset_dx_norm"), anchor.get("offset_dy_norm"),
                                  tol_x=_RELOC_TOL_X, tol_y=_RELOC_TOL_Y)):
                        located_ok = False
            # HEADING-GARBLE NAME DEMOTION (Oracle 2026-07-12) — the DN-82792 customer_name class.
            # A relocated/placed read on a NAME field that lands on a document CAPTION garble
            # ("Deliver lo", "Deliver To RRS") is marked located BY METHOD (anchor_crop_relocated is
            # unconditionally located) and has its OCR-quality signal NULLED on the relocate path, so
            # it wins the engine Tier-A gate over the clean Stage-1 keyword name. Force located_ok
            # False so it drops through the ≤50 cap below and LOSES the engine merge to the keyword
            # ("Halcyon Leisure Group" / "Primrose Childcare"); with no keyword it shows ≤50 + note
            # -> review. Demotion-only (never selects a value). Protective-token exclusion keeps a
            # legit "Delivery Solutions Ltd" INERT (see _reads_like_heading_garble). Kill switch.
            if located_ok and _reads_like_heading_garble(value, field_key):
                located_ok = False
                if not _relocate_guard_note:
                    _relocate_guard_note = ("This value reads like a document heading, not a name — "
                                            "please verify, or re-teach the field with the ⊕ tool.")
            if not located_ok:
                conf = min(conf, 50)   # blind rigid read (label absent/unfound) — untrustworthy
                # A BLIND read from a NAMED different supplier's anchor is a positional guess learned
                # on another layout — for identity a guess of WHO the doc is ("Contoso / Document
                # Issuer" → "PROFLE CONSTRUCTION"), for a positional field the #1 invoice_number bleed
                # (supplier A's top-right anchor locking supplier B's top-left region). Drop it so the
                # field resolves from THIS doc's own page; a LOCATED read (kept above) still wins.
                if _is_blind_cross_supplier_anchor(field_key, anchor, supplier_name, located_ok,
                                                   identity_labels):
                    if on_reject:
                        on_reject(field_key, method, value, "blind_cross_supplier_anchor")
                    continue
            # Confident recovery (oscar's confident-clean, Oracle-gated): a debris-recovered read
            # whose clean token is LOCATED at the taught position AND matches the field's learned
            # shape is trustworthy. GLYPH SAFETY (revised 2026-07-27, Oracle C5 — the old "only ever
            # stripped NON-alphanumeric debris, satisfied by construction" is STALE since the
            # ANCHOR_CHARSET_DEBRIS arm): stripping never substitutes a glyph, and a stripped
            # bare-ALNUM token is admitted only on (a) the scope's UNANIMOUS confirmed-history
            # charset at support ≥10, (b) crop-boundary edge-contact (clipped-glyph physics), and
            # (c) the vector-REFUTATION below — when the born-digital text layer proves the stripped
            # token was real ink adjacent to the value ("F 14266" printed), the recovery is demoted
            # to capped+flagged, never noteless, never tier 3. Three tiers: an UNLOCATED / OFF-shape
            # / REFUTED recovery is capped + flagged (fail toward review); a LOCATED + shape-matched
            # one drops the flag but stays BELOW the auto-file floor (a one-glance human confirm)
            # UNLESS it is also independently corroborated by the born-digital vector text at the
            # taught row, which lifts it to auto-file-eligible (Oracle condition #4). Harness M=0 +
            # the 61-doc live replay are the safety gates.
            _rec_confident = False
            if method == "anchor_crop_recovered":
                _rec_refuted = bool(_rec_alnum_debris) and _vector_refutes_strip(
                    value, _rec_alnum_debris, anchor, y_norm, page_text_lines)
                _rec_confident = (not _rec_refuted) and bool(located_ok) \
                    and _matches_learned_shape(value, field_key, format_lookup)
                if not _rec_confident:
                    conf = min(70, conf)   # unlocated / off-shape / vector-refuted → capped + flagged
                elif _exact_text_corroborates(value, anchor, y_norm, page_text_lines):
                    # BORN-DIGITAL + independent exact-text agreement on the value's OWN taught row
                    # (Oracle condition #4): the debris-recovered token is confirmed by a fully
                    # independent source (the vector text layer, never OCR — None for scanned, so this
                    # can't fire on same-pixel agreement). Doubly-confirmed → lift the review checkpoint
                    # to auto-file-eligible. Land in [90,95] (above the 88 floor, below a pristine
                    # keyword read) — still a RECOVERED read, just corroborated.
                    conf = min(95, max(conf, 90))
                else:
                    # located + shape-matched but NOT independently corroborated (e.g. a SCANNED page —
                    # the crop and the full-page read are the same pixels): DROP the "please verify"
                    # flag (the value is shape-corroborated), but keep confidence BELOW the auto-file
                    # floor (88) so a debris-recovered read still gets a one-glance human confirm and
                    # never SILENTLY auto-files — regardless of the anchor's usage_count.
                    conf = min(conf, 87)
            results[field_key] = {
                "value":      value.strip(),
                "confidence": conf,
                "method":     method,
                "anchor":     anchor["anchor_label"],
                # True only for an EXPLICIT operator ⊕ re-teach (last_authoritative_at
                # set) — "manually drawn", precedence tier 1. A passively auto-learned
                # anchor is an automatic guess (tier 3); the engine lets an admin label
                # override (tier 2) outrank it but never an authoritative anchor.
                "authoritative": bool(anchor.get("last_authoritative_at")),
                # Whether the anchor was CONFIRMED on this page (see LOCATED gate
                # above). engine Tier-A requires this so a blind authoritative read
                # can't dominate a located mapping. Defaults True for callers/tests
                # that build results directly.
                "located": located_ok,
                # Minimum SUBSTANTIAL-word OCR confidence of the crop that produced
                # this value (None for inline/text reads). The engine's Tier-A gate
                # uses it so an authoritative ⊕ anchor whose crop read a garbled word
                # ("Aaiumant"/"Galaorm" min ~55) does NOT win OUTRIGHT over a clean
                # keyword value — it falls through to the confidence contest, where
                # its OCR-capped confidence loses to the clean read. SCOPED TO
                # FREE-TEXT (same reason as the cap above): a regex-valid structured
                # value isn't judged by Tesseract's digit confidence, so it carries
                # no min-conf signal (None → Tier-A unaffected).
                "ocr_min_conf": ocr_min if _is_free_text else None,
                # fix #2: the relocate read the field's own caption (leading tokens == the
                # taught label). The engine merge guard reads this to prefer a clean keyword
                # over a caption-bleed relocate that name_quality can't distinguish from a name.
                "caption_bleed": _caption_bleed,
                # picker: the winning read's VALUE box (top-left norm) for the disambiguation
                # candidate contract. Emitted ONLY for the instrumented relocate/inline rungs
                # (which set _read_box); any other method -> None so a stale box can't leak.
                "box": _read_box if method in ("anchor_inline", "anchor_crop_relocated") else None,
                # Deskew raw-witness (issue-3): the ORIGINAL taught box (immune to any relocate
                # mutation) for a raw-page re-crop of a crop-derived ref/date read on a --deskew-pages
                # reprocess. None for non-crop methods; the engine reads it only when raw_page0 is set.
                "taught_box": ((x_norm, y_norm, anchor.get("w_norm") or 0.0, anchor.get("h_norm") or 0.0)
                               if method in _CROP_FAMILY_METHODS else None),
            }
            if _xcheck_preflip is not None:
                # C1 (gated): carry the pre-flip crop read to the engine as a transient private
                # key — read + popped by _reconcile_crosscheck_outlier, never persisted.
                results[field_key]["_crosscheck_original"] = _xcheck_preflip
            if method == "anchor_crop_slipfix":
                # Recover-and-flag: surface as an auto-correction (value==corrected_to) routed to
                # review, the same posture as a salvaged date / weak name-repair.
                results[field_key].update({
                    "was_corrected":   True,
                    "corrected_to":    value.strip(),
                    "validation_note": "Corrected a likely OCR misread to the learned format — please verify.",
                })
            elif method == "anchor_crop_recovered" and not _rec_confident:
                # Recover-and-flag: the crop read the right value with OCR clip-debris (". = 317437")
                # but the read is UNLOCATED or OFF the learned shape — trim the debris but surface it
                # for a one-glance confirm. A LOCATED, shape-matching recovery skips this (confident).
                results[field_key].update({
                    "was_corrected":   True,
                    "corrected_to":    value.strip(),
                    "validation_note": "Trimmed OCR debris from the read — please verify the value.",
                })
            elif method == "anchor_crop_crosscheck":
                # Recover-and-flag: the taught crop and the full-page read of the same label
                # DISAGREED; we took the full-page value (native-DPI, generally the truer read)
                # but never let a disagreement file silently — surface it for a human to confirm.
                results[field_key].update({
                    "was_corrected":   True,
                    "corrected_to":    value.strip(),
                    "validation_note": "The taught position and the full-page read disagreed — using the full-page value; please verify.",
                })
            if _xcheck_note and field_key in results:
                # FLAG-ONLY (value-below-label cross-supplier false-locate): KEEP the rigid value (no
                # was_corrected / corrected_to) — only surface the cross-read disagreement for a human.
                results[field_key]["validation_note"] = _xcheck_note
            elif _relocate_guard_note and field_key in results \
                    and not results[field_key].get("validation_note"):
                # NAME-GUARD note (Layers A/B): flag-only — the value (kept rigid, or a capped
                # junk relocate) is surfaced for a human; never overwrites a method-specific note.
                results[field_key]["validation_note"] = _relocate_guard_note
                if _name_guard_junk_note:
                    # ONLY the :586 clean-rigid-vs-off-junk site: mark for the engine keyword-corrob
                    # clear (engine.NAME_GUARD_KEYWORD_CLEAR). The kept value is an independently-clean
                    # name, so a Stage-1 keyword that agrees clears the phantom flag; a STALE clean name
                    # (keyword disagrees) keeps it. The other note sites (garble-IS-the-value / geometric
                    # caption) are deliberately NOT marked — they must keep flagging (Oracle C4).
                    results[field_key]["_name_guard_clearable"] = True
    # After every anchor: if a RE-READ landed on a page caption AND nothing else filled the field,
    # emit an EMPTY row carrying the note so trust.isAutoFileEligible's flagged gate holds the doc for
    # review (never a silent blank auto-file). Same pattern as engine._flag_type_ambiguity. Oracle C2.
    if _caption_detected and _caption_field and _caption_field not in results:
        results[_caption_field] = {"value": None, "confidence": 40, "method": "anchor",
                                   "validation_note": _caption_note}
    return results


def extract_with_anchors(ocr_text: str, anchors: list[dict],
                         supplier_name: str | None,
                         document_type: str | None,
                         page_images: list | None = None,
                         field_patterns: dict | None = None,
                         validation_patterns: dict | None = None,
                         slice_capture = None,
                         format_lookup = None,
                         page_transform = None,
                         on_reject = None,
                         page_text_lines = None,
                         text_field_keys = None,
                         multiline_lookup = None,
                         identity_labels = None) -> dict:
    """
    Attempt to extract field values using saved structural anchors.

    When an anchor has x_norm/y_norm coordinates (set by the user via the ⊕
    selection tool), the page image is cropped to a tight region around the
    value and re-OCR'd. This is far more accurate than full-page text search
    for multi-column layouts where columns bleed into each other in OCR text.

    Falls back to text-based search for anchors without coordinates.

    Returns dict of {field_key: {"value": str, "confidence": int, "method": str}}
    """
    if not anchors or not ocr_text:
        return {}

    relevant = _filter_anchors(anchors, supplier_name, document_type)
    if not relevant:
        return {}

    lines   = ocr_text.split("\n")
    results = {}
    page0   = page_images[0] if page_images else None
    # Per-page OCR cache (Stage 1 / #4): every field whose rigid crop fails does a
    # page-wide label locate; without sharing, each re-ran a full-page image_to_data
    # (~2s). One cache for this page collapses them to a single pass (see
    # template_mapper._locate_anchor). Especially hot when NO template matched and
    # all fields fall here.
    line_cache = {}

    # ── Option C: evaluate anchors GROUPED BY field_key (2026-07-17) ──────────────────────
    # Fields are INDEPENDENT — every `results` access in the former per-anchor loop was the
    # field's OWN key (verified), so groups produce disjoint keys and merge cleanly. Within a
    # group, anchors run in _filter_anchors priority order and the first committable value wins.
    # Stage 2a = MOVE-ONLY: dispatch is sequential in the original order -> byte-identical to the
    # old inline loop. Stage 2b parallelises the groups behind DS_OCR_PARALLEL_FIELDS.
    _groups = {}
    for _a in relevant:
        _groups.setdefault(_a["field_key"], []).append(_a)
    _ctx = (field_patterns, format_lookup, identity_labels, line_cache, lines, multiline_lookup,
            on_reject, page0, page_text_lines, page_transform, slice_capture, supplier_name,
            text_field_keys, validation_patterns)
    _gvals = list(_groups.values())
    # Stage 2b — parallelise the independent field-key groups across cores (each _eval_field_group
    # OCRs its own crops via GIL-releasing tesseract.exe). Gated OFF by default; FORCED SEQUENTIAL
    # under trace/inspector (on_reject/slice_capture set) so dev diagnostics stay in serial order,
    # and when there is <=1 group. Byte-identical: groups write DISJOINT field-keys; line_cache is
    # keyed per crop-box, so we warm any shared entry by running the FIRST group serially, then pool
    # the rest (Oracle cond 4). Each pooled task falls back to a SEQUENTIAL re-run on any abnormal
    # exception (cond 3), so an under-pressure degraded read is "slower", never a silent wrong value.
    _parallel = (os.environ.get('DS_OCR_PARALLEL_FIELDS', '0') != '0'
                 and on_reject is None and slice_capture is None
                 and len(_gvals) > 1)
    if _parallel:
        os.environ['OMP_THREAD_LIMIT'] = '1'   # cap Tesseract OMP (1 = floor; LSTM is 1-core-bound)
        results.update(_eval_field_group(_gvals[0], *_ctx))   # warm shared line_cache entries
        _rest = _gvals[1:]
        try:
            import concurrent.futures as _cf
            _cap = os.environ.get('DS_OCR_POOL_WORKERS')       # optional width override / memory bound
            _maxw = int(_cap) if (_cap and _cap.isdigit() and int(_cap) > 0) else (os.cpu_count() or 1)
            _W = max(1, min(_maxw, 8, len(_rest)))
            with _cf.ThreadPoolExecutor(max_workers=_W) as _ex:
                _pairs = [(g, _ex.submit(_eval_field_group, g, *_ctx)) for g in _rest]
                for g, _fut in _pairs:                         # merge in original group order
                    try:
                        _gr = _fut.result()
                    except Exception:
                        _gr = _eval_field_group(g, *_ctx)      # sequential-retry belt (cond 3)
                    results.update(_gr)
        except Exception:
            for g in _rest:                                    # pool construction failed → sequential
                results.update(_eval_field_group(g, *_ctx))
    else:
        for _ga in _gvals:
            results.update(_eval_field_group(_ga, *_ctx))

    return results


def _caption_top_limit(label_box, direction, relo_box):
    """(P, 007+Oracle) The normalised TOP limit for a relocated value crop so it can't include the
    located caption above it. For a 'below' anchor: located-caption bottom + a tiny gap, but ONLY when
    the caption is cleanly ABOVE the relocated value box (so the clamp can never clip into the value);
    otherwise None (the value abuts/overlaps its caption — leave it to the credibility + caption-
    demotion gates). None on missing input / non-'below' direction. Kill switch RELOCATE_CAPTION_EXCLUDE."""
    if os.environ.get("RELOCATE_CAPTION_EXCLUDE", "1") == "0":
        return None
    if not label_box or direction != "below" or not relo_box:
        return None
    try:
        lb_bottom = float(label_box.get("y_norm", 0.0)) + float(label_box.get("h_norm", 0.0))
        val_top = float(relo_box[1]) - float(relo_box[3]) / 2.0   # relocated value CENTRE - h/2
    except Exception:
        return None
    if lb_bottom < val_top - 0.002:                 # caption genuinely above the value
        return min(lb_bottom + 0.002, val_top)      # just below the caption, never into the value
    return None


def _norm_box_dict(box, centre) -> dict | None:
    """Normalise a VALUE box to {x_norm,y_norm,w_norm,h_norm} TOP-LEFT (the disambiguation-candidate
    contract convention — Oracle: emit the VALUE box, top-left, NEVER the label_box), or None on
    bad/empty input. `centre=True` means the input x,y are the box CENTRE (a relocated/registration
    crop, as `_place_from_located`/`_crop_and_ocr` use) and are shifted to top-left; `centre=False`
    for an already-top-left box (inline_box). Fail-safe None → the candidate becomes a marker-less
    list row rather than a mis-placed marker."""
    if box is None:
        return None
    try:
        if isinstance(box, dict):
            x, y, w, h = box["x_norm"], box["y_norm"], box["w_norm"], box["h_norm"]
        else:
            x, y, w, h = box[0], box[1], box[2], box[3]
        x, y, w, h = float(x), float(y), float(w), float(h)
    except Exception:
        return None
    if w <= 0 or h <= 0:
        return None
    if centre:
        x, y = x - w / 2.0, y - h / 2.0
    return {"x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}


def _is_caption_bleed(cand, label) -> bool:
    """True when a relocated read's LEADING content tokens EQUAL the taught caption's tokens —
    the crop landed on the field's own LABEL, not its value (e.g. relocate "Customer Site tee"
    vs taught label "Customer", the page caption being "Customer Site"). Token-prefix, never
    char-prefix ("Bill Thompson Ltd" does NOT match the label "Bill To"). This ONLY sets a FLAG;
    the demotion (engine `_name_relocate_should_hold`) still requires the relocate to DISAGREE
    with a CLEAN keyword — so a real name that legitimately starts with the caption word
    ("Customer Care Ltd" read correctly) AGREES with the keyword and is never demoted; the flag
    only bites when the keyword read a different clean name (the label-bleed case). Fail-safe
    False on missing/garbled input; requires >=1 caption token and a value at least that long."""
    if not cand or not label:
        return False
    try:
        from extraction import text_normalise
        ct = [t.lower() for t in text_normalise.tokenise(label) if any(c.isalnum() for c in t)]
        vt = [t.lower() for t in text_normalise.tokenise(cand) if any(c.isalnum() for c in t)]
    except Exception:
        return False
    n = len(ct)
    if n < 1 or len(vt) < n:
        return False
    return vt[:n] == ct


# Party/recipient caption PHRASES a garbled taught-box read can land on. Fuzzy-matched (below) so an OCR
# garble of the caption ("Deliver To" -> "Veliver 10°") is caught where the token-EXACT _is_caption_bleed
# can't. Short 4-char captions (Site/etc.) are left to the exact check (joined len < 5 is skipped).
_FUZZY_CAPTION_PHRASES = ("deliver", "delivery", "deliver to", "delivery address", "customer", "client",
                          "consignee", "ship to", "sold to", "bill to", "invoice to", "account")


def _is_fuzzy_caption_bleed(value, label, field_key) -> bool:
    """True → the value's LEADING tokens are an OCR-GARBLED form of a party/recipient CAPTION — the crop
    landed on the field's own label and garbled it ("Veliver 10°" from "Deliver To": D->V, "To"->"10°").
    The FUZZY companion to _is_caption_bleed (token-EXACT, relocate-only); it catches the RIGID anchor_crop
    garble the exact check misses. For each caption phrase: k = its content-token count, cj = its
    alnum-joined form; compare the value's leading-k content tokens (alnum-joined) -> vj; fires when
    normalized Levenshtein(vj, cj) <= 0.35 AND |len(vj)-len(cj)| <= 2 AND len(cj) >= 5 AND len(vj) >= 4.
    "veliver10" vs "deliverto" = 3/9 = 0.33 -> fires. The CALLER additionally requires name_quality < 0.6
    (Oracle C3) so a CLEAN real name that fuzzy-resembles a caption ("Delivery Solutions Ltd" dist 0 to
    "delivery", "Denver Trading" dist 2 to "deliver") is NEVER demoted (it scores 1.0). Vocab =
    _FUZZY_CAPTION_PHRASES + the taught anchor_label. Fail-safe False on missing/short input."""
    if not value:
        return False
    from extraction import keyword as _kw
    vt = [t.lower() for t in re.findall(r"[0-9A-Za-z]+", str(value))]
    if not vt:
        return False
    phrases = list(_FUZZY_CAPTION_PHRASES)
    if label:
        phrases.append(str(label))
    for phrase in phrases:
        ct = re.findall(r"[0-9A-Za-z]+", phrase.lower())
        if not ct:
            continue
        k = len(ct)
        cj = "".join(ct)
        if len(cj) < 5 or len(vt) < k:
            continue
        vj = "".join(vt[:k])
        if len(vj) < 4 or abs(len(vj) - len(cj)) > 2:
            continue
        if _kw._bounded_levenshtein(vj, cj) / max(len(vj), len(cj)) <= 0.35:
            return True
    return False


def _read_window_top_norm(relo_box, val_type, page_h, top_limit_norm) -> float:
    """The WORST-CASE (highest, smallest-y) normalised edge that a value read seated at `relo_box`
    can actually see. Mirrors the two windows that exist downstream:
      (a) `_crop_and_ocr`'s padded crop — centre − (h/2 + 20px), + 0.4·h + 6px more for free text;
      (b) the ladder's PREVIEW FAST PATH re-crop — the tight box's top − 0.5·h of headroom.
    Then applies the caller's (P) clamp, which after slice A really does bound BOTH. Deliberately
    duplicates (a)'s arithmetic rather than refactoring `_crop_and_ocr`: that function is on every
    value-read path in the app and must not change shape for a guard. Keep the two in step."""
    try:
        cx, cy, wn, hn = float(relo_box[0]), float(relo_box[1]), float(relo_box[2]), float(relo_box[3])
        ph = float(page_h)
    except Exception:
        return 0.0
    if wn > 0 and hn > 0:
        half_h = int(hn * ph / 2) + 20
        if val_type in ("text", "multiline_text"):
            half_h += int(hn * ph * 0.4) + 6
    else:
        half_h = 60
    top = max(0.0, (int(cy * ph) - half_h) / ph)
    if wn > 0 and hn > 0:                              # (b) the preview fast path's headroom
        top = min(top, max(0.0, cy - hn / 2.0 - hn * 0.5))
    if top_limit_norm is not None:
        top = max(top, float(top_limit_norm))
    return top


def _is_caption_band_read(value, label, field_key, label_box, relo_box, val_type,
                          page_size, top_limit_norm) -> bool:
    """COMPOSED CAPTION-BAND REJECT (Oracle ruling, 2026-07-20 — the discriminator that content alone
    cannot provide). True → this relocated read must NOT commit, because it is BOTH:
      • CONTENT: an OCR-garbled form of a party/recipient caption (`_is_fuzzy_caption_bleed`, the BARE
        vocab with NO name_quality gate — 'Vetiver 10' scores a perfect 1.0, so the nq<0.6 gate that
        protects the flag family is structurally blind to exactly this class); AND
      • GEOMETRY: the worst-case read window still OVERLAPS the caption the caller POSITIVELY located.

    Why BOTH are load-bearing (Oracle's arithmetic, why two earlier single-signal designs were sent
    back): a full-label echo test MISSES 'Vetiver 10' (normalised lev to "deliverto" = 0.444 > 0.35),
    while the bare k=1 phrase vocab FALSELY rejects the real customer 'Denver Trading'
    (lev("denver","deliver") = 0.286 ≤ 0.35). Content cannot separate them — only geometry can: a real
    name sits BELOW its caption (the caller's clamp then bounds the window and this returns False),
    whereas a caption capture is read from inside the caption band itself.

    ACCEPTED, PINNED COST: a customer whose name genuinely echoes its caption AND is printed ABUTTING
    it (no clean gap, so `_caption_top_limit` cannot clamp) loses this relocate rung and falls back to
    the rigid/keyword read or to review. Fail toward review, never toward a silent wrong value.
    Kill switch CAPTION_BAND_REJECT=0 ⇒ byte-identical."""
    if os.environ.get("CAPTION_BAND_REJECT", "1") == "0":
        return False
    if not value or not label_box or not relo_box:
        return False
    if val_type not in (None, "text", "multiline_text"):
        return False
    try:
        from extraction.value_quality import is_name_like_field as _isnl
        if not _isnl(field_key) or field_key == "supplier_name":
            return False
        if not _is_fuzzy_caption_bleed(value, label, field_key):
            return False
        cap_top = float(label_box.get("y_norm"))
        cap_bottom = cap_top + float(label_box.get("h_norm") or 0.0)
        page_h = page_size[1]
        val_centre = float(relo_box[1])
    except Exception:
        return False                                   # fail-safe: never block a read on bad input
    if val_centre <= cap_top:                          # the value isn't below the caption at all
        return False
    return _read_window_top_norm(relo_box, val_type, page_h, top_limit_norm) < cap_bottom


def _name_junk_shaped(value, field_key) -> bool:
    """True when a NAME-LIKE field's value is JUNK-SHAPED — judged on its NON-ALNUM-STRIPPED
    form (a '#' pushed 'Sso#' to a perfect name_quality: value_quality's token strip set has
    no '#'): a single token with < 4 LETTERS ('Sso'), or name_quality < 0.5. KEY-ONLY
    predicate — is_name_like_field(field_key), never the anchor's caption (a ref field
    taught with the label "Customer Order No." must stay inert). Single clean ≥4-alpha
    tokens ('Jordanstown') and real multi-word names pass. Used by the Layer-A replacement
    backstop and the Layer-B relocate credibility bar (007+gary, 2026-07-10); guarded by
    tests/test_anchor_name_lock_guard.py."""
    if not value:
        return False
    from extraction.value_quality import is_name_like_field, name_quality
    if not is_name_like_field(field_key):
        return False
    stripped = re.sub(r'[^0-9A-Za-z ]+', ' ', str(value)).strip()
    toks = stripped.split()
    if not toks:
        return True
    if len(toks) == 1 and len(re.sub(r'[^A-Za-z]', '', toks[0])) < 4:
        return True
    return name_quality(stripped) < 0.5


# A logo match is only trusted when the winning supplier is DECISIVELY closer than
# any OTHER supplier: if a different supplier's logo sits within this many hamming of
# the winner, the (greyscale) phash can't reliably tell them apart, so we must not guess.
LOGO_AMBIGUITY_MARGIN = 4


def _pick_unambiguous_supplier(by_supplier: dict) -> dict | None:
    """Given {supplier_name: {'dist': int, 'match_count': int}} (each supplier's
    CLOSEST logo distance to the page phash), return the trusted winner
    {supplier_name, confidence, match_count} or None.

    Accept the closest supplier ONLY when it clears the confidence gate (dist small
    enough that 100-dist*6 >= 60) AND is at least LOGO_AMBIGUITY_MARGIN hamming closer
    than the next DIFFERENT supplier. On a near-tie return None so a colour-blind phash
    can't confidently file under the wrong company. Pure/deterministic — unit-tested."""
    if not by_supplier:
        return None
    ranked = sorted(by_supplier.items(), key=lambda kv: kv[1]["dist"])
    best_name, best_info = ranked[0]
    best_dist = best_info["dist"]
    base_conf = max(0, 100 - best_dist * 6)
    if base_conf < 60:                      # ACCEPTANCE keys on the raw hash distance
        return None
    if len(ranked) > 1 and (ranked[1][1]["dist"] - best_dist) < LOGO_AMBIGUITY_MARGIN:
        return None
    # A well-ESTABLISHED logo (confirmed many times) is a reliable identity even at a
    # moderate hash distance — a slightly-noisy scan shouldn't drag a 200x-confirmed
    # supplier to 64%. Reward confirmations with a saturating bonus, capped below 100
    # (a logo alone never reaches auto-file). Acceptance above is unchanged (base only).
    mc = best_info.get("match_count") or 0
    bonus = 32 if mc >= 10 else 18 if mc >= 4 else 8 if mc >= 2 else 0
    confidence = min(98, base_conf + bonus)
    return {"supplier_name": best_name, "confidence": confidence,
            "match_count": best_info["match_count"]}


def try_logo_supplier_match(page_image: Image.Image,
                            logos: list[dict],
                            threshold: int = 12,
                            query_detail_hash: str | None = None) -> dict | None:
    """
    Attempt to identify supplier from logo perceptual hash.
    Returns {"supplier_name": str, "confidence": int} or None.

    AMBIGUITY GUARD: a WRONG supplier is worse than none — it mis-scopes every
    per-supplier learning corpus (hints/anchors/corrections/template identity) and
    files the document under the wrong company. compute_logo_hash is a 64-bit
    GREYSCALE phash, so two marks that share a coarse layout (or differ mainly by
    COLOUR — which greyscale discards) can land only a few hamming apart. Picking the
    global-closest then confidently returns whichever supplier's stored logo happens
    to be marginally nearer. So the winner is accepted ONLY when the next DIFFERENT
    supplier is at least LOGO_AMBIGUITY_MARGIN further away; on a near-tie we return
    None (leave supplier for the keyword/template signals or manual review) instead of
    guessing. A decisively-closer match (genuinely distinct logos) is unaffected, and a
    single-supplier logo set can never be ambiguous — so this only REJECTS a previously
    over-confident wrong guess, never accepts anything new.
    """
    if not logos or page_image is None:
        return None

    try:
        import imagehash
        from PIL import ImageOps, ImageFilter

        w, h   = page_image.size
        crop   = page_image.crop((0, 0, w // 2, h // 5)).convert("L")
        crop   = ImageOps.autocontrast(crop, cutoff=5)
        crop   = crop.resize((256, 256), Image.LANCZOS)
        crop   = crop.filter(ImageFilter.GaussianBlur(radius=1))
        phash  = str(imagehash.phash(crop, hash_size=8))

        # Closest logo distance PER SUPPLIER (several stored logos for one supplier —
        # the multi-reference set — are the SAME identity, never a rival).
        by_supplier: dict[str, dict] = {}
        for fp in logos:
            name = fp.get("supplier_name")
            if not name:
                continue
            dist = _hamming(phash, fp.get("phash", ""))
            cur = by_supplier.get(name)
            if cur is None or dist < cur["dist"]:
                by_supplier[name] = {"dist": dist, "match_count": fp.get("match_count", 1)}
        if not by_supplier:
            return None

        winner = _pick_unambiguous_supplier(by_supplier)

        # SLICE D — PRIMARY detail resolver (kill switch LOGO_DETAIL_PRIMARY, default ON since 2026-07-15
        # — owner-enabled after the NT↔Copperfield logo collision; set env LOGO_DETAIL_PRIMARY=0 to disable,
        # which skips this whole block and keeps the function byte-identical to the veto-only path). When ON and a
        # mark detail hash is present, classify the supplier by NEAREST isolated-mark over ALL enrolled
        # sets — this reaches ACROSS the coarse band, so a look-alike whose coarse phash drifted into a
        # rival's band (doc-193) still resolves to the RIGHT company. AGREE with the coarse winner → keep
        # it untouched (its confidence/bonus intact). DISAGREE, or coarse None/ambiguous → OVERRIDE, but
        # REVIEW-BOUND (conf 69 + note): a supplier re-route is the highest blast radius, and
        # supplier_name is text-typed so the trust.js critical-field floor does NOT guard it — the note
        # is the auto-file block. classify_supplier is FAIL-SAFE: on None/abstain it returns None and we
        # FALL THROUGH to the veto + coarse path below, so the veto still guards the coarse winner even
        # with PRIMARY on (Oracle Seam 3). Method stays 'logo' so the engine _genuine_template_supplier
        # precedence override (which fires only on method.startswith('anchor')) can never re-engage on
        # it (Oracle C3).
        if query_detail_hash and os.environ.get('LOGO_DETAIL_PRIMARY', '1') == '1':
            try:
                import logo_detail
                by_sup_det: dict[str, list] = {}
                for fp in logos:
                    dh = fp.get("detail_hash")
                    sn = (fp.get("supplier_name") or "").strip()
                    if dh and sn:
                        by_sup_det.setdefault(sn, []).append(dh)
                s, _d, band = logo_detail.classify_supplier(query_detail_hash, by_sup_det)
                if s is not None:
                    if winner and (winner.get("supplier_name") or "").strip().lower() == s.strip().lower():
                        return winner            # AGREE → coarse winner untouched (byte-identical)
                    # SPARSE-GUARD (Oracle-signed 2026-07-23; kill LOGO_DETAIL_MISS_SUGGEST=0 ⇒ the
                    # legacy assert-on-miss): the activation A/B measured the COARSE-MISS fill arm
                    # as the 268→131 throughput collapse — a CORRECT pick, asserted at conf 69 + a
                    # review note, on docs whose supplier resolved the SAME name un-noted downstream
                    # (keyword/hints/text) in the starved baseline. So a coarse MISS now returns a
                    # SUGGESTION, never an identity: the engine stashes it and consumes it at
                    # finalisation AFTER the last supplier writer — agree→clean, disagree→note,
                    # still-empty→review-bound fill. A coarse WINNER that the detail POSITIVELY
                    # contradicts keeps today's review-bound override (the collision-healing arm —
                    # that is the job this machinery exists for).
                    # UNIFIED (Oracle re-adjudication 2026-07-23 — his own premise measured false:
                    # on the 2-bit coarse-collision class the WINNER is the RIVAL, so a correct
                    # pick "disagrees" with a wrong winner and the old pre-stage override held 36
                    # clean docs the text gate was already healing). BOTH the miss AND disagree
                    # arms now suggest; the COARSE WINNER is THREADED (Oracle C1 — a bare suggest
                    # dict would silently discard it and the text gate would never judge it: the
                    # dead-guard trap) so the engine intercept re-asserts it exactly as in the
                    # starved baseline. Consumption then judges the pick against the FINAL
                    # resolution: agree→clean file · a STANDING wrong winner→the disagree note
                    # (healing kept, now at the right seam) · empty→text-gated fill. Accepted
                    # trade (named): mid-pipeline pick-scoping on disagree docs is given up —
                    # equal to the starved baseline, proven value-neutral on the corpus. Do NOT
                    # "restore" the pre-stage override to get it back.
                    if os.environ.get('LOGO_DETAIL_MISS_SUGGEST', '1') != '0':
                        return {
                            "suggest_only":  True,
                            "supplier_name": s,
                            "detail_band":   band,
                            "coarse_winner": winner,   # None on the miss arm (today's behaviour)
                        }
                    return {                     # DISAGREE (winner exists) / legacy miss → OVERRIDE, review-bound
                        "supplier_name":   s,
                        "confidence":      69,   # < 70 review threshold AND < 88 critical floor
                        "match_count":     len(by_sup_det.get(s, [])),
                        "method":          "logo",
                        "validation_note": "Company identified from the letterhead logo mark; "
                                           "please confirm it's correct.",
                        "detail_override": True,
                        "detail_band":     band,
                    }
                # classify abstained (None) → fall through to the veto + coarse path (unchanged)
            except Exception:
                pass   # best-effort; never break identification

        # SLICE C — isolated-mark VETO on the supplier-fingerprint path. _pick_unambiguous_supplier's ±4
        # near-tie guard only rejects an AMBIGUOUS-distance pick; a look-alike monogram whose greyscale
        # phash is DECISIVELY closest (the Northgate-doc-reads-Cascade case) sails through. Abstain the
        # pick when the scan's 256-bit mark DETAIL hash POSITIVELY belongs to a DIFFERENT supplier — far
        # from the picked supplier's enrolled set AND close to a rival's (logo_detail.veto_by_detail). This
        # catches the collision even when the TRUE supplier's coarse phash drifted out of band (doc 193).
        # Abstain-only → return None → keyword/text/review; byte-identical for a genuine match (its own
        # mark agrees); fail-safe on missing/empty detail; inert until Slice-B accrues; kill switch.
        if winner and query_detail_hash and os.environ.get('LOGO_DETAIL_VETO', '1') != '0':
            try:
                import logo_detail
                wn = (winner["supplier_name"] or "").strip().lower()
                pick_det, other_det = [], {}
                for fp in logos:
                    dh = fp.get("detail_hash")
                    if not dh:
                        continue
                    sn = (fp.get("supplier_name") or "").strip()
                    if sn.lower() == wn:
                        pick_det.append(dh)
                    elif sn:
                        other_det.setdefault(sn, []).append(dh)
                if logo_detail.veto_by_detail(query_detail_hash, pick_det, other_det):
                    return None
            except Exception:
                pass   # best-effort; never break identification
        return winner

    except ImportError:
        return None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _widen_relocated_crop(box, val_type):
    """Add a modest, CENTRE-PRESERVING margin to a RELOCATED crop so a value
    marginally wider than the tight taught box (a longer name on this page,
    sub-pixel offset rounding) is not sheared at its edges — the "Beaumont"→"mont"
    class of clip. Symmetric, so it never moves the drift-invariant value centre
    that _relocate_value_by_label computed (that position is a tested contract);
    pads are NORMALISED (page-dim fractions), so DPI-invariant. Kept small to stay
    clear of an adjacent label, with extra vertical headroom for text lines
    (ascenders/descenders). Applied ONLY on the relocate fallback crop, so the
    rigid happy path is byte-identical. Reusable across every supplier/field."""
    cx, cy, w, h = box
    pad_w = 0.010
    pad_h = 0.006 if val_type in ("text", "multiline_text") else 0.0
    return (cx, cy, w + 2 * pad_w, h + 2 * pad_h)


def _locate_in_text_lines(text_lines, lbox, anchor_label, confirm_value=None):
    """BORN-DIGITAL path: locate the label among PRECOMPUTED text-layer lines
    (exact vector text, already page-normalised) within the lbox row band, with NO
    crop and NO OCR. Returns the SAME result shape as template_mapper._locate_anchor
    (label-word box + harvested inline value), reusing the shared label-match
    helpers so behaviour matches the OCR path exactly — just exact and faster."""
    from extraction import template_mapper as tm
    needle = tm._normalise(anchor_label) if anchor_label else None
    if not needle or not text_lines:
        return None
    acx = lbox["x_norm"] + lbox["w_norm"] / 2.0
    acy = lbox["y_norm"] + lbox["h_norm"] / 2.0
    band = max(lbox["h_norm"], 0.0)
    cands = []
    for ln in text_lines:
        cy = ln["y_norm"] + ln["h_norm"] / 2.0
        if cy < lbox["y_norm"] - band or cy > lbox["y_norm"] + lbox["h_norm"] + band:
            continue
        s = tm._label_score(needle, tm._normalise(ln.get("text", "")))
        if s >= tm._FUZZY_MATCH_THRESHOLD:
            cands.append((s, ln))
    if not cands:
        return None
    best_score = max(s for s, _ in cands)
    floor = max(best_score - tm._SCORE_TIE_EPSILON, tm._FUZZY_MATCH_THRESHOLD)

    def _dist(ln):
        cx = ln["x_norm"] + ln["w_norm"] / 2.0
        cy = ln["y_norm"] + ln["h_norm"] / 2.0
        return math.hypot(cx - acx, cy - acy)

    _tied = [(s, ln) for s, ln in cands if s >= floor]
    # VALUE-AGREEMENT (see template_mapper._locate_anchor): prefer a label occurrence
    # whose line carries the trustworthy rigid read, even if lower-scoring.
    if confirm_value:
        cv = tm._normalise(str(confirm_value))
        carriers = [(s, ln) for s, ln in cands
                    if s >= tm._FUZZY_MATCH_THRESHOLD and cv and cv in tm._normalise(ln.get("text", ""))]
        if carriers:
            _tied = carriers
    chosen_score, best = min(_tied, key=lambda sl: (_dist(sl[1]), -sl[0]))

    label_box = None
    inline_value = None
    inline_box = None
    words = best.get("words") or []
    _lm = tm._match_label_run(words, needle)
    if _lm:
        run, _lend = _lm
        rx1 = min(w["x_norm"] for w in run)
        rx2 = max(w["x_norm"] + w["w_norm"] for w in run)
        ry1 = min(w["y_norm"] for w in run)
        ry2 = max(w["y_norm"] + w["h_norm"] for w in run)
        label_box = {"x_norm": rx1, "y_norm": ry1, "w_norm": rx2 - rx1, "h_norm": ry2 - ry1}
        # Clip the harvest to the value's OWN column (drop a far heading/column that
        # shares the OCR line) by horizontal-gap clustering off the label's right edge.
        # Value words follow the label run's END index — not len(run): the run can
        # start internally on a merged two-column row (see _match_label_run).
        rest = tm.cluster_value_words(words[_lend:], expect_x=rx2)
        if rest:
            inline_value = " ".join(w["text"] for w in rest).strip() or None
            # Tight bbox of the VALUE words (top-left convention) so the dev trace
            # can highlight exactly where an inline-harvested value was read.
            vx1 = min(w["x_norm"] for w in rest)
            vx2 = max(w["x_norm"] + w["w_norm"] for w in rest)
            vy1 = min(w["y_norm"] for w in rest)
            vy2 = max(w["y_norm"] + w["h_norm"] for w in rest)
            inline_box = {"x_norm": vx1, "y_norm": vy1, "w_norm": vx2 - vx1, "h_norm": vy2 - vy1}
    return {
        "x_norm": best["x_norm"], "y_norm": best["y_norm"],
        "w_norm": best["w_norm"], "h_norm": best["h_norm"],
        "matched_text": best.get("text"), "match_score": chosen_score,
        "label_box": label_box, "inline_value": inline_value, "inline_box": inline_box,
    }


def _locate_for_relocation(page0, anchor_label, direction, vbox, page_text_lines=None,
                           line_cache=None, confirm_value=None):
    """Find `anchor_label` on THIS page and return template_mapper._locate_anchor's
    result (now carrying the matched LABEL-WORD box and any value harvested off the
    same line), or None. Shared by the relocation crop placement AND the inline
    value harvest so the label is located ONCE. When `page_text_lines` (a born-
    digital text layer) is supplied, the label is found EXACTLY in that layer with
    no OCR. `line_cache` (one per page, from extract_with_anchors) shares the
    full-page OCR across every field's page-wide fallback (Stage 1 / #4). Lazy
    import avoids the anchor<->template_mapper module-load cycle."""
    label = (anchor_label or "").strip()
    if not label or page0 is None:
        return None
    cx, cy, vw, vh = (vbox[0] or 0.0), (vbox[1] or 0.0), (vbox[2] or 0.0), (vbox[3] or 0.0)
    if vw <= 0 or vh <= 0:
        return None
    # Search a FULL-PAGE-WIDTH strip at the label's row (not a narrow box beside
    # the value). A key/value value can sit in a FAR column ("label …big gap…
    # value"); a narrow locate box would crop the value out, so it could never be
    # harvested off the located line. Full width keeps the whole row in one OCR
    # line; the located POSITION is still taken from the matched LABEL words, so a
    # wrong nearby label is still rejected by the fuzzy threshold.
    band = max(vh * 2.5, 0.03)
    if direction == "right":      # label on the SAME row as the value
        ly = cy
    elif direction == "below":    # label one line ABOVE the value
        ly = cy - vh
    elif direction == "above":    # label one line BELOW the value
        ly = cy + vh
    else:
        return None
    lbox = {"x_norm": 0.0, "y_norm": _clamp01(ly - band / 2.0), "w_norm": 1.0, "h_norm": band}

    # Born-digital: locate EXACTLY in the embedded text layer (no crop, no OCR).
    if page_text_lines:
        return _locate_in_text_lines(page_text_lines, lbox, label, confirm_value=confirm_value)

    from extraction import template_mapper as tm
    # Local search first (covers normal drift), then page-wide (clipped/heavily
    # shifted scans move the label out of the local window).
    located = tm._locate_anchor(page0, lbox, label, 0.0, tm._ocr_lines,
                                min_search=0.10, line_cache=line_cache, confirm_value=confirm_value)
    if not located:
        located = tm._locate_anchor(page0, lbox, label, 1.0, tm._ocr_lines,
                                    min_search=0.10, line_cache=line_cache, confirm_value=confirm_value)
    return located


def _place_from_located(located, direction, vbox, offset=None):
    """Derive the value-crop box (cx, cy, w, h — _crop_and_ocr convention) from a
    located label. Prefers the tight LABEL-WORD box (`label_box`) over the whole
    OCR-line box, so the value is seated relative to the LABEL not "label …gap…
    value" (the line box overshoots the value). With a stored drift-invariant
    `offset` we replay label-top-left + offset exactly; otherwise we use the coarse
    adjacency guess. (Same return contract as before; the line box is still used
    when no label_box is present, e.g. stubbed tests.)"""
    cx, cy, vw, vh = (vbox[0] or 0.0), (vbox[1] or 0.0), (vbox[2] or 0.0), (vbox[3] or 0.0)
    hw, hh = vw / 2.0, vh / 2.0
    lb = located.get("label_box") or located
    Lx, Ly, Lw, Lh = lb["x_norm"], lb["y_norm"], lb["w_norm"], lb["h_norm"]

    if offset is not None and offset[0] is not None and offset[1] is not None \
       and (offset[0] != 0.0 or offset[1] != 0.0):
        nx = Lx + float(offset[0])
        ny = Ly + float(offset[1])
        return (_clamp01(nx), _clamp01(ny), vw, vh)

    Lcy = Ly + Lh / 2.0
    Lcx = Lx + Lw / 2.0
    gap = 0.004
    if direction == "right":
        nx = Lx + Lw + gap + hw      # value starts just right of the label
        ny = Lcy
    elif direction == "below":
        nx = Lcx
        ny = Ly + Lh + gap + hh
    else:  # above
        nx = Lcx
        ny = Ly - gap - hh
    return (_clamp01(nx), _clamp01(ny), vw, vh)


def _relocate_value_by_label(page0, anchor_label, direction, vbox, offset=None, line_cache=None):
    """Drift recovery for a ⊕-taught anchor: locate `anchor_label` on THIS page and
    return a value-crop box positioned relative to it, or None if it can't be
    found. Thin composition of _locate_for_relocation + _place_from_located (the
    extraction rung uses those two directly so it can ALSO harvest a same-line
    value before falling back to a crop)."""
    vw = vbox[2] or 0.0
    vh = vbox[3] or 0.0
    if vw <= 0 or vh <= 0:
        return None
    located = _locate_for_relocation(page0, anchor_label, direction, vbox, line_cache=line_cache)
    if not located:
        return None
    return _place_from_located(located, direction, vbox, offset)


def _is_low_entropy(v: str) -> bool:
    """Reject obvious OCR debris from a crop that landed on a ruled line or blank
    band: a value with almost no distinct characters ("ee ee ee ee") or one made
    mostly of tiny fragments ("5 de oe et Ee ee ee ee ..."). Shape-based and
    reusable — a real name/address/reference has many distinct characters and
    full-length words, so it is never flagged."""
    nonspace = v.replace(" ", "")
    if len(nonspace) >= 6 and len(set(nonspace.lower())) < 4:
        return True
    tokens = v.split()
    if len(tokens) >= 4:
        short = sum(1 for t in tokens if len(t) <= 2)
        if short >= len(tokens) * 0.6:
            return True
    return False


def _is_bare_label(v: str, label: str | None) -> bool:
    """Reject a read whose EVERY token belongs to the anchor's OWN label — i.e.
    the crop drifted onto the label itself ("Field" where the field caption is
    "...Field", "Work Address" reading the caption). Defined relative to THIS
    anchor's label, so it needs no hardcoded word list; a genuine value that
    merely shares one word with the label is kept (must be a FULL subset)."""
    if not label:
        return False
    label_tokens = set(re.findall(r"[a-z0-9]+", label.lower()))
    val_tokens = re.findall(r"[a-z0-9]+", v.lower())
    if not label_tokens or not val_tokens:
        return False
    return all(t in label_tokens for t in val_tokens)


# Structured val_types eligible for the caption-prefix strip. DELIBERATELY EXCLUDES currency
# (Oracle SEAM A, 2026-07-25): a currency anchor goes through the label-lock/relocate block below,
# whose caption defences (_is_caption_bleed / _is_caption_band_read) detect a caption-landed crop by
# the caption STILL being present in the value — stripping it first would blind that defence and let
# a caption-landed "$500" pass silently. date/reference/number SKIP the label-lock entirely, so there
# is no downstream caption defence for the strip to blind on them. Free-text is excluded in the helper.
_CAPTION_STRIP_TYPES = frozenset({"date", "alphanumeric", "reference_code", "job_reference", "number"})


def _strip_caption_prefix(value, label, val_type, validation_patterns):
    """Recover a STRUCTURED value whose anchor crop captured its own caption/label prefix
    ("Date 22/07/2026" -> "22/07/2026", "No. DN-36457" -> "DN-36457"): strip a leading run of the
    field's OWN taught label words (+ caption punctuation), each of which MUST be followed by
    whitespace — so a GLUED value ("NO-1234", label "no") is never touched (that is the precision
    lever that tells "caption + value" from "value that starts with a caption word"). Structured,
    NON-currency, NON-free-text only. Returns the value UNCHANGED on every no-op path (no label, no
    matching prefix, would-strip-to-empty), so a caption-free read is byte-identical. Never
    manufactures a value: the remainder still faces the UNCHANGED credibility + learned-format gates
    and commits as a plain (non-authoritative) anchor_crop. Precision-first cousin of _is_bare_label."""
    v = (value or "").strip()
    if not v or not label or val_type in (None, "text", "multiline_text", "currency"):
        return value
    if not (validation_patterns or {}).get(val_type):
        return value                       # no format backstop for this type -> don't risk a strip
    words = sorted(set(re.findall(r"[a-z0-9]+", label.lower())), key=len, reverse=True)
    if not words:
        return value
    alt = "|".join(re.escape(w) for w in words)
    # leading punctuation, then 1+ (label-word + optional caption punct + MANDATORY whitespace)
    m = re.match(rf"[^A-Za-z0-9]*(?:(?:{alt})[.:#)\-]*\s+)+", v, re.IGNORECASE)
    if not m or m.end() == 0:
        return value
    remainder = v[m.end():].strip()
    if not remainder or not re.search(r"[A-Za-z0-9]", remainder):
        return value                       # would strip to nothing -> leave it for the gates/review
    return remainder


# Mean OCR word-confidence floor below which a FREE-TEXT rigid crop read is treated
# as suspect (clipped/drifted) and routed to the label-located harvest. Validated
# empirically: garbled cust reads land at 17-34, clean reads at 87-95, so 60 sits in
# a wide empty gap. Free-text only (structured fields trust their regex, not conf).
_FREE_TEXT_RESCUE_CONF = 60


def _name_field_code_reject(value, field_key):
    """CROSS-FIELD guard: a NAME-LIKE field must hold a NAME, never a reference/code.
    On a MERGED OCR row a harvest/relocation can grab the wrong column — e.g. the ticket
    reference "2602-0926-1" sitting on the same OCR line as "Work Address" gets read into
    cust. A code-shaped value has NO run of >= 3 letters; reject it so the field falls
    through (or stays empty for review) instead of committing a cross-field value.
    Reusable: any name-like field, any supplier/layout. Imports value_quality lazily to
    avoid a load cycle."""
    from extraction.value_quality import is_name_like_field
    v = (value or "").strip()
    return bool(v) and is_name_like_field(field_key) and re.search(r"[A-Za-z]{3,}", v) is None


def _is_weak_read(value, val_type):
    """A committable-but-SUSPECT rigid read for a FREE-TEXT field: a single short
    token where a name/address is expected (the "nara"/"Field" fragment class).
    Lets drift recovery run as a CANDIDATE even though the read passed the
    credibility gate. Conservative — only text/multiline fields and only a short
    single token; numbers/dates/refs and multi-word names are never weak, so the
    clean happy path is unaffected."""
    if val_type not in ("text", "multiline_text"):
        return False
    v = (value or "").strip()
    return bool(v) and (" " not in v) and len(v) <= 5


def _should_replace_weak(incumbent, candidate, val_type):
    """Whether a relocation/registration CANDIDATE should replace the current
    value. An empty slot always takes the candidate. A STRONG incumbent is never
    displaced (so a clean rigid read is untouched). A WEAK incumbent is replaced
    only by a clearly stronger candidate (not itself weak, and meaningfully
    longer) — on a clean page the relocated crop reads the SAME value, so it stays
    weak and is NOT preferred, which prevents regressions; only a genuinely better
    read on a drifted page wins."""
    inc = (incumbent or "").strip()
    if not inc:
        return True
    if not _is_weak_read(inc, val_type):
        return False
    cand = (candidate or "").strip()
    return (not _is_weak_read(cand, val_type)) and len(cand) >= len(inc) + 3


def _strict_credible(value, val_type, validation_patterns, ocr_conf=None):
    """Stricter trust test used to decide whether a committed RIGID value should
    yield to a label-anchored harvest. Basic credibility PLUS a single-token rule
    for code-like fields (alphanumeric/job_reference/currency_code) — a reference
    or serial has no internal space, so high-DPI crop GARBAGE that slips through
    the loose pattern ("cield wu", "Ba he WE CUE") is rejected here, while a clean
    single-token read ("2602-0768-1", "INV-001") passes and is never displaced.

    `ocr_conf` (the rigid read's MEAN word confidence, when known): a FREE-TEXT
    rigid read whose mean confidence is below _FREE_TEXT_RESCUE_CONF is a clipped/
    drifted crop whose garbage still clears the loose free-text floor ("Danirmant
    fara WMamac" @ 34) — there is no regex to catch it, so OCR confidence is the
    only quality signal. Treat such a read as NOT strictly credible so the
    label-located harvest rescues it. SCOPED to free-text: a structured value is
    validated by its regex (Tesseract under-reports digit-group confidence, so a
    floor there would sink a valid reference). ocr_conf is None for inline/text
    reads (no crop) and for callers that don't thread it -> fully trusted, so the
    clean happy path and every other caller stay byte-identical."""
    v = (value or "").strip()
    if not v or not _crop_is_credible(v, val_type, validation_patterns):
        return False
    if val_type in ("alphanumeric", "job_reference", "currency_code") and " " in v:
        return False
    if (val_type in (None, "text", "multiline_text")
            and ocr_conf is not None and ocr_conf < _FREE_TEXT_RESCUE_CONF):
        return False
    return True


def _should_replace(incumbent, candidate, val_type, validation_patterns, inc_ocr_conf=None):
    """Whether a label-anchored harvest/relocation CANDIDATE should replace the
    current (rigid) value. GATED RESCUE (Bob): a STRICTLY-credible incumbent is
    never displaced — a clean rigid read is protected, no unconditional override.
    Only when the incumbent FAILS the strict gate AND the candidate PASSES it does
    the candidate win (the high-DPI rigid-garbage case the harvest fixes).
    Otherwise fall back to the conservative weak-free-text rule.

    `inc_ocr_conf` (the incumbent rigid read's mean confidence) lets a LOW-confidence
    free-text incumbent count as not-strictly-credible (see _strict_credible), so a
    clean label-located candidate (no crop conf -> trusted) can displace it. The
    candidate is judged WITHOUT a conf (it came off the located line, not a crop)."""
    inc = (incumbent or "").strip()
    if not inc:
        return True
    if _strict_credible(inc, val_type, validation_patterns, ocr_conf=inc_ocr_conf):
        return False
    if _strict_credible(candidate, val_type, validation_patterns):
        return True
    return _should_replace_weak(inc, candidate, val_type)


# Minimum fraction of a TYPED value that its validation pattern must cover for the
# read to be credible. A real code is one contiguous token (coverage ~1.0); a
# colon-laden MAC the pattern only matches on a 3-char sub-run scores ~0.18 and is
# rejected. 0.8 keeps a clean ref (with its own -/./ separators) at 1.0 while
# excluding the MAC class. Shared by Stage 2 (anchor) and Stage 0.5 (template_mapper).
_CREDIBLE_COVERAGE_MIN = 0.8

# Field validation types whose pattern is PRECISE enough that a full match is
# type-AUTHORITATIVE — the regex IS the format, so a learned digit-position SHAPE must
# not veto it. Deliberately EXCLUDES the generic 'alphanumeric' (matches any token, so a
# drifted "Bookinc" matches it too — a full match there is not authority). mac/ip are
# CODES whose surface varies legitimately across devices (colons, octet lengths).
_PRECISE_VAL_TYPES = frozenset({"mac_address", "ip_address"})
# Coverage (longest single pattern match / value length) that counts as a FULL match.
_PATTERN_AUTHORITATIVE_MIN = 0.95
# Label/landmark-CONFIRMED relocation rungs: the value was read beside the located label
# and already cleared the credibility + column-bleed/code-reject guards, so the learned-
# SHAPE veto (which exists to catch UN-anchored rigid/keyword drift) must not DROP it for
# a legitimately-variable code that merely differs in shape from history.
_LABEL_CONFIRMED_METHODS = frozenset({"anchor_inline", "anchor_crop_relocated", "anchor_registration"})


def _pattern_coverage(v: str, pats) -> float:
    """Fraction of `v` covered by the LONGEST single match of any pattern in `pats`
    (re.search, IGNORECASE), on the whitespace-stripped value. Mirrors the renderer's
    regexScore ("rx N%") so UI and pipeline share ONE coverage metric. A contiguous-
    span measure (not summed chars) is what tells a real code (~1.0) from a value the
    pattern only matches on a disjoint sub-run (the MAC)."""
    s = (v or "").strip()
    if not s:
        return 0.0
    best = 0
    for p in (pats or []):
        m = re.search(p, s, re.IGNORECASE)
        if m and len(m.group(0)) > best:
            best = len(m.group(0))
    return best / len(s)


def _crop_is_credible(value: str, val_type: str | None,
                      validation_patterns: dict | None,
                      label: str | None = None) -> bool:
    """
    Decide whether an anchor result is trustworthy enough to COMMIT, or whether
    it is likely crop drift / a fallback line that landed on the wrong row and
    should be discarded (so the field falls to review instead of a wrong value).

    Reusable across every anchored supplier/field — no supplier, filename, or
    coordinate is referenced:
      * Typed/structured fields (date, currency, alphanumeric, currency_code):
        reuse the SAME validation_patterns the keyword stage trusts — the value
        must match one of them.
      * Free-text fields (text/multiline_text, or no configured type): there is
        no strict pattern, so only reject obvious debris — a value whose first
        real character is punctuation (the ">alifornia" / ". Ship Mode:" failure
        mode) or that is mostly non-alphanumeric. Clean names/addresses pass.
    """
    v = (value or "").strip()
    if not v:
        return False

    # Shape/relationship rejects applied to EVERY field class — a loose typed
    # pattern such as 'alphanumeric' otherwise accepts a bare label word or a
    # repeated-glyph band. Reusable; no supplier/filename/coordinate.
    if _is_low_entropy(v):
        return False
    if _is_bare_label(v, label):
        return False

    pats = (validation_patterns or {}).get(val_type) if val_type else None
    if pats:
        # Date / currency keep substring matching + their upstream salvage path (a
        # "£1,234.00" or junk-wrapped date is rescued later, never rejected here).
        if val_type in ("date", "currency", "currency_code"):
            # Region-normalise an amount to canonical 1234.56 before the (Anglo) currency
            # pattern check, so a Continental "1.234,56" / Swiss "1'234.56" is accepted.
            # No-op for anglo → byte-identical.
            _v = number_format.canonical(v) if val_type == "currency" else v
            return any(re.search(p, _v, re.IGNORECASE) for p in pats)
        # Other typed fields (alphanumeric / reference / code): the pattern must
        # COVER most of the value, so a colon-laden MAC matching only a sub-run is
        # rejected and the field relocates/falls to review instead of committing junk.
        return _pattern_coverage(v, pats) >= _CREDIBLE_COVERAGE_MIN

    # Free-text: must start with an alphanumeric char and be mostly alphanumeric.
    # Also require a minimum of 3 non-space characters — a single letter or two-char
    # fragment ("a", "be") is always an OCR artefact, never a real name/address/value.
    # Typed fields (alphanumeric, currency, etc.) are already gated by their pattern
    # which enforces its own minimum length; this floor only applies to the free-text
    # path so it cannot accidentally tighten structured-field reads.
    if not v[0].isalnum():
        return False
    nonspace = [c for c in v if not c.isspace()]
    if len(nonspace) < 3:
        return False
    alnum    = sum(c.isalnum() for c in nonspace)
    return alnum >= len(nonspace) * 0.5


_DRIFT_FLOOR = 0.03   # ~3% page height — below this a correctly-placed read must not trip


def _value_drifted_from_box(label_box, offset_dy, stored_cy, h_norm) -> bool:
    """True when the value's EXPECTED position (located label top-left + the taught
    vertical offset) sits more than ~1.5 line-heights off the rigid box's stored centre
    — i.e. the rigid crop drifted onto a DIFFERENT row. Conservative floor so a correctly
    placed read never trips it. Used by the labelled-free-text drift guard in
    extract_with_anchors. Pure/coordinate-only — no supplier/filename/document logic."""
    if not label_box or offset_dy is None:
        return False
    try:
        expected_cy = float(label_box.get("y_norm", 0.0)) + float(offset_dy or 0.0)
    except (TypeError, ValueError):
        return False
    return abs(expected_cy - float(stored_cy)) > max(float(h_norm or 0.0) * 1.5, _DRIFT_FLOOR)


# A reference code may legitimately carry INTERIOR separators, and telling that apart from the
# PSM-7 artefact is a SHAPE question. An artefact wedges a separator into an otherwise unbroken run
# ('H7R5326676' -> 'H/7R5326676'), leaving a ragged split with a one-character group. A structured
# code splits into groups that each stand on their own: 'PI/26/6000', 'INV/2024/001', 'OED/91377'.
# Only '/', '.' and '-' can be structural — a '|' or '\' inside a code is a table rule or a stroke
# artefact, never a printed separator, so a token carrying one is still repaired.
_STRUCTURED_CODE_SEP = re.compile(r"^[0-9A-Za-z]{2,}(?:[/.\-][0-9A-Za-z]{2,})+$")


def _repair_single_token(img, segment, val_type):
    """Fix the PSM-7 single-token separator artefact: a value that is ONE token
    (no spaces) — a serial, reference or part number — can come back from PSM 7
    with a spurious "/" "\\" or "|" wedged in ("H7R5326676" -> "H/7R5326676"),
    while PSM 8 (single word) reads the same crop cleanly.

    Re-OCR the SAME prepped crop as a single word and accept it ONLY when it is
    the same alphanumeric token with the junk separator removed — so this can
    never change which characters were recognised, only drop a separator that
    does not belong inside an unbroken token. Multi-word values (names/addresses,
    which contain a space) and date fields (where "/" is legitimate) are left
    untouched. Reusable across every supplier/field; no per-document logic."""
    try:
        if (not segment) or (" " in segment) or val_type == "date":
            return segment
        if not re.search(r"[\\/|]", segment):
            return segment
        # Never strip separators from a DATE-SHAPED token (its "/" "." "-" are the
        # date's own separators) even when the field wasn't typed 'date' — a custom
        # or mistyped field that happens to hold "22/06/2025" must not become
        # "22062025". Shape-based, so it protects every supplier/field; a real
        # serial misread with a spurious slash ("H/7R..", "12/34567") does NOT
        # match this strict layout and is still repaired.
        if re.fullmatch(r"\d{1,4}[./\-]\d{1,2}(?:[./\-]\d{1,4})?", segment):
            return segment
        # STRUCTURED CODE: the guard above only protects a token whose shape is a DATE, so a
        # reference that legitimately carries separators ('PI/26/6000') falls straight through and
        # is re-read with a whitelist that CANNOT emit '/', which then matches on alphanumerics and
        # is accepted — silently deleting a printed character from a correct value.
        # MEASURED on the live install (2026-08-10, read-only census over documents whose page text
        # is stored): 36 committed invoice_numbers had lost a separator their own page still prints,
        # every one of them through the template_mapping rung, and this predicate keeps the
        # separator on 36 of 36 while the docstring's own artefact example ('H/7R5326676', whose
        # first group is a single character) is still repaired. Short-circuits BEFORE the extra
        # OCR passes, so an armed run is also cheaper on these tokens.
        # DEFAULT OFF — off is byte-identical. Arm: CODE_SEPARATOR_STRUCTURE_GUARD=1.
        if (os.environ.get("CODE_SEPARATOR_STRUCTURE_GUARD", "0") != "0"
                and not re.search(r"[\\|]", segment)
                and _STRUCTURED_CODE_SEP.match(segment)):
            return segment
        import pytesseract
        # Re-read the SAME prepped crop with configs that cannot emit (or don't
        # invent) the spurious "/" "\\" "|": PSM 7 + alphanumeric whitelist (line
        # mode keeps robustness to padding), then PSM 8 / PSM 8+whitelist (single
        # word — reads tight serials cleanest). Accept the FIRST whose recognised
        # alphanumerics are identical to the corrupted read — so this only strips
        # a junk separator and never changes which glyphs were recognised.
        wl = ("-c tessedit_char_whitelist="
              "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-")
        target = re.sub(r"[^0-9A-Za-z]", "", segment)
        for cfg in ("--oem 3 --psm 7 " + wl,
                    "--oem 3 --psm 8 " + wl,
                    "--oem 3 --psm 8"):
            alt = pytesseract.image_to_string(img, config=cfg).strip().split("\n")[0].strip()
            if alt and re.sub(r"[^0-9A-Za-z]", "", alt) == target:
                return alt
    except Exception:
        pass
    return segment


def _trim_trailing_digit_boundary(segment: str) -> str:
    """Trim a postcode/year boundary from a free-text value: a 4+ digit run that
    is preceded by AT LEAST TWO alphabetic words ("Ann Blume 10115 Berlin" ->
    "Ann Blume"). Fewer leading alpha words means the digits are most likely the
    VALUE'S OWN number (e.g. "Unit 4 1024 Park", "Site 4012"), so the segment is
    kept whole — the previous blanket `\\s+\\d{4,}` split amputated such values
    (a worksheet name/address line cut down to a fragment). Never returns an
    empty head."""
    m = re.search(r'\s+\d{4,}', segment)
    if not m:
        return segment
    head = segment[:m.start()].strip()
    alpha_words = [w for w in head.split() if any(c.isalpha() for c in w)]
    return head if (len(alpha_words) >= 2 and len(head) >= 2) else segment


def clean_crop_segment(text: str | None, val_type: str | None) -> str | None:
    """Select the value segment from a (possibly multi-line) OCR crop read.

    SHARED by the Stage 2 anchor crop (_crop_and_ocr) and the Stage 0.5
    template-mapping crop (template_mapper._clean_value) so a drawn target zone
    is cleaned IDENTICALLY to a learned-anchor crop — one rule, system-wide.

    Rules, in order, on the FIRST non-empty line. NOTE (2026-07-23): the padded crop
    structurally holds ~1.5-2.2 text rows, so "first line wins" commits/rejects on
    whichever row Tesseract emits first — when ANCHOR_LINE_SELECT is active the crop
    LADDER supersedes this take per rung with a band-gated per-line chooser
    (select_row_line); this function remains the fall-through and the rule for every
    other caller.
      * Split off Tesseract column-gap noise: 4+ spaces (every field type).
      * For free-text name/address fields (text/multiline_text) ONLY, trim a
        TRAILING postcode/year boundary via _trim_trailing_digit_boundary —
        shape-aware so it never discards a value whose own token is the number
        (reference numbers/amounts are not text-typed and keep their digits).
      * After 2+ words, a word ending in "," is a city separator, not value.
    Returns None when nothing usable remains. Does NOT do single-token separator
    repair (that needs the prepped image; callers apply _repair_single_token)."""
    if not text:
        return None
    for line in text.split("\n"):
        segment = _clean_one_line(line, val_type)
        if segment:
            return segment
    return None


def _clean_one_line(line: str | None, val_type: str | None) -> str:
    """Clean ONE OCR line into a value segment (the per-line body of clean_crop_segment):
    column-gap split (4+ spaces), trailing postcode/year trim for free-text, city-comma cut.
    Returns '' when nothing usable remains. Factored out so a CONTINUATION line is cleaned
    IDENTICALLY to line 1 — shared by clean_crop_segment and join_continuation."""
    line = (line or "").strip()
    if not line:
        return ""
    segment = re.split(r' {4,}', line)[0].strip()
    if val_type == 'currency':
        # Region-normalise (Continental/Swiss/… → canonical 1234.56; no-op for anglo) BEFORE
        # the Anglo OCR-split-thousands rejoin, so the stored amount is canonical.
        segment = _normalise_currency_spacing(number_format.canonical(segment))   # rejoin an OCR-split thousands sep
    if val_type in ('text', 'multiline_text'):
        segment = _trim_trailing_digit_boundary(segment)
    parts = segment.split()
    end = len(parts)
    for i, w in enumerate(parts):
        # A word ending in ',' after 2+ words is a city separator ("… Ltd, Comber") — but ONLY
        # when it's followed by more words. A TRAILING comma on the LAST word ("Greenfield
        # Nursing Home,") is a line-wrap marker, not a city cut, so it must not truncate the value.
        if i >= 2 and i < len(parts) - 1 and w.endswith(','):
            end = i
            break
    return ' '.join(parts[:end]).rstrip(',;').strip()


# Lifted to number_format so the Stage-1 keyword currency path can share it — it was
# anchor-only, so the two paths drifted ("$15 707.84" truncated to "$15" on the keyword
# path). The alias keeps this module's existing call sites unchanged.
_normalise_currency_spacing = number_format.normalise_currency_spacing


def _clean_text_fallback(value: str | None, val_type: str | None,
                         validation_patterns: dict | None) -> str | None:
    """Trim a TEXT-FALLBACK value (a raw line remainder taken after a located
    label). For a STRUCTURED type (date / currency / currency_code /
    job_reference) whose pattern is specific, return the FIRST match so a value
    followed by bled label/address text ("2605-0769-1 Work Address …") narrows to
    "2605-0769-1". 'alphanumeric'/'text' are intentionally loose (they match any
    word), so they are NOT pattern-extracted — that could grab a leading label
    word; the shared clean_crop_segment handles them instead. Reusable across
    every supplier/field — no per-document logic."""
    if not value:
        return None
    STRUCTURED = {"date", "currency", "currency_code", "job_reference"}
    if val_type in STRUCTURED:
        # Rejoin an OCR-split thousands separator FIRST, else the contiguous currency
        # pattern truncates "$10 576.31" to "$10" (see _normalise_currency_spacing).
        v = _normalise_currency_spacing(value) if val_type == "currency" else value
        for p in (validation_patterns or {}).get(val_type) or []:
            m = re.search(p, v, re.IGNORECASE)
            if m:
                return m.group(0).strip(" -:;,")
    return clean_crop_segment(value, val_type)


_STRUCT_READ_TYPES = frozenset({"alphanumeric", "reference_code", "date"})   # job_reference (spaces) excluded


def _struct_prep(crop):
    """STRUCT_CODE_READ (Oracle SIGN-OFF-WITH-CONDITIONS 2026-08-03, slice 1 — PREP ONLY): read a
    tight structured code/date crop cleanly, curing the '»0-17039'/'09-06-2026' garble at the READ.
    Three prep changes, no whitelist:
      • CAP-HEIGHT-DRIVEN UPSCALE — a WIDE ~13px code crop gets NO upscale on the light rung
        (_light_prep only upscales width<300px) → native-13px starvation. Scale so cap height lands
        in Tesseract's ~30-40px comfort band (target 34), from the measured ink-band height.
      • SYNTHETIC READ-TIME QUIET ZONE — a median-grey border (paper luminance) so the leading glyph
        has left context + ascender/descender headroom. This is a border on the PIXELS FED to
        Tesseract, NOT a wider crop-window — it feeds no neighbouring ink (the 007 seam distinction).
      • NO SHARPEN — the heavy rung's Laplacian SHARPEN is what manufactures the '»' on the
        unsupported leading glyph.
    Deliberately NO char whitelist — that is a separately-gated slice 2: the gateless Stage-0.5
    absolute path has no learned-shape backstop, so a whitelist could snap a mis-segmented glyph to a
    clean-SHAPED wrong code that auto-files (Oracle seam 2). Prep-only preserves fail-toward-review:
    a genuinely ambiguous glyph still garbles → credibility fails / the reads disagree → review."""
    from PIL import ImageOps
    import numpy as np
    g = crop.convert("L")
    try:
        from ocr.region_core import _ink_band_height
        ib = _ink_band_height(g)
        scale = min(4.0, max(1.0, 34.0 / max(ib, 1)))
    except Exception:
        scale = 2.0                                    # fail-safe = today's heavy upscale floor
    if scale > 1.0:
        g = g.resize((max(1, int(g.width * scale)), max(1, int(g.height * scale))), Image.LANCZOS)
    try:
        bg = int(np.median(np.asarray(g)))
    except Exception:
        bg = 255
    return ImageOps.expand(g, border=12, fill=bg)      # synthetic quiet zone, not a wider window


def _light_prep(image):
    """LIGHT crop prep for the first OCR rung: greyscale, plus an upscale ONLY for
    a small crop (tiny numeric tokens need ~300px to read). No autocontrast and no
    sharpen — both AMPLIFY a clean crop's decorative border/rule into a garbage
    "line" that PSM 7 locks onto ("Beaumont Care Homes Ltd" → a row of junk), the
    bench-proven failure. An already-legible crop is read essentially as-is (the
    winning raw read); the heavy upscale+autocontrast+SHARPEN recipe stays as a
    LATER rung for tight degraded serials. (Oscar: preprocess only when needed.)"""
    img = image.convert("L")
    w, h = img.size
    if w < 300:
        scale = max(2, 300 // max(1, w))
        img = img.resize((w * scale, h * scale), Image.LANCZOS)
    return img


def _read_lines_full(img, psm):
    """One image_to_data pass → (text, mean_word_conf, min_word_conf, lines).
    The single implementation behind _read — SAME Tesseract call, SAME first three
    outputs, byte-identical — that ALSO keeps the per-word GEOMETRY the dict already
    carries (top/height/line_num, previously received and discarded): `lines` is a
    list of per-visual-line dicts {text, top, height, mean_conf, min_conf} in IMAGE
    px, for the ANCHOR_LINE_SELECT per-line chooser. Zero extra OCR cost. Per-line
    min_conf mirrors the whole-read rule: min over that line's SUBSTANTIAL words
    (alphabetic, length ≥ 3), else the line's mean."""
    import pytesseract
    from pytesseract import Output
    try:
        d = pytesseract.image_to_data(img, config=f"--oem 3 --psm {psm}", output_type=Output.DICT)
    except Exception:
        return "", 0.0, 0.0, []
    lines, confs, word_confs = {}, [], []
    for i in range(len(d.get("text", []))):
        t = (d["text"][i] or "").strip()
        try:
            c = float(d["conf"][i])
        except Exception:
            c = -1.0
        if not t or c < 0:
            continue
        key = (d["block_num"][i], d["par_num"][i], d["line_num"][i])
        g = lines.get(key)
        if g is None:
            g = lines[key] = {"w": [], "c": [], "sc": [], "y0": None, "y1": None}
        g["w"].append(t)
        g["c"].append(c)
        try:
            T, H = int(d["top"][i]), int(d["height"][i])
            g["y0"] = T if g["y0"] is None else min(g["y0"], T)
            g["y1"] = (T + H) if g["y1"] is None else max(g["y1"], T + H)
        except Exception:
            pass   # geometry-less stub rows: line still carries text/confs
        confs.append(c)
        # A "substantial" word for the min — skip 1-2 char tokens and punctuation
        # ("-", ":", "Co") whose OCR confidence is noisy and not name-bearing.
        if len(t) >= 3 and sum(ch.isalpha() for ch in t) >= 3:
            word_confs.append(c)
            g["sc"].append(c)
    text = "\n".join(" ".join(lines[k]["w"]) for k in sorted(lines.keys())).strip()
    mean = (sum(confs) / len(confs)) if confs else 0.0
    min_conf = min(word_confs) if word_confs else mean
    out = []
    for k in sorted(lines.keys()):
        g = lines[k]
        lmean = sum(g["c"]) / len(g["c"])
        out.append({"text": " ".join(g["w"]),
                    "top": g["y0"] if g["y0"] is not None else 0,
                    "height": max(0, (g["y1"] or 0) - (g["y0"] or 0)),
                    "mean_conf": lmean,
                    "min_conf": min(g["sc"]) if g["sc"] else lmean})
    return text, mean, min_conf, out


def _read(img, psm):
    """One image_to_data pass → (text, mean_word_conf, min_word_conf).
    Thin wrapper over _read_lines_full (the single implementation) — kept so the
    non-ladder callers (_noise_smooth_retry, the text_enhance escalation) keep their
    3-tuple contract. Reconstructs lines from word boxes (block/par/line) so
    clean_crop_segment still sees real line breaks, and averages positive word
    confidences as a deterministic rung tie-breaker. Also returns the MINIMUM
    confidence over the SUBSTANTIAL words (alphabetic, length ≥ 3) — a discriminator
    the mean dilutes: a name like "Aaiumant Care Homes Ltd Galaorm" has three clean
    words masking two garbled ones, so its mean stays moderate while its min (the
    garbled word) drops. Used to gate the authoritative-anchor outright win. min ==
    mean when no substantial word is present. Same OCR cost as image_to_string."""
    text, mean, min_conf, _lines = _read_lines_full(img, psm)
    return text, mean, min_conf


_NOISE_RETRY_MIN_CONF = 60.0   # a free-text read with a substantial word below this is
                               # "shaky" -> worth a smoothed downscale retry.


_PREVIEW_DOWNSCALE = 0.4   # 300 DPI extraction render -> ~120 DPI ≈ the 108 DPI on-screen
                          # preview the draw tool reads. Bench-proven sweet spot (doc 146).
_PREVIEW_ACCEPT_MIN = 55  # a preview-scale free-text read this confident (min substantial-
                          # word conf) is taken as the primary read; below it, fall through
                          # to the full-resolution ladder (tiny text that needs the detail).


def _noise_smooth_retry(crop, val_type, base_min, page=None, box=None, top_limit_norm=None):
    """Reproduce the on-screen DRAW TOOL's read so extraction reads what the operator can
    read perfectly with a target box. The draw tool wins for TWO reasons, both reproduced
    here: (1) it reads the ~108 DPI PREVIEW image — the 300 DPI extraction render amplifies
    scan noise into a credible-but-GARBLED name ("Beaumont Care Homes Ltd - Holywood" ->
    "oceaumont Care homes Lid - nolywooa") that still passes the loose free-text gate, so
    the ladder commits garbage and the heavy rung's SHARPEN only makes it worse; and (2) a
    hand-drawn box has vertical HEADROOM, whereas the stored tight box clips glyph
    tops/bottoms. So when the page + the value's normalised box are available, RE-CROP with
    headroom and downscale to ≈the preview scale (bench-proven to recover the EXACT
    "Beaumont Care Homes Ltd - Holywood", min conf 92, where the tight 300 DPI crop reads
    junk); otherwise just downscale the given crop. Return (seg, mean, min) ONLY when
    CLEANER than the base read — a higher MINIMUM substantial-word confidence (the mean
    dilutes a couple of garbled words; the min is the discriminator). The smaller image
    also OCRs FASTER. Free-text only; gated on a shaky base read, so clean/structured/
    numeric crops never reach here.

    top_limit_norm (slice A, 2026-07-21): the caller's (P) CAPTION-BAND clamp. THE HOLE THIS CLOSES —
    `_crop_and_ocr` clamped its OWN window to keep the located caption out, then handed this function
    the page + the UNCLAMPED value box, so the headroom re-crop below (box top − 0.5·h) RESTORED the
    caption band and `clean_crop_segment` (first line wins) returned the CAPTION as the value. The
    clamp is only real once it reaches HERE. Applied to the page re-crop only; if the clamp makes that
    crop degenerate we simply don't offer it, and the FALLBACK below downscales the crop we were handed
    — which the caller already clamped — so we fall back to the CLAMPED read, never to an unclamped
    one. None ⇒ every existing caller is byte-identical."""
    try:
        candidates = []
        # PRIMARY: re-crop from the page with vertical headroom, then downscale to the
        # preview resolution — the closest reproduction of the draw tool's read.
        if page is not None and box is not None:
            try:
                pw, ph = page.size
                padh = (float(box.get("h_norm") or 0.0)) * 0.5   # headroom for ascenders/descenders
                x0 = max(0, int(float(box["x_norm"]) * pw))
                y0 = max(0, int((float(box["y_norm"]) - padh) * ph))
                x1 = min(pw, int((float(box["x_norm"]) + float(box["w_norm"])) * pw))
                y1 = min(ph, int((float(box["y_norm"]) + float(box["h_norm"]) + padh) * ph))
                if top_limit_norm is not None:      # slice A: honour the caller's caption clamp
                    y0 = max(y0, int(float(top_limit_norm) * ph))
                if x1 > x0 and y1 > y0:
                    pc = page.crop((x0, y0, x1, y1))
                    cw, ch = pc.size
                    candidates.append(pc.resize((max(1, int(cw * _PREVIEW_DOWNSCALE)),
                                                 max(1, int(ch * _PREVIEW_DOWNSCALE))), Image.LANCZOS))
            except Exception:
                pass
        # FALLBACK: downscale the (tight) crop we were handed — ONLY when we couldn't
        # re-crop from the page (no page/box, e.g. a stub). When the page re-crop above
        # succeeded it's the better read, so don't pay a second OCR pass on the tight crop.
        if not candidates:
            w, h = crop.size
            if w >= 240:
                candidates.append(crop.resize((max(1, int(w * _PREVIEW_DOWNSCALE)),
                                               max(1, int(h * _PREVIEW_DOWNSCALE))), Image.LANCZOS))
        best = None
        for sm in candidates:
            sp = _light_prep(sm)          # greyscale + upscale-small-only, no autocontrast
            for psm in (6, 7):
                t, c, m = _read(sp, psm)
                seg = clean_crop_segment(t, val_type)
                if seg:
                    seg = _repair_single_token(sp, seg, val_type)
                if seg and (best is None or m > best[2]):
                    best = (seg, c, m)
        if best and best[2] > base_min:   # cleaner: higher min substantial-word confidence
            return best
    except Exception:
        pass
    return None


# ── ANCHOR_LINE_SELECT — per-line candidate selection for the anchored crop read ──
# (Oracle-signed design 2026-07-23: docs/designs/ANCHOR_LINE_SELECT_2026-07-23.md.)
# The crop pad is a FIXED +20px half-height, so a single-row taught box structurally
# crops ~1.5-2.2 text rows and skew slides the adjacent row in half-sliced; the
# first-line take then commits/rejects on the WRONG row's garbage. The chooser reads
# ALL the rung's lines (already in the same image_to_data pass) and commits the ONE
# line inside the taught row's band that passes the rung's own gates — never
# nearest-wins, never a second-best. Scope: structured types only.
#
# THE LADDER NOTE (Oracle's closing condition — do not remove lower rungs):
# 2026-07-23's four rulings form a deliberate ladder: LINE_SELECT fixes the READ ·
# the crosscheck+E2 (CROSSCHECK_KEYWORD_CLEAR) arbitrates a DISAGREEMENT with a real
# witness · clean-accept (GATE_REREAD_CLEAN_ACCEPT) stops flagging a NON-correction ·
# the review flag survives wherever no second independent read exists. Each layer's
# guard assumes the one below still fires — a future "simplification" that removes
# the crosscheck because "LINE_SELECT made it quiet" reopens the City Office silent
# digit-mangle class.

_LINE_SELECT_TYPES = ("date", "alphanumeric", "job_reference", "currency_code")
# Free-text (incl. None) is EXCLUDED (its preview fast path + loose gates are a
# different regime); currency is EXCLUDED (its all-rows-regex-valid stacked-totals
# geometry is handled by the label lock / _skip_rigid, and every totals row would
# qualify here — the chooser could only ever abstain or pick a wrong-but-valid row).


def _row_band(cy_px: float, box_h_px: float, y1_px: float) -> tuple:
    """The TAUGHT row's vertical band in CROP px: the un-padded taught box height
    centred on the stored value centre, expressed relative to the crop's FINAL top
    edge (after any grace expansion + caption clamp). Pure arithmetic — computed
    ONCE per crop in _crop_and_ocr from its own args and rescaled PER RUNG by the
    prepped image's height ratio (the prep upscales ×2-3; a once-per-crop scale is
    the frame bug)."""
    top = (cy_px - box_h_px / 2.0) - y1_px
    bottom = (cy_px + box_h_px / 2.0) - y1_px
    return (top, bottom)


def select_row_line(lines, band, val_type, qualify_fn, edge_exclude=None):
    """Pick THE line inside the taught row band, or None (→ the caller falls
    through to the exact status-quo whole-text path for that rung).

    lines: _read_lines_full per-line dicts, in the SAME px frame as `band` (the
    caller rescales the band to the rung image). Selection, top-sorted:
      1. _clean_one_line (the same per-line cleaning the first-line take used);
      2. band overlap ≥ 50% of min(line_height, band_height) — the narrower-box
         convention (_x_overlap's vertical twin);
      3. the rung's existing qualify_fn (verify_fn = credibility + learned-format
         — NO new predicates);
      4. `date` additionally: validator.parse_date non-None (a shape-valid
         non-date like "99/99/2026" must NOT qualify).
    EXACTLY ONE in-band qualifier → (line, cleaned_seg). Zero or ≥2 → None —
    NEVER nearest-wins (an ambiguous crop is a review problem, not a coin toss).
    An out-of-band qualifier alone is also None: never commit another field's row.

    edge_exclude (slice 2, ANCHOR_ROW_GRACE only): (low, high) px bounds — a line
    whose bbox touches the crop top/bottom edge is half-sliced by construction, so
    it is INELIGIBLE (row-integrity by disqualification). None ⇒ no exclusion."""
    if not lines or not band or qualify_fn is None:
        return None
    band_top, band_bottom = float(band[0]), float(band[1])
    band_h = max(1.0, band_bottom - band_top)
    chosen = None
    for ln in sorted(lines, key=lambda l: l.get("top", 0)):
        top = float(ln.get("top", 0))
        height = max(1.0, float(ln.get("height", 0)))
        if edge_exclude is not None:
            lo, hi = float(edge_exclude[0]), float(edge_exclude[1])
            if top <= lo or (top + height) >= hi:
                continue   # half-sliced edge line: ineligible (slice 2)
        overlap = max(0.0, min(top + height, band_bottom) - max(top, band_top))
        if overlap / min(height, band_h) < 0.5:
            continue
        seg = _clean_one_line(ln.get("text"), val_type)
        if not seg:
            continue
        if not qualify_fn(seg):
            continue
        if val_type == "date":
            from extraction import validator   # lazy: avoid a module-load cycle
            if validator.parse_date(seg) is None:
                continue
        if chosen is not None:
            return None   # ≥2 in-band qualifiers → ambiguous → status quo (pin a)
        chosen = (ln, seg)
    return chosen


def _ocr_crop_laddered(crop, val_type=None, verify_fn=None, meta=None, page=None, box=None,
                       top_limit_norm=None, row_band=None, edge_ineligible=False):
    """Light-first OCR ladder on an ALREADY-CROPPED image -> cleaned best-rung text
    (or None). SHARED by anchor._crop_and_ocr (centre+dims crop) and
    template_mapper._crop_and_ocr (drawn-box crop) so every value-crop path reads with the
    SAME recipe and writes the SAME confidence into 'meta' (meta['conf'] = mean word conf,
    meta['min_conf'] = min substantial-word conf). The heavy autocontrast+SHARPEN recipe
    (which mangles a clean printed line into junk) is now only a LATER rung, not the
    unconditional one. A gateless caller (verify_fn None -- the Stage 0.5 path, which gates
    separately) accepts the first rung over a conf floor and otherwise returns the best
    read, so its return shape is unchanged.

    page + box (optional, the source page and the value's normalised box): enable the
    PREVIEW-SCALE FAST PATH for free-text — read the crop the way the on-screen draw tool
    does (re-crop with headroom, downscale to ≈the 108 DPI preview) which is both cleaner
    on degraded scans AND faster. Without them the ladder runs unchanged.

    top_limit_norm: the caller's (P) caption-band clamp, threaded to BOTH `_noise_smooth_retry`
    sites so the re-crop can't reach back above it (slice A — see that function's docstring).

    row_band (ANCHOR_LINE_SELECT, kill-switched, DEFAULT OFF): the taught row's vertical
    band in CROP px (see _row_band). When active + in scope, each rung tries the per-line
    chooser (select_row_line) BEFORE the whole-text first-line take; EXACTLY ONE in-band
    qualifier commits with meta from the SELECTED LINE's words only (the whole-crop min
    includes the garbled neighbour and would falsely demote a correct read out of Tier-A);
    zero/≥2/any exception falls through to the exact status-quo path for that rung —
    including the best_seg bookkeeping and the no-rung-gated return-best path. The chooser
    result flows back to the CALLING RUNG's own commit, so method stays rung-native
    (anchor_crop / anchor_crop_relocated / anchor_registration — forcing 'anchor_crop'
    would erase relocate provenance). edge_ineligible (ANCHOR_ROW_GRACE, slice 2 — DARK):
    a line whose bbox touches the crop's top/bottom edge is ineligible in the chooser."""
    def _set_meta(c, mn):
        if meta is not None:
            meta['conf'] = c
            meta['min_conf'] = mn

    # ── PREVIEW-SCALE FAST PATH (free-text only) ─────────────────────────────────
    # The draw tool reads value crops at the ~108 DPI PREVIEW and reads degraded scans
    # CLEANLY; the 300 DPI extraction render amplifies scan noise into a garbled-but-
    # credible name. Reproduce the draw tool FIRST for free-text: a confident preview read
    # is both cleaner and FASTER (smaller image) than the full-res ladder, so it wins
    # outright; an unconfident one (tiny text needing the detail) falls through. Needs the
    # page + box to re-crop with headroom — absent (a test stub) → ladder unchanged.
    if val_type in (None, "text", "multiline_text") and page is not None and box is not None:
        pv = _noise_smooth_retry(crop, val_type, -1.0, page=page, box=box, top_limit_norm=top_limit_norm)
        if pv is not None and pv[2] >= _PREVIEW_ACCEPT_MIN and (
                bool(verify_fn(pv[0])) if verify_fn is not None else pv[1] >= 60.0):
            _set_meta(pv[1], pv[2])
            return pv[0]
    # Light-first OCR ladder (Oscar): preprocess only when needed. A clean,
    # high-res crop reads correctly with minimal processing — the heavy prep
    # (upscale + SHARPEN) over-processes it and PSM 7 then returns garbage or
    # empty ("Beaumont Care Homes Ltd" → "nara"/""). So try LIGHT (greyscale +
    # upscale + autocontrast, NO sharpen) first, and escalate to the heavy prep
    # (which crispens tight degraded serials so _repair_single_token can strip a
    # hallucinated "/" — the reason prep exists) and then the denoise enhance
    # ONLY when the lighter read fails the gate. Each rung is scored by a single
    # image_to_data pass (mean word confidence) so the winner is deterministic.
    # _repair_single_token runs on every rung so even a light-rung serial gets
    # its separator scrubbed. One ladder, reusable for every supplier/field.
    # Lazy import avoids the anchor<->template_mapper module-load cycle.
    from extraction import template_mapper as _tm

    def _gate(seg, conf):
        # verify_fn (the anchor path) is authoritative; a gateless caller
        # (defensive — anchor calls always pass verify_fn) uses a conf floor.
        if verify_fn is not None:
            return bool(seg) and bool(verify_fn(seg))
        return bool(seg) and conf >= 60.0

    light = _light_prep(crop)
    heavy = None
    struct = None
    best_seg, best_conf, best_min = None, -1.0, 0.0
    # STRUCT_CODE_READ (slice 1, default OFF → byte-identical): for structured code/date crops,
    # try a cleaner PREP (cap-height upscale + quiet-zone + no-sharpen) FIRST; a gate-passing struct
    # read returns early, a sub-floor one FALLS THROUGH to today's light/heavy rungs unchanged
    # (Oracle C2 — the SHARPEN fallback for tight degraded serials must survive). Per-call env read.
    _struct_on = (val_type in _STRUCT_READ_TYPES
                  and os.environ.get("STRUCT_CODE_READ", "0") != "0")
    # ANCHOR_LINE_SELECT (per-call env read — the :2825/:1453 convention). The recheck of
    # scope here is belt-and-braces: _crop_and_ocr only passes row_band when in scope, and
    # the gateless Stage-0.5 caller (verify_fn None) never passes one.
    _line_select = (row_band is not None and verify_fn is not None
                    and val_type in _LINE_SELECT_TYPES
                    and os.environ.get("ANCHOR_LINE_SELECT", "0") != "0")
    _rungs = ((("struct", 7), ("struct", 6)) if _struct_on else ()) \
             + (("light", 7), ("light", 6), ("heavy", 7), ("heavy", 6))
    for _src, _psm in _rungs:
        if _src == "heavy" and heavy is None:
            heavy = _tm._prep(crop)            # Rung 3 = today's recipe verbatim
        elif _src == "struct" and struct is None:
            struct = _struct_prep(crop)        # cleaner prep for structured code/date (slice 1)
        rimg = struct if _src == "struct" else (light if _src == "light" else heavy)
        rtext, rconf, rmin, rlines = _read_lines_full(rimg, _psm)
        if _line_select and rlines:
            # Per-line chooser — wrapped WHOLE (Oracle cond 1): any exception ⇒ the exact
            # status-quo path below, including best_seg bookkeeping (Oracle cond 2, pin k).
            # No _repair_single_token here: a separator-mangled read fails verify_fn, so it
            # falls through to the status-quo path where repair still gets its chance.
            try:
                _scale = rimg.height / max(1, crop.height)   # PER-RUNG frame rescale (pin c):
                # heavy _prep upscales ×2 for virtually every crop; light only <300px wide.
                _sband = (row_band[0] * _scale, row_band[1] * _scale)
                _edges = None
                if edge_ineligible:
                    _epx = 2.0 * _scale                      # ~2px in CROP px, rung frame
                    _edges = (_epx, rimg.height - _epx)
                _sel = select_row_line(rlines, _sband, val_type, verify_fn, edge_exclude=_edges)
                if _sel is not None:
                    _ln, _lseg = _sel
                    # Meta from the SELECTED line's words ONLY (pin d) — the whole-crop min
                    # includes the garbled neighbour and feeds _TIER_A_OCR_MIN.
                    _set_meta(_ln.get("mean_conf", rconf), _ln.get("min_conf", rmin))
                    return _lseg
            except Exception:
                pass
        rseg = clean_crop_segment(rtext, val_type)
        if rseg:
            rseg = _repair_single_token(rimg, rseg, val_type)
        if rseg and rconf > best_conf:
            best_seg, best_conf, best_min = rseg, rconf, rmin
        if _gate(rseg, rconf):
            # NOISE-SMOOTHING RETRY: a free-text rung can PASS the gate with a garbled-but-
            # name-shaped read on a noisy high-DPI scan. When its substantial-word floor is
            # shaky, try a smoothed 0.5x downscale and prefer it if cleaner (see
            # _noise_smooth_retry). Clean reads (high min) and structured/numeric fields are
            # byte-identical — the retry is never reached.
            if val_type in (None, "text", "multiline_text") and rmin < _NOISE_RETRY_MIN_CONF:
                ds = _noise_smooth_retry(crop, val_type, rmin, page=page, box=box,
                                         top_limit_norm=top_limit_norm)
                if ds is not None and (verify_fn is None or verify_fn(ds[0])):
                    _set_meta(ds[1], ds[2])
                    return ds[0]
            _set_meta(rconf, rmin)
            return rseg

    # No rung satisfied the gate. Degraded TEXT-LINE escalation (free-text
    # fields, verify_fn only) — denoise + adaptive threshold, accepted only if
    # it now PASSES the gate (a recovered-but-wrong name still can't commit).
    # See ocr/text_enhance.enhance_text_crop.
    if (verify_fn is not None and val_type in ("text", "multiline_text")
            and not (best_seg and verify_fn(best_seg))):
        try:
            from ocr import text_enhance
            eimg = text_enhance.enhance_text_crop(crop)
            etext, _ec, _emin = _read(eimg, 7)
            eseg = clean_crop_segment(etext, val_type)
            if not eseg:
                etext, _ec, _emin = _read(eimg, 6)
                eseg = clean_crop_segment(etext, val_type)
            if eseg and verify_fn(eseg):
                _set_meta(_ec, _emin)
                return eseg
        except Exception:
            pass
    _set_meta(best_conf if best_conf >= 0 else 0.0, best_min)
    return best_seg or None


# ── Multi-line continuation (Phase 1) ─────────────────────────────────────────
# A value (e.g. a work address) can wrap onto the line below; the first line often ends with
# a "-". name_match.should_continue_line decides WHEN to continue; these helpers do the
# geometry-aware read + join. All gated so a single-line read stays byte-identical.

def _is_ref_like_key(key: str | None) -> bool:
    """Mirror engine._is_ref_field — reference-style fields never continue onto the next line."""
    k = (key or "").lower()
    return k.endswith("_number") or k.endswith("_no") or "reference" in k


def join_continuation(seg1: str, seg2: str) -> str:
    """Join a wrapped value's first line + continuation line (both already _clean_one_line'd):
      • TRUE word-break hyphen ("Indus-" glued to a letter, line 2 lowercase) → de-hyphenate;
      • trailing separator dash (" -" / "–" / "—") → keep the learned " - " separator;
      • plain wrap → single space.
    Pure; returns the non-empty side when the other is empty."""
    a = (seg1 or "").rstrip()
    b = (seg2 or "").strip()
    if not b:
        return a
    if not a:
        return b
    if re.search(r"[A-Za-z]-$", a) and b[:1].islower():     # true word-break hyphen
        return a[:-1] + b
    m = re.search(r"\s*[-–—]\s*$", a)                        # trailing separator dash
    if m:
        return a[:m.start()].rstrip() + " - " + b
    return a + " " + b                                       # plain wrap


def _read_block_lines(img, psm: int = 6) -> list:
    """OCR a crop → per-LINE dicts top→bottom with pixel bbox [{text,left,top,width,height}].
    Used ONLY on the continuation branch (the single-line path never calls it)."""
    import pytesseract
    from pytesseract import Output
    try:
        d = pytesseract.image_to_data(img, config=f"--oem 3 --psm {psm}", output_type=Output.DICT)
    except Exception:
        return []
    groups = {}
    for i in range(len(d.get("text", []))):
        t = (d["text"][i] or "").strip()
        try:
            c = float(d["conf"][i])
        except Exception:
            c = -1.0
        if not t or c < 0:
            continue
        key = (d["block_num"][i], d["par_num"][i], d["line_num"][i])
        L, T, W, H = int(d["left"][i]), int(d["top"][i]), int(d["width"][i]), int(d["height"][i])
        g = groups.get(key)
        if g is None:
            groups[key] = {"w": [t], "x0": L, "y0": T, "x1": L + W, "y1": T + H}
        else:
            g["w"].append(t)
            g["x0"] = min(g["x0"], L); g["y0"] = min(g["y0"], T)
            g["x1"] = max(g["x1"], L + W); g["y1"] = max(g["y1"], T + H)
    out = [{"text": " ".join(g["w"]), "left": g["x0"], "top": g["y0"],
            "width": g["x1"] - g["x0"], "height": g["y1"] - g["y0"]} for g in groups.values()]
    out.sort(key=lambda r: r["top"])
    return out


def _x_overlap(a: dict, b: dict) -> float:
    """Horizontal overlap of two line boxes as a fraction of the NARROWER box."""
    lo = max(a["left"], b["left"])
    hi = min(a["left"] + a["width"], b["left"] + b["width"])
    return max(0, hi - lo) / max(1, min(a["width"], b["width"]))


def _lines_adjacent(l1: dict, l2: dict) -> bool:
    """Geometry guard: is l2 the wrapped continuation DIRECTLY below l1 (same column, the very
    next line), as opposed to an unrelated row/column further down? Requires same left edge
    (within ~1.2 line-heights) OR ≥50% horizontal overlap, AND a line PITCH (top→top) within
    ~2.5 line-heights — measured on the pitch, not the gap between tight glyph boxes, because a
    tight box UNDER-states the line height (the bug that made a normal wrapped line look 'far').
    This still rejects a row two+ lines down (a different field), the failure to avoid."""
    lh = max(1, l1.get("height", 0), l2.get("height", 0))
    left_ok = abs(l2["left"] - l1["left"]) <= lh * 1.2 or _x_overlap(l1, l2) >= 0.5
    pitch   = l2["top"] - l1["top"]
    pitch_ok = 0 < pitch <= lh * 2.5
    return bool(left_ok and pitch_ok)


def _continuation_ok(combined: str, original: str, verify_fn, name_lex) -> bool:
    """Post-join validation: accept only if the join adds real content, passes the field's own
    credibility gate (verify_fn — the same one the ladder used) and — when history exists — is
    no longer truncated and isn't implausibly long. Else the caller keeps line 1."""
    if not combined or len(combined) <= len(original):
        return False
    if verify_fn and not verify_fn(combined):
        return False
    if name_lex:
        from extraction import name_match
        if name_match.is_truncated_name(combined, name_lex):
            return False
        exp = name_lex.get("expected_len") or 0
        if exp:
            n = sum(1 for t in combined.split() if any(ch.isalnum() for ch in t))
            if n > exp + 3:
                return False
    return True


def _maybe_continue(page_image, x1: int, y1: int, x2: int, y2: int,
                    val_type, value, continuation, verify_fn) -> str:
    """If `value` (the line-1 read) signals continuation, read the line BELOW from an extended
    crop and join. Returns the joined value, or `value` unchanged when no continuation applies
    or the join fails its gate. The caller gates `continuation` to free-text fields with a rule."""
    try:
        if not value or not continuation:
            return value
        from extraction import name_match
        if not name_match.should_continue_line(value, continuation.get("pattern_chars"),
                                                continuation.get("name_lex"), continuation.get("fmt_entry")):
            return value
        w, h = page_image.size
        ext = int(max(1, y2 - y1) * 1.3) + 6           # extend ~1.3 line-heights downward
        ext_crop = page_image.crop((x1, y1, x2, min(h, y2 + ext)))
        lines = _read_block_lines(_light_prep(ext_crop), psm=6)
        if len(lines) < 2:
            return value
        l1, l2 = lines[0], lines[1]
        if not _lines_adjacent(l1, l2):
            return value
        seg2 = _clean_one_line(l2["text"], val_type)
        if not seg2 or seg2.rstrip().endswith(":"):     # empty, or a label caption below
            return value
        combined = join_continuation(value, seg2)
        if _continuation_ok(combined, value, verify_fn, continuation.get("name_lex")):
            return combined
        return value
    except Exception:
        return value


# Absolute ceiling on the learned crop width (normalised), so a fat-finger over-wide draw can't
# run the crop to the page edge before the operator notices (Oracle: eff_w = max(w_norm,
# min(max_w_norm, cap)) — the OUTER max guarantees a legitimately-wide single teach is never shrunk).
_MAX_CROP_WIDTH_CAP = 0.6


def _crop_and_ocr(page_image: "Image.Image", x_norm: float, y_norm: float,
                  w_norm: float = 0.0, h_norm: float = 0.0,
                  val_type: str | None = None, capture = None,
                  verify_fn = None, meta = None, continuation = None,
                  top_limit_norm: float | None = None,
                  max_w_norm: float | None = None,
                  left_limit_norm: float | None = None,
                  right_limit_norm: float | None = None) -> str | None:
    """
    Crop a tight region centred on the stored value coordinates and re-OCR it.
    Uses the exact selection dimensions saved by the ⊕ tool (w_norm/h_norm) so
    the crop never bleeds into adjacent columns or fields. Falls back to a
    conservative 200×60px half-size when no dimensions are stored.

    val_type (the field's configured `validation` type, e.g. "alphanumeric",
    "currency", "text") gates the digit-run truncation below — see the comment
    at the split-pattern selection for why this matters.

    `meta` (optional out-dict): when provided, the winning rung's OCR confidence
    is written as meta['conf'] (mean word confidence) and meta['min_conf'] (the
    minimum SUBSTANTIAL-word confidence). Callers use these to make the field
    confidence reflect READ QUALITY rather than only the anchor's usage_count — a
    garbled crop ("Aaiumant … Galaorm") no longer scores in the 90s.
    """
    try:
        w, h = page_image.size

        # BOX-WIDTH LEARNING (ANCHOR_MAX_CROP_WIDTH, DARK by default; Oracle SIGN-OFF-WITH-CONDITIONS
        # 2026-07-21): a field's crop width is the taught box's w_norm, so a value LONGER than the box
        # ever drawn is truncated (teach "Tesco", then "Billies Hardware Store" is cut off). max_w_norm
        # is the MONOTONIC widest width ever drawn for this anchor's scope (learning.js). Extend the
        # crop RIGHTWARD to it — KEEP the value's LEFT edge fixed (values flow right from the left-
        # anchored label), never beyond the absolute cap. eff_w = max(w_norm, min(max_w_norm, cap)):
        # the outer max never shrinks a legitimately-wide single teach. OFF (default) OR max_w_norm
        # ≤ w_norm (legacy backfill / first teach) ⇒ this block is skipped ⇒ byte-identical. Applied
        # only at the rigid + label-lock/drift RELOCATE rungs (the caller passes it there, NOT at the
        # cross-check or registration rungs — Oracle). y/h are untouched, so the (P) caption clamp and
        # vertical geometry are unchanged.
        if (max_w_norm and w_norm > 0 and h_norm > 0 and right_limit_norm is None
                and os.environ.get("ANCHOR_MAX_CROP_WIDTH", "0") != "0"):
            eff_w = max(w_norm, min(float(max_w_norm), _MAX_CROP_WIDTH_CAP))
            if eff_w > w_norm:
                left   = x_norm - w_norm / 2.0      # value LEFT edge (normalised) — preserved
                x_norm = left + eff_w / 2.0          # new centre, shifted right
                w_norm = eff_w                       # widened width

        cx = int(x_norm * w)
        cy = int(y_norm * h)

        # Use stored selection size + small padding, or conservative default
        if w_norm > 0 and h_norm > 0:
            half_w = int(w_norm * w / 2) + 20
            half_h = int(h_norm * h / 2) + 20
            # A free-text proper-noun line (a company name in a variable-height
            # block) needs more vertical headroom than a tight numeric token — a
            # clipped ascender/descender corrupts the read. Pad text fields more;
            # numerics keep the tight box (so they don't bleed into the next column).
            if val_type in ("text", "multiline_text"):
                half_h += int(h_norm * h * 0.4) + 6
        else:
            half_w = 200
            half_h = 60

        x1 = max(0, cx - half_w)
        y1 = max(0, cy - half_h)
        x2 = min(w, cx + half_w)
        y2 = min(h, cy + half_h)

        # ANCHOR_LINE_SELECT scope (per-call env, the convention above): structured types
        # only, a real verify gate (auto-excludes the gateless Stage-0.5 caller), real dims
        # (the 200×60 no-dims fallback → no band → inert).
        _ls_scope = (w_norm > 0 and h_norm > 0 and verify_fn is not None
                     and val_type in _LINE_SELECT_TYPES)
        _ls_on = _ls_scope and os.environ.get("ANCHOR_LINE_SELECT", "0") != "0"
        # ANCHOR_ROW_GRACE (slice 2 — ships DARK; do NOT flip with slice 1): ±0.6·box_h
        # vertical expansion BEFORE the caption clamp below, so top_limit_norm enforcement
        # is the existing code and grace can never reach above a located caption. INERT
        # unless LINE_SELECT is active (enforced here — grace without the chooser re-opens
        # the 2026-07-20 caption-band incident class). The honest residual lives in this
        # zone (a fully-contained wrong row + a garbled true row), hence dark until a
        # measured case slice 1 alone fails.
        _rg_on = _ls_on and os.environ.get("ANCHOR_ROW_GRACE", "0") != "0"
        if _rg_on:
            _g = int(h_norm * h * 0.6)          # downward cap ≤0.6 row == the same _g
            y1 = max(0, y1 - _g)
            y2 = min(h, y2 + _g)

        # (P) CAPTION-BAND EXCLUSION (007+Oracle 2026-07-14): a thin one-line value box is padded
        # ~3× taller here (fixed +20/+6 px), so a below-anchor crop can balloon UP into the caption
        # sitting a few px above the value ("Customer" → the shifted-scan "Customer eu" read). When
        # the caller has POSITIVELY located that caption, it passes its bottom edge as top_limit_norm;
        # clamp the crop TOP to it so the caption can never be read. The caller only passes it when the
        # caption is cleanly ABOVE the value (never clips into the value); a degenerate clamp collapses
        # → None → the caller skips the relocate (rigid read + caption-demotion backstop → review).
        if top_limit_norm is not None:
            y1 = max(y1, int(top_limit_norm * h))
            if y1 >= y2 - 1:
                return None

        # ANCHOR_LABEL_LEFT_CLAMP (007+Oracle 2026-08-01) — the horizontal mirror of (P):
        # the ±20px pad is label-blind, so a direction-right crop swallows the located
        # label's tail and the read trifurcates on tail debris. The caller passes the
        # expected value LEFT edge derived in the LOCATED frame (never the taught box —
        # C1); the edge only ever moves RIGHTWARD (G3: a clamp can exclude left content,
        # never admit more), a small guard keeps the first glyph column intact, and a
        # clamp that would collapse the crop reverts to UNCLAMPED (C5 — never refuse:
        # unlike the caption clamp above, an over-tight left edge must not erase the read).
        if left_limit_norm is not None:
            _clx = int(left_limit_norm * w) - _LEFT_CLAMP_GUARD_PX
            if _clx > x1 and _clx < x2 - 1:
                x1 = _clx

        # ANCHOR_VALUE_RIGHT_GROW (007/oscar/gary + Oracle 2026-08-02) — the right-edge twin of the
        # left clamp. right_limit_norm is the value's MEASURED right edge (inline_box, column-bounded
        # by cluster_value_words), so a value longer than the taught box is no longer chopped. Extend
        # x2 RIGHTWARD ONLY (+guard for the coarse ~120-DPI locate edge), never shrink, never past the
        # page. Grow-only + left edge/crop body untouched is what avoids the ANCHOR_INLINE_FULLRES_
        # REREAD regression (Oracle C-grow-only). GUARD is right-grow-specific, not _LEFT_CLAMP_GUARD_PX.
        if right_limit_norm is not None:
            x2 = min(w, max(x2, int(right_limit_norm * w) + _RIGHT_GROW_GUARD_PX))

        # The taught row's band, in CROP px from the FINAL y1 (after grace + clamp), so the
        # per-line chooser judges against the un-padded taught box, not the padded crop.
        _band = _row_band(cy, h_norm * h, y1) if _ls_on else None

        crop = page_image.crop((x1, y1, x2, y2))
        if capture:
            try: capture(crop)
            except Exception: pass   # dev-only slice capture; never disrupt OCR
        # ANCHOR_CHARSET_DEBRIS edge-contact metadata (iris/Oracle C3): does ink touch the crop's
        # left/right boundary? A clipped neighbouring glyph ("#" cut by the ±20px pad, OCR'd "F")
        # abuts the boundary by physical necessity; a genuinely separated interior token does not.
        # Metadata-only (read by the charset-debris arm); computed only when the arm is armed.
        if meta is not None and os.environ.get("ANCHOR_CHARSET_DEBRIS", "1") != "0":
            meta['edge_contact'] = _crop_edge_contact(crop)
        # The value's TIGHT normalised box (from the stored centre+dims) lets the
        # ladder's free-text preview fast-path re-crop with its own headroom at the
        # preview scale. Only when real dims are stored (not the 200×60 default).
        _box = None
        if w_norm > 0 and h_norm > 0:
            _box = {"x_norm": max(0.0, x_norm - w_norm / 2), "y_norm": max(0.0, y_norm - h_norm / 2),
                    "w_norm": w_norm, "h_norm": h_norm}
        _v = _ocr_crop_laddered(crop, val_type, verify_fn=verify_fn, meta=meta,
                                page=page_image, box=_box, top_limit_norm=top_limit_norm,
                                row_band=_band, edge_ineligible=_rg_on)
        # Multi-line continuation (gated): only re-reads/joins when a rule + the trailing-
        # pattern/history signal say the value wraps onto the next line; else byte-identical.
        if continuation and _v:
            _v = _maybe_continue(page_image, x1, y1, x2, y2, val_type, _v, continuation, verify_fn)
        return _v
    except Exception:
        return None


def _crop_edge_contact(crop):
    """(left, right) — True when INK (dark pixels) touches within 2px of that crop boundary.
    Cheap PIL-only: binarize + getbbox. Any failure ⇒ (False, False) ⇒ the charset-debris arm
    refuses (fail toward review)."""
    try:
        g = crop.convert("L").point(lambda p: 255 if p < 128 else 0)
        bbox = g.getbbox()
        if not bbox:
            return (False, False)
        l, _t, r, _b = bbox
        return (l <= 2, r >= crop.size[0] - 2)
    except Exception:
        return (False, False)


def _auth_rank(anchor: dict) -> int:
    """Sortable recency rank for an EXPLICIT operator re-teach (⊕): the digits of
    `last_authoritative_at` as an int (e.g. '2026-06-16 18:30:00' -> 20260616183000),
    or 0 when the anchor was only passively auto-learned. A larger value = more
    recently human-corrected. Selection prefers this over raw usage_count so an
    operator's correction takes effect immediately instead of being out-voted by a
    stale anchor that merely accumulated passive confirmations."""
    raw = anchor.get("last_authoritative_at")
    if not raw:
        return 0
    digits = re.sub(r"\D", "", str(raw))
    return int(digits) if digits else 0


def _filter_anchors(anchors: list[dict],
                    supplier_name: str | None,
                    document_type: str | None) -> list[dict]:
    """
    Return anchors relevant to this supplier/doc type, sorted by priority.
    Priority: exact supplier+type match > supplier only > type only > global.
    Within a priority tier, a more-recently AUTHORITATIVELY-taught anchor (⊕
    re-teach) wins over one with merely a higher passive usage_count — so a human
    correction is honoured immediately. usage_count is the final tie-break.
    """
    def priority(a):
        s_match = (a.get("supplier_name") or "").lower() in \
                  (supplier_name or "").lower()
        t_match = (a.get("document_type") or "") == (document_type or "")
        if s_match and t_match: return 0
        if s_match:             return 1
        if t_match:             return 2
        return 3

    # An EXPLICIT operator teach (last_authoritative_at set) outranks merely passively-
    # learned anchors BEFORE supplier-priority is considered — a human correction must not
    # lose to a stale auto-learned anchor tagged to the resolved supplier. BUT the boost is
    # SUPPLIER-SCOPED (gary Slice 2, 2026-07-09): a NAMED cross-supplier authoritative anchor
    # must NOT jump ahead of THIS supplier's own anchor, or supplier A's teach dominates
    # supplier B's doc (the cross-supplier bleed — A's top-right box reading B's wrong region).
    # A same-supplier / global (__global__) / unknown teach keeps the boost (bucket 0); a
    # named different-supplier teach drops to bucket 1, where priority() then ranks THIS
    # supplier's own anchor (priority 1) ahead of the cross-supplier one (type-only, priority 2).
    # Pairs with the located-at-taught-position gate below, which is the sole guard when this
    # supplier has NO own anchor. Guarded by tests/test_anchor_selection_scope.py.
    def auth_bucket(a):
        return 0 if (_auth_rank(a) > 0 and not _named_cross_supplier(a, supplier_name)) else 1

    filtered = [
        a for a in anchors
        if _anchor_matches(a, supplier_name, document_type)
    ]
    return sorted(filtered, key=lambda a: (
        auth_bucket(a), priority(a), -_auth_rank(a), -a.get("usage_count", 1)))


# The IDENTITY fields — their value + on-page position vary BY supplier, so a supplier-
# specific identity anchor is trusted on a DIFFERENT supplier's doc only when it reads that
# doc's OWN labelled value (see _is_blind_cross_supplier_anchor). Mirrors
# engine._IDENTITY_FIELD_KEYS / COMPANY_KEYS in JS.
_IDENTITY_FIELD_KEYS = frozenset({"supplier_name", "customer_name"})


def _reads_like_heading_garble(value, field_key: str) -> bool:
    """A NAME-like field's VALUE that reads like a document HEADING/CAPTION garble ("Deliver lo",
    "Deliver To RRS") AND carries NO protective structural word ("Ltd"/"Group"/"Services") — i.e. a
    relocated caption read, not a name. Used to DEMOTE such an anchor read (located_ok -> False, so
    the ≤50 cap fires) so the clean Stage-1 keyword read of the same field wins the engine merge, or
    — with no keyword — the value shows ≤50 + a review note. DEMOTION-ONLY (never selects a value),
    so there is no clean-but-wrong-keyword silent path.

    Precision: the protective-token exclusion (has_no_protective_token) keeps a legit company whose
    distinctive token is chrome-shaped ("Delivery Solutions Ltd" — 'Solutions'/'Ltd' protect it)
    INERT, so only an all-coined caption garble is demoted. Fail-toward-review by construction.
    Kill switch HEADING_GARBLE_GUARD=0. Inert if the char-trigram model is absent (wordness
    unavailable -> name_structure_flag returns None)."""
    if os.environ.get("HEADING_GARBLE_GUARD", "1") == "0":
        return False
    from extraction.value_quality import is_name_like_field
    if not is_name_like_field(field_key):
        return False
    from extraction import wordness
    v = str(value or "")
    return (wordness.name_structure_flag(v) is not None
            and wordness.has_no_protective_token(v))


def _named_cross_supplier(anchor: dict, supplier_name: str | None) -> bool:
    """A NAMED (not global/unknown) different-supplier anchor — the scope for a cross-supplier read
    guard. Mirrors the positional branch of _is_blind_cross_supplier_anchor."""
    a_sup = (anchor.get("supplier_name") or "").lower().strip()
    return bool(a_sup and a_sup not in ("__global__", "__unknown__")
                and a_sup != (supplier_name or "").lower().strip())


# 007① same-layout position tolerance (Oracle-corrected). A cross-supplier caption found MORE than
# this far from where the field was TAUGHT is a DIFFERENT layout (a generic-caption false-locate),
# so the absolute-box read must not be trusted. Per-axis: X (columns) is looser than Y (rows are a
# line-height tall). Fractions of page width/height. Corpus-validated (realdoc_regression, M=0).
_SAME_LAYOUT_TOL_X = 0.10
_SAME_LAYOUT_TOL_Y = 0.06

# RELOCATION position-veto tolerances (Oracle 2026-07-12) — DELIBERATELY LOOSER than the
# cross-supplier _SAME_LAYOUT_TOL above, and a SEPARATE constant on purpose: the drift-recovery
# relocate rung EXISTS to follow LARGE legitimate drift (a clipped/shifted scan moves the true
# caption far from taught), so the veto must forgive that while still rejecting a full-column jump
# (the "Delivery Note No." → "Deliver To" skew grab is off by ΔX≈0.46, caught at any sane bound).
# Also absorbs the raw↔deskew frame slop on a --deskew-pages reprocess (located label is in the
# deskewed frame, taught coords are raw; mismatch ≈ r·θ, up to ~0.09 in Y at the ±15° ceiling).
# Corpus-tuned (realdoc_regression M=0 + over-veto/over-admit probes); do NOT collapse back into
# _SAME_LAYOUT_TOL — that is a different question (same-layout proof vs same-supplier drift budget).
_RELOC_TOL_X = 0.22
_RELOC_TOL_Y = 0.14


def _located_at_taught_position(located, vx, vy, offset_dx, offset_dy,
                                tol_x=_SAME_LAYOUT_TOL_X, tol_y=_SAME_LAYOUT_TOL_Y) -> bool:
    """007① (Oracle-corrected): is the RE-LOCATED caption at the TAUGHT position, not merely PRESENT?
    A generic caption ("Invoice Number") exists on many layouts at DIFFERENT absolute positions, so
    'the caption is on this page' does NOT prove same-layout for a cross-supplier anchor — only 'the
    caption is where it was taught' does. Compares the located label's TOP-LEFT to the taught expected
    label top-left = value_centre − offset (the frame review/renderer.js captured the offset in:
    offset = value_centre − label_top_left). Per-axis tolerance. NO offset → the value can't be placed
    from the label → cannot verify → False (low-trust: the cross-supplier read is then capped/dropped).
    Pure/coordinate-only — no supplier/filename/document logic. Guarded by test_identity_anchor_scope.py."""
    lb = (located or {}).get("label_box") or located or {}
    lx, ly = lb.get("x_norm"), lb.get("y_norm")
    if lx is None or ly is None:
        return False                                   # no positional evidence → don't trust
    if offset_dx is None or offset_dy is None or (not offset_dx and not offset_dy):
        return False                                   # no offset → can't place value from label → low-trust
    exp_lx = float(vx) - float(offset_dx)              # expected label TOP-LEFT
    exp_ly = float(vy) - float(offset_dy)
    return abs(float(lx) - exp_lx) <= tol_x and abs(float(ly) - exp_ly) <= tol_y


def _inline_at_taught_offset(located, direction, vbox, offset,
                             tol_x=_RELOC_TOL_X, tol_y=_RELOC_TOL_Y) -> bool:
    """ANCHOR_INLINE_TAUGHT_OFFSET_VETO (kill switch, DEFAULT OFF) — is the INLINE-HARVESTED value
    where the teach said this field's value would be? The sibling above verifies the re-located
    LABEL; nothing verified the harvested VALUE.

    THE HOLE (measured live 2026-08-08 on the Pelican delivery notes). _locate_for_relocation
    searches a FULL-PAGE-WIDTH strip at the label's row deliberately — a key/value value can sit in
    a far column — and cluster_value_words only splits the post-label words into gap-runs and returns
    the run nearest expect_x; with a SINGLE run it returns it UNCHANGED (template_mapper.py:2229).
    So on a two-block layout ("CUSTOMER …" left, "SHIP TO …" right, printed on the SAME OCR row) the
    neighbouring block's HEADING is the only thing after the label and is harvested as the value: a
    taught CUSTOMER anchor harvested the word 'SHIP' (committed 'sui'/'sup'/'sup to' at conf 70-82,
    9 live documents) from 0.45 of a page away while its own taught offset says 0.10. No absolute
    label→value distance test existed anywhere on this path — the gap-clustering is RELATIVE, so it
    cannot reject a far column that is the only thing there.

    TWO LEGS, and they catch different things:
      1. DIRECTION — an inline harvest is always same-ROW as the label, so an anchor taught 'below'
         or 'above' can never legitimately produce one. No tolerance expresses this: one line of
         vertical separation (~0.015) is far inside tol_y. This leg is what covers a two-block
         layout whose neighbouring caption sits CLOSER than tol_x.
      2. DISTANCE — for 'right' anchors, which CAN harvest inline, the harvest must sit where the
         teach put it.

    The anchor already carries the answer: expected value CENTRE = located label top-left + taught
    offset, which is EXACTLY what _place_from_located computes for the crop rung — so this reuses
    that placement rather than inventing geometry, and reuses the tolerances the label veto already
    ships with. Returns True (ACCEPT) on every unverifiable path — OFF, no usable offset (legacy
    pre-migration-21 anchors), or no inline_box geometry (a text-layer line with no per-word boxes)
    — so those stay byte-identical. It can only ever DROP a harvest, after which the crop read seated
    AT the taught offset runs: fail-toward-the-taught-position, never toward a new value."""
    if os.environ.get("ANCHOR_INLINE_TAUGHT_OFFSET_VETO", "0") == "0":
        return True
    ib = (located or {}).get("inline_box") or {}
    try:
        ax = float(ib["x_norm"]) + float(ib["w_norm"]) / 2.0     # inline_box is TOP-LEFT convention
        ay = float(ib["y_norm"]) + float(ib["h_norm"]) / 2.0
    except (KeyError, TypeError, ValueError):
        return True                       # no value geometry → cannot verify → accept (unchanged)
    odx, ody = (offset or (None, None))
    if odx is None or ody is None or (not odx and not ody):
        return True                       # same C1 precondition as the label veto: no offset, no veto
    # LEG 1 — DIRECTION. An inline harvest is BY CONSTRUCTION the words following the label on the
    # label's OWN OCR line (_locate_for_relocation centres its band on that row). So for an anchor
    # taught 'below' or 'above' — "the value is a LINE away from its caption" — a same-row harvest
    # contradicts the teach outright, and no tolerance can express that: the y-gap between the
    # caption row and the value row is ONE line (~0.015 here) against tol_y 0.14. This is the leg
    # that catches a two-block layout whose neighbouring caption sits CLOSER than tol_x, which the
    # distance leg below cannot. Only 'right' anchors can legitimately harvest inline.
    if str(direction or "").lower() in ("below", "above"):
        return False
    # LEG 2 — DISTANCE, for the 'right' anchors that CAN harvest inline.
    placed = _place_from_located(located, direction, vbox, offset=(odx, ody))
    if not placed:
        return True
    return abs(ax - float(placed[0])) <= tol_x and abs(ay - float(placed[1])) <= tol_y


_LEFT_CLAMP_TYPES = _CAPTION_STRIP_TYPES   # structured, non-currency (C3) — one source with the strip
_LEFT_CLAMP_GUARD_PX = 3                   # keep the value's first glyph column intact on a hairline offset error
_RIGHT_GROW_GUARD_PX = 10                  # cover the ~120-DPI locate-pass quantisation of inline_box's RIGHT edge
                                           # (a few full-res px) without reaching the next column — well below the
                                           # med_h*1.2 cluster gap cluster_value_words split on (Oracle GUARD condition)


def _label_left_limit(located, anchor, direction, val_type):
    """ANCHOR_LABEL_LEFT_CLAMP (kill switch, DEFAULT OFF) — the label-tail crop clamp
    (007+Oracle SIGN-OFF-W/COND 2026-08-01). Expected value LEFT edge (normalised x) in
    the LOCATED frame: located label top-left + stored offset (the convention above —
    offset = value_centre − label_top_left) gives the value CENTRE on THIS page; minus
    half the taught width gives its left edge. The rigid crop's fixed +20px pad is
    label-blind while scans jitter, so a direction-right crop swallows the label TAIL
    ("Vo. WS-73541") and the read trifurcates on what the tail OCRs as (clean · ≤2-char
    debris recovered@85 · 3+char rescue · near-miss wrong value). Clamping the crop's
    left edge to where the value actually STARTS — drift-corrected by the locate —
    excludes the tail for every future supplier with the same tight-gap topology.
    C1 (frame trap): NEVER derived from the taught box — on a drifted page the taught
    frame computes a boundary that silently no-ops exactly on the worst-drift docs.
    C2: returns None (no clamp) unless the switch is ON, the anchor is AUTHORITATIVE
    with a real stored offset (same bar as _located_at_taught_position), direction is
    'right', and a real located label_box exists.
    C3: structured val_types only — free-text keeps its ladder/preview regime (its
    page re-crops never see this clamp and must not); currency already skips the
    rigid crop entirely (_skip_rigid).
    The consumer (_crop_and_ocr) moves the crop's left edge RIGHTWARD ONLY and reverts
    to unclamped when degenerate (C5 — never refuse)."""
    if os.environ.get("ANCHOR_LABEL_LEFT_CLAMP", "0") == "0":
        return None
    if direction != "right" or val_type not in _LEFT_CLAMP_TYPES:
        return None
    if not (anchor or {}).get("last_authoritative_at"):
        return None
    odx, ody = anchor.get("offset_dx_norm"), anchor.get("offset_dy_norm")
    if odx is None or ody is None or (not odx and not ody):
        return None                          # no offset → the value can't be placed from the label
    w_norm = anchor.get("w_norm") or 0.0
    if w_norm <= 0:
        return None
    lb = (located or {}).get("label_box")
    if not lb or lb.get("x_norm") is None:
        return None
    return _clamp01(float(lb["x_norm"]) + float(odx) - w_norm / 2.0)


def _label_right_limit(field_key, located, anchor, direction, val_type, validation_patterns):
    """ANCHOR_VALUE_RIGHT_GROW (kill switch, DEFAULT OFF) — the RIGHT-edge twin of the label-tail
    left clamp (007/oscar/gary + Oracle SIGN-OFF-W/COND 2026-08-02). The rigid crop is sized from
    the TAUGHT box width, so a value LONGER than the taught sample chops on the right ("PO-25909" →
    the crop reads "PO-2590!"). Return the value's REAL right edge (normalised x) MEASURED on THIS
    page from the located value box — inline_box.x_norm + inline_box.w_norm — so the crop grows
    rightward to the actual value end. inline_box is the cluster-selected value column
    (template_mapper.cluster_value_words, gap-split at med_h*1.2), so it is next-column-excluded BY
    CONSTRUCTION — the grown crop cannot reach the neighbour. Sourced from the MEASURED box, NEVER
    the taught box (C1 frame trap), like the left clamp.

    Oracle conditions (2026-08-02), all ship-blocking:
    - C-scope: SLICE 1 fires ONLY for a REFERENCE-like key that ALSO carries a validation pattern →
      the value then rides the STRICT _pattern_coverage>=0.8 credibility branch, which REJECTS a
      merged-column read ('PO-25909 Qty' scores 0.67) so the clean-token recovery runs. SEAM A: the
      label-lock rung commits anchor_crop_relocated, which bypasses the shape veto AND has no
      crop_fullpage_disagree cross-check — the strict credibility branch is the SOLE guard there, so
      a non-ref alphanumeric or an untyped ref (lenient free-text branch) must NOT arm.
    - DATE is DEFERRED to slice 1b (Oracle anomaly #2, VERIFIED): date credibility is a SUBSTRING
      match, so a merged 'DD/MM/YYYY Qty' PASSES the gate, and the downstream salvage does NOT strip
      the trailing token (validator.parse_date('12/05/2026 Qty') → None, normalise_date leaves it
      dirty) — so a merged date would commit dirty. Date needs its own clean-token step before the
      right grow can arm on it. Do NOT add `or val_type=='date'` here until that lands + is pinned.
    - Same authority bar as the left clamp: switch ON, authoritative anchor with a real stored
      offset, direction 'right', and a real located inline_box.
    The consumer (_crop_and_ocr) extends x2 RIGHTWARD ONLY (+_RIGHT_GROW_GUARD_PX) and never past
    the page edge; OFF ⇒ returns None ⇒ byte-identical."""
    if os.environ.get("ANCHOR_VALUE_RIGHT_GROW", "0") == "0":
        return None
    if direction != "right":
        return None
    if not _is_ref_like_key(field_key):
        return None                          # slice 1: ref-like only (date deferred — see docstring)
    if not (validation_patterns or {}).get(val_type):
        return None                          # no pattern → lenient credibility branch → NOT backstopped
    if not (anchor or {}).get("last_authoritative_at"):
        return None
    odx, ody = anchor.get("offset_dx_norm"), anchor.get("offset_dy_norm")
    if odx is None or ody is None or (not odx and not ody):
        return None                          # same authority bar as _label_left_limit
    ib = (located or {}).get("inline_box")
    if not ib or ib.get("x_norm") is None or ib.get("w_norm") is None:
        return None
    return _clamp01(float(ib["x_norm"]) + float(ib["w_norm"]))


def _reads_disagree(a, b, val_type) -> bool:
    """Do two independent reads of a field carry genuinely DIFFERENT values? For a DATE, compare
    CALENDAR dates (parse_date) so a format-only difference (29/05/2026 vs 29-05-2026) is NOT a
    disagreement and an unparseable read never counts; everything else is a case-insensitive string
    compare. Shared by the authoritative-crop cross-check's inline AND value-below branches.

    DATE-AWARE even when val_type didn't resolve to 'date' here: if BOTH reads parse as calendar
    dates we compare the DATES, not the raw strings — so a crop that OCR'd the separator differently
    ('04/06/2026' vs '04-06-2026') never fires a needless cross-check flag. Kill switch
    DATE_AWARE_CROSSCHECK=0 restores the val_type=='date'-only behaviour (OFF => byte-identical)."""
    a, b = (a or "").strip(), (b or "").strip()
    if not a or not b:
        return False
    if val_type == "date" or os.environ.get("DATE_AWARE_CROSSCHECK", "1") != "0":
        from extraction.validator import parse_date
        da, db = parse_date(a), parse_date(b)
        if da and db:
            return da.date() != db.date()
        if val_type == "date":
            return False   # a date field where one read didn't parse → never a disagreement
    return a.lower() != b.lower()


# ── Deskew RAW-FRAME witness (issue-3, Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-24) ──────────────
# On a `--deskew-pages` reprocess a taught crop is read off the DESKEWED page; the rotation resample
# can flip a valid-SHAPED glyph (PO-98370 → PO-98270) that no regex catches, so it files silently at
# ref/date confidence. The RAW page (raw_page0) is the teach-time frame — drawn ⊕ coords are back-
# transformed to raw on save — so a re-crop there reproduces the correct read. This witness heals a
# committed ref/date value ONLY on a two-read CONSENSUS (the raw crop AND the raw page text agree on
# a value that DISAGREES with the committed one) and otherwise leaves it untouched. FAIL-TOWARD-
# REVIEW: never a silent wrong value; never a silent DROP of a correct value — a LONE raw dissenter
# the page text can't corroborate is left alone (that is the benign column-only crop class, ~2% of
# refs the full-page OCR misses but the crop reads correctly — measured on the live corpus).
# The engine calls this pre-Stage-2.5d (a witness after the dominant-snap would undo a legit snap);
# gated on raw_page0 present + kill switch → byte-identical off the deskew path.
# OUT OF SCOPE (documented residual): a Stage-2.5d snap-INDUCED corruption on a constant-ish ref
# (the DN-22222 poisoned-dominant class) is owned by 2.5d's own guard / Learning Repair, not here.
_CROP_FAMILY_METHODS = frozenset({
    "anchor_crop", "anchor_crop_relocated", "anchor_crop_recovered",
    "anchor_crop_slipfix", "anchor_registration",
})


def _alnum_core(s) -> str:
    return re.sub(r'[^a-z0-9]', '', str(s or '').lower())


def _ref_witnessed(value, witness_text) -> bool:
    """Normalized-EXACT membership of a ref value's alnum core in the page text. EXACT by
    construction — a single-glyph flip changes the core ('po98370' ≠ 'po98270'); NO edit-distance
    fold (that would mask the exact bug this catches). A tiny core (<4 chars) is unjudgeable →
    treated as witnessed (never act on a coincidence)."""
    core = _alnum_core(value)
    if len(core) < 4:
        return True
    return core in _alnum_core(witness_text)


def _date_witnessed(value, witness_text) -> bool:
    """Calendar membership: does the value's day+month+year appear as a contiguous date in the page
    text in ANY common order/separator? (A date needn't appear verbatim in DD-MM-YYYY form.)"""
    d = re.sub(r'[^0-9]', '', str(value or ''))
    if len(d) != 8:
        return True   # unparseable digit-shape → don't judge
    dd, mm, yyyy = d[0:2], d[2:4], d[4:8]
    td = re.sub(r'[^0-9]', '', str(witness_text or ''))
    return any(c in td for c in (dd + mm + yyyy, mm + dd + yyyy, yyyy + mm + dd, yyyy + dd + mm))


def raw_crop_recheck(committed_value, taught_box, raw_page0, witness_text,
                     val_type, field_key, label, format_lookup, text_field_keys,
                     validation_patterns):
    """Return (new_value, note) to FLIP+FLAG a deskew-corrupted ref/date read, or None to leave it
    unchanged (see the module note above). Best-effort: any error → None. Guarded by
    tests/test_deskew_raw_witness.py."""
    try:
        is_date = (val_type == "date")
        # DETECT (cheap pre-filter). REF: committed value already witnessed on the raw page → agree
        # → untouched (byte-identical, and the ~97.6% common case). DATE: skip membership (a wrong-
        # field date read can itself be 'on the page') → always re-crop + calendar-compare.
        if not is_date and _ref_witnessed(committed_value, witness_text):
            return None
        if not taught_box or raw_page0 is None:
            return None
        x, y, w, h = taught_box
        if not (x and y):
            return None

        def _verify(t):
            return (bool(t) and _crop_is_credible(t, val_type, validation_patterns, label)
                    and bool(_qualify_against_format(t, field_key, format_lookup, text_field_keys,
                                                     val_type, validation_patterns)))
        raw = _crop_and_ocr(raw_page0, x, y, w or 0.0, h or 0.0, val_type, verify_fn=_verify)
        if not raw:
            return None
        raw = (_qualify_against_format(raw, field_key, format_lookup, text_field_keys,
                                       val_type, validation_patterns) or "").strip()
        if not raw or not _crop_is_credible(raw, val_type, validation_patterns, label):
            return None
        if not _reads_disagree(raw, committed_value, val_type):
            return None   # raw crop AGREES with the committed read → no correction (byte-identical)
        # TWO-READ CONSENSUS: the raw crop's value must be corroborated by the raw page text. A lone
        # raw dissenter (the raw crop reads something the page can't confirm) is NOT trusted — leave
        # the committed value alone (guards against the raw crop itself being the wrong read).
        corroborated = _date_witnessed(raw, witness_text) if is_date else _ref_witnessed(raw, witness_text)
        if not corroborated:
            return None
        return (raw, "The straightened read disagreed with the original scan — using the original; please verify.")
    except Exception:
        return None


def _is_blind_cross_supplier_anchor(field_key: str, anchor: dict,
                                    supplier_name: str | None, located_ok: bool,
                                    identity_labels = None) -> bool:
    """True when an anchor resolved as a BLIND read (its label absent on this page → not located)
    that is a positional guess learned on a DIFFERENT supplier's layout, so its absolute-box read is
    untrustworthy here and is dropped (the field falls through to keyword/registration/hint/empty).

    Generalises the former identity-only guard (2026-07) to fix the #1 cross-supplier POSITIONAL
    bleed: an authoritative invoice_number anchor taught for supplier A (pinned top-right) is admitted
    onto supplier B's same-type doc by _anchor_matches ("doc-type IS the layout"), ranked first by
    _filter_anchors' auth_bucket, and — until now — blind-read at A's absolute position, locking B's
    top-left region. A NAMED different-supplier BLIND read is now dropped for ANY field.

    Kept (returns False):
      * a LOCATED read (label found here → same layout → value read beside THIS doc's own caption) —
        for EVERY field, so an authoritative anchor whose label is genuinely present still wins (the
        "authoritative wins" invariant), and a supplier's OWN labelled identity anchor still CORRECTS
        a wrong template supplier guess (Greenfield-over-Acme; test_supplier_identity_stability);
      * a SAME-supplier anchor, and — for a POSITIONAL field — a GLOBAL/UNKNOWN-scoped anchor, whose
        fixed-position blind read is its INTENDED use (identity keeps its stricter scope check).
    Extra IDENTITY-only drop: a captured label that IS the identity field's own DISPLAY name
    ("Document Issuer", in `identity_labels`) is a teaching artifact never printed on the page — a
    pure positional sweep — dropped regardless of scope. (Only the BLIND path reaches here; a fuzzy
    inline "located" read off that label is deliberately NOT dropped — removing it net-regresses the
    corpus, #119 — left to a template/logo supplier-precedence fix.)

    RESIDUAL (not closed here, unchanged from the identity guard): `located_ok` proves the caption is
    PRESENT, not that the value was read at it. A strongly-credible rigid ABSOLUTE read skips
    relocation (see extract_with_anchors), so a cross-supplier layout that shares the SAME caption at
    a DIFFERENT position ("false-locate") keeps a wrong absolute value uncapped — closing that needs
    the label-relative offset read elevated over the absolute read, a separate slice. Pure/unit-tested."""
    if located_ok:
        # WEAK-CORE locate exception (Oracle C2, 2026-07-10): a locate via a caption whose
        # alphabetic CORE is ≤3 chars — the bare "No."/"Ref"/"SO #" class the SHORT_CAPTION
        # allowlist made teachable — proves almost nothing about layout identity: a standalone
        # prose "no" anywhere on a NAMED different supplier's page "locates" it, and the
        # located upgrade would bypass this guard (the documented generic-caption residual —
        # the 'Invoice'-label class behind the 07-08 harness RED, with an even weaker
        # caption). For a NAMED DIFFERENT supplier only, a weak-core locate does NOT count as
        # "same layout": fall through to the blind-read rules below (→ dropped). Same-supplier
        # / global / unknown scopes and ≥4-alpha-core labels are byte-identical. An UNRESOLVED
        # supplier also falls through — no layout evidence either way; the Stage-2.6 rescue
        # re-runs the anchor as same-supplier once identity resolves.
        _core = re.sub(r'[^a-z]', '', (anchor.get("anchor_label") or "").lower())
        if len(_core) > 3 or not _named_cross_supplier(anchor, supplier_name):
            return False
    is_identity = field_key in _IDENTITY_FIELD_KEYS
    if is_identity and identity_labels:
        a_lbl = (anchor.get("anchor_label") or "").strip().lower()
        if a_lbl and a_lbl in identity_labels:
            return True
    a_sup  = (anchor.get("supplier_name") or "").lower().strip()
    s_name = (supplier_name or "").lower().strip()
    if is_identity:
        # Unchanged identity scope: a NAMED (or literal-sentinel) different scope drops; an
        # empty-supplier ('') anchor stays KEEP (falsy) — a fixed-position issuer teach.
        return bool(a_sup and a_sup != s_name)
    # POSITIONAL / structured field: only a NAMED different supplier's blind read is a wrong-layout
    # sweep. A global/unknown-scoped anchor's fixed-position blind read is its intended use → keep.
    if a_sup in ("__global__", "__unknown__", ""):
        return False
    return a_sup != s_name


def _anchor_matches(anchor: dict, supplier_name: str | None,
                    document_type: str | None) -> bool:
    a_sup  = (anchor.get("supplier_name") or "").lower().strip()
    a_type = anchor.get("document_type") or ""
    s_name = (supplier_name or "").lower().strip()
    d_type = document_type or ""

    # A typed anchor must NOT cross into a DIFFERENT known doc type — even for the
    # same supplier. One supplier often sends several doc types (e.g. a supplier
    # that issues both purchase orders AND worksheets); without this guard, that
    # supplier's purchase_order anchors (po_number/po_date) fire on its worksheets
    # too, producing a Frankenstein field set from every type the supplier was
    # ever taught under. The doc-type IS the layout (see migration-20 note), so a
    # field taught for one layout must not leak onto another. Only enforced when
    # BOTH types are known; if detection couldn't resolve the doc type, the broad
    # supplier fallback below still applies (unchanged), so nothing regresses.
    type_conflict = bool(a_type and d_type and a_type != d_type)

    # Global anchors always apply — unless they carry a conflicting doc type.
    if a_sup in ("__unknown__", "__global__", ""):
        return not type_conflict
    # Supplier match — exact (normalised), not substring. Substring matching
    # ("a_sup in s_name or s_name in a_sup") lets one supplier's anchors fire
    # on another whenever one name contains the other (e.g. a short supplier
    # name that happens to be a substring of a longer one) — the same
    # collision class that made the 'PO' template anchor match inside
    # "Polychemtex Inc.". A doc-type conflict still vetoes a supplier match.
    if a_sup and s_name and a_sup == s_name:
        return not type_conflict
    # Doc type match (e.g. a DIFFERENT supplier, same layout family): the doc-type IS the
    # layout, so a field taught under one supplier can read another supplier's SAME-type doc.
    # This ADMITS identity (supplier_name/customer_name) anchors too — but an identity anchor is
    # supplier-SPECIFIC, so a cross-supplier one is trusted ONLY when it reads the doc's OWN
    # labelled value (a LOCATED read). A BLIND cross-supplier identity crop — its label absent
    # here, e.g. a "Contoso / Document Issuer" teach landing on a Profile invoice and crop-
    # garbling it to "PROFLE CONSTRUCTION" — is dropped at the READ stage (see the located gate
    # in extract_with_anchors + _is_blind_cross_supplier_anchor), NOT here: filtering it out
    # pre-read would also block a supplier's OWN labelled anchor from CORRECTING a wrong template
    # supplier guess (Greenfield reading "Supplier: Greenfield" over an "Acme" template match —
    # test_supplier_identity_stability), which is a legitimate identity re-resolution.
    if a_type and d_type and a_type == d_type:
        # Cross-supplier (DIFFERENT named supplier, SAME doc-type): admit ONLY for IDENTITY fields
        # (supplier_name/customer_name). Layouts differ PER SUPPLIER, so a cross-supplier POSITIONAL
        # anchor (invoice_number/date/total/…) is almost never right and only BLEEDS — supplier A's
        # taught box reading a wrong region of supplier B's doc (the invoice_number drift). So a
        # positional field is NOT admitted cross-supplier; it resolves from THIS doc's own
        # supplier-agnostic keyword read (or is taught per supplier). NOTE there is no operator
        # "this layout is shared across suppliers" control — a __global__ anchor only arises as a
        # FALLBACK when the supplier was unresolved at teach time (see learning.js), so it is NOT the
        # user-facing opt-in for a shared layout; keyword + per-supplier teaching is the real net.
        # IDENTITY fields DO stay cross-supplier-admittable
        # because a supplier's own labelled identity anchor must be able to CORRECT a wrong
        # template/logo supplier guess (test_supplier_identity_stability), and the read-stage located
        # gate keeps only its own labelled read. (2026-07-09, at the user's direction: "the layouts
        # per supplier will mostly be different" — so cross-supplier positional reads never fire.)
        return anchor.get("field_key") in _IDENTITY_FIELD_KEYS

    return False


def anchor_admissible(anchor: dict, supplier_name: str | None,
                      document_type: str | None) -> bool:
    """PUBLIC admission check for ONE anchor under a given (supplier, doc-type) identity —
    exactly _anchor_matches, exposed by name for the engine's Stage-2.6 LATE-ANCHOR RESCUE,
    whose rescue set is the DELTA of admission (admissible under the freshly-resolved
    supplier but NOT under None = exactly that supplier's own named positional anchors).
    Behaviour-identical wrapper; keeps the engine off the private API."""
    return _anchor_matches(anchor, supplier_name, document_type)


def _label_pattern(label: str) -> "re.Pattern | None":
    """
    Build a regex tolerant of OCR whitespace merging/splitting between a
    saved anchor label's words — the same fix already applied to Stage 1
    keyword matching (see keyword.py's _label_pattern). A label captured via
    strip-OCR at teach time ("Purchase Order No") and the same text seen in
    a later full-page OCR pass ("PURCHASE ORDERNO") commonly disagree on
    whether inter-word spacing collapsed; allowing zero-or-more whitespace
    between each word covers both, for any current or future label.

    The returned pattern's match span is used directly for extraction (see
    extract_with_anchors), so "does it match" and "where does the value
    start" are always answered by the same regex — eliminating the previous
    inconsistency where a loose word-overlap match could pass here while the
    subsequent exact-length line.find(label) silently failed or misaligned
    the extracted value.

    Single-word alphabetic labels also get a word-boundary guard, mirroring
    template_matcher.py::_find_by_anchor's existing fix for the same
    collision class — a short generic label ("PO", "Ref") must not match
    inside an unrelated word ("Polychemtex", "Refinishing"). Without this,
    the two label-matching paths would disagree on the same kind of label.
    """
    words = label.split()
    if not words:
        return None
    body = r'\s*'.join(re.escape(w) for w in words)
    if len(words) == 1 and words[0].isalpha():
        return re.compile(r'(?<![a-z0-9])' + body + r'(?![a-z0-9])')
    return re.compile(body)


def _hamming(h1: str, h2: str) -> int:
    if not h1 or not h2 or len(h1) != len(h2):
        return 64
    dist = 0
    for c1, c2 in zip(h1, h2):
        xor = int(c1, 16) ^ int(c2, 16)
        dist += bin(xor).count("1")
    return dist
