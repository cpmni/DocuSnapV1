# Chris The Customer — Full App Review — 2026-09-13 (overnight, sandboxed)

> **Round conditions.** Ran under `/christest` per the owner's standing safety contract: an ISOLATED second
> instance (CDP port 9223, its own `userData`, a COPY of Demo Docs — the owner's live app/DB/Desktop never
> touched), Chris free to break anything in the sandbox, findings queued for the owner and **implemented by
> nobody without the owner's explicit go**. He vetted the CURRENT shipping build (the dark QuickFile/Departments
> work was out of scope). Verdict: **YES — would keep using.** All 8 warnings TRUE. 7 new cards (all
> CONFUSION/QUESTION/PREFERENCE — none destructive). Report verbatim below.

---

**TL;DR (3 lines):** I set up from a blank slate, imported 20 real invoices, taught one field, filed the lot, searched them back, and pressed every scary button — and the app did what it said and kept my paper safe. The filing, the practice run, and the honesty of the warnings are genuinely good. The rough edges are all about *flags that don't earn their place* and a couple of half-reachable corners (self-approval, self-stamp).

## Walkthrough (with screenshots)
- **First screen → account** (`step01`, `step02`): Clean "Create the administrator account" with a plain explanation. Then a **recovery-code** screen (`step02`) — big code, Copy/Print, and "Continue" stays greyed out until I tick "I have saved this code somewhere safe." Scary in the *right* way.
- **Terms** (`step03`): "Accept & Continue" greyed until I tick the box. Contact + reseller (Polar) named. Standard, fine.
- **First-run wizard** (`step04`–`step07`): "Everything stays on this computer" up front (reassuring), pick a filing folder with a plain "a folder for each company, then year and month" explanation, a live filename preview (`step06`), speed/look choices, and **diagnostics off unless you turn it on**. Good.
- **Welcome tour** (`step08`, `step09`): six plain-English cards that set the expectation "some file themselves, some wait for you."
- **Practice run** (`step10`–`step16`): the standout. A watermarked "SAMPLE — PRACTICE ONLY" invoice, I drew boxes to teach it, it caught a deliberate misread (`INV-1O42`, letter-O for zero) at **54%** with a helpful "the scan is smudged here" note, I corrected it, and it showed me the exact before→after filenames. "Nothing here touches your real files."
- **Import 20 invoices → Review** (`step17`–`step22`): imported one supplier's invoices; all 20 came in needing a look at 63%. I taught the company name with the ⊕ draw-a-box tool (`step20`, `step21`), hit **Confirm & File**, and the queue dropped from "20 need a look" to "**2 need a look**" with "2 more confirmed before this sender files on its own." The file appeared on disk exactly as promised: `Northgate-Textiles/2026/October/Invoice.04-10-2026.INV-27252.pdf` + a sidecar.
- **File All Ready** (`step23`): truthful bulk warning, filed the batch.
- **Delete / Empty bin / Restore** (`step24`, `step26`): single-delete → recycle bin; bin restore put it straight back.
- **Search + workflow** (`step25`, `step27`, `step28`, `step32`, `step33`): found a filed invoice instantly, opened the Send/approval flow and the Mailbox.

## Finding cards (ranked by harm)

**1. The summary says "check 1 field" when every field reads fine — CONFUSION / trust-eroded**
- **Citation (verbatim):** Review panel — amber box "**Needs a quick check — 1 field was read with low confidence.**" / "**Low confidence · 1**", sitting above three fields all reading "**High · 90%**", "**High · 94%**", "**High · 95%**" (`step22`).
- **User-moment:** I'd just taught the company name and moved to the next invoice.
- **Observed confusion:** The banner tells me one field needs checking, but all three fields on screen say High and look right. I'd hunt for the problem field, find none, and not know whether I'm missing something. (It only sorts itself out after a Reprocess.)
- **Harm:** trust-eroded — a flag with nothing to fix trains me to ignore flags.
- **Class:** CONFUSION.
- **Proposed alternative:** Make the top banner agree with the fields shown — if every field is High, don't say "check 1 field." If one genuinely is low, highlight *that* field so I can see which.
- **What I may be missing:** This may be a brief lag that catches up on its own; but in the moment it reads as a contradiction.

