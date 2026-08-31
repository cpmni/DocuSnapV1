# HANDOVER — 2026-08-12 NIGHT2 (the import arc EXECUTED + the corroboration arc opened)

**Branch `feat/teach-side-overnight` · HEAD `fa1c0cb`, PUSHED, tree clean (13 commits this
session).** Owner present + driving throughout; every slice advisor→Oracle-gated, zero SEND BACKs
(gary ×3, eric, herald, reggie ×2, Oracle ×3 — all SIGN-OFF-W/COND, every condition applied).
Owner's app RUNNING at wrap (`npm start` background id biiwpmsx9). Migration still 63.

## TL;DR — the day's arc, in numbers
Yesterday the 200-doc corpus auto-filed **70/200 (35%)**. After tonight: **184-187 auto-filed
(~92%)** on the full re-import, residue = genuine flags. The three-gate disparity is DEAD, the
type-election defect is DEAD (live-proven on the owner's 5 Meadowvale docs), the VAT-reg poison
class is DEAD (3 garble variants), and the CORROBORATION arc (owner's step 3 — "notes that assert
doubt the record refutes") shipped its first slice and has two more queued with the boundary
framework Oracle-established.

## COMMITTED (all pushed; per-slice detail in docs/oracle_log.md 2026-08-12 NIGHT entries 1-3)
1. **`83dc89e` GATE-UNIFY** (gary+eric→Oracle W/COND): `autofile_gate_unify` — import pre-gate
   defers to `trust.isAutoFileEligible`; predicate gains `missing-required:<key>` (mirrors
   missing_required_labels incl. hidden-field+identity exclusions, both data paths); machine
   auto-files stamp `auto_graduated`/`auto_threshold` (trust.js:538 exclusions unconditional);
   sequential auto-file dispatch chain. `far_lowconf_valued_only` — isFlagged's below-threshold
   tier keys on the new `below_threshold_valued_count`; ALL FIVE consumers + getReviewSplit twin
   move together. Pins `test_import_autofile_gate.js` 33/33 (headline: empty vat_no@0 FILES).
   **BOTH FLIPPED BY OWNER, live-proven.** Cohort stamp APPLIED (165 via-NULL machine files →
   honest vias; backup `docusnap_pre_machinestamp_20260812.db`; ZERO revocations except
   Bramblewood/purchase_order — a real correction the inflated window buried, correct).
2. **`0c29ebe` TYPE-ELECTION TITLE-FIRST** (herald→Oracle W/COND): `type_election_title_first` →
   3 env flags (`TYPE_CAPTION_MENTION_ONLY` — `_ADDRESS_CAPTIONS` frozenset, PARTY captions only,
   boundary LOAD-BEARING; `TYPE_HEADING_ANY_SEGMENT` top-band; `TYPE_TIE_HEADING_PREF` strict
   strong-head key). Census 926 stored texts: heals exactly the 9-doc Meadowvale class, 0
   collateral. Pins `tests/test_type_election.py` 19/19. **FLIPPED, live-proven** (owner: "yes
   they changed to credit note" on plain reprocess — machine-authority re-type).
3. **`6876296`+`58c0258`+`cca7935` VAT-REG GUARD, three live variants** (reggie-vetted, his
   blocking two-pass condition applied): speckle walk (`GB 774 20! 2093 55`) · cc-floor 8
   (`GB 774 206 55`, uppercase-cc + ≥2 groups, leg `cc_floor`) · doubled cc (`GB GB …`,
   identical-only backreference). Pins in `test_vat_reg_not_amount.py`, all green. PLUS
   **`REPROCESS_SHADOW_STALE_DROP` BUILT** (designed 08-07; the merge carried stale poison
   shadow rows past the fixed guard) — `reprocess_shadow_stale_drop` toggle, **FLIPPED, live-
   proven** (Pelican #1064 healed end-to-end: stale row dropped, real VAT read, reconciled,
   predicate eligible).
4. **`bd3e27b`+`775ad2c` XCHECK_CORROB_NOTE_DEMOTE** (corroboration STEP 3 slice 1; gary→Oracle
   W/COND B1-B3+C1-C5): a crosscheck disagreement note on a DATE releases when a crop-side
   ledger witness corroborates the committed value. gary's key fact: corroboration-clears-notes
   ALREADY SHIPS (E2 `CROSSCHECK_KEYWORD_CLEAR`, default ON) — this extends its licence from the
   instantaneous incumbent to the candidate ledger. B1 recompute overall/_needs_review at demote;
   B2 DATES ONLY (refs/names wait — recipe-ladder common-mode, I→1); B3 ledger gains `noted` bit,
   witness un-noted+conf≥80 (+located for the anchor crop family — `775ad2c` fixed my own bug:
   template_mapper never sets `located`, mapping family is located BY CONSTRUCTION; the slice was
   inert on its founding exhibit until then). Standing rule ruled SCOPED (E2 predates it). Pins
   `tests/test_xcheck_corrob_demote.py` 26/26. Toggle `xcheck_corrob_note_demote` — **owner
   flipped; NOT yet re-verified live after `775ad2c`** (needs a Nordwind reprocess to confirm the
   date notes now release — FIRST ACTION).
5. **`c28013e`+`bcb1f22` Review UX**: SFDEV unlock dialog gets the full focus-repair pattern
   (rAF + markFocusSuspect + ensureWindowFocus + repair — was same-tick focus, dropped);
   trace console consumes `step` events (every stage shows value-or-reason — "no keyword pattern
   matched this field") and opens TOP-LEFT.
6. **`6259a06`+`295ff90` NAME-LEXICON POISON REMEDIATION** (the confusable-snap ask, gary:
   WRONG LAYER as filed — the 4.5 STRONG repair already owns the class; `_is_confusion` has NO
   letter↔letter arm so the filed snap predicate matched none of the exhibits). Root = confirmed
   garble diluting the lexicon (Quillstone customer doc_freq 0.888 < 0.9 STRONG bar): 8 chris
   test-era confirms + 7 MACHINE auto-file confirms + 1 typo'd human correction (corrections.
   corrected_value OVERRIDES display in getFieldFormats — the second leg). Script
   `scripts/repair-poison-name-confirms-20260812.js` **APPLIED live** (owner 'go'; backup
   `docusnap_pre_namerepair_20260812.db`): Quillstone 85/89 = 0.955 STRONG · Castellan 100/100
   single-key → CONFADOPT licence restored. Display-value only, NO corrections rows
   (deliberate — 15 of them would revoke graduation on three scopes).

## Verification state — honest
- All pin suites green at HEAD (gate-unify 33 · type-election 19 · vat-reg incl. cc/doubled ·
  merge battery §8 · demote 26 · wiring). `test_anchor_crop_crosscheck.py` 3 fails PRE-EXISTING
  (stash-verified both sides). `test_kw_type_ambiguity` needs `PYTHONIOENCODING=utf-8` (console
  codepage only).
- **NO full realdoc arm ran tonight** — the slices are flag-gated with decision-layer A/Bs +
  censuses instead (74/74 predicate A/B; 926-text election census; live import = the acceptance
  run). The demote slice's realdoc M=0 + demote census (flip bar: demoted-and-wrong = 0) are
  FORMALLY OWED — the flag is already ON at the owner's hand, so run the census early.
- Corrected mid-session claims: Oracle's ~163 acceptance number assumed `trust_shadow_row_skip`
  OFF (it was ON); my demote slice shipped inert (located bit) and was fixed same session;
  my first VAT walk could UN-FIRE the shipped guard (reggie blocking, fixed).

## FIRST ACTIONS (fresh session)
1. **Verify the date-note demote live**: owner reprocesses the remaining Nordwind quotes → the
   crosscheck date notes should release (`+corrob_clear`, note gone). If not, trace
   `xcheck_note_demote` events. Then run the demote census (`XCHECK_DEMOTE_CENSUS_DIR`) over a
   corpus arm + live replay — flip bar demoted-and-wrong=0 (formally owed, flag already ON).
2. **Build note-demote SLICE 2 (adjusted-total, money)** — pendingfeatures top; build under the
   oracle_log entry-3 boundary; own gary+Oracle pass (money floors differ from dates).
3. **SLICE 3 (names)** — exhibit filed (guard-rejected dissenters = stronger evidence); Oracle
   deliberately held names back; own pass.
4. **Machine-files-feed-learning arc** (pendingfeatures) — getFieldFormats value_counts don't
   filter machine confirms; the Quillstone poison came partly from auto-files. gary census first.
5. Queue leftovers: Pelican #1067 (honest two-defect doc), Bramblewood 4 wrong-party-customer
   rows on old confirmed POs (data, needs owner ruling).

## Needs the USER
- Nordwind reprocess (action 1) + eyeball the released notes.
- The 4 `Bramblewood Joinery Ltd` customer rows on confirmed Quillstone POs (wrong-party reads,
  now the only non-Quillstone keys in that bucket) — Learning Repair or leave.
- UI smoke of the five new toggles' copy (all live-used tonight except the demote's post-fix run).

## Key facts / paths
Live DB `%APPDATA%\ScanFinder\docusnap.db` (mig 63) · backups tonight (beside live DB):
`docusnap_pre_machinestamp_20260812.db` · `docusnap_pre_namerepair_20260812.db` (+ the earlier
`docusnap_pre_sweepstamp_20260812.db`) · snapshots in `%TEMP%\snap_*.db` (disposable) ·
new instruments: `stress_test/census_parked_eligible.js` (parked-eligible, takes a snapshot path) ·
`stress_test/type_election_census.py <snapshot>` (5-arm election replay) · census env dirs:
`XCHECK_DEMOTE_CENSUS_DIR`, `NAMESNAP_CENSUS_DIR` (unbuilt), `CONFADOPT_CENSUS_DIR` ·
new toggles (Settings→Processing, ALL OWNER-FLIPPED ON tonight): `autofile_gate_unify`,
`far_lowconf_valued_only`, `reprocess_shadow_stale_drop`, `type_election_title_first`,
`xcheck_corrob_note_demote` · remediation scripts (repo, census→backup→APPLY pattern):
`stamp-machine-autofiles-20260812.js` (RUN) · `repair-poison-name-confirms-20260812.js` (RUN) ·
GOTCHAS: python tests need `PYTHONIOENCODING=utf-8` on this console; the auto-mode classifier
blocks ad-hoc live-DB writes — use the repo-script census→backup→APPLY pattern; better-sqlite3
from temp scripts needs the absolute repo require path.
