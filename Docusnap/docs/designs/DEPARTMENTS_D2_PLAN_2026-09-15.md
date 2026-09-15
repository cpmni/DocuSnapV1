# PLAN — Departments (the D2 visibility sweep + the rest) — 2026-09-15

The concrete, ordered build-out of Departments (who may see which documents). The DESIGN is already
Oracle-vetted at plan stage: `docs/designs/QUICKFILE_AND_DEPARTMENTS_PLAN_2026-09-12.md` §4 + §9
(conditions D-C1..D-C12). This doc is the REMAINING-work slice plan, grounded in the current built
state (verified at source 2026-09-15). Each build slice still takes the advisor + Oracle gate + the
corpus M=0 run before it flips a default.

The one rule (unchanged): **NULL department = shared = visible to everyone.** Zero backfill; every
existing row unchanged; byte-identical until a second department exists and docs are tagged.

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
