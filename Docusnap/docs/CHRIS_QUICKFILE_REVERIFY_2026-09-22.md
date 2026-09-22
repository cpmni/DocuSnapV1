# Chris The Customer — Quick File re-verify (children's records)
**Date:** 2026-09-22 · **Round:** re-verify (yesterday's verdict was "not yet for children's records")
**Where:** sandbox instance only (CDP 9223) · fresh admin created, output folder pointed at the sandbox Output
**Who I am:** one simulated non-technical daycare admin, not a user test. I propose; I don't decide or change anything.

---

## TL;DR (3 lines)
- The five things I could actually drive are **all fixed** — the name suggestions appear (and now tell the two Avas apart), a child's document files under the child's name, the "+ Add" boxes are properly labelled, and the new "file these under" chooser is there.
- My earlier blocker is cleared: I filed Ava's consent form and it landed exactly where I'd expect — `…\Output\Child Record\Ava Thompson\2026\September\…`.
- One thing still reads oddly: the Quick File screen still leads with **"Company / Person"** on a child's form, where there is no company; and I couldn't drive the multi-file "ready dot" because staging several files needs the Windows file box my driver can't open.

---

## Per-finding results

| # | What was meant to be fixed | Verdict | Evidence |
|---|---|---|---|
| **F1** | Name suggestions crashed on every keystroke, showed nothing | **FIXED** | `rv_typeahead.png` — a list appears on "ava"; no red errors in the console the whole session |
| **F5** | Two Avas looked identical in the list | **FIXED** | `rv_typeahead.png` — "Ava Robinson · 09-01-2021" and "Ava Thompson · 14-03-2021"; picking one filled the rest |
| **F3** | Child's document filed under a company/person folder | **FIXED** | Landed on disk at `…\Output\Child Record\Ava Thompson\2026\September\Child-Record.22-09-2026.consent-form-ava.pdf` |
| **F2** | Add-a-child form showed four boxes labelled "undefined" | **FIXED** | `rv_addrecord.png` — "Child name (required)", "Date of birth", "Home address", "Guardian"; zero "undefined" |
| **New chooser** | "File these under (folder key)" dropdown listing the type's fields | **PRESENT / FIXED** | `rv_settings_child.png` — dropdown with Default + Document Issuer / Date / Child name / Date of birth / Home address / Medical notes / Guardian |
| **F6** | Multi-file pane's green "ready" dot | **COULDN'T-TEST** | Feature is switched on, but putting several files in at once needs the Windows file box (or a real drag-and-drop), which my driver can't operate — not reporting it as broken |

### F3 — the on-disk proof (as asked)
I filed `consent-form-ava.pdf` as a Child Record for Ava Thompson. To make the test unambiguous I deliberately put a made-up business name ("Little Explorers Daycare") in the Company box. The file still landed under the **child's** name, not the business:
```
…\chris-sandbox\Output\Child Record\Ava Thompson\2026\September\Child-Record.22-09-2026.consent-form-ava.pdf
```
That's `Type → child's name → year → month`, exactly the shelf I'd hope for. This is the thing that stopped me last time; it's genuinely sorted now.

---

## Finding cards (the residual friction, ranked)

### 1. The child's form still opens with "Company / Person" — and it's the first thing I see
- **Citation (verbatim):** Quick File screen — heading **"COMPANY / PERSON"**, box placeholder **"Company or person"**, sitting *above* "Child name". (`rv_qf.png`)
- **User-moment:** I chose "Child Record", picked "Ava Thompson" from the suggestions, and was ready to file her consent form.
- **Observed confusion:** After I picked Ava, her name, date of birth, address and guardian all filled in — but the very first box, "Company / Person", stayed empty, and it's the most prominent field on the form. For a child's consent form there *is* no company. I'd hesitate: do I type the nursery's name? The child's name again? The guardian? Nothing on screen tells me the file will actually be shelved under the child regardless — that good news is invisible here.
- **Harm + severity:** trust-eroded / slowed (not blocked for me — I'd type *something*).
- **Class:** QUESTION (I want to know why it's asking, and whether it matters).
- **Proposed alternative:** for a records-backed type, either rename this box to match the type (e.g. keep it but label it "Who is this about?" mapped to the child), or drop it below the record fields and add one line under it: "Filed under the child's name — this is just for your own reference." Keep whatever the box is used for; I'm only asking that it stop *leading* a child's form with a business word.
- **What I may be missing:** the box may be doing useful work behind the scenes (search, or types that genuinely have a company), and there may be a good reason it's required — I couldn't fully drive the "must fill it" behaviour, so I'm speaking to what I *see*, not to whether it blocks.

### 2. Old and new filing shelves now sit side by side
- **Citation (verbatim):** on disk in the sandbox Output I see both `Ava-Thompson\2026\September\…` (from before) and `Child Record\Ava Thompson\2026\September\…` (today).
- **User-moment:** I looked in the output folder to confirm where today's file went.
- **Observed confusion:** documents I filed before the fix are still in the old place; only new ones use the tidy new shelf. If I went looking for "all of Ava's papers" in one folder, some would be in the old spot and some in the new.
- **Harm + severity:** slowed / cosmetic (the Settings screen does warn "already-filed documents aren't affected", so it's disclosed).
- **Class:** QUESTION.
- **Proposed alternative:** nothing urgent — maybe a note in Settings offering to re-shelve existing records, or just leaving it as-is since it's disclosed. Owner's call.
- **What I may be missing:** the old folders here are leftovers from yesterday's test session, so a brand-new customer wouldn't see this at all — it only bites someone who filed children before upgrading.

---

## New problems introduced
None that I could find. I typed non-matching text ("avax"), backspaced, retyped, and re-opened the screen — the suggestions behaved and the console stayed clean throughout. Nothing vanished, nothing mis-filed, and the app never got stuck.

## The one thing that genuinely worked
Picking "Ava Thompson · 14-03-2021" from the suggestions and watching her date of birth, address and guardian fill themselves in — that's exactly the "competent junior who shows their work" moment I want, and telling the two Avas apart by their birthday is the right call.

## Top friction point
The "Company / Person" box leading a child's form. It's not a blocker, but it's the one spot where the screen still talks like it's about invoices rather than children.

---

## Updated two-week verdict
**Would I keep using this after two weeks? — Yes, for children's records now.** Last time I said "not yet"; the two things that actually stopped me — the name box doing nothing (and not telling my two Avas apart) and the file landing under a company folder — are both genuinely fixed, and I proved the file lands under the child's name on disk. The remaining niggle (the "Company / Person" box on a child's form) is a wording/ordering wrinkle, not a wall. If the owner smooths that one line, this goes from "yes, with a shrug" to "yes, happily."

---
*Humility: I'm a single simulated non-technical user, driving a sandbox copy, not a real usability study. My driver can silently cancel a native Windows dialog, so I deliberately did NOT open the file picker (that's why F6 is "couldn't test", not "broken"). I verified F3 by filing through the app's own filing path and reading the actual folder on disk. Everything here is a suggestion for the owner to vet — I changed no code, no settings beyond the sandbox output folder, and filed only the one sanctioned test document.*
