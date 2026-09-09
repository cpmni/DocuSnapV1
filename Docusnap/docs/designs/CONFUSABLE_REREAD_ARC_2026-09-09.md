# Confusable-glyph re-read witness → suppress Gate-C "absent" + allow auto-file

**Date:** 2026-09-09 · **Author:** Claude Code (main) · **Status:** SPEC for Oracle vet
**Owner ask:** *"I would rather remove the message and autofile — test the slices at different res's to see if they'd pick up PO rather than P0, and corroborate with the other value."*

---

## 1. The exhibit (verified at source, live DB doc #45, `CopperfieldElectrical_purchase_order_07.pdf`)

- `po_number` committed value = **`PO-22954`** (letter **O**), method `template_mapping`, conf 95.
- Corroboration record:
  `{"winner_family":"mapping","agree":[],"disagree":[{"family":"keyword","value":", P0-22954"}],"independent_agree":false}`
- Stored whole-page `ocr_text` carries the token **`P0-22954`** (digit **0**, codepoint 48 confirmed).
- `validation_note` (Gate-C): *"'PO-22954' doesn't appear on this page as written — the page reads it as 'P0-22954' — please check the reference before filing."*
- `ocr_recipe`: `{"dpi":200,"light":[200,210,220,230],...}` → the whole-page pass runs at **200 DPI**.

**Reader breakdown (the root cause):**

| Reader | Input | Read | Recipe |
|---|---|---|---|
| `mapping` (committed) | field **crop** | `PO-22954` (**O**) ✓ | region.py light-ladder, PSM 6, 200 DPI |
| `keyword` | whole-page `ocr_text` | `P0-22954` (**0**) | tesseract.py page rebuild, PSM 3, 200 DPI |
| Gate-C page check | whole-page `ocr_text` | `P0-22954` (**0**) → fires "absent" | same as keyword |

Only the **crop** read O. Both whole-page-derived readers read 0. `independent_agree=false` — so **nothing** currently seconds the crop.

**Multi-res experiment (this session, `scratchpad/multires.py`, doc #45's `po_number` box):**
- Field crop, **PSM 6**: reads `PO-22954` (**O**) at **every** DPI — 150 / 200 / 300 / 400 / 600. Even product 200 DPI.
- Fresh full-page render at **300 DPI** (PSM 3): reads `PO-22954` (**O**), conf 91.
- PSM 7 / PSM 8 on the wide crop: garbage (single-line/word mode choked on the "No. PO-22954" span) → **not usable as clean witnesses without a tighter crop**.
- Visual inspection of the 300-DPI crop: unambiguous round-open **O**.

**Conclusion:** the confusable is a **low-resolution / whole-page-segmentation artifact**, fully resolvable. The value IS on the page. Gate-C uses the **weakest reader (200-DPI whole-page pass) as the arbiter of "what's on the page"** and flags the stronger targeted read as absent. Arbiter is backwards.

---

## 2. Why the two existing softeners don't fire (the gap)

Both Gate-C softeners require **confirmed-literal history**:
- `FILING_SANITY_REF_CORROB_SOFTEN` (engine.py:7317) — needs ≥2 **live** independent families to agree AND an exact confirmed in-scope literal. Here only 1 family (mapping) read the value, and PO numbers are **unique** → never a repeated confirmed literal.
- `FILING_SANITY_REF_HISTORY_SOFTEN` (engine.py:7342) — needs an exact confirmed literal one backed-glyph from `_near`. Same unique-ref problem.

Both also keep the doc **review-bound** by design (Oracle C1, 2026-09-03/04: the *mirror case* — where the minority spelling is the true one — must be held for a human). **A first-time correct read that the whole-page pass mis-segments has no history to lean on, so the raw scary note ships.** This is the phantom "Format check · 1" card (Chris 09-08/09-09).

---

## 3. Proposal — `FILING_SANITY_CONFUSABLE_REREAD` (DARK arc)

An **active, independent re-read witness** that produces the second reader the exhibit lacks, then — when it confirms the committed value — **clears `_absent`** so no note is emitted and the doc becomes auto-file-eligible (subject to every other gate, unchanged).

### 3.1 Trigger (narrow)
Inside Gate-C, at the point `_near = _nearest_confusable_page_token(page, rv)` is computed and both softeners have declined (engine.py:7330–7355, the `else` arm), fire only when ALL hold:
1. `ref_field_key` is a **ref-role** field (already the Gate-C scope; not dates/money/free-text).
2. `_near` is non-empty **and** `_one_confusable_diff(rv, _near)` is True (same length, exactly one position, that one diff is in `_CONFUSE_TO_DIGIT` — O/0, I/1, S/5, B/8, Z/2, |/1, etc.).
3. The single differing glyph is a **digit↔letter / symbol↔digit** confusion (see §5, reggie scope) — **exclude pure case-folds and any letter↔letter pair** (`ca.upper()==cb.upper()` branch of `_one_confusable_diff` is NOT admitted here).

### 3.2 The witness (no new render-plumbing)
The engine holds only the **200-DPI page bitmap** — and that is enough (§1 experiment: 200-DPI crop reads O). Re-read the field's **target crop** (the `template_field_mappings` target box for a mapped field, or the field's resolved box) with **K recipes that are INDEPENDENT of the recipe that produced `rv`** (this is load-bearing — see the circularity seam §5). Candidate independent recipes (final set to be tuned with oscar):
- Otsu / adaptive-threshold binarise + PSM 7 on a **tight single-value crop** (not the wide "No." span);
- 2× / 3× upscale + PSM 6;
- individual light-ladder levels read separately (each a distinct binarisation).

