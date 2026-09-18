# PLAN — Departments (the D2 visibility sweep + the rest) — 2026-09-15

The concrete, ordered build-out of Departments (who may see which documents). The DESIGN is already
Oracle-vetted at plan stage: `docs/designs/QUICKFILE_AND_DEPARTMENTS_PLAN_2026-09-12.md` §4 + §9
(conditions D-C1..D-C12). This doc is the REMAINING-work slice plan, grounded in the current built
state (verified at source 2026-09-15). Each build slice still takes the advisor + Oracle gate + the
corpus M=0 run before it flips a default.

The one rule (unchanged): **NULL department = shared = visible to everyone.** Zero backfill; every
existing row unchanged; byte-identical until a second department exists and docs are tagged.

## ⏭ BUILT 2026-09-17 — D4 (Settings IPC + UI), Oracle-vetted (SIGN OFF W/COND to build; SEND BACK the flip)
Advisor+Oracle gate cleared (eric IPC/UI · gary tests · Oracle final). Shipped DARK (switch stays OFF/inert):
- **Service** (`departmentService.js`): `renameDepartment` added (display-name only, slug STABLE = the backup
  remap key); the **write-side belt** — `setDocumentDepartment` refuses a NON-NULL tag while
  `departments_enabled` is OFF (OFF can't un-hide; un-tag→NULL always allowed); the **`INTAKE_GUARDED = false`
  flip gate** (Oracle item 8).
- **IPC** (`settings/handler.js`): `department-{list,users,create,rename,retire,delete,set-membership,set-all,
  set-enabled,get-state}`, every write `requireRole('admin')` forwarding the session actor. The **audit adapter**
  `_deptAudit` nests the whole meta under `metadata` (Oracle C2 — no `[object Object]` rows). `department-set-enabled`
  is a dedicated writer: Q9 side-effect (enabler gets `all_departments`), D-C8 tagged-count on disable, and it
  **refuses to turn ON while `INTAKE_GUARDED` is false** (the SEND-BACK enforcement).
- **Doc types**: `default_department_id` added to `updateType`'s whitelist + validated exists-AND-active (else
  dropped; Oracle C4).
- **Backup D-C3** (`backupService.js`): `departments` now a slug-keyed parent (upsertParent never DELETEs → M5-safe
  by construction); `document_types.default_department_id` remapped by slug (dangling → NULL, never foreign);
  the future folder-default settings excluded proactively.
- **UI** (`settings/index.html` + `renderer.js`): tab → "Users & Departments"; a Departments section (master toggle
  + the D-C7 sentence + list with rename/retire/delete); per-user membership tick-boxes + "All departments" in the
  Users rows; a "Default department" dropdown in the Document Types detail pane; `onDepartmentsChanged` live refresh.
- **Pins** (all green): `src/services/test_department_settings.js` (§A rename · §B belt · §C updateType · §D flip
  gate · §E audit-adapter source-contract), `src/services/test_department_backup_remap.js` (D-C3 round-trip +
  dangling→NULL + empty-safe), and `test_department_visibility.js` §5 updated for the belt.

### ⏭ BUILT 2026-09-18 — D2b (the intake bypass CLOSED, Oracle gate item 8)
Both intake lanes now enforce the D-C9 create rule via the new `departmentService.validateCreateDepartment`
(admin/all_departments or own active department; shared-at-create is admin-only while ON; a non-null tag is
refused while the switch is OFF — OFF can't un-hide). `directIntakeService.submit()` runs it BEFORE inserting
the row (no half-created doc on refusal — the no-bypass invariant: a non-admin can only create a doc it can then
see). `/v1 documents/intake` threads the uploader's `departmentId` under the server session and maps the refusals
(`widen_admin_only`→403, `departments_disabled`→409, `unknown_department`→400). Pins: `test_department_settings.js`
§F (the full gate matrix) + §G (source-contract that both lanes call it); `test_v1_intake` still green.

### ⏭ BUILT 2026-09-18 — the denial matrix (Oracle gate item 7) — the FLIP proof
`src/services/test_department_denial_matrix.js` (green): on a seeded status × department grid, the outsider
(writer, no department) sees ZERO restricted docs across search / review / deferred / stuck / bin / getByIds,
with a SYSTEM_ACTOR mutation oracle (real ⊊ unfiltered → the pin goes RED if any reader loses its fragment);
the route-PARTY carve-out both grants the routed doc AND does not leak the department's other docs (closed route
→ grant ends); the per-doc gate denies every restricted doc with `department_restricted`; /v1 threads the session
actor into its readers. Complements `test_department_visibility.js` §1-§15.

