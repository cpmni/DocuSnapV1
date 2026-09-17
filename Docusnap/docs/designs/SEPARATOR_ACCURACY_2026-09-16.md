# Separator accuracy — two DARK arcs (2026-09-16) + a third (2026-09-17, §"Arc 3" below)

**Status:** ALL THREE BUILT DARK (migs 177/178/179, seeded 'false', in `TEST_SWITCH_KEYS`, argv-only kills).
**Advisors:** gary (design A) → Oracle **SIGN OFF WITH CONDITIONS** (A: C1-C7; B: confirmed + widened, slices 1-3, C8-C11).
Owner: "continue" → measured, designed, vetted, built dark. **Flips = owner's call** after the gates below.

## The problem, measured (`TESTING/_measure/watch_separate_soak_20260916/`)
The batch-separation pre-pass (`python_backend/ocr/segmentation.py`) decides per page whether it starts a new
document: a known template matches AND the keyword-fingerprint overlap clears 0.5 (first-page signature), or a
different template matched (identity change), or a generic header cluster (doc-start). Two accuracy classes:

**(A) UNDER-split — a title-blind pre-pass.** The pre-pass called `identify_template(img, text, templates)` with no
`detected_slug`/`title_trusted` (the full pipeline threads the page's own title — the 2026-07-09 TYPE-PRECEDENCE
fix never reached the separator). On a same-letterhead supplier the sibling fingerprints are identical, so the
tie-break degenerates to the most-confirmed sibling; when that sibling's type reliably prints a heading that is
absent on this page, the TYPE-PRESENCE VETO refuses it → `{'template': None, 'type_refused': True}` → the page can
never be a boundary. Every missed boundary in the templated stacks was exactly this (a supplier's LESS-common
types are under-split systematically). The merged cut is held by mig 176, but held = friction.

**(B) OVER-split — a repeated letterhead IS the fingerprint.** `extract_keyword_fingerprint` harvests the letterhead
words, so a genuine continuation page that repeats the letterhead (logo + name + address — the Sage/Xero/Word-
template classes) clears the overlap floor and is cut off as a new document. `segment_docs.py` cut **6/6**
repeat-letterhead 2-page controls at page 2 (reason "first-page fingerprint"). On a manual import that is a
**silent truncation**: page 1 files as a one-page invoice, page 2 orphans (or files as a `-DUPLICATE` beside it).
Watch holds both. Pre-existing since the separator shipped; the soak's "0 over-splits" was vacuous (its singles
were non-templated suppliers). Oracle: three paths — (a) the overlap, (b) a same-supplier identity change,
(c) the generic doc-start on a full-header continuation.

## The fixes (both DARK; OFF = byte-identical argv + calls)
**(B) slice 1 — `segment_continuation_veto` (mig 177): a self-declared continuation page is never a cut.**
`segmentation.is_continuation_page(text)`: "Page n of N" / "Page n/N" anywhere with n ≥ 2 (never as the object of
"on/see/to" — "continued on page 2" is the page BEFORE); a bare "Page n" only as a page-number line of its own;
"continued" / "(cont.)" / "continuation" in the top 12 non-empty lines and never "continued on/overleaf/next/from";
"brought forward" / "B/F" in the top band ("carried forward" is excluded — it marks the page before). Applied in
`detect_segments` only when armed and only for i ≥ 1; `decide_boundary` untouched. OCR-failure direction: a
garbled marker = today's behaviour; a first page misread as "Page 2 of 2" = an under-split → a multi-page cut →
the mig-176 belt holds it (fail-toward-review).

