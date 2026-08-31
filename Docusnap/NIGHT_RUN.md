# NIGHT RUN — the overnight test/check queue and its ledger

> **Owner convention (2026-08-30):** anything Claude thinks is worth TESTING or CHECKING goes into this file's QUEUE as
> it is noticed. When the owner says "going to bed", the newest `docs/designs/NIGHT_RUN_*.md` prompt runs. **Every
> night, when the run finishes, the session moves what it did into the DONE ledger with the result and a
> "repeat only if" condition — so no night repeats work unless it is needed.** Before planning a night, read the
> DONE ledger first. Keep entries one to three lines; detail lives in the linked report/handover.

## TONIGHT — none armed
The 2026-08-31 adversarial-corpus run COMPLETED (see the DONE ledger + `HANDOVER_2026-08-31_MORNING.md`).
Queue the next night's prompt as a `docs/designs/NIGHT_RUN_*.md` and point this section at it.
**Standing autonomy protocol (owner, 2026-08-30, applies to every night):** runs on auto — never waits for the
owner; agents free (advisors + Oracle, parallel when independent); **Chris ALWAYS sandboxed** (a COPY of the
corpus, never the live app/DB/Desktop originals; cards logged, never implemented that night); **anything needing
the owner's approval is LOGGED under "NEEDS YOUR APPROVAL (morning)" in the handover and skipped** (live flips,
push, live-DB/app/Desktop writes, non-DARK changes, new deps, licensing/legal/backend/website, deletes outside
scratch/sandbox, implementing a Chris card); **anything dangerous goes to the agents first (gary/eric → Oracle)
and, with no safe route, that item STOPS** — never improvise around a refusal.

## QUEUE — worth testing or checking (ranked; add freely, date each)
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
- **2026-08-30 · The baseline 7 wrong auto-files (M = 7 / 605, 1.2 %) — the leading/garbled-digit DATE class**
  (#953, #1423, #1453, #1649 + the poisoned-GT #364; suppliers #331, #1092). Silent misfiles a customer never sees;
  the biggest remaining extraction risk. Needs: trace each, class card (reggie + 007), a witness-style guard.
  Covered partly by the Hard Set's `edge_date` class — read that result before designing.
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
