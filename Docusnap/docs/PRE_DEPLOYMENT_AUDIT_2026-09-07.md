# Pre-Deployment Audit — Scan Finder (2026-09-07 night)

Full security + efficiency vet of the app, the detached client, the packaged builds (NSIS + MSIX), and
the PHP licensing backend. Read-only — **no code was changed.** Auditors: eric (Electron/client/packaging),
gary (Python backend), oscar (OCR pipeline), main-Claude (backend crypto, packaged exposure, dependencies).
Builds on the prior reviews (`docs/SECURITY_REVIEW_2026-09-01.md`, `_2026-08-28.md`, `_2026-08-10.md`) —
only new / changed / missed findings are called out; resolved items are not repeated.

## Headline
**The code is in genuinely good shape.** The Electron hardening (preload allowlist, nav lockdown on both
apps, sandboxed windows, server-side path resolution, DTO allowlist, pinned-CA TLS), the licensing crypto
(server-side Ed25519 seeds not in git, offline verify, Polar webhook properly signed), the PHP backend
(prepared statements, rate-limited 2FA admin, no-error-leak), and the Python layer (no injection surface,
per-file error isolation, no one-document hacks) are all solid and source-verified.

**The real deployment risks are NOT code holes — they are release DISCIPLINE and artifact TRUST:**
1. The test-switch revert list has **no build gate** — forget it and every customer ships unvetted switches ON.
2. **Unsigned + opt-in-hardened** artifacts make the fuses/source-protection meaningless on the direct-download channel.
3. The **DB is plaintext at rest**.
4. Two **easy efficiency wins** (DPI default, import parallelism) are the difference between "fast" and "feels broken".

Nothing here blocks the **MSIX/Store** channel except items P0-1, P0-3, P0-4 (Store signing covers P0-2).

---

## P0 — Release blockers (fix before ANY public deployment)

