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
            # the label).
            entry = {"labels": [], "directions": ["right", "below"], "base_confidence": 80}
        labels = list(entry.get("labels") or [])
        if lab not in labels:
            labels.append(lab)
        field_patterns[key] = {**entry, "labels": labels}

    return {**patterns, "field_patterns": field_patterns}


# ── Document type detection ───────────────────────────────────────────────────

def detect_document_type(ocr_text: str, patterns: dict,
                          known_types: list[str] | None = None) -> dict | None:
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
    for name in (known_types or []):
        name = (name or "").strip()
        if name:
            bucket = type_keywords.setdefault(name, [])
            if name not in bucket:
                bucket.append(name)

    if not type_keywords:
        return None

    scores: dict[str, float] = {}
    for doc_type, keywords in type_keywords.items():
        score = 0.0
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
                break  # first occurrence of this phrase is enough
        if score > 0:
            scores[doc_type] = round(score, 1)

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

    for field_key in field_keys:
        if field_key not in field_patterns:
            continue

        fp      = field_patterns[field_key]
        labels  = fp.get("labels", [])
        dirs    = fp.get("directions", ["right"])
        base_conf = fp.get("base_confidence", 75)

        for label in labels:
            # Support per-label direction override: {"text": "Bill From", "directions": ["below"]}
            if isinstance(label, dict):
                label_text = label["text"]
                label_dirs = label.get("directions", dirs)
            else:
                label_text = label
                label_dirs = dirs
            found = _search_for_label(lines, label_text, label_dirs)
            if not found:
                continue

            value, direction = found
            if not value or len(value.strip()) < 1:
                continue

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
                "method":     "keyword",
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
    return re.compile(r'\s*'.join(re.escape(w) for w in words))


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


def _search_for_label(lines: list[str], label: str,
                      directions: list[str]) -> tuple[str, str] | None:
    """
    Search lines for a label and return (value, direction) or None.
    """
    pattern = _label_pattern(label)
    if pattern is None:
        return None

    for i, line in enumerate(lines):
        line_lower = line.lower()
        m = pattern.search(line_lower)
        if not m:
            continue

        # Try RIGHT direction — value is on the same line after the label
        if "right" in directions or "inline" in directions:
            after = line[m.end():].strip()
            # Strip common separators
            after = re.sub(r'^[\s:|\-–]+', '', after).strip()
            # Split on column gaps (4+ spaces) — same as 'below' direction.
            # Multi-column OCR often interleaves adjacent columns on the same line;
            # take only the first column segment to avoid grabbing unrelated text.
            after = re.split(r' {4,}', after)[0].strip()
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
