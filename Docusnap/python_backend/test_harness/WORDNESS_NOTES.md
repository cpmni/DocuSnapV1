# Free-text NAME "wordness" review signal — implementation notes

Built 2026-06-26 (overnight autopilot). Goal: reduce SILENT ERRORS on free-text name
fields (supplier_name / customer_name) — wrong reads that the engine accepts at
moderate/high confidence without flagging — surfaced by the new confidence/review
calibration metric in the test harness.

## What it is
A character-language signal that flags free-text NAME reads that don't read like a name,
so the review layer surfaces them. **FLAG-ONLY**: it adds a review note + caps confidence
at 70; it NEVER rejects or rewrites the winning value (review-not-reject).

Designed with reggie. Failure data (112 wrong name reads) showed a naive vowel/consonant
gate is useless (correct vowel-ratio 0.38 vs wrong 0.41). The signal therefore combines
three levers, in ROI order:
1. **Document-chrome stoplist** (prefix-aware) — name field grabbed a heading ("INVOI",
   "Total"). [~25% of failures] ~0 false-flag.
2. **Ref-bleed / digit-fraction** — name field grabbed a reference/code ("INV-2026021"). [~3%]
3. **Interpolated character TRIGRAM** wordness — catches improbable-cluster OCR garble
   ("Vatum Stagoness", "Aabiield") + short non-word fragments. Interpolation (λ over
   trigram/bigram/unigram/uniform) is the key false-flag defence for coined brand names.

**Honest limits** (documented, by design): clean real-word substitutions ("Club"->"Chub")
and real-word truncations ("Joinery") are NOT catchable by character statistics — they
need the per-supplier lexicon/history (name_match.py). Short coined single-token brand
names sit at the same wordness as short garbles ("zylo" -3.32 ≈ "aabiield" -3.31), so the
threshold is set to protect the MEASURED real-name distribution (0% false-flag on corpus).

## Calibration (synthetic corpus, supplier/customer reads, interpolated model)
threshold `WEAK_TOKEN_LOGPROB = -3.3`: **0% false-flag on correct names**, +9 previously-
silent errors converted to flagged (27/112 wrong total flagged incl. chrome+ref-bleed).

## Files
NEW (delete to rewind):
- `python_backend/extraction/wordness.py`            — runtime scorer + name flag
- `python_backend/extraction/data/char_trigrams.json`— 93 KB offline table (no dep)
- `python_backend/extraction/build_wordness_table.py`— reproducible table builder
- `python_backend/tests/test_wordness.py`            — 39 tests, all pass

GATED EDITS to tracked production files (default OFF → byte-identical; revert to rewind):
- `python_backend/extraction/engine.py`   — `self.name_wordness=False`, `set_name_wordness()`,
  and a Stage-4.5 flag-only branch (between the charset check and the fmt_entry lookup, so
  it works cold). Inert unless enabled AND the table ships.
- `python_backend/process_docs.py`        — `--name-wordness` flag (default off) -> set_name_wordness.

HARNESS edits (all untracked — discard freely):
- `test_harness/metrics.py`  — `apply_wordness_flags()` counterfactual + `confidence_review(flag_key=)`
- `test_harness/reporter.py` — "Wordness gate — counterfactual" report section
- `test_harness/teach.py`    — (separate) seeds anchors from GT for the "taught" run

## How to ENABLE in the product (after morning go/no-go)
1. It is gated off. To turn on: pass `--name-wordness` to process_docs (wire a setting
   `name_wordness_flag` in src/modules/processing/handler.js, default off, like
   `registration`). 2. Ship `extraction/data/char_trigrams.json` (already in repo).

## reggie follow-ups — DONE (2026-06-26)
- **A. word_like self-calibration** — `format_anomaly_checker.build_format_class_index`
  attaches `fmt_entry['word_like']` (mean `value_quality.name_quality` over confirmed
  values >= 0.5). A name-LABELLED but CODE-valued field (e.g. "vendor_name" holding
  "AB-1234") => word_like False => the engine wordness gate self-disables (its own regex
  owns it). Additive key; genuine name fields => True.
