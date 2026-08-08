# HANDOVER 2026-07-14 NIGHT — Supplier + Document IDENTITY overhaul (autonomous session)

> Owner's challenge: make supplier + document identification robust (~100%). Worked autonomously overnight.
> **Guardrails honoured:** shipped only what's proven safe (kill-switched, fail-toward-review, corpus M=0);
> everything committed incrementally; the clean revert point (`71863f2`) + parked work are pushed.

## TL;DR — what to check first this morning
1. **SHIPPED + PUSHED — Slice 1 (`999898c`): SuperStore garble fix.** SuperStore invoices mis-filed under
   phantom senders "INi"/"INGE"/"IN \" now resolve to **"SuperStore"** (review-bound). Reprocess an affected
   doc to see it. Fully tested (unit + JS parity + E2E + corpus byte-identical, M unchanged).
2. **SHIPPED — Slice 2 (`109a9df`): DocSol fill.** DOCUMENT SOLUTIONS worksheets (null supplier → re-teach
   every doc) now fill **"DOCUMENT SOLUTIONS"** review-bound, so your taught anchors apply and
   ref/date/customer read. Corpus A/B **byte-identical** (zero regression), DocSol E2E green. Oracle
   SIGN-OFF-WITH-CONDITIONS; C1 (the pre-existing precedence-override poison path) closed with the same
   value-corroboration; C2 = your data cleanup of the poisoned templates (below).
3. **The BIG win is proven but NOT shipped (needs your go-ahead — it changes core filing):** the **256-bit
   isolated-mark logo hash** cleanly separates every supplier where the current 64-bit hash fails. Measured
   on YOUR docs: a classifier using it got **12/12 correct, 0 wrong** — resolving DOCUMENT SOLUTIONS AND the
   Cascade↔Northgate collision at the root. See "The recommended big fix" below.
4. **A DATA cleanup for you:** templates **4, 5, 7** are named "Cascade Water Systems" but their learned
   issuer is "Northgate Textiles" (poisoned by the logo collision). See "Poisoned templates" below.

## The diagnosis — 3 failure classes, one root
Identity is a BY-PRODUCT of a per-field confidence contest, not a decision by a dedicated arbiter, and the two
signals meant to carry it are weak as built (64-bit region phash of a fixed page zone; a position-blind,
uniqueness-blind bag of keyword words). Verified on your live DB + a multi-expert review (Phillip/oscar/gary):
- **SuperStore → "INi"/"INGE"** (wrong supplier): text-only letterhead + big "INVOICE" title; the title
  OCR-garbles and — because `_is_plausible_supplier_name` only rejected short fragments when ALL-CAPS
  (`isupper()`) — mixed-case "INi" passed as plausible, won the field, and suppressed the letterhead recovery.
- **DOCUMENT SOLUTIONS → null** (no supplier): template matches by keyword fingerprint but the 64-bit logo
  phash drifts out of range on a degraded scan → supplier null → every taught anchor dropped → empty doc.
- **Cascade ↔ Northgate swap:** the 64-bit greyscale phash CANNOT separate two monograms (measured
  same-supplier drift up to 28 > different-supplier distance 8) → colliding logos + poisoned template
  dominant-issuers.

## MEASURED on your real docs (the evidence — `scratchpad/IDENTITY_FINDINGS.md`)
- 64-bit logo phash is BROKEN: intra-supplier 12–28, inter-supplier **Cascade↔Northgate = 8** (overlap; no
  threshold works). ahash worse (Cascade↔Northgate = 2).
- **256-bit isolated-mark hash is CLEAN:** worst same-supplier 64 vs closest different-supplier 108 → a clean
  gap. Cascade↔Northgate = 122 (was 8). SuperStore = no graphic mark (text logo → text identity, not hashing).
- **Detail-hash classifier on your docs: 12 correct / 0 wrong / 3 no-mark** (DocSol resolves; Cascade &
  Northgate 5/5 each; SuperStore correctly routes to text).
- Keyword fingerprints ARE mostly discriminative (Cascade vs Northgate Jaccard 0.12) — only the generic
  doc-type words (delivery/docket) overlap; SuperStore's is 1 word.

