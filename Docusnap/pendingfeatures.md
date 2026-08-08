# Pending Features & Deferred Work

> Running backlog. When a feature/fix is discussed but NOT implemented right away, add it here with
> the notes/details agreed + anything pertinent (symptom, code pointers, the fix direction, gates,
> and any advisor rulings). Newest at top of each section. Remove an item when it ships (note the commit).

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

## 2026-08-08 — desktop security review (owner-supplied checklist) → SEC-17..SEC-22

Owner asked for an audit of a general Electron/Python hardening checklist against this app. The
detail lives in `SECURITY_BACKLOG.md` as **SEC-17 … SEC-22** (that file owns security items; this is
the pointer so the backlog reader finds them). Two were fixed in the same session, four are open.
**Note: `SECURITY_BACKLOG.md` is GITIGNORED and stays on the owner's machine only** — findings are
deliberately not published to the repo history, so this pointer is the only tracked record that
SEC-17..SEC-22 exist. Keep the two in step by hand.

**FIXED — SEC-17 (MEDIUM):** path containment was defeated by a Windows junction/symlink inside an
approved root. `path.resolve` collapses `..` but does not follow a reparse point, and `realpath`
appeared NOWHERE in `src/`. Now canonicalises both sides. **Only the OPEN path is fixed** — the
filing WRITE containment (`filing/handler.js:172`) and `navGuard.js:20` still compare textually and
each needs its own change with its own gate.

**FIXED — SEC-18 (LOW):** `nodeIntegration`/`sandbox` are now stated rather than inherited from
Electron defaults. Zero behaviour change; the point is that a future `webPreferences` edit cannot
silently flip them.

**OPEN — SEC-19 (LOW):** no IPC sender validation on any of 313 channels. Wants ONE shared
`assertSender` helper applied to the destructive handlers first, and an Oracle pass — a wrong
predicate would break every legitimate child window. Severity held down by the existing navigation
lockdown. **OPEN — SEC-20 (LOW):** no dependency CVE scanning (the licence gate is not a vuln gate).
**OPEN — SEC-21 (LOW, owner decision):** Python worker runs with the full user account.
**OPEN — SEC-22 (MEDIUM, owner decision — cost):** installer and binaries unsigned.

**Assessed and found ALREADY COVERED**, recorded so nobody re-opens them: `spawn` with a fixed
executable and an argument array everywhere (no `exec` of user input, `shell` false), scheme-
allowlisted `openExternal`, no `pickle`/`eval`/`yaml.load` and no HTTP server on the Python side at
all, comprehensive OCR DoS caps (300 pages / 500 MB / 10 000 px per axis / 300 s per-file watchdog
wired to a Settings control), no auto-updater to hijack, no archive extraction, no shipped
`openDevTools`. **Correction on the record:** the first pass of this review reported the OCR
resource limits as a probable gap. That was wrong — they exist and are thorough. Verified at source
before the write-up, which is the only reason it was caught.

---

## 2026-08-08 — teach/template anchor+value coverage audit: SIX defects VERIFIED AT SOURCE, none built yet

Owner goal for the day: "finish the teach wizard and template manager anchor and value detection;
verify all data types work, not a small subset; custom fields must detect the same as built-in;
keywords working 100%." A six-area code survey plus read-only live-DB censuses produced the below.
Each line was re-verified by reading the source — none is taken from a summary. **LIVE** = it is
biting the owner's current data; **LATENT** = the mechanism is real but nothing on this install
triggers it yet (still worth fixing, since the owner's ask is forward-looking).

**1. MOSTLY INERT — landmark starvation, 15 of 33 templates.** (Downgraded 2026-08-08 after 007
refuted the stated root cause: **13 of the 15 starved templates carry ZERO field mappings**, so
`_excludeBoxesFor` returned an empty list and the exclusion mechanism never ran on them. The real
causes are `sample_document_id IS NULL` plus fewer than 3 cross-sample docs for the zero-landmark
six, and the recurrence/stability/uniqueness stack collapsing for the one-landmark seven — which
have 6-13 documents of words already banked. SEPARATELY: `registration.MIN_VERIFIABLE_INLIERS = 3`
means a template with 1-2 landmarks has PERMANENTLY DEAD registration, not degraded — 9 templates /
202 docs dead, 6 templates / 121 docs never fitted. BUT landmarks feed ONLY Stage-0.5 mapping
relocation (verified: every consumer), so a template with no mappings pays nothing. Exactly ONE
template is actually paying today: **tpl 30, Larkspur Interiors PO — 3 mappings, 2 landmarks, 12
confirmed docs.** The backfill at `templates/handler.js:242-253` is existence-aware
(`NOT EXISTS ... template_landmarks`), so the seven 1-landmark templates are never revisited; making
it COUNT-aware would re-derive them from data already in the DB. **DO NOT ship that casually** —
turning a dead transform live can MOVE taught boxes, which is the documented Castellan mechanism
that overwrote a correct supplier read on 15 of 22 docs. Flag-gated and measured, or not at all.)
Census: landmark-count → templates =
`{0:6, 1:7, 2:2, 3:2, 4:1, 5:15}`. Six templates have ZERO (Copperfield ×2, Ironbridge, Vellum &
Crane, Thornbury, Stonegate) and therefore no registration fallback at all
(`registration_enabled=bool(template_landmarks)`). Root: `templates/handler.js:58-67`
`_excludeBoxesFor` pushes BOTH `target_*` AND `anchor_*` boxes into `exclude_boxes`, and
`ocr/landmarks.py:65-91` rejects any word overlapping one. The anchor box is the taught LABEL
CAPTION — printed chrome that recurs at a stable position, i.e. the ideal landmark. The docstring
conflates the two. `select_cross_sample` (`landmarks.py:123-137`) ALREADY excludes per-document
values independently (recurs in ≥60% of docs AND centroid stable within `pos_tol=0.015`), so the
geometric anchor exclusion looks redundant against values while being fatal to captions.
**NAMED SEAM, still unanswered:** fitting the transform on the same label the anchor path relocates
off CORRELATES the two rungs — registration stops being independent evidence. Candidate mitigation
(not yet judged): an "independence floor" requiring ≥1 landmark that is no mapping's taught anchor.

**2. LIVE — the bare-label guard is DEAD at Stage 0.5.** `anchor._crop_is_credible` takes a `label`
parameter that arms `_is_bare_label` at ~16 Stage-2 sites; both Stage-0.5 call sites
(`template_mapper.py:802`, `:806`) pass THREE arguments, so `label` is never supplied. Combined with
the absolute rung running `shape_mode='ignore'` and `validation_patterns.alphanumeric` scoring
coverage 1.0 on a plain word, a taught box landing on a CAPTION commits it at confidence 90 with
nothing able to object. This is the deeper root of the delivery-note class the 2026-08-07 arc chased
(`TEMPLATE_INLINE_ROW_OVERLAP` fixed WHICH ROW is read; this is why a caption is ACCEPTED at all).

**3. LIVE — 11 of 38 mappings carry a PHANTOM anchor** (`anchor_text` NULL, census). The teach
wizard, when `autoLabel` finds no label, still stores the mapping with a synthetic 0.12-page-wide
strip left of the value (`teach/renderer.js:998-1003`); downstream `_locate_anchor(needle=None)`
accepts the nearest line and base confidence drops 90 → 78. Root of the miss: teach's `autoLabel`
(`teach/renderer.js:902-997`) tries a LEFT band then an ABOVE band and RETURNS ON FIRST NON-EMPTY —
no scored contest — while the Review ⊕ tool uses the scored `pickLabelCandidate`
(`shared/anchorLabel.js:321-341`). Two different pickers; teach has the weaker one.

**4. NOT A BUG — a CAPABILITY GAP. The teach wizard is page-1-only.** (Corrected 2026-08-08 after
gary refuted the first draft of this entry, which claimed the hardcode caused a wrong-page read.)
`teach/renderer.js:409` resolves `getDocumentPages(...).then(pages => pages[0])` — there is no page
navigation, so the `page_number: 0` hardcode at `:1092` is TRUTHFUL, not corruption. You cannot teach
a page-2 value at all. The work item is therefore a FEATURE: render all pages, add navigation, and
replace the hardcode IN THE SAME COMMIT as the navigation — replacing it alone is a no-op at best.
It must land AFTER item 5, or an operator who teaches on page 2 cannot verify the mapping in either
admin surface and will "repair" a correct mapping by redrawing it.

**5. LIVE for two admin surfaces — "Show where it reads" is silently dead on page 2+.** (Upgraded
from LATENT: the Review wizard `review/renderer.js:7122` and the Settings Template Manager
`settings/renderer.js:3301/3506/3577` ALREADY SAVE `page_number: currentPage`/`tplCurrentPage`, so
both can create page-2+ mappings that extract CORRECTLY in production and cannot be previewed at
all. The teach wizard cannot — see item 4.) `template_mapper.py:530` does
`page_idx = mapping.page_number or 0; if page_idx >= len(page_images): continue`, while
`resolve_geometry` (`:592-630`) passes a ONE-element page list. Both callers already send exactly
the mapping's own page image (`settings/renderer.js` filters to `tplCurrentPage`;
`review/renderer.js` sets `page_number: currentPage`), so any page-2+ mapping is skipped and the
operator is told "Anchor not located / nothing read on this page" about a good mapping.

**6b. LIVE — the free-text guards are armed on the WRONG predicate, and one is fully dead.**
(Added 2026-08-08 from gary's review; my first mechanism was refuted — the truthy `val_type` does
NOT come from `_TYPE2VAL`, which deliberately omits text/multiline_text. It comes from the SHIPPED
config: `keyword_patterns.json` carries `"validation":"text"` on `supplier_name`:205,
`customer_name`:246, `payment_terms`:405, `buyer_name`:549 and `"multiline_text"` on
`supplier_address`:631, `customer_address`:646. Those SIX shipped keys are the whole affected set.)
`template_mapper.py:814/:820/:834` arm the OCR-debris guard, the name-quality guard and a conf floor
with `if not val_type`, while the sibling cap at `:878` correctly uses
`val_type in (None,'text','multiline_text')`. So those six BUILT-IN keys skip all three, while every
CUSTOM text field (`val_type` None) gets all three — the inversion, and it is the opposite way round
from what I first reported. **`val_type='text'` is the least-guarded state in the system** — weaker
than None, since `validation_patterns` has no `text` key either. Headline: `is_name_like_field` fires
on exactly `supplier_name`/`customer_name`/`buyer_name`/`*_address`, so **the name-quality guard is
dead for its entire intended population at Stage 0.5** while Stage 2 applies it to the same keys.

**6b-MEASURED (2026-08-08, after the fix was built) — the free-text guard population is TINY, so
the fix is correct in principle and near-inert in practice on this corpus. Do not oversell it.**
Built as `TEMPLATE_FREETEXT_GUARD_PARITY` + `TEMPLATE_FREETEXT_FALLTHROUGH_CAP` (`1f8ff9c`, both
dark). realdoc 714 docs, three arms — dark, parity, parity+cap — came back **BYTE-IDENTICAL to each
other**. A flat lane is not a pass here, so the flatness was chased to source with a reachability
probe over 24 documents drawn from the 11 templates that carry free-text mappings:

  supplier_name|hint_text_match  17     customer_name|anchor_crop      3
  supplier_name|logo              7     customer_name|template_mapping 1

**15 of 38 mappings are on a free-text key (11 supplier_name, 4 customer_name) — and `supplier_name`
was NOT ONCE read by a template rung.** Logo identification and hint-text matching outrank Stage 0.5
for the issuer, so the taught mapping almost never supplies the value. Exactly ONE template-rung
free-text read occurred in 24 documents. The guards are therefore REACHABLE but the population they
police is ~1 read in 24 docs, which is why every arm is flat.

> **CORRECTION 2026-08-08 (my own claim, from a DB-WIDE census — the 24-doc probe above was too
> small a sample to carry the bolded absolute).** "`supplier_name` was NOT ONCE read by a template
> rung" is true of those 24 documents and FALSE across the install. Full `extractions` census:
> `supplier_name` = hint_text_match 447, logo 128, template_fixed 113, **template_mapping 15**,
> template_identity_corroborated 9, template_identity 5, manual 4, +7 minor; `customer_name` =
> anchor_crop 98, anchor_crop_relocated 93, **template_mapping 22**, keyword 14, keyword_override 4,
> manual 1. So the free-text guard population is **37 template-rung reads DB-wide**, not ~1 in 24 —
> still small against the 688 non-template supplier reads, and the byte-identical realdoc arms still
> stand, but the ordering of magnitude is "small", not "zero". **Do not quote the absolute.** The
> conclusion is unchanged: correct in principle, low yield here, do not present as a heal.

> **NEW CENSUS FACT, and it re-scopes audit item 3.** The 11 PHANTOM-anchor mappings are **100%
> `supplier_name`** — every one of the other 27 mappings across 12 field keys carries a real
> `anchor_text`. So the "teach stores a synthetic strip when `autoLabel` finds nothing" defect has,
> on this corpus, bitten exactly the one field that template rungs almost never win (15 of ~731
> supplier reads). Item 3 is therefore a FORWARD correctness fix — teach's `autoLabel` really is the
> weaker of the two label pickers and should be unified with the scored `pickLabelCandidate` — but
> it is NOT the live drag the "LIVE" tag implies, and it must not be sold as one.

TWO CONSEQUENCES, both corrections to what was believed when the slice was designed:
- The fall-through cap's blast radius is FAR smaller than feared. The worry (mine, and Oracle's C-condition)
  was that capping `_inline()` would flag the issuer on the 11 dx=dy=0 supplier_name templates. It
  cannot: those mappings do not win the field. The two-flag split was still the right call — it is
  what made the effect measurable separately — but the danger it was hedging is not there.
- The guard-parity BENEFIT is correspondingly small on this corpus. The inversion is real, the dead
  name-quality guard is real, and both are worth fixing for correctness and for the owner's
  custom-vs-built-in requirement. But it will not visibly change results here, and nobody should
  present it as a heal. Its value is forward: a template whose taught box IS the winning source for
  a free-text field.

**6. LATENT — most data types have no Stage-1 reader, and picking the RIGHT type makes it worse.**
`keyword.extract_fields` (`:942-945`) skips a field with no `field_patterns` entry;
`seed_field_labels` (`:~338-364`) seeds only role `date`/`alphanumeric`, or role None AND DB type
EXACTLY `'text'`. The currency role is refused outright ("currency deferred"). So a custom field
typed Currency/Number/Email/Percentage/Postcode/IBAN gets no Stage-1 attempt, while the same field
left as Text would be read. Census: live field types are text 13, date 6, reference 1, currency 1
across 6 types (3 user-made); the single affected field is `total_amount`, a SHIPPED key, so the
hole is latent — **do not sell this as an active incident.** Related: four divergent "is this a
reference field" predicates (`engine.py:1237-1243`, `keyword.py:58-66`, `validator.py:~299`,
`review/renderer.js:46-49`) and the fact that the type's DECLARED `ref_field_key`/`date_field_key`
role never reaches Stage 0.5 at all — only the key SPELLING does.

