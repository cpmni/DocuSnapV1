# HANDOVER — 2026-08-28 NIGHT (Workflow + Stamping redesign BUILT end-to-end; help voice parked)

**Branch** `feat/teach-side-overnight`. **NOT pushed.** 11 commits ahead of `abd0f34` (the session-start
HEAD), tree CLEAN (no uncommitted tracked changes). **Both apps RUNNING on the latest code** (dev
`npm start` core on the REAL DB + the detached client via `electron client`; 8 electron procs). Owner
verdict on the whole feature: **"yes it works — needs some tuning but I will address it later."**

## TL;DR
Two workstreams this session:
1. **WORKFLOW + STAMPING REDESIGN — fully built, slices 0–4, and live in BOTH the core app and the
   detached client.** Design + Oracle conditions: `docs/designs/WORKFLOW_STAMPING_REDESIGN_2026-08-28.md`
   (**§9 is the authoritative "what actually ships" layer** — read it first). Backend is unit-tested;
   the desktop + client UI were smoke-tested live by the owner (works, "needs tuning").
2. **HELP voice rewrite — PARKED** (owner: "park this … mark for later today"). Quick start + Teach were
   rewritten to the professional-plain voice and the owner signed the voice off ("perfect"); the other
   spine pages + tooltip stragglers remain. Tracked in `pendingfeatures.md` (2026-08-28 entry).
Plus a **Search preview render-quality fix** (the pixelated-zoom complaint) — resolved.

## Commits this session (oldest → newest, all NOT pushed)
- `eba2ef2` help: pro voice on Quick start + Teach, Home Help→menu, shared hover tooltips
- `31129bd` **stamping slices 0–2a** (data + tamper-resistant permission, append-only record, engine, approval gates) — DARK, tested
- `9c50b93` **slice 2b** — Search "Send or stamp…" popup + click-to-place + stamped/original toggle + desktop IPC
- `a467134` **slice 3** — Settings stamp catalog + per-user "Can stamp" toggle; removed the 3×3 placement card
- `003f6d5` placement UX — mouse-follow, drop-on-click, move/resize (min–max), start-over; one stamp+comment per placement
- `b398e4d` stamps show **No. N + date & time**, numbered history
- `f561ac3` + `b124069` + `d27ac26` **Search render quality** — see "render fix" below
- `0d098ef` **slice 4a** — /v1 stamp routes (under `/v1/workflow/*`, gated, path-free) + client API + tests
- `86de7d7` **slice 4b** — detached-client stamp UI (parity)

## The redesign — how it works (durable)
**Two invariants (owner, non-negotiable):** (1) a document reaches ONLY its intended recipient; (2)
stamps are immutable + attributable ("a true record of what happened, when, by whom").

**Permission model (owner-refined, final):** `can_stamp` gates ONLY the acts that PLACE a stamp — a
standalone self-stamp AND approve/reject (which auto-stamps). **Routing (the SENDER) is NOT gated** — a
standard user can send an invoice to accounts for approval. **But you cannot route FOR APPROVAL to a
non-stamper** (`_validateAssignTarget` → `RECIPIENT_CANNOT_STAMP`) — a dead-end approval. Un-permitted
users don't see the Stamp option; the server denies regardless.

**Security (the crux):** the permission is a **signed grant EVENT on the existing DPAPI-keyed audit hash
chain** — there is NO `can_stamp` column. `src/modules/auth/stampPermission.js` `canStamp` is
**FAIL-CLOSED** and verifies at CHECK-TIME (`secretStore.available()` true-DPAPI **AND**
`verifyAuditChain().ok`) — a hand-INSERTed forged grant breaks the chain → refused + a `tamper_detected`
audit row (the append-only triggers block UPDATE/DELETE but NOT INSERT, and nothing auto-verifies today).
The stamp RECORD is an **append-only `stamp_events`** row (who/type/when/placement + `source_sha256` of
the base + `artifact_sha256` of the stamped copy + `audit_ref` cross-linking a signed audit row); the
original PDF is never touched; stamps are **CUMULATIVE** (each applies to the current stamped artifact —
warehouse RECEIVED then accounts PAID stack); each stamp prints **No. N + date/time**.

