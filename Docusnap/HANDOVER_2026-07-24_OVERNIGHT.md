# HANDOVER — 2026-07-24 OVERNIGHT (autonomous run for the owner)

**Branch `feat/reprocess-throughput-autostraighten`. 2 commits ahead of origin, UNPUSHED:
`5377e24` (Slice-1d verdict) · `8e2211c` (deskew raw-witness fix). Nothing pushed, nothing
auto-file flipped.** Only an inert measurement harness left uncommitted.

---

## TL;DR — your four asks
1. **"Fix the detection issue" (straighten corrupting a value):** DONE + committed (`8e2211c`), tested, safe. It heals `PO-98270`→`PO-98370` and flags it.
2. **"Fix the rest":** issue 2 (invoice over-flag) DIAGNOSED + designed, not built (needs reggie + keyword-stage plumbing — see below).
3. **"Test the straighten + comparison system":** PASS — deskew witness heals #475, leaves 4 correct siblings untouched (0 false-flips, 0 false-flags), unit test 18/18.
4. **"Does the comparison make it more reliable with MORE auto-files?"** — **MEASURED: yes there's a ~+15-doc opportunity, BUT the naive way to grab it is unsafe, and the *safe* behaviour already ships.** I built + measured it, Oracle's gate caught a real flaw, so I **reverted it** rather than ship a silent-wrong-auto-file risk. Full detail below. **This is your main decision.**

---

## 1. Straighten fix — issue 3 (COMMITTED `8e2211c`, safe to keep testing)
On a Straighten+Reprocess the taught crop is read off the *deskewed* page and the rotation
resample can flip a valid-shaped glyph (`PO-98370`→`PO-98270`) that no regex catches. The fix
(`anchor.raw_crop_recheck` + a gated engine stage) re-reads the RAW page at the taught spot and,
on a **two-read consensus** (raw crop + page text agree on a value that differs from the committed
one), heals it + flags "please verify" (capped below the 88 floor → never auto-files). Gated on
`raw_page0` + kill switch `DESKEW_RAW_WITNESS` → byte-identical off the deskew path. Corpus
byte-identical (M=9). Revert: `DESKEW_RAW_WITNESS=0`, or `git revert 8e2211c`.

---

## 2. THE HEADLINE — comparison → more auto-files: MEASURED, then reverted (unsafe as built)
**Answer: the comparison DOES make it more reliable and auto-file more — but that safe behaviour
already ships (`KEYWORD_ANCHOR_CORROB`); the naive expansion I measured is NOT genuine corroboration
and is NOT safe to flip.**

- **Measured (independently re-verified, 449 docs):** a cross-tier lift (`CROSS_TIER_CONF_LIFT`,
  default-off) that lifts a below-88 critical ref/date value when ≥2 extraction *stages* read it →
  **+15 auto-files (311→326), M=9 UNCHANGED, byte-identical off.** On the surface: a clean win.
- **Oracle's gate caught the flaw (verdict: sign-off-with-conditions; FLIP = NO-GO):** the
  "≥2 **independent** stages" premise is FALSE as coded. `1_keyword`, `0_template`, and
  `anchor_inline` all read the **same full-page OCR text** — so two of them "agreeing" is one read
  under two labels, not independent corroboration. A consistent OCR misread (`INV-0O123`) is read
  identically by both → lifted → **silently auto-filed wrong** (the exact self-witnessed-misread
  failure your steer warned about). Worse, the block is a **looser duplicate of the already-shipped,
  Oracle-signed `KEYWORD_ANCHOR_CORROB`** with its safety filters stripped — so the +15 are precisely
  the cases the safe path already declined. On this corpus M stayed 9; the risk is structural (other
  docs), not visible here.
- **What I did:** **REVERTED the flawed lift** (not committed — I won't leave broken auto-file code
  in the tree). Kept the measurement harness (`stress_test/realdoc_regression.js` gained an env-gated
  `RR_CONSENSUS` dump, inert unless set; new `stress_test/consensus_analysis.js`) — both uncommitted,
  useful for the tightened build if you want it.
