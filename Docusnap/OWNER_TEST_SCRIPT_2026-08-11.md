# Owner test script — 2026-08-11 session (step by step)

Everything built today, in the order to test it. **Restart the app first** (main-process code
changed — migrations 61+62 apply on this start; watch the console/log for
"JS migration 62 applied"). Nothing below needs a rebuild of the installer; `npm start` is fine.

**State note:** the broken serials teach was already repaired in the LIVE DB (the two mappings and
the two frozen serials fields are deleted; backup at
`Desktop\TESTING\_measure\live_backup_20260811_120903.db`). 24 documents still CARRY the old
`Serial No:` value in their stored extractions — they'll only change if you reprocess them.

---

## A. Five-minute smoke (the six items already owed from last night, still outstanding)

1. **Typed-teach locate** — teach wizard, type a value that IS printed on the page → the box should
   now be ringed with a green glow and the page zoomed to fit (today's fix for "the box on the page
   shows where" showing nothing). Say yes → commits as an ordinary mapping.
2. **Gibberish teach warning** — ⊕ a supplier field and draw a deliberately bad box (half a word,
   a smudge). Instead of the green "Captured the Document Issuer position" toast you should get
   *"I read '…' from that box — that doesn't look like a company name."* The teach still stages.
3. **Straighten + registration preview** on a tilted sample (from 08-10 EVENING, never smoked).
4. **A box drawn while straightened** round-trips to the right place on the raw page.
5. **Stamp placement** — approve a doc with a custom stamp position set; check the corner.
6. **Ageing chip** on an open mailbox route older than a day.

## B. Chris round-2 fixes (10 minutes)

1. **Approve works and says so** — send a doc to yourself, press Approve ONCE: the button turns
   amber, relabels to "Confirm — approve and stamp with your name", and a line appears explaining
   the second press. Press again within ~8s → approved. (It was never broken — the two-step arm
   was invisible; four slow single presses each silently re-armed.)
2. **Import copy** — process a folder; after it finishes the folder panel should say "All N scans
   … moved to its Processed subfolder", NOT "No documents found".
3. **Counter** — during a big import the header should read "132 processed of 200 found" (the full
   total from the start), not "132 of 132".
4. **Home split** — with a mixed queue, Home's attention card shows "X need your review · Y ready
   to file" under the count.
5. **Auto-file honesty** — the learning card now says "N suppliers have QUALIFIED for automatic
   filing" and admits when nothing has auto-filed in the last 7 days.
6. **Recycle bin** — delete a doc; the bin row now leads with the FILENAME; "Restore all" sits
   beside "Empty bin" and asks with a count before restoring.
7. **Reprocess all** — the button now always confirms with the count before re-reading the queue.
8. **Teach picker filter** — with >8 docs in the queue, the teach wizard's picker has a filter box.
9. **Wizard tally** — mark two fields "not on this document": the rail reads "5 of 7 done · 2 not
   on this document" and the finish line no longer claims "All fields captured".
10. **Recovery code** — (needs a fresh admin/recovery flow, e.g. the sandbox) Copy and Print
    buttons under the code.
11. **One phrase** — untitled senders now read "Sender not identified" in the review rows and the
    teach picker (was four different phrases).

## C. The buyer-issued identity fix (Chris finding 1 — the important one)

This is ON for FRESH installs only (`template_identity_on_page` is in the fresh-install defaults;
**your own install still has it OFF** — flip it in Settings → Processing: "Only use a learned
layout on documents that actually name that company" if you want it live here).

To see the fix work, easiest is the Chris sandbox route (a fresh DB reproduces his exact leak):
1. Import a batch containing another company's delivery notes.
2. ⊕-teach a supplier from a PO your own company issued, deliberately drawing a bad box so a
   garbage name is captured. Confirm it, then "Reprocess all".
3. BEFORE today: all the other company's notes came back stamped with the garbage at 95%.
   NOW: they stay "Sender not identified" (the honest state). A YOUNG learned layout (fewer than
   3 matching confirms) can only claim pages that actually print its company name.

## D. Taught label becomes the keyword (your finding — now template-scoped, ready to flip)

1. Settings → Processing → turn ON **"A label you teach becomes the keyword for that field"**.
2. Teach (or re-teach) the Castellan worksheet number through the wizard, confirming the printed
   caption "JOB SHEET NO".
3. Reprocess a Castellan worksheet with SFDEV open: the keyword rung should now hunt
   "JOB SHEET NO" (method `keyword_override`), not the generic "Ref".
4. The scope is the TEMPLATE: the same field on a DIFFERENT supplier's worksheets keeps the
   generic bank. Settings → Learning shows the taught rows tagged "replaces built-ins" and
   "<template> only"; Remove deletes one.

## E. The corroboration record (your direction — record + surface only)

Nothing to flip; it is on (record-only, changes no values or decisions).
1. Reprocess any taught document, then open it in Review: a field that BOTH the taught position
   and the caption search read identically now shows **"✓ Two independent readings agree"** under
   the value.
2. In SFDEV, the ★ FINAL node per field now says "corroborated by keyword" / "sole witness" /
   amber "uncorroborated — keyword: '<other value>'" when an independent method read something
   DIFFERENT (that amber line is the Oakhaven-VAT class made visible — it acts on nothing yet).

## F. The LIST field type (your serials idea)

1. Settings → Processing → turn ON **"Collect every value of a 'List' field"**. (This also makes
   the "List (several values)" type appear in the field editor.)
2. Settings → Document Types → Service Worksheet → change the `serials` field's type to
   **List (several values)**.
3. Reprocess a Nordwind service worksheet that prints several "Serial No:" lines.
4. Expected: the serials field reads **"NW-…; NW-…; NW-…"** — every serial on the document, in
   page order, method `keyword_list` in SFDEV. The caption itself can never be a value again, and
   a list field is never frozen into a template.
5. In the teach wizard, list fields are pulled out of the draw steps with a note ("collected
   automatically by label"); a ⊕ on a list field in Review explains instead of arming.
6. Known v1 limits (deliberate): a single caption above a COLUMN of serials reads only the first;
   a list field never auto-files below 100 (it routes to review — safety first until measured).

## G. Should you start again with a clean DB?

**Recommendation: NO — keep this DB, with two repairs already done and one optional flip.**

Reasons:
- The teaching state (7+ templates, 38 taught mappings, 185 supplier hints, months of confirms)
  is the product's real value and today's features are all designed to coexist with it. Nothing
  shipped today requires a fresh start; migrations 61+62 apply cleanly on restart.
- The one genuinely poisoned learning (the serials teach that committed its own caption ×24) is
  ALREADY repaired — deleted from the live DB this morning, backup kept.
- The known differences from a fresh install are FLAGS, not data: a fresh install has
  `template_identity_on_page` ON (yours: OFF) and the same 43 reading improvements you already
  have. Flip that one toggle and your install matches a fresh one where it matters.
- What a clean DB would cost: every teach, every confirm, every graduated supplier — for no
  benefit today's fixes don't already give you.

**The exception:** if you want to run the full new-customer experience end-to-end (wizard, tour,
practice run, cold imports) — do that in a SANDBOX copy (the `_chris2` setup exists for exactly
this), not by resetting your live DB.

Housekeeping worth doing on the live DB instead of a reset:
- `deskew_on_import` is 'true' again — it silently disables `teach_angle_compose_scan`
  (the biggest teach-side win). Standing ruling is OFF; turn it off in Settings.
- Optionally reprocess the 24 documents still carrying "Serial No:" as their serials value after
  you enable the List type (step F), so they re-read as real lists.

## Flags now awaiting your decision (all built, all OFF unless said)

| Flag | State | Note |
|---|---|---|
| `template_identity_on_page` | OFF on your DB, ON for fresh installs | flip recommended (C above) |
| `teach_label_becomes_keyword` | OFF, now has a toggle + template scope | flip when D looks right |
| `list_field_scan` | OFF, new | flip to try F |
| `teach_typed_value_locate` | ON | smoke item A1 |
| `code_separator_structure_guard` | OFF | still: flip WITH the I→1 witness, not before |
| `vat_eu_formats` | OFF | only matters with non-UK suppliers |
