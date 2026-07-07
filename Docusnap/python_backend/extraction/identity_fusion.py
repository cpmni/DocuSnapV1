"""
identity_fusion.py — precision-first SUPPLIER identity (WHO issued the document).

Reads the ISSUER company name from the page CHROME (header + footer band) and fuzzy-
matches it against the closed KNOWN-SUPPLIER set — the scope values the user has already
filed at least once. On a text letterhead the printed name is a far stronger identity
signal than a logo perceptual-hash, and matching against a closed supplier set means the
recipient ("Bill To: …") can never be mistaken for the issuer (customers aren't in the set).

Precision-first, DUAL-GATED: a supplier is ACCEPTED only when the whole-name alignment
(`full`) AND the distinctive-token match (`canon`, prefix-sensitive Jaro-Winkler) BOTH
clear their gates AND the winner separates from the runner-up. Otherwise → UNKNOWN, flag
for review. It never emits a wrong company (the dangerous silent-misfile the logo matcher
currently produces).

`fuse()` returns an identity VERDICT designed to run in SHADOW first (compute + record,
don't change today's decision) and to later absorb logo corroboration + a conflict gate.
Ported from the measured sandbox prototype (100% supplier precision on the eval corpora).

DEPENDENCY: rapidfuzz (MIT, offline C-extension). Must be added to python_backend
requirements + the licence allowlist before this module is imported by the engine.
"""
import re

from rapidfuzz import fuzz
from rapidfuzz.distance import JaroWinkler

# Generic company tokens that carry no discriminative supplier signal — down-weighted so
# a shared tail ("…Supplies Ltd" / "…Services") can't false-match on the tail alone.
GENERIC_TOKENS = {
    "ltd", "limited", "plc", "llp", "inc", "co", "company", "group", "holdings",
    "services", "service", "supplies", "supply", "trading", "systems", "solutions",
    "industrial", "industries", "components", "logistics", "utilities", "marine",
    "hardware", "electrical", "print", "stationers", "the", "and", "&",
}

# Calibrated operating point (measured on the eval corpora; precision-first).
ACCEPT = 82.0
MARGIN = 6.0
FULL_MIN = 78.0
CANON_MIN = 80.0


# ── Issuer-band chrome ──────────────────────────────────────────────────────────────────
# A line that BEGINS a recipient / "addressed-to" block. When one appears in the top band the
# issuer letterhead is ABOVE it; everything from the marker down is the recipient (a customer),
# never the issuer. reggie-reviewed set (checked against the recipient vs issuer label vocab in
# config/keyword_patterns.json). It LEANS TO RECALL on markers: a MISSED marker leaks the
# recipient into the chrome (→ a misfile) while a FALSE marker only truncates early → identify_
# supplier abstains (safe). `customer`/`client` carry a negative lookahead so an issuer's own
# "Customer Service"/"Client portal" contact strip doesn't fire; `[-\s]*` folds hyphen/OCR-join
# variants ("Sold-To"/"BillTo"); bare "to:" is line-anchored + colon-required.
_RECIPIENT_MARKER = re.compile(
    r"\b(?:bill(?:ed)?|invoiced?|sold|ship(?:ped)?|deliver(?:y|ed)?)[-\s]*to\b"
    r"|\bconsignee\b|\brecipient\b"
    r"|\bcustomer\b(?!\s*(?:service|care|support|enquir|inquir|relation|helpline|hotline|feedback|portal))"
    r"|\bclient\b(?!\s*(?:login|portal|area))"
    r"|\baccount[-\s]*(?:name|holder)\b"
    r"|\b(?:buyer|purchaser)\b|\b(?:purchased|ordered)[-\s]*by\b"
    r"|\bfor\s+the\s+attention\s+of\b|\bf\.?\s*a\.?\s*o\b\.?"
    r"|\battention\b|\battn\b"
    r"|^\s*to\s*:",
    re.IGNORECASE,
)


def issuer_chrome(ocr_text: str, max_lines: int = 6) -> str:
    """The ISSUER band for supplier identity: the top letterhead lines, TRUNCATED at the first
    recipient marker ("Bill To"/"Customer"/"FAO"/…), FOOTER excluded. Replaces a flat first-6/
    last-3-line chrome that let identify_supplier match a NON-issuer name in the gazetteer (the
    recipient block, a printer footer, a line item) — the real-engine precision hole the shadow
    measurement surfaced (67% vs 100% on realistic docs). Literal (no letter-level fuzz): a marker
    mangled enough to slip past almost always sits above an equally-mangled name that then fails
    the dual-gate, so this truncation is defence-in-depth, not the sole guard. On a marker hit, any
    text BEFORE the marker on that same line is kept (salvages a two-column "Issuer …… Bill To:"
    letterhead). Empty band → "" → identify_supplier abstains (the safe outcome)."""
    band = []
    lines = [l.strip() for l in (ocr_text or "").splitlines() if l.strip()]
    for ln in lines[:max_lines]:
        m = _RECIPIENT_MARKER.search(ln)
        if m:
            head = ln[:m.start()].strip()   # keep an issuer name sharing the marker's line
            if head:
                band.append(head)
            break
        band.append(ln)
    return " ".join(band)


