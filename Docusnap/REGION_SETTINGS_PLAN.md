# Regional date & currency settings — research + implementation plan

Goal: a **Region setting** that (a) parses dates according to the selected region and
(b) applies the correct currency to monetary fields. Draft plan — not yet built.

---

## 1. Worldwide DATE formats (the research)

Three orderings cover the world:

| Order | Example (3 April 2026) | Where |
|---|---|---|
| **Little-endian** `DD/MM/YYYY` | `03/04/2026` | UK, Ireland, most of Europe, Australia, NZ, India, most of Africa & South America — **the global majority** |
| **Middle-endian** `MM/DD/YYYY` | `04/03/2026` | **USA** (+ territories; Philippines mixed) |
| **Big-endian** `YYYY/MM/DD` (ISO 8601) | `2026/04/03` | China, Japan, Korea, Taiwan, Iran; the ISO standard — **unambiguous** |

- **The ambiguity:** `03/04/2026` is 3 Apr (DMY) or 4 Mar (MDY). Only a region hint OR a
  day-value > 12 resolves it (`25/04` must be DMY). Month **names** (`Apr`, `April`) and ISO
  are never ambiguous.
- **Separators:** `/`, `-`, `.`, space. `.` is common in Germany (`03.04.2026`).
- **2-digit years** (`03/04/26`) inherit the same ordering ambiguity.

**Today:** `validator.py DATE_FORMATS` lists DD-first first, US `%m/%d/%Y` last (lowest
priority). So the app already does the right thing for the UK/EU majority, wrong for the US,
and can't be told which.

## 2. Worldwide CURRENCY formats (the research)

**ISO 4217 code** (`GBP`,`USD`,`EUR`,`JPY`,`INR`,`CAD`,`AUD`,`CHF`,`CNY`…) + **symbol**
(`£ $ € ¥ ₹ …`). Two axes diverge by region:

**a) Symbol placement**
- Before: `$1,234.56`, `£1,234.56` (US/UK/most Anglo)
- After: `1.234,56 €` (DE/ES/IT), `1 234,56 €` (FR)

**b) Decimal + thousands separators — the big one**

| Style | 1234.56 grouped | Regions |
|---|---|---|
| **Anglo** | `1,234.56` (`,` thousands · `.` decimal) | US, UK, Ireland, Australia, most Anglo, Japan, China |
| **Continental** | `1.234,56` (`.` thousands · `,` decimal) | Germany, Spain, Italy, Netherlands, most of Europe, most of South America |
| **French/SI** | `1 234,56` (space/NBSP thousands · `,` decimal) | France, much of francophone Africa, official SI |
| **Swiss** | `1'234.56` (`'` thousands · `.` decimal) | Switzerland, Liechtenstein |
| **Indian** | `12,34,567.89` (lakh/crore 2-2-3 grouping) | India, South Asia |

**c) Decimal places:** most 2; **0** for JPY/KRW/HUF/ISK; **3** for KWD/BHD/OMR/TND.

**Today:** `validation_patterns.currency` hard-assumes Anglo (`[\d,]+\.\d*`). A Continental
`1.234,56` misparses (the `.` reads as decimal → `1.234`). No currency is ever *assigned*.

---

## 3. Proposed setting

One **Region** picker in Settings → *Files & filing* (or a new *Regional* card), backed by
three settings so power users can override any axis independently:

| Setting key | Values | Default (no regression) |
|---|---|---|
| `region_date_order` | `dmy` \| `mdy` \| `ymd` \| `auto` | `dmy` (current behaviour) |
| `region_currency` | ISO 4217 code, or `none` | `GBP` (or `none` = don't assign) |
| `region_number_format` | `anglo` \| `continental` \| `french` \| `swiss` \| `indian` | `anglo` (current behaviour) |

A friendly **Region dropdown** (United Kingdom / United States / Germany / France / …) sets all
three at once; an "Advanced" disclosure exposes the three axes. `auto` date-order keeps the
day-value>12 tiebreak and falls back to `dmy`.

**Filing/output stays canonical:** dates still normalise to internal `DD-MM-YYYY` and the
filename builder is unchanged; currency stores the **ISO code + a canonical `1234.56` decimal**
in the XML metadata regardless of display style — the region setting only governs **parsing of
input** and **display**.

---

## 4. Implementation touchpoints (lockstep — mirrors "adding a field type")

1. **Settings storage + UI**: 3 keys above; Region dropdown + advanced axes in
   `settings/{index.html,renderer.js}`; also offer it in the **first-run wizard** (performance/
   region step). Broadcast on change.
2. **Date parsing** — `validator.py parse_date`: build the format-priority list from
   `region_date_order` (DMY→DD-first list; MDY→MM-first; YMD→ISO-first; auto→current +
   day>12 tiebreak). Thread the setting: `process_docs.py --date-order` → `engine.extract` →
   `validator`. Month-name & ISO formats stay unconditional (never ambiguous).
3. **Currency parsing** — a locale-aware **normaliser** run BEFORE the currency regex/validator:
   given `region_number_format`, strip the region's thousands sep and convert its decimal sep to
   `.` so every value collapses to canonical `1234.56` (then the existing Anglo regex works). New
   `python_backend/extraction/number_format.py` (+ JS twin for the renderer on-blur validator and
   the search comma-strip, which should become format-aware).
4. **Currency assignment** — when a monetary field's value has **no** symbol/code, prepend the
   `region_currency` symbol for display and store its ISO code. Skip when `none`. Never overwrite
   a symbol the document actually carries (a `$` invoice in a GBP install stays `$`).
5. **Renderer mirrors** — the Review on-blur validator (`get-validation-patterns` path) and the
   Search full-text number-normalisation must both consult the number-format (so `1.234,56`
   searches/validates correctly for a Continental install).
6. **Display/format** — a shared `formatCurrency(value, region)` for Review/Search/preview so the
   shown amount matches the region (symbol placement + separators), while stored value stays canonical.

**Plumbing:** `process_docs.py` args `--date-order`, `--number-format`, `--currency`; engine
threads them like the existing `--name-wordness` / `--multiline` flags. JS twin for renderer parity
(same pattern as `text_normalise.py`/`text_normalise.js`).

**Regression safety:** every default equals today's behaviour (`dmy` / `anglo` / `GBP`), so an
un-changed install is byte-identical; only a user who picks a non-UK region shifts parsing. The
day>12 tiebreak keeps decidable dates correct in any mode. Validate with a new
`tests/test_region_formats.py` + the extraction accuracy harness (must stay ≥ baseline).

---

## 5. Suggested phasing

- **Phase 1 — Date order** (highest value, self-contained): the setting + `parse_date`
  reordering + plumbing + tests. Fixes US/ISO installs immediately.
- **Phase 2 — Number-format parsing**: `number_format.py` normaliser + JS twin + Review/Search
  mirrors. Fixes Continental/Swiss/Indian amount parsing.
- **Phase 3 — Currency assignment + display formatting**: assign `region_currency` to unmarked
  monetary fields + `formatCurrency` display. (This also underpins a cleaner fix for the
  complex-invoice totals mis-read, since totals parsing becomes locale-aware.)

Reviewed against the current `validator.DATE_FORMATS` (DD-first, US-last) and
`config/keyword_patterns.json validation_patterns.currency` (Anglo-only).
