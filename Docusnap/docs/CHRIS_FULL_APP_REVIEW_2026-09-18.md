# Chris The Customer — Full App Review — 2026-09-18

## Round: 2026-09-18 (sandbox, focus = the Departments feature) — PARTIAL (run cut short)

**Sandbox conditions:** fresh seeded DB + isolated userData under the session scratchpad, copied Demo Docs,
CDP port 9223. The run was cut short: the sandbox instance was stopped by the main session to free the build
binary for a rebuild (the two bug fixes), so Chris only completed first-contact + the Departments *settings*
section — the enforcement test (sign in as a colleague, confirm they can't see another department's docs) was
NOT reached. Treat the verdict as provisional. Nothing implemented; cards queue for the owner's vet.

**Verdict:** provisional NO on trust — "I never saw it do the one thing it's for" (never watched Departments
actually hide one team's documents from a colleague). The setup screens read well.

### Findings (3 — only what he actually saw)
- **Card A — Retire vs Delete, no hint which is which (medium).** On each department row `Rename… · Retire ·
  Delete` sit together with nothing saying the difference or which is undoable. Proposed: a grey line under each
  dept — "Retire: hides it but keeps its documents. Delete: removes it for good (only when nothing is filed
  under it)." (May be explained in the confirm box — not reached.)
- **Card B — admin's own row shows department tickboxes despite "admins see everything" (medium; TOP FRICTION).**
  The admin row shows an "All departments" toggle (looks off) + an unticked Finance box, directly under the
  feature's "Admins always see everything" line — made him fear he had to switch "All departments" on for
  himself. Proposed: for an admin, replace the tickboxes with a greyed line "Admins see every department —
  nothing to set here." (Relevant: the membership UI is being reworked for D7 anyway — fold this in.)
- **Card C — the master-switch confirmation is a quiet one-liner (low/preference).** After turning it on, only
  "On — documents can now be restricted by department." Proposed: also remind that untagged docs stay visible
  to everyone + point at where to set membership. (Already in the paragraph above the switch.)

