# Handover — 2026-09-25 wrap: four builds, two DARK arcs
Branch: `feat/teach-side-overnight` · HEAD `d2f8bc3` = origin · tree clean (only stale census artefacts untracked) · Updated: 2026-09-25

## Goal
Chris's 2026-09-24 round closed out: every card fixed or designed; two Oracle-signed arcs BUILT DARK (migs 217, 218);
a hardened TEST installer for the owner's fresh-PC test. Full ledger: `HANDOVER_2026-09-25.md` (§1-§9) + CLAUDE.md LATEST.

## Done (all pushed)
- `1efae11` redetect toast names TYPES not slugs + receipt pin + contract 1.7.0-1.9.0 note (`docs/detached-client.md`)
- `b46d1a7` **fast on-open "second look" road now spawns Python with the pipeline env** — `_pipelineSpawnEnv(db)` at BOTH
  imageless spawns (`src/modules/processing/handler.js`); kill `REEXTRACT_FAST_PIPELINE_ENV=0`; gate 177+12 docs, 24 drops all wrong
- `c7e0cc0`/`8a8498f` **TEST installer `dist\ScanFinder Setup 2.0.0-r20260925-0926-c7e0cc0-TEST.exe`** (371 MB; recipe
  `HARDEN_JS=1 HARDEN_JS_STRINGS=1 TEST_BUILD=1 npm run build`; verifier OK with `TEST_BUILD=1`; arms all TEST switches incl. mig 216)
- `99297fd` "Set aside all" asks once; activity-strip kind `recognised` (quietLane dep `recordEvent`); `src/lib` added to `run-pins.js`
- `7057b87` SFDEV trace console shows the STRAIGHTENED re-read (`pass:"straightened"` + `deskew_adopt`/`deskew_pass` events)
- `9abc3a2` **DARK mig 217 `type_owner_uninstalled_block`** (keyword.py owner-precedence: an uninstalled shipped title = blocking owner;
  installed names ∪ aliases never block; child of the fold) — census Chris copy exactly {46,52}, live 758 texts 0, C4 separation identical
- `49710a7` **DARK mig 218 `issuer_sibling_dominant_hold`** (Tier C converging-siblings issuer hold: confirm gate + teach ask both roads +
  Review grouping; `/v1` review-confirm 400 carries `nearMatch` → contract **1.10.0**) — census Chris copy exactly {62,69}, live 0/0

## In progress — UNCOMMITTED
- Nothing. Untracked `TESTING/_measure/{confusable_slices_20260922,dual_reader_census/full_run.log,glyph_fallback_census_20260922/*}`
  are regenerable 09-22 artefacts — leave or delete, never commit.

## Next steps
1. Owner's fresh-PC test of the TEST installer (predates `99297fd`+). Then decide: flip mig 216 (evidence strong).
2. Rebuild ONE installer with everything (same recipe) — do NOT run `npm run build` without `HARDEN_JS=1` (verifier refuses + renames `.REFUSED`).
3. mig 217 flip gate (`NIGHT_RUN.md` queue): realdoc ON arm `RR_APP_ENV=1 OCR_RENDER_DPI=200` (M=0) + Hard Set `statement_layout`
   class + scorer rule for an uninstalled GT type (Oracle C9). Text census + C4 already MET (`TESTING/_measure/type_owner_block_20260925/`).
4. mig 218 flip gate: one live LAN-client confirm of Chris's doc 69 (C4 toast) + a `/christest` round with the switch armed
   (confirm 69 FIRST → held → Use → ONE folder). Client Use/Keep affordance = `pendingfeatures.md` card.
5. Pre-existing red: `python_backend/tests/test_identity_fusion.py::test_verdict_conflict_agree_abstain` (fails on old trees too; unrelated).
6. Owner decisions still open: sandbox `output_folder` points at the REAL `Documents\Scan Finder`; card-8 tab rename; NL search dates.

## Decisions & rationale (non-obvious)
- Fast road got the FULL env (not a 4-switch bridge): a third env composition is the drift class that caused the bug (Oracle).
- mig 217 generalised to every uninstalled SHIPPED name (not only the fold's {statement, letter}) — a stolen Credit Note/Delivery Note title
  is the same class; the "two owners → the sum" fallback is today's two-installed-owner path, pinned as the accepted trade-off.
- mig 218 counts HUMAN-confirmed converging siblings from day one (Oracle C2) and runs in the TEACH ASK (C1) — without C1 the wizard
  freezes a garble as a template identity and loops; display slice is size-prefiltered (first draft: 36 s on a 2,000-row queue).
- Both arcs DARK by rule; nothing flipped this session. `deskew_corrob_autofile` / mig 211 stay OFF (owner's call).

## Gotchas
- Every Python spawn MUST use `_pipelineSpawnEnv(db)` (handler.js) — never hand-compose bridges.
- Bash heredocs strip a backslash level: regex-heavy pin edits go through the Edit tool, not `py - <<EOF` patches.
- `TEST_SWITCH_KEYS` count is pinned in SIX files (137/163/205/215/216/217 pins) — a new DARK key means six patches. Now 16.
- Renderer/lane source pins use char WINDOWS (`test_quiet_lane.js` job_done 2200; strip pins) — widen, don't restructure.
- `src/lib` was never in `run-pins.js` until today (a pin sat red since 09-07 unseen) — check the runner's LOCATIONS when adding a pin dir.
- Verify a TEST build with `TEST_BUILD=1 node scripts/verify-release-artifact.js dist/win-unpacked` or it refuses as "not a release".
- Live DB copy for censuses: `%APPDATA%\ScanFinder\docusnap.db` (+wal/shm) copies fine with Python shutil to job scratch; `warm_700.db`
  stores no `ocr_text`; the 09-16 soak's `templates.json` must be regenerated (`templates.getAll(db)` → scratch, real data, never commit).
- Sandboxes (CDP 9223/9226) were closed for the build; the owner's sandbox DB now has Credit Note/Delivery Note/Statement installed.
- Client copy of the wizard lives at `client/renderer/shared/teach-ui/teach.js` (synced by `scripts/sync-client-teach.js`, transformed — never byte-compare).
- Census scripts need `PYTHONIOENCODING=utf-8` (a `→` glyph crashes cp1252 stdout).

## Verify
- `node scripts/run-pins.js` (458 files green at `49710a7`) · `PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_teach_side_gates.py` (36/36)
- `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_near_match_siblings.js` (ALL OK)
- `PYTHONIOENCODING=utf-8 py -3.12 TESTING/_measure/type_owner_block_20260925/census.py <db-copy> <label> --known import` → exactly {46,52} on Chris's copy
