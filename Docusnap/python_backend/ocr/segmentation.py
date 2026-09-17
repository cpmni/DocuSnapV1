#!/usr/bin/env python3
"""
ocr/segmentation.py
-------------------
Batch document SEPARATION (Stage 1). Decides where a multi-page PDF should be CUT into
separate documents, so a stack of distinct documents generated/scanned into ONE file
(e.g. ten Print Tracker alerts, one per page) is filed as ten documents instead of one.

CONSERVATIVE first-page rule: page 0 always starts document 1; a LATER page starts a NEW
document only when it independently presents a known template's FIRST-PAGE signature — a
logo+keyword-fingerprint match whose keyword OVERLAP with that template clears a floor.

Why the fingerprint floor (not a bare logo match): identify_template short-circuits on the
LOGO alone (method 'logo'), and a multi-page invoice often repeats its letterhead logo on
every page. A continuation page carries that logo but NOT the first page's keyword
fingerprint (Invoice / Bill To / Total …), so requiring fingerprint overlap keeps a normal
multi-page invoice as ONE document while still splitting a batch of independent first pages.

Fails SAFE: any uncertainty / missing fingerprint / error → ONE segment (today's behaviour),
so a missed cut is never worse than now; only a confident multi-first-page batch is split.

segment_pages() is the pure boundary logic (unit-tested without OCR). detect_segments()
adds per-page rendering + the template match.
"""

from __future__ import annotations

import re

# Default keyword-fingerprint overlap a later page must share with the template it matched
# to count as an independent FIRST page. 0.5 = at least half the template's signature words
# present on the page — high enough that an invoice's continuation pages (line items only)
# don't trip it, low enough that a real first page of a known layout does.
FIRST_PAGE_FP_FLOOR = 0.5


def segment_pages(first_page_flags: list[bool]) -> list[tuple[int, int]]:
    """Pure boundary logic. Given a per-page 'is this an independent first page?' flag,
    return inclusive 0-based (start, end) page-range segments.

    Page 0 always starts segment 1; each later True starts a new segment; a False page
    attaches to the current segment. So [True, False, False] (a 3-page invoice) → ONE
    segment, while [True, True, True] (three independent pages) → THREE segments."""
    n = len(first_page_flags)
    if n == 0:
        return []
    boundaries = [0] + [i for i in range(1, n) if first_page_flags[i]]
    segments: list[tuple[int, int]] = []
    for k, start in enumerate(boundaries):
        end = (boundaries[k + 1] - 1) if k + 1 < len(boundaries) else n - 1
        segments.append((start, end))
    return segments


def fingerprint_overlap(page_words, template_words) -> float:
    """Fraction of the TEMPLATE's keyword-fingerprint words present on this page
    (case-insensitive). 0.0 when the template has no fingerprint (→ never flags a
    boundary, the safe default)."""
    tset = {str(w).lower() for w in (template_words or []) if w}
    if not tset:
        return 0.0
    pset = {str(w).lower() for w in (page_words or []) if w}
    return len(tset & pset) / len(tset)


# Generic FIRST-PAGE header markers — the addressing + numbering + dating block (or an
# email header) that CLUSTERS on a document's opening page and is absent from a
# continuation page (line items only). Used to detect the start of a NEW document of an
# UNKNOWN type (no learned template), e.g. a City Office invoice appended after a batch of
# Print Tracker alerts, WITHOUT over-splitting a normal multi-page invoice (whose pages 2+
# carry no "Invoice To" addressing block).
_RECIPIENT_MARKERS = ("invoice to", "bill to", "billed to", "sold to", "ship to", "deliver to")
_NUMBER_MARKERS    = ("invoice no", "invoice number", "order no", "order number",
                      "po number", "purchase order", "account no", "statement no")
_DATE_MARKERS      = ("invoice date", "order date", "statement date", "due date")
_EMAIL_MARKERS     = ("from:", "sent:", "subject:")


def is_document_start(text: str) -> bool:
    """Heuristic: does this page BEGIN a new generic business document (invoice / order /
    statement / email), independent of any learned template? Conservative — fires only on
    a full email header (From+Sent+Subject) OR the first-page ADDRESSING block plus a
    number/date, which a continuation page (line items only) doesn't carry. Lets a trailing
    invoice in an alert batch start its own document without splitting a multi-page invoice."""
    low = (text or "").lower()
    if sum(m in low for m in _EMAIL_MARKERS) >= 3:
        return True
    has_recipient   = any(m in low for m in _RECIPIENT_MARKERS)
    has_num_or_date = any(m in low for m in _NUMBER_MARKERS) or any(m in low for m in _DATE_MARKERS)
    return has_recipient and has_num_or_date


