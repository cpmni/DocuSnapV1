# Putting the teach-poisoning class to bed

## Context

Chris The Customer has reported a variant of one defect for four rounds. Round 4 (2026-08-13) is
the first time it cost real files, and it moved his verdict from *"yes, and for the first time
without a condition attached to my documents' safety"* back to **"the condition is back on."**

The exhibit, verified in the sandbox DB and on disk:

1. An operator drew a slightly-off box on their own company name. OCR read
   `B8ramblewood Joinery Ltd`.
2. **Nothing was said** — not at the draw, not at confirm.
3. The teach **overwrote** template 13's frozen identity:
   `template_fields.fixed_value='B8ramblewood Joinery Ltd'`, `is_variable=0`.
4. That template stamped **20 sibling purchase orders** via `template_fixed` at **95 with an
   empty `validation_note`** — so every auto-file gate passed them.
5. 20 confirmed; **12 written to disk** under `Output\B8ramblewood-Joinery-Ltd\`.
6. The garble became a **learning scope key**. The company now exists twice, one character apart.

In the same session Chris hit the still-open **buyer-issued identity** class: template 13 carries
the owner's own company frozen on a `purchase_order` layout, so it claimed 40 inbound documents
from two other suppliers at 95%, with the owner's VAT number.

**Why it keeps coming back.** Every fix so far sits *downstream* of the teach. The teach commit
itself is an **unguarded write**, and the surface never speaks, so the operator cannot be the
guard either. This plan attacks the source and the surface.

### The one-sentence diagnosis

A teach is treated as unconditional truth about **what** a value is, when the drawn box is only
evidence about **where** it is — and the product already knows that rule in the other direction
(`teach_typed_value_locate`, 2026-08-10: *"a box is evidence about WHERE, never WHETHER"*).

### Owner decisions taken

1. Scope = teach-poisoning core **plus** buyer-issued identity.
2. Near-match: **auto-correct 1–2 characters silently**; escalate only when the garble is itself a
   plausible new name; exempt 3–4 letter acronyms.
3. Apply at **both** the teach seam and the extraction seam.
4. A teach replacing a frozen identity with a genuinely **different** value: **commit it, but hold
   the siblings** until a second document supports it.
5. Defaults **split by risk** — UI-only ships ON, extraction/freeze/auto-file ships OFF behind a
   toggle — plus a standing register of proven toggles.

### Two corrections to what I told you earlier

- **A census and a dictionary DO exist.** I said they didn't. `python_backend/extraction/
  wordness.py` + `data/char_trigrams.json` (~93 KB), built offline by `build_wordness_table.py`
  from **dwyl/english-words** (~370k, Unlicense) and **US Census 2010 surnames** (~162k, US-Gov
  public domain), compressed into character trigrams. It is blind here for a *normalisation*
  reason, not a threshold one: `wordness._clean` keeps only `a`–`z` (`:85`), so `B8ramblewood` is
  scored as `bramblewood` — a perfect word. `wordness.py:20-22` already declares this class out of
  scope in writing and points at the lexicon path.
- **The digit fix alone does nothing.** I said teaching the wordness test about an embedded digit
  would make your rule classify the exhibit correctly. Measured against the code: `name_quality`
  would fall only to **2/3 = 0.667**, and every consumer gate is `< 0.5` or `>= 0.5/0.6`, so all
  12 consumers are unmoved and `issuerReadLooksImplausible` still returns false. Three consumers
  would *regress* (`anchor.py:1360,1991` would reject single-token `3M` at 0.0 — the class Oracle
  already ruled on). The digit signal is still wanted, but as a **separate narrow predicate**
  consumed only by the new decision points, never wired into `_token_good`.

---

## THE ROOT CAUSE — previously unrecorded, and it answers a question open since 2026-08-12

`format_anomaly_checker.py:763-764`:
```python
if len(samples) < 3:
    continue
