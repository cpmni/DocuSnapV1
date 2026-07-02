# HANDOVER — read first on startup (refreshed 2026-07-02)

Branch: **feat/tray-stage1**. Repo root is `c:\GIT Projects\` (the app lives in the
`Docusnap/` subfolder; git paths show a `Docusnap/` prefix — remember when using
`git show HEAD:Docusnap/...`). Local is IN SYNC with `origin/feat/tray-stage1` — all work
below is committed + pushed. Working tree clean apart from expected untracked artifacts
(audit `.md`s, `assets/Screenshots/`, `output/`, `stress_test/`, `night_audit/`).

Dev run: `npm start`. Tests: Python files run DIRECTLY (`py -3.12 python_backend/tests/x.py`,
NOT pytest-the-dir); JS via `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <file>`.
Live DB: `%APPDATA%\ScanFinder\docusnap.db` (WAL mode — safe read-only queries via Python
`sqlite3` with `mode=ro` while the app runs).

---

## ✅ DONE — all 11 QA findings fixed + tested (2026-07-02)
The 11 findings in **`NIGHT_QA_AUDIT_2026-07-02.md`** are ALL implemented, tested, and clean on
`node --check`. Per-item landing notes are in CLAUDE.md → "RESOLVED QA FINDINGS". Highlights:
backup restore now natural-key UPSERTs parents preserving local ids (no silent re-type / FK abort,
`test_backup_retype.js`); no-ref/date type confirm dead-end removed; reprocess warns before
discarding edits; batch file-copy + pdf_rotate moved off the `file_done` path (async, no freeze);
File-All-Ready `expectId` race guard + wider bulk lock; empty-issuer warn-and-allow; ONE shared
`database/modules/slug.js` `safeSlug`/`uniqueSlug` (root cause of #7/#9) + `buildXml` hardened;
`src/modules/path_overlap.js` blocks watch/import overlapping the output tree; empty-sanitised
supplier keeps an "Unknown Company" folder; search shows a From>To hint. New tests: `test_slug.js`,
`test_backup_retype.js`, `test_path_overlap.js`, extended `test_filename_pattern.js`.
**NOT yet committed** — review the diff, then commit/push when ready.

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
