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

import math
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction import keyword, anchor, validator, ocr_corrector, template_matcher, template_mapper, format_anomaly_checker, value_quality, wordness, registration

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

# ── TEMPLATE_FIXED SEED vs a MISREAD MAPPING (2026-08-06; gary -> Oracle SIGN-OFF-W/COND C1..C7) ──
# Stage 0 seeds a template's curated `fixed_value` for supplier_name at conf 95, method
# `template_fixed` (template_matcher.py:819-824). The Stage-0.5 merge below then lets a mapping READ
# displace that seed on AUTHORITY (`is_curated_refinement`), guarded only by `_ft_mapping_weak`
# (free-text reads under conf 75). Edge-glyph misreads of the letterhead arrive ABOVE 75 and win, so
# a wrong supplier is committed — a wrong OUTPUT FOLDER and a wrong LEARNING SCOPE (anchors/hints/
# logos/template identity all key off supplier_name). Measured on the Castellan credit notes:
#   'Castellan Security System:' @78 · 'Cas tellan Security System:' @78 · 'tastellan Security
#   Systems' @95 (SILENT) · 'ba)' @78.
# WHY THE WORST ONE WAS SILENT (the Oracle's seam): the more corrupted the string, the more
# completely it EVADES the branding cross-check — `_branding_own_ratio` finds no bank for
# 'tastellan Security Systems', returns None = "unjudgeable", and `_flag_branding_conflict`
# fail-safes without flagging. So corruption buys immunity from the one guard meant to catch it.
# THE FIX IS TO KEEP THE SEED, NOT TO SNAP THE READ. Both yield the same string, but keeping the
# seed leaves `method == 'template_fixed'`, which is what BRANDING_NAMED_BLANK (:2983) and
# TEMPLATE_FIXED_NAME_PRESENCE_VETO (:3018) key on EXACTLY, and puts the value back inside the
# branding guard's jurisdiction. Snapping would mint a veto-exempt `template_mapping+snapped`.
# SCOPED TO supplier_name ONLY — deliberately NOT _IDENTITY_FIELD_KEYS: `customer_name` is
# legitimately VARIABLE per document (post-mig-44 COMPANY_KEYS is supplier_name only), so a
# fixed-value near-match must never govern it.
# Both default OFF; OFF is byte-identical. Pins: tests/test_template_fixed_near_match.py.
_FIXED_SEED_KEYS = frozenset({"supplier_name"})
_FIXED_SEED_METHODS = ("template_fixed", "template_fixed_locked")
_FIXED_NEAR_MATCH_ON = os.environ.get('TEMPLATE_FIXED_NEAR_MATCH_RECONCILE', '0') != '0'
_FIXED_FRAGMENT_DECLINE_ON = os.environ.get('TEMPLATE_FIXED_FRAGMENT_DECLINE', '0') != '0'
# ISSUER REPAIR (2026-08-09, owner-reported and measured). The two guards above are calibrated for a
# gentler failure than reality produces: near-match tolerates ONE edit, the fragment rule only debris
# under 3 characters. Measured on 135 template-matched documents, 42 read something other than the
# curated name — 15 an OCR garble of it (2-5 edits), 27 not a company name at all (a date line, a
# registration code, a page heading). The app already knows: it prints "Letterhead may read
# 'Castellan Security Systems' — detected 'DATE 14-03-2026 Job Ref JB-8887'" and then asks the
# operator to confirm what it has itself worked out. This lets it act on that.
# STILL NOT AN AUTHORITY FLIP: both new branches only DECLINE a read, keeping the curated seed and
# its `template_fixed` method (which is what the branding and presence vetoes key on). A genuinely
# different company is neither similar enough nor metadata-shaped, so it still displaces the seed
# and a stale fixed_value can always be corrected by re-teaching — the invariant this must not break.
# Default OFF; OFF is byte-identical. Pins: tests/test_issuer_repair.py.
_FIXED_ISSUER_REPAIR_ON = os.environ.get('TEMPLATE_FIXED_ISSUER_REPAIR', '0') != '0'
# REGION-SCOPED PRESENCE CONFIRM (2026-08-09 NIGHT; the owner's design, Oracle's Fix 2 — the
# STANDING GUARD that sits behind the arbiter cure, TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE).
# NOT redundant with the arbiter fix, and the distinction is the whole point: with the arbiter
# silenced, an ANCHOR-LESS letterhead box on a genuinely drifted page has NO drift compensation
# left at all, and whatever garble it reads still displaces the curated seed here via
# `is_curated_refinement`. This fills that hole from the opposite direction — it asks a question
# about THIS DOCUMENT ("is the curated name actually printed where the operator taught it?")
# instead of about the layout.
# THE ASYMMETRY IS DELIBERATE. It can only ever KEEP the seed, and only on POSITIVE evidence:
#   * name found in the padded taught region -> keep the seed (its value, its 95, its
#     `template_fixed` method — which is what BRANDING_NAMED_BLANK and
#     TEMPLATE_FIXED_NAME_PRESENCE_VETO key on, so keeping it RE-ARMS those guards rather than
#     disarming them; today, with a mapping/registration read winning, all of them are inert);
#   * name NOT found -> fall through, today's behaviour verbatim;
#   * region unreadable or empty -> ALSO fall through (Oracle C2': *not found* and *could not
#     read* are different facts and neither is confirmation — fail-closed on the CONFIRM
#     direction only).
# SHARES THE PRIMITIVE WITH TEMPLATE_FIXED_NAME_PRESENCE_VETO, NEVER ITS DECISION: the fuzzy
# distinctive-token test `_template_identity_corroborated` is reused, but NOT that veto's
# >=3-sample/>=0.80 `supplier_prints_name` gate. That gate exists to protect a DESTRUCTIVE action
# (blanking a stamped supplier) and would silently disarm a CONFIRMING one for exactly the new
# suppliers this helps.
# CONFIRMATION GRANTS NO NEW AUTHORITY: this branch never raises a confidence and never mints a
# method. It licenses keeping what Stage 0 already seeded, nothing more.
# NAMED FALSE POSITIVE (pinned, not hand-waved): a 150% pad can reach the recipient block on a
# compact layout. Harmless when testing one known string — UNLESS the template was mis-taught and
# its `fixed_value` IS the recipient, in which case this confirms the mis-teach. Re-teaching
# remains the cure, exactly as for the other seed branches.
# Default OFF; OFF is byte-identical. Pins: tests/test_issuer_region_presence.py.
_ISSUER_REGION_PRESENCE_ON = os.environ.get('TEMPLATE_ISSUER_REGION_PRESENCE', '0') != '0'
# AGREEMENT KEEPS THE SEED (2026-08-09 NIGHT, the first residual the issuer gate surfaced).
# When the Stage-0.5 mapping read is EXACTLY the curated `fixed_value`, today's merge still lets the
# read displace the seed — same string, lower confidence, different method. Measured on the issuer
# arm: four documents keep a CORRECT company name but move `template_fixed`@95 ->
# `template_mapping`@78, and all four fall out of the >=88 band as a result. Reading the same name a
# second time is CORROBORATION; treating it as a refinement is what costs the confidence.
# Oracle's rule for the region-presence guard says the same thing from the other side —
# *confirmation grants no new authority* — so agreement should license KEEPING what is already
# there, never demoting it.
# NAME THE SEAM — this is the whole risk, and it is why this is its own switch rather than part of
# either issuer fix. Keeping the seed keeps `method == 'template_fixed'`, and three guards key on
# that string EXACTLY: TEMPLATE_FIXED_NAME_PRESENCE_VETO (which can BLANK the supplier),
# BRANDING_NAMED_BLANK, and the branding note/cap. So this ARMS a destructive guard on every taught
# document whose issuer reads correctly — the exact blast radius the raw-equality short-circuit was
# written to avoid. The argument that it is safe: agreement means the name was READ off this page,
# so the veto's absence test should pass by construction. That argument is not proof (a crop read
# and the full-page PSM-3 text can disagree), which is why the gate below counts BLANKED suppliers
# explicitly rather than only scoring the lane.
# Default OFF; OFF is byte-identical (the agreement branch returns None and the read is applied
# exactly as today). Pins: tests/test_fixed_seed_agreement.py.
_FIXED_SEED_AGREEMENT_KEEP_ON = os.environ.get('TEMPLATE_FIXED_SEED_AGREEMENT_KEEP', '0') != '0'
try:
    _ISSUER_REGION_PAD = float(os.environ.get('TEMPLATE_ISSUER_REGION_PAD', '1.5'))
except ValueError:
    _ISSUER_REGION_PAD = 1.5


def _region_confirms_curated_seed(key, existing, data, tmpl_mappings, page_images):
    """Is the curated `fixed_value` PRINTED in the taught issuer region on THIS page?

    Returns True (confirmed — keep the seed), False (read the region, the name is not there) or
    None (UNJUDGEABLE: not our field, nothing to compare, no taught box, no page, or the region
    could not be read). Only True is actionable; the caller treats False and None identically
    today, and they are kept distinct so a census can tell "absent" from "unreadable".

    Preconditions mirror `_fixed_seed_declines_mapping` exactly — same key set, same seed methods,
    same raw-equality short-circuit — so the two can never disagree about WHEN a curated seed is
    under threat, only about WHY it should be kept."""
    if key not in _FIXED_SEED_KEYS or not isinstance(existing, dict):
        return None
    if (existing.get("method") or "") not in _FIXED_SEED_METHODS:
        return None
    read_val = str((data or {}).get("value") or "")
    fixed_val = str(existing.get("value") or "")
    if not read_val or not fixed_val or read_val == fixed_val:
        return None                       # agreement (or nothing to compare) -> inert
    box = None
    page_idx = 0
    for m in (tmpl_mappings or []):
        if (m or {}).get("field_key") != key:
            continue
        box = template_mapper._norm_box(m, "target")
        try:
            page_idx = int(m.get("page_number") or 0)
        except (TypeError, ValueError):
            page_idx = 0
        break
    if not box or not page_images or not (0 <= page_idx < len(page_images)):
        return None                       # no taught geometry / no page -> unjudgeable
    page = page_images[page_idx]
    if page is None:
        return None
    text = template_mapper.region_text(page, box, _ISSUER_REGION_PAD)
    # C2': unread (None) or blank region is NOT absence. `.strip()` matters — a whitespace-only
    # read is truthy, and treating it as "the region says this name is not here" would turn a
    # failed crop into evidence.
    if not (text or '').strip():
        return None
    return bool(_template_identity_corroborated(fixed_val, text))


def _fixed_seed_declines_mapping(key, existing, data):
    """Should the Stage-0.5 mapping read be DECLINED in favour of the curated template_fixed seed?

    Returns 'near_match' | 'fragment' | 'garbled' | 'not_issuer' | 'agreement' | None. Pure — the
    caller does the logging and the `continue`.

    Every branch but 'agreement' fires on a genuine DISAGREEMENT with a curated seed. The
    raw-equality short-circuit was written as load-bearing for blast radius — on the common case
    (the mapping reads the name correctly) declining would flip method to `template_fixed`
    corpus-wide and arm the presence veto on thousands of documents. TEMPLATE_FIXED_SEED_AGREEMENT_KEEP
    (see its flag block) revisits exactly that trade, because "for zero benefit" turned out to be
    wrong: letting the agreeing read through costs the field 95 -> 78.

    NOT an authority flip: a genuinely DIFFERENT company (~20 edits — e.g. the recipient block
    'Bramblewood Joinery Ltd') still displaces the seed exactly as today. Making `fixed_value`
    authoritative would reinstate the frozen-stamp class TEMPLATE_FIXED_NAME_PRESENCE_VETO exists
    for, and that veto needs >=3 confirms, so it is inert for precisely the new suppliers this helps."""
    if key not in _FIXED_SEED_KEYS or not isinstance(existing, dict):
        return None
    if (existing.get("method") or "") not in _FIXED_SEED_METHODS:
        return None
    read_val = str((data or {}).get("value") or "")
    fixed_val = str(existing.get("value") or "")
    if not read_val or not fixed_val:
        return None                       # nothing to compare -> byte-identical
    if read_val == fixed_val:
        # AGREEMENT. The taught box read the SAME string the operator confirmed. Armed, the seed is
        # kept (95, `template_fixed`); unarmed, the read is let through exactly as before and the
        # field lands at the mapping tier's confidence instead. EXACT equality only — a near-match
        # belongs to the branches below, which exist precisely to judge inexact agreement.
        return 'agreement' if _FIXED_SEED_AGREEMENT_KEEP_ON else None
    # Per-FUNCTION import, matching this module's existing name_match usage (:1535/:1577/:1737).
    # A module-level import here would be the odd one out; a bare module reference would be a
    # call-time NameError that no module-load smoke can catch (the 2026-08-06 registration lesson).
    from extraction import name_match as _nm
    if _FIXED_NEAR_MATCH_ON and _nm.near_match_identity(read_val, fixed_val):
        return 'near_match'
    if _FIXED_FRAGMENT_DECLINE_ON and _nm.is_fragment_read(read_val, fixed_val):
        return 'fragment'
    if _FIXED_ISSUER_REPAIR_ON:
        # Same name, misread past the one-edit budget ('lronciad Tool Hire' -> 'Ironclad Tool Hire',
        # 0.88 similar). Bounded by a similarity floor, so it can narrow a garble back to the
        # curated literal but can never turn one company into another.
        if _nm.garbled_identity(read_val, fixed_val):
            return 'garbled'
        # Not a company name at all — a date line, a registration/account code. Mechanical and
        # lexicon-free: a company name carries no printed date and no 4+ digit run.
        if _nm.is_not_an_issuer_read(read_val, fixed_val):
            return 'not_issuer'
    return None

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
# LATE LOCATED CROP-CORROBORATION (2026-07-24, gary design + Oracle SIGN-OFF-WITH-CONDITIONS): the
# A-over-B follow-up named in the Stage-2.6 seam. When the supplier resolved LATE, the owned
# authoritative anchor never ran, so a keyword-filled critical ref/date is capped by the taught-
# ownership guard with no located corroboration — even when the value is correct and at the taught
# position. Stage 2.6b re-runs JUST those anchors and remembers a GENUINELY-LOCATED read (Oracle C1:
# {anchor_inline, anchor_crop_relocated} whitelist + located=True; C2: near-taught value-box
# proximity, fail-CLOSED; C3: date canonicalised to the committed DD-MM-YYYY) so the UNCHANGED
# _anchor_corroborates vouches -> the guard does not cap. CORROBORATE-ONLY (no results write).
# DEFAULT ON (Oracle SIGN-OFF-WITH-CONDITIONS; corpus silentAutoFile UNCHANGED at 9, M_type 1,
# lift 4 caps 6->2; #473 po_date 69+note -> 98 clean); kill LATE_RESCUE_LOCATED_CORROB=0 (byte-
# identical off). Guarded by test_late_located_corrob.py.
LATE_RESCUE_LOCATED_CORROB = os.environ.get('LATE_RESCUE_LOCATED_CORROB', '1') != '0'

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
# OWN-LABEL EXEMPTION (2026-07-24, reggie design + Oracle SIGN-OFF-WITH-CONDITIONS C1-C3): the
# ownership cap is ALSO declined when the keyword read matched a caption UNIQUE TO THIS FIELD that
# carries a field-identifying token ("Invoice No", "PO Date") — a precise labelled read, not a
# generic-caption stand-in. A SHARED caption ("Date", "Issue Date", "Order No", "PO Number", "Order
# Number" — carried by >=2 roles) or a purely-generic one ("#") stays HELD. keyword.
# label_is_own_discriminating is the sole new gate; every other read stays capped as now.
# Corpus (realdoc_regression, 449): +21 auto-files (311->332), M and M_type UNCHANGED (9/1), 45->6
# over-flags removed, 0 accuracy drift. DEFAULT ON (Oracle's call — the residuals were closed at the
# CONFIG layer per C2: "Printed On" removed from po_date labels, "Order Number" added to
# purchase_order_number so it is SHARED->held; do NOT add a role-token rule, it would break legit
# synonyms "Bill No"/"Order Ref" — pinned in test_taught_ownership_own_label.py). Kill: =0 (byte-
# identical off). C3 owner live-check outstanding: the Thornbury invoice files clean, no 69 cap.
TAUGHT_OWNERSHIP_OWN_LABEL = os.environ.get('TAUGHT_OWNERSHIP_OWN_LABEL', '1') != '0'
# TYPE-SCOPED OWN-LABEL EXEMPTION — B' (2026-07-26, gary design + Oracle SIGN-OFF-WITH-CONDITIONS).
# Extends the own-label exemption to a caption that is shared GLOBALLY but UNIQUE within the RESOLVED
# doc type ("Order Date" is on po_date AND sales_order.order_date, but only po_date exists on a
# purchase_order, so within that type it is discriminating). Fires ONLY on an AUTHORITATIVE type
# (self._type_authoritative — a trusted standalone heading named it, and Stage 0 did not flag the type
# ambiguous/refused): a type-scoped-unique label is not self-identifying, so the exemption leans on the
# type being right. ADDS exemptions only; OFF or non-authoritative => byte-identical (the existing global
# branch is untouched). DEFAULT ON (owner flip 2026-07-26 after ALL Oracle conditions passed): C1
# make-or-break live-fire on the 13 held Copperfield POs — every po_date lifted 69->98, note gone, VALUES
# UNCHANGED (method-only) · C2 realdoc OFF-vs-ON — the WHOLE diff is one line (ownership caps 13->5); the
# would-auto-file set (396), M (2, #183/#583), M_type (0) and accuracy are byte-identical, so the enumerated
# auto-file delta is EMPTY (Oracle C2's real gate — M is invariant by construction here and proves nothing) ·
# C3 crash-safe (title_trusted-only; the un-wired type_confirmed dropped) · C4 pins (incl. B2 non-authoritative
# HOLD + B6 wrong-type residual). Kill: =0 (byte-identical off).
TAUGHT_OWNERSHIP_TYPE_SCOPED_LABEL = os.environ.get('TAUGHT_OWNERSHIP_TYPE_SCOPED_LABEL', '1') != '0'
# INLINE-HARVEST ABSENCE HOLD — Fix A for #183 (gary design + Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-26).
# A CRITICAL ref/date committed by the Stage-2 word-geometry inline harvest (method 'anchor_inline') that
# NO independent source corroborates — no different-method-family rail agrees AND its alnum core is absent
# from the full-page ocr_text — is a value assembled from scattered word boxes that appears NOWHERE on the
# page (#183: harvested 'PO-20008' while the page prints 'PO-60906'; skew broke Tesseract row-grouping so
# ocr_text never carried the true line, and the conformance boost rode the synthesis to a silent auto-file
# @98). HOLD it (validation_note -> trust.js flagged gate). The general-doc sibling of the G1 veto-
# fallthrough guard, which fires ONLY on identity-veto fall-through docs (#183 resolves its supplier
# normally so G1 never runs on it). Note-only: no value/method/confidence change -> per-field accuracy
# byte-identical. Keyed on the CORROBORATION invariant, NOT a rigid-crop-rejection signal (Oracle C2 — a
# rejection is unobservable in production: on_reject is trace-only, and the _xsup_absolute_ok skip + the
# supersede-not-reject path both yield anchor_inline with no rejection; a crop-box requirement would also
# EXEMPT the label-less positional-anchor synthesis hole). DEFAULT ON (owner flip 2026-07-26 after the
# Oracle conditions passed): realdoc A/B OFF-vs-ON — silentAutoFile 2->1 (#183 'PO-20008' flips SILENT->
# flagged; #583 the date-M UNCHANGED, Oracle C4 — it's page-present, a different class), M_type 0, per-field
# accuracy BYTE-IDENTICAL (note-only), no doc newly enabled to file. would-auto-file 396->391: 5 held = #183
# (the silent-wrong win) + 4 correct-per-GT reads on the same degraded-scan family (181/185/189 Larkspur,
# 471 Thornbury) — the honest fail-toward-review cost, 0.6%, since a correct and a wrong page-absent inline
# synthesis are indistinguishable at runtime.
# FLIPPED BACK DARK 2026-07-26 (owner live-test): on a SYSTEMATICALLY-skewed supplier (Northgate Textiles)
# the false-positive rate is far worse than the corpus 0.6% — the whole PO batch over-flags a CORRECT,
# VISIBLE ref (e.g. 'PO-60892', printed "Order No. PO-60892") because the skew keeps it out of the flat
# ocr_text while the rigid crop ALSO read it (rejected only on the caption prefix, so that agreement is
# invisible to the corroboration ledger). REFINE before any re-flip: let the rigid crop's OWN (even
# rejected) read corroborate the inline value — that keeps #183 held (its crop read GARBAGE, disagreed)
# while clearing the agree-case. Force on with =1. Kill/default: =0 (byte-identical off).
INLINE_HARVEST_ABSENCE_HOLD = os.environ.get('INLINE_HARVEST_ABSENCE_HOLD', '0') != '0'

# Crosscheck-outlier reconcile (Slice-1 — gary design + Oracle SIGN-OFF-W/COND 2026-08-03). anchor.py's
# authoritative-crop cross-check flips a crop-vs-fullpage DISAGREEMENT to a FRESH full-page locate-OCR
# ('anchor_crop_crosscheck', capped 70 + "please verify") which then wins Tier-A over the clean keyword/
# mapping incumbent. But that fresh locate can ITSELF garble a valid-shaped digit (doc-09: correct
# crop+keyword+mapping 'PO-83150', lone fresh-locate flip 'PO-83160') — so on disagreement ALONE the flip
# can be the OUTLIER and discard the corroborated truth. E2 (_crosscheck_keyword_corroborated) only owns
# the OPPOSITE direction (keyword==flip, the City-Office crop-mangled class). This pass owns the flip-
# REFUTED direction: restore a >=2-independent-family (>=1 crop-family) + page-present alternative over an
# UNcorroborated flip, re-based to anchor_inline@90 with the flag dropped (mirrors E2). Kill
# CROSSCHECK_OUTLIER_RECONCILE=0 (byte-identical off: anchor.py never stashes _crosscheck_original, this
# pass never runs). Slice-1 scope = the current crosscheck fire-gate (_is_ref_like_key OR date =
# *_number/*_no/*reference*/date, custom included); text/numeric are Slice-2 (universal post-merge verify).
CROSSCHECK_OUTLIER_RECONCILE = os.environ.get('CROSSCHECK_OUTLIER_RECONCILE', '0') != '0'

# Slice-2 UNIVERSAL post-merge verify (gary+reggie+007 → Oracle SIGN-OFF-W/COND 2026-08-03; see
# docs/oracle_log.md). ONE reusable pass over every field's winner using the always-on candidate
# ledger + raw ocr_text — the owner's "all types where possible" ask. Two independently-gated tiers:
#   RESTORE (ref/code · date · whole-number numeric · percentage) — Slice-1's 4-condition gate
#     skeleton with per-tier AGREE/PRESENT primitives; a restore is DEMOTED to a flag by the
#     Oracle's S-2 checks (confusable digit-substitution, date-shaped ref, prefix/length outlier,
#     decimal-tailed numeric, credibility) because the content-nature flag chain (D1 etc.) runs
#     BEFORE this pass and cannot re-examine a restored value.
#   FLAG (text/name minus supplier_name · email/website/postcode_uk/vat_gb/iban) — note-only,
#     names the disagreeing value; never changes a value (007: text divergence is bimodal —
#     structural-substring vs unbounded garble — no tolerance restores safely; repair is Stage 4.5's
#     jurisdiction). EXCLUDED entirely: currency/amount (the totals-reconciliation pass + Stage-4
#     maths own amounts; invoices REPEAT amounts so a wrong-but-corroborated alternative is the
#     NORM) and supplier_name (identity lane). Lone absence NEVER acts — only a corroborated
#     DISAGREEING alternative can. Both switches default OFF = byte-identical; CENSUS mode logs
#     would-fire decisions without mutating (mutation is governed SOLELY by the R/F switches).
UNIVERSAL_VERIFY_RESTORE = os.environ.get('UNIVERSAL_VERIFY_RESTORE', '0') != '0'
UNIVERSAL_VERIFY_FLAG    = os.environ.get('UNIVERSAL_VERIFY_FLAG', '0') != '0'
UNIVERSAL_VERIFY_CENSUS  = os.environ.get('UNIVERSAL_VERIFY_CENSUS', '0') != '0'
# Stage 2b sub-switch (Oracle C6): the 522-doc realdoc GT covers ref/date ONLY — a numeric restore
# cannot FAIL that gate, so numeric/percentage stay dark behind their own switch until the
# numeric/text GT arm (Customer Doc Test corpus) exists. RESTORE alone arms ref+date (stage 2a).
UNIVERSAL_VERIFY_NUMERIC = os.environ.get('UNIVERSAL_VERIFY_NUMERIC', '0') != '0'

# NAME-UNCLIP reconcile (reggie design → Oracle SIGN-OFF-W/COND 2026-08-04 — docs/oracle_log.md).
# The free-text complement of _reconcile_clipped_suffix (which SKIPS name-like fields): a Stage-0.5
# mapping whose drawn box CUTS a name mid-token ('Kingfisher Print Stuc' — the sliced 'd' misreads
# as 'c') commits @90 and silently beats two agreeing independent fuller reads. Heal post-merge from
# the ledger under FIVE conditions (C0 scope · C1 keyword+crop token-IDENTICAL witnesses · C2 cut
# fingerprint incl. Oracle's ONE edge-glyph substitution at the cut · C3 winner remnant page-ABSENT —
# the load-bearing genuine-shorter-name guard · C4 adopt page-present · C5 name-quality no worse).
# First sanctioned post-merge value-rewrite of a Stage-0.5 winner — justified SOLELY by C3
# page-absence ("the teach fixed the position, not the value"). On lexicon-rich scopes Stage 4.5's
# wordness note fires FIRST and this pass correctly STARVES to that flag (pinned — do not reorder).
# Default OFF = byte-identical.
NAME_UNCLIP_RECONCILE = os.environ.get('NAME_UNCLIP_RECONCILE', '0') != '0'

# TEMPLATE_DATE_INVALID_YIELD (Oracle SIGN-OFF-W/COND 2026-08-06). A Stage-0.5-located taught DATE
# that OCR-misread into an IMPOSSIBLE calendar value ('33/04/2026' — a tilt glyph-misread of
# '03/04/2026') used to WIN the kw-merge on AUTHORITY over a valid, confident keyword date. The teach
# fixed the POSITION, not the value; an impossible date is a deterministic CONTENT flaw (same family as
# the shipped date-in-ref / ref-length flags that already apply to taught reads). When the taught date
# is unparseable AND unsalvageable and a >=90-conf rx-validated keyword read IS a valid date, yield to
# it — but ALWAYS flagged to Review (the keyword is a valid date, not a verified-correct one; the NOTE
# is the sole safety: Stage 4 floors a clean date's confidence to _CLEAN_DATE_CONF=94, so the cap is
# cosmetic, but a non-empty validation_note blocks auto-file at any confidence). Heals ONLY the
# impossible-date subset of the tilt-misread class (a misread landing on a DIFFERENT valid date parses
# and is out of scope — see pendingfeatures). Default OFF (=1 arms); OFF = byte-identical. Pins:
# tests/test_taught_date_invalid_yield.py.
TEMPLATE_DATE_INVALID_YIELD = os.environ.get('TEMPLATE_DATE_INVALID_YIELD', '0') != '0'

# TEMPLATE_DATE_FUTURE_YIELD (Oracle SIGN-OFF-W/COND 2026-08-06) — the sibling of the impossible-date
# yield for the deterministically-FUTURE slice of the "misread → a different VALID date" residual. A
# taught date box that OCR-misread the YEAR ('2026'->'2096') reads a VALID calendar date that is
# absurdly far future and wins the merge over the correct keyword date. Stage 4 already FLAGS such a
# date @40 ("date is in the future") — so the doc was never auto-filing — but the WRONG value shows.
# Yield to the valid keyword date, FLAGGED. Its OWN switch (default OFF) because — unlike the
# impossible arm, which drops garbage — this drops a VALID taught value (larger blast radius: a
# genuinely >3y-future taught due/warranty date could be dropped; bounded to Review, M cannot rise
# since the doc was already flagged). OFF = byte-identical; INVALID-on / FUTURE-off = the shipped
# impossible-only behaviour. Pins: tests/test_taught_date_invalid_yield.py.
TEMPLATE_DATE_FUTURE_YIELD = os.environ.get('TEMPLATE_DATE_FUTURE_YIELD', '0') != '0'
# The taught-side FUTURE-YIELD trigger. DELIBERATELY on its own constant, HIGHER than the Stage-4
# future FLAG (validator._FUTURE_DATE_TOLERANCE_DAYS=366): a YIELD DROPS a valid taught value, so it
# must clear the whole plausible post-dated-business range (annual pre-billing, warranty/contract end
# ~1-2y). A glyph year-misread lands DECADES out (2->9 = +70y), so ~3y cleanly separates the misread
# class from any legitimate post-date. Retuning this must NOT retune the Stage-4 flag (kept separate).
_DATE_YIELD_FUTURE_DAYS = 1096   # ~3 years


