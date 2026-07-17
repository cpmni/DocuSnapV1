# Template convergence — fix for template fragmentation (M#19) + confirmed-count display (N#20)

**Date:** 2026-07-17 · **Branch:** `feat/reprocess-throughput-autostraighten`
**Status:** vetted by the specialist panel (gary/Phillip/reggie/eric) and Oracle (**SIGN OFF WITH
CONDITIONS**). **Build progress:** M2 BUILT + verified (kill switch `TEMPLATE_REUSE_BY_BRANDING`, default
OFF; corpus byte-identical OFF; 7-section battery green ON) — COMMITTED `7d051f3`. N BUILT + verified
(display-only; `getAll` untouched) — COMMITTED `7d051f3`. **M1 DEFERRED into M3's backfill** (owner
decision). **M3 BUILT** (read-only `findMergeCandidates` + structure gate + `planBackfill`/`applyBackfill`
in `templateMerge.js`; IPCs `get-merge-candidates`/`plan-template-backfill`/`apply-template-backfill`/
`merge-template-cluster` [backup-first]; Template-Manager "Suggested cleanups" UI). Engine 24-check battery
green; `db.backup()` smoke-tested. UNCOMMITTED — pending owner review + a live-app pass.
**Owner steers:** cleanup = admin-reviewed merge; rollout = every slice kill-switched, **default OFF**,
byte-identical OFF, prove on a corpus A/B + the Demo Docs corpus before flipping on.

---

## 1. Problem (owner-diagnosed, MEASURED read-only on the dev DB)

One `(supplier, doc-type)` accumulates several near-duplicate learned templates, or confirmed docs link
to none. Copperfield: **3 invoice + 4 purchase_order** templates; **5 sales orders confirmed
template-less**. Measured proof the LOGO is the wrong signal: template-less `sales_order_05` has
keyword-branding overlap **1.00** with template 9 but logo Hamming distance **22**; a sales order that DID
match has the same 1.00 branding, logo distance **6**. On these scans the coarse 64-bit logo phash drifts
up to 36 for the SAME supplier while DIFFERENT suppliers sit at 2–8 (ranges fully overlap). The keyword
branding fingerprint separates cleanly (measured **0% cross-supplier false-match at 0.80 overlap**,
fingerprint-vs-OCR mode).

---

## 2. Corrected diagnosis (FACT-checked in code — supersedes the handover/memory)

- **`_upsertTemplate` lives in `src/modules/review/handler.js:787`** (not `learning.js`).
- **Three template create/link paths, none converge an ordinary confirm by branding:**
  1. Stage-0 `template_matcher.identify_template` (py:134) sets `documents.template_id` at processing.
  2. `_upsertTemplate` (handler.js:787) — fires ONLY on **taught** confirms (`reviewService.js:215`,
     gated on `taught_fields.length`). Reuse gate is **logo-only** (handler.js:861-875); a dist-22 render
     falls through to the CREATE else-branch (handler.js:907) → **duplicate born**. This is the
     fragmentation BIRTH path.
  3. `_maybeGraduationTemplate` → `graduationTemplate.decide/apply` (handler.js:1017,
     `database/modules/graduationTemplate.js`) — fires every non-bulk confirm but only ACTS at/after scope
     **graduation** (W=10 clean confirms). Already Oracle-vetted (C1 link-not-fold, C2 ≥3 distinctive
     tokens to create, C3 logo-collision pre-check, C4 null-slug skip, C6 variable-only fields).
- **N is DISPLAY-ONLY.** `templates.update()` DOES `confirmed_count + 1` (templates.js:610) but only runs
  on the reuse branch; `create()` leaves it 0; graduation LINK never bumps it. **Graduation does NOT read
  it** — `trust.scopeTrust` (trust.js:284-290) counts confirmed *documents* live. So N cannot affect
  auto-file/graduation; it only skews Template-Manager display + `ORDER BY confirmed_count DESC`
  (templates.js:14). The handover's "might block graduation" worry is **refuted**.
- **`documents.template_id` blast radius is low** (grepped): filing reads it **nowhere**; learning reads
  it only in Learning-Recovery RESET; `reviewService` reads it only at `captureSample` (line 212-213).
  Live consumers = the sub-100 auto-file gate `docTrustGate` (`trust.js:334`, needs a template),
  `captureSample` (landmark word-corpus), and Template-Manager display. **A mis-link is low blast radius.**

---

## 3. The comparator KEY (shared by M1 + M2 + M3 — ONE helper)

The naive `templates.keywordOverlap@0.60` (handler.js:872) is unsafe: directional AND it counts generic
doc-type words (`extract_keyword_fingerprint` strips stop/calendar/digit words but NOT 18 of the 20
`BRANDING_STOPWORDS`). Replace with **distinctive-token matching**:

- **Distinctive tokens** = reuse `graduationTemplate.distinctiveTokens()` (strips `BRANDING_STOPWORDS`,
  len≥3, lowercased, deduped). **Move `BRANDING_STOPWORDS` + `distinctiveTokens` into ONE shared module**
  both `templates.js` and `graduationTemplate.js` import (no third copy).
