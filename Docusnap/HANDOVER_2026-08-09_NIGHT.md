# HANDOVER — 2026-08-09 NIGHT — money slice closed, harness was measuring the wrong DPI, issuer root cause FOUND

**Branch `feat/teach-side-overnight`. HEAD `71bce9b`. PUSHED to origin.**
Working tree clean apart from pre-existing untracked files (old `HANDOVER_*.md`, `stress_test/trace_one_doc.js`).

**The owner flipped every extraction toggle ON in the live DB tonight (18:59 and 19:26). All remain ON
except `deskew_on_import`, which was turned back OFF at 20:18 on the owner's instruction — see below.**

---

## TL;DR

1. **Oracle's four outstanding money conditions are closed** (`c027d86`). C3 was built exactly as
   signed, **measured, and REFUTED** — it cost 8 heals and minted 6 wrong values. Shipped inverted.
2. **The harness was measuring a pipeline the app does not run.** `teach_run_ab.js` rendered at 300
   DPI while the app renders at 200. Fixed. Every absolute figure in every prior handover was taken
   at the wrong DPI. Re-measured: the money slice survives and is *stronger* (+32, was +30).
3. **Four flags now have Settings bridges** (`11d3f46`, `a3b4938`) — they were env-only, so `npm start`
   (plain `electron .`, no env injection) could never arm them. The two headline wins of the 08-09
   arc were unreachable in the product.
4. **The issuer defect is root-caused and proven by measurement.** With registration off the lane goes
   **118/22 → 140/0/0**. The taught boxes were right on all 22; the registration arbiter was throwing
   their answers away.
5. **A fresh-eyes audit ran** (11 agents, read-only) and produced 32 confirmed findings, several of
   which corrected the record.
6. **The issuer fix is DESIGNED, ORACLE-REVIEWED, NOT BUILT.** A redesign from the owner landed after
   Oracle's review and is with Oracle now. **Do not build until that ruling is read** — see FIRST ACTIONS.

---

## ✅ RESOLVED — the `deskew_on_import` live regression (kept here because the mechanism matters)

**Turned OFF at 2026-08-09 20:18:45 on the owner's instruction** (live DB write, app not running,
single key, verified before and after). `teach_angle_compose_scan` is therefore reachable again, and
all four bridged flags plus `teach_angle_compose` remain ON. The record below is why it mattered.

It had been `true` in the live DB (set 2026-08-09 18:59:56). Two problems:

- **CLAUDE.md carries a standing ruling against it** — Oracle ruled WRONG LAYER; the measured +213
  cells came entirely from a tilt band Tesseract self-tolerates and which this project measured making
  a REAL scan worse (doc-561, `DN-98447` → `Dobrery\Not\Ne:/DN/er!`).
- **It silently disables the biggest teach-side win.** Traced end to end: `deskew_on_import=true` →
  `handler.js:1696` pushes `--deskew-pages` → `process_docs.py:486` `_raw_pages = [] if _deskew_pages
  else None` → `raw_pages` truthy → `engine.py:5072` takes the `TEACH_ANGLE_COMPOSE` branch →
  `engine.py:5089` `elif TEACH_ANGLE_COMPOSE_SCAN and not raw_pages` **is unreachable**.
  So `teach_angle_compose_scan` — measured tonight at **+18 issuer / +36 customer / +19 date** — is
  inert in the app right now, and the older, unmeasured `teach_angle_compose` path runs instead.

**HONEST CORRECTION TO THE RECORD:** the "2.0° floor → the entire heal vanished (0 of 1127 cells)"
argument that CLAUDE.md leans on is **vacuous as evidence of harm**. The corpus never tilts a page
past 1.6°, so a 2.0° floor deskews nothing; zero cells changing is arithmetic. It proves the deskew
was doing the work, not that the work was harmful. The real argument against import-deskew is the
*wrong-layer* one (rotate the box, not the page — which costs nothing), plus one real-paper exhibit.
The owner pushed back on this and was right to.

