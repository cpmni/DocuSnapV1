# Quick File / general document management — missing-features scan (2026-09-13)

> Autonomous session deliverable (owner asked: "investigate what features we might be missing").
> Source: barry-the-brainstormer, briefed with the QuickFile+Departments plan + the current build.
> **Advisory only — nothing here is built.** Scope = the Quick File (non-OCR) lane + general
> document management for home / small-office. Prior-art rejections are flagged so nothing quietly
> contradicts an earlier decision. If the owner meant an APP-WIDE feature scan (not just Quick File),
> that's a separate follow-up — say the word.

## Already in the plan (NOT missing — for reference)
Typed Company/Date/Title + file without OCR · body-text search · Departments visibility gating ·
edit/replace + versions · drag-drop · watch-folder lane · `{department}` folder token.

## Ranked gaps

### Must-have (v1 / v1.1)
1. **Undo last filing** — one-click "Undo" on the filing receipt that pulls the doc back out (reuses the
   existing recycle bin / soft-delete). *Why:* the real home-user fear is "I filed it wrong and now it's
   lost." Reversibility is the trust game for a filing tool; the pane's receipt is its natural home.
2. **Duplicate detection on submit** — quick-filing the same file again → "You already filed 'X' for
   Acme on 12 Sep — file anyway / open the existing one?" (The OCR lane suffixes `-DUPLICATE`; Quick File
   should catch the human "I already did this" up front.) *Why:* people re-download + re-drop constantly.
3. **Text-snippet preview for office/email in search results** — one line of the already-indexed body
   text beside the title, so a grid of identical .docx/.xlsx icons is recognisable without opening.
   *Why:* cheap (text is already extracted); big retrieval win.
4. **Tags / labels** ("Tax 2026", "House move", "Warranties") — already Q6 in the plan; reinforced here
   because the Company/Year/Month tree is useless for cross-cutting collections. Keep optional + light
   (a LIST field or a small `document_tags` table). *Prior art:* tags were rejected as a STANDALONE
   (2026-08-26) but are correctly scoped INTO Quick File now.

### Differentiators (build next — the "minimal interaction, maximum value" wins)
5. **Expiry / renewal reminders** — optional "Expires / renews on [date]" on any doc; a calm Home card:
   "3 documents need attention soon — car insurance renews in 14 days." Warranties, insurance, MOT,
   passport, tenancy, domain, certs. *Why:* home users don't want to FILE the insurance PDF — they want
   to not get caught out when it lapses. The emotional core of home doc management. *Prior art:* the
   2026-08-26 "retention/archive" REJECTION was auto-DELETION (a chore); this is the opposite — a
   proactive nudge that never acts on its own, never emails (offline), never auto-deletes.
6. **Type-default expiry** — a "Vehicle Insurance" Quick File type defaults a 1-year expiry from the
   document date, so the reminder is set with ZERO extra typing. Pairs with #5; serves the north star.
7. **Bulk backfill of an existing folder tree** — a one-time guided wizard: point at a folder, propose
   Company (from sub-folder names) / Date (file dates) / Title (stems), confirm in a grid, file all as
   Quick File (no OCR). *Why:* the #1 barrier to ANY filing tool is "I already have 2,000 files in
   Explorer." Quick File's no-OCR speed is the only thing that makes backfilling thousands feasible —
   this is what converts a trial into a committed user. Must dedupe (#2), be resumable, confirm-grid
   never a silent dump.

### Future bets
8. **Collections / "Bundles"** — a named, ordered set of related docs ("Kitchen extension": quote.xlsx +
   contract.pdf + building-control letter + invoices); optional `{collection}` token. Build as "named,
   ordered tags," NOT a new heavy object model. *Why:* home/office paperwork clusters around EVENTS.
9. **Related-document linking** — the lighter primitive under #8 (link a warranty to its appliance
   receipt, a credit note to its invoice).
10. **Saved searches / smart folders** ("My warranties", "2026 tax") layered on tags/company/type/expiry.
11. **Clipboard / screenshot paste capture** — Ctrl+V an image/screenshot straight onto the Quick File
    pane; non-OCR (file the image). Fastest capture for a receipt that only exists on screen.

### Park / do NOT build (prior rejections — listed for completeness)
- **Print-to-ScanFinder virtual printer** — rejected/parked 2026-08-26 (`pendingfeatures.md`,
  `feedback_print_driver_audit.md`). Send-To + the watch-folder convention cover most of the ground far
  more cheaply. Keep parked.
- **Email-ingestion server** — rejected 2026-08-26. Dragging an email from Outlook gives a `.msg`, and
  the plan already handles `.eml`/`.msg` as dropped files — that's the correct scope.

## North-star lens
The two ideas that most serve "minimal interaction, maximum value": **expiry reminders + type-default
expiry** (value with near-zero typing) and **bulk backfill** (one action for thousands). Everything in
the retrieval group (tags/collections/linking/saved-searches) ADDS interaction, so it's justified only
because retrieval is the real job — keep all of it OPTIONAL and never required, or Quick File stops
being quick.

## Recommended next steps (for the owner to pick)
- Fold **Undo (#1)** + **duplicate detection (#2)** + **text-snippet preview (#3)** into the Quick File
  build now — all small, all trust wins, all v1-appropriate.
- Take **expiry reminders (#5/#6)** to barry→gary→Oracle as its own arc — it's the standout
  differentiator and touches the data model (a nullable `expires_on` + a Home card).
- Treat **bulk backfill (#7)** as the adoption feature once the Quick File lane is stable.
- Each new arc still passes the advisor + Oracle gate before build.
