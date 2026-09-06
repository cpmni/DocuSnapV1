# Log-review fix plan — 2026-09-05

**Status: DESIGNED, NOT BUILT.** Source evidence: the dev `processing.log` (repo root — dev writes there,
not `%APPDATA%`), `Debug/diagnostic_2026-09-05T13-36-42-000Z.jsonl`, and read-only queries of the live DB.
Advisors: gary (A/B fix design), 007 (placement forensics, replicated the crops), reggie (date pattern),
eric (main-process bugs), herald (rendered the title bands) → **Oracle** (verdicts, seams, order).
Oracle entry: `docs/oracle_log.md` 2026-09-05. Deferred slices: `pendingfeatures.md` 2026-09-05.

Scratch evidence (session-local, may be gone): `…\scratchpad\{parse_today,diag_scan,diag_notes,diag_trace,
db_query*,herald_*,render_probe,probe3}.py` + the rendered bands/crops.

## 0. What the logs showed (375 reprocess runs over 126 docs, 7 suppliers)

| # | Symptom | Root cause (verified) | Layer |
|---|---|---|---|
| 1 | Meadowvale credit notes: `total_amount` reads the VAT row (`5639` = 56.39), drops the sign (`139.36`), or garbage; 13/20 in review; every hand-fix plants a `corrections` row | ⊕ teach persisted `anchor_label=''` for the total. Label-less authoritative currency anchor = pure absolute crop (`anchor.py:494-507` `_skip_rigid` needs a label; every relocation road needs one: `:677-679`, `:1016-1018`, `:1281`); the totals block floats with the item count. `_crop_is_credible` currency = substring regex; pattern 4 accepts a bare integer. Not-located → conf 50, NO note (`:1539-1540`). Sign: the ±20 px page-pixel pad + PSM 7 drops the thin `-` (tight box reads `£-366.66`); shipped currency patterns admit no leading `-` (`keyword_patterns.json:703-704`, fixed only under DARK `MONEY_SIGN_CAPTURE` mig 72). Teach side: the ⊕ LEFT strip (~750 px) is OCR'd at 108 DPI because `region_core.py:151-153` only upscales <300 px; label text and box come from two Tesseract passes (`:163-170` vs `:185`) → `''` / `Denn` with NULL offset. | Stage 2 + teach |
| 2 | Oakhaven delivery notes: taught `customer_name` (label `CUSTOMER`, below) → registration read `USTOMER` @81 WINS over keyword `Deliver To` @78 | Rigid crop reads `CUSTOMER` → `_is_bare_label` exact reject. Relocate: `_caption_top_limit` evaluated on the WIDENED box (`:1159` before `:1167`) → pad eats the 11-px gap → no clamp → reads `CUSTOMER` too. Registration (3/5 inliers) shifts the box +22 px x / −10 px y onto the caption row minus its first glyph; `_is_bare_label` is token-EXACT (`:2426-2430`); `_is_fuzzy_caption_bleed` is method-gated + needs `name_quality<0.6` while ALLCAPS `USTOMER` scores 1.0; `_is_caption_band_read` runs only at the relocate rung (`:1204`). Registration rung has zero caption defences and wins Tier-A by fiat (`engine.py:9187`). | Stage 2 |
| 3 | Pelican 0023: `invoice_date` `26-01-6000` @40 from `1/26/6000` = the tail of `PI/26/6000` | Date pattern 2 `(?<!\d)\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}(?!\d)` (`keyword_patterns.json:698`) forbids only a preceding DIGIT; unanchored search (`keyword.py:2479-2484`); dmy fails month 26 → MDY fallthrough (`validator.py:75,113-125`). DATE_IN_REF covers only the reverse direction; TIER_A_DATE_PLAUSIBILITY needs an authoritative competitor. | Stage 1 pattern |
| 4a | Castellan job sheets: untyped, no issuer, 20 docs @38 | CORRECT hold: no configured type carries "Service Worksheet"/"Job Sheet" (heading legible, 33 px). Issuer: the only KNOWN name on the page is the owner's own company in BILL TO → `issuer_band_withheld`; the letterhead geometry pick fragments the letter-spaced `Castellan Security Systems` into `Security` → `letterhead_fragment_abstain`. The note names the wrong actor. | type catalog + copy |
| 4b | Ironclad statements typed INVOICE @31, 20 docs | A table cell `Invoice` on line 9 (≤ `_HEADING_TOP_BAND_LINES=15`) equals the phrase → `_line_is_heading_like` (`keyword.py:662-676`) → `TYPE_HEADING_ANY_SEGMENT` 2.0 weight → Invoice 80-89% heading=True. `STATEMENT` (44-48 px, legible) scores NOTHING: the shipped Statement bucket has no bare name and only INSTALLED names fold (`:955-964`). `_type_refuse` exists only on the template paths. | Stage 0 type vote |
| 5a | `template file sync (commit): templatesDir is not defined` ×35 | `review/handler.js:61-62` `register(ctx)` destructure lacks `templatesDir`; closure at `:110` throws (swallowed). Product effect NIL: Python reads `--templates-file` from the DB snapshot; nothing reads the templates dir. The existing pin `test_template_file_sync.js:62` is a source-text regex that literally pins the buggy call. | main process |
| 5b | Angle heal `exit 2` (templates 6, 7) | `processing/handler.js:1741` calls `_pyHelpers.pythonArgs()` with no script; `main.js:133` `pythonArgs(script,...args)` → `['-3.12', undefined]` → `py -3.12 undefined detect_angle.py`. Manual run works. The `(...a)=>a` stub in `test_stage2_hardening.js:92` masks it. | main process |

