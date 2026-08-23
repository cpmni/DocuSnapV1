"""
template_matcher.py
-------------------
Template-based document identification and extraction.

Templates are identified by logo hash (primary) or keyword fingerprint
(secondary). Once matched, field values are extracted using the template's
stored anchor rules rather than general keyword patterns.
"""

import os
import re
import difflib
from PIL import Image

STOP_WORDS = {
    'the', 'and', 'for', 'are', 'was', 'from', 'that', 'this', 'with',
    'have', 'not', 'but', 'you', 'all', 'can', 'her', 'his', 'our',
    'page', 'date', 'name', 'total', 'amount', 'number', 'order', 'invoice',
}

# Calendar words rotate with every single document — the same supplier's
# invoices say "January" one month and "August" the next, so a month or
# weekday name is the opposite of a stable identity signal even though it
# is a perfectly ordinary alphabetic word. Kept separate from STOP_WORDS
# (generic-vocabulary noise) because these are noise specifically *because*
# they vary per document, not because they're meaningless.
CALENDAR_WORDS = {
    'january', 'february', 'march', 'april', 'june', 'july',
    'august', 'september', 'october', 'november', 'december',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
}

# ── Hidden-field SCORING resolver (HIDDEN_FIELD_SCORING, Oracle-signed 2026-07-27) ──────────────
# Scoring twin of JS templates.getHiddenFieldsForSupplierType (templates.js): the UNION of the
# operator's per-template "this layout lacks this field" declarations across every template sharing
# the doc's (normalised supplier NAME, type slug), plus group_id siblings of any name-resolved row.
# Consumed by engine.py at overall-confidence time so a declared-absent EMPTY field stops counting
# as an expected-but-missing 0 (the "72% with nothing flagged" cap). DELIBERATE divergences from the
# display resolver, both fail-toward-review:
#   * NO branding-fingerprint backup arm — an unresolvable supplier name ⇒ no exclusion ⇒ the empty
#     field keeps its zero-score hold (display may hide a row scoring still counts; accepted residual).
#   * protected_keys (engine passes the identity keys + the type's CURRENT ref/date roles) are
#     stripped at consumption — closes the stale-row seam where a role is re-pointed onto an
#     already-hidden key AFTER setHiddenField validated it.
# _norm_name_for_vis must stay a byte-mirror of templates.js _normNameForVis — pinned by the shared
# vector file python_backend/tests/data/vis_norm_vectors.json (both suites read it).

_VIS_NORM_RE = re.compile(r"[^a-z0-9]+")


def _norm_name_for_vis(s) -> str:
    return _VIS_NORM_RE.sub(" ", str("" if s is None else s).lower()).strip()


def hidden_fields_for_scope(templates, supplier_name, document_slug, protected_keys=None):
    """UNION of hidden-field declarations for (supplier_name, document_slug).

    Returns {"keys": set[str], "template_ids": [int], "arm": str|None} — template_ids are the
    rows that CONTRIBUTED keys (for the trace line), arm is "name" or "name+group". Total
    function: any unresolvable input returns an empty result (⇒ no exclusion ⇒ held)."""
    out = {"keys": set(), "template_ids": [], "arm": None}
    slug = (document_slug or "").lower().strip()
    if not slug or not templates:
        return out
    q = _norm_name_for_vis(supplier_name)
    if len(q) < 3:                      # too short to match safely (mirror: fail toward "no exclusion")
        return out
    arms = {}                           # template id -> resolving arm
    for t in templates:
        if (t.get("document_type_slug") or "").lower() != slug:
            continue
        n = _norm_name_for_vis(t.get("name"))
        if n and (n == q or q in n or n in q):   # exact OR containment, mirror of the display rule
            arms[t.get("id")] = "name"
    # Group arm — ADDITIVE union of group_id siblings of any name-resolved row (no slug filter,
    # mirroring the JS group clause; grouped siblings are same-(name,type) by backfill construction).
    gids = {t.get("group_id") for t in templates
            if t.get("id") in arms and t.get("group_id") is not None}
    if gids:
        for t in templates:
            if t.get("group_id") in gids and t.get("id") not in arms:
                arms[t.get("id")] = "group"
    protected = set(protected_keys or ())
    used_group = False
    for t in templates:
        tid = t.get("id")
        if tid not in arms:
            continue
        keys = [k for k in (t.get("hidden_fields") or []) if k not in protected]
        if keys:
            out["keys"].update(keys)
            out["template_ids"].append(tid)
            if arms[tid] == "group":
                used_group = True
    if out["template_ids"]:
        out["template_ids"].sort()
        out["arm"] = "name+group" if used_group else "name"
    return out


# ── Distinctive-token identity primitives (TEMPLATE_GATE_DISTINCTIVE, Oracle-signed 2026-07-20) ──
# Generic document-TYPE / heading words that leak into template keyword-fingerprints and appear on
# ANY supplier's document of that type — so they never DISTINGUISH a supplier. THE definition lives
# HERE (template_matcher is a leaf; engine.py aliases it — engine imports this module, never the
# reverse) and is kept in sync with branding_fingerprint.js on the JS side.
_BRANDING_STOPWORDS = frozenset({
    "delivery", "docket", "note", "notes", "invoice", "order", "purchase", "sales",
    "statement", "remittance", "receipt", "quote", "quotation", "worksheet",
    "credit", "debit", "advice", "proforma", "job", "copy", "original",
})
# Shared branding-evidence constants (aliased by engine.py — ONE definition).
# K: below this many distinctive words an identity is UNJUDGEABLE (fail-safe, never "absent").
# PRESENT: own-ratio above this = the identity's own branding IS on the page.
_BRANDING_MIN_WORDS = 3
_BRANDING_PRESENT_RATIO = 0.25


def _distinctive_tokens(words):
    """The subset of `words` that can DISTINGUISH a supplier: lowercase, len>=3, not generic
    vocabulary/type/calendar words, and not a PROPER PREFIX of a type word. The prefix rule is what
    kills the ref-prefix garble family — 'INV' (split off "INV-76642" by the harvest tokeniser,
    digit-free so the digit filter never saw it) and 'INVOIC' (an OCR-clipped heading) are prefixes
    of 'invoice' and are systematically present in ~every invoice fingerprint, where they fake
    cross-supplier corroboration ('INV' word-boundary-matches inside every invoice number).
    Direction pinned: 'inverness' is NOT a prefix of any type word and survives."""
    out = set()
    for w in words or ():
        wl = str(w or "").strip().lower()
        if len(wl) < 3 or wl in _BRANDING_STOPWORDS or wl in STOP_WORDS or wl in CALENDAR_WORDS:
            continue
        if any(sw.startswith(wl) and len(wl) < len(sw) for sw in _BRANDING_STOPWORDS):
            continue
        out.add(wl)
    return out


def _distinctive_hit_ratio(template, ocr_lower):
    """(ratio, n): exact word-boundary presence of the template fingerprint's DISTINCTIVE tokens on
    the page, and how many distinctive tokens there were (n==0 ⇒ unjudgeable — the fingerprint is
    all junk, e.g. ['INV']). A SEPARATE function from _keyword_hit_ratio on purpose: that raw ratio
    is the page-wide template tie-break shared with the JS comparator and must stay byte-identical."""
    toks = sorted(_distinctive_tokens(template.get("keyword_fingerprint") or []))
    if not toks:
        return 0.0, 0
    hits = sum(
        1 for kw in toks
        if re.search(r"(?<![a-z0-9])" + re.escape(kw) + r"(?![a-z0-9])", ocr_lower)
    )
    return hits / len(toks), len(toks)


# NAME-arm distinctiveness (Oracle condition C): tokens of a supplier's display NAME that are
# generic corporate/vocabulary words carry no identity — without this filter, "Registered Office"
# plus an address 'City' in the top band scores the 'City Office' name arm 1.0 and a degraded
# GENUINE document false-abstains (re-breaking the "absence is not evidence" pin by another door).
_GENERIC_NAME_TOKENS = frozenset({
    "ltd", "limited", "plc", "inc", "llc", "llp", "gmbh", "corp", "company", "group",
    "holdings", "office", "offices", "services", "service", "supplies", "systems",
    "solutions", "trading", "registered", "enterprises", "international", "the", "and",
    "document", "documents",
})


def _name_arm_tokens(name):
    """Distinctive tokens of a supplier display NAME (for the rival name arm). Judgeable only when
    >=2 tokens SURVIVE the filters — a single surviving token ("Sterling") is never rival evidence
    ("pounds sterling" would match it on any page)."""
    toks = _distinctive_tokens(re.findall(r"[A-Za-z0-9]{2,}", str(name or "")))
    return {t for t in toks if t not in _GENERIC_NAME_TOKENS}


LOGO_THRESHOLD    = 13   # max hamming distance for logo match
# Text-corroborated same-type template RESCUE (Phillip, 2026-07-10): when the logo drifts OUT of the
# strict accept band (dist>6 -> conf<60) but a template of the DETECTED type has this much keyword-
# branding overlap, use it — a drifted-logo, right-supplier, right-type doc should still match its OWN
# template instead of getting NO template (and thus no field-fills). 0.80 > the 0.75 logoless floor
# because a wrong rescue MISFILES; the logo band is a wider backstop against a look-alike letterhead
# (unrelated 64-bit logos sit ~28-32 apart, so <=20 keeps an >=8-bit margin while admitting real drift).
RESCUE_KEYWORD_OVERLAP = 0.80
RESCUE_LOGO_BAND       = int(os.environ.get('RESCUE_LOGO_BAND', '20') or 20)   # env-tunable (test/tuning)
KEYWORD_THRESHOLD = 0.75 # min fraction of keywords that must be present
# Templates whose logos land within this hamming of the closest match are
# treated as the SAME-LOGO cluster — a supplier that issues several layouts
# under one letterhead (e.g. purchase orders AND worksheets). The logo can't
# tell those apart, so within the cluster the keyword fingerprint disambiguates.
_LOGO_AMBIG_MARGIN = 3
# FIX A (type-ambiguity guard, Oracle 2026-07-13): the band over which we test whether the logo-
# resolved SUPPLIER spans ≥2 DOC TYPES. WIDER than the pick margin (3) on purpose — a same-letterhead
# sibling's stored phash drifts double-digit Hamming per scan, so a real sibling can fall OUTSIDE
# margin-3 while a skewed incoming doc still lands near it; the SAFETY flag must over-detect where the
# PICK under-detects, or a same-logo type-flip auto-files un-flagged. The PICK stays on 3.
# ⚠ STALE-CLAIM CORRECTION (herald, measured 2026-07-31): the original "~28 unrelated-logo floor keeps
# a DIFFERENT supplier's letterhead out of the band" does NOT hold on real scans — 64-bit phash has
# ZERO cross-supplier separating power on same-layout corpora (doc 180's band held Copperfield@4,
# Ridgeway@8, Copperfield@12 against an Ironbridge pick). Distance cannot scope the band by supplier;
# the SINGLE-SUPPLIER COHESION filter below (TYPE_AMBIG_COHESION) does.
_AMBIG_LOGO_BAND = 13


def _letterhead_cohort(band, best_t):
    """SINGLE-SUPPLIER COHESION for the logo ambiguity/sibling band (2026-07-31; herald→Oracle
    SIGN-OFF-W/COND). VERBATIM parity with the keyword arm's load-bearing C1 guard
    (_kw_type_ambiguity, Oracle-signed 2026-07-13): a band template joins the pick's SAME-LETTERHEAD
    cohort only if it shares best_t's keyword FINGERPRINT set (works on a fresh sibling whose
    dominant_supplier is still null) OR the same NON-NULL dominant_supplier. Belt-and-braces: if the
    cohort still spans two DIFFERENT non-null suppliers, return None (caller treats as
    not-a-same-letterhead-coin-flip — the kw arm's exact bail). Pure."""
    bf_set = {w.lower() for w in (best_t.get('keyword_fingerprint') or [])}
    best_sup = (best_t.get('dominant_supplier') or '').strip().lower()
    cohort = [t for t in band
              if {w.lower() for w in (t.get('keyword_fingerprint') or [])} == bf_set
              or (best_sup and (t.get('dominant_supplier') or '').strip().lower() == best_sup)]
    sups = {(t.get('dominant_supplier') or '').strip().lower() for t in cohort}
    sups.discard('')
    if len(sups) > 1:
        return None
    return cohort


