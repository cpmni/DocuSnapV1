# S2 census — PP-OCR disagreement hold (glyph_fallback_enabled, mig 207)

Oracle SIGN-OFF-W/COND (2026-09-22 re-rule). Switch DARK; this is the flip-gate evidence. Warm corpus =
the 700-doc synthetic (`flip_census_20260921/warm_700_mig.db`, 400 confirmed test docs) at `RR_APP_ENV=1`;
the ONLY delta between arms is the shell env `GLYPH_FALLBACK_ENABLED`.

## The predicate (refined BY this census)
The switch re-reads the ref-role crop with the PP-OCR engine and HOLDS on disagreement. The raw
"any-difference" trigger false-held **14%** of clean docs (a spurious `#`/`~` from crop framing, a `-` vs
no-separator, a dropped char). Refined in two steps, each re-censused:
1. compare **alphanumeric content only** (strip separators/punctuation/whitespace) — 81 → 8 fires;
2. hold only a **same-length, exactly-one-differing-position** disagreement (oracle C2's single-glyph
   shape) — rejects the shifted-crop artifacts (`FQSD-5744`, `t QS-59570`) — 8 → 6 fires, **1 newly held**.

## Safety (700 corpus, ON vs OFF)
| check | result |
|---|---|
| `wouldFile(ON) ⊆ wouldFile(OFF)` (no NEW auto-file) | **PASS** (0) |
| ref value unchanged (PP never overwrites) | **PASS** (0 changed) |
| newly HELD by PP | **1 / 400 (0.2%)** |
| of which CATCH (committed ref was GT-wrong) | 0 |
| of which FALSE HOLD (committed ref GT-right) | 1 (#446 `PD/25/8080`, an 8↔S PP misread on a clean render) |

- The switch **can only ever HOLD** — it never newly auto-files and never changes a value (provable by
  construction: it only caps confidence + adds a note; the census confirms it empirically).
- 0 catches on the SYNTHETIC corpus is expected — those renders are clean, Tesseract reads them right, so
  there is nothing to catch. The synthetic corpus is a SAFETY gate; efficacy lives on real scans.

## Efficacy (the owner's REAL 34-page Print Tracker batch — the class the switch exists for)
`efficacy_printtracker.py` — heterogeneous UNIQUE serials, no history/format lever:
- **2 catches, both PP-right, 0 false-holds:**
  - **p7 `RFH0738865`** (Tesseract `RFHO738865`, O→0, conf **76** — a SILENT auto-file wrong that no
    cheaper lever catches) → HELD.
  - **p11 `1G25802868`** (Tesseract `1625802868`, G→6, conf 14) → HELD.
- The other 32 pages AGREE → unchanged (every current correct read preserved).

## The other Oracle conditions
- **C1 (PP never a corroboration family):** structural — the method writes NO `_field_candidates` entry;
  `_CORROB_PAGE_FAMILIES = {mapping,crop,keyword}` has no PP key. Pinned (`test_glyph_disagreement_hold.py`
  `test_c1_pp_not_a_corroboration_family` + `test_disagree_holds_with_neutral_note` asserts `_field_candidates == {}`).
- **Neutral note:** names BOTH readings, asks the human to read the glyph (no assertion of PP's value).
- **No corrected_to / no learning / conf never mapped to a trust number / never lifts a hold.**
- **Determinism (C5):** S0 proved two-process byte-identical (string + confidence); threads pinned to 1,
  fixed model + graph-opt. The vendored model has a pinned sha256.
- **Wall-clock:** the ON arm adds one ~8 ms rec read per located ref-role field (only on scanned pages).
  The 400-doc arm ran in the same order as OFF (~10-13 min); acceptable.

## Verdict
Safety PASS, efficacy demonstrated on the real target class, false-hold 0.2% on clean docs (a genuine
single-glyph ambiguity, always a visible HELD doc — never a misfile). **Flip remains the owner's call.**
Residual honesty: the switch only fires where the ref reads through a LOCATED crop (a taught mapping) — a
pure keyword full-page read (no box) abstains (oracle C4). The real target (repeat suppliers like Print
Tracker) reads via a template, so this is the operative path.

## Files
`run_safety.sh` (raw ON/OFF), `run_on_refined.sh` (refined ON), `compare.py` (subset/value-change),
`classify_fires.py` (catch vs false-hold via GT), `efficacy_printtracker.py` (real-doc catches),
`off.jsonl` / `on2.jsonl` / `fires2.jsonl`.
