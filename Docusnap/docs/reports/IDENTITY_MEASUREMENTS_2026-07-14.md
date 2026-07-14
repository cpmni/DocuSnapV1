# Identity subsystem — empirical findings (2026-07-14 night, measured on the live DB)

## Failure classes (verified)
1. **SuperStore → "INi"/"INGE"/"IN \"** (wrong supplier): TEXT-only letterhead "SuperStore" + big "INVOICE"
   title. The supplier-name read grabs the garbled INVOICE title and it beats the letterhead + template
   identity. 100 confirmed, 15 scattered across garble groups. Template fingerprint = ["superstore"] (1 word),
   fragmented across templates 10 & 11.
2. **DOCUMENT SOLUTIONS → null** (no supplier): "D" monogram; template matches by keyword fingerprint but the
   64-bit logo phash MISSES on degraded scans → supplier null → taught anchors dropped → doc reads empty →
   user re-teaches every doc. 11 confirmed.
3. **Cascade ↔ Northgate SWAP** (2 mechanisms):
   - delivery_note: Cascade DN → Northgate = **64-bit logo phash COLLISION** (Cascade vs Northgate = 8, < thr 13).
   - sales_order: Northgate SO → Cascade = **MISLABELED TEMPLATE #7** (name "Cascade Water Systems"/sales_order,
     but fingerprint is pure Northgate: northgate/textiles/mill/preston/weavers). Data poisoning.

## LOGO HASH — 64-bit phash is BROKEN; 256-bit isolated mark is CLEAN (owner's "higher bitrate" idea VALIDATED)
64-bit region phash (logo_fingerprints.phash, match threshold 13):
- INTRA (same supplier): Cascade 12–28, Northgate 12–24, SuperStore 14–22 — same-supplier logos DON'T match at 13.
- INTER (diff supplier): Cascade–Northgate **8**, Cascade–Profile 12, Northgate–CityOffice 12 — COLLISIONS.
- ahash even worse: Cascade–Northgate = **2**.
- => intra/inter distributions OVERLAP completely; NO threshold works.

256-bit isolated-mark hash (logo_detail.detail_hash — isolates the compact mark, drops letterhead text),
computed from source for all suppliers (≤5 docs each, 200 DPI):
- INTRA (same supplier): DOCUMENT SOLUTIONS 0–50, Cascade 18–56, Northgate 10–54, City Office 64 (1 pair).
- INTER (diff supplier), MIN over all pairs: **108** (CityOffice–DocSolutions). Cascade–Northgate = **122**
  (was 8!), Cascade–Profile 126, Northgate–CityOffice 112.
- **CLEAN GAP: worst intra 64 < best-collision inter 108** → a threshold ~86 separates ALL measured pairs.
  (Existing veto threshold is 72, already inside the gap.)
- SuperStore: **0 marks computed** (text-only letterhead → no compact graphic mark; _mark_bbox drops the
  horizontal text strip). => SuperStore identity MUST come from TEXT (letterhead OCR + position), not image hash.

CAVEATS: ≤5 docs/supplier; City Office intra=64 is a single pair (could rise with more samples, but 108 inter
gives headroom). detail_hash currently populated for only 7/18 enrolled logos (Slice-B was NULL-inert) — a
promotion to primary matcher needs a BACKFILL for all enrolled logos.

## KEYWORD FINGERPRINT — mostly discriminative; polluted by shared doc-type words + fragmentation + poison
- Fingerprints hold distinctive company/address words (cascade/reservoir/springfield vs northgate/preston/weavers)
  → cross-supplier Jaccard only 0.12 (shared = delivery, docket = the generic doc-type words).
- Owner "never reuse a word another template uses" = drop generic doc-type words (delivery/docket/invoice/...) —
  the distinctive words are already there. Positional info would help but is not the primary lever here.
- Thin/empty fingerprints: SuperStore 1 word, Profile Construction 0 words.
- Fragmentation: SuperStore templates 10 & 11 (both ["superstore"]); Cascade delivery_note templates 4 & 5.
- POISON: template #7 (Cascade-named, Northgate-fingerprinted) — needs data cleanup + a guard so a template's
  fingerprint can't diverge from the confirmed-docs identity it's named for.

## DIRECTION (empirically grounded — pending workflow design + Oracle)
A) Graphic-logo suppliers: promote the 256-bit isolated-mark hash to a PRIMARY/co-primary logo matcher
   (threshold ~80–86, clean gap 64→108). Backfill detail_hash for all enrolled logos. Breaks Cascade↔Northgate DN.
B) Text-logo suppliers (SuperStore): identity from the letterhead-band OCR ("SuperStore") + position; fix the
   precedence so a garbled title/doc-type word can NEVER beat the letterhead/template identity. Drop generic
   doc-type words from fingerprints; require ≥N distinctive words.
C) Data hygiene: de-fragment templates (merge 10/11, 4/5); fix/guard the poisoned template #7 (fingerprint must
   agree with the named supplier's confirmed docs).
All must be kill-switched, fail-toward-review, corpus M=0 (no new wrong-supplier auto-file).

