# Chris The Customer — Quick File vet (2026-09-15)

Sandbox: fresh install, isolated userData, Demo Docs corpus, CDP 9223. Focus = Quick File
(`direct_intake_enabled` armed ON + the 4 Quick File preset types). Full destructive freedom
INSIDE the sandbox only. Findings queue for the owner's vet — nothing implemented from this round
without the owner's explicit go.

## Verdict: YES (would keep using after two weeks). Core Quick File promise delivered + safe.

## Triage (main session)
- **Finding 1 (blocker, safety surface) — FIXED THIS SESSION.** The pane send-back was already hidden
  for typed docs, but the toolbar ↩ icon + right-click + bulk "Send back to Review" still dispatched
  `repairDeconfirm` on a Quick-Filed doc with no intake check → scary confirm, then silent nothing
  (backend refused, result swallowed). Guarantee held (never entered Review), but it was the dead-end
  via a second door. Fix: `searchResults.js` now hides send-back when the selection has no non-typed
  doc, and `_act('sendback')` skips typed ids + surfaces the plain refusal (client synced; source-
  contract pin extended). Completes Condition A across every send-back door.
- **Finding 5 (cosmetic) — FIXED.** The reprocess refusal named "Scan Documents" (no such label);
  changed to "Process Documents".
- **Findings 2, 3, 6, 7, 8 — QUEUED for owner vet** (see cards). 2 (typed fields show "100%") and 8
  ("No OCR" jargon) are cheap Quick-File-specific polish; 3 (delete+refile leaves a ghost folder) and
  6 ("move to recycle bin" doesn't move the file) are app-wide soft-delete behaviour, not Quick-File-
  specific; 7 (Quick File invisible in onboarding) is a discoverability add.
- **Finding 4 (no in-place edit) — accepted v1 tradeoff** (owner-decided this session: ship edit-by-refile).

---

## Full report (verbatim)

I ran the whole thing myself on a clean sandbox (the instance had reset to "Create the administrator account", so I got a genuine first-contact run too). Everything below happened inside the sandbox on port 9223; nothing outside was touched. Findings are suggestions to vet — no code was changed by Chris.

**Honesty note on automation:** the native "Choose files…" dialog and OS drag-and-drop can't be driven over the debug bridge, so files were added and the final "File" pressed through the *exact same two internal calls the UI uses* — the drag-drop staging path and the "File documents" button's submit. Everything else (menus, typing, Search, Review, delete, restore, send-back, reprocess, confirm) was the real on-screen controls. Coverage gap: the on-screen "Filed just now" receipt strip (Open folder / Find it / Undo) after the real button click was not exercised (its underlying actions were verified separately).

### Walkthrough (screenshots in chris-sandbox\)
- First contact: created admin "Chris Miller". Recovery-code screen is good; copy correctly reads "It will not be shown again." One-time-code explanation clear.
- Terms: standard legal gate, accepted.
- Wizard: 7 steps, plainly written, "Everything stays on this computer… never uploaded." Organise step is a lot at once but says "Most people leave this as-is." "You can change all of this later in Settings" repeats on every step (mild).
- Welcome tour: 6 cards, good copy — but entirely about scanning/teaching/review; Quick File never mentioned.
- Practice run: clearly labelled sandbox. Also scan-only.
- Quick File happy path: filed one of each type — .docx (Contract), .eml (Correspondence), .xlsx (Spreadsheet/Report), .pdf (Filed Document). Submit times 15 / 14 / 25 / 466 ms (median ~20ms). Each landed under Company/Year/Month with a sensible name + extension preserved, .metadata XML alongside. No Review, no OCR wait.
- Searchable: all 4 appeared immediately in Search as green "Confirmed".
- Quick-Filed doc detail: the note is present verbatim — "Quick Filed — typed details, not reviewed. To change it, delete and Quick File it again." — actions only Open in Explorer / Open File / Print / Delete.
- Guarantee probes: reprocess → refused plainly; send-back pane → hidden; send-back toolbar icon → reachable, misleading (finding 1); delete→bin→restore → intact.
- Normal scan pass: imported 2 real scans → both went to Review as "needs review"; filled the issuer, Confirm & File worked. Quick File didn't break scanning.

### Finding cards (ranked by harm)

**1. "Send back to Review" reachable on a Quick-Filed doc via the toolbar/bulk, warns it will happen, then silently does nothing — CONFUSION, trust-eroded (medium).** Toolbar ↩ tooltip "Send back to Review (admin) — re-open a filed document in the queue"; confirm "Send this document back to the Review queue? It stays filed until re-confirmed." Click OK → nothing visible; doc stays Confirmed. Guarantee holds (never enters Review/OCR); the backend has a perfect refusal ready but the toolbar path throws it away. The pane button was correctly hidden; the same guard wasn't applied to the toolbar icon / multi-select. Fix: hide/disable those for typed docs as the pane does; surface the existing refusal if clicked. [FIXED this session.]

**2. Typed Quick File fields show "100%" confidence badges — QUESTION, trust-eroded (low).** "Document Date … 100%", "Reference Number … 100%", "Title … 100%". A % implies "how sure the app is it READ this right", but these were typed. Suggest: for typed docs show "Typed" (or drop the chip). [QUEUED.]

**3. Fixing a typo by delete+refile leaves a ghost folder on the shelf — CONFUSION, slowed (medium).** After correcting a company name, both the misspelled and corrected company folders exist on disk (delete is a soft-delete; the file stays until Empty bin). Suggest: on delete of a Quick-Filed doc, actually move its file out (or prompt). Note: app-wide soft-delete model. [QUEUED — app-wide.]

**4. No in-place edit — every correction means retyping everything — PREFERENCE, slowed.** Deliberate v1 tradeoff (the "not reviewed" promise). Eventually a "Quick File again with these details" pre-fill. [ACCEPTED v1.]

**5. Reprocess refusal points to a screen that doesn't exist by that name — CONFUSION, cosmetic.** Message says use "Scan Documents"; the app calls it "Import"/"Process Documents". [FIXED → "Process Documents".]

**6. "Move to the recycle bin" doesn't move the file — QUESTION, trust-eroded (low).** After delete the file stays in its Company/Year/Month folder until Empty bin. Reword or actually move. App-wide. [QUEUED — app-wide.]

**7. Quick File is invisible in onboarding — PREFERENCE, discoverability (low-medium).** The 6 tour cards + practice run never mention Quick File. Suggest one line on the "You're all set" card. [QUEUED.]

**8. "No OCR" in the Quick File blurb — jargon, cosmetic.** Developer-speak; the sentence already says "needs no scanning". Suggest dropping "No OCR". [QUEUED.]

### Warnings truth-table
| Action pressed | On-screen warning | Truthful? |
|---|---|---|
| Send back to Review, typed doc (toolbar ↩) | "…back to the Review queue? It stays filed until re-confirmed." | Misleading — implies it will happen; it does not, and no result shown. [FIXED] |
| Reprocess a typed doc | "Quick Filed documents aren't scanned… delete this entry and import it through Scan Documents." | True + helpful (only the label was wrong — finding 5). [FIXED] |
| Delete a typed doc | "Move this document to the recycle bin? You can restore it later." | True on restorability; overstates the file move (finding 6). |
| Restore from bin | (none; immediate) | Fine — restored fully intact. |

### What genuinely worked
Quick File happy path is excellent — a few typed details, each file on the shelf in the right Company/Year/Month, correct name, extension kept, searchable, ~20ms, no OCR wait, no Review. The reprocess refusal is a model of clear copy; the "Quick Filed — typed details" note reads right; delete→restore is safe + truthful; normal scanning untouched.

### Top friction
Finding 1 — the toolbar/bulk send-back offering a scary action it won't perform, then saying nothing.

### Two-week verdict
Yes. Quick File does the one thing it promises, fast + predictably, and typed docs are genuinely safe from being reviewed/re-read. The rough edges are trust nicks + tidiness, not blockers.

### Humility
Couldn't drive the native picker / real OS drag (staged via the same internal calls the UI uses); didn't see the "Filed just now" receipt strip. Tested as Admin (the send-back button is Admin-only). Filed a handful, not hundreds. Small synthetic office files.
