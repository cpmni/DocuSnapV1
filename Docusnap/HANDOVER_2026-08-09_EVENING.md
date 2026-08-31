# HANDOVER — 2026-08-09 EVENING — the money slice: totals 89 → 119 of 120, zero wrong, Oracle SIGN-OFF-W/COND

**Branch `feat/teach-side-overnight`. Commit `7951156` + UNCOMMITTED hardening in the working tree.**
Both flags DEFAULT OFF. Nothing has been flipped. Reverting is `git checkout 6d7f887 -- Docusnap/python_backend/extraction/template_mapper.py`, or simply leaving the switches off.

---

## THE NUMBER

Replaying the owner's **live** taught state over 200 corpus documents (`stress_test/teach_run_ab.js`,
arms `issuer` → `money`, scored by `score_teach_run.py` against corpus ground truth):

| lane | baseline | both flags on |
|---|---|---|
| **total** | **89 ok / 28 wrong / 3 empty** | **119 / 0 wrong / 1 empty** |
| issuer | 121 / 19 / 0 | 121 / 19 / 0 |
| ref | 120 / 20 / 0 | 120 / 20 / 0 |
| date | 140 / 0 / 0 | 140 / 0 / 0 |
| customer | 138 / 2 / 0 | 138 / 2 / 0 |
| vat_no · account_no · po_ref · serials | — | identical |

**30 healed, 0 regressed, 0 wrong values, supplier_name changed on 0 documents, template_id on 0.**

