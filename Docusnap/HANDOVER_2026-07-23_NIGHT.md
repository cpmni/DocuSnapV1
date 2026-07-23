# HANDOVER — 2026-07-23 NIGHT (Fable 5, the long autonomous run)

**Branch:** `feat/reprocess-throughput-autostraighten`
**HEAD `b28f581` — PUSHED. Origin in sync; tree clean** (only the out-of-repo `../Backup/`).
**Installer:** still `dist\ScanFinder Setup 2.0.0-r20260722-1742-3e3fde1.exe` — predates ~20 commits
→ REBUILD before any packaged test.
**No uncommitted batch. No background processes** (the owner's dev `npm start` exited mid-session;
all harness runs + advisor agents completed and were READ).
**Supersedes:** `HANDOVER_2026-07-23_EVENING.md`. **Live DB:** `%APPDATA%\ScanFinder\docusnap.db`,
**migration 53** (this session added it), ~390+ confirmed docs (the owner confirmed batches all day —
corpus counts in this handover moved 276→331→333→390 across runs; always re-pair A/Bs).

---

## 1. TL;DR
**15 commits, all PUSHED, every one advisor+Oracle-gated with pinned tests.** The evening handover's
build job (`ANCHOR_LINE_SELECT`) shipped dark + fully gated; four owner-requested UI fixes shipped;
the "Thornbury suggested on a Copperfield docket" incident was root-caused and closed at the JS layer
(detail-hash veto) with a remediation sweep for 13 live poisoned template links; the 85-vs-88 hold
class got the corroboration lift + honest hold copy; Learning-Repair send-back/delete/restore now
un-plant/re-plant learning symmetrically; and the **airtight-supplier-detection chain** ran a full
measure→fail→reframe→fix loop ending in a **PASSED activation gate** (backfilled == starved
byte-identical). The enrolment flip is now safe and owner-timed.

| Commit | What |
|---|---|
| `c5c1e58` | DocType editor: subgrid-aligned field rows + visible "🏷 Keywords" pill (bob-approved; REVERSES the old wrap-on-narrow decision — do not restore) |
| `76c2b96` | Doc-type LIST drag-reorder (shared `planReorder`; `test_doctype_reorder.js` 20/20) |
| `7b07620` | Review field labels left-aligned (badge floats right) |
| `48262e0` | **ANCHOR_LINE_SELECT** (default OFF) + ROW_GRACE (dark) — pins (a)-(k), stash-pair base==OFF byte-identical, ON: values/M identical, +14 auto-file attributed |
| `6ab04f1` | **256-bit detail-hash veto** on JS `identifyByFingerprint` (`TEMPLATE_LOGO_DETAIL_VETO` ON; `logoDetail.js` null-sentinel; DELIBERATE Stage-0 divergence pinned; probe 44 vetoes/44 recovered/0 lost) |
| `2c1dd13` | `scripts/poisoned-template-link-sweep.js` — 13 cross-supplier links (dry-run/--apply/--undo, verified on a copy). **Owner has NOT yet run --apply** |
| `06470a4` | **KEYWORD_ANCHOR_CORROB** lift (fork A, C1-C8) + `weak-critical-field` hold copy names the field |
| `a9f2d42` | **Send-back UN-PLANT** (`REPAIR_UNPLANT` ON): atomic deconfirm + `retractConfirmHints` + corrections delete + suspect-field notes |
| `de67cc7` | C7: confirm LEARNING input filtered by `ownFieldPredicate` (same `FOREIGN_FIELD_DROP` switch) |
| `c9725e2` | Enrolment slice (thread + backfill) — **SHIPS DARK** (`LOGO_DETAIL_ENROL=1` arms; note INVERTED default-OFF polarity); first activation A/B FAILED honestly (268→131) |
| `6d61cb0` | C6: repair-DELETE un-plants + restore RE-plants IFF `documents.learning_retracted_at` (**migration 53**) proves the retract ran (double-plant pin) |
| `059d87b` | Sparse-guard slice 1: miss-arm suggests (`LOGO_DETAIL_MISS_SUGGEST`); gate then still 36 short — ALL attributed to the disagree arm |
| `b28f581` | **Unification (Oracle re-adjudicated his own ruling): disagree arm also suggests, coarse winner THREADED (C1) → C5 GATE PASSED: backfilled == starved BYTE-IDENTICAL (268/390, M=9 same rows)** |

## 2. Verification state — be honest
- **All 15 commits' unit suites green** (each commit message lists its suites; run commands unchanged —
  `py -3.12 python_backend/tests/<t>.py`, `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron <js test>`).
- **Corpus A/B pairs run this session** (reports in `stress_test/out/`, ALL READ): `ls_base/ls_off/ls_on`
  (ANCHOR_LINE_SELECT), `kc_off/kc_on` (corrob lift — byte-identical, never fired on the mature corpus),
  `act_base/act_on` (enrolment activation — FAILED 268→131), `sg_base/sg_on` (guard v1 — 232, 36 short),
  `sg2_base/sg2_on` (**unified guard — BYTE-IDENTICAL, the pass**). `RR_DB` + `RR_DUMP` env overrides
  were added to `realdoc_regression.js` for copy-based A/Bs + per-doc attribution.
