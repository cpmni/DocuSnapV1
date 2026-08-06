"""
extraction/keyword.py
---------------------
Stage 1 extraction — rule-based keyword/pattern matching.
No LLM required. Handles 60-70% of fields on well-structured documents.

Reads patterns from config/keyword_patterns.json.
"""

import os
import re
import json
from pathlib import Path
from difflib import SequenceMatcher   # Lever 1 fuzzy-to-closed-vocabulary title match (PSF licence)

from extraction import number_format   # region-aware amount normaliser
from ocr.text_layout import COLUMN_BREAK_MIN   # 4 = the reconstruct_page_text / born_digital column-break width
from extraction import text_normalise   # shared token normaliser (caption vocab)


def load_patterns(config_path: str | None = None) -> dict:
    """Load keyword patterns from config file."""
    if config_path is None:
        # Look relative to this file, then fall back to a bundled default
        candidates = [
            Path(__file__).parent.parent.parent / "config" / "keyword_patterns.json",
            Path(__file__).parent.parent / "config" / "keyword_patterns.json",
        ]
        for c in candidates:
            if c.exists():
                config_path = str(c)
                break

    if config_path and Path(config_path).exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            # Never let a malformed/unreadable config crash extraction — degrade
            # to "no patterns" (Stage 1 simply finds nothing) rather than throw.
            # The shipped config is the only thing read here (admin overrides live
            # in the DB and are merged separately), so this should never trip in
            # practice — it's a safety net.
            return {}
    return {}


def _infer_validation(field_key: str) -> "str | None":
    """Infer the Stage-1 format gate for a field that has NO shipped pattern entry,
    from its KEY ROLE — mirrors engine._is_ref_field / _TYPE2VAL. Without this, an
    override-seeded custom field (e.g. remittance_number / remittance_date) is
    accepted BLIND (extract_fields only gates when a 'validation' key is present),
    so a generic caption could grab a non-date/non-code value. Returns a
    validation_patterns key, or None for free-text/name fields (left unconstrained,
    as the engine leaves 'text' unconstrained)."""
    k = (field_key or "").strip().lower()
    if not k:
        return None
    if k == "date" or k.endswith("_date"):
        return "date"
    if (k.endswith("_number") or k.endswith("_no") or k.endswith("_num")
            or k.endswith("_ref") or k == "reference" or "reference" in k):
        return "alphanumeric"
    if (k == "total_amount" or k.endswith("_amount") or "total" in k
            or k in ("subtotal", "balance", "amount")):
        return "currency"
    return None


# ── Shared CAPTION VOCABULARY (taught-field ownership guard c2 + known-caption guard G3b) ──
# A "caption" is a printed field-label ("Customer", "Order Number", "SO #") — never a VALUE.
# The vocabulary is the RUN's post-merge label banks (shipped ∪ overrides ∪ seeds, i.e. every
# field's field_patterns['labels']) plus each field's DISPLAY label. Two comparison forms per
# caption so both a spaced and a punctuation-glued rendering match: the content TOKEN-TUPLE
# ("SO #" -> ('so',)) and the alnum-only JOINED form ("S.O.No." -> 'sono').
def _caption_forms(value):
    """(content_token_tuple, alnum_joined) for a value — the caption comparison keys."""
    toks = tuple(t for t in text_normalise.tokenise(value) if any(c.isalnum() for c in t))
    joined = ''.join(c for c in text_normalise.normalise_for_tokens(value) if c.isalnum())
    return toks, joined


def build_caption_vocab(field_patterns: dict, field_defs=None) -> dict:
    """The run's caption vocabulary -> {'tuples': set, 'joined': set}. Reach GROWS with the
    banks (a new shipped/override/seed label is automatically a caption). field_patterns must be
    the POST-MERGE bank (patterns_for_run['field_patterns'])."""
    tuples, joined = set(), set()

    def _add(text):
        tt, jj = _caption_forms(text)
        if tt:
            tuples.add(tt)
            joined.add(jj)

    for entry in (field_patterns or {}).values():
        for lab in (entry.get('labels') or []):
            _add(lab.get('text') if isinstance(lab, dict) else lab)
    for f in (field_defs or []):
        _add(f.get('label'))
    return {'tuples': tuples, 'joined': joined}


# ── Taught-ownership OWN-LABEL exemption (2026-07-24, reggie design) ───────────────────
# Every keyword read records the exact caption it matched (results[key]['label'], see the
# extract_fields read-dict). The taught-field ownership guard (engine._flag_taught_field_
# ownership) caps a plain keyword read of an authoritatively-taught field that didn't confirm
# on this page — but a value matched via a caption UNIQUE TO THIS FIELD ("Invoice No", "PO
# Date") is a precise labelled read, not a generic-caption stand-in. This pair lets the guard
# tell the two apart: a discriminating own-label declines the cap; a SHARED caption ("Date",
# "Issue Date", "Order No" — carried by >=2 roles) or a purely-generic one ("#") stays held.
# Precision-first — any doubt keeps the hold (a false exemption is a silent wrong auto-file).
_GENERIC_LABEL_TOKENS = frozenset({
    'date', 'dated', 'no', 'number', 'num', 'ref', 'reference', 'id', 'dt', 'of', 'the',
})


def _norm_label(text) -> str:
    return ' '.join(str(text or '').lower().split())


def build_label_owner_index(field_patterns: dict) -> dict:
    """{normalised-label -> frozenset(field_keys carrying it)} from the POST-MERGE
    field_patterns bank (patterns_for_run['field_patterns'] — the SAME source as
    build_caption_vocab). A label carried by >=2 roles ('date', 'issue date', 'order no')
    is thereby detectable as NON-discriminating. Reach grows automatically with the banks."""
    owners: dict = {}
    for key, entry in (field_patterns or {}).items():
        for lab in (entry.get('labels') or []):
            t = _norm_label(lab.get('text') if isinstance(lab, dict) else lab)
            if t:
                owners.setdefault(t, set()).add(key)
    return {k: frozenset(v) for k, v in owners.items()}


def label_is_own_discriminating(label, field_key, owners) -> bool:
    """True iff the matched keyword `label` is UNIQUE to `field_key` across the run's
    field_patterns AND carries >=1 field-identifying token (not purely generic role words).
    Precision-first: any doubt -> False (keep the ownership hold). Used ONLY by the taught-
    ownership guard to decline its cap for a precisely-labelled read.
      "Invoice No"  -> owned by {invoice_number}, token 'invoice' non-generic -> True
      "Date"        -> owned by {invoice_date, po_date, order_date}           -> False (shared)
      "#"           -> owned by {invoice_number} but no alnum token           -> False (generic)"""
    t = _norm_label(label)
    if not t or owners.get(t) != frozenset({field_key}):
        return False                                       # shared / unknown => not own
    toks = re.findall(r'[a-z0-9]+', t)
    return any(tok not in _GENERIC_LABEL_TOKENS for tok in toks)   # >=1 distinguishing token


def label_is_own_discriminating_in_type(label, field_key, owners, type_keys) -> bool:
    """TYPE-SCOPED sibling of label_is_own_discriminating (B', gary design + Oracle
    SIGN-OFF-WITH-CONDITIONS 2026-07-26). Judges the matched caption's uniqueness against the
    RESOLVED doc TYPE's field-key set instead of the GLOBAL bank: a label carried by >=2 fields
    globally but by EXACTLY `field_key` WITHIN this type is own-discriminating FOR THIS TYPE
    ("Order Date" -> {po_date, order_date} globally, but only po_date exists on a purchase_order).
    The generic-token gate is RETAINED, so bare "Date" NEVER exempts, on any type. Precision-first:
    any doubt -> False.

    The CALLER MUST gate this on type-authority (self._type_authoritative) — unlike a globally-
    unique label ("Invoice No"), a type-scoped-unique one is NOT self-identifying, so the exemption
    leans on the type having resolved correctly. When `type_keys` is the UNION of all types' fields
    (no type resolved) the intersection == the global owner set, so this DEGRADES to the global
    test (held) — doubly safe."""
    t = _norm_label(label)
    if not t:
        return False
    gowners = owners.get(t)
    if not gowners or field_key not in gowners:
        return False                                       # unknown label, or field not even a global owner
    if (gowners & frozenset(type_keys or ())) != frozenset({field_key}):
        return False                                       # shared WITHIN this type, or field absent from it
    toks = re.findall(r'[a-z0-9]+', t)
    return any(tok not in _GENERIC_LABEL_TOKENS for tok in toks)   # retain the generic-token gate


def value_is_caption(value, vocab) -> bool:
    """True when `value` IS a known caption (not a value). Rule 1: content-token-tuple equality
    ('SO #' == the 'SO #' label). Rule 2: alnum-joined equality, ONLY for a MULTI-TOKEN or
    PUNCTUATED candidate ('S.O.No.' == 'SO No'). NEVER containment/prefix ('Order Solutions Ltd',
    'Total Office Supplies', bare 'SONO' all survive). An empty content tuple (a '#'-only value)
    never matches."""
    if not vocab:
        return False
    tt, jj = _caption_forms(value)
    if not tt:
        return False
    if tt in vocab.get('tuples', ()):          # rule 1
        return True
    v = str(value or '')
    punctuated = any(not (c.isalnum() or c.isspace()) for c in v)
    if (len(tt) > 1 or punctuated) and jj and jj in vocab.get('joined', ()):   # rule 2
        return True
    return False


# Val_types whose REAL value ALWAYS carries a digit — so a purely ALPHABETIC harvested continuation
# ("Information", "Description") is a printed caption word, not a value. EXCLUDES currency_code
# (GBP/USD are all-alpha and legitimate) and free text. (P2/label-relocation caption guard, reggie.)
_DIGIT_BEARING_VAL_TYPES = frozenset({
    "alphanumeric", "job_reference", "reference_code", "vat_gb", "iban",
})
# Generic column/header nouns that are NEVER a standalone free-text VALUE. Kept tight for precision
# (a single-token real name must not collide). A SEPARATE frozenset from _CAPTION_NOUN_TAIL — do NOT
# fold them; that one's consumer (_is_caption_fragment) must stay byte-identical. Extend on evidence.
_CAPTION_CONTINUATION_WORDS = frozenset({
    "information", "description", "details", "reference", "quantity", "qty", "number",
})


def is_caption_continuation(value, val_type=None, label=None, vocab=None) -> bool:
    """Last-ditch anti-silent-commit guard for the anchor cross-read/inline harvest: True when a
    harvested CONTINUATION word is a printed caption/column word, not a value (the "Item Information"
    header stealing the "Item" label, reading 'information'). MUST be gated by the caller to the
    RE-READ methods (a rigid crop of the taught box is not a caption pickup). val_type-aware and
    precision-first — errs toward NOT firing on a plausible value:
      ARM 0 (reuse): the word IS a configured field label (needs the run's caption vocab; inert when None).
      ARM 1: a CODE/REFERENCE field's real value carries a digit, so a PURELY ALPHABETIC read is a caption.
      ARM 2: NAME/FREE-TEXT/untyped — all-alpha is legitimate, so fire only when EVERY content token is a
             known header noun (a real 2-word name like 'Sofa Bed' survives; 'Description Quantity' is caught).
    """
    v = (value or "").strip()
    if not v:
        return False
    core = re.sub(r"^[^0-9A-Za-z]+|[^0-9A-Za-z]+$", "", v)   # drop OCR edge junk
    if not core:
        return False
    if vocab and value_is_caption(v, vocab):                 # ARM 0 (optional; inert without vocab)
        return True
    if val_type in _DIGIT_BEARING_VAL_TYPES:                 # ARM 1 (code/ref: all-alpha => caption)
        return bool(re.fullmatch(r"[A-Za-z]+", core))
    toks = re.findall(r"[a-z0-9]+", core.lower())            # ARM 2 (name/free-text: every token a header noun)
    return bool(toks) and all(t in _CAPTION_CONTINUATION_WORDS for t in toks)