- **Absolute floor:** require **≥3 SHARED distinctive tokens** + **same `document_type_slug`**.
- **Ratio = SYMMETRIC** (Oracle SEAM-2, decisive): `|dist(A) ∩ dist(B)| / max(|dist(A)|, |dist(B)|)`
  (min-of-both-directions). Directional (denominator = template) has a concrete wrong-link path: a bloated
  different-supplier doc (~8 distinctive tokens) containing all 3 tokens of a minimal single-confirm
  template scores 3/3 = 1.0 directional (WRONG link) vs 3/8 = 0.375 symmetric (correctly rejected).
  reggie's "template fp is stabilised to its core" premise is FALSE for the exact single-confirm templates
  M1 targets (`stabiliseFingerprint` returns the first sample as-is, templates.js:591).
- **Threshold split by MUTATION POWER (Oracle):**
  - **LINK (M1, reversible, no fold):** symmetric ratio **≥ 0.60**, per-token **fuzzy** allowed
    (exact len<6, `difflib` SM≥0.85 len≥6 — reuse `_keyword_hit_ratio_fuzzy` params).
  - **REUSE (M2, mutates the target via `update()`):** symmetric ratio **≥ 0.80** (the measured-safe 0%
    cross-supplier point), **exact** tokens. A wrong reuse could freeze a foreign supplier's constant via
    `_buildTemplateFields`; 0.80 + the existing name-freeze guard (handler.js:999) keep it safe.
  - **MERGE (M3, destructive):** exact symmetric **Jaccard** `|∩|/|∪|` ≥ **0.75 auto-suggest** /
    ≥ **0.60 surface**, both ≥3 tokens, same slug, PLUS a landmark-constellation structure gate (§4, M3).
- **Keep JS and Python in sync:** `BRANDING_STOPWORDS`, the distinctive rule, and fuzzy params must match
  across `templates.js`/`graduationTemplate.js` (JS) and `template_matcher.py` (Python cold-id twin,
  unchanged by this work).
- **Control-test gate:** re-measure same-vs-different-supplier separation on **distinctive** fingerprints
  (not raw) on the live DB and confirm the 0.60/0.80/0.75 gates keep the separation BEFORE locking numbers.

---

## 4. The four slices (ship order M2 → N → M1 → M3)

### M2 — branding-fingerprint reuse in `_upsertTemplate` (PRIMARY — stops duplicate births)
- In `_upsertTemplate`, after the logo reuse arms fail, add a branding branch **under `if (!templateId)`**
  (NOT nested in the `logo_phash` guard at handler.js:861 — else it misses logo-less suppliers). For
  same-slug templates, if symmetric distinctive overlap ≥ **0.80** and ≥3 shared tokens, **reuse** it →
  falls into the existing `update()`/relink branch (folds fingerprint, bumps confirmed_count).
- **DO NOTHING on the logo append band.** The reuse fires *because* the logo drifted past 13, so
  `update()`'s `addLogoHash` (templates.js:640, fires only minD 2–13) will NOT append the far logo, and
  `chooseLogoPhash` keeps the established primary. Widening the band would fold foreign logos (measured
  2–8) — forbidden. (Verified: this is load-bearing and correct.)
- Also changes reuse behaviour of `promote-to-template` / `link-document-to-template` (both call
  `_upsertTemplate`, handler.js:702/752) — not a new class, cover in the test.
- Kill switch (e.g. `TEMPLATE_REUSE_BY_BRANDING`), default OFF ⇒ byte-identical.

### N — live confirmed-count in Template Manager (display only)
- In the Template-Manager list path, show a LIVE count via **one grouped query** (eric — there is NO index
  on `documents.template_id`, so a correlated subquery full-scans):
  `SELECT template_id, COUNT(*) c FROM documents WHERE status='confirmed' AND template_id IS NOT NULL GROUP BY template_id`,
  map-joined; **sort by the same live count** (else roster order and shown count disagree — Oracle
  cosmetic caveat). Leave the stored column (mergeInto sums it). No migration, no pipeline impact.

### M1 — forward LINK-only convergence (lowest reward; deferrable)
- **Placement (Oracle SEAM-1 = gary):** FOLD into `graduationTemplate.decide()` — move the branding
  link-existence check + link **ABOVE** the `scopeTrust` gate (graduationTemplate.js:134) so LINK fires
  **pre-graduation**; keep CREATE graduation-gated. It runs LAST (after `captureSample`, which no-ops for a
  template-less doc), so a mis-link contributes ZERO to any landmark corpus — fail-safe, one code path.
  Reject eric's sync-before-`captureSample` placement: the payoff is near-zero (landmarks need ≥3 recurrent
  samples; the back-linked doc is the least-trustworthy) and it is the only landmark-risk vector.
- LINK-only (never creates, never folds). Symmetric distinctive overlap ≥ 0.60 (fuzzy). Guarded write
  `UPDATE ... WHERE template_id IS NULL`. Own kill switch, default OFF ⇒ byte-identical.
