# DESKEW FALSE-ABSENT RE-FLAG — Phase-1 hold leg (2026-09-12)

**Status:** designed (gary) → Oracle **FORK ruling** (SEND BACK the note-DROP/auto-file "release" leg; SIGN OFF
WITH CONDITIONS on this HOLD leg) → **Phase-1 BUILT DARK**. Switch `deskew_false_absent_reflag` / env
`DESKEW_FALSE_ABSENT_REFLAG` (child of `deskew_review_retry_enabled`), mig 163, `TEST_SWITCH_KEYS` → 47.
Origin: the mig-162 armed-cell gate surfaced 8 note-door docs the field-adopt refused; 6 are a distinct class
(`pendingfeatures.md` 2026-09-12). The 605 corpus is still owed before any flip.

## 1. The exhibit (the 6 Saltmarsh Seafoods delivery notes — one supplier/template)
Each has `delivery_number` carrying Gate C's ABSENT note. A ~1.5° skew garbles the WHOLE-PAGE text token on the
skewed raster → Gate C's page-presence check writes a FALSE `_FILING_SANITY_ABSENT_MARK` ("doesn't appear on this
page as written") → a −12 format-consistency penalty → the doc sits @80-82, held forever, with a lie — even though
the crop read the value right and the page PRINTS it. mig 162 refused all 6 (its F2 needs the value to CHANGE).

**Census (readonly DB + pixel render + straightened-read probe; `TESTING/_measure/deskew_hold_release_20260912/CENSUS.md`):**

| id | GT (confirmed) | current raw read | straightened read | st note | F3 lic_kw | disagree | Phase-1 |
|---|---|---|---|---|---|---|---|
| 130 | DN-92961 | DN-92961 | DN-92961 @89 crop | none | True | [] | **RE-FLAG (truthful)** |
| 139 | DN-79533 | DN-79533 | DN-79533 @89 crop | none | True | [] | **RE-FLAG** |
| 140 | DN-38626 | DN-38626 | DN-38626 @89 crop | none | True | [] | **RE-FLAG** |
| 144 | DN-26479 | DN-26479 | DN-26479 @89 crop | none | False | mapping=`IN.96479` | refuse (F3 disagree) |
| 136 | DN-78051 | DN-78051 | DN-78051 @85 crop | ABSENT | False | [] | refuse (F4a st still absent) |
| **145** | **DN-42798** | **DN-42** (a truncation garble; pixel-confirmed the page prints DN-42798) | **DN-42798 @90** | absent | — | — | **refuse (F2 value CHANGED → mig-162 territory; mig 162 also refuses → stays held with DN-42, never misfiled)** |

## 2. Q1 — the make-or-break, verified at source (gary + Oracle)
The corroboration compare `_corrob_values_agree` (engine.py:1134-1149) is **EXACT-normalized**
(`_cmp_norm(a)==_cmp_norm(b)`, engine.py:1112-1119; the only widening is a date-fold gated on `_DATE_SHAPE_RE`).
`DN-42798` vs `DN-42` → unequal → lands in `disagree` (built at engine.py:5411-5441 via `_corrob_values_agree`)
→ `_corrob_licensed` fails on any non-empty disagree (engine.py:1883-1885) → F3 refuses. **No prefix tolerance.**
A future prefix-tolerant "improvement" to the compare would collapse the disagree and (in the release leg) auto-file
a truncation garble — pinned in both languages (the S2 near-miss).

## 3. Oracle FORK ruling (full block in `docs/oracle_log.md` 2026-09-12)
**Phase-1 HOLD leg = SIGN OFF WITH CONDITIONS (build now).** Replace the FALSE absent note with a TRUTHFUL
review-bound note when the straighten retry corroborates the SAME value. Removes NO checkpoint (still held); kills
a lie the software tells; on a ref/date ROLE field `isSoftAdvisory` is False so mig 142 cannot dissolve it (this
closes the mig-162 S2 side-door for free). It is the **H1 precondition** for any future auto-file.
- **P1:** fire when F2(value unchanged) + F3(keyword-corroborated) + F4a(no st absent) + C5(same identity) hold.
- **P2:** the note is a lane-hold ("— confirm once.") out of every `CLEARABLE_NOTE_MARKS` / class-F set (bilingual
  pin); the doc stays flagged/held; `wouldFile(ON)==wouldFile(OFF)` set-equality (removes no filer — any delta is a bug).

**note-DROP / auto-file "release" leg = SEND BACK.** Fails H1, plus two unsound seams:
- **Seam A / Q6 — overall-stomp:** if mig 162 adopts a changed field A (overall=min, C3) and the release then fires
  on field B, the release's doc-level `_overall_confidence = st` overwrites mig-162's C3 cap. Condition C-Q6: the
  release must refuse entirely when mig 162 adopted anything (`if _fa: skip`).
