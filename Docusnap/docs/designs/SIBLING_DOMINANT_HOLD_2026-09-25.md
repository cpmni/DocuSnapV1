# Sibling-dominant issuer hold — Chris 2026-09-24 card 5 "one sender split three ways" (BUILT DARK 2026-09-25, mig 218)

**Status:** gary design → Oracle **SIGN OFF WITH CONDITIONS C1-C8** (2026-09-25; `docs/oracle_log.md`) → owner "go" →
**BUILT DARK the same day** (C1-C4, C6-C8 applied; C5 census MET — `TESTING/_measure/sibling_dominant_census_20260925/
RESULT.md`; owed before a flip: one live client confirm of the exhibit doc + a Chris round with the switch armed). DARK switch `issuer_sibling_dominant_hold` (mig 217 seeds `'false'`; env `ISSUER_SIBLING_DOMINANT_HOLD` `'0'` kill /
`'1'` force — explicit strings, never the `!= '0'` EMPTY-as-ON idiom); listed in `TEST_SWITCH_KEYS`.

## The exhibit (verified in Chris's 09-24 sandbox DB copy)
20 Meadowvale credit notes from one sender. `documents.supplier_name`: 18 × "Meadowvale Dairy Wholesale", doc 69
"Meadowyale Dairy Wholesale" (letterhead OCR v→y), doc 62 "Dairy Wholesale" (truncated head). All three read by
`letterhead_prefill` @69 (a CUSTOMER default since mig 77); none confirmed; no learned identity rows; no template. Every
one of the 20 carries a `keyword_fingerprint` + `logo_phash`; both odd docs CONVERGE with all 18 siblings by the shipped
comparator `branding_fingerprint.convergesByBranding(a, b, 0.80)` and 17/18 by logo phash ≤ 13 (direct computation).

## The gap (FACT)
The last gate `reviewService.confirm` (~279-305, `issuer_near_match_confirm_guard` ON) asks `learning.findNearMatchIdentity`
whose population is **confirmed history (Tier A, ≥ 3 HUMAN confirms; File-All bulk confirms count) + frozen template
identities (Tier B)** — the batch's own 18 converging pages are invisible. With 0 confirms, confirming doc 69 or 62 mints a
second / third sender (a folder + a poisoned learning scope). The Review list shows three headers because
`review_group_by_letterhead` keys on `suggested_supplier`, which `letterhead_prefill` deliberately never sets. Natural flow
usually closes the gap (the 18-pile sorts first → one confirm → `issuer_sibling_fill` clears 17 → File All → Tier A = 18 →
the odd docs are held when opened), so the REAL reward is: the operator who opens the odd header FIRST (what Chris did),
batches too small for 3 confirms, and the TEACH road — where a garble gets FROZEN as a template identity, not merely filed.
`name_dominant_snap` (DARK) is the WRONG arm: needs 5 confirms, ADOPTS silently, suffix-only by Oracle condition.

## The design — Tier C "converging siblings", JS-only, DARK, ask-only
**Slice 1 — `learning.findDominantSiblingIdentity(db, docId, candidate, opts)`** (beside `findNearMatchIdentity`, never inside
it — the teach write guard `teach_identity_near_match_keep` stays byte-identical):
1. **Fold-first (Oracle C3):** one aggregate query over `status IN ('needs_review','deferred')` rows (id ≠ docId, non-empty
   name, not `intake='direct'`, not deleted) **plus HUMAN-confirmed rows** (Oracle C2: `MACHINE_VIAS_SQL` excluded,
   `learningExcludedSql` applied) grouped by `LOWER(TRIM(supplier_name))` → `foldIdentity` in JS → near-test the candidate
   against the DISTINCT folds only (`nearMatchIdentity` then `tokenSubrunIdentity`, `name_proximity.js`). No near fold →
   `{near:false}` with ZERO convergence work (the common case).
