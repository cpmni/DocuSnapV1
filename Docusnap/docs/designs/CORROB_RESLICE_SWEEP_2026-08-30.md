# Corroboration-gated re-slice sweep for total / ref / date (2026-08-30)

> ## REVISED 2026-08-30 EVENING — measured on the faithful replay; §§1–3 below are the ORIGINAL brief and
> ## two of its premises are FALSIFIED. Read this banner first; the original text is kept for the record.
>
> **Method:** a faithful replay of the 20 Nordwind docs through the product configuration (`buildTrainingArgs`
> + the handler env builders, `OCR_RENDER_DPI=200`, `--trace`) against a `db.backup()` copy of the live DB
> (`tmp/_run_docs.js`), then zone probes through the PRODUCT read path (`anchor._read_lines_full`) and a
> stored-record census over the live DB copy (`tmp/_db_census.py`).
>
> **Falsified premise 1 — "the zone reads `£9 32632.76` (format-invalid)".** That was the prior session's raw
> slice OCR. The product's ladder reads 0023's total zone as **`29,242.76` @90 — a FORMAT-VALID garble**. Flow on
> the live config: mapping `29,242.76`@90 wins on curated authority over `keyword_override £2,363.76`@93 →
> `_reconciliation_pick_total` swaps to `2,363.76` (1,969.80 + 393.96, penny-exact) with the
> `RECON_TOTAL_ADJUSTED_NOTE` → the Oracle-signed demoter `_demote_recon_total_corroborated_note` (ON live) needs
> a CROP-SIDE penny-exact witness and the only crop-side read is the garble → the note can never release. The
> corroboration record: `winner keyword, agree [], disagree [mapping 29,242.76]`. Engine `_needs_review` is
> False (a note alone never sets it); the JS `isAutoFileEligible` holds the doc on the note.
> **Consequence:** fix #1 as written ("discount a format-invalid witness") does NOT touch 0023. The stored-record
> census does show the class in HISTORY (8 of 10 money dissents in the owner's DB are format-invalid zone reads
> from older code vintages — `C9,262.76`, `£2.205.60`, `£0/2.0U`), so 1a stays a small correctness item, not the
> 0023 fix. Money records are otherwise honest: `£`/comma/space differences already fold (`_EDGE_RE` +
> whitespace collapse) — 19/20 Nordwind totals record `agree:['keyword']`; a money fold has no measured target.
>
> **Falsified premise 2 — "higher-DPI re-render is the lever".** Zone probe: pad 0 fails at 200/300/400/600
> DPI (600 raw: `£9 26232 76`); what heals is VERTICAL HEADROOM. With the product read path
> (`_read_lines_full`, `pdf_to_images` frame = the engine frame):
> - pad 0 (the taught box): 19/20 correct for every prep; 0023 wrong for every prep (`£9 262 76` @88 with
>   `_struct_prep`, `C9 242 76` @70 with `_prep`).
> - **vertical pad 0.5×h + PSM 7 DEGRADES the 19 clean zones** (wrong digits at conf 22-70: `£4,254.60`,
>   `£2,208.60`, `£3,864.72`; empties) and never reads 0023 (`£26876`@0, `£236376`@39).
> - **R8 = pad 0.5×h vertical + 0.5×h horizontal, NO upscale, 20 px white border, PSM 6 `image_to_data` with an
>   IN-BAND line pick (a line qualifies iff its y-band overlaps the ORIGINAL box band by ≥50 % of the line's
>   height; exactly one qualifier else abstain): 20/20 exact (0023 → `£2,363.76` @92), 0 format-valid wrong
>   reads, 0 empty.** R7 (vertical pad 1.0) also 20/20. This is the shipped Oracle-signed
>   `_read_pad_window_date/code` recipe (row-bound padded window, PSM 6, nearest/in-band pick) minus its ×2
>   `_prep` upscale, which reads '' on 0023. Currency simply has no pad-window reader today.
> - Every padded PSM-7 rung is scale-PHASE fragile (15/20). A re-read can therefore only ever be a
>   CORROBORATION-GATED WITNESS, never a replacement read — exactly the owner's "adopt only on corroboration".
>
> **Advisors (oscar · reggie · 007, full outputs in the session transcript) agree:** re-slice the engine's OWN page
> frame (`crop_pages[page_idx]`), pad only, no PDF re-render (frame risk for a rung that fixed nothing at pad 0);
> the box = the one the mapper actually read (in-memory, post-compose); the seat = a late ENGINE stage inside
> `extract()` feeding the per-run ledger before the corroboration record is built (a process_docs seat cannot
> recompute honestly — the 08-15 cosmetic-demote lesson); the licence = an INDEPENDENT family (keyword) or a
> PENNY-EXACT reconcile (`total_reconciles`' ±2 % is a flag tolerance, never an adopt licence); no whitelist
> (force-fits glyphs; separator-deletion trap); no self-agreement of two re-slices.
>
> **v1 DESIGN (what is built this session, DARK):**
> - **`RESLICE_WITNESS_SWEEP`** — engine stage 4.7, TOTALS ONLY. Trigger per doc: the total role field carries a
>   `validation_note`, its committed value is a strict money shape AND penny-reconciles (sign-agreeing) against
>   separately read components (`_reconcile_components`), the field has a Stage-0.5 mapping zone on a page in
>   hand, and the zone's own ledger read is absent or cents-DIFFERENT from the committed value. Ladder (max
>   `RESLICE_MAX_TRIES`, default 2): R8 then R7 on `crop_pages[page_idx]` at the box the mapper read (carried
>   privately as `_read_geom`, popped like `_heal`; fallback the composed target box). STOP at the first rung whose
>   cleaned read passes `money_strict_shape` AND is cents-equal (sign-agreeing) to the committed value → inject
>   ONE ledger candidate `{method:'template_mapping_resliced', stage:'4.7_reslice', confidence: rung mean conf,
>   located:False, noted:False}` (buckets to the existing `mapping` family — never a new family, deskew Oracle C1)
>   + additive `reslice_witness` provenance on the record. The sweep COMMITS NOTHING and never injects a
>   disagreeing read (a wrong padded read can never add a dissent or suppress one). The existing Oracle-signed
>   `_demote_recon_total_corroborated_note` then releases the note under its own rails (crop witness penny-exact +
>   sign + arithmetic re-verify, no confidence minted). Exhausted → nothing changes.
>   Review posture: the release follows the demoter's signed posture (a doubly-verified correct total may
>   auto-file); the sweep adds no hold of its own. **Oracle to rule** whether a sweep-produced witness must ALSO
>   re-attach a "— confirm once." note (review-bound) until the census proves 0 wrong releases.
>   Dates/refs: NOT in v1 — their trigger must be "the zone's own read was ABSENT or format-INVALID" (a valid
>   different zone read is a genuine dissent a padded re-read must never be allowed to out-vote — the
>   `trust_role_disagreement_refuse` seam), and the ref crosscheck demoter is Oracle-B2-deferred. Own slice.
> - **Fix 1a `CORROB_DISCOUNT_INVALID_WITNESS`** — `_build_corroboration_emit` routes a deterministically
>   format-INVALID candidate (currency: `number_format.money_strict_shape` after the idempotent canonical +
>   respacing cleaners; date: `salvage_date_detail` finds nothing) to an additive `discounted:[{family,value,
>   reason}]` list instead of `disagree`. Codes never (no deterministic rule). Field types threaded via
>   `self._val_types`. JS `_corrobLicensed` / `_pageFamilyDisagrees` read the same record and need no change.
> - **Fix 1b `TEMPLATE_FORMAT_FAIL_YIELD_STRICT_MONEY`** — the shipped (mig-70 ON) `_stage05_format_fails`
>   currency leg is a leading-glyph test + the sign-blind `parse_amount` SEARCH, so `£9 32632.76` "passes" (9.0)
>   and the arm's own docstring claim that `'-3 5982.70'` fails is false. Sub-flag AND-ed with the live parent:
>   the leg becomes `not money_strict_shape(v)`. Docstring corrected.
> - **Deskew retry dead guard (`4607cc6`) — corrected under its own switch.** `_maybeAutoFile` honours
>   `msg.needs_review` only when `autofile_gate_unify` is OFF (`handler.js:5633-5637`); it is ON live (mig 93),
>   so the retry's forced `_needs_review=True` never holds anything — the "never auto-files a straightened read"
>   claim was a dead guard. Fix: on ADOPT, every field whose VALUE changed between the raw and the straightened
>   read gets `Read differently after straightening — was 'X', now 'Y' — confirm once.` (the `_isLaneHoldNote`
>   family: survives reprocess merges, holds at every floor, tells the operator what straightening did). Same
>   values / higher confidence only → no note (nothing new to check).
> - **NOT built (no measured target):** the money fold; reggie's 1c (yield without the note on arithmetic
>   alone — Oracle ruled arithmetic is a re-check, not independence); the DPI rung; the keyword-only STOP for
>   refs/dates.
>
> **Gate:** pins for each predicate + the sweep's abstain/stop; Nordwind OFF/ON (0023's note released, value
> unchanged, 19 others byte-identical); full realdoc `RR_APP_ENV=1` on the live copy OFF vs ON (M=0, 0 new wrong);
> Oracle ratify before any flip.
>
> **ORACLE VERDICT (same evening, `docs/oracle_log.md` 2026-08-30 EVENING): SIGN OFF WITH CONDITIONS on all four
> items; R8-as-primary = NO. Every condition is BUILT + pinned:** C1 trigger = `RECON_TOTAL_ADJUSTED_NOTE` exactly ·
> C2 tax must be READ · C3 exactly one amount on the picked line · C4 the amount's own word confidence · C5 PASS-2
> pin · C6 prep non-scaling + 0-based page · C7 discount CURRENCY-ONLY in v1 · C8 JS `_pageFamilyDisagrees` scans
> `disagree ∪ discounted` · C9 dev-inspector shows discounted + the re-slice witness · C10 strict-money seam pin ·
> C11 flip order sweep → discount → never strict-money in this arc · C12 an emptied field is a change (stub row +
> put-back) · C13 field-level charter · C14 apply-before-adopt source pin. Nordwind OFF (new code) vs the pre-edit
> baseline: 0 diffs / 20; ON: 0023 released via `template_mapping_resliced` @92 (R8), value unchanged, 19
> byte-identical. Full realdoc four-arm A/B (off / sweep / discount / all): `tmp/runs/realdoc_*.md` (see the handover).

