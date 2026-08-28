# Workflow + Stamping redesign — consolidated design (2026-08-28)

> Status: **DESIGN — for owner sign-off. Nothing built.** Advisors: current-state map, eric
> (Electron/security), barry (UX). **Oracle: SIGN OFF WITH CONDITIONS — see §9 (the authoritative
> "what actually ships" layer; it corrects §2/§4 where noted).** Raw notes:
> `scratchpad/workflow_redesign_notes.md`.

## 0. The two invariants (everything below serves these)
1. **Routing integrity** — a document reaches ONLY its intended recipient; never leaks to another user,
   on desktop OR the detached client.
2. **Immutable, attributable stamps** — a stamp is a permanent record: "a true representation of what
   happened, when and by whom" (owner), confirming a document's order/delivery/payment status.

## 1. What the owner asked
- A **"Workflow feature"** button in Search → a popup with clearly separated sections (forward for
  approval / view; and — owner-confirmed — stamp it yourself). Today's Search corner mixes "Document
  Actions" and "Workflow" so it reads as 1-or-2 features.
- Approve/reject **and** custom stamps are **user-placed**: click in whitespace on the document.
- **Remove** the Settings "Approval stamp" placement (3×3 grid + size → one global placement).
  **Replace** with **custom stamp types** (paid, deferred, approved, rejected, …), creatable,
  selectable when stamping. Recommend the default set.
- Both self-stamping and forwarding are gated by a **new per-user stamp permission** (Settings → Users)
  that **must not be easily flipped by a DB edit**.
- Once stamped, Search **defaults to the stamped version**, with **view original**.
- The detached **client** app gets **full parity**.

## 2. The core reframe
Today a stamp is only a **side-effect of resolving an approval route** (approve/reject, one global
placement, page 1; `workflowService.resolve` → `pdfStamp.stampWorkflowDecision`). The redesign
**promotes stamping to a first-class action** and gives the whole feature **one home**. Two user-facing
"doors" (Respond-to-a-colleague, Stamp-it-yourself) share one engine.

## 3. UX (barry)

### 3.1 One button, one popup — kills "1 feature or 2?"
- **Right preview panel keeps FILE actions only** (Open, Delete, Send back to Review) — things done to
  the *file*.
- **Workflow gets one front door:** a single button **"Send or stamp…"** (stamp icon). It reads **"●
  Respond"** when a colleague has routed something to me. "Workflow" stays the internal/licensing name.
- The popup is **one titled tool** with a **segmented control** (two pills) + a persistent **History**
  strip:
  - **"Waiting on you"** card (only when a route is addressed to me) — `Approve` / `Reject`.
  - Segmented: **[ Send to someone ]** · **[ Stamp it myself ]**.
  - **Send** = today's assign flow re-homed: validated **recipient dropdown** (no free text), *"They
    need to approve it"* / *"Just so they've seen it (FYI)"*, optional note, **Send**.
  - **Stamp** = pick a stamp chip (colour-coded, grouped) + optional note → **Place stamp on the
    document**.
  - **History**: `PAID stamped by Jane · 12-08-2026`, `Approved by Tom …`, each with a *view* link.

### 3.2 Stamp catalog — recommended defaults
Colour language (ship as the rule): **green** = done/positive · **red** = stop/negative · **amber** =
pending · **blue** = process/info · **grey** = admin.

**Ship 6 (the everyday core):** PAID (green) · APPROVED (green) · REJECTED (red) · RECEIVED (blue) ·
ON HOLD (amber) · VOID (red — the immutability answer: never un-stamp, stamp VOID).

**Offer via "Add from catalog…"** (mirrors the doc-type preset pattern, one tick to add): ORDER PLACED,
ORDER CONFIRMED, DELIVERED, GOODS CHECKED, INVOICED, POSTED, CHECKED, PAYMENT RECEIVED, DEFERRED,
CANCELLED, FOR REVIEW, DUPLICATE, COPY, FILED.

