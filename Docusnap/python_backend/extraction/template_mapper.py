"""
extraction/template_mapper.py
-----------------------------
Stage 0.5 extraction — admin-drawn anchor -> target zone mappings.

Companion to anchor.py's learned spatial anchors, but sourced from
`template_field_mappings` (drawn on a pinned sample document via
Settings -> Templates, see database/modules/templates.js::saveMapping)
rather than mined from confirmed-document corrections.

Primary model (per the admin tool's design — do NOT reduce this to a fixed
grid lookup): locate the anchor's label text near its drawn position, then
re-derive the target zone from the anchor's ACTUAL location plus the stored
*relative* offset (offset_dx_norm/offset_dy_norm). This makes the mapping
robust to scan/print drift instead of trusting absolute saved coordinates.
The 8-cell `region_hint` recorded alongside each mapping is intentionally
unused here — it is an optimisation hint for a future coarse-skip pass, not
part of this primary anchor+offset mechanism (see CLAUDE.md).

Returns the same shape as anchor.extract_with_anchors:
    {field_key: {"value": str, "confidence": int, "method": str, "anchor": str}}
so engine.py can merge results with its existing confidence-comparison logic
and zero special-casing. When the anchor cannot be located at all, the field
is simply omitted — guaranteeing the documented fallback to the rest of the
pipeline (keyword/anchor/LLM) for that field.
"""

import difflib
import math
import os
import re

from PIL import Image, ImageFilter, ImageOps

from extraction import registration
# Reuse the SAME credibility test the learned-anchor stage uses, so a template
# mapping is held to the same "is this value plausible for the field?" standard
# (typed fields must match their validation pattern; free-text must not be debris).
from extraction.anchor import _crop_is_credible, _repair_single_token, clean_crop_segment, _ocr_crop_laddered, _FREE_TEXT_RESCUE_CONF
# And the SAME learned-format check Stage 4.5 uses, so the failsafe below judges a
# value against the shape this field has historically taken on this template
# (learned from confirmed docs) — label- and field-key-agnostic, one source of truth.
from extraction.format_anomaly_checker import check_value as _check_learned_format

try:
    import pytesseract
    from pytesseract import Output
except ImportError:  # pragma: no cover - exercised only when Tesseract absent
    pytesseract = None
    Output = None

_FUZZY_MATCH_THRESHOLD = 0.6

# Proximity tie-break: when a label REPEATS on the page and several lines match
# the anchor EQUALLY well, prefer the one nearest the original anchor position.
# This must NEVER let a nearer but LOWER-scoring line beat a higher-scoring match
# — doing so picked "Ticket Type" (0.70) over the real "Ticket No." (0.75) merely
# because it sat fractionally closer, returning the wrong row's value. So only
# EXACT-score ties (within this tiny float epsilon) are decided by proximity;
# a meaningfully higher score always wins outright.
_SCORE_TIE_EPSILON = 1e-6

# Floor on the anchor SEARCH margin (page-normalised, every edge), applied even
# when a mapping stored no search_expansion. A drawn anchor box is often tight or
# slightly misaligned, and a shifted scan moves the label further; without a
# margin the label falls outside the box and never relocates. Generic for every
# template -- it only widens WHERE the label is sought; the fuzzy-match threshold
# still rejects a wrong nearby label, so coverage improves without false matches.
_ANCHOR_SEARCH_MIN = 0.06
_UNSET = object()         # "located not provided" sentinel (distinct from a None relocation)
# Minimum normalised drift (per axis) before the absolute drawn box is distrusted
# in favour of the label-relative relocation. A small floor so a tiny anchor box
# still needs a REAL move, not OCR jitter, to count as drift (see _label_drifted).
_DRIFT_FLOOR = 0.02

# ── S-D VACUOUS-FIT GATE, second call site (2026-08-06; Oracle SEND-BACK -> this slice) ───────────
# A similarity fit surviving on n_inliers <= 2 is EXACTLY DETERMINED: `registration.fit_transform`
# scores it on the very points that produced it, so its residual is 0.0000 BY CONSTRUCTION and it
# carries ZERO verification. `registration_confidence` then returns a flat 78 no matter how wrong
# the fit is. This class was already diagnosed, Oracle-authorized and shipped DEFAULT-ON on
# 2026-08-01 — but only at `engine.py`'s Stage-2 call site (`anchor_page_transform`).
# `_fit_page_transform` has TWO callers, and the Stage-0.5 one (extract_with_mappings, below) was
# never gated, so `template_registration` kept consuming exactly the fits Stage 2 refuses.
# THE LIVE EXHIBIT (Castellan Security credit_note, template 32, 2026-08-06): 2 landmarks, one of
# them the 3-char table header 'Qty'. On these pages 'Qty' is not found in its taught box, so the
# page-wide fallback locate matches it onto the line 'Castellan Security Systems' —
# _label_score('qty', 'castellan security systems') = 0.667 >= the 0.6 threshold, because the
# longest common run is 'ty' (from "securi-TY") and the run fraction is measured against the
# 3-char NEEDLE. The resulting fit: scale 1.1445, rotation -166.71 deg, residual 0.000000,
# n_inliers 2, conf 78 — and it displaced the taught supplier box by 0.277 of the page, so
# `template_registration` overwrote the operator's own drawn-box read with whatever landed there
# ('Bramblewood Joinery Ltd' = the CUSTOMER block, 'DELIVER TO', '1 264.00', ...) on 15 of 22 docs.
# Measured on the real PDFs: the taught box read 'Castellan Security Systems' CORRECTLY on every
# doc, so the transform was pure loss — these pages are not drifting (the stable header labels
# relocate within ~0.0005 of page).
# THE GATE IS THE FIX, NOT A NEW MATCHING RULE: refuse the unverified fit and the rung falls through
# exactly as a failed fit always has (absolute read / keyword / review — fail toward review, never a
# blind mapped crop). Placed INSIDE `_fit_page_transform` rather than at the call site (which is how
# engine.py does it) DELIBERATELY: the whole defect is that a shared helper was guarded at one of its
# two callers, so the guard belongs at the single choke point where no present or future caller can
# miss it. engine.py's own gate is left untouched and simply becomes a redundant second net.
# Same kill switch + default as the 2026-08-01 precedent: REG_MIN_INLIERS_GATE=0 restores the old
# behaviour byte-for-byte. The predicate itself lives ONCE in `registration.is_unfalsifiable` and is
# consumed by BOTH call sites — re-inlining it is what caused this bug.
# Pins: tests/test_registration_min_inliers.py.

# Review note attached when a manually-mapped value PASSES the field's regex/type
# but differs from the learned per-(supplier,doctype,field) shape on a DERIVED rung
# (registration / relocation). The value is kept (manual authority) but flagged for
# a human to verify, rather than silently dropped (the old behaviour that let the
# wrong auto value win) or silently committed (a possible wrong-column drift read).
_SHAPE_WARN_NOTE = ("manually mapped value differs from the usual format for this "
                    "field — please verify")

# Types whose format is fully defined by their own precise validator/normaliser, so the
# learned-SHAPE veto must be skipped (they vary legitimately — see _gate_value).
_SELF_VALIDATING_TYPES = frozenset({'date', 'currency', 'currency_code',
                                    'mac_address', 'ip_address'})

# Single-token CODE validation types whose value is ONE token on the label's row, so a
# label-anchored inline read can cross-check (and un-clip) the absolute drawn-box read
# without the free-text garble risk that removed blanket inline-first (see :742-750).
# reference_code is a single dashed token like alphanumeric; job_reference is EXCLUDED —
# its pattern permits internal spaces, so the one-token .split()[0] below would truncate it.
_CODE_CROSSCHECK_TYPES = frozenset({'alphanumeric', 'reference_code'})

# STAGE05_REF_CODE_GATE (kill switch, DEFAULT OFF — reggie design 2026-08-08). A taught box that
# reads its own CAPTION commits it: measured on a 10-issuer teach test, expected 'HTS-SO-12013',
# got the literal 'Ref' at conf 70. Stage 1 has refused codeless reference values since 2026-08-07
# (REF_ROLE_DIGIT_GATE) but that gate lives INSIDE keyword.extract_fields and nothing else consults
# it, so every Stage-0.5 rung was unprotected. `_gate_value` is the single choke point all six rungs
# pass through, so one guard there covers the absolute box, the inline harvest, the derived/
# relocated read, the crosscheck, the registration fallback and the grow.
# Arming is the INTERSECTION of "the crop is typed as a code" and "the key's role is a reference",
# reusing keyword._infer_validation — the same arming Stage 1 already trusts — so no fifth ref
# predicate is created. Refusing returns the standard (None, False, False), i.e. the rung falls
# through to the next one and ultimately to Stages 1/2; it never asserts a value of its own.
_STAGE05_REF_CODE_GATE = os.environ.get('STAGE05_REF_CODE_GATE', '0') != '0'

# TEMPLATE_CURRENCY_EDGE_GROW (kill switch, DEFAULT OFF — owner-reported 2026-08-09).
# Money is the ONE field type whose taught box is sized to a SAMPLE VALUE rather than to a
# fixed-width code, and it is RIGHT-ALIGNED in a totals column — so a longer value grows LEFTWARD,
# past the box's left edge. Observed live: a box taught on '£8,389.44' read '0,603.44' where the
# page prints '£10,603.44' — the leading '£1' fell outside. Net 8,836.20 + VAT 1,767.24 = 10,603.44
# exactly, so the document's own arithmetic knew, and the total-vs-subtotal guard did flag it; but
# nothing REPAIRED it, because currency is absent from `_SNAP_VAL_TYPES` and therefore never reaches
# the absolute-rung edge guard at all. This adds currency to the GUARD's scope only — not to the
# word-snap, whose over-grab class is a different argument.
# The left grow is already bounded by the located label's right edge (the C1 frame rule), so it
# cannot swallow 'Balance Due'.
_CURRENCY_EDGE_GROW_ON = os.environ.get('TEMPLATE_CURRENCY_EDGE_GROW', '0') != '0'

# Stage 0.5 inline-code reconcile — default ON (kill with TEMPLATE_INLINE_CODE_RECONCILE=0).
# A fixed narrow drawn target box clips a code value's prefix under per-scan offset/scale
# (DN-93159 → N-93159) and the alphanumeric gate can't see it; the label-anchored inline
# read can't clip. ON: for a single-token CODE field taught INLINE with its label, prefer
# the fuller of the drawn-box read and the label-anchored inline read. =0: byte-identical.
# Flipped ON after: delivery probe 5/10→10/10, realdoc OFF==ON (0 new), 11 unit/PIN, parity 10/10.
_INLINE_CODE_RECONCILE_ON = os.environ.get('TEMPLATE_INLINE_CODE_RECONCILE', '1') != '0'

# Slice 2 — the same reconcile on the DRIFT/relocate path (`_geometric`), where a drifted taught
# label re-seats the value at the SAME narrow drawn width → identical prefix-clip risk. Routes through
# Slice 1's own page-wide reconcile (Oracle-conditioned robust source). Default ON (kill with
# TEMPLATE_INLINE_CODE_RECONCILE_DRIFT=0). Flipped ON after: forced-drift probe 10/10 + 0 degraded
# + 3 real drift-garble fixes, realdoc DRIFT==baseline (0 new), 4 drift unit/PIN. =0: byte-identical.
_INLINE_CODE_RECONCILE_DRIFT_ON = os.environ.get('TEMPLATE_INLINE_CODE_RECONCILE_DRIFT', '1') != '0'

# Slice B (jitter-crater arc, Oracle 2026-08-05 SIGN-OFF-W/COND) — DATE-CLIP GATE. A right-cut
# taught box reads a clean date FRAGMENT ('07-01-20-' of 07-01-2026, '03-06-202' of 03-06-2026)
# that PASSES the shared date pattern (its \d{2,4} year branch) and commits at 90 — then Stage-4
# normalise expands it to a confidently-wrong full date. Two tells, RAW-text, checked BEFORE the
# salvage fallback so salvage can never resurrect the fragment (B-C2): a dangling date separator
# glued to a <=2-digit year (the crop edge cut mid-token), or an exactly-3-digit year (never
# legitimate). A COMPLETE 4-digit-year date with trailing debris ('07-01-2026.') is EXEMPT
# (B-C1), and a clean 2-digit-year date ('07-01-20') stays ACCEPTED — pinned trade-off: only
# geometry (Slice C) can tell that cut from a real 2-digit year. Fire → (None) → the rung falls
# to the derived ladder or omits the field → review; never a fabricated date. Default OFF
# (=1 arms); OFF = byte-identical. Pins: tests/test_date_clip_gate.py.
_DATE_CLIP_GATE_ON = os.environ.get('TEMPLATE_DATE_CLIP_GATE', '0') != '0'

_DATE_CLIP_NUMERIC = re.compile(r'(?<!\d)(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?!\d)')
# (_date_clip_suspect itself lives beside _gate_value below — the module prefix
#  before the first `def` must keep carrying every kill-switch getenv line: the
#  wiring pins in test_template_code_edge_clean.py inspect exactly that slice.)


# Slice D (jitter-crater arc, Oracle 2026-08-05 SIGN-OFF-W/COND) — LABEL DIGIT-EXACTNESS. The
# fuzzy label blend lets a digit-heavy VALUE-like needle lock a DIFFERENT value as its "label"
# ('03-06-2026' located '07-01-2026' via shared separators + ratio) — the drift guard then calls
# the anchor stable and a wrong lock stands. For needles that are digit-dominant (>=4 digits,
# >=50% of alnum chars), the digit SEQUENCE is the identity: require it contiguous in the
# haystack's digits before any fuzzy blending; absent → 0.0 (a locate MISS → derived rungs —
# the safe fail direction). Caption needles carrying incidental digits ("VAT No 1", "Invoice #2")
# are far below the share bar and untouched. Reaches _match_label_run too (it maximises
# _label_score) — a digit-heavy needle can no longer win a fuzzy window there either (D-C3).
# Default OFF (=1 arms); OFF = byte-identical. Pins: tests/test_label_digit_exact.py.
_LABEL_DIGIT_EXACT_ON = os.environ.get('TEMPLATE_LABEL_DIGIT_EXACT', '0') != '0'


# Slice A — agree-branch EDGE-DEBRIS heal (reggie+gary → Oracle SIGN-OFF-W/COND, fork RULED
# reggie/witness-equality, 2026-08-03 evening — docs/oracle_log.md). The label-tail bleed class:
# a value box drawn a few px off the label ("Delivery Note No.") catches its trailing "." on
# slightly-rotated siblings → every read commits '. DN-60902' (flagged on the drift rung; SILENT
# clean@90 on the absolute rung). The reconcile's inline read holds the clean 'DN-60902' but the
# agree branch (cores equal) discarded it. Heal ONLY when the rigid read with leading/trailing
# NON-alnum runs stripped equals the inline surface VERBATIM (an independent-geometry witness read
# EXACTLY the cleaned string) AND the learned shape does not reject the cleaned value. Interior
# debris / spaced or em-dashed inline / inline-carrying-the-debris / sigil-with-shape-history all
# refuse → today's behaviour verbatim (fail-toward-review). Named-deliberate trade-off (Oracle
# A-C1): a COLD supplier's '#12345' heals to '12345' when inline read it sigil-less — bounded
# (core preserved), convergent with the keyword/Stage-4 canonical form, and self-correcting once
# shape history forms. Default OFF (=1 arms) until the realdoc gate; OFF = byte-identical.
_CODE_EDGE_CLEAN_ON = os.environ.get('TEMPLATE_CODE_EDGE_CLEAN', '0') != '0'

_CODE_EDGE_DEBRIS = re.compile(r'^[^A-Za-z0-9]+|[^A-Za-z0-9]+$')   # bounded, anchored — no nesting


def _strip_code_edges(s):
    """Leading+trailing NON-alnum runs stripped; interior untouched by construction."""
    return _CODE_EDGE_DEBRIS.sub('', s or '')


# Slice A2/C1 composite — ALNUM label-tail FRAGMENT strip (Oracle NIGHT 2026-08-03, fork RULED
# composite: gary's label-suffix binding is the base predicate, reggie's strictness survives as
# the consent LADDER below). The class Slice A can't reach: the crop grabs an ALNUM fragment of
# the label tail ('o. DN-67428' — the 'o' of "Delivery Note No."), which _strip_code_edges can't
# touch and whose core breaks the agree branch. Heal only when the fragment is a case-insensitive
# SUFFIX of the mapping's OWN anchor_text alnum tail (doc evidence, not a lexicon), the remainder
# equals the inline witness VERBATIM, and the consent ladder passes. Kill TEMPLATE_CODE_FRAG_CLEAN
# (default OFF = byte-identical).
_CODE_FRAG_CLEAN_ON = os.environ.get('TEMPLATE_CODE_FRAG_CLEAN', '0') != '0'
# 1-2 LETTERS (digits are value-material — excluded) + a BOUNDED 1-4 char separator run, with an
# alnum value-core ahead (never consumed). Anchored, bounded, no nesting.
_CODE_FRAG_TAIL = re.compile(r'^[A-Za-z]{1,2}[^A-Za-z0-9\r\n]{1,4}(?=[A-Za-z0-9])')

# C2a — right-clip clean commit (gary, Oracle S1/S3 conditions). A truncated rigid whose core is a
# STRICT PREFIX of the inline read used to lose the conf race into a shapewarn'd commit whose note
# ("manually mapped value differs from the usual format") was factually FALSE — the inline value
# passes the learned shape and was simply never shape-checked (the :~750 disagreement branch stamps
# shape_warn unconditionally). Three corroboration legs replace the false flag; ANY leg failing →
# today's flagged path byte-identical. Kill TEMPLATE_CLIP_COMMIT (default OFF).
_CLIP_COMMIT_ON = os.environ.get('TEMPLATE_CLIP_COMMIT', '0') != '0'
_CLIP_COMMIT_MIN_PREFIX = 4        # rigid must corroborate >=4 core chars ('d' prefixing everything is noise)
# EDGE-SLACK (Oracle SIGN-OFF-W/COND 2026-08-06). The C2a clip-commit leg (i) demanded a byte-EXACT
# prefix, so a CLIP-misread FINAL glyph ('9'->'S', box read WS-1493S@44 vs the DOUBLE-witnessed inline
# WS-14939@91) false-flagged the CORRECT inline value @70 with the factually-false "differs from the
# usual format" note. The edge-guard's own _frag_matches already grants this 1-trailing-glyph slack (the
# cut glyph is untrusted); C2a lacked it. Admit a LENGTH-PRESERVING single-trailing-glyph substitution —
# but ONLY when the rigid is markedly LESS confident (it now casts a DISSENTING vote on that glyph; a
# real clip reads low so a genuine heal keeps a big conf gap, and the MARGIN keeps a credible near-tie
# dissent in review; None-conf declines), the SHARED (len-1) prefix clears the floor, and legs (ii)
# ladder + (iv) locate_token==inline (both OCR tiers read the full value incl. the trailing glyph) +
# (v) shape-consent still gate. Nested under _CLIP_COMMIT_ON; default OFF (=1 arms); OFF = byte-identical.
# MARGIN gate-tunable in the SAFE direction (higher = fewer heals). Pins: tests/test_template_frag_clip.py.
_CLIP_COMMIT_EDGE_SLACK_ON = os.environ.get('TEMPLATE_CLIP_COMMIT_EDGE_SLACK', '0') != '0'
try:
    _CLIP_COMMIT_EDGE_SLACK_MARGIN = int(os.environ.get('TEMPLATE_CLIP_COMMIT_EDGE_SLACK_MARGIN', '15'))
except ValueError:
    _CLIP_COMMIT_EDGE_SLACK_MARGIN = 15


def _anchor_alnum_tail(anchor_text):
    """Lowercased alnum fold of the label text ('Delivery Note No.' -> 'deliverynoteno')."""
    return ''.join(c for c in str(anchor_text or '') if c.isalnum()).lower()


def _shape_consents(value, field_key, format_lookup, provisional_lookup):
    """The ONE consent ladder shared by the fragment strip and C2a (Oracle S2 — single helper,
    provisional index consulted NOWHERE else). Returns:
      'confirmed'   — a >=3-confirm learned entry EXISTS and ACCEPTS the value;
      'refused'     — an entry EXISTS and REJECTS it (FINAL — never falls through to provisional);
      'provisional' — no confirmed entry, but the taught-doc skeleton index accepts;
      'none'        — no evidence either way."""
    if format_lookup is not None:
        try:
            entry = format_lookup(field_key)
        except Exception:
            entry = None
        if entry:
            try:
                return 'confirmed' if _check_learned_format(str(value), entry) is None else 'refused'
            except Exception:
                return 'none'
    if provisional_lookup is not None:
        try:
            if provisional_lookup(field_key, str(value)):
                return 'provisional'
        except Exception:
            pass
    return 'none'


# Slice B — TARGET WORD-SNAP (fork design + Oracle SIGN-OFF-W/COND B-C1..C5, 2026-08-03 evening —
# docs/oracle_log.md). On the DERIVED rungs only (drift `_geometric` re-seat + registration
# transform) the seated value box is snapped to the page's word geometry before the crop OCR, so a
# few-px seat error can never chop the value on x or y (the owner's rule: the box snaps to the FULL
# text). The ABSOLUTE rung is untouched (teach-time WYSIWYG contract). CORE INVARIANT: the snap
# only FINISHES words the seated box already touches (majority-inside admission) — it never reaches
# out to new tokens, so a deliberately-narrow taught box keeps excluding its neighbour. Scope =
# CODE types + date (free-text/multiline stay box-first — the over-grab class). Default OFF;
# =1 arms. OFF → helper returns its input, byte-identical.
_TARGET_WORD_SNAP_ON = os.environ.get('TEMPLATE_TARGET_WORD_SNAP', '0') != '0'
_SNAP_VAL_TYPES = frozenset(_CODE_CROSSCHECK_TYPES | {'date'})
# The EDGE GUARD's own scope: the snap's types plus currency (see the _CURRENCY_EDGE_GROW_ON flag
# block). Derived here, BELOW _SNAP_VAL_TYPES — defining it up in the flag zone was a NameError at
# import that py_compile cannot see, because it checks syntax and never resolves a name.
_EDGE_GUARD_VAL_TYPES = frozenset(_SNAP_VAL_TYPES | {'currency'})
# NOTE (2026-08-06): a COMPOSED-BOX WORD-SNAP on the ABSOLUTE rung (TEMPLATE_COMPOSE_WORD_SNAP) was
# built + Oracle-reviewed here and SENT BACK / reverted — the nicked composed-code/date class is
# ALREADY healed by the Slice-C _abs_edge_guard (which runs on the composed target_box WITH
# corroboration + fail-to-review); a pre-read snap was a 2nd consent-less healer on the same class.
# The NF gate confirmed it net-negative (job_ref -4 via multi-token shrink-truncation, account_no
# -6 on level docs via over-grab; date only +3). The RIGHT fix, if pursued, is a snap-union
# GEOMETRY WITNESS inside the edge-guard's consent ladder (docs/oracle_log.md 2026-08-06), not a
# new snap rung. Do not re-add a pre-read abs-rung snap without that redesign + its own gate.