# G3b KNOWN-CAPTION VALUE GUARD kill switch (2026-07-11, DIRECTION_SUPREMACY): for a name-like /
# party field (CUSTOMER-SIDE only — supplier_name excluded), a candidate VALUE that IS a known
# caption ("SO #", "Customer") dies AT GENERATION (right/below), so a caption never fills the field
# (the incident: customer_name read the "SO #" caption as a value). See extract_fields /
# _search_for_label `caption_guard`. Default ON; KNOWN_CAPTION_GUARD=0 disables.
KNOWN_CAPTION_GUARD_ENABLED = os.environ.get('KNOWN_CAPTION_GUARD', '1') != '0'


def merge_label_overrides(patterns: dict, overrides: list, doc_slug: str | None) -> dict:
    """Merge admin keyword label overrides for `doc_slug` onto `patterns`.

    Each override is {doc_type_slug, field_key, label}. Only those whose
    doc_type_slug matches `doc_slug` (case-insensitive) apply. The merge is
    ADDITIVE: a field's shipped labels are preserved and the override label is
    appended; a field_key with NO shipped entry gets one created (so a CUSTOM
    doc-type field — which keyword.extract_fields would otherwise skip — becomes
    keyword-extractable). Returns the ORIGINAL `patterns` object unchanged when
    there's nothing to merge, so the common (no-override) path costs nothing.

    Pure: never mutates the input patterns; builds shallow copies of only the
    field_patterns entries it touches.
    """
    if not overrides or not doc_slug:
        return patterns
    slug = str(doc_slug).strip().lower()
    relevant = [o for o in overrides
                if str(o.get("doc_type_slug", "")).strip().lower() == slug
                and o.get("field_key") and o.get("label")]
    if not relevant:
        return patterns

    field_patterns = {k: dict(v) for k, v in (patterns.get("field_patterns") or {}).items()}
    for o in relevant:
        key = str(o["field_key"]).strip()
        lab = str(o["label"]).strip()
        if not key or not lab:
            continue
        entry = field_patterns.get(key)
        if entry is None:
            # Custom field with no shipped pattern — seed a sane default so the
            # label alone makes it extractable (value to the right of, or below,
            # the label). Attach a format gate inferred from the field-key role so
            # the value is still validated (date/ref/currency), not accepted blind.
            entry = {"labels": [], "directions": ["right", "below"], "base_confidence": 80}
            inferred = _infer_validation(key)
            if inferred:
                entry["validation"] = inferred
        labels = list(entry.get("labels") or [])
        # PRECEDENCE: an admin override is a deliberate per-install instruction to
        # look for THIS label, so it is consulted BEFORE the shipped/auto labels —
        # extract_fields tries labels in order and the first valid value wins, so
        # an APPENDED override could never beat a shipped label that also matches
        # (the "changing the label did nothing" bug). Tag it (dict form) so the
        # winning hit is marked method "keyword_override": that flags provenance
        # AND lets engine.extract treat it as an authority that can displace a
        # GENERIC template value (a plain "keyword" hit can't clear the
        # > template_fixed confidence gate). It still yields to curated Stage 0.5
        # mappings / Stage 2 ⊕ anchors. Fall-through to the shipped labels is
        # preserved when the override label isn't found or its value fails the
        # field's format gate.
        if not any(isinstance(x, dict) and x.get("override")
                   and str(x.get("text", "")).strip().lower() == lab.lower()
                   for x in labels):
            labels.insert(0, {"text": lab, "override": True})
        field_patterns[key] = {**entry, "labels": labels}

    return {**patterns, "field_patterns": field_patterns}


# Common short-form captions per structural ROLE, so a CUSTOM ref/date field whose printed caption
# differs from its DB label ("Reference number" printed as "Reference" / "Reference No." / "Ref") is
# still found. Ref forms stay ref-SPECIFIC (all carry ref/reference/no) to limit collisions; the
# _ref_caption_party_conflict guard blocks a buyer/seller "Customer Reference" cross-fill.
# The "No" forms are tried FIRST so the caption is fully consumed ("Reference No.    WS438527" →
# the existing pure-punctuation-column drop yields "WS438527"); the bare forms are the fallback for
# a caption with no "No". Any residual "No"/"Number"/"." glued to a narrow-gap value is stripped in
# extract_fields for a seeded ref read (role_caption='ref').
_REF_ROLE_CAPTIONS  = ["Reference No", "Reference", "Ref No", "Ref"]
_DATE_ROLE_CAPTIONS = ["Date"]

# RC1 slice 2 kill switch: seed a custom FREE-TEXT field's own DB label at Stage 1
# (see the party branch in seed_field_labels below).
SEED_FREE_TEXT_ENABLED = True


def seed_field_labels(patterns: dict, field_defs: "list | None") -> dict:
    """RC1 (2026-07-10): make a CUSTOM ref/date field attemptable at Stage 1 from its OWN DB label
    — without an admin override. extract_fields skips any field key with no shipped pattern (the
    'field never even tried' hole: a custom Worksheet type keys reference_number/date, neither
    shipped, so both read only if a learned anchor exists → blank on unseen docs). For each field
    whose key has no shipped entry and whose ROLE is ref or date (via _infer_validation), seed a
    keyword entry using the field's label + the role's short-form captions, as PLAIN labels — method
    'keyword', NOT 'keyword_override', i.e. an AUTO tier subordinate to Stage-2 anchors / Stage-0.5
    mappings — with base_confidence 80 (below the auto-file critical-field floor 88, so a confusable
    read fails toward REVIEW, never a silent wrong file). Ref captions carry role_caption='ref' so
    _search_for_label applies the party guard to them only. SLICE 2 (2026-07-10): custom FREE-TEXT
    fields (role None, DB type 'text') are seeded too — own label only, base 75,
    role_caption='party' (the G1/G2/G3 guards), gated by SEED_FREE_TEXT_ENABLED — see the branch
    below. Additive + pure: returns `patterns` unchanged when there is nothing to seed."""
    if not field_defs:
        return patterns
    shipped = patterns.get("field_patterns") or {}
    field_patterns = None
    for f in field_defs:
        key = str((f or {}).get("key") or "").strip()
        if not key or key in shipped:
            continue
        role = _infer_validation(key)
        if role not in ("date", "alphanumeric"):        # ref == alphanumeric; currency deferred
            # RC1 SLICE 2 (2026-07-10): a custom FREE-TEXT field (no inferable role, DB type
            # 'text') is seeded from its OWN DB label ONLY — no synonym bank (free text has no
            # bounded role; a caption that differs from the label is covered by the admin
            # override / ⊕ teach / Stage-0.5 paths, all of which outrank this). base 75:
            # BELOW seeded ref/date's 80 (a weaker evidence class — free text has no value
            # format gate), ABOVE the 70 per-field review threshold (a clean read doesn't
            # flag every doc forever). NOTE (Oracle, 2026-07-10): 75 is NOT an auto-file drag —
            # an OPTIONAL field is often not counted in overall_confidence at all
            # (validator counts required-only when the type has required fields), and a
            # counted-but-EMPTY field scored 0 before, so filling it RAISES overall. The real
            # rails are: the at-100 lenient gate's freetext skip (a previously-signed Slice-7
            # class shipped `customer_name`@78-80 already rides), per-field review routing
            # (<70 flags; guards fail-EMPTY), and the ref/date critical-field floor for
            # anything filing-critical. role_caption='party' arms the G1/G2/G3 caption guards
            # in _search_for_label; method stays plain 'keyword' (auto tier), so every existing
            # precedence rule holds by construction. The label DEDUPE below means a caption
            # already hunted by a SAME-TYPE sibling (e.g. customer_name's shipped "Customer")
            # is never double-seeded — the established field owns it, no double-fill.
            if not (SEED_FREE_TEXT_ENABLED and role is None
                    and (str((f or {}).get("type") or "").lower() == "text")):
                continue
            # Oracle C2 (Generic Document design): the `title` field is NEVER seeded — its
            # label "Title" is a genuinely printed caption ("Title: Mr/Mrs"), and a seeded
            # keyword read would REPLACE the carried auto_title row on reprocess via the
            # merge's new-wins rule (a silent title downgrade). Auto-Title
            # (extraction/title_pick.py) owns this key; pinned by tests/test_title_pick.py.
            if str((f or {}).get("key") or "").strip().lower() == "title":
                continue
            label = str((f or {}).get("label") or "").strip()
            if len(label) < 3:                          # a "To"-style label is not a caption
                continue
            # DEDUPE scoped to the field's OWN document type: a SIBLING field of the same
            # type already hunting this caption (customer_name's shipped "Customer",
            # supplier_name's "Supplier", or an earlier-seeded same-type sibling) would
            # DOUBLE-FILL from one printed caption — the established entry owns it, this
            # field stays teach-only. Fields of OTHER types can't collide (extract_fields
            # only hunts the detected type's keys), so a global-bank label must NOT block
            # a type that genuinely lacks that sibling (the config carries customer_name
            # whether or not this type has such a field).
            current = field_patterns if field_patterns is not None else shipped
            low = label.lower()
            _tid = (f or {}).get("document_type_id")    # None (e.g. tests) → all co-typed
            sib_keys = {str((d or {}).get("key") or "").strip()
                        for d in field_defs
                        if (d or {}).get("document_type_id") == _tid} - {key, ""}
            taken = False
            for sk in sib_keys:
                for x in ((current.get(sk) or {}).get("labels") or []):
                    t = (x.get("text") if isinstance(x, dict) else x) or ""
                    if str(t).strip().lower() == low:
                        taken = True
                        break
                if taken:
                    break
            if taken:
                continue
            if field_patterns is None:
                field_patterns = {k: dict(v) for k, v in shipped.items()}
            field_patterns[key] = {"labels": [label], "directions": ["right", "below"],
                                   "base_confidence": 75, "role_caption": "party"}
            continue
        label = str((f or {}).get("label") or "").strip()
        forms = _DATE_ROLE_CAPTIONS if role == "date" else _REF_ROLE_CAPTIONS
        labels, seen = [], set()
        for lab in ([label] + list(forms) if label else list(forms)):
            low = lab.strip().lower()
            if not low or low in seen:
                continue
            seen.add(low)
            labels.append(lab.strip())
        if not labels:
            continue
        if field_patterns is None:
            field_patterns = {k: dict(v) for k, v in shipped.items()}
        entry = {"labels": labels, "directions": ["right", "below"], "base_confidence": 80,
                 "validation": ("date" if role == "date" else "alphanumeric")}
        if role == "alphanumeric":
            entry["role_caption"] = "ref"
        field_patterns[key] = entry

    # ── DATE-ROLE GENERIC LABEL (owner report 2026-08-01; kill DATE_ROLE_GENERIC_LABEL=0) ──
    # A SHIPPED date entry that lacks the bare caption "Date" can never read a page that
    # prints just "Date 07/11/2026" without a taught anchor — the Vellum delivery-docket
    # class: invoice_date/order_date/po_date all ship bare "Date", delivery_date shipped
    # only its specific forms, so every COLD delivery scope (and any custom date field with
    # the same gap) read nothing a human sees instantly. Append "Date" to any date-validated
    # entry missing it — UNLESS a same-type sibling already hunts the caption (due_date on an
    # invoice type: invoice_date owns bare "Date"; the established owner keeps it, no
    # double-fill — the same dedupe doctrine as the RC1 seeding above). Additive + pure;
    # confidence/directions untouched, so precedence and every downstream guard hold.
    if os.environ.get("DATE_ROLE_GENERIC_LABEL", "1") != "0":
        for f in (field_defs or []):
            key = str((f or {}).get("key") or "").strip()
            if not key:
                continue
            current = field_patterns if field_patterns is not None else shipped
            entry = current.get(key)
            if not entry or str(entry.get("validation") or "").lower() != "date":
                continue
            def _texts(e):
                return [str((x.get("text") if isinstance(x, dict) else x) or "").strip().lower()
                        for x in (e.get("labels") or [])]
            if "date" in _texts(entry):
                continue
            _tid = (f or {}).get("document_type_id")
            sib_has = False
            for d in (field_defs or []):
                sk = str((d or {}).get("key") or "").strip()
                if not sk or sk == key or (d or {}).get("document_type_id") != _tid:
                    continue
                se = current.get(sk)
                if se and "date" in _texts(se):
                    sib_has = True
                    break
            if sib_has:
                continue
            if field_patterns is None:
                field_patterns = {k: dict(v) for k, v in shipped.items()}
            e2 = dict(field_patterns.get(key) or entry)
            e2["labels"] = list(e2.get("labels") or []) + ["Date"]
            field_patterns[key] = e2

    if field_patterns is None:
        return patterns
    return {**patterns, "field_patterns": field_patterns}