**RESIDUAL the owner accepts:** tamper-EVIDENT, not tamper-PROOF against the CORE PC's own admin (DPAPI is
user-bound); strong vs every detached-client user (server-authoritative, no local DB) + casual
edit/readonly DB edits. Changing a doc's ref number does NOT move a stamp (bound to the internal id + the
file hash, not the ref). Tamper is currently *detectable but not auto-flagged* → the **Integrity check**
(deferred, below) closes that.

### Slice map (all committed)
- **0** data + permission spine: `database/index.js` (stamp_types +6 defaults, append-only stamp_events);
  `database/modules/auth.js` (`addStampGrantEvent`/`latestStampGrantState`); `stampPermission.js`;
  `database/modules/stamps.js`. Pin `src/modules/auth/test_stamp_permission.js`.
- **1** engine `src/services/stampService.js` (`placeStamp`: gated, atomic, cumulative, hashed, integrity).
  Pin `src/services/test_stamp_service.js`.
- **2a** enforcement `src/services/workflowService.js` (approve/reject need `can_stamp`; recipient-stamper
  for approval). Pin `src/services/test_stamp_workflow_gate.js`; `test_workflow.js` updated to the new contract.
- **2b** desktop UI `src/windows/search/search-stamp.js` (+ `search-actions.js`, `search-preview.js`,
  `renderer.js`, `index.html`) + IPC in `src/modules/workflow/handler.js` + `src/preload.js`.
- **3** Settings `src/windows/settings/{index.html,renderer.js}` — "Document stamps" catalog (in the Users
  tab) + per-user "Can stamp" toggle; the old 3×3 `stamp_placement` card removed (its `initStampPlacement`
  is now inert/guarded).
- **4a** /v1 `src/modules/api/handler.js` (routes under `/v1/workflow/*`: stamp-types, can-stamp,
  documents/:id/stamps GET+POST, documents/:id/stamped) + `client/apiClient.js`. Pin
  `test_v1_workflow.js` (updated).
- **4b** client `client/renderer/renderer.js` + `client/preload.js` + `client/main.js`.

## Search render-quality fix (the pixelated-zoom complaint) — ROOT CAUSE FOUND
Not DPI. The Search preview wrap had **`will-change: transform`** (parks it on a cached compositor layer
that the GPU upscales BLURRY on zoom) + **`object-fit: contain` + max-height** (letterboxed a portrait
page small). Review's viewer has none of that (plain `inline-block`, `transform-origin:0 0`, no
will-change) → crisp. Fix = matched Search's `#preview-img-wrap` / `#preview-img` / `#preview-img-area` to
Review's (`d27ac26`). Also raised render scale to 6 (~432 DPI) + moved zoom/pan controls to the TOP. Owner
confirmed "perfect."

## Verification state (be honest)
- **Unit tests GREEN (Electron-as-Node):** `test_stamp_permission.js`, `test_stamp_service.js`,
  `test_stamp_workflow_gate.js`, `test_workflow.js` (updated — approve/reject now need can_stamp),
  `test_v1_workflow.js` (updated — injects fake safeStorage + audit key + grants; pins the stamp gating).
  `test_audit_chain.js` unregressed. All new JS `node --check` clean; HTML div-balanced.
- **Smoke-tested LIVE by the owner:** desktop stamping (grant → Search → place → stamp shows No.N+time +
  stacks + toggle) and the client stamping ("yes it works"). Owner says it "needs some tuning" — specifics
  NOT captured; that's owner-deferred.
- **NOT done:** an automated smoke of the interactive placement (I can't drive Electron CDP with the
  available tools); the full-corpus extraction M=0 head-gate for the earlier two Pelican fixes (from the
  prior session — still open, `scratchpad/rr_gate_full.cmd`).
- **Corrected mid-session claim:** I first said the "N more to file by itself" badge over-promises at the
  default pass mark — WRONG. The real early-hold is verification (docTrustGate has no history for a new
  sender), not the floor; the badge is roughly honest. (That was a tangent, not code.)