> **DESIGNED 2026-08-08 (gary), and it CORRECTS TWO OF MY CLAIMS ABOVE. Not built — reggie's
> precision ruling and an Oracle pass are still outstanding.**
>
> **CORRECTION 1 — my worked example was wrong, and it was wrong in the flattering direction.** I
> said a field labelled "Discount" typed Percentage gets no reader. `discount` is a SHIPPED
> `field_patterns` key (`config/keyword_patterns.json:355`), so it dies at `keyword.py:340-341`
> (`key in shipped`) long before the type test and is rescued. Same for `currency`, `shipping`,
> `subtotal`, `payment_terms`. The genuinely unattemptable examples are **"Unit Price" → key
> `unit_price`, type `currency`** and **"Account" → key `account`, type `reference`** — both have
> `_infer_validation` = None and a non-`text` type. Use those; the "Discount" example would have
> been refuted the moment anyone tested it.
>
> **CORRECTION 2 — this is NOT as latent as I filed it, because the editor STEERS users into the
> hole.** `doctype-editor.js:77-79` `guessType` auto-selects `currency` for any label matching
> `/total|amount|price|cost|sum|net|gross|vat|tax/` and `reference` for
> `/ref|reference|number|no|invoice|order|po|account/`. So a user typing "Unit Price" or "Account"
> is GIVEN the broken type by default, without ever opening the dropdown. It is latent on this
> install because few custom money/code fields exist, not because the types are rarely chosen.
>
> **Also established:** `merge_label_overrides` (`keyword.py:273-281`) already seeds ANY key
> regardless of DB type — so the ADMIN-OVERRIDE path already does what the DB-label path refuses to,
> which is the real inconsistency. `PRESET_CATALOG` fields ARE rescued (their `labels:[]` flow
> through the same override path), so the hole touches only types made in the **DocType editor** and
> the **teach wizard**. `ROLE_KEY_ALIASES` rescues exact money aliases (`net_amount`, `amount_due`)
> but not `unit_price`/`handling_charge`/`discount_amount`.
>
> **FIX SHAPE:** extend only the fall-through branch (leave the date/alphanumeric role branches
> first and untouched, which keeps `vat_no`/`account_no`/every `*_date` byte-identical); take the
> gate from a NEW leaf module `extraction/field_types.py` that `engine._TYPE2VAL` re-exports **by
> object identity**, so the mapping cannot fork into a 4th copy; 80 for gated types, 75 for
> flag-only, no new confidence band. Flag `SEED_TYPED_FIELD_LABELS`, env-read, **DEFAULT OFF**.
>
> **THE TRAP GARY CAUGHT, and it would have shipped:** `role_caption:'party'` must NOT be applied to
> the new typed seeds. `_PARTY_FOLLOW_STOP` (`keyword.py:1330-1340`) contains `email`, `website`,
> `address`, `number`, `no`, `account`, `vat` — so a field labelled "Email" with `party` would
> REFUSE to read `Email Address: info@acme.co.uk`, its single most common printed caption. Same for
> Website and for Account typed `reference_code`. Absent `role_caption` is the design; the
> fail-toward-review rail is `trust.js` `STRICT_TYPES` (`:86-89`), which already re-validates
> email/postcode/percentage/number/reference_code/iban/vat_gb on the sub-100 auto-file path.
>
> **THE SEAM, and it must be an owner-visible decision rather than a silent side effect:** a
> newly-seeded read at 80 becomes an INCUMBENT. A fresh passive anchor scores 78 at usage_count 1
> (`anchor.py:1349`) and an anchor read that was CAPPED TO 70 AND NOTED scores lower still — so the
> keyword read wins **and the anchor's `validation_note` disappears with it**. A document that used
> to hold for review can then auto-file. Mandatory gate measurement: count docs where a winner moved
> `anchor* → keyword` while the anchor arm carried a note. Non-zero ⇒ does not ship without the owner.
>
> **VACUITY — worse than the trap already recorded.** All four `customer_corpus_score.js` EXTRAS
> (`vat_no`, `account_no`, `job_ref`, `po_ref`) are rescued TODAY by the key-role branch (`_no`,
> `_ref`), so a corpus arm is STRUCTURALLY INCAPABLE of moving. The generator needs eight new
> role-None fields (`unit_price` currency · `pallets` number · `account` reference · `ticket`
> reference_code · `contact_email` email · `discount_rate` percentage · `delivery_postcode`
> postcode_uk · `bank_iban` iban), and the DARK arm must be asserted at 0.0% recall on every new
> lane BEFORE the fix is measured. This is the concrete answer to Oracle's earlier "DO NOTHING —
> cannot be gated non-vacuously without a generator change".
>
> **REGGIE'S PRECISION RULING (2026-08-08) — the two advisors AGREE on the trap, independently.**
> reggie reached the `role_caption` verdict by the same `_PARTY_FOLLOW_STOP` mechanism gary did, from
> a different starting point, and adds the rule that makes the widening safe at all:
>
> - **POPULATION A — `email`, `website`, `postcode_uk`, `vat_gb`, `iban` — a bare label hunt is
>   STRUCTURALLY unsafe, not merely risky.** `_search_for_label` scans TOP-DOWN and returns the FIRST
>   accepted occurrence (`keyword.py:1455-1457`), and the letterhead is at the top — so the issuer's
>   email/VAT/postcode does not *sometimes* win a customer-side field, it wins on EVERY document.
>   Identical mechanism to the VAT-reg-as-money incident. The shape gate cannot help: the issuer's
>   email is a perfectly valid email. **Rule C1** — seed these five ONLY if the DB label carries ≥2
>   content tokens with at least one outside the generic type-noun set, so "Email"/"VAT Number" are
>   REFUSED (teach-only, as today) and "Customer Email"/"Supplier VAT Number" are seeded. Mirrors the
>   shipped `PRESET_CATALOG` doctrine at `document_types.js:540-542`. **Rule C2** — those five seed
>   `directions:["right"]` only; "below" from a generic caption walks into the next letterhead line.
> - **POPULATION B** (percentage, mac, ip, number, currency, reference, reference_code, date, text):
>   bare own-label hunt is acceptable; existing `len(label)<3` + sibling dedupe already suffice.
> - **Gate Stage 1 for all 11 structured types.** This does NOT contradict review-not-reject: a
>   Stage-1 rejection discards a candidate the hunt just invented from a bare label and Stages 2/0.5
>   still run afterwards, whereas a `_TYPE2VAL` rejection discards the value the operator physically
>   pointed at. Different decisions. Keep the six flag-only types OUT of `_TYPE2VAL`.
> - **A correction to the doctrine as filed:** "review-not-reject covers them" is only two-thirds
>   true. For those six the BACKEND never evaluates the regex at all (`_val_key` is None; they are
>   not in `_PRECISE_VAL_TYPES`), and the Stage-4.5 charset note flags CHARACTERS, not content — a
>   wrong-but-well-formed email gets no note anywhere. The enforcement is `trust.js` `STRICT_TYPES`
>   at the filing boundary, which is skipped `at100`. Widening seeding WITHOUT gating would add
>   silent wrong values nothing surfaces.
> - **THE AUTO-FILE SEAM, and it cuts against the owner's standing rule.** `docTrustGate` returns
>   `unverifiable-value:<field>` for a value in a field with no confirmed history in scope
>   (`trust.js:586`), so filling MORE fields REDUCES auto-file on cold scopes until history accrues —
>   the same shape as the `TRUST_SHADOW_ROW_SKIP` deadlock, and directly opposed to
>   `feedback_minimal_interaction_autofile`. **The gate for this slice must count AUTO-FILE, not fill
>   rate.**
>
> **THREE LIVE DEFECTS reggie found in passing — each is a bug TODAY, independent of the widening,
> and each is separately shippable:**
> 1. **`validation_patterns.iban` rejects every conventionally-spaced printed IBAN.** `GB29 NWBK 6016
>    1331 9268 19` fails. Live consequence: `trust.js:169` strips whitespace before the mod-97 check
>    and PASSES the value, while the renderer's on-blur scores 0% coverage and WARNS on the same
>    correct value. Proposed: `^[A-Za-z]{2}\d{2}(?:[ ]?[A-Za-z0-9]){11,30}$` — bounded, no nested
>    repetition, still `^…$` so the anchored-pattern pin holds.
> 2. **`validation_patterns.ip_address`'s IPv6 leg is wrong in BOTH directions.** It ACCEPTS
>    `09:30:15` — a clock time — and `ip_address ∈ _PRECISE_VAL_TYPES` (`anchor.py:2503`), so at ≥95%
>    coverage that time would be graded TYPE-AUTHORITATIVE and skip the charset and learned-shape
>    checks. It also REJECTS `fe80::1`, the example the UI itself prints at `doctype-editor.js:53`.
> 3. **`_infer_validation` is consulted BEFORE the DB type** (`keyword.py:342-343`), so a field
>    labelled "VAT Number" typed `vat_gb` is seeded TODAY with the generic ref caption bank
>    `["Reference No","Reference","Ref No","Ref"]` and the loose `alphanumeric` gate — the user's
>    explicit type declaration is ignored in favour of the key spelling. reggie's ruling: DB type
>    wins for the 11 structured types; key-role is retained only for `text`/untyped.
>
> **CURRENCY SIGN — my cited lines were STALE, correcting them here.** Not `keyword.py:1647-1651`
> (that is `_is_doc_chrome_fragment`). Two independent losses: `:1509` strips a leading `-` as a
> separator, and `:1768-1772` `_clean_value` returns `m.group(0)` of the first matching
> `validation_patterns.currency` alternative — **no alternative admits a sign at all**. Fix is a `-?`
> in alternatives [0] and [3] (strictly looser, so every currently-matching string still matches, and
> `currency` routes to `_currencyDpConsistent` not `_matchesTypePattern`, so the filing gate is
> untouched) plus a sign-aware separator strip.
>
> **SEQUENCING:** ship the gated non-money types + flag-only first; **split CURRENCY into slice 2.**
> `_total_role_collision` is armed by the label text being exactly `'total'` (`keyword.py:1447`), not
> by the money role, so a custom currency field labelled "Total Due" seeded at 80 can grab the wrong
> totals-block line — which is why the original author wrote "currency deferred". Also gate against
> `TEMPLATE_FORMAT_FAIL_YIELD` before either flips: it is inert on typed custom fields today only
> because they have no keyword challenger, and this fix gives them one.

**Also confirmed:** `template_field_mappings.ocr_type` is written by three UI surfaces with three
different vocabularies and read by ZERO production code (`grep ocr_type python_backend/` finds only
tests and the dev CLI `test_mapping.py:75-80`) — production `val_type` comes from
`engine._seed_field_patterns(base, field_defs)` keyed on the TYPE's field definitions. Owner
decision needed: wire it or delete it. And Stage 0.5's terminal cleaner
(`template_mapper._clean_value` → `anchor.clean_crop_segment:2670`) returns the FIRST LINE ONLY, so
a `multiline_text` taught mapping structurally cannot return an address (latent: no live address
mapping exists).

Specialist review was commissioned on items 1+2 (geometry/OCR) and 6+5 (Python design + test
strategy) before any build; nothing above has been implemented.

---

## 2026-08-07 — New doc type should seed its own keyword bucket + teach must mirror the Settings type editor (owner-raised, NOT BUILT)

Two related gaps the owner hit while creating types. Both are about the SAME thing: a type created outside
Settings is a second-class citizen.

**(1) A newly created doc type does not appear in the keyword list.** When the user adds a document type,
its NAME should be seeded into the keyword bucket for that type so it is visible (and editable) on the
keywords screen. Today detection scores types from the SHIPPED `config/keyword_patterns.json`
`document_type_keywords` buckets, which exist INDEPENDENTLY of the types an install actually has
(`database/index.js:1029`, `src/modules/processing/handler.js:43`, and pinned in
`database/modules/test_detected_type_nudge.js` + `src/windows/review/test_review_untyped_reason.js`).
So a custom type starts with NO keyword bucket of its own and the user cannot see or tune what detects it.
Seeding the type's own name is the minimum; the type's `title_aliases` ("Also appears as" chips) are the
natural second source, since an install-created type is identified by its ALIASES, never its internal name.
LEADS / CARE: the shipped buckets are per-install config, and a custom type's keywords must be stored
per-install (never packaged — see `project_customer_config_never_packaged`). Check whether seeding belongs
next to the existing `field_label_overrides` seeding in `addPresetTypes`/`create-doc-type-with-fields`
(`database/modules/document_types.js`), which already does exactly this shape of work for FIELD labels.
Do not let a seeded bucket silently widen detection for an install that never asked — decide whether the
seed is active or merely visible-and-empty until the user fills it.

**(2) The teach wizard's "create a type" must mirror the Settings type editor.** `src/windows/teach/renderer.js:254`
already notes it creates the new type "via the shared editor", so the seam is narrow — but the owner reports
the two surfaces do not offer the same options. Bring the teach path to parity with Settings → Document Types
(fields, structural roles, and whatever (1) adds), so a type taught into existence is identical to one created
in Settings. Verify at source which options actually differ before designing — do not assume from the UI.

Owner-raised 2026-08-07 during the credit-note totals session; not investigated beyond the pointers above.

---

## 2026-08-07 — Credit-note totals: the sign note is PRE-EMPTED, and the reconcile false-flags every signed credit note (NOT BUILT)

Found while the owner eyeballed the first live batch with `credit_sign_coherence` ON (Castellan credit
notes, docs 705-726, template 32). Both items measured against the LIVE DB, read-only. Neither is
caused by the flag; the flag made them visible.

**FIRST — a premise correction that changes the scope of credit-note slice A.** The 08-07 handover says
the minus sign is destroyed at READ. That is TOO BROAD, and slice A should not be designed off it.
MEASURED across the 20 docs in the batch carrying a total:
```
17 totals SIGNED correctly ('-270.60', '-1,025.64', '-1,885.32')  -> ALL method template_mapping
 3 totals POSITIVE (sign lost)                                    -> #721 '1,571.52' and #722
                                                                     '1,566.12' are method keyword
```
So the taught Stage-0.5 `template_mapping` read PRESERVES the leading minus; the Stage-1 `keyword`
path is where it dies (`keyword.py:1647-1651`, the site gary caught). Chris's sandbox produced 16/16
positive because those documents were never TAUGHT, so every read came through the keyword path — the
sample was homogeneous in exactly the variable that matters. Before building slice A, re-measure which
read sites actually lose the sign on a mixed taught/untaught set; the shared-config fix direction
(`validation_patterns.currency` + the `anchor.py:2753` strip-set) still looks right, but the claimed
blast radius does not.

**(1) — PARTLY RESOLVED 2026-08-07 by the VAT-reg fix (`d575668`), for this class only.** With the
phantom tax gone the arithmetic note no longer fires on these documents, so the sign arm reaches
them: live `#722` (+1,566.12) now carries "this looks like a credit note but the total is positive"
instead of the misleading arithmetic note. **The underlying pre-emption is NOT fixed** — the
single-valued note chain and the `validator.py:727` guard are unchanged, so any OTHER note arriving
first still silences the sign check. `2a1ae7d` added a targeted precedence rule for ONE new
pre-empter (the net-misread note, Oracle C1 — it abstains when the sign arm would speak); every
other writer is untouched. Keep this entry open: the general fix is still a ruling on the note chain.

**(1) The sign check never runs on a field that already carries a note — `validator.py:727`.**
```python
if not str(_td.get("validation_note") or "").strip():      # never erase an existing flag
```
Section 2's arithmetic reconcile runs FIRST and writes "the total doesn't add up against the line
amounts — please check" onto the total. On #721/#722 — credit-note typed, total positive, i.e. the
exact class slice C exists to catch — the sign arm is therefore skipped. VERIFIED: zero notes in the
whole DB mention credit/sign/minus/negative, with the flag ON.
Not a safety hole (the doc is still flagged and still blocked from auto-file and from File All Ready),
but the operator is told the WRONG THING: "the arithmetic is off" when the defect is a missing minus.
It also makes the flag look inert when it is merely pre-empted — do not conclude from a silent DB that
slice C does not work.
FIX DIRECTION (needs a ruling, do not just reorder): the note chain is single-valued, and "never erase
an existing flag" is a deliberate, load-bearing property. Options: (a) let the sign note APPEND rather
than replace (the pinned note-chain pattern used by D1's digit-disagreement note); (b) give the sign
check precedence over the reconcile note specifically, on the grounds that a sign incoherence EXPLAINS
the arithmetic failure and is the more actionable message; (c) leave the note, add the sign fact to the
trace only. (b) is the most useful to the operator and the most invasive. Advisor + Oracle before build.

**(2) — SHIPPED DARK 2026-08-07, gate green, awaiting the owner flip.** `VAT_REG_NOT_AMOUNT`
(`d575668`) + bridge/paired toggle (`60606d9`) + Oracle's two blocking conditions (`2a1ae7d`).
Paired with `NET_MISREAD_TOTAL_FLAG` behind ONE Settings row, because removing the phantom tax also
disarms `validator.py:673` (which needs a tax present) and a net-as-gross total would lose a TRUE
flag. Measured as production runs it: **false alarms 39 -> 0, true flags 16 -> 26**. Full reasoning,
both Oracle rounds and every gate number: `docs/oracle_log.md` 2026-08-07.
**Named residual (nothing owns it today):** `Harrowgate-Timber_quote_0046.pdf`, total `L922.14` — an
OCR garble that loses its (accidental) flag. Its owner, the format-fail-yield slice, is DARK, and
`trust.js:486-495` routes currency to `_currencyDpConsistent` ONLY — which `L922.14` passes —
without ever consulting `_currencyish`. The right-layer fix is one line (require `_currencyish(v)`
before the dp check; it can only ever BLOCK, never file more), separate change, own gate.
The original diagnosis is kept below because the mechanism is the reusable part.

**(2) The "doesn't add up" flags are a VAT REGISTRATION NUMBER read as a TAX AMOUNT — not a sign
problem at all.** CORRECTED 2026-08-07 after measuring the components; the first version of this entry
claimed the reconcile compares a negative total against a positive subtotal. **That was WRONG and is
retracted** — `CURRENCY_RE` carries no `-`, so `parse_amount('-270.60') == 270.60` and the reconcile
has always worked on MAGNITUDES. The sign is invisible to it. (Retained deliberately: the same
sign-blindness is what makes `parse_amount` unsafe to "fix" in place — see slice B.)
THE ACTUAL MECHANISM, measured across the batch:
```
doc    total    subtotal   vat_tax     sum      delta     tol    verdict
705   270.60     225.50    0027.84   253.34     17.26    5.41    NOTE
709   989.76     824.80    0027.84   852.64    137.12   19.80    NOTE
721  1571.52    1309.60    0027.84  1337.44    234.08   31.43    NOTE
718   160.32     133.60    0027.84   161.44      1.12    3.21    reconciles (BY LUCK)
```
`vat_tax` is **`0027.84` on all 13 docs that captured one** — an identical constant, conf 90, method
`shadow_reconcile`. It is the LETTERHEAD's VAT registration number: `VAT Reg GB 651 0027 84` ->
`0027 84` -> `0027.84`. It is also the ONLY `vat_tax` value in the entire live DB. So `subtotal + tax`
is short by the real VAT every time and the reconcile correctly reports that the maths fails — it is
being fed a poisoned component, and the note, while useless to the operator, is not itself wrong.
#718 "reconciles" purely by coincidence (133.60 + 27.84 = 161.44 vs 160.32, inside a 3.21 tolerance) —
that is the SAME doc the validator's own comment cites as having AFFIRMED a sign-wrong value. The
7 docs with no captured subtotal skip the guard entirely and carry no note.
WHY THIS IS A SYSTEM BUG, not a Castellan bug: any supplier printing a VAT registration number in the
letterhead is exposed, and a registration number is a stable per-supplier constant, so the wrong value
is CONSISTENT — the most dangerous shape, because consistency reads as corroboration to anything
downstream that counts agreement.
FIX DIRECTION (reggie-shaped, precision-first — a VAT REGISTRATION NUMBER IS NOT AN AMOUNT):
(a) reject a `vat_tax` candidate whose label context is a registration identifier — `VAT Reg`,
`VAT Reg No`, `VAT Registration`, `VAT No` — as opposed to an amount caption (`VAT @ 20%`, `VAT`,
`Tax`); (b) reject the zero-padded `0027.84` FORM outright (money is not printed with a leading zero
pair; this is a digit-group artefact of `651 0027 84`); (c) treat a `vat_tax` identical across many
documents of one supplier as suspect. (a) is the root fix and the other two are cheap corroboration.
Do NOT reach for a tax-vs-subtotal ratio band alone: 27.84/225.50 is 12%, which passes any plausible
band, so that check would not have caught this.
GATE: the Castellan batch (expect the ~12 spurious notes to clear, #718's lucky reconcile to become an
honest one, and no new notes on the 7 subtotal-less docs) + realdoc `armed==baseline` + the customer
corpus total lane, which must not move.

**Also seen in the same batch, not investigated:** #724 total reads `'—-1,455.12'` (an em-dash glued
ahead of the minus — a read-layer debris class, not a sign bug); #715 is a `Castellan-Security_credit_note_*.pdf`
typed **Invoice** with `heading_absent_reread` ON (already confirmed, so it may predate the flip —
check before treating it as a heading-detection miss).

**Repro (read-only, live DB `%APPDATA%\ScanFinder\docusnap.db`):** the three probes are in the session
scratchpad — flags + issuer lineage, totals + notes across 705-726, and the type/note census that
proves the sign arm never fired.

---

## 2026-08-06 — Registration follow-ups after the Castellan incident (NOT BUILT; owner-raised + Oracle C5/C7)

Context: the Castellan supplier corruption is FIXED by the shared vacuous-fit gate
(`registration.is_unfalsifiable`, both call sites). These are the follow-ups that would stop the class
recurring, or make registration WORK rather than merely go quiet. Ranked. **Do not build any of these
off the Castellan exemplar alone** (standing Oracle ruling on registration work).

**(0) `pos_tol` IS TIGHTER THAN THE PAGE JITTER IT MUST TOLERATE — the dominant filter. HIGHEST VALUE.**
MEASURED by replaying `select_cross_sample` over template 32's real corpus (160 words / 4 docs):
```
'security' 4/4 spread=0.0213   'systems' 4/4 0.0218   'bastion' 4/4 0.0208  (ADDRESS)
'house,'   4/4 spread=0.0214   'keep'    4/4 0.0219   'reg'     4/4 0.0213
'vat'      3/4 spread=0.0211   'note'    4/4 0.0188  (the TYPE NAME)  'account' 4/4 0.0166
'deliver'  4/4 spread=0.0146 -> SURVIVES      'qty' 3/4 spread=0.0063 -> SURVIVES
```
EVERY header word clusters at ~0.021 spread. That uniformity is the tell: the words are not moving
independently — the WHOLE PAGE shifts ~0.021 between scans. `select_cross_sample`'s `pos_tol=0.015`
sits just UNDER that, so it rejects the entire letterhead (supplier name, address, VAT/reg line) AND
the document title, then keeps whichever two words happened to jitter least in a 4-doc sample —
`deliver` and `qty`. They survived on measurement noise, not merit, and two landmarks is precisely
the degenerate case that yields an unfalsifiable fit.
THE DEFECT (owner-diagnosed): page shift is NORMAL for scanned documents — glass vs feeder, paper
registration is never perfect — so a landmark's COORDINATE must be an OUTPUT of finding it, not the
criterion for CHOOSING it. The read path already works that way (`_fit_page_transform` text-locates
each landmark via `_locate_anchor`, tight box then page-wide, and uses wherever it lands). Only the
SELECTOR still thinks in fixed coordinates, and that mismatch is the bug: it rejects stable chrome
BECAUSE the page shifted, which is the very thing registration exists to correct.