# Slice C (jitter-crater arc, Oracle 2026-08-05 SIGN-OFF-W/COND C-C0..C5, fork RULED for 007's
# GROW over demote-to-ladder) — ABSOLUTE-RUNG WORD-EDGE GUARD. The crater class: a right/left-cut
# taught box on an UNDAMAGED page reads a CLEAN PARTIAL ('VXC153' of VXC1536) that passes the
# type gate and commits silently at 78-90 — every shipped heal keys on page-vs-taught
# DISAGREEMENT (label displaced / transform divergent / witness disagreeing), so nothing fires
# (proven: armed-env jitter rerun byte-identical). Only the page's WORD GEOMETRY witnesses the
# damage. When a row-band word is CUT by the read box's edge (intrusion >= ~1 glyph inside,
# overhang >= max(0.004, 0.6 glyph) outside, inside-fraction 0.12-0.95), GROW the READ crop to
# the cut word's far edge (+0.004 pad; right <= 2.0x drawn width; left never past the located
# label's right edge + 0.002 — the C1 frame rule), full-res re-read, per-type comparator (codes:
# stripped-core prefix with <= 1 trailing-glyph slack — the cut glyph misreads; dates: the grown
# read must gate as a date + digit-prefix discipline), then consent: codes via _shape_consents
# (confirmed/provisional -> CLEAN commit '_edgegrow'; none -> grown FLAGGED <= 70; refused ->
# keep the rigid read SILENTLY — the deliberate-sub-token-teach protection); dates self-consent
# on a complete un-suspect parse (self-validating type — learned-shape stats never veto dates).
# Comparator/gate failure -> commit the rigid read capped <= 70 + note '_edgecut' (fail-toward-
# review: the geometric evidence stands even when the heal could not complete). The predicate is
# GATE-OUTCOME-INDEPENDENT (C-C1: it runs even when Slice B rejected the fragment, so B cannot
# starve C) and the STORED mapping coordinates are NEVER mutated (C-C3, pinned). Composed BEFORE
# _inline_code_reconcile — a clean heal rewrites the rigid SURFACE and the reconcile's
# independent inline witness still arbitrates it (no new _pick_fuller_code branch — its order is
# pinned/load-bearing). Scope = codes + dates (_SNAP_VAL_TYPES); NAMES excluded v1
# (NAME_UNCLIP_RECONCILE owns that class — two dark healers racing one class breeds M=1s).
# Teach-time word-snap (teach_box_word_snap ON) is the licence: stored boxes are word-aligned at
# teach, so a read-time mid-word edge is drift evidence, not operator intent. Default OFF
# (=1 arms); OFF = byte-identical. Pins: tests/test_template_abs_edge_guard.py.
_ABS_EDGE_GUARD_ON = os.environ.get('TEMPLATE_ABS_EDGE_GUARD', '0') != '0'
_EDGE_CUT_NOTE = ("The taught box's edge cuts through the printed value here and the fuller "
                  "reading could not be verified — please check this value.")
_EDGE_GUARD_FIRES = []   # per-process census: (field_key, edges, outcome) — tests + SFDEV introspection

# SNAP-UNION GEOMETRY WITNESS (Oracle SIGN-OFF-W/COND 2026-08-06, docs/oracle_log.md) — the
# deferred RIGHT fix for the composed/derived NICK class the reverted compose-snap targeted. A
# heavily garbled clip ('VIN-O0U5D' of DN-58038) shares no glyphs with the grown read, so the
# edge-guard's _frag_matches comparator floors it and the correct value ships FLAGGED @70 even
# though the page plainly shows it. When the LOCATE-tier words inside the grown box reconstruct the
# grown read `gv` EXACTLY + CONTIGUOUSLY + edge-ANCHORED to the un-cut side of the TAUGHT box, that
# independent geometry stands in for the missing shape history (teach-once) and licenses a CLEAN
# heal. It SKIPS ONLY the _frag_matches gate — the negative per-cut-word veto and the `refused`
# protection still gate (a deliberate sub-token teach still wins). Codes only (dates self-consent);
# BOTH-cut (no un-cut edge to anchor) never promotes in v1. Nested under _ABS_EDGE_GUARD_ON (it
# lives in the guard). Default OFF (=1 arms); OFF = byte-identical. Pins:
# tests/test_template_snap_union_witness.py.
_SNAP_UNION_WITNESS_ON = os.environ.get('TEMPLATE_SNAP_UNION_WITNESS', '0') != '0'

# EDGE-CUT → LABEL-RELOCATE (Oracle SIGN-OFF-W/COND 2026-08-06 — the PLACEMENT pivot). The
# delivery_number VIN-O0U5D class is a cross-doc PLACEMENT-transfer failure, not a reading one: a
# taught ABSOLUTE box, seated a hair off on a sibling (sub-_DRIFT_FLOOR, so the drift branch never
# fires), CLIPS the value → garbled rigid read. The horizontal edge-guard GROW cannot recover a
# VERTICAL seat clip (it never moves y/h). The reliable placement primitive already exists — the
# derived path re-seats the value off the LOCATED label + stored offset and word-snaps it to the
# real word geometry (both axes) — but it is structurally unreachable once the abs read produced a
# non-empty garble. So: when the edge-guard could NOT clean-heal a cut, re-seat via the LOCAL
# located label (Rule A: never a fresh page-wide locate — genuine drift is owned by the drift
# branch) + `_relocate_and_read`, and PREFER the re-seated value over the abs garble. Stage-1
# commits it FLAGGED (<=70 + note, pre-filled for review) — NEVER a silent clean auto-file of a
# no-history teach-once value (Oracle Cond 3); it earns clean ONLY via confirmed/provisional shape
# consent. The edge-directional frag-tie + the snap-union witness clean-UPGRADE are a deferred
# Stage-2 (own switch + own gate). CO-REQUIRES _TARGET_WORD_SNAP_ON — the word-snap is the entire
# y-cure; without it the re-seat reproduces the same clipped y (Oracle Cond 0). Scope = CUT-DETECTED
# clips only (a pure-vertical-inside-column clip never arms _find_edge_cut_words — named open in
# pendingfeatures). Default OFF (=1 arms); OFF = byte-identical. Pins: tests/test_template_edge_cut_relocate.py.
_EDGE_CUT_RELOCATE_ON = os.environ.get('TEMPLATE_EDGE_CUT_RELOCATE', '0') != '0'

# PAD-WINDOW DATE READ (Oracle SIGN-OFF-W/COND 2026-08-06 — the DATE-CROP read ROOT fix; SUPERSEDES
# the raw-frame-election premise in docs/designs/DATE_CROP_DESKEW_READ_2026-08-06.md). A taught DATE
# box, drawn tight on the teach sample, CLIPS the value's leading glyph on a sibling scan
# ('03/04/2026' -> '3/04/2026', or a substituted '01/04/2026') and the still-parses misread commits
# SILENTLY at 90 — the abs rung gates on regex/type only (shape_mode='ignore') and structured types
# skip the ocr_conf cap, so a valid-shaped WRONG date has no backstop. PROVEN by a 4-doc empirical
# probe (filed Larkspur invoices): the TIGHT crop garbles the leading glyph on BOTH
# the raw AND the deskewed frame at every angle (-0.5..2.3 deg); a REAL padded WINDOW of neighbouring
# page pixels + psm6 recovers it, while the shipped synthetic quiet-zone (_struct_prep) CANNOT — the
# ink is clipped OUT. So this is NOT a deskew-frame problem (the raw election was RED-gate-prone AND
# unnecessary — raw is sometimes WORSE): it is a tight-crop problem, fixed on the CURRENT frame.
# SLICE 1 (dates only): after a taught date commits off the ABSOLUTE / edge-cut path, read a
# row-bounded padded window; on a PARSED-value DISAGREEMENT read with a confidence MARGIN over the
# tight read, KEEP the committed value but FLAG it (<=70 + validation_note carrying the padded
# suggestion) -> the wrong silent auto-file becomes a review. It NEVER silent-swaps (a padded
# neighbour-grab must not become the filed value). Neighbour rejection is GEOMETRIC-ONLY for dates
# (Oracle C2 — the textual witness-fold is degenerate: 01/04 vs 02/04 folds to 'reject'): the padded
# date must be the single row-bounded qualifier NEAREST the taught-box centre; abstain on >=2
# near-equidistant candidates or >1 distinct salvaged date. Case-1 (empty tight read) is NOT adopted
# here (Oracle C1 — the empty path already falls to the correct keyword read; a witnessless adopt
# would regress that fail-safe). Codes stay owned by _inline_code_reconcile + the edge-guard family
# (Slice 1b, deferred). Slice 2 (deferred, engine merge layer) = keyword-corroborated SILENT heal.
# HARNESS NOTE: the corpus scorer CANNOT bit-reproduce the live app tilt misread
# (HANDOVER_2026-08-06_DAY2) -> the gate is REGRESSION + false-flag only; the heal is owner-watched
# live. Default OFF (=1 arms); OFF = byte-identical. Pins: tests/test_template_pad_window_read.py.
_PAD_WINDOW_READ_ON = os.environ.get('TEMPLATE_PAD_WINDOW_READ', '0') != '0'
_PAD_DISAGREE_MARGIN = 15          # padded read's OCR conf must beat the TIGHT read's by this (Oracle ~15)
_PAD_DATE_DISAGREE_NOTE = ("A wider reading of this date box shows '{}', which differs from the filed "
                           "value — please verify.")

# PAD-WINDOW CODE READ (Slice 1b — gary design -> Oracle SIGN-OFF-W/COND 2026-08-09). The date slice's
# sibling for CODE/reference fields, aimed at the LABEL-LESS taught box class the containment ladder
# can't reach: a pure-absolute box (no anchor_text) too tight for its value CLIPS the leading glyphs
# ('PO-40351' -> '40351') or garbles ('IM.ANKI1'), and the clip is FORMAT-VALID so the merge-layer
# TEMPLATE_FORMAT_FAIL_YIELD declines it. A row-bounded PADDED re-read of the SAME box recovers the
# fuller code (probe-proven). Decision (Oracle-conditioned):
#   • SWAP (adopt the padded value, same tier as a clean read of this box, no note) ONLY on a STRICT
#     SUFFIX containment (padded ENDS WITH the tight read, i.e. a recovered clipped PREFIX) + a
#     substantial-overlap floor + the field's HARD reference_code pattern + a conf margin + a CONSENT
#     gate (the padded shape is confirmed/provisional — fork B; a COLD read never clean-swaps, closing
#     the label-glue false-swap 'PONo40351'.endswith('40351')).
#   • FLAG (keep the committed value, cap<=70 + note carrying the padded suggestion) on any other
#     confident disagreement (a garble; or a suffix-containment whose shape is still cold).
#   • ABSTAIN (byte-identical no-op) otherwise: already-noted result (Oracle — never erase the
#     edge-guard/shape review flag), prefix-containment (padded over-read to the RIGHT; the tight read
#     was correct), weak margin, padded fails the hard pattern, empty tight, equidistant candidates.
# HONEST CEILING for the LABEL-LESS scope (Oracle 2026-08-09): a label-less code box commits at 78 <
# the critical floor 88, so it is review-bound regardless — for that scope this slice makes the review
# CORRECT + EXPLAINED, it does NOT restore auto-file. That ceiling is SCOPE-SPECIFIC; see the LABELLED
# sub-slice below, where it does NOT hold. Default OFF; OFF = byte-identical.
# Pins: tests/test_template_pad_window_code.py.
_PAD_WINDOW_CODE_ON = os.environ.get('TEMPLATE_PAD_WINDOW_CODE', '0') != '0'
_PAD_CODE_MIN_SUFFIX = _CLIP_COMMIT_MIN_PREFIX   # >=4 tight-read chars must survive as the padded suffix
_PAD_CODE_DISAGREE_NOTE = ("A wider reading of this box shows '{}', which differs from the filed "
                           "value — please verify.")

# ── LABELLED sub-slice (2026-08-06 — gary design -> Oracle SIGN-OFF-W/COND C1..C7) ────────────────
# The 2026-08-09 sign-off scoped the slice above to LABEL-LESS boxes on the stated ground that "a
# labelled box is served by _inline_code_reconcile". THAT PREMISE WAS WRONG, and the correction is the
# whole reason this sub-slice exists. Traced live on the Larkspur Interiors purchase_order template
# (id 30, po_number, anchor_text='Order No.'): the reconcile's page-wide locate picks the FOOTER prose
# line over the true caption (the caption OCRs 'Order'->'Orden' = 0.75, while the prose sentence scores
# 0.875 on _label_score's partial-credit branch), so inline_val comes back EMPTY and the reconcile
# declines on 7 of 8 docs. The clipped absolute read ('PO-48009' -> '-48009') then commits at the
# LABELLED tier — confidence 90, no note — i.e. a SILENT WRONG AUTO-FILE. (The locate defect itself is
# a far larger lever and is deliberately NOT fixed here — see pendingfeatures.md 2026-08-06.)
# WHY THIS IS A BACKSTOP AND NOT AN OVERRIDE: the call site sits AFTER `if rc is not None: return rc`,
# so reaching it already proves the reconcile declined (true while _INLINE_CODE_RECONCILE_ON, default
# ON — name the dependency, do not assume it).
# THE TIER CHANGE IS THE HEADLINE RISK: _mapping_result gives full_confidence -> 90, so a LABELLED swap
# is auto-fileable where a label-less one (78) was review-bound regardless. Oracle ruled the
# counterfactual ("the WRONG value already occupies that 90 channel") sufficient to license the swap but
# NOT to award it on weak evidence — hence the consent TIERING below.
# CONDITIONS BUILT IN (all Oracle-required):
#   C1 no-op (swap AND flag) when the reconcile produced a USABLE inline witness (located + non-empty
#      inline read) — a same-pixel padded re-read must never overturn, or flag against, a stronger
#      independent-pixel label-anchored full-res witness that already arbitrated. _pick_fuller_code's
#      branch order is load-bearing and pinned; this keeps it authoritative. It also cures the
#      "relies on the locate defect persisting" seam: repair the locate and this sub-slice goes inert
#      by construction rather than fighting R5.
#   C2 no-op unless the committed read is the PURE absolute read — never when the crop was EXPANDED
#      (committed came from a WIDER box, so a narrower pad window cannot be a "recovery") nor when the
#      edge guard already GREW and healed it (_edgegrow carries NO validation_note, so the note-first
#      short-circuit cannot protect it and a pad flag would drag a consented heal down to 70).
#   C3 tier the swap by consent STRENGTH: 'confirmed' (>=3-confirm learned shape) keeps the full tier;
#      'provisional' (a single taught-doc skeleton, from a template whose box we KNOW is mis-drawn)
#      swaps the VALUE but caps below the 88 critical floor -> the operator gets the corrected string
#      pre-filled and one review, after which confirmed history auto-files every later sibling. This is
#      what closes the cold-start channel (first docs through a new template can no longer silently
#      auto-file an uncorroborated swap).
#   C4 reject a padded candidate that BEGINS with a >=2-char suffix of the label's alnum tail
#      ('No.PO-48009' -> 'nopo48009' starts with 'no' of 'orderno') -> fall to FLAG. The pad window
#      provably overlaps the label on a labelled inline box (hpad caps at 0.06 of page width, wider
#      than the label->value gap), and the reader is deliberately LABEL-BLIND, so the label knowledge
#      belongs here in the DECISION. Not tuning-to-sample: "never adopt a string that starts with the
#      tail of the label you know sits to its left."
# A left-pad geometric CLAMP was considered and REJECTED (gary, upheld by Oracle): clamping to the
# taught anchor's right edge leaves ~0.01 of page width — inert on the motivating case — and clamping
# to the LOCATED label would import the broken locate into the one primitive whose value is being
# label-blind. Taught coordinates are not jitter-invariant either.
# STRICT SUBSET of the parent flag so there is no orphan state. Default OFF; OFF = byte-identical.
_PAD_CODE_LABELLED_ON = (_PAD_WINDOW_CODE_ON
                         and os.environ.get('TEMPLATE_PAD_WINDOW_CODE_LABELLED', '0') != '0')
_PAD_CODE_PROVISIONAL_CAP = 87   # C3: below the 88 critical auto-file floor (trust.js), never at it
if os.environ.get('TEMPLATE_PAD_WINDOW_CODE_LABELLED', '0') != '0' and not _PAD_WINDOW_CODE_ON:
    # Orphan state: the sub-flag is a STRICT SUBSET, so alone it is inert. Say so once — an owner who
    # armed only this one must not conclude the feature is broken.
    try:
        import sys as _sys_warn
        _sys_warn.stderr.write("[template_mapper] TEMPLATE_PAD_WINDOW_CODE_LABELLED=1 is INERT "
                               "without TEMPLATE_PAD_WINDOW_CODE=1 (strict subset)\n")
    except Exception:
        pass

# ── TEMPLATE_INLINE_ROW_OVERLAP (2026-08-07 NIGHT2 — 007 rounds 1+2, arm-C proven) ────────────────
# `_target_inline_with_anchor` answers ONE question: "did the operator teach this value on the
# label's OWN row?" It answered it with `max(anchor_h, target_h, _DRIFT_FLOOR)` — and _DRIFT_FLOOR
# (0.02) is a *drift* floor, a "has this page moved a row?" tolerance, reused as a *same-row* test.
# 0.02 of page height is ~70px on an A4 render = 1.5-3 line pitches, so the predicate says "inline"
# for boxes that are one, two, even three lines apart. It admits the label-ABOVE layouts the
# docstring says it excludes.
# LIVE EXHIBIT (Pelican Office Interiors delivery_note, delivery_number): anchor/target boxes do not
# overlap vertically AT ALL (0.0045 gap, Δcy 0.01515, h 0.0083/0.0130) and the predicate still
# admitted them, so `_inline_code_reconcile` -> `_pick_fuller_code`'s inline-disagreement branch
# committed the NEIGHBOURING CAPTION 'Delivery' as the value at conf 70. That branch tie-breaks on
# OCR confidence, and a dictionary word ('Delivery Date') systematically outscores a code
# ('PD/26/6680') on an LSTM engine — so once admitted, the caption wins EVERY time. 4 of 9 docs.
# THE FIX IS THE DEFINITION, NOT A CONSTANT: two boxes share a row iff their centres are within the
# mean of their heights — `tol = (anchor_h + target_h) / 2`. No magic number, DPI-invariant, scales
# with whatever the operator actually drew. On Pelican: Δcy 0.01515 vs tol 0.01065 -> refused, 42%
# margin. On a true inline row (Δcy ~0.001) it stays admitted with an order of magnitude to spare.
# ONE PREDICATE, TWO DOORS: `_target_inline_with_anchor` is the sole gate of BOTH
# `_inline_code_reconcile` call sites — :1241 (drift/geometric rung, switch
# TEMPLATE_INLINE_CODE_RECONCILE_DRIFT) and :1880 (absolute rung, switch
# TEMPLATE_INLINE_CODE_RECONCILE). Fixing it here closes both. Isolating only ONE of them is what
# made the first A/B (arm B) heal 1 of 5 and look like a refutation; with BOTH off, arm C healed
# 5 of 5 with 0 regressions — including the TEACH SAMPLE, which takes the zero-drift absolute path.
# DOOR C — `_inline()` (:1255) has NO switch and NO layout guard at all: it commits a same-row
# harvest regardless of what the mapping taught. Latent whether or not it fires on Pelican, so this
# flag guards it too, but ONLY where a stored offset exists (dx or dy). A LEGACY offset-less mapping
# (dx=dy=0) keeps `_inline()` as its PRIMARY read at :1296 — it has no geometric model to fall back
# to, so guarding it there would delete the read outright. That trade-off is PINNED.
# WHAT THIS DISABLES DOWNSTREAM (name the seam): a label-above mapping whose geometric read fails no
# longer gets a same-row second chance — it falls through to the registration fallback (:1968) and
# then omits the field -> REVIEW. That is the intended direction (fail toward review, never a
# confident caption), but it IS a recall trade: expect some values that used to commit a WRONG
# neighbour to now arrive EMPTY.
# Ship it as "a taught label-above mapping may not commit a same-row harvest", NOT as "the delivery
# fix". Default OFF; OFF = byte-identical (the legacy `max(...)` expression is preserved verbatim).
# Pins: tests/test_template_inline_row_overlap.py.
_INLINE_ROW_OVERLAP_ON = os.environ.get('TEMPLATE_INLINE_ROW_OVERLAP', '0') != '0'

# ── TEMPLATE_FREETEXT_GUARD_PARITY (gary design + Oracle SIGN-OFF-W/COND, 2026-08-08) ────────────
# THE FREE-TEXT GUARDS ARE ARMED ON THE WRONG PREDICATE, AND ONE OF THEM IS ENTIRELY DEAD.
# `_gate_value`'s OCR-debris guard and name-quality guard both test `if not val_type`, while the
# sibling confidence CAP in `_mapping_result` tests `val_type in (None, 'text', 'multiline_text')`.
# The two disagree because SIX SHIPPED KEYS carry a truthy free-text validation in
# config/keyword_patterns.json — supplier_name, customer_name, payment_terms, buyer_name ('text')
# and supplier_address, customer_address ('multiline_text'). (NOT via engine._TYPE2VAL, which
# deliberately omits both types — that was a wrong first diagnosis, corrected by gary.)
# So those six BUILT-IN keys skip both guards while every CUSTOM free-text field (val_type None)
# gets them — the protection runs backwards from what anyone would expect, and it is the direct
# opposite of the owner's "custom fields must detect the same way as built-in ones".
# WORSE, and this is the headline: `value_quality.is_name_like_field` fires on exactly
# supplier_name / customer_name / buyer_name / *_address, so THE NAME-QUALITY GUARD IS DEAD FOR ITS
# ENTIRE INTENDED POPULATION at Stage 0.5 — while anchor.py applies the same rule to the same keys
# at Stage 2. `val_type='text'` is in fact the least-guarded state in the system: weaker than None,
# because validation_patterns has no 'text' entry either, so there is no regex behind it.
# SCOPE: guards A (debris) + B (name-quality) only. The third guard, the free-text CONFIDENCE FLOOR
# at the `ocr_conf` check, is deliberately NOT included — Oracle SENT IT BACK (see the cap below).
# Default OFF; OFF reduces EXACTLY to the legacy `not val_type` and is byte-identical.
_FT_GUARD_PARITY_ON = os.environ.get('TEMPLATE_FREETEXT_GUARD_PARITY', '0') != '0'

# ── TEMPLATE_FREETEXT_FALLTHROUGH_CAP (Oracle's BLOCKING precondition for the flag above) ────────
# Rejecting a value at the absolute rung is not free: it hands the field to the DERIVED rungs, and
# two of them build their result WITHOUT an ocr_conf, so the free-text cap in `_mapping_result`
# never fires there. `_inline()` cannot even supply one — `_locate_anchor` returns inline_value with
# no confidence attached — and `_read_registration` assembles its own dict. A garbled free-text read
# that today commits at ~50 (capped by ocr_conf, BELOW the 70 review threshold, so a human sees it)
# can therefore re-commit from the merged OCR line at 90, unflagged. On a cold scope `_format_rejects`
# has no history, so the shape warning does not fire either. That is a guard whose net effect is to
# convert a REVIEWED wrong value into a SILENT wrong value — strictly worse than the bug it fixes.
# The cap closes that door: a free-text value committing from those two rungs is held to
# _FT_FALLTHROUGH_CAP (78, below the 88 critical-field floor) and carries a review note.
#
# DELIBERATE DEVIATION FROM THE ORACLE CONDITION, STATED SO IT IS NOT MISTAKEN FOR AN OVERSIGHT:
# Oracle specified ONE flag covering both the guards and this cap. It is split into two here for a
# measurement reason — 11 of the 38 live mappings are `supplier_name` with dx=dy=0, and a mapping
# with no stored offset keeps `_inline()` as its PRIMARY read, so a blanket cap would flag the
# issuer on those templates whether or not any guard ever rejected anything. Two flags let the gate
# price the guards and the cap separately instead of reporting their sum. The safety property Oracle
# required is preserved by the RULE, not by the flag count: GUARD PARITY MUST NOT BE FLIPPED WITHOUT
# THIS CAP. Both default OFF and both OFF is byte-identical.
_FT_FALLTHROUGH_CAP_ON = os.environ.get('TEMPLATE_FREETEXT_FALLTHROUGH_CAP', '0') != '0'
_FT_FALLTHROUGH_CAP = 78
_FT_FALLTHROUGH_NOTE = ("this value was read from the surrounding line rather than the taught box — "
                        "please check it")


