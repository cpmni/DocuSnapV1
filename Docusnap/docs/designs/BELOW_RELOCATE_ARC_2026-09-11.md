# Below-relocate arc — "value crop lands one line low on a multi-line block" (design, v2 flag-first, 2026-09-11)

> **STATUS: v2 after Oracle SEND BACK (2026-09-11) — NOT built.** v1 (heal-to-row-1) was sent back:
> the "robust to either H-a/H-b" premise is false at the source, and the fail-toward-review path has a
> hole that still auto-files an empty optional field. v2 is **FLAG-FIRST** and closes the hole. Ships
> DARK behind two kill switches, POST-LAUNCH. Advisors: 007 (design), Oracle (vet). Log:
> `docs/oracle_log.md` 2026-09-11. Prior art: `pendingfeatures.md` #117, Oracle C7 (2026-09-08).
>
> **⛔ TWO PRE-BUILD BLOCKERS (must be resolved before code):**
> 1. **Measure H-a vs H-b on the real Larkspur docket** (below) — decides whether any heal is even
>    possible or the arc is flag-only.
> 2. **The fail-safe hole** (anchor.py:1457/1652/1735) — a chooser abstain must force `needs_review` and
>    block auto-file even when NO value commits. RED-first pin must FAIL on today's code first.

## The exhibit (system class, not a doc)
Larkspur delivery docket. "Deliver To" = 4-line recipient block:
`line1 = company name / line2 = "Site Office, Foundry Lane" / line3 = town / line4 = postcode`. A
`direction=below` taught anchor reads OPTIONAL `customer_name`.
- **300 DPI** → line 1 (company) @89 via `anchor_crop`. CORRECT (but note @89 is already marginal).
- **200 DPI** → the `anchor_crop_relocated` crop lands ONE LINE LOW → commits the street line (line 2)
  @86 → **silent wrong auto-file** (optional field doesn't block; ref+date correct).

mig-156 (deterministic non-name shapes only) and mig-157 (needs a bad label match) structurally can't
reach a word-like wrong line with a correctly-located caption (confirmed).

## Root cause (007, FACT vs HYPOTHESIS)
- **FACT 1 — no row discipline for free-text.** `clean_crop_segment` (anchor.py:3084-3088) returns the
  FIRST non-empty OCR line for `text`/`multiline_text`. The only per-line chooser `ANCHOR_LINE_SELECT` is
  scoped to `_LINE_SELECT_TYPES = ("date","alphanumeric","job_reference","currency_code")` (3462) —
  free-text excluded. A free-text `below` relocate has ZERO row-selection defence.
- **FACT 2 — the crop pads are the only DPI-dependent units on this road.** `_crop_and_ocr`:
  `half_w=int(w_norm*w/2)+20`, `half_h=int(h_norm*h/2)+20` (3932-3933); text adds
  `half_h+=int(h_norm*h*0.4)+6` (3938-3939). `w,h` are page PIXELS → `0.4·h·h_norm` is proportional
  (DPI-invariant), but `+20`/`+6` are FIXED PIXELS: 20px = 0.0086 of A4 height @200 vs 0.0057 @300 →
  ~1.5× larger relative to line pitch @200 → the crop balloons ~½ a line pitch downward.
- **FACT 3 — the off-row guard is blind to a one-row slip.** `_value_drifted_from_box` (2904-2916) trips
  only past `max(h_norm*1.5, _DRIFT_FLOOR)`, `_DRIFT_FLOOR=0.03` (2901) ≈ one line pitch → an
  off-by-one-row read sits at/under the floor. (Also: it's on the RIGID path, not the relocate seat.)
- **FACT 4 — the three deterministic guards can't catch it** (see above).
- **HYPOTHESIS — why line 2 *wins* (Oracle: this is a PRE-BUILD measurement, NOT robust-to-either):**
  - **H-a:** the @200 locate merges "Deliver To" + line 1 → inflated `label_box.h_norm` → the coarse
    centre `ny = Ly+Lh+gap+hh` (2513) lands on line 2, AND/OR `_caption_top_limit` (1864-1881) puts the
    caption bottom BELOW line 1 so the top-clamp (3975-3978) excludes line 1.
  - **H-b:** line 1 (a proper-noun company name, @89 marginal even at 300) reads empty/sub-credible @200
    → the first *readable* line is line 2.
  - **⛔ Why this must be measured first (Oracle, traced):** the chooser's proposed frame origin
    `cap_bottom = label_box.y_norm + label_box.h_norm` is the IDENTICAL quantity `_place_from_located`
    uses (1875 ≡ 2496-2497). Under **H-a** an inflated `label_box.h_norm` puts `cap_bottom` below line 1,
    so "topmost credible under cap_bottom" returns **line 2** — the chooser INHERITS the mislocate, it
    does not heal. Under **H-b** line 1 is unreadable, so no crop geometry recovers it — a heal needs a
    read-quality lever (upscale/threshold ladder), which neither switch provides. So the row-1 heal can
    only work in the narrow case: `cap_bottom` sits tight above a LEGIBLE line 1. **Until measured, assume
    flag-only.**
  - **The isolating measurement (do this first):** on the REAL Larkspur docket @200 vs @300 dump the
    located `label_box` (y_norm,h_norm) + derived `cap_bottom`, the relocate centre `cy`, and
    `_read_lines_full` per-line (top/height/text/conf) of the caption-anchored crop. `cap_bottom` below
    line 1 → H-a; line 1 present-but-empty → H-b. Record it in the gate.

## The fix — v2 FLAG-FIRST, two staged switches

### Switch 1 — `anchor_below_row1` (env `ANCHOR_BELOW_ROW1`) — flag-first row discipline. FLIP FIRST.
Scope: `direction ∈ {below,above}` AND `val_type ∈ {None,text,multiline_text}` AND a **caption-anchored**
crop (seated on `cap_bottom`, sized in pitch units, NOT the ballooned relocate crop) yields **≥2 credible
lines** below the caption. Credible = `_clean_one_line` non-empty AND passes the field's own `verify_fn`
(no new predicate) AND not `_is_low_entropy` (2536) / `_is_bare_label` (2553) AND (free-text)
name-like (`value_quality.is_name_like_field`).

- **≥2 credible lines under the caption → ABSTAIN + FLAG** (review-bound, no auto-file). This is provably
  correct under BOTH H-a and H-b because it never commits a line — it refuses to guess which row is the
  value. Note via the fail-safe channel (below): *"Couldn't tell which line under this document's caption
  is the value — please confirm."*
- **Exactly one credible line → ABSTAIN, fall through** to the existing `clean_crop_segment` first-line
  path on the existing relocate crop → **byte-identical** (a single-line value has no ambiguity, never
  sees the new path).
- **Row-1 present but not credible (garbled) + a lower row credible → FLAG** (never commit the lower row).
- **No credible line under the caption → fall through** to the existing relocate/rigid backstops,
  unchanged.

Line-pitch estimate (for the caption-anchored crop height, N≈2.2·pitch): median top-to-top delta of the
OCR lines in that crop (DPI-native, self-calibrating); needs ≥2 lines; fall back `label_box.h_norm` →
taught `h_norm`. Never a page-fraction constant. x extent = the existing `_label_left_limit`/
`_label_right_limit` column bounds (1209-1210), UNCHANGED.

**DEFERRED optimisation (separate later gate, NOT v1): heal-to-row-1.** Only for the sub-case the
pre-build measurement proves healable — `cap_bottom` tight above a LEGIBLE line 1 (i.e. NOT H-a, NOT H-b)
— commit line 1 (method stays `anchor_crop_relocated`, provenance preserved). Admitted only behind its own
census showing every heal == the true value. v1 ships flag-only.

### Switch 2 — `anchor_pad_hnorm` (env `ANCHOR_PAD_HNORM`) — DPI-invariant pads. FLIP SECOND (own census).
**Scoped to free-text below/above relocates ONLY** (where a `pitch_norm` estimate exists) — Oracle §4:
for structured/single-line/right crops no pitch is computed, so `max(h_norm,pitch_norm)` would collapse
to the tiny taught `h_norm` and STARVE the +20px headroom at 300, breaking byte-identity for the
heavily-shifted-scan class. Leave those crops on the current `+20/+6`.

On the scoped path: keep the proportional text term `+int(h_norm*h*0.4)` (3939); replace the fixed `+20`
(half_h) with `+int(max(h_norm,pitch_norm)*h*0.30)` and fold the text `+6` into the term (`0.4→0.45`).
`max(h_norm,pitch_norm)` guards a mis-taught micro-box. Horizontal `+20` → optional separate pin (lowest
value; not the row bug). Result: @300 crop ≈ unchanged (0.30·line ≈ 21px ≈ old 20px); @200 crop shrinks to
the SAME proportion, killing the balloon. Census must prove: **300 crop byte-identical on the scoped path;
only the ≠300 crop moves.**

## ⛔ Fail-safe hole — MANDATORY fix (Oracle §3, ship-blocker)
Today a chooser abstain does NOT reliably reach review: `results[field_key] = {...}` is built only inside
`if value:` (anchor.py:1457, entry 1652), and the `_relocate_guard_note` attaches only
`elif _relocate_guard_note and field_key in results` (1735). So an abstain (`None`) + a weak/blank rigid
read (the exact 200-DPI case that fired the relocate rung) leaves the OPTIONAL field **absent** and
un-flagged → the document's "type + un-flagged" auto-file gate passes → **it auto-files silently with the
field blank.** The arc would trade silent-wrong-value for silent-empty-field — no fix at all.

**Required:** emit a value-less result entry carrying the note + a review-forcing sentinel the engine
honours for empty optional fields (or route the flag through a document-level `needs_review` channel), so
an abstained optional field forces `needs_review=True` and is NOT auto-file-eligible.
**RED-first pin (must FAIL on today's code — verify it does, else it's worthless):** an optional free-text
field the chooser abstains on, with a weak/None rigid read, produces `needs_review=True` and is NOT
auto-file-eligible.

## Invariants / seam
- **Offset-replay byte-exact.** `_place_from_located` offset branch (2499-2503) = the CENTRE, untouched by
  both switches. The pad conversion changes the crop EXTENT at non-reference DPIs on the scoped path only
  (that IS the fix); honoured by (i) reference-DPI (300) crop byte-identity pin, (ii) pad on its own switch.
- **Single-line free-text unchanged** (the ≥2-credible-lines engage gate + the fall-through).
- **Re-parameterise the downstream caption checks (Oracle §3).** `_is_caption_band_read` (1246) and the
  `_caption_top_limit` clamp (3975) currently take the OLD ballooned `relo` box; on the new path the value
  comes from the chooser's caption-anchored crop — feeding crop A's value through a test parameterised by
  crop B is a coordinate-frame mismatch. Re-point them to the chooser's crop OR explicitly bypass on the
  chooser path; do NOT leave them on stale geometry.
- **No double-fire** with `select_row_line`/`ANCHOR_ROW_GRACE` — those stay `_LINE_SELECT_TYPES`-scoped
  (structured), never engage on free-text (verified, Oracle §3).
- **RELIES ON:** the located caption box (`_locate_for_relocation`→`_locate_anchor`) — the SAME dependency
  `_caption_top_limit` already carries; `_read_lines_full` per-line geometry; ≥2 lines for the pitch median.

## Companion arc (NOT this flip) — `_DRIFT_FLOOR` tied to line height
`_value_drifted_from_box`/`_DRIFT_FLOOR=0.03` is blind to a one-row slip, but on the RIGID absolute-box
path (a different rung — this exhibit is `anchor_crop_relocated`), so it does NOT run on Larkspur and is
NOT a precondition (Oracle §6b). Own switch, own census. Named; kept parked.

## Plumbing
- **mig 159** seeds `anchor_below_row1` + `anchor_pad_hnorm` = `'false'`; both keys ADDED to
  `database/dark_switches.js` `TEST_SWITCH_KEYS` (42 → 44). Env `ANCHOR_BELOW_ROW1`/`ANCHOR_PAD_HNORM`,
  per-call reads; byte-identical OFF; armed only by the `-TEST` build (`build_arming.js`). handler.js maps
  both settings → env for the process_docs spawn (the `NAME_ROLE_NONNAME_FLAG` road).

## Verification gate
- **Pre-build:** the H-a/H-b measurement recorded (decides flag-only vs the deferred heal sub-case); the
  RED-first empty-field pin proven to FAIL on today's code.
- **Census** (`VAL_CENSUS_DIR` style; reuse `_val_census`/`_reorder_census_diff`): row-select — for every
  below/above free-text relocate with ≥2 credible rows, log `{field_key, dpi, old_first_line, decision
  (flag|fallthrough), caption_box, cap_bottom, pitch, per_line_ocr}`; every diff must be a FLAG or a
  documented fall-through (zero new wrong commits, **zero new silent-empty auto-files**). Pad — crop box
  old vs new at 200 AND 300 on the SCOPED path: 300 unchanged, 200 shrinks to the 300 proportion. Warm-arm
  on the post-137 live-DB COPY (`reset_arm_compare.js`, values) + the 605 corpus.
- **Flip gate:** realdoc **M=0** (incl. zero new silent-empty auto-files); census differ = all flag/
  fall-through, zero new wrong commits; scoped 300-crop byte-identity; the Larkspur exhibit asserts the
  **MEASURED** mechanism (flag+no-auto-file if H-a/H-b dominates; line-1 only if the measurement proved it
  healable). Then Oracle re-vet.
- **Pins (fail on today's code where marked RED):**
  - (a) chooser: ≥2 credible lines → FLAG (not commit); garbled row-1 + credible row-2 → FLAG; single
    credible line → abstain-fall-through (byte-identical); no credible line → fall-through.
  - (b) **RED — empty optional field the chooser abstains on ⇒ `needs_review=True`, NOT auto-file-eligible**
    (must fail before the fail-safe fix).
  - (c) pad (scoped): 300 crop box unchanged; 200 crop box now the proportional equal of 300; a
    structured/right crop is UNTOUCHED (still +20).
  - (d) offset-replay centre byte-identity (2499-2503, both switches ON).
  - (e) Larkspur exhibit: with the switch ON, customer_name is FLAGGED + NOT auto-filed (v1); OFF, the
    200-DPI read still lands on line 2 and auto-files (pins the switch heals the silent misfile). Upgrade
    to "reads line 1" ONLY if/when the deferred heal sub-case is measured-supported.

## Key line references (anchor.py)
pads `3932-3933,3938-3939`; centre/offset `2486-2517`; caption clamp `_caption_top_limit:1864-1881`
(applied `3975-3978`); relocate rung `1189-1259`; **fail-safe hole `1457` (`if value:`) / `1652` (result
build) / `1735` (`elif … field_key in results`)**; free-text collapse `clean_crop_segment:3084-3088`;
`select_row_line:3481-3528`; `_LINE_SELECT_TYPES:3462`; `ANCHOR_LINE_SELECT`/`_row_band:3949-4004`;
off-row guard `_value_drifted_from_box:2904-2916`, `_DRIFT_FLOOR:2901`.

## Advisor / gate status
007 (2026-09-11): root cause + v1 design (memo). Oracle (2026-09-11): **SEND BACK** — premise false
(cap_bottom ≡ the mislocated label height), fail-safe hole (empty optional still auto-files), pad blast
radius (scope to free-text), re-parameterise caption checks; redirect = flag-first + close the hole +
measure H-a/H-b first. **v2 above is the flag-first re-shape.** Next: the two pre-build blockers, then
build DARK, then Oracle re-vet (007's naive → C1 seam already folded), gary for the test-strategy detail.
