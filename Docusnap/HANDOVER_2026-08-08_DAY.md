# HANDOVER — 2026-08-08 (day, owner present) — NIGHT3 flips bridged + Oracle-gated · teach MULTI-PAGE shipped · security SEC-17/18 · four of my own claims refuted and corrected

**Branch** `feat/reprocess-throughput-autostraighten` · **HEAD `078569e`** · **ALL PUSHED**, working
tree clean apart from the owner's own uncommitted edit to
`python_backend/tests/test_template_target_word_snap.py` (untouched all session, not staged).
Continues `HANDOVER_2026-08-07_NIGHT3.md`, whose three dark slices this session bridged, gated and
partly signed off.

> **FILENAME NOTE.** `HANDOVER_2026-08-08.md` already exists and is one of the MISDATED older files
> (last modified 2026-08-05). It is NOT this session. This file is `_DAY`.

---

## TL;DR

Owner's order for the day was explicit: **(1)** Oracle the shadow-row slice, **(2)** bridge the two
extraction flags to Settings, **(3)** the reprocess stale-shadow drop — then "get the teach wizard
and template manager anchor and value detection finished; verify all data types work, not a small
subset; custom fields must detect the same as built-in; keywords 100%", and work through
`pendingfeatures.md`.

1–2 are DONE. 3 was **ruled not-a-blocker by Oracle** and is still designed-not-built. The teach /
template arc is **partly** done: three real defects fixed, three specialist-refuted dead ends closed
off, and the rest scoped with gates rather than guessed at.

| commit | what |
|---|---|
| `7ab9bcc` | Settings bridge + toggles for `TEMPLATE_INLINE_ROW_OVERLAP` + `REF_ROLE_DIGIT_GATE` (both still OFF) |
| `0c64dc3` | `test_settings_wiring.js` — fails if any switch loses a leg |
| `e18859c` | `TRUST_SHADOW_ROW_SKIP` — Oracle C1–C8, flip path, gate green (still OFF) |
| `f438ecc` | backlog: teach/template audit + five stale entries un-staled |
| `769629e` | backlog: three of my own claims corrected after specialist refutation |
| `6c85157` | `resolve_geometry` page-index fix — "Show where it reads" works past page 1 (**shipped ON**) |
| `1f8ff9c` | free-text guard PARITY + fall-through cap (both dark) |
| `866a045` | backlog: that fix measured NEAR-INERT here — recorded, not oversold |
| `5ad0220` | **teach wizard MULTI-PAGE** — navigation + real `page_number`, together |
| `915c412` | security SEC-17 (reparse-point containment) + SEC-18 (explicit renderer flags) |
| `078569e` | teach: drop an unconfirmed read-back on page change + record the landmark question |

---

## 1. Step 1 — `TRUST_SHADOW_ROW_SKIP` Oracle pass (`e18859c`)

Oracle verdict **SIGN OFF WITH CONDITIONS**, two BLOCKING. Both answered with evidence.

- **C1 (blocking)** — the two documents the skip unblocks are Castellan CREDIT NOTES and the corpus
  comparator strips the minus sign, so "correct" only ever meant correct in MAGNITUDE. Answered on
  RAW strings: `#718` stores `-160.32`, `#726` stores `-342.24` — sign present on both. Oracle's
  fallback (flip `CREDIT_SIGN_COHERENCE` alongside) is already satisfied: the live DB holds
  `credit_sign_coherence = true`.
  **OWNER-VISIBLE RESIDUE, not caused by this change and not fixed:** `#721`/`#722` are stored
  sign-POSITIVE, `#724` reads `"—-1,455.12"`, `#714` has no total row.
- **C2 (blocking)** — live-DB re-judge, new harness `stress_test/shadow_row_skip_ab.js` (read-only).
  **Its first run was VACUOUS** (0 shadow rows over 60 docs) because "the type lacks the money role"
  selects nearly the whole corpus and mostly picks pages with no totals. Retargeted at documents
  carrying a money value it mints 18 shadow rows across 10 docs and moves exactly two — `#718`,
  `#726`, reason `unverifiable-value:subtotal`, neither a role key nor a defined field, no reverse
  moves. Criteria (a)(b)(c) all pass.
- **C3–C6, C8 implemented:** `roleKeys` now from `document_types.COMPANY_KEYS` (drift with
  `foreignFields.ownFieldPredicate` pinned impossible); switch hoisted to ONE read per document and
  per batch via `opts.shadowRowSkip`; flip is a **SETTING read inside `trust.js`** (env still wins
  both ways for harness arms; try/catch → OFF); two FALSE citations in the shipped comment corrected
  (`review/renderer.js:2313` CONSUMES shadow rows for the verified badge, it does not skip them; the
  "at100 precedent" did not exist as described).
