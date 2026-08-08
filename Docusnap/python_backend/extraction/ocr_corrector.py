"""
extraction/ocr_corrector.py
---------------------------
OCR character correction using learned document format templates.

After enough documents from a supplier are confirmed, this module infers the
character-level format of reference fields (e.g. INV-001234 → UUU-DDDDDD).
When a freshly-extracted value has a character that breaks the pattern but
matches a known OCR confusion pair, the character is substituted and the
extraction confidence is boosted.

Template alphabet:
  D  — any decimal digit   (0-9)
  U  — any uppercase letter (A-Z)
  L  — any lowercase letter (a-z)
  A  — any alphanumeric    (D or U or L)
  ?  — position too inconsistent to constrain
  *  — literal character kept as-is (separator: - / . space etc.)

Common OCR confusions addressed:
  Digit expected, letter seen:
    1 ← l I i |
    0 ← O o Q
    5 ← S s
    2 ← Z z
    7 ← T
    8 ← B
    6 ← G b
    9 ← g q
  Letter expected, digit seen:
    O ← 0
    I ← 1  (uppercase)
    l ← 1  (lowercase)
    S ← 5
    Z ← 2
    B ← 8
    G ← 6
    T ← 7
"""

import os
import re
import math
from collections import Counter

# ── Confusion maps ────────────────────────────────────────────────────────────

# When we EXPECT a digit but OCR produced a letter
LETTER_TO_DIGIT = {
    'l': '1', 'I': '1', 'i': '1', '|': '1',
    'O': '0', 'o': '0', 'Q': '0',
    'S': '5', 's': '5',
    'Z': '2', 'z': '2',
    'T': '7',
    'B': '8',
    'G': '6', 'b': '6',
    'g': '9', 'q': '9',
}

# When we EXPECT an uppercase letter but OCR produced a digit
DIGIT_TO_UPPER = {
    '0': 'O',
    '1': 'I',
    '5': 'S',
    '2': 'Z',
    '8': 'B',
    '6': 'G',
    '7': 'T',
}

# When we EXPECT an uppercase letter but OCR produced a SYMBOL (e.g. a leading "S" on a code
# read as "$"). Mirrors the symbol cases of the shared OCR_PAIRS (src/windows/shared/slipFix.js,
# extracted from review/renderer.js 2026-07-11) — keep the two in sync (they are twins, like
# text_normalise.py/.js). Used by the slip-fix that recovers a gate-rejected read which is ONE
# known-confusion substitution from the learned shape.
SYMBOL_TO_UPPER = {
    '$': 'S',
    '€': 'E',
    '£': 'E',
}

# When we EXPECT a lowercase letter but OCR produced a digit
DIGIT_TO_LOWER = {
    '0': 'o',
    '1': 'l',
    '5': 's',
    '2': 'z',
    '8': 'b',
    '6': 'g',
}


# ── Template derivation ───────────────────────────────────────────────────────

def value_to_template(value: str) -> str:
    """
    Convert a confirmed value to its format template string.
      'INV-001234' → 'UUU-DDDDDD'
      'a4b8c2'    → 'LALAALA'  (wait, that would be LALADLA — just an example)
    """
    out = []
    for c in value:
        if c.isdigit():
            out.append('D')
        elif c.isupper():
            out.append('U')
        elif c.islower():
            out.append('L')
        else:
            out.append(c)   # literal separator: - / . space , etc.
    return ''.join(out)


# A SINGLE distinct value confirmed at least this many times is a trustworthy correction
# template (a constant field — a model/serial code — that OCR keeps misreading, e.g.
# "1102V03NL1" read as "1102VO3NL1"). Constant fields have <2 DISTINCT values, so the
# multi-value consensus path can never learn them; this recurrence gate does. Kept low
# because an identical value confirmed a few times is already strong evidence. Mirror the
# JS-side count gate in learning.js getFieldFormats (which must also EMIT such a group).
MIN_CONFIRMED_FOR_SINGLE_SHAPE = 3