def extract_with_mappings(page_images, mappings, field_patterns=None,
                          ocr_lines_fn=None, ocr_text_fn=None, slice_capture=None,
                          validation_patterns=None, format_lookup=None,
                          template_landmarks=None, registration_enabled=False,
                          provisional_lookup=None):
    """
    Run every enabled mapping against `page_images` and return resolved fields.

    `ocr_lines_fn`/`ocr_text_fn` default to the real Tesseract-backed helpers
    below; tests inject deterministic stubs (matching this codebase's existing
    convention of testing extraction logic directly rather than through OCR —
    see tests/test_validator_ocr_sanitisation.py) so the geometry, relocation
    and merge behaviour can be verified without Tesseract installed.
    """
    if not page_images or not mappings:
        return {}
    ocr_lines_fn = ocr_lines_fn or _ocr_lines
    ocr_text_fn  = ocr_text_fn  or _ocr_text

    # Enabled mappings that point at a valid, present page (filtered once).
    usable = []
    for mapping in mappings:
        if mapping.get("enabled") is False or mapping.get("enabled") == 0:
            continue
        if not mapping.get("field_key"):
            continue
        page_idx = mapping.get("page_number") or 0
        if page_idx < 0 or page_idx >= len(page_images) or page_images[page_idx] is None:
            continue
        usable.append((page_idx, mapping))

    # Per-page OCR cache (Stage 1 / #4): memoises full-page image_to_data so the
    # transform fit + every per-field page-wide relocation share ONE pass per page
    # (see _locate_anchor). One dict for the whole call; keyed by (page, crop_box).
    line_cache = {}

    # Pre-pass: relocate every mapping's anchor ONCE and cache it so _extract_one
    # reuses it (no anchor OCR'd twice) for the single-label local-refinement path.
    located_cache = {}
    for page_idx, mapping in usable:
        anchor_box = _norm_box(mapping, "anchor")
        if not anchor_box:
            located_cache[id(mapping)] = None
            continue
        _acap = ((lambda c, _m=mapping, _p=page_idx, _ab=anchor_box:
                    slice_capture(_m.get("field_key"), "template_mapping", _p,
                                  (_ab["x_norm"], _ab["y_norm"], _ab["w_norm"], _ab["h_norm"]),
                                  c, "anchor")) if slice_capture else None)
        located_cache[id(mapping)] = _locate_anchor(
            page_images[page_idx], anchor_box, mapping.get("anchor_text"),
            float(mapping.get("search_expansion") or 0.0), ocr_lines_fn,
            min_search=_ANCHOR_SEARCH_MIN, capture=_acap, line_cache=line_cache)

    # Per-page registration transform ("register, then read", P4): when the
    # template carries taught landmarks, RE-locate them on THIS page and fit a
    # robust similarity transform ONCE per page (not per field), so taught target
    # boxes follow a shifted/skewed/scaled scan. Gated by registration_enabled; a
    # too-few/poor fit yields None and every field falls through to the existing
    # anchor/offset path — never worse than today.
    page_transform = {}
    if registration_enabled and template_landmarks:
        lm_by_page = {}
        for lm in template_landmarks:
            lm_by_page.setdefault(int(lm.get("page_number") or 0), []).append(lm)
        for page_idx in {pi for pi, _ in usable}:
            lms = lm_by_page.get(page_idx)
            if lms:
                page_transform[page_idx] = _fit_page_transform(
                    page_images[page_idx], lms, ocr_lines_fn, line_cache=line_cache)

    results = {}
    for page_idx, mapping in usable:
        field_key = mapping["field_key"]
        if field_key in results:
            continue
        outcome = _extract_one(page_images[page_idx], mapping, field_patterns,
                               ocr_lines_fn, ocr_text_fn,
                               located=located_cache[id(mapping)],
                               page_transform=page_transform.get(page_idx),
                               slice_capture=slice_capture, page_idx=page_idx,
                               validation_patterns=validation_patterns,
                               format_lookup=format_lookup, line_cache=line_cache,
                               provisional_lookup=provisional_lookup)
        if outcome:
            results[field_key] = outcome
    return results


def resolve_geometry(page, mapping, field_patterns=None, template_landmarks=None):
    """Where does this mapping RESOLVE on `page`? Returns the located anchor-label
    box and the target box actually READ (after any drift relocation / registration),
    plus the read value — for the Template Wizard's "show where it reads" overlay, so
    the operator SEES the anchor/target track the document instead of sitting at the
    drawn coordinates. Reuses the SAME locate + the real extractor (the resolved
    target is captured via the existing slice_capture hook = the winning rung's
    actual crop), so the overlay matches extraction exactly. This is an on-demand
    ADMIN preview path, so the extra OCR locate is acceptable (not the hot path).

    Returns: {value, confidence, method,
              anchor_box: [x,y,w,h]|None,   # where the label was located (None if not found / merged-row)
              target_box: [x,y,w,h]|None}   # the crop actually read (the resolved value position)
    All boxes page-normalised, matching the drawn-coordinate space."""
    anchor_box  = _norm_box(mapping, "anchor")
    anchor_text = mapping.get("anchor_text")
    located = None
    if anchor_box:
        located = _locate_anchor(page, anchor_box, anchor_text,
                                 float(mapping.get("search_expansion") or 0),
                                 _ocr_lines, min_search=_ANCHOR_SEARCH_MIN)
        if not located and anchor_text:
            located = _locate_anchor(page, anchor_box, anchor_text, 1.0,
                                     _ocr_lines, min_search=_ANCHOR_SEARCH_MIN)

    captured = {}
    def _cap(_fk, _stage, _pi, bbox, _img, kind):
        captured[kind] = [round(float(v), 5) for v in bbox] if bbox else None

    # INDEX-ALIGN THE PAGE LIST (TEMPLATE_PREVIEW_PAGE_PAD, Oracle SIGN OFF 2026-08-08).
    # `extract_with_mappings` addresses pages by the mapping's own page_number
    # (`page_idx = mapping.get("page_number") or 0`) and SKIPS any mapping whose index falls
    # outside the list. This function is single-page BY CONTRACT — it receives the one page the
    # caller is showing — so passing `[page]` meant every mapping on page 2 or beyond was skipped
    # outright and the operator was told "Anchor not located / nothing read on this page" about a
    # perfectly good mapping. Both admin surfaces can already CREATE such mappings: the Settings
    # Template Manager saves `tplCurrentPage` and the Review wizard saves `currentPage`, and both
    # send the mapping's OWN page image, so the page they hand us is always the right one.
    # Padding with None (rather than rewriting page_number to 0) keeps the mapping verbatim, so
    # page_idx stays truthful in slice_capture/trace output and the landmark per-page buckets
    # still line up. extract_with_mappings already tolerates None entries.
    # DEFAULT ON, deliberately — this is the one deviation from the house default-OFF rule, and it
    # was granted rather than assumed: the OFF state here is a KNOWN-BROKEN state that returns {},
    # no live mapping is on page 2+ (all 38 are page 0), so a dark switch would never be exercised
    # and would rot. `TEMPLATE_PREVIEW_PAGE_PAD=0` restores the old one-element list.
    # Preview-only: resolve_geometry has exactly one caller, the admin CLI test_mapping.py.
    if os.environ.get('TEMPLATE_PREVIEW_PAGE_PAD', '1') != '0':
        _page_idx = int(mapping.get("page_number") or 0)
        _pages = [None] * _page_idx + [page]
    else:
        _pages = [page]
    # Pass the template's landmarks (when provided) so the resolved geometry tracks the
    # page through the SAME registration transform reprocess uses — the admin "preview
    # registration across docs" overlay then shows where each box ACTUALLY lands on a
    # shifted scan. None/empty -> no registration (the per-field anchor path), as before.
    res = extract_with_mappings(_pages, [mapping], field_patterns=field_patterns,
                                slice_capture=_cap, template_landmarks=template_landmarks,
                                registration_enabled=bool(template_landmarks))
    val = res.get(mapping.get("field_key")) or {}

    # Show the located LABEL box (not the drawn search region) so the operator sees
    # the anchor where it ACTUALLY landed — unless it was a merged-row match the
    # relocation would refuse anyway (then we have no trustworthy anchor position).
    anchor_resolved = None
    if located and not _located_too_wide(anchor_box, located):
        lb = located.get("label_box") or located
        anchor_resolved = [round(float(lb[k]), 5) for k in ("x_norm", "y_norm", "w_norm", "h_norm")]

    return {
        "value":      val.get("value"),
        "confidence": val.get("confidence"),
        "method":     val.get("method"),
        "anchor_box": anchor_resolved,
        # Prefer the WINNING rung's own read box (threaded out via target_geom) over
        # the last-captured crop — every rung captures kind="target", incl. a rung
        # whose value was later rejected, so captured['target'] could be a non-winning
        # box one row off the answer. Fall back to it only if no rung tagged its box.
        "target_box": val.get("target_geom") or captured.get("target"),
    }


def _fit_page_transform(page, landmarks, ocr_lines_fn, line_cache=None):
    """Locate each taught landmark on THIS page and fit a similarity transform
    mapping taught centroids -> located centroids. Returns a registration.Transform
    or None (too few/poor correspondences -> caller falls through). Reuses
    _locate_anchor — the SAME image_to_data the anchor path already runs — so the
    fit adds no OCR beyond locating the landmark words. `line_cache` shares the
    per-page OCR with the per-field locates (each landmark's page-wide fallback
    otherwise re-ran a full-page pass)."""
    src, dst = [], []
    for lm in landmarks:
        try:
            box = {"x_norm": float(lm["x_norm"]), "y_norm": float(lm["y_norm"]),
                   "w_norm": float(lm["w_norm"]), "h_norm": float(lm["h_norm"])}
        except (KeyError, TypeError, ValueError):
            continue
        text = lm.get("label_text")
        found = _locate_anchor(page, box, text, 0.0, ocr_lines_fn,
                               min_search=_ANCHOR_SEARCH_MIN, line_cache=line_cache)
        if not (found and found.get("matched_text") is not None):
            found = _locate_anchor(page, box, text, 1.0, ocr_lines_fn,
                                   min_search=_ANCHOR_SEARCH_MIN, line_cache=line_cache)
        if not (found and found.get("matched_text") is not None):
            continue
        src.append([box["x_norm"] + box["w_norm"] / 2.0,
                    box["y_norm"] + box["h_norm"] / 2.0])
        dst.append([found["x_norm"] + found["w_norm"] / 2.0,
                    found["y_norm"] + found["h_norm"] / 2.0])
    if len(src) < 2:
        return None
    _t = registration.fit_transform(src, dst, kind="similarity")
    # S-D VACUOUS-FIT GATE — the SHARED predicate (see registration.is_unfalsifiable). An
    # exactly-determined fit verifies nothing, so refuse it rather than let a rung consume a
    # transform built on coincidence; the caller then falls through exactly as a failed fit always
    # has. Placed HERE, inside the shared helper, rather than at each call site: the whole defect is
    # that this function had a guard at one of its two callers, so the guard belongs at the single
    # choke point no present or future caller can miss. OFF -> byte-identical.
    if registration.is_unfalsifiable(_t):
        return None
    return _t


# ── Per-mapping resolution ────────────────────────────────────────────────────

def _format_rejects(text, field_key, format_lookup):
    """True when a LEARNED format exists for this field and `text` doesn't match
    it — the universal, label-agnostic failsafe.

    Conservative by construction: only constrains a field once it HAS a learned
    format (build_format_class_index requires ≥3 confirmed values and drops
    free-text/varied groups), and only when a lookup was supplied. Otherwise
    returns False (pass through), so a brand-new template/field is never
    rejected until it has actually learned its shape — and as a new but genuine
    value shape recurs and is confirmed, the count-gated shape model adds it to
    the accepted set, so the system keeps working for ANY future document."""
    if not text or format_lookup is None:
        return False
    try:
        entry = format_lookup(field_key)
    except Exception:
        return False
    if not entry:
        return False
    return _check_learned_format(str(text), entry) is not None


def _salvage_date_value(text, val_type):
    """Rescue a real date embedded in noisy OCR (whitespace around separators, or a
    date sitting inside surrounding junk) — reusing validator.salvage_date, the
    SAME recovery Stage 4 already applies to keyword/anchor dates. Used only as a
    FALLBACK when the crop has already failed the strict date credibility gate, so
    Stage 0.5 normalises and keeps a salvageable "27 -05- 2026" instead of dropping
    the field (the observed worksheet "Date: Not found").

    Returns the normalised DD-MM-YYYY date, or None when nothing date-shaped is
    present. Lazy import mirrors the module's other cross-stage imports; no-op for
    non-date fields. Generalises to EVERY template's date field, not one layout.

    Limitation (intentional): salvage handles spacing / embedded-junk dates, NOT
    glyph misreads (e.g. a year OCR'd as "202G") — those still fall to review."""
    if not text or val_type != 'date':
        return None
    try:
        from extraction import validator
        d = validator.salvage_date(text)
    except Exception:
        return None
    return d.strftime("%d-%m-%Y") if d else None


def _date_clip_suspect(text):
    """Slice B: True when a crop's date read carries the right-clip signature (see the
    _DATE_CLIP_GATE_ON flag block). Pure text predicate on the RAW read; conservative —
    no numeric date / 4-digit year → False."""
    s = (text or '').rstrip()
    if not s:
        return False
    last = None
    for last in _DATE_CLIP_NUMERIC.finditer(s):
        pass
    if last is None:
        return False
    year = last.group(3)
    if len(year) == 3:
        return True                                   # '03-06-202' — never a real year
    if len(year) <= 2:
        nxt = s[last.end():last.end() + 1]
        if nxt and nxt in '/-.':                      # '07-01-20-' — separator glued to the cut
            return True                               # ('' guarded: '' in str is always True)
    return False


def _ft_regime(val_type):
    """Is this value in the FREE-TEXT regime for the drawn-box QUALITY guards (debris,
    name-quality)? See the _FT_GUARD_PARITY_ON flag block for why this exists.

    OFF it returns exactly `not val_type`, the legacy predicate, so every call site is
    byte-identical. ON it also admits the two free-text validation strings that six shipped keys
    carry ('text', 'multiline_text'), which is the same set `_mapping_result`'s confidence cap has
    always used — the two were simply never brought into line, and the disagreement is what left
    supplier_name / customer_name / buyer_name / the address fields unguarded at Stage 0.5.

    NOTE the deliberate asymmetry with `_gate_value`'s learned-SHAPE check: this is step-2
    TYPE/QUALITY qualification ("is this string even a plausible read"), which `_gate_value`'s own
    docstring calls ALWAYS enforced and which a manual anchor must pass to win. It is NOT the
    statistical shape check a taught box is exempt from. Widening it therefore spends none of the
    manual-authority invariant."""
    if not val_type:
        return True
    return _FT_GUARD_PARITY_ON and val_type in ('text', 'multiline_text')


def _ft_fallthrough_cap(result, val_type):
    """Hold a FREE-TEXT value that committed from a derived rung with no ocr_conf below the
    critical-field floor, and say so on the document. See _FT_FALLTHROUGH_CAP_ON.

    Applied by `_inline()` and `_read_registration` only — the two rungs that build a result
    without threading the read's mean confidence, so `_mapping_result`'s free-text cap cannot fire
    there. Without this, rejecting a garbled read at the absolute rung upgrades it from a capped ~50
    (visible in review) to a synthetic 90 (auto-filed) by re-reading the merged OCR line.
    No-op when the switch is off, when the value is typed, or when the value is already capped
    lower — it never RAISES a confidence and never replaces an existing note."""
    if not _FT_FALLTHROUGH_CAP_ON or not result:
        return result
    if val_type not in (None, 'text', 'multiline_text'):
        return result
    if result.get("confidence") is not None:
        result["confidence"] = min(result["confidence"], _FT_FALLTHROUGH_CAP)
    if not str(result.get("validation_note") or "").strip():
        result["validation_note"] = _FT_FALLTHROUGH_NOTE
    return result


def _gate_value(text, val_type, field_key, validation_patterns, format_lookup,
                shape_mode='drop', ocr_conf=None):
    """Shared accept/reject (+ date salvage) for a crop read, used by the
    absolute-target fast path, the anchor-derived path AND the drift fallback so
    all three apply IDENTICAL regex/type gating (the sequence was previously
    duplicated).

    Order:
      1. date-salvage FALLBACK (Fix C1) — when a date crop fails the strict date
         credibility gate, rescue/normalise it via validator.salvage_date;
      2. _crop_is_credible — the value must match the field's validation pattern
         (free-text only rejects obvious debris). ALWAYS enforced — this is the
         field's REGEX/TYPE qualification, the only thing a manual anchor must
         pass to win.
      3. _format_rejects — the LEARNED per-(supplier,doctype,field) SHAPE check.
         This is statistical history, NOT the field's type, so its severity is
         governed by `shape_mode` (a manual anchor is an explicit human override
         of that history and must not be vetoed by it):
           'ignore' — skip the learned-shape check entirely. Used for the
                      ABSOLUTE drawn-box read: the operator's own box on a
                      non-drifted page reads exactly what they validated, and it
                      cannot drift into a neighbouring column, so regex/type alone
                      is the correct (and OCR-safe) qualifier.
           'flag'   — apply the check but DON'T drop on mismatch; return
                      shape_warn=True so the caller keeps the value, caps its
                      confidence and forces review. Used for the DERIVED rungs
                      (registration / single-label relocation), where a type-valid
                      value can be a wrong-column bleed — surface it for review
                      instead of silently committing OR silently dropping it.
           'drop'   — legacy hard reject on mismatch (default; kept for safety).

    Returns (value, salvaged, shape_warn); (None, False, False) when REJECTED by
    regex/type (step 1-2) or by a 'drop'-mode learned-shape mismatch."""
    if not text:
        return None, False, False
    salvaged = False
    # Slice B date-clip gate — RAW text, BEFORE the salvage fallback (B-C2: salvage must
    # never resurrect a clipped fragment). See the _DATE_CLIP_GATE_ON flag block.
    if val_type == 'date' and _DATE_CLIP_GATE_ON and _date_clip_suspect(text):
        return None, False, False
    if val_type == 'date' and not _crop_is_credible(text, val_type, validation_patterns):
        rescued = _salvage_date_value(text, val_type)
        if rescued:
            text, salvaged = rescued, True
    if not _crop_is_credible(text, val_type, validation_patterns):
        return None, False, False
    # A reference-role field's value is a CODE — a taught box that read its own caption ('Ref',
    # 'Account', 'Delivery') carries no digit and is refused here rather than committed. See the
    # _STAGE05_REF_CODE_GATE flag block; the predicate is keyword's, shared with the Stage-1 gate.
    if _STAGE05_REF_CODE_GATE and val_type == 'alphanumeric':
        from extraction import keyword as _kw
        if (_kw._infer_validation(field_key) == 'alphanumeric'
                and _kw.ref_value_is_codeless(text)):
            return None, False, False
    # Free-text OCR-debris guard: a mis-aligned or low-quality crop on a name/
    # address field returns fragmented junk ("aan EE ..... 4 4.3 Fs . J... .")
    # that scrapes past the lax free-text credibility check and commits. Reject it
    # so the caller falls through to registration/relocation (or omits the field)
    # rather than persisting garbage. Typed fields have their own strict pattern,
    # so this only applies to free-text (val_type falsy).
    if _ft_regime(val_type) and _is_ocr_debris(text):
        return None, False, False
    # Name-quality gate (Part 3 mirror): a NAME/company/address mapping that read a
    # garbled MULTI-WORD value is OCR junk, not a real name — reject so a credible
    # keyword/hint can fill it instead of persisting garbage. Single-token brands
    # ("3M") aren't judged. Same rule as anchor.py. See extraction/value_quality.py.
    if _ft_regime(val_type) and field_key and len(str(text).split()) >= 2:
        from extraction.value_quality import is_name_like_field, name_quality
        if is_name_like_field(field_key) and name_quality(text) < 0.5:
            return None, False, False
    # Free-text OCR-CONFIDENCE floor (Stage C — parity with Stage 2's _strict_credible):
    # a drawn-box read whose mean confidence is below _FREE_TEXT_RESCUE_CONF is a
    # clipped/drifted crop whose garbage clears the loose free-text credibility (there's
    # no regex to catch it). Reject so the caller defers to the drift-correcting rungs
    # (single-label relocation / registration), exactly as Stage 2 routes a low-conf
    # rigid read to its inline harvest — and so a low-conf Stage 0.5 read can't WIN the
    # engine merge over the correct value. ocr_conf is threaded ONLY from the ABSOLUTE
    # drawn-box read (the rigid fast path); the derived/inline/registration rungs pass
    # None -> no floor on the rescue itself, so a clean read and every other rung stay
    # byte-identical. Free-text only (structured trusts its regex).
    if not val_type and ocr_conf is not None and ocr_conf < _FREE_TEXT_RESCUE_CONF:
        return None, False, False
    shape_warn = False
    # A field whose FORMAT is fully defined by its own precise validator/normaliser
    # (date, currency, MAC, IP — already qualified by _crop_is_credible above) must NOT
    # ALSO be vetoed/flagged by the learned-SHAPE statistics: those values vary
    # legitimately (every device a different IP, every doc a different date/amount), so a
    # "differs from the usual format" flag on a type-valid value is a false positive. CODE
    # types (alphanumeric/reference/job_reference) keep the shape check — that's where a
    # wrong-column bleed of the right shape actually happens.
    if (shape_mode != 'ignore' and val_type not in _SELF_VALIDATING_TYPES
            and _format_rejects(text, field_key, format_lookup)):
        if shape_mode == 'flag':
            shape_warn = True
        else:
            return None, False, False
    return text, salvaged, shape_warn


def _mapping_result(value, full_confidence, expanded, salvaged, anchor, shape_warn=False,
                    ocr_conf=None, val_type=None, geom=None):
    """Build a Stage 0.5 result dict with the shared confidence tiers used by the
    absolute fast path and the anchor-derived path. `full_confidence` selects the
    90 (anchor located / anchor_text present) vs 78 (no label) base; `expanded`
    discounts a widened-retry read; `salvaged` (a date rescued from junk) caps
    confidence so it can't outrank a clean Stage 1/2 read, and tags the method.
    `shape_warn` (a type-valid DERIVED-rung read that differs from the learned
    shape) caps confidence, tags the method `_shapewarn` and attaches a review
    note — the value is kept (manual authority) but surfaced for verification.
    `ocr_conf` (the read's mean word confidence, when the ladder captured it) caps a
    FREE-TEXT value's confidence at ocr_conf+5 — mirroring anchor.py — so a garbled crop
    ("504 Ald Unkesand Band 20|0U0U…") scores by its real read quality (~70 -> review)
    instead of the synthetic 90. SCOPED to free-text: a structured value already validated
    by its regex/type is NOT capped (Tesseract under-reads dashed refs)."""
    confidence = 90 if full_confidence else 78
    if expanded:
        confidence -= 12
    method = "template_mapping_expanded" if expanded else "template_mapping"
    if salvaged:
        confidence = min(confidence, 70)
        method += "_salvaged"
    # Free-text confidence shaping from the real OCR mean (anchor.py parity): a garbled
    # read can no longer commit at a synthetic 90; structured (regex-validated) fields
    # are exempt because Tesseract under-reads their dashed/spaced digit groups.
    if ocr_conf is not None and val_type in (None, "text", "multiline_text"):
        confidence = min(confidence, int(ocr_conf) + 5)
    result = {
        "value":      value,
        "confidence": max(50, min(96, confidence)),
        "method":     method,
        "anchor":     anchor,
    }
    if shape_warn:
        result["confidence"] = min(result["confidence"], 70)
        result["method"] += "_shapewarn"
        result["validation_note"] = _SHAPE_WARN_NOTE
    # Diagnostic only: carry the box this rung actually READ so resolve_geometry can
    # show the WINNING rung's box (not the last-captured, maybe-rejected, crop). Set
    # ONLY in diagnostic/preview mode (callers pass geom only when slice_capture is
    # active), so a normal extraction result dict is byte-identical (no extra key).
    if geom is not None:
        result["target_geom"] = geom
    return result


