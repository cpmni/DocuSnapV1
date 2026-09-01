# Chris The Customer — full app review, 2026-09-01

Round conditions: sandboxed second instance (CDP 9223, PID 2816), fresh install (0 users →
create-admin flow), build **29adce2** (the rollout build with the Help button in the main nav, the
three default-ON features, the full-month date fix, and comprehensive error logging). Isolated
userData + Output; Demo Docs (18 supplier folders) copied into the sandbox; owner's live app +
filesystem off-limits throughout. Driven live via playwright-core over CDP with OS-level screenshots.
Verdict: **YES — would keep using it.** Nothing below is implemented — it queues for the owner's vet.

---

## TL;DR (Chris's words)
- The **first-contact journey is genuinely good** — recovery-code, Terms, setup wizard, tour, and
  especially the **practice run** (teach → import → correct the smudged "O", file) taught the whole
  method in a couple of minutes.
- **Filing is trustworthy**: everything landed in `Company/Year/Month` with tidy names inside the
  chosen folder, **full-month dates now file correctly** ("July 28, 2026" → `2026/July`), and **every
  destructive warning told the truth** (delete→restore round-trip verified).
- Two of the three headline new behaviours **couldn't be witnessed** on the clean demo docs (the
  on-preview countdown and the "characters are fine" button never appeared), and a **teach mis-draw
  left a garbled value stuck in the "apply to 15 others" offer** even after correction.

## Walkthrough (screenshot refs step01–step32, in the chris-driver folder)
- First contact (step01–09): admin account; recovery-code screen honest (won't continue until "I have
  saved this code" ticked); Terms gate; 7-step wizard with live filing preview; 6-card tour.
- Practice run (step10–15): drew boxes to teach 3 fields, imported 2 more, corrected a smudged
  reference ("INV-1O42"→INV-1042 with a plain explanation), clear before→after filing map. Excellent.
- Help (step16–17): **Help button now in the left nav rail, directly under Settings — easy to find.**
  Guide is plain-spoken and task-shaped.
- Real work (step18–27): imported 20 Copperfield POs (20/20 read, 0 errors); reviewed, taught the
  issuer with ⊕, corrected a value, confirmed/filed; sender graduated (9 "filed themselves"); search
  "PO-80211" → exactly 1 hit.
- Scary buttons (step26–32): single delete → recycle bin → restored; File All Ready; Split; Delete-All
  warning captured. Workflow Send dialog opens but single-office → no recipient.

## Finding cards (ranked by harm) — FOR OWNER VET, not implemented

**1 — After correcting a bad reading, the app still offered to copy the *bad* reading to 15 others** · trust-eroded
- Verbatim: button *"Apply "eRe ae a ae Ne ey ane" to 15 & re-read"* + heading *"Change what's read from
  eRe ae a ae Ne ey ane's documents"* — both still showing after "Copperfield Electrical" was typed in (step22–23).
- A clumsy teach box read gibberish; the field was fixed by typing the real name, but the "apply to N"
  offer + panel headings still proposed/showed the garble.
- Harm: a hurried person could propagate a bad value to a whole batch.
- Chris's alt: when a value is corrected (or flagged "doesn't look like a company name"), suppress/
  re-label the "Apply to N" offer so it can never propose the flagged value.
- Self-caveat: he caused it with two clumsy box-draws; the warning itself was excellent.

**2 — A clipped teach box silently overwrites the value that was already correct** · slowed
- Verbatim: *"⚠ I read "eRe ae a ae Ne ey ane" from your box. That doesn't look like a company name.
  Draw it again, or type the name in the field yourself."* (step21)
- A slightly-high box replaced the correct "Copperfield Electrical" with gibberish; good value gone
  until retyped. Alt: if a fresh box reads as junk, keep the previous good value and show the junk as
  "I read X — use it?". Self-caveat: teaching-by-box is "whatever's in the box" by contract.

**3 — Two of the three new behaviours never appeared on the clean demo docs** · can't-evaluate
- No on-preview 5-4-3-2-1 countdown/Stop seen, and no "✓ … is fine" button (no field on the clean docs
  was flagged for an odd character). Auto-file itself clearly worked (chip "✓ 9 filed themselves",
  step24). Alt: ensure the demo/sample set actually exercises them; a one-line Help note on the
  countdown so people aren't startled. Self-caveat: script timing may miss a countdown a human hand
  would catch; the demo set is too clean/buyer-issued to flag odd characters.

**4 — Help copy points to the old ways in, not the new left-rail Help button** · cosmetic
- Tour: *"…The full User Guide is in the Help menu."*; Guide: *"Click the ? at the top … And User
  Guide… in your account menu…"* — neither mentions the new left-rail Help item Chris actually used.
- Alt: add "…or click **Help** in the left menu."

**5 — "Sender not identified" with no next step** · slowed
- Group *"Sender not identified — 1 document"* (step25) — honest, but no hint whether to teach, retype,
  or ignore. Alt: a one-line hint "Open it and tell me the company (draw a box or type it)."

**6 — Every document in the batch carried the same issuer caution (warning fatigue)** · trust-eroded (mild) · PREFERENCE
- *"…on Copperfield Electrical's letterhead but names 'Halcyon Leisure Group' as the supplier — confirm
  which company to file under."* on every doc. Alt: after confirming the issuer for a sender once,
  soften to a quiet "filed under Copperfield (letterhead)" on the rest. Self-caveat: almost certainly a
  demo-set artefact (every sample is buyer-issued).

## Warnings truth-table — NO WARNING LIED
| Action | True? |
|---|---|
| Delete one → recycle bin, restore from Search | ✅ verified |
| Restore all → back to review queue / filed folder | ✅ verified |
| Delete ALL in Review (files on disk kept; confirmed/deferred unaffected) | ✅ credible (mechanism proven) |
| File All Ready ("nothing ready… waiting on a check") | ✅ honest |
| Split ("only one page — nothing to split") | ✅ honest |
| Send ("no one can approve yet — grant stamping") | ✅ honest single-user empty state |

## What genuinely worked
- The practice run (teach-by-draw → correct a smudged O vs 0 → file) — best onboarding yet; before→after
  filing map reassures.
- Filing tidy + honest; **full-month dates fixed** (validated: "July 28, 2026" → `2026/July` `28-07-2026`).
- Teach-box garble-catch refused gibberish as a company name and said what to do.
- Auto-file shows its work ("✓ 9 filed themselves" + timestamp).

## Top friction
Brand-new install: nothing self-files for the first ~10 docs of each sender (deliberate safety). Honest
first impression is "imported 20, must check 20." A one-line up-front expectation-set would help.

## Humility block
One made-up customer, not a usability study. Findings 1–2 came from his own clumsy box-drawing; 3 and 6
may be demo-set artefacts (very clean, all buyer-issued). Script-driven, so timing may have missed the
on-preview countdown a human would catch. Judged only what was on screen.