# ── SELF-DECLARED CONTINUATION VETO (2026-09-16; Oracle (B) slice 1, DARK `segment_continuation_veto`) ────────
# The first-page signature is "a known template matches AND the keyword-fingerprint overlap clears the floor" —
# but the fingerprint IS the letterhead words, and a real continuation page (logo + name + address repeated,
# line items below) reproduces it (measured: 6/6 repeat-letterhead 2-page controls cut at page 2 —
# TESTING/_measure/watch_separate_soak_20260916/controls). On a manual import that is a SILENT TRUNCATION: page 1
# files as a one-page document, page 2 becomes an orphan. A page that DECLARES ITSELF a continuation is never a
# boundary, whatever the template/overlap/doc-start legs say:
#   • "Page n of N" / "Page n/N" / "Page n" with n >= 2 — anywhere on the page (a page number describes the page it
#     is printed on; "Page 1 of 2" never suppresses);
#   • "continued" / "(cont.)" / "continuation" — in the TOP band only and never "continued on …" (that footer sits
#     on the page BEFORE the continuation);
#   • "brought forward" / "B/F" — in the top band (the balance carried in from the previous page; "carried forward"
#     is deliberately EXCLUDED — it marks the page before).
# Page 0 is never affected (always document 1). OCR failure direction: a garbled marker = today's behaviour; a
# first page misread as "Page 2 of 2" = an under-split → a multi-page heuristic cut → the mig-176 belt holds it
# (fail-toward-review). Pure; pinned in tests/test_segmentation.py.
# "Page n of N" / "Page n/N" anywhere EXCEPT as the object of "on"/"see"/"to" ("continued on page 2 of 3" is the
# page BEFORE talking about its successor); the bare "Page n" form only as a page-number LINE of its own.
_PAGE_N_OF_N_RE = re.compile(r"(?<!\bon\s)(?<!\bsee\s)(?<!\bto\s)\bpage\s*(\d{1,3})\s*(?:of|/)\s*(\d{1,3})\b")
_PAGE_N_RE      = re.compile(r"(?m)^\s*page\s+(\d{1,3})\s*$")
_CONT_RE        = re.compile(r"(?<![a-z])(?:continued|continuation|cont\.)(?![a-z])(?!\s+(?:on|overleaf|next|from))")
_BF_RE          = re.compile(r"(?<![a-z])(?:brought\s+forward|b/f)(?![a-z])")
CONTINUATION_TOP_LINES = 12


def is_continuation_page(text: str) -> bool:
    """Does this page DECLARE ITSELF a continuation of the previous one? See the block comment above.
    Pure; never raises; empty/None → False."""
    try:
        low = (text or "").lower()
        if not low.strip():
            return False
        for m in _PAGE_N_OF_N_RE.finditer(low):
            if int(m.group(1)) >= 2:
                return True
        for m in _PAGE_N_RE.finditer(low):
            if int(m.group(1)) >= 2:
                return True
        top = "\n".join([l for l in low.splitlines() if l.strip()][:CONTINUATION_TOP_LINES])
        return bool(_CONT_RE.search(top) or _BF_RE.search(top))
    except Exception:
        return False


