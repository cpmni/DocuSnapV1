# Chris The Customer — Full App Review — 2026-09-03 NIGHT

> **Round conditions:** fresh sandboxed instance (isolated userData + copied Demo Docs), CDP port 9223,
> real PrintWindow screenshots, under the owner's safety contract (sandbox only, no code changes, findings
> queue for the owner's vet). Focus this round (owner's args): the new truthful reference note
> (`FILING_SANITY_REF_CORROB_SOFTEN`), reference-number flags on serial docs, and the watch-folder split
> import (the `db_id` fix). Sandbox was COLD, so the reference note was judged as COPY (can't fire without
> learned history). Report appended VERBATIM below. **IMPLEMENT NOTHING without the owner's explicit go.**

---

**TL;DR (3 lines):** The first-run experience (account → recovery code → terms → 7-step wizard → tour → practice run) is genuinely excellent, and every destructive button warns you truthfully before it acts. The owner's watch-folder fix works — clicking a result row opens the *right* document, never the first. But the Import "results" list keeps saying "Confirm to file →" on documents I've *already filed*, which is the one place the software stopped telling me the truth about where my paper is.

## Walkthrough (what each screenshot shows)
- **step1 / step2_recovery** — Sign-in ("no default credentials — you choose everything") then a clear one-time admin recovery-code screen; "Continue" stays greyed until I tick "I have saved this code somewhere safe."
- **step3_terms** — Terms gate; "Accept & Continue" disabled until ticked, "Decline & Quit" offered.
- **step4–step9 (onboarding)** — 7 steps: welcome ("Everything stays on this computer… never uploaded"), output folder (I redirected it to the sandbox Output — it was pre-filled to my Documents), a **live filing preview** ("…Smith-&-Sons-Builders-Ltd › 2025 › December › Invoice.15-12-2025…"), performance, diagnostics (defaults to "No thanks" with a plain list of exactly what's sent), and "You're all set ✔".
- **step10–step12 (tour + practice)** — 6-card tour, then a watermarked "SAMPLE — PRACTICE ONLY" teaching sandbox ("Nothing here touches your real files").
- **step14–step15 (home + import)** — Home checklist ticks itself as I go; imported 10 scanned docs → all 10 need review, 8 flagged (expected cold).
- **step17/step18 (review)** — Buyer-issued PO and a Pelican sales-invoice; the reference reads "P1/25/3699" (the classic P1/PI case) but the "reads as X / full-page reads Y" note did **not** fire — correct, the sandbox is cold.
- **step19/step20 (confirm + search)** — Confirmed Pelican; it filed to `Output/Pelican-Office-Interiors/2025/May/…` and searching "Pelican" found it instantly.
- **step21–step25 (watch folder)** — Set up auto-import; dropped a 3-supplier bundle (imported whole) + 3 files; verified result rows.
- **step27–step31 (scary buttons)** — Delete + restore, File All Ready, Split, Reprocess, Delete All.

---

## Finding cards (ranked by harm)

### 1. The Import "results" list still says "Confirm to file →" for documents I already filed
- **Citation (verbatim):** Import → PROCESSED DOCUMENTS, row "Bramblewood Joinery Ltd · 15-09-2025 · PO-11127" — STATUS: **"Confirm to file →"** (unchanged after I filed it; step25).
- **User-moment:** I'd just confirmed & filed that purchase order; I glanced back at the import list to see it was done.
- **Observed confusion:** The document is genuinely filed (it's on disk at `…/Bramblewood-Joinery-Ltd/2025/September/Purchase-Order.15-09-2025.PO-11127.pdf`), yet its row still invites me to "Confirm to file". I left the tab and came back — still "Confirm to file →". Worse, clicking that row **re-opens the filed document in Review with a green "Confirm & File" button**, as if it were never done.
- **Harm + severity:** trust-eroded, and a possible **duplicate-file** trap — this is the exact "results rows show the correct status (Ready to file / Filed)" thing you asked me to check.
- **Class:** CONFUSION.
- **Proposed alternative:** once a row's document is filed, flip its status to **"Filed ✓"** (with an "Open in folder" link instead of "Confirm to file"), and have clicking it show the filed document rather than re-offering the confirm button.
- **What I may be missing:** I did **not** press "Confirm & File" on the reopened row, so I can't say for certain it would create a duplicate versus being caught — I stopped to avoid muddying the test. The row→document *mapping* itself is correct (see "worked well").

### 2. A multi-page bundle dropped in the auto-import folder is swallowed as one document — pages 2 and 3 vanish inside it
- **Citation (verbatim):** After dropping a 3-supplier PDF into the watch folder, one row appeared: **"DELIVER TO · 21-08-2025 · SB-ORD42102"**; opening it, the reader shows "Page 1 / 3" (Silverbeck), with Ironbridge/Quillstone on pages 2–3.
- **User-moment:** I dropped what for me is "three different suppliers' paperwork" into the auto-import folder and expected three things to file.
- **Observed confusion:** It came in as **one** document, read only from page 1, and labelled the company "DELIVER TO". Pages 2 and 3 are effectively hidden. A busy office person would think two documents went missing.
- **Harm + severity:** slowed / "where's my paper" doubt — the two absorbed pages have no visible presence of their own.
- **Class:** QUESTION.
- **Proposed alternative:** when the auto-import folder receives a multi-page PDF, either split it like manual import does, or show a one-line nudge on that row ("3 pages — looks like more than one document. Split?").
- **What I may be missing:** the app *does* flag the bad company read ("DELIVER TO" shows "Check · 45%" and "looks like a document heading, not a name — please verify"), and the Split tool is right there to break it apart — so this may be the intended "import whole, split by hand" behaviour rather than a bug.

### 3. "3 fields were flagged by a formatting check" — but nothing tells me *which* field or *why*
- **Citation (verbatim):** amber box, "Needs a quick check — 1 field was read with low confidence, and **3 fields were flagged by a formatting check.**" with a "**Format check · 3**" tag (step18, Pelican).
- **User-moment:** I read the amber summary and looked down at my three fields to fix whatever's wrong.
- **Observed confusion:** The three fields show a "Check/High" mark and helpful per-field notes ("Read differently after straightening… confirm once"), but **none of them says it has a formatting problem**. So "3 fields flagged by a formatting check" points at fields that look fine to me — I don't know what to check.
- **Harm + severity:** slowed — an alarm I can't act on.
- **Class:** CONFUSION.
- **Proposed alternative:** put the "formatting check" mark on the actual field it refers to (a small "format looks unusual" note under that one field), or drop the summary count if it can't be tied to a field.
- **What I may be missing:** the mark may be attached to a field in a way my automation didn't capture visually; a hover or click I didn't try might reveal it.

### 4. On a fresh batch, every single document says "confirm it's the sender, not the customer" — so I stop reading it
- **Citation (verbatim):** on all 7 identified senders, the same note: **"The letterhead reads '<name>' — filled in for you, but please confirm it's the sender, not the customer, before filing."** plus every doc's company shows "Check · 69%".
- **User-moment:** working down a 10-document first batch.
- **Observed confusion:** identical wording on every document (plus a "Format check" tally on most) trains me to ignore it. When a note appears on *everything*, it stops meaning "look here".
- **Harm + severity:** warning fatigue / slowed on the cold batch.
- **Class:** PREFERENCE.
- **Proposed alternative:** only surface the sender/customer note when the page genuinely has two company blocks that could be confused, and lean on it fading as the software learns each sender.
- **What I may be missing:** this is a *cold-start* effect — I watched it work: after I confirmed one Bramblewood document, a sibling immediately became "1 more ready to file by itself", so the noise clearly drops with use.

### 5. The new reference note reads well (copy judgement, since it couldn't fire live)
- **Citation (verbatim, from the brief):** "This reference reads as 'X' where it is labelled, but the full-page text reads it as 'Y' — please confirm the reference before filing."
- **User-moment:** imagining this appearing on a printer/serial-style document.
- **Observed confusion:** Read aloud, I understand it: where it's labelled it says X, but elsewhere on the page it looks like Y, so check it. That is **clearly less alarming and more actionable** than "'X' doesn't appear on this page as written" (which sounded like the number was fake). It tells me exactly what to do.
- **Harm + severity:** cosmetic — this is mostly a win.
- **Class:** PREFERENCE.
- **Proposed alternative:** the only word I'd stumble on is "full-page text" — a colleague would say "elsewhere on the page it looks like 'Y'". Otherwise leave it.
- **What I may be missing:** I never saw it live (cold sandbox, as you predicted), so I'm judging wording, not the moment it actually appears.

### 6. Bare percentages on fields and red "31%" chips on documents are a touch technical
- **Citation (verbatim):** field marks "Check · 69%", "High · 94%"; queue rows show a red "**31%**" chip.
- **User-moment:** scanning the queue for what needs me.
- **Observed confusion:** the words ("Check", "High") are perfect; the raw numbers are engineer-speak. "31%" on a document row doesn't tell me *what's* uncertain about it.
- **Harm + severity:** cosmetic.
- **Class:** PREFERENCE.
- **Proposed alternative:** keep the plain words and, on the row chip, prefer a word ("Needs a look") over a number.
- **What I may be missing:** some users like a number; this is taste, not a blocker.

---

## Warnings truth-table (button → what it warned → what actually happened)

| Button | What it warned | What actually happened |
|---|---|---|
| **Delete (row ×)** | "Delete '…0011.pdf'? Note: this is the document in the row you clicked — NOT '…the document open on the right'. It goes to the app's recycle bin — you can restore it from Search." | Deleted that exact document (count 15→14); appeared in Search → Recycle bin. **True**, and the row-vs-open-doc note is genuinely helpful. |
| **Restore all** | "Restore all 1 document… They go back to where they were deleted from (the review queue, or their filed folder)." | Document returned to the queue (14→15); bin emptied. **True.** |
| **File All Ready** | "File 1 ready document (of 15…). Not included: 10 flagged, 2 no type, 2 missing a detail. Each is filed as if you confirmed it. Anything that needs a detail is left in the queue." | Filed **exactly 1**; the 14 flagged/typeless/incomplete stayed. Output went 2→3 files. **True, to the number.** |
| **Split PDF** | "Splitting replaces this document… the original PDF is permanently removed (not to the recycle bin) once the parts are safely created." | (Read only — I didn't execute.) On a 1-page doc it honestly said "only one page — there's nothing to split." **Warning is clear and flags irreversibility.** |
| **Reprocess** | (no warning) | Re-read the document, no prompt. **Correct** — nothing is lost, so no scare needed. |
| **Delete All Review** | "Delete ALL 14 document(s)? They go to the recycle bin… Files on disk are kept. Confirmed and deferred documents are NOT affected." | Queue → 0; recycle bin → 14; the 3 filed docs in Output untouched. **True on every clause.** |

## What genuinely worked well
The **destructive-action warnings** are the best I've seen in this app — every one states the exact count, where things go, what is *not* affected, and whether it's reversible. And the specific fix you flagged **works**: I clicked four different result rows (including a blank-company row and the bundle) and each opened *its own* document, never defaulting to the first. The onboarding chain (recovery code gate, live filing preview, "off unless you turn it on" diagnostics) is reassuring and honest.

## Top friction
**The Import results list lies about status after filing** (Finding 1). It's the one screen that summarises "what did the software just do with my batch," and when a filed document still reads "Confirm to file →", I lose confidence that the list reflects reality — the opposite of what a "where's my paper" summary should do.

## Two-week verdict
**Yes — I'd keep using it.** Nothing lost, everything I filed was findable in seconds, and the warnings made me trust the scary buttons. The stale import-list status and the "which field has the formatting problem?" mismatch would nag me weekly, but they'd slow me down, not stop me.

## Humility block (what I might have gotten wrong)
- I drive the app through automation, so I read the DOM as much as the pixels. My field-label capture leaked the Straighten flyout's "Only if tilted more than °" text into a couple of raw dumps — I confirmed the actual field values and marks from the screenshots, not those dumps.
- On Finding 1, I deliberately did **not** press the reopened "Confirm & File" on an already-filed document, so I can't confirm whether it would duplicate or be caught — treat the duplicate risk as "possible, unverified."
- The reference note (Finding 5) I judged as **copy only** — the sandbox is cold, so I never saw it fire, exactly as you predicted.
- I'm one simulated office manager, not a user test — "I would…" is my own reaction, not "users found…". Everything above is a suggestion for your vet; I changed no code, copy, or settings, and only ever wrote into the sandbox folders.
