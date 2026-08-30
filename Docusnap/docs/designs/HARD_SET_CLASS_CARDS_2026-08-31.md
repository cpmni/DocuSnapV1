# Hard Set class cards — 2026-08-31 night (advisory only, NOTHING built)

Three advisor cards on the top classes from `docs/HARD_SET_REPORT_2026-08-31.md`. Every card is a
DESIGN awaiting the owner's vet → Oracle → DARK build → gates. No code changed tonight.

---

## Card 1 (gary) — warm buyer-issued "silent steer" = designed doctrine + one real residual

### Mechanism (fact-checked; the briefing's conflict-arm hypothesis was WRONG)
- The value (both arms): the generator prints the vendor under a `SUPPLIER` caption on a doc with a
  trusted "PURCHASE ORDER" heading. Stage 1 reads the vendor, then `_suppress_buyer_seller_issuer`
  DROPS it by design (`_buyer_issued` = po ref-role or trusted PO heading, `engine.py:8117-8121`;
  caption set {supplier,vendor,seller} `keyword.py:1657`; drop `engine.py:5556-5585`). The
  Oracle-signed 2026-07-12 doctrine: on a buyer-issued PO the Document Issuer IS the letterhead
  buyer (`test_buyer_issued_issuer_guard.py:2-10`). With the field emptied, the buyer fills it.
- Cold flag: `letterhead_prefill` (mig-77 forced ON) fills the buyer @69 + "…confirm it's the
  sender, not the customer" (`engine.py:10437-10443`) — flagged twice over.
- Warm silence: a learned path fills BEFORE the noted cold reader (fill-empty-only,
  `engine.py:10382-10387`), no note. Primary candidate (strong arithmetic: overall 31 =
  (95+0+0)/3): Stage-0 claim by t8 — the owner's ONE Bramblewood PO template, buyer_issued-marked,
  113 bound confirms; the gen deliberately matches the customer-corpus letterhead, so fingerprint
  hits sit IN the band the scope guard admits by design (config A = its own paper). Fallback:
  Stage-2.5a `hint_text_match` @85 no note. One traced warm run settles which — do before building.
- NOT the mechanism: identity_fusion's conflict arm (cold gazetteer empty → no flag possible; warm
  chrome genuinely reads Bramblewood = resolved supplier → agree).
- THE BIGGER FINDING — GT vs doctrine: two prior Oracle rulings score "buyer-issued POs correctly
  filed under the issuer Bramblewood" (`oracle_log.md:1615,1733`). These 7 "wrong" reads are the app
  doing what the doctrine + the confirmed corpus define as right. Config B (teach the counterparty
  as issuer) is the supported opt-out.

### The seam
`template_buyer_issued_letterhead_scope` protects template RECOGNITION only — stops a marked
template claiming OTHER suppliers' papers via BILL-TO text; it deliberately admits a doc whose band
IS the buyer's letterhead (these 7, correctly). No reach into `hint_text_match` or the letterhead
reader; no opinion on which party is the issuer. Known residuals at `pendingfeatures.md:82-96`.

### Smallest-fix direction (design only, DARK, fail-toward-review)
- **Lever 0 (no code): fix the GT** — dual-accept buyer/vendor on buyer_issued_po, or get the
  owner's explicit convention ruling.
- **Lever 1 — convention-licensed silence (the real residual):** warm silence is currently licensed
  by ANY maturity. Slice: on a `_buyer_issued` doc where the issuer resolved via a learned machine
  path AND a vendor-caption read was suppressed (`_suppressed_issuer` already in scope,
  `engine.py:8119-8124`, currently discarded), silence requires SAME-TYPE convention evidence — a
  supplier_hints row for (resolved supplier, THIS doc type, supplier_name) usage≥K, or the claiming
  template's own bound-confirm count; else carry a cold-style note naming both parties ("PO on X's
  letterhead ordering from 'V' — confirm which company to file under"). Value unchanged, no learning
  writes, review-bound. Additive type check (`getAllHints` rows already carry document_type;
  `_supplier_hint_upgrade` filters field_key only today, `engine.py:3210`). Optional UX: surface the
  suppressed vendor as display-only `suggested_counterparty` (never in corroboration math).
- Relies on: the caption vocab catching the vendor block (a bare "TO:" block is NOT captured — the
  note still fires, just without naming V); `_buyer_issued` correctness; hints carrying type.
  Could disable: the note blocks auto-file on future graduated buyer-issued scopes — the owner's
  113-confirm licence keeps today's behaviour (realdoc should be byte-identical); a YOUNG legit
  convention pays one extra confirm (acceptable). Must NOT touch: the 07-12 drop (never resurrect
  the vendor into the field), the letterhead-scope guard, config-B teaching.

### Test / gate
- Pin `test_buyer_issued_convention_note.py`: no-licence → note + needs_review, value unchanged;
  same-type usage≥K → NO note (pins the trade-off both ways); OFF byte-identical; invoice
  "Supplier:" caption untouched; suppressed vendor never re-adopted.
