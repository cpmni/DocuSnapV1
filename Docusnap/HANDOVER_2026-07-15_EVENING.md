# HANDOVER 2026-07-15 EVENING — type-heading fix SHIPPED · Slice D on · review-UX batch · issuer-drop VETTED

**Branch:** `feat/reprocess-throughput-autostraighten` · **6 NEW commits this session, all UNPUSHED**
(now 6 ahead of origin) · working tree CLEAN (only untracked scratch `stress_test/_vv2.js`) · installer
NOT rebuilt · dev `npm start` was running live all session (renderer changes need **Ctrl+R** to show).

## TL;DR
The deferred **document-TYPE heading-authority fix from the morning handover is now BUILT + SHIPPED**
(and CONFIRMED live: the Copperfield worksheet types as WSht). Also shipped: **Slice D enabled by
default**, a **review-UX batch** (honest taught-dots + clear-suspect-reads + label-cluster banner fix +
two rail icons + a position-only readout reword), and a **taught-ownership corroboration exemption**.
The session ended mid-diagnosis of a live SuperStore issue → root-caused to **cross-supplier positional
issuer bleed**; the fix is **DESIGNED + gary/Oracle-signed but NOT built** (owner's call to wrap first).
Nothing bad was filed — the SuperStore junk is all `needs_review`.

## COMMITTED this session (6, unpushed) — oldest first
- **`2168c85` feat(type): heading-authority.** Part B column-aware heading SCORING (`keyword.py`, a merged
  banner `WORKSHEET␣␣Reference No.` earns full heading weight; kill `HEADING_SCORE_COLUMN_AWARE`). C1
  (ship-blocker): the trusted-title REFUSE (`template_matcher.py`) returns a review-hold sentinel + the
  engine persists a type-uncertainty note (falsely-trusted heading fails toward review, never a wrong-type
  auto-file at 100; kill `TYPE_REFUSE_HOLD`, byte-identical off). Part D: `_upsertTemplate` detaches a
  wrong-type Stage-0 link on confirm → re-points to a correct-type template (kill `TEMPLATE_TYPE_LINK_GUARD`).
  Tests: `test_detect_type_aliases` (C2), `test_template_matcher` (C1 sentinel + byte-identical pin),
  `test_upsert_type_link.js` (NEW, C4a/b/c). Design: `docs/designs/TYPE_HEADING_AUTHORITY_2026-07-15.md`.
- **`51ea89d` feat(identity): enable Slice D by default.** `LOGO_DETAIL_PRIMARY` default `0→1` (`anchor.py`).
  Review-bound override (@69+note). First doc per supplier still review-bound (no reference yet); env
  `LOGO_DETAIL_PRIMARY=0` disables. `test_logo_detail_primary` updated for the flipped default.
- **`ae3a330` feat(review): taught-dots + clear-suspect + label-cluster.** (a) the "position taught" dots
  re-scope to the LIVE issuer value on an issuer correction (type change / typing-blur / ⊕ teach) —
  new/untaught supplier → dots OFF (owner confirmed: "they are red now"). (b) on a settled issuer change to
  a DIFFERENT supplier, CLEAR the suspect reads (anchor/template/hint) + keep keyword/typed (owner's
  choice). (c) `anchorLabel.nearestLeftCluster` per-gap column threshold scaled to the caption word so a big
  banner heading ("PURCHASE ORDER") no longer glues onto "Order No." (`test_anchor_label` banner pin).
- **`c5ec661` fix(review): taught-ownership CORROBORATION exemption.** The TAUGHT_FIELD_OWNERSHIP guard no
  longer caps a taught field @69 when the user's OWN authoritative/located/Stage-0.5 anchor read the EXACT
  SAME non-caption value the keyword winner did (the "Fernbank Veterinary Clinic" incident). Oracle C1:
  only an authoritative/located read may vouch (a BLIND non-authoritative anchor may not). Kill
  `TAUGHT_OWNERSHIP_CORROBORATE`. `test_taught_field_ownership` T1-T7. gary+Oracle SIGN-OFF-WITH-CONDITIONS.
- **`c8ed1cf` style(review): straighten icon + direct Learning-History button.** Straighten (both buttons,
  one shared glyph): V4 tilt-levelling-to-a-baseline + curved arrow @18px (owner picked V4 from a rendered
  preview). ⚙ Advanced cog → a **history-clock button** that opens Learning History DIRECTLY (flyout markup
  kept dormant). bob-reviewed.
- **`809f4fa` style(review): position-only readout reword.** "⚠ No label found — anchored by position" →
  "✓ No caption nearby — anchored by its position. This spot will be read on future documents…".

## DATA changes on the LIVE DB (per-install, NOT committed — correct per house convention)
- **Added aliases `["Worksheet","Work Sheet"]` to the WSht type (id 13)** via `document_types.updateType`
  (it had none; WSht ≠ the printed "WORKSHEET"). This is what ACTIVATED the type fix for the owner's corpus
  — with it, detection returns WSht heading=True and the refuse fires. **Owner design rule captured:** a
  custom type is identified by its "Also appears as" aliases, never its arbitrary internal name.
- The owner confirmed some SuperStore invoices → born SuperStore template (id 28) + the issuer bleed below.

## Corpus gate results (read, honest)
`stress_test/realdoc_regression.js` on the live DB, ~50-61 confirmed docs:
- **M = 1 throughout = the standing pre-existing #135** (`delivery_note` ref `DN-35664`→`DN-38884`,
  would-auto-file). PROVEN pre-existing: reproduces IDENTICALLY with all this session's kill-switches OFF.
  Per-field accuracy corpus-neutral ON vs OFF. The type fix shows as #83 (WSht, correct) + #120 (Northgate
  fail-safe flag). The taught-ownership exemption is M-neutral and dropped the ownership caps 4→2.
