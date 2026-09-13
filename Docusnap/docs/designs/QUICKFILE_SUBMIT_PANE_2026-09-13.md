# Quick File submit UI: PANE (not popup) — decision + build (2026-09-13)

> Owner ask (2026-09-13): "review the page to submit a doc — I am thinking it might be better to use the
> pane on the main window for submitting docs rather than a pop up — take it to barry."
> Advisors: **barry** (product) → **eric** (electron architecture) → **Oracle** (gate). Status: **BUILT
> DARK + pinned** this session; the Oracle verdict is recorded below / in the session handover.

## Decision: replace the popup modal with an in-page PANE
barry's verdict (product): the pane wins, and it's not close, for these users (home / small-office,
owner north star = minimal interaction, maximum auto-file):
1. **Mental model** — Import is already a pane; Quick File is its twin ("the other way documents get
   in"). A nav item should take you somewhere, not flash a dialog.
2. **Drag-drop affordance** (the feature's payoff) needs a persistent drop target — impossible on a
   window that isn't open.
3. **Trust — "where did it go?"** — a pane shows a persistent receipt (real filed path + Open folder +
   Find it + Undo); a modal throws that away on close.
4. Multi-file batches, inline per-file error rows, and no dismiss-click ceremony on a repeated action.

The only thing a modal is better at is a one-off interruption — which Quick File should NOT feel like.

## Build (eric, source-verified) — a pure FRONT-END swap; backend/IPCs unchanged
- **Router** (`src/windows/main/renderer.js`): `VIEWS` gains `'quickfile'`; `showView` fail-closes unless
  `window.QuickFileView.enabled` (a stray `showView('quickfile')` can't reveal an empty pane) and calls
  `QuickFileView.enter()` on entry; `window.showView` exposed for the Import cross-link.
- **Markup** (`src/windows/main/index.html`): `#nav-quickfile` gains `data-view="quickfile"` (the rail
  delegation routes it); a `<section class="view" id="view-quickfile"><div id="qf-root"></div></section>`
  sits beside `view-import`; the script tag now loads `quickfileView.js`.
- **New `src/windows/main/quickfileView.js`** (replaces the modal `quickfile.js`, now DELETED): builds the
  pane lazily + idempotently on first `enter()`; header = pick/drop zone (`#qf-dropzone`, stable id for
  the later drag-drop slice) + a details panel (File-as type, Company, Date, Reference, Notes); body =
  staged-file list with editable per-file Title + remove; primary "File documents"; a persistent
  **receipt** (Open folder → `showInExplorer`, Find it → `openSearchWindow`, **Undo → `deleteDocument`
  soft-delete**, deliberately NOT deconfirm — clear of the Q-C2 write-side refusal family). CSP-safe
  (createElement/textContent only; no `innerHTML`; SVG-sprite icons, no data-URL thumbs → no CSP change).
- **Reveal (fail-closed):** one `quickFileDocTypes()` call; on `enabled` un-hide `#nav-quickfile` +
  `#btn-quickfile` and wire the Import cross-link to `showView('quickfile')`. Any failure leaves both
  hidden (DARK).

## Deliberately NOT wired in this slice (eric — half-wiring would silently no-op)
- **Department field** — the submit handler doesn't copy `meta.departmentId → input.departmentId`; belongs
  in the departments UI slice (D-C9 write rule). NOT rendered (a half-wired field would silently DROP the
  tag → a doc left visible-to-everyone once departments exist = fail-toward-wrong; Oracle).
- **Company autocomplete** — Oracle Q-C7 needs a DEDICATED non-learning reader (never
  `getFieldValueSuggestions`, which excludes Quick-File-only companies). v1 = plain input.
- **Drag-drop** — Oracle Q-C12 parks it to its own pass; `#qf-dropzone` exists now so that slice adds only
  a `data-intake-drop` attribute + a preload branch (`webUtils.getPathForFile`); the M4/M9 boundary
  (`preload.js` two unconditional `preventDefault`s) stays untouched.

## OFF byte-identical (DARK)
Flag unset → `#nav-quickfile` + `#btn-quickfile` stay `display:none`; `#view-quickfile` never `.active`;
`showView('quickfile')` no-ops; Home renders identically; no backend/learning change. The pane touches no
pinned module, so `npm run test:pins` stays green.

## Verification gate
Not jsdom-pinnable in-repo (eric). Gate = (1) the unchanged service pins stay green
(`test_direct_intake_service.js`); (2) the wiring pin `test_quickfile_pane.js` (15 checks); (3) a manual
ON/OFF click-through; (4) a Chris sandbox pass on the pane. **Owed:** the live click-through (this session
built it but could not reload the owner's running app or Chris's in-flight sandbox to smoke it).

## Oracle verdict — SIGN OFF WITH CONDITIONS (2026-09-13)
Pane-over-modal confirmed correct; the build is sound, behaviourally inert OFF (Oracle's honest framing:
"inert OFF, no user-observable change, no new backend call" — not literally byte-identical since it adds an
inert section/attr/VIEWS entry). Conditions are **pre-FLIP, not pre-merge** — the DARK code is safe to land.
- **C1 (APPLIED)** — the `#qf-dropzone` no longer looks droppable (was `2px dashed`, now a plain
  click-to-pick card): a "drop here" cue would be a FALSE affordance while preload still swallows drops
  (drag-drop = Q-C12, deferred). Id kept for that slice.
- **C2 (APPLIED)** — receipt "Open folder" now uses the de-pathed `showDocumentInExplorer(res.docId)`, not
  `showInExplorer(res.storedPath)` — no filed path round-trips the renderer (app convention) + survives a
  re-file. Pin updated to enshrine the de-pathed form.
- **C3 (OWED, pre-flip)** — before `direct_intake_enabled` is flipped for any shared/customer use: run the
  manual ON/OFF click-through + a Chris sandbox pass on the pane. (This session couldn't reload the owner's
  running app or Chris's in-flight sandbox to smoke it.)
- **Standing precondition (C4):** the nicer pane must NOT trigger an early flip — a Quick-Filed doc is still
  an ordinary confirmed row reachable by the four UNBUILT write-side doors (Put-back/Learning-Repair
  send-back, Edit-in-Review, reprocess, requeue). Do not flip before Q-C1/Q-C2 land.
Verified clean: Undo=soft-delete has no learning/deconfirm/reprocess path; Department + autocomplete correctly
UNWIRED; CSP untouched. `docs/oracle_log.md` to be appended.

## Pins
- `src/windows/main/test_quickfile_pane.js` — router/markup/reveal/IPC/receipt/CSP wiring (15).
- `src/services/test_direct_intake_service.js` — unchanged backend contract (submit + update), still green.
