# PLAN — the type-split arc, then the Review activity strip (2026-08-22 night)

Two owner asks, both advisor-designed (gary / barry / eric) and Oracle-vetted the same evening. Build
order is the owner's: **type-split arc first, activity strip after.** Every slice is its own switch,
default OFF, OFF byte-identical, unless the Oracle ruled it a plain bug fix.

---

## PART A — the type-split arc ("must I confirm all 20?")

### The incident (live DB, traced)
Nordwind Refrigeration Ltd: 24 quotes confirmed, 17 HELD at oc 100 with every value right and the Fix A
note ("This letterhead is used for several document types and the type could not be confirmed…").
Causes, stacked:
1. **One mis-confirm planted a rival type.** Doc 135 (a quote, NRQ-2551) was confirmed as a Purchase
   Order → template 12 `'1 Refrigeration Ltd' / purchase_order` born on Nordwind's logo. `_type_ambiguity`
   counts a 1-confirm slug as equal to a 24-confirm slug.
2. **The birth NAMED the template from the machine's pre-confirm read** — `review/handler.js:1400-1405`
   takes the `supplier_name` param (= `currentDoc.supplier_name`) BEFORE `allValues.supplier_name` (the
   confirmed value); the inverse of `reviewService.js:426`. Same class at `reviewService.js:518,570`.
3. **The bold "QUOTATION" banner is absent from `ocr_text`** on 16/17 pages → `title_trusted` False.
4. **"QUOTATION" has no alias** (Quote `title_aliases` NULL; `keyword.py:935-944` would detect "QUOTE").
5. B1 already pins template 10 via the NRQ dominant prefix — and C2 then FORCES the hold (the
   "corroboration in the trace" the owner saw is real but ruled suggest-only).

Direct answers: No — confirming quotes never clears it (each confirm feeds template 10; template 12
stays). With S2-py, zero further confirms. The trace corroboration is the B1 signal; it becomes
load-bearing only paired with "the rival type has <2 confirms".

### Zero-code remedy (owner, today) — ORDER MATTERS (Oracle)
1. **Delete template 12 FIRST** (Admin Template Viewer; `templates.remove` nulls `documents.template_id`).
2. Then send doc 135 back and retype it **Quote** (it relinks to template 10).
3. Then **"Reprocess 17 from Nordwind"** → the 17 file as Quote.
(Retyping first does NOT detach the PO link — Part D only runs on the taught path.) This is also the
root-cause proof.

