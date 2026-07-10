"""
extraction/keyword.py
---------------------
Stage 1 extraction — rule-based keyword/pattern matching.
No LLM required. Handles 60-70% of fields on well-structured documents.

Reads patterns from config/keyword_patterns.json.
"""

import re
import json
from pathlib import Path

from extraction import number_format   # region-aware amount normaliser


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


# ── Document type detection ───────────────────────────────────────────────────

# Heading-adjacent tokens a real title line may carry beside the type word — a
# number/reference or a "No."/"#"/"Number" caption — none of which make it a body
# mention. Any OTHER word on the line means it's prose, not a heading.
_HEADING_ADJ = frozenset({"no", "no.", "#", "number", "num", "ref", "-", ":", "|"})

def _line_is_heading_like(line: str, phrase: str) -> bool:
    """Relaxed heading test for the EXPOSED `heading` signal only (scoring uses the
    strict whole-line equality). True when the line IS the matched type phrase plus at
    most heading-adjacent tokens — a reference/number CODE ("WORKSHEET 38", "Invoice No.
    10023", "WORKSHEET WS-38", "PURCHASE ORDER #PO-1234") or a "No."/"#"/"Number" caption
    — so a title carrying its own reference still counts, but "...see the attached
    worksheet..." (a real extra word) does not."""
    s = (line or "").strip().lower()
    p = (phrase or "").strip().lower()
    if not p or p not in s:
        return False
    if s == p:
        return True
    rest = s.replace(p, " ", 1)
    for t in rest.split():
        # A reference/number CODE beside the title (not a real word): contains a digit and
        # is only alphanumerics + code punctuation ("38", "ws-38", "inv-2024-001", "#po1234").
        if any(ch.isdigit() for ch in t) and all(ch.isalnum() or ch in "#:.-/|" for ch in t):
            continue
        if t in _HEADING_ADJ:
            continue
        return False                                        # a real extra word → a mention
    return True


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

    type_keywords = {k: list(v) for k, v in patterns.get("document_type_keywords", {}).items()}
    aliases_by_name = type_aliases or {}
    for name in (known_types or []):
        name = (name or "").strip()
        if not name:
            continue
        bucket = type_keywords.setdefault(name, [])
        # NAME fold — kept EXACTLY as before (case-sensitive membership) so the no-alias path
        # is byte-identical to the pre-feature engine (the harness 0-delta gate).
        if name not in bucket:
            bucket.append(name)
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
                if not m:
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
                is_heading = line.strip().lower() == m.group(0).strip()
                score += position_weight * (2.0 if is_heading else 1.0)
                # EXPOSED heading signal (`heading` in the result) — consumed ONLY by the
                # template doc-type-precedence gate (a matched template must not override a
                # doc whose own TITLE confidently declares a different type). It does NOT
                # affect `score`/`confidence` (byte-identical scoring preserved). Relaxed
                # vs the strict scoring `is_heading` so a real title carrying a number or
                # punctuation ("WORKSHEET 38", "Purchase Order:", "Invoice No. 10023")
                # still counts as a heading, while an in-prose mention does not.
                if is_heading or _line_is_heading_like(line, m.group(0)):
                    head = True
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
                   patterns: dict) -> dict:
    """
    Extract field values using keyword patterns.
    Returns dict of {field_key: {"value": str, "confidence": int, "method": "keyword"}}
    Only includes fields that were found.
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
        dirs    = fp.get("directions", ["right"])
        base_conf = fp.get("base_confidence", 75)

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
            found = _search_for_label(lines, label_text, label_dirs)
            if not found:
                continue

            value, direction = found
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


def _search_for_label(lines: list[str], label: str,
                      directions: list[str]) -> tuple[str, str] | None:
    """
    Search lines for a label and return (value, direction) or None.
    """
    pattern = _label_pattern(label)
    if pattern is None:
        return None

    _is_bare_total = label.strip().lower() == 'total'
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
        # A bare "Supplier"/"Vendor"/"Seller" must not read a "Supplier Ref/No/Account" reference
        # caption as the issuer name — skip; a real "Supplier: Acme" still matches. See above.
        if _is_identity_caption and _identity_ref_caption(line, m.end()):
            continue

        # Try RIGHT direction — value is on the same line after the label
        if "right" in directions or "inline" in directions:
            after = line[m.end():].strip()
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


def _is_plausible_supplier_name(value: str | None) -> bool:
    """Is `value` plausible as a SUPPLIER IDENTITY (not a generic field value)?

    A real supplier/company name is essentially never a bare 2-3 character
    all-caps token with no digits — those ("IN"/"INV" from "INVOICE", "BILL",
    "PO") are document-structure fragments that label/zone cropping leaves
    behind, and once one wins it poisons every supplier-keyed lookup. Anything
    longer, multi-word, mixed-case, or containing a digit is treated as
    plausible (so "SuperStore", "ACME LIMITED", "Polychemtex Inc." all pass).

    This is deliberately a SHAPE test, not a stoplist — no supplier name is
    hardcoded. Short all-caps brands ("IBM", "DHL") are flagged here as
    not-uniquely-plausible BY SHAPE; callers must apply an "unless uniquely
    supported" rule (override only when a plausible alternative exists; persist
    only when the user explicitly confirmed it) so legitimate short names are
    never hard-banned. Mirrored in database/modules/learning.js
    (isPlausibleSupplierName) for the persistence side.
    """
    if not value or not str(value).strip():
        return False
    t = str(value).strip().rstrip(":")
    if (len(t) <= 3 and t.isupper() and " " not in t
            and not any(c.isdigit() for c in t)):
        return False
    # A reference/number misread into the supplier field ("t 38/07", "36552",
    # "12/345") is digit-dominant with almost no letters — a real company name
    # always carries substantial alphabetic content. Shape test only: reject
    # when there are 2+ digits AND fewer than 3 letters. This keeps legitimate
    # letter-rich names that merely contain digits ("3M", "G2 Environmental",
    # "24/7 Services") plausible.
    n_alpha = sum(c.isalpha() for c in t)
    n_digit = sum(c.isdigit() for c in t)
    if n_alpha < 3 and n_digit >= 2:
        return False
    # Word-quality gate (multi-word only): a MULTI-TOKEN read that is mostly OCR
    # gibberish / address fragments ("Fr eanehae Crane", "67 Boucher Cre",
    # "St OMe WM cenant") is not a real supplier identity — flagging it implausible
    # is what lets the learned-hint recovery (engine Stage 2.5a) replace it with the
    # confirmed name. Single-token values are NOT judged here so short real brands
    # ("3M", "IBM", "DHL") are never demoted by this rule (the shape tests above
    # already govern them). See extraction/value_quality.py.
    if len(t.split()) >= 2:
        from extraction.value_quality import name_quality
        if name_quality(t) < 0.5:
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
