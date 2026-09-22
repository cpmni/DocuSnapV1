# HANDOVER 2026-07-31 EVENING (Opus 4.8)

**Branch** `feat/reprocess-throughput-autostraighten` · **HEAD `9b4e478`, PUSHED** (origin in sync).
Tree clean bar pre-existing untracked (`../Backup/`, `../Docusnap - Copy*`, `HANDOVER_2026-07-28*.md`,
`docs/SECURITY_HARDENING_REPORT_2026-07-28.md`, `scripts/remove-superstore-invnum-anchor.js`).
**No dev app / harness running.** Installer at **`5b5d344`** (`dist/ScanFinder Setup 2.0.0-r20260731-1022-5b5d344.exe`)
— predates the 3 renderer UX fixes below (`ca90c73`, `9b4e478`), so a rebuild is needed to ship those.
Continues `HANDOVER_2026-07-31.md` (Slice 1 reconcile + teach cursor-lock, morning).

## TL;DR
Continued the teach clipped-code work: **Slice 2 (drift-path reconcile) BUILT + FLIPPED ON**. Built the
**installer** (`5b5d344`). Then three owner-requested UX fixes: teach preview **opens at the top** of the
doc + **background-renders** the page while the user picks the type; and the Review **logo suggestion**
("Use 'X' — the logo looks similar") now **won't suggest a company whose name isn't on the page**. All
committed + pushed. The 3 renderer fixes are parse-verified but NOT yet visually smoked (renderer changes
load on window-open — need `npm start`/reopen or a rebuild).

