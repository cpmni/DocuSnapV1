# HANDOVER — 2026-08-10 EVENING (owner present)

**Branch:** `feat/teach-side-overnight`
**HEAD:** `6acf4e2` — **PUSHED** (`7038d8d..6acf4e2`), branch level with origin
**Uncommitted batch?** NO. Working tree carries only the pre-existing untracked files that were
already there at session start (`Backup/`, `Docusnap - Copy*`, eight old `HANDOVER_*.md`,
`docs/SECURITY_HARDENING_REPORT_2026-07-28.md`, `scripts/remove-superstore-invnum-anchor.js`).
**Installer:** NOT rebuilt this session. `dist\ScanFinder Setup 2.0.0-r20260810-0915-29425c9.exe`
still predates the account-number, cold-start, teach-parity AND everything in this session.
**Context:** the owner asked "what is on the pending features list that hasn't been done?", then
"let's do the UX/product group". Four commits. **This session was UI/UX and copy only — no
extraction-layer change, no flag flipped, no migration.**

---

## TL;DR

- **The whole UX/product group in `pendingfeatures.md` is now closed or honestly re-scoped.**
- **THREE of its entries were ALREADY SHIPPED and had never been ticked** (Core Search re-skin,
  document-detail DTO, focus-sweep slice 1), and **a fourth entry stated something FALSE** — the
  custom-stamp entry claimed the approver's note "is not printed on the stamp"; it has been printed
  since the module was written. Verified at source, all four corrected in the file.
- **Owner caught a real miss mid-session:** my first Template-Manager Straighten commit made the
  *mapping* overlay frame-aware but missed `drawRegistrationPreview`, which is the overlay actually
  in use when checking a template. Fixed in `6acf4e2`, along with two consequences it exposed.
- Two new backlog entries filed from owner reports: the **pre-normalisation cross-check** and the
  **typed-teach-value has no location** question. Both say plainly what was verified and what was not.
- **NOTHING in this session has been smoke-tested in the UI by me.** See *Verification state*.

---

## Committed this session (all pushed)

### `f108dbb` — child-window dock · teach confirm bar · TM Straighten · stamp elide · record fixes

**1. Child-window minimise → a visible dock** (owner 2026-08-02).
Root cause of the original block was **stale**: the code comment justified `minimizable:false` with
"a minimised modal child behind the LOCKED main shell", but `NON_MODAL_CHILD` (`main.js:499`)
contains **every** member of `CHILD_WINDOWS` (`:498`), so `modal` always evaluates false and there
is no locked shell. Minimise is re-enabled for parented children; the window announces itself to
the MAIN shell, which renders a pronounced chip at its bottom-left.
- Restore channel is **sender-guarded to the main window** — no renderer can raise an arbitrary
  window by name. Every `restore`/`show`/`focus`/`closed` edge un-docks, so a chip cannot outlive
  its window. A chip whose window is gone self-heals.
- **Kill switch `CHILD_DOCK=0`** restores the old `minimizable:false` behaviour exactly.
- **STANDING CONDITION, written at the dock:** if any child is ever made modal again, this dock
  must be revisited in the same change — the chip would be unclickable while a modal is up.
- Files: `src/main.js`, `src/preload.js`, `src/windows/main/{index.html,renderer.js}`.

**2. Teach confirm bar — unambiguous accept** (owner 2026-08-02, screenshot).
The label-direction toggle rendered its selected side as `btn primary` — byte-identical to the
"Looks right →" accept button beside it. Direction is a SETTING, so it is now a segmented control
selected by an inset surface; accept is the only filled control. Ids unchanged ⇒ all handlers bind.
- Files: `src/windows/teach/{index.html,renderer.js}`.

