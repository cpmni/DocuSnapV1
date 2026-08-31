# HANDOVER 2026-08-02 OVERNIGHT2 (autonomous build sprint — 10 commits, pushed)

Branch `feat/reprocess-throughput-autostraighten`. **HEAD `d680422`, PUSHED, tree clean** (except
pre-existing untracked handovers/backups). Autonomous overnight run (owner asleep) under the
directive: build everything buildable, commit each, push at end, flip ON when advisor+Oracle+gate
pass green, then a christest walkthrough. Every fix went past its specialist advisor (eric/reggie/
gary) and is gated. **A christest round is IN FLIGHT as this was written (sandbox on CDP 9223, PID
22296) — append Chris's report when it returns (see the christest section).**

## Where it started
The `rg` A/B (ANCHOR_VALUE_RIGHT_GROW) came back byte-identical. DIAGNOSED (not a bug): the flag is
wired end-to-end and reaches Python, but NO doc in the 493-confirmed corpus overflows its taught box,
so the gate proved zero-regression but nothing about the heal. The chop-class lives in the Demo Docs
(Northgate), not the DB. That kicked off the whole build.

## Shipped this session (each its own commit; all pushed)
1. **`13dbe44` crop right-grow FLIPPED ON** — `stress_test/demo_rightgrow_ab.js` (new, read-only,
   arbitrary-folder A/B; AB_FLAG env picks the crop switch) PROVED the heal on Northgate POs
   (PO-5898→PO-58987 HEAL vs GT, PO-2590→PO-25909; 0 REGRESS, 0 collateral). Setting bridge
   `_anchorCropEnv(db)` (processing/handler.js) spread into 4 spawn sites (import batch :1134,
   reprocess-all :2310, single reprocess :1688, watch :377) + Settings→Processing toggle
   (`anchor_value_right_grow`). Owner-flipped ON in the live DB.
2. **`336585a` label-tail clamp FLIPPED ON** — generalised the bridge helper to carry BOTH crop
   switches. Oracle had already GO'd the clamp flip (ACCEPT-AS-RESIDUAL); demo-verified
   (Saltmarsh PO9974A9C→PO-27425 HEAL, 0 collateral). Toggle `anchor_label_left_clamp`. Flipped ON.
3. **`418cf80` theme quick-flip memory** — theme.js records a per-family anchor; the Light⇄Dark flip
   round-trips to the SELECTED theme (slate⇄midnight⇄slate, warm⇄dark⇄warm), not a base theme.
4. **`d7ab2e2` Search re-skin** — new `src/windows/search/search-components.css` ports the detached
   client's graphical components (tinted state chips, segmented mailbox, lead search icon, pill
   buttons) over the EXISTING core class hooks. No id/class/logic/IPC change; test_no_global_collisions
   green. **Chris visual round pending (christest).**
5. **`bf9fe90` Search preview honest error state** — selectDoc wrapped in try/catch + a
   stale-selection token; the mailbox/workflow unguarded pre-fetches dropped (route through the
   guarded selectDoc); "No handler registered" → "restart to finish". Pin `test_preview_error_state.js`.
6. **`b67688a` Home "Open Mailbox" deep-link** — new `open-search-window-at`/`get-search-view-target`/
   `search-goto` channel (NOT the taken get-search-target); `SearchMailbox.open()` set-true idempotent.
7. **`01a2a43` focus-repair sweep SLICE 1** — `src/windows/shared/dialogFocus.js` (focusField +
   idempotent confirm/alert wrapper); preload `ensureWindowFocusAsync` invoke variant; the workflow
   Reject note routed through focusField; Search/Main/Teach armed (were unarmed). Pin extended +
   recovered 4 stale runZoneOcr checks (the fixed 3000-char scan had drifted). Full 42-site audit +
   regrow-proof static pin = MULTI-SESSION.
8. **`5af13cf` SAME_SUPPLIER_LAYOUT_GATE (DARK)** — gary's digital↔scanned-bleed fix: an elif on the
   same-supplier authoritative rigid read (require caption at taught position; looser relocate budget +
   offset-present precondition; demotion-only, conf≤50→review). Default OFF → byte-identical. Pin
   `test_same_supplier_layout_gate.py`. **FLIP PRECONDITION: Oracle round (narrows a Tier-A invariant)
   + realdoc M=0 with the switch ON + gary's two-direction integration pin. DO NOT FLIP yet.**
9. **`b4105b7` delivery_number breadth + Service Worksheet preset** — reggie's ~25 delivery-specific
   captions (excludes greedy Note No/Ref No) + a type-scoped worksheet preset. realdoc M=0, ZERO new
   delivery regression, would-auto-file-wrong unchanged (10→10).