def _invalid_taught_date_yields(taught_value, kw_value, now=None) -> str:
    """REASON code for the located date-merge yield ('' = keep the taught read's authority):
      'impossible' — taught is NOT a real calendar date (parse None AND salvage None; a spaced/junk-
                     suffixed VALID date is recovered by salvage and correctly does NOT yield);
      'future'     — taught PARSES but sits absurdly far future (glyph year-misread,
                     > _DATE_YIELD_FUTURE_DAYS) while the keyword is a valid date Stage 4 would NOT
                     itself future-flag (<= validator._FUTURE_DATE_TOLERANCE_DAYS — an INTENTIONAL
                     coupling: only yield to a keyword date that is not itself clearly-future).
    The keyword must be a valid calendar date in both cases; the caller still requires a date-typed
    key + _kw_ok (conf>=90) and flags the swap to Review. Reason keys the accurate review note.
    `now` is injectable for date-stable tests (routed through validator.days_in_future, the single
    clock/parse source)."""
    if not taught_value:                                     # an EMPTY taught read is a non-read
        return ''
    if validator.parse_date(kw_value) is None:               # keyword must be a valid calendar date
        return ''
    if validator.parse_date(taught_value) is None:           # (a) IMPOSSIBLE taught date
        return 'impossible' if validator.salvage_date(taught_value) is None else ''
    t_days = validator.days_in_future(taught_value, now)     # (b) CLEARLY-FUTURE taught date, kw not
    k_days = validator.days_in_future(kw_value, now)
    if (t_days is not None and k_days is not None
            and t_days > _DATE_YIELD_FUTURE_DAYS
            and k_days <= validator._FUTURE_DATE_TOLERANCE_DAYS):
        return 'future'
    return ''

# DESKEW_RAW_CROPS — the Straighten-arc frame election (gary+007 → Oracle SIGN-OFF-W/COND C1-C7,
# 2026-08-05 evening, docs/oracle_log.md). Taught boxes are stored RAW-frame (all three teach
# surfaces back-transform on save), but under Straighten the crop machinery read them against the
# DESKEWED page untransformed (1-2 glyph misplacement at 1.9°) AND any rotation of a noisy scan
# degrades small print (interpolation hypothesis refuted) — while the RAW tilted page reads
# perfectly at <=~2° (Tesseract self-tolerates). ELECTION: when Straighten produced raw pages,
# the crop-family machinery reads the RAW pages with the stored raw coords; the deskewed frame
# keeps serving full-page text (keyword), type detection, letterhead geometry and display.
# Per-page angle bound (C3): raw only when |angle| <= DESKEW_RAW_CROP_MAX_ANGLE (default 2.0 —
# proven at 1.9°; 2.5 only after a cap-edge lane greens); above the cap the page keeps today's
# deskewed behaviour AND the Stage-2.5 raw witness still guards it (C2 — the witness is NOT
# vestigial; global disable forbidden). C1: the election is computed ONCE per doc and the SAME
# list object feeds every crop site. Default OFF (=1 arms); OFF = byte-identical by object
# identity (the elected list is page_images itself).
DESKEW_RAW_CROPS = os.environ.get('DESKEW_RAW_CROPS', '0') != '0'
try:
    DESKEW_RAW_CROP_MAX_ANGLE = float(os.environ.get('DESKEW_RAW_CROP_MAX_ANGLE', '2.0') or 2.0)
except (TypeError, ValueError):
    DESKEW_RAW_CROP_MAX_ANGLE = 2.0


# TEACH_ANGLE_COMPOSE — the CANONICAL LEVEL-FRAME pivot (Oracle SIGN-OFF-W/COND C1-C6,
# 2026-08-05 late, docs/oracle_log.md). Stored teach coords (template mappings + landmarks)
# live in the TEACH SAMPLE's raw frame with its tilt θ_t baked in (every teach surface
# back-transforms display→raw on save via anchorLabel.deskewedNormToRaw: raw = C + R(+θ)·level,
# sign empirically pinned). Under Straighten-ON processing the pages are deskewed to LEVEL, so
# the coords are off by θ_t on every sibling — the caption-grab/cut-value class. COMPOSITION:
# rotate COPIES of the source template's mapping/landmark boxes to the level frame by the exact
# inverse, level = C + R(−θ_t)·(raw − C), in pixel space on the current page's W,H (expand=False
# keeps dims identical across frames). Fires ONLY when: switch ON · the doc was DESKEWED
# (raw_pages present — mode-level, NOT per-page: a below-floor/born-digital sibling is level and
# still exposes the full θ_t error) · the SOURCE template (mapping_src — the borrowed sibling's,
# never blindly the matched one; Oracle C2) carries a non-null angle ≥ the 0.2° floor · and
# DESKEW_RAW_CROPS is OFF (C3 mutual exclusion — level coords on a raw tilted page would be a
# third wrong frame; the election wins by explicit precedence). Stored rows NEVER mutated.
# Default OFF (=1 arms); OFF = byte-identical. Pins: tests/test_teach_angle_compose.py.
TEACH_ANGLE_COMPOSE = os.environ.get('TEACH_ANGLE_COMPOSE', '0') != '0'

# TEACH_ANGLE_COMPOSE_SCAN — PLACEMENT-ONLY skew correction (Oracle 2026-08-09, "fix placement,
# not pixels"). The sibling of TEACH_ANGLE_COMPOSE above, for the path where the page is NOT
# deskewed — i.e. ordinary import.
#
# THE PROBLEM IT SOLVES. A taught box carries the teach sample's tilt θ_t. The document being read
# has its own tilt θ_s. At 1.6° a 0.16-wide box drifts ~0.003 page-height — about HALF A TEXT LINE,
# which is exactly enough to shear a 2-row-tall free-text box onto the caption or the address row.
# That is a PLACEMENT error of half a line.
#
# WHY NOT JUST STRAIGHTEN THE PAGE. Measured and ruled on: rotating the pixels fixed 213 of 1127
# cells on a synthetic corpus, but that corpus tilts every page by at most 1.6° (gen_customer_test
# .py:675) — entirely inside the band Tesseract self-tolerates and inside DESKEW_RAW_CROP_MAX_ANGLE
# (2.0), and the band where this project's own doc-561 probe measured deskew making a REAL scan
# WORSE ('DN-98447' -> 'Dobrery\Not\Ne:/DN/er!' after its own +1.9° deskew). Re-run at a 2.0° floor
# the entire heal vanished — 0 of 1127 cells moved — proving the gain came only from the harmful
# band. Rotating nine megapixels of paper to move one box half a line is the wrong instrument.
#
# THE TRANSFORM, derived from the two documented mappings rather than guessed:
#     teach surfaces persist   raw   = C + R(+θ)·(level − C)      (anchorLabel.deskewedNormToRaw)
#     _compose_box_to_level    out   = C + R(−θ)·(p − C)
#   level        = C + R(−θ_t)·(teach_raw − C)
#   current_raw  = C + R(+θ_s)·(level − C)
#   ⇒ current_raw = C + R(θ_s − θ_t)·(teach_raw − C)  ⇒  pass θ = (θ_t − θ_s).
# θ_s is measured NON-DESTRUCTIVELY (detect_skew_angle is documented "measures only"); not one
# pixel is rotated, so the page, ocr_text, page-0 geometry, the logo phash and every learning write
# all stay in ONE frame. The process_docs raw/deskewed identity split-brain cannot arise, and
# raw_crop_recheck keeps its real cross-frame witness.
# Stored rows are NEVER mutated — copies only, exactly as the deskew sibling does.
# Default OFF (=1 arms); OFF = byte-identical. Pins: tests/test_teach_angle_compose_scan.py.
TEACH_ANGLE_COMPOSE_SCAN = os.environ.get('TEACH_ANGLE_COMPOSE_SCAN', '0') != '0'
_COMPOSE_SCAN_MIN_NET = 0.2    # below the detector's own noise floor a compose is not evidence
_COMPOSE_SCAN_MAX_NET = 5.0    # beyond this the page is not "slightly askew" — leave it to review


def _compose_box_to_level(x, y, w, h, theta_deg, W, H):
    """Rotate one raw-frame box (page-norm) into the LEVEL frame: transform the box's
    CENTRE by level = C + R(−θ)·(p − C) (the proven-sign inverse of deskewedNormToRaw)
    and KEEP w/h — exactly mirroring the teach surfaces, which back-transform only the
    top-left POINT and persist the LEVEL-frame w/h (deskewFinalizeAnchor). A corner-AABB
    here BLOATS a wide box vertically by w·sinθ (~half a text line for a 0.2-wide
    free-text box at 1.6°), pulling the caption line into the crop — the nf-gate
    customer-lane crater ('INVOICE TO' commits). Pure; returns (x, y, w, h) clamped."""
    th = math.radians(theta_deg)
    c, s = math.cos(th), math.sin(th)
    cx, cy = W / 2.0, H / 2.0
    px = (x + w / 2.0) * W - cx
    py = (y + h / 2.0) * H - cy
    ncx = (cx + c * px + s * py) / W
    ncy = (cy - s * px + c * py) / H
    nx = min(max(0.0, ncx - w / 2.0), 1.0)
    ny = min(max(0.0, ncy - h / 2.0), 1.0)
    return (nx, ny, min(w, 1.0 - nx), min(h, 1.0 - ny))


def _compose_mappings_to_level(mappings, theta_deg, W, H):
    """COPIES of the mapping rows with anchor+target boxes composed to the level frame."""
    out = []
    for m in (mappings or []):
        m2 = dict(m)
        for pre in ("anchor", "target"):
            try:
                bx = float(m[f"{pre}_x_norm"]); by = float(m[f"{pre}_y_norm"])
                bw = float(m[f"{pre}_w_norm"]); bh = float(m[f"{pre}_h_norm"])
            except (KeyError, TypeError, ValueError):
                continue
            nx, ny, nw, nh = _compose_box_to_level(bx, by, bw, bh, theta_deg, W, H)
            m2[f"{pre}_x_norm"] = nx; m2[f"{pre}_y_norm"] = ny
            m2[f"{pre}_w_norm"] = nw; m2[f"{pre}_h_norm"] = nh
        out.append(m2)
    return out


def _compose_landmarks_to_level(landmarks, theta_deg, W, H):
    """COPIES of the landmark rows composed to the level frame (same transform)."""
    out = []
    for lm in (landmarks or []):
        l2 = dict(lm)
        try:
            bx = float(lm["x_norm"]); by = float(lm["y_norm"])
            bw = float(lm["w_norm"]); bh = float(lm["h_norm"])
        except (KeyError, TypeError, ValueError):
            out.append(l2)
            continue
        nx, ny, nw, nh = _compose_box_to_level(bx, by, bw, bh, theta_deg, W, H)
        l2["x_norm"] = nx; l2["y_norm"] = ny; l2["w_norm"] = nw; l2["h_norm"] = nh
        out.append(l2)
    return out


def _elect_crop_pages(page_images, raw_pages, deskew_angles):
    """The Slice-0 frame election (pure; C1 single-list contract). Returns `page_images`
    BY IDENTITY when the election cannot or must not run (switch off, no raw pages, or a
    defensive length mismatch — fail toward today's behaviour, never mis-index); else a
    per-page list electing raw below the angle cap and the deskewed page above it."""
    if not DESKEW_RAW_CROPS or not raw_pages or not page_images:
        return page_images
    if len(raw_pages) != len(page_images):
        return page_images                      # parallelism broken upstream — fail to status quo
    out = []
    for i, img in enumerate(page_images):
        ang = 0.0
        if deskew_angles and i < len(deskew_angles):
            try:
                ang = abs(float(deskew_angles[i] or 0.0))
            except (TypeError, ValueError):
                ang = 0.0
        out.append(raw_pages[i] if ang <= DESKEW_RAW_CROP_MAX_ANGLE else img)
    return out


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


def _apply_late_rescue_sticky_cap(results, cap=_LATE_RESCUE_CAP):
    """TERMINAL re-cap of Stage-2.6 late-rescue reads (kill LATE_RESCUE_CAP_STICKY, gated at the
    ONE call site in extract()). Pure over the results dict: for every field carrying the
    `late_rescue` provenance stamped at the rescue (:3629), return its confidence to `cap` if a
    later boost re-inflated it above the cap. VALUE is never touched (fail-toward-review — a wrong
    blind read is HELD, not filed). Skips `_`-prefixed metadata and non-dict entries. Returns the
    count re-capped. See the call site for the full rationale + the forward-seam warning."""
    n = 0
    for k, d in results.items():
        if k.startswith('_') or not isinstance(d, dict):
            continue
        if d.get("late_rescue") and int(d.get("confidence") or 0) > cap:
            d["confidence"] = cap
            n += 1
    return n


def _filter_located_corrob(corrob_results, anchors_by_key, date_field_keys,
                           tol_x, tol_y, normalise_date):
    """PURE filter for Stage 2.6b late located crop-corroboration (Oracle C1-C3, unit-pinned by
    tests/test_late_located_corrob.py). Keeps ONLY reads that may safely vouch for a keyword-filled
    critical value at the taught-ownership guard, returning {field_key: candidate}:
      C1  method in {anchor_inline, anchor_crop_relocated} (label-confirmed reads that carry a value
          box) AND located is True — a BLIND authoritative rigid read (anchor_crop, located=False)
          is DROPPED, so it can never vouch through _anchor_corroborates' `authoritative OR located`
          (that bypass is the repeated-date hole).
      C2  the located value box sits NEAR the taught value box (a second same-caption elsewhere reads
          a different row -> dropped). FAILS CLOSED: no box / bad coords / no taught anchor -> dropped.
      C3  a DATE candidate is canonicalised to DD-MM-YYYY (the form the validator already gave the
          committed value) so the UNCHANGED token compare in _anchor_corroborates matches.
    No I/O, no engine state — safe to unit-test directly."""
    out = {}
    for k, d in (corrob_results or {}).items():
        if not isinstance(d, dict) or not d.get("value"):
            continue
        if str(d.get("method") or "") not in ("anchor_inline", "anchor_crop_relocated"):
            continue                                   # C1: genuine-locate whitelist
        if not d.get("located"):
            continue                                   # C1: located-only (never a blind rigid read)
        box, a = d.get("box"), (anchors_by_key or {}).get(k)
        try:
            near = (bool(box) and a is not None
                    and abs(float(box["x_norm"]) - float(a.get("x_norm") or 0)) <= tol_x
                    and abs(float(box["y_norm"]) - float(a.get("y_norm") or 0)) <= tol_y)
        except Exception:
            near = False
        if not near:
            continue                                   # C2: near-taught, fail-CLOSED
        d = dict(d)
        if k in (date_field_keys or set()):
            d["value"] = normalise_date(d.get("value")) or d.get("value")   # C3
        out[k] = d
    return out

# The resolved-identity ORIGINS a rescue may corroborate against: structural sources
# (logo / template identity / fixed values / template anchor). keyword- and
# hint-derived identities are excluded — corroborating a hint with a hint-derived
# identity would be single-source evidence.
_IDENTITY_STRUCTURAL_METHODS = frozenset({
    'logo', 'template_identity', 'template_fixed', 'template_fixed_locked', 'template_anchor',
})
# DELIBERATELY excludes 'template_identity_corroborated' (the S1 note-shed variant, Oracle C3
# 2026-07-28): a page-corroborated identity is treated NON-structural, so the dual-key
# customer_name rescue is a no-op on an S1 value — the safe direction.

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


def _name_guard_keyword_clears(data, existing, key) -> bool:
    """NAME-GUARD KEYWORD CLEAR decision (Oracle SEND-BACK redirect 2026-07-24; kill
    NAME_GUARD_KEYWORD_CLEAR). True iff the Stage-2 read carries the `_name_guard_clearable` marker —
    set by anchor.py ONLY at the :586 clean-rigid-name vs off-page-junk site — AND an INDEPENDENT
    Stage-1 keyword incumbent NORMALISES-EQUAL to the KEPT value. A STALE clean name is excluded BY
    CONSTRUCTION: its keyword read disagrees -> False -> the phantom note stands (fail-toward-review).
    Never clears supplier_name (the filing identity — mirrors _name_relocate_should_hold's exclusion).
    Pure; no side effects. Unit-pinned by test_name_guard_keyword_clear.py."""
    if not (isinstance(data, dict) and data.get("_name_guard_clearable")):
        return False
    # DEFAULT OFF (Oracle 2026-07-24): the clear is correct + pinned, but it lifts a doc's ONLY hold
    # when the phantom name note is the sole blocker — on #259 (ThornburyFasteners_delivery_docket_02)
    # that un-masked a REAL valid-shaped ref misread (DN-28472 read as DN-38472) into a SILENT wrong-
    # file. Ships DARK. PRECONDITION to flip ON (=1): make the authoritative-crop cross-check
    # (anchor.py:638-659) flag a crop-vs-full-page single-digit ref disagreement even when the crop
    # read is sub-credible, so #259's ref is independently held. Until then: fail-toward-review — the
    # Saltmarsh/Halcyon phantom flag stays (a cosmetic needless review), never a silent wrong result.
    if os.environ.get("NAME_GUARD_KEYWORD_CLEAR", "0") != "1":
        return False
    if key == "supplier_name":
        return False
    if not (isinstance(existing, dict) and str(existing.get("method") or "").startswith("keyword")):
        return False
    return _values_normalise_equal(data.get("value"), existing.get("value"), False)


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


def decide_logo_text_gate(logo_supplier, banks, ocr_text, norm, accepted_issuers=(),
                          geom_issuer_norm=None):
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
    # NAME-PRESENCE ACCEPT ARM (geometry witness; kill LOGO_NAME_PRESENCE_ACCEPT). An INDEPENDENT
    # geometry-only read of the letterhead (the largest top-of-page name, recipient excluded by
    # size+position — letterhead.pick_issuer_geometry, Oracle C1) that AGREES with the logo's
    # supplier CONFIRMS the identity where the branding-fingerprint arms are UNJUDGEABLE: a
    # single-word wordmark, or a minimalist letterhead below the token/band floors. It promotes a
    # HOLD to ACCEPT only at the two unjudgeable returns below — it NEVER reaches the destructive
    # 'abstain' (a decisively-present rival brand still wins). geom_issuer_norm is None unless the
    # caller resolved a geometry pick with the switch on ⇒ inert (byte-identical) by default.
    _name_confirmed = geom_issuer_norm is not None and geom_issuer_norm == norm(logo_supplier)
    if not _identity_text_sufficient(ocr_text):
        return 'accept' if _name_confirmed else 'suggest'   # thin band, but the name IS the letterhead
    own_ratio = _branding_own_ratio(logo_supplier, banks, ocr_text, norm)
    if own_ratio is None:
        return 'accept' if _name_confirmed else 'suggest'   # no >=K-word bank, but name IS the letterhead
    if own_ratio > _BRANDING_PRESENT_RATIO:
        return 'accept'
    if norm(logo_supplier) in (accepted_issuers or ()):
        return 'suggest'                       # C3: operator allowlist outranks the text check
    return 'abstain'                           # POSITIVE DISAGREEMENT — name arm never reaches here


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


def _prints_name_stats(templates, norm):
    """{norm(stamped supplier): (ratio, count)} from the templates payload's
    supplier_prints_name enrichment (database/modules/templates.js getAll): the fraction of
    that supplier's CONFIRMED docs whose page text corroborates its name, and the sample size.
    Keyed by the value the template would STAMP (its fixed supplier_name), normalised with the
    SAME _accept_norm the probe uses (Oracle condition 2 — parity, never bare .lower()).
    Missing/old payload → {} → the TEMPLATE_FIXED_NAME_PRESENCE_VETO abstains (byte-identical
    backward compat — pinned in tests/test_template_fixed_name_presence.py)."""
    out = {}
    for t in (templates or []):
        spn = t.get("supplier_prints_name") if isinstance(t, dict) else None
        if not isinstance(spn, dict):
            continue
        sup = (spn.get("supplier") or "").strip()
        if not sup:
            continue
        try:
            out[norm(sup)] = (float(spn.get("ratio") or 0), int(spn.get("count") or 0))
        except (TypeError, ValueError):
            continue
    return out


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
    # ONE implementation, shared with the template matcher's identity-on-page guard
    # (TEMPLATE_IDENTITY_ON_PAGE, 2026-08-10). Both call sites ask the same question — "is this
    # company named on this document?" — and this codebase has been bitten before by two spellings
    # of one predicate drifting apart, so the FILL path and the MATCH path use the same function.
    return template_matcher.identity_present_on_page(value, ocr_text)


def _identity_corroborated_strict(value: str | None, band: str | None) -> bool:
    """STRICTER local predicate for SHEDDING a template-identity review note (S1, Oracle C1
    2026-07-28) — distinct from `_template_identity_corroborated` (>=60%, used for the FILL).
    True when EITHER the full normalised value appears as a contiguous alnum substring of the
    (already issuer-band-truncated) `band`, OR EVERY distinctive name token (>=3 chars, minus
    generic suffixes) is present as a whole word. The >=60% FILL test would shed on a 2-of-3
    descriptor SUBSET ('...water systems' minus 'Cascade' = 0.67) — clearing the note on a
    same-trade sibling inside the logo-collision cluster; requiring ALL tokens closes that.
    Guarded so a lone short token (<6 chars) can never shed on its own. FAIL toward keeping the
    note (any doubt → False)."""
    if not value or not band:
        return False
    import re as _re
    _norm  = " ".join(_re.findall(r"[a-z0-9]+", str(value).lower()))
    _btext = " ".join(_re.findall(r"[a-z0-9]+", str(band).lower()))
    # Substring arm: a multi-token value, or a single token >=6 chars, present contiguously. A lone
    # SHORT value ('IN') must fall through to the token arm (which filters <3-char tokens out) so an
    # incidental word match can never shed the note.
    if _norm and (" " in _norm or len(_norm) >= 6) and _norm in _btext:
        return True
    _GENERIC = {"ltd", "limited", "plc", "llp", "inc", "incorporated", "co", "company", "corp",
                "group", "holdings", "services", "service", "the", "and"}
    toks = [t for t in _re.findall(r"[a-z0-9]+", str(value).lower())
            if len(t) >= 3 and t not in _GENERIC]
    if not toks:
        return False
    # A lone token must be long (>=6) to shed; otherwise require >=2 distinctive tokens.
    if len(toks) < 2 and not (len(toks) == 1 and len(toks[0]) >= 6):
        return False
    present = sum(1 for t in toks if _re.search(r"\b" + _re.escape(t) + r"\b", _btext))
    return present == len(toks)


# S-A date-in-ref belt regexes (module-level — compiled once). A guard value must be a
# FULL-STRING numeric 3-component date with the SAME separator repeated, or a month-name
# date, AND parse via validator.parse_date — the pair keeps '20260731' / '21/07' /
# 'DN-24/07/26' out of reach (pinned in tests/test_date_in_ref_flag.py).
_NUM_DATE_RE  = re.compile(r'^\d{1,4}([/\-.])\d{1,2}\1\d{1,4}$')
_NAME_DATE_RE = re.compile(
    r'^\d{1,2}(?:st|nd|rd|th)?[\s\-.]+[A-Za-z]{3,9}\.?,?[\s\-.]+\d{2,4}$'
    r'|^[A-Za-z]{3,9}\.?,?[\s\-.]+\d{1,2}(?:st|nd|rd|th)?,?[\s\-.]+\d{2,4}$')


def _strong_single_prefix(rec) -> bool:
    """Dominance guard for the prefix-garble adopt lane (Oracle C2, 2026-08-03). Once Stage-4.5
    strips the '»' debris, a garbled 'PO-17039'->'0-17039' is MECHANICALLY indistinguishable from
    a genuine numeric-leading '0-17039'; the ONLY separator is that this scope has never confirmed
    a numeric-leading ref. So require: `all_prefixed` (every confirmed ref carries an alpha prefix —
    load-bearing, DO NOT drop), dominant share >= 0.90 (stricter than the 0.80 index-arming bar),
    and >= DOMINANT_MIN_COUNT confirmations. Reads the prefix rec from ocr_corrector.lookup_prefix
    ({dominant, counts, total})."""
    counts = (rec or {}).get('counts') or {}
    total  = int((rec or {}).get('total') or 0)
    dom    = (rec or {}).get('dominant')
    if not dom or total <= 0:
        return False
    all_prefixed = (sum(counts.values()) == total)   # NO numeric-leading ref was ever confirmed
    return (all_prefixed
            and counts.get(dom, 0) / total >= 0.90
            and counts.get(dom, 0) >= ocr_corrector.DOMINANT_MIN_COUNT)


def _is_ref_field(key: str) -> bool:
    """Reference-number-style fields, by naming convention (no supplier/doc
    specifics): invoice_number / po_number / sales_order_number (..._number),
    job_no (..._no), and any explicit reference field. Covers unseen custom
    types that follow the same convention."""
    k = (key or "").lower()
    return k.endswith("_number") or k.endswith("_no") or "reference" in k


# ── G1 veto-fallthrough corroboration predicates (pure — Oracle SIGN-OFF-W/COND 2026-07-26) ──
# On a doc whose template match arrived via the identity-veto FALL-THROUGH, a critical-field
# winner must be corroborated by (i) an independent-family rail read or (ii) boundary-guarded
# presence in the full-page text — else the doc is note-held (G1, final assembly). Pure module
# functions so the unit file tests them directly. See tests/test_veto_fallthrough_corrob.py.

def _method_family(method) -> str:
    """Coarse read-provenance family. Arm (i) requires the corroborating candidate to come from a
    DIFFERENT family than the winner — same-source agreement (anchor_inline vs anchor_crop: same
    pixels, same pass family) deliberately counts for NOTHING (Oracle S5: same-pixel agreement is
    weak; do not 'improve' this by letting anchor corroborate anchor)."""
    m = str(method or "")
    if m.startswith("keyword"):
        return "keyword"
    if m.startswith("anchor"):
        return "anchor"
    if m.startswith("template"):
        return "template"
    if m.startswith("hint"):
        return "hint"
    return m or "other"


def _page_presence_corroborated(value, ocr_text) -> bool:
    """Arm (ii): the value's alnum core appears in the page text, separator-tolerant BUT boundary-
    guarded — the (?<![A-Za-z0-9]) / (?![A-Za-z0-9]) lookarounds are LOAD-BEARING (Oracle C2): they
    are what stops '4/10/2026' corroborating against a page printing '14/10/2026' (the interior '4'
    fails the left lookaround). Bounds (Oracle C3): core length 4..48 (shorter = too ambiguous;
    longer = uncorroborated → hold, fail-toward-review), each char re.escape'd, bounded {0,3}
    separator join (never *), IGNORECASE, compiled per value (literal-anchored, no backtracking
    blowup)."""
    import re as _re
    core = "".join(c for c in str(value or "") if c.isalnum())
    if not (4 <= len(core) <= 48) or not ocr_text:
        return False
    pat = (r"(?<![A-Za-z0-9])" + r"[\W_]{0,3}".join(_re.escape(c) for c in core)
           + r"(?![A-Za-z0-9])")
    try:
        return _re.search(pat, ocr_text, _re.IGNORECASE) is not None
    except _re.error:
        return False


def _fallthrough_critical_corroborated(winner, cands, ocr_text, is_date) -> bool:
    """G1 predicate: is this critical-field WINNER corroborated?
      (i) some rail candidate of a DIFFERENT method family normalise-equal to it (dates: BOTH sides
          must validator.parse_date — closes the documented _values_normalise_equal fail-open date
          polarity at this call site), OR
      (ii) the winner's value present in the full-page text (boundary-guarded); for DATES the RAW
          own-family rail captures are also tried through the SAME matcher (Oracle C2 — Stage 4
          rewrites '4/10/2026'→'04-10-2026', whose collapsed core would falsely fail against a
          genuine page '4/10/2026'; a bare substring test is FORBIDDEN here).
    NO authoritative exemption (Oracle Q2 ruling): an authoritative winner keeps its value/method/
    confidence — G1 only withholds the SILENT file. Keyword winners pass (ii) by construction."""
    wv = str((winner or {}).get("value") or "")
    if not wv:
        return False
    wfam = _method_family((winner or {}).get("method"))
    for c in (cands or []):
        cv = str((c or {}).get("value") or "")
        if not cv or _method_family((c or {}).get("method")) == wfam:
            continue
        if is_date and not (validator.parse_date(wv) and validator.parse_date(cv)):
            continue
        if _values_normalise_equal(cv, wv, is_date):
            return True
    if _page_presence_corroborated(wv, ocr_text):
        return True
    if is_date:
        for c in (cands or []):
            if _method_family((c or {}).get("method")) != wfam:
                continue
            rv = str((c or {}).get("value") or "")
            if rv and rv != wv and _page_presence_corroborated(rv, ocr_text):
                return True
    return False


