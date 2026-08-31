# Help system rebuild — PLAN (2026-08-27)

**Owner ask (verbatim):** "we need a complete overhaul of the help system. it has been a few months since it was built and a
lot has been implemented since then. The main note would be that the recommended route to filing docs has changed. We now
recommend that a user teaches their docs then import. Please review the entire help file and write a plan with the help of
the agents to rebuild it from scratch. Mark any areas that require a screen shot and i will supply that. unless you can do it
yourself. There should be a quick start guide and it should be broken into meaningful areas and sections. it should be
written in plain speak for the layman to understand. it is aimed at people with little software experience and should guide
them through every feature and process workflow. We also need a help button on the home screen in the menu"

**Who wrote this:** a read-only survey of the current guide vs the app (gap map), barry (architecture / quick start /
screenshots / plain-speak / friction), bob (fact-vs-assumption, risks, delivery options — §9), a Chris-lens read of the quick
start (§10). Every "the app does X" claim below carries a file:line; three of barry's claims were re-checked at source and one
corrected (§2).

---

## 1. Where the guide is today (the gap map, condensed)

12 pages under `src/windows/help/` (`help-nav.js` = PAGES manifest + a hand-kept SEARCH_INDEX; `help.css`; `img/` 12 PNGs).
≈ 8,300 words; 34 % of them on Templates + Search-client setup; Review (the screen that changed most) has 762; the Teach
wizard — the recommended first step — has NO page.

| Page | Words | Stale against the app (file:line) |
|---|---|---|
| index | 389 | Quick start = Import → Process → Review (old route); "the card on the home screen opens the guide" — no such card (`main/index.html:838-1027`) |
| getting-started | 546 | first-run wizard is a welcome panel + five questions, not 3 steps (`onboarding/index.html:120-272`); home cards omit Practice run / Mailbox / Search clients / update banner / Finish setting up |
| importing | 567 | Review badge is on the nav RAIL (`main/index.html:763`); no "couldn't be read" chip (`:1050-1059`); nothing on teach-first |
| review | 762 | "three areas" → five (queue, tool rail `review/index.html:948-1013`, activity strip `:1091`, doc toolbar `:1097`, fields); "OCR Enhancement" renamed (`:979`, `:1057`); Mark Reviewed / Delete All / Reprocess all / Stop / Straighten / Print missing; no list pills, barcode, sender badges |
| templates | 1006 | "click Teach a document on the home screen" → rail button (`main/index.html:768`); "Settings → Learning Recovery" → tab is Learning Repair (`settings/index.html:437`); teach never called the recommended route |
| document-types | 760 | field types omit List and Barcode / QR (`settings/renderer.js:1605-1609`) |
| search | 478 | filters described don't exist — one "Search anything…" box + dates + total + type + include-unconfirmed (`search/index.html:329-347`); "the Bin" → Recycle bin; "Settings → Output Structure" → Files & filing |
| search-client / -setup | 700 / 1087 | current, but the longest page covers the narrowest feature |
| settings | 883 | claims 8 tabs — 12 (`settings/index.html:430-443`); Learning, Learning Repair, Audit, Search client tabs absent; Keyword label overrides moved |
| shortcuts / troubleshooting | 608 / 535 | mostly right; no "it filed something without me", no Put back, Split deletes the original (`review/index.html:1018`) |

**Zero coverage today:** Teach wizard; List fields (pills); Barcode fields; Quick check grid; Learning Repair; activity strip;
Put back / auto-committed bar; sweep consent bar; sender-readiness badges; auto-file bar + graduation; Straighten (3 places);
group-by-sender; recycle bin; Mark Reviewed; "Teach this document"; welcome tour; practice run; About / password / theme;
update banner; Terms; Audit; duplicates / unrecognised / reading formats; reference typo-propagation + Undo; Print.

