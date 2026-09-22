# HANDOVER — 2026-08-13 NIGHT2 (the home-run arc: six phases built, Chris round 5 run)

**Branch `feat/teach-side-overnight` · HEAD `3327a22` · PUSHED (in sync with origin) · working tree
clean except a PRE-EXISTING uncommitted `CLAUDE.md` edit from the AFTERNOON session, which this
wrap replaces · no installer built · a SANDBOX APP IS STILL RUNNING on CDP 9223, PID 26060.**

Follows `HANDOVER_2026-08-13_AFTERNOON.md`. The owner asked for a single plan to "completely
integrate the features and fixes without touching currently working features in a negative
fashion", explicitly weighing the customer's experience and "as little clicks as possible after
teach". The plan was written, approved with four owner decisions, and executed end to end.

**Owner decisions taken at plan time (they shape everything below):** per-flag gated promotion of
proven defaults · taught-scope auto-file at 95 rather than dropping the visible slider · Chris's
UI-truth bugs included in the voice phase · push, and finish with Chris round 5 as the acceptance
test.

## TL;DR

Eleven commits, all pushed. Four migrations (64, 65, 66, 67). **Four new switches, all DEFAULT OFF;
one migration turns SEVEN previously-dark switches ON for new installs only.** Chris's round-5
verdict moved from *"the condition is back on"* (round 4) to *"yes — and the condition is lighter
than last round, but it hasn't come off"*, and what holds it is **not** the teach any more.

Closed, in his words: the teach speaks on every draw and refuses a bad box · the fields it clears
are named with a working Undo · the red not-taught dots are gone · the APPROVED stamp is off the
letterhead · Empty bin genuinely deletes the PDF · credit notes type correctly · the Restore-all
trap he reported twice is gone.

**He also found a defect in this session's own work, and a worse one that is nobody's yet** — see
"Chris round 5" below. NOTHING from his round has been implemented.

## COMMITTED (11, all pushed)

### `332bf68` — a missing `field_label_overrides` no longer makes migration 62 FATAL + un-red the safety net
Phase 0. Whole-suite baseline measured **468/484, 16 red** against 15 red on 2026-08-10 — so TWO
suites had gone red since and nobody knew.
- **Product fix:** `PRAGMA table_info` on a MISSING table returns `[]`, so migration 62's
  `.some(c => c.name === 'template_id')` was false and the rebuild ran `INSERT … FROM
  field_label_overrides` against a table that does not exist — **throwing inside `runJsMigrations`,
  which aborts `open()` and stops the app starting.** Migration 19 creates the table, so a
  normally-migrated install is fine; a DB stamped past 19 without it (restore, partial fixture)
  hit the fatal path. Now: create it in its FINAL shape when absent. Third appearance of the
  "a migration assumes schema an older DB lacks" class.
- **Pin repair, behaviour verified first:** `test_reprocess_autocommit.js` asserted the five machine
  sentinels as an INLINE literal in trust.js; the machine-feed slice deliberately replaced that with
  the shared `machine_vias` module — so the pin went red against a change that made the guard
  stronger. Verified at `trust.js:595`, rewrote the pin to assert the shared source, **RED-PROVED**
  against a mutated copy.
- Three fixture-drift suites repaired (`logo_detail_hash`/`candidates` columns). **Red count is now
  11 — exactly the documented genuine-assertion set at `pendingfeatures.md:1632`.**

### `76e28b2` — #464 and #535 examined (docs only)
Both were listed as unexamined in the AFTERNOON handover. Rendered both pages and traced #464
through the real pipeline at the app's env + `OCR_RENDER_DPI=200`. **On BOTH, the stored confirmed
value is CORRECT and the pipeline read is wrong** — the opposite of the other five baseline rows.
- **#535** prints `SB-ORD42102`, pipeline reads `SP-ORD42102` (B→P, the serif-confusable family).
  **Flagged**, so contained.
- **#464** prints `Total (inc VAT) £2,363.76`, pipeline commits **`2,368.76`** at 90 with an empty
  note ⇒ **would auto-file**. The trace shows the arithmetic ALREADY computed the right answer:
  `1969.80 + 393.96 = 2363.76`, delta 5, **tolerance 47.38 (2% of the total)** ⇒ "reconciles: true".
  A penny-exact identity blurred by a percentage tolerance. Recorded at the TOP of
  `pendingfeatures.md` with the fix direction (flag + hold, never silently adopt).

