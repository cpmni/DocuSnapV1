# HANDOVER — 2026-08-05 NIGHT (Straighten pivot LIVE on the owner's data; 16/20; the morning polish round chartered)

**Branch** `feat/reprocess-throughput-autostraighten` · **HEAD `8961d89`, PUSHED, tree clean.**
**Running:** the owner's dev app may still be open (their `npm start`). Chris sandbox DOWN.
**Context:** continues `HANDOVER_2026-08-05.md` (+2 addenda) — read its Straighten addendum first.

---

## ⚠ FIRST ACTION — OUTSTANDING RESTORE (owner never ran it)
Live docs **560/561** (Larkspur dockets 19/14) have **no working files** — the Chris sandbox's
auto-file MOVED the live inbox PDFs (the sandbox DB copy kept live-pointing `working_path`s — my
setup error, owned in-session). The owner saw "in the queue with no preview". Files are secured
DURABLY at **`c:\GIT Projects\Docusnap\recovered_inbox\560.pdf` / `561.pdf`** (the scratchpad
sandbox is session-mortal — do NOT rely on it). RESTORE (owner runs, or next session asks):
`Copy-Item "c:\GIT Projects\Docusnap\recovered_inbox\560.pdf" "$env:APPDATA\ScanFinder\inbox\560.pdf"`
(and 561 likewise). Classifier blocks Claude writing into `%APPDATA%\ScanFinder` — the OWNER pastes
it (`!` prefix). Future /christest MUST rewrite copied-DB `working_path`s into sandbox-local copies
(skill hardening — not yet edited into the skill).

## TL;DR of the night arc (after the Chris vet)
1. **TEACH_ANGLE_COMPOSE live plumbing shipped:** settings bridge + Settings→Processing toggle
   "Align taught reading spots on straightened pages" (`9cb65fa`); the lazy angle-heal spawn bug
   (`ctx.pythonExe` is a FUNCTION — spawned the function object, silent no-op in sandbox AND live)
   fixed `4f8e2e1`; every heal skip/failure branch now logs (`8961d89`). The live heal STILL never
   fired a logged line in the owner's sessions (their last reprocess predates the instrumented
   build) — the angle was seeded MANUALLY: owner ran the UPDATE (template 27 → **1.5°**, CLI-
   measured from the pinned sample). NEXT live teach templates need the heal proven — read
   `processing.log` for `[training] angle heal` lines on the first post-restart batch.
2. **Live outcome on the owner's Larkspur batch (their DB, their reprocess): 16/20 full correct
   DN-xxxxx** (mostly @97-98; 3 healed by edgegrow; 13/19 correct-but-false-flagged @78).
   Residuals: docket_20 old value (NOT reprocessed after the angle landed — one reprocess away),
   docket_11 'IN-75028' (leading-glyph substitution at the composed left edge), docket_05/06
   garbles (05 'IN-TOYUZ', 06 'ADIAOINNAL' — 06 is LEVEL and reads perfectly by hand-draw; the
   composed box lands off-row there — unreproduced, probe offline). Owner ⊕-taught docket_06's
   delivery_number live (fresh authoritative anchor, will serve siblings).
3. **The Kyle Test geometry caveat is REAL but NOT the whole story** (owner pushback correct):
   those scans carry the old expand-True rotation (page grows + translation — physically
   impossible for real scanners; generator fixed earlier tonight, `SCAN_EXPAND=1` restores). It
   explains ~a glyph of residual placement error on THIS set only. But the owner's key
   observation — hand-drawn boxes on straightened Review pages seldom misread — pins the truth:
   READING is fine everywhere; cross-document PLACEMENT transfer is the whole failure class.
4. **THE MORNING ROUND (owner-agreed, Oracle required, evidence all banked):**
   1. **Composed-box word-snap** — a composed box is MACHINE-DERIVED placement, not operator
      WYSIWYG → snap-eligible under the standing "derived rungs snap" principle. Seat within a
      glyph (composition) + snap finishes = the self-correcting placement the owner's eye does.
   2. **Leading-glyph witness-adopt** — keyword held the CORRECT value every observed time
      ('DN-75028' 93%, 'Pemberton Joinery' 78%) and lost confidence coin-flips to garbled curated
      reads ('IN-75028' @97, '2emberton' @84). Rule family = NAME_UNCLIP's cut-glyph comparator,
      applied to codes+names with a distinct-stage witness.
   3. **Wizard-anchor tightening** — wizard-taught anchor boxes can span rows (docket_07's
      customer anchor swallowed 'DELIVERY' + the address block); snap stored anchors to the
      matched label word-run at teach commit (parity with ⊕, which stores tight label boxes).
   4. **False "differs from the usual format" note** — flagged 4 clean values @78 (dockets
      12/13/16/19 class; both trace target crops read the SAME correct value). Also: label the
      SFDEV trace's crop tiles with their RUNG (two identical "target · template_mapping" tiles
      confused the owner — abs read vs verify re-read).
5. Chris's vet round is archived VERBATIM: `docs/CHRIS_FULL_APP_REVIEW_2026-08-05.md` (his 4
   cards queue for the owner's vet — batch skips the OPEN doc silently · false format note ·
   silent auto-file messaging · High-badge-vs-70%).

## Verification state — honest
- Corpus gates (faithful NF corpus, tilted teach, deskew forced): nf_off→nf_on2 ref +13/+14.5,
  date →98.6/95.7, issuer +20/+20, po_ref →94.4/100 (reports `stress_test/out/customer_score_nf_*`).
- Live: 16/20 verified BY DB QUERY (not just the UI). docket_20 unverified post-angle (not rerun).
- The angle-heal chain is UNPROVEN live end-to-end (manual seed bypassed it); instrumented build
  `8961d89` will tell on the next session's first batch.
- The customer-lane caption-commit residual (NF corpus scanned 22.2%) stands — needs the
  known-caption vocab veto in the mapper free-text gate (named follow-up, own Oracle round).
- Pre-existing failures unchanged: `test_template_rescue.py`(1) catalogued since 07-21.

## Key facts / paths
- Live DB migration now 58 (`templates.sample_deskew_angle`; template 27 = 1.5 manually).
- Kill switches tonight (all setting-bridged): `teach_angle_compose` (ON live) +
  `template_abs_edge_guard`/`template_date_clip_gate`/`template_label_digit_exact` (ON live).
  Env-only + dark: `DESKEW_RAW_CROPS` (gate red), `DESKEW_SS_ROTATE` (hypothesis refuted).
- Faithful corpus: `Desktop\Customer Doc Test NF` (expand=False; scorer env `CORPUS_DIR`,
  generator `CORPUS_OUT`, `TEACH_SCANNED=1`, `DESKEW=1`).
- New pins tonight: `test_teach_angle_compose.py` (15) · plus the day's suites (see prior handover).
- Oracle log: three 2026-08-05 entries + the composition GREEN outcome; Chris review doc above.
- Gotchas reaffirmed: ctx.pythonExe/pythonArgs/configPath are FUNCTIONS in main.js ctx · the
  repro harness for handler internals must run under Electron-as-Node (better-sqlite3 ABI) ·
  classifier blocks writes into `%APPDATA%\ScanFinder` (owner pastes restores).
