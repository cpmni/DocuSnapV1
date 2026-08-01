# HANDOVER 2026-08-02 OVERNIGHT (autonomous while owner slept; follows HANDOVER_2026-08-01_NIGHT.md)

**Branch** `feat/reprocess-throughput-autostraighten` · commits tonight: `29c4927` (Chris round-1
cards) + `53513cf` (clamp + slice-4 gates), **both PUSHED**. Dev app left RUNNING (CDP 9222,
`SCOPE_SWEEP=1` env armed). Live DB untouched except nothing — the one intended write
(`scope_sweep_enabled` flip) was permission-blocked and deliberately left to you.

## MORNING CHECKLIST (owner)
1. **Read `docs/CHRIS_FULL_APP_REVIEW_2026-08-02.md`** — Chris's full-app report, verbatim voice
   (you asked for the whole thing, not a table). Vet his cards before anything is built.
2. **Chris round-1 cards are LIVE (`29c4927`)** — reopen the Review window and eyeball: labelled
   "Use …/Keep …" buttons · plain-English chips ("Recognised by: Its logo and wording") ·
   "Found on a second look" pill · badge gone on empty fields · relabelled cues. All renderer-only.
3. **Clamp flip decision** — gates + the Oracle's adjudication below. If accepted: the flip is
   env `ANCHOR_LABEL_LEFT_CLAMP=1` (dark kill switch; stays OFF until you set it).
4. **Catch-up flip** — slice-4 gates ALL GREEN; `scope_sweep_enabled` still OFF (my live-DB write
   was permission-blocked overnight — correct). Flip = Settings, or keep trialling via
   `SCOPE_SWEEP=1`. Consent bar + accept/undo all live behind it.
5. Still owner-pending from yesterday: the 3 GT-poison exhibits
   (`stress_test/out/stroke_sub_2026-08-01/zooms/doc{86,154,285}_600_wide.png`) → Learning Repair.