**Every number in this handover was measured with `deskew_on_import` OFF.**

---

## COMMITTED (9, none pushed)

| commit | what |
|---|---|
| `c027d86` | Oracle C3/C4/C6/C7 on the money slice + the harness DPI correction |
| `11d3f46` | Settings bridge: `template_drift_row_pitch`, `template_currency_edge_grow` |
| `a3b4938` | Settings bridge: `teach_angle_compose_scan`, `template_fixed_issuer_repair` |
| `d4c7d49` | SFDEV trace header no longer spills outside its panel |
| `717dbf5` + `16c460d` | Debug table: maximise/restore (F11), resizable columns, click-to-sort |
| `0a1ae4d` | Debug table: click-and-drag rectangle select |
| `71bce9b` | `noreg` diagnostic arm — proves the registration arbiter discards good reads |
| `6656b8f` | pendingfeatures: SFDEV should show the winning keyword caption |

### C3 — built as signed, then refuted by measurement

Oracle signed *adopt-on-proof*: adopt the money snap only if `digits(snapped).endswith(digits(unsnapped))`
and the snapped integer part is longer. Built exactly that. Measured on the live state:

| arm | total |
|---|---|
| unproven (no C3) | 119 ok / 1 wrong / 0 empty |
| **C3 as Oracle signed it** | **111 / 6 / 3** |
| C3 as shipped (inverted) | 119 / 1 / 0 |

Adopt-on-proof cost 8 heals **and minted 6 wrong values** — reverted a credit note to its VAT row
(`-609.62` → `-101.60`), stripped a minus sign (`-491.80` → `491.20`), turned a correct total wrong
(`999.72` → `999.79`). Arm kept at `~/Desktop/TESTING/arms/money_c3_adoptonproof.json`.

**Why the premise fails:** on the ABSOLUTE rung the reference (`abs_text`) is the value that would
otherwise commit, so proving a rewrite against it is sound. On the DERIVED rung the un-snapped read
is *itself wrong 28 times in 120* — that IS the defect the flag repairs — so adopt-on-proof validates
a good read against a known-bad reference, and cannot separate "the snap corrected a mis-seated box"
(right, common) from "the snap truncated a correct read" (wrong, rare).

**Shipped form: refuse on EVIDENCE OF LOSS, not absence of proof** — refuse only when the reference is
a well-formed amount AND the snapped read is a proper digit-SUFFIX of it with fewer integer digits.
Catches the C1 truncation exhibit exactly; fires on nothing else measured.

**Residual, must go to Oracle:** the shipped guard is **INERT on this corpus** — 0 documents change.
Its only evidence of working is a synthetic unit pin, not a corpus case. By this project's own rule
("any finding of the form 'this is already protected' must show the protection FIRING") it can be
called free, not protective. `_EDGE_GUARD_FIRES` now records `money_truncation_refused` so a census
can settle it.

### The harness DPI defect (the most consequential finding of the night)

`teach_run_ab.js:232-236` mirrored settings into env with `if (r.value !== 'true') continue` — a
NUMERIC setting is skipped entirely, so `OCR_RENDER_DPI` was never set and `ocr/tesseract.py:45` fell
back to its 300 default. The app applies `_ocrDpiEnv` (`handler.js:91-96`) at **every** extraction
spawn (import `:1661`, reprocess `:2213`, `:2415`, batch `:2839`), and live `ocr_dpi = 200`.

**Consequence:** every absolute figure this harness ever produced — the 119/120 totals headline, the
teach-side lane percentages, all of the 08-09 morning arc — describes the pipeline at 300 DPI, not the
app's. **A/B deltas between two arms are unaffected** (both arms shared the error).

Fixed to mirror `_ocrDpiEnv` exactly (emits only when `≠ 300`, so an unset/300 install stays
byte-identical). Logs `[dpi] OCR_RENDER_DPI=200` when it fires.
**`stress_test/trace_one_doc.js:65-66` has the same gap and was NOT fixed.**

