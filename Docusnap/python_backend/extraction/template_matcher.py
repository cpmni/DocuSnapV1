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
# PICK under-detects, or a same-logo type-flip auto-files un-flagged. Kept below the ~28 unrelated-logo
# floor so a DIFFERENT supplier's letterhead is never pulled into the ambiguity set. The PICK stays on 3.
_AMBIG_LOGO_BAND = 13


def _type_ambiguity(cands, base_dist, detected_slug, title_trusted) -> bool:
    """FIX A predicate (pure — Oracle SIGN-OFF-WITH-CONDITIONS). Is the logo-resolved supplier's TYPE
    ambiguous on this doc? TRUE when the logo cluster — taken over the WIDER `_AMBIG_LOGO_BAND` (jitter-
    immune; a real sibling's stored phash can sit >margin-3 from the pick) — spans ≥2 DISTINCT doc-type
    slugs AND no TRUSTED title resolves which one. That is exactly the popularity-coin-flip case
    (same-letterhead siblings carry identical fingerprints), so the engine holds the doc for review
    instead of auto-filing a guessed type. An UNTRUSTED detected_slug does NOT resolve (that IS the
    skew failure). Guarded by tests/test_template_type_ambiguity.py."""
    ambig = [t for (t, d) in cands if d <= base_dist + _AMBIG_LOGO_BAND]
    slugs = {(t.get('document_type_slug') or '') for t in ambig if (t.get('document_type_slug') or '')}
    title_resolves = bool(title_trusted and detected_slug and detected_slug in slugs)
    return len(slugs) >= 2 and not title_resolves


def _logo_detail_veto(cands, base_dist, best_t, query_detail_hash) -> bool:
    """SLICE C predicate (pure — Oracle/Phillip/oscar 2026-07-14). True → ABSTAIN the coarse logo pick:
    the cluster spans ≥2 DISTINCT SUPPLIERS (a look-alike monogram collision is possible) AND the
    scanned mark's 256-bit DETAIL hash disagrees per logo_detail.veto_by_detail — the refined
    POSITIVE-RIVAL semantic (the query must positively match a RIVAL's enrolled set), NOT the bare
    far-from-pick should_veto_logo (which trips on isolation garble; docstring corrected 2026-07-23 —
    the JS templates recheck DELIBERATELY uses the bare semantic instead, see
    database/modules/logoDetail.js for why the two diverge). FALSE (keep, byte-identical) on: kill
    switch off; a missing query hash (isolate-fail); a single-supplier cluster; or an empty stored
    set (Slice-B not yet accrued). So it can only turn a cross-supplier logo COLLISION into review,
    never drop a real single-supplier match. Guarded by tests/test_logo_detail_veto.py."""
    if not query_detail_hash or os.environ.get('LOGO_DETAIL_VETO', '1') == '0':
        return False
    try:
        import logo_detail
        best_sup = (best_t.get('dominant_supplier') or '').strip().lower()
        pick_det = list(best_t.get('logo_detail_hashes') or [])
        other_det = {}
        for (t, d) in cands:
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