def _is_ocr_debris(text):
    """True when a FREE-TEXT read is fragmented OCR junk rather than a real
    name/address. Signals: the OCR replacement char (failed glyphs), or — for a
    multi-token read — most tokens being single chars or mostly-punctuation
    ("aan EE ..... 4 4.3 Fs . J... ."). Conservative: short reads (<4 tokens) are
    never judged, so normal short values pass; a token counts as junk only if it
    is ≤1 char or less than half alphanumeric."""
    if not text:
        return False
    if '�' in text:
        return True
    toks = text.split()
    if len(toks) < 4:
        return False
    def _junk(t):
        return len(t) <= 1 or (sum(c.isalnum() for c in t) / len(t)) < 0.5
    return sum(1 for t in toks if _junk(t)) >= len(toks) * 0.5


def _located_too_wide(anchor_box, located):
    """True when a located 'label' spans far more than the operator's drawn anchor
    box — i.e. it is a whole OCR'd ROW, not a tight caption. Cross-column form
    layouts merge "Ticket No. … Work Address …" into one OCR line, so a page-wide
    label search matches the entire row with a left-anchored box; relocating the
    value off that left edge lands in the wrong column (garbage). Refuse to relocate
    off such a match. Threshold scales with the drawn box (≥2.5× its width) but
    never below an absolute 0.30 of page width (no single field label is that wide)."""
    if not located:
        return False
    w = located.get("w_norm") or 0.0
    return w > max(0.30, (anchor_box.get("w_norm") or 0.0) * 2.5)


def _label_drifted(anchor_box, located):
    """True when the located anchor LABEL has moved off its taught position beyond
    a per-axis tolerance — the signal that the page has DRIFTED (e.g. a cropped vs
    uncropped scan shifts every row down), so the STATIONARY drawn target box now
    covers a neighbouring line and must not be trusted. Compares box CENTRES (the
    label sits roughly centred in the drawn anchor box, so on a non-drifted page
    the located centre ≈ the drawn-box centre regardless of the label's inset);
    tolerance is half the drawn box's own size per axis (its natural "still on this
    row/column?" band), floored by _DRIFT_FLOOR, so it auto-scales with no
    per-document tuning. The VERTICAL band ALSO takes half the LOCATED line height
    into account: a label-ABOVE mapping draws a SHORT anchor box, so against the
    fixed floor alone a tall-font / low-res scan's within-line jitter could exceed it
    and false-flag a row move (then a needless relocation). Tying tol_y to the line
    actually read here means "drifted" stays "moved roughly a row" regardless of
    font size, while a true one-line shift (≥ a line height) still trips it. (Inline
    key/value rows don't depend on this — the harvest fires on inline_value directly.)
    Conservative: requires a GENUINE label match — a proximity-only locate
    (matched_text None) never counts as drift, so a blank / unfound label keeps
    today's absolute-first behaviour."""
    if not located or located.get("matched_text") is None:
        return False
    def _cx(b): return (b.get("x_norm") or 0.0) + (b.get("w_norm") or 0.0) / 2.0
    def _cy(b): return (b.get("y_norm") or 0.0) + (b.get("h_norm") or 0.0) / 2.0
    tol_x = max((anchor_box.get("w_norm") or 0.0) / 2.0, _DRIFT_FLOOR)
    tol_y = max((anchor_box.get("h_norm") or 0.0) / 2.0,
                (located.get("h_norm") or 0.0) / 2.0, _DRIFT_FLOOR)
    return abs(_cx(located) - _cx(anchor_box)) > tol_x \
        or abs(_cy(located) - _cy(anchor_box)) > tol_y


def _code_norm(s):
    """Alphanumeric-only lower fold for CODE containment tests, so a separator jitter
    (DN-93159 vs DN 93159) can't defeat the substring check."""
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def _target_inline_with_anchor(anchor_box, target_box):
    """True when the taught value sits on the label's ROW (an inline key/value row), not a
    line below it. Compares box CENTRES vertically against ~one row height; a label-ABOVE
    layout (target a line under the anchor) is excluded so the inline reconcile only fires
    where an inline harvest is even meaningful (the geometric/relocate path owns label-above).

    ARMED (_INLINE_ROW_OVERLAP_ON): the tolerance is the GEOMETRIC definition of "same row" —
    the mean of the two box heights. OFF: the legacy expression, which floored the tolerance at
    _DRIFT_FLOOR (a *drift* constant, ~1.5-3 line pitches) and so admitted label-ABOVE mappings
    the docstring above claims it excludes — see the flag block for the live exhibit."""
    def _cy(b): return (b.get("y_norm") or 0.0) + (b.get("h_norm") or 0.0) / 2.0
    if _INLINE_ROW_OVERLAP_ON:
        tol = ((anchor_box.get("h_norm") or 0.0) + (target_box.get("h_norm") or 0.0)) / 2.0
    else:
        tol = max(anchor_box.get("h_norm") or 0.0, target_box.get("h_norm") or 0.0, _DRIFT_FLOOR)
    return abs(_cy(anchor_box) - _cy(target_box)) <= tol


def _read_inline_box(page, located, val_type, ocr_text_fn, field_key,
                     validation_patterns, format_lookup, slice_capture, page_idx):
    """Full-res OCR-ladder re-read of the located label's INLINE value column (Seam B — the
    value's own box, isolated by cluster_value_words; never the ~120-DPI locate text, which is
    only a fallback when the re-read yields nothing). One-token code trim + the shared gate.
    Returns (value, ocr_conf, from_ladder). `from_ladder` is the S1 PROVENANCE bit (Oracle
    NIGHT 2026-08-03): True only when the value came from the full-res ladder re-read — a
    fallback to the locate-pass text sets it False, and the C2a clean-commit's leg (iii)
    (locate-token corroboration) DISQUALIFIES such a value, else it would compare the locate
    text with itself (a manufactured witness)."""
    inline_box = located.get("inline_box")
    inline_val = None
    inline_conf = None
    from_ladder = False
    if inline_box:
        _pad = _expand_box(inline_box, 0.005)                 # guard against clipping edge glyphs
        _icap = ((lambda c: slice_capture(field_key, "template_mapping", page_idx,
                   (_pad["x_norm"], _pad["y_norm"], _pad["w_norm"], _pad["h_norm"]),
                   c, "target")) if slice_capture else None)
        _imeta = {}
        inline_val = _crop_and_ocr(page, _pad, val_type, ocr_text_fn, capture=_icap, meta=_imeta)
        inline_conf = _imeta.get('conf')
        from_ladder = bool(inline_val)
    if not inline_val:                                        # fallback: the locate-pass text
        inline_val = _clean_value(located.get("inline_value"), val_type)
    if inline_val and " " in inline_val:                      # a code column is one token
        inline_val = inline_val.split()[0]
    inline_val, _, _ = _gate_value(inline_val, val_type, field_key, validation_patterns,
                                   format_lookup, shape_mode='ignore')
    return inline_val, inline_conf, from_ladder


def _pick_fuller_code(rigid_text, rigid_conf, inline_val, inline_conf, anchor, val_type, inline_geom,
                      field_key=None, format_lookup=None, provisional_lookup=None,
                      locate_token=None, inline_from_ladder=False):
    """Reconcile a clip-prone rigid CODE read against a label-anchored inline read; return the
    Stage 0.5 result to COMMIT, or None to keep the rigid read. The single decision shared by
    Slice 1 (rigid = the absolute drawn box) and Slice 2 (rigid = the drift-relocated geometric
    crop):
      • agree with IDENTICAL surfaces / rigid fuller (inline is a suffix of rigid) → keep rigid (None);
      • agree on the CORE but rigid carries EDGE debris the inline lacks (Slice A, gated
        _CODE_EDGE_CLEAN_ON): heal iff strip_edges(rigid) == inline VERBATIM and the learned shape
        does not reject the cleaned value → commit CLEAN (no shapewarn — the shape check judged the
        cleaned surface). Witness-equality is the whole safety: the committed string is
        simultaneously "rigid minus edge debris" and "the token an independent-geometry read
        produced". Interior disagreements (DN 60902 / em-dash) fail verbatim equality → review path;
      • rigid is a SUFFIX of inline → the drawn box clipped the LEFT (prefix); the glyph overlap
        corroborates the same token un-clipped (a right-side over-read is a PREFIX, not a suffix,
        and is deliberately NOT clean-committed) → un-clip, commit CLEAN;
      • genuine disagreement (floated/garbled box, or an inline over-read) → prefer the higher-
        OCR-confidence read; when inline wins, FAIL TOWARD REVIEW (capped + flagged), never a
        clean auto-file. No confidence signal (a test stub) → default to inline, still flagged."""
    if not inline_val:
        return None
    na, ni = _code_norm(rigid_text), _code_norm(inline_val)
    if not na or not ni or na == ni:
        # Slice A (Oracle A-C3): heal only when the strip actually removed something, the stripped
        # string is non-empty, it equals the inline surface VERBATIM, and the learned shape
        # consents. Anything else falls through to None = today's behaviour byte-identical.
        if _CODE_EDGE_CLEAN_ON and na and na == ni:
            stripped = _strip_code_edges(rigid_text)
            if (stripped and stripped != rigid_text and stripped == (inline_val or '').strip()
                    and not _format_rejects(stripped, field_key, format_lookup)):
                healed = _mapping_result(stripped, True, False, False, anchor,
                                         val_type=val_type, geom=inline_geom)
                healed["_heal"] = "edge_clean"   # census marker — engine logs + pops it
                if inline_geom is not None:      # diag/preview mode only (A-C6): trace marker,
                    healed["edge_cleaned_from"] = rigid_text   # normal result dict byte-identical
                return healed
        return None
    # ⚠ BRANCH ORDER IS LOAD-BEARING (Oracle S5, pinned): un-clip → fragment-strip (inside
    # rigid-fuller) → C2a → conf race. Reordering silently restores either the α-variant
    # (dirty fragment+full-core committing clean @90) or the false-note class.
    if ni.endswith(na):
        _unclipped = _mapping_result(inline_val, True, False, False, anchor,
                                     val_type=val_type, geom=inline_geom)
        _unclipped["_heal"] = "unclip"           # census marker — engine logs + pops it
        return _unclipped
    if na.endswith(ni):
        # Slice A2/C1 composite (gated): ALNUM label-tail fragment. Fragment must be a
        # case-insensitive suffix of the mapping's own anchor label tail; the remainder must
        # equal the inline witness VERBATIM; consent ladder: a confirmed entry's verdict is
        # FINAL (accept→heal / reject→refuse), else a provisional taught skeleton accepts,
        # else only a 1-LETTER fragment heals (reggie's floor — 2-letter fragments collide
        # with genuine PO/SO/DN prefixes and need shape evidence).
        if _CODE_FRAG_CLEAN_ON and field_key is not None:
            _r = (rigid_text or '').strip()
            _iv = (inline_val or '').strip()
            _m = _CODE_FRAG_TAIL.match(_r)
            if _m:
                _frag = ''.join(c for c in _m.group(0) if c.isalnum()).lower()
                _tail = _anchor_alnum_tail(anchor)
                if _frag and _tail and _tail.endswith(_frag):
                    _stripped = _r[_m.end():]
                    if _stripped and _stripped == _iv:
                        _consent = _shape_consents(_stripped, field_key, format_lookup,
                                                   provisional_lookup)
                        if _consent in ('confirmed', 'provisional') \
                                or (_consent == 'none' and len(_frag) == 1):
                            healed = _mapping_result(_stripped, True, False, False, anchor,
                                                     val_type=val_type, geom=inline_geom)
                            healed["_heal"] = "frag_clean"       # census marker
                            if inline_geom is not None:          # diag-only trace marker
                                healed["frag_cleaned_from"] = rigid_text
                            return healed
        return None
    # C2a — right-clip clean commit (gated): the rigid read corroborates a STRICT PREFIX of
    # the inline core (interior digit mismatches fail startswith — D1's class untouched); the
    # consent ladder corroborates the SKELETON (the un-witnessed tail's length); the ~120-DPI
    # locate-pass token corroborates the GLYPHS — and leg (iii) requires the inline value to
    # be a genuine full-res LADDER read (Oracle S1: a locate-fallback inline would compare the
    # locate text with itself). Any leg fails → today's flagged path below, byte-identical.
    _clip_decline = None
    if _CLIP_COMMIT_ON and field_key is not None:
        _r2 = _strip_code_edges((rigid_text or '').strip())
        _m2 = _CODE_FRAG_TAIL.match(_r2)
        if _m2:
            _f2 = ''.join(c for c in _m2.group(0) if c.isalnum()).lower()
            _t2 = _anchor_alnum_tail(anchor)
            if _f2 and _t2 and _t2.endswith(_f2):
                _r2 = _r2[_m2.end():]
        _core2 = _code_norm(_r2)
        # Evaluate legs INDIVIDUALLY so a decline is diagnosable from the SFDEV trace
        # (2026-08-04 morning: a live decline was invisible — the every-step-trace rule).
        # Leg (i): the rigid core strictly prefixes the fuller inline (a clean right-clip) OR — with the
        # edge-slack armed — a LENGTH-PRESERVING trailing-glyph misread (the clip garbled only the last,
        # untrusted glyph; the trusted body prefixes the inline). The slack demands a confidence MARGIN
        # (the rigid dissents on that glyph; a genuine clip reads low → big gap; None-conf declines) and
        # floors on the SHARED (len-1) prefix; legs (ii)-(v) still fully gate. Mirrors _frag_matches.
        _exact = ni.startswith(_core2) and ni != _core2
        _slack = (_CLIP_COMMIT_EDGE_SLACK_ON
                  and len(ni) == len(_core2) and len(ni) - 1 >= _CLIP_COMMIT_MIN_PREFIX
                  and ni[:-1] == _core2[:-1] and ni[-1:] != _core2[-1:]
                  and rigid_conf is not None and inline_conf is not None
                  and inline_conf >= rigid_conf + _CLIP_COMMIT_EDGE_SLACK_MARGIN)
        if not (_exact or _slack):
            _clip_decline = 'not_a_strict_prefix'
        elif _exact and len(_core2) < _CLIP_COMMIT_MIN_PREFIX:
            _clip_decline = 'prefix_too_short'
        elif not inline_from_ladder:
            _clip_decline = 'inline_not_from_ladder'
        elif _code_norm(locate_token) != ni:
            _clip_decline = 'locate_token_disagrees:%r' % (locate_token,)
        else:
            _consent = _shape_consents(inline_val, field_key, format_lookup, provisional_lookup)
            if _consent not in ('confirmed', 'provisional'):
                _clip_decline = 'shape_consent:%s' % _consent
        if _clip_decline is None:
            committed = _mapping_result(inline_val, True, False, False, anchor,
                                        val_type=val_type, geom=inline_geom)
            committed["_heal"] = "clip_commit"                   # census marker
            if inline_geom is not None:                          # diag-only trace marker
                committed["clip_committed_from"] = rigid_text
            return committed
    if rigid_conf is not None and inline_conf is not None and inline_conf <= rigid_conf:
        return None
    flagged = _mapping_result(inline_val, True, False, False, anchor, shape_warn=True,
                              val_type=val_type, geom=inline_geom)
    flagged["_heal"] = "inline_disagree_flag"                    # census marker
    if inline_geom is not None and _clip_decline:                # diag-only decline reason
        flagged["clip_decline"] = _clip_decline
    return flagged


def _inline_code_reconcile(page, rigid_text, anchor_box, target_box, val_type, field_key,
                           anchor_text, ocr_lines_fn, ocr_text_fn, validation_patterns,
                           format_lookup, line_cache, slice_capture, page_idx,
                           abs_ocr_conf=None, provisional_lookup=None, meta=None):
    """Cross-check a single-token CODE field's absolute drawn-box read (`rigid_text`) against
    the label-anchored INLINE read, and prefer the fuller value when the box read is a clipped
    subset of it (a fixed narrow box drifts off the value's prefix under per-scan offset/scale:
    DN-93159 → N-93159) or disagrees entirely (the box floated off-row into whitespace:
    DN-78756 → HAL7ea7ca). Makes a taught mapping robust the way Review's Stage-2 anchor is —
    WITHOUT reusing anchor.py: it reads operator-taught geometry via THIS stage's own machinery,
    so it stays an INDEPENDENT validator.

    Returns a Stage 0.5 result dict to COMMIT, or None to keep the rigid read (they agree, the
    rigid read is the fuller one, the label isn't found, the value isn't inline, or the inline
    read is unusable → byte-identical to today for those cases).

    Oracle conditions honoured:
      • the inline read is sourced from a PAGE-WIDE locate (expansion=1.0, line_cache-shared) —
        the pre-pass LOCAL locate can clip a wide value the same way the box does (Seam A);
      • the committed value is a FULL-RES ladder re-read of the inline VALUE box, never the
        ~120-DPI PSM-6 locate text (Seam B) — the locate text is only a last-ditch fallback;
      • total disagreement FAILS TOWARD REVIEW (capped + flagged), not a clean auto-file (Q3);
      • scoped to CODE val_types so the free-text box-first seam (:742-750) is untouched."""
    # Value must be taught inline with the label, else the geometric/relocate path owns it.
    if not _target_inline_with_anchor(anchor_box, target_box):
        return None
    # Seam A: a FULL-COVERAGE page-wide locate (line_cache-shared — usually already run by the
    # drift guard / landmark fit, so no extra OCR). The pre-pass local locate can itself clip a
    # value wider than label_box + the local search margin. No _located_too_wide guard: the inline
    # path uses inline_box (the value's OWN column, isolated by cluster_value_words from any merged
    # title/column on the line), so a wide matched line is expected and harmless.
    located = _locate_anchor(page, anchor_box, anchor_text, 1.0, ocr_lines_fn,
                             min_search=_ANCHOR_SEARCH_MIN, line_cache=line_cache)
    if not located or located.get("matched_text") is None:
        return None
    inline_val, inline_conf, inline_from_ladder = _read_inline_box(
        page, located, val_type, ocr_text_fn, field_key,
        validation_patterns, format_lookup, slice_capture, page_idx)
    # C1 WITNESS FLAG (pad-window labelled sub-slice): record that this reconcile actually FORMED an
    # opinion — the label was located AND the independent inline read produced a value. Only then is a
    # None return a genuine ARBITRATION (_pick_fuller_code kept the rigid read on purpose) rather than
    # "never got a witness". The pad backstop must not overturn, or flag against, an arbitration.
    # Purely additive: callers passing no `meta` are byte-identical.
    if meta is not None and inline_val:
        meta["witness"] = True
    inline_geom = (_box_list(located.get("inline_box"))
                   if (slice_capture and located.get("inline_box")) else None)
    return _pick_fuller_code(rigid_text, abs_ocr_conf, inline_val, inline_conf,
                             anchor_text or field_key, val_type, inline_geom,
                             field_key=field_key, format_lookup=format_lookup,
                             provisional_lookup=provisional_lookup,
                             locate_token=located.get("inline_value"),
                             inline_from_ladder=inline_from_ladder)