The single remaining EMPTY (Nordwind quote 0015) is not a new failure: with Oracle's C1
anti-truncation leg in place that document's snap is correctly refused, so it falls back to **exactly
the baseline read** — `'2.205.60'` (a comma OCR'd as a period, hence unparseable) at confidence 50,
carrying the same "total is less than the subtotal" review note it carries today. A heal that no
longer fires, in the safe direction. Before C1/C2 the lane was 120/0/0 (31 heals).

**OFF-inertness came free:** the baseline arm ran on the edited code with both flags off and
reproduced this morning's handover table lane-for-lane, all nine fields. Post-edit OFF == pre-edit,
n=140.

---

## WHAT WAS WRONG (two mechanisms, neither where the morning handover pointed)

**1. The taught box is one row too high — 19 of 23 wrong totals.**
`_label_drifted`'s vertical tolerance is floored at `_DRIFT_FLOOR = 0.02` page-height while body text
runs ~0.013/row, so a genuine ONE-ROW label move measures as "not drifted", the stationary box
stands, and it reads the **VAT row**. The signature that found it: 19 of 23 wrong totals were
**exactly truth ÷ 6** — at 20% VAT, `total = subtotal × 1.2 = (VAT × 5) × 1.2 = VAT × 6`. The totals
block reflows down with line-item count, so no re-teach can fix it. The function's own docstring
claimed "a true one-line shift still trips it" — false for any line under 0.04 page-height, i.e.
every line of body text. Corrected in place rather than deleted.

**2. The taught box is too narrow, and the repair was on the wrong rung.**
Money is right-aligned so a longer value overflows LEFT (`£10,603.44` read as `0,603.44`). The
previous session admitted currency to the ABSOLUTE-rung edge guard and measured inert — because the
absolute read on that page is OCR debris (the box lands on a line-item row); the committed value
comes from the **derived** rung, whose repair primitive is `_snap_box_to_words`, scoped by the same
`_SNAP_VAL_TYPES`. The locate tier already read `£10,603.44` at 76% inside the seated box.

---

## THE FLAGS

```powershell
$env:TEMPLATE_CURRENCY_EDGE_GROW=1      # currency admitted to the derived-rung word snap + abs guard
$env:TEMPLATE_DRIFT_ROW_PITCH=1         # sub-floor one-row drift, exact-label only
```
**DEPENDENCY, record it or a flip will look like a bug:** `TEMPLATE_CURRENCY_EDGE_GROW` is inert
unless `template_target_word_snap` is ON (snap leg) or `template_abs_edge_guard` is ON (guard leg).
Both are `true` settings rows in the live and sandbox DBs today.
**There is no `_reconcileEnv` bridge for either flag** — env-at-launch only, like the rest of the
08-09 launch set. No Settings toggle exists.

---

## WHAT THE CORPUS REFUSED — the most useful thing in this session

The first version of the row fix simply dropped the floor. It **regressed 14 non-money fields** in a
second taught state: dates committing codes, codes committing dates. Traced to the page — needle
`'Credit Ref'` fuzzy-matched the caption `'Credit Date'` one row below (they share `'Credit'`), and
believing that mis-locate seated the credit-note number on the date row.

**The 0.02 floor was doing a second job nobody wrote down: shielding fuzzy label mis-matches onto
adjacent captions.** So sub-floor drift now requires `_label_is_the_taught_one`. Collateral 14 → 0,
money moves kept.

---

## THE ADVISOR PASSES — three of my claims and two of theirs were falsified

**gary** — my exactness predicate accepted "label + any digit in the tail", and `matched_text` is the
whole OCR **line**, so it admitted any caption that EXTENDS the taught label: `'Total'` →
`'Total VAT 1,767.24'`. Fix: the FIRST tail token must carry the digit.
He also found `_DRIFT_FLOOR` is a page-scale constant used as a row-scale predicate in **three**
places — `_target_inline_with_anchor` (fixed 08-07), `_label_drifted` (this session), and the
**registration arbiter, still unfixed** — and that a False drift verdict sets `anchor_stable = True`,
which *vetoes* that arbiter. The floor disarmed the redundant detector too.

**007** — **two of my three money pins were vacuous**: at 47.0% and 11.8% inside, both geometries were
rejected by the shared majority-inside floor before the money leg ran, and deleting the leg left them
green. Verified independently using a *code* as control (the code was refused too, so the money leg
was not the rejecter). He also showed the right-edge rule **guards the wrong edge** — money's only
failure direction is left, and a snap is a re-fit that can SHRINK past a leading token — and that it
is **row-blind**, since every figure in a totals column shares a right edge.

**Measurement then overruled BOTH advisors.** They independently agreed on dropping the inline form
of the exactness predicate, reasoning that no measured heal used it. Re-running the corpus with it
gone **cost 4 heals** (120 → 116): the Nordwind and Veltrix templates are taught against
`'Total (inc VAT)'` / `'Total inc. VAT'`, whose rows print label and value together, so they can never
satisfy exact equality and reverted to the VAT row. gary's narrower first-token rule keeps all four
and still refuses every dangerous case. **Do not re-litigate this from reasoning; it is pinned.**

---

## ORACLE — SIGN OFF WITH CONDITIONS (3 BLOCKING, 4 REQUIRED)

Rulings on the forks: **(a) NOT wrong layer** — `_label_drifted` already measures ONE label against
its own taught box; global precedence-by-evidence has a far larger blast radius and was measured
harmful before. **(d) repeated-caption residual ACCEPTED**, no geometric corroborator required.
**(c) `realdoc_regression.js` is NOT a precondition** — one call site, template-mapping-only, and the
live DB's 7 confirmed documents make that harness *vacuous, not lenient*.

**The seam neither advisor named:** the drift branch `return relocated` **skips `_abs_edge_guard`**.
So on exactly the documents flag 2 fires, flag 1's absolute-rung admission is unreachable — the two
currency scopes are **mutually exclusive on the drift population, not additive**, and money moves off
the rung that PROVES a digit-suffix relation onto the rung that ADOPTS on geometry alone.

**Why his conditions are blocking:** a derived money read has **no other guard**. Confidence is a flat
90 (the `ocr_conf` cap is free-text only) which clears the 88 auto-file floor; `currency ∈
_SELF_VALIDATING_TYPES` so the learned-shape check is a no-op; Stage 4's `subtotal + tax = total` is
flag-only, total-role only, and returns None without a shadow subtotal. **The geometry legs are the
entire safety.**

### DONE this session

- **C1 (BLOCKING) — CLOSED.** The anti-truncation leg scanned only words *intersecting* the seated
  box, so a leading token **fully outside** was invisible — the exact case Oracle's 08-06 ruling named
  and my comment claimed to cover. Now scans the whole row band. Exhibit: taught `£99.00`, sibling
  prints `£15,707.84`, Tesseract splits `'£15,' + '707.84'`, commits `707.84` at 90 and auto-files.
- **C2 (BLOCKING) — CLOSED.** The dropped-token test was digits-only, so a separately tokenised
  leading `-` was dropped and **a credit note committed POSITIVE**, unflagged. Now accepts
  sign/currency-only tokens as value-ish. The row-fix exhibit (doc 263) is itself a credit note.
- **C5 — CLOSED.** 007's frame pin asserted a state `_locate_anchor` cannot return; rewritten as an
  explicitly defensive pin that says so.
- Both new pins were **verified failing pre-fix**, as Oracle required.
- **One deviation attempted and self-refuted, recorded so it is not retried:** I narrowed C2's token
  set to sign-only (dropping `£$€`), reasoning that losing a currency symbol cannot change the number
  while losing a `-` can, and blaming the symbol for the one lost heal. **The measurement refuted it**
  — both variants score identically (119/0/1), so the lost heal comes from C1's row-band widening.
  Reverted to Oracle's wording. Deviating from a signed condition needs evidence, and mine evaporated.

### OUTSTANDING — do these before any flip

- **C3 (BLOCKING).** Give the derived rung the proof the absolute rung already requires: when armed
  and the snap moved the box, read the un-snapped box too and adopt only if
  `digits(snapped).endswith(digits(unsnapped))` and the snapped integer part is longer — the same
  predicate as `_abs_edge_guard`. Verified against the exhibits: `'060344'` → `'1060344'` passes; the
  C1 truncation `'1570784'` → `'70784'` fails. **Escape hatch:** ship without it if you census the
  snap-moved population across both taught states and show zero cases where the snapped read is not a
  left-extension of the un-snapped one.
- **C4.** Correct three remaining comment claims in `template_mapper.py`: the Stage-4 cross-check is a
  conditional review FLAG, total-role only, needing a shadow subtotal (`validator.py:368,440`) — not a
  backstop; the two currency scopes are mutually exclusive on the drift population; confidence is
  **90, not ~92**, and it auto-files.
- **C6 gate.** Re-run the corpus arm **diffing method and confidence, not only value** (same value,
  new provenance, different auto-file decision); census `extraction_method LIKE
  'template_registration%'` armed vs baseline, expect 0; re-run the **second** taught state (the only
  arm that has ever produced a regression here).
- **C7.** Measure the exactness hit-rate — log `matched_text` vs `anchor_text` for every currency
  mapping across the ten issuers. That is flag 2's recall ceiling, and 31/31 does not evidence it.

### Premise corrections Oracle made to MY framing (do not re-derive them wrongly)

- **Money clips COMMIT — they never failed safe.** `'0,603.44'` passes `_crop_is_credible`. The seam
  is milder than I filed it: the change alters *which* number commits, not fail-safe → silent-wrong.
- **`'Balance Due'` ships as `total_amount`** (`document_types.js:632`), so the Pelican exhibit IS the
  total role and does get the Stage-4 check. Only an operator-created extra money field has none.
- **Recall ceiling (A3):** flag 2 needs the OCR line to contain ONLY the label. `_ocr_lines` runs
  `--psm 6` with no column segmentation, and the corpus draws one totals geometry for all ten issuers.
  31/31 is evidence about one geometry, not about the class. **Do not report "money is fixed."**

---

## FILES

- `python_backend/extraction/template_mapper.py` — two flag blocks; `_label_drifted` +
  `_label_is_the_taught_one`; `_snap_box_to_words` money legs; `_extract_one` drift branch.
- `python_backend/tests/test_currency_snap_drift_row.py` — **25 pins**, all green.
- `stress_test/teach_run_ab.js` — new arms `money`, `money_row`, `money_snap`.
- Related batteries green: `test_template_mapper_drift`, `test_template_target_word_snap`,
  `test_template_mapper`, `test_template_abs_edge_guard`, `test_registration_arbiter`,
  `test_template_edge_cut_relocate`, `test_template_inline_row_overlap`, `test_anchor_drift_guard`,
  `test_teach_side_gates`, `test_teach_angle_compose_scan`.

## GOTCHAS EARNED TODAY

- **`TESTING\_sandbox\userData\docusnap.db` is a STALE taught state.** Its totals lane scores 1% for
  reasons that predate any of this work (Ironclad/Meadowvale have no taught total box, so they fall to
  `anchor_inline`). The owner's real teach state is the live `%APPDATA%\ScanFinder\docusnap.db`, which
  reproduces the morning handover's numbers exactly. Point `TEACH_DB` at it. Keep using the sandbox as
  a SECOND state for collateral — it is the only arm that has ever caught a regression here.
- **A green pin proves nothing until you show it can fail.** Two of mine were rejected upstream of the
  code they claimed to test. Use a control (a *code* where the money leg does not apply): if the
  control is refused too, the pin is vacuous.
- **A guard that cannot fire is worse than no guard.** I wrote a 2× width cap that majority-inside
  makes unreachable, and dropped it.
- Never edit a Python extraction file while an arm is running — workers import per shard.
- `_label_drifted` now takes three arguments; the third is pinned by source-string match.

---

## NEXT SESSION — WORKFLOW MODE

The owner is moving to a multi-agent audit of the OCR/field-detection system. The corrected prompt is
below, ready to paste. Changes from the draft, all verified against the source rather than assumed:

1. **`llm.py` does not exist.** The AI mode was removed and Fast/Smart collapsed because of it. The
   original draft's "Stage 3: llm.py, dormant" and its matching safety rule would have sent an agent
   hunting a ghost.
2. **Electron 31, not 41** (`package.json`).
3. **Stage 4.6 added** — a gated, default-off candidate override at `engine.py:2497`, missing from the
   draft's pipeline list.
4. **Measurement authorised and instruments named.** Read-only does not mean numberless; without this
   the audit produces a code-reading essay and burns an agent rediscovering the corpus.
5. **Flag-state resolution made mandatory.** Dozens of behaviours sit behind default-OFF switches. An
   audit that reads code without resolving which paths RUN will describe dark code as live behaviour.
6. **Seeded with today's open leads** so they are not re-derived at cost.
7. **Vacuous-guard and dead-pin detection added** to the rules — this session produced three.

### Model choice

Run the workflow **on Opus 5**, with per-agent `model` overrides pushing the four investigators down a
tier. The fan-out is bounded, mechanical reading; the synthesis, adversarial verification and
"is this one root cause or four" judgment are where this session's value came from — correcting a
premise about which rung produced a value, catching vacuous pins, and letting a measurement overrule
two advisors who agreed with each other. None of that comes from reading more files. The
reconciliation stage also has to hold every investigator's report at once to find contradictions,
which is a context-capacity problem before it is a reasoning one.

**Budget for the verify stage, not the find stage.** This codebase's failure mode is not missing
findings — it is confident wrong ones. Today: three of mine, two of the advisors'.

To evaluate Fable properly rather than by vibes, run ONE phase — the four investigators, same file
lists — both ways and compare the structured returns for citation accuracy: do the `file:line`
references actually say what the agent claims? That is measurable in an hour and is the same
discipline the rest of this repo runs on.

---

## THE WORKFLOW PROMPT (corrected — paste as-is)

````
You are auditing the OCR and field-detection system in ScanFinder, whose current source code and
internal identifiers still use the DocuSnap name.

Read CLAUDE.md first. Treat it as the primary source of truth. Read only the smallest number of
additional files required for this audit. Do not scan the whole repository unless a targeted
investigation proves that the initial scope is insufficient.

<context>
ScanFinder is a Windows desktop document-processing application built with:

- Electron 31 and Node.js
- Python 3.12 backend
- Tesseract OCR
- SQLite through better-sqlite3
- Vanilla HTML/CSS/JavaScript renderers
- Local template, anchor, supplier-hint, logo, and OCR-correction learning

The application processes invoices, sales orders, purchase orders, and custom document types. It OCRs
scanned documents, extracts fields, validates them, sends uncertain documents to Review, learns from
confirmations and corrections, and files confirmed documents into structured folders with XML
metadata.

The product is branded ScanFinder, but the repository, database, application paths, and many code
identifiers still use DocuSnap. Do not rename existing identifiers as part of this work.
</context>

<objective>
Audit the complete ScanFinder OCR and field-detection pipeline.

Determine whether current field-detection failures can be improved through safe shared changes, while
preserving correct behaviour and preventing incorrect values from being automatically confirmed or
filed.

Do not implement any code during this audit.

The key decision rule is:

Do not make blanket changes until you have proved that the failures share a root cause and measured
the expected blast radius.
</objective>

<known_architecture>
The main extraction path is:

process_docs.py
→ ExtractionEngine.extract()
→ Stage 0: template_matcher.py
→ Stage 0.5: template_mapper.py
→ Stage 1: keyword.py
→ Stage 2: anchor.py
→ Stage 2.5: ocr_corrector.py and learned hints
→ Stage 4: validator.py
→ Stage 4.5: format_anomaly_checker.py and name_match.py
→ Stage 4.6: gated candidate override (engine.py, DEFAULT OFF)
→ sanitise_extractions()
→ Electron persistence
→ Review queue or automatic confirmation
→ confirm-review
→ filing/handler.js
→ structured output folder and XML metadata
→ learning tables and templates

THERE IS NO STAGE 3 AND NO llm.py. The AI mode was removed and the Fast/Smart user choice was
collapsed because of it; `processing_mode` and `--mode` remain only for tolerance. Do not look for a
dormant LLM extraction route — if you find code referencing one, report it as dead code, not as a
pipeline stage.

The most likely initial files are:

- python_backend/process_docs.py
- python_backend/extraction/engine.py
- python_backend/extraction/template_matcher.py
- python_backend/extraction/template_mapper.py
- python_backend/extraction/keyword.py
- python_backend/extraction/anchor.py
- python_backend/extraction/ocr_corrector.py
- python_backend/extraction/validator.py
- python_backend/extraction/format_anomaly_checker.py
- config/keyword_patterns.json
- src/modules/processing/handler.js
- src/modules/review/handler.js
- src/modules/filing/handler.js
- database/modules/learning.js
- database/modules/documents.js
- database/modules/templates.js
- database/modules/trust.js
- relevant files under python_backend/tests/
- only the specific renderer or IPC files needed to understand Review or confirmation behaviour

Do not assume every listed file needs to be opened. Start with the smallest relevant subset.

`docs/extraction-pipeline.md` already contains much of the stage-by-stage map you are being asked to
produce. DIFF AGAINST IT rather than re-deriving it, and report where that document is now wrong —
that finding is worth more than a re-statement of what it already says.
</known_architecture>

<flag_state_is_mandatory>
Dozens of behaviours in this codebase sit behind kill switches that default OFF, and several are armed
by `settings` rows rather than by code. AN AUDIT THAT READS CODE WITHOUT RESOLVING WHICH PATHS
ACTUALLY RUN WILL DESCRIBE DARK CODE AS LIVE BEHAVIOUR.

For every finding, state whether the path is live in the owner's configuration and how you determined
it. The three mechanisms are:

- `settings` rows with value 'true' (query the DB read-only)
- `_reconcileEnv` / `_anchorCropEnv` in src/modules/processing/handler.js, which translate settings
  into environment variables for the Python backend
- environment variables set at launch (the documented launch set in HANDOVER_2026-08-09.md)

A finding about a path that never executes is not a finding. Say so explicitly when that is the answer.
</flag_state_is_mandatory>

<measurement_is_authorised>
Read-only does NOT mean numberless. These instruments exist, are read-only, and are the standard by
which changes are judged here. Use them; do not rediscover them.

- stress_test/teach_run_ab.js — replays the corpus through the real pipeline under any named env arm.
  Opens the DB `readonly: true`, copies documents to a temp dir, writes nothing back. ~4-7 min/arm.
- stress_test/score_teach_run.py — scores an arm against corpus ground truth, per scope and per field,
  counting EMPTY separately from WRONG.
- stress_test/trace_one_doc.js — one document, full trace, using the app's own env builders.
- stress_test/realdoc_regression.js — the M=0 no-regression gate against confirmed documents.
- Corpus: Desktop\Customer Doc Test\ground_truth.json (10 issuers x 5 types, digital + scanned
  renditions) and Desktop\TESTING\run_manifest.json.

TRAP, and it has already cost a session: Desktop\TESTING\_sandbox\userData\docusnap.db is a STALE
taught state whose totals lane scores 1% for reasons unrelated to any defect. The owner's real teach
state is the live %APPDATA%\ScanFinder\docusnap.db. Point TEACH_DB at it, and use the sandbox only as
a SECOND state for collateral checks.

CAVEAT on realdoc_regression.js: the live DB currently holds 7 confirmed documents, which makes that
harness VACUOUS rather than lenient. A green run from it proves nothing today. Say so if you rely on it.
</measurement_is_authorised>

<known_open_leads>
Do not spend agent time re-deriving these; they are established as of 2026-08-09. Verify and build on
them, or falsify them with source evidence.

- `_DRIFT_FLOOR = 0.02` is a PAGE-scale constant used as a ROW-scale predicate in three places:
  `_target_inline_with_anchor` (fixed 08-07), `_label_drifted` (fixed 08-09), and the REGISTRATION
  ARBITER in `_extract_one` (STILL UNFIXED). A False drift verdict also sets `anchor_stable = True`,
  which vetoes that arbiter — so the constant disarms the redundant detector as well as the primary one.
- `_label_score` returns 1.0 for ANY boundary-aligned occurrence of the needle, and exact-score ties
  are broken by PROXIMITY. A repeated or prefix-extended caption one row away is therefore chosen on
  position alone. This is the mechanism behind 'Credit Ref' matching 'Credit Date'.
- `_snap_box_to_words` is a re-fit that can SHRINK past a leading token; Oracle ruled that seam on
  2026-08-06 and again on 2026-08-09.
- `currency` is in `_SELF_VALIDATING_TYPES`, so learned-shape checking is a NO-OP for money on every
  rung. A derived money read has flat confidence 90 (the ocr_conf cap is free-text only), which clears
  the 88 auto-file floor. Geometry is its only safety.
- Stage 4's `subtotal + tax = total` cross-check is FLAG-ONLY, total-role only, and returns None
  without a shadow subtotal. It is not a backstop.
- The two newest flags (TEMPLATE_CURRENCY_EDGE_GROW, TEMPLATE_DRIFT_ROW_PITCH) have NO Settings bridge.
</known_open_leads>

<important_existing_behaviour>
Preserve and explicitly verify these existing behaviours:

- Stage 0 template matching may seed fields but must not permanently freeze supplier identity.
- Stage 0.5 template mappings are curated anchor-to-target mappings and may have authority over generic
  template guesses.
- Stage 1 keyword results and Stage 2 anchor results use different merge rules.
- A taught anchor crop may intentionally override a higher-confidence generic keyword result.
- Learned hints fill EMPTY fields only and must not silently replace an existing value without evidence.
- OCR correction is learned and must not convert an uncertain guess into an unquestioned truth.
- Validator and format-anomaly logic may lower confidence and force Review but must not raise confidence.
- Format anomaly corrections are candidates for review, not automatic rewrites.
- The flat result dictionary contains both field dictionaries and underscore-prefixed metadata. Metadata
  must be removed before field iteration and sanitisation.
- Supplier identity must be resolved using the latest reliable result before learning data is persisted.
- Review queue status, confirmation, filing, XML metadata, correction learning, and source-file handling
  are part of the safety boundary.
</important_existing_behaviour>

<phase_1_read_only_audit>
Do not modify source code, tests, templates, databases, configuration, learning data, production data,
or generated files. Do not reformat files or create temporary source changes. Running the read-only
harnesses above IS permitted and expected.

Investigate the following:

1. Map the complete path from OCR output to final persisted field value.
2. Map every active field-detection route: learned templates, template field mappings, keyword
   extraction, spatial anchors, anchor-crop OCR, learned supplier hints, OCR correction, fallback
   behaviour, reprocessing, manual field teaching, Review corrections.
3. Identify where labels are selected and how candidate values are generated.
4. Document how page, row, column, direction, distance, alignment, zones, and geometry are applied.
5. Document how results from different stages are merged or overridden.
6. Document how field type validation and format inference work.
7. Document how confidence is calculated, capped, lowered, or otherwise modified — and which fields
   have NO confidence gate at all.
8. Document exactly how needs_review and automatic confirmation decisions are made.
9. Trace the path from confirmation to filing and XML metadata generation.
10. Identify duplicated or inconsistent extraction and validation logic.
11. Locate the relevant unit, integration, fixture, and regression tests.
12. Measure the current failure profile using the instruments above, per field and per scope.
13. Inspect recent field-detection changes only where they are directly relevant.
14. Assess whether learning data can amplify a wrong extraction across future documents.
15. Assess risks involving invoices, credit notes, negative values, totals, VAT, supplier names,
    references, dates, filenames, and automatic filing.

Classify every observed or reported failure using one or more of these mechanisms:

wrong document type · wrong supplier identity · wrong label · wrong value · caption mistaken for value ·
label captured as value · value from the wrong row · value from the wrong column · value from the wrong
page · incorrect page zone · incorrect template match · incorrect template mapping · incorrect anchor
direction · incorrect anchor geometry · OCR character error · OCR noise or punctuation · sign loss ·
currency or decimal loss · date interpretation error · reference-number formatting error · learned hint
contamination · learned anchor contamination · template-teaching error · correct value rejected ·
missing value · confidence incorrectly calculated · confidence too high for a wrong value · confidence
too low for a correct value · unsafe automatic confirmation · unsafe automatic filing · correction or
reprocessing regression
</phase_1_read_only_audit>

<evidence_rules>
For every important conclusion:

- Give the exact file path, and the relevant function, class, test, or configuration key.
- Separate confirmed code behaviour from inference or hypothesis.
- Include a short explanation of the evidence.
- If evidence is missing, say that it is missing rather than guessing.
- Do not treat a single document or example as proof of a shared defect.
- AN EXTREME NUMBER IS ITSELF THE FINDING. Do not file it as mild corroboration of a small hypothesis
  you already hold — that failure mode is on record in this project.
- Do not use overall extraction accuracy alone as the success metric.
- Distinguish extraction accuracy from automatic-confirmation safety.
- VERIFY STATE AT THE SOURCE. Never assert that a template, field, setting, column, learned row, file or
  flag exists (or does not) from indirect evidence. Query the DB or read the code. A UI or trace signal
  is not the state.
- BEWARE DEAD GUARDS AND VACUOUS TESTS. A guard whose condition can never be reached, and a green test
  whose fixture is rejected upstream of the code it claims to exercise, both read as protection and are
  not. Any finding of the form "this is already protected" must show the protection FIRING. Three such
  cases were found in a single session on 2026-08-09.
- NAME THE SEAM for anything you propose: what it relies on UPSTREAM, and what safety it disables
  DOWNSTREAM.
</evidence_rules>

<required_outputs>
Produce a concise written audit report. Rank your effort in this order — the first six are the
deliverable, the rest are supporting material:

1. Executive finding: whether a safe shared cause has been PROVEN; whether implementation should
   proceed; what remains uncertain.
2. Failure classification table: failure example or test · field/document type/supplier · mechanism ·
   root-cause evidence · shared or field-specific · confidence in classification.
3. Shared causes supported by evidence, versus problems that must remain field-, supplier-,
   template- or OCR-specific.
4. Candidate blanket changes: proposed change · affected stages · likely blast radius · potential
   false-positive and false-negative effects · why it is or is not safe · the seam it relies on.
5. Staged implementation plan: safest stage first, one narrow change per stage, exact files and
   functions likely to change, required tests, manual verification, rollback expectations. Every
   proposed change must be kill-switched, DEFAULT OFF, and byte-identical when off.
6. Measurable acceptance criteria for every proposed stage.
7. Confirmed facts versus hypotheses.
8. Financial and filing safety assessment: invoice and credit-note signs, subtotal/VAT/total
   relationships, supplier identity, reference numbers, dates, filenames, XML metadata, automatic
   confirmation and filing.
9. Existing test and regression coverage: what already protects the behaviour, what is missing, whether
   representative fixtures exist, how to compare before and after.
10. Architecture and pipeline map — ONLY where it carries a finding, and as a DIFF against
    docs/extraction-pipeline.md.

Where possible, report these metrics separately: field-level exact-match accuracy · correct-value
recovery · missing-value rate · wrong-value rate · false-positive rate · false-negative rate · average
confidence · confidence on wrong values · Review count · automatic-confirmation count · automatic-filing
count · wrong-value automatic confirmations · wrong-value automatic filings · credit-note/sign
preservation rate · regression count by document type and supplier/template.
</required_outputs>

<safety_rules>
- This phase is read-only. Do not modify code, tests, templates, databases, configuration, or production
  data. Read-only harness runs are permitted.
- Do not change confidence thresholds or weaken validation.
- Do not remove difficult documents from a test corpus, and do not hide failures by excluding documents.
- Do not replace one field-specific problem with a global rule without evidence.
- Do not add filename-based exceptions, sample-specific coordinates, or document-specific conditionals.
- Do not alter automatic confirmation or filing policy during the audit.
- Preserve credit-note signs, negative values, decimals, currency, and financial meaning end to end.
- Treat a wrong-value automatic filing as materially worse than a document being sent to Review.
- Keep licensing, authentication, packaging, unrelated UI, and unrelated backend work out of scope.
- If agents disagree, record the disagreement and resolve it using source and test evidence — and where
  a measurement can settle it, MEASURE rather than reason. On 2026-08-09 two advisors agreed on a change
  that measurement showed cost four real heals.
- If a proposed shared change could affect unrelated document types, suppliers, templates, or fields,
  stop and flag it.
- If no shared root cause is proven, recommend separate narrow fixes instead.
</safety_rules>

<workflow_rules>
Use parallel investigation only where it reduces duplicated work:

- one investigation for the Python extraction flow
- one for Electron persistence / review / filing
- one for tests and failure fixtures
- one for learning and template behaviour

Give each investigation an explicit file list. Do not launch broad agents that independently scan the
whole repository.

Each investigation must return: files inspected · functions/classes inspected · confirmed findings ·
hypotheses · relevant tests · unresolved questions · flag state for every path it reports on.

Then run an ADVERSARIAL VERIFICATION pass before the report: for each claimed shared root cause, spawn
independent reviewers whose brief is to REFUTE it from source, and keep the claim only if it survives a
majority. Budget for this stage, not for the finding stage — this codebase's failure mode is confident
wrong findings, not missing ones.

Finally, reconcile all findings and identify contradictions. Do not implement code during this workflow.
</workflow_rules>

<final_instruction>
Finish this phase by producing only the audit report and staged implementation plan.

Do not edit code.

Do not create a broad refactor proposal unless the evidence proves that the current failures share a
root cause.

The final report must be concise enough to review but specific enough to include exact paths, functions,
tests, representative examples, measured results, and clear acceptance criteria.
</final_instruction>
````