### `7dfb580` — the teach speaks on every path + the near-match challenge
Phase 1a/1b, ships ON.
- Read-back on both teach surfaces, **including the EMPTY read and the THROWN read, which produced
  nothing at all** (everything was nested inside `if (text)`), and the anchor-less read.
- Message on the persistent `#anchor-readout` bar, not a toast (a toast cannot carry a button and is
  destroyed by the next call).
- `showToast` gained a sticky **LEVEL** guard — an `ok` may not overwrite a live `warn`/`err`.
  **Deliberately NOT a queue** (Oracle: a queue shows the warning seconds late and would serialise
  ~63 call sites).
- Wizard: `.catch(_ok)` mapped FAILURE TO SUCCESS and fired concurrently with `advanceField()`; the
  verdict now arrives while the confirm panel is still on screen.
- New `learning.findNearMatchIdentity` + `check-identity-near-match` IPC, using the SAME
  `name_proximity` module as the write guard. **Substrate is human confirms only** (machine vias
  excluded, ≥3 confirms) and "Keep what I read" always stays — a different company must remain
  teachable.
- Gate: new `src/windows/review/test_teach_speaks.js`, 33 checks, all ten speaking pins RED-PROVED.

### `7db3f21` — confirm names the destination, File All Ready counts + summarises, the clear speaks
Phase 1c/1d, ships ON. `confirmCurrentDoc` already RECEIVED the filed name and path and threw them
away. File All Ready's dialog gained a count computed with **the loop's own skip rule**, and a
persistent end-of-run summary naming the senders. The issuer clear now names each field it emptied
and offers an undo that also releases the render suppression; it APPENDS to the bar so the read-back
that caused it is not erased. B2d's pin was UPDATED, not dropped: surface moved, intent kept.
Gate: `test_teach_speaks.js` 33 → 45; all eleven new pins RED-PROVED.

### `6ba880e` — Empty bin really deletes the filed PDF, and stops deleting the customer's own scan
Phase 1e. **Two independent defects, both red-proved against the old code.**
`_purgeOne` unlinked `documents.resolveFilePath(doc)` + `doc.working_path`; `resolveFilePath`
returns `working_path` FIRST, so on a previously-filed doc BOTH entries resolved to the same working
copy and **`stored_path` was never unlinked**. And its `stored_path` branch requires
`status === 'confirmed'` while a binned doc is `'deleted'` — so with no working copy it fell through
to `folder_path + original_filename`, **the customer's own SOURCE SCAN**. Target set is now explicit
and app-owned only. Also: both bin-wide buttons counted RENDERED ROWS (`if (!n) return` = the silent
no-op over 179 documents); they now ask the database at action time. Stamp default corner moved to
bottom-right. The not-taught dot is no longer error-red.
Gate: new `src/modules/review/test_purge_and_bin_truth.js`, 20 checks, behavioural against real
files on disk.

### `097a5fb` — identity-writer provenance + hold the siblings
Phase 2. **The enumeration is better than the design assumed:** `create()`, `update()` and
`mergeInto()`'s fold all funnel through the ONE `_upsertFields`, which is why `dc4bf1d`'s single
guard covers the family; graduation only ever CREATEs. Pinned INCLUDING the call-site count.
`setFieldFixedValue` stays ungoverned **on purpose** — it is the only route by which a wrong frozen
identity can be corrected — and that exemption is now pinned with its reason.
- **Migration 64**: `template_fields.fixed_source` + `fixed_set_at`, stamped only when the value
  actually changes (null-safe `IS NOT`). Record-only.
- **Migration 65 + `template_identity_hold_siblings` (OFF)**: a genuinely different identity commits
  (pinned invariant) but the layout's other documents get **70 WITH A NOTE** instead of 95 until a
  second document agrees. **The note is the hold, not the confidence** — the review threshold is
  `< 70`, so a bare 70 would still auto-file (the slice-3 B2 lesson, applied). Released by
  agreement: `noteIdentitySupported` runs on every confirm; the teach itself never counts.
Gates: `test_identity_writers.js` (19) + `test_identity_hold_siblings.js` (17), both against a real
DB **built by the real migrations**.

