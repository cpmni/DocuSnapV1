# Chris The Customer — Full App Vet — 2026-09-22

> Round conditions: sandboxed second instance (CDP 9223 / PID 6500), fresh install (0 users →
> create-admin), Demo Docs corpus copied into the sandbox, output pointed at the sandbox `Output`.
> Run autonomously overnight (owner "you are on auto"). Chris changed no code and nothing outside the
> sandbox (verified zero writes to the live `Documents\Scan Finder`). All findings are for the owner's
> vet — NOTHING implemented from this round. Screenshots at `…\scratchpad\chris-sandbox\c01–c19*.png`
> (session-mortal).

---

## TL;DR (3 lines)
Fresh install to filed-and-found worked cleanly and safely, and **every destructive warning told the
truth** — proved File All Ready (17 of 19), delete→restore, and the splitter on disk. **Last round's
top gripes are genuinely fixed**: confirmed docs now say "Checked by you" (no doubt-%), the hold banner
now names the low field, and the split dialog's wording matches reality. One real new snag: the teach
read-back that protected a good value last time **accepted a mis-drawn customer name+address as the
"company name"** this time. **Yes, would keep paying.**

## What Chris did (walkthrough + screenshots)
- **First contact:** created admin (c01), forced recovery-code save with a greyed-until-ticked Continue
  (c02), Terms gate, 7-step setup wizard (c03–c05), 6-card tour (c06), practice run launches into "draw
  a box round the company name" over safe samples (c07). No jargon in first contact.
- **Real work:** imported 20 Northgate Textiles invoices → Review (c10). Tried ⊕ teach read-back (c11),
  Confirmed & Filed one (landed on disk), then File All Ready for the rest (c12). Searched and opened
  INV-27252 with the number highlighted on the page (c13).
