"""
extraction/ocr_corrector.py
---------------------------
OCR character correction using learned document format templates.

After enough documents from a supplier are confirmed, this module infers the
character-level format of reference fields (e.g. INV-001234 → UUU-DDDDDD).
When a freshly-extracted value has a character that breaks the pattern but
matches a known OCR confusion pair, the character is substituted and the
extraction confidence is boosted.

Template alphabet:
  D  — any decimal digit   (0-9)
  U  — any uppercase letter (A-Z)
  L  — any lowercase letter (a-z)
  A  — any alphanumeric    (D or U or L)
  ?  — position too inconsistent to constrain
  *  — literal character kept as-is (separator: - / . space etc.)

Common OCR confusions addressed:
  Digit expected, letter seen:
    1 ← l I i |
    0 ← O o Q
    5 ← S s
    2 ← Z z
    7 ← T
    8 ← B
    6 ← G b
    9 ← g q
  Letter expected, digit seen:
    O ← 0
    I ← 1  (uppercase)
    l ← 1  (lowercase)
    S ← 5
    Z ← 2
    B ← 8
    G ← 6
    T ← 7
"""

from collections import Counter

# ── Confusion maps ────────────────────────────────────────────────────────────

# When we EXPECT a digit but OCR produced a letter
LETTER_TO_DIGIT = {
    'l': '1', 'I': '1', 'i': '1', '|': '1',
    'O': '0', 'o': '0', 'Q': '0',
    'S': '5', 's': '5',
    'Z': '2', 'z': '2',
    'T': '7',
    'B': '8',
    'G': '6', 'b': '6',
    'g': '9', 'q': '9',
}

# When we EXPECT an uppercase letter but OCR produced a digit
DIGIT_TO_UPPER = {
    '0': 'O',
    '1': 'I',
    '5': 'S',
    '2': 'Z',
    '8': 'B',
    '6': 'G',
    '7': 'T',
}

# When we EXPECT a lowercase letter but OCR produced a digit
DIGIT_TO_LOWER = {
    '0': 'o',
    '1': 'l',
    '5': 's',
    '2': 'z',
    '8': 'b',
    '6': 'g',
}


# ── Template derivation ───────────────────────────────────────────────────────

def value_to_template(value: str) -> str:
    """
    Convert a confirmed value to its format template string.
      'INV-001234' → 'UUU-DDDDDD'
      'a4b8c2'    → 'LALAALA'  (wait, that would be LALADLA — just an example)
    """
    out = []
    for c in value:
        if c.isdigit():
            out.append('D')
        elif c.isupper():
            out.append('U')
        elif c.islower():
            out.append('L')
        else:
            out.append(c)   # literal separator: - / . space , etc.
    return ''.join(out)


def derive_template(values: list) -> str | None:
    """
    Infer a consensus format template from multiple confirmed values.
    Returns a template string, or None if the values are too inconsistent.

    Requires at least 2 values of the same length to produce a template.
    """
    clean = [v for v in values if v and v.strip()]
    if len(clean) < 2:
        return None

    templates = [value_to_template(v) for v in clean]

    # Use the most common length (ignore outliers)
    most_common_len = Counter(len(t) for t in templates).most_common(1)[0][0]
    same_len = [t for t in templates if len(t) == most_common_len]
    if len(same_len) < 2:
        return None

    n = most_common_len
    merged = []
    for i in range(n):
        chars = {t[i] for t in same_len}
        if len(chars) == 1:
            merged.append(next(iter(chars)))        # unanimous
        elif chars <= {'D'}:
            merged.append('D')
        elif chars <= {'U'}:
            merged.append('U')
        elif chars <= {'L'}:
            merged.append('L')
        elif chars <= {'D', 'U', 'L', 'A'}:
            merged.append('A')                      # mixed alphanumeric
        else:
            merged.append('?')                      # too varied

    template = ''.join(merged)

    # Only return if at least half the positions are constrained
    constrained = sum(1 for c in template if c != '?')
    if constrained < n * 0.5:
        return None

    return template


# ── Correction ────────────────────────────────────────────────────────────────