def _crosscheck_witness_bucket(stage, method):
    """Read-provenance bucket for the crosscheck-outlier reconcile — FINER than _method_family, which
    folds every anchor* into ONE bucket (Oracle C2: a crop OCR and the full-page text pass would then
    both count as 'independent' when they are the same pixels). Returns (family, is_crop) or None to
    EXCLUDE the read. EXCLUDED entirely: anchor_registration (located-by-fiat — an independence fraud),
    bare 'anchor' (the same full-page line the keyword pass reads), and the crosscheck flip itself.
    CROP-family = a drawn-box / located crop OCR, genuinely independent of the full-page text pass."""
    st = str(stage or "")
    m = str(method or "")
    if m in ("anchor_registration", "anchor", "anchor_crop_crosscheck"):
        return None
    if st == "0.5_mapping" or m.startswith("template"):
        return ("mapping", True)      # Stage-0.5 drawn-box crop OCR — different region AND recipe
    if st == "1_keyword" or m.startswith("keyword"):
        return ("keyword", False)     # regex over the full-page text — NOT crop-independent
    if m in ("anchor_crop", "anchor_inline", "anchor_crop_relocated"):
        return ("crop", True)
    if m.startswith("hint"):
        return ("hint", False)
    return None                       # unknown / weak → not counted toward the family total


def _crosscheck_corroborated_alternative(winner, cands, ocr_text, is_date):
    """Slice-1 crosscheck-outlier reconcile predicate (pure). The WINNER is an 'anchor_crop_crosscheck'
    flip. Return a DISTINCT-value alternative to RESTORE, or None (fail-toward-review — flip stays).
    Fires ONLY when:
      (0) the flip is itself UNcorroborated — _fallthrough_critical_corroborated False (reuses E2/G1's
          different-family + page-presence test; City-Office's page-present flip returns True → bail); AND
      an alternative value V (disagreeing with the flip, calendar-aware for dates) is:
      (1) agreed by >=2 INDEPENDENT method families (per _crosscheck_witness_bucket), AND
      (2) supported by >=1 CROP-family read (so the two legs are never both the full-page text — C2), AND
      (3) present in the page text (_page_presence_corroborated — a SEPARATE AND, never a family).
    The winner's own pre-flip crop read (_crosscheck_original, preserved by anchor.py under the same kill
    switch — Oracle C1) is admitted as a crop-family witness, so a keyword+crop (NO-mapping) ⊕-taught doc
    heals — not only a mapping-backed one (else this is a document fix, not a system fix)."""
    if not isinstance(winner, dict):
        return None
    if str(winner.get("method") or "") != "anchor_crop_crosscheck":
        return None                                  # only a live crosscheck flip is reconcilable
    flip = str(winner.get("value") or "")
    if not flip:
        return None
    if _fallthrough_critical_corroborated(winner, cands, ocr_text, is_date):
        return None                                  # (0) the flip IS corroborated → never override it
    buckets = {}   # alnum_key -> {"raw": str, "fams": set(), "crop": bool}

    def _admit(value, fam_tuple):
        if fam_tuple is None:
            return
        v = str(value or "").strip()
        if not v or _values_normalise_equal(v, flip, is_date):
            return                                   # only DISAGREEING alternatives are restore targets
        key = "".join(c for c in _cmp_norm(v) if c.isalnum())
        if not key:
            return
        slot = buckets.setdefault(key, {"raw": v, "fams": set(), "crop": False})
        fam, is_crop = fam_tuple
        slot["fams"].add(fam)
        if is_crop:
            slot["crop"] = True

    for c in (cands or []):
        _admit((c or {}).get("value"),
               _crosscheck_witness_bucket((c or {}).get("stage"), (c or {}).get("method")))
    _admit(winner.get("_crosscheck_original"), ("crop", True))   # C1 — pre-flip crop as a crop-family leg

    best = None
    for slot in buckets.values():
        if len(slot["fams"]) >= 2 and slot["crop"] \
                and _page_presence_corroborated(slot["raw"], ocr_text):
            if best is None or len(slot["fams"]) > len(best["fams"]):
                best = slot
    return best["raw"] if best else None


# ── Slice-2 universal post-merge verify — pure per-tier primitives ────────────────────────────
# (gary+reggie+007 → Oracle SIGN-OFF-W/COND 2026-08-03.) The Slice-1 gate skeleton generalised:
# per-tier AGREE (when do two candidate values corroborate each other) and PRESENT (when is a
# value credibly printed on the page). Precision-first: a false AGREE/PRESENT can RESTORE a wrong
# value, so every tier's failure mode errs toward "not a witness" (fail-toward-review).

_UV_STRUCTURED_TYPES = {'email', 'website', 'postcode_uk', 'vat_gb', 'iban'}
_UV_RESTORE_TIERS    = {'ref', 'date', 'numeric', 'percentage'}


def _uv_tier(key, ftype, ref_field_key, date_field_keys):
    """Slice-2 tier dispatch by field TYPE + structural role (type-keyed, never name-keyed beyond
    the shipped _is_ref_field naming convention — a system rule, not a doc rule). None = EXCLUDED:
    currency/amount (totals pass owns), supplier_name (identity lane), precise network types
    (mac/ip machinery owns), unknown types (no safe predicate)."""
    k = str(key or '')
    t = str(ftype or '').lower()
    if k == 'supplier_name':
        return None
    if t in ('currency', 'amount', 'currency_code'):
        return None
    if t == 'date' or k in (date_field_keys or ()):
        return 'date'
    if t in _UV_STRUCTURED_TYPES:
        return 'structured'
    if t == 'number':
        return 'numeric'
    if t == 'percentage':
        return 'percentage'
    if t in ('reference', 'reference_code', 'alphanumeric', 'job_reference') \
            or (ref_field_key and k == ref_field_key) or _is_ref_field(k):
        return 'ref'
    if t in ('', 'text', 'multiline_text'):
        return 'text'
    return None


# Strict numeric grammar (reggie): comma/NBSP thousands only, optional 1-2 digit decimal tail.
# A value failing the grammar (garbled grouping, comma-decimal '1.600,50', lakh '1,60,000') is
# NOT a witness. Space grouping deliberately rejected: row-rebuilt ocr_text merges adjacent
# columns onto one line, so 'Qty 1 600.00' must never assemble '1600'.
_UV_NUM_RE = re.compile('^[+-]?(\\d{1,3}(?:[, ]\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?$')


def _uv_numeric_canon(value, pct=False):
    """(int_digits, decimal_tail_rstripped) or None. Leading zeros are SIGNIFICANT (a zero-led
    'number' is really a code — exact-string equality keeps '042' != '42')."""
    s = str(value or '').strip()
    if pct:
        s = re.sub('\\s*%$', '', s).strip()
    m = _UV_NUM_RE.match(s)
    if not m:
        return None
    ints = m.group(1).replace(',', '').replace(' ', '')
    dec = (m.group(2) or '').rstrip('0')
    return (ints, dec)


def _uv_numeric_agree(a, b, pct=False) -> bool:
    ca, cb = _uv_numeric_canon(a, pct), _uv_numeric_canon(b, pct)
    return ca is not None and ca == cb


def _uv_numeric_page_present(value, ocr_text, min_int_digits=4, pct=False) -> bool:
    """Grouped-render presence for a numeric value (reggie + Oracle). Builds the comma/NBSP
    grouped pattern from the canonical int digits with TWO extra guards over the generic
    presence primitive: fixed-width lookbehind (?<![0-9][,. ]) kills the grouped-tail steal
    ('250000' must not match inside '1,250,000'); lookahead (?![.,][0-9]) kills the decimal
    interior ('1250' must not match inside '1,250.75'). A whole-number winner accepts a
    zero-cents render ('1,600.00' corroborates 1600); '16.00' can never corroborate '1600'
    (a digit cannot be skipped). min_int_digits=1 is the WINNER-DEFENCE mode (gary's symmetry
    trap: a correct short winner '42' must be defensible even though it is never a restore
    target); the ALTERNATIVE leg keeps the >=4 floor. Percentage mode requires the printed
    '%' anchor, which makes even 1-2 digit percentages safely locatable."""
    c = _uv_numeric_canon(value, pct=pct)
    if not c or not ocr_text:
        return False
    ints, dec = c
    if len(ints) < (1 if pct else min_int_digits):
        return False
    parts = []
    for i, ch in enumerate(ints):
        parts.append(re.escape(ch))
        rem = len(ints) - 1 - i
        if rem and rem % 3 == 0:
            parts.append('[, ]?')
    body = ''.join(parts)
    if dec:
        tail = '\\.' + re.escape(dec) + ('0?' if len(dec) == 1 else '')
    else:
        tail = '(?:\\.0{1,2})?'
    lead = '(?<![0-9A-Za-z])(?<![0-9][,.  ])'
    trail = '(?![0-9A-Za-z])(?![.,][0-9])'
    pat = lead + body + tail + ('\\s?%' if pct else trail)
    try:
        return re.search(pat, ocr_text) is not None
    except re.error:
        return False


def _uv_date_agree(a, b) -> bool:
    """Calendar equality with BOTH sides parse-gated (the documented _values_normalise_equal
    date-arm fail-open makes an ungated call unsafe — never 'simplify' to that helper here)."""
    da = validator.parse_date(str(a or ''))
    db = validator.parse_date(str(b or ''))
    return bool(da and db and da.date() == db.date())


def _uv_date_page_present(value, ocr_text) -> bool:
    """Locate-and-parse presence (reggie): run the shipped salvage LOCATORS over the page text,
    parse each hit, present iff some hit calendar-equals the target. Inherits salvage's guarantees:
    a locator hit needs real separators or a month name (a bare ref '41026' can never corroborate a
    date), and greedy leftmost matching means a page '14/10/2026' yields 14-Oct — never an interior
    '4/10/2026' — so the collapsed-core trap can't arise by construction."""
    tgt = validator.parse_date(str(value or ''))
    if not tgt or not ocr_text:
        return False
    try:
        for m in validator._NUMERIC_DATE_RE.finditer(ocr_text):
            d = validator.parse_date(re.sub('\\s+', '', m.group(0)))
            if d and d.date() == tgt.date():
                return True
        for m in validator._MONTH_NAME_DATE_RE.finditer(ocr_text):
            d = validator.parse_date(re.sub('\\s{2,}', ' ', m.group(0)).strip())
            if d and d.date() == tgt.date():
                return True
    except Exception:
        return False
    return False


def _uv_text_tokens_agree(a, b) -> bool:
    """Tolerant text AGREE — FLAG tier only, NEVER feeds a restore (007: text divergence is
    bimodal; the tolerance that admits OCR jitter also admits one-letter-different real names).
    Normalised content tokens; ONE adjacent-pair join allowed on either side (absorbs a
    'North gate'/'Northgate' split); pairwise exact, or len>=5 Levenshtein<=1 under a TOTAL
    budget of 1 across the whole value (deliberately NOT name_match._close — its budget-2 arm
    passes northgate/northdale, which must disagree)."""
    try:
        from extraction import text_normalise as _tn
        from extraction import name_match as _nm
        ta = [t for t in _tn.tokenise(a) if _nm._is_content(t)]
        tb = [t for t in _tn.tokenise(b) if _nm._is_content(t)]
        if not ta or not tb:
            return False

        def _variants(toks):
            yield toks
            for i in range(len(toks) - 1):
                yield toks[:i] + [toks[i] + toks[i + 1]] + toks[i + 2:]

        for xa in _variants(ta):
            for xb in _variants(tb):
                if len(xa) != len(xb):
                    continue
                budget = 1
                ok = True
                for p, q in zip(xa, xb):
                    if p == q:
                        continue
                    if len(p) >= 5 and len(q) >= 5:
                        d = _nm._levenshtein(p, q)
                        if d <= budget:
                            budget -= d
                            continue
                    ok = False
                    break
                if ok:
                    return True
    except Exception:
        return False
    return False


def _uv_text_page_present(value, ocr_text) -> bool:
    """Per-token containment (007's polarity catch): every QUALIFYING content token (alnum core
    4..48) must be present via the shipped boundary-guarded primitive. Tokenising — instead of one
    whole-value mega-join — stops the 48-char cap systematically failing long correct values.
    Short tokens (core <4, e.g. 'Ltd') are skipped as unverifiable; a value with NO qualifying
    token is simply not page-verifiable → False (which only ever suppresses a flag/restore)."""
    try:
        from extraction import text_normalise as _tn
        from extraction import name_match as _nm
        toks = [t for t in _tn.tokenise(value) if _nm._is_content(t)]
    except Exception:
        return False
    qual = [t for t in toks if 4 <= len("".join(c for c in t if c.isalnum())) <= 48]
    if not qual:
        return False
    return all(_page_presence_corroborated(t, ocr_text) for t in qual)


def _uv_structured_canon(ftype, value) -> str:
    v = str(value or '').strip()
    if ftype == 'email':
        return v.lower().replace(' ', '')
    if ftype == 'website':
        v = re.sub('^https?://', '', v.lower()).rstrip('/')
        return re.sub('^www\\.', '', v)
    if ftype == 'postcode_uk':
        return v.upper().replace(' ', '')
    if ftype == 'vat_gb':
        v = v.upper().replace(' ', '')
        return v[2:] if v.startswith('GB') else v
    if ftype == 'iban':
        return v.upper().replace(' ', '')
    return v


def _uv_structured_agree(ftype, a, b) -> bool:
    ca, cb = _uv_structured_canon(ftype, a), _uv_structured_canon(ftype, b)
    return bool(ca) and ca == cb


def _uv_structured_page_present(ftype, value, ocr_text) -> bool:
    """Structure-anchored presence (reggie): the '@' and each '.' are REQUIRED literals with only
    optional whitespace around them — the generic alnum-core join would falsely assemble
    'johndoeacmeco' out of a letterhead line 'John Doe, Acme Co' that never prints the email."""
    if not value or not ocr_text:
        return False
    try:
        if ftype == 'email':
            v = _uv_structured_canon(ftype, value)
            if '@' not in v or '.' not in v.split('@', 1)[1]:
                return False
            pat = re.escape(v).replace('@', '\\s?@\\s?').replace('\\.', '\\s?\\.\\s?')
        elif ftype == 'website':
            v = _uv_structured_canon(ftype, value)
            if '.' not in v:
                return False
            pat = '(?:www\\s?\\.\\s?)?' + re.escape(v).replace('\\.', '\\s?\\.\\s?')
        elif ftype == 'postcode_uk':
            v = _uv_structured_canon(ftype, value)
            if len(v) < 5:
                return False
            pat = re.escape(v[:-3]) + '\\s?' + re.escape(v[-3:])
        elif ftype == 'vat_gb':
            v = _uv_structured_canon(ftype, value)
            if not v.isdigit() or len(v) < 9:
                return False
            pat = '(?:GB\\s?)?' + '\\s?'.join(re.escape(c) for c in v)
        elif ftype == 'iban':
            v = _uv_structured_canon(ftype, value)
            if len(v) < 15:
                return False
            pat = '[ ]?'.join(re.escape(c) for c in v)
        else:
            return False
        pat = '(?<![A-Za-z0-9])' + pat + '(?![A-Za-z0-9])'
        return re.search(pat, ocr_text, re.IGNORECASE) is not None
    except re.error:
        return False


def _uv_agree(tier, ftype, a, b) -> bool:
    """Tier-dispatched AGREE."""
    if tier == 'date':
        return _uv_date_agree(a, b)
    if tier == 'numeric':
        return _uv_numeric_agree(a, b)
    if tier == 'percentage':
        return _uv_numeric_agree(a, b, pct=True)
    if tier == 'text':
        return _uv_text_tokens_agree(a, b)
    if tier == 'structured':
        return _uv_structured_agree(ftype, a, b)
    return _values_normalise_equal(a, b, False)          # ref: shipped alnum-core equality


def _uv_present(tier, ftype, value, ocr_text, defending=False) -> bool:
    """Tier-dispatched PRESENT. `defending=True` = the WINNER-defence leg (symmetric, floor-free
    for numerics so a correct '42' is defensible); the ALTERNATIVE leg keeps every floor (a
    restore target must clear the full bar). An all-digit ref core routes through the numeric
    predicate (reggie's traced gap: the generic lookbehind lets '250000' match inside
    '1,250,000' — Slice-2 path only, the shipped/gated Slice-1+G1 primitives stay untouched)."""
    if tier == 'date':
        return _uv_date_page_present(value, ocr_text)
    if tier == 'numeric':
        return _uv_numeric_page_present(value, ocr_text, min_int_digits=(1 if defending else 4))
    if tier == 'percentage':
        return _uv_numeric_page_present(value, ocr_text, pct=True)
    if tier == 'text':
        return _uv_text_page_present(value, ocr_text)
    if tier == 'structured':
        return _uv_structured_page_present(ftype, value, ocr_text)
    core = "".join(c for c in str(value or '') if c.isalnum())
    if core.isdigit():
        return _uv_numeric_page_present(core, ocr_text, min_int_digits=(1 if defending else 4))
    return _page_presence_corroborated(value, ocr_text)


def _uv_winner_corroborated(winner, cands, ocr_text, tier, ftype) -> bool:
    """Tier-aware WINNER defence (the Slice-2 analogue of _fallthrough_critical_corroborated):
    a different-family rail tier-AGREEs with the winner, OR the winner is tier-PRESENT
    (floor-free — the symmetric defence). Dates also try raw own-family rail captures through
    the same present matcher (the shipped C2 route: Stage 4 rewrites '4/10/2026'→'04-10-2026')."""
    wv = str((winner or {}).get('value') or '')
    if not wv:
        return False
    wfam = _method_family((winner or {}).get('method'))
    for c in (cands or []):
        cv = str((c or {}).get('value') or '')
        if not cv or _method_family((c or {}).get('method')) == wfam:
            continue
        if _uv_agree(tier, ftype, wv, cv):
            return True
    if _uv_present(tier, ftype, wv, ocr_text, defending=True):
        return True
    if tier == 'date':
        for c in (cands or []):
            if _method_family((c or {}).get('method')) != wfam:
                continue
            rv = str((c or {}).get('value') or '')
            if rv and rv != wv and _uv_date_page_present(rv, ocr_text):
                return True
    return False


def _uv_corroborated_alternative(winner, cands, ocr_text, tier, ftype, require_crop):
    """Slice-2 alternative selection — the Slice-1 bucket loop with per-tier AGREE grouping and
    per-tier PRESENT on the alternative leg. require_crop=True for the RESTORE tiers (>=1
    crop-family leg, Oracle C2's independence bar); the FLAG tiers need >=2 distinct families
    but no crop leg (a text field whose only witnesses are keyword+hint may still FLAG — the
    cost of a false flag is a review note, not a wrong file). Grouping key per tier is the
    tier-canonical form; an UNparseable/ungrammatical read is NOT a witness."""
    wv = str((winner or {}).get('value') or '')
    if not wv:
        return None
    buckets = {}

    def _group_key(v):
        if tier == 'date':
            d = validator.parse_date(str(v or ''))
            return d.date().isoformat() if d else None
        if tier in ('numeric', 'percentage'):
            c = _uv_numeric_canon(v, pct=(tier == 'percentage'))
            return ('%s|%s' % c) if c else None
        if tier == 'structured':
            return _uv_structured_canon(ftype, v) or None
        if tier == 'text':
            try:
                from extraction import text_normalise as _tn
                from extraction import name_match as _nm
                toks = [t for t in _tn.tokenise(v) if _nm._is_content(t)]
                return ' '.join(toks) or None       # exact-normalised grouping: two witnesses
            except Exception:                        # must genuinely agree (conservative — a
                return None                          # tolerant grouping is non-transitive)
        key = "".join(c for c in _cmp_norm(v) if c.isalnum())
        return key or None

    for c in (cands or []):
        fam_tuple = _crosscheck_witness_bucket((c or {}).get('stage'), (c or {}).get('method'))
        if fam_tuple is None:
            continue
        v = str((c or {}).get('value') or '').strip()
        if not v or _uv_agree(tier, ftype, v, wv):
            continue                                 # only DISAGREEING alternatives
        gk = _group_key(v)
        if gk is None:
            continue                                 # unparseable → not a witness
        slot = buckets.setdefault(gk, {'raw': v, 'fams': set(), 'crop': False,
                                       'crop_method': None})
        fam, is_crop = fam_tuple
        slot['fams'].add(fam)
        if is_crop:
            slot['crop'] = True
            if not slot['crop_method']:
                slot['crop_method'] = (c or {}).get('method')

    best = None
    for slot in buckets.values():
        if len(slot['fams']) < 2 or (require_crop and not slot['crop']):
            continue
        if not _uv_present(tier, ftype, slot['raw'], ocr_text, defending=False):
            continue
        if best is None or len(slot['fams']) > len(best['fams']):
            best = slot
    return best


def _inline_absence_should_hold(winner, cands, ocr_text, is_date) -> bool:
    """Fix A (#183, gary design + Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-26): should a CRITICAL
    anchor_inline winner be HELD for review? True iff the winner was committed by the Stage-2 word-
    geometry inline harvest (method 'anchor_inline') AND no independent source corroborates it
    (_fallthrough_critical_corroborated is False: no different-method-family rail agrees AND the value's
    alnum core is absent from the full-page text). Catches the skew-synthesis class — a valid-shaped
    critical value the harvest assembled from scattered word boxes that appears NOWHERE on the page
    (#183: 'PO-20008' while the page prints 'PO-60906'); the row-grouping loss hid it from ocr_text so it
    rode the conformance boost to a silent auto-file.

    Oracle C2 (2026-07-26): keyed on the CORROBORATION invariant, NOT on whether the rigid crop was
    'rejected'. That story is SUFFICIENT-NOT-NECESSARY and unobservable in production (on_reject is trace-
    only; the _xsup_absolute_ok skip and the supersede-not-reject path both yield anchor_inline with no
    rejection) — do NOT re-scope this to demand a rejection signal or a crop box. Being a pure function of
    the RESULT (no anchors-list correlation) it also closes the label-less/positional-anchor synthesis hole
    (the blind-po_date class) that a crop-box requirement would have exempted."""
    if str((winner or {}).get("method") or "") != "anchor_inline":
        return False
    return not _fallthrough_critical_corroborated(winner, cands or [], ocr_text or "", is_date)


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


# ── Net-misread total FLAG (DEFAULT OFF — gary+reggie+Oracle 2026-08-06, docs/oracle_log.md) ──
# A taught Stage-0.5 total read has NO net-vs-gross discipline (template_mapper reads a fixed box /
# relocates off the literal "TOTAL" anchor), so on a variable-line-count credit note it can land on
# the "Net Total" row and commit the NET at high confidence. The two existing safeties both need the
# VAT line read correctly: _reconciliation_pick_total swaps only to a candidate that BALANCES, and the
# Stage-4 flag needs `tax` present. When VAT is absent/mis-read, `total_reconciles(net)` FALSELY
# balances (net ≈ subtotal + 0) so neither fires and the net auto-files silently. This pass catches
# exactly that gap WITHOUT relying on total_reconciles: it keys on "committed total ≈ subtotal (the net)
# AND a distinct, VAT-plausible, larger, confident total was also read" → cap + review note, NEVER swap
# (fail-toward-review; preserves the authoritative-anchor invariant — arithmetic/role rail, not learned
# shape). Byte-identical when OFF. Owner flip pending its own corpus false-flag gate (Oracle condition).
NET_MISREAD_TOTAL_FLAG = os.environ.get('NET_MISREAD_TOTAL_FLAG', '0') != '0'
_NET_MISREAD_MIN_CONF  = 70     # a corroborating gross candidate must be at least this confident
_NET_MISREAD_RATIO_LO  = 1.01   # gross/net band — VAT-plausible (≈5%..25% + rounding). Oracle: keep
_NET_MISREAD_RATIO_HI  = 1.30   # continuous + nearest-above; do NOT snap to {1.05,1.20} (mixed-rate baskets)
_NET_MISREAD_CAP       = 50     # cap a flagged net to review level (matches validator _RECONCILE_CAP)


def _net_misread_verdict(total, subtotal, candidates, tol):
    """PURE (Oracle SIGN-OFF-W/COND 2026-08-06). Returns (gross_float, candidate_dict) when the
    committed `total` looks like the NET/subtotal line AND a distinct larger VAT-plausible confident
    total also exists — else None. `total`/`subtotal` are parsed floats; `candidates` = [{'value',
    'confidence'}, …]. Keys on `total ≈ subtotal` + nearest-above VAT-plausible candidate — NOT
    total_reconciles, which spuriously balances net==subtotal when VAT is absent (the exact silent-
    commit case). A correct GROSS differs from the net by a real VAT > tol, so it fails step 2 and is
    never flagged; a zero-VAT doc (net==gross) has no larger candidate, so it is never flagged."""
    from extraction.validator import parse_amount
    if total is None or subtotal is None or total <= 0 or subtotal <= 0:
        return None
    if abs(total - subtotal) > tol:
        return None                       # total is NOT on the net line — a correct gross (protected)
    best = None                            # nearest-above VAT-plausible gross
    for c in (candidates or []):
        g = parse_amount(c.get('value'))
        if g is None or (c.get('confidence') or 0) < _NET_MISREAD_MIN_CONF:
            continue
        if g <= total + tol:
            continue                       # must be strictly larger than the net
        ratio = g / total
        if not (_NET_MISREAD_RATIO_LO <= ratio <= _NET_MISREAD_RATIO_HI):
            continue                       # implausible as a VAT gross (running balance / line-item)
        if best is None or g < best[0]:
            best = (g, c)                  # nearest-above = the gross, not a larger running balance
    return best


# ── Taught-read format-fail → keyword YIELD (DEFAULT OFF — gary+Oracle 2026-08-06) ──
# The owner's rule: teaching must never make a field WORSE than not teaching. Measured on the stable
# corpus, teaching HELPS most fields but HURTS total/po_ref: an authoritative Stage-0.5 template_mapping
# read lands on the wrong row / adjacent field / clips / garbles ("Account" for po_ref; "L922.14" for a
# total) yet keeps authoritative precedence over the CORRECT keyword read at the Stage-1 merge. This
# yields such a FORMAT-FAILING taught read to a confident, format-PASSING, disagreeing keyword read
# (swap + cap + review note — never silent). A VALID taught read passes _stage05_format_fails and never
# yields, so the teaching gains (ref/date/issuer) are untouched. The format-VALID net-line case is owned
# separately by NET_MISREAD_TOTAL_FLAG. Byte-identical when OFF.
TEMPLATE_FORMAT_FAIL_YIELD = os.environ.get('TEMPLATE_FORMAT_FAIL_YIELD', '0') != '0'
_FORMAT_FAIL_KW_FLOOR = 85   # REDESIGN 2026-08-09 (gary): 85 not 88 — the corpus challenger is a seeded
                             # inline label read at base 80 +5 (right direction) = 85; the old 88 stranded
                             # every such read (the po_ref 0-fire on the shapewarn cases). Below 85 is
                             # unlabelled-noise territory; the challenger already PASSES the hard pattern
                             # AND disagrees (via _cmp_norm), so the pattern is the quality gate, not this.