Non-issues: Harrowgate @66 / Quillstone @68 `hint_text_match` reads were all PRE-graduation; after templates 7/4
minted every read is 95 `template_fixed`. Identity-guard WARN spam (243 lines) = expected refusals. Nordwind
quote-number "taught vs page disagree" ×6 = the crosscheck rung working as designed (review stop only).
`title` rows on typed docs are stale carries (AUTO_TITLE runs only when no type claimed).

## 1. Build order (Oracle)

1. **5a** — independent, first (clears the warn noise). SIGN OFF.
2. **Item 3** date lookbehind + the crop-site census instrument. SIGN OFF W/COND.
3. **Item 2 slice A** (fuzzy bare label, `anchor.py` only) → **slice B** (top-limit reorder + clamp threading
   + registration band mirror, ONE commit). SIGN OFF W/COND.
4. **Item 1 read-side** (label-less currency refuse + registration guard, ONE commit, DARK) → **teach-side**
   (page-words caption + warning) → the sign lever under `MONEY_SIGN_CAPTURE`'s own gate. SIGN OFF W/COND.
5. **5b** after the OFF-vs-ON sibling run. SIGN OFF W/COND; do NOT re-darken.
6. **Item 4**: presets now (owner); (b) DARK behind the re-detect diff; (i) as COPY only; (ii)/(iii) after
   their own census (SEND BACK).

Every switch seeded OFF by **mig 122** (UPSERT, the mig-121 shape at `database/index.js:2737-2745`), bridged in
`processing/handler.js` beside `:485-490`, Python reads `os.environ.get(..., '0') != '0'` (the harness OFF arm
must set `'0'` explicitly — EMPTY reads as ON).

## 2. Slices

### 5a — `templatesDir` ReferenceError (plain fix)
- Add `templatesDir` to the `register(ctx)` destructure at `review/handler.js:61-62` (prefer over
  `ctx.templatesDir()` — the `:62` regex pin matches the exact call text).
- Pins: an EXECUTING §4 in `test_template_file_sync.js` — `review.register(stubCtx)` (ctx shape from
  `test_review_events_doors.js:84`, `templatesDir: () => tmpDir`, `logger.warn` spy), run
  `getReviewService().confirm` on the §1 doc, assert the slug file lands and no warn contains
  "template file sync"; NEGATIVE CONTROL that fails on the old source. Plus a 10-line lint: every
  `templatesDir|resourcePath|backendScript|configPath` used bare inside `register()` appears in its destructure
  (the `77e674e` class recurred).
- Blast radius: one small synchronous write per confirm, no reader race.

### Item 3 — date pattern alnum lookbehind
- Edit ONLY the lookbehind on both numeric date patterns (`config/keyword_patterns.json:697-698`):
  `(?<![A-Za-z0-9])\d{4}[/\-]\d{2}[/\-]\d{2}(?!\d)` and `(?<![A-Za-z0-9])\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}(?!\d)`.
  Trailing `(?!\d)` untouched (`26/01/2026Terms` must keep reading). JS/Python identical text. Strictly tighter.
