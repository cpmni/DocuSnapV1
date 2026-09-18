# Departments D7 — Multi-department document visibility (design)

**Status:** ✅ **BUILT 2026-09-18** (owner approved) — all DARK, `departments_enabled` stays opt-in. mig **184**
(transactional). All conditions below folded in (incl. the Oracle #3 own-slice widening fix). Pins green: the
five `test_department_*.js` (migration-invariant, visibility, denial-matrix incl. multi-tag + MIN oracle,
settings, backup-remap) + zero regressions across 306 database/modules/services pins (the one red is the
pre-existing `test_ref_class_fix` flake). **Before build (this doc's original gate)** — advisor + Oracle: Advisors: barry (UX), eric (schema/gate/IPC), gary (migration/tests),
Oracle (final vet). Builds DARK (byte-identical when no departments); `departments_enabled` stays seeded OFF
(admin opt-in). Supersedes the single-select "Default department" control shipped 2026-09-18.

## The requirement (owner, 2026-09-18)
A document type — and a document — should be assignable to **several departments at once**, not one. A person
sees a document if they belong to **any** of its departments. "People who don't have finance permissions won't
see finance docs, but there may be a group of finance docs they're allowed to see if the user belongs to, say,
Admin — those docs are permissible as Admin has also been ticked." So visibility is **OR across a set**.

The per-**user** side is already many-to-many (a person can be in several departments). This makes the
**document** side match.

---

## 1. The model — the one load-bearing decision
**Empty set = Shared = visible to everyone**, exactly as `department_id IS NULL` means today (keeps the
migration byte-identical). BUT the UI must **never let a user reach empty by unticking** — that would silently
turn a locked-down doc public. "Everyone (shared)" is always an explicit, deliberate choice (a sticky radio),
never the by-product of clearing tick-boxes. Model-side: zero rows = shared. UX-side: shared is an act.

---

## 2. Schema — `mig 184` (additive, idempotent `tableExists` guards, mirroring mig 164)
Chosen shape: a fully-normalised join; retire the scalars (no "primary department" — in an OR model there is
no primary, and a denormalised primary imposes a sync invariant for no gain; no live filing reads the scalar —
the `{department}` folder token D5 is unbuilt).

```sql
CREATE TABLE document_departments (
  document_id   INTEGER NOT NULL REFERENCES documents(id)   ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  PRIMARY KEY (document_id, department_id)
);
CREATE INDEX idx_docdept_dept ON document_departments(department_id);   -- reverse join + delete count (Oracle #6)

CREATE TABLE document_type_departments (
  document_type_id INTEGER NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
  department_id    INTEGER NOT NULL REFERENCES departments(id)    ON DELETE CASCADE,
  PRIMARY KEY (document_type_id, department_id)
);
```

**ON DELETE (Oracle #2 SIGN OFF, `foreign_keys=ON` verified at `database/index.js:46`):**
- `document_departments.department_id = RESTRICT` — a dept delete is refused at the DB while any doc references
  it (CASCADE would silently drop a doc to shared = fail-**open**; the exact hazard mig 164 rejected SET NULL for).
- `document_departments.document_id = CASCADE` — a hard-purged doc drops its tags (docs are normally soft-deleted).
- `document_type_departments` CASCADE both — a type default is a convenience, not a security boundary (mirrors
  today's `default_department_id ON DELETE SET NULL`); a dept delete just narrows a type default set, and is NOT
  blocked by type-default rows (matches today: `deleteDepartment` counts documents only).

**Migration (single → multi), Oracle #1 CONDITION — must be ONE transaction:**
1. Create the two join tables.
2. `INSERT INTO document_departments SELECT id, department_id FROM documents WHERE department_id IS NOT NULL;`
   and the analogous `document_type_departments` from `default_department_id IS NOT NULL`.
3. `UPDATE documents SET department_id = NULL;` `UPDATE document_types SET default_department_id = NULL;`
   (the join becomes the sole FK authority; a NULL scalar can't fire its own RESTRICT on a dept delete).

**Scalar disposition — NULL then retire-in-place (Oracle #1):** keep the columns (all-NULL), do NOT `DROP`
(SQLite drop = full-table rewrite, blocked by `idx_documents_department`). A pin greps that **nothing outside the
migration reads `documents.department_id` / `document_types.default_department_id`**; a one-line "vestigial —
read the join" comment sits at each. `department_set_by` stays as-is (doc-level provenance, 'rule'|'user'|NULL —
not a department id).

**Rollback = GO-FORWARD-ONLY (stated explicitly, Oracle #1).** There is no scalar disposition that fully
fail-closes a downgrade (the join is strictly more expressive). A downgrade past mig 184 with departments enabled
would read the all-NULL scalar → treat tagged docs as shared → **exposure**. Ship a Help/ops note; add version 184
to any existing "DB newer than code" guard if one exists; do NOT build a new bricking tripwire for this alone
(blast radius exceeds the risk on a forward-only, opt-in, Store-delivered feature).

---

## 3. Read gate — member of ANY of the doc's departments (inert when empty)
`database/modules/departmentVisibility.js`. Short-circuit order preserved (Oracle #4a): SYSTEM_ACTOR →
not-configured → admin → all_departments **before** any EXISTS query (inert installs never query, never need a
real id). "Shared" = zero join rows.

`decision(db, user, doc)` — tightens from `doc.department_id` to `doc.id` (all real callers pass a `getById`
row; only pins pass synthetic docs, under SYSTEM_ACTOR which short-circuits first):
```
tagged = EXISTS(SELECT 1 FROM document_departments WHERE document_id = doc.id)
if !tagged: allow (shared)
if admin or all_departments(uid): allow
allow iff EXISTS(document_departments dd JOIN user_departments ud ON ud.department_id=dd.department_id
                 WHERE dd.document_id = doc.id AND ud.user_id = uid)
```
`visibleDocSql(db, user, alias='d')` — keep the `''`/admin/all_departments/unconfigured short-circuits
byte-identical; the member clause changes from `IN(…)` on the scalar to correlated EXISTS on the doc PK
(`${alias}.id`). All ~13 readers already go through this one helper — **no call-site edits**.
```sql
AND ( NOT EXISTS (SELECT 1 FROM document_departments dd0 WHERE dd0.document_id = d.id)
   OR EXISTS (SELECT 1 FROM document_departments dd1
              JOIN user_departments ud1 ON ud1.department_id = dd1.department_id
              WHERE dd1.document_id = d.id AND ud1.user_id = <uid>) )
-- unknown/blank viewer → fail-closed shared-only: AND NOT EXISTS(... dd0 ...)
```
Byte-identical RESULT when no doc is tagged (NOT EXISTS universally true = every doc visible = today). The SQL
**string** changes (EXISTS vs IN) → any pin asserting SQL-string identity moves to RESULT identity (the existing
§1-§15 assert behaviour, so fine). Cost: the shared fast-path (`deptId==null`) is gone — each non-admin,
configured, per-doc `decision` call issues one bounded single-doc EXISTS (Oracle #4b, acceptable).

---

## 4. Write side (`src/services/departmentService.js`)
### The D-C9 widening rule for a SET — Oracle #3 FIX (own-slice / immutable-foreign)
The naïve `(next △ old) ⊆ mine ∧ next ≠ ∅` is WRONG — it allows a self/team lockout (old={Fin,HR}, actor∈{Fin},
next={HR} → allowed but the result is invisible to the actor and to Finance) and is ambiguous against the client
payload. **Correct rule:** the foreign slice is **immutable and preserved**; a non-admin edits only their own slice.
```
mine        = the actor's own department ids
ownSelection = the departments the actor ticked (⊆ mine by construction of the UI; validated server-side)
effective   = ownSelection ∪ (old \ mine)          -- foreign tags survive untouched
require: role ∈ {admin, edit}; not readonly
  admin / all_departments: may write ANY set, including ∅ (= shared)
  edit: require ownSelection ⊆ mine  AND  ownSelection ≠ ∅   (⟺ effective ∩ mine ≠ ∅ — never self-locks)
  write-side belt: any non-empty target refused while departments_enabled OFF ('departments_disabled');
                   clearing to ∅ (admin repair) always allowed
  every target dept must be an existing ACTIVE department
```
This reduces to today's singleton rule, blocks the {Fin}→{HR} hand-off as admin-only, blocks self/team lockout,
and removes the payload ambiguity. barry's locked-chip UI becomes defence-in-depth, not the sole guard.
Write = one transaction (delete the doc's rows, insert `effective`), audit meta `{document_id, from:[…], to:[…]}`.

`setDocumentDepartment` (single) → `setDocumentDepartments(db, actor, docId, deptIds[])`.
`validateCreateDepartment` (intake) → `validateCreateDepartments(db, actor, deptIds[])` — same rule at create
(no docId): `[]` = shared → admin/all_departments only while ON, else allowed when OFF; each target active;
privileged OR `⊆ mine`. Returns `{ok, target: number[]}`. `directIntakeService` + `/v1 intake` thread
`departmentIds[]`.
`applyTypeDefaultAtConfirm` — the type default is now a SET: apply the type's ACTIVE default set only when the
doc has zero tags AND `department_set_by != 'user'` (a human 'user' set is never overridden — D-C2); stamp 'rule'.
**Type default write** = a NEW admin-only `setTypeDefaultDepartments(db, actor, typeId, deptIds[])` (each active);
**drop `default_department_id` from `updateType`'s allowed list** (Oracle #7 — no second write path).

---

## 5. Delete / retire (Oracle #2 + #5)
`deleteDepartment` in-use count moves `documents.department_id` → `SELECT COUNT(*) FROM document_departments
WHERE department_id=?` (counts retired-dept members too); the DB `RESTRICT` is the backstop if the service check
is bypassed. `retireDepartment` unchanged (a retired dept still restricts as a set member). A **silent shared-drop
cannot happen via delete** (RESTRICT-blocked while any row references the dept); it can only happen via the
intentional admin bulk-move/retag path (future D6) — barry's "sole-department" leak-warning must be wired to
**that** path, and it must warn + audit.

---

## 6. UX (barry; + Chris 2026-09-18 Card B folded in)
**Document TYPE** — heading "**Who can see documents of this type?**" (rename from "Default department"):
```
( ) Everyone
(•) Only people in these departments:   ☑ Finance  ☑ Admin  ☐ HR
    These become the starting departments for new documents of this type. You can still change any document later.
```
Empty state (no departments configured): hide the chooser, one line "You haven't set up any departments. All
documents are visible to everyone." Collapsed summary names them ("Finance, Admin"), or "Everyone".

**Per-DOCUMENT (Review)** — chips + add:
```
Visible to:  [Finance ✕] [Admin ✕]  [ + Department ▾ ]     "People in Finance or Admin can see this."
```
- Helper copy says "**or**", never "+" (a plus reads as "both/combined").
- **Edit user:** departments they're not in show as **locked chips** `[HR 🔒]` ("You're not in HR — only an admin
  can change this") — can't remove; can't add a dept they're not in; can't choose "Everyone" (widen-to-shared =
  admin-only); can't remove their last own-department (server enforces via §4).
- **Admin / all_departments:** full control incl. "Everyone".
- **Retired dept in a set:** distinct greyed chip `[Finance (retired)]` — visible for cleanup, never auto-removed.

**Chris Card B (fold in):** on the Users list, an **admin** row must NOT show department tick-boxes + an
"All departments" toggle (it contradicts "admins see everything" and reads as a setting they must switch on).
Replace with a greyed line "**Admins see every department — nothing to set here.**" Keep "All departments" for
edit users visually distinct from the department checkboxes (a user capability, not a department).
**Chris Card A/C (queued, cheap):** a one-line "Retire vs Delete" explainer under each department row; a fuller
master-switch confirmation reminding untagged docs stay visible. Optional: nudge customers away from naming a
department "Admin" (confusable with the admin role).

**Naming:** avoid "filed under" (folder connotation — the D-C7 sentence worked to separate visibility from
Windows folders); reserve it for the future `{department}` folder token (D5). Per-doc label = "Visible to".

---

## 7. Backup (D-C3, eric §5)
`document_type_departments` is IN scope, **slug-projected** `[{type_slug, department_slug}]` (never raw ids).
Restore order: `departments` upsert-by-slug (deptMap) → `document_types` upsert-by-slug (typeMap) → insert the
type-default join resolving both slugs; **drop any row whose department slug doesn't resolve** (dangling → the
type loses that default = reverts toward shared-at-confirm, never a foreign id). `document_departments` (per-doc)
stays OUT (documents out of scope). A restored dept has zero members = fail-closed until an admin sets membership.

---

## 8. IPC / preload deltas (back-compat shims for the just-shipped single-select)
- `set-document-department(docId, deptId)` — keep as a shim (`null→[]`, `number→[deptId]`); ADD
  `set-document-departments(docId, deptIds[])`.
- ADD `get-document-departments(docId)` (access-gated read of the doc's current set) for the multi-select tagger.
- ADD `department-set-type-default({typeId, deptIds})` (admin) + `department-get-type-defaults()` → `{typeId:[…]}`.
- `get-assignable-departments` unchanged (already returns `departments[]` + `canShare`).
- `dept:` preload additions: `setDocumentSet(docId, deptIds)`, `getDocument(docId)`, `setTypeDefault(typeId,
  deptIds)`, `getTypeDefaults()`; keep `setDocument(docId, deptId)` as the single shim.
- Event `departments-changed` unchanged (refreshes open Review/Settings).

---

## 9. Verification gate (Oracle — the ordered proof)
**Before BUILD merges (DARK, so these are the correctness proof):**
1. **Migration-invariant pin — LOAD-BEARING** (`src/services/test_department_multi_migration.js`, NEW). The
   fresh-install trap: an empty `documents` at migration time exercises no backfill, so the pin MUST seed the
   OLD scalar first, then fire the REAL mig 184. Assert: every `department_id=X` → exactly one join row; every
   `default_department_id=X` → one type-dept row; NULL → zero rows; **byte-identical `decision`/`visibleDocSql`
   for every (user × doc) before-vs-after** (vs the legacy scalar rule computed directly); source-contract grep
   that no reader still reads either scalar; idempotency on re-run; **migration is atomic** (a kill mid-migration
   leaves no mixed state).
2. **Widening pins** for the §4 own-slice rule: own-slice edit allowed; foreign slice preserved; `ownSelection=∅`
   refused (no self/team lockout); reduces to the singleton case; admin bypasses; a payload omitting the locked
   foreign chips does NOT false-reject.
3. **Extended denial matrix** (`test_department_denial_matrix.js` grown to multi-tag): a doc in {Fin,HR} seen by
   an actor in only {Fin} AND by one in only {HR}; an actor in neither denied across every reader × transport;
   the mutation oracle (a `MIN(department_id)` scalar-emulating reader WRONGLY denies the {HR}-only actor →
   proves the set-OR does work); route-party carve-out still one-doc-not-department; SYSTEM_ACTOR unfiltered.
4. **Backup round-trip** (`test_department_backup_remap.js`): type-default join slug-projected; dangling dept slug
   dropped (never foreign); documents/per-doc join out of scope.
5. **DARK/inert:** empty install — every reader's result set byte-identical to pre-mig; corpus M=0 re-run green
   (still vacuous for isolation — it only proves the join rewrite didn't couple filtering into extraction/filing).

**Before FLIP (`departments_enabled` opt-in ON in a customer build):**
6. **Perf gate (Oracle #6, the true blast radius)** — inject N depts × M users into the 700-corpus (≥10k docs),
   measure all ~13 readers join-model vs scalar-baseline, threshold = no reader regresses beyond a small fixed
   budget. The corpus M=0 gate CANNOT catch this (no departments in the corpus). Indexes: the PKs cover most; add
   `document_departments(department_id)` for the reverse join + delete count.
7. The D4 flip conditions carry forward unchanged (`INTAKE_GUARDED` already true; the master switch stays opt-in).

---

## 10. Out of scope (rule separately)
- `doctype_grants.department_id` — the OTHER thing the plans lump under "D7" (department×type deny). UNTOUCHED;
  this design does not disturb it. Oracle rules on it separately.
- D5 `{department}` folder token; D6 bulk re-tag / apply-type-defaults (barry's sole-department delete warning
  attaches here); D7-deny.

## 11. Build order (once approved)
mig 184 + backfill (transactional) → the gate SQL (`departmentVisibility` decision + visibleDocSql) → the
migration-invariant pin (RED first) → `setDocumentDepartments` + validate + type-default channel (§4) + widening
pins → the read-gate/denial-matrix rewrite + pins → backup D-C3 → the two UIs (type chooser + per-doc chips, +
Chris Card B on the Users list) + preload/IPC shims → full pin sweep green → owner live-vet on a rebuilt TEST
installer → the perf gate (before any flip). Stays DARK/opt-in throughout.

**Files:** `database/index.js` (mig 184), `database/modules/departmentVisibility.js`,
`src/services/departmentService.js`, `src/services/accessService.js`, `src/services/directIntakeService.js`,
`src/modules/api/handler.js`, `src/services/backupService.js`, `src/modules/settings/handler.js`,
`src/modules/review/handler.js`, `src/preload.js`, `src/windows/settings/{index.html,renderer.js}`,
`src/windows/review/{index.html,renderer.js}`, and the pins `src/services/test_department_{visibility,
denial_matrix,settings,backup_remap}.js` + NEW `test_department_multi_migration.js`.
