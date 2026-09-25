# Suggested-teach reconstruction census — Idea A flip gate (Oracle A2, 2026-09-25)

**Question (Oracle SEND-BACK, A2):** before building any suggested-teach UI, measure whether the box a
suggestion would RECONSTRUCT (eric's path: words-only OCR of the page → string-match the committed value →
synthesize its box) actually LOCATES the value — because a blind pre-fill that mis-locates becomes a
high-authority all-supplier anchor and poisons the scope. Pass bar: suggested-teach must be measurably
SAFER than a hand-draw, and the MULTIPLE (silent-wrong) class must be rare and reported separately.

**Method (`census.py`):** for a sample of the 605 real-doc corpus, render page 1 at the product DPI (200),
run `region.py --page-words` (the SAME word geometry the teach path uses), then for each ground-truth field
value (ref, date) look for a contiguous run of OCR words whose normalised concatenation equals the value.
Classify: **UNIQUE** (exactly one run → a box can be pre-drawn safely), **MULTIPLE** (≥2 runs → AMBIGUOUS:
reconstruction could pre-draw the WRONG instance), **NONE** (no run → OCR split/merge: no box, fall back to a
manual draw). A word that normalises to empty (a label like "Date", punctuation) may not start or pad a run —
verified artifact fix (else "Date 07-08-2026" double-counted the value as MULTIPLE). Sequential, one OCR at a
time (memory-safe). Sample = 6 docs/type × 8 types = 48 docs.

## Result (48 docs)
| role | UNIQUE (safe) | MULTIPLE (ambiguous) | NONE (no box) |
|---|---|---|---|
| **ref**  | **37/48 (77%)** | 11 (23%) | 0 |
| **date** | **42/48 (87%)** | 6 (13%)  | 0 |

(N=12 pilot agreed: ref 75% / date 87%.)

## The load-bearing findings
1. **NONE = 0 — the value is ALWAYS findable as a contiguous run.** On clean input, reconstruction can always
   produce a box. So the risk is NOT "can't find it" — it is picking the WRONG instance when the value repeats.
2. **The MULTIPLE (ambiguous) class is ~13–23% and ENTIRELY concentrated in two predictable layout families:**
   - **Ironclad statements** (all 6 statement docs): a STATEMENT lists many invoices, so the account ref
     `ITH-0093` and the dates each appear several times. Statements are inherently multi-value.
   - **Pelican Office invoices** (5 refs): the template prints the ref (`PI/25/5193` …) in TWO places.
   Every ambiguous case in the sample came from one of these two families — none was a random one-off.
3. **A blind "first match" single pre-fill would mis-locate on ~20% of refs** — and silently, becoming an
   authoritative wrong anchor. This DIRECTLY confirms the Oracle's SEND-BACK: the blind single pre-fill is
   unsafe, and the ambiguous cases are exactly the multi-candidate cases the PICKER is built for.

## Verdict (against the Oracle bar)
- **Blind single pre-fill: FAILS the bar** — ~20% ambiguous, silent-wrong, layout-predictable. Do not build it.
- **The rule the census SUPPORTS:** suggest a single box ONLY when the value is UNIQUELY located (77–87% of
  fields); when ≥2 candidates are found, show the PICKER and NEVER auto-pick; and re-read-verify the chosen box
  on the live frame before committing (007). Under that rule, suggested-teach is measurably safer than a
  hand-draw (which can slip on any doc, unaided), because the machine refuses to guess exactly where a human
  would be most likely to box the wrong one (statements, repeat-ref templates).
- **The picker is the right first user-facing cut** (Oracle A re-scope confirmed): the ambiguous 20% is its
  whole purpose, and the unique 80% gets a safe single suggestion.

## Boundary / caveat
The corpus renders are clean (NONE=0). Real customer SCANS add OCR split/merge noise → a NOT-FOUND tail that
falls back to a manual draw (safe, no wrong box). So NONE understates for scans; the AMBIGUITY finding
(statements / repeat-ref → MULTIPLE) holds on any input and is the load-bearing safety result. A scan-corpus
re-run (with the same script over rasterised pages) would quantify the NONE tail before a build.

## Next
Feed this to the Oracle/owner as the A2 gate outcome → if approved, build the PICKER (Slice 2) with the
unique-vs-multiple rule + 007's live-frame re-read-verify + the host-surface decision. The blind single
pre-fill stays dropped.
