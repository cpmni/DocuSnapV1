# Chris The Customer — full app review — 2026-08-26

## Round (2026-08-26): Cards 1 & 4 DARK-switch verification (sandbox)

**Conditions:** isolated sandbox on CDP 9223 (PID 20704), fresh install (create-first-admin), newest
working-tree code. Armed: `position_teach_nudge=true` (Card 1), `issuer_suggest_on_blank_confirm=true`
(Card 4), plus `issuer_sibling_fill`, `letterhead_prefill`, `review_activity_strip`, `batch_audit_enabled`,
`auto_file_threshold=90`. Focused 54-doc corpus: Pelican-Office (18, table-layout → Card 1),
Castellan-Security (12) / Oakhaven-Electrical (8) / Ironclad-Tool-Hire (8) (blank-issuer → Card 4),
SINGLE (8 teach docs). Login `chris`/`plumber2026`. Leak check CLEAN (0 writes to the owner's real folder
after noon; all filing in the sandbox Output).

**Headline:** **Card 1 WORKS** (all four checks pass). **Card 4 was BROKEN as wired** — the offer read the
empty queue stub (`currentDoc.extractions`) instead of the full rendered doc, so it never fired on the real
flow; the modal + adopt + learn chain are sound when forced open. **FIXED same session** (renderer.js reads
`_lastRenderedDoc`, id-matched; pin added). A second, separate gap remains: the engine emits no
`issuer_suggested` for these clearly-branded senders (a detection arc, owner-vet).

---

### Chris's report (VERBATIM — transcribed from the completion notification; the live transcript comes back empty per the standing trap)

**Sandbox login I created:** `chris` / `plumber2026` · admin recovery code `YD9E-4ZE8-F5AA-WFWA`
**Armed & confirmed on the running app:** `position_teach_nudge=true` (Card 1), `issuer_suggest_on_blank_confirm=true` (Card 4), plus `issuer_sibling_fill`, `letterhead_prefill`, `review_activity_strip`, `batch_audit_enabled`; `auto_file_threshold=90`.
**Method note:** I'm one made-up office manager, not a room of testers. I drove the real sandbox app over CDP and photographed the meaningful steps. Native OS pickers (folder Browse) can't be clicked by my helper, so I set the output folder the way the Settings screen would; everything else is exactly what a customer clicks.

#### TL;DR (3 lines)
1. **Card 1 (draw-a-box nudge) WORKS** — fires once per sender, clear and non-blaming, never nags the Issuer, and correctly goes silent once you've drawn a box.
2. **Card 4 (blank-issuer steer) is BROKEN as wired** — the nice 3-button modal can't fire on the normal review flow, so a customer with a blank-issuer doc still gets the old bare "Unknown Company?" dialog. The modal itself and its three buttons are sound when I force it open.
3. Everything destructive told the truth (Delete / Empty Bin verified — original scans really survive), search finds filed docs instantly, and the draft Terms still say "NOT YET IN FORCE."

#### VERDICT — Card 1 (draw-a-box nudge): WORKS
Imported Pelican-Office (18 invoices). Fields sit in a table, so Reference + Date read blank (Issuer read fine as "Pelican Office Interiors"). I TYPED `PI/26/1755` + `24-06-2026` and pressed Confirm & File. The nudge fired, exact text (level `info`):

> "**Filed. Typing fixed these on this document only — future documents from Pelican Office Interiors will read Invoice Date and Invoice Number blank too. If they sit in the same place each time, draw a box (⊕) around one to teach Scan Finder where, and it reads them automatically.**"

All four checks pass:
- **Fires once, clear, non-blaming** — names the sender, states the consequence, gives the action + payoff. No blame.
- **Once per sender** — a second typed Pelican doc showed only the plain "Filed as …" message; the seen-marker read `{"pelican office interiors|invoice":1}`.
- **Drawing a box suppresses it** — clean A/B at the service boundary: a confirm with no `taught_fields` returned the nudge; an identical confirm carrying `taught_fields:['invoice_date','invoice_number']` returned `positionHint: null`. Only the taught-fields flag differed.
- **Never nags the Document Issuer** — the first nudge named only Invoice Date + Invoice Number, even though the Issuer was letterhead-prefilled (identity is excluded).