### 3.3 Create a custom stamp
Tiny 3-field card (inline from the picker + an admin "Manage stamps" list in Settings): **word** (≤~16
chars, auto-uppercased) · **colour** (5 house swatches, not a wheel) · **group** (optional). Live
preview. Guards (gentle, inline): empty/whitespace → disabled; exact duplicate → *"You already have a
'PAID' stamp."*; re-creating a built-in decision word (APPROVED/REJECTED/VOID) → blocked; near-duplicate
→ soft warning; length cap with counter. No icon/logo upload in v1.

### 3.4 Place by clicking whitespace
Preview enters placement mode (reuse the review ⊕ draw / client draw-on-preview muscle): guidance bar
*"Click a blank area to drop your PAID stamp"*, **live ghost** on the cursor, click drops it, **drag to
move / one corner handle to resize** (sensible default size so most never touch it), soft **overlap
nudge** if it lands on dense text (optional whitespace auto-drop). **Two-step commit**, everything
undoable until the last click, with an unmissable permanence line:

> *"This is permanent. The stamp will show your name (Jane) and today's date, and can't be removed. If
> it's wrong later, you can add a VOID stamp."*

### 3.5 Stamped-default + view original
When a doc has ≥1 stamp, the preview shows the **stamped render by default** with a top-right toggle
**Showing: Stamped ▾ / Original** and the helper *"Your original is never changed. Stamps are added to a
copy."* A **🏷 N stamps** badge on the result row and in the preview; clicking it highlights each stamp
and lists who/when/note.

### 3.6 Edge cases (with copy)
- **No stamp permission** (but can Send): the "Stamp it myself" pill is **visible but disabled** —
  *"Ask an admin to switch on stamping for you."* (Server re-checks regardless.)
- **Readonly**: popup opens read-only — History visible, both pills disabled, can still toggle
  Original/Stamped.
- **Already stamped**: add another (lifecycle). Wrong stamp → add **VOID**, never remove.
- **Respond vs Stamp = two doors, one engine.** Approving a routed request **auto-places an APPROVED
  stamp** (auto-dropped on whitespace — keep the one-click arm). Standalone stamping is the explicit
  place→confirm flow. Doors labelled by **intent**, not mechanism.

## 4. Architecture (eric)

### 4.1 Stamp permission — tamper-resistant
- **No `can_stamp` column.** `canStamp(userId)` is a **main-process projection** folding **signed
  grant/revoke events** — each HMAC-signed over `(user_id,'stamp',granted_by,granted_at,kid)` with the
  DPAPI-held key and written as `audit_log` rows so they ride the **existing verified hash chain**. A
  hand-edited grant fails `verifyAuditChain` → stamp refused + a `tamper_detected` audit row. (Fallback
  if a column is wanted: a signed-append `user_grants` table, latest-row-wins, sig-verified.)
- **Separate grant, not role-derived** — an `edit` user does not auto-stamp. **Admin-only** grant in
  Settings → Users.
- **Key** via `secretStore` (Electron `safeStorage`/DPAPI), **out of the DB and out of backups**.
- **Enforced main-process-only, per transport:** new `requireStampPermission()` on every stamp IPC; the
  same projection checked server-side before any `/v1` stamp route. The renderer/client never self-grants.
- **SEAM — fail CLOSED:** the audit key fails *open* (defence-in-depth); a permission gate must fail
  *closed*. On a DPAPI-less host (headless / `RUN_AS_NODE`) stamping is **refused**. Owner sign-off on
  that (it is not a normal packaged Windows session).

### 4.2 Immutable, attributable stamp records
- New **append-only, hash-chained `stamp_events`** table = record-of-truth. Columns: `id, document_id,
  stamp_type_id, type_label_snapshot, type_color_snapshot, placed_by_user_id, placed_by_username_snapshot,
  placed_at, placement_json{x,y,w,page}, source_sha256, artifact_path, artifact_sha256, route_id?,
  kid, prev_hash, row_hmac`. Append-only triggers (copy the `route_decisions` pattern) + the DPAPI chain.
- **Cross-link into `audit_log`** (one audit row per stamp carrying `stamp_events.row_hmac`) so a
  whole-table swap can't pass on its own internal chain alone.