def derive_template(values: list, confirmed_count: int = 0, value_counts: dict | None = None) -> str | None:
    """
    Infer a consensus format template from confirmed values.
    Returns a template string, or None if the values are too inconsistent.

    Multiple values of the same length yield a consensus template. A SINGLE distinct value
    yields a template ONLY when it recurs (confirmed_count >= MIN_CONFIRMED_FOR_SINGLE_SHAPE)
    — the strongest possible template (every position fixed), used to fix OCR character
    confusions (O→0, I→1, S→5) in a constant-value field.

    COUNT-WEIGHTED (2026-07): each distinct value votes proportionally to how many times it was
    confirmed (`value_counts`), so a SINGLE mis-confirmed OCR artifact can no longer drag a
    strongly-recurring position to the mixed 'A' class — which used to silently stop try_correct
    fixing O→0 there (a 31× "1102V03NL1" was neutered by one confirmed "11O2V03NL1"). A position
    whose dominant category holds ≥80% of the WEIGHT is fixed to it; otherwise the prior
    category-collapse applies. Absent value_counts → weight 1 each → byte-identical to before.
    """
    clean = [v for v in values if v and v.strip()]
    if not clean:
        return None
    if len(clean) == 1:
        return value_to_template(clean[0]) if confirmed_count >= MIN_CONFIRMED_FOR_SINGLE_SHAPE else None
    if len(clean) < 2:
        return None

    def _w(v):
        try:
            return max(1, int((value_counts or {}).get(v, 1)))
        except Exception:
            return 1

    templates = [(value_to_template(v), _w(v)) for v in clean]

    # Most common length, WEIGHTED (a rare different-length artifact can't shift the choice).
    len_w = {}
    for t, w in templates:
        len_w[len(t)] = len_w.get(len(t), 0) + w
    most_common_len = max(len_w.items(), key=lambda kv: kv[1])[0]
    same_len = [(t, w) for t, w in templates if len(t) == most_common_len]
    if len(same_len) < 2:
        return None

    n = most_common_len
    merged = []
    for i in range(n):
        cat_w = {}
        for t, w in same_len:
            cat_w[t[i]] = cat_w.get(t[i], 0) + w
        total = sum(cat_w.values())
        dom_cat, dom_w = max(cat_w.items(), key=lambda kv: kv[1])
        if total and dom_w >= 0.8 * total:
            merged.append(dom_cat)                  # a strongly-dominant category/literal wins
        else:
            chars = set(cat_w)
            if chars <= {'D'}:
                merged.append('D')
            elif chars <= {'U'}:
                merged.append('U')
            elif chars <= {'L'}:
                merged.append('L')
            elif chars <= {'D', 'U', 'L', 'A'}:
                merged.append('A')                  # genuinely mixed alphanumeric
            else:
                merged.append('?')                  # too varied

    template = ''.join(merged)

    # Only return if at least half the positions are constrained
    constrained = sum(1 for c in template if c != '?')
    if constrained < n * 0.5:
        return None

    return template


# ── Correction ────────────────────────────────────────────────────────────────

def try_correct(value: str, template: str) -> tuple:
    """
    Attempt to correct `value` to conform to `template`.

    Returns:
        (corrected_value, confidence_boost)
        corrected_value is None if correction is impossible.
        confidence_boost is 0–20 (added to existing extraction confidence).
    """
    if not template or len(value) != len(template):
        return None, 0

    result = list(value)
    n_fixes = 0

    for i, (char, tmpl) in enumerate(zip(value, template)):
        if tmpl == '?':
            continue                            # unconstrained — skip

        if tmpl == 'D':                         # expect digit
            if char.isdigit():
                continue
            fix = LETTER_TO_DIGIT.get(char)
            if fix:
                result[i] = fix
                n_fixes += 1
            else:
                return None, 0                  # unrecognised non-digit

        elif tmpl == 'U':                       # expect uppercase letter
            if char.isupper():
                continue
            if char.isdigit():
                fix = DIGIT_TO_UPPER.get(char)
                if fix:
                    result[i] = fix
                    n_fixes += 1
                else:
                    return None, 0
            elif char.islower():
                result[i] = char.upper()        # simple case normalisation
                n_fixes += 1
            else:
                return None, 0

        elif tmpl == 'L':                       # expect lowercase letter
            if char.islower():
                continue
            if char.isupper():
                result[i] = char.lower()
                n_fixes += 1
            elif char.isdigit():
                fix = DIGIT_TO_LOWER.get(char)
                if fix:
                    result[i] = fix
                    n_fixes += 1
                else:
                    return None, 0
            else:
                return None, 0

        elif tmpl == 'A':                       # expect any alphanumeric
            if char.isalnum():
                continue
            return None, 0

        else:                                   # literal separator expected
            if char == tmpl:
                continue
            return None, 0                      # separator mismatch

    corrected = ''.join(result)

    # Confidence boost: falls off with more substitutions
    boost_table = {0: 8, 1: 20, 2: 12, 3: 6}
    boost = boost_table.get(n_fixes, 0)

    return corrected, boost


# ── Format index ──────────────────────────────────────────────────────────────

def build_format_index(formats_data: list) -> dict:
    """
    Build a lookup dict from the DB format data.

    formats_data entries:
        {supplier_name, document_type, field_key, sample_values: [str]}

    Returns:
        {
          (supplier_lower, doc_type_lower, field_key): template,
          '_fallback': {(doc_type_lower, field_key): template},
        }
    """
    index    = {}
    dt_accum = {}   # accumulate templates per (doc_type, field_key)

    for entry in (formats_data or []):
        supplier  = (entry.get('supplier_name') or '').lower().strip()
        doc_type  = (entry.get('document_type') or '').lower().strip()
        field_key = entry.get('field_key', '')
        samples   = entry.get('sample_values') or []
        confirmed = entry.get('confirmed_count', 0) or 0

        # A single recurring value (len<2 distinct) is allowed through when confirmed enough
        # times — the constant-value OCR-correction case (see derive_template).
        if not field_key:
            continue
        if len(samples) < 2 and confirmed < MIN_CONFIRMED_FOR_SINGLE_SHAPE:
            continue

        tmpl = derive_template(samples, confirmed_count=confirmed, value_counts=entry.get('value_counts'))
        if not tmpl:
            continue

        if supplier and doc_type:
            index[(supplier, doc_type, field_key)] = tmpl

        dt_key = (doc_type, field_key)
        dt_accum.setdefault(dt_key, []).append(tmpl)

    # Doc-type fallback: only when ALL suppliers agree on the same template
    fallback = {}
    for dt_key, tmpls in dt_accum.items():
        unique = set(tmpls)
        if len(unique) == 1:
            fallback[dt_key] = unique.pop()

    index['_fallback'] = fallback
    return index


