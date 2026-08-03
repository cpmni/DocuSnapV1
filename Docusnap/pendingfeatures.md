# Pending Features & Deferred Work

> Running backlog. When a feature/fix is discussed but NOT implemented right away, add it here with
> the notes/details agreed + anything pertinent (symptom, code pointers, the fix direction, gates,
> and any advisor rulings). Newest at top of each section. Remove an item when it ships (note the commit).

---

## 2026-08-02 OVERNIGHT (autonomous, owner asleep) — SHIPPED / DARK / DEFERRED
Owner directive: build everything buildable, commit each, push at end, flip ON when the advisor+Oracle
+ gate pass green. Then a christest walkthrough. Advisors used: eric (search/UX cluster), reggie
(ref-completion), gary (type-note + bleed). All fixes gated; each commit self-contained.

**SHIPPED + FLIPPED ON (gate-green):**
- **Crop right-grow `ANCHOR_VALUE_RIGHT_GROW`** — `13dbe44`. Proven heal on the Northgate PO demo
  (`stress_test/demo_rightgrow_ab.js`): PO-5898→PO-58987 (HEAL vs GT), 0 collateral. Setting-bridge
  `_anchorCropEnv` (4 spawn sites) + Settings→Processing toggle. Flipped ON in the live DB.
- **Label-tail clamp `ANCHOR_LABEL_LEFT_CLAMP`** — `336585a`. Oracle had already GO'd the flip;
  demo-verified (Saltmarsh PO9974A9C→PO-27425 HEAL, 0 collateral). Same bridge + toggle. Flipped ON.
  NOTE: the harness can't test the LIVE combination of both crop settings ON (it reads env, not the DB
  settings); the corpus reads are crop-OFF. #499 (PO-58987 chop) surfaced crop-OFF in the harness — it
  is the right-grow class and heals with the live flip. Watch W1-W3 (see the clamp section below).
- **Light⇄Dark quick-flip remembers the selected theme** — `418cf80`. theme.js records a per-family
  anchor; the flip round-trips (slate⇄midnight⇄slate, warm⇄dark⇄warm).
- **Search preview honest error state (eternal-spinner cure)** — `bf9fe90`. selectDoc guarded +
  stale-selection token; mailbox/workflow pre-fetches dropped; "No handler registered" → restart msg.
  Pin `test_preview_error_state.js`.
- **Home "Open Mailbox" lands on the mailbox** — `b67688a`. New open-search-window-at channel
  (NOT the taken get-search-target); SearchMailbox.open() set-true idempotent.
- **Core Search re-skin to the client look** — `d7ab2e2`. New `search-components.css` (tinted chips,
  segmented mailbox, lead search icon, pill buttons) over the existing class hooks — no logic/IPC/id
  change. Chris visual round pending (christest).
- **Focus-repair sweep SLICE 1** — `01a2a43`. `shared/dialogFocus.js` (focusField + idempotent
  confirm/alert wrapper); preload `ensureWindowFocusAsync`; workflow Reject note routed; Search/Main/
  Teach armed (were unarmed). Pin extended (+recovered 4 drifted runZoneOcr checks). Full 42-site
  `.focus()` audit + regrow-proof static pin = MULTI-SESSION (per eric).
- **delivery_number breadth + Service Worksheet preset** — `b4105b7`. ~25 delivery-specific captions
  (excludes greedy Note No/Ref No); type-scoped worksheet preset. realdoc M=0, zero new delivery
  regression.

**BUILT DARK (flip pending):**
- **Digital↔scanned bleed — `SAME_SUPPLIER_LAYOUT_GATE`** — `5af13cf`, default OFF, byte-identical.
  gary-designed elif on the same-supplier authoritative rigid read (require caption at taught position,
  looser relocate budget + offset-present precondition; demotion-only). Pin
  `test_same_supplier_layout_gate.py`. **FLIP PRECONDITION: Oracle round (narrows a Tier-A invariant)
  + realdoc M=0 with the switch ON + gary's two-direction integration pin. Do NOT flip yet.**

**DEFERRED with a vetted design (build-ready, owner-gated or needs a live test):**
- **Type-note placement under Document Issuer** (gary): Route 1 (renderer-only display relocation to a
  `.type-scope-note` band by `#doctype-select`, keeps the persisted note on the carrier for the
  auto-file hold, copy-lockstep pin) OR Route 2 (a `note_scope:'type'` marker + migration). Route 1
  recommended for its zero-migration safety. NOT built (budget). engine.py:5889 `_flag_type_ambiguity`.