PROVEN by de-meaning the per-document global offset on the real corpus (measured scanner shift
between these 4 docs: dx 0.0000 / -0.0204 / -0.0076 / -0.0129):
```
word        RAW    verdict     DE-MEANED  verdict
security   0.0213  REJECTED  ->  0.0009    ok
note       0.0188  REJECTED  ->  0.0017    ok     (the TYPE NAME)
systems    0.0218  REJECTED  ->  0.0024    ok
reg        0.0213  REJECTED  ->  0.0036    ok
account    0.0166  REJECTED  ->  0.0039    ok
bastion    0.0208  REJECTED  ->  0.0055    ok     (ADDRESS)
house,     0.0214  REJECTED  ->  0.0079    ok     (ADDRESS)
keep       0.0219  REJECTED  ->  0.0093    ok     (ADDRESS)
pack       0.0592  REJECTED  ->  0.0591  STILL REJECTED   (line-item text: genuinely floats)
pir        0.0956  REJECTED  ->  0.0955  STILL REJECTED   (line-item text: genuinely floats)
```
**Landmarks 1 -> 9.** CRITICAL PROPERTY: de-meaning rescues the chrome WITHOUT admitting a single
floater — `pack`/`pir` move 0.0592 -> 0.0591, i.e. it cleanly separates "the PAGE moved" from "the
CONTENT moved", which is exactly the distinction the raw test cannot make. This also removes the
degenerate 2-landmark case AT SOURCE rather than catching it downstream in the vacuous-fit gate.
FIX DIRECTION: estimate a per-document global offset (median displacement over words common to all
sample docs) and measure the RESIDUAL spread against `pos_tol`. Do NOT simply raise `pos_tol` — that
would admit the genuine floaters (`TOTAL`, line-item text) the tolerance correctly rejects today.
This outranks (1): position-instability alone rejects `keep`/`reg`/`note`/`vat`/`account`, none of
which are inside a taught box.

**(1) LANDMARK STARVATION — narrow `_excludeBoxesFor` to VALUE boxes only. HIGH VALUE.**
`src/modules/templates/handler.js:58-67` pushes BOTH `target_*` and `anchor_*` of every mapping into
`exclude_boxes`, so `select_landmarks`/`select_cross_sample` may not use any taught LABEL as a
landmark. On template 32 that disqualified the letterhead band AND all three captions
(`CREDIT REF`, `CREDIT DATE`, `TOTAL`), leaving only body text — which is why cross-sample, running
with 4 confirmed docs, still returned just `DELIVER` + `Qty`. MEASURED: `CREDIT REF`/`CREDIT DATE`
relocate within **0.0005** of page across these docs (ideal landmarks) while `Qty` cannot be found in
its own taught box. `TOTAL` floats −0.031..−0.111 with line-item count, but `select_cross_sample`'s
`pos_tol=0.015` rejects floaters automatically — so letting labels compete is SAFE.
SEAM (answer before building): if the transform is fitted on the same label the anchor path uses to
relocate a field, the two rungs stop being independent and their errors correlate. Options: allow
label zones only for landmarks NOT consumed by an active mapping on the same field, or allow them and
accept the correlation for the registration rung only.

**(2) ASK FOR A SECOND DOCUMENT (owner-raised).** The plumbing already exists and is PASSIVE:
`captureSampleWords` (reviewService.js:325-330, on confirm) → `tryCrossSampleLandmarks`
(handler.js:105, gated `countSampleDocs >= 3`) → `select_cross_sample`. Nothing ever ASKS the operator
for a 2nd/3rd sibling. UX addition, no new matching machinery: after a teach that yields a thin
landmark set, invite the customer to drop in another doc of the same type "so the system can learn the
layout" — explicitly NOT a re-teach. Pairs with (3): the thin-set condition is the trigger.

**(3) REFUSE TO STORE A <3 LANDMARK SET (Oracle C5, the durable fix).** A set of <3 can only ever
produce an unfalsifiable fit (see `registration.is_unfalsifiable`), so persisting one arms a transform
that the read path must then refuse at runtime. Either refuse to persist it or mark the template
registration-ineligible until cross-sample supplies >=3, and say so honestly (engine.py already knows
the phrasing: "registration inactive — template has no landmarks"). Census at the time of writing:
6 templates have 0 landmarks, 7 have 1, 3 have exactly 2 (tpl 9, 30, 32).

**(4) REGISTRATION AS A WITNESS, NOT AN AUTHORITY (owner-designed; the real architectural fix).**
Owner's model: treat the drawn-box read, the keyword/label read, the logo identity and the fitted
transform as INDEPENDENT WITNESSES and require corroboration ("2 of 3") instead of letting the
transform OVERTURN the operator's box. Why it is right: `anchor_stable` can only be set when a mapping
has `anchor_text`, so a LABEL-LESS mapping (every `supplier_name`) can never defend its own absolute
read — which is exactly how the Castellan junk committed. MEASURED support: in the incident the system
already held TWO correct independent witnesses and used neither — the taught box read
`Castellan Security Systems` on 5/5 docs sampled, and the logo resolved the same supplier at conf 89 on
the one doc with no template (tpl 32 also stores 3 logo hashes; `logo_fingerprints` match_count 3).
Prior art to build on, NOT duplicate: `decide_logo_text_gate` + `LOGO_NAME_PRESENCE_ACCEPT`
(engine.py:955-990) already implements "logo + an independent geometry name read that AGREES confirms
the identity". HARD CONSTRAINT from project history: a logo must NEVER assert alone (pHash is a LAYOUT
signature, same-logo siblings collide, degrades on scans) — it may be one vote, never the deciding one.

**(5) ROTATION-LOCKED / OVERDETERMINED FIT (owner-designed).** A similarity fit is 4 DOF, so 2 points
are exactly determined and the residual is 0 BY CONSTRUCTION — that is what makes a 2-inlier fit
unfalsifiable. On a straightened page, CONSTRAIN rotation (and optionally scale): 2 points then give 4
equations against 2-3 unknowns, the fit becomes OVERDETERMINED, and the residual becomes MEANINGFUL —
a bad correspondence can no longer hide. This is the right shape for any future registration rebuild.
CAVEAT MEASURED: on the Castellan pages a rotation-locked fit was ALSO wrong, because the INPUT
correspondence was false rather than the model being unsuitable — so this fixes falsifiability, not
bad inputs. Pair with (1) and Oracle's deferred rotation-plausibility gate (|theta| <= ~12deg, which
catches the n_inliers>=4-false-inlier corner where confidence reaches 95 and clears the 88 floor —
the one cell neither the vacuous-fit gate nor a landmark witness reaches).

**(6) `_fit_page_transform` FRAME ERROR (deferred slice).** `dst` is built from the located LINE-box
centre (`found["x_norm"] + found["w_norm"]/2`) while `src` is the taught WORD centre — measured
0.0119-0.0182 on this template, and up to half the line width where a landmark heads a wide row. A
systematic per-landmark bias against a 0.02 inlier band, i.e. a manufacturer of the n_inliers==2
collapses the gate now refuses. `found["label_box"]` is the tight word box — but note it is built by
`_match_label_run` using the SAME `_label_score` at the SAME threshold, so it is not an independent
witness, only a better centre. Own switch, own gate.

**STALE ENTRY CORRECTED (Oracle C7):** the older "S-D registration fit audit" entry reads as an open
investigation. H1 (n<=2 vacuous fit) was MEASURED (~43% of docket fits collapsed to 2 inliers) and the
`REG_MIN_INLIERS_GATE` shipped default-ON 2026-08-01 at engine.py's Stage-2 site — and, from
2026-08-06, at the Stage-0.5 site too via the shared predicate. Do not re-investigate it.

---

## 2026-08-06 — `_label_score` partial credit lets a PROSE line outrank a 1-glyph-garbled true caption (NOT BUILT — larger lever)

**Symptom (traced, live, deterministic).** The PAGE-WIDE fuzzy locate in
`template_mapper._inline_code_reconcile` (`template_mapper.py:1037`, `expansion=1.0`) selects the
document's FOOTER SENTENCE as the `'Order No.'` label. On the Larkspur Interiors purchase_order template
(id 30, mapping `po_number`, `anchor_text='Order No.'`) the harvested inline token is
`"on all correspondence and delivery notes."`, `inline_val` comes back null, `_pick_fuller_code` returns
None, and the reconcile declines — leaving a clipped absolute read (`PO-48009` → `-48009`) to commit
unchallenged at confidence 90 with no note.

**MECHANISM — verified by logging every scored line (do NOT restate this as a plain "footer
false-match"; the interesting part is WHY the footer wins):**
```
0.8750  please supply the goods above and quote our order number on all correspondence and deliver
0.7500  purchase order orden no. eo          <- the REAL caption: OCR read "Order" as "Orden"
0.7500  ee order date 08/03/2026
```
- `_label_score('order no.', ...)`: `_core` strips the trailing `.` → needle `'order no'` (len 8).
- The word-boundary branch (`:2644`) misses, and the `if needle in haystack: return 0.0` guard
  (`:2657`) does **NOT** fire — `'number'` begins `n-u`, so `'order no'` is genuinely *not* a substring
  of `'order number'`. (Two reviewers independently misread this; check it before rebutting.)
- So the footer falls through to the partial-credit branch `max(longest/len(needle), ratio())`
  (`:2659-2661`): longest contiguous run `'order n'` = 7/8 = **0.875**, over `_FUZZY_MATCH_THRESHOLD`
  0.6, and it BEATS the true caption's 0.75.
- The caption scores only 0.75 because OCR misread one glyph (`Order` → `Orden`). Its own value is
  garbled to `eo` on this doc, so that row was unreadable regardless.

**The defect, stated precisely:** a long unrelated PROSE line can out-score a slightly-garbled genuine
caption, because partial credit is computed against the NEEDLE's length only and carries no penalty for
the haystack being a 17-word sentence rather than a caption.

**Impact.** `_inline_code_reconcile` is the designed recovery ladder for a LABELLED taught code box; on
this template it is inert on **7 of 8** docs (only #638 matched the real caption
`"PURCHASE ORDER Order No, PO-20008"` at 1.0). Also implicated in #630's `R7_late_relocate` clip
(`914` for GT `PO-91914`) — the same locate feeds `_relocate_and_read`, and #630 is the more suspicious
of the two failures. Expect recurrence across suppliers: `"quote our order number on all
correspondence"`, `"please quote invoice number"`, `"state your account number"` are normal PO/invoice
footer boilerplate, so this is not a Larkspur quirk.

**Evidence / repro.** Per-doc rung trace over `stress_test/crop_recipe_sweep.js` (8 Larkspur PO docs,
owner flags ON, 2026-08-06). Repro: log the sorted `scored` list inside `_locate_anchor` just before
`best_score` (`:2448`) for needle `'order no.'`.

**Why NOT fixed here.** Out of the 2026-08-06 task's fixed scope (that task ships the R6 pad-window
backstop). `_label_score`/`_locate_anchor` are shared by every template and every field — the blast
radius needs its own design + advisor gate.

**Fix direction (UNVETTED — no advisor has reviewed this).** Penalise partial credit by how much of the
HAYSTACK the match explains (a caption needle explaining 8 of 95 chars of a prose line is not a
caption); and/or require a boundary-aligned whole-needle hit before accepting a page-wide
(`expansion=1.0`) locate; and/or make proximity to the taught `anchor_box` a tie-break at a WIDER
epsilon than the current exact-tie `_SCORE_TIE_EPSILON` (1e-6), so 0.875-vs-0.75 across half a page
cannot silently pick the far line. Note `_match_label_run` already tightens WITHIN a line — the defect
is line SELECTION.

**Seam to name before building.** `_locate_anchor` at `expansion=1.0` is the "the label moved a long
way" recovery path — tightening it must not re-break the cropped/heavily-shifted-scan class it exists
for. And raising the bar on partial credit directly trades against garbled-caption recall, which is the
very thing failing here (0.75).

**Gates.** `crop_recipe_sweep.js` (the reconcile should then actually fire on Larkspur), the Customer
corpus (M=0, 0 doc-level T→F), `realdoc_regression.js` armed==baseline. CAUTION: fixing this makes R5
pre-empt R6 on these docs, which changes what the 2026-08-06 pad-window backstop is measured against —
re-run that slice's gates too.

---

## 2026-08-03 — Crosscheck-outlier reconcile (SHIPPED+ON) + Slice-2 universal verify (DEFERRED)

