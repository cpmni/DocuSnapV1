# Template de-fragmentation — merge-tool fix (Slice 1) + reuse-by-branding default (Slice 2)

Date: 2026-07-25 · Branch: feat/reprocess-throughput-autostraighten · Author: Claude (Opus 4.8)

## Problem
The live DB has duplicate templates — same supplier + same doc-type minted 2-4× on different days:

| group | fragments | linked confirmed docs | verified |
|---|---|---|---|
| Copperfield · delivery_note | id5, id17 | 52 + 8 | all Copperfield / delivery_note |
| Thornbury · delivery_note | id12,13,15,16 | 65+32+25+37 | all Thornbury / delivery_note |
| Marlowe · service_worksheet | id8, id14 | 16 + 1 | all Marlowe / service_worksheet |
| Larkspur · purchase_order | id9, id11 | 16 + 2 | all Larkspur / purchase_order |

**All 254 linked docs verified correct** — every one single-supplier, single-type, matching its template
(read-only `documents.template_id` audit). Pure fragmentation, no misfiles. Merging pools no bad data.

## Root cause (proven)
`_upsertTemplate` (review/handler.js:1082) reuses a template only via `findByLogoHash(…,13,slug)`.
The 64-bit logo phash drifts PAST hamming-13 across scan sessions (Copperfield id5 `b894c3e3…` vs id17
`bfd6c161…`), so a re-teach can't find its own template → the CREATE branch mints a duplicate. The reliable
signal (`keyword_fingerprint` branding) IS stored but its reuse path (`TEMPLATE_REUSE_BY_BRANDING`) is
DEFAULT OFF. So dupes are born and keep being born.

## Existing machinery
- `templates.mergeInto` (IRREVERSIBLE): pools doc links, field_mappings (add-missing), fields (add-missing),
  **logo-hash set UNION** (deduped+capped), **confirmed_count SUMMED**, landmarks adopt-if-target-empty,
  source deleted. Already the right pooling merge.
- `merge-template-cluster` IPC: backup-first, admin-confirmed, then mergeInto per member.
- `templateMerge.findMergeCandidates`: read-only detector clustering same-(branding,slug) templates.
- Settings → Templates → "Suggested cleanups" UI (`renderMergeCandidates`) shows clusters + merge button.

## The gap (measured against the live DB)
`findMergeCandidates` DETECTS all 4 groups (branding jaccard 0.89–1.0) but marks EVERY one
`group_or_review` with `structure = insufficient`, and the UI shows *"different layouts… field positions
differ… could break extraction"* — which is FALSE here.

