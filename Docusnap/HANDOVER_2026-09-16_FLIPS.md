# HANDOVER 2026-09-16 DAY — the dark-switch flip census re-run + the first two flips

## STATE (verified at wrap)
- Branch `feat/teach-side-overnight`, **HEAD `c3ca29e` + this docs fix; origin CURRENT — everything PUSHED
  2026-09-16 on the owner's "push it"** (the 4 video-night commits + today's flips `764b397`/`cb60e3a` + docs).
- Tree: the 7 `tools/video_tutorials/` modifications (6 script JSONs + `voice.py`) were ALREADY uncommitted when this
  session started (09-16 morning, before the census) and were NOT touched — the owner's own edits; leave or commit as
  they see fit. Nothing else uncommitted.
- Migration version **179** (172-175 flips + 176 the split-segment hold seed + 177/178 the two DARK separator
  fixes + **179 the DARK arc-3 seed, 2026-09-17 — the "FIFTH thing" below**). `npm run test:pins` **383/383** at 179
  (the `test_ref_class_fix.js` timing flake happened to pass; it is still a flake). Release gate: "49 DARK keys
  guarded". HEAD = the arc-3 commit (`git log -1`, 2026-09-17); origin current after each push.
- **2026-09-17 leftovers:** the sandbox app (a live-DB COPY, sandbox paths) is RUNNING on DevTools port 9223 after the
  e2e — harmless; close it from its window or kill the electron whose command line carries
  `--remote-debugging-port=9223`. Its scratch folder (`<scratch>\soak\`) dies with the session; every result that
  matters is archived under `TESTING/_measure/watch_separate_soak_20260916/`.
- No app running. No installer built (the flips ship in the next build; they also activate on the owner's live
  install at its next `npm start` / installed-app launch via migs 172/173/174).
- **Second commit this session (owner: "flip 143 as well"): mig 174 `template_pad_date_adopt` ON by default** —
  same shape as `764b397` (UPSERT + `@DEFAULT_FLIP` + delist + the shared pin extended + count pins 48→47 +
  `test_migration143_pad_date_adopt.js` reworked). HARD dependency `template_pad_window_read` verified ON on a
  fresh install AND in the census DB (pinned).

## What happened (owner: "read the handover and continue with the switch tests … then flip 156 and 159")
1. **Census re-run at HEAD** on the 700-doc synthetic warm corpus (`Desktop\Flip Corpus 700\warm_700.db`, COPIED to
   scratch + migrated 163→171 — the Desktop fixture untouched). Baseline OFF (`RR_APP_ENV=1`) + 4 ON arms, ~10 min
   each. Full table in `TESTING/_measure/flip_corpus_20260912/CENSUS.md` (2026-09-16 section); the runner, migrate
   script, comparator and per-arm diffs are in `TESTING/_measure/flip_corpus_20260912/rerun_20260916/`.
   - baseline deterministic (identical to 09-15: 192/400 would-file, same 13 disagreeing, 36 total-noise, #166 silent)
   - **159 `ref_confusable_flag`**: M=0, 0 value changes, 6 fires (every injected `S0-#####`), 2 file→hold — PASS ×2
   - **156 `name_role_nonname_flag`**: M=0, 0 value changes, 5 fires (every injected `BT1 1HE`), 1 file→hold — PASS ×2
   - `deskew_corrob_autofile`: byte-identical to OFF (the 3 straighten-changed fields all KEPT their hold) — safety
     pass, efficacy VACUOUS → **stays DARK** (no evidence for a flip from this corpus)
   - `template_pad_date_adopt` (mig 143): M=0 + the same real heal (#279 date) — PASS ×2 → **flip-ready, owner's call**
2. **The flip (`764b397`)**: mig 172 (`name_role_nonname_flag`) + mig 173 (`ref_confusable_flag`) UPSERT `'true'`
   under `// @DEFAULT_FLIP` labels; both keys DELISTED from `database/dark_switches.js` in the same commit; new pin
   `database/test_default_flip_156_159.js` (fresh-install ON · upgrade-from-seeded-false ON · a deliberate 'false'
   survives a relaunch · delisted · labelled · release-gate clean · handler bridge); `test_migration156_nonname_flag.js`
   reworked to the graduated contract; count pins 50→48; ledger + handler comments updated.

## THIRD thing this session: the split-segment "look first" belt (`db04a8f`, mig 176, default ON)
Owner: "keep going with the recommended work … build it once the oracle signs off". gary designed → Oracle
SIGN-OFF-W/COND C1-C10 (the Oracle run died once on a network error and was RESUMED via SendMessage with its
context intact — that works). Built exactly to the conditions: the separator's rewrite set (now carrying
`separators`) is threaded to `_handleFileMessage` on BOTH arrival paths; every MULTI-page segment of a HEURISTIC
split gets a "— confirm once." lane-hold note on its ref-role row (C3 target order) before the auto-file decision,
so the ONE predicate refuses it at import / File-All-Ready / the sweep (Tier 2 pinned) / the reprocess offer;
slice 2 carries the mark across a reprocess; Review's reason panel says "pages 2–3 were cut from a multi-document
scan… use Split" (C4); `composeNote` never de-dups it (C5). Measured: belt OFF, a manual import auto-filed **12 of
16** multi-page cuts at 100 %; belt ON, **0** (14/14 marked, held) on both watch and manual replays, one-page cuts
untouched (the 34-alert one-click flow intact). Design record `docs/designs/SPLIT_SEGMENT_HOLD_2026-09-16.md`;
Oracle entry appended to `docs/oracle_log.md`; pins `test_segment_hold_{predicate,stamp}.js` +
`database/test_segment_hold_default.js` + a C5 case in `test_note_topic_dedup.js`. Suite 381/382 — the red
`test_ref_class_fix.js` is a PRE-EXISTING timing flake (ARM B hashes two corpora built at different moments →
a second-boundary under load; passes 1 in 3 standalone), not this change.
**Still open (pendingfeatures.md):** the separator's same-logo sibling accuracy, and the class the belt cannot see
(a stack whose only recognised first page is page 1 is never split → imports whole). Oracle's separate fork, not
done: with the dangerous population now marked, the 09-01 import-time hold of 1-page WATCH cuts could be relaxed
to match manual (34 alerts → zero clicks) — owner's call.

## FOURTH thing this session: the separator's accuracy — two DARK arcs (migs 177/178; the last commit on the branch)
Owner: "continue" (the recommended open item). Diagnosed at the source with per-page probes
(`TESTING/_measure/watch_separate_soak_20260916/seg_probe*.py`), gary designed, Oracle **SIGN-OFF-W/COND**, built DARK:
- **`segment_continuation_veto` (mig 177)** — a page that says it is a continuation ("Page 2 of 2", "continued",
  "brought forward") is never cut off. Fixes a PRE-EXISTING silent truncation nobody had seen: the splitter's
  "first page" test is letterhead words + a template match, and a real continuation page that repeats the
  letterhead passes it — 6/6 repeat-letterhead 2-page controls were cut in two by today's code (on a manual import
  page 1 files as a one-page invoice, page 2 orphans). The soak's "0 over-splits" had been vacuous (non-templated
  singles). With the veto: 0/14 controls cut, nothing lost elsewhere.