# ── Dominant-value SNAP (Stage 2.5d) ─────────────────────────────────────────
#
# Fixes two OCR artifacts the character-substitution corrector above CANNOT: an inserted
# WHITESPACE (a length change — try_correct requires equal length), and a slip on a field
# whose consensus template got POLLUTED by a mis-confirmed artifact (derive_template treats
# distinct values equally, so once "11O2…" is confirmed once the position collapses to 'A' and
# O→0 stops being fixed). Both are cured by voting BY COUNT: snap a fresh read to the field's
# DOMINANT confirmed literal — the value that clearly dominates the confirmed history — when the
# read equals it after collapsing internal whitespace, or after at most one known OCR-confusion
# substitution. Precision-first (reggie): the dominance gate means a 1x pollutant can never be
# the target and a genuinely-variable field (no dominant) self-excludes. Design notes:
#   • DOMINANT_MIN_COUNT / DOMINANT_MIN_SHARE — the value must recur ≥5x AND be ≥80% of all
#     confirmations. 80% (not 60%) guarantees there is provably ONE canonical, so a legitimate
#     second canonical (a 55/45 split) is never eaten.
#   • Branch A (whitespace collapse) guesses no character → always auto-apply, zero risk.
#   • Branch B (≤1 confusion substitution vs the LITERAL dominant) is stricter than try_correct
#     (fixed target, not a class) but has ONE documented residual: a first-ever REAL sibling code
#     that differs from the dominant by a single confusable char would be rewritten. SNAP_ALLOW_
#     SUBSTITUTION is the kill-switch to disable branch B if that ever bites in the field.
DOMINANT_MIN_COUNT      = 5
DOMINANT_MIN_SHARE      = 0.80
SNAP_ALLOW_SUBSTITUTION = True     # kill-switch for branch B (whitespace branch always on)

_WHITESPACE = re.compile(r'\s+')


def _is_confusion(read_ch: str, canon_ch: str) -> bool:
    """True if OCR could plausibly have produced `read_ch` where the true char is `canon_ch`
    (reusing the existing confusion maps, both directions, plus a case-only difference)."""
    if read_ch == canon_ch:
        return True
    if LETTER_TO_DIGIT.get(read_ch) == canon_ch:   # letter read, digit canonical  (O→0)
        return True
    if DIGIT_TO_UPPER.get(read_ch) == canon_ch:    # digit read, UPPER canonical    (0→O)
        return True
    if DIGIT_TO_LOWER.get(read_ch) == canon_ch:    # digit read, lower canonical    (0→o)
        return True
    if SYMBOL_TO_UPPER.get(read_ch) == canon_ch:   # symbol read, UPPER canonical   ($→S)
        return True
    if read_ch.isalpha() and canon_ch.isalpha() and read_ch.lower() == canon_ch.lower():
        return True                                # case-only
    return False


def snap_to_dominant(value: str, dominant_value: str,
                     allow_substitution: bool = SNAP_ALLOW_SUBSTITUTION) -> tuple:
    """Snap `value` to the confirmed DOMINANT literal when it matches after collapsing internal
    whitespace (branch A) and, optionally, one known OCR-confusion substitution (branch B). The
    caller enforces the dominance + scope guards (build_dominant_index / the engine call site);
    this is the pure string test. Returns (snapped_value, n_subs) or (None, 0)."""
    if not value or not dominant_value or value == dominant_value:
        return None, 0
    collapsed = _WHITESPACE.sub('', value)
    if not collapsed:
        return None, 0
    if collapsed == dominant_value:                # branch A — pure whitespace artifact
        return dominant_value, 0
    if not allow_substitution or len(collapsed) != len(dominant_value):
        return None, 0
    subs = 0
    for r, c in zip(collapsed, dominant_value):     # branch B — ≤1 confusion vs the literal
        if r == c:
            continue
        if _is_confusion(r, c):
            subs += 1
            if subs > 1:
                return None, 0
        else:
            return None, 0                          # a non-confusion difference → not a slip
    return (dominant_value, subs) if subs == 1 else (None, 0)