### Measured at the app's real DPI (live taught state, 145 siblings)

| lane | app today (`applive`) | + all four bridged flags |
|---|---|---|
| customer | 103 / 37 | **139 / 1** |
| date | 121 / 19 | **140 / 0** |
| issuer | 100 / 40 | 118 / 22 |
| total | 112 / 8 | **119 / 1** |
| vat_no | 90 / 50 | 100 / 40 |
| account_no | 56 / 44 / 40 | 60 / 40 / 40 |
| ref | 117 / 23 | 119 / 20 / 1 |
| po_ref | 16 / 4 | 17 / 3 |
| serials | 4 / 30 / 4 | 3 / 35 |

**FLIP ALL FOUR TOGETHER OR NONE.** The teach-side pair alone costs **25 totals** (`total` 112/8 →
87/32): composing the taught box onto the page tilt puts the totals box on the drifted geometry, which
is exactly what the money pair repairs. All four together ends 7 above the current app.
(Which of the two teach-side flags causes the −25 is NOT separately measured; the mechanism points at
`COMPOSE_SCAN`.)

**`all4` is NOT the live baseline** — the harness settings mirror only arms a flag when the uppercased
settings key equals the env var, and `template_fixed_near_match` → `TEMPLATE_FIXED_NEAR_MATCH_RECONCILE`
does not. New **`applive`** arm reflects the app's actual config. Using `all4` would have credited the
teach-side bridges with +35 issuer instead of the true +18.

---

## THE ISSUER DEFECT — root-caused, designed, NOT BUILT

### The measurement

`supplier_name` = 118 ok / 22 wrong. All 22 won by `extraction_method == 'template_registration'` at
confidence 78-84. In the same five scopes the 82 correct issuers came from `template_mapping` (69) and
`template_fixed` (13) — **registration produced zero correct issuers**. Committed values: 14 document
TITLES (`SERVICE WORKSHEET`, `ORDER CONFI`, `RDER CONFIRMATION`, `JOTATION`), 6 ADDRESS lines
(`Meadowvale Creamery, Low Lane -`), 2 VAT lines (`Reg No GB 903`).

### Why the armed guard misses them (verified by execution, with a control)

`TEMPLATE_FIXED_ISSUER_REPAIR` was ARMED and IS reached (its call sits in the unfiltered Stage-0.5
merge loop, `engine.py:5123` → `:5166`). I imported `extraction.name_match` and ran all four branches
against the real values: **all four return False for all 22**. CONTROL: the exhibit the flag's own
comment cites, `'DATE 14-03-2026 Job Ref JB-8887'`, DOES return True on `is_not_an_issuer_read`. The
guard is armed, reachable, working — and blind to titles and street addresses, which carry neither a
printed date nor a 4+ digit run.

### THE ROOT CAUSE (two facts, both verified at source)

**1. The arbiter discards a successful taught-box read.** `template_mapper.py:2231-2239` has
`abs_text` as its FIRST conjunct, so the registration arbiter can only fire when the taught box
ALREADY produced a read — which it then discards on a geometry-only verdict, for a `val_type` whose
gate (`shape_mode='flag'`) can reject neither a page title nor an address. Its bar is floored by
`_DRIFT_FLOOR` — the **third and still-unfixed** site of the page-scale-constant-as-row-scale defect.

**2. `supplier_name` has NO ANCHOR — this is why only this field suffers.**
`template_field_mappings.anchor_text` is **NULL with dx = dy = 0.0 for `supplier_name` on all seven
templates**, including the two scopes scoring 20/20. Every other field carries a real caption
(`BILL TO`, `JOB SHEET NO`, `Balance Due`, `VAT Reg No`). A letterhead company name has no printed
caption — there is nothing to search for. Therefore:
- `_extract_one`'s drift guard (`if abs_text and anchor_text and located is not _UNSET`) is SKIPPED;
- `anchor_stable` can NEVER be set True for this field;
- the arbiter's `not anchor_stable` conjunct is permanently satisfied;
- the global transform is the ONLY drift compensation available.
Every other field can prove page stability from its own found label and shut that door. The issuer
structurally cannot.