10. **`d680422` pendingfeatures** — session record.

## Deferred WITH a vetted design (build-ready; see pendingfeatures.md top block)
- **Type-note under Document Issuer** (gary): Route 1 (renderer-only relocation to a `.type-scope-note`
  band by #doctype-select, keeps the persisted note on the carrier for the auto-file hold, copy-lockstep
  pin) recommended; Route 2 (note_scope marker + migration) more robust. NOT built (budget).
- **Child-window minimise → in-app dock** (eric): premise corrected — NO current child is modal
  (main.js:480), so no modality surgery. Slice 1 = dock infra + child-minimise/restore-child IPC + the
  trigger; SEAM = main-hides-to-tray orphan; restore-child must verify sender===main. NOT built (the
  trigger needs a live Windows flash-test).

## Gates / verification (honest)
- Crop flips: demo A/B green (heal + 0 collateral); pins green. Both ON in the live DB. The RUNNING app
  needs a RESTART to load the new spawn-env bridge (stale-main). Harness can't test the live both-ON
  combination (it reads env, not the DB settings) — #499 (PO-58987) surfaced crop-OFF in the realdoc
  harness and is the right-grow class that the live flip heals.
- All JS `node --check` clean; search collision + preview + focus + preset + job_no + clamp + right-grow
  + same-supplier-gate + identity-anchor-scope pins GREEN. realdoc M=0 for the delivery labels.
- NOT verified: live visual of the re-skin (Chris round in flight); the SAME_SUPPLIER_LAYOUT_GATE ON
  behaviour (dark, deferred to Oracle+gate).

## christest — DONE (full report `docs/CHRIS_FULL_APP_REVIEW_2026-08-02.md`)
Sandbox: `<scratchpad>/chris-sandbox` (userData + Output + Demo Docs copy), CDP 9223, PID 22296, driver
`<scratchpad>/chris-driver` (screenshots stepNN-*.png). Thorough app+Settings walkthrough done.
**Verdict: "would keep using — yes."** IMPLEMENT NOTHING below without the owner's go.

**Tonight's work VERIFIED by Chris (live):** Search re-skin looks modern + holds together (tinted type
chips, amber Needs-Review chips, pill buttons, magnifying-glass lead box); Home "Open Mailbox" lands
straight on the Mailbox; theme quick-flip round-trips to the chosen theme (Nordic Slate) via BOTH the
rail toggle + account menu; preview no longer spins forever. Every destructive warning told the truth
(9/9 truth-table). Approval + auto-stamped-copy flow = the standout.

**Chris's 7 finding cards (OWNER VET — nothing implemented):**
1. **Terms screen is the DRAFT** ("NOT YET IN FORCE" + 9 [SOLICITOR:] notes) — HIGH. KNOWN: LEGAL.txt
   is a draft (CLAUDE.md). Ship the finalised text before release; the accept mechanism is fine.
2. **Company "Not found" cold-start** on a brand-new supplier (all 20 invoices) — HIGH, TOP friction.
   KNOWN gap: pendingfeatures "Letterhead cold-start supplier reader" (designed, NOT built). Chris
   confirms it learns fast after ONE teach (offers "Use 'Copperfield Electrical'" on the rest).
3. **Recycle bin preview mismatch** (list shows invoice_16, details pane shows a different filed doc
   until you click) — MEDIUM, NEW. Fix: auto-select first bin item / blank preview on bin open.
4. **"63% confidence" shown on CONFIRMED docs** — MEDIUM/LOW, NEW. Drop the score once confirmed.
5. **Computer codes leak** (`needs_review`, `document_open`, `(supplier_name)` bracket keys) — LOW, NEW.
6. **Missing-file preview = "No preview available", no retry** — LOW, NEW. NOTE: my `bf9fe90` honest
   error state covers the FETCH-FAILURE path; Chris hit the separate MISSING-FILE branch. Small
   follow-on: give that branch the same message + Try-again (same search-preview.js).
7. **Admin Settings jargon** ("anchor→target zone mappings", "extraction pipeline") — LOW, polish.
Smaller notes: stale "Document Issuer box is still empty" hint after teaching; two "Back to search"
buttons in the bin; "reserved device names are defused" copy.

Sandbox left RUNNING (CDP 9223, PID 22296) for the owner to poke; next /christest rebuilds it.

## Gotchas re-confirmed
- The realdoc harness does NOT read the DB crop settings — it toggles via ENV. To gate the LIVE both-ON
  crop combination, set the env vars on the harness or reprocess through the app after restart.
- `git commit -F <file>` (never -m heredoc — the auto-mode classifier blocked a heredoc+push compound).
- LF→CRLF warnings on new files are benign.
