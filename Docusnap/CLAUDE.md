# DocuSnap v2 — Project Memory for Claude Code

> Read this file before every response. Do not summarise it back to the user.
> Read only the specific source files needed for the current task.

---


## Extended reference (read the relevant doc on demand)
This file is the lean index. Deep detail lives in `docs/` and is loaded ONLY when a task
touches that area — read the pointed-to doc BEFORE working in it:
- `docs/extraction-pipeline.md` — full Stage 0–4.6 internals, drift/registration/label-lock/
  slip-fix/multiline design, OCR recipes, performance + confidence calibration. **Read before
  ANY extraction/anchoring/OCR/validation change.**
- `docs/licensing.md` — license gate internals, offline token verify, PHP backend, admin 2FA, Legal/Terms gate.
- `docs/detached-client.md` — the `/v1` TLS API, cert wizard, entitlement/workflow gates, presence, harnesses.
- `docs/features.md` — first-run wizard, welcome tour, settings backup, Learning Repair, teaching wizard, dev inspector.
- `docs/history.md` — resolved QA/audit findings + build-stage history (Settings/Review/Search/Stage-7 rebuilds).
- `docs/session-log.md` — VERBATIM ARCHIVE of the old per-session change blocks (2026-07-09 → 07-28).
  Grep it (or the matching `HANDOVER_*.md`) before re-touching anything a recent session built.
- `docs/architecture-notes.md` — the long per-file design notes moved out of the directory map (marked
  ➜AN there). Read the matching block before changing one of those files.

## ⏭ LATEST — 2026-08-11 EVENING: **READ `HANDOVER_2026-08-11_EVENING.md` FIRST** (then DAY2 below)
HEAD **`5391c52`**, PUSHED. Owner live-tested all afternoon; ~15 fix commits. **The child-window
DOCK is RESOLVED (`5391c52`, LIVE-SMOKED late evening)**: 5th iteration = restore-then-hide +
visibility-guarded undock (a hidden window cannot be "back in front") + juggle flag drained in
setTimeout(0) + drain-time chip failsafe + deterministic undock in the restore IPC. Smoke: no
stub, chip persists, restores PAINTED, two-chip selective restore, no spontaneous restore (12s).
Incidental pre-existing: createWindow parents children to the FOCUSED window — Review opened while
Settings has focus dies with Settings on close. The four failed iterations stay documented at
`wireChildDock`. **Owned windows can NEVER have taskbar buttons** — setSkipTaskbar flips
on them cause spontaneous restores. Also shipped: teach capture-step FLOW REWORK (one question
panel, valueSource provenance, typed-issuer commits from pick, NO-HIT typo recovery, stale-box
suppression); typed corrections run the LOCATE flow (box-wrong re-targets, OCR-misread keeps box);
two-way date-coherence warns; chrome-word issuer carve-out ('Order' warns, BP/IBM immune);
**migration 63** (the `addMissingColumns`-only-runs-in-migration-2 trap AGAIN — owner hit
`no column named corroboration` live; delete+insert now ONE transaction; `runJsMigrations` was
never exported — runMigrations is the entry); **hidden-field drop** (`template_hidden_field_drop`
OFF — declared-absent fields never filled, merge stops resurrecting, corrected_to sacred; wizard
skip asks "usually / Never — stop looking"; **corpus arm still OWED**); **SFDEV settings gate**
(~47 toggles behind ONE persisted unlock, gate INVISIBLE until Ctrl+Shift+D,M in Settings; split
list = DEV_SWITCH_IDS; slice-2 proven-flag promotion = separate per-flag review). Owner-confirmed
live: straighten round-trip boxes track values (A4 ✓); corroboration badge showing.

### Prior — 2026-08-11 DAY 2: **READ `HANDOVER_2026-08-11_DAY2.md` + `OWNER_TEST_SCRIPT_2026-08-11.md` FIRST**
Branch **`feat/teach-side-overnight`**, HEAD **`8c6237e`**, PUSHED, tree clean. Owner's 4-part
order all delivered; Oracle vetted all four changes (no SEND BACK), every blocking condition
closed same-session. **MIGRATION 62 exists in code** (61+62 apply on next app start — live DB was
still 60 this morning; the previous handover's "migration 61" line was stale).
**(1) LIVE serials teach REPAIRED** (data, no commit): 2 caption-committing mappings + 2 frozen
serials fields deleted; backup `_measure/live_backup_20260811_120903.db`; 24 docs keep the old
value until reprocessed.
**(2) CHRIS r2: findings 1,3,4,5,7,8 + verify-list FIXED** (4 commits). Approve was NEVER broken
backend-side — it is an owner-approved two-step ARM whose armed state was invisible (no
self-approval rule exists; the review doc's triage hypothesis was WRONG). Finding 1 =
`ca0bb49` young-identity corroboration: the wordmark abstain ADMITTED unconditionally and the
garble claim came through the KEYWORD arm (trace-proved); a young frozen-supplier template
(frozen-string confirms <3) must now be NAMED on the page. Youth stays keyed on the FROZEN-STRING
count DELIBERATELY — the bound-doc alternative reads File-All-Ready'd poison as mature (21 docs in
the sandbox). Residuals (a) name-drift keeps a wordmark young, (b) frozen-garble/corrected-dominant
split-brain — PINNED. Slices 2+3 designed in `pendingfeatures.md`, NOT built.
**(3) TAUGHT LABEL → KEYWORD at TEMPLATE scope** (mig 62, flag `teach_label_becomes_keyword` OFF,
NOW HAS A TOGGLE): rebuild in ONE transaction that THROWS rather than stamps (Oracle ship-blocker);
backup restore REMAPS template_id through tmplMap, orphans DROPPED never widened (second
ship-blocker); scoped rows apply only when THAT template matched; ⊕ path SKIPS with no template;
admin list shows "replaces built-ins"/"<template> only" tags.
**(4) CORROBORATION RECORD + SURFACE shipped, record-only** (owner principle, step 1+2 of the
ordered plan; step 3 = moving decisions is DELIBERATELY not built). `_build_corroboration_emit`
buckets by method family; **`template_fixed` = its own `memory` family INSIDE the emit only** —
never re-tune the shared `_crosscheck_witness_bucket` (live in the flipped crosscheck reconcile).
New `extractions.corroboration` column; survives reprocess merge; Review "✓ Two independent
readings agree" (positive-only, note-suppressed); SFDEV ★FINAL shows the amber disagreement (the
Oakhaven stamped-VAT-vs-page-VAT class made visible). Base arm 185 docs BYTE-IDENTICAL = the
record-only proof. Kill `FIELD_CORROBORATION_EMIT=0`.
**(5) LIST FIELD TYPE built** (owner idea; flag `list_field_scan` OFF + toggle + bridge): value =
'A; B; C'; `_search_for_label(collect=True)` — ONE scan, shared guards, shared `_post_label_value`
pipeline; method `keyword_list`; the collect scan ALONE writes list fields (mapping/anchor/late-
rescue/hint skips — pinned invariant narrowing); never freezes; never a ref/date role; Stage-4.5
rail + corrector skip; trust untouched (list blocks sub-100 auto-file, accepted v1); teach
surfaces refuse at teach time. Corpus layout evidence settled Oracle's fork:
`gen_customer_test.py:523` prints one 'Serial No: <sn>' line PER serial. Residuals named:
vertical-column reads element 1; no count witness v1. Gates: pre/post-refactor byte-identical AND
armed-zero-list-fields byte-identical (185 docs each).
**GOTCHAS:** electron.exe does NOT support `--check` (silently fails every file — use plain
`node --check`); git toplevel is `C:\GIT Projects` and the unanchored `templates/` ignore rule
makes `git add` warn about `src/modules/templates` (the tracked handler commits fine); the 08-10
coldstart2.json is a 66-doc subset, NOT comparable to 185-doc runs; harness `safe()` returns []
on unmigrated snapshots for new getForExtraction columns; labelkw backfill arms construct rows
WITHOUT template_id.

