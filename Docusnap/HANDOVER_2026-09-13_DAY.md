# HANDOVER 2026-09-13 DAY — preview controls + search-term jump/highlight + live-vet fixes

Daytime session. The owner drove a live vet of the running TEST build and asked for a set of
preview/search UX changes plus a couple of bug fixes. Everything below is UI/renderer + two small
back-end touches — **no extraction/trust behaviour changed** except the deskew note wording.

---

## COLD START (read this first)
- Branch `feat/teach-side-overnight`; **HEAD `c03ad9c`; 8 commits ahead of origin, NONE pushed** (owner's
  call). origin already holds everything through `3707035` (the pre-compaction preview work), so the only
  unpushed commits are this session's 7 (listed below). Tree clean (the many `??` HANDOVER_*.md / TESTING
  files are pre-existing untracked noise, not this session).
- **App is RUNNING** with `TEST_BUILD=1` (dark switches armed), fresh instance 12:54.
- **DEV-RESTART TRAP (cost several cycles today — now a memory `project_dev_restart_singleinstance_trap`):**
  relaunching `npm start` while a repo Electron instance is still alive is a **silent no-op** — Electron's
  single-instance lock bounces the new launch to the OLD window, so you keep seeing OLD code. The correct
  restart: kill this repo's `electron` procs **to zero** AND the `node.exe` launcher whose command line
  contains the repo path, **verify the count is 0**, then `$env:TEST_BUILD='1'; Start-Process cmd '/c',"cd
  /d <repo> && npm start"`, then verify NEW procs came up (StartTime after now). This is why "still blue"
  persisted through three earlier "restarts".

## WHAT SHIPPED — this session's 8 commits (newest first)
- `c03ad9c` **Find caption: monochrome SVG magnifier** — the whole "blue" saga: the accent CSS tint was
  removed (`7e96403`), but the 🔍 EMOJI glyph itself renders blue in Segoe UI Emoji, so it was dropped
  (`e331f43`) — which left no icon (owner). Final: an inline SVG magnifier stroked in `currentColor`, so it
  takes the muted caption colour and matches Zoom/Page. ⚠ Owner left mid-iteration — **verify the Find
  caption reads a grey magnifier + "Find" (no blue, icon present) first thing in the new session.**
- `e331f43` (superseded by `c03ad9c`) dropped the blue emoji.
- `7e96403` Find stepper: removed the accent-blue tint, back to the neutral button styling (owner: the
  blue clashed). Distinction now = the "Find" caption + section separator only.
- `2ffdebf` Preview nav bar: labelled each cluster (**Zoom │ Page │ Find**) with taller separators, so the
  two ‹ / › pairs no longer look identical (owner ask).
- `63f069b` **Learning History typing fix** — clicking ✎ rebuilt the panel while the button held focus,
  which unrouted Chromium's keyboard widget (caret + Backspace worked, letters didn't). Blur the button
  before the rebuild. (Owner-reported: "caret ok, could backspace but no typing".)
- `7246978` **Deskew note** — when straightening FINDS a value that was empty, it now says "Found 'X' after
  straightening — confirm once" instead of the silly "was '(empty)', now 'X'". Still a confirm-once hold
  (behaviour unchanged), only the empty-before copy differs. Pin updated; both deskew pins green.
- `328d663` **Search-term jump/highlight (Slice A1, born-digital PDF)** — open a doc from results with an
  active full-text term → preview jumps to the first hit, highlights all matches on the page, ‹ / › + "N/M"
  step through matches across pages. New `python_backend/render/pdf_find.py` (pypdfium2 text search, NO OCR)
  returns match boxes as PAGE FRACTIONS (DPI/zoom-proof) → `previewService.findInDocument` + IPC
  `find-in-document` + preload + `search-preview.js` overlay. Smoke-tested end-to-end at the Python layer.
- `b8ea1e0` **Preview controls (Search + Review)** — wheel now SCROLLS the page, right-drag PANS, zoom is
  the +/−/Reset buttons only. Search uses layout-zoom (image width sized → native scroll). Review keeps the
  CSS-transform zoom (protects the zone-OCR/teach/trace canvas coordinate maths — `canvasPoint` invariant),
  only the wheel changed (native scroll at fit, clamped translate-scroll when zoomed). Client app already
  scrolled natively (no change needed).

## NEEDS YOUR DECISION (asked, not answered — pick up here)
**Confirm-once should clear the batch + the P1/PI auto-file question.** Owner observed: (a) a 1-char
confusable ref slip (P1↔PI) HOLDS for review instead of auto-filing, and (b) confirming one held doc does
NOT flip the other docs held with the same slip. Both are the same friction — "don't make me fix the same
OCR slip N times." Proposed as ONE arc, two slices:
- **Slice 1 (safe, recommended first): confirm once → sweep the batch.** Accepting a ref fix offers "Apply
  this same fix to the N other held docs with the identical slip." Safe: it only spreads the human's own
  explicit decision to identical cases.
- **Slice 2 (needs a flip-corpus census first): auto-file future ones cold** when it's a single confusable
  char + matches the learned shape + history agrees. Riskier (a wrong ref correction is unrecoverable), so
  census-gated.
Both go through the advisor + Oracle gate. **Owner has NOT chosen** Slice 1-now-only vs both. Current
behaviour is BY DESIGN (the whole reference-correction family is deliberately review-bound — nothing
auto-files a corrected ref). Not started.

## FOLLOW-UPS from this session (not built)
- **Search-term jump/highlight — Slice A2 (scanned pages) + A3 (client app).** A1 covers born-digital PDFs
  only. Scanned/image docs need OCR word-boxes (Tesseract TSV; on-demand per page, or persist geometry at
  import — an architecture choice). Office docs (docx/xlsx) don't render a preview, so no highlight (still
  found by search). The client app search preview would need a /v1 find endpoint. Owner-visible: a scanned
  invoice found by body text won't highlight yet.
- **Verify `e331f43` on screen** (the emoji fix) — owner left before confirming.

## STILL OPEN from before this session (unchanged — see CLAUDE.md ⏭ LATEST 2026-09-13 NIGHT)
- **Quick File + Departments** is a DARK, byte-identical-OFF FOUNDATION only. The D2 list-reader SWEEP
  (must be COMPLETE to be safe) + the UIs REMAIN — that's the multi-day "PART 2". Do not flip on.
- **Flip-ready switches** mig 159 (`ref_confusable_flag`) + 156 (`name_role_nonname_flag`) + 143 passed
  their censuses (M=0). Flipping to customer-default is an approval-class decision — owner's call.
- Push decision (7 local commits this session; the night work is already on origin through 3707035).

## MEMORIES SAVED THIS SESSION
- `feedback_screenshot_shorthand` — "screenshot" / "N screenshots" = read the N newest images from
  `C:\Users\cmccu\Pictures\Screenshots` (active convention).
- `project_dev_restart_singleinstance_trap` — the restart recipe above.

## KEY FILES TOUCHED
- `src/windows/search/{search-preview.js, search-query.js, index.html, renderer.js}` — controls + jump/
  highlight + nav labels + help copy.
- `src/windows/review/renderer.js` — Review wheel-scroll + LH typing blur fix.
- `src/services/previewService.js` (+ `src/modules/review/handler.js`, `src/preload.js`) — findInDocument.
- `python_backend/render/pdf_find.py` (NEW) + `python_backend/process_docs.py` (+ its pin) — deskew note.
