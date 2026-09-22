# HANDOVER — 2026-08-31 (DB-encryption integration pass + a crash investigation in flight)

**Branch** `feat/teach-side-overnight`. **HEAD `5b2bf89`, PUSHED — in sync with origin** (this session
pushed 6 commits at the owner's request). Tree clean except the usual junk untracked. Predecessor:
`HANDOVER_2026-08-31_NIGHT.md`. **Owner is rebooting** — the dev app will close; `npm start` after reboot
loads everything fresh (this session's main/renderer changes take effect then).

## TL;DR — two things
1. **DONE + PUSHED: the DB-at-rest encryption BOOT + UI INTEGRATION PASS** (`19432cb` code, `2aaf6a3` docs,
   `5b2bf89` CLAUDE.md). All DARK/inert — plaintext boot byte-identical, opt-in only. eric-lifecycle +
   Oracle SIGN-OFF-W/COND. Remaining = OWNER-machine drills/gates + the default-on decision (all logged).
2. **IN FLIGHT — NOT STARTED: a RAM-aware concurrency fix** for a customer crash. Root cause diagnosed
   (below); the fix was about to go to eric + oscar → Oracle when the owner interrupted to reboot. **The
   fresh session's job: run that advisor gate, then build it.**

## 1. DB encryption integration — what shipped (do NOT rebuild)
Crypto core was already done; this wired it into boot + Settings. Built + pinned under E44:
- **`main.js` whenReady boot gate** (before the first `getDb()` at ~L1280): `dbStartup.decide()` routes 5
  actions — plaintext (no-op) / open-cached (unwrap DPAPI code) / prompt-code (restored backup) / tripwire
  (downgrade) / **migrate** (opt-in encrypt-at-boot).
- **Unlock/Recover window** `src/windows/unlock/` — closes via `app.exit(0)`, never `app.quit()` (the
  pre-key boot has no tray/before-quit and `getDb()` throws on the unkeyed DB — eric's strand-headless seam).
- **Tripwire** → `showErrorBox` + `app.exit(1)` (quit would open the plaintext DB it refuses).
- **`unlock-recover` IPC** — sender-scoped, serialized, shape-rejected, read-write verify.
- **Opt-in ceremony** (Settings → Advanced → "Database encryption"): mint → masked code (Show/Copy/Print)
  → typed "I HAVE SAVED IT" → arm → relaunch. Admin-gated. `db-encrypt-status`/`-provision`/`-migrate` IPCs.
- **Oracle redirect adopted: a DISJOINT `.db-migrate-code` arm** (not `.db-key`+marker) — the real
  `.db-key` is NEVER written beside a plaintext DB, so the downgrade tripwire stays byte-identical + pinned.
  `decide()` self-heals a stale arm on any encrypted boot (C1); `dbBootMigrate.run` fails toward an intact
  plaintext DB on any error (C3) — no loop, no tripwire, no orphan key. `dbKey.mintCode` mints without
  persisting; main stashes the code so shown==armed==migrate (C6).
- **Files:** `src/lib/dbKey.js` (+mintCode/armMigration/loadMigrateCode/clearMigrateCode), `dbStartup.js`
  (migrate row + self-heal), `dbBootMigrate.js` (new), `src/windows/unlock/*`, `preload.js`,
  `src/windows/settings/{index.html,renderer.js}`, `main.js`.
- **Pins GREEN under E44:** `test_db_startup` 6→11, `test_db_boot_migrate` 18 (new). Existing crypto pins
  unchanged (dbKey 16, cipher 10, migrate 18, secretStore 14).
- **REMAINING (owner-machine only, do NOT run autonomously):** the migration DRILL (`db.backup()` first →
  Settings → "Turn on encryption…" → confirm → relaunch → silent open; delete `.db-key` → Unlock by code;
  `export-plain` a copy), the DPAPI-loss + DOWNGRADE drills (restore `.pre-encrypt` → must LOUD-tripwire),
  packaged-boot + gate-5b on E44, perf<10% + verifyAuditChain//v1, realdoc-605 OFF byte-identical.
  **DEFAULT-ON fresh = DEFERRED (owner); opt-in only. The FIRST "Turn on encryption" click IS the drill —
  it encrypts the live DB** (crash-safe: migrate() keeps plaintext on any pre-SWAP fault). Full spec:
  `docs/designs/DB_ENCRYPTION_ARC_2026-08-31.md`; ledger `NIGHT_RUN.md`.

## 2. THE ACTIVE TASK — RAM-aware concurrency fix (customer crash)
**Report:** a friend ran a BATCH IMPORT of the test docs on a **Ryzen 5 / 16GB** basic business PC — the
app **locked up, crashed, and disappeared**.

**Root cause diagnosed (from the code — NOT confirmed against his crash log):** batch import spawns N
parallel Python OCR workers (each its own Tesseract + PDF-render process holding 200-DPI page images), and
N is **CPU-core-scaled with NO RAM awareness**:
- `handler.js:1929` `defaultConcurrency()` = `Math.min(maxConcurrency(), os.cpus().length - 2)`;
  `maxConcurrency()` (`:1919`) = `min(10, os.cpus().length)`.
- **`os.cpus().length` is LOGICAL processors (threads), not physical cores.** A Ryzen 5 = 6-core/**12-thread**
  → reports 12 → **default = 10 workers.** (The code comment "6-core → 4" is wrong for any SMT chip.)
- **No memory guard anywhere** — verified: `grep freemem|totalmem|availableMemory` over `src/modules/processing`
  = zero hits.
- 10 workers × ~0.5–1GB (Tesseract + page images) + Electron + Windows > 16GB → paging (**the lock-up**) →
  allocation failure / OS terminates the process tree (**crash + disappear**). Fits a large batch far better
  than a single bad doc (which just holds one row and continues).

**Immediate workaround ALREADY GIVEN to the owner (for the friend):** Settings → Processing → lower the
parallel/concurrency to **2–3**, re-import (also: import smaller folders).

**Confirm-it steps given:** Task Manager → Memory during a repro (watch it hit ~100%); his
`%APPDATA%\ScanFinder\processing.log` last lines; Windows Event Viewer → Application (an OOM / `0xC0000005`
naming `python.exe` or the app).

**THE FIX (owner said "yes" — design it + run the gate, DON'T just patch):**
- **Count PHYSICAL cores, not SMT threads** (eric: `os.availableParallelism()` on Node 24? or physical-core
  detection on Windows; `os.cpus().length` overcounts on SMT).
- **RAM-aware cap:** `min(coreCap, floor(availableRAM / perWorkerBudget))`, `freemem` at spawn vs `totalmem`
  at design — eric's call.
- **Size the per-worker budget** (oscar: Tesseract engine + 200-DPI multi-page images at the product DPI;
  what one worker actually peaks at).
- **Policy decision (Oracle seam):** does the RAM cap HARD-CEIL an EXPLICIT user `processing_concurrency`
  setting (fail-safe, prevents the crash, but overrides user intent) or only the DEFAULT? A user who set 10
  on a 16GB box still crashes otherwise. Lean: hard-ceil + a Settings note.
- **THE DETERMINISM SEAM (Oracle WILL flag this):** `_reprocessThreadCap` (`handler.js:1945`) DERIVES the
  Tesseract OMP thread cap FROM the concurrency number. Changing concurrency changes the OMP cap → can shift
  a boundary-glyph read (LSTM float-accumulation order — the owner watched `ACC-2291` vs `ACC-229]` on one
  doc). A fresh install has no baseline to regress; an EXISTING install where the cap lowers concurrency
  could read differently. The fix must weigh this (fresh-install-only? or accept + document?).
- **Also check:** the detection pre-pass `_separateBatchDocuments` (`handler.js:2308`) runs its OWN bounded
  Tesseract parallelism `P` (`:2326`, `threadCap = cores/P`). Confirm it is a SEQUENTIAL phase before the
  main OCR spawn (peak = max, not sum) — it appeared to be a pre-pass, not yet fully confirmed.

**Surfaces:** Settings knob `processing_concurrency` (settings/renderer.js ~L1253-1270), onboarding
(onboarding/renderer.js ~L77). Batch spawn `handler.js:2456-2466`. Quiet-lane workers `handler.js:1954+`.

**PLAN for the fresh session:** brief **eric** (child-process/memory/physical-core detection + the
crash-lifecycle) and **oscar** (per-worker OCR memory footprint) IN PARALLEL → **Oracle** vets the
consensus (esp. the thread-cap determinism seam + the explicit-setting-vs-cap policy) → build the smallest
correct fix → gary-style test strategy (a pin that a low-RAM/high-core machine caps workers; a determinism
note). System fix, not a one-machine hack.

## Git / verification state
- `git log --oneline -8`: `5b2bf89` (CLAUDE.md) · `2aaf6a3` (docs) · `19432cb` (integration code) ·
  `21a34fd`/`a683975`/`684de90` (crypto core) · `c183792`/`0ed6f20` (E44 merge). **All PUSHED.**
- Every crypto pin ran + read GREEN under `ELECTRON_RUN_AS_NODE=1 node_modules\.bin\electron.cmd <test>`.
- The concurrency fix has produced NO code yet — investigation only.

## Traps / notes
- `git commit -F <file>` ONLY (here-string + heredoc break). `git push` worked in-tool this session.
- Run native-module tests with `ELECTRON_RUN_AS_NODE=1 node_modules\.bin\electron.cmd <path>` (redirect via
  PowerShell `*> $log`); pure-JS/fs tests run under `node`. `node --check <file>` for syntax.
- `os.cpus().length` = LOGICAL cores (the crux of the concurrency bug).
- CLAUDE.md's LATEST block is updated to this state; MEMORY.md +
  `memory/project_db_encryption_passphrase_20260831.md` updated (integration BUILT).
