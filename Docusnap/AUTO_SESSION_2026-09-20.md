# AUTO SESSION — 2026-09-20 (owner away ~3h, no-prompt auto)

Owner ask: (1) plan the 20 most useful new-user tutorial videos (agents + vinny), have vinny
record them in the same tone/folder settings as before — human, clear, not wordy — into
`Desktop\Tutorials\<subfolder>` per video; (2) resume the hardened-build work.

---

## ✅ Hardened build — DONE
`npm run build:release` (hardened road) exit 0, verified: boot smoke exit 0, 14 windows/0 failed,
bytecode present, no plaintext modules, 9 fuses read (5 declared as declared).
**Installer:** `dist\ScanFinder Setup 2.0.0-r20260920-1220-16432a2.exe` (signed, testBuild:false).
Log: `TESTING/_measure/build_20260920_hardened.log`. Manifest `dist/release-manifest-20260920-1220-16432a2.json`.
> DB-at-rest encryption decision (2a whole-DB vs 2b TOTP-only) is APPROVAL-CLASS → left for the owner
> (per night-run protocol). The hardened installer above does NOT encrypt the DB by default (inert until a key exists) — that's unchanged and correct.

---

## 🎬 The 20 videos (barry-brainstormed, ranked, fear-first) + record status
Voice rule: odd rank = en-GB-Ryan (male), even rank = en-GB-Sonia (female). British, one voice/video.
Publish: `Desktop\Tutorials\<NN-slug>\` (subfolder per video) with the voiced `-final.mp4`.
Script status: **SCRIPTED** = JSON ready in `tools/video_tutorials/scripts/`; **NEW** = authored this session.

| # | Title | script | recorded |
|---|-------|--------|----------|
| 1 | Get Scan Finder running (account + licence) | SCRIPTED (first-run-a-account-licence.json) | pending |
| 2 | Tell Scan Finder where to file | SCRIPTED (first-run-b-setup-wizard.json) | pending |
| 3 | Try it safely — the practice run | welcome tour = SCRIPTED (welcome-to-scanfinder.json); practice-run NEW (Agent M) | pending |
| 4 | Import your first folder | SCRIPTED (import-a-folder.json) | pending |
| 5 | Review and confirm your first document | SCRIPTED (review-and-confirm.json) | pending |
| 6 | Green/amber/needs-review explained | NEW ✓ authored (confidence-explained.json) | pending |
| 7 | Where did my documents actually go? | NEW | pending |
| 8 | Find any document in seconds (Search) | SCRIPTED (search-for-a-document.json) | pending |
| 9 | File docs that don't need scanning (Quick File) | NEW | pending |
| 10 | Set up the document types you use | NEW | pending |
| 11 | Fix a wrong field — and watch it learn | NEW ✓ authored (correct-a-field.json) | pending |
| 12 | Teach a tricky layout | SCRIPTED (teach-a-document.json) | pending |
| 13 | Auto-import with a watch folder | NEW | pending |
| 14 | Make folders/filenames match your scheme | NEW | pending |
| 15 | Let Scan Finder auto-file the easy ones | NEW | pending |
| 16 | Fix the learning (Learning Repair) | NEW | pending |
| 17 | Split a stack — or rejoin split pages | NEW | pending |
| 18 | Back up your setup / move to a new PC | NEW | pending |
| 19 | Search from another PC (LAN client) | NEW (may be script-only — needs 2nd machine) | pending |
| 20 | Hand your accountant a list (export) | NEW | pending |
| + | The Template Manager (admin) | SCRIPTED (the-template-manager.json) | pending — bonus, not in the 20 |

Recording is the bottleneck + fragile (UI automation). Priority: record the ready + first-day set first.

## Progress log
- build:release complete, verified. Installer stamped r20260920-1220-16432a2.
- barry plan received (7 tool_uses); Chris/customer lens applied (fear-first, payoff-before-power).
- vinny dispatched to record the SCRIPTED batch (ranks 1,2,4,5,8,12 + template-manager). RUNNING.
- authored #6 confidence-explained.json + #11 correct-a-field.json myself (verified selectors, safe demo data).
- dispatched 2 authoring agents for the remaining 12 new scripts (Settings cluster: #10/14/15/16/13/18; flow cluster: #3-practice/9/17/7/20/19). RUNNING.
- all 16 existing scripts validated well-formed.
- Agent S delivered 6 Settings scripts (validated). Corrections: tab is `data-tab="files"` (not filesfiling); watch controls live in the Files&filing panel. Clean-record: document-types, output-structure, auto-file. Explainer-only (native dialog steps hovered/narrated): watch-folder, backup-restore. Conditional: learning-repair (needs confirmed demo docs).
- Agent M's 6 flow scripts validated. Clean: practice-run (in-renderer sandbox), where-docs-go (in-app Search — needs a FILED Copperfield doc present in sandbox). Explainer/partial: quick-file (drop+native picker narrated), split-and-rejoin (rejoin narrated — needs a pair-held doc to film), export-data (native save narrated). Script-only: lan-search-client (needs 2nd machine).
- Record-time caveats for batch 2: where-docs-go needs a filed doc (sandbox has a "Filed Documents" folder — likely OK; verify); learning-repair needs a couple confirmed docs of a type; quick-file needs Quick File enabled (default-on recent builds).
- **ALL 20 scripts authored + well-formed.** Awaiting vinny batch-1 handback before batch-2 recording (exclusive mouse).

## vinny batch-2 recording plan (dispatch after batch-1 returns)
Voice: odd rank = Ryan, even rank = Sonia. Publish `Desktop\Tutorials\<NN-slug>\`.
- 03-practice-run (Ryan) · 06-confidence-explained (Sonia) · 07-where-docs-go (Ryan) · 09-quick-file (Ryan) · 10-document-types (Sonia) · 11-correct-a-field (Ryan) · 13-watch-folder (Ryan) · 14-output-structure (Sonia) · 15-auto-file (Ryan) · 16-learning-repair (Sonia, conditional) · 17-split-and-rejoin (Ryan) · 18-backup-restore (Sonia, explainer) · 20-export-data (Sonia, explainer).
- 19-lan-search-client = SCRIPT-ONLY (needs a 2nd machine + the client app) — owner records manually.

## Recording — attempt 1 failed on environment, fixed, re-dispatched
- vinny batch-1 STOPPED after video 1 (safety gate). Video 1 (heavy joined first-run) failed twice: app's DevTools connection dropped mid setup-wizard. **Root cause = machine starvation, not code**: 5 runaway 4-day-old `grep` zombies (~1900 CPU-sec each) burning ~70% CPU → better-sqlite3 stalled 8s → the 8s resolve window expired. vinny verified frames (privacy/captions/neutral paths/licence-swap all GOOD) + left everything clean (config restored, sandbox down; clean part-A clip in `out\`).
- **Fix (me, safe/unattended):** killed the 5 grep zombies (CPU freed; RAM 3.6 GB free). Hardened `scanfinder_video_runner.py`: resolve window 8→20s, CDP poll 2→4s (rides out a brief stall). Compiles. Did NOT touch the owner's VM/Chrome/Claude/AVG (out of bounds).
- **Re-dispatched vinny (resumed, keeps its homework + part-A clip):** full recordable queue, LIGHTEST-FIRST (Settings with --skip-import first), CONTINUE-ON-FAILURE (retry once, else skip+log, don't stop the queue), first-run LAST with --reuse-part-a, --reset before teach. RUNNING.
- If videos still fail under RAM pressure: the scripts are all complete + validated, so the owner (or a fresh run on an idle machine) can record any remaining ones directly with `record.py scripts\<slug>.json --publish "...\Tutorials\<slug>"` then `voice.py <name>.narration.json --voice en-GB-<Ryan|Sonia>Neural`.

## Recording — TWO SESSIONS COLLIDED; I stood down (peer owns recording)
**Root cause of the recording chaos:** a SEPARATE peer Claude session — `Handover continuation [50908a]`, running in the background ~20h (very likely the continuation of the session the owner "closed by accident") — was ALREADY recording the same tutorial series into the same `Desktop\Tutorials` on the same single-mouse sandbox (port 9222, `C:\ScanFinderDemo`), with its OWN scripts + naming (`finding-any-document.json`, `reviewing-editing-confirming.json`, non-NN slugs, its own `README.md`/`SERIES_PLAN.md`). My vinny + its `record.py` fought over the one mouse → crashed each other + corrupted the sandbox DB between runs. That, plus the earlier grep-zombie CPU starvation, is why runs failed.

**My decision (auto-mode, safe):** the peer is ahead + actively recording, so I STOOD DOWN recording — did NOT kill its live processes (that would sabotage another of the owner's sessions) and did NOT launch my own recordings (would restart the fight). Messaged the peer (`Handover continuation`) to coordinate: ceded the machine, offered my scripts/fixes/2 videos, suggested it dedupe the two naming schemes.

**Videos finished + voiced so far (6, in `Desktop\Tutorials\`):**
- MINE (via my vinny): `10-document-types`, `14-output-structure` (Sonia, frame-checked, NOT in the peer's README — ask peer to index them or fold in).
- PEER's: `welcome-to-scanfinder`, `import-your-first-folder`, `reviewing-editing-confirming`, `finding-any-document` (and growing — peer still running).

## ⚠ OWNER — the one thing to decide about videos
**Run only ONE session/agent for recording** (one machine = one mouse). Right now the peer session is doing it and progressing; let it finish, OR stop it and let a single fresh run complete the rest from the scripts below. Then **dedupe the two naming schemes** (peer uses `import-your-first-folder`; mine uses `04-…`). Everything needed is ready:
- All **20 scripts** validated + selector-verified in `tools/video_tutorials/scripts/` (the durable asset — any can be recorded with one command).
- **2 selector bug fixes applied** (auto-file.json, watch-folder.json: hidden checkbox → `+ .toggle-slider`; 3 refs each, confirmed).
- **Runner hardened** (`scanfinder_video_runner.py`: resolve 8→20s, CDP poll 2→4s; compiles).
- To record any remaining video alone on an idle machine: `python record.py scripts\<slug>.json --publish "%USERPROFILE%\Desktop\Tutorials\<slug>"` then `python voice.py out\<slug>.narration.json --voice en-GB-<Ryan|Sonia>Neural` (odd rank = Ryan, even = Sonia).

## Resolution — peer accepted the handoff
`Handover continuation` replied + accepted: it OWNS recording, dedup, and the `Desktop\Tutorials` README index; keeping my 2 videos + using all 20 scripts (prefers an existing script over re-authoring), the 2 selector fixes, and the hardened runner. It asked me to leave `Desktop\Tutorials` untouched — agreed: I will not rename/add/record/kill anything there. It may `--reset` the sandbox demo profile between runs (expected). **My session is IDLE on the video track** — the peer completes the remaining videos from the shared scripts.

Net for the owner: hardened build done + verified; the full 20-video series is scripted (durable asset), 6 finished + voiced so far, and one session (the peer) is now completing the rest without contention.

## For the owner — hardening items I could NOT do (need you)
- **DB-at-rest encryption decision (2a whole-DB vs 2b TOTP-only)** — approval-class, left for you. The hardened installer does not encrypt by default (correct/unchanged).
- **Licensing-server deploys** (`BEFORE_RELEASE.md`) — manual IONOS uploads I can't perform: CF real-IP fix (`lib/ratelimit.php` then `lib/db.php`), New-account admin feature, API-activity page. Also privacy notice must disclose IP logging before customer-facing.
- **Push** — HEAD `16432a2`, origin behind; push is your call (I did not push).
- The hardened installer is built + verified locally: `dist\ScanFinder Setup 2.0.0-r20260920-1220-16432a2.exe`.