- Hard Set ×7, three arms: cold unchanged (flagged @69+note); warm on the live copy
  unchanged-silent (pinned as ACCEPTED, doctrine+licence); warm on a STRIPPED copy (PO-scoped
  Bramblewood hints + t8 removed, invoice-side confirms kept) → all 7 noted — the harness-reachable
  proxy for the risk cohort.
- realdoc-605: OFF byte-identical; ON M=0, would-file unchanged; report any live buyer-issued POs
  lacking the licence — that's the owner's trade-off surface.

### Risks / can't-reach
The genuinely dangerous cohort (mature install knowing the buyer only as an invoice ISSUER, no PO
convention) is harness-unreachable as-built — approximated only by the stripped-copy arm. Warm
winner (template_fixed vs hint_text_match) inferred from arithmetic — settle with one traced run.
Nothing files today (below-floor): this is a Review-honesty fix, not an M-risk.

---

## Card 2 (reggie) — credit-note total sign loss

### Mechanism (traced)
- The four `validation_patterns.currency` alternatives (`config/keyword_patterns.json:702-706`)
  admit no `-`, `(`, `)` or `CR`; applied with SEARCH semantics (`keyword.py _validate:2363-2368`),
  so `(£908.16)` passes validation but the marker never enters the match.
- The mint is `_clean_value` (`python_backend/extraction/keyword.py:2381-2385`): currency returns
  `m.group(0)` — the bare amount. Parens, trailing minus, CR amputated HERE for every
  keyword-family read.
- `MONEY_SIGN_CAPTURE` (keyword.py:2397-2402, ON since mig 81, in ALL_ON_DEFAULTS_93) re-attaches an
  adjacent `-` — **measured tonight: covers `£-908.16` (sym_minus heals 4/4) but NOT `-£908.16`**
  (lead_minus fails 4/4). Dash-run guard at :2400 is why the dash-leader control scored clean.
- The anchor/crop twin dies at `_clean_text_fallback` (`anchor.py:2909-2912`) — explicit
  `strip(" -:;,")`, no sign-capture leg (asymmetry: a sign-fixed keyword read and a crop read of
  the same box will disagree in `money_cents` terms).
- What flagged the 16: `CREDIT_SIGN_COHERENCE` arm 1 (credit-typed + committed total not negative,
  `validator.py:390-391` → note + conf cap 50). Arm 2 (raw markers) is DEAD on keyword reads —
  keyword.py never sets `raw_value` (only three engine repair arms do). **Residual hole: a credit
  note that mis-types as invoice gets NO sign note and could silently would-file positive** — the
  2026-08-07 heading-drop family is exactly the docs that mis-type.