# ── KNOWN-SUPPLIER-NAME IDENTITY CHANGE (2026-09-17; gary → Oracle SIGN-OFF-W/COND C1-C9, DARK `segment_known_supplier_change`) ──
# After migs 177/178, 16/95 stack boundaries were still missed: pages whose supplier has NO template for that type — a
# whole non-templated 3-doc stack imports WHOLE and auto-files under page 1's identity (the class the mig-176 belt
# cannot see: a file with no cut has no rewrite to hold). decide_boundary's only template-free leg is
# is_document_start (a recipient marker AND a number/date marker), which never fired on the corpus. The rule:
#   a non-first page whose LETTERHEAD BAND names a KNOWN supplier that differs from EVERY known supplier named in the
#   current document's first-page band, AND that carries a first-page WITNESS (a LABELLED document-number or date
#   marker, or — only when the title arm is armed — a trusted title) → boundary ("known supplier change").
# KNOWN = the install's own identities (learning.getKnownSupplierNames: human confirms >= 3 with the machine vias,
# Learning-Repair-excluded and Quick File rows never counted, plus the frozen template identities), written to a temp
# JSON per pre-pass and threaded as argv (`--known-suppliers-file` + `--known-supplier-change`; the pre-pass spawn
# never carries the DB-bridged env). Guards, each measured on its own control (TESTING/_measure/watch_separate_soak_20260916):
#   • ADMISSION (admit_known_name): >= 2 content tokens, or one token >= 8 letters, after stripping legal suffixes,
#     STOP_WORDS, document-chrome words and non-alphabetic tokens — "PT", "ME", "Chris Docs" never enter.
#   • BAND (known_names_in_band): header_band_lines = the ONE letterhead-band definition (cut BEFORE the counterparty
#     block), cut again at the separator's own recipient markers and at the first ITEM-TABLE header line, and only the
#     first KNOWN_NAME_TOP_LINES non-empty lines count (Oracle C2 position bound). A line — or the line above it —
#     carrying a c/o / care-of / delivered-by / collected-by / via / attn / FAO context never counts; a line carrying
#     a money amount is a line item, never a letterhead. Word-boundary token regex; earliest offset wins, tie → longest.
#   • SAME-SUPPLIER (same_supplier): suffix-stripped token equality OR a token-prefix either way ("Print Tracker" ≡
#     "Print Tracker Ltd"). Suppress-only — it can never cause a false cut; its cost is a miss = today's behaviour.
#   • FIRST-PAGE SET (known_names_on_page): the current document's identity is the SET of every admitted known name in
#     the first KNOWN_SET_MAX_LINES lines of its first page (cut only at the counterparty markers — NO position bound,
#     NO table cut, NO context exclusion: the set is SUPPRESS-ONLY, so widening it can only ever prevent a cut), so an
#     unlabelled recipient printed above the issuer (window-envelope layouts, mutual B2B trading) can never make the
#     issuer's own letterhead on page 2 look like a stranger — measured: Tesseract emits a right-hand issuer block
#     AFTER the item table, so the strict band alone lost the issuer and false-cut page 2 (ctrl5_envelope_*). The cut
#     page's EARLIEST strict-band name is the one tested.
#   • DROPPED + PINNED: "unknown → known" (the current doc named nobody known, this page names one) — a garbled page-1
#     letterhead + a clean page 2 cut a real document into two UNHELD 1-page cuts (2/2 on the blurred-letterhead
#     controls). Only a DIFFERENT admitted name on BOTH sides is asymmetry-safe.
#   • The continuation veto runs AFTER this rule ("Page 2 of 2" + a different known name → no cut, pinned).
# OCR failure direction: a garbled name = no name = today's behaviour; a garbled witness = no cut = today's behaviour.
# Pure (no OCR) except detect_segments' plumbing; pinned in tests/test_segmentation.py §9-§12.
_LEGAL_SUFFIXES = frozenset({"ltd", "limited", "plc", "llc", "inc", "co", "company", "corp", "corporation", "gmbh",
                             "uk", "group", "holdings"})
_DOC_CHROME_WORDS = frozenset({"invoice", "invoices", "order", "orders", "statement", "quote", "quotation", "receipt",
                               "delivery", "note", "notes", "docket", "worksheet", "credit", "purchase", "sales",
                               "document", "documents", "docs", "doc", "test", "sample", "demo", "copy"})
KNOWN_NAME_TOP_LINES = 6
KNOWN_SET_MAX_LINES = 60
# A line (or the line above it) with one of these never names the ISSUER — it names who a delivery is for / via.
_NAME_CONTEXT_RE = re.compile(r"(?<![a-z])(?:c/o|care of|delivered by|collected by|via|attn|f\.a\.o|fao|to:)(?![a-z])")
# An item-table header line ends the letterhead band (>= 2 distinct hits on one line).
_TABLE_HEADER_WORDS = frozenset({"description", "qty", "quantity", "unit", "price", "amount", "net", "vat", "total",
                                 "rate", "hours", "each", "goods"})
_MONEY_RE = re.compile(r"(?<![0-9])\d{1,3}(?:,\d{3})*\.\d{2}(?![0-9])")
# The first-page WITNESS: a LABELLED document-number or date marker (Oracle C1 — never a bare "No." / "Date ").
_WITNESS_NUMBER_MARKERS = _NUMBER_MARKERS + (
    "reference no", "reference number", "ref no", "ref number", "ref:", "our ref", "your ref", "job no", "job number",
    "job sheet no", "quote no", "quote number", "quotation no", "quotation number", "credit note no",
    "credit note number", "delivery note no", "delivery note number", "docket no", "docket number", "ticket no",
    "ticket number", "note no", "note number", "order ref", "invoice ref")
_WITNESS_DATE_MARKERS = _DATE_MARKERS + (
    "date:", "dated", "delivery date", "docket date", "quote date", "job date", "tax point", "date of issue")