2. For rows in the near fold(s) + the candidate's own fold, fetch fingerprints and keep only rows that CONVERGE with the doc:
   `convergesByBranding(srcKw, sibKw, 0.80)` OR phash ≤ 13 (constants exported from `issuerSiblingFillService`). Hard budget
   (e.g. 5,000 pair tests) → `{near:false, reason:'budget'}` (fail open). No fingerprint/phash on the doc → `no-siblings`.
3. `own = 1 + count(fold(candidate))`; a fold S is DOMINANT iff `count(S) ≥ 2 AND count(S) > own` (a DIRECTION tie-break; the
   safety is two independent families — LAYOUT convergence AND TEXT proximity — never adopted, always asked). Rank edit >
   subrun > higher count. Returns `{near, existing: most frequent raw spelling of S, distance, kind, source:'siblings',
   siblings: count(S), confirmedSiblings, confirms:null}`.
4. **Gate:** in `reviewService.confirm` after the Tier A/B check (A/B outrank) and before the letterhead hold, PRE-CLAIM: when
   armed and `!nm.near` → call it; a hit → audit `confirm_held_sibling_dominant` (metadata `{typed, existing, siblings,
   confirmedSiblings, kind, pairTests}` — Oracle C8) + the SAME `fail('ISSUER_NEAR_MATCH', …, { nearMatch })` (same ack
   `acknowledgeIssuerNearMatch` / bulk-held semantics; `isRefile` exempt). Writes nothing.
5. **Teach ask (Oracle C1, BLOCKING, same slice):** `check-identity-near-match` accepts `{value, templateId, docId}` and, when
   armed, runs Tier C after an A/B miss; `teach.js` (~2147, ~1522) passes `docId: state.doc.id`; `/v1/teach/commit`'s pre-tx
   check (`review/handler.js` ~2333) does the same with `body.document_id`. WITHOUT this the wizard promotes the garble to a
   FROZEN template identity and then loops on the confirm's hold with no Use/Keep (the B8ramblewood class).
6. **Renderer:** a `source === 'siblings'` lead in `showIssuerNearMatchHold`: *"Meadowyale Dairy Wholesale" is one character
   off "Meadowvale Dairy Wholesale", which 18 other documents in this pile read — same sender? Filing as "Meadowyale…"
   would start a second folder.* A QUESTION naming both spellings and the count; never "you already use"; never asserts the
   dominant is right (majority-garble case). Buttons unchanged (Use → correction + re-confirm; Keep → ack).
7. **`/v1` (Oracle C4):** the review-confirm 400 body carries `nearMatch` (additive; contract note in `docs/detached-client.md`)
   and the siblings error text is self-sufficient ("correct the issuer here, or keep it from the main Scan Finder app");
   `pendingfeatures.md` card: a client Use/Keep affordance (today ANY near-match is a client dead-end — pre-existing).

**Slice 2 — display, same switch:** `getReviewQueue` computes `issuer_sibling_dominant` ONCE per queue read over fold
groups (same function, same budget; letterhead-family rows only); `reviewGroupKey` prefers it; chip "18 others read
'Meadowvale…' — check sender"; one-click = the hold's Use button. ONE predicate → the screen and the DB decision cannot
disagree. OFF: rows + DOM byte-identical (Oracle C7 pin).

## Seam
- Relies on: `keyword_fingerprint`/`logo_phash` written for every processed doc incl. cold (engine.py ~9643 →
  process_docs ~1693/1822 → handler.js ~7172); the ≥ 3-distinctive floor + symmetric 0.80 of `convergesByBranding`
  (0/1,250,932 cross-supplier convergences, 08-26 census); `nearMatchIdentity`'s fold/edit budget (legal suffix "Ltd" vs
  "Limited" = `different-company`, NOT a false-hold class; the subrun arm is directional — a LONGER candidate never holds).
- Disables nothing. Verified no ripple: after a Use-confirm on 69, `issuer_sibling_fill` C1 (norm(display) == norm(C)) does
  not fill the 18 from the corrected value — they are filled when one of THEM is confirmed as-is. Correct.