def _unsupported_rival_slugs(cohort, best_t, min_support=2):
    """A2 of the type-split arc (2026-08-22; gary → Oracle SIGN-OFF-W/COND S2-py-1). Over the pick's
    SAME-LETTERHEAD cohort, return (rival_slugs, unsupported_rival_slugs): every doc-type slug other than
    the pick's, and the subset carried ONLY by templates whose LIVE confirmed_count (confirmed docs, any
    via) is below `min_support` — judged per slug by the MAX count across that slug's templates, so a
    slug with one supported and one fresh template is still supported. The owner's incident: ONE
    mis-confirm bore a purchase_order template on a quote-only letterhead and `_type_ambiguity`
    weighed that 1-confirm slug as equal to the 24-confirm slug. ABSTAINS (returns (rivals, None))
    unless every cohort template carries `counts_live` — with TEMPLATE_LIVE_COUNTS=0 the stored column
    is under-counted (never bumped on create) and a supported rival would read 0. Pure; the matcher
    only EXPOSES this — the waiver itself is decided late, in the engine, against the doc's own ref."""
    pick = (best_t or {}).get('document_type_slug') or ''
    by_slug, live = {}, True
    for t in (cohort or []):
        s = t.get('document_type_slug') or ''
        if not s or s == pick:
            continue
        if not t.get('counts_live'):
            live = False
        by_slug[s] = max(by_slug.get(s, 0), int(t.get('confirmed_count') or 0))
    rivals = sorted(by_slug)
    if not live:
        return (rivals, None)
    return (rivals, sorted(s for s, c in by_slug.items() if c < min_support))


def _attach_rival_support(result, cohort, best_t):
    """A2: attach `rival_slugs` + `unsupported_rival_slugs` to an AMBIGUOUS match result (additive keys;
    non-ambiguous matches never carry them)."""
    rivals, unsup = _unsupported_rival_slugs(cohort, best_t)
    result['rival_slugs'] = rivals
    result['unsupported_rival_slugs'] = unsup
    return result


def _type_ambiguity(cands, base_dist, detected_slug, title_trusted, best_t=None) -> bool:
    """FIX A predicate (pure — Oracle SIGN-OFF-WITH-CONDITIONS). Is the logo-resolved supplier's TYPE
    ambiguous on this doc? TRUE when the logo cluster — taken over the WIDER `_AMBIG_LOGO_BAND` (jitter-
    immune; a real sibling's stored phash can sit >margin-3 from the pick) — spans ≥2 DISTINCT doc-type
    slugs AND no TRUSTED title resolves which one. That is exactly the popularity-coin-flip case
    (same-letterhead siblings carry identical fingerprints), so the engine holds the doc for review
    instead of auto-filing a guessed type. An UNTRUSTED detected_slug does NOT resolve (that IS the
    skew failure). TYPE_AMBIG_COHESION (2026-07-31, default ON — flipped after unit+realdoc+demo gates; kill =0): count slugs only over the
    pick's OWN letterhead cohort (_letterhead_cohort — the kw arm's C1 parity), so a cross-supplier
    phash collision inside the band can no longer manufacture "several document types" that this
    supplier never issues (herald: doc 180's 4 "types" were 3 other suppliers'). A genuine
    same-supplier multi-type letterhead with an untrusted title still flags (the designed case).
    Guarded by tests/test_template_type_ambiguity.py."""
    ambig = [t for (t, d) in cands if d <= base_dist + _AMBIG_LOGO_BAND]
    if best_t is not None and os.environ.get('TYPE_AMBIG_COHESION', '1') != '0':
        cohort = _letterhead_cohort(ambig, best_t)
        if cohort is None:
            return False        # spans two known suppliers → cross-supplier tie, never a coin-flip
        ambig = cohort
    slugs = {(t.get('document_type_slug') or '') for t in ambig if (t.get('document_type_slug') or '')}
    title_resolves = bool(title_trusted and detected_slug and detected_slug in slugs)
    return len(slugs) >= 2 and not title_resolves


def _logo_detail_veto(cands, base_dist, best_t, query_detail_hash, all_templates=None) -> bool:
    """SLICE C predicate (pure — Oracle/Phillip/oscar 2026-07-14). True → ABSTAIN the coarse logo pick:
    the scanned mark's 256-bit DETAIL hash disagrees per logo_detail.veto_by_detail — the refined
    POSITIVE-RIVAL semantic (the query must positively match a RIVAL's enrolled set), NOT the bare
    far-from-pick should_veto_logo (which trips on isolation garble; docstring corrected 2026-07-23 —
    the JS templates recheck DELIBERATELY uses the bare semantic instead, see
    database/modules/logoDetail.js for why the two diverge; since 2026-07-26 the two ALSO differ in
    rival UNIVERSE when LOGO_DETAIL_GLOBAL_RIVALS is on — the JS twin stays cluster-scoped). FALSE
    (keep, byte-identical) on: kill switch off; a missing query hash (isolate-fail); no rival within
    reach; or an empty stored set (Slice-B not yet accrued). So it can only turn a cross-supplier
    logo COLLISION into review, never drop a real single-supplier match.

    LOGO_DETAIL_GLOBAL_RIVALS (default OFF; Oracle A1 2026-07-26): veto_by_detail's own docstring case
    (doc-193 — the TRUE supplier's coarse phash drifted OUT of the cands band) is structurally
    unreachable when the rival universe is built from `cands`, because cands is cut at LOGO_THRESHOLD
    on the very 64-bit hash whose failure the veto polices (measured live 2026-07-26: 8/16 Saltmarsh
    dockets coarse-lock a WRONG supplier at ≤6 while every Saltmarsh template sits ≥14 — the true
    rival was invisible to the veto on all 4 incident docs). When armed AND `all_templates` is given,
    build BOTH sides (pick set + rivals) from ALL templates so neither side is scoped by the broken
    coarse hash. The positive-rival semantic, threshold, and the pm-None KEEP (logo_detail.py pin)
    are unchanged — only the search space widens. Guarded by tests/test_logo_detail_veto.py +
    tests/test_logo_detail_global_rivals.py."""
    if not query_detail_hash or os.environ.get('LOGO_DETAIL_VETO', '1') == '0':
        return False
    try:
        import logo_detail
        best_sup = (best_t.get('dominant_supplier') or '').strip().lower()
        pick_det = list(best_t.get('logo_detail_hashes') or [])
        other_det = {}
        # DEFAULT ON since 2026-07-26 (probe: 606 docs, 0 wrong, 0 false abstains; owner-flipped).
        _global = bool(all_templates) and os.environ.get('LOGO_DETAIL_GLOBAL_RIVALS', '1') != '0'
        _src = [(t, None) for t in all_templates] if _global else cands
        for (t, d) in _src:
            sn = (t.get('dominant_supplier') or '').strip()
            if not sn:
                continue
            hs = t.get('logo_detail_hashes') or []
            if sn.lower() == best_sup:
                pick_det.extend(hs)
            else:
                other_det.setdefault(sn, []).extend(hs)
        return logo_detail.veto_by_detail(query_detail_hash, pick_det, other_det)
    except Exception:
        return False   # best-effort; a broken veto must never break identification


def _detail_veto_single_supplier_immune(cands, cluster, best_t, best_dist, ocr_lower,
                                        query_detail_hash, all_templates=None) -> bool:
    """LOGO_DETAIL_VETO_SINGLE_SUPPLIER_IMMUNE (2026-08-23, iris finding → Oracle SIGN-OFF-W/COND;
    DEFAULT OFF). SUPPRESS a detail-veto abstain when the coarse pick is a CORROBORATED single-supplier
    lock AND the rival that tripped the veto is only MARGINAL.

    THE CLASS (Oakhaven): logo_detail._region crops the TOP-LEFT quadrant, but a CENTRE-top diamond mark
    is clipped, so _mark_bbox isolates a wordmark LETTER. A 256-bit hash of a letterform is colourway-
    unstable (blue sample vs black scan) and collides with any round glyph — so the mark 'disagrees with
    its OWN set' (>72) while a rival's round letter lands marginally (Nordwind 62). veto_by_detail then
    ABSTAINS a pick whose coarse phash is a dist-2 lock and whose own keyword branding is all over the page.

    PRESERVES the veto's real job (doc-193 / Saltmarsh): a DECISIVE rival — detail min ≤ the confident
    distance (48) — is a genuine positive cross-supplier identity and STILL vetoes. Only a MARGINAL rival
    (48 < m ≤ 72) over a corroborated single-supplier lock is immunised. ALL must hold:
      • tight coarse lock (best_dist ≤ 6) AND the ±margin cluster is ONE supplier (_letterhead_cohort);
      • the pick's OWN distinctive branding is on the page (the same gate as the refuse/text arms);
      • the triggering rival is MARGINAL: its min-over-set detail distance > logo_detail._confident_dist().
    Pure/best-effort: any miss → False (KEEP the veto). Implemented at the call site — veto_by_detail /
    _logo_detail_veto / anchor.try_logo_supplier_match are untouched (their pins + the anchor consumer
    stay byte-identical)."""
    try:
        if os.environ.get('LOGO_DETAIL_VETO_SINGLE_SUPPLIER_IMMUNE', '0') == '0':
            return False
        if best_dist is None or best_dist > 6:
            return False
        # the ±margin coarse cluster must resolve to exactly ONE supplier (None ⇒ spans ≥2 ⇒ not immune)
        if _letterhead_cohort(cluster, best_t) is None:
            return False
        # the pick's OWN branding must be present on the page (never immunise a lock whose letterhead
        # is not even here — that is the collision case TEMPLATE_LOGO_TEXT_GATE handles)
        _ro, _rk = _distinctive_hit_ratio(best_t, ocr_lower)
        if not (_rk > 0 and _ro >= _BRANDING_PRESENT_RATIO):
            return False
        # the triggering rival must be MARGINAL, not decisive — build the rival universe the SAME way
        # _logo_detail_veto does (global when armed) and take the closest rival's detail distance
        import logo_detail
        best_sup = (best_t.get('dominant_supplier') or '').strip().lower()
        _global = bool(all_templates) and os.environ.get('LOGO_DETAIL_GLOBAL_RIVALS', '1') != '0'
        _src = [(t, None) for t in all_templates] if _global else cands
        rival_min = None
        for (t, _d) in _src:
            sn = (t.get('dominant_supplier') or '').strip()
            if not sn or sn.lower() == best_sup:
                continue
            m = logo_detail.min_over_set(query_detail_hash, t.get('logo_detail_hashes') or [])
            if m is not None and (rival_min is None or m < rival_min):
                rival_min = m
        if rival_min is None:
            return False                                   # no rival to be marginal → keep the veto
        return rival_min > logo_detail._confident_dist()   # marginal ⇒ immune; decisive (≤48) ⇒ keep veto
    except Exception:
        return False   # best-effort; a broken immunity check must never break identification


def _band_siblings(cands, base_dist, best_t=None) -> dict:
    """FIX B1 (suggest-only): {doc_type_slug: closest template} over the SAME wider `_AMBIG_LOGO_BAND`
    the ambiguity test uses (NOT the margin-3 pick cluster — a real drifted sibling can sit at Hamming
    ~8, inside the band, outside the pick margin; a `detected_slug`-only pick would silently under-reach
    it). identify_template EXPOSES this so process_docs can resolve the correct sibling from the doc's
    ref-prefix and PIN it, without coupling this pure matcher to the learned-value model (gary).
    TYPE_AMBIG_COHESION (2026-07-31): scoped by the SAME _letterhead_cohort as _type_ambiguity
    (Oracle: the two must stay coherent) — a cross-supplier band template must never be offered as a
    ref-prefix sibling, which also closes the latent cross-supplier surface in
    resolve_type_by_ref_prefix (ocr_corrector)."""
    band = [t for (t, d) in cands if d <= base_dist + _AMBIG_LOGO_BAND]
    if best_t is not None and os.environ.get('TYPE_AMBIG_COHESION', '1') != '0':
        cohort = _letterhead_cohort(band, best_t)
        band = cohort if cohort is not None else []
    out = {}
    for t in band:
        slug = t.get('document_type_slug') or ''
        if slug and slug not in out:          # cands are distance-sorted → first per slug is closest
            out[slug] = t
    return out


def _type_refuse(detected_slug, template_slug):
    """C1 (TYPE-heading authority): the sentinel returned by the trusted-title REFUSE — a TRUSTED
    heading declares a document type that the matched template does NOT carry. It behaves as
    "no template" for EVERY downstream reader (`template` is None, so `(m or {}).get('template')`
    stays None exactly like the old `return None`), but the engine reads `type_refused` to HOLD the
    doc for review — a FALSELY-trusted heading (e.g. a leftmost mid-body table column that reads
    like a type name) that discards the real template must fail toward review, never auto-file a
    detection-only type at overall==100 (docTrustGate is skipped at 100). Kill switch
    TYPE_REFUSE_HOLD=0 → None, i.e. byte-identical to the pre-C1 refuse (the required C5(a) gate)."""
    if os.environ.get('TYPE_REFUSE_HOLD', '1') == '0':
        return None
    return {'template': None, 'type_refused': True,
            'detected_slug': detected_slug, 'refused_slug': template_slug or None}


# ── TYPE-PRESENCE VETO (Type Slice 1, 2026-07-28) ────────────────────────────────────────────────
# The consume side of database/modules/typePresence.js (parity). The learn side threads, per template,
# {type_heading_ratio, type_heading_n, type_heading_tokens}; here we HOLD a logo-collision pick whose
# OWN type reliably prints its heading but whose heading is ABSENT from THIS candidate's top band.
def _type_presence_top_band(ocr_lower):
    """First ~14 lines / 600 chars of the (already-lowered) candidate text — the TITLE band. Same
    shape as typePresence.js.topBand (parity)."""
    return '\n'.join((ocr_lower or '').split('\n')[:14])[:600]