# ── Document type detection ───────────────────────────────────────────────────

# Heading-adjacent tokens a real title line may carry beside the type word — a
# number/reference or a "No."/"#"/"Number" caption — none of which make it a body
# mention. Any OTHER word on the line means it's prose, not a heading.
# Split into PUNCTUATION (always tolerated) vs CAPTION WORDS (tolerated only by the
# relaxed EXPOSED-flag test, caption_ok=True). The tighter SCORING variant (Part B,
# caption_ok=False) excludes the caption words so a leftmost table column-header
# segment reading "Purchase Order  No." cannot earn the strong 2.0 heading weight.
_HEADING_PUNCT   = frozenset({"#", "-", ":", "|"})
_HEADING_CAPTION = frozenset({"no", "no.", "number", "num", "ref"})
_HEADING_ADJ     = _HEADING_PUNCT | _HEADING_CAPTION

# A run of COLUMN_BREAK_MIN (4) or more spaces = a COLUMN break (reconstruct_page_text / born_digital
# emit exactly the 4-space COLUMN_BREAK for a wide intra-row x-gap; adjacent columns compound). Derived
# from the single-source constant so a producer width change propagates here — pinned by
# test_column_break_contract.py. Matches the four shipped ` {4,}` column guards below (:766/:846/:904/:1070).
_COL_BREAK_RE = re.compile(r' {%d,}' % COLUMN_BREAK_MIN)


def _segment_is_heading(seg: str, p: str, caption_ok: bool = True) -> bool:
    """One reading-line COLUMN segment IS the matched type phrase plus at most heading-adjacent
    tokens — a reference/number CODE ("WORKSHEET 38", "WORKSHEET WS-38", "PURCHASE ORDER #PO-1234")
    or a "No."/"#"/"Number" caption. A real extra word makes it a body mention.

    caption_ok (default True) = the relaxed EXPOSED-flag behaviour: a "No."/"Number"/"Ref" CAPTION
    word beside the title is tolerated (a real banner often prints one). caption_ok=False = the
    tighter SCORING variant (Part B, column-aware heading scoring): only a numeric CODE + code
    punctuation is allowed beside the title, so a leftmost table column-header segment that reads
    "Purchase Order  No." (no wide column gap splitting them) can't earn the strong 2.0 heading
    weight — the banner must stand ALONE (or with just a code) to score as a heading."""
    if not p or p not in seg:
        return False
    if seg == p:
        return True
    rest = seg.replace(p, " ", 1)
    for t in rest.split():
        # A reference/number CODE beside the title (not a real word): contains a digit and
        # is only alphanumerics + code punctuation ("38", "ws-38", "inv-2024-001", "#po1234").
        if any(ch.isdigit() for ch in t) and all(ch.isalnum() or ch in "#:.-/|" for ch in t):
            continue
        # Punctuation is always heading-adjacent; caption WORDS only when caption_ok
        # (caption_ok=True reproduces the old `t in _HEADING_ADJ` exactly).
        if t in _HEADING_PUNCT or (caption_ok and t in _HEADING_CAPTION):
            continue
        return False                                        # a real extra word → a mention
    return True


def _line_is_heading_like(line: str, phrase: str) -> bool:
    """Relaxed heading test for the EXPOSED `heading` signal only (scoring uses the strict whole-line
    equality — untouched, so confidence stays byte-identical). COLUMN-AWARE (Oracle 2026-07-12): a
    banner title in its OWN column ("WORKSHEET") must not be denied heading status because a far-right
    date/ref column got merged onto the same OCR reading line ("WORKSHEET    Date 25/11/2026" — the
    Cascade worksheet-stuck-as-invoice bug). Split the line into COLUMN segments on the column-break
    marker and test each independently; True if ANY segment is the title (+ heading-adjacent tokens).
    An inline PROSE mention ("...see the attached worksheet...") has no column break → ONE segment →
    byte-identical to the pre-column behaviour."""
    p = (phrase or "").strip().lower()
    if not p:
        return False
    s = (line or "").strip().lower()
    return any(_segment_is_heading(seg.strip(), p) for seg in _COL_BREAK_RE.split(s))


# Field-caption / letterhead words that head a top-band line WITHOUT being the document's TYPE title.
_HARVEST_STOP = frozenset({
    'date', 'reference', 'ref', 'number', 'no', 'invoice', 'account', 'order', 'page', 'sheet',
    'to', 'from', 'for', 'site', 'customer', 'supplier', 'client', 'total', 'subtotal', 'tel',
    'fax', 'email', 'vat', 'reg', 'company', 'ltd', 'limited', 'address', 'phone', 'mobile',
})


def _harvest_top_band_heading(lines, installed_type_names=None):
    """Best-effort dominant standalone TYPE heading — an UNINSTALLED type like 'Worksheet' — from the
    top band, to seed the "Add <type>" nudge when the type-presence gate/veto leaves a doc UNTYPED.
    CONSERVATIVE: returns None on any ambiguity (a wrong harvest = a confusing nudge; None = plain
    untyped, safe). Skips line 0 (letterhead); a candidate is the leftmost column segment of a line
    that is an ALL-CAPS standalone of 1-2 alpha words (each >=3 chars) — the shape a real type BANNER
    takes ("WORKSHEET", "DELIVERY DOCKET") — that is neither a field caption nor an already-installed
    type (an installed type would have been detected and typed the doc)."""
    installed_lc = {str(n).strip().lower() for n in (installed_type_names or [])}
    for line in (lines or [])[1:12]:                              # skip L0 (letterhead); top band only
        seg = _COL_BREAK_RE.split((line or "").strip())[0].strip()
        words = seg.split()
        if not (1 <= len(words) <= 2):
            continue
        if not all(w.isalpha() and len(w) >= 3 for w in words):   # a code/address/number is not a title
            continue
        if not seg.isupper():                                     # a type BANNER is set in caps
            continue
        low = seg.lower()
        if low in installed_lc or any(w.lower() in _HARVEST_STOP for w in words):
            continue
        return seg.title()                                        # "WORKSHEET" -> "Worksheet"
    return None


# SLICE 1 (HEADING_LETTER_SPACING, Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-21): a document-TYPE
# heading set in a TRACKED / letter-spaced display font ("PURCHASE ORDER") is fragmented by Tesseract
# into pseudo-words ("PU RC HASE ORDER"); _type_keyword_pattern joins the phrase's words with \s* but
# NOT within a word, so it can't match, the type never scores from its own title, and the doc
# mis-types to a same-logo sibling. Top band the heading sits in (generous — a low-sitting title
# under a tall letterhead still qualifies; body prose is excluded by BOTH this AND the exact-equality
# test below).
_HEADING_TOP_BAND_LINES = 15
_HEADING_TOP_BAND_FRAC  = 0.28
# Minimum collapsed phrase length to attempt letter-spacing recovery. A real letter-spaced TITLE is a
# word ("invoice"=7, "quote"=5, "purchaseorder"=13); a SHORT abbreviation type name ("PO", "GRN")
# would collision-match a spaced code label ("P O 12345" -> "po"), so it is never despace-recovered
# (Oracle: the thinnest part of the false-positive surface).
_MIN_DESPACE_LEN = 5


def _despaced_heading(seg0: str, phrase_lc: str) -> bool:
    """True when seg0's LEADING words — with ALL spacing removed — EXACTLY equal `phrase_lc` with its
    spaces removed, recovering a letter-spaced title ("PU RC HASE ORDER" -> "purchaseorder" ==
    "purchaseorder"). Trailing reference/number CODE tokens (a "PO-62560"/"38" beside the title) are
    peeled first — the SAME code-token predicate _segment_is_heading uses. EXACT equality (never
    substring) is load-bearing against false positives: "PO Box 12" peels "12" but the real word "box"
    stays -> "pobox" != "po"; "please order online" -> "pleaseorderonline" != any phrase. Caller
    scopes this to name/alias phrases + the top band + the regex-found-nothing case, so it is purely
    ADDITIVE (byte-identical when it never fires)."""
    # MULTI-WORD phrases only. Letter-spacing fragments a title's WORDS ("PURCHASE ORDER" ->
    # "PU RC HASE ORDER"); collapsing there just rejoins the fragments. A SINGLE-word type name
    # ("Worksheet") must NOT be matched by collapsing a legitimately-spaced segment ("Work Sheet"):
    # that two-word spelling is the ALIAS mechanism's job, and auto-collapsing it would bypass the
    # alias contract (test_detect_type_aliases: the null-alias path stays byte-identical). Every live
    # letter-spacing case is a multi-word title (PURCHASE ORDER / SALES ORDER / DELIVERY NOTE). A
    # single-word letter-spaced title ("IN VO ICE") is a deferred, thinner-precision extension.
    if len((phrase_lc or "").split()) < 2:
        return False
    target = (phrase_lc or "").replace(" ", "")
    if len(target) < _MIN_DESPACE_LEN:                      # short abbreviations are too collision-prone
        return False
    toks = seg0.split()
    while toks and any(ch.isdigit() for ch in toks[-1]) \
            and all(ch.isalnum() or ch in "#:.-/|" for ch in toks[-1]):
        toks.pop()                                          # peel a trailing ref/code token
    if not toks:
        return False
    return "".join(toks) == target


def _collapse_title_tokens(seg0: str) -> list[str]:
    """The leading TITLE tokens of a reading-line column segment, with trailing reference/number CODE
    tokens peeled — the SAME peel _despaced_heading uses inline. Factored out so _fuzzy_heading can
    reuse the exact peel WITHOUT touching the byte-frozen _despaced_heading on the hot exact path
    (Oracle C4: leave the exact function untouched; the small duplication is deliberate)."""
    toks = (seg0 or "").split()
    while toks and any(ch.isdigit() for ch in toks[-1]) \
            and all(ch.isalnum() or ch in "#:.-/|" for ch in toks[-1]):
        toks.pop()                                          # peel a trailing ref/code token
    return toks


# Lever 1 (HEADING_FUZZY_VOCAB, Herald/Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-26): a title read that
# is GARBLED (a skew/noise glyph corruption — "PU RC fa ASE ORDER") or SINGLE-WORD letter-spaced
# ("I N V O I C E") fails _despaced_heading's EXACT equality, so the type never scores from its own
# title and the doc falls to a same-logo sibling / generic fingerprint (the Northgate PO->Invoice
# flip). The exact test is kept verbatim (its false-positive guarantee); this fuzzy arm is ADDED beside
# it. Safe ONLY on the tiny CLOSED vocabulary (installed type names ∪ aliases) — measured vocab-to-vocab
# block-ratio max 0.737 < the 0.82 accept floor, so no clean phrase can ever fuzzy-match a DIFFERENT
# type. Threshold + margin are the Oracle C3 belt.
_FUZZY_HEADING_RATIO  = 0.82   # SequenceMatcher.ratio accept floor (window: genuine-decoy 0.762 .. recovery 0.857)
_FUZZY_HEADING_MARGIN = 0.08   # best must beat 2nd-best vocab phrase by this (C3 — a garble equidistant between two types HOLDs)


