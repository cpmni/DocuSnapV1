# HANDOVER — 2026-07-11 EVENING (re-read + DIRECTION_SUPREMACY + deskew foundation)

**Branch:** `feat/doctype-title-aliases` · **last commit:** `ad8f67a` · **8 commits this session on
top of `e898009`** · **working tree CLEAN** (all committed) · **NOT built, NOT merged, NEEDS A
RESTART** (D1 renderer) · Live DB migration **45**. Dev app was CLOSED at wrap (so `npm run build`
is unblocked).

**Context in one line:** committed the large uncommitted batch (after a security check on the
licensing keys), then built + A/B'd the gate-failure RE-READ and the full DIRECTION_SUPREMACY
package (c2 → G3b → D1), fixed 2 preset test regressions the full-suite run surfaced, and built the
deskew FOUNDATION (renderer half deferred).

---

## The 8 commits (detail is in CLAUDE.md "Recent session changes" EVENING blocks — READ THOSE)
1. `838de51` — the 2026-07-10 night + 07-11 daytime **BATCH** (84 files). Gate: changed-surface
   suites green; corpus **M=9 accounted** (4 Cloudpeak + 4 GT-poison where the pipeline is CORRECT +
   #2357 A/B-proven pre-existing). **Security: the licensing private keys/seeds/admin-hash under
   `Docusnap/output/…/keys/` were verified NEVER committed (path + PEM-header + exact-content over
   all 638 commits) and `output/` is now gitignored.**
2. `28d31c5` — Stage-4.5 gate-failure targeted **RE-READ** (review-bound, default ON). A/B (same
   2494-doc DB, ON vs OFF): M identical, ref **+3 recall**, 5 adoptions all correct.
3. `59ea765` — **c2** taught-field ownership guard (HOLD-only). A/B: net safety win **M 12→9**,
   per-field identical, **+128 docs review-bound** (accepted). ⚠ caught pre-commit that
   `field_anchors.document_type` stores the SLUG not the NAME (design premise was wrong).
4. `29a8c9c` — **G3b** known-caption value guard (customer-side). A/B: **perfectly neutral** on
   scored fields (customer_name isn't corpus-scored).
5. `379554c` — **D1** teach label-pick — **DIRECTION_SUPREMACY COMPLETE** (c2→G3b→D1; D2=do-nothing).
6. `222d54f` — preset-catalog **TEST** alignment (2 stale tests; the catalog was already correct —
   supplier_name sole identity per migration 44).
7. `ad8f67a` — deskew **FOUNDATION** (`tesseract.detect_skew_angle` + `region.py --skew/--deskew` +
   `test_skew_angle.py`). Renderer half deferred.

## Verification state — honest
- **Full test suite RUN this session: Python 113/118, JS 98/100 — ZERO regressions from these 8
  commits.** The 7 remaining failures ALL fail at baseline `e898009` (pre-existing WIP): Py
  test_anchor_crop_crosscheck / test_identity_fusion / test_network_field_authority / test_precedence
  / test_stage45_text_preserve (3 share a stale `trace`-kwarg helper); JS test_authoritative_anchor /
  test_workflow_ipc (workflow disabled by design).
- Every pipeline-touching fix was corpus-A/B'd (read the report file, not the exit code). Each design
  was Oracle-vetted; the 5 `docs/designs/*_2026-07-11.md` for re-read + c2/G3b/D1 are marked BUILT.

## FIRST ACTIONS for the fresh session
1. **`npm run build`** if a build is wanted (dev app is closed). **A RESTART loads the D1 renderer
   change**; the Python changes (re-read/c2/G3b) take effect on the next processing.
2. **Deskew renderer half** (task #7 / [[project_review_deskew_display]]): foundation committed;
   build the IPC + display swap + toggle + the coordinate BACK-TRANSFORM. **Do it with the app OPEN**
   (draw-a-box loop) and **nail the back-transform sign with a Python-vs-real-PIL test first** —
   without it, taught anchors get WORSE. The endpoints + verified PIL sign convention are in the
   memory note.
3. **NEW focus bug** (caret VISIBLE but no keystrokes, fixed by taskbar defocus/refocus — a distinct
   3rd mode) → eric. See [[project_focus_repair_mechanism]].

## Remaining / deferred
- `docs/designs/`: **ACCEPTED_DEBRIS** + **CROP_GEOMETRY** designs remain UNBUILT (queued, own A/B each).
- 7 pre-existing WIP test failures (above) — a cleanup pass.
- Standing: doc 1880 re-confirm `SO-51337` (drop its gt_override); ~109 `-DUPLICATE` re-import cleanup.

## Key facts / paths
- DB `%APPDATA%\Roaming\ScanFinder\docusnap.db` (mig 45, read-only diagnostics).
- Harness: `ELECTRON_RUN_AS_NODE=1 electron stress_test/realdoc_regression.js` — READ THE REPORT
  (`stress_test/out/realdoc_regression.md`), not the exit code. Kill switches (env): `GATE_REREAD`,
  `TAUGHT_FIELD_OWNERSHIP`, `KNOWN_CAPTION_GUARD` (all default ON; `=0` disables) for A/B toggling.
- Tests: Python per-file script-style (`py -3.12 tests/test_x.py` from `python_backend/`, PYTHONUTF8=1);
  JS via Electron-as-Node. No `npm test`. `git worktree add … e898009` to check a suspected regression
  against baseline (the method that caught the 2 preset regressions + confirmed the 7 pre-existing).
- Agents: bob/oscar/eric/reggie/gary/oracle registered; 007 = general-purpose + `agents/007.md`.
