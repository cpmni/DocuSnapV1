# Anchor/keyword label matching should tolerate punctuation between words

Date: 2026-07-25 · Branch: feat/reprocess-throughput-autostraighten · Author: Claude (Opus 4.8)

## Symptom (owner, traced on worksheet_06 / doc 549)
A taught `customer` anchor with label **"Site Customer"** is flagged *"taught position couldn't be confirmed"*
(capped @69) on every Saltmarsh worksheet, even though the value (e.g. "Bluefin Marine Ltd") is read correctly
by keyword. Reprocess trace: the anchor **"wasn't located on this page"**, so `_flag_taught_field_ownership`'s
`_anchor_corroborates` exemption can't fire → hold. (The reference_number flag in the same doc SELF-HEALS via
`late_located_corrob`; this is the lone residual.)

## Root cause
The page heading is **"Site / Customer"** (slash separator); the taught label is **"Site Customer"**.
`_label_pattern` builds `re.escape("site") + r'\s*' + re.escape("customer")` = `site\s*customer` — **whitespace-
tolerant but NOT separator-tolerant**, so the "/" between the words defeats the match. OCR/layouts routinely put
punctuation between label words: "Site / Customer", "P.O. No.", "Ref.:", "Order - Date", "Bill To:". All miss.

Three MIRROR copies (kept in sync by design): `anchor.py:3507` (Stage-2 anchor location — the reported path),
`keyword.py:821` (Stage-1 keyword labels), `template_matcher.py:813` (Stage-0 landmark labels).

## Proposed fix (kill switch `LABEL_SEP_TOLERANT`, default ON; OFF ⇒ `\s*` byte-identical)
Change the inter-word join from `\s*` to a **separator class** `[\s./:,\-]*` (whitespace + slash, dot, colon,
comma, hyphen). Applied to all three `_label_pattern` copies (sync invariant). **NOT** `_type_keyword_pattern`
(doc-type detection — separate risk surface, out of scope).

**Why it's safe:** the class contains **no alphanumerics**, so it can only bridge a run of separator chars
between two label words — it can NEVER cross letters/digits. `Bill[\s./:,\-]*To` matches "Bill / To" / "Bill: To"
but NOT "Billing To" (the "ing" after "Bill" is not in the class) and NOT "Bill 123 To". Single-word labels are
untouched (they use the word-boundary guard, not the join) — so the "Total"⊂"Subtotal" class of guard is unaffected.

## Blast radius / gate
- Stage-0 landmark + Stage-1 keyword + Stage-2 anchor label location. Multi-word labels only.
- Gate: corpus `realdoc_regression.js` ON vs OFF — **M=0, zero accuracy drop**; OFF byte-identical.
- Unit (`tests/test_keyword_label_guard.py`): "Site Customer" now matches "Site / Customer"; "P.O. No" matches
  "P.O. No."; the existing single-word guards (Total/Date/From) still hold; a multi-word label still does NOT
  cross alphanumerics; OFF byte-identical.

## GATE OUTCOME (2026-07-25): DO NOT BUILD — premise broken by reggie, confirmed by trace

**reggie's premise-break:** the taught-anchor LOCATION path does NOT use `_label_pattern` — it uses the fuzzy
`_label_score` (SequenceMatcher), and `_label_score("site customer","site / customer") ≈ 0.93 > 0.6`, so
**location already tolerates "/"**. The ONLY `_label_pattern` consumer that emits a located candidate is the
Stage-2 full-page text-fallback (`anchor.py:999`, `if not value`). So the separator fix is only a marginal
text-fallback parity improvement — it does **NOT** fix the reported customer @69 cap.

**Confirmed by re-tracing doc 549:** Stage-2 anchor produced NO customer candidate; `late_located_corrob`
lifted date + reference_number (direction "right") but NOT customer. `_filter_located_corrob` (engine.py:191,
C1) only vouches for methods `{anchor_inline, anchor_crop_relocated}` + `located` — the customer anchor is
direction **"below"** and isn't producing a candidate that clears that filter. THAT is the real cause of the
customer hold, and it is unrelated to `_label_pattern`.

Both reggie and Oracle SIGNED OFF WITH CONDITIONS on the separator change *in isolation* (it's sound + safe:
value-gated fail-safe, class `[\s./:,\-]*`, no `|`), but reggie's load-bearing caveat — "re-trace doc 549;
do not treat corpus M=0 as proof it fixed the symptom" — is decisive: it's a no-op for the owner's complaint.

**Decision: NOT built.** Options for the actual customer cap: (a) accept the review-noise (the value is correct,
held for a quick check — fail-safe working); (b) re-teach the customer anchor; (c) a deeper fix so a "below"-
direction taught anchor can corroborate in the late_located_corrob pass (separate design, its own gate). The
separator-tolerance change is PARKED (marginal, symptom-irrelevant); revive only with a real motivating case.

## (original) Questions for the gate
- reggie: is `[\s./:,\-]*` the right class (too tight / too loose)? Any false-match class it opens? Should all
  three copies change together, or is a shared helper better? Is `-` inside the class positioned safely (end)?
- Oracle: blast across Stage 0/1/2 label matching; does a looser label bridge ever let a WRONG label win a
  first-match (e.g. a generic label now spanning into a neighbouring caption)? Fail-toward-review preserved?
