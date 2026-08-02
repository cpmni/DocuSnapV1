# Chris The Customer — Full App Review

> Findings are SUGGESTIONS for the owner to vet, never code changes. Nothing here gets
> implemented without the owner's explicit go.

---

## Round: 2026-08-02 OVERNIGHT2 (sandbox vet, full walkthrough)
Sandbox conditions: isolated instance on CDP 9223 (PID 22296), fresh DB (create-admin first-run),
Demo Docs copied into the sandbox, output to the sandbox Output folder. Extra owner focus this
round: the re-skinned Search window, the preview error state, the Home "Open Mailbox" deep-link,
and the Light⇄Dark quick-flip. Report appended VERBATIM below.

---

Sandbox is tidy (no leftover `.bak`; inbox count reconciles). Note a nice bonus: approving auto-saved a stamped copy next to the original (`...INV-94023.APPROVED-stamped.pdf`) — without me clicking "Save a copy". That's the app showing its work.

I have everything. Here is my review.

---

# Chris The Customer — Sandbox vet (full walkthrough)

**One simulated persona, not a user test.** Read-only lens; every card below is a SUGGESTION for the owner to vet, never a change. I drove the live sandbox (CDP 9223) end to end: first-run → import 20 invoices → review/teach/file → search → workflow → every scary button → all 13 Settings tabs.

## TL;DR (3 lines)
- The plumbing is genuinely solid: filing lands where promised, originals are kept, **every destructive warning I tested told the truth**, and the approval-stamp flow is excellent.
- Two things would make me hesitate on day one: the **Terms screen makes me accept a document that says it's an unfinished draft "NOT YET IN FORCE"**, and the **company name on a brand-new supplier reads as "Not found"** even though it's the biggest text on the page.
- A scatter of computer-speak leaks through ("needs_review", "63% confidence", "document_open", "(supplier_name)") that a normal office user shouldn't see.

---

## What I did, in order
Created the admin account (step01) → saved the recovery code (step03) → **accepted the Terms** (step05) → onboarding wizard set my output folder with the paper-shelf metaphor (step09) → welcome tour + practice run, both clearly sandboxed (step16-17) → set output to the sandbox folder → **processed 20 Copperfield invoices** (all landed in Review) → taught the Document Issuer by **drawing a box** round the company name (step29, it read "Copperfield Electrical") → **Confirmed & Filed** one (step30) → verified it filed to `…/Copperfield-Electrical/2026/April/Invoice.18-04-2026.INV-94023.pdf` with a tidy metadata record, and the originals moved to a "Processed" folder → **searched** "INV-94023" and found it (step32-33) → ran the **approval workflow** end to end: send → Mailbox → two-step Approve → History → **stamped viewer** (step41) → pressed **every scary button** → walked **all 13 Settings tabs**.

---

## Finding cards (ranked by harm)