**3. Template Manager Straighten** (owner 2026-07-30) — *see `6acf4e2` for the fix that completed it.*
The load-bearing part is the FRAME, not the picture: extraction reads the RAW scan, so a box drawn
on the straightened render is in the wrong coordinate frame. Reuses
`AnchorLabel.deskewedNormToRaw` — the teach path's primitive, whose rotation sign was established
empirically against real `PIL.rotate` and is pinned in `shared/test_anchor_label.js` — rather than
re-deriving it. Each draft box is stamped with the frame it was drawn on; **the save REFUSES with
an explanation if that frame can no longer be vouched for** (page navigated, straighten toggled,
new sample) — the Oracle C1 fail-safe from the teach path. Landmark drawing is disabled while
straightened: it has its own save path, untouched here.
- Files: `src/windows/settings/{index.html,renderer.js}` (+ `shared/anchorLabel.js` script tag).

**4. Stamp note ELIDES instead of killing the stamp.** `stampPdf` throws above `MAX_NOTES` and
`stampWorkflowDecision` swallows every throw, so a 601-character rejection reason produced **no
stamped copy at all, silently**. Now elides on a word boundary with a visible ellipsis.

**5. Record corrections (no code):** see the *Backlog accuracy* section below.

### `c877aac` — teach: explain the type actions, stop selling the position-less route

**Step 2 — the two type actions.** Advisors: **Chris The Customer** (cold narration + finding cards)
and a **UI design pass**; both advisory, both vetted against the code before anything was applied.
Chris's finding was better than the polish request: the two buttons look like a matched pair but
operate at **completely different scopes** — the catalog adds types INSTALL-WIDE, editing a type
changes it EVERYWHERE it is used — and neither is scoped to the document on screen. Now a recessed
action strip (surface2 under the cards' surface, smaller type scale, no accent fill at rest so it
cannot compete with the primary "pick a type" action), each with a line naming the scope out loud.
- **"Edit this type…" is now VISIBLE-BUT-DISABLED, not hidden.** Required the renderer to stop
  driving `style.display` and drive `disabled` — markup and renderer had to change together or the
  new copy would be dead code.
- **Latent markup bug fixed:** the button carried a DUPLICATE `class` attribute (`class="btn"` then
  `class="hidden"`); parsers discard the second, so the `hidden` class never applied.
- **Deliberately KEPT the label "+ Add from catalog…"** despite Chris's fair objection that nobody
  says "catalog" out loud — Settings (`settings/index.html:555`) and the shared picker's own header
  (`shared/doctype-catalog.js:67`) use the same words. Renaming one of three places trades a wording
  problem for a consistency problem. The description line carries the plain English instead.

**Step 3 — the fixed-value card is GONE; manual entry moved to the top** (owner ask).
A large accent card sat under the page on EVERY field reading "Always the same on every document?
→ Set a fixed value" — i.e. it advertised the one route that teaches NO POSITION as the convenient
one, at the exact moment the operator decides how to teach the field. Now a quiet link-weight
control at the top of the step. Choosing it shows what the choice costs before the box is typed
into. Issuer prompt + intro copy now say the value may be drawn ANYWHERE it is printed, **the
footer included** — an operator who believes the letterhead is the only valid place is exactly the
one who types the name instead. The hatch hides while a read is in flight or the typing box is
open; "Cancel" is now "Draw it instead". The typed input's programmatic focus goes through the
shared `focusField` repair (forward convention).
- **NOT CHANGED: what a typed value persists.** Still `status:'fixed'` → the same `fixed_value`
  path. Changing that is extraction-layer and needs its own gate. See the new backlog entry.

### `658b542` — backlog entry for the typed-value storage question

### `6acf4e2` — finish the group: straighten remap · stamp placement · ageing chip · TM tightness

