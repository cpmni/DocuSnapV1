"""
extraction/engine.py
--------------------
Orchestrates the extraction pipeline across two modes:

  FAST  — keyword + anchor only. Sub-second per document.
           Used when supplier is well-trained.

  SMART — keyword + anchor only, same as FAST. Default mode.
           (Kept distinct from FAST for future use.)

Usage:
  engine = ExtractionEngine(mode='smart', ...)
  result = engine.extract(...)
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction import keyword, anchor, validator, ocr_corrector, template_matcher, template_mapper, format_anomaly_checker, value_quality, wordness

# Identity-fusion (text-led SUPPLIER identity) is optional — it needs rapidfuzz, which is
# not yet in the bundled runtime. Used ONLY by the shadow measurement (extract(identity_
# shadow=True)); when absent the shadow silently disables and extraction is unaffected.
try:
    from extraction import identity_fusion
    IDENTITY_FUSION_AVAILABLE = True
except Exception:
    IDENTITY_FUSION_AVAILABLE = False

# "Multiple commits determine it's OK" fallback for the identity-conflict flag: once the RESOLVED
# supplier has been learned this many times (logo match_count / hint / anchor usage_count), a
# letterhead name that merely matches ANOTHER known supplier (recipient/customer/printer in the
# header) no longer raises the conflict — the established issuer is trusted. A new supplier still flags.
IDENTITY_ESTABLISHED_MIN = 3


# Stage 0.5 LOCATED-path mapping methods (admin-drawn anchor→target zones that
# located their anchor on this page). Curated ground truth — protected from
# keyword demotion and from a stale taught-anchor clobber. The "_salvaged"
# variants are the SAME located mappings whose date value was rescued via
# validator.salvage_date (Fix C1); they carry identical provenance and so get
# identical protection. The weaker DRIFT-path variants are deliberately excluded
# (unchanged): a fixed-coordinate drift seed is not strong enough to be shielded.
# Minimum substantial-word OCR confidence for an authoritative ⊕ anchor's CROP
# read to win Tier-A OUTRIGHT (engine.extract). Below this the read carries a
# garbled word and must instead contend on confidence, where its OCR-capped score
# loses to a clean alternative. 70 keeps confidently-read teaches winning while
# rejecting the partial-garble case (min word conf ~55) the mean alone misses.
_TIER_A_OCR_MIN = 70

# Reconciliation-aware total pick: a balancing CANDIDATE must be at least this confident to replace
# a non-balancing total, so a weak/garbage read can't win on maths alone (the real keyword total
# reads ~88-93). See _reconciliation_pick_total.
_RECON_PICK_MIN_CONF = 70

# The supplier IDENTITY fields — their VALUE is the learning scope key, so a GLOBAL ('' supplier)
# format aggregates DIFFERENT suppliers and must never constrain them (see the fmt_entry fallback
# in the Stage 4.5 loop). Mirrors COMPANY_KEYS in database/modules/document_types.js.
_IDENTITY_FIELD_KEYS = frozenset({"supplier_name", "customer_name"})

# IDENTITY RESCUE kill-switch (Oracle-signed slice 1, 2026-07-10; ocr_corrector's
# SNAP_ALLOW_SUBSTITUTION precedent — a module constant, no settings plumbing: the
# forced-review construction below is the real safety). Slice 2 (graduating a rescue
# past review at higher hint usage) is expressly NOT covered by that sign-off.
IDENTITY_RESCUE_ENABLED = True

# Stage 2.6 LATE-ANCHOR RESCUE kill switch + confidence ceiling (2026-07-10): when the
# supplier was UNRESOLVED at Stage-2 time and Stage 2.5a then resolves it from text, the
# supplier's OWN positional anchors (invisible to Stage 2 — _anchor_matches only admits
# named-supplier positional anchors on a supplier match) get one fill-empty-only re-run.
# The 85 cap mirrors the text-scan supplier premise's own cap and sits below the 88
# critical-field auto-file floor. See the Stage 2.6 block in extract().
LATE_ANCHOR_RESCUE_ENABLED = True
_LATE_RESCUE_CAP = 85

# Stage-4.5 GATE-FAILURE RE-READ kill switch (2026-07-11; DEFAULT ON — the old "ships DARK"
# note was stale). When a structured value is WITHHELD on format grounds (value=None), take ONE
# bounded second look: locate the garble on the page, tight-crop re-read via the crop ladder, and
# adopt ONLY a read that passes the exact gate the original failed (ocr.targeted_reread.is_adoptable).
# An adopted read is REVIEW-BOUND (cap 69 + note) — EXCEPT the NORMALISATION-ONLY case (Oracle-signed
# 2026-07-23, GATE_REREAD_CLEAN_ACCEPT below): when the re-read agrees with the original on every
# alphanumeric character (and, for dates, on the CALENDAR date), the "correction" is spacing/
# separator/case only — two independent reads agreeing on the content — so it files clean, un-noted.
# See _maybe_gate_reread + _reread_is_normalisation_only
# + docs/designs/REREAD_ESCALATION_DESIGN_2026-07-11.md.
GATE_REREAD_ENABLED = os.environ.get('GATE_REREAD', '1') != '0'   # default ON; GATE_REREAD=0 disables
_REREAD_CAP = 69
# =0: every adopted re-read is review-bound again (the pre-2026-07-23 posture) — byte-identical legacy.
GATE_REREAD_CLEAN_ACCEPT = os.environ.get('GATE_REREAD_CLEAN_ACCEPT', '1') != '0'


def _reread_is_normalisation_only(garble, adopted, val_type) -> bool:
    """True when a gate-reread's adopted value differs from the original garble ONLY by
    normalisation — spacing/separators/case — i.e. the two reads AGREE on every alphanumeric
    character (the 0-edit subset of targeted_reread's kinship band). For DATE fields the core
    match is NOT sufficient (separator POSITION is semantic: '1/12/2026' vs '11/2/2026' share
    the core '1122026' but are different days — Oracle C1), so dates additionally require BOTH
    sides to PARSE and be CALENDAR-EQUAL; an unparseable side ⇒ not clean. A non-date field
    where both sides nevertheless parse as dates gets the same calendar bar. Any error ⇒ False
    (fail toward the review-bound path). Pure — pinned by test_gate_reread_clean.py."""
    try:
        from ocr.targeted_reread import _alnum
        g, a = str(garble or ''), str(adopted or '')
        ga, aa = _alnum(g), _alnum(a)
        if not ga or ga != aa:
            return False
        gp = validator.parse_date(g)
        ap = validator.parse_date(a)
        if val_type == 'date':
            return gp is not None and ap is not None and gp.date() == ap.date()
        if gp is not None and ap is not None:
            return gp.date() == ap.date()   # date-shaped content on any field: same calendar bar
        return True
    except Exception:
        return False

# c2 TAUGHT-FIELD OWNERSHIP GUARD kill switch (2026-07-11, DIRECTION_SUPREMACY): a NON-identity
# field whose FINAL read is a plain 'keyword' match, while the user AUTHORITATIVELY taught that
# field's position for this scope (a ⊕ anchor with last_authoritative_at), is a generic-caption
# keyword stand-in for a taught position that couldn't be confirmed on this page → cap to review
# (69) + note. HOLD-ONLY (value never touched). See _flag_taught_field_ownership.
TAUGHT_FIELD_OWNERSHIP_ENABLED = os.environ.get('TAUGHT_FIELD_OWNERSHIP', '1') != '0'
# CORROBORATION EXEMPTION (2026-07-15, gary+Oracle SIGN-OFF-WITH-CONDITIONS): the ownership cap is
# DECLINED when the taught position ITSELF corroborated the value — a same-field candidate that is
# authoritative (the ⊕ teach) OR genuinely located OR a Stage-0.5 mapping read the EXACT SAME non-
# caption value the keyword winner did (two independent sources agree → not a generic-caption stand-in).
# Oracle C1: a BLIND non-authoritative anchor (passive/__global__/Stage-2.6 late-rescue) may NOT vouch.
# Own sub-switch so it A/Bs and rolls back independently of the c2 guard.
TAUGHT_OWNERSHIP_CORROBORATE = os.environ.get('TAUGHT_OWNERSHIP_CORROBORATE', '1') != '0'


def _late_rescue_applicable(s2_supplier, supplier_name):
    """Stage-2.6 gate (pure, unit-pinned): rescue ONLY when Stage 2 ran with NO supplier
    (template/logo gave nothing — `s2_supplier` is the value the anchor stage was CALLED
    with) and a plausible supplier is resolved NOW. The resolution source can be the 2.5a
    hint text-scan, the post-Stage-2 promotion of a Stage-1 keyword identity, OR a located
    identity-ANCHOR read promoted the same way (Oracle C4: the aperture is any
    results['supplier_name'] promotion) — the same seam in every case: Stage 2 ran blind.
    A supplier that Stage 2 already SAW gates the rescue OFF: wrong-then-corrected identity
    is a different, riskier class, deliberately out of scope."""
    from extraction import keyword as _kw
    return (not s2_supplier) and _kw._is_plausible_supplier_name(supplier_name)

# The resolved-identity ORIGINS a rescue may corroborate against: structural sources
# (logo / template identity / fixed values / template anchor). keyword- and
# hint-derived identities are excluded — corroborating a hint with a hint-derived
# identity would be single-source evidence.
_IDENTITY_STRUCTURAL_METHODS = frozenset({
    'logo', 'template_identity', 'template_fixed', 'template_fixed_locked', 'template_anchor',
})

_STAGE05_LOCATED_METHODS = (
    "template_mapping", "template_mapping_expanded",
    "template_mapping_salvaged", "template_mapping_expanded_salvaged",
    # P4 "register, then read" rung — a target box mapped through the per-page
    # registration transform. Same curated-ground-truth provenance as a located
    # mapping, so it gets the same keyword-demotion / stale-anchor-clobber guards.
    "template_registration", "template_registration_expanded",
    "template_registration_salvaged", "template_registration_expanded_salvaged",
)


def _is_stage05_located(method: str | None) -> bool:
    """True for ANY Stage 0.5 located-mapping method — the absolute fast-path read,
    the registration/relocation rungs, and their `_salvaged` / `_shapewarn` suffix
    variants. Prefix-based so every present and future suffix combination (e.g.
    template_mapping_shapewarn, template_registration_expanded_shapewarn) gets the
    SAME protection: keyword can't demote it (Stage 1) and a non-authoritative
    auto-anchor can't clobber it (Stage 2). Note template_matcher's generic
    `template_fixed` / `template_anchor` deliberately DON'T match — they are the
    auto-learned rules a manual mapping exists to override, not located mappings."""
    return bool(method) and (method.startswith("template_mapping")
                             or method.startswith("template_registration"))


def _identity_key_for_type(field_defs: list[dict]) -> str | None:
    """The single IDENTITY (Document Issuer) field key FOR THIS TYPE — supplier_name when the
    type carries one, else customer_name, else None. Mirrors COMPANY_KEYS precedence
    (database/modules/document_types.js) and the _flag_recipient_caption_issuer derivation:
    post-migration-44 every type's identity/scope key is supplier_name, and a customer_name
    that co-exists on a dual-key type is an ordinary RECIPIENT field, NOT the issuer. Derived
    PER-TYPE deliberately — do NOT reuse the module frozenset _IDENTITY_FIELD_KEYS (it still
    lists BOTH keys, so it would treat a recipient customer_name as identity)."""
    keys = {f.get('key') for f in (field_defs or [])}
    if 'supplier_name' in keys:
        return 'supplier_name'
    if 'customer_name' in keys:
        return 'customer_name'
    return None


def _is_positional_identity_read(method: str | None) -> bool:
    """True for an identity read placed by landmark GEOMETRY alone — method ``anchor_registration``,
    the "register, then read" rung (anchor.py:937-967) that positions its target box via the
    per-page landmark transform and clears only a credibility/format gate, WITHOUT ever locating
    this field's own caption. It is the single identity method flagged ``located_ok=True`` by method
    fiat (anchor.py:1134-1136), so it alone BYPASSES the cross-supplier blind-read guard
    (``anchor._is_blind_cross_supplier_anchor``, which runs only when ``not located_ok``) — the exact
    vector by which a DIFFERENT supplier's identity anchor, admitted cross-supplier by
    ``_anchor_matches``' identity branch, reads THIS page at a foreign landmark position (the
    SuperStore "Item"/"Ship To:" junk — all 14 live cases are ``anchor_registration`` with no caption).

    Deliberately NARROW (Oracle 2026-07-15 SEND-BACK of the original broad ``startswith('anchor') or
    _is_stage05_located`` predicate, which regressed two shipped tested capabilities to close a hole
    the corpus/audit show is empty). It does NOT match:
      - content-located Stage-2 anchor reads off a REAL caption (``anchor`` / ``anchor_inline`` /
        ``anchor_crop_relocated``) — a supplier's OWN "Supplier:" line still corrects a wrong template
        guess (the Greenfield-over-Acme invariant ``_is_blind_cross_supplier_anchor`` preserves BY NAME);
      - blind rigid ``anchor_crop`` reads — a NAMED cross-supplier one is already dropped by the
        existing blind guard (``located_ok=False``);
      - admin-curated Stage-0.5 ``template_mapping`` / ``template_registration`` reads — template-scoped,
        never cross-applied.
    Those legitimate origins are left to the existing guards. (The pre-existing false-locate residual —
    a rigid ABSOLUTE read whose caption coincidentally appears on another layout — is unclosed by any
    method-level predicate and deferred to the ``_place_from_located`` slice.)"""
    return (method or "").startswith("anchor_registration")


# A BLIND template_registration read placed its target box by landmark GEOMETRY alone, with NO
# evidence that this field's own label sits near the value — so a mis-taught / layout-mismatched
# mapping can land on a wrong-but-type-valid neighbour (e.g. a ZIP fragment "6102" for
# invoice_number). When a strong, rx-validated keyword DISAGREES and outscores it, prefer the
# keyword but FLAG the two-source conflict below auto-file rather than silently swapping (reggie).
# LOCATED mappings (label found on the page), ⊕ anchors and overrides are unaffected.
_KEYWORD_TRUST_FLOOR = 90   # only a confident, rx-validated keyword may challenge a taught read
_CONFLICT_CAP        = 88   # capped below the auto-file threshold → the conflict lands in Review


def _count_valued_fields(results) -> int:
    """Count real extracted fields that carry a value, honouring the results-dict invariant:
    '_'-prefixed keys are METADATA — some are NON-dict (e.g. `_needs_review = True`, injected
    mid-pipeline by the logo text-gate 'suggest' branch ~engine.py:2605) — and MUST be skipped
    before any `.get()` on a value. This is the same guard every other results-iterator in the
    engine already uses; the three diagnostic 'found' counters (Stage 0/1/2 log lines) were the
    only sites that omitted it, which is how a bool value crashed extraction with
    'bool object has no attribute get'. Log-only + behaviour-neutral (a non-dict metadata key was
    never a valued field, so the count is unchanged on every working document)."""
    return sum(1 for k, v in results.items()
               if not str(k).startswith('_') and isinstance(v, dict) and v.get('value'))


def _cmp_norm(value) -> str:
    """Compare-time normalisation for the keyword-vs-mapping disagreement check — reuses the shared
    token normaliser so '6 102' / '6102' compare equal; degrades to a plain lower/strip on error."""
    try:
        from extraction import text_normalise
        return "".join(text_normalise.normalise_for_tokens(value).split())   # collapse ws: '6 102'=='6102'
    except Exception:
        return "".join(str(value or "").strip().lower().split())


# Confidence a cross-check flip is RESTORED to when an independent keyword read corroborates it
# (E2, below). Must clear trust.js's 88 critical-field floor with margin, and stay within the
# located-inline ceiling (~93) — a corroborated located read, not a certainty.
_CROSSCHECK_CORROB_CONF = 90


def _values_normalise_equal(a, b, is_date) -> bool:
    """THE ONE value-agreement core shared by BOTH corroboration paths — E2's crosscheck clear
    and the KEYWORD_ANCHOR_CORROB lift (Oracle C1, 2026-07-23: a copy-pasted comparison is
    exactly the drift the shared 90 constant exists to prevent; pinned by
    test_keyword_anchor_corrob.py). Dates: BOTH sides must parse and be CALENDAR-equal
    (anchor._reads_disagree strict polarity — 0ae0f46's C1; '12-06' vs '06-12' never
    corroborates). Refs: ALPHANUMERIC-CORE equality (drop separators/spaces) so a formatting
    difference between the keyword read (ref-suffix stripped, keyword.py:729-730) and a crop/
    inline read (clean_crop_segment) still corroborates — 'DN-23333' == 'DN 23333' == 'DN23333'
    — while 'DN-23333' != 'DN-99999'. Pure; empty/error → False (fail-toward-review).
    ⚠ DATE-ARM POLARITY (inherited from E2, deliberately preserved): _reads_disagree is
    salvage-aware AND fail-open on an UNPARSEABLE side ('zz/xx' does not register as
    disagreement → this returns True). Every caller MUST therefore sit BEHIND a parse gate:
    the corroboration lift sits after the merge loop's date-parse credibility guard (an
    unparseable date witness is `continue`d before it can reach the lift — pinned), and E2's
    flip values are parse-gated in anchor.py. Do NOT reuse this helper on ungated values."""
    av = str(a or "").strip()
    bv = str(b or "").strip()
    if not av or not bv:
        return False
    if is_date:
        try:
            return not anchor._reads_disagree(bv, av, "date")   # calendar-equal
        except Exception:
            return False
    avn = "".join(c for c in _cmp_norm(av) if c.isalnum())
    bvn = "".join(c for c in _cmp_norm(bv) if c.isalnum())
    return bool(avn) and avn == bvn


def _resolve_detail_suggestion(resolved_field, suggested, norm) -> str:
    """SPARSE-GUARD suggestion arbiter (pure; Oracle-signed 2026-07-23) — what should a stashed
    coarse-miss detail-mark suggestion do, given the FINAL resolved supplier field?
      'clean' — downstream resolved the SAME name (the measured 137-doc arm: un-noted, files as
                in the starved baseline), OR the field is operator-pinned (human authority is
                never second-guessed), OR it already carries a note (one-note-per-field
                convention — the doc is already review-bound; never overwrite a more specific
                note with a generic one).
      'note'  — downstream resolved a DIFFERENT name un-noted: positive mark-vs-text conflict →
                attach the disagree note (fail-toward-review on POSITIVE evidence only).
      'fill'  — nothing resolved: the suggestion may fill, review-bound, AFTER the text gate
                (the caller runs decide_logo_text_gate; abstain ⇒ the value-less
                _logo_abstained affordance instead)."""
    if not isinstance(resolved_field, dict) or not str(resolved_field.get("value") or "").strip():
        return "fill"
    if (resolved_field.get("method") or "") == "operator_pin":
        return "clean"
    if resolved_field.get("validation_note"):
        return "clean"
    try:
        if norm(str(resolved_field.get("value"))) == norm(str(suggested)):
            return "clean"
    except Exception:
        return "clean"   # an unjudgeable compare must never manufacture a conflict
    return "note"


def _crosscheck_keyword_corroborated(data, kw_entry, is_date) -> bool:
    """E2 (Oracle-signed): is an anchor.py crop-vs-fullpage crosscheck FLIP corroborated by an
    INDEPENDENT Stage-1 keyword read of the same field? True only when `data` is the crosscheck
    result AND the incumbent `kw_entry` is a keyword/override read whose value NORMALISES-EQUAL to
    the flipped value (the shared _values_normalise_equal core). Pure; no side effects. Fires the
    flag-clear at the engine merge; a missing/disagreeing peer returns False → today's flag
    stands (fail-toward-review)."""
    if (data or {}).get("method") != "anchor_crop_crosscheck":
        return False
    if not isinstance(kw_entry, dict) or kw_entry.get("method") not in ("keyword", "keyword_override"):
        return False
    return _values_normalise_equal(data.get("value"), kw_entry.get("value"), is_date)


_NAME_RELOCATE_NOTE = ("Two different names were read here — the clean value beside the label and a "
                       "garbled one from the taught box. Kept the label read; please verify.")
_RELOCATE_METHODS = ("anchor_crop_relocated", "anchor_inline")


def _candidate_source_label(method) -> str:
    """A short human phrase for WHERE a candidate value was read, for the disambiguation picker
    list (so an operator can tell the reads apart without knowing methods)."""
    m = method or ""
    if m in ("keyword", "keyword_override"):
        return "beside the label"
    if m.startswith("anchor") or m in ("template_mapping", "template_mapping_expanded"):
        return "from the taught box"
    if m.startswith("template_fixed") or m == "template":
        return "from the template"
    if m == "logo":
        return "from the logo/letterhead"
    return "read from the page"


def _name_relocate_should_hold(existing: dict | None, data: dict | None, field_key: str) -> bool:
    """NAME-RELOCATE DISAGREEMENT GUARD (slice 1; gary-designed, Oracle-signed WITH CONDITIONS,
    2026-07-14). True → a taught anchor's RELOCATED read is a garbled NAME that DISAGREES with a
    CLEAN keyword name for the same field, and the relocate is strictly more garbled AND absolutely
    junky — so the caller HOLDS: keeps the clean keyword value, caps <=69 + note, routes to review.

    The incident: a customer anchor taught on a ROTATED scan mis-registers on the straightened page,
    its crop reads a clipped "comer Clinic" and — because the relocate NULLED its crop confidence
    (see anchor.py Part A) — wins Tier-A outright over the label-adjacent keyword "Fernbank
    Veterinary Clinic". The keyword read is the trustworthy one here.

    Rule (all must hold): the field is name-like AND not supplier_name (slice-1 scope: supplier is
    corpus-scored with its own defenses); the incumbent is a plain 'keyword' read with a value; the
    incoming anchor is a RELOCATE with a value; the two DISAGREE; the keyword is a CLEAN name
    (name_quality >= 0.6); the relocate is STRICTLY less clean than the keyword AND below an absolute
    junk floor (name_quality < 0.6). The STRICT '<' plus the 0.6 floor are load-bearing (Oracle): a
    legit taught mixed-case name ("McConnell Kelly Solicitors" scores ~0.667 because name_quality
    under-rates interior capitals) is NOT demoted and still wins its Tier-A re-teach — only a genuine
    garble (< 0.6) is held. FLAG-ONLY: never rewrites a value. Pin the floor in
    test_name_relocate_disagreement.py so a future dev can't loosen it and re-break the teach."""
    if not existing or not data:
        return False
    if not value_quality.is_name_like_field(field_key) or field_key == "supplier_name":
        return False
    # (D, 2026-07-21) The incumbent set was 'keyword' ONLY, which made this guard DEAD on every
    # install that carries a label override for the field: `merge_label_overrides` re-labels the
    # Stage-1 capture as method 'keyword_override', so the clean label-adjacent read — the very
    # value this guard exists to protect — was not recognised as an incumbent and the garbled
    # relocate won unopposed. An override is the SAME read from the SAME layer (a curated caption
    # instead of a shipped one), so it belongs in the same set. Kill NAME_HOLD_ADMIT_OVERRIDE=0.
    _INCUMBENTS = ("keyword", "keyword_override") if os.environ.get("NAME_HOLD_ADMIT_OVERRIDE", "1") != "0" else ("keyword",)
    if existing.get("method") not in _INCUMBENTS or not existing.get("value"):
        return False
    # Oracle C2 (2026-07-15): admit a RIGID anchor_crop into the hold ONLY when anchor.py flagged it a
    # fuzzy caption-bleed — never bare (a normal rigid taught read still wins Tier-A, byte-identical).
    _m = data.get("method")
    _rigid_bleed = (_m == "anchor_crop" and data.get("caption_bleed"))
    if (_m not in _RELOCATE_METHODS and not _rigid_bleed) or not data.get("value"):
        return False
    ev, dv = existing.get("value"), data.get("value")
    if _cmp_norm(ev) == _cmp_norm(dv):        # must DISAGREE
        return False
    eq = value_quality.name_quality(ev)
    if eq < 0.6:                              # the keyword must be a CLEAN name
        return False
    # CAPTION-BLEED (fix #2): the relocate read the field's OWN caption (flagged in anchor.py —
    # its leading tokens ARE the taught label). Real caption words score >=0.6, so the junk floor
    # below can't catch them (they collide with a legit mixed-case name). Hold regardless of the
    # relocate's name_quality — the clean keyword wins. Disagree + clean-keyword already checked.
    if data.get("caption_bleed"):
        return True
    dq = value_quality.name_quality(dv)
    # strict '<' (an equal/cleaner taught relocate still wins Tier-A) AND the absolute junk floor.
    return dq < eq and dq < 0.6


def _supplier_identity_decision(existing: dict | None, candidate: dict | None) -> str | None:
    """Plausibility-aware merge ruling for the supplier_name field only.

    Returns 'take' (candidate replaces existing), 'keep' (existing wins, ignore
    candidate), or None (no opinion — fall back to the normal confidence merge).

    A plausible candidate replaces an IMPLAUSIBLE incumbent regardless of
    confidence — this is what lets a real read of the company name override a
    stale template_fixed short fragment like "IN" that arrived at confidence 95.
    Symmetrically, an implausible candidate never displaces a plausible
    incumbent. When both are plausible (or both implausible — e.g. a genuinely
    short "IBM" with no plausible alternative), there is no opinion and the
    caller's confidence comparison decides, so legitimate short names are never
    hard-banned.

    ⚠ The INCUMBENT is judged by the SHAPE-BASE test (NOT the document-chrome layer):
    a chrome-shaped but REAL short name ("Dell"→'deli', "Sage"→'sale') is edit-1 from a
    title prefix, so letting the chrome demotion license this confidence-blind 'take'
    would let a plausible WRONG challenger silently overwrite a correctly-resolved short
    supplier (Oracle 2026-07-14). The CANDIDATE keeps the FULL check, so a chrome GARBLE
    challenger ("INi") is correctly implausible and can't displace a real incumbent.
    SuperStore's garble is corrected by the Stage-2.5a recovery, not this arm.
    """
    e_ok = keyword._is_plausible_supplier_name_base((existing or {}).get("value"))
    c_ok = keyword._is_plausible_supplier_name((candidate or {}).get("value"))
    if e_ok and not c_ok:
        return "keep"
    if c_ok and not e_ok:
        return "take"
    return None


# Generic document-TYPE / heading words that leak into template keyword-fingerprints and appear on
# ANY supplier's document of that type — so they never DISTINGUISH a supplier. Stripped from the
# branding banks in _flag_branding_conflict so the presence check is judged on distinctive
# company/address tokens only (a Thornbury fingerprint polluted with "Delivery"/"Docket" must NOT
# score as "present" on a Cascade DELIVERY DOCKET — the #1/#42 collision-slip class, where the wrong
# supplier's leaked doc-type words push its branding ratio above the threshold and suppress the flag).
# THE definitions moved to template_matcher.py (TEMPLATE_GATE_DISTINCTIVE, 2026-07-20) so the
# Stage-0 gate and this flag judge "distinctive" by ONE rule — template_matcher is the leaf, this
# module aliases. Two definitions would drift, and the drift was the Northgate/Vellum misfile class.
_BRANDING_STOPWORDS     = template_matcher._BRANDING_STOPWORDS
_BRANDING_MIN_WORDS     = template_matcher._BRANDING_MIN_WORDS
_BRANDING_PRESENT_RATIO = template_matcher._BRANDING_PRESENT_RATIO


# ── Branding evidence (shared: the late conflict FLAG + the text-agreement GATE) ──────────
# Extracted VERBATIM from _flag_branding_conflict (2026-07-20, identity text-first slice 1a) so ONE
# definition of "supplier X's distinctive letterhead words" and "are they on this page?" serves both
# the flag and the gate. Two definitions would drift — the gate would then abstain on docs the guard
# clears (or worse, assert on docs it flags). MODULE-LEVEL + norm INJECTED (not engine methods): the
# guard's own test drives the predicate through a minimal fake self, and the gate's battery needs
# these callable without an engine — keep them pure. Same K, same stopword strip, same EXACT
# whole-page _keyword_hit_ratio: fuzzing own_ratio was deliberately REJECTED (it can only RAISE the
# ratio and suppress a flag = fail-open to a silent wrong supplier).
def _letterhead_type_phrases(patterns):
    """Every printed phrase that names a DOCUMENT TYPE — the `document_type_keywords` bucket KEYS
    **and** the phrases inside them. The letterhead reader excludes these so a type heading can
    never be read as a company. Keys alone are NOT enough: the buckets carry the real printed forms
    ("tax invoice", "vat invoice", "order confirmation"), which are multi-word (so title_pick's
    GENERIC_SINGLES misses them) and longer than the chrome-fragment guard's 2-5 char window — a
    logo-only letterhead would otherwise have suggested "TAX INVOICE" as the company."""
    out = []
    try:
        buckets = (patterns or {}).get("document_type_keywords", {}) or {}
        for key, phrases in buckets.items():
            out.append(str(key))
            if isinstance(phrases, dict):
                out.extend(str(p) for p in phrases.keys())
            elif isinstance(phrases, (list, tuple, set)):
                out.extend(str(p) for p in phrases)
    except Exception:
        pass                       # a suggestion helper must never break an extraction
    return out


def _branding_banks(templates, norm):
    """{norm_issuer: {'name': str, 'words': set}} — keyed by the template's DOMINANT confirmed
    issuer (else its name); value = its distinctive branding tokens.

    BRANDING_DISTINCTIVE_TOKENS (default ON, 2026-07-20 — the slice-2 half of the distinctive-token
    train; must ship WITH the Stage-0 gate so the two banks can't drift, Oracle condition D): banks
    use the SHARED template_matcher._distinctive_tokens, which additionally drops generic vocabulary,
    calendar words and type-word PREFIXES ('INV', split off "INV-12345" at harvest). The junk cuts
    both ways: for a WRONG supplier those fragments are the likeliest page hits (own_ratio inflated
    above the 0.25 present-bar → the conflict flag SUPPRESSED — the same class as the misfile gate
    defeat, through the other door); for the RIGHT supplier they dilute the denominator (false
    flags). =0 restores the legacy len>=3 + type-stopword filter byte-identically."""
    distinctive = os.environ.get("BRANDING_DISTINCTIVE_TOKENS", "1") != "0"
    banks = {}
    for t in (templates or []):
        iss = (t.get("dominant_supplier") or "").strip() or (t.get("name") or "").strip()
        kf = t.get("keyword_fingerprint") or []
        if not iss or not kf:
            continue
        b = banks.setdefault(norm(iss), {"name": iss, "words": set()})
        if distinctive:
            b["words"].update(template_matcher._distinctive_tokens(kf))
        else:
            for w in kf:
                wl = str(w or "").strip().lower()
                if len(wl) >= 3 and wl not in _BRANDING_STOPWORDS:
                    b["words"].add(wl)   # distinctive branding tokens only (doc-type words stripped)
    return banks


