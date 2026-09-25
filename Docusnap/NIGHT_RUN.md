# NIGHT RUN — the overnight test/check queue and its ledger

> **Owner convention (2026-08-30):** anything Claude thinks is worth TESTING or CHECKING goes into this file's QUEUE as
> it is noticed. When the owner says "going to bed", the newest `docs/designs/NIGHT_RUN_*.md` prompt runs. **Every
> night, when the run finishes, the session moves what it did into the DONE ledger with the result and a
> "repeat only if" condition — so no night repeats work unless it is needed.** Before planning a night, read the
> DONE ledger first. Keep entries one to three lines; detail lives in the linked report/handover.

## ✅ DONE 2026-09-24 NIGHT — QUICK RESCORE shipped to the sandbox · QUIET REDETECT built DARK (mig 216) + Oracle re-rule · CHRIS round + the owner-pre-authorised fix pass — `HANDOVER_2026-09-24_QUIET_REDETECT.md` + `docs/CHRIS_FULL_APP_REVIEW_2026-09-24.md`
- Quick rescore (Plan-B C4 re-ruled): a Quick pass lifts a stale low overall; gate exhibit 17 → 93, arm B 12/12 filed after graduation, live copy byte-identical.
- Quiet redetect (owner: "categorise everything, then confirms allow auto-file"): a type/override change re-reads the held unrecognised docs on the Quick road (gary+eric → Oracle A w/cond, B/C do-nothing); gate OFF identical / ON typed 3 of 4 (the 4th's type not added) + 16/17 quotes 31→93; born-digital relaxation re-ruled SIGN-OFF-W/COND.
- Chris (fresh sandbox 9226): 91/98 sorted themselves, 19/20 credit notes fixed by one keyword, 9 siblings filed after the 10th confirm, verdict yes. Fixed same night: untyped job ignores the lane-note family (7 leftovers), "Read it as a Statement" notice, fast-suggestion digit gate ("nanann"), redetect receipt toast + list refresh, copy/layout. Logged: near-identical sender names, tab rename/pill, "Set aside all" prompt, two statements typed Invoice, natural-language search.
- run-pins 429/429. Owner sandbox restarted on the final code with the switch persisted ON. NEEDS APPROVAL: push (12 commits), flip mig 216, card-5 design. Repeat if: the quiet lane's population queries, the catalog/override IPCs, or the redetect switch change.

## ✅ DONE 2026-09-23 NIGHT — the PADDLE CORROBORATION ARC: S0 geometry + C1 + traced exits + S1 slice integrity (mig 212) built DARK, C10 flip census MET, Chris teach-a-doc sandbox vet — `HANDOVER_2026-09-23_NIGHT.md` + `TESTING/_measure/release_c0_20260923/RESULT_C10.md`
Owner "go — build S1 word-snap and re-census", then "sandbox run the app with everything on, Chris FULL teach-a-doc
test + report; going to bed". 007+oscar design → Oracle SIGN OFF W/COND (C1-C14). Built: the taught-box CENTRE→top-left
frame fix + geometry follows the winner (`a0c25f2`), pad parity + PP floor 0.90 (`e28a9d6`), every hold exit traced
(`e08c7db` — the trace found 105 silent length abstains behind a "clean" census), S1 `slice_integrity.py` word-snap
(`005b22b`) → bare box first + Oracle C6 (`feaa1a4`) → value-text filter (`625ccc0`). **Six 727-doc arms;** final:
false holds 16→1, would-file lost 6→1, 3 catches kept, agree 419, true common-mode 0 → migs 207+212(+210) flip-ready.
Chris sandbox (all six 09-23 switches ON, CDP 9223, PID 30400, fresh DB, 1,475 Demo Docs): teach → 2 confirms → import
the rest, ≥4 suppliers, filed/held/wrong counts, comparison with 09-22/09-20/09-15/08-23 → `docs/CHRIS_FULL_APP_REVIEW_
2026-09-23.md`. **Repeat only if:** the hold's compare/geometry changes again (re-run `run_glyph_s1.sh` + `analyse_glyph_on.js`).
**09-24 BUILD:** the seven Oracle-ordered fixes committed (E1a/G3/E3/E2/E1b/R1/G1) + the G2 census; R1's 727+Hard-Set
gate + G1's 727 arms RUNNING (job tmp `gate/status.txt`); whole pin suite running. Chris DONE 23:18 + source-verified triage appended to the review doc (card 2 = the ISO-code currency prefix failing the legacy format-fail leg + `add-field` not broadcasting + a bare `flagged` reason; card 4 near-miss REFUTED by the predicate). OFF md5 identity DONE on Chris's 67 docs (14396ab vs HEAD, switches OFF, identical). **Owed (morning):** the 727-doc OFF identity + two ON runs byte-identical (the last C10 items) · push · the Chris vet queue (7 items, nothing built) · kill 9223.

## ✅ DONE 2026-09-22 NIGHT — PP-OCR CONFUSABLE FALLBACK built S0→S2 (DARK, mig 207) + FULL SECURITY REVIEW + CHRIS full vet — `TESTING/_measure/glyph_fallback_census_20260922/RESULT.md` + `docs/SECURITY_REVIEW_2026-09-22.md`
Autonomous (owner "going to bed, you are on auto"). **Pushed** through `bcbd7be`; pins **413/413 green**.
**THE FEATURE (owner's `1G25802868` misread → "Tesseract is the bottleneck"):** measured PP-OCR (en_PP-OCRv3 rec, ONNX)
beats Tesseract on the exact confusable slices (86%→95%); gary/oscar→Oracle **SEND BACK→RE-RULE SIGN-OFF-W/COND** on
the corrected live Print Tracker exhibit (the flag door is blind to a leading/interior letter-for-digit; p7 `RFH0738865`
O→0 conf-76 is a SILENT misfile no cheaper lever catches). Built DARK **glyph_fallback_enabled (mig 207)**: S0 the
deterministic rec-only engine `ocr/glyph_reader.py` (222/222 parity, two-process byte-identical, runs under vendor/python,
vendored 8.97MB model `ocr/models/rec.onnx` Apache-2.0) → S1 the PP-vs-Tesseract DISAGREEMENT hold in engine.py (review-
bound, neutral note, C1 never a corrob candidate) → S2 census: refined the trigger to **single-glyph swaps** (alnum +
same-length + one-position) after the raw census showed 14% false-holds; final **safety PASS** (wouldFile(ON)⊆wouldFile(OFF),
0 value changes, false-hold **0.2%**) + **efficacy 2/2** on the owner's real doc (p7+p11), 0 false-holds. Pins:
`test_glyph_reader.py` + `test_glyph_disagreement_hold.py`. **FLIP = owner's call** (gate met; needs the owner's go +
onnxruntime vendored into the shipped build). **SECURITY REVIEW** (owner ask): no new Crit/High code vulns; top = admin
2FA optional (H1) + unsigned installer (H2) + backend MySQL unencrypted PII (M1) + desktop SQLite plaintext OCR text (M2);
full report `docs/SECURITY_REVIEW_2026-09-22.md`. **CHRIS** full-app vet running in sandbox 9223 at wrap (report appended
+ triaged on return). **Repeat only if:** the flip census must be re-run on a warm DB carrying the owner's REAL Print
Tracker template before any customer default.

## ✅ DONE 2026-09-21 NIGHT — DARK-SWITCH BATCH CENSUS (0 flips, batch M=0) + CHRIS QUICK FILE DAYCARE VET (F1 bug fixed) — `handover.md` + `TESTING/_measure/flip_census_20260921/RESULT.md`
Autonomous run (owner "going to bed, you are on auto"). **Committed LOCAL, NOT pushed.** Final pins **409/409 green**.
**TASK 0:** committed the graphical folder-tabs (`436af88`). **TASK A — batch census** at HEAD (mig 198), migrated
700-corpus copy (400 test docs, `RR_APP_ENV=1`, shell-env lever): two UNION arms (37-switch HEAL, 3-switch FRICTION) +
per-switch isolation of the two firing switches. **Batch M=0** (HEAL 6 GT-correct ref/date heals + 1 correct new
auto-file; FRICTION 7 held→filed all ref+date correct, 0 wrong). Isolated `template_code_read_widen` (mig 141)
M=0/4 heals + `template_edge_clip_heal` (mig 151) M=0/1 heal. **0 FLIPS** — each firing switch's OWN named flip gate
needs the **605 REAL corpus + a pixel-adjudicated adversarial fire census** (Oracle C1-C7 for mig 151; mig 141 has no
Oracle *flip* sign-off), which a synthetic 400-doc M=0 does not discharge → logged as flip-ready-candidates (auto-
flipping would skip the advisor/Oracle gate = approval-class; mirrors the 09-12 "logged for morning" precedent). Ledger
`docs/DARK_SWITCH_LEDGER.md` refreshed (09-19→21 flips, migs 187-191/193). **TASK B — Chris daycare Quick File vet**
(`/christest` sandbox 9223) → `docs/CHRIS_QUICKFILE_VET_2026-09-21.md`. **F1 🔴 = a REAL bug FIXED** (`124e5a2`): the
auto-fill typeahead crashed on every keystroke (`appendChild(null)`) for any Records list with no/blank disambiguator
— `quickfileView.js` `el()` lacked the null-kid guard its twin `lookupAdmin.js` has (Oracle SIGN-OFF-W/COND; twin-parity
pin). F2 = seed artifact (LOG). F3/F4/F5/F6 deferred to owner (F6 the multi-doc green "ready" dot is a **flip-blocker**
for `quickfile_multidoc_enabled`; F1 activates F5). **Repeat only if:** a census re-runs after an extraction change
(M must stay 0). **Owed (morning):** push · the 605/Oracle gate for mig 141+151 before any flip · the F1 live in-app
re-drive (needs the sandbox login) · F3/F4/F5/F6 owner decisions.

## ✅ DONE 2026-09-19 NIGHT — FLIP-CENSUS BATCH (4 switches graduated) + Castellan Slice 1 shipped + Slice 2 SENT BACK
Owner-driven day rolled into an autonomous night. **Shipped (LOCAL; flips pushed through `39456fe`):**
(1) **Castellan Slice 1 — mig 186 `taught_ref_disagree_suppress` DARK** (`14581c7`… no — see the day commits): a taught
ref field that matches its scope's learned shape suppresses a different-shape generic-caption competitor ("Job Ref")
so the worksheet files by graduation instead of holding forever (gary → Oracle SIGN-OFF-W/COND; the `suppressed_taught_role`
sink + a `_corrobLicensed` guard; pinned). (2) **FLIP CENSUS** (`TESTING/_measure/flip_census_20260919/RESULT.md`,
400-doc corpus): **154 `trust_ref_role_shape` + 157 `template_drift_override_guard`** (M=0; live-proven) → **flipped migs
187/188**; **158 `note_topic_dedup` + 130 `reread_hold_corrob_release`** (byte-identical/M=0, low-risk) → **flipped migs
189/190**. All delisted (TEST_SWITCH_KEYS → 45), pinned (`test_default_flip_187_188.js` / `_189_190.js`), 4 graduated
mig-pins updated. `confusion_precedence` HELD (value-changing, zero corpus evidence). Corpus now EXHAUSTED for the
remaining switches (safety-only). (3) **Castellan Slice 2 (zero-confirm) — gary designed → Oracle SEND BACK**: 2a targets
the WRONG blocker (at cold-start the no-history `docTrustGate` refusal holds the first doc, not the disagreement 2a
removes; and 2a would drop a same-shape hold Slice 1 keeps). NOT BUILT. **Owner reframe needed** — the real cold-start
lever is the no-history/graduation gate (page-wide, approval-class), not caption suppression. Slice 2b (a persisted
exclusion table) stays deferred. **FINDING for the owner:** `trust_ref_role_shape` (now default-ON) + `role_field_dominant_class`
together are STRICTER on an outlier-collapsed ref scope (holds for review — safe, would-file unchanged on the corpus);
design Q: should shape-verify defer to role-dominant there? (pinned in `test_role_dominant_class.js`).
**Repeat only if:** a census re-runs after an extraction change (M must stay 0). Chris DEFERRED to a morning /christest.

## ✅ DONE 2026-09-19 DAY — DEPARTMENTS AUDIT-DEBT closed + C12 Rejoin shipped + TEST build for the VM
Committed LOCAL (owner's call to push). **`178d93a`** the Oracle #5 audit-debt: gated every remaining by-id
serve/mutate handler + the ON-by-default scope sweep + the classFix/charset/supplierSiblings fan-out leaks
(eric+gary → Oracle SEND-BACK → C-A…C-F; two "off by default" premises were false — the switches were ON). Coverage
+ 13-section red-team pins; byte-identical when departments off; **0 regressions**. **`71e6705`** C12 "Join with page N"
(barry+eric+gary → Oracle SIGN-OFF-W/COND; `pdf_join.py` + 2 IPCs + the Review button; Shape B; never auto-files) —
this SATISFIES the mig-180 flip's C12 condition. Full battery green (modules 97/97, services 45/45, database 169/169).
TEST installers (all switches armed) built for the owner's VM. **STILL OWED before the mig-180 flip:** the C9 census
cells + the manual e2e, re-run WITH C12 present. Repeat: NO (shipped) — the R1 census batch above is still queued.

## ✅ DONE 2026-09-18 NIGHT — DEPARTMENTS WATERTIGHT HARDENING (security holes found + fixed) + Chris security vet (`HANDOVER_2026-09-18_NIGHT.md`)
Owner pivoted the night: "Chris to fully test the department work … make sure it is WATER TIGHT … [thoughts on a
2-ledger check]?" + "run anything useful. Goodnight." **The queued flip-census batch (`docs/designs/NIGHT_RUN_2026-09-17.md`)
was DEFERRED** (security was the priority + the box OOM'd twice) — still queued, not lost. Result: gary + eric
(independent) → **Oracle SIGN-OFF-W/COND** found by-id SERVE/MUTATE paths that skipped the department gate
(`reprocess-document`, `split-pdf` + its untagged-child laundering, desktop `confirm-review`, the `/v1`
mutation cluster + `viewing`, the workflow-assign SENDER self-grant, `sweep-inview-*`, fail-OPEN catches) —
the "unauthorised access = disaster" class. **ALL FIXED** (Oracle before-flip minimum #1–#6), byte-identical
when no departments exist, proven by a 22-check red-team pin + a coverage-lock pin, **0 regressions across 310
pins**. **Chris** black-box adversarial vet (sandbox 9223) → **ZERO leaks, watertight** (search/counts/bin/export/
open-by-ID all refused for the wrong user). Owner's 2-ledger idea = unsound as stated; right version = an
independent egress re-check (fast-follow). Commits LOCAL/UNPUSHED (owner's call). **OWED before the flip:** the
batch/bulk by-id handler audit (Oracle #5 — list in the handover). Design `docs/designs/DEPARTMENTS_HARDENING_2026-09-18.md`.
**Repeat only if:** a new by-id serve/mutate endpoint is added (the coverage pin red-bars it) — re-run the two
department serve pins after any change to the api/processing/review handlers or the department gate.

## ✅ DONE 2026-09-15/16 NIGHT — FIVE YOUTUBE TUTORIAL VIDEOS recorded automatically (owner: "use the night run to make useful instructional videos… Goodnight mr claude") — `HANDOVER_2026-09-16_VIDEOS.md`
Autonomous run. **Deliverable = `Desktop\Tutorials\`**: `first-run-setup` (4:00, licence screen + account + recovery
code + terms + every wizard choice with its reason) · `teach-a-document` (2:40) · `import-a-folder` (1:35) ·
`review-and-confirm` (1:40) · `search-for-a-document` (1:10), each with `.narration.json` (timestamped lines for the
TTS pass) + `.captions.srt`, plus `tts_manifest.json` (learning order) + `README.md`. Recorded on a sandboxed dev
copy at the neutral `C:\ScanFinderDemo` (demo admin, 9 demo invoices); the licence screen was filmed via a local
fake licence server (config swap self-restoring; `git status config` clean). Tooling grew: `drag`/`eval_js`/`at`
actions, backdrop window, `record.py` (profile · fake-licence segment · join · publish). Frames of every video were
inspected (backdrop, no personal paths, correct read-backs, confirm really filed). **Repeat only if:** a UI change
breaks a script (`--dry-run --verify`), or the owner wants re-takes (optional: search video after review so results
show "filed" rather than "Needs Review").

## ✅ DONE 2026-09-15 NIGHT — Chris A+B on connect/teach/QuickFile + safe fix pass + 2 security fixes + S4 upload-to-teach (owner: "please do all if possible. Goodnight") — `HANDOVER_2026-09-15_NIGHT.md`
Autonomous run. **5 commits, ALL LOCAL/UNPUSHED; full pin gate 371/371 GREEN.** (1) **Chris ROUND A ×2** (this
session's + the prior session's Chris, which completed tonight) — both **YES**, both verified teach + Quick File
file on the main PC's disk; **both flagged `0.0.0.0`-as-the-address as the #1 connect blocker.** (2) **Safe fix pass
`edc1c03`**: Quick File misfile clear (round-A card 1), connect address `0.0.0.0`→real LAN IPv4 SANs
(`managedCertStatus.host` was the raw bind host), "ID code" naming to match the client's cert-check, friendly
connect errors + softer CA jargon. (3) **Security, both DARK (byte-identical OFF), pinned**: `11e1cc3` backup
fabricated-fingerprint (Chris card 7; gary; switch `backup_import_seat_only`; pin 10/10) + `58224b3` /v1
temp-password A1 (eric; switch `v1_force_password_change`; test_v1_auth pins). (4) **S4 upload-to-teach `354c23d`
DARK** (`POST /v1/teach/stage`, Oracle C8-C14; pins 81/81). (5) **`3680486` jsQR license entry**. **Chris ROUND B**
(reload-verify the fix pass): all 4 fixes LANDED, no new breakage (connect address→real LAN IPs, "ID code" both
sides, plainer connect errors live-tested; Quick File clear source-verified — a live submit couldn't be driven). Deferred (queued below): teach read-back reset + page-jump,
doc-picker /v1 thumbs, Quick File undo/live-count, cert "Needs re-issue" action, dead-provider tidy, D2 sweep.
**Repeat only if:** never as-is. The morning owner queue (push · flip the 2 security switches + teach_over_client ·
rebuild the TEST pair · a LIVE S4 end-to-end test · the DARK flip gates 166/167/159/156/143) is the handover's
NEEDS YOUR APPROVAL.

## ✅ DONE 2026-09-13 LATE NIGHT — CLIENT SEARCH POP-OUT PROVEN ON REAL CORE CODE + ALL PINS GREEN + CHRIS ON THE NEW SURFACES (`docs/designs/NIGHT_RUN_2026-09-13_LATE.md`; `HANDOVER_2026-09-13_LATE.md` ADDENDUM)
Owner: "a night run of your choosing". (1) **Red-pin hygiene → `npm run test:pins` 360/360 GREEN** (first all-green run):
`render/pdf_find.py` added to the compile gate's SPAWN_ENTRIES (a REAL packaging-gate gap — it is spawned by the desktop
find and the /v1 find), the TEST_SWITCH_KEYS count pins 49→50 (mig 166 present), the activity-strip pin allows the Quick-
check send-back door. (2) **First-paint confidence pips FIXED** in the shared search UI (`SearchResults.redecorate()` once
the entitlement is known; pinned: no second search). (3) **THE OWNER'S "search window doesn't open" — proven OK on REAL
core code:** a sandbox dev core (`TEST_BUILD=1`, real `/v1` on 8797) + the REAL client driven over CDP — **20/20** across
refusal-before-sign-in / open / rows / theme sync / logout closes it / a CORE RESTART under a signed-in client (the stale
token closes the pop-out + signs out — now WITH a message: `5195bfa`) / read-only user (`TESTING/_measure/night_20260913/
POPOUT_REAL_CORE.md` + the driver scripts). Likeliest reading of the owner's report = that stale-session path (the main
session restarted the core twice mid-test); morning question: did the client show its login screen again? (4) **Chris**
(sandboxed, BOTH apps, CDP 9223/9226) → `docs/CHRIS_FULL_APP_REVIEW_2026-09-14.md` + triage: verdict YES; the pop-out
opened 4/4 for him; **8 cards — top = the `/v1` purge leaves the filed PDF + xml on disk (PRE-EXISTING: the /v1 lane never
got the 2026-08-13 desktop purge fix; APPROVAL-CLASS destructive path)**, the client bin view "won't let go" (no push channel
→ stale pane; deep-links land in bin mode), client Quick File lists no types (presets not offered over /v1), can-stamp not
re-read while a window is open, client Home counts approved routes, read-only FYI items have no "Got it", stamp history
prints the UTC hour, window/dialog titles. NOTHING from the cards implemented. Commits `8b374ce` `5195bfa` `593335f` +
docs, all PUSHED. Sandbox left RUNNING (core CDP 9223 / client CDP 9226, scratchpad `night-sandbox`). **Repeat only if:**
the real-core drive (`drive_popout_real.js` phases 1-3) after ANY change to the client main/preload/adapter or the /v1 auth
path; Chris again only on the surfaces the cards change.

## ✅ DONE 2026-09-12/13 NIGHT — FLIP-CORPUS CENSUSES + QUICKFILE/DEPARTMENTS FOUNDATION + CHRIS (`HANDOVER_2026-09-13_NIGHT.md`)
Two owner directives across the night. **(1) Flip-corpus** ("kick off the night run"): built the failure-mode
injectors (`gen_customer_test.py --inject`, 3 value-shape modes, all proven firing, pin `test_inject_shapes.py`),
scaled to a 700-doc warm corpus (`Desktop\Flip Corpus 700\warm_700.db`, SOUND at RR_APP_ENV=1: ref 97%/date
99%/179-of-400 auto-file), ran censuses: **mig 159 ref_confusable + mig 156 name_role_nonname PASS (M=0 +
fire + file→hold) = flip-ready**; format_class_join M=0 but a blast-radius finding (HOLD); 154/157 safety-pass
(live efficacy done 09-10); widen partial (**mig 143 pad_date_adopt PASS**, 1 date heal). Report
`TESTING/_measure/flip_corpus_20260912/CENSUS.md`; ledger updated. **CORRECTED two load-bearing facts:** baseline
MUST be RR_APP_ENV=1 (RR_APP_ENV=0 = vacuous-arm trap, ref→47%); the 3 switches' lever is SHELL ENV not a DB
write (read outside the mirrored `_appSpawnEnv` functions). **(2) QuickFile+Departments** ("general doc filing
… fully implemented + tested tomorrow"): built the safe, tested, DARK+byte-identical-OFF+pinned FOUNDATION of
both features (7 commits `c348df3`→`202456e`: D-C6 security fix, `fileKinds.js`, migs 164/165, Q-C1 non-switchable
learning exclusion, `directIntakeService.submit`, Departments enforcement core). Honest scope: a ~15-slice
multi-day feature — the D2 list-reader SWEEP (must be COMPLETE to be safe) + the UIs remain (finish path mapped
in the handover PART 2). **(3) Chris** sandboxed vet (port 9223) — report `docs/CHRIS_FULL_APP_REVIEW_2026-09-13.md`.
`npm run test:pins` green after fixing the two TEST_SWITCH_KEYS count pins (47→49); test_activity_strip stays the
1 pre-existing red. **~24 commits LOCAL, none pushed.** Owner queue = the handover's NEEDS YOUR APPROVAL (flip
156/159/143 · push · format_class_join decision · continue the QuickFile build · Chris cards). **Repeat only if:**
never as-is; the censuses re-run only after an extraction change (M must stay 0); the QuickFile build CONTINUES
(not repeats) from PART 2's finish path.

## ✅ DONE 2026-09-10 NIGHT — FLIP-GATE MEASUREMENTS + NOTE-COMPOSITION (`docs/designs/NIGHT_RUN_2026-09-10.md`; `HANDOVER_2026-09-11.md`)
The day built six DARK arcs (mig 152-157 + a note reword, all Oracle-gated, LOCAL/unpushed). Night ran their
flip-gate MEASUREMENTS on a copy of the owner's LIVE DB (read-only reprocess, no writes; `TESTING/_measure/
night_20260910/GATE_RESULTS.md`): **all three live arcs M=0** (no new silent auto-file on the owner's real docs).
(1) **mig 157 drift-override** — 19 Vellum sales orders: ONLY #243 changed `CH1 2HU`→`Larch & Hollow Cafe Co`
(the correction), 18 byte-identical, 0 new auto-files. (2) **mig 156 non-name** — flags ONLY #243's postcode,
spares all 18 real company names (0 false positives; only REMOVES an auto-file). (3) **mig 154 ref-role** — 21
Thornbury invoices: 0 changes, 0 regressions. (4) **NOTE-COMPOSITION de-dup** (owner "very wordy message"):
gary+Oracle SIGN-OFF-W/COND — the wall is a cross-run JS blind-append artifact (handler.js:1664 + rereadHolds.js:135);
a topic-aware `composeNote` keeps the higher-rank lane-hold, drops the redundant advisory; trust.js keys on
note PRESENCE not marks → auto-file-safe; built DARK `note_topic_dedup` mig 158. Also `7bbf48f` reworded the
filing-sanity soften note concise. Repeat only if: after any note-writer/OCR change, re-run the 3 arc gates
(M MUST stay 0) + the note-dedup exhibit pin. **Owner-owed (morning):** the flips + push + the per-arc 605 M=0
/ census. Chris NOT run this night (session length) — queued.

## ✅ DONE 2026-09-09 NIGHT — DETECTION ANOMALY HUNT (`docs/designs/NIGHT_RUN_2026-09-09.md`; `HANDOVER_2026-09-10.md`)
Ran the detection-anomaly plan on HEAD `4bb2efd` (auto; agents free; nothing built — approval-class logged).
Results: (1) **123-doc anomaly sweep → found M (silent wrong date auto-file)**: Copperfield sales_order #77/#78
read the wrong date (leading-day-digit CLIP from `teach_angle_compose_scan` box shift), high conf, no flag →
would auto-file. **#78 real @200 DPI (M=1 new install), both @300 (M=2 older install).** 007 root-caused +
fix-designed (`docs/designs/DATE_LEFT_CLIP_M2_2026-09-09.md`) — the role-disagreement refusal is bypassed at
overall==100. Everything else read 100%. (2) **Arc A flip census → DON'T FLIP** (vacuous: its 1 target #45 is
held by `trust_role_disagreement_refuse` anyway; `A_CENSUS_RESULT.md`). (3) **Born-digital lead → DEAD END for a
fix** (gary: `bd` = armed not detected; gate is correct; add an Oakhaven test-arm only). (4) Chris **deferred**
to a morning `/christest` (OCR contention + crash class). Artifacts: `TESTING/_measure/night_20260909/`.
Repeat only if: the sweep is re-run after a detection change (watch M — it MUST be 0); re-run A's census only
after the disagree-gate interaction changes.
**LATE (owner authorised gated implementation + "streamline import-after-teach"):** (5) **Hard Set cold BOTH
arms 0/0** (400 adversarial docs, 0 silent misfile — no regression). (6) **CALIBRATION**: ~10% of held docs read
correctly but are held — top = a verified auto-file/UI ASYMMETRY (the stale "couldn't match saved layout" note
holds perfect docs from auto-file while the renderer suppresses it; `CALIBRATION_FINDING.md`) → morning fix.
(7) **IMPORT-AFTER-TEACH streamline** (barry+gary+Oracle): the propagation lane ALREADY exists + is ON + auto-
files at threshold 90 — the **tesseract crash wedges it**. **BUILT Slice 0** (SetErrorMode + per-call timeout,
Oracle SIGN-OFF-W/COND, pin 12/12, byte-identical no-regression, commit `0aa5225` LOCAL) = the unblocker. Slice 1
(one-click re-read) DESIGNED+LOGGED (the via-seam not rushed). (8) M=2 narrow fix de-risked by a strict-gate A/B
(catches #78, the narrow variant avoids the broad gate's 8 false holds). All night doc commits LOCAL/unpushed.
Repeat only if: after any OCR-layer change, re-run the byte-identical sweep + Hard Set (M/misfile MUST stay 0).

## ✅ DONE 2026-09-08 NIGHT (see the DONE ledger + `HANDOVER_2026-09-09.md`) — was: `docs/designs/NIGHT_RUN_2026-09-08_NIGHT.md`** (start it on "going to bed"): 1 triage the 17 pre-existing red pins (`test_failure_creates_holding_row` FIRST) · 2 `--smoke-windows` + ONE rebuild at the end · 3 the Oracle's before-flip/census prerequisites (name-band real-page pin, tautological pins, `RR_ALLOW_ARMED` + C9) · 4 the heading-fold ARM over the 605 corpus + Hard Set · 5 read-only diagnoses + advisor designs for Chris's vet queue · 6 Chris round 2 on the unexercised surfaces (sandboxed) · 7 client/cert-tool `npm install` smoke. Approval-class items logged, not run. (Previous TONIGHT = ✅ DONE 2026-09-01 NIGHT, see the ledger.)
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
- **2026-09-25 · [FLIP GATE for mig 217 `type_owner_uninstalled_block` — BUILT DARK the same day]** (1) realdoc
  `stress_test/realdoc_regression.js` at `RR_APP_ENV=1 OCR_RENDER_DPI=200`: OFF arm (`TYPE_OWNER_UNINSTALLED_BLOCK=0`)
  md5-identical to the pre-change tree (`7057b87`) — expected vacuous (the text census proved the engine identical on
  958 texts) — and ON arm M=0, zero per-field drop, type diffs ⊆ uninstalled-title docs; Chris's copy as the efficacy
  arm ({46, 52} → untyped + detected Statement; wouldFile(ON) ⊆ wouldFile(OFF)). (2) Oracle C9: add the Hard Set
  `statement_layout` class to `stress_test/gen_hard_set.py` (type-first column straight + 1.5° skew, subhead_invoice,
  remittance_advice) + CONTROLS (a skewed INVOICE with a standalone "Statement" sub-head; an INVOICE with "Purchase
  Order 45678" with PO uninstalled — both GT invoice) and teach `score_hard_set.js` that an uninstalled GT type scores
  correct as untyped + `detected_type_name == GT` (also fixes balance_bf / sib_statement scoring); gate: digital + scan,
  OFF/ON, wrong + would-file 0, controls clean. (3) C4 separation arms recorded in
  `TESTING/_measure/type_owner_block_20260925/RESULT.md`. Then back to the Oracle with the numbers → owner flip.
- **2026-09-25 · [FLIP GATE for mig 218 `issuer_sibling_dominant_hold` — BUILT DARK the same day]** census MET
  (`TESTING/_measure/sibling_dominant_census_20260925/RESULT.md`: Chris copy exactly {62, 69}, replay 0; the owner's
  live copy 0/0). Owed: (1) one live CLIENT confirm of Chris's doc 69 against a core with the switch armed → the 400
  toast reads the server's self-sufficient text (Oracle C4; the client Use/Keep pair = `pendingfeatures.md` card);
  (2) a Chris round on a fresh sandbox with the switch armed: confirm 69 FIRST → held with the "18 others" sentence →
  Use → ONE folder; File All → 18; 62 → sub-run hold → Use; then the Oracle with the numbers → owner flip.
- **2026-09-25 · [DESIGNS SIGNED → BOTH BUILT DARK] card 5 sender split → `docs/designs/SIBLING_DOMINANT_HOLD_2026-09-25.md`
  (Oracle C1-C8; C1 teach-ask + C2 confirmed-siblings BLOCKING; census C5 = hand-adjudicated FALSE = 0 on Chris's copy /
  727 / 605) · Ironclad → `docs/designs/TYPE_OWNER_UNINSTALLED_BLOCK_2026-09-25.md` (Oracle C1-C10; C1 alias exclusion
  BLOCKING; C3 red-first fold twin; C4 separation arms OFF/ON; C9 Hard Set `statement_layout` = FLIP gate). Both DARK
  when built; next mig = 217. The entry below is the pre-design diagnosis, kept for the mechanism.**
- **2026-09-25 · [TYPE, herald-diagnosed → gary → Oracle SIGNED above] the two Ironclad statements typed INVOICE**
  (Chris 09-24 one-liner; docs 46/52 in his sandbox) = `TYPE_TITLE_OWNER_PRECEDENCE` (keyword.py ~1214-1236, ON
  since mig 60) promoting a lone `Invoice` TABLE CELL that lands alone on reading line 15 (= `_HEADING_TOP_BAND_LINES`,
  `<=`) on the two SKEWED pages (+1.5°/+1.4° shear splits every row), while the folded UNINSTALLED `STATEMENT` heading
  (read perfectly, line 0, sum Stmt 7.3 > Inv 4.3) can never count as an owner (`known_types` only). Confident WRONG
  type (`heading=True` → `title_trusted`). SYSTEM: a straight statement with the type column FIRST is stolen the same
  way (synthetic, measured). Census: Chris-200 OFF→ON = exactly {46, 52}; owner copies 0. Fix direction = Option B: a
  folded heading-only name that stands alone as a strict top-band heading counts as a BLOCKING owner (two owners →
  untouched → the sum wins → untyped + "Add Statement" nudge); never promotes an uninstalled name (keeps
  `test_teach_side_gates.py` typeowner pins). Gate: typeowner pins + a "blocks, never promotes" pin · Chris-200 text
  census = exactly {46,52} · realdoc M=0 at `RR_APP_ENV=1` · **a Hard Set statement/remittance class must be ADDED**
  (skewed + type-first-column variants) — it does not exist. Probes: `%USERPROFILE%\.claude\jobs\68b38f39\tmp\herald\`
  (`score_matrix.py`, `census2.py`, `synth.py`; job-mortal). Open: did the 09-06 fold census run with owner-prec ON?
- **2026-09-25 · [Stage 1, Oracle C6, DARK arc] `KEYWORD_LABEL_TAIL_BOUND`** — a multi-word label whose last word
  is alphabetic gets `(?![a-z])` (mirror `LIST_CAPTION_TAIL_BOUND`, keyword.py ~2117) so "Credit No" stops
  prefix-hitting "CREDIT NOTE" and "Delivery No" its own "DELIVERY NOTE" heading (the card-4 class; the digit gate
  catches only the digit-less walks — "Unit 12, Low Lane" under a heading hit still commits @80 while the real ref
  lower down is never read: HYPOTHESIS, unmeasured). Ships ALONE: (i) a label-hit census over the 605 cached texts
  listing every scalar hit the bound would refuse (eyeballed), (ii) realdoc M=0 + zero per-field drop, (iii) Hard Set
  P==K==N. Separately (data-only, new ticks): reorder the Delivery Note / Credit Note preset labels so the colliding
  short form is not first (document_types.js ~666/~686).
- **2026-09-23 · [mig 210 flip gate] `glyph_confusable_resolve` realdoc OFF-vs-ON** — built DARK (12 pins green; D5
  live-confirmed 40/40 AGREE on the Print Tracker diag). Owed before any flip: the 605 realdoc at `RR_APP_ENV=1` with
  `GLYPH_FALLBACK_ENABLED=1` ON-vs-`GLYPH_CONFUSABLE_RESOLVE` OFF/ON → every field byte-identical EXCEPT the soften
  note's text on PP-agree rows (count them = the efficacy denominator); 0 value/conf/method diffs. Same onnxruntime +
  model vendoring gate as mig 207. Seams for the future RELEASE leg: `docs/designs/CONFUSABLE_RELEASE_SEAMS_2026-09-23.md`.
- **2026-09-23 · [mig 211 flip gate — Oracle C10] `glyph_confusable_release`** — built DARK (19 Python + 1 JS pin).
  C0 DONE (`TESTING/_measure/release_c0_20260923/RESULT.md`): yield 1 of 9 soften docs on the owner's 727 — keep DARK,
  no flip on this alone. Run C10 ONLY if the owner wants the first-docs-after-teaching friction removed: realdoc OFF-vs-ON at RR_APP_ENV=1 with
  `GLYPH_FALLBACK_ENABLED=1 GLYPH_CONFUSABLE_RESOLVE=1` in BOTH arms, `GLYPH_CONFUSABLE_RELEASE` 0/1: M=0, zero per-field
  drop, wouldFile(ON) − wouldFile(OFF) ⊆ {glyph_release released}, every released-but-unfiled doc has a logged reason,
  every NEW file pixel-adjudicated, classify (a) already ≥ floor / (b) fc lift / (c) boost-only, the abstain-reason
  histogram (`glyph_release` traces need `--trace`), two ON runs byte-identical. Then back to the Oracle with numbers.
- **2026-09-15 · [S4, owner-machine] LIVE end-to-end test of teach-over-client upload-to-teach** — built DARK
  `354c23d`, pins 81/81, but not driven live (S4 is a client main-process change → needs a client restart; Chris
  could only reload renderers). After flipping `teach_over_client_enabled='true'`: from the client, Import a
  document to teach (`btn-import-teach` → `/v1/teach/stage`), confirm it lands `needs_review` on the core (NOT
  filed even for a graduated scope), teach it, confirm it files. Watch the in-flight cap (a 2nd concurrent stage →
  429) + temp cleanup + the 40-page pre-probe cap.
- **2026-09-15 · [Chris cards, owner-vet] the deferred round-A UX findings** (not built): teach read-back not
  cleared on field advance (shows the previous field's value + a false "doesn't read like a date" — BOTH Chris
  runs; delicate in the 2318-line shared `teach-ui/teach.js`, needs sync + a drift-pin look); teach page-jump when
  the instruction panel resizes the doc pane; doc-picker thumbnails blank over /v1; Quick File undo + a live
  Review/filed count refresh after a client action; cert "Needs re-issue" → a one-press "Update the certificate"
  action; the 32-block ID-code compare (nudge the QR route, keep the check).
- **2026-09-15 · [tidy, pin-entangled] dead inline-workflow-provider removal** — `searchWorkflow.js` `_provide` +
  `_historyBlock`/`_routedBanner`/`_decisionBar`/`_assignForm` are DEAD since `9c50b93` (SearchActions dropped the
  provider render loop; those surfaces live in `searchStamp.js`). Cosmetic; NOT a snip — `test_focus_repair.js`
  PINS the string `_focus(note)` which lives inside the dead `_decisionBar`, and it's shared→client-synced. Do it
  deliberately, updating that pin + running `sync-client-search.js`.
- **2026-09-09 · [owner, security] Backup restore accepted a FABRICATED device fingerprint** on an un-licensed machine (Chris card 7) — verify `backupService` anti-trial-stacking device-binding gate. AND harden the `christest` skill brief (hand Chris the explicit sandbox DB path; mark `%APPDATA%\ScanFinder` = the owner's LIVE app, OFF LIMITS — tonight Chris read it read-only by misidentification, no writes).
- **2026-09-09 · [owner] client/cert-tool E44 upgrade INCOMPLETE** — npm install updated the graph (0 vulns) + code smoke clean under core E44, but the electron BINARY download is allow-scripts-gated (no `node_modules/electron/dist`). Approve the postinstall + reinstall + launch-smoke from each dir + commit both package-locks.
- **2026-09-09 · [build, one-line] `test_settings_wiring` allowlisted the orphaned stamp-placement ids** — the dead stamp code (`renderer.js` initStampPlacement + the 3 fns) + leftover CSS should be DELETED from settings (removed panel, 2026-08-28 redesign; unreachable/guarded). Then drop the allowlist entries.
- **✅ DONE 2026-09-08 NIGHT (commit 5db333e, see ledger) — 17 PRE-EXISTING red JS pins.** ALL 17 reproduce byte-for-byte at the pre-session baseline `eeb8d56` (scratch worktree + node_modules junction) — NOT today's regressions. Five are the known hand-rolled-schema class (`no column named ocr_recipe` ×4: test_detected_type_nudge / test_page_count / test_recycle_bin / test_purge_and_bin_truth; `charset_flag_meta`: test_accept_correction — sync the fixture schema to migs 102/104); the other 12 need a look each: test_authoritative_anchor (2), test_v1_contract (`reading '0'`), test_failure_creates_holding_row (7 checks — 'the failure-row producer regressed' — VET FIRST, may be a real regression older than today), test_scope_auto_accept (`app.getPath` under RUN_AS_NODE), test_activity_actions_columns, test_activity_strip (4), test_deskew_session, test_teach_speaks ('one shared speaker'), test_settings_wiring, test_doctype_surface_parity, test_teach_fragment_name_guard, test_teach_multipage. Log `TESTING/_measure/run_pins_20260908.log`. Repeat if: after each triage, `npm run test:pins` must go 325/325.
- **2026-09-08 · [QUARTERLY, owner/build machine] vendor/python CVE review against `python_backend/requirements.lock`** — Pillow
  (untrusted scanned images) and pypdfium2 (untrusted PDFs) first, then pypdf / numpy / scipy. `vendor\python\python.exe -m pip
  index versions pillow` (or pip-audit on the lock); bump = re-provision the bundled interpreter, regenerate the lock
  (`pip freeze > python_backend/requirements.lock`), run `scripts/test_check_vendor_python.js`, note the decision in the
  commit. The build gate (`check-vendor-python.js`) refuses any drift from the lock. Repeat if: a Pillow/pypdfium2
  advisory lands, or every ~90 days.
- **2026-09-08 · [GATE, blocks the first customer build] the AUDIT FIX PLAN gate runs** — `docs/designs/AUDIT_FIX_PLAN_2026-09-08.md`
  §2 1.3 (realdoc post-mig-137 copy vs the 136 copy: `wouldFile(137) ⊆ wouldFile(136)` + value diffs 0) and §4 3.4 (cold
  `customer_corpus_score.js` A/B/C after the [C6] env fix + the warm 200-vs-300 arm + 10× determinism). Prereqs: slices 1.1/1.2
  (mig 137) and 3.1-3.3 (migs 138/139) landed; the owner's mig-136 DB located (the documented live path is EMPTY today).
  Repeat if: any of the 24 `TEST_SWITCH_KEYS`, `ocr_dpi` default, or the pool env changes.
- **2026-09-06 · [arm] 4(b) OCR re-detect over the Desktop 605 corpus + Hard Set** (PDFs, no stored text) with
  `TYPE_UNINSTALLED_HEADING_FOLD=1` — winner changes must be exactly the uninstalled-heading docs (the live-copy text
  census already MET 20/20 Ironclad, 521 unchanged).
- **2026-09-06 · [decision] the 605-corpus DB harness is VACUOUS on the reset live DB** (`rr_ids.txt` → 15 docs). Rebuild
  `rr_ids` from a fresh db.backup() copy (`_dedup_ids.py`) or build a WARM folder-corpus harness.
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
- ~~**2026-09-02 · [FLIP GATE, owner-machine] `watch_separate_enabled` SOAK**~~ — **✅ DONE 2026-09-16** (run in a
  sandbox on a live-DB copy: analyzer PASS, real 34-page bundle 34/34, 0 over-split, every segment held, 0
  auto-filed → mig 175 default ON; `TESTING/_measure/watch_separate_soak_20260916/RESULT.md`). Repeat if: the
  separator (`ocr/segmentation.py`, `segment_docs.py`, `pdf_splitter.py`) or `watch/handler.js` separation fold
  changes — same harness, same bundles.
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
- **2026-09-17 · separator arc 3 (mig 179 `segment_known_supplier_change`, DARK) — census with the SHIPPED functions +
  the owner-PDF plan diff + the three-switch e2e.** Stacks 72 → 91/95 (0 lost, 0 over-splits; 4 residual each a named
  trade), real_34 + singles 39/39, controls1-5 0 new over-splits, owner PDFs 0 unexplained deltas; e2e in
  `TESTING/_measure/watch_separate_soak_20260916/e2e3_result.txt` (`e2e3_run.sh` = the reusable driver). Repeat if:
  `ocr/segmentation.py`, `header_band_lines`, the known-supplier reader or the pre-pass argv changes.
- **2026-09-16 DAY · `watch_separate_enabled` SOAK run (sandbox on a live-DB copy) → PASS → mig 175 default ON.**
  Analyzer PASS (16 split PDFs, 0 loop/loss/error/orphan), real 34-page bundle 34/34, 5/5 singles not over-split,
  91 segments all held, 0 auto-filed; synthetic same-logo stacks under-split = the separator's fingerprint floor
  (shared with manual import). Record + reusable harness `TESTING/_measure/watch_separate_soak_20260916/`. Seam
  → pendingfeatures.md (durable "look first" mark for watch segments). Repeat if: separator or watch fold changes.
- **2026-09-08 NIGHT · Items 1–7 ALL DONE (6 commits `5db333e`…`ef12f72` + wrap; `HANDOVER_2026-09-09.md`).**
  1 The 17 red JS pins were ALL STALE (0 real regressions) → 325/325 (`5db333e`; producer/supplier-scoped-sweep/v1-gate verified sound).
  2 `--smoke-windows` built + pinned 33/33; PACKAGED build's window smoke 14/14 (`82843a0`) → target `dist/ScanFinder Setup 2.0.0-r20260908-2238-ef12f72.exe`.
  3 real-page name-band pin + 2 tautological pins fixed + `RR_ALLOW_ARMED`/`_operating_point`/`RR_APP_ENV` default-on (`790c7d1`); arm137 gate byte-identical.
  4 heading-fold OCR re-detect: Hard Set digital+scan 0 type/0 filing changes = SAFETY (arm137 has no `statement` type; efficacy = the 09-06 text census). Note `TESTING/_measure/heading_fold_ocr_redetect_20260908_NIGHT.md`.
  5 Chris vet diagnoses (`9097b31`, nothing built): mailbox-card + import-row-stale = REAL, fix+pin designed; bundle-issuer = owner-gated design.
  6 Chris round 2 (`ef12f72`): VERDICT YES, 7 cards, all warnings TRUE; sandbox got config-contaminated (read-only touch of the owner DB) → cards 3/4/5 need a fresh re-vet.
  7 client/cert-tool E44 graph + code smoke clean (binary download allow-scripts-gated → owner finishes); final sweep 325/325; release build OK.
  Repeat if: never as-is. Everything owner-facing is in `HANDOVER_2026-09-09.md` “NEEDS YOUR APPROVAL”.
- **2026-09-08 EVENING · Pre-deployment audit RE-RUN (4 lenses + Oracle re-vet) + the name-grow belts C6 gate + the hardened REBUILD.** Result: `docs/PRE_DEPLOYMENT_AUDIT_2026-09-08_RERUN.md` — SIGN OFF W/CORRECTIONS; a NEW P0 caught (hardened build dropped two renderer scripts) and fixed `5a4bd94`; the smoke identity made REQUIRED `9251551`; belts seam fixed `f4a32a7` (gate: 0 new filers, 1 page-verified heal, note belt VACUOUS); artifact `dist/ScanFinder Setup 2.0.0-r20260908-1843-9251551.exe` verified (identity via file). Repeat if: any change to `scripts/harden-js.js`, the verifier, `build-release.js`, or a new hardened build — re-run the verifier + the owner's scripted click-through.
- **2026-09-07 NIGHT · FULL PRE-DEPLOYMENT AUDIT (owner ask) — security + efficiency, no code changes.** 4 auditors
  (eric/gary/oscar/main-Claude) + Oracle vet. Report: `docs/PRE_DEPLOYMENT_AUDIT_2026-09-07.md` (P0 blockers → P3
  refactor). Top: the TEST-BUILD force-ON migs (108/…/136) have NO build gate → customers could ship every switch
  ON (silent wrong auto-files); unsigned/opt-in-hardened artifacts; plaintext DB; easy wins = DPI 200 default +
  import parallelism. Repeat if: before a public release build (re-check the gate + node-forge + fuse read).
- **2026-09-06 AFTERNOON · Hard Set 3-arm re-score + 5b sibling run (follow-on to the log-review build).** Result:
  5b siblings 0 diffs; Hard Set wrong+would-file 0 in both cold arms; the two moved classes + the warm buyer_large 4
  wrong+would-file are reproduced EXACTLY by the pre-today python on the same DB copy = the DB reset (Statement
  uninstalled; Bramblewood's real PO template claims the buyer-issued POs — the known GT flaw), zero delta from
  today's code. `score_hard_set.js` gained RR_CFG/RR_PY_ROOT. Artefacts `TESTING/_measure/log_review_20260906/
  hardset_{today,pre,baseline_0831}/`. Repeat if: an extraction change lands (the standing rule) — compare to
  `hardset_today/` now, not to 08-31 (different DB).
- **2026-09-06 AFTERNOON · The 09-05 log-review fix plan BUILT in the Oracle's order (11 commits, all pinned).** 5a
  `dfc3cc4` · Item 3 `70bfe3a` (+census: affected population = exactly the 2 Pelican `P1/26/…` windows; realdoc `new`
  arm 453 docs: date 452/453 = doc 471's POISONED GT) · 2A `c912c09` · 2B `03be597` · Item 1 `ba454bf`+`c09c16c`+`799c212`
  · 5b `8a26f6f` · 4b `25a0cfe` (+re-detect census MET: 20/20 Ironclad → Statement, 521 unchanged) · 4i `cc41c9f`. The
  field_anchors census (agent) found the Meadowvale label-less anchor DELETED by `clearAnchors`-on-typed-correction.
  Arms `old` / `b_only` / `arcs_on` / `mv_off` / `mv_on` queued (`TESTING/_measure/log_review_20260906/chain.log`).
  Report: `HANDOVER_2026-09-06.md`. Repeat if: a slice is re-designed (re-run its pin + arm).
- **2026-09-03 NIGHT · Reference-flag family (3 arcs) + watch db_id fix + Chris audit — owner order on AUTO.**
  Owner chose the LIGHTER checkpoint for the Gate-C reference note. Built DARK behind kill switches (all LOCAL,
  unpushed for revert): (1) `FILING_SANITY_REF_CORROB_SOFTEN` `661cd2a` mig 111/112 — Gate C's "doesn't appear
  on this page" rewritten to a TRUTHFUL note, doc STAYS review-bound (soft note still blocks auto-file → Oracle
  C1 satisfied by construction; the same-located-box MIRROR is HELD, never silently filed); reggie+gary→Oracle
  SIGN-OFF-W/COND; pin `test_filing_sanity_ref_corrob_soften.py` 14/14 RED-first; page-match v2 25/25. (2) sibling
  `FORMAT_VARIANCE_RELAX_REF_INLINE` `238e13a` mig 109/110 (box-drift, doc121 heals; pin 16/16). (3) watch db_id
  fix `205143a` (split rows open the right doc + show Filed; pin `test_watch_row_dbid_sync.js`). Chris ran
  sandboxed (port 9223). REVERT LEDGER + flip gates: **`HANDOVER_2026-09-03_NIGHT.md`**.
  **Repeat if:** never as-is — the flip gate (revert test migs 108/110/112 + WARM-DB census vs INDEPENDENT GT,
  realdoc M=0) is OWED on the owner's live corpus before any customer build.
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