### Slices (Oracle order)
| # | Slice | Switch | Verdict / conditions |
|---|---|---|---|
| A1 | **S2-js-c name precedence** — `_upsertTemplate` names from `allValues.supplier_name` first, param second; same at `reviewService.js:518,570` | none (bug) | SIGN OFF. Pin: param 'garble' + allValues 'Real Name' ⇒ template named 'Real Name'. Blast radius low + positive (seed prune protects the right tokens; same-type-scoped reuse can't fold a PO into the quote template). |
| A2 | **S2-py unsupported-rival waiver** — Fix A's hold is WAIVED when every rival slug in the cohort band is carried only by templates with <2 confirmed docs (any via) AND the doc's OWN ref (located method: mapping/anchor/label keyword, never hint/memory) carries the pick's dominant prefix | `type_ambiguity_unsupported_waiver` / `TYPE_AMBIG_UNSUPPORTED_WAIVER` | SIGN OFF W/COND. S2-py-1 compute `unsupported_rival_slugs` over the FULL band per slug (max count per slug), both arms, never on the Lever-3 return; ABSTAIN unless the payload marks counts live (`counts_live` from `getAll`; `TEMPLATE_LIVE_COUNTS=0` under-counts). S2-py-2 decide LATE at `engine.py:9669` (`if _type_ambiguous and GUARD and not _type_waiver_ok(...)`), `_type_ambiguous` itself untouched (B' label-ownership at :7323 depends on it); waiver requires `waived_for == matched_tmpl.id` AFTER the B1 pin (:6849) AND the own-ref leg; empty/garbled own ref ⇒ hold. S2-py-3 negative control (rival count 2 → note planted) + trade-off pin worded "delays Fix A from the 1st to the 2nd rival confirm" (before the rival's first confirm the doc auto-filed silently anyway — the waiver does not widen the class). |
| A3 | **S2-js-a type-split ask** — a confirm whose type ≠ the issuer's 100%-one-type history (≥3 confirmed docs) asks inline: "Nordwind files as Quote (24 so far). File this one as a Purchase Order?" | `type_split_confirm_gate` (default ON, fail-open) | SIGN OFF W/COND. A-1 pure predicate IPC `check-type-split` (new `database/modules/typeSplit.js`) called by the TEACH WIZARD before promote (it promotes BEFORE confirm-review — a gate fail at confirm would leave a half-born template) and by Review's Confirm; the reviewService gate stays as the pre-claim backstop. Skip machine vias; do NOT exempt re-file. A-2 reuse the `ISSUER_NEAR_MATCH` fail/ack payload shape so the /v1 client degrades to a message. |
| A4 | **S3 Quote detection** — seed `title_aliases` at `addPresetTypes` (Quote → Quotation, Estimate; Remittance Advice → Remittance; Service Worksheet → Worksheet, Job Sheet; Statement → Statement of Account); migration fills ONLY where NULL and the name matches a preset | migration | SIGN OFF W/COND. Aliases ALSO score as position-weighted mentions (:982-1004), so "Quotation Ref NRQ-…" steadies `detected_slug` untrusted — state it. Pin `title_trusted == False` for "Quotation Ref NRQ-2551"; `realdoc_regression RR_APP_ENV=1` aliases ON vs OFF M=0. |
| A5 | **S4 heading-absent census** — `TESTING/_measure/heading_absent_census.py`: per DB, is the type name/alias a standalone line in ocr_text; for absent cases render page 1, crop the top 35 %, Tesseract PSM 11 + 6 on grey + each channel + an INVERTED-crop arm (white-on-black banners are dropped as graphics by PSM 3); absent rate by type × supplier × born-digital/scan, recovery share, per-word conf | measurement | SIGN OFF. No fix design. |
| A6 | **S1 confirm-once ripple** — after a confirm, held siblings on the same template + same type carrying the exact Fix A note are enqueued on the quiet lane (own reason, Q3 guards) after a JS pre-check that the rival is unsupported (else audit-skip); never writes values; the re-read under A2 drops the note + penalty at extraction (the `_d4` lesson — a stored-row shed is re-planted on the next read) | `type_ambiguity_ripple` | SIGN OFF W/COND, BUILD LAST. Rides `quiet_reread_enabled` (mig 79, OFF on the owner's install) — a no-op until that flips. |

**Gate:** `realdoc_regression.js RR_APP_ENV=1` A2 ON vs OFF M=0 + zero per-field drop; mature-sandbox
type census (Fix-A holds before/after, ZERO type flips on confirmed GT); Chris on the owner's sanitized DB:
delete 12 → retype 135 → Reprocess 17 ⇒ 17 file as Quote; then A2 ON with template 12 restored ⇒ the same
17 file; a synthetic PO-with-NRQ-mention fixture whose own ref reads stays HELD.

Pins: `tests/test_type_ambiguity_unsupported.py` (+ negative control + trade-off pin),
`src/modules/review/test_upsert_issuer_precedence.js`, `database/modules/test_type_split_gate.js`,
`src/services/test_type_ambiguity_ripple.js`, `tests/test_quote_alias_precision.py`.

---

## PART B — the Review activity strip ("what just happened?")

### Root cause (eric, verified)
The top-left tile renders ONE rolling setting `recent_auto_filed {ids, approved, at}` whose `at` is
overwritten on every write (`processing/handler.js:5331-5345`) — it can only re-total, and its 7-day expiry
never arrives while filing continues. Three per-doc doors feed it (:5262 import, :3557 auto-accept, :4109
reprocess-accept) — plus a FOURTH, the human `sweep-scope-accept` (:3386), that never records at all.
Two latent defects: "Put back" on 125 docs silently undoes 25 (`sweep-scope-undo` `.slice(0,25)`, :3728;
an auto-accept trigger runs up to 8 passes = 200 ids in one event); the import door rewrites the 300-id JSON
per document mid-batch. The sweep receipt (the one with Put back) self-destructs after 20 s.

### The model (barry; Oracle-ratified)
- **RECEIPT** (something happened: what · which docs · why · when · See them · Put back) — retires on AGE,
  never on click. **OFFER** (needs an answer) — stays where it is today (queue header, `offerPrune`
  lifecycle); NEVER in the strip (a click-anywhere dismissal would answer "Not now" silently — the C11
  class). Only offers' RECEIPTS move to the strip, emitted by the SERVER on the accept path (once per
  `_sweepAcceptCore` call, `approved = !auto`), so one receipt appears whether filing came from a click,
  the 1.5 s auto-accept, or another window.
- Kinds: `auto_filed` (import 100 %), `self_filed` (scope auto-accept), `approved` (File N), `class_fix`,
  `put_back` (an undo is itself a receipt). `reread` dropped for now (no undo, `#quiet-reread-hint` exists).
- Copy (C9): 100 %-import = "filed automatically (matched 100 %)"; "filed themselves after your confirms"
  reserved for `self_filed`. Never scope/sweep/lane/reprocess/template. Relative time from the EVENT stamp:
  "Just now" <60 s, "N min ago", "N hr ago", "Yesterday 14:10".
- Events carry `dropped[{docId, reason}]` (C6) — the expanded row shows "kept back — reason" exactly as the
  done-phase bar does today (:6005), the only place the customer learns why 3 of 20 didn't file.

### The shape (owner's clarification 2026-08-22 ~21:00 + Oracle C2)
A **chip strip** above `#doc-toolbar`, fixed 28 px always in flow (no preview jump): short chips, newest
on the LEFT, horizontally scrollable (‹ › when overflowing), **≤10 chips on the strip** (the ledger keeps
50). Chip = `✓ Just now · 23 filed themselves ▾`. Click → expands (overlay panel, `z-index` above the ack
button, `[data-help-ignore]`) into the full sentence + See them / Put back (+ kept-back rows). **Click
anywhere closes the PANEL only; the chip stays and can be reopened while in view.** A chip leaves the strip
on age (15 min) or when 10 newer arrive; while ANY event with live undo remains the band shows a quiet
"Recent activity ▾", never blank. `seen` never touches undo. Owner's 3–4 prose columns: DO NOTHING (chips
supersede them).