**1. THE STRAIGHTEN REMAP FIX (owner-reported).** Owner: *"straighten on template works but the
values and labels don't remap."* Correct, and my first commit was the reason: `redrawTplCanvas`
**returns early when the registration preview is on**, and `drawRegistrationPreview` is a second
draw path with its own boxes — the stored rects AND the positions Python resolved — all in raw
coordinates with no frame awareness. That is the overlay in use when actually checking a template,
so from the operator's chair nothing remapped. Every box in that path now maps into the displayed
frame, including the resolved `[x,y,w,h]` arrays and the label anchors.
**Two consequences it exposed, both load-bearing:**
- `currentTplPageB64` fed the resolver **whatever `tplImg` was showing**, which after Straighten is
  the straightened bitmap. The preview would have answered "where does this land on a picture that
  never exists in production", and its results would then have been **double-transformed** at draw.
  Now pinned to the RAW page render (already a data URL, so also one fewer canvas round-trip).
- A straighten toggle no longer re-runs the resolver — one Python call per mapping for zero new
  information (resolution is against the raw page either way).

**2. Approval stamp: placement + size, and the overwrite wart.**
`stampPdf` takes a normalised `box {x, y, w}` with a **TOP-LEFT origin**, matching every other
geometry in this app; the flip to pdf-lib's bottom-left origin happens **once, inside `stampPdf`**,
not leaked to callers. The whole stamp scales from the chosen width (headline, meta lines, panel),
so "resize to fit a blank area" yields a readable stamp rather than 9pt text in a large box.
Placements are **clamped at render**, so one saved on A4 cannot push the stamp off another size.
- Settings → Licensing gains an **"Approval stamp"** card (same entitlement visibility as
  `#wf-section`): 3×3 position picker, size slider, A4-proportioned live preview **in the same
  coordinates the PDF uses**, so there is no second coordinate system to keep in step.
- Stored as ONE `stamp_placement` settings row. **UNSET IS MEANINGFUL** — it means the built-in
  top-right corner — so Reset CLEARS the value rather than writing a corner-shaped one, and anything
  malformed parses back to unset. A bad setting must never stop a decision being stamped.
- **The two-approvals-share-one-path wart is FIXED**: stamped copies are per-route
  (`…APPROVED-stamped-r12.pdf`), route id sanitised against traversal. **Legacy copies keep
  resolving** — verified that nothing recomputes the path to FIND a file; every reader uses the
  stored `route.stamped_path` (`api/handler.js:727-735`, `workflow/handler.js:152-157`).

**3. Workflow ageing chip** — the night-sized half of "due dates + nudges". Open routes
(`pending`/`claimed`) show "waiting 5 days" past a 3-day threshold, warming to the warn tint at a
week, switching to weeks past a fortnight. **No schema, no scheduler, no new notification event
types** (the toast event list stays PINNED and untouched). Silent under the threshold on purpose.
`created_at` is SQLite `datetime('now')` with **no zone marker** and is parsed as **UTC
explicitly** — reading it as local time would shift every age by the local offset.
- Core mailbox only. **The detached client has its own renderer and did NOT get the chip.**

**4. Template Manager tightness.** `search_expansion` was a bare slider labelled "Expansion" —
adjustable without being understandable. It now names both failure modes per band (too tight clips
the value; too loose swallows the neighbouring row or column). The Saved Mappings table shows WHEN
each mapping was last tested — a green read from before the box was last moved is not evidence the
box works now, and there was no way to tell.

---

## Backlog accuracy — entries that were WRONG or STALE (all corrected in `pendingfeatures.md`)

| Entry | What the file said | Truth (verified at source) |
|---|---|---|
| Core Search re-skin | open | **SHIPPED** `d7ab2e2` + `23109fb`; `search-components.css` exists with chips/segmented/rolechip |
| Document-detail DTO | open | **SHIPPED** `b747676`; pinned in `test_search_detail_depathed.js` |
| Focus-fix field sweep | open | **SLICE 1 SHIPPED** `01a2a43`; the 42-site `.focus()` audit + static pin remain |
| Custom approval stamp, step 1 | "the resolution note … not printed on the stamp" | **FALSE, and never true of the shipped code** — `pdfStamp.js:87` wraps it, `:111-114` draws it, `workflowService.js:319` passes it |

