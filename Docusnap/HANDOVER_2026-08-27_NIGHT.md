# HANDOVER — 2026-08-27 NIGHT (the roles are required by nature · the light-text OCR pass built DARK · Chris's blocker measured through the product code)

**Branch** `feat/teach-side-overnight` · commits tonight: **`48de395`** (structural roles REQUIRED BY NATURE, mig 92) ·
**`5b4bf27`** (light-text recovery pass, DARK) · (+ the docs commit that carries this file). **NOT pushed** (owner reviews
then pushes). **Live app: RUNNING on CDP 9222 on the code BEFORE tonight's commits** (mig 91) — a restart applies mig 92 and
loads the new bridge/Python. **Chris sandbox 9223: DOWN.** Owner's instruction this session: *"surely the main fields ref, date
and supplier must be required by nature?? Please continue with the queued items."*

## 0. First actions for the next session (in order)
1. **Owner: restart the live app** (mig 92 heals the 3 `service_worksheet` role rows; a log line says how many) → **Reprocess
   the held Castellan worksheets** (their overall 81 is baked at extraction — the heal changes the flag, not stored rows).
2. Read §3 (the light-text gates) — fill/verify the numbers if this file still says PENDING (the runs write to
   `scratchpad\census_light.*` and `scratchpad\rr_light_{off,on}.*` of session `9ba057d0…`).
3. Then the FLIP slices for the light pass (§4 — corroboration exclusion + the heal door), or the help plan D1–D11.

## 1. "Required by nature?" — YES, and the answer was a BUG, not a setting (`48de395`, Oracle SIGN-OFF-W/COND)
- **Fact (verified at source):** every reader that matters keys off the ROLE assignment (Confirm gate `validateConfirm`, the
  queue's `missing_required_labels`, the auto-file predicate's `_missingRequiredKey`) — EXCEPT the flag the SCORER reads:
  `validator.overall_confidence` = the type's `required` fields, ELSE every field, an unread one = 0 (also `needs_review`,
  `scopeTrust`'s verifiability loop, `rereadHolds.required`).
- **The mechanism:** every SEEDED type sets `required=1` on its roles; the shared doc-type editor's CREATE road
  (`doctype-editor.js seedCreate` → `create-doc-type-with-fields`, `settings/handler.js:147`) never did → a wizard/editor-made
  type carried `required=0` on all three roles. Live DB: `service_worksheet` fields 19/20/21. The 07-27 Northgate "72% cap"
  (`test_hidden_field_scoring.py` WS "6 fields, none required") was the SAME class — that arc treated the symptom per layout.
- **The evening handover's remedy ("tick required") was IMPOSSIBLE:** the edit-mode toggle is LOCKED on a structural field
  ("Structural field — always required", `doctype-editor.js:316`) and `updateField` refuses `required` on it
  (`document_types.js:365`). The guards asserted the promise; nobody wrote it.