### 1. The Terms I must accept say they're an unfinished draft, and contain internal notes to a solicitor
- **Citation (verbatim, step05):** *"WORKING DRAFT — FOR LEGAL REVIEW ONLY. NOT YET IN FORCE. This document is a first-pass draft prepared for the business owner and must be reviewed and finalised by a qualified solicitor…"* and, inside clause 1, *"[SOLICITOR: confirm the enforceable contracting-party identity…"* (I counted **9** "[SOLICITOR:]" notes).
- **User-moment:** First launch — the gate won't let me in until I tick "I have read and accept the Terms of Use."
- **Observed confusion:** I would read "NOT YET IN FORCE" and think "am I agreeing to something that isn't finished — is this even real?" Seeing notes addressed to a solicitor in a contract I'm signing makes the whole product feel unfinished.
- **Harm + severity:** trust-eroded — **high** (it's the very first serious screen; it colours everything after).
- **Class:** CONFUSION / QUESTION.
- **Proposed alternative:** Ship the finalised Terms text (drafting banner + all "[SOLICITOR:]" notes removed) before this reaches a paying customer; the acceptance mechanism itself is fine.
- **What I may be missing:** This is almost certainly a placeholder legal file not meant to ship — but it IS what's on screen in this build, so I'm flagging it.

### 2. On a brand-new supplier, the company name reads as "Not found" — even though it's the biggest thing on the page (TOP friction)
- **Citation (verbatim, step24/step26):** field **"Document Issuer — Not found"** while "Copperfield Electrical" is printed in large letters at the top; footer note *"No Document Issuer yet — if you file now it will be saved under 'Unknown Company' and the app won't learn this sender."*
- **User-moment:** First look at my imported batch — I expected the app to have grabbed the company, the date and the reference for me.
- **Observed confusion:** All 20 invoices came in "Not yet identified"; the date and reference read fine, but the **company** — the one thing the whole filing shelf is built on — was blank on every one. I have to teach or type it myself before I trust the batch. If it can't read "Copperfield Electrical" in giant red letters, I'd wonder what else it's missing.
- **Harm + severity:** slowed / trust-eroded — **high** for the daily job (filing-by-company is the core value).
- **Class:** CONFUSION.
- **Proposed alternative:** On a not-yet-known sender, still take a best guess at the company from the top-of-page heading and show it as a "please check" value, rather than a bare "Not found" that reads like failure.
- **What I may be missing:** It's the first time it's ever seen this supplier, and the moment I pointed the company out **once**, it started offering *"Use 'Copperfield Electrical' — the logo looks similar"* on the other invoices (step59) — so it clearly learns fast. My gripe is only the cold-start on document #1.

### 3. The Recycle bin shows a different document's preview than the one in the list
- **Citation (verbatim, step51):** list reads **"RECYCLE BIN 1 — CopperfieldElectrical_invoice_16.pdf"**, but the right-hand details simultaneously showed **"REFERENCE INV-94023 … STATUS confirmed"** with an "Approved by chris.fenton" history — a *different, already-filed* invoice.
- **User-moment:** I deleted invoice_16 and opened the recycle bin to check it landed there safely.
- **Observed confusion:** The list says invoice_16, the big preview and details say INV-94023. If I now press a button, which document does it act on? I clicked the bin item and it corrected itself (then showed "STATUS deleted" and a "Restore" button, step52) — but for a moment I couldn't tell what I was looking at.
- **Harm + severity:** trust-eroded — **medium** (in the one place I go specifically to rescue a document, the screen shows me the wrong document).
- **Class:** CONFUSION.
- **Proposed alternative:** On opening the recycle bin, auto-select the first bin item (or blank the preview) so the details always match the list.
- **What I may be missing:** It self-corrected on click, so it may be a momentary stale panel rather than a wrong-target action.

### 4. Documents I've already checked and filed still show a percentage labelled "confidence"
- **Citation (verbatim, step33/step37):** on the confirmed invoice, **"Confirmed 63% confidence"**; in the deleted-item panel, **"READING CONFIDENCE … 31%"** and **"Needs Review 31% confidence"**.
- **User-moment:** I open my filed invoice in Search to check it.
- **Observed confusion:** I confirmed this document myself — so why does it still say "63%"? Is something still wrong with it? "Confidence" isn't a word I'd say to a colleague, and putting a low-looking number next to "Confirmed" makes a finished job look unfinished.
- **Harm + severity:** trust-eroded — **medium/low**.
- **Class:** QUESTION / CONFUSION.
- **Proposed alternative:** Once a document is Confirmed, drop the score entirely (or show "Checked by you"). Keep the reading score only on items still in Review, and consider plainer wording than "confidence".
- **What I may be missing:** The number may be useful to power users; I'd just not show it on things I've personally signed off.

### 5. Computer codes leak into everyday screens
- **Citation (verbatim):** STATUS **"needs_review"** (step35, underscore); activity/audit rows read **"document_open"**, **"document_close"**, **"reprocess"** (step62 Users/Audit); field labels read **"Document Issuer (supplier_name)"**, **"Invoice Date (invoice_date)"** (step62 Learning/Document Types).
- **User-moment:** Glancing at a document's status and skimming the "Recent activity" list.
- **Observed confusion:** "needs_review" and "document_open" are computer-speak — I'd read them aloud and feel I was looking at the plumbing, not my filing. The "(supplier_name)" in brackets looks like a bit of code someone forgot to hide.
- **Harm + severity:** cosmetic / trust — **low**, but pervasive.
- **Class:** PREFERENCE.
- **Proposed alternative:** Human labels: "Needs review", "Opened document", "Closed document", "Re-read"; drop the "(supplier_name)"-style bracketed keys on customer screens.
- **What I may be missing:** The audit log is admin-facing, so raw codes there matter less than on the main status.

### 6. When a document's file can't be shown, the preview says "No preview available" with no way to retry
- **Citation (verbatim, step35):** centre pane read **"No preview available"** (no "Try again" button, no note about whether the document is safe).
- **User-moment:** I opened a document whose underlying file I'd (deliberately) made unavailable, to see how a failure looks.
- **Observed confusion:** The good news — it did **not** spin forever. But "No preview available" doesn't tell me whether my document is in trouble or just can't be shown right now, and there's no button to try again.
- **Harm + severity:** trust-eroded — **low**.
- **Class:** QUESTION.
- **Proposed alternative:** For a can't-load case, say "Couldn't show this document right now — the file may have moved. [Try again]" so I know it's a display hiccup, not a lost document.
- **What I may be missing:** The owner mentioned an honest "Couldn't load — try again" message; I likely hit the *missing-file* path rather than the *render-failure* path, so the nicer message may exist on a route I didn't trigger.

### 7. The "Administration" settings tabs are written in language I couldn't say aloud
- **Citation (verbatim, step66 Templates):** *"TEMPLATE VIEWER & ANCHOR MAPPING — Inspect templates and manage anchor → target zone field mappings. Templates with no mappings continue using the standard extraction pipeline."* (step65 Processing:) *"Auto-file confidence threshold"*, *"Recover long reference numbers cut off by the crop"*, *"Trim the label off the start of a read value"*, *"Faster field reads (warm OCR helper)"*.
- **User-moment:** Poking through Settings to understand what I can change.
- **Observed confusion:** "anchor → target zone field mappings", "extraction pipeline", "confidence threshold", "cut off by the crop" — I have no idea what these mean, and I'd worry I might break something.
- **Harm + severity:** slowed / cosmetic — **low** (I'd retreat, not break anything).
- **Class:** PREFERENCE.
- **Proposed alternative:** Keep these under a clear "Advanced / only if a supplier keeps reading wrong" heading (Templates already does this well — *"Advanced: use only when standard extraction is repeatedly failing"*) and swap the worst phrases for plain ones ("where to look on the page", "how sure it needs to be before filing on its own").
- **What I may be missing:** These are genuinely advanced knobs a normal user never needs; the "Advanced" labelling already softens the blow, so this is polish, not a blocker.

*(Smaller things I noticed, not worth a full card: after I taught the company, the blue helper box still read "The Document Issuer box is still empty" even though it was filled — stale hint; the Recycle bin shows two buttons both labelled "Back to search"; Files & filing says "reserved device names are defused", which I didn't understand.)*

---

## Warnings truth-table (did the button tell the truth?)

| Button | Warning said (verbatim) | What actually happened | Truthful? |
|---|---|---|---|
| **Delete** (Review) | *"Delete 'CopperfieldElectrical_invoice_16.pdf'? It goes to the app's recycle bin — you can restore it from Search."* | Count 19→18; doc appeared in recycle bin | ✅ True |
| **Restore** (bin) | (Restore) | Count 18→19; doc back in Review | ✅ True |
| **Empty bin** | *"Permanently delete everything in the recycle bin, including their PDF files? This cannot be undone."* | Bin emptied; the working PDF was genuinely gone from disk | ✅ True |
| **File All Ready** | *"…Every document with its type and required fields filled in will be filed… Documents still missing required details are left in the queue…"* | Filed **0**, left 18 (the company-less docs were **left**, not dumped under "Unknown Company"); showed *"Filed 0 · 18 left for review"* | ✅ True & safe |
| **Confirm & File** | *"…if you file now it will be saved under 'Unknown Company'… or file anyway."* | After I taught the company, it filed to `Copperfield-Electrical/2026/April/…` | ✅ True |
| **Split PDF** | (tool) | Toast: *"This document is only one page — there's nothing to split."* | ✅ True |
| **Reprocess** (doc) | (no warning; non-destructive) | *"Reading selection…"* → *"✓ Reprocessed"*; nothing lost | ✅ True |
| **Defer** | tooltip *"…it moves to the Deferred tab. Nothing is filed or deleted."* | (verified copy only) | ✅ Honest |
| **Approve** (workflow) | two-step *"Confirm — approve and stamp with your name"* | Stamped green **APPROVED / By: chris.fenton / Date: 02 Aug 2026**; logged to History; auto-saved a stamped copy alongside the original | ✅ True |

**Every warning I pressed told the truth.** That is the single most reassuring thing in this whole review.

---

## What genuinely worked
Lots, but the standout: **the approval + stamped-copy flow** (step40-41). Approve is a deliberate two-step ("Confirm — approve and stamp with your name"), it drops a clear green **APPROVED / By / Date** stamp on the document, records it in History, and quietly files a stamped copy next to the original (`…INV-94023.APPROVED-stamped.pdf`) — exactly the audit trail I'd want when the accountant asks "who signed off this invoice?". Honourable mentions: the honest **delete → bin → restore** loop; the onboarding line *"Your original scans are never deleted — they're just moved into a 'Processed' folder"*; the Home **"WHERE YOUR FILES GO"** card with the real path and an Open-folder button; and the **theme quick-flip** — I set Nordic Slate, flipped to dark and back via **both** the rail toggle and the account menu, and it returned to **Nordic** each time (the "forgets your theme" worry did not reproduce).

## Owner's focus items — verified
- **Search re-skin:** looks modern and holds together — tinted "Invoice" type chips, amber "Needs Review" chips, score bars, pill buttons, a magnifying-glass lead box (step31). Nothing read worse *except* the "confidence" wording (card 4) and the raw "needs_review" status (card 5).
- **Home "Open Mailbox":** lands **straight on the Mailbox** (Inbox tab active, *"Nothing waiting on you…"*), not a blank search (step47). ✅
- **Preview error:** no endless spinner (good) — but see card 6 about the plainer message/no retry.
- **Light⇄Dark quick-flip:** round-trips correctly and keeps the chosen theme (step44-45). ✅

## Top friction point
**The company/sender not being read on a new supplier (card 2).** Everything about ScanFinder's value — filing by company, finding it when the accountant rings — hangs on the company name, and on first contact it was blank on all 20 invoices. The recovery is quick (teach once, it learns), but the cold-start moment is where a paper-and-Excel person like me would lose confidence. The Terms draft (card 1) is the more *alarming* surprise, but it's a one-off gate, not daily friction.

## Two-week verdict
**Would I keep using this after two weeks? Yes** — because it does the thing I actually care about: my documents go to a sensible folder I can open, my originals are never thrown away, search finds them by reference in seconds, and every scary button was honest about what it did. What's holding it back from a *confident* yes is chore-y first contact on each new supplier (typing/teaching the company), a few screens that talk like a computer ("needs_review", "63% confidence"), and a Terms screen that currently looks unfinished. Fix the wording and the cold-start guess and I'd recommend it to the office next door.

---

**Humility block:** I'm one simulated non-technical persona (Chris), not a usability study — nothing here is "users found…". I drove the sandbox with a script, so a couple of my own hiccups (a mis-timed two-step Approve click; the Import results table not updating because I kicked processing via the bridge, bypassing the button's own progress) are **my driving artefacts, not app faults**, and I've excluded them. I may have hit a different preview-failure path than the one the owner meant (card 6). All findings are suggestions for the owner to vet, never code changes.

**Key screenshots (in `<scratchpad>/chris-driver/`):** step05-terms.png (card 1) · step26-doc18.png + step24-review.png (card 2) · step51-bin.png (card 3) · step33-preview.png + step37-mailbox.png (card 4) · step35-previewerr.png (cards 5 & 6) · step65-processing.png + step66-templates.png (card 7) · step41-stamped.png (worked) · step46-home.png (Home).