---

## Verification state — BE HONEST

**Ran and green:**
- `src/services/test_pdfstamp.js` — **9 → 13 checks** (added: box placement + off-page clamp;
  elision inside the limit `stampPdf` enforces; per-route paths + traversal; defensive placement
  parsing). All pass.
- `src/services/test_workflow.js`, `test_workflow_snapshot.js`,
  `database/modules/test_workflow_route_rules.js`, `test_workflow_paid_heal.js`,
  `src/modules/workflow/test_workflow_ipc.js`, `src/services/test_entitlement.js` — all pass.
- `src/windows/settings/test_settings_wiring.js` — all pins pass.
- Parse checks on every edited renderer/main/preload; `<div>`/`<button>` balance on both edited
  HTML files; isolated unit checks of `_wfAgeDays`, `tplTestAge`, `elideNotes`,
  `parseStampPlacement`, `stampedPathFor`; a real 3-way PDF stamp render (legacy / placed /
  off-page) written to disk without throwing.

**NOT verified — nothing in this session was smoke-tested in the UI by me.** Specifically:
1. **TM Straighten + "Preview registration" together on a tilted sample** — the exact combination
   that was broken. The fix is reasoned and the primitive is pinned, but the remap has not been
   seen working.
2. **A box drawn while straightened, saved, then re-opened** — i.e. the back-transform actually
   landing in the right place on the raw page, and the frame-guard refusal firing when it should.
3. **The child-window dock** — no chip has been seen. (The `modal`-is-always-false finding is
   verified at source; the chip rendering is not.)
4. **Both teach screens** (Step 2 action strip, Step 3 top-of-step manual entry).
5. **The stamp placement preview against a real stamped PDF.** The preview approximates the
   stamp's HEIGHT from its width (`min(30, w*62)%`) because the real stamp sizes its block from its
   CONTENT — so the preview rectangle is indicative, not exact.
6. **The ageing chip** — needs a route older than 3 days in the live DB to render at all.

**No corpus/harness run was performed and none was needed:** no extraction-layer code was touched.

**Mid-session corrections I made to my own claims** (do not re-derive them wrongly):
- My first Straighten commit was **incomplete** — it missed `drawRegistrationPreview`. Owner caught
  it. The lesson generalises: `redrawTplCanvas` has THREE exits (`tplPreviewMode`,
  `tplLandmarkMode`, then the normal path) and a change to "the overlay" must address all of them.
- I initially planned to BUILD the stamp note (step 1 of that entry). It already existed.

---

## FIRST ACTIONS for the fresh session

1. **Owner smoke of the two visual unknowns** (items 1-2 above): open Settings → Templates, load a
   tilted sample, tick "Preview registration on this doc", press Straighten, confirm the boxes track
   the page; then draw a box while straightened, save, reopen, confirm it sits on the right words.
2. **Rebuild the installer** if a test pass is wanted — the current one predates everything from
   `ebd2096` onward, including this whole session.
3. **The flip queue is unchanged and still waiting** (nothing was flipped this session):
   `TEMPLATE_IDENTITY_ON_PAGE` (Oracle SIGN-OFF-W/COND, all six conditions applied, ready),
   `TEMPLATE_FIXED_SEED_AGREEMENT_KEEP`, `TEMPLATE_FORMAT_FAIL_YIELD`, `CUSTOMER_PO_LABELS`.

---

## Deferred (designed / diagnosed, NOT built) — with the load-bearing conditions

- **Typed teach value captures no location** (new entry, top of `pendingfeatures.md`). The UI half
  shipped; the STORAGE question is open. `showFixedInput` still writes
  `{value, target:null, anchor:null, status:'fixed'}`. **Measure first:** count how many existing
  `fixed_value` rows would have been LOCATABLE on their own sample page — that single number decides
  between "find the typed string in the page geometry and store the box" (direction 1) and the
  confidence/scope work (directions 2-3). This path has form: the wrong-company misfile, the `'VAT'`
  caption freeze and `'Serial No:'` are all the same shape — a positionless value frozen from a
  sample of one, asserted at 95.