# The witness's THIRD arm (Oracle 2026-09-17, accepted as an OR-arm, never a replacement): a RECIPIENT block (the
# separator's own _RECIPIENT_MARKERS — one definition) AND a real DATE SHAPE (dd/mm/yyyy, dd-mm-yyyy, dd.mm.yy,
# d Mon yyyy) — is_document_start's first-page premise with a bare "Date 11/11/2026" (a marker-poor delivery docket:
# no heading, no number, a bare date, "Deliver To"). It sits behind the different-known-name requirement, and the
# false-cut classes the witness exists for (a bare c/o continuation, an item-table mention) carry no recipient block.
_DATE_SHAPE_RE = re.compile(
    r"(?<![0-9])(?:\d{1,2}[/\-.]\d{1,2}[/\-.](?:\d{4}|\d{2})(?![0-9])"
    r"|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+(?:\d{4}|\d{2})(?![0-9]))")


def _name_tokens(name) -> list:
    """Normalised tokens of a supplier name with trailing legal suffixes stripped ("Copperfield Electrical Ltd" →
    ['copperfield', 'electrical']). Pure."""
    from extraction.text_normalise import normalise_for_tokens
    toks = [t for t in re.split(r"[^a-z0-9']+", normalise_for_tokens(name)) if t]
    while toks and toks[-1].strip("'") in _LEGAL_SUFFIXES:
        toks.pop()
    return toks


def _content_tokens(tokens) -> list:
    from extraction.template_matcher import STOP_WORDS
    out = []
    for t in tokens:
        letters = re.sub(r"[^a-z]", "", t)
        if len(letters) >= 2 and letters not in STOP_WORDS and letters not in _DOC_CHROME_WORDS:
            out.append(letters)
    return out


def admit_known_name(name) -> bool:
    """Is this confirmed supplier name SPECIFIC enough to identify an issuer on a page? >= 2 content tokens, or one
    token of >= 8 letters, after the suffix / stop-word / document-chrome / non-alphabetic strip."""
    try:
        c = _content_tokens(_name_tokens(name))
        return len(c) >= 2 or (len(c) == 1 and len(c[0]) >= 8)
    except Exception:
        return False


def prepare_known_suppliers(names) -> list:
    """The admitted known-supplier list as match entries [{name, key, tokens, rx}], longest names first, deduped on
    the suffix-stripped token key. Names that fail admission are dropped. Pure."""
    out, seen = [], set()
    for n in names or []:
        s = str(n or "").strip()
        if not s or not admit_known_name(s):
            continue
        toks = _name_tokens(s)
        key = " ".join(toks)
        if not toks or key in seen:
            continue
        seen.add(key)
        rx = re.compile(r"(?<![a-z0-9])" + r"[^a-z0-9]+".join(re.escape(t) for t in toks) + r"(?![a-z0-9])")
        out.append({"name": s, "key": key, "tokens": toks, "rx": rx})
    out.sort(key=lambda e: -len(e["tokens"]))
    return out


def same_supplier(a, b) -> bool:
    """Suffix-stripped token equality OR a token-prefix either way. Suppress-only in the walk (never causes a cut)."""
    ta, tb = _name_tokens(a), _name_tokens(b)
    if not ta or not tb:
        return False
    n = min(len(ta), len(tb))
    return ta[:n] == tb[:n]


def band_lines(text, top_lines: int = KNOWN_NAME_TOP_LINES) -> list:
    """The first `top_lines` NON-EMPTY letterhead-band lines: header_band_lines (cut before the counterparty block),
    cut again at the separator's own recipient markers and at the first item-table header line."""
    from extraction.template_matcher import header_band_lines
    out = []
    for raw in header_band_lines(text or ""):
        line = raw.strip()
        if not line:
            continue
        low = line.lower()
        if any(m in low for m in _RECIPIENT_MARKERS):
            break
        if len(set(re.findall(r"[a-z]+", low)) & _TABLE_HEADER_WORDS) >= 2:
            break
        out.append(line)
        if len(out) >= top_lines:
            break
    return out


def known_names_in_band(text, known, top_lines: int = KNOWN_NAME_TOP_LINES) -> list:
    """Every admitted known supplier NAMED in the page's letterhead band, earliest first (line, then offset, then
    the longer name). `known` = prepare_known_suppliers(...). [] when nothing is named. Pure."""
    if not known:
        return []
    try:
        from extraction.text_normalise import normalise_for_tokens
        lines = band_lines(text, top_lines)
        found = []
        for i, line in enumerate(lines):
            low = normalise_for_tokens(line)
            prev = normalise_for_tokens(lines[i - 1]) if i else ""
            if _NAME_CONTEXT_RE.search(low) or _NAME_CONTEXT_RE.search(prev) or _MONEY_RE.search(low):
                continue
            for e in known:
                m = e["rx"].search(low)
                if m:
                    found.append((i, m.start(), -len(e["tokens"]), e["key"], e["name"]))
        found.sort()
        names, seen = [], set()
        for _, _, _, key, name in found:
            if key not in seen:
                seen.add(key)
                names.append(name)
        return names
    except Exception:
        return []


