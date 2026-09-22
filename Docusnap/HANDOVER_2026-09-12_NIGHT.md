# HANDOVER 2026-09-12 NIGHT — flip-test corpus campaign + this session's fixes

Branch `feat/teach-side-overnight`. **14 commits ahead of `origin`, NONE pushed (owner's call).** HEAD
`4683447`. Working tree CLEAN (everything below is committed). Read `CLAUDE.md` + this file, then the
**ACTIVE TASK** section — that's where to start.

**Dev app is RUNNING** (background `npm start`) — armed with **46 of 47** dark switches. The 1 off =
`deskew_false_absent_reflag` (mig 163, built this session); the **auto-re-arm fix (committed) will turn it on
on the next `npm start` restart**. `deskew_retry_field_adopt` (mig 162) is ON in this dev DB (owner flipped it
for the Ridgeway preview — it works: FULL-reprocess of doc 358 reads `WS-73673` held).

---

## TL;DR
The owner asked how to make sure the growing pile of DARK fixes actually reaches the build. Answer built this
session: a **fix ledger** + an **auto-re-arm fix** + a **synthetic warm-DB test corpus** so the flip-gate
harness can safety-test the ~39 waiting fixes and flip the passers. **Pipeline BUILT + pilot VALIDATED
end-to-end.** Also shipped mig 163 (a truthful-note fix) and PARKED two arcs Oracle ruled DO-NOTHING. The
ACTIVE task for next session = **finish + run the flip-corpus campaign** (inject → scale to 700 → censuses →
flip).

---

## ACTIVE TASK (start here) — the flip-test corpus campaign

**Goal:** unblock the ~39 DARK fixes stuck OFF (see `docs/DARK_SWITCH_LEDGER.md`) by safety-testing them on a
synthetic corpus with perfect ground truth, then flipping the ones that pass. **The plumbing is DONE and the
pilot is validated;** the rest is defined execution at scale.

**What exists (all committed):**
- `stress_test/gen_customer_test.py` — the corpus generator. ALREADY enforces the owner's realism rule (one
  fixed template per supplier+type: `tmpl = random.Random("{issuer}|{type}")`). Emits digital + skewed-scan
  renditions + `ground_truth.json`. Gained `--issuers`/`--types`/`--modes` filters this session.
- `stress_test/build_warm_db.js` — **the new tool.** Builds a self-contained RELEASE-shaped WARM DB from a
  corpus + GT: teaches ONE Stage-0.5 template per (supplier,type) via `teach_from_gt.py`; inserts HISTORY docs
  confirmed+learning-ON (builds the warm learned state + graduation via `graduation_window`); inserts TEST docs
  confirmed+`learning_excluded_at`+`template_id` with ref/date/supplier columns + `total` extraction = the
  synthetic GT. Prints `RR_IDS`. Env: `CORPUS`, `OUT_DB`, `GRAD_WINDOW` (default 3), `TESS`, `TEACH_JITTER_LEFT`/
  `TEACH_JITTER` (ref-box clip injector, off unless set).
- `stress_test/realdoc_regression.js` — the flip-gate harness, used UNCHANGED (`RR_DB=<warm.db>` `RR_IDS=<ids>`
  `OCR_RENDER_DPI=200`; add `RR_CONSENSUS=<f.jsonl>` to dump per-doc reads).