### The diagnostic that proves it (`71bce9b`)

New `noreg` arm (drops the hardcoded `--registration`; env inherited verbatim from the arm that
measured the failures, so exactly one variable moves):

| lane | registration ON | OFF |
|---|---|---|
| **issuer** | 118 / 22 | **140 / 0 / 0** |
| po_ref | 17 / 3 | 19 / 1 |
| vat_no | 100 / 40 | 92 / 48 |
| customer | 139 / 1 | 137 / 3 |
| total | 119 / 1 | 118 / 2 |

All 22 come back correct. **Registration is NOT net-harmful and must not be switched off as a fix** —
it earns its place on `vat_no`. It is catastrophic only where a curated identity seed exists and no
anchor can defend the field.

### Advisor state

**gary:** ranked the arbiter as PRIMARY and a decline-branch as CONTAINMENT-not-cure. Designed a fifth
branch in `engine._fixed_seed_declines_mapping` keyed on `data.method.startswith('template_registration')`,
inheriting the raw-equality short-circuit and the `_FIXED_SEED_KEYS`/`_FIXED_SEED_METHODS` preconditions.
Blocking precondition **M1 PASSED** (verified: `template_fields.is_variable = 0` on all five, so the
curated seed really is emitted).

**Oracle: SIGN OFF WITH CONDITIONS** — not wrong layer. C1 auto-file blast census on the 22 (the
arbiter fired per-field; the fix must not flip a document to auto-file-eligible while another field is
wrong — bar: zero wrong-value auto-files gained); C2 fail toward Review where identity is unjudgeable
(`_branding_own_ratio` returns None for a short-name/logo-only supplier); C3 re-measure under the live
config; C4 keep the root cause countable; C5 measure the template-selection arm; C6 docstring + pins.

**Oracle's key confirmation:** keeping the seed does NOT reinstate the frozen stamp — it **re-arms**
the guards built for it. `TEMPLATE_FIXED_NAME_PRESENCE_VETO` (`engine.py:3133`) and `BRANDING_NAMED_BLANK`
(`:3098`) both key on `method == "template_fixed"` EXACTLY, and the unconditional note+cap-to-69 at
`:3161-3163` is method-agnostic. Today, with `template_registration` winning, **all of them are disarmed
on all 22** — the wrong value sits there with no destructive guard at all.

### ✅ ORACLE'S FINAL RULING — THE LAYER MOVED. This is the build brief.

Oracle re-ruled after Facts 1-3 and the owner's redesign. **gary's branch 5 (decline the blind rung
when a curated seed disagrees) is SUPERSEDED — DO NOT BUILD IT.** Two complementary fixes replace it,
in different layers, for different failure modes.

**THE BUG, in its narrowest correct statement: absent evidence is being read as refuted evidence.**
`anchor_stable == False` is written to mean "the label was looked for and could not prove the page is
stable". For an anchor-less mapping it means "no label was ever looked for". The arbiter then overrides
a credible absolute read on a *global* transform divergence with **zero local evidence that this box
moved**. Confirmed at source: `template_mapper.py:2194` `if abs_text and anchor_text and located is not
_UNSET`.

**FIX 1 — THE CURE, arbiter side, primary.** The arbiter must require that anchor evidence was
**available and failed**, not merely absent: add `anchor_text` truthiness (or an explicit
`anchor_evidence_available` flag set in the block above) to the `:2231` conjunction.

**FIX 2 — the standing guard, merge side, secondary.** The owner's region-scoped presence test: pad the
taught issuer box (~150%) and fuzzy-test whether the template's curated `fixed_value` is PRESENT there.
This is NOT redundant with Fix 1 — with the arbiter silenced, an anchor-less letterhead box on a
genuinely drifted page has *no* drift compensation, and its garbled absolute read still displaces the
seed via `is_curated_refinement` (`engine.py:5177`). Fix 2 fills that hole.

