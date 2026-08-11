# HANDOVER — 2026-08-11 DAY (owner present)

**Branch** `feat/teach-side-overnight` · **HEAD `75d29ce`** · ALL PUSHED, tree clean.
**Migration 61** (was 60 — this session added one; see below).
**Installer:** NOT rebuilt. The last one still predates everything from 08-10 DAY onwards.
**Uncommitted batch:** none. Six commits, all pushed.
**Context:** continues `HANDOVER_2026-08-11_NIGHT.md` (the autonomous overnight run). The owner woke,
read the night's output, and directed the day: kill the orphaned Electron processes, restart the app,
then work Chris's findings.

---

## TL;DR

1. **Chris's finding 2 is FIXED and ON** — a teach that reads gibberish now says so instead of
   showing a green success toast (`810ea8f`). Not smoke-tested.
2. **The owner's own two findings are FIXED and OFF** — a confirmed teach label now becomes the
   keyword for that field, replacing the generic bank (`48bcc48`, migration 61).
3. **The corpus arm for (2) went red, then clean** — and the red was a bad TEACH, not the feature.
4. **I refused to write to the live DB** while the app held it. The flip did not happen; the arm
   later said it would have been wrong anyway.
5. **MIGRATION IS NOW 61.** Every CLAUDE.md/handover line saying 60 is stale from this point.

---

## Committed

### 1. `810ea8f` — a taught issuer read that is not a company name now says so (DEFAULT ON)
**Chris round 2, finding 2.** A ⊕ teach read `@a eens Ee`, showed *"Captured the Document Issuer
position from this layout"*, flagged nothing, and the value became two output folders differing only
by a leading `@`. His diagnosis is the durable part: **every guard in this product is pointed at
ABSENCE, none at CONFIDENT NONSENSE** — the app warns plainly on an EMPTY issuer and said nothing on
a gibberish one.

Both teach surfaces now check before congratulating: Review's ⊕ read-back and the wizard's
`finishIssuerField`. **Warning only** — the teach still stages, nothing is blocked or rewritten.

**THE OBVIOUS IMPLEMENTATION WAS MEASURED AND REJECTED.** `isPlausibleSupplierName` already existed
and looked like the answer; it rejects **BP** and **IBM** on a ≤3-char all-caps rule written for
extraction-time caption filtering, so it would nag a customer whose supplier really is BP, on a
correct value. The shipped predicate is narrower: no letters at all, or leading punctuation, or —
multi-token with one-letter initials dropped first — `nameQuality < 0.5`. Single-token values are
never judged, which is what makes BP/IBM/3M/H&M structurally immune.

**Measured: 0 false positives over 22 real company names** (incl. P&O Ferries, W H Smith,
J S Bloggs, E.ON UK plc and all seven corpus suppliers); catches 10 of 11 junk reads from the round.
**Known miss, pinned not tuned away:** `RENN ERNE, Nh` scores 0.67 and passes; tightening the floor
costs `J S Bloggs`.

**Files:** `database/modules/learning.js` (`issuerReadLooksImplausible`) · `src/modules/review/handler.js`
(IPC `check-issuer-read`) · `src/preload.js` · `src/windows/review/renderer.js` ·
`src/windows/teach/renderer.js` (`toast` gained an optional duration — 1600ms is right for a
confirmation and far too short for a warning) · `database/modules/test_issuer_plausibility.js` (new).
**Kill:** setting `teach_issuer_plausibility_warn` = `'false'`. **DEFAULT ON**, matching its sibling
`teach_typed_value_locate`, which likewise has no Settings toggle.

### 2. `10f0d01` — the owner's two findings, filed after verifying both at source
Both the same shape: **the app already knows the answer and does not consult it.**
- **The disambiguation picker never checks confirmed history.** `engine._build_candidate_emit` sorts
  chosen-first → confidence → alphabetical. Nothing consults `supplier_hints`, `corrections`,
  confirmed extractions or `accepted_name_values`. So on his screen a one-glyph misread
  (`Bramblewood Joinery Ltc`, chosen, 70%, flagged) was offered FIRST and his own company name,
  confirmed hundreds of times, sat second and unmarked. `Ltc`/`Ltd` differ by one glyph and both are
  well-formed, so no shape gate can separate them — the only discriminator is prior confirmation.
  **NOT BUILT.**
