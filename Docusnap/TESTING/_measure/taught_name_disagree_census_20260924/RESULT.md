# G2 census — page-family disagreement refusal for TAUGHT optional NAME fields (2026-09-24; Oracle: CENSUS FIRST)

**Question (gary Slice 2):** if `_pageFamilyDisagrees` were extended from the ref/date roles to taught optional name-like
fields (`template_mapping` winner, a keyword witness on `disagree`, witness `nameQuality ≥ 0.6`), how many CORRECT boxes
would a wrong page read hold (false holds) vs how many WRONG boxes would it catch? Oracle's bar: build DARK only if
false holds ≤ ~5 % of the population.

**Populations (read-only SQL, `census.py`):**
| DB | optional text rows w/ mapping winner | name-like | page family disagrees | witness quality ≥ 0.6 |
|---|---|---|---|---|
| owner's 727-doc live copy | 236 | 133 | 42 | **30** |
| Chris's 09-23 sandbox (80 docs) | 10 | 10 | 6 | **6** |

## Adjudication of the 30 (owner's copy) — by hand against the stored / original / corrected values
| class | n | rows |
|---|---|---|
| **CATCH — the human corrected the box TO the page witness** | 7 | #82 `Cus…`→`Ashcombe Care Homes Ltd` · #81/#78 →`Stonegate Property Mgmt` · #139 →`Bluefin Marine Ltd` · #229 `edwood Co…`→`Redwood Construction` · #613 →`Workforce Training Springfield Rd` · #821 →`Harvey & Company Accountancy` |
| **CATCH — the box is a CLIPPED prefix, the page read is the fuller name** | 8 | `Stonegate Property`→`… Mgmt` ×4 (#134/135/141/142) · `Ashcombe Care Homes`→`… Ltd` ×2 (#238/240) · `Workforce Training Springf`→`… Springfield Rd` ×2 (#861/871) |
| **CATCH — the box is the LABEL word** | 1 | #75 `Customer` vs `Sandpiper Hotels` (mig 213 catches this too) |
| **CATCH — the box is a garble, the page read is right** (machine-filed, no correction; and two a human confirmed as-is) | 8 | #7 `Corvus Securitv` · #19 `Meadowvale Farn` · #158 `Larch & Hollow Cafe Ca` · #264 `Kinafisher Print Studio` · #243 `CH1 2HU` (a postcode; mig 156) · #856 `Utax` vs `John McCaffrey & Co 2` (Print Tracker `customer`: a printer MAKE in the customer box) · #157 `vineficher Print Studio` (human confirmed the garble) · #151 `Ashcombe Care Homes I` (human confirmed the clip) |
| **FALSE HOLD — the box is right, the page witness is a single LABEL / FRAGMENT word** | 5 | #593/#671/#673/#810 `GAELCHURSAI` vs `Make` (Print Tracker) · #256 `Kingfisher Print Studio` vs `Studio` |
| **FALSE HOLD — the box is right, the page witness is an OCR misread** | 1 | #262 `Fernbank Veterinary Clinic` vs `Fembank …` (rn→m) |
**Chris's sandbox: 6 of 6 are catches** (`Customer` ×2, `Larch & Hollaw cat. -.`, `Ashcombe Care Homec`, and the two clips
`Larch & Hollow Cafe C` / `Ashcombe Care Homes`), 0 false holds — exactly his card-1 exhibit.

## Verdict
- As specified (witness `nameQuality ≥ 0.6` only): **24 catches · 6 false holds = 20 % of 30 → FAILS the bar.**
  `nameQuality` gives a lone word (`Make`, `Studio`) a perfect score, so the floor does not filter a label/fragment
  witness.
- **With ONE extra guard — the page witness must carry ≥ 2 tokens** (a lone word is never a credible name witness
  against a taught box): population 25, **24 catches · 1 false hold (`Fembank`, an OCR misread) = 4 % → MEETS the bar.**
  The residual is the honest trade-off gary named ("a wrong keyword witness holds a correct box") — one document in
  727, review-bound.
- Containment (box = a prefix of the witness) is 9 of the 30 and is ALWAYS a catch here (the box clipped the tail) — the
  v1.1 "containment exemption" must NOT be added; keep containment as a hold.

**Recommendation for the design → Oracle round:** build G2 DARK with gary's predicate + the ≥ 2-token witness guard
(`taught_name_disagree_refuse`, HARD deps `trust_role_disagreement_refuse` + `role_disagree_refuse_at100`), pins on the
six sandbox rows (catch), `Fembank` (the pinned trade-off), `Make`/`Studio` (no hold), and the 7 human-corrected rows.
The flip gate is this census re-run after the build (same 30 → the same 24/1) plus the 727 harness M=0.