def _fuzzy_heading(seg0: str, phrase_lc: str, vocab_lc) -> bool:
    """ADDITIVE fuzzy fallback beside _despaced_heading (Lever 1). True when seg0's collapsed leading
    title tokens match `phrase_lc` (spaces removed) by difflib block-ratio >= _FUZZY_HEADING_RATIO AND
    `phrase_lc` is the clear ARGMAX over the whole closed vocabulary (beats the 2nd-best by
    _FUZZY_HEADING_MARGIN). Recovers 'purcfaaseorder'~0.889 'purchaseorder' and 'invoice'==1.0 from
    'I N V O I C E'. The argmax+margin over `vocab_lc` (the caller's name_alias_lc) is Oracle C3: a clean
    DIFFERENT-type phrase scores < 0.74 to any other vocab entry, so it can never fuzzy-fire this one,
    and a genuinely-ambiguous garble (no clear winner) HOLDs instead of guessing. Caller scopes this to
    the top band + leftmost segment + the regex-found-nothing case + kw ∈ name_alias — identical to the
    exact arm — so it is byte-identical when it never fires."""
    target = (phrase_lc or "").replace(" ", "")
    if len(target) < _MIN_DESPACE_LEN:                      # keep the short-abbreviation floor (PO/GRN collide)
        return False
    toks = _collapse_title_tokens(seg0)
    if not toks:
        return False
    # The read must be MULTI-TOKEN — fuzzy recovers a SPACED / FRAGMENTED title (letter-spacing, or a
    # skew garble that splits the word), NOT a single intact mis-spelled token ('Wksheet'). A compact
    # misspelling of a clean word is the EXACT alias mechanism's domain; matching it here would loosen
    # the alias-is-exact contract (test_detect_type_aliases) for any alias whose collapsed form is short.
    if len(toks) < 2:
        return False
    # SINGLE-word target: admit ONLY a genuinely FRAGMENTED read (letter-spacing), never a word-spaced
    # two-word spelling — 'WORK SHEET' -> worksheet is the ALIAS mechanism's job, not fuzzy collapse
    # (preserves the test_detect_type_aliases contract). Multi-word targets are the proven
    # letter-spacing class and take no fragmentation gate (so a lightly-garbled 2-word title still fuzzes).
    if len((phrase_lc or "").split()) < 2:
        fragmented = len(toks) >= 3 or sum(len(t) <= 2 for t in toks) * 2 > len(toks)
        if not fragmented:
            return False
    collapsed = "".join(toks)
    if not collapsed:
        return False
    r_self = SequenceMatcher(None, collapsed, target).ratio()
    if r_self < _FUZZY_HEADING_RATIO:
        return False
    second = 0.0                                            # best ratio to any OTHER vocab phrase
    for v in (vocab_lc or ()):
        vt = (v or "").replace(" ", "")
        if not vt or vt == target:
            continue
        rv = SequenceMatcher(None, collapsed, vt).ratio()
        if rv > second:
            second = rv
    return (r_self - second) >= _FUZZY_HEADING_MARGIN


def detect_document_type(ocr_text: str, patterns: dict,
                          known_types: list[str] | None = None,
                          type_aliases: dict | None = None) -> dict | None:
    """
    Score candidate document types by scanning every line for type-indicating
    phrases, weighting matches by how close to the top of the page they sit
    and whether the matched text essentially IS the line (a heading) rather
    than an incidental mention inside running text.

    Real layouts vary hugely in how much letterhead/address/VAT/bank-detail
    preamble precedes the actual type heading — from zero lines to well over
    half the page (confirmed against sample invoices: ~40% had their
    "Invoice"/"INVOICE" heading sitting beyond a fixed "top quarter" cutoff,
    which silently excluded it from scanning entirely). Scanning the whole
    document and applying a smooth positional weight keeps "headings near the
    top matter most" without ever structurally excluding a legitimate one.

    known_types: type names configured in the database (built-in + custom,
    enabled only). Each name is folded in as its own keyword phrase, so a
    custom type ("Delivery Receipt", "Goods Received Note", ...) participates
    in scoring exactly like a built-in type — the configured name itself is
    the header phrase to look for, with no per-type rules required.
    """
    lines = ocr_text.split("\n")
    total = len(lines)
    if not total:
        return None

    # Part B kill switch (default ON): column-aware heading SCORING for name/alias banners.
    _col_aware = os.environ.get("HEADING_SCORE_COLUMN_AWARE", "1") != "0"
    # Slice 1 kill switch (default ON): letter-spacing heading recovery (see _despaced_heading).
    _letter_spacing = os.environ.get("HEADING_LETTER_SPACING", "1") != "0"
    # Lever 1 kill switch (default ON): fuzzy-to-closed-vocabulary title recovery (see _fuzzy_heading).
    # OFF ⇒ the elif below short-circuits ⇒ detect_document_type is byte-identical (Oracle C4).
    _fuzzy = os.environ.get("HEADING_FUZZY_VOCAB", "1") != "0"
    # TITLE-GAP COLLAPSE (herald 2026-08-07, DARK — flip after the corpus gate). A wide-TRACKED
    # multi-word title ('CREDIT    NOTE', 'DELIVERY    NOTE') reconstructs with a >=COLUMN_BREAK_MIN
    # intra-title gap, so the column-aware heading test splits it into two columns and the title
    # scores as a mere MENTION (Credit Note 4.7 vs 9.3) — the doc mis-types (Invoice). FIX: collapse
    # whitespace ONLY inside the matched type-phrase SPAN before the column split, so an intra-title
    # gap can't fuse (span-bounded) while genuine column breaks OUTSIDE the phrase are preserved (a
    # caption row 'CREDIT NOTE NO ...    CREDIT DATE ...' still splits). Byte-identical OFF, and ON it
    # only changes a line where a name/alias phrase carries a >=2-space internal gap.
    _gap_collapse = os.environ.get("HEADING_TITLE_GAP_COLLAPSE", "0") != "0"

    type_keywords = {k: list(v) for k, v in patterns.get("document_type_keywords", {}).items()}
    aliases_by_name = type_aliases or {}
    # Part B: phrases that are a type NAME or a title ALIAS (lowercased). ONLY these get the
    # column-aware heading SCORING below; the built-in document_type_keywords phrases keep the
    # strict whole-line test (byte-identical). Mirrors the design's eligible = name ∪ aliases.
    name_alias_lc: set[str] = set()
    for name in (known_types or []):
        name = (name or "").strip()
        if not name:
            continue
        bucket = type_keywords.setdefault(name, [])
        # NAME fold — kept EXACTLY as before (case-sensitive membership) so the no-alias path
        # is byte-identical to the pre-feature engine (the harness 0-delta gate).
        if name not in bucket:
            bucket.append(name)
        name_alias_lc.add(name.lower())
        # ALIASES — fold each of this type's title aliases into the SAME bucket (keyed by the
        # NAME, so result["type"] / detected_slug / heading-trust are unchanged; only more
        # phrases are searched). De-duped case-insensitively against the bucket. This branch is
        # only entered when aliases exist, so it can never alter the no-alias run.
        if aliases_by_name:
            have = {str(p).strip().lower() for p in bucket}
            for alias in (aliases_by_name.get(name) or []):
                a = str(alias or "").strip()
                if a and a.lower() not in have:
                    bucket.append(a)
                    have.add(a.lower())
                if a:
                    name_alias_lc.add(a.lower())

    if not type_keywords:
        return None

    scores: dict[str, float] = {}
    headings: dict[str, bool] = {}
    for doc_type, keywords in type_keywords.items():
        score = 0.0
        head  = False
        for kw in keywords:
            kw = kw.strip()
            if not kw:
                continue
            pattern = _type_keyword_pattern(kw)
            if pattern is None:
                continue
            for i, line in enumerate(lines):
                m = pattern.search(line.lower())
                _despaced = False
                if not m:
                    # SLICE 1 — LETTER-SPACING recovery (HEADING_LETTER_SPACING). Only where the regex
                    # matched NOTHING, only for a name/alias TITLE phrase, only on a TOP-BAND line, and
                    # only on the leftmost column segment with all spacing collapsed to EXACT equality
                    # (see _despaced_heading). ADDITIVE — a normal regex match never reaches here, so
                    # the no-fire path is byte-identical.
                    if ((_letter_spacing or _fuzzy) and _col_aware and kw.lower() in name_alias_lc
                            and (i <= _HEADING_TOP_BAND_LINES or i / total <= _HEADING_TOP_BAND_FRAC)):
                        _seg0 = _COL_BREAK_RE.split(line.strip().lower())[0].strip()
                        if _letter_spacing and _despaced_heading(_seg0, kw.lower()):
                            _despaced = True                # exact letter-spacing recovery (verbatim)
                        elif _fuzzy and _fuzzy_heading(_seg0, kw.lower(), name_alias_lc):
                            _despaced = True                # Lever 1 — fuzzy-to-vocabulary garble recovery
                    if not _despaced:
                        continue
                # Headings near the top carry by far the strongest signal;
                # weight decays smoothly with depth but never drops below 1 —
                # nothing found later in the document is structurally ignored.
                position_weight = max(1.0, 3.0 - 4.0 * (i / total))
                # A line that essentially IS the matched phrase (a standalone
                # heading like "PURCHASE ORDER") is a far stronger signal than
                # an incidental mention inside a longer line. Unlike the old
                # `f" {kw} " in f" {top} "` check — which only recognised
                # phrases padded by literal spaces and so never matched
                # OCR'd standalone headings (newline-delimited, not
                # space-delimited) — comparing against the regex match span
                # works for any current or future label shape.
                # Part B — COLUMN-AWARE heading SCORING for a type-NAME/alias banner: a real
                # banner ("WORKSHEET", "PURCHASE ORDER") that shares one OCR reading line with a
                # far-right ref/date COLUMN ("WORKSHEET    Reference No. WS-65750") is still the
                # leftmost-column heading and must earn the strong 2.0 weight — the strict whole-
                # line test scored it 1.0 and let a body-mentioned type steal best_type (the
                # worksheet-stuck-as-delivery-note class). ONLY name/alias phrases get this;
                # built-in document_type_keywords phrases keep the strict, byte-identical test.
                # SCORING uses the tighter caption_ok=False. Monotone: a line the strict test
                # counted (line==phrase) still scores 2.0 (seg0==phrase); a mid-body table column
                # relies on the low positional weight + the C1 refuse review-hold to stay safe.
                # Kill switch HEADING_SCORE_COLUMN_AWARE.
                # Exposed-signal inputs (the :826 _line_is_heading_like call); overridden ONLY by the
                # gap-collapse branch so the other paths + OFF stay byte-identical.
                _hl_line, _hl_phrase = line, (m.group(0) if m is not None else "")
                if _despaced:
                    is_heading = True                       # Seam B (Oracle): a letter-spacing
                    # recovery MUST force BOTH the strong 2.0 SCORE and the exposed head signal below;
                    # the :483/:496 recompute uses m.group(0)=collapsed vs the spaced seg -> False,
                    # which would silently leave title_trusted off and NOT fix the cascade.
                elif _col_aware and kw.lower() in name_alias_lc:
                    _lo = line.strip().lower()
                    _phrase = m.group(0).strip()
                    _work = _lo
                    if _gap_collapse:
                        # Collapse whitespace ONLY inside the matched type-phrase span (re-match on the
                        # STRIPPED line — m at :768 matched the UNSTRIPPED line, so its offsets are off
                        # by the leading whitespace). Column breaks outside the span are preserved.
                        _mm = pattern.search(_lo)
                        if _mm is not None:
                            _phrase = re.sub(r'\s+', ' ', _mm.group(0)).strip()
                            _work = _lo[:_mm.start()] + _phrase + _lo[_mm.end():]
                        _hl_line, _hl_phrase = _work, _phrase
                    seg0 = _COL_BREAK_RE.split(_work)[0].strip()
                    is_heading = _segment_is_heading(seg0, _phrase, caption_ok=False)
                else:
                    is_heading = line.strip().lower() == m.group(0).strip()
                score += position_weight * (2.0 if is_heading else 1.0)
                # EXPOSED heading signal (`heading` in the result) — consumed ONLY by the
                # template doc-type-precedence gate (a matched template must not override a
                # doc whose own TITLE confidently declares a different type). It does NOT
                # affect `score`/`confidence` (byte-identical scoring preserved). Relaxed
                # vs the strict scoring `is_heading` so a real title carrying a number or
                # punctuation ("WORKSHEET 38", "Purchase Order:", "Invoice No. 10023")
                # still counts as a heading, while an in-prose mention does not.
                if is_heading or (m is not None and _line_is_heading_like(_hl_line, _hl_phrase)):
                    head = True                             # _despaced -> is_heading True -> head True (Seam B)
                break  # first occurrence of this phrase is enough
        if score > 0:
            scores[doc_type] = round(score, 1)
            headings[doc_type] = head

    if not scores:
        return None

    best_type  = max(scores, key=scores.get)
    best_score = scores[best_type]

    # Convert score to confidence (a clear top-of-page heading alone scores
    # 6.0 → 90%; several corroborating mentions push toward the 95% cap).
    confidence = min(95, 60 + int(best_score * 5))

    return {
        "type":       best_type,
        "confidence": confidence,
        "all_scores": scores,
        # True when the WINNING type appeared as a standalone heading (not just a body
        # mention) — the structural signal the template-precedence gate trusts. A bare
        # confidence number can't separate a low-sitting heading from a top-of-page
        # mention (both land ~70-75); the heading structure can.
        "heading":    headings.get(best_type, False),
    }