**Status:** design brief, PRE-advisor / PRE-Oracle. Owner-requested. Build in a fresh session:
oscar (OCR recipes) + reggie (format validation) + 007 (zone geometry) → Oracle → DARK switch → OFF/ON
census before any flip. Builds on the shipped review-bound whole-page straighten retry
(`DESKEW_SLICE_REREAD_2026-08-30.md`, commit `4607cc6`).

## 0. Owner ask (verbatim intent)
"For totals, refs and dates: if there's a note AND the straighten didn't fix it, re-slice using
different parameters until we get corroboration, up to a max number of tries." And, on the whole arc:
"works most of the time — be careful not to regress."

## 1. Root cause that motivated it — Nordwind quote 0023 total (REPRODUCED)
The doc's `Total (inc VAT) £2,363.76` is filed/flagged wrong because the **template_mapping zone re-OCR
mangles it**:
- The taught total TARGET box (`geom [0.845, 0.441, 0.081, 0.0162]`) crops a **134×38 px** region at
  200 DPI. The crop is visually clean (`£2,363.76`), but Tesseract reads it as **`£9 32632.76`** at
  EVERY PSM (6/7/8/11/13, raw/2x/3x LANCZOS — best it manages is `2 263.76`; never the truth). The `£`
  glyph + small size + comma tip it. Reproduced in `tmp/_ocr_slice.py` on `tmp/slices_0023/slice_9_target.png`.