- **`source_sha256`** binds the stamp to *what it stamped* → a later reprocess/re-file that changes the
  document is **detectable**.
- **`stamp_types(id,key,label,color,created_by,active)`** catalog (mutable), but **label+colour are
  snapshotted into `stamp_events` at placement**, so renaming/deleting a type never rewrites history.
- Turn `WORKFLOW_DECISION_SNAPSHOT` **ON** for the decision path; `stamp_events` supersedes it as the
  stamp source-of-truth.

### 4.3 Routing integrity — 3 gaps the stamp feature must NOT open
1. The stamp write takes **coords + type only**; the placer is `actor()`, never a payload field.
2. A self-stamp has **no `to_user_id` gate** → the stamp write **and** the stamped-pages read must gate
   on **`accessService.canAccessDocument`** (else a permitted stamper could view a document they can't
   otherwise access — the SEC-03 class).
3. `/v1` stamping sits behind the **workflow add-on entitlement** (else an unlicensed client gets it free).

### 4.4 Click-to-place mechanics
Reuse the review renderer's capture math (`naturalWidth/offsetWidth`). **Measure off the `<img>`, not the
zoom-transformed wrapper** (or divide out `previewZoom`); guard on `img.complete`/`naturalWidth>0`.
Renderer sends `{documentId, stampTypeId, box:{x,y,w}, page}` **coords only**; **main** re-derives the
source path and calls `pdfStamp.stampPdf` (pdf-lib origin-flip + on-page clamp already exist).

### 4.5 Stamped-default + client parity
- **No mutable "current stamped" pointer.** Resolve the current artifact from the **append-only
  `stamp_events`** (latest non-superseded). "View original" serves `documents.resolveFilePath`.
- **Cumulative rendering (recommended):** each new stamp is applied atop the current stamped artifact, so
  `source_sha256[N] = artifact_sha256[N-1]` and the chain also encodes stamp order. (Owner decision —
  §6.1.)
- Serve **path-free by id** (generalise the existing `stamped-viewer` reader). Never ship a path/PDF
  bytes to any renderer.
- **New `/v1` endpoints** (path-stripped DTOs, permission+access+entitlement gated): `GET
  /v1/stamp-types`, `GET /v1/documents/:id/stamps`, `POST /v1/documents/:id/stamps`, `GET
  /v1/documents/:id/stamped`. **Bump `API_CONTRACT_VERSION`** + client **feature-detects** (hides stamp
  UI against an older server).
- The client is a **separate codebase** (its own `decisionBar`/`assignControl`) — the popup, picker,
  placement, and toggle must be **ported**. This is the single biggest hidden cost.

## 5. What CANNOT be made truly safe (decide with open eyes)
1. **Tamper-evident, not tamper-proof.** DPAPI is user-bound. This fully stops a shared-office
   `edit`/`readonly` user from self-granting or forging a stamp, and stops any detached-client user cold
   (server-authoritative — no local authoritative DB). It does **not** stop the core PC's own
   admin/owner (a different threat model).
2. **The stamped PDF is a file on disk** — copyable/editable outside the app. `artifact_sha256` proves a
   given copy authentic; it cannot prevent a doctored copy existing. The record is the truth; the file is
   a derivative.
3. **A broken chain is invisible until verified** → add a startup `verifyAuditChain` + a Settings
   **"Integrity check"** that re-verifies both chains and the `source_sha256` bindings.
4. **Fail-closed stamping** costs usability on a DPAPI-less host — the right call for an authz gate, but
   a deliberate departure from the audit key's fail-open.

## 6. Open owner decisions
1. **Cumulative vs independent stamping** (§4.5) — recommend **cumulative** (stamps accumulate on one
   document; matches PAID-on-an-APPROVED-doc).
2. **Permission scope** — recommend a **distinct "Can stamp documents"** grant that gates stamping only,
   while Send/Approve stays on the admin/edit role. (Alternative: one per-user "workflow" permission
   gating both — simpler, coarser.)
