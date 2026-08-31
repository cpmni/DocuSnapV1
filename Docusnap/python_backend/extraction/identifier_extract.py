"""
extraction/identifier_extract.py — SUPPLIER HARD-IDENTIFIER extractor (slice 1a of the identifier-
registry arc; reggie + gary design, Oracle SIGN-OFF-WITH-CONDITIONS 2026-08-26). DARK — nothing
calls this in the live pipeline until the reach/false-match census clears and the engine wiring lands.

Reads a document's page text and yields its STABLE HARD IDENTIFIERS (VAT number, company registration
number, phone) with enough POSITION/context for the registry to scope each to the ISSUER (never the
recipient). The identity keys (VAT / company_no) are matched EXACTLY on the normalised value — never a
fuzzy fold: the UK VAT mod-97 checksum IS the confusable detector, and a fold would "repair" a misread
into a VALID-BUT-DIFFERENT number that then falsely corroborates the wrong company (Oracle + reggie).

Pure + stdlib-only (packaged-build safe). The census runs it over stored ocr_text with a line-index
region heuristic; the eventual engine call passes real page geometry + reuses keyword._vat_identifier_tail
for the money veto (this module carries a lighter money guard so the census is self-contained).
"""

import re

# ── UK VAT mod-97 checksum — EXACT port of database/modules/trust.js `_validVatGb` (parity-pinned) ──
def valid_vat_gb(v):
    up = re.sub(r"\s+", "", str(v or "")).upper()
    if re.match(r"^GB(GD|HA)\d{3}$", up):
        return True
    s = re.sub(r"[^0-9]", "", up)
    if not re.match(r"^\d{9}(\d{3})?$", s):
        return False
    d = [int(c) for c in s[:9]]
    w = [8, 7, 6, 5, 4, 3, 2]
    total = sum(d[i] * w[i] for i in range(7))
    check = d[7] * 10 + d[8]
    return (total + check) % 97 == 0 or (total + check + 55) % 97 == 0

# ── patterns ──
_VAT_CAND = re.compile(r"\bGB\s*\d(?:[\d\s]{7,16})\d\b", re.I)           # caption-less "GB 774 2093 55" sweep
_VAT_DIGITS = re.compile(r"(?<!\d)(\d{3}[ ]?\d{4}[ ]?\d{2}(?:[ ]?\d{3})?)(?!\d)")  # captioned bare digits
_VAT_CAPTION = re.compile(r"\bV\.?\s?A\.?\s?T\.?\b", re.I)

_COMPANY_CAPTION = re.compile(
    r"\b(?:company\s*(?:reg(?:istration)?\.?\s*)?(?:no|number)"
    r"|reg(?:istered)?\.?\s*(?:no|number)"
    r"|registered\s+in\s+england(?:\s+and\s+wales)?(?:\s+(?:no|number))?"
    r"|co\.?\s*reg(?:\.?\s*no)?)\b", re.I)
_COMPANY_NUM = re.compile(r"\b((?:SC|NI|OC|SO|NC|FC|GE|IP|SP|RS|R0|RC)\s?\d{6}|\d{6,8})\b", re.I)
_COMPANY_CANON = re.compile(r"^(?:\d{8}|(?:SC|NI|OC|SO|NC|FC|GE|IP|SP|RS|R0|RC)\d{6})$")

_PHONE_CAPTION = re.compile(r"\b(?:tel|telephone|phone|mob(?:ile)?|call\s+us)\b[:.]?", re.I)
_FAX_CAPTION = re.compile(r"\bfax\b[:.]?", re.I)
_PHONE = re.compile(r"(?:\+44\s?\(?0?\)?|\(?0)(?:[\d\s\-\)]{8,13})\d")

_MONEY = re.compile(r"[£$€¥]|\d[.,]\d{2}(?!\d)")                          # money-witness veto (light)
_SELF_ID = re.compile(
    r"\b(?:V\.?A\.?T\.?\s*(?:reg|registration|no|number)"
    r"|registered\s+in\s+england"
    r"|registered\s+(?:office|number|no)"
    r"|company\s*(?:reg|no|number))\b", re.I)
_RECIPIENT = re.compile(r"\b(?:bill\s*to|ship\s*to|sold\s*to|deliver(?:ed)?\s*to|invoice\s*to|customer|client)\b", re.I)


def _norm_alnum(s):
    return re.sub(r"[^A-Za-z0-9]", "", str(s or "")).upper()


def _vat_norm(raw):
    up = _norm_alnum(raw)
    if re.match(r"^GB(GD|HA)\d{3}$", up):
        return up
    digits = re.sub(r"[^0-9]", "", up)
    if len(digits) in (9, 12):
        return "GB" + digits
    return up


