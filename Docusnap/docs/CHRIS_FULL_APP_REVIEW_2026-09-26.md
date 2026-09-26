# Chris The Customer — sandboxed review, 2026-09-26

Sandbox: fresh install, CDP 9223, isolated `userData` + `Output`, Demo Docs copied. Feature under test:
the NEW suggested-teach auto-draw in the guided Teach wizard (mig 220 `suggested_teach_enabled`, ON in the
sandbox). Focus set by the owner: validate his complaint that a unique field is confirmed twice ("too many
requests"). Findings queue for the owner's vet; nothing here was shipped without his standing pre-authorisation
for THIS feature (he said: "implement any changes he suggests … then get Chris to re-review").

---

## ROUND 1 — the vet (Chris's report, as returned)

**Safety:** everything stayed in the sandbox. Chris redirected the Output folder OFF the real
`Documents\Scan Finder` default onto the sandbox `Output` and verified the filed document landed only in the
sandbox. **Note for the owner:** the onboarding default output points at the REAL `Documents\Scan Finder` — a
real user clicking through would file there (correct for them, but worth knowing).

**Setup:** created admin, accepted Terms, skipped the tour, imported 5 Castellan "service worksheet" scans
(fresh DB, no templates → they read poorly, confidence 31, sender not identified). Confirmed the switch ON.
Taught one worksheet as an Invoice, end to end.

### The owner's complaint — CONFIRMED
On the one field read at import (Invoice Date), the box auto-drew correctly, then accepting it took **2 taps
across 2 near-identical "is this right?" screens**, both showing "20-03-2026":
- Screen A: *"Is this the right spot for Invoice Date … Found it"* → **"Yes — teach this spot →"**
- Screen B: *"Check what I read for Invoice Date … Value: 20-03-2026 · Label: DATE"* → **"Looks right →"**
The only new thing on Screen B is a blue label box; to a non-technical user it reads as being asked the same
question twice. For a 5-field document where everything auto-draws, that's ~10 taps for values the software
already had. Too many. Chris's fix: one combined *"Found the Invoice Date 20-03-2026 here — [Yes, use it] ·
[Draw it myself] · [Type it]"* screen per field.

### Cards (ranked by harm)
1. **Double-confirm** (above) — top harm; preference/trust. → **FIXED this session (see below).**
2. **Auto-draw only helped 1 of 3 fields** — it fires only for details already read at import, and a fresh
   poorly-read document (exactly when you teach) has little read. The headline "it draws the boxes for you"
   over-promises on the docs people actually teach. → **for owner** (inherent to the design; a copy/expectation
   note, not a bug).
3. **"Looks right →" accepted a value the app itself warned about** — on the manually-drawn Document Issuer it
   warned *"That doesn't look like a company name"* yet let Chris accept `_ Castellan Security Systems —` (OCR
   edge junk), which became the learned identity AND the filing folder name. A flagged value shouldn't sit
   under a plain green "Looks right". → **for owner** (PRE-EXISTING: the issuer is EXCLUDED from auto-suggest;
   Chris drew it by hand; the warn-not-block accept is shipped behaviour — not this feature).
4. **"Yes — teach this spot" vs "Keep it as typed"** — no plain reason given for choosing the second. → **for
   owner** (shipped typed-locate copy).
5. **Jargon** — "value"/"label" throughout; a paper-thinking user says "the date" and "the word next to it".
   → **for owner** (shipped copy; wider blast).
6. **Import screen showed "0 processed" while Review badge showed 5** — Chris flags LOW confidence, likely his
   scripted import bypassed the live counter. → **for owner to confirm with a normal click** (probable harness
   artefact).

### Verdict (round 1)
"Half and half, leaning not-worth-it as-is": the accurate instant auto-drawn box removes the fiddly drag (a
genuine win), but the second "Looks right?" gate gives that win back in feeling. Collapse the two gates into one
"Found X here — use it?" screen and it clearly beats drawing the boxes yourself.

### What worked
The auto-drawn green box on the date was accurate and instant — no hunting/dragging a tiny box. The Done
screen's *Now → Next few → Soon* timeline sets honest expectations.

---

## FIX APPLIED (main session, 2026-09-26; owner pre-authorised for this feature) — commit `59d2fb0`

**Card 1 (the double-confirm) — collapsed to ONE screen.** In `maybeSuggestField`
(`src/windows/shared/teach-ui/teach.js`), a UNIQUE auto-suggested field (`hits.length === 1`) no longer routes
through the separate `showLocatedPick` "Yes — teach this spot" step. It now reveals + rings the box inline
(`tzReset` + `emphasiseBox` + `scrollIntoView` — the Oracle C-A "seen before confirmed" condition that
`showLocatedPick` used to provide) and goes STRAIGHT to the single value/label confirm (`showValueConfirm`:
Accept / Redraw / Type the correction). ONE screen, ONE tap to accept. MULTIPLE ("printed in N places") still
uses `showLocatedPick` — that pick step is meant to stay. The shipped typed-locate flow is untouched. Pin
updated (`src/windows/teach/test_teach_suggest.js`), client copy synced, run-pins 462/462.

**Cards 2–6 logged for the owner's morning vet** (not implemented overnight): #3 is a pre-existing issuer
warn-not-block on a hand-drawn box (not this feature); #2/#4/#5 touch shipped, Oracle-signed copy/expectation
(wider blast — the owner should steer the wording); #6 is a probable harness artefact.

---

## ROUND 2 — re-review of the fix (Chris's report, as returned)

**Verdict on the double-confirm: FIXED.** For an auto-found detail it is now ONE screen, ONE tap (round 1: 2
taps across 2 near-identical screens; now: 1 tap).

**The verification (Invoice Date, the field that auto-draws):** arriving at Field 2 the green box is already
drawn, and the wizard lands STRAIGHT on the single combined screen — *"Check what I read for Invoice Date …
Value: 17-07-2025 · Label: DATE (left of the value)"* → **[Looks right →]** (+ Redraw value / Redraw label /
Left / Above / "Value wrong? Type it as printed"). One tap advanced straight to Field 3. The old first gate
("Is this the right spot … Yes — teach this spot") is GONE on the auto path. (`r2_step7…`.)
- **Redraw**: 1 tap, cleanly returns to draw mode; a manual redraw then shows ONE readback. Good.
- **Type a correction**: CAVEAT — when the typed value is also printed on the page, it STILL shows two screens
  ("Is this the right spot? … Yes — teach this spot" then "Check the label I found … Save this field"). The
  collapse was applied to the auto-draw path but NOT the type-it path.
