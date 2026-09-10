# NAME_ROLE_NONNAME_FLAG — deterministic non-name guard (mig 156, DARK)

reggie + gary → **Oracle SIGN-OFF-W/COND**. Built DARK. Kill switch `name_role_nonname_flag` /
env `NAME_ROLE_NONNAME_FLAG`, in `TEST_SWITCH_KEYS`. Byte-identical OFF.

## The defect (verified live)
ScanFinder auto-filed Vellum & Crane sales orders with `customer_name = CH1 2HU` (a UK postcode) @92-94%,
no flag. Cause: a Stage-0.5 **template_mapping** zone drifted onto the postcode line of the multi-line
"Customer" block (name / street / city / postcode). `customer_name` is **optional** (COMPANY_KEYS =
['supplier_name'] since mig 44) so it never gates auto-file; the *required* fields read perfectly → overall
100 → gate-free auto-file → the wrong optional value rides along **silently**. A Stage-0.5 read is
authoritative/label-confirmed → exempt from every existing name-quality gate; the structured-type flag loops
explicitly **skip** name fields; the wordness gate self-disables (word_like-gated, `not _authoritative`,
soft, caps-not-blocks). So a postcode-as-whole-value in a name field was checked by **nothing**.

## The fix — a deterministic content-nature belt
A NAME-ROLE field (`is_name_like_field`: customer/supplier/client/vendor/payee/…) whose **whole** value
deterministically matches a non-name shape is flagged + held.

- **Predicate** `value_quality.nonname_structured_match(value, validation_patterns)`: `re.fullmatch` (whole
  value, case-insensitive) of `value.strip()` against the SHARED `validation_patterns` — **`postcode_uk`,
  `email`, `vat_gb`, `iban`** (Oracle C1). No new literals. Deliberately EXCLUDES bare-number / currency /
  reference_code / percentage / date (a bare number is a legitimate recurring name-like value; those
  patterns are loose/un-anchored → would stall legitimate batches). Whole-value anchoring immunizes a name
  that *contains* a postcode ("Beaumont Care CH1 2HU" → None).
- **Guard** in the Stage-4.5 content-flag family (`engine.py`, right after the wordness gate): placed like
  the wordness gate but **without** its `not _authoritative` / `word_like` conditions — deterministic
  content-nature applies to TAUGHT reads (the CLAUDE.md invariant, same class as date-in-ref S-A /
  ref-length S-B / prefix-outlier), and it fires even when the wordness gate is OFF. **FLAG+HOLD**: keep the
  value (it's the evidence the zone drifted), append the **`+nonname_flag`** method sentinel (never a new
  key — the `template_mapping`/`anchor_*` prefix survives for `_method_family`), cap conf ≤69, route to
  review (`format_anomaly_flagged` → `needs_review`).
- **Exemptions (Oracle C2 — the strongest condition):** curated/human methods
  (`template_fixed`/`override`/`fixed`/`manual`/`+confirmed_adopt`/`+name_snap`) **and** `accepted_names` /
  dominant-confirmed, so a supplier whose Ship-To legitimately holds a depot postcode, or a contact field an
  email, never stalls its whole batch. Does NOT exempt `template_mapping`/`anchor_*` (that non-exemption is
  the fix). Defers to any existing note (one-note-per-field).

## The non-soft carve-out (Oracle C3 — the mig-142 seam)
On the OPTIONAL `customer_name` a plain note is soft-advisory, so `optional_soft_flag_autofile` (mig 142)
would dissolve it and re-open the silent misfile. `trust.js.isNonNameFlagRow` keys on the `+nonname_flag`
method sentinel + a non-empty note → the note is NEVER soft-cleared, at BOTH soft-clear sites
(`_flaggedSoftAware` :576, docTrustGate :1006). The note works at ship (mig-142 default OFF → any note
blocks); the sentinel is the forward-defense for once mig-142 flips on a graduated scope. **The hold is the
NOTE, not the ≤69 cap** (Oracle C4): on an optional field the cap is UX-only — overall is scored from
required fields, so capping customer_name leaves overall 100. `supplier_name` (a role) already blocks on any
note; the sentinel matters specifically for the optional `customer_name`.

## Scope + honest boundary
Applied to BOTH name keys — a postcode read as `supplier_name` misfiles the **folder** (higher stakes). This
is a **safety belt for the deterministic subset** only; a *word-like* wrong line ("Site Office, Foundry
Lane") is invisible to it and still needs the **parked `anchor.py` below-relocate placement arc**
(`pendingfeatures.md` Larkspur, Oracle C7, POST-LAUNCH). Shipping this belt must not let that arc fall off
the backlog.

## Verification (GREEN)
- Predicate + wiring pins: `python_backend/tests/test_name_role_nonname_flag.py` (positives postcode/email/
  vat/iban; negatives Studio54/Plan9/3M/B&Q/A1 Storage Ltd/Meadowbrook Vets/"Beaumont Care CH1 2HU"; excluded
  loose shapes; env-gated / +nonname_flag append / ≤69 cap / curated + accepted_names exemptions / note-defer
  / non-exemption of template_mapping).
- Non-soft carve-out: `test_scope_trust.js §27` — control soft-clears, the `+nonname_flag` row holds under
  softOptionalNonblock (mig-142) AND OFF.
- `test_migration156_nonname_flag.js`; `TEST_SWITCH_KEYS` → 40; release gate clean.
- **Live confirmation** (Oracle non-optional): reprocess the actual `CH1 2HU` doc — OFF: value @94, no note,
  auto-files; ON: value KEPT, method `template_mapping+nonname_flag`, conf 69, note "This reads like a
  postcode, not a name — please check the value." OFF byte-identical.
- **⚑ FLIP GATE (owner-owed):** realdoc M=0 + zero per-field accuracy drop (605-corpus ON vs OFF); a fire
  census (every newly-held doc is a bare non-name value); the accepted_names batch-stall check on a real
  supplier. NOTE (efficacy hypothesis): the corpus likely can't reach the live template drift, so M=0 proves
  SAFETY, not efficacy — the live-doc confirmation above carries efficacy.