def _relocate_and_read(page, mapping, anchor_box, target_box, located, val_type,
                       ocr_text_fn, expansion, validation_patterns, format_lookup,
                       slice_capture, page_idx, field_key, ocr_lines_fn=None, line_cache=None,
                       provisional_lookup=None):
    """Derive the value crop from where the anchor label ACTUALLY landed
    (located + drift-invariant stored offset, inset-corrected) and read it. Shared
    by the early drift branch and the late single-label fallback in _extract_one.
    Returns a Stage 0.5 result dict, or None if the relocated crop fails the gate.

    Two paths, in order (parity with Stage 2 anchor.py):
      1. INLINE HARVEST — in a key/value row the value shares the located label's OCR
         line ("label …gap… value") and sits in a far column a geometric crop can't
         reach, so read it STRAIGHT off the line (`located['inline_value']`), held to
         the SAME gate as a crop read. THIS is what makes "Ticket No.  2605-0769-1"
         read the ref, not the row above — and it was entirely missing from Stage 0.5.
      2. GEOMETRIC DERIVATION — value not on the label's line (label-above layouts):
         seat a crop at located-label-origin + stored offset. Uses the TIGHT label box
         (`located['label_box']`), NOT the whole OCR line (which overshoots a "label
         …gap… value" row — the root of the relocation silently deriving the wrong row).

    The stored offset is BOX-origin → BOX-origin (saveMapping records target − anchor
    from the drawn box corners); the inset re-derives the located label's box-origin
    (label ≈ centred in the drawn anchor box) so the offset applies origin-to-origin
    (else leading glyphs clip, "PROFILE"→"ROFILE"). Returns a result dict or None."""
    dx = mapping.get("offset_dx_norm") or 0.0
    dy = mapping.get("offset_dy_norm") or 0.0

    def _geometric():
        # GEOMETRIC DERIVATION (RIGID OFFSET): seat the value box at the LOCATED label's
        # origin + the stored label→value offset, with the operator's DRAWN dimensions —
        # "20px across, 2px down" STAYS 20px across, 2px down. This is what the operator
        # drew; the value moves rigidly WITH the label, it does not slide with OCR
        # line-segmentation. Off the tight LABEL box (falls back to the whole line only
        # when no label_box, and only then does _located_too_wide guard it).
        lb = located.get("label_box") or located
        # Refuse to seat the value off a label that spans the row — a merged two-column
        # OCR line whose tighten failed, or a label-less proximity locate. The width
        # guard now applies to a PRESENT-but-over-wide label_box too, not only the
        # label-less fallback: an over-wide non-None box used to bypass it and derive
        # the value crop off a false (far-left) origin.
        if _located_too_wide(anchor_box, lb):
            return None
        inset_x = max(0.0, (anchor_box["w_norm"] - (lb.get("w_norm") or 0.0)) / 2.0)
        inset_y = max(0.0, (anchor_box["h_norm"] - (lb.get("h_norm") or 0.0)) / 2.0)
        derived_target = {
            "x_norm": _clamp01(lb["x_norm"] - inset_x + dx),
            "y_norm": _clamp01(lb["y_norm"] - inset_y + dy),
            "w_norm": target_box["w_norm"],
            "h_norm": target_box["h_norm"],
        }
        # Slice B: snap the seated box to the word geometry underneath (B-C1: the cut frame is
        # the LOCATED label_box — same frame as the seat; None on a label-less locate → no cut,
        # majority-inside still applies). OFF/out-of-scope → returns the box unchanged.
        derived_target = _snap_box_to_words(page, derived_target, val_type, ocr_lines_fn,
                                            line_cache, label_box=located.get("label_box"))
        _cap = ((lambda c: slice_capture(field_key, "template_mapping", page_idx,
                   (derived_target["x_norm"], derived_target["y_norm"],
                    derived_target["w_norm"], derived_target["h_norm"]), c, "target")) if slice_capture else None)
        _d_meta = {}
        text = _crop_and_ocr(page, derived_target, val_type, ocr_text_fn, capture=_cap, meta=_d_meta)
        expanded = False
        if not text and expansion > 0:
            text = _crop_and_ocr(page, _expand_box(derived_target, expansion), val_type, ocr_text_fn, meta=_d_meta)
            expanded = bool(text)
        # DERIVED rung (label-relocated crop): regex/type is a hard gate; a learned-
        # shape mismatch flags-and-keeps rather than drops (the rung where column-bleed
        # actually happens).
        text, salvaged, shapewarn = _gate_value(
            text, val_type, field_key, validation_patterns, format_lookup, shape_mode='flag')
        if not text:
            return None
        # SLICE 2 — drift-path clip guard: the geometric read re-seats the value at the SAME narrow
        # drawn WIDTH, so a drifted taught CODE label carries the identical prefix-clip risk as the
        # fast path (Slice 1). Reuse Slice 1's reconcile WHOLESALE with the geometric read as the
        # rigid input — its OWN page-wide locate (the drift-branch `located` handed in can be a
        # clipped LOCAL locate — Oracle Seam A), its `_target_inline_with_anchor` guard, and the
        # full-res Seam-B re-read. Default ON since the forced-drift gate (see :104-109) — kill with
        # TEMPLATE_INLINE_CODE_RECONCILE_DRIFT=0 → skipped, byte-identical. (Stale "DARK by default"
        # wording here cost a diagnosis hour on 2026-08-03 — Oracle A-C4; the :939 twin was corrected
        # the same day.) (ocr_lines_fn absent on a legacy direct call → skip safely.)
        if (_INLINE_CODE_RECONCILE_DRIFT_ON and val_type in _CODE_CROSSCHECK_TYPES
                and ocr_lines_fn is not None):
            picked = _inline_code_reconcile(page, text, anchor_box, target_box, val_type, field_key,
                                            mapping.get("anchor_text"), ocr_lines_fn, ocr_text_fn,
                                            validation_patterns, format_lookup, line_cache,
                                            slice_capture, page_idx, abs_ocr_conf=_d_meta.get('conf'),
                                            provisional_lookup=provisional_lookup)
            if picked is not None:
                return picked
        return _mapping_result(
            text,
            located.get("matched_text") is not None and bool(mapping.get("anchor_text")),
            expanded, salvaged, mapping.get("anchor_text") or field_key,
            shape_warn=shapewarn, ocr_conf=_d_meta.get('conf'), val_type=val_type,
            geom=_box_list(derived_target) if slice_capture else None)

    def _inline():
        # INLINE HARVEST off the located label's OWN line (no extra OCR — the line was
        # already read during the locate). Reads the value words that follow the label on
        # the SAME line. Robust to a value in a FAR column the drawn box width can't reach,
        # but it 'slides' with OCR line-segmentation — so it is the FALLBACK to the rigid
        # geometric read above (and the PRIMARY read only for a legacy offset-less mapping).
        #
        # DOOR C (TEMPLATE_INLINE_ROW_OVERLAP): this rung has no switch and, until now, no layout
        # guard — it would commit a same-row harvest even for a mapping the operator taught
        # label-ABOVE, i.e. read a row the taught model says is the wrong one. Guarded ONLY where a
        # stored offset exists: with dx/dy there is a real geometric model to fall back on
        # (registration -> omit -> review), whereas a LEGACY offset-less mapping reaches _inline()
        # as its PRIMARY read at the tail of this function and has nothing behind it — guarding it
        # there would delete the read outright. That asymmetry is deliberate and PINNED.
        if _INLINE_ROW_OVERLAP_ON and (dx or dy) and \
                not _target_inline_with_anchor(anchor_box, target_box):
            return None
        iv = located.get("inline_value")
        if not iv:
            return None
        hv = _clean_value(iv, val_type)
        if hv and val_type in _CODE_CROSSCHECK_TYPES and " " in hv:
            hv = hv.split()[0]          # a code column is one token; drop trailing captions
        hv, iv_salvaged, iv_shapewarn = _gate_value(
            hv, val_type, field_key, validation_patterns, format_lookup, shape_mode='flag')
        if not hv:
            return None
        ib = located.get("inline_box")
        if slice_capture and ib:
            try:
                pw, ph = page.size
                _icrop = page.crop((int(ib["x_norm"] * pw), int(ib["y_norm"] * ph),
                                    int((ib["x_norm"] + ib["w_norm"]) * pw),
                                    int((ib["y_norm"] + ib["h_norm"]) * ph)))
                slice_capture(field_key, "template_mapping", page_idx,
                              (ib["x_norm"], ib["y_norm"], ib["w_norm"], ib["h_norm"]),
                              _icrop, "target")
            except Exception:
                pass                # dev-only; never disrupt extraction
        # _ft_fallthrough_cap: this rung has NO ocr_conf to give _mapping_result, so a free-text
        # value would otherwise commit at the synthetic 90 (see _FT_FALLTHROUGH_CAP_ON).
        return _ft_fallthrough_cap(_mapping_result(
            hv, located.get("matched_text") is not None and bool(mapping.get("anchor_text")),
            False, iv_salvaged, mapping.get("anchor_text") or field_key,
            shape_warn=iv_shapewarn, val_type=val_type,
            geom=_box_list(ib) if (slice_capture and ib) else None), val_type)

    # RIGID OFFSET PRIMARY (the operator's model): when the mapping stored a label→value
    # offset, the value box follows the located label by that EXACT offset + drawn
    # dimensions — geometric read FIRST; the line harvest is only the fallback when the
    # rigid read fails its gate (a far column / an imperfect offset). A LEGACY mapping
    # with NO stored offset has no rigid link, so the line harvest stays its primary read.
    if dx or dy:
        return _geometric() or _inline()
    return _inline() or _geometric()


def _read_registration(page, mapping, target_box, val_type, ocr_text_fn, expansion,
                       page_transform, validation_patterns, format_lookup,
                       slice_capture, page_idx, field_key,
                       ocr_lines_fn=None, line_cache=None):
    """"Register, then read": map the taught target box THROUGH the fitted page
    transform and read there, so the value follows the page's actual geometry
    (translation+scale+rotation), not a single-label guess. Returns a Stage 0.5
    result dict (method template_registration[_expanded][_salvaged][_shapewarn]) or
    None when the transform-mapped crop fails the gate. Shared by the registration
    ARBITER (drift detected via box_divergence before the absolute read commits)
    and the FALLBACK rung (reached when the absolute read found nothing credible).
    Confidence reflects the fit quality. DERIVED rung → shape_mode='flag' (a learned
    -shape mismatch is kept+capped+noted for review, not dropped or silently kept)."""
    reg_box = page_transform.apply_box(target_box)
    # Slice B: snap the transformed box to the word geometry underneath. B-C1 frame trap: the
    # label cut must live in the SAME (transformed) frame as reg_box — apply_box(anchor) here,
    # NEVER the taught anchor box against a transformed target.
    _reg_anchor = _norm_box(mapping, "anchor")
    _reg_label = page_transform.apply_box(_reg_anchor) if _reg_anchor else None
    reg_box = _snap_box_to_words(page, reg_box, val_type, ocr_lines_fn,
                                 line_cache, label_box=_reg_label)
    _rcap = ((lambda c: slice_capture(field_key, "template_registration", page_idx,
               (reg_box["x_norm"], reg_box["y_norm"], reg_box["w_norm"], reg_box["h_norm"]),
               c, "target")) if slice_capture else None)
    rtext = _crop_and_ocr(page, reg_box, val_type, ocr_text_fn, capture=_rcap)
    r_expanded = False
    if not rtext and expansion > 0:
        rtext = _crop_and_ocr(page, _expand_box(reg_box, expansion), val_type, ocr_text_fn)
        r_expanded = bool(rtext)
    rtext, r_salvaged, r_shapewarn = _gate_value(
        rtext, val_type, field_key, validation_patterns, format_lookup, shape_mode='flag')
    if not rtext:
        return None
    conf = registration.registration_confidence(page_transform)
    if r_expanded:
        conf -= 12
    method = "template_registration_expanded" if r_expanded else "template_registration"
    if r_salvaged:
        conf = min(conf, 70)
        method += "_salvaged"
    result = {
        "value":      rtext,
        "confidence": max(50, min(96, conf)),
        "method":     method,
        "anchor":     mapping.get("anchor_text") or field_key,
    }
    if slice_capture:                       # diagnostic: the registered box this rung read
        result["target_geom"] = _box_list(reg_box)
    if r_shapewarn:
        result["confidence"] = min(result["confidence"], 70)
        result["method"] += "_shapewarn"
        result["validation_note"] = _SHAPE_WARN_NOTE
    # This rung assembles its own dict rather than going through _mapping_result, so the free-text
    # ocr_conf cap never applied here either — same hole as _inline(). See _FT_FALLTHROUGH_CAP_ON.
    return _ft_fallthrough_cap(result, val_type)


def _edge_cut_relocate(page, mapping, anchor_box, target_box, located, val_type, field_key,
                       anchor_text, abs_text, ocr_text_fn, ocr_lines_fn, expansion,
                       validation_patterns, format_lookup, line_cache, slice_capture,
                       page_idx, provisional_lookup):
    """TEMPLATE_EDGE_CUT_RELOCATE (Oracle SIGN-OFF-W/COND 2026-08-06 — see the flag block).
    Called only when `_abs_edge_guard` could NOT clean-heal a cut taught box. Re-seat the value off
    the LOCAL located label + stored offset + word-snap (the reliable placement the drift path uses)
    and PREFER it over the abs garble — but Stage-1 commits FLAGGED (<=70 + _EDGE_CUT_NOTE, pre-
    filled), earning a clean commit ONLY via confirmed/provisional shape consent. Returns a result
    dict to COMMIT, or None to fall through to the guard's own outcome (fail-toward-review).

    Guards: CO-REQUIRE _TARGET_WORD_SNAP_ON (the y-cure, Cond 0); LOCAL located only — matched,
    not too-wide (Rule A); relocate must actually READ something; NOT `_shapewarn` (a learned-shape
    bleed fails toward review, Cond); and the re-seat must be MATERIALLY DIFFERENT from the abs
    garble (re-anchoring that changed nothing gives no gain and must not clean-promote a garble)."""
    if not (_EDGE_CUT_RELOCATE_ON and _TARGET_WORD_SNAP_ON and anchor_text):
        return None
    if not (isinstance(located, dict) and located.get("matched_text") is not None):
        return None                                   # Rule A: no usable LOCAL label -> no relocate
    if _located_too_wide(anchor_box, located):
        return None
    relo = _relocate_and_read(page, mapping, anchor_box, target_box, located, val_type,
                              ocr_text_fn, expansion, validation_patterns, format_lookup,
                              slice_capture, page_idx, field_key, ocr_lines_fn, line_cache,
                              provisional_lookup=provisional_lookup)
    if not (isinstance(relo, dict) and relo.get("value")):
        return None                                   # relocate failed -> fall through (no worse)
    rv = relo.get("value")
    if "_shapewarn" in (relo.get("method") or ""):
        return None                                   # learned-shape wrong-column bleed -> review floor
    if _code_norm(rv) == _code_norm(abs_text or ""):
        return None                                   # re-anchor changed nothing -> no gain, no promote
    # Preferred. CLEAN only when the re-seated value earns it via learned/provisional shape consent
    # (Oracle Cond 5: the relocate's OWN same-pixel inline agreement never licenses clean). Otherwise
    # commit the re-seated value FLAGGED + pre-filled — the honest teach-once win (right value to
    # review, human checkpoint kept). Frag-tie + snap-union-witness clean-upgrade = Stage-2.
    consent = _shape_consents(rv, field_key, format_lookup, provisional_lookup)
    if consent not in ('confirmed', 'provisional'):
        relo = dict(relo)
        relo["confidence"] = min(int(relo.get("confidence") or 70), 70)
        relo["validation_note"] = _EDGE_CUT_NOTE
        if not str(relo.get("method") or "").endswith(("_edgecut", "_relocated")):
            relo["method"] = (relo.get("method") or "template_mapping") + "_relocated"
    return relo


def _read_pad_window_date(page, target_box):
    """PAD-WINDOW DATE READ (Slice 1, geometric neighbour-safe). Read a ROW-BOUNDED padded
    window around the taught DATE target box and return (DD-MM-YYYY, mean_word_conf) for the
    date qualifier NEAREST the box centre — or None (nothing found / ambiguous / abstain).

    The window is padded generously HORIZONTALLY (the clip is a leading/trailing glyph on the
    value's own row — the probe-proven recovery lever) but tightly VERTICALLY (<= 0.5 * box
    height) so it can never reach the row above/below where a neighbouring date/code lives — the
    PRIMARY neighbour guard (Oracle C2). psm6 (block mode) + --dpi is the tight-crop-starves-the-
    LSTM cure the probe proved. Nearest-to-centre + abstain-on-two resolves an in-row second date;
    a whole-window salvage with a >1 distinct-date count also abstains. Pure — no mutation."""
    if page is None or Output is None or pytesseract is None:
        return None
    from extraction import validator
    try:
        pw, ph = page.size
        bx = float(target_box.get("x_norm") or 0.0); by = float(target_box.get("y_norm") or 0.0)
        bw = float(target_box.get("w_norm") or 0.0); bh = float(target_box.get("h_norm") or 0.0)
    except (TypeError, ValueError, AttributeError):
        return None
    if bw <= 0 or bh <= 0:
        return None
    hpad = min(0.8 * bw, 0.06)              # leading/trailing clipped glyph, capped 0.06 page-norm/side
    vpad = 0.5 * bh                         # ROW-BOUND — never into an adjacent row
    px0 = int(max(0.0, bx - hpad) * pw); py0 = int(max(0.0, by - vpad) * ph)
    px1 = int(min(1.0, bx + bw + hpad) * pw); py1 = int(min(1.0, by + bh + vpad) * ph)
    if px1 - px0 < 4 or py1 - py0 < 4:
        return None
    try:
        prepped = _prep(page.crop((px0, py0, px1, py1)))
    except Exception:
        return None
    iw, ih = prepped.size
    if iw < 1:
        return None
    cfg = "--oem 3 --psm 6"
    _dpi = os.environ.get("OCR_RENDER_DPI")
    if _dpi:
        try:
            cfg += f" --dpi {int(_dpi)}"
        except (TypeError, ValueError):
            pass
    try:
        data = pytesseract.image_to_data(prepped, config=cfg, output_type=Output.DICT)
    except Exception:
        return None
    # Target-box centre-x in the crop's normalised frame (prep scales uniformly, so [0,1] carries).
    crop_w = max(1, px1 - px0)
    tcx = ((bx + bw / 2.0) * pw - px0) / crop_w
    words = data.get("text", [])
    cands = []                              # (parsed_date, conf, centre_x_norm)
    all_words, all_confs = [], []
    for i in range(len(words)):
        w = (words[i] or "").strip()
        if not w:
            continue
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            conf = -1.0
        if conf < 0:
            continue
        all_words.append(w); all_confs.append(conf)
        d = validator.parse_date(w)         # a clean recovered date usually reads as ONE token
        if d is None:
            continue
        try:
            cx = (int(data["left"][i]) + int(data["width"][i]) / 2.0) / iw
        except Exception:
            cx = 0.5
        cands.append((d, conf, cx))
    if cands:
        cands.sort(key=lambda c: abs(c[2] - tcx))
        # Abstain when the two nearest qualifiers are near-equidistant AND parse to DIFFERENT dates
        # (a genuine same-row second date the geometry can't confidently separate).
        if (len(cands) >= 2 and cands[1][0].date() != cands[0][0].date()
                and abs(abs(cands[1][2] - tcx) - abs(cands[0][2] - tcx)) < 0.15):
            return None
        d, conf, _ = cands[0]
        return (d.strftime("%d-%m-%Y"), conf)
    # No single-word date — try a spaced/merged date across the joined window, gated on a single
    # distinct salvaged date (reggie's distinct-count guard; >1 = ambiguous row → abstain).
    if all_words:
        d, distinct = validator.salvage_date_detail(" ".join(all_words))
        if d is not None and distinct == 1:
            return (d.strftime("%d-%m-%Y"), sum(all_confs) / len(all_confs))
    return None


def _maybe_pad_date_flag(page, target_box, val_type, result, tight_ocr_conf):
    """Case 2/3 of the PAD-WINDOW DATE READ (Slice 1). Given a taught DATE committed off the
    ABSOLUTE / edge-cut path, cross-check a wider row-bounded read; on a confident PARSED-value
    DISAGREEMENT keep the committed value but FLAG it for review (never silent-swap). Returns the
    (possibly annotated) result dict. Byte-identical no-op when: the switch is OFF, the field is
    not a date, the result is already flagged (C5 — don't stack an edge-cut/shape note), the reads
    agree on the calendar date (Case 2), or the padded witness is weak / ambiguous."""
    if not _PAD_WINDOW_READ_ON or val_type != 'date' or not result:
        return result
    if result.get("validation_note"):       # already flagged (edge-cut / shape-warn) — don't stack (C5)
        return result
    committed = result.get("value")
    if not committed:
        return result
    from extraction import validator
    cd = validator.parse_date(str(committed))
    if cd is None:                           # committed isn't a clean date — nothing to compare
        return result
    pad = _read_pad_window_date(page, target_box)
    if pad is None:
        return result
    pad_val, pad_conf = pad
    pd = validator.parse_date(pad_val)
    if pd is None or pd.date() == cd.date():  # Case 2 — calendar-equal (e.g. 3/04 vs 03/04): no-op
        return result
    # Case 3 — DISAGREEMENT. Only flag when the padded read is confidently better than the TIGHT
    # read (not the synthetic 90 tier — that would never fire). Weak disagreement adds review load
    # for no gain → keep the current commit (Oracle: fail toward MAX auto-file).
    base = tight_ocr_conf if tight_ocr_conf is not None else 70
    if pad_conf is None or pad_conf < base + _PAD_DISAGREE_MARGIN:
        return result
    out = dict(result)
    out["confidence"] = min(out.get("confidence") or 90, 70)
    out["method"] = (out.get("method") or "template_mapping") + "_paddisagree"
    out["validation_note"] = _PAD_DATE_DISAGREE_NOTE.format(pad_val)
    return out


def _read_pad_window_code(page, target_box, validation_patterns):
    """PAD-WINDOW CODE READ (Slice 1b). The CODE sibling of `_read_pad_window_date`: read a ROW-BOUNDED
    padded window around the taught box and return (RAW SURFACE, mean_word_conf) for the CODE-shaped
    qualifier NEAREST the box centre — or None (nothing / ambiguous / abstain). Geometry is IDENTICAL to
    the date reader (row-bound vpad = 0.5*box_h is the neighbour guard; hpad = leading/trailing clipped
    glyph, capped; psm6 + --dpi is the tight-crop-starves-the-LSTM cure). The ONLY difference from the
    date reader: a candidate is credible when it PASSES the field's HARD reference_code pattern (a
    digit-bearing code — the same gate the merge layer uses), and the RAW surface is returned (un-parsed)
    so the caller can test glyph-continuity (suffix-containment) against the tight read. Pure — no
    mutation. Abstains on two near-equidistant candidates (a genuine same-row second code)."""
    if page is None or Output is None or pytesseract is None:
        return None
    rc = (validation_patterns or {}).get("reference_code")
    if not rc:                                  # no hard pattern → can't qualify a code safely
        return None
    try:
        pw, ph = page.size
        bx = float(target_box.get("x_norm") or 0.0); by = float(target_box.get("y_norm") or 0.0)
        bw = float(target_box.get("w_norm") or 0.0); bh = float(target_box.get("h_norm") or 0.0)
    except (TypeError, ValueError, AttributeError):
        return None
    if bw <= 0 or bh <= 0:
        return None
    hpad = min(0.8 * bw, 0.06)                   # leading/trailing clipped glyph, capped 0.06/side
    vpad = 0.5 * bh                              # ROW-BOUND — never into an adjacent row
    px0 = int(max(0.0, bx - hpad) * pw); py0 = int(max(0.0, by - vpad) * ph)
    px1 = int(min(1.0, bx + bw + hpad) * pw); py1 = int(min(1.0, by + bh + vpad) * ph)
    if px1 - px0 < 4 or py1 - py0 < 4:
        return None
    try:
        prepped = _prep(page.crop((px0, py0, px1, py1)))
    except Exception:
        return None
    iw, ih = prepped.size
    if iw < 1:
        return None
    cfg = "--oem 3 --psm 6"
    _dpi = os.environ.get("OCR_RENDER_DPI")
    if _dpi:
        try:
            cfg += f" --dpi {int(_dpi)}"
        except (TypeError, ValueError):
            pass
    try:
        data = pytesseract.image_to_data(prepped, config=cfg, output_type=Output.DICT)
    except Exception:
        return None
    crop_w = max(1, px1 - px0)
    tcx = ((bx + bw / 2.0) * pw - px0) / crop_w
    words = data.get("text", [])
    cands = []                                   # (surface, conf, centre_x_norm)
    for i in range(len(words)):
        surf = (words[i] or "").strip()
        if not surf:
            continue
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            conf = -1.0
        if conf < 0:
            continue
        if not _validate_code(surf, rc):         # must be a real digit-bearing code, not a caption word
            continue
        try:
            cx = (int(data["left"][i]) + int(data["width"][i]) / 2.0) / iw
        except Exception:
            cx = 0.5
        cands.append((surf, conf, cx))
    if not cands:
        return None
    cands.sort(key=lambda c: abs(c[2] - tcx))
    # Abstain when the two nearest qualifiers are near-equidistant AND textually DIFFERENT (a genuine
    # same-row second code the geometry can't confidently separate) — mirrors the date reader's guard.
    if (len(cands) >= 2 and _code_norm(cands[1][0]) != _code_norm(cands[0][0])
            and abs(abs(cands[1][2] - tcx) - abs(cands[0][2] - tcx)) < 0.15):
        return None
    return (cands[0][0], cands[0][1])


def _validate_code(value, reference_code_patterns):
    """True when `value` matches the field's HARD reference_code pattern (digit-bearing, anchored) —
    the same quality gate the merge layer applies (keyword._validate). Kept local + defensive so an
    import failure degrades to a safe reject (no swap), never a crash."""
    try:
        from extraction import keyword
        return keyword._validate(str(value), reference_code_patterns)
    except Exception:
        return False


def _pad_label_glued(pad_norm, anchor_text):
    """C4 (labelled sub-slice): True when the padded candidate BEGINS with a >=2-char suffix of the
    label's alnum tail — i.e. the pad window swallowed the label's tail and glued it to the value
    ('No.PO-48009' -> 'nopo48009' starts with 'no', the tail of 'orderno'). The pad reader is
    deliberately LABEL-BLIND, so this label-aware check lives in the decision. Blocks the SWAP only;
    the caller still FLAGS, so the disagreement is never silently discarded."""
    tail = _anchor_alnum_tail(anchor_text)
    if not tail or not pad_norm:
        return False
    for k in range(2, min(len(tail), len(pad_norm)) + 1):
        if pad_norm.startswith(tail[-k:]):
            return True
    return False


