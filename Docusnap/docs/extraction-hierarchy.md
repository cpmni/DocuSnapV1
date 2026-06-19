# Extraction Hierarchy — auto-detection, field anchor labels & templates

> How DocuSnap decides **who** a document is from, **what** type it is, and
> **which** reading of each field wins. Drawn from `python_backend/extraction/
> engine.py` (`extract()` merge logic) and the stage modules. Keep this in sync
> with the pipeline notes in `CLAUDE.md`.

There are two hierarchies running at once and they feed each other:

- an **identity** hierarchy — who is this supplier, what doc type is it;
- a **value** hierarchy — which stage's reading of each field wins.

---

## 1. Identity resolution

### Supplier identity — seeded early, re-resolved late
Supplier is **never frozen at the first guess**. It is resolved in passes, each
able to overrule the last:

1. **Template's own `supplier_name` field** — a learned `fixed_value`, seeded in
   Stage 0. *Not* the template's display name (names like "Purchase Order
   Template" are not suppliers and would poison downstream hint/anchor lookups).
2. **Logo match** (`anchor.try_logo_supplier_match`) — fallback only when no
   template supplied a name.
3. **Keyword / anchor reads** can override both, gated by a *plausibility shape
   test* (`_supplier_identity_decision`): a plausible read replaces an
   implausible incumbent (a real company name beats a stale `"IN"` fragment even
   at confidence 95); an implausible candidate never displaces a plausible one;
   both-plausible / both-implausible falls through to the normal confidence
   contest (so a genuine short name like "IBM" is never hard-banned).
4. **Text-scan fallback** (Stage 2.5a): if the resolved name is still
   implausible, scan the top ~600 chars of OCR against confirmed hints
   (usage_count ≥ 3, plausible only).
5. **Final re-resolve + normalise** (after Stage 2): `supplier_name` is re-read
   from `results['supplier_name']` and run through `normalize_supplier_name`
   *before* any hint/anchor/logo persistence — so the learning corpus is never
   written against a stale identity.

> **Supplier is a learning-scope key**, resolved via logo/template/hint — never
> a required field the user must fill.

### Document-type / slug resolution
`document_slug` gates the format/qualification checks; a **null slug silently
disables them**, so resolution order matters. Precedence:

- **(a) Reprocess** passes the doc's already-assigned slug (`--known-doc-slug`)
  → **always wins** (re-detection fails on clipped scans).
- **(b) Fresh scan** with a confident template match → adopt the **template's**
  doc type + field set over weak keyword name-detection (the template is the
  stronger type signal), so slug, fields and doc-type-scoped anchors all agree.
- **(c)** Template matched but caller resolved no slug → adopt
  `matched_tmpl.document_type_slug`.

### Same-logo disambiguation
The logo identifies the **supplier, not the doc type**. One letterhead can cover
several layouts, so `identify_template` gathers *all* close logo candidates and,
when more than one fall in the same-logo cluster, picks the one whose **keyword
fingerprint** matches the page. A lone candidate keeps the fast logo
short-circuit.

---

## 2. The value hierarchy (which reading of each field wins)

Stages run in order and merge into `results` under explicit precedence rules —
not raw confidence alone.

```
Stage 0    Template seeding     template_fixed / template_anchor   (generic, often auto-learned, can be stale)
Stage 0.5  Admin-drawn maps     template_mapping* / template_registration*   (curated ground truth)
Stage 1    Keyword regex
Stage 2    Anchor labels        anchor_crop (taught) / anchor_inline / anchor_crop_relocated
Stage 2.5  hints · denoise · OCR-correct
Stage 3    LLM (ai mode only)
Stage 4    Validation (date normalise/salvage, currency, maths cross-check)
Stage 4.5  Format-anomaly / shape consistency
```

### Precedence is by authority tier, not just confidence
The order is **authoritative ⊕ anchor > Stage 0.5 mapping > admin label > other >
generic seed**, each gated on validity (an invalid higher source yields to the
next valid one). In detail:
- **Authoritative ⊕ anchor wins outright (Tier A).** A Stage 2 candidate whose
  anchor row was set by an explicit ⊕ re-teach (`data["authoritative"]`, from
  `last_authoritative_at`) that **clears the credibility gate** wins over ANY
  incumbent — Stage 0.5 mapping, admin label, generic, learned — *regardless of
  the resolved method or confidence*. This is method-independent: it fires whether
  the value resolved via `anchor_crop`, `anchor_inline`, `anchor_crop_relocated`
  or `anchor_registration` (the old rule only honoured `anchor_crop`). A passive
  (non-authoritative) anchor never reaches this; an *invalid* authoritative read
  is dropped by the gate first, so it correctly yields.
- **Stage 0.5 located mappings** (`_is_stage05_located`: any prefix
  `template_mapping*` / `template_registration*`) are **curated ground truth**
  below Tier A. Stage 1 keyword **cannot demote** them and a non-authoritative
  Stage 2 anchor **cannot clobber** them; they override a generic seed on
  authority.
- An **admin label override** (`keyword_override`) is a deliberate instruction, so
  a valid one **outranks any incumbent on authority** (`is_override_authority`)
  **except** a Stage 0.5 mapping — it still yields to the mapping (chosen
  mapping > label ordering) and to a Tier-A authoritative anchor. It beats all
  learned / generic / passive-anchor values.
- A **passively taught `anchor_crop`** still overrides a generic keyword/regex hit
  via `is_taught_override`, but cannot touch a mapping or the admin label.