def _branding_alt_name(banks, ocr_text, exclude_norm):
    """The DECISIVELY-present alternative supplier on this page, or None — extracted VERBATIM from
    _flag_branding_conflict (slice 1a/C1) so the late FLAG and the gate's abstain-suggestion name
    the alternative by ONE rule. Returns (named, fuzzy_on).

    >=0.75 present AND a >=0.25 margin over any third (positive evidence, not weak agreement).
    FUZZY (a garbled 'rthgate' still resolves 'northgate') and scoped to the ISSUER BAND ONLY (top
    letterhead, truncated at the first recipient marker), so a mid-page recipient can never be named
    as the issuer. Kill switch BRANDING_ALT_FUZZY: =0 restores the legacy exact whole-page scan,
    whose result must NOT feed an actionable button (it can name a recipient) — hence fuzzy_on is
    returned so callers gate the suggestion on it."""
    fuzzy = os.environ.get("BRANDING_ALT_FUZZY", "1") != "0"
    if not banks or not ocr_text:
        return None, fuzzy
    from extraction import template_matcher
    issuer_tokens = None
    if fuzzy:
        import re as _re
        from extraction import chrome_band
        issuer_tokens = _re.findall(r"[a-z0-9]+", chrome_band.issuer_chrome(ocr_text).lower())
    ocr_lower = ocr_text.lower()
    alt, alt_ratio, second = None, 0.0, 0.0
    for norm_key, b in banks.items():
        if norm_key == exclude_norm or len(b["words"]) < _BRANDING_MIN_WORDS:
            continue
        if fuzzy:
            r = template_matcher._keyword_hit_ratio_fuzzy(sorted(b["words"]), issuer_tokens)
        else:
            r = template_matcher._keyword_hit_ratio(
                {"keyword_fingerprint": sorted(b["words"])}, ocr_lower)
        if r > alt_ratio:
            alt, second, alt_ratio = b["name"], alt_ratio, r
        elif r > second:
            second = r
    named = alt if (alt and alt_ratio >= 0.75 and alt_ratio - second >= 0.25) else None
    return named, fuzzy


# ── Identity text-sufficiency floor (Oracle C2) ────────────────────────────────────────────
# own_ratio is EXACT + whole-page, so a page whose letterhead OCR'd to mush scores ~0 — under the
# late FLAG that only cost a review hold, but as a DESTRUCTIVE gate (abstain) it would delete a
# CORRECT identity on a bad scan. Below this floor the page is UNJUDGEABLE (branch 2), never
# "branding absent". MEASURED on the live corpus (133 docs with ocr_text, 2026-07-20): the THINNEST
# real page had 18 issuer-band tokens / 76 whole-page tokens; median 25 / 116. The floor sits ~45%
# BELOW the worst real page, so it routes ZERO healthy docs to branch 2 and fires only on OCR that
# genuinely failed. Re-measure before moving it.
_IDENTITY_MIN_BAND_TOKENS = 10
_IDENTITY_MIN_PAGE_TOKENS = 50


def _identity_text_sufficient(ocr_text):
    """False when this page's text is too thin to judge branding presence either way (C2)."""
    if not ocr_text:
        return False
    import re as _re
    from extraction import chrome_band
    page = _re.findall(r"[a-z0-9]+", ocr_text.lower())
    if len(page) < _IDENTITY_MIN_PAGE_TOKENS:
        return False
    band = _re.findall(r"[a-z0-9]+", chrome_band.issuer_chrome(ocr_text).lower())
    return len(band) >= _IDENTITY_MIN_BAND_TOKENS


def decide_logo_text_gate(logo_supplier, banks, ocr_text, norm, accepted_issuers=()):
    """PURE three-way decision for an accepted logo match (identity text-first, slice 1b).
    Returns one of 'accept' | 'suggest' | 'abstain'.

    'accept'  — the supplier's OWN distinctive branding is on the page: byte-identical to pre-slice
                behaviour (value, confidence incl. the match_count bonus, method 'logo').
    'suggest' — UNJUDGEABLE (no >=K-word bank for this supplier, or the page text is below the C2
                sufficiency floor): keep the value but review-bound (<=69 + note). A logo alone
                never ASSERTS, but withholding what it saw would leave the reviewer mute (Oracle Q1).
    'abstain' — POSITIVE DISAGREEMENT (a bank exists, the page text is sufficient, and the
                supplier's branding is absent): the logo is contradicted by the page — drop it.

    An operator-allowlisted issuer ('Issuer is correct') NEVER abstains (Oracle C3): the human
    already ruled on this identity; a text-poor page must not silently override them."""
    if not logo_supplier:
        return 'abstain'
    if not _identity_text_sufficient(ocr_text):
        return 'suggest'                       # C2: too little text to judge → never destructive
    own_ratio = _branding_own_ratio(logo_supplier, banks, ocr_text, norm)
    if own_ratio is None:
        return 'suggest'                       # no >=K-word bank → unjudgeable (fail-safe)
    if own_ratio > _BRANDING_PRESENT_RATIO:
        return 'accept'
    if norm(logo_supplier) in (accepted_issuers or ()):
        return 'suggest'                       # C3: operator allowlist outranks the text check
    return 'abstain'


def _branding_own_ratio(supplier_name, banks, ocr_text, norm):
    """How much of `supplier_name`'s OWN distinctive branding appears on the page.
    None = UNJUDGEABLE (no bank for it, or fewer than K distinctive words) — the fail-safe class
    BOTH callers must read as 'no evidence either way', never as 'branding absent'."""
    if not supplier_name or not banks or not ocr_text:
        return None
    own = banks.get(norm(supplier_name))
    if not own or len(own["words"]) < _BRANDING_MIN_WORDS:
        return None
    from extraction import template_matcher
    return template_matcher._keyword_hit_ratio(
        {"keyword_fingerprint": sorted(own["words"])}, ocr_text.lower())


def _genuine_template_supplier(matched_tmpl: dict | None) -> str | None:
    """The matched template's DOMINANT confirmed issuer identity when it is a CLEAR majority, else
    None. Uses the learned issuer DISTRIBUTION (templates.getAll emits dominant_supplier / _count /
    _total = the top confirmed issuer, its count, and the total confirmed-with-issuer docs on this
    template), NOT the template's cosmetic NAME. The name is only the FIRST-confirmed issuer, which
    can be an outlier or OCR garble — e.g. a template NAMED "50 Asia" (1 confirm) whose docs are
    really "Contoso Asia" (3 confirms); trusting the name would impose the garble. The value the
    MAJORITY of confirmed docs agree on is a reliable identity — a stronger "who is this?" signal
    than a per-doc field read a teaching artifact produced. Requires a STRICT majority (> half) and
    at least 2 agreeing confirms, so a split/ambiguous or single-confirm template imposes nothing.
    Backward-safe: absent dominant_* fields (old caller/DB) → None → the precedence rule is inert.
    Identification itself stays logo_phash / keyword_fingerprint (template_matcher) — unaffected."""
    if not matched_tmpl:
        return None
    value = (matched_tmpl.get("dominant_supplier") or "").strip()
    if not value:
        return None
    try:
        count = int(matched_tmpl.get("dominant_supplier_count") or 0)
        total = int(matched_tmpl.get("dominant_supplier_total") or 0)
    except (TypeError, ValueError):
        return None
    # Strict majority: > half of the confirmed-with-issuer docs agree, and at least 2 do.
    if count >= 2 and count * 2 > total:
        return value
    return None


# ── Template-identity supplier FILL (2026-07-14 night; gary-designed, Oracle-signed; corroboration-gated) ──
# When a template matched but the supplier is UNRESOLVED (flaky logo drifted out of range), the doc reads
# EMPTY — every supplier-scoped taught anchor is dropped, so the user re-teaches every field on every doc.
# Fill the supplier from the template's DOMINANT CONFIRMED issuer so its anchors admit. ALWAYS REVIEW-BOUND
# (persisted note): an INFERRED identity (no logo, no on-page read) must NEVER silently drive the filing folder.
_TEMPLATE_IDENTITY_FILL_NOTE_SINGLE = ("Company inferred from one previously filed document — "
                                       "please confirm before filing.")
_TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY = ("Company inferred from previously filed documents on this "
                                         "layout — please confirm before filing.")


def _template_identity_for_fill(matched_tmpl: dict | None):
    """FILL an UNRESOLVED supplier from the matched template's DOMINANT CONFIRMED issuer. Returns
    {'value','tier','note'} or None. tier 'majority' = >=2 confirms + strict majority; 'single' =
    exactly one unanimous confirm; None = ambiguous plurality / zero confirms / implausible identity /
    no template. Uses ONLY the confirmed-issuer distribution, NEVER matched_tmpl['name'] (a garble/
    postcode). `note` is always non-empty so BOTH tiers stay review-bound (Oracle blocking condition)."""
    if not matched_tmpl:
        return None
    value = (matched_tmpl.get("dominant_supplier") or "").strip()
    if not value or not keyword._is_plausible_supplier_name(value):
        return None
    try:
        count = int(matched_tmpl.get("dominant_supplier_count") or 0)
        total = int(matched_tmpl.get("dominant_supplier_total") or 0)
    except (TypeError, ValueError):
        return None
    if count >= 2 and count * 2 > total:
        return {"value": value, "tier": "majority", "note": _TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY}
    if count == 1 and total == 1:
        return {"value": value, "tier": "single", "note": _TEMPLATE_IDENTITY_FILL_NOTE_SINGLE}
    return None


def _template_identity_corroborated(value: str | None, ocr_text: str | None) -> bool:
    """True → the IDENTITY we're about to FILL (the template's dominant issuer `value`) actually appears
    on THIS page as text. This validates the IDENTITY, not the layout — which is what catches a POISONED
    dominant issuer: templates 4/5/7 are NAMED 'Cascade Water Systems' but their dominant_supplier is
    'Northgate Textiles' (the Cascade<->Northgate logo collision cross-contaminated their confirmed docs).
    A Cascade docket carries NO 'Northgate'/'Textiles' text, so filling 'Northgate' on it can't corroborate
    → no fill → the supplier resolves via logo/keyword/text-scan instead. (Checking the template's
    FINGERPRINT instead would wrongly pass — the Cascade layout IS on a Cascade docket even when the
    template's learned issuer is poisoned.) Requires >=60% of the value's distinctive name tokens (>=3
    chars, minus generic company suffixes) present as WHOLE WORDS. FAIL-SAFE: a name not on the page
    (logo-only letterhead) → no fill → review."""
    if not value or not ocr_text:
        return False
    import re as _re
    _GENERIC = {"ltd", "limited", "plc", "llp", "inc", "incorporated", "co", "company", "corp",
                "group", "holdings", "services", "service", "the", "and"}
    toks = [t for t in _re.findall(r"[a-z0-9]+", value.lower()) if len(t) >= 3 and t not in _GENERIC]
    if not toks:
        return False
    text = ocr_text.lower()
    present = sum(1 for t in toks if _re.search(r"\b" + _re.escape(t) + r"\b", text))
    return present >= 1 and (present / len(toks)) >= 0.6


def _is_ref_field(key: str) -> bool:
    """Reference-number-style fields, by naming convention (no supplier/doc
    specifics): invoice_number / po_number / sales_order_number (..._number),
    job_no (..._no), and any explicit reference field. Covers unseen custom
    types that follow the same convention."""
    k = (key or "").lower()
    return k.endswith("_number") or k.endswith("_no") or "reference" in k


# Field TYPE → credibility validation key. Only STRUCTURED / code types are mapped;
# text/multiline_text are deliberately ABSENT so free-text fields stay unconstrained
# (seeding "text" would flip on the degraded-text escalation for name/address reads).
_TYPE2VAL = {"date": "date", "currency": "currency", "number": "currency",
             "amount": "currency", "alphanumeric": "alphanumeric",
             "job_reference": "job_reference", "currency_code": "currency_code",
             # Explicit "Reference number" field type — a deliberate CODE marker;
             # gated alphanumeric, never currency.
             "reference": "alphanumeric",
             # "Reference code" — a STRICTER ref shape that must contain a digit (a
             # digit-free word like "Reference"/"Customer" fails). A deliberate WITHHOLD
             # gate, offered as a distinct option rather than mutating "alphanumeric"
             # (which many fields rely on). reggie Tier-2.
             "reference_code": "reference_code"}
# NOTE: the FLAG-ONLY supplementary types (email/percentage/postcode_uk/vat_gb/iban/website)
# are deliberately NOT mapped here. A _TYPE2VAL entry makes the value's validation_pattern a
# WITHHOLD gate (a non-matching read is dropped); these are flag-only per review-not-reject —
# the value is kept and surfaced for review via the renderer on-blur validator
# (TYPE_TO_VALIDATION) + the Stage-4.5 field_charsets note (both keyed on the field TYPE,
# independent of _TYPE2VAL). reference_code (above) is the one Tier-2 type that DOES gate.


def _seed_field_patterns(base_patterns, field_defs):
    """Seed per-field credibility patterns from each field's configured TYPE so a
    CUSTOM doc-type field (no keyword-config entry) is gated by its real type rather
    than loose free-text (which lets high-DPI crop garbage commit unchallenged). The
    keyword config wins where it already carries an entry.

    Ref-role coercion — both cases resolve to "alphanumeric", the right gate for a CODE:
      * a ref field a user typed Number/Currency (the money pattern rejects NNNN-NNNN-N
        refs); and
      * the doc-type REFERENCE role typed plain "text" — the structural ref field is
        created as text, so it slips past _TYPE2VAL and would be graded FREE TEXT,
        accepting OCR garbage like "en rT" at the absolute drawn box and never
        relocating to its anchor. Free-text name/address fields (not _is_ref_field)
        stay unconstrained. Reusable for every supplier/template with a text ref role.
    """
    field_patterns = dict(base_patterns or {})
    for _f in (field_defs or []):
        _k, _t = _f.get("key"), (_f.get("type") or "").lower()
        if not _k or _k in field_patterns:
            continue
        # A MAC/IP field is a CODE with a precise format — give it a first-class
        # validation pattern regardless of the loose DB type the user picked
        # (text/alphanumeric), so its colons/octets are type-VALID (not "unexpected
        # characters") and a new device's address isn't flagged as a learned-SHAPE
        # anomaly. See value_quality.network_address_validation.
        _net = value_quality.network_address_validation(_k)
        if _net:
            field_patterns[_k] = {"validation": _net}
        elif _t in _TYPE2VAL:
            mapped = _TYPE2VAL[_t]
            if _is_ref_field(_k) and mapped in ("currency", "currency_code"):
                mapped = "alphanumeric"
            field_patterns[_k] = {"validation": mapped}
        elif _is_ref_field(_k):
            field_patterns[_k] = {"validation": "alphanumeric"}
    return field_patterns


def _ref_override_plausible(value) -> bool:
    """Conservative shape gate for whether a Stage 2 reference candidate is
    information-rich enough to OVERRIDE an existing incumbent. Rejects the
    low-information failures (a lone "a", punctuation-only crops, 2-letter
    noise) while still accepting short numeric refs ("12", "PO12") and normal
    alphanumeric refs ("INV-2026-001", "ABCD"). Shape-only — no value lists."""
    v = (value or "").strip()
    alnum = sum(c.isalnum() for c in v)
    if alnum == 0:                       # punctuation-only junk
        return False
    if len(v) < 2:                       # single character like "a"
        return False
    if not any(c.isdigit() for c in v) and alnum < 4:   # very low-info, no digits
        return False
    return True


def _enabled_mappings(tmpl: dict) -> list:
    """Enabled admin-drawn field_mappings on a template dict (same enabled-filter
    Stage 0.5 has always applied: anything not explicitly disabled counts)."""
    return [m for m in (tmpl.get("field_mappings") or [])
            if m.get("enabled", True) not in (False, 0)]


def select_mapping_source(matched_tmpl: dict, templates: list | None) -> tuple[list, dict | None]:
    """Decide which template's admin-drawn field_mappings to run for a document
    that matched ``matched_tmpl`` — the deferred template-group "shared-anchor"
    behaviour (see templates.js: groups were metadata-only in v1).

    Returns ``(mappings, source)`` where ``mappings`` is the list of enabled
    field_mappings to apply and ``source`` is the template they came from
    (``matched_tmpl`` itself when it has its own, the sibling when borrowed, or
    ``matched_tmpl`` with an empty list when there is nothing to run).

    Rule:
      1. If the matched template has enabled mappings OF ITS OWN, always use
         those — unchanged behaviour; a template's own curated mappings win and
         no group lookup happens.
      2. Otherwise, if it belongs to a group, BORROW from the grouped sibling
         (same ``group_id``, different ``id``) that has enabled mappings. A group
         is an admin assertion that those templates share a layout, and the
         borrowed mappings are still re-run through the anchor-relocation model
         on THIS page (template_mapper re-finds each anchor, yielding nothing if
         the layout doesn't actually match) — so borrowing is validated, never
         copied blindly.
      3. If there is no group, or no sibling has mappings, return an empty list
         so the caller simply runs no Stage 0.5 — exactly as before.

    Deterministic sibling pick: the sibling with the MOST enabled mappings, tie-
    broken by highest ``confirmed_count`` then lowest ``id`` — the most-developed,
    most-trusted sibling, chosen stably regardless of the input list's order.

    Pure: no I/O and no DB; operates only on the template dicts already passed
    into ``extract()`` (each carries ``id``, ``group_id`` and ``field_mappings``
    via templates.getAll's ``SELECT *`` + per-row mapping load).
    """
    own = _enabled_mappings(matched_tmpl)
    if own:
        return own, matched_tmpl

    gid = matched_tmpl.get("group_id")
    if gid is None:
        return [], matched_tmpl

    mid = matched_tmpl.get("id")
    candidates = []
    for sib in (templates or []):
        if sib is matched_tmpl:
            continue
        if sib.get("group_id") != gid or sib.get("id") == mid:
            continue
        sib_maps = _enabled_mappings(sib)
        if sib_maps:
            candidates.append((sib, sib_maps))

    if not candidates:
        return [], matched_tmpl

    candidates.sort(key=lambda c: (-len(c[1]),
                                   -(c[0].get("confirmed_count") or 0),
                                   c[0].get("id") or 0))
    best_sib, best_maps = candidates[0]
    return best_maps, best_sib