- **Pilot corpus at `Desktop\Flip Corpus Pilot\`** (84 files, 3 suppliers × 2 types). Built DBs there:
  `warm_snapshot.db` (clean) + `warm_clip.db` (ref-clip variety). Test `RR_IDS=4,5,6,7,11,12,13,14,18,19,20,21,25,26,27,28,32,33,34,35,39,40,41,42`.

**Pilot result (VALIDATED):** realdoc applied the templates, read the skewed scans, scored **ref/date/supplier
12/12 each**; graduation held (**18/24 would auto-file** → warm regime works). Two findings below.

**THE KEY FINDING (load-bearing — do NOT re-litigate):** the SHIPPED machinery (the keyword read + the
default-ON pad-window re-read) already recovers the EASY version of each geometry failure. Verified: a taught
ref box cut 22% still read 12/12. So a synthetic clip/skew is auto-healed → **it CANNOT fire the DARK geometry
fixes** (mig 141/151/161/162/163) — those target the hard residual the shipped fixes miss. **Consequence:**
- The synthetic corpus is a **strong SAFETY gate** (M=0 / no-regression / byte-identical-OFF across varied
  docs) — the half Oracle insists on. USE IT FOR THAT for all ~39 fixes.
- **Efficacy** (the fix FIRES + helps) is injectable ONLY for modes with no shipped handler — **name-is-postcode
  (mig 156 `name_role_nonname_flag`), O/0 confusable (mig 159 `ref_confusable_flag`), mixed-shape ref (`format_class_join`)** — the VALUE-shape modes, deterministic. For the GEOMETRY fixes (clip/skew/deskew),
  efficacy stays on the REAL exhibits (the Ridgeway preview already showed mig 162 works) + the live/605 DB.

**FIRST ACTIONS (numbered):**
1. **Build the injectable-mode injectors in `gen_customer_test.py`** (small generator surgery): a `name_role`
   whose value is a bare postcode (fires mig 156), a ref containing an O-where-a-0-belongs (fires mig 159),
   a mixed-shape ref history (fires `format_class_join`). Tag each in GT (`failure_mode`). These have NO shipped
   handler, so OFF = silent/auto-file-wrong, ON = the dark flag holds → a real efficacy fire.
2. **Prove ONE fires** on the pilot: rebuild the warm DB with the mode, run OFF (`RR_DB=warm.db`) vs ON (copy
   the DB, set that ONE switch `'true'` via a settings write — NOT shell env, `_appSpawnEnv` reads the DB —
   run realdoc), diff. ON must hold/flag where OFF auto-files.
3. **Scale to 700**: `gen_customer_test.py` full run (all 12 suppliers) → `build_warm_db.js` → the full test set.
   Confirm "700" = ~700 documents (×2 renditions ≈ 1,400 files) per the owner (assumed).
4. **Run the SAFETY censuses** across the ~39 WAITING fixes (each: baseline OFF vs one-switch-ON copy; require
   M=0 + wouldFile(ON)⊇wouldFile(OFF) + zero per-field regression on the FILING fields). Flip the passers →
   promotion migration + REMOVE from `dark_switches.js` (same commit) + cross off `DARK_SWITCH_LEDGER.md`.
5. Keep `DARK_SWITCH_LEDGER.md` current as each flips.

---

## This session's COMMITTED work (14 commits, HEAD `4683447`)
- **mig 163 `deskew_false_absent_reflag` (`2d15445`, DARK)** — Phase-1 truthful re-flag of a FALSE Gate-C
  "doesn't appear on this page" note on a straighten-verified role field (the 6 Saltmarsh delivery-note class,
  mirror of #358). Removes NO checkpoint. gary→Oracle FORK: SIGN OFF this HOLD leg; **SEND BACK the auto-file
  RELEASE leg** (`b0eefba` records the v2 re-vet: DO NOTHING — inert on default install + Q2 cross-raster
  overall-inheritance misfile seam + needs ≥2-supplier census). Pins + gate: `docs/designs/DESKEW_FALSE_ABSENT_REFLAG_2026-09-12.md`,
  `docs/oracle_log.md`. `TEST_SWITCH_KEYS` → 47.
- **Suspect-code label re-read arc — Oracle DO NOTHING, NOT built (`a724055`)** — the owner's "position
  shouldn't matter" idea. Both premises FALSE at source: `VS-72672` is SHAPE-VALID (folds `@@-#` like
  `WS-73673`; mig-160 said so), so the trigger never fires; and `_relocate_and_read` returns `_geometric() or
  _inline()` (tilt-unsafe box re-crop FIRST) so it could adopt a wrong-row neighbour. Design doc retained as the
  rejected record. `docs/designs/SUSPECT_CODE_LABEL_REREAD_2026-09-12.md`, `docs/oracle_log.md`.