- Backlog (unchanged, NOT this session): #135 is the standing high-conf delivery-note ref-misread class — a
  reggie pass on delivery-note ref patterns.

## DEFERRED — DESIGNED + gary/Oracle SIGNED, NOT BUILT: the ISSUER positional-read DROP
**This is the first job next session.** Root cause of the live "it all went horribly wrong" SuperStore
screenshot: **cross-supplier positional issuer bleed.** The owner ⊕-taught position-only ISSUER anchors
(`field_anchors`, `field_key='supplier_name'`, empty label) for several INVOICE suppliers (Copperfield /
Contoso / City Office / Anconia). `learning.saveAnchor`'s authoritative branch sweeps every
`(supplier_name, invoice)` anchor across ALL suppliers into one (most-recent wins), so SuperStore invoices
read the issuer at ANOTHER supplier's position via `anchor_registration` → land on the "Item" column
header / "Ship To:" caption → junk. **14 such reads, ALL `needs_review` (nothing filed).**

**SAFETY AUDIT (the owner's explicit ask, verified in the live DB):** ZERO confirmed docs resolve the
issuer positionally — logo 47 / template_fixed 26 / hint_text_match 19 / template_identity 15 / manual 10 /
keyword 2. So dropping positional issuer reads removes NO committed win.

**The fix (build to this):**
- **Seam `python_backend/extraction/engine.py:2662`** — insert a per-type IDENTITY POSITIONAL-READ DROP
  immediately AFTER the template-supplier-precedence override (ends ~2661) and BEFORE
  `resolved_supplier = (results.get('supplier_name') or {}).get('value') or None` (2663). Verified single
  chokepoint (Stage 2.6 late-rescue excludes identity; Stage 2.5b hints need a truthy supplier_name).
- Two pure module helpers: `_identity_key_for_type(field_defs)` = supplier_name if present else customer_name
  if present else None (do **NOT** reuse `anchor.py`'s `_IDENTITY_FIELD_KEYS`); `_is_positional_identity_read(method)`
  = `method.startswith('anchor') or _is_stage05_located(method)` (reuse `_is_stage05_located` @engine.py:135).
- **BLANK the identity read** (value=None, conf 0, + note); **keep the dict** (do NOT pop the key — a
  synthesised carrier @~3576 expects supplier_name present). **DROP not review-cap** (a cap keeps "Item"
  visible AND lets it become resolved_supplier scoping downstream learning).
- Excludes `template_fixed*`/`template_identity`/`template_anchor`/`logo`/`keyword*`/`hint_text_match`/`manual`
  → the confirmed wins are untouched. Recipient `customer_name` positional reads (disambiguation picker /
  late rescue / taught recipient) UNAFFECTED (per-type key derivation). Kill switch `IDENTITY_POSITIONAL_DROP`
  default ON.
- **Conditions (gary+Oracle):** (1) corpus A/B base-vs-fix — **M=0 AND supplier/issuer per-field accuracy
  BYTE-IDENTICAL** (the primary catch: any supplier delta means a confirmed win DID depend on a positional
  read → stop + investigate). (2) **E2E the 14 SuperStore `needs_review` docs** — each `supplier_name`
  resolves to the CORRECT issuer (2.5a hint_text_match / logo / keyword) OR EMPTY→review, and NEVER to a
  different WRONG supplier. (3) `test_identity_positional_drop.py` — predicate exactness + per-type
  derivation + PIN the trade-offs (a LOCATED `anchor_inline` supplier_name read IS dropped; a `customer_name`
  positional read on a dual-key type is UNAFFECTED). (4) confirm `template_anchor` stays EXCLUDED.
- **Optional, do NOT build first (Oracle concern 2):** when the drop blanks a positional read AND a
  corroborated template supplier (`_tmpl_sup`, gated by `_template_identity_corroborated` @2642) is
  available, fill it as `template_identity` instead of None — only if the E2E/corpus shows a review-count
  increase on template-matched docs.
- **After the fix: reprocess the SuperStore batch** (the "Reprocess N from 'SuperStore'" button) to clean
  up the 14 junk issuers.
- Vet transcript: workflow `wrzdlg8xk` (both agents SIGN-OFF-WITH-CONDITIONS); the earlier taught-ownership
  vet was `wya0ghqoz`.

## Verification state — honest
- **Type fix: CONFIRMED LIVE** (owner: "the type changed to wsht thanks") + unit tests + corpus M-neutral.
- **Slice D: enabled**; first doc per supplier is review-bound until a reference enrols (inherent).
- **Review-UX (dots/clear/cluster/icons/reword):** unit + syntax + owner-confirmed (dots red; V4 icon
  picked). **Renderer changes need Ctrl+R.**
- **Taught-ownership exemption:** T1-T7 green + corpus M-neutral (caps 4→2). Note: the incident field
  `customer` is NOT corpus-scored, so the M-gate can't certify the name case — safety rests on two-source
  agreement + caption gate + name_wordness + tests.
- **Issuer positional-read DROP: DESIGNED + VETTED, NOT BUILT.**
- **Live SuperStore junk:** 14 `needs_review` docs show a wrong issuer ("Item"/"Ship To:") — NOT filed,
  fully recoverable; the fix + reprocess cleans them.

## FIRST ACTIONS for the fresh session
1. **Build the ISSUER positional-read DROP** to the spec above (engine.py:2662, two helpers, DROP not cap,
   per-type identity key, kill switch `IDENTITY_POSITIONAL_DROP`). Add `test_identity_positional_drop.py`
   with the pinned trade-offs.
2. **Corpus A/B** (base vs fix): M=0 + supplier/issuer accuracy **byte-identical**. Any supplier delta →
   stop + investigate (contradicts the audit).
3. **E2E the 14 SuperStore `needs_review` docs**: each → correct issuer OR empty→review, never a new wrong
   supplier.
4. **Reprocess the SuperStore batch** to clean up, then commit (ask before push).

## Needs the USER
- **Ctrl+R** the Review window to load the two new icons + the reword.
- SuperStore is thin/text-only — its docs need a confirm to seed hints/template; after the issuer fix,
  reprocess to clean the junk.
- Decide whether to push the 6 commits (all unpushed).

## Key facts / paths
- DB: `%APPDATA%\Roaming\ScanFinder\docusnap.db` (read-only via `?mode=ro`).
- Kill switches added this session: `HEADING_SCORE_COLUMN_AWARE`, `TYPE_REFUSE_HOLD`,
  `TEMPLATE_TYPE_LINK_GUARD`, `TAUGHT_OWNERSHIP_CORROBORATE`; `LOGO_DETAIL_PRIMARY` now defaults **1**.
  NEXT: `IDENTITY_POSITIONAL_DROP`.
- WSht type (id 13) has aliases `["Worksheet","Work Sheet"]` on the LIVE DB (per-install data, not committed).
- Run tests: `cd python_backend && PYTHONUTF8=1 py -3.12 tests/<file>.py`; JS gate tests via Electron-as-Node
  (`ELECTRON_RUN_AS_NODE=1 "$(node -e "process.stdout.write(require('electron'))")" <file>`).
- Corpus gate: `ELECTRON_RUN_AS_NODE=1 <electron> stress_test/realdoc_regression.js` (read the REPORT, not
  the exit code; M=1 = the pre-existing #135).
- Scratchpad probes this session (session-local): `inspect_worksheet_types.py`, `detect_probe.py`,
  `diag_reprocess.py`, `inspect_superstore.py`, `diag_superstore_junk.py`, `issuer_method_audit.py`.