### P0-1 [CRITICAL · effort S] No build gate stops shipping the TEST-BUILD force-ON migrations
*gary + main-Claude, independently.* `database/index.js` carries 12 `TEST-BUILD force-ON` migration blocks
— **108/110/112/114/116/118/123/124/126/128/134/136** — each UPSERTing a DARK switch to ON. The `build`
chain (`package.json:9`) never checks for them; the only guard is prose in CLAUDE.md + a runtime `console.log`.
Forget to hand-revert ~12 scattered blocks and **every customer DB force-flips ~10 unproven, review-softening
switches ON** — several deliberately clear review flags (mig 108: "clearing the warn drops the cap+note — the
value may auto-file"), so the failure mode is **silent wrong auto-files** — exactly the M≠0 the corpus gate
exists to prevent. Compounding: these are settings UPSERTs, so **reverting the CODE does not un-set them on a
DB that already ran them** (no down-migration), and `deleteAppDataOnUninstall:false` means the owner's own
test machine keeps them ON forever, seeding any reference/backup DB with them.
- **Fix:** `scripts/check-release-migrations.js` prebuild gate wired into `build` — grep `database/index.js`
  for the `TEST-BUILD force-ON` marker and **fail the build unless `ALLOW_TEST_MIGS=1`** (test builds pass,
  a release build refuses). Add a machine-readable sentinel comment per block. Secondary: a real
  down-migration or a "customer build resets these OFF" reconciliation so a persisted ON can't survive.

### P0-2 [CRITICAL · effort M — owner] Unsigned installers make the asar-integrity fuses unenforceable; unpacked native modules are outside integrity entirely
*eric.* All five `electronFuses` are declared (`enableEmbeddedAsarIntegrityValidation`, `onlyLoadAppFromAsar`)
— but the asar hash is only tamper-proof if the PE is **Authenticode-signed**; unsigned, a local writer
recomputes it. And integrity validation **does not cover the unpacked `**/*.node`** (better-sqlite3, argon2)
in `app.asar.unpacked` — a swapped `.node` = in-process native code execution regardless of the fuse. The
core is `perMachine` (admin-write, mitigates); the **client is `perMachine:false`** (user-writable) + unsigned
→ a non-elevated local process can inject native code into the client. **Blocks direct-download.** The **MSIX
Store channel is covered** (Microsoft signs). See the account-type decision below (P0-2a).
- **Fix:** OV/EV Authenticode-sign the core + client (owner cert). If Store-only, Store signing suffices.

### P0-2a [decision — owner] The signing / account path is blocked on incorporating
Confirmed against Microsoft's current docs: an **IV cert exposes your legal name** on the UAC prompt + file
properties (rejected by the name-privacy rule); an **individual Partner Center account publishes under your
legal name AND is scoped to non-commercial use** (wrong type for a sold product); **individual→company
conversion is not supported.** The name-clean signed path (OV/EV cert *or* a company Store account as
"Six Mile Software Ltd") requires **incorporating Six Mile Software Ltd**. Interim: ship the **unsigned NSIS**
direct download (already name-clean) + move "incorporate later" → "before the Store launch." Full detail:
`MSIX_SETUP.md` §0.1 decision record.

### P0-3 [HIGH · effort S — build discipline] Default `npm run build` ships PLAINTEXT JS — source protection is opt-in
*eric.* With `HARDEN_JS` unset, the build ships all of `src/` + `database/` readable via `asar extract` — the
licence verifier (`enforcementActive()` hardcoded `true`, the pinned-key logic) in the clear, making the
"repack the asar → patch the verifier" revenue bypass trivial. The bytecode/obfuscation path only runs when
`HARDEN_JS=1`, which the `build`/`build:store` scripts never set. Same class as the old "HARDEN_FUSES never
set" trap; the owner likely believes release builds are hardened.
- **Fix:** a `build:release` script (or make `HARDEN_JS=1 HARDEN_JS_STRINGS=1` the release ritual) + verify
  the packaged app boots under bytecode. Note: the recent hardened NSIS + MSIX builds this session WERE built
  with `HARDEN_JS=1` — but nothing enforces it for the next build.

### P0-4 [HIGH · effort L — product decision] Plaintext DB at rest (R1, carried from 09-01)
*eric + 09-01.* `documents.ocr_text` + extractions + learned values (names, addresses, VAT, bank details) are
plaintext in `docusnap.db`; the DB-encryption arc is built but DARK/opt-in (no key → byte-identical plaintext).
WAL/SHM sidecars equally plaintext. A stolen laptop or a copied DB file = every scanned document readable.
- **Fix (owner decision):** ship DB-encryption default-ON, OR ship a LOUD documented "the DB is plaintext —
  enable DB encryption or BitLocker" posture in first-run + the privacy page. **Do not ship silent.**

### P0-5 [HIGH · effort M] `/v1` login does not enforce the forced temp-password reset (A1, still open)
*eric.* The `/v1` login/enroll issue a full session token with no reference to `must_change_password`; the
route is optional self-service. An admin-issued one-time temp credential keeps working indefinitely on the
client surface. **Fix before the LAN client ships:** login checks `must_change_password` → issue a
change-password-only restricted token (or 403 normal ops) until the change succeeds — mirror the desktop.
*(Only gates the detached LAN add-on, not the core desktop.)*

---

## P1 — Security (high value, do before/with release)

### P1-1 [HIGH · effort S] Bump `node-forge` 1.3.1 → 1.4.0 + add an `npm audit` prebuild gate
*eric + main-Claude.* 7 HIGH advisories (cert-chain `basicConstraints` bypass, Ed25519/RSA signature forgery,
ASN.1 DoS). **Exploitability is LOW here** — the client verifies with Node TLS + pinned CA (`rejectUnauthorized`),
not forge, and `certService` only *generates* certs — but a public release should not ship an open HIGH a
scanner will flag. Fix is a non-major bump. Add `npm audit --omit=dev --audit-level=high` to the prebuild chain.

### P1-2 [MED · effort M] Pin + version-check + CVE-scan the vendored Python stack
*gary.* `check-vendor-python.js` checks *importability* only, never versions; there is no pinned
`requirements.lock`. **Pillow parses untrusted scanned images and has a recurring image-decoder CVE history**;
pypdfium2 parses untrusted PDFs. A re-provisioned `vendor/python` can silently pull a vulnerable version.
- **Fix:** commit a pinned `python_backend/requirements.lock` (with hashes), assert exact versions in
  `check-vendor-python.js`, and set a review cadence. **Pillow is the priority.** (Needs the build machine to
  enumerate current `vendor/python` versions — not present in the checkout.)

### P1-3 [MED · effort S — owner/ops] Confirm the backend `DocumentRoot` = `public/`
*main-Claude.* `keys/` (Ed25519 seeds, private PEMs, DB creds) is a **sibling** of `public/` — safe if the
web root is `public/`. If the host serves the licensing-backend root instead, `keys/` is protected **only by
Apache `.htaccess`** (`harden.php` itself warns these "evaporate on nginx/LiteSpeed"). A seed leak = **license
forgery.** Verify the IONOS DocumentRoot is `public/` (then keys are outside the web root regardless of server).

### P1-4 [MED · effort S — config] Turn admin 2FA ON for production
*main-Claude + prior.* `LICENSING_ADMIN_REQUIRE_2FA` defaults OFF (a known, documented downgrade). The admin
console governs licences/trials/entitlements — set it ON for the production deploy.

### P1-5 [MED · effort S — owner verify] Verify the fuses in the shipped artifact (bricking risk)
*eric.* `onlyLoadAppFromAsar` + `enableEmbeddedAsarIntegrityValidation` **brick launch** if electron-builder
didn't inject the header hash. Nobody has confirmed the shipped `.exe` boots under them. `npx @electron/fuses
read --app dist/win-unpacked/ScanFinder.exe` + install and click through every window, on the owner's machine.
*(The hardened NSIS was smoke-installable this session, but the fuse read hasn't been done explicitly.)*

### P1-6 [LOW · effort S] Client CSP lacks `base-uri` / `form-action`; core windows are meta-CSP only
*eric.* `client/renderer/index.html` CSP is strong (`default-src 'none'`) but a `<base>`/form injection is
unconstrained — add `base-uri 'none'; form-action 'none'`. Defence-in-depth: move core-window CSP to a
session `onHeadersReceived` header (stronger than meta). Not a hole.

### P1-7 [LOW · effort S] Predictable temp-file name on `get-page-deskew`
*eric.* `ds_deskew_${Date.now()}.png` with no sequence counter — two concurrent calls in the same ms collide.
Add the `_${seq++}` counter the sibling `ocr-page-words` already uses. Role-gated + per-user `%TEMP%` ACL, so LOW.

### P1-8 [design arc — HOLD the LAN add-on] No document-level access control
*eric + 08-28.* Read is `canAccessDocument`-gated, but ENUMERATE (search/queue) and an owner/doctype schema
column are not. Single-user desktop = unaffected. **Blocks deploying the LAN client / multi-user desktop into
an office with mixed HR/payroll + general docs.** This is a schema+design arc → advisor+Oracle gate before
build; do not stub-fill.

---

## P2 — Efficiency (the "does it feel fast" tier — mostly easy + safe)

### P2-1 [HIGH · effort S] Fresh installs default to 300 DPI, not the owner-validated 200
*oscar — the single biggest per-doc time+memory lever.* `ocr_dpi` has no seeding migration → code default 300
everywhere; the owner's install and the whole corpus history ran/validated at **200**. OCR cost scales ~DPI²,
so customers pay **~2.25× the OCR time and page-raster memory** for accuracy the corpus never needed.
- **Fix:** seed `ocr_dpi=200` (one `INSERT OR IGNORE` migration, mirrors mig 101). Safe direction — on
  genuinely tiny print, 200 reads fewer glyphs → routes to **review**, never a silent wrong file. Keep 300 in
  the dropdown + a first-run "high-resolution scans?" nudge.

### P2-2 [HIGH · effort S] Single-document import parallelism ships OFF
*oscar — the "teach then import is slow" complaint, unfixed for customers.* `OCR_PARALLEL_IMPORT` (mig 127
seed OFF) leaves the teach-wizard single-doc import **fully serial on one core** while 3-7 cores idle
(~1.6-2.2× wall-clock lost). Synergistic with P2-1: 200-DPI rasters roughly halve the per-worker RAM that was
the Oracle's C7 hold on flipping this.
- **Fix:** flip `ocr_parallel_import_enabled` ON in the **same build** as the DPI drop (or ship the
  memory-pressure gate). Do NOT weaken the `singleDocParallelEnv` OMP-cap guard — it's what keeps the read
  byte-identical.

### P2-3 [MED · effort M] Deskew review-retry re-renders + re-OCRs the WHOLE doc a second time
*oscar.* ON by default (mig 101); on the cold-start first batch (nearly all review-bound, casual scans often
tilted) a large fraction of docs pay ~2×. The heal is genuinely valuable (~98% of otherwise-empty ref/date).
- **Fix (preferred):** the second pass should **reuse the already-rendered page bitmaps** (it re-renders from
  the PDF; straightening is on the same pixels — re-render is redundant, ~0.25s/page). OR move the heal to the
  Review "Straighten + Reprocess" button so cold-start import stays fast. Keep the never-auto-file hold.

### P2-4 [MED · effort S] The RAM cap is calibrated for 200 DPI → at the 300 default a big multi-page scan can OOM a 4-8GB PC
*oscar.* `PER_WORKER_BUDGET_BYTES` = 1.5GB assumes 200-DPI pages; `extract_text_and_images` holds ALL pages at
once. A 50-page 300-DPI scan ≈ 1.3GB of rasters in one worker. Fixing P2-1 recovers the assumption for free;
independently, recalibrate the budget from the active `ocr_dpi` (∝ DPI²) so the worker-count math stays honest.

### P2-5 [MED · effort L — post-deploy, M=0-gated] Every field crop spawns a cold `tesseract.exe`
*oscar.* ~20-40 short-lived tesseract processes per scanned doc; the Windows spawn tax is plausibly 30-50% of
per-doc time. The warm `region_worker` pool serves only the interactive draw tool, not extraction.
- **Fix (experiment):** a persistent Tesseract via `tesserocr` (MIT over Apache-2.0 Tesseract) or a warm
  extraction worker. **Read-path engine swap → gate behind realdoc M=0 (byte-identical) before it nears a
  customer.** The biggest structural win, but not a pre-deploy change.

### P2-6 [LOW · effort S] Preview render materialises ALL pages at once
*oscar.* `render/pages.py` base64-encodes every page into one payload — a 50-page doc spikes memory when opened
in Review. On-demand (not import hot path). Lazy per-page render for large docs. Nice-to-have.

---

## P3 — Refactor / tech debt (POST-LAUNCH — do not touch on the eve of ship)

- **[MED/L] `ExtractionEngine.extract()` is a single ~3,688-line method** (engine.py:8123-11811). The crown
  jewel; every change must clear M=0, which is *why* it grew monolithic. Decompose into named stage methods
  post-launch, one slice at a time, each M=0-gated. Flag as a tracked program, not an accident. *(gary)*
- **[MED/M] Switch sprawl** — 134 env switches in engine.py; ~85 default-OFF, many DARK-forever. Triage:
  shipping-ON → inline + delete the switch; DARK-with-a-live-gate → keep; DARK-abandoned / NEVER-flip (e.g.
  `template_format_fail_yield_strict_money`) → **delete the code + test** (a NEVER-flip switch is a loaded gun). *(gary)*
- **[L] Monolithic renderers/handlers** — `review/renderer.js` ~11.6k, `settings/renderer.js` ~6.7k,
  `processing/handler.js` ~6.8k. Split by feature the way `search/` already is. Raises regression risk +
  review cost per hotfix. *(eric)*
- **[MED/S] Observability: 42 silent `except Exception: pass` in engine.py** hide stage regressions (safe for
  the user — fail-toward-review — but a future bug goes invisible). Funnel through one `_swallow(exc, where)`
  that logs `warn` when `--trace`/diagnostics is on. Zero happy-path change. *(gary)*
- **[S-M] `getSetting` is uncached** — 394 call sites, synchronous DB reads on the event loop, some in per-doc
  hot paths. A short-lived cache invalidated on `set-setting` + backup-restore. Measure first. *(eric)*
- **[L] ~30 `_flag_*/_reconcile_*/_resolve_*` note-resolvers** share a shape but the ordering is load-bearing +
  comment-encoded — a small strategy/registry would make ordering explicit. Low priority; note the fragility. *(gary)*

---

## Verified SOLID — state to buyers, do not touch
- **Preload** = pure named-allowlist bridge; no raw `ipcRenderer`/`fs`/`shell`/`child_process`.
- **Nav lockdown on both apps** (deny new windows, block off-tree navigation, refuse `<webview>`); every window
  `contextIsolation + nodeIntegration:false + sandbox:true`.
- **Path containment (SEC-17)** — reparse-aware, fail-closed, UNC-rejected, ext-allowlisted. `split-pdf` and
  the render/thumbnail doors resolve every path **server-side** from the doc row (renderer input ignored).
- **`/v1`** — loopback-gated default, body-size capped, login rate-limited, password-change revokes all
  sessions, HSTS on TLS. **DTO** = conformance-tested allowlist (no `stored_path`/`folder_path`/`ocr_text` leak).
  **TLS client** pins the CA with `rejectUnauthorized:true`.
- **Licensing** — pinned keys win when packaged, enforcement hardcoded ON, fingerprint hashed in main; **Ed25519
  private seeds are NOT in git** (`keys/*` gitignored except the `.htaccess` backstop); **Polar payment webhook
  is properly signed** (replay-windowed, `hash_equals` timing-safe, correct Standard-Webhooks HMAC).
- **PHP backend** — real prepared statements (`EMULATE_PREPARES=false`), rate-limited + 2FA + session-fixation-
  hardened admin, `harden.php` PHP-enforces no-error-leak + security headers. `license.json` is public-keys-only.
- **Python** — no `shell=True`/`eval`/`exec`/`pickle`/`marshal`/bare-except; **per-file error isolation** (a
  corrupt file → error row, never a batch crash); the `_`-metadata-pop → `sanitise_extractions` invariant is
  honored; **no one-document hacks** (exhibit names only in explanatory comments); DoS caps (300 pages / 10000px
  / 500MB) + a per-file watchdog; born-digital fast path; the recent perf work (SHARED_LOCATE_CACHE, OMP-inherit)
  is sound + pinned. **No memory leaks found** (Electron or Python).
- **Tooling/licences CLEAN** — no PyMuPDF (all pypdfium2), every OCR/Node dep free-for-commercial, the
  `check-licenses` gate enforces it per build.

---

## Owner action list (things only you can do)
1. **Incorporate Six Mile Software Ltd** — unblocks the name-clean signed path (OV/EV cert *or* company Store
   account) and resolves P0-2a. This is now the gating business step for a trustworthy public release.
2. **Decide the DB-at-rest posture** (P0-4) — encryption default-ON or a loud documented plaintext stance.
3. **Confirm the backend DocumentRoot = `public/`** (P1-3) and set admin 2FA ON (P1-4).
4. **After the code fixes:** build a `HARDEN_JS=1` release, verify the fuses (P1-5), and (once incorporated)
   code-sign.

## Suggested build order (code work, all safe, no product churn)
1. P0-1 test-mig gate (S) — the one genuinely dangerous, cheap hole.
2. P0-3 `build:release` script forcing HARDEN_JS (S).
3. P1-1 node-forge bump + audit gate (S).
4. P2-1 + P2-2 DPI 200 + import parallelism (S, synergistic — the big "feels fast" win).
5. P1-2 vendor/python pin (M), P2-3 deskew bitmap reuse (M).
6. P3 refactor program — scheduled, post-launch, each M=0-gated.