- **Fix ledger `docs/DARK_SWITCH_LEDGER.md` (`93ba0c9`)** — plain-English, one line per built-but-off fix (47),
  grouped READY(2) / HELD(5) / WAITING(~39) / PARKED(1) / DONE. Living doc — update on add/flip/park.
- **Auto-re-arm fix `database/build_arming.js` (`928243c`)** — a same-rev dev/test arm now arms ONLY keys never
  armed before (tracked in a new `test_build_armed_keys` companion), so a fix added since the last arm activates
  on the next `TEST_BUILD=1 npm start` with no full re-arm — WITHOUT clobbering an operator's OFF. Pin +3 in
  `test_runtime_test_arming.js`. Release path untouched (gate still 0 key literals).
- **`build_warm_db.js` (`1eb9c4b` + `4683447`)** — the warm-DB tool + the env-gated clip injector.

---

## Verification state (honest)
- Pilot census RAN on `warm_snapshot.db`: ref/date/supplier 12/12; 18/24 would auto-file (graduation works).
  **Not a full flip census** (only the pilot's 24 docs, and the geometry fixes don't fire on it — see the KEY
  FINDING). The full ~39-fix safety census at 700 is NOT run.
- **2 total pence-drops** (#11 `756.36`→`756`, #13 `981.72`→`981`): a REAL minor total-read behaviour, NOT a
  corpus bug (GT is correct — the doc prints £756.36). Out of scope for the FILING safety gate (total isn't a
  filing role). Leave the GT correct; the safety metric focuses on filing fields.
- Corrected mid-session claims: (a) "the Ridgeway case is covered by shipped work" — WRONG; the fix (mig 162)
  is built but was OFF until the owner flipped it for the preview. (b) "each fix gets a real firing test on the
  corpus" — WRONG for the geometry fixes (shipped machinery eats the easy case); see the KEY FINDING.
- mig 163 pins green; `npm run test:pins` was 343 green (1 red = pre-existing `test_activity_strip`).

## Needs the USER
- **Push decision** — 14 commits local, none pushed.
- **The Ridgeway preview switch** — `deskew_retry_field_adopt` is ON in the dev DB (turn off with the `!`
  command in the earlier chat if you want a clean baseline; it's review-bound + dev-only either way).
- The full flip censuses are owner-owed before any CUSTOMER default (they always are).

## Key facts / paths / gotchas
- Live DB `%APPDATA%\ScanFinder\docusnap.db` — **blocked to Claude's script tools for WRITES** (owner runs
  writes via `! <cmd>`). READS work via `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe <script.js>`
  + `new Database(path,{readonly:true})`.
- The census arm = build_warm_db (release-shaped, all OFF) → baseline realdoc → **copy the DB, set ONE switch
  `'true'` via a settings write** (NOT shell env — realdoc's `_appSpawnEnv` reads the DB) → realdoc → diff.
- Gotchas: `learning.insertExtractions` rows MUST include `validation_note` (else "Missing named parameter");
  paths-with-spaces break argv to electron-as-node (hardcode a Windows `C:/...` path in probe scripts);
  `teach_from_gt.py` needs `--tesseract C:/Program Files/Tesseract-OCR/tesseract.exe`.
- Memory: `project_flip_corpus_pipeline_20260912.md` (the pipeline), `project_deskew_false_absent_reflag_20260912.md`
  (mig 163), `project_suspect_code_label_reread_20260912.md` (the parked arc), `feedback_simple_explanations.md`
  (owner: all explanations in plain terms).
- Advisor route unchanged: gary (Python/test-strategy), 007 (placement, spawn general-purpose + `.claude/agents/007.md`),
  reggie (patterns), oscar (OCR), Oracle LAST. Log verdicts to `docs/oracle_log.md`.
