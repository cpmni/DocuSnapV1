# Scan Finder — Security & Performance Re-Audit

**Date:** 2026-07-15
**Baseline compared against:** `docs/audits/SECURITY_AUDIT.md` (2026-06-20, findings F-01…F-09 + L-01…L-09)
**Method:** Read-only. Automated scanners (`npm audit`, `pip-audit`, `bandit`, `detect-secrets`, `check-licenses`), a multi-agent code-verification pass over every prior finding, and the project's own sandboxed stress harnesses (concurrency, import-load, accuracy). **No application code was modified.** This report is the only artifact written.

---

## 1. Executive summary

**Posture: materially improved since 2026-06-20, with two new dependency-CVE findings and a short list of still-open items.**

- Of the **3 High** findings, one is **FIXED** (F-02, arbitrary file read) and two are **materially mitigated** (F-01 multi-point licensing enforcement now spans 6+ handlers; F-03 a real MySQL rate-limiter now throttles all licensing endpoints). Neither High is "one-line bypass / wide-open" anymore.
- Three of the **Medium/Low-Med** findings are **FIXED** (F-06 open-file path allowlist, F-07 key gitignore, F-08 filing traversal), plus **L-07** (constant-time pairing compare).
- **Every "positive to preserve" held** — the offline token verifier, strict CSP, contextIsolation, no-injection Python, and PDO-prepared PHP are all intact (no regression).
- **Static analysis is clean**: `bandit` 0 medium/high, `detect-secrets` 0, license compliance 77/77 (no GPL/AGPL).
- **Robustness is sound**: the concurrent confirm/file path and the import path both hold every "no lost / no double / isolated errors" invariant.
- **New this round** (the 2026-06-20 audit was static-only and did not scan dependencies): a **shipped Pillow 12.2.0** with 8 image-parsing CVEs, and **node-forge 1.3.1** (7 CVEs, but scoped to LAN cert-generation only — *not* the license verifier or runtime TLS).
- **Still open**: F-04 (enroll credential MITM), F-05 (admin login lockout), F-09 (fingerprint), L-01/L-02/L-05, and the "deeper" half of F-01/F-03.

### Score card vs 2026-06-20

| Status | Findings |
|---|---|
| **FIXED** (7) | F-02, F-06, F-07, F-08, L-07 · positives POS-token/csp/electron/python/php intact |
| **PARTIALLY_FIXED** (5) | F-01 (multi-point ✓, entanglement/native ✗), F-03 (limiter ✓, client-fp/fail-open ✗), L-03 (documented ✓, retention ✗), L-04 (app paths ✓, CLI/finally ✗), L-06 (docroot documented ✓, keys/.htaccess ✗) |
| **OPEN** (6) | F-04, F-05, F-09, L-01, L-02, L-05 |
| **MOOT / by-design** (2) | L-08 (no mTLS), L-09 (config integrity — token is the anchor) |
| **NEW** (2) | N-01 Pillow 12.2.0 (shipped) image-parsing CVEs · N-02 node-forge 1.3.1 (cert-gen only) |

---

## 2. Automated scan results

| Scanner | Result |
|---|---|
| **bandit** (`-r python_backend -ll`) | **CLEAN** — 0 High, 0 Medium (132 Low = asserts / try-except-pass idioms). Confirms "no injection / no insecure deserialization." |
| **detect-secrets** (tracked files) | **CLEAN** — 0 potential secrets. Confirms no committed production secret. |
| **check-licenses** (`scripts/check-licenses.js`) | **PASS** — 77/77 components on the approved allowlist; no GPL/AGPL. |
| **npm audit** (prod) | **1 High** — `node-forge ≤1.3.3` (installed 1.3.1). See N-02. |
| **pip-audit** (env + vendored) | **15 vulns / 3 packages** — see N-01; only Pillow is a *shipped* concern. |

