# Chris The Customer — Full App Review — 2026-09-01 NIGHT (sandboxed)

**Round conditions:** isolated sandbox instance (CDP 9223, fresh migrated DB, 0 users → create-admin
flow), Demo Docs corpus copied into the sandbox, output set inside the sandbox, `quick_reprocess_enabled`
enabled in the SANDBOX DB ONLY to vet the Quick/Full dialog. Chris drove over Playwright/CDP with OS-level
screenshots (step01–step52 in the driver folder). No live app/DB/Desktop touched. **Cards are suggestions
for the owner's vet — NOTHING implemented from this round without the owner's explicit go.**

**Verdict: YES** (would keep using after two weeks). Warnings truth-table: all truthful.

---

## TL;DR (Chris's words)
The core loop — import → review → teach → confirm → file → find — is genuinely good, honest, and
reassuring, and the practice run + the Quick/Full reprocess dialog are the best-written screens in the app.
Top worry: teaching a field I was *nervous* about (a 69% one), a slightly mis-drawn box turned a correct
company name into a misspelled one, and the app cheerfully offered to spread that misspelling to 19
documents. A couple of "check"/"ready" labels also say more (or less) than the screen actually shows.

## NEW finding cards (ranked by harm)

### 1. A mis-drawn teach turned a correct name into a misspelling — and the app offered to spread it to 19 docs
- **Verbatim:** after drawing the teach box, "✓ I read **lorthgate Textiles** from your box. Saved as this
  layout's company name when you confirm." Then "**19 more unfiled documents look like the same sender.**"
  + a blue "**Apply \"lorthgate Textiles\" to 19 & re-read**"; panel re-labelled "Change what's read from
  **lorthgate Textiles's** documents".
- **User-moment:** the Document Issuer was flagged at 69% ("Check"), so I did what a nervous person does —
  drew a box round the company name to "lock it in".
- **Confusion:** my box clipped the first letter → "lorthgate Textiles", a made-up word that plainly doesn't
  match "Northgate Textiles" printed right above it. The app put a **green tick** on it and offered a
  **one-click "Apply to 19"**. If I hadn't looked closely I'd have confirmed it and the whole supplier would
  file under a misspelled name.
- **Harm:** trust-eroded / potential mis-file at scale. **Class:** CONFUSION.
- **Alternative:** when a freshly-taught issuer value doesn't match the name the app can already see on the
  letterhead, don't show a plain green tick + "Apply to N" — show a caution ("This doesn't match the name
  printed on the page — check the box you drew") before offering to spread it.
- **Chris's humility:** the clipped box was *my* error; the app honestly showed what it read; there's "Not
  now" + Undo; re-drawing cleanly fixed it. **May be the area the owner's queued issuer-ripple fix targets —
  worth checking it catches a *plausible-word* garble like "lorthgate", not just obvious gibberish.**

### 2. The "needs a quick check" banner goes stale — flags a problem that's already gone
- **Verbatim:** amber "**Needs a quick check — 1 field was read with low confidence**, and 1 field was
  flagged by a formatting check" + chip "Low confidence · 1" — while all three fields read **High 90/94/95%**.
- **Confusion:** the flag never refreshed after teaching bumped the issuer 69%→90%. (Reprocess → Quick
  cleared it — the banner then read "Nothing looks wrong.")
- **Harm:** trust-eroded; also appears to be what blocks these "ready" docs from bulk-filing. **Class:** QUESTION.
- **Alternative:** refresh the "needs a quick check" summary the moment a field's confidence changes.

### 3. The check summary counts two problems when only one field is flagged
- **Verbatim:** "1 field was read with low confidence, **and 1 field** was flagged by a formatting check" —
  but both issues were on the SAME field (Document Issuer).
- **Confusion:** reads like two different fields need checking; I hunt for a second, find one, feel I'm
  missing something. **Class:** CONFUSION.
- **Alternative:** "1 field needs a look — read with low confidence and flagged by a formatting check."

### 4. "Ready" is used three ways, with two different numbers
- **Verbatim:** activity strip "**19 more ready to file**"; File All Ready dialog "**File 19 ready
  documents** (of 19 in the Review queue)?"; sender group header "19 documents · **2 more to file by itself**".
- **Confusion:** is it 19 or 2? "File by itself" (auto-file after history) is genuinely different from "ready
  to file" (bulk-confirm), but shared words + clashing counts made me unsure. **Class:** PREFERENCE.
