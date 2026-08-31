# Stage 8 — Per-doc-type / per-document authorization (GROUNDWORK)

Status: **design + inert scaffold only** (2026-07-27). No behaviour change ships in this stage.
Source: security remediation plan §4 Stage 8 + `SECURITY_AUDIT_2026-07-27_LOCAL.md` "suggested next
pass" #3. This document is the model a later feature-build follows; it is NOT yet implemented.

## 1. Goal
Let an administrator restrict which internal users/roles can see documents of a given **document
type** (e.g. `readonly` staff may see Delivery Notes but not Invoices), through the EXISTING single
read-authorization choke point — so the later feature is a body change in one function, not a
data-model upheaval. Extends naturally to per-**document** grants on the same table shape.

## 2. What ships now (inert)
- **Migration 56** — `doctype_grants` table (+ two indexes). Additive, unused, byte-identical.
- **`accessService.doctypeGrantDecision(db, user, doc, deps)`** — a named seam wired into
  `canAccessDocument`, returning `{ deny: false }` unconditionally today. Injectable via
  `deps.doctypeGrantDecision` for tests / the future implementation.
- Placement: the seam is consulted AFTER admin-allow and the open-route-party grant (both return
  above it) and AFTER the soft-deleted deny, but BEFORE the role-based writer/readonly grants — so a
  restriction narrows a role's access WITHOUT overriding (a) admin or (b) an explicit routing grant.

## 3. Data model (`doctype_grants`)
```
id                INTEGER PK
role              TEXT      -- 'admin'|'edit'|'readonly'  (per-ROLE grant)   } exactly one of
user_id           INTEGER   -- FK users(id) ON DELETE CASCADE (per-USER grant) } role / user_id set
document_type_id  INTEGER   -- FK document_types(id) ON DELETE CASCADE  (NOT NULL)
access            TEXT      -- 'allow' | 'deny'   (default 'allow')
created_at        TEXT
```
- `role` set + `user_id` NULL → a per-role rule. `role` NULL + `user_id` set → a per-user rule (a
  user rule overrides their role's rule for the same type).
- FK cascades keep the table clean when a type or user is deleted.
- Per-**document** grants (a future extension) reuse the same shape with a `document_id` column added
  — not scaffolded now to avoid an unused NULL column, but the seam already receives `doc`.

## 4. Activation semantics (DEFAULT-ALLOW-PRESERVING — the load-bearing rule)
The table MUST be inert when empty and non-surprising when populated. Proposed evaluation, per
(user, doc.document_type_id):

1. **No rows anywhere** for that document type → **no opinion** (`deny:false`). This is the universal
   default → every existing install is byte-identical forever unless an admin adds a rule.
2. If any rows exist FOR THAT TYPE:
   - a matching **`deny`** rule (user-specific first, then role) → **deny**.
   - else a matching **`allow`** rule → allow (no restriction).
   - else (rows exist for the type but none match this user/role) → the model choice:
     - **deny-list mode** (recommended default): absence of a matching rule = allowed (rules only ever
       subtract). Simple, safe, matches "block readonly from Invoices" without listing everyone.
     - allow-list mode (opt-in per type via a future `doctype_access_mode` setting): absence = denied.
   Pick deny-list as the shipped default; allow-list is a later per-type toggle, out of this stage.
3. **admin** and an **open-route party** are NEVER restricted (they return before the seam). State
   this in the feature docs: doc-type restrictions govern ROLE-based browsing, not an explicit route.

Fail-closed detail: a malformed/unknown `access` value is treated as `deny` for that row (never as a
silent allow), consistent with the rest of `canAccessDocument`.

## 5. Where it hooks
`src/services/accessService.js` `canAccessDocument`, the ONE predicate shared by the desktop IPC and
the `/v1` API. Order (unchanged except the inserted seam):
```
doc missing            → not_found
admin                  → allow            (exempt)
open-route party       → allow            (exempt)
status deleted         → deny (non-admin)
► doctypeGrantDecision → deny 'doctype_restricted'   ← Stage 8 seam (inert today)
edit                   → allow
readonly               → confirmed ? allow : deny
else                   → deny
```

## 6. Test plan (when built)
- Inert today: `canAccessDocument` byte-identical with an empty `doctype_grants` (existing
  `test_access_service` suite stays green); the seam is reachable (inject a `deny` decision → the
  gate returns `doctype_restricted`).
- When implemented: a `deny` row hides that type from the targeted role/user across BOTH transports;
  admin + route-party bypass a restriction; a per-user rule overrides the role rule; deleting a type
  or user cascades the rules away; empty table = no change; the `/v1` DTO honours it identically.
- Migration 56 byte-identical (additive table, no consumer).

## 7. Non-goals for Stage 8
No UI, no IPC, no `/v1` change, no reads of the table. Those land with the feature build. This stage
is only: the table, the named inert seam, and this model.