- **Child-window minimise → in-app dock** (eric): PREMISE CORRECTION — NO current child is modal
  (main.js:480), so no modality surgery. Slice 1 = dock infra + child-minimise/restore-child IPC +
  the trigger (prototype the createWindow `minimize` intercept; fall back to an in-app control if the
  skipTaskbar stub flashes — needs a live Windows test). SEAM: main-hides-to-tray orphans a docked
  child — handle first. restore-child must verify sender===main + name∈CHILD_WINDOWS. NOT built (the
  trigger needs a live flash-test I can't run headlessly).

## 2026-08-03 (day, owner present) — template fine-tune SLICE 1 SHIPPED + two follow-ups
**SHIPPED + FLIPPED ON:** the Northgate PO-17039 class (template_mapping tight-crop reads 'PO-17039'
as '»0-17039'@90, WINS over correct keyword 'PO-17039'@93, → '0-17039'@69 flagged). Verified LIVE in
the diag log. 007+reggie+gary → Oracle SIGN-OFF-W/COND (oracle_log 2026-08-03).
- **`PREFIX_GARBLE_ADOPT`** (`0d747d0`, setting `prefix_garble_adopt`, flipped ON) — a SECOND adopt
  fingerprint in the S-B length-witness arm: `suffix_reconcile.prefix_garble_fingerprint` (garbled
  leading prefix, exact tail preserved) gated by `engine._strong_single_prefix` (`all_prefixed` +
  ≥0.90 + ≥5). Adopts the confirmed-prefix peer's value. Pins: test_suffix_reconcile §4 +
  test_ref_length_outlier §7. Realdoc OFF==ON byte-identical. Bridge `_reconcileEnv` + Settings toggle
  (`4f29fc0`). Do NOT co-ship gary's S-C Stage-0.5 extension (Oracle C4, order collision).
- **SFDEV lost-reason** (`45de1af`) — a LOST rung now names the incumbent ("kept 'X' from
  template_mapping"); state-only, no-overclaim pinned.

### ✓ RESOLVED (for the batch gate) — harness now fires Stage 0.5 via the reprocess manifest (2026-08-03)
`realdoc_regression.js` now passes the per-doc `--reprocess-manifest` (`17d7480`), so the gate fires
Stage-0.5 template_mapping like the app. PROVEN: the `PO-2590`/`PO-5898` chops (template_mapping tight-
crop) now appear where the blind harness read the ⊕ anchor. **This immediately re-validated the crop
flips** (right-grow+clamp) that were meaninglessly "byte-identical" on the blind harness: on the
faithful harness, crop-ON vs crop-OFF (both manifest + prefix-garble ON, 503 docs) = **+3 ref heals
(#483/#499/#503), ZERO new regressions**, ref 96.4%→97.0%. Honest re-baseline (previously masked): ref
96.4% base, 12 would-auto-file-wrong. RESIDUAL (minor): single-doc `trace_one` still reads the anchor
(the batch path fires template_mapping, the single-doc filed-copy path doesn't — a state/path quirk, not
the gate). NEW FINDING (fine-tune arc): the diag's `doc_context` shows the app matching a **"Stonegate
Property Mgmt" template to Northgate docs** — a cross-supplier logo-phash collision; the wrong
template's mapping box is a prime garble source. Investigate under the template fine-tune arc.

### HARNESS-FIDELITY GAP — the corpus gate is BLIND to the template_mapping-garble class (2026-08-03)
`stress_test/realdoc_regression.js` + `trace_one.js` do NOT fire Stage-0.5 `template_mapping` — on the
Northgate PO-17039 working copy they read the ⊕ anchor (anchor_inline@97) while the LIVE app fires
template_mapping and garbles (@90, confirmed in the diag). So EVERY corpus gate this session proved
"no regression on what the harness sees" but is blind to template_mapping heals/regressions — those
are only observable live. Root cause UNKNOWN (template match/registration state? working-copy render
vs raw? the app reprocess passes something the harness snap() doesn't). FIX DIRECTION: make the harness
faithfully reproduce the app's Stage-0.5 (diff the app reprocess spawn args in processing/handler.js vs
the harness snap()), so the template fine-tune arc can be gated by the corpus, not just the live app.
High value — this blind spot undermines every template-class gate.

### ✓ SHIPPED slice 1 (prep-only, ON) — oscar crop-fix B; slice 2 (whitelist) + #494 deferred (2026-08-03)
`STRUCT_CODE_READ` (`d2b8937`, setting `struct_code_read`, flipped ON). oscar+007+gary → Oracle
SIGN-OFF-W/COND (oracle_log 2026-08-03). Slice 1 = PREP ONLY: cap-height upscale
(`region_core._ink_band_height` → scale clamp(34/ib,1,4)) + synthetic read-time quiet-zone (median-grey
border, NOT a wider window) + DROP SHARPEN, in a struct rung PREPENDED to the shared ladder that falls
through to today's rungs on a sub-floor read (Oracle C2). NO whitelist (Oracle fork-ruled it out — the
gateless Stage-0.5 path would auto-file a whitelist-snapped clean-shaped WRONG code). Gate (faithful
manifest harness, OFF vs ON, crop-flips-ON baseline): +1 ref heal (#218 digit-sub read RIGHT),
would-auto-file-wrong set IDENTICAL (true M=0), zero accuracy drop, no new regressions; #494 unhealed but
UNCHANGED (fall-through). Pins test_struct_code_read.py.
**DEFERRED:** (1) **slice 2 = the char whitelist** — must carry its OWN checkpoint (a differently-prepped
non-whitelisted corroboration OR the learned-shape check), NOT committable on shape_mode='ignore' alone
(Oracle C4). (2) **#494 'PO-66063'→'PO-68063'** interior digit-sub — prep alone can't cure; slice-2
whitelist or a second-render witness. (3) **real-asset functional PIN** — capture a ~13px garbling crop.

### oscar crop-fix B — the ROOT fix for the tight-crop garble (007-recommended, incl. po_date)
The garble is a READING failure (007): a ~13px target crop with no left quiet-zone + over-sharpen reads
'PO'→'»0' AND '19'→'09' (doc-18 po_date is ALSO wrong: 09-06-2026 vs 19/06/2026 — same class, but a
date has no prefix so PREFIX_GARBLE_ADOPT can't touch it). Fix B (oscar owns the recipe): cap-height
upscale (~3× for a 13px crop, target ~30-40px), a READ-TIME quiet zone (pad the pixels fed to
Tesseract, NOT the stored box), a char whitelist for structured code types ('»' becomes impossible).
ORDERING SEAM (007): B lands BEFORE any crop-window/geometry change, measured on the IDENTICAL box. B
is the root (cures every code crop incl. no-peer + date cases); PREFIX_GARBLE_ADOPT is the net. Bring
in oscar → Oracle.

---

## UX / product

### Light⇄dark quick-flip forgets the selected theme — OWNER 2026-08-02 (next session)
**Repro (owner, live):** with a non-default theme selected, the quick Light⇄Dark toggle (account
menu + rail-foot) goes dark, then flipping back lands on the DEFAULT theme (Warm Paper) — the
user's chosen theme is lost. **Expected: the toggle alternates between the CURRENTLY SELECTED
theme and a dark theme, round-tripping back to the selection.**
**Likely mechanism (unverified — verify at source):** the flip handler writes a literal theme name
both ways (`set-setting('theme', 'dark')` / back to the default constant) instead of remembering
the pre-flip selection. Leads: `src/windows/shared/theme.js` (sets `data-theme` + `data-mode`,
`DARK_THEMES` gates the family), the account-menu + rail-foot toggle wiring, `theme-changed`
broadcast.
**Fix shape (design in-session):** remember the last LIGHT theme and last DARK theme
(settings-persisted pair) so the flip maps selection⇄dark-counterpart and back — e.g. Nordic
Slate ⇄ chosen dark, seasonal themes included; minimum bar = flipping back restores the pre-flip
theme exactly. Respect the existing `data-theme`+`data-mode` split (memory
`project_theme_system_gotchas`).

### ✓ DONE — Teach clipped-code reconcile, Slice 2 (the DRIFTED-sibling path)  (2026-07-31, `a4fa107`, ON)
- Slice 1 (`f2e5ee3`/`c70bae7`, `TEMPLATE_INLINE_CODE_RECONCILE`) fixed the FAST path; Slice 2 (`a4fa107`,
  `TEMPLATE_INLINE_CODE_RECONCILE_DRIFT` default ON) extends the reconcile to the DRIFT/relocate path
  (`_geometric`). Routes through `_inline_code_reconcile` wholesale (robust page-wide source — Oracle SEND-BACK of
  the partial `located`-based version, which could DEGRADE a correct geometric read). Gate: `drift_forced_probe.py`
  10/10 + 0 degraded + 3 real drift-garble fixes; realdoc DRIFT==baseline; 4 drift unit/PIN. Memory
  `project_teach_inline_code_reconcile_20260731`.
- **Perf follow-up (optional, still open):** the reconcile does a page-wide locate per clean CODE read; it's `line_cache`-shared
  with the registration landmark fit (≈0 extra OCR on registration-enabled docs), but a doc with a taught code
  field and NO landmarks pays one fresh page-wide OCR. If profiling ever flags it, gate the cross-check on a cheap
  pre-signal (e.g. the local pre-pass `inline_value` disagreeing) before escalating to the page-wide locate.

### ✓ FIXED (pending owner smoke) — Teach wizard label non-recognition  (2026-07-30)
- **Root cause (frame-math bug):** `cropB64` sends the label band NATIVE (ds=1.0 under `TEACH_NATIVE_CROP`),
  but the label-detection code at `src/windows/teach/renderer.js:787/803` recomputed `ds=OCR_TARGET_H/bandHpx`
  (~0.42) WITHOUT honouring `TEACH_NATIVE_CROP` — so `cY` (the value centre fed to `nearestRowTo`) and the
  label word-box→page-norm conversion were scaled ~0.42× against words that are in NATIVE crop px →
  `nearestRowTo` looked in the wrong place → no row → "No label found here" even with the caption right beside
  the value (the Saltmarsh "Order Date" miss). FIX: both `ds` now `TEACH_NATIVE_CROP ? 1.0 : (…)`, frame-
  consistent with the crop. `nearestRowTo`/`nearestLeftCluster` then correctly narrow a wide band (heading +
  caption) to the caption row, so cause (2) is subsumed.
- **Smoke:** reopen Teach on the Saltmarsh PO → draw the Order Date value → "Order Date" should now be detected.
  If a residual remains on a badly-skewed scan (cause 3), look at the band slice next.

### ✓ SHIPPED — Teach wizard: only-current-box overlay + Straighten text button  (2026-07-30, owner)
- Overlay now draws ONLY the field being taught (removed the done-fields loop in `redrawCanvas`); the last
  box clears once the final field confirms (`advanceField` parks `fieldIndex` past the end → `curField()`
  undefined). Display-only — `state.results` untouched.
- The teach `∞` straighten control replaced with Review's icon + "Straighten" text button (`#tz-deskew`,
  auto-width; keeps the `.active` pressed style). `src/windows/teach/{renderer.js,index.html}`. Needs app reopen.

### Template Manager — Straighten button  (added 2026-07-30, owner)
- **Wanted:** a Straighten control in the Template Manager preview (same as Review/teach) so a tilted
  sample can be levelled before drawing/checking anchor→target boxes. `src/windows/settings/` (Template
  Viewer `#tpl-dock`) + reuse `get-page-deskew` + the AnchorLabel transform (as teach does).

### Template Manager — visualize + tighten anchor boxes  (added 2026-07-30, owner — EXPLORE)
- **Owner questions (answered inline in chat 2026-07-30):** do TM-drawn boxes validate on import? what is
  the TM for? should the drawn zones be VISIBLE on a doc (like Review's "show where it reads") so the user
  sees where the system snaps? what settings tighten a frequently-misfiring box?
- **Direction to design:** (1) a "show where it reads" overlay in the TM preview (reuse the Review overlay
  path + `template_mapper` located-zone output); (2) per-mapping tightness controls (padding/expansion,
  registration on/off, label-lock strictness, absolute-vs-relocate) surfaced per field; (3) a per-box
  test-on-this-sample readout (already partly in `recordMappingTest`). See the chat exploration for the
  full write-up + the FACT-checked answers on how mappings/anchors are actually used at extraction.

### ✓ SHIPPED — Import "couldn't be read" banner: details + dismiss  (2026-07-30)
The amber Import banner now (1) reworded "held for retry (not filed, not lost)"; (2) a **Details** toggle
lists each held doc + WHY (`documents.error_message`, via the existing `getStuckDocs`); (3) a **dismiss (×)**
per-session acknowledge that re-surfaces only when MORE docs fail (`_stuckDismissedAt`). Renderer + markup +
CSS only (`src/windows/main/{renderer.js,index.html}`); errored docs still hold at `status='error'` (never
lost) — dismiss is display-only. Needs an app reopen to render.

---

## UX / product (continued)

### Catch-up filing ("file the rest") — SLICES 1-3 BUILT (dark), SLICE 4 GATES + FLIP REMAIN
**2026-08-01 evening: slice 3 BUILT** (server accept/undo + renderer consent UI; all dark behind
`scope_sweep_enabled` OFF + env `SCOPE_SWEEP`): `sweep-scope-accept` re-validates EVERYTHING
server-side (status/scope/workflow + candidacy FINGERPRINT + the same `_evaluateSweepDoc`
re-run) then files through the ONE shared `reviewService.confirm` with INTERNAL
`{via:'scope_sweep'}` (4th arg — never payload-suppliable; claim stamps `confirmed_via`;
saveCorrections SKIPPED for machine confirms = no hint inflation; learn-on-commit self-guards) ·
`sweep-scope-undo` (server-verified `confirmed_via='scope_sweep'` only → deconfirm, via cleared,
filed copy kept for in-place re-file) · consent bar `#sweep-consent-bar` (offer/filing/done
states, per-doc untick, Review-them queue filter, Not-now per-scope dismiss, Undo all,
kept-back reason chips) · triggers: single confirm + prefix-outlier resume + File-All dominant
scope (debounce 2.5s) · audits scope_sweep_offered/accepted/undone. PINs green:
`database/modules/test_confirmed_via.js` (claim stamps via / human NULL / deconfirm clears /
pre-mig-57 guard) + all seam suites (scope_trust, learn_on_commit, sweep_predicate,
reextract_merge). **SLICE 4 REMAINS before flip: fixture integration gate + demo-corpus gate
(design §test plan) + realdoc OFF assert, then flip `scope_sweep_enabled` per install. Owner
can pre-trial with env `SCOPE_SWEEP=1` (harness lever, not the flip).** gary's header-band
witness design (2026-08-01, awaiting Oracle) slots into `_evaluateSweepDoc` as an AND-only
exclusion later — not part of slice 4.

Original design record (2026-07-31):
- Owner idea: after K same-scope manual confirms, remaining queue docs (correct values, stale
  scores) re-gate against the warmer learning and batch-file behind a per-scope consent
  banner+list with per-doc untick. barry (L3, near top of office backlog) → gary (two-tier
  predicate: free re-gate + imageless consistency re-score; memory-held; files STORED rows via
  reviewService.confirm bulk) → **Oracle SIGN-OFF-W/COND** with two rulings (sweep confirms
  EXCLUDED from graduation via new `confirmed_via` column, values-learning flows;
  banner-consent v1, silent File-All absorption rejected) and two seams both advisors missed
  (corrections-SPAN revocation so human-only windows don't disarm self-revocation; candidacy
  extractions FINGERPRINT so consent can't go stale). **Full agreed design + build slices:
  `docs/designs/CATCHUP_FILING_2026-07-31.md`.** Build in a fresh session, slice 1 first
  (migration + scopeTrust rework — feature-independent).

### Child-window minimise → a visible, pronounced dock (not the lost corner box) — OWNER 2026-08-02
**Owner ask:** re-enable minimise on the child windows (Review/Settings/Search/Teach/dev-inspector).
They used to minimise to a tiny stub at the desktop's bottom-left that vanished into the background and
was hard to find. Want: minimise them to the **bottom-left of the MAIN app**, staying **visible and
pronounced** so they're easy to spot and reopen.
**Why it's off today (repro/root):** parented child windows are created with `minimizable:false` FORCED
(`src/main.js:583` — `...(parentWin ? { minimizable:false } : {})`) precisely BECAUSE they are
`skipTaskbar:true` (`main.js:585`), so a native minimise sends them to the legacy Windows corner stub
with no taskbar entry — "an easy way to 'lose' the window" (comment `main.js:581-583`; same hazard noted
for the main window at `main.js:475-477`). So the feature was deliberately disabled, not missing.
**Leads / design direction (eric to vet; NOT built):**
- Don't use native minimise for a `skipTaskbar` child. Instead `win.hide()` and render an in-app
  **restore dock** — a pronounced pill/chip anchored bottom-left of the MAIN window (`#topbar`/main
  renderer), one per hidden child, click to `show()`+`focus()`. A restore path already exists:
  `createWindow` restores+focuses an existing window when its launcher is clicked (`main.js:548`,
  `475-477`).
- **Modality wrinkle:** most children open MODAL to the parent (`modal=!NON_MODAL_CHILD.has(name)`,
  `main.js:574`) — a modal child blocks the parent, so "minimise and go use the main app" only makes
  sense if minimising also drops modality (or the feature is limited to non-modal children). Decide
  which.
- Alternative already half-built: the **system tray** minimise-to-background path (`main.js:630-697`,
  Stage 1/2) — could dock hidden children there instead of/as well as an in-app dock. Owner wants
  IN-APP + pronounced, so the bottom-left dock is the primary; tray is the fallback discussion.
- New IPC: `window-minimise` currently exists (`main.js:1386`) for the main window; a child variant
  would hide + notify the main renderer to add/remove its restore chip.

### Teach "Confirm what I read" bar — two filled buttons, ambiguous accept — DESIGN PLAN (OWNER 2026-08-02)
**Owner repro (screenshot):** after drawing a field value in the teach wizard the confirm bar shows
TWO large filled-orange buttons — "Looks right →" (accept) AND the selected direction toggle "← Left"
— so it isn't obvious which one accepts-and-moves-on. Owner wants a sleek, smooth redesign.
**Root (verified):** `src/windows/teach/renderer.js` — the Left/Above direction toggle renders the
SELECTED direction as `btn primary` (`:687-688`, `dir==='left'?'primary':'ghost'`), i.e. the same
filled-primary style as the accept button `rb-yes` "Looks right →" (`:692`). All controls sit in one
flat row (`:686-694`: accept · Redraw value · Redraw label · "Label is:" Left/Above) with no visual
separation of VERIFY controls from the single ACCEPT action → two primaries compete for the eye.
**Owner's desired flow:** keep the confirm LABEL + VALUE on the same header (`setPrompt('Confirm what I
read for', f.label)` `:671`, and the "Value: … · Label: … (left of the value)" readout). Make it an
obvious **check-FIRST-then-accept**: (1) check the VALUE is right, (2) check the anchor is LEFT or
ABOVE, (3) THEN one clearly-primary click if you agree.
**Design plan (to vet, NOT built):**
- **Exactly ONE filled primary** on the bar = the accept ("Looks right →" / "Yes, save this field →").
  Everything else steps down to secondary/ghost/segmented.
- **Left/Above = a SEGMENTED TOGGLE** (one pill control, two segments, selected segment softly
  highlighted — NOT `btn primary`). It reads as a CHOICE, not a competing action. Drop the arrow-key
  orange fill.
- **Two zones, ordered check → confirm:** a VERIFY group (value read-back + label + the direction
  toggle + subtle "Redraw value / Redraw label" as text-links or small ghost buttons) then, visually
  set apart (right-aligned or full-width below), the single ACCEPT CTA — so the eye flows value →
  direction → accept.
- Keep label+value in the header per owner. Sleek: quiet secondaries, one confident primary, a little
  breathing room between the verify group and the CTA; consider a faint "① check  ② confirm" cue.
- **Advisor gate before build:** chris-the-customer (his exact domain — decision ambiguity / which
  button) + barry (UX shape) → eric (teach renderer) → Oracle. Renderer-only; no extraction impact.

## Extraction / accuracy

### Cross-contamination residual — Stage-2 `_qualify_against_format` — DO-NOTHING (gary+Oracle, 2026-07-30)
- **Resolved understanding (Oracle traced it):** the Stage-4.5 fix (`SHAPE_WITHHOLD_SUPPLIER_SCOPED`, default
  ON, engine.py:4421/4631) closes the keyword/rigid path. The feared Stage-2 `anchor_crop` null is **largely
  already handled**: `method='anchor_crop'` is set at `anchor.py:586` only AFTER passing `_qualify_against_format`
  at `582`; a clean stranger crop is nulled at **582** (the ENTRY to the relocate/registration recovery chain),
  and the located case is **already resurrected** at `anchor.py:1102-1104`/`1175-1177` by the same
  `_digit_free_on_digit_field`/`_partial_of_uniform_shape` predicates (flagged at Stage 4.5). So `anchor_crop`
  is NOT the danger the earlier note claimed.
- **The genuine residual is a NARROW sliver:** `method='anchor'` text-fallback (+`anchor_crop_recovered`) —
  label readable as a text line but NOT locatable as a box, relocate/registration failed, field `_xsupplier`.
- **Why DO-NOTHING (gary designed a fix; Oracle SIGN-OFF-W/COND → build DARK / fallback DO-NOTHING):** the fix
  (an `xsupplier_lookup` companion threaded to `anchor.py:1253`, keep-clean-reject-garble via the readability
  predicates) is sound + fail-safe (kept value → Stage-4.5 flag → never auto-files), BUT (a) reward is the
  narrow text-fallback sliver only; (b) a kept stranger ref WINS Tier A (engine.py:3552, `located` includes
  `'anchor'`) and DEMOTES a would-be keyword auto-file to a flagged review showing a WRONG value on disagreement
  — a real auto-file-rate regression (never a silent misfile); (c) the FIRING path is CORPUS-INERT (no taught
  anchors in the born-digital harness; real anchors belong to confirmed suppliers), so it can't be validated —
  Oracle's flip gate needs a constructed taught-anchor `_xsupplier` case on the BF_/KO_/… corpus. Not worth the
  demotion downside for a corpus-inert edge on a single-supplier install. Revisit only if a real firing case
  appears on a genuine multi-supplier install. gary's full design + Oracle's conditions (A corrected framing /
  B demotion pin / C taught-anchor gate / D `test_doctype_scoped_format_gate.py` direct-call short-circuit /
  E single `(entry,is_xsupplier)` closure) are in the 2026-07-30 chat.

### Letterhead cold-start supplier reader  (confirmed at scale 2026-07-29)
- **Symptom:** cold (first-contact, no learning) supplier identity reads only from a `Supplier:`/`Bill
  From:` caption. The born-digital demo batch measured **~8%** supplier accuracy cold — name-as-text
  letterheads, footer-only issuers, and text wordmarks all return null. Resolves once learning/templates
  exist, so it's a first-contact gap.
- **Fix direction:** the designed-but-unbuilt `letterhead.py` **suggestion-only** reader (largest text in
  the top band → issuer). Only ever needs to carry doc #1. See memory `project_issuer_band_and_letterhead`.

### S1 band-graduate — real fix (column/geometry-aware issuer window)
- **State:** S1 (`TEMPLATE_IDENTITY_BAND_GRADUATE`, commit `958229c`) is built DARK and proven **INERT**
  on its target: two-column `BILL FROM | BILL TO` layouts put the issuer name AFTER the "BILL TO"
  recipient marker in the linearized text, so `_issuer_hint_band` truncates it out → no shed.
- **Fix direction (deferred, gary+Oracle):** a column/geometry-aware issuer window, OR a `BILL FROM`-
  anchored corroboration window that excludes the recipient column (Oracle C2 is the constraint).
  Memory `project_autofile_s1_band_graduate_20260729`.

### delivery_number / worksheet ref completion  (reggie, 2026-07-29)
- delivery_number went 0% → **45%** after adding its `field_patterns` entry — still partial (more
  label/format coverage + the footer/three-party layouts). worksheet `reference_number` stays **30%** —
  the "Worksheet No"/"Job No" labels must be added at the **type-scoped** layer (preset override / ⊕
  teach), NOT the global `_REF_ROLE_CAPTIONS` seed (reggie: global would collide with `job_no` + blast
  every custom ref field).

### ✓ FIXED — Set A warm cross-contamination  (2026-07-30, d9ec7d5 + flip 2b8bdb2)
- Loading live learning dropped new-supplier ref accuracy (Set A ref 84.7% cold → 50% warm). iris PROVED
  (isolation) it was NOT phash/fingerprint/anchor (all falsified) but the learned-shape `formats` store: the
  doc-type-scoped `('')` aggregate on a single-supplier install IS that supplier's ref convention, hard-nulling
  stranger refs at Stage 4.5. FIX (`SHAPE_WITHHOLD_SUPPLIER_SCOPED`, default ON): a `('')`-only verdict FLAGS
  not NULLS; supplier-scoped withhold byte-unchanged. Gate: score_demo A warm ref 55→89%, realdoc M=0. See
  memory `project_shape_withhold_supplier_scoped_20260730`.

### Name-presence veto residuals  (2026-07-31, Oracle-logged with the TEMPLATE_FIXED_NAME_PRESENCE_VETO sign-off)
- **Bank-less collision survives unflagged:** a collision onto a supplier with **no ≥3-word branding
  fingerprint** exits `_flag_branding_conflict` at the own_ratio-None fail-safe (engine.py ~1959)
  BEFORE the un-named branch — a conf-95 wrong `template_fixed` stamp stands unflagged and CAN
  auto-file. The supplier_prints_name ratio is exactly the evidence that could judge it where the
  bank can't — extend the veto ahead of that early-return (own slice + own gate).
- **`_doctype_fixed_supplier` is a DEAD GUARD in production** (found 2026-07-31 building the veto):
  it reads `f.get('key')` but the templates payload carries `field_key` (template_matcher reads
  `field_key`; only the unit fixture uses `key` — test_fixed_supplier_immune.py greens on a shape
  production never sends). The template-MISS fixed-supplier fill + its logo-immunity have therefore
  never fired live. Fixing = one word, but it ACTIVATES a dormant conf-95 stamp path — needs its own
  vet + gate (and the new veto already covers it once live). Do NOT "fix" casually.
- **Ratio-deflation poison loop:** each wrong-scope confirm under a name-printing supplier drags its
  prints-name ratio toward <0.80 and disarms the veto. Clean at flip (Copperfield 1.0/60,
  Ridgeway 1.0/101 — verified 2026-07-31); re-check at any mass-misfile incident.

### Needless-flag session residuals  (2026-07-31 evening; herald+gary+Oracle)
- **Slice C — `_center_in_any` overlap-fraction fix at source** (ocr/tesseract.py:76-85): the PSM-6
  supp merge's center-point dedupe lets an overlapping supp word through inter-fragment gaps →
  DOUBLED tokens in `ocr_text` for every consumer (the manufactured heading garble rung-2 now
  works around). An overlap-fraction test fixes it at source but changes OCR text corpus-wide —
  own session, own full gate. Do not bundle.
- **Demo-corpus identity residuals (pre-existing, measured in `demo_notes_gate.js`):**
  `SaltmarshSeafoods_purchase_order_01` reads issuer `'altmarsh Seafoods'` (leading-glyph clip);
  `_02` reads `Ridgeway Plant Hire` (cross-supplier identity collision). Both identical OFF/ON —
  the branding-primary redesign class (`project_identity_branding_primary_20260728`), plus the
  refuse-note holds on cross-supplier phash locks (herald's 172/175 — CORRECT protective holds).
- Demo gate + probes live in `stress_test/`: `demo_notes_gate.js` (sampled 2/supplier×type — no
  silent caps, logged), `heading_band_probe.py`, `geom_witness_probe.js`.

### Teach label pass-2 follow-ups  (2026-07-31)
- **Pass-1 type-heading gap:** teach still lacks a pass-1 `labelIsTypeHeading` reject (Review ⊕ has
  one at review/renderer.js:6792); pass-2 rejects headings (`isTypeHeadingLabel`), but a clean
  UNCLIPPED pass-1 heading read would still be offered. Port the reject to teach pass-1 + dedup with
  Review's copy (its test regex-extracts from renderer.js — move both onto the shared pure helper).
- **Review ⊕ two-pass adoption:** review/renderer.js ~3771-3786 builds the same open-loop 1.8× label
  band — same decapitation class, unverified there. Adopt the shared clip-gate + re-read
  (`clusterTouchesClipEdge`/`labelRereadRect`/`cropBoxToPageNorm`) in the ⊕ tool.

### ✓ SUPERSEDED for the V-class — clipped-suffix reconciliation SHIPPED ON (2026-07-31 night, `36a4a32`)
- The section below was AMENDED by Oracle after a traced single-doc run showed the 'V-69523' class is
  an `anchor_registration` box misplacement (~76px right of the value start) whose read WINS over the
  discarded correct keyword read — label-confirmed methods are shape-EXEMPT (engine:4692), so neither
  the crop-matte fix (pixels outside the crop) nor the escalation rung (trigger never fires) could
  touch it. Shipped instead: `_reconcile_clipped_suffix` (kill `CANDIDATE_SUFFIX_RECONCILE`, ON) —
  adopt the fuller keyword read of the SAME token from the always-on candidate ledger (suffix +
  digit-identity + shape-pass + confirmed-prefix membership), flag-only without prefix support.
  Gates: OFF byte-identical; ON ref 91.8→94.5%, M 8→7 zero new members, heals #121/123/124/136/137.
- **Amended Oracle rulings (2nd pass):** XRES escalation = DO NOTHING for now (both rungs; revival
  gate = a MEASURED count of withhold-branch abstains-after-GATE_REREAD on the corpus); oscar crop
  fix DEFERRED pending its own measured heal; **NEXT: garbled-anchor remediation sweep** (07-30-era
  taught rows with garbled labels, e.g. Ridgeway 'Inwotce No.' — re-teach or purge, then re-trace
  #121 on a clean anchor); registration.py fit audit ONLY if the ~0.03-norm misplacement survives
  remediation; 225 preset stays PARKED and the CURRENT 225 measurement is CONFOUNDED both ways —
  re-measure only after guard + remediation (added to C7 preconditions).

### Cross-res escalation re-read + "Faster (225)" preset — Oracle-gated plan (2026-07-31 night)
- **Origin:** live "Worksh Eet" garbled Add-type nudge at owner's `ocr_dpi=200` speed test. Full dpi
  sweep (202 docs, GT=confirmed): 150/200/240/250/260/275 each garble 1-4 tracked headings (different
  docs per res — decorrelated lottery); 225/280/300 clean; 280 only 7% faster (pointless). Realdoc:
  225 = type/supplier 100% (even heals #54, wrong at 300) but ref 90.1% vs 91.8%, **M 8→9** (prefix
  clip 'INV-35900'→'V-35900' crosses into auto-file; digit-dup 'PO-64334'→'PO-643224'). Scratch data:
  session scratchpad `filed*.tsv` / `rr300.txt` / `rr225.txt` (regenerable).
- **Oracle verdict (gary+oscar consensus vetted):** SIGN OFF W/COND on the escalation mechanism at
  **300-base only, dark**; **DO NOTHING (parked)** on the 225 preset. Killer fact (Oracle traced,
  overturning gary's stale-docstring read): `format_anomaly_checker._fold_shape` folds the digit-run
  length of ANY single-run shape — `'@@-#####'`→`'@@-#'` — so the 225 digit-dup class PASSES shape,
  never triggers escalation, and has ZERO in-pipeline guard. Length-invariance is BY DESIGN
  (`project_numeric_shape_fold`); do not revert it.
- **Build order (never bundle):** (1) oscar's crop fix — outward-rounded crop bounds + 12-16px white
  matte on field slices (cures edge-glyph drop at ALL res, incl. the 'V-xxxxx' class living at 300
  today on #121/123/124) — standalone, own switch, own realdoc M≤8 pass FIRST (it changes crop bytes
  everywhere, so it must precede the escalation baselines). (2) Slice 1 field rung `XRES_GATE_REREAD`
  inside `_maybe_gate_reread` (engine.py ~2729-2815/4782): injected `render_page_fn(page_idx,dpi)`
  from process_docs (pypdfium2 + recorded rotations; None for image-imports/born-digital), one cached
  alt render per (doc,page) keyed (dpi,pidx), independent LOCATE at alt res (no frame mapping).
  Lane A files clean ONLY IF: passes the exact failed check AND digits byte-identical AND base is a
  contiguous suffix with alpha-only prefix len 1-3 AND (C1) learned-shapes non-empty + ref/code field
  class only AND (C2) completed prefix ∈ confirmed prefixes via `ocr_corrector.lookup_prefix`
  (membership, not distance) — else lane B (cap 69 + corrected_to + note, customer-plain copy).
  Method stays original tier, never authoritative. (3) Slice 2 heading rung 3 `XRES_HEADING_REREAD`
  (same adopt contract as rungs 1-2; re-green `demo_notes_gate.js` ON+OFF — composes with 4a058a6).
- **Other conditions:** C3 PINs (digit substitution NEVER lane A; agree-but-still-fails = reject;
  never method-authoritative) · C4 RAM (alt-render cache ≤2 pages/doc, freed per doc — slow-PC
  feature must not re-create import RAM starvation) · C5 gates (300+ON vs 300 byte-identical-or-
  better M≤8; OFF byte-identical; probes #131/#121 lane A, #70/#163 lane B, stable no-fire control)
  · C6 merge seam: engine-emitted `corrected_to` (GATE_REREAD lane B, handler.js ~246) currently
  gets OPERATOR-grade veto power in the reprocess merge — add the pinned case to
  `test_reprocess_annotated_empty.js` + fix the comment; do NOT redesign the merge in this feature.
- **C7 preset revival (v2, only then "Faster (225)" returns):** trigger-widening length signal
  (single-group ref digit-run length differs from uniform in-scope confirmed length → fire re-read;
  cross-res agree → clean, disagree → lane B) + oscar's native-dpi-relative base/escalate rule +
  a gate asserting every new-wrong-at-225 doc is healed-or-flagged (absent-from-M-by-luck ≠ pass)
  + evidence on REAL 300-native scans (this corpus is 150-native; 225 there is an upsample — on
  real scans it's a downsample and likely worse). UI swap (150/200→225/300 + write-back snap) was
  edited then REVERTED per verdict — do not commit a Faster preset before C7.

### Validation slices S-A/B/C/D — gary-designed 2026-08-01 overnight, AWAITING ORACLE (not built)
- **Evidence base:** realdoc 202-doc residual M=5 + 8 regressions decomposed into classes; the #141
  delivery_number trace ('21/07/2026' committed to a REF field @88 silent). gary traced the WIN to
  Tier-A (engine.py:3764): the Ridgeway anchor row is an operator ⊕ teach (last_authoritative_at) →
  authoritative=True; Tier-A never consults confidence; `located` is BY FIAT for anchor_registration
  (anchor.py:1376 membership — even after relocate PROVED label_off_taught_position); ocr_min_conf
  is None for non-free-text (anchor.py:1497) → _ocr_clean blind; `alphanumeric` pattern contains `/`
  → a date has coverage 1.0. Registration rung also RESURRECTS a shape-failing read (anchor.py:
  1175-1177) and is _LABEL_CONFIRMED (shape-exempt everywhere). "Distrusted as witness
  (KEYWORD_ANCHOR_CORROB independence-fraud exclusion), trusted as winner" — the one-sided
  contradiction is the primary lever.
- **S-A date-in-ref flag** (kill DATE_IN_REF_FLAG): engine pass beside _flag_prefix_outlier (order:
  suffix-reconcile → S-A → prefix-outlier → S-B); ref-role/reference fields whose value FULLY parses
  as a date (validator.parse_date + full-string 3-component same-separator regex belt) → cap 69 +
  customer-plain note, NEVER null; exempt manual/template_fixed + scopes whose OWN shape accepts it;
  gary deviation FOR ORACLE: keyword_override NOT exempt (label authority ≠ value authority).
  PINs: '20260731'/'21/07'/'DN-24/07/26' NOT flagged; '12.05.11' FLAGGED (pinned trade-off).
  Highest rank: deterministic, near-zero regression surface, holds at EVERY floor (the note is the
  only floor-independent block — trust.js:601 flagged check).
- **S-B ref digit-run LENGTH profile** (kill REF_LENGTH_OUTLIER_GUARD, build OFF): ocr_corrector
  beside the prefix model — digit_run_profile tuples ('7602-1354-4'→(4,4,1)), build_length_index
  with DOMINANT_MIN_COUNT/SHARE + the weight-aware self-heal accept bars; exact tuple match; flag
  cap 69. Catches accretion (#33 'INV-12110') + digit-dup ('PO-643224') that the LENGTH-FOLDED shape
  cannot see (fold BY DESIGN, untouched, pinned). Rollover PIN: 'INV-1000' vs uniform (3,) FLAGS —
  accepted trade-off. Note precedence S-A > prefix-outlier > S-B.
- **S-C blind-geometry disagreement reconciliation** (kill BLIND_GEOM_DISAGREE_RECONCILE, DARK,
  flip=owner+gates): post-merge pass (suffix-reconcile pattern, ledger, no new OCR). v1 scope:
  winner method == anchor_registration EXACTLY (NOT inline/relocated — pinned, protects the
  2026-07-26 Tier-A re-teach fix; NOT rigid anchor_crop — already shape-gated); winner fails own-
  supplier shape; ledger has independent-stage (0_template/0.5_mapping/1_keyword) shape-PASSING
  disagreeing candidate. ADOPT when ≥2 independent stages agree normalise-equal (the #141 case:
  keyword_override@93 + template_mapping@90 both 'DN-24408') — a method inadmissible as corroboration
  witness cannot silently overrule two admissible witnesses; FLAG (cap 69, both values named) when
  only one. Deliberately narrows the authoritative-wins invariant for anchor_registration only
  ("the teach fixed the position, not the value" doctrine) — state in commit + pin.
- **S-D registration fit audit** (investigation only): measure per-fire n_inliers/residual/landmark
  spread/target leverage/provenance (07-30-era landmarks?) vs realised divergence (#141 = 0.047 norm
  vs the 0.02 inlier bar). Hypotheses H1 n=2 vacuous similarity fit / H2 leverage extrapolation /
  H3 stale landmarks / H4 similarity-vs-affine. Cheap gates if evidence: min_inliers=3, leverage
  refusal → keyword fall-through, or trust-cap 69+flag. Fix only on clean separation, zero clean-case
  collateral; else data remediation (re-pin landmarks), not code.
- **S-B2 conforming-profile confidence corroboration** (separate switch, DARK, own Oracle pass —
  never bundle with the flag slices): solo keyword read capped 85 whose digit-run profile AND prefix
  are both confirmed-dominant in a supported scope → +3 (the Stage-4.5 support boost falls 1 short).
  The direct MORE-auto-commits lever, alongside S-C's ADOPT lane and the unbuilt Stage-7 stage 3
  field_format_rules.
- **Expected residual after S-A+B+C:** {#65, #154, #86} interior stroke-level substitutions — only a
  second-render/second-engine witness could reach (the parked xres design's territory).

### Type-note placement — twice-misread as a supplier failure (2026-08-01)
- The type-refuse/ambiguity note attaches to the SUPPLIER row (engine `_flag_type_ambiguity`), so
  it renders under DOCUMENT ISSUER — the owner twice read a fully-resolved issuer@98 as "can't
  resolve the supplier". Follow-up: surface type-level notes beside the TYPE selector / in the
  summary band instead of under the issuer field (renderer placement; the emit could carry a
  `note_scope: 'type'` marker). Small, UX-only.

### Interior digit stroke-substitution — INVESTIGATED + ORACLE-VETTED, ready to build (2026-08-01 evening)
**007 measured pack + Oracle round complete** (oracle_log 2026-08-01 4th round; evidence preserved in
`stress_test/out/stroke_sub_2026-08-01/` — matrix.json ~30 reads/doc at 150-600dpi, per-stage traces,
600-dpi glyph exhibits). Axis = READING (placement clean on every exemplar; oscar crop-matte fix
REFUTED for this class). Substrate: 150-DPI-native JPEG rasters, digits ~10px, JPEG ringing closes
1px counters (2↔3, 9↔3, 5→8/9/3). THREE read chains flip independently (locate ~133dpi 1100px /
crop-ladder / full-page keyword — doc-291's one digit read three ways in one run). Tier-A precedence
commits the error (anchor.py:1037 nulls inline ocr_conf = structurally exempt from the Tier-A garble
gate); on #291 wrong inline@85 beat CORRECT keyword@85 sitting in the ledger at every DPI.
- **Class re-drawn (Oracle + main session both eyeballed exhibits): #86/#154/#285 = GT-POISON** —
  pages print well-formed '24/03/2026'/'DN-38884'/'WS-43842' vs contradicting confirmed values
  (30/30 unanimous high-conf reads = correct-OCR-vs-wrong-GT fingerprint). True OCR class = #65,
  #283, #291, #299 + the healed 259 signature. **REMEDIATION FIRST (owner): eyeball the 3 exhibits,
  then Learning Repair de-confirm → correct to printed value → re-confirm** (confirmed poison feeds
  live shapes/hints/S-B indexes — gt_overrides alone insufficient). Do BEFORE any gate baselines.
- **D1 BUILT + ON (same day): in-band digit-disagreement flag** — kill `DIGIT_DISAGREE_FLAG`.
  `engine._flag_digit_disagreement` LAST in the pinned note chain; comparator =
  `suffix_reconcile.digit_substitution_diff` (SHARED with future D2 — one impl, one pin;
  census-lockstep with `stress_test/census_digit_disagree.js`). Ref-role only; distinct-stage
  witness conf ≥60; 1-2 digit diffs on identical skeleton; flag-only cap 69 + corrected_to + copy
  directing to the DOCUMENT. **Gates all met:** census 300 docs → 1 fire = the #291 true catch,
  0.00% false (bar ≤3%); 31 pins green (`tests/test_digit_disagree.py` — C3 value-never-changed,
  S-B-territory exclusion, suffix-adopt interplay, ref-role-only, order pin); realdoc OFF-vs-ON
  diff = EXACTLY #291 silent→flagged, would-auto-file-wrong 9→8, values byte-identical corpus-wide.
  Census predicate kept ≤2 (0.33% fire-rate — no tightening needed). Dominant-snap exemption
  SKIPPED (census showed zero such cases — revisit only if a snap-winner false-fire ever appears).
- **D2 BAKE-OFF RAN ×2 — REFUTED BY MEASUREMENT, BANKED (do not build on today's numbers).** Oracle
  re-spec (witness = second-downsample-geometry locate read, NOT value-box crop) was probed twice
  over every Tier-A-won ref winner (234-doc then 296-doc corpus; single-token then line-join
  harvest — scratchpad bakeoff_d2{,_v2}.py, results in out/stroke_sub_2026-08-01/): **400→1100 =
  ZERO correct catches** (299 fires with a WRONG third reading 'WS-72098'; 65/283/291 abstain) at
  2.74-3.04% false fires (at/over the 3% hard bar). **600→1100 = ONE correct catch (#65
  'PO-24729')** at 1.30-1.71% false fires — 5 spurious review flags per ~300 docs (incl. two on the
  fresh Thornbury batch: 'PO-95717'→witness 'PO-35717' 9→3 — the substitution physics is chain
  noise both directions), ~0.7s/doc latency on ~every templated doc. **False:true 5:1 — worse than
  the needless-flags class the 07-31 session spent a day removing.** The 283/299 abstains are
  CHAIN-level (the alt-res page genuinely doesn't present the token same-skeleton), not harvest
  fidelity — measured with both harvests. REVIVAL CONDITIONS: a witness chain with measured ≥2-of-3
  class catch at ≤1% false (e.g. label-anchored band harvest may cut false fires — but cannot cure
  the abstains), or the class growing past ~3% of corpus. Honest post-D1 residual: #65/#283/#299
  silent (3 of 382 ≈ 0.8%), #291 flagged live by D1, #86/#154/#285 = owner Learning Repair.
- **D3 REJECTED (DO NOTHING): never-harvest-values-from-locate-pass** — inverts the July-31 arbiter
  premise (crop box routinely swallows label tails/clips prefixes — the traces' own anchor_reject
  lines show it), heals only #291 which D1 already flags, resurrects the clip class. BANKED future
  path instead: full-res re-LOCATE (solve box precision — 007-A's own revival precondition).
- Also REFUTED by measurement: global preprocessing/binarisation changes (no recipe at any DPI read
  the poison-free saturated cases; flips recipe-stable); 400-as-primary (fixed 283/299, broke 65
  worse + 285@400 lost PLACEMENT entirely — DPI non-monotone). Substrate fix out of app reach; a
  low-scan-quality import advisory = future barry idea.

### Label-tail crop CLAMP — BUILT DARK 2026-08-02 (kill `ANCHOR_LABEL_LEFT_CLAMP` default OFF)
**Status: implemented per the signed design (all of C1-C7); 26 pins green
(`python_backend/tests/test_label_left_clamp.py`); gates run via
`stress_test/clamp_gate_diff.js` over two RR_CONSENSUS realdoc runs — see the 2026-08-02
handover for the G1-G6 results. Oracle ADJUDICATED 2026-08-02: ACCEPT-AS-RESIDUAL, GO on the
flip. AMENDED GATE LETTER: "zero UNRESIDUALED flips" (in-class + review-bound both runs +
provably witness-unreachable + logged with watch bars); the one residual = #218 (Vellum
interior 9→0 on the cleaned crop — page prints SO-68195, 600-DPI-verified,
zooms/doc218_600_wide.png). Watch bars W1 (auto-filed anchor_crop ref correction with
1-2-digit same-skeleton diff ⇒ kill pending re-gate) · W2 (stroke-sub residual ~3% revives D2)
· W3 (stroke-sub scopes nearing graduation: confirm against pixels until ocr_dpi 300).
Flip = set env `ANCHOR_LABEL_LEFT_CLAMP=1` (owner call).
Design + conditions kept verbatim below for the record.**
**The label-bleed class (007-measured, Saltmarsh 20-doc batch + corpus):** rigid taught crops are
built label-blind (+20px fixed pad, anchor.py:3282) while scans jitter (141px width spread + skew)
⇒ 13/16 crops intrude the label tail; fate trifurcates on the tail's OCR (clean→files ·
≤2-char debris→recovered@85 HOLDS EVERY BATCH · 3+char→inline rescue files · opposite jitter→
ws09 near-miss WRONG value). 47 recovered rows / 4+ suppliers = corpus-wide tight-gap topology.
Evidence: scratchpad geom_300.json + traces (session 2026-08-01); oracle_log entry.
**Fix (dark, kill `ANCHOR_LABEL_LEFT_CLAMP` default OFF):** located-label LEFT-edge clamp at crop
derivation — (P) caption-band mirror in the LOCATED frame. Conditions C1-C7: C1 expected-value-left
= located label top-left + STORED OFFSET (:3508 convention), never the taught box (frame trap —
fixture pin that a taught-frame impl FAILS); C2 authoritative+real-label+direction right+offset
present+locate+_located_at_taught_position, else byte-identical; C3 structured val_types only
(free-text ladder re-crop bypasses); C4 all four crop sites (:519/:685/:1076/:861 cross-check) or
pin the asymmetry; C5 in-crop degenerate reverts to UNCLAMPED (never refuse); C7 reuse the :1391
locate. Gates G1-G6: OFF==ON byte-identical outside the class · zero recovered rows auto-file-
eligible · ws09 identical ON/OFF · unit pins (merged-box/tight-gap/no-locate/non-right/(P)-twin/
C1-frame) · throughput ≤2-3% · total realdoc flag count must not rise · realdoc M=0 zero value
flips · Saltmarsh 20/20 ref auto-file-eligible 0 recovered. Sequencing: clamp → oscar matte
(label-aware, bounded by clamp) → full-res re-LOCATE independent; caption-prefix strip stays DARK
as the no-locate spare.
- **Cured sub-class (6237398): merged-doubled-digit** — REF_LENGTH_WITNESS_RECONCILE ON heals the
  'WS-1904'-for-'WS-11904' family from the ledger on the artifact's fingerprint (one digit inserted
  adjacent to an identical digit); rollover-drift pinned unadoptable; authoritative winners get
  flag-with-suggestion only.
- **Second live exemplar + a cheaper sub-class (2026-08-01, Vellum worksheet_18):** page prints
  'WS-11904'; anchor_inline read 'WS-1904' (doubled '1' merged — segmentation, not substitution)
  and WON the tie over keyword's CORRECT 'WS-11904' (both @85, anchor tier outranks). S-B FLAGGED
  it live (4-vs-5 digit note — the guard's first real catch). The trace shows the cure candidate:
  an inline-vs-independent-read DIGIT-COUNT disagreement arm — when a same-field ledger candidate
  PASSES the scope's length profile that the winner FAILS, prefer/flag (the S-C pattern extended
  to anchor_inline, currently pinned OUT to protect the 07-26 re-teach fix — that pin needs its
  own Oracle round before any widening). Segmentation drops ARE decorrelated across reads (keyword
  had it right) unlike pure stroke substitutions.
- **Third live exemplar (2026-08-01 ~15:42, owner screenshot, Vellum worksheet_01):** page prints
  'WS-73541'; anchor_inline read 'WS-7354' (TRAILING '1' dropped — the locate-chain 1100px thin-glyph
  loss, 007-measured mechanism) and won Tier-A over keyword's CORRECT 'WS-73541'@85; anchor_crop had
  the right digits but swallowed the label tail ('Vo. WS-73541') → credibility-rejected rx 25%. S-B
  FLAGGED live (4-vs-5 note + WS-73541 suggestion, Accept path used). Correct current behaviour;
  strengthens the digit-count PREFER arm's revival case (correct value passed the length profile the
  winner failed, in-band, twice).

### Home "Open Mailbox" deep-link — OWNER 2026-08-02
**Owner:** "the open mailbox button in home just opens the search window, not the mailbox."
The WAITING-ON-YOU card's button (main/index.html:~842) opens the Search window cold; the
user then has to find and click the Mailbox toggle themselves — the button promises a place
it doesn't take you.
**Fix shape (the open-review-window-at pattern):** a pending "open at mailbox" target —
`open-search-window-at('mailbox')` (main stores the target; the search renderer consumes it
once on load via a `get-search-target` read, or receives a `search-goto` event when the
window is already open) → toggles the Mailbox view (`SearchMailbox` toggle path) on arrival.
Same mechanism generalises later ("open at recycle bin", "open at doc N").

### Search preview error-state hardening (eternal spinner) — OWNER 2026-08-02 (live repro)
**Owner:** "when i click a doc in search i see a spinning icon but the doc doesnt load."
**Immediate cause (that session):** stale-main — the running app predated `b747676`'s new
`get-document-detail` IPC while the reopened search renderer already called it; the invoke
rejected ("No handler registered") and NOTHING catches it. Cleared by an app restart.
**The real defect it exposed:** `search-preview.js selectDoc()` has NO error handling — both
awaits (`getDocumentDetail`, then `getDocumentPages`) are bare, so ANY fetch failure (missing
handler, DB hiccup, doc deleted mid-click, IPC error) leaves the placeholder spinner forever
with zero feedback — the exact silent-failure class Chris keeps catching.
**Fix shape:** wrap selectDoc's fetch sequence in try/catch → on failure replace the spinner
with an honest state ("Couldn't load this document — try again or reopen Search." + the
short error) and clear it on the next selection; same guard on the mailbox row click and
resubmit (they share the fetch). Bonus hardening: a renderer-side "handler missing" message
that says "the app was updated — restart to finish" (the stale-main class keeps producing
exactly this symptom after main-process commits; a truthful message turns a mystery into a
one-line instruction). The renderer-error diag forwarders (08-02) already log the rejection —
the log line exists; the SCREEN state is what's missing.

### Custom approval stamp: placement, resize, and the decision note ON the stamp — OWNER 2026-08-02
**Owner:** "can we make the approval stamp custom in that you choose where it goes and can
resize it to fit a blank area on the page. Can we also add the notes from the approval to
the stamp?"
**Today:** `src/services/pdfStamp.js` `stampWorkflowDecision` draws a FIXED stamp (position/
size hardcoded) on the decision copy; the resolution note (`resolution_comment`) is recorded
on the route + shown in History/Sent but not printed on the stamp.
**Shape of the work:**
1. **Note on the stamp** — cheap first slice: render `resolution_comment` (wrapped, truncated
   ~2-3 lines) under the APPROVED/REJECTED / By / Date block in pdfStamp. Escape/measure text;
   long notes elide with "…" (full note stays on the route + History).
2. **Placement + resize** — an interactive step at decision time (or a per-install default in
   Settings → a "stamp position" picker): show page 1 in the stamped-viewer-style pane, drag
   the stamp rectangle to a blank area, resize by corner; persist per-install default
   (settings key) + optional per-decision override. pdfStamp takes {x,y,w,h} normalised.
3. Consider auto-suggest: pick the largest whitespace region on page 1 (cheap raster scan)
   as the default landing spot — "fit a blank area" without the user dragging every time.
**Watch-outs:** the stamped file is a DERIVATIVE (original untouched) — no learning/extraction
impact; the known wart that two approvals on one doc share a stamped path (second overwrite
wins — eric 2026-08-02) should be fixed alongside (per-route stamped filenames); Print-Slice 2
(stamped printing) consumes whatever pdfStamp writes, so land this before/with it.

### Core Search re-skin to the detached-client design — OWNER 2026-08-02
**Owner:** "the search dialog in the search client looks a lot more modern and graphical than
the search feature in the core app — replicate the design of the search client in the core
app — it looks more robust."
**What the client has that core lacks** (client/renderer/index.html): a designed component
system — tinted state CHIPS (`.chip.confirmed/.pending/.rejected…` pill + rgba state tints),
`.rolechip`, count `.badge`/`.seg-badge`, `.chip-btn` filter pills, `.segmented` control
groups, SVG icon buttons (`mkBtn`+`ico()`), meters — where core's Search window renders a
plainer list (`.result-item` rows, text badges). Both already share theme.css tokens, so this
is a COMPONENT + LAYOUT port, not a palette job.
**Shape of the work:** (1) port the client's component CSS into the core Search window (or a
shared `search-components.css` both import — preferred, stops future drift); (2) markup pass
over the ~8 core search renderers (search-results/preview/actions/mailbox/workflow/query
inline-render their class names — logic and IPCs UNTOUCHED, re-skin only); (3) load the
`scan-finder-frontend-design` skill for the design pass; (4) keep every contract suite +
test_no_global_collisions green; (5) a Chris VISUAL round after (he can screenshot now —
capture-window.ps1) to judge it as a customer.
**Guardrails:** don't fork behaviour between the two apps — where the client's affordance is
better (chips, segmented boxes), core adopts it; where core is ahead (cap note, de-pathed
rows, secure viewer, teaching empty-states), the client inherits LATER (named follow-up).

### Focus-fix FIELD SWEEP + forward convention — OWNER 2026-08-02 (live repro on the workflow note)
**Repro (owner, live):** typing "I approve" into the workflow note field (`.wf-note`,
search-workflow.js `_decisionBar`) on a doc routed to them hit the keyboard-focus desync
(no caret / keystrokes dead until clicking out of the app and back).
**Why it slipped past the systemic cure:** the universal repair is a PRELOAD `pointerdown`
chokepoint (preload.js ~:454 — heals every `input/textarea/[contenteditable]` PRESS in every
window). It cannot fire when a field gains focus PROGRAMMATICALLY — and the workflow note does
exactly that (`note.focus()` on the empty-note Reject path), as do other `.focus()` call sites
around the app. Second suspect class: native `confirm()`/`alert()` sites that don't call
`markFocusSuspect()` afterwards (the suspect flag is what forces the deterministic
blurWebView→wc.focus edge on the NEXT press — main.js ~:943-976).
**The sweep (build later):**
1. Enumerate every programmatic `.focus()` on a text control across all window renderers;
   route each through a shared helper that performs the repair edge first (invoke
   `ensure-window-focus` then focus — the same (A)+(B) sequence the chokepoint does), or
   simulate the chokepoint by dispatching through it.
2. Enumerate every native `confirm()`/`alert()` site; ensure each calls
   `window.docusnap.markFocusSuspect()` on return (several new dialogs landed 08-02 —
   delete-all rewords, counted Empty-bin, split guards — verify all).
3. A source-scan PIN (contract-test style): every `confirm(`/`alert(` in a window renderer
   must have a `markFocusSuspect` within N lines, and every programmatic `.focus(` on an
   input must go through the shared helper — so the class can't regrow.
**Forward convention (owner rule): every NEW field or native dialog ships wired to the focus
repair as part of its implementation — reviewers treat a bare `.focus()`/`confirm()` as a
defect.** Memory: `project_focus_repair_mechanism` carries the original design.

### Document-detail DTO (finish the de-pathing) — NAMED 2026-08-02 (Oracle C3)
The search ROW surface is de-pathed (`a58bc10`), but `get-document-with-extractions` →
`previewService.getDocumentDetail` → `getById` `SELECT *` still ships the SELECTED doc's
stored/working/folder paths + full ocr_text to the search renderer on every row click (and to
the mailbox click + resubmit flows). Fix = a caller-aware `dto.projectDocumentDetail` in
previewService. **ORACLE'S EXPLICIT WARNING — this must be CALLER-AWARE, not a global strip:
Review consumes `doc.folder_path` (review/renderer.js:~1261 page fetch) and `doc.ocr_text`
(~2489, ~5099 name-presence) from the SAME IPC — a blanket strip breaks Review's page preview
and name-presence check.** Same class, lower priority: get-review-queue / get-deferred-queue /
getByIds ship `SELECT d.*` into the (admin/edit-only) Review window. Also the true end-state
for the raw shell channels: a main-side `open-filing-slips-pack` IPC, then DELETE
open-file/show-in-explorer (the slips round-trip is their last legitimate caller).

### Workflow due dates + pending nudges — BANKED 2026-08-02 (Chris r4 card 7, bob-vetted)
Chris's "what paper never managed": a due date on a route ("needs an answer by Friday") + a
gentle nudge for items sitting pending. Full build = `due_at` schema + a scheduler + overdue
surfaces + NEW workflowNotify event types (the toast event list is PINNED — extending it needs
its own Oracle pass). NOT night-sized; product value real but roadmap-tier (his switch-week
conditions were the Reject fix + the approval record, both done/underway).
**Night-sized appetiser (no schema, no scheduler): an ageing chip on open rows/banners —
"waiting 6 days" computed from `document_routes.created_at`, shown past ~3 days.** Roughly half
the nudge value for an evening.

### R2 cohort pick admission — DEFERRED with revival evidence (Oracle 2026-08-01)
- Banked from the type-refuse deadlock arc (11b7ae9 shipped R1+R3+reword instead). R2 = admit a
  band-13 _letterhead_cohort member with document_type_slug == detected_slug into the Stage-0 PICK
  when title_trusted (heals doc #2 of a new type with zero confirms). REVIVAL EVIDENCE: after
  R1+R3 live, the refuse-note class still recurs materially (more than the expected single
  teach-window note per new supplier-type pair) on the demo gate or live. Conditions if revived:
  trusted-title gate only; detail-veto ordering intact; margin-3 untouched for the untrusted path;
  cohort sibling passes the SAME downstream qualification gates (no gate bypass); cohort anchored
  on an in-margin member's non-null dominant_supplier.

### Template-system FINE-TUNING + "all methods, then verify" — OWNER 2026-08-02 (two live exhibits)
Owner-declared next major arc: "We will work on fine tuning the template system soon." Two live
exhibits from the Customer Doc Test teaching run show the per-doc method mix swinging wildly:
- **Exhibit A (SFDEV reprocess):** trace shows ONLY `template_mapping` + `keyword` — no taught/anchor
  methods despite green dots — and the mapping reads are "getting the anchors and the values wrong".
- **Exhibit B (NorthgateTextiles_purchase_order_02.pdf):** the OPPOSITE mix — po_number/po_date won by
  `anchor_inline` (the `anchor_crop` candidate read `'No. PO-2590!'` and was rejected not_credible —
  the label-tail intrusion class), supplier via `hint_t…`; NO template_mapping row at all (identity
  pill says "Remembered positions") and NO keyword candidate in the trace. Value ends CORRECT at 97%
  yet still carries the "couldn't be confirmed anywhere else on the page" flag.
**Why the mix swings (mechanism, partially verified):** the engine is precedence-first-win with
skip-if-credible fast paths — Stage 0.5 only produces when a template MATCHED with mappings for the
field; anchor rungs skip when an earlier read is already credible (anchor.py "already found by
higher-priority anchor" / `_skip_rigid` / fast-happy-path comments); keyword rows appear only when a
pattern produced a candidate. So each doc shows a different winner chain — nothing runs "everything,
every time". A wizard teach lands as Stage-0.5 mappings, so its reads surface AS `template_mapping`
(there is no separate "taught" label); ⊕ Review teaches surface as `anchor_*`.
**Owner's design direction (the banked feature): ALL methods applied, then the data VERIFIED** —
cross-method consensus instead of first-authority-wins. Foundation already exists: the always-on
candidate ledger, 2.6b located corroboration, S-C distinct-stage witness, suffix/length reconcile.
Design questions for the session: full-run cost (every rung every field = real OCR spend — probably
verify-on-disagree or verify-on-flag, not brute force), how consensus interacts with authority
precedence, and whether the corroboration flag should stand down when methods AGREE (Exhibit B's
correct-but-flagged read).
**Investigation list:** why Stage 0.5 missed on Northgate _02 (template match failure on the scan
rendition? mappings not covering the fields? scope key?) · why keyword produced nothing there ·
whether an authoritative ⊕ anchor properly outranks a wrong template_mapping read when both exist
(Exhibit A's complaint) · dev-inspector labelling — surface "taught (wizard)" vs "taught (⊕)" so
green dots and trace rows reconcile for the owner.

### SFDEV EVERY-STEP trace — OWNER 2026-08-02 (next session, NO code this session)
**Owner rule: the dev inspector must show the RESULT OF EVERY STEP so an error can be read
without re-running — "so I know exactly what the system was dealing with". That is the point
of the dev feature.** Today's trace shows the winner chain + competitive candidates; the
skip-if-credible fast paths are mostly SILENT — a stage that never attempted looks identical
to a stage that attempted and lost, which is exactly the confusion behind Exhibit A/B above.
**Build (next session):**
1. Emit a trace event for EVERY stage/rung per field — attempted (candidate + accept/reject +
   reason, as now) AND skipped (`{stage, rung, field, skip_reason}` — "already credible from
   template_mapping", "no template matched", "no anchors in scope", "no keyword pattern hit",
   "cross_supplier_placement_skip", …). The skip REASON is the data.
2. Inspector renders the full per-field ladder: every stage in pipeline order with its
   outcome — produced/won, produced/lost-to-X, rejected(reason), skipped(reason).
3. Cost guard unchanged: events only under `--trace` (inspector/console open or diag logging) —
   normal processing stays byte-identical; skip events are cheap strings, no extra OCR.
4. Pairs with the fine-tuning arc above: the every-step ladder is the observability that the
   "all methods, then verify" design will be judged against.

### Digital ↔ scanned bleed (same supplier, divergent layout)
- **Confirmed (Set B warm):** a digital doc reusing a live name inherits the scanned identity (**supplier
  90%**) but the scanned template's field geometry doesn't fit the digital layout (**ref 29%**, held).
- **gary's least-invasive fix (deferred):** extend the `_located_at_taught_position` layout gate to
  **same-supplier** authoritative rigid reads (today cross-supplier only, `anchor.py:~1404`) → a taught
  absolute box fails toward review when its caption isn't at the taught position on a divergent layout.
  NOT a source-partition (that's wrong for production — same supplier should share learning).

---

## Type detection

### TYPE_PRESENCE_VETO — Slice 0 (band reader) + Slice 2 (auto-type cure)  (night 2026-07-28)
- Slice 0: a title-band PSM-11/upscale reader (`read_title_band`) to erase the veto's ~1.5–2.3%
  fail-safe false-holds and feed the cure. Slice 2: arm-the-refuse so legible titles auto-type correctly
  — **flip LAST**, after the identity fixes soak; biggest regression risk (needs a full-corpus per-doc
  type-flip gate). Memory `project_type_presence_veto_20260728`.

### Identity branding-primary separation  (night 2026-07-28, designed)
- Vellum/Larkspur phash collision (64-bit hash = LAYOUT not mark). Fix = branding-PRIMARY supplier
  separation, coarse recall-only, 256-bit mark corroborates. Vellum PDFs are image scans → Slice B
  (reprocess) cure; Option C (geometry) = fresh-import SUGGEST-only. Memory
  `project_identity_branding_primary_20260728`.

---

## Testing infrastructure

### Install preset types + total/line-item fields
- The live DB has only 5 doc types (invoice/sales_order/purchase_order/delivery_note/service_worksheet)
  and **no total/line-item field on any type**. Install credit_note/quote/statement/receipt (Settings →
  Add from catalog) + add a total field, then re-run `score_demo_digital.js` to cover all 9 demo types +
  money extraction (currently untestable). Can be scripted into a copy DB.

---

## Security / hardening

### Cython engine + arm fuses + asar rungs  (discussed 2026-07-29)
- The extraction engine ships as sourceless `.pyc` (a speed bump — bytecode decompiles back to
  near-source). `.pak` = Chromium resources (non-issue); most `.py` = third-party libs + thin entry
  shims. **Real upgrades (deferred, own session — build-chain change + full smoke):** Cython-compile the
  engine → native `.pyd`; arm the Electron fuses (`HARDEN_FUSES`, RunAsNode/inspector off); the deferred
  asar rungs B/D/F/E (bytenode/obfuscation). Plan: `docs/BUILD_HARDENING_PLAN_2026-07-26.md`. Framing:
  raise the bar, not "uncrackable" — the **licensing gate** is the commercial moat, not code secrecy.