- Field 1 (Document Issuer) + Field 3 (Invoice Number) do NOT auto-draw (rough scans) — hand-draw / skip.

### New / notable (round 2, ranked) — ALL for the owner's vet
1. **Type-it-instead path still asks twice** (spot, then label) — the fix isn't applied there. PRE-EXISTING
   shipped `teach_typed_value_locate` behaviour (deliberately left untouched — its pick step is Oracle-signed
   "seen == approved"), but it now stands out beside the collapsed auto path. → owner: apply the same one-screen
   collapse to the type path too? (touches shipped, Oracle-signed — owner's call.)
2. Auto-draw still only helped 1 of 3 details on these rough scans (unchanged; inherent — suggests only what was
   read at import).
3. The combined screen is busy (many controls) but "Looks right →" is clearly the action and the boxes show
   before commit — watch-item.
4. "value"/"label" wording persists — small translation tax (shipped copy).
Also: the company filed CLEAN this round ("Castellan Security Systems"), but Chris drew a tighter box than
round 1, so the round-1 Finding-3 trim can't be confirmed fixed — **owner should re-test with a deliberately
loose issuer box.**

### Verdict (round 2)
"Yes, for any detail it auto-draws — pre-drawn accurate box + one-tap accept, and the second 'are you sure?'
screen that cancelled the saving is GONE (2 taps → 1)." Caveats: still pre-draws ~1 of 3 fields on rough scans;
the type-it-instead path wasn't given the same one-screen treatment.

### Humility
Date appeared once → never hit the "printed in N places" picker (untested). Only the date auto-drew → the
one-tap accept was confirmed on a single field and generalised. The type-path double-ask is likely pre-existing,
not proven a regression.

---

## OWNER VET QUEUE (morning) — nothing below was changed overnight
- **r1-#3** issuer warn-not-block accepts a flagged value under "Looks right" (pre-existing; the issuer is
  excluded from auto-suggest — Chris hand-drew it). Re-test with a loose box (r2 couldn't confirm the trim).
- **r2-#1** apply the one-screen collapse to the TYPE-IT-INSTEAD path too? (shipped, Oracle-signed pick step.)
- **r1-#2 / r2-#2** "it draws the boxes for you" over-promises on rough scans (auto-draws only fields read at
  import) — soften the copy/expectation?
