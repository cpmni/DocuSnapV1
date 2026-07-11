# Overnight report — 2026-07-06

**Topic:** supplier auto-file "graduation" (safe eventual auto-confirm) + regression testing + a formulated OCR/registration stress-test series.
**Autonomy:** built the agreed slice, stopped code changes at your boundary, re-ran testing, and consulted the team (bob/gary/oscar/reggie) to design the stress tests. No input required from you overnight; open questions are logged in §6.

---

## TL;DR
- **Shipped (code, UNCOMMITTED — for your review):** the auto-file **slider bug fix** (Slice 1) + the **trust safety core** `trust.js` with **30/30 passing unit tests** (Slice 2) + the **× dismiss button** on the "auto-committed" bar. Nothing is committed; nothing is wired into live filing yet.
- **Stopped there**, per "no code changes after this fix." The live auto-file wiring + graduation UX (Slices 3–7) are **not** done — they change real filing behaviour and want your eyes first.
- **Testing:** Slice-2 unit suite **30/30**. Real-doc audit **no regression** — type/supplier/ref/total/subtotal **100%**, date **99.4%** (the 3 misses are the *known* pre-existing silent City Office dates). JS guards **42/43**, Python cluster **16/17** — both lone failures are **pre-existing stale tests**, not tonight's work. Details in §3.
- **Two real findings worth acting on (§5):** (1) the backend and renderer auto-file gates **disagree** in an unsafe direction; (2) a **regex-valid value read off the wrong row keeps full confidence with no flag** — the widest silent-mis-file door, and exactly the class that poisons auto-confirm.
- **Stress-test series formulated (§4):** a ranked plan to *prove* auto-committed data is reliable, built on the existing `stress_test/` harness.

---

## 1. What I changed tonight (code — UNCOMMITTED)

All three are in the working tree, uncommitted. I did **not** commit or push (you didn't ask, and you'll want to review).

| # | Change | Files | Risk |
|---|--------|-------|------|
| Slice 1 | **Auto-file slider now works on import.** `_autoFileDoc` hard-rejected `overall_confidence !== 100`, silently making the sub-100 `auto_file_threshold` slider a **dead letter** on the import/watch path (it only ever worked on the renderer Reprocess-All path). Relaxed to honour the threshold; kept the flagged-field refusal. **Default 100 → zero behaviour change** until deliberately lowered. | `src/modules/processing/handler.js` (~2089) | Low — default unchanged; single caller verified |
| Slice 2 | **The trust safety core (pure logic + tests, UNWIRED).** `scopeTrust()` (a supplier/doctype graduates at 10 clean confirmations, 0 in-window corrections, every required field verifiable) + `docTrustGate()` (per-doc structural safety) + a shape classifier. **Nothing calls it yet**, so it cannot change app behaviour. | `database/modules/trust.js` (new), `database/modules/test_scope_trust.js` (new) | None (unwired) |
| UX | **× dismiss on the "N auto-committed on the last pass" bar.** Clears the rolling `recent_auto_filed` setting so the notice stays gone until a genuinely new auto-file pass. Renderer + CSS only. | `src/windows/review/renderer.js`, `src/windows/review/index.html` | Low (renderer-only) |

**Boundary honoured:** Slices 3–7 (wire the backend gate, wire the renderer gate to one shared predicate, graduation UX, the full stress-test suite, and the optional extension of the structural gate to the existing 100% path) are **designed and tracked but NOT implemented** — they alter live filing and belong in a reviewed session. See §7.

To see the changes live you'll need to restart the app (Slice 1 is main-process) and reopen the Review window (the × is renderer).

---

## 2. The "graduation" design (why + the parameters)

**The problem you hit:** a clean, correct, math-verified supplier (Anconia) reads at **98%** and never auto-files, while other suppliers reach 100% and do — because learned-read confidence is **deliberately capped at 98** (so "learning alone" never crosses the 100 auto-file line) and only a separate document-level agreement bonus reaches 100. To a user that looks arbitrary.

**The fix (bob + gary consensus):** an explicit, visible, reversible **per-supplier trust** that sits *on top of* confidence. Confidence stays the "is this probably right?" signal; graduation becomes the "do I trust this supplier enough to skip Review?" trigger. Parameters (built into `trust.js` as tunable constants — these are the recommended defaults, yours to dial):