- Docs 69/62 carry the prefill note → `isFlagged` → File All SKIPS them → reachable by single confirm only; Tier C's bulk
  exposure = fill-cleared siblings (own-fold dominant → never a hold).
- Two near-named REAL companies on one converging layout ("Acme Leeds"/"Acme Leads"): a 1-click Keep per doc until Tier A
  has 3 confirms of each — then the SHIPPED gate nags them anyway; Tier C is strictly narrower (layout-scoped population).
- Drift/majority-garble: with C2 the Meadowvale tally is 18 at every stage; 10/10 stays 10/10 (no ask); 3+1 asks after two
  confirms; 18 garble + 2 right → the ask offers the garble, the human Keeps — same outcome as today, neither helps nor harms.
- PERF hazard as first designed (≤ 2,000 JSON parses + convergence per confirm; O(N²) per queue read) → fold-first + budget
  (C3): common case = one cheap aggregate, zero pair tests. Perf pin: 2,000-row / 100-sender queue → one confirm ≤ +25 ms,
  one `getReviewQueue` ≤ +100 ms.

## Verification gate (must FAIL on the bug)
1. `database/modules/test_near_match_siblings.js` (Electron-as-Node, `:memory:` migrated DB, 20 docs sharing a
   ≥ 3-distinctive-token fingerprint): 69 → near/edit/d=1/existing "Meadowvale…"/siblings 18 · 62 → near/subrun · each of
   the 18 → not near · NEGATIVE CONTROL same names, disjoint fingerprints, no phash → `no-siblings` · "ABC Ltd"×18 vs
   "ABD Ltd" → too short · "Brambleworth" vs 18 × "Bramblewood" converging → `different-company` · **PIN OF THE TRADE-OFF**:
   a 1-vs-1 cluster → abstain · majority garble → the ask fires AND the row is byte-unchanged · C2: 3+1 with two
   confirmed → ask (must be RED against a queued-only design), 10/10 with one confirmed either way → no ask · OFF → never
   called.
2. `src/services/test_reviewservice.js`: held (`ISSUER_NEAR_MATCH`, `source:'siblings'`, audit row, status unchanged) · ack →
   files · value == dominant → files · `isRefile` exempt · `bulk:true` held-not-filed · Tier A hit outranks (`source:
   'confirms'`) · OFF files the garble (documents the gap) · the teach ask (desktop IPC + `/v1/teach/commit`) returns `near`
   on doc 69 BEFORE promote, and passes with the ack.
3. Perf pin (C3); renderer source pins (C6: no "already use", both spellings + count, Use/Keep same class; C7 OFF DOM
   byte-identical); mig-217 pin mirroring 216's (stamped / 'false' / listed / count 15 / no force-ON / manual ON survives).
4. **Census (Oracle C5)** — `TESTING/_measure/sibling_dominant_census_20260925/`: Chris's copy (positive control: EXACTLY 69 +
   62 held, 0 of the 18), the owner's 727 copy, the 605-corpus DB; a REPLAY arm treats each CONFIRMED doc as queued beside its
   converging confirmed siblings; every hold HAND-ADJUDICATED: FALSE = the offer is a different real company or the confirmed
   value was right; CATCH reported separately. Gate: FALSE = 0 on all three. Log P size, distinct folds, pair tests, ms.
   `realdoc_regression.js` is VACUOUS (no Python) — run once to document, never as evidence.
5. Client toast check (C4): one client confirm of doc 69 → the 400 toast is actionable. Then a Chris round on a fresh sandbox
   (confirm 69 FIRST → held with the 18-others sentence → Use → one folder; File All → 18; 62 → subrun hold → Use).

## Fail direction of every arm
No fingerprint/phash → `no-siblings` (= today) · budget → fail open · error → the existing outer try (open) · hit → the same
inline Use/Keep the operator already knows · nothing written, adopted or auto-filed; confidence untouched; the claim never
taken on a hold. Teaching one document cannot harm others except via the teach-ask seam — hence C1 is blocking.