- **r1-#4 / r1-#5 / r2-#4** copy: "Keep it as typed" needs a plain reason; "value"/"label" jargon (shipped copy).
- **r1-#6** import "0 processed" vs Review badge 5 — confirm with a normal button click (probable harness artefact).
- **onboarding** default Output points at the real `Documents\Scan Finder` (correct for a real user; noted).

---

## ROUND 3 — verify the date fix + the type-path collapse (Chris's report, as returned)

Sandbox 9223, logged in as chris, imported Larkspur Interiors (slash-date POs). Switch confirmed ON.

**Both fixes land:**
- **Date auto-draw = WORKS** — the PO Date box now draws itself onto the printed slash-date ("22/01/2026") even though
  the software stored it dash-form ("22-01-2026"). Accept = **1 tap**, ONE screen. (fix `3bffe07`)
- **Type-it-instead = ONE SCREEN** — typing a printed value went straight to one confirm; the old "Yes — teach this spot"
  screen NEVER appeared (polled 25 ticks). (fix `69de2ae`)
- **Auto-draw double-confirm = still one-tap** — "Looks right →" advanced directly to the next field.
- **2 of 3 fields auto-drew** on a Larkspur PO (Issuer excluded by design).
- **Overall verdict: "Teaching now feels quick and trustworthy — yes."** Best bit: the PO Date auto-draw.

**Findings (round 3, ranked):**
1. **Loose Document-Issuer box filed a name+address blob as the sender, no warning — STILL-OPEN (top harm).** A loose box
   grabbed *"Larkspur Interiors The Design Rooms, 3 Chapel Lane Harrogate HG1 2PZ T 01493 …"* and "Looks right →" accepted
   the whole blob as the sender + folder name. Verified at source: `_warnOnIssuerValue` warns for garble + near-dupes but
   has NO over-capture check. → **FIXED this session (reggie design → commit `1d8011b`):** a new shared, node-tested
   module `src/windows/shared/issuerQuality.js` `overCapture(value)` — postcode OR phone ⇒ warn (a company name carries
   neither); else warn only when the value is BOTH longer than a plausible name AND carries an address token; length
   alone never warns. Wired into `_warnOnIssuerValue` additively (after the near-match tiers, before the generic garble
   check): on over-capture it demotes "Looks right" to a ghost "Use it as-is" and promotes **"Draw a tighter box"** to
   primary — **never blocks.** Precision-first (a tidy "Larkspur Interiors" and long legit / street-word names stay
   silent — pinned). NB: partly a loose-draw user error; the warn nudges a tighter box.
2. **Date shown dash-form on the confirm while the page prints slashes** — cosmetic "did it read it right?" wobble (the box
   is correct). → owner: show the printed form on the confirm? (low priority.)
3. **"Document Issuer" vs the printed "Supplier"** — carried copy item. → owner.
4. **Welcome copy undersells the new auto-draw** ("you just draw a box…") — mild; → owner: mention the auto-draw.

Screenshots `r3_step1…r3_step9` in the sandbox folder (job-mortal).

---

## ROUND 4 — verify the issuer over-capture warning (Chris's report, as returned)