| Parameter | Default | Why |
|---|---|---|
| Clean confirmations to graduate (W) | **10** | reuses the project's existing "trust a learned model" bar |
| Corrections allowed in the last-W window | **0** | a correction is the exact miss we must not repeat unattended |
| All *required* fields verifiable | **required** | rests the decision on shape-verified fields |
| Doc matched a template | **required** | layout drift → different template → not trusted |
| Trusted auto-file floor | **98** | the honest learned-read ceiling; no score inflation |
| Untrusted scopes | **100** (unchanged) | today's behaviour preserved |
| Reversibility | **1 correction suspends trust** | first human catch turns it off automatically, live-computed (never stored) |

**The crux — the structural safety gate** (`docTrustGate`): a trusted doc may auto-file only if **every valued field is strict-typed-and-unflagged, OR matches a non-freetext learned shape (constant/digits/date/currency/code), OR empty.** This is what structurally blocks the `item="Information"` class — an untyped, valued field whose learned shape is *free-text* can never be verified, so the doc routes to Review **regardless of confidence, flags, or a poisoned history**. Proven by the Slice-2 tests (§3).

---

## 3. Test results

### Slice-2 safety-core unit tests — ✅ 30/30 PASS
`database/modules/test_scope_trust.js` (Electron-as-Node). Covers the shape classifier, `scopeTrust` (volume, cleanliness, reversibility, required-field verifiability, guards) and `docTrustGate`. **Load-bearing case proven:** a doc with `item="Information"` (untyped, free-text learned shape) is **blocked** (`unverifiable-value:item`), while a genuinely clean doc passes. A correction inside the window revokes trust; one outside it does not (recovery).

> Note: gary's consult reported this test file as "missing" — a **timing artifact**. It was briefed before I wrote the file; the file exists and passes 30/30.

### Real-doc accuracy audit (reprocess confirmed docs vs ground truth)
`stress_test/realdoc_regression.js` — read-only reprocess of your confirmed corpus.

<!--AUDIT_RESULTS-->
**468 confirmed docs reprocessed — no regression from tonight's work** (baseline holds):

| Field | accuracy |
|---|---|
| type / supplier / ref | **100.0%** (468/468) |
| total / subtotal | **100.0%** (395/395) |
| date | **99.4%** (465/468) |

