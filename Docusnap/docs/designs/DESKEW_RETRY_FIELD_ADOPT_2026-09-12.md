# DESKEW RETRY — role-note door + field-scoped corroborated adopt (2026-09-12)

**Status:** designed (gary) → Oracle vet → build DARK. Switch `deskew_retry_field_adopt` / env
`DESKEW_RETRY_FIELD_ADOPT` (child of `deskew_review_retry_enabled`), mig 162, `TEST_SWITCH_KEYS` → 46.
**Exhibit:** Ridgeway Plant Hire worksheet_07 = live doc 358 (tpl 16), `reference_number`. Page prints
`WS-73673`; the app commits `VS-72672` @95 + Gate C "doesn't appear on this page". Placement root cause =
1.7° skew (docs/designs/RIDGEWAY_SKEW_ROOTCAUSE_2026-09-12.md). Parent arc: the review-bound whole-page
straighten retry (DESKEW_SLICE_REREAD_2026-08-30, `process_docs.py:44-222`, `:1281-1338`).

## 1. Measured facts (FULL process_docs path on inbox/358.pdf, app env mirrored, DPI 200 — `scratchpad/measure358.js`)
| arm | reference_number | note | corrob | `_needs_review` | overall | retry ran? |
|---|---|---|---|---|---|---|
| RAW (retry OFF **and** ON) | `VS-72672` @95 `template_mapping` | ABSENT | winner mapping; disagree `keyword: WS-73673` | **False** | 83 | **no** |
| forced-open probe, straightened pass | `WS-73673` @82 `template_mapping_corrobadopt` (TAUGHT-CORROB-ADOPT, mig 153) | TCA note | winner mapping; agree `[keyword]`; independent_agree **true** | False | 79 | yes → `_deskew_retry_adopt(83, 79)` **refused** |

