# Herald — Document-TYPE detection reference

> Standing reference for **herald** (the document-type & heading specialist). Written 2026-07-26 from a
> full code read + a rendered/OCR'd forensic of the live Northgate Textiles type-flip. It maps the
> type-detection machinery, catalogues each failure mode with **rendered evidence** (not logs),
> separates **verified FACT** from assessment, lists the **discrepancies** a future dev would otherwise
> trip on, states each guard's **fail-safe posture (intended vs actual)**, and defines what a permanent
> fix must cover so the creed holds: *a legible title reliably determines the type; the only thing that
> may block type detection is a genuinely illegible scan.*
>
> **Hard rule for anyone using this doc:** render and read the title band before citing a type score.
> All probe scripts + rendered bands referenced here live in the session scratchpad (see §10).

---

## 0. The one-paragraph model

Type detection is **four axes fused at Stage 0**. (1) **READ** the printed title from the page; (2)
**CLASSIFY** the read text against the closed type vocabulary; (3) when identity resolves a supplier
that issues several types on one letterhead, **TIE-BREAK** which sibling template; (4) a set of
**GUARDS/HOLDS** that are supposed to send an unresolved type to review instead of auto-filing a guess.
A legible title makes axis 1→2 decisive and axes 3→4 irrelevant. **Every type mis-detection is an
axis-1 read failure that then exposes an axis-3 weakness**, with axis 4 either catching it (HOLD) or
mis-firing on a correct doc (the mirror symptom). In Scan Finder today axis 2 is **sound**; axis 1 has
**no recovery path for a garbled or single-word letter-spaced heading**; axis 3 can fail toward a
**confident wrong type**; axis 4 both **misses** the real mis-type and **over-holds** correct docs.
**Crucially, axes 3–4 apply ONLY when a logo/template exists.** Much of the real corpus is **born-digital
and logoless** (SuperStore-style), where the type is the pure title+text call (axes 1–2 only) — and that
path is **sound today** for a legible title in the vocabulary (§2A). Skew is the DEMO trigger, not the
general problem; the general axis-1 lever is fuzzy-to-vocabulary.

---

## 1. Machinery map (file:line)

### Axis 1 — title READING  (`python_backend/extraction/keyword.py`, `python_backend/ocr/`)
| Piece | Location | What it does |
|---|---|---|
| `detect_document_type(ocr_text, patterns, known_types, type_aliases)` | `keyword.py:538-699` | Scans every line, scores `document_type_keywords` buckets + folded-in type NAMEs/aliases. |
| `_despaced_heading(seg0, phrase_lc)` | `keyword.py:508-535` | **The only skew/letter-spacing recovery in the classifier.** Collapses ALL spaces in the leftmost column segment and requires **EXACT** equality to the (de-spaced) phrase. Recovers `"PU RC HASE ORDER"→"purchaseorder"`. **Multi-word only; ≥5 chars (`_MIN_DESPACE_LEN`).** |
| `_segment_is_heading` / `_line_is_heading_like` | `keyword.py:447-489` | Is a reading-line column segment the title (+ code/caption token) vs a body mention. |
| Top-band gate `_HEADING_TOP_BAND_LINES=15`, `_HEADING_TOP_BAND_FRAC=0.28` | `keyword.py:499-500` | Where a title may sit (generous, for low titles under tall letterheads). |
| Despaced fire site + `HEADING_LETTER_SPACING` kill switch | `keyword.py:569, 620-631, 655-659` | Fires ONLY when the regex matched nothing, for a name/alias phrase, in the top band. |
| `recover_type_detection` / `recover_heading_band` / `has_red_banner` | `ocr/heading_reread.py:137-156 / 96-134 / 81-93` | **RED-channel** banner re-read (built for a red "WORKSHEET"). Re-reads the top band from `clip(R-max(G,B))`, feeds the SAME exact-alias matcher. **Does NOT deskew. Inert on a non-red heading** (C1 redness pre-gate). |
| `BANNER_HEADING_REREAD` gating | `process_docs.py:542-572` | Runs the red re-read only when the main pass produced no trusted heading, on an `ocr`-provenance page 0. |
| `ocr/orientation.py` (OSD 90/180/270) | module | Auto-rotate handles **coarse** orientation only. **No small-skew (±1–3°) deskew exists anywhere in the type path.** |

