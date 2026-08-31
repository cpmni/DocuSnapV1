# Chris The Customer — full app review, 2026-08-21

## ROUND 12 — vetting this session's new changes (prefill · post-teach card + "teaching counts" flip · Apply-to-N ripple)

**Sandbox conditions:** fresh install (0 users → create-admin), CDP 9223, isolated userData, copied Demo
Docs corpus, Output to the sandbox folder. All this session's changes live in the sandbox DB: migrations
76 (round-11 validated set) + 77 (`letterhead_prefill` ON) + 78 (`confirm_persist_values` +
`format_corrections_dedupe` ON, paired). Run driven by the general-purpose Chris persona (the
`chris-the-customer` subagent type is not spawnable in this environment). The first run crashed on a
transient API error mid-teach (step19); a second run resumed on the still-live logged-in sandbox and
completed. Screenshots r01–r81 in the session scratchpad `chris-driver/`. Report is VERBATIM.

---

# Chris The Customer — Product Vet (sandbox, CDP 9223)

I picked up a running sandbox already past first-run, cancelled a half-finished Pelican teach from the prior run, then imported a genuinely fresh document, taught a sender end-to-end, confirmed siblings, corrected a mis-read issuer, filed a batch, deleted/restored, emptied the bin, and searched. Everything below is what the pixels and the app's own records showed me.

## Walkthrough (screenshot refs)
- **r01** stale teach (Pelican, cancelled cleanly — honest "Stop teaching? Nothing is saved yet.") → **r03** Review queue (28 docs) with the buyer-issued **Quillstone/Bramblewood PO** panel.
- **r24** fresh cold-start import (Copperfield invoice) — issuer pre-filled from letterhead, held. **r32→r45** full teach of Pelican via type-and-locate → the DONE follow-up card. **r59** the "Cleaning" partial-name mis-read. **r66** issuer correction (no ripple offered). **r78/r81** Search + Recycle bin.

## Finding cards (ranked by harm)

**TL;DR:** (1) the "Apply to N & re-read" ripple is now unreachable by the natural typing correction; (2) the letterhead prefill sometimes grabs a name fragment ("Cleaning", "Security"); (3) the teach DONE card hides the number and the road back to Review it actually has.

---