def _type_heading_present(tokens, band):
    """True <=> >=0.6 of `tokens` present as WHOLE WORDS in `band`. Mirror of typePresence.js
    headingPresent (and the namePresence ratio). `tokens` are pre-computed [a-z0-9]+ (regex-safe)."""
    if not tokens or not band:
        return False
    text = band.lower()
    present = sum(1 for t in tokens if re.search(r'\b' + re.escape(t) + r'\b', text))
    return present >= 1 and (present / len(tokens)) >= 0.6


# TYPE-heading generic tokens = the JS typePresence.TYPE_GENERIC_TOKENS set (namePresence.
# GENERIC_NAME_TOKENS ∪ {note, document}). DELIBERATELY DISTINCT from _GENERIC_NAME_TOKENS above (the
# name-arm distinctiveness set, which diverges — office/systems/solutions/... — see that comment) so
# the keyword-path type-presence gate scores the IDENTICAL token set the JS learn side threads for the
# template path. Parity-pinned by tests/test_type_heading_tokens.py against typePresence.typeHeadingTokens.
_TYPE_GENERIC_TOKENS = frozenset({
    "ltd", "limited", "plc", "llp", "inc", "incorporated", "co", "company", "corp",
    "group", "holdings", "services", "service", "the", "and", "note", "document",
})


def _type_heading_tokens(name, aliases=None):
    """Distinctive [a-z0-9]{3,} tokens of a type NAME (∪ its printed-title aliases), minus generics —
    the Python twin of typePresence.typeHeadingTokens (parity-pinned). Order-preserving, de-duped, so
    the keyword-path presence gate and the JS-threaded template-path veto score one token set."""
    src = " ".join(str(x) for x in ([name] + list(aliases or [])) if x)
    seen = set()
    toks = []
    for t in re.findall(r"[a-z0-9]+", src.lower()):
        if len(t) >= 3 and t not in _TYPE_GENERIC_TOKENS and t not in seen:
            seen.add(t)
            toks.append(t)
    return toks


def _type_heading_absent(best_t, ocr_lower):
    """TYPE-PRESENCE VETO predicate. True => HOLD: `best_t`'s OWN type reliably prints its heading
    (learned ratio threaded from templates.js) but that heading is ABSENT from this candidate's top
    band. FAIL-TOWARD-ABSTAIN on every doubt — not armed / thin scan / heading present / any error →
    False. Thresholds env-overridable (TYPE_PRESENCE_{RATIO,MIN_SAMPLE,MIN_TOKENS})."""
    try:
        tokens = best_t.get('type_heading_tokens') or []
        if not tokens:
            return False

        def _envf(k, d):
            try:    return float(os.environ.get(k, d))
            except (TypeError, ValueError):  return float(d)

        def _envi(k, d):
            try:    return int(os.environ.get(k, d))
            except (TypeError, ValueError):  return int(d)

        try:
            ratio = float(best_t.get('type_heading_ratio') or 0)
            n     = int(best_t.get('type_heading_n') or 0)
        except (TypeError, ValueError):
            return False
        if n < _envi('TYPE_PRESENCE_MIN_SAMPLE', 3):          # young / unlearned template -> abstain
            return False
        if ratio < _envf('TYPE_PRESENCE_RATIO', 0.80):        # type doesn't reliably print its heading
            return False
        if len(re.findall(r'[a-z0-9]+', ocr_lower or '')) < _envi('TYPE_PRESENCE_MIN_TOKENS', 50):
            return False                                      # thin/failed scan -> never veto
        return not _type_heading_present(tokens, _type_presence_top_band(ocr_lower))
    except Exception:
        return False


# ── TEMPLATE_IDENTITY_ON_PAGE (2026-08-10) — a template may not claim a document that does not
# carry its own company name. Default OFF (=1 arms); OFF is byte-identical.
#
# THE DEFECT IT EXISTS FOR, measured end to end. Confirming ONE purchase order created a template
# for 'Quillstone Print & Packaging'. On a document a business ISSUES ITSELF the letterhead is its
# OWN — so `extract_keyword_fingerprint`, doing exactly what it was designed to do (harvest the
# header, stop at the recipient marker), captured
#   ["Bramblewood","Joinery","Ltd","PURCHASE","Unit","Sawpit","Lane","Draymarket","Tel","VAT"]
# — the OWNER's own address block. That block is printed on EVERY document the business RECEIVES,
# as the Bill To / Deliver To block. Scored against one document from each of ten suppliers, that
# fingerprint hits 0.80 on every single one (0.90 on one, 1.00 on its own). It is not an identity
# signal; eight of its ten words identify the RECIPIENT.
# `_match_by_keywords` has a 0.75 floor at its call site — what it has NO margin for is the
# runner-up, so a template need only BEAT the others, not be good. (A margin would have been
# VACUOUS here: the customer had no Oakhaven template, so the poisoned one had no rival to be
# margined against — which is why raising the floor is not the fix either; it would have to go
# above 0.80 and would re-gate every supplier's admission on no measurement.)
# So 18 Oakhaven Electrical delivery notes were claimed by the Quillstone template
# and stamped `supplier_name = 'Quillstone Print & Packaging'` at 95 via the frozen `template_fixed`
# seed. One was confirmed by a user (nothing on screen suggested the company was wrong) and FILED
# INTO THE WRONG COMPANY'S FOLDER, with the true supplier's VAT number in the XML beside it. The
# issuer decides the output folder and the whole per-supplier learning scope.
# **This generalises to every customer who files their own purchase orders.**
#
# THE GUARD: the template's own name must appear on the page. Measured on 200 documents, keyword
# path, `detected_slug=None` (the failing path):
#   RIGHT match, name on page   160  -> kept
#   WRONG match, name absent     40  -> refused
#   RIGHT match, name absent      0  <- the cost, and it is zero on this corpus
# Perfect separation, which is why this is a whole-page presence test and not a threshold: it keys
# on the actual error (this template's company is not mentioned on this document) rather than on a
# number that would have to be tuned.
#
# SCOPED TO THE TEXT ARMS ON PURPOSE — but NOT because the logo arm is safe (Oracle C5). The logo
# arm has `decide_logo_text_gate`, which distinguishes "branding absent" from "unjudgeable" and
# must keep that nuance, because a logo-only letterhead is a real thing that the text arms cannot
# serve. It is NOT a guarantee: on this very corpus the ONE wrong sender that survives this guard
# came through the logo arm (Castellan stamped on an Oakhaven delivery note). It is caught by the
# BRANDING guard rather than by identification — capped to 69 with "This document's letterhead
# doesn't match 'Castellan Security Systems'. Please confirm the correct company." — so it lands
# below the auto-file floor with the reason on screen, which is the safe state but not a clean one.
# The keyword arm, by contrast, had no identity gate of any kind.
#
# NAMED TRADE-OFF, pinned: a supplier whose name is genuinely NOT printed anywhere on the page — a
# pure-wordmark letterhead — and whose fingerprint is nonetheless a good identity signal, now falls
# through to review instead of matching. Zero such cases in 200 documents. The failure direction is
# a document that needs a human, not a document filed under the wrong company.
# WHY NOT FIX IT AT BUILD TIME (the fingerprint) instead: measured. Requiring a template's own name
# to appear in its own FINGERPRINT refuses the offender — and also refuses 'Ironclad Tool Hire',
# whose letterhead sits in the page FOOTER, outside the 20-line harvest window. The page knows what
# the fingerprint cannot.
_IDENTITY_ON_PAGE_ON = os.environ.get('TEMPLATE_IDENTITY_ON_PAGE', '0') != '0'
# HOLD THE SIBLINGS (owner decision 4, 2026-08-13). A teach that replaces a template's frozen
# identity with a genuinely DIFFERENT company commits — a wrong frozen name must stay correctable —
# but it must not stamp every sibling at 95 on one document's evidence. `templates.identity_
# unconfirmed` (migration 65) marks such a template until a second document agrees; see
# extract_with_template. DEFAULT OFF; the column is inert without it.
_HOLD_PENDING_IDENTITY = os.environ.get('TEMPLATE_IDENTITY_HOLD_SIBLINGS', '0') != '0'
# BUYER-ISSUED TYPE SCOPE (slice 2 of the buyer-issued arc; slice 1 shipped as ca0bb49). A template
# marked `buyer_issued` (migration 66) may not win a TEXT arm on a document whose own trusted title
# declares a different type. DEFAULT OFF; see _match_by_keywords for the full reasoning.
_BUYER_ISSUED_TYPE_SCOPE = os.environ.get('TEMPLATE_BUYER_ISSUED_TYPE_SCOPE', '0') != '0'
# The identity field keys, mirroring database/modules/document_types.COMPANY_KEYS (migration 44:
# customer_name was unlinked from identity, so this is deliberately ONE key).
_COMPANY_KEYS = ('supplier_name',)
try:
    _IDENTITY_PRINTS_RATIO = float(os.environ.get('TEMPLATE_IDENTITY_PRINTS_RATIO', '0.80'))
except ValueError:
    _IDENTITY_PRINTS_RATIO = 0.80
# YOUNG-IDENTITY CORROBORATION (2026-08-11, Chris r2 finding 1 — the leak the abstain left open).
# The wordmark carve-out below ABSTAINS whenever the confirmed history cannot say "this supplier
# normally prints its name" (count < 1 or ratio < floor) — and a template is at its least
# corroborated exactly when it is YOUNGEST, while its stamping authority is already full at n=1.
# Chris's garble teach ('@a eens Ee', count 0 at claim time) rode that abstain onto 20 Oakhaven
# delivery notes at 95 via the KEYWORD arm (verified by trace: "Template matched: @a eens Ee (80%
# via keywords)" while the guard refused the two healthy templates on the same page). Until a
# frozen-supplier template has _IDENTITY_YOUNG_N corroborating confirms, an abstain therefore
# falls back to the presence test instead of admitting. 0 restores the old unconditional abstain.
try:
    _IDENTITY_YOUNG_N = int(os.environ.get('TEMPLATE_IDENTITY_YOUNG_N', '3'))
except ValueError:
    _IDENTITY_YOUNG_N = 3


def identity_present_on_page(name, ocr_text) -> bool:
    """Does `name` (a template's company) actually appear on this page as text?

    >=60% of the name's distinctive tokens (>=3 chars, minus generic company suffixes) present as
    WHOLE WORDS. Shared with engine._template_identity_corroborated, which asks the same question of
    the FILL path — one notion of "this company is named on this document", not two that drift.
    FAIL-SAFE: no name or no text -> False (unjudgeable reads as absent HERE, because the caller's
    fallback is review, which is the safe direction for a claim of identity)."""
    if not name or not ocr_text:
        return False
    _GENERIC = {"ltd", "limited", "plc", "llp", "inc", "incorporated", "co", "company", "corp",
                "group", "holdings", "services", "service", "the", "and"}
    toks = [t for t in re.findall(r"[a-z0-9]+", str(name).lower())
            if len(t) >= 3 and t not in _GENERIC]
    if not toks:
        return False
    text = str(ocr_text).lower()
    present = sum(1 for t in toks if re.search(r"\b" + re.escape(t) + r"\b", text))
    return present >= 1 and (present / len(toks)) >= 0.6


def _template_identity(cand) -> str:
    """The identity a template ASSERTS — mirrors templates.js `establishedIdentity` (Oracle C1).

    Order: the DOMINANT confirmed issuer (live truth), else the FROZEN `supplier_name` fixed value
    (what `template_fixed` would stamp), else '' = unjudgeable.

    **NEVER the cosmetic `templates.name`.** That rule is not mine and it is not new — this codebase
    has ruled it twice (`templates.js` "it is first-confirm luck, can be an OCR garble, and plays no
    role in matching/filing/learning scope"; `namePresence.js` "NEVER the cosmetic template name").
    My first version of this guard read `name`, and Oracle caught three consequences, all real:
      * an auto-generated "Purchase Order Template" name scores 2 of its 3 tokens ({purchase, order})
        on every purchase order ever printed, so the guard would have PASSED exactly the
        unresolved-supplier templates most likely to be poisoned;
      * an admin RENAME in the Template Manager would silently stop a template matching its own
        documents for ever — and `rename()` documents in-code that it "can never affect extraction,
        identification";
      * a garbled first-confirm name would permanently blind a correct template.
    """
    for key in ('dominant_supplier',):
        v = str((cand or {}).get(key) or '').strip()
        if v:
            return v
    for f in ((cand or {}).get('fields') or []):
        if (f or {}).get('field_key') == 'supplier_name' and not (f or {}).get('is_variable'):
            v = str((f or {}).get('fixed_value') or '').strip()
            if v:
                return v
    return ''


def _has_frozen_supplier(cand) -> bool:
    """True when this template carries a NON-VARIABLE supplier_name fixed value — i.e. it would
    stamp that identity at 95 via template_fixed on every document it claims. This is the harm
    vector the young-identity fallback exists for; templates without one are out of its scope."""
    for f in ((cand or {}).get('fields') or []):
        if (f or {}).get('field_key') == 'supplier_name' and not (f or {}).get('is_variable'):
            if str((f or {}).get('fixed_value') or '').strip():
                return True
    return False