def build_dominant_index(formats_data: list) -> dict:
    """Per (supplier, doctype, field): the confirmed DOMINANT code literal eligible for the snap,
    plus the SET of all confirmed values (so the engine can leave a read that is itself an observed
    value untouched). A field qualifies only when one value dominates (count ≥ DOMINANT_MIN_COUNT
    and ≥ DOMINANT_MIN_SHARE of all confirmations) AND that value is a single-token code (no
    internal whitespace, ≥1 digit) — which excludes variable fields (no dominant) and word/name
    fields (no digit). Doc-type fallback only when every supplier agrees on the same dominant."""
    index = {}
    dt_accum = {}
    for entry in (formats_data or []):
        field_key = entry.get('field_key', '')
        counts = entry.get('value_counts') or {}
        if not field_key or not counts:
            continue
        dom_val, dom_n = max(counts.items(), key=lambda kv: kv[1])
        total = sum(counts.values()) or (entry.get('confirmed_count', 0) or 0)
        if total <= 0 or dom_n < DOMINANT_MIN_COUNT or dom_n < DOMINANT_MIN_SHARE * total:
            continue
        dom_val = str(dom_val)
        if _WHITESPACE.search(dom_val) or not any(ch.isdigit() for ch in dom_val):
            continue                                # dominant must be a single-token code
        supplier = (entry.get('supplier_name') or '').lower().strip()
        doc_type = (entry.get('document_type') or '').lower().strip()
        rec = {'dominant': dom_val, 'known': {str(v) for v in counts.keys()}}
        if supplier and doc_type:
            index[(supplier, doc_type, field_key)] = rec
        dt_accum.setdefault((doc_type, field_key), set()).add(dom_val)
    fallback = {}
    for dt_key, doms in dt_accum.items():
        if len(doms) == 1:
            fallback[dt_key] = {'dominant': next(iter(doms)), 'known': set()}
    index['_fallback'] = fallback
    return index


def lookup_dominant(dominant_index: dict, field_key: str,
                    supplier_name: str | None, doc_type: str | None):
    """Scope lookup mirroring correct_extraction: exact (supplier, doctype, field) then the
    all-suppliers-agree doc-type fallback. Returns the rec {'dominant', 'known'} or None."""
    if not dominant_index:
        return None
    s  = (supplier_name or '').lower().strip()
    dt = (doc_type or '').lower().strip()
    rec = dominant_index.get((s, dt, field_key))
    if rec:
        return rec
    return (dominant_index.get('_fallback') or {}).get((dt, field_key))


# ── Prefix-outlier model (reggie-designed, Oracle-vetted 2026-07-12) ─────────────────────────────
# A VARIABLE reference field (each value unique → no dominant VALUE, so build_dominant_index is empty
# for it) can still have a dominant leading-alpha CODE PREFIX (DN / INV / PO / SO). A skew-driven
# single-glyph misread of that prefix (DN->IN, DN->YN) is SHAPE-VALID — it passes the reference regex
# and every format/credibility/critical-floor gate — so it auto-files at 95%+ and poisons the learned
# set. The prefix-outlier guard is the only thing that can see it: "this prefix disagrees with the
# field's own confirmed history". FLAG-ONLY (the engine caps conf + notes; the value is never touched
# — the digits are per-doc variable, so the misread can't be corrected, only refused).
# WEIGHT-AWARE PREFIX SUPPORT BAR (2026-07-19): a same-length Hamming-1 neighbour of the dominant
# code prefix is only trusted (exempt from the outlier flag) once its OWN confirmed count clears
# this corpus-proportional bar — mirrors format_anomaly_checker._SHAPE_ACCEPT_MIN/RATIO/ABS. Below
# it, even an already-confirmed STRAY prefix still flags (the DN->IN self-poison fix — a single
# mis-confirmed 'IN' no longer immunises it forever). Env PREFIX_OUTLIER_SUPPORT_FLOOR forces a flat
# count bar (=1 restores the pre-2026-07-19 count-1 membership immunization — the OFF==baseline pin).
_PREFIX_ACCEPT_MIN   = 3
_PREFIX_ACCEPT_RATIO = 0.10
_PREFIX_ACCEPT_ABS   = 8

_LEAD_ALPHA_RE = re.compile(r'^[A-Za-z]{2,}')   # >=2 leading letters; {2,} is the precision gate

def code_prefix(value):
    """Leading-alpha CODE prefix of a value, uppercased — or None. Only for values that carry a digit
    (a code, not a name); pure-numeric / digit-leading serials / single-letter prefixes -> None."""
    v = str(value or '')
    if not any(ch.isdigit() for ch in v):       # must be a CODE
        return None
    m = _LEAD_ALPHA_RE.match(v)
    return m.group(0).upper() if m else None