- **C7:** Oracle ruled the skip is **NOT sequenced behind `REPROCESS_SHADOW_STALE_DROP`**.

**GATE (all green, all read):** post-edit ARMED realdoc report is **BYTE-IDENTICAL** to the pre-edit
armed report → C3–C6 changed nothing in the armed path. Post-edit dark vs armed differ by **exactly
one line**, auto-file 536 vs 538. Wrong-value auto-file **17 in every arm, identical list**;
`M_type` 0. 21 unit pins + `test_scope_trust.js` + the wiring pin. **STILL DEFAULT OFF.**

## 2. Step 2 — Settings bridges (`7ab9bcc`, `0c64dc3`)

`template_inline_row_overlap` → `TEMPLATE_INLINE_ROW_OVERLAP`, `ref_role_digit_gate` →
`REF_ROLE_DIGIT_GATE`, via `_reconcileEnv` + paired Processing rows (precedent `60606d9`). Both OFF.
New pin `src/windows/settings/test_settings_wiring.js`: every addressed element id must exist
(298→299 checked), div nesting must balance, and each named bridge must have all three legs
(id → setting key → env var), plus a setting-only variant for `trust_shadow_row_skip` whose consumer
is `trust.js` rather than a spawn env. **App RESTART to load a bridge** (main-process JS).

## 3. Teach wizard MULTI-PAGE (`5ad0220`, `078569e`) — SHIPPED and SMOKE-TESTED

The wizard resolved `getDocumentPages(...)` to `pages[0]` and hard-coded `page_number: 0`. Both
halves shipped in ONE commit deliberately: the hardcode alone is a no-op, navigation alone stores
page-2 boxes against page 1 where extraction reads the wrong page silently.

Page strip under the canvas (hidden for single-page docs), per-page raw+straightened render cache
(straighten is per PAGE), and the drawn page recorded in `store()` — the single place a box is
stored. Three consequences pinned: a half-drawn box is dropped on page change; a stored box is drawn
only on its own page; selecting a field taught elsewhere FOLLOWS it there.

**SANDBOX SMOKE RUN — PASSED 4/4 primary points.** The run made the decisive check harsher than
specified: it navigated BACK to page 1 before committing, so an ambient "current page"
implementation would have written 0. It wrote `page_number: 1` for both page-2 fields, verified
directly from `template_field_mappings`; a later re-teach of `supplier_name` from page 1 correctly
overwrote that row to 0. Page strip confirmed ABSENT on a single-page doc. Document filed from the
page-2 values.