def _identity_log(cand) -> None:
    """C4 — a refusal must never be silent.

    STDERR, not stdout: `process_docs.py` streams the JSON protocol on stdout and a stray line there
    corrupts a whole batch. The Electron side already forwards Python stderr into the app log
    (`processing/handler.js` — `logger.warn('Python stderr: ...')`), so this is retrievable from a
    support bundle without any new plumbing. Same channel `template_mapper.py` uses for its own
    inert-flag warning.

    Why it matters: without it, the customer whose supplier does not print its name in text sees a
    taught layout quietly stop working, re-teaches it, gets a second template with the same absent
    name, and is refused again — with nothing to read anywhere explaining why."""
    try:
        import sys as _sys
        _sys.stderr.write(
            f"[template_matcher] identity guard: template {cand.get('id')} "
            f"({_template_identity(cand)!r}) is not named on this page - not a candidate\n")
    except Exception:
        pass


def _identity_refuses(cand, ocr_text) -> bool:
    """True -> this candidate may not be admitted by a TEXT arm (see the flag block).

    ABSTAINS unless the template's own confirmed history says this company is NORMALLY PRINTED
    (Oracle C3). `supplier_prints_name` = {supplier, ratio, count}, computed by
    namePresence.supplierNamePresenceRatio over that supplier's confirmed documents and threaded on
    the templates payload. Refuse on absence only when ratio >= 0.80; otherwise abstain.

    WHY THAT CARVE-OUT IS THE POINT, not caution: a supplier whose letterhead is a pure WORDMARK —
    a graphic with no company name in text anywhere — would otherwise be refused by every text arm,
    permanently, and the logo arm cannot save them because it only accepts a clean lock (dist <= 6)
    while this file's own measurement records same-supplier phash drift reaching 36 on scans. The
    ratio answers "does THIS supplier print its name?" from that supplier's own documents, so the
    wordmark case is carved out BY MEASUREMENT rather than by hope.

    NO `count >= 3` FLOOR ON THE REFUSE DIRECTION, DELIBERATELY, and this sentence is load-bearing:
    the sibling guard `nameBearingButAbsent` requires three confirmed documents, and that is the
    exact gate that slept through this defect — a template acquires full authority at n=1 and stamps
    its issuer at 95 on document #1. Requiring three before the guard may REFUSE would re-open the
    hole this guard exists to close. Do not "restore parity" with the JS twin.

    THE ADMIT DIRECTION IS DIFFERENT (2026-08-11): the abstain used to ADMIT unconditionally, and a
    garbled teach is indistinguishable from a wordmark supplier at n<=1 — Chris's '@a eens Ee'
    template (count 0-1, ratio unjudgeable) claimed 20 Oakhaven delivery notes through exactly this
    door. While the history is YOUNG (count < _IDENTITY_YOUNG_N) an abstain now falls back to the
    page-presence test: a young frozen-supplier template may only claim pages that actually name it.

    THE YOUTH METRIC IS THE FROZEN-STRING CONFIRM COUNT, DELIBERATELY (Oracle C1, both branches
    weighed). `supplier_prints_name.count` counts confirmed docs whose supplier equals the FROZEN
    string exactly (namePresence.js). The alternative — the template's own bound-document count —
    was REJECTED because wrong confirms mature the poison: in the reproducing sandbox the garble
    template carries 21 confirmed docs (the operator File-All-Ready'd the leak), which would read
    as "mature" and re-open the exact hole. Neither metric survives careless bulk confirms; this
    one at least keys on the identity the template would STAMP. Two consequences, ACCEPTED and
    pinned in test_identity_on_page.py rather than hidden:
      (a) NOT merely temporary: a genuine wordmark supplier whose operator types the issuer
          differently from the frozen value at confirm keeps count(frozen)=0 and stays young —
          refused until a confirm matches the frozen string (or the value is corrected). Fails
          toward review, logged to stderr, but it is a real "taught it and it never catches" cost.
      (b) split-brain: frozen garble + dominant corrected to the real name — the presence test
          evaluates the DOMINANT name (it is what `_template_identity` returns first), so the
          template matches pages naming the real supplier while `template_fixed` still stamps the
          frozen garble. The garble class is fully closed only while dominant == frozen; the
          branding guard and name-presence veto are the rails on the stamped value itself.
    RESIDUAL, named: three confirms of the garbled STRING graduate it into the protected carve-out.
    The issuer-plausibility warn at teach time and Learning Repair are the upstream/downstream
    answers to that.
    """
    if not _IDENTITY_ON_PAGE_ON:
        return False
    identity = _template_identity(cand)
    if not identity:
        return False                                  # unjudgeable -> today's behaviour
    stats = (cand or {}).get('supplier_prints_name') or {}
    try:
        ratio = float(stats.get('ratio') or 0)
        count = int(stats.get('count') or 0)
    except (TypeError, ValueError):
        return False
    if count < 1 or ratio < _IDENTITY_PRINTS_RATIO:
        # This supplier's history cannot vouch that it prints its name. Mature history -> the
        # wordmark carve-out stands (abstain -> admit). Young history -> the abstain must not
        # admit: require the page itself to name the claimed identity. SCOPED to templates that
        # would actually STAMP the identity (a frozen supplier_name fixed value) — a
        # variable-supplier template does not commit template_fixed identity, so its admission
        # behaviour is unchanged (gary's scope note; stats are only threaded for frozen ones).
        if _IDENTITY_YOUNG_N > 0 and count < _IDENTITY_YOUNG_N and _has_frozen_supplier(cand):
            return not identity_present_on_page(identity, ocr_text)
        return False
    return not identity_present_on_page(identity, ocr_text)