All 3 misses are on **date** and all **SILENT** (wrong + no review flag) — the same pre-existing **City Office** month-misreads from before tonight (#11/#12 `29-08`→`29-05`, #26 `02-08`→`02-06`), *not* new. **This is the auto-confirm poison class, live in your real corpus:** a wrong month keeps a valid date *shape*, so it passes validation unflagged and would auto-file. It's exactly what reggie's **T1 date hardening** (calendar bounds + a parse round-trip) and oscar's "**structured reads bypass the confidence cap**" finding target — and what the stress-test series is built to gate. Everything else reproduces its confirmed value at 100%.

### JS DB-module guard sweep
All `database/modules/test_*.js` via Electron-as-Node.

<!--JS_RESULTS-->
**42 / 43 pass** (the new `test_scope_trust.js` is among the 42). The one failure is **pre-existing (not from tonight's work):**
- `test_supplier_identity_persistence.js` — `SqliteError: no such table: extractions` at `learning.js:152 saveCorrections`. The test's in-memory schema predates `saveCorrections` reading the `extractions` table; its `makeDb` never creates it. A **stale test fixture**, not a product bug. One-line fix (add the table to the test schema) — deferred per the boundary.

### Python extraction cluster (recently-touched + accuracy-critical)
Reconciliation, wordness, totals, anchor-crop, OCR-engine, shape/format, precedence.

<!--PY_RESULTS-->
**16 / 17 pass.** The one failure is **pre-existing (not from tonight's work):**
- `test_name_wordness_engine` — `TypeError: … unexpected keyword argument 'trace'` at `engine.py:1613 → validator.validate_and_adjust(…, trace=…)`. The test's *mock* of `validate_and_adjust` wasn't updated when the reconcile-**trace** parameter was added earlier today (commit b2d7452). A **stale test mock**, not a product bug. One-line fix (accept `trace`/`**kwargs` in the mock) — deferred per the no-code-changes boundary.

> **Scope note (logged decision):** tonight's code changes are **JS-only and low-blast-radius** (auto-file gate, an unwired new module, a renderer button) — none touch the Python extraction layer — so the extraction accuracy baseline **cannot** have moved from my work. I re-ran the accuracy audit + a targeted cluster to confirm the baseline holds, rather than exhaustively re-running all ~95 Python + ~90 JS tests individually (the Python suite mixes pytest-style and script-style files and has a known monkeypatch-isolation gotcha, so a blind full-dir run is unreliable). The known pre-existing failure `test_template_mapper_failsafe` ("Booking" case) is unrelated.

---

## 4. Formulated OCR / registration / auto-confirm stress-test series

Design-only (no code tonight), built to **reuse the existing `stress_test/` harness**. The unifying definition, agreed across the team:

> **A "silent miss" = a field where read ≠ truth AND the doc would still auto-file** (high confidence, no `validation_note`, `needs_review` stays false). That is the auto-confirm poison. Everything below is scored against the *real* auto-file decision.

### 4.0 — Fix the measurement first (Spec 0 / gary T1)
The harness's two "flagged" definitions **disagree** (`analyze.js` = note-only; `realdoc_regression.js` = note OR conf<70) and **neither computes the real auto-file decision** the app uses. First step: one **auto-file soundness** metric — `silentAutoFile = wrong ∧ wouldAutoFile`, computed from the real gate — plus a **reliability curve** (precision per confidence bucket; the knee where precision drops below 100% *is* the highest safe threshold). Pair every gate assertion with a **liveness floor** (`autoFiled ≥ N`) so a test can't pass *vacuously* because nothing auto-filed.

### The series (ranked by silent-miss yield × directness to auto-confirm)

| # | Test | Targets | Hard gate |
|---|------|---------|-----------|
| **T1/Spec0** | Auto-file soundness + reliability curve | the master invariant `silentAutoFile==0` at threshold | ✅ + liveness |
| **T2** | **Two-site consistency (differential oracle)** | backend vs renderer gate must agree; hard-gate the unsafe asymmetry | ✅ (fails today — see §5) |
| **T3** | `docTrustGate` blocks the untyped-wrong class | the `item="Information"` incident, as a unit regression | ✅ |
| **T4** | Reversibility — a correction revokes trust | `scopeTrust` is live/self-revoking | ✅ |
| **Spec 1** | **Inline-harvest wrong-token trap** | a taught anchor grabbing a heading word off the value's row (the confirmed production miss) | ✅ (zero silent inline mis-grabs) |
| **Spec 2** | **Look-alike decoy amplifier** | a placement slip landing on a same-shape neighbour → *regex-valid wrong* value (defeats all validation) | ✅ |
| **Spec 3** | Registration row-off in dense label blocks | fit residual > local row pitch → reads one row off at up to 93% conf | ✅ |
| **T5** | Poisoned-corpus resistance | a minority of bad confirms can't graduate a scope or flip a shape | ✅ + reported ratio |
| **Spec 4** | Merged-row / detached-column grouping | `reconstruct_page_text` mis-grouping (empty=safe, mis-pair=silent) | ✅ (mis-pair only) |
| **Spec 5** | Born-digital vs scanned **twins** | the render-DPI / line-grouping divergence you traced on the "Information" files | ✅ |
| **T6** | Rubber-stamped wrong value, end-to-end | on `corpus_hard`, a mis-read never auto-files | ✅ |
| **Spec 6** | Scan-degradation grid (DPI×noise×JPEG×blur×rotation) | the band where confidence stays high but glyphs flip | ✅ up to a floor, then review-forced |
| **Spec 7** | Geometry: 90/180/270 flips, skew, perspective | **OSD auto-rotate is currently untested**; skew feeds registration | partly (OSD), then review-forced |
| **T7** | Graduation lifecycle, end-to-end | a scope that should graduate does, and its auto-filed docs read == truth | ✅ correctness (curve = metric) |
| **Spec 8** | Handwriting-over-print | boundary/calibration — must **flag**, never confidently read | ✅ (flag rate) — review-forced |
| **T8** | Auto-file **rate** | coverage/UX only | **non-gating by design** (gating it creates unsafe pressure) |
| **T9/Spec-cal** | Confidence≠correctness calibration | quantifies *why* structure (not the threshold) is the real safety | diagnostic |

**Fixtures to build (design-only tonight):**
- **F1 (high):** add an **untyped free-text field** ("item"/"description") + a "reads a plausible wrong word" variant to the synthetic corpus + `ground_truth.json`. *Today the corpus is all typed fields, so the actual `item="Information"` incident is invisible to the harness.*
- **F2 (med):** a template store for the synthetic corpus (so `docTrustGate`'s template requirement runs end-to-end), or a `requireTemplate:false` harness mode.
- **F3 (high):** the unit seeder — **which is `test_scope_trust.js`, now written** (backbone of T3/T4/T5; extend for poison sweeps).
- New generators (proposed, not built): `gen_twins.py`, `gen_dense_block.py`, `gen_geometry.py`, `gen_handwriting.py`, `gen_degrade_grid.py`, plus a `decoys=True` mode + a free-text field in `gen_teach_anchors.py`.

**Validation-pattern angle (reggie):**
reggie designed 8 validation/shape silent-pass specs — a "silent pass" = a **wrong value that matches the field's pattern (or evades the shape gate) and so auto-commits unflagged.** The headline ones:
- **T1 `date` (highest impact × frequency):** the pattern has **no calendar bounds** and is unanchored, so `45/67/8901`, `13/13/2026`, `31/02/2026` all pass — and a wrong date mis-files (it drives the filename + Year/Month folder). Fix: calendar-bound the numeric branch **and** gate auto-file dates on a **canonical parse round-trip** (reuse `filing.normaliseDate`); flag if it won't parse or reformats differently.
- **T2/T3 `iban` + `vat_gb`:** in `STRICT_TYPES` but validated on *shape alone with no checksum* — a transposed-digit IBAN or a bare 9-digit number (VAT's `GB` is optional) auto-files as valid. Fix: add the mod-97 / HMRC checksum (a small shared fn) **or demote them** out of `STRICT_TYPES` until checksum-validated. Financial blast radius.
- **T4 `currency`:** a dropped decimal (`£1,234.56` → `£123456`, a 100× error) still matches. Don't tighten the regex (whole-pound/¥ are legitimately 0-dp) — add a **learned decimal-place-count consistency flag**.
- **T5 dead/latent `STRICT_TYPES` members:** `integer`/`decimal` are in the set but are **not selectable types and have no backing pattern** — a field of that type created off-UI (via `/v1` add-field or a backup import) would be **trusted on nothing**. Fix: remove them, and add defence-in-depth — for a STRICT type, re-validate the value against its pattern instead of trusting only the absence of a note.
- **T6/T8 bespoke helpers drift:** `trust.js`'s `_dateish/_currencyish/_codeish` are a **fourth ruleset** that can diverge from the shared `validation_patterns` + backend `shape_signature` (`_currencyish` omits `¥`; `_codeish` is length-blind, so it'd pass `INV-01` vs learned `INV-001` that the backend rejects). Fix: point the gate at the shared patterns + backend shape model, not hand-rolled regex.
- **Residual, must be documented (uncatchable by regex):** transposed-but-valid dates, transposed/digit-doubled refs that keep a valid shape, and wrong-but-valid *entity* fields (email/name). Reliability there rests on **cross-field maths, checksums, and learned exact-length** — never the pattern alone.

reggie's `STRICT_TYPES` verdict: **harden** `date`; **keep + add a learned-consistency flag** for `currency`/`number`; **remove** `integer`/`decimal`; **add checksum or demote** `iban`/`vat_gb`; **keep** `reference_code` (the good one — anchored, digit-required); `email`/`percentage`/`postcode_uk` fine. Worth **adding**: `currency_code` (anchored closed enum — trust-safe). This directly improves the Slice-2 safety core **before** it's wired (see §5.5).

All tools named are OSS free-for-commercial (Pillow, NumPy, scikit-image BSD-3, ReportLab base BSD-3, OFL-1.1 fonts, Tesseract/pytesseract Apache-2.0, pypdfium2 BSD/Apache). No cloud OCR (breaks the offline model); any future handwriting model's *weights* are licensed separately from its code and must be cleared.

---

## 5. Findings to act on (independent of the graduation feature)

1. **The two auto-file gates disagree — unsafe direction (gary T2, verified in code).** Backend `_autoFileDoc` blocks only on `validation_note` count (ignores `corrected_to`, and at exactly 100 doesn't check `needs_review`/required completeness). Renderer `autoCommitFullConfidence` blocks on `review_flag_count` (note **OR** `corrected_to`) *then* the full confirm gate. **Net: a doc with a `corrected_to` candidate but no note → backend AUTO-FILES, renderer HOLDS.** The durable cure is **one shared `isAutoFileEligible()` predicate both sites call** — which is exactly Slice 4. Until then, the two paths can file different things.
2. **Structured reads bypass the OCR-quality confidence cap (oscar, `anchor.py` ~774).** The cap `conf = min(conf, ocr_conf+5)` applies **only** to free-text. A **regex-valid** ref/date read off the *wrong row* keeps full confidence and no flag — the value is well-formed, just from the wrong place, so validation can't see it. This is the widest-open silent-mis-file door and what Specs 2/3 target. Worth a design conversation about a **placement-confidence** signal independent of the regex.
3. **OSD auto-rotate is untested by the harness (oscar).** A 90/180/270 scan could mis-file and no current test would catch it. Spec 7 closes it.
4. **The synthetic corpus has no untyped free-text field**, so the `item="Information"` incident can't be reproduced end-to-end today (fixture F1).
5. **Harden `trust.js` `STRICT_TYPES` before wiring it live (reggie, §4).** The overnight consult found real gaps in the Slice-2 safety core: `integer`/`decimal` are dead members (no backing pattern → "trust on nothing" if a field of that type is created off-UI); `iban`/`vat_gb` are trusted on shape with **no checksum**; `date` has no calendar bounds + isn't parse-round-tripped; a STRICT field gets **no value re-check** at the gate (it trusts only the absence of a note); and the bespoke `_dateish/_currencyish/_codeish` helpers are a fourth ruleset that can drift from the shared patterns. **None of this is live** (the gate is unwired), so it's a pre-Slice-3 hardening pass, not a bug in production — but it should land *before* the gate is wired. Good news: `test_scope_trust.js` already exists to guard the hardening as it's applied.

---

## 6. Logged decisions / open questions for you

- **Q1 — Graduation parameters.** I built W=10 / 0-corrections / floor-98 as tunable constants (the team's recommended defaults). Confirm or dial (a conservative install might want W=20).
- **Q2 — Extend the structural gate to the existing 100% path? (Slice 7, optional.)** The untyped-wrong hole exists at 100 *today*, not just on the new 98 path. Closing it changes existing behaviour (a currently-auto-filing 100% doc with an unverifiable free-text field would start routing to Review). Recommend yes, but it's a behaviour change — your call.
- **Q3 — Fix the two-site divergence (finding #1) now or as part of Slice 4?** I'd fold it into Slice 4 (the one-predicate refactor fixes it by construction).
- **Decision I made without you (logged):** did **not** exhaustively re-run all ~185 test files — ran the accuracy audit + targeted clusters instead, because tonight's changes don't touch the extraction layer (rationale in §3). If you'd rather I run the full suite, say so.

---

## 7. Next steps (tracked slices)

1. ✅ Slice 1 — auto-file slider fix (done, uncommitted)
2. ✅ Slice 2 — trust safety core + tests (done, 30/30, uncommitted, unwired)
3. ⏭ Slice 3 — wire the **backend** auto-file to `scopeTrust` floor + `docTrustGate`
4. ⏭ Slice 4 — wire the **renderer** to the **same shared predicate** (fixes finding #1 by construction)
5. ⏭ Slice 5 — graduation UX (announce · roster · "3 more clean docs…" countdown · toggles)
6. ⏭ Slice 6 — the stress-test suite from §4 (Spec 0 + F1/F3 first — fastest path to reproducing the auto-confirm poison)
7. ⏭ Slice 7 (optional) — extend the structural gate to the existing 100% path (Q2)

**Pre-Slice-3 (do first):** harden `trust.js` `STRICT_TYPES` per finding §5.5 / reggie (remove `integer`/`decimal`; add checksums or demote `iban`/`vat_gb`; calendar-bound + parse-round-trip `date`; add a STRICT-type value re-check; point the shape helpers at the shared `validation_patterns` + backend `shape_signature`). `test_scope_trust.js` guards it.

Recommended morning order: confirm Q1–Q3 → **harden trust.js (above)** → Slice 3 → Slice 4 (with the shared-predicate refactor) → Slice 6 Spec 0/T2/T3 (cheap, deterministic, and T2 will surface finding #1 as a red test) → then UX.

_Good morning. Everything above is uncommitted and reversible; nothing touches live filing yet._
