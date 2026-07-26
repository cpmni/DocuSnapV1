# HANDOVER 2026-07-26 NIGHT (Opus 4.8 · autonomous overnight, owner asleep)

Branch `feat/reprocess-throughput-autostraighten` · **ALL PUSHED through `c617230`** (origin `0 0`) ·
working tree clean (only the pre-existing untracked `Backup/` + `Docusnap - Copy*` at repo root, and
gitignored `build_python/`+`dist/`). Two atomic, kill-switched, git-revertible commits this run.

## TL;DR
Finished **task #5 (Northgate PO→Invoice type-flip)** end-to-end — Herald-designed, Oracle
SIGN-OFF-WITH-CONDITIONS (all 6 met), corpus-gated on a FROZEN live-DB snapshot, committed + pushed
(`e0b5c04`). Then did **build decompile-hardening** to its safe unattended limit (`c617230`): shipped
the one default-safe rung + the fuses mechanism DEFAULT-OFF, verified via a real dry pack, and
documented the rest (which needs your live smoke). Nothing is armed; the default build is byte-identical.

## `e0b5c04` — task #5 type-flip fix (Lever 1 + Lever 3), BOTH DEFAULT ON, kill-switched
Root (Herald forensic, Oracle-verified): a skew-garbled / letter-spaced title fails the classifier's
EXACT `_despaced_heading` test → title untrusted → the type falls to a same-logo sibling whose
pure-letterhead fingerprint scores 1.0 on every page and wins, with NO exact score tie for the
ambiguity guard to catch.
- **Lever 1 — `HEADING_FUZZY_VOCAB` (keyword.py):** a fuzzy arm beside the exact test — difflib
  block-ratio ≥ **0.82** to the tiny installed type-name/alias set, ARGMAX + **0.08 margin** (measured
  vocab-to-vocab max 0.737, so a clean different-type phrase can't cross-match), single-word titles
  admitted only when genuinely fragmented (preserves the alias-is-exact contract), multi-token only.
  New `_collapse_title_tokens` shares the peel so `_despaced_heading` is left byte-untouched (Oracle C4).
- **Lever 3 — `KW_TYPE_NONDISTINCTIVE_HOLD` (template_matcher.py):** the silent-misfile backstop.
  `_kw_nondistinctive_hold` HOLDs a keyword-arm winner whose DISTINCTIVE fingerprint ⊆ a same-supplier
  different-type sibling's, WITHOUT an exact tie. Threads `title_trusted`; fires only on the
  untrusted-title residual (gate `winner_slug_match == 0 and not title_trusted` — a trusted title or a
  slug-decided winner defers to Lever 1 / the existing REFUSE, so the two levers compose with no
  double-hold). Reuses the intact ambiguity→HOLD engine chain (NO engine change).
- **Both kill switches OFF ⇒ byte-identical** (proven: corpus enum IDENTICAL to baseline).

### Gate (frozen snapshot `scratchpad/typegate_frozen.db`, 645 confirmed docs, gt_overrides applied)
- OFF-OFF == baseline byte-identical. Value accuracy byte-identical (type 99.5 / supplier 100 / ref 98.0
  / date 95.3). **M_type 0. No new silent-misfile. No new false-hold. −6 false-holds fixed. +1 correct
  auto-file (#182).**
- **Northgate contrastive** (`stress_test/northgate_type_trace.js`): OFF = 673/674 typed **invoice**
  (conf 41, no guard = silent-capable); Lever-1 ON = 673/674 → **purchase_order** (refuse-held);
  Lever-3-only (FUZZY=0) turns the **conf-100** garble from silent-capable Invoice into **ambiguity-HELD
  with the correct PO type suggested** — the hole closed. 670/667/685 (clean titles) unchanged.
- All Oracle C1–C6 met (test 8 flipped to the subset-HOLD + an OFF legacy pin; margin/threshold +
  empty-distinctive-set pinned; `_despaced_heading` untouched; frozen snapshot + gt_overrides + per-supplier segmentation).

New gate tooling (carry no data, safe to commit): `stress_test/type_outcome_report.js` (silent-misfile /
false-hold enumerator), `northgate_type_trace.js` (contrastive type trace), and an inert-by-default
`RR_TYPE_ENUM` dump in `realdoc_regression.js`.

## `c617230` — build decompile-hardening scaffold (eric-designed; `docs/BUILD_HARDENING_PLAN_2026-07-26.md`)
- **Rung C (DEFAULT ON, zero brick risk):** `package.json` `files` negations drop `test_*.js`/`__tests__`
  from `app.asar` (grep-verified no production code references a `test_*.js`). Stops the test corpus
  leaking exact thresholds/pins. Dry-pack verified: **0 of our test files in the asar** (1 harmless
  better-sqlite3 dep `.c` remains); trust.js/main.js/preload.js all present.
- **Rung A scaffold (DEFAULT OFF):** `scripts/afterPack-fuses.js` (+ `build.afterPack`) flips the SAFE
  Electron fuse subset (RunAsNode / NODE_OPTIONS / --inspect OFF) on `ScanFinder.exe` ONLY when
  `HARDEN_FUSES=1`. Default (unset) = no-op (byte-identical); `@electron/fuses` (MIT) is required inside
  the armed branch so a missing dep can't break the default build.
- Verified WITHOUT launching: default dry pack `electron-builder --dir` **succeeds**, afterPack no-op
  fired; `check-licenses` **OK — 79 components, all commercially-free**; `check-vendor-python` OK.

## ⭐ NEEDS THE OWNER (all require a live app — I could not do these asleep)
1. **See task #5 live:** `npm start` (carries source) → reprocess the **Northgate** batch: the POs now
   type **Purchase Order** (were Invoice) and are held for review with the correct type pre-selected.
   (Copperfield B′ from the evening session is unaffected.) The live DB was NOT written by me (all
   replays read-only on a frozen copy).
2. **ARM the hardening (fuses):** the meaningful anti-decompile/anti-tamper step is DEFAULT-OFF pending
   your smoke — a bad fuse flip = app won't start. To test: `set HARDEN_FUSES=1 && npm run build`, install,
   and **launch every window** (main/review/search/settings/teach/license). If it starts clean, the flip
   is good. (Mechanism-only proof without launch: dry-pack armed, then read the fuses back off the exe.)
   Then decide whether to leave `HARDEN_FUSES=1` in the release build command.
3. **Decide the deferred hardening rungs** (`docs/BUILD_HARDENING_PLAN_2026-07-26.md`) — each needs a live
   smoke: Rung B asar-integrity (electron-builder native `electronFuses`), Rung D JS bytecode/minify
   (bytenode MIT main-process only), Rung F config-encryption (the #1 plaintext IP surface —
   `config/keyword_patterns.json`), Rung E `.pyc`→native (Nuitka/Cython, Apache-2.0). Weakest links today
   = config JSON + JS-in-asar; the `.pyc` engine is already the best-protected surface.

## Revert / recovery
- `git revert e0b5c04` (type-flip) and/or `git revert c617230` (hardening) — clean, independent.
- Or just leave the kill switches: `HEADING_FUZZY_VOCAB=0` + `KW_TYPE_NONDISTINCTIVE_HOLD=0` restore the
  pre-fix classifier byte-identically; `HARDEN_FUSES` is already off; `SHIP_PY_SOURCE=1` restores verbatim Python.

## Facts / paths
- Corpus (frozen A/B): `RR_DB=<frozen.db> RR_TYPE_ENUM=<file> [HEADING_FUZZY_VOCAB=0/1] [KW_TYPE_NONDISTINCTIVE_HOLD=0/1]
  ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js` →
  `node stress_test/type_outcome_report.js <baseline.jsonl> <treatment.jsonl>`. Run WITHOUT `GATE=1`
  (pre-existing #583 M forces exit 1). Clear `python_backend/**/__pycache__` after a Python edit.
- Unit: `py -3.12 python_backend/tests/{test_heading_fuzzy_vocab,test_kw_type_ambiguity,test_heading_letter_spacing}.py`.
- Herald spec: `docs/HERALD_TYPE_DETECTION_REFERENCE.md`. Hardening: `docs/BUILD_HARDENING_PLAN_2026-07-26.md`.
- Installer `r20260726-1018` predates ALL of this — rebuild to carry task #5 (and to smoke the hardening).
