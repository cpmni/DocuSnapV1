# NIGHT RUN — the overnight test/check queue and its ledger

> **Owner convention (2026-08-30):** anything Claude thinks is worth TESTING or CHECKING goes into this file's QUEUE as
> it is noticed. When the owner says "going to bed", the newest `docs/designs/NIGHT_RUN_*.md` prompt runs. **Every
> night, when the run finishes, the session moves what it did into the DONE ledger with the result and a
> "repeat only if" condition — so no night repeats work unless it is needed.** Before planning a night, read the
> DONE ledger first. Keep entries one to three lines; detail lives in the linked report/handover.

## TONIGHT — ✅ DONE 2026-09-01 NIGHT (see the DONE ledger): #1 + #2 combined + a full SECURITY AUDIT
**Owner order:** combine the two suggested night jobs — (#1) the Quick Reprocess INTEGRATION GATE on a
self-built warm sandbox DB, and (#2) a Chris sandboxed round on the newest surfaces — then do a full
security audit (licensing + overall + raw-OCR-at-rest + a known-flaw sweep for Electron/Node.js/JS,
addressing anything found before full release). Full prompt: **`docs/designs/NIGHT_RUN_2026-09-01_NIGHT.md`**.
Advisors consulted tonight: gary (gate design + raw-OCR-at-rest), eric (Electron attack surface), a
security researcher (dependency/CVE sweep), Oracle (blast-radius adjudication). Deliverables: `docs/
SECURITY_REVIEW_2026-09-01.md`, the gate report, `docs/CHRIS_FULL_APP_REVIEW_<date>.md`, `HANDOVER_2026-09-02.md`.

(The prior TONIGHT arc — CORROBORATED-STRAIGHTEN AUTO-FILE — is DONE: built DARK `aa61350`, census MET
2026-09-01, see the DONE ledger. Flip is the owner's call.)

**Standing autonomy protocol (owner, 2026-08-30, applies to every night):** runs on auto — never waits for the
owner; agents free (advisors + Oracle, parallel when independent); **Chris ALWAYS sandboxed** (a COPY of the
corpus, never the live app/DB/Desktop originals; cards logged, never implemented that night); **anything needing
the owner's approval is LOGGED under "NEEDS YOUR APPROVAL (morning)" in the handover and skipped** (live flips,
push, live-DB/app/Desktop writes, non-DARK changes, new deps, licensing/legal/backend/website, deletes outside
scratch/sandbox, implementing a Chris card); **anything dangerous goes to the agents first (gary/eric → Oracle)
and, with no safe route, that item STOPS** — never improvise around a refusal.

## QUEUE — worth testing or checking (ranked; add freely, date each)
- **2026-09-02 · [census, real corpus] `raw_value` on keyword money reads is LIVE, not DARK** — the
  keyword mint now preserves the pre-clean matched text as `raw_value` on a currency read (gated behind
  `CREDIT_SIGN_COHERENCE`), arming validator arm 2 on keyword totals (was dead — keyword reads set no
  `raw_value`). But `CREDIT_SIGN_COHERENCE` is FORCED ON by `money_sign_parens`/`money_sign_cr` (mig-98
  default-ON, handler.js:486), so this is a LIVE detection change: keyword totals whose raw text carries
  an unparsed negative marker (bare trailing minus `160.32-`, or a parens/CR the sign-capture declined)
  now draw arm 2's sign note → review-bound, auto-file blocked. VALUES never change (purely additive; the
  fix mirrors what anchor/snap reads already do). Unit+integration pinned green
  (`test_keyword_raw_value_credit_sign.py`; OFF byte-identical). **The owed gate:** census the real corpus
  for NEW false arm-2 flags — how many CORRECT totals carry an incidental `_NEG_MARKERS` hit in their
  matched text (a table rule / dot-leader past the SEAM3 guard, a column-bled 'CR')? Run OFF vs ON on the
  `db.backup()` copy (`RR_APP_ENV=1`, `OCR_RENDER_DPI=200`, dedup `RR_IDS`): assert 0 value diffs, enumerate
  the new sign-notes, human-eyeball each as a TRUE mis-typed-credit catch vs a false flag. Repeat if: the
  money reader or `_NEG_MARKERS` change.
- **2026-09-02 · [FLIP GATE, owner-machine] `watch_separate_enabled` SOAK** — the higher-value watch/manual
  parity win (a bundled multi-doc PDF splits on manual but imports WHOLE on watch until this flips). Built DARK
  `29adce2`, unit-pinned (`test_watch_separation.js` 17: re-import guard + no-loss + held-set = segments). The
  UNMEASURED risk is empirical: does the real separator split real bundles at the RIGHT boundary on the
  UNATTENDED auto-file-held path, no loop, no loss. **Gate protocol: `docs/designs/WATCH_SEPARATE_SOAK_GATE_
  2026-09-02.md`** — pre-check (pin green) → arm ON in a SANDBOX watch folder → feed the known bundles (Demo
  Docs Print Tracker) + genuine single docs (over-split control) → `node stress_test/watch_separate_soak.js
  --watch-folder <dir>` (mines processing.log for loop/loss/error → PASS/FAIL/INCONCLUSIVE) → human boundary +
  held-review check → owner flip. Flip is approval-class; kill-switch stays.
- **2026-08-31 · [owner-machine VM gate] Confirm the batch-import crash fix** (BUILT — see the DONE ledger). Three
  remaining checks need a low-RAM VM / the real corpus / the friend's log (Oracle C6.5): (1) a hundreds-of-PDFs import
  on a memory-pressured VM survives, logs the spawn failure, shows the truthful "left in your source folder" message,
  and NO `uncaughtException` escapes; (2) a realdoc FULL-concurrency batch OFF vs ON → extraction rows byte-identical
  (confirms the OMP-decouple read-neutrality Oracle traced by construction); (3) capture the friend's
  `%APPDATA%\ScanFinder\processing.log` `uncaughtException:` tail + Event Viewer OOM/`0xC0000005` line to CONFIRM the
  OOM hypothesis and validate the 1.5GB per-worker budget. **Also queued separately (own gate):** oscar's
  grayscale-pages-1..N memory lever (accuracy-touching — keep page 0 colour, `BANNER_HEADING_REREAD` reads its red
  channel) — build only if the per-worker budget needs to shrink for large multi-page PDFs.
- **2026-08-31 · Client + cert-tool Electron 44 upgrade (just `npm install`, no code change).** Both
  `client/package.json` and `cert-tool/package.json` ALREADY say electron `44.0.0` (bumped in the E44 merge),
  but `client/node_modules/electron` is still `31.7.7` and `cert-tool/` has no `node_modules` at all. Both are
  pure-JS + Electron — NO native modules (no better-sqlite3/argon2, zero `.node`), so the upgrade = `npm install`
  in `client/` and in `cert-tool/`, then a launch smoke-test. No ABI rebuild needed (unlike the core). Not urgent
  (the client talks `/v1` TLS, interoperates regardless of its own Electron version), but do it before the next
  client build — 31.7.7 is old for security patches, and the merge already set the intent.
- **2026-08-31 · [bug, real install] Quick-check dropdown focus** — on the packaged E44 build, the native
  `<select>` dropdowns in the "Quick check" grid don't open on click until an OS deactivate→reactivate (the
  user's Start-menu round-trip healed it). Quick check = the in-page `.ba-modal` in `review/renderer.js`
  (built ~1052, `_baOpen` ~1187) — and `_baOpen` does NOT run the app's focus-repair on open, unlike the
  modals that work (`repairModalInputFocus` double-rAF, ~1702/~5273). Likely the intra-frame focus-commit
  class nudged by the Chromium 31→44 jump; healing signature also matches the OS-input-routing "third failure
  mode" (memory `project_focus_repair_mechanism`). eric is diagnosing the SAFE fix (respect the landmines:
  never `win.blur()/win.focus()` — the flash storm; never fire the repair on select-open — "flashes open and
  shut"; select is excluded from the pointerdown repair). `batch_audit_enabled` is default-ON (mig 93), so a
  customer can hit it. Workaround for now: click away from the app and back. Fix + a regression pin, then a
  rebuild before wide rollout.
- **2026-08-31 · Thorough Chris round (sandboxed `/christest`) — full end-to-end customer vet.** Standing rules:
  sandbox ONLY (a COPY of the corpus, never the live app/DB/Desktop), real screenshots, cards logged and NOT
  implemented that night, a clear YES/NO verdict → `docs/CHRIS_FULL_APP_REVIEW_<date>.md`. Focus the NEWEST surfaces
  on top of the usual cold-import / teach / File-All / scary-button battery: (1) the batch-import low-memory copy —
  does "Using N workers to stay within this PC's available memory" reassure rather than alarm, and does "…left in
  your source folder — import again to retry" read clearly to a non-tech user; (2) the DB-encryption opt-in ceremony
  (Settings → Advanced: mint → masked code Show/Copy/Print → typed "I HAVE SAVED IT" → relaunch) + the Unlock/Recover
  window copy — is it clear, not frightening, and does "keep these safe" land; (3) the open Chris cards still queued
  ("ready" language war, page-furniture words wearing ✓/High, taught-ref garble on siblings, heading-guess issuers →
  "Sender not identified"); (4) confirm the orphaned stamp-placement Settings panel shows nothing broken. Verify-round
  any card fixed since his last run.
- **2026-08-31 · Probe Castellan 0005's saved inline-harvest slice** (gary's CAD8 trace): which
  sub-path truncated 'CAD832694' → 'CAD8' — the `_read_inline_box` one-token trim on a mid-token
  OCR space ("CAD8 32694"), a partial ladder read, or the short-token inversion? One OCR probe of
  the saved slice settles it and decides whether a read-layer slice 2 (untrimmed containment in
  `_pick_fuller_code`) follows the merge-layer yield.