- Named recall cost: a border glyph OCR'd as `l` glued to a date (`l26/01/2026`) → empty → review.
  Rejected alternatives: a year gate (tail-dependent — `PI/26/2027` passes), removing the MM/DD fallback
  (a region behaviour, `test_date_order.py`).
- Consumers verified inert: trust.js `_matchesTypePattern` (`:149`, tests the stored `DD-MM-YYYY` value at
  position 0); renderer on-blur (whole typed value).
- **Oracle condition:** `_crop_is_credible`'s date/currency branch (`anchor.py:2667`) is a substring search with
  NO `_val_census` call — instrument it too, THEN run the census (every date acceptance whose match starts
  behind an alnum, keyword AND crop sites; expect only code-shaped windows).
- Pins: `python_backend/tests/test_date_alpha_prefix_gate.py` (`_validate('P1/26/6000')` False;
  `_clean_value('P1/26/6000    26/01/2026')` → `26/01/2026`; `26/01/2026`, `2026-01-26`, `| 26/01/2026`,
  `W/E 26/01/2026` True; `INV2026-01-26`, `Q1/25/2026` False) + the JS twin through `new RegExp(p,'i')`
  (the `test_date_preclean` shared-vector convention). Re-run `test_iso_date_clip.py`,
  `test_date_clip_gate.py`, `test_keyword_cell_below.py`, `test_date_in_ref_flag.py`.
- Gate: realdoc M=0 (`RR_APP_ENV=1`, `OCR_RENDER_DPI=200`) + the census.
- Not this slice: the PI→P1 prefix on the number itself — check the Stage-2.5 trace for doc 471 before calling
  it a corrector gap (likely the FORMAT_CLASS_JOIN class: mixed `P1`/`PI` confirms drop the entry).

### Item 2 — taught name reads the caption
**Slice A — DARK `anchor_bare_label_fuzzy` (mig 122).** In `_is_bare_label` (`anchor.py:2418-2430`) after the
exact rule, when armed: compare the alnum-joined VALUE against each caption TOKEN (Oracle C1: per token, not the
joined phrase — `CUSTOMER NAME` joined is 12 chars and `USTOMER` escapes a len−1 rule; skip tokens containing
digits — `Order 12345` must not reject a real `1234`): reject when `len(tok)≥5 and len(val)≥4 and (val is a
contiguous substring of tok with len(val)≥len(tok)−1 or bounded_levenshtein(val,tok)≤1)`. Reject →
`on_reject(..,'not_credible')` → value None → registration yields → keyword/override fills. One helper, every
rung. **Oracle C2:** the Stage-0.5 mapper calls `_crop_is_credible` WITHOUT a label (`template_mapper.py:1244,
1248`) — passing one switches on the EXACT check there too = new behaviour → its OWN slice + pin, not this one.
- Pins: `test_bare_label_fuzzy.py` — ON→True `USTOMER`/`CUSTOME`/`CUSTOMFR`/`Customers` vs `CUSTOMER`; OFF→False
  (documents the bug); negatives `Deliveroo` vs `Deliver To`, `Customs` vs `Customer`, `IBM` vs `Company Name`,
  `Denver Trading`, `139.36` vs `Total`, short label `To`. Rung pin: stub `page_transform` mapping the box onto
  the caption band → ON: `on_reject('anchor_registration','USTOMER','not_credible')` + keyword wins; OFF:
  registration wins.
- Note (Oracle): adding `anchor_registration` to `_RELOCATE_METHODS` (`engine.py:1254`) / Guard B (`:1382`) is
  INERT on the exhibit (`dq<0.6` gate; `USTOMER` scores 1.0) — hygiene only, say so in the commit.

**Slice B — geometry, ONE commit (Oracle C4).** (1) Reorder `anchor.py:1167`: compute
`_caption_top_limit(label_box,'below',relo)` on the UN-widened box, then widen. Safe for the `:1944-1946`
abutting-caption pin: an abutting name has no gap regardless of widening; the reorder only moves the
0.002–0.008 band from band-reject to clamp. (2) Thread `top_limit_norm` into the rigid (`:574`) and registration
(`:1250`) rungs for authoritative + labelled + direction=below only, reusing the `line_cache` locate already paid
at `:1487`. (3) Mirror `_is_caption_band_read` (`:1204-1212`) at the registration commit. Mirror without clamp
over-rejects; clamp without mirror leaves registration bare.
- Gate (both slices): Oakhaven `USTOMER` pinned at all three rungs; realdoc M=0 + zero name-field accuracy drop;
  a count of relocate reads where widened→None but un-widened→clamp, with value diffs.

