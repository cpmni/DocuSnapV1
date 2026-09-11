# Ref-role letter/digit confusable flag (design, 2026-09-11) — Chris Card 1 (SO→S0)

> **STATUS: BUILT DARK — reggie + gary + Oracle SIGN OFF WITH CONDITIONS C1-C5 (folded in). Seed OFF;
> owner-gated flip (census owed).** Ships behind `ref_confusable_flag` (env `REF_CONFUSABLE_FLAG`),
> byte-identical OFF. Fixes the 2026-09-11 Chris Card 1: a scanned new-supplier Sales Order read its ref
> `SO-47966` (letter O) as `S0-47966` (digit 0), a valid shape with no history → no flag →
> auto-file-eligible → wrong filename, lost on search. Advisors: reggie (predicate), gary (gate/census/
> tests), Oracle (vet). Log: `docs/oracle_log.md` 2026-09-11. **See "BUILT" + "Oracle conditions" at the
> bottom** — the mig-149 ordering rationale below was CORRECTED by Oracle C1 (the disarm, not the
> note-skip, is the seam guard) and the disarm primitive changed to `any_confirmed_shares_head`.

## Exhibit (root-caused, verified at the pixels + text layer)
`Vellum&CraneStationers_sales_order_06.pdf`. Page prints "Sales Order No. **SO-47966**" (letter O).
Field holds "**S0-47966**" (S + digit-0), SALES ORDER NUMBER "High · 88%", **no note**; held only on an
unrelated issuer sender-check. **Text layer len 0 → pure scanned image → an OCR O→0 confusable.** New
supplier ("Not seen before") → no confirmed history.

## Root cause (why every existing guard is inert)
The class is **genuinely uncovered**. Every shipped confusable guard is RELATIONAL — read-vs-read or
read-vs-history:
- `filing_sanity_confusable_soften` (mig 147/148) + `_confusable_prefix_backed` / `_prefix_autofile`
  (mig 149) live inside the branch that runs only after **Gate C decides the ref is ABSENT**
  (`engine.py` `_ref_corrob_soften` "called ONLY after Gate C decided a reference is absent"). Here the
  whole-page OCR misreads O→0 **identically** to the crop, so `S0-47966` is "present as written" → Gate C
  never fires.
- `near_miss_confirmed` / `unambiguous_near_miss` / `confusion_correct` all read `value_counts` /
  `confusions` — empty for a new supplier.
So a self-consistent whole-page misread on a new supplier defeats both axes. `S0-47966` is a VALID
`alphanumeric`/`reference_code` shape → no format anomaly either. **The missing lever = an unconditional,
history-independent, value-shape confusable check on the ref role** — a 5th member of the S-A/prefix/S-B/D1
content-nature ref-flag family.

## The predicate (reggie) — `ref_confusable_class_outlier(value, prefix_set) → {pos, from, to_letter, rule} | None`
Pure/deterministic, value-only. Home: `format_anomaly_checker.py`. **Reuses the existing pinned table
`_PREFIX_CONFUSE_CLASSES` (engine.py:2116)** — no new map. Tokenise on `_REF_SEPS` (`- / . _` + space).

- **Confusable classes, tiered** (digit ← letter forms; each class one digit): tier-1 ON `0←O,o,Q` ·
  `1←I,i,l,L` · `5←S,s`; tier-2 ON `2←Z` · `8←B` · `6←G`; tier-3 census-gated `9←g,q` · `7←T`. Exclude
  lowercase forms except `l`/`o` (refs are conventionally uppercase; lowercase adds FPs). Tunable.
- **Rule A — interior class-outlier (standalone):** within a token, a single-char class subrun flanked on
  BOTH sides by the opposite class, the char a confusable of that opposite class, AND ≥1 flank run ≥2 long
  (the precision valve — rejects alternating `A1B2C3`). Catches a letter-`O` inside a digit run, etc.
