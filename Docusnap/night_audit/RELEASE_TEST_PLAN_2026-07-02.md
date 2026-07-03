# Scan Finder — Release-Readiness Test Plan & Risk Register (overnight multi-agent, 2026-07-02)

Five testing-expert agents, one domain each (~48 min of scenarios → **~4 hours** total). REPORT ONLY —
no code changed. Coordinator compiled + cross-reviewed the outputs (agents "communicated through" the
coordinator: convergences and reconciliations are noted inline).

Domains: (1) Document processing & import · (2) Extraction & detection + learning · (3) Security ·
(4) Concurrency & multi-user · (5) UI/renderer + client + regional.

---

## VERDICT

- **The default (anglo/dmy) install is release-ready.** The 400-doc accuracy harness (type/ref/date
  ~97%, subtotal/total 100%), the concurrency harness (35/35, exactly-one-winner CAS), the import-load
  harness (168/168, 0 lost), and the /v1 security suite are all green, and no new injection / traversal /
  auth-bypass / double-file / lost-doc defect was found.
- **Two clusters need a decision before you tag a release** (details below): the **regional feature set**
  (new, under-tested, one correctness risk + a missing JS twin) and the **batched watch folder** (three
  behavioural gaps vs manual import that I introduced this cycle).

---

## CROSS-REVIEW RECONCILIATIONS (the "communicate through you" output)

- **CR-1 — "CRITICAL double-file race" is a STALE HARNESS ARTIFACT, not a bug.** Security flagged the
  committed `night_audit/v1_stress_findings.json` line `CRITICAL … parallel confirm: 6 WINS (expected 1)`.
  Concurrency independently reconciled it: `v1_stress.js` stubs `filing.commitDocument` to return success
  **without** exercising the real claim-then-file ordering, so it can't observe the atomic
  `documents.confirmIfReviewable` claim. The production path IS race-safe (`reviewService.confirm` claims
  before its first `await`; `concurrency_harness.js` = 35/35, exactly 1 win / 3×409). **Action:** annotate
  or fix `v1_stress.js` so the stored finding stops reading "CRITICAL double-file"; do not ship with that
  unexplained finding on disk. (No product code change needed.)
- **CR-2 — Watch-folder gaps converge across Doc-processing + Concurrency.** Both agents independently
  flagged the batched watch path (which I refactored this cycle). See BLOCKER-2.
- **CR-3 — Regional risk converges across Extraction + UI.** Extraction (R1/R5) + UI (Gap-1) both land on:
  new regional code, under-tested, not surfaced at onboarding. See BLOCKER-1.

---

## CONSOLIDATED RISK REGISTER (deduped, prioritized)

