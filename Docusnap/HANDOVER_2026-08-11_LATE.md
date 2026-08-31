# HANDOVER — 2026-08-11 LATE (evening→midnight, owner present + live-testing throughout)

**Branch** `feat/teach-side-overnight` · HEAD **`dc285a3`** · ALL PUSHED, tree clean (only the
standing untracked handovers/Backup). **The owner's app is RUNNING** (their `! npm start`, launched
~21:20 local) on the newest code — every fix below is live in that instance. No installer built.
Read `HANDOVER_2026-08-11_EVENING.md` for the afternoon half (its LATE sections were folded into
this file — this is now the authoritative wrap for the whole late arc).

## TL;DR
Eight shipped arcs, every one Oracle- or measurement-gated, all live-confirmed where the owner
could see them: (1) child-window DOCK resolved (5th iteration, live-smoked); (2) SFDEV trace crops
named per read + honest anchor tooltip; (3) disambiguation-picker HISTORY RANKING ("you've
confirmed this N times" — owner saw it working); (4) the 'Ltc' root cause = STALE
`sample_deskew_angle` on pre-round-trip templates — Oracle-signed data BACKFILL **APPLIED to the
live DB** (tpl 5 -0.30, tpl 7 -0.70; tpl 9 HELD on evidence); (5) **corroborated auto-file BUILT
and UNLOCKED** (all flip gates run incl. a cold poison recreation: 21/21 Stage-0 refusals; the
owner-visible toggle is ON in the live DB); (6) Review's positive-only "two readings agree" line
REMOVED (owner UX ruling); (7) reprocess Tesseract THREAD-CAP parity (single vs batch boundary-
glyph disparity closed; cap=1 on this box = deterministic); (8) **currency edge-grow arc
FINISHED** — symbol-only cut stands down (the snug customer box stops flagging; Pelican totals
78→98, note gone). **PICK UP FIRST: the NAME-BOX FLUSH-EDGE CLIP** (pendingfeatures top entry) —
measured live post-backfill on Ironclad; the snap's own pad is thinner than sibling drift, so the
class survives every repair shipped tonight and Oracle's recorded revival condition for the
name-grow is now MET.

## Committed work (all pushed; per-arc detail)

1. **Dock 5th iteration** (`5391c52`): restore-then-hide + visibility-guarded undock (+ drain-time
   chip failsafe + deterministic undock in the restore IPC). LIVE-SMOKED via sandboxed CDP
   instance: no stub, chips persist, restores painted, two-chip selective restore, 12s soak clean.
   Incidental pre-existing: `createWindow` parents children to the FOCUSED window — Review opened
   while Settings has focus dies with Settings on close. Not fixed, recorded.
2. **Trace crops named** (`7dcb0be`): slice events carry `tag` (absolute box / derived offset /
   inline harvest / edge grow / label locate / taught box); keyword rows' anchor-overlay tooltip
   now says the blue box is context, not the rung's location.
3. **Picker history ranking** (`0816b28`): candidates matching a ≥3×-confirmed value (per-scope,
   `_cmp_norm`) sort FIRST, labelled with the count. Sub-threshold counts never touch the order.
   Kill `CANDIDATE_HISTORY_RANK`. Suggestion-only — pick never files. Owner saw it live.
4. **Sample-angle backfill** (`8c85ec2`+`7240282`, **APPLIED live ~19:09** — backup
   `docusnap_pre_angle_backfill_2026-08-11T1809.db` beside the live DB): compose-scan misplaced
   every composed box by the sample's undeclared tilt on templates taught before the straighten
   round-trip. C1 measured: detect regimes agree 0.00° on all 8 samples (DPI-invariance = fact).
   Predicate pinned (`tests/test_backfill_sample_angles.js`): NULL→write, stored-0+|det|≥0.3→
   overwrite, else keep; non-zero NEVER rewritten. Gate: 118-doc full replay — unchanged templates
   byte-identical; Castellan customer 6/13→12/13 exact. Known trade (owner-warned): doc 0017 now
   reads 'Branblewood' (was accidentally-exact under wrong placement). **tpl 9 Pelican HELD**
   (floor-row, only negative lane evidence — pendingfeatures entry has the revisit path).
   Oracle ruled the name edge-grow WRONG LAYER *for the angle class* — see PICK UP FIRST.
   C4 fixed: `_healSampleAngles` now arms on `teach_angle_compose_scan` too.
5. **Corroborated auto-file** (`029b234`+`03b7d87`+`ffb4087`+`3d2b2af`+`9bc780f`, Oracle
   SIGN-OFF-W/COND ×2 then UNLOCK): a scope failing graduation ONLY on volume (≥3 human confirms,
   ZERO corrections over ALL in-scope confirms incl. machine files, verifiable required fields)
   files at floor 95 when issuer+ref+date each carry `independent_agree` with a PAGE family
   {mapping,crop,keyword} and zero disagreement. **memory+hint refused** (near-circular — the
   pinned trade-off; it means the route does NOT flip Castellan-style frozen-issuer scopes: their
   path is graduation). `confirmed_via='auto_corroborated'` excluded from the graduation window
   (the route can't manufacture its own trust). Setting `corroboration_autofile` — **'true' in
   the live DB, owner-flipped**. Env `CORROB_AUTOFILE` wins both ways. FLIP GATES ALL RUN: base
   arm byte-identical (80-doc corpus); armed effect = 4 docs, all GT-checked correct; declined
   census 5 buckets; kw-issuer census 0/29 (→ initial HOLD); then the COLD POISON RECREATION
   (fresh sandbox, wizard-handler teach, BOTH naming variants incl. owner-frozen 'Bramblewood
   Joinery Ltd' — SELECT-verified): **21/21 Oakhaven notes refused at Stage-0, zero corroborated
   files** → Oracle UNLOCK. Major finding: the wrong template claim no longer forms even with the
   frozen identity printed on the page. The 18c abstain-shape pin stays visible (licensed,
   bounded residual — buyer-issued slices 2/3 remain the closing work). Standing rule: never flip
   in the same release as `CODE_SEPARATOR_STRUCTURE_GUARD` without re-running the Pelican exhibit.
6. **Review agreement badge removed** (in `029b234`, owner ruling): positive-only badges train
   expectation; absence is structural (Stage-1 keyword is SAME-LINE only — label-above/boxed-cell
   captions never get a keyword witness; pendingfeatures entry with 3 coverage directions). Do not
   resurrect as positive-only.
7. **Thread-cap parity** (`9087c97`): Tesseract LSTM is thread-count-nondeterministic on boundary
   glyphs; single reprocess ran uncapped vs batch cores/shards → 'ACC-2291' vs 'ACC-229]' same
   doc. ONE cap now: `_reprocessThreadCap` = cores/min(configured concurrency,10) on BOTH paths
   (single-shard batch included). On this 16-core box with concurrency 10 → cap 1 = full
   determinism. Import workers keep their own cap (recorded residual; pin allows exactly that one
   surviving formula). Pins `tests/test_reprocess_threadcap.js`. Empirical: 5 Pelican docs ×2
   capped runs identical + correct.
8. **Currency symbol-cut stand-down** (`6a78c69`, Oracle SIGN-OFF-W/COND all applied; kill
   `CURRENCY_SYMBOL_CUT_BENIGN=0`): a snug money box cuts only the '£'; the guard's digit-
   restoring comparator could never verify (no digits to restore) → permanent ≤70+note — the live
   Pelican auto-file blocker. Stand-down when digits(grown)==digits(rigid) + both well-formed
   (prefix class NON-alphanumeric — Oracle C1: the serif 1→l channel, pinned refusing) + the
   absorbed locate word carries no extra digits. C2 gate: 102-doc dual arm — ONLY the two Pelican
   totals move (note gone, 78→98), zero value changes anywhere. C3: 'benign' verdict recorded in
   `_EDGE_GUARD_FIRES`. C5 honesty: residual false-benign = both tiers dropping the same leading
   digit while keeping the symbol — ink-correlated, priced rare, arithmetic cross-check is the net.
   Pins `python_backend/tests/test_currency_symbol_cut.py` ×6.

## Verification state — honest
- Everything above gated as described; each commit message carries its gates. NOTHING uncommitted.
- **Corrected mid-session claims** (all corrected in place, listed so they don't resurface):
  my "timeline" theory for the batch `]` (wrong — the fixed app genuinely still produced it until
  thread-cap parity + the healed run); "mitigated by identity_on_page" for the buyer-issued class
  (WRONG — that guard is satisfied by construction there; Oracle corrected); the phantom-DB
  "unreadable WAL" scare (my own heredoc backslash bug — memory entry written).
- **Not verified**: the Pelican 99/100 docs actually auto-filing post-restart (the owner restarted
  ~21:20 with everything armed; expected on their next processing pass — CHECK FIRST next session);
  the trace-mode/untraced read oddity (two untraced pre-cap batches read `]`, traced+harness read
  `2291`) is SUPERSEDED by the cap but was never root-caused as a trace-mode delta — reopen only
  if a fresh flip appears.
- Suite: no full 457-file suite run this session; batteries touched (edge-guard, drift, corrob,
  scope-trust, wiring, candidates, backfill, threadcap, symbol-cut) all green individually.

## FIRST ACTIONS for the fresh session
1. **Verify the night's live landings** (read-only): did Pelican 0021/0016 auto-file
   (`confirmed_by_username`/`confirmed_via`)? Did any doc file via `auto_corroborated`? Read the
   audit log + tell the owner what actually happened.
2. **The NAME-BOX FLUSH-EDGE CLIP slice** (pendingfeatures TOP entry, owner-priority): measured
   root = `boxSnap.js` pad `min(0.004, h*0.15)` ≈0.002 for name boxes < sibling drift 0.003-0.005.
   Fork recorded: (a) teach-side pad floor + (b) revive `TEMPLATE_NAME_EDGE_GROW` v1 under
   Oracle's RECORDED revival conditions (page-present defence in the comparator; do NOT lower the
   overhang floor; fire-rate census first). Oracle's own condition for revival ("the class
   survives the repair") is now MET — cite it. Probably (a)+(b) together.
3. **Hidden-field-drop corpus arm** (owed since the afternoon) + owner test script C–F + A3.

## Deferred / open (with load-bearing conditions)
- Name-grow revival conditions (above — do not build without them).
- Buyer-issued slices 2/3 + the 18c abstain residual (corroboration's closing work).
- tpl 9 Pelican angle row HELD (revisit = more lane evidence or better measurement; apply via
  `backfill-sample-angles.js --apply --plan` with tpl 9 added).
- Slice-2 proven-flag promotion review; SFDEV settings-gate review before deployment; label-above
  keyword coverage (3 directions filed); engine NULL-angle=level decision; `_PREVIEW_DOWNSCALE`
  ~80-effective-DPI probe (the 'Branblewood' m→n class); import-worker thread cap alignment.

## Needs the USER
- Confirm the Pelican docs filed after restart (or reprocess once more).
- The owner test script items C–F + A3 (registration preview on tilted sample) still unsmoked.

## Key facts / paths
- Live DB `%APPDATA%\ScanFinder\docusnap.db`, migration 63; pre-backfill backup
  `docusnap_pre_angle_backfill_2026-08-11T1809.db` beside it. Owner's app RUNNING via `! npm start`.
- Snapshots in `~/Desktop/TESTING/_measure/` (`live_backfill_gate_*.db`, `corrob_flipgate_snap.db`
  4KB TRUNCATED artefact of the heredoc bug — delete on sight).
- Instruments this session: `stress_test/census_sample_angles.py` · `gate_sample_angle_backfill.js`
  · `census_corrob_declines.js` · `pad_probe_customer.py` (+ live-model arms) ·
  `scripts/backfill-sample-angles.js` (census/apply/--plan).
- **GOTCHA (bit hard tonight, memory entry exists): JS written via Bash heredoc loses one
  backslash escape level — better-sqlite3 silently CREATES an empty phantom DB at the mangled
  path and every query reads like corruption. Use path.join/forward slashes; print the resolved
  path before diagnosing any "no such table".**
- Audit `created_at` is UTC (+1 for local BST). Extraction rows have NO timestamps — row-id
  ordering is the only clock; the audit log is the real one.