- **Alternative:** one word per concept — "19 waiting for you to confirm" vs "2 will file on their own once
  this sender is learned."

### 5. A sensitive log looks switched ON while its own copy says "Off by default"
- **Verbatim:** Settings → Advanced, "**Write diagnostic log**" toggle shown **on**, under "…**Off by
  default**. ⚠ The file contains document field values and OCR text — treat it as sensitive as the documents
  themselves."
- **Harm:** trust-eroded (privacy). **Class:** QUESTION.
- **Chris's humility:** very likely a **sandbox setup artifact** (the harness may enable it), not the
  shipping default — flagging only so the owner can confirm.

### 6. A deleted document hides its reference and date when deciding whether to restore it
- **Verbatim:** Recycle bin detail — Company "Northgate Textiles", Type "Invoice", **Reference —**, **Date
  —**, Status "deleted" (the page clearly shows INV-27252 / 04/10/2026).
- **Harm:** slowed / cosmetic. **Class:** PREFERENCE.
- **Alternative:** show the known reference/date on binned items too.

## Previously-known — verifies
- **"Ready language war":** **BETTER-BUT.** File All Ready did NOT say "Nothing is ready" — it correctly
  offered + filed everything. Old contradiction looks fixed, but "ready" is still overloaded and now clashes
  with "2 to file by itself" (#4).
- **Heading-guess issuers:** **NOT CLEANLY TESTED** — the sandbox corpus has no genuinely sender-less
  document. Related honesty was good (untaught "Meadowbank Trading" read correctly; real Northgate read from
  the letterhead). The only made-up name was my clipped teach — teach-side, not detection-side.
- **Issuer-ripple teardown (Plan A):** the sibling-ripple offer **still appears for a garbled-but-plausible
  value** ("lorthgate Textiles") — worth confirming the queued/committed fix covers plausible-word garbles.

## Warnings truth-table
| Button | Warned | Actually did | Truthful? |
|---|---|---|---|
| Delete document | "goes to recycle bin — restore from Search" | Moved to bin; restored to Review | Yes |
| File All Ready | "filed exactly as if you confirmed… anything needing a detail is left" | Filed all, queue → 0, 19 on disk | Yes |
| Reprocess → Quick | "updates details; doesn't file anything by itself" | Re-read, filed nothing, cleared a stale flag | Yes |
| DB encryption | "the only key… if lost, cannot be recovered — not even by us" | Gated behind typed "I HAVE SAVED IT"; cancelled before applying | Gate Yes |
| Recovery code | "one-time code… shown once" | Gated behind a "saved it" tick | Gate Yes |

**Round-5 lesson recurred:** Chris's automated "click Yes" on native confirms was **silently cancelling**
them → briefly thought File All Ready + Delete were broken no-ops. He caught it, switched methods, re-tested
— **both work correctly.** Weight any "button did nothing" instinct with that caveat.

## Headline surfaces
- **Quick/Full reprocess dialog:** CLEAR — "I understood that Quick reuses the first read and won't re-check
  a tilted page / faint text / a just-taught field, and that Full is for a fresh look." "Quick
  (recommended)" is a fair default. Nits: "scan settings" a touch vague; four paragraphs is a lot; didn't
  catch a "N reused / M re-read in full" summary toast (may have flashed by).
- **DB-encryption ceremony:** clear + appropriately careful, NOT terrifying. Honest about scope (files not
  changed; use BitLocker), masked code with Show/Copy/Print + "reveal only when no one can see", typed "I
  HAVE SAVED IT" gate. Did NOT reach the relaunch/Unlock/Recover screen this round.
- **Low-memory copy:** not seen — a 20-doc batch on this PC didn't trigger the worker-count/retry message.

**Genuinely worked:** the practice run (before→after filename+folder table), the Quick/Full wording,
delete→bin→restore, the filing shelf on disk, the privacy reassurance throughout. **Top friction:** finding
#1 (teach → clipped box → misspelled company → green tick + one-click "Apply to 19").

**Humility block:** one simulated persona, not a user test. Drove by automation; the confirm-accept
initially cancelled native dialogs and nearly filed two false "it's broken" findings before being caught.
The teach-box clip was Chris's own imprecision. Could not cleanly test the heading-guess card, the
encryption relaunch/Unlock screen, or the low-memory copy this round. App left running; nothing changed
outside the sandbox.