def canonical_token(name: str) -> str:
    """The single most discriminative token of a supplier name (usually the first
    non-generic word ≥4 chars): Northgate, Meridian, Ashfield, Crestwave, Bluewave…"""
    toks = re.findall(r"[a-z0-9]+", (name or "").lower())
    for t in toks:
        if t not in GENERIC_TOKENS and len(t) >= 4:
            return t
    return toks[0] if toks else (name or "").lower()


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", (s or "").lower())).strip()


def _tokens(s: str):
    return [t for t in re.findall(r"[a-z0-9]+", (s or "").lower()) if len(t) >= 2]


def score_supplier(name: str, text_norm: str, text_tokens):
    """Blended score in [0,100] for one supplier against the (chrome) text.

    full  — best-substring alignment of the whole name (partial/token-set ratio):
            rewards a clean contiguous "Crestwave Systems" appearing anywhere in the chrome.
    canon — word-level match of the DISTINCTIVE token to the nearest chrome token, via
            prefix-sensitive Jaro-Winkler: OCR rarely corrupts a word's first letters, so a
            real "Oakmount"→"Oakmoumt" drift keeps its prefix and scores high, while a
            coincidental interior-letter overlap ("amount") is penalised. Length-guarded to
            block short-word subsequence collisions. `canon` is the precision lever — a
            supplier cannot win on its generic tail alone.
    """
    name_norm = _norm(name)
    full = max(fuzz.partial_ratio(name_norm, text_norm),
               fuzz.token_set_ratio(name_norm, text_norm))
    canon = canonical_token(name)
    canon_best = 0.0
    for t in text_tokens:
        if len(t) < 4:
            continue
        if abs(len(t) - len(canon)) > max(3, len(canon) // 2):
            continue
        jw = 100.0 * JaroWinkler.similarity(canon, t)
        if jw > canon_best:
            canon_best = jw
    blended = 0.6 * canon_best + 0.4 * full   # canon dominates (precision); full corroborates
    return blended, {"full": round(full, 1), "canon": round(canon_best, 1), "canon_tok": canon}


def identify_supplier(chrome_text: str, suppliers,
                      accept=ACCEPT, margin=MARGIN, full_min=FULL_MIN, canon_min=CANON_MIN):
    """Identify the issuing supplier from the page chrome against the closed `suppliers`
    set. DUAL-GATED accept: blended ≥ accept AND (best − second) ≥ margin AND full ≥
    full_min AND canon ≥ canon_min. The AND-gate is what kills body-word collisions: a lone
    table word ("Amount") lifts `canon` for "Oakmount" but never lifts `full` (no
    "oakmount services" run), so it is rejected and the supplier stays UNKNOWN.

    Returns dict(supplier, raw_supplier, confidence, accepted, second, second_score,
    margin, evidence)."""
    text_norm = _norm(chrome_text)
    text_tokens = _tokens(chrome_text)
    scored = []
    for s in suppliers:
        sc, ev = score_supplier(s, text_norm, text_tokens)
        scored.append((sc, s, ev))
    if not scored:
        return {"supplier": None, "raw_supplier": None, "confidence": 0.0,
                "accepted": False, "second": None, "second_score": 0.0,
                "margin": 0.0, "evidence": {}}
    scored.sort(reverse=True, key=lambda x: x[0])
    best_sc, best_s, best_ev = scored[0]
    second_sc = scored[1][0] if len(scored) > 1 else 0.0
    accepted = (best_sc >= accept and (best_sc - second_sc) >= margin
                and best_ev["full"] >= full_min and best_ev["canon"] >= canon_min)
    return {
        "supplier": best_s if accepted else None,
        "raw_supplier": best_s,
        "confidence": round(best_sc, 1),
        "accepted": accepted,
        "second": scored[1][1] if len(scored) > 1 else None,
        "second_score": round(second_sc, 1),
        "margin": round(best_sc - second_sc, 1),
        "evidence": best_ev,
    }


def fuse(chrome_text: str, suppliers, logo_candidates=None, keyword_type=None):
    """Combine the WHO signals into an identity VERDICT (precision-first).

    This slice implements the TEXT supplier (the correctness backbone). Logo corroboration
    and the type-conflict gate layer in on later slices; the shape below is already the
    fusion contract eric specified, so wiring it in is additive:
      - text accepts                       → supplier from text (high precision);
      - text abstains                      → supplier UNKNOWN (logo fallback comes later);
      - (future) logo agrees               → raise confidence; logo disagrees → CONFLICT/flag.

    Runs in SHADOW: the caller records this verdict but keeps today's decision until the
    conflict-flag slice is enabled.
    """
    who = identify_supplier(chrome_text, suppliers)
    verdict = {
        "supplier": who["supplier"],
        "supplier_confidence": who["confidence"],
        "supplier_accepted": who["accepted"],
        "conflict": False,                       # set once logo/structure signals are fused
        "flag_reason": None if who["accepted"] else "supplier-unknown",
        "signals": {"name": who},
    }
    # Placeholder hooks (unused this slice): logo_candidates / keyword_type will feed
    # corroboration + the conflict gate without changing this contract.
    return verdict