**① Correction ripple has no doorway in the prefill flow**
- **Citation (verbatim, code + behaviour):** the only thing that opens the ripple is the `Use "X"` button, which renders solely on a note reading *"page branding reads / confirm the correct company."* Every issuer note in my queue instead read *"The letterhead reads 'X' — filled in for you, but please confirm it's the sender, not the customer, before filing."*
- **User-moment:** the issuer showed "Cleaning"; I typed the real name "Silverbeck Cleaning Supplies" and pressed Enter.
- **Observed confusion:** No "Apply … to 1 & re-read" bar appeared, even though the app *can* find the sibling (I confirmed `findIssuerSiblings` returns the matching doc). I'd fix "Cleaning" here and the identical sibling stays unidentified — I'd never know one click could have carried the fix across.
- **Harm + severity:** trust-eroded / slowed (batch-heal silently unavailable).
- **Class:** CONFUSION.
- **Proposed alternative:** also trigger `offerIssuerRipple` after a *typed* issuer correction (blur/Enter), not only the branding button — since the prefill note has replaced the branding note that used to carry the button.
- **What I may be missing:** on an install with many learned suppliers a branding-conflict note might still fire and show the button; I tested a fresh-ish install where it never did. The underlying apply mechanism itself is sound (see re-verify #3).

---

**② Prefill grabs a name fragment on some letterheads**
- **Citation (verbatim):** DOCUMENT ISSUER = **"Cleaning"** with *"The letterhead reads 'Cleaning' …"* — the page plainly reads **"Silverbeck Cleaning Supplies"**. Same class: **"Security"** for Castellan Security.
- **User-moment:** reviewing the Silverbeck order confirmation.
- **Observed confusion:** it filled the *last word* of the company, not the company. I'd trust "filled in for you" less after seeing it name a company "Cleaning".
- **Harm + severity:** slowed / trust-eroded (correct behaviour is held-for-review, so nothing misfiles — but every such doc needs a manual retype).
- **Class:** CONFUSION.
- **Proposed alternative:** when the prefill lands on a single generic word (Cleaning, Security, Supplies, Services), prefer the full top-line company text or leave it for review rather than pre-filling a fragment.
- **What I may be missing:** the letterhead font/spacing may genuinely confuse the reader; a fragment held for review is still safer than a blank.

---

**③ The teach DONE card hides the number it has, and the way back to Review**
- **Citation (verbatim):** *"As you confirm a few more of their Invoice in the review queue, it will start filing itself."* Buttons: **"＋ Teach another document"**, "Back", "Done".
- **User-moment:** I just finished teaching Pelican (8 unfiled siblings waiting).
- **Observed confusion:** the app's own data at that moment was `needed: 2, siblingCount: 8` — but the card said "a few more" with no number and gave me **no "Check them in Review" link**. The number is suppressed by an internal `canPromise:false` that only flips true *after* the first confirm — i.e. never while the card is on screen. So the promised "2 more → [Check them in Review]" never shows.
- **Harm + severity:** slowed / under-delivered (the encouragement is real but vague, and there's no one-click path to the siblings it's talking about).
- **Class:** PREFERENCE / QUESTION.
- **Proposed alternative:** show the concrete count when `siblingCount>0` ("Confirm **2** more like this — [Check them in Review]") and add the Review link; keep the generic reward only when `siblingCount==0`.
- **What I may be missing:** the conservatism may be deliberate to avoid promising a number before any confirm proves the read is good.

---

**④ "It will start filing itself" overpromises for docs already in the queue**
- **Citation (verbatim):** DONE card: *"…it will start filing itself."* / queue group header: *"3 more to file by itself."*
- **User-moment:** after teaching + confirming 2 Pelican siblings, I expected the remaining 6 to file themselves.
- **Observed confusion:** they did **not** auto-file. After reprocess they read at **100%** (issuer note cleared, method became `template_fixed`, Pelican `graduated:true`) — but stayed in Review as *one-click* "ready", needing File All Ready or a confirm. Only *future imports* of a graduated sender would truly self-file. Teaching genuinely counts (the "needed" counter dropped 3→2 the moment I taught), and graduation works — but "the rest auto-file" isn't literally true for what's already queued.
- **Harm + severity:** trust-eroded (mild).
- **Class:** QUESTION.
- **Proposed alternative:** say "the rest are now one-click ready — future ones file themselves" for queued docs.
- **What I may be missing:** I couldn't test a *fresh* graduated-sender import (no spare Pelican fixtures), so I can't fully confirm zero-touch on import — only that the note clears and confidence hits 100, which the import auto-file gate should accept.

---

**⑤ "File up to 14" filed only 3**
- **Citation (verbatim):** *"File up to 14 of 26 documents in the Review queue? 12 flagged documents are not included…"*
- **User-moment:** clicked File All Ready.
- **Observed confusion:** queue dropped 26→23 — **3 filed, not 14.** The other 11 were "counted" but blocked at filing time by the issuer Check·69%. "Up to" hedges it, but the number sets an expectation it doesn't meet.
- **Harm + severity:** trust-eroded (mild). Critically, the 3 that filed were all correct Pelican docs — **no wrong company, no buyer-issued PO, no "Cleaning" doc filed.** Safety held.
- **Class:** QUESTION.
- **Proposed alternative:** count only genuinely file-eligible docs ("File 3 ready documents"), or add "(11 need their sender confirmed first)".
- **What I may be missing:** the count may intentionally include "would file if you confirm the issuer" — but that's not what "File 14" reads as.

---

**⑥ Every fresh import shows "Check · 69%" on a correctly-read issuer (warning-fatigue)**
- **Citation (verbatim):** on Copperfield, Pelican, Bramblewood, Nordwind, Veltrix, Harrowgate, Oakhaven — all: *"…filled in for you, but please confirm it's the sender, not the customer, before filing."*
- **User-moment:** scanning a 20-doc batch where the issuer is right nearly every time.
- **Observed confusion:** if *every* doc always asks me to re-confirm the issuer, the ask stops meaning anything and I'll rubber-stamp it — which defeats the check on the one buyer-issued PO where it matters.
- **Harm + severity:** trust-eroded (warning fatigue).
- **Class:** QUESTION (this is a safety surface — I am **not** proposing to remove it).
- **Proposed alternative (for owner triage only):** once a sender is confirmed once, stop re-flagging its issuer as "check" on later docs; reserve the flag for genuinely uncertain reads.
- **What I may be missing:** the blanket check is the exact thing that stops a silent wrong-company file, so its value is real; this is a report of the fatigue, not a request to weaken it.

---

**⑦ A recognised layout with an empty issuer offers no "Use Pelican"**
- **Citation (verbatim):** on Pelican_0011 — *"Recognised by: Layout available: Pelican Office Interiors"* yet DOCUMENT ISSUER empty with *"type the company name, or use ⊕ to teach where it sits."*
- **User-moment:** opening a stale doc the app clearly recognises as Pelican.
- **Observed confusion:** it knows the layout is Pelican but makes me type the company anyway — no one-click "Use 'Pelican Office Interiors'".
- **Harm + severity:** slowed (minor).
- **Class:** PREFERENCE.
- **Proposed alternative:** when a template matches, offer its sender as a one-click fill.
- **What I may be missing:** these `_0011` docs look like a pre-prefill import batch (11 of them had no issuer at all); reprocessing them would refill via the current path, so this may only affect stale rows.

---

## Re-verify — the three focus changes

- **1) Cold-start letterhead PREFILL — FIXED.** On a genuinely fresh import (I imported a never-seen Copperfield invoice and watched the log: `Letterhead issuer PREFILLED: 'Copperfield Electrical' (review-bound, conf 69)` → `file_done … needs_review`), the Document Issuer is **filled** with the letterhead company and **held for review** — never silently filed. Confirmed on normal docs (Pelican, Copperfield read the seller, not the "Bill To" customer) and on the **buyer-issued PO** (Bramblewood at Check·69% with a sender-vs-customer note). Zero wrong-company files across the whole session. Caveats: fragment reads (finding ②) and the always-on check (finding ⑥).