`structureVerdict` needs ≥3 SHARED landmark labels agreeing within 5% position to say `compatible`.
Copperfield id5 & id17 BOTH have 5 landmarks yet score `insufficient` → they share <3 landmark *labels*:
the two teach sessions picked different anchor words. Independent re-teaches rarely agree on 3+ labels, so
this gate refuses nearly every genuine re-teach dupe. Correct fail-safe for irreversible merges, but it
(a) lumps `insufficient` (can't judge) with `divergent` (judged different) and (b) mislabels the reason.

## Slice 1 — merge-tool fix (kill switch `TEMPLATE_MERGE_REVIEW`, default ON; OFF ⇒ byte-identical suggestions)
Read-only detector + admin UI only. No extraction / auto-file / learning-write path touched. mergeInto UNCHANGED.

1. **Split the verdict** in `findMergeCandidates`:
   - any member `divergent` → `group_or_review` (genuinely different geometry — never a merge button).
   - else all `compatible` AND all jaccard ≥ AUTO(0.75) → `merge` (existing confident case).
   - else (no divergent; some `insufficient`) AND all jaccard ≥ `MERGE_REVIEW_JACCARD`(0.85) → **`merge_review`**
     (near-identical branding but layout unverifiable — owner eyeballs a sample, then merges; backup-first).
   - else → `review` (weak/mixed branding — surface, no button).
   OFF restores the legacy `!allCompatible ? group_or_review : strongAll ? merge : review`.
   **0.85 is a SURFACING bar, NOT structural insurance** (Oracle + Phillip): branding jaccard proves the
   same COMPANY, never the same LAYOUT — WHO and HOW are orthogonal axes (a redesigned letterhead sits at
   jaccard ~1.0 too). It only keeps the merge button off weaker/possibly-cross-supplier clusters. The real
   guards for `merge_review` are the owner's sample comparison + backup-first reversibility. Our clusters:
   Larkspur 0.89, others 1.0 — all clear it. Do NOT lower it on the theory that branding proves geometry.

1b. **Field-mapping target-zone signal** (Phillip's fail-safe; `fieldZoneVerdict` + fused `layoutVerdict`).
   Landmark labels are the operator's arbitrary anchor words (re-teaches rarely share 3+ → `insufficient`);
   field mappings key on the canonical `field_key` + the value's PHYSICAL target box. Fused rule: DIVERGENT
   if EITHER landmark OR field-zone says different (the DEMOTE that catches Oracle's genuinely-different-
   layout-of-one-supplier case); COMPATIBLE if either gives positive evidence; else INSUFFICIENT. Inert on
   templates without drawn mappings (our 4 real clusters, maps=0 → stays merge_review behind the human).

2. **Canonical richness-first** (`_pickCanonical`): since `mergeInto` SUMS confirmed_count, keeping the
   highest-confirmed row as the target loses nothing on count but can keep a landmark-thin geometry
   (Thornbury canonical id12 = 1 landmark, and mergeInto adopts source landmarks only if target is empty →
   the siblings' 5-landmark sets would be dropped). Re-sort to (landmarks, mappings, sample, live, id).
   Fixes Thornbury → canonical id13/15/16 (5 landmarks). Gated by the same kill switch.

3. **UI honest copy** (`renderMergeCandidates`): per-verdict messaging; `merge_review` gets a merge button
   + "same sender & type, branding X% identical, too few shared anchor points to auto-verify — open a
   sample from each and merge if they match"; the scary "different layouts" note now shows ONLY for true
   `divergent`. Confirm dialog for `merge_review` adds "review a sample first". Backup-first unchanged.

**NOT doing:** landmark UNION in mergeInto (would corrupt registration if two genuinely-different layouts
were ever merged). Canonical-richness + adopt-if-empty already keeps the best single layout's landmarks.

## Slice 2 — reuse-by-branding default ON (kill switch `TEMPLATE_REUSE_BY_BRANDING`, flip `==='1'` → `!=='0'`)
Stops regrowth: a re-teach/confirm reuses its existing (branding, slug) template instead of minting.
The path is already built + guarded (type-scoped ≥3 distinctive tokens, symmetric ratio ≥0.80 = "measured
0% cross-supplier false-match"; under `!templateId` so logo-less converges too; `_supplierLinkOk` Part-E
re-check detaches a wrong-supplier acquisition; `update()` stabilises the fingerprint against OCR poison).

**Confirm-time path — the corpus harness (spawns process_docs.py) never exercises it, so a green corpus run
proves nothing here.** Safety measured by REPLAY over the live DB instead:
- 534 confirmed docs w/ fingerprint · **482 (90%) find a same-supplier same-slug reuse target at ≥0.80** ·
  52 still mint (genuine first-of-kind) · **0 cross-supplier false matches.**

## Blast radius / fail-toward-review
- Slice 1: manual admin tool only; irreversible merge stays owner-confirmed + backup-first; no auto-merge.
- Slice 2: confirm-time template acquisition; never asserts a wrong supplier (0/534); a mis-bind is a
  reversible `template_id` link, not a value write. Stage-0 processing identity is unchanged.

## Gate
Unit tests (templateMerge verdict split + canonical) + the two live replays above. No corpus delta expected
or measurable (both paths are corpus-blind). Kill switches restore byte-identical behaviour.

## Questions for the gate
- Phillip: is loosening `insufficient` (not `divergent`) to owner-confirmed `merge_review` at jaccard ≥0.85
  sound, given re-teaches rarely share 3+ landmark labels? Is richness-first canonical correct? Is 0.80
  branding-reuse safe to default ON given 0/534 cross-supplier?
- Oracle: the seam between Slice 1 (canonical pick) and mergeInto's adopt-if-empty; the premise of default-ON
  Slice 2 while the owner is away; anything that makes an irreversible merge fire on a genuinely different layout.

---

## GATE OUTCOME + BUILD (2026-07-25)

**Phillip: endorsed both slices** — verdict split + richness-canonical correct; required the field-zone signal
(built, 1b) + a Slice-2 token-rarity hardening (deferred, see below); corrected the "0.85 compensates" premise.
**Oracle: SIGN OFF WITH CONDITIONS on both.** All blocking conditions met:
- (blocking) `test_template_reuse.js` Section A baseline set explicit `='0'` (unset now = ON). ✔
- (blocking) `test_template_merge_plan.js` insufficient pin flipped to `merge_review`; added divergent-never-
  merge_review, [0.75,0.85)→review, field-zone demote+promote, richness-canonical (+mergeInto preserves), and
  OFF-legacy byte-identical pins. ✔ (all green)
- (condition) false "0.85 compensates" premise corrected in doc + `templateMerge.js` comment. ✔
- (condition) `merge_review` UI names the geometry check, member names are clickable (open each sample via
  `selectTemplate`), scary "different layouts" note now shows ONLY for true `divergent`. ✔

**Built:** Slice 1 (`templateMerge.js` verdict split + `fieldZoneVerdict`/`layoutVerdict` + richness canonical,
kill switch `TEMPLATE_MERGE_REVIEW` default ON; `settings/renderer.js` UI). Slice 2 (`review/handler.js` flip
`TEMPLATE_REUSE_BY_BRANDING` to default ON, `!=='0'` disables). Tests: `test_template_merge_plan.js`,
`test_template_reuse.js`, + 8 siblings all green. Committed on the feature branch, NOT pushed. No live merge run.

**Live effect (this DB):** all 4 dupe groups now surface as `merge_review` (were hidden as group_or_review);
Thornbury canonical corrected to id16 (5 landmarks) from id12 (1). Slice-2 replay: 482/534 reuse, 0 cross-supplier.

**DEFERRED (documented, not built):**
- **Slice-2 token-rarity hardening (Phillip's condition).** A per-DB IDF/rarity weight so two suppliers can't
  collide on 3 generic/boilerplate tokens ("Services Ltd" on one estate). Not built because it's a shared
  comparator change (findByBrandingFingerprint feeds reuse + backfill) with its own validation burden, and the
  live data shows 0 cross-supplier today; the failure is a reversible link caught by Part-E. Backstop = kill
  switch. **Required before wide rollout.**
- **Page-count divergent signal** (Phillip, "cheapest catch") — additive; deferred to keep scope tight.
- **Slice-2 real verification gate = one live owner batch** (Oracle): confirm a fresh batch of an existing
  supplier, verify it REUSES (no new duplicate) with the correct supplier bind. Until then ON is committed-
  but-unproven; `TEMPLATE_REUSE_BY_BRANDING=0` disables.
- **Running the merges on the live DB** stays an owner action (backup-first, owner-confirmed) — not done here.