def _company_norm(raw):
    up = _norm_alnum(raw)
    m = re.match(r"^((?:SC|NI|OC|SO|NC|FC|GE|IP|SP|RS|R0|RC))(\d{6})$", up)
    if m:
        return up
    digits = re.sub(r"[^0-9]", "", up)
    if 6 <= len(digits) <= 8:
        return digits.zfill(8)
    return up


def _phone_norm(raw):
    d = re.sub(r"[^0-9]", "", str(raw or ""))
    if d.startswith("0044"):
        d = "0" + d[4:]
    elif d.startswith("44") and len(d) >= 11:
        d = "0" + d[2:]
    return d


def _region_of(idx, n_lines, first_recipient_idx):
    """Line-index region heuristic for the census (real engine uses geometry)."""
    if first_recipient_idx is not None and idx >= first_recipient_idx and idx < n_lines - 5:
        return "body"          # at/after a recipient marker, above the footer → body/recipient
    if idx < min(8, max(1, n_lines // 3)):
        return "header"
    if idx >= n_lines - 6:
        return "footer"
    return "body"


def extract_identifiers(ocr_text):
    """→ list of identifier records (reggie's interface contract). Pure, over the page text."""
    lines = [ln.rstrip() for ln in str(ocr_text or "").split("\n")]
    n = len(lines)
    first_recipient = None
    for i, ln in enumerate(lines):
        if _RECIPIENT.search(ln):
            first_recipient = i
            break
    out = []

    def add(kind, raw, value_norm, valid, checksum_passed, entropy, caption, idx, line):
        region = _region_of(idx, n, first_recipient)
        out.append({
            "kind": kind, "raw": raw, "value_norm": value_norm, "valid": bool(valid),
            "checksum_passed": checksum_passed, "entropy": entropy,
            "caption": caption,
            "position": {
                "line_index": idx, "region": region,
                "self_id_caption": bool(_SELF_ID.search(line)),
                "near_recipient_marker": bool(first_recipient is not None and idx >= first_recipient and region != "footer"),
                "line_text": line.strip(),
            },
        })

    for i, ln in enumerate(lines):
        has_money = bool(_MONEY.search(ln))
        # VAT — caption-less GB sweep + captioned bare-digit run
        cands = [(m.group(0), True) for m in _VAT_CAND.finditer(ln)]
        if _VAT_CAPTION.search(ln):
            cands += [(m.group(1), False) for m in _VAT_DIGITS.finditer(ln)]
        seen = set()
        for raw, _gb in cands:
            vn = _vat_norm(raw)
            if vn in seen:
                continue
            seen.add(vn)
            ck = valid_vat_gb(vn)
            gd_ha = bool(re.match(r"^GB(GD|HA)\d{3}$", vn))
            if has_money and not ck:                      # money-witness veto for a non-checksummed run
                continue
            if not (ck or gd_ha):
                continue                                  # precision: only a checksum-valid (or GD/HA) VAT
            add("vat", raw, vn, True, (None if gd_ha else True),
                ("decisive" if ck and not gd_ha else "strong"),
                ("vat" if _VAT_CAPTION.search(ln) else None), i, ln)

        # company number — CAPTION-GATED only (no checksum → caption is the sole precision anchor)
        if _COMPANY_CAPTION.search(ln) and not _VAT_CAPTION.search(ln):
            for m in _COMPANY_NUM.finditer(ln):
                cn = _company_norm(m.group(1))
                if _COMPANY_CANON.match(cn):
                    add("company_no", m.group(1), cn, True, None, "strong",
                        "company_no", i, ln)

        # phone (supporting only) — captioned, fax excluded
        if _PHONE_CAPTION.search(ln) and not _FAX_CAPTION.search(ln):
            for m in _PHONE.finditer(ln):
                pn = _phone_norm(m.group(0))
                if re.match(r"^0\d{9,10}$", pn):
                    add("phone", m.group(0), pn, True, None, "supporting", "phone", i, ln)

    return out


def match_issuer(registry, ocr_text):
    """Slice 1b MATCH: reverse-look-up this page's issuer-region identifiers against the learned
    registry. registry = {(kind, value_norm): set-of-suppliers}. Returns the sole matched supplier or
    None. Rule (Oracle C4): only a checksum-valid HEADER VAT counts, and it must map to EXACTLY ONE
    learned supplier — company_no / phone / footer never suggest alone, and a VAT that maps to >=2
    suppliers ABSTAINS (empty beats a guess). Suggest-only; the caller writes suggested_supplier,
    never a value."""
    if not registry:
        return None
    cands = {}
    for idn in extract_identifiers(ocr_text):
        if idn.get("kind") != "vat":
            continue
        if (idn.get("position") or {}).get("region") != "header":
            continue
        sups = registry.get(("vat", str(idn.get("value_norm") or "")))
        if sups:
            for s in sups:
                cands[s] = cands.get(s, 0) + 1
    return next(iter(cands)) if len(cands) == 1 else None