# Role → key-aliases. A doc type may key its money fields with any of these variants; both
# keyword extraction (below) AND the total-reconciliation guardrail (validator.py) resolve
# them to the canonical shipped field so a labelled read is always attempted and the maths
# can reconcile whatever the field was named. SINGLE SOURCE — imported by validator. Only
# ADDS coverage for the aliases; canonical keys (total_amount/subtotal/vat_tax/shipping/
# discount) are matched directly first, so shipped presets/harness are unaffected. Curated
# precision-first — bare ambiguous keys ('delivery', 'transport', 'post') are excluded in
# favour of specific ones ('delivery_charge', 'transport_cost').
ROLE_KEY_ALIASES = {
    'total_amount': {'total', 'grand_total', 'invoice_total', 'total_due', 'amount_due',
                     'balance_due', 'total_payable', 'amount_payable', 'total_inc_vat'},
    'subtotal':     {'sub_total', 'net_total', 'net_amount', 'goods_total'},
    'vat_tax':      {'tax', 'vat', 'sales_tax', 'gst', 'hst', 'pst', 'qst',
                     'output_tax', 'value_added_tax'},
    'shipping':     {'postage', 'carriage', 'delivery_charge', 'delivery_cost', 'delivery_fee',
                     'freight', 'freightage', 'handling', 'shipping_handling', 'dispatch',
                     'despatch', 'forwarding', 'consignment', 'mailing', 'franking', 'courier',
                     'transport_cost', 'pp'},
    'discount':     {'less_discount', 'total_discount', 'reduction', 'deduction', 'rebate',
                     'markdown', 'concession', 'allowance', 'promo', 'promotion', 'voucher',
                     'credit', 'savings'},
}


# ── Field extraction ──────────────────────────────────────────────────────────

def extract_fields(ocr_text: str, field_keys: list[str],
                   patterns: dict, caption_vocab: dict | None = None,
                   caption_guard_keys: "set | None" = None) -> dict:
    """
    Extract field values using keyword patterns.
    Returns dict of {field_key: {"value": str, "confidence": int, "method": "keyword"}}
    Only includes fields that were found.

    caption_vocab / caption_guard_keys (G3b KNOWN-CAPTION VALUE GUARD, 2026-07-11): the run's
    caption vocabulary (build_caption_vocab) + the set of field keys ARMED for it (name-like/party,
    supplier_name EXCLUDED — the engine computes it). For an armed field, a candidate VALUE that IS
    a known caption dies at generation (right/below fall-through), so a printed caption can never
    fill a name field. Absent / kill switch off -> byte-identical.
    """
    field_patterns = patterns.get("field_patterns", {})
    validation     = patterns.get("validation_patterns", {})
    results        = {}
    lines          = ocr_text.split("\n")

    # Role aliases: a doc type may key its money fields "total"/"subtotal" while the shipped
    # config lives under "total_amount"/"subtotal". Without this a "total"-keyed field gets NO
    # labels and is skipped by keyword extraction entirely — so on an UNSEEN layout (no learned
    # anchor) it's left to whatever stray anchor happens to fire, which reads a table cell
    # ("0 0.01") instead of the labelled "Invoice Total 118.83". Map role-equivalent keys to the
    # shipped pattern so a labelled total/subtotal read is always attempted. The harness + the
    # shipped presets use "total_amount"/"subtotal" directly (this only ADDS coverage for the
    # aliases), so it can't regress them.
    def _pattern_key(k):
        if k in field_patterns:
            return k
        # Map a role-equivalent key (e.g. "postage"/"vat"/"amount_due") to its shipped pattern.
        for canon, aliases in ROLE_KEY_ALIASES.items():
            if k in aliases and canon in field_patterns:
                return canon
        return None

    for field_key in field_keys:
        pk = _pattern_key(field_key)
        if pk is None:
            continue

        fp      = field_patterns[pk]
        labels  = fp.get("labels", [])
        # PO_ORDER_NO_LABELS (reggie/Oracle 2026-07-27, default on): give po_number the bare
        # "Order No."/"Order Number" reader it lacks — measured, without it po_number has NO Stage-1
        # reader and depends solely on the skew-fragile anchor (007's 669 misread). Appended AFTER the
        # shipped labels so the explicit "Purchase Order No" is tried first; the _qualified_order_caption
        # guard in _search_for_label keeps a "Sales/Delivery/… Order No" from landing here. Injected in
        # code (config unchanged) so OFF ⇒ byte-identical.
        if pk == 'po_number' and os.environ.get('PO_ORDER_NO_LABELS', '1') != '0':
            labels = labels + ["Order No.", "Order Number", "Order No"]
        # CUSTOMER_PO_LABELS (reggie 2026-08-09, DEFAULT OFF → byte-identical): a seller's invoice /
        # delivery note cross-references the BUYER's purchase order under captions the shipped list
        # misses ("Your PO", "Customer PO", "Cust PO"), so out of the box po_number never reads it
        # (systemic recall gap, same shape as TOTAL_GROSS_LABELS). Appended AFTER the shipped + bare
        # labels so the doc's OWN explicit PO caption wins first; the …No/…Number form precedes the
        # bare form (Larkspur ". DN-98447" rule — the caption's No/./: is consumed by the match, not
        # ridden into the value). The value side is unchanged: PO_REF_DIGIT_GATE (needs \d\S*\d) +
        # alphanumeric _validate still gate it, so a "your portal 24/7" / "your postcode BT1 1HE"
        # prefix match is rejected (no 2-digit run). The "Your Order" family is DELIBERATELY EXCLUDED
        # — it activates a pre-existing sales_order_number double-fill ("our" ⊂ "your", and
        # "Our Order No" has no leading word-boundary); ship it only alongside that boundary fix.
        # "Your Ref" excluded (too generic; _REF_PARTY_STOP already treats "your" as a foreign-party
        # ref qualifier). Config unchanged so OFF ⇒ byte-identical (mirrors PO_ORDER_NO_LABELS).
        if pk == 'po_number' and os.environ.get('CUSTOMER_PO_LABELS', '0') != '0':
            labels = labels + ["Customer PO No", "Customer PO Number", "Customer PO",
                               "Cust PO No", "Cust PO",
                               "Your PO No", "Your PO Number", "Your PO"]
        # TOTAL_GROSS_LABELS (reggie 2026-08-06, DEFAULT OFF → byte-identical): the shipped
        # total_amount list misses common grand-total captions, so on those layouts keyword reads NO
        # gross at all (measured: cold Customer-corpus total 40.6%→50.0%, M=0, scanned +16). This
        # starves both the total lane AND the net-misread FLAG (no gross candidate to corroborate).
        # Each addition is a payable/final caption reggie cleared of subtotal collision; the matcher
        # normalises case+spacing but NOT parens/periods, so paren/'incl' literals are separate.
        # Inserted BEFORE bare "Total" (specific-first); the "Charge(s)" residual (subtotal-section
        # collision risk) is LAST. Does NOT touch subtotal / _total_role_collision / the bare-"Total"
        # net-vs-gross guard. Config unchanged so OFF ⇒ byte-identical (mirrors PO_ORDER_NO_LABELS).
        if pk == 'total_amount' and os.environ.get('TOTAL_GROSS_LABELS', '0') != '0':
            _gross_extra = ["Total to Pay", "Net to Pay", "Balance to Pay", "Amount Now Due",
                            "Total Incl VAT", "Total Incl. VAT",
                            "Total (inc VAT)", "Total (incl VAT)", "Total (inc. VAT)",
                            "Total Charges", "Total Charge"]
            if "Total" in labels:
                _i = labels.index("Total")
                labels = labels[:_i] + _gross_extra + labels[_i:]
            else:
                labels = labels + _gross_extra
        dirs    = fp.get("directions", ["right"])
        base_conf = fp.get("base_confidence", 75)
        role_caption = fp.get("role_caption")   # 'ref' on a seeded custom-ref field (RC1/RC5)
        # G3b: arm the known-caption VALUE guard for this field (name-like/party, customer-side —
        # the engine already excluded supplier_name from caption_guard_keys). Pass the vocab so a
        # caption-valued candidate dies at generation; None (unarmed / kill switch off) = unchanged.
        _cap_guard = (caption_vocab if (KNOWN_CAPTION_GUARD_ENABLED and caption_vocab
                                        and field_key in (caption_guard_keys or ())) else None)

        for label in labels:
            # Support per-label direction override: {"text": "Bill From", "directions": ["below"]}
            # and the admin label-override flag ({"text": ..., "override": True}).
            is_override = False
            if isinstance(label, dict):
                label_text = label["text"]
                label_dirs = label.get("directions", dirs)
                is_override = bool(label.get("override"))
            else:
                label_text = label
                label_dirs = dirs
            found = _search_for_label(lines, label_text, label_dirs, role_caption=role_caption,
                                      caption_guard=_cap_guard)
            if not found:
                continue

            value, direction = found
            if role_caption == 'ref' and value:
                # A seeded ref caption "Reference No." / "Ref No" leaves the "No"/"Number" suffix
                # (and its trailing dot) glued to a right-read value ("No.  WS111238") — strip a
                # dangling ref-suffix token, then a stray leading dot the caption left behind. Only
                # seeded ref fields hit this (role_caption='ref'); shipped patterns are byte-identical.
                value = re.sub(r'^(?:(?:no|number|nº)\b\.?|#)\s*', '', value, flags=re.I)
                value = re.sub(r'^[.\s:|\-–]+', '', value).strip()
            elif value and fp.get("validation") in ('alphanumeric', 'reference_code', 'date'):
                # CAPTION-PUNCTUATION debris on ANY structured read (owner live report
                # 2026-08-05 — the Larkspur '. DN-98447' class): a label list carries both the
                # dotless and dotted caption forms ('Delivery Note No' before 'Delivery Note
                # No.'), the dotless form matches first against the printed 'Delivery Note No.
                # DN-98447', and the caption's own '. ' rides into the committed value — on
                # shipped, seeded AND override labels alike. No structured value can
                # legitimately BEGIN with caption punctuation (each validator requires an
                # alnum start), so strip the leading run. Deliberately NOT the seeded path's
                # 'No/Number' token strip — that would mangle a genuine 'NO-1234' code; the
                # punctuation-only strip cannot (it stops at the first alnum). Free-text and
                # currency reads are byte-identical.
                value = re.sub(r'^[.\s:|\-–]+', '', value).strip()
            if not value or len(value.strip()) < 1:
                continue

            # Region-normalise a currency amount to canonical 1234.56 (no-op for anglo) so a
            # Continental "1.234,56" / Swiss "1'234.56" passes the Anglo currency pattern below
            # and is stored canonically.
            if fp.get("validation") == "currency":
                value = number_format.canonical(value)
                # Rejoin an OCR-split thousands/decimal ("$15 707.84" → "$15,707.84") BEFORE
                # the contiguous currency pattern below truncates it to "$15". Shared with
                # anchor.py so the crop and keyword paths agree on OCR-split money.
                value = number_format.normalise_currency_spacing(value)

            # Validate value format if validator defined
            val_type = fp.get("validation")
            if val_type and val_type in validation:
                if not _validate(value, validation[val_type]):
                    continue  # doesn't match expected format — try next label

            # Clean up the value
            value = _clean_value(value, val_type, validation)

            # reggie 2026-07-29 (PO_REF_DIGIT_GATE): an order-family reference is a CODE — a spaceless
            # run bearing >=2 digits — never footer prose ("... on all correspondence and delivery
            # notes") that the loose 'alphanumeric' re.search would otherwise accept as a value.
            # Un-anchored + space-tolerant so a noisy real header (", p0-22954" / OCR-split "PO 22954")
            # still reads (contrast the anchored reference_code — the 2026-07-24 null regression). Fail
            # toward review: no code here -> try the next label, else the field stays empty for Review.
            if (os.environ.get('PO_REF_DIGIT_GATE', '1') != '0'
                    and field_key in ('po_number', 'sales_order_number')
                    and not re.search(r'\d\S*\d', value or '')):
                continue

            # Confidence boost for exact label match
            conf = base_conf
            if direction == "right":
                conf += 5  # inline values are more reliable

            results[field_key] = {
                "value":      value,
                "confidence": min(95, conf),
                # Admin label override (Settings → Advanced) gets distinct
                # provenance so it's visible in Review/Dev Inspector AND so
                # engine.extract can let it outrank a generic template value.
                "method":     "keyword_override" if is_override else "keyword",
                "label":      label_text,
            }
            break  # found for this field, move to next

    return results