def _band_siblings(cands, base_dist) -> dict:
    """FIX B1 (suggest-only): {doc_type_slug: closest template} over the SAME wider `_AMBIG_LOGO_BAND`
    the ambiguity test uses (NOT the margin-3 pick cluster — a real drifted sibling can sit at Hamming
    ~8, inside the band, outside the pick margin; a `detected_slug`-only pick would silently under-reach
    it). identify_template EXPOSES this so process_docs can resolve the correct sibling from the doc's
    ref-prefix and PIN it, without coupling this pure matcher to the learned-value model (gary)."""
    out = {}
    for (t, d) in cands:
        if d > base_dist + _AMBIG_LOGO_BAND:
            continue
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
                    return _type_refuse(detected_slug, best_t.get('document_type_slug'))
                # SLICE C — isolated-mark VETO: a ≥2-supplier logo cluster whose picked template's mark
                # DISAGREES with the scan is a look-alike collision → ABSTAIN (fall to keyword + branding
                # net + review). See _logo_detail_veto (scoped, fail-safe, kill-switched, inert until
                # Slice-B detail hashes accrue). Ordered after the trusted-title refuse, before Fix A.
                if _logo_detail_veto(cands, cluster_dist, best_t, query_detail_hash):
                    return None
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
                if (ocr_lower and os.environ.get('TEMPLATE_LOGO_TEXT_GATE', '1') != '0'
                        and (best_t.get('keyword_fingerprint') or [])):
                    if os.environ.get('TEMPLATE_GATE_DISTINCTIVE', '1') != '0':
                        _own, _n = _distinctive_hit_ratio(best_t, ocr_lower)
                        if (method in ('logo', 'logo+slug', 'logo+keywords')
                                and (_n == 0 or _own < _BRANDING_PRESENT_RATIO)
                                and _rival_branding_present(best_t, templates, ocr_lower)):
                            return None
                    elif (method == 'logo'
                            and _keyword_hit_ratio(best_t, ocr_lower) <= 0.0
                            and _rival_branding_present(best_t, templates, ocr_lower)):
                        return None
                ambiguous_type = _type_ambiguity(cands, cluster_dist, detected_slug, title_trusted)
                result = {'template': best_t, 'confidence': conf, 'method': method,
                          'logo_phash': logo_phash, 'ambiguous_type': ambiguous_type}
                if ambiguous_type:
                    # FIX B1: expose the band-13 sibling set + this supplier so process_docs can
                    # resolve the correct type from the doc's ref-prefix and PIN it (suggest-only —
                    # the engine still flags ambiguous_type, so the doc stays HELD). Additive keys;
                    # non-ambiguous matches never carry them → every existing caller is unchanged.
                    result['ambiguous_siblings'] = _band_siblings(cands, cluster_dist)
                    result['cluster_supplier'] = best_t.get('dominant_supplier')
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
    if detected_slug and title_trusted:
        _same_type = sorted(
            ((t, _keyword_hit_ratio(t, ocr_lower)) for t in templates
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
                return {'template': _cand, 'confidence': 60,
                        'method': 'keywords+slug_rescue', 'logo_phash': logo_phash}

    # 2. Keyword fingerprint — fallback for docs without logos. Pass detected_slug so a same-fingerprint
    # sibling of the DETECTED type wins the tie (the logo-drift → keyword-fallback → wrong-sibling class).
    kw_match = _match_by_keywords(ocr_text, templates, detected_slug)
    if kw_match and kw_match['confidence'] >= int(KEYWORD_THRESHOLD * 100):
        # Same title-trust refuse on the logoless path.
        if title_trusted and detected_slug and \
           (kw_match['template'].get('document_type_slug') or '') != detected_slug:
            return _type_refuse(detected_slug, kw_match['template'].get('document_type_slug'))
        if logo_phash:
            kw_match['logo_phash'] = logo_phash
        return kw_match

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
    header_lines = []
    for line in ocr_text.split('\n')[:20]:
        low = line.lower()
        if any(m in low for m in RECIPIENT_MARKERS):
            break  # stop before the per-document recipient/customer block
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


def _kw_type_ambiguity(scored, best_t, winner_slug_match):
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
    but Fix A still HOLDS the doc — the safe direction). Guarded by tests/test_kw_type_ambiguity.py."""
    if winner_slug_match != 0:
        return (False, {}, None)
    top = max(s for _, s in scored)
    S   = [t for t, s in scored if s == top]
    bf_set   = {w.lower() for w in (best_t.get('keyword_fingerprint') or [])}
    best_sup = (best_t.get('dominant_supplier') or '').strip().lower()
    cohort = [t for t in S
              if {w.lower() for w in (t.get('keyword_fingerprint') or [])} == bf_set
              or (best_sup and (t.get('dominant_supplier') or '').strip().lower() == best_sup)]
    sups = {(t.get('dominant_supplier') or '').strip().lower() for t in cohort}
    sups.discard('')
    if len(sups) > 1:                                   # never span two known suppliers
        return (False, {}, None)
    slugs = {}
    for t in cohort:
        slug = t.get('document_type_slug') or ''
        if slug and slug not in slugs:                  # scored is source-order; first per slug is kept
            slugs[slug] = t
    if len(slugs) < 2:
        return (False, {}, None)
    return (True, slugs, best_t.get('dominant_supplier'))


def _match_by_keywords(ocr_text: str, templates: list, detected_slug: str | None = None) -> dict | None:
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
    amb, sibs, cluster_sup = _kw_type_ambiguity(scored, best['template'], best_key[1])
    if amb:
        best['ambiguous_type']     = True
        best['ambiguous_siblings'] = sibs
        best['cluster_supplier']   = cluster_sup
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
