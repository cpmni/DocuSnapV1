# HANDOVER 2026-09-13 (overnight) — flip-corpus censuses (PART 1) + QuickFile/Departments foundation (PART 2) + Chris

Branch `feat/teach-side-overnight`. **~24 commits ahead of `origin`, NONE pushed (owner's call).** HEAD at
the D2-core commit `202456e`. Tree clean apart from scratchpad/measure outputs. Read `CLAUDE.md` + this file.

The owner gave two overnight directives: (1) "kick off the night run" → **PART 1** below finishes the
flip-corpus campaign; (2) "ask Chris to vet the software then continue with the general doc filing plan …
fully implemented and tested tomorrow" → **Chris** (a sandboxed vet, running/《done》 — see §Chris) and
**PART 2** below (QuickFile + Departments). Standing autonomy protocol applied throughout (auto+safe;
customer-default flips + push are approval-class → LOGGED here, not done).

**START HERE:** the **NEEDS YOUR APPROVAL** queue (just below) is the morning to-do; PART 1 is the census
detail; PART 2 is the new-feature build (all DARK/inert until you flip); §Chris is his verdict + cards.

---

## TL;DR
The flip-test corpus is BUILT, SOUND, and the first censuses have run. **Two DARK fixes passed cleanly and
are flip-ready — `ref_confusable_flag` (mig 159) and `name_role_nonname_flag` (mig 156).** They just need
your go to flip (a promotion migration = customer default, so it was not done unattended). One fix
(`format_class_join`) turned up a real blast-radius finding and stays off. The corpus + method are reusable
for the rest of the ~39 waiting fixes.

## What tonight did (all committed, none pushed)
- **`834c8b2` — failure-mode injectors** in `stress_test/gen_customer_test.py` (`--inject MODE=issuer/type`)
  + `test_inject_shapes.py` pin. Three deterministic value-shape modes with no shipped handler:
  ref-confusable, format_class_join, name-is-postcode. The trick: the HISTORY (teach) docs carry the shape
  that defeats the shipped pre-empt gate; the TEST docs carry the failure. All 3 proven firing.
- **`3605051` — the 700-doc census** (`TESTING/_measure/flip_corpus_20260912/CENSUS.md` + reusable scripts
  + `docs/DARK_SWITCH_LEDGER.md` updated). Corpus `Desktop\Flip Corpus 700\warm_700.db` (50 templates /
  300 history / 400 test).

## Census results (700-doc warm corpus, faithful RR_APP_ENV=1 baseline)
Corpus SOUND: ref 97% / date 99% / 179-of-400 auto-file / **0 wrong filing-field auto-files**.

| fix | mig | M (safety) | efficacy on the corpus | verdict |
|---|---|---|---|---|
| **ref_confusable_flag** | 159 | **0** | 6 fires on `S0-#####`; #134/#139 file→hold | **PASS — flip-ready** |
| **name_role_nonname_flag** | 156 | **0** | 5 `+nonname_flag` fires; #460 file→hold | **PASS — flip-ready** |
| format_class_join | 120 | 0 (filing) | index-join proven | HOLD — see finding |
| trust_ref_role_shape | 154 | 0 | inert (synthetic refs high-cardinality) | safety-pass; efficacy = live (done 09-10) |
| template_drift_override_guard | 157 | 0 | holds 2 | safety-pass; efficacy = live #243 (done 09-10) |

## ⚠ NEEDS YOUR APPROVAL (morning)
1. **FLIP mig 159 `ref_confusable_flag` + mig 156 `name_role_nonname_flag`.** Both already carry Oracle
   SIGN-OFF-W/COND; the census supplies the M=0 + fire + file→hold evidence. The flip is a small commit
   each: a `@DEFAULT_FLIP` promotion migration UPSERTing the setting `'true'` + removing the key from
   `dark_switches.js` `TEST_SWITCH_KEYS` **in the same commit** (the release gate refuses a `'true'` write
   while the key is still listed). I did NOT write these — a customer-default is approval-class. Say the
   word and I'll prepare both flip commits.
2. **PUSH** — 17 commits local, none pushed.
3. **format_class_join finding** — decide: investigate the blast radius (it re-arms `total_amount`
   format checks on unrelated invoices → 7 review-bound total notes; broader than its pins claim), or
   leave it dark. It is M=0 / no wrong file, but adds review friction.
4. **Widen scope** — I ran a further safety batch overnight (see §Widen). `template_pad_date_adopt` (mig
   143) also PASSED (M=0 + 1 correct date heal) — a flip candidate pending your go.
5. **QuickFile + Departments (PART 2)** — the foundation is built DARK + pinned (7 commits). It does NOT
   change the app until you enable it. Decision: continue the build to completion (the finish path is
   mapped in PART 2 — the D2 reader-sweep is the load-bearing next slice), and eventually flip
   `direct_intake_enabled` / `departments_enabled` (customer-facing → your call). Nothing is flipped.
6. **Chris's cards (§Chris)** — his sandboxed vet queued NEW finding cards; implement NONE without your go.

## Key facts / paths / gotchas (carry these)
- **OPERATING POINT (vacuous-arm trap):** the census baseline MUST be `RR_APP_ENV=1` (mirrors the app's
  ~112 shipped default-ON reads). `RR_APP_ENV=0` is the no-env baseline and collapses reads (ref 97%→47%) —
  it is NOT what the app does. Both arms set `OCR_RENDER_DPI=200`.
- **Switch lever = SHELL ENV, not a DB write** (corrects the older memory). `ref_confusable_flag` /
  `name_role_nonname_flag` / `format_class_join` read at `handler.js:376/386/680`, OUTSIDE the three
  functions `realdoc_regression.js` `_appSpawnEnv` mirrors — so a DB settings write never reaches Python.
  Arm = `RR_APP_ENV=1` + the ONE switch's env var in the shell. A DARK switch is 'false' in the warm DB →
  the bridge never emits its env var → `appEnv` omits it → the shell value survives (no clobber). Full
  switch→env map: `handler.js` ~line 120-640.
- Reproduce: `TESTING/_measure/flip_corpus_20260912/CENSUS.md` has every command; `rr_ids_700.txt` = the
  400 test ids; consensus dumps are in the session scratchpad (synthetic values, not committed).
- KEY FINDING (unchanged): the shipped keyword + pad-window reads recover the EASY geometry failure, so
  the synthetic corpus is a SAFETY gate for the geometry fixes (M=0), and an EFFICACY gate only for the
  value-shape modes (156/159/format_class_join). Geometry efficacy stays on real exhibits + the live DB.
- Memory: `project_flip_corpus_pipeline_20260912.md` (updated tonight with both corrections).

## §Widen — the extra safety batch (partial; stopped to free CPU for Chris + the build)
2 of 7 completed before I stopped the batch (it was hogging CPU that the owner's explicit asks — Chris +
the plan — needed; the rest are geometry-inert safety runs, low value on the synthetic corpus):
- **template_pad_date_adopt (mig 143): PASS** — M=0, **1 correct date HEAL** (#279 `13-04-2020`→`23-04-2026`,
  a clipped date recovered), 0 new wrong files. A real efficacy fire on the corpus.
- **template_date_left_clip_grow: M=0, inert** (no fire on this corpus) — safety pass only.
- NOT run (deprioritised): template_code_read_widen, template_locate_role_qualifier,
  anchor_labelless_currency_refuse, template_fragment_containment_yield, type_uninstalled_heading_fold.
  Re-run any time with `bash TESTING/_measure/flip_corpus_20260912/widen_run.sh` (edit the switch list).

---

# PART 2 — "General doc filing" = QuickFile + Departments (the tomorrow deliverable)

**Your ask (2026-09-12, verbatim):** "a feature for general document management … submission and management
of docs that don't require OCR … departmental roles and … security gating." = the plan
`docs/designs/QUICKFILE_AND_DEPARTMENTS_PLAN_2026-09-12.md` (Oracle SIGN-OFF-W/COND Q-C1..12 + D-C1..12).

**Honest scope:** this is a TWO-SUBSYSTEM feature the plan itself lays out across ~15 slices — genuinely a
multi-day build, not a one-night job (especially D2's list-reader sweep, which must be COMPLETE to be safe —
a partial sweep leaks a restricted doc). Tonight I built the **safe, tested, self-contained foundation of
BOTH features, every slice DARK (seed OFF, in TEST_SWITCH_KEYS) + byte-identical OFF + pinned**, in the
Oracle's order, and stopped before the risky wiring. Nothing here changes the app until you flip the switch.

## Built tonight (7 commits, all DARK + pinned; c348df3 → 202456e)
1. **`c348df3` D-C6 security fix** — `accessService.gateEnabled()` now ignores `ACCESS_GATE_ENABLED` on a
   packaged build (a customer could previously env-var the doc read-gate OFF). Prerequisite for D2. Pinned.
2. **`e4c2d32` Q1 slice-1 `src/lib/fileKinds.js`** — the ONE shared file-extension policy (OCR/INTAKE/OPEN/
   NEVER_OPEN). Collapsed the two JS OCR-ext copies into it (byte-identical). Pinned (OPEN ∩ NEVER = ∅).
3. **`430428b` migrations 164/165** — departments + user_departments tables; documents.department_id (ON
   DELETE RESTRICT), department_set_by, intake, intake_notes; document_types.default_department_id +
   reading_mode; users.all_departments; doctype_grants.department_id (reserved). departments_enabled +
   direct_intake_enabled seeded OFF. Fresh-DB + FK smoke green. Byte-identical when empty.
4. **`19d2c59` Q-C1 learning exclusion** — `learningExcludedSql` gained the NON-SWITCHABLE
   `COALESCE(intake,'')<>'direct'` clause: a Quick File row never teaches (every learning reader), stays
   searchable. 92/92 pins incl. a behaviour proof.
5. **`40b58ea` directIntakeService.submit** — the Quick File core: type a company/date/title, file without
   OCR/Review/learning; refusal family, confirmed typed row, working_path NULL, source never touched. Pinned.
6. **`202456e` Departments enforcement core (D2 core)** — `canAccessDocument` department tag gate +
   `departmentService` (CRUD, membership, `visibleDocSql` list fragment, `setDocumentDepartment` widening
   rule). Pinned incl. a non-vacuous consistency pin. Inert/byte-identical on empty tables.
7. **`91486ee` Q1 cont.** — 4 Quick File presets (`reading_mode='none'`) + Q-C8 never-detect
   (process_docs excludes 'none' types from `known_type_names`) + previewService office-icon guard (Q-C6).
8. **`a597f9d` assign-time route gate (D-C1)** — `_validateAssignTarget` refuses routing a restricted doc
   to an outsider (human + system routes → `RECIPIENT_NO_ACCESS`); department-decision-only (no routing
   regression). Pinned.
9. **`4e89ba6` D2 read gate — search threaded + db-layer refactor** — extracted
   `database/modules/departmentVisibility.js` (pure, no cycle); `documents.search` gates on a threaded
   `viewer` (search + /v1 handlers pass it). The MAIN list surface is gated. Pinned (incl. fail-closed +
   byte-identical). ⚠ an un-threaded list reader now fails CLOSED (shared-only) once departments exist —
   which is exactly why the rest of the sweep must be finished before flip.

## What REMAINS (the finish path — in the plan's order)
- **D2 wiring (load-bearing, must be COMPLETE before any flip — an un-threaded reader now fails CLOSED to
  shared-only once departments exist, so it under-shows a member's own docs until threaded):** DONE so far
  = the assign-time route gate (`a597f9d`) + `documents.search` (`4e89ba6`). STILL TO THREAD
  `departmentVisibility.visibleDocSql(db, viewer, alias)` into: review+deferred queues+counts (take the
  actor), bin (`getDeletedQueue`), dashboard counts (`getFiledCounts`/get-dashboard-extra), type-ahead
  (`getFieldValueSuggestions`), export (`_buildDocQuery`, admin-only today), `getByIds`×3,
  `getConfirmedDocsByIds`, `getDocumentsForFieldValue`; the per-doc `canAccessDocument` gate on
  `_openResolvedDoc` (open-document-file/show-in-explorer, handler.js:2744) + `/v1 review/:id/viewing`; the
  9→1 count-broadcast collapse to a per-viewer `notifyCounts`. Pattern is set (see `4e89ba6`): add an
  optional `viewer`, append the fragment, thread the actor from the handler. eric's exact site list:
  `docs/designs/QUICKFILE_DEPARTMENTS_ERIC_ARCH_2026-09-12.md` §A.2.
- **Quick File UI DONE** (`26dfa19`): the ⚡ Home button (hidden unless `direct_intake_enabled`) + a
  self-contained modal (`src/windows/main/quickfile.js`) + `src/modules/directIntake/handler.js` (IPCs
  direct-intake-pick/doctypes/add-type/submit + the MAIN-side token map) + preload bridge, registered in
  main.js. Also fixed directIntakeService.submit → async awaiting commitDocument's real
  {success,filename,filePath} contract. **⚠ OWNER LIVE SMOKE (manual — the native file picker can't be
  automated):** Settings → set `direct_intake_enabled` true → the ⚡ button appears on Home → click →
  "Choose files" (pick a .docx/.xlsx) → add a Quick File type if prompted → File → confirm it lands in
  `Company/Year/Month/Type.Date.Title.ext` + is searchable + never entered Review.
- **Quick File rest:** update/replace/bulk + `document_versions`; the OOXML/PDF-text search extraction
  (Q2, `src/lib/ooxmlText.js` + `python_backend/render/pdf_text.py`) so office/PDF body text is searchable
  (today `ocr_text` = title + notes only).
- **Departments rest:** the taggers (insert/confirm defaults, D3), the Settings "Users & Departments" UI +
  the enable sentence (D4), the `{department}` folder token (D5).
- **Deferred by the plan (own Oracle pass):** Q7 `/v1` upload, drag-drop (Q-C12).

## To CONTINUE the build
Read the plan `docs/designs/QUICKFILE_AND_DEPARTMENTS_PLAN_2026-09-12.md` (§9 = the Oracle conditions, the
authority) + the eric arch doc (the file:line map). The services (`directIntakeService`, `departmentService`)
+ `accessService` are the seams everything wires into. `npm run test:pins` is the regression gate; each new
slice ships DARK + byte-identical-OFF + pinned. The migration numbers are used through 165.

---

# §Chris — sandboxed customer vet (2026-09-13)
Ran per your standing rules: an ISOLATED second instance (port 9223, its own userData + a COPY of Demo Docs
— never the live app/DB/Desktop), Chris free to break anything IN the sandbox, findings queued for you and
NOT implemented. He vetted the CURRENT shipping software (not the dark QuickFile/Departments work).
Full report: `docs/CHRIS_FULL_APP_REVIEW_2026-09-13.md`.

**VERDICT: YES — "I'd keep using it."** Filed 19 invoices exactly as promised (`Company/Year/Month/
Type.Date.Ref.pdf` + sidecar), moved the 20 originals to a Processed folder (none deleted), and **all 8
warnings told the truth** (truth-table in the doc). The practice run + the teach-one-→-17-ready payoff he
called the best onboarding he's seen. Everything stayed in the sandbox.

**7 NEW cards (none destructive — all CONFUSION/QUESTION/PREFERENCE), ranked; implement NONE without your go:**
1. **Phantom "check 1 field" flag** — the amber "1 field low confidence" banner shows even when all three
   fields read High 90/94/95% (clears only after a Reprocess). Trust-eroding. _This is the prior-round
   phantom-flag card: **BETTER-BUT** (fields now show %+bar) but the summary still disagrees._ (top harm)
2. **First-batch scare** — a brand-new supplier's first import shows "20 need a look" @63%; teaching ONE
   drops it to 2, but a new user first reads "it can't read anything." Suggests a "new supplier — check the
   first, I'll handle the rest" line.
3. **Can't approve your own Inbox doc** — no Approve/Reject on a self-sent approval, no explanation (likely a
   deliberate solo-office rule he couldn't test with a 2nd person).
4. **"Stamp it myself" not visibly offered** in the Send box (only "send to a colleague") — the self-stamp
   path was unreachable to him.
5. **"kept back 2" then 1 auto-filed** — the File-All promise ("2 kept back") vs the strip ("1 filed
   themselves" once the sender graduated) briefly mismatch; wants a "1 you'd kept back is now trusted" note.
6. **"all 1 document" / "document(s)"** grammar on the delete/restore/empty-bin dialogs (cosmetic).
7. **Awkward labels** — "Textiles's", "Recognised by", "Fields read by" (cosmetic).

**Prior-round verifies:** mailbox "Type —/Unknown" **FIXED**; phantom flag **BETTER-BUT** (card 1);
import-list-flip-after-manual-confirm **COULDN'T VERIFY** (he used the app's process-folder action, not the
picker → never watched the live import strip).

**Caveat (his humility):** automation-driven — he couldn't operate the Windows picker (so didn't watch the
live import strip; the wizard briefly kept its suggested folder before he pointed filing at the sandbox) and
couldn't test approve/reject or self-stamp with a second user. All 19 filed INSIDE the sandbox.

The sandbox is left running (port 9223, PID 25040) so you can poke it; the next /christest rebuilds it.
Full report: `docs/CHRIS_FULL_APP_REVIEW_2026-09-13.md`.
