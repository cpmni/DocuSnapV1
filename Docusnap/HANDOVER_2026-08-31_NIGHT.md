# HANDOVER — 2026-08-31 NIGHT (three arcs + Electron 44 merge + DB encryption to the crypto core)

**Branch** `feat/teach-side-overnight`. **HEAD `21a34fd`. Origin at `c183792` — 3 commits UNPUSHED**
(`684de90` + `a683975` + `21a34fd`; owner reviews then pushes). Tree clean (only junk untracked:
`../Docusnap - Copy*`, `TESTING/suite_results.json`). **Dev app RUNNING** on **Electron 44** (`npm start`,
5 electron processes, on the LIVE PLAINTEXT DB — encryption is inert). Predecessor: `HANDOVER_2026-08-31_EVENING.md`.

## TL;DR
Resumed from the EVENING handover's "build one of three signed designs." Ended up building **all three**
+ merging Electron 44 + pivoting the DB-encryption model mid-build after owner questions:
1. **Design 1 `TEMPLATE_LOCATE_ROLE_QUALIFIER`** — DARK, pinned (`e65959c`). Net-Total locate steal.
2. **Design 2 `TEMPLATE_FRAGMENT_CONTAINMENT_YIELD`** — DARK, pinned (`2bf7609`). CAD8⊂CAD832694.
3. **DB-at-rest encryption** — built slices 0/1/2, then **PIVOTED to code-as-passphrase** (owner
   requirement) after an Oracle+eric re-vet; **crypto core is complete + pinned**, the UI/boot
   integration is the remaining pass.
4. **Electron 31.7.7 → 44.0.0 MERGED** (`0ed6f20`) from `chore/electron-44` + validated + pushed.

Everything runtime-behavioural is INERT: the two arcs are DARK (migs 99/100 seed OFF), and no DB is
encrypted (no key set). A fresh build would behave like the last installer but on E44.

## Committed this session (chronological)

### 1. `TEMPLATE_LOCATE_ROLE_QUALIFIER` (`e65959c` code+pin, `719c418` ledger) — DARK, mig 99 OFF
The taught bare-"Total" locate steal (Castellan credit_note_0008): `_label_score` scores "Net Total" and
a clean "Total" both 1.0 (space = boundary), proximity/carriers pick the wrong row. Fix INSIDE the locate
(`template_mapper._locate_anchor` + the born-digital twin `anchor._locate_in_text_lines`): DEMOTE (never
veto) role-qualified 'total' occurrences via `keyword._total_role_collision` (imported, not copied);
all-qualified LOCAL → page-wide leg; all-qualified PAGE keeps today's pick; carriers-override fallback.
Env `TEMPLATE_LOCATE_ROLE_QUALIFIER`, setting `template_locate_role_qualifier`, mig 99. Pin
`test_locate_role_qualifier.py` (RED-first + divergence + carriers + twin + vocab-identity + end-to-end
drift). Flag OFF byte-identical. **Flip gate (queued):** realdoc-605 OFF==ON + Hard Set class.

### 2. `TEMPLATE_FRAGMENT_CONTAINMENT_YIELD` (`2bf7609` code+pin, `edc36a0` ledger) — DARK, mig 100 OFF
CAD8⊂CAD832694 (Castellan delivery_note_0005): `_read_inline_box`'s `split()[0]` truncates a taught code;
committed as `template_mapping` with a false shapewarn. New Stage-1 sibling leg after format-fail-yield
(`engine.py`): a confident (≥85), format-passing keyword read that STRICTLY alnum-prefix-contains the
taught fragment is adopted (cap 88 + neutral both-values note, review-bound). REF-FAMILY only, NEVER
currency/total. C3: the note is NOT a `_verification_doubt_note` (pinned). Env
`TEMPLATE_FRAGMENT_CONTAINMENT_YIELD`, setting `template_fragment_containment_yield`, mig 100. Pin
`test_fragment_containment_yield.py` (mechanical guard proven — excise the leg → RED). `test_stage05_
format_yield.py` prose amended (C1). Flag OFF byte-identical. **Flip gate (queued):** realdoc-605 + Castellan five + Hard Set clipped-code class.

### 3. Electron 31.7.7 → 44.0.0 (`0ed6f20`, from `chore/electron-44`; `c183792` docs) — PUSHED
Merged PR #12's branch. Conflicts (package.json/lock): kept E44's electron 44 / electron-builder 26 /
argon2 0.45.1 / Rung-A/B fuses; reconciled the encryption dep to the **ciphers fork ^13** (better-sqlite3-
multiple-ciphers@13.0.3; **Electron 44 = Node 24**). `install-app-deps` rebuilt native. Re-gated on E44:
`test_db_cipher` (9→now 10) · `test_dbkey` · `test_secretstore` · `test_db_migrate_encrypt` — all green;
real-DB read smoke identical (667 docs). **NOT re-confirmed on the merged tree (owner-machine):** a
packaged build boot + gate-5b DPAPI continuity on a real E31-written profile. (The E44 branch alone was
VM-confirmed 08-29.) `client/` + `cert-tool/` also got the electron bump — `npm install` there if built.