**Discriminator ranking (Oracle):** 1. `anchor_text` ABSENT — keys on the cause, ship it. 2. presence
confirmation — keys on evidence about *this* document, replaces branch 5. 3. curated-seed-exists
(gary) — **retire**; it keys on the symptom and keeps a value on evidence of nothing.

**C2 discharged in substance. C2′ survives, BLOCKING and small:** *not found* and *could not read* must
not be conflated. An empty/failed region OCR is UNJUDGEABLE → fall through; never count as confirmation,
never as absence. Fail-closed on the confirm direction only.

**Three pins Oracle requires with Fix 2:**
- The region confirm must **NOT** become an exemption in `_flag_branding_conflict` (`engine.py:3045-3061`).
  "This string is printed near the taught spot" ≠ "this supplier's branding is present on the document".
  The page-wide guard keeps its note/blank jurisdiction. Someone will propose the exemption; pin it shut.
- **Share the primitive with `TEMPLATE_FIXED_NAME_PRESENCE_VETO`, never the decision** — reuse the fuzzy
  distinctive-token match, do NOT reuse its ≥3-sample/≥0.80 gate (that gate protects a *destructive*
  action and would silently disarm a *confirming* one).
- **Confirmation grants no new authority** — it licenses keeping the existing 95 seed. Never raise a
  confidence, never mint a new method string.

**OCR notes for the region read:** PSM 6 (PSM 11 if the crop is sparse); **no `tessedit_char_whitelist`** —
it force-fits glyphs toward the string you are hoping to find, which is exactly the bias this test must
not have. Prefer testing against existing word geometry via `ocr_lines_fn`/`line_cache` over a fresh
crop OCR (cheaper, and avoids re-reading the same pixels). False-positive case to pin: a 150% pad can
reach the recipient block on a compact layout — harmless when testing one known string, *unless* the
template was mis-taught and its `fixed_value` IS the recipient.

**THE LOGO QUESTION — ruled (b): keep the seed but FLAG FOR REVIEW. Never (a) accept silently.**
The circularity reading is correct: if the template was selected by the logo arm, re-consuming the logo
is the same witness testifying twice; and `LOGO_REFUSE_FALLTHROUGH` means the match may not have
involved the logo at all. Plus the phash has no separating power on scans (cross-supplier min Hamming 2
vs same-supplier min 6) — a witness whose false-match distance is *below* its true-match distance cannot
license a silent 95 commit on the field that determines the output folder and the whole learning scope.
So in the letterhead-hole case: keep the curated name, attach the existing "Please confirm the correct
company" note, route to Review. The operator sees the right name pre-filled and confirms once — and that
confirm is what graduates the supplier.
**Evidence that would change this to (a):** a 256-bit mark hash (the parked design) with a published
separation census over the real corpus showing cross-supplier *minimum* distance strictly above
same-supplier *maximum* — extremes, not means — **plus** a recorded provenance flag proving the template
was selected by a non-logo arm on this document. Until both exist, the logo is a hint, not a witness.

### THE GATE (Oracle, G1-G5)

- **G1 — the falsifiable prediction, and the whole point of Fact 2.** Arbiter fix ALONE, 145 siblings,
  `applive`, 200 DPI: **issuer 118→140, 0 regressed, and every other lane byte-identical in value,
  method AND confidence**. If any other lane moves, the "only `supplier_name` has NULL `anchor_text`"
  census is WRONG — stop and re-census rather than tuning.
- **G2** — presence slice measured **on top of** the arbiter fix, not instead of it. Expect near-inert
  on this corpus (the arbiter fix already heals all 22); say so honestly. Its value is the drifted-page
  case the corpus does not exhibit — prove it fires at all with a synthetic shifted page, or label it
  unmeasured.
