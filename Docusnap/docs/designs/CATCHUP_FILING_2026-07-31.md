# Catch-up Filing ("file the rest") — AGREED DESIGN, 2026-07-31

**Status: DESIGN SIGNED OFF (barry → gary → Oracle SIGN-OFF-W/COND). NOT BUILT.**
Owner idea: 20 same-supplier docs queued; operator confirms 10; the other 10 hold correct
values on STALE scores (extracted before those confirms taught/graduated the scope). Today the
cure is Reprocess All + waiting. Wanted: re-evaluate against the now-warmer learning and — with
explicit consent — batch-file. Constraint: never bypass trust; the customer must consent and
understand ("Ready to file X documents from SUPPLIER — proceed?").

## The mechanism in one line
Not "skip the checks" — **re-ask the normal auto-file trust gate on fresher data, and file only
what NOW passes with values UNCHANGED from what the operator can see**, behind a per-scope
consent list. Copy anchor everywhere: *"checked against the documents you just confirmed"* —
never "AI".

## Green-light predicate (gary, Oracle-amended)
Two tiers, both consent-gated; evaluation is READ-ONLY (nothing persisted until accept):
- **Tier 1 (free):** `trust.isAutoFileEligible(db, storedDoc)` passes NOW on stored rows —
  scopeTrust is live, so "stored 96, floor just graduated to 95" qualifies with zero machinery.