**Deep links:** 7 senders in the app, 60 keys in the manifest; 20 keys have no sender; `client-cert-setup` is a dead anchor;
`teach` lands on a page titled "Templates & Learning". `data-help-key` (the "?" popups, `shared/helpmode.js`) is a separate
namespace that never opens the guide.

**Screenshots:** `search-results.png` missing (placeholder shows); `settings-appearance.png`, `settings-general-processing.png`
orphaned; `img/README.md` lists slots no page uses.

## 2. Facts that shape the plan (verified at source this session)

| Fact | Source | Consequence |
|---|---|---|
| The help window is an **independent top-level window** — `help` is not in `CHILD_WINDOWS`, so the modal branch never runs (barry's "it is modal" was WRONG; bob caught it) | `src/main.js:502-503, 670-674`; `:1681-1682` | a reader CAN follow a step while reading it; the only friction is that the guide can drop behind the app — a float-above preference, not a defect (§8) |
| The Mailbox / approval workflow is **LIVE** for LAN add-on holders (`WORKFLOW_FEATURE_ENABLED = true` since 2026-08-02); only the Settings tab is hidden. CLAUDE.md's "hidden pre-release" is stale | `src/services/entitlementService.js:37` | decision D7: one section under "Search from other PCs", or nothing |
| Fresh installs file by themselves at **90** | `database/index.js:1688` | never print a hard number for "how many confirms"; quote the Settings slider |
| Activity strip + Quick check are **OFF on a fresh install** (no seed row; read as `=== 'true'`) | `review/renderer.js:833`; `review/handler.js:188-189`; no row in `database/index.js` | document only "if turned on" — or the owner flips them for new installs first (decision D1) |
| The sweep / consent bar ("N more from SENDER…") and auto-accept are **ON for every install** since migration 80 — barry's plan had them OFF; CORRECTED | `database/index.js:1891-1898` | D3 must explain the bar and what "Yes, file them" does |
| Deep-link path: renderer `openHelpWindow(section)` → `main.js` → `help-section` → `help-nav.js goToSection` | `preload.js:132`, `main.js:1680-1688`, `help-nav.js:259` | the new manifest is the only thing to regenerate; add a dead-key test |
| Home top bar already has **Help** (`#btn-help-guide` → `openHelpWindow('main')`) and **?** (help mode) | `main/index.html:729-730`, `main/renderer.js:793` | the menu item is an ADDITION, not a move |
| Teach = 6 steps; first-run = welcome + five questions + done; Settings = 12 visible tabs (+ a hidden Workflow tab) | `teach/index.html:309-461`; `onboarding/index.html:120-272`; `settings/index.html:430-443` | page counts in §4 |

## 3. The story the new guide tells

*"Scan Finder is a filing clerk who learns the companies you deal with. Show it one example of each document you get; it
files the rest, asks you when it isn't sure — and always shows you what it filed on its own."* (The third leg is the
Chris-lens addition: the clerk who is sure and WRONG must still leave the paper on the desk — the guide promises the
receipt and the take-back in the same breath as the automation.) The spine is **Set up → Teach → Import → Check → Find**.
The old "import first, fix in Review" route survives as the fallback page C2 ("A supplier it doesn't know yet") and is
never the headline.

## 4. Architecture (reading order = nav order)

