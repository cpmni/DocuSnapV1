# Logo-arm trusted-title refuse must not short-circuit the same-type keyword rescue

Date: 2026-07-25 · Branch: feat/reprocess-throughput-autostraighten · Author: Claude (Opus 4.8)

## Symptom (owner, reproducible)
A Saltmarsh service_worksheet doc **matches template id23 when clicked** (review recheck), but on
**Reprocess** flips to **"No template match"** + the note *"the heading names a document type that
doesn't match this supplier's saved layout."* The field values are correct (WS-26836 etc.).

## Root cause (PROVEN by measurement on the live DB, doc 555)
The 64-bit logo phash cannot tell a supplier's own layouts apart. Doc 555's logo `bc3cc3c3…`:

| template | type | logo min-dist | conf (100−6·d) |
|---|---|---|---|
| **id21** | Saltmarsh **sales_order** | **4** | **76** ← nearest of ALL templates |
| id22 | Saltmarsh invoice | 24 | 0 |
| **id23** | Saltmarsh **service_worksheet** (right one) | **18** | 0 |

In `template_matcher.identify_template` (python_backend/extraction/template_matcher.py):
1. `_logo_candidates` is **NOT slug-scoped** — it ranks across ALL templates → nearest = id21 (sales_order), dist 4, conf 76 ≥ 60 → the logo arm engages.
2. Cluster = closest + `_LOGO_AMBIG_MARGIN`; id23 (dist 18) is far outside → cluster = {id21}. `matching` (slug==detected_slug=service_worksheet) = **[]**. So `best_t` stays id21 (sales_order).
3. Line **271**: `title_trusted and detected_slug and best_t.slug != detected_slug` → `service_worksheet` ≠ `sales_order` → **`return _type_refuse(...)`** → None + `_type_refused` → the note.
4. This **short-circuits** the same-type rescue (:355) and keyword arm (:378), both of which resolve **id23 at 100%** (branding overlap 1.0, keyword score 1.0) — VERIFIED: a logoless `identify_template(detected_slug='service_worksheet', title_trusted=True)` returns id23 (`keywords+slug_rescue`).

**Why click works but reprocess doesn't:** the JS review recheck (`templates.identifyByFingerprint`) logo arm is **slug-scoped** (`findByLogoHash(…, 'service_worksheet')`) → only id23 is a candidate (dist 18, conf 0 <60) → no logo match → keyword arm → id23. Python's reprocess logo arm is type-blind, so it hits the wrong-type sibling and refuses.

## Proposed fix (Option A — fall-through; kill switch `LOGO_REFUSE_FALLTHROUGH`, default ON)
The trusted-title refuse at :271 should **not give up before the same-type rescue/keyword arm have tried**.
The logo can't identify a type; a right-type template may match by keyword even when the logo locked a
wrong-type sibling.

- At :271, instead of `return _type_refuse(...)`, **capture** it (`_logo_refused = (detected_slug, best_t_slug)`) and **fall through** past the logo block (do not `return result` either).
- The existing same-type rescue (:355, same-type + ≥0.80 branding) and keyword arm (:378, slug-preferring, with its OWN trusted-title refuse at :381) then run normally → resolve id23.
- If NOTHING matches (the case the refuse was actually built for — a title naming a type NO sibling carries), re-emit the refuse at the end (before the final `return None`) so the hold + note still fire.
- OFF (`=0`) restores the immediate `return _type_refuse` → byte-identical.

**Why it's safe (fail-toward-review preserved):** fall-through can only reach (a) the same-type rescue — same-type + strong branding, so it returns the RIGHT type or nothing; (b) the keyword arm — which re-applies the same trusted-title refuse (:381) for a wrong-type best match. So a genuinely-absent right type still ends in a refuse; it can never newly stamp a WRONG-type template (the keyword arm guards that). No value is ever changed (identify_template only selects a template).

Alternative considered — **Option B: slug-scope `_logo_candidates` when `detected_slug and title_trusted`** (mirror the JS recheck). Cleaner conceptually but broader blast (changes the candidate set for every logo match, incl. supplier-identity confidence); deferred unless the advisors prefer it.