**Over-capture warning = WORKS.** A loose box that grabbed
`Larkspur Interiors The Design Rooms, 3 Chapel Lane Harrogate HG1 2PZ T 01423 560118` → the app warned:
*"⚠ That looks like the company name plus its address — a company name on its own won't include a postcode or
phone number. Draw a tighter box around just the name at the top, or use it as-is if that really is the full
name."* DOM confirmed: **"Draw a tighter box" = `btn primary`**, **"Use it as-is" = `btn ghost quiet`** — it warns,
never blocks. **Tidy box = SILENT** (a tight box round just "Larkspur Interiors" → normal "Looks right →", no
warning — doesn't cry wolf). **Regressions HOLD:** PO Date + PO Number both auto-drew (value + label) on one
screen with a one-tap accept. Verdict: **"the issuer teach now feels safe without being naggy."**

**Round-4 findings (2, minor — the fix itself is solid) → owner vet:**
1. PREFERENCE/cosmetic — the over-captured read-back is one long green run; bold the suspected NAME and grey the
   suspected ADDRESS so the picture matches the warning. (Keep the wording.)
2. QUESTION/low — "Use it as-is" doesn't preview the resulting folder name (it'd be the whole blob); a tiny grey
   "Folder would be: …" hint would show the consequence. Do NOT remove/soften the button (correct escape hatch).

---

## SESSION SUMMARY (2026-09-26) — the fix cycle, all Chris-verified
| Finding | Fix | Verified |
|---|---|---|
| Auto-draw double-confirm (owner + Chris r1) | one screen for a unique field (`59d2fb0`) | Chris r2 ✓ |
| Date field didn't auto-draw (owner: 22/01/2026 vs 22-01-2026) | locate the printed separators (`3bffe07`) | Chris r3 ✓ |
| "Type it instead" also double-asked (Chris r2) | shared `offerLocatedBox`, one screen (`69de2ae`) | Chris r3 ✓ |
| Loose issuer box → name+address filed silently (Chris r1/r3) | `issuerQuality` over-capture warning, non-blocking (`1d8011b`) | Chris r4 ✓ |

**Still OPEN for the owner's vet** (logged above, not changed): r4-#1/#2 (issuer read-back styling + folder-name
preview); the "type it instead" is now one screen but the SHIPPED copy items remain — "Document Issuer" vs printed
"Supplier", "value/label" jargon, welcome copy underselling the auto-draw, date shown dash-form on the confirm.
Feature stays **DARK**; flip gate (fidelity IoU census incl. deskew statements + M=0) still owed before default-on.

---

# ROUND 2 — 2026-09-26 (PM) — GUIDED TEACH WIZARD + auto-draw FLIP (sandboxed)

> Sandbox conditions: fresh install, isolated userData (CDP 9223, port 9223), migration 221 (`suggested_teach_enabled` ON by default), synthetic Demo Docs (clean scans, NOT real grainy paper). Focus = verify the flipped auto-draw + hunt 3 owner-observed bugs. Report is VERBATIM below; findings queue for the owner's vet, nothing implemented.

## TL;DR (3 lines)
- The auto-draw works and is genuinely nice for the **Document Issuer** and **Invoice Date** (green value box + blue label box + a "printed in 2 places, step through" picker), but the **Invoice Number** auto-draw captured a **garbled label ("Me Nahe. a aero) AR oe")** and offered it as a real keyword to teach — that's the headline risk.
- Of your three suspected bugs: **#1 = DIFFERENT** (not "Date" — I got "none found" on the date and *gibberish* on the number), **#2 = NOT SEEN in the grid** (clean single-select; the two-selected condition lives in the "Import a PDF to teach…" path I couldn't drive), **#3 = NOT SEEN** (caret appears, typing lands every time).
- Every destructive button told the truth. Delete→restore round-trips; File All and Delete All warnings were accurate. Nothing left the sandbox (verified on disk after each action).