### BLOCKER-1 — Regional feature set: one correctness risk + missing test/JS-twin coverage
- **B1a (P1 correctness) — mixed-format amount corruption.** A single global `region_number_format`
  means a document in the "other" format is mangled: under `continental`, an anglo `"1,234.56"` →
  `to_canonical` → **`1.23456`** (1000× wrong), silently, no flag. Bites any mixed-inbox (foreign supplier
  invoices). `number_format.py to_canonical`. **Decide:** detect-per-value, guard (only convert when the
  value matches the region's expected shape), or document "set your region to match your documents."
- **B1b (P1 process) — new extraction code shipped with ZERO unit tests.** No `test_number_format.py`;
  `test_date_formats.py` has no mdy/ymd/`set_date_order` cases; `test_network_field_authority.py` never
  calls `normalize_network_address` (MAC slip-fix / clean / invalid branches); nothing covers the totals
  keyword-alias or `_search_for_label` currency-column skip. The 400-doc harness only runs the default
  path. **Action:** add the B/C/D/E unit suites below before tagging.
- **B1c (P1) — the claimed JS twin is ABSENT.** `number_format.py:22` docstring cites
  `database/modules/number_format.js` "keep in lockstep" — the file does not exist. So the Review on-blur
  validator and Search do NOT region-normalise: a stored bare integer `"500"` **false-"invalid"-warns**
  on blur (its currency validation pattern requires a symbol or `.dd`), and continental search diverges
  from backend storage. **Action:** add the twin (mirror `text_normalise.js`) OR at minimum fix the
  on-blur currency pattern to accept a bare integer, and fix the docstring.
- **B1d (Medium UX) — regional settings not offered at first-run.** `REGION_SETTINGS_PLAN.md` proposed a
  wizard region step; onboarding writes none. A US/German user gets DMY/anglo parsing until they discover
  Settings → Processing. **Action:** add a region picker to onboarding (or a first-run prompt).
- **B1e (Low) — "auto" date order is a no-op** (`_formats_for_order('auto')` == dmy). The shipped UI
  picker only offers dmy/mdy/ymd (not "auto"), so this is latent/back-end only — leave, or remove the CLI
  choice.

### BLOCKER-2 — Batched watch folder: behavioural gaps vs manual import (introduced this cycle)
- **B2a (High) — watch never splits multi-document PDFs.** `watch/handler.js` `_drainQueue`/`_processBatch`
  has no `_separateBatchDocuments` pre-pass; manual import does. A PDF of 10 alerts dropped in the watch
  folder → **one** document, and if it reads ≥ `auto_file_threshold` clean it **auto-files** the merged
  doc with no Review stop — exactly the "scanner drop folder" use case. **Decide:** run separation in the
  watch batch too, or document watch inputs as single-doc-only.
- **B2b (Medium) — watch bypasses the license enforcement check** manual import runs (`licenseDenied`).
  A revoked/expired seat still auto-imports + auto-files via the watch folder. Highest-value write path.
- **B2c (Medium) — watch overlap check is set-time only, not poll-time.** If output/Processed is later
  reconfigured to overlap the watch folder, the poll keeps importing filed copies → `-DUPLICATE` re-import
  loop (the failure QA #8 fixed for manual).
- **B2d (Low-Med perf) — manual import doesn't defer to a running watch batch.** The `isBatchRunning()`
  guard is one-directional (watch defers to manual, not vice-versa); starting a manual import during a
  watch batch runs both pools → ~2×cores threads, CPU thrash (DB state stays correct — perf only).

### LOWER (fix opportunistically / document)
- **L1 (Low) — currency-strip stores region-inconsistent shapes** (`anglo` keeps `12,268.80`, `continental`
  strips to `1234.56`) — weakens exact search; `parseFloat`-based compare is unaffected.
- **L2 (Med, pre-existing/known) — client "draw a box to OCR-fill" returns empty text** (`region.py`
  "nothing readable" on a real drag; crop-frame/preview-resolution). Documented in handover; gate the
  client-review targeting messaging.
- **L3 (Low) — /v1 oversized body → `req.destroy()` (TCP reset, status 0), not a clean 413.** Cap works.
- **L4 (Low) — `pairingOk` uses `=== code` (non-constant-time).** Use `crypto.timingSafeEqual`.
- **L5 (Med) — /v1 enroll credential exposure during the TOFU window (F-04)** — confirm pairing-code
  channel-binding, or document as accepted residual.
- **L6 (Low latent) — two concurrent desktop `allowRefile` confirms both skip the CAS** (safe today because
  only the single desktop renderer sets `allowRefile`).
- **L7 (Low) — filing-failure rollback can hand a racer a spurious "ALREADY_FILED"** for a doc that ends
  back in the queue (safe, self-correcting, but a misleading message).
- **L8 (cosmetic) — `assign_currency` is now dead code** (superseded by `strip_currency`) but still plumbed
  via `--region-currency`. Harmless; remove or repurpose for future display.
- **L9 (Low) — `<select>` is in the preload focus-repair selector** — likely benign (no-op when focused),
  but verify native dropdowns don't flicker (test UI-A4).
- **Session `verify` doesn't re-check is_active/role per request** (by design; revocation is delete-based).
  Safe **only if every** admin user-mutation calls `revokeUser` — the 4 current sites do; add a guard test.

### OWNER / OUT-OF-SCOPE THIS PASS
- **PHP licensing backend** (`licensing-backend/`): F-03 trial-farming / client-asserted fp / no rate-limit,
  F-05 admin lockout/TOTP, L-06 docroot exposing `keys/`, L-05 TOTP replay — needs a PHP-focused pass.
- Renderer XSS surface (129 `innerHTML` sites) — a lint/Trusted-Types sweep (code-quality).
- At-rest encryption of `docusnap.db`/documents/diag logs — data-governance decision.
- Native Tesseract/pdfium hang or segfault on a crafted page — needs a crafted-file fuzz + the watchdog.

---

## THE 4-HOUR TEST PLAN (condensed; full per-scenario detail preserved by domain below)

Run harnesses with `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron <harness>`; Python with
`py -3.12 python_backend/tests/<file>`. [A]=automatable now · [M]=manual/renderer/VM.

### Domain 1 — Document processing & import (~48 min)
- **A. Worker pool** [M]: A1 concurrency=1 byte-identical anchor · A2 concurrency=4 count-match + one aggregate start · A3 clamp above cores (`maxConcurrency`).
- **B. Batched watch (highest-risk, untested)** [M]: B1 watch is BATCHED not per-file (≤N python procs for the whole batch) · B2 watch count == manual for single-doc input · **B3 watch does NOT split multi-doc PDF (BLOCKER-2a)** · B4 file-still-being-written stability (10s) · B5 watch defers to running manual.
- **C. Separation** [M]: C1 manual split happy-path + fail-safe (locked/failed → 1 doc) · C2 separation-off parity.
- **D. Drain** [M]: D1 drain to Processed + no leaked handle · D2 drain to Errors + stuck row · D3 `-N` collision chain.
- **E. Working-copy durability** [A: `test_working_copy_durability.js` + reconcile/ensure suites; M: E1 source-vanishes preview/reprocess].
- **F. Watchdog** [A: `test_file_timeout_watchdog.py`; M: large scan doesn't false-trip].
- **G. Auto-file** [M]: G1 threshold 100 vs 90 gating (flagged never auto-files) · G2 uses rotated working copy.
- **H. Pathological + no-loss** [A: `import_load_harness.js` 168/168; M: Unicode/RTL/emoji + flatten collision].
- **I. Duplicate** [A/M: `-DUPLICATE` chain, no overwrite].

### Domain 2 — Extraction & detection + learning (~48 min)
- **A. Baseline gate** [A]: A1 `accuracy_harness.js` (subtotal/total MUST stay 100%) · A2 backend suite smoke.
- **B. NEW `test_date_order.py`** [A]: mdy `03/04/2026`→4-Mar · day>12 fallback · ymd/ISO · dmy byte-identical · month-name order-invariant.
- **C. NEW `test_number_format.py`** [A]: continental/french(NBSP)/swiss/indian/anglo · currency-strip end-to-end · **C4 whole-number `500` on-blur false-warn (B1c)** · **C5 wrong-format corruption `1,234.56`→`1.23456` (B1a)**.
- **D. NEW totals** [A]: role-alias total/sub_total · LABEL CODE AMOUNT skip · Invoice-Total beats Net-Total · single-column no-regression · [M] real merged-row invoice.
- **E. NEW MAC/IP** [A]: slip-fix `T3`→`73` recover-and-flag · IP trailing-ctrl trim (no "()") · unrecoverable→invalid · valid untouched · charset "()" guard · shape-warn suppression.
- **F. Drift/registration** [A: template_mapper_drift, registration_arbiter, anchor_arbiter_reorder, inline_harvest/column_bleed, ref_digit_guard, multiline].
- **G. Draw-the-anchor** [M]: box "Invoice Total" beside GBP → authoritative anchor, commits on Confirm, cleared on doc-change.
- **H. Wordness** [A: unit suites; inert on the corpus per name-variety memory].
- **I. Learning Repair** [A: `test_repair_suspects.js` + `test_reviewservice_refile.js`; M: strip surfaces injected outlier/off-shape, send-back reversible, refile-in-place no `-DUPLICATE`].
- **J. Reprocess cache** [A: page_ocr_cache/reprocess_manifest; M: taught value applies, edits-guard prompt].
- **K. Confidence/auto-file** [M]. **L. (opt) recurring-entity name-repair scenario** [M].

### Domain 3 — Security (~48 min) — full plan retained in the SECURITY section below
A authN/authZ (add purge admin-vs-edit) · B F-02 path-leak (add `/pages`+`/thumbnail` traversal) · C
session-revocation on role-change/password (NEW) · D ocr-region cap+counter-leak · E SQLi/proto-pollution ·
**F1 reconcile CR-1** + login rate-limit · G TLS pin (VM) · H offline JWS tamper/rollback/binding · I
backup device-import gate · J legal-gate sender-verify · K open-file path policy + dev-inspector.

### Domain 4 — Concurrency & multi-user (~48 min)
- **A. CAS core** [A]: A1 `concurrency_harness.js` (35/35 gate) · **A2 barrier-gated stub to force all contenders into the post-claim/pre-copy await (regression guard).**
- **B. defer/undefer/refile** [A]: B1 defer-vs-defer/undefer-vs-undefer · B2 confirm-vs-defer terminal state · B3 desktop refile vs /v1 confirm (no `-DUPLICATE`).
- **C. Rollback** [A]: C1 both-copies-missing clean revert · **C2 NEW filing-failure racing a valid confirm (not covered today).**
- **D. Collisions** [A]: D2 NEW 6-way identical-name burst → clean `-DUPLICATE` chain + per-doc marker.
- **E. Workflow lock** [A: R13 all-409; assert no await between guard and claim].
- **F. Divergent-value** [A]: **F2 NEW divergent date-FORMAT + currency race → winner normalised once, filename==stored date, numbers-only.**
- **G. Auto-file vs manual** [A]: **G1 NEW 100% auto-file racing a /v1 confirm (separate commit paths, only the CAS makes it safe — untested today)** · G2 auto-file failure rollback.
- **H. Presence** [A: `test_presence.js`; **H2 NEW desktop↔client share `presenceService.shared()` — untested**; H3 >5 clients TTL].
- **I. Sessions** [A: `test_v1_security.js`; **I3 NEW one shared session store across IPC-admin + /v1**; I2 revoke-mid-confirm TOCTOU].
- **J. Watch vs manual** [M]: J1 watch defers to manual (BLOCKER-2d direction note).

### Domain 5 — UI/renderer + client + regional + onboarding (~48 min)
- **A. Keyboard-focus (12m, highest churn)** [M]: A1 after native dialog · A2 after ⊕/Draw-the-anchor · A3 every window · A4 `<select>` + caret/selection non-regression.
- **B. Search** [M/A-partial]: B1 bidirectional comma (`1137`↔`1,137`) · B2 full-text over extractions+corrections · B3 preview Type · B4 Quick-find cold+warm.
- **C. Regional pickers** [M]: C1 date-order drives parse · C2 number-format + currency-strip · C3 persist + help clarity + "applies to new imports" note (B1a/B1d).
- **D. Required-field toggle** [M]: D1 greys Confirm + red label · D2 no-ref dead-end regression.
- **E. Learning Repair** [M]: zoom/pan (wheel + RMB), suspect strip, send-back reversible, thumbnails.
- **F. Themes** [M]: all 11 + seasonal SVG art loads (no CSP `img-src` error), dark `data-mode`, client mirror.
- **G. Onboarding/welcome/practice** [M]: G1 clean-DB first-run + legal gate · **G2 practice touches NO real DB/output** · G3 tour fork.
- **H. Legal gate** [M]: accept/decline, no hide-to-tray dead-end, version-bump re-prompt.
- **I. Detached client** [A: `client/test_apiclient.js`; M: connect/pair/enroll TLS trust, review over /v1 + client keyboard-focus, themes, connection-lost overlay; **L2 client draw-box-empty**].
- **J. Help mode / lifecycle / a11y / empty-states.** **K. Re-run `MANUAL_RENDERER_TESTS.md` #1-#5.**

---

## SECURITY — full plan (retained verbatim from Domain 3)

(see git-tracked detail; probes A1–K2 as above. Verified CLOSED, regression-test only: F-02 server-side
path resolution, F-06 `_isOpenablePath`, session-revocation-on-deactivate, legal-gate sender verification,
enforcement-always-on, offline JWS verifier. New gaps to add: purge admin-vs-edit RBAC, `/pages`+`/thumbnail`
traversal regression, role-change/password revocation, ocr-region counter-leak, backup device-gate,
open-file path policy.)

---

## Suggested pre-release action shortlist (owner call — NO code was changed tonight)
1. **Decide BLOCKER-1 (regional):** add `test_number_format.py` + date-order tests (fast, high value); add
   the `number_format.js` twin (or fix on-blur integer currency + docstring); decide mixed-format policy
   (B1a); add region to onboarding (B1d).
2. **Decide BLOCKER-2 (watch):** add separation + license-check + poll-time overlap to the watch batch, or
   document watch = single-doc + trusted-license path.
3. **Annotate/fix `v1_stress.js`** so the stored "CRITICAL double-file" finding reads correctly (CR-1).
4. Quick wins: 413 vs reset (L3), timing-safe pairing (L4), remove dead `assign_currency` (L8).
5. Run the P0 automatable gates every build: accuracy, concurrency, import-load, `test_v1_security`,
   `client/test_apiclient` — all currently green.
</content>