```
`samples = entry['sample_values']` is the **DISTINCT** value set (`learning.js:1408`), and this
`continue` sits **before** the name-lexicon build at `:766-791`. Meanwhile `learning.js:1388-1403`
deliberately emits a group when `_values.size >= 3` **OR** `_count >= 3`, its comment naming
constant fields explicitly. **Python discards exactly the groups JavaScript went out of its way to
emit.**

> A name scope whose confirmed history is ONE dominant literal — 38× `Bramblewood Joinery Ltd`,
> the strongest evidence this system can hold — gets **no lexicon**, in either the supplier-scoped
> or the doc-type fallback scope. The shipped STRONG repair is structurally inert precisely where
> it is safest.

That is why `Lid`→`Ltd` was silent, and it is a four-line finding, not a new feature.

**Two hypotheses were refuted at source, so they do not need re-testing:** the repair is *not*
gated on `_override_eligible` (the 4.5 branch at `engine.py:7917-7942` checks only `name_lex`
truthy and `key in text_field_keys`); and it did not "run and get dropped" — WEAK writes a note and
caps 70, STRONG writes an auto-corrected note, and the exhibit has an **empty** note at 95, so
neither branch executed.

**One decisive read-only query settles the remaining assumption** (that these scopes really carry
&lt;3 *distinct* confirmed values), run against a snapshot and the round-4 sandbox DB: group
`extractions` joined to confirmed `documents` by `(supplier_name, doctype, field_key)` for
`supplier_name`/`customer_name`, reporting `COUNT(*)` vs `COUNT(DISTINCT COALESCE(corrected_value,
display_value))`, plus the same rolled up with `scope=''`.

### The seam nobody had recorded

`engine.py:8332` is `results["_supplier_name"] = supplier_name` — the **local**, last assigned at
`:7220`, *before* Stage 4.5 begins at `:7720`. That value becomes `documents.supplier_name`, which
is **the filing folder and the learning scope key**. So even a repair that fires correctly heals
the extraction row and **leaves the folder and the scope garbled**. `engine.py:8374-8375` already
warns about this staleness, and `_flag_branding_conflict` consumes the local at `:8377`, *after*
`:8332`. Any fix relying on Stage 4.5 to heal the issuer must close this too.

### The data loss is worse than reported

`learning.js:325` runs **unconditionally** for every `corrections` entry —
`UPDATE extractions SET display_value=@corrected_value, was_corrected=1`. So
`_clearSuspectReadsForNewIssuer`'s `corrections[key]={…corrected_value:''}`
(`review/renderer.js:2642`) **blanks the stored extraction row and stamps it as corrected**. Two
outcomes:
- **Branch 1** (no re-render): screen blank, `allValues` blank, filename/XML lose the field, row
  blanked. This is what Chris saw.
- **Branch 2** (re-render fires): screen and filed name are *correct*, `corrections` still says
  `''`, so the **DB row is silently blanked** and search then misses a document the operator can
  see is right. Quieter and nastier.

There is a **second identical call site at `review/renderer.js:3070`** (issuer blur). Fixing
`:3890` alone leaves the commoner path broken. Root cause of both: the gate at `:2632` is a
**string comparison**, so it cannot tell an identity the operator *vouched for* from one the OCR
just produced.

---

## Established at source — supporting facts (do not re-derive)

**The write is unguarded.** `templates.js:1188-1197` — the only guard on the `fixed_value` UPDATE
is `fixed_locked=1`. No old-vs-new comparison, no audit row, and `template_fields` has **no
provenance column**. One teach runs the overwrite **twice** (`promote-to-template`, then
`onTaughtConfirm`). A second door, `set-template-field-fixed`, bypasses `_buildTemplateFields`
entirely.

**The issuer is deliberately ungoverned.** `freeze_guard.js:139` returns `null` for
`companyKeys`, because five shipped guards need the seed to EXIST (`:40-46`). All six terms of
`_buildTemplateFields`'s `isVariable` are structurally false for `supplier_name`.

**The empty note is explained, and the veto is unreachable.** `_flag_branding_conflict`
early-returns at `engine.py:3933-3936` when the supplier's branding is on the page — always true
on a buyer-issued PO, whose fingerprint *is* the buyer's own address block.
`TEMPLATE_FIXED_NAME_PRESENCE_VETO` lives inside that unreachable branch.

**Auto-file passes it on every gate.** Floor 95 met; the flagged refusal counts only a non-empty
`validation_note`; `supplier_name` is type `text` so `STRICT_TYPES` has nothing to check.

**Similarity alone cannot separate the cases — measured.** `B8ramblewood Joinery Ltd` vs correct
= 1 edit / 22 = **0.955**. `Brambleworth Joinery Ltd`, a genuinely *different* company, = 3 edits
/ 22 = **0.864**. Both clear the shipped 0.75 floor. The discriminator must be an edit **budget**
(≤2) conjoined with unreadability of the changed span, a human-attested target, and source
provenance.

**Metric choice, argued.** Levenshtein on the alnum fold normalised by max length — i.e. the
shipped `name_match.similar_identity`. **Not** Jaro-Winkler: its prefix bonus systematically
under-scores exactly this product's documented corruption class, which hits the first glyph
constantly (`lronciad`/`Ironclad`, `astellan`/`Castellan`, `Sramblewood`/`Bramblewood`). **Not**
token-set ratio: `Smith Ltd` vs `Smith Roofing Ltd` scores 100. rapidfuzz (already vendored and
build-enforced) as a **prefilter only**, pinned to `Levenshtein.normalized_similarity` so the
prefilter and the decider normalise identically.

**CLAUDE.md corrections to make in the same arc:** `identity_fusion.py` is **not** dormant
(rapidfuzz is vendored and build-enforced, `identity_conflict_flag` defaults ON, the conflict arm
sets `_needs_review`); `name_match` is not "suggestion-only" (STRONG auto-applies);
`template_freeze_qualify` is in `PROVEN_ON_DEFAULTS` and seeded `'true'` by migration 60; the warn
is at `renderer.js:3869`, not `:3634`.

---

---

## ⚠ ORACLE VERDICT: **SEND BACK** — the plan below is superseded by §"Revised plan" at the end

Oracle vetted the assembled consensus and sent it back. The three findings that break the design:

**O1 — the root cause is mis-ranked, and may be a sandbox artefact.** Stage 4.5's lookup
(`engine.py:7890-7891`) falls back to `('', dt_lower, key)`, which aggregates **every** supplier
confirmed on that type. On any install with ≥3 distinct confirmed issuers on `purchase_order`,
`len(samples) >= 3` **passes**, a lexicon IS built, and `_close('b8ramblewood','bramblewood')`
(d=1, ratio 0.917) repairs — as **WEAK**, i.e. capped 70 + "Suggested name correction" +
review-forced. **That is not silent.** So the recorded silence is consistent with Chris's sandbox
being thin, not with the code being inert in production. The `seed-taught-state.js` one-template
warning applies to *the silence itself*, and nobody applied it.

**O2 — the lexicon fix is unsafe in exactly the population it newly admits.** In a
single-distinct-value scope, every content position has `doc_freq == 1.0` **by construction**, so
`_STRONG_FREQ = 0.9` cannot discriminate — it is satisfied automatically. All that then guards a
**silent auto-apply** is `_close`: 2 edits on ≥6-char tokens at ratio ≥ 0.72. `Southgate` vs
`Northgate` is d=2, ratio 0.778 ⇒ `_close` TRUE ⇒ **STRONG ⇒ silent whole-value rewrite at full
confidence.** The STRONG tier was signed on the premise that `doc_freq ≥ 0.9` proves
near-universality across a *varied* history; this admits exactly the histories where that premise
is void. gary's "already-signed tier merely made reachable" is **unsound**; reggie's
reconciliation stands.

**O3 — it would make the failure worse.** The repair mutates `results['supplier_name']` only,
while `_supplier_name` (⇒ `documents.supplier_name` ⇒ the filing folder and every learning scope
key) comes from the stale local. Result: the screen and search index read the corrected name with
a friendly *"Auto-corrected to match learned data"*, and the file still lands in
`Output\B8ramblewood-Joinery-Ltd\`. *"Today's failure is uniformly wrong; Layer 2's failure is
wrong and wears a note that says it was fixed."* It also **launders** the mis-identification
guard: Stage 4.5 runs before `_flag_branding_conflict`, so a repair to the scope canonical
satisfies that check by construction, converting a correctable mis-identification into an
uncorrectable, unsignalled one.

**O4 — the real root cause, lower than anything the three advisors proposed.**
`templates.js:1195` — `fixed_value = CASE WHEN fixed_locked = 1 THEN fixed_value ELSE
excluded.fixed_value END`. **The writer never compares warrants.** A value backed by 38
confirmations, or by ≥W human confirms via graduation, is replaced by one draw-box OCR read of one
crop. There are **three** such writers, not one: `handler.js:1470` (teach/promote/link/
onTaughtConfirm), `graduationTemplate.js:118-126` (`graduation_freeze_issuer`, owner-flipped ON),
and the 2026-08-12 per-sender editor identity mint. And its only history-based defence,
`_fieldsWithMultipleConfirmedValues` (`handler.js:1371-1388`), is scoped by **`document_type_id`
only, never by supplier** — so on a type with ≥2 distinct confirmed issuers a teach **deletes**
the frozen identity instead of overwriting it.

**O5 — `Kwik-Fit` is not a residual, it is the class.** `kwik` scores below the wordness
threshold, so "the changed span is unreadable" reads a *correct* brand as garble. UK small-business
names are full of these (Kwik, Xpress, Kleen, Phixit, Bizzi), and the trigram table is English
words + **US** census surnames, so Welsh/Irish/Scots names (`Llanelli`, `Cwmbran`, `Aoibheann`)
read as garble too — in a Northern-Ireland-based product. **The wordness leg may only VETO, never
license.** Prefer the digit-inside-an-alphabetic-token signature as the narrow first arm: near-zero
legitimate rate in a company name, cheap, immune to both classes, and needs no language model.

**O6 — the machine-confirm precondition does not close the inversion.** Chris's 20 poisoned
documents were **human**-confirmed, so `confirmed_via` is not a machine sentinel and they count
toward `value_counts` regardless of the flag. After the exhibit the canonical sits at 38/59 = 0.64
— stable but no longer STRONG; one more poisoned batch **flips** it. The needed guard is narrower
and unconditional: *a value produced by the repair may never count as evidence for the repair*.

**O7 — two more misses.** `getFieldFormats` skips empty values, so eric's blank-write also
silently **removes** that document from the learning substrate. And there is **no remediation
surface** for state already poisoned — every proposed fix is preventive, so the customer's filing
tree stays split forever with nothing telling them.

---

## Superseded plan (kept for the reasoning; execute the Revised plan at the end)

### Layer 0 — measure first (blocking)

1. **Confirm the root cause** with the one query above.
2. **Census A — the veto.** Over every ordered pair of *distinct* known company names on a live-DB
   snapshot and the 200-doc corpus, the count classified AUTO-CORRECT must be **ZERO** — not low.
   Each such pair is a live silent-merge awaiting one glyph. Same bar as CONFADOPT and the
   note-demote slices.
3. **Census B — brand orthography.** If >15% of known names carry a token below the wordness
   threshold, the `not word_like` leg is weak on this population and the auto tier must
   additionally require the structural digit signature.
4. **Census C — yield.** If AUTO fires on ~0 documents the tier is inert and the risk is
   unpaid-for. Chris's exhibit is n=1, and one exhibit does not justify a silent-rewrite tier.
5. **Census D — substrate distinctness.** Names differing only by suffix canonicalisation or
   whitespace (`Acme Ltd` / `Acme Limited` / `ACME LTD`) are already-split scope keys. Likely the
   highest-value, lowest-risk part of the whole design.
6. **Record which template `seed-taught-state.js` grafts** each Chris round.

### Layer 1 — the teach speaks (UI only, ships ON)

- Say what was read, every time, on both surfaces, reusing the practice run's proven sentence:
  `Read "<value>" from your box.`
- **Speak on failure** — un-nest from `if (text)` / `if (detected)`. An empty OCR read currently
  produces nothing at all.
- Put the message on `#anchor-readout`, **not** a toast. The bar already renders a read value,
  hosts an editable input, is persistent and dismissible — and the issuer branch is the one case
  that skips it. A toast is provably destroyed by the next call.