def known_names_on_page(text, known, max_lines: int = KNOWN_SET_MAX_LINES) -> list:
    """The WIDE read for the current document's identity SET: every admitted known name anywhere in the first
    `max_lines` lines cut only at the counterparty markers (header_band_lines) — no position bound, no table cut, no
    context or money exclusion. SUPPRESS-ONLY by construction (a name in this set can only ever prevent a cut), so
    every widening is fail-safe; a name it misses = the rule inert for that document = today's behaviour. Pure."""
    if not known:
        return []
    try:
        from extraction.template_matcher import header_band_lines
        from extraction.text_normalise import normalise_for_tokens
        low = normalise_for_tokens(" ".join(header_band_lines(text or "", max_lines)))
        found = []
        for e in known:
            m = e["rx"].search(low)
            if m:
                found.append((m.start(), -len(e["tokens"]), e["key"], e["name"]))
        found.sort()
        names, seen = [], set()
        for _, _, key, name in found:
            if key not in seen:
                seen.add(key)
                names.append(name)
        return names
    except Exception:
        return []


def has_first_page_witness(text, title_trusted: bool = False) -> bool:
    """A LABELLED document-number / date marker anywhere on the page, OR a recipient block plus a real date shape,
    OR (when the title arm is armed and read one) a trusted title. Pure; never raises."""
    try:
        low = (text or "").lower()
        if any(m in low for m in _WITNESS_NUMBER_MARKERS) or any(m in low for m in _WITNESS_DATE_MARKERS):
            return True
        if any(m in low for m in _RECIPIENT_MARKERS) and _DATE_SHAPE_RE.search(low):
            return True
        return bool(title_trusted)
    except Exception:
        return False


def _sig(s) -> tuple:
    """Pad a signal to the 7-tuple (mid, overlap, doc_start, self_cont, names, witness, set_names): a legacy
    4-tuple gets no names / no witness; a 6-tuple's set_names default to its (strict-band) names."""
    s = tuple(s)
    if len(s) >= 7:
        return s[:7]
    if len(s) >= 6:
        return s[:6] + (list(s[4] or []),)
    s = s + ((None,) * (4 - len(s)))
    return s[:4] + ([], False, [])


def walk_boundaries(signals, fp_floor: float = FIRST_PAGE_FP_FLOOR, known_rule: bool = False) -> tuple:
    """The page walk, PURE: per-page signals → (flags, reasons). Page 0 always starts document 1. Tracks the CURRENT
    document's template id (decide_boundary) and, when `known_rule`, the SET of known supplier names on its first
    page (`set_names`, the wide read). Order per page: decide_boundary → the known-supplier-change rule (only when
    no boundary yet, the page's earliest strict-band name matches NONE of the current set, the current set is
    non-empty, and the page carries a first-page witness) → the self-declared-continuation veto (always last).
    `known_rule` False = today's walk."""
    if not signals:
        return [], []
    flags: list[bool] = [True]
    reasons: list[str] = ["document start"]
    s0 = _sig(signals[0])
    current_id = s0[0]
    cur_names = list(s0[6] or [])
    for i in range(1, len(signals)):
        mid, overlap, ds, self_cont, names, witness, set_names = _sig(signals[i])
        boundary = decide_boundary(mid, current_id, overlap, ds, fp_floor)
        if not boundary:
            reason = "continuation"
        elif mid is not None and overlap >= fp_floor and mid == current_id:
            reason = "first-page fingerprint"
        elif mid is not None and mid != current_id:
            reason = "different template"
        else:
            reason = "document-start header"
        if (known_rule and not boundary and names and cur_names and witness
                and not any(same_supplier(names[0], c) for c in cur_names)):
            boundary = True
            reason = "known supplier change"
        if boundary and self_cont:
            boundary = False                      # the page says it is a continuation — never a cut
            reason = "self-declared continuation"
        flags.append(boundary)
        reasons.append(reason)
        if boundary:
            current_id = mid
            cur_names = list(set_names or [])
    return flags, reasons