### Item 1 — label-less taught money box
**Read-side — DARK `anchor_labelless_currency_refuse` (mig 122), ONE commit.** Predicate
`_labelless_absolute_currency(anchor, val_type)` = `val_type=='currency' and anchor.last_authoritative_at and
not anchor_label.strip()`. When armed: (1) extend `_skip_rigid` (`:504`) so the rigid crop is not attempted;
(2) the SAME guard on the registration trigger (`:1234`) — mandatory: `_is_weak_read` is text-only
(`:2491-2501`), so for currency the trigger is exactly `not value` and refusing the rigid read alone makes
registration the committer at Tier-A. Passive anchors untouched.
- **Oracle C1 (seam gary missed):** there is NO emission path for "value None + note" in anchor.py, and a note
  attached to a keyword incumbent would hold every Meadowvale INVOICE too. Mirror `issuer_band_withheld`
  (`engine.py:9582-9589`): the note ("This amount was taught by position only and totals move with the number
  of lines — re-teach it with its caption, e.g. Total") lands ONLY when the field would end EMPTY; with an
  incumbent the refused anchor yields silently and the incumbent's own gates hold (credit-sign arm 1 fires on a
  positive credit-note total; `_CREDIT_SIGN_ON` bridged ON by mig 98).
- Trade-off pin: a fixed-layout label-less currency anchor that reads RIGHT today (@50, never auto-files)
  becomes empty + note under ON; a fixed pre-printed form on a shifted scan is the same class (007 1f: the
  totals block moves relative to the PAGE, so registration can never fix a floating row — the guard is free
  for this class).
- Pins: `test_anchor_labelless_currency.py` — (1) label-less authoritative currency on a shifted row: OFF
  `anchor_crop`@≤50, ON None + note; (2) ON + fitted `page_transform` → NO `anchor_registration` commit;
  (3) labelled currency byte-identical; (4) passive label-less unchanged; (5) label-less authoritative TEXT
  unchanged; (6) the trade-off; (7) incumbent present → no note.
- Gate: (a) `field_anchors` census FIRST (below); (b) Meadowvale 20 on a `db.backup()` copy, OFF vs ON: per-doc
  total value/method/note + the AUTO-FILE ELIGIBILITY DELTA (C9 shape) — any doc that becomes eligible with a
  value ≠ the rendered page = NO-GO; (c) realdoc M=0; if the census finds zero label-less currency anchors the
  gate is vacuous → teach one Meadowvale-like layout on a Hard Set copy and run 20.

**Teach-side (own commit, no switch).** Source the ⊕ caption from `region.py --page-words` (`:115-137`, 200 DPI,
ONE pass — the wizard already uses it; reads `Total to Pay` @93 on the exhibit) and feed `anchorLabel.js`'s
row/cluster pickers with those words. For currency with NO label: replace the checkmark readout at
`review/renderer.js:6136` with a WARNING + typed-label input ("Type the caption, e.g. Total"). **Refuse
nothing** (Oracle C2: a receipt total with no adjacent caption must stay teachable). Pin: the
`test_teach_label_pick.js` pattern — currency position-only readout is the warn variant.

**Sign (its own gate).** Flip `MONEY_SIGN_CAPTURE` (mig-72 setting `money_sign_capture`) AND port the
re-attach to the anchor twin: `_clean_text_fallback` (`anchor.py:2947`) strips `-` but the currency pattern
never admits it — fixing `:2947` alone does nothing; re-attach the preceding `-` the way `keyword.py:2519-2521`
does, under the same switch. Do NOT chase pad/DPI. `validator.py:773-775` never negates (owner instruction) —
unchanged. Later (Oracle needed): a sign-witness re-crop extended LEFT ~1.5 glyphs when credit-sign arm 1 fires.