- **Do not build a toast queue.** The failure is two messages in the *same tick*, so a queue shows
  the warning second, seconds later, after the operator has clicked on — and it would serialise 63
  call sites into a backlog on bulk runs. Instead: a sticky-**level** guard in `showToast` (an
  `ok` may not overwrite a live `warn`/`err`), plus move anything requiring an *action* onto the
  existing persistent surfaces.
- Fix the wizard's async race: `.catch(_ok)` currently maps **failure to success**, and
  `advanceField()` runs before the promise settles. Keep the advance responsive; move the verdict
  onto the field's own record and render it in the step-4 commit summary, *before* the
  irreversible commit.
- Say where the file went on confirm (`confirmCurrentDoc` already receives the filename and
  discards it). Give File All Ready the count and summary it already computes.

### Layer 2 — the near-match decision (owner's rule)

Three-way outcome — **AUTO-CORRECT** / **ASK-OR-REVIEW** / **ACCEPT-AS-NEW** — on a decision table
whose auto tier requires: unique target, edit budget ≤2 on the alnum fold, divergence localised to
exactly one token with equal token counts, minimum known-name length, target not an acronym or a
legal-form suffix, and the changed span **unreadable**.

Three things the attack pass forced:
- **`word_like` must be three-valued.** ABSTAIN never auto-corrects. Driver: `Nordisk Handel AB`
  vs a known `… AS` — the trigram model returns `None` below its minimum token length, and a
  two-valued predicate reads that as "not word-like" and **silently merges a Swedish and a
  Norwegian company**.