def _maybe_pad_code(page, target_box, val_type, result, tight_ocr_conf,
                    full_confidence, anchor, expanded, field_key, validation_patterns,
                    format_lookup, provisional_lookup, anchor_text=None):
    """PAD-WINDOW CODE READ decision (Slice 1b — gary -> Oracle SIGN-OFF-W/COND 2026-08-09, extended to
    LABELLED boxes 2026-08-06 under Oracle C1..C7). Given a taught CODE committed off the ABSOLUTE path,
    cross-check a wider row-bounded read and either SWAP (recover a clipped prefix), FLAG (surface a
    garble for review), or no-op. Byte-identical no-op unless armed. The SCOPE decision (label-less vs
    labelled, witness/expanded/edge-heal suppression) is the CALLER's — see the call site in
    `_extract_one`. See the _PAD_WINDOW_CODE_ON / _PAD_CODE_LABELLED_ON design comments for the rules."""
    if not _PAD_WINDOW_CODE_ON or val_type not in _CODE_CROSSCHECK_TYPES or not result:
        return result
    # NOTE-FIRST short-circuit (Oracle condition): a result already carrying a review note (an edge-cut
    # defer-cap, a shape-warn, a relocation flag) reflects INDEPENDENT evidence of trouble; a same-pixel
    # superset re-read must never erase that human checkpoint. Guards BOTH the swap and the flag path.
    if result.get("validation_note"):
        return result
    committed = result.get("value")
    if not committed:                            # empty tight → the keyword/relocate path owns it (C1)
        return result
    pad = _read_pad_window_code(page, target_box, validation_patterns)
    if pad is None:
        return result
    pad_val, pad_conf = pad
    t, p = _code_norm(committed), _code_norm(pad_val)
    if not t or not p or p == t:                 # nothing to reconcile
        return result
    # Padded must clear the OCR-confidence margin over the tight read (else the disagreement is weak —
    # keep the commit; fail toward MAX auto-file). The padded value already passed the hard pattern
    # inside the reader.
    base = tight_ocr_conf if tight_ocr_conf is not None else 70
    if pad_conf is None or pad_conf < base + _PAD_DISAGREE_MARGIN:
        return result
    # PREFIX-containment → ABSTAIN: the padded read is the tight value PLUS trailing chars (a right-side
    # over-read). The tight read was the correct value; never swap, never flag (mirrors _pick_fuller_code
    # rejecting right-side over-reads from a clean commit).
    if p.startswith(t) and not p.endswith(t):
        return result
    # SUFFIX-containment (padded ENDS WITH tight, i.e. a recovered clipped PREFIX) is the ONLY swap
    # shape. Substantial-overlap floor closes the 1-char / label-glue path. Consent gate (fork B): the
    # padded shape must be confirmed/provisional — a COLD read never clean-swaps (blocks the label-glue
    # false-swap 'PONo40351'.endswith('40351'), whose glued shape is never in the confirmed history).
    is_suffix = p.endswith(t) and len(t) >= _PAD_CODE_MIN_SUFFIX and len(t) >= 0.5 * len(p)
    if is_suffix and not _pad_label_glued(p, anchor_text):   # C4: label-tail glue never clean-swaps
        consent = _shape_consents(pad_val, field_key or "",
                                  format_lookup, provisional_lookup)
        # C5 TWO-SIDED CONSENT (Oracle, both scopes). A swap asserts "the committed read is a CLIP".
        # A tight read the learned history POSITIVELY ACCEPTS is not a clip — never swap it, FLAG.
        # This is also what closes the VACUOUS-consent hole: `check_value` returns "accepted" for a
        # FREETEXT class and for an entry with an empty shape set, so under a thin/heterogeneous
        # history BOTH sides consent -> no swap -> flag. Cold start stays healable: with no confirmed
        # entry the tight read scores 'none' (not positive), so a provisional padded read can still
        # swap — at the capped tier below.
        consent_tight = _shape_consents(committed, field_key or "",
                                        format_lookup, provisional_lookup)
        if consent in ("confirmed", "provisional") \
                and consent_tight not in ("confirmed", "provisional"):
            out = _mapping_result(pad_val, full_confidence, expanded, False, anchor,
                                  ocr_conf=pad_conf, val_type=val_type)
            if consent == "provisional":
                # C3: a single taught-doc skeleton — from a template whose box we already know is
                # mis-drawn — is not evidence enough to auto-file. Swap the VALUE, keep the review.
                out["confidence"] = min(out.get("confidence") or 90, _PAD_CODE_PROVISIONAL_CAP)
            out["method"] = (out.get("method") or "template_mapping") + "_padunclip"
            out["_heal"] = "pad_unclip"
            out["pad_unclipped_from"] = committed         # diag-only breadcrumb
            out["pad_consent"] = consent                  # diag-only: gate (b) swap census by tier
            return out
        # suffix but COLD/two-sided-blocked shape → FLAG (surface the fuller read, don't silent-swap)
    # FLAG: a confident disagreement that is NOT a clean consented swap (a garble, or a cold suffix).
    # Keep the committed value, cap for review, carry the padded suggestion. Never silent.
    out = dict(result)
    out["confidence"] = min(out.get("confidence") or 90, 70)
    out["method"] = (out.get("method") or "template_mapping") + "_padcodeflag"
    out["validation_note"] = _PAD_CODE_DISAGREE_NOTE.format(pad_val)
    return out


def _extract_one(page, mapping, field_patterns, ocr_lines_fn, ocr_text_fn,
                 located=_UNSET, page_transform=None,
                 slice_capture=None, page_idx=0,
                 validation_patterns=None, format_lookup=None, line_cache=None,
                 provisional_lookup=None):
    anchor_box = _norm_box(mapping, "anchor")
    target_box = _norm_box(mapping, "target")
    if not anchor_box or not target_box:
        return None

    expansion   = float(mapping.get("search_expansion") or 0.0)
    anchor_text = mapping.get("anchor_text")
    field_key   = mapping.get("field_key", "")
    val_type    = (field_patterns or {}).get(field_key, {}).get("validation")

    # ── FAST PATH: read the EXACT box the operator drew ───────────────────────
    # The drawn target box is what the Template Wizard's live zone-OCR (region.py)
    # read when the field was taught, so on a page that has NOT drifted it reads
    # the value cleanly — exactly what the operator saw and validated. TRUST the
    # saved coordinates FIRST (mirroring anchor.py's rigid-crop-then-relocate
    # model); only when this read fails the shared credibility/format/date-salvage
    # gate do we fall through to anchor relocation. No offset/inset arithmetic
    # happens here, so this path cannot reintroduce the leading-glyph inset clip
    # the derived path below corrects for. THIS is what makes first-instance
    # extraction match the live "targeted selection": previously a located anchor
    # ALWAYS re-derived the crop and the drawn box was never read on a clean page.
    _tcap = ((lambda c: slice_capture(field_key, "template_mapping", page_idx,
               (target_box["x_norm"], target_box["y_norm"],
                target_box["w_norm"], target_box["h_norm"]), c, "target")) if slice_capture else None)
    _abs_meta = {}
    abs_text = _crop_and_ocr(page, target_box, val_type, ocr_text_fn, capture=_tcap, meta=_abs_meta)
    abs_expanded = False
    if not abs_text and expansion > 0:
        abs_text = _crop_and_ocr(page, _expand_box(target_box, expansion), val_type, ocr_text_fn, meta=_abs_meta)
        abs_expanded = bool(abs_text)
    # ABSOLUTE drawn-box read: qualify on the field's REGEX/TYPE only
    # (shape_mode='ignore'). A manual anchor is an explicit human instruction —
    # it must win on type validity even when the operator is CORRECTING a field
    # whose learned history now disagrees. A stationary box can't drift into a
    # neighbour, so the learned-shape veto added no safety here, only the bug:
    # it silently dropped a type-valid manual value and let the wrong auto value win.
    abs_text, abs_salvaged, _ = _gate_value(abs_text, val_type, field_key,
                                            validation_patterns, format_lookup,
                                            shape_mode='ignore', ocr_conf=_abs_meta.get('conf'))
    # ── DRIFT GUARD (before trusting the stationary drawn box) ────────────────
    # Only relevant when the absolute box DID read a credible value (`abs_text`):
    # on a shifted page (e.g. a cropped sample vs an uncropped reprocess pushes
    # every row down) that value is a credible-but-WRONG neighbouring line, which
    # shape_mode='ignore' cannot catch — so it would otherwise commit here. If a
    # REAL anchor label is found displaced beyond tolerance, the page has drifted;
    # the stored offset is drift-invariant, so re-derive the value from the label's
    # ACTUAL position and prefer it. The pre-cached `located` is a LOCAL search, so
    # a large shift can miss it — only THEN do one page-wide locate (so a clean
    # page, where the local locate already found the label at its spot, pays no
    # extra OCR). Fires ONLY on a genuine displaced match (anchor_text present,
    # matched_text set); blank-label / unfound paths fall through unchanged. A
    # failed relocation also falls through (no worse than today).
    # ANCHOR-OFFSET LINK FIRST: when this field's OWN anchor label is located, the
    # value sits at the label's position + the stored offset — a LOCAL, rigid
    # label→value link that is strictly more reliable than a global page transform
    # (a poor landmark fit drifts boxes per-region, floating the value off a
    # correctly-anchored label: the "anchor and data point aren't linked" bug).
    #   • label found + DISPLACED  → re-derive via the stored offset and win;
    #   • label found + at its spot → the absolute read already IS that anchored read,
    #                                 so mark it stable and let it stand.
    anchor_stable = False
    if abs_text and anchor_text and located is not _UNSET:
        drift_located = located or _locate_anchor(
            page, anchor_box, anchor_text, 1.0, ocr_lines_fn,
            min_search=_ANCHOR_SEARCH_MIN, line_cache=line_cache)
        # Prefer the rigid label→value read over the stationary drawn box ONLY when the
        # page has actually DRIFTED (the label is found displaced beyond tolerance). On a
        # NON-drifted page the operator's drawn box already sits on the value, so the clean
        # absolute read it produced — the same one the live draw tool reads at 100% — must
        # STAND. (Previously this also fired "regardless of drift" whenever the value was
        # inline on the label's row, i.e. every key/value layout — which re-read the whole
        # OCR LINE and could replace a clean box read with a garbled line read, e.g.
        # "Beaumont Care Homes Ltd - Comber" → "pantionahe MUGS Liu COTVCE". Genuine drift
        # that the per-label test misses is caught by the REGISTRATION ARBITER just below.)
        if (drift_located and drift_located.get("matched_text") is not None
                and _label_drifted(anchor_box, drift_located)):
            relocated = _relocate_and_read(page, mapping, anchor_box, target_box,
                                           drift_located, val_type, ocr_text_fn,
                                           expansion, validation_patterns,
                                           format_lookup, slice_capture, page_idx,
                                           field_key, ocr_lines_fn, line_cache,
                                           provisional_lookup=provisional_lookup)
            if relocated:
                return relocated
        elif drift_located:
            anchor_stable = True
    # ── REGISTRATION ARBITER (global page transform) — FALLBACK ONLY ────────────
    # Fires ONLY when the anchor is NOT a usable local signal (not found, or a
    # too-wide merged-row match the relocation refused → anchor_stable stays False).
    # A fitted page transform is then the global drift signal: if it says the taught
    # target box maps to a MEANINGFULLY moved position (box_divergence beyond the
    # same "still on this row?" band _label_drifted uses), the stationary absolute
    # read is on the wrong row — a credible-but-WRONG type-valid neighbour that
    # shape_mode='ignore' can't catch — so prefer the registration read. A
    # correctly-anchored value (anchor_stable) is NEVER overridden by the transform.
    # Clean pages → divergence ≈ 0 → arbiter never fires → the absolute fast path
    # below is byte-identical. A failed reg read falls through.
    if (abs_text and page_transform is not None and not anchor_stable
            and registration.box_divergence(page_transform, target_box)
                > max(target_box["h_norm"] * 0.5, _DRIFT_FLOOR)):
        reg = _read_registration(page, mapping, target_box, val_type, ocr_text_fn,
                                 expansion, page_transform, validation_patterns,
                                 format_lookup, slice_capture, page_idx, field_key,
                                 ocr_lines_fn=ocr_lines_fn, line_cache=line_cache)
        if reg:
            return reg
    # ── ABS-RUNG WORD-EDGE GUARD (Slice C, jitter-crater arc) — see the flag block ──
    # GATE-OUTCOME-INDEPENDENT (Oracle C-C1: runs whether or not abs_text survived the
    # gate — a Slice-B date-clip rejection must not starve this geometric heal). Placed
    # AFTER drift/registration (a genuinely drifted page keeps its full-res _geometric
    # path) and BEFORE the inline reconcile (a clean heal rewrites the rigid SURFACE;
    # the reconcile's independent inline witness then arbitrates the corrected read).
    _edge_healed = False
    _edge_suspect = False
    if _ABS_EDGE_GUARD_ON and (val_type in _SNAP_VAL_TYPES
                              or (_CURRENCY_EDGE_GROW_ON and val_type in _EDGE_GUARD_VAL_TYPES)):
        _eg = _abs_edge_guard(page, target_box, abs_expanded, expansion, abs_text,
                              val_type, field_key, ocr_lines_fn, ocr_text_fn,
                              validation_patterns, format_lookup, provisional_lookup,
                              line_cache, (located if located is not _UNSET else None),
                              slice_capture, page_idx,
                              has_label=bool(mapping.get("anchor_text")),
                              anchor_name=mapping.get("anchor_text"))
        if _eg is not None:
            if "rewrite" in _eg:
                abs_text, _abs_meta['conf'] = _eg["rewrite"]
                abs_salvaged = False
                _edge_healed = True
            else:
                # The guard could NOT clean-heal this cut (defer_cap floor OR flagged {'result'}).
                # Before committing either, try the PLACEMENT primitive: re-seat the value off the
                # LOCAL located label + word-snap — this fixes a vertical/edge seat clip the
                # horizontal grow structurally cannot. Intercepts BOTH non-rewrite outcomes (Oracle
                # Cond 1): the flagged {'result'} would otherwise return here and pre-empt the
                # re-seat. Inert unless TEMPLATE_EDGE_CUT_RELOCATE — helper returns None → the
                # original defer_cap/result handling below runs, byte-identical.
                _relo = _edge_cut_relocate(page, mapping, anchor_box, target_box, located,
                                           val_type, field_key, anchor_text, abs_text,
                                           ocr_text_fn, ocr_lines_fn, expansion,
                                           validation_patterns, format_lookup, line_cache,
                                           slice_capture, page_idx, provisional_lookup)
                if _relo is not None:
                    # C4 (BOTH-ON seam): the re-seat can reproduce a still-clipped date; pad-check
                    # it too so a leading-glyph-clipped date can never silent-commit behind the
                    # edge-cut-relocate. No-op for non-dates / unarmed / agreeing reads.
                    return _maybe_pad_date_flag(page, target_box, val_type, _relo, None)
                if "defer_cap" in _eg:
                    # Heal refused/incomplete: keep the FULL flow (the inline reconcile is the
                    # independent witness that heals exactly this class) — only the final abs
                    # commit wears the cap + note, and only if nothing else healed first.
                    _edge_suspect = True
                else:
                    return _eg["result"]
    # ── INLINE CODE RECONCILE (single-token code, taught inline) — DARK ──────────
    # The label is found and NOT drifted (so drift-relocate + registration above did not
    # fire), yet a fixed narrow drawn box can still clip a code value's prefix under
    # per-scan offset/scale (DN-93159 → N-93159), or float off-row into whitespace
    # (→ HAL7ea7ca), and the alphanumeric gate can't catch it. Cross-check the box read
    # against a full-res, label-anchored inline read and prefer the fuller value. Placed
    # AFTER drift/registration so genuine drift still uses the full-res _geometric path;
    # scoped to code val_types so the free-text box-first seam (:742-750) is untouched.
    # ON by default (kill TEMPLATE_INLINE_CODE_RECONCILE=0); OFF → this block is skipped. (Comment
    # corrected 2026-08-03 per Oracle — it read "Off by default" but _INLINE_CODE_RECONCILE_ON
    # defaults '1'. This reconcile is the Stage-0.5 garble's last review backstop; keep it ON.)
    _icr_meta = {}          # C1: records whether the reconcile actually formed an opinion
    if (abs_text and _INLINE_CODE_RECONCILE_ON and anchor_text
            and val_type in _CODE_CROSSCHECK_TYPES):
        rc = _inline_code_reconcile(page, abs_text, anchor_box, target_box, val_type,
                                    field_key, anchor_text, ocr_lines_fn, ocr_text_fn,
                                    validation_patterns, format_lookup, line_cache,
                                    slice_capture, page_idx, abs_ocr_conf=_abs_meta.get('conf'),
                                    provisional_lookup=provisional_lookup, meta=_icr_meta)
        if rc is not None:
            return rc
    if abs_text:
        _r = _mapping_result(abs_text, bool(mapping.get("anchor_text")),
                             abs_expanded, abs_salvaged,
                             mapping.get("anchor_text") or field_key,
                             ocr_conf=_abs_meta.get('conf'), val_type=val_type,
                             geom=_box_list(target_box) if slice_capture else None)
        if _edge_healed:
            _r["method"] += "_edgegrow"      # SFDEV every-step-trace visibility (Slice C heal)
        elif _edge_suspect:
            # Deferred fail-toward-review floor: nothing healed the cut-evidence read —
            # it may not commit silently at 78-90 any more.
            _r["confidence"] = min(_r["confidence"], 70)
            _r["method"] += "_edgecut"
            _r["validation_note"] = _EDGE_CUT_NOTE
        # PAD-WINDOW DATE READ (Slice 1): cross-check the committed taught date against a wider
        # row-bounded read and FLAG a confident disagreement (the silent still-parses misread class).
        # No-op unless armed + val_type=='date' + not already flagged. Tight OCR conf is the margin base.
        _r = _maybe_pad_date_flag(page, target_box, val_type, _r, _abs_meta.get('conf'))
        # PAD-WINDOW CODE READ (Slice 1b): the code sibling. SWAP a consented clipped-prefix recovery,
        # else FLAG a confident disagreement. No-op unless armed + code type + not already noted (the
        # date flag / edge-cut note short-circuits it). TWO SCOPES:
        #   • LABEL-LESS — the original residual class, unchanged (Oracle 2026-08-09), commits at 78.
        #   • LABELLED — the sub-slice (_PAD_CODE_LABELLED_ON, Oracle 2026-08-06 C1/C2), commits at the
        #     auto-fileable 90 tier, so it is admitted ONLY on the pure absolute read and ONLY when the
        #     inline reconcile never formed an opinion:
        #       C1 `not _icr_meta.get("witness")` — the reconcile located the label AND read a value,
        #          so its None was a deliberate ARBITRATION by a stronger independent-pixel witness;
        #          never overturn it and never flag against it.
        #       C2 `not abs_expanded` — the committed text came from a WIDER crop, so a narrower pad
        #          window cannot be a "recovery" (the same-box premise fails).
        #       C2 `not _edge_healed` — the edge guard already GREW and consented this read, and
        #          `_edgegrow` carries no validation_note, so nothing else would stop a pad flag from
        #          dragging a good heal down to 70.
        _pad_labelled_ok = (_PAD_CODE_LABELLED_ON and not _icr_meta.get("witness")
                            and not abs_expanded and not _edge_healed)
        if (not mapping.get("anchor_text")) or _pad_labelled_ok:
            _r = _maybe_pad_code(page, target_box, val_type, _r, _abs_meta.get('conf'),
                                 bool(mapping.get("anchor_text")),
                                 mapping.get("anchor_text") or field_key, abs_expanded,
                                 field_key, validation_patterns, format_lookup, provisional_lookup,
                                 anchor_text=mapping.get("anchor_text"))
        return _r

    # ── SINGLE-LABEL LOCAL REFINEMENT (anchor + stored offset) — PREFERRED ──────
    # The drawn box read nothing credible. Find THIS field's OWN label and derive
    # the value from where the label ACTUALLY landed (located + the drift-invariant
    # stored offset). This now runs BEFORE the global page transform: when the
    # anchor is findable, the rigid label→value link must win — a poor landmark fit
    # otherwise floats the value off a correctly-anchored label (the "anchor and
    # data point aren't linked" bug, abs-empty path). Mirrors the arbiter precedence
    # above (anchor first, transform fallback).
    if located is _UNSET:
        located = _locate_anchor(page, anchor_box, anchor_text, expansion,
                                 ocr_lines_fn, min_search=_ANCHOR_SEARCH_MIN,
                                 line_cache=line_cache)
    # Page-wide relocation ("try again to actually FIND the label"): when the
    # label isn't in the drawn box ± local margin — a cropped/heavily-shifted
    # scan moves it out — search the WHOLE page for the distinctive label. The
    # target is still derived from where the label ACTUALLY is, so the value
    # follows the label however far it moved. Guarded by the fuzzy threshold and
    # only attempted when a label needle exists. Generic to every template.
    if not located and anchor_text:
        located = _locate_anchor(page, anchor_box, anchor_text, 1.0,
                                 ocr_lines_fn, min_search=_ANCHOR_SEARCH_MIN,
                                 line_cache=line_cache)
    if located:
        # Derive the value from where the anchor label ACTUALLY landed — handles the
        # anchor having drifted since the sample doc. Same helper the early drift
        # guard above uses; returns the relocated read or None (gate failed).
        relocated = _relocate_and_read(page, mapping, anchor_box, target_box, located,
                                       val_type, ocr_text_fn, expansion, validation_patterns,
                                       format_lookup, slice_capture, page_idx, field_key,
                                       ocr_lines_fn, line_cache,
                                       provisional_lookup=provisional_lookup)
        if relocated:
            return relocated

    # ── REGISTRATION FALLBACK ("register, then read") — LAST RESORT ─────────────
    # Only NOW, when the label couldn't be found or its relocation failed the gate,
    # map the taught target box through the fitted transform and read there. Falls
    # through to None (field omitted) if the transform read doesn't clear the gates.
    if page_transform is not None:
        reg = _read_registration(page, mapping, target_box, val_type, ocr_text_fn,
                                 expansion, page_transform, validation_patterns,
                                 format_lookup, slice_capture, page_idx, field_key,
                                 ocr_lines_fn=ocr_lines_fn, line_cache=line_cache)
        if reg:
            return reg
    return None


# ── Anchor relocation ─────────────────────────────────────────────────────────

def _match_label_run(words, needle):
    """The tightest contiguous run of words on the located line that forms the
    matched LABEL, plus the index just PAST it — returned as `(run_words, end_index)`
    so a caller harvests the value from `words[end_index:]`.

    Excludes the trailing VALUE words of a "label …gap… value" key/value row AND —
    critically — the words of any OTHER COLUMN that PRECEDES the label on a MERGED
    two-column OCR row (a left-hand address block sharing the row's y-band with a
    right-hand "Invoice Date" caption). The old scan tested PREFIXES only
    (`words[:k]`), assuming the label was the line's LEADING text; on such a merged
    row the smallest prefix that CONTAINED the label also swallowed the whole
    preceding column, so `label_box` spanned the row and the offset / crop-relocate
    that seats a value off label-origin derived from a false (far-left) origin.

    Now scans ALL contiguous windows `words[i:j]` and returns the SMALLEST-span
    window that MAXIMISES the label match (a boundary-aligned whole-needle hit scores
    1.0 via `_label_score`, so the tightest occurrence of the label wins and both the
    value and any preceding column fall outside it). Ties break toward the window
    nearest the value — the largest start index — since on a key/value row the label
    sits immediately LEFT of its value. The caller MUST slice `words[end_index:]`,
    NOT `words[len(run):]`, which re-includes the label the instant the run starts
    internally. Returns None when the best window is below threshold (caller then uses
    the whole-line box, as before). O(n²) windows; n = words on a line (small)."""
    if not needle or not words:
        return None
    n = len(words)
    best = None   # (score, -span, start): maximise → high score, tight span, rightmost
    for i in range(n):
        acc_parts = []
        for j in range(i + 1, n + 1):
            acc_parts.append(words[j - 1].get("text", ""))
            s = _label_score(needle, _normalise(" ".join(acc_parts)))
            key = (s, -(j - i), i)
            if best is None or key > best[0]:
                best = (key, i, j)
    if best is None or best[0][0] < _FUZZY_MATCH_THRESHOLD:
        return None
    _, i, j = best
    return words[i:j], j


