---
name: handover
description: Generate or refresh a concise handover.md so a fresh chat can resume the current work with minimal context. Use when the user asks to hand over, wrap up a session, or prep a new chat window.
---

# Handover

Write/overwrite `handover.md` at the project root. Goal: the SMALLEST doc that lets a new chat continue without re-deriving context.

## Token rules
- Do NOT restate what a new chat already gets: CLAUDE.md, project structure, git history. Reference, don't repeat.
- Capture only NON-OBVIOUS, session-specific state: active task, done vs in-flight, decisions+why, next steps, gotchas.
- Terse bullets, not prose. Link as `path:line`. No filler. Keep under ~60 lines.

## Procedure
1. Run `git branch --show-current`, `git log --oneline -5`, `git status --short` — use real state, don't guess.
2. Fill the template below. Overwrite any existing `handover.md`.
3. Flag any working-tree changes that are UNRELATED to the task (so the next chat commits selectively).

## Template
```
# Handover — <task in <=5 words>
Branch: <branch> · Updated: <YYYY-MM-DD>

## Goal
<1-2 lines: what + why>

## Done (committed/pushed)
- <hash> <one-line> [pushed?]

## In progress — UNCOMMITTED
- <what + files (path:line); note anything mixed with unrelated changes>

## Next steps
1. <ordered, actionable>

## Decisions & rationale (non-obvious)
- <decision — why>

## Gotchas
- <traps the next chat must know>

## Verify
- <commands>
```