## SHIPPED — Slice 1 (`999898c`, pushed)
`_is_plausible_supplier_name` (keyword.py) + `learning.isPlausibleSupplierName`: a case-insensitive
DOCUMENT-CHROME near-form reject (a big title garbling into a short token). DEMOTE-ONLY (fail-toward-review),
kill switch `SUPPLIER_CHROME_FRAGMENT_GUARD`. Oracle caught a blocking seam (the plausibility predicate also
feeds an asymmetric override that could overwrite a real short supplier like Dell/Sage) → split into
`_base` (no chrome) + full; the override arm uses `_base` so the chrome demotion can NEVER overwrite a real
short supplier; JS mirrored (`isPlausibleSupplierNameBase`; templates.js + repairSuspects.js use `_base`).
Tests: `test_supplier_chrome_fragment.py`. Corpus byte-identical.

## Slice 2 — DocSol fill (built; commit pending Oracle)
`_template_identity_for_fill` + `_template_identity_corroborated` (engine.py): when a template matched but the
supplier is unresolved, fill from the template's dominant confirmed issuer — REVIEW-BOUND (persisted note) AND
only when the filled identity's own NAME appears on the page (value-corroboration). The value-corroboration is
what makes it safe: it declines a POISONED dominant issuer (a Cascade docket has no "Northgate" text). Kill
switch `TEMPLATE_IDENTITY_FILL`. Tests: `test_template_identity_fill.py`. Corpus byte-identical, DocSol E2E green.

## The recommended BIG fix (proven, needs your go-ahead — core filing change)
Promote the **256-bit isolated-mark hash** (already in the code as `logo_detail.py`, used only as a timid
abstain-veto) to a **primary logo matcher**. Proven above to resolve DocSol AND break Cascade↔Northgate with
0 errors. Why I did NOT ship it autonomously: it changes how EVERY document is tied to a supplier (→ filing
folder), and it needs (a) a one-time BACKFILL of detail-hashes for existing logos + (b) a shadow-measurement
pass — both warrant your review. Build plan (Phillip/oscar/gary consensus): enrol detail-hashes on confirm +
backfill → promote from veto to primary (threshold ~80–86, fail-safe: no mark → text identity; abstain →
review) → shadow-measure → corpus M=0. Also recommended: IDF/never-reuse-a-word keyword weighting + a positional
keyword constellation (both break the collision on the text axis; foundation `template_sample_words` exists).

## Poisoned templates (DATA cleanup for you)
Templates 4, 5, 7 are named "Cascade Water Systems" but `dominant_supplier`="Northgate Textiles" (Northgate docs
were confirmed under Cascade-named templates via the logo collision). Slice 2's value-corroboration DECLINES
these, but the cleanest fix is to re-confirm the mislabeled docs (Learning Repair) so the learned issuer is
right — and the detail-hash promotion stops future cross-contamination.

## Parked / fast-follows
- `wip/template-identity-fill` (`1dd9f3c`, pushed): the earlier ungated fill (regressed Cascade↔Northgate) —
  superseded by Slice 2's value-corroboration; keep for reference or delete.
- Slice 1 fast-follows (Oracle non-blocking): an operator escape (`accepted_names`) for the chrome guard;
  6+ char title-garble under-reject ceiling.
- Deskew field-re-read (the pre-pivot task, `docs/designs/DESKEW_FIELD_REREAD_2026-07-14.md`) — still unbuilt.

## How to revert
- Everything is on `feat/reprocess-throughput-autostraighten`. Clean pre-night point: **`71863f2`**.
- Per-fix kill switches (no revert needed to disable): `SUPPLIER_CHROME_FRAGMENT_GUARD=0` (Slice 1),
  `TEMPLATE_IDENTITY_FILL=0` (Slice 2).
- `git revert 999898c` (Slice 1) / the Slice-2 commit individually if needed.

## Verification summary (honest status)
- Slice 1: PROVEN (unit + JS parity + 5-doc E2E + corpus byte-identical + Oracle sign-off-with-conditions met).
- Slice 2: PROVEN safe (unit + DocSol E2E + corpus byte-identical); final Oracle vet in progress at handover.
- Big fix (detail-hash promotion): the DIRECTION is proven (12/0/3 on your docs); NOT built — needs your review.
- customer_name / supplier-on-review-docs are not corpus-scored → the corpus proves INERTNESS (no regression);
  correctness is the per-class E2E on your real docs.
