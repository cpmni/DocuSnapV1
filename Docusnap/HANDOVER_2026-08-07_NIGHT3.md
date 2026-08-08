# HANDOVER — 2026-08-07 (night 3, autonomous) — the delivery-note defect FIXED · ref-role digit gate · shadow-row deadlock · all three DARK and GATED GREEN

**Branch** `feat/reprocess-throughput-autostraighten` · **HEAD `359f2c7`** (+ this handover) · all
pushed. Continues `HANDOVER_2026-08-07_NIGHT2.md`, whose NIGHT PLAN this executed. Owner asleep;
standing authorisation was "run on auto and safely, no regressions".

---

## TL;DR
Three slices BUILT, all **DEFAULT OFF**, all gated green, all committed and pushed. **No flips, no
confirms, no writes to the live DB** — the Pelican documents are exactly as the owner left them.

| slice | commit | what it fixes | headline gate |
|---|---|---|---|
| `TEMPLATE_INLINE_ROW_OVERLAP` | `d3cca7c` | the delivery-note caption hijack | Pelican **5 healed / 0 regressed**; realdoc 714 byte-identical |
| `REF_ROLE_DIGIT_GATE` | `7a02422` | captions committing as references, system-wide | corpus **0 T→F / 7 F→T**, ref 45.4% → 47.9% |
| `TRUST_SHADOW_ROW_SKIP` | `5948f9c` | the invisible-row auto-file deadlock | realdoc auto-file **536 → 538**, wrong-value auto-files **unchanged at 17** |

Plus `359f2c7`, a new read-only harness (`stress_test/ref_role_digit_ab.js`).

**THE ONE CROSS-CUTTING PROOF:** a post-edit realdoc baseline with all three flags OFF is
**byte-identical to the pre-edit baseline** — report AND per-doc jsonl, 714 documents. That is the
dark guarantee for all three edits at once, measured rather than asserted.

---

## 1. `TEMPLATE_INLINE_ROW_OVERLAP` — the delivery-note defect, FIXED (`d3cca7c`)

**Mechanism (007, confirmed):** `_target_inline_with_anchor` decides "did the operator teach this
value on the label's own ROW?" and decided it with `max(anchor_h, target_h, _DRIFT_FLOOR)`.
`_DRIFT_FLOOR` (0.02) is a *drift* constant — "has the page moved a row?" — reused as a *same-row*
tolerance. On an A4 render that is ~70px, 1.5–3 line pitches, so the predicate called boxes one, two,
even three lines apart "inline" and admitted precisely the label-ABOVE layouts its own docstring
claims it excludes.

**The fix is the definition, not a constant:** `tol = (anchor_h + target_h) / 2` — the geometric
meaning of vertical overlap. DPI-invariant, no magic number, scales with whatever was drawn.

**ONE PREDICATE, THREE DOORS.** It is the sole gate of BOTH `_inline_code_reconcile` call sites
(`:1241` drift rung / `TEMPLATE_INLINE_CODE_RECONCILE_DRIFT`, `:1880` absolute rung /
`TEMPLATE_INLINE_CODE_RECONCILE`), so fixing it closes both — isolating only one is why NIGHT2's
arm B healed 1 of 5 and looked like a refutation. `_inline()` (`:1255`) is a third door with no
switch and no layout guard at all; it is guarded here too, but **only where a stored offset exists**.
A legacy offset-less mapping keeps `_inline()` as its PRIMARY read — it has no geometric model behind
it, so guarding it there would delete the read instead of routing it to review. **That asymmetry is
pinned**, deliberately, so nobody "generalises" the guard into the legacy path.

**Named seam (what this disables downstream):** a label-above mapping whose geometric read fails no
longer gets a same-row second chance — it falls to the registration fallback and then omits the field
→ REVIEW. Intended direction, but it is a recall trade, not a free win.

**Gates**
- **Pelican A/B, arm D = this flag with BOTH reconciles left ARMED: 5 healed, 0 regressed** — value
  for value identical to NIGHT2's arm C, which achieved 5/5 only by disabling both reconciles
  wholesale. 4 of the 5 now commit CLEAN at 90 (`template_mapping`); `#727` heals at 70 via
  `template_mapping_padcode`.
  ```
  #727 Delivery -> PD26668C   #730 -> PD266842   #733 -> PD251023
  #735 -> PD26785             #736 -> PD251197  (the TEACH SAMPLE, healed)
  #728 #729 #731 unchanged @90 · #732 #734 unchanged @70
  ```