class ExtractionEngine:

    def __init__(self,
                 mode:         str = "smart",   # fast | smart
                 config_path:  str | None = None,
                 emit_fn            = None):

        self.mode         = mode.lower()
        self.patterns     = keyword.load_patterns(config_path)
        self.emit         = emit_fn or (lambda msg: None)
        self.format_index        = {}   # populated by set_formats()
        self.dominant_index      = {}   # Stage 2.5d dominant-value snap (populated by set_formats)
        self.known_index         = {}   # confirmed values per scope — guards try_correct (set_formats)
        self.prefix_index        = {}   # dominant ref-code prefix per scope — prefix-outlier guard (set_formats)
        self.noise_profile_index = {}   # populated by set_formats()
        self.format_class_index  = {}   # populated by set_formats()
        self.label_overrides     = []   # populated by set_label_overrides()
        self.field_rules_index   = {}   # populated by set_field_rules()
        self._multiline_index    = {}   # populated by set_field_rules() (multiline_continue)
        self.multiline_enabled   = False  # set by set_multiline_enabled()
        self.registration_enabled = False  # set by set_registration_enabled()
        # Phase 3 candidate-override (default OFF → byte-identical behaviour). Modes:
        # 'off' | 'suggest' (corrected_to only) | 'auto' (value, only for opted-in
        # field types in candidate_override_fields). See _resolve_candidates().
        self.candidate_override        = 'off'
        self.candidate_override_fields = set()
        self._field_candidates   = {}    # per-run candidate ledger (built only when override on)
        # Wordness gate (default OFF → byte-identical). When on, a free-text NAME read
        # that does not read like a name (document chrome, ref/code bleed, OCR garble)
        # is FLAGGED for review (note + conf cap); never rejected. See extraction/wordness.py.
        self.name_wordness       = False
        # Operator-accepted NAME values — an allowlist of exact name strings the user has
        # explicitly marked "this IS a valid name" (Review "This name is correct" button).
        # A name value normalised into this set is EXEMPT from the wordness / truncation
        # flags, so a legitimate acronym-bearing company ("Cloud VPS") stops being flagged
        # once confirmed once. Empty by default → byte-identical. See _accept_norm().
        self.accepted_names      = set()
        self.accepted_issuers    = set()  # supplier names explicitly marked a valid issuer (button)
        self._identity_conflict  = False  # active flag-only supplier-conflict (set_identity_conflict)
        self._trace              = None  # dev-only trace callback (set per extract())

    def log(self, text: str, level: str = ""):
        self.emit({"type": "log", "text": text, "level": level})

    def set_registration_enabled(self, on: bool):
        """Enable the Stage 0.5 registration rung (P4, 'register, then read').
        Inert unless the matched template carries taught landmarks."""
        self.registration_enabled = bool(on)

    def set_name_wordness(self, on: bool):
        """Enable the free-text NAME wordness review flag (default OFF). Inert unless the
        char-trigram table ships (extraction/data/char_trigrams.json)."""
        self.name_wordness = bool(on)

    @staticmethod
    def _accept_norm(value) -> str:
        """Canonical form for the accepted-names allowlist match (lowercase, ws-collapsed,
        trimmed). The JS side (learning.acceptName / buildTrainingArgs) stores the SAME
        canonical form, so a taught 'Cloud VPS' matches 'cloud   vps' / ' Cloud VPS '."""
        return " ".join(str(value or "").strip().lower().split())

    @staticmethod
    def _noted_template_fill_value(sn_cur):
        """The value of a REVIEW-BOUND template_identity FILL (method 'template_identity' + a
        validation_note + a value) — the ONLY incumbent eligible for text-first graduation. Returns
        None for: the un-noted template-supplier-precedence override (@90, no note), a
        positional-dropped (None) value, or any other method. Pure/static so the eligibility gate is
        unit-testable without a full extract()."""
        if not isinstance(sn_cur, dict):
            return None
        if sn_cur.get("method") != "template_identity":
            return None
        if not sn_cur.get("validation_note"):
            return None
        return sn_cur.get("value") or None

    # How many top lines `_issuer_hint_band` may scan. Deliberately LARGE so the 600-character cap
    # — not this line cap — is what binds on a marker-free page: the only intended narrowing is the
    # recipient-marker truncation, and a line cap would smuggle in a second, unevidenced one.
    # NOT the same as chrome_band.issuer_chrome's own default of 6, which must not be touched: that
    # default is calibrated for TOKEN-RATIO consumers (_identity_text_sufficient's floor at
    # _IDENTITY_MIN_BAND_TOKENS was measured against it), which degrade gracefully on a short band.
    # This consumer is an all-or-nothing substring test and has no such tolerance.
    _HINT_BAND_LINES = 40

    @staticmethod
    def _issuer_hint_band(ocr_text):
        """The evidence window for matching a KNOWN supplier name (Stage 2.5a + the text-first
        issuer graduation): today's top-600-character reach, TRUNCATED at the first recipient
        marker ("Bill To"/"Sold To"/"FAO"/…).

        WHY: the window used to be a raw `ocr_text[:600]`, which on a real invoice comfortably
        contains the RECIPIENT block — measured at ~180 chars on a traced invoice and ~160 on a
        purchase order. So the customer's name was admissible evidence for the ISSUER field. The
        band is a strict subset of that slice, so this can only REMOVE candidates, never admit a
        different company — with one deliberate exception, pinned in the tests: the band joins
        lines with a space, so a name split across two visual rows ("HALCYON\\nLEISURE GROUP")
        becomes matchable when it wasn't.

        SCOPE, stated honestly: this protects MARKER-BEARING layouts only. On a page with no
        recipient marker the band equals the legacy window and the hole stays open — the
        "To:"-first / uncaptioned-address layout is exactly the hardest case and is NOT closed here.

        Kill switch ISSUER_HINT_BAND=0 returns the legacy expression byte-identically.
        """
        if os.environ.get("ISSUER_HINT_BAND", "1") == "0":
            return (ocr_text or "")[:600].lower()
        from extraction import chrome_band     # local import: matches the existing callers, and
                                               # keeps engine import-light (chrome_band is stdlib-only)
        return chrome_band.issuer_chrome(
            ocr_text, max_lines=ExtractionEngine._HINT_BAND_LINES)[:600].lower()

    def _supplier_hint_upgrade(self, incumbent_value, hints, ocr_top, suppressed_norm):
        """Pick the best qualifying `supplier_name` hint whose value appears in `ocr_top` — the
        ISSUER BAND as produced by `_issuer_hint_band` (the caller narrows it; this function does
        not, so the graduation pins can keep feeding it a pre-computed window).
        ⚠ Before 2026-07-20 `ocr_top` was a raw `ocr_text[:600]` slice and this docstring's claim
        that it was "the issuer band" was FALSE — the recipient block sat inside it.
        Returns (value, usage_count) or None. Shared by the Stage-2.5a text-scan fallback and
        the text-first issuer GRADUATION (gary-designed, Oracle-signed 2026-07-15) so the graduate/
        hold/no-swap/C1 decision is unit-reachable without OCR or a DB.

        A candidate hint must, IN THIS ORDER (the order is load-bearing — Oracle C1): be a
        `supplier_name` hint · usage_count >= 3 · a PLAUSIBLE name · NOT the C1-suppressed vendor
        (`suppressed_norm`, the buyer-issued guard's dropped caption) · [GRADUATION only] equal
        `incumbent_value` (the no-swap invariant) · and finally be PRESENT in `ocr_top`. Highest
        usage_count wins.

        `incumbent_value` None  → original implausible-incumbent path: ANY qualifying hint may win
                                  (swapping to a different supplier is the point there).
        `incumbent_value` == V  → graduation path: ONLY a hint confirming V may win, so a graduation
                                  can never adopt a DIFFERENT supplier than the fill already chose —
                                  it only decides whether to shed the review note."""
        grad_norm = self._accept_norm(incumbent_value) if incumbent_value else None
        best_val, best_usage = None, 0
        for h in (hints or []):
            if h.get("field_key") != "supplier_name":
                continue
            if (h.get("usage_count") or 0) < 3:
                continue
            val = (h.get("hint_value") or "").strip()
            if not keyword._is_plausible_supplier_name(val):
                continue
            if suppressed_norm and self._accept_norm(val) == suppressed_norm:
                continue   # C1: never re-adopt the just-suppressed vendor caption
            if grad_norm is not None and self._accept_norm(val) != grad_norm:
                continue   # no-swap: a graduation may only confirm the fill's own value
            if val and val.lower() in ocr_top:
                if (h.get("usage_count") or 0) > best_usage:
                    best_val, best_usage = val, (h.get("usage_count") or 0)
        return (best_val, best_usage) if best_val else None

    def set_accepted_names(self, names) -> None:
        """Load the operator-accepted NAME allowlist (exact values the user marked valid).
        A name value in this set is exempt from the wordness + truncation flags. Empty/None
        → no change from default (byte-identical)."""
        self.accepted_names = {self._accept_norm(n) for n in (names or []) if str(n or "").strip()}

    def set_accepted_issuers(self, names) -> None:
        """Load the operator-accepted ISSUER allowlist (resolved supplier names the user marked a
        valid issuer via the identity-conflict 'Issuer is correct' button). A resolved supplier in
        this set never raises the conflict flag — the explicit complement to the automatic
        established-after-N-confirmations fallback. Empty/None → no change (byte-identical)."""
        self.accepted_issuers = {self._accept_norm(n) for n in (names or []) if str(n or "").strip()}

    def set_identity_conflict(self, on: bool):
        """Enable the ACTIVE text-led supplier-identity conflict flag (default OFF, opt-in). When
        on, a CONFLICT (the issuer-band letterhead reads a DIFFERENT known supplier than the
        pipeline resolved) raises needs_review + an advisory note on the identity field — it never
        overrides a value, fills an empty one, or flags on abstain/agree. Inert unless
        identity_fusion imports (needs rapidfuzz); see _compute_identity_verdict."""
        self._identity_conflict = bool(on)

    def set_multiline_enabled(self, on: bool):
        """Enable the multi-line continuation read (default OFF in-engine; the handler passes
        the default-ON setting). Inert without a multiline_continue rule for the field — so a
        single-line read stays byte-identical."""
        self.multiline_enabled = bool(on)

    def set_candidate_override(self, mode, fields=None):
        """Enable the Phase 3 post-merge candidate resolver. mode: 'off' (default,
        no behaviour change) | 'suggest' (corrected_to + note only) | 'auto' (replace
        value, but ONLY for field types in `fields`). Mirrors the other extraction
        setting setters; default-off keeps the engine byte-identical."""
        self.candidate_override = (mode or 'off').lower().strip()
        self.candidate_override_fields = set(fields or [])

    # ── Phase 3 candidate ledger + post-merge resolver (default OFF) ─────────────
    # A purely-additive side-ledger of every stage's produced candidate, consumed
    # ONLY by _resolve_candidates after Stage 4.5. Winner-selection code is unchanged;
    # when candidate_override is 'off' both helpers short-circuit so there is zero
    # extra work and zero behaviour change.
    def _remember_candidates(self, stage: str, produced: dict):
        # Always build the per-run ledger (reset per doc in extract()): it feeds the always-on
        # reconciliation-aware total pick (_reconciliation_pick_total), and — only when
        # candidate_override is on — Stage 4.6. Cost is a few dict appends per field per stage.
        if not produced:
            return
        for key, data in produced.items():
            if key.startswith('_') or not isinstance(data, dict):
                continue
            v = data.get('value')
            if not v:
                continue
            self._field_candidates.setdefault(key, []).append({
                'value':         v,
                'method':        data.get('method'),
                'confidence':    data.get('confidence') or 0,
                'stage':         stage,
                'authoritative': bool(data.get('authoritative')),
                'located':       bool(data.get('located')),
                'box':           data.get('box'),   # picker: value box (top-left norm) or None; inert to the ledger's consumers (Stage 4.6 + total reconciliation read named keys only)
            })

    @staticmethod
    def _override_eligible(incumbent: dict) -> bool:
        """A winner may be reconsidered ONLY if it is a generic/auto source — NEVER
        an authoritative ⊕ anchor, a Stage 0.5 located mapping/registration, or an
        admin label. This is what preserves the committed precedence guarantees."""
        if incumbent.get('authoritative'):
            return False
        m = incumbent.get('method')
        if _is_stage05_located(m) or m == 'keyword_override':
            return False
        return True

    def _best_challenger(self, key, incumbent, cands, fmt_entry, ftype):
        """Pick a retained candidate that CLEARLY beats the incumbent on the field's
        evidence axis, else None. Deterministic (tie-break: confidence desc, then
        value). Reuses shape_match_score (shaped) / value_quality.name_quality (name)
        — no parallel scoring."""
        inc_val = str(incumbent.get('value') or '')
        distinct = [c for c in cands if c.get('value') and str(c['value']) != inc_val]
        if not distinct:
            return None

        shapes = (fmt_entry or {}).get('shapes')
        if shapes:  # SHAPED field: prefer a candidate that matches a learned shape
            if format_anomaly_checker.shape_match_score(inc_val, fmt_entry) >= 0.8:
                return None  # incumbent already credible for this shape
            qualifying = [c for c in distinct
                          if format_anomaly_checker.shape_match_score(str(c['value']), fmt_entry) == 1.0]
        else:       # NAME-LIKE field: prefer a clearly higher-quality name
            try:
                from extraction import value_quality
            except Exception:
                return None
            if not value_quality.is_name_like_field(key):
                return None
            if value_quality.name_quality(inc_val) >= 0.5:
                return None
            qualifying = [c for c in distinct
                          if value_quality.name_quality(str(c['value'])) >= 0.6]
        if not qualifying:
            return None
        qualifying.sort(key=lambda c: (-(c['confidence'] or 0), str(c['value'])))
        return qualifying[0]

    def _build_candidate_emit(self, results, ocr_text=None):
        """Disambiguation picker (v1): for each NAME-LIKE non-supplier field carrying a
        validation_note with >=2 DISTINCT candidate values, build the picker list
        [{value, box, source_label, method, confidence}] (chosen value first, cap 3). Additive +
        inert (commits no value); the box comes from the anchor read's own capture (top-left norm,
        None for keyword/late reads). Kill switch FIELD_CANDIDATES_EMIT (default on)."""
        if os.environ.get("FIELD_CANDIDATES_EMIT", "1") == "0":
            return {}
        emit = {}
        for key, fld in results.items():
            if key.startswith("_") or not isinstance(fld, dict):
                continue
            if key == "supplier_name" or not value_quality.is_name_like_field(key):
                continue
            if not str(fld.get("validation_note") or "").strip():
                continue
            # dedup by _cmp_norm; within a group keep a boxed rep, then the higher confidence.
            by_norm = {}
            for c in (self._field_candidates.get(key) or []):
                v = c.get("value")
                if not v:
                    continue
                # Guard A (Oracle C4): an UN-BOXED candidate (keyword/hint/late — no located position on
                # THIS page) must actually appear in the page OCR text to be offered. A replayed hint like
                # "Sandpiper Hotels" that isn't on the page is dropped, so the picker never presents an
                # off-page value as "read from the page". Boxed candidates are inherently located → kept;
                # the CHOSEN winner is re-injected below regardless. FAIL-SAFE: no ocr_text → keep
                # (byte-identical). Reuses the proven on-page predicate. Kill switch CANDIDATE_OCR_VALIDATE.
                if (os.environ.get("CANDIDATE_OCR_VALIDATE", "1") != "0"
                        and c.get("box") is None and ocr_text
                        and not _template_identity_corroborated(v, ocr_text)):
                    continue
                nk = _cmp_norm(v)
                cur = by_norm.get(nk)
                if cur is None:
                    by_norm[nk] = c
                else:
                    c_boxed, cur_boxed = c.get("box") is not None, cur.get("box") is not None
                    if (c_boxed and not cur_boxed) or (c_boxed == cur_boxed
                            and (c.get("confidence") or 0) > (cur.get("confidence") or 0)):
                        by_norm[nk] = c
            # the CHOSEN value must always be an option even if it never entered the ledger.
            chosen_v = fld.get("value")
            chosen_norm = _cmp_norm(chosen_v) if chosen_v else None
            if chosen_v and chosen_norm not in by_norm:
                by_norm[chosen_norm] = {"value": chosen_v, "method": fld.get("method"),
                                        "confidence": fld.get("confidence") or 0, "box": fld.get("box")}
            reps = list(by_norm.values())
            if len(reps) < 2:
                continue
            reps.sort(key=lambda c: (0 if _cmp_norm(c.get("value")) == chosen_norm else 1,
                                     -(c.get("confidence") or 0), str(c.get("value"))))
            emit[key] = [{
                "value":        c.get("value"),
                "box":          c.get("box"),
                "source_label": _candidate_source_label(c.get("method")),
                "method":       c.get("method"),
                "confidence":   c.get("confidence") or 0,
            } for c in reps[:3]]
        return emit

    def _resolve_candidates(self, results, field_defs, supplier_name, document_slug):
        """Stage 4.6 — gated, deterministic, suggestion-first override. Runs only when
        candidate_override != 'off'. Never touches a protected winner, defers to a
        field that already has a note/corrected_to (one note per field)."""
        if self.candidate_override == 'off' or not self._field_candidates:
            return
        auto_fields = self.candidate_override_fields
        field_types = {f.get('key'): (f.get('type') or '') for f in (field_defs or [])}
        s_lower  = (supplier_name or '').lower().strip()
        dt_lower = (document_slug or '').lower().strip()
        n = 0
        for key, incumbent in list(results.items()):
            if key.startswith('_') or not isinstance(incumbent, dict):
                continue
            if incumbent.get('validation_note') or incumbent.get('corrected_to'):
                continue  # Stage 4/4.5 already spoke — one note per field
            if not self._override_eligible(incumbent):
                continue
            cands = self._field_candidates.get(key)
            if not cands:
                continue
            fmt_entry = (self.format_class_index.get((s_lower, dt_lower, key)) if s_lower else None) \
                        or self.format_class_index.get(('', dt_lower, key))
            challenger = self._best_challenger(key, incumbent, cands, fmt_entry, field_types.get(key))
            if not challenger:
                continue
            if self.candidate_override == 'auto' and field_types.get(key) in auto_fields:
                results[key] = {**incumbent,
                                'value':           challenger['value'],
                                'confidence':      challenger.get('confidence') or incumbent.get('confidence') or 0,
                                'overridden':      True,
                                'validation_note': f"auto-selected better-match candidate: {challenger['value']}"}
            else:  # suggest (default when on): never replace the value
                results[key] = {**incumbent,
                                'corrected_to':    challenger['value'],
                                'confidence':      min(incumbent.get('confidence') or 0, 70),
                                'validation_note': f"better-match candidate: {challenger['value']}"}
            n += 1
        if n:
            self.log(f"  Stage 4.6: {n} field(s) had a better-match candidate ({self.candidate_override})")

    # ── Dev-only extraction trace (no-op unless a trace callback is set) ────────
    # Emits structured field-lifecycle events for the hidden Dev Inspector. All
    # helpers short-circuit when self._trace is None, so normal (non-trace)
    # extraction does no extra work and produces no extra output. These never
    # mutate `results` — they only observe it, so merge outcomes are unchanged.
    def _t(self, event: str, **kw):
        if not self._trace:
            return
        ev = {"event": event}
        for k, v in kw.items():
            ev[k] = self._brief(v) if k == "vs" else v
        self._trace(ev)

    @staticmethod
    def _brief(d):
        if not isinstance(d, dict):
            return None
        return {"method": d.get("method"), "value": d.get("value"),
                "confidence": d.get("confidence")}

    def _snap(self, results: dict) -> dict:
        """Shallow per-field snapshot (method/value/confidence) of resolved fields."""
        return {k: self._brief(v) for k, v in results.items()
                if not k.startswith("_") and isinstance(v, dict)}

    def _trace_stage(self, stage: str, stage_results: dict, pre: dict, results: dict):
        """Emit stage_start, a candidate per field the stage proposed, the merge
        decision derived from the OBSERVED post-merge state (win/lose + the value
        it contended with), then stage_end. Pure observation."""
        if not self._trace:
            return
        self._t("stage_start", stage=stage)
        for key, cand in (stage_results or {}).items():
            if key.startswith("_") or not isinstance(cand, dict):
                continue
            self._t("candidate", stage=stage, field=key, method=cand.get("method"),
                    value=cand.get("value"), confidence=cand.get("confidence"))
            after = results.get(key)
            won = bool(after and after.get("value") == cand.get("value")
                       and after.get("method") == cand.get("method"))
            self._t("merge", stage=stage, field=key,
                    decision=("win" if won else "lose"),
                    method=cand.get("method"), value=cand.get("value"),
                    confidence=cand.get("confidence"),
                    vs=(pre.get(key) if won else after))
        self._t("stage_end", stage=stage)

    def _capture_slice(self, field, stage, page, bbox, pil_img, kind="target"):
        """Dev-only: save the exact crop used for an OCR attempt to the session
        temp dir and emit a typed `slice` trace event pointing at it. `kind` is
        'anchor' (the region used to find/verify the anchor) or 'target' (the
        region OCR'd for the field value). No-op unless a trace callback AND a
        slice dir are set. Never raises into extraction."""
        if not (self._trace and self._slice_dir):
            return
        try:
            import os
            self._slice_n += 1
            path = os.path.join(self._slice_dir, f"slice_{self._slice_n}_{kind}.png")
            pil_img.save(path)
            self._t("slice", field=field, stage=stage, kind=kind, page=page,
                    bbox=(list(bbox) if bbox else None), path=path)
        except Exception:
            pass  # diagnostics must never disrupt extraction

    def _trace_validation(self, pre: dict, results: dict):
        """Emit a validation event for any field that Stage 4/4.5 normalised,
        capped, corrected, or annotated."""
        if not self._trace:
            return
        for key, data in results.items():
            if key.startswith("_") or not isinstance(data, dict):
                continue
            b = pre.get(key)
            note      = data.get("validation_note")
            corrected = data.get("corrected_to")
            changed   = bool(b and b.get("value") != data.get("value"))
            capped    = bool(b and (b.get("confidence") or 0) > (data.get("confidence") or 0))
            if note or corrected or changed or capped:
                self._t("validation", field=key, value=data.get("value"),
                        confidence=data.get("confidence"), note=note,
                        corrected_to=corrected, was=(b.get("value") if b else None))

    def set_label_overrides(self, overrides: list):
        """Admin keyword label overrides (per-installation), merged onto the
        shipped patterns at Stage 1, scoped to each document's doc-type slug."""
        self.label_overrides = overrides or []
        if self.label_overrides:
            self.log(f"  Keyword label overrides: {len(self.label_overrides)} loaded")

    def _make_format_lookup(self, supplier_name, document_slug):
        """Per-field learned-format lookup used by the qualification gates: try
        the supplier-scoped entry first, then fall back to the doc-type-scoped one
        ('' supplier) so qualification works even when the supplier is never
        resolved (document-agnostic). Returns None when nothing is learned."""
        if not self.format_class_index or not document_slug:
            return None
        s = (supplier_name or '').lower().strip()
        d = document_slug.lower().strip()
        def lookup(fk):
            return (self.format_class_index.get((s, d, fk)) if s else None) \
                   or self.format_class_index.get(('', d, fk))
        return lookup

    def set_field_rules(self, rules: list):
        """Operator-taught field cleanup rules (Review right-click toolkit). Index
        by (supplier_lower, doctype_lower, field_key) → [rule, …] so the Stage 4.5
        winner loop can strip a learned leaked heading/column from a field value."""
        idx, ml = {}, {}
        for r in (rules or []):
            if not isinstance(r, dict) or not r.get('field_key') or not r.get('rule_type'):
                continue
            key = ((r.get('supplier_name') or '').lower().strip(),
                   (r.get('document_type') or '').lower().strip(),
                   r['field_key'])
            if r['rule_type'] == 'multiline_continue':
                # Continuation rule: trailing chars in token_norm (default -/–/—). Consulted
                # by the anchor READ step (_make_multiline_lookup), NOT the Stage 4.5 apply
                # loop below — joining must happen at the crop, not as a post-trim.
                ml[key] = {'pattern_chars': (r.get('token_norm') or '').strip() or '-–—'}
                continue
            idx.setdefault(key, []).append(r)
        self.field_rules_index = idx
        self._multiline_index  = ml
        if idx:
            self.log(f"  Field cleanup rules: {sum(len(v) for v in idx.values())} loaded")
        if ml:
            self.log(f"  Multi-line continuation rules: {len(ml)} loaded")

    def _make_multiline_lookup(self, supplier_name, document_slug):
        """Per-field multiline_continue lookup for the anchor read step: supplier+doctype →
        doctype-only ('') → '__global__'. Returns None when the feature is off or no rule is
        in scope (→ single-line read, byte-identical)."""
        if not self.multiline_enabled or not self._multiline_index:
            return None
        s = (supplier_name or '').lower().strip()
        d = (document_slug or '').lower().strip()
        idx = self._multiline_index
        def lookup(fk):
            for sk in ([s] if s else []) + ['', '__global__']:
                hit = idx.get((sk, d, fk))
                if hit:
                    return hit
            return None
        return lookup

    def _field_rules_for(self, supplier_name, document_slug, field_key):
        """Rules in scope for a field, most-specific scope first: supplier+doctype,
        then doctype-only ('' supplier), then the '__global__' supplier. Each rule is
        applied in turn; within a scope, remove_text rules run longest-token-first."""
        if not self.field_rules_index:
            return []
        s = (supplier_name or '').lower().strip()
        d = (document_slug or '').lower().strip()
        out = []
        for sk in ([s] if s else []) + ['', '__global__']:
            out.extend(self.field_rules_index.get((sk, d, field_key), []))
        # keep_block first, then remove_text longest-token-first (most specific wins).
        out.sort(key=lambda r: (0 if r.get('rule_type') == 'keep_block' else 1,
                                -len(r.get('token_norm') or '')))
        return out

    @staticmethod
    def _doctype_fixed_supplier(templates, document_slug):
        """The doc type's FIXED Supplier Name, taken from any template for this
        doc-type slug. A doc type whose Supplier Name is an admin-fixed template
        field has a DETERMINISTIC supplier — the page logo is irrelevant — so this
        lets the fixed value survive a MISSED template match and stay immune to the
        logo fallback (which otherwise fills supplier_name with a logo guess when no
        template matched). Prefers an admin-LOCKED value; uses a plain fixed value
        only when every candidate agrees (ambiguous → None, so we never guess).
        Returns {'value', 'method'} or None — None leaves behaviour byte-identical."""
        if not templates or not document_slug:
            return None
        slug = str(document_slug).strip()
        locked, plain = [], []
        for t in templates:
            if (t.get('document_type_slug') or '') != slug:
                continue
            for f in (t.get('fields') or []):
                if f.get('key') != 'supplier_name':
                    continue
                val = f.get('fixed_value')
                val = val.strip() if isinstance(val, str) else val
                if not val:
                    continue
                (locked if f.get('fixed_locked') else plain).append(val)
        for bucket, method in ((locked, 'template_fixed_locked'), (plain, 'template_fixed')):
            uniq = {v for v in bucket if v}
            if len(uniq) == 1:
                return {'value': next(iter(uniq)), 'method': method}
        return None

    def set_formats(self, formats_data: list):
        """Pre-build all format indexes from confirmed value data."""
        self.format_index        = ocr_corrector.build_format_index(formats_data)
        self.noise_profile_index = ocr_corrector.build_noise_profile_index(formats_data)
        self.dominant_index      = ocr_corrector.build_dominant_index(formats_data)
        self.known_index         = ocr_corrector.build_known_index(formats_data)
        self.prefix_index        = ocr_corrector.build_prefix_index(formats_data)
        self.format_class_index  = format_anomaly_checker.build_format_class_index(formats_data)
        n = len([k for k in self.format_index if k != '_fallback'])
        m = len(self.noise_profile_index)
        p = len(self.format_class_index)
        self.log(f"  OCR corrector: {n} format templates, {m} learned noise profile(s) loaded")
        if p:
            self.log(f"  Format checker: {p} format class rule(s) loaded")

    def detect_document_type(self, ocr_text: str,
                             known_types: list | None = None,
                             type_aliases: dict | None = None) -> dict | None:
        return keyword.detect_document_type(ocr_text, self.patterns, known_types, type_aliases)

    # Reconciliation roles that back the "mathematically verified" total check.
    _RECONCILE_COMPONENT_ROLES = ('subtotal', 'vat_tax', 'shipping', 'discount')

    def _shadow_reconcile_components(self, results, field_defs, ocr_text, patterns):
        """Shadow-extract the reconciliation COMPONENTS the doc type doesn't define as fields,
        so the total-reconciliation check can run without the user having to add them. Only
        runs when a real TOTAL field exists (nothing to verify otherwise). Values are tagged
        method='shadow_reconcile' so downstream code shows/learns nothing from them."""
        try:
            canon = ('total_amount',) + self._RECONCILE_COMPONENT_ROLES
            covered = set()
            for f in (field_defs or []):
                k = f.get('key')
                if k in canon:
                    covered.add(k)
                    continue
                for role, aliases in keyword.ROLE_KEY_ALIASES.items():
                    if k in aliases:
                        covered.add(role)
            if 'total_amount' not in covered:      # no total to reconcile against
                return
            uncovered = [r for r in self._RECONCILE_COMPONENT_ROLES if r not in covered]
            if not uncovered:
                return
            shadow = keyword.extract_fields(ocr_text, uncovered, patterns) or {}
            for k, data in shadow.items():
                if data and data.get('value') and not (results.get(k) or {}).get('value'):
                    d = dict(data)
                    d['method'] = 'shadow_reconcile'
                    results[k] = d
        except Exception:
            pass  # background aid — must never break extraction

    @staticmethod
    def _is_degraded_variant(fragment, canonical):
        """True when `fragment` is a CLIPPED CONTIGUOUS PIECE of `canonical` — the wandered-
        relocate identity class ('pplies Ltd' ⊂ 'Northgate Supplies Ltd', a crop that started
        mid-word; 'oplies Ltd' likewise). Comparison on the deterministic normalised form
        (text_normalise + lowercase + non-alnum runs collapsed to single spaces); the fragment
        must be STRICTLY shorter, carry ≥4 ALPHA chars (a 2-3 char scrap proves nothing), and
        be a contiguous substring — so two genuinely different names ('Northgate Support Ltd'
        vs 'Northgate Supplies Ltd') can NEVER collapse, and an OCR-noised variant ('0plies
        Ltd', zero for o) deliberately fails toward today's flag-only behaviour. Pure;
        guarded by tests/test_identity_variant.py."""
        try:
            import re as _re                      # engine.py has no module-level `re`
            from extraction.text_normalise import normalise_for_tokens
            def _norm(s):
                s = normalise_for_tokens(s or "").lower()
                return _re.sub(r"[^a-z0-9]+", " ", s).strip()
            f, c = _norm(fragment), _norm(canonical)
            if not f or not c or f == c or len(f) >= len(c):
                return False
            if len(_re.sub(r"[^a-z]", "", f)) < 4:
                return False
            return f in c
        except Exception:
            return False

    @staticmethod
    def _adopt_identity_variant(results, idv):
        """VARIANT CORROBORATION (2026-07-10 night — the 'pplies Ltd' case; gary-vetted).
        On an ACCEPTED identity-conflict verdict, when the pipeline's resolved supplier is a
        CLIPPED FRAGMENT of the letterhead's gazetteer canonical (_is_degraded_variant), adopt
        the canonical instead of committing the fragment: a wandered relocate that clipped
        "Northgate Su|pplies Ltd" mid-word must not mint 'pplies Ltd' as a supplier — a
        rubber-stamp confirm would then feed a junk learning scope. FRAGMENT-CARRIER GUARD
        (gary G1): the swap touches ONLY results['supplier_name'] and ONLY when that field's
        own value IS the fragment — on a customer-carrying type where the note lands on
        customer_name, a blind swap would stamp the ISSUER canonical over the RECIPIENT.
        Review by construction: conf capped ≤70, needs_review forced, and the note keeps BOTH
        names so the reviewer can judge/restore. Non-variant conflicts stay flag-only,
        byte-identically (the caller falls through to the existing note loop). Both supplier
        stamps (the field + _supplier_name, which the persist path consumes) move together —
        the CLAUDE.md "latest reliable resolution" invariant. Returns True when adopted.
        Guarded by tests/test_identity_variant.py."""
        try:
            canon = (idv.get("text_led") or "").strip()
            frag  = (idv.get("resolved") or "").strip()
            if not canon or not frag:
                return False
            if not ExtractionEngine._is_degraded_variant(frag, canon):
                return False
            f = results.get("supplier_name")
            if not (isinstance(f, dict) and (f.get("value") or "").strip()):
                return False
            import re as _re
            from extraction.text_normalise import normalise_for_tokens
            def _n(s):
                return _re.sub(r"[^a-z0-9]+", " ",
                               normalise_for_tokens(s or "").lower()).strip()
            if _n(f.get("value")) != _n(frag):
                return False
            f["value"]  = canon
            f["method"] = "identity_variant_adopt"
            f["confidence"] = min(int(f.get("confidence") or 100), 70)
            f["validation_note"] = (
                f"The issuer read “{frag}” looks like a clipped fragment of “{canon}” — "
                f"using the letterhead name; please confirm.")
            results["_supplier_name"] = canon
            results["_needs_review"] = True
            return True
        except Exception:
            return False

    def _compute_identity_verdict(self, ocr_text, logos, hints, anchors, resolved_supplier):
        """Compute the text-led SUPPLIER identity verdict (extraction/identity_fusion) over the page
        CHROME: does the issuer-band letterhead read the SAME supplier the pipeline resolved? Used by
        BOTH the shadow measurement (extract(identity_shadow=True), records only) and the active
        conflict flag (set_identity_conflict(True), raises needs_review on a CONFLICT). Mirrors
        _shadow_reconcile_components: a background aid that must never break extraction. Returns a
        compact verdict dict, or None when unavailable / not enough signal."""
        try:
            if not IDENTITY_FUSION_AVAILABLE:
                return None
            # Known-supplier gazetteer = every supplier the system has already learned, taken
            # from the logo/hint/anchor scopes ALREADY loaded for this doc (no new plumbing).
            known, seen = [], set()
            for src in (logos or [], hints or [], anchors or []):
                for row in src:
                    nm = ((row or {}).get("supplier_name") or "").strip()
                    if nm and nm.lower() not in seen:
                        seen.add(nm.lower())
                        known.append(nm)
            if not known:
                return None
            # ISSUER-band chrome: the top letterhead lines TRUNCATED at the first recipient marker
            # ("Bill To"/"Customer"/"FAO"/…), footer excluded (identity_fusion.issuer_chrome,
            # reggie-reviewed). Replaces a flat first-6/last-3 chrome that let identify_supplier
            # match a NON-issuer name in the gazetteer (recipient block / printer footer / line
            # item) — the real-engine precision hole the shadow measurement surfaced.
            chrome = identity_fusion.issuer_chrome(ocr_text)
            res = identity_fusion.identify_supplier(chrome, known)
            picked, accepted = res.get("supplier"), bool(res.get("accepted"))
            # "Multiple commits determine it's OK" fallback (user request): a letterhead can
            # legitimately carry a DIFFERENT known name than the issuer (a recipient / customer /
            # printer name in the header — e.g. Print Tracker docs). If the RESOLVED supplier is
            # ESTABLISHED — learned strongly from confirmed docs (logo match_count / hint /
            # anchor usage_count for it ≥ IDENTITY_ESTABLISHED_MIN) — trust it over the header
            # text and DON'T raise the conflict. A brand-new supplier (little history) still flags.
            def _strength(name):
                nl = (name or "").strip().lower()
                if not nl:
                    return 0
                best = 0
                for row in (logos or []):
                    if ((row or {}).get("supplier_name") or "").strip().lower() == nl:
                        best = max(best, int((row or {}).get("match_count") or 0))
                for src in (hints or [], anchors or []):
                    for row in src:
                        if ((row or {}).get("supplier_name") or "").strip().lower() == nl:
                            best = max(best, int((row or {}).get("usage_count") or 0))
                return best
            # Trust the resolved issuer when it is EITHER explicitly accepted (the one-click
            # "Issuer is correct" button → accepted_issuers allowlist) OR established by history.
            accepted_issuer = self._accept_norm(resolved_supplier) in self.accepted_issuers
            established = _strength(resolved_supplier) >= IDENTITY_ESTABLISHED_MIN
            trusted = accepted_issuer or established
            return {
                "resolved":    resolved_supplier,
                "text_led":    picked,
                "accepted":    accepted,
                "confidence":  res.get("confidence"),
                "known_n":     len(known),
                "established": established,
                "accepted_issuer": accepted_issuer,
                "conflict":    (accepted and bool(resolved_supplier)
                                and picked != resolved_supplier and not trusted),
                "agree":       accepted and picked == resolved_supplier,
            }
        except Exception:
            return None  # background aid — must never break extraction

    def _flag_branding_conflict(self, results, supplier_name, templates, ocr_text):
        """BRANDING-CONFLICT cross-check (Oracle 2026-07-12) — the logo-collision wrong-supplier
        class (a Thornbury docket auto-filing as Cascade because their monogram logos collide and
        Cascade's logo set was poisoned with Thornbury prints). When the resolved supplier X's OWN
        printed branding is essentially ABSENT from the page — we resolved X (via logo / same-logo
        sibling template / fixed supplier), yet the letterhead words that identify X aren't there —
        cap the supplier field <=69, attach a review NOTE (naming the branding-detected alternative
        if one is decisively present), and set needs_review. FLAG-ONLY — the value is never changed
        — with ONE carve-out (BRANDING_NAMED_BLANK, slice 4 2026-07-20): a NAMED rival on the
        issuer-band fuzzy path against a plain 'template_fixed' frozen stamp BLANKS the value and
        the _supplier_name scope (see the inline comment; locked/manual/un-named never blank).
        The NOTE is what actually blocks the wrong auto-file (trust.isAutoFileEligible refuses any
        non-empty validation_note; the cap alone does not block at overall==100). Covers the logo +
        template_fixed + fixed-supplier paths at one seam. Reuses template keyword-fingerprints +
        template_matcher._keyword_hit_ratio (word-boundary; NO new dependency; works with
        identity_fusion absent — the packaged-build reality). Kill switch BRANDING_CONFLICT_GUARD.

        Exemptions (Oracle C1): method 'manual' (operator typed it on THIS doc); resolved in
        accepted_issuers (the 'Issuer is correct' allowlist); the resolved supplier's own branding is
        PRESENT (own_ratio > LOW); or it carries fewer than K distinctive fingerprint words (logo-only
        / unjudgeable -> fail-safe, no flag). template_fixed_locked / keyword_override are
        deliberately NOT exempt — the template path stamps template_fixed_locked, so exempting it
        would reopen the exact hole this guard closes."""
        if os.environ.get("BRANDING_CONFLICT_GUARD", "1") == "0":
            return
        if not supplier_name or not templates or not ocr_text:
            return
        fld = results.get("supplier_name")
        if not isinstance(fld, dict) or not fld.get("value"):
            return
        if fld.get("method") == "manual":
            return
        if self._accept_norm(supplier_name) in self.accepted_issuers:
            return
        from extraction import template_matcher
        banks = _branding_banks(templates, self._accept_norm)
        own_ratio = _branding_own_ratio(supplier_name, banks, ocr_text, self._accept_norm)
        if own_ratio is None:
            return  # no >=K-word fingerprint for the resolved supplier -> can't judge (fail-safe)
        if own_ratio > _BRANDING_PRESENT_RATIO:
            return  # the resolved supplier's own branding IS on the page -> healthy, no flag
        named, _fuzzy = _branding_alt_name(banks, ocr_text, self._accept_norm(supplier_name))
        _blank = False
        if named:
            note = (f"The page branding reads '{named}', but this was filed under '{supplier_name}'. "
                    "Please confirm the correct company.")
            # Additive suggestion for a renderer "Use '<name>'" one-click button (Slice 2). The engine
            # VALUE stays the honestly-resolved supplier — no _supplier_name change, no filing/scope write
            # on a fuzzy match (Oracle/gary: the value-change belongs at confirm-time in the renderer).
            # ONLY emitted on the safe issuer-band FUZZY path: the =0 revert uses the legacy exact
            # whole-page scan (which can name a recipient), so it must not feed an actionable button.
            if _fuzzy:
                fld["suggested_supplier"] = named
            # BRANDING_NAMED_BLANK (slice 4 of the template-misfile fix, Oracle-signed 2026-07-20):
            # when the branding evidence POSITIVELY names a different supplier and the wrong value
            # came from a FROZEN template stamp, don't leave the wrong name standing as the
            # on-screen value / filing folder / learning scope — BLANK it (note + suggestion kept;
            # the renderer's "Use '<name>'" button renders on a value-less row, the abstain-speak
            # precedent). Scope is deliberately narrow, every leg load-bearing:
            #   * _fuzzy only — the legacy exact whole-page scan can name a RECIPIENT; issuer-band
            #     evidence only (the same standard as the actionable button).
            #   * method 'template_fixed' EXACTLY — template_fixed_locked is deliberate admin
            #     intent (stays flag-only, pinned) and 'manual' returned above; other methods have
            #     their own text gates upstream.
            #   * the UN-NAMED branch below NEVER blanks — on a degraded scan of a GENUINE
            #     supplier, own-absence is the only evidence, and blanking there deletes correct
            #     identities (the exact reason the C2 sufficiency floor exists).
            # results['_supplier_name'] is blanked too — it was stamped BEFORE this check runs, and
            # blanking the field alone would leave the wrong name as the filing/learning scope
            # (precedent: _adopt_identity_variant). Kill switch BRANDING_NAMED_BLANK=0.
            if (_fuzzy and fld.get("method") == "template_fixed"
                    and os.environ.get("BRANDING_NAMED_BLANK", "1") != "0"):
                _blank = True
                note = (f"The page branding reads '{named}', but this matched a template belonging "
                        f"to '{supplier_name}' — so nothing was assumed. "
                        "Please confirm the correct company.")
        else:
            note = (f"This document's letterhead doesn't match '{supplier_name}'. "
                    "Please confirm the correct company.")
        existing = str(fld.get("validation_note") or "").strip()
        fld["validation_note"] = (existing + " " + note).strip() if existing else note
        fld["confidence"] = min(int(fld.get("confidence") or 100), 69)
        if _blank:
            fld["value"] = None
            fld["confidence"] = 0
            results["_supplier_name"] = None
        results["_needs_review"] = True

    @staticmethod
    def _flag_cross_field_duplication(results):
        """CROSS-FIELD DUPLICATION guard — Slice 1 (2026-07-10 night; gary-designed, built on
        the user's explicit policy override of the Slice-0 do-nothing gate: belt-and-braces
        over conditional deployment). A NAME-LIKE field whose committed value CONTAINS a
        sibling STRUCTURED field's whole high-trust value (customer = "Reference 'WS703182"
        beside reference_number=WS703182@95, KO_wor_41) is a WRONG-ROW capture by a wandered
        anchor. HOLD-ONLY, deterministic where wordness is probabilistic (wordness
        self-disables on scopes whose confirmed history went code-like — gary's F3): cap ≤69
        + note + needs_review; the VALUE is never touched, an existing (e.g. wordness) note is
        preserved (the cap still applies), and manual/authoritative/override methods are
        exempt. Sibling bar: non-name-like key, conf ≥80, itself un-noted; the string
        predicate (whole-value token-bounded containment, digit-required, len≥5 — the
        "2026 Holdings Ltd" year class can't fire) is value_quality.contains_structured_sibling,
        SHARED with stress_test/crossfield_sweep.py so the sweep stays the offline regression
        twin. Guarded by tests/test_cross_field_duplication.py."""
        try:
            from extraction.value_quality import is_name_like_field, contains_structured_sibling
            _EXEMPT = ("manual", "template_fixed", "template_fixed_locked", "keyword_override")
            sibs = []
            for k, f in results.items():
                if k.startswith("_") or not isinstance(f, dict):
                    continue
                if is_name_like_field(k):
                    continue
                if not (f.get("value") or "").strip():
                    continue
                if int(f.get("confidence") or 0) < 80 or (f.get("validation_note") or "").strip():
                    continue
                sibs.append((k, str(f.get("value"))))
            if not sibs:
                return
            for k, f in results.items():
                if k.startswith("_") or not isinstance(f, dict):
                    continue
                if not is_name_like_field(k) or not (f.get("value") or "").strip():
                    continue
                if str(f.get("method") or "") in _EXEMPT:
                    continue
                for sk, sv in sibs:
                    if sk == k:
                        continue
                    if contains_structured_sibling(f.get("value"), sv):
                        # 69 is SELF-SUFFICIENT review routing (the recipient guard's
                        # construction): 69 < the default 70 per-field threshold trips
                        # validator.needs_review, and the NOTE blocks auto-file at every
                        # trust threshold + bulk File-All-Ready. Do NOT set
                        # results['_needs_review'] here — the later pipeline computation
                        # reassigns it unconditionally, so a set here is dead code
                        # (Oracle A2, 2026-07-10).
                        f["confidence"] = min(int(f.get("confidence") or 100), 69)
                        if not (f.get("validation_note") or "").strip():
                            f["validation_note"] = (
                                f"This value appears to contain the document's "
                                f"{sk.replace('_', ' ')} “{sv}” — please verify.")
                        break
        except Exception:
            pass  # a guard must never break extraction

    @staticmethod
    def _suppress_buyer_seller_issuer(kw_results, buyer_issued, accepted_norms, accept_norm):
        """BUYER-ISSUED ISSUER GUARD (Oracle 2026-07-12) — pure. On a buyer-issued type (Purchase
        Order), a supplier_name (Document Issuer) KEYWORD read that matched a 'Supplier'/'Vendor'/
        'Seller' caption names the SELLER (the party the buyer is ordering from), NOT the issuer (the
        buyer, in the un-captioned letterhead). DROP it so it never becomes results['supplier_name']
        and thus the resolved filing/learning SCOPE (engine.py:2259 reads .value, not confidence —
        the @40 cap other guards use is a no-op here, and a plausible vendor also BLOCKS the 2.5a
        hint fallback). The issuer then falls to logo/letterhead/hint or empty→review, consistent
        with every other type on a cold-start DB. Returns the dropped value (so the caller can record
        it — Stage 2.5a must not silently re-adopt it, Oracle C1), else None.

        Fires ONLY on a plain 'keyword' read whose recorded matched label (keyword.py:614) is a
        seller caption (reuses keyword._IDENTITY_CAPTION_LABELS). A genuine issuer caption
        ('Issued By'/'Bill From'/'Company Name'), a learned/logo/manual/keyword_override read
        (method != 'keyword'), and an operator-accepted value (accepted_issuers ∪ accepted_names,
        Oracle C4) are all left untouched. Kill switch BUYER_ISSUED_ISSUER_GUARD (default ON)."""
        if os.environ.get("BUYER_ISSUED_ISSUER_GUARD", "1") == "0":
            return None
        if not buyer_issued:
            return None
        sn = kw_results.get("supplier_name")
        if not isinstance(sn, dict) or str(sn.get("method") or "") != "keyword":
            return None
        if str(sn.get("label") or "").strip().lower() not in keyword._IDENTITY_CAPTION_LABELS:
            return None
        val = sn.get("value")
        if val and accept_norm(val) in (accepted_norms or set()):
            return None   # operator allowlisted this as a real issuer — respect it
        kw_results.pop("supplier_name", None)
        return val

    def _flag_recipient_caption_issuer(self, results, field_defs, supplier_name):
        """RECIPIENT-CAPTION ISSUER GUARD (flag-only, never rewrites — Oracle-signed
        2026-07-09). When a doc type's IDENTITY field is customer_name (its "Document
        Issuer" — the type carries NO supplier_name field, mirroring COMPANY_KEYS
        precedence; a type with BOTH keys has supplier_name as identity and customer_name
        as a genuine recipient field that must not be nagged), a plain 'keyword' read of
        it is BY CONSTRUCTION a recipient-caption read — the shipped label bank is
        entirely "Bill To"/"Customer"/"Client"/… — and so names the RECIPIENT, not the
        issuer (a sales order's buyer "Dunroamin Caravan Park" would file the doc under
        the buyer at an unflagged 78%).

        Flag for review: cap confidence at 69 — deliberately BELOW the review threshold
        (validator.needs_review trips on < 70, so the codebase-conventional 70 caps do
        NOT force review on their own; 69 is self-sufficient) — and plant an explanatory
        note (which also blocks auto-file: the trust gate refuses any noted doc). An
        already-noted field keeps its note but still gets the cap.

        EXEMPT (no nag): every learned/taught/human method (template_fixed[_locked],
        keyword_override, anchor*, template_mapping, hint, manual — anything not plain
        'keyword') — those ARE the "intelligent methods" that legitimately fill the
        issuer on subsequent documents; the operator allowlists (accepted_names /
        accepted_issuers, "this name/issuer is correct"); and a value that AGREES with
        the RESOLVED supplier identity under the engine's own normaliser (it plainly IS
        the issuer). First doc from an unknown sender → flagged → the human confirms or
        types the issuer, exactly the fail-toward-review the identity role demands.
        Best-effort: never breaks extraction."""
        try:
            fd_keys = {f.get('key') for f in (field_defs or [])}
            if 'customer_name' not in fd_keys or 'supplier_name' in fd_keys:
                return
            cn = results.get('customer_name')
            if not isinstance(cn, dict):
                return
            val = cn.get('value')
            if not val or str(cn.get('method') or '') != 'keyword':
                return
            norm = self._accept_norm(val)
            if norm in self.accepted_names or norm in self.accepted_issuers:
                return

            def _nsi(v):
                return keyword.normalize_supplier_name(v or '').strip().lower()
            if supplier_name and _nsi(val) == _nsi(supplier_name):
                return
            cn['confidence'] = min(int(cn.get('confidence') or 0), 69)
            if not str(cn.get('validation_note') or '').strip():
                cn['validation_note'] = (
                    "Document Issuer was read from a customer/recipient caption — "
                    "this may be the recipient, not the issuer. Please confirm.")
            self.log(f"  Issuer guard: customer_name read '{val}' came from a "
                     f"recipient caption — flagged for review")
        except Exception:
            pass   # advisory guard — must never break extraction

    def _drop_positional_identity_read(self, results, field_defs):
        """IDENTITY POSITIONAL-READ DROP (cross-supplier issuer-bleed fix; gary+Oracle-signed,
        narrowed by Oracle SEND-BACK 2026-07-15).

        MECHANISM (verified in the live code — NOT the stale "cross-supplier sweep" narrative; the
        authoritative saveAnchor sweep was scoped to one supplier on 2026-07-09, learning.js:523-529).
        The bleed is READ-TIME: anchor._anchor_matches admits a DIFFERENT supplier's identity anchor
        onto this doc-type by design (the identity branch — so a supplier's own caption can correct a
        wrong template guess). anchor._is_blind_cross_supplier_anchor would drop such a foreign read,
        but it runs only when `not located_ok` — and `anchor_registration` is flagged located_ok=True
        by method fiat (anchor.py:1134-1136) despite placing its box by landmark GEOMETRY with no
        caption verification. So a foreign position-only ISSUER teach reads THIS page at its landmark
        position → a column header ("Item") or recipient caption ("Ship To:") → junk that, uncaught,
        becomes results['supplier_name'] and thus the resolved filing/learning SCOPE. All 14 live
        SuperStore cases are anchor_registration with no caption.

        This drop is the COMPLEMENT that plugs exactly that located_ok=True bypass — it fires ONLY for
        `anchor_registration` identity reads (see _is_positional_identity_read). A live audit found
        ZERO confirmed docs whose issuer resolves via any positional read (wins are logo /
        template_fixed / template_identity / hint_text_match / keyword / manual), so it removes NO
        committed win. Content-located own-caption anchor reads (Greenfield's 'Supplier:'), blind
        rigid anchor_crop (already dropped by the existing guard), and admin-curated Stage-0.5
        template_mapping reads are all LEFT ALONE — the original broad predicate regressed those
        (test_supplier_identity_stability / test_supplier_name_precedence) for no safety gain.

        DROP (value=None + conf 0 + note), NOT a review-cap: a capped "Item" stays visible AND still
        scopes downstream learning. Keep the dict (do NOT pop the key — the synthesised
        type_ambiguity carrier and other readers expect supplier_name present). resolved_supplier
        (read just after the call site) then falls to Stage 2.5a hint recovery / logo / keyword, or
        empty→review — never a different WRONG supplier (Stage-2.5a only adopts a plausible, usage≥3,
        on-page hint; the E2E resolves all 14 → the correct 'SuperStore').

        Per-type identity key (_identity_key_for_type) so a RECIPIENT customer_name positional read
        on a dual-key type (disambiguation picker / late rescue / taught recipient) is UNAFFECTED.
        Kill switch env IDENTITY_POSITIONAL_DROP (default ON) → =0 is byte-identical. Best-effort:
        never breaks extraction."""
        if os.environ.get("IDENTITY_POSITIONAL_DROP", "1") == "0":
            return
        try:
            id_key = _identity_key_for_type(field_defs)
            if not id_key:
                return
            read = results.get(id_key)
            if not isinstance(read, dict) or not read.get('value'):
                return
            if not _is_positional_identity_read(read.get('method')):
                return
            self.log(f"  Identity positional-read drop: {id_key} read '{read.get('value')}' via "
                     f"'{read.get('method')}' (taught position, not this page's own content) — "
                     f"dropped; issuer falls to hint/logo/keyword or review")
            results[id_key] = {
                "value":           None,
                "confidence":      0,
                "method":          read.get('method'),
                "validation_note": ("The Document Issuer was read from a remembered position that "
                                    "belongs to a different sender's layout, so it wasn't trusted on "
                                    "this document. Please confirm who issued this."),
            }
        except Exception:
            pass   # advisory guard — must never break extraction

    def _flag_prefix_outlier(self, results, field_defs, supplier_name, document_slug):
        """PREFIX-OUTLIER GUARD (flag-only, never rewrites — reggie-designed, Oracle-vetted 2026-07-12).
        A VARIABLE reference/code field can have a dominant leading-alpha PREFIX (DN / INV / PO / SO) in
        its confirmed history. A skew-driven single-glyph misread of that prefix (DN->IN, DN->YN) is
        SHAPE-VALID — it passes the reference regex + every format/credibility/critical-floor gate — so
        it auto-files at 95%+ and POISONS the learned set. This is the only guard that can see it: the
        read's prefix is a same-length single-substitution (Hamming-1) neighbour of the dominant but is
        NOT itself a confirmed prefix. FLAG for review — cap confidence at 69 (below the <70 review trip
        AND the 88 auto-file floor) + note; the VALUE is NEVER touched (the digits are per-doc variable,
        so the misread can't be corrected, only refused). EXEMPT: override/manual/template_fixed methods
        (human-set, not an OCR read); name fields; strictly-typed non-code fields. A TAUGHT-ANCHOR read
        is deliberately NOT exempt (the teach fixed the position, not the value — the evidenced case).
        SELF-HEALS: a genuinely-new legit prefix is flagged once, the operator confirms, it joins the
        known set, and never flags again; a scope that legitimately uses two prefixes never has one at
        >=80% share, so the guard disarms there. Kill switch env PREFIX_OUTLIER_GUARD (default ON).
        Best-effort: never breaks extraction."""
        if os.environ.get('PREFIX_OUTLIER_GUARD', '1') == '0' or not self.prefix_index:
            return
        try:
            from extraction.value_quality import is_name_like_field
            _skip_types = {'date', 'currency', 'number', 'percentage', 'email', 'iban', 'vat_gb',
                           'postcode_uk', 'ip_address', 'mac_address', 'currency_code', 'website'}
            type_by_key = {f.get('key'): (f.get('type') or '').lower() for f in (field_defs or [])}
            for key, data in results.items():
                if key.startswith('_') or not isinstance(data, dict):
                    continue
                val = data.get('value')
                if not val or is_name_like_field(key) or type_by_key.get(key) in _skip_types:
                    continue
                method = str(data.get('method') or '')
                if any(m in method for m in ('override', 'manual', 'template_fixed')):
                    continue
                rec = ocr_corrector.lookup_prefix(self.prefix_index, key, supplier_name, document_slug)
                if not rec:
                    continue
                p = ocr_corrector.code_prefix(val)
                if not p or not ocr_corrector.is_prefix_outlier(p, rec):
                    continue
                data['confidence'] = min(int(data.get('confidence') or 0), 69)
                if not str(data.get('validation_note') or '').strip():
                    data['validation_note'] = (
                        f"This {key.replace('_', ' ')} starts '{p}', but this sender's usually start "
                        f"'{rec['dominant']}' — likely a one-character misread. Please check.")
                self.log(f"  Prefix-outlier guard: {key} read prefix '{p}' vs dominant "
                         f"'{rec['dominant']}' — flagged for review")
        except Exception:
            pass   # advisory guard — must never break extraction

    def _flag_taught_field_ownership(self, results, field_defs, supplier_name,
                                     anchors, hints, document_slug, caption_vocab):
        """TAUGHT-FIELD OWNERSHIP GUARD (flag-only — Oracle-signed 2026-07-11, DIRECTION_SUPREMACY
        c2). A NON-identity field whose FINAL read is a plain 'keyword' match, while the user has
        AUTHORITATIVELY TAUGHT that field's position for this scope (a ⊕ anchor carrying
        last_authoritative_at, admissible under the resolved supplier + doc-type), is a generic-
        caption keyword read STANDING IN for a taught position that couldn't be confirmed on this
        page — cap it to review (69, self-sufficient below the 70 threshold) + an explanatory note.
        HOLD-ONLY: the value is never touched; an existing note is preserved (its cap still applies).

        EXEMPT: keyword_override (BY CONSTRUCTION — its method is 'keyword_override', not 'keyword',
        so the shipped override-wins doctrine is untouched); an empty/None value (a Stage-4.5-
        withheld field must not get a confusing cap); and a keyword value that AGREES with a same-
        scope confirmed HINT that WOULD fill this field — TRUE _apply_hints parity: usage>=2, not
        is_variable, and not variable-BY-EVIDENCE (>=2 distinct confirmed in-scope values) — UNLESS
        that hint value is itself a known caption (closes the twice-mis-confirmed-caption-hint
        poison loop). Identity fields (supplier_name/customer_name) are handled by the recipient/
        rescue guards, never here.

        Ownership admission uses anchor.anchor_admissible with the doc-type SLUG (field_anchors.
        document_type stores the SLUG — verified against the live DB and matching what the Stage-2
        anchor path passes, engine.py extract_with_anchors(..., document_slug, ...); the design's
        "stores the NAME" premise was WRONG and would silently empty `owned`) PLUS an explicit
        exclusion of the __unknown__/__global__/'' fallback scopes that anchor_admissible over-
        admits — so a global fallback teach can't claim per-scope ownership. Best-effort: never
        breaks extraction."""
        if not TAUGHT_FIELD_OWNERSHIP_ENABLED:
            return
        try:
            from extraction import text_normalise
            fd = {f.get('key'): f for f in (field_defs or [])}
            # Per-type IDENTITY keys to EXCLUDE (they're handled by the recipient/rescue guards).
            # NOT _IDENTITY_FIELD_KEYS: that frozenset still lists customer_name (pre-migration-44),
            # but post-44 customer_name is an ORDINARY RECIPIENT field whenever the type also carries
            # supplier_name — and THAT is exactly the incident field c2 must arm. So: supplier_name is
            # always identity; customer_name is identity (recipient-guard territory) ONLY when it is
            # the type's SOLE issuer (no supplier_name field). Mirrors _flag_recipient_caption_issuer.
            _identity_keys = {'supplier_name'}
            if 'supplier_name' not in fd and 'customer_name' in fd:
                _identity_keys = {'customer_name'}
            # Which NON-identity fields does the user OWN here (an authoritative, real-scope teach)?
            owned = set()
            for a in (anchors or []):
                fk = a.get('field_key')
                if not fk or fk in _identity_keys:
                    continue
                if not str(a.get('last_authoritative_at') or '').strip():
                    continue   # ownership = an EXPLICIT ⊕ re-teach, not a passive auto-learn
                a_sup = (a.get('supplier_name') or '').strip().lower()
                if a_sup in ('__unknown__', '__global__', ''):
                    continue   # the fallback scope is NOT per-(supplier,type) ownership
                if anchor.anchor_admissible(a, supplier_name, document_slug):
                    owned.add(fk)
            if not owned:
                return

            s_lower = (supplier_name or '').lower().strip()
            # variability parity (mirrors _apply_hints): distinct confirmed in-scope values per key
            distinct = {}
            for h in (hints or []):
                hk = h.get('field_key'); hv = (h.get('hint_value') or '').strip().lower()
                if not hk or not hv:
                    continue
                hs = (h.get('supplier_name') or '').lower().strip()
                ht = h.get('document_type') or ''
                if hs == s_lower and ((not ht) or ht == (document_slug or '')):
                    distinct.setdefault(hk, set()).add(hv)

            def _hint_exempt(key, val):
                # A same-scope confirmed hint that WOULD fill `key` and AGREES with the keyword
                # value (and is not itself a caption) means this keyword read is the legit stable
                # value, not a caption stand-in — don't cap it.
                if not s_lower or fd.get(key, {}).get('is_variable'):
                    return False
                if len(distinct.get(key, ())) >= 2:
                    return False   # variable by evidence — a hint would NOT fill; never exempt
                target = text_normalise.normalise_for_tokens(val)
                for h in (hints or []):
                    if h.get('field_key') != key or int(h.get('usage_count') or 0) < 2:
                        continue
                    hs = (h.get('supplier_name') or '').lower().strip()
                    ht = h.get('document_type') or ''
                    if not (hs == s_lower and ((not ht) or ht == (document_slug or ''))):
                        continue
                    hv = h.get('hint_value')
                    if text_normalise.normalise_for_tokens(hv) != target:
                        continue   # the hint must AGREE with the keyword value
                    if keyword.value_is_caption(hv, caption_vocab):
                        return False   # poisoned caption-hint — deny the exemption
                    return True
                return False

            def _anchor_corroborates(key, val):
                # CORROBORATION EXEMPTION (gary+Oracle 2026-07-15): the taught position ITSELF confirmed
                # this value if a same-field candidate TIED TO THAT POSITION — authoritative (the ⊕ teach),
                # genuinely located, or a Stage-0.5 mapping — read the EXACT SAME value the keyword winner
                # did. Then it's not a generic-caption stand-in; don't cap. Oracle C1: a BLIND non-
                # authoritative anchor (passive / __global__ / Stage-2.6 late-rescue blind rigid read) may
                # NOT vouch — it reads arbitrary fixed-position text, not the protected taught position.
                # BOTH the committed value AND the candidate must be NON-caption (two methods both grabbing
                # a caption is not corroboration). Sub-switch TAUGHT_OWNERSHIP_CORROBORATE.
                if not TAUGHT_OWNERSHIP_CORROBORATE:
                    return False
                if keyword.value_is_caption(val, caption_vocab):
                    return False
                target = text_normalise.normalise_for_tokens(val)
                if not target:
                    return False
                for c in (getattr(self, '_field_candidates', {}) or {}).get(key, ()):
                    if not (c.get('authoritative') or c.get('located')
                            or _is_stage05_located(c.get('method'))):
                        continue   # Oracle C1: only an ownership-tied read may vouch
                    if text_normalise.normalise_for_tokens(c.get('value')) == target:
                        return True
                return False

            for key in owned:
                d = results.get(key)
                if not isinstance(d, dict):
                    continue
                if str(d.get('method') or '') != 'keyword':   # keyword_override & learned methods exempt
                    continue
                val = d.get('value')
                if not val or not str(val).strip():            # skip empty/None (Stage-4.5 withhold)
                    continue
                if _hint_exempt(key, val):
                    continue
                if _anchor_corroborates(key, val):
                    continue
                d['confidence'] = min(int(d.get('confidence') or 0), 69)
                if not str(d.get('validation_note') or '').strip():
                    d['validation_note'] = (
                        "this field has a taught position that couldn't be confirmed on this "
                        "page — the value came from a generic caption match; please verify "
                        "(re-teach with the ⊕ tool, or Settings → Learning Recovery)")
                self.log(f"  Taught-ownership guard: '{key}' keyword read '{val}' capped — "
                         f"an authoritative teach exists but wasn't located on this page")
        except Exception:
            pass   # advisory guard — must never break extraction

    def _rescue_identity_from_scope(self, results, field_defs, supplier_name,
                                    document_slug, hints):
        """IDENTITY RESCUE, slice 1 (gary's design, Oracle-signed 2026-07-10). The one
        case no path could fix: the type's IDENTITY field (customer_name — "Document
        Issuer") holds QUALITY-FAILED junk from a plain keyword read ('SO #' from an
        OCR row-merge), while the system already KNOWS the issuer — the supplier scope
        resolved STRUCTURALLY (logo/template) AND the user has confirmed the same
        issuer into this exact scope's hints (usage>=2). Hints fill EMPTY fields only,
        a positional teach reads blind at conf<=50 and loses the merge, and the
        recipient-caption guard flags but never repairs — so the user re-typed the
        same issuer forever.

        DUAL-SOURCE corroboration, then REPLACE — never silently:
          * incumbent must be plain 'keyword' (base method, C1) AND quality-failed
            (note present / conf<70 / value withheld) AND not operator-accepted;
          * resolved supplier must be a STRUCTURAL origin (_IDENTITY_STRUCTURAL_METHODS
            — never hint/keyword-derived) and a plausible name;
          * the corroborating hint comes from _apply_hints VERBATIM (inherits the
            usage>=2 / schema-variable / >=2-distinct-values-in-scope guards — a
            genuinely variable customer field can never be stamped) and must
            normalise-EQUAL the resolved supplier (conflicting evidence => no rescue).
        The substitution is conf 69 — BELOW the per-field review threshold (default 70;
        validator.needs_review trips on <70) — with a note QUOTING the replaced read:
        the note is the ONLY durable record of the original (the handler persists the
        final value into raw/display alike) and is the second auto-file lock
        (trust.js:344-350 refuses any noted doc at every threshold). Review shows the
        correct issuer pre-filled with provenance; a blind confirm files the RIGHT
        thing. Fail-toward-review by construction, never a silent write.
        Best-effort: never breaks extraction."""
        try:
            if not IDENTITY_RESCUE_ENABLED or not hints or not supplier_name:
                return
            fd_keys = {f.get('key') for f in (field_defs or [])}
            if 'customer_name' not in fd_keys or 'supplier_name' in fd_keys:
                return
            sn = results.get('supplier_name')
            if not isinstance(sn, dict):
                return                       # no structural identity written for this doc
            # Structural ORIGIN is the method, not the field value: Stage 4.5's display
            # format gate may WITHHOLD the supplier_name field's value (None + "enter
            # manually" note) while the RESOLVED scope (`supplier_name` arg, re-resolved
            # after every stage) survives — the real BF_sal_20 state. The dual-source
            # protection is unaffected: the corroborating hint must normalise-EQUAL the
            # resolved scope, so a garbage scope can never be stamped (no usage>=2 hint
            # equals garbage).
            if str(sn.get('method') or '').split('+')[0] not in _IDENTITY_STRUCTURAL_METHODS:
                return
            if not keyword._is_plausible_supplier_name(supplier_name):
                return
            cn = results.get('customer_name')
            if not isinstance(cn, dict):
                return
            if str(cn.get('method') or '').split('+')[0] != 'keyword':   # C1: base method, exact
                return
            val   = cn.get('value')
            conf  = int(cn.get('confidence') or 0)
            noted = bool(str(cn.get('validation_note') or '').strip())
            if val and not noted and conf >= 70:
                return                       # healthy read — never touched
            if val:
                norm = self._accept_norm(val)
                if norm in self.accepted_names or norm in self.accepted_issuers:
                    return                   # operator explicitly accepted this value

            def _nsi(v):
                return keyword.normalize_supplier_name(v or '').strip().lower()
            if val and _nsi(val) == _nsi(supplier_name):
                return                       # already the identity — nothing to rescue
            hinted = self._apply_hints(hints, supplier_name, document_slug,
                                       field_defs).get('customer_name')
            if not hinted or not hinted.get('value'):
                return                       # no guarded corroborating hint
            hint_value = hinted['value']
            if _nsi(hint_value) != _nsi(supplier_name):
                return                       # hint and identity disagree — conflicting evidence
            usage = 0
            s_l = supplier_name.lower().strip()
            for h in hints:
                if (h.get('field_key') == 'customer_name'
                        and (h.get('hint_value') or '') == hint_value
                        and (h.get('supplier_name') or '').lower().strip() == s_l):
                    usage = max(usage, int(h.get('usage_count') or 0))
            shown = str(val).strip() if val and str(val).strip() else 'nothing usable'
            # C6: wording pinned — must NOT match the issuer-conflict regex
            # (/letterhead may read|confirm the issuer/i) or the renderer's name-flag
            # regex, else the "Issuer is correct" button appears on a rescue note.
            results['customer_name'] = {
                'value':           hint_value,
                'display_value':   hint_value,
                'confidence':      69,
                'method':          'identity_rescue',
                'validation_note': (f"Document Issuer read '{shown}' from the page — "
                                    f"replaced with this supplier's confirmed issuer "
                                    f"(logo/template match + {usage} past confirmations). "
                                    f"Please confirm."),
            }
            self.log(f"  Identity rescue: customer_name '{shown}' -> '{hint_value}' "
                     f"(structural identity + confirmed hint x{usage}; review-flagged)")
        except Exception:
            pass   # advisory rescue — must never break extraction

    def _reconciliation_pick_total(self, results, field_defs):
        """Reconciliation-aware total pick. If the resolved `total` does NOT balance against the
        components (subtotal + tax + shipping - discount) but a confident REMEMBERED candidate
        DOES, swap to it. Objective arithmetic beats a drifted total-mapping / wrong-row anchor
        that displaced a correct keyword read (the "total grabbed the Net-Total row 84.40 over the
        Invoice-Total 101.28" case).

        A genuinely-CORRECT total — including a hand-drawn ⊕ teach — reconciles, so it passes the
        first check and is NEVER touched: the reconciliation check IS the protection, so no special
        authoritative carve-out is needed. Only a total that PROVABLY doesn't add up is reconsidered,
        and only replaced by a candidate that (a) actually balances and (b) is confident (>= floor),
        so a weak/garbage read can't win. The swap is review-flagged. Runs AFTER shadow-reconcile
        (all components present) and BEFORE the Stage-4 flag, so a swapped total validates clean.
        Best-effort — never breaks extraction."""
        try:
            from extraction import validator as _v
            total_key = None
            for k in ('total_amount', *keyword.ROLE_KEY_ALIASES.get('total_amount', ())):
                d = results.get(k)
                if isinstance(d, dict) and d.get('value'):
                    total_key = k
                    break
            if not total_key:
                return
            inc = results[total_key]
            if _v.total_reconciles(inc.get('value'), results):
                return   # already balances (a correct total, incl. a correct teach) — leave it
            inc_v = str(inc.get('value') or '')
            # Highest-confidence DISTINCT, CONFIDENT candidate that reconciles wins.
            for c in sorted(self._field_candidates.get(total_key) or [], key=lambda c: -(c.get('confidence') or 0)):
                cv = c.get('value')
                if not cv or str(cv) == inc_v or (c.get('confidence') or 0) < _RECON_PICK_MIN_CONF:
                    continue
                if _v.total_reconciles(cv, results):
                    self._t('reconcile_pick', field=total_key, was=inc_v, now=str(cv),
                            method=c.get('method'), confidence=c.get('confidence'))
                    results[total_key] = {
                        **inc,
                        'value':           cv,
                        'display_value':   cv,
                        'method':          c.get('method') or inc.get('method'),
                        'confidence':      max(inc.get('confidence') or 0, c.get('confidence') or 0),
                        'validation_note': 'adjusted to the total that balances against the line amounts — please verify',
                    }
                    return

            # ── PASS 2: JOINT subtotal+total pick ─────────────────────────────────────────────
            # Pass 1 found no reconciling TOTAL because the SUBTOTAL it balances against is ITSELF
            # wrong — the classic case being an authoritative anchor whose registration read dropped
            # BOTH subtotal and total onto a '1.00' quantity cell (City Office #152577), beating the
            # correct keyword reads. Search candidate (subtotal, total) PAIRS from the remembered
            # ledger: the confident pair that BALANCES (subtotal + tax + shipping − discount == total)
            # wins, restoring the keyword reads the mis-landed anchor displaced. Reconciliation is the
            # objective arbiter, so this overrides even an authoritative anchor whose value provably
            # doesn't add up (a correct teach reconciles and already returned at the top).
            sub_key = None
            for k in ('subtotal', *keyword.ROLE_KEY_ALIASES.get('subtotal', ())):
                d = results.get(k)
                if isinstance(d, dict) and d.get('value'):
                    sub_key = k
                    break
            if not sub_key:
                return
            sub_inc   = results.get(sub_key) or {}
            sub_inc_v = str(sub_inc.get('value') or '')
            sub_cands = [sub_inc, *(self._field_candidates.get(sub_key) or [])]
            tot_cands = [inc,     *(self._field_candidates.get(total_key) or [])]
            best = None   # (combined_conf, sv, tv, sub_cand, tot_cand)
            for sc in sub_cands:
                sv = sc.get('value')
                if not sv or (sc.get('confidence') or 0) < _RECON_PICK_MIN_CONF:
                    continue
                _saved = results.get(sub_key)
                results[sub_key] = {**(_saved or {}), 'value': sv}   # test this subtotal
                try:
                    for tc in tot_cands:
                        tv = tc.get('value')
                        if not tv or (tc.get('confidence') or 0) < _RECON_PICK_MIN_CONF:
                            continue
                        if str(sv) == sub_inc_v and str(tv) == inc_v:
                            continue   # the current (non-reconciling) pair
                        if _v.total_reconciles(tv, results):
                            score = (sc.get('confidence') or 0) + (tc.get('confidence') or 0)
                            if best is None or score > best[0]:
                                best = (score, sv, tv, sc, tc)
                finally:
                    results[sub_key] = _saved
            if best:
                _, sv, tv, sc, tc = best
                self._t('reconcile_pick', field=sub_key,   was=sub_inc_v, now=str(sv),
                        method=sc.get('method'), confidence=sc.get('confidence'))
                self._t('reconcile_pick', field=total_key, was=inc_v,     now=str(tv),
                        method=tc.get('method'), confidence=tc.get('confidence'))
                results[sub_key] = {
                    **sub_inc, 'value': sv, 'display_value': sv,
                    'method':          sc.get('method') or sub_inc.get('method'),
                    'confidence':      max(sub_inc.get('confidence') or 0, sc.get('confidence') or 0),
                    'validation_note': 'adjusted to the subtotal that balances against the total — please verify',
                }
                results[total_key] = {
                    **inc, 'value': tv, 'display_value': tv,
                    'method':          tc.get('method') or inc.get('method'),
                    'confidence':      max(inc.get('confidence') or 0, tc.get('confidence') or 0),
                    'validation_note': 'adjusted to the total that balances against the line amounts — please verify',
                }
        except Exception:
            pass  # reconciliation aid — must never break extraction

    def _maybe_gate_reread(self, garble, data, fmt_entry, val_type, label,
                           page_images, page_provenance, cache):
        """Stage-4.5 gate-failure re-read (DEFAULT ON: GATE_REREAD_ENABLED). A structured value
        was WITHHELD because its OCR read fails the field's learned format. Take ONE bounded
        second look at the page: relocate the garble, tight-crop re-read via the anchor crop
        ladder, and adopt ONLY a read that PASSES the exact gate the original failed AND is kin to
        the garble (ocr.targeted_reread). Returns the adopted field dict, or None (caller keeps
        the byte-identical withhold). A real-character repair (1-2 edits on the alnum core) is
        REVIEW-BOUND — never a silent value:
          - conf capped at _REREAD_CAP (69) -> below the 70 review threshold and the 88 critical
            auto-file floor;
          - corrected_to + the note independently block auto-file at every trust floor;
          - the caller flags it for review (format_anomaly_flagged / n_flagged).
        EXEMPT from that rule (Oracle-signed 2026-07-23, kill GATE_REREAD_CLEAN_ACCEPT): a
        NORMALISATION-ONLY recovery — the re-read agrees with the original on EVERY alphanumeric
        character (0-edit kinship; calendar-equal for dates) and the result passes the learned
        format — is two independent reads (full-page pass vs crop ladder) agreeing on the content,
        so it returns CLEAN: no cap, no was_corrected/note, marked 'reread_clean' (the caller
        skips its flag bump). Do NOT "restore" the flag on this branch as a supposed regression
        fix — the review dressing on a whitespace-only change was the bug (a permanent
        looks-like-no-correction hold; see the 2026-07-23 handover). Any PRE-EXISTING note/
        corrected_to on the field survives via the **data spread — an unrelated flag stays
        review-bound. Abstains (returns None) on: the switch OFF, no page images, a born-digital
        located page (page_provenance), an ambiguous locate, or any read failing is_adoptable.
        Frame invariant: image_to_data and the crop both run on the SAME raw page image instance."""
        if not GATE_REREAD_ENABLED or not page_images or not garble:
            return None
        try:
            from ocr import targeted_reread
            import pytesseract
            from pytesseract import Output
            from extraction import anchor as _anchor

            def _i2d(img):
                # Config parity with the full-page reconstruct pass (PSM 3, auto page seg) so the
                # garble reproduces and the match lands; the crop re-read does the cleanup.
                return pytesseract.image_to_data(img, config="--oem 3 --psm 3",
                                                 output_type=Output.DICT)

            def _read_region(page_image, box_px, vt, verify):
                W, H = page_image.size
                left, top, bw, bh = box_px
                if W <= 0 or H <= 0 or bw <= 0 or bh <= 0:
                    return None
                cx = (left + bw / 2.0) / W
                cy = (top + bh / 2.0) / H
                # Reuse the exact anchor crop+ladder recipe (padding, upscale, light-first rungs);
                # verify_fn drives rung selection, and reread_field_value re-checks the return (seam #1).
                return _anchor._crop_and_ocr(page_image, cx, cy, bw / float(W), bh / float(H),
                                             val_type=vt, verify_fn=verify)

            def _page_ok(pidx):
                # Missing provenance -> abstain: never re-read a born-digital (exact) value.
                return bool(page_provenance) and 0 <= pidx < len(page_provenance) \
                    and page_provenance[pidx] == 'ocr'

            adopted = targeted_reread.reread_field_value(
                page_images, garble, label, val_type, fmt_entry, cache,
                config_pattern=None, page_ok=_page_ok, i2d_fn=_i2d, read_region_fn=_read_region)
        except Exception:
            return None
        if not adopted:
            return None
        if GATE_REREAD_CLEAN_ACCEPT and _reread_is_normalisation_only(garble, adopted, val_type):
            # Normalisation-only (spacing/separator/case; calendar-equal for dates): the two reads
            # agree on the content — a clean read, not a correction. Original confidence stands
            # (nothing inflated — the 88 floor/thresholds apply normally); no cap/note/was_corrected;
            # a pre-existing note from another stage survives the spread (fail-toward-review).
            self.log(f"  Stage 4.5: re-read '{garble}' -> '{adopted}' (normalisation-only — accepted clean)")
            return {
                **data,
                'value':         adopted,
                'display_value': adopted,
                'reread':        True,
                'reread_clean':  True,
            }
        self.log(f"  Stage 4.5: re-read '{garble}' -> '{adopted}' (review-bound)")
        return {
            **data,
            'value':           adopted,
            'display_value':   adopted,
            'was_corrected':   True,
            'corrected_to':    adopted,
            'confidence':      min(data.get('confidence') or 0, _REREAD_CAP),
            'validation_note': f're-read from the page (was "{garble}") — please verify',
            'reread':          True,
        }

    def extract(self,
                ocr_text:      str,
                page_images:   list,
                filename:      str,
                field_defs:    list,
                hints:         list,
                anchors:       list,
                logos:         list,
                templates:     list | None = None,
                document_type: str | None = None,
                document_slug: str | None = None,
                detected_slug: str | None = None,
                title_trusted: bool = False,
                ref_field_key: str | None = None,
                supplier_name: str | None = None,
                pinned_supplier: str | None = None,   # operator "Resolve" pin — overrides logo/template (Part B)
                known_template_id: int | None = None,
                pinned_template_id: int | None = None,
                trace = None,
                slice_dir = None,
                page_text_lines: list | None = None,
                page_provenance: list | None = None,
                identity_shadow: bool = False,
                raw_page0 = None,
                page0_geometry: dict | None = None) -> dict:
        """
        Run extraction pipeline according to current mode.
        Returns dict with field values + metadata keys prefixed with _.

        `trace`: optional dev-only callback (process_docs --trace). When set,
        structured field-lifecycle events are emitted for the Dev Inspector;
        when None, every trace helper is a no-op so behaviour/timing is unchanged.
        """
        self._trace     = trace
        self._slice_dir = slice_dir   # dev-only crop capture dir (set only with --trace)
        self._slice_n   = 0
        self._field_candidates = {}   # Phase 3 ledger (built only when candidate_override on)
        results      = {}
        field_keys   = [f["key"] for f in field_defs]
        # Seed field_patterns from each field's configured TYPE (+ the ref-role
        # coercion) so CUSTOM doc-type fields and the structural REFERENCE role are
        # gated by their real type instead of loose free-text. The keyword config
        # still wins where it carries a richer entry. See _seed_field_patterns.
        field_patterns = _seed_field_patterns(self.patterns.get("field_patterns", {}), field_defs)
        # Date-typed fields get a merge guard: a candidate that doesn't parse as
        # a real date must never displace one that does (e.g. a mis-cropped
        # taught anchor returning a bare "March" overriding a valid full date).
        date_field_keys = {f["key"] for f in field_defs if f.get("type") == "date"}
        # Free-text fields (text / multiline_text / untyped) have legitimately
        # variable shapes — a customer name with or without a site suffix, an
        # address of any length. The Stage 4.5 learned-SHAPE check must never
        # WITHHOLD or TRIM such a value (only softly flag it); otherwise a clean
        # company name is discarded just because recent confirmed history happened
        # to share a longer shape (e.g. customers all "Beaumont Care Homes Ltd -
        # <Site>" learn a rigid shape that NULLs a valid "Beaumont Care Homes Ltd
        # -" with no site). NOTE: a reference field is frequently typed plain
        # "text" too (e.g. reference_number), so exclude _is_ref_field — those ARE
        # structured codes and must keep full shape enforcement. Dates/currency are
        # their own types, already outside this set.
        text_field_keys = {f["key"] for f in field_defs
                           if (f.get("type") or "").lower() in ("text", "multiline_text", "")
                           and not _is_ref_field(f["key"])}
        matched_tmpl = None
        logo_phash   = None
        logo_detail_hash = None
        kw_fingerprint = []

        # Logo/identity phash SOURCE. On a deskew-reprocess the READ pages (page_images) are
        # straightened, but the persisted logo phash and all logo/template MATCHING must use the
        # RAW (un-deskewed) page 0: a deskewed phash drifts from the learned raw hashes (breaks
        # identification) and, once persisted (results["_logo_phash"] -> template_logo_hashes),
        # poisons the supplier's logo set for every future RAW import. raw_page0 defaults to None
        # -> _id_img is the normal page 0 -> byte-identical for every existing caller.
        _id_img = raw_page0 if raw_page0 is not None else (page_images[0] if page_images else None)

        # ── Pre-stage: compute logo hash + keyword fingerprint (always) ───────
        if _id_img is not None:
            logo_phash = template_matcher.compute_logo_hash(_id_img)
            # Isolated-mark 256-bit DETAIL hash (the logo-collision discriminator, logo_detail.py),
            # computed from the SAME raw page-0 source as the phash (Oracle: a deskewed/enhanced image
            # drifts out of frame with the stored hashes). Fail-safe None on any error → the doc simply
            # carries no detail hash. INERT until Slice C consumes it — persisting it now is harmless.
            try:
                import logo_detail
                logo_detail_hash = logo_detail.detail_hash(_id_img)
            except Exception:
                logo_detail_hash = None
        kw_fingerprint = template_matcher.extract_keyword_fingerprint(ocr_text)

        # ── Stage 0: Template matching ────────────────────────────────────────
        self._type_ambiguous = False   # Fix A: set True below when the match is an ambiguous same-logo pick
        self._type_refused   = False   # C1: set True below when the trusted-title refuse discards a template
        if templates:
            match = template_matcher.identify_template(
                _id_img,
                ocr_text,
                templates,
                detected_slug=detected_slug,
                title_trusted=title_trusted,
                query_detail_hash=logo_detail_hash,   # Slice C: isolated-mark veto on a ≥2-supplier logo collision
            )
            # C1 (TYPE-heading authority): identify_template returns a REFUSE sentinel (template
            # None + type_refused) when a TRUSTED heading declares a type the matched template does
            # NOT carry. Collapse it to "no template" so every branch below is byte-identical to the
            # old None return, but REMEMBER it so the doc is HELD for review at the type-ambiguity
            # seam — a falsely-trusted heading must fail toward review, never auto-file a wrong type
            # at 100. (Kill switch TYPE_REFUSE_HOLD lives in template_matcher._type_refuse → None,
            # which makes this branch dead and the whole flow byte-identical.)
            if match and match.get('type_refused'):
                self._type_refused = True
                match = None
            # Reprocess honour: a document already linked to a template (passed
            # as known_template_id) should still run that template's stage 0/0.5
            # — including its admin-drawn field mappings — even when live
            # re-identification is borderline and returns no match (e.g. a
            # logo/keyword score that dipped below threshold for this scan). Only
            # used as a fallback when live matching fails, so it never overrides
            # a positive live match with a stale link.
            if not match and (known_template_id is not None or pinned_template_id is not None):
                # A B1 PIN also acts as this fallback (Oracle C2, match=None corner): if this engine
                # call's own match failed, still honour the pinned sibling so Stage 0 runs against it
                # AND the doc is held below. Pin wins over a stale known link.
                _fb_id = pinned_template_id if pinned_template_id is not None else known_template_id
                known  = next((t for t in templates if t.get('id') == _fb_id), None)
                if known:
                    _fb_method = 'pinned_id' if pinned_template_id is not None else 'known_id'
                    match = {'template': known, 'confidence': 0, 'method': _fb_method}
                    self.log(f"  Stage 0: live match failed; honouring {_fb_method} template id={_fb_id}")
            if match:
                # C2 (Oracle): a pinned doc is an ambiguous-HELD doc BY DEFINITION (pinned_template_id is
                # set only by process_docs' B1 block for an ambiguous same-letterhead pick), so force the
                # HOLD even if THIS engine call's own (raw-image) match resolved non-ambiguously — a
                # raw-vs-processed split-brain must never let a pinned doc auto-file.
                self._type_ambiguous = bool(match.get('ambiguous_type')) or (pinned_template_id is not None)
                matched_tmpl = match['template']
                # FIX B1 (suggest-only): process_docs resolved the ambiguous same-letterhead type from
                # the doc's ref-prefix and PINNED the correct sibling's template. Force it as
                # matched_tmpl so Stage 0/0.5 read against the RIGHT sibling's fixed-values/mappings and
                # the filing type agrees with the seeded fields (no split-brain). We do NOT touch
                # _type_ambiguous — the doc STAYS HELD for review; this only makes the suggestion + the
                # extracted fields correct. Gated on pinned_template_id (None on every normal doc →
                # byte-identical); the pinned id is always a band-13 sibling of this same cluster.
                if pinned_template_id is not None:
                    _pinned = next((t for t in templates if t.get('id') == pinned_template_id), None)
                    if _pinned is not None:
                        matched_tmpl = _pinned
                        self.log(f"  Stage 0: template pinned by ref-prefix retype (Fix B1) → "
                                 f"id={pinned_template_id} ({_pinned.get('document_type_slug')})")
                self.log(
                    f"  Template matched: {matched_tmpl.get('name')} "
                    f"({match['confidence']}% via {match['method']})"
                )
                # A matched template is a STRONG, reliable doc-type signal — far
                # more robust than the keyword type-detection that sets
                # document_slug upstream, which fails when the identifying band is
                # clipped off a scan (the exact cropped-page failure mode). The
                # learned-format / qualification gates key on document_slug, so a
                # missing slug silently DISABLES them — a wrong-row crop then
                # passes and drift relocation never triggers. Adopt the template's
                # doc-type slug when the caller couldn't resolve one, so the gates
                # still engage on a degraded page. Never overrides a slug the
                # caller DID detect; reusable for every template/doc-type.
                if not document_slug and matched_tmpl.get('document_type_slug'):
                    document_slug = matched_tmpl.get('document_type_slug')
                    self.log(f"  Doc-type slug from matched template: {document_slug}")
                tmpl_results = template_matcher.extract_with_template(ocr_text, matched_tmpl)
                _pre_s0 = self._snap(results)
                self._remember_candidates('0_template', tmpl_results)
                for key, data in tmpl_results.items():
                    results[key] = data
                self._trace_stage('0_template', tmpl_results, _pre_s0, results)
                # Promote supplier from the template's own resolved supplier_name
                # field (a fixed_value learned from confirmed documents) — NOT
                # from the template's auto-generated display name. Templates
                # created before a supplier was known get generic names like
                # "Purchase Order Template", whose first word ("Purchase") is
                # not a supplier name — using it poisoned every downstream
                # hint/anchor lookup (and got persisted into supplier_hints,
                # where it then won out over the real "Polychemtex Inc." hints).
                if not supplier_name:
                    supplier_name = (results.get('supplier_name') or {}).get('value') or None
                found = _count_valued_fields(results)
                self.log(f"  Stage 0: {found}/{len(field_keys)} fields from template")

                # ── Stage 0.5: admin-drawn anchor → target zone mappings ──────
                # Optional, additive layer on the matched template (Settings →
                # Templates → "Map a Field"). Only engages for documents that
                # matched a SPECIFIC template with enabled mappings AND when we
                # have page pixels to crop — every template/document without
                # drawn mappings takes zero extra work and behaves exactly as
                # before. See template_mapper.py for the anchor-relocation +
                # relative-offset model (the "primary model" the admin tool
                # implements — NOT a fixed coarse-grid lookup).
                # Own enabled mappings win; otherwise borrow from a grouped
                # sibling that has them (validated below by re-running the
                # anchor relocation on this page). See select_mapping_source.
                tmpl_mappings, mapping_src = select_mapping_source(matched_tmpl, templates)
                if tmpl_mappings and page_images:
                    if mapping_src is not matched_tmpl:
                        self.log(f"  Stage 0.5: borrowing {len(tmpl_mappings)} mapping(s) from "
                                 f"grouped sibling '{mapping_src.get('name')}'…")
                    else:
                        self.log(f"  Stage 0.5: {len(tmpl_mappings)} anchor→target mapping(s)…")
                    # Universal failsafe source: the SAME learned-format index
                    # Stage 4.5 uses, keyed the SAME way (supplier+doc-type+field,
                    # lowercased). Passed as a per-field lookup so the mapper can
                    # reject a value whose shape doesn't match what this field has
                    # historically been on this template — no per-field config, no
                    # dependence on the on-page label text. Only constrains fields
                    # that already have a learned format (≥3 confirmed values via
                    # build_format_class_index); everything else passes through.
                    _fmt_lookup = self._make_format_lookup(supplier_name, document_slug)
                    # Landmarks come from the SAME template the mappings did
                    # (mapping_src — its coordinate frame is what the transform
                    # registers this page against). Inert unless that template has
                    # landmarks AND registration is enabled.
                    _landmarks = (mapping_src or matched_tmpl).get("landmarks") or []
                    mapping_results = template_mapper.extract_with_mappings(
                        page_images, tmpl_mappings,
                        field_patterns=field_patterns,
                        validation_patterns=self.patterns.get("validation_patterns", {}),
                        format_lookup=_fmt_lookup,
                        slice_capture=(self._capture_slice if (self._trace and self._slice_dir) else None),
                        template_landmarks=_landmarks,
                        registration_enabled=self.registration_enabled,
                    )
                    applied = 0
                    _pre_s05 = self._snap(results)
                    self._remember_candidates('0.5_mapping', mapping_results)
                    for key, data in mapping_results.items():
                        existing = results.get(key)
                        # An admin-drawn mapping (Settings → Templates → "Map a
                        # Field") is a deliberate, per-template correction —
                        # someone pinned the exact zone on a real sample because
                        # the template's own generic rule was producing the
                        # wrong value for this field (template_fixed/
                        # template_anchor are frequently auto-learned and can be
                        # stale — this mapping exists specifically to override
                        # one). It should win on authority, not on a raw
                        # confidence number that the generic rule's stale 95
                        # (template_fixed) would otherwise always clear. Mirrors
                        # the is_taught_override precedent below — a more
                        # specific, curated source outranks the more generic
                        # rule it refines, regardless of either one's confidence.
                        # A curated Stage 0.5 mapping outranks the generic Stage 0
                        # seeds it exists to refine — including an admin-LOCKED fixed
                        # value (a drawn zone on a real sample is the more specific
                        # curated source, per the intended precedence).
                        # A garbled FREE-TEXT mapping read no longer rides curated authority:
                        # Stage A caps such a read to its real OCR mean (~70), so a low-confidence
                        # free-text mapping forfeits the is_curated_refinement fast-track and must
                        # instead win on confidence — where it loses to a clean incumbent/anchor, so
                        # a mangled crop can't out-rank the correct value on authority alone.
                        # Threshold 75: a clean free-text mapping caps at >=78 (Stage A base 78
                        # no-label / 90 with-label); only a garbled one (~70) is demoted. Structured
                        # mappings (regex-validated, never capped, not in text_field_keys) are unaffected.
                        _ft_mapping_weak = (key in text_field_keys
                                            and data.get("confidence", 0) < 75)
                        is_curated_refinement = ((not _ft_mapping_weak)
                                                  and (existing is None
                                                  or existing.get("method") in
                                                     ("template_fixed", "template_anchor",
                                                      "template_fixed_locked")))
                        # `existing is not None` guard: a weak free-text mapping with no
                        # incumbent (existing None) has is_curated_refinement False, so the
                        # confidence branch must not deref None — it simply forfeits and the
                        # field is left for Stage 1/2 to fill.
                        if is_curated_refinement or (existing is not None
                                                     and data["confidence"] > existing.get("confidence", 0)):
                            results[key] = data
                            applied += 1
                    self._trace_stage('0.5_mapping', mapping_results, _pre_s05, results)
                    if applied:
                        self.log(f"  Stage 0.5: {applied} field(s) refined via anchor/target mapping")

        # ── OPERATOR SUPPLIER PIN (Resolve button, Part B) — highest precedence ──
        # The operator RESOLVED the issuer (the branding cross-check detected the true name and they
        # clicked "Use '<name>'"). On reprocess it arrives as pinned_supplier and OVERRIDES the
        # logo/template supplier UNCONDITIONALLY: set the local supplier_name so the three fill blocks
        # below all skip (each is gated `if not supplier_name`), AND so the Stage-1/2 reads re-scope to
        # the pinned supplier's own anchors/hints. REVIEW-BOUND by construction — method 'operator_pin'
        # + a validation_note keep the doc below EVERY auto-file lock (isAutoFileEligible refuses a noted
        # field at every floor incl. 100), so a pin can never silently auto-file. Writes NO logo/hint
        # learning (local to this doc); future docs learn the normal way on Confirm. The pin also joins
        # accepted_issuers so the branding cross-check doesn't re-flag the pinned name (Oracle C5).
        # Kill switch env SUPPLIER_PIN (default on); off -> ignored -> byte-identical.
        if pinned_supplier and os.environ.get('SUPPLIER_PIN', '1') != '0':
            supplier_name = pinned_supplier
            results["supplier_name"] = {
                "value":           pinned_supplier,
                "confidence":      75,
                "method":          "operator_pin",
                "validation_note": "Supplier set by you — confirm to file.",
            }
            try: self.accepted_issuers.add(self._accept_norm(pinned_supplier))
            except Exception: pass
            self.log(f"  Operator supplier pin: {pinned_supplier} — logo/template supplier skipped")

        # ── Fixed Supplier Name is IMMUNE to the logo fallback ────────────────
        # A doc type whose Supplier Name is an admin-fixed template field has a
        # deterministic supplier, so a logo guess must never fill it. When no
        # template matched (the fixed value was never seeded) but the doc type IS
        # known, apply the doc-type's fixed Supplier Name and SKIP the logo match.
        # Returns None when the doc type has no fixed supplier → logo runs as before.
        if not supplier_name and document_slug:
            fixed_sup = self._doctype_fixed_supplier(templates, document_slug)
            if fixed_sup:
                supplier_name = fixed_sup['value']
                results["supplier_name"] = {
                    "value":      supplier_name,
                    "confidence": 95,
                    "method":     fixed_sup['method'],
                }
                self.log(f"  Fixed Supplier Name for '{document_slug}': "
                         f"{supplier_name} — logo fallback skipped")

        # ── Pre-stage: logo supplier identification (fallback if no template) ──
        # Matches against learned RAW logo hashes -> use the raw page 0 (_id_img), else a deskewed
        # phash drifts out of range and the supplier fails to resolve on a straighten-reprocess.
        if not supplier_name and logos and _id_img is not None:
            logo_match = anchor.try_logo_supplier_match(_id_img, logos, query_detail_hash=logo_detail_hash)
            # SPARSE-GUARD SUGGESTION INTERCEPT (Oracle C2, 2026-07-23): a coarse-miss detail pick
            # is a SUGGESTION, not an identity. Stash it and take the STARVED path exactly — no
            # text gate here (it could stash a mid-pipeline _logo_abstained and diverge from the
            # starved baseline), no fill (a fill here re-creates the throughput collapse: it makes
            # the supplier non-empty, which SKIPS the un-noted Stage-2.5a hint resolution the same
            # docs used before enrolment), and it must never reach the :fill block below (its dict
            # has no confidence/match_count — pinned). Consumed at finalisation AFTER the last
            # supplier writer (see the consumption block near _flag_branding_conflict).
            if isinstance(logo_match, dict) and logo_match.get("suggest_only"):
                results["_logo_detail_suggest"] = {"supplier_name": logo_match.get("supplier_name"),
                                                   "detail_band":   logo_match.get("detail_band")}
                self.log(f"  Logo detail mark suggests '{logo_match.get('supplier_name')}' "
                         "— deferred to finalisation")
                # Oracle C1 (re-adjudication): re-assert the COARSE WINNER so the text gate judges
                # it exactly as in the starved baseline — None on the miss arm (byte-identical to
                # the old null), the winner dict on the disagree arm (the gate abstains a
                # text-contradicted rival; a winner that STANDS to finalisation meets the
                # suggestion's disagree note there). NEVER a bare null on disagree — that
                # discards the winner unjudged and every anchor-level pin stays green (the
                # dead-guard-greens-every-test trap this comment exists to prevent).
                logo_match = logo_match.get("coarse_winner")
            # ── TEXT-AGREEMENT GATE (identity text-first, slice 1b; kill LOGO_TEXT_GATE=0) ──────
            # MEASURED 2026-07-19: the 64-bit logo phash has ZERO separating power on scans
            # (cross-supplier MIN hamming 2 vs same-supplier min 6) — it cannot carry identity
            # alone, while the printed branding separates cleanly (worst cross overlap 0.22) and
            # named the true supplier on every doc of the Larkspur misassignment. So a logo match
            # must now AGREE with the page text to assert; it may SUGGEST when the text can't
            # judge; and it is DROPPED when the text positively contradicts it.
            # docs/designs/IDENTITY_TEXT_FIRST_2026-07-19.md
            _gate = 'accept'
            if logo_match and os.environ.get("LOGO_TEXT_GATE", "1") != "0":
                _gate = decide_logo_text_gate(
                    logo_match["supplier_name"],
                    _branding_banks(templates, self._accept_norm),
                    ocr_text, self._accept_norm, self.accepted_issuers)
            if logo_match and _gate == 'abstain':
                # The page says someone else. Drop the identity rather than scope every
                # per-supplier learning corpus to the wrong company — but NEVER go mute
                # (Oracle C1): stash the suppressed name + the branding-detected alternative so
                # finalisation can surface the "Use '<name>'" button, which is also the ONLY
                # trigger for the correction-ripple slice.
                self.log(f"  Logo match '{logo_match['supplier_name']}' DROPPED — the page branding contradicts it")
                results["_logo_abstained"] = {"suppressed": logo_match["supplier_name"]}
                logo_match = None
            if logo_match:
                supplier_name = logo_match["supplier_name"]
                self.log(
                    f"  Logo match: {supplier_name}"
                    f" ({logo_match['confidence']}% confidence,"
                    f" {logo_match['match_count']} previous docs)"
                )
                results["supplier_name"] = {
                    "value":      supplier_name,
                    "confidence": logo_match["confidence"],
                    "method":     "logo",
                }
                if _gate == 'suggest':
                    # UNJUDGEABLE: keep what the logo saw, but review-bound — the note is the
                    # auto-file lock (isAutoFileEligible refuses any noted field at EVERY floor),
                    # and text_agree marks the read for the confirm-time learning gate.
                    results["supplier_name"]["confidence"] = min(
                        int(results["supplier_name"]["confidence"] or 100), 69)
                    results["supplier_name"]["text_agree"] = False
                    results["supplier_name"]["validation_note"] = (
                        "Matched by logo only — the page text doesn't confirm this company. Please check.")
                    results["_needs_review"] = True
                # C2 (Slice D): a PRIMARY detail-hash OVERRIDE that RE-ROUTES the supplier carries a
                # validation_note — propagate it so the re-route is REVIEW-BOUND. supplier_name is
                # text-typed, so the trust.js 88 critical-field floor does NOT guard it; the NOTE is the
                # only reliable auto-file block (isAutoFileEligible refuses any noted field at EVERY
                # floor). Absent on a coarse/agree match (LOGO_DETAIL_PRIMARY off) → byte-identical.
                if logo_match.get("validation_note"):
                    results["supplier_name"]["validation_note"] = logo_match["validation_note"]

        # ── Template-identity supplier FILL (logo miss) ──────────────────────
        # A template matched but nothing resolved WHO the supplier is (logo drifted
        # out of range) → every supplier-scoped taught anchor is dropped and the doc
        # reads EMPTY (user re-teaches every field). Fill from the template's DOMINANT
        # CONFIRMED issuer so its anchors admit in Stage 2 proper. Fires ONLY when the
        # supplier is still empty AND a template matched AND the template's DISTINCTIVE
        # fingerprint words are ON THIS PAGE (corroboration) — the corroboration gate is
        # what prevents a colliding-logo template (Cascade<->Northgate) from imposing the
        # WRONG supplier. ALWAYS REVIEW-BOUND (persisted note) — an inferred identity must
        # never silently drive the filing folder (Oracle 2026-07-14). Kill switch env
        # TEMPLATE_IDENTITY_FILL (default on) → =0 is byte-identical.
        if (not supplier_name and matched_tmpl
                and os.environ.get("TEMPLATE_IDENTITY_FILL", "1") != "0"):
            _fill = _template_identity_for_fill(matched_tmpl)
            if _fill and _template_identity_corroborated(_fill["value"], ocr_text):
                supplier_name = _fill["value"]
                results["supplier_name"] = {
                    "value":           supplier_name,
                    "confidence":      70,
                    "method":          "template_identity",
                    "validation_note": _fill["note"],
                }
                self.log(f"  Template-identity supplier fill ({_fill['tier']}, corroborated): {supplier_name}")

        # Dev-only: expose the RESOLVED doc identity so a diagnostic log can show
        # why the learned-format / qualification gates did or didn't engage (they
        # key on document_slug; a missing/mismatched slug silently disables them).
        # No-op unless tracing.
        self._t("doc_context",
                supplier_name=supplier_name,
                document_slug=document_slug,
                document_type=document_type,
                template_name=(matched_tmpl.get("name") if matched_tmpl else None),
                template_slug=(matched_tmpl.get("document_type_slug") if matched_tmpl else None),
                format_rules=len(self.format_class_index or {}),
                format_keys=sorted(self.format_class_index.keys())[:12] if self.format_class_index else [])

        # ── Stage 1: Keyword extraction (always runs) ─────────────────────────
        self.log("  Stage 1: keyword extraction…")
        # Merge admin label overrides for THIS doc type onto the shipped patterns
        # (additive; creates an entry for a custom field that has no shipped one,
        # so it becomes keyword-extractable). Returns self.patterns unchanged when
        # there's nothing to merge — no per-run copy in the common case.
        patterns_for_run = keyword.merge_label_overrides(
            self.patterns, self.label_overrides, document_slug)
        # RC1 (2026-07-10): seed a Stage-1 keyword entry for a CUSTOM ref/date field from its own DB
        # label (+ role short-forms), so a custom-type field with no shipped pattern and no admin
        # override is still attempted here instead of depending on a learned anchor. Runs AFTER the
        # override merge so an admin override still wins; additive/pure otherwise.
        patterns_for_run = keyword.seed_field_labels(patterns_for_run, field_defs)
        # G3b KNOWN-CAPTION VALUE GUARD + c2 hint-caption deny share this vocabulary: the run's
        # post-merge label banks (shipped ∪ overrides ∪ seeds) + field DISPLAY labels. Armed keys
        # = name-like/party fields, CUSTOMER-SIDE only — supplier_name EXCLUDED explicitly (NOT via
        # _IDENTITY_FIELD_KEYS, which still lists customer_name and would silently neuter the fix).
        _caption_vocab = keyword.build_caption_vocab(patterns_for_run.get('field_patterns'), field_defs)
        _caption_guard_keys = {
            f.get('key') for f in (field_defs or [])
            if f.get('key') and f.get('key') != 'supplier_name'
            and (value_quality.is_name_like_field(f.get('key'))
                 or (patterns_for_run.get('field_patterns', {}).get(f.get('key')) or {}).get('role_caption') == 'party')}
        kw_results = keyword.extract_fields(ocr_text, field_keys, patterns_for_run,
                                            caption_vocab=_caption_vocab,
                                            caption_guard_keys=_caption_guard_keys)
        # ── INPUT HYGIENE for name-like free-text keyword reads ── a keyword/label
        # capture has NO crop-path cleaning, so OCR edge junk ("--« Beaumont Care
        # Homes Ltd -") enters verbatim and — being the highest-authority source
        # (keyword_override) — WINS, then only gets flagged downstream. Strip the
        # SAME edge artefacts a crop read already drops, AT CAPTURE, so the junk
        # never becomes "the answer" and the trace shows a clean winner. Edges only
        # (interior preserved); structured/ref fields untouched. Stage 4.5 still
        # edge-cleans the final winner as a catch-all (idempotent here). Reusable for
        # every supplier/field. See value_quality.strip_name_edges.
        _kw_charsets = self.patterns.get('field_charsets') or {}
        _kw_types    = {f.get('key'): f.get('type') for f in (field_defs or [])}
        for _kk, _kd in kw_results.items():
            if not isinstance(_kd, dict):
                continue
            _kt = _kw_types.get(_kk)
            if _kt in (None, 'text', 'multiline_text') and value_quality.is_name_like_field(_kk):
                _kv = _kd.get('value')
                if _kv:
                    _kspec = _kw_charsets.get(_kt, _kw_charsets.get('default')) if _kw_charsets else None
                    _kclean = value_quality.strip_name_edges(str(_kv), _kspec)
                    if _kclean and _kclean != _kv:
                        _kd['value'] = _kclean
                        if 'display_value' in _kd:
                            _kd['display_value'] = _kclean
        _pre_s1 = self._snap(results)
        self._remember_candidates('1_keyword', kw_results)
        # BUYER-ISSUED ISSUER GUARD (Oracle 2026-07-12) — drop a "Supplier/Vendor/Seller"-caption
        # supplier_name keyword read on a Purchase Order BEFORE it can become the resolved issuer
        # scope (see _suppress_buyer_seller_issuer). Runs AFTER _remember_candidates (C3) so the
        # dropped read still shows in the dev-inspector trace; breadcrumb to the log only, no user
        # note. buyer_issued = ref role is a PO number OR a trusted PURCHASE-ORDER heading (C5).
        _buyer_issued = ((ref_field_key == 'po_number')
                         or (str(detected_slug or '').lower() == 'purchase_order' and bool(title_trusted)))
        _suppressed_issuer = ExtractionEngine._suppress_buyer_seller_issuer(
            kw_results, _buyer_issued,
            self.accepted_issuers | self.accepted_names, self._accept_norm)
        if _suppressed_issuer:
            # C1: the local `_suppressed_issuer` is threaded to Stage 2.5a below (same function scope)
            # so the hint fallback can't re-adopt this vendor. Kept OUT of `results` deliberately — a
            # bare string under a `_` key would break a later stage that .get()s field values.
            self.log(f"  Buyer-issued issuer guard: dropped '{_suppressed_issuer}' — a "
                     f"Supplier/Vendor caption names the vendor on a PO, not the issuer")
        for key, data in kw_results.items():
            existing = results.get(key)
            # An admin-LOCKED fixed value (method 'template_fixed_locked') is a
            # deliberate, protected override: NO ordinary read — not even the
            # supplier-identity rescue below — may replace it on confidence. It still
            # yields ONLY to an explicit admin label (keyword_override) and to curated
            # Stage 0.5 mappings (which ran first). Narrow: ordinary 'template_fixed'
            # stays overridable.
            if (existing and existing.get("method") == "template_fixed_locked"
                    and data.get("method") != "keyword_override"):
                continue
            if key == "supplier_name" and existing:
                decision = _supplier_identity_decision(existing, data)
                if decision == "keep":
                    continue
                if decision == "take":
                    results[key] = data
                    continue
            # An admin-drawn Stage 0.5 mapping is curated ground truth. A generic
            # keyword hit must not silently DEMOTE it to method "keyword" — doing
            # so also strips its protection from the anchor_crop override in Stage
            # 2 (is_taught_override excludes only template_mapping*), letting a
            # mis-aimed learned anchor then clobber the deliberate mapping. Keep
            # the mapping; curated sources still contend on confidence later.
            if existing and _is_stage05_located(existing.get("method")):
                # A genuinely-LOCATED mapping keeps winning. But a BLIND template_registration read
                # (landmark geometry only, no field-label evidence) can lose to a strong keyword that
                # DISAGREES + outscores it — kept for review, not silently swapped or auto-filed.
                _blind_reg = (existing.get("method") or "").startswith("template_registration")
                _kw_ok = (data.get("method") in ("keyword", "keyword_override")
                          and data.get("value") and (data.get("confidence") or 0) >= _KEYWORD_TRUST_FLOOR)
                if (_blind_reg and _kw_ok
                        and _cmp_norm(data.get("value")) != _cmp_norm(existing.get("value"))
                        and (data.get("confidence") or 0) > (existing.get("confidence") or 0)):
                    results[key] = {**data,
                                    "confidence": min((data.get("confidence") or 0), _CONFLICT_CAP),
                                    "validation_note": (
                                        f"Kept the read value “{data.get('value')}” — a taught "
                                        f"mapping read “{existing.get('value')}” at a registered "
                                        f"position that couldn't be confirmed by its label. Please check.")}
                continue
            if (key in date_field_keys and existing
                    and validator.parse_date(existing.get("value")) is not None
                    and validator.parse_date(data.get("value")) is None):
                continue  # don't let an unparseable date replace a valid one
            # Precedence: an admin label override (Settings → Advanced, method
            # "keyword_override") is a deliberate instruction for where this
            # field's value lives, so a VALID one outranks ANY learned/generic
            # incumbent on AUTHORITY — not on a raw confidence number it could
            # never clear against a frozen 95. (At Stage 1 the realistic incumbents
            # are the Stage 0 template seeds template_fixed/template_anchor, but the
            # guard is written generally so the override also beats any other
            # non-curated method without depending on the seed's exact label.) It
            # still yields to curated Stage 0.5 mappings — those are skipped above
            # via _STAGE05_LOCATED_METHODS, and excluding them here keeps that
            # mapping > label ordering consistent — and to authoritative Stage 2 ⊕
            # anchors (Tier A above overrides it there, now regardless of method).
            is_override_authority = (data.get("method") == "keyword_override"
                                     and existing is not None
                                     and not _is_stage05_located(existing.get("method")))
            if (not existing or is_override_authority
                    or data.get("confidence", 0) > existing.get("confidence", 0)):
                results[key] = data
        self._trace_stage('1_keyword', kw_results, _pre_s1, results)
        found = _count_valued_fields(results)
        self.log(f"  Stage 1: {found}/{len(field_keys)} fields found")

        # Snapshot the supplier identity AS OF Stage-2 time: the Stage-2.6 late-anchor
        # rescue below runs ONLY when the supplier was UNRESOLVED here and resolved later
        # (2.5a text scan) — never when Stage 2 already saw a supplier. Wrong-then-corrected
        # identity is a different, riskier class and stays deliberately out of scope.
        _s2_supplier = supplier_name

        # ── Stage 2: Anchor extraction (always runs) ──────────────────────────
        if anchors:
            self.log("  Stage 2: anchor extraction…")
            # "Register, then read" for Stage 2: fit ONE page-0 transform from the
            # matched template's landmarks (anchors only read page 0) and hand it to
            # the anchor stage so a taught value box can be mapped onto a shifted/
            # skewed/scaled page when its own label can't be re-found. Inert (None)
            # unless registration is enabled AND the matched template has landmarks
            # — so a template without landmarks behaves exactly as before. Fitting
            # here (vs inside Stage 0.5) lets the SAME transform serve both stages;
            # for an anchors-only template (no drawn mappings) Stage 0.5 never ran,
            # so this is the only fit.
            anchor_page_transform = None
            if self.registration_enabled and page_images and matched_tmpl:
                _alm = matched_tmpl.get("landmarks") or []
                if not _alm:
                    self.log("  Stage 2: registration inactive — template has no "
                             "landmarks (re-pin the sample to generate them)")
                else:
                    try:
                        anchor_page_transform = template_mapper._fit_page_transform(
                            page_images[0], _alm, template_mapper._ocr_lines)
                    except Exception as e:
                        self.log(f"  Stage 2: landmark fit skipped ({e})", "warn")
                    if anchor_page_transform is not None:
                        self.log(f"  Stage 2: page registered "
                                 f"({anchor_page_transform.n_inliers}/{len(_alm)} landmarks, "
                                 f"residual {anchor_page_transform.residual:.4f})")
                    else:
                        self.log(f"  Stage 2: registration fit failed "
                                 f"({len(_alm)} landmarks, too few/poor matches)")
            # Dev-trace only: record what each crop rung READ and which gate
            # dropped it, so a "field not pulled in" can be diagnosed (the winners-
            # only candidate trace can't show a rejected read). No-op without --trace.
            _on_reject = ((lambda fk, st, v, r: self._t(
                "anchor_reject", field=fk, method=st, value=v, reason=r))
                if self._trace else None)
            # Display labels of the IDENTITY fields ("Document Issuer") — an identity anchor whose
            # CAPTURED label IS one of these is a teaching artifact (the field's own display name,
            # never a printed caption), so it can only be a blind cross-supplier positional SWEEP,
            # not a real located read (the PROFLE + #119 class). Passed to the read-stage guard.
            _identity_labels = {(f.get('label') or '').strip().lower()
                                for f in field_defs if f.get('key') in _IDENTITY_FIELD_KEYS}
            _identity_labels.discard('')
            anchor_results = anchor.extract_with_anchors(
                ocr_text, anchors, supplier_name, document_slug,
                page_images=page_images,
                field_patterns=field_patterns,
                validation_patterns=self.patterns.get("validation_patterns", {}),
                slice_capture=(self._capture_slice if (self._trace and self._slice_dir) else None),
                format_lookup=self._make_format_lookup(supplier_name, document_slug),
                page_transform=anchor_page_transform,
                on_reject=_on_reject,
                page_text_lines=page_text_lines,
                text_field_keys=text_field_keys,
                multiline_lookup=self._make_multiline_lookup(supplier_name, document_slug),
                identity_labels=_identity_labels,
            )
            _pre_s2 = self._snap(results)
            self._remember_candidates('2_anchor', anchor_results)
            for key, data in anchor_results.items():
                existing = results.get(key)
                # Protect an admin-LOCKED fixed value from any NON-authoritative anchor
                # read (incl. the supplier-identity rescue + credibility-gate paths
                # below). An authoritative ⊕ anchor still wins outright via Tier A.
                if (existing and existing.get("method") == "template_fixed_locked"
                        and not data.get("authoritative")):
                    continue
                # Supplier identity is plausibility-gated first: a poisoned
                # anchor_crop carrying an implausible short fragment must not
                # ride the is_taught_override path to clobber a plausible name,
                # and a plausible anchor read must rescue an implausible
                # incumbent regardless of confidence. Both-plausible /
                # both-implausible falls through to the normal contest below.
                if key == "supplier_name" and existing:
                    decision = _supplier_identity_decision(existing, data)
                    if decision == "keep":
                        continue
                    if decision == "take":
                        results[key] = data
                        continue
                # ── CROSS-CHECK KEYWORD CORROBORATION CLEAR (E2; kill CROSSCHECK_KEYWORD_CLEAR) ──
                # anchor.py's authoritative-crop cross-check flips a crop-vs-fullpage DISAGREEMENT to
                # the full-page/inline value, caps it 70 + notes "please verify" (a review event) —
                # and via Tier-A that FLAGGED read wins over the clean keyword incumbent, so the doc
                # holds even though the value is right (a taught 2x crop that spanned two rows on a
                # skewed scan is a framing artifact, not a real second read of the field). When an
                # INDEPENDENT Stage-1 keyword/override read normalises-equal to the flipped value,
                # oscar's "two independent reads agree" bar IS met: restore the field to a
                # corroborated confidence (>=88 clears the critical-field floor; the keyword's own
                # 85 would itself still be held) and drop the note, so the correct value files
                # instead of being permanently held. Value UNCHANGED (still the located inline read)
                # -> accuracy byte-identical; only the flag/confidence move. No peer, or a
                # DISAGREEING peer -> unchanged -> today's flag stands (fail-toward-review).
                if (os.environ.get("CROSSCHECK_KEYWORD_CLEAR", "1") != "0"
                        and _crosscheck_keyword_corroborated(data, existing, key in date_field_keys)):
                    # Represent the surviving read HONESTLY as the located inline harvest it is
                    # (method 'anchor_inline'), which ALSO unhooks the 70-cap + "please verify" note
                    # that key off 'anchor_crop_crosscheck' so nothing downstream re-derives them.
                    data = {**data,
                            "method": "anchor_inline",
                            "confidence": max(int(data.get("confidence") or 0), _CROSSCHECK_CORROB_CONF)}
                    for _k in ("validation_note", "was_corrected", "corrected_to"):
                        data.pop(_k, None)
                    results[key] = data
                    continue
                # ── Stage 2 credibility gate (before any override) ───────────
                # A Stage 2 candidate must not DISPLACE an existing incumbent
                # unless it is credible for the field's class. Reusable, shape/
                # type based — never document- or supplier-specific. Only guards
                # OVERRIDES: an empty field is still filled (and the validator
                # then flags it), so this never suppresses a first read.
                if existing and existing.get("value"):
                    if key in date_field_keys:
                        # Non-date junk (e.g. a mis-cropped "March") must not beat
                        # a date field — the candidate has to parse as a date.
                        if validator.parse_date(data.get("value")) is None:
                            continue
                    elif _is_ref_field(key):
                        cand_v = data.get("value") or ""
                        # Wildly-inconsistent ref (a lone "a", punctuation noise)
                        # must not override a plausible incumbent.
                        if not _ref_override_plausible(cand_v):
                            continue
                        # Digit-shape consistency: a digit-free candidate (e.g. a
                        # label/word like "Booking" read from a drifted crop) must
                        # not displace a digit-bearing incumbent ("7602-1354-4").
                        inc_v = existing.get("value") or ""
                        if any(c.isdigit() for c in inc_v) and not any(c.isdigit() for c in cand_v):
                            continue
                # ── NAME-RELOCATE DISAGREEMENT GUARD (slice 1) ───────────────
                # A garbled RELOCATED name read must not beat a CLEAN keyword name of
                # the same field (the "comer Clinic" over "Fernbank Veterinary Clinic"
                # case — a taught box drawn on a rotated scan mis-registers and clips
                # the value). Keep the clean keyword, cap <=69 + note (the NOTE, not the
                # cap, blocks auto-file), route to review. Flag-only; excludes
                # supplier_name; kill switch. Sits BEFORE Tier-A so an authoritative
                # garble is held, but the strict '<' + 0.6 floor let a genuine re-teach
                # through. See _name_relocate_should_hold.
                if (os.environ.get("NAME_RELOCATE_DISAGREE_GUARD", "1") != "0"
                        and _name_relocate_should_hold(existing, data, key)):
                    results[key] = {**existing,
                                    "confidence": min(int(existing.get("confidence") or 0), 69),
                                    "validation_note": existing.get("validation_note") or _NAME_RELOCATE_NOTE}
                    continue
                # ── Tier A: authoritative ⊕ anchor wins outright (any method) ──
                # An EXPLICIT authoritative ⊕ anchor that cleared the credibility
                # gate above is the operator's deliberate, current correction for
                # this field — it wins outright over ANY incumbent (Stage 0.5
                # mapping, admin label override, generic template seed, learned),
                # regardless of the resolved method or confidence. Passive anchors
                # (authoritative=False) never reach here. This generalises the old
                # anchor_crop-ONLY is_taught_override below so an authoritative
                # anchor that resolved via inline / relocated / registration still
                # wins (was the bug: a re-teach that read its value off the
                # located line lost a confidence contest to the label it was meant
                # to override). An INVALID authoritative read was already dropped
                # by the credibility gate, so it correctly yields to the next valid
                # lower-priority source.
                # LOCATED gate (anchor.py): a blind RIGID read whose label can't be
                # found on this page (a stale/non-localizable ⊕ anchor reading the
                # wrong row — e.g. anchor_label = the field's own name) is NOT a
                # trustworthy correction, so it does NOT win Tier-A; it falls through
                # to the normal confidence contest (where its capped conf yields to a
                # located mapping). `located` defaults True so a located teach — and
                # any caller/test that builds results without the flag — is unchanged.
                # OCR-QUALITY gate on the outright win: an authoritative crop whose
                # read contains a GARBLED word (min substantial-word confidence low)
                # is not trustworthy enough to win OUTRIGHT over a credible
                # alternative — e.g. a re-teach that read "Aaiumant Care Homes Ltd -
                # Galaorm" (min word conf ~55) should not beat the clean keyword
                # "Beaumont Care Homes Ltd - Galgorm". Such a read FALLS THROUGH to
                # the confidence contest below, where its OCR-capped confidence loses
                # to the clean read. A clean authoritative read (min ≥ threshold, or
                # an inline/text read with no crop conf = None) still wins outright.
                _omin = data.get("ocr_min_conf")
                _ocr_clean = (_omin is None) or (_omin >= _TIER_A_OCR_MIN)
                # COVERAGE gate on the outright win (belt-and-braces with the anchor.py
                # credibility coverage check): an authoritative read of a TYPED field
                # must match MOST of its validation pattern, so a clean-but-wrong value
                # the pattern only matches on a sub-run (a colon-laden MAC, coverage
                # ~0.18) cannot win Tier-A over a full-match mapping — it falls through
                # to the contest where the rx-100% mapping wins. Untyped / date /
                # currency carry no pattern here → no constraint (byte-identical).
                _cov_ok = True
                _vt = (field_patterns.get(key) or {}).get("validation") if field_patterns else None
                if _vt and _vt not in ("date", "currency", "currency_code"):
                    _cpats = (self.patterns.get("validation_patterns") or {}).get(_vt)
                    if _cpats:
                        _cov_ok = anchor._pattern_coverage(data.get("value"), _cpats) >= 0.8
                if data.get("authoritative") and data.get("value") and data.get("located", True) and _ocr_clean and _cov_ok:
                    results[key] = data
                    continue
                # ── KEYWORD-ANCHOR CORROBORATION LIFT (fork A; Oracle SIGN-OFF-W/CONDITIONS
                # 2026-07-23; kill KEYWORD_ANCHOR_CORROB) ── The merge used to DISCARD agreement:
                # an anchor-family read that normalises-equal to the keyword incumbent but loses
                # the contest vanished, so the surviving read carried only its SOLO confidence —
                # and the seeded/override keyword path is capped at 85 BY DESIGN (keyword.py:344,
                # below the 88 critical floor, fail-toward-review), a one-way valve whose only
                # escape (the Stage-4.5 support boost) is structurally unavailable at first
                # contact (formats load at spawn — a new supplier's first batch can't corroborate
                # itself) and lands 1 short at support 3-4 (+2 → 87). When TWO differently-located
                # reads of a FILING-CRITICAL field agree, the E2 bar ("two independent reads
                # agree") is met: lift the surviving keyword read to the SAME corroborated
                # confidence E2 uses (>= the 88 floor). Value and method are KEPT (the keyword
                # value is the cleaned/suffix-stripped one; method ripples through every
                # method=='keyword' consumer); no note is added or removed (a noted incumbent
                # never reaches here — the flagged gate owns it). Witnesses: located, un-noted
                # anchor_inline / anchor_crop / anchor_crop_relocated only — anchor_registration
                # is blind geometry (located-by-fiat, an independence fraud), the bare 'anchor'
                # text-fallback is the SAME full-page line read the keyword pass makes (same
                # caption, same line — no independence), and anchor_crop_crosscheck is a
                # DISAGREEMENT event (E2 owns it). The peer already passed the Stage-2
                # credibility gates above. Placement (Oracle C5): AFTER Tier-A — an AUTHORITATIVE
                # agreeing peer wins outright above and never reaches this lift; if it sits <88
                # itself the doc still holds, by design (the recovered/capped classes' escapes
                # are born-digital exact-text + the support boost, anchor.py:1247-1275 — do NOT
                # extend this lift to them, pinned). Lone/uncorroborated reads keep holding.
                if (os.environ.get("KEYWORD_ANCHOR_CORROB", "1") != "0"
                        and existing
                        and existing.get("method") in ("keyword", "keyword_override")
                        and int(existing.get("confidence") or 0) < 88
                        and not existing.get("validation_note")
                        and (key in date_field_keys or _is_ref_field(key))
                        and data.get("method") in ("anchor_inline", "anchor_crop", "anchor_crop_relocated")
                        and data.get("located", True)
                        and not data.get("validation_note")
                        and data.get("value")
                        and _values_normalise_equal(data.get("value"), existing.get("value"),
                                                    key in date_field_keys)):
                    results[key] = {**existing,
                                    "confidence": max(int(existing.get("confidence") or 0),
                                                      _CROSSCHECK_CORROB_CONF)}
                    continue
                # Precedence: a deliberately DRAWN source outranks an AUTO-LEARNED
                # anchor. A hand-drawn Stage 0.5 mapping (_STAGE05_LOCATED_METHODS)
                # and an admin label override (method "keyword_override") are
                # "manually drawn" (tier 1/2); a passively auto-learned anchor is
                # an automatic guess (tier 3), not "manually drawn". Only an
                # EXPLICIT ⊕ re-teach (authoritative) anchor may displace them —
                # without this a stale auto-learned anchor with a high computed
                # confidence (≈97, often mis-keyed to the wrong supplier) silently
                # shadows a freshly drawn mapping / override on every reprocess.
                # Two DELIBERATE sources (a drawn mapping and an authoritative
                # anchor) still contend on confidence below, as before.
                if (existing and not data.get("authoritative")
                        and (existing.get("method") == "keyword_override"
                             or _is_stage05_located(existing.get("method")))):
                    continue
                # A user-taught anchor (drawn with the ⊕ tool, resolved via
                # crop+re-OCR at the exact saved coordinates) is ground truth for
                # that spot on the page — it overrides a generic keyword/regex
                # match even when the keyword match scored higher confidence.
                # Without this, a freshly-learned anchor (usage_count=1, so its
                # computed confidence sits ~85) can never beat an
                # already-wrong keyword hit (e.g. base_confidence 88-93 for
                # po_number), so the "wrong value" never gets corrected.
                #
                # EXCEPTION — admin-drawn template mappings (Stage 0.5,
                # method "template_mapping"/"template_mapping_expanded") are
                # excluded from "generic match this overrides". A learned
                # anchor_crop is keyed to whatever supplier_name the pipeline
                # believed at teaching time; if that identity was wrong, the
                # anchor itself is silently wrong too — and unconditionally
                # overriding a freshly hand-placed mapping with it would let
                # exactly that stale, mis-keyed learning permanently shadow a
                # deliberate correction (the bug this guard exists to close).
                # The two now contend on confidence like any other pairing —
                # both are curated "ground truth" tiers, so a fair contest
                # between them is the right arbiter, not an automatic win for
                # whichever one happens to run later in the stage order.
                # OCR gate (same _ocr_clean as Tier-A): a garbled anchor_crop read
                # must not taught-override a clean incumbent either — it falls
                # through to the confidence contest, where its OCR-capped confidence
                # loses. A clean read (or one with no crop conf) keeps the override.
                is_taught_override = (data.get("method") == "anchor_crop"
                                      and data.get("located", True)
                                      and _ocr_clean
                                      and existing
                                      and existing.get("method") != "anchor_crop"
                                      and not _is_stage05_located(existing.get("method")))
                if not existing or is_taught_override or data["confidence"] > existing["confidence"]:
                    results[key] = data
            self._trace_stage('2_anchor', anchor_results, _pre_s2, results)
            new_found = _count_valued_fields(results)
            self.log(f"  Stage 2: +{new_found - found} fields from anchors")
            found = new_found

        # ── Resolve final supplier identity ───────────────────────────────────
        # Stage 0 (template) and the pre-stage logo match only produce a
        # provisional supplier_name — its job is to seed anchor/hint filtering
        # for Stage 2, not to be the final answer. Stage 1/2 can legitimately
        # override results['supplier_name'] with a different, more accurate
        # value (e.g. a user-taught anchor_crop reading the real page beats a
        # near-duplicate-logo template match). Re-resolving here — once, after
        # every stage that can touch the field has run, before _supplier_name
        # is set or any hint/anchor/logo persistence happens — keeps the
        # pipeline's notion of "who is this" in sync with the value the user
        # actually sees and confirms. Without this, the stale provisional
        # identity kept driving downstream lookups/persistence while the
        # displayed field already held the corrected value, silently writing
        # the wrong supplier into the learning corpus on every confirm.
        # ── Template supplier precedence (the #119 / #75 class) ──────────────────
        # A genuine matched-template identity — the template's DOMINANT confirmed issuer (the
        # value the MAJORITY of the confirmed docs that formed it carry; see
        # _genuine_template_supplier — NOT the cosmetic first-confirmed NAME, which can be a
        # minority garble) — is a stronger "who is this?" signal than an identity field READ
        # produced by a teaching-ARTIFACT anchor. A swept "Contoso / Document Issuer" anchor
        # (its captured label IS the field's
        # own display name, never a real caption) fuzzy-locates an unrelated row on THIS doc and
        # harvests a wrong fragment ("Solutions" onto a City Office invoice) at 90% via the
        # LOCATED anchor_inline path — so neither the blind-read guard nor a plain confidence
        # contest catches it. When such an artifact read DISAGREES with the genuine template
        # name, prefer the template name. Deliberately NARROW: it fires ONLY for an artifact-
        # labelled anchor read, so it leaves untouched — a doc whose identity really IS that
        # value (the same anchor reading it correctly, where template + read AGREE); a read off a
        # REAL caption (Greenfield's "Supplier:" located read — its label is not the field's
        # display name, so this never fires and the legitimate re-resolution stands); a keyword
        # read; and any doc that matched only a generic template. Reusable: any doc where a swept
        # artifact anchor contradicts a confirmed template identity.
        _sn = results.get('supplier_name')
        _tmpl_sup = _genuine_template_supplier(matched_tmpl)
        # POISON GUARD (Oracle 2026-07-14): the same dominant_supplier this override trusts can be
        # POISONED — templates 4/5/7 are NAMED 'Cascade Water Systems' but learned 'Northgate Textiles'
        # (Northgate docs confirmed under Cascade-named templates via the logo collision). Without this,
        # a Cascade docket's CORRECT 'Cascade' read would be overridden to the poisoned 'Northgate'@90
        # UN-NOTED (auto-fileable → silent wrong folder), and the branding backstop is itself poisoned.
        # Require the template identity's own NAME to appear on THIS page (value-corroboration) before it
        # may override — the SAME gate the fill uses. Kill switch TEMPLATE_PRECEDENCE_CORROBORATE (on).
        if (_tmpl_sup and os.environ.get("TEMPLATE_PRECEDENCE_CORROBORATE", "1") != "0"
                and not _template_identity_corroborated(_tmpl_sup, ocr_text)):
            _tmpl_sup = None
        if _sn and _sn.get('value') and _tmpl_sup:
            def _ns(v):
                return keyword.normalize_supplier_name(v or '').strip().lower()
            if _ns(_sn.get('value')) != _ns(_tmpl_sup):
                _id_labels = {(f.get('label') or '').strip().lower()
                              for f in field_defs if f.get('key') in _IDENTITY_FIELD_KEYS}
                _id_labels.discard('')
                _sn_label = (_sn.get('anchor') or '').strip().lower()
                if (str(_sn.get('method') or '').startswith('anchor')
                        and _sn_label and _sn_label in _id_labels):
                    self.log(f"  Template supplier precedence: identity anchor read "
                             f"'{_sn.get('value')}' via artifact label '{_sn_label}' "
                             f"disagrees with template identity '{_tmpl_sup}' — using template")
                    results['supplier_name'] = {
                        "value":      _tmpl_sup,
                        "confidence": 90,
                        "method":     "template_identity",
                    }

        # IDENTITY POSITIONAL-READ DROP (the cross-supplier issuer-bleed fix) — see the method. Fires
        # AFTER the template-supplier-precedence override above (a corroborated template identity has
        # already replaced the artifact read) and BEFORE resolved_supplier is read below, so a blanked
        # issuer falls to Stage 2.5a hint recovery / logo / keyword, or empty→review.
        self._drop_positional_identity_read(results, field_defs)

        # OPERATOR PIN is authoritative through the FINAL re-resolve (Oracle C4): a later stage may have
        # overwritten results['supplier_name'] (a keyword/anchor read), but the operator DECIDED the
        # issuer — re-assert the pin as the final identity (review-bound by the operator_pin note).
        # Kill switch SUPPLIER_PIN; off -> byte-identical.
        if pinned_supplier and os.environ.get('SUPPLIER_PIN', '1') != '0':
            results["supplier_name"] = {
                "value":           pinned_supplier,
                "confidence":      75,
                "method":          "operator_pin",
                "validation_note": "Supplier set by you — confirm to file.",
            }

        resolved_supplier = (results.get('supplier_name') or {}).get('value') or None
        if resolved_supplier and resolved_supplier != supplier_name:
            if supplier_name:
                self.log(
                    f"  WARNING: supplier identity changed during extraction — "
                    f"pipeline='{supplier_name}' field='{resolved_supplier}' "
                    f"(file={filename}) — using field value",
                    level="warn",
                )
            supplier_name = resolved_supplier

        # Normalise supplier identity to one canonical form before it drives any
        # downstream supplier-scoped lookup (hints, anchors, format anomaly) or
        # gets persisted: OCR edge noise like a leading smart quote ("‘Cloud VPS")
        # otherwise splits the learning corpus so prior corrections never apply.
        if supplier_name:
            normalised = keyword.normalize_supplier_name(supplier_name)
            if normalised != supplier_name:
                supplier_name = normalised
                if results.get('supplier_name'):
                    results['supplier_name'] = {**results['supplier_name'], 'value': supplier_name}

        # ── Stage 2.5a: Supplier name text-scan fallback ─────────────────────────
        # If logo match failed and keyword didn't find supplier_name, scan the
        # top of the OCR text for any known supplier name from confirmed hints.
        # This handles suppliers like "SuperStore" whose name appears as plain
        # text rather than an identifiable logo.
        #
        # Gated on PLAUSIBILITY, not mere presence: a stale template/anchor seed
        # of an implausible short fragment ("IN") used to count as "already have
        # a supplier" and skipped this recovery entirely — letting the fragment
        # win. Now an implausible incumbent is treated like no incumbent, so the
        # scan can recover the real, plausible name from confirmed hints.
        # TEXT-FIRST ISSUER GRADUATION (gary-designed, Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-15):
        # a review-bound template_identity FILL (@70 + "inferred from previously filed documents"
        # note) is graduated to the confident, un-noted hint_text_match resolution 2.5a would ITSELF
        # produce for a plain-text-wordmark supplier — when the SAME value is corroborated by a
        # usage>=3 confirmed hint present in the issuer band.
        # ⚠ THAT SENTENCE WAS NOT TRUE UNTIL 2026-07-20 (Oracle C2). The corroboration window was a
        # raw ocr_text[:600] slice, which on a real invoice contains the RECIPIENT block — so a
        # template-inferred supplier that is actually the CUSTOMER on this page could corroborate
        # itself from under "Bill To" and SHED ITS REVIEW NOTE. That matters more than a wrong
        # value: graduation replaces a noted fill with an UN-noted one, and trust.js refuses
        # auto-file on any non-empty note BEFORE the floor comparison — so shedding the note is
        # what removes the human checkpoint. `_issuer_hint_band` is what finally makes the sentence
        # above describe the code. NOTE the honest limit: it truncates at a RECIPIENT MARKER, so a
        # marker-free page (a "To:"-first or uncaptioned-address layout) still gets the legacy
        # window — the hardest layouts are NOT closed by this.
        # The logo misses on these (its region
        # crop encodes the variable Bill-To block — Phillip), so the fill fires and BLOCKS this
        # stricter path (the fill's value is plausible, so the gate below skipped it). The graduated
        # set is a STRICT SUBSET of 2.5a's already-trusted un-noted set (2.5a's bar PLUS whole-page
        # template corroboration PLUS value==V no-swap), so it drops no safety the un-noted path
        # doesn't already accept; the post-2.5a guard suite (branding/identity/type-ambiguity/
        # wordness/recipient-caption) re-runs on the un-noted value. Value is FIXED to V — it can
        # NEVER graduate a DIFFERENT supplier. Kill switch env TEMPLATE_IDENTITY_GRADUATE (default
        # ON). See tests/test_template_identity_graduate.py.
        # Eligible incumbent for text-first graduation: a review-bound template_identity fill, ONLY
        # when the kill switch is on. None on the original implausible-incumbent path (unchanged).
        _incumbent = None
        if os.environ.get("TEMPLATE_IDENTITY_GRADUATE", "1") != "0":
            _incumbent = self._noted_template_fill_value(results.get("supplier_name"))
        if hints and (not keyword._is_plausible_supplier_name(supplier_name) or _incumbent is not None):
            ocr_top = self._issuer_hint_band(ocr_text)
            # C1 (Oracle): if the buyer-issued guard just dropped a vendor caption, Stage 2.5a must
            # not silently re-adopt that same value from a stored hint (an install that both ORDERS
            # FROM and is INVOICED BY "Sandpiper" would have it as a supplier_name hint, and a
            # "Supplier:" caption sits near the top). A DIFFERENT true-issuer hint is still recoverable.
            _suppressed_norm = self._accept_norm(_suppressed_issuer or "")
            # GRADUATION no-swap: when firing off a noted fill (_incumbent set), ONLY a hint confirming
            # that value V may qualify — a different-supplier hint, even higher-usage, can never win.
            _pick = self._supplier_hint_upgrade(_incumbent, hints, ocr_top, _suppressed_norm)
            if _pick:
                best_hint, best_usage = _pick
                supplier_name = best_hint
                results["supplier_name"] = {
                    "value":      best_hint,
                    "confidence": min(85, 60 + best_usage * 2),
                    "method":     "hint_text_match",
                }
                self.log(f"  Stage 2.5: supplier '{best_hint}' identified from text scan"
                         f"{' (graduated from a review-bound template_identity fill)' if _incumbent else ''}")
            elif _incumbent is None and os.environ.get("ISSUER_HINT_BAND", "1") != "0":
                # FAIL TOWARD REVIEW (Oracle C1, 2026-07-20). This branch exists ONLY because the
                # band narrowing above can now suppress a match the legacy window would have made.
                #
                # Without it the narrowing fails toward a SILENT WRONG VALUE, not toward review:
                # there is no else here, so `results['supplier_name']` keeps whatever it had — and
                # on THIS arm (`_incumbent is None`) the incumbent is by definition IMPLAUSIBLE,
                # the "stale template/anchor seed of an implausible short fragment ('IN')" this
                # stage exists to rescue. Suppressing the rescue would leave 'IN' standing as the
                # filing folder and the learning scope, unnoted. Nothing downstream blanks it.
                #
                # DELTA-SCOPED on purpose: it fires only where the legacy slice WOULD have matched
                # and the band did not, so a document where 2.5a declines today for any other
                # reason is completely unaffected.
                _legacy = (ocr_text or "")[:600].lower()
                if _legacy != ocr_top and self._supplier_hint_upgrade(None, hints, _legacy, _suppressed_norm):
                    results["supplier_name"] = {
                        "value":           None,
                        "confidence":      0,
                        "method":          "issuer_band_withheld",
                        "validation_note": "A known supplier's name appears on this page, but not in "
                                           "the letterhead area, so it wasn't trusted as the issuer. "
                                           "Please confirm who issued this document.",
                    }
                    supplier_name = None
                    self.log("  Stage 2.5: a known supplier name matched OUTSIDE the issuer band "
                             "— withheld and routed to review rather than adopted")

        # ── Stage 2.6: LATE-ANCHOR RESCUE (2026-07-10) ───────────────────────────
        # On a doc whose supplier was UNKNOWN at Stage-2 time (no template/logo hit — exactly
        # the new/poorly-fingerprinted suppliers whose teaching matters most), _anchor_matches
        # cannot admit that supplier's OWN positional anchors (a named-supplier positional
        # anchor needs a supplier match; only IDENTITY anchors ride the type-match branch).
        # When 2.5a then resolves the supplier from text, re-run anchor extraction over the
        # DELTA OF ADMISSION — anchors admissible under the resolved supplier but NOT under
        # None. By construction that delta is EXACTLY the resolved supplier's own named
        # positional anchors: identity/global/__unknown__ anchors were already admitted under
        # None (excluded), and a DIFFERENT named supplier's positional anchors fail under both
        # (excluded) — so the rescue can never re-admit a cross-supplier positional read (the
        # 2026-07-09 decision stands) and never touches identity fields. FILL-EMPTY-ONLY
        # (an incumbent is never displaced) + confidence capped at _LATE_RESCUE_CAP 85: the
        # supplier premise itself is a text-scan capped 85, and 85 < the 88 critical-field
        # floor, so a rescued ref/date can never auto-file at any threshold; a blind
        # (label-not-found) read keeps anchor.py's own 50 cap → needs_review. Fail-toward-
        # review throughout. Guarded by tests/test_late_anchor_rescue.py.
        # NAMED SEAM (Oracle, 2026-07-10) — A-over-B precedence inversion: a Stage-1 SEEDED
        # free-text read (keyword@75) fills first, so fill-empty-only EXCLUDES that field
        # from this delta and the ⊕-taught authoritative anchor never reads — on late-
        # resolving docs the normal "teach displaces keyword" precedence is inverted until
        # the supplier gains a template/logo. Fails toward Review (no-template docs are
        # blocked sub-100 by docTrustGate), not silence. Follow-up option if it bites: let
        # an authoritative LOCATED rescue read displace a plain seeded 'keyword' incumbent,
        # mirroring is_taught_override — requires reusing the Stage-2 merge gates, not this
        # fill-empty loop.
        if (LATE_ANCHOR_RESCUE_ENABLED and anchors and page_images
                and _late_rescue_applicable(_s2_supplier, supplier_name)):
            # Delta tightened to SAME-TYPE anchors only (Oracle C4): a legacy NULL-type row
            # would ride the supplier-match branch into the delta (no type conflict when the
            # anchor carries no type) — excluded here so "delta = the resolved supplier's own
            # SAME-TYPE positional anchors" holds exactly; fail direction = no rescue.
            rescue_set = [a for a in anchors
                          if (a.get("document_type") or "") == (document_slug or "")
                          and anchor.anchor_admissible(a, supplier_name, document_slug)
                          and not anchor.anchor_admissible(a, None, document_slug)
                          and not (results.get(a.get("field_key")) or {}).get("value")]
            if rescue_set:
                _r_identity_labels = {(f.get('label') or '').strip().lower()
                                      for f in field_defs if f.get('key') in _IDENTITY_FIELD_KEYS}
                _r_identity_labels.discard('')
                _r_on_reject = ((lambda fk, st, v, r: self._t(
                    "anchor_reject", field=fk, method=st, value=v, reason=r))
                    if self._trace else None)
                try:
                    rescue_results = anchor.extract_with_anchors(
                        ocr_text, rescue_set, supplier_name, document_slug,
                        page_images=page_images,
                        field_patterns=field_patterns,
                        validation_patterns=self.patterns.get("validation_patterns", {}),
                        slice_capture=(self._capture_slice if (self._trace and self._slice_dir) else None),
                        format_lookup=self._make_format_lookup(supplier_name, document_slug),
                        page_transform=None,
                        on_reject=_r_on_reject,
                        page_text_lines=page_text_lines,
                        text_field_keys=text_field_keys,
                        multiline_lookup=self._make_multiline_lookup(supplier_name, document_slug),
                        identity_labels=_r_identity_labels,
                    ) or {}
                except Exception as e:
                    rescue_results = {}
                    self.log(f"  Stage 2.6: late-anchor rescue failed ({e})", "warn")
                self._remember_candidates('2.6_late_anchor', rescue_results)
                rescued = 0
                for key, data in rescue_results.items():
                    if (results.get(key) or {}).get("value"):
                        continue                      # fill-empty-only — never displace
                    data = dict(data)
                    data["confidence"] = min(int(data.get("confidence") or 0), _LATE_RESCUE_CAP)
                    data["late_rescue"] = True        # provenance for trace; method string untouched
                    results[key] = data
                    rescued += 1
                    self._t("late_anchor_rescue", field=key,
                            value=str(data.get("value"))[:40], conf=data["confidence"])
                if rescued:
                    self.log(f"  Stage 2.6: {rescued} field(s) rescued from this supplier's "
                             f"anchors (supplier resolved after Stage 2)")

        # ── Stage 2.5b: Apply supplier hints (fill missing fields only) ──────────
        # Hints only fill fields that keyword/anchor found NOTHING for.
        # They do not override a found value — each document's variable fields
        # (date, reference, customer name) differ per invoice.
        if hints and supplier_name:
            hint_results = self._apply_hints(hints, supplier_name, document_slug, field_defs)
            hint_count = 0
            self._remember_candidates('2.5_hint', hint_results)
            for key, data in hint_results.items():
                existing = results.get(key)
                if not existing or not existing.get("value"):
                    results[key] = data
                    hint_count += 1
            if hint_count:
                self.log(f"  Stage 2.5: {hint_count} field(s) set from learned hints")

        # ── Stage 2.5c: learned noise-edge stripping (template-scoped) ───────
        # Runs before character-substitution correction below so a value like
        # "# 14269" is trimmed to "14269" first — giving try_correct a clean,
        # correctly-sized string to apply digit-confusion fixes to, rather than
        # failing its length check against a noise-padded value.
        if self.noise_profile_index:
            n_denoised = 0
            for key, data in list(results.items()):
                if not isinstance(data, dict) or not data.get("value"):
                    continue
                denoised, was_changed = ocr_corrector.denoise_value(
                    data["value"], key, supplier_name, document_slug,
                    self.noise_profile_index,
                )
                if was_changed:
                    results[key] = {
                        **data,
                        "value":      denoised,
                        "confidence": min(95, (data.get("confidence") or 0) + 5),
                        "method":     data.get("method", "") + "+denoised",
                    }
                    n_denoised += 1
                    self._t("transform", field=key, stage="2.5_denoise",
                            method=results[key]["method"], confidence=results[key]["confidence"],
                            **{"from": data["value"], "to": denoised})
            if n_denoised:
                self.log(f"  Stage 2.5: {n_denoised} value(s) denoised via learned template")

        # ── Stage 2.5b: OCR format correction ────────────────────────────────
        if self.format_index:
            n_corrected = 0
            for key, data in list(results.items()):
                if not isinstance(data, dict) or not data.get("value"):
                    continue
                # Never rewrite a value the corpus has actually CONFIRMED (reggie): the count-weighted
                # derive_template can force a position to a category, and try_correct would then
                # SILENTLY (no flag) coerce a legitimate minority variant that OCR read correctly. If
                # this exact value is a confirmed sample for the scope, it is real — leave it.
                if ocr_corrector.is_known_value(self.known_index, key, supplier_name, document_slug, data["value"]):
                    continue
                corrected_val, boost = ocr_corrector.correct_extraction(
                    data["value"], key, supplier_name, document_slug,
                    self.format_index,
                )
                if boost > 0:
                    new_conf = min(95, (data.get("confidence") or 0) + boost)
                    was_changed = corrected_val != data["value"]
                    results[key] = {
                        **data,
                        "value":      corrected_val,
                        "confidence": new_conf,
                        "method":     (data.get("method", "") + "+corrected")
                                      if was_changed else data.get("method", ""),
                    }
                    if was_changed:
                        n_corrected += 1
                        self._t("transform", field=key, stage="2.5_correct",
                                method=results[key]["method"], confidence=new_conf,
                                **{"from": data["value"], "to": corrected_val})
            if n_corrected:
                self.log(f"  Stage 2.5: {n_corrected} OCR correction(s) applied")

        # ── Stage 2.5d: snap a CODE value to its DOMINANT confirmed literal (reggie) ──
        # Fixes what try_correct can't: an inserted SPACE (length change), and a slip on a field
        # whose consensus template was polluted by a mis-confirmed artifact. Count-weighted — it
        # only snaps to a value that dominates the confirmed history (≥5 and ≥80%), so a 1x
        # pollutant can never be the target and a variable field (no dominant) self-excludes.
        # Skips: name fields (name_match owns those) and FIXED/override reads (a user-set value,
        # not an OCR read); a read that is ITSELF an observed confirmed value is left alone.
        if self.dominant_index:
            n_snapped = 0
            for key, data in list(results.items()):
                if not isinstance(data, dict) or not data.get('value'):
                    continue
                _m = str(data.get('method') or '')
                if value_quality.is_name_like_field(key) \
                        or 'override' in _m or 'template_fixed' in _m or 'template_mapping' in _m:
                    continue
                rec = ocr_corrector.lookup_dominant(self.dominant_index, key, supplier_name, document_slug)
                if not rec:
                    continue
                val = str(data['value'])
                if val in rec.get('known', ()):                      # already a real (observed) value → leave it
                    continue
                snapped, n_subs = ocr_corrector.snap_to_dominant(val, rec['dominant'])
                if snapped and snapped != val:
                    new_conf = min(95, (data.get('confidence') or 0) + (18 if n_subs == 0 else 12))
                    results[key] = {
                        **data,
                        'value':           snapped,
                        'display_value':   snapped,
                        'confidence':      new_conf,
                        'was_corrected':   True,
                        'corrected_to':    snapped,
                        'validation_note': f"Auto-corrected to this field's recurring value (was: {val})",
                        'method':          (data.get('method', '') + '+snapped'),
                    }
                    n_snapped += 1
                    self._t('transform', field=key, stage='2.5d_snap',
                            method=results[key]['method'], confidence=new_conf,
                            **{'from': val, 'to': snapped})
            if n_snapped:
                self.log(f"  Stage 2.5d: {n_snapped} value(s) snapped to the dominant learned value")

        # ── Background reconciliation components (SHADOW) ──────────────────────
        # Read subtotal/VAT/shipping/discount that the doc type does NOT define as fields,
        # purely so the total-reconciliation guardrail + the "mathematically verified" badge
        # can run WITHOUT cluttering the type with fields the user never created. Marked
        # method='shadow_reconcile' → persisted for the check but never displayed and never
        # learned (Review shows only type fields; getFieldFormats skips the shadow method).
        self._shadow_reconcile_components(results, field_defs, ocr_text, patterns_for_run)

        # ── Reconciliation-aware total pick ────────────────────────────────────
        # A drifted total-mapping / wrong-row anchor can displace a correct keyword total (it read
        # the "Net Total" row, 84.40, over the true "Invoice Total", 101.28). Now that every
        # component is present, prefer the total CANDIDATE that actually BALANCES over one that
        # doesn't — objective maths, never over an explicit ⊕ teach. Before the Stage-4 flag.
        self._reconciliation_pick_total(results, field_defs)

        # ── Stage 4: Validation ───────────────────────────────────────────────
        self.log("  Stage 4: validating…")
        self._t('stage_start', stage='4_validate')
        _pre_val = self._snap(results)
        results = validator.validate_and_adjust(
            results, field_defs, trace=(self._t if self._trace else None))

        # ── Field cleanup rules (operator-taught, Review right-click toolkit) ──
        # Strip a learned leaked heading/column from a field's WINNER value
        # (keep_block keeps the single pattern/code-shaped token; remove_text removes
        # a learned caption). Runs HERE — independent of learned format history — so it
        # applies even to fields with no confirmed shape. Honest: rewrites value/
        # display_value with was_corrected + corrected_to + an "auto-trimmed, was: …"
        # note; NOT review-forced (the match guards make it deterministic). No-op when
        # no rule is in scope or every guard refuses → byte-identical.
        if self.field_rules_index and document_slug:
            from extraction import field_rules as _field_rules
            _val_pats = self.patterns.get("validation_patterns") or {}
            for key, data in list(results.items()):
                if key.startswith('_') or not isinstance(data, dict):
                    continue
                val = data.get('value')
                if not isinstance(val, str) or not val:
                    continue
                rules = self._field_rules_for(supplier_name, document_slug, key)
                if not rules:
                    continue
                original = val
                cur = val
                for r in rules:
                    rt = r.get('rule_type')
                    if rt == 'keep_block':
                        _vt = (field_patterns.get(key) or {}).get("validation")
                        _pl = _val_pats.get(_vt) or []
                        if isinstance(_pl, str):
                            _pl = [_pl]
                        pat = ("(?:" + ")|(?:".join(_pl) + ")") if _pl else None
                        cur, _ = _field_rules.apply_keep_block(cur, pat)
                    elif rt == 'remove_text':
                        cur, _ = _field_rules.apply_remove_text(
                            cur, r.get('token_norm') or '',
                            side=r.get('side') or 'trailing',
                            min_prefix=r.get('min_prefix') or 3)
                if cur != original:
                    results[key] = {**data, 'value': cur, 'display_value': cur,
                                    'was_corrected': True, 'corrected_to': cur,
                                    'validation_note': f'auto-trimmed, was: "{original}"'}

        # ── Stage 4.5: Format anomaly check ──────────────────────────────────
        # Compares each extracted value against the coarse format class learned
        # from confirmed historical values for the same
        # (supplier_name, document_type, field_key) group.  On anomaly: caps
        # confidence at 45 and adds a traceable validation_note.  Fields
        # already flagged by Stage 4 are skipped to avoid double-penalisation.
        # No correction is proposed here — that is Stage 2 of this feature.
        format_anomaly_flagged = False
        # The wordness gate must run COLD (no learned history) — that is where free-text
        # name silent-errors are worst — so enter this block when name_wordness is on even
        # if the format index is empty. When name_wordness is OFF this is byte-identical to
        # the original `format_class_index and document_slug` guard.
        if document_slug and (self.format_class_index or self.name_wordness):
            s_lower  = (supplier_name or '').lower().strip()
            dt_lower = document_slug.lower().strip()
            n_flagged = 0
            field_charsets = self.patterns.get('field_charsets') or {}
            field_types    = {f.get('key'): f.get('type') for f in (field_defs or [])}
            field_labels   = {f.get('key'): (f.get('label') or '') for f in (field_defs or [])}
            validation_patterns = self.patterns.get('validation_patterns') or {}
            _reread_cache  = {}   # per-extract full-page image_to_data cache (gate-failure re-read)
            for key, data in list(results.items()):
                if key.startswith('_') or not isinstance(data, dict):
                    continue
                if data.get('validation_note'):
                    continue  # Stage 4 already flagged this field
                val = data.get('value')
                if not val:
                    continue
                # ── EDGE-JUNK CLEANUP (name-like free-text) ── a real name never
                # STARTS with "--«" / a stray symbol; strip OCR edge artefacts BEFORE
                # the charset/format checks below so a cleaned value isn't needlessly
                # flagged, and so a keyword read (which skips the crop-path cleaning)
                # gets the same edge hygiene a crop read already has. EDGES ONLY —
                # the interior is untouched (free-text variation preserved). The value
                # change is visible in the trace; no review is forced (the charset
                # check then runs on the CLEANED value). See value_quality.strip_name_edges.
                _ftype0 = field_types.get(key)
                if _ftype0 in (None, 'text', 'multiline_text') and value_quality.is_name_like_field(key):
                    _spec0 = (field_charsets.get(_ftype0, field_charsets.get('default')) if field_charsets else None)
                    _clean = value_quality.strip_name_edges(str(val), _spec0)
                    if _clean and _clean != val:
                        data = {**data, 'value': _clean, 'display_value': _clean}
                        results[key] = data
                        val = _clean
                # ── Type-authority gate ── a value that FULLY matches its field's PRECISE
                # validation pattern (mac/ip) is type-authoritative, and a label/landmark-
                # CONFIRMED read (relocated/inline/registration / Stage 0.5 mapping) already
                # cleared the anchor-stage credibility + column-bleed guards. Either way the
                # generic charset + learned-SHAPE heuristics below must not second-guess it:
                # a MAC's ':' isn't "unexpected", a new IP/serial just differs in shape from
                # history. The generic 'alphanumeric' is NOT precise, so an UN-anchored drift
                # (a rigid "Bookinc" via keyword/anchor_crop) still gets shape-gated.
                _val_key = (field_patterns.get(key) or {}).get('validation')
                _authoritative = bool(
                    _val_key in anchor._PRECISE_VAL_TYPES
                    and validation_patterns.get(_val_key)
                    and anchor._pattern_coverage(str(val), validation_patterns[_val_key])
                        >= anchor._PATTERN_AUTHORITATIVE_MIN)
                _method = data.get('method') or ''
                _label_confirmed = (_method in anchor._LABEL_CONFIRMED_METHODS
                                    or _is_stage05_located(_method))
                # ── Precise-type integrity (MAC/IP) ── a field with a PRECISE format whose
                # value does NOT satisfy it is malformed — an OCR slip like a non-hex 'T' in
                # a MAC ("00:26:T3:F9:56:38"). The generic charset below can't catch it (a
                # letter is charset-valid), and the precise pattern is otherwise used only to
                # GRANT authority, never to flag a miss. So when a non-authoritative value sits
                # on a precise-type field: trim surrounding junk if a valid address is embedded
                # (silent — fixes a trailing OCR control char that also caused the bogus
                # "unexpected characters ()" flag); else recover a single OCR-confusion slip if
                # it makes the value fully valid (recover-and-FLAG, review-forced); else flag it.
                if (_val_key in anchor._PRECISE_VAL_TYPES
                        and validation_patterns.get(_val_key) and not _authoritative):
                    _norm, _kind = value_quality.normalize_network_address(
                        str(val), _val_key, validation_patterns[_val_key])
                    _nice = {'mac_address': 'MAC address',
                             'ip_address': 'IP address'}.get(_val_key, _val_key.replace('_', ' '))
                    if _kind == 'clean':
                        results[key] = {**data, 'value': _norm, 'display_value': _norm}
                        continue                       # valid after trimming junk — no flag
                    if _kind == 'repaired':
                        results[key] = {
                            **data, 'value': _norm, 'display_value': _norm,
                            'was_corrected': True, 'corrected_to': _norm,
                            'confidence':      min(data.get('confidence') or 0, 70),
                            'validation_note': "auto-corrected a likely misread (was “"
                                               + str(val) + "”) — please verify",
                        }
                        n_flagged += 1
                        format_anomaly_flagged = True
                        continue
                    if _kind == 'invalid':
                        results[key] = {
                            **data,
                            'confidence':      min(data.get('confidence') or 0, 70),
                            'validation_note': "doesn’t look like a valid " + _nice
                                               + " — please verify",
                        }
                        n_flagged += 1
                        format_anomaly_flagged = True
                        continue
                # ── Valid-character policy (Phase 1, backend-only FLAG) ── before the
                # format lookup so it covers EVERY field, not only those with learned
                # formats. Surfaces unexpected OCR symbols for the field TYPE (note +
                # conf cap); NEVER strips the value. Skips date/currency (their own
                # normalisers own punctuation); defers to any existing note via the
                # guard above. See format_anomaly_checker.charset_disallowed +
                # config field_charsets.
                if field_charsets and not _authoritative:
                    _ftype = field_types.get(key)
                    if _ftype not in ('date', 'currency', 'currency_code'):
                        _spec = field_charsets.get(_ftype, field_charsets.get('default'))
                        _bad = format_anomaly_checker.charset_disallowed(str(val), _spec)
                        # Only flag chars that are actually VISIBLE — an invisible control/
                        # zero-width char (OCR noise) must not render as "unexpected characters
                        # ()" with an empty list. The replacement char U+FFFD IS printable, so a
                        # genuine garble still flags. Nothing visible => no flag.
                        _bad_shown = [c for c in _bad if c.isprintable() and not c.isspace()]
                        if _bad_shown:
                            results[key] = {
                                **data,
                                'confidence':      min(data.get('confidence') or 0, 70),
                                'validation_note': "unexpected characters (" + " ".join(_bad_shown) + ") - please verify",
                            }
                            n_flagged += 1
                            format_anomaly_flagged = True
                            continue
                # ── Wordness gate (default OFF) ── before the format lookup so it works
                # COLD (no learned history), where free-text name silent-errors are worst.
                # FLAG-ONLY: a free-text NAME read that doesn't read like a name (document
                # chrome / ref-code bleed / OCR garble) gets a note + conf cap; the value
                # is never changed. Gated on is_name_like_field; self-calibrates per field
                # via the learned word_like flag when history exists (code-like field =>
                # skip). See extraction/wordness.py + reggie's review.
                if self.name_wordness and not _authoritative and key in text_field_keys \
                        and value_quality.is_name_like_field(key) \
                        and self._accept_norm(val) not in self.accepted_names:
                    _fe = (self.format_class_index.get((s_lower, dt_lower, key)) if s_lower else None) \
                          or self.format_class_index.get(('', dt_lower, key))
                    _word_like = True if not _fe else _fe.get('word_like', True)
                    _wnote = wordness.name_structure_flag(str(val), word_like=_word_like)
                    if _wnote:
                        results[key] = {
                            **data,
                            'confidence':      min(data.get('confidence') or 0, 70),
                            'validation_note': _wnote,
                        }
                        n_flagged += 1
                        format_anomaly_flagged = True
                        continue
                # Supplier-scoped format first; fall back to the doc-type-scoped one ('' supplier)
                # so qualification works even when the supplier is never identified (document-
                # agnostic learning). The IDENTITY fields (supplier_name/customer_name) get this
                # global fallback TOO — they need its name_lexicon for the canonical name-repair
                # (Lid→Ltd, PROFLE→Profile) + truncation flag below, and those are identity's most-
                # corrected, weakest safety net. What identity must NOT inherit from the global
                # format is the coarse cross-supplier SHAPE veto: its value IS the scope key, so a
                # global format aggregates DIFFERENT companies (a corpus 90% "SuperStore" learns
                # that one shape and would flag every OTHER supplier's clean name). That veto is
                # bypassed for identity at the shape-check below (see _IDENTITY_FIELD_KEYS there),
                # NOT by starving it of the lexicon. (Cf. 0cbafb8, which killed the veto by dropping
                # the whole fallback and silently lost identity's repair + truncation with it — R2.)
                fmt_entry = self.format_class_index.get((s_lower, dt_lower, key)) if s_lower else None
                if not fmt_entry:
                    fmt_entry = self.format_class_index.get(('', dt_lower, key))
                if not fmt_entry:
                    continue
                # ── Canonical token repair for NAME-LIKE fields ── runs INDEPENDENT of
                # the anomaly verdict: a garbled company name is coarse-class FREETEXT
                # and may not trip check_value at all, so gating it behind `anomaly`
                # would make it dead code. Repairs garbled KNOWN tokens to their learned
                # canonical spelling and keeps the variable tail verbatim (never
                # whole-value snap, never injects a learned token). See name_match.py.
                # TWO TIERS by evidence:
                #   STRONG (every changed token at a NEAR-UNIVERSAL position, doc_freq
                #     >= 0.9, >= 3 docs) — a confident misread fix backed by overwhelming
                #     history ("Beaumont Care Homes Lid" -> "...Ltd"). AUTO-APPLY the
                #     value (the operator wants the misread FIXED, not just suggested);
                #     kept visible via was_corrected + a note, and NOT review-forced
                #     (no format_anomaly_flagged) so a confident fix doesn't nag.
                #   WEAK — emitted as a corrected_to SUGGESTION only (value untouched,
                #     conf capped, review-forced), exactly as before.
                name_lex = fmt_entry.get('name_lexicon')
                if name_lex and key in text_field_keys:
                    from extraction import name_match
                    repaired, strong = name_match.repair_name_value(str(val), name_lex, details=True)
                    if repaired and repaired != str(val):
                        if strong:
                            results[key] = {
                                **data,
                                'value':           repaired,
                                'display_value':   repaired,
                                'was_corrected':   True,
                                'corrected_to':    repaired,
                                # Note carries the ORIGINAL read so the UI can show what
                                # was auto-fixed (the input already holds the correction).
                                'validation_note': f"Auto-corrected to match learned data (was: {val})",
                            }
                        else:
                            results[key] = {
                                **data,
                                'confidence':      min(data.get('confidence') or 0, 70),
                                'corrected_to':    repaired,
                                'validation_note': f"Suggested name correction: {repaired}",
                            }
                            n_flagged += 1
                            format_anomaly_flagged = True
                        continue   # one repair/suggestion per field — skip the anomaly path
                    # ── Truncation / fragment flag (reggie follow-up) ── the dominant
                    # name silent-error class character wordness CANNOT catch (a fragment
                    # is a real word): a value SHORTER than the history length ("...Ltd -"
                    # with the site cut) OR a final-token fragment ("...Ltd - B"). Run
                    # BEFORE conforms_to_lexicon: a final-token fragment still CONFORMS
                    # (stable prefix matches, count reaches expected_len), so conforms would
                    # otherwise suppress it. History-gated (name_lex present) => inert
                    # without confirmed history; under the name_wordness opt-in; flag-only.
                    # For IDENTITY, only flag truncation when the value is anchored to the
                    # learned stable prefix — the global fallback aggregates DIFFERENT companies,
                    # so a legitimately shorter OTHER supplier ("McMahon Associates Ltd" vs a
                    # "Beaumont…"-dominated history) would otherwise false-flag as shorter-than-
                    # usual. Non-identity name fields (single-identity scope) keep the plain check.
                    if self.name_wordness and name_match.is_truncated_name(str(val), name_lex) \
                            and self._accept_norm(val) not in self.accepted_names \
                            and (key not in _IDENTITY_FIELD_KEYS
                                 or name_match.matches_stable_prefix(str(val), name_lex)):
                        results[key] = {
                            **data,
                            'confidence':      min(data.get('confidence') or 0, 70),
                            'validation_note': 'looks shorter than the usual name — please verify',
                        }
                        n_flagged += 1
                        format_anomaly_flagged = True
                        continue
                    # No repair / truncation. If the value CONFORMS to the learned name
                    # pattern (every stable PREFIX token matches; only the variable
                    # TAIL differs), the name_lexicon — a more precise model than the
                    # coarse learned SHAPE — says this is the EXPECTED pattern. Suppress
                    # the shape "format differs" flag: a customer "Beaumont Care Homes
                    # Ltd - <new site>" is normal, not an anomaly, even when the new
                    # site's length was never confirmed before.
                    if name_match.conforms_to_lexicon(str(val), name_lex):
                        continue
                # ── MISREAD-SEPARATOR recover-and-flag (reggie) ── a value carrying a foreign,
                # known-confusable separator ("PO.20011") where THIS field's history is uniformly a
                # DIFFERENT one ("PO-…") is a likely OCR misread that PASSES both the charset and the
                # (deliberately separator-folded) shape check — so it would file SILENTLY. Flag it
                # with the corrected value offered as a suggestion (never a silent rewrite). Gated
                # exactly like the shape check below: an authoritative/label-confirmed read wins on
                # type alone, structured refs only (key not in text_field_keys). Inert unless the
                # field learned a dominant separator (sep_uniform), so a mixed-separator field and
                # the deliberate interchangeable-separator fold are untouched.
                if not _authoritative and not _label_confirmed and key not in text_field_keys:
                    _sepfix = format_anomaly_checker.propose_sep_fix(str(val), fmt_entry)
                    if _sepfix:
                        results[key] = {
                            **data,
                            'confidence':      min(data.get('confidence') or 0, 70),
                            'corrected_to':    _sepfix,
                            'validation_note': f"possible misread separator — did you mean '{_sepfix}'? please verify",
                        }
                        n_flagged += 1
                        format_anomaly_flagged = True
                        continue
                anomaly = format_anomaly_checker.check_value(str(val), fmt_entry)
                if anomaly:
                    # Type-authoritative (precise mac/ip pattern) or label/landmark-
                    # confirmed read — accept clean, no shape flag (see the type-authority
                    # gate above): the value matches the field's nature / was read beside
                    # its located label, so a learned digit-position SHAPE mismatch is not
                    # an anomaly. The UN-anchored rigid/keyword path still falls through.
                    if _authoritative or _label_confirmed:
                        continue
                    # Free-text field (name/address): a learned shape must never
                    # withhold or trim a valid value here — its shape varies
                    # legitimately. Keep the value, flag softly for a human to
                    # eyeball. This is what stops a clean company name being
                    # discarded by a longer historical shape. Structured/code
                    # fields fall through to the full shape enforcement below.
                    if key in text_field_keys:
                        # CLEAN-NAME RELAX: a well-formed name (good name-quality; charset
                        # already clean by here) whose field has NO learned stable-prefix
                        # identity — the confirmed names don't share a common prefix because
                        # the field holds DIFFERENT customers/companies — is NOT flagged
                        # merely for a length/word-count difference: a new customer
                        # ("McMahon Associates") is normal, not an anomaly. When the field
                        # DOES carry a stable prefix (single-identity history), a non-
                        # conforming value is a genuine anomaly (a TRUNCATED "Beaumont Care
                        # Homes Ltd -" or a WRONG prefix "Totally Different Co -") and still
                        # flags — conforms_to_lexicon already suppressed a legitimate new
                        # tail above. A GARBLED name (quality < 0.5) always flags.
                        _has_stable_prefix = bool(name_lex and name_lex.get('positions'))
                        if not _has_stable_prefix \
                                and value_quality.is_name_like_field(key) \
                                and value_quality.name_quality(str(val)) >= 0.5:
                            continue
                        # IDENTITY (supplier_name/customer_name): never apply the coarse cross-
                        # supplier SHAPE veto. Its value IS the learning scope key, so the global
                        # ('' supplier) format aggregates DIFFERENT companies by definition — a
                        # corpus dominated by one supplier would flag every OTHER supplier's clean
                        # name as "format differs". A garbled identity is still caught by the
                        # name-quality/wordness path + canonical repair above, which need no cross-
                        # supplier shape. (Restores 0cbafb8's intent WITHOUT starving identity of
                        # the name_lexicon repair/truncation net — R2.)
                        if key in _IDENTITY_FIELD_KEYS:
                            continue
                        results[key] = {
                            **data,
                            'confidence':      min(data.get('confidence') or 0, 70),
                            'validation_note': 'format differs from the usual — please verify',
                        }
                        n_flagged += 1
                        format_anomaly_flagged = True
                        continue
                    # First, recover a CLEAN value by extracting a substring that
                    # matches a learned accepted SHAPE — this strips column-bleed
                    # junk ("2605-0769-1 Work Address Beaumont…") down to the real
                    # value ("2605-0769-1"). Universal: driven by the field's own
                    # learned shapes, never a per-field pattern.
                    extracted = format_anomaly_checker.extract_accepted_shape(str(val), fmt_entry)
                    if extracted and extracted != str(val):
                        results[key] = {
                            **data,
                            'value':           extracted,
                            'validation_note': 'trimmed to the expected format — please verify',
                        }
                        n_flagged += 1
                        format_anomaly_flagged = True
                        continue
                    # Stage 2 — conservative digits-only cleanup. If the learned
                    # class is digits_only, try to repair the value. A confident
                    # repair (only known OCR confusables / separators changed) is
                    # auto-applied as the effective value with an explanatory
                    # note; an uncertain one is surfaced as a review-forced
                    # CANDIDATE (display value untouched).
                    correction = format_anomaly_checker.propose_correction(str(val), fmt_entry)
                    if correction and correction['confident']:
                        results[key] = {
                            **data,
                            'value':           correction['corrected'],
                            'validation_note': correction['note'],
                        }
                    elif correction:
                        results[key] = {
                            **data,
                            'confidence':      min(data.get('confidence') or 0, 45),
                            'corrected_to':    correction['corrected'],
                            'validation_note': correction['note'],
                        }
                    elif anomaly.get('severity') == 'high' or fmt_entry.get('shapes'):
                        # Very wrong for this field — either a hard class violation
                        # (letters where it's always digits/dates) OR the field has
                        # a learned SHAPE that this value, and any substring of it,
                        # doesn't satisfy (e.g. garbage "AyeARr AGAR a" where the
                        # reference is shaped "####-####-#"). Withhold it and ask
                        # for manual entry rather than populate an inconsistent
                        # value. A genuinely new-but-correct shape is accepted once
                        # it has been confirmed enough times (count-gated shapes).
                        # GATE-FAILURE RE-READ (default ON): before withholding, take ONE bounded
                        # second look at the page for a clean, kin re-read (see _maybe_gate_reread).
                        # Frame invariant: it OCRs + crops the SAME raw page_images the engine holds.
                        _reread = self._maybe_gate_reread(
                            str(val), data, fmt_entry, field_types.get(key), field_labels.get(key),
                            page_images, page_provenance, _reread_cache)
                        if _reread is not None and _reread.pop('reread_clean', False):
                            # Normalisation-only recovery (spacing/separator/case; calendar-equal
                            # for dates): the crop re-read agreed with the original on every
                            # alphanumeric character and the result passes the learned format —
                            # a clean read, not an anomaly. No n_flagged/format_anomaly_flagged
                            # bump (an unrelated note on ANOTHER field still holds the doc, and a
                            # pre-existing note on THIS field survived the spread → trust gate).
                            results[key] = _reread
                            continue
                        results[key] = _reread if _reread is not None else {
                            **data,
                            'value':           None,
                            'confidence':      0,
                            'validation_note': "doesn't match the expected format — please enter manually",
                        }
                    else:
                        # In-class difference with no learned shape to enforce —
                        # keep it but flag for a human to verify.
                        results[key] = {
                            **data,
                            'confidence':      min(data.get('confidence') or 0, 45),
                            'validation_note': 'format differs from the usual — please verify',
                        }
                    n_flagged += 1
                    format_anomaly_flagged = True
            if n_flagged:
                self.log(f"  Stage 4.5: {n_flagged} field(s) flagged by format anomaly check")

        self._trace_validation(_pre_val, results)
        self._t('stage_end', stage='4_validate')

        # ── Stage 4.6: gated candidate override (default OFF → no-op) ───────────
        # After Stage 4.5, before metadata, so overall_confidence/needs_review reflect
        # any change. Suggestion-first; never touches a protected winner. No-op unless
        # candidate_override is enabled (then the ledger built during merge is read).
        self._resolve_candidates(results, field_defs, supplier_name, document_slug)

        # ── Recipient-caption issuer guard (flag-only; Oracle-signed 2026-07-09) ──
        # Runs AFTER the final supplier resolution and BEFORE the learned-agreement
        # boost (which skips noted fields, so the cap can never be re-lifted) and the
        # overall-confidence/needs_review computation (so both see the cap).
        self._flag_recipient_caption_issuer(results, field_defs, supplier_name)
        # Cross-field duplication guard (Slice 1) — after the recipient guard, BEFORE the
        # identity rescue: a dup-capped keyword incumbent then satisfies the rescue's
        # quality-failed precondition (gary P2's beneficial composition).
        ExtractionEngine._flag_cross_field_duplication(results)
        # c2 — TAUGHT-FIELD OWNERSHIP GUARD (2026-07-11): cap a plain-keyword read of a NON-identity
        # field the user AUTHORITATIVELY taught here but that couldn't be located on this page (a
        # generic caption stand-in). Beside the recipient guard, BEFORE identity rescue + the boost.
        self._flag_taught_field_ownership(
            results, field_defs, supplier_name, anchors, hints, document_slug, _caption_vocab)
        # PREFIX-OUTLIER GUARD (2026-07-12): a shape-valid single-glyph misread of a ref field's
        # dominant code prefix (DN->IN) evades every format gate + auto-files at 95%+ on import; flag
        # it (cap 69 + note) so it can't silently file + poison learning. Flag-only, before the boost.
        self._flag_prefix_outlier(results, field_defs, supplier_name, document_slug)
        # ── Identity rescue (slice 1; Oracle-signed 2026-07-10) ── AFTER the guard
        # (it overwrites the guard's note with its own provenance note when the
        # corroboration holds; no corroboration => the guard's behaviour survives
        # byte-identical) and BEFORE the boost/needs_review for the same reasons.
        self._rescue_identity_from_scope(results, field_defs, supplier_name,
                                         document_slug, hints)

        # ── LEARNED-AGREEMENT CONFIDENCE BOOST ────────────────────────────────
        # A value that is CONSISTENT with a well-supported learned format for its scope is
        # more trustworthy the more it has been confirmed — so let per-field confidence GROW
        # with the field's history (calibration, not inflation): a supplier confirmed hundreds
        # of times shouldn't keep reading 93%. Gated tight: the field must have a value, NO
        # validation_note (it passed Stage 4/4.5 clean), and a learned format entry (>=3 distinct
        # confirmed values). The bonus scales with the confirmed-history `support` and is CAPPED
        # AT 98 so a boost ALONE never reaches the auto-file threshold (100) — auto-file stays a
        # deliberate, separately-gated decision. Runs before overall_confidence so the doc
        # average lifts too. Best-effort: never breaks extraction.
        try:
            _boost_lookup = self._make_format_lookup(supplier_name, document_slug)
            for _k, _d in results.items():
                if _k.startswith('_') or not isinstance(_d, dict):
                    continue
                if not _d.get('value') or _d.get('validation_note'):
                    continue
                _fe = _boost_lookup(_k)
                if not _fe:
                    continue
                _sup = _fe.get('support') or 0
                if _sup < 3:
                    continue
                _cur = _d.get('confidence') or 0
                if _cur >= 98:
                    continue
                _b = 5 if _sup >= 20 else 4 if _sup >= 5 else 2
                _d['confidence'] = min(98, _cur + _b)
        except Exception:
            pass

        # ── Metadata ──────────────────────────────────────────────────────────
        overall_conf  = validator.overall_confidence(results, field_defs)
        # Document-level format-consistency weighting: penalise the document when
        # any field failed its expected format, and reward it when several well-
        # supported fields all match. "Supported" = fields with a learned format
        # for this supplier/type (the same index Stage 4.5 checks against), so a
        # clean-but-unverified or sparse document is never over-rewarded. Only the
        # displayed document score moves — per-field notes and needs_review are
        # untouched.
        supported_keys = set()
        if self.format_class_index and supplier_name and document_slug:
            sl = supplier_name.lower().strip()
            dl = document_slug.lower().strip()
            supported_keys = {k for (s, d, k) in self.format_class_index if s == sl and d == dl}
        fc_delta = validator.format_consistency_delta(results, field_defs, supported_keys)
        if fc_delta:
            overall_conf = max(0, min(100, overall_conf + fc_delta))
            self.log(f"  Format consistency: document confidence {'+' if fc_delta > 0 else ''}{fc_delta}")
        # Stage 4.5 confidence caps (≤45) will always trigger needs_review via
        # the per-field threshold check.  The OR guard covers the edge case
        # where a flagged field is not listed in field_defs.
        review_needed = validator.needs_review(results, field_defs) or format_anomaly_flagged

        results["_supplier_name"]        = supplier_name
        results["_document_type"]        = document_type
        results["_document_slug"]        = document_slug
        results["_overall_confidence"]   = overall_conf
        results["_needs_review"]         = review_needed
        results["_mode_used"]            = self.mode
        results["_template_id"]          = matched_tmpl.get("id") if matched_tmpl else None
        # The matched template carries the document type its layout was confirmed
        # under — the only signal that assigns CUSTOM doc types (which have no
        # document_type_keywords to keyword-detect). process_docs.py prefers it.
        results["_document_type_slug"]   = matched_tmpl.get("document_type_slug") if matched_tmpl else None
        results["_logo_phash"]           = logo_phash
        results["_logo_detail_hash"]     = logo_detail_hash
        results["_keyword_fingerprint"]  = kw_fingerprint
        # Text-led SUPPLIER identity verdict — computed when EITHER the shadow measurement OR the
        # active conflict flag is live (both default off → byte-identical: verdict never computed).
        _identity_acted = False
        if identity_shadow or self._identity_conflict:
            _idv = self._compute_identity_verdict(ocr_text, logos, hints, anchors, supplier_name)
            if identity_shadow:
                results["_identity_shadow"] = _idv          # measurement path — records only
            if self._identity_conflict and _idv and _idv.get("conflict"):
                # VARIANT ADOPTION first (2026-07-10 night): when the resolved supplier is a
                # clipped fragment of the letterhead canonical AND the supplier field itself
                # carries the fragment, adopt the canonical (capped + noted + review) — see
                # _adopt_identity_variant. Every other conflict stays FLAG-ONLY below: never
                # override the value, fill an empty one, or flag on abstain/agree.
                results["_needs_review"] = True
                _identity_acted = True
                if not ExtractionEngine._adopt_identity_variant(results, _idv):
                    for _idk in ("supplier_name", "customer_name"):
                        _f = results.get(_idk)
                        if isinstance(_f, dict) and _f.get("value"):
                            _f["validation_note"] = (
                                f"Letterhead may read “{_idv.get('text_led')}” — "
                                f"detected “{_idv.get('resolved')}”. Please confirm the issuer.")
                            _f["confidence"] = min(int(_f.get("confidence") or 100), 70)
                            break
        # BRANDING-CONFLICT cross-check (Oracle 2026-07-12) — the dependency-free backstop for the
        # logo-collision wrong-supplier class, and the ONLY identity text-check live in packaged
        # builds (identity_fusion above needs rapidfuzz, unbundled → a no-op there). Runs on the
        # RESOLVED filing identity regardless of IDENTITY_FUSION_AVAILABLE. Skipped when the
        # identity-conflict block already flagged/adopted (its _adopt_identity_variant may have
        # changed results['supplier_name'] while the local supplier_name var is stale → false-flag).
        if not _identity_acted:
            self._flag_branding_conflict(results, supplier_name, templates, ocr_text)

        # ── SPARSE-GUARD SUGGESTION CONSUMPTION (LOGO_DETAIL_MISS_SUGGEST; Oracle C1 PLACEMENT
        # IS LOAD-BEARING, 2026-07-23) ── The coarse-miss detail pick stashed at the pre-stage is
        # judged HERE — after _flag_branding_conflict, after the Stage-2.5a hint scan and
        # _adopt_identity_variant (the last supplier_name WRITERS), and before the _logo_abstained
        # consumer below (so the fill arm's text-gate abstain rides its existing value-less-row +
        # "Use '<name>'" affordance). The Oracle traced BOTH failure modes of the earlier
        # (:re-resolve) placement: a fill there made the supplier non-empty and SKIPPED the
        # un-noted Stage-2.5a resolution (re-creating the 268→131 collapse for that subset), and a
        # disagree note there was DESTROYED when 2.5a replaced the field dict — and that note is
        # the ONLY auto-file block on a text-typed field. Do not move this earlier.
        # The disagree copy deliberately does NOT match the renderer's isBrandingFlag regex
        # (/page branding reads|confirm the correct company/i) — the row HAS a value, so a bare
        # note without the Use-button is the intended shape (pinned).
        _sug = results.pop("_logo_detail_suggest", None)
        if isinstance(_sug, dict) and str(_sug.get("supplier_name") or "").strip():
            _sname = str(_sug["supplier_name"]).strip()
            _out = _resolve_detail_suggestion(results.get("supplier_name"), _sname, self._accept_norm)
            if _out == "note":
                _fld = results["supplier_name"]
                _fld["validation_note"] = (
                    f"The letterhead mark matches '{_sname}' — please confirm the company.")
                results["_needs_review"] = True
                self.log(f"  Logo detail mark DISAGREES with resolved supplier — noted for review ('{_sname}')")
            elif _out == "fill":
                _tg = decide_logo_text_gate(_sname, _branding_banks(templates, self._accept_norm),
                                            ocr_text, self._accept_norm, self.accepted_issuers)
                if _tg == 'abstain':
                    # Text positively contradicts — assert nothing; the ABSTAIN-MUST-SPEAK consumer
                    # just below emits the value-less row + affordance.
                    results.setdefault("_logo_abstained", {"suppressed": _sname})
                    self.log(f"  Logo detail suggestion '{_sname}' dropped — page branding contradicts it")
                else:
                    results["supplier_name"] = {
                        "value":           _sname,
                        "confidence":      69,   # < 70 review threshold; the note is the auto-file block
                        "method":          "logo",
                        "validation_note": "Company identified from the letterhead logo mark; "
                                           "please confirm it's correct.",
                    }
                    results["_supplier_name"] = _sname   # scope mirror — _supplier_name was baked above
                    results["_needs_review"] = True      # review_needed was computed above — mirror it
                    self.log(f"  Logo detail mark FILLED the empty supplier: '{_sname}' (review-bound)")
            # 'clean' → nothing: downstream resolved the same name un-noted (the measured 137-doc
            # arm) or the field is pinned/already-noted — byte-identical to the starved baseline.

        # ── ABSTAIN MUST STILL SPEAK (identity text-first, Oracle C1) ───────────────────────
        # The text-agreement gate dropped a contradicted logo identity. If NOTHING else resolved
        # the issuer, the doc would otherwise reach Review mute — no name, no explanation, and no
        # "Use '<name>'" button, which is ALSO the only trigger for the correction-ripple slice.
        # So emit a VALUE-LESS supplier_name row carrying the branding-detected alternative (same
        # alt-scan rule as the flag above: issuer-band, fuzzy, decisively-present only) plus a
        # plain-English note. Value stays None on purpose — the logo was contradicted, so the app
        # asserts nothing; the human clicks to accept, exactly as in the branding-conflict flow.
        _abst = results.get("_logo_abstained")
        if _abst and not (isinstance(results.get("supplier_name"), dict)
                          and results["supplier_name"].get("value")):
            _alt, _alt_fuzzy = _branding_alt_name(
                _branding_banks(templates, self._accept_norm), ocr_text,
                self._accept_norm(_abst.get("suppressed") or ""))
            _fld = results.get("supplier_name")
            if not isinstance(_fld, dict):
                _fld = {"value": None, "confidence": 0, "method": "logo_abstained"}
                results["supplier_name"] = _fld
            if _alt:
                _fld["validation_note"] = (
                    f"The page branding reads '{_alt}'. The logo looked like a different company, "
                    "so nothing was assumed — please confirm the correct company.")
                if _alt_fuzzy:                      # actionable button only on the safe issuer-band path
                    _fld["suggested_supplier"] = _alt
            else:
                _fld["validation_note"] = (
                    "Couldn't confirm which company sent this — the logo matched another company "
                    "but the page text doesn't agree. Please set the correct company.")
            results["_needs_review"] = True

        # ── LETTERHEAD ISSUER SUGGESTION (2026-07-20, DEFAULT OFF: LETTERHEAD_ISSUER=1 to arm) ───
        # THE COLD-START HOLE. field_patterns.supplier_name finds the issuer only by a CAPTION
        # ("Bill From"/"Supplier"/"Vendor"/…), and real letterheads carry none — the company name
        # just sits at the top. Every other issuer path (template/logo/hint-scan/branding) needs a
        # prior confirm. So on FIRST CONTACT the issuer is unreadable: measured 0 of 270 documents
        # identified cold, including one whose OCR line 1 is literally its own company name.
        #
        # SUGGESTS, NEVER ASSERTS, and the reason is not timidity: this reader only has to carry
        # DOCUMENT #1. After one confirm the supplier has a hint, a logo and a template and every
        # later document resolves at full confidence — so it never needs authority to assert, while
        # a wrong assert would plant a poisoned learning SCOPE that then attracts future documents.
        # It therefore rides the SAME value-less-row + "Use '<name>'" affordance the branding
        # abstain above already uses — which the renderer arms by MATCHING THE NOTE TEXT, so the
        # wording below is part of the contract, not decoration (see the note comment).
        #
        # FILL-EMPTY-ONLY and placed LAST, deliberately: several upstream guards are written
        # `if not supplier_name`, so producing a value earlier would SKIP the logo match and the
        # Stage-2.5a hint scan. A fresh geometric guess must never outrank a learned identity.
        if (os.environ.get("LETTERHEAD_ISSUER", "0") == "1"
                and not (isinstance(results.get("supplier_name"), dict)
                         and results["supplier_name"].get("value"))):
            try:
                from extraction import letterhead
                _lh = letterhead.pick_issuer(
                    ocr_text,
                    # Exclude the document's OWN detected type name and the shipped type
                    # vocabulary, so a printed type heading can never be read as a company.
                    # BOTH the bucket KEYS and the PHRASES inside them: keys alone left
                    # "TAX INVOICE" / "VAT INVOICE" / "ORDER CONFIRMATION" eligible, and those
                    # sail past GENERIC_SINGLES (multi-word) and past the chrome-fragment guard
                    # (which only judges 2-5 char cores) — a logo-only letterhead would then have
                    # suggested "TAX INVOICE" as the company name.
                    detected_title=results.get("_document_type"),
                    type_phrases=_letterhead_type_phrases(self.patterns),
                    # PAGE-0 GEOMETRY (the geometry slice, 2026-07-20): word boxes + med_h from the
                    # fresh page-0 OCR read. None on a cached reprocess / born-digital page 0 —
                    # pick_issuer falls back to its text-only path. Height RANKS, text filters GATE.
                    geometry=page0_geometry,
                )
            except Exception as _e:                  # a suggestion must never break an extraction
                _lh = None
                self.log(f"  Letterhead issuer scan skipped: {_e}")
            if _lh:
                _lfld = results.get("supplier_name")
                if not isinstance(_lfld, dict):
                    _lfld = {"value": None, "confidence": 0, "method": "letterhead_suggest"}
                    results["supplier_name"] = _lfld
                if not _lfld.get("suggested_supplier"):     # never displace a stronger suggestion
                    _lfld["suggested_supplier"] = _lh
                    # ⚠ THE WORDING IS LOAD-BEARING, not cosmetic. The Review renderer decides
                    # whether to draw the "Use '<name>'" button by REGEX-MATCHING this note
                    # (renderer.js isBrandingFlag: /page branding reads|confirm the correct
                    # company/i). An earlier draft ended "…confirm the company", which does not
                    # match — the suggestion was computed, stored, passed to the renderer and
                    # silently dropped, leaving the operator prose and an empty box. Two languages
                    # coupled by a sentence: test_letterhead_note_contract.js pins BOTH sides, so a
                    # copy edit here trips red instead of quietly removing the only affordance.
                    #
                    # The copy also has a job: this fires on FIRST CONTACT, where the corroboration
                    # gate cannot protect anything (the name was read verbatim out of the page, so
                    # "is it corroborated by the page text" is true by construction). The operator's
                    # reading of this sentence is the whole remaining safety budget, so it names the
                    # one mistake only a human can catch here: sender versus customer.
                    _lfld.setdefault(
                        "validation_note",
                        f"Never seen this sender before. The top of the page reads '{_lh}' — "
                        "please confirm the correct company (check it's the sender, not the customer).")
                    results["_needs_review"] = True
                    self.log(f"  Letterhead issuer SUGGESTED: '{_lh}' (not assigned)")

        # TYPE-AMBIGUITY guard (Fix A, Oracle 2026-07-13) — the fail-toward-review backstop for the
        # same-letterhead type-flip: a supplier issuing several doc types on ONE logo lets a skew-
        # garbled title (title_trusted lost) resolve the type by a POPULARITY coin-flip (identical
        # sibling fingerprints), auto-filing the WRONG type silently — every field VALUE is correct, only
        # the type/ref-key is wrong, and trust.js has no type-correctness check. identify_template flags
        # the ambiguous pick (`ambiguous_type`, computed over a jitter-immune wider band); here we HOLD
        # the doc for review. Independent statement (not nested under _identity_acted — Oracle C2), and
        # after the branding block so their notes compose rather than clobber. HOLD-ONLY: never changes a
        # value -> per-field accuracy byte-identical. Kill switch TYPE_AMBIGUITY_GUARD.
        if getattr(self, '_type_ambiguous', False) and os.environ.get('TYPE_AMBIGUITY_GUARD', '1') != '0':
            self._flag_type_ambiguity(results, ref_field_key)
        # C1 (TYPE-heading authority): a trusted-title REFUSE (identify_template discarded the matched
        # template because the trusted heading names a DIFFERENT type) leaves the doc with NO template
        # — it must not silently auto-file a detection-only type at overall==100. HOLD it for review.
        # Fires whenever the refuse ran; its kill switch (TYPE_REFUSE_HOLD) gates the sentinel upstream
        # so _type_refused is already False when disabled → byte-identical. `elif`: a refuse yields
        # match=None so _type_ambiguous is normally False, but a ref-prefix PIN can re-populate the
        # match and set _type_ambiguous — either way the doc is HELD, so the ambiguity note winning
        # the tie is fine (both compose after the branding/prefix notes applied above).
        elif getattr(self, '_type_refused', False):
            self._flag_type_ambiguity(
                results, ref_field_key,
                note=("The heading on this page names a document type that doesn't match this "
                      "supplier's saved layout — please check the document type is correct before filing."))

        # Final resolved value per field — the inspector marks any earlier
        # candidate whose value differs from this as a superseded intermediate.
        if self._trace:
            for key, data in results.items():
                if key.startswith("_") or not isinstance(data, dict):
                    continue
                self._t("final", field=key, value=data.get("value"),
                        method=data.get("method"), confidence=data.get("confidence"),
                        note=data.get("validation_note"))

        # ── Disambiguation picker: candidate map for flagged name fields ──────
        # Built LAST, after every flag guard, so a note applied late (identity /
        # caption-demotion) still arms the picker. Additive `_` metadata (popped +
        # woven into the per-field emit by process_docs); commits no value.
        results["_field_candidate_emit"] = self._build_candidate_emit(results, ocr_text)

        return results

    def _flag_type_ambiguity(self, results, ref_field_key, note=None):
        """Fix A: HOLD an ambiguous same-letterhead TYPE resolution for review. Lands a persisted
        validation_note on a GUARANTEED-PRESENT field so trust.isAutoFileEligible's `flagged` check
        blocks the auto-file (Oracle/gary's load-bearing catch: the DB-side gate honours a persisted
        note, NOT a bare _needs_review). Carrier priority: supplier_name (the identity field, always
        extracted) -> the ref-role field -> any valued field -> a synthetic supplier_name row (so the
        note persists even for a worksheet whose ref_field_key is null — Oracle C3). APPENDS to any
        existing note (composes with _flag_prefix_outlier / branding — Oracle C2). HOLD-ONLY: never
        changes a value. `note` overrides the default message (C1 passes a trusted-title-refuse note).
        Guarded by tests/test_type_ambiguity_flag.py."""
        if note is None:
            note = ("This letterhead is used for several document types and the type could not be confirmed "
                    "on this scan — please check the document type is correct before filing.")
        carrier = None
        for k in ('supplier_name', ref_field_key):
            if k and isinstance(results.get(k), dict):
                carrier = k
                break
        if carrier is None:                                   # no identity/ref field — take any valued field
            for k, v in results.items():
                if not str(k).startswith('_') and isinstance(v, dict):
                    carrier = k
                    break
        if carrier is None:                                   # nothing at all — synthesise a persisted carrier
            results['supplier_name'] = {'value': results.get('_supplier_name') or '', 'confidence': 69,
                                        'method': 'type_ambiguity', 'validation_note': note}
        else:
            fld = results[carrier]
            existing = str(fld.get('validation_note') or '').strip()
            fld['validation_note'] = (existing + ' ' + note).strip() if existing else note
        results["_needs_review"] = True

    def _apply_hints(self, hints: list, supplier_name: str,
                     document_slug: str | None, field_defs: list[dict]) -> dict:
        """
        Apply learned supplier hints as direct field values — but only for
        fields whose value is constant for a given supplier (company name,
        address, terms). A field the document type's own schema marks as
        "variable" (it's the designated reference/date field, or typed as a
        date) differs on every document; replaying a remembered value for
        it is exactly how one document's reference number ends up stamped
        onto another's (see field_defs[*]["is_variable"], derived in
        document_types.js from ref_field_key/date_field_key/type — NOT a
        per-field-key guess here, so custom types/fields are covered too).

        Only applies hints with usage_count >= 2 that match this supplier
        (exactly — see note below) and optionally doc type. Confidence
        scales with usage_count (caps at 90).
        """
        results    = {}
        s_lower    = supplier_name.lower().strip()
        field_meta = {f["key"]: f for f in field_defs}

        # Oracle C3 (Generic Document design): a title is PER-DOCUMENT by nature — never
        # hint-filled. The evidence-based variability guard below needs >=2 DISTINCT
        # confirmed values to disarm, so the FIRST stale title would otherwise fill an
        # empty title on a same-supplier reprocess (a wrong value wearing 60-90 conf).
        hints = [h for h in hints if str((h or {}).get("field_key") or "").lower() != "title"]

        # Evidence-based variability: a field with >=2 DISTINCT confirmed values for
        # this supplier+type is variable IN FACT (e.g. a per-document customer name),
        # even when the schema doesn't flag it is_variable (free-text fields never are).
        # Replaying the most-frequent value onto a new document is exactly how one doc's
        # customer gets stamped onto another's. Count distinct values within the SAME
        # scope a hint would apply in, and skip those fields — the field falls to review
        # (empty) instead of being guessed. Mirrors the evidence-based freeze guard in
        # review/handler.js _buildTemplateFields.
        distinct_vals: dict[str, set] = {}
        for h in hints:
            hk = h.get("field_key")
            hv = (h.get("hint_value") or "").strip().lower()
            if not hk or not hv:
                continue
            hs = (h.get("supplier_name") or "").lower().strip()
            ht = h.get("document_type") or ""
            if hs == s_lower and ((not ht) or ht == (document_slug or "")):
                distinct_vals.setdefault(hk, set()).add(hv)

        for hint in hints:
            h_sup   = (hint.get("supplier_name") or "").lower().strip()
            h_type  = hint.get("document_type") or ""
            h_key   = hint.get("field_key")
            h_value = hint.get("hint_value")
            usage   = int(hint.get("usage_count") or 0)

            if not h_key or not h_value or h_key not in field_meta:
                continue
            if usage < 2:
                continue
            if field_meta[h_key].get("is_variable"):
                continue
            if len(distinct_vals.get(h_key, ())) >= 2:
                continue   # variable BY EVIDENCE — multiple confirmed values; never replay one

            # Exact (normalised) supplier match. Substring matching here
            # would let one supplier's hints bleed into another's whenever
            # one name contains the other — the same collision class that
            # made 'PO' match inside "Polychemtex Inc." for template anchors.
            sup_match  = h_sup and h_sup == s_lower
            type_match = (not h_type) or (h_type == (document_slug or ""))

            if sup_match and type_match:
                conf = min(90, 60 + usage * 5)
                # Only update if this hint gives higher confidence than existing
                existing_conf = results.get(h_key, {}).get("confidence", 0)
                if conf > existing_conf:
                    results[h_key] = {
                        "value":      h_value,
                        "confidence": conf,
                        "method":     "hint",
                    }

        return results