**2. My very first batch showed "20 need a look" at 63% — slowed / daunting first impression**
- **Citation (verbatim):** "**Northgate Textiles — 20 documents · 20 need a look**"; each field "**Check · 69%**" with the tooltip "**Read at 69% — worth a glance, but the value may well be right. Only teach this field (⊕) if the value shown is actually WRONG.**" (`step19`).
- **User-moment:** First real import, before I knew any tricks.
- **Observed confusion:** The company name is printed clear as day at the top, yet all 20 came in marked for a look. My first thought was "it can't read any of them." (It's actually fine — teaching *one* dropped it to 2 — but a new user doesn't know that yet.)
- **Harm:** slowed / first-impression trust.
- **Class:** QUESTION.
- **Proposed alternative:** On the first batch from a brand-new sender, one line like "New supplier — check the first one and I'll handle the rest" would turn alarm into a next step.
- **What I may be missing:** The tooltip is honest that the value "may well be right," and the payoff after teaching one is excellent — so this is a first-five-minutes scare, not a lasting tax.

**3. I couldn't approve a document waiting in my own Inbox — QUESTION / workflow blocked (solo)**
- **Citation (verbatim):** Mailbox → Inbox item "**Northgate Textiles — INV-93617**", "**pending**", "**Approval · from chris.fenton**"; the only actions offered were "**↩ Send back to Review**", "**Delete**", "**✉ Send…**" (`step33`).
- **User-moment:** I sent an invoice for approval, opened it in my Inbox to approve it.
- **Observed confusion:** There's no Approve or Reject button anywhere, and nothing tells me why.
- **Harm:** blocked (for this task).
- **Class:** QUESTION.
- **Proposed alternative:** If you can't approve your own request, say so on the item ("You sent this — someone else approves it"). If it's meant to be approvable, show Approve/Reject.
- **What I may be missing:** As a one-person office I could only send to myself, so this may be a deliberate "no approving your own request" rule — I couldn't test with a second person.

**4. "Stamp it myself" isn't clearly offered in the Send box — slowed / CONFUSION**
- **Citation (verbatim):** The Send box is headed "**Send this document**" but the body only reads "**Send this document to a colleague.**" with Why/To/Send (`step28`, `step31`). The words "Stamp it myself" exist behind the scenes but I couldn't see or click a way to choose it.
- **User-moment:** I wanted to stamp a paid invoice myself, not send it to anyone.
- **Observed confusion:** The dialog only presents "send to a colleague," so I couldn't find the "just stamp it" path.
- **Harm:** slowed — a whole feature (stamp + save a stamped copy) was out of reach for me.
- **Class:** CONFUSION.
- **Proposed alternative:** Show two obvious choices at the top: "Stamp it myself" vs "Send to someone."
- **What I may be missing:** It might be a subtle toggle my hands couldn't land on; a sighted user with a mouse may spot it.

**5. It said it would keep 2 back for me, then one filed itself — QUESTION / low harm**
- **Citation (verbatim):** File All warning "**...2 flagged — waiting for you to check a value...**"; moments later the activity strip read "**✓ You filed 17 · 2 kept back**" and "**✓ 1 filed themselves**" (`step23`, `step29`).
- **User-moment:** Right after a bulk file.
- **Observed confusion:** It promised to hold 2 for me, then one of them filed on its own once the supplier "graduated." The end count (1 left, not 2) briefly didn't match the promise.
- **Harm:** low — my fear is "something filed without me," but the strip *did* log it plainly.
- **Class:** QUESTION.
- **Proposed alternative:** A tiny note when it happens: "1 you'd kept back is now trusted, so I filed it."
- **What I may be missing:** This is honest and visible in the activity strip — it just needs to connect back to the earlier "kept back" promise.

**6. "all 1 document" reads clumsily on scary dialogs — cosmetic**
- **Citation (verbatim):** "**Permanently delete all 1 document in the recycle bin...**", "**Restore all 1 document...**", "**Delete ALL 1 document(s)...**".
- **User-moment:** Reading the delete/restore confirmations.
- **Observed confusion:** "all 1 document" and "document(s)" look unfinished — on a delete dialog I want it to feel carefully written.
- **Harm:** cosmetic (mild trust).
- **Class:** PREFERENCE.
- **Proposed alternative:** "Delete this 1 document" / "Delete these 17 documents."
- **What I may be missing:** Purely wording; the meaning is clear.

