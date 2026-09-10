# REF-ROLE SHAPE VERIFY — mig 154, `trust_ref_role_shape` (2026-09-10)

reggie + gary → **Oracle SIGN-OFF-W/COND**. Built DARK. Kill switch `trust_ref_role_shape` /
`TRUST_REF_ROLE_SHAPE` (env wins both ways, threadable `opts.refRoleShape`), in `TEST_SWITCH_KEYS`.

## The bug (root-caused on the owner's LIVE DB)
Owner ran Reprocess-all; nothing auto-filed. 20 Thornbury **invoices** held, reason
`unverifiable-value:invoice_number`; the read values were CORRECT + note-free (`INV-45152`@98).
A second exhibit — Thornbury **worksheet** `WS-68687`@97, 17 siblings auto-filed, this one left; a
Reprocess then filed it (a cleaner re-OCR lifted it to 100, where the gate already tolerates
`'constant'`) — is the same class.

Chain (all verified in `database/modules/trust.js`):
1. `classifyLearnedShape` short-circuits `distinct.size <= 2 → 'constant'` BEFORE the
   digits/date/currency/code every()-tests (`:274-275`).
2. The scope's confirmed invoice_number values were `INV-71940`,`INV-71940`,`INV-50540` = 3 confirms /
   **2 distinct** (a duplicate/misread) → classified `'constant'`.
3. The sub-100 role branch (`:1042-1045`) reads `_effectiveClass(f,true)`, which only rescues
   `'freetext'`, never `'constant'`, then refuses on `!valueMatchesShape(v,'constant',samples)` =
   set-membership → a genuinely-new `INV-45152` fails.
4. The **at100** path (`:1000-1008`) already EXCLUDES `'constant'` → a ref role at 100% already files
   with no shape check. So the bug is the **graduated-floor(95)/sub-100 path ONLY**.
5. Every built-in + preset ref field is `type:'text'` (`document_types.js:41,56,69,601…`) → no strict
   pattern; the gate can only use confirmed history. **Systemic across every install.**

A reference number is **high-cardinality by nature** — every document carries a new one — so
classifying a sparse ref history as `'constant'` and then demanding set-membership of the next value
is a category error guaranteed to refuse the correct value.

## The fix (Slice A)
`classifyRefShape(samples)` = `classifyLearnedShape` MINUS the `≤2-distinct→'constant'` short-circuit;
returns a structured class ONLY on a **unanimous** every()-test, else `'freetext'`. In the sub-100 role
branch, for `e.field_key === _dtRow.ref_field_key` **only** (gated on `_rolesComplete`), verify by
`classifyRefShape(f.sampleValues)` instead of set-membership. Byte-identical OFF.

- **No `reference_code` re-seed.** The gate fix keys on the ref ROLE, not the declared `type`, so it
  fixes every EXISTING DB with no field retype. `reference_code` is a STRICT_TYPE whose fixed regex
  could `invalid-type`-false-block novel ref layouts + is looser than a per-scope learned shape.
- teachFollowup over-promise (`confirmed_count` TOTAL vs the gate's distinct/shape) = **separate Slice
  B**, switch-coupled (out of scope here). Do NOT ship the "will auto-file" copy ahead of the switch ON.

## The seam (verified preserved)
- **Company/identity key (Ironbridge N2, `:701-708`):** override keys on the ref key; `supplier_name`
  is a `COMPANY_KEYS` role, never the ref key → keeps `'constant'` set-membership. Pinned.
- **Date role:** STRICT_TYPE `'date'` returns at `:982` BEFORE the role branch; override never keys on
  `date_field_key`. The 09-09 Copperfield silent-wrong-DATE M class (an at100-path issue) is NOT
  widened. Pinned.
- **Live backstops still in front of the widened auto-file:** the 88 critical-field floor,
  `trust_role_disagreement_refuse` (mig 93, **ON** — the sub-100 `_pageFamilyDisagrees` refuse; NOT the
  DARK mig-152 at100 belt), and the no-`validation_note` requirement.
- **Residual (parity, not new):** a wrong-but-code-shaped ref (`INV-45153`←`INV-45152`) that survives
  the note check + 88 floor + a **common-mode** misread (no page-family disagreement) can file silently
  — identical to what every numeric (`'digits'`) ref role + the at100 path already accept today. The
  finer per-scope prefix/digit-run skeleton (reggie) would narrow it below parity → **deferred** behind
  its own gate.
- **Sibling site `:1301-1302`** (crit-floor `<88` corroboration relax) still uses `fmt.cls` for the ref
  — inert on Thornbury (@98 > 88), fail-safe when entered. Left intentionally inconsistent + commented +
  pinned so nobody folds it into the corrob-relax seam without its own vet (Oracle C4).

## ⚑ FLIP GATE (owner-owed, before any customer default)
1. **Unit pins** — `database/modules/test_scope_trust.js §25` (14 pins: heal ON files / OFF refuses,
   `classifyRefShape` contract, anti-over-file garble blocks, identity-seam new-supplier blocks,
   date-role invalid still blocks, mixed-history → Review incl. the Correction-2 repeat-now-blocks) +
   `test_migration154_ref_role_shape.js`. **GREEN.**
2. **Corpus** `realdoc_regression.js` OFF vs ON → **M=0** AND **zero per-field accuracy drop**;
   would-file COUNT expected to rise — the gate must **inspect every NEW would-file's ref against
   confirmed GT and FAIL if any ref ≠ GT** (a count-only green manufactures false confidence, Oracle C5).
3. **Live-DB re-judge** (the real efficacy proof — the 605-corpus likely can't reach the 2-distinct-
   duplicate case; HYPOTHESIS): re-judge the 20 held Thornbury docs → all flip to would-file, ref ==
   confirmed read; scan the whole install for any new would-file whose ref ≠ the correct read.
4. Oracle.

## Note — the WS-68687 "batch-leftover countdown" report
The owner's suggestion ("after a batch autofile, the last eligible doc shows the countdown + files") is
already built + armed: `sweep_inview_recheck` (mig 150, in the -TEST build) re-runs
`isAutoFileEligible` on view-settle and starts the countdown. It correctly did NOT fire for WS-68687
because that doc was genuinely NOT eligible at 97% (this same ref-role bug). Once `trust_ref_role_shape`
is ON the doc is eligible at 97%, and the recheck lights the countdown on open — no Reprocess needed.
