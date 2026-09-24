# Chris The Customer — full-app review, 2026-09-24

## Round 2026-09-24 (night) — fresh sandbox on branch HEAD `764267e` + the two evening features

**Sandbox conditions:** `/christest` round, a FRESH install (0 users → Chris created the admin), own userData/Output under
`C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\chris-sandbox-20260924\`, a COPY of `Desktop\Demo Docs`,
CDP port 9226 (the owner's own sandbox on 9223 and the live app on 9222 untouched). Both evening features live in the
instance: the Quick-rescore fix (default) and QUIET REDETECT (`quiet_redetect_on_type_change` armed by env AND written
`'true'` in the sandbox DB; `reextract_fast_enabled` and `quiet_reread_silent` ON as shipped). Focus given: the two new
roads (add a type from the catalog → the held unrecognised papers sort themselves; save a keyword override → the held
papers of that type re-read), then the normal life, first contact and the scary buttons. Report below VERBATIM.

---

# Chris The Customer — round 2026-09-24 (sandbox 9226, fresh install)

**TL;DR (3 lines)**
1. Both new roads WORK underneath — adding kinds sorted 91 of 98 kind-less papers by themselves, and one saved keyword fixed 19 of 20 credit notes hands-free — but the Review window I was staring at told me almost none of it: counts caught up after ~4 minutes, the paper on screen kept showing its OLD reading (even "no type yet" for a paper that already had one), and the "31%" badges stayed put.
2. Two real traps to vet first: the "Add 'Statement'" button still offered after Statement exists (it opens "Create a new document type" and says Statement "isn't one of the ready-made types" — false both ways), and a credit-note number shown as **"nanann"** with "Found on a second look".
3. Normal life was the best I've seen it: a countdown to "files by itself", nine papers filed themselves ten seconds after my tenth confirm, every one on the right shelf, search found the order in 2.5 s, delete → bin → restore kept the file on disk throughout. Verdict: yes, I'd keep it.

Screenshots: `C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\chris-sandbox-20260924\shots\` (names in brackets below). Driver logs in `…\chris-driver\*.log`.

---

## Focus item 1 — "the pile should sort itself when a kind is added"

**Did it sort itself: PARTLY (the papers yes; the screen no).**

What I did: imported `Other\IMPORT` (200 files, 318 s). Result as seen: Review 162 / Not recognised 38 / nothing filed (Output folder 0 files — right for a new install). At source 98 papers had no kind: 20 worksheets, 20 statements, 20 credit notes, 20 quotes, 20 delivery notes (minus 2 statements the app called "Invoice"). Only the 38 with NO SENDER sat under "Not recognised"; the other 60 kind-less papers sat in the ordinary Review tab under their sender.

Settings → Document Types → "Add from catalog…" → ticked Statement, Delivery Note, Credit Note, Service Worksheet → "Add selected" at 22:19 [cat1_ticked, cat1_settings_t0].

Timeline, Review window left open on the Not recognised tab with statement 0031 selected:
- t=0 s: the four new kinds appeared in the type dropdown instantly. No line, no toast, no strip entry anywhere in Review [cat1_review_t0…t60].
- t=60 s: tabs still "Review 162 / Not recognised 38"; every statement still "Couldn't identify this one". Nothing filed (0 files) — correct.
- ~t=2½ min (checked underneath): 18/20 worksheets, 13/20 statements, 20/20 credit notes, 20/20 delivery notes now carried the right kind.
- ~t=4 min: the Review window caught up by itself: "Review 193 / Not recognised 7" [step24_review_after4min]. BUT the pane for the paper I had open still said "This looks like a Statement, but you don't have that document type yet" with an "Add 'Statement'" button — directly under a dropdown that now listed Statement.
- Left behind for good: 7 papers (5 Ironclad statements, 2 Castellan worksheets) — same sender, same look as the 13 that got sorted. No reason given on screen [step25_leftover_statement].
- Nothing filed itself at any point of this step — 0 files until my first confirm.

The in-place road (Review → "Add 'Quotation'" → "Create type") was a different experience: "'Quotation' added — reading this document again…" at 1.5 s, the open paper re-read by 5 s, all 20 quotes carried "Quotation" by 9.6 s [step30_create_t3, step30_create_t10]. That one showed its work.

## Focus item 2 — "a saved keyword should fix the held papers by itself"

**Did it fix itself: YES for 19 of 20 (in under a minute); the 20th was the paper I had open; the screen said nothing.**

Credit notes print "Credit Ref MVC-8136"; the app showed "nanann" and every Meadowvale row read "31%". Settings → Learning → Keyword Label Overrides → Credit Note / Credit Note Number / "Credit Ref" → "Add labels" → "Added 1 label." [kw1_filled, kw1_settings_t0].
- Within 60 s (checked underneath): 19/20 credit notes re-read themselves — number MVC-xxxx found on each, their overall number moved 31 → 59. That is an honest move, not a stuck 31.
- On screen in that minute: nothing changed. Open paper still "nanann", every list badge still "31%" [kw1_review_t60].
- The 20th (0029, the one open in Review) stayed at 31 with no number until I CLOSED and reopened Review; it then showed MVC-8136 "Found on a second look — check it, then Confirm to keep" — but its list badge STILL read "31%" while its siblings showed "Check" [step36_credit_0029_reopened]. So the old "stuck at 31%" sore is gone for papers re-read quietly, and still there for the one paper you happen to have open.

## Normal life (item 3)
Confirmed Harrowgate sales orders one at a time [confirm_harrowgate.log]:
- #1: "Filed as …", group header "4 more confirmed before this sender files on its own", strip "✎ 19 more offered in File All Ready", note "Filled the sender on 19 more documents with this letterhead… You can undo from the activity strip." On disk: `Harrowgate-Timber-Supplies\2026\March\Sales-Order.26-03-2026.HTS-SO-95822.pdf` — the shelf the wizard promised [step39_confirm1_after].
- #5: "✓ files by itself" + "Other documents from this sender now file themselves — this one was read before that. Press Reprocess… and it should file too."
- #6–#10: still had to confirm each; nothing filed itself yet.
- 10 s after #10: strip "✓ 9 filed themselves" — 19 on disk, all refs/dates matching what the app showed me [step39_after_confirms]. One left (0020): "Nothing was flagged — this was read at 60%, below the 90% you've set for filing without a check… Press Reprocess… it should file too." Reprocess → "✓ Reprocessed", "Ready to file", 95/98% — but it did NOT file itself; File All Ready filed it ("File 1 ready document (of 181)…").
- Search: typed `HTS-SO-14750` → found in 2.5 s, opened, actions clear. Typed "Harrowgate March 2026" → "No documents found. Try different search terms." (the boss-on-the-phone phrasing fails; the date filter is a separate control) [step41_*].
- Home at the end: "1 sender files by itself after your confirmations · 9 filed by themselves in the last 7 days · 20 filed today."

## First contact (item 4, brief)
Admin account → recovery code ("It will not be shown again", tick-to-continue) → Terms (Accept greyed until ticked) → wizard (folder, shelf layout with live preview, Dark/Light, speed, diagnostics off by default, "Open Scan Finder") → 6-card tour with a real fork at the end ("Import my documents" / "Try a practice run"). All plain, no stumbles [step01–step14]. Home ticked "Choose where filed documents are saved" by itself.

---

## NEW finding cards (ranked by harm)

**1. The window I'm looking at shows the OLD reading while the pile sorts itself**
- Citation (Review, quote 0012, after all 20 quotes had been given "Quotation"): "— Select document type —" · "This document doesn't have a document type yet, so it can't be filed" · "INVOICE NUMBER  Not found" — while the paper on screen printed "Quotation Ref NRQ-3753" and, checked underneath, the app already held NRQ-3753 at 85% under "Quotation" [step31_quote_0012 vs step34_quote_0012_after_reopen]. Same for credit note 0029 ("nanann", "31%") while 19 siblings had moved.
- User-moment: watching to see whether the new kind had "taken".
- Observed confusion: I would conclude the sort had failed for this paper and press Reprocess or set the type by hand — repeating work the app had already done; the "31%" badges made me think nothing had changed.
- Harm: trust-eroded + slowed (the whole point of the feature is invisible from the one window you'd be watching).
- Class: CONFUSION.
- Proposed alternative: when a paper that is open (or in the visible list) is re-read behind the scenes, refresh it and say so in the same strip that already says "9 filed themselves" — e.g. "✓ 20 quotes given their type · Just now" / "✓ 19 credit notes re-read — 'Credit Ref' found · Just now", and update the list badges. The tab counts already refresh; the papers should too.
- What I may be missing: a deliberate rule not to change a paper while someone is editing it — if so, a one-line "This document was re-read while you were here — Refresh" would still beat silence.

**2. "Add 'Statement'" still offered after Statement exists, and it opens the wrong door**
- Citation (Review, statement 0029 opened fresh AFTER the catalog add): "This looks like a Statement, but you don't have that document type yet … Add 'Statement' — or choose an existing type above." Pressing it: "Create a new document type" with name "Statement" pre-filled and the toast "'Statement' isn't one of the ready-made types — create it here, then the document will be read again." [step25_leftover_statement, step26_after_add_press_t3]
- User-moment: mopping up the 7 leftovers.
- Observed confusion: both sentences are untrue at that moment (Statement IS in the catalog and IS already set up — it's in the dropdown one inch above). I would press "Create type" and end up with a second "Statement".
- Harm: trust-eroded; a duplicate kind if pressed.
- Class: CONFUSION.
- Proposed alternative: if the kind already exists: "Statement is set up — Apply it to this document" (one button). If it doesn't exist but is in the catalog: open the catalog with it ticked, not the blank create box.
- What I may be missing: perhaps the note is cached from before the add — but this was a freshly clicked paper.

**3. Seven papers left behind with no reason**
- Citation (Not recognised tab, ~4 min after the add): 5 × "Ironclad-Tool-Hire_statement_… Couldn't identify this one", 2 × "Castellan-Security_service_worksheet_… Couldn't identify this one" — while 13 statements and 18 worksheets from the same senders got their kind [step24_review_after4min].
- User-moment: "is it finished?"
- Observed confusion: no way to tell whether these are still being worked on, were skipped, or failed. I waited two more minutes; nothing.
- Harm: slowed.
- Class: QUESTION.
- Proposed alternative: on each: "Statement was added but this one couldn't be re-read automatically — press Reprocess to try." (or whatever the true reason is).
- What I may be missing: a cap or a "skip the one that's open" rule — if so, say it.

**4. "nanann" offered as a credit note number**
- Citation (Review, credit note 0029): field "CREDIT NOTE NUMBER" showing **"nanann"** with the note "⟳ Found on a second look — check it, then Confirm to keep." Paper prints "Credit Ref MVC-8136" [step32_credit_note].
- User-moment: first look at the credit notes after they got their kind.
- Observed confusion: it looks like the computer made a typo and is asking me to keep it. It is not a value anyone would type.
- Harm: trust-eroded (Confirm & File was green under it).
- Class: CONFUSION.
- Proposed alternative: never show a "second look" value that has no digits/letters shape of a reference; show "Not found" and leave the note off.
- What I may be missing: the stored value was actually blank — so "nanann" may be a display slip rather than a reading.

**5. One sender split three ways**
- Citation (Review, "Grouped by sender"): "Meadowvale Dairy Wholesale — 18 documents", "Dairy Wholesale — 1 document", "Meadowyale Dairy Wholesale — 1 document" [step28_review_tab].
- User-moment: scanning the pile by company.
- Observed confusion: confirmed as-is these land on three shelves; I'd only notice months later when the accountant asks for Meadowvale's credit notes.
- Harm: trust-eroded (misfile risk).
- Class: QUESTION (I'm not proposing an automatic merge).
- Proposed alternative: on the two odd ones: "The sender reads 'Meadowyale Dairy Wholesale' — one letter off from 'Meadowvale Dairy Wholesale' (18 documents). Same sender?" with a one-click fix.
- What I may be missing: this may already be caught at confirm time — I didn't confirm those two.

**6. Two promises not quite kept on the leftover paper**
- Citation (Review, Harrowgate 0020): "Press Reprocess (below, under 'This document') to re-read it, and it should file too." → after Reprocess: "Nothing was flagged on this document — check the values and confirm to file it." (it waited). Also "below the 90% you've set for filing without a check" — I never set anything to 90 (the wizard didn't ask) [step40_harrowgate_leftover, step42_after_reprocess].
- User-moment: following the app's own instruction.
- Observed confusion: I did what it said and it didn't happen; and being told I set something I didn't makes me doubt what else I "set".
- Harm: slowed / cosmetic.
- Class: QUESTION.
- Proposed alternative: "Press Reprocess to re-read it; if it reads clean it will be offered in File All Ready." and "below the 90% level for filing without a check (Settings → Processing)".
- What I may be missing: perhaps self-filing after Reprocess only happens on the "all in queue" road.

**7. Jargon in two new-ish sentences**
- Citation: catalog dialog — "so extraction has a head start before you teach anything"; not-set-up note — "it will never file itself automatically, whatever the confidence setting." [step19_catalog_dialog, step17_unrec_statement]
- User-moment: reading before ticking.
- Observed confusion: I wouldn't say either phrase to a colleague; "confidence setting" isn't a name I've seen anywhere in Settings.
- Harm: cosmetic.
- Class: PREFERENCE.
- Proposed alternative: "so it knows what to look for before you teach anything" · "however the automatic-filing level is set".
- What I may be missing: nothing — meaning kept.

**8. "Not recognised" doesn't mean what I thought**
- Citation: tab intro "Documents we couldn't identify. Open one to choose its type or teach it." (rendered as a 7-line sliver: "Documents / we couldn't / identify. / Open one to / choose its / type or / teach it.") — yet 60 papers with no kind at all (quotes, credit notes, delivery notes) sat in the ordinary Review tab, and 2 statements sat there labelled "Invoice" [step16_not_recognised, step28_review_tab].
- User-moment: deciding where to look for the unsorted paperwork.
- Observed confusion: I took "Not recognised 38" as the whole unsorted pile; it was the sender-less third of it.
- Harm: slowed (mild).
- Class: CONFUSION.
- Proposed alternative: "Not recognised — sender unknown" for the tab, and a small "no type yet" pill on kind-less rows in the Review list; give the intro a full-width line.
- What I may be missing: the tab may be intentionally about sender, not kind.

One-liners, not counted: "Set aside all" moved 7 papers to Deferred with no prompt and no word about what "set aside" means (reversible — each row has "Review"). Two Ironclad statements wear "Invoice" (held for a missing sender, so safe — but a statement labelled Invoice is my second-biggest fear). Search: natural phrasing "Harrowgate March 2026" finds nothing.

**Previously-reported items I could verify this round:** no-type dead end at Confirm — BETTER: "Choose a document type above before filing this document." is clear and Confirm stays greyed. Empty-folder-after-import alarm — not exercised. Teach-side items — not exercised. A "lingering catalog dialog" I first noted was almost certainly my own script opening the dialog twice; a clean replay (Receipt) closed it in 1 s — dropped.

---

## Warnings truth-table
| Button | What it said | Truth as seen |
|---|---|---|
| Delete (Search) | "Move this document to the recycle bin? You can restore it later." | TRUE — file stayed on disk while in the bin; bin listed it; Restore returned it ("They go back to where they were deleted from") and the file was still there. |
| Delete All Review | "Delete ALL 181 document(s)… They go to the app's recycle bin… Files on disk are kept. Confirmed and deferred documents are NOT affected." | Declined. Wording matches the single-delete behaviour. |
| File All Ready | "File 1 ready document (of 181)… 137 flagged… 43 missing a required detail… Each one is filed exactly as if you confirmed it yourself." | TRUE — filed exactly 1; strip "✓You filed 1 · 180 kept back"; Output 19→20. |
| Reprocess (one paper) | (no Quick/Full choice appeared) "✓ Reprocessed" in ~1.5 s | Re-read fine; the earlier "it should file too" was NOT kept — it waited as "Ready to file". |
| Reprocess all in queue | Quick/Full choice with plain copy ("Quick reuses the text already read…", "Full re-reads every document the usual way — slower…", "anything that re-reads clean will file straight away — you'll see it in the activity strip with a Put back") | Declined (Escape). Not verified, but I could restate every sentence. |
| Split ✂ | "This document is only one page — there's nothing to split." | TRUE. |
| Confirm & File | "Filed as Sales-Order.10-06-2025.HTS-SO-24857.pdf in Harrowgate-Timber-Supplies / 2025 / June." | TRUE on disk, every time (19/19 checked). |
| Add selected (catalog) / Add labels | No warning | Nothing filed itself — as promised. |
| Set aside all | No prompt | 7 → Deferred instantly; reversible per row. |

## What genuinely worked
The confirm road: a countdown I could see ("4 more confirmed before this sender files on its own"), "✓ files by itself" at five, "✓ 9 filed themselves" in the strip, every file on the Company/Year/Month shelf with the right name, and Home saying "1 sender files by itself · 9 filed by themselves". The in-place "Create type" for Quotation showed its work within ten seconds. Delete/bin/restore never let the file leave the disk.

## Top friction
Silence in the Review window while the app does the very thing I was told to watch for. Everything happened; the screen I was watching said none of it until minutes later, and never for the paper in front of me.

## Two-week verdict
**Would I keep using this after two weeks? Yes** — because once one sender graduated, the rest of its pile filed itself onto the right shelf without me, and nothing I deleted or set aside was ever lost. I'd nag about the quiet window, the false "Add 'Statement'" door, and "nanann".

## Humility block
- One simulated persona, not a user test. I comment only on screens driven tonight.
- My driver stood in for my mouse at two native folder pickers (set the output-folder value the picker would have set; set the import folder). I used the app's own read-outs to check state behind the screen when the window went quiet — every "underneath" claim above is from those reads, never a guess. I also read one switch state to make sure the self-sort was armed in my sandbox (it was: "true"; the auto-file level read 90 — I did not set it).
- One slip: a lost backslash in a script briefly saved the output folder as `…\chris-sandbox-20260924Output` (an empty sibling folder in the scratch area). I removed the empty folder and set the correct `…\chris-sandbox-20260924\Output` before any paper was processed; all 20 filed papers are under the correct folder.
- I never touched ports 9222/9223, killed nothing, and wrote nothing outside the sandbox and my driver folder. The sandbox app is still RUNNING (173 in Review, 7 deferred, 20 filed, kinds added: Credit Note, Delivery Note, Statement, Service Worksheet, Quotation, Receipt; one keyword "Credit Ref" on Credit Note).
- Everything here is a suggestion for the owner's vet; nothing was or should be changed on my say-so.

---

## Triage (main session, same night — owner pre-authorised "apply any fixes you deem suitable")

Source-verified against Chris's sandbox DB (read-only):
- **Card 3 root cause:** the 7 leftovers (5 Ironclad statements, 2 Castellan worksheets) all carried the engine's import-time
  note "Found '…' after straightening — confirm once." on stale flat-catalog date rows; the lane's "already asked"
  exclusion matches the whole "— confirm once." family, so untyped docs that were never asked anything were dropped from the
  redetect population. **FIXED:** the UNTYPED redetect job no longer applies the lane-note exclusion (an untyped doc was never
  asked; the re-type re-derives every hold); the override (typed) job keeps it. Pinned.
- **Card 2:** `detected_type_name` stays until a re-read clears it; the notice offered "Add 'Statement'" for an installed type
  and `_addDetectedType` fell through to "create" because the catalog lookup hides present presets. **FIXED:** the notice now
  says the type is set up and offers "Read it as a Statement" (selects the type + reprocesses); `_addDetectedType` resolves an
  installed type first. Pinned.
- **Card 4:** "nanann" came from the on-open fast re-extract SUGGESTION road (`reextract_fast_enabled` ON in the sandbox):
  a text-only read of a skewed scan filled the empty reference input with no shape gate (the engine's `ref_role_digit_gate`
  guards cold commits, not this display-only path). **FIXED:** the fast-suggestion builder drops a suggestion for the type's
  reference role with no digit, and any suggestion with no letter or digit.
- **Card 1:** the redetect ran in "silent" quiet mode (`quiet_reread_silent`): no hint, list refresh deferred while a doc was
  open, the open doc correctly left alone but never told. **FIXED (receipt):** on a redetect's completion the Review list is
  refreshed at once (the open document's pane is never touched), a toast says how many were re-read after what you added,
  and — when the open document was one the pass left alone — that it was left as it was and Reprocess applies it. The lane
  now reports the viewer-skipped ids in its job_done event.
- **Cards 6, 7, 8 (layout):** copy fixed ("if it reads clean it will be offered in File All Ready"; "the 90% level for filing
  without a check (Settings → Processing)"; "so it knows what to look for"; "however the automatic-filing level is set"); the
  Not-recognised intro now wraps full-width and says what the tab means (the SENDER couldn't be identified).
- **Logged for the owner (not built):** card 5 (near-identical sender names — an identity/near-match arc, needs a gate);
  card 8's tab rename + a "no type yet" pill on kind-less rows (design call); "Set aside all" without a prompt; two Ironclad
  statements typed Invoice (detection; held anyway); natural-language search phrasing; a durable activity-strip receipt for
  the redetect (Oracle: KINDS extension skipped for now).