### N-01 — Pillow 12.2.0 (shipped) has 8 image-parsing CVEs · **Medium–High** *(NEW)*
`vendor/python/Lib/site-packages/pillow-12.2.0.dist-info` — the **shipped** Pillow is 12.2.0, which `pip-audit` flags with 8 advisories (PYSEC-2026-2253/54/55/56/57, 3451/52/53), all fixed in **12.3.0**. Pillow parses the page images the OCR pipeline renders, i.e. it processes **untrusted document input** — the exact threat class for an image-parser CVE. Recommend bumping the vendored Pillow to ≥12.3.0 on the next build.
*Not a concern:* the **shipped `pypdf` is already 6.13.3** (the dev-env's 6.13.1 CVE does not apply to the product); the `pip` 6 CVEs are the dev/build toolchain only (pip is not shipped).

### N-02 — node-forge 1.3.1 has 7 CVEs, scoped to LAN cert-generation · **Medium** *(NEW)*
`node-forge@1.3.1` (fix: 1.4.0) carries advisories incl. cert-chain `basicConstraints` bypass and Ed25519 signature forgery. **Scope is contained:** node-forge is used **only** in `src/services/certService.js` + `cert-tool/` for *generating* the LAN add-on's CA/server certs. It is **not** in the license verifier (`src/lib/license/token.js` uses Node's native `crypto`, confirmed) and **not** in the runtime TLS verification (Node/OpenSSL does that). So the verification-bypass/forgery CVEs do not sit on an active exploit path in the core app; the residual is DoS/robustness during admin-triggered cert generation. Bump to 1.4.0 when convenient (the LAN client is an off-by-default add-on).

---

## 3. Finding-by-finding status vs the 2026-06-20 audit

### High severity

**F-01 — Licensing single client-side branch · PARTIALLY_FIXED (was the top issue).**
Multi-point enforcement landed: a shared, network-free, fail-closed `licenseDenied(db)→evaluateCachedAccess(db)` (`licensing/handler.js:500-537`) is now called at **6+ independent high-value handlers** — process-folder/bulk import (`processing/handler.js:765`), reprocess (`:1142`,`:1384`), confirm-review filing (`review/handler.js:586`), template-mapping save (`templates/handler.js:460`,`:476`). Search is deliberately left ungated (read-only, documented). The cited "patch one branch" weakness is **closed**. **Not done** (SECURITY_AUDIT §5.2 steps 2–5): no token-value entanglement and no native/integrity check — every re-check is still patchable JS calling one evaluator, so a bundle patch of `evaluateCachedAccess` still neutralizes all sites at once. Multi-point ✓, deep anti-tamper ✗.

**F-02 — Authenticated arbitrary file read (`GET /v1/documents/:id/pages`) · FIXED.**
The handler (`api/handler.js:466-488`) now resolves the on-disk path **server-side only** from the `docId` row (`working_path→stored_path→folder_path+original_filename`), derives folder/filename from it, and never reads client-supplied `folderPath`/`filename` (explicit F-02 comment at `:470-476`). Same server-side resolution applied to `/thumbnail` and `/workflow/routes/:id/stamped`. The DTO boundary is restored — the arbitrary-read vector is closed.