- **Rule B — prefix class-outlier (the exhibit):** `A` = leading pure-ALPHA run of token 1 (`S0`→`A="S"`);
  `P` = the canonical alpha-prefix set for this `ref_field_key`, **derived from
  `keyword_patterns.json` field_patterns[key].labels** (`sales_order_number`→`{SO}`, `po_number`→`{PO}`,
  `delivery_number`→`{DN}`, credit→`{CN}` — no new hardcoding). If the leading `len(p)` chars can be
  "spelled" by some `p∈P` under at-most-confusable substitution with **≥1 digit-standing-for-a-letter** →
  FLAG at that position. Exhibit: `S0`, p=`SO` → `S`==`S`, `0`=letter-confusable of `O` → FLAG.
- **Precision (proven cases):** does NOT flag `SO-47966`/`INV-88669`/`PO-4821` read correctly (class-pure),
  all-digit refs with legit `0`, job-no `1234-5678-9` (4-4-1), VAT `GB123456789`, trailing check-letters
  (`12345K` — Rule A is INTERIOR only), `A9-100`/`S5-100` (prefix flip ≠ SO).
- **NO JS renderer twin (deliberate):** `S0-47966` is a valid SHAPE; the on-blur `validation_patterns`
  check must keep accepting it so a human can type a legitimately-`0` ref. A renderer twin would over-reach
  and block valid hand-edits. The JS↔Python alignment rule is satisfied by NOT adding one — stated so
  nobody "aligns" it later.

## The gate (gary) — `_flag_ref_confusable_ambiguous`, DARK `ref_confusable_flag`
- **Seam already closed, zero trust.js change:** `isSoftAdvisory` returns false when `roleKeys.has(key)`
  (trust.js:540-544); `roleKeys` includes `ref_field_key` (`_flaggedSoftAware` :577-590) → a note on the
  ref role → `isAutoFileEligible` = `{eligible:false, reason:'flagged'}` (:1250-1261) AND
  `docTrustGate` (:1017-1019), **even with `optional_soft_flag_autofile` (mig 142) ON** (the mig-142
  soft-clear only reaches OPTIONAL non-role non-strict fields). Belt: `reference_code` ∈ `STRICT_TYPES`.
  So no sentinel, no `isXFlagRow` carve-out (unlike mig 155/156).
- **Site & ordering:** call in `engine.py` **after `_apply_confusion_precedence` (:11525) and before the
  confidence BOOST (:11527)** — a no-history FALLBACK: if any history arc already wrote a note/`corrected_to`,
  skip (one-note-per-field); fill only when nothing else resolved it; before the boost so the ≤69 cap can't
  re-lift. Receives the true `ref_field_key` (like D1 :11509).
- **Logic:** env-gated + `ref_field_key` present; skip if method has `manual`/`template_fixed` (human/
  authoritative literal — authority-precedence invariant intact, flag never edits a value); skip if the
  field already carries a note or a pending `corrected_to`; skip if `not is_ref_confusable_ambiguous(val)`;
  **skip if born-digital (text-layer page)** — a printed `0` there is real, not a misread (confirm the
  born-digital signal is readable at the site); **GLYPH-ATTESTATION DISARM** — skip if the scope ATTESTS
  the read's glyph at the tripping position (uses reggie's `pos`). Else cap conf ≤69, set
  `validation_note` "…a letter/digit OCR often confuses (O/0, I/1, S/5) — please check the reference
  against the page before filing." Wrap try/except pass (advisory; a broken extraction is worse than a
  missed flag).
- **Scope = ref role ONLY** (`ref_field_key`): (a) harm is filename-specific; (b) keeps the note in
  `roleKeys` → blocks with no trust.js change; (c) one flag per doc, not per code field (Chris Card 2).