def _stage05_format_fails(value, key, val_type, field_patterns, validation_patterns):
    """PURE, DETERMINISTIC content-nature check (gary REDESIGN 2026-08-09 — supersedes the
    2026-08-06 shapewarn/learned-shape version, which GATE-FAILED: L1 trusted the `_shapewarn`
    TAG as 'wrong value', so a CORRECT taught ref shapewarn'd on a thin shape yielded to a
    LOOSE-`alphanumeric`-passing garbage keyword read — the ref −1.0 regression).

    True when a taught Stage-0.5 read demonstrably FAILS its field's FORMAT (landed on the wrong
    row / adjacent field / clipped-to-junk / garbled). Two independent legs:

      • REF-FAMILY — a reference/code field (…_number, …_no, an explicit "reference" field, OR a
        `…_ref` field like the corpus `po_ref`/`job_ref` that the global `_is_ref_field` misses).
        Judged by the HARD, DIGIT-BEARING, ANCHORED `reference_code` pattern — NOT the loose
        `alphanumeric` many ref fields default to (which `re.search`-passes any 3-char run:
        'Account'/'The'/'Tel 01632…' all slip through). 'Account'/'The'/prose FAIL (no digit /
        spaces); 'PO-56863'/'INV-2026-001' PASS. Belt-and-braces: a value that is itself a full
        numeric DATE also FAILS (a date-shaped keyword read must never be swapped into a ref).
        A clipped-but-code-shaped '24511'/'19979' still PASSES here (format-valid, wrong value) —
        that is a READ-layer error (taught box shifted), OUT of scope, accepted residual.

      • CURRENCY — a strict validity check the lenient substring credibility let through. Uses the
        pipeline's `parse_amount` + a strict leading-glyph guard (NOT a hand-rolled anglo regex)
        so '-£662.18'/'£-662.18'/continental/swiss PASS while 'L922.14'/'-3 5982.70' FAIL. A
        format-VALID net/bare total ('2', '£978.20') PASSES → left to NET_MISREAD_TOTAL_FLAG /
        accepted magnitude residual (out of scope — not a FORMAT failure).

    NO learned-shape veto and NO `_shapewarn`-tag trust (both dropped): the check is now purely a
    function of the VALUE's content nature — the CLAUDE.md-sanctioned category for applying a
    guard to an authoritative taught read (cf. date-in-ref / ref-length / prefix-outlier), never
    a learned-shape veto (which the authoritative-read invariant forbids). Date + name-like
    free-text are excluded by the CALLER's scope guard (they vary legitimately)."""
    v = str(value or "").strip()
    if not v:
        return True
    # REF-FAMILY — local predicate ALSO catches `…_ref` fields the global _is_ref_field misses
    # (po_ref/job_ref); deliberately NOT broadening _is_ref_field (~6 call sites incl. two
    # corroboration/override safety gates). Mirrors what _field_role already does for alphanumeric.
    if _is_ref_field(key) or (key or "").lower().endswith("_ref"):
        _rc = (validation_patterns or {}).get("reference_code")
        if _rc and not keyword._validate(v, _rc):          # fails the hard digit-bearing code pattern
            return True
        # a date-shaped value is never a ref (guards a date challenger being swapped into a ref role)
        if _NUM_DATE_RE.match(v) and validator.parse_date(v) is not None:
            return True
        return False
    if val_type == "currency" or (field_patterns or {}).get(key, {}).get("validation") == "currency":
        # leading glyph: optional symbol and/or sign then a DIGIT (rejects 'L922.14' the substring let by)
        if not re.match(r"^[£$€¥]?\s*[-–]?\s*[£$€¥]?\s*\d", v):
            return True
        if validator.parse_amount(v) is None:
            return True
        return False
    return False   # unknown structured field → no swap (fail-safe)


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
        self.length_index        = {}   # dominant ref digit-run profile per scope — S-B length guard (set_formats)
        self.noise_profile_index = {}   # populated by set_formats()
        self.format_class_index  = {}   # populated by set_formats()
        self.provisional_shape_index = {}   # consent-only taught skeletons (set_formats)
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
        self._field_candidates   = {}    # per-run candidate ledger — ALWAYS built (see _remember_candidates);
                                         # safety-load-bearing for the G1 veto-fallthrough corroboration arm (i):
                                         # do NOT re-gate it behind candidate_override
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

    @staticmethod
    def _should_shed_template_identity_note(sn_cur, issuer_band, *, env=None):
        """S1 decision (pure/static, unit-testable): may we shed the review note from a MAJORITY-tier
        template-identity fill? True iff — S1 armed (TEMPLATE_IDENTITY_BAND_GRADUATE!='0'), the issuer
        band is trusted (ISSUER_HINT_BAND!='0' — C2: never shed off the raw ocr_text[:600] fallback),
        `sn_cur` is a still-noted MAJORITY template_identity fill with a value, AND that value is
        STRICTLY corroborated in `issuer_band` (the caller's pre-computed _issuer_hint_band window).
        SINGLE-tier fills are deliberately never shed BY THIS BAND ARM (a band substring can be a
        recipient self-corroborating on a marker-free layout — the C2 hole; pin re-scoped 2026-07-31):
        the GEOMETRY-WITNESS arm (_should_shed_fill_note_geom, Oracle-signed) may shed EITHER tier,
        because its evidence is an independent geometry-only letterhead read, not a substring.
        `env` is injectable for tests. FAIL toward keeping the note."""
        _env = os.environ if env is None else env
        if _env.get("TEMPLATE_IDENTITY_BAND_GRADUATE", "0") == "0":
            return False
        if _env.get("ISSUER_HINT_BAND", "1") == "0":
            return False
        if not isinstance(sn_cur, dict) or sn_cur.get("method") != "template_identity":
            return False
        if sn_cur.get("validation_note") != _TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY:
            return False
        v = sn_cur.get("value")
        return bool(v) and _identity_corroborated_strict(v, issuer_band)

    @staticmethod
    def _should_shed_fill_note_geom(sn_cur, geom_issuer_norm, value_norm, *, env=None):
        """G decision (pure/static; 2026-07-31 gary→Oracle SIGN-OFF-W/COND; kill
        TEMPLATE_IDENTITY_GEOM_WITNESS, default ON — flipped after unit+probe gates; INDEPENDENT of the band arm's switch —
        Oracle G1): may the review note be shed from a template-identity fill because an INDEPENDENT
        geometry-only letterhead read (pick_issuer_geometry — largest top-of-page name, recipient
        excluded by size+position, two-candidate abstain; the SAME evidence class
        LOGO_NAME_PRESENCE_ACCEPT already trusts to let a logo assert un-noted) AGREES with the
        filled value? Tier-INDEPENDENT — a single-confirm supplier's page still prints its own
        letterhead; the band arm's single-never-sheds pin is about SUBSTRING evidence, not this.
        STRICT norm equality (caller passes _accept_norm(value) as `value_norm`): a token-superset
        letterhead ("Ironbridge Fabrication Ltd" vs confirmed "Ironbridge Fabrication") does NOT
        shed — pinned as a deliberate, measured limit (Oracle G5). FAIL toward keeping the note:
        no witness / abstain / disagree / switch off → False."""
        _env = os.environ if env is None else env
        if _env.get("TEMPLATE_IDENTITY_GEOM_WITNESS", "1") == "0":
            return False
        if not isinstance(sn_cur, dict) or sn_cur.get("method") != "template_identity":
            return False
        if sn_cur.get("validation_note") not in (_TEMPLATE_IDENTITY_FILL_NOTE_SINGLE,
                                                 _TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY):
            return False
        if not sn_cur.get("value") or not geom_issuer_norm or not value_norm:
            return False
        return value_norm == geom_issuer_norm

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
        admin label. This is what preserves the committed precedence guarantees.
        ⚠ ONE named, predicate-bound carve-out exists OUTSIDE this gate (Oracle 2026-08-04):
        _reconcile_name_truncation may rewrite a Stage-0.5 free-text winner's VALUE — justified
        solely by C3 page-absence (the drawn box's remnant is provably not printed on the page)
        + a keyword+crop token-identical witness pair. It is NOT precedent for broad Stage-0.5
        rewrites; do not add exceptions here."""
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

    def _build_corroboration_emit(self, results):
        """OWNER PRINCIPLE (2026-08-11): "the rungs should CORROBORATE, not merely compete."
        Per committed field, which INDEPENDENT method families read the same value — a derived,
        record-only read of the per-run candidate ledger. Commits nothing, vetoes nothing.

        INDEPENDENCE IS METHOD FAMILY, NEVER A WITNESS COUNT. Same-pixel agreement is worthless
        (Oracle 2026-08-03: 5:1 false:true; re-proved 2026-08-11 when two preps agreed on the wrong
        P1), so buckets come from `_crosscheck_witness_bucket` — the Oracle-ratified grouping that
        already excludes the independence frauds (anchor_registration, bare `anchor` = the same
        full-page line the keyword pass reads). A winner whose method is EXCLUDED from bucketing can
        never claim `independent_agree` (its would-be corroborators may share its pixels) — but a
        bucketed candidate DISAGREEING with it is still recorded, because that is information in
        either direction. Caveat, stated: `template_fixed` buckets into the mapping family, so its
        record reads as memory-vs-page rather than crop-vs-page — for a RECORD that is the honest
        framing (the Oakhaven leak's stamped VAT vs the page's own printed VAT is exactly this row).

        Kill: FIELD_CORROBORATION_EMIT=0 (metadata only, default on)."""
        if os.environ.get('FIELD_CORROBORATION_EMIT', '1') == '0':
            return {}

        # ORACLE C1 (2026-08-11): `template_fixed` is a MEMORY stamp — no pixels at all — and the
        # shared bucket folds every template* into the mapping family, which would suppress BOTH the
        # most valuable agreement (this page's own taught-box read corroborates the memory) AND the
        # most valuable disagreement (the frozen stamp contradicted by the page — the Oakhaven VAT
        # class) as "same family". Special-cased HERE ONLY: `_crosscheck_witness_bucket` itself is
        # shared with the LIVE crosscheck-outlier reconcile and must not be re-tuned by a record.
        _MEMORY_METHODS = ('template_anchor', 'template_identity', 'template_identity_corroborated')

        def _corrob_bucket(stage, method):
            m = str(method or '')
            if m.startswith('template_fixed') or m in _MEMORY_METHODS:
                return ('memory', False)
            return _crosscheck_witness_bucket(stage, method)

        out = {}
        for key, data in results.items():
            if key.startswith('_') or not isinstance(data, dict):
                continue
            val = data.get('value')
            if val in (None, ''):
                continue
            win_norm = _cmp_norm(val)
            method = str(data.get('method') or '')
            win_bucket = _corrob_bucket(None, method)
            win_family = win_bucket[0] if win_bucket else _method_family(method)
            agree, disagree = set(), {}
            for c in (self._field_candidates.get(key) or []):
                b = _corrob_bucket(c.get('stage'), c.get('method'))
                if not b:
                    continue
                fam = b[0]
                if fam == win_family:
                    continue          # same family = same pixels/recipe — counts for NOTHING
                cv = c.get('value')
                if cv in (None, ''):
                    continue
                if _cmp_norm(cv) == win_norm:
                    if win_bucket is not None:
                        agree.add(fam)
                else:
                    disagree.setdefault(fam, str(cv))
            out[key] = {
                'winner_family': win_family,
                'agree': sorted(agree),
                # a family with two candidates, one agreeing and one not, counts as agreement —
                # its differing read stays out of `disagree` so the record never contradicts itself
                'disagree': [{'family': f, 'value': v}
                             for f, v in sorted(disagree.items()) if f not in agree],
                'independent_agree': bool(agree),
            }
        return out

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
    def _brief(d, field_key=None):
        if not isinstance(d, dict):
            return None
        out = {"method": d.get("method"), "value": d.get("value"),
               "confidence": d.get("confidence")}
        # The matched caption rides along ONLY when the caller knows the field key, because
        # that is what lets `_caption` suppress Stage 0.5's field-key fallback. `_t` briefs the
        # `vs` dict WITHOUT a key, so that payload keeps its exact three-key shape.
        if field_key is not None:
            cap = ExtractionEngine._caption(d, field_key)
            if cap:
                out["caption"] = cap
        return out

    @staticmethod
    def _caption(d, field_key=None):
        """The PRINTED CAPTION a rung matched, for the dev trace only (owner request
        2026-08-09: "I would like to see the winning keyword so I know what the app
        used to derive the value"). Read from the rung's OWN result key — Stage 1
        records it as `label` (keyword.py:1204), Stage 0.5 and Stage 2 as `anchor`
        (`_mapping_result`, anchor.py:1571) — never re-derived here, so the trace can
        only ever show what the rung itself recorded.

        Stage 0.5 passes `mapping.get("anchor_text") or field_key`, so a mapping with
        NO taught label carries the FIELD KEY in that slot. That is not a caption and
        is suppressed: showing `matched 'po_ref'` would invent a printed line that is
        not on the page. Returns None when there is nothing honest to show."""
        if not isinstance(d, dict):
            return None
        cap = d.get("label") or d.get("anchor")
        cap = str(cap).strip() if cap is not None else ""
        if not cap:
            return None
        if field_key and cap.lower() == str(field_key).strip().lower():
            return None
        return cap

    def _snap(self, results: dict) -> dict:
        """Shallow per-field snapshot (method/value/confidence) of resolved fields."""
        return {k: self._brief(v, k) for k, v in results.items()
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
            # target_geom (dev-trace only) is the box the WINNING rung actually READ — a
            # relocate/registration/edge rung carries its OWN box here, not the abs box. Emit it
            # so the SFDEV console can show the exact crop this candidate was read from (matched by
            # bbox) instead of the first same-stage capture (the abs box), which mislabels a
            # relocated/footer read. Absent off-trace ⇒ inert.
            _geom = cand.get("target_geom")
            _cap = self._caption(cand, key)
            self._t("candidate", stage=stage, field=key, method=cand.get("method"),
                    value=cand.get("value"), confidence=cand.get("confidence"), geom=_geom,
                    caption=_cap)
            after = results.get(key)
            won = (self._merge_outcome(cand, after) == "won")
            self._t("merge", stage=stage, field=key,
                    decision=("win" if won else "lose"),
                    method=cand.get("method"), value=cand.get("value"),
                    confidence=cand.get("confidence"), geom=_geom,
                    caption=_cap,
                    vs=(pre.get(key) if won else after))
        self._t("stage_end", stage=stage)

    # ── Static merge-outcome predicate (SHARED by _trace_stage + _trace_steps) ──
    # SINGLE source of the win/lose decision so the every-step ladder can NEVER
    # disagree with the per-stage `merge` event. Caller MUST test cand truthiness
    # FIRST: Stage 0 copies template seeds BY REFERENCE (results[key] IS the seed),
    # so for a {value:None} seed `after IS cand` and this returns 'won' trivially —
    # the None value must be filtered by the caller before this is consulted.
    @staticmethod
    def _merge_outcome(cand, after):
        won = bool(after and after.get("value") == cand.get("value")
                   and after.get("method") == cand.get("method"))
        return "won" if won else "lost"

    # Per-stage no-candidate / skip reason strings — constants, not f-strings built
    # at the call site. The SKIP reason is the diagnostic datum the owner asked for
    # ("show the RESULT OF EVERY STEP so an error can be read without re-running").
    _STEP_SKIP_NO_TEMPLATE   = "no template matched this document"
    _STEP_SKIP_NO_MAPPINGS   = "this template has no field mappings"
    _STEP_SKIP_NO_PAGE_IMAGE = "no page image available to crop"
    _STEP_SKIP_NO_ANCHORS    = "no anchors learned for this supplier + type"
    _STEP_NO_CAND_REASON = {
        "0_template":  "template matched but produced no value for this field",
        "0.5_mapping": "no anchor→target mapping for this field",
        "1_keyword":   "no keyword pattern matched this field",
        "2_anchor":    "no anchor produced a value for this field",
    }

    def _trace_steps(self, stage, ran, skip_reason, stage_results, pre, results, field_keys):
        """Dev-only every-step ladder: emit ONE `step` event per CONFIGURED field
        for a read stage, so the inspector can render the outcome of EVERY stage —
        not just the winners. outcome in
        won | lost | no_candidate | already_resolved | skipped.

        Pure observation — NEVER writes results/pre/stage_results. No-op unless
        tracing (byte-identical off path). Discriminator is value-TRUTHINESS FIRST
        (a {value:None} seed is `no_candidate`, never a false `won`), then the
        shared `_merge_outcome`. `ran=False` emits a `skipped` row for every field
        with the gate's reason — call it from OUTSIDE the stage gate so a gated-OFF
        stage is visible on the ladder instead of silently absent. `already_resolved`
        states STATE ("already held a value from X before this stage"), never a
        DECISION this vantage cannot see ("skipped because credible")."""
        if not self._trace:
            return
        for f in field_keys:
            if not ran:
                self._t("step", stage=stage, field=f, outcome="skipped", reason=skip_reason)
                continue
            cand = stage_results.get(f)
            cand_v = (cand or {}).get("value")
            if cand_v:                                   # value-truthiness FIRST (SEAM 3b)
                _out = self._merge_outcome(cand, results.get(f))
                _kw = {}
                if _out == "lost":
                    # STATE, not a CAUSE (Oracle no-overclaim 2026-08-03): name what currently
                    # HOLDS the field so the ladder shows why this rung didn't win — the owner's
                    # "the taught anchor read PO-17039 but lost" case — without asserting a reason
                    # (higher confidence / authority) this vantage can't verify.
                    _held = results.get(f) or {}
                    _hv = _held.get("value")
                    if _hv:
                        # The HOLDER's caption is the payoff of the whole feature: a lost rung
                        # is usually lost to a rung that answered a DIFFERENT printed line, and
                        # "kept 'X' from keyword (matched 'Account No')" is the diagnosis.
                        _hcap = self._caption(_held, f)
                        _kw["reason"] = (f"kept '{_hv}' from {_held.get('method') or 'an earlier stage'}"
                                         + (f" (matched '{_hcap}')" if _hcap else ""))
                self._t("step", stage=stage, field=f, outcome=_out,
                        value=cand_v, method=cand.get("method"),
                        confidence=cand.get("confidence"),
                        caption=self._caption(cand, f), **_kw)
                continue
            pre_f = pre.get(f) or {}
            pre_v = pre_f.get("value")
            if pre_v:
                by = pre_f.get("method") or "an earlier stage"
                self._t("step", stage=stage, field=f, outcome="already_resolved",
                        # `pre` is a BRIEFED snapshot (`_snap`), which already carries the
                        # suppressed caption under its own key — the raw `label`/`anchor` keys
                        # `_caption` reads are not in it. Fall back for callers that pass raw
                        # result dicts (the unit harnesses do).
                        value=pre_v, by=pre_f.get("method"),
                        caption=(pre_f.get("caption") or self._caption(pre_f, f)),
                        reason=f"already held a value from {by} before this stage")
            else:
                self._t("step", stage=stage, field=f, outcome="no_candidate",
                        reason=self._STEP_NO_CAND_REASON.get(stage, "no candidate produced"))

    def _capture_slice(self, field, stage, page, bbox, pil_img, kind="target", tag=None):
        """Dev-only: save the exact crop used for an OCR attempt to the session
        temp dir and emit a typed `slice` trace event pointing at it. `kind` is
        'anchor' (the region used to find/verify the anchor) or 'target' (the
        region OCR'd for the field value); `tag` names WHICH read produced the
        crop (e.g. 'absolute box' vs 'derived offset') so two same-kind crops of
        one field are distinguishable in the trace console. No-op unless a trace
        callback AND a slice dir are set. Never raises into extraction."""
        if not (self._trace and self._slice_dir):
            return
        try:
            import os
            self._slice_n += 1
            path = os.path.join(self._slice_dir, f"slice_{self._slice_n}_{kind}.png")
            pil_img.save(path)
            self._t("slice", field=field, stage=stage, kind=kind, page=page,
                    bbox=(list(bbox) if bbox else None), path=path, tag=tag)
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

    def _make_provisional_lookup(self, supplier_name, document_slug):
        """CONSENT-ONLY provisional-skeleton lookup (Oracle NIGHT 2026-08-03, S2): closure
        (field_key, value) -> bool, True iff the value's canonical skeleton matches a
        provisionally-taught (sub-≥3-confirm) skeleton for the scope. Consumed EXCLUSIVELY
        by template_mapper._shape_consents' ladder — never by any veto/flag path."""
        if not self.provisional_shape_index or not document_slug:
            return None
        s = (supplier_name or '').lower().strip()
        d = document_slug.lower().strip()

        def lookup(fk, value):
            sks = (self.provisional_shape_index.get((s, d, fk)) if s else None) \
                  or self.provisional_shape_index.get(('', d, fk))
            return format_anomaly_checker.provisional_shape_accepts(value, sks)
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
        # PROVISIONAL rows (below the ≥3-confirm bar, tagged by learning.js — Oracle NIGHT
        # 2026-08-03 S2) are stripped BEFORE any established builder sees them: every veto/
        # correct/snap index keeps its exact pre-provisional input. They feed ONLY the
        # separate consent-only skeleton index (provisional_shape_index), consumed solely by
        # the mapper's clean-commit consent ladder. Pinned in test_template_frag_clip.py.
        _solid = [e for e in (formats_data or [])
                  if not (isinstance(e, dict) and e.get('provisional'))]
        self.format_index        = ocr_corrector.build_format_index(_solid)
        self.noise_profile_index = ocr_corrector.build_noise_profile_index(_solid)
        self.dominant_index      = ocr_corrector.build_dominant_index(_solid)
        self.known_index         = ocr_corrector.build_known_index(_solid)
        self.prefix_index        = ocr_corrector.build_prefix_index(_solid)
        self.length_index        = ocr_corrector.build_length_index(_solid)   # S-B ref digit-run profiles
        self.format_class_index  = format_anomaly_checker.build_format_class_index(_solid)
        self.provisional_shape_index = format_anomaly_checker.build_provisional_shape_index(formats_data)
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
            shadow = keyword.extract_fields(ocr_text, uncovered, patterns, trace=self._t) or {}
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
                # Customer-facing copy (owner 2026-07-31, same pass as the un-named veto note):
                # no "template" jargon. "page branding reads" + "confirm the correct company"
                # are LOAD-BEARING markers (test_logo_detail_sparse_guard, logo_identity_suite,
                # test_suggested_supplier_persist, renderer isBrandingFlag) — keep both.
                note = (f"The page branding reads '{named}', but this document looks similar to "
                        f"paperwork from '{supplier_name}' — so the sender was left blank. "
                        "Please confirm the correct company.")
        else:
            note = (f"This document's letterhead doesn't match '{supplier_name}'. "
                    "Please confirm the correct company.")
            # TEMPLATE_FIXED_NAME_PRESENCE_VETO (2026-07-31; gary + Oracle SIGN-OFF-W/COND) — the
            # UN-NAMED twin of BRANDING_NAMED_BLANK for the Ironbridge-as-Copperfield class: a
            # phash/keyword collision seeds a FROZEN template_fixed supplier stamp on a stranger's
            # page, the rival can't be NAMED (a new supplier has no template bank), and the wrong
            # prefill stood at 69 — one confirm-keystroke from GT-poison. When the stamped supplier
            # reliably PRINTS its own name (the learned per-supplier ratio threaded in via the
            # templates payload's supplier_prints_name — database/modules/templates.js getAll,
            # computed by namePresence.supplierNamePresenceRatio) but the name is ABSENT from THIS
            # page (fuzzy: _template_identity_corroborated's >=60%-distinctive-tokens check), BLANK
            # the stamp instead of keeping it. Destructive-gate prerequisites, fail-toward-keep at
            # every doubt (mirrors namePresence.nameBearingButAbsent, Oracle 2026-07-24):
            #   * method 'template_fixed' EXACTLY — template_fixed_locked is deliberate admin
            #     intent, stays flag-only (same pinned rationale as BRANDING_NAMED_BLANK above);
            #     covers BOTH stamp paths (template_matcher seed + _doctype_fixed_supplier).
            #   * _identity_text_sufficient — the C2 floor: a failed/thin scan is UNJUDGEABLE,
            #     never "name absent" (the flag above never needed the floor; the blank does).
            #   * stats missing (old payload / no fixed-supplier template) → keep: byte-identical
            #     backward compat. count/ratio floors shared with the JS twin via the SAME env keys.
            #   * a corroborated name (>=60% distinctive tokens on page) keeps today's flag+69.
            # PIN: this branch must NEVER emit fld['suggested_supplier'] — the un-named veto has no
            # candidate, and arming the renderer's "Use '<name>'" button here would hand the user a
            # one-click WRONG answer (Oracle condition 3).
            if (fld.get("method") == "template_fixed"
                    and os.environ.get("TEMPLATE_FIXED_NAME_PRESENCE_VETO", "1") != "0"
                    and _identity_text_sufficient(ocr_text)):
                _stats = _prints_name_stats(templates, self._accept_norm).get(
                    self._accept_norm(supplier_name))
                try:
                    _min_n = int(os.environ.get("TEMPLATE_NAME_PRESENCE_MIN_SAMPLE", "3"))
                    _min_r = float(os.environ.get("TEMPLATE_NAME_PRESENCE_RATIO", "0.80"))
                except ValueError:
                    _min_n, _min_r = 3, 0.80
                if (_stats and _stats[1] >= _min_n and _stats[0] >= _min_r
                        and not _template_identity_corroborated(supplier_name, ocr_text)):
                    _blank = True
                    # Customer-facing copy (owner + bob 2026-08-01, superseding the 07-31
                    # lookalike wording): NO rejected-candidate name — printing "looks similar
                    # to '<supplier>'" under the field ANCHORED the operator toward the very
                    # name the veto had just refused (a wrong confirm then poisons that
                    # supplier's learning scope), and read as a confession in the common
                    # genuinely-new-sender case. Neutral, action-first instead. The NOTE OBJECT
                    # itself is LOAD-BEARING and must never be dropped (its presence on the
                    # empty row is the REPROCESS_ANNOTATED_EMPTY_WINS discriminator — a bare
                    # empty resurrects the stale value on reprocess); "couldn't be confirmed"
                    # + "confirm the correct company" are the pinned markers
                    # (test_template_fixed_name_presence.py + the renderer's isBrandingFlag
                    # regex) — keep both in any rewording.
                    note = ("The sender's name couldn't be confirmed on this page. Please "
                            "confirm the correct company — it's usually printed at the top "
                            "of the document.")
        existing = str(fld.get("validation_note") or "").strip()
        fld["validation_note"] = (existing + " " + note).strip() if existing else note
        fld["confidence"] = min(int(fld.get("confidence") or 100), 69)
        if _blank:
            fld["value"] = None
            fld["confidence"] = 0
            results["_supplier_name"] = None
        results["_needs_review"] = True

    def _refuse_caption_values(self, results, caption_vocab, field_defs):
        """Withhold a committed value that IS one of the page's printed CAPTIONS.

        Default OFF (CAPTION_VALUE_REFUSE=1 arms); OFF returns immediately and is byte-identical.

        SCOPE, and every exclusion is load-bearing:
          * the IDENTITY fields are excluded — a company name is judged by the branding guards, which
            know about banks and letterheads; this rule knows only about captions, and 'Statement Ltd'
            is a real company;
          * a value the OPERATOR corrected is excluded — they typed it, it is not our guess;
          * everything else is in scope regardless of HOW it was read. A taught box reading its own
            caption arrives with the highest authority in the system and is exactly the defect.
        """
        if os.environ.get('CAPTION_VALUE_REFUSE', '0') == '0' or not caption_vocab:
            return
        for key, d in list(results.items()):
            if key.startswith('_') or not isinstance(d, dict):
                continue
            if key in _IDENTITY_FIELD_KEYS:
                continue
            val = d.get('value')
            if not val or d.get('was_corrected'):
                continue
            if not keyword.value_is_caption(val, caption_vocab):
                continue
            self.log(f"  Caption refused: {key} read the page's own wording '{val}'")
            self._t('caption_value_refused', field=key, value=val,
                    method=d.get('method'), confidence=d.get('confidence'))
            d['value'] = None
            d['confidence'] = 0
            _note = ("This looks like the wording printed on the page rather than a value. "
                     "Please check the document and fill it in if it is there.")
            _existing = str(d.get('validation_note') or '').strip()
            d['validation_note'] = (_existing + ' ' + _note).strip() if _existing else _note
            results['_needs_review'] = True

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

    def _reconcile_clipped_suffix(self, results, field_defs, supplier_name, document_slug):
        """CLIPPED-SUFFIX RECONCILIATION (Oracle amended verdict 2026-07-31; kill switch
        CANDIDATE_SUFFIX_RECONCILE, default ON — flipped same day after the full gate set:
        OFF byte-identical to baseline; ON heals #121/123/124/136/137, ref 91.8→94.5%,
        M 8→7 with ZERO new members, flags unchanged). A label-confirmed anchor read
        (anchor_registration / anchor_crop_relocated / anchor_inline — the shape-EXEMPT set,
        see :4692 and anchor._LABEL_CONFIRMED_METHODS) can win a ref/code field with a value
        whose LEADING glyphs a misplaced crop cut off ('V-69523', the #121 class: the
        registration transform landed the box ~76px right of the value start), while the
        DISCARDED Stage-1 keyword read of the SAME token held the full value ('INV-69523').
        The shape exemption is deliberate (variable codes must not be shape-vetoed), so no
        downstream gate can see the clip — it files silently at 90+. Reconcile from the
        always-on candidate ledger instead of any new OCR:
          winner fails its OWN-SUPPLIER learned shape
          + a '1_keyword' candidate is the same token read more completely (strict alnum
            suffix; alpha-only completion 1-3 chars; digit subsequence byte-identical)
          + the debris-stripped candidate PASSES that shape
          + the completed prefix is a CONFIRMED in-scope prefix (ocr_corrector.
            prefix_confirmed — membership with real support, never similarity)
          -> ADOPT the fuller value, keeping the winner's method/tier/confidence (no note:
             this is two independent same-render mechanisms agreeing on the digits, the
             corroboration bar Oracle set; the realdoc M gate arbitrates fileability).
        Prefix unconfirmed / no prefix record -> FLAG-only (cap 69 + note, review-bound —
        fail toward review). Runs BEFORE _flag_prefix_outlier so the healed value is what
        that guard judges. Encroachment (audited 2026-07-31): the merge loop is untouched;
        nothing is nulled/capped on shape opinion alone (the flag lane requires the fuller
        agreeing read as EVIDENCE); one-note-per-field respected in both directions; NO
        corrected_to is emitted (the reprocess merge treats corrected_to as operator-grade
        — deliberately never entered). Pinned residual: '1V-69523' (digit-bearing
        completion) is NOT healed — widening to digit completions would let a hallucinated
        leading digit rewrite a real code (tests/test_suffix_reconcile.py). Best-effort:
        never breaks extraction."""
        if os.environ.get('CANDIDATE_SUFFIX_RECONCILE', '1') == '0':   # default ON (flipped 2026-07-31 after gates); =0 kills
            return
        try:
            from extraction import suffix_reconcile
            from extraction.value_quality import is_name_like_field
            _skip_types = {'date', 'currency', 'number', 'percentage', 'email', 'iban', 'vat_gb',
                           'postcode_uk', 'ip_address', 'mac_address', 'currency_code', 'website'}
            type_by_key = {f.get('key'): (f.get('type') or '').lower() for f in (field_defs or [])}
            s_lower  = (supplier_name or '').lower().strip()
            dt_lower = (document_slug or '').lower().strip()
            if not s_lower:
                return                  # own-supplier shapes only — never a ('') cross-supplier verdict
            for key, data in results.items():
                if key.startswith('_') or not isinstance(data, dict):
                    continue
                val = data.get('value')
                if not val or is_name_like_field(key) or type_by_key.get(key) in _skip_types:
                    continue
                if str(data.get('method') or '') not in anchor._LABEL_CONFIRMED_METHODS:
                    continue            # v1 scope = exactly the shape-exempt stage-2 set
                if str(data.get('validation_note') or '').strip() or data.get('corrected_to'):
                    continue            # one note per field — another stage already spoke
                fmt_entry = self.format_class_index.get((s_lower, dt_lower, key))
                if not fmt_entry or not fmt_entry.get('shapes'):
                    continue
                if not format_anomaly_checker.check_value(str(val), fmt_entry):
                    continue            # winner passes its own shape — nothing to reconcile
                rec = ocr_corrector.lookup_prefix(self.prefix_index, key, supplier_name, document_slug)
                lane = None
                fuller = None
                for cand in (self._field_candidates.get(key) or []):
                    if cand.get('stage') != '1_keyword':
                        continue        # independent full-page read only (same-eye anchor stages excluded)
                    cv = str(cand.get('value') or '')
                    if suffix_reconcile.clip_completion(val, cv) is None:
                        continue
                    # Debris-strip the candidate's EDGES only ('. INV-69523' -> 'INV-69523'):
                    # the shape check and code_prefix both reject on leading page junk.
                    clean = suffix_reconcile.edge_strip(cv)
                    if not clean or format_anomaly_checker.check_value(clean, fmt_entry):
                        continue        # candidate itself fails the shape — no corroboration
                    verdict = suffix_reconcile.classify(val, cv, clean, rec,
                                                        ocr_corrector.prefix_confirmed,
                                                        ocr_corrector.code_prefix)
                    if verdict and verdict[0] == 'adopt':
                        lane, fuller = 'adopt', verdict[1]
                        break           # adopt beats flag
                    if verdict and lane is None:
                        lane, fuller = 'flag', clean
                if lane == 'adopt':
                    self._t('suffix_reconcile', field=key, was=str(val), now=fuller,
                            method=data.get('method'))
                    self.log(f"  Clip reconcile: {key} '{val}' -> '{fuller}' "
                             f"(fuller keyword read of the same number)")
                    results[key] = {**data, 'value': fuller, 'display_value': fuller,
                                    'suffix_reconciled': True}
                elif lane == 'flag':
                    self._t('suffix_reconcile_flag', field=key, value=str(val), fuller=fuller)
                    results[key] = {**data,
                                    'confidence': min(int(data.get('confidence') or 0), 69),
                                    'validation_note': 'this may be missing its first letters — '
                                                       'a fuller read of the same number was also '
                                                       'seen; please verify'}
        except Exception:
            pass   # advisory reconciliation — must never break extraction

    # ── S-C: BLIND-GEOMETRY DISAGREEMENT RECONCILIATION (Oracle SIGN-OFF-W/COND 2026-08-01;
    # kill BLIND_GEOM_DISAGREE_RECONCILE, ships DARK =0 — flip is the OWNER's call after gates).
    # The #141 class: an operator-taught anchor resolved via the REGISTRATION rung wins Tier-A
    # by fiat (`located` by method membership, confidence never consulted, ocr_min_conf None for
    # structured fields) even though the label evidence contradicted the geometry — '21/07/2026'
    # @83 beat keyword_override '. DN-24408'@93 AND template_mapping 'DN-24408'@90. This pass is
    # the symmetric completion of two signed doctrines: KEYWORD_ANCHOR_CORROB already rules
    # anchor_registration INADMISSIBLE as a corroboration witness ("blind geometry — an
    # independence fraud"), and the prefix guard already refuses taught-anchor exemption ("the
    # teach fixed the position, not the value"). A method inadmissible as a witness cannot
    # silently OVERRULE two admissible witnesses.
    #   ADOPT: >=2 DISTINCT-stage-family witnesses (0_template / 0.5_mapping / 1_keyword —
    #   pinned: two same-family candidates never count) agree normalise-equal on one
    #   shape-PASSING value -> restore that value NON-authoritatively (witness method +
    #   blind_geom_reconciled marker, confidence <= max witness conf, never boosted).
    #   FLAG: exactly one witness -> keep the winner's value, cap 69 + a note naming BOTH
    #   values (fail toward review with a reason; untouched would preserve a silent wrong file).
    # v1 scope: winner method == 'anchor_registration' EXACTLY. PINNED EXCLUSIONS: anchor_inline
    # / anchor_crop_relocated winners are untouched (their label was genuinely found on-page —
    # the 2026-07-26 Tier-A re-teach fix depends on it); rigid anchor_crop is already
    # shape-gated. Fill-empty stays intact (no disagreeing candidate -> inert). ORDER (pinned in
    # tests): suffix-reconcile -> S-C -> S-A date flag -> prefix-outlier -> S-B length guard —
    # S-C before S-A so a reconciled value is judged, not the stale date.
    def _reconcile_blind_geometry(self, results, field_defs, supplier_name, document_slug):
        # Default ON (owner-flipped 2026-08-01 after the full gate ladder: #141/#142 healed on
        # real pixels, M pinned set zero new members, flags-delta 0). =0 kills.
        if os.environ.get('BLIND_GEOM_DISAGREE_RECONCILE', '1') == '0':
            return
        try:
            from extraction import suffix_reconcile
            from extraction import text_normalise as _tn
            from extraction.value_quality import is_name_like_field
            _skip_types = {'date', 'currency', 'number', 'percentage', 'email', 'iban', 'vat_gb',
                           'postcode_uk', 'ip_address', 'mac_address', 'currency_code', 'website'}
            type_by_key = {f.get('key'): (f.get('type') or '').lower() for f in (field_defs or [])}
            s_lower  = (supplier_name or '').lower().strip()
            dt_lower = (document_slug or '').lower().strip()
            if not s_lower:
                return                  # own-supplier shapes only
            _WITNESS_STAGES = {'0_template', '0.5_mapping', '1_keyword'}
            for key, data in results.items():
                if key.startswith('_') or not isinstance(data, dict):
                    continue
                val = data.get('value')
                if not val or is_name_like_field(key) or type_by_key.get(key) in _skip_types:
                    continue
                if str(data.get('method') or '') != 'anchor_registration':
                    continue            # v1: the fiat-located method EXACTLY (pinned)
                if str(data.get('validation_note') or '').strip() or data.get('corrected_to'):
                    continue            # one note per field
                fmt_entry = self.format_class_index.get((s_lower, dt_lower, key))
                if not fmt_entry or not fmt_entry.get('shapes'):
                    continue
                if not format_anomaly_checker.check_value(str(val), fmt_entry):
                    continue            # winner passes its own scope shape — nothing to arbitrate
                win_norm = _tn.normalise_for_tokens(str(val))
                # Gather shape-PASSING, normalise-DIFFERING witnesses by normalised value.
                by_value = {}
                for cand in (self._field_candidates.get(key) or []):
                    stage = str(cand.get('stage') or '')
                    if stage not in _WITNESS_STAGES:
                        continue
                    cv = suffix_reconcile.edge_strip(str(cand.get('value') or ''))
                    if not cv:
                        continue
                    cn = _tn.normalise_for_tokens(cv)
                    if not cn or cn == win_norm:
                        continue
                    if format_anomaly_checker.check_value(cv, fmt_entry):
                        continue        # witness must itself pass the scope shape
                    ent = by_value.setdefault(cn, {'families': set(), 'best': None})
                    ent['families'].add(stage)
                    c = int(cand.get('confidence') or 0)
                    if ent['best'] is None or c > int(ent['best'].get('confidence') or 0):
                        ent['best'] = {'value': cv, 'method': cand.get('method'), 'confidence': c}
                if not by_value:
                    continue
                # Prefer the value with the MOST distinct families, then highest witness conf.
                cn, ent = max(by_value.items(),
                              key=lambda kv: (len(kv[1]['families']),
                                              int(kv[1]['best'].get('confidence') or 0)))
                w = ent['best']
                if len(ent['families']) >= 2:
                    self._t('blind_geom_reconcile', field=key, was=str(val), now=w['value'],
                            families=sorted(ent['families']))
                    self.log(f"  Blind-geometry reconcile: {key} '{val}' -> '{w['value']}' "
                             f"({len(ent['families'])} independent reads agree)")
                    results[key] = {
                        **data,
                        'value':         w['value'],
                        'display_value': w['value'],
                        'method':        w.get('method') or data.get('method'),
                        # Oracle tightening: the adopted confidence is the best WITNESS's own —
                        # never synthetically boosted above what any witness actually scored.
                        'confidence':    int(w.get('confidence') or 0),
                        'authoritative': False,
                        'blind_geom_reconciled': True,
                    }
                else:
                    self._t('blind_geom_flag', field=key, value=str(val), witness=w['value'])
                    results[key] = {
                        **data,
                        'confidence':      min(int(data.get('confidence') or 0), 69),
                        'validation_note': (f"this read '{val}', but another check read "
                                            f"'{w['value']}' — please pick the right value"),
                    }
        except Exception:
            pass   # advisory reconciliation — must never break extraction

    # ── S-A: DATE-SHAPED VALUE IN A REFERENCE FIELD (Oracle SIGN-OFF-W/COND 2026-08-01;
    # kill DATE_IN_REF_FLAG — default ON after its gate). Deterministic content-nature check,
    # the #141/#142 backstop for ANY source: a ref-role/code field whose committed value FULLY
    # parses as a calendar date is evidence the read landed on the wrong row. Flag-only (cap 69
    # + note — the validation_note is the ONLY floor-independent auto-file block, incl. at 100),
    # NEVER null. Belt: parse_date alone is too permissive an anchor for a guard, so the value
    # must ALSO be a full-string numeric 3-component date (SAME separator repeated) or a
    # month-name date — '20260731', '21/07' and 'DN-24/07/26' stay safe (pinned).
    # Exempt: manual/template_fixed methods (human-set literals) and a scope whose OWN learned
    # shape accepts the value (a supplier whose refs genuinely look like dates self-disarms as
    # history accrues — the '12.05.11' pinned trade-off flags only until confirmed).
    # DELIBERATE ASYMMETRY (Oracle-ruled, pinned): keyword_override is NOT exempt — unlike
    # _flag_prefix_outlier's exemption set, because the override is authority over the LABEL
    # position; the VALUE is still an OCR read. Do not "harmonise" the two exemption sets.
    def _flag_date_shaped_ref(self, results, field_defs, supplier_name, document_slug):
        # Default ON (flipped 2026-08-01 after its realdoc gate: EXACTLY #141/#142 silent→flagged,
        # zero other deltas, accuracy identical). =0 kills.
        if os.environ.get('DATE_IN_REF_FLAG', '1') == '0':
            return
        try:
            from extraction.value_quality import is_name_like_field
            type_by_key = {f.get('key'): (f.get('type') or '').lower() for f in (field_defs or [])}
            s_lower  = (supplier_name or '').lower().strip()
            dt_lower = (document_slug or '').lower().strip()
            for key, data in results.items():
                if key.startswith('_') or not isinstance(data, dict):
                    continue
                val = str(data.get('value') or '').strip()
                if not val or is_name_like_field(key):
                    continue
                ftype = type_by_key.get(key)
                if ftype == 'date' or key.endswith('_date') or key == 'date':
                    continue            # date roles/fields are exactly where dates belong
                if not (_is_ref_field(key) or ftype in ('reference_code', 'reference')):
                    continue
                method = str(data.get('method') or '')
                if 'manual' in method or 'template_fixed' in method:
                    continue            # human-set literal — not an OCR read
                if str(data.get('validation_note') or '').strip():
                    continue            # one note per field (S-C spoke first if it fired)
                if not (_NUM_DATE_RE.match(val) or _NAME_DATE_RE.match(val)):
                    continue
                if validator.parse_date(val) is None:
                    continue            # belt AND parser must both agree it is a real date
                fmt_entry = self.format_class_index.get((s_lower, dt_lower, key)) if s_lower else None
                if fmt_entry and not format_anomaly_checker.check_value(val, fmt_entry):
                    continue            # the scope's OWN learned class/shape accepts this — a
                                        # supplier whose refs genuinely look like dates self-disarms
                data['confidence'] = min(int(data.get('confidence') or 0), 69)
                data['validation_note'] = ('this looks like a date, but this field expects a '
                                           'reference — please check which value belongs here')
                self._t('date_in_ref_flag', field=key, value=val, method=method)
                self.log(f"  Date-in-ref guard: {key} read {val!r} ({method}) — flagged for review")
        except Exception:
            pass   # advisory guard — must never break extraction

    # ── S-B: REF DIGIT-RUN LENGTH PROFILE GUARD (Oracle SIGN-OFF-W/COND 2026-08-01; kill
    # REF_LENGTH_OUTLIER_GUARD, default ON since the flood-audit gate passed same day). The
    # length-folded learned shape is BLIND to digit accretion ('INV-121' -> 'INV-12110') and
    # duplication ('PO-64334' -> 'PO-643224') BY DESIGN (the fold cured the rollover withhold —
    # untouched, pinned). The per-scope digit-run PROFILE model (ocr_corrector.build_length_index
    # — dominance + the same weight-aware self-heal bars as the prefix guard) sees exactly that
    # axis. Flag-only, cap 69 + note; value NEVER touched. A genuine rollover ('INV-999' ->
    # 'INV-1000') flags its first ~3 docs then self-heals as confirms accrue — the accepted,
    # PINNED trade-off (exempting +1-length would reopen the accretion hole). Skip set + method
    # exemptions mirror _flag_prefix_outlier (taught anchors deliberately NOT exempt). Runs LAST
    # in the note chain (S-A > prefix-outlier > S-B): note-if-empty only.
    def _flag_ref_length_outlier(self, results, field_defs, supplier_name, document_slug):
        # Default ON (flipped 2026-08-01 after its flood-audit gate: ZERO corpus flags — no live
        # accretion/dup at 300 today; the guard exists for the class the fold can't see). =0 kills.
        if os.environ.get('REF_LENGTH_OUTLIER_GUARD', '1') == '0' or not self.length_index:
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
                if str(data.get('validation_note') or '').strip():
                    continue            # S-A / prefix-outlier spoke first — one note per field
                rec = ocr_corrector.lookup_length(self.length_index, key, supplier_name, document_slug)
                if not rec:
                    continue
                p = ocr_corrector.digit_run_profile(val)
                if not p or not ocr_corrector.is_length_outlier(p, rec):
                    continue
                dom = rec.get('dominant') or ()
                # ── LENGTH-WITNESS RECONCILIATION (owner + Oracle W/COND 2026-08-01; kill
                # REF_LENGTH_WITNESS_RECONCILE=0; structurally inert unless THIS guard fired).
                # Before writing the flag, consult the always-on candidate ledger: the pipeline
                # may already hold the correct read it discarded on tier (doc 297: inline read
                # 'WS-1904' won the @85 tie over keyword's correct 'WS-11904'; the slice reads
                # correctly at EVERY dpi — the defect is the inline band's thin crop, not the
                # pixels). ADOPT only on the artifact's mechanical FINGERPRINT (witness = winner
                # + ONE digit inserted adjacent to an identical digit — the merged-doubled-glyph
                # signature) AND a PASSIVE winner AND the witness passing the length profile,
                # the scope shape, prefix membership (where a record exists) and not parsing as
                # a date; adopted at the WITNESS'S OWN confidence, non-authoritative. NOTE
                # (Oracle C3 2026-08-03): a strong DIRECTLY-LABELLED witness is NOT capped (the 85
                # cap is only the seeded/override/late-rescue paths) — a keyword read like
                # 'PO-17039'@93 commits at 93 and CAN auto-file. So this arm DOES remove a working
                # human checkpoint on adopt; the justification is corroboration strength (a
                # distinct-stage witness matching the confirmed dominant length/prefix while the
                # winner fails its own shape), NOT a confidence cap. Two adopt fingerprints:
                # doubled_digit (the merged-glyph artifact, always) and — only when PREFIX_GARBLE_
                # ADOPT is on AND _strong_single_prefix holds (all_prefixed) — prefix_garble (a
                # confirmed leading code-prefix mis-read into a short non-alpha garble). An
                # AUTHORITATIVE winner (⊕ re-teach) or a non-fingerprint
                # disagreement gets FLAG-WITH-SUGGESTION: the S-B cap 69 + corrected_to =
                # witness + a note naming both readings — the 07-26 Tier-A pin stays unpierced
                # for silent replacement; the right answer is one click away. Rollover-drift
                # PIN (never "generalise" the fingerprint to profile-only): a stale profile-
                # passing witness against a correct length-novel read NEVER adopts.
                _witness = None
                if os.environ.get('REF_LENGTH_WITNESS_RECONCILE', '1') != '0':
                    try:
                        from extraction import suffix_reconcile as _sr
                        from extraction import text_normalise as _tn
                        _fmt = self.format_class_index.get(
                            ((supplier_name or '').lower().strip(),
                             (document_slug or '').lower().strip(), key))
                        _prec = ocr_corrector.lookup_prefix(self.prefix_index, key,
                                                            supplier_name, document_slug)
                        _wnorm = _tn.normalise_for_tokens(str(val))
                        for _cand in (self._field_candidates.get(key) or []):
                            if str(_cand.get('stage') or '') not in ('0_template', '0.5_mapping', '1_keyword'):
                                continue
                            _cv = _sr.edge_strip(str(_cand.get('value') or ''))
                            if not _cv or _tn.normalise_for_tokens(_cv) == _wnorm:
                                continue
                            _cp = ocr_corrector.digit_run_profile(_cv)
                            if not _cp or ocr_corrector.is_length_outlier(_cp, rec):
                                continue        # witness must PASS the profile the winner failed
                            if _fmt and format_anomaly_checker.check_value(_cv, _fmt):
                                continue        # …and the scope shape (when learned)
                            if _prec:
                                _pfx = ocr_corrector.code_prefix(_cv)
                                if not _pfx or not ocr_corrector.prefix_confirmed(_pfx, _prec):
                                    continue    # …and prefix membership where a record exists
                            if (_NUM_DATE_RE.match(_cv) or _NAME_DATE_RE.match(_cv)) \
                                    and validator.parse_date(_cv) is not None:
                                continue        # a date-shaped witness is never a ref repair
                            _dd_fp = _sr.doubled_digit_fingerprint(val, _cv)
                            # PREFIX-GARBLE adopt lane (Oracle SIGN-OFF-W/COND 2026-08-03; kill
                            # PREFIX_GARBLE_ADOPT, default OFF -> byte-identical). Only when the
                            # scope is strongly single-prefixed (all_prefixed + >=0.90 + >=5) does a
                            # confirmed-prefix mis-read into a short non-alpha garble license the
                            # single-witness adopt — the caller-side dominance guard is what keeps a
                            # keyword peer matching a DIFFERENT PO-#### on the page from being adopted.
                            _pg_fp = False
                            if (not _dd_fp
                                    and os.environ.get('PREFIX_GARBLE_ADOPT', '0') != '0'
                                    and _prec and _strong_single_prefix(_prec)):
                                _pg_fp = _sr.prefix_garble_fingerprint(val, _cv, _prec.get('dominant'))
                            _witness = {'value': _cv,
                                        'confidence': int(_cand.get('confidence') or 0),
                                        'method': _cand.get('method'),
                                        'fingerprint': _dd_fp or _pg_fp,
                                        'kind': ('doubled_digit' if _dd_fp else 'prefix_garble' if _pg_fp else None)}
                            if _witness['fingerprint']:
                                break           # the artifact signature — best possible witness
                    except Exception:
                        _witness = None
                if _witness and _witness['fingerprint'] and not data.get('authoritative'):
                    self._t('ref_length_adopt', field=key, was=str(val), now=_witness['value'],
                            method=_witness.get('method'), kind=_witness.get('kind'))
                    self.log(f"  Ref-length reconcile: {key} '{val}' -> '{_witness['value']}' "
                             f"({_witness.get('kind') or 'artifact'}; independent read had it whole)")
                    results[key] = {
                        **data,
                        'value':         _witness['value'],
                        'display_value': _witness['value'],
                        'method':        _witness.get('method') or data.get('method'),
                        'confidence':    _witness['confidence'],
                        'authoritative': False,
                        'length_reconciled': True,
                    }
                    continue
                data['confidence'] = min(int(data.get('confidence') or 0), 69)
                data['validation_note'] = (
                    f"this has {'+'.join(str(n) for n in p)} digits where this sender's usually "
                    f"have {'+'.join(str(n) for n in dom)} — possibly an extra or missing digit. "
                    f"Please check.")
                if _witness:
                    data['corrected_to'] = _witness['value']
                    data['validation_note'] = (
                        f"read '{val}' here, but another check read '{_witness['value']}' — "
                        f"this sender's references usually have "
                        f"{'+'.join(str(n) for n in dom)} digits. Please pick the right value.")
                self._t('ref_length_flag', field=key, value=str(val), profile=list(p),
                        dominant=list(dom), suggestion=(_witness or {}).get('value'))
                self.log(f"  Ref-length guard: {key} profile {p} vs dominant {dom} — flagged")
        except Exception:
            pass   # advisory guard — must never break extraction

    # ── D1: IN-BAND DIGIT-DISAGREEMENT FLAG (Oracle SIGN-OFF-W/COND 2026-08-01; kill
    # DIGIT_DISAGREE_FLAG, default ON — census gate passed same day: 300 docs, 1 fire,
    # the #291 true catch, 0.00% false fires vs the ≤3% bar). The interior-digit-
    # substitution class (WS-95390 read WS-95990) is same-length + shape-valid +
    # prefix-valid — invisible BY CONSTRUCTION to S-A/S-B/prefix-outlier/learned shape.
    # But the pipeline sometimes already READ the true value and discarded it on tier
    # (#291: wrong anchor_inline@85 beat keyword's correct WS-95390@85 — Tier-A outranks):
    # when a distinct-stage candidate-ledger read differs from the winner ONLY by 1-2
    # substituted digits on an identical non-digit skeleton, FLAG for review (cap 69 +
    # both readings named + corrected_to suggestion). FLAG-ONLY — a digit substitution
    # may NEVER silently adopt (the XRES C3 pin: unlike segmentation drops, substitutions
    # are only semi-decorrelated across chains, and both readings can be wrong — #65@400).
    # REF-ROLE field only (census predicate; date fields are a structural false-fire
    # hazard: two dates on one page legitimately differ only in digits). Runs LAST in the
    # pinned note chain (after S-B): note-if-empty only. Comparator SHARED with the future
    # D2 second-render witness: suffix_reconcile.digit_substitution_diff (one impl, one pin).
    def _flag_digit_disagreement(self, results, field_defs, supplier_name,
                                 document_slug, ref_field_key):
        if os.environ.get('DIGIT_DISAGREE_FLAG', '1') == '0' or not ref_field_key:
            return
        try:
            from extraction import suffix_reconcile as _sr
            data = results.get(ref_field_key)
            if not isinstance(data, dict):
                return
            val = data.get('value')
            if not val:
                return
            method = str(data.get('method') or '')
            if any(m in method for m in ('override', 'manual', 'template_fixed')):
                return                  # human-set literal / label-authority — S-B parity
            if str(data.get('validation_note') or '').strip():
                return                  # one note per field — every earlier guard outranks
            _norm = lambda s: re.sub(r'\s+', '', str(s or '').upper())
            w_norm = _norm(val)
            cands = self._field_candidates.get(ref_field_key) or []
            # the winner's own producing stage: the ledger entry matching value+method
            win_stage = next((c.get('stage') for c in cands
                              if _norm(c.get('value')) == w_norm
                              and c.get('method') == data.get('method')), None)
            best = None
            for c in cands:
                if win_stage and c.get('stage') == win_stage:
                    continue            # witness must come from a DISTINCT stage
                if int(c.get('confidence') or 0) < 60:
                    continue            # credibility floor (census witness read @85)
                cv = str(c.get('value') or '').strip()
                if not cv or _norm(cv) == w_norm:
                    continue
                diff = _sr.digit_substitution_diff(val, cv)
                if diff < 1 or diff > 2:
                    continue            # 1-2 substituted digits, identical skeleton only
                rank = (int(c.get('confidence') or 0), -diff)
                if best is None or rank > best[0]:
                    best = (rank, cv, c, diff)
            if not best:
                return
            _, wit_val, wit, diff = best
            data['confidence'] = min(int(data.get('confidence') or 0), 69)
            data['corrected_to'] = wit_val
            data['validation_note'] = (
                f"read '{val}' here, but another check read '{wit_val}' — the two "
                f"disagree on {diff} digit{'s' if diff > 1 else ''}. Please check the "
                f"document for the right value.")
            self._t('digit_disagree_flag', field=ref_field_key, value=str(val),
                    method=method, witness=wit_val, witness_stage=wit.get('stage'),
                    witness_conf=int(wit.get('confidence') or 0), diff=diff)
            self.log(f"  Digit-disagreement guard: {ref_field_key} '{val}' ({method}) vs "
                     f"'{wit_val}' ({wit.get('stage')}) — flagged for review")
        except Exception:
            pass   # advisory guard — must never break extraction

    def _flag_filing_value_sanity(self, results, ref_field_key, date_field_keys, ocr_text):
        """FILING_VALUE_SANITY_FLAGS (kill switch, DEFAULT OFF — Chris round 3, 2026-08-09).

        THE DEFECT, verified on disk: of 18 auto-filed documents, four carried a value that is
        visibly wrong on the page and NONE was flagged — the reference `VyYoa1niRe` where the page
        prints `VXS10186`, `VXS986` where the page prints `VXS98624`, and two documents filed into a
        `2020/` folder whose pages print 2026. All read "High · 90%". The reference and the date are
        exactly the two values that become the FILENAME and the FOLDER, so a wrong one does not just
        sit in a field — it decides where the paper lives. Chris kept his auto-file bar at 100 purely
        because of this, which is most of the product's value withheld.

        FLAG ONLY. Neither gate edits a value or picks a different one — they attach a note, and a
        noted field is ineligible for auto-file (trust.js), so the document routes to review with the
        reason on screen. That is the fail-toward-review direction, and it means a false positive
        costs one glance rather than a wrong file.

        Gate A — a reference that is not a reference SHAPE. Precision-first: it fires only on the
        conjunction of "mixed case INSIDE a token" AND "no run of 3+ digits", which is the shape of
        OCR noise ('VyYoa1niRe') and not the shape of a real code. 'VXS986', 'HTS-SO-12013',
        'CJB-9791', 'PD/25/1197' all pass untouched; so does a genuinely mixed-case code that
        carries digits ('InvNo123').

        Gate B — a date whose YEAR is not printed on the page. If a 4-digit year was read but that
        year appears nowhere in the page text, the reader invented it (a 6->0 misread does exactly
        this). Requires the read itself to carry a 4-digit year, so a page that prints 2-digit years
        is never judged.
        """
        if os.environ.get('FILING_VALUE_SANITY_FLAGS', '0') == '0':
            return
        try:
            page = str(ocr_text or '')
            date_keys = set(date_field_keys or [])

            def _note(key, text):
                d = results.get(key)
                if not isinstance(d, dict) or str(d.get('validation_note') or '').strip():
                    return False        # one voice per field — never argue with an existing note
                d['validation_note'] = text
                return True

            # ── Gate A ────────────────────────────────────────────────────────────────────
            if ref_field_key and isinstance(results.get(ref_field_key), dict):
                val = str(results[ref_field_key].get('value') or '').strip()
                if val:
                    mixed = any(re.search(r'[a-z][A-Z]', t) for t in re.split(r'[^A-Za-z0-9]+', val) if t)
                    if mixed and not re.search(r'\d{3}', val):
                        if _note(ref_field_key,
                                 f"'{val}' doesn't look like a reference number — please check it "
                                 f"against the document before filing."):
                            self._t('filing_sanity_ref', field=ref_field_key, value=val)
                            self.log(f"  Filing sanity: {ref_field_key} '{val}' is not a reference "
                                     f"shape — flagged for review")

            # ── Gate C — the reference must be PRINTED ON THE PAGE, as a whole token ──────
            # Gates A/B cannot catch a wrong value that still LOOKS like a code: 'VXS986' where the
            # page prints 'VXS98624' (a clip), or 'C.JB-7957' where it prints 'CJB-7957' (a stray
            # dot). Both filed silently. A whole-TOKEN test catches both, where a substring test
            # would not — 'VXS986' IS a substring of 'VXS98624', which is exactly how the clip hides.
            # Whole-token only, and only when the page text is substantial enough to be trusted as a
            # witness; a crop read and the full-page pass can legitimately disagree on a noisy scan,
            # so this is measured for false-flag rate before it is recommended, and it stays
            # FLAG-ONLY either way.
            if (ref_field_key and isinstance(results.get(ref_field_key), dict)
                    and len(page) > 200 and not results[ref_field_key].get('validation_note')):
                rv = str(results[ref_field_key].get('value') or '').strip()
                if rv and len(rv) >= 4:
                    toks = {t.strip('.,;:()[]{}"\'').casefold() for t in re.split(r'\s+', page)}
                    if rv.casefold() not in toks:
                        if _note(ref_field_key,
                                 f"'{rv}' doesn't appear on this page as written — please check the "
                                 f"reference before filing."):
                            self._t('filing_sanity_ref_absent', field=ref_field_key, value=rv)
                            self.log(f"  Filing sanity: {ref_field_key} '{rv}' not printed on the "
                                     f"page as a whole token — flagged for review")

            # ── Gate B ────────────────────────────────────────────────────────────────────
            for key in date_keys:
                d = results.get(key)
                if not isinstance(d, dict):
                    continue
                val = str(d.get('value') or '').strip()
                m = re.search(r'(19|20)\d{2}', val)
                if not m:
                    continue                      # no 4-digit year read -> nothing to check
                year = m.group(0)
                if year in page:
                    continue                      # the page prints it -> believe it
                if _note(key, f"the year {year} isn't printed anywhere on this page — please check "
                              f"the date before filing."):
                    self._t('filing_sanity_date', field=key, value=val, year=year)
                    self.log(f"  Filing sanity: {key} '{val}' — year {year} absent from the page, "
                             f"flagged for review")
        except Exception:
            pass   # advisory guard — must never break extraction

    def _reconcile_name_truncation(self, results, field_defs, ocr_text):
        """NAME-UNCLIP reconcile (see the NAME_UNCLIP_RECONCILE const block for the full design +
        Oracle conditions). Post-merge, ledger-based, the free-text complement of
        _reconcile_clipped_suffix. Adopts the fuller value KEEPING the winner's method/confidence
        (the suffix-reconcile mold — the drawn box IS the suspect); silent (owner rule) — every
        decline leaves today's behaviour byte-identical."""
        if not NAME_UNCLIP_RECONCILE:
            return
        try:
            from extraction import text_normalise as _tn
            from extraction import name_match as _nm
            type_by_key = {f.get('key'): (f.get('type') or '').lower() for f in (field_defs or [])}
            for key, data in list(results.items()):
                if key.startswith('_') or not isinstance(data, dict) or key == 'supplier_name':
                    continue                                   # identity lane owns supplier_name
                if not value_quality.is_name_like_field(key):
                    continue
                if type_by_key.get(key) not in (None, '', 'text', 'multiline_text'):
                    continue
                m = str(data.get('method') or '')
                if not _is_stage05_located(m):
                    continue                                   # the drawn-box lane EXACTLY
                if str(data.get('validation_note') or '').strip() or data.get('was_corrected') \
                        or data.get('corrected_to') or '+corrected' in m or '+snapped' in m:
                    continue    # one voice per field: a 4.5 wordness/repair note starves the heal
                wv = str(data.get('value') or '').strip()
                if not wv or '\n' in wv:
                    continue                                   # single-line scope (v1)
                wtoks = [t for t in _tn.tokenise(wv) if _nm._is_content(t)]
                if not wtoks:
                    continue
                # C1 — >=2 single-line ledger witnesses, token-IDENTICAL to each other (EXACT — no
                # Levenshtein anywhere in this pass), covering BOTH the keyword AND crop families;
                # the mapping FAMILY is excluded outright (Oracle cond. 3).
                wit = []
                for c in ((self._field_candidates or {}).get(key) or []):
                    fam_t = _crosscheck_witness_bucket((c or {}).get('stage'), (c or {}).get('method'))
                    if fam_t is None or fam_t[0] == 'mapping':
                        continue
                    v = str((c or {}).get('value') or '').strip()
                    if not v or '\n' in v:
                        continue
                    toks = [t for t in _tn.tokenise(v) if _nm._is_content(t)]
                    if toks:
                        wit.append((fam_t[0], v, toks, int((c or {}).get('confidence') or 0)))
                if len(wit) < 2 or any(w[2] != wit[0][2] for w in wit[1:]):
                    continue
                if not ({'keyword', 'crop'} <= {w[0] for w in wit}):
                    continue
                F = wit[0][2]
                # C2 — the cut fingerprint: same token count, all but the last equal, last token a
                # mid-token cut with remnant >=4. Oracle cond. 1 (the cut-glyph rule): a box that
                # slices a glyph mid-stroke MISREADS it ('Stuc' — the sliced 'd' left-bowl reads
                # 'c'; 'Studio'.startswith('Stuc') is False), so ONE edge-glyph substitution is
                # tolerated AT THE CUT POSITION ONLY (clean prefix >=3 chars + fuller witness).
                if len(wtoks) != len(F) or wtoks[:-1] != F[:-1]:
                    continue
                wl, fl = wtoks[-1], F[-1]
                if wl == fl or len(wl) < 4:
                    continue
                if fl.startswith(wl):
                    agree = wl
                elif fl.startswith(wl[:-1]) and len(fl) > len(wl):
                    agree = wl[:-1]                            # len(wl)>=4 => >=3 clean chars
                else:
                    continue
                completion = fl[len(agree):]
                if not completion or not completion.isalpha():
                    continue                                   # digit completions refused
                # C3 — the load-bearing genuine-shorter-name guard: a REAL short name is printed
                # word-bounded on the page and defends itself; a cut remnant ('Stuc') never is.
                if _uv_text_page_present(wv, ocr_text):
                    continue
                wit.sort(key=lambda w: (-w[3], w[1]))          # conf desc, value asc — deterministic
                adopt = wit[0][1]
                # C4 + C5 — the adopted value is page-present and no worse a name.
                if not _uv_text_page_present(adopt, ocr_text):
                    continue
                if value_quality.name_quality(adopt) < value_quality.name_quality(wv):
                    continue
                healed = {**data, 'value': adopt, 'name_unclip_reconciled': True}
                if 'display_value' in healed:
                    healed['display_value'] = adopt
                results[key] = healed
                self._t('name_unclip', field=key, method=m,
                        witness_fams=sorted({w[0] for w in wit}), **{'from': wv, 'to': adopt})
                self.log(f"  Name-unclip reconcile: {key} '{wv}' (cut mapping box) -> '{adopt}' "
                         f"(keyword+crop token-identical, remnant page-absent)")
        except Exception:
            pass   # advisory — must never break extraction

    def _uv_restore_demotion(self, key, tier, winner_val, alt_val, supplier_name,
                             document_slug, field_patterns, validation_patterns):
        """Oracle S-2/D-2 restore-DEMOTION checks (Slice-2). The content-nature flag chain (S-A
        date-in-ref, prefix-outlier, S-B length, D1 digit-disagree) runs at Stage 4.5 — BEFORE the
        post-merge tail — so a restored value would receive ZERO content-nature vetting. Rather than
        re-run those side-effectful passes, apply their deterministic predicates to the ALTERNATIVE:
        any hit means the restore is demoted to a FLAG (fail-toward-review; never a silent value
        change). Returns the demotion reason or None.
          digit_substitution — identical skeleton, 1-2 differing digit positions (D1's SHARED
            comparator): exactly the confusable-garble class where two OCR reads of the same glyph
            are CORRELATED, not independent — never restore on it (Oracle C2 pin).
          date_shaped_ref   — a ref-tier alternative that is a full-string calendar date (S-A's belt:
            regex AND parser must both agree).
          prefix_outlier / length_outlier — the alternative fails the scope's confirmed prefix/
            digit-run profile (S-B mirrors).
          decimal_tail      — numeric restores are WHOLE-NUMBER only (Oracle D-2: keeps qty/count,
            excludes money-shaped values typed `number`).
          not_credible      — the alternative fails the field's seeded credibility pattern."""
        try:
            from extraction import suffix_reconcile as _sr
            d = _sr.digit_substitution_diff(winner_val, alt_val)
            if 1 <= d <= 2:
                return 'digit_substitution'
        except Exception:
            pass
        if tier == 'ref':
            try:
                if (_NUM_DATE_RE.match(str(alt_val)) or _NAME_DATE_RE.match(str(alt_val))) \
                        and validator.parse_date(str(alt_val)) is not None:
                    return 'date_shaped_ref'
            except Exception:
                pass
            try:
                if self.prefix_index:
                    rec = ocr_corrector.lookup_prefix(self.prefix_index, key, supplier_name, document_slug)
                    p = ocr_corrector.code_prefix(str(alt_val)) if rec else None
                    if p and ocr_corrector.is_prefix_outlier(p, rec):
                        return 'prefix_outlier'
            except Exception:
                pass
            try:
                if self.length_index:
                    rec = ocr_corrector.lookup_length(self.length_index, key, supplier_name, document_slug)
                    prof = ocr_corrector.digit_run_profile(str(alt_val)) if rec else None
                    if prof and ocr_corrector.is_length_outlier(prof, rec):
                        return 'length_outlier'
            except Exception:
                pass
        if tier in ('numeric', 'percentage'):
            c = _uv_numeric_canon(alt_val, pct=(tier == 'percentage'))
            if not c or c[1]:
                return 'decimal_tail'
        try:
            vk = (field_patterns.get(key) or {}).get('validation') if field_patterns else None
            pats = (validation_patterns or {}).get(vk)
            if pats and not keyword._validate(str(alt_val), pats):
                return 'not_credible'
        except Exception:
            pass
        return None

    def _universal_postmerge_verify(self, results, field_defs, ref_field_key,
                                    date_field_keys, ocr_text, supplier_name, document_slug):
        """Slice-2 UNIVERSAL post-merge verify (gary+reggie+007 → Oracle SIGN-OFF-W/COND
        2026-08-03; docs/oracle_log.md 2026-08-03 entry has the full condition set). Runs BESIDE
        Slice-1 (immediately after it, before G1 — a restored value is then subject to G1/Fix-A
        like any winner). For every ELIGIBLE field winner whose tier has a safe predicate:
        when the winner is tier-UNcorroborated and a DISAGREEING alternative is agreed by >=2
        independent witness families (RESTORE tiers: >=1 crop-family leg) AND tier-present on the
        page, act — RESTORE (re-based anchor_inline@90, Oracle D-1: NEVER the witness's real
        method, which would mint Stage-0.5 authority; the trace event carries the true witness
        method + deposed value) or FLAG (cap 69 + a note NAMING the disagreeing value). Restores
        are demoted to flags by _uv_restore_demotion (S-2). Lone absence NEVER acts.
        INELIGIBLE (skipped): authoritative/Stage-0.5-located/keyword_override winners
        (_override_eligible — no Slice-1-style exception: no Slice-2 class carries the
        "winner method IS the suspect" justification), anchor_crop_crosscheck (Slice-1 owns it,
        and its declined restore is a DECIDED fail-toward-review outcome), '+corrected'/'+snapped'
        winners (Oracle S-1: Stage-2.5b sets neither was_corrected nor a note — the corrected
        value is page-ABSENT by construction while the garble it fixed is page-present and
        correlated-agreed; Slice-2 must never un-fix a correction), was_corrected winners,
        manual/override/template_fixed literals, shadow components, and ANY winner already
        carrying a validation_note (Slice-2 NEVER drops or composes a note — stricter than
        Slice-1, whose dropped note was the flip's own flag). CENSUS mode logs would-fire
        decisions; mutation is governed solely by the R/F switches (OFF = byte-identical)."""
        if not (UNIVERSAL_VERIFY_RESTORE or UNIVERSAL_VERIFY_FLAG or UNIVERSAL_VERIFY_CENSUS):
            return
        try:
            type_by_key = {f.get('key'): (f.get('type') or '').lower() for f in (field_defs or [])}
            field_patterns = _seed_field_patterns(self.patterns.get('field_patterns') or {}, field_defs)
            validation_patterns = self.patterns.get('validation_patterns') or {}
            for key, data in list(results.items()):
                if key.startswith('_') or not isinstance(data, dict):
                    continue
                wv = str(data.get('value') or '').strip()
                if not wv:
                    continue
                ftype = type_by_key.get(key)
                tier = _uv_tier(key, ftype, ref_field_key, date_field_keys)
                if tier is None:
                    continue
                m = str(data.get('method') or '')
                if not self._override_eligible(data):
                    continue
                if m == 'anchor_crop_crosscheck':
                    continue
                if '+corrected' in m or '+snapped' in m or data.get('was_corrected'):
                    continue
                if any(x in m for x in ('manual', 'override', 'template_fixed', 'shadow')):
                    continue
                if str(data.get('validation_note') or '').strip():
                    continue
                cands = (self._field_candidates or {}).get(key) or []
                restore_tier = tier in _UV_RESTORE_TIERS
                # Stage-2b sub-gate (Oracle C6): numeric/percentage act only under their own
                # switch; census still measures them (its counts are the flip evidence).
                _tier_armed = (tier not in ('numeric', 'percentage')) or UNIVERSAL_VERIFY_NUMERIC
                if not _tier_armed and not UNIVERSAL_VERIFY_CENSUS:
                    continue
                if _uv_winner_corroborated(data, cands, ocr_text, tier, ftype):
                    continue
                slot = _uv_corroborated_alternative(data, cands, ocr_text, tier, ftype,
                                                    require_crop=restore_tier)
                if not slot:
                    continue
                alt = slot['raw']
                demote = None
                if restore_tier:
                    demote = self._uv_restore_demotion(key, tier, wv, alt, supplier_name,
                                                       document_slug, field_patterns,
                                                       validation_patterns)
                if UNIVERSAL_VERIFY_CENSUS:
                    verb = ('would-flag(' + demote + ')' if demote
                            else ('would-restore' if restore_tier else 'would-flag'))
                    self.log(f"  UV census: {key} [{tier}] winner '{wv}' ({m}) vs "
                             f"alt '{alt}' — {verb}")
                    self._t('universal_verify_census', field=key, tier=tier, value=wv,
                            method=m, alt=str(alt), action=verb)
                    _cf = os.environ.get('UNIVERSAL_VERIFY_CENSUS_FILE')
                    if _cf:                     # harness sink (log lines are dropped by the
                        try:                    # realdoc harness — file is the census record)
                            import json as _json
                            with open(_cf, 'a', encoding='utf-8') as _fh:
                                _fh.write(_json.dumps({'field': key, 'tier': tier, 'winner': wv,
                                                       'method': m, 'alt': str(alt),
                                                       'action': verb}) + '\n')
                        except Exception:
                            pass
                if restore_tier and not demote:
                    if not (UNIVERSAL_VERIFY_RESTORE and _tier_armed):
                        continue
                    restored = {**data,
                                'value':      alt,
                                'method':     'anchor_inline',
                                'confidence': max(int(data.get('confidence') or 0),
                                                  _CROSSCHECK_CORROB_CONF)}
                    if 'display_value' in restored:
                        restored['display_value'] = alt
                    results[key] = restored
                    self._t('transform', field=key, stage='uv_restore', method='anchor_inline',
                            confidence=restored['confidence'],
                            witness=str(slot.get('crop_method') or ''),
                            **{'from': wv, 'to': alt})
                    self.log(f"  Universal verify: {key} [{tier}] '{wv}' uncorroborated — "
                             f"restored corroborated '{alt}'")
                else:
                    # FLAG lane: tier-F fields under the FLAG switch; a demoted restore under the
                    # RESTORE switch (it is the R tier's own fail-toward-review arm — Oracle S-2).
                    if not ((UNIVERSAL_VERIFY_FLAG if not restore_tier
                             else UNIVERSAL_VERIFY_RESTORE) and _tier_armed):
                        continue
                    data['confidence'] = min(int(data.get('confidence') or 0), 69)
                    data['validation_note'] = (
                        f"this read '{wv}', but other checks on this page read '{alt}' — "
                        f"please check which is right")
                    results['_needs_review'] = True
                    self._t('universal_verify_flag', field=key, tier=tier, value=wv,
                            alt=str(alt), reason=(demote or 'uncorroborated_vs_alternative'))
                    self.log(f"  Universal verify: {key} [{tier}] '{wv}' vs corroborated "
                             f"'{alt}'{' (' + demote + ')' if demote else ''} — flagged for review")
        except Exception:
            pass   # advisory pass — must never break extraction

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
                _owners = getattr(self, '_label_owners', {}) or {}
                if (TAUGHT_OWNERSHIP_OWN_LABEL
                        and keyword.label_is_own_discriminating(d.get('label'), key, _owners)):
                    # matched via THIS field's OWN discriminating caption ("Invoice No", "PO
                    # Date") — a precise labelled read, not a generic-caption stand-in. A shared
                    # ("Date") or purely-generic ("#") label does NOT qualify (reggie 2026-07-24).
                    continue
                if (TAUGHT_OWNERSHIP_TYPE_SCOPED_LABEL
                        and getattr(self, '_type_authoritative', False)
                        and keyword.label_is_own_discriminating_in_type(
                            d.get('label'), key, _owners, frozenset(k for k in fd if k))):
                    # B' (2026-07-26): the caption is shared GLOBALLY but UNIQUE within this
                    # AUTHORITATIVE type ("Order Date" on a purchase_order — order_date is not a
                    # field here). Fires only on a trusted-heading type; bare "Date" and >1-date
                    # types still hold; OFF/non-authoritative => byte-identical (Oracle-gated DARK).
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

    def _flag_net_misread_total(self, results, field_defs, credit_expected=None):
        """FLAG (never swap) a `total_amount` that looks like the NET/subtotal line while a distinct
        larger VAT-plausible total was ALSO read — cap confidence to review level + a note so it cannot
        silently auto-file. DEFAULT OFF (NET_MISREAD_TOTAL_FLAG) → byte-identical. Runs AFTER
        _reconciliation_pick_total (a valid balancing swap wins first → this no-ops) and BEFORE Stage-4.
        Fail-toward-review; changes no VALUE, disables no safety, preserves the authoritative-anchor
        invariant (arithmetic/role rail, not learned shape). gary+reggie+Oracle 2026-08-06. Best-effort."""
        if not NET_MISREAD_TOTAL_FLAG:
            return
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
            if inc.get('validation_note'):
                return   # already flagged (e.g. a pick_total swap / garble note) — never double-cap
            # ORACLE C1 (2026-08-07, BLOCKING) — a SIGN incoherence outranks a MAGNITUDE one.
            # validator.py:727 refuses to overwrite an existing note, and this helper runs BEFORE
            # Stage 4, so a net-misread note here would PRE-EMPT the credit-sign note entirely. That
            # is not a cosmetic ordering issue: `_net_misread_verdict` is sign-BLIND (parse_amount's
            # CURRENCY_RE drops the minus), and a credit note whose taught total box sits on the net
            # row satisfies total≈subtotal with a larger candidate — exactly this helper's target
            # layout. The note would then read "a larger total (£Y) was also found; please check
            # which is the real total", say nothing about the sign, and quote a sign-stripped £Y —
            # so the likeliest operator action files a credit note as a LARGER POSITIVE charge. That
            # is the 2026-08-06 incident with the software recommending it.
            # Abstain and let the credit-sign arm speak. The magnitude question survives: the value
            # is unchanged and the doc is still routed to review by the sign note.
            if credit_expected is not None:
                try:
                    from extraction import validator as _cv
                    if _cv._CREDIT_SIGN_ON and _cv.credit_sign_note(
                            inc.get('value'), inc.get('raw_value'), credit_expected):
                        self._t('net_misread_flag', field=total_key, decision='skip',
                                reason='credit-sign note takes precedence (Oracle C1)')
                        return
                except Exception:
                    pass        # best-effort: never let the precedence check break extraction
            total = _v.parse_amount(inc.get('value'))
            sub = None
            for k in ('subtotal', *keyword.ROLE_KEY_ALIASES.get('subtotal', ())):
                d = results.get(k)
                if isinstance(d, dict) and d.get('value'):
                    sub = _v.parse_amount(d.get('value'))
                    if sub:
                        break
            if total is None or sub is None:
                self._t('net_misread_flag', field=total_key, decision='skip',
                        reason='no total/subtotal witness')
                return
            tol = max(total * 0.02, 0.05)
            # Candidate ledger for the total role + its aliases (amount_due/balance_due can be the
            # true gross — Oracle: include, measure false-flags rather than hard-exclude).
            cands = list(self._field_candidates.get(total_key) or [])
            for ak in keyword.ROLE_KEY_ALIASES.get('total_amount', ()):
                cands += (self._field_candidates.get(ak) or [])
            verdict = _net_misread_verdict(total, sub, cands, tol)
            if not verdict:
                self._t('net_misread_flag', field=total_key, decision='skip',
                        reason='total!=subtotal or no VAT-plausible larger total',
                        total=total, subtotal=sub)
                return
            gross, gc = verdict
            # Copy vetted by Chris (2026-08-06): drop the "net/subtotal" jargon, name BOTH the filed
            # value AND the larger one so the operator can compare without hunting for the current read.
            note = (f"we filed {inc.get('value')}, but it looks like a part-total — a larger total "
                    f"({gc.get('value')}) was also found; please check which is the real total")
            results[total_key] = {
                **inc,
                'confidence':      min(inc.get('confidence') or 0, _NET_MISREAD_CAP),
                'validation_note': note,
            }
            self._t('net_misread_flag', field=total_key, decision='flag', was=inc.get('value'),
                    gross=str(gc.get('value')), gross_conf=gc.get('confidence'),
                    subtotal=sub, capped=_NET_MISREAD_CAP)
        except Exception:
            pass  # flag aid — must never break extraction

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
                credit_expected: bool | None = None,   # tri-state: does this doc TYPE expect a negative total?
                trace = None,
                slice_dir = None,
                page_text_lines: list | None = None,
                page_provenance: list | None = None,
                identity_shadow: bool = False,
                raw_page0 = None,
                page0_geometry: dict | None = None,
                cached_text: str | None = None,
                date_field_key: str | None = None,
                raw_pages: list | None = None,
                deskew_angles: list | None = None) -> dict:
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
        self._field_candidates = {}   # per-run candidate ledger — ALWAYS built (_remember_candidates is
                                      # unconditional); safety-load-bearing for G1 arm (i), do not re-gate
        self._list_field_keys = set()  # per-run; filled at Stage 1 when LIST_FIELD_SCAN is armed
        results      = {}
        field_keys   = [f["key"] for f in field_defs]
        # Straighten-arc frame election (C1: computed ONCE, the SAME list feeds every crop
        # site below — mapper, registration fit, anchors, late rescue, corroboration).
        crop_pages = _elect_crop_pages(page_images, raw_pages, deskew_angles)
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
        self._veto_fallthrough = False # G1/G2: set True below when the match arrived via the identity-veto
                                       # fall-through (TEMPLATE_VETO_FALLTHROUGH) — arms the corroboration guards
        if templates:
            # Imageless fast re-extract (--reextract, text-only from cached OCR): the LIVE Stage-0
            # identify consumes the page image AND, run imageless, would fall to its TEXT arms WITHOUT
            # the logo-arm guards (trusted-title refuse / TYPE_PRESENCE_VETO / detail-mark veto) — a
            # text-arm match could then stamp a supplier/type the full image pipeline would have vetoed.
            # So SKIP the live call when there is no image and let the known-id honour path below apply
            # the caller-supplied known_template_id text-only (Oracle C1 — guard the CALL, never the
            # `if templates:` block, which also holds the honour path + extract_with_template). Byte-
            # identical when an image is present (every non-reextract caller: _id_img is always set).
            match = None
            if _id_img is not None:
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
            # ⚠ SEAM-1 PIN (Oracle 2026-07-26, load-bearing invariant): this fallback RE-IMPOSES a
            # STORED template id whenever live identification returns None — including a None produced
            # by the detail veto / distinctive gate refusing a wrong pick. That is review-safe TODAY
            # only because reprocess forces needs_review and _maybeAutoFile has EXACTLY ONE call site
            # (the import file_done path). If a second auto-file call site is ever added, a stored
            # WRONG template re-imposed here becomes a silent re-poisoning vector. Do not add one
            # without re-vetting this seam (memory: project_slice1d_donothing "the known-id fallback
            # re-imposes the poison").
            if not match and (known_template_id is not None or pinned_template_id is not None):
                # A B1 PIN also acts as this fallback (Oracle C2, match=None corner): if this engine
                # call's own match failed, still honour the pinned sibling so Stage 0 runs against it
                # AND the doc is held below. Pin wins over a stale known link.
                _fb_id = pinned_template_id if pinned_template_id is not None else known_template_id
                known  = next((t for t in templates if t.get('id') == _fb_id), None)
                # THE STICKY BINDING (TEMPLATE_IDENTITY_ON_PAGE, 2026-08-10). A remembered binding is
                # honoured WITHOUT re-identifying — deliberately, because that is what makes a teach
                # stick across reprocesses. The cost, found while gating the wrong-company misfile:
                # a WRONG binding is equally permanent. 18 delivery notes stamped with another
                # company's name could not be healed by "Reprocess all in queue", which is precisely
                # the button a user reaches for when they notice something is wrong — and the
                # comment six lines above already warned that this fallback "re-imposes the poison".
                #
                # So the MEMORY must pass the same test a fresh match does: is this template's
                # company named anywhere on this page? If not, the memory is wrong — drop it and let
                # identification decide (which, with the guard armed, yields the right template or
                # none, and none routes to review).
                #
                # NOT "always re-identify on reprocess": that would discard the deliberate binding a
                # teach created, which is the whole point of honouring it. This only declines a
                # binding the page itself contradicts.
                # Inert unless the identity guard is armed, and it abstains on exactly the same
                # conditions (no judgeable identity, or a supplier that does not print its name), so
                # it can never drop a binding on evidence the guard would not act on.
                if known and template_matcher._identity_refuses(known, ocr_text):
                    self.log(f"  Stage 0: NOT honouring {_fb_id} — "
                             f"'{template_matcher._template_identity(known)}' is not named on this "
                             f"page; re-identifying instead of re-imposing a stale binding")
                    self._t('sticky_binding_declined', template_id=_fb_id,
                            identity=template_matcher._template_identity(known))
                    known = None
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
                # G1/G2 guard arming: TRUE only when identify_template matched via the identity-veto
                # fall-through (the additive tag). The known_id/pinned fallback dicts above never carry
                # the key → guards stay dark on the reprocess-honour path (review-safe per the SEAM-1
                # pin). OFF ⇒ the veto sites return None ⇒ the tag never exists ⇒ structurally dead.
                self._veto_fallthrough = bool(match.get('veto_fallthrough'))
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
                # Stage 0 RAN — every-step ladder outcome per configured field,
                # computed against results AS OF right after the Stage-0 merge
                # (before Stage 0.5 refines anything).
                self._trace_steps('0_template', True, None, tmpl_results,
                                  _pre_s0, results, field_keys)
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
                    # TEACH_ANGLE_COMPOSE (see the flag block): compose the SOURCE template's
                    # teach-frame boxes to the LEVEL frame this deskewed doc is in. Angle comes
                    # from mapping_src (the borrowed sibling's sample tilt, Oracle C2), never
                    # blindly the matched template's. C3: the raw-crop election wins if both on.
                    if (TEACH_ANGLE_COMPOSE and not DESKEW_RAW_CROPS
                            and raw_pages and tmpl_mappings):
                        _src_t = (mapping_src or matched_tmpl) or {}
                        _theta = _src_t.get("sample_deskew_angle")
                        try:
                            _theta = float(_theta) if _theta is not None else None
                        except (TypeError, ValueError):
                            _theta = None
                        if _theta is not None and abs(_theta) >= 0.2:
                            _W, _H = crop_pages[0].size
                            tmpl_mappings = _compose_mappings_to_level(tmpl_mappings, _theta, _W, _H)
                            _landmarks = _compose_landmarks_to_level(_landmarks, _theta, _W, _H)
                            self.log(f"  Stage 0.5: composed {len(tmpl_mappings)} mapping(s) "
                                     f"teach-frame -> level (sample tilt {_theta:.2f} deg)")
                    # PLACEMENT-ONLY sibling (see the TEACH_ANGLE_COMPOSE_SCAN flag block): the page
                    # was NOT deskewed, so compose the taught boxes into THIS page's own raw frame
                    # by (θ_t − θ_s). Mutually exclusive with the branch above by construction —
                    # that one requires raw_pages (deskewed), this one requires their absence.
                    elif (TEACH_ANGLE_COMPOSE_SCAN and not raw_pages
                          and tmpl_mappings and crop_pages):
                        try:
                            _src_t = (mapping_src or matched_tmpl) or {}
                            _tt = _src_t.get("sample_deskew_angle")
                            _tt = float(_tt) if _tt is not None else 0.0
                            from ocr.tesseract import detect_skew_angle as _dsa
                            _ts = float(_dsa(crop_pages[0], _COMPOSE_SCAN_MIN_NET) or 0.0)
                            _net = _tt - _ts
                            if _COMPOSE_SCAN_MIN_NET <= abs(_net) <= _COMPOSE_SCAN_MAX_NET:
                                _W, _H = crop_pages[0].size
                                tmpl_mappings = _compose_mappings_to_level(tmpl_mappings, _net, _W, _H)
                                _landmarks = _compose_landmarks_to_level(_landmarks, _net, _W, _H)
                                self.log(f"  Stage 0.5: composed {len(tmpl_mappings)} mapping(s) "
                                         f"teach-frame -> this page (teach {_tt:.2f} deg, "
                                         f"scan {_ts:.2f} deg, net {_net:.2f} deg) — no pixels rotated")
                                self._t('compose_scan', theta_teach=round(_tt, 2),
                                        theta_scan=round(_ts, 2), net=round(_net, 2),
                                        mappings=len(tmpl_mappings))
                        except Exception:
                            pass   # measurement/compose failure -> stored geometry, unchanged
                    mapping_results = template_mapper.extract_with_mappings(
                        crop_pages, tmpl_mappings,
                        field_patterns=field_patterns,
                        validation_patterns=self.patterns.get("validation_patterns", {}),
                        format_lookup=_fmt_lookup,
                        provisional_lookup=self._make_provisional_lookup(supplier_name, document_slug),
                        slice_capture=(self._capture_slice if (self._trace and self._slice_dir) else None),
                        template_landmarks=_landmarks,
                        registration_enabled=self.registration_enabled,
                    )
                    applied = 0
                    _pre_s05 = self._snap(results)
                    self._remember_candidates('0.5_mapping', mapping_results)
                    for key, data in mapping_results.items():
                        # MAPPER-HEAL CENSUS (2026-08-05, the every-step-trace arc): each
                        # reconcile-family heal stamps a private `_heal` marker; the Slice-C
                        # edge guard stamps its method suffix. ONE log line per fire makes
                        # every heal countable from the process log (the scorer's HEAL_RE
                        # census + SFDEV) — previously these healed silently (diag markers
                        # only) and every arm's fire count read as zero. Marker popped so
                        # the persisted result dict stays byte-identical.
                        _heal = data.pop("_heal", None) if isinstance(data, dict) else None
                        _meth = (data or {}).get("method", "")
                        if _heal or _meth.endswith(("_edgegrow", "_edgecut")):
                            self.log(f"  Stage 0.5 heal: {key} "
                                     f"{_heal or _meth.rsplit('_', 1)[-1]} ({_meth})")
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
                        # TEMPLATE_FIXED SEED GUARD (see the _FIXED_SEED_KEYS flag block). A mapping
                        # read that is the SAME curated company name merely misread, or debris
                        # against it, must not displace the seed on authority. Declines only on
                        # DISAGREEMENT; a genuinely different company still wins. Inert unless armed.
                        _fixed_decline = _fixed_seed_declines_mapping(key, existing, data)
                        # REGION-SCOPED PRESENCE CONFIRM (see the flag block). Asked ONLY when the
                        # string-shaped branches above have already declined to act, so it can add
                        # a decline but never remove one. Positive evidence only: the curated name
                        # is printed in the taught region on THIS page, so the read that disagrees
                        # with it is looking at the wrong place — keep the seed.
                        if not _fixed_decline and _ISSUER_REGION_PRESENCE_ON:
                            _rp = _region_confirms_curated_seed(key, existing, data,
                                                                tmpl_mappings, crop_pages)
                            self._t('region_presence', field=key, verdict=_rp,
                                    kept=existing.get('value') if isinstance(existing, dict) else None,
                                    read=(data or {}).get('value'))
                            if _rp:
                                _fixed_decline = 'region_presence'
                        if _fixed_decline:
                            self.log(f"  Stage 0.5: kept curated supplier "
                                     f"'{existing.get('value')}' — declined mapping read "
                                     f"'{data.get('value')}' ({_fixed_decline})")
                            self._t('fixed_seed_decline', field=key, branch=_fixed_decline,
                                    kept=existing.get('value'), declined=data.get('value'),
                                    declined_conf=data.get('confidence'))
                            continue
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
                    self._trace_steps('0.5_mapping', True, None, mapping_results,
                                      _pre_s05, results, field_keys)
                    if applied:
                        self.log(f"  Stage 0.5: {applied} field(s) refined via anchor/target mapping")
                else:
                    # SEAM 3a: template matched but Stage 0.5 was skipped — emit skip
                    # rows from OUTSIDE the gate (distinct reason: no-mappings vs no-page-image)
                    # so the ladder shows Stage 0.5 as skipped rather than silently absent.
                    self._trace_steps('0.5_mapping', False,
                                      (self._STEP_SKIP_NO_MAPPINGS if not tmpl_mappings
                                       else self._STEP_SKIP_NO_PAGE_IMAGE),
                                      {}, {}, results, field_keys)

        # SEAM 3a: Stage 0 (and 0.5, when no template) never ran — emit their skip
        # rows from OUTSIDE the `if templates:` gate, covering BOTH no-templates and
        # no-match (matched_tmpl stays None in both). This is the exhibit-A class:
        # fields greened by keyword/anchor with no template/mapping rows. (A matched-
        # but-no-mappings Stage 0.5 skip is emitted inline above with its own reason.)
        if matched_tmpl is None:
            self._trace_steps('0_template',  False, self._STEP_SKIP_NO_TEMPLATE,
                              {}, {}, results, field_keys)
            self._trace_steps('0.5_mapping', False, self._STEP_SKIP_NO_TEMPLATE,
                              {}, {}, results, field_keys)

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
                # Geometry name-presence WITNESS (Oracle C1; kill LOGO_NAME_PRESENCE_ACCEPT=0 restores
                # byte-identical). Recompute the issuer GEOMETRICALLY — page0_geometry on a scan, or the
                # born-digital line bridge (geometry_from_lines) on a generated PDF — and let it CONFIRM
                # the logo ONLY where the branding-fingerprint arms are unjudgeable. Geometry-ONLY pick,
                # NO text-arm fallback, so a marker-less recipient can never confirm itself as the issuer.
                # DEFAULT ON (corpus-gated 2026-07-28: +14 correct auto-files, 0 new wrong, M_type 0;
                # real born-digital SuperStore replay flips suggest→accept 8/8, OFF byte-identical).
                _geom_issuer_norm = None
                if os.environ.get("LOGO_NAME_PRESENCE_ACCEPT", "1") != "0":
                    from extraction import letterhead as _lh
                    _geom = page0_geometry or _lh.geometry_from_lines(page_text_lines)
                    if _geom and _geom.get("rows"):
                        _gp = _lh.pick_issuer_geometry(
                            ocr_text, _geom, detected_title=document_type,
                            type_phrases=_letterhead_type_phrases(self.patterns))     # C2 parity
                        _geom_issuer_norm = self._accept_norm(_gp) if _gp else None    # C3 same norm
                _gate = decide_logo_text_gate(
                    logo_match["supplier_name"],
                    _branding_banks(templates, self._accept_norm),
                    ocr_text, self._accept_norm, self.accepted_issuers,
                    geom_issuer_norm=_geom_issuer_norm)
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
        # WRONG supplier. REVIEW-BOUND at fill time (persisted note) — an INFERRED identity
        # must never silently drive the filing folder (Oracle 2026-07-14; pin REWRITTEN
        # 2026-07-31, not weakened: a fill later WITNESSED by the independent geometry
        # letterhead read is no longer merely inferred — the page prints it as its own
        # letterhead — and the dark G arm at Stage 2.5a may then shed the note,
        # gary→Oracle-signed). Kill switch env TEMPLATE_IDENTITY_FILL (default on) → =0 is
        # byte-identical.
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
            self.patterns, self.label_overrides, document_slug,
            # TEMPLATE SCOPE (migration 62): a teach-written override applies only when the
            # template it was taught on matched THIS document. Stage 0 settled matched_tmpl
            # before this line, so the scope needs no re-identification. None -> 0 -> only
            # doc-type-wide (admin/preset) rows apply.
            template_id=(matched_tmpl or {}).get('id'))
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
        # OWN-LABEL exemption index for the taught-ownership guard (reggie 2026-07-24): {label ->
        # {field_keys}} from the SAME post-merge bank, so the guard can tell a field's own
        # discriminating caption ("Invoice No") from a shared/generic one ("Date"/"#").
        self._label_owners = keyword.build_label_owner_index(patterns_for_run.get('field_patterns'))
        # TYPE-AUTHORITY signal for the B' type-scoped own-label exemption (Oracle C1/C3 2026-07-26):
        # the resolved type is trustworthy enough to scope label-ownership to it ONLY when a trusted
        # standalone heading named it (title_trusted) AND Stage 0 did not flag the type ambiguous or
        # refused. Template signals are DELIBERATELY excluded (same-logo siblings are the SOURCE of type
        # ambiguity — and they set _type_ambiguous/_type_refused, which disqualify here). type_confirmed
        # (an operator-confirmed/retyped reprocess) is NOT wired in this slice (Oracle C3: it would need a
        # new extract() kwarg + an uncaught-NameError risk here, outside the guard's try/except); unwired
        # it is simply False, so B' leans on title_trusted only for now. getattr keeps it crash-safe.
        self._type_authoritative = (bool(title_trusted)
                                    and not getattr(self, '_type_ambiguous', False)
                                    and not getattr(self, '_type_refused', False))
        _caption_guard_keys = {
            f.get('key') for f in (field_defs or [])
            if f.get('key') and f.get('key') != 'supplier_name'
            and (value_quality.is_name_like_field(f.get('key'))
                 or (patterns_for_run.get('field_patterns', {}).get(f.get('key')) or {}).get('role_caption') == 'party')}
        # LIST fields (2026-08-11, kill switch LIST_FIELD_SCAN, DEFAULT OFF): fields the type
        # declares as 'list' are collected by the label scan — every occurrence, deduped, joined
        # '; '. The set also drives the ownership skips at the mapping/anchor/hint stages (a list
        # is caption-collected; one taught box structurally cannot hold N occurrences — the live
        # serials teach committed its own caption 23 times proving it). Empty when the flag is
        # off -> byte-identical.
        _list_field_keys = set()
        if os.environ.get('LIST_FIELD_SCAN', '0') != '0':
            _list_field_keys = {f.get('key') for f in (field_defs or [])
                                if f.get('key') and str(f.get('type') or '').lower() == 'list'}
        self._list_field_keys = _list_field_keys        # read by the Stage-2/hint ownership skips
        # RECLAIM a list field a scalar rung already filled (Stage 0 template seed / Stage 0.5
        # mapping run before this point): their single value is at best element 1 of N and at
        # worst the caption itself. The collect scan below is the only writer for these keys.
        for _lk in _list_field_keys:
            if isinstance(results.get(_lk), dict):
                _old = results.pop(_lk)
                self.log(f"  List field '{_lk}': reclaimed scalar {_old.get('method')} read "
                         f"for the collect scan")
        kw_results = keyword.extract_fields(ocr_text, field_keys, patterns_for_run,
                                            caption_vocab=_caption_vocab,
                                            caption_guard_keys=_caption_guard_keys,
                                            trace=self._t,
                                            list_keys=_list_field_keys or None)
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
        # Validation patterns for the taught-format-fail yield (the redesign judges by the HARD
        # reference_code / strict-currency check — no per-supplier learned-format query needed).
        _ff_vpats = self.patterns.get("validation_patterns") or {}
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
                # A located taught DATE that OCR-misread into an IMPOSSIBLE calendar value must not win
                # on authority over a valid, confident keyword date (see the TEMPLATE_DATE_INVALID_YIELD
                # flag block). Yields to the keyword read but FLAGGED to Review (the note is the safety;
                # Stage 4's clean-date floor makes the cap cosmetic). Own continue; method stays keyword
                # (do NOT re-grant the taught shape-gate exemption). Env is the first conjunct so OFF is
                # byte-identical and salvage_date runs only on the rare invalid-taught case.
                if ((TEMPLATE_DATE_INVALID_YIELD or TEMPLATE_DATE_FUTURE_YIELD)
                        and key in date_field_keys and _kw_ok):
                    _reason = _invalid_taught_date_yields(existing.get("value"), data.get("value"))
                    if ((_reason == 'impossible' and TEMPLATE_DATE_INVALID_YIELD)
                            or (_reason == 'future' and TEMPLATE_DATE_FUTURE_YIELD)):
                        # Reason-keyed note: accurate per case (an impossible date is NOT "far in the
                        # future" and vice-versa) + NAMES the dropped taught value so a correct-but-far-
                        # future taught date stays operator-recoverable.
                        _why = ("isn't a valid calendar date" if _reason == 'impossible'
                                else "is far in the future (likely a mis-scanned year)")
                        results[key] = {**data,
                                        "confidence": min((data.get("confidence") or 0), _CONFLICT_CAP),
                                        "validation_note": (
                                            f"Kept the read value “{data.get('value')}” — the taught "
                                            f"date box read “{existing.get('value')}”, which {_why}. "
                                            f"Please check.")}
                        continue
                if (_blind_reg and _kw_ok
                        and _cmp_norm(data.get("value")) != _cmp_norm(existing.get("value"))
                        and (data.get("confidence") or 0) > (existing.get("confidence") or 0)):
                    results[key] = {**data,
                                    "confidence": min((data.get("confidence") or 0), _CONFLICT_CAP),
                                    "validation_note": (
                                        f"Kept the read value “{data.get('value')}” — a taught "
                                        f"mapping read “{existing.get('value')}” at a registered "
                                        f"position that couldn't be confirmed by its label. Please check.")}
                # TEMPLATE_FORMAT_FAIL_YIELD (gary REDESIGN 2026-08-09, DEFAULT OFF): a taught
                # template_mapping read that FAILS this field's FORMAT (landed on the wrong row /
                # adjacent field / clipped-to-junk / garbled — po_ref "Account", total "L922.14") must
                # not keep authoritative precedence over a confident, format-PASSING, DISAGREEING keyword
                # read. Yields to keyword + cap + review note (never silent). Scoped to STRUCTURED keys:
                # dates own the flag above; name-like free-text is excluded (names vary legitimately). A
                # format-VALID taught read passes _stage05_format_fails → never fires → teaching gains
                # untouched. A clipped-but-code-shaped value ('19979') is format-VALID → NOT swapped
                # (read-layer residual, out of scope). The helper judges by the HARD reference_code /
                # strict-currency pattern — the challenger side is re-checked so garbage keyword reads
                # ('The'/'Tel 01632…') can't be adopted (the old ref regression).
                if (TEMPLATE_FORMAT_FAIL_YIELD
                        and (existing.get("method") or "").startswith("template_mapping")
                        and key not in date_field_keys
                        and not value_quality.is_name_like_field(key)
                        and data.get("method") in ("keyword", "keyword_override")
                        and data.get("value")
                        and (data.get("confidence") or 0) >= _FORMAT_FAIL_KW_FLOOR
                        and _cmp_norm(data.get("value")) != _cmp_norm(existing.get("value"))):
                    _ff_vt = _kw_types.get(key)
                    if (_stage05_format_fails(existing.get("value"), key, _ff_vt, field_patterns, _ff_vpats)
                            and not _stage05_format_fails(data.get("value"), key, _ff_vt, field_patterns, _ff_vpats)):
                        results[key] = {**data,
                                        "confidence": min((data.get("confidence") or 0), _CONFLICT_CAP),
                                        "validation_note": (
                                            f"Kept the read value “{data.get('value')}” — a taught "
                                            f"mapping read “{existing.get('value')}”, which doesn't match "
                                            f"this field's expected format. Please check.")}
                        continue
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
        # Stage 1 always runs — every-step ladder outcome per configured field.
        self._trace_steps('1_keyword', True, None, kw_results, _pre_s1, results, field_keys)
        found = _count_valued_fields(results)
        self.log(f"  Stage 1: {found}/{len(field_keys)} fields found")

        # Snapshot the supplier identity AS OF Stage-2 time: the Stage-2.6 late-anchor
        # rescue below runs ONLY when the supplier was UNRESOLVED here and resolved later
        # (2.5a text scan) — never when Stage 2 already saw a supplier. Wrong-then-corrected
        # identity is a different, riskier class and stays deliberately out of scope.
        _s2_supplier = supplier_name

        # SEAM 3a: no anchors in scope → the whole Stage-2 block below is skipped;
        # emit its skip rows FROM OUTSIDE the gate so Stage 2 is visible on the
        # ladder (the exhibit-A "green dots, no anchor rows" case). _trace_steps
        # self-guards on --trace, so this is a no-op off the trace path.
        if not anchors:
            self._trace_steps('2_anchor', False, self._STEP_SKIP_NO_ANCHORS,
                              {}, {}, results, field_keys)
        # ── Stage 2: Anchor extraction ────────────────────────────────────────
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
                            crop_pages[0], _alm, template_mapper._ocr_lines)
                    except Exception as e:
                        self.log(f"  Stage 2: landmark fit skipped ({e})", "warn")
                    # S-D VACUOUS-FIT GATE (Oracle-authorized cheap gate, evidence-met 2026-08-01;
                    # kill REG_MIN_INLIERS_GATE=0). A similarity fit surviving on n_inliers <= 2 is
                    # EXACTLY DETERMINED — residual 0.0000 BY CONSTRUCTION (registration.py: at
                    # n <= sample the fit is scored on the points that produced it), so it carries
                    # ZERO verification. The S-D audit measured the class live: ~43% of the docket
                    # fits collapsed to 2 inliers (5 landmarks LOCATED, 2-3 surviving = the located
                    # correspondences DISAGREE — a landmark matched a wrong instance of a repeated
                    # word — and RANSAC kept an arbitrary self-consistent pair). Refuse the
                    # transform -> the rung falls through exactly as a failed fit always has
                    # (keyword/review — fail toward review, never a blind mapped crop).
                    # 2026-08-06: the condition was INLINED here and nowhere else, so the sibling
                    # Stage-0.5 call site consumed exactly the fits this refused (the Castellan
                    # incident). It now lives ONCE in registration.is_unfalsifiable — same env var,
                    # same default, same semantics — and both call sites consume that. Do not
                    # re-inline it. NOTE: _fit_page_transform now applies the same predicate
                    # internally, so this is a redundant second net rather than the only guard;
                    # it is kept for the log line and as belt-and-braces.
                    if registration.is_unfalsifiable(anchor_page_transform):
                        self.log(f"  Stage 2: registration REFUSED — {anchor_page_transform.n_inliers} "
                                 f"inlier(s) is an unverified exact fit (vacuous-fit gate)")
                        anchor_page_transform = None
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
            _on_reject = ((lambda fk, st, v, r, cap=None: self._t(
                "anchor_reject", field=fk, method=st, value=v, reason=r, caption=cap))
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
                page_images=crop_pages,
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
                # LIST ownership (2026-08-11): a list-typed field belongs to the caption collect
                # scan alone — one anchor box structurally cannot hold N occurrences, and the
                # live serials teach committed its own caption 23 times proving what a scalar
                # writer does to a list field. Empty stays empty -> review (fail-toward-review).
                if key in getattr(self, '_list_field_keys', ()):
                    continue
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
                # ── NAME-GUARD KEYWORD CLEAR (Oracle SEND-BACK redirect 2026-07-24; kill
                # NAME_GUARD_KEYWORD_CLEAR) ── anchor.py's :586 name-guard note KEEPS a clean rigid
                # name but flags it "caption disagreed with the taught position" when the RELOCATE
                # landed on off-page junk (e.g. "wines"). That note is the ONLY backstop for a STALE-
                # but-clean rigid name, so it CANNOT be dropped on a raw-OCR witness (Oracle: a same-
                # supplier drift would then file silently wrong). But when an INDEPENDENT Stage-1
                # keyword read AGREES with the KEPT value, the stale residual is excluded BY
                # CONSTRUCTION (a stale name => the keyword disagrees) and the two-independent-reads bar
                # is met: drop the phantom note + take the higher confidence. No keyword / a disagreeing
                # keyword => note stands (fail-toward-review). VALUE UNCHANGED. The marker is set ONLY at
                # the :586 site (anchor.py), so the other _relocate_guard_note sites keep flagging.
                if isinstance(data, dict) and data.get("_name_guard_clearable"):
                    _ng_clears = _name_guard_keyword_clears(data, existing, key)
                    data = {k: v for k, v in data.items() if k != "_name_guard_clearable"}  # strip marker always
                    if _ng_clears:
                        for _k in ("validation_note", "was_corrected", "corrected_to"):
                            data.pop(_k, None)
                        data["confidence"] = max(int(data.get("confidence") or 0),
                                                 int(existing.get("confidence") or 0))
                        results[key] = data
                        continue
                    # not corroborated: marker stripped, note kept -> falls through; Tier-A holds it
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
                # G2 (VETO-FALLTHROUGH corroboration guard — gary design + Oracle SIGN-OFF-W/COND
                # 2026-07-26). is_taught_override has NO confidence comparison BY DESIGN (a fresh ~85
                # taught anchor must correct a wrong 88-93 keyword hit) — but on a FALL-THROUGH-matched
                # doc that doctrine's asymmetry vanishes: OFF-baseline these docs had no template ⇒ no
                # anchors ⇒ the keyword stood, so a lower-confidence AUTO-tier crop displacing a
                # higher-confidence keyword is a measured regression (#456: crop '4/10/2026'@85
                # silently displaced the CORRECT keyword '14/10/2026'@93). Scope: fall-through docs
                # ONLY (global G2 = doctrine inversion, ruled out); authoritative (⊕-taught) reads
                # still displace (F8); keyword_override/Stage-0.5 already protected above. Mirror of
                # the KEYWORD_ANCHOR_CORROB lift: agree → lift; disagree at inverted confidence → keep
                # the keyword + note (review). C6 (agree-displace-degrade): an AGREEING crop at
                # inverted confidence keeps the incumbent too — pure value/method/conf retention, NO
                # note (else agreement produces a WORSE outcome than disagreement: conf 93→85 dropped
                # a clean doc below the 88 critical floor). NEVER sets _needs_review here (mid-Stage-2
                # `_` injection is the 2026-07-22 crash class); the persisted note alone holds.
                if (is_taught_override
                        and getattr(self, '_veto_fallthrough', False)
                        and not data.get("authoritative")
                        and existing.get("method") == "keyword"
                        and (key in date_field_keys or _is_ref_field(key))
                        and int(existing.get("confidence") or 0) >= int(data.get("confidence") or 0)
                        and data.get("value") and existing.get("value")):
                    if _values_normalise_equal(data.get("value"), existing.get("value"),
                                               key in date_field_keys):
                        continue                      # C6: identical value — keep the stronger incumbent
                    _g2n = (f"Another read of this field disagreed ('{data.get('value')}' vs "
                            f"'{existing.get('value')}') — please check it against the document "
                            f"before filing.")
                    _old = str(existing.get("validation_note") or "").strip()
                    existing["validation_note"] = (_old + " " + _g2n) if _old else _g2n
                    continue                          # keep the higher-confidence keyword read
                if not existing or is_taught_override or data["confidence"] > existing["confidence"]:
                    results[key] = data
            self._trace_stage('2_anchor', anchor_results, _pre_s2, results)
            self._trace_steps('2_anchor', True, None, anchor_results,
                              _pre_s2, results, field_keys)
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

        # ── S1: TEMPLATE-IDENTITY BAND GRADUATE (2026-07-28, DEFAULT OFF) ─────────
        # Shed the review note from a MAJORITY-tier template-identity FILL when the filled issuer
        # name is INDEPENDENTLY printed in this page's issuer band. The note is the human checkpoint
        # for an INFERRED identity; when the page itself corroborates the value, the checkpoint is
        # pure friction (Profile-Construction class: 'BILL FROM: Profile Construction' is on the page,
        # yet the fill @70+note wins the read because the issuer caption's own base_confidence is 40).
        # Value is FIXED to the incumbent V — S1 ONLY sheds the note, it NEVER swaps supplier.
        # Fires AFTER the text-first graduation above, so if a hint already resolved the supplier
        # (method 'hint_text_match') this is skipped; idempotent (its own method skips a re-run).
        # C2 (Oracle): gated on ISSUER_HINT_BAND!='0' so the band is the TRUNCATED issuer window,
        # never the raw ocr_text[:600] fallback (which re-opens recipient self-corroboration).
        # C1 (Oracle): _identity_corroborated_strict (ALL distinctive tokens, not the FILL's >=60%)
        # so a same-trade descriptor subset can't shed the note on a logo-collision sibling.
        # Confidence 85 = parity with the hint_text_match ceiling; supplier_name is required=1, so 85
        # only clears the 95 graduated floor when ref+date are ~100 (true for born-digital) — NOT a
        # blanket auto-file. Kill switch TEMPLATE_IDENTITY_BAND_GRADUATE (default '0' = byte-identical).
        if os.environ.get("TEMPLATE_IDENTITY_BAND_GRADUATE", "0") != "0":
            _sn_cur = results.get("supplier_name")
            # Cheap preconditions keep the issuer-band computation off all but a majority-noted
            # fill; the full decision (incl. the ISSUER_HINT_BAND kill + strict corroboration)
            # lives in the pure _should_shed_template_identity_note helper so every gate branch is
            # unit-testable without a full extract().
            if (isinstance(_sn_cur, dict)
                    and _sn_cur.get("method") == "template_identity"
                    and _sn_cur.get("validation_note") == _TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY
                    and _sn_cur.get("value")
                    and self._should_shed_template_identity_note(
                        _sn_cur, self._issuer_hint_band(ocr_text))):
                results["supplier_name"] = {
                    "value":      _sn_cur["value"],
                    "confidence": 85,
                    "method":     "template_identity_corroborated",
                }
                self.log(f"  S1: template-identity note shed — '{_sn_cur['value']}' corroborated "
                         f"in the issuer band (confidence 85, no note)")

        # ── G: GEOMETRY-WITNESS shed for the template-identity fill note ─────────────────────
        # (2026-07-31; gary→Oracle SIGN-OFF-W/COND; kill TEMPLATE_IDENTITY_GEOM_WITNESS, default
        # OFF = dark — a SIBLING of the band arm above, NEVER nested under its switch: Oracle G1.)
        # The band arm is majority-only + band-substring-fragile (proven INERT on its target class
        # — the S1 memory's DO-NOT-FLIP). This arm re-derives the issuer GEOMETRICALLY
        # (pick_issuer_geometry: the largest top-of-page name, recipient excluded by size+position,
        # two-candidate abstain — the SAME independent evidence LOGO_NAME_PRESENCE_ACCEPT already
        # trusts to let a logo assert un-noted at full confidence) and, when it AGREES with the
        # filled value, replaces the hedged fill with a normal read: conf 85 (hint parity —
        # do-NOT-raise pin: stays below the 95/100 floors until normal graduation), method
        # 'template_identity_corroborated', NO note. Tier-INDEPENDENT (the owner's doc-170 class:
        # a single-confirm supplier whose page prints its own letterhead heals immediately).
        # Geometry expression VERBATIM from the accept arm (Oracle G2) so born-digital docs heal
        # too; a cached-text reprocess has no page0 geometry → no witness → note kept (honest).
        # _flag_branding_conflict still re-judges the un-noted value at finalisation.
        if os.environ.get("TEMPLATE_IDENTITY_GEOM_WITNESS", "1") != "0":
            _sn_g = results.get("supplier_name")
            if (isinstance(_sn_g, dict) and _sn_g.get("method") == "template_identity"
                    and _sn_g.get("value")
                    and _sn_g.get("validation_note") in (_TEMPLATE_IDENTITY_FILL_NOTE_SINGLE,
                                                         _TEMPLATE_IDENTITY_FILL_NOTE_MAJORITY)):
                _geom_issuer_norm_g = None
                try:
                    from extraction import letterhead as _lh
                    _geom_g = page0_geometry or _lh.geometry_from_lines(page_text_lines)
                    if _geom_g and _geom_g.get("rows"):
                        _gp_g = _lh.pick_issuer_geometry(
                            ocr_text, _geom_g, detected_title=document_type,
                            type_phrases=_letterhead_type_phrases(self.patterns))
                        _geom_issuer_norm_g = self._accept_norm(_gp_g) if _gp_g else None
                except Exception:
                    _geom_issuer_norm_g = None   # any witness failure → keep the note (fail-safe)
                if self._should_shed_fill_note_geom(_sn_g, _geom_issuer_norm_g,
                                                    self._accept_norm(_sn_g.get("value"))):
                    results["supplier_name"] = {
                        "value":      _sn_g["value"],
                        "confidence": 85,
                        "method":     "template_identity_corroborated",
                    }
                    self.log(f"  G: template-identity note shed — the letterhead geometry reads "
                             f"'{_sn_g['value']}' (confidence 85, no note)")

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
                _r_on_reject = ((lambda fk, st, v, r, cap=None: self._t(
                    "anchor_reject", field=fk, method=st, value=v, reason=r, caption=cap))
                    if self._trace else None)
                try:
                    rescue_results = anchor.extract_with_anchors(
                        ocr_text, rescue_set, supplier_name, document_slug,
                        page_images=crop_pages,
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
                    if key in getattr(self, '_list_field_keys', ()):
                        continue                      # LIST ownership: the collect scan alone writes these
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

        # ── Stage 2.6b: LATE LOCATED CROP-CORROBORATION (Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-24) ──
        # See the module note at LATE_RESCUE_LOCATED_CORROB. When the supplier resolved late, the
        # keyword-filled critical ref/date whose taught anchor never ran gets capped by the taught-
        # ownership guard. Re-run ONLY those anchors, remember a genuinely-LOCATED read, and let the
        # UNCHANGED _anchor_corroborates suppress the cap. Corroborate-only — never writes results.
        if (LATE_RESCUE_LOCATED_CORROB and LATE_ANCHOR_RESCUE_ENABLED and anchors and page_images
                and _late_rescue_applicable(_s2_supplier, supplier_name)):
            _crit_keys = (({ref_field_key} if ref_field_key else set()) | set(date_field_keys or ()))
            # The guard-capped class: an OWNED (authoritative), same-type, resolved-supplier-only
            # (the late-rescue delta) CRITICAL anchor whose field currently holds a plain KEYWORD read.
            corrob_set = [a for a in anchors
                          if a.get("field_key") in _crit_keys
                          and (a.get("document_type") or "") == (document_slug or "")
                          and str(a.get("last_authoritative_at") or "").strip()
                          and anchor.anchor_admissible(a, supplier_name, document_slug)
                          and not anchor.anchor_admissible(a, None, document_slug)
                          and str((results.get(a.get("field_key")) or {}).get("method") or "") == "keyword"]
            if corrob_set:
                try:
                    corrob_results = anchor.extract_with_anchors(
                        ocr_text, corrob_set, supplier_name, document_slug,
                        page_images=crop_pages,
                        field_patterns=field_patterns,
                        validation_patterns=self.patterns.get("validation_patterns", {}),
                        format_lookup=self._make_format_lookup(supplier_name, document_slug),
                        page_transform=None,
                        page_text_lines=page_text_lines,
                        text_field_keys=text_field_keys,
                        multiline_lookup=self._make_multiline_lookup(supplier_name, document_slug),
                    ) or {}
                except Exception as e:
                    corrob_results = {}
                    self.log(f"  Stage 2.6b: located crop-corroboration failed ({e})", "warn")
                from extraction import validator as _validator
                _corrob_filtered = _filter_located_corrob(
                    corrob_results, {a.get("field_key"): a for a in corrob_set},
                    date_field_keys, anchor._SAME_LAYOUT_TOL_X, anchor._SAME_LAYOUT_TOL_Y,
                    _validator.normalise_date)
                if _corrob_filtered:
                    # Remember the FILTERED subset ONLY (Oracle C1 — do NOT mirror the unfiltered
                    # remember above); corroborate-only, results untouched.
                    self._remember_candidates('2.6_late_corrob', _corrob_filtered)
                    self._t("late_located_corrob", fields=list(_corrob_filtered.keys()),
                            values=[str(v.get("value"))[:24] for v in _corrob_filtered.values()])

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

        # ── Stage 2.5-witness: RAW-FRAME re-read of a deskew-corrupted taught crop ────────────
        # On a --deskew-pages reprocess ONLY (raw_page0 present), a taught crop read off the DESKEWED
        # page can carry a valid-SHAPED glyph flip from the rotation resample (PO-98370 → PO-98270)
        # that no regex catches and that then files silently at ref/date confidence. Re-read the RAW
        # page at the taught box and, on a TWO-READ consensus (raw crop + raw page text agree on a
        # DIFFERENT value), flip to it + flag (recover-and-flag; conf capped below the 88 floor so it
        # never auto-files — trust.js also refuses on the note). BYTE-IDENTICAL off the deskew path
        # (raw_page0 None → skipped) and under the kill switch DESKEW_RAW_WITNESS=0. Runs BEFORE Stage
        # 2.5d snap (Oracle §2: a witness after the snap would undo a legitimate dominant-snap). See
        # anchor.raw_crop_recheck for the fail-toward-review rules + the documented snap residual.
        if raw_page0 is not None and os.environ.get('DESKEW_RAW_WITNESS', '1') != '0':
            _witness_text = cached_text if cached_text else ocr_text   # raw cached text preferred
            _fmt_lookup = self._make_format_lookup(supplier_name, document_slug)
            _vpats = self.patterns.get("validation_patterns", {})
            _val_by_key = {f.get('key'): (f.get('type') or None) for f in field_defs}
            _lbl_by_key = {f.get('key'): (f.get('label') or None) for f in field_defs}
            _witness_keys = ({ref_field_key} if ref_field_key else set()) | set(date_field_keys or ())
            for _wk in _witness_keys:
                _d = results.get(_wk)
                if (not isinstance(_d, dict) or not _d.get('value')
                        or _d.get('validation_note')                    # already flagged → no double-flip
                        or _d.get('method') not in anchor._CROP_FAMILY_METHODS):
                    continue
                _res = anchor.raw_crop_recheck(
                    _d['value'], _d.get('taught_box'), raw_page0, _witness_text,
                    _val_by_key.get(_wk), _wk, _lbl_by_key.get(_wk),
                    _fmt_lookup, text_field_keys, _vpats)
                if _res:
                    _new_val, _note = _res
                    results[_wk] = {**_d, 'value': _new_val, 'display_value': _new_val,
                                    # cap at 70 (matches the existing :661 anchor_crop_crosscheck) —
                                    # well below the 88 critical floor even after any Stage-4.5 re-weight;
                                    # the validation_note is the primary auto-file guard (trust.js).
                                    'confidence': min(int(_d.get('confidence') or 0), 70),
                                    'method': 'anchor_crop_crosscheck',
                                    'was_corrected': True, 'corrected_to': _new_val,
                                    'validation_note': _note}
                    self.log(f"  Deskew raw-witness: {_wk} '{_d['value']}' → '{_new_val}' — the "
                             f"straightened read disagreed with the original scan; flagged for review")

        # ── Stage 2.5b: OCR format correction ────────────────────────────────
        if self.format_index:
            n_corrected = 0
            for key, data in list(results.items()):
                if not isinstance(data, dict) or not data.get("value"):
                    continue
                # LIST fields excluded from learned-format correction (gary 2026-08-11): a learned
                # "template" over varying-length delimited values is nonsense, and value_to_template
                # keeps separators as literals while try_correct rewrites at min(95,+20) with no
                # note (the separator-guard finding). Do not rely on length-mismatch masking.
                if key in getattr(self, '_list_field_keys', ()):
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
                    # Trace on ANY boost, not only a value change (Oracle C6): a CONFORMANCE-only
                    # lift (boost_table{0:8} — +8 for zero fixes, value unchanged) was previously
                    # INVISIBLE in the trace, which is precisely why the late-rescue cap leak
                    # (85 -> 93 -> 98) took a full day to find. Emitting it whenever boost>0 makes
                    # the dev-inspector's per-field lineage show why a rescued field gained conf.
                    self._t("transform", field=key, stage="2.5_correct",
                            method=results[key]["method"], confidence=new_conf, boost=boost,
                            changed=was_changed, **{"from": data["value"], "to": corrected_val})
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

        # A taught total that landed on the NET row (variable line-count credit note) can commit the
        # net silently when VAT didn't read (both reconcile safeties above starve). FLAG it — never
        # swap — when total≈subtotal AND a larger VAT-plausible total was also read. DEFAULT OFF.
        self._flag_net_misread_total(results, field_defs, credit_expected)

        # ── DECLARED-ABSENT FIELD DROP (TEMPLATE_HIDDEN_FIELD_DROP, DEFAULT OFF) ──────────────
        # gary design 2026-08-11 (owner: "unneeded fields incorrectly filled … when I remove them
        # and reprocess, they return again"). The operator's `template_hidden_fields` declaration
        # means "this supplier's layout does not print this field" — so a VALUE in that field is,
        # by definition, a read of something else on the page. ONE choke point, before Stage 4, so
        # no writer needs per-stage awareness and Stage 4/4.5 never see the ghost value (no
        # cross-field maths poisoning, no minted note, no score drag). SAME resolver + SAME
        # protected-keys strip as the scoring consumer below — one semantics, never two.
        # Human data is sacred: the drop is engine-values-only here; the JS reprocess merge keeps
        # any row the operator corrected (corrected_to). Unknown supplier ⇒ resolver returns empty
        # ⇒ no drop ⇒ fills flow to review (fail toward display, never a silent wrong drop).
        # Un-hide later ⇒ this block no-ops ⇒ the next reprocess fills again.
        if (os.environ.get("TEMPLATE_HIDDEN_FIELD_DROP", "0") != "0"
                and templates and supplier_name and document_slug):
            try:
                _hprot = {"supplier_name", "customer_name"}
                if ref_field_key:
                    _hprot.add(ref_field_key)
                if date_field_key:
                    _hprot.add(date_field_key)
                _hdrop = template_matcher.hidden_fields_for_scope(
                    templates, supplier_name, document_slug, protected_keys=_hprot)
                for _hk in sorted((_hdrop or {}).get("keys") or ()):
                    _hd = results.get(_hk)
                    if isinstance(_hd, dict) and _hd.get("value"):
                        self._t("hidden_field_drop", field=_hk,
                                value=str(_hd.get("value"))[:40], method=_hd.get("method"))
                        self.log(f"  Hidden-field drop: {_hk} '{str(_hd.get('value'))[:40]}' — "
                                 f"declared absent for this layout; cleared")
                        results[_hk] = {"value": None, "confidence": 0, "method": "unknown"}
            except Exception:
                pass   # resolver failure ⇒ no drop ⇒ today's behaviour

        # ── Stage 4: Validation ───────────────────────────────────────────────
        self.log("  Stage 4: validating…")
        self._t('stage_start', stage='4_validate')
        _pre_val = self._snap(results)
        results = validator.validate_and_adjust(
            results, field_defs, trace=(self._t if self._trace else None),
            credit_expected=credit_expected)

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
                # LIST fields skip the whole learned-shape/charset/wordness rail (gary 2026-08-11):
                # varying element counts make the learned skeletons incoherent (false flags after
                # 2-3 confirms), the charset would flag the '; ' separators, and per-element
                # validation already ran inside the collect scan. ACCEPTED COST: no shape rail on
                # a wrong list — the residual guard is element validation + review. Per-element
                # shape learning is a later slice, deliberately.
                if key in getattr(self, '_list_field_keys', ()):
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
                _sup_fmt = self.format_class_index.get((s_lower, dt_lower, key)) if s_lower else None
                fmt_entry = _sup_fmt if _sup_fmt else self.format_class_index.get(('', dt_lower, key))
                if not fmt_entry:
                    continue
                # Cross-contamination fix (kill SHAPE_WITHHOLD_SUPPLIER_SCOPED): _xsupplier means the shape
                # verdict rests ONLY on the cross-supplier ('') aggregate — this (supplier,field) has NO
                # confirmed history of its own. On a single-supplier install that ('') aggregate is one
                # supplier's ref convention wearing a doc-type-wide costume, so it may FLAG a cleanly-read
                # stranger's ref for review but must NOT hard-null it (one supplier's shape can't veto
                # another's). Consumed only by the terminal shape-withhold below; a supplier-scoped format
                # (_xsupplier False) keeps the byte-unchanged hard null. DEFAULT ON; kill switch =0 = legacy.
                _xsupplier = _sup_fmt is None
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
                        # Frame invariant: it self-locates — image_to_data and the crop run on the
                        # SAME page-image instance, whichever frame that is (it is NOT coupled to
                        # taught coordinates; deliberately OUTSIDE the DESKEW_RAW_CROPS election —
                        # Oracle 2026-08-05 delta-2; a later slice may move it, minding _reread_cache
                        # frame keying).
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
                        results[key] = _reread if _reread is not None else (
                            {
                                # Cross-contamination fix (SHAPE_WITHHOLD_SUPPLIER_SCOPED, DEFAULT ON since the
                                # flip; kill switch =0 restores the legacy null): a ('')-only shape verdict
                                # must not BLANK a cleanly-read stranger ref — keep
                                # the value + FLAG for review. conf<=70 + the note triple-lock it out of
                                # auto-file (the note alone blocks at every floor via trust.isAutoFileEligible;
                                # the cap is belt-and-braces). Value-kept means the operator verifies a value
                                # instead of an empty field. Only fires for _xsupplier (no supplier-scoped
                                # format); a supplier's OWN shape-violating ref still hits the hard null below.
                                **data,
                                'confidence':      min(data.get('confidence') or 0, 70),
                                'validation_note': 'format differs from the usual — please verify',
                            }
                            if (_xsupplier and os.environ.get('SHAPE_WITHHOLD_SUPPLIER_SCOPED', '1') != '0')
                            else {
                                **data,
                                'value':           None,
                                'confidence':      0,
                                'validation_note': "doesn't match the expected format — please enter manually",
                            }
                        )
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
        # CLIPPED-SUFFIX RECONCILIATION (2026-07-31, ON — kill CANDIDATE_SUFFIX_RECONCILE=0): a
        # label-confirmed anchor read whose misplaced crop cut the value's leading glyphs
        # ('V-69523') is shape-EXEMPT, so only the discarded keyword read of the same token can
        # expose it. Adopt-or-flag from the candidate ledger, no new OCR. BEFORE the
        # prefix-outlier guard so that guard judges the healed value.
        self._reconcile_clipped_suffix(results, field_defs, supplier_name, document_slug)
        # NAME-UNCLIP (Oracle 2026-08-04): the free-text complement, immediately after its code
        # sibling and before the S-C..D1 chain + the universal verify (which then judges the
        # HEALED value — order load-bearing, pinned in test_name_unclip_reconcile.py).
        self._reconcile_name_truncation(results, field_defs, ocr_text)
        # FILING-VALUE SANITY (Chris round 3, 2026-08-09 — default OFF). LAST of the value-changing
        # passes on purpose: it judges the value that will actually become the filename and the
        # folder, so it must see whatever the reconciles above finally settled on. Flag-only — it
        # never edits or replaces a value, it just refuses to let a non-reference-shaped reference
        # or a year that is not printed on the page file itself silently.
        self._flag_filing_value_sanity(results, ref_field_key, date_field_keys, ocr_text)
        # THE PAGE'S OWN WORDING IS NOT A VALUE (CAPTION_VALUE_REFUSE, default OFF — 2026-08-09 NIGHT).
        # Measured against what is actually PRINTED on 200 documents: `account_no` is committed on 40
        # pages that carry no account number at all (the job reference next to it wins), and `serials`
        # commits the literal string 'Serial No:' on 19. Those are the worst kind of wrong value —
        # not a misread of the right thing, but a confident value with NO SOURCE on the page, so a
        # human checking it has nothing to compare against. The same shape put the caption 'VAT' into
        # a VAT number and 'Delivery' into a delivery number.
        # The vocabulary is the run's own: every field's printed label bank plus each field's display
        # label, the same `value_is_caption` this file already uses to deny a poisoned hint. Equality
        # only — never containment — so a company genuinely called 'Total Office Supplies' survives.
        # WITHHELD, NOT REWRITTEN: the field goes empty WITH a note, which is the pattern the rest of
        # the pipeline uses to route to review (a bare empty would let a stale value return on the
        # next reprocess; the note is the discriminator).
        # AUTHORITY IS DELIBERATELY NOT AN EXEMPTION: a taught box that reads its own caption is
        # precisely the defect, and it arrives with the highest authority in the system.
        self._refuse_caption_values(results, _caption_vocab, field_defs)
        # ORDER PINNED (Oracle 2026-08-01, tests/test_validation_pass_order.py): suffix-reconcile
        # -> S-C blind-geometry -> S-A date-in-ref -> prefix-outlier -> S-B length guard.
        # S-C before S-A is load-bearing: on the #141 class S-C adopts the witnesses' 'DN-24408'
        # and S-A then sees a non-date (no stale date-flag on a healed value).
        self._reconcile_blind_geometry(results, field_defs, supplier_name, document_slug)
        self._flag_date_shaped_ref(results, field_defs, supplier_name, document_slug)
        # PREFIX-OUTLIER GUARD (2026-07-12): a shape-valid single-glyph misread of a ref field's
        # dominant code prefix (DN->IN) evades every format gate + auto-files at 95%+ on import; flag
        # it (cap 69 + note) so it can't silently file + poison learning. Flag-only, before the boost.
        self._flag_prefix_outlier(results, field_defs, supplier_name, document_slug)
        self._flag_ref_length_outlier(results, field_defs, supplier_name, document_slug)
        # D1 digit-disagreement flag — LAST in the note chain (Oracle 2026-08-01): it must
        # see every earlier arm's adoption/note (a suffix-adopted winner now EQUALS its
        # keyword ancestor -> structurally can't fire; an S-B-noted field is skipped).
        self._flag_digit_disagreement(results, field_defs, supplier_name,
                                      document_slug, ref_field_key)
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

        # ── LATE-RESCUE STICKY CAP (kill LATE_RESCUE_CAP_STICKY; 2026-07-24) ──────────────────────
        # engine.py:3572-3576 DOCUMENTS the invariant "a rescued ref/date can never auto-file at any
        # threshold" and enforces it at :3628 with min(conf, _LATE_RESCUE_CAP=85). Two later boosts
        # SILENTLY defeat it: Stage-2.5b conformance (ocr_corrector boost_table{0:8} — +8 merely for
        # MATCHING the learned shape, which a valid-shaped misread does BY CONSTRUCTION) then the
        # Stage-4.5 learned-agreement boost (+5), so 85 -> 93 -> 98 and a BLIND late-rescue crop
        # misread (supplier resolved late, no context) auto-files SILENTLY — the worst class, and the
        # real-world cold-start / new-supplier case, not a synthetic artefact. This TERMINAL re-cap
        # restores the invariant ONCE, after EVERY boost and before overall_confidence, keying on the
        # `late_rescue` provenance the rescue already stamps at :3629. It runs after all boosts and
        # there is no later max() on per-field confidence (engine.py:3182's max() is upstream, in
        # Stage-2 merge), so no boost can defeat it (Oracle C1: terminal, not per-site skips).
        # FAIL-TOWARD-REVIEW: the VALUE is untouched — only confidence returns to the cap, so a wrong
        # blind read is HELD (sub-88 critical floor / general threshold) instead of filed. Covers both
        # lifts by construction (Oracle C2: +8 alone -> 93, +5 alone -> 90, both > the 88 floor).
        # OFF (=0) skips the loop => byte-identical. Steady-state cost is low: rescue only fires when
        # the supplier resolved LATE (cold DB / unlearned / weak fingerprint), rare once suppliers are
        # learned. Pin: tests/test_late_anchor_rescue.py (post-extract cap survives the boosts).
        if os.environ.get("LATE_RESCUE_CAP_STICKY", "1") != "0":
            _recapped = _apply_late_rescue_sticky_cap(results)
            if _recapped:
                self.log(f"  Late-rescue sticky cap: {_recapped} field(s) returned to "
                         f"{_LATE_RESCUE_CAP} (a boost had re-inflated a blind-rescue read)")
        # ⚠ FORWARD SEAM (Oracle C5): if the "let a located rescue displace a keyword incumbent"
        # follow-up at :3577-3585 is ever built, a rescue could OVERWRITE a good keyword value and
        # this cap would then hold a value that WAS trustworthy — re-scope the marker there first.

        # ── Metadata ──────────────────────────────────────────────────────────
        # HIDDEN_FIELD_SCORING (Oracle-signed 2026-07-27): the operator's per-(supplier,type)
        # "this layout lacks this field" declarations (template_hidden_fields, riding the
        # templates JSON as hidden_fields) stop a declared-absent EMPTY field counting as an
        # expected-but-missing 0 in the document score — the "held at 72% with nothing flagged"
        # cap. EMPTY-ONLY: a valued hidden field scores exactly as before (its drag keeps a
        # ghost read out of the gate-free at-100 auto-file arm). protected strips the identity
        # keys + the type's CURRENT ref/date roles at consumption (stale-row seam: a role
        # re-pointed onto an already-hidden key after setHiddenField validated the hide).
        # Any failure ⇒ no exclusion ⇒ today's zero-scoring ⇒ held. =0 restores byte-identical.
        _hidden_excl = None
        if (os.environ.get("HIDDEN_FIELD_SCORING", "1") != "0"
                and templates and supplier_name and document_slug):
            try:
                _protected = {"supplier_name", "customer_name"}
                if ref_field_key:
                    _protected.add(ref_field_key)
                if date_field_key:
                    _protected.add(date_field_key)
                _hx = template_matcher.hidden_fields_for_scope(
                    templates, supplier_name, document_slug, protected_keys=_protected)
            except Exception:
                _hx = None
            if _hx and _hx.get("keys"):
                _hidden_excl = _hx["keys"]
                self.log(f"  Hidden-field scoring: {sorted(_hidden_excl)} declared absent for this "
                         f"layout (templates {_hx['template_ids']}, via {_hx['arm']}) — empty reads "
                         f"excluded from the document score")
        overall_conf  = validator.overall_confidence(results, field_defs, exclude_keys=_hidden_excl)
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
            # Reworded (owner + herald + Oracle 2026-08-01, shipped WITH the R1 link-on-confirm cure —
            # the promise "confirming will teach it" is only TRUE now that a plain confirm resolves the
            # template link and warms the young template). On the refuse path the COMMITTED type equals
            # the trusted heading's type by construction, so the old copy ("heading … doesn't match
            # this supplier's saved layout") read as a contradiction on a correctly-typed doc; say what
            # actually happened + what fixes it. The type NAME is threaded when known.
            _tn = str(document_type or '').strip()
            self._flag_type_ambiguity(
                results, ref_field_key,
                note=((f"Couldn't match this document to the supplier's saved {_tn} layout"
                       if _tn else "Couldn't match this document to a saved layout for the supplier")
                      + " — please check the document type; confirming will teach this layout."))

        # Crosscheck-outlier reconcile (Slice-1 — gary + Oracle SIGN-OFF-W/COND 2026-08-03). Owns the
        # flip-REFUTED direction of anchor.py's authoritative-crop cross-check (E2 at :4180 owns flip-
        # corroborated). Placed BEFORE G1/Fix-A so a restored value is then subject to their holds like
        # any other winner. Iterates EVERY field the crosscheck fired on (method=='anchor_crop_crosscheck'
        # — the current crosscheck scope: *_number/*_no/*reference*/date, custom included) and, when the
        # flip is an uncorroborated outlier vs a >=2-independent-family (>=1 crop-family) + page-present
        # alternative, restores that alternative (re-base anchor_inline@90, drop the flag — mirrors E2).
        # ALWAYS pops the transient _crosscheck_original stash so it never persists. Kill switch OFF =
        # byte-identical (anchor.py never stashes the key; this whole block is skipped).
        if CROSSCHECK_OUTLIER_RECONCILE:
            for _xk, _xd in results.items():
                if _xk.startswith("_") or not isinstance(_xd, dict):
                    continue
                if _xd.get("method") != "anchor_crop_crosscheck":
                    _xd.pop("_crosscheck_original", None)      # not a live flip here — just housekeep
                    continue
                _xis_d = _xk in (date_field_keys or ())
                _alt = _crosscheck_corroborated_alternative(
                    _xd, (self._field_candidates or {}).get(_xk) or [], ocr_text, _xis_d)
                _xd.pop("_crosscheck_original", None)          # consumed — never persist the stash
                if not _alt:
                    continue
                _restored = {**_xd,
                             "value":      _alt,
                             "method":     "anchor_inline",
                             "confidence": max(int(_xd.get("confidence") or 0), _CROSSCHECK_CORROB_CONF)}
                for _k in ("validation_note", "was_corrected", "corrected_to"):
                    _restored.pop(_k, None)
                results[_xk] = _restored
                self.log(f"  Crosscheck-outlier reconcile: {_xk} flip '{_xd.get('value')}' refuted by "
                         f"corroborated '{_alt}' — restored + flag dropped")

        # Slice-2 universal post-merge verify (gary+reggie+007 → Oracle SIGN-OFF-W/COND 2026-08-03).
        # Runs AFTER Slice-1 (an anchor_crop_crosscheck winner is Slice-1's decided territory —
        # skipped inside) and BEFORE G1/Fix-A so a restored value is subject to their holds like any
        # other winner. Gated UNIVERSAL_VERIFY_RESTORE / UNIVERSAL_VERIFY_FLAG (+ CENSUS log-only);
        # all three unset = byte-identical (the method returns immediately).
        self._universal_postmerge_verify(results, field_defs, ref_field_key,
                                         date_field_keys, ocr_text, supplier_name, document_slug)

        # G1 (VETO-FALLTHROUGH corroboration guard — gary design + Oracle SIGN-OFF-W/COND 2026-07-26).
        # On a doc whose template match arrived via the identity-veto FALL-THROUGH, the anchor family
        # newly activates on docs that previously ran anchor-less — and a LONE, page-absent critical
        # read can ride the conformance boost into a silent wrong file (#472: lone anchor_inline
        # 'PO-38093' @85→98 while the page prints 'PO-98093'; the exact #183 harvest-synthesis tell).
        # Hold-only: each critical winner must be corroborated (_fallthrough_critical_corroborated) or
        # it gains a validation_note — the note alone blocks auto-file via trust.js's flagged gate
        # (the DB-side gate honours a persisted note, NOT a bare _needs_review). No value/confidence/
        # method change; NO authoritative exemption (Oracle Q2 — the founding class is ⊕-taught);
        # snap/hint winners get the uniform hold (Oracle Q4). Fields already noted are SKIPPED
        # (one-note-per-field convention — a hold is already in force). Placement (C7): after the
        # type-refuse guard, BEFORE the final trace (so the note is visible there) and BEFORE
        # _build_candidate_emit. NOTE (Oracle C1): the candidate picker never arms on ref/date fields
        # (_build_candidate_emit is name-like-only), so this note text is the operator's ONLY
        # affordance — field-kind-aware and self-sufficient by design.
        if getattr(self, '_veto_fallthrough', False):
            _g1_crit = ({ref_field_key} if ref_field_key else set()) | set(date_field_keys or ())
            for _ck in sorted(_g1_crit):
                _cd = results.get(_ck)
                if not (isinstance(_cd, dict) and str(_cd.get("value") or "").strip()):
                    continue                                      # empty → other gates' concern
                if str(_cd.get("validation_note") or "").strip():
                    continue                                      # already held (skip, don't compose)
                _is_d = _ck in date_field_keys
                if _fallthrough_critical_corroborated(_cd, (self._field_candidates or {}).get(_ck) or [],
                                                      ocr_text, _is_d):
                    continue
                _kind = "date" if _is_d else ("reference" if _ck == ref_field_key else "value")
                _cd["validation_note"] = (f"This {_kind} couldn't be confirmed anywhere else on the "
                                          f"page — please check it against the document before filing.")
                results["_needs_review"] = True
                self.log(f"  Veto-fallthrough hold: {_ck} '{_cd.get('value')}' uncorroborated — held for review")

        # Fix A (#183 harvest-absence hold — gary design + Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-26).
        # The general-doc sibling of the G1 veto-fallthrough guard above: a CRITICAL anchor_inline winner
        # that _fallthrough_critical_corroborated can't confirm (no cross-family rail agrees, value absent
        # from the page) is the #183 skew-synthesis — HOLD it. Runs AFTER G1 so a fall-through doc that G1
        # already noted is SKIPPED (the validation_note check; one note per field, no double-note). Fix A's
        # condition is a strict SUBSET of G1's (same predicate + an anchor_inline filter), so on a veto-
        # fallthrough doc it adds nothing G1 didn't. Note-only, no value/method/confidence change. Kill
        # INLINE_HARVEST_ABSENCE_HOLD=0 (byte-identical off).
        if INLINE_HARVEST_ABSENCE_HOLD:
            _ia_crit = ({ref_field_key} if ref_field_key else set()) | set(date_field_keys or ())
            for _ck in sorted(_ia_crit):
                _cd = results.get(_ck)
                if not (isinstance(_cd, dict) and str(_cd.get("value") or "").strip()):
                    continue
                if str(_cd.get("validation_note") or "").strip():
                    continue                                      # G1/type-guard already held → skip
                _is_d = _ck in date_field_keys
                if _inline_absence_should_hold(_cd, (self._field_candidates or {}).get(_ck) or [],
                                               ocr_text, _is_d):
                    _kind = "date" if _is_d else ("reference" if _ck == ref_field_key else "value")
                    _cd["validation_note"] = (f"This {_kind} was read from the page layout but couldn't "
                                              f"be confirmed anywhere else on the document — please check "
                                              f"it before filing.")
                    results["_needs_review"] = True
                    self.log(f"  Inline-absence hold: {_ck} '{_cd.get('value')}' anchor_inline "
                             f"uncorroborated + page-absent — held for review")

        # ── CORROBORATION RECORD (owner principle 2026-08-11) ─────────────────
        # "It is more about corroboration than merely getting it right." Which INDEPENDENT method
        # families read the committed value — derived from the per-run candidate ledger, computed
        # AFTER every guard so it describes the final state. RECORD-ONLY by design: it moves no
        # value, no confidence, no gate — the ordered plan is record → surface → only then decide,
        # because a corroboration signal that starts by changing outcomes cannot be measured
        # against the outcomes it changed.
        _corrob = self._build_corroboration_emit(results)

        # Final resolved value per field — the inspector marks any earlier
        # candidate whose value differs from this as a superseded intermediate.
        if self._trace:
            for key, data in results.items():
                if key.startswith("_") or not isinstance(data, dict):
                    continue
                self._t("final", field=key, value=data.get("value"),
                        method=data.get("method"), confidence=data.get("confidence"),
                        note=data.get("validation_note"), corrob=_corrob.get(key))

        # ── Disambiguation picker: candidate map for flagged name fields ──────
        # Built LAST, after every flag guard, so a note applied late (identity /
        # caption-demotion) still arms the picker. Additive `_` metadata (popped +
        # woven into the per-field emit by process_docs); commits no value.
        results["_field_candidate_emit"] = self._build_candidate_emit(results, ocr_text)
        results["_corroboration_emit"] = _corrob

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
        # LIST ownership (2026-08-11): a list is per-document by nature too — replaying one
        # document's serial set onto another is the hint-fill failure mode with N values at once.
        # The variability guard can't protect a cold scope (needs >=2 distinct confirms).
        _lk = getattr(self, '_list_field_keys', None)
        if _lk:
            hints = [h for h in hints if (h or {}).get("field_key") not in _lk]

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