**SHIPPED + FLIPPED ON — `CROSSCHECK_OUTLIER_RECONCILE` (`09685d9`, setting
`crosscheck_outlier_reconcile`).** Symptom: a correct ref (crop+keyword+mapping agree) lost to a lone
fresh-locate garble because `anchor.py`'s authoritative-crop cross-check flips on disagreement ALONE
(doc-09 = NorthgateTextiles_purchase_order_09, GT PO-83150). Fix: post-merge
`engine._reconcile_crosscheck_outlier` restores a ≥2-independent-family (≥1 crop-family) + page-present
alternative over an UNcorroborated flip (re-base anchor_inline@90, drop flag). Oracle
SIGN-OFF-W/COND, conditions C1 (pre-flip crop preserved as `_crosscheck_original`, gated) + C2 (finer
`_crosscheck_witness_bucket` excludes registration/bare-anchor/the-flip, requires a crop leg) MET. Gate
(faithful realdoc 522 docs): ref 96.2→96.6% (+2 heals #344/#353), M=12==12, zero drop. Pin
`test_crosscheck_outlier_reconcile.py`. Advisors 007+reggie+gary. See `HANDOVER_2026-08-03.md`.

**Slice-2: UNIVERSAL post-merge verify — BUILT 2026-08-03 (owner GO; gary+reggie+007 → Oracle
SIGN-OFF-W/COND, docs/oracle_log.md).** ONE pass (`engine._universal_postmerge_verify`, after Slice-1,
before G1) over every eligible winner: RESTORE tiers ref/code+date (stage 2a, switch
`UNIVERSAL_VERIFY_RESTORE`/setting `universal_verify_restore`) and whole-number numeric/percentage
(stage 2b, sub-switch `UNIVERSAL_VERIFY_NUMERIC` — Oracle C6: DARK until a numeric/text GT gate
exists); FLAG tier text/structured (stage 2c, `UNIVERSAL_VERIFY_FLAG` — DARK). EXCLUDED: currency
(totals pass owns) + supplier_name (identity lane). Oracle blockers built in: S-1 `+corrected`/
`+snapped` winners untouchable; S-2 restore-demotion (digit-substitution via D1's shared comparator,
date-shaped-ref, prefix/length outlier, decimal-tail, credibility) — demoted restores FLAG with the
alternative NAMED; never drops an existing note. Pins `test_universal_postmerge_verify.py` (60
checks). Census mode `UNIVERSAL_VERIFY_CENSUS`(+`_FILE`): 522-doc realdoc census = ZERO would-fires
(clean corpus — matches the D1 0.00% precedent); OFF-arm byte-identical to baseline.

**REMAINING (next sessions):**
- **2b/2c flip gate (Oracle C6)** — build a Customer Doc Test corpus scorer (Desktop corpus +
  `ground_truth.json` carries total/vat_no/account_no/po_ref: the numeric/structured/text GT the
  522-doc realdoc lacks — its GT is ref/date-only, so a numeric/text gate CANNOT FAIL there). Then
  census + 3-arm gate → flip 2b, then 2c. Generator `stress_test/gen_customer_test.py`.
- Owner caveat (unchanged): re-test doc-09 LIVE — on the cold path it reads a CHOP `PO-160`
  (clamp/right-grow territory), not the crosscheck flip; grab SFDEV `po_number` lineage if it still
  misreads.

---

## 2026-08-05 (late) — STRAIGHTEN ARC: election gate RED → pivot to CANONICAL LEVEL FRAME (next session #1)

**Owner directive:** teach happens on straightened pages; customers run Straighten ON; taught
templates must read ~100% at ≤2°. **Arc ran:** 007+gary convergent design → Oracle SIGN-OFF-W/COND
→ `DESKEW_RAW_CROPS` election BUILT dark (`7d88dc4`, 18 pins — crop reads on RAW pages) → **gate
RED** (dsk_off/dsk_on pair: refs +7 scanned but customer −24/issuer −5/date −5; per-doc diff =
caption-grabs). ROOT TRUTH the gate exposed: stored teach coords live in the TEACH DOC'S OWN
raw frame (θ_teach baked in) — they match NEITHER the deskewed sibling (off by θ_teach) NOR the
raw sibling (off by θ_sib−θ_teach). Deskew's placement normalisation is LOAD-BEARING; the band
probe proved correctly-placed deskewed crops READ FINE (the earlier "any rotation garbles"
claim was overbroad — the pixel casualty is the full-page ~120-DPI locate, not placed crops).

**THE PIVOT (Oracle review required before build):** ONE CANONICAL LEVEL FRAME — Review/target-
teach works every time because box + pixels share the straightened frame end-to-end. Options:
(a) teach saves LEVEL-frame coords + processing deskews to level (save-path change + legacy
epoch/migration); (b) persist θ_teach per template/anchor, compose at read; (c) lazily re-detect
the teach sample's angle via sample_document_id. Constraints: owner rule NO PIPELINE SHARING
(display/teach rotation stays decoupled — pinned); `DESKEW_RAW_CROPS` + `DESKEW_SS_ROTATE` stay
DARK (both gates red — keep the code, the election infra + angles threading get reused by the
pivot). Evidence: out/customer_score_dsk_{off,on}.* · oracle_log 3 entries 2026-08-05 · the
scorer's DESKEW=1 knob. **Chris test loop ready:** sandboxed reprocess of owner-trained docs
only (no full sweep), read slices+logs — owner-approved scope.

---

## 2026-08-05 — Jitter-crater REFRAMED (Oracle premise overturn): the crater is the absolute rung, not born-digital

**Investigation (rung probe + armed rerun + wrong-answer classes + teach-anchor audit) overturned
the 08-04 item-1 charter.** Verified: (1) the cut taught box reads a CLEAN PARTIAL on crisp pages
('VXC153', '07-01-20-') which passes `_gate_value` shape_mode='ignore' and COMMITS at 78-90 with no
note — every shipped heal keys on page-vs-taught DISAGREEMENT and this class is stored-box damage on
an UNDAMAGED page, so nothing fires (armed-env rerun j120armed == j120s BYTE-IDENTICAL); (2) digital-
worse-than-scanned = crisp partials PASS the gate, scan garble FAILS it and falls through to heals
(j120s digital wrong refs: 33/49 clean-prefix-of-GT); (3) 34% of harness taught mappings had
poisoned/absent labels (value-as-label — FIXED, Slice A shipped, audit 48→0/310); (4) date
validation + parse_date accept 3-digit/cut years and Stage-4 expands them to confidently-wrong
dates. **Born-digital word-box synthesis DEMOTED to follow-up** (template_mapper OCRs the render on
both renditions — word geometry exists at Stage 0.5; the only real text-layer hole is `_page0_geom`
letterhead ranking, disproven as the crater by t300 digital issuer 90.3%).

**Oracle-signed slices (docs/oracle_log.md 2026-08-05 — conditions verbatim there):**
- A harness label fidelity — SHIPPED (see commit b63bd86).
- B `TEMPLATE_DATE_CLIP_GATE` (dark): _date_clip_suspect in _gate_value (reject dangling-separator /
  3-digit-year date fragments; 4-digit-year + trailing debris EXEMPT) + unswitched parse_date
  year<1000 floor. Pins: '07-01-20' clean 2-digit year stays ACCEPTED.
- C `TEMPLATE_ABS_EDGE_GUARD` (dark): read-time word-edge predicate on the ABS rung + word-bounded
  GROW + full-res re-read + per-type comparator + _shape_consents ladder; fallback cap ≤70 + note.
  C-C0 FIRST: the WYSIWYG pin at test_template_target_word_snap.py:108 is a DEAD GUARD (empty-string
  slice — passes vacuously); rebuild behaviourally before touching the fast path. Names EXCLUDED v1
  (NAME_UNCLIP seam); issuer lane declared out of scope for C's gate.
- D `_label_score` digit-exactness guard (dark): digit-heavy needles (share ≥0.5, ≥4 digits) require
  their digit sequence contiguous in the haystack before fuzzy blending ('03-06-2026' must not lock
  '07-01-2026').
**Sequencing: A → re-baseline arms (t300f/j120f) → D+B → C.** Gates: t300 byte-identical + ZERO
predicate fires counted · jitter climbs BOTH renditions + asymmetry narrows · LEFT-cut variant ·
realdoc 535 M=0. Old crater numbers (70→22 etc.) RETIRED — quote only re-baselined ones.

**BUILT + GATED GREEN same session (2026-08-05, commits b63bd86 · 8f631b8 · 2ddd5fa · fafd8b4):**
all four slices dark. Final gates: clean arm ZERO T→F + 21 pure heals (ref 70.1→74.7, date
91.3→93.4) · right-jitter ref 85.7/66.1 · date 91.1/83.9 · po_ref 100/78.6 · job_ref 100/100 ·
left-jitter ref 69.6/62.5 · realdoc 543 baseline==armed (M unchanged 11==11 standing, silent
14==14, M_type 0, +1 auto-file gained). **Settings-bridge BUILT (same session): `_reconcileEnv`
carries all three switches (all 4 spawn sites) + Settings→Processing toggles (edge-guard-toggle ·
date-clip-toggle · label-digit-toggle), div-balance + ID-pairing checked. NEXT: OWNER FLIP only
(tick the three toggles, or set template_abs_edge_guard / template_date_clip_gate /
template_label_digit_exact = true; RESTART the app first — main-JS changed, the stale-main
gotcha).** Known residuals: left-cut DATE lane digital 46.4%
(day-digit cut fragments — suffix date discipline is weaker than codes'); issuer lane 0 under
jitter BY DESIGN (names excluded v1 — the NAME_UNCLIP flip decision owns it); the scorer's
"Heal/verify fires captured (0)" header is stale — fires now counted via jsonl `methods`
(HEAL_RE log capture remains for engine-side heals).

**2026-08-05 LIVE FINDING — DESKEW DEGRADATION is the Larkspur docket class (probe-proven):**
docket_14 (live doc 561) reads 'DN-98447' PERFECTLY on the raw scan render (clean abs @90, no
cut); after the pipeline's +1.9° deskew rotation the same header garbles (locate words 'Dobrery/
Not/Ne:/DN/er!', full-res crop 'IN-JOSS f') — bicubic rotation smears small header print, every
heal starves on broken word geometry, the edge guard correctly flags instead of healing. Prior
art: `project_deskew_field_reread` ("straighten NOT monotone", designed-not-built) +
`project_deskew_raw_witness`; `raw_pages_out` already keeps the raw frames.
**ARC RUN SAME SESSION (007 → Oracle → build → REFUTATION — oracle_log 2nd 2026-08-05 entry):**
S1 `DESKEW_SS_ROTATE` built DARK (`5ae461a`, supersample rotate, 11 pins incl. analytic sign pin)
+ Oracle-C1 one-rotation-implementation unification (region.py private rotate deleted — SHIPPED,
behaviour-identical with SS off) + `deskew_angles_out` threading. **The interpolation hypothesis
was REFUTED on doc 561** — the supersampled rotation garbles identically; suspect #1 = the scan
noise field smearing under ANY rotation (raw+tilted reads perfectly; Tesseract self-tolerates
≤~2°). NEXT ARC (evidence bar MET): the Oracle-banked **S4 raw-preferring pre-extraction frame
election** and/or a **read-path deskew angle floor** (~2-3°, keep display straightening); S3
pdfium matrix render remains reserve; S2 raw-frame witness stays SEND BACK behind its revival
bar (C6-C10 preapproved). KEY FACTS for that arc: all THREE teach surfaces persist RAW-frame
coords (wizard suppresses · ⊕ back-transforms · teach-window Straighten back-transforms);
mapper `target_geom` is deskew-frame (never raw-crop from it); stored DB targets ARE raw-frame.
Interim owner guidance: Straighten-all OFF for these batches.

Still live from 08-04: mapper-heal census — DONE 2026-08-05 (`3b37228` — `_heal` markers + engine
"Stage 0.5 heal:" log lines + HEAL_RE; 95 fires captured on a 48-doc smoke) · customer-name GT
(#4) — GT lane SHIPPED 2026-08-05 (GT enriched in place, generator parity, scorer `customer` lane;
NAME_UNCLIP evidence pair running) · vat_no teach-locator + custom-field alias seeding (#5) · C2b
copy vet · ref_field_key threading · rehearsal read + annealing · born-digital `_page0_geom`
letterhead synthesis (demoted follow-up).

---

## 2026-08-04 (day) — C6 scorer + taught/jitter arms: the NEXT-ARC work list

**Shipped:** customer_corpus_score.js (+ TEACH arm via teach_from_gt.py + TEACH_JITTER) — the
Oracle-C6 gate. 2b/2c FLIPPED (zero noise measured). NAME_UNCLIP built dark (23 pins, no-harm x4;
HOLD). Teach-time box word-snap ON. SFDEV chord fixed. C2a decline instrumentation. S2 leak fix.

**THE JITTER FINDING (headline):** an 18% right-cut on taught boxes craters the taught pipeline
(ref 70->22, date 92->21, issuer 75->0 on 112 docs) and the shipped heal stack rescues ~nothing.
Next-arc list, in dependency order:
1. **Born-digital word-geometry gap** [PROMOTED — the seeding experiment proved consent was NOT
   the binding constraint: seeded jitter arm = same crater (only job_ref 50->64). Digital 12.5%
   vs scanned 32.1% under damage: the text-layer path produces NO word boxes so locate/inline/
   snap/cluster all starve. This is now suspect #1.]
2. **Consent starvation** — RESOLVED for the LIVE app (the teach wizard commit ends in a confirm
   -> count-1 provisional rows flow automatically via the night channel) and for the HARNESS
   (scorer now seeds live-parity provisional rows in TEACH mode). Keep: verify live end-to-end
   once on a real teach.
3. **Born-digital word-box synthesis** — digital WORSE than scanned under damage (2 sightings:
   cold ref 40 vs 50; jitter 12.5 vs 32). The text-layer path skips OCR so snap/inline/cluster
   machinery starves. Candidate: synthesize word boxes from the PDF text layer (pypdfium2 has
   char/word positions) so born-digital docs get BETTER geometry than OCR, not none.
3. **Mapper-heal census instrumentation** — heals are silent (diag markers only); add log lines
   so fire-counting works (the every-step-trace arc).
4. **Customer-name GT** — corpus generator lacks customer values in GT; without them NAME_UNCLIP
   (non-supplier names only) is structurally unexercisable. Generator extension + re-gen.
5. **vat_no teach-locator** — multi-group values ('GB 286 4471 90') miss in teach_from_gt find_value
   (single-run scan); also custom fields get NO label-alias seeding (vat_no ~0 in every arm).
6. Also parked: digital-vs-scanned ref anomaly root-cause; C2b copy vet; ref_field_key threading;
   rehearsal read + annealing.

---

## 2026-08-03 NIGHT (autonomous, owner asleep) — perfect-catch arc: 4 flips, all Oracle-gated

**Owner mandate:** "hash it out between yous, have the oracle vet it and implement when there is
agreement." Goal: teach once -> perfect catch on CLEAN siblings, silently. Full verdicts in
docs/oracle_log.md (NIGHT entry); commits `df80601` + the wrap commit.

**FLIPPED ON tonight (all gated):** `template_target_word_snap` (Slice B — own gate: +1 ref heal,
+1 date heal incl. a century garble, 5 false-flag drops, M identical) · `template_code_frag_clean`
(A2/C1 alnum label-tail fragment strip, consent ladder) · `template_clip_commit` (C2a right-clip
clean commit, 3 corroboration legs incl. the S1 ladder-provenance bit). Composed gate
byte-identical (M 10==10, zero drop). Settings toggles shipped for all three. PLUS the provisional
consent channel (taught-doc skeletons, S2-isolated) + role-aware ocr_type seeding + both
edit-surface selects + advisor prior-art/track-record memory.

**OWNER-MORNING list:**
- **C2b copy** — the SURVIVING disagreement note still reads "manually mapped value differs from
  the usual format" (Chris: blame-shaped, nothing to verify against). Oracle-approved direction:
  name both reads ("the taught box and its anchored re-read disagreed ('o. DN-6742' vs
  'DN-67428')"). User-facing copy -> owner vet.
- **Teach-time box word-snap** (barry #1, gary-designed): snap the STORED boxes at readBack so
  teach geometry == read geometry; owner sees the snapped box before commit. UI-visible teach
  flow -> owner first. Frame trap: ocrRegionBoxes words are crop-px.
- **`_seed_field_patterns` ref_field_key threading** — the REAL production hole for
  unconventional-key ref roles (free-text-gated today). Separate gated follow-up (gate: M
  unchanged; candidate selection can shift when a gate starts withholding).
- **Rehearsal read + template annealing** (barry #3/#6) — design-only, the durability pair.
- Live re-test: reprocess the Northgate dockets after RESTARTING the app (main-JS changed
  tonight — the stale-main gotcha bit once already this evening).

---

## 2026-08-03 (evening) — teach-mapping edge-debris heal (Slice A BUILT) + word-snap (Slice B designed)

**Incident:** teach-wizard template 26 (Northgate delivery_note) value box ~7px right of label
"Delivery Note No."; +1.3-1.5deg siblings bleed the label-tail dot; every read commits '. DN-60902'
(drift rung: template_mapping_shapewarn@70 + "manually mapped value differs" note; under-tolerance
rotation: SILENT clean@90 on the absolute rung). The reconcile's clean inline read was computed then
DISCARDED by _pick_fuller_code's agree branch. Full diagnosis via Debug/diagnostic_*.jsonl.

**Slice A BUILT (dark):** agree-branch edge-debris heal, kill TEMPLATE_CODE_EDGE_CLEAN (default OFF),
setting template_code_edge_clean bridged. Oracle SIGN-OFF-W/COND, fork RULED reggie (witness-equality:
heal iff strip_edges(rigid)==inline VERBATIM + learned shape consents; COLD suppliers heal — the
named-deliberate '#12345'->'12345' pin). Pins test_template_code_edge_clean.py ALL PASS + full mapper
suite green. GATE GREEN (535 docs, OFF==ON byte-identical: M 10==10, ref 515/535 both, zero hold-set leavers) — FLIPPED ON (template_code_edge_clean=true) + Settings toggle "Tidy stray marks from taught reference reads". Heal evidence = unit pins + the traced rb_539 lineage (the harness renders dont reproduce the live dot-bleed).

**Slice B BUILT (dark, 2026-08-03 late):** pins test_template_target_word_snap.py ALL PASS; setting template_target_word_snap bridged (no UI toggle until its flip). REMAINING: its OWN 535-doc gate window (never share As — Oracle) + flip. Design: _snap_box_to_words on derived rungs (drift+registration) — majority-
inside word admission, cluster gap discipline, located-frame label cut (B-C1 frame trap), never admits
untouched words; absolute rung WYSIWYG untouched. Switch TEMPLATE_TARGET_WORD_SNAP. Build AFTER A
ships, SEPARATE flip window (both release the same shapewarn hold). Oracle conditions B-C1..C5 in
docs/oracle_log.md.

**barry ideas (owner rule: minimal interaction, max auto-file — visibility goes to SFDEV):** survive
as silent automation: Wiggle Test (teach-time tilt probe, SFDEV verdict), One-Good-Doc picker,
Self-Healing Box (located-frame + versioned refit + >=N distinct docs), Template MOT (needs
template_id attribution on corrections). SFDEV-only: agreement dots / provenance / tidy receipts
(receipts MUST persist to audit regardless). Kernel rule from #4: a tidy files without review only
when verbatim-corroborated by an independent-GEOMETRY read — enforced by the mapper not attaching
the note, NEVER a trust.js note-class bypass. Shared spine = ONE per-field agreement+tidy event at
the engine post-merge choke point.

**Also spotted (unfixed):** teach wizard seeded ocr_type=text on a reference-role field (template 26
delivery_number) — teach-time type seeding should map the field's real type; separate small fix.

---

## 2026-08-02 OVERNIGHT (autonomous, owner asleep) — SHIPPED / DARK / DEFERRED
Owner directive: build everything buildable, commit each, push at end, flip ON when the advisor+Oracle
+ gate pass green. Then a christest walkthrough. Advisors used: eric (search/UX cluster), reggie
(ref-completion), gary (type-note + bleed). All fixes gated; each commit self-contained.

**SHIPPED + FLIPPED ON (gate-green):**
- **Crop right-grow `ANCHOR_VALUE_RIGHT_GROW`** — `13dbe44`. Proven heal on the Northgate PO demo
  (`stress_test/demo_rightgrow_ab.js`): PO-5898→PO-58987 (HEAL vs GT), 0 collateral. Setting-bridge
  `_anchorCropEnv` (4 spawn sites) + Settings→Processing toggle. Flipped ON in the live DB.
- **Label-tail clamp `ANCHOR_LABEL_LEFT_CLAMP`** — `336585a`. Oracle had already GO'd the flip;
  demo-verified (Saltmarsh PO9974A9C→PO-27425 HEAL, 0 collateral). Same bridge + toggle. Flipped ON.
  NOTE: the harness can't test the LIVE combination of both crop settings ON (it reads env, not the DB
  settings); the corpus reads are crop-OFF. #499 (PO-58987 chop) surfaced crop-OFF in the harness — it
  is the right-grow class and heals with the live flip. Watch W1-W3 (see the clamp section below).
- **Light⇄Dark quick-flip remembers the selected theme** — `418cf80`. theme.js records a per-family
  anchor; the flip round-trips (slate⇄midnight⇄slate, warm⇄dark⇄warm).
- **Search preview honest error state (eternal-spinner cure)** — `bf9fe90`. selectDoc guarded +
  stale-selection token; mailbox/workflow pre-fetches dropped; "No handler registered" → restart msg.
  Pin `test_preview_error_state.js`.
- **Home "Open Mailbox" lands on the mailbox** — `b67688a`. New open-search-window-at channel
  (NOT the taken get-search-target); SearchMailbox.open() set-true idempotent.
- **Core Search re-skin to the client look** — `d7ab2e2`. New `search-components.css` (tinted chips,
  segmented mailbox, lead search icon, pill buttons) over the existing class hooks — no logic/IPC/id
  change. Chris visual round pending (christest).
- **Focus-repair sweep SLICE 1** — `01a2a43`. `shared/dialogFocus.js` (focusField + idempotent
  confirm/alert wrapper); preload `ensureWindowFocusAsync`; workflow Reject note routed; Search/Main/
  Teach armed (were unarmed). Pin extended (+recovered 4 drifted runZoneOcr checks). Full 42-site
  `.focus()` audit + regrow-proof static pin = MULTI-SESSION (per eric).
- **delivery_number breadth + Service Worksheet preset** — `b4105b7`. ~25 delivery-specific captions
  (excludes greedy Note No/Ref No); type-scoped worksheet preset. realdoc M=0, zero new delivery
  regression.

**BUILT DARK (flip pending):**
- **Digital↔scanned bleed — `SAME_SUPPLIER_LAYOUT_GATE`** — `5af13cf`, default OFF, byte-identical.
  gary-designed elif on the same-supplier authoritative rigid read (require caption at taught position,
  looser relocate budget + offset-present precondition; demotion-only). Pin
  `test_same_supplier_layout_gate.py`. **FLIP PRECONDITION: Oracle round (narrows a Tier-A invariant)
  + realdoc M=0 with the switch ON + gary's two-direction integration pin. Do NOT flip yet.**

**DEFERRED with a vetted design (build-ready, owner-gated or needs a live test):**
- **Type-note placement under Document Issuer** (gary): Route 1 (renderer-only display relocation to a
  `.type-scope-note` band by `#doctype-select`, keeps the persisted note on the carrier for the
  auto-file hold, copy-lockstep pin) OR Route 2 (a `note_scope:'type'` marker + migration). Route 1
  recommended for its zero-migration safety. NOT built (budget). engine.py:5889 `_flag_type_ambiguity`.
- **Child-window minimise → in-app dock** (eric): PREMISE CORRECTION — NO current child is modal
  (main.js:480), so no modality surgery. Slice 1 = dock infra + child-minimise/restore-child IPC +
  the trigger (prototype the createWindow `minimize` intercept; fall back to an in-app control if the
  skipTaskbar stub flashes — needs a live Windows test). SEAM: main-hides-to-tray orphans a docked
  child — handle first. restore-child must verify sender===main + name∈CHILD_WINDOWS. NOT built (the
  trigger needs a live flash-test I can't run headlessly).

## 2026-08-03 (day, owner present) — template fine-tune SLICE 1 SHIPPED + two follow-ups
**SHIPPED + FLIPPED ON:** the Northgate PO-17039 class (template_mapping tight-crop reads 'PO-17039'
as '»0-17039'@90, WINS over correct keyword 'PO-17039'@93, → '0-17039'@69 flagged). Verified LIVE in
the diag log. 007+reggie+gary → Oracle SIGN-OFF-W/COND (oracle_log 2026-08-03).
- **`PREFIX_GARBLE_ADOPT`** (`0d747d0`, setting `prefix_garble_adopt`, flipped ON) — a SECOND adopt
  fingerprint in the S-B length-witness arm: `suffix_reconcile.prefix_garble_fingerprint` (garbled
  leading prefix, exact tail preserved) gated by `engine._strong_single_prefix` (`all_prefixed` +
  ≥0.90 + ≥5). Adopts the confirmed-prefix peer's value. Pins: test_suffix_reconcile §4 +
  test_ref_length_outlier §7. Realdoc OFF==ON byte-identical. Bridge `_reconcileEnv` + Settings toggle
  (`4f29fc0`). Do NOT co-ship gary's S-C Stage-0.5 extension (Oracle C4, order collision).
- **SFDEV lost-reason** (`45de1af`) — a LOST rung now names the incumbent ("kept 'X' from
  template_mapping"); state-only, no-overclaim pinned.

### ✓ RESOLVED (for the batch gate) — harness now fires Stage 0.5 via the reprocess manifest (2026-08-03)
`realdoc_regression.js` now passes the per-doc `--reprocess-manifest` (`17d7480`), so the gate fires
Stage-0.5 template_mapping like the app. PROVEN: the `PO-2590`/`PO-5898` chops (template_mapping tight-
crop) now appear where the blind harness read the ⊕ anchor. **This immediately re-validated the crop
flips** (right-grow+clamp) that were meaninglessly "byte-identical" on the blind harness: on the
faithful harness, crop-ON vs crop-OFF (both manifest + prefix-garble ON, 503 docs) = **+3 ref heals
(#483/#499/#503), ZERO new regressions**, ref 96.4%→97.0%. Honest re-baseline (previously masked): ref
96.4% base, 12 would-auto-file-wrong. RESIDUAL (minor): single-doc `trace_one` still reads the anchor
(the batch path fires template_mapping, the single-doc filed-copy path doesn't — a state/path quirk, not
the gate). NEW FINDING (fine-tune arc): the diag's `doc_context` shows the app matching a **"Stonegate
Property Mgmt" template to Northgate docs** — a cross-supplier logo-phash collision; the wrong
template's mapping box is a prime garble source. Investigate under the template fine-tune arc.

### HARNESS-FIDELITY GAP — the corpus gate is BLIND to the template_mapping-garble class (2026-08-03)
`stress_test/realdoc_regression.js` + `trace_one.js` do NOT fire Stage-0.5 `template_mapping` — on the
Northgate PO-17039 working copy they read the ⊕ anchor (anchor_inline@97) while the LIVE app fires
template_mapping and garbles (@90, confirmed in the diag). So EVERY corpus gate this session proved
"no regression on what the harness sees" but is blind to template_mapping heals/regressions — those
are only observable live. Root cause UNKNOWN (template match/registration state? working-copy render
vs raw? the app reprocess passes something the harness snap() doesn't). FIX DIRECTION: make the harness
faithfully reproduce the app's Stage-0.5 (diff the app reprocess spawn args in processing/handler.js vs
the harness snap()), so the template fine-tune arc can be gated by the corpus, not just the live app.
High value — this blind spot undermines every template-class gate.

### ✓ SHIPPED slice 1 (prep-only, ON) — oscar crop-fix B; slice 2 (whitelist) + #494 deferred (2026-08-03)
`STRUCT_CODE_READ` (`d2b8937`, setting `struct_code_read`, flipped ON). oscar+007+gary → Oracle
SIGN-OFF-W/COND (oracle_log 2026-08-03). Slice 1 = PREP ONLY: cap-height upscale
(`region_core._ink_band_height` → scale clamp(34/ib,1,4)) + synthetic read-time quiet-zone (median-grey
border, NOT a wider window) + DROP SHARPEN, in a struct rung PREPENDED to the shared ladder that falls
through to today's rungs on a sub-floor read (Oracle C2). NO whitelist (Oracle fork-ruled it out — the
gateless Stage-0.5 path would auto-file a whitelist-snapped clean-shaped WRONG code). Gate (faithful
manifest harness, OFF vs ON, crop-flips-ON baseline): +1 ref heal (#218 digit-sub read RIGHT),
would-auto-file-wrong set IDENTICAL (true M=0), zero accuracy drop, no new regressions; #494 unhealed but
UNCHANGED (fall-through). Pins test_struct_code_read.py.
**DEFERRED:** (1) **slice 2 = the char whitelist** — must carry its OWN checkpoint (a differently-prepped
non-whitelisted corroboration OR the learned-shape check), NOT committable on shape_mode='ignore' alone
(Oracle C4). (2) **#494 'PO-66063'→'PO-68063'** interior digit-sub — prep alone can't cure; slice-2
whitelist or a second-render witness. (3) **real-asset functional PIN** — capture a ~13px garbling crop.

### oscar crop-fix B — the ROOT fix for the tight-crop garble (007-recommended, incl. po_date)
The garble is a READING failure (007): a ~13px target crop with no left quiet-zone + over-sharpen reads
'PO'→'»0' AND '19'→'09' (doc-18 po_date is ALSO wrong: 09-06-2026 vs 19/06/2026 — same class, but a
date has no prefix so PREFIX_GARBLE_ADOPT can't touch it). Fix B (oscar owns the recipe): cap-height
upscale (~3× for a 13px crop, target ~30-40px), a READ-TIME quiet zone (pad the pixels fed to
Tesseract, NOT the stored box), a char whitelist for structured code types ('»' becomes impossible).
ORDERING SEAM (007): B lands BEFORE any crop-window/geometry change, measured on the IDENTICAL box. B
is the root (cures every code crop incl. no-peer + date cases); PREFIX_GARBLE_ADOPT is the net. Bring
in oscar → Oracle.

---

## UX / product

### ✓ SHIPPED — Light⇄dark quick-flip forgets the selected theme — OWNER 2026-08-02 (next session)
> Resolved by `418cf80` (theme.js records a per-family choice) — see the SHIPPED list at line ~590 of
> this file. Ticked 2026-08-08; the entry is kept for its repro.
**Repro (owner, live):** with a non-default theme selected, the quick Light⇄Dark toggle (account
menu + rail-foot) goes dark, then flipping back lands on the DEFAULT theme (Warm Paper) — the
user's chosen theme is lost. **Expected: the toggle alternates between the CURRENTLY SELECTED
theme and a dark theme, round-tripping back to the selection.**
**Likely mechanism (unverified — verify at source):** the flip handler writes a literal theme name
both ways (`set-setting('theme', 'dark')` / back to the default constant) instead of remembering
the pre-flip selection. Leads: `src/windows/shared/theme.js` (sets `data-theme` + `data-mode`,
`DARK_THEMES` gates the family), the account-menu + rail-foot toggle wiring, `theme-changed`
broadcast.
**Fix shape (design in-session):** remember the last LIGHT theme and last DARK theme
(settings-persisted pair) so the flip maps selection⇄dark-counterpart and back — e.g. Nordic
Slate ⇄ chosen dark, seasonal themes included; minimum bar = flipping back restores the pre-flip
theme exactly. Respect the existing `data-theme`+`data-mode` split (memory
`project_theme_system_gotchas`).

### ✓ DONE — Teach clipped-code reconcile, Slice 2 (the DRIFTED-sibling path)  (2026-07-31, `a4fa107`, ON)
- Slice 1 (`f2e5ee3`/`c70bae7`, `TEMPLATE_INLINE_CODE_RECONCILE`) fixed the FAST path; Slice 2 (`a4fa107`,
  `TEMPLATE_INLINE_CODE_RECONCILE_DRIFT` default ON) extends the reconcile to the DRIFT/relocate path
  (`_geometric`). Routes through `_inline_code_reconcile` wholesale (robust page-wide source — Oracle SEND-BACK of
  the partial `located`-based version, which could DEGRADE a correct geometric read). Gate: `drift_forced_probe.py`
  10/10 + 0 degraded + 3 real drift-garble fixes; realdoc DRIFT==baseline; 4 drift unit/PIN. Memory
  `project_teach_inline_code_reconcile_20260731`.
- **Perf follow-up (optional, still open):** the reconcile does a page-wide locate per clean CODE read; it's `line_cache`-shared
  with the registration landmark fit (≈0 extra OCR on registration-enabled docs), but a doc with a taught code
  field and NO landmarks pays one fresh page-wide OCR. If profiling ever flags it, gate the cross-check on a cheap
  pre-signal (e.g. the local pre-pass `inline_value` disagreeing) before escalating to the page-wide locate.

### ✓ FIXED (pending owner smoke) — Teach wizard label non-recognition  (2026-07-30)
- **Root cause (frame-math bug):** `cropB64` sends the label band NATIVE (ds=1.0 under `TEACH_NATIVE_CROP`),
  but the label-detection code at `src/windows/teach/renderer.js:787/803` recomputed `ds=OCR_TARGET_H/bandHpx`
  (~0.42) WITHOUT honouring `TEACH_NATIVE_CROP` — so `cY` (the value centre fed to `nearestRowTo`) and the
  label word-box→page-norm conversion were scaled ~0.42× against words that are in NATIVE crop px →
  `nearestRowTo` looked in the wrong place → no row → "No label found here" even with the caption right beside
  the value (the Saltmarsh "Order Date" miss). FIX: both `ds` now `TEACH_NATIVE_CROP ? 1.0 : (…)`, frame-
  consistent with the crop. `nearestRowTo`/`nearestLeftCluster` then correctly narrow a wide band (heading +
  caption) to the caption row, so cause (2) is subsumed.
- **Smoke:** reopen Teach on the Saltmarsh PO → draw the Order Date value → "Order Date" should now be detected.
  If a residual remains on a badly-skewed scan (cause 3), look at the band slice next.

### ✓ SHIPPED — Teach wizard: only-current-box overlay + Straighten text button  (2026-07-30, owner)
- Overlay now draws ONLY the field being taught (removed the done-fields loop in `redrawCanvas`); the last
  box clears once the final field confirms (`advanceField` parks `fieldIndex` past the end → `curField()`
  undefined). Display-only — `state.results` untouched.
- The teach `∞` straighten control replaced with Review's icon + "Straighten" text button (`#tz-deskew`,
  auto-width; keeps the `.active` pressed style). `src/windows/teach/{renderer.js,index.html}`. Needs app reopen.

### Template Manager — Straighten button  (added 2026-07-30, owner)
- **Wanted:** a Straighten control in the Template Manager preview (same as Review/teach) so a tilted
  sample can be levelled before drawing/checking anchor→target boxes. `src/windows/settings/` (Template
  Viewer `#tpl-dock`) + reuse `get-page-deskew` + the AnchorLabel transform (as teach does).

### Template Manager — visualize + tighten anchor boxes  (added 2026-07-30, owner — EXPLORE)
- **Owner questions (answered inline in chat 2026-07-30):** do TM-drawn boxes validate on import? what is
  the TM for? should the drawn zones be VISIBLE on a doc (like Review's "show where it reads") so the user
  sees where the system snaps? what settings tighten a frequently-misfiring box?
- **Direction to design:** (1) a "show where it reads" overlay in the TM preview (reuse the Review overlay
  path + `template_mapper` located-zone output); (2) per-mapping tightness controls (padding/expansion,
  registration on/off, label-lock strictness, absolute-vs-relocate) surfaced per field; (3) a per-box
  test-on-this-sample readout (already partly in `recordMappingTest`). See the chat exploration for the
  full write-up + the FACT-checked answers on how mappings/anchors are actually used at extraction.

### ✓ SHIPPED — Import "couldn't be read" banner: details + dismiss  (2026-07-30)
The amber Import banner now (1) reworded "held for retry (not filed, not lost)"; (2) a **Details** toggle
lists each held doc + WHY (`documents.error_message`, via the existing `getStuckDocs`); (3) a **dismiss (×)**
per-session acknowledge that re-surfaces only when MORE docs fail (`_stuckDismissedAt`). Renderer + markup +
CSS only (`src/windows/main/{renderer.js,index.html}`); errored docs still hold at `status='error'` (never
lost) — dismiss is display-only. Needs an app reopen to render.

---

## UX / product (continued)

### Catch-up filing ("file the rest") — SLICES 1-3 BUILT (dark), SLICE 4 GATES + FLIP REMAIN
**2026-08-01 evening: slice 3 BUILT** (server accept/undo + renderer consent UI; all dark behind
`scope_sweep_enabled` OFF + env `SCOPE_SWEEP`): `sweep-scope-accept` re-validates EVERYTHING
server-side (status/scope/workflow + candidacy FINGERPRINT + the same `_evaluateSweepDoc`
re-run) then files through the ONE shared `reviewService.confirm` with INTERNAL
`{via:'scope_sweep'}` (4th arg — never payload-suppliable; claim stamps `confirmed_via`;
saveCorrections SKIPPED for machine confirms = no hint inflation; learn-on-commit self-guards) ·
`sweep-scope-undo` (server-verified `confirmed_via='scope_sweep'` only → deconfirm, via cleared,
filed copy kept for in-place re-file) · consent bar `#sweep-consent-bar` (offer/filing/done
states, per-doc untick, Review-them queue filter, Not-now per-scope dismiss, Undo all,
kept-back reason chips) · triggers: single confirm + prefix-outlier resume + File-All dominant
scope (debounce 2.5s) · audits scope_sweep_offered/accepted/undone. PINs green:
`database/modules/test_confirmed_via.js` (claim stamps via / human NULL / deconfirm clears /
pre-mig-57 guard) + all seam suites (scope_trust, learn_on_commit, sweep_predicate,
reextract_merge). **SLICE 4 REMAINS before flip: fixture integration gate + demo-corpus gate
(design §test plan) + realdoc OFF assert, then flip `scope_sweep_enabled` per install. Owner
can pre-trial with env `SCOPE_SWEEP=1` (harness lever, not the flip).** gary's header-band
witness design (2026-08-01, awaiting Oracle) slots into `_evaluateSweepDoc` as an AND-only
exclusion later — not part of slice 4.

Original design record (2026-07-31):
- Owner idea: after K same-scope manual confirms, remaining queue docs (correct values, stale
  scores) re-gate against the warmer learning and batch-file behind a per-scope consent
  banner+list with per-doc untick. barry (L3, near top of office backlog) → gary (two-tier
  predicate: free re-gate + imageless consistency re-score; memory-held; files STORED rows via
  reviewService.confirm bulk) → **Oracle SIGN-OFF-W/COND** with two rulings (sweep confirms
  EXCLUDED from graduation via new `confirmed_via` column, values-learning flows;
  banner-consent v1, silent File-All absorption rejected) and two seams both advisors missed
  (corrections-SPAN revocation so human-only windows don't disarm self-revocation; candidacy
  extractions FINGERPRINT so consent can't go stale). **Full agreed design + build slices:
  `docs/designs/CATCHUP_FILING_2026-07-31.md`.** Build in a fresh session, slice 1 first
  (migration + scopeTrust rework — feature-independent).

### Child-window minimise → a visible, pronounced dock (not the lost corner box) — OWNER 2026-08-02
**Owner ask:** re-enable minimise on the child windows (Review/Settings/Search/Teach/dev-inspector).
They used to minimise to a tiny stub at the desktop's bottom-left that vanished into the background and
was hard to find. Want: minimise them to the **bottom-left of the MAIN app**, staying **visible and
pronounced** so they're easy to spot and reopen.
**Why it's off today (repro/root):** parented child windows are created with `minimizable:false` FORCED
(`src/main.js:583` — `...(parentWin ? { minimizable:false } : {})`) precisely BECAUSE they are
`skipTaskbar:true` (`main.js:585`), so a native minimise sends them to the legacy Windows corner stub
with no taskbar entry — "an easy way to 'lose' the window" (comment `main.js:581-583`; same hazard noted
for the main window at `main.js:475-477`). So the feature was deliberately disabled, not missing.
**Leads / design direction (eric to vet; NOT built):**
- Don't use native minimise for a `skipTaskbar` child. Instead `win.hide()` and render an in-app
  **restore dock** — a pronounced pill/chip anchored bottom-left of the MAIN window (`#topbar`/main
  renderer), one per hidden child, click to `show()`+`focus()`. A restore path already exists:
  `createWindow` restores+focuses an existing window when its launcher is clicked (`main.js:548`,
  `475-477`).
- **Modality wrinkle:** most children open MODAL to the parent (`modal=!NON_MODAL_CHILD.has(name)`,
  `main.js:574`) — a modal child blocks the parent, so "minimise and go use the main app" only makes
  sense if minimising also drops modality (or the feature is limited to non-modal children). Decide
  which.
- Alternative already half-built: the **system tray** minimise-to-background path (`main.js:630-697`,
  Stage 1/2) — could dock hidden children there instead of/as well as an in-app dock. Owner wants
  IN-APP + pronounced, so the bottom-left dock is the primary; tray is the fallback discussion.
- New IPC: `window-minimise` currently exists (`main.js:1386`) for the main window; a child variant
  would hide + notify the main renderer to add/remove its restore chip.

### Teach "Confirm what I read" bar — two filled buttons, ambiguous accept — DESIGN PLAN (OWNER 2026-08-02)
**Owner repro (screenshot):** after drawing a field value in the teach wizard the confirm bar shows
TWO large filled-orange buttons — "Looks right →" (accept) AND the selected direction toggle "← Left"
— so it isn't obvious which one accepts-and-moves-on. Owner wants a sleek, smooth redesign.
**Root (verified):** `src/windows/teach/renderer.js` — the Left/Above direction toggle renders the
SELECTED direction as `btn primary` (`:687-688`, `dir==='left'?'primary':'ghost'`), i.e. the same
filled-primary style as the accept button `rb-yes` "Looks right →" (`:692`). All controls sit in one
flat row (`:686-694`: accept · Redraw value · Redraw label · "Label is:" Left/Above) with no visual
separation of VERIFY controls from the single ACCEPT action → two primaries compete for the eye.
**Owner's desired flow:** keep the confirm LABEL + VALUE on the same header (`setPrompt('Confirm what I
read for', f.label)` `:671`, and the "Value: … · Label: … (left of the value)" readout). Make it an
obvious **check-FIRST-then-accept**: (1) check the VALUE is right, (2) check the anchor is LEFT or
ABOVE, (3) THEN one clearly-primary click if you agree.
**Design plan (to vet, NOT built):**
- **Exactly ONE filled primary** on the bar = the accept ("Looks right →" / "Yes, save this field →").
  Everything else steps down to secondary/ghost/segmented.
- **Left/Above = a SEGMENTED TOGGLE** (one pill control, two segments, selected segment softly
  highlighted — NOT `btn primary`). It reads as a CHOICE, not a competing action. Drop the arrow-key
  orange fill.
- **Two zones, ordered check → confirm:** a VERIFY group (value read-back + label + the direction
  toggle + subtle "Redraw value / Redraw label" as text-links or small ghost buttons) then, visually
  set apart (right-aligned or full-width below), the single ACCEPT CTA — so the eye flows value →
  direction → accept.
- Keep label+value in the header per owner. Sleek: quiet secondaries, one confident primary, a little
  breathing room between the verify group and the CTA; consider a faint "① check  ② confirm" cue.
- **Advisor gate before build:** chris-the-customer (his exact domain — decision ambiguity / which
  button) + barry (UX shape) → eric (teach renderer) → Oracle. Renderer-only; no extraction impact.

## Extraction / accuracy

### Cross-contamination residual — Stage-2 `_qualify_against_format` — DO-NOTHING (gary+Oracle, 2026-07-30)
- **Resolved understanding (Oracle traced it):** the Stage-4.5 fix (`SHAPE_WITHHOLD_SUPPLIER_SCOPED`, default
  ON, engine.py:4421/4631) closes the keyword/rigid path. The feared Stage-2 `anchor_crop` null is **largely
  already handled**: `method='anchor_crop'` is set at `anchor.py:586` only AFTER passing `_qualify_against_format`
  at `582`; a clean stranger crop is nulled at **582** (the ENTRY to the relocate/registration recovery chain),
  and the located case is **already resurrected** at `anchor.py:1102-1104`/`1175-1177` by the same
  `_digit_free_on_digit_field`/`_partial_of_uniform_shape` predicates (flagged at Stage 4.5). So `anchor_crop`
  is NOT the danger the earlier note claimed.
- **The genuine residual is a NARROW sliver:** `method='anchor'` text-fallback (+`anchor_crop_recovered`) —
  label readable as a text line but NOT locatable as a box, relocate/registration failed, field `_xsupplier`.
- **Why DO-NOTHING (gary designed a fix; Oracle SIGN-OFF-W/COND → build DARK / fallback DO-NOTHING):** the fix
  (an `xsupplier_lookup` companion threaded to `anchor.py:1253`, keep-clean-reject-garble via the readability
  predicates) is sound + fail-safe (kept value → Stage-4.5 flag → never auto-files), BUT (a) reward is the
  narrow text-fallback sliver only; (b) a kept stranger ref WINS Tier A (engine.py:3552, `located` includes
  `'anchor'`) and DEMOTES a would-be keyword auto-file to a flagged review showing a WRONG value on disagreement
  — a real auto-file-rate regression (never a silent misfile); (c) the FIRING path is CORPUS-INERT (no taught
  anchors in the born-digital harness; real anchors belong to confirmed suppliers), so it can't be validated —
  Oracle's flip gate needs a constructed taught-anchor `_xsupplier` case on the BF_/KO_/… corpus. Not worth the
  demotion downside for a corpus-inert edge on a single-supplier install. Revisit only if a real firing case
  appears on a genuine multi-supplier install. gary's full design + Oracle's conditions (A corrected framing /
  B demotion pin / C taught-anchor gate / D `test_doctype_scoped_format_gate.py` direct-call short-circuit /
  E single `(entry,is_xsupplier)` closure) are in the 2026-07-30 chat.

### Letterhead cold-start supplier reader  (confirmed at scale 2026-07-29)
- **Symptom:** cold (first-contact, no learning) supplier identity reads only from a `Supplier:`/`Bill
  From:` caption. The born-digital demo batch measured **~8%** supplier accuracy cold — name-as-text
  letterheads, footer-only issuers, and text wordmarks all return null. Resolves once learning/templates
  exist, so it's a first-contact gap.
- **Fix direction:** the designed-but-unbuilt `letterhead.py` **suggestion-only** reader (largest text in
  the top band → issuer). Only ever needs to carry doc #1. See memory `project_issuer_band_and_letterhead`.

### S1 band-graduate — real fix (column/geometry-aware issuer window)
- **State:** S1 (`TEMPLATE_IDENTITY_BAND_GRADUATE`, commit `958229c`) is built DARK and proven **INERT**
  on its target: two-column `BILL FROM | BILL TO` layouts put the issuer name AFTER the "BILL TO"
  recipient marker in the linearized text, so `_issuer_hint_band` truncates it out → no shed.
- **Fix direction (deferred, gary+Oracle):** a column/geometry-aware issuer window, OR a `BILL FROM`-
  anchored corroboration window that excludes the recipient column (Oracle C2 is the constraint).
  Memory `project_autofile_s1_band_graduate_20260729`.

### delivery_number / worksheet ref completion  (reggie, 2026-07-29)
- delivery_number went 0% → **45%** after adding its `field_patterns` entry — still partial (more
  label/format coverage + the footer/three-party layouts). worksheet `reference_number` stays **30%** —
  the "Worksheet No"/"Job No" labels must be added at the **type-scoped** layer (preset override / ⊕
  teach), NOT the global `_REF_ROLE_CAPTIONS` seed (reggie: global would collide with `job_no` + blast
  every custom ref field).

### ✓ FIXED — Set A warm cross-contamination  (2026-07-30, d9ec7d5 + flip 2b8bdb2)
- Loading live learning dropped new-supplier ref accuracy (Set A ref 84.7% cold → 50% warm). iris PROVED
  (isolation) it was NOT phash/fingerprint/anchor (all falsified) but the learned-shape `formats` store: the
  doc-type-scoped `('')` aggregate on a single-supplier install IS that supplier's ref convention, hard-nulling
  stranger refs at Stage 4.5. FIX (`SHAPE_WITHHOLD_SUPPLIER_SCOPED`, default ON): a `('')`-only verdict FLAGS
  not NULLS; supplier-scoped withhold byte-unchanged. Gate: score_demo A warm ref 55→89%, realdoc M=0. See
  memory `project_shape_withhold_supplier_scoped_20260730`.

### Name-presence veto residuals  (2026-07-31, Oracle-logged with the TEMPLATE_FIXED_NAME_PRESENCE_VETO sign-off)
- **Bank-less collision survives unflagged:** a collision onto a supplier with **no ≥3-word branding
  fingerprint** exits `_flag_branding_conflict` at the own_ratio-None fail-safe (engine.py ~1959)
  BEFORE the un-named branch — a conf-95 wrong `template_fixed` stamp stands unflagged and CAN
  auto-file. The supplier_prints_name ratio is exactly the evidence that could judge it where the
  bank can't — extend the veto ahead of that early-return (own slice + own gate).
- **`_doctype_fixed_supplier` is a DEAD GUARD in production** (found 2026-07-31 building the veto):
  it reads `f.get('key')` but the templates payload carries `field_key` (template_matcher reads
  `field_key`; only the unit fixture uses `key` — test_fixed_supplier_immune.py greens on a shape
  production never sends). The template-MISS fixed-supplier fill + its logo-immunity have therefore
  never fired live. Fixing = one word, but it ACTIVATES a dormant conf-95 stamp path — needs its own
  vet + gate (and the new veto already covers it once live). Do NOT "fix" casually.
- **Ratio-deflation poison loop:** each wrong-scope confirm under a name-printing supplier drags its
  prints-name ratio toward <0.80 and disarms the veto. Clean at flip (Copperfield 1.0/60,
  Ridgeway 1.0/101 — verified 2026-07-31); re-check at any mass-misfile incident.

### Needless-flag session residuals  (2026-07-31 evening; herald+gary+Oracle)
- **Slice C — `_center_in_any` overlap-fraction fix at source** (ocr/tesseract.py:76-85): the PSM-6
  supp merge's center-point dedupe lets an overlapping supp word through inter-fragment gaps →
  DOUBLED tokens in `ocr_text` for every consumer (the manufactured heading garble rung-2 now
  works around). An overlap-fraction test fixes it at source but changes OCR text corpus-wide —
  own session, own full gate. Do not bundle.
- **Demo-corpus identity residuals (pre-existing, measured in `demo_notes_gate.js`):**
  `SaltmarshSeafoods_purchase_order_01` reads issuer `'altmarsh Seafoods'` (leading-glyph clip);
  `_02` reads `Ridgeway Plant Hire` (cross-supplier identity collision). Both identical OFF/ON —
  the branding-primary redesign class (`project_identity_branding_primary_20260728`), plus the
  refuse-note holds on cross-supplier phash locks (herald's 172/175 — CORRECT protective holds).
- Demo gate + probes live in `stress_test/`: `demo_notes_gate.js` (sampled 2/supplier×type — no
  silent caps, logged), `heading_band_probe.py`, `geom_witness_probe.js`.

### Teach label pass-2 follow-ups  (2026-07-31)
- **Pass-1 type-heading gap:** teach still lacks a pass-1 `labelIsTypeHeading` reject (Review ⊕ has
  one at review/renderer.js:6792); pass-2 rejects headings (`isTypeHeadingLabel`), but a clean
  UNCLIPPED pass-1 heading read would still be offered. Port the reject to teach pass-1 + dedup with
  Review's copy (its test regex-extracts from renderer.js — move both onto the shared pure helper).
- **Review ⊕ two-pass adoption:** review/renderer.js ~3771-3786 builds the same open-loop 1.8× label
  band — same decapitation class, unverified there. Adopt the shared clip-gate + re-read
  (`clusterTouchesClipEdge`/`labelRereadRect`/`cropBoxToPageNorm`) in the ⊕ tool.

### ✓ SUPERSEDED for the V-class — clipped-suffix reconciliation SHIPPED ON (2026-07-31 night, `36a4a32`)
- The section below was AMENDED by Oracle after a traced single-doc run showed the 'V-69523' class is
  an `anchor_registration` box misplacement (~76px right of the value start) whose read WINS over the
  discarded correct keyword read — label-confirmed methods are shape-EXEMPT (engine:4692), so neither
  the crop-matte fix (pixels outside the crop) nor the escalation rung (trigger never fires) could
  touch it. Shipped instead: `_reconcile_clipped_suffix` (kill `CANDIDATE_SUFFIX_RECONCILE`, ON) —
  adopt the fuller keyword read of the SAME token from the always-on candidate ledger (suffix +
  digit-identity + shape-pass + confirmed-prefix membership), flag-only without prefix support.
  Gates: OFF byte-identical; ON ref 91.8→94.5%, M 8→7 zero new members, heals #121/123/124/136/137.
- **Amended Oracle rulings (2nd pass):** XRES escalation = DO NOTHING for now (both rungs; revival
  gate = a MEASURED count of withhold-branch abstains-after-GATE_REREAD on the corpus); oscar crop
  fix DEFERRED pending its own measured heal; **NEXT: garbled-anchor remediation sweep** (07-30-era
  taught rows with garbled labels, e.g. Ridgeway 'Inwotce No.' — re-teach or purge, then re-trace
  #121 on a clean anchor); registration.py fit audit ONLY if the ~0.03-norm misplacement survives
  remediation; 225 preset stays PARKED and the CURRENT 225 measurement is CONFOUNDED both ways —
  re-measure only after guard + remediation (added to C7 preconditions).

### Cross-res escalation re-read + "Faster (225)" preset — Oracle-gated plan (2026-07-31 night)
- **Origin:** live "Worksh Eet" garbled Add-type nudge at owner's `ocr_dpi=200` speed test. Full dpi
  sweep (202 docs, GT=confirmed): 150/200/240/250/260/275 each garble 1-4 tracked headings (different
  docs per res — decorrelated lottery); 225/280/300 clean; 280 only 7% faster (pointless). Realdoc:
  225 = type/supplier 100% (even heals #54, wrong at 300) but ref 90.1% vs 91.8%, **M 8→9** (prefix
  clip 'INV-35900'→'V-35900' crosses into auto-file; digit-dup 'PO-64334'→'PO-643224'). Scratch data:
  session scratchpad `filed*.tsv` / `rr300.txt` / `rr225.txt` (regenerable).
- **Oracle verdict (gary+oscar consensus vetted):** SIGN OFF W/COND on the escalation mechanism at
  **300-base only, dark**; **DO NOTHING (parked)** on the 225 preset. Killer fact (Oracle traced,
  overturning gary's stale-docstring read): `format_anomaly_checker._fold_shape` folds the digit-run
  length of ANY single-run shape — `'@@-#####'`→`'@@-#'` — so the 225 digit-dup class PASSES shape,
  never triggers escalation, and has ZERO in-pipeline guard. Length-invariance is BY DESIGN
  (`project_numeric_shape_fold`); do not revert it.
- **Build order (never bundle):** (1) oscar's crop fix — outward-rounded crop bounds + 12-16px white
  matte on field slices (cures edge-glyph drop at ALL res, incl. the 'V-xxxxx' class living at 300
  today on #121/123/124) — standalone, own switch, own realdoc M≤8 pass FIRST (it changes crop bytes
  everywhere, so it must precede the escalation baselines). (2) Slice 1 field rung `XRES_GATE_REREAD`
  inside `_maybe_gate_reread` (engine.py ~2729-2815/4782): injected `render_page_fn(page_idx,dpi)`
  from process_docs (pypdfium2 + recorded rotations; None for image-imports/born-digital), one cached
  alt render per (doc,page) keyed (dpi,pidx), independent LOCATE at alt res (no frame mapping).
  Lane A files clean ONLY IF: passes the exact failed check AND digits byte-identical AND base is a
  contiguous suffix with alpha-only prefix len 1-3 AND (C1) learned-shapes non-empty + ref/code field
  class only AND (C2) completed prefix ∈ confirmed prefixes via `ocr_corrector.lookup_prefix`
  (membership, not distance) — else lane B (cap 69 + corrected_to + note, customer-plain copy).
  Method stays original tier, never authoritative. (3) Slice 2 heading rung 3 `XRES_HEADING_REREAD`
  (same adopt contract as rungs 1-2; re-green `demo_notes_gate.js` ON+OFF — composes with 4a058a6).
- **Other conditions:** C3 PINs (digit substitution NEVER lane A; agree-but-still-fails = reject;
  never method-authoritative) · C4 RAM (alt-render cache ≤2 pages/doc, freed per doc — slow-PC
  feature must not re-create import RAM starvation) · C5 gates (300+ON vs 300 byte-identical-or-
  better M≤8; OFF byte-identical; probes #131/#121 lane A, #70/#163 lane B, stable no-fire control)
  · C6 merge seam: engine-emitted `corrected_to` (GATE_REREAD lane B, handler.js ~246) currently
  gets OPERATOR-grade veto power in the reprocess merge — add the pinned case to
  `test_reprocess_annotated_empty.js` + fix the comment; do NOT redesign the merge in this feature.
- **C7 preset revival (v2, only then "Faster (225)" returns):** trigger-widening length signal
  (single-group ref digit-run length differs from uniform in-scope confirmed length → fire re-read;
  cross-res agree → clean, disagree → lane B) + oscar's native-dpi-relative base/escalate rule +
  a gate asserting every new-wrong-at-225 doc is healed-or-flagged (absent-from-M-by-luck ≠ pass)
  + evidence on REAL 300-native scans (this corpus is 150-native; 225 there is an upsample — on
  real scans it's a downsample and likely worse). UI swap (150/200→225/300 + write-back snap) was
  edited then REVERTED per verdict — do not commit a Faster preset before C7.

### Validation slices S-A/B/C/D — gary-designed 2026-08-01 overnight, AWAITING ORACLE (not built)
- **Evidence base:** realdoc 202-doc residual M=5 + 8 regressions decomposed into classes; the #141
  delivery_number trace ('21/07/2026' committed to a REF field @88 silent). gary traced the WIN to
  Tier-A (engine.py:3764): the Ridgeway anchor row is an operator ⊕ teach (last_authoritative_at) →
  authoritative=True; Tier-A never consults confidence; `located` is BY FIAT for anchor_registration
  (anchor.py:1376 membership — even after relocate PROVED label_off_taught_position); ocr_min_conf
  is None for non-free-text (anchor.py:1497) → _ocr_clean blind; `alphanumeric` pattern contains `/`
  → a date has coverage 1.0. Registration rung also RESURRECTS a shape-failing read (anchor.py:
  1175-1177) and is _LABEL_CONFIRMED (shape-exempt everywhere). "Distrusted as witness
  (KEYWORD_ANCHOR_CORROB independence-fraud exclusion), trusted as winner" — the one-sided
  contradiction is the primary lever.
- **S-A date-in-ref flag** (kill DATE_IN_REF_FLAG): engine pass beside _flag_prefix_outlier (order:
  suffix-reconcile → S-A → prefix-outlier → S-B); ref-role/reference fields whose value FULLY parses
  as a date (validator.parse_date + full-string 3-component same-separator regex belt) → cap 69 +
  customer-plain note, NEVER null; exempt manual/template_fixed + scopes whose OWN shape accepts it;
  gary deviation FOR ORACLE: keyword_override NOT exempt (label authority ≠ value authority).
  PINs: '20260731'/'21/07'/'DN-24/07/26' NOT flagged; '12.05.11' FLAGGED (pinned trade-off).
  Highest rank: deterministic, near-zero regression surface, holds at EVERY floor (the note is the
  only floor-independent block — trust.js:601 flagged check).
- **S-B ref digit-run LENGTH profile** (kill REF_LENGTH_OUTLIER_GUARD, build OFF): ocr_corrector
  beside the prefix model — digit_run_profile tuples ('7602-1354-4'→(4,4,1)), build_length_index
  with DOMINANT_MIN_COUNT/SHARE + the weight-aware self-heal accept bars; exact tuple match; flag
  cap 69. Catches accretion (#33 'INV-12110') + digit-dup ('PO-643224') that the LENGTH-FOLDED shape
  cannot see (fold BY DESIGN, untouched, pinned). Rollover PIN: 'INV-1000' vs uniform (3,) FLAGS —
  accepted trade-off. Note precedence S-A > prefix-outlier > S-B.
- **S-C blind-geometry disagreement reconciliation** (kill BLIND_GEOM_DISAGREE_RECONCILE, DARK,
  flip=owner+gates): post-merge pass (suffix-reconcile pattern, ledger, no new OCR). v1 scope:
  winner method == anchor_registration EXACTLY (NOT inline/relocated — pinned, protects the
  2026-07-26 Tier-A re-teach fix; NOT rigid anchor_crop — already shape-gated); winner fails own-
  supplier shape; ledger has independent-stage (0_template/0.5_mapping/1_keyword) shape-PASSING
  disagreeing candidate. ADOPT when ≥2 independent stages agree normalise-equal (the #141 case:
  keyword_override@93 + template_mapping@90 both 'DN-24408') — a method inadmissible as corroboration
  witness cannot silently overrule two admissible witnesses; FLAG (cap 69, both values named) when
  only one. Deliberately narrows the authoritative-wins invariant for anchor_registration only
  ("the teach fixed the position, not the value" doctrine) — state in commit + pin.
- **S-D registration fit audit** (investigation only): measure per-fire n_inliers/residual/landmark
  spread/target leverage/provenance (07-30-era landmarks?) vs realised divergence (#141 = 0.047 norm
  vs the 0.02 inlier bar). Hypotheses H1 n=2 vacuous similarity fit / H2 leverage extrapolation /
  H3 stale landmarks / H4 similarity-vs-affine. Cheap gates if evidence: min_inliers=3, leverage
  refusal → keyword fall-through, or trust-cap 69+flag. Fix only on clean separation, zero clean-case
  collateral; else data remediation (re-pin landmarks), not code.
- **S-B2 conforming-profile confidence corroboration** (separate switch, DARK, own Oracle pass —
  never bundle with the flag slices): solo keyword read capped 85 whose digit-run profile AND prefix
  are both confirmed-dominant in a supported scope → +3 (the Stage-4.5 support boost falls 1 short).
  The direct MORE-auto-commits lever, alongside S-C's ADOPT lane and the unbuilt Stage-7 stage 3
  field_format_rules.
- **Expected residual after S-A+B+C:** {#65, #154, #86} interior stroke-level substitutions — only a
  second-render/second-engine witness could reach (the parked xres design's territory).

### Type-note placement — twice-misread as a supplier failure (2026-08-01)
- The type-refuse/ambiguity note attaches to the SUPPLIER row (engine `_flag_type_ambiguity`), so
  it renders under DOCUMENT ISSUER — the owner twice read a fully-resolved issuer@98 as "can't
  resolve the supplier". Follow-up: surface type-level notes beside the TYPE selector / in the
  summary band instead of under the issuer field (renderer placement; the emit could carry a
  `note_scope: 'type'` marker). Small, UX-only.

### Interior digit stroke-substitution — INVESTIGATED + ORACLE-VETTED, ready to build (2026-08-01 evening)
**007 measured pack + Oracle round complete** (oracle_log 2026-08-01 4th round; evidence preserved in
`stress_test/out/stroke_sub_2026-08-01/` — matrix.json ~30 reads/doc at 150-600dpi, per-stage traces,
600-dpi glyph exhibits). Axis = READING (placement clean on every exemplar; oscar crop-matte fix
REFUTED for this class). Substrate: 150-DPI-native JPEG rasters, digits ~10px, JPEG ringing closes
1px counters (2↔3, 9↔3, 5→8/9/3). THREE read chains flip independently (locate ~133dpi 1100px /
crop-ladder / full-page keyword — doc-291's one digit read three ways in one run). Tier-A precedence
commits the error (anchor.py:1037 nulls inline ocr_conf = structurally exempt from the Tier-A garble
gate); on #291 wrong inline@85 beat CORRECT keyword@85 sitting in the ledger at every DPI.
- **Class re-drawn (Oracle + main session both eyeballed exhibits): #86/#154/#285 = GT-POISON** —
  pages print well-formed '24/03/2026'/'DN-38884'/'WS-43842' vs contradicting confirmed values
  (30/30 unanimous high-conf reads = correct-OCR-vs-wrong-GT fingerprint). True OCR class = #65,
  #283, #291, #299 + the healed 259 signature. **REMEDIATION FIRST (owner): eyeball the 3 exhibits,
  then Learning Repair de-confirm → correct to printed value → re-confirm** (confirmed poison feeds
  live shapes/hints/S-B indexes — gt_overrides alone insufficient). Do BEFORE any gate baselines.
- **D1 BUILT + ON (same day): in-band digit-disagreement flag** — kill `DIGIT_DISAGREE_FLAG`.
  `engine._flag_digit_disagreement` LAST in the pinned note chain; comparator =
  `suffix_reconcile.digit_substitution_diff` (SHARED with future D2 — one impl, one pin;
  census-lockstep with `stress_test/census_digit_disagree.js`). Ref-role only; distinct-stage
  witness conf ≥60; 1-2 digit diffs on identical skeleton; flag-only cap 69 + corrected_to + copy
  directing to the DOCUMENT. **Gates all met:** census 300 docs → 1 fire = the #291 true catch,
  0.00% false (bar ≤3%); 31 pins green (`tests/test_digit_disagree.py` — C3 value-never-changed,
  S-B-territory exclusion, suffix-adopt interplay, ref-role-only, order pin); realdoc OFF-vs-ON
  diff = EXACTLY #291 silent→flagged, would-auto-file-wrong 9→8, values byte-identical corpus-wide.
  Census predicate kept ≤2 (0.33% fire-rate — no tightening needed). Dominant-snap exemption
  SKIPPED (census showed zero such cases — revisit only if a snap-winner false-fire ever appears).
- **D2 BAKE-OFF RAN ×2 — REFUTED BY MEASUREMENT, BANKED (do not build on today's numbers).** Oracle
  re-spec (witness = second-downsample-geometry locate read, NOT value-box crop) was probed twice
  over every Tier-A-won ref winner (234-doc then 296-doc corpus; single-token then line-join
  harvest — scratchpad bakeoff_d2{,_v2}.py, results in out/stroke_sub_2026-08-01/): **400→1100 =
  ZERO correct catches** (299 fires with a WRONG third reading 'WS-72098'; 65/283/291 abstain) at
  2.74-3.04% false fires (at/over the 3% hard bar). **600→1100 = ONE correct catch (#65
  'PO-24729')** at 1.30-1.71% false fires — 5 spurious review flags per ~300 docs (incl. two on the
  fresh Thornbury batch: 'PO-95717'→witness 'PO-35717' 9→3 — the substitution physics is chain
  noise both directions), ~0.7s/doc latency on ~every templated doc. **False:true 5:1 — worse than
  the needless-flags class the 07-31 session spent a day removing.** The 283/299 abstains are
  CHAIN-level (the alt-res page genuinely doesn't present the token same-skeleton), not harvest
  fidelity — measured with both harvests. REVIVAL CONDITIONS: a witness chain with measured ≥2-of-3
  class catch at ≤1% false (e.g. label-anchored band harvest may cut false fires — but cannot cure
  the abstains), or the class growing past ~3% of corpus. Honest post-D1 residual: #65/#283/#299
  silent (3 of 382 ≈ 0.8%), #291 flagged live by D1, #86/#154/#285 = owner Learning Repair.
- **D3 REJECTED (DO NOTHING): never-harvest-values-from-locate-pass** — inverts the July-31 arbiter
  premise (crop box routinely swallows label tails/clips prefixes — the traces' own anchor_reject
  lines show it), heals only #291 which D1 already flags, resurrects the clip class. BANKED future
  path instead: full-res re-LOCATE (solve box precision — 007-A's own revival precondition).
- Also REFUTED by measurement: global preprocessing/binarisation changes (no recipe at any DPI read
  the poison-free saturated cases; flips recipe-stable); 400-as-primary (fixed 283/299, broke 65
  worse + 285@400 lost PLACEMENT entirely — DPI non-monotone). Substrate fix out of app reach; a
  low-scan-quality import advisory = future barry idea.

### ✓ SHIPPED AND LIVE — Label-tail crop CLAMP (kill `ANCHOR_LABEL_LEFT_CLAMP`) — 2026-08-02
> Doubly stale, corrected 2026-08-08. It is no longer dark and no longer default OFF: shipped as
> `336585a` (Oracle had already GO'd the flip) and the live DB currently holds
> `anchor_label_left_clamp = true`, verified by a read-only settings query. Heading kept for its
> design notes; the "BUILT DARK / default OFF" claim below is obsolete — read it as history.
**Status: implemented per the signed design (all of C1-C7); 26 pins green
(`python_backend/tests/test_label_left_clamp.py`); gates run via
`stress_test/clamp_gate_diff.js` over two RR_CONSENSUS realdoc runs — see the 2026-08-02
handover for the G1-G6 results. Oracle ADJUDICATED 2026-08-02: ACCEPT-AS-RESIDUAL, GO on the
flip. AMENDED GATE LETTER: "zero UNRESIDUALED flips" (in-class + review-bound both runs +
provably witness-unreachable + logged with watch bars); the one residual = #218 (Vellum
interior 9→0 on the cleaned crop — page prints SO-68195, 600-DPI-verified,
zooms/doc218_600_wide.png). Watch bars W1 (auto-filed anchor_crop ref correction with
1-2-digit same-skeleton diff ⇒ kill pending re-gate) · W2 (stroke-sub residual ~3% revives D2)
· W3 (stroke-sub scopes nearing graduation: confirm against pixels until ocr_dpi 300).
Flip = set env `ANCHOR_LABEL_LEFT_CLAMP=1` (owner call).
Design + conditions kept verbatim below for the record.**
**The label-bleed class (007-measured, Saltmarsh 20-doc batch + corpus):** rigid taught crops are
built label-blind (+20px fixed pad, anchor.py:3282) while scans jitter (141px width spread + skew)
⇒ 13/16 crops intrude the label tail; fate trifurcates on the tail's OCR (clean→files ·
≤2-char debris→recovered@85 HOLDS EVERY BATCH · 3+char→inline rescue files · opposite jitter→
ws09 near-miss WRONG value). 47 recovered rows / 4+ suppliers = corpus-wide tight-gap topology.
Evidence: scratchpad geom_300.json + traces (session 2026-08-01); oracle_log entry.
**Fix (dark, kill `ANCHOR_LABEL_LEFT_CLAMP` default OFF):** located-label LEFT-edge clamp at crop
derivation — (P) caption-band mirror in the LOCATED frame. Conditions C1-C7: C1 expected-value-left
= located label top-left + STORED OFFSET (:3508 convention), never the taught box (frame trap —
fixture pin that a taught-frame impl FAILS); C2 authoritative+real-label+direction right+offset
present+locate+_located_at_taught_position, else byte-identical; C3 structured val_types only
(free-text ladder re-crop bypasses); C4 all four crop sites (:519/:685/:1076/:861 cross-check) or
pin the asymmetry; C5 in-crop degenerate reverts to UNCLAMPED (never refuse); C7 reuse the :1391
locate. Gates G1-G6: OFF==ON byte-identical outside the class · zero recovered rows auto-file-
eligible · ws09 identical ON/OFF · unit pins (merged-box/tight-gap/no-locate/non-right/(P)-twin/
C1-frame) · throughput ≤2-3% · total realdoc flag count must not rise · realdoc M=0 zero value
flips · Saltmarsh 20/20 ref auto-file-eligible 0 recovered. Sequencing: clamp → oscar matte
(label-aware, bounded by clamp) → full-res re-LOCATE independent; caption-prefix strip stays DARK
as the no-locate spare.
- **Cured sub-class (6237398): merged-doubled-digit** — REF_LENGTH_WITNESS_RECONCILE ON heals the
  'WS-1904'-for-'WS-11904' family from the ledger on the artifact's fingerprint (one digit inserted
  adjacent to an identical digit); rollover-drift pinned unadoptable; authoritative winners get
  flag-with-suggestion only.
- **Second live exemplar + a cheaper sub-class (2026-08-01, Vellum worksheet_18):** page prints
  'WS-11904'; anchor_inline read 'WS-1904' (doubled '1' merged — segmentation, not substitution)
  and WON the tie over keyword's CORRECT 'WS-11904' (both @85, anchor tier outranks). S-B FLAGGED
  it live (4-vs-5 digit note — the guard's first real catch). The trace shows the cure candidate:
  an inline-vs-independent-read DIGIT-COUNT disagreement arm — when a same-field ledger candidate
  PASSES the scope's length profile that the winner FAILS, prefer/flag (the S-C pattern extended
  to anchor_inline, currently pinned OUT to protect the 07-26 re-teach fix — that pin needs its
  own Oracle round before any widening). Segmentation drops ARE decorrelated across reads (keyword
  had it right) unlike pure stroke substitutions.
- **Third live exemplar (2026-08-01 ~15:42, owner screenshot, Vellum worksheet_01):** page prints
  'WS-73541'; anchor_inline read 'WS-7354' (TRAILING '1' dropped — the locate-chain 1100px thin-glyph
  loss, 007-measured mechanism) and won Tier-A over keyword's CORRECT 'WS-73541'@85; anchor_crop had
  the right digits but swallowed the label tail ('Vo. WS-73541') → credibility-rejected rx 25%. S-B
  FLAGGED live (4-vs-5 note + WS-73541 suggestion, Accept path used). Correct current behaviour;
  strengthens the digit-count PREFER arm's revival case (correct value passed the length profile the
  winner failed, in-band, twice).

### ✓ SHIPPED — Home "Open Mailbox" deep-link — OWNER 2026-08-02
> Resolved by `b67688a` (new open-search-window-at channel) — see the SHIPPED list at line ~595.
> Ticked 2026-08-08.
**Owner:** "the open mailbox button in home just opens the search window, not the mailbox."
The WAITING-ON-YOU card's button (main/index.html:~842) opens the Search window cold; the
user then has to find and click the Mailbox toggle themselves — the button promises a place
it doesn't take you.
**Fix shape (the open-review-window-at pattern):** a pending "open at mailbox" target —
`open-search-window-at('mailbox')` (main stores the target; the search renderer consumes it
once on load via a `get-search-target` read, or receives a `search-goto` event when the
window is already open) → toggles the Mailbox view (`SearchMailbox` toggle path) on arrival.
Same mechanism generalises later ("open at recycle bin", "open at doc N").

### ✓ SHIPPED — Search preview error-state hardening (eternal spinner) — OWNER 2026-08-02 (live repro)
> Resolved by `bf9fe90` (selectDoc guarded, honest error state, pin `test_preview_error_state.js`) —
> see the SHIPPED list at line ~592. Ticked 2026-08-08.
**Owner:** "when i click a doc in search i see a spinning icon but the doc doesnt load."
**Immediate cause (that session):** stale-main — the running app predated `b747676`'s new
`get-document-detail` IPC while the reopened search renderer already called it; the invoke
rejected ("No handler registered") and NOTHING catches it. Cleared by an app restart.
**The real defect it exposed:** `search-preview.js selectDoc()` has NO error handling — both
awaits (`getDocumentDetail`, then `getDocumentPages`) are bare, so ANY fetch failure (missing
handler, DB hiccup, doc deleted mid-click, IPC error) leaves the placeholder spinner forever
with zero feedback — the exact silent-failure class Chris keeps catching.
**Fix shape:** wrap selectDoc's fetch sequence in try/catch → on failure replace the spinner
with an honest state ("Couldn't load this document — try again or reopen Search." + the
short error) and clear it on the next selection; same guard on the mailbox row click and
resubmit (they share the fetch). Bonus hardening: a renderer-side "handler missing" message
that says "the app was updated — restart to finish" (the stale-main class keeps producing
exactly this symptom after main-process commits; a truthful message turns a mystery into a
one-line instruction). The renderer-error diag forwarders (08-02) already log the rejection —
the log line exists; the SCREEN state is what's missing.

### Custom approval stamp: placement, resize, and the decision note ON the stamp — OWNER 2026-08-02
**Owner:** "can we make the approval stamp custom in that you choose where it goes and can
resize it to fit a blank area on the page. Can we also add the notes from the approval to
the stamp?"
**Today:** `src/services/pdfStamp.js` `stampWorkflowDecision` draws a FIXED stamp (position/
size hardcoded) on the decision copy; the resolution note (`resolution_comment`) is recorded
on the route + shown in History/Sent but not printed on the stamp.
**Shape of the work:**
1. **Note on the stamp** — cheap first slice: render `resolution_comment` (wrapped, truncated
   ~2-3 lines) under the APPROVED/REJECTED / By / Date block in pdfStamp. Escape/measure text;
   long notes elide with "…" (full note stays on the route + History).
2. **Placement + resize** — an interactive step at decision time (or a per-install default in
   Settings → a "stamp position" picker): show page 1 in the stamped-viewer-style pane, drag
   the stamp rectangle to a blank area, resize by corner; persist per-install default
   (settings key) + optional per-decision override. pdfStamp takes {x,y,w,h} normalised.
3. Consider auto-suggest: pick the largest whitespace region on page 1 (cheap raster scan)
   as the default landing spot — "fit a blank area" without the user dragging every time.
**Watch-outs:** the stamped file is a DERIVATIVE (original untouched) — no learning/extraction
impact; the known wart that two approvals on one doc share a stamped path (second overwrite
wins — eric 2026-08-02) should be fixed alongside (per-route stamped filenames); Print-Slice 2
(stamped printing) consumes whatever pdfStamp writes, so land this before/with it.

### Core Search re-skin to the detached-client design — OWNER 2026-08-02
**Owner:** "the search dialog in the search client looks a lot more modern and graphical than
the search feature in the core app — replicate the design of the search client in the core
app — it looks more robust."
**What the client has that core lacks** (client/renderer/index.html): a designed component
system — tinted state CHIPS (`.chip.confirmed/.pending/.rejected…` pill + rgba state tints),
`.rolechip`, count `.badge`/`.seg-badge`, `.chip-btn` filter pills, `.segmented` control
groups, SVG icon buttons (`mkBtn`+`ico()`), meters — where core's Search window renders a
plainer list (`.result-item` rows, text badges). Both already share theme.css tokens, so this
is a COMPONENT + LAYOUT port, not a palette job.
**Shape of the work:** (1) port the client's component CSS into the core Search window (or a
shared `search-components.css` both import — preferred, stops future drift); (2) markup pass
over the ~8 core search renderers (search-results/preview/actions/mailbox/workflow/query
inline-render their class names — logic and IPCs UNTOUCHED, re-skin only); (3) load the
`scan-finder-frontend-design` skill for the design pass; (4) keep every contract suite +
test_no_global_collisions green; (5) a Chris VISUAL round after (he can screenshot now —
capture-window.ps1) to judge it as a customer.
**Guardrails:** don't fork behaviour between the two apps — where the client's affordance is
better (chips, segmented boxes), core adopts it; where core is ahead (cap note, de-pathed
rows, secure viewer, teaching empty-states), the client inherits LATER (named follow-up).

### Focus-fix FIELD SWEEP + forward convention — OWNER 2026-08-02 (live repro on the workflow note)
**Repro (owner, live):** typing "I approve" into the workflow note field (`.wf-note`,
search-workflow.js `_decisionBar`) on a doc routed to them hit the keyboard-focus desync
(no caret / keystrokes dead until clicking out of the app and back).
**Why it slipped past the systemic cure:** the universal repair is a PRELOAD `pointerdown`
chokepoint (preload.js ~:454 — heals every `input/textarea/[contenteditable]` PRESS in every
window). It cannot fire when a field gains focus PROGRAMMATICALLY — and the workflow note does
exactly that (`note.focus()` on the empty-note Reject path), as do other `.focus()` call sites
around the app. Second suspect class: native `confirm()`/`alert()` sites that don't call
`markFocusSuspect()` afterwards (the suspect flag is what forces the deterministic
blurWebView→wc.focus edge on the NEXT press — main.js ~:943-976).
**The sweep (build later):**
1. Enumerate every programmatic `.focus()` on a text control across all window renderers;
   route each through a shared helper that performs the repair edge first (invoke
   `ensure-window-focus` then focus — the same (A)+(B) sequence the chokepoint does), or
   simulate the chokepoint by dispatching through it.
2. Enumerate every native `confirm()`/`alert()` site; ensure each calls
   `window.docusnap.markFocusSuspect()` on return (several new dialogs landed 08-02 —
   delete-all rewords, counted Empty-bin, split guards — verify all).
3. A source-scan PIN (contract-test style): every `confirm(`/`alert(` in a window renderer
   must have a `markFocusSuspect` within N lines, and every programmatic `.focus(` on an
   input must go through the shared helper — so the class can't regrow.
**Forward convention (owner rule): every NEW field or native dialog ships wired to the focus
repair as part of its implementation — reviewers treat a bare `.focus()`/`confirm()` as a
defect.** Memory: `project_focus_repair_mechanism` carries the original design.

### Document-detail DTO (finish the de-pathing) — NAMED 2026-08-02 (Oracle C3)
The search ROW surface is de-pathed (`a58bc10`), but `get-document-with-extractions` →
`previewService.getDocumentDetail` → `getById` `SELECT *` still ships the SELECTED doc's
stored/working/folder paths + full ocr_text to the search renderer on every row click (and to
the mailbox click + resubmit flows). Fix = a caller-aware `dto.projectDocumentDetail` in
previewService. **ORACLE'S EXPLICIT WARNING — this must be CALLER-AWARE, not a global strip:
Review consumes `doc.folder_path` (review/renderer.js:~1261 page fetch) and `doc.ocr_text`
(~2489, ~5099 name-presence) from the SAME IPC — a blanket strip breaks Review's page preview
and name-presence check.** Same class, lower priority: get-review-queue / get-deferred-queue /
getByIds ship `SELECT d.*` into the (admin/edit-only) Review window. Also the true end-state
for the raw shell channels: a main-side `open-filing-slips-pack` IPC, then DELETE
open-file/show-in-explorer (the slips round-trip is their last legitimate caller).

### Workflow due dates + pending nudges — BANKED 2026-08-02 (Chris r4 card 7, bob-vetted)
Chris's "what paper never managed": a due date on a route ("needs an answer by Friday") + a
gentle nudge for items sitting pending. Full build = `due_at` schema + a scheduler + overdue
surfaces + NEW workflowNotify event types (the toast event list is PINNED — extending it needs
its own Oracle pass). NOT night-sized; product value real but roadmap-tier (his switch-week
conditions were the Reject fix + the approval record, both done/underway).
**Night-sized appetiser (no schema, no scheduler): an ageing chip on open rows/banners —
"waiting 6 days" computed from `document_routes.created_at`, shown past ~3 days.** Roughly half
the nudge value for an evening.

### R2 cohort pick admission — DEFERRED with revival evidence (Oracle 2026-08-01)
- Banked from the type-refuse deadlock arc (11b7ae9 shipped R1+R3+reword instead). R2 = admit a
  band-13 _letterhead_cohort member with document_type_slug == detected_slug into the Stage-0 PICK
  when title_trusted (heals doc #2 of a new type with zero confirms). REVIVAL EVIDENCE: after
  R1+R3 live, the refuse-note class still recurs materially (more than the expected single
  teach-window note per new supplier-type pair) on the demo gate or live. Conditions if revived:
  trusted-title gate only; detail-veto ordering intact; margin-3 untouched for the untrusted path;
  cohort sibling passes the SAME downstream qualification gates (no gate bypass); cohort anchored
  on an in-margin member's non-null dominant_supplier.

### Template-system FINE-TUNING + "all methods, then verify" — OWNER 2026-08-02 (two live exhibits)
Owner-declared next major arc: "We will work on fine tuning the template system soon." Two live
exhibits from the Customer Doc Test teaching run show the per-doc method mix swinging wildly:
- **Exhibit A (SFDEV reprocess):** trace shows ONLY `template_mapping` + `keyword` — no taught/anchor
  methods despite green dots — and the mapping reads are "getting the anchors and the values wrong".
- **Exhibit B (NorthgateTextiles_purchase_order_02.pdf):** the OPPOSITE mix — po_number/po_date won by
  `anchor_inline` (the `anchor_crop` candidate read `'No. PO-2590!'` and was rejected not_credible —
  the label-tail intrusion class), supplier via `hint_t…`; NO template_mapping row at all (identity
  pill says "Remembered positions") and NO keyword candidate in the trace. Value ends CORRECT at 97%
  yet still carries the "couldn't be confirmed anywhere else on the page" flag.
**Why the mix swings (mechanism, partially verified):** the engine is precedence-first-win with
skip-if-credible fast paths — Stage 0.5 only produces when a template MATCHED with mappings for the
field; anchor rungs skip when an earlier read is already credible (anchor.py "already found by
higher-priority anchor" / `_skip_rigid` / fast-happy-path comments); keyword rows appear only when a
pattern produced a candidate. So each doc shows a different winner chain — nothing runs "everything,
every time". A wizard teach lands as Stage-0.5 mappings, so its reads surface AS `template_mapping`
(there is no separate "taught" label); ⊕ Review teaches surface as `anchor_*`.
**Owner's design direction (the banked feature): ALL methods applied, then the data VERIFIED** —
cross-method consensus instead of first-authority-wins. Foundation already exists: the always-on
candidate ledger, 2.6b located corroboration, S-C distinct-stage witness, suffix/length reconcile.
Design questions for the session: full-run cost (every rung every field = real OCR spend — probably
verify-on-disagree or verify-on-flag, not brute force), how consensus interacts with authority
precedence, and whether the corroboration flag should stand down when methods AGREE (Exhibit B's
correct-but-flagged read).
**Investigation list:** why Stage 0.5 missed on Northgate _02 (template match failure on the scan
rendition? mappings not covering the fields? scope key?) · why keyword produced nothing there ·
whether an authoritative ⊕ anchor properly outranks a wrong template_mapping read when both exist
(Exhibit A's complaint) · dev-inspector labelling — surface "taught (wizard)" vs "taught (⊕)" so
green dots and trace rows reconcile for the owner.

### SFDEV EVERY-STEP trace — OWNER 2026-08-02 (next session, NO code this session)
**Owner rule: the dev inspector must show the RESULT OF EVERY STEP so an error can be read
without re-running — "so I know exactly what the system was dealing with". That is the point
of the dev feature.** Today's trace shows the winner chain + competitive candidates; the
skip-if-credible fast paths are mostly SILENT — a stage that never attempted looks identical
to a stage that attempted and lost, which is exactly the confusion behind Exhibit A/B above.
**Build (next session):**
1. Emit a trace event for EVERY stage/rung per field — attempted (candidate + accept/reject +
   reason, as now) AND skipped (`{stage, rung, field, skip_reason}` — "already credible from
   template_mapping", "no template matched", "no anchors in scope", "no keyword pattern hit",
   "cross_supplier_placement_skip", …). The skip REASON is the data.
2. Inspector renders the full per-field ladder: every stage in pipeline order with its
   outcome — produced/won, produced/lost-to-X, rejected(reason), skipped(reason).
3. Cost guard unchanged: events only under `--trace` (inspector/console open or diag logging) —
   normal processing stays byte-identical; skip events are cheap strings, no extra OCR.
4. Pairs with the fine-tuning arc above: the every-step ladder is the observability that the
   "all methods, then verify" design will be judged against.

### Digital ↔ scanned bleed (same supplier, divergent layout)
- **Confirmed (Set B warm):** a digital doc reusing a live name inherits the scanned identity (**supplier
  90%**) but the scanned template's field geometry doesn't fit the digital layout (**ref 29%**, held).
- **gary's least-invasive fix (deferred):** extend the `_located_at_taught_position` layout gate to
  **same-supplier** authoritative rigid reads (today cross-supplier only, `anchor.py:~1404`) → a taught
  absolute box fails toward review when its caption isn't at the taught position on a divergent layout.
  NOT a source-partition (that's wrong for production — same supplier should share learning).

---

## Type detection

### TYPE_PRESENCE_VETO — Slice 0 (band reader) + Slice 2 (auto-type cure)  (night 2026-07-28)
- Slice 0: a title-band PSM-11/upscale reader (`read_title_band`) to erase the veto's ~1.5–2.3%
  fail-safe false-holds and feed the cure. Slice 2: arm-the-refuse so legible titles auto-type correctly
  — **flip LAST**, after the identity fixes soak; biggest regression risk (needs a full-corpus per-doc
  type-flip gate). Memory `project_type_presence_veto_20260728`.

### Identity branding-primary separation  (night 2026-07-28, designed)
- Vellum/Larkspur phash collision (64-bit hash = LAYOUT not mark). Fix = branding-PRIMARY supplier
  separation, coarse recall-only, 256-bit mark corroborates. Vellum PDFs are image scans → Slice B
  (reprocess) cure; Option C (geometry) = fresh-import SUGGEST-only. Memory
  `project_identity_branding_primary_20260728`.

---

## Testing infrastructure

### Install preset types + total/line-item fields
- The live DB has only 5 doc types (invoice/sales_order/purchase_order/delivery_note/service_worksheet)
  and **no total/line-item field on any type**. Install credit_note/quote/statement/receipt (Settings →
  Add from catalog) + add a total field, then re-run `score_demo_digital.js` to cover all 9 demo types +
  money extraction (currently untestable). Can be scripted into a copy DB.

---

## Security / hardening

### Cython engine + arm fuses + asar rungs  (discussed 2026-07-29)
- The extraction engine ships as sourceless `.pyc` (a speed bump — bytecode decompiles back to
  near-source). `.pak` = Chromium resources (non-issue); most `.py` = third-party libs + thin entry
  shims. **Real upgrades (deferred, own session — build-chain change + full smoke):** Cython-compile the
  engine → native `.pyd`; arm the Electron fuses (`HARDEN_FUSES`, RunAsNode/inspector off); the deferred
  asar rungs B/D/F/E (bytenode/obfuscation). Plan: `docs/BUILD_HARDENING_PLAN_2026-07-26.md`. Framing:
  raise the bar, not "uncrackable" — the **licensing gate** is the commercial moat, not code secrecy.

## Pure-vertical-inside-column seat clip — row-seat-mismatch sensor (open; named by Oracle 2026-08-06)
`TEMPLATE_EDGE_CUT_RELOCATE` (the placement pivot) only fires on a CUT-DETECTED clip —
`_find_edge_cut_words` is a HORIZONTAL sensor (left/right box edge straddles a row-band word). A taught
box seated too high/low whose value is fully INSIDE the box's x-range (a pure-vertical clip, no
horizontal word cut) never arms the guard, so neither the grow nor the relocate triggers — it stays
today's behaviour (clean/garbled abs commit). Need a distinct sensor: a full-page word overlaps the
box column but its OWN bbox is vertically mis-centred vs the read box (seat error), independent of any
horizontal cut. Then route it to the same `_edge_cut_relocate` re-seat. Repro leads: template_mapper.py
`_find_edge_cut_words` (horizontal only), `_snap_box_to_words` row-band admission. Own advisor→Oracle→
gate round.

## Stage-2 — snap-union witness CLEAN upgrade on the RE-SEATED box (deferred; Oracle 2026-08-06)
`TEMPLATE_EDGE_CUT_RELOCATE` Stage-1 commits the re-seated value FLAGGED (pre-fill for review) unless it
earns clean via confirmed/provisional shape consent. The shelved `_snap_union_witness` (net-negative on
a GROWN box) is SOUND when corroborating a PLACEMENT-CORRECT re-seated box — that would clean-heal the
teach-once no-history case (e.g. Larkspur delivery_docket_06 DN-58038, whose garble shares no glyphs
with the truth so the frag-tie can't clean it). NOT verbatim reuse: `_snap_union_witness` is written
against `grown`/grow-`edges`; feeding the re-seated box needs new plumbing + its own pins + its own
re-seat-frame regression gate (do NOT ride the headline "silent clean heal" on un-shelved code). Own
switch, own gate round.

## Taught DATE misread landing on a DIFFERENT valid date (owned elsewhere; Oracle C6 2026-08-06)
`TEMPLATE_DATE_INVALID_YIELD` heals only the IMPOSSIBLE-date subset of the taught-date tilt-misread class:
a taught date box that OCR-misreads a glyph such that the result is an unparseable calendar date
('03/04'→'33/04') now yields to a valid keyword date, flagged. But a misread that lands on a DIFFERENT
VALID date ('03/04/2026'→'08/04/2026', or a DD-MM/MM-DD order flip) PARSES — `parse_date` returns a date,
the yield branch is skipped, and the wrong-but-valid taught date can win (and, being a clean date @94,
auto-file). This valid→valid misread class is NOT caught here; it's owned by the shape/witness-reconcile
machinery + the crop-quality/deskew improvement (a tight taught date crop on a tilt is the root reading
fragility). Repro leads: LarkspurInteriors_invoice_08 (the impossible-date instance this fix healed);
engine.py `_invalid_taught_date_yields`. The complementary cure = extend the placement/deskew arc to the
date rung so the taught date box survives the tilt rather than leaning on the keyword fallback. Own round.

## Taught date/code crop read-path frame election (DIAGNOSED, design captured, build fresh — 2026-08-06)
> **⚠ PREMISE SUPERSEDED 2026-08-07 — DO NOT BUILD THE RAW-FRAME ELECTION.** Annotated 2026-08-08.
> A fresh 4-doc probe (filed Larkspur invoices, −0.5°…2.3°) REFUTED the premise below: the deskew frame
> is NOT the lever — the TIGHT TAUGHT BOX clips the leading glyph on BOTH frames at every angle, and raw
> is sometimes WORSE. The fix that actually shipped is `TEMPLATE_PAD_WINDOW_READ` (`837b7d6`, dates only,
> default OFF): a padded row-bounded re-read that FLAGS a confident disagreement and never swaps. See the
> banner at the top of `docs/designs/DATE_CROP_DESKEW_READ_2026-08-06.md` and the memory
> `project_pad_window_date_read`. The text below is retained as REJECTED PRIOR ART only — it is left in
> place because it records the empirical probe and the RED-gate pitfall, not because it is a work item.

ROOT of the taught-date-crop misread class (invoice_08 03→33, invoice_14 2026→2096, and the same-year
03→08 slice the merge-layer yields can't catch). PROVEN empirically (`<scratchpad>/datecrop_probe.py`):
on a 1.8° scan the taught date box read on the DESKEWED frame misreads the leading digit, while the RAW
frame + a small pad + psm6 reads it CORRECTLY — deskew degrades the 0.2–2° read (Tesseract self-tolerates
≤~2°). Fix direction (Oracle-BANKED): a read-path angle floor / raw-preferring frame election for CROP
reads (read raw pixels at level-composed placement via the level→raw inverse), + a psm6+pad rung for tight
code/date crops. CORE-pipeline change; a prior naive attempt (DESKEW_RAW_CROPS) RED-gated on placement, so
it MUST route through teach_angle_compose's level frame + the deskewedNormToRaw inverse. Full multi-slice
design + gate + the RED-gate pitfall: `docs/designs/DATE_CROP_DESKEW_READ_2026-08-06.md`. Owner chose to
build it from a fresh session (core change, not the tail of a marathon). Supersedes the C6 same-year
order-flip residual (that class is THIS fix's job — not another merge-layer guard).

## 2026-08-08 — totals-fix follow-ups + debug-table Slice 2 (owner asleep, autonomous session)
Context: HANDOVER_2026-08-08.md. The SFDEV debug-table shipped + two DEFAULT-OFF totals fixes shipped
(NET_MISREAD_TOTAL_FLAG + TOTAL_GROSS_LABELS, gated M=0, owner to flip). Deferred:
- **Customer field degrades on teach** — teaching ONE credit note drops the recipient field from cold-keyword
  79.6% to taught 41.7% (corpus scorer): the taught fixed box lands on label captions ("BILL TO"/"SITE ADDRESS")
  across variant layouts. All get a name-quality review flag today (safety holds). Design lead: for a taught
  free-text/name field that FAILS its quality gate, fall back to / corroborate with the keyword label-hunt read
  (keyword customer is 79.6%). Needs gary/reggie + Oracle; gate = customer lane up, M=0.
- **Robust shadow vat_tax read** (inline rate "VAT @ 20%") → lets the EXISTING `_reconciliation_pick_total`
  AUTO-CORRECT net→gross (turns the net-misread FLAG into a silent heal). Bigger blast radius; own switch/gate.
- **Extra gross labels (residual)** — reggie flagged "Balance Outstanding"/"Outstanding Balance"/"Balance Owing"
  as payable-but-statement-collision-risky. Add under TOTAL_GROSS_LABELS only after a full-corpus false-flag vet.
- **Debug-table Slice 2 — winning-crop persistence.** Today `debug_values.json` records value/method/conf/wrong;
  the slice-copy backend is built + path-defended but the renderer sends slicePath:null. Slice 2 = accumulate
  each doc's winning-slice-per-field at reprocess-complete while the SFDEV console is open (owner's gate:
  "slices saved only on reprocess with SFDEV open"), reusing the 63e0cb3 target_geom bbox-match. Then Submit
  copies the real crops into the debug dir.

## 2026-08-09 (cont.) — format-fail-yield residual (READ-layer) + customer-PO field split + Your-Order son fix
Context: HANDOVER_2026-08-09_CONT.md. This session REDESIGNED `TEMPLATE_FORMAT_FAIL_YIELD` (dark, gate GREEN,
`1bea059`) and shipped `CUSTOMER_PO_LABELS` (dark, M=0, `e656329`). Two new flags await OWNER FLIP. Deferred:
- **Clipped/mis-magnitude taught reads = a READ-layer arc (the real po_ref/total residual).** The merge-layer
  format-fail-yield can only catch FORMAT-INVALID taught reads ("Account"/"L922.14"). The dominant residual is
  FORMAT-VALID wrong values: clipped-prefix ("19979"⊂"PO-19979"), magnitude/sign clips ("£2"/"£-1,329.00").
  These are unfixable at the merge — the taught box must RELOCATE/ADAPT to the shifted value (or route through
  the existing `_pick_fuller_code`/un-clip consent+shape ladder). gary+Oracle BOTH rejected a merge-layer
  fuller-code containment swap (overrides a format-valid authoritative read on a weak heuristic; rb_531 class;
  cold-start dirty). Pinned OUT in test_stage05_format_yield.py ("19979"/"24511" PASS). Own gate + Oracle pass.
- **Dedicated customer_po_number / cross-reference field.** CUSTOMER_PO_LABELS currently piggybacks on
  po_number; a buyer's PO on a seller's invoice is conceptually a DIFFERENT field. Clean model = a dedicated
  field with `role_caption` so the party guards (`_ref_caption_party_conflict`) protect it. Schema + seeding +
  filing/learning change — beyond the smallest fix. (reggie.)
- **"Your Order"/"Your Order No" po_number labels + the son leading-boundary fix.** These captions were EXCLUDED
  from CUSTOMER_PO_LABELS because they activate a pre-existing sales_order_number double-fill: "our" ⊂ "your"
  and the son label "Our Order No" has NO leading word-boundary, so on "Your Order No: X" son already mis-grabs
  X. Fix = add `(?<![a-z0-9])` before the `Our Order` caption (keyword.py `_label_pattern`), THEN add
  "Your Order No"/"Your Order Number" to the po_number block (No-suffix first). Ship as a separate gated slice.
- **CUSTOMER_PO_LABELS field-presence gap.** The default Invoice type has no po_number field, so the flag is
  inert there until either the type carries po_number or the dedicated field above lands. Note in any real-world
  recall claim.
