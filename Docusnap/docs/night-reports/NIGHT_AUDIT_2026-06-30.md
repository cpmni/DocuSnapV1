# Overnight Audit — 2026-06-30 (for morning review)

**Mode:** autonomous, **log-only** — no extraction/learning code touched, no fixes applied.
Everything below is a **finding to review**, not a change. The one feature *built* tonight
(client targeting) was the explicitly-requested deliverable and is committed separately.

---

## TL;DR — severity-ranked findings

| # | Sev | Area | Finding | New? | Fix applied? |
|---|-----|------|---------|------|--------------|
| 1 | **MED-HIGH** | Concurrency | A confirm arriving **after** a doc is already filed takes the *re-file* path and **silently overwrites** the first reviewer (last-writer-wins) instead of the documented "already filed by X" rejection. | New | **No (log only)** |
| 2 | LOW | API limits | An oversized request body (>1 MB) **drops the TCP connection** (client sees status 0) instead of a clean `400/413`. | New | No (log only) |
| 3 | LOW | Test hygiene | `test_license_phase3.js` + `test_workflow_ipc.js` fail **because of the intentional workflow-hide flag** (`WORKFLOW_FEATURE_ENABLED=false`), not a product bug. Suite no longer fully green → could mask a future real regression. | New (this session) | No (log only) |
| — | ✅ | Targeting endpoint | New `POST /v1/documents/{id}/ocr-region` passed **every** security probe (auth, role, validation, no path-leak, concurrency cap, no prototype pollution). | — | — |
| — | ✅ | Extraction system | **Python suite 100% green** (74 files: extraction single+multiline, regex/validation, field-correction, anchors, templates, dates, names, OCR). No new regressions. | — | — |