### 4. DB-at-rest encryption — PIVOTED to code-as-passphrase; crypto core COMPLETE + pinned
Built slices 0/1/2 in a random-key + DPAPI/argon2-sidecar model first (`603b52e` `e2a0535` `783b7f3`),
then the owner required **"a `docusnap.db` backup + the printed code resurrects on ANY PC."** That model
couldn't (the key lived in `.db-recovery`, which `backupService` never exports). **Oracle re-vet: SIGN
OFF WITH CONDITIONS on code-as-passphrase** (verdict at the foot of `docs/oracle_log.md`); eric argued to
keep the sidecar model — Oracle (final arbiter) + the owner's requirement won. **Pivot committed
`684de90` + `a683975`:**
- **Model:** the printed **125-bit recovery code IS the key material**. DB encrypted in multiple-ciphers
  **passphrase mode** (`cipher=chacha20`, pinned `kdf_iter=256000`, `PRAGMA key='<code>'`) → **KDF salt in
  the DB header** → a lone `.db` + the code opens in any fresh dir. `.db-key` is now a **no-prompt DPAPI
  cache of the code only** (never required for recovery; fail-closed). `.db-recovery`/argon2 GONE.
- **Files:** `src/lib/dbKey.js` (the SINGLE pragma choke point `applyKey`/`applyRekey` — always
  `normaliseCode`, charset-validated; the display↔normalised convergence seam Oracle most feared) ·
  `src/lib/dbMigrateEncrypt.js` (rekey in `journal_mode=DELETE`, `-journal` cleanup, crash matrix +
  kill-during-rekey) · `src/lib/dbStartup.js` (the decision table — Oracle C4) · `database/index.js` seam
  (`setEncryptionKey(code)` → `applyKey` + `temp_store=MEMORY`) · `scripts/db-crypto-tool.js` (export-plain
  via `rekey=''`) · `src/lib/secretStore.js` `encryptAtRestStrict`.
- **Pins (ALL GREEN under E44):** `test_dbkey` 16 · `test_db_cipher` 10 (**PORTABILITY** pinned) ·
  `test_db_migrate_encrypt` 18 (crash + kill-during-rekey + PORTABILITY) · `test_db_startup` 6
  (restored-backup row + tripwire) · `test_secretstore` 14. **`src/database.js` deleted** (dead).
- **arc doc `docs/designs/DB_ENCRYPTION_ARC_2026-08-31.md` fully rewritten** to the passphrase model
  (Oracle C9) + the security answers + the startup table + owner decisions.

## Verification state — honest
- Every pin above RAN and was READ green, under **Electron 44 as node** (`ELECTRON_RUN_AS_NODE=1
  node_modules\.bin\electron.cmd <test>`). Python pins under `py -3.12`.
- Flag-OFF byte-identical proven for the two arcs (mapper/anchor/totals/keyword suites).
- **NOT run** (owner-machine / heavy): realdoc-605 for arcs 1&2; the E44 merged-tree packaged boot +
  gate-5b; the encryption migration on a REAL DB; perf; a full app session incl. verifyAuditChain//v1.
- **Mid-session claim CORRECTED:** I first said the ciphers fork must jump to 13.x for E44 — 12.11.1's
  engines already span Node 20+22; but E44's own branch bumped better-sqlite3 to 13, so the merged tree
  uses the fork **^13** (13.0.3) to match — no regression, arc doc corrected.
- `npm start` on E44 CONFIRMED launching (owner saw it; log clean; mig 100 applied on the live DB).

## FIRST ACTIONS for the fresh session
1. Read this file + `docs/designs/DB_ENCRYPTION_ARC_2026-08-31.md` (the authoritative encryption spec) +
   the Oracle verdict at the foot of `docs/oracle_log.md`.