- **G3 — auto-file census on the 22 (was C1, still BLOCKING).** The arbiter fix moves the same 22
  documents past the 88 floor, so this transfers intact. Which documents flip to auto-file-eligible, and
  score *all* their lanes. **Zero wrong-value auto-files gained.**
- **G4** — both flags default OFF, OFF byte-identical; sandbox DB as a second state, 0 regressions;
  `deskew_on_import` settled before any flip.
- **G5 pins** — arbiter: a mapping with `anchor_text=None` and large `box_divergence` does NOT take the
  registration branch, while the same mapping *with* an anchor that failed to locate still DOES (the
  trade-off, pinned so nobody restores it). Presence: found → keep seed; not found → fall through;
  empty/failed region read → fall through as unjudgeable, **asserted separately from not-found**. Every
  pin must assert the pre-existing branches decline FIRST, so it cannot go green for the wrong reason.

---

## The read-only audit (11 agents, ~1.9M tokens)

Ran the workflow-mode audit the 08-09 EVENING handover had queued. 32 confirmed findings; both
adversarial lenses refuted 2 of the 3 verified claims. Highlights not already covered above:

- **Auto-file has NEVER fired on this install** — 0 of 360 documents, max `overall_confidence` 95,
  `auto_file_threshold` absent (default 100). Verified independently by my own query. The money/issuer
  risk is **latent, not active**.
- At `conf == 100` `docTrustGate` is **skipped entirely** (`strict_100_autofile` absent → false); the
  critical-field floor covers only `ref_field_key`/`date_field_key`, **never money**.
- `currency ∈ STRICT_TYPES` makes money's gate **weaker** than an ordinary unverified field — it skips
  the no-history block and gets only a dp-consistency check that needs ≥5 samples to say anything.
- **Every structured Stage-0.5 type commits at a FLAT confidence of 90**, not just currency.
- `credit_sign_note`'s raw-marker arm is a **DEAD GUARD** — its `raw_value` parameter is never assigned
  anywhere in the pipeline.
- Sign is dropped at the READ stage for every Stage-2 currency read (`anchor.py:2777` `.strip(" -:;,")`).
- `test_settings_wiring.js` covers 6 of ~33 live bridges.
- `total_amount` (the key used throughout CLAUDE.md and the presets) has **zero rows** in this DB — the
  operator's real money field is a custom field named `total`.

---

## Corrections to the record made this session

- **The 08-09 EVENING handover's headline is wrong.** `money_live5` scores **119 ok / 1 wrong / 0 empty**,
  not "119 / 0 wrong / 1 empty". Nordwind quote 0015 commits `'2.205.60'` — a value, not an empty. It
  carries conf 50 + a note so it cannot auto-file, but "zero wrong" is not true.
- **"A matched template implies a logo match" is FALSE** (I asserted it, then refuted it). Three accept
  doors; two need no logo (`keywords+slug_rescue` with the band defaulting OFF, `_match_by_keywords`).
- **The owner's agreement rule fires on 0 of the 22** — nothing agrees, so it is orthogonal to this
  defect. Do not report the eventual fix as "what was asked for".
- **My C3 cost prediction was wrong** (predicted 1 heal, actual 8) because I compared the flag-off
  baseline value against the armed value, when the proof actually compares the snapped read against the
  *un-snapped box read at that moment*.
- `stress_test/arm_method_conf_diff.js` counts appeared/vanished but does not PRINT them — cost me a
  wrong inference. Worth adding.

---

## FIRST ACTIONS for the fresh session

1. **Build FIX 1 (the arbiter)** — one conjunct at `template_mapper.py:2231`, kill-switched, DEFAULT
   OFF, byte-identical off. Gate on **G1**, whose prediction is falsifiable: issuer 118→140 and *every
   other lane byte-identical in value, method and confidence*. If another lane moves, the anchor-less
   census is wrong — re-census, do not tune.