### Axis 2 — CLASSIFICATION
| Piece | Location |
|---|---|
| position weight `max(1.0, 3.0-4.0*(i/total))` · heading weight `×2.0` | `keyword.py:635, 665` |
| `confidence = min(95, 60 + int(best_score*5))` | `keyword.py:688` |
| `heading` exposed signal (title-precedence) | `keyword.py:666-698` |
| `title_trusted = heading AND type_conf >= 70` | `process_docs.py:637` (consumed at `template_matcher.py:224`) |
| `engine.detect_document_type` (thin delegate) | `engine.py:1677-1680` |

### Axis 3 — same-logo sibling TIE-BREAK  (`python_backend/extraction/template_matcher.py`)
| Piece | Location | What it does |
|---|---|---|
| `identify_template(..., detected_slug, title_trusted)` | `template_matcher.py:222-543` | Stage-0 template match. |
| Logo-cluster tie-break | `:346-363` | Prefer the sibling whose `document_type_slug == detected_slug` (`logo+slug`); else keyword-ratio tie (`logo+keywords`); else closest logo. |
| Same-type keyword RESCUE | `:490-517` | When title trusted + a same-type template's fingerprint overlaps ≥`RESCUE_KEYWORD_OVERLAP` → `keywords+slug_rescue`. |
| `_match_by_keywords(ocr, templates, detected_slug)` | `:863-927` | Logoless fallback: `score = hits/len(fingerprint)`, `detected_slug` breaks an **exact** tie. |
| `_kw_type_ambiguity` | `:821-859` | Flags a same-supplier coin-flip **only on an EXACT top-score tie** across ≥2 slugs. |
| `detected_slug`/`title_trusted` threading + `DETECTED_SLUG_FALLBACK` | `process_docs.py:609-637` | Derives a slug for an uninstalled detected type so the refuse re-arms. |

### Axis 4 — GUARDS / HOLDS  (`python_backend/extraction/engine.py` + `template_matcher.py`)
| Guard | Location | Fires when |
|---|---|---|
| Logo-path ambiguity `_type_ambiguity` (wider `_AMBIG_LOGO_BAND`) | `template_matcher.py:131-142` | ≥2 distinct slugs in the jitter-immune logo band AND no trusted title → `ambiguous_type`. |
| Trusted-title REFUSE `_type_refuse` | `:366-379, 207-219`; keyword arm `:524-526`; re-emit `:540-541` | A trusted title names a type the matched sibling lacks → sentinel `type_refused`. Kill `TYPE_REFUSE_HOLD`. |
| Engine reads refuse/ambiguity | `engine.py:2755-2764, 2790-2800` | Collapses refuse to "no template" + remembers it. |
| `_flag_type_ambiguity` + `TYPE_AMBIGUITY_GUARD` / refuse note | `engine.py:4836-4859, 4939-4969` | Lands a **persisted `validation_note`** on a guaranteed field (blocks auto-file via trust.js `flagged`). |
| Veto-fallthrough G1 corroboration (adjacent, not a type guard) | `engine.py:4861-4892` | An identity-veto fall-through match's critical field is uncorroborated → note. |

---

## 2. The live case — Northgate Textiles (ground truth, rendered + OCR'd)

> **Scope caveat (READ FIRST — see §2A).** Northgate is a **DEMO doc**: its ~1.6–2.6° skew is
> **deliberately exaggerated** and it has a **logo + same-logo siblings**, so it exercises axes 1/3/4
> hardest. **Real-world docs skew far less, take many layouts, and many have NO logo** (born-digital
> SuperStore-style). Do NOT read the skew emphasis below as the general problem — the general axis-1
> lever is **fuzzy-to-closed-vocabulary** (skew-agnostic), and the whole axis-3 story below applies
> ONLY when a logo/template exists. §2A grounds the real-world spread.

**Setup (FACT, live DB `%APPDATA%\ScanFinder\docusnap.db`).** One supplier ("NT" logo), three sibling
templates sharing the letterhead: **id25 invoice, id26 delivery_note, id30 purchase_order**. Installed
types: Delivery Note, Invoice, Purchase Order, Sales Order, Service Worksheet (alias "Worksheet"); the
Order-family types have **no** `title_aliases`.

### 2.1 What the page actually shows (I rendered the title bands — §10 `band_675/673/670.png`)
All three POs print a **crystal-clear, large, bold navy "PURCHASE ORDER"** standing alone under the
letterhead, page skewed **~1.6–2.0°** up-right, with `Order No. PO-…`, `Order Date …`, and
`Supplier: <other party>` (buyer-issued polarity). A human reads the type instantly. **670 (typed
correctly) is no less skewed than 675 (typed wrong)** — skew *angle* is not the discriminator.