- **`segment_title_slug` (mig 178)** — the splitter now reads each page's own printed title before matching it to a
  template (a cascade with a fallback that can never lose today's cut). Root cause of the under-splits: the pre-pass
  never got the 2026-07-09 title-precedence fix, so same-letterhead siblings collapsed to the most-confirmed one and
  the type-presence veto refused it. 72 → 79 of 95 stack boundaries, 0 lost, 0 new over-splits.
- Both switches ride ARGV only (`--continuation-veto`, `--title-slug …`) — the pre-pass spawn never sees the
  DB-bridged env. `handler._separationOpts` reads the two settings at both callers.
- **Gates green** (six-arm census + the end-to-end truncation metric = 0 over a 134-doc armed import) — **the flips
  are your call**; the Oracle coupled the title flip to a supplier-aware identity check OR a measured 0 delta on
  logo-only/name-line continuation pages (measured 0). Record: `docs/designs/SEPARATOR_ACCURACY_2026-09-16.md`.
- **Still open (Oracle slices 2/3 + a recovery path):** supplier-aware identity change; an orphan-shaped 1-page-cut
  belt (no ref AND no date AND same supplier as the preceding cut → hold both); Review has Split but no Rejoin and
  the original stack sits in `.sf_separated_originals` unadvertised; the 150-DPI heading-garble residual (5
  boundaries); the never-split whole-stack class (`bundle_05`: three non-templated docs imported whole and
  auto-filed under page 1 — base does the same).
- Traps: the app TRIMS the repo-root `processing.log` (~1 MB) mid-run → never slice by line number; the DB/drain
  uniquify a repeated name with `-N` → classify by `page_count`, and match a `_split_pA-B` range BEFORE stripping a
  suffix; `window.docusnap.processFolder(path)` over CDP wants a forward-slash path and a non-awaiting call.

## FIFTH thing (2026-09-17 morning, the same "continue"): the separator's template-free leg — arc 3, mig 179 DARK
Owner: "continue" → the third lever measured (`seg_probe5.py`, 79 → 93/95 on the probe) → gary designed → Oracle
**SIGN OFF WITH CONDITIONS C1-C9** (`docs/oracle_log.md` 2026-09-17; the run stalled once on a watchdog and was RESUMED
with SendMessage) → built the same morning exactly to the conditions → `docs/designs/SEPARATOR_ACCURACY_2026-09-16.md`
"Arc 3"; results `TESTING/_measure/watch_separate_soak_20260916/RESULT.md` "Arc 3".
- **`segment_known_supplier_change` (mig 179, DARK, `TEST_SWITCH_KEYS` 49):** a page in a scanned stack that names one of
  the install's OWN known suppliers (human confirms ≥ 3 + frozen taught identities — `learning.getKnownSupplierNames`,
  the 18th excluded-reader) different from every known name on the current document's first page, and carries a
  labelled number/date marker (or a recipient block + a real date, or a trusted title when mig 178 is armed), starts
  a new document. Closes the class the mig-176 belt cannot see: a non-templated stack imported WHOLE and auto-filed
  under page 1. Guards each measured on its own control: name admission (no "PT"/"ME"/"Chris Docs"), the ONE
  letterhead-band definition (`template_matcher.header_band_lines`, new) + an item-table cut + a 6-line bound, the
  c/o / delivered-by / via / attn / FAO context exclusion, a money-line exclusion, suffix-stripped prefix-tolerant
  same-supplier (suppress-only), the first-page SET as a WIDE read (Tesseract emits a right-hand issuer block after the
  item table — the strict band false-cut the window-envelope control 2/2), "unknown → known" DROPPED + pinned (the
  blurred-letterhead control), the continuation veto last.
