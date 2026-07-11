---
name: newsession
description: Wrap up the current session so a fresh chat can pick up cold — write a dated HANDOVER_*.md, refresh CLAUDE.md's session-state block, and save durable memory. Invoke when the user types /newsession or asks to hand over / wrap up / start a new session.
---

# /newsession — session wrap-up + handover

When invoked, do ALL of the following, in order. Be factual: the whole point is that the next
session states facts, not hopes.

## 1. Take stock FIRST (read-only)
- `git log --oneline -5` + `git status --short` → branch, last commit, committed-vs-uncommitted split.
- Any UNREAD verification results (background harness runs, gate reports, agent verdicts): **READ them
  now** — never hand over a claim like "the gate passed" without having read the report file.
  (Gotcha: `stress_test/realdoc_regression.js` with `GATE=1` exits 1 on ANY silent regression incl. the
  known pre-existing class, and a trailing `echo` masks the exit — always read the report.)
- Note running background processes (a dev `npm start`, harness runs) the next session should know about.

## 2. Write the handover
`HANDOVER_<YYYY-MM-DD>[_<SLOT>].md` at the repo root (SLOT = DAYTIME/EVENING/… when one already exists
for the date). Follow the established format of the prior HANDOVER_*.md files:
- **Header:** branch · last pushed commit · installer state · "uncommitted batch?" · one-line context.
- **TL;DR** — what happened, what's fixed, what's pending.
- **Committed vs UNCOMMITTED** — per fix: root cause (1-2 lines), files, tests + results, advisor/Oracle
  verdict, and any OPEN conditions. List the modified/new files (`git status` output).
- **Verification state — be honest.** What ran, what the numbers were, what was NOT verified, and any
  mid-session claims that turned out wrong (correct them explicitly).
- **FIRST ACTIONS for the fresh session** — numbered, concrete.
- **Deferred (designed, not built)** — with the load-bearing conditions so they can't be built wrong.
- **Needs the USER** — outstanding manual steps/smoke tests.
- **Key facts/paths** — DB location + migration version, snapshot/worktree paths, how to run tests +
  harness, advisor/agent notes.

## 3. Update CLAUDE.md (the lean index — no narrative dumps)
- Add a COMPACT entry (≤ ~20 lines) to the "Recent session changes" block for this session's durable
  mechanisms, pointing at the new handover.
- **More important than the addition:** CORRECT any CLAUDE.md claims this session made stale
  (changed invariants, renamed mechanisms, resolved "deferred" notes). A stale claim in CLAUDE.md is
  read by every future session and is worse than a missing one.

## 4. Save memory
Update the auto-memory project file(s) for the ongoing work (or create one) with the durable state +
the handover filename; keep MEMORY.md's one-line index current. Convert relative dates to absolute.

## 5. Report to the user (plain + concise)
- What was written (paths).
- Uncommitted work + running processes they should know about.
- The first 2-3 actions for the fresh session.

**Rules:** read-only with respect to source code — never "tidy up" code during wrap-up; do not
commit/push unless the user asked; if something is unverified, say so in the handover rather than
implying it passed.
