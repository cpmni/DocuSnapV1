# Three DARK arcs — build, Oracle and gate evidence (2026-08-31)

The three Hard Set class cards (`HARD_SET_CLASS_CARDS_2026-08-31.md`) built the same day, each
DARK (default OFF, mig 95/96/97), each through its own Oracle cycle (verdicts + conditions in
`docs/oracle_log.md`), each gated below. **Nothing is flipped.** Flip decisions are the owner's;
the suggested order and residuals are at the foot.

Baseline (the yardstick for every realdoc arm): 605 deduped papers, off arm = would-file 571/605,
**M = 7** (the known class: 5 leading-digit dates #364/#953/#1423/#1453/#1649 + 2 poisoned-GT
suppliers #331/#1092), M_type = 0, all issuer/field fill rates 100% (serials 91.1%).

---

## 1. `keyword_cell_below` (oscar) — commits `ece65b1` + `829afed`

Oracle: **SEND BACK → all conditions C1-C6 applied** (three trigger discriminators; ref/date only
+ directions honoured; border-glyph baring before G4; re-pinned ON==OFF incl. confidence on the
everyday layouts; dev-gated; gate wording). Pin `test_keyword_cell_below.py` ALL PASS incl. the
RED-first G4 load-bearing proof.

**Hard Set (the fill evidence):** boxed-cell classes' ref/date 0-15% → 85-100% on BOTH renditions;
doc-level diff vs baseline = **0 T→F flips, +240 (scan) / +253 (digital) new CORRECT fills, 0 new
wrong, 0 would-file changes**; wrong+would-file stayed 0 everywhere; controls clean. The two
partial classes (logo_siblings/table_total ref 35-40%) are the recorded bare-"Ref" vocab gap.

**realdoc-605 (Oracle C6):** ON arm **byte-identical to off** — 0 previously-non-empty fields
changed (incl. confidence), 0 fills, 0 would-file changes, M unchanged at 7. On a TAUGHT corpus
the arm adds nothing (learned reads own every field); its value is cold fill only.

Residuals for the owner: boxed TOTALS deliberately excluded (own future slice with a line-items
header guard — queued); bare-"Ref" vocab decision (queued); `ref_role_digit_gate` remains the only
guard on non-gated installs against cold-committing "Date" as a reference.

## 2. `money_sign_parens` / `money_sign_cr` (reggie) — commits `9dd5139` + `e0fe39d`

Oracle: **SIGN OFF WITH CONDITIONS → all applied** (C1 BLOCKING co-residency force — either
capture arms CREDIT_SIGN_COHERENCE in `_reconcileEnv`, pinned by `test_money_sign_coupling.js`;
C2 the arm-3 handoff row; C4 twin-comment truth — the corroboration RECORD comparator is
sign-blind, the twin serves `witness_agrees`/`zone_read_already_agrees`). Pin
`test_money_sign_parens_cr.py` ALL PASS.

**Hard Set:** credit_sign totals 24% → **65%** (parens + CR + the already-shipped `£-x` heal;
lead-minus and trailing-minus stay flagged BY DESIGN — the dash-leader scan class). Controls
clean; wrong+would-file 0.

**realdoc-605 (Oracle C3 wording):** ON arm **byte-identical to off** — 0 sign-gains anywhere
(the owner's corpus prints no whole-segment parens/CR amounts), 0 sign-gains-without-note on
non-credit types, 0 would-file changes, M unchanged. Inert on today's data; heals the notation
class wherever it appears. Per C3: the Hard Set gen signs every money row, so the real-world
mixed-sign penny-reconcile path is corpus-unreachable — `test_reslice_witness.py` remains the
sole guard for that seam (accepted: those arms go quiet on such notes, never false-note).

Residuals: lead-minus `-£x` (dies at the right-leg separator strip — own mini-vet, queued);
`raw_value` on keyword money reads to arm coherence arm 2 for mis-typed credit notes (queued).

## 3. `buyer_issued_convention_note` (gary) — commits `5d1dd84` + `f72eee5`

Oracle: **SIGN OFF WITH CONDITIONS → all applied** (C1 `'logo'` added to the learned-path tuple —
the harness-unreachable risk cohort; C2 the deskew-retry seam pinned in the gate arms; C3
demoter-immunity pins incl. a functional class-F-armed survival drive; C4 honest arithmetic — up
to three human confirms per company+type license the silence; machine-swept scopes earn nothing).
Pin `test_buyer_issued_convention_note.py` ALL PASS.

**Hard Set warm (both sides of the trade pinned):**
- LIVE copy + switch ON: **0 verdict diffs vs the warm baseline** — the owner's own install stays
  exactly as today (the Bramblewood purchase_order supplier_name hint, usage 4, licenses the
  silence).
- STRIPPED copy (PO-scoped Bramblewood hints removed, t8 left alive — the STRONGER arm: the
  template fill still fires) + switch ON: **all 7 buyer_issued_po docs flip silent → [flagged]**,
  0 silent, 0 would-file. Maturity alone no longer buys silence.

**realdoc-605 (both arms, Oracle C2):** the DESKEW_REVIEW_RETRY='0' arm AND the both-ON arm are
each **byte-identical to off** (binary compare of the full consensus) — 0 note-gains, 0
would-file changes, M unchanged at 7. Every live buyer-issued PO is Bramblewood's and the
usage-4 PO hint licenses them all: **the count of live POs lacking the licence is 0** — the
owner's install sees no visible change on flip; the note exists purely for the unlicensed cohort
(proven by the stripped-copy warm arm). The deskew seam never armed (no note ⇒ no new
`_needs_review` ⇒ the retry had nothing to act on).

---

## Suggested flip order (owner's call, per arc)

1. `keyword_cell_below` — biggest customer win (cold boxed fills), zero effect on taught corpora.
2. `money_sign_parens` + `money_sign_cr` — the C1 force keeps coherence armed automatically;
   the two flags may also flip independently of each other.
3. `buyer_issued_convention_note` — Review-honesty; the owner's install is licence-silent, so the
   only visible change is on genuinely unlicensed buyer-issued fills.

Every flip stays reversible (settings rows, dev-gated under SFDEV). None are needed for v1.