**FLIP GATE NOW GREEN** (Oracle items 6-8 all satisfied): D2b (intake) ✓ · denial matrix + mutation pin ✓ ·
intake-seam negative pins ✓. `INTAKE_GUARDED` can be flipped to `true` (a one-line change) to make the master
toggle reachable — **owner-approval-class** (it lets an admin turn departments on per install).

### ⏭ BUILT 2026-09-18 — D3 (per-doc tagger + insert-time precedence) + INTAKE_GUARDED FLIPPED
- **Per-doc tagger**: `set-document-department` + `get-assignable-departments` IPC in review/handler (forwarding
  the session actor + access/edit-lock/audit deps; the service enforces the D-C9 widening rule + belt). Preload
  `api.dept.setDocument` / `api.dept.assignable`. UI: a "Department" dropdown in the Review fields header
  (`#doc-dept-row`), hidden unless departments exist, options scoped to what THIS operator may assign (admin/
  all_departments → all + Shared; edit → own memberships), friendly refusal messages.
- **Insert-time precedence (D-C9)**: `departmentService.applyTypeDefaultAtConfirm` (ONE source) — a confirmed doc
  with no department inherits its type's default as `department_set_by='rule'`; a human `'user'` tag is never
  overridden; only while ON + an active default. Called from `reviewService.confirm`. Inert/byte-identical when
  unconfigured (corpus M=0 preserved).
- **`INTAKE_GUARDED` flipped to `true`** (owner go 2026-09-18): the master toggle is now reachable, so an admin can
  turn departments ON per install. `departments_enabled` stays seeded OFF (mig 164) — an opt-in, never a customer
  default. Turning it on is an admin action; the enabling admin gets `all_departments` (Q9).
- **Pins** (all green): `test_department_settings` §H (precedence) + §I (D3 source-contract) + §D (flip = true);
  every reviewService/review pin unregressed.

**Departments feature COMPLETE + enable-able.** Remaining optional slices (only if asked): D5 `{department}` folder
token, D6 bulk re-tag, a Search-row tagger (Review has it), watch/Quick-File folder-default dropdowns (D4-later),
D7 department×type deny. A Chris sandbox round on the live feature is a good next check before wide rollout.

## Already BUILT + WIRED (verified at source — do NOT rebuild)
- **D1 schema (mig 164):** `departments`, `user_departments`, `documents.department_id` + `department_set_by`,
  `document_types.default_department_id`, `users.all_departments`, `doctype_grants.department_id`.
  `departments_enabled` seeded OFF (DARK, stays a `dark_switches.js` master switch).
- **Per-document gate:** `accessService.canAccessDocument` + `departmentDecision`; DB primitive
  `database/modules/departmentVisibility.js` (`configured` / `decision` / `visibleDocSql`). Consumed by
  open-by-id (`processing/handler.js`), `/v1` (`api/handler.js`), workflow, stamp.
- **Assign-time route gate:** `workflowService._validateAssignTarget` → `RECIPIENT_NO_ACCESS` (D-C1;
  department-decision-only so it does not regress readonly/needs_review routing).
- **`department_set_by`** column (D-C2 shape).
- **D-C6 (the P1 precondition) SHIPPED:** `accessService.gateEnabled(isPackaged)` ignores the
  `ACCESS_GATE_ENABLED` env override on a packaged build (`accessService.js:48-50`).

## The gap
- **`visibleDocSql` is applied by ONE reader** (`documents.search`, threading `viewer` at documents.js:804).
  Every other list/count reader takes NO viewer and returns all rows. `src/services/departmentService.js`
  (the CRUD + `visibleDocSql` wrapper) is **orphaned** — nothing production requires it. No Settings UI.

---

## Slices (ordered; the sweep is the load-bearing one)

### D2 — the list/count sweep + consistency pin  ⭐ THE slice (Oracle: "a column with no enforcer is a trap")
Thread the real session viewer + append `departmentVisibility.visibleDocSql(db, viewer, alias)` (returns
`''` when the gate is off / actor is admin / no departments exist — the `learningExcludedSql` pattern) into
EVERY list/count surface, and make each CALLER pass the actor:
- `documents.getReviewQueue` (:182), `getDeferredQueue` (:300), `getReviewCount` (:522), `getDeferredCount`
- `documents.getByIds` (:312 — activity strip / auto-filed tile / quick-check grid), `getConfirmedDocsByIds`
  (:461), Learning History's `getDocumentsForFieldValue` (D-C4 — the four missed readers)