- **Scary buttons (actually pressed):** Confirm & File, File All Ready, Delete→recycle→restore
  (round-trip verified), Split a 3-page stack into 3 docs (c14–c16), Reprocess (single + "Reprocess
  all" modal, c18), read the Delete All Review warning.
- **New surfaces:** the "Not recognised" tab (c17), Quick File (c19).
- **Approval workflow:** not reachable — LAN add-on off on a fresh single-PC install
  (`detached_client_licensed` unset). By-design, not a defect.

## Previously-reported items — verify
- **F1 (63% doubt-number on confirmed docs) — FIXED.** Search preview shows "Confirmed · Checked by
  you", no percentage (c13).
- **F2 (banner flagged a problem I couldn't locate) — FIXED.** Hold banner reads "Needs a quick check —
  1 field was read below the level needed to file on its own · Below file level · 1", and the low field
  is named (Document Issuer · Check · 69%) (c10).
- **F3 (split "can be recovered" with no path) — BETTER (reworded, honest).** Create dialog says
  "Nothing is deleted: your original combined scan is moved into a .sf_separated_originals folder beside
  where it came from…" and that's where it went (c16). The visible *recover* button is still deferred.
- **F4 / F5 / F6 (LAN-client copy + stale note) — NOT RE-TESTED** (LAN access screen not driven).

## New finding cards (ranked by harm)

### 1. The teach read-back accepted a mis-drawn customer name+address as the "company name"
- **Citation (verbatim):** After drawing the Document Issuer box over the *Bill To* block: "✓ I read
  feawood Construction Site Office, Foundry Lane Wakefield WF1 5RS from your box. Saved as this layout's
  company name when you confirm." The Issuer field then displayed "…ffice, Foundry Lane Wakefield WF1
  5RS" in place of "Northgate Textiles" (c11).
- **User-moment:** Sloppily teaching the company name and grabbing the customer's address instead.
- **Observed confusion:** Last round, mis-drawing over an address *protected* the good value ("that
  doesn't look like a company name, so I kept 'Northgate Textiles'"). This time — because the box
  started on a name-like word ("Redwood Construction") — it accepted the whole four-line blob ending in
  a postcode as the company name and replaced the correct issuer, with only a green ✓. Nothing pushed
  back, even though this field's own note warns "please confirm it's the sender, not the customer."
- **Harm + severity:** trust-eroded (medium). **Mitigations:** showed exactly what it read, preview-only,
  switching documents discarded it (good value came back, nothing saved).
- **Class:** QUESTION / CONFUSION.
- **Proposed alternative:** for the company/issuer field, treat a value that's mostly an address
  (multiple lines ending in a postcode) like a bare address — keep the current value + offer "use
  anyway", and/or a one-line "that looks like a customer address, not the sender — sure?" nudge.
- **What I may be missing:** "Redwood Construction" genuinely is a plausible company name, so the guard
  isn't broken — it's the address tail glued on, and I deliberately drew wrong.

### 2. "Not recognised — Couldn't identify this one" contradicts the panel that names the sender
- **Citation (verbatim):** "Not recognised" tab: "Documents we couldn't identify. Open one to choose its
  type or teach it." and each row "Couldn't identify this one." — yet the open document's panel shows
  DOCUMENT ISSUER … Ironbridge Fabrication and types it Invoice (c17, c18).
- **Harm + severity:** trust-eroded / slowed (low–medium). **Class:** CONFUSION.
- **Proposed alternative:** soften to match reality, e.g. "New sender — not filed automatically yet.
  Check the details and confirm/teach it," rather than "Couldn't identify this one."
- **What I may be missing:** "not recognised" may mean "not a sender I've taught yet", but the words
  don't say that.

### 3. "Delete All Review" counts more documents than the Review tab shows
- **Citation (verbatim):** Tab badge "Review 2", but Delete All Review warns "Delete ALL 5 document(s)
  in the Review queue?" (the extra 3 are in the "Not recognised" tab).
- **Harm + severity:** trust-eroded (low–medium) — mitigated (number stated plainly, everything
  restorable). **Class:** CONFUSION.
- **Proposed alternative:** scope the button to the active tab, or reword to "Delete all 2 in Review + 3
  not-recognised (5 total)?".
- **What I may be missing:** deleting both groups at once may be intended; the objection is the count
  mismatch with the visible badge.

### 4. Switching to the "Not recognised" tab leaves the wrong document open in the main panel
- **Citation (verbatim):** With "Not recognised 3" showing on the left, the centre preview and right
  panel (Extracted Fields, ✓ Confirm & File) still showed NorthgateTextiles_invoice_19.pdf, which isn't
  in that list (c17).
- **Harm + severity:** slowed / potential wrong-action (low–medium). **Class:** CONFUSION.
- **Proposed alternative:** on a tab switch, load the first document of that tab (or clear the preview to
  "Select a document").
- **What I may be missing:** clicking a row does load the right doc; this is only the initial
  tab-switch state.

### 5. Jargon: "No OCR" appears in the Quick File description
- **Citation (verbatim):** Quick File: "…searchable a moment later. No OCR, no teaching." (c19)
- **Harm + severity:** cosmetic/slowed (low). **Class:** PREFERENCE.
- **Proposed alternative:** "No scanning or reading needed — you just type the few details yourself."

### 6. The doubt "63%" still shows in the recycle bin on a document I'd confirmed
- **Citation (verbatim):** Recycle bin row: "Northgate Textiles · Invoice.04-10-2026.INV-27252.pdf ·
  INV-27252 · 04-10-2026 · Invoice · 63%" — a document I confirmed and filed.
- **Harm + severity:** trust (low). **Class:** QUESTION. (A BETTER-BUT tail of F1.)
- **Proposed alternative:** drop the % on confirmed rows in the bin, matching "Checked by you".

## Warnings truth-table (every one told the truth)
| Action | What it warned (condensed) | True? |
|---|---|---|
| Confirm & File | (files this one) | ✅ Landed at `…\Output\Northgate-Textiles\2026\October\Invoice.04-10-2026.INV-27252.pdf` (+ .metadata) |
| File All Ready | "File 17 ready documents (of 19)? Not included — 2 flagged… filed exactly as if you confirmed it." | ✅ Exactly 17 filed, 2 stayed, 18 total on disk |
| Delete (Search) | "Move this document to the recycle bin? You can restore it later." | ✅ Moved to bin, PDF kept on disk, restored |
| Split → Create | "Nothing is deleted: your original combined scan is moved into a .sf_separated_originals folder…" | ✅ Original in `…\SplitTest\Processed\.sf_separated_originals\`, 3 split pages created |
| Reprocess all | "Re-reading updates the details; it doesn't file anything by itself…" | ✅ Single Reprocess ran, flagged "confirm once", filed nothing |
| Delete All Review | "Delete ALL 5 document(s)… recycle bin… Files on disk are kept. Confirmed/deferred NOT affected." | ⚠️ Truthful, but counts 5 while the Review badge shows 2 — Finding 3 |

*Process note: the Round-5 native-dialog trap bit once — the first File All Ready silently cancelled and
filed 0; re-ran by making the app's own confirm return true and it filed exactly 17. The app was fine;
the driver was the problem.*

## What genuinely worked (the standout)
The **graduation story**. On a brand-new supplier Chris checked ONE invoice; the moment he confirmed it,
File All Ready offered to file 17 of the remaining 19 "exactly as if you confirmed them yourself" and
correctly held back the 2 it wasn't sure of — then said "✓ Filed 17 documents — Northgate Textiles (17).
— 2 not ready to file. They stay in the queue for you to check." Honourable mentions: the Search
find-on-page highlight, the splitter's live "This will create 3 documents · 1 · 2 · 3" counter, and the
honest Reprocess-all copy.

## Top friction point
**Finding 1** — the teach read-back accepting a customer name+address (ending in a postcode) as the
"company name" without pushing back. Preview-only and discardable, so no data lost — but the thing to
tighten.

## Two-week verdict
**Yes** — nothing got lost, everything was findable, every irreversible action warned truthfully and
turned out restorable, and confirm-one-then-file-the-rest is genuinely less work. The teach wrinkle and
a few wording snags are polish, not walls.

## Humility block
One made-up non-technical customer, not a user test — speaks only for himself, about screens actually
driven today, judging copy and behaviour not code. Couldn't test the approval/mailbox workflow (LAN
add-on off on a single-PC install) or the LAN-client copy, so F4–F6 unverified. Deliberately avoided the
file picker (driver can cancel native dialogs); re-tested File All Ready after the native-dialog trap.
Sandbox housekeeping: output set to sandbox `Output`; filed 18 sanctioned test docs, discarded one
deliberately-bad teach (verified not saved), left 5 in the queue/Not-recognised tab. Nothing touched the
live app or real folders — verified. All findings for the owner's vet; implemented nothing.

---

## Triage (main session, for the owner)
Verdict YES; F1/F2/F3 fixes CONFIRMED in the wild. 6 new findings, none critical, none a data-loss risk
(Finding 1 is preview-only + discardable). Recommended owner triage order:
1. **Finding 1** (medium) — the teach issuer-field guard: extend the "looks like an address" refusal to
   a value that is *mostly* an address (multi-line, ends in a postcode) even when it starts on a
   name-like token. Touches the teach read-back guard (`value_quality.is_name_like_field` / the teach
   readout). An extraction-layer change → advisor + Oracle gate, DARK, before any flip.
2. **Findings 2 + 4** (low–med) — the "Not recognised" tab: soften the "couldn't identify" copy to match
   the panel that clearly named the sender, and fix the tab-switch leaving the previous doc open
   (`shared/notRecognised.js` + the Review renderer). Pure renderer/copy — lower risk, but restart-to-load.
3. **Finding 3** (low–med) — scope "Delete All Review" to the active tab OR reword the count to match the
   visible badge.
4. **Findings 5 + 6** (low) — copy: "No OCR" → plain words; drop the % on confirmed recycle-bin rows.

NONE implemented — all await the owner's go (night-run protocol: findings logged for the morning).