def identify_template(page_image, ocr_text: str, templates: list,
                      detected_slug: str | None = None,
                      title_trusted: bool = False,
                      query_detail_hash: str | None = None) -> dict | None:
    """
    Try to match this document to a known template.
    Returns {'template': {...}, 'confidence': int, 'method': str, 'logo_phash': str}
    or None if no match.

    `detected_slug` / `title_trusted`: the document's OWN doc-type signal, from
    keyword.detect_document_type (the caller computes both ONCE and threads them
    identically here and into engine.extract). A supplier issues several layouts
    under ONE letterhead, so their templates share the logo AND — because the
    keyword fingerprint is the letterhead words — an IDENTICAL fingerprint; the
    fingerprint tie-break then can't tell a "Sales Order" from a "Worksheet" and
    the established sibling wins, stamping the wrong type. `detected_slug` breaks
    that tie by the document's title (`title_trusted` = the title is a real
    standalone HEADING, not a body mention). Both default off → byte-identical.
    """
    if not templates:
        return None

    ocr_lower  = ocr_text.lower()
    logo_phash = None
    # LOGO_REFUSE_FALLTHROUGH (default ON): when the type-blind logo arm locks a WRONG-TYPE same-letterhead
    # sibling, capture the refuse + the supplier the logo locked (dist<=6), then FALL THROUGH to the
    # same-type rescue / keyword arm below (they resolve the right-type sibling the logo can't). Re-emitted
    # at the end iff nothing right-SUPPLIER resolves (Oracle C1 guard). OFF ('0') ⇒ both stay None ⇒ the
    # refuse returns immediately at its original site ⇒ byte-identical.
    _logo_refused = None
    _refused_supplier = None
    # LOGO_REFUSE_SUPPLIER_CORROB (Phillip/Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-27): two-factor the
    # logo-refuse supplier guard so a 64-bit phash COLLISION (a foreign look-alike letterhead, measured
    # cross-supplier Hamming 0-6 = zero separation) can't block the correct same-type rescue. OFF ⇒ the
    # guard is byte-identical to the af346d8 C1 (capture the locked supplier unconditionally + blanket-allow
    # the unknown-supplier branch).
    _supplier_corrob = os.environ.get('LOGO_REFUSE_SUPPLIER_CORROB', '1') != '0'

    def _fallthrough_supplier_ok(cand):
        # Oracle C1: on the captured-refuse fall-through, a rescue/keyword match for a DIFFERENT known
        # supplier than the logo locked is a look-alike collision, NOT the right-type sibling → reject it
        # (→ re-emit the refuse / hold). A null candidate supplier = a fresh same-letterhead sibling of the
        # right type by construction → allow. No refuse captured (the normal accept path) → always allow.
        if _logo_refused is None:
            return True
        if not _refused_supplier:
            # The logo-locked supplier is unknown — a fresh/unconfirmed sibling, OR (under
            # LOGO_REFUSE_SUPPLIER_CORROB) a text-uncorroborated phash collision whose foreign supplier
            # we declined to trust as a blocker below. Can't judge cross-supplier by NAME → require the
            # CANDIDATE's OWN distinctive branding on the page instead (Oracle C-1, mirrors the veto C3
            # at :307): an all-generic/junk foreign fingerprint has n==0 and can NEVER clear it → the
            # rescue is blocked → re-emit the refuse/hold (fail-toward-review). Switch OFF ⇒
            # _refused_supplier is always captured, so this branch only ever sees the genuine
            # fresh-sibling case and stays the old blanket allow ⇒ byte-identical.
            if not _supplier_corrob:
                return True
            _o, _k = _distinctive_hit_ratio(cand, ocr_lower)
            return _k > 0 and _o >= _BRANDING_PRESENT_RATIO
        ds = (cand.get('dominant_supplier') or '').strip().lower()
        return (not ds) or (ds == _refused_supplier)

    # TEMPLATE_VETO_FALLTHROUGH (Slice C — Oracle SIGN-OFF-WITH-CONDITIONS C1-C5, 2026-07-26; default
    # OFF ⇒ the three identity-veto sites below `return None` exactly as before ⇒ byte-identical).
    # When an IDENTITY veto — the 256-bit mark veto or the distinctive-branding text gate — refuses the
    # coarse logo pick, fall through to the text arms (same-type rescue + keyword fingerprint) instead
    # of discarding the whole match: the arms hold the RIGHT answer whenever the true supplier's
    # branding is on the page (measured 2026-07-26: 4 Saltmarsh dockets whose wrong Thornbury lock was
    # gated to None scored their OWN template at keyword ratio 1.0, unreachable behind the return).
    # DISTINCT from _logo_refused (type-refuse): C1's supplier guard binds ONLY there — an identity
    # veto PROVED the locked supplier wrong, so binding C1 here would block exactly the correct rescue
    # (Oracle Seam-4). The two flags are never both set (the veto sites are guarded on
    # `_logo_refused is None`). If nothing resolves, the corner stays None — byte-identical to today.
    # DEFAULT ON since 2026-07-26 (revised-C8 gate PASSED with the G1/G2 guards; owner-flipped).
    # TEMPLATE_VETO_FALLTHROUGH=0 restores the pre-fall-through behaviour (the veto sites return None).
    _vf_on = os.environ.get('TEMPLATE_VETO_FALLTHROUGH', '1') != '0'
    _logo_vetoed = False
    _vetoed_supplier = None       # lower-cased dominant supplier of the refuted pick ('' = unnamed)
    _vetoed_tid = None            # row-id fallback exclusion when the pick has no dominant supplier
    _veto_mark_rivals = set()     # detail-veto flavour only: suppliers the MARK positively matched

    def _veto_excluded(t):
        # C2 (LOAD-BEARING, Oracle): exclude the refuted SUPPLIER's templates — ALL its siblings, not
        # just the vetoed row — from the fall-through arms. _match_by_keywords scores the RAW
        # fingerprint ratio (generic type words included, 0.75 bar), so a junk-heavy sibling
        # fingerprint can clear it on a rival's page with zero distinctive presence; supplier-scoped
        # exclusion closes that re-admission door. Strictly safe vs baseline: these docs got None.
        if _vetoed_supplier:
            return (t.get('dominant_supplier') or '').strip().lower() == _vetoed_supplier
        return _vetoed_tid is not None and t.get('id') == _vetoed_tid

    def _vetoed_fallthrough_ok(cand):
        # C3 winner bar (Oracle): on an identity-veto fall-through, accept only a winner that either
        # belongs to a supplier the MARK positively matched (detail-veto flavour — pixel + text
        # agreement, the strongest class), or clears the distinctive branding PRESENCE bar on THIS
        # page (an all-junk fingerprint has n==0 and can never clear it). Anything else returns None
        # exactly as today — the cost vs baseline is zero, and a two-source contradiction
        # (mark says R, text says S3) keeps its human checkpoint.
        if not _logo_vetoed:
            return True
        sn = (cand.get('dominant_supplier') or '').strip().lower()
        if sn and sn in _veto_mark_rivals:
            return True
        _o, _k = _distinctive_hit_ratio(cand, ocr_lower)
        return _k > 0 and _o >= _BRANDING_PRESENT_RATIO

    def _mark_rival_suppliers(exclude_sup):
        # Detail-veto flavour of C3: suppliers whose enrolled Store-B mark set POSITIVELY matches the
        # query mark (min-over-set ≤ the veto threshold). Fail-safe empty on any error → the winner
        # bar falls back to the distinctive-presence arm alone (stricter, never looser).
        out = set()
        if not query_detail_hash:
            return out
        try:
            import logo_detail
            per = {}
            for t in templates:
                sn = (t.get('dominant_supplier') or '').strip().lower()
                if not sn or sn == exclude_sup:
                    continue
                per.setdefault(sn, []).extend(t.get('logo_detail_hashes') or [])
            thr = logo_detail._veto_dist()
            for sn, hs in per.items():
                m = logo_detail.min_over_set(query_detail_hash, hs)
                if m is not None and m <= thr:
                    out.add(sn)
        except Exception:
            pass
        return out

    # 1. Logo hash — the most reliable SUPPLIER identifier, but NOT a doc-type one
    #    (same-letterhead siblings). Gather ALL close logo candidates; within the
    #    ambiguity margin, prefer the sibling whose DOC-TYPE matches the detected
    #    title, else the keyword-fingerprint tie-break, else the closest logo.
    if page_image is not None:
        logo_phash, cands = _logo_candidates(page_image, templates)
        if cands:
            best_t, best_dist = cands[0]
            cluster_dist = best_dist                       # closest logo in the cluster
            cluster = [t for (t, d) in cands if d <= best_dist + _LOGO_AMBIG_MARGIN]
            dist_of = {id(t): d for (t, d) in cands}
            method  = 'logo'
            matching = [t for t in cluster
                        if detected_slug and (t.get('document_type_slug') or '') == detected_slug]
            if matching:
                # Prefer the type-matching sibling; deterministic: closest logo, then
                # most-confirmed. Keep supplier-identity confidence at the cluster's
                # CLOSEST logo distance (the logo says "this supplier" at that strength;
                # picking a type-correct-but-logo-farther sibling shouldn't sag it).
                best_t    = min(matching, key=lambda t: (dist_of.get(id(t), 99),
                                                         -(t.get('confirmed_count') or 0)))
                best_dist = cluster_dist
                method    = 'logo+slug'
            elif len(cluster) > 1 and not (title_trusted and detected_slug):
                scored = sorted(((t, _keyword_hit_ratio(t, ocr_lower)) for t in cluster),
                                key=lambda x: -x[1])
                if scored[0][1] > 0:                        # keyword evidence breaks the tie
                    best_t    = scored[0][0]
                    best_dist = dist_of.get(id(best_t), best_dist)
                    method    = 'logo+keywords'
            conf = max(0, 100 - best_dist * 6)
            if conf >= 60:
                # REFUSE: a TRUSTED title declares a type NONE of this letterhead's
                # templates carry — do not force a wrong-type template's layout /
                # fixed-values / Stage-0.5 mappings onto it. Return no match so the doc
                # goes to review to teach the new type (supplier identity still resolves
                # via the independent logo_fingerprints path). Gated on title_trusted, so
                # a mere incidental mention can't discard a good single-template match.
                if title_trusted and detected_slug and (best_t.get('document_type_slug') or '') != detected_slug:
                    if os.environ.get('LOGO_REFUSE_FALLTHROUGH', '1') == '0':
                        return _type_refuse(detected_slug, best_t.get('document_type_slug'))
                    # Fall through to the rescue / keyword arm — the logo can't judge TYPE, and a right-type
                    # sibling may match by keyword. Capture the refuse + the LOCKED supplier so a fall-through
                    # match for a DIFFERENT known supplier is rejected (C1). The accept path below is skipped
                    # while _logo_refused is set (its veto/gate/return are guarded on `_logo_refused is None`).
                    _logo_refused = (detected_slug, best_t.get('document_type_slug'))
                    _rs = (best_t.get('dominant_supplier') or '').strip().lower()
                    if _supplier_corrob:
                        # Trust the logo-locked supplier to BLOCK a cross-supplier rescue ONLY when its OWN
                        # branding is actually on the page. The 64-bit phash cannot separate suppliers on
                        # shared letterheads, so a lock whose supplier's branding is ABSENT is a collision,
                        # not identity — leave _refused_supplier empty and let the winner-side
                        # distinctive-presence gate in _fallthrough_supplier_ok decide. Present ⇒ the genuine
                        # same-letterhead wrong-type case af346d8's C1 was built for (unchanged).
                        _ro, _rk = _distinctive_hit_ratio(best_t, ocr_lower)
                        _refused_supplier = _rs if (_rk > 0 and _ro >= _BRANDING_PRESENT_RATIO) else ''
                    else:
                        _refused_supplier = _rs
                # TYPE-PRESENCE VETO (Type Slice 1, 2026-07-28; owner idea → Herald/gary → Oracle
                # SIGN-OFF-WITH-CONDITIONS). The TYPE analog of namePresence: a phash collision can pick
                # a WRONG-TYPE same-letterhead sibling (worksheet → delivery_note) when the doc's printed
                # heading isn't read (title_trusted False) so the trusted-title refuse above is STARVED.
                # If best_t's OWN type reliably prints its heading (learned ratio, threaded from
                # templates.js) but that heading is ABSENT from THIS candidate's top band, HOLD for review
                # instead of stamping the wrong type. Reuses type_refused (Oracle C-c: do NOT invent a
                # new key — the engine already consumes type_refused to HOLD). Ordered after the refuse
                # (guarded `_logo_refused is None` so it never double-holds), before the detail veto.
                # Kill switch TYPE_PRESENCE_VETO (default '1' = ON, corpus-gated 2026-07-29: no new M,
                # M_type=0, held #2390 + the 4 live wrong-type incidents; ~1.5% fail-safe holds. '0'
                # restores the byte-identical OFF path — this block is skipped).
                if (_logo_refused is None
                        and os.environ.get('TYPE_PRESENCE_VETO', '1') != '0'
                        and _type_heading_absent(best_t, ocr_lower)):
                    return _type_refuse(best_t.get('document_type_slug'),
                                        best_t.get('document_type_slug'))
                # SLICE C — isolated-mark VETO: a ≥2-supplier logo cluster whose picked template's mark
                # DISAGREES with the scan is a look-alike collision → ABSTAIN (fall to keyword + branding
                # net + review). See _logo_detail_veto (scoped, fail-safe, kill-switched, inert until
                # Slice-B detail hashes accrue). Ordered after the trusted-title refuse, before Fix A.
                if (_logo_refused is None
                        and _logo_detail_veto(cands, cluster_dist, best_t,
                                              query_detail_hash, all_templates=templates)
                        # …unless this is a corroborated single-supplier lock tripped by a MARGINAL rival
                        # (the Oakhaven clipped-logo class; DEFAULT OFF). A DECISIVE rival still vetoes.
                        and not _detail_veto_single_supplier_immune(cands, cluster, best_t, best_dist,
                                                                    ocr_lower, query_detail_hash,
                                                                    all_templates=templates)):
                    if not _vf_on:
                        return None
                    # Slice C (detail-veto flavour): refuse the pick but keep matching — record the
                    # refuted supplier (C2 exclusion) + the suppliers the mark POSITIVELY matched (C3).
                    _logo_vetoed = True
                    _vetoed_supplier = (best_t.get('dominant_supplier') or '').strip().lower()
                    _vetoed_tid = best_t.get('id')
                    _veto_mark_rivals = _mark_rival_suppliers(_vetoed_supplier)
                # FIX A: is this an AMBIGUOUS same-letterhead pick? (Ordered AFTER the trusted-title
                # refuse above.) If so the engine HOLDS the doc for review instead of auto-filing a
                # popularity-coin-flip type. Computed over the WIDER jitter-immune band — see
                # _type_ambiguity / _AMBIG_LOGO_BAND (Oracle).
                # SLICE 1d — TEXT CORROBORATION for a LOGO-ONLY accept (identity text-first,
                # 2026-07-20). Everything above can accept a template on LOGO DISTANCE ALONE
                # (conf = 100 - 6*dist >= 60, i.e. dist <= 6) — and the 64-bit phash is MEASURED
                # to have zero separating power on scans (cross-supplier MIN hamming 2 vs
                # same-supplier min 6). Live case that forced this: a NORTHGATE invoice matched a
                # COPPERFIELD invoice template (Northgate has no invoice template of its own), so
                # it filed as Copperfield while its 7 siblings resolved correctly by text. The
                # engine's logo->supplier gate can't help here: this path sets the supplier BEFORE
                # it, via template_fixed.
                # So: when the pick rests on the logo alone ('logo' — NOT 'logo+slug', which the
                # doc's own detected TYPE corroborated, nor 'logo+keywords', which text already
                # broke), require ANY of the winning template's distinctive branding words on the
                # page. Zero overlap => the letterhead contradicts the template => ABSTAIN (fall
                # to keyword/hint identity + the branding net + review) rather than impose a
                # wrong supplier, type and field layout.