**7. A couple of small word choices I'd stumble over — cosmetic**
- **Citation (verbatim):** "**Recognised by**", "**Fields read by**", and "**Change what's read from Northgate Textiles's documents**" (`step19`, `step22`).
- **User-moment:** Skimming the right-hand panel.
- **Observed confusion:** "Textiles's" reads awkwardly, and "Recognised by / Fields read by" are a shade technical for a first look.
- **Harm:** cosmetic.
- **Class:** PREFERENCE.
- **Proposed alternative:** "Change how I read Northgate Textiles documents."
- **What I may be missing:** Once you've used it a bit, these labels make sense.

## Previously-reported items — quick verifies
- **"Phantom flag pointing at no visible field" (prior round):** NEW-PROBLEM / still present in spirit — see card 1. It's **BETTER-BUT**: every field now shows a plain %-and-bar so I can at least *see* they're all fine, but the summary flag still disagrees with them.
- **"Mailbox card shows Type —/Unknown" (prior round):** Looks **FIXED** in what I saw — my Mailbox item read "Northgate Textiles — INV-93617" with the right type, no "—/Unknown."
- **"Import list doesn't flip to Filed after a manual confirm" (prior round):** COULDN'T VERIFY — I started the import through the app's own "process this folder" action rather than the picker, so I didn't watch the live import list.

## Warnings truth-table
| Button | What it warned | What actually happened | Verdict |
|---|---|---|---|
| Confirm & File | (no warning) | Filed to Company/Year/Month + sidecar; queue −1 | TRUE (correct, no warning needed) |
| File All Ready | "File 17 ready (of 19)? 2 flagged stay. Each filed as if you confirmed it." | 17 filed, 2 kept back; 1 later auto-filed (logged separately) | TRUE |
| Delete (single 🗑) | "...goes to the app's recycle bin — you can restore it from Search." | Went to recycle bin; restored fine | TRUE |
| Empty bin | "Permanently delete... This cannot be undone. Your original scans in the Processed folder are not touched." | (cancelled) — description accurate | TRUE |
| Restore all | "...go back to where they were deleted from (the review queue, or their filed folder)." | Returned to the review queue | TRUE |
| Delete All Review | "...go to the app's recycle bin — restore any time... Files on disk are kept. Confirmed and deferred documents are NOT affected." | (cancelled) — description accurate | TRUE |
| Split PDF | "This document is only one page — there's nothing to split." | Correct (1-page invoice) | TRUE |
| Reprocess | (no warning) | Re-read the doc (non-destructive), came back clean | TRUE (acceptable) |

**Every warning told the truth.**

## What genuinely worked
- **The practice run.** Teaching, importing, catching a real misread, correcting it, and showing the exact before→after filenames — in a sandbox that "never touches your real files." Best onboarding I've seen in this app.
- **The teaching payoff is visible and fast.** Teaching one company name + confirming one invoice flipped 17 others to "ready" and started a "files on its own" countdown.
- **Filing is exactly as promised.** 19 invoices in `Company/Year/Month/Type.Date.Ref.pdf` with sidecars, and my 20 original scans were **moved into a "Processed" folder, none deleted**.
- **Honest, reassuring warnings** — recycle bin, "files on disk are kept," "originals not touched," "cannot be undone."
- **The activity strip shows its work** — "you filed 17 · 2 kept back · 1 filed themselves."
- **Search + restore** — found a filed invoice instantly by number; recycle-bin restore worked.

## Top friction
Flags that don't earn their place at the start. My first batch shouted "20 need a look" and the summary kept saying "check 1 field" even when every field on screen read High. It turns out fine — teaching one invoice clears most of it — but for the first ten minutes it made me doubt the app was reading anything correctly.

## Two-week verdict
**Yes — I'd keep using it.** It filed my invoices exactly where it said, kept every original safe, told the truth every time it warned me, and got noticeably smarter after I taught it once. The flag noise at the start is annoying but it settles, and nothing I did ever lost or hid a document.