# ── BOUNDARY CLASS (2026-09-17; gary → Oracle SIGN-OFF-W/COND C1-C12; consumer = the DARK JS belt `segment_pair_hold`) ─
# The walk's REASON is assigned by precedence, not exclusivity: "first-page fingerprint" is stamped whenever the same
# template's fingerprint clears the floor, even when the page ALSO carries a document-start header (every page of the
# owner's real 34-page Print Tracker bundle is an email-header doc-start labelled "first-page fingerprint"). Downstream
# nothing could tell a cut made on the strength of a LETTERHEAD ALONE from a cut backed by first-page evidence — and
# the letterhead-only cut is the S4 silent-truncation class (a headed second sheet with no page marker: page 1
# auto-files as a complete document on a manual import, page 2 orphans; caught live 2026-09-17, e2e3 #1255).
# A boundary is WEAK ("template_only") when it was decided by a TEMPLATE leg with NO document-start on the page:
#   A  the same template's fingerprint (a repeated letterhead);
#   B  no template → a template (page 1 matched nothing at 150 DPI — a blurred letterhead, a poor scan);
#   C  a same-SUPPLIER sibling type switch (Oracle C4: identity = template_matcher._template_identity — the dominant
#      confirmed issuer, else the frozen supplier_name fixed value — NEVER the cosmetic templates.name; '' → strong).
# STRONG = any document-start hit (the email head / the recipient block + a number/date), any known-supplier change,
# a CROSS-supplier template switch (two different suppliers' templates on consecutive pages), a vetoed page (no cut).
# The class is METADATA: the segments are byte-identical; `detect_segments` emits it as the additive `weak_pages` key
# and the JS belt compares the two halves' 200-DPI reads (same supplier + no date + the same/no number → hold both).
# Measured (shipped functions, `weak_cut_census2.py`): the 4 exhibit cuts weak; real_34 0/33 weak; stacks ~22 weak,
# every one reading its own number + date (released by the value check); cross-supplier switches 28 (strong).
WEAK_REASONS = ("first-page fingerprint", "different template")


def template_identity(t) -> str:
    """The identity a pre-pass template ASSERTS — extraction.template_matcher._template_identity (dominant confirmed
    issuer → frozen supplier_name fixed value → ''); never `name`. '' on any error (→ the C arm is False → STRONG)."""
    try:
        from extraction.template_matcher import _template_identity
        return str(_template_identity(t) or "")
    except Exception:
        return ""


def identity_map(templates) -> dict:
    """{template_id: asserted identity} for the pre-pass templates list ('' = unjudgeable)."""
    out = {}
    for t in templates or []:
        tid = (t or {}).get("id") if isinstance(t, dict) else None
        if tid is not None:
            out[tid] = template_identity(t)
    return out


def boundary_class(mid, current_id, overlap: float, doc_start: bool, reason: str,
                   fp_floor: float = FIRST_PAGE_FP_FLOOR, ident_of=None) -> str:
    """'weak' | 'strong' for a page the walk made a BOUNDARY (see the block comment). Pure."""
    if doc_start:
        return "strong"                       # first-page evidence of its own (the real_34 shape)
    if reason not in WEAK_REASONS or mid is None:
        return "strong"                       # known supplier change / document-start header / defensive
    if current_id is None:
        return "weak"                         # B: no template → a template
    if mid == current_id:
        return "weak" if overlap >= fp_floor else "strong"   # A: the repeated-letterhead fingerprint
    a = str((ident_of or {}).get(mid, "") or "")
    b = str((ident_of or {}).get(current_id, "") or "")
    if a and b and same_supplier(a, b):
        return "weak"                         # C: a same-supplier sibling type switch
    return "strong"                           # a cross-supplier switch, or an unjudgeable identity


def boundary_classes(signals, flags, reasons, fp_floor: float = FIRST_PAGE_FP_FLOOR, ident_of=None) -> list:
    """Per-page class: None for page 0 and every non-boundary, else boundary_class(...). Re-tracks the current
    document's template id exactly as walk_boundaries does (current_id = the boundary page's mid). Pure."""
    if not signals:
        return []
    out = [None]
    current_id = _sig(signals[0])[0]
    for i in range(1, len(signals)):
        mid, overlap, ds = _sig(signals[i])[:3]
        if i < len(flags) and flags[i]:
            out.append(boundary_class(mid, current_id, overlap, ds, reasons[i] if i < len(reasons) else "", fp_floor, ident_of))
            current_id = mid
        else:
            out.append(None)
    return out