def try_correct(value: str, template: str) -> tuple:
    """
    Attempt to correct `value` to conform to `template`.

    Returns:
        (corrected_value, confidence_boost)
        corrected_value is None if correction is impossible.
        confidence_boost is 0–20 (added to existing extraction confidence).
    """
    if not template or len(value) != len(template):
        return None, 0

    result = list(value)
    n_fixes = 0

    for i, (char, tmpl) in enumerate(zip(value, template)):
        if tmpl == '?':
            continue                            # unconstrained — skip

        if tmpl == 'D':                         # expect digit
            if char.isdigit():
                continue
            fix = LETTER_TO_DIGIT.get(char)
            if fix:
                result[i] = fix
                n_fixes += 1
            else:
                return None, 0                  # unrecognised non-digit

        elif tmpl == 'U':                       # expect uppercase letter
            if char.isupper():
                continue
            if char.isdigit():
                fix = DIGIT_TO_UPPER.get(char)
                if fix:
                    result[i] = fix
                    n_fixes += 1
                else:
                    return None, 0
            elif char.islower():
                result[i] = char.upper()        # simple case normalisation
                n_fixes += 1
            else:
                return None, 0

        elif tmpl == 'L':                       # expect lowercase letter
            if char.islower():
                continue
            if char.isupper():
                result[i] = char.lower()
                n_fixes += 1
            elif char.isdigit():
                fix = DIGIT_TO_LOWER.get(char)
                if fix:
                    result[i] = fix
                    n_fixes += 1
                else:
                    return None, 0
            else:
                return None, 0

        elif tmpl == 'A':                       # expect any alphanumeric
            if char.isalnum():
                continue
            return None, 0

        else:                                   # literal separator expected
            if char == tmpl:
                continue
            return None, 0                      # separator mismatch

    corrected = ''.join(result)

    # Confidence boost: falls off with more substitutions
    boost_table = {0: 8, 1: 20, 2: 12, 3: 6}
    boost = boost_table.get(n_fixes, 0)

    return corrected, boost


# ── Format index ──────────────────────────────────────────────────────────────

def build_format_index(formats_data: list) -> dict:
    """
    Build a lookup dict from the DB format data.

    formats_data entries:
        {supplier_name, document_type, field_key, sample_values: [str]}

    Returns:
        {
          (supplier_lower, doc_type_lower, field_key): template,
          '_fallback': {(doc_type_lower, field_key): template},
        }
    """
    index    = {}
    dt_accum = {}   # accumulate templates per (doc_type, field_key)

    for entry in (formats_data or []):
        supplier  = (entry.get('supplier_name') or '').lower().strip()
        doc_type  = (entry.get('document_type') or '').lower().strip()
        field_key = entry.get('field_key', '')
        samples   = entry.get('sample_values') or []

        if not field_key or len(samples) < 2:
            continue

        tmpl = derive_template(samples)
        if not tmpl:
            continue

        if supplier and doc_type:
            index[(supplier, doc_type, field_key)] = tmpl

        dt_key = (doc_type, field_key)
        dt_accum.setdefault(dt_key, []).append(tmpl)

    # Doc-type fallback: only when ALL suppliers agree on the same template
    fallback = {}
    for dt_key, tmpls in dt_accum.items():
        unique = set(tmpls)
        if len(unique) == 1:
            fallback[dt_key] = unique.pop()

    index['_fallback'] = fallback
    return index


# ── Public entry point ────────────────────────────────────────────────────────

def correct_extraction(value: str,
                       field_key: str,
                       supplier_name: str | None,
                       doc_type: str | None,
                       format_index: dict) -> tuple:
    """
    Look up the best template for this field and attempt OCR correction.

    Returns:
        (final_value, confidence_boost)
        final_value is the original value if no correction was made.
    """
    if not value or not format_index:
        return value, 0

    supplier = (supplier_name or '').lower().strip()
    doc_type_key = (doc_type or '').lower().strip()

    # 1. Supplier-specific template
    tmpl = format_index.get((supplier, doc_type_key, field_key))

    # 2. Doc-type fallback
    if not tmpl:
        tmpl = format_index.get('_fallback', {}).get((doc_type_key, field_key))

    if not tmpl:
        return value, 0

    corrected, boost = try_correct(value, tmpl)
    return (corrected if corrected else value), boost
