# Confusable prefix auto-file — resolve a Gate-C confusable via confirmed prefix history

**Date:** 2026-09-09 · **Author:** Claude Code (main) · **Status:** SPEC for Oracle vet
**Follows:** Oracle SEND BACK of the re-read lever (docs/oracle_log.md 2026-09-09), Condition 2a:
*"the auto-file lever must come from a DIFFERENT AXIS than the committed read — confirmed supplier
PREFIX history (`_prefix_dominant_backed` + `_prefix_confusable_adopt`); PO refs are unique but the
prefix is not; this needs NO OCR. WRONG LAYER: wire the auto-file lever into (a), don't invent a re-read."*

This is the AUTO-FILE half of the owner's ask ("remove the message AND autofile"). The note half shipped
as `filing_sanity_confusable_soften` (mig 147→148, review-bound). This arc lets the SAME confusable case
auto-file **only when confirmed history vouches for it** — the independent axis Oracle required.

---

## 1. The case (verified — live exhibit doc #45)

- `po_number` committed = `PO-22954` (letter O, from the field crop — the correct read).
- Whole-page `ocr_text` carries `P0-22954` (digit 0) → Gate-C flags "absent" (page form `_near = P0-22954`).
- mig 147 (now default) softens the note → truthful, but the doc still parks in Review (one click).

The value **is** on the page; only the low-res whole-page pass mis-segmented the O. When the scope's
confirmed refs overwhelmingly start with the dominant prefix `PO`, **confirmed history — not the pixels —
settles that the glyph is O**, and the doc can auto-file.

---

## 2. Existing signed machinery reused (no new OCR)

- `ocr_corrector.lookup_prefix(self.prefix_index, key, sup, slug)` → `rec_p = {dominant, counts}` — the
  per-scope prefix record (built from confirmed values; already the input to the B/adopt lane).
- `_prefix_dominant_backed(rec_p)` (engine.py:2154, Oracle-signed) — the dominance bar: **≥5 extractable
  prefixes, dominant count ≥5, dominant share ≥0.90** over the extractable prefixes.
- `_prefix_confusable_adopt(val, dom)` (engine.py:2167, Oracle-signed) — returns `dom + val's suffix` iff
  `val`'s head is EXACTLY ONE confusable-class glyph substitution from `dom` (segmentation guard: the char
  after the head must not be alpha; case-only differences are not this arm). Returns None otherwise.

## 3. Proposal — `FILING_SANITY_CONFUSABLE_PREFIX_AUTOFILE` (new DARK flag)

At the Gate-C confusable branch (engine.py, inside the `elif (_near and _FILING_SANITY_CONFUSABLE_SOFTEN
and _one_digit_letter_confusable(rv, _near))` arm — the mig-147 site), BEFORE emitting the soft note, test
the **prefix-history witness**:

```
_confusable_prefix_backed(rv, near, rec_p):
    if not _prefix_dominant_backed(rec_p): return False           # strong confirmed-history bar
    dom = rec_p['dominant']
    if not dom or not rv.startswith(dom): return False            # the committed read USES the dominant prefix
    return _prefix_confusable_adopt(near, dom) == rv               # near = a one-glyph prefix misread of dom,
                                                                   # suffix identical → history corrects near → rv
```

- **Witness holds** → emit **NO** validation_note (skip the soften). The field is note-free → auto-file-
  eligible via the unchanged `trust.isAutoFileEligible` (every other gate — threshold, trust graduation,
  type, un-flagged — stands). Trace `filing_sanity_ref_confusable_prefix_autofile`.
- **Witness fails** (history not backed / value not on the dominant prefix / confusable is in the SUFFIX /
  `rec_p` absent) → fall to the mig-147 **soft note** (review-bound). **Fail toward review.**

`rec_p` is fetched once at the site (`self.prefix_index`, `key=ref_field_key`, `_sup`, `_slug` are all in
scope, as at the two existing prefix sites 4207/6917).

### 3.1 Why this is the independent axis Oracle required
The witness is confirmed **history**, not a re-read of the same pixels. `_prefix_dominant_backed`'s ≥5/≥5/≥0.90
bar means the scope's convention is established by ≥5 confirmed documents. The committed read already equals
that dominant prefix; the whole-page's `_near` is a single-confusable misread of it. History says the glyph
is O — the whole-page pass is the outlier, outvoted by ≥5 confirmed docs. No pixel re-read, no circularity.