# ── Helpers ───────────────────────────────────────────────────────────────────

def _label_pattern(label: str) -> "re.Pattern | None":
    """
    Build a regex that tolerates OCR merging or splitting the whitespace
    between a label's words. The same supplier's own forms commonly OCR
    inconsistently scan-to-scan — e.g. "Purchase Order No" comes back as
    "PURCHASE ORDERNO" on some pages and "PURCHASE ORDER NO" on others
    (kerning/font/scan-quality variance collapses or preserves the space).
    An exact-substring match silently misses the field on some scans of the
    very same document layout while matching on others — a generalisable
    label-matching gap, not a one-document quirk. Allowing zero-or-more
    whitespace between each word covers merges, splits and doubled spaces
    alike, for any current or future label.
    """
    words = label.lower().split()
    if not words:
        return None
    body = r'\s*'.join(re.escape(w) for w in words)
    # Single-word ALPHABETIC labels get a word-boundary guard so a short caption
    # can't anchor on a SUBSTRING of a longer word — "Total" inside "Subtotal"
    # (the silent subtotal-as-total bug), "Date" inside "Mandate", "From" inside
    # "Frome", "Account" inside "Accounts". Mirrors _type_keyword_pattern's guard;
    # multi-word labels are already specific enough to not need it. Net effect on
    # shipped labels is a fix (no behaviour change except removing wrong substring
    # hits); the only loss is a label glued straight onto its value with no
    # separator ("Date2026"), the same tradeoff _type_keyword_pattern accepts.
    if len(words) == 1 and words[0].isalpha():
        return re.compile(r'(?<![a-z0-9])' + body + r'(?![a-z0-9])')
    return re.compile(body)


def _type_keyword_pattern(label: str) -> "re.Pattern | None":
    """
    Whitespace-tolerant matcher for document-type keywords/names — same
    \\s*-joined approach as _label_pattern (handles "PURCHASE ORDER" vs
    "PURCHASEORDER" OCR variance), plus a word-boundary guard for short
    single-word alphabetic phrases.

    The guard matters specifically here because `known_types` folds in
    user-defined custom type *names* as keywords, and short generic names
    ("PO", "GRN", "Ref") are exactly the shape that collides as a substring
    inside unrelated words ("Polychemtex") — the same collision class fixed
    for anchor labels in anchor.py/template_matcher.py. Built-in keyword
    phrases are long enough that this never changes their matching.
    """
    words = label.lower().split()
    if not words:
        return None
    body = r'\s*'.join(re.escape(w) for w in words)
    if len(words) == 1 and words[0].isalpha():
        return re.compile(r'(?<![a-z0-9])' + body + r'(?![a-z0-9])')
    # MULTI-WORD phrases historically compiled UNBOUNDED, so a phrase whose last token is a prefix
    # of a longer word bleeds into it — the live bug: the PO keyword "order to" -> `order\s*to`
    # prefix-matched "order to(tal)" in a totals line and typed worksheets as Purchase Order. With
    # TYPE_KEYWORD_BOUND on, apply the SAME alnum boundary guard as single-word phrases so the phrase
    # must sit on its own word edges. Kill switch DEFAULT ON (flipped 2026-07-30, corpus-gated: realdoc
    # byte-identical + the 20 Ridgeway worksheets untyped); =0 restores the historical unbounded compile.
    if os.environ.get("TYPE_KEYWORD_BOUND", "1") != "0":
        return re.compile(r'(?<![a-z0-9])' + body + r'(?![a-z0-9])')
    return re.compile(body)


# A bare "Total" label sits INSIDE longer totals-block phrases that belong to a DIFFERENT money
# role. The keyword word-boundary guard only stops the single-WORD substring ("Total"⊂"Subtotal");
# these are multi-WORD phrases where "Total" is a standalone word, so they slip through and — being
# ABOVE the real grand-total line — win first-match:
#   PRECEDE: "Sub Total" / "Net Total" / "Goods Total"  → a SUBTOTAL, not the grand total.
#   FOLLOW:  "Total VAT" / "Total Tax" / "Total Discount"→ a tax/adjustment line, not the grand total.
# The grand-total senses "Total Amount / Due / Payable / Inc VAT" are NOT in the follow set (and have
# their own specific labels), so they still match. Reusable across every supplier/layout.
_TOTAL_ROLE_PRECEDE_STOP = frozenset({"sub", "net", "goods", "gross"})
_TOTAL_ROLE_FOLLOW_STOP  = frozenset({"vat", "tax", "gst", "discount", "shipping",
                                      "freight", "carriage", "surcharge", "handling"})


def _total_role_collision(line: str, start: int, end: int) -> bool:
    """True when a bare "Total" match at [start,end) is actually part of a different-role totals-block
    phrase (a subtotal or a tax/adjustment line), detected by the immediately adjacent WORD. Pure/
    unit-tested. Only the generic "Total" label consults it; specific labels are unambiguous."""
    prec = re.search(r'([a-z]+)\W*$', line[:start].lower())
    if prec and prec.group(1) in _TOTAL_ROLE_PRECEDE_STOP:
        return True
    foll = re.match(r'\W*([a-z]+)', line[end:].lower())
    if foll and foll.group(1) in _TOTAL_ROLE_FOLLOW_STOP:
        return True
    return False


# A bare identity caption ("Supplier"/"Vendor"/"Seller") collides with a BUYER-side REFERENCE
# caption of the same head word — "Supplier Ref", "Vendor No", "Supplier Account", "Supplier #".
# The word-boundary guard treats the following SPACE as a valid boundary, so "Supplier" matches
# inside "Supplier Ref 4118" and the right-read grabs "Ref" — a reference fragment stamped onto
# the Document Issuer. "text"-validated identity has NO value format gate, so nothing rejects it,
# and because "Ref" reads as a PLAUSIBLE name it even suppresses the confirmed-hint recovery
# downstream. Same shape as _total_role_collision; only the bare identity labels consult it, so a
# real "Supplier: Acme Ltd" (follow word not a ref term) still matches. Reusable across every
# supplier/layout — buyer-side "Supplier Ref/No/Account/Code/ID/VAT/#" blocks are very common.
_IDENTITY_CAPTION_LABELS  = frozenset({"supplier", "vendor", "seller"})
_IDENTITY_REF_FOLLOW_STOP = frozenset({"ref", "reference", "no", "number",
                                       "code", "id", "vat", "account", "acct"})


def _identity_ref_caption(line: str, end: int) -> bool:
    """True when a bare identity caption at [.,end) is really a reference caption ('Supplier Ref',
    'Vendor No', 'Supplier #'), detected by the immediately following word / '#'. Pure/unit-tested."""
    tail = re.sub(r'^[\s:.\-–]+', '', line[end:].lower())
    if tail.startswith('#'):
        return True
    m = re.match(r'([a-z]+)', tail)
    return bool(m and m.group(1) in _IDENTITY_REF_FOLLOW_STOP)


# A SEEDED custom ref field (RC1) searches generic ref captions ("Reference"/"Ref"/"No"). A bare
# such caption preceded by a PARTY qualifier is that party's reference ("Customer Reference",
# "Your Ref", "Supplier No", "Account No"), NOT the document's own reference — skip it so a seeded
# custom-ref label can't cross-fill a buyer/seller/account reference. Mirrors _identity_ref_caption
# (which guards the issuer side); this guards the reference side. Only seeded ref fields consult it
# (role_caption='ref'), so shipped patterns are unaffected. (RC5, 2026-07-10)
_REF_PARTY_STOP = frozenset({"customer", "client", "buyer", "your", "sales",
                             "supplier", "vendor", "seller", "our", "account", "acct"})


def _ref_caption_party_conflict(line: str, start: int) -> bool:
    """True when a seeded bare REF caption at [start,.) is a DIFFERENT party's reference, detected by
    the immediately PRECEDING word ('Customer Reference', 'Your Ref', 'Supplier No'). Pure."""
    prec = re.search(r'([a-z]+)\W*$', line[:start].lower())
    return bool(prec and prec.group(1) in _REF_PARTY_STOP)


# RC1 SLICE 2 guards (2026-07-10) — a SEEDED custom FREE-TEXT field (role_caption='party')
# hunts its own DB label ("Customer", "Site Contact"). All three guards are party-gated, so
# shipped patterns stay byte-identical. reggie-designed; guarded by test_keyword_label_guard.py.
#   G1 _party_caption_conflict — the label immediately FOLLOWED by a reference/document word is a
#      DIFFERENT caption ("Customer Reference No. WS12345", "Customer Order No", "CUSTOMER COPY",
#      "Customer Signature", "Customer Services: 0800…"): skip the occurrence (the field stays
#      empty → review as missing) rather than swallow a code or an artifact word. "Name" and
#      "Details" are deliberately NOT stopped — "Customer Name: Acme" keeps reading.
#   G3 _is_caption_fragment — a candidate VALUE that is itself a short ref/date CAPTION FRAGMENT
#      ("Reference No.", "Work Date") is a COLUMN-INTERLEAVE artifact: the reconstructed reading
#      order can put a right-column row between a left-column caption and its value
#      ('Site / Customer' ↵ 'Reference No.  WS408618' ↵ 'Formby & Sons' — the MP_wor_48 class).
#      Keyed on the LAST word (a name like "ID Solutions Ltd" ends 'ltd' → passes); the ≤3-word
#      bound protects longer names that happen to end in a ref-noun.
_PARTY_FOLLOW_STOP = frozenset({
    "ref", "reference", "no", "number", "num", "code", "id", "vat", "account", "acct",
    "order", "po", "invoice", "job", "booking", "quote", "quotation",
    "copy", "copies", "signature", "signatures", "initials", "declaration",
    "service", "services",
    # address/contact caption family (Oracle C3, 2026-07-10): "Customer Site Address",
    # "Customer Tel", "Customer Email" are captions for OTHER data — without these stops the
    # right/below read fills the party field with an address line or phone number at 75,
    # and two clean words pass the wordness net. Fail-empty = the pre-slice-2 behaviour.
    "site", "address", "tel", "telephone", "phone", "fax", "email", "mobile",
    "web", "website"})

