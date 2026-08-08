# Teach-first flow — owner plan (2026-08-02)

**Owner proposal (verbatim):** "i am thinking of changing the flow of the app. realistically,
the review window and the targets are there to correct information. I think the primary source
of new docs should be the teach wizard. it works well, will ensure a template is created and
makes sense to the customer - the how and why we are using it. Then if something is misdetected
in review, the targets will add a further layer of validation to future docs??"

**Consult chain:** barry (product) + gary (system, parallel) → Oracle adversarial vet
(traced every load-bearing claim to source). This document is the signed consensus.
Verdicts per slice below; nothing here is built yet.

---

## 1 · The answer in one paragraph

You are half right, and the half that's right is already mostly in the code. **Teach becomes
the primary response to a NEW LAYOUT — but import stays first**, and that is not a taste call:
the wizard's doc-picker reads the review queue (`teach/renderer.js:1034`), so a document must
be imported and processed before the wizard can even see it. Literal teach-before-import is
impossible by construction — and undesirable: the pipeline's first pass reads 60-70% of a cold
doc and is itself the triage that discovers what needs teaching. The plan therefore makes the
wizard the FRONT DOOR for every new layout the import surfaces, guarantees the template from
doc #1 (your ask), and sells the layering you described — which the code already implements.

## 2 · What is ALREADY true (verified in source — no build needed)

- **Your layering is the shipped precedence, verbatim.** Authoritative ⊕ anchor > Stage 0.5
  wizard mapping > admin label > passive learning (`docs/extraction-pipeline.md:450-497`).
  Wizard = base reading layer; Review ⊕ = correction layer that outranks it.
- **"Targets as validation" is true — and it is EXCLUSIVE to the ⊕ path** (Oracle's find,
  both advisors missed it). The taught-ownership validation cap arms only off `field_anchors`
  rows (`engine.py:2890-2896`); the wizard saves only template + mappings, never a
  `field_anchors` row. So: **the wizard teaches reading; a ⊕ fix in Review is the act that
  ARMS validation.** Customer line: "Every fix teaches it — and arms a check."
- **Stage 0.5 mapping reads already corroborate** other methods' values in the main
  ownership check (`_is_stage05_located` in the voucher predicate, `engine.py:2952-2954`) —
  the "admit mappings as vouchers" slice gary drafted is a NON-PROBLEM; deleted.
- **Template dedup is teach-safe.** Wizard commit reuses before creating (name-primary
  `reuseByEstablishedName`, then logo/branding arms — `review/handler.js:1133-1234`); a
  re-teach UPDATES the existing template, it doesn't fragment.
- **Graduation is untouched and must stay so.** A wizard teach = exactly ONE human confirm in
  the W=10 trust window (`trust.js:344-408`). Letting one teach fill multiple slots would
  reopen from the other side the seam mig-57 closed against machine confirms. Teach-first
  still legitimately shortens time-to-auto-file: it guarantees the docTrustGate
  template-match requirement from doc #1 — historically a real auto-file blocker.
- **Wizard copy is already clean** (no "anchor"/"OCR" in user-facing teach strings — Oracle
  grepped it). Barry's "de-jargon first" precondition is stale; downgraded to a light audit.

**Consequence: with the voucher slice deleted, this whole programme is EXTRACTION-INERT —
UI and steering only. Zero extraction risk, no realdoc exposure.**

## 3 · The build slices (Oracle verdicts + conditions)

| # | Slice | Verdict |
|---|-------|---------|
| S0 | Corpus flow gate (harness only) | SIGN OFF |
| C2 | Wizard type-pick guard | CONDITION — build BEFORE steering volume |
| S1 | Batch-end "New Layouts" steering (dark) | SIGN OFF W/COND C1 |
| S3 | Post-teach graduation banner | SIGN OFF |
| S2 | Wizard-commit ⊕-conflict surfacing | SIGN OFF W/COND C4 |
| S1.5 | Consent-gated cluster heal button | SENT-BACK flagship, rebuilt — C3 |

- **S0 — corpus flow gate first; it decides everything.** Two arms on the Customer Doc Test
  corpus, BOTH renditions (Digital + Scanned). Arm T (teach-first): wizard-teach doc 0001 per
  issuer×type — phase 1 you drive the real wizard (doubles as UX validation), harness
  snapshots the saved mappings to fixtures; phase 2 = headless replay for repeatability —
  then plain-confirm 0002-0010, import the live set. Arm R (baseline): same DB, plain
  confirms only, same import. Score per-field vs GT + M (would-auto-file-wrong) + auto-file
  rate + queue depth + **heal-rate per cluster** (the number S1.5's copy is allowed to
  claim). **Pass: Arm T M=0 hard; T ≥ R on every field; T auto-file rate ≥ R** — if
  teach-first doesn't beat baseline at equal safety, the flow change has no system case and
  the plan says so. Pre-check gary's assumption (iii): all 5 types actually present per
  issuer (a gap fails the harness quietly).
- **C2 — wizard type guard (small, renderer-only, closes the one new-harm path).** Step 2
  today neither preselects nor badges the DETECTED type and commits file the doc under
  whatever was picked (`teach/renderer.js:192-206, 250`). Steering non-technical operators
  into the wizard en masse with no type hint = wrong-type template + wrong filing. Fix:
  badge/preselect the detected type; one extra confirm when the pick differs from a TRUSTED
  detected title.