### 2.2 Live fresh-detection trace (FACT — `northgate_trace.js`, real `process_docs`)
| id | file | body-keyword detect | template arm | FINAL type | conf | review |
|----|------|--------|--------|--------|------|--------|
| 675 PO_01 | garble | **Sales Order 65%** (untrusted) | **Invoice 100% via keywords** | **Invoice ✗** | 41 | held |
| 673 PO_03 | garble | **Delivery Note 70%** (untrusted) | **Invoice 100% via keywords** | **Invoice ✗** | 41 | held |
| 674 PO_04 | garble | **Delivery Note 70%** (untrusted) | **Invoice 100% via keywords** | **Invoice ✗** | 41 | held |
| 670 PO_06 | clean | **Purchase Order 95%** (TRUSTED) | **logo+slug 64%** | **Purchase Order ✓** | 100 | no |
| 667 PO_02 | clean | **Purchase Order 95%** (TRUSTED) | keywords+slug_rescue 60% | **Purchase Order ✓** | 62 | held |
| 685 PO_11 | clean | **Purchase Order 95%** (TRUSTED) | keywords+slug_rescue 60% | **Purchase Order ✓** | 100 | no |

### 2.3 Axis-1 reads — RAW vs DESKEW (FACT — `title_forensic.py` PSM6 band, `herald_forensic.py` pipeline OCR)
| id | RAW isolated-band OCR | de-spaced → `purchaseorder`? | band deskew recovery |
|----|----|----|----|
| 675 | `PU RC **fa** ASE ORDER` (H→"fa", char corruption) | **False** (`purcfaaseorder`) | **+1.6° → `PURCHASE ORDER` ✓** |
| 673 | `Pe U RC H AS **io** O RD E R` (heavy frag + garble) | **False** | coarse sweep **did not** recover (needs finer angle / full recipe) |
| 670 | `PU RC HASE ORDER` (clean letters, spacing only) | **True** (`purchaseorder`) | +2.0° → clean (already recoverable) |
| 667/685 | `PURCHASE ORDER` (clean) | True | n/a |

Pipeline geometry-OCR (`reconstruct_page_text`, what the classifier actually consumes): for 675/673/674
`Purchase Order` scores **1.0, heading=False, TRUSTED=False**; for 670/667/685 it scores **10–11,
heading=True, TRUSTED=True**.

### 2.4 Axis-2 isolation — feed the CORRECT title to the REAL classifier (FACT — `herald_forensic.py`)
For **every** mis-typed doc, `detect_document_type("PURCHASE ORDER\n"+real_body, ...)` returns
**type=Purchase Order, conf=95, heading=True, TRUSTED=True** (Purchase Order score jumps **1.0 → 13.0**).
**Given the right title text, classification is correct and trusted, 3/3. Axis 2 is sound; the failure is
entirely axis-1 reading.**

### 2.5 Why the mis-type direction is always → Invoice (FACT — `fingerprints_and_red.py`)
Sibling fingerprints are **NOT identical**:
- **id25 invoice — 6 words, PURE LETTERHEAD:** `Mill, Northgate, Preston, Textiles, Way, Weavers` (no type/distinctive content).
- id26 delivery_note — 9 words: + `DELIVERY, DOCKET, Note`.
- id30 purchase_order — 10 words: + `Bluefin, Marine, PURCHASE, Supplier` (**"Bluefin"/"Marine" = a customer name leaked into the branding fingerprint**).

On ANY Northgate page the pure-letterhead invoice fingerprint scores a perfect **1.0** and **wins
outright**; the PO/delivery fingerprints carry words absent from the page and score < 1.0. So the tie-break
is **not a coin-flip** — it is a **deterministic bias toward the sibling whose fingerprint is the most
generic**, and because there is no exact score *tie*, `_kw_type_ambiguity` **never fires**.

### 2.6 Axis-4 firing on correctly-typed POs (FACT — persisted `validation_note`s)
| id | typed | persisted note | guard |
|----|----|----|----|
| 673 | purchase_order | "heading names a type that doesn't match this supplier's saved layout" | trusted-title **REFUSE** (mirror symptom) |
| 685 | purchase_order | (same) | trusted-title **REFUSE** (mirror symptom) |
| 674 | purchase_order | "Document type changed from 'Invoice' to 'Purchase Order' on reprocess" | reprocess override (recovery worked, still flags) |
| 667 | purchase_order | "This reference couldn't be confirmed anywhere else on the page" | veto-fallthrough **G1** (adjacent guard) |
| 669 | purchase_order | (same) | veto-fallthrough **G1** |
| 675 | invoice | caption note on `invoice_date` (conf 69) | taught-ownership caption (NOT a type guard) |