**Headline:** the system is in good health for release. One genuine concurrency gap (#1)
deserves a decision before multi-user review is leaned on heavily. Nothing else is blocking.

---

## PART A — Client ↔ Core connection stress test

Reusable probes are in `night_audit/` (each is a standalone Electron-as-Node script that
spins an in-memory `/v1` server with a `:memory:` DB and a stubbed OCR/filing layer — no
real backend, no disk writes). Re-run any with:
`ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron night_audit/<file>.js`

### A1 — Finding #1 (MED-HIGH): re-file path = silent cross-user overwrite

**What the automated sweep first reported** (`night_audit/v1_stress_findings.json`):
> `CRITICAL — parallel confirm: 6 WINS (expected 1) — possible double-file race!`

**That CRITICAL label is over-stated — I re-characterized it with three focused probes:**

1. **`cas_probe.js`** — fire 6 `reviewService.confirm` **truly simultaneously** (one event-loop
   tick, before any completes): **1 win, 5 `ALREADY_FILED`.** → The atomic CAS
   (`documents.confirmIfReviewable`) is **sound**. The documented "first wins, second rejected"
   design **holds for genuinely-simultaneous confirms.**

2. **`http_race_probe.js`** — 6 confirms over **real HTTP**: **6 wins (all 200 OK).** The HTTP
   path (each request `await`s `readJsonBody` before reaching the CAS) lets the first confirm
   **fully complete** — setting `status='confirmed'` + `stored_path` — before the others reach
   the claim. The later ones then see an already-confirmed doc.

3. **`refile_probe.js`** — the clean real-world case: editor confirms (`200 ok`), **then** admin
   confirms the **same** doc a moment later (`200 ok`). Result: `commitDocument` called **2×**,
   final `confirmed_by=admin`, `supplier_name=Admin-Co`. **The admin silently overwrote the
   editor — no "already filed by editor" rejection.**

**Root cause** (`src/services/reviewService.js:59-68`, **read-only — not changed**):
```js
const oldStoredPath = (docRow && docRow.status === 'confirmed' && docRow.stored_path) ? docRow.stored_path : null;
const isRefile = !!oldStoredPath;
...
if (!isRefile) { const claim = documents.confirmIfReviewable(...); /* CAS */ }
```
The `isRefile` branch is designed for the legitimate case "**the same** reviewer re-files **their
own** correction to an already-confirmed doc" — so it **skips the CAS claim**. But it keys only on
the doc's state (`status==='confirmed' && stored_path`), **not on actor identity**. So a **different**
user's fresh confirm on an already-filed doc is indistinguishable from a self re-file → it re-files
and last-writer-wins.

**Reachability (real, not theoretical):** two people work the same Review queue. A loads the queue,
B loads the queue. A confirms doc 5 → it files and leaves A's queue. B's queue is **stale** (still
lists doc 5 as needs-review). B opens doc 5, edits, Confirms → the core sees doc 5 already
`confirmed` → re-file path → **B's values overwrite A's filed document, B becomes `confirmed_by`,
the file is re-written** (and if B's field values change the filename, a second physical file can
result). B gets a success — **no signal they just clobbered A's work.**

**Impact:** not corruption (writes stay atomic) but a **data-integrity / accountability** gap that
**contradicts the core multi-user guarantee** the owner explicitly designed for ("second reviewer
gets *already filed by X*"). Most likely exactly when two reviewers share a queue — i.e. the
scenario the client feature exists for.

**Direction for a fix (NOT implemented — for the morning's decision):** gate the `isRefile` branch
on **actor identity** (only the original `confirmed_by` may take the silent re-file path) or require
an explicit `intent:'refile'` flag from the UI; any *other* actor confirming an already-confirmed
doc should run the CAS path and get the clean `409 ALREADY_FILED` naming the winner — the same
guard the simultaneous path already gives. Small, surgical, and it closes the only real gap found.

### A2 — Finding #2 (LOW): oversized body drops the connection

`v1_stress.js` sent a >1 MB JSON body to a `/v1` endpoint. The server **correctly rejects it**
(the body cap works — no memory blow-up, no processing) but does so by **closing the socket**
(client observes `status 0` / connection reset) rather than returning a clean `400 Bad Request`
or `413 Payload Too Large`. Functionally safe; only a politeness/diagnosability nit (a client
can't tell "too big" from "network died"). Worth a clean status if touched, not urgent.

### A3 — What PASSED (client↔core)

All green, no action:
- **New `POST /v1/documents/{id}/ocr-region` targeting endpoint** — full probe matrix:
  - Missing/!bad token → **401**; read-only seat → **403** (writer-gated, mirrors `/pages`).
  - Missing/invalid `imageBase64` → **400** (input validation).
  - Concurrency cap honoured → **429** past `OCR_MAX_INFLIGHT=3` (no Python-proc storm under load).
  - **No path leak (F-02):** response is `{text}` only — never `stored_path`/`folder_path`/`working_path`.
  - **No prototype pollution** from a crafted `__proto__` body.
  - Temp PNG unlinked + in-flight counter decremented on every exit path (`done` guard).
  - **OCR worker robust to malicious payloads** (probed `region.py` directly, since the `/v1`
    harness stubs the spawn): valid-base64-of-garbage, an empty file, and a missing file all
    return **empty text + exit 0** — no hang, no crash, no stack-trace leak (`region.py:30-34`
    swallows a bad `Image.open` → prints `''`). So a crafted payload just yields an empty field
    fill; it can't crash the spawn (no DoS) or wedge the in-flight counter.
- **Atomic CAS** is sound for simultaneous confirms (A1, `cas_probe.js`).
- Auth edge cases (malformed bearer, expired/forged token), DTO projection, and routing all behaved.

---

## PART B — Whole-system test overview

Goal (owner's words): *"test extraction, single and multiline, the regex system and field
correction… an overview of the function of the entire system."* Approach: run the full automated
suite (it already encodes these as executable contracts), separate **new** failures from **known**
ones. **No code changed.**

### B1 — Python extraction suite: **100% GREEN (74 files)**

Every file exits 0. Coverage maps directly onto the requested areas:

| Requested area | Green tests (representative) |
|---|---|
| **Extraction — single-line** | `test_precedence`, `test_anchor_qualify`, `test_anchor_registration`, `test_stage2_winner_consistency`, `test_template_matcher`, `test_template_mapper`, `test_relocate_keyvalue`, `test_inline_harvest` |
| **Extraction — multiline** | `test_multiline_continue` (ALL PASS), `test_inline_column_bleed`, `test_segmentation`, `test_region_light_first` (multi-line crop) |
| **Regex / validation** | `test_pattern_coverage`, `test_field_data_types` (6 passed, pytest-style), `test_keyword_label_guard`, `test_field_charsets`, `test_validator_label_guard`, `test_validator_ocr_sanitisation`, `test_job_no_pattern`, `test_date_*` (formats/hard-gate/salvage/future-only) |
| **Field correction** | `test_field_rules`, `test_name_match`, `test_slipfix_to_shape`, `test_namefix_pollution_xfield`, `test_candidate_resolver`, `test_value_quality`, `test_ref_digit_guard`, `test_ref_role_gate` |
| **Confidence / anomaly** | `test_format_anomaly_checker`, `test_format_shape_consistency`, `test_shape_match_score`, `test_confidence_empty_fields`, `test_document_confidence_weighting`, `test_stage45_text_preserve` |
| **OCR / geometry** | `test_ocr_engine`, `test_orientation`, `test_registration[_arbiter]`, `test_landmarks`, `test_page_ocr_cache`, `test_thumbnail`, `test_pdf_splitter` |

**Notable:** `test_template_mapper_failsafe` (the "Booking" case the memory flagged as a *known
pre-existing failure*) is now **GREEN** — it was repaired this session (commit `5994715`,
"update stale failsafe test to the manual-anchor-precedence contract"). So the one known Python
red is cleared; **no new Python failures exist.**

> Test-runner note for future runs: the suite mixes **script-style** files (a `__main__` that
> prints + `sys.exit`) and **pytest-style** files (`assert` in `test_*` functions, no main).
> `pytest` over the whole dir **breaks on collection** (script-style `sys.exit` →
> `INTERNALERROR`). Correct approach (used tonight): run each file **directly**
> (`py -3.12 test_x.py`) for the script-style ones; the single pytest-style file
> (`test_field_data_types.py`) was run with `py -3.12 -m pytest test_field_data_types.py`.

### B2 — JS suite: green except **2 tests, both from the intentional workflow-hide**

Of ~70 JS test files (DB modules, services, `/v1` API, auth, filing, licensing, telemetry,
targeting), **two fail — both a direct consequence of `WORKFLOW_FEATURE_ENABLED=false`** (the
master flag that hides the mailbox/approval feature pre-release, set deliberately this session):

1. **`database/modules/test_license_phase3.js`** — asserts the entitlement reflects the **signed**
   token counts `search 2 / workflow 1` (anti-tampering check). The master flag **forces
   `workflow` disabled regardless of seats**, so the signed `workflow 1` no longer surfaces →
   the assertion fails. *Not a product bug* — the signing/anti-tamper logic is fine; the test
   pre-dates the feature-hide.

2. **`src/modules/workflow/test_workflow_ipc.js`** — fails with *"The workflow add-on is not
   licensed for this install."* It injects entitlement but **doesn't stub the master flag**, so
   the forced-off workflow rejects the IPC. Its sibling **`test_v1_workflow.js` passes** because
   it *does* account for the gate — the model to copy.

**Why it matters (LOW, but worth doing):** these two reds mean `npm`-style "all green" no longer
holds, which can **mask a future real regression**. Recommended (morning): update both to stub /
expect the `WORKFLOW_FEATURE_ENABLED` state (mirror `test_v1_workflow`), so the suite is green
again while workflow stays hidden. All workflow *code* remains intact behind the one flag — this
is test maintenance only.

**Everything else green**, including the things most relevant to this release:
- **Targeting:** `test_v1_review` (ALL PASS).
- **Licensing/security:** `test_v1_auth`, `test_v1_ca`, `test_v1_enroll`, `test_v1_entitlement`,
  `test_v1_handshake`, `test_v1_pages_pathsec`, `test_v1_seats`, `test_cert_wizard` (26/26),
  `test_certservice` (20/20), `test_path_hardening`, `test_license_phase{1,2,4,5}`.
- **Confirm/concurrency:** `test_reviewservice` (ALL PASS), `test_documents_cas` path, `test_presence`.
- **Diagnostics:** `test_telemetry` (22/22).
- DB/filing: structural fields, templates/merge/logo-hashes, recycle bin, drain, working-copy,
  backup service, filename pattern, search contract — all pass.

---

## PART C — What was *built* tonight (the requested deliverable)

**Client correction-only "targeting"** — the reviewer draws a box over a value on the document
image and the field auto-fills from OCR. Per the agreed plan (`mighty-imagining-quail.md`):
**no anchoring, no area-reads, no spatial learning — a convenience correction tool only. Core
extraction/learning untouched.**

- **Core:** `POST /v1/documents/{id}/ocr-region` (`src/modules/api/handler.js`) — writer-gated,
  entitlement-gated, F-02 (file resolved server-side), `OCR_MAX_INFLIGHT=3` cap, temp-PNG cleanup,
  **returns `{text}` only.** Additive endpoint → no contract bump. Reuses `python_backend/ocr/
  region.py` unchanged (light-first ladder, ~108 DPI preview scale + glyph headroom — the
  desktop ⊕ recipe).
- **Client:** `apiClient.js` / `main.js` / `preload.js` / `renderer/renderer.js` + `index.html` —
  per-field crosshair button → drag a box on the page image → crop **against natural pixel dims**
  (+headroom) → base64 → `ocr-region` → drop text into the still-editable field → reviewer verifies
  → Confirms via the unchanged CAS path. No learning write-back.
- **Verification:** `node --check` clean on all touched files; `test_v1_review` still passes; the
  new endpoint passed the full security probe matrix (Part A3). Committed at `b442be9`.

---

## Reproduce / re-run

```bash
# Client↔core probes (Electron-as-Node):
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron night_audit/cas_probe.js        # CAS sound (1 win)
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron night_audit/http_race_probe.js  # HTTP path: 6 wins
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron night_audit/refile_probe.js     # the finding, pinned
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron night_audit/v1_stress.js        # full sweep → v1_stress_findings.json

# Python suite (each file directly; do NOT pytest the whole dir):
for f in python_backend/tests/test_*.py; do py -3.12 "$f"; done
py -3.12 -m pytest python_backend/tests/test_field_data_types.py   # the one pytest-style file
```

## Decisions waiting for you (nothing auto-changed)

1. **Finding #1 (re-file overwrite)** — accept the small actor-identity gate on `isRefile`, or
   defer? This is the only finding I'd act on before leaning on multi-user review.
2. **Finding #3 (2 red tests)** — green them by stubbing the workflow-hide flag (test-only), so
   the suite reads clean again.
3. **Finding #2 (oversized-body status)** — low priority; clean `413` if/when that path is touched.