def decide_boundary(matched_id, current_id, fp_overlap: float, doc_start: bool,
                    fp_floor: float = FIRST_PAGE_FP_FLOOR) -> bool:
    """Whether a (non-first) page starts a NEW document. True when ANY holds:
      (a) FIRST-PAGE SIGNATURE — it matches a known template AND its keyword overlap with
          that template clears the floor (a known layout's opening page);
      (b) IDENTITY CHANGE — it matches a DIFFERENT known template than the current document
          (a new KNOWN doc type starts mid-file);
      (c) GENERIC DOC-START — it carries a new document's header cluster (is_document_start),
          catching a new UNKNOWN-type document with no learned template.
    A continuation page (no match, no header cluster) satisfies none → stays attached, so a
    real multi-page invoice is never split."""
    first_signature = matched_id is not None and fp_overlap >= fp_floor
    identity_change = matched_id is not None and matched_id != current_id
    return bool(first_signature or identity_change or doc_start)


def page_is_first(page_text: str, page_image, templates: list,
                  fp_floor: float = FIRST_PAGE_FP_FLOOR) -> tuple[bool, dict]:
    """Decide whether a single (non-first) page independently looks like a known
    template's FIRST page. Returns (is_first, info). Conservative: requires BOTH a
    template match AND fingerprint overlap ≥ fp_floor, so a logo-only continuation page
    is not mistaken for a new document."""
    from extraction.template_matcher import identify_template, extract_keyword_fingerprint
    match = identify_template(page_image, page_text or "", templates)
    if not match:
        return False, {"reason": "no template match"}
    tmpl = match.get("template") or {}
    overlap = fingerprint_overlap(extract_keyword_fingerprint(page_text or ""),
                                  tmpl.get("keyword_fingerprint"))
    ok = overlap >= fp_floor
    return ok, {
        "reason": "first-page fingerprint" if ok else "logo-only (continuation)",
        "confidence": match.get("confidence"),
        "fp_overlap": round(overlap, 2),
        "template_id": tmpl.get("id"),
    }


# ── TITLE-THREADED page match (2026-09-16; gary → Oracle (A) SIGN-OFF-W/COND, DARK `segment_title_slug`) ──────
# The pre-pass used to call identify_template with THREE args — no `detected_slug` / `title_trusted` — so on a
# same-letterhead supplier the sibling tie-break degenerates to the most-confirmed sibling (identical fingerprints
# → a stable-sort tie), and when that sibling's type reliably prints a heading that is absent here, the
# TYPE-PRESENCE VETO refuses it → `{'template': None, 'type_refused': True}` → the page could never be a boundary
# (every missed boundary in the 2026-09-16 templated stacks). The full pipeline threads the page's OWN title
# (TYPE-PRECEDENCE 2026-07-09); this does the same, as a CASCADE that can never lose today's boundary:
#   1. a TRUSTED heading → identify_template(…, slug, True)   (the `matching` branch picks the right sibling)
#   2. any installed slug  → identify_template(…, slug, False)  (the matching branch needs no trust)
#   3. today's 3-arg call                                        (the fallback on None / any type_refused)
# Measured (4-arm per-page census, probe_4arm_stacks.txt): base 72/95 boundaries → cascade 79/95, 0 lost,
# 0 over-splits; real_34 34/34 and the singles unchanged. `title_ctx is None` (the switch OFF) → the 3-arg
# call exactly as before (byte-identical).
def page_title(text: str, title_ctx=None) -> tuple:
    """The page's own (slug, trusted) via keyword.title_signal — (None, False) when the title arm is OFF or on any
    error. Factored out so detect_segments reads the title ONCE per page (the match cascade + the mig-179 witness)."""
    if not title_ctx:
        return None, False
    try:
        from extraction.keyword import title_signal
        slug, trusted = title_signal(text or "", title_ctx.get("patterns"), title_ctx.get("doc_types"))
        return slug, bool(trusted)
    except Exception:
        return None, False


def page_match(page_image, text: str, templates: list, title_ctx=None, title=None):
    from extraction.template_matcher import identify_template
    if not title_ctx:
        return identify_template(page_image, text or "", templates)
    slug, trusted = title if title is not None else page_title(text, title_ctx)
    m = None
    if slug and trusted:
        m = identify_template(page_image, text or "", templates, slug, True)
    if slug and not (m or {}).get("template"):
        m = identify_template(page_image, text or "", templates, slug, False)
    if not (m or {}).get("template"):
        m = identify_template(page_image, text or "", templates)
    return m