#      "name"/"details" live HERE (a bare "Name" right-of-caption is the caption's own
#      continuation word, not a value) and deliberately NOT in _PARTY_FOLLOW_STOP — so
#      "Customer Name" still matches as a caption and its below-value reads.
_CAPTION_NOUN_TAIL = frozenset({"ref", "reference", "no", "number", "num",
                                "code", "id", "vat", "account", "acct", "date",
                                "name", "details"})


def _party_caption_conflict(line: str, end: int) -> bool:
    """True when a seeded PARTY caption at [.,end) is really a reference/document caption
    ('Customer Ref', 'Customer Order No', 'CUSTOMER COPY', 'Customer #55'), detected by the
    immediately following word / '#'. A 4+-space COLUMN BREAK right after the caption means
    the next word is ANOTHER column's caption ('Customer    Reference No.' on an interleaved
    header row), not this caption's continuation — no conflict; the G3 fragment guard owns
    that case. Mirrors _identity_ref_caption. Pure."""
    raw = line[end:]
    if re.match(r'\s{4,}', raw):
        return False
    tail = re.sub(r'^[\s:.\-–]+', '', raw.lower())
    if tail.startswith('#'):
        return True
    m = re.match(r'([a-z]+)', tail)
    return bool(m and m.group(1) in _PARTY_FOLLOW_STOP)


def _is_caption_fragment(text: str) -> bool:
    """True when a candidate VALUE is itself a short caption fragment ending in a ref/date noun
    ("Reference No.", "Work Date") — an interleaved column row, never a party value. Pure."""
    t = re.sub(r'[\s.:#|\-–]+$', '', (text or '').strip())
    ws = t.lower().split()
    return bool(ws) and len(ws) <= 3 and ws[-1] in _CAPTION_NOUN_TAIL


# reggie/Oracle 2026-07-27 (PO_ORDER_NO_LABELS): a bare "Order …" caption ("Order No.") is stolen by a
# QUALIFIED one ("Sales Order No. SO-…", "Delivery Order No", "Your Order No") — so a bare-"order" label
# is rejected when the word immediately BEFORE it names a different KIND/PARTY of order. Mirrors
# _ref_caption_party_conflict / _total_role_collision. "our" is deliberately EXCLUDED (Oracle) — "Our
# Order No." is a legitimate own-ref. Bidirectional: also stops sales_order_number's pre-existing bare
# "Order No" from grabbing a "Purchase Order No. PO-…" (a latent cross-grab).
_ORDER_QUALIFIER_STOP = frozenset({
    "sales", "purchase", "customer", "your", "client", "delivery",
    "works", "work", "back", "change", "standing",
})


def _qualified_order_caption(line: str, start: int) -> bool:
    """True when a bare 'Order …' caption starting at `start` is a QUALIFIED order caption — the word
    immediately BEFORE it names a different KIND/PARTY of order. Pure; mirrors _ref_caption_party_conflict."""
    prec = re.search(r'([a-z]+)\W*$', line[:start].lower())
    return bool(prec and prec.group(1) in _ORDER_QUALIFIER_STOP)


# reggie 2026-07-29 (PO_ORDER_INSTRUCTION_SKIP): a bare "Order No/Number" caption is also stolen by a
# footer INSTRUCTION — "please quote our order number on all correspondence and delivery notes" — where
# "order number" is prose, not a field caption. The discriminator is the token AFTER the caption: a real
# caption is followed by a CODE ("Order No. PO-123"); the instruction by a prose lead-word ("... order
# number ON all ..."). Cue 2 (the tail) is load-bearing; cue 1 (an instruction verb earlier on the line)
# is a secondary catch. Complements _qualified_order_caption (which reads the word BEFORE) — "our"/"your"
# stay legit own-refs there, so the tail is what separates the footer prose from a genuine own-ref.
_ORDER_INSTRUCTION_VERB = frozenset({
    "quote", "quoting", "cite", "citing", "state", "stating", "mention", "mentioning",
})
_ORDER_INSTRUCTION_TAIL = re.compile(r'^(?:on|in|with|when|upon|for|to|must|should|shall)\b', re.I)


def _order_caption_is_instruction(line: str, start: int, end: int) -> bool:
    """True when a bare 'order no/number' at [start,end) is a boilerplate INSTRUCTION
    ('quote our order number on all correspondence and delivery notes'), not a real caption. Pure."""
    # Cue 2 (LOAD-BEARING): the token right after the caption is a prose lead-word, never a code.
    if _ORDER_INSTRUCTION_TAIL.match(re.sub(r'^[\s:.,\-–]+', '', line[end:].lower())):
        return True
    # Cue 1: an instruction verb earlier on the line ("please quote our order number …").
    return any(w in _ORDER_INSTRUCTION_VERB for w in re.findall(r'[a-z]+', line[:start].lower()))


def _search_for_label(lines: list[str], label: str,
                      directions: list[str],
                      role_caption: str | None = None,
                      caption_guard: dict | None = None) -> tuple[str, str] | None:
    """
    Search lines for a label and return (value, direction) or None.

    role_caption (RC1/RC5): 'ref' for a SEEDED custom-ref field, so a buyer/seller party caption
    ("Customer Reference") can't cross-fill it. None for shipped patterns → behaviour unchanged.

    caption_guard (G3b, 2026-07-11): when set (an armed name-like/party field's caption vocab), a
    candidate VALUE that IS a known caption dies at generation — blanked at 'right' so it falls
    through to 'below', skipped at 'below' — so a printed caption ("SO #") never fills a name field.
    None = unchanged. Broader than the role_caption='party' _is_caption_fragment guard (whole run
    vocab, not just short ref/date fragments) and works even when role_caption is None (the shipped
    customer_name pattern carries none — the incident).
    """
    pattern = _label_pattern(label)
    if pattern is None:
        return None

    _is_bare_total = label.strip().lower() == 'total'
    _is_bare_order = (os.environ.get('PO_ORDER_NO_LABELS', '1') != '0'
                      and label.strip().lower().split()[:1] == ['order'])
    _instr_skip = os.environ.get('PO_ORDER_INSTRUCTION_SKIP', '1') != '0'
    _is_identity_caption = label.strip().lower() in _IDENTITY_CAPTION_LABELS
    for i, line in enumerate(lines):
        line_lower = line.lower()
        m = pattern.search(line_lower)
        if not m:
            continue
        # The generic "Total" must not poach a "Sub Total" (subtotal) or "Total VAT" (tax) line —
        # skip to the real grand-total line below. See _total_role_collision.
        if _is_bare_total and _total_role_collision(line, m.start(), m.end()):
            continue
        # A bare "Order No"/"Order Number" (PO_ORDER_NO_LABELS) must not poach a QUALIFIED order caption
        # ("Sales/Delivery/Purchase/Your Order No") — skip so the qualified caption's own field reads it.
        if _is_bare_order and (_qualified_order_caption(line, m.start())
                               or (_instr_skip and _order_caption_is_instruction(line, m.start(), m.end()))):
            continue
        # A bare "Supplier"/"Vendor"/"Seller" must not read a "Supplier Ref/No/Account" reference
        # caption as the issuer name — skip; a real "Supplier: Acme" still matches. See above.
        if _is_identity_caption and _identity_ref_caption(line, m.end()):
            continue
        # A SEEDED custom REF caption ("Reference"/"Ref"/"No") must not read a DIFFERENT party's
        # reference ("Customer Reference", "Your Ref", "Supplier No") — skip; the doc's own bare
        # "Reference" still matches. Only seeded ref fields pass role_caption='ref', so shipped
        # patterns are byte-identical. See _ref_caption_party_conflict (RC5, 2026-07-10).
        if role_caption == 'ref' and _ref_caption_party_conflict(line, m.start()):
            continue
        # G1: a SEEDED custom FREE-TEXT caption ("Customer") must not read a reference/document
        # caption of the same head word ("Customer Reference No. WS12345", "CUSTOMER COPY") —
        # skip the occurrence; a real "Customer: Acme" still matches. Only seeded free-text
        # fields pass role_caption='party', so shipped patterns are byte-identical. (RC1 slice 2)
        if role_caption == 'party' and _party_caption_conflict(line, m.end()):
            continue

        # Try RIGHT direction — value is on the same line after the label
        if "right" in directions or "inline" in directions:
            after = line[m.end():].strip()
            # G2 (party): the label matched as the FIRST word of a COMPOUND caption
            # ("Customer / Site") — the remainder is the caption's own tail, never a value;
            # blank it so the read falls through to 'below'. '/' and '&' join caption
            # synonyms; ':' and '-' stay value separators (unchanged). (RC1 slice 2)
            if role_caption == 'party' and re.match(r'^[/&]', after):
                after = ''
            # Strip common separators
            after = re.sub(r'^[\s:|\-–]+', '', after).strip()
            # Split on column gaps (4+ spaces) — same as 'below' direction.
            # Multi-column OCR often interleaves adjacent columns on the same line;
            # take only the first column segment to avoid grabbing unrelated text.
            _segs = [s.strip() for s in re.split(r' {4,}', after) if s.strip()]
            # Drop a leading PURE-punctuation residue column: a label caption that ends in
            # "." ("Invoice No.") isn't consumed by the label pattern, so the "." lands as
            # its own column AHEAD of the value ("Invoice No. |  . |  152574") and the old
            # code took "." — then the same-row read failed and the "below" fallback grabbed
            # the wrong column (the "G2 Environmental" cell under "Invoice To"). Take the
            # first column carrying real content instead. Precision-preserving: only skips
            # while a following column exists, and NEVER skips a segment with any letter or
            # digit. Generalises to every "…No." ref label (Invoice/PO/SO) in a wide-gap band.
            # Also drop a leading PARENTHETICAL PERCENTAGE annotation column: a money line reads
            # "Discount (10%): | $231.81" or "VAT (20%): | £64.56" — the "(10%):" isn't the value
            # (the AMOUNT is), so a discount/tax read grabbed it, failed currency validation, and
            # left reconciliation blind ("total < subtotal, no discount to explain it" false flag).
            # Tolerates wrapping parens and a trailing ":"/"." ("(10%):", "10%", "8.5 %").
            _si = 0
            while _si + 1 < len(_segs) and (
                    re.fullmatch(r'[.\-–:#|)*]+', _segs[_si])
                    or re.fullmatch(r'\(?\s*\d+(?:\.\d+)?\s*%\s*\)?\s*[:.]?', _segs[_si])):
                _si += 1
            after = _segs[_si] if _segs else ''
            # A totals row often reads "Invoice Total | GBP | 118.83" — the column right after
            # the label is a bare currency CODE/symbol (no digits). Skip it to the AMOUNT column
            # so the value is the number, not "GBP". Reusable for any LABEL CODE AMOUNT layout;
            # only fires when the first segment is EXACTLY a currency code/symbol AND a later
            # column carries digits (else it's left untouched).
            if (after and not re.search(r'\d', after)
                    and re.fullmatch(r'[£$€¥]|GBP|USD|EUR|JPY|CAD|AUD|CHF|CNY|INR', after, re.I)):
                for _s in _segs[1:]:
                    if re.search(r'\d', _s):
                        after = _s
                        break
            # G3 (party): a right-side candidate that is ITSELF a ref/date caption fragment
            # ("Reference No." on an interleaved 'Customer    Reference No.' line) is the
            # neighbouring column's caption, not the value — blank it so the read falls
            # through to 'below'. (RC1 slice 2)
            if role_caption == 'party' and _is_caption_fragment(after):
                after = ''
            # G3b: a right-side candidate that IS a known caption ("SO #", "Customer") is the
            # neighbour column's label, never a value — blank it so the read falls through to
            # 'below'. Whole-run vocab; armed for name-like/party fields (customer-side).
            if caption_guard and after and value_is_caption(after, caption_guard):
                after = ''
            # Reject if the extracted text itself looks like another label, or contains
            # an embedded label:value pair (e.g. "Ship Mode: Second Class", "Date: Sep 07")
            # which means we grabbed neighbouring column content, not the actual value.
            if (after and len(after) >= 1
                    and not after.endswith(':')
                    and not _is_label_line(after)
                    and not re.search(r'[A-Za-z]{2,}\s*:', after)):
                return after, "right"

        # Try BELOW direction — value is on the next non-empty line
        if "below" in directions:
            for j in range(i + 1, min(i + 4, len(lines))):
                candidate = lines[j].strip()
                if not candidate:
                    continue
                # Take only the first column segment (split on 4+ spaces)
                candidate = re.split(r' {4,}', candidate)[0].strip()
                # G3 (party): skip an interleaved right-column CAPTION row sitting between
                # the caption and its value in the reconstructed reading order
                # ('Site / Customer' ↵ 'Reference No.  WS408618' ↵ 'Formby & Sons' —
                # the MP_wor_48 class); the window walks on to the real value. (RC1 slice 2)
                if role_caption == 'party' and _is_caption_fragment(candidate):
                    continue
                # G3b: a 'below' candidate that IS a known caption is a stray caption row in the
                # reading order, not the value — walk on to the real value. (customer-side armed)
                if caption_guard and value_is_caption(candidate, caption_guard):
                    continue
                if (candidate
                        and not _is_label_line(candidate)
                        and not re.search(r'[A-Za-z]{2,}\s*:', candidate)):
                    return candidate, "below"

        # Try ABOVE direction
        if "above" in directions:
            for j in range(i - 1, max(i - 4, -1), -1):
                candidate = lines[j].strip()
                if candidate and not _is_label_line(candidate):
                    return candidate, "above"

    return None