**(A) — `segment_title_slug` (mig 178): thread the page's own title as a CASCADE.** `keyword.title_signal(text,
patterns, doc_types)` = the process_docs recipe (installed types minus `reading_mode='none'`, alias JSON tolerance,
trusted = heading ∧ conf ≥ 70), installed slugs only (no uninstalled-name fallback — pinned). `segmentation.
page_match`: trusted heading → `identify_template(…, slug, True)`; any installed slug → `(…, slug, False)` (the
`matching` branch needs no trust); else/fallback → today's 3-arg call. Each step falls back on None OR any
`type_refused`, so a page can never lose today's boundary (the pipeline recipe without a fallback LOST one: a
wrong trusted "invoice" title on a Castellan worksheet page hit the trusted-title refuse).

**Plumbing (both):** `segment_docs.py --continuation-veto` / `--title-slug --doc-types-file --config-file`;
`split_plan.buildSegmentArgs` emits them only when ON (never a null in argv); `handler.js _separationOpts(db, args)`
reads the two settings once per pre-pass at BOTH callers (manual import + watch `separateFiles`) and threads them —
argv is the only kill because the pre-pass spawn env is `process.env` + OMP, never the DB-bridged switch env.

## Census (`seg_probe4.py`, six arms, per-PAGE; `probe_6arm_*.txt`)
| set | expected | base | cascade (A) | veto (B) | both | over-splits base → both |
|---|---|---|---|---|---|---|
| synthetic stacks (20 files) | 95 boundaries | 72 | 79 (0 lost) | 72 | **79 (0 lost)** | 0 → 0 |
| real 34-page Print Tracker bundle | 34 | 34 | 34 | 34 | 34 | 0 → 0 |
| 5 non-templated multi-page singles | 5 | 5 | 5 | 5 | 5 | 0 → 0 |
| controls: letterhead-band p2 ± heading (6) | 6 | 6 | 6 | 6 | 6 | **6 → 0** |
| extended: logo-only p2, name-line p2 (4) | 4 | 4 | 4 | 4 | 4 | 0 → 0 (the feared identity-change exposure measured 0) |
| extended: full-header p2 + "Page 2 of 2" (2) | 2 | 2 | 2 | 2 | 2 | **2 → 0** |
| extended: "Page 1 of 2" stack (2 files, 4 docs) | 4 | 3 | 4 | 3 | **4** | **2 → 0** (both = exactly right) |
The "pipe" arm (the pipeline recipe verbatim, no fallback) is the one arm that LOSES a boundary — the reason for
the cascade's fallback. Residual 5 stack misses = 150-DPI heading garble ("WORKS HEET", "DELIVE") → an OCR-quality
arc, separate.

## Gates (Oracle)
- (B) slice 1 flip (C8): pure pins ✓ · controls 0/6 ✓ · stacks/real_34 lost-vs-base 0 ✓ · the end-to-end
  TRUNCATION metric **= 0 ✓** (one manual import of all 40 files with both switches armed: 134 docs, 133 exact
  cuts, 67 one-page cuts auto-filed all complete, 0 auto-filed docs shorter than their GT doc — RESULT.md "e2e").
- (A) flip (C5-C7): extended controls over-splits ≤ base per file ✓ (strictly fewer) · stacks lost 0 ✓ · real_34 ✓
  · truncation metric = 0 ✓ · AND (B) slice 2 shipped — OR the logo-only/name-line p2 controls measured 0 delta ✓
  (measured 0 in every arm). **Both gates are green; the flips are the owner's call** (customer default =
  approval-class). The one wrong cut in the e2e run (`bundle_05`, three non-templated docs imported whole) is the
  pre-existing never-split class, identical under base.
- Still owed (Oracle): **(B) slice 2** supplier-aware identity change (census first: same-supplier
  identity_change-only boundaries = 0), **(B) slice 3** the orphan-shaped 1-page cut belt (no ref AND no date AND
  same supplier as the preceding segment → hold both), and a **recovery path** (the original stack sits in
  `.sf_separated_originals` unadvertised; Review has Split but no Rejoin). Logged in `pendingfeatures.md`.

## Pins
`python_backend/tests/test_segmentation.py` §6 (`is_continuation_page` — n ≥ 2 only, "Page 1 of N" never, footers
of the page before never, top band only for "continued", "carried forward" excluded), §7 (`title_signal` — the
pinned divergences), §8 (`page_match` cascade with a recording stub: OFF = one 3-arg call; the fallback chain;
every-step-refuses → no boundary = the Q2 deferral pinned; source pins that the veto is armed-only and never on
page 0) · `src/modules/processing/test_split_plan.js` §7 (argv byte-identical OFF; never a null) ·
`database/test_segment_dark_seeds.js` (migs 177/178 false seeds, listed, no force-ON twin, argv-only kill at both
callers, gate-clean) · count pins 46 → 48.

---

# Arc 3 — a KNOWN-SUPPLIER-NAME identity change (2026-09-17; mig 179 `segment_known_supplier_change`, DARK)

**Advisors:** the signal measured first (`seg_probe5.py`, seven arms) → gary (design) → Oracle **SIGN OFF WITH
CONDITIONS C1-C9** (`docs/oracle_log.md` 2026-09-17). Built exactly to the conditions the same morning. NOT the
Oracle's (B) slice 2 — an ADDITIVE under-split fix; the (A) flip's coupling stays discharged by the 0-delta measurement.

## The class
After migs 177/178, 16 of the 95 stack boundaries are still missed: pages whose supplier has NO template for that
type. `decide_boundary`'s only template-free leg is `is_document_start` (a recipient marker AND a number/date marker),
which never fired on the corpus. **Premise corrected by the Oracle (C9):** a whole non-templated stack with no cut is
NOT held by mig 176 — the belt reads the separator's rewrite set, and a file with no cut has no rewrite
(`split_plan.js:59` `segments.length < 2 → skip`). Such a stack imports WHOLE and auto-files under page 1's identity
(`bundle_05` in the e2e run; base does the same). So every MISS of this rule — including the documented prefix-tolerance
miss below — is today's behaviour, which for a 2-doc stack is a silent whole-file auto-file, not a review hold.
**Second premise corrected:** `bundle_05` page 2 is the SAME issuer as page 1 (a Thornbury purchase order after a
Thornbury worksheet, `gt.json:150-177`), so a supplier-name rule is structurally blind to it at any confirm bar;
`bundle_05` stays 2/3 by design — the lever for a same-issuer TYPE switch is a two-sided trusted-title signal, logged
in `pendingfeatures.md`. Never tell the owner "confirm it twice and it separates".

## The rule (`python_backend/ocr/segmentation.py`, pure; `walk_boundaries` = the page walk extracted)
A non-first page whose LETTERHEAD BAND names one of the install's own KNOWN suppliers that differs from every known
name in the current document's first-page band, AND that carries a first-page WITNESS, starts a new document
("known supplier change"). Guards, each with its own control:
- **Population** (`learning.getKnownSupplierNames(db, {minConfirms: 3})`): Tier A of `findNearMatchIdentity`
  verbatim — HUMAN confirms only (`confirmed_via NOT IN MACHINE_VIAS`, `learningExcludedSql`, Quick File rows never),
  GROUP BY the lower-trimmed name, n ≥ 3 (the reader's own documented default — "a single earlier typo cannot become
  the target") ∪ Tier B, every frozen `template_fields.supplier_name` (is_variable = 0). NOT `templates.name`, NOT
  machine confirms. Written to its OWN temp JSON per pre-pass by `handler._separationOpts(db, args, tempFiles)` (pushed
  to the caller's cleanup array; `process_docs.py`'s strict `parse_args` means it must never ride `buildTrainingArgs`).
  Sandbox (a live-DB copy): 20 names at ≥ 3 — 19 real suppliers + "PT" (Tier B) which admission kills; "Chris Docs"
  (9 confirms) and "ME" (3) also die to admission; "Finances" (1 confirm) never reaches 3.
- **Admission** (`admit_known_name`): ≥ 2 content tokens, or one token of ≥ 8 letters, after stripping legal suffixes
  (ltd/limited/plc/llc/inc/co/company/corp/corporation/gmbh/uk/group/holdings), STOP_WORDS, document-chrome words and
  non-alphabetic tokens.
- **Band** (`known_names_in_band`): `template_matcher.header_band_lines` = the ONE letterhead-band definition (the raw
  lines `header_band_text` joins — cut BEFORE the counterparty block: bill/ship/invoice/sold to, customer, the
  buyer-issued "Supplier :"/"Vendor :" regex), cut again at the separator's own recipient markers and at the first
  ITEM-TABLE header line (≥ 2 of description/qty/quantity/unit/price/amount/net/vat/total/rate/hours/each/goods on one
  line); only the first **6** non-empty lines count (Oracle C2 position bound; the `top4` probe arm measured free at
  93/95). A line — or the line above it — carrying a c/o / care-of / delivered-by / collected-by / via / attn / FAO /
  "To:" context never counts; a line carrying a money amount (`d.dd`) is a line item, never a letterhead. Word-boundary
  token regex, the page's legal suffix tolerated; earliest offset wins, tie → the longer name.
- **Witness** (`has_first_page_witness`, Oracle C1 — the drafted list was near-vacuous): a LABELLED number marker
  (`_NUMBER_MARKERS` ∪ reference/ref/our ref/your ref/job/quote/quotation/credit note/delivery note/docket/ticket/note
  no|number, order ref, invoice ref) OR a LABELLED date marker (`_DATE_MARKERS` ∪ "date:", "dated", delivery/docket/
  quote/job date, tax point, date of issue) OR — only when mig 178's title arm is armed and read one — a trusted title.
  Never a bare "No." / "Date " (a "Part No." column or a "Registered No." footer is not a first page).
- **Same-supplier** (`same_supplier`): suffix-stripped token equality OR a token-prefix either way ("Print Tracker" ≡
  "Print Tracker Ltd" ≡ "Print Tracker Services"). Suppress-only — it can never cause a false cut; its cost is a
  documented MISS (pinned): a genuinely different "Copperfield Electrical Services" after "Copperfield Electrical" is
  today's behaviour.
- **First-page SET**: the current document's identity is the SET of known names in its first page's band, and the
  cut page's EARLIEST band name is tested against it. An unlabelled recipient printed above the issuer (a window-
  envelope layout / mutual B2B trading — the Oracle's seam) can never make the issuer's own letterhead on page 2 look
  like a stranger. The first-name-only form false-cuts that layout (control `ctrl5_envelope_*`).
- **DROPPED + pinned:** "unknown → known" (the current doc named nobody known, this page names one). Its real failure:
  a page-1 letterhead garbled at 150 DPI + a clean page 2 → two UNHELD 1-page cuts (2/2 on the blurred-letterhead
  controls under every arm that carried the sub-rule; 0 without it). Only a DIFFERENT admitted name on BOTH sides is
  asymmetry-safe. `bundle_05` was never a population problem (premise above).
- **Order:** `decide_boundary` → this rule (only when no boundary yet) → the continuation veto LAST ("Page 2 of 2" +
  a different known name → no cut, pinned). A boundary the old legs already decided keeps its own reason.
- OCR failure direction: a garbled name = no name = today's behaviour; a garbled witness = no cut = today's behaviour.

**Plumbing:** `segment_docs.py --known-suppliers-file X --known-supplier-change` (the rule arms only with BOTH and a
non-empty list; `prepare_known_suppliers` admits + dedups on the Python side); `split_plan.buildSegmentArgs` emits the
pair together or not at all (never a null path); `_separationOpts` takes the caller's `tempFiles` at BOTH callers
(watch `separateFiles`: `built.tempFiles`; manual import: `tempFiles`); no array → the rule stays OFF (no leak). Argv is
the only kill. Byte-identical OFF: `walk_boundaries(known_rule=False)` reproduces the old inline walk and its reasons
(pinned on legacy 4-tuple signals); names/witness are computed only when armed.

## Seam (Oracle)
By construction the rule converts HELD multi-page cuts into UNHELD 1-page cuts on MANUAL import (`segmentHoldPages`
holds multi-page cuts only; WATCH holds every fresh segment) — so a FALSE cut here is the S4 silent class on manual
import only, and the gate is SEGMENT-level (over-splits = 0 on every control), not the filed-level truncation metric
alone. The e2e checker now fails a HELD wrong cut too (C6). `header_band_text` on a continuation page has no
recipient marker, so the band would run into the item table — the table-header cut, the money-line exclusion and the
6-line bound close that (controls `ctrl5_item_*` / `ctrl5_itembare_*`). 179-ON with 178-OFF is a reachable customer
state → its own census arm (`veto_known`).

## Census — the SHIPPED functions (`seg_census3.py` imports `ocr.segmentation`; population = `known_names.js`, the
shipped reader on the sandbox at ≥ 3; `census3_*.txt`; the full table + the per-shape notes in RESULT.md "Arc 3")
| set | expected | base | 177+178 | **three** | 179 ON / 178 OFF | over-splits base → three |
|---|---|---|---|---|---|---|
| synthetic stacks (20 files) | 95 | 72 | 79 | **91** (0 lost) | 87 | 0 → 0 |
| real_34 + 5 multi-page singles | 39 | 39 | 39 | 39 | 39 | 0 → 0 |
| controls1 / 2 / 3 / 4 | 6 / 10 / 8 / 6 | 6 / 9 / 8 / 6 | 6 / 10 / 8 / 6 | 6 / 10 / 8 / 6 | 6 / 9 / 8 / 6 | 6→0 / 4→0 / 1→1 (base residual) / 0→0 |
| controls5 (the C4 shapes, 20 files) | 25 | 22 | 22 | **25** | 25 | 3 → 3 (base residual; **0 new**) |
| the owner's PDFs (live inbox + sandbox filed; 25 multi-page) | — | — | — | 6 changed plans, all the belt-OFF replay's wrongly filed merged cuts | — | 0 unexplained |
The Oracle's ruling on the number: the 91 bar had been derived from the probe's superset population, so C5 became "0
lost vs 177+178 AND every residual miss a named, deliberate fail-safe trade" — the 4 residual are Larkspur (0
confirms, the population), `bundle_05` (same issuer), and 2 × the SET reset after a base cut into an unnamed 2-page
single (`bundle_mp_01`; carrying the prior name across an unnamed cut = the garbled-letterhead S4 class one document
on — REJECTED alternative, do not restore). The third witness arm (a recipient block + a real date shape, the Oracle's
accepted OR-arm) recovered the two marker-poor Saltmarsh dockets (89 → 91) and bought 0 new over-splits.
**e2e (three switches, 72 files = every stack + every control set; RESULT.md "Arc 3 e2e"):** 189 docs, 178 exact, 82
one-page cuts auto-filed all complete, 3 merged cuts held + marked; `bundle_05` = a held 2-page + a 1-page ✓; every
whole-file outcome identical to the two-switch run ✓; **mig 179 added 0 truncations** ✓ — but the wider set exposed the
PRE-EXISTING marker-less repeat-letterhead over-split on 4 controls (identical under base and 177+178), one of which
AUTO-FILED a truncated page 1 (the S4 class caught live on a manual import). That is the Oracle's slice 3 and the
recommended next arc; a natural suppress-only extension of this arc's machinery — "the page's known-supplier name
EQUALS the current document's AND no witness → never a first-page-fingerprint cut" — is logged in pendingfeatures.md.

## Pins
`python_backend/tests/test_segmentation.py` §9 (admission incl. the documented 8-letter single token; the band: the
counterparty cut, suffix tolerance, word boundaries, the c/o line + the line under a bare c/o, every context word, the
money line, the table-header cut, the 6-line bound, earliest-first, the "Supplier:" PO shape; `same_supplier` incl. the
PINNED prefix miss; the witness incl. the bare "No."/"Date " negatives and the title arm) · §10 (`walk_boundaries`: OFF
on legacy 4-tuples byte-identical incl. reasons; the rule; no witness → no cut; the veto beats the rule; unknown → known
NEVER; the first-page SET; earliest-name semantics; the set resets after a cut; a nobody page never resets it) · §11
(source pins: names/witness only when armed, the pure walk, the title read once, the labelled-marker constants) · §12
(`header_band_lines` = the join's lines) · `src/modules/processing/test_split_plan.js` §8 (both or neither; OFF
byte-identical; order) · `database/test_segment_dark_seeds.js` (mig 179 seed, listed, no twin, the handler reads the
setting + calls the reader at 3 + pushes its own temp file, the file never rides buildTrainingArgs, no env bridge, gate
clean) · `database/modules/test_learning_excluded_readers.js` (`getKnownSupplierNames` = the 18th reader: SITES row, the
§3 snapshot 5 → 4 → 0, the Q-C1 intake row never counted) · count pins 48 → 49.