# FAIL-SAFE, and it mirrors the engine's logo gate: mere ABSENCE of the winner's branding is
                # NOT enough (a legitimate logo-only match whose fingerprint words didn't OCR must still
                # work — pinned in test_template_matcher as "matches Acme by logo alone"). We abstain only
                # on POSITIVE DISAGREEMENT: the winner's own branding is absent AND some OTHER supplier's
                # branding is decisively present on the page. Un-fingerprinted templates and empty OCR are
                # unjudgeable and always accepted. Kill switch TEMPLATE_LOGO_TEXT_GATE=0.
                #
                # V2 — TEMPLATE_GATE_DISTINCTIVE (Oracle-signed 2026-07-20; =0 restores the V1
                # predicate byte-identically). The V1 gate was defeated THREE independent ways by
                # the live Northgate/Vellum→Copperfield misfiles — the exact case it was built for:
                #   (a) it tested method=='logo' only, and a type-matching sibling relabels the
                #       pick 'logo+slug' — but the slug corroborates the TYPE, not the SUPPLIER.
                #       TYPE evidence never corroborates supplier identity, so V2 gates EVERY
                #       logo-cluster accept ('logo', 'logo+slug', 'logo+keywords' — a tie broken
                #       on a junk-token ratio is not corroboration either; a genuinely
                #       corroborated winner self-exempts on own-distinctive >= 0.25).
                #   (b) its own-branding trigger (raw ratio <= 0.0) was defeated by junk stored
                #       tokens: 'INV' (matches inside every "INV-76642") and 'Industrial' (hit the
                #       CUSTOMER's address). V2 judges own-presence over DISTINCTIVE tokens with
                #       the engine's shared 0.25 present-bar; an all-junk fingerprint (n==0) is
                #       own-absent, not own-present.
                #   (c) its rival test (raw per-template fingerprint, exact, whole-page, flat
                #       0.75) was structurally unreachable — see _rival_branding_present V2.
                if (_logo_refused is None and not _logo_vetoed and ocr_lower
                        and os.environ.get('TEMPLATE_LOGO_TEXT_GATE', '1') != '0'
                        and (best_t.get('keyword_fingerprint') or [])):
                    if os.environ.get('TEMPLATE_GATE_DISTINCTIVE', '1') != '0':
                        _own, _n = _distinctive_hit_ratio(best_t, ocr_lower)
                        if (method in ('logo', 'logo+slug', 'logo+keywords')
                                and (_n == 0 or _own < _BRANDING_PRESENT_RATIO)
                                and _rival_branding_present(best_t, templates, ocr_lower)):
                            if not _vf_on:
                                return None
                            # Slice C (distinctive-gate flavour): text evidence refuted the pick's
                            # supplier — fall through; no mark-rival set (C3 bar = distinctive presence).
                            _logo_vetoed = True
                            _vetoed_supplier = (best_t.get('dominant_supplier') or '').strip().lower()
                            _vetoed_tid = best_t.get('id')
                    elif (method == 'logo'
                            and _keyword_hit_ratio(best_t, ocr_lower) <= 0.0
                            and _rival_branding_present(best_t, templates, ocr_lower)):
                        if not _vf_on:
                            return None
                        _logo_vetoed = True
                        _vetoed_supplier = (best_t.get('dominant_supplier') or '').strip().lower()
                        _vetoed_tid = best_t.get('id')
                ambiguous_type = _type_ambiguity(cands, cluster_dist, detected_slug, title_trusted,
                                                 best_t=best_t)
                result = {'template': best_t, 'confidence': conf, 'method': method,
                          'logo_phash': logo_phash, 'ambiguous_type': ambiguous_type}
                if ambiguous_type:
                    # FIX B1: expose the band-13 sibling set + this supplier so process_docs can
                    # resolve the correct type from the doc's ref-prefix and PIN it (suggest-only —
                    # the engine still flags ambiguous_type, so the doc stays HELD). Additive keys;
                    # non-ambiguous matches never carry them → every existing caller is unchanged.
                    result['ambiguous_siblings'] = _band_siblings(cands, cluster_dist, best_t=best_t)
                    result['cluster_supplier'] = best_t.get('dominant_supplier')
                    # A2 (type-split arc): expose the rivals' support over the SAME cohort band the
                    # ambiguity test used, so process_docs/engine can judge an unsupported rival.
                    _a2_band = [t for (t, d) in cands if d <= cluster_dist + _AMBIG_LOGO_BAND]
                    if os.environ.get('TYPE_AMBIG_COHESION', '1') != '0':
                        _a2_cohort = _letterhead_cohort(_a2_band, best_t)
                        _a2_band = _a2_cohort if _a2_cohort is not None else []
                    _attach_rival_support(result, _a2_band, best_t)
                # Return the accepted logo match — UNLESS the logo arm refused a wrong-type sibling
                # (LOGO_REFUSE_FALLTHROUGH) or an identity veto refuted the pick (Slice C), in which
                # case fall through to the same-type rescue / keyword arm.
                if _logo_refused is None and not _logo_vetoed:
                    return result

    # 2b. TEXT-CORROBORATED, SAME-TYPE RESCUE (Phillip, 2026-07-10): the logo drifted OUT of the strict
    #     accept band, but a template of the DETECTED type carries a strongly-overlapping keyword
    #     fingerprint (= the same supplier's BRANDING — the fingerprint strips doc-type + recipient
    #     words) and (if we have a logo) sits within a WIDER corroboration band (= not a different
    #     supplier's letterhead). Prefer it over the slug-BLIND best-score keyword fallback below,
    #     which picks an IDENTICAL-fingerprint sibling of the WRONG type and is then refused by the
    #     title guard — leaving e.g. a drifted Meridian PO with NO template even though its own PO
    #     template is right there. Precision-gated (same-type + >=0.80 branding overlap + logo band):
    #     can ONLY turn "wrongly no template" into the CORRECT template, never a wrong one; any miss
    #     falls through to the existing logoless path / review-to-teach.
    # Slice C2: on an identity-veto fall-through both text arms search a universe EXCLUDING the
    # refuted supplier's templates (all siblings — see _veto_excluded). No veto ⇒ untouched list.
    _arm_templates = [t for t in templates if not _veto_excluded(t)] if _logo_vetoed else templates
    # IDENTITY ADMISSION FILTER (TEMPLATE_IDENTITY_ON_PAGE — Oracle C2, and this placement is the
    # whole condition). The first version vetoed the WINNER after ranking, which turns "the wrong
    # template matched" into "NO template matched" — and that is a different, worse bug the moment a
    # customer teaches a SECOND supplier of the same kind. Two templates built from the buyer's own
    # purchase orders share the same poisoned fingerprint (the buyer's own address block), so both
    # score 1.00 on every PO the buyer issues and the winner is decided by LIST ORDER. Veto the
    # winner and the CORRECT template — sitting right there at 1.00 with its company printed on the
    # page — is never reached, and the customer experiences "teaching a second supplier broke the
    # first one".
    # Filtering the POOL instead cannot loosen anything: every candidate removed here is one the
    # winner-veto would also have refused, and whatever is promoted still faces the 0.75 keyword
    # floor and the rescue arm's 0.80 overlap bar. It converts "refuse the wrong one" into "refuse
    # the wrong one AND select the right one".
    if _IDENTITY_ON_PAGE_ON:
        _kept = [t for t in _arm_templates if not _identity_refuses(t, ocr_text)]
        if len(_kept) != len(_arm_templates):
            for _t in _arm_templates:
                if _t not in _kept:
                    # C4: never a silent refusal. Without this line the customer whose supplier does
                    # not print its name sees a taught layout simply stop working, re-teaches it,
                    # and is refused again with nothing to read anywhere.
                    _identity_log(_t)
        _arm_templates = _kept

    if detected_slug and title_trusted:
        _same_type = sorted(
            ((t, _keyword_hit_ratio(t, ocr_lower)) for t in _arm_templates
             if (t.get('document_type_slug') or '') == detected_slug),
            key=lambda x: -x[1])
        if _same_type and _same_type[0][1] >= RESCUE_KEYWORD_OVERLAP:
            _cand = _same_type[0][0]
            # LOGO BAND is NO LONGER REQUIRED (2026-07-17): the coarse logo phash is too unstable to
            # corroborate — MEASURED on the 9-supplier Demo corpus, same-supplier drift reaches 36
            # Hamming while different-supplier distances drop to 2, so the band cannot tell suppliers
            # apart and only BLOCKED legitimate drifted-logo / right-supplier / right-type matches
            # (e.g. a Copperfield PO whose logo drifted to ~36 never matched its own PO template). The
            # real precision is the >=0.80 branding-overlap + same-type + title_trusted gate above —
            # MEASURED 0% cross-supplier false-match at 0.80 on those 9 suppliers (branding words are
            # unique; only generic doc-type words like "DELIVERY DOCKET" overlap, topping out at 0.50).
            # Kill switch RESCUE_ENFORCE_LOGO_BAND=1 restores the old band (byte-identical to before).
            _enforce_band = os.environ.get('RESCUE_ENFORCE_LOGO_BAND', '0') != '0'
            if logo_phash is None or not _enforce_band or _min_set_dist(_cand, logo_phash) <= RESCUE_LOGO_BAND:
                if _fallthrough_supplier_ok(_cand) and _vetoed_fallthrough_ok(_cand):
                    # C1: reject a type-refuse fall-through for a DIFFERENT supplier; C3: an
                    # identity-veto fall-through winner must clear the mark/branding bar.
                    # veto_fallthrough tag (G1/G2 guards, Oracle 2026-07-26): additive key, set ONLY
                    # on an identity-veto fall-through (NOT the af346d8 type-refuse path — that
                    # shipped ON with its own validation). The engine's corroboration guards key on
                    # it; every other consumer uses .get() → inert.
                    return {'template': _cand, 'confidence': 60,
                            'method': 'keywords+slug_rescue', 'logo_phash': logo_phash,
                            **({'veto_fallthrough': True} if _logo_vetoed else {})}

    # 2. Keyword fingerprint — fallback for docs without logos. Pass detected_slug so a same-fingerprint
    # sibling of the DETECTED type wins the tie (the logo-drift → keyword-fallback → wrong-sibling class).
    kw_match = _match_by_keywords(ocr_text, _arm_templates, detected_slug, title_trusted)
    if kw_match and kw_match['confidence'] >= int(KEYWORD_THRESHOLD * 100):
        # Same title-trust refuse on the logoless path.
        if title_trusted and detected_slug and \
           (kw_match['template'].get('document_type_slug') or '') != detected_slug:
            return _type_refuse(detected_slug, kw_match['template'].get('document_type_slug'))
        # TYPE-PRESENCE VETO on the KEYWORD-FINGERPRINT arm (Slice 2, kill switch TYPE_PRESENCE_VETO_KW,
        # default OFF = byte-identical). The logo-arm veto (L568) only guards the STRONG-lock accept
        # (conf>=60 ⇔ dist<=6). A doc that fails to lock strongly against its OWN supplier's template is
        # typed HERE, unguarded — phash hashes LAYOUT, so a Ridgeway worksheet sits closer to a
        # different supplier's templates (dist 8) than to its own SO template, and template 5's
        # sales_order gets stamped by fingerprint alone (herald trace). Apply the SAME predicate: if the
        # kw_match template's OWN type reliably prints its heading (armed ratio, threaded) but that
        # heading is ABSENT from this candidate's top band, REFUSE -> no template -> untyped (Slice 1
        # then drops any spurious keyword type). `_type_heading_absent` already abstains (returns False)
        # for an UNARMED scope (n<3 / ratio<0.80 / no tokens), so a supplier who doesn't print the banner
        # is never wrongly rejected (herald's NEVER/UNKNOWN). Symmetric with the L568 logo-arm veto.
        if (os.environ.get('TYPE_PRESENCE_VETO_KW', '1') != '0'    # flipped default ON 2026-07-30; =0 disables
                and _type_heading_absent(kw_match['template'], ocr_lower)):
            return _type_refuse(kw_match['template'].get('document_type_slug'),
                                kw_match['template'].get('document_type_slug'))
        if (_fallthrough_supplier_ok(kw_match['template'])
                and _vetoed_fallthrough_ok(kw_match['template'])):
            # C1: reject a type-refuse fall-through for a DIFFERENT supplier; C3: an identity-veto
            # fall-through winner must clear the mark/branding bar (else None, as today).
            if logo_phash:
                kw_match['logo_phash'] = logo_phash
            if _logo_vetoed:
                kw_match['veto_fallthrough'] = True   # G1/G2 guard tag (identity-veto path only)
            return kw_match

    # LOGO_REFUSE_FALLTHROUGH re-emit (C1): the logo arm refused a wrong-type sibling and we fell through,
    # but neither the same-type rescue nor the keyword arm resolved a RIGHT-type, RIGHT-supplier template.
    # Preserve the hold + note so a trusted title naming a type this supplier lacks still fails to review.
    # (OFF ⇒ _logo_refused is None ⇒ no-op ⇒ byte-identical.)
    if _logo_refused is not None:
        return _type_refuse(_logo_refused[0], _logo_refused[1])

    return None


def extract_with_template(ocr_text: str, template: dict) -> dict:
    """
    Extract field values using a template's stored field rules.
    Returns {field_key: {'value', 'confidence', 'method'}}
    """
    results = {}
    lines   = [l.strip() for l in ocr_text.split('\n')]
    fields  = template.get('fields') or []

    for field in fields:
        key        = field.get('field_key')
        fixed_val  = field.get('fixed_value')
        is_var     = field.get('is_variable', 1)
        locked     = field.get('fixed_locked', 0)
        anchor     = field.get('anchor_label')
        direction  = field.get('direction', 'right')

        if not key:
            continue

        # Fixed value — same every time (e.g. supplier_name). An admin-LOCKED fixed
        # value (fixed_locked = 1) is a deliberate, protected override → distinct
        # method 'template_fixed_locked' that engine.extract guards from ordinary
        # OCR/keyword/anchor overrides; an auto-derived non-variable value stays the
        # overridable 'template_fixed'. Same confidence either way.
        if fixed_val and not is_var:
            # HOLD THE SIBLINGS (TEMPLATE_IDENTITY_HOLD_SIBLINGS, DEFAULT OFF — owner decision 4).
            # A teach that replaced this template's frozen identity with a GENUINELY DIFFERENT
            # company is believed for the document the operator was looking at, and not yet for the
            # layout's other documents. templates.js marks the template pending; until a second
            # document agrees, the identity is stamped at a review-forcing confidence WITH a note
            # rather than at 95. The note is what actually holds it: a bare 70 does not trip the
            # review threshold (`< 70`, documents.js), so a confidence drop alone would still
            # auto-file — the slice-3 B2 lesson.
            # Scope: the identity field only, and only while pending. Everything else, including a
            # frozen VAT number and an admin-LOCKED literal, is untouched.
            if (_HOLD_PENDING_IDENTITY
                    and key in _COMPANY_KEYS
                    and not locked
                    and template.get('identity_unconfirmed')):
                results[key] = {
                    'value':      fixed_val,
                    'confidence': 70,
                    'method':     'template_fixed',
                    'validation_note': (
                        f"the sender for this layout was changed to '{fixed_val}' on one document — "
                        f"confirm it here too and it will be used automatically from then on"),
                }
                continue
            results[key] = {
                'value':      fixed_val,
                'confidence': 95,
                'method':     'template_fixed_locked' if locked else 'template_fixed',
            }
            continue

        # Anchor-based — find value relative to a known label
        if anchor:
            value = _find_by_anchor(lines, anchor.lower(), direction)
            if value:
                results[key] = {
                    'value':      value,
                    'confidence': 85,
                    'method':     'template_anchor',
                }

    return results