def build_prefix_index(formats_data):
    """Per (supplier, doctype, field): the DOMINANT leading-alpha code prefix + the SET of all
    confirmed prefixes. Share is over ALL confirmed values (so a mostly-numeric or genuinely mixed
    scope never presents a dominant prefix -> the guard disarms, no nag). Reuses the dominant-index
    thresholds. Supplier+doctype scope only (prefix conventions are per-supplier; no cross-supplier
    fallback)."""
    index = {}
    for entry in (formats_data or []):
        field_key = entry.get('field_key', '')
        counts    = entry.get('value_counts') or {}
        if not field_key or not counts:
            continue
        total_all = sum(max(1, int(c or 1)) for c in counts.values())   # over ALL confirmed values
        prefix_counts, known = {}, set()
        for value, c in counts.items():
            p = code_prefix(value)
            if not p:
                continue
            w = max(1, int(c or 1))
            prefix_counts[p] = prefix_counts.get(p, 0) + w
            known.add(p)
        if not prefix_counts or total_all <= 0:
            continue
        dom_p, dom_n = max(prefix_counts.items(), key=lambda kv: kv[1])
        if dom_n < DOMINANT_MIN_COUNT or dom_n < DOMINANT_MIN_SHARE * total_all:
            continue                                # no trustworthy single prefix -> scope disarmed
        supplier = (entry.get('supplier_name') or '').lower().strip()
        doc_type = (entry.get('document_type') or '').lower().strip()
        if supplier and doc_type:
            index[(supplier, doc_type, field_key)] = {'dominant': dom_p, 'known': known,
                                                      'counts': dict(prefix_counts), 'total': total_all}
    return index

def lookup_prefix(prefix_index, field_key, supplier_name, doc_type):
    """Exact (supplier, doctype, field) lookup — no fallback (prefix conventions are per-supplier)."""
    if not prefix_index:
        return None
    s  = (supplier_name or '').lower().strip()
    dt = (doc_type or '').lower().strip()
    return prefix_index.get((s, dt, field_key))

def is_prefix_outlier(read_prefix, rec):
    """True when read_prefix is a SAME-LENGTH single-substitution (Hamming-1) neighbour of the
    dominant prefix whose OWN confirmed count is below the support bar — a likely single-glyph
    misread (DN->IN) that must be reviewed rather than trusted. WEIGHT-AWARE (2026-07-19): a prefix
    is exempted only once its confirmed count clears max(_PREFIX_ACCEPT_MIN,
    ceil(_PREFIX_ACCEPT_RATIO*total)) OR the absolute escape _PREFIX_ACCEPT_ABS — so a stray misread
    that self-poisoned `known` (2 of 15) is STILL caught, while a genuinely-established second prefix
    self-heals. This REPLACES the old pure membership immunization (`read_prefix in known` exempted a
    prefix forever after a SINGLE confirm — the poison hole). NOT a confusion table: D->I / D->Y are
    skew artefacts. Length-changing misreads fall through (caught by the shape checker). Env
    PREFIX_OUTLIER_SUPPORT_FLOOR forces a flat count bar (=1 restores the pre-change behaviour)."""
    if not read_prefix or not rec:
        return False
    dom = rec.get('dominant')
    if not dom or read_prefix == dom:
        return False
    if len(read_prefix) != len(dom):
        return False
    if sum(1 for a, b in zip(read_prefix, dom) if a != b) != 1:
        return False
    # WEIGHT-AWARE support gate: the read prefix is trusted (not flagged) only once its confirmed
    # count clears the corpus-proportional bar; a low-count known stray (poison) still flags.
    counts = rec.get('counts') or {}
    total  = int(rec.get('total') or 0)
    c = int(counts.get(read_prefix, 0) or 0)
    floor_env = os.environ.get('PREFIX_OUTLIER_SUPPORT_FLOOR')
    if floor_env not in (None, ''):
        try:
            return not (c >= int(floor_env))
        except ValueError:
            pass
    thr = max(_PREFIX_ACCEPT_MIN, math.ceil(_PREFIX_ACCEPT_RATIO * total))
    return not (c >= _PREFIX_ACCEPT_ABS or c >= thr)


# ── S-B: per-scope ref digit-run LENGTH profile (Oracle SIGN-OFF-W/COND 2026-08-01;
# kill REF_LENGTH_OUTLIER_GUARD in the engine, built OFF, flip on its realdoc gate) ──────────
# The learned-SHAPE model folds the digit-run LENGTH of any single-run shape BY DESIGN
# ('@@-#####' -> '@@-#', format_anomaly_checker._fold_shape — do NOT revert: length-invariance
# is what cured the INV999->INV1000 rollover withhold). That leaves digit ACCRETION
# ('INV-121' read 'INV-12110') and glyph DUPLICATION ('PO-64334' read 'PO-643224') invisible
# to every shape gate. This model sees exactly that axis: the per-scope digit-run length
# PROFILE — ('DN-24408')->(5,), ('7602-1354-4')->(4,4,1) — with the SAME dominance and
# weight-aware self-heal bars as the prefix model, so a legitimately-new length confirms in
# (~_PREFIX_ACCEPT_MIN docs flag during a genuine rollover — the accepted, pinned trade-off)
# and a mixed-length scope (>=20% share) never presents a dominant profile at all.

def digit_run_profile(v):
    """Tuple of consecutive-digit-run lengths in the value ('DN-24408' -> (5,)), or None
    when the value carries no digits. Exact-tuple comparisons only — run COUNT and each
    run's length both matter ('7602-1354-4' -> (4,4,1))."""
    runs = re.findall(r'\d+', str(v or ''))
    return tuple(len(r) for r in runs) if runs else None