- **Anti-batch-stall (the design's whole point):** NOT new-supplier-only. Fire when the predicate trips AND
  the scope does not attest the read's glyph at that position. New supplier → trivially fires (exhibit).
  Repeat supplier who legitimately uses that glyph → once ONE ref with that glyph at that position is
  confirmed, attestation disarms all future same-shape refs → **no stall**. `value_is_confirmed_literal` is
  deliberately NOT the disarm (vacuous on a high-cardinality ref). Mirrors mig-156 `accepted_names` +
  `_confusion_from_attested` (format_anomaly_checker.py:807).

## Plumbing
- **mig 159** seeds `ref_confusable_flag` = `'false'` (the mig 156/157/158 pattern, `database/index.js`);
  add `'ref_confusable_flag'` to `TEST_SWITCH_KEYS` (`dark_switches.js`, 42→**43**) → the release gate
  forbids UPSERT-to-'true' + mig-137 resets on a customer build; armed only by the `-TEST` build.
- Setting→env: one line in `handler.js` (~:319) — `if getSetting=='true' env.REF_CONFUSABLE_FLAG='1'`
  (per-call read; harness arms via env). Byte-identical OFF.
- **note topic = the mig-158 `note_topic_dedup` O/0-confusable-ref topic** — same topic signature so, if both
  flip, stacked reprocess notes dedup instead of forming the wall mig-158 exists to prevent.
- Go-forward only — no rewrite of existing extractions rows.

## Invariants / seam
- RELIES ON: reggie's predicate being pure/precision-first AND exposing the tripping **position** (RESOLVED
  — it returns `{pos,…}`); `ref_field_key` non-null + in `roleKeys` (mig 92 guarantees the role).
- CHANGES: a flagged ref is skipped by the boost that run (intended — held) and by the later DARK
  resolver/soften arcs (we run AFTER them → they get first refusal). Disables NO other safety (no trust.js
  edit, Gate C untouched, soften/prefix arcs untouched). `wouldFile(ON) ⊆ wouldFile(OFF)` by construction
  (a flagged doc was previously auto-filing-silently OR already held elsewhere).
- Fail-safe: null `ref_field_key` → method returns, nothing to misfile.

## Tests (each proven to FAIL with the guard removed)
- Python `test_ref_confusable_flag.py`: (1) `S0-47966` new supplier ON → note + cap ≤69; (2) OFF
  byte-identical; (3) legit all-digit `0047966` → no note; (4) `manual`/`template_fixed` confusable → no
  note; (5) one-note-per-field; (6) **attestation disarm** — scope attests `0` at that position → no note
  (anti-batch-stall pin); (7) history attests only letter-`O` → `S0-…` still flags.