- **Plumbing:** the names ride their OWN temp JSON (`_separationOpts(db, args, tempFiles)` at both callers, pushed to
  the caller's cleanup array; never `buildTrainingArgs`' args — process_docs' strict parse_args); argv-only kill
  `--known-suppliers-file X --known-supplier-change` (both or neither). `segmentation.walk_boundaries` = the page walk
  extracted as a pure function (OFF byte-identical incl. reasons, pinned on legacy 4-tuples).
- **Census with the SHIPPED functions** (`seg_census3.py`; population `known_names.js`): stacks 72 → 79 → **91/95**
  (0 lost, 0 over-splits; the 4 residual each a named deliberate trade — the Oracle replaced its 91 bar with exactly
  that invariant), 179-ON/178-OFF 87; real_34 + singles 39/39; controls1-5 **0 new over-splits** (controls5 = the
  Oracle's C4 shapes: item-table mention, window envelope, blurred p1, c/o + repeated Invoice No, prefix, "Supplier:",
  docket-only witness, the non-templated 2- and 3-doc stacks — every must-NOT-split 0, every MUST-cut cut); the
  owner's own multi-page PDFs (live inbox, read-only + the sandbox's filed output): the only plan changes are the
  belt-OFF replay's wrongly filed merged cuts, each a true different-known-supplier document.
- **e2e (Oracle C6):** the sandbox app restarted on the new code with the THREE separator switches armed, one manual
  import of 72 files (every stack + every control set) through the app's own road over DevTools (`e2e3_run.sh`,
  `e2e_cdp.py` — the runner venv Python), scored by `soak_e2e_check.js` (now FAILS a held wrong cut too) →
  `e2e3_result.txt`: 189 docs, 178 exact, 82 one-page cuts auto-filed all complete, 3 merged cuts held + marked,
  `bundle_05` = a held 2-page + a 1-page ✓, every whole-file outcome identical to the two-switch run (`e2e_parity.js`)
  ✓, **mig 179 added 0 truncations** ✓. **BUT the wider set exposed a PRE-EXISTING silent truncation, live:** four
  marker-less repeat-letterhead 2-page controls were cut at page 2 (identically under base and 177+178), and one of
  them — a buyer-issued PO — AUTO-FILED its page 1 as a complete 1-page document with page 2 orphaned in Review. That
  is today's shipped behaviour on a manual import; logged as the recommended NEXT arc (`pendingfeatures.md`
  2026-09-17, second entry: the Oracle's slice 3 belt, or a suppress-only "same supplier + no witness → never a
  fingerprint cut" extension of arc 3). The e2e driver's first attempt died silently after the login step (the
  login-to-main swap needs `authEnterApp()` — fixed in `e2e3_run.sh`; `e2e3_tail.sh` finished the run).