- **2026-08-31 · DB-AT-REST ENCRYPTION — the INTEGRATION PASS is now BUILT (`19432cb`, DARK); only
  OWNER-machine gates remain.** `docs/designs/DB_ENCRYPTION_ARC_2026-08-31.md` is the runbook. The crypto
  core + the boot/UI integration are done + pinned (eric-lifecycle + Oracle SIGN-OFF-W/COND): the whenReady
  boot gate (5 actions), the Unlock/Recover window, the tripwire, the opt-in Settings ceremony (a DISJOINT
  `.db-migrate-code` arm → boot-migrate, fail-toward-plaintext). Pins green under E44 (startup 11,
  boot-migrate 18). **NEEDS THE OWNER (destabilising / DB-rewriting — do NOT run autonomously):** (1) THE
  MIGRATION DRILL on a real DB — `db.backup()` first, then Settings → Advanced → "Turn on encryption…" →
  confirm → relaunch → verify silent open; delete `.db-key` → restart → Unlock recovers by code;
  `db-crypto-tool export-plain` a copy; (2) the DPAPI-loss + downgrade drills (restore `.pre-encrypt` →
  must LOUD-tripwire); (3) the PACKAGED-build boot + gate-5b on the merged E44 tree; (4) perf <10% + a full
  `verifyAuditChain`/`canStamp`//v1 session on the encrypted DB; (5) realdoc-605 OFF byte-identical.
  **DEFAULT-ON fresh installs is DEFERRED (owner decision) — the feature is opt-in only.** The first click
  of "Turn on encryption" IS the migration drill — it encrypts the live DB (migrate() is crash-safe: keeps
  plaintext on any pre-SWAP fault).
- **2026-08-31 · FLIP GATE for `template_locate_role_qualifier` (BUILT DARK `e65959c`, mig 99 OFF):**
  the realdoc-605 gate is the remaining flip prerequisite — a `db.backup()` copy of the live DB,
  `RR_APP_ENV=1` + `OCR_RENDER_DPI=200`, OFF (`TEMPLATE_LOCATE_ROLE_QUALIFIER=0`) vs ON arm on the
  dedup `RR_IDS`: assert OFF==ON byte-identical EXCEPT the enumerated total-row heals (would-file
  deltas, corrob agree↔disagree flips, landmark diffs, **0 new wrong totals, M=7 unchanged**), plus
  a combined-arm census WITH the reslice sweep (Nordwind 20 incl. 0023). Then the Hard Set
  dual-rendition floated/role-qualified-total class into `gen_hard_set.py`. Flip order joins AFTER
  sweep/discount; never via strict-money. Pins already green (`test_locate_role_qualifier.py`).