## Walkthrough (with screenshots, all under `...\chris-sandbox\`)
1. **First contact** — Created admin (`step01`), recovery-code screen (`step02`, clear "works once" warning), Terms gate (`step03`, honest), onboarding welcome (`step04`, "Everything stays on this computer"), output-folder step (`step05`), organise/preview step (`step06` — preview correctly showed the sandbox Output path), "You're all set" (`step07`). Welcome tour card 1 (`step08_tour`), Practice run intro + teach step (`step09/step10`).
2. **Real work** — Imported 6 invoices (`step12`→`step13`: read companies, dates, references cleanly, 6/6 in ~12s, moved originals to Processed). Taught **LarkspurInteriors_invoice_02** end to end: doc picker (`step15`), type-select (`step16`), field-pointing (`step17`), issuer type-path (`step18`), issuer located box (`step19`), **Invoice Date auto-draw** (`step20`+`step20_crop`), **Invoice Number auto-draw** (`step21`), label-direction flip (`step22`), summary (`step23`), done (`step24`). Then Review (`step25`/`step26`), confirmed & filed a Marlowe doc, searched it (`step27`), recycle bin (`step28`).
3. **Scary buttons** — Delete→recycle bin→Restore, Reprocess, Split (`step29`), File All Ready, Delete All Review (`step30`).

---

## The 3 focus bugs — verdicts

**#1 Auto-label too generic ("Date" not "Invoice Date") — DIFFERENT (not reproduced as described; found something worse)**
On my clean docs I never saw the label captured as bare "Date". Instead:
- **Invoice Date** (`step20_crop`): a blue box was drawn around the *full* "Invoice Date" caption on the page, yet the readout said **"Label: none found — I'll remember the spot instead."** A contradiction (see card 2).
- **Invoice Number** (`step21`): value read correctly (INV-95206) but the captured label was **"Me Nahe. a aero) AR oe (above the value)"** — pure gibberish, direction defaulted to "Above" (empty space, real caption "Invoice No." is to the left), and it was *not* flagged as unreadable. See card 1 — this is the same weak label-capture area your live "Date" symptom comes from, just showing up differently on cleaner paper.

**#2 Import picker sticky selection — NOT SEEN in the on-screen grid; likely in the "Import a PDF to teach…" path**
Clicking a different card in the doc grid moved the blue selection cleanly — exactly one card selected, checked at 0ms/400ms/1900ms/3900ms after the click (no sticky). The "two selected at once" state does exist specifically when you use **"Import a PDF to teach…"**: while a newly-imported PDF reads (~30s), a provisional "reading…" card is added *already selected*, while the queue card that was auto-selected on open keeps its blue selection too. I couldn't drive that path because it opens a native file chooser the sandbox can't operate, so I'm flagging it as the probable locus rather than claiming a live screenshot. If you saw it live, that's almost certainly the "Import a PDF" flow.

**#3 "Type it as printed" box has no caret / won't type — NOT SEEN**
Tested repeatedly: clicking the "…as printed" box lands focus with a caret at position 0 and characters type in fine ("INV-95206"). The auto-focus-on-appear path (via "Or type it instead") also accepted typing *without* a click. The box's caret colour is the normal dark text colour (visible), nothing hides it. Caveat: a purely visual caret-paint flicker on a real grainy scan can't be fully ruled out by automation, and my synthetic docs may not trigger your intermittent case — but functionally it worked every time.

---

## NEW finding cards (ranked by harm)

**Card 1 — Auto-draw offers a GARBLED label as a real keyword to teach · MAJOR · CONFUSION/trust**
- Citation (Invoice Number step, verbatim): "Value: **INV-95206** · Label: **Me Nahe. a aero) AR oe** (above the value)" with a primary "Looks right →".
- User-moment: confirming the boxes the software drew for me during teaching.
- Observed confusion: I'd read "Me Nahe. a aero" and think "that's not on my invoice." A less careful user just clicks the big blue "Looks right" and teaches nonsense. Worse, the gibberish label never appears on the final "Here's what Scan Finder found" summary (`step23`) — so it's taught *invisibly*.
- Harm: trust-eroded + quietly degrades future auto-filing for that supplier.
- Proposed alternative: if the captured label reads as junk (as the date field already does — "couldn't read it cleanly / none found"), fall back to position-only silently instead of showing the garble as a valid label; and default the label direction to the side where a caption was actually found, not "Above" onto blank space.
- What I may be missing: the engine may have gates that would drop this on save; I only saw the confirm screen offer it.