## DESIGN CONSENSUS (workflow: Phillip + oscar; gary null) — SLICE ORDER
Root (all 3): NO single identity arbiter — supplier_name = whatever stage last wrote it; a low-quality READ
outranks a matched template + logo. Signals are structurally weak (64-bit region phash; bag-of-words).
SAFETY (both): supplier_name is TEXT-typed → the 88 critical-field floor does NOT guard it → any FILL path must
be review-bound until >=2 signals agree. Learned gazetteer/dominant-issuer are POISONED by garble confirms.
Slices: 1 fix _is_plausible (chrome near-form, ship first) · 2 issuer-band gazetteer shadow · 3 template-identity
FILL empty (review-bound) → DOCUMENT SOLUTIONS · 4 promote 256-bit mark veto→primary → Cascade/Northgate logo half ·
5 IDF/never-reuse-a-word keyword weighting → collision keyword half · 6 positional keyword constellation ·
7 unified arbiter (shadow→promote) · 8 data hygiene (de-fragment, un-poison template #7).

## SLICE 1 — BUILT (chrome-fragment plausibility guard) — 2026-07-14 night
keyword._is_plausible_supplier_name + learning.isPlausibleSupplierName (mirrored): a DOCUMENT-CHROME near-form
reject (case-INsensitive; kill switch SUPPLIER_CHROME_FRAGMENT_GUARD). _DOC_CHROME_WORDS set + _is_doc_chrome_fragment
(whole title word, or 2-5 char core within bounded edit dist of a title-word prefix). DEMOTE-ONLY (never rewrites).
ROOT it fixes: the old guard rejected short fragments only when isupper() → mixed-case "INi"/len>3 "INGE"/spaced
"IN \" slipped as plausible + won the field + suppressed Stage-2.5a recovery.
TESTS: tests/test_supplier_chrome_fragment.py (Python, ALL PASS) + JS parity (29 checks OK).
E2E (guard on): #239/#268/#289/#295 "INi"/"INGE" → "SuperStore"@85 hint_text_match (recovery fired); #276 →
"SuperStore"@64 logo; all needs_review (review-bound). Controls #158 Cascade / #238 Northgate@100 unaffected.
CORPUS A/B: PASS — guard ON == guard OFF BYTE-IDENTICAL (M=1 pre-existing #23; same 5 pre-existing regressions;
133/272 auto-file; 52 caps). Inert on confirmed corpus (no confirmed supplier is a chrome fragment). 0 accuracy drop.
(Note: #411/#409 confirmed DocSol read "SOLUTIONS" truncation — NOT a chrome fragment, unaffected; separate issue.)
NOTE: the 15 garbles are needs_review (NOT confirmed) so they do NOT poison the SuperStore hint bank (100 confirmed).

ORACLE (SIGN OFF WITH CONDITIONS) caught a BLOCKING seam: _is_plausible_supplier_name also feeds
engine._supplier_identity_decision, whose asymmetric "take" arm lets a plausible candidate OVERWRITE an
implausible incumbent regardless of confidence. So demoting a REAL short name (Dell→'deli', Sage→'sale',
Star→'stat' — edit-1 from title prefixes) could let a wrong plausible challenger silently overwrite a
correctly-resolved supplier (supplier_name is text-typed → not guarded by the 88 floor). FP set wider than
thought. FIX (BUILT): split the predicate into _is_plausible_supplier_name_base (NO chrome) + full (base+chrome);
_supplier_identity_decision judges the INCUMBENT with _base (candidate keeps full) → chrome demotion can NEVER
license a 'take'; SuperStore still fixed via Stage-2.5a recovery (uses full). JS mirrored: isPlausibleSupplierNameBase
added; templates.js (shouldAdoptIssuerName/_looksLikeNonName) + repairSuspects.js switched to _base (Oracle Q4 —
no false-demote of a real short supplier); hint-persist keeps full (reject garble hints).
TESTS: unit now pins the no-flip decision probe (real 'Dell'/'Sage' incumbent NOT overwritten; garble challenger
can't displace; intended stale-'IN' replacement preserved) + base/full split; JS base/full parity OK; E2E re-verified
(garbles still → SuperStore review-bound). Oracle non-blocking fast-follows: operator escape (accepted_names) for the
guard; document FP set; 6+ char garble under-reject ceiling.
GATE REMAINING: corpus A/B after base/full split (running) → then commit.
FILES: keyword.py, engine.py, learning.js, templates.js, repairSuspects.js, tests/test_supplier_chrome_fragment.py.

## DECISIVE EXPERIMENT — detail-hash-PRIMARY classifier on real docs (nearest-supplier 256-bit mark, thr 86)
Reference = 8 confirmed docs/supplier (marks computed from source). Test = failing review docs + held-out confirmed.
RESULT: **12 CORRECT / 0 WRONG / 3 NO-MARK** (of 16):
- Cascade 5/5 correct (@16-32); Northgate 5/5 correct (@2-26) -> COLLISION RESOLVED.
- DOCUMENT SOLUTIONS: 410 correct@52, 374 correct@14, 372 ABSTAIN (nearest rival@104>86 -> safe review, not wrong).
- SuperStore 3/3 NO-MARK (text logo -> text identity; never mis-picked).
=> A detail-hash-primary logo matcher (thr ~80-86) resolves every graphic-logo doc correctly or SAFELY ABSTAINS
   (never a wrong pick). This is the core fix for classes 2 & 3. Class 1 (SuperStore) needs the text-identity path.
   Residual: some degraded scans' marks don't isolate (372 abstains) -> fail-safe to review/text/template.
   Needs: backfill detail_hash on all enrolled logos; make enrolment compute it (currently Slice-B NULL-inert);
   promote from abstain-only veto to primary discriminator; keep coarse phash + text as fallback when mark=None.
