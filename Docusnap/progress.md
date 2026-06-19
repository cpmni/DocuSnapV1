# ScanFinder — Session Progress Report

_Date: 2026-06-19 · Branch: `feat/licensing`_

This session delivered a large body of extraction-quality work. Two coherent
extraction commits have landed; the remaining feature work is implemented, tested,
and staged in the working tree but **not yet committed** (kept separate by design).

---

## ✅ Committed this session (branch `feat/licensing`)

### `09a4c62` — feat(extraction): improve anchor relocation and winner quality validation
The coherent extraction-backend commit (25 files, +2564/−114). Bundles the
mutually-coupled extraction work:
- **Phase 1 pattern-based field correction (suggestion-only):**
  - `text_normalise.py` + JS twin (`database/modules/text_normalise.js`) — deterministic
    compare-time normaliser, byte-parity tested (`normalise_corpus.json`).
  - `name_match.py` — token-level canonical NAME repair (fix garbled known tokens,
    keep the variable tail; never whole-value snap / never inject; positional +
    thin-evidence guards; idempotent).
  - Stage 4.5 wiring in `engine.py`: name repair (runs independent of `check_value`)
    + backend charset flag — both emit `corrected_to`/`validation_note`/conf≤70 only,
    never `value`/`display_value`.
  - `config/keyword_patterns.json` `field_charsets` block (backend-only).
  - `value_quality.py` (name/company quality) + located-gate/value-quality changes
    in `engine.py`/`anchor.py`/`keyword.py`.
- **Coupled extraction work it had to include** (shares files): `template_mapper.py`
  drift relocation + registration arbiter + find/follow/read, `registration.py`,
  `template_matcher.py` (hard dep — not in HEAD; carries the multi-ref min-over-set
  but it's **inert** without the excluded JS side).
- Invariants held: no merge-precedence change, no supplier-identity change, no
  candidate retention/override, no auto-correction, no schema/migration.

### `0277a85` — feat(extraction): add additive shape-families view and shape_match_score helper
Phase 2 (2 files, +153, purely additive — 78 insertions / 0 deletions in
`format_anomaly_checker.py`):
- `shape_families()` + `_shape_canonical` — folded/counted/capped (6) view over the
  existing learned shapes; additive `fmt['shape_families']` key.
- `shape_match_score(value, fmt_entry)` — 1.0 exact / 0.8 learned-shape substring /
  0.0 else. Pure, diagnostic; `classify_format`/`check_value`/`propose_correction`
  untouched.

---

## 🟡 Implemented, tested — NOT yet committed (in working tree)

These are complete and green but deliberately excluded from the extraction commits.
Each is a candidate for its own follow-up commit.

| Feature | Key files | Tests |
|---|---|---|
| **Multi-reference logo phash** (template identity = a SET of hashes; convergence on confirm; cures duplicate templates) | `database/modules/templates.js`, `database/index.js` (migration 26), `src/modules/processing/handler.js` (getAll), `python_backend/ocr/landmarks.py` (--emit-phash) | `test_template_logo_hashes.js`, `test_logo_phashes_multiref.py` |
| **Structural "Company" fields** (Company/Date/Reference permanent: non-deletable/disable/rename; relabel supplier→Company) | `database/modules/document_types.js`, `database/index.js` (migration 27), `src/modules/settings/handler.js`, `src/windows/settings/*` | `test_structural_fields.js` |
| **Value-quality persistence mirror** (JS `isPlausibleSupplierName`/`nameQuality`; `saveAnchor` rejects field-name labels) | `database/modules/learning.js` | (covered via Python `test_value_quality.py`, committed) |
| **Review "advance to next doc"** on commit | `src/windows/review/renderer.js` | manual |
| **Reggie agent** (regex/pattern advisor) + eric roster | `.claude/agents/reggie.md`, `CLAUDE.md` subagents | n/a |
| **Docs** (this session's CLAUDE.md updates: Stage 4.5 Phase 1/2, multi-ref, structural, Reggie) | `CLAUDE.md` | n/a |

Also untracked/misc: `templates/*.json` (sample templates), `src/windows/help/`,
`src/windows/shared/helpmode.js`, `src/lib/safe-send.js`, `package.json`.
**Excluded as noise (do not commit):** `website*/`, `Samples/`, `handover.md`,
`scripts/`, parent-dir `../` entries.

---

## 🧪 Test status (all green)
- **Python extraction suite:** `test_text_normalise`, `test_name_match`,
  `test_field_charsets`, `test_value_quality`, `test_shape_match_score`,
  `test_precedence`, `test_label_overrides`, `test_template_mapper`,
  `test_template_mapper_drift`, `test_registration_arbiter`,
  `test_stage45_text_preserve`, `test_format_anomaly_checker` (37-suite),
  `test_logo_phashes_multiref`.
- **JS suite:** `test_text_normalise.js`, `test_templates.js`, `test_template_merge.js`,
  `test_template_logo_hashes.js`, `test_structural_fields.js`, `test_bulk_review_delete.js`.

---

## ⏭️ Deferred / next steps
1. **Commit the remaining features** as separate logical commits (multi-ref · structural
   fields · value-quality JS persistence · review UX · agent/docs), excluding website/Samples noise.
2. **Phase 3 — candidate override** (not started): retain per-field alternative candidates
   in `engine.extract` (additive, winners-only behaviour unchanged) and add a gated
   post-merge resolver that may prefer a better candidate using `shape_match_score` /
   `name_match` / family counts — never overriding authoritative/located sources;
   suggestion-only until opt-in per field.
3. **Build/installer** (`ScanFinder Setup 2.0.0-rlocal.exe`) was produced mid-session; rebuild
   after the remaining commits land.

---

## Notes / invariants upheld this session
- Stage 4.5 additions are **suggestion-only** (corrected_to + validation_note + conf cap;
  never mutate value/display_value).
- Merge precedence, supplier-identity re-resolution, and auto-correction behaviour
  are unchanged by the committed work.
- `template_matcher.py` multi-ref logic is committed but inert (JS emit side excluded),
  so no behaviour leak.