- **A confirmed teach label never became the keyword** — built, see (3).

### 3. `48bcc48` + `e49a42d` — a confirmed teach label REPLACES the generic keywords (DEFAULT OFF)
**Owner-reported:** *"some are picking up the correct template mapping eg po number but the keyword
for that field is looking elsewhere at 'ref'."* Correct. A teach persists `anchor_label` into
`field_anchors`, which drives **Stage 2**; Stage 1 keyword carried on with the shipped caption bank.
`field_label_overrides` (mig 19) was already read by `getForExtraction` and already threaded to
Python — **the only writers were the admin Settings screen and the preset seeder.** The missing piece
was a WRITE.

**REPLACE, not add, per the owner's decision — and that is the whole fix.** An override was ALREADY
consulted first, but `extract_fields` falls THROUGH to the shipped labels when it does not hit. On a
page printing both "Purchase Order No" and "Ref", that fall-through is how `Ref` kept winning.
Precedence is not exclusivity.

**Migration 61** adds `field_label_overrides.exclusive` (0/NULL-inert — existing rows and the admin
screen unchanged). `keyword.merge_label_overrides` clears the shipped bank for a claimed field, once
per FIELD not once per override (or a second taught label would silently drop the first).

**BOTH teach paths write it** — and the second was a gap in my first cut, caught by the arm: I hooked
`save-field-anchor` (the ⊕ Review teach) only, but **the wizard does not use that path at all**; it
writes a Stage 0.5 mapping. Live counts: **6** taught anchors with labels vs **38** mappings with
`anchor_text`. The owner's own case was template-mapped, so the first cut would have missed exactly
what he reported. `save-template-mapping` now writes it too.

`e49a42d` tightened the anchor-path gate from `label_detected !== false` to `=== true` (absence of a
negative vs presence of a positive). **MEASURED: it excludes 0 of 38 and does NOT fix the regression
below** — kept because it is correct for the phantom-label case, not because it earned anything here.

**Files:** `database/index.js` (mig 61) · `database/modules/label_overrides.js` ·
`python_backend/extraction/keyword.py` · `src/modules/processing/handler.js` ·
`src/modules/templates/handler.js` · pins `test_taught_label_keyword.js` (14) +
`test_taught_label_exclusive.py` (8). **Kill/arm:** `teach_label_becomes_keyword`, **DEFAULT OFF**.

### 4. `3febd56` + `75d29ce` — the corpus arms
**`labelkw`** (backfills the overrides those confirms would have written, then measures):
eight lanes byte-identical, **serials 0 ok/0 wrong/1 empty → 0 ok/1 WRONG/0 empty**, winning rung
`None×1` → `keyword_override×1`.
**`labelkw_fixed`** (repairs the bad serials teach first): **ALL NINE LANES BYTE-IDENTICAL to base**,
serials back to `0/0/1`, rung `None×1`. 36 overrides applied across eight lanes and moved nothing.

**So the regression was entirely the bad TEACH, not the feature.** And that teach is indefensible:
the most-committed `serials` value on this install is literally **`"Serial No:"` ×23** — the caption —
against real values shaped `NW-9931617`. The taught target box lands on the label. Repaired in the
arm by DELETION, not re-aiming: re-aiming means inventing coordinates for one document (forbidden by
the working rules), and a teach that commits its own caption 23 times is worse than no teach.

### 5. LIVE EXHIBIT (owner, SFDEV trace) — the benefit the corpus could not show

The owner sent the extraction trace for a Castellan service worksheet. It is worth reading twice,
because it is the first time this defect has been VISIBLE rather than inferred — and it is legible
only because of the caption feature shipped last night (`54ac065`), which prints the caption each
rung matched:

