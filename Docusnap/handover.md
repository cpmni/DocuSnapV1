# HANDOVER — read first on startup (refreshed 2026-07-03)

Branch: **feat/tray-stage1**. Repo root is `c:\GIT Projects\` (the app lives in the
`Docusnap/` subfolder; git paths show a `Docusnap/` prefix — remember when using
`git show HEAD:Docusnap/...`).

✅ **Tree is CLEAN — everything committed + pushed** (HEAD ~`69c6d1a`). Only expected untracked
artifacts remain (audit `.md`s, `assets/Screenshots/`, `output/`, `stress_test/`, `night_audit/`,
`dist/`, `client/dist/`).

📚 **CLAUDE.md was split (2026-07-03, `69c6d1a`)** into a lean index + `docs/` deep-reference set —
read the pointed-to doc when a task touches that area: `docs/extraction-pipeline.md` ·
`docs/detached-client.md` · `docs/features.md` (first-run/backup/**Learning Repair**/teaching/dev
inspector) · `docs/history.md` (**resolved QA findings** + build-stage history) · `docs/licensing.md`.

---

## LATEST — 2026-07-03 (release prep)
**Installers built** (both at commit 6b49bc7): core `dist/ScanFinder Setup 2.0.0-r20260703-0933-6b49bc7.exe`
+ client `client/dist/ScanFinder Search Client Setup 1.0.2-r20260703-*.exe`. Rebuild: core `npm run build`
(CLOSE the dev app first — EPERM on better_sqlite3.node); client `cd client && npm run dist`. `vendor/python`
is present so the license gate + packaging work here.

**This session shipped (all committed):**
- 6 extraction-error fixes (MAC slip-fix, empty-paren charset, date-label, shape-warn suppression, phantom
  cross-type flag, complex-invoice TOTALS via keyword alias + currency-column-skip + label priority).
- **Regional settings (Phases 1-3)**: `region_date_order` (dmy/mdy/ymd) + `region_number_format`
  (continental/french/swiss/indian → canonical) in Settings → Processing. Money fields now **store just the
  number** (currency symbol STRIPPED — `number_format.strip_currency`). Guards: mixed-inbox amount corruption
  (only convert when the value looks like the region), bare-number on-blur currency pattern. Tests:
  `test_number_format.py`, `test_date_order.py`. The Phase-3 currency-ASSIGN feature was REMOVED (superseded).
- **Batched watch folder** (was one Python proc per file → cold-start per file; now sharded batch) + license
  enforcement + poll-time overlap parity. ⚠ Watch still does NOT separate multi-doc PDFs (documented in-code;
  import those manually — a safe fix needs a drain rework).
- Core-aware concurrency cap; full-text search over ALL fields + bidirectional comma numbers; Review
  **"Draw the anchor"** button; keyboard-focus repair; renderer-crash instrumentation.

**Overnight 5-agent release test plan + risk register → `night_audit/RELEASE_TEST_PLAN_2026-07-02.md`.**
Verdict: default (anglo/dmy) install release-ready; the "CRITICAL double-file race" in `v1_stress_findings.json`
is a STALE harness artifact (v1_stress.js stubs commitDocument — real CAS is safe 35/35). **Deferred (owner
decisions):** watch multi-doc separation (BLOCKER-2a); regional pickers not in first-run onboarding (B1d);
a renderer JS twin for region-FORMATTED Search input; client "draw-box OCR returns empty" (pre-existing);
413-vs-reset on oversized /v1 body (L3). PHP licensing-backend needs its own security pass.

---

Dev run: `npm start`. Tests: Python files run DIRECTLY (`py -3.12 python_backend/tests/x.py`,
NOT pytest-the-dir); JS via `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <file>`.
Live DB: `%APPDATA%\ScanFinder\docusnap.db` (WAL mode — safe read-only queries via Python
`sqlite3` with `mode=ro` while the app runs).

---

## ⚠ In-flight this session — UNCOMMITTED (review the diff, then commit/push)
**Learning Repair** (new admin Settings tab to un-poison a document type — full spec now in
`docs/features.md` → "Learning Repair (admin)"). The backend + tab shell were built + committed EARLIER
this session (`repairSuspects.js`, `deconfirmDocument`, replace-in-place `reviewService`, the
`repair-*` IPC, `panel-repair` UI, tests `test_repair_suspects.js` + `test_reviewservice_refile.js`
— both green). The **uncommitted** working-tree changes are the last polish pass + the user's live
bug reports:
- `src/services/repairSuspects.js` — Detector B1 now carries an `example` (dominant-shape value →
  "the others usually look like …"); B2/B3 carry `value`; `computeSuspects` threads `field/value/
  example`. **Supplier filter is now CONTAINS** (`LIKE '%term%'`, not exact) — matches partial/
  garbled company names.
- `database/modules/documents.js` — `getConfirmedDocsForScope` returns `stored_path`/`folder_path`/
  `working_path` + uses the same CONTAINS supplier match.
- `src/windows/settings/renderer.js` — new `rpRenderFields` (fetches `get-document-with-extractions`,
  lists every field value, flagged fields amber + reason/example inline); new `rpFileArgs(doc)` helper
  (resolves the FILED copy from `stored_path`) wired into BOTH the thumbnail + page-preview calls —
  **this fixed the broken thumbnails**: `thumbs.js` short-circuits to no-thumbnail on a falsy
  `folder_path`, and the list was passing `''`. Removed dead v1 `rec*` code.
- `src/windows/settings/index.html` — Keyword Label Overrides help reworded ("saved on this computer
  only", was dev-speak "never shared or packaged").
- `src/main.js` + `client/main.js` + `client/preload.js` — **keyboard-focus fix** (text fields not
  taking focus until you click out+in): window-level `webContents.focus()` on focus/pointerdown.
  User was still verifying whether this fully resolves it — CONFIRM with them before relying on it.

All edited files pass `node --check`; `test_repair_suspects.js` (12/12) + `test_reviewservice_refile.js`
(7/7) pass. Renderer changes need a **Settings reopen / app relaunch** to take effect.

**Learning Repair — 4 more improvements THIS session (also UNCOMMITTED, all tested):**
1. **Outliers now surface under a supplier search** — `computeSuspects` runs Detector A + the new
   `explainOutlierFields` on the FULL type pool (supplier filter ignored for them; Detector B stays
   scoped); `repair-overview` UNIONS full-pool outlier docs into the browse list
   (`documents.getConfirmedDocsByIds`). Fixes "outliers don't show when I search" (a supplier filter
   used to drop the pool below the ≥8-phash gate). Verified live: searching "SuperStore" or "City"
   both surface the 2 City Office outliers among 185 SuperStore invoices.
2. **Per-field "why it looks off"** — `explainOutlierFields` flags WHICH of an outlier's fields differ
   from the type norm (shape/name-quality) as inline `kind:'data'` reasons. New `isRefLike` key-role
   coercion (mirrors engine `_is_ref_field`) so a `text`-typed ref field (`invoice_number`) is still
   shape-checked — applied to BOTH Detector B and the outlier explanations.
3. **Fields panel shows CONFIRMED values** — new `repair-doc-fields` IPC + `documents.getConfirmedFieldValues`
   (correction wins over raw OCR), so the panel shows the confirmed `152888`, not the superseded misread `"St"`.
4. **Preview zoom/pan** — scroll-wheel zoom + right-mouse-button drag pan (no grab) on the Learning
   Repair preview (`rpWirePreviewZoom`/`rpResetView`), mirroring the Review preview.
Files: `src/services/repairSuspects.js` (+test, 19/19), `src/modules/settings/handler.js`,
`database/modules/documents.js`, `src/preload.js`, `src/windows/settings/{renderer.js,index.html}`,
`docs/features.md` (Learning Repair section; split out of CLAUDE.md 2026-07-03).

---

## ✅ DONE — all 11 QA findings fixed + tested (2026-07-02)
The 11 findings in **`NIGHT_QA_AUDIT_2026-07-02.md`** are ALL implemented, tested, and clean on
`node --check`. Per-item landing notes are in `docs/history.md` → "RESOLVED QA FINDINGS". Highlights:
backup restore now natural-key UPSERTs parents preserving local ids (no silent re-type / FK abort,
`test_backup_retype.js`); no-ref/date type confirm dead-end removed; reprocess warns before
discarding edits; batch file-copy + pdf_rotate moved off the `file_done` path (async, no freeze);
File-All-Ready `expectId` race guard + wider bulk lock; empty-issuer warn-and-allow; ONE shared
`database/modules/slug.js` `safeSlug`/`uniqueSlug` (root cause of #7/#9) + `buildXml` hardened;
`src/modules/path_overlap.js` blocks watch/import overlapping the output tree; empty-sanitised
supplier keeps an "Unknown Company" folder; search shows a From>To hint. New tests: `test_slug.js`,
`test_backup_retype.js`, `test_path_overlap.js`, extended `test_filename_pattern.js`.
(Committed + pushed.)

---

## ✅ Shipped this session (all committed + pushed)
- **Sandboxed practice-run TUTORIAL** — new subsystem (`src/windows/tutorial/`, `src/modules/tutorial/handler.js`,
  `assets/tutorial-samples/`): Import→Review→teach→Confirm on 3 bundled watermarked samples,
  fully in-renderer (zero real DB/learning/output writes), draw-a-box ⊕ teach SIM, temp-folder
  filing reveal. 3 entry points (welcome-tour fork, Home "Practice run" card, user menu). Documented in CLAUDE.md.
- **5 seasonal themes** (Spring/Summer=yellow/Autumn/Winter=blue/Festive=green+red) with faint
  repeating **SVG-tile artwork** (`src/windows/shared/patterns/*.svg`, CSP-safe 'self' files) —
  in the CORE app AND mirrored in the detached **client**. Settings → Appearance → "Seasonal".
- **Legal / Terms acceptance gate** — `LEGAL.txt` (DRAFT, single source) → installer NSIS licence
  page + first-run/version-bump gate (`src/windows/legal/`, enforced in main) + re-read (About +
  Settings→Advanced→Legal). Local `{version,hash,app_version,accepted_at}` record; hardened
  (no hide-to-tray dead-end, sender-verified IPC, empty-terms guard, tray-bypass closed).
  ⚠ The text is a DRAFT — the legal-review action items (remove DRAFT banner, contracting-party
  identity, CRA/UCTA liability wording, a separate Privacy Notice for licensing telemetry) are
  OWNER/solicitor tasks, not code.
- **Fixes:** onboarding Accuracy-card selection (html `data-mode` collision) + card overlap;
  validator label-guard false-positive (stray-colon date/ref) + clean-date floor 90→94;
  dangling structural-role self-heal + `updateType` guard + `validateConfirm` config-note;
  ⊕ garbled-label guard + editable readout label; type-change discards staged ⊕ teaching;
  Learning-Recovery clears now refresh the memory inventory; client review-row + non-transparent icon.

## ⚠ Data note
The user's live DB has a custom **"Service Worksh"** type (slug `service_worksh`, id 22) they were
teaching. This session we DELETED a corrupted `description` anchor (label was `"escription`, a
curly-quote OCR misread) and its serial-number anchor was already re-taught. Its `ref_field_key` was
self-healed to null after they deleted the Reference field — they still need to set the Reference role
to **Ticket No.** in Settings (blocked today by open finding #2's dead-end until that's set).

## Memory / conventions worth loading
- `.gitattributes` pins binary types (PDF/png/ico/fonts) — autocrlf was corrupting them.
- Slug/key derivation is inconsistent across 5 sites (see QA report / reggie) — do NOT re-slug
  existing rows without a migration (learned scope keys off the slug).
- Theme system: `theme.js` stamps `data-theme`+`data-mode` on `<html>` — scope any `[data-mode]`
  selectors or they hit `<html>` (memory: `project_theme_system_gotchas`). Seasonal art must be
  'self' SVG files, never `data:` URIs (CSP `img-src 'self'`).
- Test-runner + DB-location details in the memory index (`MEMORY.md`).