- **Pre-normalisation cross-check** (new entry). Gate C (`engine.py:4106-4117`) compares the
  COMMITTED value against whitespace-split page tokens, so `PI/26/6000` on the page can never match
  a normalised `P1266000`. **The interior-slash strip site is NOT located and the entry does not
  claim one** — every normaliser found is edge-anchored (`keyword.py:241`, `suffix_reconcile.py:48`,
  `template_mapper.py:355`, `text_normalise.py:38`, `validator.py:285`); the one unanchored stripper
  (`anchor.py:2666`) builds a comparison target, not a committed value. The exhibit ALSO carries an
  `I`→`1` misread no normaliser explains. **First step is an SFDEV trace of that document**, not a
  design. Also confirm `FILING_VALUE_SANITY_FLAGS` is ON in the live DB (CLAUDE.md records it OFF,
  but the owner's screenshot shows the note firing).
- **TM per-mapping tightness knobs** — registration on/off, label-lock strictness,
  absolute-vs-relocate are **NOT columns** on `template_field_mappings` (which carries only
  `anchor_text`, the two rects, `offset_*`, `ocr_type` (retired), `search_expansion`, `region_hint`,
  `enabled`, `last_test_*`). Surfacing them needs a migration AND making the extraction rungs honour
  a per-mapping override. **Extraction-layer, needs Oracle + a corpus gate. Not UI work.**
- **Stamp per-DECISION override** (drag/resize on page 1 at decision time) + whitespace auto-suggest.
  The per-install default covers the common case, so this is now a refinement.
- **Focus-fix sweep steps 1 + 3** — the 42-site `.focus()` audit and the regrow-proof static pin.
  eric called it multi-session.
- **Ageing chip in the detached client** — core-only today.
- **Workflow due dates** — full `due_at` schema + scheduler + overdue surfaces. Extending the toast
  event list needs its own Oracle pass (the list is PINNED).
- **R2 cohort pick admission** — left in place; it is extraction, not UX, and keeps its revival bars.

---

## Needs the USER

- The smoke tests in *Verification state* (items 1-6), especially 1 and 2.
- **No advisor/Oracle pass was run on any of this session's work.** It is UI and copy only, with no
  extraction-layer change — but the child-window dock touches window lifecycle and would normally
  see eric. Flagging rather than assuming.
- Decide whether the stamp placement default should ship SET (a chosen corner) or UNSET (today's
  behaviour — the built-in top-right).

---

## Key facts / paths

- **Live DB:** `%APPDATA%\ScanFinder\docusnap.db`. No migration was added this session (latest
  remains 60). New setting key: `stamp_placement` (plain settings row, admin-gated write, not in
  the protected-key list).
- **A DEV APP IS RUNNING** — `npm start`, several `electron.exe` processes. It carries every change
  in this session. **Renderer edits need the window REOPENED; main-process edits need a full app
  restart** (`src/main.js` and `src/preload.js` were both edited).
- **Run the tests** (Electron-as-Node — plain `node` fails on native ABI, and **without
  `ELECTRON_RUN_AS_NODE=1` the Electron binary launches a GUI and hangs until timeout**):
  ```
  ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/services/test_pdfstamp.js
  ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/windows/settings/test_settings_wiring.js
  ```
  (`test_settings_wiring.js` happens to run either way; the rest do not.)
- **Kill switch added:** `CHILD_DOCK=0` — restores `minimizable:false` on parented child windows.
- **Advisors used:** Chris The Customer and a UI design pass, both as `general-purpose` with a
  persona + the matching skill, both ADVISORY and both vetted against the code before applying.
