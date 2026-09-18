# Ref-badge verify state (`ref_badge_verify_state`) — 2026-09-18

**Status:** BUILT, DARK (seeded OFF, mig 185, in `TEST_SWITCH_KEYS`). Presentation-only, byte-identical OFF.
**Origin:** Chris The Customer 2026-09-18 vet, Finding #1 (his highest-harm card).
**Advisors:** gary (root-cause + fix design) → **Oracle SIGN-OFF-W/COND C1-C6**. Verdicts in `docs/oracle_log.md`.

## The defect
A Northgate PO in Review: the page prints `Order No. PO-69837`; the app read the reference as `PO-69637`
(a single-glyph **8→6** OCR error) and showed a green **"High · 93%"** badge. The *correct* Document Issuer
was the one flagged (`Check · 69% … confirm it's the sender`). So the WRONG field looked trustworthy and the
RIGHT field looked doubtful — and the filename is built from that reference.

## Root cause (verified at source)
1. The Review badge is a pure function of the numeric READ confidence with **zero verification input**
   (`renderer.js` `appendFieldRow`: `conf>=70 → green "High"`; the tooltip even says "sure of this *reading*").
   A non-technical user reads the green word as "the value is right."
2. **No ref guard can fire on this class.** `ref_confusable_flag` (mig 173, ON) excludes digit↔digit by
   construction (`format_anomaly_checker._is_letter_digit_confusable`); `trust_ref_role_shape` (mig 154, DARK)
   is a shape gate that admits both `PO-69837` and `PO-69637`; D1 `_flag_digit_disagreement` needs a
   *distinct-stage witness that read a different value* — a self-consistent common-mode misread produces none.
   A confident, valid-shape, first-seen, self-consistent reference defeats every existing guard.
3. **Asymmetry:** the IDENTITY role has an unconditional verification floor (letterhead detected but issuer
   not positively confirmed → conf 69 + "confirm it's the sender" + forced review). The REFERENCE role has no
   analog — so the wrong field looks safe and the right field looks doubtful.

Do **not** try to "correct" the glyph: with no witness and no history, any 8↔6 correction is a guess that can
corrupt a *correct* ref (strictly worse; violates fail-toward-review). The honest fix is to stop *claiming*
verification, not to fabricate one.

## The fix (Slice 1 — presentation only)
When ON, the REFERENCE role's badge shows a calm neutral **"Read · N%"** (never green "High", never the amber
"Check") whenever the value read confidently (`conf≥70`) but was **not verified**. Verified iff ANY of:
- **(a) corroborated** — `trust._corrobLicensed` (≥2 independent page families agree). The SAME predicate as
  the corroborated-auto-file licence — sharing is intentional and pinned (C6).
- **(b) authoritative literal** — `method ∈ {manual, template_fixed, template_fixed_locked, keyword_override}`
  (verified by authority, never by value shape — C3).
- **(c) matured scope** — this **supplier+type+field** has well-supported confirmed history (`confirmed_count ≥ 3`).
  A SCOPE property (C2), never the value's shape (C3); supplier-scoped only (the doc-type-wide `''` bucket must
  not green a first-seen supplier off other suppliers' history).

The `verified` boolean is computed in **MAIN** (`trust.refBadgeVerified`, ONE predicate — C1) and attached as
`ext.verified` in `get-document-with-extractions` **only on the ref role, only when the switch is on**. The
renderer renders a tri-state from that handed boolean and does **no** shape logic. No value / note / gate /
auto-file change — the doc is still held on exactly the fields it is today.

## How the 6 conditions are met
- **C1** — the predicate lives once in `trust.js`; main computes `ext.verified`, the renderer never forks it.
- **C2** — history = supplier-scope `confirmed_count ≥ 3` (a scope property), supplier-scoped only.
- **C3** — `verified` never inspects the value's shape; a shape-valid value alone never greens (pinned).
- **C4** — **DATE is the known untested sibling**, deferred to its own census; ref-only is a first step, not
  the class fix. (A wrong date at green "High" builds a wrong filename too, but widening maximises the
  cold-install "Read" volume and dates are a documented false-fire hazard — so ref-first.)
- **C5** — **honest boundary:** on a matured scope a self-consistent misread still shows green. Slice 1 stops
  the badge OVER-claiming on *unearned* reads; it does NOT reduce misreads. That residual belongs to the
  engine's D2 second-render witness layer.
- **C6** — the badge split rides `_corrobLicensed` (also the corroborated-auto-file licence); the coupling is
  pinned so a future licence tightening is understood to move the badge too.

## Flip gate (Oracle) — NOT yet run; flip is the owner's call
`M=0` is trivial (presentation-only, no engine value moves). The REAL gate is a **badge census** over the 605
corpus + Demo Docs, ALL required:
1. PIN: the exhibit (first-seen keyword ref @93) renders **"Read", not green** — *pinned* (`test_ref_badge_verify.js`).
2. INVERSE PIN: a corroborated ref stays **green** — *pinned*.
3. SCOPE PIN: a non-ref field @93 unverified STILL "High" — guaranteed structurally (main only attaches
   `verified` to the ref role) + the predicate pin covers "no ref key ⇒ false".
4. **The alarm-fatigue metric:** ZERO green→"Read" flips on any history-supported/graduated scope across the
   corpus (incl. label-above / structural-absence layouts). A single such flip = SEND BACK. *(census owed)*
5. Every cold-slice green→"Read" flip is genuinely single-witness / no-history. *(census owed)*
6. PARITY: `verified` uses the ONE `trust.js` predicate. *(pinned)*

## Files
- `database/dark_switches.js` (+ the key), `database/index.js` (mig 185 seed OFF).
- `database/modules/trust.js` (`refBadgeVerifyEnabled`, `refBadgeVerified` + exports).
- `src/modules/review/handler.js` (`get-document-with-extractions` attaches `ext.verified`).
- `src/windows/review/renderer.js` (tri-state badge in `appendFieldRow`), `src/windows/review/index.html`
  (`.conf-badge.read` neutral/info style).
- Pin: `database/modules/test_ref_badge_verify.js`. Count pins bumped 47→48
  (`test_migration137_test_switch_reset.js`, `test_migration163_deskew_false_absent_reflag.js`).

## Deferred (NOT built)
- **Slice 2** (an engine *hold* — cap≤69+note — on an uncorroborated no-history ref): rejected as first move —
  on a cold install every ref is single-witness → flags every ref → alarm fatigue = worse. Escalate only if a
  census shows the calm "Read" state is being ignored.
- The **date** role (C4).
- Search-client Review parity: `appendFieldRow` is core-review-local; the client pop-out won't inherit this
  until synced (`scripts/sync-client-search.js`) — until then "High" means two different things across surfaces.