## 1 · Chris round-1 cards — SHIPPED (`29c4927`)
All green-lit cards built (renderer + CSS only, all review contract tests green):
labelled consent buttons "Use “WS-73541”"/"Keep “WS-7354”" (18-char ellipsis; Keep hides the
note display-only) · teach-copy contradiction reconciled ("If the value is wrong, teaching it
(⊕) usually fixes it for good — if it's right, just confirm") · "Cleared 1 field that was…"
grammar · conf badge suppressed on EMPTY fields (kills "High · 87%" beside "Not found" and the
"Low · 0%" under a ⟳ fill) · jargon pass (chips plain-worded with the technical term in the
tooltip; "cached-text re-read" → "Found on a second look"; "auto-committed" → "filed
automatically"; taught-dot titles plain) · cue numbers labelled ("Overall 97% · checked by
you", "Read at 88% · your setting 95%"). Card-6 roll-up + per-row % stayed PARKED as agreed.

## 2 · Label-tail crop CLAMP — BUILT DARK (`53513cf`), gates run
Per the signed design (C1-C7 verbatim in `pendingfeatures.md`, now marked BUILT):
- `python_backend/extraction/anchor.py`: `_label_left_limit` (LOCATED-frame expected-value-left,
  C1 frame trap pinned) + `_crop_and_ocr(left_limit_norm=…)` (rightward-only, 3px guard, C5
  degenerate→unclamped) at ALL FOUR crop sites (C4; label-lock types disjoint = pinned asymmetry).
- 26 pins green: `python_backend/tests/test_label_left_clamp.py`.
- **Gate results** (481-doc realdoc OFF vs ON; `stress_test/clamp_gate_diff.js`):
  · recovered rows **54 → 3** (the hold-every-batch class is dead)
  · would-auto-file **370 → 406** (+36 docs freed)
  · 2 HEALS (#79 `DO.96700`→`PO-26709`, #406 `PO9974A9C`→`PO-27425`)
  · flags 20 → 18 · wall 552s → 513s (faster) · **zero NEW would-auto-file-wrong** (the 11 are
    the identical pre-existing set: GT-poison + stroke-sub class)
  · Saltmarsh (99 docs): 98 would-file, 0 recovered, no new wrong.
- **ONE residual value flip — #218** (Vellum & Crane sales_order, deterministic ×3): OFF, the
  tail-dirty crop failed credibility and the recovery ladder happened to read the correct
  `SO-68195`@85; ON, the CLEANED crop reads `SO-68105`@98 directly — an interior `9→0` stroke
  substitution, the documented dominant Vellum residual class. Review-bound BOTH ways (below
  floor); never auto-files. The clamp exposed a glyph ambiguity the broken crop was accidentally
  surviving.
- **Oracle ADJUDICATION: ACCEPT AS RESIDUAL — GO on the flip.** He traced the code, the jsonl
  rows, and the D2 bake-off (which ABSTAINS on this exact doc — no banked witness reaches it;
  a guard would be theater). Gate letter AMENDED on the record (oracle_log 2026-08-02 entry):
  "zero UNRESIDUALED flips" with four criteria — #218 is NOT precedent for the next flip.
  **The one sentence he requires you to read: in Review, #218-class docs now show a wrong value
  at conf 98 with NO flag where you'd previously have seen the correct value at 85 — a casual
  confirm teaches the wrong ref AND counts toward Vellum's graduation (W3: check Vellum-class
  refs against pixels until ocr_dpi 200→300 lands).** Watch bars: W1 = any operator correction
  of an AUTO-FILED anchor_crop ref by a 1-2-digit same-skeleton diff ⇒ kill the clamp, re-gate ·
  W2 = stroke-sub residual crossing ~3% revives D2 (now ~1.0%) · W3 above. Expect ~36 docs to
  leave the hold class on your next Reprocess-all with the clamp ON.
- **I then eyeballed #218's page myself at 600 DPI** (`stress_test/out/stroke_sub_2026-08-01/
  zooms/doc218_600_wide.png`, now in your GT-poison pile): the page prints a legible
  **SO-68195** — GT confirmed, the flip is real, the residual ruling stands. All five Oracle
  conditions executed except the case-7 triage (this week) — jsonl NUL-scan came back clean.

## 3 · Catch-up Filing slice 4 — GATES BUILT + ALL GREEN (`53513cf`)
- `stress_test/sweep_integration_fixture.js` — 24 checks: K=10 human confirms through the ONE
  shared reviewService.confirm → graduation is the human-only computation → Tier-1 candidacy is
  ZERO-WRITE (total_changes pinned) → SEAM-2 candidacy→accept mutation DROPS the doc →
  accept `{via:'scope_sweep'}` stamps confirmed_via, SKIPS corrections, leaves hints untouched,
  drops the queue, leaves graduation at 10-human → undo returns docs, KEEPS stored_path,
  restores field-format learning BYTE-EQUAL → handler ipc-layer source pins.
- `stress_test/sweep_demo_gate.js` — REAL pipeline on the born-digital demo corpus (Halcyon
  Supplies invoices): cold import 20 → confirm 10 with GT → warm queue → **6 green-lit, 6/6
  role values == GT** → the 4 odd-format refs (INV011025 class) correctly EXCLUDED
  (stored-flagged) → a poisoned stored ref NEVER green-lights (role-mismatch) → accept +
  graduation-exclusion + undo learning-restore all pinned. Models a tuned install
  (threshold 95 + learned template); graduation bootstrap honesty stays with the fixture.
- **Flip**: gates green ⇒ design says flip. My write to the live DB was permission-blocked, so
  `scope_sweep_enabled` remains OFF — your one-click.

## 4 · Chris full-app review (round 2) — VERDICT: qualified "yes, I'd keep it"
Full report VERBATIM (his voice, walkthrough + cards, as you asked):
**`docs/CHRIS_FULL_APP_REVIEW_2026-08-02.md`**. He drove the LIVE app read-only over CDP
(screenshot capture hangs in this Electron build — he worked from the rendered DOM text; every
quote was on screen). He reviewed the POST-`29c4927` renderer — and card 4 of round 1 landed:
he called the new "Recognised by: Its logo and wording / Fields read by: Remembered positions"
chips one of the best things in the app, unprompted.

**His 7 cards, ranked (NOTHING implemented — you vet):**
1. **"🗑 Delete All Review" has NO tooltip** while File-All has a full sentence — the most
   dangerous button is the least explained (verified: `review/index.html:913`, no title attr).
2. **Deferred tab empty-state**: blank white list + the previous doc still live in the pane
   with "✓ Confirm & File" clickable — "there's nothing here" and "shall I file this?" at once.
3. **Home "481 this week" vs Search "CONFIRMED 200"** — no "showing first 200 of…" line; he
   spent 5 minutes convinced 281 documents were missing (Search page-caps at 200 silently).
4. **Search dead-ends at the found doc** — no "Open"/"Show in folder"/"Print" beside the found
   invoice; back to Windows Explorer with the accountant on the phone. His words: "the one
   place the app hands me back to the old way".
5. **Review self-contradiction**: hold note says the ref was read "at lower confidence than
   automatic filing requires" while the SAME field wears "High · 85%" and the doc wears
   "Looks good — 97%" + "Overall 97% · checked by you" (he hadn't checked anything).
   Trains him to ignore all badges.
6. **User guide stale ×3**: "Settings → General → Re-run setup" (no General tab — it's
   Advanced), the "Fast or Smart" mode badge section (mode was collapsed 07-08 — verified
   `help/getting-started.html:106` still carries it), stale home-screen screenshot caption.
7. **"DOCUMENTS FILED" card: 481 this week / 279 this month** — month smaller than week (it's
   Aug 1: calendar month vs rolling 7 days — labels don't say so).
Also flagged en route: "Fix this type…" label invites a click that WIPES learning ·
"OCR Enhancement" tooltip means nothing to him · teach window says "anchor" + name-drops a
"Template Manager" he's never seen · Escape doesn't close the About box · "-DUPLICATE-7"
filenames alarm him · the two confidence sliders in Processing are confusable twins.
**What worked (his list)**: the duplicates "nothing is ever overwritten" sentence · the live
filing-path preview · the new plain-English chips · the practice-run copy · the failure-mode
small print · Search speed (20 seconds to the March Thornbury invoice).
Round-2 citation spot-checks: 3/3 verified. His screenshot-capture driver note is in the
report's footer (CDP `Page.captureScreenshot` hangs on this build — worth a look someday).

## Verification state (honest)
- Chris cards: parse clean, no NUL bytes, all 7 review contract suites green. NOT eyeballed in
  the live UI overnight (renderer loads on your next Review-window open).
- Clamp: 26 pins + the full OFF/ON realdoc gate pass above. The neighbouring anchor suites ran:
  7/8 green; `test_anchor_crop_crosscheck.py` case 7 fails 3 checks **at HEAD too** (git-stash
  verified — pre-existing, likely superseded by the 07-09 cross-supplier absolute-read gate;
  needs its own session, don't fix casually).
- Slice 4: both gate harnesses green end-to-end; the ipc layer itself is source-pinned (it
  closes over Electron main state — exercised by your live `SCOPE_SWEEP=1` trial).
- Realdoc jsonl evidence in `stress_test/out/clamp_{off,on}.jsonl` (+`_dump`) — gitignored,
  regenerate with the env recipe in the memory file.

## KEY SWITCHES tonight
`ANCHOR_LABEL_LEFT_CLAMP` **BUILT, default OFF** (flip = owner) · `scope_sweep_enabled` OFF
(gates green, flip = owner) · `SCOPE_SWEEP=1` still armed in the running dev app ·
`DIGIT_DISAGREE_FLAG` / `REEXTRACT_BLANK_REIDENTIFY` unchanged ON.

## GOTCHAS added tonight
- `SELECT total_changes()` (SQL function), not `PRAGMA total_changes` — the fixture's ZERO-WRITE pin.
- Sub-100 `docTrustGate` requires a template match — a fixture DB needs a `templates` row +
  `documents.template_id` or every candidate refuses `no-template`.
- The demo-gate cold import leaves supplier BLANK (letterhead hole) — production sweep candidacy
  operates on post-reprocess stored rows; harnesses must model that or every doc excludes
  `role-empty-stored`.
- PS 5.1 here-string via the shell tool can mangle `git commit -m @'…'@` — use `git commit -F <file>`.