- **Honest scope (Oracle Correction B):** M1 is go-forward-only (won't retro-link the 5 existing
  template-less SOs — that's M3's backfill) and existing template-less docs already largely self-heal via
  Stage-0 reprocess re-link. M1's marginal value = confirm-time convergence without a reprocess. **It is
  NOT purely cosmetic on GRADUATED scopes:** a link clears `docTrustGate`'s `no-template` hold, so a
  shape-valid-but-wrong value ≥ the floor can then auto-file. Same class graduation already intends, but M1
  WIDENS it → **must be measured** (see §5). If SEAM-1 un-gating is awkward, **M1 is the deferrable slice**
  — fold it into M3's backfill.

### M3 — cleanup (destructive, admin-only, LAST)
- **Dry-run `findMergeCandidates`** (new): group same-supplier same-type templates by exact symmetric
  Jaccard ≥0.75 (auto-suggest) / ≥0.60 (surface). Canonical = **max live confirmed-count → has landmarks →
  has sample → has mappings → lowest id**.
- **Structure gate (mandatory, Phillip):** before suggesting a merge, compare the two templates' landmark
  constellations (existing `template_landmarks` + `registration.py` RANSAC). Diverging constellations = two
  legitimately distinct layouts → **REFUSE merge, offer `template_group` instead** (organisational only).
  This is the one genuine silent-wrong-merge vector (`mergeInto` DELETEs the source, templates.js:344, and
  moves its doc-links to a target whose mappings don't fit).
- **Backfill re-link** of template-less confirmed docs (LINK-only, mirrors M1).
- Admin-triggered, **backup immediately before any `mergeInto`**, never automatic. `templates.mergeInto`
  itself is untouched (already `test_template_merge.js`-guarded); only the selector + structure gate + UI
  are new.

---

## 5. Verification (control-test-first; corpus M=0 alone is INSUFFICIENT)

Per slice, on a copy of the live/Demo-Docs DB, kill switch OFF must be **byte-identical** to baseline; ON
must show only the intended change. Because the harness snaps the READ, not the confirm-time LINK, use a
**two-phase gate** (gary/Oracle):

1. **Phase 1 (link diff):** replay the same confirm stream ON vs OFF; diff `documents.template_id` links,
   template row COUNT (duplicate births), and any `template_fields.fixed_value` gained from a
   foreign-supplier doc. Assert: fewer duplicate births ON (M2), no cross-supplier fixed_value freeze, no
   double-link.
2. **Phase 2 (read gate):** run `stress_test/realdoc_regression.js` on BOTH resulting DBs — require
   **M=0 AND M_type=0 AND zero per-field accuracy drop**.
3. **M1-specific gate:** on the M1-ON DB, for every sub-100 doc that GAINED a link on a graduated scope,
   assert none becomes auto-file-eligible with a value disagreeing with GT (M1 must not turn a
   `no-template` hold into a silent wrong auto-file).
4. **Pinned trade-off tests** (so a future dev can't silently restore the bug):
   - SEAM-2: a bloated different-supplier doc containing all 3 distinctive tokens of a minimal template →
     symmetric REJECTS (directional would ACCEPT). Locks symmetric + the thresholds.
   - M2: different-supplier same-type at <0.80 overlap → NEW template (isolation preserved); assert the
     far-drifted logo is NOT appended.
   - M1↔M2 agreement: one shared `distinctiveTokens` helper — pin that M1 and M2 never disagree about
     "same template" (else M1 links, a later taught confirm's M2 doesn't recognise it → recreates a
     duplicate → reopens fragmentation).

---

## 6. Files touched

- `database/modules/templates.js` — new distinctive comparators, N grouped-count query, `findMergeCandidates`.
- `database/modules/graduationTemplate.js` — pre-graduation LINK arm (M1); shared distinctive helper.
- `src/modules/review/handler.js` — M2 branding-reuse branch in `_upsertTemplate`.
- `src/modules/templates/handler.js` + Template-Manager renderer — N display, M3 admin merge-suggestions UI.
- Tests: extend `test_graduation_template.js`, new `test_template_reuse.js`, N test, the pinned trade-offs;
  `test_template_merge.js` for the M3 selector/structure-gate.
- (Optional) `database/index.js` — `idx_documents_template_id` only if N uses a correlated subquery.

---

## 7. Oracle conditions (attach to the build)

1. SEAM-1 = gary's placement (fold into graduation LINK arm, run last, un-gate LINK from `scopeTrust`,
   own kill switch, `WHERE template_id IS NULL`).
2. SEAM-2 = symmetric ratio; same slug + ≥3 shared distinctive tokens; **M1 @0.60, M2 @0.80**; ONE shared
   `distinctiveTokens` helper (pinned test).
3. M2 branch under `if (!templateId)`; verify no far-drifted logo appended + primary phash unchanged.
4. Two-phase verification gate + the M1-specific auto-file gate (§5).
5. M3 human-only, dry-run, backup-before-merge, landmark-constellation structure gate, refuse+group on
   divergence.
6. N: display the grouped live count and sort by it.
7. Re-measure distinctive-fingerprint separation on the live DB before locking 0.60/0.80/0.75.