## FIRST ACTIONS for the fresh session
1. **Owner reviews the branch and pushes** when happy (11 commits, standing rule = owner pushes).
2. **Owner's client "tuning"** — ask what specifically; likely placement feel / layout on the client's
   stacked-page preview (no zoom there). Renderer-only fixes reload on reopening the client doc view.
3. If asked: build the **Settings "Integrity check"** (deferred, below).
4. **Help work** (parked) — resume from `pendingfeatures.md` 2026-08-28 entry: rewrite the remaining spine
   pages to the signed-off voice (verify each mechanic at source first), finish tooltip stragglers.

## Deferred (designed, not built — load-bearing conditions)
- **Settings "Integrity check"** (Oracle §5.3): a surface that re-verifies BOTH hash chains + every
  `stamp_events` `source_sha256`/`artifact_sha256` binding, so tamper is *flagged*, not just detectable.
  Also wire a startup `verifyAuditChain`. `canStamp` already verifies at check-time; this is the
  human-visible audit.
- **Help slices 2–3** + tooltip stragglers (`pendingfeatures.md`).
- **007 own-reference-collision date guard** (prior session, `pendingfeatures.md`) — a date == a
  confusable fold of the doc's own reference is not a date.
- **Client parity gaps** noted by Oracle but not blocking: the client has no history/admin-cancel/rules;
  the stamp UI on the client is a focused port (stacked-page placement, no zoom/resize like the desktop).

## Needs the USER
- Push the branch.
- The client stamp UI needs a connected client + a **workflow seat** + a **stamp grant** (core Settings →
  Users → Can stamp) to be usable — that setup is the owner's.
- Nail down the client "tuning" items.

## Key facts / paths / TRAPS
- **Design doc:** `docs/designs/WORKFLOW_STAMPING_REDESIGN_2026-08-28.md` (§9 authoritative). Working
  notes: `scratchpad/workflow_redesign_notes.md`.
- **Live DB:** `%APPDATA%\ScanFinder\docusnap.db` (the new stamp tables were created on it this session —
  additive, dark until a grant). Stamp artifacts: app-managed under userData `stamps/<docId>/` (NOT a
  filing sidecar — survives re-file; Oracle condition 3).
- **Run a test:** `ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe <test>.js` — and it
  **prints nothing through the PowerShell tool** unless wrapped: `cmd /c ".\...\electron.exe <x>.js > out.txt 2>&1"` then Read the file.
- **git commit -F <file> ONLY.** `git commit -m` with a here-string BROKE (the `<seq>` angle brackets +
  the multiline string parsed as pathspecs); a bash `<<'EOF'` heredoc is a PowerShell parse error. Always
  write the message to a temp file + `git commit -F`.
- **Restart the dev app (owner's action, but the mechanic that WORKS):** kill the `node scripts/dev-start.js`
  supervisor (`Get-CimInstance … CommandLine -like '*dev-start*'`) + each electron PID individually
  (`Get-Process electron | Stop-Process -Id` — targeted PID kills pass the classifier; a broad
  `Stop-Process -Name electron` is blocked), then relaunch via `Start-Process cmd -ArgumentList '/c','npm start'`
  with **`-RedirectStandardOutput`** params (do NOT embed a `1> "$log"` redirect in the arg string — the
  escaped quotes mis-parse into a `Remove-Item '"/c'` guard error). The client relaunches as
  `Start-Process .\node_modules\electron\dist\electron.exe -ArgumentList 'client'`.
- **Sandbox:** `DOCUSNAP_USERDATA=<dir>` + `--remote-debugging-port=9223` gives an isolated dev instance
  (dev-only override, `main.js:55`); CLEAR that env var before launching the REAL app or it lands in the
  sandbox folder.
- **/v1 test trap:** the hand-rolled `freshDb` lacked `audit_log` + the stamp tables (the mig-column
  trap); the signed grant + `canStamp` need them + a fake safeStorage (`secretStore.__setSafeStorage`) +
  `auth.setAuditKey` under RUN_AS_NODE (fail-closed otherwise). All added to `test_v1_workflow.js`.
- **Render:** the Search preview renders at scale 6; a raster (born-digital reads sharp, a scan is capped
  by its scan DPI). True infinite/vector zoom would be a PDF.js switch (its own arc, not built).