- **Seam B / Q2 — cross-raster overall inheritance (the sharp one):** F8 (st doc-wide clean) says nothing about the
  RAW fields that persist. A NON-adopted required field — e.g. the DATE role reading a confident garble on the raw
  raster (@95, clean, no note — the VS-72672 confident-garble class) while st reads the true date — passes the
  per-field 88 floor (guards only ref+date, on the field's OWN conf) and rides st's inherited ~100 → **silent
  wrong-date misfile.** C5 guards only supplier. Condition C-Q2: every REQUIRED field not adopted must read the
  same VALUE raw-vs-st, else refuse (this parity guard makes field-splice ≡ whole-doc-adopt, also killing the
  doc-561 risk).
- **Q3 — length-blind residual:** a `_fold_shape` length-blind scope + a position-stable mis-seat on a same-shape
  shorter token near the label passes F2+F3+C5. The 605 fire-census MUST assert every released value's length ∈ the
  scope's confirmed length distribution + a constructed adversarial that refuses.
- **H3-H5:** S_AUTO ≥ 10 DISTINCT docs+values across **≥2 suppliers** (the cohort is one), 0-misfile GT census, M=0.

## 4. Phase-1 build (DARK; byte-identical OFF)
- **Helper** `_deskew_retry_false_absent_reflag(raw, st, role_keys, date_keys, exclude, enabled)` (process_docs.py,
  beside `_deskew_retry_field_adopt`). Pure; mutates `raw` IN PLACE. Per door key (reuse `_deskew_field_adopt_door_keys`
  — ref/date role, non-supplier, noted, non-human method, no corrected_to/was_corrected), ALL: entry = the RAW note
  IS the page-absent mark (`_FILING_SANITY_ABSENT_MARK`, year-absent for a date role); F2 = st value non-empty and
  EQUALS raw (whitespace-insensitive); F3 = `_corrob_licensed_keyword(st corrob)`; F4a = st note has no absent mark;
  C5 = `_deskew_same_identity`. Skip any key in `exclude` (the mig-162-adopted set — 162/163 disjoint by build).
- **Mutation:** the ONLY change is `raw[key]["validation_note"] = _DESKEW_VERIFIED_NOTE.format(val=now)`
  ("'{val}' was confirmed on the straightened page — confirm once."). Value / confidence / method /
  `_overall_confidence` / `_needs_review` are ALL unchanged. The release/auto-file leg (drop the note + inherit
  st overall) is NOT built.
- **Call site** (process_docs.py else-branch): `_hr_reflag_on = _DESKEW_FALSE_ABSENT_REFLAG_ON`; the retry door opens
  on `_fa_on or _hr_reflag_on`; `_fa = []` hoisted; the reflag runs AFTER the mig-162 loop with
  `exclude={_k for _k,_w,_n in _fa}`. Log `RE-FLAGGED …` + trace `deskew_false_absent_reflag`.
- **Plumbing:** mig 163 seed OFF (index.js); `dark_switches.js` → 47 (+ the send-back conditions in the comment);
  `_reconcileEnv` child under `deskew_review_retry_enabled` (handler.js); `test_migration137` count → 47.

## 5. Tests + the empirical gate (all green)
- `python_backend/tests/test_deskew_false_absent_reflag.py` — the fire (the #130 shape), #145 refuse-by-F2 (raw
  byte-identical), #144 refuse-by-F3 (+ the S2 truncation-garble pin), #136 refuse-by-F4a, entry-gate (non-absent
  note), door refusals (supplier_name / corrected_to / was_corrected / human method), C5, exclude, the date-role
  YEAR-ABSENT variant, OFF byte-identical, P2 (lane-hold + not in `_DESKEW_MACHINE_CLEARABLE_MARKS` + not class-F),
  source pins.
- `database/modules/test_migration163_deskew_false_absent_reflag.js` — seed OFF/47/no-force-ON, the nested bridge,
  P2 bilingual (the Python note text vs JS `CLEARABLE_NOTE_MARKS` + the lane-hold family), the release leg unbuilt.
- `npm run test:pins`: 344 files, 343 green (the 1 red = pre-existing `test_activity_strip`).
- **Empirical Phase-1 gate (armed, RR_APP_ENV=1, the 6 docs, OFF vs ON):** RE-FLAGGED fires on #130/#139/#140
  (false ABSENT note → TRUTHFUL); #136/#144/#145 unchanged; **wouldFile deltas OFF→ON = 0** (removes no filer).
  Outputs in `TESTING/_measure/deskew_hold_release_20260912/reflag_{off,on}.*`.

## 6. Flip gate (owner-owed, before any customer default)
This hold leg: `wouldFile(ON)==wouldFile(OFF)` set-equality on the 605 + Demo corpora (removes no filer — a delta
is a bug); the truthful note bilingually out of every clearable set. The RELEASE leg is not to be built even DARK
until H1 (this leg shipped + measured) + C-Q2 + C-Q6 + C-Q3 + H3-H5 (≥2 suppliers) — see `dark_switches.js` +
`docs/oracle_log.md`.