## What I couldn't test / may have misjudged (humility)
- I'm **one made-up person, not a real user test** — treat this as one lens.
- I drove the app with automation, so I **triggered the import through the app's own "process this folder" action** (I can't operate the Windows folder picker). That means **I never saw the live import progress strip** a real user watches, and card verification for the import list is limited.
- Because I couldn't operate the picker, the setup wizard briefly kept its **suggested default folder** before I pointed filing at the sandbox; the app's folder check may have created that empty folder. A normal user picks their own folder in one click. **All 19 documents filed into the sandbox** — nothing filed outside it.
- **Approve/Reject and Stamp-it-myself/Save-a-copy I could not complete** — as a one-person office I could only send to myself, and the self-stamp path wasn't clearly reachable. My cards on those note the uncertainty.
- I **took the "nothing leaves this PC" claims at face value** — I can't watch network traffic.
- I checked that all 19 filenames were sensible (right company, varied dates/numbers, no duplicates) but **did not open all 19 filed PDFs** to confirm every read was perfect.

---

# ROUND 2 — Quick File focus (autonomous sandbox vet, 2026-09-13 afternoon)

Sandbox: isolated instance port 9223 (PID 1368), own userData + a COPY of Demo Docs + two seeded non-OCR
files (Office Supplies Order.xlsx, Meeting Notes.txt), `direct_intake_enabled` ON. Chris briefed to focus
on Quick File. NOTE: the sandbox launched before the submit-PANE commit, so Chris vetted the MODAL submit
flow + the shipped preview features (xlsx grid, find-in-doc, fast page). Findings queue for the owner —
IMPLEMENT NOTHING without the owner's go (except finding 4, which is the owner's own prior request; fixed).

**VERDICT: YES — "I'd keep using it."** Core promise holds: type details → pick file → filed into
Company/Year/Month with tidy names + metadata XML, searchable within seconds (content indexed: "Stapler"
a cell value, "kickoff" a notes line, "Bramblewood" PDF text), and NEVER entered Review (verified empty).
xlsx grid preview "a delight"; multi-file batch smooth; delete/restore safe (originals kept); onboarding
safety gates good.

**8 findings (ranked by harm):**
1. **"Send back to Review" strands a Quick File doc in un-fileable limbo** (highest harm). Clicking the
   prominent blue "Send back to Review" on a filed Quick File doc → Review shows "The scanned page for this
   document is no longer available… nothing to file", **Confirm & File is DISABLED**, and there's no path
   back to Filed. The file IS on disk but nothing says so ("scanned page no longer available" implies loss).
   Warning "It stays filed until you re-confirm it" is MISLEADING (you can't re-confirm). → For non-scanned
   docs, hide "Send back to Review" OR keep it with honest copy + keep an Edit-details/Confirm path.
2. **.txt shows "No preview available"** though its content is searchable (xlsx shows a grid) — reads as a
   bug via the inconsistency. → show text inline (already extracted) or "This is a text file — Open File".
3. **Jargon** in the modal: "It never runs OCR and never teaches the scanner." → plain rewrite / drop it.
4. **Office/text docs show broken-image thumbnails in Search results** (verified `<img>` naturalWidth 0,
   empty src, filename as alt; PDF row fine). *[= the owner's earlier request; FIXED this session — clean
   document-glyph placeholder replaces the broken img.]*
5. **Quick File undiscoverable** beyond the nav rail (tour + setup checklist never mention it).
6. **Duplicates filed silently** (only "Filed 1 document(s)"; a -DUPLICATE.xlsx appears with no notice).
7. **"Find in this document" only works on PDFs**, not the Excel/text files Quick File promotes.
8. **"100% / High confidence" shown on hand-typed fields** — odd ("100% of what?").

**Warnings truth-table:** Delete → TRUE; Restore → TRUE (grammar "all 1 document" odd); Send back to
Review → MISLEADING for Quick File (says re-confirm, but can't); File duplicate → no warning (silent copy).

**Couldn't test (humility):** the native "Choose files" picker (drove via SendKeys); only .xlsx/.txt/.pdf
(+ an unsupported .log) — NOT .docx/.eml/.msg, a very large file, or interrupting the progress; did not
press "Open File" (external app). First-impression single-session; some (broken thumbs) may differ on a
packaged install.