- **The two other label-above mappings on that template are untouched**: `delivery_date` and
  `customer_name` — 0 moved, 0 emptied. Their geometric read succeeds, so door C is never reached.
  (Door C's guard is type-agnostic, so this had to be measured, not assumed.)
- **realdoc 714 docs: report AND per-doc jsonl byte-identical.** *Not vacuous* — 2 of those documents
  (`#728`, `#732`) sit on the affected template and are exactly the pair arm D leaves alone.
- **Cross-template census (A2, the blast-radius question):** 38 taught mappings carry boxes; **35 are
  already inline; 3 change — all on template 33 (Pelican).** Label-above teaching is RARE in this DB
  (one template), but where it happens **every field of that template is mis-classified today**.
- **Customer corpus: byte-identical — and INERT, not a pass.** That corpus runs as a cold install with
  no learned templates, so Stage 0.5 never executes there. Recorded honestly; the heal evidence is the
  Pelican A/B, the no-regression evidence is realdoc.
- **15 pins**, including the OFF path still reproducing the bug at BOTH the predicate and door C.

**Residual carried from NIGHT2:** two healed values have OCR character errors (`PD26668C` for …6680,
`PD26785` for an 8-char code). The RUNG hijack is fixed; those are read-quality residuals for a
separate look.

---

## 2. `REF_ROLE_DIGIT_GATE` — reggie slice 1 (`7a02422`)

`PO_REF_DIGIT_GATE` encodes a corpus-proven fact: an order-family reference is a CODE — a spaceless
run bearing ≥2 digits — never a caption or footer prose. **The predicate was right; its ARMING was the
literal pair `('po_number','sales_order_number')`**, so every other reference field on every type had
no value-side gate at all. Widened to the REF ROLE via `_infer_validation(field_key) == 'alphanumeric'`
— the same role inference Stage 1 already trusts to seed a custom field's format gate.

**Newly armed on this install:** `credit_note_number`, `delivery_number`, `invoice_number`,
`reference_number`.

**Recall measured BEFORE building, not asserted after:** across every CONFIRMED value of those fields
(713 rows), **ZERO fail the digit predicate**. `PD/26/6680`, `PO 22954`, `DN-98447` all still read.

**Gates**
- **Customer corpus: 0 true→false, 7 false→true.** `ref` 129/284 → 136/284 (**45.4% → 47.9%**); every
  other lane (date, total, issuer, customer, vat_no, account_no, job_ref, po_ref, type) byte-identical.
- **The heals are exactly the class**, and they are HEALS not just withholdings — traced to source on
  `Meadowvale-Dairy_delivery_note_0064`: baseline read `'Meadowvale'` (the supplier's own name as a
  reference); armed reads the CORRECT code, still `method=keyword`. The gate's `continue` falls through
  to the NEXT LABEL, which finds the real value. Same for `'Despatch'`, `'DESPATCH REF'`, `'The'`.
- **realdoc 714: byte-identical.** INERT there and the reason is structural — a confirmed document by
  definition holds a value someone accepted, so the caption class barely exists in that population.
- **Review-queue A/B** (new harness `stress_test/ref_role_digit_ab.js`, 8 needs_review docs): 0 dropped,
  0 changed, 0 appeared. Also inert — the Pelican defect travels the TEMPLATE mapping path, not keyword.
- Pins green, including the OFF path still committing the caption and the parent switch dominating.

**Expect a THROUGHPUT change if flipped, not an accuracy one**: a document that used to commit a caption
may now arrive EMPTY and route to review. On this corpus it mostly fell through to the *correct* value
instead, which is better than the design predicted.

---

## 3. `TRUST_SHADOW_ROW_SKIP` — gary's shadow-row deadlock (`5948f9c`)

`_shadow_reconcile_components` writes rows with `extraction_method='shadow_reconcile'` purely to back
the "totals add up" check. They are INVISIBLE in Review, EXCLUDED from learning, DELETED at confirm,
and are not filing inputs — yet `docTrustGate` judged filability on them. For a shadow row on a field
the type does not define there is never a format row, so the gate returned
`unverifiable-value:<field>`: **the document could never auto-file and the operator could never see,
let alone clear, the row that blocked it. Sealed twice.**

Skip only when the row is genuinely inert: shadow method AND not a defined field of this type AND not
a structural role key; fail-open on missing field metadata. Placed **AFTER** the `validation_note`
check, so a FLAGGED shadow row still blocks. A VISIBLE foreign row still blocks — preserving the
2026-07-22 foreignFields Oracle condition.

**THE HARNESS TRAP WAS FIXED FIRST, AND THE FIX WAS VERIFIED IN ISOLATION.** `realdoc_regression.js`
and `services/sweepPredicate.js` built their gate overlays WITHOUT `extraction_method`, so every row
would have reached the gate looking like a non-shadow row and the gate would have gone green having
tested nothing. Both now thread it — **and the pre-edit baseline equals the post-edit baseline
byte-identical, which is gary's required "confirm the threading alone changed nothing" step.** The
vacuity itself is pinned as a test (an overlay without the field cannot fire the skip).

**Gates**
- **realdoc: auto-file 536/714 → 538/714. Wrong-value auto-files UNCHANGED at 17 — identical list.**
  Not vacuous. The two unblocked documents are `#718` and `#726` (Castellan Security credit notes),
  both correct on every field, neither in the wrong-value list.
- Everything else in the report byte-identical (8 jsonl diff lines = those two `wouldFile` flips).
- Pins green: OFF reproduces the deadlock; ARMED files; a FLAGGED shadow row still blocks; a shadow row
  on a DEFINED field is not skipped; a VISIBLE foreign row still blocks; the vacuous-overlay demo.

---

## HOW TO FLIP (nothing is flippable yet — deliberate)
All three read `process.env`. **No Settings bridge or toggle was added** — the night plan said build,
gate and design, and adding UI was outside it. The flip path for the two extraction flags is the
established one-commit pattern (precedent `60606d9`): a `learning.getSetting` line in
`processing/handler.js` `_reconcileEnv` + one paired Settings → Processing toggle, defaulting off.

**`TRUST_SHADOW_ROW_SKIP` is different and needs a decision.** It is a JS-side gate in `trust.js`, not
a spawn env, so a `_reconcileEnv` bridge does NOT reach it. Either it reads a SETTING instead of
`process.env`, or main sets the env at startup from a setting. That is an owner/Oracle call, not a
mechanical bridge.

To trial any of them right now without touching settings:
```
TEMPLATE_INLINE_ROW_OVERLAP=1   REF_ROLE_DIGIT_GATE=1   TRUST_SHADOW_ROW_SKIP=1
```

---

## DESIGNED, NOT BUILT

### gary's second defect — `REPROCESS_SHADOW_STALE_DROP` (the pair to slice 3, in that order)
`processing/handler.js:557-572`: a row the NEW run no longer produces is carried forward VERBATIM,
`extraction_method` and all. So after the VAT guard shipped, a reprocess that no longer mints
`vat_tax='0027.84'` still carries the OLD row forward, and the renderer's "✓ mathematically verified"
badge is driven by a stale shadow row whose premises are gone.
- Fix: in that carry-forward loop, skip when `ex.extraction_method === 'shadow_reconcile'` and the new
  run produced no row for that key. A shadow row is a DERIVED artefact of the current read — carrying
  it across a re-read carries a conclusion whose inputs no longer exist. A real field row still carries
  (the operator may have seen or corrected it).
- Open question to settle first: whether to require that the new run actually RAN the shadow component,
  so a run that legitimately skipped it cannot blank a still-valid row.
- Trace marker `dropped_stale_shadow`; switch default OFF; pins = non-shadow rows still carry, a shadow
  row whose key IS in the new run is replaced not dropped, the `flip` type-change path unchanged.
- **HONEST GATE GAP:** realdoc does not exercise the reprocess merge, so this one cannot be gated the
  way tonight's three were. It needs the reprocess harness or a live-DB dry run. That is the reason it
  is designed and not built tonight.

### reggie slices 2–5 (unchanged from NIGHT2, still valid)
Slice 2 (commit the taught VALUE to the taught document) is **owner-facing — design + Oracle, do NOT
build unattended**. Slice 3 is INERT on Pelican (`'Despatch Ref'` is already a shipped label). Slice 4
(column-aware `below`) is the largest and needs the witness-equality join. Slice 5 is blocked on
whether the winning label survives into the extractions row.

### Still open from NIGHT2
- The `Harrowgate-Timber_quote_0046.pdf` / `L922.14` residual: `trust.js` routes currency to
  `_currencyDpConsistent` only, never consulting `_currencyish`. One-line right-layer fix, own gate.
- **`delivery_number` is type `text` with NO `validation_patterns.text` entry**, so that field has no
  format gate at all. Retyping it to `reference_code` would close the class but changes validation for
  every delivery note already filed → **owner decision, still flagged, still not done.** Note that
  `REF_ROLE_DIGIT_GATE` now covers much of this class without the retype.

---

## KEY FACTS / GOTCHAS (new tonight)
- **A flat lane is not a pass, but an EXPLAINED flat lane can be.** Two of tonight's lanes were flat.
  Both were explained at the source rather than waved through: the overlap flag is inert on the customer
  corpus because that corpus is a cold install with no learned templates (Stage 0.5 never runs), and the
  ref-role flag is inert on realdoc because confirmed documents hold values someone accepted. Where a
  flat lane could NOT be explained it was made non-flat (the shadow-row lane moved 536→538).
- **`customer_corpus_score.js` writes `customer_score_<TAG>` and TAG defaults to `base`** — three runs
  without distinct TAGs overwrite ONE jsonl and you lose the per-doc comparison. Use `TAG=`.
- **The scorer records `<lane>_got` only when the verdict is WRONG.** A heal therefore reads as
  `'Despatch' -> None` in a naive diff, which looks like a value being lost when it is the opposite.
  Read the `verdicts` sub-dict, not the `_got` keys.
- `realdoc_regression.js` still writes a FIXED filename — the night's runs copy each arm's report aside
  as `rd_<arm>.md`. Arms MUST run sequentially.
- Do not edit `template_mapper.py` / `keyword.py` / `trust.js` while any arm is running; workers and the
  second arm import fresh. Tonight's edits were all made between arms for that reason.
- The Python suite still has the same 4 pre-existing failures. Not chased.
- Owner's uncommitted edit to `python_backend/tests/test_template_target_word_snap.py` — untouched all
  session, not staged.

## PLAN DEVIATIONS — read before flipping anything

**The NIGHT2 plan's step 4 read "shadow-row skip: Oracle → thread `extraction_method` → build".
The Oracle review was NOT run.** The threading and the build were done and gated; the adversarial
review was not. The reason is a standing operating constraint on this session — advisors may not be
spawned unless the owner asks — not a judgement that the review was unnecessary.

So the sign-off position per slice is:
- `TEMPLATE_INLINE_ROW_OVERLAP` — 007's design, round 2, arm-C proven in NIGHT2. **No Oracle pass.**
- `REF_ROLE_DIGIT_GATE` — reggie slice 1, listed in NIGHT2 as build-ready. **No Oracle pass.**
- `TRUST_SHADOW_ROW_SKIP` — gary's design. **Oracle pass was PLANNED and SKIPPED.**

All three are DEFAULT OFF and byte-identical off, so nothing is at risk in the tree. But **do not read
"gates green" as "signed off"** — run Oracle on at least the shadow-row slice before it goes live,
since it is the one whose review was explicitly scheduled and missed. The specific seam worth pointing
Oracle at: the skip trusts `fieldTypes` + `roleKeys` to decide what is "invisible", which is the same
predicate `foreignFields.ownFieldPredicate` uses at the confirm-time drop — if those two ever drift,
a row could become skippable at the gate while still being visible in Review.

## ADVISOR TRACK RECORD
No advisors were spawned tonight (see PLAN DEVIATIONS above) — the work was execution plus
measurement against designs written in NIGHT2. Two NIGHT2 predictions were tested and both held:
007's `(anchor_h+target_h)/2` predicate reproduced arm C exactly *without* the sledgehammer, and
gary's harness-overlay trap was real (pinned as a test). reggie's slice-1 prediction was BEATEN — it
forecast captions arriving empty, and on the corpus they mostly fell through to the correct value
instead.