- JS `test_scope_trust.js`: the **anti-silent-file PIN** — a ref-role `validation_note` + mig-142 ON +
  graduated scope → `{eligible:false, reason:'flagged'}` (pins that a ref-role note is never soft-cleared,
  so a future `isSoftAdvisory` "simplify" can't restore the silent file).
- Migration pin (`test_migration137_test_switch_reset.js`): `ref_confusable_flag` in `TEST_SWITCH_KEYS`,
  seeds 'false', reset on release.
- **Pinned trade-off:** a first-time-unconfirmed confusable ref from a new supplier DOES flag→review by
  design (stops anyone re-admitting the silent file under a "reduce holds" banner).

## Census (make-or-break — this ADDS holds) + flip gate
`tools/ref_confusable_census.py` — engine over 605 + Demo Docs, OFF vs ON, diff the ref-role note set:
- **newly_flagged** = the warning-fatigue exposure (Chris Card 2), split **scan vs born-digital** (digital
  should be ~0 — a nonzero digital count = a false-alarm smell).
- Adjudicate each **at the PIXELS, not blindly vs GT** (corpus GT is confirmed values → may be a rubber-stamp
  of the WRONG glyph). Classify TRUE confusable (ON-read differs from the page by exactly a confusable) vs
  FALSE alarm (page really prints that glyph).
- **Flip gate:** newly-flagged dominated by TRUE confusables, near-zero false alarms (esp. near-zero on
  born-digital + on repeat suppliers — the latter proves the attestation disarm works), realdoc **M=0**,
  zero per-field accuracy drop, `wouldFile(ON) ⊆ wouldFile(OFF)`. If false alarms cluster on repeat
  suppliers → tighten the position seam with reggie before flip.

## Open for Oracle
- The premise + the ordering (fallback after the history arcs) + the seam (roleKeys already blocks; no
  trust.js edit) — trace them.
- Born-digital gate: confirm the signal is readable at engine.py:11525 (reggie/gary flagged as a build
  precondition).
- The attestation-disarm precision (repeat-supplier false-alarm risk if the position model is loose).
- Whether ref-role-only is the right scope, or a strict `reference_code` OPTIONAL field also warrants it
  (gary argues ref-only to avoid the mig-142 sentinel surface).
- HYPOTHESES the harness can't reach: a mis-resolved-supplier ref judged vs the wrong scope's history; a
  confusable font/layout not in the corpus.

## Oracle conditions (SIGN OFF WITH CONDITIONS, 2026-09-11 — all folded into the build)
- **C1 (the design's mig-149 rationale was WRONG — corrected):** mig-149 (`_confusable_prefix_backed`) clears a
  confusable to auto-file with NO note/corrected_to, so the "skip if note/corrected_to set" protects NOTHING.
  The real guard is (a) mig-149's committed value uses the LETTER prefix `SO-` (Rule B needs a digit-for-letter →
  doesn't trip) and (b) for a genuine-digit-prefix supplier (`S0-` dom) the ATTESTATION DISARM. The disarm must be
  **head-based + length-AGNOSTIC** — built with `ocr_corrector.any_confirmed_shares_head(value_counts, head)`
  (the SAME primitive mig-149's mirror guard uses), NOT the length-blind `_confusion_from_attested` (Rule A
  interior keeps the position-specific `_confusion_from_attested`). Pinned length-agnostically (test_6: a
  DIFFERENT-length confirmed sibling sharing head `S0` disarms; test_7: a letter-only `SO` history still flags).
- **C2 (owner-owed at flip):** the census must add a cell **mig-149 ON + ref_confusable_flag ON** over a
  genuine-digit-prefix repeat supplier (synthetic fixture if the 605/Demo have none) proving `wouldFile` unchanged.
- **C3 (built):** born-digital gating is per-page — the gate flags only when every page's provenance is `'ocr'`
  (`page_provenance` is in scope at the site); never flags a born-digital-read value; unknown provenance → no flag.
  Pinned (test_8).
- **C4 (built):** the 9 python gate pins + the JS anti-silent-file seam pin (§28, `test_scope_trust.js` — a ref-role
  note blocks auto-file with NO sentinel even under `softOptionalNonblock`) + the mig-137 reset @43.
- **C5 (owner-owed flip gate):** newly-flagged dominated by TRUE confusables adjudicated AT THE PIXELS (corpus GT
  may rubber-stamp the wrong glyph), near-zero false alarms overall + near-zero on born-digital AND repeat
  suppliers (proves the disarm releases), realdoc M=0, zero per-field accuracy drop, `wouldFile(ON) ⊆ wouldFile(OFF)`.
- **Minor (fixed):** the predicate reuses the reviewed `_is_letter_digit_confusable` map + a tier/case FILTER
  (`_REF_OUTLIER_LETTERS`, tier-3 `7/T`,`9/g` out of v1) — NOT the raw `_PREFIX_CONFUSE_CLASSES` verbatim. Confirm
  the mig-158 note-topic signature matches when both flip (harmless while either is OFF).

## BUILT (DARK, seed OFF)
- `format_anomaly_checker.py` — `ref_confusable_class_outlier(value, prefix_set)` (Rules A+B) + `ref_canonical_prefixes(labels, known)` + the `_REF_OUTLIER_*` filter helpers.
- `engine.py` — `_flag_ref_confusable_ambiguous(...)` (gate: env `REF_CONFUSABLE_FLAG`, exempt manual/template_fixed, one-note-per-field, C3 born-digital, C1 `any_confirmed_shares_head` disarm for Rule B / `_confusion_from_attested` for Rule A, cap ≤69 + note); called after `_apply_confusion_precedence`, before the boost.
- `database/index.js` mig 159 seeds `ref_confusable_flag='false'`; `dark_switches.js` adds it to `TEST_SWITCH_KEYS` (43); `handler.js` setting→env `REF_CONFUSABLE_FLAG`.
- Tests: `python_backend/tests/test_ref_confusable_flag.py` (9/9), `test_scope_trust.js` §28, `test_migration137_test_switch_reset.js` @43 — all GREEN.

## Census / flip (owner-owed)
Run realdoc OFF vs ON with `RR_CONSENSUS` to diff the ref-role note set (env `REF_CONFUSABLE_FLAG=0` vs `1`,
`RR_APP_ENV=0 OCR_RENDER_DPI=200`), split newly-flagged scan-vs-born-digital, adjudicate at the pixels; add the
C2 mig-149-both-ON genuine-digit-prefix cell. Then flip per C5 → Oracle re-vet before a customer default.