| # | Page (file) | Use this page when… | Walks | Shots / diagrams |
|---|---|---|---|---|
| A0 | Home (`index.html`) | you open the guide: pick your path — first day / I have a pile / something's wrong / find a document | the 4-step spine | DIAGRAM spine |
| A1 | Quick start (`quick-start.html`) | first day; one printable screen, 7 steps (§5) | §5 | none (links to shots) |
| A2 | Set up (`set-up.html`) | you've just installed it | sign in; the 6 setup questions; welcome tour; practice run; the home screen (rail, cards, Help / ?, user menu, "Local only", Finish setting up, update banner) | SHOT home-dashboard (menu open) · SHOT setup question 1 |
| B1 | Teach your regular documents (`teach.html`) | before your first batch, and whenever a new sender appears | why one of each; which copy to pick (clean, flat, typical); the 6 wizard steps; draw the value then its printed label; "type it instead"; Straighten; more than one page; lists (one value → its caption); how many senders | SHOT teach step 3 mid-draw · SHOT teach step 4 (the list) · SHOT teach review |
| B2 | Kinds of document and their details (`document-types.html`) | a document type or a detail is missing | catalog; the three fixed details (Document Issuer / Date / Reference); your own details incl. List and Barcode / QR; renaming is safe; "Also appears as" | SHOT document-types (keep) |
| C1 | Import a batch (`import.html`) | you have a folder of scans | in-folder vs out-folder; Process / Stop; the results table (Ready to file / Confirm to file); "couldn't be read" chip; separator sheets + Split (deletes the original); watch folder; duplicates; what to expect the first time | SHOT import-view (re-shoot with the chip) · DIAGRAM in/out folders |
| C2 | A supplier it doesn't know yet (`unknown.html`) | Review shows "Unknown Company" or empty details | fill in the details; **Teach this document**; ⊕ point out a detail; the old route; Template Wizard = Advanced box | SHOT a held doc with an empty issuer |
| D1 | Check what it wasn't sure about (`review.html`) | the Review number is not zero | the 5 areas; grouped by sender / newest first; sender badges ("N more to file by itself"); the "why is this here" note; look → fix → Confirm & File; Mark Reviewed (Space); Defer; File All Ready; Delete → recycle bin; Reprocess this sender / all; Straighten; Clean up a hard-to-read scan; Print | SHOT review-window (re-shoot, 5 numbered areas) · DIAGRAM "what a note means" |
| D2 | Fixing a detail (`fix-a-detail.html`) | one detail is wrong | type over it; drag a box (⊕); dates / amounts; Use / Keep; list values as pills (edit, ✕, put back, + One it missed); reference fix with Undo; "this document only" vs "learn it" | SHOT field note with Use / Keep · SHOT list pills |
| D3 | When it files without asking — and how to take one back (`files-by-itself.html`) | a supplier's count reached zero, or something was filed you didn't see | the pass mark (Settings slider); clean confirmations; the count beside the name; "N more from SENDER… file them?" bar; "N filed by itself — click to check them"; **Put back**; Quick check / activity strip *only if turned on* (D1) | DIAGRAM trust ladder · SHOT Processing "filing by itself" section |
| E1 | Where things go (`where-things-go.html`) | you want to see the files | folder tree; file-name anatomy; Files & filing builder; the notes file beside each document; Backup card | DIAGRAM folder tree + file name · SHOT output-structure (keep) |
| E2 | Find a document (`search.html`) | the accountant rings | Search anything; dates; totals; type; include unconfirmed; open / show in folder / send back to Review; recycle bin, Restore all, Empty bin | SHOT search-results (NEW) |
| E3 | Search from other PCs (`other-pcs.html`) | colleagues need to search | what it is; seats; firewall; the 4 setup steps (collapsed); FAQ | DIAGRAM network picture |
| F1 | Settings tour (`settings.html`) | you're looking for a knob | 12 tabs, one paragraph each | DIAGRAM 12-tab map |
| F2 | When it keeps getting a supplier wrong (`learning.html`) | the same company comes up wrong for the third time | Learning tab; Learning Repair (Start fresh with this sender / Forget this type / Undo / Send back to Review); Templates viewer = Advanced | SHOT Learning Repair |
| F3 | Users, licence, backup, legal (`admin.html`) | you're the admin | Users & activity; Audit; Licensing; Backup & restore; Advanced (diagnostic logging, Terms, re-run setup) | none |
| G1 | Troubleshooting & FAQ (`troubleshooting.html`) | something's wrong | question-led, FIRST question "It filed under the wrong company" → Put back / Send back to Review; then "it filed something without me", "crooked scan", "one PDF, several documents", "I taught it but it still asks", "a serial is missing from the list", "a new supplier: already in Review → C2, not yet → B1" | — |
| G2 | Keyboard shortcuts (`shortcuts.html`) | — | — | — |
| G3 | Words we use (`words.html`) | a word puzzles you | 15-line glossary (§7) | — |