- **2026-08-31 · FLIP GATE for `template_fragment_containment_yield` (BUILT DARK `2bf7609`, mig 100 OFF):**
  the CAD8 ⊂ CAD832694 merge-yield. realdoc-605 on a `db.backup()` copy (`RR_APP_ENV=1`,
  `OCR_RENDER_DPI=200`, dedup `RR_IDS`): OFF byte-identical / ON **M=7 unchanged, zero accuracy drop,
  hold-set leavers enumerated + eyeballed** (hold-with-fragment → hold-with-full-value, no new silent
  file). Plus the Castellan five as fixtures (0005 heals, 4 siblings byte-identical) and a clipped-code
  class into `gen_hard_set.py`. Pins already green (`test_fragment_containment_yield.py`). Queued
  separately: the one-off OCR probe of 0005's saved inline slice (which split-path truncated the token).
- **2026-08-31 · Boxed TOTALS slice (own arc):** the cell-below arm is ref/date-only by Oracle C2
  (money labels ship right-only; a bare "Total" is every line-items header). A money leg needs a
  line-items-header guard + its own census. The Hard Set table_total class already reads totals
  100% via the right leg — measure whether a real gap exists before building.
- **2026-08-31 · Lead-minus (`-£x`) mini-vet:** dies at the right-leg separator strip
  (keyword.py ~:2071), NOT the mint — fixing it means changing a shipped strip that also serves
  "Total - 160.32" dash leaders. Needs its own design + census (how many live credit notes print
  the lead-minus form?). Until then the notation stays note-only (flagged, never silent).
- **2026-08-31 · `raw_value` on keyword money reads (small slice):** CREDIT_SIGN_COHERENCE arm 2
  is dead on keyword reads (raw_value never set) — a MIS-typed credit note with an uncaptured
  notation still gets no sign note. Populating raw_value at the keyword mint arms it. reggie
  Oracle vet named it; the captures shrink the exposed class to lead/trail only.
- **2026-08-31 · Bare-"Ref" caption vocab decision (owner):** logo_siblings/table_total refs sit
  at 35-40% ON because gen prints bare "Ref" — not a shipped invoice_number label (the
  `_REF_PARTY_STOP` party-guard risk is why). Either add it guarded, or accept and record.
- **2026-08-31 · Fix the Hard Set GT flaws before any re-use** (safe harness-side edits): thermal GT
  invoice→receipt (or ship a Receipt row), `buyer_issued_po` dual-accept buyer/vendor per the 07-12
  doctrine, credit-note component-sign convention (page signs every row, GT signs only the total). Then
  re-gen + re-score to refresh the baseline.
- **2026-08-31 · The "ready" language war (Chris card 1)**: three meanings on one screen ("N more ready to
  file" chips vs File-All's "Nothing is ready"), plus a group-head arithmetic bug candidate (2+5=7 on a
  6-doc group — check the counter query). Copy semantics + one query. Owner vet first.
- **2026-08-31 · Bare page-furniture words must not wear ✓/"High" in ref/date boxes** (Chris card 2): a
  presentational rule (value ∈ caption vocab → never ✓/High styling, honest "looks like a heading" copy);
  the structural fix is oscar's cell-below card.
- **2026-08-31 · Taught ref cells re-read garbled on siblings** (Chris card 4: `iwv-s0087` etc., flagged
  every time): candidate = the R8 padded-re-read recipe (0.5×h pad, white border, PSM 6) applied to taught
  ZONE re-reads on ref roles — same lesson as the re-slice arc's headroom finding. Census first: how many
  taught-zone ref re-reads fail `appears-on-page` on the live corpus?
- **2026-08-31 · Rock-bottom heading-guess issuers ("BILL TO"/"SHIP TO") → route to "Sender not
  identified" instead of minting a company** (Chris card 5; the issuer note already fires — this is a
  routing threshold question).