**9 of 20 Northgate POs sit in `needs_review`** — 8 correctly-typed-but-held + 1 genuinely mis-typed.
The review friction is real and spread across three different guards.

---

## 2A. Scope & generalisation — demo vs real, no-logo & born-digital (FACT — `real_docs_probe.py`, `nol0go_edges.py`)

Northgate is one demo point. A permanent fix must generalise across the axes below. Evidence: a
rendered/read + classified spread of real `C:\Users\cmccu\Desktop\ScannedDocs`.

### 2A.1 Demo skew is exaggerated — don't over-fit to it
Owner: the Northgate/Copperfield corpus skew (~1.6–2.6°) is **deliberately worse than real scans**. So
the skew-band deskew (§2.3) is **scanned-support only** and must NOT be tuned to ±2° or to a letterhead
geometry. The **skew-agnostic** lever is fuzzy-to-closed-vocabulary: it recovers a garbled title however
the garble arose (skew, noise, tracking, JPEG). Treat "rotate ±2°" as a demo-doc hack.

**Confirmed on a REAL scanned doc (FACT).** `City Office NI` — a genuine Belfast managed-print invoice
(`Invoicefhfhghh…152573.pdf`, **image-only / NOT born-digital**, so it goes through OCR) — has a large,
clean, left-aligned **"Invoice"** title at essentially **minimal skew**; `reconstruct_page_text` →
`detect_document_type` reads it cleanly and types **Invoice 95, heading=True, TRUSTED, with NO template**.
A real scanned invoice reads its own title fine — the Northgate garble is the **exaggerated-skew
artefact**, not the real-world norm. *(NB the `fhfhghh@@££^%!` garble is in the FILENAME only; the printed
title is clean — these are NOT garbled-title test docs.)*

### 2A.2 Most real docs are BORN-DIGITAL and LOGOLESS — and today they type correctly
`ScannedDocs` has both kinds: a **born-digital** family (`ocr/born_digital.py` reads the PDF text layer,
no OCR) — SuperStore invoices (2012, ~15 KB), Anconia Corp, Cloud VPS, Contoso Asia, Profile
Construction/ACME (2026) — and an **image-only/scanned** family (the large "fhfhghh…" / City Office docs,
§2A.1). Every **born-digital** doc I sampled **types Invoice, conf 95, heading=True, TRUSTED — with NO
logo and NO template**, because `detect_document_type` scans **every line** (not a fixed band) and the
clean text
layer gives an exact "INVOICE" match. This is the **axes-1+2-only path** and it is **SOUND** for a clean
title in the vocabulary. Layout is genuinely varied and the title is NOT always top-left: **SuperStore's
"INVOICE" is top-RIGHT**, Profile's is in a top-right grey box, Cloud VPS/Contoso sit mid-header. A fixed
"top-left title band" would miss most of them — the whole-line scan is what makes it layout-agnostic.

### 2A.3 Axis 3/4 DO NOT APPLY to a logoless, template-less doc — but a template match is not logo-gated
For a fresh logoless born-digital doc, `identify_template` finds no logo cluster → the type is the pure
detection (axes 1+2), and the same-logo tie-break / refuse guards never run. **BUT** `_match_by_keywords`
(`template_matcher.py:863`) can match a logoless doc to an existing template by keyword **fingerprint**
alone — so the axis-3 generic-fingerprint hole (§2.5: a pure-letterhead fingerprint scoring 1.0) **can
fire without any logo**. Therefore any axis-3/4 defense must be **template-PATH-scoped (logo OR keyword),
never logo-gated, and must never assume a logo/template exists.**

### 2A.4 Where the no-logo / born-digital path is SOFT (verified edges, `nol0go_edges.py`)
| Title input | Result | Assessment |
|---|---|---|
| `INVOICE` / `TAX INVOICE` / `VAT INVOICE` / `Sales Invoice` | Invoice, TRUSTED ✓ | shipped buckets cover common qualifiers |
| `PURCHASE ORDER` (born-digital, clean) | Purchase Order, TRUSTED ✓ | title-first works |
| `CREDIT NOTE` / `REMITTANCE ADVICE` / `RECEIPT` (types **not installed**) | detected as that type, TRUSTED, then held (no installed type/template) ✓ | correct fail-safe → "Add '<type>'" |
| **`I N V O I C E`** / `INV OICE` (single-word letter-spaced/split) | **heading=False, untrusted** | **GAP: `_despaced_heading` is MULTI-WORD only (`keyword.py:524`)** — a tracked single-word title has no recovery |
| `Proforma Invoice` / `COMMERCIAL INVOICE` (uncommon qualifier) | Invoice, **untrusted** | still types on the no-logo path; loses title-trust |
| `STATEMENT` / `QUOTATION` (no bucket + not installed) | mis-suggested **Invoice conf 66** (held) | soft: suggests wrong type instead of clean "unknown" |
| supplier+title on one line, **no** column gap (`SuperStore INVOICE`) | untrusted | with a column gap (`ACME    INVOICE`) → trusted ✓ (born-digital emits the gap) |

