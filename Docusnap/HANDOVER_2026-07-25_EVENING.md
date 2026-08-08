# HANDOVER 2026-07-25 EVENING (Opus 4.8)

Branch `feat/reprocess-throughput-autostraighten` · **all PUSHED through `863e914`** (origin in sync `0 0`;
tree clean bar parent-level `../Backup`, `../Docusnap - Copy`). No uncommitted code. Installer NOT rebuilt.

## TL;DR
Live-testing day with the owner. Shipped 4 fixes (6 commits) — template de-fragmentation (merge tool + reuse-
by-branding), live field-visibility-by-supplier, and the **logo-refuse fall-through** (the reprocess "No
template match" bug) — all kill-switched, advisor+Oracle gated, corpus-clean, and the logo fix **validated
live**. Investigated + **DID NOT BUILD** a label-separator change (reggie caught it as a no-op for its symptom).
**THE FRESH SESSION'S JOB: the recipient/customer anchor problem** (diagnosed, not fixed — below).

## ⭐ THE NAGGING PROBLEM — the fresh session's target (DIAGNOSED, not fixed)
**The recipient/customer-name anchor cannot reliably pick the COMPANY-NAME line out of a captioned,
multi-line address block.** Captions seen: **"Deliver To"** (delivery dockets), **"Site / Customer"**
(service worksheets), and by extension "Bill To" / "Sold To" etc.

Evidence — `SaltmarshSeafoods_delivery_docket_19.pdf` (owner confirmed "Bingo"), from the dev-inspector trace:
- The recipient block is: `Deliver To` / **`Halcyon Leisure Group`** (company, the wanted value) / `The Pavilion,
  Marine Parade` / `Torquay` / `TQ2 5TR`.
- The taught `customer_name` anchor's value box sits on **"The Pavilion, Marine Parade"** (the STREET line) —
  the **wrong line** of the block.
- `anchor_crop` read **"The vin, Marie Pr"** (garbled OCR of "The Pavilion, Marine Parade") @63% → **lost**.
- `anchor_crop_relocated` grabbed the **caption "Deliver To"** itself → **rejected (not_credible)**.
- Only the `keyword_override` read got the right value **"Halcyon Leisure Group"** @78% → the field survives
  ONLY on keyword. Net: customer ~80%, doc 93% (below the 100 filing threshold) → the whole 16-doc Saltmarsh
  docket batch keeps landing in review.
- Worksheet variant (doc 549, "Site / Customer"): the direction-"below" recipient anchor doesn't corroborate,
  so `_flag_taught_field_ownership` caps `customer` @69 ("taught position couldn't be confirmed"). Same root.

**Root (hypothesis to verify):** for a captioned multi-line recipient block, (a) the taught value box lands on
the wrong line (address, not the company name), and (b) the relocate/crop grabs the caption or a garbled address
line. The NAME line is the one immediately BELOW the caption. The fix must make the recipient anchor reliably
select that name line — NOT the caption, NOT a lower address line — and stop the caption-as-value / garbled-
address reads from beating (or masking) the correct keyword read.

**Prior art to read before designing** (grep these memories + code):
- `[[project_label_capture_plan]]` (`581d926`) — the caption-as-value guard family (a taught 'below' anchor
  committing its own caption garble); order A→C→D→B; the ladder clamp + caption-band reject.
- `[[project_late_located_corrob]]` — `_filter_located_corrob` (engine.py:191) only lets `anchor_inline` /
  `anchor_crop_relocated` + `located` vouch through `_anchor_corroborates` (engine.py:2146); a "below" recipient
  read doesn't clear it → that's why the worksheet customer stays @69.
- `[[project_taught_ownership_own_label]]` (`4af4bba`) + `_flag_taught_field_ownership` (engine.py:2054).
- The anchor label/locate path: `anchor.py` `_locate_in_text_lines` / `_locate_for_relocation`, the fuzzy
  `_label_score` (template_mapper.py:1129, already "/"-tolerant), and the "below"/"right" value read.
- customer_name is a plain OPTIONAL recipient field post-migration-44 (supplier_name is the sole identity).

**Diagnostic artifacts left in scratchpad** (reusable single-doc tracers):
`.../scratchpad/trace549.js` (spawns process_docs with the full arg set + `--trace` for one doc — mirrors the
reprocess path incl. `--known-doc-slug`), `match_truth.py`, `match_blocker.js`, `live555.py`, `logodist.js`,
`anchors.js`, `types.js`, `detect_type.py`. Path base:
`C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\a0a070cd-1e0b-49a1-9a6c-e7d1c955e20f\scratchpad`.

## Committed this session (all PUSHED)
1. **`5501be1` merge tool (Slice 1)** — `templateMerge.findMergeCandidates` splits `insufficient` from
   `divergent`, adds `merge_review` (owner-confirmed, backup-first) for near-identical-branding dupes; field-zone
   verdict + richness-first canonical. Settings → Templates → "Suggested cleanups". Kill `TEMPLATE_MERGE_REVIEW`.
   Phillip + Oracle signed. **Merges NOT run on live data** — owner action.
2. **`aba2f46` reuse-by-branding default ON (Slice 2)** — `TEMPLATE_REUSE_BY_BRANDING` flipped to `!=='0'`; a
   confirm/teach reuses its existing (branding,slug) template instead of minting. Replay: 482/534 reuse, 0
   cross-supplier. ⚠ **needs one LIVE OWNER BATCH** to prove (Oracle gate) + Phillip's IDF hardening before
   wide rollout.
3. **`17f25e5` live field-visibility by supplier** — `templates.findForSupplierType` (modes 1/2 via setting
   `field_visibility_resolve_mode`); a no-template doc still hides absent fields + issuer edits re-scope live.
   Kill `FIELD_VIS_LIVE_RESOLVE`. Owner-validated (valid-name). Design: `docs/designs/TEMPLATE_DEFRAG_2026-07-25.md`.
4. **`af346d8` logo-refuse fall-through** — `identify_template` logo-arm trusted-title refuse now falls through
   to the same-type keyword rescue (+ Oracle C1 supplier guard) instead of returning None; fixes reprocess "No
   template match" on a doc whose logo locked a wrong-type same-supplier sibling. Kill `LOGO_REFUSE_FALLTHROUGH`.
   gary+Phillip+Oracle signed. Unit pins + corpus ON-vs-OFF (M/accuracy identical, +5 correct auto-files) +
   **VALIDATED LIVE** (owner reprocessed after a `__pycache__` clear → matches id23). Design:
   `docs/designs/TEMPLATE_LOGO_REFUSE_FALLTHROUGH_2026-07-25.md`.
5. `8103268` / `863e914` — docs (defrag handover; label-sep DO-NOT-BUILD record).

## Verification state — honest
- Logo-refuse (`af346d8`): unit + corpus ON/OFF + LIVE. **Fully validated.**
- Field-vis (`17f25e5`): unit (`test_field_visibility_resolve.js` 10 checks) + live valid-name. Invalid-name
  keeps fields = mode-1 branding backup (by design; mode 2 = name-only).
- Defrag slices: unit + gate green. **Merges NOT run**; **Slice-2 live batch NOT yet done.**
- Label-sep: **NOT built** — reggie premise-break (fuzzy locator already "/"-tolerant → no-op for the customer
  cap; the real cause is the below-anchor corrob filter). Recorded in `docs/designs/LABEL_SEP_TOLERANT_2026-07-25.md`.
- ⚠ Corrected mid-session claim: my first "reprocess clears the flags" was wrong on 549 — the app was running
  STALE Python bytecode; clearing `python_backend/**/__pycache__` was required for the logo fix to take effect.

## FIRST ACTIONS (fresh session)
1. **Reproduce the recipient-anchor problem** with `scratchpad/trace549.js` (adapt the file path to
   `SaltmarshSeafoods_delivery_docket_19.pdf`, or its inbox `<docid>.pdf`) → confirm the `customer_name` lineage
   (keyword_override wins; anchor_crop garble + anchor_crop_relocated caption-reject). Then design the fix
   through the advisor gate (007/reggie for the OCR/label geometry, then Oracle). Fail-toward-review + kill switch.
2. Owner: run the **dupe merges** (Settings → Templates → Suggested cleanups) and the **Slice-2 live-batch check**.
3. Decide the reprocess-doesn't-link-template gap (below) — build or leave (confirm links it).

## Deferred (designed/known, not built) — with the load-bearing conditions
- **Reprocess doesn't LINK a template for an assigned-type needs-review doc.** Import + confirm link; reprocess
  doesn't (the pre-extract `identify_template` is gated on `--known-doc-slug`, and the engine's authoritative
  match is NOT persisted to `_template_id` — engine.py:4440 `matched_tmpl` is None on that path). So the "No
  template match" banner persists on reprocess even when the values are right; **confirming links it** (reuse-by-
  branding ON → id23). Fix = ungate the template LINK on reprocess while keeping the type-authority gate. Its own
  gate + corpus.
