# HANDOVER 2026-09-18 NIGHT — Departments WATERTIGHT hardening (security holes found + fixed) + Chris security vet

**Branch** `feat/teach-side-overnight`. **Night commits are LOCAL / UNPUSHED** (push is the owner's call — the
standing night protocol). Migration unchanged (185). No running processes left except the Chris sandbox app on
CDP **9223** (harmless; the next `/christest` rebuilds it). Owner went to bed with: "kick off the night run …
Chris to fully test the department work … make sure it is WATER TIGHT … what do you think [of a 2-ledger check]?"
+ "run anything you feel will be useful. Goodnight."

## TL;DR
Departments was DARK but **not watertight** for a crafted request. gary + eric (independent) → **Oracle
SIGN-OFF-W/COND** found by-id SERVE/MUTATE paths that skipped the department gate — the exact "unauthorised access
= disaster" class. **All fixed this session** (Oracle's before-flip minimum #1–#6), byte-identical when no
departments exist (every shipped install), proven by a 22-check red-team pin + a coverage-lock pin, 0 regressions
across 310 pins. **Chris** ran an adversarial black-box vet in parallel → **ZERO leaks, watertight** from a user's
seat. The owner's 2-ledger idea was assessed (unsound as stated; the right version is an independent egress
re-check — a fast-follow). **Not live-exploitable today** (departments off by default) — these are PRE-FLIP blockers.

## The owner's "two ledgers must match" question — answer
Unsound as literally stated (all three of gary/eric/main agree): two copies of the same source-of-truth always
agree, including when wrong → they catch DRIFT, not the real leak (a path that forgot the filter, or a wrong
filter). The valuable reframe = an **independent egress re-check** (list filter vs a per-doc `decision()`
re-derivation on the rows about to be served; drop + ALARM on divergence). Built into the plan as Slice 3
(belt-and-braces, NOT flip-blocking). Full write-up: `docs/designs/DEPARTMENTS_HARDENING_2026-09-18.md`.

## Committed LOCAL this session
- **`fix(departments): close by-id serve/mutate leaks — watertight hardening`** (HEAD; unpushed):
  - Gates (existence-hiding): `reprocess-document`, `split-pdf`, `confirm-review`, `sweep-inview-{file,recheck,hold}`
    (desktop); `/v1` `confirm|defer|undefer|delete` (via new `_gateMutate` 404) + `restore` (via `decision()`) +
    `review/:id/viewing`.
  - `split-pdf` children now INHERIT the parent's `document_departments` (were laundered to shared) — same txn.
  - `workflowService.assign` SENDER gate — closes the route-party self-grant + the membership-enumeration oracle.
  - Fail-OPEN → fail-closed in `departmentVisibility.decision()` (+ `_hasTables` now requires `document_departments`)
    and `_openResolvedDoc`.
  - Pins: `src/services/test_department_serve_hardening.js` (22 checks) + `src/services/test_department_serve_coverage.js`.
  - Design: `docs/designs/DEPARTMENTS_HARDENING_2026-09-18.md`.
- **docs** (this handover + the Chris security round appended to `docs/CHRIS_FULL_APP_REVIEW_2026-09-18.md` + the
  NIGHT_RUN DONE ledger) — the doc commit (unpushed).

## Verification (all READ, honest)
- `test_department_serve_hardening.js` 22/22 — adversary DENIED / member+admin ALLOWED / byte-identical no-departments,
  across reprocess/split(+child)/confirm/defer/undefer/delete/restore/viewing/assign-as-sender + fail-closed + inert-install.
- `test_department_serve_coverage.js` — locks every known by-id serve/mutate handler + `/v1` route to a gate token
  + a `/v1` by-id route-count tripwire (found + classified the teach OCR routes = client-supplied image, no leak).
- **0 regressions:** database 169/169, modules 96/96, services 45/45 (+2 new pins).
- **Chris black-box (sandbox 9223):** ZERO leaks — search/counts/bin/export/open-by-ID all refused for the wrong
  user, per-document not just lists. `docs/CHRIS_FULL_APP_REVIEW_2026-09-18.md` (round "NIGHT, SECURITY focus").

## NEEDS THE OWNER (morning)
1. **Review + PUSH** the two night commits (I held them local per the night protocol).
2. **AUDIT DEBT before the `departments_enabled` flip** (Oracle #5 — the coverage enumeration surfaced these; each
   is a by-id mutate/serve not obviously gated — verify per-handler, gate the real ones): `reprocess-batch`
   (array — needs a per-item filter), `reprocess-autocommit-accept`, `batch-audit-correct`, `batch-audit-send-back`,
   `accept-name-value`, `accept-issuer`, `accept-field-chars`, `resolve-issuer`, `find-issuer-siblings` (returns
   other docs), `class-fix-resolve-ask`, `acknowledge-review`, `get-staged-teach-thumbnail`. (List + safe-classified
   ones in the coverage-pin header.)
3. **Chris Card 1** (his top): departments OFF doesn't un-hide tagged docs — SAFE direction but confusing copy;
   decide fix-the-switch vs fix-the-copy. Cards 2/3 (default-Everyone confirm note; temp-password Copy button) are preferences.
4. **Belt-and-braces (fast-follow, not flip-blocking):** Slice 2 `serveDoc` choke point; Slice 3 the egress re-check
   + ALARM (your ledger idea done right); decouple the dept decision from `ACCESS_GATE_ENABLED` on dev; test the
   LAN search-client + the route-to-a-person path (Chris couldn't reach either).
5. The **flip-census batch** (`docs/designs/NIGHT_RUN_2026-09-17.md`) was NOT run — the security directive was the
   priority + the box OOM'd twice; deferred, not lost.

## Also this session (pre-"going to bed", ALREADY PUSHED)
- Chris re-run (complete) + triage (`6d4179f`). Chris #1 diagnosed (gary → Oracle) + FIXED: `ref_badge_verify_state`
  mig 185 DARK — a calm "Read" badge for a confident-but-unverified reference (`0f799a1`), badge census PASS on the
  mature slice (`ba15398`). See `HANDOVER_2026-09-18.md` (the DAY handover) for those.

## Key facts / traps
- Night commits LOCAL/unpushed by protocol. `departments_enabled` NOT flipped (owner's call; the audit debt above
  is owed first). The fixes are byte-identical on every current install (0 department rows → gate inert).
- Coverage pin is the durable guard: a NEW by-id `/v1` route or a removed gate turns it RED. Run all pins:
  `node scripts/run-pins.js [database|modules|services]`.
- Sandbox app still up on CDP 9223 (Chris left it; Finance doc INV-56357 in its recycle bin). Kill via the 9223 PID.
