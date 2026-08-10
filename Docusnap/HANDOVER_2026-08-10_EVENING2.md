# HANDOVER — 2026-08-10 EVENING2 (owner present)

**Branch:** `feat/teach-side-overnight` · **HEAD `8ee7456`** · **ALL PUSHED, tree clean**
**Migration:** 60 (unchanged — nothing this session touched schema)
**Installer:** NOT rebuilt. The last one (`dist\ScanFinder Setup 2.0.0-r20260810-0915-29425c9.exe`)
still predates everything from 08-10 DAY onwards.
**Uncommitted batch:** none. Four commits, all pushed.
**Context:** continued from `HANDOVER_2026-08-10_EVENING.md` (HEAD was `0c0250a`, the Template
Manager box-snap). The owner confirmed TM snapping works, then asked for the next fixes in sequence.

---

## TL;DR

Three fixes and one gate, all default-OFF except the operator-gated teach one.

1. **A typed teach value now looks for itself on the page** and teaches the position it finds
   (`3f21ddb`) — closes direction 1 of the typed-value backlog entry.
2. **A printed slash inside a reference code was being DELETED** (`1ad36de`). The owner's
   "doesn't appear on this page" complaint was the note telling the TRUTH; the value was wrong.
   **The backlog entry's own root-cause analysis was wrong and is corrected in place.**
3. **Non-UK VAT numbers are recognised** (`d9768c5`) — pays down the cost `92c7013` knowingly took.
4. **The separator guard is now GATED on the corpus** (`8ee7456`): **ref 89% → 96%, eight other
   lanes byte-identical, 0 regressions.**

**Nothing was flipped. Nothing was smoke-tested in the UI.**

---

## Committed

### 1. `3f21ddb` — a typed teach value captures a position (DEFAULT ON, operator-gated)
**Root cause / gap:** `showFixedInput` persisted `{value, target:null, anchor:null, status:'fixed'}`
→ a frozen `fixed_value`, re-asserted on every document of the type whatever that document prints.
Three defects this week ran through that path (the wrong-company misfile, `vat_no='VAT'`,
`serials='Serial No:'`) — all the same shape: a positionless value from a sample of one, asserted
confidently.

**What it does now:** on Save, the typed string is searched for in the page's own word geometry; a
hit is DRAWN on the page and the operator says whether that is the place. Accepting stores through
the SAME `store()` the drawn-box path uses, so the field commits as an ordinary Stage 0.5 MAPPING and
`doCommit` needed no special case. No hit, or "Save as a typed value", keeps the old path
byte-identically.

**Files:** `src/windows/shared/valueLocate.js` (new, pure matcher) ·
`src/windows/shared/test_value_locate.js` (new, 12 checks) · `src/windows/teach/renderer.js` ·
`src/windows/teach/index.html` · `src/modules/processing/handler.js` (new `ocr-page-words` IPC) ·
`src/preload.js` · `python_backend/ocr/region.py` (new `--page-words`).

**Design points that are load-bearing:**
- Word geometry comes from the **PIPELINE's** full-page recipe (`reconstruct_page_text` via its
  `words_out` hand-off), NOT the zone ladder the draw tool uses. The caller is deciding where a value
  sits so a template can read it later; the honest test is the words extraction itself sees.
- **Matching is strict** — exact after normalisation, no fuzzy tier, compared in two forms
  (whitespace-collapsed and whitespace-free, so `'PI/26'`+`'/6000'` still matches `PI/26/6000`), and a
  run is only ever assembled within ONE visual row.
- **A hit returns `{box, text, wordCount}` and nothing else** — no score, no confidence, no verdict.
  PINNED (check 10) using `vat_no='VAT'`, one of the two known-wrong census values, as the fixture.
  A box is evidence about WHERE, never about WHETHER.
