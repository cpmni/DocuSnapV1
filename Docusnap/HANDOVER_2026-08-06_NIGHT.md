# HANDOVER — 2026-08-06 NIGHT (autonomous: morning-round #1 sent-back+reverted; teach-commit angle enabler built; Kyle crop-accuracy measured 8/9)

**Branch** `feat/reprocess-throughput-autostraighten` · **UNCOMMITTED** (changes on disk, tests green — owner to review/commit).
**Running:** none launched overnight. **Context:** continues `HANDOVER_2026-08-05_NIGHT.md`.
Owner brief: "continue on the fixes on auto … then get Chris to run tests on the Kyle Test folder,
check crop accuracy — clean anchors + clean values in fields AND on crops. Teach first, sandbox only,
no drawing review-targets to fix; I review the crop errors. Bar: single teach = perfect on clean
docs incl. rotated."

---

## TL;DR
1. **Morning-round fix #1 (composed-box word-snap): BUILT → advisor(007+gary BUILD-WITH-CHANGES) →
   Oracle SEND BACK / WRONG LAYER → NF-gate CONFIRMED net-negative → REVERTED clean.** The class it
   targeted is ALREADY healed by the shipped `_abs_edge_guard` (which runs on the composed target
   box WITH corroboration + fail-to-review). A pre-read snap was a 2nd consent-less healer on the
   same class — the code's own rule forbids it ("two dark healers … breeds M=1s"). Gate proof
   (NF, both arms, shipped flags): compose-snap gave date +3 but **account_no −6** (level-doc
   over-grab) and **job_ref −4** (multi-token shrink-truncation) — Oracle's exact predicted modes.
   Reverted; only an explanatory NOTE remains in template_mapper.py. `docs/oracle_log.md` 2026-08-06.
2. **Enabler BUILT (kept): teach-commit sample-angle write** (`generateSampleAngle` in
   templates/handler.js, wired at promote/link/graduation/captureSample in review/handler.js). Closes
   the "one-batch-behind" gap so a freshly-taught template composes on the FIRST sibling process —
   required for the "single teach" bar to get a fair test. Best-effort, inert unless
   `teach_angle_compose` is on. Reuses `detect_angle.py`. NEEDS a live smoke (teach a doc, confirm
   `sample_deskew_angle` written at commit — grep `[templates] sample angle written at commit`).
3. **Kyle crop-accuracy MEASURED (faithful scripted route, not the fragile Chris UI):** teach ONE
   real Larkspur invoice (`teach_from_gt`, sample_angle=1.5° detected) → deskew-process 9 tilted
   siblings with the SHIPPED stack + slice capture → per-field value/conf/**method** table + visual
   crop check. **8/9 siblings PERFECT** (clean tight crops — verified by eye: date "07/01/2026",
   issuer "Larkspur Interiors"; ref @90, date @94, issuer full). **invoice_05 = the lone failure**,
   three distinct residual classes (below). This matches the live 16/20 and the NF gate — single
   teach is NEAR-perfect, not yet 100%.

## invoice_05 — the residual classes (this is the real work list)
GT (rendered): issuer **Larkspur Interiors**, **INV-98548**, **24/08/2026** (doc is ≈level, −0.3°).
- **(a) Issuer letterhead crop CLIPPED → "ur interiors".** The `supplier_name` mapping is taught with
  **anchor=null** (a letterhead name/logo, no label to relocate against) → registration-only
  placement → doesn't compose robustly across siblings. This is the **issuer ~70% lane** (NF gate).
  Own class — letterhead geometry (see parked `project_letterhead_geometry_slice`). NOT one of the
  chartered 4.
- **(b) INV-98548 CORRECT but FALSE-flagged `shapewarn⚠NOTE` @70.** The value is right; a derived-rung
  read got shape-flagged. This is **morning-round #4 (false format-note)** AND exactly Oracle's
  "flag-not-clean" observation. The RIGHT fix (Oracle 2026-08-06): a **snap-union GEOMETRY WITNESS
  inside `_abs_edge_guard`'s consent ladder** — a corroborated derived/composed nick heals CLEAN
  instead of flagging, while an un-corroborated one still flags ≤70. This subsumes #1's goal + #4.
- **(c) Date 24-08-2021 vs GT 2026 — silent OCR glyph misread (6→1), committed CLEAN @94.** A read
  error, not placement; hard to catch (still a valid date). Genuine OCR limit; low frequency (1/9).

## Verification state — honest
- NF gate (SET=both SAMPLE=228 SEED=7, shipped flags): baseline `nfc_off` ref 76.8 / date 97.8 /
  issuer 69.7 / po_ref 94.4 / type 99.1. Reports `stress_test/out/customer_score_nfc_{off,on}.md`.
- Pins GREEN after revert: test_template_target_word_snap (string-grep contract restored),
  test_teach_angle_compose, test_template_abs_edge_guard, test_template_mapper + the adjacent suite.
- Kyle probe harness: `<scratchpad>/kyle_crop_probe.js` (+ `render_kyle.py`). Re-runnable; slices in
  a temp `kcp_slices_*` dir.
- Changed files (UNCOMMITTED): `src/modules/templates/handler.js` + `src/modules/review/handler.js`
  (the enabler), `python_backend/extraction/template_mapper.py` (NOTE comment only),
  `python_backend/tests/test_template_target_word_snap.py` (pin note), `docs/oracle_log.md`.
  engine.py fully reverted (no diff).

## NEXT (evidence-backed, for the owner / next session)
1. **Owner smoke the enabler**: teach a doc live, confirm the angle is written at commit (log line).
2. **The ONE correct fix** (own advisor→Oracle→gate round): snap-union geometry witness in
   `_abs_edge_guard`'s consent ladder → corroborated composed/derived nicks commit CLEAN (kills the
   invoice_05 false-flag class + lifts NF ref/issuer). This is the real replacement for #1 and #4.
3. **Issuer letterhead placement** (invoice_05 "ur interiors" class) — anchor-less letterhead crops;
   revive `project_letterhead_geometry_slice`. This owns the issuer ~70% lane.
4. **Chris UI sandbox run** (owner's explicit ask, deferred tonight as too fragile to run unattended):
   the scripts are ready (`/christest` flow + the shipped-switch settings + Straighten-all reprocess).
   Best run with the owner watching, or next session with tighter UI-automation scoping. It ALSO
   tests the real WIZARD teach (fix #3 wizard-anchor tightening — untested by the scripted route,
   which uses teach_from_gt not the wizard).

## Gotchas reaffirmed
- Scratchpad scripts must `require(REPO/node_modules/better-sqlite3)` (absolute) — not bare.
- The scorer/probe run `py -3.12 process_docs.py` and read env switches directly; the app path uses
  `_reconcileEnv(db)` (settings→env) — sandbox needs the switch SETTINGS set 'true', not launch env.
- Straighten during processing = a "Straighten all" REPROCESS (`opts.deskewAll` → `--deskew-pages`);
  import is raw. Compose fires only on deskewed pages with `sample_deskew_angle ≥ 0.2°`.
- HEAD unchanged (no commits made). `ctx.pythonExe`/`pythonArgs` are FUNCTIONS (the enabler calls
  them correctly, mirroring generateLandmarks).