def extract_keyword_fingerprint(ocr_text: str, max_words: int = 10) -> list:
    """
    Extract distinctive keywords from the document header for template
    identification. Only looks at the first 20 lines.

    This fingerprint becomes part of a template's permanent identity
    (persisted and reused for every future match), so per-document VARIABLE
    content must not be allowed to leak in alongside the supplier's stable
    branding vocabulary:
      - any token containing a digit is skipped — invoice/reference/account
        numbers, numeric dates, amounts and postcodes are essentially never
        genuine supplier-branding words (those are overwhelmingly pure
        alphabetic), but "INV2024", "REF-A1183" etc. would otherwise be
        captured whole and rotate on every document
      - calendar words are skipped (see CALENDAR_WORDS) — the month/weekday
        named in a header changes from invoice to invoice
      - the existing generic STOP_WORDS list is still applied
    The recipient/customer block IS excluded: harvesting stops at the first
    line containing a recipient marker ("Bill To", "Ship To", "Invoice To",
    "Sold To", "Customer"). Everything after such a marker is per-document
    customer name/address — capturing it ("Alan Shonely Tampa Florida") made a
    template match only the one sample customer and fail every sibling document
    of the same supplier/layout. The marker words themselves are universal
    invoice structure, not customer-specific, so truncating AT the marker keeps
    the stable branding/header words above it while dropping the volatile block
    — layout-independent and reusable.
    """
    RECIPIENT_MARKERS = ('bill to', 'ship to', 'invoice to', 'sold to', 'customer')
    # R3 COUNTERPARTY MARKERS for BUYER-ISSUED docs (herald→Oracle SIGN-OFF-W/COND 2026-08-01;
    # kill FINGERPRINT_COUNTERPARTY_MARKERS=0). A purchase order introduces its counterparty
    # with "Supplier :" / "Vendor :" — neither was a marker, so the harvest sailed past into
    # the per-document counterparty name, which then entered the template's PERMANENT identity
    # ('Halcyon Leisure Group' inside the Vellum PO template — the doc-259 deadlock's poison).
    # WORD-BOUNDARY regex, not substring (Oracle's load-bearing sharpening: the existing tuple
    # is substring-matched, and 'supplier' as a substring would truncate an "Office Suppliers
    # Direct" letterhead at line 1 — a shorter fingerprint is safe, a gutted one is not).
    # Harvest-side only, never retroactive — R1's intersect heals frozen fingerprints.
    _CPTY_RE = re.compile(r'\b(?:supplier|vendor)\b', re.IGNORECASE) \
        if os.environ.get('FINGERPRINT_COUNTERPARTY_MARKERS', '1') != '0' else None
    header_lines = []
    for line in ocr_text.split('\n')[:20]:
        low = line.lower()
        if any(m in low for m in RECIPIENT_MARKERS):
            break  # stop before the per-document recipient/customer block
        if _CPTY_RE is not None and _CPTY_RE.search(line):
            break  # buyer-issued counterparty block ("Supplier : <name>") — same rule
        header_lines.append(line)
    header_text = ' '.join(header_lines)
    # FINGERPRINT_HYGIENE (slice 3 of the distinctive-token train, 2026-07-20): a ref-prefix
    # fragment is NOT branding. The token regex splits "INV-76642" at '-', so 'INV' reaches the
    # digit filter digit-free and enters ~every invoice template's permanent identity, where it
    # fakes cross-supplier corroboration. The skip must test the RAW-TEXT context (token followed
    # by an optional -/# or / then a digit) — by token time the evidence is already gone. Harvest-
    # side only helps NEW fingerprints; the compare-time _distinctive_tokens prefix rule is what
    # heals frozen ones. Kill switch FINGERPRINT_HYGIENE=0.
    _hygiene = os.environ.get('FINGERPRINT_HYGIENE', '1') != '0'
    words = []
    for m in re.finditer(r'\b[A-Za-z][A-Za-z0-9]{2,}\b', header_text):
        if _hygiene and re.match(r'[-/#]?\d', header_text[m.end():]):
            continue                     # 'INV' in "INV-76642" / 'REF' in "REF/2024-1"
        words.append(m.group(0))

    seen        = set()
    fingerprint = []
    for word in words:
        lower = word.lower()
        if lower in STOP_WORDS or lower in CALENDAR_WORDS:
            continue
        if any(ch.isdigit() for ch in word):
            continue
        if word in seen:
            continue
        seen.add(word)
        fingerprint.append(word)
        if len(fingerprint) >= max_words:
            break

    return fingerprint


def compute_logo_hash(page_image: Image.Image) -> str | None:
    """Compute a perceptual hash of the top-left logo region.

    Delegates to the SHARED recipe in logo_hash.py so the interactive teach path
    (logo/fingerprint.py) and this Stage-0 matcher hash a logo identically — a taught
    logo and an extracted logo can never silently drift apart. Byte-identical to the
    former inline recipe (top-left crop, grey/autocontrast/resize-256/blur, phash-8)."""
    try:
        import logo_hash
        return logo_hash.logo_phash(page_image)
    except Exception:
        return None


# ── Private helpers ───────────────────────────────────────────────────────────

def _logo_candidates(page_image: Image.Image,
                     templates: list) -> tuple[str | None, list]:
    """Return (phash, [(template, hamming_distance), ...]) for every template
    whose logo is within LOGO_THRESHOLD of this page, CLOSEST FIRST. Unlike a
    single best-match, this exposes the same-logo cluster so identify_template
    can break a supplier's multi-layout tie by keyword fingerprint."""
    phash = compute_logo_hash(page_image)
    if not phash:
        return None, []
    cands = []
    for t in templates:
        # Multi-reference identity (migration 26): a template carries a SET of logo
        # hashes (logo_phashes) so per-scan drift still matches the closest. Fall
        # back to the legacy single logo_phash for un-migrated payloads. Distance =
        # MIN over the set; everything downstream (threshold/cluster/gate) is unchanged.
        hashes = t.get('logo_phashes') or ([t.get('logo_phash')] if t.get('logo_phash') else [])
        dists = [_hamming(phash, h) for h in hashes if h]
        if not dists:
            continue
        dist = min(dists)
        if dist <= LOGO_THRESHOLD:
            cands.append((t, dist))
    cands.sort(key=lambda x: x[1])
    return phash, cands


def _min_set_dist(template: dict, phash: str) -> int:
    """Min Hamming from `phash` to any logo hash in the template's multi-ref set (or its legacy single
    logo_phash); 99 when the template carries no logo hash. The wider corroboration backstop for the
    same-type keyword rescue — guards against a different-supplier look-alike letterhead."""
    hashes = template.get('logo_phashes') or ([template.get('logo_phash')] if template.get('logo_phash') else [])
    dists = [_hamming(phash, h) for h in hashes if h]
    return min(dists) if dists else 99


def _rival_branding_present(picked: dict, templates: list, ocr_lower: str,
                            bar: float = 0.75) -> bool:
    """True → some DIFFERENT supplier identity is DECISIVELY present on this page's ISSUER BAND.

    V2 (TEMPLATE_GATE_DISTINCTIVE, default): per-IDENTITY banks of DISTINCTIVE fingerprint tokens
    (union across a supplier's templates), matched FUZZY over the issuer band — the same evidence
    shape as the engine's _branding_alt_name, which named the true supplier on 10/10 of the live
    misfiles while the V1 test below named it on 0/10. V1's structural unreachability, measured:
    a rival whose only template is a different DOC TYPE carries type words that cannot appear on
    this page (Northgate's delivery fingerprint capped at 0.60 on an invoice), and a rival whose
    fingerprint leaked its sample doc's CUSTOMER name is diluted below the bar (Vellum at 0.70 —
    "Bill To" OCR'd as "Bi Te", so harvest truncation missed). Banks strip both classes from the
    denominator. PLUS a supplier-NAME arm: the identity's display-name tokens (>=2 surviving the
    generic-name filter — Oracle C: 'City Office' is unjudgeable, never a rival) found in the
    band. Band-scoping means a mid-page recipient can never make a rival — and the name arm is
    what names a rival whose bank the leak diluted.

    V1 (=0): the original raw-fingerprint exact whole-page test, byte-identical."""
    if os.environ.get('TEMPLATE_GATE_DISTINCTIVE', '1') == '0':
        return _rival_branding_present_v1(picked, templates, ocr_lower, bar)
    if not ocr_lower:
        return False
    try:
        import chrome_band
    except ImportError:
        from extraction import chrome_band
    band_tokens = re.findall(r'[a-z0-9]+', chrome_band.issuer_chrome(ocr_lower).lower())
    if not band_tokens:
        return False
    pid = ((picked.get('dominant_supplier') or picked.get('name') or '').strip().lower())
    banks, names = {}, {}
    for t in (templates or []):
        tid = ((t.get('dominant_supplier') or t.get('name') or '').strip().lower())
        if not tid or tid == pid:
            continue
        names.setdefault(tid, (t.get('dominant_supplier') or t.get('name') or '').strip())
        banks.setdefault(tid, set()).update(_distinctive_tokens(t.get('keyword_fingerprint') or []))
    for tid, words in banks.items():
        if len(words) >= _BRANDING_MIN_WORDS \
                and _keyword_hit_ratio_fuzzy(sorted(words), band_tokens) >= bar:
            return True
        nt = _name_arm_tokens(names[tid])
        if len(nt) >= 2 and _keyword_hit_ratio_fuzzy(sorted(nt), band_tokens) >= bar:
            return True
    return False


def _rival_branding_present_v1(picked: dict, templates: list, ocr_lower: str,
                               bar: float = 0.75) -> bool:
    """The V1 rival test, preserved VERBATIM for TEMPLATE_GATE_DISTINCTIVE=0 (the byte-identical
    revert pin): raw per-template fingerprint, exact word-boundary, whole page, flat bar.
    Identity = dominant_supplier else name; a template with no fingerprint or no identity can
    never be the rival (fail-safe)."""
    pid = ((picked.get('dominant_supplier') or picked.get('name') or '').strip().lower())
    for t in (templates or []):
        if not (t.get('keyword_fingerprint') or []):
            continue
        tid = ((t.get('dominant_supplier') or t.get('name') or '').strip().lower())
        if not tid or tid == pid:
            continue
        if _keyword_hit_ratio(t, ocr_lower) >= bar:
            return True
    return False


def _keyword_hit_ratio(template: dict, ocr_lower: str) -> float:
    """Fraction of a template's keyword fingerprint present on the page (the same
    word-boundary match _match_by_keywords uses). 0.0 when the template has no
    fingerprint, so a fingerprint-less template never wins a keyword tie-break."""
    keywords = template.get('keyword_fingerprint') or []
    if not keywords:
        return 0.0
    hits = sum(
        1 for kw in keywords
        if re.search(r'(?<![a-z0-9])' + re.escape(kw.lower()) + r'(?![a-z0-9])', ocr_lower)
    )
    return hits / len(keywords)


def _keyword_hit_ratio_fuzzy(fingerprint_words, page_tokens,
                             threshold: float = 0.85, min_len: int = 6) -> float:
    """FUZZY fraction of a branding fingerprint present among `page_tokens` — for the branding
    cross-check's ALTERNATIVE-supplier hunt ONLY (Oracle/gary 2026-07-14), so an OCR-GARBLED
    letterhead word ("rthgate") still resolves to its supplier ("northgate"). A SEPARATE function
    from _keyword_hit_ratio on purpose: that exact matcher is the shared page-wide template tie-break
    and must stay byte-identical.

    Precision rules (metric-pinned): a word of len ≥ `min_len` counts present if some page token of
    similar length (±2) scores difflib.SequenceMatcher(None, w, t).ratio() ≥ `threshold`
    (0.85 → "rthgate"/"northgate" = 0.875 present; a 3rd dropped char → 0.80 absent). SequenceMatcher
    .ratio() (block alignment) is used, NOT normalised edit-distance (which scores the same pair 0.78
    and would MISS it). Words shorter than `min_len` require an EXACT token match (difflib on 3–5 char
    tokens is noisy, and every distinctive branding token is ≥6). `page_tokens` = the caller's chosen
    band (the branding guard passes ISSUER-BAND tokens so a mid-page recipient can't be matched)."""
    words = [str(w or '').strip().lower() for w in (fingerprint_words or []) if str(w or '').strip()]
    if not words:
        return 0.0
    tokset = set(page_tokens)
    hits = 0
    for w in words:
        if len(w) < min_len:
            if w in tokset:                                  # short words stay EXACT (tokens are word-bounded)
                hits += 1
            continue
        for t in page_tokens:
            if abs(len(t) - len(w)) <= 2 and difflib.SequenceMatcher(None, w, t).ratio() >= threshold:
                hits += 1
                break
    return hits / len(words)


def _kw_nondistinctive_hold(scored, best_t):
    """LEVER 3 predicate (Herald/Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-26). HOLD a keyword-arm winner
    that carries NO type-distinctive branding a same-supplier DIFFERENT-type sibling lacks — a subset (or
    equal) DISTINCTIVE fingerprint. This is the pure-letterhead sibling (e.g. an 'invoice' template whose
    fingerprint is just the letterhead) that scores 1.0 on every page of a multi-type letterhead and wins
    OUTRIGHT, so `_kw_type_ambiguity`'s exact-tie test never sees it — the deterministic silent-misfile
    (§2.5 of HERALD_TYPE_DETECTION_REFERENCE). Returns ({slug: template}, cluster_supplier) or None.

    Same cohesion + belt-and-braces as _kw_type_ambiguity so it can NEVER pin a FOREIGN template: the
    cohort is same-supplier only (shares the winner's fingerprint OR the same non-null dominant_supplier),
    and it bails if the cohort spans two distinct known suppliers. Uses _distinctive_tokens (type/generic
    words stripped) so type words — which SHOULD differ between siblings — never count as identity, and an
    ∅-distinctive winner (fingerprint all generic/type words) HOLDs when a >=2-slug cohort exists
    (∅ ⊆ anything = "no identity evidence ⇒ ambiguous"; Oracle C5, pinned)."""
    best_slug = best_t.get('document_type_slug') or ''
    bf_set    = {w.lower() for w in (best_t.get('keyword_fingerprint') or [])}
    best_sup  = (best_t.get('dominant_supplier') or '').strip().lower()
    # Same-supplier cohort of a DIFFERENT doc type (fingerprint-word overlap OR same non-null supplier).
    cohort = [t for (t, _s) in scored
              if (t.get('document_type_slug') or '') != best_slug
              and ({w.lower() for w in (t.get('keyword_fingerprint') or [])} & bf_set
                   or (best_sup and (t.get('dominant_supplier') or '').strip().lower() == best_sup))]
    if not cohort:
        return None
    sups = {(t.get('dominant_supplier') or '').strip().lower() for t in cohort if t.get('dominant_supplier')}
    if best_sup:
        sups.add(best_sup)
    if len(sups) > 1:                                       # never span two KNOWN suppliers (belt-and-braces)
        return None
    best_dist = _distinctive_tokens(best_t.get('keyword_fingerprint') or [])
    if not any(best_dist <= _distinctive_tokens(t.get('keyword_fingerprint') or []) for t in cohort):
        return None                                        # winner carries a distinctive word no sibling has → not ambiguous
    slugs = {best_slug: best_t} if best_slug else {}
    for t in cohort:
        slug = t.get('document_type_slug') or ''
        if slug and slug not in slugs:                     # scored is source-order; first per slug is kept
            slugs[slug] = t
    if len(slugs) < 2:
        return None
    return (slugs, best_t.get('dominant_supplier'))