## COMMITTED this session (newest first)
- **`9b4e478`** fix(review): **logo-suggestion name-presence veto**. Root: the renderer's raw logo phash
  match (`attemptLogoMatch`, `src/windows/review/renderer.js`) offered "Use '<name>' — the logo looks
  similar" on any `matchLogoHash` conf≥60 with NO on-page name check → a phash collision suggested
  "Saltmarsh Seafoods" on a Copperfield invoice (64-bit phash has ~0 separating power on scans). It
  bypassed the engine's identity text-first gate entirely. Fix: `_supplierNameOnPage(name, ocr_text)` —
  offer only when a distinctive name token appears in `currentDoc.ocr_text`; **fail-open** when <8 words
  of page text or the name has no distinctive token (mirrors the engine's "abstain only on POSITIVE
  disagreement"). Renderer-only; backend `Use "<name>"` **branding** buttons already read names off the
  page (unaffected). Tested: node logic check (Saltmarsh→veto on Copperfield; real on-page names→show).
- **`ca90c73`** feat(teach): **open-at-top + background render**. `src/windows/teach/renderer.js` +
  `index.html`. (a) `tzShowTop()` parks the initial zoomed pan at the TOP of the page (fields sit up top)
  instead of the flex-centred middle; panning stays free, no-op if the page fits. (b) `_prefetchTeachPage()`
  fires `getDocumentPages` (the heavy ~scale-4.0 render) the moment a doc is chosen/imported → renders in
  the BACKGROUND while the operator picks the type; the draw step opens instantly or shows a "Reading
  document…" overlay (`#rg-loading`) until ready. Also fixes a latent bug: `state.img` was never cleared on
  doc change, so a newly-picked doc could flash the previous page. **CONSTRAINT (verified):**
  `get-document-pages`/thumbnail resolve the file SERVER-SIDE from the DB row only (security), and the
  import creates the doc row only on `file_done` (processing/handler.js:1044) — so the import OCR itself
  still runs before the doc appears; only the RENDER is backgrounded. Making the import *itself* instant
  (advance during OCR) needs a pending-row-on-`file_begin` change — DEFERRED (below).
- **`5b5d344`** docs: Slice 2 session-state + pendingfeatures.
- **`a4fa107`** feat(teach): **Slice 2 — drift-path inline-code reconcile, FLIPPED ON**
  (`TEMPLATE_INLINE_CODE_RECONCILE_DRIFT` default ON, kill `=0`). The DRIFT/relocate path
  (`_relocate_and_read._geometric`) re-seats the value at the same narrow drawn width → same prefix-clip +
  OCR-garble risk as Slice 1's fast path. Factored the Slice-1 decision into shared helpers
  (`_read_inline_box` Seam-B full-res re-read + `_pick_fuller_code` suffix/confidence decision); Slice 1
  now calls them (behavior-identical). Slice 2 routes `_geometric`'s read through `_inline_code_reconcile`
  WHOLESALE — its OWN page-wide locate (Oracle: the drift-branch `located` handed in can be a clipped LOCAL
  locate = Seam A), guard + full-res re-read. Threaded `ocr_lines_fn`+`line_cache` into `_relocate_and_read`.

## Verification — Slice 2 (all read live)
- **Oracle SIGN OFF WITH CONDITIONS (go ROBUST, not the partial `located`-based version — it could DEGRADE
  a correct geometric read to a flagged differently-clipped inline).** All 5 conditions met.
- `stress_test/drift_forced_probe.py` (render each Ridgeway docket, shift content down past the drift
  tolerance → forces the drift branch on real pixels): **10/10 full `DN-#####`, 0 degraded, and 3 REAL
  fixes** — garbled/wrong drift reads `DN-7R27S6`/`NN.INaIAe`/`DN-87724` → `DN-78756`/`DN-70628`/`DN-82734`,
  committed flagged-for-review (`_shapewarn`; the disagreement arm preferred the higher-conf page-wide inline).
- `stress_test/realdoc_regression.js` DRIFT-ON == baseline: **13/13 shared, 0 new**, type/supplier 100%,
  ref 91.5%/date 99.3%. (⚠ The 13 are pre-existing corpus GT-poison; `GATE=1` exits 1 at BASELINE — the
  signal is the 0 delta, NOT the exit code. Diffed the `want '…'` lines: 0 off-only, 0 on-only.)
- `python_backend/tests/test_template_mapper.py`: **87 checks pass** incl. 4 new drift PINs (page-wide
  source-coverage — *fails the partial, passes the robust source*; OFF byte-identical; agree-keeps-geometric;
  disagreement-flagged) + Slice-1 probe still 10/10 (refactor inert).

## Verification — the 3 UX fixes (HONEST)
- **Logo veto:** node logic test only (correct results). NOT smoked in the live Review window.
- **Teach open-at-top + background render:** `node --check` parse-clean only. **NOT visually smoked** —
  renderer/CSS changes need the teach window reopened (`npm start` or a rebuild). No corpus/gate impact
  (renderer-only, no main/security changes).

## FIRST ACTIONS (fresh session)
1. **Decide the installer rebuild.** The shipped `-5b5d344.exe` predates `ca90c73` + `9b4e478`. Rebuild to
   ship the 3 UX fixes (close dev app first — EPERM; `vendor/python` present; `npm run build`). OR the owner
   dev-tests via `npm start`.
2. **Visual-smoke the 3 UX fixes** (owner): teach opens at the TOP; "Reading document…" overlay on a slow
   doc; the logo-suggestion button is SUPPRESSED on a doc whose logo-collision name isn't on the page.
3. If continuing features: the deferred list below, or the security backlog (owner-gated).

## DEFERRED (designed / discussed, NOT built)
- **Teach import — make the import ITSELF instant** (advance during OCR): needs the import to create a
  PENDING doc row on `file_begin` (currently only on `file_done`, processing/handler.js:1044) so the doc
  id + a thumbnail are available before OCR finishes. Bigger change (import architecture + a thumbnail that
  works on a pending row) — touches `src/modules/processing/handler.js`. This session only backgrounded the
  RENDER; the OCR read still blocks the doc's appearance in the picker.
- **Slice 2 perf follow-up (optional):** the drift-path reconcile does a page-wide locate per clean CODE
  read; `line_cache`-shared with registration (≈0 extra OCR on registration-enabled docs). If ever flagged,
  gate the cross-check on a cheap pre-signal (local `inline_value` disagreeing) before escalating. In
  `pendingfeatures.md`.
- Prior deferred (see `HANDOVER_2026-07-30.md`): reextract Slice C warm worker; security F2 WAMP verify +
  F3/F4/M-2/L-1/2/4/6; wider `pendingfeatures.md` backlog.

## NEEDS THE USER (in-app)
- **Heal the reconcile dockets** — docs **142-151 are all still `needs_review`** (verified via DB). The
  reconcile fix is import-time, NOT retroactive: **reprocess** them in Review (full reprocess, not fill-only
  reextract) to pick up the un-clipped `DN-#####`. (Worksheet cleanup from 07-30 is DONE — verified: a
  "Worksheet" type exists; #120 is confirmed `worksheet`/`WS-91456`.)
- Installer rebuild decision (#1).

## KEY FACTS / PATHS
- Fix code: `python_backend/extraction/template_mapper.py` (`_inline_code_reconcile`, `_read_inline_box`,
  `_pick_fuller_code`, `_relocate_and_read`+`_geometric`; flags `_INLINE_CODE_RECONCILE_ON` /
  `_INLINE_CODE_RECONCILE_DRIFT_ON`, both default ON). Logo veto: `src/windows/review/renderer.js`
  `_supplierNameOnPage`/`attemptLogoMatch`. Teach UX: `src/windows/teach/renderer.js` (`tzShowTop`,
  `_prefetchTeachPage`, `_setPageLoading`, `startRegionStep`) + `index.html` (`#rg-loading`).
- Harnesses (read-only, live DB): `stress_test/delivery_reconcile_probe.js` (RECONCILE=0/1),
  `stress_test/drift_forced_probe.py` (`py -3.12`), `stress_test/teach_vs_review_parity.js`,
  `stress_test/realdoc_regression.js` (GATE=1). Run JS via `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron`.
  Python tests: `PYTHONIOENCODING=utf-8 py -3.12 …` (the summary em-dash crashes cp1252 on redirect otherwise).
- Live DB `%APPDATA%\ScanFinder\docusnap.db` (read-only `?mode=ro`). Delivery dockets = docs 141-151
  (141 taught/confirmed; 142-151 needs_review). Ridgeway delivery template = id 8.
- Memory `project_teach_inline_code_reconcile_20260731` (both slices). Agents this session: gary, Oracle×2
  (Slice-2 vet = go-robust), 007 (Slice 1, prior). All advisory; sign-offs met.