### Prior — 2026-08-11 DAY: **READ `HANDOVER_2026-08-11_DAY.md` FIRST**
Branch **`feat/teach-side-overnight`**, HEAD **`75d29ce`**, PUSHED, tree clean. Owner present.
**MIGRATION IS NOW 61** — every older line in this file saying 60 is stale from here.
**(1) CHRIS'S "CONFIDENT NONSENSE" GAP CLOSED** (`810ea8f`, DEFAULT ON, kill
`teach_issuer_plausibility_warn`). A ⊕ teach read `@a eens Ee`, showed a green success toast, flagged
nothing, and made two output folders. **Every guard in this product was pointed at ABSENCE and none
at CONFIDENT NONSENSE** — the app warns on an EMPTY issuer and said nothing on a gibberish one. Both
teach surfaces now warn. **`isPlausibleSupplierName` was MEASURED AND REJECTED for this job — it
rejects BP and IBM** on a ≤​3-char all-caps rule; the shipped predicate never judges a single-token
value, which is what makes BP/IBM/3M/H&M immune. 0 false positives over 22 real names.
**(2) A CONFIRMED TEACH LABEL NOW REPLACES THE GENERIC KEYWORDS** (`48bcc48`, **migration 61**,
`field_label_overrides.exclusive`, DEFAULT OFF, `teach_label_becomes_keyword`). Owner-reported: a
correct taught `po_number` mapping coexisted with a Stage 1 keyword hunting `'ref'`. The store was
already wired to Python; **the only writers were the admin Settings screen and the preset seeder** —
the missing piece was a WRITE. **REPLACE, not add: precedence is not exclusivity**, because
`extract_fields` falls THROUGH to the shipped labels when the override does not hit. **BOTH teach
paths write it** — the wizard does NOT use `save-field-anchor` (6 anchors-with-labels vs 38 mappings
with `anchor_text`), which the arm caught.
**(3) THE ARM: `labelkw` red, `labelkw_fixed` CLEAN.** Only `serials` moved (empty → WRONG via
`keyword_override`); with the bad serials teach removed, **all nine lanes byte-identical to base**.
**The regression was the TEACH, not the feature** — the most-committed `serials` value on this
install is literally `"Serial No:"` ×23, the caption. **Still broken in the LIVE DB.**
**(4) THREE OF MY OWN CLAIMS WERE WRONG AND ARE CORRECTED IN THE HANDOVER:** "18 overrides" was 38;
`templates.getAll` returns **`field_mappings`** not `mappings` (a whole arm removed 0 rows and was
caught ONLY by its own guard); and the backfill read the DB instead of the mutated state, so a
"repaired" arm produced the unrepaired result — **a mutator arm must measure the state it mutated.**
**(5) OWNER DIRECTION, AND IT OUTRANKS THE INDIVIDUAL FIXES:** *"it is more about CORROBORATION
than merely getting it right... otherwise there is a chance, from time to time the wrong value will
be selected."* The trace above is a NEAR MISS, not a success: the two rungs answered DIFFERENT
questions so they could never agree, and a 5-point margin decided it. **A margin is not evidence.**
The vocabulary exists (`_anchor_corroborates`, `_template_identity_corroborated`, "no
different-method-family rail agrees") but only inside specific guards — **agreement is invisible to
field selection today.** Encode INDEPENDENCE OF METHOD FAMILY, never a witness count: caption-located
vs geometry-located is independent; two preps of one crop is NOT (5:1 false:true, Oracle 2026-08-03,
re-proved this week when two preps agreed on the wrong `P1`); full-page vs crop is WEAK. **It also
revises my own arm verdict: a lane can be byte-identical and still be far better EVIDENCED, because
the scorer counts values and cannot see corroboration.** Order: record it, surface it, only then let
it move a decision; do NOT wire it to auto-file in the same slice. Read
`HANDOVER_2026-08-11_DAY.md` §"THE DIRECTION THE OWNER SET" before any extraction work.
**(6) I REFUSED TO WRITE THE LIVE DB while the app held it** (`no such table: settings`, then
`SQLITE_CANTOPEN`, on a file that exists). No flip happened; the arm later said it would have been
wrong anyway. **GOTCHA: a commit message containing backticks breaks the Bash heredoc — use
`git commit -F <file>`.**

### Prior — 2026-08-11 OVERNIGHT: **`HANDOVER_2026-08-11_NIGHT.md`**
Branch **`feat/teach-side-overnight`**, autonomous night run, owner asleep. **NOTHING FLIPPED, no
live-DB write, no destructive action.** Migration still 60.
**(1) DO NOT FLIP `CODE_SEPARATOR_STRUCTURE_GUARD` ALONE — this reverses last night's advice.**
`ocr_corrector.value_to_template` keeps `/` as a literal, so once the guard is armed and confirms
make 10-char values the majority, the scope's learned template becomes `UD/DD/DDDD` and
`try_correct` (`LETTER_TO_DIGIT['I']='1'`) rewrites a CORRECT `PI/26/6000` back to `P1/26/6000` at
`min(95,90+20)=95`, method `+corrected`, **no note** (`engine.py:6688-6701`). Masked today only by a
length mismatch. **The guard is the fuse; operator confirms arm it.** Flip it WITH the `I`→`1` fix,
after it. gary found it, Oracle ruled the order.
**(2) `I`→`1` ROOT-CAUSED + ORACLE-SIGNED (4 BLOCKING) + DELIBERATELY NOT BUILT.** The ladder ranks
rungs by mean word confidence, which is NOT comparable across preprocessing recipes — sharpening
raises certainty while destroying the antialiasing grey that separates a serif `I` from `1`. Raw
greyscale reads it correctly **5/5 and is not a rung**. **Oracle C1: the obvious fix heals ZERO
documents** — both ladder exits return the string AFTER `_repair_single_token`, so the witness
compares 10 chars against 8 and discards; the comparison must move inside the rung loop.
**Corrected my own claim:** "every rung scores below 60" is FALSE on 2 of 5 (verified via the
ladder's own `_read_lines_full`) — 2 exit via the GATE, so a comparator-only fix heals ≤3/5.
**Owner asked about 2-bit B&W: measured, it makes it WORSE** (1-bit Otsu x2 scores 79-85 while
wrong vs raw 45-56 while right). Full spec in `pendingfeatures.md`, ready to build cold.
**(3) FIRST WHOLE-SUITE RUN EVER: 457 files, 442 pass, 14 genuinely red** (`stress_test/run_all_suites.py`
— `pytest tests/` aborts, so each file runs in its own process). **ALL reproduce at `455d4a7`, zero
regressions.** **CLAUDE.md's "4 pre-existing failures" was STALE by ~4x.** One shared cause: three
fixtures die on `logo_detail_hash` (migration 47 drift). Two worth attention: `test_v1_contract.js`
CRASHES and `test_apiclient.js` fails a no-leak assertion. None fixed — blind test-repair papers
over real regressions. Baseline: `~/Desktop/TESTING/_measure/suite_results_20260810.json`.
**(4) CHRIS RE-RAN HIS VET — SPLIT DECISION** (`docs/CHRIS_FULL_APP_REVIEW_2026-08-11.md`). A clean
supplier teach is **19/19 with zero bleed** (the thing he'd have quit over). But teaching a
**purchase order the OWNER issued** still leaked onto 20 Oakhaven delivery notes — **verified on
disk**, and the VAT number crossed over too. `template_identity_on_page` needs a layout to NAME its
company; an owner-issued PO carries the owner's name and the supplier's notes carry the owner's
address as recipient, so the guard is satisfied. **The 08-10 DAY fix closed the supplier case and
left the buyer-issued case open.** **NOTE: that flag is in `PROVEN_ON_DEFAULTS`, so a FRESH install
has it ON and the owner's own DB does NOT.** His sharpest line: *"every guard in this product is
pointed at absence; none at confident nonsense"* — a teach read `@a eens Ee`, showed a success
toast, flagged nothing, and made two junk output folders. Also: **Approve silently does nothing**
(Reject works).
**(5) Oracle C6 done:** embedded scans are **150 DPI native, rendered at 200** — no free resolution,
and "raw" is already resample #1, so the `I`→`1` result rests on a synthetic chain. Generalisation to
a real scanner is HYPOTHESIS.

### Prior — 2026-08-10 EVENING2: **`HANDOVER_2026-08-10_EVENING2.md`**
Branch **`feat/teach-side-overnight`**, HEAD **`8ee7456`**, PUSHED, tree clean. Owner present.
Migration was 60 at that point (**now 61** — see the 08-11 DAY block). **Nothing flipped; NOTHING smoke-tested in the UI.**
**(1) A TYPED TEACH VALUE NOW CAPTURES A POSITION** (`3f21ddb`, default ON, operator-gated): the
typed string is searched for in the page's own word geometry, the hit is DRAWN and the operator
approves it, and it then commits through the SAME `store()` as a drawn box — an ordinary Stage 0.5
MAPPING, so `doCommit` needed no special case. No hit ⇒ the old `fixed_value` path, byte-identical.
Words come from the **PIPELINE's** `reconstruct_page_text`/`words_out`, not the zone ladder. Matching
is EXACT-after-normalisation, no fuzzy tier, one visual row. **A hit returns `{box, text, wordCount}`
and NOTHING else — PINNED with `vat_no='VAT'` as the fixture. A box is evidence about WHERE, never
WHETHER.** Kill `teach_typed_value_locate`. **Limit seen live: a mangled read can't be located
(`GB651002784` → `'GB85'`+`'1002784'`), so the census's 89.5% is an UPPER BOUND.**
**(2) A PRINTED SLASH INSIDE A REFERENCE WAS BEING DELETED** (`1ad36de`). The owner's *"doesn't
appear on this page"* note was **TRUE**; the value was wrong. `anchor._repair_single_token`
(fn `:2650`, guard `:2686`; reached from `template_mapping` via `_ocr_crop_laddered` at
`anchor.py:3228` — NOT `template_mapper.py:3638`, which is the test-stub path) re-reads a spaceless
code containing `/` with a whitelist that **cannot emit `/`** and accepts on matching alphanumerics —
true of every code whose separators are PRINTED. **The backlog's own analysis was WRONG and is
corrected in place: it named the comparison local and missed that the function RETURNS `alt`.** Fix =
a SHAPE rule (≥2 groups of ≥2 alnum keeps its separators; a one-char group is the artefact
signature); `|`/`\` never structural. Kill `CODE_SEPARATOR_STRUCTURE_GUARD`, DEFAULT OFF.
**(3) CORPUS GATE GREEN** (`8ee7456`): **ref 25 ok/3 wrong → 27/1 (89%→96%), all eight other lanes
BYTE-IDENTICAL incl. winning-rung distribution, 14→12 failing cells, 0 regressions.** **The residual
is the proof** — doc 0025 carried TWO defects and now reads `P1/26/9923`, so the arm SHOWS the
`I`→`1` is a separate upstream OCR defect. Its confidence moved 95→90, still over the 88 floor.
**(4) NON-UK VAT NUMBERS RECOGNISED** (`d9768c5`, `VAT_EU_FORMATS`, DEFAULT OFF) — per-country
structures with exact element counts, never a generic two-letter rule (which readmits the garbles).
**Live census: 56 distinct values, 0 flipped refused→accepted.** `vat_eu` ships as a separate INERT
list; the flag is what merges it. **THERE ARE THREE CONSUMERS OF `validation_patterns`, NOT TWO** —
Python (`keyword.load_patterns`) and the renderer (`get-validation-patterns`) widen; `trust.js`
`_sharedValidationPatterns` (freeze_guard + the auto-file checksum) deliberately does NOT, and that
is PINNED. **NO corpus arm, deliberately: the corpus is UK-only and a flat lane cannot distinguish
"inert because UK" from "never armed" — Oracle upheld this but named the arm that IS valid (a
REJECTED-candidate census; the committed-value census is blind to what the gate refuses).**
**(5) `FILING_VALUE_SANITY_FLAGS` IS `'true'` IN THE LIVE DB** — the note below recording it as
bridged-but-OFF was STALE. Verify a flag's state in the DB before calling an arm inert.
**(6) OWNER: `deskew_on_import` is `'true'` AGAIN and it is NOT inert** — `engine.py:5253` is
`elif (TEACH_ANGLE_COMPOSE_SCAN and not raw_pages ...)` and import-deskew populates `raw_pages`, so
`teach_angle_compose_scan` (also `'true'`) is **armed and structurally unreachable**.
**(7) 2026-08-10 EVENING3 — BOTH ORACLE PASSES RUN: SIGN OFF WITH CONDITIONS, NEITHER FLIPPABLE YET.**
**VAT C1 was a SHIP-BLOCKER, now fixed:** `NO` is also the English caption word "No", the separator
class swallowed a trailing full stop, and a UK VRN is exactly NINE digits — Norway's own count — so
`No. 651 0027 84` (a UK number carrying its label tail) validated as Norwegian at coverage 1.00 and
would have committed SILENTLY. The MVA/MWST suffix is now MANDATORY; pin run RED first; census
unchanged (56/10/46/0). Also fixed: the renderer cached the MERGED patterns, so a flip needed a
restart and left the pipeline wide while the warning stayed narrow (C4). **C2 DISCHARGED:**
rejected-candidate census (`VAL_CENSUS_DIR`, arm `valcensus`) - **2036 gate decisions, 230 `vat_gb`
refusals, 61 distinct, ZERO newly accepted by the widening.** The refused population contains three
literal caption tails (`'No GB 903331842'`, `'NoGB 903331842'`), so the mechanism C1 fixes is REAL
on this data; it does not fire only because these suppliers print `GB` after the caption. **This
corpus holds the MECHANISM, not the TRIGGER - the pre-C1 list would also have accepted 0 of the 61.**
**Separator guard: layer and root cause CONFIRMED** (Oracle ruled AGAINST making the re-read
unreachable from the template rung). Applied C3 (my commit shipped a FALSE CITATION —
`template_mapper.py:3638` is DEAD in production; the live reach is `anchor.py:3228`), C5 (currency
excluded), C4/C6/C7 pins. **C1 ANSWERED, and it is worse than either branch Oracle predicted:** armed, the owner's exhibit
commits `P1/26/6000` — separators restored, `I`→`1` still wrong — and **the note CLEARS on 3 of 5
live Pelican documents**, because their full-page OCR carries the SAME misread so Gate C now
matches. The guard turns "wrong value + warning at 95" into "wrong value + NO warning at 94", which
clears the 88 auto-file floor. **Tell the owner what they will actually see before they flip, and
do not flip alongside a lowered `auto_file_threshold`.** The `I`→`1` defect now has its own entry.
**C2 ANSWERED TOO — BOTH BLOCKING CONDITIONS DISCHARGED.** New outcome counter
(`SEPGUARD_CENSUS_DIR`, inert unless set) over both corpus arms: **91 reached, 91 repaired in base,
91 kept / 0 repaired armed — and 91 of 91 are FALSE POSITIVES.** The artefact class the repair
exists for occurs **ZERO** times; on this data the function has never once done its job and has
deleted a printed character 91 times. Inverse census on the live install
(`stress_test/census_separator_kept.py`): 887 values carry a structured separator, **0** have the
artefact signature. **State it honestly: cost is zero because NEITHER dataset contains the class it
disables — the flat lanes prove nothing about that cost; the census does.** What is left before a
flip is a JUDGEMENT, not a measurement (the cleared warning above). Method in `pendingfeatures.md`.
**OUTSTANDING: the two measurements above, and the whole UI smoke list.**

### Prior — 2026-08-10 EVENING: **`HANDOVER_2026-08-10_EVENING.md`**
Branch **`feat/teach-side-overnight`**, HEAD **`6acf4e2`**, PUSHED, tree clean. Owner present.
**UI/UX + COPY ONLY — no extraction-layer change, no flag flipped, no migration.** The whole
UX/product group in `pendingfeatures.md` is closed or honestly re-scoped.
**(1) THE BACKLOG WAS LYING IN FOUR PLACES.** Core Search re-skin (`d7ab2e2`+`23109fb`),
document-detail DTO (`b747676`) and focus-sweep slice 1 (`01a2a43`) were **already shipped and never
ticked**; the custom-stamp entry claimed the approver's note "is not printed on the stamp" — **FALSE
and never true of the shipped code** (`pdfStamp.js:87`/`:111-114`, `workflowService.js:319`). All
four corrected. **Check an entry at source before building it.**
**(2) OWNER CAUGHT A REAL MISS:** my first TM-Straighten commit made the *mapping* overlay
frame-aware but missed `drawRegistrationPreview` — the overlay actually in use when checking a
template. `redrawTplCanvas` has **THREE exits** (`tplPreviewMode`, `tplLandmarkMode`, normal); a
change to "the overlay" must address all three. Fixing it exposed that `currentTplPageB64` fed the
resolver **whatever `tplImg` was showing** — after Straighten, the straightened bitmap, i.e. a page
production never sees, whose results would then have been DOUBLE-transformed. Now pinned to the RAW
page.
**(3) `minimizable:false` on child windows rested on a STALE comment** — `NON_MODAL_CHILD`
(`main.js:499`) contains every member of `CHILD_WINDOWS` (`:498`), so `modal` is always false and
there is no "locked main shell". Minimise re-enabled + a docked chip on the main window; restore is
sender-guarded; kill switch **`CHILD_DOCK=0`**. **If a child is ever made modal again, revisit the
dock in the same change.**
**(4) TEACH NO LONGER SELLS THE POSITION-LESS ROUTE.** The big accent "Always the same on every
document? → Set a fixed value" card is GONE; manual entry is a quiet top-of-step hatch that states
what the choice costs. Issuer copy now says the value may be drawn ANYWHERE printed, **footer
included**. **NOT CHANGED: what a typed value persists** — still `{value, target:null, anchor:null,
status:'fixed'}` ⇒ no geometry. That is an OPEN backlog entry with the deciding measurement named.
**(5) STAMP: placement + size** (normalised TOP-LEFT-origin `box`, flip to pdf-lib's bottom-left
happens once inside `stampPdf`; clamped at render; new `stamp_placement` setting where **UNSET means
the built-in corner**) **+ the two-approvals-share-one-path wart FIXED** (per-route filenames;
legacy copies still resolve because every reader uses the stored `route.stamped_path`). Notes now
ELIDE — over `MAX_NOTES` used to produce **no stamped copy at all, silently**.
**(6) Ageing chip** on open mailbox routes (no schema/scheduler/new toast events); `created_at` has
no zone marker so it is parsed as **UTC explicitly**. Core only — the detached client did not get it.
**(7) TM tightness: `search_expansion` now explains both failure modes + "tested N days ago".** The
other knobs (registration on/off, label-lock strictness, absolute-vs-relocate) are **NOT columns** on
`template_field_mappings` — a migration + per-mapping rung overrides, i.e. EXTRACTION work, not UI.
**GATES:** pdfStamp 9→13 checks, workflow ×4, workflow-IPC, entitlement, settings-wiring — all green.
**NOTHING WAS SMOKE-TESTED IN THE UI.** Owner must eyeball Straighten+registration-preview on a
tilted sample and a box drawn-while-straightened round-tripping.
**(8) TWO FLAGS HANDED OVER AS "AWAITING THE OWNER'S FLIP" COULD NOT BE FLIPPED** (`cb79586`).
`TEMPLATE_FORMAT_FAIL_YIELD` + `CUSTOMER_PO_LABELS` were read straight from `os.environ`
(`engine.py:2158`, `keyword.py:1031`) with **no Settings bridge**, and `npm start` injects no env —
so they had shipped OFF for ever. **Same class as the five bridged on 08-09 NIGHT, one day later.**
Now bridged (DEFAULT OFF) + PINNED in `test_settings_wiring.js`. **A flag is not "awaiting a flip"
until a toggle exists that flips it — check that pin before writing the phrase.**
**(9) TYPED TEACH VALUES: MEASURED, direction decided** (`stress_test/fixed_value_locatable.js`,
read-only). **17/19 measurable fixed values (89.5%) ARE printed on their own sample page**
(`supplier_name` 7/7, `vat_no` 6/6, `account_no` 3/3) ⇒ they were typed because the READ was wrong,
so the fix is to find the typed string in the page's word geometry and store the box. **CONDITION:
presence ≠ correctness** — two of the 17 are known-wrong (`vat_no='VAT'`, `'Pelican Office
Interiors -'`), so capturing geometry must NOT raise a value's confidence. A box is evidence about
WHERE, never WHETHER.
**GOTCHA: `ELECTRON_RUN_AS_NODE=1` is REQUIRED** for most JS suites — without it the Electron binary
launches a GUI and hangs until the tool times out.

### Prior — 2026-08-10 DAY: **READ `HANDOVER_2026-08-10_DAY.md`**
Branch **`feat/teach-side-overnight`**, HEAD **`65abd6f`**, PUSHED. Owner testing an installer.
**INSTALLER BUILT:** `dist\ScanFinder Setup 2.0.0-r20260810-0915-29425c9.exe` with **43 reading
improvements ON by default (migration 60)** — written as SETTINGS ROWS so the toggles render as on;
`deskew_on_import` + `template_fixed_seed_agreement_keep` deliberately excluded. **It predates the
account-number, cold-start and teach-parity fixes** — rebuild before the next test pass.
**(1) THE WRONG-COMPANY MISFILE IS FIXED** (`ebd2096`+`fba4374`, OFF, Oracle SIGN-OFF-W/COND, all six
conditions applied). Cause was NOT the logo: a buyer-issued template's fingerprint is the OWNER's own
address block, printed on every document the business RECEIVES, scoring 0.80 against every supplier.
Fix = a layout may only claim a document that NAMES its company. 160 kept / 40 refused / **0 right
matches lost**; fresh-import gate: wrong senders 18→1, account 36→19, ref 37→54, date 44→61, po_ref
6→23. **Oracle caught two real defects in my first version: I used the cosmetic template NAME as the
identity (an admin RENAME would have silently killed matching for ever), and I vetoed the WINNER
instead of filtering the POOL ("teaching a second supplier broke the first one").**
**(2) STICKY BINDING FIXED** (`29425c9`) — reprocess honoured a wrong binding for ever; now the
memory must pass the same test. Reprocess path: wrong senders 18→1, all other lanes unchanged.
**(3) ACCOUNT NUMBERS** (`efbbd20`) — `account_no` inherited a generic bank containing the bare
caption `Ref`, so "Job Ref JB-8887" became the account number on 20 pages that have none. 19 wrong→0.
**(4) COLD-START SENDER** (`c629d32`) — the document TITLE was outranking the company name
(`GOODS DELIVERY NOTE` 2.21× vs 2.05×, ratio 1.078 < the 1.10 bar ⇒ abstain). The type-heading
exclusion was EXACT-match, so one extra printed word missed it. Correct suggestions 19→36, none→0.
**(5) TEACH ↔ SETTINGS PARITY** (`9903dbb`) — the wizard gains **Add from catalog…** + **Edit this
type…**, both the SAME code as Settings (catalog extracted to `shared/doctype-catalog.js`).
**(6) SERIALS REVERTED, and the revert is the finding** — the format gate killed the caption commits
but swapped an obviously-junk value at 35 for a plausible `'CJB-5900'` at 90. The taught box reads the
WORKSHEET NUMBER; format cannot separate two codes of the same shape.
**CORPUS ANSWER:** `SINGLE` is born-digital BY DESIGN; `IMPORT`/`IMPORT2` are 400/400 image-only, so
every figure this week is on the scanned path. New `TESTING\SCANNED` + `SCANNED_HARD` via
`stress_test/make_scanned_set.py` (teach FROM a scan; the corpus never tilts past 1.6°).
**GOTCHAS:** `teach_run_ab.js` passes `known_template_id` (models REPROCESS) so it is STRUCTURALLY
BLIND to identification fixes — use `TEACH_FRESH_IDENTIFY=1`. Two of my probes lied before the code
did (empty exclusion set; a false `PROFORMA INVOICE` claim). Bind source pins by the code BLOCK, not
a character count — a fixed window had already shrunk past what it checked.

### Prior — 2026-08-10 OVERNIGHT: **`HANDOVER_2026-08-10_NIGHT.md`**
Branch **`feat/teach-side-overnight`**, HEAD **`bc157d9`**, PUSHED. Autonomous run, agents + Oracle.
**(1) THE HEADLINE IS A DEFECT, NOT A FIX: ONE ORDINARY CONFIRM STAMPS THE WRONG COMPANY ON 18 OTHER
COMPANIES' DOCUMENTS AT 95% AND FILES ONE OF THEM IN THE WRONG FOLDER.** Confirming a single
Quillstone purchase order created a template with `supplier_name` frozen; it then matched **Oakhaven
delivery notes** (different company, different type) and stamped Quillstone at 95 via
`template_fixed`. Found TWICE independently — Chris at the screen, the harness in the DB. Chain
verified at source; `TEMPLATE_FIXED_NAME_PRESENCE_VETO` was inert because it needs >=3 confirms and
there was 1. **NOT FIXED — advisor round + Oracle first; four candidate directions in
`pendingfeatures.md` (top entry). DO THIS FIRST.**
**(2) VAT FIXED** (`92c7013`): `vat_no` had NO format — it fell back to the generic ref rule, which
is a length check that accepts 'VAT'/'3PL'/'1RE'. Now a shipped field with UK patterns + labels +
the Review on-blur twin. **100 ok/26 wrong/54 empty → 171/0/9 on 200 docs, every other lane
byte-identical.** 21 of the 26 were a template's frozen `fixed_value` = the caption 'VAT' →
`TEMPLATE_FREEZE_QUALIFY` (OFF) + `database/modules/freeze_guard.js`.
**(3) SIX SECURITY HOLES CLOSED** (`4ef1d1c`/`c45ff27`/`bdb0325`/`ab246f5`): `LICENSE_PINNED_KEYS=0`
was a complete offline licence bypass; `%SystemRoot%` made a 5-minute repeatable free trial; a
packaged build now refuses `--remote-debugging-port`; the failed-key brake **permanently locked out
paying customers**; one person could take signups offline worldwide; `processing.log` was recording
customer names/VAT/totals/paths with no toggle (now redacted unless Diagnostic Logging is on).
**(4) ORACLE SENT ONE BACK AND FOUND A DEAD GUARD:** arming the fuses in `npm run build` is REVERTED
(signing trap: afterPack runs after signing). **`config/keyword_patterns.json` is NOT in `app.asar`**
— `trust.js` loaded it repo-relatively, so its strict-type re-check has NEVER fired in a packaged
build. Fixed in `trust.js` + `freeze_guard.js` via `process.resourcesPath`.
**(5) NEW INSTRUMENT — `stress_test/readable_census.py`**: scores only values ACTUALLY PRINTED. The
account number is printed on 60 of 200 docs; the lane is **100% on those** and INVENTS a value on 40
pages that carry none. On printed values: customer 99 · total 97 · vat 96 · account 100 · po_ref 92 ·
issuer 78 (40 misses = untaught suppliers) · serials 68.
**(6) FIVE MEASURED FLAGS WERE UNREACHABLE** (env-only, `npm start` injects none) and are now bridged:
`STAGE05_REF_CODE_GATE`, `KEYWORD_GENERIC_CAPTION_EXCLUSIVE`, `TYPE_TITLE_OWNER_PRECEDENCE`,
`FILING_VALUE_SANITY_FLAGS`, `LETTERHEAD_ISSUER` (the cold-start sender reader — sender was blank on
all 60 docs from unseen suppliers). **"still OFF" was true when written and is now STALE — verified
2026-08-10 EVENING2, ALL FIVE are `'true'` in the live DB** (54 settings are). Read the DB, not this
line, before calling an arm inert.
**GOTCHAS:** never measure against a DB another agent is using (snapshot to `TESTING/_measure/`); a
mutator arm inherits NO env unless named in `ARM_ENV`; a probe without `pytesseract.tesseract_cmd`
reports absence about everything. `CAPTION_VALUE_REFUSE` shipped INERT (0 docs change).
**OWNER: `deskew_on_import` is TRUE again in the live DB** — standing ruling against it, and it
silently disables `TEACH_ANGLE_COMPOSE_SCAN`.

### Prior — 2026-08-09 NIGHT: **`HANDOVER_2026-08-09_NIGHT.md`**
Branch **`feat/teach-side-overnight`**, HEAD **`71bce9b`**, PUSHED.
**(1) THE HARNESS WAS MEASURING THE WRONG PIPELINE.** `teach_run_ab.js` mirrored only settings whose
value is literally `'true'`, so numeric `ocr_dpi` was dropped and Python fell back to 300 while the app
renders at **200** (`_ocrDpiEnv`, handler.js:91-96, applied at every extraction spawn). **Every absolute
figure in every prior handover was taken at the wrong DPI**; A/B deltas are unaffected. FIXED.
`trace_one_doc.js:65-66` has the same gap, NOT fixed.
**(2) Oracle C3/C4/C6/C7 CLOSED** (`c027d86`). C3 was built exactly as signed, MEASURED, and REFUTED —
adopt-on-proof scored 111/6/3 vs the unproven arm's 119/1/0, costing 8 heals and MINTING 6 wrong values
(a credit note reverted to its VAT row, a minus sign lost). Premise fails because on the DERIVED rung
the reference read is itself wrong 28 times in 120. Shipped INVERTED: refuse on EVIDENCE OF LOSS, not
absence of proof. Residual: the shipped guard is INERT on this corpus (0 docs change).
**(3) FOUR FLAGS NOW BRIDGED** (`11d3f46`, `a3b4938`) — they were env-only and `npm start` injects no
env, so the two headline wins of the 08-09 arc were unreachable in the product. **FLIP ALL FOUR
TOGETHER OR NONE**: the teach-side pair alone costs 25 totals.
**(4) ISSUER ROOT-CAUSED.** `noreg` diagnostic arm: registration OFF ⇒ issuer **118/22 → 140/0/0**. The
taught boxes were right on all 22; the arbiter discarded them. WHY only this field:
`template_field_mappings.anchor_text` is **NULL with dx=dy=0 for `supplier_name` on all seven
templates** (a letterhead name has no caption), so `_extract_one`'s drift guard is skipped,
`anchor_stable` can never be True, and the global transform is the only drift compensation.
**ORACLE FINAL: the layer MOVED — fix the ARBITER** (`template_mapper.py:2231` must require anchor
evidence AVAILABLE-and-failed, not merely absent). **gary's decline-branch is SUPERSEDED, do not build
it.** Secondary: the owner's region-scoped presence confirm. **Logo ruled (b) keep-seed-but-flag, never
accept silently** — the phash has no separating power on scans and re-consuming it is circular.
**(5) `deskew_on_import` was ON and is now OFF again** (owner-instructed, 20:18). While on it populated
`raw_pages`, which makes `TEACH_ANGLE_COMPOSE_SCAN` unreachable (`engine.py:5089` is an
`elif ... not raw_pages`) — so the +18 issuer/+36 customer win was OFF and an unmeasured path ran.
**Remember the interaction: turning import-deskew on silently disables COMPOSE_SCAN.**
**CORRECTION to the anti-deskew record:** the "2.0° floor → heal vanished (0/1127)" argument is
**VACUOUS** — the corpus never tilts past 1.6°, so a 2.0° floor deskews nothing. The real argument is
wrong-layer (rotate the box, not the page) plus one real-paper exhibit.
**(6) An 11-agent read-only audit ran** — 32 findings. Auto-file has **NEVER fired on this install**
(0 of 360, max overall_confidence 95, threshold 100), so the money/issuer risk is LATENT. At conf==100
`docTrustGate` is SKIPPED entirely. `credit_sign_note`'s raw-marker arm is a DEAD GUARD (`raw_value`
never assigned). `total_amount` has ZERO rows here — the real key is a custom field named `total`.
**CORRECTION: the 08-09 EVENING handover's headline is wrong** — that arm scores **119 ok / 1 wrong /
0 empty**, not "119/0 wrong/1 empty". Nordwind quote 0015 commits `'2.205.60'` (conf 50 + note).

### Prior — 2026-08-09 EVENING: `HANDOVER_2026-08-09_EVENING.md`
Branch **`feat/teach-side-overnight`**, HEAD **`81c8c4c`** (over `7951156`). The money slice:
**totals 89 ok / 28 wrong / 3 empty → 119 / 0 wrong / 1 empty, 30 healed, 0 regressed, all eight
other lanes byte-identical**, replaying the owner's LIVE taught state over 200 documents. Two
mechanisms: `_label_drifted`'s vertical tolerance is floored at `_DRIFT_FLOOR = 0.02` while body text
runs ~0.013/row, so a one-row label move reads as "not drifted" and the box keeps the **VAT row**
(19 of 23 wrong totals were exactly truth ÷ 6 — the arithmetic fingerprint); and money is
right-aligned so a longer value overflows LEFT, with the repair primitive (`_snap_box_to_words`)
scoped to exclude currency. Flags `TEMPLATE_DRIFT_ROW_PITCH` + `TEMPLATE_CURRENCY_EDGE_GROW`, both
DEFAULT OFF, env-only (**no Settings bridge**), and `TEMPLATE_CURRENCY_EDGE_GROW` is inert unless
`template_target_word_snap` / `template_abs_edge_guard` are ON.
**Oracle: SIGN OFF WITH CONDITIONS — C1 + C2 CLOSED, C3 STILL BLOCKING** (give the derived rung the
digit-suffix proof the absolute rung already requires, or census it); C4/C6/C7 outstanding. Ruled
NOT wrong layer; `realdoc_regression.js` is NOT a precondition (one call site, and the live DB's 7
confirmed documents make it vacuous). **A derived money read has NO guard but geometry** — flat
confidence 90 clears the 88 auto-file floor, `currency ∈ _SELF_VALIDATING_TYPES` kills the shape
check, and Stage 4's arithmetic is flag-only/total-role-only.
**GOTCHAS:** `TESTING\_sandbox\userData\docusnap.db` is a STALE taught state (its totals lane scores
1% for unrelated reasons) — the real one is the live `%APPDATA%\ScanFinder\docusnap.db`; use the
sandbox only as a SECOND state for collateral. A green pin proves nothing until you show it can fail
(two of mine were rejected upstream of the leg they claimed to test — use a *code* as the control).
`_DRIFT_FLOOR` is a page-scale constant used as a row-scale predicate in THREE places; the
registration arbiter is still unfixed, and a False drift verdict also vetoes it via `anchor_stable`.
**NEXT SESSION: a workflow-mode audit — the corrected prompt is in the handover, ready to paste.**

### Prior — 2026-08-09 morning: `HANDOVER_2026-08-09.md`
Branch **`feat/teach-side-overnight`** (revert point `8b8b458`). Teach-side arc, all flags DEFAULT OFF.
**MEASURED on 140 unseen siblings of 10 taught documents: date 140/0 (100%), customer 138/2 (99%),
issuer 121/19 (86%), ref 120/20 (86%)** — from 116/21, 88/52, 88/49, 107/29 that morning. No correct
value lost by any fix. **The corpus was REGENERATED today** (the old one re-rolled labels per
document — an artefact the generator fixed on 08-06 in `c74071d`), so every teach-side figure from
before today understates the product; deltas between arms still stand.
**Shipped:** `TEACH_ANGLE_COMPOSE_SCAN` (place the taught box on the page's own tilt, no pixel
rotated — the biggest win), `TEMPLATE_FIXED_ISSUER_REPAIR` (42 of 135 documents read something other
than the curated issuer), three teach-side gates (`4e5c21c`), Chris's findings 1/2/3/5 (`119f28a`),
and the SFDEV "All boxes" overlay that found most of this.
**OVERTURNED — do NOT flip `deskew_on_import`:** straightening at import measured +213 cells with
zero regressions, and Oracle ruled WRONG LAYER. The corpus tilts every page ≤1.6°, inside Tesseract's
self-tolerance and inside the band doc-561 proved HARMFUL, and adds noise AFTER rotating so it cannot
contain the harm case. Re-run at a 2.0° floor the entire heal vanished (0 of 1127 cells). Fix
placement, not pixels — which is what `TEACH_ANGLE_COMPOSE_SCAN` does.
**INCOMPLETE, pick up first:** `TEMPLATE_CURRENCY_EDGE_GROW` — money is right-aligned so a longer
value overflows LEFT (`'£10,603.44'` read as `'0,603.44'`); currency is absent from the edge guard's
gate. Wired and unit-correct but DOES NOT FIRE — find where the guard bails.
**GOTCHA:** `py_compile` is not verification — it never resolves a name. A constant defined before
its dependency passed compile, raised NameError at import, and returned 140 empty documents in every
lane. Import the module. And a DB probe must use `mode=ro`, never `?immutable=1` (it ignores `-wal`).

## Prior — 2026-08-08 OVERNIGHT (autonomous): `HANDOVER_2026-08-08_OVERNIGHT.md`
Branch **`feat/teach-side-overnight`** (revert point `8b8b458` on `feat/reprocess-throughput-autostraighten`).
The owner ran a controlled TEACH-SIDE test — teach 1 document per issuer x 10 issuers, import 20
scanned siblings each — and it was scored against corpus ground truth for the first time. **The 98%
goal was NOT met: date 83 / total 72 / ref 64 / issuer 60 / customer 53 / vat 51 / po_ref 35 /
account 28 / serials 0.** The remaining gap is GEOMETRY (a taught box reading the wrong row/column
on a drifted scan), not rules — do not spend another night on rule slices.
**Shipped dark + measured (`4e5c21c`):** `STAGE05_REF_CODE_GATE` (a taught box committed its own
caption 'Ref' as the reference — Stage 1's digit gate never reached Stage 0.5),
`KEYWORD_GENERIC_CAPTION_EXCLUSIVE` (one code captured into THREE fields — every ref-role field is
seeded the same generic caption bank), `TYPE_TITLE_OWNER_PRECEDENCE` (**the silent one**: type
election is a bucket SUM, so an install-created type owning one phrase loses to a built-in owning a
whole vocabulary, and a template taught against it binds to a slug its siblings can never detect as
— 35 documents matched NO template and the operator got no signal at all).
**REFUTED BY MEASUREMENT — do NOT flip `TEMPLATE_FREEZE_ISSUER_ONLY`:** the freeze defect is real
(a field is frozen from a sample of ONE and stamped at 95), but unfreezing moved po_ref 35→50% and
**vat_no 51→16%** — a VAT number IS a genuine per-supplier constant whose taught mapping often
fails, and the stamp was carrying it. Ships OFF with a reversible sweep so the decision stays open.
**New instruments:** `stress_test/teach_run_ab.js` (replay 200 siblings under a mutated learning
state or env arm, ~6.5 min) + `stress_test/score_teach_run.py` (per-scope/per-field, counts EMPTY
separately from WRONG) + `scripts/teach-sandbox.js` snapshot/restore. **OUTSTANDING: the Chris
replication arm of the owner's instruction was not run.**

## Current session state (2026-08-08 EVENING, owner present) — ORACLE ×2 · SEC-17 FAIL-OPEN fixed · teach label-pick · 2 live pattern defects · 2 owner decisions shipped · Pelican `customer_name` diagnosed
**READ `HANDOVER_2026-08-08_EVENING.md` FIRST** (NOT `HANDOVER_2026-08-08.md`, a MISDATED older
file; `_DAY` is the earlier half of the same day). **HEAD `87c3057`, 13 commits, ALL PUSHED.
NOTHING NEW FLIPPED** — the owner said they will flip when the arc finishes.
**(0) THE NAME_UNCLIP ARM RAN AND IS A TRUE NEGATIVE — do NOT flip `NAME_UNCLIP_RECONCILE` for the
Pelican class.** 110 docs × 2 arms: HEALED 0 · REGRESSED 0 · collateral 0. Structurally inert, three
declines: C2's floor `len(wl)<4` vs a 2-char remnant `'lt'`; C3's `_uv_text_page_present` SKIPS
tokens with alnum core <4 (its docstring's example is literally `'Ltd'`) so it never tests the cut
token; and C1 needs a CROP witness but a teach leaves NO `field_anchors` row. **The better finding:
`supplier_hints` holds the correct value at `usage_count=10` and `keyword_override` reads it too,
yet the clipped taught read beats both at 95 — `hint*` is its own witness family, excluded from
C1's `{keyword, crop}`. The system knows the answer twice over and cannot apply it.**
**(1) SEC-17 Oracle pass found a LIVE FAIL-OPEN IN THE SHIPPED FIX** (`917a009`) — SIGN OFF W/COND,
3 BLOCKING, ruling **LEAVE IT ON**, severity down to **LOW**. `_realCanonical` returned the RAW path
on ENOENT while the ROOT was canonicalised (two frames, one comparison), so a MISSING leaf under a
junction still passed; the shipped comment's "openPath would fail anyway" holds for `open-file` but
NOT `show-in-explorer`, which reveals the CONTAINING directory. Fixed by an ancestor walk. B2: the
pin's FAIL-CLOSED line asserted the OPPOSITE of its label and the `return null` branch was ENTIRELY
unpinned. 20 pins, zero skips. **B3 STILL OPEN + BLOCKING for release** (the refusal is SILENT —
both channels are `ipcMain.on`; discharge by a visible distinct refusal OR a MEASUREMENT on a
dehydrated-OneDrive-offline file). **C5 SEAM: containment is NOT total** — door 2 of
`_isOpenablePath` matches `stored_path` TEXTUALLY, so a doc filed through a junction opens fine.
**(2) TEACH LABEL PICK** (`1eb96fb`+`b41cad6`) — `autoLabel` picked by ARRIVAL ORDER; now calls the
shared Oracle-signed `pickLabelCandidate` the Review ⊕ tool has used since 07-11 (that module's own
comment recorded teach's gap as "C5"). Oracle GRANTED default ON after refuting the regression he
looked for, then found a real smaller one — **T1**: the scored-out path replaced a LOCATED box with
the synthetic strip. 27 pins.
**(3) TWO LIVE VALIDATION DEFECTS** (`c15f679`) — `iban` rejected every conventionally-printed IBAN
(while `trust.js` ACCEPTED it, so the renderer warned on correct values); the `ip_address` IPv6 leg
accepted `09:30:15` as **TYPE-AUTHORITATIVE** (`_PRECISE_VAL_TYPES`) and rejected `fe80::1`, the
example the UI prints. **The new JS pin caught a gap in my own IPv6 fix** that `re.search` had waved
through — the Python pin now asserts WHOLE-VALUE coverage.
**(4) OWNER DECISIONS SHIPPED** — `delivery_number`→`reference_code` (`3dc162c`, **migration 59
CONFIRMED APPLIED** on restart; of 126 distinct values exactly ONE lacks a digit: `'Delivery'`, the
bug itself; **extraction deliberately does NOT move** and that is PINNED). `ocr_type` **RETIRED**
from the UI (`2a85838`; column stays defaulted; the dev CLI was REPOINTED to the field's real type).
**(5) DATA-TYPE WIDENING = ORACLE SEND BACK** — do NOT build as specified. B1–B6 + G2/G6 in
`pendingfeatures.md`. **B2 struck a claim I had written: `STRICT_TYPES` is NOT the rail** (it checks
FORM; a wrong-PARTY value is well-formed and passes, and a strict type `continue`s past the
cold-scope check). `guessType` AUTO-SELECTS the broken types, so it is NOT as latent as filed.
**(6) OWNER-REPORTED, DIAGNOSED: Pelican `customer_name` wrong 66/72** (`d0ef6a2`) — ONE mis-sized
taught box on tpl 33: `tw=0.1627` ends FLUSH with the last glyph (drift shears the `d` →
`'Bramblewood Joinery Lt'`), and `th=0.0151` ≈2.2 line-heights admits the address row
(`'Unit 4, Sawpit Lane'`). **Word-snap AND abs-edge-guard are both ON but EXCLUDE NAMES by design**
(`template_mapper.py:308`), and the healer that owns names, `NAME_UNCLIP_RECONCILE`, is OFF. Clipped
commits at 95 and beats a CORRECT `keyword_override` at 83. **The obvious fix is WRONG — measured:
`TEMPLATE_FREETEXT_GUARD_PARITY` heals 1 of 66** (values score 0.67-0.75 vs the guard's 0.5 floor).
New read-only harness `stress_test/name_unclip_ab.js`.
**MY OWN CORRECTIONS THIS SESSION — do not re-derive them wrongly:** the free-text template-rung
population is **93 of 99** on docs 738+, NOT the "~1 read in 24" I recorded (the near-inert verdict
survives only on YIELD, never quote the reachability figure); the "Discount typed Percentage"
example is WRONG (`discount` is a shipped key — use `unit_price`/`account`); my currency-sign line
cites were STALE (`keyword.py:1509` + `_clean_value` `:1768-1772`); and `STRICT_TYPES`-as-rail (above).
**GOTCHA: `pytest tests/` ABORTS** — the suite mixes pytest and script-style files and one
`sys.exit`s at import. Four pre-existing failures verified identical with this session stashed.

### Prior wrap — Current session state (2026-08-08 DAY, owner present) — NIGHT3 slices BRIDGED + ORACLE-GATED · teach MULTI-PAGE shipped · SEC-17/18 · 4 self-corrections
**READ `HANDOVER_2026-08-08_DAY.md` FIRST** (NOT `HANDOVER_2026-08-08.md` — that filename is one of
the MISDATED older files). **HEAD `078569e`, 11 commits, ALL PUSHED.** Owner order was: Oracle the
shadow slice → bridge the two flags → the stale-shadow drop → then "finish teach wizard + template
manager anchor/value detection; all data types, not a subset; custom == built-in; keywords 100%".
**(1) `TRUST_SHADOW_ROW_SKIP` Oracle SIGN-OFF-W/COND, both BLOCKING conditions answered** (`e18859c`):
C1 raw-string sign check — `#718`/`#726` both carry the minus, and `credit_sign_coherence` is already
live; C2 new read-only harness `stress_test/shadow_row_skip_ab.js` — **its first run was VACUOUS**
(0 shadow rows/60 docs; "type lacks the money role" selects almost everything and mostly picks pages
with no totals), retargeted it moves exactly `#718`+`#726`. C3 `roleKeys` now from `COMPANY_KEYS`
(drift with `foreignFields.ownFieldPredicate` pinned impossible); C4 one read per doc/batch via
`opts.shadowRowSkip`; **C5 the flip is a SETTING read INSIDE `trust.js`** (env wins both ways for
harness arms) — `_reconcileEnv` does NOT reach it; C6 two FALSE comment citations corrected
(`review/renderer.js:2313` CONSUMES shadow rows for the verified badge; the "at100 precedent" never
existed). **C7: NOT sequenced behind `REPROCESS_SHADOW_STALE_DROP`.** Gate: post-edit ARMED realdoc
**byte-identical** to pre-edit armed; dark vs armed differ by ONE line (536/538); wrong-value 17
identical list. STILL OFF. **(2) Bridges** (`7ab9bcc`) + pin `test_settings_wiring.js` (`0c64dc3`) —
every addressed id must exist, divs must balance, each bridge must keep all three legs.
**(3) TEACH MULTI-PAGE SHIPPED** (`5ad0220`+`078569e`) — nav + real `page_number` in ONE commit;
sandbox smoke PASSED 4/4 (wrote `page_number:1` even when committing from page 1) and found a stale
unconfirmed read-back on page change, fixed. **(4) `resolve_geometry` page pad** (`6c85157`) —
shipped **ON** (`TEMPLATE_PREVIEW_PAGE_PAD=0` kills), Oracle GRANTED the default-ON deviation.
**(5) Free-text guard parity + fall-through cap** (`1f8ff9c`) — DARK, and **MEASURED NEAR-INERT**:
3 realdoc arms byte-identical; `supplier_name` is NEVER read by a template rung (logo/hint outrank
it), 1 template-rung free-text read in 24 docs. Correct in principle; **do not present as a heal**.
**(6) SECURITY `915c412`** — SEC-17 reparse-point containment (junction inside an approved root beat
the textual check; `realpath` was nowhere in `src/`) shipped **ON**, OPEN path only; SEC-18 explicit
`nodeIntegration`/`sandbox`. SEC-19..22 OPEN in **`SECURITY_BACKLOG.md`, which is GITIGNORED** —
`pendingfeatures.md` holds the only tracked pointer.
**FOUR OF MY OWN CLAIMS WERE REFUTED AND CORRECTED — do not re-derive them wrongly:** landmark
starvation is NOT caused by `_excludeBoxesFor` (13 of 15 starved templates have ZERO mappings, so the
exclude list was empty; and landmarks feed ONLY Stage-0.5 relocation, so just tpl 30 pays anything);
the teach `page_number:0` hardcode was TRUTHFUL (the wizard was page-1-only) — a missing FEATURE, not
a bug; the free-text truthy `val_type` comes from six SHIPPED CONFIG keys, NOT `_TYPE2VAL`, so
BUILT-INS skipped the guards and CUSTOM fields got them (inverted from my first report); and the OCR
DoS limits DO exist and are thorough (300 pages/500 MB/10 000 px + a 300 s watchdog).
**Also corrected: `REPROCESS_SHADOW_STALE_DROP` IS gateable** — `mergeReprocessRows` is a pure
function whose sibling switch states in-code that the unit battery is the gate.
NEXT: Oracle on SEC-17 · the landmarks-are-page-0-while-mappings-can-be-page-2 question · four owner
decisions (`ocr_type` wire-or-delete, `delivery_number` retype, signing, restricted Python account).
GOTCHA: a SANDBOX APP IS STILL RUNNING on port 9223 (PID 47032). `007` is NOT a registered subagent —
spawn general-purpose + persona.

### Prior wrap — Current session state (2026-08-07 NIGHT3, autonomous) — delivery defect FIXED · 3 slices DARK, all gates GREEN
**READ `HANDOVER_2026-08-07_NIGHT3.md` FIRST. HEAD `359f2c7` + handover; ALL PUSHED. Executed the
NIGHT2 plan under the owner's standing "run on auto and safely, no regressions".** Three slices built,
**ALL DEFAULT OFF, no flips, no confirms, no live-DB writes** (the Pelican docs are as the owner left
them). **(1) `TEMPLATE_INLINE_ROW_OVERLAP` (`d3cca7c`)** — `_target_inline_with_anchor` reused
`_DRIFT_FLOOR=0.02` (a DRIFT constant, ~1.5-3 line pitches) as a SAME-ROW tolerance, admitting the
label-ABOVE layouts its own docstring excludes, so `_pick_fuller_code`'s inline-disagreement branch
committed the caption `'Delivery'` (a dictionary word outscores a code on LSTM conf). Fix =
`tol=(anchor_h+target_h)/2`, the geometric definition. ONE predicate gates BOTH reconcile call sites;
`_inline()` is a third unswitched door, guarded ONLY where a stored offset exists (legacy dx=dy=0 keeps
`_inline()` PRIMARY — **pinned trade-off**). **Pelican arm D: 5 healed / 0 regressed** with both
reconciles still ARMED (= NIGHT2's arm C without the sledgehammer); collateral date+customer 0 moved;
realdoc 714 byte-identical (**not vacuous — `#728`/`#732` are on that template and correctly untouched**);
census 3/38 mappings change, all template 33. **(2) `REF_ROLE_DIGIT_GATE` (`7a02422`)** — the digit
predicate was right, its ARMING was a hardcoded pair; widened to the REF ROLE via
`_infer_validation=='alphanumeric'` (newly armed: credit_note/delivery/invoice/reference_number).
**Corpus 0 T→F / 7 F→T, ref 45.4%→47.9%**, all other lanes identical; 0/713 confirmed values rejected.
The heals FALL THROUGH TO THE CORRECT VALUE (`'Meadowvale'`→the real code), better than designed.
**(3) `TRUST_SHADOW_ROW_SKIP` (`5948f9c`)** — `docTrustGate` judged filability on INVISIBLE
`shadow_reconcile` rows → `unverifiable-value:<field>` deadlock, sealed twice. **realdoc auto-file
536→538, wrong-value auto-files UNCHANGED at 17.** The harness-overlay trap was fixed FIRST and the
threading verified in isolation. **CROSS-CUTTING PROOF: post-edit baseline (all 3 OFF) ==
pre-edit baseline, byte-identical, 714 docs.** **NOTHING IS FLIPPABLE YET** — no Settings bridge was
added (outside the plan); the two extraction flags need the `_reconcileEnv`+toggle pattern
(precedent `60606d9`), and `TRUST_SHADOW_ROW_SKIP` needs an owner decision because it is a JS-side
`process.env` read that a `_reconcileEnv` bridge does NOT reach. **PLAN DEVIATION — the NIGHT2 plan's
"Oracle → thread → build" for the shadow-row slice ran WITHOUT the Oracle pass (advisors may not be
spawned unsolicited this session). Gates green ≠ signed off — run Oracle before that one flips.**
**✓ RESOLVED 2026-08-08 — the shadow-row Oracle pass WAS run: SIGN OFF WITH CONDITIONS, both BLOCKING
conditions answered and C3-C8 implemented (`e18859c`). The other two slices (`TEMPLATE_INLINE_ROW_OVERLAP`,
`REF_ROLE_DIGIT_GATE`) are now BRIDGED to Settings but STILL have no Oracle pass — bridging made them
reachable, not approved.**
NEXT: `REPROCESS_SHADOW_STALE_DROP`
(designed; ~~**realdoc cannot gate it** — the reprocess merge isn't exercised there~~ **← CORRECTED
2026-08-08: it IS gateable. `mergeReprocessRows` is a PURE function with an existing unit battery,
and its sibling switch `REPROCESS_ANNOTATED_EMPTY_WINS` states in-code that realdoc is structurally
blind to that merge and THE UNIT BATTERY IS THE GATE. It does not need a new harness. Oracle also
ruled it is NOT a prerequisite for `TRUST_SHADOW_ROW_SKIP` — it fixes a stale "✓ mathematically
verified" BADGE, which is not a gate input.**). GOTCHAS: the
corpus scorer's `TAG` defaults to `base` so untagged runs overwrite ONE jsonl; it records `<lane>_got`
only when WRONG, so a heal reads as `'X' -> None` in a naive diff (read `verdicts`).

### Prior wrap — Current session state (2026-08-07 NIGHT2) — VAT-reg guard SHIPPED+FLIPPED · delivery defect DIAGNOSED · 2 designs ready
**READ `HANDOVER_2026-08-07_NIGHT2.md` FIRST. HEAD `5ee4718` + handover; ALL PUSHED. Owner approved an
autonomous night run: "run on auto and safely, no regressions".** (A) **SHIPPED + OWNER-FLIPPED LIVE:**
`vat_reg_not_amount` + `net_misread_total_flag` (`d575668`/`60606d9`/`2a1ae7d`) — a letterhead VAT
REGISTRATION NUMBER was read as a TAX AMOUNT (`number_format` rule 3 mints a decimal from the 3-4-2
grouping: `651 0027 84` -> `0027.84`), poisoning `subtotal+tax` so ~12 CORRECT docs carried "the total
doesn't add up". Gate: corpus 0 T->F + 0 values moved + `vat_no` untouched · **0 new `reconcile_pick`** ·
realdoc **byte-identical** n=699 · Castellan 19 fires/16 notes cleared/0 gained. As production runs it:
**false alarms 39->0, true flags 16->26**. Oracle SIGN-OFF-W/COND ×2; its BLOCKING C1 (credit-sign note
outranks net-misread; the net rail is sign-BLIND) fired on live data (#722). (B) **DELIVERY DEFECT
DIAGNOSED, NOT BUILT:** one wrong-column inline witness reaching the value through TWO reconcile call
sites (`:1241` `TEMPLATE_INLINE_CODE_RECONCILE_DRIFT`, `:1880` `TEMPLATE_INLINE_CODE_RECONCILE`) + a third
UNGUARDED door (`:1283` `_inline()`); admitted because `_target_inline_with_anchor` misuses
`_DRIFT_FLOOR=0.02` as a same-row tolerance. **Arm C (both off) heals 5/5, 0 regressions** —
`stress_test/inline_reconcile_ab.js`. Fix = `tol=(anchor_h+target_h)/2` at `:936` + the same guard in
`_inline()`, flag `TEMPLATE_INLINE_ROW_OVERLAP`, 3 pins. (C) **DESIGNS READY:** gary's shadow-row
auto-file deadlock (`unverifiable-value:subtotal` on an INVISIBLE row — sealed twice; **thread
`extraction_method` into `realdoc_regression.js`/`sweepPredicate.js` FIRST or the gate is vacuously
green**) and reggie's 5 taught-label/taught-value slices (**Slice 1 = widen `PO_REF_DIGIT_GATE` to the
REF ROLE — kills `'Your PO'`/`'Delivery'` system-wide**). (D) **OWNER-SPOTTED, high value:** the TEACH
SAMPLE doc never receives its taught values (`#736` displayed the right value, stored `'Your PO'`,
seeded Learning History with it) — the inverse of "teaching must never hurt". `delivery_number` is type
`text` with NO `validation_patterns.text`, so that field has no format gate at all; retyping it is an
OWNER DECISION. GOTCHAS: a FLAT corpus lane is not a pass — verify the guard ARMED (diff the jsonl);
`realdoc_regression.js` writes a FIXED filename (copy between arms); 4 pre-existing Python failures,
verified identical with the session's files stashed.

### Prior wrap — Current session state (2026-08-07) — date-crop premise REVERSED + SFDEV crop fix + credit-note type family + debug-table spec
**READ `HANDOVER_2026-08-07.md` FIRST. HEAD `2a9a556`; 5 commits, ALL PUSHED.** Two halves. **(A)** Built the
date-crop READ root fix but a 4-doc probe REVERSED its premise: root is NOT the deskew frame — the TIGHT
taught box CLIPS the leading glyph on BOTH frames (every angle); a padded WINDOW+psm6 recovers it.
`837b7d6` **`TEMPLATE_PAD_WINDOW_READ`** (dates only, OFF): a taught date's padded re-read flags a confident
parsed-value disagreement (never swaps; geometric neighbour guard). gary+reggie→Oracle W/COND; NF M=0 + 1
corpus true-positive. **`DATE_CROP_DESKEW_READ` design is SUPERSEDED (banner added) — do NOT build the
raw-frame election.** `63e0cb3` **SFDEV crop fix** (dev): the trace now shows the WINNING rung's crop
(`target_geom` bbox-match, badged "← read"), not the first same-stage abs crop. **(B)** Owner ran a fresh-DB
new-customer test (import→teach→review) → surfaced the credit-note-typed-Invoice class; root-caused THREE
distinct causes, all fixed DARK under ONE owner toggle (`heading_absent_reread` → 3 env flags via
`_reconcileEnv`): `66c526a`/`4026222` **rung-3** (`HEADING_ABSENT_REREAD`) — the `--dpi` pass DROPS a large
title (proven), a pixel pre-gate + band re-read recovers it; Oracle W/COND, gate type +1/0-mis-type,
owner-watch C2 (recovered type ungraduated-100 floor, watch it graduating to 95). `2a9a556` **#2**
(`HEADING_TITLE_GAP_COLLAPSE`, keyword.py) — a wide-TRACKED title `'CREDIT    NOTE'` splits at the
column-break marker → scores as a mention; fix collapses whitespace ONLY inside the matched type-phrase span
(herald); gate type +2/date +1/0-regress; **+ #3** (`REPROCESS_HEADING_GEOM`, process_docs.py) — a cached
reprocess never builds page-0 geometry so heading rungs are inert; one bounded page-0 pass when no trusted
heading. **All 4 new switches default OFF, byte-identical off; env bridges in `handler.js _reconcileEnv`.**
Harness can't bit-reproduce app OCR drops/tilt misreads → gates prove NO-REGRESSION, heals are OWNER-WATCHED.
**NEXT: BUILD the SFDEV bulk debug-table** (owner-designed queue-wide field grid → `debug_values.json` + winning-
rung slices, saved only on reprocess-with-SFDEV-open — full spec in the handover). A sandbox instance is
RUNNING with all heading flags. **`_CLEAN_DATE_CONF`=94 defeats the merge cap → the validation_note is the sole
auto-file block (trust.js:466); pin the DECISION, never `conf==88`.** Prior wrap (08-06 DAY2, HEAD `8ddbc80`,
4 taught-read flips + snap-union shelved): `HANDOVER_2026-08-06_DAY2.md`.

## Prior wrap (2026-08-05 day) — jitter-crater arc CLOSED (A/B/C/D dark, gates green); settings-bridge + owner flip
**2026-08-05 (Fable 5, autonomous). Commits `b63bd86`·`8f631b8`·`2ddd5fa`·`fafd8b4`, PUSHED. READ
`HANDOVER_2026-08-05.md` FIRST.** The 08-04 born-digital charter was OVERTURNED (Oracle UPHELD,
`docs/oracle_log.md` 2026-08-05): the crater = ABSOLUTE-RUNG CLIPPED-CLEAN-READ COMMITS (cut
taught box reads a clean partial → passes shape_mode='ignore' → commits 78-90 silently; every
shipped heal keys on page-vs-taught DISAGREEMENT so nothing fires — armed rerun byte-identical);
digital-worse = crisp partials PASS the gate, scan garble FAILS into the heal ladder; PLUS 34% of
harness taught mappings had value-as-label poisoned anchors (harness-only; wizard defended).
**BUILT DARK + GATED GREEN:** A harness label fidelity (audit 48→0 value-as-label) · B
`TEMPLATE_DATE_CLIP_GATE` (date-clip fragments rejected pre-salvage; '07-01-20' 2-digit PINNED
accepted) + UNSWITCHED parse_date year<1000 floor (live) · C `TEMPLATE_ABS_EDGE_GUARD` (word-edge
predicate on the abs rung → word-bounded GROW → edge-directional comparator → independent-WITNESS
(cut word's locate text ⊂ grown) → consent ladder → defer-cap fall-through floor; stored mapping
never mutated; names EXCLUDED — NAME_UNCLIP owns them) · D `TEMPLATE_LABEL_DIGIT_EXACT` (digit
needles can't fuzzy-lock a different value). **GATES:** clean arm ZERO T→F + 21 pure heals (ref
70.1→74.7, date 91.3→93.4) · right-jitter ref 85.7/66.1 · date 91.1/83.9 · po_ref 100/78.6 ·
job_ref 100/100 (dark: 12.5/19.6 · 3.6/26.8 · 14.3 · 0/57) · left-jitter ref 69.6/62.5 · realdoc
543 baseline==armed (silent 14==14, M_type 0). Oracle caught the DEAD WYSIWYG pin
(test_template_target_word_snap.py:108 empty slice — rebuilt behaviourally). **NEXT: handler.js
env-bridge + Settings toggles for the 3 switches → owner flip.** Owner checks pending: teach-snap
feel · docket_10 `clip_decline` · C2b copy. Residuals: left-cut DATE digital 46.4 · issuer-under-
jitter 0 by design · test_template_rescue(1) pre-existing. GOTCHAS: electron.exe never .cmd ·
never edit mapper py mid-arm · `git add -A` from ROOT stages `Backup/` · no inline `py -c` · the
edge-clean wiring pin inspects the module prefix before the first `def` — mapper kill-switch
getenv lines stay in the top flag zone, functions below.

## Prior session state (2026-08-03 NIGHT wrap) — perfect-catch arc: SIX flips live, all Oracle-gated
**2026-08-03 day+evening+overnight (Opus 4.8 → autonomous night). HEAD `1ab4606`, PUSHED. READ
`HANDOVER_2026-08-03_NIGHT.md` FIRST (owner-morning list + the night's engineering story), then
`HANDOVER_2026-08-03.md` (the morning crosscheck-outlier arc).** Owner goal locked: teach once →
perfect catch on CLEAN siblings for ALL anchored values, silently (rule: minimal customer
interaction, max auto-file — memory `feedback_minimal_interaction_autofile`).
**LIVE flips (all advisor→Oracle→gate, Settings→Processing toggles):** `crosscheck_outlier_reconcile`
(morning, `09685d9`) · `universal_verify_restore` (Slice-2 2a ref/date universal verify, `eb2834f`;
2b numeric + 2c flag DARK behind `UNIVERSAL_VERIFY_NUMERIC`/`_FLAG` pending the Customer-corpus GT
scorer — Oracle C6) · `template_code_edge_clean` (punctuation label-tail heal, `5e78a8d`, fork RULED
reggie witness-equality) · `template_target_word_snap` (Slice B — derived rungs snap the seated box
to word geometry; own gate +1 ref/+1 date heal + 5 false-flag drops, M identical) ·
`template_code_frag_clean` + `template_clip_commit` (`df80601`/`1ab4606` — the rb_531 class:
`_pick_fuller_code`'s disagreement branch stamped a FACTUALLY FALSE "manually mapped value differs"
note on a never-shape-checked clean value, + the α-variant silent dirty commit; healed via
label-suffix fragment strip + 3-leg clip commit + the PROVISIONAL consent channel — taught-doc
skeletons in a SEPARATE index, S2-isolated from every veto path, consumed only by
`_shape_consents`). `_pick_fuller_code` branch order is LOAD-BEARING (un-clip → frag → C2a → conf
race; pinned). Pins: `test_template_frag_clip.py`(29) + `test_template_target_word_snap.py`(18) +
`test_template_code_edge_clean.py`(24) + `test_universal_postmerge_verify.py`(61).
**OWNER-MORNING (pendingfeatures NIGHT entry):** RESTART app then reprocess Northgate dockets ·
C2b honest disagreement copy (owner voice) · teach-time box word-snap (UI-visible, gary-designed) ·
`_seed_field_patterns` ref_field_key threading (gated follow-up) · rehearsal-read + annealing
designs · Slice-2 2b/2c GT scorer. Chris the customer-sim rated KEEP (priority+framing impact).
**GOTCHAS:** harnesses via `node_modules/electron/dist/electron.exe` NEVER `electron.cmd`; never
edit `template_mapper.py` while a realdoc arm runs (workers import per shard); `git add -A` from
repo ROOT stages the untracked `Backup/` tree — stage explicitly; dev diagnostic logs =
`repo/Debug/diagnostic_<UTC>.jsonl` NOT userData; advisor files now carry prior-art rule + track
records — keep accruing at wraps.

### Prior session (2026-08-02 wrap) — Chris fix cycle · clamp+sweep+workflow ON · de-pathing · teach-first PLAN
**2026-08-02 (Fable 5, overnight autonomous + owner day/evening). HEAD `5652487`, PUSHED, tree
clean. READ `HANDOVER_2026-08-02_NIGHT.md` FIRST (wrap + NEXT-SESSION ORDER), then
`HANDOVER_2026-08-02_OVERNIGHT.md` (overnight/day detail). NEXT ARC (owner-set): (1)
template-system FINE-TUNING + SFDEV every-step trace (pendingfeatures entries — two live
exhibits; build the trace FIRST, it is the arc's observability), (2) teach-first plan owner
go/no-go, then S0 corpus gate (`docs/designs/TEACH_FIRST_FLOW_2026-08-02.md`).**
· **Chris fix cycle**: r1 cards SHIPPED (`29c4927`) · r2 panel-vetted fixes (`ac2d924` — dead
  Document-Actions panel = global `_btn` collision, pinned `test_no_global_collisions.js`;
  invisible empty-states `display:''` class; truthful soft-delete dialogs) · r4/r5 via the FULL
  SANDBOX (`/christest` skill; `DOCUSNAP_USERDATA` dev-only hook, CDP 9223, seeded license,
  PrintWindow capture `scripts/capture-window.ps1` — CDP screenshots hang on this build).
· **Flips (owner-ordered)**: label-tail clamp BUILT+ON (`53513cf`, `ANCHOR_LABEL_LEFT_CLAMP`;
  Oracle ACCEPT-AS-RESIDUAL on #218, amended letter "zero UNRESIDUALED flips", W1-W3 watch bars)
  · catch-up slice-4 gates GREEN + `scope_sweep_enabled` ON · workflow suite ON
  (`WORKFLOW_FEATURE_ENABLED=true`) + two-step Approve arm (`32b4c38`) + secure stamped viewer
  (route-id, party-or-admin) + doc history + audited export.
· **De-pathing**: search ROWS projected + has_file, raw shell channels admin/edit (`a58bc10`);
  Document-detail DTO BUILT (`b747676`) — `get-document-detail` = `dto.projectDocumentDetail`
  (/v1 shape verbatim), full read Review-only; pins `test_search_detail_depathed.js`.
· **Customer Doc Test corpus** on Desktop (10 unique issuers + Bramblewood owner co, 5 types,
  Digital+Scanned renditions, ground_truth.json; generator `stress_test/gen_customer_test.py`).
  The teaching run surfaced the two template exhibits that named the fine-tuning arc.
· **Teach-first PLAN signed** (barry+gary → Oracle; EXTRACTION-INERT — S4 deleted, auto-reprocess
  flagship → S1.5 consent heal; the sell: ⊕ path EXCLUSIVELY arms the ownership validation cap).
· Diag-log completeness shipped (startup context · uncaughtExceptionMonitor · ipc-handle wrap ·
  renderer-error sink cap 50) — "check log and know exactly what the problem is".
· GOTCHAS: stale-main bit AGAIN (new IPC missing in running main = eternal spinner — restart for
  main-JS commits) · PS5.1 `-replace`/Set-Content mojibakes UTF-8 (python for text surgery) ·
  `git commit -F <file>`, never `-m @'…'@` here-strings.

### Prior session (2026-08-01 NIGHT) — D1 live · live-fill fixed · catch-up slice 3 · Chris
**2026-08-01 evening (Fable 5, owner present). HEAD `8d66041`, PUSHED, tree clean. READ
`HANDOVER_2026-08-01_NIGHT.md` FIRST — it carries the NEXT-SESSION ORDER (owner-set, EXECUTED 2026-08-02): (1) vet +
implement Chris's round-1 cards (triage table in the handover, NOTHING implemented yet), (2) build
the label-tail crop CLAMP (Oracle SIGNED W/COND, build-ready — `pendingfeatures.md` "Label-tail
crop CLAMP" has C1-C7 + G1-G6 verbatim), (3) owner eyeballs the 3 GT-poison exhibits → Learning
Repair, (4) catch-up slice 4 gates → flip.**
· **D1 digit-disagreement flag ON** (`8c4ddea`, kill `DIGIT_DISAGREE_FLAG`): distinct-stage ledger
  witness differing by 1-2 digits on an identical skeleton → flag+suggestion, ref-role only, LAST
  in the pinned note chain; census 300 docs 0.00% false (`stress_test/census_digit_disagree.js`);
  comparator SHARED with banked D2 (`suffix_reconcile.digit_substitution_diff`). D2 second-render
  witness REFUTED by bake-off ×2 (5:1 false:true) — banked with revival bars. #86/#154/#285 =
  GT-POISON (pixels eyeballed twice — pages print the "wrong" values).
· **Blank-supplier live fill CURED end-to-end** (`ac96929`+`30fb97c`+`5f1bc80`): unpinned blank
  docs re-identify via the guarded JS identifier (fresh-pick-only admission, anti-recollision
  pinned); the bb-exception now cracks the anchor-abstain wall (marker widened to BOTH veto
  copies /(confirm|set) the correct company/); the stale note display-hides while the ⟳
  suggestion shows. Owner-verified live (18-doc Saltmarsh batch pill-fills; 36 auto-committed).
· **Catch-up Filing slice 3 BUILT dark** (`78d2fc5`): accept/undo IPCs + consent bar; INTERNAL
  `{via:'scope_sweep'}` 4th arg (never payload-suppliable); machine confirms skip saveCorrections;
  undo server-checks `confirmed_via`. Slice 4 gates before any flip; env `SCOPE_SWEEP=1` = trial.
· **Chris The Customer** advisor + `customer-experience-review` skill (`b357a30`) + working
  Playwright/CDP driver (launch `npm start -- --remote-debugging-port=9222`, connectOverCDP).
  Round 1: 100% citation accuracy, found a real grammar bug (renderer.js:2567 "1 field that
  were"). His suggestions NEVER change code without owner vet.
· **Label-bleed crop class root-caused** (007: label-blind +20px pad + 141px scan jitter ⇒ 13/16
  crops intrude the label tail; fate trifurcates; ws09 = near-miss wrong-value class; corpus-wide
  47 recovered rows / 4+ suppliers). Clamp fix Oracle-signed (C1 frame trap: expected-value-left
  from the LOCATED label + stored offset, never the taught box). NOT BUILT.
· GOTCHAS: stale-main-process bit thrice more (restart for main JS; window REOPEN suffices for
  renderer-only); an Edit once wrote a NUL byte into renderer.js (grep suddenly says "binary
  file" → scan for \x00, repair via python byte-surgery); `documents` has NO updated_at column.

## Prior session states (2026-07-28 and earlier) — archived, read on demand
The per-session state blocks used to stack up here and bloated this file past 1800 lines. They are
now archived, not lost:
- **Each session has a `HANDOVER_<date>[_PART].md`** in the repo root (07-15 → 07-28_NIGHT). Read the
  one matching the work you're resuming.
- **`docs/session-log.md`** carries the VERBATIM per-session blocks (2026-07-09 → 07-28) in one
  greppable place — grep it (or the matching `HANDOVER_*.md`) before re-touching anything a recent
  session built.
- **`MEMORY.md` index + `memory/project_*.md`** carry the durable per-feature facts (commit hashes,
  kill switches, gate results, open follow-ups).
Keep this file lean: when a new session wraps, REPLACE the current-state block above — do not stack a
new one on top. Move the outgoing block to `docs/session-log.md` (+ a `HANDOVER_*.md`). The `/newsession`
skill does this.

**Durable gotchas from past sessions (full context: `docs/session-log.md` + memory index):**
- Packaged EMBEDDABLE Python (`vendor/python`, `python312._pth`) drops the script dir from `sys.path`:
  any spawned Python CLI must `sys.path.insert` then `from ocr.x import …`, NEVER bare `import x`;
  reproduce with `python -P`; verify build-only fixes against `vendor/python`, not `py`.
- The 88 critical auto-file floor passes conf==88 BY DESIGN (blocks only c<88) — pinned in
  `test_scope_trust.js`; do NOT "fix" the comparator.
- A custom doc type is identified by its "Also appears as" ALIASES, never its arbitrary internal name.
- `field_anchors.document_type` stores the SLUG, not the type NAME — a name-keyed lookup is a dead guard
  whose unit test can still falsely pass (the "dead guard greens every test" trap).
- The license window carries its OWN copies of the Settings hierarchy styles — do NOT move them to theme.css.
- Renderer JS changes (Review window, slip-fixer, teach) need the window REOPENED/app restarted to load.
- `processing/handler.js` requires `learning` per-function — a module-load smoke can't catch call-time
  ReferenceErrors (the `77e674e` class); new user-facing files under userData need `_allowedOpenRoots`.
- Test-GT can be poisoned by casual confirms (fictional/test docs plant real learning rows — purge after
  pilots); remediation conventions: `gt_overrides.json` + the archive's 2026-07-10/11 blocks.

## Working rules (read before any fix)

**STOP AND SECOND-GUESS at these six junctures** (owner rule, added 2026-07-24 after a root cause was
missed that the owner spotted immediately; item 6 added 2026-07-27). Not "think harder" — at each named
juncture, spend ONE extra step asking **"do I need more information?"** and **"what am I missing?"**, then
continue. This does NOT override token conservation: it is six specific moments, not a licence to widen
every investigation.
1. **You just looked at an artefact to answer ONE question.** Before closing an image / trace / report,
   describe what ELSE is in the frame. FAILURE 2026-07-24: nine document crops were opened to read a
   reference number; every one of them also showed a visibly SKEWED page, which was the actual root
   cause, and it was read past nine times.
2. **You found a plausible cause and it feels satisfying** — especially when it is a code smell (a wrong
   comment, a suspicious constant, an obvious asymmetry). Ask "why is THAT true?" one level deeper before
   designing. A wrong comment is evidence of confusion, not proof you have found the mechanism.
3. **Your own measurement produced an extreme number.** An extreme number IS the finding — do not file it
   as mild corroboration of the small hypothesis you already hold. FAILURE: `no_candidate = 326/574`
   (57% of rigid crops yielding nothing comparable) was noted as "consistent with clipping" and moved
   past; 57% is a structural mismatch, not an under-sized constant.
4. **Before proposing ANY fix**, ask "am I treating a symptom?" and "what would make this wrong?" — then
   say the answer out loud in the design. A fix that compensates for a misalignment instead of removing
   it will pass its unit test and fail its corpus gate (it did: the crop-headroom A/B bought 2 new silent
   wrong reads and healed 0).
5. **Before concluding, grep the memory index + CLAUDE.md for prior art on the MECHANISM**, not just on
   the symptom. FAILURE: `project_skew_anchor_misread` / `project_detect_deskew_parked` /
   `project_deskew_field_reread` already recorded that skew breaks anchored reads. All three were in the
   index and none were consulted.
6. **You are about to ASSERT that something EXISTS / does not exist / is configured a certain way** — a
   template, field, setting, DB column, learned row, file, flag. **NEVER state system state from indirect
   or partial evidence — VERIFY IT AT THE SOURCE first** (query the DB, read the code, list the table/dir).
   It is almost always a cheap, bounded check (one SQL query / one grep), and when the claim is load-bearing
   for a diagnosis it is mandatory, not optional. A UI or trace signal is NOT the state: "No template match"
   on screen means the matcher did not SELECT one for THIS doc — NOT that no template EXISTS. FAILURE
   2026-07-27: asserted "Northgate has no sales_order template" from a "No template match" flag plus a stale
   forensic, and built a diagnosis on it; the owner knew a sales_order template with ~10 confirms existed. A
   5-second `SELECT … FROM templates` would have caught it and changed the whole root cause. Do not make the
   owner be your fact-checker for state you could have queried.

**Corollary — the owner is a live source of information, not just an approver.** When something is cheap
for them to answer and expensive to infer (how they draw a teach box, whether duplicate imports are
deliberate, what a scan actually looks like), ASK before building on an assumption.

**Token conservation — hard requirement**
- Smallest possible scope: read the fewest files necessary; never scan the
  whole repo unless a narrow, targeted investigation has proven insufficient.
- Stage non-trivial work into incremental edits — prefer a focused change
  over a broad rewrite. Keep investigation and responses concise and
  non-repetitive.

**Extraction/anchoring fixes are system fixes, not document fixes**
Any issue touching field detection, anchors, OCR regions, keyword matching,
validation, supplier/template learning, or extraction accuracy is a reusable
*application-level* weakness until proven otherwise — assume it also affects
unseen suppliers, layouts, and future templates, not just the document on screen.
**Every document in the current corpus is a TEST DOC** (the BF_/KO_/MP_/NS_/PF_/AW_/CS_
batches, SuperStore, etc.) — the deliverable is NEVER a fixed document, always a fixed
SYSTEM. A doc-level outcome only matters as EVIDENCE of a system behaviour. (Operator
actions in-session — a ⊕ teach, a typed correction, a confirm — are fine and are
themselves system-wide by design: a teach lands a supplier+doctype-scoped anchor, a
confirm feeds scope-wide learning. CODE changes, by contrast, must never be tuned to
one document, one filename, or one sample's coordinates.)
- Fix the reusable layer — matching strategy, learning rules, normalisation,
  thresholds, validation — not the symptom on one sample document.
- No one-document hacks: filename-based exceptions, sample-specific
  coordinates, or narrow conditionals tuned to a single case (allowed only
  with a documented architectural reason).
- State explicitly how the fix helps future unseen documents/templates. If it
  mainly helps the sample in front of you and doesn't clearly improve the
  broader system, stop and redesign the approach.
- Verify beyond the single failing document: note likely impact on other
  templates/layouts and regression risk; prefer multi-sample or manual
  cross-checks over a single-document confirmation.

---

## Subagents & skills (advisors the user invokes by name)
Defined in `.claude/agents/*.md`; invoked via the Agent tool. ALL are ADVISORY — they diagnose/
recommend, DO NOT implement unless explicitly asked (implementation stays with main Claude Code).
Brief them fully (a fresh spawn starts cold) and relay findings. Read the agent file for the full
brief. Every design advisor (007/gary/oscar/reggie/eric) carries the **"name the seam"** rule: before
proposing, state what the fix RELIES ON upstream and what safety/gate it DISABLES downstream — the
worst near-miss was a fix correct in isolation that removed a safety another fix relied on (an M=1).
Same OSS-licence hard rule (free for commercial use, state the licence) on all OCR advisors.
- **bob** — senior software/product advisor: report/plan → plain English, fact vs assumption, risks,
  ranked options + recommendation. Use after a report, before implementation.
- **barry** (barry-the-brainstormer) — product BRAINSTORMER: high-value feature ideation for home/
  small-office doc management; full user flows, friction, segment fit; L1–L4 + priority. Brainstorm-
  stage only (still passes advisor+Oracle gate before build).
- **gary** — Python engineering analyst: root-cause (FACT vs ASSUMPTION), smallest-correct testable
  fix DESIGN (backward-compat + migration + invariants), TEST STRATEGY (unit + realdoc M=0 gate + a
  PIN test so a future dev can't restore the bug).
- **oscar** — OCR expert: pipelines, Tesseract PSM/OEM/lang, per-field crop recipes, confidence,
  throughput (flags PyMuPDF AGPL → pypdfium2).
- **eric** — Electron expert: main/renderer, secure IPC/preload, BrowserWindow/webContents lifecycle,
  child-process, packaging/electron-builder, signing, perf/memory.
- **reggie** — regex & extraction-pattern expert: field regexes + validation (invoice/PO/SO numbers,
  VAT, dates, totals, codes) + anchored label→value; precision-first; keeps JS `RegExp` ↔ Python `re`
  aligned (shared `validation_patterns`).
- **007** — elite OCR ENGINEER (deeper than oscar on geometry): separates READING from PLACEMENT,
  follows the coordinate frame, FACT vs HYPOTHESIS. For the hardest positioning bugs (label→value
  drift, registration/frame mismatch).
- **oracle** — FINAL adversarial reviewer: VETS the CONSENSUS (invoke LAST, after the specialists
  agree, or for a hard second opinion). Catches the SEAM between correct fixes, VETS THE PREMISE,
  TRACES code to verify claims, weighs BLAST RADIUS (prefers do-nothing/lower layer), insists FAIL-
  TOWARD-REVIEW, names the VERIFICATION GATE (M=0 + zero accuracy drop). Verdicts: SIGN OFF / …WITH
  CONDITIONS / SEND BACK / DO NOTHING / WRONG LAYER. Log: `docs/oracle_log.md`.
- **iris** / **herald** — perceptual-match & doc-TYPE/heading forensics (read-only, never write the
  live DB). 007 + Phillip run as general-purpose + persona. See the memory index + agent files.

**Skills** in `.claude/skills/`: Python engineering set (`testing-strategy`, `code-quality`,
`performance`, `api-design`, `packaging`, `security-audit` — gary's toolkit), `ocr-document-processor`
(oscar; its requirements.txt lists PyMuPDF — use pypdfium2), `ocr-engineering` (007's deep pack),
`scan-finder-frontend-design` (website/UI).

---

## What this is
Windows desktop app (ships as **Scan Finder** / `ScanFinder.exe`; internal
identifiers, DB `docusnap.db` and `%APPDATA%\DocuSnap` remain "DocuSnap"):
scans documents → OCR → extracts fields → files them intelligently.
Electron + Python backend + SQLite. Fully offline capable.

---

## Business / company details
**Six Mile Software** is a **trading name (sole trader) — NOT a registered limited
company** (no Ltd, no Companies House number as of 2026-06). **Scan Finder** is the
product. Use these for the website (footer, contact, legal/terms), the licensing emails,
and anywhere a business identity is needed:
- **Trading name:** Six Mile Software  *(do NOT append "Ltd" or imply incorporation /
  a company number until one is actually registered)*
- **NEVER surface the proprietor's personal name** anywhere public (site, footer, emails,
  Terms/Privacy). Present the business as **"Six Mile Software" + the virtual address +
  licensing@scanfinder.co.uk only.** (The clean route to full name‑privacy + compliance is
  to incorporate **Six Mile Software Ltd** — then only the company name/number/registered
  office appear; until then, lean on Polar being the seller of record, below.)
- **Address:** Office 1874, 92 Castle Street, Belfast, N. Ireland, BT1 1HE
  (virtual business address)
- **Product:** Scan Finder · **domain:** scanfinder.co.uk · **licensing/email sender:**
  licensing@scanfinder.co.uk
- **Seller of record:** **Polar** (Merchant of Record) — Polar is the legal seller for
  purchases, so the customer's purchase contract + VAT/tax sit with Polar, not Six Mile
  Software. The website/emails still carry the Six Mile Software identity for support.
- Revisit this whole block (and add the company number) **if/when a limited company is
  incorporated**.

---

## Stack
| Layer | Tech |
|---|---|
| Desktop shell | Electron 31, Node.js, better-sqlite3 |
| UI | Vanilla HTML/CSS/JS; **native OS window frames**; shared light/dark theme (`src/windows/shared/theme.css`) |
| LAN add-on | TLS `/v1` API (Node `https`) + detached Electron search client; certs via node-forge (`src/services/certService.js`) — see Detached search client |
| OCR | Tesseract 5 via pytesseract + pypdfium2 |
| Database | SQLite via better-sqlite3 |
| Platform | Windows only |

---

## Directory map
Long per-file design notes live in **`docs/architecture-notes.md`** (marked ➜AN below) — read the
matching block there BEFORE changing one of those files.
```
docusnap2/
├── src/
│   ├── main.js                          # IPC router — thin, delegates to modules
│   ├── preload.js                       # contextBridge API bridge
│   ├── modules/
│   │   ├── processing/handler.js        # folder import, reprocess, OCR region, logos; BACKEND AUTO-FILE (_maybeAutoFile/_autoFileDoc; `auto_file_threshold` slider default 100; type+un-flagged gate is the real safety) ➜AN
│   │   ├── processing/processing_mode_handler.js # mode get/set, fast-mode suggestion
│   │   ├── review/handler.js            # queue, confirm, defer, delete, pages; Advanced → Learning History (view/purge/rename learned values + "Fix likely slips", admin/edit, audited; per-row source-docs + Open in Review) ➜AN
│   │   ├── filing/handler.js            # folder structure, rename, XML metadata
│   │   ├── settings/handler.js          # doc types, fields, key-value settings
│   │   ├── templates/handler.js         # Admin Template Viewer; Learning Recovery reassign (reversible) + templates.mergeInto (IRREVERSIBLE fragment merge) ➜AN
│   │   ├── search/handler.js            # document search
│   │   ├── api/handler.js               # TLS /v1 API for the detached client + cert wizard + enroll (see Detached search client)
│   │   ├── workflow/handler.js          # desktop mailbox/approval IPC (entitlement+role gated; reuses workflowService)
│   │   └── licensing/handler.js         # license gate decideAccess() + trial/activate/revoke/enforcement IPC (see Licensing)
│   ├── lib/license/{client.js,token.js,fingerprint.js}  # backend HTTP client · offline JWS verify · device fp_hash
│   ├── services/{searchService,previewService,workflowService,reviewService,presenceService,entitlementService,certService,sessionService}.js  # transport-agnostic core shared by desktop IPC + /v1. reviewService: atomic claim-then-file confirm (allowRefile intent), central DD-MM-YYYY date normalisation, detached learning hooks (snappy confirm). presenceService: advisory "being reviewed by" TTL map ➜AN
│   └── windows/
│       ├── main/{index.html,renderer.js}      # dashboard + nav rail; customisable/draggable card grid (localStorage order, Settings→Appearance toggles); import view opens result rows in Review ➜AN
│       ├── splash/{index.html,splash.js}      # cosmetic startup splash — shown in whenReady, closed once login loads
│       ├── review/{index.html,renderer.js}    # zoom/pan preview; hidden Template Wizard (⚓) + "Show where it reads" overlay; ⊕ teach readout bar; three role-framed teaching surfaces; Teach-this-document CTA ➜AN
│       ├── teach/{index.html,renderer.js}      # guided "Teach a new document" wizard (non-technical) — see Teaching wizard
│       ├── settings/{index.html,renderer.js}  # incl. Admin Template Viewer + License/Activation-Test tab
│       ├── search/{index.html,renderer.js,search-results.js,search-preview.js,search-actions.js}  # built search UI; entitlement-gated confidence/mailbox/workflow actions (see Detached search client)
│       ├── dev-inspector/{index.html,renderer.js}  # hidden read-only processing inspector (Ctrl+Shift+D+M, pw SFDEV) — see Dev inspector
│       ├── onboarding/{index.html,renderer.js} # first-run setup wizard — see First-run wizard
│       ├── welcome/{index.html,renderer.js}    # first-run familiarisation TOUR (6-card carousel; last-card fork → practice run) ➜AN
│       ├── tutorial/{index.html,renderer.js,fixtures.js}  # SANDBOXED practice run — in-renderer over bundled fixtures, NO real DB/learning/output touched; draw-a-box teach sim ➜AN
│       ├── license/{index.html,renderer.js}   # activation/trial screen shown when the gate locks
│       ├── help/                              # User Guide window (index + content pages, help.css, help-nav.js) — native frame, themed
│       └── shared/{theme.css,theme.js,helpmode.js}  # centralised palette/components · theme toggle · data-help-key help-mode
│   (createWindow opens every panel HIDDEN and reveals on ready-to-show — no
│    empty-background "black box" flash; startup/login flow passes show:false and
│    reveals manually, so it's untouched)
├── database/
│   ├── index.js                         # open(), runMigrations(), runJsMigrations()
│   └── modules/
│       ├── document_types.js            # doc type + field CRUD, seedBuiltInTypes()
│       ├── documents.js                 # document CRUD, search(), getReviewQueue()
│       ├── learning.js                 # hints, anchors, logos, getSetting/setSetting
│       ├── templates.js                # template CRUD, field mappings, sample-document linkage
│       ├── licensing.js                # client license_tokens cache (cacheToken/getActiveToken/clearSeatToken)
│       └── trust.js                    # supplier GRADUATION / safe auto-file: TRUSTED_FLOOR 95 after W=10 clean confirms; isAutoFileEligible = the ONE shared predicate; docTrustGate two regimes (sub-100 full gate, at-100 lenient but blocks deterministically-invalid/shape-violating values) ➜AN
├── python_backend/
│   ├── process_docs.py                  # CLI entry point, streams JSON to stdout
│   ├── extraction/
│   │   ├── engine.py                    # ExtractionEngine — staged pipeline orchestration (see Extraction pipeline below)
│   │   ├── template_matcher.py          # Stage 0: learned-template identification + field seeding (same-logo siblings disambiguated by keyword fingerprint, THEN by the doc's own detected TITLE — see identify_template detected_slug/title_trusted below)
│   │   ├── template_mapper.py           # Stage 0.5: admin-drawn anchor→target zone mapping; absolute-first read → inline-harvest/relocate off the located label (label_box) → registration fallback
│   │   ├── registration.py              # "register, then read": NumPy similarity/affine RANSAC fit (taught landmarks→page) + confidence; no OpenCV
│   │   ├── keyword.py                   # Stage 1: regex pattern matching (incl. job_no 4-4-1 shape, separator-normalised)
│   │   ├── anchor.py                    # Stage 2: spatial anchors + logo match
│   │   ├── ocr_corrector.py             # Stage 2.5 learned misread correction + 2.5d DOMINANT-VALUE SNAP (count-weighted snap to a ≥5-count/≥80%-share confirmed literal; kill SNAP_ALLOW_SUBSTITUTION) ➜AN
│   │   ├── validator.py                 # Stage 4: cross-field validation
│   │   ├── value_quality.py             # name/company/address quality (name_quality, is_name_like_field) — JS mirror in learning.js; is_name_like_field EXCLUDES technical addresses (mac/ip = CODES, not names) ➜AN
│   │   ├── text_normalise.py            # deterministic compare-time normaliser (NFKC/dash/quote/lower/ws/edge); JS twin database/modules/text_normalise.js
│   │   ├── name_match.py                # Stage 4.5 token-level canonical NAME repair (lexicon + positional repair); suggestion-only
│   │   └── identity_fusion.py           # text-led SUPPLIER identity — DORMANT/SHADOW mode (changes nothing; rapidfuzz promotion pending, HANDOVER_2026-07-07.md) ➜AN
│   ├── ocr/{tesseract.py,region.py,landmarks.py,text_enhance.py,born_digital.py}  # tesseract.py rebuilds page text from word GEOMETRY (visual rows — the scanned-totals two-column fix); region.py draw-tool zone-OCR, light-first ladder + multi-line PSM-6; landmarks (registration); text_enhance (degraded re-read); born_digital (PDF text layer, skips OCR) ➜AN
│   ├── logo/fingerprint.py
│   ├── ocr/orientation.py              # AUTO-ROTATE (90/180/270) via Tesseract OSD; rotation SIGN convention PROVEN in tests/test_orientation.py (PIL CCW vs pypdf CW — a wrong sign corrupts every doc); working-copy rotated once at import; auto_rotate_enabled default ON ➜AN
│   └── render/pages.py                 # PDF→PNG rendering — shared by review/search/template preview (see Gotchas). --thumb = single low-res page-1 thumbnail for list thumbnails (previewService.getThumbnail)
├── config/keyword_patterns.json        # editable pattern library
├── config/license.json                 # client license config: base_url, product_id, public_keys (PUBLIC keys only)
├── client/                              # detached LAN search/mailbox Electron client (apiClient.js pins the CA) — see Detached search client
├── cert-tool/                           # standalone TLS cert-generator GUI (node-forge)
└── licensing-backend/                   # separate PHP 8 + MySQL activation server (WAMP/IONOS); see Licensing
    ├── public/{index.php, v1/*.php, admin/*}  # health · /v1 trial_start|activate|validate|revoke|status · admin web page
    ├── lib/{db.php, jws.php, admin_auth.php}   # PDO+JSON helpers · Ed25519 signing · admin gate+CSRF+bright chrome
    └── schema.sql · keys/ (gitignored seeds + admin_password.hash) · scripts/{Configure,Verify}-WampBackend*.ps1
```

---

## Database tables
Long design notes for the annotated tables live in `docs/architecture-notes.md` (➜AN).
```
document_types  — name, slug, built_in, ref_field_key, date_field_key,
                  title_aliases ← mig 43: extra printed-title phrases that ALSO detect the type
                  ("Also appears as" chips; alias == any existing type name hard-rejected) ➜AN
fields          — document_type_id(FK), key, label, type, required, built_in
documents       — document_type_id(FK), original_filename, stored_filename,
                  stored_path, folder_path, status, overall_confidence,
                  supplier_name, doc_date, reference_number,
                  working_path  ← mig 17: app-managed import copy in userData/inbox/<docId><ext>;
                  preferred by preview/reprocess/confirm (source folder need not survive)
                  page_count   ← mig 37: captured at import; drives the multi-page icon (NULL pre-mig)
                  STATUS: pending|needs_review|deferred|confirmed|deleted|error
extractions     — document_id(FK), field_key, raw_value, display_value,
                  confidence, was_corrected, corrected_to, extraction_method
corrections     — document_id(FK), field_key, original_value, corrected_value,
                  supplier_name, document_type
supplier_hints  — supplier_name, document_type, field_key, hint_value, usage_count.
                  Hints FILL EMPTY FIELDS ONLY (usage≥2, conf=min(90,60+usage*5)); the EVIDENCE-BASED
                  VARIABILITY GUARD skips any field with ≥2 distinct confirmed values in-scope ➜AN
field_anchors   — supplier_name, document_type, field_key, anchor_label,
                  direction(right|below|above), page_zone, x/y/w/h_norm, usage_count, confidence,
                  last_authoritative_at (mig 20), offset_dx/dy_norm (mig 21 drift-invariant vector).
                  ⊕ teach persists ON COMMIT not on the draw (staged in pendingAnchors); an
                  authoritative teach is the SINGLE anchor per (field,doctype) — sweeps ALL suppliers
                  and outranks every passive anchor. supplier_name here is a LEARNING SCOPE key,
                  never a required document field. document_type stores the SLUG. ➜AN
logo_fingerprints — supplier_name, phash, ahash, match_count
template_landmarks — template_id(FK cascade), label_text, x/y/w/h_norm, ocr_conf, page_number
                  (mig 22): 3-5 stable words re-located per page to fit the Stage-0.5 registration
                  transform; additive/inert — no rows = existing anchor/offset path ➜AN
template_logo_hashes — template_id(FK cascade), phash, UNIQUE (mig 26): MULTI-REFERENCE logo set —
                  matchers take MIN distance over the set; drifted-but-related hashes appended on
                  confirm (dist (2,13], cap 8); _upsertTemplate reuse band 7-13; accept gate ≤6 ➜AN
settings        — key, value (key-value store). Notable: registration_enabled (ON) ·
                  born_digital_enabled (ON) · name_wordness_flag (ON — free-text NAME review flag;
                  operator "✓ This name is correct" → accepted_name_values allowlist exempts forever)
                  · first_run_completed (mig 24 stamps already-configured installs) ➜AN
migrations      — version, applied_at
license_tokens  — kind(seat|trial), subject, token_blob(JWS), state, not_after,   ← mig 16
                  grace_until, kid  (client cache of the signed token; deletable)
device_registrations — fp_hash, product_id  (local mirror; backend is source of truth)
users           — …, totp_secret, totp_enabled  ← mig 28 (detached-client MFA
                  only; nullable/inert — the in-process desktop login never reads them)
document_routes — document_id(FK cascade), from/to_user_id+username,
                  action_required(approve|acknowledge), state(pending|claimed|approved|
                  rejected|acknowledged|recalled), comment, resolution_comment,
                  claimed_by_*, resolved_at, version  (mailbox/approval; see Detached
                  search client). documents.workflow_status = denormalised latest state.
                  Ensured UNCONDITIONALLY in runJsMigrations — NOT version-stamped.
```

---


## Extraction pipeline
`process_docs.py` → `ExtractionEngine.extract()` runs a staged pipeline:
- **Stage 0** `template_matcher.py` — match a learned template, seed fields (same-logo suppliers
  disambiguated by keyword fingerprint; a null doc-type slug silently disables the format/qualification
  gates). TYPE-PRECEDENCE (2026-07-09): same-logo sibling templates share IDENTICAL fingerprints, so the
  tie-break can't separate them and the established sibling stamps the WRONG type over the doc's own
  title. `identify_template(detected_slug, title_trusted)` breaks the tie by the doc's OWN detected
  title: within the same-logo cluster PREFER the sibling whose `document_type_slug == detected_slug`;
  REFUSE (return None → doc to review to teach) when a TRUSTED title declares a type NO sibling carries.
  `title_trusted` = the type is a STRUCTURAL standalone HEADING (not a confidence threshold). Both args
  computed ONCE in `process_docs`, threaded IDENTICALLY into BOTH identify_template calls (no split-
  brain); custom-type TITLE ALIASES (`document_types.title_aliases`) feed it via detect_document_type.
  Guarded by `tests/test_template_matcher.py`. Full detail: `docs/extraction-pipeline.md`.
- **Stage 0.5** `template_mapper.py` — admin-drawn anchor→target zone mappings. Absolute-target-first
  read → inline-harvest / relocate off the located label → registration fallback ("register, then read").
- **Stage 1** `keyword.py` — regex patterns from `keyword_patterns.json` (~60-70% of fields); label
  word-boundary guards (e.g. "Total" must not match inside "Subtotal").
- **Stage 2** `anchor.py` — learned label positions + logo supplier ID; drift recovery, label-lock,
  digit-parity guard, slip-fix, inline harvest, multi-line continuation.
- **Stage 4** `validator.py` — date normalise/salvage, currency infer, cross-field maths.
- **Stage 4.5** `format_anomaly_checker.py` — coarse-class + learned-shape consistency vs confirmed
  history; free-text guard; token-level name repair; format-weighted overall confidence.
- **Stage 4.6** candidate override — gated, DEFAULT-OFF.

**Processing mode** (`processing_mode`, default `smart`): `fast` and `smart` are now IDENTICAL
(stages 1+2) — they diverged only for the removed AI mode. The user-facing Fast/Smart CHOICE was
COLLAPSED (2026-07-08): no Settings selector, no topbar mode badge, no "Switch to Fast Mode?"
suggestion toast. The `processing_mode` setting + `--mode` plumbing REMAIN for tolerance (a stored
`fast`/`smart` is still honoured; `set-processing-mode` stays registered + admin/edit-gated;
`check-fast-mode-suggestion` is a retired no-op). Reintroduce a mode only if the stages diverge again.

⚠ **Critical invariants — always honour these (full rationale in the doc):**
- engine.extract() returns a FLAT dict mixing field dicts `{value,confidence,method}` with `_`-prefixed
  metadata (`_supplier_name`, `_overall_confidence`, …). Pop `_` keys BEFORE iterating fields; call
  `sanitise_extractions()` after popping, before emitting.
- Supplier identity must reflect the LATEST reliable `results['supplier_name']`, not the first guess —
  engine re-resolves it once, after every stage, before persisting hints/anchors/logos.
- Manual/authoritative anchors (⊕ teach, Stage 0.5 mapping, `keyword_override`) win on regex/TYPE alone
  (`shape_mode='ignore'`) and must NOT be vetoed by the learned-shape check; auto tiers keep full type+shape gating.
  **NARROWED 2026-08-01 (Oracle-signed, S-C, kill `BLIND_GEOM_DISAGREE_RECONCILE` — DARK until owner flip):
  a REGISTRATION-resolved authoritative read that FAILS its own-supplier learned shape may be reconciled
  against ≥2 distinct-stage witnesses (adopt) / flagged against 1 — anchor_inline/anchor_crop_relocated
  winners stay fully exempt (the 2026-07-26 re-teach fix depends on it; pinned in
  tests/test_blind_geom_reconcile.py). Deterministic content-nature flags (date-in-ref S-A, ref-length
  S-B, prefix-outlier) also apply to taught reads — "the teach fixed the position, not the value".**
- Extraction/anchoring fixes are **system fixes, not document fixes** — fix the reusable layer, no
  one-document hacks (see Working rules).

📖 **FULL detail — read before ANY extraction/anchoring/OCR/validation/confidence change:
`docs/extraction-pipeline.md`** (every stage's internals + fix history, the drift/registration/
label-lock/slip-fix/inline-harvest/multiline designs, OCR ladder & crop recipes, `_gate_value`
shape modes, authority precedence, performance notes, and the accuracy/concurrency/load harnesses).

## Filing system
```
OutputRoot/
└── CompanyName/
    └── 2025/
        └── December/
            ├── Invoice.15-12-2025.INV-001.pdf
            └── .metadata/
                └── Invoice.15-12-2025.INV-001.xml
```
- Output root stored in settings table as `output_folder` (set on Settings →
  General; NOT changed by the rules below).
- Duplicate: append `-DUPLICATE` (then `-DUPLICATE-2` etc)
- **OUTPUT STRUCTURE is BUILDER-driven** (Settings → "Output Structure" tab;
  `src/modules/filing/filename_pattern.js`) — two token-block builders (click-to-insert + live preview):
  - **Subfolders** = `output_folder_pattern` (token string, `/` = new level). Default
    `{supplier}/{year}/{month}` = legacy Company/Year/Month (byte-identical if unchanged).
    `buildFolderSegments` token-substitutes + Windows-safes each level + drops empties; handler still
    enforces output-root containment on the joined path.
  - **Filename** = `filename_pattern` (default `{docType}.{date}.{ref}` = `DocType.DD-MM-YYYY.RefNo.pdf`)
    — existing `buildFilename` engine, unchanged.
  - Blocks (`FIELD_TOKENS`): `{supplier}` `{docType}` `{date}` `{ref}` `{year}` `{month}`; same builders
    in the first-run wizard. IPCs `get-output-structure-info` / `preview-output-path`. Guarded by
    `test_filename_pattern.js`.

---

## Default document types
| Type | slug | ref_field_key | date_field_key |
|---|---|---|---|
| Invoice | invoice | invoice_number | invoice_date |
| Sales Order | sales_order | sales_order_number | order_date |
| Purchase Order | purchase_order | po_number | po_date |

**STRUCTURAL fields (Document Issuer / Date / Reference) are PERMANENT** (migration 27,
`document_types.js`): every type has three locked roles — the identity/COMPANY field (`COMPANY_KEYS`
= **`['supplier_name']` ONLY since mig 44, 2026-07-10**: customer_name was UNLINKED from identity →
ordinary OPTIONAL recipient field on every type; mig 45 purged its stale issuer-as-customer learning),
the `date_field_key`, and the `ref_field_key`. The identity field's DISPLAY label is **"Document
Issuer"** for both keys (mig 38 — one unambiguous label so an operator never enters variable data like
a customer name there; supersedes the mig-35 Supplier/Customer split). Label-only: internal keys
(supplier_name/customer_name) + learning schema untouched. These roles drive filing
(`Company/Year/Month/DocType.Date.Ref`) AND all per-supplier learning (logos/hints/anchors/corrections/
template identity key off the company scope value), so the FIELD can't be deleted/disabled/renamed/
retyped — but the per-document VALUE stays editable (correcting a mis-read feeds learning).
`is_structural` annotated per field (getWithFields/getAllWithFieldsAll) for the Settings UI (locked
toggle, no delete, 🔒); `updateField`/`deleteField` enforce it server-side; `create-doc-type-with-
fields` injects a Company field if omitted. Guarded by `test_structural_fields.js`.

**DANGLING STRUCTURAL ROLE — self-heal + Confirm resilience** (2026-07): a `ref_field_key`/
`date_field_key` can point at a field that no longer exists (Reference field deleted, or a type made
with a role key matching no field) → Review's Confirm gate became impossible (required key matched NO
field, Confirm disabled with nothing on screen to fill). Three guards: (1) `repairStructuralRoles()`
CLEARS a dangling role to NULL on the UI type-list loads (getAllWithFields[All]) so Settings shows it
unset + re-pickable (not auto-repointed — the user's call); (2) `updateType` REFUSES to set a role to
a non-existent field key; (3) Review's `validateConfirm` DETECTS a dangling role and shows a clear note
instead of a silent block. Guarded by `test_structural_fields.js`.

**PRESET DOCUMENT-TYPE CATALOG** (Settings → Document Types → "Add from catalog…"; `document_types.js`
`PRESET_CATALOG`/`getPresetCatalog`/`addPresetTypes`): a shipped library of ready-made types a business
TICKS to add — Purchase/Sales Invoice, Remittance Advice, Credit Note, Delivery Note, Statement,
Receipt, Quote. Ticking one ATOMICALLY creates type + fields + structural roles (reuses
`create-doc-type-with-fields`/`ensureStructuralRoles`) AND seeds likely field-label aliases into
`field_label_overrides` (per-install, doc-type-scoped) so Stage-1 has a head start with NO teaching.
Slug derived from the name (`presetSlug`); idempotent; catalog types `built_in=0` (removable). Post-
mig-44 EVERY preset's identity role is **`supplier_name`**; Sales Invoice/Remittance/Delivery Note/
Statement ALSO carry `customer_name` as an optional RECIPIENT field (payer captions "Received From"/
"Payment From" live on `supplier_name`, the issuer). reggie-reviewed labels: only doc-specific captions
+ novel ref/date fields seeded; canonical fields defer to `keyword_patterns.json` `field_patterns`
(single source of truth). Phase 2 (DEFERRED): narrow DETECTION by the enabled-type set. Guarded by
`test_doctype_presets.js`.

---


## Licensing & activation
Optional device-bound license gate: trial + paid-seat. **OFF in dev, ON by default in packaged builds;
enforcement is ALWAYS ON in every build** (no env/setting/dev bypass). The MAIN process is the sole
decider — `enterMainApp()` → `licensingModule.decideAccess()` (`src/modules/licensing/handler.js`); the
renderer can only REQUEST entry (`license-enter-app`), never self-grant. A non-`allow` gate routes to the
license window (`src/windows/license`). Tokens verified OFFLINE (`src/lib/license/token.js`) against pinned
Ed25519 public keys (alg EdDSA, kid pinned). Fingerprint = SHA-256(product_id | Windows MachineGuid)
(`fingerprint.js`) — raw value never leaves main. Config in `config/license.json` (`base_url`/`product_id`/
PUBLIC keys only; bundled via extraResources → rebuild installer after editing). Backend = separate PHP 8 +
MySQL server (`licensing-backend/`, `/v1/{trial/start,activate,validate,revoke,status}` + admin web page).
⚠ Secrets: never log/echo account or activation keys; never re-display a one-time key; never expose
`account_key_hash` or the raw fingerprint.

## Legal / Terms acceptance
Version-stamped acceptance gate from ONE bundled `LEGAL.txt` (repo root; **DRAFT** — solicitor items
outstanding). Surfaced in three places: installer NSIS licence page · first-run / version-bump gate
(`src/windows/legal/`, shown by `enterMainApp()` after the licence gate, before onboarding, enforced in
MAIN) · re-read (About box + Settings → Advanced → Legal). Acceptance stored LOCALLY only
(`settings.terms_accepted = {version,hash,app_version,accepted_at}` — no telemetry, no external calls).
Bump `LEGAL_VERSION` (main.js) + the file's `Version:` header to re-prompt everyone.

📖 **FULL detail: `docs/licensing.md`** (decideAccess specifics, offline verify order, backend endpoints
+ owner-email-on-trial, admin 2FA/TOTP, config keys, and the Legal gate internals + IPC).

**Update-available banner (advisory).** MS Store delivers the binary; the app only SIGNALS "a newer
version exists." Backend `releases` table (per channel: `latest_version`/`update_url`/
`min_supported_version`) rides the EXISTING `/v1/validate`+`/v1/status` responses via `lib/release.php`
`release_info()` — UNSIGNED, non-gating, EXCEPTION-PROOF (failure → null, can NEVER 500 the token
response → no lockout). Client compares `latest_version` vs `app.getVersion()` CLIENT-SIDE (clean
3-part SemVer; `buildRev` never an ordering key). `licensing/handler.js` `captureUpdateInfo` (own
try/catch, persists `update_info` setting, never null-over-good, can't disturb the gate) +
`resolveUpdateInfo` → `get-update-info` IPC + `open-update-url` (scheme-allowlisted https/ms-windows-
store). Home `#dash-update` banner: info-tone, PULL model, per-version dismissal. **Slice 2 forced-
update** (`min_supported_version`): decideAccess sets `gate.forceUpdate` ONLY on a REACHABLE backend
(`belowFloor(...)`) so offline is NEVER locked (FAIL-OPEN, eric's rule) → own lock window
`src/windows/update-lock/` (Update/Quit only; `update-lock-quit` sender-guarded). Guarded by
`test_version.js` (incl. `belowFloor`) + `test_update_info.js`.

## Detached search client (LAN add-on)
A separate Electron search/mailbox client runs on other LAN PCs and talks to the core over a TLS `/v1`
API (`src/modules/api/handler.js`, Node `https`). It is an **entitlement-gated add-on**
(`src/services/entitlementService.js`, `detached_client_licensed` setting) that ALSO upgrades the core
app's own Search; the core works fully standalone with the add-on off. Core services are
transport-agnostic (`searchService`/`reviewService`/`workflowService`/`presenceService`/`sessionService`)
so the desktop IPC and the `/v1` client share one implementation.

Key pieces:
- **/v1 API** — search/preview, review-over-/v1 (queue/counts/confirm/defer via the shared claim-then-file
  `reviewService`), doc-types, presence ("Currently being reviewed by <name>"), workflow routes, enroll/CA.
  DTO projection returns ONLY the frozen contract fields (never `stored_path`/`folder_path`/`working_path`).
- **Managed 2-tier TLS** (`certService.js`, node-forge) — a CA signs a server cert; the client pins the CA.
- **Mailbox/approval workflow** — present but HIDDEN pre-release behind `WORKFLOW_FEATURE_ENABLED=false`.
- **TOTP MFA** (client-only) + **/v1 session revocation** on admin deactivate/role-change/password-reset.

⚠ Security invariants (preserve): real TLS verification, NO silent self-signed bypass in the client UI;
pin the **CA** (`ca.crt`), not `server.crt`; `ca.key` NEVER crosses any endpoint; enrollment needs a
fingerprint/pairing integrity check.

📖 **FULL detail: `docs/detached-client.md`** (every `/v1` endpoint + contract version, cert wizard,
entitlement/workflow gates, presence/reviewService internals, the client targeting-OCR path + open bug,
theming/keyboard-focus fixes, the concurrency/accuracy/import-load stress harnesses, and all tests).

## UI conventions
**Shared theme** — every window's palette + components centralised in `theme.css` + `theme.js`
(loaded by all windows). **ELEVEN named themes**: core SIX — Light · Warm Paper · Nordic Slate (light);
Dark · Midnight · Graphite (dark) — + a Seasonal group (Spring/Summer/Autumn/Winter light + Festive
dark). Each is a `:root[data-theme="X"]` token-override block; **Warm Paper is the default**. Seasonal
themes carry faint repeating SVG-tile artwork from `shared/patterns/*.svg` served CSP-safe `'self'`
(NEVER `data:` URIs — `img-src 'self'` blocks those), `background-attachment:fixed`, low opacity.
`theme.js` sets BOTH `data-theme` (palette) AND `data-mode` (light|dark family) on `<html>`;
`DARK_THEMES` gates the dark family (incl. `festive`) → `color-scheme` + logo swap key on `data-mode`.
`--on-accent` = text colour on a filled accent. Shell `--bg` patterns are pure CSS gradients (CSP-safe,
NO `url(data:…)`). Picked via Settings → Appearance; account menu + rail-foot toggle = quick Light⇄Dark
flip. `set-setting('theme',…)` persists + broadcasts `theme-changed` live. Windows reference the tokens,
no own `:root`.
```css
/* light (default) — the client palette */
--bg:#f4f6fa  --surface:#ffffff  --surface2:#eef1f7  --surface3:#e4e8f1
--border:#e4e7ef  --border2:#d2d8e4
--accent:#3b7df0  --accent2:#2f6fe0  --accent-bg:#e7f0ff
--ok:#1f9d63  --warn:#b07816  --err:#d64545
--text:#1b1f2a  --muted:#69728a  --doc-bg:#eef1f7
--r:12px --r-sm:9px --r-pill:999px        /* rounded buttons / inputs / cards */
Font: IBM Plex Sans (UI) + IBM Plex Mono (values/code) — SELF-HOSTED woff2
(latin subset, OFL-1.1) in src/windows/shared/fonts/ + @font-face in theme.css.
NO Google-Fonts CDN (was a per-window offline/privacy leak); every window's CSP
is now font-src 'self'. Don't reintroduce a CDN <link>.
```
- **Native OS window frames** (`main.js` `frame:true`). The old custom drag
  titlebars are hidden globally (`html #titlebar,.titlebar{display:none!important}`
  in theme.css). The main window's bar is renamed `#topbar` and kept as a real toolbar.
- **Self-contained child windows** (review/settings/search/teach/dev-inspector):
  opened **modal** to the focused parent, **`skipTaskbar`** (no second taskbar
  icon), start **maximised** with user resize remembered (`applyWindowState` →
  `window-state.json`).
- **Settings & Review use a left-sidebar shell**; buttons/inputs are the rounded
  client-style components from theme.css.
- **Settings tab structure (11 tabs, 2026-06-30 reorg — the "General" junk-drawer is
  GONE):** a `Setup` cluster — **Files & filing** (folders + output structure) ·
  **Document Types** · **Processing** (mode/parallel/OCR/separation/name-checks + the
  import toggles auto-file/multiline/auto-rotate + Review confidence threshold) ·
  **Appearance** (theme + Home-screen cards + window behaviour) — then an
  `Administration` cluster (side-head divider) — **Templates** (the `#tpl-dock` viewer
  only) · **Learning** (Keyword Label Overrides at top + Learning Recovery + memory
  inventory) · **Learning Repair** (see below) · **Users** (accounts + recent activity) · **Audit** (the audit log) ·
  **Licensing** (licence + activation + seats; `#wf-section` workflow stays HIDDEN) ·
  **Search client** (the `#client-api-*` access card) · **Advanced** (Backup & Restore
  + Diagnostic Logging + Re-run setup). The renderer (`settings/renderer.js`) tab-click
  handler is generic on `data-tab`→`panel-<slug>`; only these slugs carry lazy-init —
  `learning`→`loadMemoryInventory`, `audit`→`loadAudit`, `searchclient`→
  `initClientApiSection`. Every control is wired by element ID, so a section moves
  between tabs intact. (Done via two reviewed worktree passes; guarded by the
  div-balance + tab↔panel pairing checks.)
- **Help-mode** (`src/windows/shared/helpmode.js`): elements tagged `data-help-key`
  highlight and deep-link into the User Guide window (`src/windows/help/`).
- **List thumbnails** (`src/windows/shared/thumbs.js`): page-1 PDF thumbnails in the
  Review queue, Search results, and the Teach doc-picker, lazy per visible row
  (IntersectionObserver) + a per-window in-memory cache. ONE shared IPC
  `get-document-thumbnail` → `previewService.getThumbnail` → `render/pages.py --thumb`
  (single low-res page; reuses pypdfium2 — no new dep). GOTCHA: the observed element
  must have a layout box — `display:none` starves IntersectionObserver, so the teach
  card uses a `visibility:hidden` overlay (review/search use a visible placeholder box).
- **About box** (core: user-menu "About ScanFinder…"; client: sidebar "About"): app +
  Electron version + copyright (read from package.json `build.copyright`) + a
  "Third-Party Licenses" button that opens the bundled notice via `shell.openPath`.
  IPC `get-app-about`/`open-third-party-licenses` (core), `client-about`/
  `client-open-licenses` (client). See License compliance.
- **Review queue** mirrors the Search results list: plain scroll + click (↑/↓ keys
  still cycle), and a **draggable splitter** makes the file column width adjustable
  (persisted in localStorage). Beside the queue is a **docked vertical tool rail**
  (`#queue-scroll-rail`, `src/windows/review/index.html`): a top **nav group**
  (`.rail-nav-group`) + a **document-tools group** (`.rail-tools-group`) holding the
  ✂ Split-PDF, Template-Wizard (⚓), OCR-Enhance, ⚙ Advanced (learning-history), and
  ∞ **Straighten-all** buttons — compact `.queue-tool-btn` icon triggers whose wide
  controls open as `.rail-flyout` popovers anchored to the rail (active = the shared
  `.open` pressed style). SEPARATELY, a horizontal `#doc-toolbar` sits ABOVE the page
  (zoom, page nav, the per-doc ∞ Straighten button). A Review control lives in one or
  the other — grep the WHOLE index.html before assuming a control's home. (The session
  "Straighten all" toggle — `#btn-deskew-all` + its `#deskew-all-bar` angle-threshold
  flyout — is in the tool rail; the per-doc Straighten is in `#doc-toolbar`.)

---

## IPC reference

### Renderer → Main (invoke — returns promise)
```
pick-folder, pick-output-folder, process-folder(folderPath)
get-document-types, get-all-doc-types
add-document-type(data), update-document-type(id,changes)
add-field(data), update-field(id,changes), delete-field(id)
get-validation-patterns                # validation_patterns from config (cached) — Review on-blur field validation
create-doc-type-with-fields({name,fields[],ref_field_key,date_field_key})  # transactional; teaching wizard
get-doctype-catalog, add-doctype-presets(slugs[])   # preset doc-type catalog (admin) — see Preset document-type catalog
get-teach-target                       # docId the teach window was opened at (pulled once on load)
get-review-queue, get-deferred-queue, get-review-count, get-deferred-count
get-document-with-extractions(id), get-document-pages(id,folderPath,filename)
get-document-thumbnail(id,folderPath,filename)   # page-1 low-res thumb (shared/thumbs.js)
get-app-about, open-third-party-licenses          # About box: version + open the bundled notice
confirm-review(payload), defer-document(id), restore-deferred(id)
delete-document(id,filePath), reprocess-document({docId,folderPath,filename})
ocr-region(base64), save-field-anchor(data)
extract-logo-hash(base64), match-logo-hash(base64), save-logo-fingerprint(data)
search-documents(params)
get-setting(key), set-setting(key,value)
get-output-structure-info, preview-output-path({folderPattern,filenamePattern})  # Output Structure builders
settings-backup-export({password}), settings-backup-preview({password}), settings-backup-apply({path,password})  # admin; see Settings backup
get-processing-mode, set-processing-mode(mode)
check-fast-mode-suggestion(supplierName)
license-get-status, license-start-trial, license-activate(data), license-revoke(data)
license-test-activate(data)            # admin local test — never mutates real state
license-get-enforcement, license-set-enforcement(on)   # admin-gated; Settings → Activation
dev-inspector-unlock(pw)               # pw checked in MAIN (=== 'SFDEV'); opens dev-inspector window
dev-inspector-running                  # read-only bool (isBatchRunning)
dev-get-session-docs, dev-get-session-doc(key)  # read-only in-memory dev-session registry (no DB)
dev-get-slice(path)                    # base64 of a temp OCR crop; path MUST resolve under ctx.devSliceDir
split-pdf(file,ranges,outDir,docId,every)  # pypdf split; `every` N = split every N pages (1=each), else ranges
onboarding-suggested-folder, onboarding-validate-folder(folder)  # first-run wizard (mkdir+probe writability)
```

### Renderer → Main (send — fire and forget)
```
window-minimise, window-maximise, window-close
show-in-explorer(path), open-file(path)
open-review-window, open-settings-window, open-search-window
open-teach-window, open-teach-window-at(docId)   # guided teaching wizard (Admin+Edit)
onboarding-complete, open-onboarding   # first-run wizard: set first_run_completed+open shell / re-run (admin)
notify-review-complete
license-enter-app                      # REQUEST entry; main re-decides via decideAccess
```

### Main → Renderer (events)
```
review-count-changed(n), deferred-count-changed(n)
processing-mode-changed(mode)
reprocess-progress(msg), process-progress(msg)
process-trace(ev)                      # dev-inspector + (when its console is active) the REVIEW window; never the main window. See Dev inspector / Review trace console
license-state(gate)                    # pushed to the license window with the blocked-state reason
```

---

## Process-progress message types (Python → Electron stdout)
```json
{"type":"start","total":N}
{"type":"file_begin","filename":"..."}
{"type":"file_done","success":true,"status":"needs_review|confirmed|error",
 "original_filename":"...","overall_confidence":85,"needs_review":true,
 "document_type":"Invoice","supplier_name":"...","extractions":{...},
 "invoice_number":"...","invoice_date":"...","total_amount":"..."}
{"type":"log","text":"...","level":""|"warn"|"err"}
```

---

## Known bugs / resolved history — see `docs/history.md`
- **Resolved 2026-07 headline bugs**: 07-08 harness RED = mis-taught anchor + poisoned GT, NOT code
  (fix: critical-field 88 floor in trust.js); 07-06 cross-supplier POSITIONAL anchor bleed FIXED
  (`_is_blind_cross_supplier_anchor`).
- **Resolved QA/audit (2026-07-02)**: all 11 adversarial-audit findings FIXED + tested (backup natural-
  key upsert, no-ref/date confirm dead-end, reprocess-discards-edits guard, batch file-copy off
  file_done, File-All-Ready expectId race, empty-issuer warn, shared `slug.js`, watch/output overlap,
  …). Read `docs/history.md` before re-touching backup restore, confirm gating, slug derivation, overlap.
- **Old BUG 1+2/3 (startup crashes) — FIXED**: `sanitise_extractions()` (process_docs.py) handles the
  `_`-metadata/str-value mix; `validation_patterns.date` char-range is `[/\-.]`. Both pinned in code.

---


## Features to build / build history — see `docs/history.md`
The staged build specs (Stage 2 Settings rebuild · Stage 5 Review rebuild · Stage 6 Search window ·
Stage 7 field-format cross-referencing) are largely **DONE**; their specs and the durable "built
additions" notes have moved to **`docs/history.md`**. Still genuinely OUTSTANDING there:
- **Stage 7 Stage 3** — persistent learned format model (`field_format_rules` table, migration 12,
  `--format-rules-file`): overrides the inferred class once `confirmed_count ≥ 10`. Not yet built.

## Fast Mode suggestion — RETIRED
The Fast/Smart user choice was collapsed 2026-07-08 (see Processing mode above);
`check-fast-mode-suggestion` is a retired no-op kept for tolerance. Do not re-implement the toast.

---


## First-run wizard · Settings backup · Learning Repair
- **First-run wizard** (`src/windows/onboarding/`) — a linear setup wizard shown ONCE on a clean install,
  AFTER the licensing gate; gated by the `first_run_completed` setting (migration 24 stamps already-
  configured DBs so existing users are never re-onboarded — NEVER infer "clean install" from empty state).
  Only required step = a writable output folder. Followed by a 6-card welcome/familiarisation TOUR
  (`src/windows/welcome/`, its own `welcome_seen` flag; reopenable from the user menu).
- **Settings backup / restore** (admin; `src/services/backupService.js`; Settings → Advanced) — exports
  operational config to ONE password-encrypted file (scrypt → AES-256-GCM over gzipped JSON). Includes
  settings (minus `licens*`), doc types/fields, templates, anchors, hints, corrections, logos; EXCLUDES
  users/recovery/audit/licensing/documents. **Device-bound import** (anti-trial-stacking): a backup from a
  different machine is refused unless this machine holds an active paid seat.
- **Learning Repair** (admin Settings tab, `panel-repair`) — un-poison a doc type by browsing its confirmed
  docs and sending a bad one back to Review (replace-in-place, no `-DUPLICATE`). Grounding fact: learning is
  derived LIVE from `confirmed` docs (`getFieldFormats` filters `status='confirmed'`), so de-confirm/soft-
  delete is the real lever — clearing learning tables alone doesn't un-poison. Precision-first suspect
  detectors (`src/services/repairSuspects.js`): outlier docs (phash) + anomalous values (shape/name/charset).

📖 **FULL detail: `docs/features.md`** (wizard steps + gate flow + copy-after-processing keys; backup
crypto/scope/restore transaction/IPC; Learning Repair detectors/scope-split/IPC/UI).

## Main window — "Review your documents" CTA
After a batch finishes, a green "✓ Review your documents" button appears in the sidebar
below Process Documents (where Stop was) and opens the Review window. Shown only when
`stats.done > 0`, reset on each run start, gated like the Review nav (hidden for
read-only). Complements the "View Results" 3-field table, doesn't replace it.

## Help-mode + modals gotcha
`shared/helpmode.js`'s active capture-phase click interceptor (shows help INSTEAD of
activating a control) used to swallow clicks inside in-page modals — a destructive
typed-confirm dialog (Erase ALL data) then looked broken (couldn't click/type). Fix:
help-mode skips any element under `[data-help-ignore]`; the custom modals
(showTypedConfirmDialog, showSecretDialog) set it. SEPARATELY, those modals now defer
`input.focus()` to `requestAnimationFrame` (focusing an element the same tick it's
appended is dropped by Chromium → "no flashing cursor") + a click-to-focus fallback.


## Teaching wizard · Dev inspector
- **Teaching wizard** (`src/windows/teach/`) — a dedicated linear "Teach a new document" wizard for
  non-technical users (Admin+Edit): welcome → choose the scanned doc → pick or CREATE a doc type → point
  out each field by drawing a box around its VALUE (live OCR read-back; the wizard auto-detects the nearby
  label as the anchor) → review → commit. Each field is saved as a **Stage 0.5 anchor→target MAPPING**
  (value-box-only + auto-label — works on document #1, registration covers drift), NOT a Stage 2 ⊕ anchor.
  Commit sequence is DEFERRED to the last step (promote-to-template → save-template-mapping per field →
  confirm-review) so Back/Cancel are safe.
- **Dev inspector** (hidden, read-only — no DB writes, no learning) — in the MAIN window press
  **Ctrl+Shift+D then M**, password `SFDEV`. An answer-first extraction-provenance view + a Review-window
  **trace console** (same key combo, inside Review) for debugging extraction PRECEDENCE. The `--trace` /
  `--slice-dir` flags are added ONLY while the inspector/console is open (or diag logging is on), so normal
  processing is byte-identical. OCR slices saved to one temp dir, served base64, cleared on close.

📖 **FULL detail: `docs/features.md`** (teach auto-flow / fixed-value / artifact / commit sequence;
dev-inspector three-column UI, telemetry mirror, trace event types, click-to-highlight slices, per-field
winning-lineage reconstruction, and the known main-app follow-ups).

## Python invocation pattern
All Python scripts called with temp files for large data (avoids Windows
ENAMETOOLONG limit on CLI args):
```javascript
const file = path.join(os.tmpdir(), `ds_name_${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify(data));
// pass --name-file file to Python
// cleanup in proc.on('close')
```

Python uses `py -3.12` in dev, `vendor/python/python.exe` when packaged.

---

## License compliance (third-party OSS) — see `COMPLIANCE.md` (canonical)
The shipped product bundles permissive/notice-style OSS (no GPL/AGPL); the only
copyleft is weak/file-level (FFmpeg LGPL-2.1 via Electron, a couple of MPL-2.0
files). Compliance is automated:
- **`THIRD-PARTY-LICENSES.txt`** (core, repo root) + **`client/THIRD-PARTY-LICENSES.txt`**
  ship via each app's `build.extraResources`; surfaced in-app via the About box.
- **`scripts/check-licenses.js`** — prebuild GATE (wired into `npm run build`, also
  `npm run check:licenses`). Enumerates the Node prod-dep tree + bundled
  `vendor/python` packages, classifies each license ALLOWED / DENIED(copyleft) /
  UNKNOWN against an allowlist, exits 1 on any DENIED/UNKNOWN so a dependency bump
  can't silently ship a bad license. Dual `A OR B` passes if either side is allowed
  (elections: node-forge→BSD-3, expand-template→MIT, rc→MIT, packaging→Apache-2.0).
  MPL-2.0 is allowed (we ship unmodified source). Exports its collectors.
- **`scripts/gen-third-party-notices.js`** — rewrites the notice's INVENTORY section
  from the gate's data + re-stamps the product version (package.json) and date; leaves
  the curated copyright/license-text sections alone.
- **Release**: on the build machine (where `vendor/python` exists) bump versions →
  `npm run check:licenses` → `node scripts/gen-third-party-notices.js` → `npm run build`.
- When a new license FAMILY appears, add its text to section 3 of the notice + its
  name to the intro list (the generator does NOT manage section 3). Editing the
  notice's whole license text in one Write trips the API content filter — author the
  short parts, then APPEND long texts (fetched to files) via a script.

## Dev workflow
```bash
cd C:\docusnap2
npm start          # dev mode — uses system Python + Tesseract; licensing enforcement OFF
npm run build      # → dist\ScanFinder Setup <ver>-r<rev>.exe  (rev = scripts/build-rev.js, or $BUILD_REV)
```
Dev uses `py -3.12 script.py`, packaged uses bundled Python venv.
Tesseract hardcoded to `C:\Program Files\Tesseract-OCR\tesseract.exe` in dev.

**Build notes**: electron-builder pinned **`^24.13.3`** (verify with
`require('electron-builder/package.json').version`). Don't re-add the legacy `win.sign`/
`win.signingHashAlgorithms` keys. MSIX/Store SKU → `MSIX_SETUP.md`; a test `.appx`
(`electron-builder --win appx`, placeholder `SixMileSoftware.ScanFinder`/`CN=Six Mile Software`)
REQUIRES **Windows Developer Mode ON** — electron-builder extracts `winCodeSign` via SYMLINKS which
Windows blocks otherwise, so `makeappx.exe` never lands (`spawn UNKNOWN`/`ENOENT`); the `.appx` is
unsigned (Store signs on submission). Opt-in data-FREE diagnostics DESIGNED not built —
`DIAGNOSTICS_PLAN.md`. `postinstall` runs `install-app-deps`; native deps (`argon2`, `better-sqlite3`)
auto-rebuilt for the Electron ABI. Installer **unsigned** → SmartScreen "Run anyway" on the VM. Run
gate tests with Electron-as-Node, not plain node (native-module ABI).

**Versioning (policy: manual SemVer + automatic build stamp — Eric+Gary consensus).**
THREE INDEPENDENT axes: the core app version, the client app version, and the `/v1`
contract version (`API_CONTRACT_VERSION` in `src/modules/api/handler.js` — the real
client↔server compatibility signal; never gate licensing on it). Bump `package.json`
`version` **manually, at release only**, git-tagged (MAJOR breaking/licensing-tier · MINOR
feature/add-on · PATCH fix) — do **NOT** auto-bump per build (it churns git + pollutes the
number licensing/support reads). Every build is still made DISTINCT + traceable by an
automatic stamp: `scripts/build-rev.js` `buildRev()` = `<UTC yyyymmdd-hhmm>-<git short sha>`
(or `BUILD_REV` verbatim), carried by both `nsis.artifactName`s as `-r${env.BUILD_REV}` →
e.g. `ScanFinder Setup 2.0.0-r20260622-1133-9f158c5.exe`, AND baked into the packaged
`package.json` via `--config.extraMetadata.buildRev` so the **About box** self-reports
`Version <ver> (<rev>)` (unpackaged dev reads the live git sha). Release ritual: bump
`version` → `git tag` → `BUILD_REV=<version> npm run build` (optionally branch artifactName
to drop the `-r<ver>` for a clean `ScanFinder Setup 2.1.0.exe`).

Delete `%APPDATA%\DocuSnap\docusnap.db` to reset DB during development (also clears users,
cached license tokens, and the enforcement setting).
Delete `python_backend/**/__pycache__` if Python changes don't take effect.
Packaged build remembers prior login/trial because that DB persists across reinstalls
(NSIS `deleteAppDataOnUninstall:false`). Licensing enforcement is ALWAYS ON (no env/setting/
dev bypass) — dev must run against a real backend trial/seat for the machine's fingerprint.