- **Slice-2 IDF/rarity hardening** (Phillip) before wide reuse-by-branding rollout — a per-DB rarity weight so
  two suppliers can't collide on 3 generic tokens ("Services Ltd"). Kill switch is the backstop meanwhile.
- **Label-separator tolerance** — parked (no-op for the symptom; revive only with a real motivating case).

## Needs the USER
- Run the dupe merges (backup-first, owner-confirmed) + the Slice-2 live batch.
- Confirm the queued Saltmarsh docs (confirming links + files them; reuse-by-branding ON).
- Rebuild the installer for the other PC(s) when ready (field-vis is main-process; logo-refuse is Python).

## Key facts / paths
- Live DB: `%APPDATA%\ScanFinder\docusnap.db` (read-only via `?mode=ro`); ~548 confirmed docs.
- ⚠ **Python change ⇒ clear `python_backend/**/__pycache__`** (or full restart) or a reprocess runs STALE
  bytecode — this masked the logo fix for ~an hour this session.
- Corpus: `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js`
  (long; output → `stress_test/out/`, gitignored; ON vs OFF via the kill-switch env). JS tests: Electron-as-node.
  Python tests: `py -3.12 python_backend/tests/<f>.py`.
- Advisors used as agents: gary, Phillip (general-purpose + document-fingerprinting skill), reggie, Oracle.
- Memory: `[[project_logo_refuse_fallthrough_20260725]]` · `[[project_field_visibility_live_resolve_20260725]]`
  · `[[project_template_defrag_20260725]]`. New target memory: `[[project_recipient_anchor_problem]]`.