- **Fix:** `document_types.assertStructuralRequired(db, typeId|null)` — ONE writer: end of `ensureStructuralRoles` (every create
  road), `updateType` after a ref/date re-point (the new role field becomes required; the old one is left as the operator had
  it), `backupService` after `replaceChildren('fields')` (a pre-heal backup can't re-plant 0); **migration 92** + the SAME heal
  **unconditionally at every start** (Oracle C1 — roads the stamp can't see: `seed-taught-state.js` row copies, hand SQL).
  No scorer change (Oracle: the flag is the ONE source; a role-aware scorer = a second definition of "key fields" in five
  readers). An optional List field is simply not scored unless the operator requires it.
- **Behaviour change stated (fail-toward-review):** custom types' roles now receive `rereadHolds`' S3-C5 "Read differently after
  learning" hold and the first-fill "confirm once" hold, and `scopeTrust`'s verifiability loop runs over them (Castellan|
  service_worksheet stays `ok` floor 95 — measured on both arms; DOCUMENT SOLUTIONS stays `recent-correction` 100).
- **Gate (realdoc `RR_APP_ENV=1`, frozen live-DB copies via online backup, 165 confirmed service_worksheet docs, `RR_IDS`):**
  OFF (required=0) → ON (healed): would-file **43 → 164**; **121 held→would-file** (117 Castellan overall 81→100 + 4 DOCUMENT
  SOLUTIONS at their floor 100), 0 the other way, **0 field-value diffs** (the reads are byte-identical — only the score
  moved), **0 wrong gained** (the single "wrong" #1092 is identical in both arms: GT `Ticket Type` vs read `DOCUMENT
  SOLUTIONS` = pre-existing GT poison), M_type 0; #224 stays held at 82 (another cause). Oracle expected "exactly 96": the 165
  include docs confirmed after the 11:09 baseline and the 4 DS docs that score 100 = their floor — legitimate.
- **Oracle C5 census:** `template_hidden_fields` has **0 rows** on the live DB (the ghost-at-100 residual is empty); a planted
  row on a throwaway copy IS found by the query (positive control).
- **Pins:** `test_structural_fields.js` §14 · `test_backupservice.js` (pre-heal backup → roles 1 after restore, M5 intact) ·
  `test_reread_holds_required_roles.js` (startup heal, wizard road, S3-C5 + first-fill on a custom type, anti-restore control).
  Chris's sandbox DB has 0 rows to heal (his types were presets).

## 2. The light-text recovery pass (`5b4bf27`, DARK `ocr_light_text_recovery` / `OCR_LIGHT_TEXT_RECOVERY`)
**What:** `ocr/tesseract.py reconstruct_page_text` gains a THIRD supplementary source — grayscale → global threshold 200
(`OCR_LIGHT_TEXT_THRESHOLD`, census-tunable) → PSM 3 — merged ONLY into regions the PSM-3 + PSM-6 passes left empty, placed
INTO the base rows (`_group_words_into_lines_with_light`; the row build split into `_build_rows`/`_place_in_rows`/
`_rows_to_lines`, pinned byte-identical on 200 random word clouds). OFF = not run, byte-identical, no extra call.
**Measured before building (`TESTING/_measure/light_text_20260827/probe_light_recipe.py`, exhibit + 6 real sandbox scans + 3
synthetic controls, 200 DPI):** fixed 200 → Serial 95 · No: 93 · CT-8051702 91 · CT-8813265 90, **0 debris on all 9
controls**; oscar's mean-offset adaptive (12 variants) misses one or both serial VALUES or garbles them ("Castelian",
"CT-9813265"@66); the paper-relative fallback finds ONE word. → fixed 200 ships alone (Oracle Q3), gamma answered by the census.
**007's placement conditions built:** boxes rebuilt AFTER the PSM-6 merge; IoA ≤ 0.2; `med_h` FROZEN from the base words;
rows-first placement (a base row only GAINS a word). **Filters (reconciled, ranked):** conf ≥ 60 — a DIGIT-bearing token ≥ 80
(Oracle C2) — ≥ 2 alnum (a lone glyph only at ≥ 90), alnum ratio ≥ 0.5, 0.4–2.0 × med_h and ≥ 6 px, width ≤ 0.6 page,
repetition, centre outside every base box, ink density 0.08–0.6 (slab/speckle), lone-word rule, page cap max(40, 0.35 × base)
⇒ keep NONE. Skips: already-binary input, frame mismatch, no base words.
**Geometry contract (Oracle C1):** `words_out["words"]` stays BASE-only (the rung-2 heading pre-gate ranks it by height —
pinned with a positive control); recovered words ride `words_out["light_words"]`/`light_boxes`; `region.py --page-words` unions
them; the `ocr-page-words` spawn now carries `_ocrDpiEnv` + `_reconcileEnv` (Oracle C3). Settings → Processing row "Also read
faint small print on scans" + bridge + wiring pin; copy tells the line-level truth + "already-read documents keep their earlier
text until re-read" (Oracle C5).
**Exhibit through the product code (`check_light_exhibit.py`, real Tesseract, 200 DPI):** OFF 1.8 s / 15 lines → ON 2.6 s /
18 lines, 19 words recovered, **0 OFF lines lost**, ON lines 11/13 = `Serial No: CT-8051702` / `Serial No: CT-8813265` (+ the
light footer `Castellan Security Systems … VAT Reg No GB 651 0027 84`).
**Pins:** `tests/test_light_text_recovery.py` (monkeypatched `image_to_data`: OFF two calls / env '0'; the refactor; the exhibit
geometry; every filter incl. the digit floor; page cap; binary skip; row pitch; the heading-band contract; the threshold clamp);
`test_ocr_engine` / `test_parallel_fullpage` / `test_heading_band_reread` / `test_settings_wiring` / `test_value_locate` green.

## 2b. THE LEVEL FIX (later the same night — `fix(ocr): … FOUR threshold levels`)
The owner re-imported the Castellan scans and saw no serials → the switch was OFF (expected) — but a RR_IDS run of the real
pipeline with the switch ON on their docs 11/13/1504 filled only ONE of seven serials. Root cause (`probe_exhibit_miss.py`,
`probe_level_sweep.py`): **no single threshold level reads every serial.** A page's faint ink sits 15–45 luminance units under
its paper mode (11: 244 · 13: 237 · 1504: 249 · sandbox 217: 236) and a thin stroke breaks at one level and holds at the next —
one value's conf swung 8→90→64→92 across 200/205/215/220 on the SAME page; doc 13's second serial reads at 215 only, 1504 at
≥210 only, the sandbox at 200 only; the low-conf reads (2–38) were garbles the ≥80 digit floor correctly refused
(`CT-21S8706`). **Fix:** read at {200, 210, 220, 230} (`_light_levels()`, env `OCR_LIGHT_TEXT_LEVELS`), merge per spot, the
string read by the most levels wins, a DIGIT-bearing string needs ≥2 agreeing levels (the one garble `CT-8024168` appeared at one
level only), floors on the winner, page cap on the merged set. **Result:** all ten values on all four exhibits; the REAL
pipeline fills `serial_number` on 11/13/1504 (`keyword_list` @85, would-file 100, 0 wrong). Cost: +1 tesseract call per level
per scanned page (~+3.6 s at 200 DPI). Pins §3d. **The switch is STILL OFF on the live DB** — my CDP flip through the app's
settings bridge was refused by the tool's permission classifier; the owner toggles it in Settings → Processing.

## 2c. THE OWNER'S LIVE RE-IMPORT WITH THE SWITCH ON (20:50 local; the switch was toggled by the owner in Settings)
A **Reprocess after the flip changed nothing** (diag log: `serial_number` "no candidate" at every stage; the stored text is
byte-identical to the import's — the cache seam, flip condition 10). A **re-import** of the 20 Castellan scans (ids 1705–1724):
**19/20 docs carry a `serial_number` row** (`keyword_list` @85), all filed at overall 100 (1721 held for another reason). Value
tally from the stored text lines: ~30 of ~36 printed serials collected. **Honest misses (next slice's exhibits):** #1719 no
"Serial" line at all (verify the page prints one); #1707 / #1709 / #1713 / #1716 / #1720 / #1721 one line's value not read
(`Serial No:    1`, `Serial No:    a;`, `Serial    CT-9999544` — the caption lost its "No:"); **#1706 `CT-832884` = 6 digits
beside 7-digit siblings — a dropped-digit read at conf 85 with NO flag** (the within-document shape consensus,
`pendingfeatures` (i), is now load-bearing: a List element shorter than its siblings should carry an amber edge). Quick check
gains the Serial column for these docs (rows exist now).

## 2d. THE MISS CLASS ("misses 1 serial but got the other 1 or 2") — measured + fixed (commit after `6597b27`)
Per-level probe of every missed row (`probe_miss_class.py`, `probe_1706_1721.py`): four mechanisms → four fixes in
`tesseract.py`: (1) **support-scaled floor** — the same string at three levels at 73/77/78 was lost to the flat 80 → ≥3 agreeing
levels stand at ≥70 (two levels still need 80); (2) **agreement key** — `CT-9999544`/`cT-9999544`/`CT-9999544_` counted as three
strings → case-fold + strip EDGE debris (`_ " ' ~ * |` only — never `: . , ;`, my first cut stripped the caption's colon and
`test_light_text_recovery` caught it); (3) **degenerate base sliver** — 1706's stored 6-digit `CT-832884` was the BASE PSM-6 pass
reading a 5-px-tall box at conf 87, and the additive rule protected it against the three-level `CT-8328847` → a base box under
the page's word floor no longer blocks, and yields when a recovered word sits on it (`light_replaced`); (4) **line-group
placement** — 1721: a lone qty `1` 11 px above the line captured `Serial` but not `No:`/the code → light rows are built first and
join a base row as a unit. **Result (real pipeline, switch ON):** 1707/1706/1713/1721 → 2/2, 1720 → 2/3, 1709/1716 → 1/2 (the
remaining line reads below agreement at every level — the true residual), 1719 → none (the page prints no serial lines — checked
by eye). **Owner: re-import once more to get these** (no restart — Python is spawned fresh per import; the JS side is unchanged).

## 3. The light-text GATES (Oracle 6–8) — [PENDING at write time; filled below when the runs land]
- **Realdoc OFF vs ON at `OCR_RENDER_DPI=200`** (the harness NEVER mirrors `_ocrDpiEnv` — Oracle caught it: my first run was at
  300, killed; `run_rr_light200.cmd` exports + echoes the DPI): M, M_type, would-file, per-template counts, supplier/method/
  template deltas — `scratchpad\rr_light_off.out` / `rr_light_on.out` + `_dump.jsonl` / `_type.jsonl` / `.jsonl`.
- **Census (`census_light_text.py`, every scanned page-1, confirmed + needs_review + deferred):** pages with adds, words added,
  conf/digit histograms, OFF⊂ON violations, light words placed INTO base rows, OFF column breaks lost, `header_band_text`
  shrank, rung-2-window words, other-supplier names in added lines, footer/date/money-like lines, extra s/page —
  `scratchpad\census_light.jsonl` / `census_light.out` (summary JSON at the end).
- **RESULTS:** (to be filled)

## 4. FLIP conditions for the light pass (Oracle 9–11 — NOT built; each its own slice)
9. **Corroboration exclusion (hard, not census-conditional):** a keyword read that exists ONLY in a light-recovered line is the
   SAME pixels as a crop read under another binarisation — never an independent family. Class F is ON live and lifts to 90 on a
   {keyword, crop} licence. Build: thread `light_words` through `process_docs.py` (`page0_geometry`) into the engine; compute the
   corroboration record as if light text were absent (a candidate whose value exists only in a light line is no witness; a
   light-derived winner emits `independent_agree:false`). Pin: record OFF == record ON on a fixture where light text adds an
   agreeing keyword witness. Plumbing facts: `_field_candidates` (~`engine.py:3179`) carries no line index; families via
   `_corrob_record_bucket` (~1876); `words_out["rows"]` is parallel to `lines`.
10. **The heal door (spawner layer):** a plain Reprocess (`handler.js:3077`), the batch manifest (`:4186`) and reextract-fast
    (`:3279`) hand over `documents.ocr_text` — only OCR Enhance or a tilted Straighten (`DESKEW_CACHE_FAST=0`) re-OCRs — so a
    flip heals nothing and the Review ⊕ preview (reads `currentDoc.ocr_text`) still collects nothing. Build: Python emits
    `ocr_recipe` (dpi + light + threshold) beside `ocr_text`; a mig stamps `documents.ocr_recipe` at both write sites
    (`handler.js:5435`, `:2795`); ONE `ocrCacheUsable(row, env)` predicate at the three hand-offs (NULL stamp usable only while
    light is OFF); reextract-fast on a stale row → `{ok:false, reason:'stale-recipe'}` → real reprocess. Also closes the sibling
    "DPI change serves stale text" bug.
11. **The flip note:** names the `vat_reg_not_amount` dependency (the recovered footer IS the 08-07 false-VAT strip; it is ON
    live + in PROVEN_ON_DEFAULTS but customer-flippable) and the +~50% per-scanned-page OCR cost (1.8 → 2.6 s on the exhibit).
Recommended (not required): skip the pass when the paper mode is below ~215 (coloured/dark paper goes solid black, costs a
second for nothing). Documented v1 limit: a faint-printed FORM (30 base words, 60 light) hits the page cap and keeps nothing.

## 5. Also this session
- `pendingfeatures.md`: the HELP SYSTEM rebuild is now logged as an entry (owner asked "is the help file work logged as todo?"
  — it wasn't; it is now, pointing at the plan + D1–D11); (g) light text → BUILT DARK; (h) required roles → BUILT.
- The stale "tick required" remedy struck in `HANDOVER_2026-08-27_EVENING.md` §0/§3 and the CLAUDE.md LATEST line.
- Memory: `project_required_roles_light_text_20260827.md` (index line added).

## 6. Traps (new tonight)
- **`stress_test/realdoc_regression.js` mirrors `_autoTitleEnv + _anchorCropEnv + _reconcileEnv` but NOT `_ocrDpiEnv`** — with
  the live `ocr_dpi = 200` every RR arm runs at Python's default 300 unless the shell exports `OCR_RENDER_DPI=200`. For a
  DPI-sensitive change this is the whole measurement. (Oracle.)
- Electron-as-Node prints nothing when run directly from the PowerShell tool — wrap in `cmd /c "set ELECTRON_RUN_AS_NODE=1&& …"`
  and redirect to a file.
- Killing a background realdoc: `Get-CimInstance Win32_Process` filtered on `realdoc_regression.js` / `rr_shard_` / the `.cmd`
  wrapper; the app's own workers use a different `--folder` and are untouched.
- Copying the live DB while the app runs: use better-sqlite3's online `db.backup(dest)` from a read-only handle (WAL-consistent),
  never a file copy.
- A synthetic "grey vs black small print" control must be LIGHTER than the generator's rgb(90,90,90): after scanify the base
  PSM-3 pass read my grey serials fine (the control was uninformative).