### `c353518` — buyer-issued slice 2 SHIPPED, slice 3 REFUSED by its own census
Phase 3. **Migration 66 + `template_buyer_issued_type_scope` (OFF).** The mark is the JS twin of
`engine._buyer_issued`'s ref-role arm (deliberately the smaller of its two arms — the other is a page
signal JS never sees at confirm time), written on BOTH template paths so an existing template earns
it at its next confirm. The refusal is four conjuncts in the TEXT arm only; the logo arm is untouched.
**SLICE 3 IS REFUSED, and the refusal is the deliverable.** Its own design named the gate. Measured
over 6514 corroboration records:
```
field            stamped  agreed  contradicted
supplier_name       1038    1037           192
vat_no               120     120             0     <- the field the rail was FOR
```
Inert where aimed (and `_PRECISE_VAL_TYPES` is `{mac_address, ip_address}`, so VAT was never in
scope), and noisy where it would fire — the 121 page-family contradictions are `keyword="DELIVER TO"`
and `crop="Jordwind Refrigeration Ltd"`, i.e. caption fragments and garbles OF THE STAMPED NAME. It
would hold ~121 correct documents and catch nothing. Recorded with a revival condition.

### `ca90294` — migration 67: a new customer gets the measured configuration
Phase 4. **Census F first**, on a snapshot of the live install, 1076 confirmed documents through the
real `isAutoFileEligible`:
```
shipped fresh-install defaults   919/1076  85.4%   (graduated 564, threshold 355)
+ corroboration_autofile         919/1076  85.4%   (UNCHANGED)
+ graduation_window = 5          999/1076  92.8%   (graduated 644)
```
Promoted as settings ROWS with `INSERT OR IGNORE`: the import-arc five + `graduation_window=5` +
`corroboration_autofile`. **The last is promoted WITHOUT a number and the annotation says so** — its
arm needs a scope clean-but-short-of-volume and this install has graduated nearly everything, so its
population is a YOUNG install, which is exactly why this install cannot measure it.
**What Census F cannot see, stated in the code:** it scores a MATURE install, and confirmed rows have
had `validation_note` cleared, so it cannot model the import-time refusal that actually holds a new
customer's documents. That number is the already-measured 70/200 → ~184/200 import arc.
Gate: `database/test_default_promotion.js` (25), including an upgrade of a simulated install with two
switches hand-disabled — they stay disabled.

### `02918b4` — duplicate senders found, and the rename can finally finish
Phase 5. `learning.findDuplicateSupplierPairs` + a report-only "Senders that look like duplicates"
block in Learning Repair; picking a pair PREFILLS the audited rename. Against the live install: 11
sender scopes, **0 pairs** (matches B9).
**Its own pin made it stricter than the write guard.** First run reported `Northgate Motors Ltd` vs
`Southgate Motors Ltd` — d=2, similarity 0.889, which PASSES `name_proximity`. Correct at the guard's
seam (a declined overwrite); wrong here, where the screen says "look like duplicates" and offers a
merge. Now: one edit, or two ONLY with a **digit inside an alphabetic token** (Oracle O5's narrow
arm; immune to `Kwik-Fit`/Welsh names; `3M`-style leading digits excluded). Named cost: a
two-character garble with no digit is not reported.
`renameSupplier` now also moves `template_fields.fixed_value` — **the gap that made a rename quietly
undo itself on the next import**. Files on disk are still not moved, and the screen says so.
Gate: `test_duplicate_supplier_repair.js` (21).

### `1f2b386` — the lexicon slice, WEAK-only
Phase 6. **The four-line root cause:** `format_anomaly_checker`'s `if len(samples) < 3: continue`
sits on the DISTINCT set while `learning.js` emits on `_values.size >= 3` **OR** `_count >= 3` — so
Python discarded exactly the groups JS went out of its way to send, and a scope with 38 confirms of
one literal got NO lexicon. Census E: 33 of 36 name scopes are in that population.
`name_lexicon_low_distinct` (OFF) admits such a group as a **name lexicon and nothing else** (no
shape, separator, charset or support boost) and only with ≥3 confirms. Entries carry `low_distinct`
and **the engine refuses the STRONG tier for them** — the suite DEMONSTRATES why: against a 3-doc
`Northgate` lexicon, `Southgate` IS rewritten and reports itself STRONG.
**B7 is unconditional:** the STRONG branch stamps `<method>+name_repair` and `getFieldFormats`
excludes it. The METHOD is the carrier because it survives confirm — `validation_note` and
`corrected_to` are both cleared there — and it is written on the `method` key, since the JS persists
`data.method`. **B6 is answered by construction** (weak-only ⇒ no AUTO tier for a `word_like` verdict
to license) and that is stated rather than a second predicate built for show.
Gate: new `python_backend/tests/test_name_lexicon_low_distinct.py` (21).

