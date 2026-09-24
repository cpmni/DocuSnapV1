# QUICK RESCORE gate — 2026-09-24 (evening)

Fix under test: `src/modules/processing/handler.js` `quickRescoreMerged` + `quickRescoreStore` inside the Plan-B C4
block (Oracle RE-RULE of C4, SIGN-OFF-W/COND C1-C6, `docs/oracle_log.md` 2026-09-24 evening). Env kill
`QUICK_RESCORE_MERGED=0`. Pins: `src/modules/processing/test_reprocess_quick_rescore.js` (14 sections, ALL OK),
`database/modules/test_format_consistency_twin.js` (ALL OK), `test_reprocess_annotated_empty.js` ALL PASS,
`test_reprocess_autocommit.js` 31/31, `src/services/test_charset_accept.js` 26/26.

## Method
Every arm is a REAL Quick reprocess driven through the app (a DEV instance on its own `DOCUSNAP_USERDATA`, signed in
as a seeded gate admin, the Review window's own `reprocessBatch(..., { quick: true })` over CDP), never a harness
re-implementation. Each arm's userData is built from a DB copy by the job-scratch `gate_prep.py`: output folder
re-pointed to the arm's own Output, watch folder removed, `client_api_enabled=false`, every doc's working file
COPIED into the arm's inbox (Demo Docs by original filename for the sandbox, the live inbox files for the live copy) —
no arm can touch the owner's real Output, inbox or DB. Snapshots (`gate_snapshot.py`) record every doc's overall /
status / template plus every extraction row of the queue docs; `gate_compare.py` diffs them; `gate_flips.js` runs
`trust.isAutoFileEligible` over both arms and prints the FLIP LIST. Scripts: `%USERPROFILE%\.claude\jobs\68b38f39\tmp\gate\`
(job-mortal; trivial to recreate from this description).

Source DBs: (1) the owner-sandbox EXHIBIT copy (`…\owner-sandbox-20260924\exhibit-db-copy\docusnap.db`, mig 215,
`auto_file_threshold` 90, `graduation_window` 5, 17 Nordwind quotes `needs_review` @31, no Nordwind template);
(2) a fresh copy of the owner's LIVE DB (`%APPDATA%\ScanFinder\docusnap.db`, mig 207 → migrated to 215 by the gate
instance; 20 `needs_review` = all Print Tracker, the all-taught scope + 33 `deferred`).

## CONTROL (pre-fix tree `83cf5d4`, exhibit copy)
Quick over the 17 Nordwind quotes: `quickCount 17, fullFallbackCount 0`. **All 17 stay at 31.** Consume → offer empty
(`{"done":17,"failed":0,"total":17}`). Eligibility census: 17 × `below-floor@31`. The owner's observation reproduces
through a scripted Quick.

## FIX arm A (new code, exhibit copy — same start state as CONTROL)
Same Quick: `quickCount 17, fullFallbackCount 0`. **All 17 → 93** (= floor((90+95+96)/3), the optional total does
not score). vs CONTROL-after: **0 extraction-row diffs** (value / confidence / method / note / corrected_to identical
on all 21 Nordwind docs), 0 status changes, 0 template changes, **0 overall DROPS**, 17 raised. Consume → offer
empty. FLIP LIST (CONTROL → A): 17 × `below-floor@31 → no-template@93`. This is gary's correction 1 exactly: the
number is now honest, and the hold reason is the true one (the scope had no template yet).

## FIX arm B (new code, continuing arm A's instance — the "files by itself" road)
Human-confirmed doc 11 through the Review confirm IPC → filed into the arm's Output, **no template minted** (a lone
confirm LINKS to an existing template, never creates one). Confirmed 12 → the sender's 5th clean confirm (window 5)
→ **graduation minted template 2 "Nordwind Refrigeration Ltd / quote"**. Confirmed 13, 14, 15 (each linked). Quick
over the remaining 12: `quickCount 12, fullFallbackCount 0` → Plan-B C2 bound all 12 to template 2, rescored 93 →
consume → **`autoFiled: 12`** — all 12 filed by the scope auto-accept ("Auto-filed (after your confirms)", overall
stamped 100 by the confirm road, 17 PDFs in the arm's Output). Before the fix the same docs sat at 31 → `below-floor`
→ the owner's "Full re-read" workaround was the only road.

## FIX arm C (new code, live-DB copy — Oracle C6: blast radius + the C1 live test)
CONTROL leg (pre-fix tree) and FIX leg on identical copies; Quick over the review queue + the deferred queue
(53 docs: 20 Print Tracker Quick + 33 deferred Full-fallback — the fallback docs run the FULL road and are
untouched by this change).
CONTROL leg: `quickCount 20, fullFallbackCount 33`, 53 done / 0 failed (75 s). FIX leg: identical counts (75 s).
**CONTROL-after vs FIX-after: 800 docs compared, overall identical on all 800 (0 raised, 0 DROPPED), 0 status
changes, 0 template changes, 0 extraction-row diffs. FLIP LIST: 0.** Eligibility census (both legs identical):
`disagreeing-read:date` 19 · `below-floor` 19 · `weak-critical-field:reference_number` 7 · `flagged:model` 3 ·
`flagged:customer` 3 · `disagreeing-read:customer` 2. **Print Tracker (all taught): ZERO raises** — the Oracle's
live test of C1 (a taught keep on a scored key blocks the raise; the identity-conf leg alone never fires there
because every Print Tracker issuer read is itself a taught box). The before→after movement inside each leg
(33 deferred docs gaining a first overall via the Full fallback; 4 × 98→97 and 3 × 75→97 on Print Tracker) is the
Quick/Full reprocess itself and is byte-identical across the two legs — not this change.

## Verdict
MET on every bar the Oracle set: the exhibit's false 31 becomes the honest 93 with no field change (A); with a
template present the same Quick pass lets the docs file by themselves (B, 12/12); the live-DB copy is
byte-identical with the fix ON (C), so the change is inert wherever a taught key or a contested read is in play.
Env kill `QUICK_RESCORE_MERGED=0` = today's path (pin 6).

Residuals (not this fix's, recorded for the owner): (1) a keyword-only sender earns its template only at
graduation (window 5 on the sandbox, 10 by default) or by teaching — a lone human confirm LINKS to an existing
template but never CREATES one — so a rescored doc holds honestly as `no-template` until then (Oracle CX: that copy
should name the next step); (2) `charsetAcceptService.recomputeOverall` uses `Math.round` where Python `int()`
floors (a ≤1-point drift on that older path; left unchanged, flagged); (3) the owner's sandbox `output_folder` is
the REAL `C:\Users\cmccu\Documents\Scan Finder` — sandbox files land in the live output tree.