### Convention (owner Q answered)
No "absolute value + type carries the sign" convention exists — `handler.js:470-478`: the operator
types the minus; `credit_sign_note` never negates (owner's instruction, validator.py:773-775); the
mirror arm (validator.py:380-382) was built "in anticipation of exactly this fix". Right fix =
extraction-side completion of the already-started slice A. New plumbing is sign-aware already
(`money_cents` returns `(cents, neg)`; `witness_agrees` compares sign-inclusive).

### Smallest fix (design)
One helper in `number_format.py` (reuse `_NEG_HINT_RES`/`_CR_STRIP_RE`), consumed by keyword
`_clean_value` AND anchor `_clean_text_fallback`. Whole-SEGMENT `fullmatch`, never substring:
- Parens: `\(\s*[£$€¥]?\s*[\d,]+(?:\.\d{1,2})?\s*\)` → `-` + bare amount ("(10%)"/"(see note 3)"
  fail fullmatch).
- CR: `[£$€¥]?\s*[\d,]+(?:\.\d{1,2})?\s+CR\.?` re.I with the `(?<![A-Za-z])CR(?![A-Za-z])` boundary
  ("CREDIT" cannot match).
- Trailing minus: STAYS note-only (scan dot-leaders read as `-` — the 2026-08-07 blocking
  condition). Lead `-£` shape: extend the existing leg, same DARK treatment.
- Each notation its own DARK sub-flag (`MONEY_SIGN_PARENS`, `MONEY_SIGN_CR`) — never a silent
  widening of `MONEY_SIGN_CAPTURE`.

### Seams (named)
1. `_penny_reconciles` requires total-sign == subtotal-sign (`engine.py:2960-2972`): a sign-honoured
   total where only the TOTAL prints signed makes penny-reconcile fail → the recon demoter + the
   re-slice witness sweep go inert on credit notes (acceptable, precision-first — but named).
   **Hard Set GT flaw: gen signs every money row on the page but GT stores subtotal/tax positive —
   fix the GT convention before gating.**
2. Sign-aware agreement: signed keyword commit vs unsigned crop candidate stops agreeing in
   `money_cents` tuple equality — the anchor-twin fix is what keeps corroboration alive.
   `_cmp_norm`/text_normalise stay sign-blind (Oracle C1 — do not "fix").
3. Would-file flip: a credit-typed doc committing negative stops noting → CAN auto-file. Intended,
   but the arm-3 mirror (invoice-typed + negative → note) is the manufactured-minus safety and must
   stay co-resident (the handler.js:498-506 forced-ON pattern).
4. Smaller separate slice worth naming: populate `raw_value` on keyword money reads so arm 2 can
   fire on mis-typed credit notes.

### Gate
Extend `test_credit_sign_coherence.py` + signed rows in `test_money_strict_shape.py`; Hard Set
credit_sign — parens/CR/lead heal, trailing stays flagged, controls clean, sib_credit heals;
realdoc-605 OFF byte-identical, ON = 0 new wrong would-files, arm-3 fire count 0.

---

## Card 3 (oscar) — boxed meta_row label-above-value cells (the cold fill gap)

### Prior art
`pendingfeatures.md:1067` — "Stage-1 keyword is SAME-LINE only, so label-above layouts can never
corroborate" (Silverbeck 0020, the LIVE exhibit of this exact class). This card is that design,
upgraded with column alignment. No Oracle verdict exists on the mechanism yet.
`docs/designs/ANCHOR_LINE_SELECT_2026-07-23.md:12` fixed the TAUGHT-crop layer only.

### Mechanism (traced — deterministic, reproduces identically on the born-digital text layer)
1. The row rebuild is CORRECT: caption row and value row are separate lines with 4-space column
   breaks (`tesseract.py:472-539`, born-digital twin `born_digital.py:114`).
2. **The RIGHT leg steals the neighbouring cell's caption**: `_search_for_label` tries "right"
   first (`keyword.py:2062`) — for "Invoice No" the first segment after the label is "Date" (the
   next cell's caption); the accept test passes it (mixed-case "Date" is not `_is_label_line`) →
   returns at :2139. **The below leg at :2141 is never reached.**
3. Validation kills the steal upstairs and the label loop moves ON, not DOWN (`keyword.py:1493-1495`
   `continue`) — every alternate label re-matches the same caption row. Net: EMPTY.
   Ref survives only because of the digit gate `\d\S*\d` (`:1287-1295`, `ref_role_digit_gate`).
   **On an install with that gate OFF, this layout cold-commits "Date" as the reference @95 —
   the digit gate is currently the only guard.**
4. Even when below runs it is column-blind (`re.split(r' {4,}', candidate)[0]` — first column only,
   then a 3-line walk into the parties block).
5. Stage 2 has a fully built below-direction reader but ZERO cold anchors to trigger it — nothing
   synthesises an association from a cold caption match. (Why teach heals it.)
6. Secondary, separate gap: bare "Ref" caption is not a shipped `invoice_number` label — a
   label-vocabulary decision with its own party-guard risks (`_REF_PARTY_STOP`), taken separately.

### Smallest fix (design — DARK `keyword_cell_below`)
A cell-aligned below arm inside `_search_for_label`, structured fields only. Trigger: the label's
own column segment has an empty tail (caption stands alone in its cell). Action: split caption line
AND next non-empty line on `_COL_BREAK_RE`; label in segment k → candidate = value-line segment k.
Accept only if ALL hold (else exact today-behaviour):
1. `_validate(candidate, val_type)` passes (probe inside the search, new-arm only);
2. existing digit gates unchanged;
3. `not _is_label_line(candidate)`;
4. ref-role candidate that parses as a DATE → refuse (the M=7 leading-digit class must not gain a
   new door);
5. never take segment 0 for k>0 (missing cell shifts segments left — refuse);
6. window = next non-empty line only, stop at blank (NOT the 3-line walk).
Confidence capped at **85** — under the pinned 88 critical floor: a cell-below read FILLS but cannot
auto-file a ref/date on its own; one human confirm converts it to learning.
Rejected layers: gluing cells in the row rebuild (WRONG LAYER — page text feeds type detection,
fingerprints, corroboration); cold Stage-2 anchor synthesis (extra OCR, rebuilds what taught owns).

### Seams (named)
(i) A new keyword read is a new corroboration WITNESS — warm it can newly license
`_corrob_licensed`-gated arms and release holds: every corroboration-count diff in the gate is a
behaviour change to adjudicate. (ii) Filling a required role raises `overall_confidence` (unread=0)
— doc-level lift watched in the A/B. (iii) Checkpoint shift: operator sees a pre-filled value
instead of EMPTY; residual silent-wrong geometry = two type-valid values stacked in the same cell
column — the 85 cap keeps even that below auto-file.

### Cost
Zero OCR delta — text-only association over already-rebuilt lines. No new dependencies.

### Gate
Pins `test_keyword_cell_below.py` (2/3-cell heals, k>0 alignment, shift-refuse, date-on-ref refuse
RED-first, same-line byte-identical ON, OFF byte-identical); Hard Set boxed classes date → ~100%,
ref jumps where the caption is in vocab (record the bare-"Ref" split up front); realdoc-605 OFF==ON
byte-identical, ON-arm: only ADDED fills, M unchanged at 7, corroboration records diffed; the arm
must never outrank a taught mapping (engine precedence, proven in the ON arm).