- Multiple hits are NOT resolved by a heuristic — every occurrence is offered in reading order
  (the owner's letterhead-and-footer case).

**Measured limit, seen live during the build:** when OCR mangles the value it cannot be located —
`GB651002784` came back as `'GB85'`+`'1002784'` on a low-quality render and fell back to a typed
value. **So the census's 89.5% is an UPPER BOUND on what this recovers**, not a prediction.

**Kill:** setting `teach_typed_value_locate` = `'false'` (short-circuits BEFORE the search).
**Default ON**, mirroring `teach_box_word_snap` — nothing persists without an explicit click on a box
the operator is looking at.

### 2. `1ad36de` — a printed separator inside a reference code is not an OCR artefact (DEFAULT OFF)
**Owner exhibit:** page prints `PI/26/6000`; field committed `P1266000` at High·95%; Review said
*"'P1266000' doesn't appear on this page as written"*.

**ROOT CAUSE, verified at source.** `anchor._repair_single_token` (`anchor.py:2650`) fixes a real
PSM-7 artefact (a spurious `/` `\` `|` wedged into a spaceless serial, `'H7R5326676'` →
`'H/7R5326676'`) by re-reading the crop with `tessedit_char_whitelist=A-Za-z0-9-` — **a whitelist that
physically cannot emit `/`** — and accepting when the alphanumerics match. That test is satisfied by
every code whose separators are PRINTED. Its only protection was a guard for DATE-**shaped** tokens
(`\d{1,4}[./-]\d{1,2}…`), which a letter-prefixed reference misses.

**Reached from BOTH crop paths** — anchor.py's own rungs AND, via the cross-import at
`anchor._ocr_crop_laddered` (`anchor.py:3228`), the Stage 0.5 `template_mapping` rung, which is where every
measured instance came through.

**⚠ CORRECTION TO THE BACKLOG ENTRY, now fixed in place.** It recorded `anchor.py:2666` as building
"a COMPARISON target, not a committed value". The `target` local is a comparison target — but the
function **RETURNS `alt`**, the whitelisted re-read, and that IS the committed value. It also
proposed carrying a pre-normalisation raw twin so the page-presence check could compare like for
like: **that would have silenced a correct warning about a genuinely wrong value.**

**Fix = a SHAPE rule**, no new inputs, no page text, no extra OCR: an artefact is wedged into an
unbroken run and leaves a one-character group; a structured code splits into groups that each stand
on their own. `^[0-9A-Za-z]{2,}(?:[/.\-][0-9A-Za-z]{2,})+$` keeps its separators. **`|` and `\` are
never structural** (table rule / stroke artefact) so a code carrying one is still repaired.

**Files:** `python_backend/extraction/anchor.py` ·
`python_backend/tests/test_code_separator_structure.py` (new, 7 checks) ·
`src/modules/processing/handler.js` (bridge) · settings `index.html`/`renderer.js` ·
`src/windows/settings/test_settings_wiring.js`.

**Kill/arm:** `CODE_SEPARATOR_STRUCTURE_GUARD` / setting `code_separator_structure_guard`, DEFAULT OFF.

### 3. `d9768c5` — non-UK VAT numbers (DEFAULT OFF)
**The cost of a precision decision, paid down.** `vat_no`'s format (`92c7013`) is UK ONLY —
deliberately, because a generic "two letters plus 8-12 characters" arm readmits the measured OCR
garbles (`'CO'` and `'EE'` are real country codes). The cost: a UK business receiving an Irish,
German or French invoice gets `vat_no` EMPTY + a review, and typing the correct `IE1234567FA`
triggers an on-blur warning that the right value is wrong. **Same class as the `iban` defect of
08-08.**

**The answer is a MORE specific rule, not a looser one:** per-country structures with exact element
counts (27 EU/EEA + CH + NO), separators tolerated between elements.

**BOTH CONSUMERS WIDEN FROM ONE SETTING — this is the load-bearing part.** The renderer compiles its
OWN copy of `validation_patterns`, so a backend-only widening fixes extraction and leaves the operator
still warned. Merge points: `keyword.load_patterns` (`_apply_vat_eu`) for every Python consumer —
they all read through `self.patterns` (`engine.py:2228`) — and `get-validation-patterns` in
`review/handler.js` for the renderer. `vat_eu` ships as a **separate inert list**, and a pin stops it
quietly becoming pre-merged on disk.

**Files:** `config/keyword_patterns.json` · `python_backend/extraction/keyword.py` ·
`python_backend/tests/test_vat_eu_formats.py` (new, 8 checks) · `src/modules/review/handler.js` ·
`src/modules/processing/handler.js` · settings `index.html`/`renderer.js` · `test_settings_wiring.js`.

**Kill/arm:** `VAT_EU_FORMATS` / setting `vat_eu_formats`, DEFAULT OFF.

### 4. `8ee7456` — the corpus gate for the separator guard
`ARM_ENV.sepguard` added to `stress_test/teach_run_ab.js`, carrying **nothing but the one flag** —
ARM_ENV merges ON TOP of the harness's live-settings mirror, so `base` is the owner's real behaviour
rather than a hand-listed approximation that can drift (which is how `all4` came to understate the
app by two flags).

---

## Verification state — read this before quoting any number

### What RAN and what it said

**Corpus arm (`teach_run_ab.js base sepguard`)**, over a SNAPSHOT of the live taught state
(`~/Desktop/TESTING/_measure/live_20260810.db`, taken with sqlite's backup API from a read-only
connection so `-wal` content came with it — never the DB the app is using). 195 documents, 200 DPI,
54 live settings mirrored. 378s + 379s.

```
ref        25 ok / 3 wrong  ->  27 ok / 1 wrong      (89% -> 96%)
issuer, date, customer, total, vat_no, account_no, po_ref, serials
           BYTE-IDENTICAL — same ok/wrong/empty AND the same winning-rung distribution
failing cells 14 -> 12.   2 heals, 0 regressions.
```

**THE RESIDUAL IS THE PROOF.** The three baseline ref failures were:

```
0026  expected PI/25/1029  got PI251029    separators stripped
0030  expected PI/25/5450  got PI255450    separators stripped
0025  expected PI/26/9923  got P1269923    separators stripped AND the I->1 misread
```

Armed, only the last survives, as **`P1/26/9923`**. Doc 0025 carried two independent defects, and the
arm **SHOWS** — rather than asserts — that the guard removed exactly the one it claims to and left
the other standing. The false "doesn't appear on this page" note clears on the two now-correct
documents and correctly persists on the still-wrong one.

**Residual worth knowing, because it is not an improvement:** on 0025 the committed confidence moved
**95 → 90**. Still above the 88 auto-file floor, so the remaining wrong value is no better protected.

**Census — separator loss (read-only, live DB):** 36 committed `invoice_number`s had lost a separator
their own page text still prints; all 36 via `template_mapping`; the guard keeps it on **36 of 36**.

**Census — VAT precision (read-only, live DB):** 56 distinct `vat_no` values ever committed, run
through both pattern sets with the pipeline's own coverage test. 10 accepted before and after, 46
refused before and after, **ZERO flipped refused→accepted**. All 20 real non-UK forms pass;
`comsssie42`, `ee05351042`, `'VAT'`, `'3PL'`, `'1RE'` still refused; UK identical.

**Unit batteries, all green:** `test_value_locate.js` (12) · `test_code_separator_structure.py` (7) ·
`test_vat_eu_formats.py` (8) · `test_box_snap.js` · `test_teach_label_pick.js` ·
`test_teach_multipage.js` · `test_settings_wiring.js` · `test_vat_field_format.py` (asserts JS and
Python agree) · `test_vat_reg_not_amount.py` · `test_keyword_label_guard.py` ·
`test_validator_label_guard.py`. The existing `region.py --boxes` zone path was re-checked unchanged.

### What did NOT run — do not imply otherwise
- **No Oracle pass on either extraction flag.** This is the one gate outstanding on both.
- **No corpus arm for `VAT_EU_FORMATS`, deliberately.** This corpus is UK-only, so the arm comes back
  flat — and **a flat lane cannot distinguish "inert because the data is UK" from "the flag never
  armed"**. The 56-value live census is the stronger evidence.
- **NOTHING was smoke-tested in the UI**, including the new teach pick panel.
- No `realdoc_regression.js` run this session.

### Claims corrected this session
- **The backlog's `anchor.py:2666` analysis** (above) — it named the comparison local and missed the
  return value, so the entry concluded the removal site was "not located" when it was.
- **CLAUDE.md records `FILING_VALUE_SANITY_FLAGS` as bridged-but-OFF. It is `'true'` in the live DB.**
  Corrected in CLAUDE.md this session. Check the DB before calling an arm inert.
- I initially pointed at my own PowerShell call as the source of an AVG alert; the file timestamps
  ruled it out (detection 16:16:04 local, my first PowerShell call 16:23:30). See "Needs the USER".

---

## FIRST ACTIONS for the fresh session

1. **UI smoke, owner at the screen — four things have shipped unseen.**
   (a) Straighten + **registration preview** on a tilted sample (`redrawTplCanvas` has THREE exits);
   (b) a box drawn **while straightened** round-tripping to raw;
   (c) the Template Manager snap (draw loose → watch it tighten → save → reopen);
   (d) **NEW:** teach a document, type a value that IS printed on the page, and check the pick panel
   appears with the box drawn, "Show the next one" cycles, and "Save as a typed value" still works.
2. **Oracle pass on `CODE_SEPARATOR_STRUCTURE_GUARD` and `VAT_EU_FORMATS`** — the only gate left on
   both. The separator guard has a corpus arm; the VAT one has a census and a stated reason for no arm.
3. **Owner decision on the two contradictory live settings** (see "Needs the USER" — `deskew_on_import`).
4. Then pick up the backlog: the two 08-09 issuer residuals, or the SFDEV "show the winning keyword"
   tool. **The serials entry is parked and says why** — the defect is the taught box, not the format,
   and only 3 corpus documents print serials at all.

---

## Needs the USER

- **`deskew_on_import` is `'true'` in the live DB again**, against the standing ruling — and it is NOT
  inert. `engine.py:5253` gates the placement-only fix as `elif (TEACH_ANGLE_COMPOSE_SCAN and not
  raw_pages ...)`, and import-deskew is what populates `raw_pages`. **`teach_angle_compose_scan` is
  ALSO `'true'`, so it is armed and structurally unreachable.** The two settings contradict each
  other, and the unreachable one is what 08-09 measured as the biggest teach-side win. Verified at
  source this session; NOT changed — it is the owner's DB and the owner's call.
- **Three flags await a flip:** `code_separator_structure_guard` (gated), `vat_eu_formats` (census
  only), and `teach_typed_value_locate` (default ON already — nothing to flip, but it needs the smoke
  test above). All three are `<unset>` in the live DB.
- **AVG popped `IDP.HELU.PSE85 — Command line detection` on `powershell.exe` at 16:16:04 local.**
  Timestamps rule out my two PowerShell calls (16:23:30 and later, both completed with output). The
  two PowerShell launchers in `~/.claude/settings.json` are the likely source — the caveman plugin's
  `statusLine` (`powershell -ExecutionPolicy Bypass -File …caveman-statusline.ps1`, which runs
  constantly) and a Notification hook. I read the statusline script: benign and well-hardened. AVG
  Free hides the Behavior Shield log, so it was not possible to confirm which. Offered but NOT done:
  switch the statusline to the `caveman-statusline.sh` sibling and drop the Notification hook. **Do
  not add a blanket exclusion for `powershell.exe`.**

---

## Deferred — with the conditions that stop them being built wrong

- **Typed-value directions 2-4 remain open** (backlog top entry): separating "typed because OCR
  failed" from "genuinely not on the page"; stopping a sample-of-one typed value being asserted at 95
  (`TEMPLATE_FREEZE_QUALIFY` / `freeze_guard.js`); asking the operator whether the value is the same
  on every document. **Also unanswered: templates whose pinned sample is gone** (tpl 11 has 3 fixed
  values with no sample).
- **The raw-twin design in the page-presence entry is NOT the fix for that exhibit** and is marked so.
  It retains merit as a general Gate C false-flag reduction, and item 3 — populating the dead
  `extractions.raw_value` column, which would revive `credit_sign_note`'s dead guard — stands alone.
  **Check whether reviving it changes credit-note behaviour first, or it lands as a silent second
  change.**
- **The `I`→`1` misread** on the Pelican references is a separate upstream OCR defect, now isolated
  and visible as `P1/26/9923`. Not filed as its own entry yet.
- **VAT residual, stated in the pins:** format cannot separate two strings of the same shape. A garble
  matching a real country structure exactly IS accepted (`'ee053510429'`, 9 digits, valid Estonian
  shape) while the measured `'ee05351042'` (8) is not. **Romania ships floored at SIX digits, not the
  official 2-10** — pinned as a deliberate deviation.

---

## Key facts / paths

- **Live DB:** `%APPDATA%\ScanFinder\docusnap.db` — **migration 60**, 197 live documents, 8 templates,
  **54 settings `'true'`**. Probe it `mode=ro`, NEVER `?immutable=1` (that ignores `-wal`, and the
  `-wal` here is ~500 KB).
- **Measurement snapshot:** `~/Desktop/TESTING/_measure/live_20260810.db`. Snapshot with sqlite's
  backup API, not a file copy — a plain copy of the `.db` silently drops the `-wal`.
- **Arms:** `~/Desktop/TESTING/arms/{base,sepguard}.json` · scores
  `~/Desktop/TESTING/score_{base,sepguard}.json` (`{label, per_scope, failures}`).
- **Run the arm:** `TEACH_DB=<snapshot> ELECTRON_RUN_AS_NODE=1
  node_modules/electron/dist/electron.exe stress_test/teach_run_ab.js base sepguard` (~6.5 min/arm).
  Score: `py -3.12 stress_test/score_teach_run.py --json <arm>.json --label <name>`.
- **`ELECTRON_RUN_AS_NODE=1` is REQUIRED** for JS suites — without it the binary launches a GUI and
  hangs until the tool times out.
- **Do not edit `config/keyword_patterns.json` or anything under `python_backend/extraction/` while an
  arm runs** — the shard workers import per shard.
- **Ground truth stores refs WITH separators** (`PI/25/5681`) and the scorer's `n_ref` strips only
  whitespace — so a stripped separator is a genuine miss, not a normalisation artefact.
- **Running processes:** 4 `electron.exe` from 15:32 predate this session (a sandbox instance or the
  owner's app). No Python running at wrap.
- **Advisors were NOT used this session** (the session config forbids spawning them unasked). Every
  "Oracle outstanding" note above means exactly that.