### What genuinely worked
The master-switch explanation ("Admins always see everything. Documents with no department are visible to
everyone. Departments restrict what Scan Finder shows — they do not change Windows folder permissions.") —
answered his three biggest fears (lock-out, untagged docs, Windows folders) before he had to ask.

### Warnings truth-table
Nothing destructive was pressed (run cut short) — no truth-table evidence this round; no native confirm dialog
reached.

### Not reached / humility
Create/rename/retire/delete + their confirm/refusal wording; the delete-while-in-use refusal; adding a second
edit colleague; the per-document Department dropdown in Review; and the enforcement test (the heart of the
mission). A stray "Finance" department present at start = leftover sandbox test data (the app ships no default
department — code-checked), not a product fault; re-seed clean before the enforcement re-run.

### Owner action to finish this vet
Re-run `/christest` on the CLEAN rebuild (the two fixes are in `…-1250-976f42f-TEST`), re-seeded, and let Chris
complete the management flows + membership + per-doc tagging + the enforcement check.

---

## Round: 2026-09-18 (LATER, sandbox, focus = the Departments feature) — COMPLETE

**Sandbox conditions:** fresh re-seeded DB (mig 184) + isolated userData under the session scratchpad, copied
Demo Docs (1480 files), CDP port 9223, capture PID 24548, clean `…-1346-976f42f-TEST` build. This is the
COMPLETE re-run the earlier partial vet asked for — first contact, real work, teach, search, the scary buttons,
the workflow, AND the Departments setup end to end. Card B (admin-row tickboxes) is now FIXED and Chris
confirmed it. Nothing implemented; cards queue for the owner's vet.

**Verdict:** would keep using it after two weeks = **YES** — files where it says, teaches quickly, shows its
work, nothing filed itself on a guess. Two blockers to full trust: a wrong reference wore a green "High 93%"
badge, and a Delivery Docket was typed Invoice then blocked on an invoice number it doesn't carry.

---

### TL;DR (his 3 lines)
The core loop — bring scans in, check them, teach a layout, confirm, find it again — is genuinely good and
honest, and the new Departments feature is clear and well-worded for a small firm. Biggest worry: the one field
that was WRONG wore a green "High" badge while the field that was RIGHT was the one flagged to check. And a
plainly-labelled Delivery Docket was called an Invoice and then blocked him for an invoice number not on the page.

### Finding cards (ranked by harm)

**1. The WRONG field wore the green "High" badge; the RIGHT field was the one flagged (HIGH — trust/misfile).**
Page prints `Order No. PO-69837`. Panel: `PO NUMBER  High · 93%` value `PO-69637` (misread), while
`DOCUMENT ISSUER  Check · 69% … please confirm it's the sender` was already correct. Trusting the green badge
files the wrong number. Proposed: don't show a confident "High" badge on a reference the app couldn't
cross-check; or prompt "please check the reference against the page" when a reference is the only unverified field.

**2. A Delivery Docket was typed Invoice, then blocked on an invoice number it doesn't have (MODERATE-HIGH — misfile + dead end).**
Page: `DELIVERY DOCKET` / `Delivery Note No. DN-44966`. Panel type = `Invoice`; `INVOICE NUMBER Not found`;
"please fill in Invoice Number — this field is needed to file it." No Delivery Note type out of the box. Happened
right after teaching Northgate's invoice (same letterhead) — recognised the company too eagerly. Proposed: when
the printed title disagrees with the guessed type, lead with "This looks like a Delivery Docket — is that right?"

**3. Teach warning "doesn't look like a company name" — but the big blue button was "Looks right" (MODERATE — teaches wrong value).**
`Company name: ZN Northgate Textiles` · `⚠ That doesn't look like a company name…` with primary blue
`Looks right →` and grey `Redraw`. A hurried click teaches a bad value to every future Northgate doc. Proposed:
when the read-back is flagged, make Redraw the primary button and quieten "Looks right". (The catch itself is excellent.)

**4. New departments didn't appear in already-open windows (LOW-MODERATE — "is it broken?").**
Review's `Visible to` control + the Settings `Finance — 0 documents` count only appeared/updated after a window
reload. Proposed: make them appear live when Departments is switched on, or show "reopen Review to tag documents".

**5. A confirmed document still says "62% confidence" (LOW — wording).**
Search preview: `Status confirmed` and lower `Confirmed  62% confidence`. Reads like the app still isn't sure
about a doc he confirmed himself. Proposed: after confirm, drop the % or relabel "how it first read it".

**6. Couldn't send to a new colleague until granting "stamping"; the message only mentioned approval (LOW — discoverability).**
Send dialog `To: No one can approve yet — grant stamping in Settings`, stayed that way even after choosing
`Just so they've seen it`. Proposed: for acknowledge-only let him pick anyone; point to "Settings → Users &
Departments → Can stamp".

**7. In-document Find said 0/0 for text on the page (LOW — cosmetic).**
Preview `FIND PO-69837  ‹ 0 / 0 ›` on a page that prints `PO-69837`. Proposed: hide the counter on scans or
match the reference the way search did.

**8. Wizard/tutorial screens are mostly empty space (LOW — cosmetic).**
Teach intro + Practice run open full-screen with text in the top third. Proposed: centre the content or open at a
comfortable window size.

### Warnings truth-table
| Scary action | Warning said | Actually happened | Truthful? |
|---|---|---|---|
| File All Ready | file 2 of 3, 1 missing required stays, "as if you confirmed it yourself" | queue 3→1, 2 filed, 1 stayed | Yes |
| Delete (single) | goes to app recycle bin, restore from Search | appeared in bin, restored to Review 0→1 | Yes |
| Delete All Review | to recycle bin, files on disk kept, confirmed/deferred unaffected | read, dismissed (not run); copy matches single-delete | Yes (copy) |
| Split PDF | "only one page — nothing to split" | correct, 1-page scan | Yes |
| Reprocess | (no warning) | ran silently, no edits to lose | Appropriate |
| Recall/Cancel route | two-step "Cancel route" → "remove from inbox" | removed; History "RECALLED… Cancelled by Chris Fenton" | Yes |
| Temp password | "shown only once, not stored" | shown once behind modal, behaved as described | Consistent |

### Departments — judged as a normal admin
Wording is the best part: "Everything stays visible to everyone until you turn this on", "Admins always see
everything", "Documents with no department are visible to everyone", and especially "they do not change Windows
folder permissions" (answers the wrong assumption head-on). Turning it on with no departments = no scary confirm
(right — nothing hidden). Type default "Who can see documents of this type?" + per-doc "Visible to" made sense;
filed-doc counts proved a doc really got tagged Finance+Workshop. **Card B FIXED — confirmed** (admin sees
"nothing to set here", no tickboxes). Two honest limits: (1) sole real user → never saw a colleague actually
BLOCKED (needs a second non-admin login); (2) as admin never saw a locked/greyed chip (those only show for a
non-admin editor). Small nit: "Everyone" is a round radio while departments are square tick-boxes — briefly unsure
whether they combine (ticking a department correctly cleared "Everyone").

### What genuinely worked
The teaching payoff — finish screen "Done — Scan Finder just learned something… nothing files on a guess",
"confirm 2 more and the rest file themselves", Now→Next few→Soon picture. Honest expectations. Runners-up: the
shelf metaphor is real (Company/Year/Month with the corrected reference in the name); Review honesty
("Read at 60% · your setting 90%").

### Top friction
The misread reference wearing a green "High 93%" badge while the correct field was the flagged one (Finding 1).

### Humility
One made-up office manager on made-up test scans; guesses at WHY are symptoms not diagnoses; some "wrong reads"
may be quirks of these test scans. Couldn't test the two things needing a second person: a colleague blocked by
Departments, and a colleague approving/stamping. All for the owner to vet — nothing changes on its own.

*(Screenshots `step01`–`step31` + `crop-orderno`/`crop-ponum` in the sandbox folder. Left as-is: 5 docs filed,
3 departments, second user "Sam Rivers", one delivery docket still in Review.)*

---

## Round: 2026-09-18 (NIGHT, sandbox, SECURITY focus = Departments isolation) — VERDICT: WATERTIGHT

Adversarial security vet of the Departments feature (owner: "if any unauthorised user can access docs they
shouldn't it would be a disaster"). Two departments + two Edit users; docs tagged Finance-only / Ops-only /
shared; Chris signed in AS each colleague and tried to reach the other department's doc by every surface.

**Verdict: from a customer's seat, department isolation is WATERTIGHT — he did not get through. ZERO leaks.**

### Isolation result (departments ON)
| Viewer | Finance doc (INV-56357) | Ops doc (INV-13608) | Shared docs |
|---|---|---|---|
| Admin | sees ✓ | sees ✓ | sees ✓ |
| Fiona (Finance) | sees ✓ | HIDDEN ✓ | sees ✓ |
| Olly (Operations) | HIDDEN ✓ | sees ✓ | sees ✓ |

Every HIDDEN cell probed as the wrong user, all PASS: "all documents" list (absent), search by exact reference
(`INV-56357` → "No documents found"), search by filename, search by content word (`Northgate`/`Sandpiper`), Home
"DOCUMENTS FILED" count (3 not 4 — no count leak), recent-activity list, review queue/count, recycle bin (empty
even after the Finance doc was recycled), **open by its known internal ID** (REFUSED "You do not have permission
to view this document"), department-by-id (REFUSED), page image/preview-by-id (REFUSED), export (admin-only,
refused). The block is per-document, not only on lists. Mirror held for Fiona; admin saw all four.

### CRITICAL leaks: NONE.

### Adversarial pokes (behaviour truth-table)
| Poke | Expected | Actual | |
|---|---|---|---|
| Departments OFF again | everything visible | docs STAYED hidden from non-members | ⚠ deviates from copy — SAFE (never more exposed); Card 1 |
| Departments back ON | restored | consistent | ✓ |
| Add Finance to Olly | he sees the Finance doc | on next sign-in he saw all 4 | ✓ (deliberate grant) |
| Recycle the Finance doc | still hidden from Olly | Olly's bin empty; admin's bin shows it | ✓ block follows into the bin |
| No-department doc | visible to everyone | both saw the shared docs | ✓ |

### Usability cards (no leaks)
- **Card 1 (TOP, QUESTION):** turning departments OFF does NOT un-hide already-tagged docs (to un-hide you must
  un-tag or delete the departments). The copy "visible to everyone until you turn this on" reads as if OFF =
  unrestricted. SAFE direction (never over-exposes), but could cause a "my documents vanished!" panic. Fix = make
  OFF lift the restriction, OR change the copy ("turning off stops NEW restrictions; already-assigned docs stay
  restricted until you clear their departments").
- **Card 2 (PREFERENCE):** new docs default to "Everyone" — if you forget to tick a department it silently goes
  shared. Consider a one-line "Visible to: Everyone" note at Confirm & File.
- **Card 3 (PREFERENCE):** the one-time temp-password dialog has no Copy button (the recovery-code screen does).

### What genuinely worked
The plain-English explanation: "Admins always see everything. Documents with no department are visible to
everyone. Departments restrict what Scan Finder shows — they do not change Windows folder permissions." Setup of
two departments + two users took well under his ten-minute patience, no jargon.

### Humility / not tested
One non-technical user on one machine. Proved isolation for the surfaces a signed-in Edit user can drive
(including open-by-ID). Did NOT test: the LAN search-client (a second PC over the network), the mailbox/route-to-a-
person path (no routes existed), the type-default tagging route (tagged per-doc instead), or the raw file-system /
Windows-permission level. A true multi-user network pen-test + a code-level audit are beyond one seat — but every
door he could rattle stayed shut. (The code-level audit ran in parallel: gary + eric → Oracle found by-id
serve/mutate holes reachable only by a crafted request/id-walk, NOT the UI Chris drives; all fixed this session —
see docs/designs/DEPARTMENTS_HARDENING_2026-09-18.md.)

Evidence: sec02–sec07 PNGs in the sandbox (sec05 = Olly's failed search for the Finance ref is the key proof).