def build_length_index(formats_data):
    """Per (supplier, doctype, field): the DOMINANT digit-run profile + per-profile confirmed
    counts. Mirrors build_prefix_index: count-weighted over ALL confirmed values, dominant
    requires DOMINANT_MIN_COUNT and DOMINANT_MIN_SHARE; supplier+doctype scope only (length
    conventions are per-supplier; no cross-supplier fallback)."""
    index = {}
    for entry in (formats_data or []):
        field_key = entry.get('field_key', '')
        counts    = entry.get('value_counts') or {}
        if not field_key or not counts:
            continue
        total_all = sum(max(1, int(c or 1)) for c in counts.values())
        prof_counts = {}
        for value, c in counts.items():
            p = digit_run_profile(value)
            if p is None:
                continue
            prof_counts[p] = prof_counts.get(p, 0) + max(1, int(c or 1))
        if not prof_counts or total_all <= 0:
            continue
        dom_p, dom_n = max(prof_counts.items(), key=lambda kv: kv[1])
        if dom_n < DOMINANT_MIN_COUNT or dom_n < DOMINANT_MIN_SHARE * total_all:
            continue                                # no trustworthy profile -> scope disarmed
        supplier = (entry.get('supplier_name') or '').lower().strip()
        doc_type = (entry.get('document_type') or '').lower().strip()
        if supplier and doc_type:
            index[(supplier, doc_type, field_key)] = {'dominant': dom_p,
                                                      'counts': dict(prof_counts),
                                                      'total': total_all}
    return index


def lookup_length(length_index, field_key, supplier_name, doc_type):
    """Exact (supplier, doctype, field) lookup — no fallback (same contract as lookup_prefix)."""
    if not length_index:
        return None
    s  = (supplier_name or '').lower().strip()
    dt = (doc_type or '').lower().strip()
    return length_index.get((s, dt, field_key))


def is_length_outlier(read_profile, rec):
    """True when the read's digit-run profile differs from the scope's dominant AND its own
    confirmed count is below the SAME weight-aware accept bar the prefix guard uses — so a
    genuinely-new convention self-heals (confirm it ~_PREFIX_ACCEPT_MIN times and it stops
    flagging) while a stray misread that self-poisoned the counts is still caught."""
    if not read_profile or not rec:
        return False
    dom = rec.get('dominant')
    if not dom or read_profile == dom:
        return False
    counts = rec.get('counts') or {}
    total  = int(rec.get('total') or 0)
    c = int(counts.get(read_profile, 0) or 0)
    thr = max(_PREFIX_ACCEPT_MIN, math.ceil(_PREFIX_ACCEPT_RATIO * total))
    return not (c >= _PREFIX_ACCEPT_ABS or c >= thr)


def prefix_confirmed(read_prefix, rec):
    """True when read_prefix is a CONFIRMED in-scope code prefix with real support — the
    dominant prefix, or any known prefix whose confirmed count clears the SAME weight-aware
    accept bar is_prefix_outlier uses to exempt (so 'confirmed' means the same thing on both
    sides of the guard pair, and a low-count poison stray is NOT confirmed). Membership, not
    similarity: used by the clipped-suffix reconciliation (suffix_reconcile.py) as its adopt
    bar — a completed prefix the operator has never confirmed in this scope must NOT be
    silently written onto a value."""
    if not read_prefix or not rec:
        return False
    if read_prefix == rec.get('dominant'):
        return True
    counts = rec.get('counts') or {}
    total  = int(rec.get('total') or 0)
    c = int(counts.get(read_prefix, 0) or 0)
    thr = max(_PREFIX_ACCEPT_MIN, math.ceil(_PREFIX_ACCEPT_RATIO * total))
    return c >= _PREFIX_ACCEPT_ABS or c >= thr


# ── FIX B1: ref-prefix type SUGGESTION (suggest-only; the caller keeps the review hold) ──────────
# When the logo says "this supplier" but the same-letterhead cluster spans ≥2 doc types AND the
# skew-garbled title can't resolve which (Fix A's ambiguous-type case), the doc's own reference
# PREFIX is a strong per-supplier type signal: this sender's POs start "PO", their sales orders
# "SO". We reuse the SAME poison-barred learned prefix model as _flag_prefix_outlier (build_prefix_
# index → dominant needs both a min count AND ≥80% share) to pick the sibling — but ONLY as a
# suggestion: the caller pre-selects the resolved type + seeds its fields, and STILL routes the doc
# to review (Oracle/gary 2026-07-13). It never clears the human checkpoint, so a mis-suggestion on a
# contaminated page (own ref garbled to absent while a QUOTED other-type ref reads clean) is benign —
# the reviewer confirms/corrects, strictly no worse than Fix A's coin-flip suggestion.
# UPPERCASE 2-4 letter run + a code number: the shape of a real reference prefix (PO/SO/INV/DN),
# NOT a mixed-case label word abutting a number ("Total 12345"). Missing a mixed-case-printed prefix
# only makes B1 abstain (→ Fix A holds) — the safe direction — so precision here beats recall. The
# learned dominant is itself uppercased (code_prefix), so an uppercase scan matches it.
_CODE_TOKEN_RE = re.compile(r'[A-Z]{2,4}[-/ ]?\d{3,}')