def cluster_value_words(words, expect_x=None):
    """Pick the VALUE's own column from the harvested post-label words, so a far
    neighbouring heading/column on the SAME OCR line can't leak into the value.

    The inline-harvest reads a whole Tesseract line (full page width) and takes
    EVERY word after the matched label — so "ABC12345 …gap… DOCUSYS MODEL NAME"
    returns the heading too. The drawn box width is discarded on this path and the
    only downstream guard (clean_crop_segment's 4-space split) misses a 1-3 space
    column boundary. This re-imposes the column boundary by HORIZONTAL GAP: split
    `words` into runs wherever the inter-word gap exceeds a DPI-invariant threshold
    (a true inter-COLUMN gap is several text-heights wide, far larger than a normal
    inter-word space, so a legitimate multi-word value like "Beaumont Care Homes
    Ltd" stays whole), and return the run nearest/after `expect_x` (the located
    label's right edge → the value-adjacent column). Mirrors the renderer's
    nearestLeftCluster. Pure; never empty (single run → that run). Falls back to the
    whole list when word boxes are missing (e.g. a born-digital line with no
    per-word geometry), so behaviour is byte-identical there."""
    ws = [w for w in (words or []) if isinstance(w, dict)]
    if len(ws) <= 1:
        return ws
    try:
        xs = [(float(w["x_norm"]), float(w["w_norm"]), float(w.get("h_norm", 0.0)), w)
              for w in ws]
    except (KeyError, TypeError, ValueError):
        return ws   # incomplete geometry → don't cluster (legacy whole-line join)
    xs.sort(key=lambda t: t[0])
    heights = sorted(h for _, _, h, _ in xs if h > 0)
    med_h = heights[len(heights) // 2] if heights else 0.0
    # Inter-COLUMN gap ≈ several text-heights; a normal inter-word space is a small
    # fraction of one. Tie the break to median word height → DPI/zoom invariant.
    thresh = max(med_h * 1.2, 1e-4)
    clusters = [[xs[0]]]
    for i in range(1, len(xs)):
        px, pw = xs[i - 1][0], xs[i - 1][1]
        if xs[i][0] - (px + pw) > thresh:
            clusters.append([xs[i]])
        else:
            clusters[-1].append(xs[i])
    if len(clusters) == 1:
        return ws   # one column → unchanged
    if expect_x is None:
        chosen = clusters[0]
    else:
        # Prefer the cluster at/after expect_x (the value column adjacent to the
        # label's right edge), nearest first; this drops both a trailing heading and
        # a far right-hand column.
        chosen = min(clusters,
                     key=lambda cl: (0 if cl[0][0] >= expect_x else 1,
                                     abs(cl[0][0] - expect_x)))
    return [t[3] for t in chosen]


def _snap_box_to_words(page, seated_box, val_type, ocr_lines_fn, line_cache, label_box=None):
    """Slice B: snap a DERIVED-rung seated value box to the page word geometry (see the flag
    block above for the contract). Word source = the page-wide locate's `line_cache` full-page
    entry (already present on every doc that reached a derived rung → zero extra OCR in the
    common case); a registration-only path without a prior locate pays one page-wide pass,
    amortised via the same cache. Every failure path returns `seated_box` UNCHANGED (today's
    behaviour): switch off, out-of-scope type, no geometry, no admitted words, or an over-4x
    union (a tiny box nicking a huge word is not a snap licence — B-C3 cap).
    `label_box` MUST already be in the SAME frame as `seated_box` (drift rung: the LOCATED
    label_box; registration rung: the TRANSFORMED anchor box — Oracle B-C1, the clamp arc's
    frame trap): words at/left of its right edge are cut so the label tail is never re-absorbed
    (majority-inside already excludes most of it; the cut is the backstop)."""
    if not _TARGET_WORD_SNAP_ON or val_type not in _SNAP_VAL_TYPES:
        return seated_box
    if page is None or not isinstance(seated_box, dict):
        return seated_box
    lines = None
    key = (id(page), 0.0, 0.0, 1.0, 1.0)
    if line_cache is not None and key in line_cache:
        lines = line_cache[key]
    elif ocr_lines_fn is not None:
        try:
            crop = _crop(page, {"x_norm": 0.0, "y_norm": 0.0, "w_norm": 1.0, "h_norm": 1.0})
            if crop is None:
                return seated_box
            lines = ocr_lines_fn(crop)
            if line_cache is not None and lines is not None:
                line_cache[key] = lines
        except Exception:
            return seated_box
    if not lines:
        return seated_box
    try:
        sx1 = float(seated_box["x_norm"]); sy1 = float(seated_box["y_norm"])
        sw = float(seated_box["w_norm"]);  sh = float(seated_box["h_norm"])
    except (KeyError, TypeError, ValueError):
        return seated_box
    sx2, sy2 = sx1 + sw, sy1 + sh
    scy = sy1 + sh / 2.0
    admitted = []
    for ln in lines:
        for wd in (ln.get("words") or ()):
            try:
                wx1 = float(wd["x_norm"]); wy1 = float(wd["y_norm"])
                ww = float(wd["w_norm"]);  wh = float(wd["h_norm"])
            except (KeyError, TypeError, ValueError):
                continue
            if ww <= 0 or wh <= 0:
                continue
            # Row band: single-token derived fields live on one row — a word whose centre
            # is more than ~0.6 heights off the box centre is another row's word.
            if abs((wy1 + wh / 2.0) - scy) > max(wh, sh) * 0.6:
                continue
            ix = max(0.0, min(sx2, wx1 + ww) - max(sx1, wx1))
            iy = max(0.0, min(sy2, wy1 + wh) - max(sy1, wy1))
            if ix <= 0 or iy <= 0:
                continue                             # CORE INVARIANT: untouched → never admitted
            if (ix * iy) / (ww * wh) < 0.5:
                continue                             # majority-inside (>=50% of the WORD's area)
            admitted.append(wd)
    if not admitted:
        return seated_box
    lre = None
    if isinstance(label_box, dict):
        try:
            lre = float(label_box["x_norm"]) + float(label_box["w_norm"])
        except (KeyError, TypeError, ValueError):
            lre = None
    if lre is not None:
        admitted = [w for w in admitted
                    if float(w["x_norm"]) + float(w["w_norm"]) / 2.0 >= lre]
        if not admitted:
            return seated_box
    admitted = cluster_value_words(admitted, expect_x=lre)
    if not admitted:
        return seated_box
    try:
        x1 = min(float(w["x_norm"]) for w in admitted)
        x2 = max(float(w["x_norm"]) + float(w["w_norm"]) for w in admitted)
        y1 = min(float(w["y_norm"]) for w in admitted)
        y2 = max(float(w["y_norm"]) + float(w["h_norm"]) for w in admitted)
    except (KeyError, TypeError, ValueError):
        return seated_box
    pad = 0.004
    snapped = _clamp_box({"x_norm": x1 - pad, "y_norm": y1 - pad,
                          "w_norm": (x2 - x1) + 2 * pad, "h_norm": (y2 - y1) + 2 * pad})
    if snapped["w_norm"] * snapped["h_norm"] > 4.0 * max(sw * sh, 1e-9):
        return seated_box
    return snapped


def _page_words_cached(page, ocr_lines_fn, line_cache):
    """Full-page word lines via the shared cache (identity frame — crop-relative norm of the
    whole page IS page-norm), exactly as _snap_box_to_words sources them. None on any failure."""
    if page is None:
        return None
    key = (id(page), 0.0, 0.0, 1.0, 1.0)
    if line_cache is not None and key in line_cache:
        return line_cache[key]
    if ocr_lines_fn is None:
        return None
    try:
        crop = _crop(page, {"x_norm": 0.0, "y_norm": 0.0, "w_norm": 1.0, "h_norm": 1.0})
        if crop is None:
            return None
        lines = ocr_lines_fn(crop)
        if line_cache is not None and lines is not None:
            line_cache[key] = lines
        return lines
    except Exception:
        return None


def _find_edge_cut_words(lines, read_box):
    """Slice C predicate (see the _ABS_EDGE_GUARD_ON flag block): words on the read box's row
    band that the box's LEFT or RIGHT edge passes THROUGH. Returns (left_cut, right_cut) —
    each the cut word dict or None. Pure geometry; thresholds per the Oracle-signed table."""
    if not lines or not isinstance(read_box, dict):
        return None, None
    try:
        sx1 = float(read_box["x_norm"]); sy1 = float(read_box["y_norm"])
        sw = float(read_box["w_norm"]);  sh = float(read_box["h_norm"])
    except (KeyError, TypeError, ValueError):
        return None, None
    sx2 = sx1 + sw
    scy = sy1 + sh / 2.0
    left_cut = right_cut = None
    for ln in lines:
        for wd in (ln.get("words") or ()):
            try:
                wx1 = float(wd["x_norm"]); wy1 = float(wd["y_norm"])
                ww = float(wd["w_norm"]);  wh = float(wd["h_norm"])
            except (KeyError, TypeError, ValueError):
                continue
            if ww <= 0 or wh <= 0:
                continue
            if abs((wy1 + wh / 2.0) - scy) > max(wh, sh) * 0.6:   # Slice-B row-band convention
                continue
            g = ww / max(1, len(str(wd.get("text") or "")))       # mean glyph width
            wx2 = wx1 + ww
            # RIGHT edge through the word: enough of the word inside to have fed the read,
            # enough outside to prove the cut, and neither a pad-nick nor box-overshoot.
            inside_r = sx2 - wx1
            over_r = wx2 - sx2
            if (wx1 < sx2 < wx2
                    and inside_r >= max(0.006, g)
                    and over_r >= max(0.004, 0.6 * g)
                    and 0.12 <= inside_r / ww <= 0.95):
                if right_cut is None or wx2 > float(right_cut["x_norm"]) + float(right_cut["w_norm"]):
                    right_cut = wd
            # LEFT edge mirror.
            inside_l = wx2 - sx1
            over_l = sx1 - wx1
            if (wx1 < sx1 < wx2
                    and inside_l >= max(0.006, g)
                    and over_l >= max(0.004, 0.6 * g)
                    and 0.12 <= inside_l / ww <= 0.95):
                if left_cut is None or wx1 < float(left_cut["x_norm"]):
                    left_cut = wd
    return left_cut, right_cut


def _snap_union_witness(lines, grown, gx1, gx2, gv, target_box, edges):
    """SNAP-UNION GEOMETRY WITNESS (Oracle SIGN-OFF-W/COND 2026-08-06 — see the
    _SNAP_UNION_WITNESS_ON flag block). Corroborate a grown CODE read `gv` by an INDEPENDENT
    geometry so a garbled composed/derived nick heals CLEAN even with no shape history (teach-once):
    the LOCATE-tier words inside the grown box must reconstruct gv EXACTLY, CONTIGUOUSLY, and be
    edge-ANCHORED to the UN-cut side of the TAUGHT box (`target_box`) — proving the value occupies
    the operator's slot, not a sideways neighbour (the Oracle-ruled placement, not merely reading,
    certification). Returns True only in that case; the caller keeps every other guard.

    All measured against `target_box` (what the operator DREW), never `grown` (the expanded read):
      (1) exact contiguous union of ≥0.9-inside locate words == _code_norm(gv) — subset/superset fail;
      (2) contiguity — every adjacent word x-gap ≤ 1.5·g (no cross-column stitch);
      (3) directional un-cut-edge anchor — R-cut: -g ≤ (ux1-tx1) ≤ 0.25·W ; L-cut mirror on ux2/tx2;
          BOTH-cut ('LR') has no un-cut edge -> no clean promotion (v1);
      (4) occupancy floor overlap(union, taught)/W ≥ 0.6 (secondary belt-and-suspenders).
    g = median witness-word glyph width; W = target_box width; k=0.25 (safe-direction-tunable)."""
    if edges not in ('L', 'R'):                       # LR (or none) has no un-cut edge to anchor
        return False
    want = _code_norm(str(gv))
    if not want:
        return False
    gcy = float(grown["y_norm"]) + float(grown["h_norm"]) / 2.0
    gh = float(grown["h_norm"])
    picks = []                                        # (x1, x2, glyph_len, code_text)
    for ln in (lines or ()):
        for wd in (ln.get("words") or ()):
            try:
                wx1 = float(wd["x_norm"]); wy1 = float(wd["y_norm"])
                ww = float(wd["w_norm"]);  wh = float(wd["h_norm"])
            except (KeyError, TypeError, ValueError):
                continue
            if ww <= 0 or wh <= 0:
                continue
            if abs((wy1 + wh / 2.0) - gcy) > max(wh, gh) * 0.6:          # same row-band convention
                continue
            if max(0.0, min(gx2, wx1 + ww) - max(gx1, wx1)) / ww < 0.9:  # ≥0.9 inside grown (as the veto)
                continue
            txt = str(wd.get("text") or "")
            ct = _code_norm(txt)
            if ct:
                picks.append((wx1, wx1 + ww, max(1, len(txt)), ct))
    if not picks:
        return False
    picks.sort(key=lambda p: p[0])
    if ''.join(p[3] for p in picks) != want:          # (1) exact contiguous union == gv
        return False
    gws = sorted((p[1] - p[0]) / p[2] for p in picks)  # per-word glyph width
    g = gws[len(gws) // 2]                              # median, computed once
    if g <= 0:
        return False
    for a, b in zip(picks, picks[1:]):                 # (2) contiguity — no cross-column stitch
        if b[0] - a[1] > 1.5 * g:
            return False
    ux1, ux2 = picks[0][0], picks[-1][1]
    tx1 = float(target_box["x_norm"]); tw = float(target_box["w_norm"]); tx2 = tx1 + tw
    if tw <= 0:
        return False
    k = 0.25
    if edges == 'R':                                   # (3) right cut -> value LEFT edge intact
        if not (-g <= (ux1 - tx1) <= k * tw):
            return False
    else:                                              # 'L' -> value RIGHT edge intact
        if not (-k * tw <= (ux2 - tx2) <= g):
            return False
    overlap = min(ux2, tx2) - max(ux1, tx1)            # (4) occupancy floor
    if overlap / tw < 0.6:
        return False
    return True


def _abs_edge_guard(page, target_box, abs_expanded, expansion, abs_text, val_type, field_key,
                    ocr_lines_fn, ocr_text_fn, validation_patterns, format_lookup,
                    provisional_lookup, line_cache, located, slice_capture, page_idx,
                    has_label=True, anchor_name=None):
    """Slice C action contract (007's GROW, Oracle-ruled — full rationale in the
    _ABS_EDGE_GUARD_ON flag block). Returns:
      None                          — no fire / silent-keep (caller continues untouched);
      {'rewrite': (value, conf)}   — clean heal: caller rewrites the rigid surface and the
                                     existing flow (inline reconcile -> commit) continues;
      {'result': <mapping dict>}   — commit directly (grown-but-unproven FLAGGED, or the
                                     capped '_edgecut' fail-toward-review floor).
    The STORED mapping is never touched — only this read's crop grows (C-C3)."""
    # A COMPLETE 4-digit-year date is never a partial: when the abs read CONTAINS one
    # (even junk-wrapped — 'TE 13-02-2026', Stage-4 normalise handles the junk), an edge
    # overhang is word-box overshoot noise (H3) and a grown re-read of noisier ink can
    # only corrupt it ('13-02-2026' -> '13-02-2096' — observed on the scanned clean arm).
    # A clean 2-digit-year read does NOT skip: it may be a cut 4-digit year (the pinned
    # Slice-B trade-off) — geometry is exactly the judge there. Codes have no
    # completeness test — their witness + consent ladder carries them.
    if val_type == 'date' and abs_text and not _date_clip_suspect(abs_text):
        m4 = None
        for m4 in _DATE_CLIP_NUMERIC.finditer(str(abs_text)):
            pass
        if m4 is not None and len(m4.group(3)) == 4:
            return None
    lines = _page_words_cached(page, ocr_lines_fn, line_cache)
    if not lines:
        return None                                   # no geometry -> byte-identical (fail-inert)
    read_box = _expand_box(target_box, expansion) if (abs_expanded and expansion > 0) else target_box
    left_cut, right_cut = _find_edge_cut_words(lines, read_box)
    if left_cut is None and right_cut is None:
        return None

    def _floor():
        """Fail-toward-review, but NEVER pre-empt a later heal: the caller keeps its full
        flow (inline reconcile — the independent witness that heals exactly this class —
        then the commit), and only the FINAL abs commit wears the cap + note. Returning a
        result here amputated the reconcile and turned healable partials into capped
        partials on the clean arm ('PP-808' -> 'QPP-8083' class) — the deferred-cap
        contract is what the t300s->t300c diff bought."""
        _EDGE_GUARD_FIRES.append((field_key, _edges, 'capped'))
        return {"defer_cap": True} if abs_text else None

    _edges = ('L' if left_cut is not None else '') + ('R' if right_cut is not None else '')
    pad = 0.004
    gx1 = float(read_box["x_norm"]); gx2 = gx1 + float(read_box["w_norm"])
    if right_cut is not None:
        gx2 = max(gx2, float(right_cut["x_norm"]) + float(right_cut["w_norm"]) + pad)
    if left_cut is not None:
        nl = float(left_cut["x_norm"]) - pad
        lb = (located or {}).get("label_box") if isinstance(located, dict) else None
        if isinstance(lb, dict):                      # C-C2: never re-absorb the located label
            try:
                nl = max(nl, float(lb["x_norm"]) + float(lb["w_norm"]) + 0.002)
            except (KeyError, TypeError, ValueError):
                pass
        gx1 = min(gx1, nl)
    if (gx2 - gx1) > 2.0 * max(float(target_box["w_norm"]), 1e-9):
        return _floor()                               # merged-word / runaway grow -> no grow
    grown = _clamp_box({"x_norm": gx1, "y_norm": read_box["y_norm"],
                        "w_norm": gx2 - gx1, "h_norm": read_box["h_norm"]})
    _gcap = ((lambda c: slice_capture(field_key, "template_mapping", page_idx,
              (grown["x_norm"], grown["y_norm"], grown["w_norm"], grown["h_norm"]), c, "target"))
             if slice_capture else None)
    _gmeta = {}
    raw = _crop_and_ocr(page, grown, val_type, ocr_text_fn, capture=_gcap, meta=_gmeta)
    gv, g_salv, _ = _gate_value(raw, val_type, field_key, validation_patterns,
                                format_lookup, shape_mode='ignore', ocr_conf=_gmeta.get('conf'))
    if not gv or g_salv:
        return _floor()                               # a salvaged grow is not a proven heal
    # SNAP-UNION GEOMETRY WITNESS (Oracle 2026-08-06, own switch, codes only): does the
    # locate-tier geometry independently reconstruct gv, edge-anchored to the taught slot?
    # If so it stands in for the missing shape history — it SKIPS ONLY the glyph-frag gate
    # below (a garbled clip can't vouch for its own fuller read) and licenses a CLEAN heal at
    # the consent ladder; the negative per-cut-word veto and the `refused` guard still gate.
    witness_ok = (_SNAP_UNION_WITNESS_ON and val_type != 'date'
                  and _snap_union_witness(lines, grown, gx1, gx2, gv, target_box, _edges))
    # Per-type, EDGE-DIRECTIONAL comparator — the cut fragment's edge glyph is untrusted
    # (a half-cut 'C' reads '5'), so the discipline mirrors the cut: a RIGHT cut leaves a
    # PREFIX of the truth (allow one trailing-glyph drop), a LEFT cut leaves a SUFFIX
    # (allow one leading-glyph drop), both cut -> containment with one slack glyph each
    # side. Anything else is a different value (a neighbouring column) -> the floor,
    # never a silent swap. (The first build was prefix-only — it refused the perfect
    # left-cut heal '5S-1108' -> 'CSS-1108' and cratered the j120L arm.)
    def _frag_matches(old, new):
        if not old:
            return False
        variants = [old]
        if len(old) > 1:
            if right_cut is not None:
                variants.append(old[:-1])             # untrusted trailing glyph
            if left_cut is not None:
                variants.append(old[1:])              # untrusted leading glyph
            if left_cut is not None and right_cut is not None:
                variants.append(old[1:-1] if len(old) > 2 else old)
        for v in variants:
            if not v:
                continue
            if right_cut is not None and left_cut is None and new.startswith(v):
                return True
            if left_cut is not None and right_cut is None and new.endswith(v):
                return True
            if left_cut is not None and right_cut is not None and v in new:
                return True
        return False

    if abs_text:
        if val_type == 'currency':
            # Money is right-aligned, so a cut takes LEADING digits: the rigid read must be a strict
            # DIGIT-SUFFIX of the grown value and the grown value must carry MORE integer digits.
            # Digits-only so a stray currency symbol, comma or space cannot decide it. This is the
            # mirror of the code leg's prefix rule, and it is what makes '0,603.44' -> '10,603.44'
            # provable rather than plausible: '1060344'.endswith('060344').
            _do = re.sub(r'[^0-9]', '', str(abs_text))
            _dn = re.sub(r'[^0-9]', '', str(gv))
            _int_o = re.sub(r'[^0-9]', '', str(abs_text).split('.')[0])
            _int_n = re.sub(r'[^0-9]', '', str(gv).split('.')[0])
            if not (_do and _dn and _dn != _do and _dn.endswith(_do) and len(_int_n) > len(_int_o)):
                return _floor()
        elif val_type == 'date':
            do = re.sub(r'[^0-9]', '', _strip_code_edges(str(abs_text)))
            dn = re.sub(r'[^0-9]', '', str(gv))
            if not (do and len(dn) > len(do) - 1 and _frag_matches(do, dn)):
                return _floor()
        else:
            co = _code_norm(_strip_code_edges(str(abs_text)))
            cn = _code_norm(_strip_code_edges(str(gv)))
            # witness_ok skips ONLY this glyph-frag gate (Oracle §3 seam): a garbled clip
            # ('vino0u5d') shares no glyphs with the true grown read ('dn58038'), so frag
            # cannot rescue it — the independent geometry does. Everything downstream (the
            # negative cut-word veto, the consent ladder incl. `refused`) still runs.
            if not witness_ok and not (co and len(cn) > len(co) - 1 and _frag_matches(co, cn)):
                return _floor()
    # INDEPENDENT-WITNESS corroboration (the owner kernel rule: a heal files without
    # review only when corroborated by an independent-GEOMETRY read): the locate-pass
    # word text (~120-DPI recipe) is a different OCR tier from the full-res ladder that
    # produced `gv` — every cut word the grow ABSORBED must have its text CONTAINED in
    # the grown value, else the grow re-read corrupted the extension ('13-02-2026' word
    # -> grown '13-02-2096'; 'PO-49938' -> 'POH-49938' — the scanned clean-arm class)
    # and the heal falls through (defer_cap: the reconcile may still heal; the final abs
    # commit wears the cap). SCOPE (live Larkspur exhibit, 2026-08-05): a cut word the
    # grow did NOT absorb — a left-cut label tail ('No.') deliberately excluded by the
    # label bound, or a word dropped by the width cap — makes no claim in `gv` and must
    # not veto it; only words substantially inside the GROWN box are the grow's claim.
    # A garbled locate word still downgrades a GOOD heal — the safe direction (review,
    # never a silent wrong value).
    for _cw in (left_cut, right_cut):
        if _cw is None:
            continue
        try:
            _wx1 = float(_cw["x_norm"]); _ww = float(_cw["w_norm"])
        except (KeyError, TypeError, ValueError):
            continue
        _ins = max(0.0, min(gx2, _wx1 + _ww) - max(gx1, _wx1))
        if _ww <= 0 or _ins / _ww < 0.9:
            continue                                  # not absorbed -> not the grow's claim
        _wt = _code_norm(str(_cw.get("text") or ""))
        if _wt and _wt not in _code_norm(str(gv)):
            return _floor()
    # Consent: dates self-consent on a complete, un-suspect parse (self-validating type —
    # learned-shape stats never veto a real calendar date); codes take the shared ladder.
    if val_type == 'currency':
        # Self-validating like a date: the comparator above already proved the grown value is the
        # SAME number with its leading digits restored, so a well-formed money value consents. The
        # learned-shape ladder is the wrong judge here — money magnitudes legitimately vary per
        # document, so a 5-digit total against a history of 4-digit ones is not an anomaly.
        _g = str(gv).strip()
        consent = 'confirmed' if re.fullmatch(r'[^0-9]{0,3}[0-9][0-9,\s]*(?:\.[0-9]{1,2})?', _g) else 'none'
    elif val_type == 'date':
        try:
            from extraction.validator import parse_date
            consent = 'confirmed' if (not _date_clip_suspect(gv) and parse_date(gv)) else 'none'
        except Exception:
            consent = 'none'
    else:
        consent = _shape_consents(gv, field_key, format_lookup, provisional_lookup)
    # A snap-union geometry witness is a GEOMETRIC provisional consent: it clean-heals the
    # no-history (teach-once) case the ladder would otherwise flag ≤70. It NEVER overrides a
    # `refused` shape (that branch below still wins — the deliberate sub-token teach).
    if consent in ('confirmed', 'provisional') or (witness_ok and consent == 'none'):
        _EDGE_GUARD_FIRES.append((field_key, _edges,
                                  'healed_witness' if consent == 'none' else 'healed'))
        return {"rewrite": (gv, _gmeta.get('conf'))}
    if consent == 'refused':
        # Deliberate-sub-token-teach protection: a confirmed history in the SUB-token shape
        # means the operator meant the cut — keep the rigid read silently, no flag, no nag.
        _EDGE_GUARD_FIRES.append((field_key, _edges, 'refused'))
        return None
    # No history either way: the fuller value goes to review pre-filled (cheapest correction).
    _EDGE_GUARD_FIRES.append((field_key, _edges, 'flagged'))
    r = _mapping_result(gv, has_label, False, False, anchor_name or field_key,
                        val_type=val_type, ocr_conf=_gmeta.get('conf'))
    r["confidence"] = min(r["confidence"], 70)
    r["method"] += "_edgegrow"
    r["validation_note"] = _EDGE_CUT_NOTE
    return {"result": r}


def _locate_anchor(page, anchor_box, anchor_text, expansion, ocr_lines_fn,
                   min_search=0.0, capture=None, line_cache=None, confirm_value=None):
    """
    Search the (optionally expanded) drawn anchor region for the stored label
    text and report where it ACTUALLY sits on this page, in page-relative
    normalised coordinates. Returns None when nothing usable is found there —
    the caller's documented signal to fall back to the rest of the pipeline.

    `min_search` floors the search margin (used by callers even when the mapping
    stored no search_expansion) so a tight/misaligned box or a shifted scan still
    finds its label; it widens only WHERE we search — the located position and the
    fuzzy threshold are unchanged, so a wrong nearby label is still rejected.

    `line_cache` (optional, supplied by the orchestrators) memoises the OCR of a
    given crop region by (page, crop_box). Every PAGE-WIDE locate (expansion ≥ 1.0)
    expands+clamps to the SAME full-page crop_box (0,0,1,1) regardless of anchor, so
    without this each landmark-fit and each per-field relocation re-ran a full-page
    image_to_data (~2s each). Caching collapses them to ONE pass per page. The OCR is
    deterministic for a given crop, so reuse is exactly equivalent — read quality is
    unchanged. Skipped when `capture` is set (dev slice trace stays byte-identical).
    """
    eff = max(expansion, min_search)
    search_box = _expand_box(anchor_box, eff) if eff > 0 else dict(anchor_box)
    crop_box = _clamp_box(search_box)
    cache_key = None
    if line_cache is not None and capture is None:
        cache_key = (id(page), round(crop_box["x_norm"], 4), round(crop_box["y_norm"], 4),
                     round(crop_box["w_norm"], 4), round(crop_box["h_norm"], 4))
    if cache_key is not None and cache_key in line_cache:
        lines = line_cache[cache_key]
    else:
        crop = _crop(page, crop_box)
        if crop is None:
            return None
        if capture:
            try: capture(crop)
            except Exception: pass   # dev-only slice capture; never disrupt relocation
        lines = ocr_lines_fn(crop)
        if cache_key is not None:
            line_cache[cache_key] = lines
    if not lines:
        return None

    needle = _normalise(anchor_text) if anchor_text else None
    scored = []
    for line in lines:
        haystack = _normalise(line.get("text", ""))
        if not haystack:
            continue
        scored.append((_label_score(needle, haystack), line))

    if not scored:
        return None
    best_score = max(s for s, _ in scored)
    if needle and best_score < _FUZZY_MATCH_THRESHOLD:
        return None

    # Among EQUALLY-best candidates, prefer the one closest to the original anchor
    # position. For a unique best match this is a no-op (it wins on score, even if
    # the scan shifted it far). It matters only when a label REPEATS on the page
    # with the SAME score: without this a page-wide search could lock onto a far
    # duplicate; with it, the nearest true label is chosen. Only EXACT score ties
    # are decided by proximity — a higher score ALWAYS wins, so a lower-scoring but
    # marginally-closer WRONG label (e.g. "Ticket Type" 0.70 vs "Ticket No." 0.75)
    # can never be picked.
    acx = anchor_box["x_norm"] + anchor_box["w_norm"] / 2.0
    acy = anchor_box["y_norm"] + anchor_box["h_norm"] / 2.0

    def _page_dist(ln):
        cx = crop_box["x_norm"] + (ln["x_norm"] + ln["w_norm"] / 2.0) * crop_box["w_norm"]
        cy = crop_box["y_norm"] + (ln["y_norm"] + ln["h_norm"] / 2.0) * crop_box["h_norm"]
        return math.hypot(cx - acx, cy - acy)

    floor = max(best_score - _SCORE_TIE_EPSILON, (_FUZZY_MATCH_THRESHOLD if needle else 0.0))
    candidates = [(s, ln) for s, ln in scored if s >= floor]
    # VALUE-AGREEMENT: when the caller passes a trustworthy rigid read (confirm_value),
    # prefer the label occurrence whose LINE actually carries that value — even a
    # LOWER-scoring one. A section header "Item Information" scores 1.0 but its
    # neighbour is "Information"; the real row "ttem 1102V03NL1" scores only 0.75
    # (OCR garbled the "Item" label to "ttem") yet carries the taught value. Value
    # agreement is stable where the label OCR is not, so this beats any geometric
    # tie-break. Restricted to fuzzy-threshold occurrences; if NONE carry the value
    # (a genuinely DRIFTED rigid read isn't beside any label — the case the label-lock
    # exists to fix), selection is unchanged and relocation proceeds as before.
    if confirm_value:
        cv = _normalise(str(confirm_value))
        carriers = [(s, ln) for s, ln in scored
                    if s >= _FUZZY_MATCH_THRESHOLD and cv and cv in _normalise(ln.get("text", ""))]
        if carriers:
            candidates = carriers
    chosen_score, best = min(candidates, key=lambda sl: (_page_dist(sl[1]), -sl[0]))

    # Recover the matched LABEL's own sub-box from the line's word boxes, plus any
    # VALUE sharing the line. A key/value row OCRs as "label …gap… value" on ONE
    # line, so the line box (returned in x/y/w/h below) spans BOTH — using it for
    # geometric placement seats the value crop past the value. label_box restores
    # correct geometry (value to the right of the LABEL, not the line) and
    # inline_value lets the caller harvest the value straight off the located line
    # (the only reliable read when the value sits in a far column, not adjacent).
    # Additive: callers that ignore these keys behave exactly as before.
    label_box = None
    inline_value = None
    inline_box = None
    bwords = best.get("words") or []
    _lm = _match_label_run(bwords, needle) if needle else None
    if _lm:
        run, _lend = _lm
        rx1 = min(wd["x_norm"] for wd in run)
        rx2 = max(wd["x_norm"] + wd["w_norm"] for wd in run)
        ry1 = min(wd["y_norm"] for wd in run)
        ry2 = max(wd["y_norm"] + wd["h_norm"] for wd in run)
        label_box = {
            "x_norm": crop_box["x_norm"] + rx1 * crop_box["w_norm"],
            "y_norm": crop_box["y_norm"] + ry1 * crop_box["h_norm"],
            "w_norm": (rx2 - rx1) * crop_box["w_norm"],
            "h_norm": (ry2 - ry1) * crop_box["h_norm"],
        }
        # Clip the harvest to the value's OWN column (drop a far heading/column that
        # shares the OCR line) by horizontal-gap clustering off the label's right edge.
        # Value words are those AFTER the label run's END index — not len(run): the run
        # can start internally on a merged two-column row, so bwords[len(run):] would
        # re-include the label's own words.
        rest = cluster_value_words(bwords[_lend:], expect_x=rx2)
        if rest:
            inline_value = " ".join(wd["text"] for wd in rest).strip() or None
            # Page-space bbox of the VALUE words (crop-relative → page), so the dev
            # trace can highlight where an inline-harvested value was actually read.
            vx1 = min(wd["x_norm"] for wd in rest)
            vx2 = max(wd["x_norm"] + wd["w_norm"] for wd in rest)
            vy1 = min(wd["y_norm"] for wd in rest)
            vy2 = max(wd["y_norm"] + wd["h_norm"] for wd in rest)
            inline_box = {
                "x_norm": crop_box["x_norm"] + vx1 * crop_box["w_norm"],
                "y_norm": crop_box["y_norm"] + vy1 * crop_box["h_norm"],
                "w_norm": (vx2 - vx1) * crop_box["w_norm"],
                "h_norm": (vy2 - vy1) * crop_box["h_norm"],
            }

    return {
        "x_norm":       crop_box["x_norm"] + best["x_norm"] * crop_box["w_norm"],
        "y_norm":       crop_box["y_norm"] + best["y_norm"] * crop_box["h_norm"],
        "w_norm":       best["w_norm"] * crop_box["w_norm"],
        "h_norm":       best["h_norm"] * crop_box["h_norm"],
        "matched_text": best.get("text") if needle else None,
        "match_score":  chosen_score,
        "label_box":    label_box,
        "inline_value": inline_value,
        "inline_box":   inline_box,
    }


# ── Geometry helpers (pure — independently unit-testable) ────────────────────

def _norm_box(mapping, prefix):
    keys = (f"{prefix}_x_norm", f"{prefix}_y_norm", f"{prefix}_w_norm", f"{prefix}_h_norm")
    values = [mapping.get(k) for k in keys]
    if any(v is None for v in values):
        return None
    x, y, w, h = (float(v) for v in values)
    return {"x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}


def _box_list(box):
    """A box dict → the [x, y, w, h] normalised list resolve_geometry's overlay
    expects (rounded to match captured.get('target')). Used to carry the WINNING
    rung's actual read box out on the result (`target_geom`) for the admin preview,
    so the diagnostic box reflects what really won — not the last rung that merely
    captured a (possibly rejected) crop. Returns None for a missing box."""
    if not box:
        return None
    return [round(float(box["x_norm"]), 5), round(float(box["y_norm"]), 5),
            round(float(box["w_norm"]), 5), round(float(box["h_norm"]), 5)]


def _expand_box(box, fraction):
    """Grow a box by `fraction` of the page in every direction, clamped to [0,1]."""
    if not fraction:
        return dict(box)
    x0 = max(0.0, box["x_norm"] - fraction)
    y0 = max(0.0, box["y_norm"] - fraction)
    x1 = min(1.0, box["x_norm"] + box["w_norm"] + fraction)
    y1 = min(1.0, box["y_norm"] + box["h_norm"] + fraction)
    return {"x_norm": x0, "y_norm": y0, "w_norm": max(0.0, x1 - x0), "h_norm": max(0.0, y1 - y0)}


def _clamp_box(box):
    x = _clamp01(box["x_norm"])
    y = _clamp01(box["y_norm"])
    w = max(0.0, min(1.0 - x, box["w_norm"]))
    h = max(0.0, min(1.0 - y, box["h_norm"]))
    return {"x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}


def _clamp01(value):
    return max(0.0, min(1.0, value))


def _normalise(text):
    return re.sub(r'\s+', ' ', (text or '')).strip().lower()


def _label_score(needle, haystack):
    """How well the anchor LABEL (`needle`) is present in an OCR line
    (`haystack`), independent of how much extra text the line carries.

    SequenceMatcher.ratio() penalises a longer haystack (2·M/(len_n+len_h)), so
    an anchor box drawn deliberately wider than its label — capturing padding or
    a neighbouring word on the same OCR line — scored below threshold and failed
    to relocate, even on a perfect label match. Instead, measure the fraction of
    the needle found as a contiguous run in the haystack (a substring scores
    1.0), blended with ratio() so a tight exact line still scores high. A
    different nearby label shares little of the needle, so it stays rejected —
    preferring the correct local label without widening the search.

    WORD-BOUNDARY GUARD: plain substring containment is too loose — "total" sits
    inside "subtotal", "date" inside "mandate", "amount" inside "amount due" — so
    a short label would score a PERFECT 1.0 on a DIFFERENT, longer on-page label
    and, on the resulting score tie, be chosen by mere PROXIMITY, silently
    relocating e.g. a Total anchor onto the Subtotal row (variable line-item
    layouts float the totals block, so which is nearer flips per document). A
    whole-needle occurrence counts only when it is NOT glued to a surrounding
    alphanumeric — the same (?<![a-z0-9])…(?![a-z0-9]) guard keyword._label_pattern
    uses. A needle that appears ONLY as a glued sub-token is rejected OUTRIGHT
    (0.0) so its incidental character overlap can't sneak past the threshold via
    ratio() when the real standalone label is absent. This also closes the second
    false-1.0 path: find_longest_match's whole-needle run only reaches 1.0 when
    the needle is a substring, which is now handled here first. A genuine
    boundary-aligned prefix ("serial" of "serial number") still scores 1.0.
    """
    if not needle:
        return 1.0
    # A taught label usually keeps its trailing caption punctuation ("Total:"), but OCR may
    # or may not read the colon. A colon-glued needle DEFEATS the word-boundary guard below
    # when the separator is dropped: "total:" scores a fuzzy 0.83 on BOTH "total" AND
    # "subtotal", tying → proximity silently relocates a Total anchor onto the Subtotal row.
    # Strip the needle's EDGE caption punctuation (but keep a bare "#") so the boundary guard
    # is robust to however OCR read the colon — "total:" → "total" → "subtotal" scores 0.0.
    _core = re.sub(r'^[^a-z0-9#]+|[^a-z0-9#]+$', '', needle)
    if _core:
        needle = _core
    if not haystack:
        return 0.0
    # Boundary-aligned occurrence of the whole needle = a true label hit. A boundary guard
    # beside a NON-alnum needle edge is vacuous-wrong: '#' IS its own boundary, so a
    # '#'-terminal taught label ("so #") must still hit a value-glued row ("so #12345") —
    # without this conditionality the `needle in haystack` branch below rejected it outright
    # (reggie, 2026-07-10). Alnum-edged needles keep both guards — byte-identical.
    _pre  = r'(?<![a-z0-9])' if needle[:1].isalnum() else ''
    _post = r'(?![a-z0-9])'  if needle[-1:].isalnum() else ''
    if re.search(_pre + re.escape(needle) + _post, haystack):
        return 1.0
    # Slice D digit-exactness (see _LABEL_DIGIT_EXACT_ON flag block): a digit-dominant
    # needle's digit sequence is its identity — absent from the haystack's digits, no
    # amount of separator/ratio similarity may score it ('03-06-2026' vs '07-01-2026').
    if _LABEL_DIGIT_EXACT_ON:
        _nd = re.sub(r'[^0-9]', '', needle)
        _na = re.sub(r'[^a-z0-9]', '', needle)
        if len(_nd) >= 4 and _na and len(_nd) / len(_na) >= 0.5 \
                and _nd not in re.sub(r'[^0-9]', '', haystack):
            return 0.0
    # Present, but glued inside a larger token (sub|total) → a false label. Reject
    # so it can neither win a 1.0 tie nor pass threshold on shared characters.
    if needle in haystack:
        return 0.0
    sm = difflib.SequenceMatcher(None, needle, haystack)
    longest = sm.find_longest_match(0, len(needle), 0, len(haystack)).size
    return max(longest / len(needle), sm.ratio())


# ── Image / OCR primitives ────────────────────────────────────────────────────

def _crop(page, box):
    try:
        w, h = page.size
        x1 = int(box["x_norm"] * w)
        y1 = int(box["y_norm"] * h)
        x2 = int((box["x_norm"] + box["w_norm"]) * w)
        y2 = int((box["y_norm"] + box["h_norm"]) * h)
        if x2 <= x1 or y2 <= y1:
            return None
        return page.crop((x1, y1, x2, y2))
    except Exception:
        return None


def _prep(image):
    """
    Same greyscale -> upscale -> autocontrast -> sharpen recipe as
    ocr/region.py and anchor._crop_and_ocr, so OCR behaviour stays consistent
    across every crop-and-read path in the system.
    """
    img = image.convert("L")
    w, h = img.size
    if w < 300:
        scale = max(2, 300 // max(1, w))
        img = img.resize((w * scale, h * scale), Image.LANCZOS)
    else:
        img = img.resize((w * 2, h * 2), Image.LANCZOS)
    img = ImageOps.autocontrast(img, cutoff=2)
    return img.filter(ImageFilter.SHARPEN)


def _ocr_text(image):
    if pytesseract is None:
        return None
    try:
        img = _prep(image)
        text = pytesseract.image_to_string(img, config="--oem 3 --psm 7").strip()
        if not text:
            text = pytesseract.image_to_string(img, config="--oem 3 --psm 6").strip()
        return text or None
    except Exception:
        return None


def _prep_for_lines(image):
    """Prep for the LOCATE (image_to_data line/word boxes) — distinct from _prep, which
    is tuned for reading a small value CROP and UPSCALES x2. The locate routinely runs on
    the WHOLE page, where x2 balloons a 2481px page to ~4962px and image_to_data takes
    ~3.8s. Position-finding only needs enough resolution to MATCH the label/landmark text
    and return NORMALISED boxes, so CAP the width (~1100px ≈ 120 DPI for A4): the full-page
    locate finds the SAME lines in well under half the time (the dominant per-doc cost on
    import AND reprocess). A small region is upscaled so a short label still reads. Boxes
    are normalised to the prepped size in _ocr_lines, so the downscale is geometry-neutral.
    Greyscale + autocontrast, no sharpen (matches the light read)."""
    img = image.convert("L")
    w, h = img.size
    _MAX, _MIN = 1100, 600
    if w > _MAX:
        s = _MAX / w
        img = img.resize((_MAX, max(1, int(h * s))), Image.LANCZOS)
    elif w < _MIN:
        s = max(2, _MIN // max(1, w))
        img = img.resize((w * s, h * s), Image.LANCZOS)
    return ImageOps.autocontrast(img, cutoff=2)


def _ocr_lines(image):
    """
    OCR the crop and group word-level results (image_to_data) into lines by
    (block, paragraph, line), each with crop-relative normalised bounding
    boxes: [{"text","x_norm","y_norm","w_norm","h_norm"}]. Multi-word labels
    like "Invoice Number" then match as a single unit instead of fragmenting.

    Uses _prep_for_lines (caps the width) NOT _prep (x2 upscale): the locate is the
    dominant per-doc OCR cost and only needs to find positions, so it reads a
    width-capped page in <half the time with the same lines. Boxes are normalised to
    the prepped image size below, so the cap is geometry-neutral.
    """
    if pytesseract is None:
        return []
    try:
        img = _prep_for_lines(image)
        w, h = img.size
        if w == 0 or h == 0:
            return []
        data = pytesseract.image_to_data(img, config="--oem 3 --psm 6", output_type=Output.DICT)
    except Exception:
        return []

    groups = {}
    for i in range(len(data.get("text", []))):
        word = (data["text"][i] or "").strip()
        if not word:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        x, y = data["left"][i], data["top"][i]
        ww, hh = data["width"][i], data["height"][i]
        x2, y2 = x + ww, y + hh
        wd = {"text": word, "_x": x, "_y": y, "_w": ww, "_h": hh}
        g = groups.get(key)
        if g is None:
            groups[key] = {"words": [wd], "x1": x, "y1": y, "x2": x2, "y2": y2}
        else:
            g["words"].append(wd)
            g["x1"] = min(g["x1"], x)
            g["y1"] = min(g["y1"], y)
            g["x2"] = max(g["x2"], x2)
            g["y2"] = max(g["y2"], y2)

    lines = []
    for g in groups.values():
        # Per-word boxes (crop-relative normalised) are kept ALONGSIDE the line
        # box so a caller can recover the matched LABEL's own sub-box instead of
        # the whole "label …gap… value" line. Additive — existing line-level keys
        # are unchanged.
        words = [{"text": wd["text"], "x_norm": wd["_x"] / w, "y_norm": wd["_y"] / h,
                  "w_norm": wd["_w"] / w, "h_norm": wd["_h"] / h} for wd in g["words"]]
        lines.append({
            "text":   " ".join(wd["text"] for wd in g["words"]),
            "x_norm": g["x1"] / w,
            "y_norm": g["y1"] / h,
            "w_norm": (g["x2"] - g["x1"]) / w,
            "h_norm": (g["y2"] - g["y1"]) / h,
            "words":  words,
        })
    return lines


def _crop_and_ocr(page, box, val_type, ocr_text_fn, capture=None, meta=None):
    crop = _crop(page, _clamp_box(box))
    if crop is None:
        return None
    if capture:
        try: capture(crop)
        except Exception: pass   # dev-only slice capture; never disrupt OCR
    # The IMAGE-OCR read now goes through the SAME light-first ladder anchor.py and
    # region.py use (Oscar): the unconditional heavy autocontrast+SHARPEN recipe was
    # mangling clean printed lines (a company name -> punctuation soup) — Stage 0.5 was
    # the last crop path still on the heavy-only recipe. The ladder also writes the real
    # OCR confidence into `meta` so _mapping_result can shape it instead of a synthetic
    # constant. A CUSTOM reader (a test stub, or a future text-layer fn) keeps the legacy
    # path untouched, so existing mapping tests are unaffected.
    if ocr_text_fn is _ocr_text:
        try:
            # Pass the page + the (clamped) drawn box so the ladder's free-text preview
            # fast-path can re-crop at the ~108 DPI preview scale the draw tool reads.
            return _ocr_crop_laddered(crop, val_type, verify_fn=None, meta=meta,
                                      page=page, box=_clamp_box(box)) or None
        except Exception:
            return None
    text = ocr_text_fn(crop)
    if not text:
        return None
    cleaned = _clean_value(text, val_type)
    # Same single-token separator repair the Stage 2 anchor crop uses: a serial /
    # reference read as one token can come back with a spurious "/" "\" "|"; re-read
    # the prepped crop as a single word and keep it only if the glyphs are otherwise
    # identical. Reuses anchor._repair_single_token (already cross-imported) so both
    # crop paths behave the same. No-op for multi-word values and date fields, and
    # safe under test stubs (it try/excepts when the crop isn't a real image).
    if cleaned:
        try:
            cleaned = _repair_single_token(_prep(crop), cleaned, val_type)
        except Exception:
            pass
    return cleaned


def _clean_value(text, val_type):
    """Delegates to the SHARED anchor.clean_crop_segment so a drawn target zone is
    cleaned identically to a learned-anchor crop (column-gap split, shape-aware
    postcode/year trim for free-text, trailing-city-comma cut) — one rule across
    both crop paths. See clean_crop_segment for the per-rule rationale."""
    return clean_crop_segment(text, val_type)
