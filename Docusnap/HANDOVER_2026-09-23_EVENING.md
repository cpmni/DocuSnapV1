# HANDOVER — 2026-09-23 EVENING (date-fold + arithmetic-witness built DARK; dual-reader census flips Oracle on the confusable RELEASE)

Branch `feat/teach-side-overnight`. **HEAD `cfe30e7` — NOTHING committed this session; all work is UNCOMMITTED
(owner's call when to commit).** Migrations now go to **209** (208 `corrob_date_fold_wide`, 209
`recon_singlechar_misread_flag` — both DARK, seeded OFF). `TEST_SWITCH_KEYS` **13**. `node scripts/run-pins.js`
**413/413 green** (fixed the one red I introduced). Read `HANDOVER_2026-09-23_GLYPH.md` for the morning's PP-OCR
second-reader context; this continues from it.

⚠ **RUNNING:** a dev app I relaunched is still up (5 electron) with env `CORROB_DATE_FOLD_WIDE=1` +
`GLYPH_FALLBACK_ENABLED=1` (background task `bse1lgmp9`, log `…/scratchpad/proof-glyph-datefold.log`). Env-only —
reverts on a normal restart. Kill + relaunch normally when done.

---

## TL;DR
- Owner hit a "flood" of holds. Root-caused TWO things at the source (not from summaries — the new VERIFY rule):
  (1) Print Tracker docs held on a **date read two ways** (numeric vs month-name, SAME day) — the depletion-date
  flood, a KNOWN issue with a **built-but-unwired** fix. Wired it: **`corrob_date_fold_wide` mig 208, DARK**.
  (2) The one wrong-value money auto-file in the corpus (#464) is uncaught by anything shipped → built the
  **arithmetic-witness `recon_singlechar_misread_flag` mig 209, DARK** (24 pins green).
- Owner challenged the confusable HOLDS ("if I can see it, the data is there"). Ran a **dual-reader census**
  (1,474 scanned docs, 3,718 ref/date/total fields, Tesseract vs PP-OCR): **97.4% agree, 0 common-mode errors in
  the 120 hardest confusable-heavy confident-agrees**, and the disagreements are Tesseract-wrong/Paddle-right
  (incl. 3 silent-wrong totals 5→9). Data on the owner's Desktop `TEMPTEST_dual_reader/`.
- That census **flipped Oracle** on the paddle-resolver RELEASE: SEND-BACK → **approved in principle**, DARK +
  flip-gated on ONE more targeted census. DOWNGRADE **signed off, ship now**.
- **Corrected two wrong claims I made mid-session by checking source** (the whole point of the new rule): (a)
  the already-ON `net_misread_total_flag` does NOT catch #464 (it's the net-line case only); (b) "reprocess never
  files" is wrong — **reprocess-ALL does auto-file** via the scope-local completion, single reprocess doesn't.

## Also this session — CLAUDE.md hygiene + a new standing rule
- **Collapsed CLAUDE.md 1609→1200 lines** — the 09-04→09-21 session blocks were stacked full-length against the
  file's own rule; moved verbatim to `docs/session-log.md` ("Archived … at the 2026-09-23 compaction"), replaced
  with one-liner pointers. Load-bearing switch/mig facts preserved; current state deferred to
  `database/dark_switches.js` + `docs/DARK_SWITCH_LEDGER.md`.
- **Added a HARD RULE to CLAUDE.md Working-rules: "VERIFY, DON'T ASSUME"** — never treat something correct from a
  small set of info OR because an advisor/Oracle said so; verify at source, bar scales with blast radius. Owner
  asked for this explicitly after the Oracle missed the taught-total-has-a-box detail. It paid off twice this
  session (the two corrections above).

---

## UNCOMMITTED — per change

### 1. Date fold `corrob_date_fold_wide` — mig 208, DARK (byte-identical off)
- **Root cause:** `validator._corrob_values_agree` (engine.py ~1191) logs a worded date ("September 30, 2026") vs
  the SAME day numeric ("30-09-2026") as a page-family DISAGREEMENT → held forever (`disagreeing-read`). Code
  comment named it "the flood the owner hit on Print Tracker's ever-changing depletion date." The fix
  (`CORROB_DATE_FOLD_WIDE`) existed but had NO setting/migration/handler mirror.
- **Files:** `database/index.js` (mig 208 seed OFF), `src/modules/processing/handler.js` (`_reconcileEnv` mirror,
  ~line 424), `database/dark_switches.js` (entry + `TEST_SWITCH_KEYS`→12), count pins updated.
- **Proof:** owner reprocessed the Print Tracker batch on the running dev app (env on); the date holds cleared
  (queue 34→7). ⚠ NOT fully isolated — could be fold-cleared OR manually confirmed; reprocess-ALL also auto-files
  (see corrections). A clean confirm = single-reprocess one still-held doc and watch the note vanish.
- **Advisor:** the fold code itself was gary→Oracle SIGN-OFF-W/COND (2026-09-22, pre-existing). Wiring only this session.
- **Flip gate** (in dark_switches.js): realdoc M=0 OFF-vs-ON + released-holds all genuine same-day pairs + zero
  date accuracy drop + measure the re-armed date auto-file licence.

### 2. Arithmetic-witness `recon_singlechar_misread_flag` — mig 209, DARK (byte-identical off)
- **The defect:** #464 Nordwind prints `£2,363.76`, pipeline commits `2,368.76` (single 3→8), balances
  subtotal+tax only via the 2% tolerance → no note → would auto-file WRONG. The only wrong-value money auto-file
  in 1,076 corpus docs. Nothing shipped catches it (verified: `_net_misread_verdict` needs total≈subtotal; #464 is
  a correct-magnitude gross).
- **Design (gary → Oracle SIGN-OFF-W/COND):** pure predicate `validator.arith_witness_misread_total` (beside
  `total_reconciles`) — subtotal+tax balances only via the % tol AND read-vs-computed is a single-digit
  substitution (reuses the pinned `suffix_reconcile.digit_substitution_diff`) ≥10p apart (rounding-proof).
  Engine `_flag_singlechar_reconcile_misread` (after `_flag_net_misread_total`, before Stage 4): cap conf ≤50 +
  NEUTRAL SYMMETRIC note, never swaps/adopts. Note is deny-by-default in class F (Oracle C2 — pinned).
- **Files:** `python_backend/extraction/validator.py` (predicate), `python_backend/extraction/engine.py`
  (`RECON_SINGLECHAR_MISREAD_FLAG` + `_SINGLECHAR_MISREAD_NOTE`/`_MARK` near 3218, method after ~8983, call at
  ~11306), `database/index.js` (mig 209), `src/modules/processing/handler.js` (mirror ~809), `dark_switches.js`
  (`TEST_SWITCH_KEYS`→13), 3 count pins. New test `python_backend/tests/test_arith_witness_misread.py` (24 pins
  green incl. #464 fires, flag-not-adopt lock, one-note guard, OFF byte-identity, note-not-class-F).
- **Oracle's 6 conditions ALL applied** (neutral symmetric note; distinct mark pinned absent from class-F;
  require BOTH subtotal AND tax; credit abstention identical to net-misread; one-note guard; env `== '1'`).
- **Flip gate (MANDATORY, in dark_switches.js):** the #464-exact unit test asserting `isAutoFileEligible` flips
  eligible→flagged WITH `auto_file_threshold` set so conf-90 ≥ floor (else proves nothing — Oracle nuance, the
  universal blocker is `trust.js:1311` not 1064); OFF-arm md5 identity; realdoc M=0; false-hold census (multi-line
  VAT / uncaptured line / misread-COMPONENT); owner live reprocess of #464. If real docs false-hold in the
  [10p,£1) band → narrow min_delta to ≥£1 (still catches #464's £5).

### 3. SFDEV Review console — paddle 2nd-reader row + agree trace
- `src/windows/review/renderer.js` (the `rdc` console): added a per-field **"2nd reader"** row showing PP-OCR's
  read + agree/disagree/abstain. `python_backend/extraction/engine.py`: the glyph AGREE trace now carries
  `pp_read`+`pp_conf` (was committed-only). Dev-only; foreground single-doc reprocess routes to the console.

### 4. CLAUDE.md collapse + VERIFY rule + session-log archive
- `CLAUDE.md` (1609→1200, the collapse + the HARD RULE), `docs/session-log.md` (+485 archived lines).

### 5. Test fixes I made (my +2 keys broke count pins)
- `database/modules/test_migration137_test_switch_reset.js` (11→13), `test_migration163_deskew_false_absent_reflag.js`
  (11→13), `database/test_default_flip_205_batch.js` (HELD list +2, 11→13). All green.

### New tooling (uncommitted, `TESTING/_measure/dual_reader_census/`)
- `census.py` (DB-free label-anchored dual-reader census — value-only crops, best-of-PSM Tesseract + PP), 
  `adjudicate.py` (text-layer GT — found only 10/1368 born-digital), `contact_sheet.py` (captioned tiling for
  eyeball adjudication). Results live on the owner's Desktop `TEMPTEST_dual_reader/` (NOT in repo): `CENSUS_VERDICT.md`,
  `detection_log.csv` (3,718 rows), `contact_sheet_01-04.png`, `slices/`.

---

## Verification state — honest
- `run-pins.js` **413/413 green** (JS suite; re-run after the batch-flip HELD-list fix).
- `test_arith_witness_misread.py` **24/24** (Python, script-style like its siblings; NOT in the JS run-pins count).
- Neighbouring Python tests (net-misread, glyph-hold, date-fold) pass under `PYTHONIOENCODING=utf-8` (the raw
  "fail" was a cp1252 print artifact in a test's `→` label, pre-existing).
- Census: real, verified by Oracle at source. **0 common-mode in 120 hand-adjudicated** confusable-heavy
  confident-agrees; 97.4% overall agree. Honest gaps: (a) measured the GENERAL population, not the RELEASE's real
  `_absent`/clipped trigger subset (Oracle's one open gap); (b) a 0/120 sample bounds loosely (≈≤3% CI).
- **Corrections I made mid-session (both by checking source):** `net_misread_total_flag` (ON since mig 81) does
  NOT catch #464; "reprocess never files" is wrong (reprocess-ALL auto-files via `consume-reprocess-completion`).

## FIRST ACTIONS (fresh session) — owner said "do BOTH"
1. **Build the filtered `_absent` census** (Oracle Q3, unlocks the RELEASE): re-run the dual reader FILTERED to the
   real trigger set — ref fields where the pipeline's crop value is ABSENT from the whole-page text AND a one-glyph
   confusable page-form (`_near`) exists (the soften-note-firing set; replicate `_flag_filing_value_sanity`'s
   `_absent`/`_near` logic — I already have whole-page words in `census.py`). Pixel-adjudicate {crop value vs `_near`
   form}; among crop-WRONG cases, count how many PP ALSO got wrong. **0 → the RELEASE flips.** Likely passes.
2. **Build the DOWNGRADE** `glyph_confusable_resolve` (mig 210, DARK — Oracle SIGN-OFF, ship-ready): inside
   `_glyph_disagreement_hold`, on paddle-AGREE with the SOLE note carrying the unique mark `"look like another on a
   scan"` → REWORD the note to confident copy, KEEP it non-empty (auto-file byte-identical). Conditions D1-D5 in the
   Oracle handback (relayed in the session log below / the transcript). D5 prerequisite: confirm the paddle AGREE
   branch actually FIRES on real refs (the open geom `no_box` question) — else it's inert on the owner's docs.
3. Then the RELEASE DARK (conditions R1-R6) once the filtered census is green; the **veto-fallthrough seam R4**
   (`engine.py:12731` re-adds a note after the glyph hold — pin both branches) MUST be closed first.
4. Owner decision: **commit this session's work** (11 modified + 2 new dirs/files; suggest chunks: docs/CLAUDE.md ·
   date-fold · arithmetic-witness · SFDEV-console · census-tooling). Nothing pushed.

## Deferred (designed, not built)
- **Paddle DISAGREEMENT-hold on the TOTAL role** (Oracle R3 — a SEPARATE positive lead the census surfaced: 3
  Tesseract 5→9 silent-wrong totals Paddle caught). Its own slice.
- **RELEASE (v2)** — approved in principle, gated on FIRST-ACTION 1. Conditions R1-R6 (hard dep on
  glyph_fallback; confident-fired PP only; ref-role only; veto-fallthrough pin; producer discipline —
  `_confusable_soften` has no page witness; pixel-adjudicated flip gate).
- Total-paddle mandatory re-read (the earlier barry/gary/Oracle thread) — superseded by the confusable + census
  work; the arithmetic-witness (mig 209) is the reconcilable-total lever; a totals DISAGREEMENT-hold is the OCR one.

## Needs the USER
- Which reprocess actually cleared the Print Tracker date holds (fold vs manual) — settles the date-fold proof.
- The date-fold + arithmetic-witness flips are owner-gated (after their census gates).
- Verify census slice quality if desired (all slices saved to `Desktop\TEMPTEST_dual_reader\slices\`).

## Key facts / paths
- Live DB `%APPDATA%\ScanFinder\docusnap.db` — BLOCKED to Claude's tools (owner `!` for live queries).
- Migrations at **209**; `TEST_SWITCH_KEYS` **13** (source of truth `database/dark_switches.js`).
- Run JS pins: `node scripts/run-pins.js`. Run a Python test: `PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/<t>.py`.
- Census tooling `TESTING/_measure/dual_reader_census/`; results `Desktop\TEMPTEST_dual_reader\`.
- Oracle handback (DOWNGRADE + RELEASE conditions in full) is in this session's transcript; the two design
  briefs are the gary/Oracle threads. Memory: `project_confusable_census_and_reconcile_20260923.md`.