- **S1 — batch-end "New Layouts" triage (dark, kill-switched).** After an import: "3 layouts
  here Scan Finder hasn't learned — they cover 41 of your 60 documents. Teach the biggest
  first?" Cards deep-link `open-teach-window-at(docId)` at an exemplar. **C1: the cluster
  predicate must BE the existing Review CTA tier predicate** (`review/renderer.js:1855-1931`)
  — Tier B matched-drift shows NOTHING (anti-fragmentation), learned-method reads suppressed;
  PIN test that Tier B yields no card. Clustering: 20 docs from one new supplier = ONE card.
  Recheck false-"matched" hides a card → fails toward status quo, acceptable.
- **S3 — graduation banner post-teach.** Reads `scopeTrust`: "auto-files after N more
  confirmed documents." UI only; makes the trust window legible instead of tempting us to
  shortcut it.
- **S2 — wizard-commit conflict surfacing (the warm-install seam).** A stale authoritative ⊕
  outranks a fresh wizard mapping OUTRIGHT while its read is clean (Tier-A,
  `extraction-pipeline.md:454-459`) — so an operator who wizard-teaches BECAUSE the old ⊕
  reads wrong changes nothing, silently. On commit, detect an authoritative anchor for the
  same (field, doctype): "this field also has a hand-taught position from Review — keep or
  retire." **C4: surfacing-only; default keep-both; retire = explicit operator action via
  existing Learning Recovery semantics; never touch `last_authoritative_at` silently.**
  Auto-retire is forbidden — it would disable the authoritative supremacy Tier-A and the
  07-26 re-teach fix depend on.
- **S1.5 — the heal, rebuilt (barry's flagship was SENT BACK as drafted).** Auto-reprocess on
  wizard commit bypasses the reprocess-discards-edits guard — that guard is a RENDERER-side
  confirm on Review's own buttons (`docs/history.md:18-19`); a main-fired reprocess wipes a
  colleague's staged-but-unsaved Review edits with no dialog. Rebuild: an operator-triggered
  **"Re-read the N similar documents"** button on the S1 surface that (a) skips docs
  open/claimed (presenceService), (b) runs the pending-edits check, (c) reports honestly:
  "Re-read 14 — 9 now read cleanly." Safety by construction: a fresh wizard-taught scope has
  1 human confirm, graduation needs 10 — a heal can NOT silently mass-auto-file.

## 4 · Rejected (pinned so a future session can't quietly revive them)

- **Gate-first** (can't confirm until taught) — punishes the 1-doc-a-week supplier, blocks
  the queue on a 10-minute wizard. Hard no (barry, Oracle concurs).
- **Teach counts >1 toward the trust window** — reopens the mig-57 seam. PIN in
  `test_scope_trust.js`: a taught confirm counts exactly 1.
- **A new expected-position flagger** — three validation mechanisms already exist
  (ownership cap, 2.6b corroboration, S-C witness); a fourth multiplies flags.
- **S4 mappings-as-vouchers** — already true where it matters (`engine.py:2952`); the 2.6b
  late path is anchors-only by structural necessity (it re-runs anchors precisely because no
  template matched — there is no mapping to run).
- **Auto-reprocess on wizard commit** — see S1.5.

## 5 · Named constraints & risks (say them, don't discover them)

- **Page 1 only:** the wizard teaches `page_number:0` (`teach/renderer.js:996`) —
  totals-on-last-page layouts stay a Review/⊕ job. v1 constraint, must be in the copy.
- **Name-variant duplicates:** a wizard-typed issuer that normalises differently from the
  established identity can miss name-primary reuse; logo/branding arms + merge tooling are
  the net. Watch in live batches; the corpus's clean names can't exercise it.
- **Cluster honesty:** the "these 14 are the same layout" promise must be true or trust
  dies; scanned siblings drift past the logo accept gate (≤6) and heal <100%. S0's Scanned
  arm measures the real heal-rate BEFORE any heal-count copy is written.
- **Consent-surface collision (Oracle, new):** S1's batch-end surface and Catch-up Filing's
  consent bar are two "machine wants to act on your queue" surfaces from the same trigger
  class. **Sequence: catch-up slice 4 flips first; S1/S1.5 reuse its consent-bar pattern and
  copy register. Never two consent idioms; never a double prompt from one teach.**
- **Mid-commit failure wrinkle:** commit failing at `confirmReview` leaves template+mappings
  live with the doc unfiled — recoverable (re-run reuses via name-primary). Noted, not
  blocking.

## 6 · Build order + verification gate

**S0 → C2 → S1 (dark + Tier-B PIN) → S3 → S2 → S1.5 (sequenced with catch-up slice 4).**

Gate: the S0 two-arm harness (pass criteria above) before any steering flips; unit PINs —
Tier B no-card, taught-confirm-counts-1, S2 deletes-nothing; any future slice that touches
extraction (none signed here does) re-triggers the full realdoc M=0 + zero per-field-drop
gate. Oracle's verdict table + full seam analysis: `docs/oracle_log.md` (this date).