def detect_segments(pdf_path: str, templates: list, tesseract_path: str | None = None,
                    born_digital: bool = True, fp_floor: float = FIRST_PAGE_FP_FLOOR,
                    title_ctx: dict | None = None, continuation_veto: bool = False,
                    known: list | None = None) -> dict:
    """Render each page of `pdf_path`, decide which pages are independent first pages, and
    return {page_count, segments, first_pages, reasons}. A non-PDF, a single-page PDF, no
    templates, or any error → a single whole-document segment (no split).
    `title_ctx` = {'patterns', 'doc_types'} threads the page's own title into the match (DARK
    segment_title_slug); `continuation_veto` suppresses a boundary on a self-declared continuation
    page (DARK segment_continuation_veto); `known` = prepare_known_suppliers(...) arms the
    known-supplier-change rule (DARK segment_known_supplier_change). All default OFF → byte-identical."""
    import os
    result_single = {"page_count": 1, "segments": [[0, 0]], "first_pages": [0], "reasons": ["whole document"]}
    if not templates or not str(pdf_path).lower().endswith(".pdf") or not os.path.isfile(pdf_path):
        return result_single

    try:
        import pypdfium2 as pdfium
    except Exception:
        return result_single

    try:
        doc = pdfium.PdfDocument(str(pdf_path))
        n = len(doc)
    except Exception:
        return result_single
    if n < 2:
        return {"page_count": n or 1, "segments": [[0, max(0, n - 1)]], "first_pages": [0], "reasons": ["single page"]}

    if tesseract_path:
        try:
            import pytesseract
            pytesseract.pytesseract.tesseract_cmd = tesseract_path
        except Exception:
            pass

    from extraction.template_matcher import extract_keyword_fingerprint

    # Per-page signals: (matched template id | None, fingerprint overlap, doc-start flag, self-declared cont.,
    # known supplier names in the band, first-page witness) — the last two only when the mig-179 rule is armed.
    signals: list[tuple] = []
    for i in range(n):
        page = doc[i]
        # Low-DPI render is enough for logo hashing + a fingerprint read, and keeps the
        # pre-pass cheap (this is NOT the extraction OCR — process_docs re-reads each
        # segment at full quality afterwards).
        try:
            img = page.render(scale=150 / 72).to_pil()
        except Exception:
            img = None
        text = _page_text(page, img, born_digital, tesseract_path)
        title = page_title(text, title_ctx) if title_ctx else None
        match = page_match(img, text or "", templates, title_ctx, title)
        tmpl = (match or {}).get("template") or {}
        mid = tmpl.get("id") if match else None
        overlap = fingerprint_overlap(extract_keyword_fingerprint(text or ""),
                                      tmpl.get("keyword_fingerprint")) if match else 0.0
        names = known_names_in_band(text, known) if known else []
        witness = has_first_page_witness(text, bool(title and title[1])) if known else False
        set_names = known_names_on_page(text, known) if known else []
        signals.append((mid, overlap, is_document_start(text),
                        bool(continuation_veto and i > 0 and is_continuation_page(text)), names, witness, set_names))

    # Walk the pages (pure — walk_boundaries), tracking the CURRENT document's identity so a different known
    # type, a generic new-document header, or (armed) a different known supplier starts a fresh segment; a
    # self-declared continuation is never a cut: `if boundary and self_cont:` → `boundary = False`.
    flags, reasons = walk_boundaries(signals, fp_floor, known_rule=bool(known))

    # Boundary CLASS (2026-09-17): which cuts were decided by a template leg ALONE (no document-start on the page) —
    # additive metadata for the JS pair belt (`segment_pair_hold`); the segments above are untouched by it.
    try:
        classes = boundary_classes(signals, flags, reasons, fp_floor, identity_map(templates))
        weak_pages = [i for i, c in enumerate(classes) if c == "weak"]
    except Exception:
        weak_pages = []

    segments = segment_pages(flags)
    return {
        "page_count": n,
        "segments": [[s, e] for (s, e) in segments],
        "first_pages": [i for i, f in enumerate(flags) if f],
        "reasons": reasons,
        "weak_pages": weak_pages,
    }


def _page_text(page, img, born_digital: bool, tesseract_path: str | None) -> str:
    """Per-page text for the fingerprint: the embedded text layer when present (cheap,
    exact — the born-digital case like a Print Tracker batch), else a light OCR when a
    Tesseract path is available, else '' (→ the page can't be a confident boundary)."""
    if born_digital:
        try:
            from ocr import born_digital as _bd
            if _bd.assess_page(page)[0]:
                return _bd.page_text(page)
        except Exception:
            pass
    if tesseract_path and img is not None:
        try:
            import os, pytesseract   # S0 (2026-09-09): timeout backstop; guarded → '' on a hung/aborted read.
            return pytesseract.image_to_string(img, timeout=int(os.environ.get('OCR_CALL_TIMEOUT') or 120))
        except Exception:
            return ""
    return ""