**Does it help a non-technical user?** Yes — it's the first time the app explains *why the next 40 came in blank*, and the tour already taught "draw a box… you teach it once", so the nudge reinforces a known idea.

#### VERDICT — Card 4 (blank-issuer steer): BROKEN (as wired) — the modal never reaches a real customer
Imported Castellan (12), Oakhaven (8), Ironclad (8). Could not trigger the 3-button modal on the normal flow, traced to a data-wiring gap, verified three ways:
- **Live queue-row shape:** review rows carry the scalar `issuer_suggested` (+ `issuer_blank`) but **no `extractions` array** (`hasExtractions:false`).
- **Code path:** on the standard open-from-queue → Confirm flow, `currentDoc` **is** the queue row (never reassigned to the full record). The Card 4 offer reads `currentDoc.extractions.find(...).suggested_supplier` — always empty — instead of the `issuer_suggested` scalar that is actually delivered.
- **Instrumentation:** during a real confirm, `issuerOfferForBlank` was called with `suggestedSupplier: undefined, note: undefined` → `{offer:false}` → fell through to the plain native "Unknown Company… File it anyway?" dialog.

**The modal itself is sound** (forced the offer to fire to test downstream):
- Renders correctly: "This document has no Document Issuer / The page looks like it's from **Ironclad Tool Hire**…" Buttons: `Go back` · `File as Unknown Company` · `File under "Ironclad Tool Hire"`.
- **"File under X"** → filed to `Ironclad-Tool-Hire\2026\June\Invoice.14-06-2026.ICT-5580.pdf`, and it **learned the sender** (reprocessing another Ironclad doc then read the issuer as "Ironclad Tool Hire", held with the safe "Matched by logo only…" note).
- **"File as Unknown Company"** → `Unknown-Company / 2026 / June`. **"Go back"** → filed nothing.
- **Plain path unchanged** — a no-suggestion doc shows the plain native Unknown dialog, no modal.
- **Nothing auto-fills silently** — adopt requires the explicit button click.

**Bottom line:** the modal + adopt + learning chain all work; the fix is small (read the suggestion from the full doc / `issuer_suggested`) — plus the separate detection gap of the engine not emitting a suggestion for these senders.

#### Warnings truth-table
| Button | Warned | Actually | Truthful? |
|---|---|---|---|
| Delete (single, from Review) | "goes to the app's recycle bin — you can restore it from Search." | review 39→38, bin 0→1, restorable | ✅ |
| Empty bin | "Permanently delete… **Your original scans in the Processed folder are not touched.**" | bin→0; **verified all 46 Processed originals still on disk** | ✅ |
| Reprocess (single) | (no warning — non-destructive) | re-read, updated issuer via learned logo | ✅ |
| File All Ready | "Nothing is ready to file yet…" | filed nothing; queue unchanged | ✅ |
| Confirm & File, blank issuer (no suggestion) | "…filed under 'Unknown Company'… File it anyway?" | filed to `Unknown-Company` | ✅ |

#### NEW finding cards (ranked by harm)
1. **Card 4 blank-issuer steer never fires on the normal flow — HIGH.** The offer reads `currentDoc.extractions` (queue rows carry none; the suggestion is the `issuer_suggested` scalar the offer ignores). The armed feature is inert. *(→ FIXED this session — renderer reads `_lastRenderedDoc`.)*
2. **Draft Terms still say "NOT YET IN FORCE" + "[SOLICITOR:]" — HIGH (trust), recurring.** Legal domain.
3. **Engine emits no sender suggestion for clearly-branded senders — MOD.** Ironclad hexagon-logo statements group under "Sender not identified"; every blank-issuer row had `issuer_suggested` empty. Compounds Card 4 (nothing to steer with). Detection arc — census + Oracle.
4. **Card 1 nudge is a 4-second toast for a two-line instruction, with no click-to-teach — LOW-MOD.** Consider a dismissable bar (like the class-fix bar) with a "Show me where to draw" action, or longer dwell.
5. **Wizard defaults the output folder to `Documents\Scan Finder` — LOW (note).** Fine for a real customer; only a concern in a test harness. PREFERENCE.

