# Pending Features — ARCHIVE (decided / superseded / answered / built)

> Entries moved out of `pendingfeatures.md` because they are CLOSED: shipped-and-flipped, built,
> superseded by a newer entry, formally REFUSED (do not build), or ANSWERED. Kept here (and in git) for
> the record so the live backlog stays the genuinely-pending work. Full detail also lives in the linked
> commits / `docs/oracle_log.md` / `docs/designs/`.
>
> Archived 2026-09-02 (section-by-section pass). Nothing here is pending — do not re-action without a
> fresh decision.

---

## 2026-08-13 — BUYER-ISSUED SLICE 3 (the stamp-contradiction rail): **MEASURED AND REFUSED — DO NOT BUILD AS DESIGNED**
Slice 2 SHIPPED (migration 66 + `template_buyer_issued_type_scope`, DEFAULT OFF). Slice 3 was
designed as: *a `template_fixed` stamp of a `_PRECISE_VAL_TYPES` field contradicted by a DIFFERENT
well-formed same-type value on the page ⇒ note + hold below auto-file.* Its own design named the
gate — *"`extractions.corroboration` already records this disagreement, so the rail can be MEASURED
from recorded rows before it acts"* — and the measurement refuses it **twice, independently**.
**CENSUS (read-only, snapshot of the live DB, 6514 rows carrying a corroboration record):**
```
field            stamped  agreed  contradicted
supplier_name       1038    1037           192
vat_no               120     120             0     <-- the field the rail was FOR
customer_name          5       0             5
account_no             2       0             0
```
**(1) INERT WHERE IT WAS AIMED.** `vat_no` is stamped 120 times and contradicted **ZERO** times.
A rail keyed on VAT contradiction fires on nothing. **And `_PRECISE_VAL_TYPES` is literally
`frozenset({"mac_address", "ip_address"})` (`anchor.py:2563`) — `vat_no` is not in it** — so the
slice as written would have been inert for VAT *by construction*, before the data even spoke.
**(2) NOISY WHERE IT WOULD ACTUALLY FIRE.** Restricted to page-reading families (crop/keyword),
121 rows contradict: **116 `supplier_name` + 5 `customer_name`, and the "contradiction" is junk** —
`keyword="DELIVER TO"` (a caption fragment, ×100+ on the owner's own POs) and
`crop="Jordwind Refrigeration Ltd"` / `"lordwind…"` (an OCR garble of the SAME name that is
stamped). Every listed exhibit is a document where the STAMP IS CORRECT. Building this would hold
~121 correct documents for review and catch nothing — an unpaid-for tier, the exact thing Census C
exists to kill.
**THE HONEST FRAME (same as the VAT-EU C2 finding): this install holds the MECHANISM but not the
TRIGGER.** Chris's exhibit is real — Oakhaven prints `GB 660 1173 45` while the stamp said
`GB 512 8846 27` — but it only exists where a buyer-issued template claims another company's
document, and the live install has no such template (B9 census: CLEAN). Slice 2 attacks that cause
directly; slice 3 would have been a second guess at the symptom.
**REVIVAL CONDITION, so this is not re-litigated from memory:** re-run
`scratchpad/census_stamp_contradiction.js` (recreate from this entry) on an install that HAS a
buyer-issued template claiming foreign documents. The rail is justified only if the contradicted
population is dominated by rows where the STAMP is wrong — not by caption fragments and garbles of
the stamped value itself. On today's data that number is 0 of 121.


---

## (ruling record) 2026-08-13 — MACHINE-FEED ARC: gary design + Oracle SIGN-OFF-W/COND (C1-C6)
gary consumer map + Oracle pass both run 2026-08-13 (agents; census run same day). **Design (slice 1):**
flag `learning_exclude_machine_confirms` DEFAULT OFF (+toggle + env winning both ways, the
trust_shadow_row_skip C5 pattern, setting read INSIDE learning.js); when armed + via column exists, add
`AND (COALESCE(d.confirmed_via,'') NOT IN (<MACHINE_VIAS>) OR c.corrected_value IS NOT NULL)` to the
learning.js:1272 getFieldFormats query (the OR leg = Oracle C2 human-correction carve-out, RETAIN ruled —
preserves the remediation mechanism; a correction row is a human act, machine confirms never write one);
extract shared `MACHINE_VIAS` constant {scope_sweep, auto_corroborated, auto_reprocess, auto_graduated,
auto_threshold} (FIVE, not four) used by learning.js + trust.js:595 + templates.js:1122; emit additive
`machine_value_counts` key consumed by NOTHING in slice 1 (pinned inert — slice 2 restores refusal-side
evidence from it). Rejected: down-weight (garble ×20 crosses any bar); per-consumer split (~10 drift seams).
**LIVE CENSUS (post-remediation): totalGroups 65 · groupsDie 0 (NO group starves) · shapeFlips 1 ·
domMachineMaj 20 (name-like groups w/ machine-majority dominant) · confadoptDrop 0 · strongFlips 0.**
Script: scratchpad machine_learning_census.js (session 4223d9fa).
**Oracle conditions:** **C1 BLOCKING (this arc):** templates.js:1122 filters only scope_sweep/auto_reprocess
(2 of 5) and `_autoFileDoc` DOES call learnTemplateOnCommit (handler.js:4517) — every auto_graduated/
auto_threshold/auto_corroborated file TODAY drives template learning incl. the frozen-string confirm counts
keying the young-identity guard; Oracle position: EXCLUDE (extend MACHINE_VIAS there), own small census
(post-stamp docs that drove template learning), may ride slice 1 or ship as slice 1.5 — cannot stay unruled.
**C2** (blocking before flip): the correction carve-out above, pinned either way. **C3** (blocking before
flip): snap-known-loss census — scopes where dominant stays armed post-exclusion AND ocr_corrector `known`
(engine.py:7275 immunity) loses machine-only values = potential SILENT REWRITE window (fail-toward-WRONG);
zero required, else ship the slice-2 known-union first. **C4** (blocking before flip): name + direction the
one live shapeFlip, pin it. **C5:** pin the gate-unify dependency (armed exclusion + unify-ON stamp
round-trip; exclusion is BLIND when autofile_gate_unify OFF — via stamps NULL at handler.js:4458) + toggle
copy says "requires Auto-file gate unification ON". **C6** (ride slice 1): fix CONFADOPT docstring
engine.py:2703 ("≥5 human confirms" is FALSE — code counts ALL confirmed rows) + the stale learning.js:1298
comment in the same commit. Rulings: shape-loss ACCEPTED (no per-consumer split); CONFADOPT refusal union =
acceptable residual (confadoptDrop 0) but snap known-union NOT (C3); cold-start thinning ACCEPTED (pin);
Learning History = ANNOTATE never exclude ("not used for learning" tag when armed). Flip bar: census +
realdoc M=0/zero-drop on POST-STAMP snapshot + Quillstone pre-remediation backup doc_freq crosses 0.9 STRONG
(docusnap_pre_namerepair_20260812.db — real gate, fails on the bug) + starvation pin + C2-C5. Original entry:


---

## (superseded original) 2026-08-12 NIGHT — MACHINE AUTO-FILES FEED THE NAME LEXICON/VALUE-COUNTS (found via the Quillstone poison; own arc, NOT built)
**Mechanism (provenance-verified):** a conf-100 machine auto-file of a GARBLED read becomes
status='confirmed' and feeds getFieldFormats value_counts -> the 4.5 name lexicon, dominance
buckets, CONFADOPT counts. Live damage: 'Quilistone' x3 + 'Quiltstone' x1 auto_threshold confirms +
'Branblewood' x3 auto_graduated echoes diluted the Quillstone customer lexicon to doc_freq 0.888 <
the 0.9 STRONG bar — the machine's own mistakes disarmed the repair that would have fixed them
(the T3/window-exclusion principle one level down: the route manufactures the evidence it
consumes). Design question: exclude (or down-weight) machine-confirmed rows (confirmed_via IN the
sentinel set) from getFieldFormats value_counts/lexicon inputs — precedent: CONFADOPT B3 already
excludes '+confirmed_adopt' rows unconditionally. BLAST RADIUS: every learning consumer (formats,
shapes, noise profiles, corrector indices) — needs gary census (how much learning volume is
machine-derived now that auto-file volume is real) + Oracle. Interim mitigation: the
repair-poison-name-confirms remediation script (shipped, owner-consented APPLY owed).


---

## (superseded original) 2026-08-12 NIGHT — IMPORT AUTO-FILE PRE-GATE vs THE SHARED PREDICATE: the last two-gate disparity (owner-ordered slice, NOT built)
**Symptom (live, owner-hit):** a fresh Castellan import left 20 docs @95 in the queue that
`trust.isAutoFileEligible` judges ELIGIBLE (trusted scope, floor 95, zero flags, basis graduated) —
they never auto-filed and nothing re-asks. **Verified mechanism:** `_maybeAutoFile`
(`processing/handler.js:4326-4329`) pre-gates on the Python `file_done` message: sub-100 docs are
refused whenever `msg.needs_review` is true — a BROADER signal than the predicate (it fires on an
empty field / below-threshold field confidence, which the predicate correctly ignores for
non-structural fields). The authoritative gate never gets asked; the doc parks forever. On the
exhibits the only hole is an EMPTY `vat_no` (@0) — **probable trigger, NOT source-verified: before
building, trace exactly what sets `needs_review` in the Python emit** (engine/process_docs) on one
of docs 737-756.
**Fix direction:** for graduated (sub-100-floor) candidates, let the import path defer to
`trust.isAutoFileEligible` instead of bowing out on `msg.needs_review` — the predicate already
carries the flag/structural/verifiability safety (same "two auto-file sites must not diverge"
principle: Oracle 2026-08-12 consent-bar ruling, the retired get-auto-file-eligible comment, and
`_autoFileDoc` itself). Keep the conf pre-filter (`< preFloor` bail) — it is cheap and consistent.
NOTE the seam: `needs_review` ALSO carries per-field below-UI-threshold signals the predicate never
sees — decide deliberately whether a below-threshold FIELD (not a flag) should hold a graduated
doc, and pin the answer. Flag DEFAULT OFF + toggle + wiring pin; own advisor+Oracle pass.
**Gates:** realdoc arm (dark md5-identical; armed = would-file delta only on the disparity class) ·
census of queue docs eligible-but-parked before/after · zero new wrong-value auto-files (M=0).
**Interim exits (no code):** File All Ready, or group-reprocess → the `0177716` consent bar offers
them; or per-sender editor "Never on these documents?" on the empty field.


---

## (superseded original) 2026-08-12 EVE — TYPE ELECTION: address caption 'bill to' outvotes the printed CREDIT NOTE title (traced, design ready, NOT built)
**Owner-reported disparity: import types Meadowvale `-2` credit-note pages as INVOICE; a straighten-reprocess flips them to credit_note.**
Traced end-to-end (agent FINDINGS: scratchpad session 30ca4b35 `disparity\FINDINGS.md`; both premises REFUTED —
title never dropped, heading flags played no role, threading identical). Mechanism, all FACT-labelled:
`config/keyword_patterns.json` Invoice bucket contains the ADDRESS caption `'bill to'`; on tilted scans it OCRs
alone on its own line → passes the strict whole-line heading test (`keyword.py:946`) → 2× + `head=True` ⇒ Invoice
~6.0 conf 90 heading=TRUE, while 'CREDIT NOTE' shares its row with the letterhead and the column-aware heading
test checks only the LEFTMOST segment (`keyword.py:943`) ⇒ mention-only ~5.7; 3 of 5 were EXACT TIES and `max()`
takes config insertion order = Invoice (`keyword.py:965`). The trusted wrong heading then pre-gates OFF all
heading re-read rungs + `REPROCESS_HEADING_GEOM` (`process_docs.py:573/:598/:628/:668`) and makes
`identify_template` REFUSE the credit_note template ("Couldn't match … saved Invoice layout", `engine.py:8118`).
Deterministic per route; plain reprocess can NEVER self-heal (cached text pins the election — arm B); only
deskew re-reads (arm C byte-matches live #609's flip). **Fix design (own advisor+Oracle gate before build):**
(1) address-block captions (`bill to`, `billed to`, …) mention-only — never heading-eligible (alone heals all 5);
(2) heading test checks EVERY column segment, not seg0; (3) tie-break prefers the heading-backed candidate over
config order. **Gate: full-corpus TYPE census, M=0 outside the healed class.** Wrong layers (do not build):
heading rungs, template refuse, threading, DPI, deskew.


---

## 2026-08-10 — NON-UK VAT NUMBERS ARE NOW REFUSED (Oracle C7)
### STATUS: FIXED behind `VAT_EU_FORMATS` (DEFAULT OFF, bridged + toggled + pinned).
### Per-country structures with exact element counts — never a generic "two letters plus 8-12
### characters" rule, which is what would readmit the garbles. **MEASURED on the live install:
### 56 distinct `vat_no` values ever committed, 10 accepted before and after, 46 refused before
### and after, ZERO flipped refused→accepted.** All 20 real non-UK forms pass, spaced and
### unspaced; `comsssie42` / `ee05351042` / `VAT` / `3PL` / `1RE` still refused; UK identical.
### **The renderer widens from the SAME setting** (`get-validation-patterns` in review/handler.js),
### which is the `iban` lesson — a backend-only widening would still warn an operator that their
### correctly typed Irish number is wrong. **CORRECTED BY ORACLE C3 (below): that is TWO of THREE
### consumers.** `trust.js` reads the same config directly and deliberately does not widen.
### **THE LIMIT, which format cannot fix:** a garble that matches a real country structure exactly
### IS accepted — `'ee053510429'` (nine digits, a valid Estonian shape) passes, while the measured
### `'ee05351042'` (eight) does not. Same lesson as the serials entry.
### **DEVIATION, pinned:** Romania is officially 2-10 digits; it ships floored at SIX, because a
### 2-digit body in a filing field is junk. A shorter real RO number falls to review.
### **ORACLE: SIGN OFF WITH CONDITIONS (2026-08-10) - 4 BLOCKING. C1/C3/C4 APPLIED; C2 OUTSTANDING.**
### **C1 WAS A SHIP-BLOCKER AND IS FIXED.** `NO` is not only Norway's country code, it is the
### English caption word "No" - and `keyword.py:1409` (`_VAT_ID_LEADIN`) already records that as
### what sits immediately left of a VAT number's digits. The separator class swallowed a space AND
### a full stop, both consumers compile IGNORECASE, and a UK VRN is exactly NINE digits - Norway's
### own element count. So `No 651 0027 84` / `No. 651 0027 84` (a UK number carrying its own label
### tail, this repo's most-measured defect class) validated as Norwegian at coverage 1.00 and would
### have COMMITTED SILENTLY where today it falls to review. Fixed by making the MVA suffix
### MANDATORY (and MWST|TVA|IVA for CHE) - a more specific rule, not a looser one. The pin was run
### RED against the pre-fix config before it went green. Live census re-run: still 56 values,
### 10 accepted / 46 refused / **0 flipped**, so the narrowing cost nothing on real data.
### **C3: THE "BOTH CONSUMERS WIDEN" CLAIM WAS INCOMPLETE - THERE ARE THREE.**
### `trust.js` `_sharedValidationPatterns` reads the config directly and does NOT widen, feeding
### freeze_guard arm B (a correct `DE123456789` is declined a freeze with a misleading reason
### `'format'`) and the auto-file `vat_gb` HMRC mod-97 checksum (a correct Irish number could never
### auto-file). Both fail toward review, so it is recorded and PINNED
### (`database/modules/test_freeze_guard.js`, with a UK control) rather than widened - widening it
### changes what gets FROZEN and what AUTO-FILES, which is a different decision.
### **C4: FLIPPING THE TOGGLE NEEDED AN APP RESTART, AND THAT WAS THE DEFECT ITSELF.** The renderer
### cached the MERGED patterns while Python re-reads the setting per spawn, so for one restart the
### pipeline was wide and the operator warning narrow - the exact UI/pipeline disagreement the
### widening exists to remove. Now caches the RAW config and merges per call. New behavioural pin
### `src/modules/review/test_validation_patterns_merge.js`, shown RED (4 checks) against the old
### cached-merge before going green.
### **C2 IS DISCHARGED (2026-08-10 EVENING3).** New rejected-candidate census: both `vat_no`
### rejection sites (`keyword._validate`, `anchor._crop_is_credible`) gained an env-gated logger
### (`VAL_CENSUS_DIR`, inert unless set), run over the 200-doc corpus as arm `valcensus`.
### **2036 gate decisions, 519 refusals, 230 of them `vat_gb`, 61 distinct refused strings.
### RE-TESTED AGAINST THE WIDENED SET: ZERO newly accepted.** C2's pass criterion is met on the
### population the committed-value census could not see.
### **AND THE REFUSED POPULATION VINDICATES C1 WITHOUT TRIGGERING IT.** Three of the 61 are literal
### caption tails - `'No GB 903331842'`, `'NoGB 903 331842'`, `'NoGB 903331842'` - so the "No"
### caption really does get captured into `vat_no` crops on real documents. It survives here only
### because these suppliers print the `GB` country code after the caption, which breaks the Norway
### pattern at the `G`. **Stated honestly: this corpus contains the MECHANISM but not the TRIGGER.**
### Re-tested explicitly, the PRE-C1 optional-suffix list would also have accepted 0 of the 61 - so
### C1 is not justified by this corpus, it is justified by the one printed layout away from it
### ("VAT No 651 0027 84" with no country code, which is ordinary UK practice).
### **Control:** the `valcensus` arm scores ref 25 ok / 3 wrong, identical to `base`, so the
### instrument does not perturb what it measures.
### Advisory and also outstanding: an operator-affirmation hatch for a value the table cannot know
### (model on `accepted_name_values`); `guessType` maps /vat/ to `currency` (`doctype-editor.js:78`),
### its own defect; and the "VAT number (GB)" type label lies once armed.

`vat_no` gained a real format on 2026-08-09 NIGHT (`92c7013`) and the shipped patterns are **UK
ONLY**: `GB` + the 3-4-2 grouping, the 12-digit branch-trader form, the GD/HA government form, and a
bare 9- or 12-digit run. That was deliberate - the corpus and the customer base are UK, an
international arm buys zero measured recall here, and a generic "two letters plus 8-12 characters"
arm would let six of the measured OCR garbles straight back in (`comsssie42`, `ee05351042` and
friends: 'CO' and 'EE' are real country codes).

**THE COST, stated so a customer does not discover it first.** A UK business receiving an invoice
from an Irish, German or French supplier now gets `vat_no` **empty, and a review**, and an operator
who types `IE1234567FA` by hand gets an on-blur warning telling them their correct value is wrong.
It fails toward review, so it is not a blocker - but **this is the same class that was fixed for
`iban` on 2026-08-08**, where the backend accepted a conventionally-printed IBAN while the renderer
warned on it. Do not let it sit.

**THE FIX IS DESIGNED AND HELD.** reggie's Tier 2 is a CLOSED per-country table with per-country
lengths (DK/FI/HU/LU/MT/SI 8 digits, DE/EE/EL/GR/PT 9, BE/PL/SK 10, HR/IT/LV 11, SE 12, plus the
shaped forms for AT/CY/ES/FR/IE/NL and the ranges for BG/CZ/LT/RO). Verified against the measured
garbles: with the closed table ZERO of them are readmitted - it is the GENERIC arm that readmits
six. The RO branch is the loosest and would be the one to watch.

**Ship it the day a real EU supplier arrives, with that supplier's own number as the test case** -
not before, because a pattern nobody can test against real paper is a pattern that will be wrong in
a way nobody notices. The full per-value verdict table is in the 2026-08-09 NIGHT advisor round.

---


---

## 2026-08-08 — ANSWERED (2026-08-08 later): template LANDMARKS are page-0-only while MAPPINGS can now be page 2+

Surfaced by the teach multi-page smoke run (feature verified working — `5ad0220`, page_number 1
written and confirmed against the DB).

> **ANSWERED AT SOURCE — the teach+reprocess probe below was NOT needed; the code and the live DB
> settle it. Read this box before re-investigating.**
>
> **Q1 — does landmark capture read every page? NO, and it is hardcoded in BOTH derivation paths.**
> `templates/handler.js:82` (`captureSampleWords`) and `:157` (`generateLandmarks`) each spawn
> `landmarks.py` with a literal `'--page', '0'`; `tryCrossSampleLandmarks` (`:115`) never passes a
> page at all and `select_cross_sample`'s signature defaults `page_number=0`. **Worse, and this is
> the load-bearing new fact: `template_sample_words` (migration 34, `database/index.js:735-746`) has
> NO page column**, so the cross-sample corpus is page-blind BY SCHEMA — per-page cross-sample
> landmarks need a MIGRATION, not just an argument change. So a page-2 mapping can never acquire
> landmarks: its registration is dead by CONSTRUCTION, not by starvation.
>
> **Q3 — confirmed.** The `:242-253` backfill is `NOT EXISTS (… WHERE l.template_id = t.id)`, per
> TEMPLATE. A template with page-0 landmarks looks done however many pages it maps.
>
> **SEVERITY IS LOWER THAN THIS ENTRY ORIGINALLY IMPLIED — degradation, never corruption, and today
> zero.** Three separate checks:
> 1. **Page-2 mappings ARE read in production.** `page_images` from `extract_text_and_images` is the
>    FULL page list (bounded only by the 300-page OCR cap), `crop_pages` is parallel to it
>    (`engine.py:4707`) and `extract_with_mappings` indexes `page_images[page_idx]`. The `page_idx >=
>    len(page_images)` skip only ever bit the single-page PREVIEW caller — which is exactly what
>    `TEMPLATE_PREVIEW_PAGE_PAD` (`6c85157`) already fixed. Nothing is silently dropped.
> 2. **Page-0 landmarks can NEVER be mis-applied to page 2.** `lm_by_page` buckets by page and the
>    lookup is `page_transform.get(page_idx)` (`template_mapper.py:609-618, 628`), so a landmark-less
>    page gets `None` and the mapping falls through to the anchor/absolute rungs — the documented
>    "never worse than today" path, not a blind transformed crop.
> 3. **Live blast radius is ZERO.** Read-only census of `%APPDATA%\ScanFinder\docusnap.db`: all 38
>    field mappings are `page_number = 0`; all 96 landmark rows are `page_number = 0` (30 `auto`,
>    66 `cross_sample`); the query "template with a mapping on a page carrying no landmark" returns
>    NO ROWS; and 0 documents have `page_count > 1`.
>
> **Bonus — the corrected starvation claim reproduced independently from the live DB:** 15 of 33
> templates are under `MIN_VERIFIABLE_INLIERS = 3` (6 with zero landmarks, 7 with one, 2 with two),
> and **exactly ONE of them has any field mappings** — template 30, 2 landmarks, 3 mappings, the only
> one paying anything today. This matches 007's refutation in `HANDOVER_2026-08-08_DAY.md` exactly.
>
> **What remains open is therefore a FEATURE, not a defect:** per-page landmark derivation, so that
> multi-page teaching gets drift correction on the pages it taught. Fix shape, smallest-correct:
> derive landmarks for each page that CARRIES A MAPPING (not every page — cost is one OCR spawn per
> page), make the backfill existence-aware per (template, page), and add `page_number` to
> `template_sample_words` before making the cross-sample path page-aware. **It is a NO-OP on this
> corpus by construction** (only page 0 has mappings), which is a gate strength and a gate weakness:
> byte-identical is provable, but the new behaviour can only be exercised against a BUILT multi-page
> fixture. Honour 007 item F / Oracle's standing rule — turning registration ON where it is currently
> off is the documented Castellan mechanism — so **flag-gated and measured, or not at all.**

Observed in the sandbox: template 1 finished with field mappings on `page_number = 1` while ALL of
its `template_landmarks` rows sat at `page_number = 0` ("Northgate", "Description", "Terrace",
"invoice", "you"). Stage 0.5's registration transform buckets landmarks per page
(`template_mapper.py:566-572`) and fits per page, so a page-2 mapping whose page carries NO landmarks
gets no transform — it falls back to the anchor/absolute rungs with no drift correction, exactly the
position the 15 landmark-starved templates are in (see the audit entry below).

NOT PROVEN to misread anything — no page-2 mapping has ever been reprocessed. The questions that
were open (all three now settled in the box above):
1. Does `captureSampleWords`/`select_cross_sample` gather words from EVERY page, or only page 0?
   **ANSWERED: page 0 only, hardcoded in both paths, and the corpus table has no page column.**
2. Should the teach commit trigger landmark derivation for each page it taught a field on?
   **STILL OPEN — this is the remaining feature, and the only part still needing a decision.**
3. `templates/handler.js:242-253`'s backfill is existence-aware per TEMPLATE, not per page.
   **ANSWERED: confirmed, per template.**

**Also from the same run, fixed immediately:** an unconfirmed read-back survived a page switch, so
the panel offered "Value: Northgate Textiles — Looks right →" while the operator was looking at the
Larkspur page. Stored rows were always correct (the box's own page), so it was a trust defect rather
than corruption. Fixed + pinned in the same commit as this entry.

**Also observed, fixture artefact not a bug:** the template was named for the page-2 supplier but
fingerprinted on the page-1 letterhead, so genuine page-1-supplier documents were stamped with the
page-2 supplier's name. Only reachable because the test fixture deliberately staples two different
companies' invoices together; no real document does this. Worth knowing that template IDENTITY and
field GEOMETRY can be sourced from different pages.

---