- **Corrected mid-session claims** (recorded so nobody re-learns them): (i) my "sparse-set ABSTENTION
  caused the collapse" was WRONG — gary traced it to the Slice-D coarse-miss fill arm; (ii) the Oracle's
  own "disagree cannot fire on genuine docs" premise was measured FALSE (the WINNER can be the rival on
  2-bit collisions) — he re-adjudicated and owned it; (iii) the evening handover's "keyword reads cap at
  85" was over-broad — SHIPPED patterns score 90 and clear the floor; the 85 cap is the SEEDED/override
  path only, and the Stage-4.5 support boost self-heals at ≥5 confirms (CLAUDE.md corrected).
- **NOT verified live (owner-side):** everything in §5.

## 3. FIRST ACTIONS for the fresh session
1. **Nothing is mid-flight.** The natural next build is **Slice 1d** — Python Stage-0
   `identify_template` still accepts on logo distance alone (it WROTE the 13 poisoned links); design
   round (gary→Oracle) + its own corpus gate. The JS twin (`6ab04f1`) and the unified sparse guard are
   the pattern to mirror.
2. **The enrolment flip is now SAFE and awaits the owner**: arm `LOGO_DETAIL_ENROL=1` (confirm-time
   thread) + run `scripts/logo-detail-backfill.js` dry-run → owner `--apply` (the DO-NOT-APPLY banner
   in the script should be updated to point at the PASSED `sg2_*` gate first — small doc edit).
3. Owner live checks below; then the deferred queue (§4).

## 4. Deferred (designed/banked, with load-bearing conditions)
- **ANCHOR_LINE_SELECT default flip**: needs the live gate — reprocess the 4 Thornbury crosscheck
  dockets with `ANCHOR_LINE_SELECT=1` (dates/refs must commit from the crop rung) + a label-ABOVE
  fixture that today ends empty→review must FILL. ROW_GRACE stays dark regardless (own adversarial
  gate before any flip talk).
- **Veto slice 2** (text corroboration for the null-detail residue): keyed on `establishedIdentity`,
  never the cosmetic `name`; null identity ⇒ accept (a cold just-promoted template keeps its pill).
- **Un-plant residuals**: pre-existing sent-back docs are go-forward-only (optional sweep); the
  reprocess-of-confirmed door is a documented sibling leak; renameSupplier-merge residue is hypothesis.
- **85-vs-88 leftovers**: the +2/87 dead band (general calibration — untouched on purpose) and the
  constant-value-field skip (issuer can never earn the support boost) are named, not built.
- **Sparse-guard accepted trades (do NOT "fix")**: the 4 `N-99718`-class wrong-value docs auto-file
  again (value-layer/poisoned-GT baseline, was accidental healing); mid-pipeline pick-scoping on
  disagree docs is given up (proven value-neutral). Both pinned in commit `b28f581`.

## 5. Needs the USER
- `scripts/poisoned-template-link-sweep.js --apply` (app closed, DB backed up; writes an undo file).
- ANCHOR_LINE_SELECT live gate (item 4 above) when next processing Thornbury dockets.
- Reopen Settings + Review windows to see the four UI fixes; live-test drag-reorder/keywords.
- Decide the enrolment-flip timing (§3.2). Installer rebuild before any packaged test.
- Evening-handover leftovers still open: P2 `--apply` (94 rows), H2 pairing decision, poisoned-GT
  cleanup (#190/#7 — and note #262/#263/#266/#269/#273/#287/#309 are the same class).

## 6. Key facts & paths
- **Kill switches added this session** (default ON unless noted): `TEMPLATE_LOGO_DETAIL_VETO` ·
  `KEYWORD_ANCHOR_CORROB` · `REPAIR_UNPLANT` · `LOGO_DETAIL_MISS_SUGGEST` · dark/inverted:
  `ANCHOR_LINE_SELECT` (OFF) · `ANCHOR_ROW_GRACE` (OFF) · `LOGO_DETAIL_ENROL` (**=1 arms** — inverted).
- **Migration 53**: `documents.learning_retracted_at` (delete/restore learning symmetry, NULL-inert).
- **Measured numbers to reuse, not re-derive**: 64-bit phash cross-supplier 2/64 vs same-supplier
  drift 18/64 (histograms CROSSED — never tune it); 256-bit detail impostor floor 86/256, drift
  p50=56/p90=96/max=162 (corpus-wide histogram, 6 suppliers); backfill plan = 29 rows all guarded.
- **New tools**: `stress_test/template_detail_veto_probe.js` (read-only live-DB replay) ·
  `scripts/poisoned-template-link-sweep.js` · `scripts/logo-detail-backfill.js` (banner needs the
  §3.2 update) · `RR_DB`/`RR_DUMP` on the corpus harness.
- **Advisors this session**: bob (UI), Phillip (fingerprinting), gary (×4), Oracle (×5 incl.
  re-adjudicating himself — the full chain is in the commit messages).