def _is_label_line(text: str) -> bool:
    """Heuristic: is this line a label rather than a value?"""
    t = text.strip().rstrip(":")
    if len(t) < 3:
        return True
    if text.strip().endswith(":"):
        return True
    # Single all-caps word (e.g. "INVOICE", "DATE") is a heading/label.
    # Multi-word all-caps (e.g. "ANDY YOTOV", "ACME LIMITED") is a name — not a label.
    # Digits are the deciding signal against a false positive here: genuine
    # label/heading words are linguistic ("INVOICE", "PURCHASE ORDER", "TOTAL
    # DUE") and essentially never contain digits, whereas reference/code
    # values that follow a letter-prefix convention ("INV-2024-0456",
    # "NC-58213", "PO-77410" — one of the most common real-world numbering
    # styles) are exactly the kind of all-caps, no-space, short string this
    # check would otherwise misclassify as a label and reject as a candidate
    # value — silently breaking extraction for every document from any
    # supplier using that convention.
    if t.isupper() and " " not in t and len(t) < 30 and not any(c.isdigit() for c in t):
        return True
    return False


# Document-chrome / TITLE words a large page heading garbles into. A closed,
# generic, supplier-agnostic set (never a company name) — used ONLY to demote a
# short OCR fragment of a title (the "INVOICE"→"INi"/"INGE" class) out of the
# supplier field. Mirror of _DOC_CHROME_WORDS in database/modules/learning.js.
_DOC_CHROME_WORDS = frozenset({
    "invoice", "statement", "purchase", "order", "sales", "delivery", "docket",
    "note", "receipt", "credit", "debit", "quote", "quotation", "remittance",
    "worksheet", "bill", "advice", "proforma", "estimate", "ticket", "memo",
    "packing", "slip",
})


def _bounded_levenshtein(a: str, b: str) -> int:
    """Levenshtein edit distance (tiny strings only — supplier fragments ≤5 chars)."""
    m, n = len(a), len(b)
    d = list(range(n + 1))
    for i in range(1, m + 1):
        prev, d[0] = d[0], i
        for j in range(1, n + 1):
            tmp = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (0 if a[i - 1] == b[j - 1] else 1))
            prev = tmp
    return d[n]


def _is_doc_chrome_fragment(core: str) -> bool:
    """True → `core` (an alnum-lowercased token) is a SHORT OCR near-form of the
    PREFIX of a document-chrome/title word — the class a big page TITLE garbles
    into ("INVOICE"→"ini"/"inge"/"in", "STATEMENT"→"stat"). Bounded edit distance
    to each title word truncated to the candidate's length: ≤1 for ≤3 chars, ≤2
    for 4–5 chars. Only 2–5 char cores are judged — a real company name is longer,
    or does not near-match a title prefix, so 'Invoice Ninja'-style real names
    (longer / multi-word) never reach here."""
    if core in _DOC_CHROME_WORDS:        # a whole title word read as the supplier
        return True
    L = len(core)
    if L < 2 or L > 5:
        return False
    budget = 1 if L <= 3 else 2
    for w in _DOC_CHROME_WORDS:
        if len(w) >= L and _bounded_levenshtein(core, w[:L]) <= budget:
            return True
    return False


def _is_plausible_supplier_name_base(value: str | None) -> bool:
    """SHAPE-only plausibility — the base rules WITHOUT the document-chrome layer.

    Rejects a bare 2-3 char all-caps token ("IN"/"PO" from "INVOICE"/"PURCHASE"), a
    digit-dominant reference misread ("36552", "t 38/07"), and a mostly-gibberish
    MULTI-WORD read ("Fr eanehae Crane") — but NOT a chrome near-form. Used where a
    chrome-SHAPED but genuine short name ("Dell"→'deli', "Sage"→'sale', edit-1 from a
    title prefix) must NOT be demoted: notably the OVERRIDE arm of
    engine._supplier_identity_decision, where an implausible incumbent is REPLACEABLE
    regardless of confidence — the chrome demotion must never (on shape alone) license
    overwriting a real short-named incumbent with a plausible WRONG challenger (Oracle
    2026-07-14). Short all-caps brands ("IBM","DHL") are flagged not-uniquely-plausible
    here BY SHAPE; callers apply the "unless uniquely supported" rule."""
    if not value or not str(value).strip():
        return False
    t = str(value).strip().rstrip(":")
    if (len(t) <= 3 and t.isupper() and " " not in t
            and not any(c.isdigit() for c in t)):
        return False
    # Digit-dominant reference misread: 2+ digits AND <3 letters. Keeps letter-rich
    # names that merely contain digits ("3M", "G2 Environmental", "24/7 Services").
    n_alpha = sum(c.isalpha() for c in t)
    n_digit = sum(c.isdigit() for c in t)
    if n_alpha < 3 and n_digit >= 2:
        return False
    # Word-quality gate (MULTI-word only): a mostly-gibberish multi-token read is not a
    # supplier identity; single-token brands ("3M") are not judged here.
    if len(t.split()) >= 2:
        from extraction.value_quality import name_quality
        if name_quality(t) < 0.5:
            return False
    return True


def _is_plausible_supplier_name(value: str | None) -> bool:
    """SUPPLIER-identity plausibility = the shape BASE test PLUS a document-CHROME
    near-form reject (kill switch SUPPLIER_CHROME_FRAGMENT_GUARD, default on). A large
    document TITLE ("INVOICE"/"STATEMENT") OCR-garbles into a short token
    ("INi","INGE","IN \") that slips the all-caps guard and WINS the supplier field,
    filing a whole batch under a phantom sender. Demote such a title fragment so the
    letterhead read / the implausibility-gated Stage-2.5a hint recovery takes over.
    FAIL-TOWARD-REVIEW (demote-only — never rewrites a value).

    ⚠ The chrome layer lives HERE, NOT in `_base` — and the OVERRIDE arm of
    engine._supplier_identity_decision judges the INCUMBENT with `_base`, so the chrome
    demotion can never license a confidence-blind 'take' that overwrites a real short
    supplier ("Dell"/"Sage") — a chrome-shaped real name is edit-1 from a title prefix,
    so shape alone cannot tell it from a garble; only the FILTERING seams use this full
    form (persist a fresh read; the Stage-2.5a recovery gate + re-check), where rejecting
    a garble is the whole point. Mirrored in database/modules/learning.js."""
    if not _is_plausible_supplier_name_base(value):
        return False
    if os.environ.get("SUPPLIER_CHROME_FRAGMENT_GUARD", "1") != "0":
        t = str(value).strip().rstrip(":")
        core = "".join(c for c in t.lower() if c.isalnum())
        if len(t.split()) <= 2 and _is_doc_chrome_fragment(core):
            return False
    return True


# Leading/trailing noise that OCR commonly prepends to a supplier name read off
# a letterhead/logo — straight + smart quotes, backticks, and the U+FFFD
# replacement char left by a decode failure. A single stray "‘" turned
# "Cloud VPS" into "‘Cloud VPS", splitting that supplier's learning corpus in
# two so confirmed hints/anchors/format under one spelling never applied to
# documents resolved under the other.
_SUPPLIER_EDGE_NOISE = "'‘’“”‛′‵`� \t\r\n"


def normalize_supplier_name(name: str | None) -> str | None:
    """Strip edge quote/apostrophe/replacement-char noise from a supplier name.

    Reusable identity normaliser so the same real supplier always keys to one
    learning bucket. Only EDGE noise is removed — interior characters and
    legitimate trailing punctuation that is already part of learned keys (e.g.
    the '.' in "Polychemtex Inc.") are preserved. Falls back to the trimmed
    original if stripping would empty the string.
    """
    if name is None:
        return None
    s = str(name).strip()
    cleaned = s.strip(_SUPPLIER_EDGE_NOISE).strip()
    return cleaned or s


def _validate(value: str, patterns: list[str]) -> bool:
    """Check if value matches any of the validation patterns."""
    for p in patterns:
        if re.search(p, value, re.IGNORECASE):
            return True
    return False


def _clean_value(value: str, val_type: str | None,
                 validation: dict | None = None) -> str:
    """Clean up extracted value."""
    value = value.strip()
    # Remove trailing punctuation noise
    value = re.sub(r'[,;]+$', '', value).strip()
    # Date/currency values are matched via regex against the whole string
    # (which may include column-bleed noise either side, e.g.
    # "3/6/2026  FREIGHT/CARRIAGE/INSURANCE"). The regex match itself is the
    # actual value — extract just that substring rather than keeping everything.
    if val_type in ("date", "currency") and validation and val_type in validation:
        for p in validation[val_type]:
            m = re.search(p, value, re.IGNORECASE)
            if m:
                return m.group(0).strip()
    # Reference numbers with a fixed group shape (e.g. job_no "2603-0670-1"):
    # extract the four-four-one digit shape from the captured text and normalise
    # whatever OCR separator noise (".", spaces, "_", "/", mixed) to a single "-".
    # Generic to the shape, not to any one supplier's worksheet.
    if val_type == "job_reference":
        m = re.search(r'(\d{4})[-.\s_/]{0,3}(\d{4})[-.\s_/]{0,3}(\d)\b', value)
        if m:
            return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    # Reference numbers are single tokens — if OCR column-bleed left a second
    # "word" that looks like a name (starts with a capital letter), drop it.
    # e.g. "204870 Polychemtex Inc." → "204870"
    if val_type == "alphanumeric":
        value = re.split(r' {2,}', value)[0].strip()
        parts = value.split()
        if len(parts) > 1 and re.match(r'^[A-Z][a-z]', parts[1]):
            value = parts[0]
    # For name fields, truncate at column gaps or address numbers.
    # Addresses start with 4+ digit sequences (zip/postal codes, building numbers).
    # Multiple spaces = Tesseract column separator.
    if val_type == "text":
        # Split on column gaps or address numbers (zip codes)
        value = re.split(r' {4,}|\s+\d{4,}', value)[0].strip()
        # After 2+ name words, a word ending in "," signals a city/address separator
        # e.g. "Ann Blume Tallinn, Harjumaa" → stop at "Tallinn,"
        parts = value.split()
        end = len(parts)
        for i, w in enumerate(parts):
            if i >= 2 and w.endswith(','):
                end = i
                break
        value = ' '.join(parts[:end]).rstrip(',;').strip()
    return value
