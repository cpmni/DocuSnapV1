# Pending Features & Deferred Work

> Running backlog. When a feature/fix is discussed but NOT implemented right away, add it here with
> the notes/details agreed + anything pertinent (symptom, code pointers, the fix direction, gates,
> and any advisor rulings). Newest at top of each section. Remove an item when it ships (note the commit).

---

## UX / product

### ✓ SHIPPED — Import "couldn't be read" banner: details + dismiss  (2026-07-30)
The amber Import banner now (1) reworded "held for retry (not filed, not lost)"; (2) a **Details** toggle
lists each held doc + WHY (`documents.error_message`, via the existing `getStuckDocs`); (3) a **dismiss (×)**
per-session acknowledge that re-surfaces only when MORE docs fail (`_stuckDismissedAt`). Renderer + markup +
CSS only (`src/windows/main/{renderer.js,index.html}`); errored docs still hold at `status='error'` (never
lost) — dismiss is display-only. Needs an app reopen to render.

---

## Extraction / accuracy

### Letterhead cold-start supplier reader  (confirmed at scale 2026-07-29)
- **Symptom:** cold (first-contact, no learning) supplier identity reads only from a `Supplier:`/`Bill
  From:` caption. The born-digital demo batch measured **~8%** supplier accuracy cold — name-as-text
  letterheads, footer-only issuers, and text wordmarks all return null. Resolves once learning/templates
  exist, so it's a first-contact gap.
- **Fix direction:** the designed-but-unbuilt `letterhead.py` **suggestion-only** reader (largest text in
  the top band → issuer). Only ever needs to carry doc #1. See memory `project_issuer_band_and_letterhead`.

### S1 band-graduate — real fix (column/geometry-aware issuer window)
- **State:** S1 (`TEMPLATE_IDENTITY_BAND_GRADUATE`, commit `958229c`) is built DARK and proven **INERT**
  on its target: two-column `BILL FROM | BILL TO` layouts put the issuer name AFTER the "BILL TO"
  recipient marker in the linearized text, so `_issuer_hint_band` truncates it out → no shed.
- **Fix direction (deferred, gary+Oracle):** a column/geometry-aware issuer window, OR a `BILL FROM`-
  anchored corroboration window that excludes the recipient column (Oracle C2 is the constraint).
  Memory `project_autofile_s1_band_graduate_20260729`.

### delivery_number / worksheet ref completion  (reggie, 2026-07-29)
- delivery_number went 0% → **45%** after adding its `field_patterns` entry — still partial (more
  label/format coverage + the footer/three-party layouts). worksheet `reference_number` stays **30%** —
  the "Worksheet No"/"Job No" labels must be added at the **type-scoped** layer (preset override / ⊕
  teach), NOT the global `_REF_ROLE_CAPTIONS` seed (reggie: global would collide with `job_no` + blast
  every custom ref field).

### Set A warm cross-contamination  (found 2026-07-29)
- **Symptom:** loading the live learning snapshot DROPPED new-supplier ref accuracy **58% → 33%** on the
  demo Set A — suppliers that share nothing with the scanned data. Live learning bleeds onto strangers.
- **Prime suspects:** `findLogoMatch` is name-blind (phash-only) → a crest phash-collides with a live
  template; or a global/`__unknown__`-scope anchor; or a template fingerprint cross-match imposing a wrong
  fixed zone. Needs diagnosis (rerun the demo warm scorer + trace which live template/anchor matched).

### Digital ↔ scanned bleed (same supplier, divergent layout)
- **Confirmed (Set B warm):** a digital doc reusing a live name inherits the scanned identity (**supplier
  90%**) but the scanned template's field geometry doesn't fit the digital layout (**ref 29%**, held).
- **gary's least-invasive fix (deferred):** extend the `_located_at_taught_position` layout gate to
  **same-supplier** authoritative rigid reads (today cross-supplier only, `anchor.py:~1404`) → a taught
  absolute box fails toward review when its caption isn't at the taught position on a divergent layout.
  NOT a source-partition (that's wrong for production — same supplier should share learning).

---

## Type detection

### TYPE_PRESENCE_VETO — Slice 0 (band reader) + Slice 2 (auto-type cure)  (night 2026-07-28)
- Slice 0: a title-band PSM-11/upscale reader (`read_title_band`) to erase the veto's ~1.5–2.3%
  fail-safe false-holds and feed the cure. Slice 2: arm-the-refuse so legible titles auto-type correctly
  — **flip LAST**, after the identity fixes soak; biggest regression risk (needs a full-corpus per-doc
  type-flip gate). Memory `project_type_presence_veto_20260728`.

### Identity branding-primary separation  (night 2026-07-28, designed)
- Vellum/Larkspur phash collision (64-bit hash = LAYOUT not mark). Fix = branding-PRIMARY supplier
  separation, coarse recall-only, 256-bit mark corroborates. Vellum PDFs are image scans → Slice B
  (reprocess) cure; Option C (geometry) = fresh-import SUGGEST-only. Memory
  `project_identity_branding_primary_20260728`.

---

## Testing infrastructure

### Install preset types + total/line-item fields
- The live DB has only 5 doc types (invoice/sales_order/purchase_order/delivery_note/service_worksheet)
  and **no total/line-item field on any type**. Install credit_note/quote/statement/receipt (Settings →
  Add from catalog) + add a total field, then re-run `score_demo_digital.js` to cover all 9 demo types +
  money extraction (currently untestable). Can be scripted into a copy DB.

---

## Security / hardening

### Cython engine + arm fuses + asar rungs  (discussed 2026-07-29)
- The extraction engine ships as sourceless `.pyc` (a speed bump — bytecode decompiles back to
  near-source). `.pak` = Chromium resources (non-issue); most `.py` = third-party libs + thin entry
  shims. **Real upgrades (deferred, own session — build-chain change + full smoke):** Cython-compile the
  engine → native `.pyd`; arm the Electron fuses (`HARDEN_FUSES`, RunAsNode/inspector off); the deferred
  asar rungs B/D/F/E (bytenode/obfuscation). Plan: `docs/BUILD_HARDENING_PLAN_2026-07-26.md`. Framing:
  raise the bar, not "uncrackable" — the **licensing gate** is the commercial moat, not code secrecy.