3. **Fail-closed stamping on a DPAPI-less/headless host** (§5.4) — accept? (Recommend yes.)
4. **The default stamp set** (§3.2) — approve the 6 + the catalog list.
5. **Forward intents** — confirm the popup forwards **for-approval** or **for-info (FYI)** only; "reject"
   is the recipient's decision, not a separate forward intent.

## 7. Delivery slices (proposed; each gated, each Oracle-signed before flip)
0. ✅ **DONE 2026-08-28 (dark, uncommitted) — Data + permission spine.** `stamp_types` (+6 defaults) &
   append-only `stamp_events` (triggers), both idempotent ensure-blocks in `database/index.js`; permission
   data in `database/modules/auth.js` (`addStampGrantEvent`/`latestStampGrantState` — signed audit
   events, no flag column); the fail-closed check-time policy in `src/modules/auth/stampPermission.js`
   (`canStamp`/`requireStampPermission`/`grantStamp`/`revokeStamp`); catalog data-access +
   create-guards in `database/modules/stamps.js`. **Gate MET** (`src/modules/auth/test_stamp_permission.js`,
   ALL OK): 6 defaults seeded; append-only blocks UPDATE/DELETE; no-grant→refused, admin grant→allowed,
   revoke→refused; **fail-closed without real DPAPI**; **a hand-INSERTed forged grant breaks the chain →
   refused + `tamper_detected`** (Oracle gate 1); `test_audit_chain.js` still green (no regression);
   nothing live reads the new objects → OFF == byte-identical.
1. **Stamp engine:** `pdfStamp` gains the type catalog + non-decision stamps + cumulative render from
   records; `source/artifact_sha256`. Gate: round-trip + clamp + integrity-check tests.
2. **Search popup + click-to-place + stamped-default toggle** (desktop). Gate: coord-mapping unit test;
   permission/access/readonly disabled-states; no path leaves main.
3. **Settings:** remove the 3×3 placement card; add "Manage stamps" (catalog CRUD) + the Users grant UI.
4. **/v1 + client parity:** new endpoints (gated, path-stripped), contract bump + feature-detect, ported
   client popup/picker/placement/toggle. Gate: `/v1` security suite (B can't stamp/view A's doc; body
   `placed_by` ignored; un-permitted 403; un-entitled 402).

## 8. Files that carry the change
`database/modules/auth.js` (grant projection, reuse chain), `database/modules/workflow.js` + new
`database/modules/stamps.js`, `database/index.js` (tables/triggers/migration); `src/services/`
`workflowService.js` (self-stamp entry), `pdfStamp.js` (catalog + non-decision + cumulative), `dto.js`
(path-stripped stamp DTOs), `entitlementService.js` (stamp gate); `src/modules/auth/handler.js`
(`requireStampPermission`), `src/modules/workflow/handler.js` + `src/modules/api/handler.js` (IPC + `/v1`
+ contract bump); `src/lib/secretStore.js`/`auditKey.js` (key); `src/windows/search/`
(`search-actions.js` split, `search-workflow.js` re-home, `search-preview.js` placement),
`src/windows/settings/renderer.js` (remove 3×3, add catalog + grant UI), `src/windows/stamped-viewer/`
(reuse for stamped render), and the `client/` screens (ported).

## 9. Oracle vet — SIGN OFF WITH CONDITIONS (authoritative)
Verdict: the reframe is the right layer; the signed-grant permission is warranted (not over-built). Two
ship-blocker seams neither specialist owned + real missed cases, all specific and testable.

### Corrections to §2/§4 (the doc above overstates these)
- **§4.1 "a hand-edited grant fails `verifyAuditChain`" is NOT true of current code.** `verifyAuditChain`
  runs ONLY on a manual button (`auth/handler.js:506`, `settings/renderer.js:6311`) — nothing automatic
  (`main.js:1190` sets the key, never verifies). And the append-only triggers block UPDATE/DELETE but
  **not INSERT** (`index.js:1228-1232`) — the grant attack is an *append*. So `canStamp` MUST verify at
  **check-time**; startup-only verify misses a mid-session INSERT.