### 5b — angle heal argv
- `spawn(exe, _pyHelpers.pythonArgs(script, '--file', file), …)`, drop `pargs`, capture stderr into the warn
  (as `templates/handler.js:219-221`). `:1741` is the ONLY empty call in `src/`.
- Pin: new `processing/test_angle_heal_argv.js` — register with a `pythonArgs` SPY carrying main's semantics
  `(s,...a)=>['-3.12',s,...a]`; monkeypatch `child_process.spawn`; arm `teach_angle_compose_scan`; assert the
  spy's first arg ends `detect_angle.py` and argv `every(x => typeof x === 'string')`; negative: NULL sample →
  no spawn.
- **Seam:** the fix REVIVES a dead arm — templates 6/7 gain healed angles, so their siblings' Stage-0.5 compose
  changes next batch (armed on the owner's install `:1787-1795`). Gate: OFF-vs-ON sibling run for templates 6/7
  on a `db.backup()` copy, M=0 + zero drop. Do NOT re-darken (an owner-ON switch that silently no-ops is the
  dead-guard class). Templates 3/5/8/9 (NULL sample + NULL angle): log the skip; the "pin a sample later" road
  is the open owner decision (`pendingfeatures.md:1224`).

### Item 4 — type catalog + heading fold
- **(a) Owner action, now:** add the **Statement** preset (alias "Statement of Account") and a NEW
  **Service Worksheet** preset (aliases `Worksheet`, `Job Sheet`) to `PRESET_CATALOG`
  (`database/modules/document_types.js`) and tick both. Measured cold: Ironclad 20 → Statement 95, Castellan
  20 → Service Worksheet 95 heading=True, 0 other flips (census over 513 stored texts).
- **(b) DARK `type_uninstalled_heading_fold` (mig 122):** fold every shipped-but-uninstalled bucket's BARE name
  as a STRICT standalone top-band heading phrase only (`seg0 == phrase`, the 2.0 test, top band, whole-segment
  equality, NEVER a mention — bare "statement" as a mention would poison invoices carrying "VAT statement"). A
  legible `STATEMENT` then wins as the uninstalled name → the existing untyped + "Add 'Statement'" nudge path
  (`process_docs.py:1085-1100`, mig-51 `detected_type_name`, `0f3c8e9`). Oracle: this also re-arms
  `_type_refuse` for a same-supplier Invoice TEMPLATE (`process_docs.py:1068-1070`) — the designed
  delivery-docket road; its effect is HYPOTHESIS until the diff runs. Gate: corpus-wide re-detect (605 corpus +
  Hard Set 600), winner changes = exactly the uninstalled-heading docs, M=0, `_type_refused`/ambiguity
  false-hold rate unchanged. A workaround: the real defect is table-cell-as-trusted-heading (deferred).
- **(i) COPY only:** keep the withheld gate (`engine.py:9566-9592` is the C1 rescue for an implausible
  incumbent — suppressing it re-opens the silent-'IN' case); change the NOTE when the matched hint is also a
  ≥N-confirmed `customer_name` value ("Your own company's name was read here; the issuer's letterhead couldn't
  be read — please pick who issued this").
- (ii) banner-height same-row segment re-join and (iii) withheld-must-not-block-the-suggestion → SEND BACK,
  own census (see pendingfeatures).

## 3. Measure BEFORE building (Oracle)
1. `field_anchors` census: authoritative currency anchors with `anchor_label=''`, per supplier, + their current
   pre-fill method/conf, + the `corrections` rows those scopes already planted.
2. The Meadowvale AUTO-FILE ELIGIBILITY DELTA (Item 1, OFF vs ON).
3. The `_caption_top_limit` reorder band count (Item 2 B).
4. The date crop-site census after instrumenting `_crop_is_credible` (Item 3).
5. Item 4 (b)'s corpus re-detect diff.

## 4. Owner actions (no code)
- Tick the two presets (Statement, Service Worksheet) once they exist.
- Re-teach the Meadowvale total WITH its caption ("Total to Pay") — the label-locked crop beside the caption
  includes the sign column; today's 4 hand-corrected totals are the corrections rows the census counts.
- Learning Repair: the `corrections` rows planted by the wrong-row totals (`139.36→-139.36`, `120.02→-120.02`,
  `162.00→-1,178.89`) poison confusion-precedence 2a's substrate and block Meadowvale graduation.