- **Legal-form suffixes are identity-bearing** (`Ltd`/`Lda`/`Oy`/`AB`/`AS`) and must never be
  auto-swapped.
- **The wordness leg is load-bearing, exactly as you argued.** `Northgate Motors Ltd` vs
  `Southgate Motors Ltd` is 2 edits in one token at sufficient length — the length, budget and
  token-count gates all pass it. It is saved *only* by `Southgate` being a readable word. Named
  residual: `Kwik-Fit Autocentres Ltd` and Welsh place-names, which an English + US-surname
  training set scores poorly.

**Tiered substrate — the single most important decision here.**
*Tier A* (may be an auto-correct **target**, ≥3 distinct documents): `accepted_name_values` /
`accepted_issuer_values`, `corrections`, and `documents.supplier_name` **excluding**
`MACHINE_VIAS`.
*Tier B* (may only veto or trigger ASK, **never** be a target): machine-via rows,
`supplier_hints`, `field_anchors`, `logo_fingerprints`, and **`template_fields.fixed_value`** —
because that is exactly where the poison lived.

**`learning_exclude_machine_confirms` is a hard, code-level precondition, not a note.** The
exhibit is the proof of the loop closing: 20 machine stamps at 95 with an empty note ⇒ auto-file
eligible ⇒ 20 confirmed rows of the *garble* enter `value_counts`. The only anti-dilution defence,
`_ocr_equiv`, is scoped to 3-char tokens and cannot fold an 11-char one. The code already names
this failure in `learning.js:1256-1259`. With the flag off, the tier must **degrade to
suggest-and-review**, structurally.

**Parity: hybrid.** A JS twin for the deterministic legs (normalisation, fold, Levenshtein, token
alignment, acronym and digit predicates, length gates, the decision table), following the
`text_normalise` golden-corpus precedent; the **trigram leg stays a Python authority**, because
porting a 93 KB table plus identical float summation order is unbounded drift, and scores near the
threshold would straddle. The payoff is structural: `wordness.available()` already returns false
when the model is missing, so **JS has everything needed to reach ASK and nothing needed to reach
AUTO** — the auto tier degrades to ask exactly when its evidence is absent.

