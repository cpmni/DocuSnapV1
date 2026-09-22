# HANDOVER — 2026-08-13 AFTERNOON (the teach-poisoning arc: Oracle SEND BACK, then 3 slices shipped)

**Branch `feat/teach-side-overnight` · HEAD `dc4bf1d` · THREE COMMITS UNPUSHED (ahead 3 of
`origin/feat/teach-side-overnight`) · tree clean · no installer built · nothing running.**

Follows `HANDOVER_2026-08-13_NIGHT.md`, which wrapped this morning at `e5e93fe`. Owner present
throughout; every step was owner-directed. **No live-DB write, no migration (still 63), no flag
flipped — all three new switches ship DEFAULT OFF.**

Controlling design document: **`docs/designs/TEACH_POISONING_ARC_2026-08-13.md`** — Oracle's nine
blocking conditions, the revised ordering, and the measurements. **Read it before continuing the
arc**; this handover is the state, that file is the plan.

## TL;DR
The owner ordered a thorough diagnosis-and-fix of the class Chris has reported for four rounds:
**a teach commits a garbled company name silently, freezes it, stamps 20 siblings at 95, and files
12 to disk.** Six agents ran (three source maps, then gary/reggie/eric, then Oracle on the
consensus). **Oracle SENT THE CONSENSUS BACK** with nine blocking conditions and found the real
root cause a layer below anything the three advisors proposed. The plan was rewritten around the
verdict and three slices shipped in Oracle's ordering. **The round-4 exhibit is now prevented at
the write** (`dc4bf1d`).

## COMMITTED (3, all UNPUSHED, all DEFAULT OFF except the data-loss fix)

### 1. `98d4fbb` — an issuer-change clear is no longer recorded as an operator correction
**Live, unflagged data loss.** `_clearSuspectReadsForNewIssuer` (review/renderer.js) empties fields
read from a supplier-scoped source when the issuer changes — correct policy — but recorded it as
`corrections[key] = {corrected_value:''}`, **byte-identical to an operator's own edit**.
`saveCorrections` wrote that straight through: `UPDATE extractions SET display_value='',
was_corrected=1` (learning.js:325), blanking the stored row plus a corrections audit row asserting
an edit that never happened. Two branches; the quiet one is worse — where `_resolveFieldVisibility`
repainted, the operator saw the CORRECT values and confirmed while the row was emptied underneath.
- Fix is in the RENDERER: the clear stages no `corrections` entry, recording keys in a doc-scoped
  `clearedByIssuerChange` set; `renderFields` suppresses a cleared field across a repaint (without
  this, dropping the entry would let the rebuild RESURRECT the previous supplier's values and the
  DOM scrape would file them); an operator edit releases the suppression; the destructive clear's
  toast is now `warn`, not `ok`.
- Files: `src/windows/review/renderer.js`, new `src/windows/review/test_issuer_clear_not_a_correction.js`.
- **18 pins; all 10 review suites green; the four critical pins RED-PROVED against HEAD.**

### 2. `175d853` — filing identity follows a repaired issuer (`identity_scope_post_repair`, OFF)
`results['_supplier_name']` becomes `documents.supplier_name` — **the filing folder and the
universal learning scope key** — and is captured at engine.py:8332 from a local last written at
:7220, i.e. BEFORE Stage 4.5, `_adopt_identity_variant` and the late supplier writers can heal the
issuer. So a repaired name could reach the extraction row while the document filed and learned
under the unrepaired string.
- Adds a late `_rederive_filing_identity` at the end of `extract()`. **ADDED, not moved** —
  `supported_keys` and `_flag_branding_conflict` still see the pre-repair local, byte-identical.
  Whether the branding cross-check should judge the post-repair name is a **deliberately unmade
  decision**, pinned as such.
- Files: `python_backend/extraction/engine.py`, new
  `python_backend/tests/test_identity_scope_post_repair.py`, `_reconcileEnv` bridge + Settings
  toggle + a row in `test_settings_wiring.js` BRIDGES.
- **12 pins green.** Verified by IMPORTING engine.py, not `py_compile`.