- **§4.2 `source_sha256` does NOT detect a reprocess/re-file.** Filing COPIES bytes
  (`filing/handler.js:218`); reprocess rewrites DB rows, not PDF bytes. `source_sha256` detects an
  *out-of-band byte edit* to the filed PDF. Reword; the slice-1 integrity test must NOT assert a
  legitimate reprocess trips it.
- **The `stamp_events` internal `prev_hash/row_hmac` self-chain is OVER-BUILT.** The **audit cross-link**
  is the real anchor (forging a stamp row needs a matching signed `audit_log` row → needs the DPAPI key,
  `auth.js:230-235`). Keep append-only triggers + audit cross-link; the stamp-table self-chain is
  optional, not load-bearing.
- Fork rulings: **cumulative render OK** (but breaks on re-file, gate 3); **`WORKFLOW_DECISION_SNAPSHOT`
  ON is safe** but keep it for the decision path (not "superseded").

### HARD GATES (ship-blockers)
1. **`canStamp` verifies at check-time.** Gate on `secretStore.available() === true` (true DPAPI — NOT
   merely "key non-null"; under `ELECTRON_RUN_AS_NODE` the key is non-null-but-plaintext/forgeable,
   `secretStore.js:30-37`) **AND** `verifyAuditChain(db).ok` (or re-derive the grant rows' HMACs) before
   honouring the latest grant; on failure → refuse + append a `tamper_detected` audit row. *Pin:* valid
   grant → allowed; hand-**INSERT** a tail grant with garbage `row_hmac` → refused + `tamper_detected`
   (the test reproduces an INSERT, not an UPDATE).
2. **/v1 stamp routes gate as WORKFLOW.** The entitlement gate keys off URL prefix (`api/handler.js:219`
   `FEATURE_ROUTE`, `:220` `WORKFLOW_ROUTE`), so the §4.5 URLs leak: `/v1/stamp-types` matches neither
   (no gate); `/v1/documents/:id/stamps` gates as SEARCH with no workflow sub-seat → a search-only client
   stamps free once unbundled. **Put them under `/v1/workflow/...`** (`/v1/workflow/stamp-types`,
   `/v1/workflow/documents/:id/stamps`, `/stamped`). *Pin (/v1 security suite):* search-only/un-entitled
   → 402 on every stamp route incl. stamp-types; workflow seat claimed; **B cannot stamp or read A's
   doc**; body `placed_by` ignored (actor from `actorOf`); un-permitted → 403.

### CONDITIONS
3. **Artifact survives re-file.** Re-file copies the PDF to a new folder + deletes the old
   (`filing/handler.js:205-218`) but NOT the stamped sidecar (`pdfStamp.js:170-176`) → orphaned,
   `artifact_path` stale, "Showing: Stamped" finds nothing. Store the artifact **app-managed,
   doc-id-keyed** (like `working_path`/inbox), OR relocate + rewrite `artifact_path` on every re-file;
   integrity check re-binds a moved-but-byte-identical artifact rather than flagging.
4. **One stamped-read gate.** Today's read is by-route (party-gated, any state,
   `workflow/handler.js:139-165`); the design's by-doc reader gates on `canAccessDocument` (OPEN-routes
   only; readonly needs `status='confirmed'`, `accessService.js:63-88`). Because `resolve()` never sets
   `documents.status` (`workflowService.js:295`), an approved-but-unconfirmed doc gives divergent answers.
   Reconcile to one rule that admits closed-route parties to the *artifact*. *Pin:* readonly recipient,
   approved+unconfirmed → History and the Stamped toggle agree.
