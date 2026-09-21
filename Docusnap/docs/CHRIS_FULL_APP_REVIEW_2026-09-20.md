# Chris The Customer — Full App Review — 2026-09-20 (night run)

**Round conditions:** sandboxed second instance (CDP port 9223, app PID 8536), fresh seeded DB (0 users →
create-admin first-run), a licence token copied so the gate passes, corpus = a copy of `Demo Docs` under the
sandbox, output to the sandbox `Output`. Build under test = the clean hardened **2026-09-20** pair (core
`ScanFinder Setup 2.0.0-r20260920-2100-4d0dc09.exe`, testBuild:false). Focus: first-run + import/review/teach/
search + the NEW graphical page-splitter + the LAN search-client connect flow. Screenshots at
`…\scratchpad\chris-driver\stepNN_*.png`. **All findings are Chris's suggestions for the owner's vet — nothing
was implemented from this round. The owner's safety contract was honoured (sandbox only; live app + real
filesystem untouched — verified).**

## Owner triage (main session, not Chris)
Verdict: **YES, would keep paying** — "most polished ScanFinder I've handled"; every destructive warning told the
truth; the new splitter rated safe + understandable for a nervous user. 6 finding cards, all copy/UX (no data
loss, no false warning). Ranked for the owner:
- **Highest value: the "63% confidence" on CONFIRMED documents (Findings 1 & 2).** A doubt-number on work the
  user already signed off, and a "1 field low confidence" banner that points at nothing (all visible fields read
  green/high). This is the one place the app made him *less* sure. Fix direction: drop/reword the % on confirmed
  docs ("Checked" / "Confirmed by you"); in Review, point the "low confidence" banner AT the actual field (or name
  it if it's below the fold) and reconcile the whole-doc % with the visible field scores.
- **A real gap in TODAY's splitter (Finding 3):** the Create dialog promises the original "can be recovered", but
  there's NO visible way to recover it (the file IS moved to `.sf_separated_originals`, but the recycle bin is
  empty and there's no "Recover the original" button; C12 Rejoin is only for pair-holds, not a manual split). Add
  a visible recover action, or reword the promise to say where it went. (Pairs with the deferred Shape-A
  whole-original re-import in pendingfeatures.md.)
- **A real stale-status bug (Finding 6) in the client-api area:** with access "On · Running", the teaching-from-
  client note still read "connections above are OFF… turn those on too" — refresh that note live on toggle.
- Polish (Findings 4, 5): the LAN-client summary line is technical ("loopback/plain HTTP/TLS certificate"); and
  "ID code" vs "one-time code" both read as "code" on the connect screen — rename one.
- Standout that WORKED: the teach read-back protecting a good value when he mis-drew the box ("that doesn't look
  like a company name, so I kept 'Northgate Textiles'…") — exactly the honesty this feature was built for. Also
  note: Finding 3 (recover path) reinforces the undetected/opt-in-split "recover original" theme.
All approval-class → for the owner's morning; implemented nothing.

## Resolution — all 6 fixed 2026-09-21 (owner go)
- **F1** Search preview status bar: a CONFIRMED doc now shows "Checked by you" instead of "N% confidence"
  (`searchActions.js`, shared → synced to the client). The doubt-number stays only while a doc is still in Review.
- **F2** Review hold banner now NAMES the field(s) with their % ("… read below the level needed to file on its
  own — check Invoice Total (82%)") and is reworded from "low confidence" to "below the level needed to file on
  its own" — a field can badge a healthy "High · 82%" yet sit under a 90% auto-file bar, so "low" read as a
  contradiction of the green badge. Cue relabelled "Below file level · N" (`review/renderer.js`).
- **F3** Splitter Create dialog reworded: "Nothing is deleted: your original combined scan is moved into a
  .sf_separated_originals folder beside where it came from …" (`split/renderer.js`). (A visible recover button
  stays the deferred Shape-A follow-up.)
- **F4** Search-client access summary reworded to plain English ("This-PC-only stays simple; sharing across your
  office network is secured automatically — nothing to set up"); technical detail stays in the step-by-step guide.
- **F5** "ID code" → "certificate ID" everywhere (core Settings + client connect), distinct from the "one-time
  code", so the two never read as the same word.
- **F6** (real bug) the teach-over-client note now refreshes live when the access toggle changes — no more "connections
  are OFF" while access shows On · Running (`settings/renderer.js`).

---

## Chris's report (verbatim)

# Chris The Customer — vet of the clean 2026-09-20 build

*One simulated non-technical owner, hands-on in the sandbox (CDP 9223, app PID 8536). Real screenshots at `...\scratchpad\chris-driver\stepNN_*.png`. Findings are suggestions for your morning vet — I changed nothing in code.*

## TL;DR (3 lines)
This is the most polished ScanFinder I've handled — first-run, the practice run, the teach read-back, filing, search and the **new page-splitter** all felt safe and plain-spoken, and **every destructive warning told the truth**. The splitter is genuinely excellent for a nervous user. My only real frictions are small: a confusing "63% confidence" stamped on documents I'd already confirmed, and a couple of copy/status snags. **Yes, I'd keep paying.**

## What I did (walkthrough + screenshots)
- Created the admin account → forced recovery-code save (step01–02), Terms (step03), 7-step setup wizard (step04–08), 6-card tour (step09–10), full **practice run** — taught a sample by drawing boxes, imported, corrected a smudged reference, confirmed (step11–14).
- Real work: imported 8 Northgate Textiles invoices, reviewed them (step15–18), tried the **⊕ teach** read-back (step19–20), **Confirmed & Filed** one and **File All Ready** for the rest — all 8 landed in `Output/Northgate-Textiles/2026/<Month>/Invoice.<date>.<ref>.pdf` (verified on disk). Searched and opened INV-74650 with the number highlighted on the page (step22–24).
- **Splitter (focus):** imported a real 34-page scanned stack, opened it in Review, pressed ✂ (step25) → the new thumbnail-grid popout (step26). Marked new-document starts, watched the counter, used the magnifier, dropped a page, read the Create dialog, and **actually created 3 documents** (step27–29). Verified outcome + original preserved.
- Scary buttons: captured every warning; verified delete→recycle→restore round-trips (3→2→3).
- LAN Search client: access screen, setup guide, "Connect a client", the **Require-a-one-time-code** toggle + code + QR (step30–33), then turned access back off.

## Warnings truth-table (every one told the truth)
| Action | What it warned (verbatim / condensed) | True? |
|---|---|---|
| Confirm & File | (files this one) | ✅ Landed at `…/2026/June/Invoice.12-06-2026.INV-19758.pdf` |
| File All Ready | "File 7 ready documents (of 7 in the Review queue)? Each one is filed exactly as if you confirmed it yourself. Anything that turns out to need a detail is left in the queue for you." | ✅ 7 filed to sandbox, none lost |
| Delete (row / 🗑) | "Delete '9_split_p23-34.pdf'? It goes to the app's recycle bin — you can restore it from Search." | ✅ Delete→restore round-trip verified |
| Delete All Review | "…recycle bin — you can restore them any time from Search → Show the recycle bin. Files on disk are kept. Confirmed and deferred documents are NOT affected." | ✅ Claims consistent (I didn't execute it) |
| Split → Create | "Your original combined file is kept safely (it can be recovered) and the new documents go to Review to be checked." | ⚠️ Original IS preserved on disk — but see Finding 3 (no visible way to recover it) |
| Reprocess all | "…it doesn't file anything by itself… A value that reads differently from before is kept for you to check — the previous value is one click away." | ✅ Consistent with behaviour |

*(Note for your process: a native confirm() dialog can be silently cancelled by an automated driver — the Round-5 trap bit me once. Nothing wrong with the app; I captured every message and accepted them via the OS.)*

## The splitter — my verdict as a nervous user
**Understandable and safe.** "Click the first page of each new document" is exactly the instruction I needed; each start gets a blue "Document N starts here" ribbon, and the header updates live to **"This will create 3 documents · 1–11 · 12–22 · 23–34"** — I could see precisely which pages go where. The magnifier (🔍) opened a full, readable page so I could decide before committing; the ✕ marked a page "· will be removed" and the count updated to "1 page removed". The Create dialog names what happens and promises the original is kept. **A non-technical person could split a scan here without fear.** Verified: it produced `9_split_p1-11…`, `…p12-22`, `…p23-34` in Review, and the original 34-page file was preserved.

## Finding cards (ranked by harm)

### 1. "63% confidence" shown on a document I already CONFIRMED — makes me doubt my own filing
- **Citation (verbatim):** Search preview, right panel: green **"Confirmed"** pill next to **"63% confidence"** (also `Status: confirmed`). Seen on INV-74650 and others.
- **User-moment:** Opening a filed invoice to check it for the accountant.
- **Observed confusion:** I confirmed this document myself — I'd read "63%" as "ScanFinder is only 63% sure this is right", and start second-guessing a filing I personally verified. On a done, human-checked document a low number just worries me.
- **Harm + severity:** trust-eroded (medium).
- **Class:** QUESTION / CONFUSION.
- **Proposed alternative:** On confirmed documents, drop the % (or show "Confirmed by you" / "Checked"). Keep the number for documents still in Review.
- **What I may be missing:** That number may be the original read score kept for your records — but as a user I don't want a doubt-number on work I've signed off.

### 2. A document reads "63%" overall and warns "1 field low confidence", but every field I can see is green "High 90%+"
- **Citation (verbatim):** Review — list row "63%"; banner **"Needs a quick check — 1 field was read with low confidence. Low confidence · 1"**; yet **"DOCUMENT ISSUER … High · 90%"**, **"INVOICE DATE High · 94%"**, **"INVOICE NUMBER High · 95%"** (step18).
- **User-moment:** Trying to find and fix the one thing it says needs checking.
- **Observed confusion:** It tells me something's uncertain and the whole document is only 63%, but everything on screen is green and high — I can't tell *what* to check, so I either confirm blind or waste time hunting.
- **Harm + severity:** slowed / trust-eroded (medium).
- **Class:** CONFUSION.
- **Proposed alternative:** Point at the actual low field (scroll to it / highlight it), or if the low item is a field that isn't shown, name it. And reconcile the whole-document % with the visible field scores.
- **What I may be missing:** There may be a field below the fold I didn't see — but nothing on screen pointed me to it.

### 3. Split promises the original "can be recovered", but I couldn't find HOW
- **Citation (verbatim):** Create dialog: **"Your original combined file is kept safely (it can be recovered)…"**
- **User-moment:** After splitting, wondering how I'd get the whole scan back if I split it wrong.
- **Observed confusion:** The file *is* kept (I confirmed it on disk), but the recycle bin was empty and I found no "recover/rejoin the original" button anywhere in Review. A non-technical user would read "can be recovered" and then not know where to click.
- **Harm + severity:** trust-eroded (low–medium — the reassurance is undercut by no visible path).
- **Class:** QUESTION.
- **Proposed alternative:** Add a visible "Recover the original combined file" action (in the split result, or in Search → recycle bin), or reword to say exactly where it went.
- **What I may be missing:** A rejoin path may exist under conditions I didn't trigger — but from where I stood it wasn't discoverable.

### 4. Search-client access copy leans technical for me
- **Citation (verbatim):** **"A loopback address stays plain HTTP; a LAN address gets an automatic TLS certificate — no manual cert files."**
- **User-moment:** Deciding whether to let another PC search my documents.
- **Observed confusion:** "loopback", "plain HTTP", "TLS certificate" aren't words I'd say to a colleague. The reassuring bit ("no manual cert files", "made for you") is great — the lead-in sentence isn't.
- **Harm + severity:** slowed (low). **Class:** PREFERENCE.
- **Proposed alternative:** "This-PC-only stays simple; sharing across your office network is automatically secured — nothing for you to set up." Keep the technical detail under the existing "step-by-step guide".
- **What I may be missing:** The whole step-by-step guide (step31) is excellent and does the heavy lifting — this is just the one summary line.

### 5. Two different "codes" in the connect flow could momentarily confuse
- **Citation (verbatim):** "confirm the **ID code** matches" vs **"Require a one-time code"** (code shown: `7ZPHAFV9`). Both called "code".
- **User-moment:** Setting up the one-time code to connect a second PC.
- **Observed confusion:** I have an "ID code" and a "one-time code" on the same screen — I'd wonder if they're the same thing or which one to type on the other PC.
- **Harm + severity:** slowed (low). **Class:** QUESTION.
- **Proposed alternative:** Rename one — e.g. "ID code" → "fingerprint / certificate ID", or one-time code → "connect code" — so the two never read as the same word.
- **What I may be missing:** People who need the one-time code are probably a bit more technical.

### 6. Stale status line: it said connections were "OFF" while they were running
- **Citation (verbatim):** With access showing "On · Running · https, port 8765", the Teaching-from-client note still read **"On — but search-client connections above are OFF, so no client can reach this PC yet. Turn those on too."**
- **User-moment:** Turning on client access.
- **Observed confusion:** Top of the page says running; a note lower down says it's off. I'd trust neither.
- **Harm + severity:** cosmetic/trust (low). **Class:** CONFUSION.
- **Proposed alternative:** Refresh that note live when the toggle changes.
- **What I may be missing:** It may refresh on reload — but in-session it contradicted itself.

## What genuinely worked (the standout)
The **teach read-back**. I sloppily drew my box over the address instead of the company name, and instead of clobbering my good value it said: **"I read 'orthgate Mill, 14 Weavers Wz reston PR1 30x' from your box. That doesn't look like a company name, so I kept 'Northgate Textiles' in the field. Draw it again, type the name yourself, or use what I read anyway."** (step20). It showed its work, protected the correct value, and gave me three plain choices — that single moment did more to earn my trust than any amount of marketing. Honourable mentions: the practice run's "Nothing here touches your real files" banner, the splitter's live page-range counter, and every destructive warning naming the recycle bin.

## Top friction point
The **"63% confidence" numbers on documents I've already confirmed** (Findings 1 & 2). They put a doubt-number on finished, signed-off work and — in Review — flag a problem I can't locate. It's the one place the app made me feel *less* sure instead of more.

## Two-week verdict
**Would I keep using this after two weeks? Yes** — because it does the thing I actually care about (nothing gets lost, everything's findable, and it tells me before it does anything irreversible), and the teaching and splitting felt safe enough that I'd trust my own staff with them. The confidence-number wording is the main thing I'd want smoothed.

## Humility block
I'm one made-up non-technical customer, not a user test — I speak only for myself and only about screens I actually drove today. I judged copy and behaviour, not code, and I never claim to know *why* the app did something. I couldn't run a real second PC, so the LAN judgement is of the screens only. Sandbox housekeeping: I set the output folder to the sandbox `Output` before filing anything (nothing touched your real Documents folder — verified), turned `auto_separate_enabled` off to stage the 34-page split test, and turned Search-client access back off. All findings are for your vet — I implemented nothing.