### Layer 3 — the write stops being unguarded

**Do not widen `freeze_guard` to the issuer. Ask a narrower question:** *may this value replace a
DIFFERENT existing frozen identity?* A decline keeps the existing seed, so the five seed-dependent
guards stay armed. Separate predicate, separate call path, and the first freeze on a cold template
is untouched — only *replacement* is governed, which is exactly the observed defect.

Per your decision 4, a genuinely different value **commits**, but the changed identity does not
stamp siblings at 95 until a second document supports it.

Also: one shared `_onIssuerSettled(source)` replacing the identical triples at `:3070` and
`:3890`, so the clear becomes a consequence of an **accepted** identity rather than of a string
difference; a returned undo list; `renderFields(doc, {preserveEdits:true})` replaying from
`corrections`; `_resolveFieldVisibility` not unmasking on an *unresolved* sender; and
`_refreshTaughtForType` assigning its set only after a successful query, so a failure stops
asserting "nothing is taught".

**Owner call flagged by eric, not a technical one:** if a teach no longer clears the previous
supplier's reads until you accept the name, an operator who confirms without touching the bar
files with the garbled issuer *and* the previous supplier's values — the state today's clear
exists to prevent.

Plus: provenance on `template_fields`; close the double-write; cover the
`set-template-field-fixed` door.

### Layer 4 — containment

**Why the existing guard cannot be repaired in place.** `namePresence.nameBearingButAbsent`
abstains at a low presence ratio specifically so a *genuinely name-less supplier* is never
blocked. A garbled name and a name-less supplier are **indistinguishable by that measure**:
`b8ramblewood` is on no page, `joinery` on every one ⇒ 1/2 = 0.5 < 0.6 ⇒ never corroborated ⇒
ratio ≈ 0 ⇒ abstain forever. Lowering the ratio would start blocking real name-less suppliers.

**The inversion that works, and needs no known-name set:** the stored name is absent while a name
one or two edits from it **is present on this page**. Self-contained, per document, no gazetteer —
and strictly stronger than "absent", because absence alone is ambiguous and
absence-with-a-near-twin-present is not.

### Layer 5 — buyer-issued identity

**The detection predicate already ships and is proven.** `engine.py:6460` computes
`_buyer_issued = (ref_field_key == 'po_number') OR a trusted PURCHASE-ORDER heading`, feeding
`_suppress_buyer_seller_issuer` under `BUYER_ISSUED_ISSUER_GUARD`, **default ON**, pinned. It
drops the buyer's name from **keyword** results; it does not touch the `template_fixed` **stamp**,
which is the route Chris's 40 documents came through.
- **Slice 2** — `templates.buyer_issued` mark (additive column + migration) using that same rule;
  a marked template is refused by text arms for a document whose trusted title declares a
  different type. `TEMPLATE_BUYER_ISSUED_TYPE_SCOPE`, DEFAULT OFF. Confirmed absent today.
- **Slice 3** — the VAT-contradiction rail: a `template_fixed` stamp of a precise-typed field
  contradicted by a different well-formed same-type value on the page ⇒ note + hold. **Never
  blank, never unfreeze** (unfreezing VAT measured 51%→16% and is refuted).
  `extractions.corroboration` already records this disagreement, so the rail can be **measured
  from recorded rows before it acts**.

### Layer 6 — repair what is already in the DB

An operator route exists and is admin-only + audited: Settings → Learning Recovery →
`learning.renameSupplier`, which fixes six learning tables. Three gaps to close rather than new
machinery: it does **not** touch `template_fields.fixed_value`; it does **not** move files on
disk; and there is **no near-match detection to find the poisoned pair**, which Layer 2 supplies.
Plus the Layer-0 data remediation for the 20 documents, template 13, the garbled `field_anchors`
row, and the 12 filed PDFs — backup first, go-forward-only for everything else.

### Layer 7 — the toggle register

`PROVEN_ON_DEFAULTS` (`database/index.js:66-119`) **already is** this register — every entry
annotated with what it bought, plus a "NOT LISTED, and why" section so past rulings are not
re-litigated. The work is an audit and a ritual, not a new artefact: list every flag shipped dark
since migration 60, mark those with green gates, promote them via a migration in the existing
annotated style.

### Sequencing

Layer 0 blocks everything. **Layer 1 ships alone and first** — customer-visible, zero extraction
risk. Then the ASK-only half of Layer 2, which needs no census because it never rewrites. Layers
3, 5 and 7 are independent and can run in parallel. The AUTO tier ships only after Census A
returns zero and `learning_exclude_machine_confirms` is armed. Layer 4 follows Layer 2; Layer 6
last, since it consumes Layer 2's detector.

---

## Verification

