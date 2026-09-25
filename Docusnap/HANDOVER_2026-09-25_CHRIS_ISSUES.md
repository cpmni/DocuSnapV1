# HANDOVER 2026-09-25 — Chris's 2026-09-24 round: what was fixed, what is still open, how to take each one forward

**Source:** `docs/CHRIS_FULL_APP_REVIEW_2026-09-24.md` (his report verbatim + the night triage). **Code state:** branch
`feat/teach-side-overnight`, HEAD `1d839d5`, 11 commits unpushed, run-pins 429/429. **Sandboxes:** the owner's on CDP 9223
(final code, redetect switch persisted ON in its DB, data `…\owner-sandbox-20260924\`); Chris's on CDP 9226 (PRE-fix code,
his data `…\chris-sandbox-20260924\`, 173 in Review / 7 deferred / 20 filed — useful for before/after comparisons; close it
if memory is short). **Rules:** every card below is either FIXED (verify it, don't rebuild it) or OPEN with the smallest
next step named. Extraction/identity/trust items go gary (or herald for type detection) → Oracle before a build; copy/UI
items can be built directly with a pin. Nothing here flips a switch.

## Verify first (10 minutes in the owner's sandbox, CDP 9223)
1. Review → "Not recognised" tab: the intro is one full-width sentence about the SENDER (card 8 layout).
2. Import a handful of docs of a type that is not installed (Chris's `Other\IMPORT` copy has 200 mixed) → Settings →
   Document Types → Add from catalog → within ~10-20 s a toast "Re-read N documents after you added X — the list has been
   refreshed" and the papers move out of Not recognised while you watch (card 1 receipt). If a paper is OPEN, the toast
   also says it was left as it was and Reprocess applies it.
3. Open one of the leftovers whose detected name IS an installed type (`detected_type_name` set, type NULL): the notice
   says the type is set up and offers "Read it as a <Type>" (card 2). Press it: type selected + reprocessed.
4. A skewed scan with an empty reference: the on-open "second look" suggestion never offers a letters-only value (card 4).
5. Settings → Document Types → Add from catalog dialog reads "so it knows what to look for…" (card 7).

## Card-by-card

### 1. The Review window shows the OLD reading while the pile sorts itself — PARTLY FIXED
**Built:** `src/windows/review/renderer.js` `onQuietReprocess` `job_done` branch for `ev.kind === 'redetect'`: immediate
`_refreshQueueFromBroadcast()` (the open document's pane is never touched — the lane skips anything being viewed), a
receipt toast, and an explicit line when the open doc was one the pass left alone (the lane reports `viewing` ids in the
event — `quietLane.js` `_redetectCandidates` → `job.skippedViewing`). Pins `test_quiet_lane.js` (sweep still re-asked,
no `selectDoc`), `test_quiet_lane_redetect.js` §2.
**Open (owner decisions):**
- A DURABLE receipt in the activity strip ("✓ 20 quotes given their type · Just now"). The Oracle skipped the
  `reviewEvents` KINDS extension as non-minimum (`src/lib/reviewEvents.js:38`, closed set). Small: add kind `'recognised'`,
  record at `job_done` with `scope = the type slug(s)`, `ids = done`, `undo: null`; the strip already renders kinds.
- The OPEN document itself: by design never re-read while viewed. Options: (a) keep (the toast points at Reprocess);
  (b) an in-pane one-liner "Re-read while you were here — Refresh" (the Oracle CX idea) — needs the pane to know the doc
  was in a finished job's `viewing` list (it is in the event; store per docId in the renderer).
- `quiet_reread_silent` (ON) still hides the ambient HINT for the redetect; the toast now covers completion. Consider
  showing the hint for `kind === 'redetect'` even in silent mode (it is the direct result of the user's own click).

### 2. "Add 'Statement'" offered after Statement exists (opens the create-a-type form) — FIXED
`renderer.js` `_installedTypeNamed(detName)` + the untyped notice: an installed type → "This looks like a Statement — that
type is set up, but this document was read before it existed" + button "Read it as a Statement" (selects `doctype-select`
by slug, fires `change`, presses the Reprocess button — the same tail the add-then-reprocess road uses); non-admin gets
"Choose 'Statement' above, then press Reprocess". `_addDetectedType` resolves an installed type first. Pin
`test_review_untyped_reason.js`. **Residual:** `detected_type_name` is cleared only by a re-read (mig 51 both-direction
re-derive) — nothing else to do.

### 3. Seven papers left behind, no reason — FIXED (root cause), UX residual
**Root cause (verified in Chris's DB):** all 7 carried the engine's import-time "Found '…' after straightening — confirm
once." on stale flat-catalog date rows; `quietLane._redetectCandidates`' "already asked" exclusion matched the whole
"— confirm once." family. **Fix:** the UNTYPED job applies NO lane-note exclusion (an untyped doc was never asked; a re-type
re-derives every hold via S3-C5 + the reliability first-fill hold); the OVERRIDE (typed) job keeps it (A1 seam). Pins
`test_quiet_lane_redetect.js` §2 (`dNoted` included) and §8 (`qNoted` excluded).
**Residual:** a doc the redetect SKIPS for a real reason (no OCR stamp, empty text, being viewed) shows no per-doc reason;
the toast counts skips. If wanted: the notice could read the last redetect's skipped ids from the audit
(`quiet_reprocess_job` metadata `skipped`) — cheap, read-only.

### 4. "nanann" offered as a credit-note number — FIXED at the door, engine question OPEN
**Fix:** the on-open fast-suggestion road (`processing/handler.js` `reextract-fields-fast` core, `reextract_fast_enabled`
ON since the 205 batch) now drops a suggestion for the type's REF ROLE with no digit (the `ref_role_digit_gate` twin) and
any suggestion with no letter/digit. Display-only road; nothing stored.
**Open (gary, read-only first):** why did the imageless KEYWORD read accept "nanann" for `credit_note_number` in the first
place? `ref_role_digit_gate` (ON) guards cold commits through `_gate_value` — check whether a keyword capture on the
`--reextract` road reaches that gate, and whether the same value could have been COMMITTED (not just suggested) by a
Quick reprocess. Evidence: Chris's DB, doc 83 (`Meadowvale-Dairy_credit_note_0029.pdf`) `ocr_text` around "Credit Ref";
the pre-override rows are gone (the override job re-read them to `MVC-8136`), so reproduce with `--reextract` on that
text with the Credit Note type installed and NO override. If the engine can commit a digit-less ref on Quick, that is a
gate gap → gary design → Oracle (it is a trust-layer change).

### 5. One sender split three ways ("Meadowvale" / "Dairy Wholesale" / "Meadowyale") — OPEN
Identity layer; not touched tonight. **Verify first:** confirm the "Meadowyale" doc in Chris's sandbox — the issuer
near-match hold from Chris round 6 ("Keep what I typed" past the near-match; `learning.findNearMatchIdentity`,
`teach_identity_near_match_keep`) may already stop the misfile AT CONFIRM. If it does, the gap is the Review GROUPING
(three group headers) — a display nudge on the odd groups: "reads 'Meadowyale…' — one letter off from 'Meadowvale…' (18
documents). Same sender?" with a one-click fix that pins the dominant name on that doc (the existing `apply-issuer-ripple`
/ `supplier_pin` machinery, operator-initiated, not automatic). Related DARK switch: `name_dominant_snap` (≤1-edit
legal-suffix slip, 2026-08-25, never flipped). Path: gary (which arm should own it) → Oracle. Blast radius: identity —
never an automatic merge.

### 6. Two promises on the leftover paper — FIXED (copy)
"Press Reprocess … if it reads clean it will be offered in File All Ready." (a single Reprocess never self-files; only the
Reprocess-all consent road does) and "the 90% level for filing without a check (Settings → Processing)" on the branch that
still said "you've set" (`renderer.js` ~3657/3679).

### 7. Jargon — FIXED (copy)
`shared/doctype-catalog.js` "so it knows what to look for before you teach anything" (client copy synced via
`scripts/sync-client-teach.js`); `renderer.js` "however the automatic-filing level is set" ×2.

### 8. "Not recognised" doesn't mean what I thought — layout FIXED, semantics OPEN
**Built:** the tab intro wraps full-width and says "The sender of these documents couldn't be identified…".
**Open (owner decision):** rename the tab ("Not recognised — sender unknown") and/or add a small "no type yet" pill on
kind-less rows in the main Review list (`shared/notRecognised.js` is the membership predicate — sender AND type AND no
suggestion; typed-but-sender-less and sender-but-untyped both fall outside it by design, 2026-09-21).

### One-liners (logged)
- **"Set aside all" with no prompt** (7 → Deferred instantly; reversible per row): add either a confirm ("Set aside N
  documents? They move to Deferred; open one there to bring it back.") or an undo toast — UI-only, pin `test_not_recognised`.
- **Two Ironclad statements typed "Invoice"** (held for a missing sender, so safe): a type-detection question — herald
  (title band render + per-type score matrix on those two vs a correctly typed sibling). Docs in Chris's sandbox: the two
  Ironclad rows with `document_type_id = invoice`.
- **Natural-language search** ("Harrowgate March 2026" finds nothing): the date filter is a separate control; a parse of
  month/year tokens into the date range is a search-service feature (design; not a bug).

## Decisions queued for the owner (unchanged from the night handover)
Push the branch · flip mig 216 for everyone or keep it DARK (Chris's round = the efficacy evidence: 91/98 sorted, 19/20
fixed, nothing filed by the passes) · card-5 design go/no-go · the sandbox `output_folder` still points at the real
`Documents\Scan Finder`.