Each recipe that yields a **clean token of rv's length and shape** casts one vote for the glyph it read at the confusable position. A **garbage / wrong-shape read abstains** (never a vote) — mirrors `except Exception: return None` and oscar's crop-conditioning stance.

### 3.3 Decision
- **PRESENT** iff ≥ **M** independent clean witnesses agree with **rv**'s glyph AND **zero** witnesses agree with `_near`'s glyph. (Start **M = 2**; the census tunes it.) → set `_absent = False` (skip the whole note block) → **no `validation_note`** → doc is auto-file-eligible via the unchanged `trust.isAutoFileEligible` (validation_note absence is the existing gate).
- **UNSETTLED** (witnesses split, or any witness backs `_near`, or < M clean witnesses) → **fail toward review**: fall through to the existing softened/absent note. Never auto-files.

### 3.4 What it does NOT change
Auto-file remains gated by **`auto_file_threshold` + trust graduation + type + every other flag**. This arc removes exactly **one** false note; it does not lower any other bar. (Doc #45 sits at overall 83 < 90, so it still wouldn't auto-file until the scope/threshold allow — the arc's value is that a *clean* Copperfield PO no longer parks on a phantom note.)

---

## 4. Dependency (build order)
The witness adds **more small-crop pytesseract calls** — the exact class implicated in tonight's `tesseract.exe` abort/wedge (HANDOVER_2026-09-09_EVENING §1). **This arc MUST land on top of oscar fix #1 (per-call `timeout=` + `SetErrorMode`) and #2 (crop-conditioning: quiet-zone border, min final height, cap upscale, reject degenerate).** Building the re-read before those would multiply the crash surface. The witness crops must go through the conditioned `_prep`, not a raw flush-to-edge strip.

---

## 5. Seams to vet (named for Oracle)
1. **Circularity** (the standing Gate-C v2 warning, engine.py:2114): a witness recipe that is essentially the recipe that produced `rv` = "the read witnessing itself." The witness set must be **provably independent** of the committed read's recipe. Question for Oracle: is "different binarisation + PSM on the same 200-DPI bitmap" independent *enough*, or does independence require a different **image scale** (upscale) as the discriminating axis?
2. **Mirror / same-shape blind spot** (Oracle read-widen Condition 1, 2026-09-09): the danger is the printed glyph is *genuinely* the page-form (`0`) and the crop recipe has a bias that reads `O`. Guard = require ≥M **independent** witnesses (not just mapping) to back `rv`, and **fail toward review** on any doubt. Restrict to digit↔letter confusables where the isolated crop is a demonstrably better reader (reggie to bound the admitted `_CONFUSE_TO_DIGIT` subset; exclude letter↔letter).
3. **Escalation past the 09-03/04 Oracle C1** ("review-bound only"): this arc deliberately goes further — it **auto-files** a confusable-cleared value. The justification is the *fresh independent witness* the earlier softeners lacked (they leaned on history and were held to review precisely because a single reader isn't enough). Oracle to rule whether an active K-recipe witness clears that bar, and at what M.
4. **Fail-open on OCR failure**: if the re-read itself errors/times out, the arc must **abstain** (keep the note), never suppress.

---

## 6. Verification gate (before any flip)
- **Unit pins:** (a) the witness on doc #45's crop returns `O` on ≥2 independent recipes → PRESENT → `_absent` cleared; (b) **circularity pin** — the committed read's own recipe is excluded from the witness set; (c) **mirror pin** — a synthetic crop whose independent re-reads back the page-form → note stays, no auto-file; (d) **fail-toward-review pin** — split witnesses → note stays; (e) **OCR-error pin** — witness raises → abstain, note stays.
- **Census (corpus `Desktop\ScanFinder Test Corpus`, 605 papers + the Copperfield set):** count docs currently carrying the Gate-C confusable-absent note; of those, how many the arc would flip to auto-file-eligible; **assert M=0 flips of a genuinely-wrong value** (adversarial: hand-check every flip where the page-form could be the true reading). Classify by confusable class.
- **realdoc M=0:** `wouldFile(arc ON) ⊆ wouldFile(arc OFF) ∪ {the confusable-cleared set}`, and no *new wrong* auto-file.
- **Perf:** witness fires only on the flagged-confusable case; K small conditioned crops on the existing bitmap → negligible; must inherit the per-call timeout.

## 7. Rollout
New env flag **`FILING_SANITY_CONFUSABLE_REREAD`**, migration seed **OFF** (DARK), added to `TEST_SWITCH_KEYS`, armed only by the `-TEST` build, **owner-gated** customer flip (census + Oracle + M=0). Byte-identical when OFF.

## 8. Open questions for Oracle
- Is the whole approach right, or does he prefer a **lower layer** — e.g. "on a single-confusable ref disagreement, Gate-C should simply not treat the 200-DPI whole-page pass as ground truth against a crop-sourced value" (suppress note **review-bound**, as the 09-03 soften does) and leave auto-file alone? (That is the minimal do-less option; the owner explicitly wants auto-file, so the witness is what earns it.)
- M (witness count) and the exact independent-recipe set.
- Admitted confusable subset (digit↔letter only? which pairs?).