- **B. truncation / fragment flag** — `name_match.is_truncated_name(value, lexicon)`: True
  when content-token-count < the history `expected_len` ("Beaumont Care Homes Ltd" where
  history is always "...Ltd - <site>"). Wired into engine Stage 4.5 after the
  `conforms_to_lexicon` check, under the `name_wordness` opt-in. Catches the ~30% fragment
  class character wordness cannot (a fragment is a real word). History-gated => inert
  without confirmed history.
- **BUG FIXED (important):** the Stage-4.5 block (and thus the wordness gate) was guarded by
  `if self.format_class_index and document_slug:` — EMPTY cold, so the engine gate was dead
  without history (the harness measured the effect via the metrics counterfactual, not the
  engine). Guard is now `if document_slug and (self.format_class_index or self.name_wordness):`
  so the gate works COLD as intended. Byte-identical when name_wordness is OFF.

New tests: `tests/test_name_wordness_engine.py` (8 end-to-end checks), extended
`tests/test_name_match.py` (is_truncated_name + word_like). All green; full regression
sweep clean (precedence/stage4.5/label-overrides/value_quality/date_salvage/format-anomaly).

## Recurring-entity measurement of the follow-ups (2026-06-26)
`test_harness/recurring_namecrop_measure.py` — renders a SINGLE recurring multi-site
customer ("Beaumont Care Homes Ltd - <site>"), OCRs it under clean/garble/truncation
variants (REAL Tesseract), builds the confirmed-history lexicon, and replays each read
through engine.extract() with history + name_wordness on. n=225 reads:

  variant        accuracy(base->treat)   handled
  clean   (96)   92->92                  0 false-flags
  garble  (81)   50->60 (+10 repaired)   +15 caught
  trunc.  (48)    0->0                    44 caught
  TOTAL  (225)   142->152                repaired 10 · caught 59 · silent 14 · FALSE-FLAGS 0/142

Caught attribution: TRUNCATION FLAG (follow-up B) = 42 · name_match repair = 10 outright
(+~11 weak suggestions/shape) · wordness 2 · charset 4. The follow-ups DO their job on their
target population (garbled prefix -> repaired "Lid"->"Ltd"; clipped/fragment site -> truncation
flag) with ZERO false-flags on correct names. word_like (A) isn't exercised here (a real name
field is word_like=True; A's payoff is self-disabling on CODE fields, proven by unit test).

FINAL-TOKEN REFINEMENT (2026-06-26): `is_truncated_name` now also flags a value that reaches
expected_len but whose FINAL content token is a 1-2 char fragment at a VARIABLE position
("...Ltd - B", "...Dundonald H") — a right-clip that count-only missed. Engine runs the
truncation test BEFORE conforms_to_lexicon (a fragment still "conforms"). This converted 9
more truncations (silent 23->14, truncation catches 31->42), still 0 false-flags. Guarded by
test_name_match.py (final-token cases) + test_name_wordness_engine.py.

## WIRED ON (2026-06-26)
`name_wordness_flag` setting (default ON; admin sets 'false' to disable) -> `buildTrainingArgs`
(src/modules/processing/handler.js) adds `--name-wordness` on ALL three extraction paths
(batch import, single reprocess, reprocess-all). So it is LIVE in the app by default. Inert
without the shipped char-trigram table. To expose a UI toggle, mirror registration_enabled in
Settings. CLI smoke (process_docs --name-wordness) clean; full regression sweep green.

The earlier full-page `recurring_measure.py` cold run is superseded by this (it produced only
25 reads and the natural failures were charset/chrome, not the follow-ups' types).

## Measurement caveat for the lexicon follow-ups (A/B)
A and B need RECURRING-ENTITY history (a supplier/customer that repeats, building a
stable-prefix lexicon). The synthetic harness corpus deliberately VARIES names (12
companies/customers cycled), so those groups have no stable prefix and the follow-ups are
largely inert ON THIS CORPUS — they are proven by the unit + engine integration tests and
target real deployments. The character wordness signal (the part that helps high-variety
name fields) is what the 1000-doc counterfactual measured (56 caught / 0 false-flag).

## Rebuild the table
`py -3.12 -m extraction.build_wordness_table words_alpha.txt surnames.txt`
Sources (public domain / commercially free): dwyl/english-words (Unlicense), US Census
2010 surnames (US-gov). Optionally add SSA given names.