```
worksheet_number   CJB-2592   template_mapping
   mapping   CJB-2592  template_mapping   matched "JOB SHEET NO"   90%   won
   keyword   ...                          matched "Ref"            85%   lost
serials      Serial No:   template_fixed
```

**The keyword rung matched a bare `"Ref"` on a page whose caption is `JOB SHEET NO`.** Traced at
source: `_REF_ROLE_CAPTIONS = ["Reference No", "Reference", "Ref No", "Ref"]`
(`keyword.py:396`, applied at `:490`) is seeded onto EVERY ref-role field, and `worksheet_number`
is a custom field with **no shipped `field_patterns` entry at all** — so it inherits the generic
bank, bare `Ref` included. That is exactly the owner's original report, now with a citation.

**IT CHANGES THE FLAG'S EVIDENCE, and in both directions — read both.**
- The pair `service_worksheet / worksheet_number <- "JOB SHEET NO"` is already in the arm's backfill
  list, so `teach_label_becomes_keyword` armed WOULD replace that generic bank and the keyword rung
  would hunt `JOB SHEET NO` instead of `Ref`. The mechanism the flag fixes is real and live on the
  owner's own documents — **it is not hypothetical, which is what I could not establish from the
  corpus alone.**
- **But on THIS document it would change nothing**: the mapping already WON at 90 against the
  keyword's 85. The wrong keyword costs nothing while the mapping holds. The exposure is documents
  where the mapping FAILS — there the 85% `Ref` match is what commits, and the corpus lane that
  would show it (`po_ref`) has one document that already reads correctly.

So the honest position is now: **mechanism confirmed live, cost measured at zero, and the benefit
still unquantified** — better than "unmeasurable", short of "proven".

**Also visible in the same trace, confirming the arm from the other end:** `serials` reads
`Serial No:` via `template_fixed`. That is the broken teach the arm removed, sitting in the live
install, committing its own caption.

---

## Verification state — read before quoting any number

**What ran:** three corpus arms over the snapshot (`base`, `labelkw`, `labelkw_fixed`, ~5.5 min each,
185 documents); `test_issuer_plausibility.js`; `test_taught_label_keyword.js`;
`test_taught_label_exclusive.py` (shown RED against a disabled exclusive clause, then green);
`test_settings_wiring.js`, `test_validation_patterns_merge.js`, `test_debug_table.js`,
`test_freeze_guard.js`, `test_keyword_label_guard.py`, `test_vat_eu_formats.py`,
`test_code_separator_structure.py` — all green.

**What did NOT run:** no UI smoke of either new feature; no Oracle pass on either; no
`realdoc_regression.js`.

### Claims I made this session that were WRONG, corrected
- **"18 overrides backfilled" — the real figure is 38.** I counted visible output lines before the
  tool's own count line, which had been truncated.
- **My first `labelkw_fixed` arm was invalid.** `templates.getAll` returns **`field_mappings`**, not
  `mappings`; the filter removed 0 rows. Caught ONLY by the arm's own
  "*** nothing removed ***" guard — which is why that guard exists.
- **The second run was also invalid.** The backfill read the DB instead of the mutated state, so it
  put the dropped serials captions straight back and a "repaired" arm produced the unrepaired
  result. **A mutator arm must measure the state it mutated.** Both fixed and commented in place.
- **`test_label_overrides.py` fails 2** — verified identical to last night's recorded baseline
  signature, i.e. pre-existing, not caused by the `label_overrides.js` change.

### The live-DB write I refused
The owner asked me to flip `teach_label_becomes_keyword` on. **I did not.** The app was holding the
live DB with a ~4 MB `-wal`, and two attempts returned `no such table: settings` and then
`SQLITE_CANTOPEN` against a file that plainly exists. That is not a state to force a write into. The
arm subsequently showed the flip would have been wrong at that moment anyway.

---

## FIRST ACTIONS for the fresh session