2. **Then FIX 2 (region presence confirm)**, measured on top of Fix 1, with C2′ and the three pins.
   Expect near-inert on this corpus and say so.
3. **Do NOT build gary's branch 5** — superseded by Oracle's final ruling.
4. Owner still to confirm the 21-flag default-on set before the flag cleanup is built (see Deferred).
   `deskew_on_import` is NOT in that set — standing ruling against it, and it was just turned off.

## Deferred (designed, not built)

- **Flag cleanup (owner-requested, NOT built).** Hide the proven flags behind an SFDEV-gated section on
  Settings → Processing, default ON, with new toggles continuing to ship visible. **My first definition
  of "proven" was wrong** — "row is true in the live DB" now sweeps in `deskew_on_import`, which has a
  standing ruling against it. Corrected definition: *passed its gate AND no standing ruling against it*
  = 21 flags, `deskew_on_import` excluded and left as an ordinary visible toggle. Note this flips
  SHIPPED defaults for every install that never set the key (an explicit `false` is still honoured).
- **The registration arbiter itself** (`template_mapper.py:2231`) — the actual cure. Needs the
  200-sibling harness, not `realdoc_regression.js` (vacuous at 7 confirmed documents).
- **`_DRIFT_FLOOR` third site** — same fix, same slice.
- **SFDEV winning-keyword display** — `pendingfeatures.md`, leads included; the caption is already
  captured (`keyword.py:121`), so it is transport + display at `dev-inspector/renderer.js:164`.
- **Teach-side idea worth its own slice:** should the wizard give the issuer box an anchor (the logo
  block, or a stable letterhead word) so it stops being the one field with no way to defend itself?
- **Template 11** — a `quote` template named `'Reg No GB 903'` (the VAT line) with a correct
  `fixed_value`, 0 confirms, no sample, phash 4-6 bits from Nordwind's real template. A duplicate birth.
  Learning-Recovery/merge action, not a code slice. **No learning poisoning** — 1 document, and
  `supplier_hints`/`field_anchors`/`corrections`/`logo_fingerprints` are all clean (verified).

## Needs the USER

- Decide `deskew_on_import` (see above).
- Confirm the 21-flag default-on set before the flag cleanup is built.
- Restart the app to pick up the four new Settings toggles (main-process bridge = restart, not reopen).

## Key facts / paths

- Live DB `%APPDATA%\ScanFinder\docusnap.db` — query read-only with `file:...?mode=ro`, **never
  `?immutable=1`** (it ignores `-wal`). `better-sqlite3` has an ABI mismatch against the host node;
  use `py -3.12` stdlib sqlite3, or Electron-as-Node for the JS harnesses.
- Arms on disk: `~/Desktop/TESTING/arms/` — `applive.json` (the app's true config), `issuer.json`,
  `money.json`, `noreg.json`, `money_c3_adoptonproof.json`, `all4.json`.
- Harness: `ELECTRON_RUN_AS_NODE=1 TEACH_DB=<live db> ./node_modules/electron/dist/electron.exe
  stress_test/teach_run_ab.js <arm>` — ~3-5 min/arm, now DPI-correct.
- New instruments: `stress_test/arm_method_conf_diff.js` (METHOD + CONFIDENCE diff),
  `stress_test/exactness_census.py` + `TEMPLATE_EXACTNESS_CENSUS` (C7 hit-rate).
- C7 result: currency exactness **172/172 (100%)** — but that is ONE totals geometry across ten
  issuers. `reference_code` 75%, `po_ref` 40%, `serials`/`worksheet_*` 0%. Declines are the predicted
  merged-line case (`'Your PO'` answered by `'Invoice Number Date Your PO Account No'`).
  **Do not say "money is fixed".**
- `pytest tests/` still ABORTS (mixed pytest/script files, one `sys.exit`s at import) — run test files
  directly.
- A dev app instance may still be running (the owner launched `npm start` mid-session; it was killed,
  but 6 node/electron processes were live at wrap).
