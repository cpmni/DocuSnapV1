# Handover — Quick File shipped; Departments next
Branch: feat/teach-side-overnight · Updated: 2026-09-15 (evening)

## Goal
Ship Quick File (non-OCR "just file this doc") safely as a customer default; next build-out = Departments (access control).

## Done (committed — 3 UNPUSHED: ee5d756, b14209e, bdf1f3b)
- `ee5d756` fix(settings): search-client IP fix — await-save host/port before enabling + restart listener on host/port edit (was binding loopback despite a typed LAN IP).
- `b14209e` feat(quickfile): Q-C2 write-side safety — `src/lib/intakeGuard.js` + belt in `database/modules/documents.js` (deconfirm + requeue) + guards at reviewService.confirm / repairService.sendBackToReview / reprocess-document / settings raw-deconfirm. /v1 contract 1.7.0→1.8.0 (+`intake` on search DTO); client CLIENT_CONTRACT 1.8.0 (lockstep). Pins: test_intake_guard(.source_contract).
- `bdf1f3b` feat(quickfile): **graduate to default-ON (mig 171 @DEFAULT_FLIP)** + delist from dark_switches (count 51→50, both count pins) + Chris finding-1 fix (toolbar/menu/bulk send-back hide in searchResults.js) + finding-5 copy. Chris report `docs/CHRIS_FULL_APP_REVIEW_2026-09-15.md`.
- Both installers built at bdf1f3b: core `dist\ScanFinder Setup 2.0.0-r20260915-1509-bdf1f3b.exe` (hardened, smoke 14/14) + client `client\dist\ScanFinder Search Client Setup 1.0.2-r20260915-1549-bdf1f3b.exe`. Full pins 376/376.

## In progress — UNCOMMITTED (both docs, safe to commit)
- `docs/designs/DEPARTMENTS_D2_PLAN_2026-09-15.md` (NEW — the Departments build-out plan; owner asked for it).
- `handover.md` (this file). Pre-existing `M handover.md` is superseded by this write.

## Next steps
1. Owner runs the DB-encryption ship drills 1-3 on the installed hardened build (recipe `docs/designs/DB_ENCRYPTION_SHIP_DRILLS_2026-09-15.md`) → closes that arc. Their hands (GUI).
2. **Build out Departments** per `docs/designs/DEPARTMENTS_D2_PLAN_2026-09-15.md`: D2 sweep (thread viewer + visibleDocSql into ~12 readers + count-broadcast collapse + consistency/mutation pins) → D3/D4 (taggers + Settings UI) → D2b (/v1 upload tagging) → flip. Each slice: advisor + Oracle gate + corpus M=0.
3. Push the 3 commits when owner says.
4. Quick File v1.1 fast-follows (queued, owner-vet): in-place Edit details; typed "100%"→"Typed"; onboarding line; drop "No OCR"; delete+refile ghost folder (app-wide); recycle-bin wording (app-wide).

## Decisions & rationale
- Quick File scope = local + /v1, NO in-place edit v1 (edit-by-refile; owner chose). Departments deferred as its own build.
- Flip enables BOTH local + /v1 lanes (same switch) — Oracle NOD: safe with Departments DARK (no isolation promised; /v1 still entitlement+seat+admin gated; learning-exclusion is NON-switchable).
- mig 171 = UPSERT (not INSERT OR IGNORE — mig 165 pre-seeded 'false'); delist from dark_switches or build_arming disarms it (release gate enforces both).

## Gotchas
- Shared search-ui edits: change `src/windows/shared/search-ui/*` ONLY, then `node scripts/sync-client-search.js` (client copy is generated; no-direct-IPC pin scans comments too).
- `/v1` intake lands `department_id=NULL` — MUST tag when Departments ships (watch-item logged in both plan docs).
- Chris sandbox still running: port 9223, PID 11360 (next /christest recycles it).
- Live DB `%APPDATA%\ScanFinder\docusnap.db` blocked to Claude's script tools.

## Verify
- `node scripts/run-pins.js` (376/376) · `node scripts/check-release-migrations.js` ("50 DARK keys guarded")
- Pin: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron src/services/test_intake_guard.js`