## Blast radius / gate
- Stage-0 template matching — the corpus harness (`realdoc_regression.js`) DOES exercise this. **Gate = M=0 + zero accuracy drop** + OFF byte-identical.
- New targeted test: a fixture where the doc's logo is nearest a wrong-type same-supplier sibling but a right-type template matches by keyword → asserts the right-type match (not a refuse); plus a fixture where NO right-type template exists → still refuses (pin the preserved fail-safe); plus OFF byte-identical.

## Questions for the gate
- gary: is the fall-through the smallest correct fix, and is the re-emit-refuse-at-end shape right? Test strategy + the pin that stops a future dev restoring the short-circuit.
- Phillip: given the phash's zero type-separating power, is Option A (fall-through) or B (slug-scope the logo candidates) the sounder layer? Any case where fall-through lets a wrong SUPPLIER through (vs the current supplier-identity confidence semantics)?
- Oracle: the seam between the logo-arm refuse and the keyword-arm refuse (:381) — does re-emitting only when both miss preserve the exact fail-toward-review contract? Blast radius vs Option B.

---

## GATE OUTCOME + BUILD (2026-07-25)

**gary** (Python): confirmed root cause + Option A (smallest correct; B changes 5 consumers + disables the ambiguity hold); gave the exact code shape; flagged the wrong-SUPPLIER residual. **Phillip** (fingerprinting): Option A decisively — B is the wrong layer AND inert on doc 555 (id23 dist 18 > LOGO_THRESHOLD 13); no wrong-supplier regression on the refuse path; recommended a corroboration gate. **Oracle: SIGN OFF WITH CONDITIONS** — the fall-through preserves the *type* contract exactly but opens a *supplier*-axis hole (the keyword arm, conf up to 100, no supplier check, could silently auto-file to a wrong company on a graduated supplier). **C1 (blocking): supplier-scoping guard.** C2: keep the detail-veto (:277) + text-gate (:321) as `return None`.

**Built** (`python_backend/extraction/template_matcher.py`, kill switch `LOGO_REFUSE_FALLTHROUGH` default ON):
- `_logo_refused`/`_refused_supplier` captured at the :271 refuse; accept path (veto/gate/return) guarded on `_logo_refused is None` so it's skipped on fall-through (no 70-line re-indent).
- Same-type rescue (:355) + keyword arm (:378) run; re-emit the refuse before the final `return None` iff nothing resolved.
- **C1 guard** `_fallthrough_supplier_ok`: reject a rescue/keyword match whose `dominant_supplier` is non-null AND ≠ the logo-locked supplier → re-emit refuse. Allow when equal, when the candidate supplier is null (fresh sibling), OR when the refused supplier is unknown (symmetric null-skip — avoids a false hold).
- OFF (`=0`) returns at :271 → byte-identical.

**Verification (all met):**
- Unit `tests/test_template_matcher.py`: 4 new pins (the fix → RIGHT id23; C1 → different-supplier match re-emits refuse not the wrong company; pure re-emit; OFF byte-identical) + every pre-existing pin green.
- Live doc-555 replay: `title_trusted=True` → id23 (`keywords+slug_rescue`); OFF → refuse (byte-identical). (`title_trusted=False` → id21, pre-existing, untouched.)
- **Corpus `realdoc_regression.js` ON vs OFF: accuracy IDENTICAL (type/supplier 100%, ref 98.5%, date 98.9%), the 14 regressions IDENTICAL, M IDENTICAL (2 — #183/#583, both pre-existing/in OFF), M_type 0. Only delta: +5 docs auto-file CORRECTLY (345→350)** — the wrongly-refused docs now match their template. OFF byte-identical by construction.

Committed on the feature branch, NOT pushed. Owner live gate: reprocess doc 555 → id23/service_worksheet (no "No template match"); reprocess a Saltmarsh sales_order + invoice → still match their own templates.
