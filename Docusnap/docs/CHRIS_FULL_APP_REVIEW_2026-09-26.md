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