**Defect it found, fixed in `078569e`:** an UNCONFIRMED read-back survived a page switch, so the
panel offered "Value: Northgate Textiles — Looks right →" while the canvas showed Larkspur. Stored
rows were always correct (the box's own page), so trust defect not corruption. Fixing it required
splitting `promptField` into `promptField` (page-follow) + `renderFieldPrompt` (panel only) — calling
`promptField` from `gotoTeachPage` would see the pending result belonging to the page just left and
navigate straight back, an infinite flip. Pinned both ways.

**WHAT THE SMOKE DOES NOT PROVE.** Neither the 900-PDF demo corpus nor the owner's 722-document
install contains a SINGLE multi-page PDF (verified: all `page_count = 1`). The test document was
BUILT for the run — page 1 Northgate, page 2 Larkspur, different letterheads on purpose so a
mislabelled page could not hide behind a green result. The mechanism is proven; it is not proven
against real customer scans, because none exist here.

## 4. Preview page-index (`6c85157`) — shipped **ON**

`extract_with_mappings` addresses pages by `mapping.page_number` and skips out-of-range, while
`resolve_geometry` passed a ONE-element list — so every page-2+ mapping previewed as "nothing read"
in BOTH the Settings Template Manager and the Review wizard, about perfectly good mappings. Padding
with `None` keeps the mapping verbatim. **Shipped ON with `TEMPLATE_PREVIEW_PAGE_PAD=0` as the
kill** — the one deviation from the house default-OFF rule, and Oracle GRANTED it explicitly: the
OFF state is a known-broken state returning `{}`, so a dark switch would never be exercised and
would rot. Blast radius zero for extraction (one caller, the admin preview CLI).

## 5. Free-text guard parity (`1f8ff9c`, `866a045`) — built, dark, and MEASURED NEAR-INERT

`_gate_value`'s debris + name-quality guards arm on `if not val_type` while the sibling cap uses
`val_type in (None,'text','multiline_text')`. SIX SHIPPED KEYS carry a truthy free-text validation in
`config/keyword_patterns.json` (`supplier_name`:205, `customer_name`:246, `payment_terms`:405,
`buyer_name`:549, `supplier_address`:631, `customer_address`:646), so those BUILT-IN keys skip both
guards while every CUSTOM free-text field gets them — the inversion, and `is_name_like_field` fires
on exactly those keys, so the name-quality guard is **dead for its entire intended population** at
Stage 0.5 while Stage 2 applies it to the same keys.

**Two flags, and the split is a stated deviation from Oracle's condition.** Oracle wanted one flag
covering the guards AND the fall-through cap. Split because 11 of 38 live mappings are
`supplier_name` with `dx=dy=0` and a blanket cap would flag the issuer regardless of whether a guard
fired — the gate would report the sum of two effects. **RULE PRESERVED IN THE COMMENTS AND PINS:
GUARD PARITY MUST NOT BE FLIPPED WITHOUT THE CAP.**

**MEASURED, and it deflates the slice:** three realdoc arms (dark / parity / parity+cap) came back
**byte-identical to each other**. A flat lane is not a pass, so it was chased to source — a
reachability probe over 24 docs from the 11 templates carrying free-text mappings found
`supplier_name|hint_text_match 17`, `supplier_name|logo 7`, `customer_name|anchor_crop 3`,
`customer_name|template_mapping 1`. **`supplier_name` is NEVER read by a template rung** — logo and
hint matching outrank Stage 0.5. ONE template-rung free-text read in 24 documents. So the guards are
reachable but police ~1 read in 24. Correct in principle, near-inert here. **Do not present it as a
heal.** Consequence: the cap's blast radius is far smaller than Oracle and I both feared.

## 6. Security — SEC-17 / SEC-18 (`915c412`)

Owner supplied a general Electron/Python hardening checklist. Assessed against the app; most already
covered. Detail is in **`SECURITY_BACKLOG.md` as SEC-17…SEC-22 — that file is GITIGNORED and lives
only on this machine**; a tracked pointer entry exists in `pendingfeatures.md`.

- **SEC-17 FIXED (MEDIUM).** `_withinAnyRoot` compared `path.resolve(raw)` textually and `realpath`
  appeared NOWHERE in `src/`. A Windows junction inside an approved root (output folder, inbox,
  filing-slips) passed the check while addressing anywhere on disk; reachable from `open-file` /
  `show-in-explorer`. Now canonicalises BOTH sides via `fs.realpathSync.native` — both, because a
  root that is itself a junction is the ordinary redirected/OneDrive case and canonicalising only
  the target would refuse users their own files. Case-insensitive on Windows is part of the fix
  (realpath returns the filesystem's casing). Fails CLOSED only for a path that exists and cannot be
  canonicalised. **Shipped ON**, `SF_REALPATH_CONTAINMENT=0` reverts — the OFF state IS the
  vulnerable state. **SCOPE: only the OPEN path.** `filing/handler.js:172` (write containment) and
  `lib/navGuard.js:20` still compare textually — deliberately left, each needs its own gate.
- **SEC-18 FIXED (LOW).** `nodeIntegration: false` / `sandbox: true` now STATED on both
  `BrowserWindow`s instead of inherited from Electron 31 defaults. Zero behaviour change. Verified
  safe first: both preloads require ONLY `electron`.
- **OPEN:** SEC-19 no IPC sender validation (313 channels — one shared `assertSender`, destructive
  handlers first, wants Oracle); SEC-20 no dependency CVE scanning (the licence gate is not a vuln
  gate); SEC-21 Python worker runs as the full user (owner decision); SEC-22 installer unsigned
  (owner decision, cost).

---

## VERIFICATION STATE — read this before claiming anything passed

**Ran and read:** realdoc 714 docs × 5 arms (shadow dark/armed + free-text dark/parity/parity+cap);
`shadow_row_skip_ab.js` both arms; the free-text reachability probe; the teach sandbox smoke run;
unit suites — `test_trust_shadow_row_skip` (21), `test_scope_trust`, `test_settings_wiring`,
`test_teach_multipage` (17), `test_path_containment`, `test_navguard`, `test_resolve_geometry_landmarks`,
`test_freetext_guard_parity`, and the mapper battery (`template_mapper`, `code_edge_clean`,
`inline_row_overlap`, `mapper_drift`, `registration_arbiter`, `pad_window_read`).

**NOT verified:**
- **SEC-17 has had NO Oracle pass** and it touches a security-critical predicate. Do this first.
- Teach multi-page against a REAL multi-page customer document — none exist on this machine.
- The free-text guard parity beyond "flat, and the flatness is explained".
- `test_template_pad_window_read` FAILS under output redirection — that is a **console encoding
  artefact** (`charmap` cannot encode `→`), not a test failure. It passes with `PYTHONIOENCODING=utf-8`.

**FOUR CLAIMS OF MINE THAT WERE WRONG AND ARE CORRECTED** (this is the most valuable part of the
day — a fresh session will otherwise rediscover them the wrong way round):
1. **Landmark starvation root cause — WRONG.** I blamed `_excludeBoxesFor` excluding anchor boxes.
   007 refuted it: **13 of the 15 sub-3-landmark templates have ZERO field mappings**, so the exclude
   list was empty and the mechanism never ran. Real causes: `sample_document_id IS NULL` + <3
   cross-sample docs, and the recurrence/uniqueness stack collapsing. Better facts:
   `MIN_VERIFIABLE_INLIERS = 3` makes 1–2 landmarks **permanently DEAD** registration, not degraded;
   but landmarks feed ONLY Stage-0.5 mapping relocation, so of 15 templates exactly **one** (tpl 30,
   Larkspur PO) pays anything today.
2. **Teach `page_number: 0` hardcode — NOT a bug.** gary refuted it: `teach/renderer.js:409` resolved
   `pages[0]`, the wizard was page-1-only, so the hardcode was truthful. It was a missing FEATURE.
3. **Free-text guard mechanism — WRONG and inverted.** The truthy `val_type` does not come from
   `engine._TYPE2VAL` (which deliberately omits both free-text types) but from six shipped CONFIG
   keys. So BUILT-INS skip the guards and CUSTOM fields get them, the opposite of my first report.
4. **OCR resource limits — I called them a probable gap. They exist and are thorough:**
   `ocr/tesseract.py:293-295` (300 pages / 500 MB / 10 000 px per axis), `_SS_ROTATE_MAX_PIXELS`, and
   a per-file watchdog defaulting to **300 s** wired to a Settings control
   (`processing/handler.js:941-943`). Caught only because it was verified before write-up.

---

## FIRST ACTIONS for the fresh session

1. **Oracle on SEC-17** (`915c412`) before release — security-critical predicate, pins cover both
   directions but it has had no adversarial review.
2. **The landmark/multi-page question** (recorded in `pendingfeatures.md`, top entry): template
   landmarks are all `page_number = 0` while mappings can now be page 2+. Stage 0.5 buckets landmarks
   per page, so a page-2 mapping may have no transform at all. NOT proven to misread anything. Probe:
   teach a field on page 2, reprocess a sibling, read the trace for the winning rung. Settle whether
   sample-word capture reads every page and whether the teach commit should derive landmarks per
   taught page (`templates/handler.js:242-253` backfill is existence-aware per TEMPLATE, not per page).
3. **Owner decisions, four of them** (below) — several later items are blocked on these.

## Deferred — designed, NOT built (load-bearing conditions included)

- **`REPROCESS_SHADOW_STALE_DROP`** — `processing/handler.js` carry-forward copies a row the new run
  no longer produces, `extraction_method` and all, so a stale shadow row keeps driving the
  "✓ mathematically verified" badge. Oracle ruled it **NOT a prerequisite** for the shadow skip.
  **Correction to the NIGHT3 handover's "honest gate gap":** `mergeReprocessRows` is a PURE function
  with an existing unit battery, and its sibling switch `REPROCESS_ANNOTATED_EMPTY_WINS` states
  in-code that realdoc is structurally blind to that merge and **the unit battery IS the gate**. So
  it is gateable the same way — it does not need a new harness.
- **Label threading into `_gate_value` (007's proposal) — Oracle SENT IT BACK.** As proposed it
  empties `supplier_name` on whole templates: `anchorLabel.extractLabel` takes the last 40 chars of
  nearby text with no caption-shape test, so on a letterhead the auto-picked `anchor_text` is
  typically another line of the same company block, and `_is_bare_label("Vellum & Crane", "Vellum &
  Crane Stationers Ltd")` → True. Every fall-through rung calls the same gate, so the field is
  omitted silently on every document of that template. To become signable: scope to
  `not is_name_like_field(field_key)`; use the STORED `anchor_text` never the located text (the
  located text is the whole matched line and on a merged row CONTAINS the value → mass false-reject);
  and run Oracle's **PRE-FLIGHT QUERY** (for all 38 mappings with a non-NULL `anchor_text`, join to
  confirmed values and report `_is_bare_label(value, anchor_text)` — any True and it does not ship).
  A corpus arm CANNOT see this: the 11 `supplier_name` mappings have NULL `anchor_text` so the change
  is inert on them.
- **B2 free-text confidence floor — SENT BACK.** Trades a capped review-routed ~50 for an uncapped
  auto-fileable 90 via the same fall-through; needs a COLD-SCOPE arm (realdoc cannot see it — every
  doc there is confirmed so history always exists).
- **Declared-role seeding (`TEMPLATE_ROLE_SEED`) — SIGN OFF W/COND.** Thread `ref_field_key` /
  `date_field_key` into `_seed_field_patterns` (both already in scope at `engine.py:4712`). Do NOT
  widen the global `_is_ref_field` — `docs/oracle_log.md:858-859` rejected that (~6 call sites incl.
  two safety gates). **VACUITY TRAP:** `customer_corpus_score.js:92-93` types `job_ref`/`po_ref` as
  `'reference'`, already gated by `_TYPE2VAL`, so retype one corpus field to `'text'` FIRST or the
  arm proves nothing.
- **`SEED_TYPED_FIELD_LABELS` — Oracle DO NOTHING today.** Zero live bite and it cannot be gated
  non-vacuously without a generator change.
- **Landmarks (007 item F) — DEFER.** Count-aware backfill would turn registration ON where it is
  dead, which is the documented Castellan mechanism that overwrote a correct supplier read on 15 of
  22 docs. Flag-gated and measured, or not at all.

## Needs the USER

1. **`ocr_type` — wire it or delete it.** `template_field_mappings.ocr_type` is written by THREE UI
   surfaces with three different vocabularies and read by **ZERO** production code (only tests and
   the dev CLI `test_mapping.py:75-80`). Production `val_type` comes from
   `engine._seed_field_patterns(base, field_defs)`, keyed on the TYPE's field definitions.
2. **`delivery_number` retype.** Type `text` with no `validation_patterns.text`, so no format gate at
   all. Retyping to `reference_code` closes a class but changes validation for every delivery note
   already filed.
3. **Credit-note residue** (from C1): `#721`/`#722` stored sign-POSITIVE, `#724` = `"—-1,455.12"`,
   `#714` no total row.
4. **SEC-21 / SEC-22** — restricted Python account, and code signing (a purchase decision).
5. **Nothing new was flipped.** Five switches are now flippable and OFF. The only things shipped LIVE
   today are `TEMPLATE_PREVIEW_PAGE_PAD` and `SF_REALPATH_CONTAINMENT`, both with kills, both
   justified above.

## Key facts / paths / gotchas

- Live DB `%APPDATA%\ScanFinder\docusnap.db` (722 docs: 714 confirmed, 8 needs_review — all Pelican
  delivery notes). **All 38 field mappings are `page_number = 0`; 11 have NULL `anchor_text` and all
  11 are `supplier_name` with `dx=dy=0`.** Field types in live use: text 13, date 6, reference 1,
  currency 1, across 6 doc types of which 3 are user-made.
- **A SANDBOX INSTANCE IS STILL RUNNING — port 9223, PID 47032**, isolated userData under the session
  scratchpad `chris-sandbox\`. Screenshots in `chris-driver\`. Kill it when done; the next
  `/christest` rebuilds it.
- **`SECURITY_BACKLOG.md` is GITIGNORED** — SEC-17…SEC-22 exist only on this machine. The
  `pendingfeatures.md` pointer is the only tracked record.
- JS tests run via Electron-as-Node: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe <file>`
  (better-sqlite3 ABI). Pure-static pins (`test_settings_wiring`, `test_teach_multipage`) run under
  plain `node`.
- `realdoc_regression.js` writes a FIXED filename — copy each arm aside; arms MUST run sequentially.
  It now also reports a **PER-FIELD FILL RATE** (Oracle's addition): every other number in that report
  is blind to a field going EMPTY, so a value-deleting guard would otherwise score as an improvement.
- Do not edit `template_mapper.py` / `keyword.py` / `trust.js` while an arm is running.
- Advisor note: **`007` is NOT a registered subagent type** — spawn as `general-purpose` with the
  persona (memory `reference_subagent_types`). `gary`, `oracle`, `reggie`, `eric`, `iris`, `herald`,
  `bob`, `barry-the-brainstormer` are registered.
- Workflow gotcha: a coverage-map workflow lost 4 of 6 agents to `API Error: Connection closed
  mid-response`; `resumeFromRunId` replayed the survivors from cache and re-ran only the failures.