### `3327a22` — Chris round 5 (docs only)
See below.

## CHRIS ROUND 5 — the acceptance test

Full report verbatim in `docs/CHRIS_FULL_APP_REVIEW_2026-08-13.md` (round-5 section appended after
round 4). **Two conditions recorded that no previous round could state:**
1. **The graft drew the SAME template as round 4** (template 1 = `Bramblewood Joinery Ltd` /
   `purchase_order`, `supplier_name` AND `vat_no` frozen). Round 4's headline numbers were an
   artefact of which single layout the seeder took, and nobody had recorded it. **So his `188 need
   review / 12 ready` repeating EXACTLY is a stable measurement, not seeding noise.**
2. **Migration 67 fired on the fresh install and seeded all seven keys** — first live proof of the
   promotion, and why his credit-note finding closed by itself.

**His seven new cards, with what I verified at source:**
- **Card 1 (his worst, NOT one of ours): a restored document with no page.** Verified: doc #40 has
  `working_path` → `userData\inbox\40.pdf`, the row is back in the queue, **the file is gone while
  156 others remain**, and `Confirm & File` stays enabled. The legitimate path (confirm) unlinks AND
  clears the pointer in one step, so a row can never point at a missing file. `sweepInboxOrphans`
  ruled out (keeps every path `getWorkingPaths` returns, no status filter); `_purgeOne` ruled out
  (it deletes the row). **ROOT CAUSE NOT ESTABLISHED.**
- **Card 3: the near-match challenge did not fire — and the cause is THIS session's substrate.**
  `findNearMatchIdentity` reads human-confirmed `documents.supplier_name` (min 3); a FRESH install
  has none, so the correct spelling lived only in the template's frozen identity. **The arc's design
  says Tier B (`template_fields.fixed_value`) may "trigger ASK" — an ASK is exactly this surface, and
  it was not wired.** Confirmed in his DB: `no-near-match`, 0 confirmed docs under the correct name,
  frozen identity already overwritten (the write guard ships OFF, so the two halves must ship
  together).
- **Card 2: File All Ready offered 40, filed 0, said nothing.** The count is honest ("up to"), but
  the loop rejects a SECOND time on `confirmBtn.disabled`, and the summary is inside `if (filed)` —
  so the one run that most needs an explanation says nothing.
- **Card 5: "Off by default" beside switches migration 67 turned on.** Rows right, prose not updated.
- **Card 7: the read-back bar covers the toolbar** and is not cleared on the next draw.
- Cards 4 and 6 are genuinely new: bulk repair after a bad teach (one action broke 39 records, the
  way back is 39 actions), and the `.metadata` XML surviving an Empty bin that deleted its PDF.
- **Round 4's card 1 (40 documents under his own company) reproduced IDENTICALLY** — expected: the
  fix is `template_buyer_issued_type_scope`, which ships OFF, and the grafted row carries
  `buyer_issued = 0` because that mark is written at confirm time.

**His own disclosed errors** (do not chase them as defects): a sweeping click of his deleted 60
documents with his handler auto-accepting all 60 prompts; a suspected 40px box offset was his
measurement error; he re-imported 20 documents mid-run, so queue counts after that point are
inflated by 20.

## VERIFICATION STATE — read this before trusting any of it

- **Whole-suite baseline: 468/484, 11 red after the Phase-0 repairs** (was 16). The 11 are the
  documented genuine-assertion set. Baseline JSON in the session scratchpad (session-mortal);
  re-run `stress_test/run_all_suites.py` to regenerate.
- **NO CORPUS ARM WAS RUN THIS SESSION.** Every extraction-touching change ships behind a flag that
  is DEFAULT OFF, and OFF is byte-identical *by construction* (an added guard clause ahead of the
  existing branch) — **but expectation is not measurement.** The OFF arm and an ARMED arm are OWED
  before ANY of the four new flags is flipped: `RR_APP_ENV=1` **and** `OCR_RENDER_DPI=200`.
- **NO UI SMOKE BY THE OWNER.** Everything in Phase 1 ships ON and has only been exercised by Chris's
  driver.
- **`teach_identity_near_match_keep` still owes its sandbox replay** of the round-4 teach.
- **`template_buyer_issued_type_scope` cannot be armed-tested on this corpus** — no document exhibits
  the class; a flat lane there proves nothing.
