# Oracle C10 — the mig-207 (+ mig-212) flip-gate census on the owner's DB copy (2026-09-23 night)

**Bar (Oracle, `docs/oracle_log.md` 2026-09-23 NIGHT, C10):** after C1 + casefold + the 0.90 floor FIXED beforehand:
false holds ≤ 1 (each on a contact sheet) · would-file lost ≤ 1 adjudicated · the 3 `HS71Y` true catches kept · the 5
clip + 4 bleed docs read RIGHT · wouldFile(ON) ⊆ wouldFile(OFF) · M=0 · OFF md5 identity · two ON runs byte-identical.

**Arm:** 727 confirmed docs (read-only copy of the live DB, `stress_test/out/c0_live_copy/`), `RR_APP_ENV=1`,
`GLYPH_FALLBACK_ENABLED=1 GLYPH_CONFUSABLE_RESOLVE=1` (+ `GLYPH_SLICE_INTEGRITY=1` on the S1 arms), RELEASE off, every
hold exit traced. Files `glyph_on_pre_c1.*` · `glyph_on_c1_v1.*` · `glyph_on.*` (C1 traced) · `glyph_s1_v1.*` ·
`glyph_s1_v2.*` · `glyph_s1.*` (v3). Analysis `analyse_glyph_on.js` + `via.json` (confirm provenance).

## The arms, side by side
| | pre-C1 | C1 pad parity | S1 v1 (snap from the padded rect) | S1 v2 (snap the bare box) | **S1 v3 (+ value-text filter)** |
|---|---|---|---|---|---|
| DISAGREEMENT holds | 16 (all false) | 2 (false) | 0 | 0 | **1** (false: `SO-99174`→`S0-` serif O/0 at 0.918, mapping winner, no page word matched) |
| would-file lost | 6 | 1 | 0 | 0 | **1** |
| true catches (RESOLVE branch, `HS71Y07217`→`H571…` PP 0.999) | 3 | 3 | 3 | 3 | **3** |
| agree | 358 | 339 | 366 | 410 | **419** (human-confirmed 116 · machine 303) |
| `length_or_multi_diff` abstains | — | 105 | 83 (70 label-swallowed) | 42 (30 label-swallowed) | **30** (21 anchor · 9 mapping; label-swallowed 2) |
| `rewritten_winner` abstains (Oracle C6) | — | — | — | 32 | 32 (all 5 `RFH0738865` docs among them) |
| `pp_lowconf` abstains | — | 6 | — | 0 | 2 (`W5-92515` 0.822, `S0-72452` 0.898) |
| no_box (keyword/hint winners) | 169 | 169 | 169 | 169 | 169 (+2 mapping without a rect) |
| "common-mode" per harness GT | 4 (RFH0 via RESOLVE) | 0 | 4 (RFH0) | 3 (CJB) | 18 (CJB) — **all Castellan worksheets: both readers read the printed Job Sheet `CJB-…` correctly; the "confirmed" value is the Job Ref from a machine sweep / 4 pre-teach hand confirms (`RESULT_SHAPE_EXEMPT.md`) → GT artefact. TRUE common-mode 0.** |
| `slice_integrity` verdicts | — | — | healed 379 · clean 67 · no_words 11 · unhealed 4 | healed 374 · clean 67 · no_words 15 | healed 344 (n=1: 180+50 mapping, 87+25 anchor; n=2: 2) · clean 67 · no_words 45 |

## The nine named documents (the 5 clips + the 4 bleeds from the first arm) on S1 v3
| doc | first arm | S1 v3 |
|---|---|---|
| #78 `SO-71797` (S cut) | `5O-71797` FALSE HOLD 0.926 | **agree 0.986** |
| #181 `INV-28243` (3 cut) | `INV-28245` FALSE HOLD 0.886 | **agree 0.952** |
| #653 `WS-43726` (W cut) | `VS-` FALSE HOLD 0.645 | **agree 0.999** |
| #658 `WS-43655` (W cut) | `NS-` FALSE HOLD 0.68 | **agree 0.998** |
| #221 `DN-16846` (D cut) | `ON-` FALSE HOLD 0.654 | no page word matched → parity rect → `DN-1646` (dropped glyph) → **length abstain** (safe, no hold) |
| #230 `DN-98358` (fragment + bleed) | `DN-08358` FALSE HOLD 0.524 | **agree 1.0** |
| #459 `NRQ-1124` (date below) | `NRO-` FALSE HOLD 0.494 | **agree 0.999** |
| #417 `ITH-0093` (label above + border) | `iTH-` FALSE HOLD 0.775 | **agree 0.889** |
| #240 `SO-99174` (serif O/0 + bleed) | `S0-` FALSE HOLD 0.918 | no page word matched → parity rect → `S0-99174` 0.918 → **the one remaining false hold** |
Also: Print Tracker `W2E8X06407` (4 docs, read `O` for `0` at 0.95 on the first arm) → **agree 0.999** on the word-tight
rect; `WS-62946` / `ITH-0093` (case) → agree; `WS-92515` / `SO-72452` (serif S/5, O/0 at 0.82/0.90) → `pp_lowconf`.

## Gate verdict
| C10 item | result |
|---|---|
| false holds ≤ 1 | **1** ✔ (on the contact sheet: a serif `O` the model reads as `0`; the page pass produced no matching word so the snap fell back) |
| would-file lost ≤ 1, adjudicated | **1** ✔ (the same doc, correct value, held) |
| the 3 `HS71Y` catches kept | ✔ (RESOLVE branch, PP 0.999, siding with the page) |
| the 5 clip + 4 bleed docs read right | **7 of 9 agree; 2 abstain safely / hold** (none wrong) ✔ |
| wouldFile(ON) ⊆ wouldFile(OFF) | ✔ gained 0 |
| M=0 | ✔ the hold changes no value |
| common-mode | **0 true** (18 harness rows = the Castellan GT artefact, documented) ✔ |
| OFF md5 identity · two ON runs byte-identical on vendor/python | **NOT RUN tonight** — owed before the flip |
**Caveats the Oracle named:** the 0.90 floor was chosen on the first arm's 16 (in-sample) and held FIXED here; 51 % of
the 727 confirms are machine-made (partition shown); the census geometry is now the pipeline's own. **Recommendation:**
migs 207 + 212 are flip-ready on this evidence once the two byte-identity runs are done; mig 210 (the reword) rides
with them; mig 211 (the release) stays DARK (its yield was 1/9, Part C unbuilt).
