# HANDOVER — 2026-08-10 (day) — the wrong-company misfile FIXED, an installer built, four accuracy fixes

**Branch `feat/teach-side-overnight`. HEAD `9903dbb`. ALL PUSHED.**
Follows `HANDOVER_2026-08-10_NIGHT.md` (the overnight run: VAT, six security holes, Chris's vet).
Owner present, testing the installer on a second machine.

---

## THE INSTALLER YOU ARE TESTING

`dist\ScanFinder Setup 2.0.0-r20260810-0915-29425c9.exe` · 315 MB
sha256 `fd3bd88b2e270e66f03bf3fb129196d890299c81fcc6f9ce6503e2adf43cb800`

**43 reading improvements ON out of the box** (migration 60). Written as SETTINGS ROWS, not code
defaults, so the switches actually render as on — flipping only the defaults would reproduce the
"Off by default beside a switch that is on" contradiction the customer review flagged; 28
descriptions were rewritten to match. An existing install's own choices are never overwritten.

**Two deliberately left off, and they are your call:** `deskew_on_import` (standing ruling against
it, and it silently disables `teach_angle_compose_scan`, worth +18 issuer / +36 customer) and
`template_fixed_seed_agreement_keep` (lifts 96 documents into the auto-file band, 47 carrying a
wrong value elsewhere — it removes a confidence penalty that is accidentally acting as a safety net
for the account-number defect).

**IT PREDATES THREE FIXES BELOW.** The installer contains everything up to `29425c9`. The
account-number fix, the cold-start letterhead fix and the teach-wizard parity work landed after it.
Say the word and I will cut a fresh one — about ten minutes.

**On the second PC:** licensing enforcement is always on in a packaged build, so it needs a trial or
seat for that machine's fingerprint, and the installer is unsigned — SmartScreen will want
"More info → Run anyway".

---

## THE HEADLINE: the wrong-company misfile is fixed

One ordinary confirm of a purchase order was stamping the wrong company on 18 other companies'
documents at 95% and filing one into the wrong folder. Fixed, Oracle-signed with all six conditions
applied, **default OFF** (`TEMPLATE_IDENTITY_ON_PAGE`, bridged to Settings).

**The cause was not the logo.** On a document a business ISSUES ITSELF the letterhead is its own, so
the layout's recognition fingerprint became the OWNER's address block — which is printed on every
document the business RECEIVES, as the delivery address. It scored 0.80 against every supplier in
the corpus. The keyword matcher has a 0.75 floor but no margin, so a layout need only beat the
others, never be good.

**The fix:** a layout may only claim a document that names its company somewhere on the page.
Measured 160 right matches kept, 40 wrong refused, **zero right matches lost**.

| fresh-import gate | before | after |
|---|---|---|
| wrong senders | 18 | **1** |
| wrong account numbers | 36 | 19 |
| references read correctly | 37 | **54** |
| dates | 44 | **61** |
| order numbers | 6 | **23** |

The surviving wrong sender comes through the logo path and is already capped to 69 with "please
confirm the correct company" — below the filing threshold, with the reason on screen.

**Oracle caught two real defects in my first version**, both worth remembering:
* I read the cosmetic template NAME as the identity. This codebase has ruled twice that it is not
  one. **An admin renaming a template would have silently stopped it matching its own documents for
  ever**, and an auto-generated "Purchase Order Template" name would have passed the guard on every
  purchase order ever printed.
* I vetoed the winning candidate instead of filtering the pool. With two layouts learned from your
  own orders the wrong one wins on list order, gets refused, and the correct one is never
  reached — "teaching a second supplier broke the first one".

**Your live install is clean** — 0 of 147 documents affected. The defect is latent there: it fires
the first time you confirm one of your own purchase orders.

---

## Also fixed today

### The sticky binding (`29425c9`)
Reprocess honoured the layout a document was already bound to without re-checking — which is what
makes teaching stick, and equally what made a WRONG binding permanent. "Reprocess all in queue"
could never have healed those 18 documents, which is exactly the button anyone reaches for. Now the
remembered binding must pass the same test a fresh match does. On the reprocess path, where the two
arms were previously byte-identical: **wrong senders 18 → 1**, every other lane unchanged.

### Account numbers (`efbbd20`)
`account_no` had no patterns of its own, so it inherited a generic bank containing the bare caption
**`Ref`** — which matches "Job **Ref** JB-8887" and committed the job reference as the account
number on 20 pages that have no account number at all. **19 wrong → 0**, every other lane
byte-identical. It also closes it at the teach end: on a page with no account number the read is now
empty, so there is nothing for the teach to freeze.

### The cold-start sender (`c629d32`)
What a brand-new customer meets on day one. On the failing page the tallest "candidate" was the
document title — `GOODS DELIVERY NOTE` at 2.21× vs the company name at 2.05×. That is 1.078, just
under the 1.10 "decisively the biggest" bar, so the reader abstained. **The company name was right
there, second, and lost to the heading.** The exclusion that should have removed the title compared
the whole line to a phrase list by exact equality: `delivery note` is listed, `goods delivery note`
is not.

| same arm, one variable | before | after |
|---|---|---|
| correct suggestion | 19 | **36** |
| wrong suggestion | 2 | **1** |
| **no suggestion at all** | **16** | **0** |

### Teach wizard ↔ Settings parity (`9903dbb`)
Owner-reported. The type EDITOR was already shared, so fields and roles matched; what was missing
was everything around it. The wizard now has **Add from catalog…** and **Edit this type…**, both
using the same code as Settings — the catalog was extracted to `shared/doctype-catalog.js` rather
than copied, and Settings now calls the shared one too. Delete/hide/reorder deliberately not brought
across: they are list-management actions and the wizard is a linear flow with a document loaded.

---

## Reverted, and the revert is the finding

**Serials.** I built the same fix that worked for VAT and account numbers — a list-aware format so
`'Serial No:'` could not be committed. It killed the caption commits and **the lane did not move**:
0 ok / 12 wrong either way. The field simply fell through to the taught box, which is reading the
WORKSHEET NUMBER — so an obviously-junk value at 35% became a plausible-looking `'CJB-5900'` at 90%.
A plausible wrong value is more dangerous than an obvious one, because the operator's glance is the
last check. The real defect is the taught geometry. Recorded in `pendingfeatures.md`.

---

## Your test corpus — the question you asked

| folder | files | text layer |
|---|---|---|
| `SINGLE` (the 10 teach documents) | 10 | **born-digital, by design** |
| `IMPORT` | 200 | **0 have text — image only** |
| `IMPORT2` | 200 | **0 have text — image only** |

The selectable text you saw is the teach set; the protocol teaches on a clean page and imports
scanned siblings. **Every corpus number quoted this week is on the scanned path.**

New: **`TESTING\SCANNED`** (the 10 teach documents as scans, so you can teach FROM a scan — the
harder and more realistic case) and **`TESTING\SCANNED_HARD`** (120 DPI, up to 3.5° skew, JPEG
artefacts). Built by `stress_test/make_scanned_set.py`, which imports the corpus generator's own
degradation rather than copying it. Worth knowing: **the shipped corpus never tilts past 1.6°**,
which is inside the band Tesseract self-corrects — so the placement work in this codebase is
effectively untested by it. `SCANNED_HARD` is how that gets exercised.

---

## What is next, ranked

1. **Your test findings.**
2. **Pelican customer name — wrong on 66 of 72.** Diagnosed 08-08, never fixed: one mis-sized taught
   box, too wide (drift shears the last letter) and too tall (swallows the address line). The clip
   repairs that would fix it exclude names by design.
3. **Auto-file has never fired, on any install.** Max confidence reached is 95; the threshold is 100.
   The tour promises documents file themselves and none ever has. A decision, not code.
4. **Chris's eight findings** — untouched, waiting on your vet. The cheap ones: confirming never says
   WHERE it filed; "Reprocess all in queue" has no warning while the single-document version does.
5. **Security follow-ups** (~a week): retention + "clear diagnostic data" (you cannot honestly answer
   a delete-my-data request today), temp-file hygiene, the XML sidecar decision, and starting the
   code-signing certificate — that one has lead time.
6. Recorded residuals: non-UK VAT numbers are refused (fix designed, held for a real EU supplier);
   `PROFORMA INVOICE` still slips past the title exclusion (needs a type-vocabulary change, which
   also drives type detection); the serials taught box.

---

## Gotchas earned today

* **The harness could not see identification fixes at all.** `teach_run_ab.js` passes
  `known_template_id` because it models REPROCESS, so my first gate on the misfile fix returned two
  BYTE-IDENTICAL arms and the guard looked inert when it was never reached. `TEACH_FRESH_IDENTIFY=1`
  models a fresh IMPORT. **Any future change to WHICH template is chosen must use it.**
* **Two of my probes lied before the code did.** One called the picker with an empty exclusion set,
  so the guard under test could not fire; another asserted a claim that turned out false
  (`PROFORMA INVOICE`). Both would have produced a confident wrong finding. A probe that cannot
  exercise the thing it probes is worse than no probe.
* **A wiring pin's fixed-size window had already shrunk past what it checked** as the comment above
  it grew. Bound pins by the code block, not a character count.
* Never measure against a database another agent is using — snapshot it first (`TESTING/_measure`).
