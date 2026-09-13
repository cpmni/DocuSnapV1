# NIGHT RUN 2026-09-13 LATE — prove the client search pop-out on REAL core code, vet it with Chris, and clear the red pins

Owner: "set up a night run of your choosing — whatever you think will be the most useful at this stage." State at
bedtime: the client search parity arc is BUILT (S0 → S4, HEAD `cad06ad`, all pushed), the owner's last live report was
"the search window in the client doesn't open" — NOT reproducible against a hermetic core (the real client, driven over
CDP, opens it every time; the owner's relaunched client log even shows one created → shown → closed). Diagnostics +
a reveal fallback are live in the code; the owner had not yet replied to "which of the four happens".

Standing night rules (memory `feedback_night_run_autonomy_protocol`): auto + safe; agents free; Chris ALWAYS sandboxed;
approval-class → log for the morning + skip; dangerous → advisors → stop that item. Nothing touches the live DB
`%APPDATA%\ScanFinder` (blocked anyway) or the owner's running apps. Commits + pushes as today (the owner's pattern
this session).

## Items (in order — each is a checkpoint; the ledger in `NIGHT_RUN.md` closes them out)

1. **Red-pin hygiene (safe, quick).** The 4 pre-existing reds: `test_compile_python_keep` (pdf_find.py — a SPAWNED
   script that the compile gate would ship as .pyc = the packaged Find would break → a REAL fix: add it to
   SPAWN_ENTRIES), the two TEST_SWITCH_KEYS count pins (49 → the true count; verify mig 166's key is present),
   `test_activity_strip` card 8 (repairService note prefix — decide code vs pin). Gate: `npm run test:pins` ALL green.
2. **First-paint confidence pips (small, shared module).** After the entitlement resolves, if `entitled` flipped and the
   list is idle, re-decorate the rows once (no re-search, no selection yank). Pinned in the harness; core + client.
3. **THE BUG, on real core code.** Build a sandbox core (the `/christest` machinery: `scripts/seed-chris-sandbox.js`
   → a fresh DB + the machine-bound licence rows; `DOCUSNAP_USERDATA`; `--remote-debugging-port=9223`; TEST_BUILD=1
   like the owner's), create the first admin over CDP, enable the search-client API (Settings → Search client), then
   launch the REAL client against it (`--user-data-dir` scratch, `--remote-debugging-port=9226`,
   `SCANFINDER_CLIENT_API_URL`) and drive: sign in → Search → pop-out appears? rows? find? workflow popup? Also the
   failure modes the owner might have hit: press Search before sign-in; sign in, restart the core, press Search
   (session gone → the 401 path); a read-only user. Record EXACTLY what happens + the `[search-popout]` log lines.
   If it fails here → root-cause + fix (advisor/Oracle if the fix is non-trivial). If it passes → the morning question
   stays, but with evidence.
4. **Chris, sandboxed, on the NEW surfaces** — the shared core Search window (must be unchanged) + the client pop-out
   (rows, preview, page nav, find, xlsx grid, bin, ↑/↓, theme sync, deep-links from Home, Send-or-stamp popup, Mailbox,
   Quick File centred). Chris drives BOTH apps (core CDP 9223, client CDP 9226) inside the sandbox only. Report →
   `docs/CHRIS_FULL_APP_REVIEW_2026-09-14.md`; cards queue for the OWNER — nothing implemented from them.
5. **Wrap:** `NIGHT_RUN.md` DONE ledger entry, a HANDOVER addendum (`HANDOVER_2026-09-13_LATE.md` → ADDENDUM: NIGHT),
   memory update, commit + push.

## Approval-class (logged, NOT done tonight)
- The `/v1` MINOR for the pop-out's hidden workflow bits (docHistory / docRoutes / admin cancel / stamp-type create /
  stamped viewer) — a new API surface → Oracle first, and not while the owner is mid-test on contract 1.3.0.
- mig 166 flip gate (heal-vs-mislead census on the real corpus + Oracle) — a full-context harness job; the owner's
  morning call.
- Any customer-default flip; any live-DB write; any installer.