- **OFF-arm byte-identity** over the corpus for every extraction-touching flag.
- **Armed arms require `RR_APP_ENV=1` *and* `OCR_RENDER_DPI=200`.** `realdoc_regression.js` passes
  none of the app's 63 spawn env vars, replays confirmed docs only, and models reprocess via
  `--reprocess-manifest`. `_ocrDpiEnv` is **not** in its mirror list, so `RR_APP_ENV=1` alone still
  runs 300 DPI against an app that renders at 200 — the same vacuous-arm trap that wasted a
  previous class arm. The *"the repair fires"* claim survives without these; the *"nothing else
  moved"* claim is **vacuous** without them.
- **Layer 1 and Layer 3 are structurally out of realdoc's reach** — the freeze happens at
  teach/confirm, which realdoc never runs. Their gate is the JS unit battery plus a new read-only
  census over the live and sandbox DBs: for every template with a frozen issuer, would the arm
  have declined it? Expect zero declines on correct literals, ≥1 on the known-bad template.
- **Read the supplier/customer lanes by hand.** realdoc's ground truth is the user's *confirmed*
  values, and on this install a confirmed value may **be** the garble — a lane "regressing" from
  `B8ramblewood…` to `Bramblewood…` is the fix working.
- **A pin per accepted trade-off**, including a deliberate pin that `name_quality` stays
  digit-blind, so nobody "fixes" it into the three regressions above; a poison pin that the garble
  can never become the lexicon anchor; and a pin that with the machine-confirm exclusion off, an
  identity repair stays suggest-only even at maximum document frequency.
- **UI smoke** for Layers 1 and 3, including the two branches of the blanking defect, the empty-read
  case (which today produces nothing at all), and the message surviving the next toast.
- **Chris round 5 is the acceptance test**, with the grafted template recorded. The bar: the
  round-4 teach experiment, repeated verbatim, must be spoken about at the draw and must not reach
  19 siblings or the disk.

**Tooling note.** No new agent definition is needed. The one capability the advisory roster lacks
is DB forensics for the Layer-0 censuses — a general-purpose agent plus persona with Bash, which
is this project's documented pattern.

---

# REVISED PLAN — execute this one

Oracle's nine blocking conditions, in its ordering. Each step is independently shippable and
independently gate-able.

### Step 1 — ✅ **DONE** (revised B2 — the layer MOVED after counter-evidence)

**Oracle's original B2 (a backend guard on the empty write) was withdrawn.** Traced before
building: `getFieldFormats` computes `(corrected_value || display_value || '').trim()`
(`learning.js:1363`) and `''` is falsy, so preserving the row would leave a value the operator
**deliberately** deleted feeding `value_counts`, the name lexicon and the dominance snap for ever
— closing the machine hole and opening the human one. The backend also cannot separate the two
cases (identical entries) and cannot be given a marker without a payload-suppliable field, which
the internal-`via` convention forbids. Oracle accepted: *"my B2 was aimed one layer too low… the
defect is that a machine-initiated clear impersonates an operator correction."*

**Shipped (`src/windows/review/renderer.js`):**
- **B2a** — `_clearSuspectReadsForNewIssuer` stages **no** `corrections` entry; the clear is
  recorded as a render fact in a new doc-scoped `clearedByIssuerChange` set. Filing is unaffected
  (`allValues` is a live DOM scrape); an operator's own clear is untouched.
- **B2b** — `renderFields` suppresses a cleared field across a repaint. Without it, dropping the
  corrections entry would let `_resolveFieldVisibility`'s rebuild **resurrect** the previous
  supplier's values into the inputs and the DOM scrape would file them — the exact hole the clear
  exists to prevent, re-opened by two individually-correct fixes.
- Release-on-edit: retyping into a cleared field removes the suppression, so the next repaint
  cannot blank what the operator just typed.
- **B2d** — the destructive clear's toast is now `warn`, not `ok`. With no corrections entry and
  no database trace, that toast is the only remaining record that N fields were emptied.

**B2c REFUTED at source and dropped** (one fewer commit, one fewer risk). Oracle believed
`clearAnchors` fired for every corrections entry and so an issuer correction destroyed a
previously-taught supplier's anchors. It sits **inside** `if (corrected_value)`
(`learning.js:331`, closed `:361`), so an empty value never reaches it. Pinned as a source
assertion so the belief is not re-derived.

**Gate:** new `src/windows/review/test_issuer_clear_not_a_correction.js` — 18 pins, behavioural
(the real clear + real scope predicate sliced from `renderer.js` and run against a stub DOM) plus
wiring and deliberate-non-change source pins. **All 10 review suites green.** All four critical
pins **red-proved against `HEAD`**. `node --check` clean.

**Owed:** UI smoke (needs the Review window reopened) — the two branches of the blanking defect,
and confirming a cleared field stays empty across a repaint and files blank.

### Step 1 (original brief, superseded above)