- **2) Post-teach follow-up card + "teaching now counts" — BETTER-BUT.** Teaching *does* count (graduation counter dropped 3→2 the instant I taught; taught anchors propagated to siblings on reprocess — they went from blank to invoice_date 94% / invoice_number 90% via `template_mapping`; after 2 confirms Pelican reached `graduated:true`). **But** the DONE card never shows the concrete number (`needed:2` in data, "a few more" on screen) and offers **no link back to Review** (finding ③), and already-queued siblings become one-click-ready rather than self-filing (finding ④). Single-doc senders correctly degrade to a plain reward (`siblingCount:0`).

- **3) "Apply 'X' to N & re-read" RIPPLE — BETTER-BUT (mechanism fixed, doorway missing).** The round-11 *revert* harm is gone at the mechanism level: I drove the underlying flow and the pins **held** — the sibling re-read as **"Silverbeck Cleaning Supplies" (operator_pin)**, the source I fixed also held ("Silverbeck Cleaning Supplies", not reverted to "Cleaning"), and **both stayed review-bound** (no misfile). **But** the UI never offered me the ripple: typing the correction (the natural fix) produces no "Apply to N" bar, because its only trigger is the old "Use 'X'" branding button, which the new prefill note has displaced (finding ①). So it no longer throws work away — it simply isn't reachable the normal way.

## Warnings truth-table
| Button | SAID | DID | Verdict |
|---|---|---|---|
| Teach → Cancel | "Stop teaching? Nothing is saved yet." | Discarded, nothing committed | ✅ True |
| Reprocess N from sender | "Re-read all N … can take a while … confirmed/filed not touched" | Re-read only the queued N | ✅ True |
| Delete (single) | "goes to the app's recycle bin — you can restore it from Search" | Soft-deleted, appeared in Recycle bin | ✅ True |
| Restore all | "go back to where they were deleted from" | Returned to the review queue | ✅ True |
| Delete All Review | "go to recycle bin … restore any time … Files on disk kept … Confirmed/deferred NOT affected" | (dismissed) copy matches the soft-delete model | ✅ True (copy) |
| Empty bin | "Permanently delete … including their PDF files? This cannot be undone." | 27.pdf really was deleted from disk | ✅ True |
| File All Ready | "File up to **14** of 26 … 12 flagged not included" | Only **3** filed (all correct company) | ⚠️ Number over-counts (finding ⑤); safety intact |

## What genuinely worked
The **teach-by-typing** flow. I never had to draw a box: I typed each value, it said "Looking for that on the page…", found it (stepping me through 2 candidates for the invoice number so I picked the table cell not the footer), auto-detected the label, and read it back before saving. That's genuinely usable by a non-technical person — and the anchors it saved then read all 8 siblings correctly. Filing was flawless: Company/Year/Month/`Invoice.DD-MM-YYYY.Ref.pdf`, right company every time.

## Top friction
The letterhead prefill (finding ⑥) creates a "confirm the sender" check on **every single document**, which trains me to click past it — and it's the same check that quietly displaced the correction-ripple's doorway (finding ①). One safety surface is both over-firing and eclipsing a useful feature.

## Two-week verdict
**Yes, I'd keep using it.** In one sitting it filed 6 documents to the right folders with zero misfiles, learned a sender from one teach, and never lost a document I couldn't get back. The rough edges are about *tone and follow-through* — vague promises, a fragment name, a number that over-counts — not about safety or correctness, which held everywhere I pushed.

## Humility block
One scripted persona, one sitting, clean synthetic PDFs, and a fresh-ish sandbox that also carried a stale pre-prefill `_0011` batch I had to reason around. I could not drive the native folder picker or draw teach-boxes, so I imported via the app's own process call and taught by typing — both real code paths, but not mouse-drawn. Where the UI wouldn't surface a feature (the ripple), I exercised the underlying app calls to see the mechanism, and I've said so; that means my "mechanism works / doorway missing" split for Focus #3 rests on code paths plus a live pin-holds-through-reprocess test, not on a button I clicked. I checked findings against the app's records (review queue, extractions, output folder on disk), not just the screen. The driver misbehaved twice (a transient import that returned `success:false`, a field input that stopped matching a selector) — I re-ran and reconciled both.
