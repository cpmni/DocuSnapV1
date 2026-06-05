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
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


# ── Document type detection ───────────────────────────────────────────────────

def detect_document_type(ocr_text: str, patterns: dict,
                          known_types: list[str] | None = None) -> dict | None:
    """
    Scan the top quarter of the OCR text for document type keywords.
    Returns {"type": "Invoice", "confidence": 85} or None.

    known_types: list of type names from the database — we score these first.
    """
    # Only look at top portion of the document
    lines  = ocr_text.split("\n")
    n_top  = max(10, len(lines) // 4)
    top    = "\n".join(lines[:n_top]).lower()

    type_keywords = patterns.get("document_type_keywords", {})
    if not type_keywords:
        return None

    scores = {}
    for doc_type, keywords in type_keywords.items():
        score = 0
        for kw in keywords:
            if kw.lower() in top:
                # Exact phrase match scores higher
                score += 2 if f" {kw.lower()} " in f" {top} " else 1
        if score > 0:
            scores[doc_type] = score

    if not scores:
        return None

    best_type  = max(scores, key=scores.get)
    best_score = scores[best_type]

    # Convert score to confidence (max score ~5 → 95%)
    confidence = min(95, 60 + best_score * 7)

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
            found = _search_for_label(lines, label, dirs)
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
            value = _clean_value(value, val_type)

            # Confidence boost for exact label match
            conf = base_conf
            if direction == "right":
                conf += 5  # inline values are more reliable

            results[field_key] = {
                "value":      value,
                "confidence": min(95, conf),
                "method":     "keyword",
                "label":      label,
            }
            break  # found for this field, move to next

    return results


# ── Helpers ───────────────────────────────────────────────────────────────────

def _search_for_label(lines: list[str], label: str,
                      directions: list[str]) -> tuple[str, str] | None:
    """
    Search lines for a label and return (value, direction) or None.
    """
    label_lower = label.lower()

    for i, line in enumerate(lines):
        line_lower = line.lower()
        if label_lower not in line_lower:
            continue

        # Try RIGHT direction — value is on the same line after the label
        if "right" in directions or "inline" in directions:
            idx = line_lower.find(label_lower)
            after = line[idx + len(label):].strip()
            # Strip common separators
            after = re.sub(r'^[\s:|\-–]+', '', after).strip()
            if after and len(after) >= 1:
                return after, "right"

        # Try BELOW direction — value is on the next non-empty line
        if "below" in directions:
            for j in range(i + 1, min(i + 4, len(lines))):
                candidate = lines[j].strip()
                if candidate and not _is_label_line(candidate):
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
    # Very short, all caps, or ends with colon — likely a label
    return (
        len(t) < 3 or
        (t.isupper() and len(t) < 30) or
        text.strip().endswith(":")
    )


def _validate(value: str, patterns: list[str]) -> bool:
    """Check if value matches any of the validation patterns."""
    for p in patterns:
        if re.search(p, value, re.IGNORECASE):
            return True
    return False


def _clean_value(value: str, val_type: str | None) -> str:
    """Clean up extracted value."""
    value = value.strip()
    # Remove trailing punctuation noise
    value = re.sub(r'[,;]+$', '', value).strip()
    return value