def present_code_prefixes(ocr_text: str) -> set:
    """The set of uppercased leading-alpha CODE prefixes of the reference-shaped tokens on the page
    (PO-24103 → 'PO', SO12345 → 'SO', INV/58225 → 'INV'). Liberal only within the uppercase shape: an
    extra token only ADDS a prefix, and more present prefixes can only push resolve_type_by_ref_prefix
    toward ABSTAIN (the fail-safe direction), never toward a false pick."""
    out = set()
    for m in _CODE_TOKEN_RE.finditer(ocr_text or ''):
        p = code_prefix(m.group(0))
        if p:
            out.add(p)
    return out

def resolve_type_by_ref_prefix(ambiguous_siblings, cluster_supplier, slug_ref_keys,
                               prefix_index, present) -> str | None:
    """Return the ONE sibling slug whose learned dominant ref-prefix is present on the page, else
    None → ABSTAIN (the doc stays HELD by Fix A, unchanged). ambiguous_siblings = {slug: template}
    over the band-13 set (from identify_template); slug_ref_keys = {slug: ref_field_key}.

    Abstains on: null/blank supplier; empty inputs; no learned dominant for a sibling's ref field
    (scope disarmed / mixed-numeric); ZERO matches; or ≥2 sibling dominants present at once — the
    clean party/cross-reference case (a Sales Order printing BOTH its own 'SO-…' and the buyer's
    'PO-…') resolves to ≥2 matches → abstain, so a quoted cross-ref can't force a pick.

    ACCEPTED TRADE-OFF (Oracle B1 pin): the dangerous residual — the doc's OWN ref garbled to absent
    while ONLY a quoted OTHER-sibling ref is present — is a SINGLE match, so this returns the OTHER
    (wrong) slug. That is a benign MIS-SUGGESTION *only because the caller keeps needs_review=True*;
    pinned in tests/test_ref_prefix_retype.py + the skew_type_probe contamination fixture. Do NOT use
    this to clear the review hold without independent own-primary-ref corroboration (the unbuilt B2)."""
    if not cluster_supplier or not ambiguous_siblings or not prefix_index or not present:
        return None
    matching = []
    for slug in ambiguous_siblings:
        ref_key = (slug_ref_keys or {}).get(slug)
        if not ref_key:
            continue
        rec = lookup_prefix(prefix_index, ref_key, cluster_supplier, slug)
        dom = rec.get('dominant') if rec else None
        if dom and dom in present:
            matching.append(slug)
    return matching[0] if len(matching) == 1 else None


def build_known_index(formats_data: list) -> dict:
    """Per (supplier, doctype, field): the SET of every CONFIRMED value. Used to guard the
    character corrector (try_correct) so it never rewrites a value the corpus has actually seen —
    the count-weighted derive_template can force a position to a category, and try_correct would
    otherwise SILENTLY coerce a legitimate minority variant that OCR read correctly (reggie).
    Doc-type fallback is the union across suppliers."""
    index = {}
    for entry in (formats_data or []):
        field_key = entry.get('field_key', '')
        if not field_key:
            continue
        vals = {str(v) for v in (entry.get('value_counts') or {}).keys()}
        if not vals:
            vals = {str(v) for v in (entry.get('sample_values') or [])}
        if not vals:
            continue
        supplier = (entry.get('supplier_name') or '').lower().strip()   # '' = doc-type-scoped learning
        doc_type = (entry.get('document_type') or '').lower().strip()
        index.setdefault((supplier, doc_type, field_key), set()).update(vals)
    return index


def is_known_value(known_index: dict, field_key: str,
                   supplier_name: str | None, doc_type: str | None, value) -> bool:
    """True if `value` is a confirmed sample for THIS supplier scope OR the doc-type-scoped ('')
    learning — mirroring how the engine resolves formats (supplier first, then the global doc-type
    group), NOT a cross-supplier union (that could skip a legit correction for another supplier).
    A confirmed value is real — the corrector must leave it alone."""
    if not known_index or value is None:
        return False
    v = str(value)
    s  = (supplier_name or '').lower().strip()
    dt = (doc_type or '').lower().strip()
    exact = known_index.get((s, dt, field_key))
    if exact and v in exact:
        return True
    glob = known_index.get(('', dt, field_key))    # doc-type-scoped ('' supplier) learning
    return bool(glob and v in glob)


