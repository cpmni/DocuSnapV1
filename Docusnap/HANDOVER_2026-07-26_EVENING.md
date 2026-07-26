# HANDOVER 2026-07-26 EVENING (Opus 4.8 · max effort)

Branch `feat/reprocess-throughput-autostraighten` · **ALL PUSHED through `13b70a3`** (origin `0 0`) ·
working tree CLEAN · installer `r20260726-1018-58533ea` predates all this session's commits. ⚠ A dev
**`npm start` is RUNNING** (the owner's live test app; background id b44da8h0v).

## TL;DR
Built the two planned targets end-to-end, each gary→Oracle gated, kill-switched, unit+corpus proven.
**B′ (type-scoped label ownership) shipped DEFAULT ON** — cleared the 13 Copperfield POs (values
unchanged), zero corpus regression. **Fix A (#183 inline-harvest absence hold) shipped ON, then REVERTED
to DARK** the same session: the owner's live test showed it over-flags a CORRECT, visible ref on a
systematically-skewed supplier (Northgate). Corpus M dropped 2→1 while it was on (#183 caught), but the
per-supplier false-positive cost was far worse than the corpus 0.6%. A NEW issue was then diagnosed to
root: **Northgate purchase orders mis-typed as Invoice** (skew kills the heading → untrusted type →
same-logo sibling fingerprint stamps the wrong sibling). Two follow-ups are tracked (tasks #4, #5), NOT
built.

## Committed this session (3 code + `13b70a3` this handover; ALL PUSHED, origin `0 0`)

### `18d851a` — B′ type-scoped taught-ownership label exemption — **DEFAULT ON**
- **Root:** the taught-ownership guard (`engine._flag_taught_field_ownership`) capped a CORRECT plain-
  `keyword` read @69+note because the OWN_LABEL exemption (`keyword.label_is_own_discriminating`) judged
  the caption's uniqueness GLOBALLY. "Order Date" is a label on both po_date AND sales_order.order_date →
  read as shared → held. 13 Copperfield POs sat @69 (blind po_date anchor: `label=''`, `offset=None`,
  DB-verified).
- **Fix:** new `keyword.label_is_own_discriminating_in_type(label, key, owners, type_keys)` — intersect
  the global owners with the RESOLVED type's field keys, exempt iff `== {key}`; generic-token gate kept
  (bare "Date" never exempts); UNION field set degrades to the global test. A 2nd OR-branch in the guard,
  gated on `TAUGHT_OWNERSHIP_TYPE_SCOPED_LABEL` (now default '1') AND `self._type_authoritative`
  (`title_trusted AND not _type_ambiguous AND not _type_refused`; template signals EXCLUDED; `type_confirmed`
  un-wired = False, Oracle C3 crash-safety). Method-only.
- **Files:** `python_backend/extraction/keyword.py`, `engine.py`, `tests/test_taught_ownership_own_label.py`
  (+12 type-scoped pins), `tests/test_taught_field_ownership.py` (+B1-B6, incl. B2 non-authoritative HOLD
  trade-off pin, B6 wrong-type residual).
- **Gate (Oracle SIGN-OFF-WITH-CONDITIONS, ALL met):** C1 live-fire — replayed the 13 held POs OFF vs ON
  (`stress_test/label_capture_replay.js`, REPLAY_IDS + the flag): every po_date 69→98, note gone, VALUES
  UNCHANGED. C2 corpus — realdoc OFF vs ON diff is ONE line (ownership caps 13→5); would-auto-file set
  (396), M (2), M_type (0), accuracy byte-identical → empty auto-file delta. C3/C4 done. Unit green.

### `9119227` — Fix A #183 inline-harvest absence hold — (was ON, now DARK, see next)
- **Root:** #183 (`LarkspurInteriors_purchase_order_17.pdf`, GT `PO-60906`) silently auto-filed
  `PO-20008` @98 — a value NOWHERE on the page. Skew broke Tesseract row-grouping → the true "Order No."
  line absent from `ocr_text` → rigid crop rejected → Stage-2 `anchor_inline` synthesised `PO-20008` from
  scattered digits → valid shape → boost → silent file.
- **Fix:** new pure `engine._inline_absence_should_hold(winner, cands, ocr_text, is_date)` = `method==
  'anchor_inline' AND NOT _fallthrough_critical_corroborated` (no diff-family rail agrees AND alnum core
  absent from ocr_text). A kill-switched block AFTER the G1 veto-fallthrough guard, over the critical set,
  note-only. **Oracle C2 DROPPED the crop-box requirement** (rejection is unobservable in production;
  keying on the corroboration invariant is a pure fn of the result AND closes the label-less/positional-
  anchor hole). Files: `engine.py`, `tests/test_veto_fallthrough_corrob.py` (+7 pins).
- **Gate (all met):** realdoc A/B — silentAutoFile 2→1 (#183 SILENT→flagged; **#583 date-M UNCHANGED**,
  page-present different class), M_type 0, accuracy byte-identical. would-auto-file 396→391 = 5 held:
  #183 (win) + **4 correct-per-GT** reads (181/185/189 Larkspur, 471 Thornbury) — the fail-toward-review
  cost.

### `ae12a0e` — Fix A → DARK default (owner live-test)
- **Why:** on the SYSTEMATICALLY-skewed Northgate supplier the whole PO batch over-flags a CORRECT,
  visible ref (`PO-60892`, printed "Order No. PO-60892"): skew keeps it out of `ocr_text` while the rigid
  crop ALSO read it (`. PO-60892`, rejected only on the caption prefix — so its agreement is invisible to
  the corroboration ledger, which drops rejected reads). Corpus (0.6%) underrepresented this per-supplier.
- Reverted `INLINE_HARVEST_ABSENCE_HOLD` default to '0' (byte-identical off). Code + pins UNCHANGED; force
  on with `=1`. The refinement (task #4) is the proper re-enable.

## Verification state — honest
- All unit suites GREEN (taught-ownership x2, veto-fallthrough+FixA) under `py -3.12`, with the touched
  defaults ON.
- Corpus A/Bs were RUN and the report files READ (scratchpad `rr_*.txt` + per-doc `rr_*_dump.jsonl`):
  B′ diff = 1 line; Fix A M 2→1, +5 held, accuracy byte-identical, no doc newly enabled to file.
- B′ C1 live replay: the 13 Copperfield POs cleared (read-only; did NOT write the live DB).
- **Corrected mid-session claim:** at Fix A flip-ON I stated the review cost was "0.6% on degraded scans."
  TRUE for the corpus but it UNDERSTATED the real cost — on a systematically-skewed supplier (Northgate)
  Fix A trips the WHOLE batch, which is why it's now DARK. The corpus is thin on such suppliers.
- NOT verified: no installer rebuilt; the live DB not written by me (all replays read-only); the type-flip
  fix + Fix A refinement are diagnoses only.

## FIRST ACTIONS for the fresh session
1. **Owner: reprocess in the dev app** (`npm start`, which carries the source): reprocess the **Copperfield
   POs** → B′ (ON) clears them 69→98; reprocess the **Northgate batch** → Fix A now DARK, the "PO Number
   couldn't be confirmed" flags disappear. (Read-only replays already PROVED both outcomes.)
2. **Type-flip fix (task #5)** — Northgate PO→Invoice. Root traced (below). reggie/007 (skew heading
   recovery) → Oracle → build. System-wide (any multi-type-on-one-letterhead supplier).
3. **Fix A refinement (task #4)** — crop-read corroboration → re-flip ON precisely.
   (Push already done this session — origin `0 0` through `13b70a3`.)

## Deferred (designed/diagnosed, NOT built — with the load-bearing conditions)
- **Type-flip (task #5), DIAGNOSED via trace (`scratchpad/northgate_trace.js`, ids 675 vs 670):** on
  skewed Northgate POs (01/03/04 = ids 675/673/674) `detect_document_type` returns **"Sales Order 65%"**
  (the "Order No./Date/Total" labels feed sales_order; the "PURCHASE ORDER" heading is lost to skew) —
  wrong AND <70 so `title_trusted=False`; then `identify_template` matches by **keyword fingerprint**,
  IDENTICAL across Northgate's 3 same-logo siblings (invoice cc0 / delivery_note cc1 / purchase_order cc0),
  and stamps **Invoice**. Correct POs (id 670) detect "Purchase Order 95%" → match via **logo+slug** → PO
  sibling. Fix directions: (1) recover the heading on skew (`BANNER_HEADING_REREAD` / red-channel /
  deskewed top-band re-read) so PURCHASE ORDER trusts → correct sibling; (2) sibling-tiebreak SAFETY — no
  trusted title + shared-fingerprint siblings ⇒ HOLD untyped, don't pre-stamp a wrong type+fields (the doc
  already goes to review; the harm is the wrong Invoice pre-selection). Related memory:
  [[project_type_resolution_siblings]] · [[project_skew_type_flip_robustness]] · [[project_banner_heading_reread]].
- **Fix A refinement (task #4):** thread the rigid crop's OWN read (even when rejected) into the
  corroboration so an AGREEING crop clears the hold — keeps #183 held (its crop read GARBAGE, disagreed)
  while clearing the agree-case (Northgate). ⚠ Rejected crop reads are NOT in `_field_candidates` today
  (gary: winners-only ledger; `on_reject` trace-only) — the refinement must make that value available at
  the seam. gary→Oracle, then re-flip `INLINE_HARVEST_ABSENCE_HOLD`.
- **Fix B (#183 witnessed deskew, RECOVERS)** — still deferred; NEVER global deskew (corrupts #180).
- Unchanged from the morning handover: caption-strip flip · template merges · Slice-2 IDF · workflow
  slices 5+6 · H2 pairing · full hardening pass.

## Needs the USER
- Reprocess Copperfield + Northgate in the dev app (action #1) to clear the on-screen flags.
- Push the 3 commits (or not).
- To carry B′ (and, later, the type-flip fix) into the PACKAGED app + clear the LIVE Copperfield 13
  permanently: an installer rebuild (also does the pending hardened-installer smoke).

## Key facts / paths
- Live DB `%APPDATA%\ScanFinder\docusnap.db` (ro via `?mode=ro`), **migration 54**.
- Corpus: `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js`
  — cells via env flags (`TAUGHT_OWNERSHIP_TYPE_SCOPED_LABEL`, `INLINE_HARVEST_ABSENCE_HOLD`); `RR_DUMP=<file>`
  writes per-doc would-file; run WITHOUT `GATE=1` (the pre-existing #583 M forces exit 1). ⚠ clear
  `python_backend/**/__pycache__` after a Python edit.
- Live-DB replays (read-only): `stress_test/label_capture_replay.js` (REPLAY_IDS/REPLAY_FIELDS/REPLAY_TAG,
  inherits kill-switch env → python); `scratchpad/northgate_trace.js` (one-doc TYPE-resolution `--trace`;
  requires better-sqlite3 by absolute path since it lives in scratchpad).
- Unit: `py -3.12 python_backend/tests/<t>.py`.
- Tasks #4 (Fix A refinement) + #5 (type-flip) hold the pending work. Memory:
  [[project_taught_anchor_ownership_20260726]] (B′ DONE) · [[project_183_harvest_synthesis]] (Fix A DONE,
  now DARK) · [[project_type_resolution_siblings]] (type-flip evidence to fold in).