- Pins: `test_segmentation.py` §9-§12 (+ the third-arm pins), `test_split_plan.js` §8, `test_segment_dark_seeds.js`
  (mig 179), `test_learning_excluded_readers.js` (the new reader), count pins 48 → 49; `header_band_text` is now the
  join of `header_band_lines` (byte-identical, pinned).
- **Still open:** the same-issuer TYPE switch (`bundle_05` p2 — a two-sided trusted-title signal, `pendingfeatures.md`
  2026-09-17), Oracle slices 2/3, Rejoin, the 150-DPI heading residual. **Flip = owner's call** (customer default).

## Plain-English meaning for the customer
- A "name" box that actually reads as a bare postcode / email / VAT number / IBAN now waits for a look instead of
  filing silently. A reference with an O-vs-0 / I-vs-1 / S-vs-5 look-alike in the wrong place now waits for a look
  instead of filing under a wrong name. Neither ever changes a value; both are just a "please check" hold.
- A taught date box that clipped the first digit now takes the wider read when a second reading of the page backs
  it up, so the correct date files instead of waiting (mig 174; the census's one swap was the right date, twice).
- All three can be switched off (Settings → the dev switches, or a settings write) and the off choice sticks.
- (Built but OFF, 09-17) When a scanned stack switches to a company you already know well — a supplier you have
  confirmed three times or taught — the splitter now starts a new document there, even when that company has no
  taught layout for that kind of paper. Today such a stack comes in as one file under the first page's company.
  It never cuts on a "c/o …", a "Bill To", a name in the items list, "Page 2 of 2", or a company name it cannot read
  on the first page.

## Traps learned (also in memory `project_flip_corpus_pipeline_20260912.md`)
- The Bash tool's background mode has a 10-minute cap → launch a multi-arm census DETACHED (PowerShell `Start-Process
  bash …`) and watch the output file with a Monitor.
- A `TaskStop` on a background bash does NOT stop the script — it killed the electron child and the script moved on
  to its NEXT arm, writing the same output files as the fresh run. Kill by PID, the bash FIRST, then its children.
- Never run the pin suite while census arms run (8 OCR shards + per-file watchdogs → a starved doc reads null = a
  false M).

## NEXT (owner decides)
- ~~Push~~ — DONE (origin current after each step).
- ~~Flip `watch_separate_enabled`~~ — **DONE, mig 175**, but NOT on the earlier "soak PASSED" claim: that ledger line
  (09-12) had NO run behind it. The owner chose "run the soak first"; it was run 2026-09-16 in a sandbox on a copy of
  the live DB (`TESTING/_measure/watch_separate_soak_20260916/RESULT.md` + reusable harness): analyzer PASS, the real
  34-page bundle 34/34, 0 over-split, 91 segments all held, 0 auto-filed; synthetic same-logo stacks under-split =
  the separator's fingerprint floor (shared with manual import, never worse than OFF). **Seam logged in
  `pendingfeatures.md`:** the hold is import-time only → a later File-All / scope sweep can file a merged clean
  segment unseen → a durable "look first" mark is the follow-up belt. `deskew_corrob_autofile` stays DARK.
- **The soak sandbox app may still be running** (dev app, DevTools port 9223, `DOCUSNAP_USERDATA=<scratch>\soak\
  userData`, a COPY of the live DB with sandbox paths; login admin / Scan-Finder-2026). Harmless; close it from its
  window or kill the electron whose command line carries `--remote-debugging-port=9223`. Its scratch folder dies
  with the session.
- The rest of the flip queue is in `docs/DARK_SWITCH_LEDGER.md` (🟡 WAITING; most are geometry-inert on the synthetic
  corpus → efficacy only on real exhibits; `format_class_join` HOLD on blast radius).
- Then the standing 09-15 EVENING queue: VM live-test of both installers; Departments D2b/D3/D4 before the
  `departments_enabled` flip; client-Review S0.

## Commands
```powershell
# census (detached; ~10 min per arm over 400 docs)
Start-Process 'C:\Program Files\Git\bin\bash.exe' -ArgumentList '"<scratch>\census_run.sh"' -WindowStyle Hidden -RedirectStandardOutput '<scratch>\census_run.out'
# compare an arm to the baseline
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe TESTING/_measure/flip_corpus_20260912/rerun_20260916/compare.js base.jsonl on.jsonl "<fire regex>"
# pins
node scripts/run-pins.js
```