- **2026-09-01 · M=7 DATE subset RESOLVED — a MEASUREMENT ARTIFACT, not a bug (reggie + 007 → Oracle DO NOTHING on
  code).** Traced all 5 date exemplars on the real pipeline; 007 RENDERED the scans + main VERIFIED the #1453 crop
  (prints "18-01-2025", clean glyphs). Findings: #1453/#1649 are POISONED GT — the app reads the page CORRECTLY
  (18-01-2025 / 24-08-2026) at 98%, the stored GT (08/04) is a stale confirm (decisive: sibling #1908 prints the
  identical 18-01-2025 with a CORRECT GT; 40/42 Silverbeck read==GT). #364 = poisoned GT (year 9687). #953/#1423 =
  already HELD by the year-plausibility note (Gate B of `_flag_filing_value_sanity`, year-only); #1423's correct date
  was also read by keyword + WON. So NO genuine silent-wrong-date auto-file remains on the current pipeline (proven
  for the 605-corpus/200-DPI; HYPOTHESIS for unseen templates). **Oracle: DO NOT build reggie's page-witness guard**
  (WRONG-LAYER — it's the date twin of `FILING_SANITY_PAGE_MATCH_V2`/Gate A, which false-flagged ~7× in Chris r7 and
  still ships OFF; re-imports a measured false-hold class for near-zero catch). **NEEDS THE OWNER: (1) DATA FIX FIRST**
  — correct the poisoned GT in `Desktop\ScanFinder Test Corpus\ground_truth.json`: #1453→18-01-2025, #1649→24-08-2026,
  #364→its true year (render it); else they score as regressions in any gate. **(2) FLIP `trust_role_disagreement_refuse`**
  (config only, already built DARK) — the safe date cross-witness rule (fires only on a populated page-family disagree,
  so #1453 still auto-files correctly; catches #1423's class). Gate (high blast radius — shared auto-file gate):
  current HEAD, `RR_APP_ENV=1`, `OCR_RENDER_DPI=200`, **date-fold ON** (verified default), GT FIXED FIRST: M=0, zero
  would-file loss beyond accepted holds, a **NON-VACUITY** assert (the census SELECT threads `corroboration` AND the
  refusal FIRES on #1423/#413 — a green from an un-threaded overlay is worthless), report the over-hold delta. Full
  ruling: the a3a6061693e4213cd Oracle transcript. **Repeat if:** a future measurement surfaces a REAL silent-wrong-date
  (year-on-page, box wrong, NO independent page family produced a competing read) → then a targeted second date-zone
  OCR (a real witness), not an absence-flag — its own oscar/007 + Oracle pass.
  Suppliers #331/#1092 (the two SUPPLIER errors in M=7) are a SEPARATE class — not covered here.
- **2026-08-30 · AUDIT of every shipped "never auto-files / review-bound / held" claim against the REAL gate** with
  `autofile_gate_unify` ON: the deskew retry's `_needs_review=True` was a dead guard (found by accident). Enumerate
  every writer that relies on `_needs_review` or on a doc-level flag instead of a field NOTE, and test each with
  `trust.isAutoFileEligible` on a fixture. gary → Oracle.
- **2026-08-30 · Refs/dates in the re-slice witness sweep (slice 2)** — trigger must be "the zone's own read was
  ABSENT or format-INVALID" (never out-vote a valid dissent); reuse `_read_pad_window_date/code` as rung 1; the ref
  xcheck demoter is Oracle-B2-deferred (0030's `NRQ-2551` hold is that class).
- **2026-08-30 · R8 as the PRIMARY money mapping read — census only**: every taught currency mapping across ≥5
  templates at 200 AND 300 DPI, tight ladder vs R8 vs GT (0 T→F, 0 new format-valid wrong, pad-window suites
  byte-identical, small-font totals decide it). Oracle said NO until this exists.
- **2026-08-30 · The deskew retry never fires on a note-only hold** (keys on engine `_needs_review`); its 5/20 heals
  were a sandbox artefact (empty ref/date). Measure how many live held docs have skew ≥ 0.3° and a note-only hold
  before widening the trigger.
- **2026-08-31 · TWO pins still red after the mig-93 tidy (`24fe2a1` greened 14/16) — NOT seed flips, real source drift,
  need the OWNER's UI intent (do NOT force green):**
  - **`test_settings_wiring` — a REAL product gap.** The stamp-placement Settings panel (save default stamp
    position/size: `stamp-section/preview/preview-box/size/size-val/save/reset/msg`) has full renderer wiring in
    `settings/renderer.js` (`initStampPlacement`, ~line 2733) but NO markup in `settings/index.html` — so the panel
    never appears; users can't set the default stamp placement from Settings. It is orphaned-but-GUARDED
    (`initStampPlacement` early-returns on `!stamp-size`, `stampPreviewPaint`/`stampSetMsg` guard too) → no crash, just
    a dead feature from the 2026-08-28 stamping UI. Resolve either by adding the panel markup or removing the orphaned
    renderer code. (The `dbenc-print-sheet` id the test also flags is a FALSE POSITIVE — it's minted at runtime via
    `sheet.id='dbenc-print-sheet'`; the test's mint regex only matches the `id="..."` attribute form.)
  - **`test_activity_strip` — 3 source-contract pins lag a renderer UI refactor** (all three features still exist,
    verified): the put-back panel line is now assembled through a `_full` var (not inline `${_asLineFull(ev)}`); the
    bulk-approval line + the close-X `.ap-close` restyled `position: absolute` → `static`. Re-anchor the pins to the
    current source once the owner confirms the r18/r20 UI is the intended state (the `absolute`→`static` change wants a
    visual eyeball).
- **2026-08-30 · The total-swap class** (garbage zone read WON, no keyword read, only the re-read reconciles) — 0
  stored exhibits; needs the re-read injected before `_reconciliation_pick_total`. Low priority until a census finds one.
- **2026-08-30 · Money fold in `_corrob_values_agree`** — no measured target (19/20 records already agree); build only
  if a census finds separator-only money dissents. reggie's design is in the 08-30 handover.
- **2026-08-30 · Warm cross-contamination** (2026-07-29 rig: loading live learning dropped a NEW supplier's ref 58→33 %
  on suppliers sharing nothing with the scanned data) — still open; the Hard Set's warm-scan arm re-measures it.
- **2026-08-30 · Search perf**: `verifyAuditChain` re-verifies the whole audit log on every Search open (grows with use).
- **2026-08-30 · Release the wider-reading doubt when the COMMITTED ref IS the dominant form (owner's Pelican
  `PI/25/3699` exhibit — owner: "history shows PI is always the submitted value, and PI was detected during the
  run").** The pad-window flag ("A wider reading of this box shows 'P1/25/3699'…", method `_padcodeflag`, capped 70)
  has no clearing arm when the read is already RIGHT: the P adopt lane + class B only fire when the read is wrong
  (they decline on an established committed form) — the mirror-image gap. Design: release the note iff committed ==
  the scope's ≥0.90-dominant prefix (extractable share) AND passes the learned shape AND the alternative differs by
  exactly ONE confusable glyph AND the committed string is printed VERBATIM elsewhere on the page (the
  "Please quote … on all remittances" line = the independent leg) AND the alternative form is not itself an
  established series (refuse the day P1/… becomes real). Value never rewritten. reggie/gary → Oracle → DARK + census.
  statement exhibit):** the straighten retry's changed-field hold fires on `was '42-04-2025' → now '12-04-2025'` —
  but a day-42 date is not a competing reading, it is noise (the format-invalid-witness principle). Design: when
  `was` fails the field's DETERMINISTIC validity (date: parse_date None; money: not strict shape) AND `now` passes,
  skip the note (noise→value, nothing real changed). RELAXES Oracle C13 → needs a census (how many changed-field
  holds have an impossible `was`? the Hard Set's edge_date/degraded classes generate these) + Oracle sign-off.
  NOTE the independence rule stands: a raw-vs-straightened agreement of the SAME box is never corroboration
  (doc-561: a garble agrees with itself under rotation).
- **2026-08-30 · Toggle hygiene sweep (owner rule):** audit the switch inventory for anything PROVEN bad (failed gate,
  wrong-value exhibit, Oracle SEND BACK) → remove it or move it to a "DO NOT USE" group under the SFDEV dev-switch
  section with the reason in its sub-label. Also: the owner's live test showed TWO stacked "— confirm once." sentences
  on one field (the JS manual-reprocess lane's note + the engine's straighten note) — check one-note-per-field on the
  reprocess road; cosmetic but noisy.

## Standing corpus rule (owner, 2026-08-30)
Test runs use **ONE version of each document — no duplicates**: the durable corpus at
`Desktop\ScanFinder Test Corpus\` (605 papers, `<type>/doc<id>_<name>.pdf`, `ground_truth.json` = the confirmed
values, `rr_ids.txt` for the DB-based harness via `RR_IDS`). Never score the raw duplicate-heavy import folders.
Regenerate after a big import: `TESTING/_measure/reslice_20260830/_build_test_corpus.py <db-copy> <dest>`. Never
confirm/teach from this folder into the LIVE app.

## DONE ledger (newest first) — do NOT repeat unless the "repeat if" condition holds
- **2026-09-02 · raw_value credit-sign census (owner ran) — PASS on safety.** Harness
  `TESTING/_measure/credit_sign_census/` (A/B via a single-file checkout of `keyword.py` at `32ae95b^`).
  Ran 487 money-type corpus docs on `C:\temp\docusnap.db` (arm 2 armed — `credit_sign_coherence`/
  `money_sign_parens`/`money_sign_cr` all `true`, mig 104). Result: **0 committed-value diffs (additive
  confirmed) + 0 new arm-2 flags** → no false positives on the real corpus; the corpus carries no
  bracketed/CR/trailing-minus total read via keyword (no positive control here — efficacy is proven by the
  unit/integration pin `test_keyword_raw_value_credit_sign.py`, all 3 notations fire). Caveat: it was the
  COLD reset test DB (4 confirmed); arm 2 is learning-independent so the false-flag result stands, but a
  WARM real-DB run is the fully representative check. **Repeat if:** run on a `db.backup()` of the WARM live
  DB for full representativeness, OR the money reader / `_NEG_MARKERS` change.
- **2026-09-02 · Toggle hygiene sweep — audited, NO switch qualifies for removal/DO-NOT-USE; added the
  gate-integrity PIN instead.** Verdict per the owner rule ([[feedback_bad_toggle_hygiene]]): a DO-NOT-USE
  move needs PROVEN harm (failed gate / wrong-value exhibit / Oracle SEND BACK), not a seam/install reason.
  The three "NEVER flip" switches are all already handled: `template_format_fail_yield_strict_money` is
  dev-gated (DEV_SWITCH_IDS) + dark-by-SEAM (Oracle C10/C11 — memory says a seam-dark switch STAYS dark,
  not DO-NOT-USE, until a census proves it harmful); `trust_company_key_own_scope` has NO settings UI at all
  (env/DB only, customer-invisible); `deskew_on_import` is DELIBERATELY customer-visible (owner-parked) with
  honest "not yet recommended" copy. The Oracle SEND BACKs on record all became rebuilds, not shipping bad
  toggles. **Integrity audit of the SFDEV gate (`DEV_SWITCH_IDS` in settings/renderer.js): 138 gated, 0 dead
  entries, 0 duplicates, 0 leaked reading-internals** (the 22 un-gated toggles are all deliberate customer
  features / UI / licensing — the documented exclusions). Locked it in: `test_settings_wiring.js` now pins
  the gate — every entry names a real toggle, no dups, and every un-gated toggle is on a declared
  customer-facing allowlist (a new un-gated reading toggle now fails the pin). RED-first verified. **Repeat
  if:** a census ever PROVES a specific switch harmful (then it goes to a DO-NOT-USE group / removal), or the
  gate pin newly fails (a dev added a toggle without gating or allowlisting it — classify it).
- **2026-09-01 NIGHT · #1 Quick-Reprocess gate + #2 Chris round + a FULL pre-release SECURITY AUDIT — ALL
  DONE.** (a) Recovered + finished the crashed Plan B (merge pin 68, `7a8b797`). (b) **Security audit**
  (`docs/SECURITY_REVIEW_2026-09-01.md`, eric+dep-researcher+gary+Oracle): code security strong; 3 safe
  fixes shipped + pinned (`a6ff457`, pin 17); release-gate items LOGGED for the owner (code-sign installer =
  the one no-doc-workaround blocker; plaintext-DB disclosure = Oracle "opt-in + loud BitLocker posture, NOT
  default-on"; honest binned-doc copy; node-forge de-escalated to hygiene). (c) **Quick-Reprocess gate**:
  emit fixture 8/8 on real Python (`2469c97`); Oracle SIGN-OFF-W/COND (the C1×C4 pixel-heal seam → dialog
  disclosure `2c25a6c`); 5-arm flip gate written for the owner's real DB (`docs/QUICK_REPROCESS_GATE_2026-09-01.md`),
  DARK/OFF. (d) **Chris round** (`docs/CHRIS_FULL_APP_REVIEW_2026-09-01_NIGHT.md`): verdict YES; the Quick
  dialog copy + DB-encryption ceremony landed; 6 cards (top = teach-box plausible-word garble still stands
  up "Apply to N" — diagnosed as a real out-of-scope gap in Plan A's name-quality guard, needs a
  letterhead-MATCH card; #5 diag-log = dev artifact, resolved). All in `HANDOVER_2026-09-02.md`. Nothing
  pushed, nothing flipped. **Repeat if:** never re-run — the follow-ups are the owner's approval-class
  decisions (signing/disclosure/push) + the Quick-Reprocess real-DB flip gate + building any Chris card.
- **2026-08-31 NIGHT2 · [owner ask] CORROBORATED-STRAIGHTEN AUTO-FILE arc BUILT DARK + unit-pinned (Oracle
  SIGN-OFF-W/COND C1-C7).** `docs/designs/DESKEW_CORROB_AUTOFILE_2026-08-31.md`. A straighten-CHANGED field
  skips its "confirm once" hold and auto-files ONLY when it is a VERIFIED corroborated rescue: ≥2 independent
  page families incl. a keyword witness agree (`_corrob_licensed_keyword`), the straightened value matches its
  learned skeleton (engine `_shape_ok`), AND the RAW read was not a credible competing reading (`was` empty or
  skeleton-False — Oracle's C4 seam fix, because the straightened corrob record is blind to the raw pass).
  Files: `engine.py` (`_shape_ok` surface), `process_docs.py` (predicate + skip), `handler.js` (`_reconcileEnv`
  bridge, nested under `corroboration_autofile`), pin `test_deskew_corrob_autofile.py` (12 green). Default OFF
  byte-identical (import smoke 14/14; exhibit OFF 0 value diffs). **KEY census finding:** the retry only fires
  in the WARMING phase — reprocessing the now-warm exhibit (doc 806, both working copy + original scan) at 200
  DPI reads clean (Pelican learned), so the enumerated-heals census needs the COLD import state, not a reprocess.
  **Repeat if:** never re-build — the remaining work is the OWNER-MACHINE flip gate (realdoc byte-identical reads
  + human-verified enumerated heals + M=0, reproduced from the cold state) + the flip decision. Do NOT flip.
- **2026-08-31 · [HIGH] Batch-import silent-crash fix BUILT + PINNED (eric+oscar → Oracle SIGN-OFF-W/COND, C1-C6
  applied).** `docs/designs/CONCURRENCY_RAM_CAP_2026-08-31.md`; incident `HANDOVER_2026-08-31_INTEGRATION.md` §2.
  TWO defects: (A) RAM-blind, SMT-overcounted worker count (6c/12t→10 workers×~1.5GB>16GB→thrash); (B) `runWorker`
  was the only batch spawn with no `error` handler → a failure-to-spawn → `uncaughtException` → app died silently.
  BUILT in `src/modules/processing/handler.js`: a RAM-aware hard ceiling (`_effectiveWorkers` = min(setting, cores,
  `floor((totalmem−max(3GiB,25%))/1.5GB)`), totalmem-primary + a freemem tripwire) that hard-ceils even an explicit
  setting; `runWorker` try/catch + `proc.on('error')` + a `settled` flag → resolve a SPAWN_FAILED sentinel; a
  sequential RE-DRIVE of failed-to-spawn shards + a truthful "left in your source folder" line (Oracle C1 — they get
  no DB row, are NOT in Review); the OMP cap DECOUPLED from the RAM-capped count (configured-derived via
  `_reprocessThreadCap`, applied on every path incl. RAM-forced-1); `get-concurrency-info` gains `effectiveMax`/
  `ramCap`; the pre-pass `sepP` RAM-capped too. Pin `test_import_concurrency_cap.js` (cap math + OMP-decouple +
  source-contract resilience/decouple guards) GREEN; no regression in the handler pins. **Repeat if:** never
  re-build — the remaining owner-machine VM checks are the QUEUE item above.
- **2026-08-31 · Mig-93 test-pin tidy — 14 of 16 greened (`24fe2a1`, test-only, feature branch, NOT pushed).**
  Setup-only fixes (no assertion/expected value touched), verified green under E44-as-node. 9 genuine mig-93 seed
  flips (explicit OFF after `runMigrations`, per `test_role_disagreement_refuse.js`); 4 feature/schema drift
  (`test_workflow_snapshot`/`_ipc` = 08-28 stamping gate → stub `canStamp`/use `acknowledge`; `test_document_types_
  aliases` = add `settings` to the v42-sim schema; `test_reviewservice` = `review_group_by_letterhead` OFF arm — its
  "spawn failed" lines are swallowed logs, not failures); 1 brittle-window widen (`test_issuer_clear` 1600→2600, the
  `if(corrected_value)`→`clearAnchors` invariant re-verified intact). Stamping gate coverage confirmed still green
  (`test_stamp_workflow_gate`/`test_workflow`/`test_v1_workflow`). **2 left red (moved to QUEUE above):**
  `test_settings_wiring` (real orphaned stamp-placement-panel gap + a dbenc false-positive) and `test_activity_strip`
  (UI-refactor drift). **Repeat if:** a future migration flips another switch's default (re-run the suite, state the
  new OFF arm in the affected pin); do NOT re-touch the 14 fixed here.
- **2026-08-31 · Realdoc-605 flip gates for the two DARK arcs — NOT RUNNABLE on this machine (owner-machine only).**
  `template_locate_role_qualifier` (mig 99) + `template_fragment_containment_yield` (mig 100) need the owner's real
  learned DB (Castellan taught templates). This machine's live `%APPDATA%\ScanFinder\docusnap.db` is a reset TEST DB
  (50 confirmed, 2 templates, 0 Castellan); the on-disk backups (1668/416 confirmed) also have 0 Castellan; the
  605-paper corpus DB the 08-30/31 gates used is not present here. Running OFF==ON here would be vacuous (arcs never
  fire). **Repeat if:** run on the owner's real DB (`db.backup()` copy, `RR_APP_ENV=1`, `OCR_RENDER_DPI=200`, dedup
  `RR_IDS`) — the harness is `TESTING/_measure/reslice_20260830/_run_docs.js` (add the two `TEMPLATE_*` env keys to its
  line-37 whitelist, or flip the DB setting true in the ON-arm copy so `_reconcileEnv` bridges it).
- **2026-08-31 · DB ENCRYPTION — the BOOT + UI INTEGRATION PASS BUILT (`19432cb`, DARK).** eric-lifecycle
  review + Oracle SIGN-OFF-W/COND (a disjoint `.db-migrate-code` redirect that keeps the downgrade tripwire
  byte-identical). BUILT: the whenReady boot gate (plaintext/open-cached/prompt-code/tripwire/migrate),
  `src/windows/unlock/` (closes via `app.exit(0)` — eric's strand-headless seam), the tripwire
  (`showErrorBox`+`app.exit(1)`, never opens plaintext), the sender-scoped `unlock-recover` IPC (read-write
  verify), the opt-in Settings ceremony (mint→masked code Show/Copy/Print→typed confirm→arm→relaunch),
  `dbKey.mintCode`/`armMigration`/`loadMigrateCode`/`clearMigrateCode`, `dbStartup` migrate row + C1
  self-heal, `dbBootMigrate.js` (fail-toward-plaintext, extracted + pinned). Pins green under E44:
  `test_db_startup` 6→11, `test_db_boot_migrate` 18 (new); existing crypto pins unchanged. Plaintext boot
  byte-identical; nothing encrypts until the owner clicks. **Repeat if:** never re-build — the remaining
  work is the OWNER-machine drills/gates (top QUEUE item) + the default-on decision.
- **2026-08-31 · DB ENCRYPTION PIVOTED to code-as-passphrase + CRYPTO CORE COMPLETE (`684de90`, `+ startup`).**
  Owner requirement (DB backup + printed code resurrects on ANY PC) forced a model change from the
  random-key+sidecar to **code-as-passphrase** (multiple-ciphers passphrase mode, salt-in-header, 125-bit
  code). Oracle re-vet: SIGN OFF WITH CONDITIONS (10). BUILT + PINNED under E44: `dbKey.js` (applyKey/
  applyRekey single pragma choke point, convergence pin), `dbMigrateEncrypt.js` (rekey in DELETE mode,
  crash matrix + kill-during-rekey), `dbStartup.js` (decision table — the restored-backup row + tripwire),
  the seam (`setEncryptionKey(code)` + temp_store=MEMORY), `db-crypto-tool`. Pins: dbKey 16, cipher 10
  (incl. PORTABILITY: lone .db + code opens in a fresh dir), migration 18, startup 6, secretStore 14 —
  ALL GREEN. .db-recovery/argon2 GONE. Nothing encrypts a live DB yet. **REMAINING (the integration pass —
  QUEUE):** the whenReady unwrap gate + the Unlock/Recover window + the combined "Keep these safe" dialog
  (Show/defer/reinforce, admin+DB codes) + slice-3 downgrade tripwire + default-on; then the OWNER drill
  (encrypt the real DB → restart → unlock) + realdoc-605 + perf + /v1 session. arc doc + oracle_log updated.
  Repeat if: never re-do the crypto core — do the integration pass.
- **2026-08-31 · ELECTRON 31.7.7 → 44.0.0 MERGED (`0ed6f20`, from `chore/electron-44`) + pushed.** Merge
  conflicts (package.json/lock) resolved: E44's electron 44 / electron-builder 26 / argon2 0.45.1 / Rung-A/B
  fuses + the encryption dep reconciled to the ciphers fork **^13** (better-sqlite3-multiple-ciphers@13.0.3,
  Node 24). `install-app-deps` rebuilt native for the E44 ABI. Re-gated on E44: test_db_cipher (9),
  test_dbkey (17), test_secretstore (14), test_db_migrate_encrypt (16) — ALL GREEN; real-DB read smoke
  identical (667 docs). **NEEDS THE OWNER (interactive/VM, could not run here):** `npm start` on the merged
  tree, a packaged build boot, and the E44 gate-5b DPAPI continuity on a real E31-written profile (the E44
  branch was VM-confirmed 08-29, but re-confirm the MERGED tree before shipping a build). `client/` +
  `cert-tool/` also bumped electron (their node_modules need `npm install` if built). Repeat if: never
  re-merge — do the owner interactive gates + ship.
- **2026-08-31 · DB-at-rest encryption SLICES 0 + 2 BUILT + PINNED (`603b52e` dep swap, `783b7f3` migration).**
  Slice 0: `better-sqlite3` aliased to `better-sqlite3-multiple-ciphers@^12` (12.11.1 — spans Node 20 AND
  22, so E44 needs only an ABI rebuild, NOT a fork bump); cipher pin `test_db_cipher.js` (9, chacha20 +
  negative controls) + a real-DB drop-in read + check-licenses green. Slice 2: `dbMigrateEncrypt.js`
  crash-safe state machine (`test_db_migrate_encrypt.js` 16 — hexrekey encrypt, verify + negative control,
  crash-ordered swap, every crash → working DB) + the merge-backup keyed VACUUM INTO + `db-crypto-tool.js`
  (status/export-plain). NOTHING encrypts a live DB (no trigger wired). Repeat if: NEVER re-build — the
  remaining OWNER-SUPERVISED pieces (slice-1 tail: main.js unwrap + Unlock/Recover window + the opt-in
  Settings trigger; slice 3: default-on + downgrade tripwire + ceremony) are the QUEUE item; and the
  slice-0 heavy gates (realdoc-605 on the fork + packaged-build boot) run with the design-1/2 gates.
- **2026-08-31 · DB-at-rest encryption SLICE 1 CORE BUILT DARK + pinned (`e2a0535`).** `src/lib/dbKey.js`
  (32-byte master key, fail-closed DPAPI `.db-key`, argon2id `.db-recovery`, never-regenerate) +
  `secretStore.encryptAtRestStrict` + the gated `database/index.js` hexkey seam (inert) + dead
  `src/database.js` deleted. `test_dbkey.js` (17) + `test_secretstore.js` (+2) green. Nothing encrypts
  yet. Repeat if: NEVER re-build slice 1 — the remaining slices (0 dep swap, 1 tail window+wiring, 2
  migration, 3 default-on) are OWNER-SUPERVISED per `docs/designs/DB_ENCRYPTION_ARC_2026-08-31.md` (the
  QUEUE item); do those, don't redo this.
- **2026-08-31 · TEMPLATE_FRAGMENT_CONTAINMENT_YIELD BUILT DARK + Oracle-cycled + pinned (`2bf7609`, mig 100 OFF).**
  The CAD8 ⊂ CAD832694 merge-yield (Castellan delivery_note_0005) — the sanctioned 08-09 successor. A new
  Stage-1 sibling leg after format-fail-yield adopts a confident keyword read that STRICTLY prefix-contains
  a taught template_mapping fragment (ref-family only, NEVER currency/total, cap 88 + neutral both-values
  note, C3 note-not-doubt). C1 applied: `test_stage05_format_yield.py` prose amended to name the arc.
  `test_fragment_containment_yield.py` green (mechanical guard proven with the leg excised). Repeat if:
  a flip is requested — run the realdoc-605 + Castellan-five + Hard-Set-class gate first (the QUEUE item).
- **2026-08-31 · TEMPLATE_LOCATE_ROLE_QUALIFIER BUILT DARK + Oracle-cycled + pinned (`e65959c`, mig 99 OFF).**
  The Net-Total locate steal (Castellan credit_note_0008): the locate now DEMOTES role-qualified 'Total'
  occurrences (`keyword._total_role_collision`, verbatim) inside `_locate_anchor` + the born-digital twin
  `_locate_in_text_lines` (+ its own page-wide leg); all-qualified LOCAL → page-wide, all-qualified PAGE
  keeps today's pick; carriers-override fallback. `test_locate_role_qualifier.py` green (RED-first + Oracle
  cases + end-to-end drift). Flag OFF byte-identical across mapper/anchor/totals/keyword suites. Repeat if:
  a flip is requested — run the realdoc-605 OFF==ON + Hard Set class gate first (the top QUEUE item).
- **2026-08-31 DAY-2 · ALL THREE Hard Set class cards BUILT DARK + Oracle-cycled + GATED**
  (`docs/designs/DARK_ARCS_GATES_2026-08-31.md`): cell-below (SEND BACK → C1-C6 applied; Hard Set
  +240/+253 fills, realdoc byte-identical) · money-sign parens/CR (S-O-W/COND; credit totals
  24→65%, realdoc byte-identical, C1 coherence force) · buyer-issued convention note (S-O-W/COND;
  stripped-copy 7/7 noted, live unchanged, 0 unlicensed live POs). Migs 95-97 seed OFF. Repeat
  if: a flip is requested (re-run that arc's arms on a fresh copy first) or the boxed-totals /
  lead-minus / raw_value queue slices get built.
- **2026-08-31 DAY-2 · Terms finalised + LEGAL_VERSION 2026-08-31 (`127ec74`); installer built
  `dist\ScanFinder Setup 2.0.0-r20260831-0918-127ec74.exe`.** Repeat if: the solicitor edits the
  text (bump LEGAL_VERSION again) or a new build is wanted (close every app instance first — the
  better-sqlite3 EBUSY trap; and never pattern-kill processes by command-line substring).
- **2026-08-31 DAY-2 · Practice run reworked TEACH-FIRST + full User Guide rebuild + Chris vet of
  both (VERDICTS YES ×2).** Teach sim (3 details) → import → Review-as-correction; 20-page guide,
  every deep link resolves, `check:help` fully green; Chris's 4 build-defect cards fixed same
  night (Esc soft-lock, done-list dupe, 3-detail parity, teach-intro label copy) + guide-search
  serial rows; card 4 (help-mode one-shot) = owner choice in pendingfeatures. Repeat if: the teach
  wizard's step list changes (practice must mirror it), or any window gains a surface with no
  guide section (re-run the inventory sweep).
- **2026-08-31 NIGHT · Hard Set adversarial corpus BUILT + SCORED (3 arms).** Result: 400 PDFs 10 classes
  (`Desktop\Hard Set\`), 600 doc-arm scores, **wrong+would-file 0 everywhere**; boxed-cell cold gap traced
  (Stage-1 neighbour-caption steal); credit-sign 4-of-5 notations die at `_clean_value` (sym `£-x` heals);
  warm buyer_issued = the 07-12 doctrine (GT flaw). `docs/HARD_SET_REPORT_2026-08-31.md`. Repeat if: any
  extraction change lands (re-run the 3 arms — cheap) or the gen GT flaws are fixed (thermal type,
  buyer dual-accept, component signs — re-gen + re-score).
- **2026-08-31 NIGHT · Three advisor class cards** (oscar cell-below arm · reggie parens/CR sign · gary
  convention-licensed silence) — `docs/designs/HARD_SET_CLASS_CARDS_2026-08-31.md`, all DARK designs
  awaiting the owner's pick. Repeat: NO — build on approval, per card gates.
- **2026-08-31 NIGHT · Chris Hard Set round (sandbox 9223).** Result: verdict YES; teach-heals-boxed-cells
  CONFIRMED end-to-end (8 siblings, 0 bleed); File All truthfully filed 0 of 60 cold; 8 cards (top: "ready"
  language war; heading-words dressed confident). `docs/CHRIS_FULL_APP_REVIEW_2026-08-31.md`. Repeat if:
  the ready-copy fix or a card build lands (verify-round).
- **2026-08-31 NIGHT · Warm cross-contamination re-measured** (was a queue item): the mature install
  REFUSES unknown issuers (supplier EMPTY-held, fail-safe) rather than bleeding values onto them; the only
  warm claim was the known-buyer doctrine case. Repeat if: identity/letterhead reading changes.
- **2026-08-31 NIGHT · edge_date Hard-Set read** (partial cover of the M=7 date-class queue item): 65% cold
  date accuracy, misses all EMPTY-held (boxed_border + flush_left variants), 0 silent wrong dates in any
  arm — the M=7 leading-digit class did NOT reproduce as a silent fill on synthetic docs (it shows as
  flagged date-in-ref steals instead). The realdoc M=7 trace item stays open.
- **2026-08-30 EVENING · Deduped test corpus BUILT** → `Desktop\ScanFinder Test Corpus` (605 papers: invoice 203 ·
  sales_order 125 · delivery_note 62 · service_worksheet 56 · purchase_order 51 · credit_note 41 · statement 40 ·
  quote 27; 54 MB). Repeat if: a big new live import lands (re-run `_build_test_corpus.py` on a fresh copy).
- **2026-08-30 EVENING · Re-slice witness arc + money-format hygiene + deskew dead-guard fix.** Result: built DARK,
  Oracle C1-C14, 605-paper four-arm realdoc gate MET (M 7 unchanged, +1 would-file, 0 wrong releases); full suites'
  reds all pre-existing. Report: `HANDOVER_2026-08-30_NIGHT.md`, artefacts `TESTING/_measure/reslice_20260830/`.
  Repeat if: the money reader or `_reconciliation_pick_total` changes, or a new corpus shows a noted-total class the
  sweep declines on (`RESLICE_CENSUS_DIR` reasons).
- **2026-08-30 EVENING · Duplicate census of the confirmed corpus.** Result: 2,029 confirmed → 1,940 with a file → 618
  byte-distinct → 605 papers by (type, supplier, ref, date); `RR_IDS` list at
  `TESTING/_measure/reslice_20260830/runs/rr_ids_dedup.txt` (`_dedup_ids.py`). Repeat if: the owner imports a new
  batch (re-run `_dedup_ids.py` on a fresh `db.backup()` copy).
- **2026-08-30 EVENING · Stored-record money-dissent census.** Result: 10 money dissents in 538 records — 8
  format-invalid (older-vintage reads), 2 valid garbles (0023). Repeat if: the crop ladder changes.
- **2026-08-30 DAY · Deskew review-bound retry (whole-page straighten).** Result: `4607cc6`, 5/20 Nordwind identities
  healed — on a sandbox with EMPTY ref/date; live mostly inert on note-only holds. Repeat: NO — measure the live
  note-only-hold population first (queue item above).
- **2026-08-29 · Electron 44 upgrade gates 1-5b; security audit; Chris vet.** See `HANDOVER_2026-08-29.md`.
  Repeat if: Electron bumps again (gate 5b DPAPI continuity is the mandatory one).