**Net:** the born-digital/no-logo happy path is sound; the real generalisation targets are (a) **single-word
letter-spaced titles** (multi-word-only recovery), (b) **uncommon qualifiers**, and (c) cleaner
**HOLD-as-unknown** when no title is in the closed vocabulary — all **axis-1/2, logo-independent**.

---

## 3. Per-axis verdict (with the isolating experiment)

- **Axis 1 — title READING: BROKEN whenever the title read is garbled or letter-spaced.** Isolating
  experiment: §2.3 — raw band OCR corrupts a glyph (`PU RC fa ASE ORDER`); `_despaced_heading`'s
  **exact** equality (`keyword.py:535`) rejects it; the only recovery module (`heading_reread`) is
  **red-only** and empirically inert here (`has_red_banner=False`, §2.5). **Skew is only the DEMO
  trigger** (§2A.1) — the general failure is *any* garble, and a **single-word letter-spaced** title
  fails even with NO skew and clean born-digital text (§2A.4, `keyword.py:524` multi-word-only). Deskew
  can recover the demo case (675 at +1.6°) but no deskew exists in the pipeline and it is not the general
  fix. **This is the root axis; the general lever is fuzzy-to-vocabulary (§7 Lever 1).**
- **Axis 2 — CLASSIFICATION: SOUND.** Isolating experiment: §2.4 — correct title → PO, trusted, 3/3.
  A legible banner is never outvoted by body captions (heading weight ×2.0). Nothing to fix here.
- **Axis 3 — TIE-BREAK: UNSAFE (fails toward a confident wrong type).** Isolating experiment: §2.5 —
  the pure-letterhead invoice fingerprint wins 1.0 deterministically; the intended HOLD-on-ambiguity is
  defeated because it needs an exact tie. Direction is systematically → Invoice.
- **Axis 4 — GUARDS: MISS the mis-type + OVER-HOLD correct docs.** Isolating experiment: §2.6 — the
  genuine mis-type (675) triggers **no** type guard (saved only by incidental conf 41), while correct
  POs (673/685) are held by the REFUSE guard. The REFUSE guard's false-positive rate is a **direct
  readout of axis-1+axis-3 unreliability**, exactly as the method predicts.

---

## 4. Known failure modes (catalogue)

1. **Skew-garbled dark title → lost heading → wrong type (THE case).** Char corruption defeats
   `_despaced_heading` exact match; no deskew/fuzzy recovery; classifier falls to body keywords; the
   pure-letterhead sibling wins. Evidence: §2.
2. **Pure-letterhead / generic sibling fingerprint = a universal 1.0 matcher.** Any sibling whose
   fingerprint carries no type-distinctive content matches every page of the letterhead at score 1.0 and
   wins outright, bypassing the exact-tie ambiguity guard. Evidence: §2.5.
3. **Customer-word poisoning of a fingerprint** (id30 "Bluefin/Marine") narrows the *correct* template's
   match so it can't win even on a genuine doc of its own type. Evidence: §2.5.
4. **Mirror symptom — REFUSE guard over-fires on a CORRECT PO** when the right sibling isn't in the logo
   cluster and the rescue arm can't re-find it. Evidence: 673/685 (§2.6).
