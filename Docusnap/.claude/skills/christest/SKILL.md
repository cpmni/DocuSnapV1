---
name: christest
description: Build a fully-sandboxed ScanFinder instance (fresh DB, isolated userData, copied Demo Docs) and send Chris The Customer in for a hands-on product vet under the owner's standing safety rules — full destructive freedom INSIDE the sandbox only, real screenshots, findings queued for the owner and never implemented without their vet. Invoke via /christest [optional focus].
---

# /christest — Chris's sandboxed product vet

Recreates the 2026-08-02 round-5 setup exactly: an isolated second app instance Chris can
break freely, with real pixel screenshots, under the owner's safety contract. Optional
`$ARGUMENTS` = an extra focus for the round (e.g. "focus on the new import flow"); with no
args, run the standard full-fortnight battery.

## Owner's safety contract (NON-NEGOTIABLE — repeat it verbatim in Chris's brief)
- Everything happens INSIDE the sandbox instance ONLY. The owner's live app (usually CDP
  9222) and the owner's filesystem are OFF LIMITS — never read, write, or reference any
  path outside the sandbox folders.
- Chris cannot change code. He may change any setting a CUSTOMER could reach, in the
  sandbox app only. He is free to perform ANY file action the app offers (delete, purge,
  File All, split, reprocess) — in the sandbox only.
- His findings NEVER become changes by themselves. Everything he reports queues for the
  OWNER's vet first. He cannot request live changes; you (the main session) must not
  implement his suggestions from this run without the owner's explicit go.

## Procedure (main session)

1. **Sandbox root** = `<session scratchpad>\chris-sandbox\` (session-mortal by design —
   every /christest is a fresh install). Create `userData\` and `Output\` under it.
   If a previous sandbox instance is still running on port 9223, kill it first
   (`Get-NetTCPConnection -LocalPort 9223` → stop that process).

2. **Seed the DB** (fresh schema + ONLY the machine-bound license rows, so the gate passes
   but Chris gets the true first-run experience — 0 users → create-first-admin flow):
   ```
   $env:ELECTRON_RUN_AS_NODE='1'
   & .\node_modules\.bin\electron.cmd scripts\seed-chris-sandbox.js "<sandbox>\userData"
   ```
   Verify its output says `users in sandbox: 0`.

3. **Copy the test corpus** into the sandbox: `Desktop\Demo Docs` → `<sandbox>\Demo Docs`
   (or, if the owner's args name a different corpus such as `Customer Doc Test`, copy that
   instead — NEVER point Chris at the Desktop originals).

4. **Launch the sandbox instance** (background):
   ```
   $env:DOCUSNAP_USERDATA = "<sandbox>\userData"
   npm start -- --remote-debugging-port=9223
   ```
   Wait for `http://localhost:9223/json/version`, then confirm the first window is the
   create-administrator screen (evaluate `document.body.innerText` over CDP). Record the
   app's PID via `Get-NetTCPConnection -LocalPort 9223` — Chris needs it for captures.

5. **Screenshots**: CDP capture hangs on this Electron build. Chris uses the OS-level
   helper — `powershell -NoProfile -ExecutionPolicy Bypass -File
   "scripts\capture-window.ps1" -OwnerPid <pid> -TitleMatch "ScanFinder" -Out stepN.png`
   — after every step, then Reads the PNG. `-OwnerPid` keeps him photographing HIS
   instance when two are running; child windows match by their own titles.

6. **Spawn `chris-the-customer`** (async) with a brief containing, in this order:
   - Load his skill first (Read `.claude/skills/customer-experience-review/SKILL.md`).
   - The sandbox facts: CDP port 9223, driver folder (`<scratchpad>\chris-driver\` — if it
     doesn't exist, `npm init -y && npm install playwright-core` there and give him the
     `connectOverCDP` pattern), the capture command with the recorded PID, the Demo Docs
     path, the Output path to set when Settings asks.
   - The safety contract above, VERBATIM, marked as the owner's words.
   - The mission (adapt with `$ARGUMENTS` if given): (1) first contact — create the
     account, walk terms/wizard/tour/practice run, judge AS SEEN; (2) real work — import a
     supplier, review, teach (⊕ or wizard), confirm/file, search; (3) the scary buttons —
     actually press them (delete/restore, Delete All, File All, Split, Reprocess) and
     report whether the warnings told the truth; (4) the approval workflow end to end
     (send/approve/reject/recall, Mailbox, History, stamped viewer + Save a copy);
     (5) anything he always wanted to try.
   - Report format: walkthrough with screenshot references · ≤8 NEW finding cards ranked
     by harm (previously-reported items become one-line FIXED/BETTER-BUT/NEW-PROBLEM
     verifies) · a warnings truth-table · what genuinely worked · top friction · the
     two-week verdict · his standard humility block. Remind him of the round-5 lesson:
     his driver can silently cancel NATIVE confirm() dialogs — before reporting any
     native-dialog button as dead, check for a swallowed dialog.

7. **When Chris returns**: append his report VERBATIM (with a dated round header noting
   the sandbox conditions) to `docs/CHRIS_FULL_APP_REVIEW_<date>.md` (create per-date if
   absent), add a triage summary to the current handover, commit + push the docs, and
   give the owner a short spoken summary ending with the vet queue. IMPLEMENT NOTHING
   from the round without the owner's explicit approval.

8. Leave the sandbox running (the owner may want to poke it); note its port + PID in your
   summary. The next /christest kills and rebuilds it.

## Durable pieces this skill relies on
- `scripts/seed-chris-sandbox.js` — fresh migrated DB + live license token copy (same
  machine fingerprint → offline verify passes; STRICTLY read-only on the live DB).
- `scripts/capture-window.ps1` — PrintWindow capture with `-OwnerPid` / `-List`.
- The `DOCUSNAP_USERDATA` dev-only hook in `src/main.js` (ignored when packaged) + the
  per-userData single-instance lock.
- The `chris-the-customer` agent + `customer-experience-review` skill.