1. **Decide the `teach_label_becomes_keyword` flip.** Zero measured cost on the corpus, and the
   MECHANISM is now confirmed live on the owner's own trace (section 5) rather than inferred — a
   custom ref-role field inheriting bare `"Ref"` from `_REF_ROLE_CAPTIONS`. The benefit is still
   unquantified because the corpus lane that would show it has one already-correct document. Two
   open questions before flipping: the doc-type-not-supplier scope (below), and the live serials
   teach (2).
2. **Fix the serials teach in the LIVE DB** (it is only repaired inside the arm). The taught box
   reads the caption; deleting the two mappings is the defensible repair.
3. **UI smoke, six items now** — the five from last night plus: teach a field with a gibberish box
   and check the new warning appears instead of the green toast.
4. **Chris's findings 1 and 3-8 are untouched** — #1 (buyer-issued identity leak) is the substantive
   one; #3 (Approve silently does nothing) is cheap and is a dead end in a shipped feature.

---

## Deferred — with the conditions that stop them being built wrong

- **The disambiguation picker should consult confirmed history** (owner finding 1). Rank a candidate
  that exactly matches a previously-confirmed value first, and LABEL it as such. Traps in
  `pendingfeatures.md`: `customer_name` learning was PURGED at migration 45 so `supplier_hints` may
  hold nothing for it (confirmed `extractions` are the better source); the picker is suggestion-only
  by design and must stay so; and frequency matters, not mere presence, or one past confirm of a
  garble promotes it.
- **The label→keyword SCOPE question.** `field_label_overrides` is keyed
  `(doc_type_slug, field_key)` with **no supplier column**, while `field_anchors` IS supplier-scoped.
  A caption taught on one supplier's statement becomes the keyword for EVERY supplier's statements.
  Usually right — a caption is a document-type convention — but wider than the teach performed, and
  the main reason the flag ships OFF.
- **The `I`→`1` raw witness** — Oracle-signed with 4 blocking conditions, fully specified, NOT built.
  See `HANDOVER_2026-08-11_NIGHT.md`. C1 is the one that makes it non-inert.
- **14 red test gates**, all pre-existing, triage order in `pendingfeatures.md`.

## Needs the USER

- **Five flags now await a decision:** `template_identity_on_page` (ON in any FRESH install, OFF in
  yours), `code_separator_structure_guard` (**flip WITH the `I`→`1` witness, not before**),
  `vat_eu_formats`, `teach_typed_value_locate` (default ON, never smoked),
  `teach_label_becomes_keyword` (new, OFF).
- **The live serials teach is still broken** — 23 documents carry the caption as the value.
- `deskew_on_import` is still `'true'` and still makes `teach_angle_compose_scan` unreachable.

## Key facts / paths

- **Live DB** `%APPDATA%\ScanFinder\docusnap.db` — **migration 61**. Do NOT write to it while the app
  runs; two attempts failed oddly today. Probe `mode=ro`, never `?immutable=1`.
- **Snapshot for all measurement:** `~/Desktop/TESTING/_measure/live_20260810.db`.
- **Arms:** `~/Desktop/TESTING/arms/{base,labelkw,labelkw_fixed}.json`. Run:
  `TEACH_DB=<snapshot> ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe
  stress_test/teach_run_ab.js base labelkw_fixed` (~5.5 min/arm). Score with
  `score_teach_run.py --json <arm>.json --label <name>`.
- **Whole-suite runner:** `py -3.12 stress_test/run_all_suites.py` → 457 files; baseline
  `~/Desktop/TESTING/_measure/suite_results_20260810.json`.
- **`ELECTRON_RUN_AS_NODE=1` is REQUIRED** for JS suites or the binary opens a GUI and hangs.
- **A git commit message containing backticks breaks the Bash heredoc** — write the message to a file
  and use `git commit -F`. Cost me two failed commits today.
- **Chris:** last night's round `docs/CHRIS_FULL_APP_REVIEW_2026-08-11.md`; sandbox at
  `~/Desktop/TESTING/_chris2` (not running); previous round preserved at `_chris/`.
- **Running at wrap:** the owner's app (5 Electron processes, started ~09:5x on the live DB).