- **`name_lexicon_low_distinct` has an ORDERED dependency:** `identity_scope_post_repair` must be
  armed FIRST, or a repair heals the extraction row while `documents.supplier_name` (the folder and
  the scope key) keeps the unrepaired string — the panel would say "auto-corrected" while the file
  lands in the wrong folder.

## FIRST ACTIONS (fresh session)

1. **Reproduce Chris's card 1** — import, delete, close the app, reopen, Restore all. Find what
   removes a working copy WITHOUT clearing `working_path`. Two guards are worth it regardless of
   cause: say when a restored page is missing, and do not offer `Confirm & File` on a document with
   no page.
2. **Wire the near-match challenge to frozen template identities as an ASK-only source** (Tier B, per
   the design), and ship it WITH `teach_identity_near_match_keep` armed — the two halves are one fix.
3. **File All Ready:** report `Filed 0 of 40` with the dominant reason, and never gate the summary on
   a non-zero count.
4. **The "Off by default" copy** on the seven switches migration 67 turns on.
5. Then the corpus arms, in flag order, before any flip.

## DEFERRED (designed/measured, NOT built) — with the load-bearing conditions

- **#464, the arithmetic rail** (`pendingfeatures.md`, top). `subtotal + tax` computes the printed
  total to the penny while a 2%-of-total tolerance releases a digit substitution. v1 must **flag +
  hold**, never adopt — `subtotal`/`tax` can themselves be misread, and a derived money read has no
  guard but geometry.
- **Buyer-issued slice 3** — REFUSED with a census and a revival condition. Do not rebuild it from
  the design without re-running `census_stamp_contradiction.js` on an install that HAS a
  buyer-issued template claiming foreign documents.
- **Bulk repair after a bad teach** (Chris card 4) and the **`.metadata` XML surviving Empty bin**
  (card 6) — both new, neither triaged beyond his report.

## NEEDS THE USER

- **Flip decisions.** Four new flags OFF (`template_identity_hold_siblings`,
  `template_buyer_issued_type_scope`, `name_lexicon_low_distinct`, plus the AFTERNOON session's three)
  — all awaiting arms. Migration 67 changed FRESH-INSTALL defaults only; the live DB's own choices
  are untouched.
- **The live DB will run migrations 64–67 on next app start.** Additive columns only, and 67 is
  `INSERT OR IGNORE`, so hand-set flags are preserved.
- **UI smoke:** one ⊕ draw (bar speaks), one confirm (names the folder), File All Ready, the bin.
- **Vet queue from Chris round 5**, ranked in FIRST ACTIONS above.

## KEY FACTS / PATHS

- Live DB `%APPDATA%\ScanFinder\docusnap.db`. **Migration 67** after the next start (was 63).
- **A SANDBOX APP IS RUNNING: CDP 9223, PID 26060**, sandbox root in the session scratchpad
  (`…\scratchpad\chris-sandbox\`, session-mortal). 218 documents queued, 39 carrying his
  misspelling, screenshots in `_r5_screens\`. The next `/christest` kills and rebuilds it.
- JS suites: `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe <file>`.
  Python: `PYTHONIOENCODING=utf-8 py -3.12 <file>` from `python_backend/`.
- New suites: `src/windows/review/test_teach_speaks.js` ·
  `src/modules/review/test_purge_and_bin_truth.js` · `database/modules/test_identity_writers.js` ·
  `database/modules/test_identity_hold_siblings.js` · `database/modules/test_buyer_issued_scope.js` ·
  `database/test_default_promotion.js` · `database/modules/test_duplicate_supplier_repair.js` ·
  `python_backend/tests/test_name_lexicon_low_distinct.py`.
- **GOTCHA (cost time twice this session): a JS template literal ends at a backtick — an SQL comment
  containing `` `identifiers` `` inside `db.prepare(\`…\`)` breaks the file.**
- **GOTCHA: `before()` returns undefined**, so `x?.before(n) || host.append(n)` ALWAYS also appends.
- **GOTCHA: a fixture built by hand drifts.** Build test DBs with `runMigrations` — three suites went
  red on 08-11 for exactly this, and two more nearly did here.
- **GOTCHA: `from extraction import X` after `del sys.modules[...]` returns the STALE package
  attribute** — use `importlib.reload` or an env-flag arm silently measures nothing.