### Plumbing (eric; Oracle conditions)
- `src/lib/reviewEvents.js` — main-process ring ledger ≤50 `{id, kind, at, started_at, ids[], bySender[],
  scope, approved, undo:{type:'sweep'|'classfix', batchId?}, dropped[], seen}`; **C1 merge-in-place, not a
  trailing flush**: create on the first doc, MERGE subsequent docs while `now − at < 60 s` (share
  `_AUTOFILE_BURST_GAP_MS` with `main/renderer.js:968`), broadcast throttled ≤1/s; `auto_filed` keyed by kind
  with a `bySender[]` breakdown (a 200-doc/8-sender import = ONE chip "175 filed automatically · Nordwind
  12 …"); `self_filed`/`approved` keyed kind+scope, once per accept call. Persisted as ONE setting
  `review_events` — **C3 added to `protectedSettings._KEYS`** (blocks backup export + the generic
  `set-setting` door; a restored ring would resolve FOREIGN doc ids). Best-effort try/catch AFTER the filing
  succeeded (the `_recordAutoFiled` idiom) — never inside the filing path, never the source of undo validity.
- IPC/preload: `getReviewEvents`, `onReviewEvent`, `markReviewEventsSeen(uptoId)`, `getReviewEventDocs
  (eventId)` (server resolves ids from ITS ledger via `documents.getByIds`), `undoReviewEvent(eventId)` —
  the renderer never sends an id list (C5 ruling). **C7** undo server-side, chunked in 25s with a
  `setImmediate` yield, `{undone, refused}` honest; >25 ids → a confirm dialog naming the number; undo offered
  only for events ≤7 days and kinds `self_filed` / `approved` (sweep) / `class_fix`; re-checked at click
  (dead undo degrades to "See them").
- Renderer: **C2** `onReviewEvent` → `renderActivityStrip()` ONLY (the doors already broadcast
  `review-count-changed` / `scope-auto-filed`; a second trigger doubles the reload + prune). **C5**
  click-outside capture listener never calls `stopPropagation`/`preventDefault`; Esc consumed only while a
  panel is open. **C8** one CSS var `--doc-head-h` consumed by the four absolute children that assume the
  toolbar is first (`#btn-acknowledge` :258, `#ack-hint` :272, `#wizard-panel` :361, `.anchor-readout` :387).
  30 s re-label tick, cleared on beforeunload. "See them" reuses `_viewingAutoFiled`, keyed off the EVENT's ids.

### Slices
| # | Slice | Switch | Verdict |
|---|---|---|---|
| B1 | Ledger + merge-in-place + IPC + the FOUR doors (incl. human sweep accept) | `review_activity_strip` (OFF; ledger records regardless, cheap) | SIGN OFF W/COND — can land NOW, dark (touches only the processing doors + a new lib). |
| B2 | The chip strip renders; sweep done-phase (20 s timer goes) + class-fix applied become server-emitted receipts | same | SIGN OFF W/COND — AFTER Part A (shares `_refreshQueueFromBroadcast` :7812 and the queue header bars with A3/A6); rebase, re-run the source pins. |
| B3 | Retire `#auto-committed-bar`, `recent_auto_filed` writes, `get/clear-recent-auto-filed`, AND `sweep-scope-undo(docIds)` + `renderer.js:582-595` (C4 — else the C5-safe door is decoration) | — | SEND BACK until this trace list is closed: `review/handler.js:393-413`, `preload.js:202,205`, `processing/handler.js:5318-5346` + the dead `count:` at :3569/:5265 (keep `doc-auto-filed` — `main/renderer.js:1191` "the ONLY place allowed to claim a document is filed"), `renderer.js:525-619` (+ :485, :5719, :7812, :7832), pins `test_scope_auto_accept.js:127` (rewrite to the ledger door, positive control), `test_reprocess_autocommit.js`, `test_review_initial_selection.js:89`, `test_queue_badge_copy.js:33`, `TESTING/_measure/fresh_vs_live.js`, `pendingfeatures.md` / `architecture-notes.md`. |

**Gate:** unit — ring cap; positive control per door incl. the human sweep accept; 200 docs × 8 senders
spaced 4 s → ONE `auto_filed` event with 8 sender rows (must FAIL against a 2 s trailing-flush design);
merge respects the 60 s gap; `review_events` refused by `set-setting` and absent from a backup export; undo
over 30 ids → 2 chunks, refused honest; 8-day-old event → `undo:null`; source pins (offers not in the
strip, `[data-help-ignore]`, no `stopPropagation`, four `--doc-head-h` consumers). Whole JS suite zero new
reds; flag OFF = byte-identical `settings` (minus `review_events`) on a 20-doc import. Chris round: 200-doc
import → ONE chip; "47 min ago" after lunch; click the page → chip stays, panel closes; Put back on a 40-doc
self-filed event → "Put 40 back?" → all 40 return with pages; restore a backup on the sandbox → strip empty.

Pins: `src/lib/test_review_events.js`, `src/modules/processing/test_review_events_doors.js`,
`src/windows/review/test_activity_strip.js`.

---

## Build order (the owner's)
A1 → owner remedy (delete 12 → retype 135 → Reprocess 17) → A2 (dark → gates → mig ON new installs + owner
flip) → A3 (ON, fail-open) → A4 (migration, corpus-gated) → A5 (measure) → A6 (dark, last) → **B1** (can
slot in any time, dark) → B2 → B3 (after its trace list). Chris rounds: one after A3, one after B2.
Also owed from earlier tonight: a Chris round with the three garbled-issuer switches ON (`c5a4050`).

---

## STATUS — built 2026-08-22 night (all DARK unless stated; every switch has a dev-gated Settings toggle)
| # | Commit | State |
|---|---|---|
| A1 name precedence | `40f47e3` | SHIPPED (bug fix, no switch) |
| A2 unsupported-rival waiver | `e2fa804` | DARK `type_ambiguity_unsupported_waiver`. Decided ENTIRELY in the engine (process_docs' B1 block is skipped on a reprocess of a typed doc — the "Reprocess N" path). Gates: realdoc OFF vs ON M=0, M_type=0, per-field identical, would-auto-file 389→410; live-copy fired path doc 323 held→waived; negative control held. |
| A3 type-split ask | `c67f8e1` | ON by default (`type_split_confirm_gate`, fail-open). Wizard asks BEFORE promote; Review inline hold. |
| A4 catalog aliases | `a4cbd84` | SHIPPED via migration 85 (fills only alias-less types). With A4 alone, doc 323 resolved clean on the live copy (the existing `heading_absent_reread` arm finally has "Quotation" in its vocabulary). |
| A5 heading-absent census | `7fdfa80` | MEASURED on the owner's DB (416 typed confirmed docs): banner VERBATIM 157 · GAP-SPLIT 154 (a ≥4-space column gap inside a two-word banner; detection handles it, type 100 %) · DROPPED 105 (Pelican 40/40, Nordwind 23/24, Silverbeck 37/40 — degraded-scan variants). A blind top-35 % grey band OCR (PSM 11) recovers the dropped banner 18/18 at conf 96; grey = every channel = inverted, so colour/inversion is NOT the mechanism. The existing `HEADING_BAND_REREAD` (geometry-prominence pre-gate) never fires because the dropped word leaves no banner-height geometry. Fix direction = its own Oracle arc. |
| A6 confirm-once ripple | `7fdfa80` | DARK `type_ambiguity_ripple` (rides `quiet_reread_enabled`). |
| B1 ledger + doors + IPC | `3676415` | DARK (records regardless; nothing renders). `review_events` is a protected setting. |
| B2 chip strip | `44b6661` | DARK `review_activity_strip`. |
| B3 retire the tiles | — | NOT STARTED (Oracle SEND BACK until the trace list above is closed). |

**Pre-existing reds recorded:** `test_teach_multipage.js` (a comment at teach/renderer.js:28 matches its own "discard" regex — red before A3); `test_offer_prune.js` was red on any `core.autocrlf` checkout (CRLF) — FIXED in `44b6661`. Python: the documented `test_identity_fusion` + 6 script-style reds, zero new.

**Owner steps tonight:** (1) the Nordwind remedy in the order above (delete template 12 → retype doc 135 as Quote → Reprocess 17) — OR simply restart the app: migration 85 seeds the Quote aliases and the 17 resolve on Reprocess; (2) to see A2/A6/B2 on the live install: Settings → Processing (SFDEV) → tick the toggles → restart.