**F-03 — Licensing server no rate limiting · PARTIALLY_FIXED.**
A new `lib/ratelimit.php` (fixed-window MySQL, prepared statements, `rate_limits` table in `schema.sql:96`) throttles **all** cited endpoints: per-IP on trial_start (10/h), activate (30/h), validate (120/h), revoke (30/h), status (240/h); a global daily new-trial cap (500/day); escalating account-key-guess backoff (>12 fails → 900s veto); all return 429 + Retry-After. The primary abuse vectors (unlimited trial farming, unthrottled key guessing, unauth DoS) are now **materially throttled**. **Residuals:** trial fingerprint is still client-asserted (the audit's second prong), the limiter **fails open and is inert until the `rate_limits` table is migrated** (silent no-throttle on an un-migrated host), throttling is per-IP/global not per-fingerprint, and no CAPTCHA/PoW/entropy floor.

### Medium / Low-Medium

| ID | Status | One-line |
|---|---|---|
| F-04 enroll over unverified TLS | **OPEN** | `apiClient.js:202-210` still POSTs creds+TOTP with `insecure:true` before any CA pin; MITM can still capture credentials. |
| F-05 admin login lockout | **OPEN** | Still only `usleep(0.4s)`; no IP lockout, TOTP still optional. Stage-2 2FA throttling is unreachable without the password. |
| F-06 open-file arbitrary path | **FIXED** | `_isOpenablePath` (`processing/handler.js:381-406`): UNC-reject + extension allowlist (no .exe/.lnk) + containment in app roots or a recorded doc path. |
| F-07 TLS keys not gitignored | **FIXED** | `.gitignore:47-50` adds `Samples/`, `*.key`, `*.pfx`, `*.p12` (F-07 comment); `git ls-files`/`git log` confirm never tracked. |
| F-08 filing `..` traversal | **FIXED** | Dot-only segments collapse to '' and are dropped (`filename_pattern.js`), **plus** an explicit `path.resolve` containment assert (`filing/handler.js:153-159`). |
| F-09 weak fingerprint | **OPEN** | `SHA-256(product_id\|MachineGuid)` unchanged; no per-install secret blended. (Design tension: the fingerprint must survive reinstalls, which conflicts with a random per-install secret.) |

### Lower-severity hardening

| ID | Status | Note |
|---|---|---|
| L-01 sandbox:true | **OPEN** | `contextIsolation:true` on, but Chromium sandbox still not enabled. |
| L-02 innerHTML / lint | **OPEN** | Now 213 occurrences (was 129); no lint rule / Trusted Types. CSP `script-src 'self'` remains the backstop. |
| L-03 log retention | **PARTIALLY_FIXED** | Sensitivity now documented (header + Settings warning); no rotation/retention cap or clear-diagnostics action. |
| L-04 temp lifecycle | **PARTIALLY_FIXED** | App split/render paths clean deterministically; residual = the unreachable CLI `mkdtemp` fallback + a few close-only (non-`finally`) single-file unlinks. |
| L-05 TOTP single-use | **OPEN** | No last-used counter on either PHP or JS TOTP; a captured code is replayable ≤90s. |
| L-06 keys/ .htaccess | **PARTIALLY_FIXED** | Deploy script documents docroot=`public/` and sibling `keys/`; the belt-and-braces deny-all `.htaccess` in `keys/` is still absent. |
| L-07 constant-time pairing | **FIXED** | `pairingOk` now uses `crypto.timingSafeEqual` with a length pre-check (`api/handler.js:990-1006`). |
| L-08 no mTLS | **MOOT** | By design; no regression. |
| L-09 config integrity | **MOOT** | Token signature is the anchor; a tampered config yields an unverifiable token → locked. No regression. |

### Positives — confirmed **not regressed**
Offline token verifier (EdDSA-only, pinned kid, verify-before-trust, fp binding, rollback-proof clock — `token.js`) · strict CSP `script-src 'self'` on all 25 windows · `contextIsolation:true`, no `nodeIntegration`/`webSecurity:false`/`sandbox:false` · Python backend has no `shell=True`/`eval`/`exec`/`pickle`/`yaml.load` · PHP PDO prepared statements throughout. All intact.

### Recent-change review
A dedicated pass over the last ~25 commits + the uncommitted working-tree changes (this session's `engine.py` identity-resolution guards + text-first supplier graduation — pure extraction logic, no network/FS/SQL/IPC surface) found **no new security issue**: no new ungated IPC, no new path handling, no new spawns, no SQL string-interpolation, no CSP weakening.

---

## 4. Performance & robustness measurements

### 4.1 Concurrency / robustness (sandboxed harnesses — no live DB touched)

| Harness | Result |
|---|---|
| **concurrency_harness** (4-way simultaneous confirm on 360 docs = 1440 requests, + defer/undefer/collision/rollback races) | **PASS (isolated).** Every invariant green: no double-file, no lost doc (360/360 exactly one winner), 400/400 confirmed, bijection stored_paths ≡ physical files, correct filed location, own-doc marker (no cross-doc mixup), -DUPLICATE handling, rollback-on-filing-failure, WORKFLOW_LOCKED, ALREADY_FILED re-confirm, no value-blend on divergent confirms, inbox emptied, counts zero. |
| **import_load_harness** (168 files = 160 valid + 8 pathological, 8 parallel workers) | **PASS.** No files lost (168/168 produced a `file_done`), all 160 valid processed, corrupt files isolated as `status=error` (never a crash, never a dropped shard), no worker crash. **Throughput ≈ 2.5 docs/s** wall-clock (168 files / 66 s across 8 workers, incl. scanned-OCR variants). |

> **Methodology note:** an initial concurrency run reported 5 "lost" docs — but the signature was *all four requests returning no HTTP response* (`statuses=0,0,0,0`), i.e. **server overload/timeout because I ran it concurrently with the accuracy harness**, not a logic race (a real race shows `200` + `409`s). Re-run **isolated**, every invariant passed. The confirm/file path is race-safe; just don't run the heavy harnesses simultaneously.

### 4.2 Extraction accuracy

**Shipped-config baseline** (`accuracy_harness`, 400-doc labeled corpus, **fresh DB, no learned data**):

| Field | Text (born-digital) | Scanned | Overall |
|---|---|---|---|
| type | 100.0% | 95.5% | 97.8% |
| ref | 100.0% | 94.0% | 97.0% |
| date | 100.0% | 95.5% | 97.8% |
| total / subtotal | 100.0% | 100.0% | 100.0% |
| supplier | 0.0% | 0.0% | 0.0% *(expected)* |

Born-digital docs are at the ~100% ceiling on every structural + money field. Supplier is 0% **by design at baseline** — the issuer is identified by logo fingerprint + learning, not a shipped caption. The only baseline weakness is **scanned SO/PO type-detection** (OCR noise mis-types some as `invoice`, cascading ref/date to NULL) — closed in practice by a learned template match.

**Live accuracy with learning** (`realdoc_regression`, 174 of the owner's *confirmed* docs reprocessed vs their confirmed values):

| type | supplier | ref | date | M (would-auto-file WRONG) |
|---|---|---|---|---|
| 99.4% | 99.4% | 98.3% | 98.9% | **1** (the standing pre-existing `#135` delivery-note ref-misread) |

Learning takes supplier from the 0% baseline to 99.4%. **M = 1** means exactly one confirmed doc would auto-file a wrong value — a *pre-existing* high-confidence delivery-note ref misread (`DN-35664`→`DN-38884`), unrelated to any recent change and already on the backlog.

---

## 5. Comparison verdict

**The app is in a better security position than at the 2026-06-20 audit, and its core robustness/accuracy are strong.**

- **Closed or materially reduced:** the two most dangerous data-boundary issues (F-02 arbitrary file read → **FIXED**; F-01 single-branch licensing → **6+ enforcement points**; F-03 no-throttle server → **real rate limiter**), plus F-06/F-07/F-08/L-07.
- **No security regressions** — every prior "positive" held, and recent changes added no new surface.
- **New, not previously scanned:** dependency CVEs — the only *shipped* one that matters is **Pillow 12.2.0** (bump to 12.3.0); node-forge is cert-gen-scoped.
- **Robustness:** the concurrent confirm/file path and the import path both hold all "no loss / no double / isolated errors" invariants.
- **Accuracy:** ~100% on born-digital, 99.4% live supplier with learning, M=1 (pre-existing).

### Recommended next actions (prioritized, unchanged items carried forward)

**Tier 1 (before commercial release):**
1. **Bump vendored Pillow → ≥12.3.0** (N-01) — untrusted image parsing; XS on the build machine.
2. **F-03 residuals:** ship the `rate_limits` migration as a hard deploy step (the limiter silently fails open without it), and add per-fingerprint throttling + document a ≥128-bit account-key entropy floor.
3. **F-01 depth:** add token-value entanglement + an asar-integrity/electron-fuse check so a JS bundle patch can't neutralize all enforcement at once.

**Tier 2:** F-04 (pin CA / HMAC-bind enroll before sending creds), F-05 (admin IP lockout + mandatory TOTP), bump node-forge → 1.4.0 (N-02), L-06 (`keys/.htaccess`).

**Tier 3:** F-09 (per-install secret blended into fp), L-01 (`sandbox:true`), L-02 (lint rule / Trusted Types), L-03 (log retention + clear action), L-04 (`try/finally` + `proc.on('error')` on the single-file OCR handlers), L-05 (single-use TOTP), backlog `#135` delivery-note ref pattern.

---

*End of re-audit. No application source was modified. The uncommitted working-tree changes to `python_backend/extraction/engine.py` (this session's extraction-logic work) were reviewed and carry no security impact.*
