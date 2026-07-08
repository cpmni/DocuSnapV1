"""
extraction/field_rules.py
-------------------------
Operator-taught per-(supplier, doctype, field) CLEANUP rules — the Review
right-click "field cleanup rules" toolkit. These run in the Stage 4.5 winner loop
on the WINNER value to strip an adjacent heading/column that OCR bled into a field,
for the residual cases the inline-harvest column-clustering (template_mapper.
cluster_value_words) can't catch.

Two learned rule types (a third, "just fix this one", is a renderer-only one-off and
has no backend rule):

- remove_text — remove a specific learned caption (and close OCR variants) from the
  side it leaked. Precision-first, anchored, guarded; safe on free-text because it
  only removes the taught literal. (reggie's matcher.)
- keep_block — for a field that holds ONE value: keep the single whitespace-separated
  token that matches the field's validation pattern, dropping neighbour words on
  either side. Refuses when 0 or >=2 tokens match (ambiguous), so it never guesses.

All helpers are PURE and return (value, changed): changed=False leaves the value
untouched, so a field with no rule (or a rule that doesn't apply) is byte-identical.
"""
import re

_TOKEN_CAP = 40   # a caption, not a paragraph


def normalize_token(raw):
    """Normalise highlighted text into the stored match key: casefold (case-
    insensitive match), collapse internal whitespace to a single space (OCR spacing
    jitter), edge-strip, cap length. Returns '' for empty/garbage input."""
    if not raw:
        return ""
    t = re.sub(r"\s+", " ", str(raw)).strip().casefold()
    return t[:_TOKEN_CAP]


def apply_remove_text(value, token_norm, side="trailing", min_prefix=3):
    """Remove a learned leaked caption from `value`. `token_norm` is a normalised
    literal (see normalize_token); matched case-insensitively and tolerant of OCR
    whitespace jitter inside the caption. `side` = 'trailing' (default) or 'leading'.

    Returns (new_value, changed). Refuses (returns the value unchanged) when:
    trailing — no whitespace separator before the token (glued / token at position
    0); leading — the token isn't a separated run at the start; OR the surviving
    value would be shorter than `min_prefix`, empty, or identical. Never amputates a
    legitimate value that merely contains the token's letters mid-word (the `\\b`
    right-edge anchor)."""
    if not value or not token_norm:
        return value, False
    body = re.escape(token_norm).replace(r"\ ", r"\s+")   # OCR-space-tolerant literal
    if side == "leading":
        # token (a separated run) at the START, then a separator → drop both.
        rx = re.compile(r"^\s*" + body + r"\b\s+", re.IGNORECASE | re.DOTALL)
        m = rx.match(value)
        if not m:
            return value, False
        cut = value[m.end():].strip()
    else:
        # whitespace + token (word-boundary right edge) + everything after → drop.
        rx = re.compile(r"\s+" + body + r"\b.*$", re.IGNORECASE | re.DOTALL)
        m = rx.search(value)
        if not m:
            return value, False
        cut = value[:m.start()].rstrip()
    if len(cut.strip()) < max(0, int(min_prefix)):
        return value, False
    if cut.strip() == value.strip():
        return value, False
    return cut, True


def apply_keep_block(value, pattern=None):
    """For a single-value field: keep the one whitespace-separated token that fully
    matches the field's `pattern` (a validation regex), dropping neighbour words on
    either side. Returns (kept, changed). Refuses (unchanged) when there's no
    pattern, the value is already a single token, or 0 / >=2 tokens match (ambiguous
    → never guess)."""
    if not value or not pattern:
        return value, False
    try:
        rx = re.compile(pattern)
    except re.error:
        return value, False
    tokens = value.split()
    if len(tokens) <= 1:
        return value, False
    matches = [t for t in tokens if rx.fullmatch(t)]
    if not matches:
        return value, False
    if len(matches) > 1:
        # The type pattern (e.g. 'alphanumeric') is broad enough that heading words
        # ("DOCUSYS", "MODEL") also match. A code-shaped value carries DIGITS; a bled
        # caption is pure alphabetic — so when exactly one match bears a digit, keep
        # it. Otherwise refuse (ambiguous → never guess).
        digit_matches = [t for t in matches if any(c.isdigit() for c in t)]
        if len(digit_matches) != 1:
            return value, False
        matches = digit_matches
    kept = matches[0]
    if kept == value.strip():
        return value, False
    return kept, True
