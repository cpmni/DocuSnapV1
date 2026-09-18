# Chris The Customer — Full App Review — 2026-09-18

## Round: 2026-09-18 (sandbox, focus = the Departments feature) — PARTIAL (run cut short)

**Sandbox conditions:** fresh seeded DB + isolated userData under the session scratchpad, copied Demo Docs,
CDP port 9223. The run was cut short: the sandbox instance was stopped by the main session to free the build
binary for a rebuild (the two bug fixes), so Chris only completed first-contact + the Departments *settings*
section — the enforcement test (sign in as a colleague, confirm they can't see another department's docs) was
NOT reached. Treat the verdict as provisional. Nothing implemented; cards queue for the owner's vet.

**Verdict:** provisional NO on trust — "I never saw it do the one thing it's for" (never watched Departments
actually hide one team's documents from a colleague). The setup screens read well.

### Findings (3 — only what he actually saw)
- **Card A — Retire vs Delete, no hint which is which (medium).** On each department row `Rename… · Retire ·
  Delete` sit together with nothing saying the difference or which is undoable. Proposed: a grey line under each
  dept — "Retire: hides it but keeps its documents. Delete: removes it for good (only when nothing is filed
  under it)." (May be explained in the confirm box — not reached.)
- **Card B — admin's own row shows department tickboxes despite "admins see everything" (medium; TOP FRICTION).**
  The admin row shows an "All departments" toggle (looks off) + an unticked Finance box, directly under the
  feature's "Admins always see everything" line — made him fear he had to switch "All departments" on for
  himself. Proposed: for an admin, replace the tickboxes with a greyed line "Admins see every department —
  nothing to set here." (Relevant: the membership UI is being reworked for D7 anyway — fold this in.)
- **Card C — the master-switch confirmation is a quiet one-liner (low/preference).** After turning it on, only
  "On — documents can now be restricted by department." Proposed: also remind that untagged docs stay visible
  to everyone + point at where to set membership. (Already in the paragraph above the switch.)

### What genuinely worked
The master-switch explanation ("Admins always see everything. Documents with no department are visible to
everyone. Departments restrict what Scan Finder shows — they do not change Windows folder permissions.") —
answered his three biggest fears (lock-out, untagged docs, Windows folders) before he had to ask.

### Warnings truth-table
Nothing destructive was pressed (run cut short) — no truth-table evidence this round; no native confirm dialog
reached.

### Not reached / humility
Create/rename/retire/delete + their confirm/refusal wording; the delete-while-in-use refusal; adding a second
edit colleague; the per-document Department dropdown in Review; and the enforcement test (the heart of the
mission). A stray "Finance" department present at start = leftover sandbox test data (the app ships no default
department — code-checked), not a product fault; re-seed clean before the enforcement re-run.

### Owner action to finish this vet
Re-run `/christest` on the CLEAN rebuild (the two fixes are in `…-1250-976f42f-TEST`), re-seeded, and let Chris
complete the management flows + membership + per-doc tagging + the enforcement check.