- the recycle bin list, dashboard counts, type-ahead suggestions, export facets, the Party autocomplete
- `open-document-file` / `show-in-explorer` + the `/v1 review/:id/viewing` heartbeat gain the per-doc gate
- the dev inspector becomes admin-only once departments exist
- **`search()` today FAILS OPEN if no viewer is passed** (documents.js:794 comment) — audit every caller
  now passes a real user, not null.
- **Count-broadcast collapse (D-C11, its own commit):** the 9 global `review-count-changed` broadcasters
  become one per-viewer `notifyCounts` (a global count leaks the existence of restricted docs).
- **Consistency pin (D-C5):** for every doc, `canAccessDocument(u,id).allow === (id ∈ search(u)) ||
  isOpenRouteParty(u,id)` — plus a MUTATION test that this pin goes RED when any one fragment is deleted.
  State the bin's role rule in the pin (it fails today on the bin otherwise).
- Gate: corpus M=0 (vacuous with no departments) + the denial matrix (role × status × membership × transport)
  + the consistency + mutation pins. Advisor (eric for the IPC/count refactor) + Oracle.

### D3 — taggers (insert-time + the tag UI)
Insert-time precedence (D-C9 create-time rule): explicit form/dropdown > watch/quickfile-folder default >
doc-type default > NULL; re-applied at confirm ONLY if still NULL AND `department_set_by='rule'` (re-derive
from the confirmed type). A "Department" chip + dropdown on each Search/Review row (edit/admin, audited
before→after). An edit user tags only a department they belong to; shared-at-create = admin/`all_departments`.

### D4 — Settings UI (wire the orphaned CRUD)
Settings → **Users & Departments**: add/rename/retire departments, per-user membership tick-boxes +
"All departments"; Document Types editor gains "Default department"; watch + Quick File folders gain a
Department dropdown. Wire `departmentService` (setMembership / setAllDepartments / setDocumentDepartment,
already built) to IPC. The enable sentence (D-C7): "Admins always see everything. Documents with no
department are visible to everyone. Departments restrict what Scan Finder shows — they do not change
Windows folder permissions." The enabler gets `all_departments` by default (owner Q9).

### D2b — the /v1 Quick File upload tagging  ⚠ (the watch-item from the flip)
`POST /v1/documents/intake` currently lands `department_id=NULL` (`api/handler.js` ~1174-1179). Once
Departments is enforced this is a department-BYPASS on the LAN lane. Thread departmentId + a
`canAccessDocument` check on the /v1 submit, mirroring the desktop `directIntakeService.update()`. MUST land
with (or before) enabling departments.

### Supporting conditions (fold into the slices above)
- **D-C3:** backup/restore remaps `default_department_id` + the folder-default settings BY SLUG (NULL on
  absence) — a raw-id restore can tag docs to a FOREIGN department.
- **D-C8:** switching the master switch OFF with tagged docs → refuse with the count, or a persistent banner
  (the read gate is data-driven, so tagged docs stay restricted regardless — tell the user).
- **D-C10:** system-route refusal (amountRouting) surfaced in the routing dry-run.
- **D-C12:** delete a department while referenced → REFUSED (fail-closed; `ON DELETE RESTRICT`); a retired
  department (`is_active=0`) still restricts.

### Later (only if asked)
- **D5** `{department}` folder token (opt-in, new filings only) so IT can put `Finance\`/`HR\` under NTFS ACLs.
- **D6** bulk "apply type defaults" / bulk re-tag.
- **D7** department×type deny via `doctype_grants.department_id` and/or multi-department docs.
- **Refused (Oracle DO-NOTHING):** the no-sidecar setting; auto-close of routes on membership change in v1.

## Build order
D-C6 (done) → **D2 (+ count-broadcast collapse + consistency/mutation pins)** → D3 + D4 (taggers + UI, so
the feature is usable) → D2b (/v1 tagging) → then flip `departments_enabled` behind the denial matrix +
M=0 + Oracle → D5/D6 as asked. Chris (sandboxed) after D4. Each slice: DARK master switch already exists;
byte-identical when empty; own pins; advisor + Oracle gate; `npm run test:pins` green; corpus M=0 for
anything touching confirm/filing.

## The trap to remember
"Byte-identical when empty" is TRUE for the data-gated reads but FALSE for the 9→1 count-broadcast refactor
and any helper-text change → those need their own pins (D-C11). The corpus M=0 gate only proves the reads
are byte-identical on a no-departments DB; the FEATURE safety (an outsider sees zero restricted docs across
every surface + transport) is proven ONLY by the denial matrix + consistency + mutation pins.