# ── Learned noise-edge stripping ─────────────────────────────────────────────
#
# Distinct from the character-substitution correction above: rather than fixing
# individual confused characters inside a same-length value, this learns
# whether a template's CONFIRMED values ever legitimately carry non-digit
# characters at all. When confirmed history proves they never do (every
# distinct confirmed value for this exact supplier+doctype+field is plain
# digits, across enough instances to trust it), a leading/trailing non-digit
# fragment on a fresh OCR read — the "# " in "# 14269", the "F " in "F 31901"
# — is provably noise (commonly bleed from an adjacent label) and can be
# trimmed conservatively. If even ONE confirmed value carries letters or
# symbols ("INV12343", or a template whose real numbers genuinely include
# "#"), that proves a prefix CAN be legitimate for THIS template — the rule
# permanently does not fire for it, and values pass through untouched.

MIN_CONFIRMED_FOR_NOISE_PROFILE = 10

_NON_DIGIT_EDGE = re.compile(r'^\D+|\D+$')


def infer_digit_only_profile(sample_values: list, confirmed_count: int) -> bool | None:
    """
    True only when confirmed history PROVES this exact template's values are
    always plain digits: unanimous agreement across every distinct confirmed
    value, backed by at least MIN_CONFIRMED_FOR_NOISE_PROFILE confirmed
    instances. A single legitimately-prefixed confirmed value disqualifies the
    inference for this template — one counter-example is enough to prove a
    prefix can be real here, and "infer the simplest pattern supported by the
    history" means we stop, not guess which examples were the exceptions.

    Returns None ("no rule learned — leave OCR output untouched") when there
    isn't yet enough evidence, or the evidence is mixed/non-digit.
    """
    if confirmed_count < MIN_CONFIRMED_FOR_NOISE_PROFILE:
        return None
    clean = [v.strip() for v in (sample_values or []) if v and v.strip()]
    if len(clean) < 2:
        return None
    return True if all(v.isdigit() for v in clean) else None


def strip_non_digit_edges(value: str) -> str:
    """
    Remove leading/trailing runs of non-digit characters, leaving everything
    between the first and last digit untouched. Conservative by construction —
    it can only ever shorten a value from the outside in, never edit a
    character that sits inside the digit run, so an OCR confusion INSIDE the
    number ("3l900") is left for try_correct's substitution logic rather than
    risked here. Never returns an empty string: an all-noise value ("###") is
    left exactly as found rather than wiped out.
    """
    stripped = _NON_DIGIT_EDGE.sub('', value)
    return stripped or value


def build_noise_profile_index(formats_data: list) -> dict:
    """
    Build a strictly-scoped lookup of which (supplier, doctype) invoice_number
    templates have confirmed-digits-only evidence behind them.

    No document-type or global fallback — unlike build_format_index's
    `_fallback`, a learned digit-only profile must never leak outside the
    exact supplier+doctype+field combination that produced the evidence: one
    supplier's numbering convention is not evidence about another's, and a
    rule "for invoice_number" must never apply to any other field.

    Returns:
        {(supplier_lower, doctype_lower, 'invoice_number'): True, ...}
    Absence from the index means "no rule learned — leave value unchanged".
    """
    index = {}
    for entry in (formats_data or []):
        if entry.get('field_key') != 'invoice_number':
            continue
        supplier = (entry.get('supplier_name') or '').lower().strip()
        doc_type = (entry.get('document_type') or '').lower().strip()
        if not supplier or not doc_type:
            continue
        if infer_digit_only_profile(entry.get('sample_values') or [],
                                    entry.get('confirmed_count') or 0) is True:
            index[(supplier, doc_type, 'invoice_number')] = True
    return index


def denoise_value(value: str,
                  field_key: str,
                  supplier_name: str | None,
                  doc_type: str | None,
                  noise_profile_index: dict) -> tuple:
    """
    Apply a learned digit-only edge-strip, scoped to the exact
    supplier+doctype+field combination whose confirmed history produced it.

    Returns:
        (value, was_changed) — the original value and False when no rule
        applies for this exact key, or stripping would be a no-op.
    """
    if not value or not noise_profile_index:
        return value, False

    key = ((supplier_name or '').lower().strip(),
           (doc_type or '').lower().strip(),
           field_key)
    if key not in noise_profile_index:
        return value, False

    cleaned = strip_non_digit_edges(value.strip())
    return (cleaned, True) if cleaned != value else (value, False)


# ── Public entry point ────────────────────────────────────────────────────────

def correct_extraction(value: str,
                       field_key: str,
                       supplier_name: str | None,
                       doc_type: str | None,
                       format_index: dict) -> tuple:
    """
    Look up the best template for this field and attempt OCR correction.

    Returns:
        (final_value, confidence_boost)
        final_value is the original value if no correction was made.
    """
    if not value or not format_index:
        return value, 0

    supplier = (supplier_name or '').lower().strip()
    doc_type_key = (doc_type or '').lower().strip()

    # 1. Supplier-specific template
    tmpl = format_index.get((supplier, doc_type_key, field_key))

    # 2. Doc-type fallback
    if not tmpl:
        tmpl = format_index.get('_fallback', {}).get((doc_type_key, field_key))

    if not tmpl:
        return value, 0

    corrected, boost = try_correct(value, tmpl)
    return (corrected if corrected else value), boost