- The **full-page keyword read gets `£2,363.76` right @93** (full-page render + word geometry, not a tiny crop).
- So mapping (garbage) vs keyword (correct) → **disagree → no corroboration** → the format-anomaly
  "please check" note can't clear. On the live app keyword_override WON (correct value filed, note stuck);
  in the sandbox the garbage mapping WON (`9 32632.76` filed @50, "total < subtotal"). Same culprit.
- Most docs' total crops OCR clean → mapping agrees with keyword → corroborated. 0023's render tips it over.

Trace + slices captured under `C:\Users\cmccu\.claude\jobs\<job>\tmp\` this session
(`_trace_0023.js` → `trace0023.txt`, `slices_0023/`, `_ocr_slice.py`). Sandbox DB
`scratchpad/live_e44gate.db`; docs `C:\Users\cmccu\Desktop\Demo Docs\Other\IMPORT\Nordwind-*`.

## 2. Fix #1 — discount a format-invalid corroboration witness (do FIRST, small)
A corroboration WITNESS whose value is **deterministically format-invalid** (`9 32632.76` — embedded
spaces / wrong money shape / fails the field's learned format) is **noise, not a dissent**. Two changes:
- It must **not count as a `disagree`** in the corroboration record (so keyword + reconcile can clear the note).
- It must **not WIN** the field over a lower-stage read that PASSES format AND reconciles (stops the
  sandbox's garbage-total-wins outcome).
Locus: the corroboration record (`engine._build_corroboration_emit` / `_corrob_record_bucket` / the
`disagree` list) + the mapping-vs-keyword merge for a format-invalid mapping value. DARK switch, pin,
census. Cannot regress a genuine two-VALID-values disagreement (both pass format). Clears 0023's flag
because keyword already read `2,363.76` and it reconciles (1969.80 + 393.96 = 2363.76).

## 3. Fix #2 — the corroboration-gated re-slice SWEEP (the owner's idea; the general recovery)
For the harder class where NO family read a valid value (fix #1 has nothing valid to fall back on).

- **Trigger:** a `total` / `ref` / `date` field carrying a note (format or reconcile doubt), REVIEW-BOUND,
  after the whole-page straighten retry did not clear it. Not on a clean auto-file. Not on first import of a
  template-less sender (no zone to re-slice).
- **Loop, capped (~4–6 tries), a DIFFERENT recipe each pass** (curated ladder, oscar to finalise):
  1. **Re-render the zone at higher DPI (300 → 400 → 600) FROM THE PDF** — not upscaling the 200-DPI raster
     (the 0023 lever; LANCZOS on the degraded raster did NOT help).
  2. PSM 7 / 8 / 6 / 13.
  3. Binarise / contrast (Otsu, adaptive threshold).
  4. Money: strip `£`/symbols + `tessedit_char_whitelist` digits+`.,`.
  5. Straighten the slice (the deskew param, per-slice).
- **STOP (adopt) when** a read (a) PASSES the field's learned format AND (b) MATCHES an independent family
  (full-page keyword) OR RECONCILES (subtotal+vat=total for a total). Adopt that value, clear the note
  (corroboration gained), REVIEW-BOUND. **Exhausted → leave flagged, unchanged.**
- **Why low-regression:** adopts ONLY a value another source already confirms → never invents a new wrong
  value; worst case is no change. Noted total/ref/date only; bounded tries; never auto-files.

### Open design questions (for the advisors / Oracle)
- **refs/dates have no math reconcile** → their stop is "matches another family's read". If NO other family
  read it, fall back to "two DIFFERENT-param passes agree" — weaker independence (the deskew design's
  self-agreement warning); gate carefully or exclude this fallback initially.
- Corroboration independence: a zone re-slice matching the FULL-PAGE keyword IS cross-source (legit). Two
  zone re-slices agreeing on the same crop is weaker — different params helps but is not fully independent.
- Cost: bounded by max-tries × (only noted total/ref/date). Confirm the per-doc worst case is acceptable.
- This SUPERSEDES the removed field-scoped slice arm (its trigger was "withheld" → fired 0×; this is
  "has a note" + a param SWEEP + a corroboration stop — the safety Oracle wanted).

## 4. Gate (both fixes)
DARK switches, default OFF. Pins (the format-invalid-witness predicate; the sweep's adopt-only-on-
corroboration decision). OFF-vs-ON census on the Nordwind corpus (0023 must heal) + the broader owner DB:
M=0 (no correct value changed), the flag clears on 0023, 0 new wrong values. Oracle ratify before flip.