A live, unflagged data-loss bug with **no dependency on anything else in this arc**, and the only
item Oracle signed off to build as-is. `learning.js:325` must not write an empty `display_value`.
Both call sites must be covered — `review/renderer.js:3070` (issuer blur) and `:3890` (teach).
**Pin: a confirm carrying `corrections[k] = {corrected_value: ''}` leaves
`extractions.display_value` unchanged and does not set `was_corrected=1` — and the pin must FAIL on
today's code.** Fixing this also closes O7's learning-substrate hole; do not fix that separately.

### Step 2 — B1: ✅ **DONE, and it settles two things** (read-only, live DB, 2026-08-14)

Instrument: `scratchpad/b1_lexicon_premise.js` (read-only, both scopes, mirrors
`getFieldFormats`' own `COALESCE(corrected_value, display_value)` derivation).

**Result 1 — gary's root cause SURVIVES; Oracle's falsifier fires on 1 doctype of 9.**

| doc-type fallback scope, `supplier_name` | distinct | confirms | verdict |
|---|---|---|---|
| `sales_order` | **3** | 314 | passes — lexicon built (the falsifier) |
| `purchase_order` | **1** | 110 | **DROPPED** ← the B8ramblewood exhibit |
| `credit_note` | **1** | 133 | **DROPPED** ← the Meadowvale `Lid` exhibit |
| `statement` · `service_worksheet` · `delivery_note` · `quote` · `invoice` | **1** each | 84–121 | **DROPPED** |

Both exhibits are dropped in **both** the supplier-scoped and the fallback path. The recorded
silence is genuine code inertness, not a thin-sandbox artefact.

**Result 2 — Census E, and it lands on Oracle's side:**
```
distinct=1  groups=33      distinct=3  groups=1
distinct=2  groups=0       distinct=4  groups=2
TAUTOLOGY POPULATION (1-2 distinct, >=3 confirms): 33 of 36 = 91.7%
```
**91.7% of this install's name-learning surface has exactly ONE distinct confirmed value.** O2's
unsafe regime is not a corner case — it is essentially the whole population. Under the naive
lexicon fix, almost every name scope would get a `doc_freq == 1.0` lexicon guarded only by
`_close` (2 edits on ≥6 chars at ratio 0.72). **⇒ B5's WEAK-only ruling is mandatory, and any
"keep STRONG" option needs a genuinely new evidence test.**

**Incidental, feeds Census D:** `Pelican Office Interiors -` (trailing dash) is the confirmed
canonical for `invoice` across 84 documents — a known-bad name that has become ground truth.

### Step 2 (superseded text) — the original B1 brief

Run the decisive SQL on a **live-DB snapshot** *and* the round-4 sandbox, for **both** scopes —
`(supplier, purchase_order, supplier_name)` and `('', purchase_order, supplier_name)` — reporting
distinct-value count and `confirmed_count` for each. **If the live doc-type fallback has ≥3
distinct values, Layer 2's reward on this class is a sandbox artefact and the slice must be
re-justified before any code is written.** Also report **Census E**: how many name-like field
groups have exactly 1–2 distinct values — that number is the true blast radius, because it is the
population where `doc_freq ≡ 1.0`.

### Step 3 — ✅ **DONE** (`175d853`, DEFAULT OFF) — and it is a PRECONDITION, not a fix that pays today

Shipped: a late `_rederive_filing_identity` at the end of `extract()`, after every writer of
`results['supplier_name']`. **ADDED, not moved** — `supported_keys` and
`_flag_branding_conflict` still see the pre-repair local, byte-identical, and whether the
branding cross-check should judge the post-repair name stays a deliberately unmade decision,
pinned as such. Flag `identity_scope_post_repair`, bridged via `_reconcileEnv`, Settings toggle,
and a row added to `test_settings_wiring.js` BRIDGES (that file requires one per bridge — without
it the switch ships unpinned). 12 Python pins incl. the trade-off that an **empty** final value
never wins.

**Gate — no regression PROVEN, efficacy NOT proven, and the second half is stated plainly:**
- OFF vs ARMED over **1076 documents**, `RR_APP_ENV=1` + `OCR_RENDER_DPI=200` (the latter is not
  in the harness's mirror list and must be set by hand). Reports **byte-identical**, zero
  collateral.
- **Zero re-derivations fired** — the arm is vacuous as an efficacy test. Nothing healed a
  supplier name anywhere: `Auto-corrected to match learned data` 0, `Suggested name correction`
  0, `Letterhead may read` 0, in **both** arms.
- **Why, verified:** Stage 4.5's repair needs a `name_lexicon`, and B1 measured that 33 of 36
  name scopes never get one. **B3's trigger is disabled by B1's defect** — which is exactly why
  Oracle ordered B3 first. The moment Step 6 makes the repair fire without this in place, the
  panel says *"auto-corrected to match learned data"* while the file lands in the wrong folder:
  strictly worse than today, because the failure would wear a note claiming it was fixed.

**Baseline finding, unrelated to this change (identical in both arms):** the harness flags 6
documents that would auto-file a wrong value. Five are `ref`-lane rows where the **stored
confirmed value is the garble** — the serif `I→1` class (`'P1/26/6000'` vs the correct
`'PI/26/6000'`) and deleted printed slashes (`'PI263130'` vs `'PI/26/3130'`) — i.e. the pipeline
is right and the ground truth is wrong. **#464 `quote`, wrong on `total`, is not in that class
and has not been examined.** Also unexamined: **#535 `'SB-ORD42102'` vs `'SP-ORD42102'`**, a
genuine `B`/`P` confusable that needs an eye on the page.

### Step 3 (original brief, superseded above)

`_supplier_name` must be derived from the post-Stage-4.5 `results['supplier_name']`, not the stale
local. Own OFF flag, own realdoc arm, **nothing else alongside** — it changes
`documents.supplier_name` for every document, the highest blast radius in the arc.
`_adopt_identity_variant` (`engine.py:8361`) has the same exposure.
*Gate:* full-corpus realdoc, `RR_APP_ENV=1`, `OCR_RENDER_DPI=200`, import path — OFF arm
byte-identical; ON arm shows every changed `documents.supplier_name` moving toward the
corroborated value; **M=0**.

### Step 4 — B4 + B8 together: decline the OVERWRITE, and give the hold a voice

**B4 replaces the earlier "decline the freeze" shape, which Oracle ruled wrong.** Do not govern
the issuer in `freeze_guard.js` — its header states exactly what that disarms, and "identical to
any unfrozen field's normal state" is **false** for `supplier_name`, because the issuer's value is
the filing folder and the learning scope key.

At the **writer** instead: when an incoming `fixed_value` for `supplier_name` would replace a
**non-empty existing** one, compare warrants —
- **near-match** (`similar_identity ≥ 0.75`, ≤2 edits) ⇒ **keep the existing value silently.**
  This is your decision-2 posture, at the one seam where the candidate set is size 1.
- **genuinely different** ⇒ **commit it and hold the siblings** (your decision 4), with a visible
  reason.

The seed continues to exist, so all five seed-dependent guards stay armed and blast radius is one
row. **Enumerate all three writers** and state which are covered.

**B8 ships with it, because a hold nobody can see is indistinguishable from the product being
slow:** no branch may leave a value at 95 with an empty `validation_note` — that state *is* the
exhibit. eric's sticky-**level** `showToast` guard (an `ok` may not overwrite a live `warn`) plus
the persistent `#anchor-readout` surface; and the destructive clear-N-fields toast must stop being
`'ok'`. Plus Layer 1's teach-speaks work from the superseded plan, which Oracle did not contest.

*Gate:* structurally out of realdoc's reach. Unit battery over `_buildTemplateFieldsFromValues` +
`_upsertFields` with a pre-existing frozen row, **plus a replay of the round-4 teach in a fresh
sandbox** proving the frozen value survives and the siblings are held.

### Step 5 — B9: the remediation census (read-only, report only)

Name every template whose frozen issuer is a near-match of a ≥3-document confirmed literal, every
`field_anchors` / `supplier_hints` row scoped to such a value, and every filed path under it. **No
auto-migration.** Without this the customer keeps a permanently split filing tree.

### Step 6 — B5/B6/B7: the lexicon slice. LAST, and only if Step 2 says the reward survives.

- **B5** — WEAK-only for identity keys. STRONG may not be reached from a lexicon whose scope has
  <3 **distinct** values. Keeping STRONG there requires a *new* evidence test signed on its own
  merits, not inherited from the 2026-07 signature. **Pin: `Southgate Motors Ltd` against a 3-doc
  `Northgate Motors Ltd` lexicon must NOT auto-apply, and the pin must fail on the naive fix.**
- **B6** — three-valued `word_like`, ABSTAIN never auto-corrects; and `!word_like` may **not** be
  the sole AUTO licence (O5). Digit-in-alpha-token is the narrow first arm; wordness may only veto.
- **B7** — unconditional, no flag: a value carrying the auto-correct marker is excluded from
  `value_counts`/`sample_values` for its own scope.

*Never alongside Step 3 or Step 4; never while `graduation_freeze_issuer` is being flipped.*
*Gate:* OFF arm byte-identical; ARMED arm reports **auto-applied-and-wrong = 0 at DOCUMENT level**,
measured through `isAutoFileEligible` — the slice-3 B2 lesson.

### Census corrections

**Census A is over-scoped for the teach seam** — there the candidate set is exactly one string (the
value being replaced), so an all-ordered-pairs census measures a population that decider never
sees. Run it only against the doc-type-fallback path, which *can* compare across companies.
**Census C (yield) is the one that can kill the slice honestly:** if AUTO fires on ~0 documents
once B5/B6 are applied, say so and do nothing rather than ship an unpaid-for tier.

### Still in scope, unchanged by Oracle

Layer 5 (buyer-issued slices 2+3), Layer 6 (extend the audited `renameSupplier` route), and
Layer 7 (the `PROVEN_ON_DEFAULTS` audit and promotion ritual).