**Card 2 — Date shows a blue label box on "Invoice Date" but the text says "none found" · MINOR · QUESTION/trust**
- Citation (verbatim): "The green box is the value; the blue box is the printed label I'll look for next time." … "Value: 02-04-2026 · Label: **none found — I'll remember the spot instead**." (`step20_crop` shows a clear blue box round the whole "Invoice Date".)
- User-moment: checking what it read for the date.
- Observed confusion: the sentence promises the blue box *is* the label, I can *see* a blue box on "Invoice Date", but the words say it found no label. I can't tell whether it will use that caption or not.
- Harm: trust-eroded (mixed signals).
- Proposed alternative: if no label text was kept, don't draw the blue label box (or label it "spot only — no caption used").
- What I may be missing: the blue box may be a "candidate" it deliberately rejected; if so, say that.

**Card 3 — "File All Ready" files documents it had just told me "need a quick check" · MAJOR · QUESTION/trust**
- Citation: per-doc screen said "Needs a quick check — 1 field was read below the level needed to file on its own" and "please confirm it's the sender, not the customer, before filing" (Document Issuer · Check · 63–69%). File All Ready warned "File **4 ready** documents… filed exactly as if you confirmed it yourself. Anything that turns out to need a detail is left in the queue."
- User-moment: clearing the queue in one click after teaching.
- Observed confusion: the app called two Marlowe docs "needs a quick check" at 63%, then File All Ready counted them as "ready" and filed them without that check. (The values were in fact correct and filed to the right folder, so no misfile — but the mismatch between "this one needs checking" and "File All filed it" made me nervous.)
- Harm: trust-eroded (the "ready" label and the "needs a check" flag disagree).
- Proposed alternative (NOT a safety removal): either exclude docs that carry an unresolved "quick check" flag from the "ready" count, or say in the warning "…includes N that were flagged for a quick check." Keep the confirm exactly as strong.
- What I may be missing: teaching/confirming a sibling may have legitimately graduated the scope; the count may be technically correct even if it reads oddly.

**Card 4 — Teach welcome still sells the OLD "draw every box by hand" method · MINOR · CONFUSION**
- Citation (verbatim): "For each detail you just **draw a box around its value**… **Draw every detail you can find** on the page, wherever it is printed — the footer counts."
- User-moment: reading the intro before I start teaching.
- Observed confusion: it never mentions that it now draws the boxes *for* me and asks me to confirm — so I braced to hand-draw three boxes, then it auto-drew them. Pleasant surprise, but the copy undersells the best new thing.
- Harm: slowed/mis-set expectations.
- Proposed alternative: "For each detail, Scan Finder draws a box around what it already read and asks you to confirm or fix it — you only draw by hand when it didn't find something."
- What I may be missing: maybe kept deliberately generic so it still reads right when auto-draw finds nothing.

**Card 5 — The Practice run teaches the OLD hand-draw method, not the new auto-draw · MINOR · CONFUSION**
- Citation: practice teach step says "Draw a box around the company name at the top" with every field showing "Draw a box on the document…" / "Waiting…" (`step10`).
- User-moment: doing the guided practice a brand-new user is pointed to.
- Observed confusion: the practice trains me to draw every box; the real wizard then auto-draws. Two different mental models for the same task on my first day.
- Harm: slowed (small).
- Proposed alternative: mirror the real auto-draw (pre-draw a sample box to accept) in the practice, or add one line "in the real thing it draws these for you."
- What I may be missing: the practice is a self-contained sim; updating it may be non-trivial.

**Card 6 — Type-select doesn't pre-pick the type it already read · POLISH · PREFERENCE**
- Citation: "What kind of document is this?" with Invoice / Sales Order / Purchase Order / "It's something new" — none pre-selected (`step16`), even though import had read it as an Invoice.
- User-moment: middle of teaching.
- Observed confusion: I already know it read this as an Invoice; being asked cold to pick again is a small redundant decision.
- Proposed alternative: pre-select the type it detected (still fully changeable), or note "Read as: Invoice".
- What I may be missing: you may intentionally force a conscious choice here.