### Credibility gates (guard overrides only)
An empty field is still filled (the validator then flags it); these only stop a
candidate *displacing* an incumbent:
- **date fields** — candidate must `validator.parse_date()`;
- **ref fields** (`_number` / `_no` / reference) — reject low-info noise (lone
  `"a"`, punctuation), and a digit-free candidate cannot displace a digit-bearing
  incumbent.

---

## 3. Field anchor labels (Stage 2)

An anchor is keyed **(supplier, document_type, field_key)** — the doc type is
treated as *the layout*.

- **Doc-type scoping** (`_anchor_matches`): a typed anchor may **not** cross into
  a different known doc type, even for the same supplier (stops a supplier's PO
  anchors firing on its worksheets). Enforced only when both types are known.
- **Authoritative vs passive:** an explicit ⊕ re-teach sets
  `last_authoritative_at`, **trusts the drawn box outright** (no tolerance/blend),
  and becomes the *single* anchor for that (field, doc-type) **across all
  suppliers** (a teach corrects the field for the layout, not one resolved
  supplier). `_filter_anchors` puts authoritative anchors in their own bucket
  *ahead of* passive ones, before supplier-priority — so a fresh teach can't lose
  to a stale auto-learned row. Among teaches, most recent wins. Passive
  auto-learn still usage-weight-blends, with **per-axis** tolerance.
- **Find → follow → read:** coordinates are only a *hint*. The taught **label**
  is re-located on each page (`_locate_anchor`), and the value crop is derived
  from where the label actually landed + a stored **drift-invariant offset**
  (`offset_dx/dy_norm` = value-centre − label-top-left, page-normalised). Because
  label and value shift together, a clipped/shifted scan reads correctly and a
  correction on a bad scan doesn't re-point the canonical anchor.
- **Label sanitisation** (`sanitizeAnchorLabel`, migration 23): document-specific
  tokens (refs/dates/serials) are stripped so the label generalises
  (`"2605-0769-1 Work Address"` → `"Work Address"`); the now-mismatched offset is
  nulled.
- **Inline harvest:** the locator keeps per-word boxes and harvests the value
  straight off the located line (`anchor_inline`) — what makes a never-seen
  key/value report and a drifted worksheet read without any crop.
- **Drift recovery** (`_relocate_value_by_label`): the rigid crop is tried first;
  if it fails its credibility/format gate, the label is re-found page-wide and
  the value re-cropped adjacent to it (`anchor_crop_relocated`).

---

## 4. Templates (Stage 0 + 0.5)

A template is the **layout fingerprint + curated field map** for a supplier's
document.

- **Identity** = logo phash + keyword fingerprint + pinned sample page.
  **Stabilised on confirm, not overwritten**: the fingerprint becomes the
  *intersection* of recurring tokens across confirmed samples (with a floor so
  one noisy sample can't erase a known-good identity); an established
  `logo_phash` is kept rather than reclobbered.
- **Field variability is evidence-based** (`_buildTemplateFields`): a field is
  frozen as a `fixed_value` only when truly constant; ≥2 distinct confirmed
  values for the doc type → treated as variable and never frozen (self-heals an
  already-frozen field on the next confirm).
- **Stage 0.5 mappings** = admin/teach-drawn anchor→target zones (Settings →
  Templates → "Map a Field"; the teaching wizard saves each field this way). Read
  order inside the mapper:
  1. **absolute drawn box first** — the exact region the wizard's live zone-OCR
     read at teach time — **but** guarded by a **drift check**: if the mapping has
     a real anchor label and that label is located *displaced* beyond a per-axis
     tolerance (`_label_drifted`), the page has shifted (e.g. cropped→uncropped),
     so the value is re-derived from the label's actual position (drift-invariant
     stored offset, `_relocate_and_read`) and preferred over the now-misaligned
     box. Clean/undrifted or blank-label mappings keep the absolute fast path.
     The wizard auto-captures the anchor label by OCR'ing the drawn box when left
     blank, so every mapping can track drift;
  2. **registration rung** — "register, then read": taught `template_landmarks`
     re-located on the page, one RANSAC similarity/affine transform fitted
     (`registration.fit_transform`, NumPy, no OpenCV), every target box mapped
     through it so a shifted/skewed/**scaled** scan still finds the value;
  3. **single-label refinement** fallback.

  A shared gate (`_gate_value`) applies **date-salvage → credibility (regex/type)
  → format-rejects**, with rung-aware shape modes: the drawn box uses `ignore`
  (regex/type only — a human placed it, it can't column-bleed), derived rungs use
  `flag` (a type-valid value failing the learned shape is kept but capped ≤70 and
  tagged `_shapewarn`).
- **Template groups:** a template with no enabled mappings of its own **borrows**
  enabled mappings from a grouped sibling (`select_mapping_source`), re-validated
  on this page (the anchor relocation re-runs, yielding nothing if the layout
  doesn't actually match). Groups are otherwise organisational only.
- **Landmarks** (3–5 stable / unique / well-spread words auto-derived from the
  sample page by `ocr/landmarks.py`) are additive/inert — a template without them
  behaves exactly as before — and the same fit serves both Stage 0.5 and Stage 2
  registration. Gated by `registration_enabled` (default ON).

---

## One-line summary of precedence

> **Authoritative ⊕ re-teach anchor** > **admin-drawn Stage 0.5 mapping /
> registration** > **admin label override** > **passively-taught anchor /
> keyword / inline / relocated** > **generic template seed** > **hints** — each
> gated on validity (an invalid higher source yields to the next valid one), with
> credibility/format gates guarding every override, and identity (supplier +
> doc-type) re-resolved at the end so learning is written against the right key.
