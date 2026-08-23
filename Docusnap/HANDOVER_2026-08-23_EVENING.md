# HANDOVER — 2026-08-23 EVENING (live test session on a fresh DB: Review UX + put-back + logo-veto)

**Branch** `feat/teach-side-overnight` · **HEAD `0b62235`** · **63 commits ahead of origin, NOT pushed**
(owner's standing rule) · this session added ONE commit on top of the morning's `d2f4ed2`.
**Context:** the owner **deliberately wiped the live DB** ("i want an empty db and wiped it") and started the app
fresh, then ran a hands-on test session and surfaced a cluster of Review/filing/matching issues. This session
built + Oracle-gated + committed the fixes. The app is running now on the fresh DB with the new switches ON.

## TL;DR — one commit, four parts (all OFF byte-identical, all Oracle-gated)
`0b62235` "feat(review): activity-strip UX, put-back re-file, detail-veto immunity, two bug fixes":
1. **Activity strip UX** (`review_activity_strip`): two-line chips (bold action + kind-coloured icon; when +
   short detail), wider, ellipsis on the line spans; `--doc-head-h` 74→92 with the strip height (Oracle C8).
   Detail panel gets a **visible ✕ + click-body-to-close** (C5-safe, non-capture, no stopPropagation — the
   capture outside-click closer untouched). **File All Ready now always leaves a strip receipt even at 0 filed**
   (new IPC `record-file-all-outcome`); `reviewEvents.record` dedups `dropped` by docId + caps it (Oracle: the
   repeat-click count-inflation fix).
2. **Put-back re-file via File All Ready** (`putback_refile_on_file_all`, DARK; **mig 87**): a doc the system
   already auto-filed and the user merely put back to *glance* re-files on an explicit File All click when it
   STILL passes `isAutoFileEligible({bypassPutBack:true})` today (stamped `putback_refileable` on the queue
   rows). **Never via any machine path** (import/sweep/reprocess/class-fix keep refusing put-back —
   `trust.js:1001` untouched). **Undo-loop closure** (mig 87 `refile_declined_at` + `putback_refiled_at`):
   pulling a re-filed doc back again HARD-HOLDS it; only a per-doc human confirm clears it. Dialog names the
   re-files; queue shows a "↩ will re-file" chip.
3. **Two bug fixes:** the Review tab **badge** counted `queue.length` (wrong in the filtered "See them" view —
   showed "1" after an 18-doc put-back); now authoritative from the DB count. The **class-fix receipt bar** had
   no close + lingered; added a ✕ + it clears on doc change.
4. **Detail-veto single-supplier immunity** (`logo_detail_veto_single_supplier_immune`, DARK): the 256-bit
   detail-hash veto crops the top-LEFT quadrant, so a CENTRE-top logo is clipped and it hashes a wordmark
   LETTER → colourway-unstable + collides with rivals' round glyphs → false-abstains a dist-2 single-supplier
   lock (Oakhaven 543/544 filed under a hint with "couldn't match this layout"). A new **call-site** helper
   `_detail_veto_single_supplier_immune` suppresses the veto ONLY for a corroborated single-supplier lock
   tripped by a **MARGINAL** rival (detail dist >48); a **DECISIVE** rival (≤48 — the doc-193 / buyer-issued
   class) STILL vetoes. The veto primitives (`veto_by_detail`, `_logo_detail_veto`) + the anchor consumer are
   UNTOUCHED. Env-bridged in the shared `_reconcileEnv` so it reaches the **reprocess** path too.

## Verification state — honest
- **JS tests green:** `test_activity_strip`, `test_review_events` (+ new dedup pins), `test_review_events_doors`,
  `test_put_back_hold` (+ full Oracle battery: danger pin, bypass containment, machine-still-refused, undo-loop,
  per-doc-confirm-clears, OFF byte-identical), `test_scope_trust`, `test_review_readiness`, `test_quiet_lane`,
  `test_reviewservice`, `test_generic_autofile_refusal`. `node --check` clean on all edited JS.
- **Python tests green:** new `test_detail_veto_single_supplier_immune.py` (heal + counter-pin + boundary-at-48 +
  branding-absent + ≥2-supplier + non-tight-lock + source-contract); existing `test_logo_detail_veto`,
  `test_logo_detail_global_rivals`, `test_logo_detail_primary`, `test_template_veto_fallthrough` unchanged/green.
- **Real-pipeline proof (the app):** reprocessing **543 & 544 → template_id=2, `template_fixed` @95, oc=100,
  note gone, filed clean.** (531 stays held — the SEPARATE skew/coarse-near-miss sub-case, coarse phash MIN=12,
  not the marginal-rival class; iris flagged it as out of scope.)
- **realdoc A/B (buyer-issued blast radius), on the live-DB copy, RR_APP_ENV=1, OFF vs ON:** **byte-identical.**
  supplier_name 100% every type both arms; would-auto-file 593/621 both; would-auto-file-WRONG **12, identical
  list both arms** (all on **date/ref, none supplier** — pre-existing, the leading-digit date class, NOT this
  fix); M_type=0 both. So: **benefit shown (543/544), safety clean (0 new wrong-supplier, 0 regression).**
- **NOT full-suite:** I ran the targeted + related suites, not `run_all_suites.py`. The pre-existing reds from
  the morning handover are unchanged (nothing I touched is in them).

## Switch state on the LIVE (fresh) DB — set this session
ON: `review_activity_strip`, `reprocess_holds_as_lane`, `quiet_reread_first_fill_reliability_hold`,
`trust_role_disagreement_refuse`, `quiet_reread_on_ready_templated`, `template_fixed_debris_wide`,
`putback_refile_on_file_all`, `logo_detail_veto_single_supplier_immune` (+ the ~110 migration defaults).
**OFF (deliberately):** `trust_company_key_own_scope` (owner's standing rule — the 08-19 starvation class),
`telemetry_enabled`, `learning_exclude_rewrite_markers`. All 5 the owner asked about (garble arc + type-split
arc: `template_fixed_seed_fragment_garble`, `identity_suggest_canonical`, `review_group_by_letterhead`,
`type_ambiguity_unsupported_waiver`, `type_ambiguity_ripple`) are still **OFF** — see "Owner vet queue".

## FIRST ACTIONS for the fresh session
1. Read this file, then `docs/oracle_log.md` (three 2026-08-23 EVENING entries: put-back re-file, detail-veto
   immunity — both SIGN-OFF-WITH-CONDITIONS, conditions met).
2. Decide whether to PUSH (63 ahead) and rebuild the installer (predates all of this).
3. The two leftovers as their own arcs (below): **531** and the **12 wrong-date auto-files**.

## Deferred (diagnosed, not built)
- **531 (Oakhaven) still held** — a DIFFERENT sub-case from 543/544: skewed scan, coarse phash MIN=12 (a real
  near-miss, not the detail-veto class). Its own skew/coarse-band arc. iris's `logocrop_531.png` shows the skew.
- **The 12 would-auto-file-WRONG docs** (realdoc, identical both arms): all **date/ref**, none supplier — the
  leading-digit date class (#413/Copperfield from the morning handover). **This is the next accuracy arc**
  (007/oscar; the 08-07 pad-window recipe on the taught date box). Untouched by this session.
- **Notification consolidation (owner cluster #5):** too many competing surfaces (activity strip + class-fix bar
  + teach/anchor-readout + toasts + bulk-file banner). The class-fix ✕ (this session) is a patch; the real job
  is merging the overlapping bars into the strip. bob+eric+Oracle when the owner wants it.
- **Owner vet queue (the 5 garble/type-split switches, still DARK):** the owner asked "should these be on by
  default?" I flagged: (a) an inconsistency to reconcile — `template_fixed_debris_wide` (wide garble, ON via the
  overnight batch) vs `template_fixed_seed_fragment_garble` (narrow garble, OFF) — the safer narrow arm should
  be ≥ the wide one; (b) dependencies (`review_group_by_letterhead` needs `identity_suggest_canonical`;
  `type_ambiguity_ripple` needs `type_ambiguity_unsupported_waiver` + the quiet re-read). Each still owes a
  Chris round before a new-install default flip.
- **The overnight owner-owed items are now MOOT:** the re-freeze script + the live-DB flip order (morning
  handover) were for the OLD live DB, which the owner WIPED. The fresh DB got mig 86/87 clean, no frozen-identity
  drift to repair.

## Needs the USER
- Push decision (63 ahead) + installer rebuild.
- The r20 vet cards from the morning handover are still open (self-answering offer bar, etc.) — separate from
  tonight.

## Key facts / paths
- **Live DB is a FRESH wiped DB** at `%APPDATA%\ScanFinder\docusnap.db` (= `C:\Users\cmccu\AppData\Roaming\
  ScanFinder\docusnap.db`), **mig 87**, ~200 confirmed test docs. **`%APPDATA%\Roaming\ScanFinder1\docusnap.db`
  is an OLD copy (2656 docs, mig 77) — untouched; leave it.** The app is RUNNING on the fresh DB (background
  task `b03rdvad6`) with all the switches above ON.
- **mig 87** = `documents.refile_declined_at` + `putback_refiled_at` (both NULL-inert; DARK behind
  `putback_refile_on_file_all`).
- New Python: `python_backend/extraction/template_matcher.py` `_detail_veto_single_supplier_immune` (call-site,
  ~line 328) wired at the veto site (~line 897, `... and not _detail_veto_single_supplier_immune(...)`).
- New IPC: `record-file-all-outcome` (processing/handler.js) + preload `recordFileAllOutcome`.
- Env bridge for the logo switch lives in the SHARED `_reconcileEnv` (handler.js ~157) so import + watch-batch +
  **reprocess** all get it (the reprocess spawn env, handler.js ~4072, does NOT run the buildTrainingArgs inline
  block — a trap: an import-only bridge would never reach Reprocess).
- Settings toggles: `putback-refile-toggle` + `logo-detail-immune-toggle` (settings/index.html + renderer.js
  switch-map). The logo one needs an **app RESTART** to take effect (Python env bridge).
- Tests: JS `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <file>`; Python `PYTHONIOENCODING=utf-8 py -3.12
  python_backend/tests/<name>.py`. realdoc A/B runner: `<scratchpad>/rr_immune_ab.sh` (backup live → OFF arm →
  ON arm; RR_DB=copy RR_APP_ENV=1 OCR_RENDER_DPI=200).
- iris forensic (the logo diagnosis) + its images/scripts are in a prior scratchpad; the report is quoted in the
  session transcript. Oakhaven detail-hash: own-set disagrees (94>72) while Nordwind lands marginal (62); the
  region crops top-left, isolating the wordmark "O" not the diamond.

## Traps this session
- **The reprocess spawn (handler.js ~4072) does NOT run the buildTrainingArgs inline switch block** — only the
  four shared env helpers (`_autoTitleEnv`/`_ocrDpiEnv`/`_anchorCropEnv`/`_reconcileEnv`). A new Python switch
  that must work on Reprocess MUST be bridged in one of those shared helpers, not (only) the inline block.
- **The realdoc/standalone harness does NOT replay the app's full ~60-flag config** (RR_APP_ENV mirrors only 3
  helper groups) — my first standalone identify-repro of 543/544 was inconclusive (no veto fired). The app's own
  reprocess is the ground truth; verify template matches on the real app, not a standalone identify script.
- **The Review tab badge is `queue.length` by default** — a filtered view (`_viewingAutoFiled`) makes it lie;
  now fixed to the DB count, but any new filtered view must keep `_authReviewCount` fresh.
- `core.autocrlf=true` (LF→CRLF warnings on commit are benign; source-contract tests normalise CRLF). The git
  repo root is `c:\GIT Projects` (paths are `Docusnap/...`); the project is the `Docusnap/` subdir.
- Restarting the app: `Stop-Process -Name electron -Force` then `npm start` (background). mig runs + the Python
  env bridges load only on a fresh start.
