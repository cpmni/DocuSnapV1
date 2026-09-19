# Departments — watertight hardening (2026-09-18)

**Trigger:** owner directive ("if any unauthorised user is able to access docs they shouldn't it would be a
disaster … we need to make sure it is WATER TIGHT"). **Advisors:** gary + eric (independent) → **Oracle
SIGN-OFF-W/COND**. **Chris** ran an adversarial black-box vet in parallel. All fixes byte-identical when no
departments are configured (every shipped install — `departments_enabled` is DARK). Night commits LOCAL/unpushed.

## The owner's "two ledgers that must match" idea — verdict
All three (gary, eric, main) independently agree: **unsound as literally stated.** Two ledgers that both derive
from the same source of truth always agree — *including when the answer is wrong* — so they catch DRIFT between
copies, not the actual leak class (a serve path that forgot the filter, or a filter with a bug). The valuable
reframe is an **independent egress re-check**: path A = the list filter (`visibleDocSql`), path B = a per-doc
re-derivation (`decision()`) run on the rows about to be served; drop + ALARM on any divergence. That is Slice 3
below (belt-and-braces, not flip-blocking).

## What was found (the leak class = a by-id serve/mutate path that forgot the gate)
The gate primitives are sound and the LIST readers + desktop single-doc READS + `/v1` READS are all gated. The
holes were **by-id SERVE/MUTATE paths that were missed** (verified at source; several found by the coverage
enumeration during the fix):
- **`reprocess-document`** (desktop) — re-OCRs a doc by id + streams `supplier_name`+`extractions` back + mutates it. Content leak. **HIGH.**
- **`split-pdf`** (desktop) — splits a restricted doc's bytes AND (worse) created **untagged, shared children** → org-wide leak even when a legitimate member splits. **HIGH.**
- **`confirm-review`** (desktop) — files a doc by id; the `/v1` twin was gated, this desktop twin was not; `reviewService.confirm` doesn't gate internally. **HIGH.**
- **`/v1` mutation cluster** `confirm|defer|undefer|delete|restore` + `review/:id/viewing` — desktop twins gated, `/v1` twins not; a writer client could file/delete/restore a restricted doc by id, and `viewing` leaked other reviewers' names. `confirm` 409 also echoed `confirmedBy`. **HIGH/MED.**
- **routing SENDER self-grant** (`workflowService.assign`) — only the RECIPIENT was gated; an outsider could id-walk a restricted doc, route it to an in-dept recipient, become `from_user_id` = an OPEN-route party, and thereby read it (`canAccessDocument` `route_party` branch). Plus a `RECIPIENT_NO_ACCESS`-vs-success membership-enumeration oracle. **HIGH.**
- **`sweep-inview-file|recheck|hold`** (desktop, LIVE) — file/hold/re-offer a doc by id; ungated. **MED.**
- **fail-OPEN** branches: `decision()` catches returned *allow* on a query error on a KNOWN-tagged doc; `_openResolvedDoc` swallowed a gate throw; `_hasTables` didn't check `document_departments`. **MED (defense-in-depth).**

## What shipped (all local, byte-identical-OFF, Oracle before-flip minimum #1–#6)
- **#1 gates** (existence-hiding 404 / generic not-found): `reprocess-document`, `split-pdf`, `confirm-review`,
  `sweep-inview-{file,recheck,hold}`; `/v1` `confirm|defer|undefer|delete` (via `_gateMutate`), `restore` (via
  `decision()` directly — the deleted-doc twin of `_assertDeletedDocAccess`), `review/:id/viewing`.
- **#2 split-pdf child inheritance** — children inherit the parent's `document_departments` in the same transaction.
- **#3 routing sender gate** — `assign` runs `departmentDecision(actor, doc)` and returns `NOT_FOUND` on deny (closes the self-grant + the enumeration oracle); `assignSystem` untouched (no human sender).
- **#4 fail-closed** — `decision()` catches now DENY once configured (admin exempt above); `_hasTables` requires `document_departments` (a missing table short-circuits to inert cleanly); `_openResolvedDoc` denies on the dept dimension when configured.
- **#5 coverage pin** `test_department_serve_coverage.js` — LOCKS every known by-id serve/mutate handler + `/v1` route to a gate token (a removed gate → RED) + a `/v1` by-id route-count tripwire (a new ungated route → RED).
- **#6 red-team matrix** `test_department_serve_hardening.js` (22 checks) — adversary DENIED / member+admin ALLOWED / byte-identical when no departments, across reprocess/split(+child)/confirm/defer/undefer/delete/restore/viewing/assign-as-sender + the fail-closed + inert-install proofs.

## Chris's adversarial black-box vet (parallel) — ZERO leaks
As an Operations-only user he tried the Finance-only doc by search (ref/filename/content), counts, recycle bin,
export, and the **open-by-known-ID trick** — all refused, per-document not just on lists. Mirror held for the
Finance user; admin saw all; shared docs shown to both. `docs/CHRIS_FULL_APP_REVIEW_2026-09-18.md`. (His UI test
can't reach the crafted-request by-id holes above — those need a crafted client / id-walk, which the fixes close.)
3 usability cards, no leaks: (1) turning departments OFF doesn't un-hide tagged docs (SAFE direction, confusing
copy — his top card); (2) new docs default to "Everyone" (no confirm-time visibility note); (3) temp password has no Copy button.

## AUDIT DEBT — owed before the `departments_enabled` flip (Oracle #5 "verify the batch/bulk paths")
The coverage enumeration surfaced more by-id handlers than the confirmed set. Classified, NOT all certified —
these need a per-handler verification before an admin turns departments on:
- **gated-in-service / viewer-scoped / DARK / admin-only** (believed safe; listed in the coverage pin header): open/show-in-explorer, set-document-department(s), get-stuck-docs, get-autofiled-grid, get-review-event-docs, sweep-scope-candidates, sweep-queue-candidates, reextract-fields-fast (DARK), sweep-scope-accept/undo (DARK), purge-document/restore-all-deleted (verify admin-only).
- **MUST-AUDIT ⚠** (a specific-doc mutate/serve by id, not obviously gated): `reprocess-batch` (array of docs — needs per-item filter), `reprocess-autocommit-accept`, `batch-audit-correct`, `batch-audit-send-back`, `accept-name-value`, `accept-issuer`, `accept-field-chars`, `resolve-issuer`, `find-issuer-siblings` (returns other docs), `class-fix-resolve-ask`, `acknowledge-review`, `get-staged-teach-thumbnail`.

## Belt-and-braces (fast-follow, NOT flip-blocking once the above is done)
- Slice 2 full `serveDoc(db, actor, docId)` choke point (fetch+authorize as one call).
- Slice 3 the independent egress re-check + ALARM (the owner's idea, done right).
- Decouple the department decision from `ACCESS_GATE_ENABLED` on dev builds (production is always-on).
- The `/v1` LAN search-client + the workflow route-to-a-person path (Chris couldn't test either from one seat).

## AUDIT DEBT RESOLVED — 2026-09-19 (eric + gary → Oracle SEND-BACK → C-A…C-F, then implemented)
The audit-debt verification was run per-handler at source (eric + gary) and vetted by the Oracle, which **SENT
IT BACK**: the plan rested on TWO false premises and missed a whole ON-by-default leak class.
- **False premise (verified at source):** `ref_class_fix_enabled` (mig 76 `@DEFAULT_FLIP`) and `accept_field_chars_enabled`
  (mig 103 `@DEFAULT_FLIP`) are **ON by default**, not DARK — NOT in `TEST_SWITCH_KEYS`, so mig 137's customer reset
  never touches them. Their fan-outs run department-blind the instant `departments_enabled` flips → flip-blockers.
- **The big miss — the scope sweep** (`scope_sweep_enabled` + `scope_sweep_auto_accept`, mig 80 `@DEFAULT_FLIP`, ON):
  `sweep-queue-candidates` offered restricted docs; `_sweepAcceptCore` filed them via `reviewService.confirm` directly;
  and with auto-accept ON, one member's confirm **silently auto-filed a different department's restricted docs** and
  named them in the receipt. The worst path, absent from the first plan.
- **classFix disclosure rides out in `confirm`,** not `resolve-ask`: the class-fix bar shows each sibling's filename +
  was→now value, so gating the source doc alone was necessary-but-insufficient — the fan-out SELECT itself needed the
  filter. This overturned the prior "D2 cond-5 / department-BLIND" comment (its premise was the same false one).

**Implemented (all byte-identical when no departments configured; the flip stays owner-gated):**
- Single-doc gates (own-idiom: throw `_assertDocAccess` for blind-UPDATE sites, soft-return where one exists):
  `resolve-issuer`, `acknowledge-review`, `class-fix-resolve-ask` (soft 'gone'), `batch-audit-send-back` (soft
  'not-in-batch'), `accept-field-chars` (hard-gate the source it READS), `find-issuer-siblings` (soft 'no siblings'),
  `apply-issuer-ripple` (per-id drop), `reprocess-batch` (per-item filter + `deptDropped` count),
  `reprocess-autocommit-accept` (per-item drop). `accept-name-value`/`accept-issuer`: soft-skip the per-doc note-clear
  only — the global allowlist write stays ungated (renderer value, doc-independent).
- **C-A** `batchAuditService.confirmBatch` gates each doc (injected `access`, fail-closed default) + `classFixService.
  applyForConfirm` sibling scan `visibleDocSql`-filtered (viewer threaded from `reviewService.confirm` +
  `class-fix-resolve-ask`).
- **C-B** `charsetAcceptService.applyCharsetAccept` sibling sweep `visibleDocSql`-filtered (viewer from the handler).
- **C-C** the scope sweep: `sweep-queue-candidates` + `_sweepOfferForScope` SELECTs `visibleDocSql`-filtered, and the
  ONE shared filing loop `_sweepAcceptCore` gates each doc (covers manual "File N" AND the silent auto-accept).
- `find-issuer-siblings`/`supplierSiblings.findSiblings`: **SQL-filter** (not post-loop — the 25-cap would let
  restricted docs shrink a member's visible set).
- **C-D** coverage lock extended (every new handler/service/sweep-fn carries a gate token; `GATE` regex now includes
  `visibleDocSql`; header corrected). **C-E** runtime red-team §8–§12 (confirmBatch never files a restricted doc;
  findSiblings/classFix/charset never heal/disclose one; reprocess drops one). **C-F** byte-identical §13 + trade-off
  pins (allowlist keeps writing; findSiblings completeness). SAFE, no change: `get-staged-teach-thumbnail` (docId:null).

**Verification:** `test_department_serve_coverage.js` ALL PASS; `test_department_serve_hardening.js` §1–§13 ALL PASS;
full battery green — services 45/45, modules 96/96, database 169/169 (0 regressions). **Still owed before the flip:**
Chris Card 1 (switch-vs-copy), owner live-test, and the belt-and-braces fast-follow below.

## Files
`database/modules/departmentVisibility.js`, `src/modules/processing/handler.js`, `src/modules/review/handler.js`,
`src/modules/api/handler.js`, `src/services/workflowService.js`; audit-debt (2026-09-19):
`src/services/batchAuditService.js`, `src/services/classFixService.js`, `src/services/charsetAcceptService.js`,
`src/services/reviewService.js`, `database/modules/supplierSiblings.js`; pins
`src/services/test_department_serve_hardening.js` + `test_department_serve_coverage.js` (+ `test_batch_audit_correct.js`
gained an injected inert `access`). Oracle verdicts + gary/eric reports: this session's transcript.