5. **Path-dependent, non-reproducible type** — the same image types **Invoice** on fresh import but
   persisted as **purchase_order** via a reprocess/override path (674's note). Type resolution is not a
   pure function of the image. Evidence: §2.2 vs the DB state.
6. **Red-channel recovery is scoped out of the dark-heading class** — the one recovery module can't touch
   navy/black titles. Evidence: §2.5 (`has_red_banner=False`).
7. **`_despaced_heading` is multi-word + ≥5-char only** (`keyword.py:524-528`) — a single-word
   letter-spaced title ("IN VO ICE") has no recovery even without a garble (documented deferred gap).

---

## 5. DISCREPANCIES (what would mislead a future dev)

- **D1 — the task/memory framing "same-logo siblings have IDENTICAL fingerprints → coin-flip" is
  INCOMPLETE.** (`project_type_resolution_siblings`, `_type_ambiguity`/`_kw_type_ambiguity` docstrings,
  the `TYPE_AMBIGUITY_GUARD` comment at `engine.py:4836-4844`.) Northgate's fingerprints are **6 vs 9 vs
  10 words** (§2.5). The real failure is a **deterministic** win by the most-generic (pure-letterhead)
  sibling, which the exact-tie guard is structurally blind to. Any fix that only handles "identical
  fingerprints" will not cover this.
- **D2 — the task premise "675/673/674 are typed Invoice" is partly STALE.** Live DB: only **675** is
  invoice; 673/674 persist as **purchase_order (needs_review)**. But **fresh detection re-types all three
  as Invoice** (§2.2). The persisted PO state came from a reprocess/override (674's note) and is **not
  reproducible by fresh detection** — see failure mode 5. Cite the fresh trace, not the DB row.
- **D3 — `heading_reread.py` presents as "the heading recovery" but is red-only + non-deskewing.** Its
  module docstring and `BANNER_HEADING_REREAD` comment (`process_docs.py:542-555`) read as a general
  heading rescue; empirically it is inert on this whole class (§2.5). Not dead code — correct for red
  banners — but it is **not** a skew/dark-title recovery and must not be assumed to cover one.
- **D4 — no small-skew deskew exists in the type path.** `orientation.py` is OSD 90/180/270 only.
  `project_detect_deskew_parked` parked deskew as "not fail-safe" — but that reasoning was about **field
  re-reads corrupting values**; it does **not** preclude a **suggestion-only title-band** deskew (which
  never writes a field). Don't let the parked note foreclose the title fix.
- **D5 — `_despaced_heading` exact-equality is called "load-bearing against false positives"
  (`keyword.py:512-516`).** True for the FP surface, but it is also the exact reason a single garbled
  glyph blocks recovery, and there is **no fuzzy fallback**. The comment is correct but hides the recall
  gap — the fix is to *add* fuzzy-to-closed-vocabulary, not to loosen the exact test.
- **D6 — deskew is not a complete axis-1 fix by itself.** Coarse band deskew recovered 675 (+1.6°) but
  **not** 673 (§2.3). A robust fix needs the full band recipe **and/or** fuzzy-to-vocabulary; don't ship
  "rotate a few degrees" and call it done.
- **Kill-switch states (as read):** `HEADING_LETTER_SPACING`=ON, `HEADING_SCORE_COLUMN_AWARE`=ON,
  `BANNER_HEADING_REREAD`=ON, `TYPE_AMBIGUITY_GUARD`=ON, `TYPE_REFUSE_HOLD`=ON, `LOGO_REFUSE_FALLTHROUGH`=ON,
  `DETECTED_SLUG_FALLBACK`=ON, `TEMPLATE_VETO_FALLTHROUGH`=ON (default flipped 2026-07-26). All defaults;
  OFF ⇒ byte-identical per each site's contract.

---

## 6. Fail-safe posture — intended vs actual

| Guard | Intended | Actual on Northgate |
|---|---|---|
| Axis-1 recovery (`_despaced_heading`, red re-read) | Recover the printed title | ✗ No path for dark skew-garble; recovers only clean-spacing / red |
| Axis-2 classifier | Legible title dominates body | ✓ Holds (proven §2.4) |
| Axis-3 keyword tie-break | Prefer detected-type sibling, else HOLD | ✗ Generic sibling wins **1.0**; no tie ⇒ no HOLD ⇒ **confident wrong type** |
| `_kw_type_ambiguity` | HOLD a same-supplier coin-flip | ✗ Requires exact tie ⇒ blind to the subset-fingerprint case |
| Trusted-title REFUSE | HOLD when title ≠ saved layout | ~ Fails safe (HOLD) but **over-fires** on correct POs (mirror) |
| Logo-path `_type_ambiguity` | HOLD ambiguous logo cluster | ~ Correct, but only on the **logo** arm; didn't engage for the keyword-arm mis-type |

**Net:** the only reason 675 doesn't silently misfile as Invoice is its incidental low field-confidence
(41). A skew-garbled Northgate PO whose fields happen to read cleanly would **auto-file as Invoice with
no type guard firing.** That violates *fail-toward-hold* and is the priority to close.

---

## 7. Fix landscape (generalised — what a permanent fix must cover)

Design order reflects the scope correction (§2A): the **general, input-agnostic** lever first; the
scanned-only support second; the logo/template-path defenses third. The bar (owner): *only a genuinely
poor scan may block type detection — not skew, not layout, not a missing logo.*

**Lever 1 (PRIMARY, general, input-agnostic) — fuzzy match the read title to the CLOSED vocabulary.**
After collapsing intra-word spacing, match the top-band read against the tiny known set {type names ∪
aliases} by edit-distance / token-overlap instead of demanding **exact** equality (`_despaced_heading`
`keyword.py:535`; `_segment_is_heading` `:447`). Skew-**agnostic**: recovers a garble however it arose —
`purcfaaseorder`→`purchaseorder` (skew, §2.3) AND `i n v o i c e`→`invoice` (born-digital tracking,
§2A.4). **Must also cover SINGLE-WORD titles** (drop the multi-word-only guard `keyword.py:524` for the
fuzzy arm — the born-digital "I N V O I C E" gap). No rendering; works on scanned AND born-digital text.
*Seam it relies on:* the closed set stays tiny (fuzzy is safe only there). *Must not disable:* keep the
exact test as-is and **ADD** the fuzzy arm beside it (preserves the D5 false-positive guarantee for the
non-garbled path); scope to the top band + name/alias phrases; require a tight edit threshold so an
adjacent vocab word can't cross-match ("credit note" vs "delivery note"). *Does NOT cover:* a title that
is a **synonym outside the vocabulary** (e.g. an uninstalled "Statement") — that must HOLD-as-unknown
(Lever 4), not fuzz to the nearest installed type.

**Lever 2 (SCANNED-support only) — a layout-agnostic title re-read for a genuinely garbled scan.**
Generalise `heading_reread.recover_type_detection` beyond the red channel: find the visually-dominant
heading by **geometry on ANY layout** — the tallest non-logo word cluster in the top region, wherever it
sits (**top-left, top-right like SuperStore, or a boxed header like Profile**) — NOT a fixed
band/letterhead offset; estimate the band's **own** small skew (numpy projection-profile variance first —
it recovered the live case at +1.6°; `scikit-image`/OSD only if a fix demonstrably needs finer angle,
degrade gracefully); upscale + binarise; OCR at **PSM 7/8/11**; **VOTE** and feed Lever 1. *Must not:* be
tuned to ±2° or the Northgate geometry (§2A.1); assume a logo/letterhead exists; or run on born-digital
(clean text already). *Does NOT cover:* a torn/faded/sub-threshold title — that HOLDs (correct).

**Lever 3 (LOGO/TEMPLATE-PATH ONLY, defense-in-depth) — HOLD a template match that carries no
type-distinctive evidence.** Applies **only when a template matched** (logo cluster OR keyword
fingerprint — §2A.3, NOT logo-gated). When the winning sibling's fingerprint carries **no type-distinctive
content** (pure letterhead, or a strict subset of a sibling's) and no trusted title resolves the type,
treat it as **ambiguous → HOLD**, WITHOUT requiring an exact score tie (`_kw_type_ambiguity`
`template_matcher.py:840-859`; the logo-path `_type_ambiguity` `:131`). Closes the silent-misfile hole
(§2.5) on both the logo and the logoless-keyword path. *Must not:* fire on a logoless doc with **no**
template (there is nothing to be ambiguous about — it is the pure axes-1+2 call). Support: **fingerprint
hygiene** (strip leaked customer words like "Bluefin/Marine" from id30 — the `FINGERPRINT_HYGIENE` intent,
evidently not applied) so the correct template can win; **buyer-issued polarity** ("Supplier: <other
party>" ⇒ buyer-issued ⇒ PO/not-invoice) as corroboration when the title is weak (mind the existing
buyer-issued issuer guard; don't add supplier/vendor to recipient markers type-blind).

**Lever 4 (no-logo/born-digital robustness) — a legible title must type on text alone, else HOLD clean.**
Keep the type call **logo-independent** (it already is via the whole-line scan — §2A.2; don't regress it
by adding a band restriction). When **no** title matches the closed vocabulary (even fuzzily), prefer a
clean **"unknown → review/Add type"** hold over suggesting the incidental-body winner (§2A.4 Statement→
Invoice@66). *Does NOT cover:* inventing a type that isn't configured — an uninstalled detected type
stays a one-click "Add '<type>'" (correct fail-safe).

**Overall fail-safe (non-negotiable).** Every lever fails toward **held/untyped**, never a confident wrong
type. The title read is **suggestion-only and never writes a field value**, so
`project_detect_deskew_parked` (deskew corrupting a *field* re-read) does not apply to Lever 2. The
current keyword-arm path (§3 axis-3) is the one place that fails toward a *confident wrong type* today —
Lever 3 is what closes it.

---

## 8. Contrastive quick-reference (mis-typed vs correct sibling)

| | 675 PO_01 (✗ Invoice) | 670 PO_06 (✓ PO) |
|---|---|---|
| Printed title (eye) | PURCHASE ORDER, clear, ~1.6° skew | PURCHASE ORDER, clear, ~2.0° skew |
| Raw band OCR | `PU RC **fa** ASE ORDER` | `PU RC HASE ORDER` |
| De-spaced == target? | **No** (`purcfaaseorder`) | **Yes** (`purchaseorder`) |
| Pipeline PO score / heading | 1.0 / False / untrusted | 10.6 / True / trusted |
| Correct-title control (§2.4) | PO 95 trusted | PO 95 trusted |
| Template arm | Invoice via keywords (1.0) | logo+slug |
| Outcome | **Invoice, conf 41, held** | **Purchase Order, conf 100, filed** |

**The entire delta is one garbled glyph in the title.** That is the axis-1 fix target.

---

## 9. What herald still needs (standing requests)

Two harnesses are now **assigned to me** (skill update 2026-07-26); I will author them on first fix-gating
use. No new dependency — pypdfium2 BSD-3, Pillow HPND, numpy BSD-3, pytesseract Apache-2.0 + Tesseract 5
are all bundled. Pieces already built this run: `herald_forensic.py`, `title_forensic.py`,
`real_docs_probe.py`, `nol0go_edges.py`.

- **Title-band recovery matrix** (fold the above into one probe): doc id → geometry band isolate (any
  layout) → {raw, deskew-sweep, upscale, binarise, PSM 6/7/8/11} → de-space → **fuzzy-to-vocabulary** →
  doc×recipe recovery matrix + per-type score table. Gates any axis-1 fix contrastively (mis-typed vs
  correct sibling) AND must cover born-digital single-word letter-spacing (§2A.4).
- **Corpus-wide type-outcome enumerator** (read-only `?mode=ro`): per confirmed doc — detected type +
  conf + heading-trusted, template arm, which guard (if any) held it, mis-type direction. The FIX GATE:
  measure corpus-wide false-hold and silent-misfile rates BEFORE/after any change. Northgate alone shows
  guards firing on 9/20; I want the whole-corpus number, **including the logoless born-digital docs**.
- **Reprocess-vs-fresh check** (needs the app write path → flag for the owner/main session, not read-only):
  reprocess 674 through the real reprocess IPC (stored slug `invoice`) and compare `title_trusted_fresh`
  to the fresh-import trace, to settle failure mode 5 / D2 (path-dependent type).
- **`scikit-image` (BSD-3, free-for-commercial) as an OPTIONAL accelerator** for finer projection-profile
  / Hough deskew of the title band — admitted via the license gate ONLY if a fix demonstrably needs it,
  and must degrade gracefully to the numpy variance sweep (numpy FIRST — it recovered the live case at
  +1.6°). Never a mandatory backend dep; **no OpenCV/`cv2` hard dep, no PyMuPDF/`fitz` (AGPL)**.
- **Owner ground-truth (cheap for them, expensive to infer):** (a) confirmed — the demo skew is
  exaggerated (baked into §2A); (b) is the "doc solutions" supplier among `ScannedDocs` (I could not
  positively identify it on disk), and what did it type wrong; (c) do real suppliers use single-word
  letter-spaced/design titles often enough to prioritise that gap.

---

## 10. Reproduce (session scratchpad)
`C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\d98fd8d9-2205-4809-869e-b19b48b76165\scratchpad\`
- `band_675.png` / `band_673.png` / `band_670.png` — rendered title bands (render-and-read first).
- `title_forensic.py` — isolated-band raw + deskew-sweep OCR (§2.3).
- `herald_forensic.py` — pipeline `reconstruct_page_text` raw/deskew + **axis-2 isolation** (§2.3–2.4).
- `fingerprints_and_red.py` — sibling-fingerprint identity + red-channel inertness (§2.5).
- `real_docs_probe.py` — real `ScannedDocs` spread: born-digital detection + no-logo classification + rendered `real_*.png` bands (§2A.2).
- `nol0go_edges.py` — controlled no-logo/born-digital classification edge cases (§2A.4).
- `northgate_trace.js` — live `process_docs` type-resolution trace (§2.2); run via
  `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe northgate_trace.js 675 673 674 670 667 685`.
- `northgate_types.py` / `notes_and_types.py` — DB landscape + persisted validation notes (§2.6).
> Live DB opened `?mode=ro` throughout; a dev `npm start` holding the DB does not block read-only access.
