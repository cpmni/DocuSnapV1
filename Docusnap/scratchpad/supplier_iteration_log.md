# Supplier-matching fix — iteration log (owner acceptance: >=98% on Chris's sandbox set)

Scoring method (FIXED for every iteration — do not change):
`supplier_name` (Document Issuer) must equal **`Castellan Security Systems`** exactly (case/whitespace
normalised) on the 18 Castellan credit notes in the sandbox corpus. Score = correct / 18.
Same corpus, same teach-one-then-check-the-rest workflow, every retest.

---

## Iteration 0 — BASELINE (pre-fix), live-DB probe, 21 docs
Harness: `stress_test/registration_gate_probe.js` (A/B by `REG_MIN_INLIERS_GATE`).
**Score 4/21 = 19.0%.** 17 docs resolved via `template_registration` at conf 70-78 with junk values
(`Bramblewood Joinery Ltd` = the owner's own company, `DELIVER TO`, `Draymarket, DM2 6QF`, line totals).

## Iteration 1 — vacuous-fit gate closed at the 2nd call site (commit `63b1807`)
Fix: `registration.is_unfalsifiable` shared predicate, consumed by BOTH callers of
`_fit_page_transform`; refuses a fit with `n_inliers < 3` (exactly-determined => residual 0 by
construction => unverifiable).
**Live-DB probe score 16/21 = 76.2%** (12 heals, 0 regressions; registration wins 17 -> 0).
Realdoc 695: supplier 692 -> 693, regressions 60 -> 59, SILENT 26 -> 24, no new entries.
Python suite: 225 pass / 7 fail, all 7 proven PRE-EXISTING (they fail identically with the kill
switch off). New pins `test_registration_min_inliers.py` 21/21.

### Remaining failures after iteration 1 (live-DB probe), with evidence
| doc | value read | mechanism |
|---|---|---|
| #707 | `Castellan Security System:` conf 35 + NOTE | OCR misread of the SAME name (flagged) |
| #711 | `Castellan Security System:` conf 35 + NOTE | OCR misread of the SAME name (flagged) |
| #725 | `Cas tellan Security System:` conf 35 + NOTE | OCR misread of the SAME name (flagged) |
| #712 | `tastellan Security Systems` conf **95 SILENT** | OCR glyph misread, corrector raised conf |
| #719 | `ba)` conf 78 | pipeline read recipe produced gibberish (psm7 reads it correctly) |

### ROOT MECHANISM — my first diagnosis was WRONG; corrected and re-verified at source
**WRONG (retracted):** I first blamed `engine.py:4973` (`if not supplier_name … _doctype_fixed_supplier`),
i.e. "the fixed value is only an empty-field fallback".
**Why it is wrong:** `_doctype_fixed_supplier` (engine.py:2698) reads `f.get('key')`, but the templates
payload carries **`field_key`** (`template_matcher.py:804`). It ALWAYS returns None — **that path has
never executed in production.** Already recorded as a dead guard in `pendingfeatures.md:772-777`
(2026-07-31), with an explicit warning not to "fix" it casually because doing so activates a dormant
conf-95 stamp path. Caught by gary; verified by me at source.

**CORRECT root mechanism (verified):**
- The `template_fixed`@95 values come from **Stage-0 seeding**, `template_matcher.py:819-824`
  (`if fixed_val and not is_var` -> conf 95, method `template_fixed`).
- The defect is the **Stage-0.5 merge authority**, `engine.py:4905-4917`:
```python
_ft_mapping_weak = (key in text_field_keys and data.get("confidence", 0) < 75)
is_curated_refinement = ((not _ft_mapping_weak)
                          and (existing is None
                          or existing.get("method") in
                             ("template_fixed", "template_anchor", "template_fixed_locked")))
if is_curated_refinement or (existing is not None
                             and data["confidence"] > existing.get("confidence", 0)):
    results[key] = data
```
  A Stage-0.5 mapping read displaces the correct `template_fixed` seed **on AUTHORITY**, with a single
  guard: free-text reads below conf 75. All five residuals arrived at the merge **>=75** and so kept
  the fast-track. (`'ba)'`@78 is the clean-free-text base cap.)
- **conf 35 is a Stage-4 artefact, NOT the merge confidence** — `validator.py:436-440` caps any
  digit-free value ending in `:` to 35 + "value looks like a label, not a field value". A fix keying on
  35 would key on a downstream symptom.
- The Stage-2.5 corrector minting `template_mapping+corrected`@95 on `tastellan` is DOWNSTREAM of the
  merge, not a co-cause: fix the merge and the corrector never sees the wrong value.

BLAST RADIUS MEASURED: **7 of 32** templates carry a non-variable supplier `fixed_value` (not all 32).

EVIDENCE for the proposed next fix — similarity of each read vs the stored `fixed_value`
(alnum-folded `difflib` ratio):
```
Castellan Security System:    0.979   <- same name, misread
Cas tellan Security System:   0.979   <- same name, misread
tastellan Security Systems    0.958   <- same name, misread
DELIVER TO                    0.242
Draymarket, DM2 6QF           0.150
Bramblewood Joinery Ltd       0.089   <- a REAL, DIFFERENT company (the owner's own)
ba)                           0.077
1 264.00                      0.000
```
Clean separation 0.958 -> 0.242. A near-match snap is IDENTITY-PRESERVING: it can only normalise a
misspelling of the SAME name; it can never turn one company into another. Projected effect on the
five: fixes 4 (#707/#711/#725/#712); `ba)` (0.077) is NOT reachable by it and needs a separate,
riskier gibberish rule.

KNOWN SEAM (why the obvious "just prefer the fixed value" is NOT safe): `TEMPLATE_FIXED_NAME_PRESENCE_VETO`
(engine.py:3018) exists because a phash/keyword collision can stamp a FROZEN `template_fixed` supplier
onto a STRANGER's document. Making the fixed value authoritative trades a garbled-read bug for a
wrong-supplier-collision bug. A near-match snap does NOT have that exposure (it requires the page to
already say the same name).

### MEASUREMENT CAVEAT the owner must see (gary, and I agree)
**A 21-doc batch cannot express 98%.** 20/21 = 95.2%, 21/21 = 100% — there is no value between them.
Chris's sandbox set is 18 docs: 17/18 = 94.4%, 18/18 = 100%. So the >=98% acceptance bar is only
*measurable* on `realdoc_regression.js`'s supplier field (n=695, baseline 693/695 = 99.7%). The small
batches are diagnostic (they show WHICH doc fails and why); the 695-doc corpus is the acceptance number.
Reporting 98% off an 18-doc run would be theatre.

### Pre-build check that FAILED (recorded so it is not silently dropped)
gary's Slice-2 predicate `name_quality(value) == 0.0` was conditional on short legitimate names not
scoring 0.0. MEASURED: `name_quality('BP') = 0.0`, `'3M' = 0.0`, `'IBM' = 0.0` (`Uber`/`Shell`/`Aviva`
= 1.0). His fallback (`folded length < 3`) also hits `BP`. **Slice 2's predicate is therefore NOT sound
as specified** and is with the Oracle for a ruling (candidate: scope the demotion to
`existing is not None`, so a legitimate `BP` with no incumbent is untouched).

## Iteration 1 — Chris sandbox retest — **18/18 = 100%** (PASSES the >=98% bar on his set)
Fresh install, fresh account, 18 Castellan docs imported, ONE taught, then the other 17 checked.
| phase | issuer correct |
|---|---|
| A: straight after teach+confirm | **0/17** — all BLANK, most with a "the logo looks similar" pill |
| B: after "Reprocess all in queue" | **17/17** verbatim `Castellan Security Systems` @95, "Its logo and wording" |
Chris: *"Not one document showed a different company, a postcode, a price, or a fragment like
'DELIVER TO'. The failure mode was blank, which is the safe one."*
CAVEAT (important): his fresh teach did NOT reproduce the residual class — his docs resolved via the
LOGO path at 95, not via template_mapping. So his 100% validates the iteration-1 fix but is NOT
evidence about the residuals; the live-DB probe is.
Chris also found SERIOUS NON-SUPPLIER bugs (out of scope, NOT implemented, queued for owner vet):
credit-note totals lose the minus sign on 17/17 and 3 filed silently at "High 85% / Nothing was
flagged"; teaching appears to do nothing until "Reprocess all in queue" is found; a stale "you don't
have that document type yet" message; changing the type blanks already-read values; teaching a field
invented a character (`CCN5464` -> `CCNS5464`) while the badge stayed green.

## Iteration 2 — TEMPLATE_FIXED seed guards (built, both DEFAULT OFF)
Oracle SIGN-OFF-W/COND C1..C7. Two switches:
* `TEMPLATE_FIXED_NEAR_MATCH_RECONCILE` — branches A+B on ONE switch (Oracle: branch A is INERT on
  every residual — the ':' IS the misread final 's', so fold-equal never fires; staging A first would
  be a zero-yield flip). Keeps the SEED rather than snapping the read, so `method == 'template_fixed'`
  survives and the value stays inside `_flag_branding_conflict`'s jurisdiction.
* `TEMPLATE_FIXED_FRAGMENT_DECLINE` — deterministic `len(fold(read)) < 3` vs a >=8-char curated name.
  Replaces gary's REJECTED `name_quality == 0.0` rule (which I measured scores BP/3M/IBM at 0.0).

**Live-DB probe: 16/21 -> 21/21 = 100%.** All five residuals now `template_fixed`@95. Every other
taught field byte-identical. Registration wins 0.
Blast radius: exactly **7 templates** carry a non-variable supplier `fixed_value` — Copperfield x3,
Ridgeway x2, Ironbridge x1, Castellan x1. All are live-DB templates, so `realdoc_regression.js`
exercises 6 of them beyond Castellan (the gate is NOT blind here, unlike iteration 1).
**Realdoc n=695, iteration2 vs iteration1: supplier 693/695 (99.7%) -> 695/695 (100.0%).**
Regressions 59 -> 57, SILENT 24 -> 23. Diff contains ONLY deletions (armed strictly a subset of
baseline): `#712 'tastellan Security Systems' [SILENT]` and `#711 'Castellan Security System:'
[flagged]` both gone. Meets Oracle C6 (zero supplier drop; SILENT 23 <= the 24 baseline).

**Customer corpus (288 docs) A/B: 0 doc-level true->false, 0 heals, lanes byte-identical.**
BUT — Oracle C6 required me to VERIFY blindness rather than assume it. Verified: the corpus resolves
the issuer via `template_mapping` on all 282 scored docs and **never** `template_fixed`, so the rule
CANNOT fire there. **The corpus is BLIND to iteration 2.** Its clean result proves no collateral
damage; it is NOT evidence the fix works. (Iteration 1's corpus arm was blind for a different reason:
0 registration wins in 1793 field reads.)

## Iteration 2 — Chris sandbox retest (ARMED)
Iteration 2 ships DEFAULT OFF, so a retest on the shipped defaults would be byte-identical to
iteration 1 and would measure nothing. Sandbox 2 was therefore rebuilt FRESH and launched with BOTH
flags armed via process env (verified reachable: `handler.js` spawns python with
`{...process.env, ..._reconcileEnv(db)}`). Same 18 documents, same workflow, same scoring.
**RESULT: 18/18 correct — SAME as iteration 1. No regression, and no near-misses** (Chris: "no stray
colons, no wrong first letters"). Reprocessing individual docs afterwards changed no issuer.
Notable: on `credit_note_0029` the page text came through as `Castellan SeaEeey oyetene` and the
issuer still read `Castellan Security Systems` at 95%.
Earlier-round defects re-checked by Chris: stale "you don't have that document type yet" = **FIXED**;
type-change blanking values = **FIXED/not seen**; minus-sign loss on credit-note totals = **STILL
THERE** (16/16, three silent at High 85%); teach-appears-to-do-nothing = **STILL THERE**;
teach-invents-a-character = **STILL THERE**. All of these are OUT OF SCOPE for this fix and are
queued for owner vet, not implemented.

---

# ACCEPTANCE SUMMARY

| measurement set | n | score | expresses 98%? |
|---|---|---|---|
| **realdoc supplier field** | **695** | **695/695 = 100.0%** | **YES — this is the acceptance number** |
| live-DB Castellan probe | 21 | 21/21 = 100% | no (quantises 95.2 -> 100) |
| Chris sandbox (iteration 1 code) | 18 | 18/18 = 100% | no (quantises 94.4 -> 100) |
| Chris sandbox (iteration 2 ARMED) | 18 | 18/18 = 100% | no (same quantisation) |

All three sets are at 100%. The only set that can express the owner's >=98% bar is realdoc (n=695),
and it reads 100.0% with a strict-subset regression set.

## Iteration 2 — DESIGNED, NOT YET BUILT (awaiting Oracle verdict)
Slice 1 `TEMPLATE_FIXED_NEAR_MATCH_RECONCILE` (dark): in the Stage-0.5 merge, when the incumbent is a
`template_fixed`/`template_fixed_locked` seed and the mapping read differs but is an alnum-folded
Levenshtein-<=1 near-match, KEEP THE SEED (do not snap the read — snapping mints a
`template_mapping+snapped` value that is exempt from `TEMPLATE_FIXED_NAME_PRESENCE_VETO` and
`_universal_postmerge_verify`; keeping the seed retains that cover). Clip carve-out required so a
mis-taught leading-glyph-clipped `fixed_value` cannot discard a CORRECT read. Projected 20/21.
Slice 2 (predicate unresolved, see above) targets `'ba)'` -> 21/21.