2. `git log --oneline -5`; the 3 unpushed commits await the owner's push (`! git push origin
   feat/teach-side-overnight`). The dev app may still be running on E44 (5 electron procs).
3. **The DB-encryption INTEGRATION pass** (the crypto core is done — do NOT rebuild it):
   - **whenReady gate** in `src/main.js` (right after the single-instance check ~line 963, BEFORE the
     first `getDb()` ~1111): `require('./lib/dbStartup').decide({dbPath})` → route `plaintext` (no-op,
     byte-identical) / `open-cached` (`setEncryptionKey(dbKey.loadCode())`; `DBKEY_UNDECRYPTABLE` →
     Unlock) / `prompt-code` (Unlock, restore mode) / `tripwire` (loud fail). `dbPath =
     path.join(app.getPath('userData'),'docusnap.db')`.
   - **Unlock/Recover window** (`src/windows/unlock/`, license-window pattern, `contextIsolation`/
     `sandbox`, minimal preload exposing `recover(code)`+`quit()`). On success: `dbKey.cacheCode(code)`
     then `app.relaunch(); app.exit(0)` (avoids a bootApp refactor). NO equal-weight "start fresh".
   - **The combined "Keep these safe" dialog** — EXTEND the existing login recovery screen
     (`src/windows/login/index.html` `#screen-recovery-code` + `showRecoveryCode()` in renderer.js,
     already has Copy+Print): show BOTH the admin-recovery code AND the DB recovery code, each **masked
     behind a Show button** ("reveal only when no one can see your screen"), **deferrable** ("Set up
     later" → stays plaintext, nudge — no un-noted code ever exists), a **hard-reinforced** consequence +
     a typed "I've saved these" confirm.
   - **Activation trigger** (opt-in Settings button → `dbKey.provision()` → show the dialog → on confirm
     `dbMigrateEncrypt.migrate({dbPath, code})`) + **slice 3** (downgrade-tripwire enforcement in the
     gate + default-on fresh installs).
4. **THE OWNER DRILL** (owner-supervised; the live DB is a sacrificeable testing platform — still
   `db.backup()` first): app CLOSED → provision → migrate the real DB → restart → confirm no-prompt open →
   delete `.db-key` → restart → confirm the Unlock window recovers by code → `export-plain` a copy.
5. **The two arcs' flip gates** (the OTHER deferred track, not started): realdoc-605 OFF==ON on a
   `db.backup()` copy (`RR_APP_ENV=1`, `OCR_RENDER_DPI=200`, dedup `RR_IDS`) for locate + fragment.

## Deferred / load-bearing conditions
- **Encryption (Oracle's 10 conditions — all in the arc doc + oracle_log):** pragma order is OWNED by
  `dbKey.applyKey`/`applyRekey` (never inline a `PRAGMA key`); `kdf_iter` pinned 256000 (open + migration
  MUST agree); the code is generated-125-bit-only (a user-chosen DB password reintroduces GPU-brute-force
  → forbidden without a memory-hard KDF); rekey is refused in WAL (always `journal_mode=DELETE` first);
  the startup table row `absent .db-key + ENCRYPTED header = restored backup → prompt` is the owner's
  requirement; "regenerate the DB code" = a full re-encrypt → **DEFERRED for v1**; **email-the-code is
  OUT** (SMTP for non-secret WORKFLOW notifications = a separate future feature, logged for barry).
- **Arc flips:** join AFTER the 08-30 sweep/discount; never via strict-money (locate). Fragment: hold-
  with-fragment → hold-with-full-value, M=7 unchanged.

## Needs the USER
- Push the 3 crypto commits (classifier may block `git push` in-tool → `! git push …`).
- The E44 merged-tree confirmation (packaged boot + gate-5b) before shipping a build.
- The encryption owner drill (above). The two arcs' realdoc flip gates + the live flips.

## Key facts / paths
- **Live DB** `%APPDATA%\ScanFinder\docusnap.db` — **PLAINTEXT**, at **mig 100** (99+100 applied this
  session, both DARK/OFF). Encryption INERT (no `.db-key`).
- **Stack now:** Electron 44 / Node 24 / better-sqlite3-multiple-ciphers 13.0.3 / argon2 0.45.1.
  `CLAUDE.md` stack table updated.
- **Run a native-module test:** `ELECTRON_RUN_AS_NODE=1 node_modules\.bin\electron.cmd <path>`; redirect
  via PowerShell `*> $log` (electron-as-node swallows stdout otherwise). Pure-JS tests run under `node`.
- **Traps hit this session:** the ciphers alias needs an EXPLICIT `npm install
  better-sqlite3@npm:better-sqlite3-multiple-ciphers@^13` (a plain `npm install` kept the base package);
  `PRAGMA rekey` is refused in WAL mode; readonly-open of an encrypted DB throws at construct time (can't
  set the key first); leaked SQLite handles (missing finally-close) lock the file → EBUSY on rename; the
  PowerShell shell-guard refuses a command containing `Remove-Item` + a quoted spaced path (whole command
  dies); `src/modules/templates/` is gitignored (`git add -f` for handler.js).
- **Oracle log:** the passphrase verdict is at the foot of `docs/oracle_log.md`. eric's dissent (keep the
  sidecar model) is in the 08-31 session transcript — overruled by Oracle + the owner requirement.