5. **Desktop self-stamp is a CORE capability.** Reusing the workflow IPC inherits `assertEntitled()`
   (`workflow/handler.js:89-168`) → a standalone core user (the owner's primary user) couldn't self-stamp.
   Gate desktop self-stamp on **`requireStampPermission` + `canAccessDocument`, NOT `assertEntitled`**;
   `/v1` stamp keeps the add-on gate. *Pin:* standalone install + grant → self-stamps; without grant →
   server-refused (not just UI-disabled).
6. **Self-stamp write is ATOMIC** (artifact + `stamp_events` row + audit cross-link) — NOT
   fire-and-forget like the decision derivative (`workflowService.js:315-322`); for a self-stamp the
   record IS the truth, so an artifact-without-row (or vice-versa) is a silent integrity gap.
7. **Reword `source_sha256`** (see corrections) + integrity test carve-out for legitimate reprocess/re-file.
8. **Stamp DTOs strip `artifact_path`/source path** (`dto.js:94-96` discipline); expose
   `has_stamp`/counts/hashes only.
9. **Test harness:** stamp happy-path tests inject `secretStore.__setSafeStorage(...)`
   (`secretStore.js:67-69`) so fail-closed doesn't false-red the suite; slice-0 OFF==byte-identical control.

### Geometry / UX notes
- The `box` carries **width only**; height follows content (`pdfStamp.js:119-121`) → "corner handle to
  resize" maps to **width only**, not free height.
- Client draw-on-preview is a **separate codebase** with its own capture math → pin the coord-mapping
  test on **both** desktop and client (measure off natural `<img>`, divide out `previewZoom`, guard
  `img.complete`).
- Removing the 3×3 `stamp_placement` changes a **shipped** approve/reject path (`pdfStamp.js:220-224`) →
  gate that approve/reject still renders (auto-whitespace-drop).

### Permission model (owner-refined 2026-08-28, SIGNED OFF by owner)
`can_stamp` gates **only the acts that PLACE a stamp**:
- **self-stamping** (place any stamp standalone), and
- **approve / reject** a routed request (which auto-places the APPROVED/REJECTED stamp).

**Routing (the SENDER) is NOT gated** by `can_stamp` (owner: "a standard user should be able to send an
invoice to accounts for approval — it is the stamping in the accounts dept that should be gated").
Forwarding keeps its EXISTING sender role rule (`assign` = `admin|edit`, unchanged); acknowledging and
viewing stay open. Only the stamp placement + the approve/reject resolution consult `can_stamp`
(`resolve()` gains the check — a tighten on the shipped, dark approve/reject gate; seam: an `admin|edit`
recipient without the grant can view/acknowledge but cannot approve/reject).

**But you cannot route FOR APPROVAL to a non-stamper** (owner 2026-08-28): a forward with
`actionRequired='approve'` must validate the **RECIPIENT** holds `can_stamp` — else the approval is a
dead-end nobody can action. This extends `_validateAssignTarget` (`workflowService.js:178`, alongside the
existing exists+active checks) with a new refusal code (e.g. `RECIPIENT_CANNOT_STAMP`); it does NOT gate
the sender. A forward FOR VIEW has no such requirement. **UI:** when "needs their approval" is chosen the
recipient dropdown lists only stampers; `GET /v1/workflow/recipients` gains a `canStamp` flag per user so
the client filters identically. *Pin:* assign-for-approval to a non-stamper → refused; to a stamper →
ok; assign-for-view to anyone → ok.

**UI rule (owner overrides barry's visible-but-disabled):** a user WITHOUT the permission does **not see**
the "Stamp it myself" option **at all** (hidden). If a document was routed to them for approval and they
lack the grant, the Approve/Reject buttons are hidden with a plain note ("Approving needs stamping — ask
an admin to switch it on"); they can still view/acknowledge. The **server denies any stamp/approve
regardless** of UI state (belt-and-braces — Oracle's mandatory enforcement). Grant is admin-only in
Settings → Users, via the signed-event mechanism (§4.1 / §9 gate 1).

### RESIDUALS the owner must accept (documented, not fixed)
- **Stamping is globally disabled whenever the audit chain can't verify** — including benign key-loss or a
  DB restored to a new machine (`no_key`). This is the correct fail-closed direction but it means a
  key-loss stops ALL stamping and makes existing stamps unverifiable until repaired. (State plainly.)
- **Tamper-evident, not tamper-proof** against the core PC's own admin/owner (different threat model).
- **The stamped PDF is a copyable on-disk derivative** — `artifact_sha256` proves a copy authentic but
  can't prevent a doctored copy existing. The record is the truth; the file is a derivative.

Clear the two hard gates + conditions 3–6 and this is a clean, correctly-layered feature.