def _kw_type_ambiguity(scored, best_t, winner_slug_match, title_trusted=False):
    """FIX A/B1 on the KEYWORD fallback path (Oracle/gary SIGN-OFF-WITH-CONDITIONS 2026-07-13).
    `scored` = [(template, score)] for every hits>0 template. Returns (ambiguous, {slug: sibling},
    cluster_supplier).

    Fires ONLY on a genuine SAME-SUPPLIER type coin-flip:
      • winner_slug_match == 0 — the pick was ORDER-decided, NOT resolved by the doc's own detected
        title (Option A, gary). A slug-decided winner is not a coin-flip → byte-identical to today.
      • ≥2 DISTINCT doc-type slugs tie at the EXACT top score (no band-widening — keyword score is
        deterministic text, so identical-fingerprint siblings land on the exact top; the logo path
        widens only because phash drift is physical measurement noise).
      • SINGLE-SUPPLIER COHESION (C1, the load-bearing guard): a tied template joins the sibling set
        only if it shares best_t's keyword FINGERPRINT (the documented same-letterhead trigger — works
        on a fresh sibling whose dominant_supplier is still null) OR the same NON-NULL dominant_supplier
        (fallback). A cross-supplier tie (different fingerprints, different suppliers) therefore never
        groups → never fires → can never pin a FOREIGN template into the engine. Belt-and-braces: bail
        if the cohort still spans two DIFFERENT non-null suppliers.
    cluster_supplier = best_t's dominant_supplier (may be null → B1 abstains on the ref-prefix lookup,
    but Fix A still HOLDS the doc — the safe direction). Guarded by tests/test_kw_type_ambiguity.py.

    LEVER 3 (KW_TYPE_NONDISTINCTIVE_HOLD, Herald/Oracle 2026-07-26): BEFORE the exact-tie body, HOLD a
    non-distinctive subset-fingerprint winner (see _kw_nondistinctive_hold) — no exact tie required. This
    is the silent-misfile backstop for a garbled title Lever 1 could not recover. Gate = winner NOT
    slug-decided AND title NOT trusted. (De Morgan of Oracle's stated `not (title_trusted and
    winner_slug_match)`; his VERIFIED conclusion — under the ON default only test 8 flips — pins THIS
    form: a slug-decided winner OR a trusted title defers to the existing resolution / the trusted-title
    REFUSE, so Lever 3 only fires on the untrusted-title residual, composing cleanly with Lever 1.) OFF ⇒
    the block is skipped and title_trusted is read nowhere else ⇒ _kw_type_ambiguity is byte-identical."""
    _nd = os.environ.get('KW_TYPE_NONDISTINCTIVE_HOLD', '1') != '0'
    if _nd and winner_slug_match == 0 and not title_trusted:
        _hold = _kw_nondistinctive_hold(scored, best_t)
        if _hold is not None:
            return (True, _hold[0], _hold[1])
    if winner_slug_match != 0:
        return (False, {}, None)
    cohort = _kw_tie_cohort(scored, best_t)
    if cohort is None:                                  # never span two known suppliers
        return (False, {}, None)
    slugs = {}
    for t in cohort:
        slug = t.get('document_type_slug') or ''
        if slug and slug not in slugs:                  # scored is source-order; first per slug is kept
            slugs[slug] = t
    if len(slugs) < 2:
        return (False, {}, None)
    return (True, slugs, best_t.get('dominant_supplier'))


def _kw_tie_cohort(scored, best_t):
    """The keyword arm's EXACT-top-score same-letterhead cohort (factored out of _kw_type_ambiguity,
    byte-identical): the templates tied at the top score that share best_t's fingerprint set or its
    non-null dominant supplier. None when the tie spans two different known suppliers."""
    top = max(s for _, s in scored)
    S   = [t for t, s in scored if s == top]
    bf_set   = {w.lower() for w in (best_t.get('keyword_fingerprint') or [])}
    best_sup = (best_t.get('dominant_supplier') or '').strip().lower()
    cohort = [t for t in S
              if {w.lower() for w in (t.get('keyword_fingerprint') or [])} == bf_set
              or (best_sup and (t.get('dominant_supplier') or '').strip().lower() == best_sup)]
    sups = {(t.get('dominant_supplier') or '').strip().lower() for t in cohort}
    sups.discard('')
    if len(sups) > 1:
        return None
    return cohort


def _match_by_keywords(ocr_text: str, templates: list, detected_slug: str | None = None,
                       title_trusted: bool = False) -> dict | None:
    """`detected_slug`: on an EXACT keyword-score TIE between same-fingerprint siblings (one supplier
    issuing several doc types on ONE letterhead has IDENTICAL branding fingerprints — the fingerprint
    strips doc-type words), prefer the sibling whose document_type_slug matches the doc's OWN detected
    title. This mirrors the detected_slug preference the LOGO-cluster path already has (identify_template
    :87-97) — WITHOUT it, when the logo drifts out of range and this fallback runs, the wrong-type sibling
    wins by mere template ORDER (the Cascade delivery-docket-typed-invoice bug). TIE-ONLY, NEVER a boost:
    `score` is the PRIMARY key element, so a strictly-higher-scoring template of ANY type always wins —
    the slug preference can never override better keyword evidence (which would reopen the cross-supplier
    misfile class the word-boundary guard below prevents). detected_slug=None → slug_match=0 for all →
    pure order/confirmed tie-break, and the existing keyword-tie pins stay green."""
    ocr_lower  = ocr_text.lower()
    best       = None
    best_key   = None
    scored     = []                                        # (template, score) for every hits>0 template

    for t in templates:
        keywords = t.get('keyword_fingerprint') or []
        if not keywords:
            continue
        # BUYER-ISSUED TYPE SCOPE (TEMPLATE_BUYER_ISSUED_TYPE_SCOPE, DEFAULT OFF — Chris round 4
        # card 1, and the same class he reported on 2026-08-11). A template taught on a PURCHASE
        # ORDER the business ISSUED carries the OWNER's own company as its frozen identity, and the
        # owner's name and address are printed on every document the business RECEIVES — as the
        # recipient. So the identity-on-page guard is satisfied by construction, and the layout goes
        # on to claim inbound delivery notes and quotes from other suppliers at 95, stamping the
        # owner's own name and VAT number on them. That is 40 documents wrong at a new customer's
        # first sight of their filing cabinet.
        # THE REFUSAL IS AS NARROW AS THE EVIDENCE: a marked template may not win the TEXT arm on a
        # document whose OWN printed title is a TRUSTED heading declaring a different type. It is
        # not refused on its own type (a real PO still matches), not refused on an untrusted or
        # absent title (absence is not evidence), and the logo arm is untouched — the mark says
        # where the layout came from, not that the layout is wrong.
        if (_BUYER_ISSUED_TYPE_SCOPE and t.get('buyer_issued')
                and title_trusted and detected_slug
                and (t.get('document_type_slug') or '') != detected_slug):
            continue
        # Word-boundary match — mirrors _label_pattern's single-word collision
        # guard (the proven Stage-1 fix). Plain substring containment let a
        # short distinctive keyword like "LTD" or "REF" score a hit by sheer
        # accident inside an unrelated word ("ALTDORF", "PREFAB") in a
        # different supplier's document, inflating that template's score and
        # raising the odds of a false cross-supplier match for suppliers that
        # fall back to keywords because they have no usable logo.
        hits = sum(
            1 for kw in keywords
            if re.search(r'(?<![a-z0-9])' + re.escape(kw.lower()) + r'(?![a-z0-9])', ocr_lower)
        )
        if hits == 0:
            continue                                       # no keyword hit -> never wins (the "return None"
                                                           # contract, independent of slug_match; Oracle F1-C1)
        score = hits / len(keywords)
        scored.append((t, score))
        # (score, slug_match): score is PRIMARY (raw float — IEEE-754 division ties equal fractions
        # bit-identically, so no round() is needed and it cannot erode strictly-higher-score-wins,
        # Oracle F1-C3), so a higher-scoring template of ANY type always wins. slug_match breaks an
        # EXACT score tie toward the detected-type sibling. NO confirmed_count tertiary (Oracle F1-C2:
        # it would silently flip a sibling tie on the segmentation None-path the corpus can't see).
        # Strict '>' keeps the first-seen on a FULL tie (score+slug equal) — byte-identical when None.
        slug_match = 1 if detected_slug and (t.get('document_type_slug') or '') == detected_slug else 0
        key = (score, slug_match)
        if best_key is None or key > best_key:
            best_key = key
            best = {
                'template':   t,
                'confidence': int(score * 100),
                'method':     'keywords',
            }

    if best is None:
        return None
    # FIX A/B1 on the keyword fallback: an identical-fingerprint same-letterhead sibling set ties at the
    # top score, and a skew-garbled title makes the winner ORDER-decided — a silent type COIN-FLIP the
    # logo-path guards never see. Flag it (→ engine HOLD) + expose the SINGLE-SUPPLIER sibling set (→ B1
    # ref-prefix suggestion). Additive keys, attached ONLY when ambiguous → non-ambiguous matches stay
    # byte-identical (best_key[1] = the winner's slug_match, for Option A).
    amb, sibs, cluster_sup = _kw_type_ambiguity(scored, best['template'], best_key[1], title_trusted)
    if amb:
        best['ambiguous_type']     = True
        best['ambiguous_siblings'] = sibs
        best['cluster_supplier']   = cluster_sup
        # A2 (type-split arc): rival support ONLY for the exact-tie coin-flip cohort — a Lever-3
        # (non-distinctive subset-fingerprint) hold is not a cohort coin-flip and never waives
        # (Oracle S2-py-1); its cohort here has <2 slugs, so nothing is attached.
        _tie = _kw_tie_cohort(scored, best['template']) or []
        if len({t.get('document_type_slug') or '' for t in _tie} - {''}) >= 2:
            _attach_rival_support(best, _tie, best['template'])
    return best


def _label_pattern(label: str) -> "re.Pattern | None":
    """
    Build a regex for matching a saved template anchor label inside an OCR
    line — mirrors keyword.py's _label_pattern (the proven Stage-1 fix).

    Two needs, one pattern:
      1. Whitespace tolerance — multi-word labels ("Purchase Order No") are
         commonly OCR'd with merged or split inter-word spacing ("PURCHASE
         ORDERNO" vs "PURCHASE ORDER NO") depending on scan/font variance,
         even across pages of the very same template. \\s* between each word
         covers both without resorting to fuzzy/edit-distance matching.
      2. Collision guard — a short single-word alphabetic label ("PO", "Ref")
         must not match inside an unrelated word ("Polychemtex", "Refinishing").
         Multi-word/punctuated labels rarely collide and boundary semantics
         don't apply meaningfully to them, so the guard is scoped to the
         single-word-alphabetic shape only — preserving prior behaviour.

    Returning a single compiled pattern (rather than a bool test plus a
    separate exact-length .find()) means the match span IS the extraction
    span — removing the class of bug where a tolerant match succeeds but
    idx + len(label) lands in the wrong place because the matched text's
    length differs from the label string's length.
    """
    words = label.split()
    if not words:
        return None
    body = r'\s*'.join(re.escape(w) for w in words)
    if len(words) == 1 and words[0].isalpha():
        return re.compile(r'(?<![a-z0-9])' + body + r'(?![a-z0-9])')
    return re.compile(body)


def _find_by_anchor(lines: list, label: str, direction: str) -> str | None:
    pattern = _label_pattern(label)
    if pattern is None:
        return None

    for i, line in enumerate(lines):
        m = pattern.search(line.lower())
        if not m:
            continue
        if direction == 'right':
            rest = line[m.end():].strip().lstrip(':').strip()
            if rest:
                return rest
        elif direction == 'below':
            for j in range(i + 1, min(i + 4, len(lines))):
                if lines[j]:
                    return lines[j]
        elif direction == 'above':
            for j in range(i - 1, max(i - 4, -1), -1):
                if lines[j]:
                    return lines[j]
    return None


def _hamming(h1: str, h2: str) -> int:
    if not h1 or not h2 or len(h1) != len(h2):
        return 64
    dist = 0
    for c1, c2 in zip(h1, h2):
        xor = int(c1, 16) ^ int(c2, 16)
        dist += bin(xor).count('1')
    return dist