#### What genuinely worked
The honesty of the destructive warnings — Empty Bin's "your original scans… are not touched" is **verifiably true** (all 46 originals survived a bin-empty). And **Card 1 does exactly what it promises**: one clear, once-per-sender, non-blaming nudge that finally explains why a table-layout supplier keeps coming in blank, and it correctly steps aside the moment you draw a box.

#### Top friction
Card 4 — the feature the owner armed to reduce Unknown-Company scatter can't reach a customer (offer reads the wrong place). *(→ fixed.)*

#### Two-week verdict
**Yes — I'd keep it and pay.** Batch filing is genuinely eased, nothing misfiled across 46 docs and two sender-teaches, every scary button told the truth. Want the draft Terms finished and the blank-issuer steer actually wired up.

#### Humility / what I couldn't test
Single simulated persona, one pass — not a user study. Proved Card 1's draw-suppression and Card 4's wiring at the service/DOM boundary because the driver can't perform a pixel-accurate ⊕ canvas draw or click native OS pickers (a known round-5 limit), so no real freehand teach — teaching exercised via typed corrections + the Card 4 adopt (which learned the sender by logo). For Card 4, forced the offer open to confirm the modal/adopt/learn chain, and inferred "never fires" from code + live queue shape + instrumentation (the corpus produced no genuine `issuer_suggested` doc). Nothing implemented; every finding queued for the owner's vet. Leak check clean.

---

### Main-session follow-up (2026-08-26, post-round)
- **Card 4 wiring bug FIXED** (`renderer.js`): the confirm-door offer now reads the suggestion + note from
  `_lastRenderedDoc` (the full doc `renderFields` drew), id-matched to the doc being confirmed, instead of the
  empty `currentDoc` queue stub. Preserves the branding-provenance seam (the note is on the full doc; the
  `issuer_suggested` scalar has none). Pin added to `test_issuer_blank_offer.js` ("reads the FULL rendered
  doc, not the empty queue stub"); all issuer-blank-offer pins green.
- **Card 4 RE-VERIFIED END-TO-END on the running sandbox (2026-08-26).** The corpus emits no natural branding
  suggestion (finding 3), so a genuine branding-conflict shape (blank issuer + `suggested_supplier` + a "page
  branding reads 'X'" note — exactly what `_flag_branding_conflict` writes) was INJECTED onto a real held
  Pelican doc, then the REAL confirm flow was driven over CDP. After a Review-window reload (to clear polluted
  in-memory state), Confirm & File raised a FRESH 3-button modal carrying the injected name — `Go back` ·
  `File as Unknown Company` · `File under "Pelican Office Interiors"` — and "File under" filed the doc under
  that name (`status:confirmed, supplier_name:"Pelican Office Interiors"`) and LEARNED the sender (hints=9,
  logo=1, corrections=11). The wiring fix is proven: real confirm → full-doc suggestion+note → predicate →
  modal → adopt+learn. (Trap for next time: leftover modal overlays [z 99999] block queue-row clicks and leave
  `_lastRenderedDoc` stale — `page.reload()` the Review window between drives.) The DETECTION half — the engine
  emitting the suggestion for real branded senders — remains finding 3 (owner-vet arc).
- **Card 1 confirmed WORKING** by the round — no code change.
- **Owner-vet queue (unbuilt):** finding 2 (Terms, legal) · finding 3 (engine emits no suggestion for branded
  senders — a detection arc, census+Oracle, same class as `name_dominant_snap`/`branding_strip`) · finding 4
  (Card 1 nudge as a dismissable bar + click-to-teach) · finding 5 (wizard output-folder default note).
- Both DARK switches **stay DARK** pending: Card 4 an end-to-end re-verify on a suggestion-carrying doc; a
  Chris round on the copy for Card 1's live copy/UX. Nothing flipped, nothing committed.