### 3.2 Prefix-region ONLY (the load-bearing restriction)
`_prefix_confusable_adopt(near, dom) == rv` fires only when the ONE differing glyph is inside `dom` and the
suffix is byte-identical. A confusable in the per-doc SUFFIX (the number itself) → `near`'s head == `dom`,
adopt returns `dom + near_suffix ≠ rv` → witness fails → soft note. History vouches for the prefix, never
the number.

## 4. Seams to vet (named for Oracle)
1. **Mirror case** (the page-form digit is the TRUE value, the crop misread it): bounded by
   `_prefix_dominant_backed` — a genuine `P0` prefix in a scope whose confirmed convention is ≥90% `PO`
   is itself an anomaly, and filing it under the established convention is the convention-consistent choice
   (the "supplier-convention fact" Oracle named as the right arbiter). A scope that legitimately mixes
   `PO`/`P0` prefixes has dominant share <0.90 → not backed → soft note, review-bound. Is ≥0.90/≥5/≥5 a
   sufficient bar to cross the AUTO-FILE line here, or do you want it tighter (e.g. counter==0 on the
   confusable variant, mirroring the 2a support bar)?
2. **Suffix protection** — §3.2. Confirm the adopt-equality test is a sufficient guard that a suffix
   confusable can never take the auto-file pass.
3. **Confusable class** — restricted to `_one_digit_letter_confusable` (digit/letter, case-folds excluded)
   AND `_prefix_confusable_class` inside `_prefix_confusable_adopt`. Which pairs do you admit for AUTO-FILE?
   (Your note-fix ranking: `I/1,|/1,]/1,[/1 > S/5,B/8,Z/2 > O/0 last`. O/0 is the exhibit — does the
   dominant-backed history bar earn O/0 an auto-file pass, or hold O/0 to note-only until the others prove out?)
4. **Blast radius** — this SUPPRESSES a note that today blocks auto-file, so it CHANGES `wouldFile`
   (unlike mig 147). It is NOT auto-file-neutral. Every other gate stays. No OCR added → NOT dependent on
   the tesseract fix (unlike the re-read lever).
5. **Inert today** — Copperfield has 2 confirmed POs; `_prefix_dominant_backed` needs ≥5. The arc is inert
   until a scope earns the history, which is the intended "hands-off once history exists" behaviour.

## 5. Verification gate (before any flip)
- **Unit pins:** (a) witness holds for `rv=PO-22954, near=P0-22954, dom=PO` with a backed rec → note
  suppressed; (b) **suffix pin** — a suffix confusable → witness False → soft note stays; (c) **not-backed
  pin** — <5 confirms → witness False → soft note; (d) **mirror pin** — value NOT on the dominant prefix
  (`rv` head ≠ dom) → witness False; (e) auto-file-eligible integration pin (note-free → `isAutoFileEligible`
  true when the scope is graduated + conf ≥ bar); (f) DARK default OFF → byte-identical.
- **Census** over the 147-doc corpus + the live install (offline replay, as the mig-147 census): how many
  docs the arc would move from soft-note-review to AUTO-FILE, restricted to **graduated scopes where clearing
  would actually file**; **hand-check every one where the page-form could be the true reading** (the mirror).
  **M=0** := zero flips of a genuinely-wrong value + zero per-field accuracy drop.
- **Adversarial mirror set** (constructed): a scope whose confirmed convention is `PO` but a doc whose ref
  is genuinely `P0…` — the gate FAILS if the arc auto-files it as `PO…` when it should not. (Per Seam 1, the
  ruling may be that convention-consistency IS correct here; Oracle to decide.)
- **realdoc M=0**, no new wrong auto-file.

## 6. Rollout
New env flag **`FILING_SANITY_CONFUSABLE_PREFIX_AUTOFILE`**, migration seed **OFF** (DARK), added to
`TEST_SWITCH_KEYS`, armed only by `-TEST`, owner-gated customer flip (census + M=0 + Oracle). Byte-identical
OFF. HARD dependency: `filing_sanity_confusable_soften` ON (this arc lives in its branch).

## 7. Open questions for Oracle
- Is the dominance bar (≥5/≥5/≥0.90) enough to cross the AUTO-FILE line, or add counter==0 on the confusable variant?
- Admit O/0 for auto-file now (it is the exhibit + the least-discriminable pair), or hold O/0 to note-only and
  admit only the better-separated classes first?
- Is convention-consistency (file a genuine minority-prefix doc under the dominant) the CORRECT ruling, or must
  a mismatch between the crop read and a dominant-backed history itself force review?