Left out of the guide on purpose: the dev inspector and SFDEV tools. The Mailbox / approval workflow is LIVE for add-on
holders (§2) — decision D7 says whether it gets a section under E3. Help-mode ("?") popups keep the one-line explanations;
each popup gets a "More in the guide →" link (§8, later slice).

## 5. Quick start (A1) — the seven steps

Rewritten after the Chris-lens read (§10). A two-line box sits ABOVE the steps: **"Two folders. A — where filed documents
end up (you choose it in step 1). B — where your scans wait (step 2). Never scan into A."** Every step ends with "You'll know
it worked when…". `[VERIFY]` = the writer must check the fact against the app before printing it.

| Step | Do | You'll know it worked when… | Screen |
|---|---|---|---|
| 1 | Create your login (you're the admin) and answer the setup questions. The one that matters: **where filed documents go** (folder A). Don't point it at a folder that already holds your scans. | you see the Home screen | First-time setup |
| 2 | Away from the computer. Pick one clean, flat, typical copy of each document you get regularly — start with your five biggest suppliers. Scan them into folder B, one document per file `[VERIFY: does Import split a multi-page feeder PDF? if not, say "one document per file"]`. | folder B holds one file per document | your scanner |
| 3 | Click **Teach** (the buttons down the left). Choose one of the scans from folder B. Say what kind of document it is. Point out each detail it asks for `[VERIFY: the wizard asks per detail]`: draw a box round the value on the page; if a printed label sits beside it ("Invoice No:") box that too; no label — the company name at the top — box the name alone. Click **Done**. Repeat for each supplier you scanned. | the taught document is `[VERIFY: filed straight away / waiting in Review]` — say which, and where | Teach |
| 4 | Click **Import** → choose folder B → **Process Documents**. Your scans are `[VERIFY: copied / moved]`; the ones you taught in step 3 `[VERIFY: are skipped as already filed / appear once]`. Long enough to make a tea for a big pile. | the results table appears — "Ready to file" / "Confirm to file" beside each document | Home → Import |
| 5 | Click **Review** (the number is how many are waiting). For the suppliers you taught, the details are already filled in; fix anything wrong by clicking the detail and typing over it. **Confirm & File** files the one you're looking at. **File All Ready** files only the rows marked Ready and leaves the rest waiting. A filed document can always be sent back from Search. A supplier you didn't teach comes up mostly blank — see "A supplier it doesn't know yet". | the number drops by one each time | Review |
| 6 | Keep confirming. After enough correct ones from a supplier (the count beside its name ticks down), it starts filing that supplier's documents without asking. Home shows "N filed by itself" — click it to check them. Wrong one? Open it and click **Put back**. | the count beside the supplier's name reads "files by itself" | the Review list |
| 7 | Click **Search** → type anything you remember → open it, or **Show in folder**. Still waiting in Review? Tick **Include unconfirmed** `[VERIFY label]`. | the document opens | Search |

"How you know it all worked": open folder A in Explorer — Company / Year / Month, one neatly named file each. Never more
than 20 words a sentence on this page; step 2 of the draft was 33.

## 6. Screenshot plan — `[SHOT]` markers the owner asked for

Rule (barry): **photograph** when the reader must recognise a screen or find a control; **draw** when they must understand
an idea. Warm Paper theme, 1280 px wide, windowed, fictional senders only. Callouts are HTML numbered circles laid over the
image in `help.css` — never baked in — so a re-shoot keeps its labels. Most shots can be captured by me on the Chris sandbox
(fictional documents, CDP 9223, `scripts/capture-window.ps1`); the owner supplies only the ones marked OWNER.

| Id | Page | Moment / what must be visible | Who |
|---|---|---|---|
| S1 | A2 | Home screen, user menu OPEN showing **User Guide…**, rail visible | me (after the menu item exists) |
| S2 | A2 | First-time setup, question 1 (output folder) | me |
| S3 | B1 | Teach step 3 mid-draw: value box + label box + the read-back bar | me |
| S4 | B1 | Teach step 4: the list of taught details before Done | me |
| S5 | B2 | Settings → Document Types with a List and a Barcode field visible | me |
| S6 | C1 | Import view after a batch: results table with a "Confirm to file" row and a "couldn't be read" chip | me |
| S7 | C2 | Review with a held document whose Document Issuer is empty + the "Teach this document" card | me |
| S8 | D1 | Review window, five areas numbered, one note visible, a sender badge "N more to file by itself" | me |
| S9 | D2 | A field note with **Use "…"** / **Keep "…"** buttons | me |
| S10 | D2 | A List field as pills, one removed (greyed with ↺), the tools row | me |
| S11 | D3 | Settings → Processing, the "filing by itself" slider + clean-confirmations text | me |
| S12 | E1 | Files & filing tab (output-structure — existing shot, verify) | keep |
| S13 | E2 | Search window with a hit for "Search anything" + the Recycle bin buttons | me (NEW — currently missing) |
| S14 | F2 | Settings → Learning Repair with one sender selected | me |
| S15 | B1 | **A real scanner / paper moment**: the pile of "one of each" on the desk, or the scanner's own software saving to a folder | OWNER (only if wanted — a diagram works too) |
| DROP | — | `home-themes`, `settings-appearance`, `settings-general-processing`, `template-create/anchor/fill-mode/landmarks` | — |
| KEEP | — | `document-types.png`, `output-structure.png`, `settings-general-folders.png`, one `template-manager-overview.png` (Advanced box) | verify still current |

Diagrams (inline SVG, never stale): the 4-step spine · in/out folders · folder tree + file-name anatomy · field-row anatomy ·
the trust ladder (confirm → confirm → "files by itself") · the 12-tab map · "what a note means" · the search-client network.

## 7. Plain-speak rules + glossary (G3)

| Never write | Write |
|---|---|
| template, layout model | what it learned from that sender |
| anchor, mapping, zone | the printed label next to a detail; where to look |
| confidence | how sure it is (keep the % as the screen shows it) |
| OCR, extraction, pipeline | reading the scan; the details it found |
| graduation, trusted scope | "files by itself" |
| field | detail (except where the screen itself says Field) |
| supplier / sender / issuer | "the company it's from" — and, at the box, its printed label **Document Issuer**. Chris: nobody in an office says "sender"; the draft itself reached for "supplier" within two steps. (D3) |
| reprocess | read it again |
| deskew, registration, landmarks, fingerprint, hash | straighten / (never) |
| auto-file, auto-commit | "files it without asking" — carries the warning "by itself" hides |
| threshold, the bar | "the pass mark — how sure it must be before it files without asking" |
| metadata, XML | the notes file beside each document (say whether it clutters the folder or is tucked away in `.metadata`) |
| watch folder, born-digital | a folder it watches; a PDF that came by email rather than through the scanner |
| queue | the list / waiting for you |
| detail (first use on a page) | "the details (date, number, total)" — on its own the word is nothing |
| rail | the buttons down the left |
| badge | the count beside the name |
| chip | the small note |
| pill | each value in its own box |
| Defer | put aside for later |

Style: second person; verb first ("Click **Teach**"); button names bold, exactly as on screen; ≤ 20 words a sentence; every
page opens "Use this page when…" and every process ends "How you know it worked"; no word used before it is explained; name
an icon by its tooltip, never its glyph. Three tones to avoid: the engineer (how it works before what to do), the salesman
("magic", "AI", "seamless"), the scold ("simply", "just", "obviously"). Word budget: whole guide ≤ 7,000; quick start ≤ 350;
any page ≤ 700; the search-client setup collapsed under details/summary.

## 8. The Help button on the Home screen menu (owner ask) + the window

- `src/windows/main/index.html` `#user-menu`: add `<button class="user-menu-item" id="menu-user-guide">User Guide…</button>`
  directly ABOVE "Show welcome tour" (groups Guide → Tour → Practice; Sign out stays alone under the separator).
  `main/renderer.js`: `menu-user-guide` → `window.docusnap.openHelpWindow('home')` (the manifest's Home page); the top-bar
  **Help** keeps opening Getting Started; help-mode popup text for the new item.
- Optional: a "Read the quick start" line in the "Finish setting up" checklist card.
- **The window itself needs no change**: it is already an independent, non-modal top-level window with its own taskbar
  button and remembered size (`main.js:502-503`). Optional preference (decision D2): make it FLOAT ABOVE the app (a
  non-modal child of the main shell) so it cannot drop behind — a small `main.js` change in its own slice, not a must.
- Readability: 15–16 px body, 1.6 line height, 760 px measure, A+/A− (persisted); `@media print` + "Print this page";
  nav grouped A–G; "On this page" list on long pages; the SEARCH_INDEX generated from the h2/h3 at build (a script) plus one
  synonym line per page ("wrong company", "crooked", "won't file") — the hand-kept index has already drifted.
- Every "?" popup that has a guide section gets "More in the guide →" through ONE popup-key → guide-key table (the two
  namespaces never meet today).

## 9. Risks, delivery shape, decisions — bob (plain-English review; two of his calls re-checked at source)

**Fact vs assumption.** Verified TRUE: Teach = 6 steps; 12 visible tabs + a hidden Workflow tab; activity strip + Quick
check OFF on a fresh install; fresh-install bar 90 (mig 71); graduation slider default 5 (min 3, max 20); `client-cert-setup`
dead anchor; `teach` lands on Templates; the search index is hand-kept and heading-only; 13 px / 1100 px; no print
stylesheet. **Corrected barry:** the help window is NOT modal (§2). **Corrected bob:** the sweep / consent bar is ON for every
install — migration 80 forces `scope_sweep_enabled` + `scope_sweep_auto_accept` true (`database/index.js:1891-1898`); mig 79's
'false' seed is superseded. **Over-stated:** "6 setup questions" — onboarding is a welcome panel, five questions, done; "20 of
60 keys dead weight" — harmless (only SENT keys matter: one misses, one mis-lands); "files by itself at 90 after 5 clean
confirmations" conflates the fresh-install bar with the trusted-sender floor the Settings copy quotes ("95 %+") and an internal
88 critical-field floor — hence the rule: never print a number, point at the slider. **Unverified until used:** the Chris
sandbox is alive on current code for screenshots (it was restarted on today's code at 16:29 — CDP 9223 answered).

**Risks → fences.**
| Risk | Fence |
|---|---|
| Deep links break (7 live senders + default `overview`; nothing pins manifest ↔ anchors — `check:help` guards popups, not the guide) | a pin that parses `PAGES`, greps every `openHelpWindow(` sender, asserts each key's page carries that `id`; old pages stay until their replacement exists so every key resolves at every slice |
| `npm run check:help` goes red | only if the new menu item carries a `data-help-key` without HELP_TEXTS — add the text; the popup → guide link table (§8) must fall back silently on a missing key; `check:help` is not in `build`/`test` — run it by hand per slice |
| Stale-screenshot debt (~10 re-shoots, ~8 new; the app changes daily) | ship text first (the placeholder already renders "coming soon"); HTML-overlay callouts; a `shots.json` with date + commit per image |
| Scope creep into the app (float-above, A+/A−, print CSS, popup links, "Read the quick start" in Finish setting up, flipping the OFF trio) | guide slices touch only `src/windows/help/**` + the two-line menu item; everything else is a separate later list |
| Content drifts from code mid-write (branch 14+ commits ahead, unpushed) | write against a named commit; stamp "verified against `<sha>`" per page; re-verify spine pages at release |
| Plain-speak hides the control (Settings prints Templates / Field / Suppliers) | the ON-SCREEN word when NAMING a control, the plain word when EXPLAINING — overrides §7 for template / field / supplier |
| The app's own vocabulary is inconsistent ("sender" ×101, "supplier" ×58, "Document Issuer" ×50 in window HTML) | the guide cannot fix it; queue an app copy pass separately |

**Delivery shape (ranked; 1 recommended).** (1) **Spine-first** — slice 1 = new scaffold (manifest, grouped nav, glossary) +
Quick start + Teach + Import + Check + Find + the menu item, old pages kept and re-mapped; the owner sees a working, deep-
linkable guide after ~one day of agent work and corrects the tone after 5 pages, not 19. (2) All 19 pages in one pass — 2–3
days, nothing to see until the end, screenshots become blocking. (3) Restructure + rewrite only the stale pages — cheapest,
but keeps the Import → Process → Review story; contradicts the brief.

## 10. Chris-lens read of the quick start and glossary (one simulated persona, paper draft, no app)

**TL;DR:** the shape is right — starts at the scanner, ends with opening the folder in Explorer; "the first guide for this I
could print and hand to a temp". As drafted he **stops at step 3 and rings someone** (which details? what to box when the
company name has no printed label — it's a logo; how many suppliers before he may import — he has 28; where did the
invoice he taught with go after **Done**?). Step 6's "their documents stop coming to you" reads as "disappear" — he'd check
the folder every hour by Wednesday. Verdict: yes after two weeks **provided steps 3 and 6 get their missing lines**; as
printed, no.

| # | Card (ranked by harm) | Fix (applied to §4/§5/§7 above) |
|---|---|---|
| 1 | Step 3 is one line for the longest job on the page; BLOCKED at the logo name; "where's my paper" after Done | step 3 rewritten: buttons down the left, per-detail, "no label — box the name alone", start with the five biggest suppliers, say where the taught document went |
| 2 | "stop coming to you" + a clerk who is sure and wrong; the story promised "one example", step 6 says keep confirming | story gains its third leg (the receipt); step 6 says "files without asking", where to see them ("N filed by itself"), and **Put back**; "after enough correct ones" replaces the number |
| 3 | Three folders in three steps, never told if they're the same; does Import move or copy; do taught docs go in twice | the two-folder box above the steps; step 4 `[VERIFY]` brackets for copy/move and skip |
| 4 | Two filing buttons, no reason which; "already filled in" for a pile it hasn't met | step 5 spells out both buttons + "sent back from Search" + the untaught-supplier line |
| 5 | sender / Document Issuer / supplier — three words for one box; "the bar"; rail / badge / chip / pill / Defer not on the never-write list | §7 rows: "the company it's from (the box says **Document Issuer**)", "the pass mark", + five UI words |
| 6 | The wrong-company case has no page — Put back hides under a title that reads like a feature to switch on | D3 → "When it files without asking — and how to take one back"; F2 → "When it keeps getting a supplier wrong"; C2 → "A supplier it doesn't know yet"; G1's first question = "It filed under the wrong company" |
| 7 | "Sign in" on a first day (nothing to sign in with); only one "how you know it worked" for seven steps; step 2 was 33 words | step 1 "Create your login (you're the admin)"; a "You'll know it worked when…" column; step 2 split |

**Worked:** "open your filed-documents folder in Explorer — Company / Year / Month, one neatly named file each" and "Away
from the computer" in step 2. **His §13 check on the draft:** the first box fails at step 3, Cards 1–2 are above LOW, step 2
breaks the 20-word rule — all three now addressed in the plan; the writer re-runs the lens on the real page.

## 11. Delivery slices (proposal — bob ranks in §9)

| Slice | Delivers | Gate |
|---|---|---|
| 0 | the menu item (two lines in main) + the manifest/anchor pin + the generated search index — the only app-side changes; float-above / readability / print / popup links wait for D2/D6 | `test_help_nav.js` (every manifest key has an anchor; every sender key is in the manifest); `scripts/check-help-coverage.js` still green |
| 1 | THE SPINE: A0, A1, A2, B1, C1, D1 (six pages, ≈ 3,000 words) + shots S1–S4, S6, S8 | Chris-lens read on the sandbox with the pages open; word budget; dead-link test |
| 2 | B2, C2, D2, D3, E1, E2 + shots S5, S7, S9–S13 | same |
| 3 | E3, F1, F2, F3, G1, G2, G3 + S14 | same; owner reads F3/E3 |
| 4 | popup → guide links; print; readability polish | help-mode coverage script |

Each slice is one commit; the old pages are deleted only when their replacement ships (the manifest drives what is live).

## 12. Owner decisions needed before writing starts

- **D1** Activity strip + Quick check (OFF on a fresh install): omit from the spine and give them one "Optional extras" box in
  D3 (bob's recommendation), document "if turned on", or flip them ON for new installs first (a product change with its own
  migration + gate — not a help task)?
- **D2** Help window: leave it independent (recommended, zero code) or make it float above the app (small `main.js` change,
  own slice)?
- **D3** Vocabulary: "sender" as the everyday word when EXPLAINING (already dominant in the app), always the printed label
  (**Document Issuer**, **Field**, **Templates**) when NAMING a control — agree? And yes/no on a later app copy pass retiring
  "supplier".
- **D4** Screenshots: I shoot S1–S14 on the sandbox (fictional senders, Warm Paper, 1280 wide); you supply S15 only if you
  want a real-desk photo. If unsure, every shot goes on your list.
- **D5** Search-client pages (E3): keep in the guide (collapsed) or move to a separate admin document?
- **D6** Slice 0's app changes: the menu item is asked for; everything else (readability, print, popup links) is a proposal.
- **D7** Mailbox / approval workflow is live for add-on holders — one section under E3, or nothing?
- **D8** The menu item: "User Guide…" in the account menu above "Show welcome tour" — is that "the menu" you meant, and
  should it open the guide Home or the Quick start?
- **D9** Numbers: agree the guide never prints the bar / graduation numbers and points at the sliders instead.
- **D10** Template Wizard / Template Manager: an "Advanced" appendix page, or one paragraph in C2 and F2?
- **D11** Tone sign-off: you read Quick start + Teach first and approve the voice before the rest is written.

## 13. Acceptance checklist ("the guide is done")

- [ ] A first-time reader can follow the quick start to a filed document without opening any other page.
- [ ] Every button name in the guide appears on screen exactly as written (spot-check 20 at random).
- [ ] No banned word (§7) outside the glossary; no sentence over 20 words on the spine pages.
- [ ] Every `[SHOT]` slot has an image or a diagram; no "Screenshot coming soon" placeholder visible.
- [ ] Every deep link from the app lands on the right heading; the test is green.
- [ ] Every surface in §1's zero-coverage list has an owner page (or an explicit "popup only" reason).
- [ ] Chris-lens read: no card above LOW on the spine pages.
- [ ] Word budget met; the User Guide… menu item works and says in three lines what to do first.
- [ ] Search "recycle bin", "straighten", "files by itself", "wrong company" in the guide — each finds a heading.
- [ ] Nothing describes a feature that is OFF on a fresh install without saying so.
- [ ] `npm run check:help` and the new deep-link pin both pass.