**Card 7 — Two near-identical "2 more offered in File All Ready" banners stack · POLISH · PREFERENCE**
- Citation: two banners side by side — "2 more offered in File All Ready · Marlowe Medical Supplies" and "…· Larkspur Interiors" (`step29`).
- User-moment: back in Review after teaching + a confirm.
- Observed confusion: looks like a duplicate at a glance; I had to read both to see they're different senders.
- Proposed alternative: merge into one ("4 more offered in File All Ready — 2 senders") or stack vertically with the sender leading.
- What I may be missing: two events genuinely happened; separate banners may be intentional history.

---

## Warnings truth-table
| Button | What it warned | What actually happened | Truthful? |
|---|---|---|---|
| Delete (one doc) | "goes to the app's recycle bin — you can restore it from Search" | Doc appeared in Search → **Recycle bin**, restorable | ✅ TRUE |
| Restore all | "go back to where they were deleted from (review queue, or filed folder)" | Returned to Review queue (count 3→4); bin emptied | ✅ TRUE |
| Reprocess (this doc) | *(no warning)* | Non-destructive re-read; values refreshed, nothing lost/moved | ✅ TRUE (warning not needed) |
| Split PDF | "This document is only one page — there's nothing to split" | Did nothing (all my docs are 1 page) | ✅ TRUE |
| File All Ready | "File 4 ready documents… as if you confirmed it yourself. Anything needing a detail is left in the queue" | Filed all 4 to correct sender/year/month folders; none held | ✅ TRUE (but see card 3 re: "ready" incl. flagged docs) |
| Delete All Review | "Delete ALL 2… recycle bin, restorable… **Files on disk are kept. Confirmed and deferred NOT affected**" | Count→0; original PDFs still on disk in Processed; filed docs untouched | ✅ TRUE (best-written warning of the lot) |

## What genuinely worked well
- The **located-box step-through** on the issuer/value: green value box, blue label box, and "It's printed in 2 places. Step through until the green box sits on the right one." with a "1 of 2" pager (`step19`). That's automation *showing its work* — I trusted it immediately.
- The **destructive-button safety net**: single-delete → recycle bin → one-click restore, plus consistently honest, count-specific, scoped warnings. I never felt one click from losing paper.
- The **teach "Done" screen** (`step24`): "nothing files on a guess," the Now → Next few → Soon progression, and "Confirm 2 more… and the rest will file themselves." Reassuring and accurate — the two Larkspur siblings did become "ready."
- Filing itself: all 6 landed as `Company/Year/Month/Invoice.DD-MM-YYYY.Ref.pdf` with sidecar metadata, exactly as the preview promised.

## Top friction point
The auto-draw's **label capture is unreliable and can silently teach gibberish** (card 1) — and because the bad label never shows on the final summary, the one screen meant to "show its work" hides the one thing most likely to quietly poison future filing. That undercuts the trust the rest of the wizard earns.

## Two-week verdict
**Yes — I'd keep using it**, with one reservation. The import → review → confirm → search loop is fast and pleasant, the filing is exactly the shelf I picture, and the safety net (restore, truthful warnings) is the best I've seen in this app. But I'd want the auto-draw to never offer a garbled label as a real keyword, and I'd want "File All Ready" and the per-doc "needs a check" flag to stop contradicting each other — because the moment I catch the software confidently teaching itself nonsense, I start double-checking everything, which defeats the point.

## Safety / humility
- **Sandbox contract honoured.** Output redirected into `...\chris-sandbox\Output`; verified after *every* file action that nothing was written to the owner's `Documents\Scan Finder` (all my per-action checks were empty; the only recent files there were the owner's *other* running instance — companies I never imported). All 6 docs filed to the sandbox. App still running.
- I'm **one simulated, non-technical user** on **clean synthetic scans**, not a user test and not real grainy paper. These are opinions to vet, not confirmed defects — especially bug #2 (couldn't drive the native file chooser) and bug #3 (visual caret glitches resist automation).