### 3. `dc4bf1d` — a teach can no longer rename a sender it already knows (`teach_identity_near_match_keep`, OFF)
**The write that cost Chris twelve files.** `_upsertFields` had exactly one guard — `fixed_locked=1`
— and **never compared warrants**, so 38 confirmations lost to one draw-box OCR read. One teach runs
the overwrite TWICE.
- Asks the narrower question: *may this value replace a DIFFERENT existing frozen identity?* A near
  match keeps the incumbent silently (the owner's 1-2 character auto-correct rule, at the one seam
  where the candidate set is a single string). **Not** a widening of `freeze_guard` — that excludes
  the issuer because five shipped guards need a seed to EXIST; a decline keeps the incumbent, so all
  five stay armed and the blast radius is one column of one row.
- **THE INVARIANT, PINNED: a genuinely different company still displaces the stored identity**, or a
  wrong frozen name could never be corrected by re-teaching.
- New `database/modules/name_proximity.js` — the JS twin of the deterministic legs of Python's
  `name_match`. Levenshtein on the alnum fold normalised by the longer string; **not** Jaro-Winkler
  (its prefix bonus under-scores this product's documented first-glyph corruption class) and **not**
  a token-set ratio (`'Smith Ltd'` vs `'Smith Roofing Ltd'` scores 100). Unicode-aware fold, mirroring
  Python's `isalnum()`.
- **Both legs required, measured:** `'B8ramblewood…'` = 1 edit/22 = **0.955**;
  `'Brambleworth…'` (a different company) = 3 edits/22 = **0.864**. Both clear a bare 0.75 floor, so
  the **edit cap** separates them. Short names structurally excluded (BP/IBM/3M/EE/O2).
- Files: `database/modules/templates.js`, new `name_proximity.js`, new
  `test_identity_overwrite_guard.js`, Settings toggle + SETTING_SWITCHES row.
- Pins run against a **real** better-sqlite3 DB through the **real** `templates.update` path,
  because the defect lives in an UPSERT's conflict branch.

## VERIFICATION STATE — read this before trusting any of it

**B1 + Census E (read-only, live DB) — DONE, and it settles two things.**
Instrument `scratchpad/b1_lexicon_premise.js` (session-mortal; re-create from the design doc).
- Oracle's falsifier fires on **one doctype of nine**: `sales_order/supplier_name` has 3 distinct
  values. **`purchase_order` (the B8ramblewood exhibit) and `credit_note` (the Meadowvale `Lid`
  exhibit) both have 1**, in both the supplier-scoped and the fallback scope. gary's
  `format_anomaly_checker.py:763` (`if len(samples) < 3: continue`, on the DISTINCT set) root cause
  **survives**.
- **Census E: 33 of 36 name-like scopes (91.7%) have exactly ONE distinct confirmed value.** That is
  the population where `doc_freq == 1.0` by construction and the `>= 0.9` STRONG bar is a tautology.
  **Oracle's O2 is not a corner case, it is the whole population ⇒ B5's WEAK-only ruling is
  mandatory.**

**B9 remediation census — DONE, live install is CLEAN.** 0 frozen-issuer near-matches, 0 split scope
keys, across 9 frozen identity rows and 10 human-attested known literals. Chris's poison was confined
to the session-mortal sandbox. **No live remediation is owed.**

**B3 corpus gate — no regression PROVEN, efficacy NOT proven. State it that way.**
OFF vs ARMED over **1076 documents**, `RR_APP_ENV=1` + `OCR_RENDER_DPI=200`. Reports
**byte-identical**, zero collateral. But **zero re-derivations fired**, because nothing healed a
supplier name anywhere: `Auto-corrected to match learned data` 0, `Suggested name correction` 0,
`Letterhead may read` 0, in BOTH arms. **The arm is vacuous as an efficacy test.** Why, verified:
Stage 4.5's repair needs a `name_lexicon` and B1 proved 33/36 scopes never get one — **B3's trigger
is disabled by B1's defect.** So B3 is a PRECONDITION, not a fix that pays today: the moment the
lexicon slice arms without it, the panel says "auto-corrected" while the file lands in the wrong
folder — worse than today, because the failure would wear a note claiming it was fixed.

**NOT verified / owed:**
- **No UI smoke of any of this.** `98d4fbb` and the teach surfaces need the Review window reopened.
- 5 `database/modules` suites fail — **VERIFIED pre-existing** by stashing the changes and re-running
  at HEAD (schema drift: `candidates`, `logo_detail_hash`; plus `test_authoritative_anchor`). My
  FIRST attempt at that check silently no-op'd because git's toplevel is `C:\GIT Projects` and the
  paths double-prefixed — the result was meaningless and was redone. **Watch for this.**
- Baseline corpus findings, identical in both arms and NOT caused by these changes: 6 documents would
  auto-file a wrong value. **Five are ref-lane rows where the STORED CONFIRMED VALUE is the garble** —
  the serif `I→1` class (`'P1/26/6000'` vs the correct `'PI/26/6000'`) and deleted printed slashes
  (`'PI263130'` vs `'PI/26/3130'`). **#464 `quote`, wrong on `total`, is NOT in that class and has not
  been examined.** Also unexamined: **#535 `'SB-ORD42102'` vs `'SP-ORD42102'`**, a genuine B/P
  confusable needing an eye on the page.

**Claims corrected mid-session — do not re-derive them wrongly:**
1. I told the owner "there is no census or dictionary in this product." **FALSE.** `wordness.py` +
   `data/char_trigrams.json` (~93KB) is built from dwyl/english-words (~370k) AND **US Census 2010
   surnames** (~162k). It is blind here for a NORMALISATION reason: `wordness._clean` keeps only
   `a-z`, so `B8ramblewood` is scored as `bramblewood`, a perfect word.
2. I told the owner a digit-in-token fix to the wordness predicate would make his rule classify the
   exhibit correctly. **FALSE, measured:** `name_quality` only falls to 2/3 = 0.667, every consumer
   gate is `<0.5` or `>=0.5`, so all 12 consumers are unmoved and three would REGRESS (`3M` rejected).
3. **Oracle's original B2 (a backend guard on the empty write) was WITHDRAWN** after I traced it:
   `getFieldFormats` computes `(corrected_value || display_value || '')` and `''` is falsy, so
   preserving the row leaves a DELIBERATELY deleted value feeding learning for ever.
4. **Oracle's B2c was REFUTED at source:** `clearAnchors` sits INSIDE `if (corrected_value)`
   (learning.js:331, closed :361), so an empty value never reaches it. No anchors were ever at risk.
   Pinned so it is not re-derived.

## FIRST ACTIONS (fresh session)
1. **Read `docs/designs/TEACH_POISONING_ARC_2026-08-13.md`** — Oracle's nine conditions and the
   ordering. Steps 1, 2, 3, 5 and 4a are done; **B8 and 4b are open.**
2. **B8 — the teach speaks** (no migration, highest customer value, Oracle bundled it with B4 because
   *"a hold without a surface is a silence"*): the read-back sentence the practice run already says
   (`Read "INV-1042" from your box.`, tutorial/renderer.js:214) and the real teach never has; the
   EMPTY-read case, which today produces nothing at all (un-nest from `if (text)` / `if (detected)`,
   review/renderer.js:3798/3843); the message onto `#anchor-readout` not a toast; the wizard's
   `.catch(_ok)` that maps FAILURE TO SUCCESS (teach/renderer.js:856) and its `advanceField()` race;
   confirm naming where the file went (`confirmCurrentDoc` already receives the filename and discards
   it); File All Ready's missing count + summary (it already computes both); and the sticky-LEVEL
   `showToast` guard — **do NOT build a toast queue**, the failure is two messages in the same tick.
3. **4b — hold the siblings** on a genuinely DIFFERENT identity replacement (owner decision 4). Needs
   a migration + a Python leg. Not started.
4. **Push, or decide not to** — 3 commits sit unpushed.

## DEFERRED (designed, not built) — with the load-bearing conditions
- **B5/B6/B7 — the lexicon slice. LAST, and WEAK-only for identity keys.** Census E (91.7%) makes the
  STRONG bar a tautology in almost every scope; keeping STRONG there needs a NEW evidence test signed
  on its own merits, never inherited from the 2026-07 signature. **Pin: `Southgate Motors Ltd` against
  a 3-doc `Northgate Motors Ltd` lexicon must NOT auto-apply.** B6: three-valued `word_like`, ABSTAIN
  never auto-corrects, and `!word_like` may **only veto, never license** — `Kwik-Fit` is not a
  residual, it is the class (Kwik/Xpress/Kleen/Bizzi, plus Welsh/Irish names, in a
  Northern-Ireland-based product). Prefer digit-inside-an-alphabetic-token as the narrow first arm.
  B7: a value carrying the auto-correct marker may never count as evidence for the repair —
  **unconditional, no flag**; `learning_exclude_machine_confirms` does NOT cover it, because Chris's
  20 poisoned documents were HUMAN-confirmed.
- **Layer 5 — buyer-issued identity.** The detection predicate ALREADY SHIPS and is proven:
  `engine.py:6460` `_buyer_issued`, guard `BUYER_ISSUED_ISSUER_GUARD` default ON, pinned. It drops the
  buyer's name from KEYWORD results only — it does not touch the `template_fixed` stamp, which is the
  route Chris's 40 documents came through. Slices 2+3 at `pendingfeatures.md:730-751`.
- **Layer 6 — repair.** `learning.renameSupplier` (admin + audited, Settings → Learning Recovery)
  already fixes six learning tables but does NOT touch `template_fields.fixed_value`, does not move
  files, and has no near-match detection to FIND the pair.
- **Layer 7 — the toggle register.** `PROVEN_ON_DEFAULTS` (database/index.js:66-119) already IS the
  register, annotated with what each flag bought plus a "NOT LISTED, and why" section. The work is an
  audit + promotion migration, not a new artefact.

## NEEDS THE USER
- **Three flip decisions from the NIGHT session are still open** (`recon_total_note_demote`,
  `name_corrob_note_demote`, `learning_exclude_machine_confirms`) **plus the three new ones**
  (`identity_scope_post_repair`, `teach_identity_near_match_keep`, and B8's when built). All OFF.
- **Push the 3 commits?**
- **Eyeball #535** (`'SB-ORD42102'` vs `'SP-ORD42102'`) and **#464** (`quote`, wrong `total`).
- UI smoke of `98d4fbb` once the Review window is reopened.

## KEY FACTS / PATHS
- Live DB `%APPDATA%\ScanFinder\docusnap.db`, **migration 63**, `ocr_dpi=200`. Never measured against
  while the app holds it; all census work this session opened it **read-only**.
- Corpus arms: `RR_APP_ENV=1` **and** `OCR_RENDER_DPI=200` — `_ocrDpiEnv` is NOT in
  `realdoc_regression.js`'s mirror list, so `RR_APP_ENV=1` alone still runs 300 DPI against an app
  that renders at 200. Without both, an armed arm's "nothing else moved" claim is **vacuous**.
- `realdoc_regression.js` writes a FIXED filename — copy the report between arms.
- **GOTCHA, new and expensive: do not edit `engine.py` (or any pipeline Python) while an arm runs** —
  workers import per shard, so the arm becomes a mix of old and new code. Cost me one full arm.
  Previously recorded only for `template_mapper.py`; it applies to the whole pipeline.
- **GOTCHA: git toplevel is `C:\GIT Projects`, not the repo dir.** `git stash push -- <path>` with a
  `Docusnap/`-prefixed path silently matches nothing and the stash is a no-op — a verification run
  after it proves nothing. Use paths relative to cwd.
- JS suites: `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe <file>`.
  Python suites: `PYTHONIOENCODING=utf-8 py -3.12 <file>` from `python_backend/`.
- New suites: `src/windows/review/test_issuer_clear_not_a_correction.js` ·
  `python_backend/tests/test_identity_scope_post_repair.py` ·
  `database/modules/test_identity_overwrite_guard.js`.
- Chris's round-4 sandbox is **GONE** (session-mortal); CDP 9223 is not listening. Nothing to clean up.