- **Tier 2 (re-scored):** fast imageless re-extract (`_reextractFastCore` refactor of
  reextract-fields-fast; buildTrainingArgs hoisted once per sweep), then ALL of:
  - role fields (supplier + type's ref/date keys): fresh NON-EMPTY and normalise-equal
    (text_normalise) to the stored display value — fresh-empty on a role field = FAIL;
  - non-role fields: no contradiction (both non-empty → must match; fresh-empty passes —
    imageless anchor self-skip is structural). **Stored-empty + fresh-VALUE = HELD, not filed**
    (Oracle: the warm system just read a value the file would permanently miss — reason chip
    "found a new value on re-check", the pill flow takes over);
  - both sides note-free AND corrected_to-free (the overlay must carry corrected_to — trust's
    flagged check treats it as a flag);
  - `isAutoFileEligible` re-asked on a synthetic doc: fresh overall conf, stored rows overlaid
    with fresh conf/notes (fresh-empty non-role keeps STORED conf — stale-weak anchor fields
    still trip the 88 critical floor), fresh templateMatched. The trust.js opts seam
    (:395-408/:567-613) gets a SUPPORT PIN (currently harness-only consumer);
  - type slug unchanged (--known-doc-slug pinned; assert);
  - state: needs_review, no workflow lock, presence viewers empty, not mid-bulk, not the doc
    OPEN in the preview, no unsaved edits.
- **MISMATCH RULE (pinned trade-off):** a BETTER fresh value (un-clipped code, shed note) FAILS
  the match — the displayed value is stale/wrong and must not batch-file; stays in review.
- **Framing rule (Oracle):** Tier 2 re-parses the SAME stored ocr_text — it is a "warmer
  learning didn't change the answer + the gates pass now" CONSISTENCY check, never to be
  described (in copy or comments) as corroboration or a re-read of the page.

## Trigger + orchestration (gary)
Renderer hook after each successful non-bulk confirm (+ once after File-All ends) →
debounced ~2.5s per scope key (normalised supplier, type slug — trust._scopeKey parity) →
ONE IPC `sweep-scope-candidates` (cap ~25, Tier 1 then Tier 2 serial, abort if a batch starts).
/v1 client confirms don't trigger in v1 (documented gap). Kill: setting `scope_sweep_enabled`
default OFF + env; OFF = zero surfaces, IPC returns disabled.

## Consent UI (barry, Oracle-ruled v1)
**V1 = the banner+list consent (barry's silent File-All-Ready absorption REJECTED — it loses
the per-doc untick and the owner's consent shape).** Ambient green pill on qualifying rows
("Ready — matches your confirmations"); ONE non-modal banner (auto-committed-bar family) at
count ≥2: "6 more Copperfield Electrical documents match what you've confirmed and pass the
same checks — **File 6 · Review them · Not now**"; expandable list with **per-doc untick**;
"Review them" filters the queue to the candidates. Post-file: the existing auto-committed bar
pattern + **Undo all** (clean — see learning ruling) + per-doc send-back. Reason chips on
excluded stragglers ("kept back — the date read differently on re-check"). Anchor-only honesty
line when N>0: "N more from this sender need a full re-read — they stay in Review." Mixed
suppliers: one stacked banner, per-scope rows, each its own accept.

## Filing path + LEARNING RULING (Oracle arbitration of the barry/gary conflict)
File via `reviewService.confirm` per doc (bulk:true) — the shipped autoCommitFullConfidence
pattern, NOT `_autoFileDoc` (no second auto-file site). BUT the "precedent" is split (renderer
path feeds saveCorrections as the human; backend path doesn't) — so:
- **NEW `confirmed_via` column (migration; TEXT, NULL = legacy/human).** The sweep accept path
  sets `'scope_sweep'` SERVER-SIDE from the call site — never client/payload-suppliable.
- **Graduation: barry wins.** scopeTrust volume/window EXCLUDES `'scope_sweep'` rows (the
  self-reinforcement loop is real: scopeTrust counts any confirmed row; a 25-doc sweep could
  fill the whole W=10 window with machine confirms whose wrongs never get corrected because
  filed docs leave the review surface). Do NOT retro-exclude auto_import/auto_commit here —
  that shifts live graduation states, own realdoc A/B, logged as known pre-existing dilution.
- **SEAM 1 (Oracle — both advisors missed): the naive human-only window DISARMS
  self-revocation.** Required: window = last W HUMAN confirms; corrections counted over ALL
  in-scope docs confirmed at-or-after the OLDEST of those W (time-span membership, not id
  membership) — so a correction on a sweep-filed doc still revokes trust. Pinned by test.
- **Values: gary wins, narrowed.** Live-derived learning (formats/shapes/prefix — derived from
  confirmed status) flows and rolls back on de-confirm. **Sweep confirms SKIP `upsertHint` and
  `learnTemplateOnCommit`** (same flag) — hint usage inflation on machine echoes and
  irreversible template_logo_hashes appends are what made "Undo all" dirty; skipping them makes
  the undo copy true.
- **SEAM 2 (Oracle — both missed): candidacy→accept mutation.** The pill fill / OCR-enhance /
  edits can mutate extraction rows between the consent list and the accept. Capture a per-doc
  extractions FINGERPRINT at candidacy; any change by accept → drop from the batch with a
  reason chip. Accept also re-runs the gate server-side + inherits ALREADY_FILED race handling.
- Audit: `scope_sweep_offered` {scope, doc ids, tiers} + `scope_sweep_accepted` {ids, unticked
  ids, actor} (consent reconstructable) + `via:'scope_sweep'` on each confirm.

## Test plan (gary + Oracle conditions)
Unit predicate table (role match/fail arms, contradiction, notes, corrected_to, type flip,
normalisation, stored-empty+fresh-value HELD); PINs — fresh-better-value never files; note or
corrected_to never; kill switch; ZERO-WRITE candidate evaluation; opts-seam support PIN;
corrections-span revocation PIN (must FAIL on today's undistinguished counting before trusted);
fingerprint-drop; ALREADY_FILED; sweep-core === pill-core symbol identity. Integration fixture
(confirm K → sweep → accept → audit + queue asserted). Demo-corpus gate (Desktop\Demo Docs:
import 20/supplier cold, confirm 10 with GT, green-lit role values == GT; poisoned stored ref →
never green-lit; de-confirming the swept N restores the pre-sweep learning state; graduation
equals the K-human-only computation). Realdoc byte-identical with the feature OFF AND with the
migration applied but OFF.

## Build order (suggested slices)
1. Migration `confirmed_via` + scopeTrust human-window/corrections-span rework (+ PINs) — the
   riskiest seam, land it first, feature-independent.
2. `_reextractFastCore` refactor + `sweep-scope-candidates` IPC + predicate (pure, unit-first).
3. Renderer: pills + banner + list/untick + accept path (fingerprint + re-validate).
4. Gates: fixture integration + demo-corpus + realdoc; flip `scope_sweep_enabled` per install.
Rating: barry L3 differentiator, near top of office backlog. Residual (accepted, recorded):
a systematically identical misread cold+warm passes everything — same exposure as every batch
path today; with the graduation exclusion it can no longer compound into trust.