- **The M-safety nuance you steered toward is CONFIRMED:** naive "value ∈ page OCR → trust" is unsafe
  (7 current wrong auto-files self-witness a consistent misread). Genuine corroboration needs an
  **independent** read = a **crop re-OCR** (a second look at different pixels), which is exactly what
  the deskew witness and `KEYWORD_ANCHOR_CORROB` already do.
- **The SAFE path (if you want to pursue it — DECISION 1):** extend the existing `KEYWORD_ANCHOR_CORROB`
  into a post-merge pass that requires ≥1 genuinely-independent witness (a crop re-OCR / located
  read), reusing its shared comparator (`_values_normalise_equal`, calendar+polarity-strict for dates)
  + shared `_CROSSCHECK_CORROB_CONF` constant + `located`/`not-note` filters (Oracle C1–C5), scoped to
  the *role* ref/date keys only, and MEASURE the **genuine survivor +N**. It may be small (the safe
  cases already ship), in which case the honest answer is "already done."

---

## 3. Issue 2 — invoice over-flag (DIAGNOSED, not built)
`engine.py _flag_taught_field_ownership` caps a plain-`keyword` read to 69 + note "generic caption
match" when a taught anchor didn't confirm — even when the keyword read is a precise LABELLED pattern
(`Invoice No.`→`INV-88180`). Fix: exempt a label-anchored keyword read from the cap; fix the copy.
Needs the keyword stage to expose a "labelled" flag (or a label-adjacency check) — real plumbing, so
left for a gated build with reggie (DECISION 3). Note: this REMOVES a review hold → has an auto-file
blast radius → must be kill-switched + corpus-M-gated too.

---

## 4. Reliability review (P4) — findings
1. **The agreement-reward idea (P1)** — the safe form is the tightened `KEYWORD_ANCHOR_CORROB`
   extension above; the naive form is unsafe (reverted).
2. **Safe stale-comment fixes to apply (comment-only, Oracle+review-flagged):** `engine.py:886` and
   `:2422` ("built only when override on" — contradicts the always-on `_field_candidates` ledger);
   `trust.js:515` (says graduation floor "98"; the constant is `TRUSTED_FLOOR=95`). Trivial, safe —
   apply when convenient (I left them for your review rather than churn the tree overnight).
3. `_field_candidates` ledger is rich + under-used outside Stage-4.6 — the natural substrate for
   future consensus signals (supplier/type corroboration).
4. **Fail-toward-review is strongly preserved** everywhere reviewed (`isAutoFileEligible`,
   `docTrustGate`) — no weakening found.

---

## YOUR DECISIONS (I did not ask overnight, as requested)
1. **Pursue the *tightened* cross-tier auto-file lift?** (require a genuine independent crop-re-OCR
   witness; measure the real survivor +N, which may be small). The naive +15 is reverted as unsafe.
2. **Auto-file corroborated *corrections* too?** The healed deskew value (e.g. `PO-98370`) currently
   flags for review (a correction, held by design). Want a *corroborated* correction to auto-file?
   (Trades off fail-toward-review — needs its own gate.)
3. **Build issue 2** (the labelled-keyword exemption)? Needs reggie + keyword-stage plumbing + an
   M-gate (it removes a review hold).

---

## Tree / state
- **Committed (unpushed, 2 ahead of origin):** `5377e24` Slice-1d, `8e2211c` deskew fix.
- **Uncommitted, kept (safe/inert):** `stress_test/realdoc_regression.js` (RR_CONSENSUS dump) +
  `stress_test/consensus_analysis.js` (measurement tooling for the auto-file question).
- **Reverted (NOT committed):** the flawed `CROSS_TIER_CONF_LIFT` engine block.
- **Not applied (documented above):** the 3 safe stale-comment fixes; issue 2.
- Live DB unchanged tonight. The poisoned-link + P2 foreign-field sweeps were applied earlier
  (see `[[project_slice1d_donothing]]`). Deskew fix is safe to keep testing with Straighten ON.