- `VS-72672` is the CURRENT read, not a stale commit (the 09-12 handover's "Learning Repair owed" item is moot).
- Arc B (mig 160) abstains by its own bar: `dominant: null` (3 human-confirmed refs < `DOMINANT_MIN_COUNT` 5; the
  17 machine confirms live in `machine_value_counts`, ignored by `build_prefix_index`). Not a bug.
- Live review queue holds exactly 1 doc (358) → the live-DB door census is trivial; the corpus gate carries it.

## 2. Root cause (two gates; both required)
**H3 — the DOOR.** `_deskew_retry_should_run` keys on the engine's `_needs_review` (`process_docs.py:1292`).
`_needs_review = validator.needs_review(...) or format_anomaly_flagged or …` (`engine.py:11856-11862`);
`validator.needs_review` (`validator.py:960-981`) tests only required-empty + confidence < threshold — it never
reads `validation_note`. Gate C's absent writer (`engine.py:7729`) sets no flag; the late recompute
(`:12427-12431`) can only CLEAR the flag. So a doc held by a ROLE NOTE alone (ref @95, all required filled)
reports `_needs_review=False` and the retry never runs. The JS side holds it (`trust.isAutoFileEligible`
refuses any noted role field at every floor) — the engine flag is a partial signal. Prior art:
`pendingfeatures.md:~5005` logged this gap ("0/20 on Nordwind") proposing an any-note door; this design
supersedes it with a narrower door.
**H2 — the ADOPT.** Whole-doc strict-greater (`process_docs.py:70-76`). Every review-bound rescue on the
straightened frame is CAPPED (TCA ≤87, edge-clip ≤87, left-grow ≤87, reinstate ≤69) while the raw garble
sits @95 shape-valid → the comparison is structurally biased against exactly the rescue class. 83 > 79 is
the rule working as written.

## 3. Design (gary; two legs, both fail-toward-review, byte-identical OFF)
### Leg 1 — the door (ROLE-note only)
- `_deskew_retry_should_run(enabled, needs_review, deskew_pages, reextract, has_pages, note_held=False)` →
  `enabled and (needs_review or note_held) and not deskew_pages and not reextract and has_pages`. Default
  kwarg = old behaviour (the 6 existing door pins stay green).
- New pure `_deskew_role_note_held(raw_results, role_keys) -> bool`: any role key whose field dict carries a
  non-empty `validation_note`. `role_keys = {"supplier_name", _ref_key, _date_key} - {None}` (already in scope
  `process_docs.py:1226-1232`; the SAME set `trust.js:579` builds).
- Call site: `note_held = _field_adopt_on and _deskew_role_note_held(...)` with
  `_field_adopt_on = os.environ.get("DESKEW_RETRY_FIELD_ADOPT", "0") == "1"` (`== "1"`, NOT `!= "0"` — the
  "EMPTY reads as ON" trap).
- **Why ROLE, not any-note:** `isSoftAdvisory` is False for every role key (`trust.js:540-541`), so a role-noted
  doc is refused by `isAutoFileEligible` at every floor even with mig 142 flipped — review-bound by
  construction, independent of any other switch. An any-note door admits optional soft notes mig 142 can
  dissolve on a graduated scope (docs that would auto-file) — blast radius with no exhibit.
### Leg 1b — the door reaches ONLY the field path
The whole-doc adopt stays gated on the RAW engine flag exactly as today:
```
if raw_extractions.get("_needs_review", True) and _deskew_retry_adopt(_oc0, _oc1):   # whole-doc, population unchanged
    ...existing block...; raw_extractions = raw2
else:
    log("  Straighten+reread: kept raw ...")                                           # existing
    if _field_adopt_on: _fa = _deskew_retry_field_adopt(raw_extractions, raw2, role_keys, enabled=True); log/trace
```
On a note-only-held doc every un-noted field is filled ≥ threshold — replacing them whole is pure risk (the
doc-561 "same header garbles under any rotation" class); only the noted fields have upside. **Pinned: the
whole-doc leg's population is byte-identical ON vs OFF.**
### Leg 2 — `_deskew_retry_field_adopt(raw_results, straightened_results, role_keys, enabled) -> [(key, was, now)]`
Pure; mutates `raw_results` IN PLACE (never re-assigns the dict). Adopt `key` only when ALL hold:
- **F0** `enabled` (else `[]`, untouched — the OFF pin).
- **F1** `key in role_keys` AND `key != "supplier_name"` (company key excluded — S9) AND the RAW field dict has a
  non-empty `validation_note`. A clean raw field is never touched; an optional noted field is never touched.
- **F2** `now` non-empty and `" ".join(now.split()) != " ".join(was.split())` (the `_deskew_retry_changed_fields`
  rule; an emptied field never adopts).
- **F3** `_corrob_licensed_keyword(straightened["_corroboration_emit"].get(key))` (`process_docs.py:151-169`) —
  NOT bare `independent_agree`: requires `disagree == []` AND a KEYWORD page-text witness (two crops of one
  straightened raster can common-mode garble — the 08-30 C1 lesson). Keyword-in-fams implies page presence.
- **F4** the straightened field's note does not contain `_FILING_SANITY_ABSENT_MARK` (lazy import, fail-closed)
  AND `straightened.get("_shape_ok", {}).get(key) is not False` (no skeleton = allowed; held regardless).
- **F5** raw `method` not in the human/authoritative families `{manual, override, operator_pin,
  keyword_override, template_fixed}` (prefix match) AND raw has no `corrected_to` AND no truthy `was_corrected`.
- **F6** straightened record `winner_family in {"mapping","crop","keyword"}` — a READ of the straightened page,
  not a memory/hint recall (frame-invariant; proves nothing about straightening).
- **F7** (date role only) `validator.parse_date(now) is not None` (08-30 R5).
Adopt: `raw_results[key] = dict(straightened[key])` (value/conf/method/note whole; method VERBATIM, no suffix —
a suffix corrupts the corroboration bucket, the 09-04 lesson); mirror `_corroboration_emit[key]`,
`_shape_ok[key]`, `_field_candidate_emit[key]` (set-or-pop); `raw_results["_needs_review"] = True`; leave
`_overall_confidence` = raw's (S5). If the adopted dict has NO note → stamp `_DESKEW_CHANGED_NOTE` (was→now);
`corrected_to = was` ONLY if `_put_back_offerable(was, now)` AND the RAW note did NOT carry the ABSENT mark (a
page-absent garble never becomes a `Use "VS-72672"` button). NEVER consults `_DESKEW_CORROB_AUTOFILE`. One log
line per adopt (`FIELD-ADOPTED key 'was' -> 'now' @conf (keyword-corroborated on the straightened page; held)`)
+ `emit_trace({"event":"deskew_field_adopt", …})` when `--trace`.
**Expected on 358:** `reference_number` → `WS-73673` @82 `template_mapping_corrobadopt` + TCA note, held;
supplier + date untouched; overall 83; no `corrected_to`.

## 4. Plumbing
- `database/index.js` after mig 161: mig 162 `INSERT OR IGNORE settings ('deskew_retry_field_adopt','false')`.
- `database/dark_switches.js`: append the key (46); `test_migration137_test_switch_reset.js` count → 46.
- `handler.js:162` `_reconcileEnv`: parent sets `DESKEW_REVIEW_RETRY='1'`; INSIDE that branch the child sets
  `DESKEW_RETRY_FIELD_ADOPT='1'` (the C7 nesting — the child never outlives the parent). Add the key to
  `src/windows/settings/test_settings_wiring.js` §"extraction arms bridged through _reconcileEnv".
- No schema; go-forward only (358's row is re-read on the next FULL reprocess with images).

## 5. Tests (RED-first)
New `python_backend/tests/test_deskew_retry_field_adopt.py` (script-style `check()`; the 36-pin file untouched —
its "36/36" print is literal): door truth table incl. kwarg-omitted rows; `_deskew_role_note_held` cases; the
358 fixture (adopt + mirrors + `_needs_review` True + overall 83 + siblings deep-equal + NO corrected_to even
though `_put_back_offerable` is True); refusals for every F-condition (clean raw field; optional noted field;
`supplier_name`; whitespace-only diff; empty `now`; independent_agree with a disagree; agree `[crop]` only;
record missing; raw2 ABSENT-marked; `_shape_ok` False; each of the 5 human methods; raw `corrected_to`;
`was_corrected`; winner `memory`; unparseable date) + the positive date case (parseable + valid raw →
`corrected_to = was`); no-note adopted dict → `_DESKEW_CHANGED_NOTE`; `_DESKEW_CORROB_AUTOFILE=True`
monkeypatched → still noted; `enabled=False` → `[]` + raw deep-equal. SOURCE pins: (i) the field-adopt call sits
AFTER `raw_extractions = raw2` and BEFORE `# Pull out metadata keys`; (ii) the whole-doc branch condition
contains `raw_extractions.get("_needs_review"`; (iii) the door call site contains `DESKEW_RETRY_FIELD_ADOPT`;
(iv) the existing C14 pin stays green — **never write the literals `_deskew_retry_apply_holds(raw_extractions,
raw2)` or `raw_extractions = raw2` in any new helper/docstring/comment above `:1332`** (C14 = `str.find` first
occurrence, <600 chars). JS: `database/modules/test_migration162.js` (fresh DB 'false' + stamped; pre-seeded
'true' survives) + a `_reconcileEnv` nesting pin (parent OFF + child ON → absent; both ON → '1'; parent ON +
child OFF → absent). Electron-as-Node.

## 6. Corpus gate (flip gate — owner-owed before any customer default)
`TESTING/_measure/deskew_field_adopt_20260912/run_gate.sh` (realdoc OFF-vs-ON, `RR_APP_ENV=1 RR_ALLOW_ARMED=1
OCR_RENDER_DPI=200`, parent ON in the DB else REFUSED as vacuous; live DB = 369 confirmed Demo docs; the 605
corpus needs `RR_DB`). Require **M=0**; **wouldFile(ON) == wouldFile(OFF)** set-equality (Phase 1 always held —
any delta is a bug); ref/date accuracy ON ≥ OFF; fire census = every OFF→ON value delta adjudicated at the
pixels; door census = added straighten passes (the OCR cost); **zero fires ⇒ stays DARK**. Live #358 (armed,
FULL reprocess with images): `WS-73673` @82 held; confirm writes no correction row.

## 7. Seams (gary; Oracle to rule)
- **S1** widened population — the door reaches only the field path; whole-doc population byte-identical. Pinned.
- **S2** mig 142 — role door + role-only F1 ⇒ every outcome leaves a ROLE note ⇒ never soft-clearable.
  **Pre-existing hole (NOT this arc's):** the whole-doc leg's `_DESKEW_CHANGED_NOTE` on an OPTIONAL non-strict
  field with no `corrected_to` (first-filled `was=''`) is soft-advisory to `isSoftAdvisory` (text-blind) → mig
  142 ON dissolves it → a straightening-changed optional value auto-files. Needs a structured-sentinel carve-out
  (the `isAxisLockNoteRow` pattern) before mig 142 flips. → `pendingfeatures.md`.
- **S3** Quick reprocess (imageless `--reextract`) skips the retry; a Quick after a field adopt likely regresses
  the field to the raw garble + absent note (held, not silent). Document; do not chase `mergeReprocessRows`.
- **S4** `DESKEW_CORROB_AUTOFILE` (armed in dev) — the field path never reads it; pinned by monkeypatch.
- **S5** overall stays raw's 83 — cosmetic: the hold is the note; the role @82 is under the 88 floor.
- **S6** C14 — closed by the literal-string rule + the order pin.
- **S7** `_needs_review` emit — unify OFF parks on it (`handler.js:6684`); unify ON the note refuses. Both hold.
- **S8** adopted method `template_mapping_corrobadopt` = TCA's own contract on that frame; not a new contract.
- **S9** `supplier_name` field-adoption would desync from `_supplier_name` metadata (`:1341`) — excluded.
- **S10** RELIES ON: `_corrob_licensed_keyword` semantics; the `_shape_ok` emit (`engine.py:12464-12482`);
  `_corroboration_emit` built AFTER TCA (measured); `filing_value_sanity_flags` ON for F4 to be non-vacuous;
  **HARD dep for the exhibit class (Oracle C2): `template_taught_corrob_adopt` (mig 153) + `template_pad_window_code`
  ON** — without TCA the straightened taught box still reads `MS.72672` + absent → F4 refuses → the arc is VACUOUS on
  358 (pinned). Flip 153 before/with 162; both gate cells required.
**Pinned trade-offs:** (a) a note-only-held doc never gets a whole-doc adopt even when straightened overall is
higher; (b) `supplier_name` is never field-adopted; (c) an optional noted field is never field-adopted.
**Assumptions to check at build:** the straightened-pass TCA adopt on 358 is render-deterministic (probe ×3).

## 8. Oracle — SIGN OFF WITH CONDITIONS C1-C11 (full block in `docs/oracle_log.md` 2026-09-12)
Right layer (not a truthful-flag fix alone, not a whole-doc loosening, not do-nothing). Three catches folded into
the build: **C1** the door keys on ref/date fields that already pass F1+F5 (`_deskew_field_adopt_door_keys` — never
a supplier-only note, never a corrected/human-method field); **C2** the mig-153 + `template_pad_window_code` HARD
dep declared (S10, `dark_switches.js`, mig 162 comment) + the vacuous-without-TCA pin; **C3** overall =
min(raw, straightened) (358 → 79); **C4** the lane-hold is appended when the adopted note is empty OR machine-
clearable (class-F `_is_verification_doubt_note` or the JS `CLEARABLE_NOTE_MARKS` twin, pinned equal); **C5**
same `_supplier_name` (text_normalise-equal) + `_template_id` or refuse; **C6** no put-back over a raw Gate-B
year-absent note (hoisted `_FILING_SANITY_YEAR_ABSENT_MARK`, prose unchanged); **C7** JS both-ON pin — the note
is the SOLE checkpoint (`test_migration162_deskew_field_adopt.js` §3); **C8** the Quick-reprocess truth pinned
(IMAGELESS PRESERVE keeps the adopted read, contested on a non-taught key; FULL lets the fresh read win) §4;
**C9** the note-only else-branch log + the `door` on the trace event; **C10** the mig-142 named flip
precondition (`pendingfeatures.md` + the mig-142 `dark_switches.js` comment); **C11** the gate = §6 + the
605 corpus REQUIRED + cells {162 OFF/ON} × {153 OFF/ON} + the DESKEW_CORROB_AUTOFILE cell + fires partitioned by
door (runner `TESTING/_measure/deskew_field_adopt_20260912/run_gate.sh`, harness `RR_LOG_MATCH`/`RR_LOG_OUT`).
Render-determinism ×3 on 358: DONE (identical). **Gate, armed cell (369 Demo docs, mig 153 ON), 2026-09-12: PASS —
M=0, filer set identical, ALL value deltas 0; whole-doc adopts 9 = 9 (population freeze holds); note-door passes 8;
field adopts 0 ⇒ stays DARK on this corpus; the 605 corpus still required.** Built 2026-09-12: `process_docs.py` (helpers + call site),
`engine.py` (the hoisted year-absent mark), mig 162, `dark_switches.js` (46), `_reconcileEnv` nesting,
pins `python_backend/tests/test_deskew_retry_field_adopt.py` (62) + `database/modules/test_migration162_deskew_field_adopt.js`.
