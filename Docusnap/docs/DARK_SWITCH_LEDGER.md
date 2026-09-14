# Fix ledger — every built-but-off fix, in plain English

> **What this is:** a living, plain-English tracker of every fix that is built but switched OFF ("dark"),
> so nothing gets lost. Source of truth = `database/dark_switches.js` (the code) + `docs/oracle_log.md`
> (the verdicts). **Keep this current:** when a fix is added, flipped on, or parked, update its line here.
> Generated 2026-09-12.

## How to read the status
- 🟢 **READY** — its safety test has passed; it just needs your go to turn on.
- 🟡 **WAITING** — off, correct, and waiting for its safety test. **Most are blocked on one thing: the
  605-document test set doesn't exist yet.** Build that (in progress) and this whole group can be tested +
  turned on in batches.
- 🔵 **HELD (helping now)** — on-by-review: when turned on it *flags/holds* the hard case for you (already
  useful); its stronger "file it automatically" upgrade needs a separate test.
- ⚪ **PARKED** — measured to do nothing useful on the current docs, or found not worth it; stays off unless a
  real case turns up.
- ✅ **DONE** — already turned on and shipping (listed at the bottom for reassurance).

**The headline:** ~40 of the 47 are 🟡 WAITING on the same missing safety test. The 700-doc test set is the key
that unblocks the pile.

**2026-09-12 UPDATE — the 700-doc test set is BUILT and the first censuses have run.** `Desktop\Flip Corpus 700\`
(warm DB `warm_700.db`) is sound at the faithful operating point (ref 97% / date 99% / 179-of-400 auto-file /
0 wrong filing-field auto-files). Full method + results: `TESTING/_measure/flip_corpus_20260912/CENSUS.md`.
Two fixes PASSED (M=0 + a real fire + a clean file→hold) and are **flip-ready, awaiting the owner's go** (a flip
is a customer-default = approval-class, so it was NOT done autonomously): **`ref_confusable_flag` (159)** and
**`name_role_nonname_flag` (156)**. `format_class_join` is M=0 but showed a broader blast radius than its pins
claim (re-arms total-format checks on unrelated invoices) → stays WAITING pending a look. `trust_ref_role_shape`
(154) + `template_drift_override_guard` (157) safety-passed on the synthetic set (M=0); their efficacy is the
live re-judge already done 2026-09-10.

---

## 🟢 READY — safety test passed, awaiting your go (2)
- **watch_separate_enabled** — keeps a watched folder's imports in their own batch. _Soak test PASSED._
- **deskew_corrob_autofile** — auto-files a straighten-recovered value when two independent sources agree.
  _Census was met once, but on possibly-poisoned data — wants one clean re-run on the new corpus before flip._

## 🔵 HELD — helps you now as a flag/hold; the "auto-file" upgrade is a separate test (5)
- **template_taught_corrob_adopt** — recovers a two-sided-clipped code when the page text agrees; holds for confirm.
- **template_code_left_grow** — recovers a code clipped on its left edge; holds for confirm.
- **filing_sanity_ref_reinstate** — uses the correct on-page code over a wrong off-page taught one; holds for confirm.
- **deskew_retry_field_adopt** — the one-off straighten probe on an errored code (previewed on Ridgeway today); holds for confirm.
- **deskew_false_absent_reflag** — replaces a false "doesn't appear on this page" note with a truthful one; still held.

## 🟡 WAITING — off, correct, needs the 605-doc safety test (blocked: corpus not built yet) (~39)
**Reference/code reading (skew, clipping, drift, confusables):**
- **template_code_read_widen** — re-read a taught code wider when a wider page clipped it.
- **template_edge_clip_heal** — recover a code with a single edge glyph cut off.
- **template_drift_override_guard** — don't relocate a value onto a look-alike label (the "CH1 2HU" root cause; live-confirmed).
- **trust_ref_role_shape** — verify a reference by its learned *shape*, not a fixed list (unblocks 20 held Thornbury invoices).
- **name_role_nonname_flag** — flag a "name" field that's actually a postcode / email / VAT number. **✅ census PASSED 2026-09-12 (M=0, fires on 5 postcodes, 1 file→hold) — flip-ready, awaiting owner go.**
- **note_topic_dedup** — collapse a wall of duplicate "check this code" notes into one.
- **ref_confusable_flag** — flag an O-vs-0 style confusable in a reference so it can't silently misfile. **✅ census PASSED 2026-09-12 (M=0, fires on 6 confusable refs, 2 file→hold) — flip-ready, awaiting owner go.**

**Dates:**
- **date_forms_wide** (2026-09-14, mig 167) — read a written-out date however it is punctuated: "23rd Aug 2026", "23, aug 26", "23-aug-26", "23.Aug.2026", "Aug. 23 2026", "23 Sept 2026", an OCR-glued "23Aug2026", with or without a leading day name. Only dates with a month NAME (numeric dates untouched). The desktop confirm door and the Review/Teach readers take these forms already, switch or not; this switch is the reading engine's half (credibility gate + keyword qualification + parse). Test (Oracle C5): the 605-doc M=0 + would-file set-equality OFF vs ON, plus the crop/keyword acceptance census OFF vs ON where every NEW acceptance is checked by eye against the page (a wider pattern must only ever admit a real date); run with the mig-166 date fix in its shipping (off) state so the two date fixes are measured apart. Then your go.
- **template_date_left_clip_grow** — recover a date whose leading digit was clipped.
- **template_pad_date_containment_flag** — flag a taught date box that's clipping a digit.
- **template_clip_commit_left_slack** — don't false-flag a correctly-read date with a clipped edge.
- **template_pad_date_adopt** — swap in a corroborated wider-read date so it files instead of holding.
- **role_disagree_refuse_at100** — stop a clipped date auto-filing at a fake 100% score.

**Auto-file friction (turn a "held" doc into "filed" where it's safe):**
- **optional_soft_flag_autofile** — a soft note on an *optional* field no longer blocks filing (needs the mig-142 precondition first).
- **corrob_autofile_band88** — auto-file a fully-corroborated doc in the 88–95 confidence band.
- **filing_sanity_confusable_prefix_autofile** — when history resolves a confusable prefix, let it file.
- **buyer_issued_convention_one_confirm** — one human answer teaches "file under this company" for the batch.
- **reread_hold_corrob_release** — release a hold once a re-read corroborates the value.

**Reference softening/validation family (Sep 3–4):**
- **format_variance_relax**, **format_variance_relax_ref**, **format_variance_relax_ref_inline** — don't shape-warn a reference that a trusted family agrees on.
- **filing_sanity_ref_corrob_soften**, **filing_sanity_ref_history_soften** — soften a reference flag when live/history agreement backs it.
- **resolve_ref_near_miss**, **resolve_ref_positional** — pre-fill a confirmed reference on a unique backed slip / positional consensus.
- **confusion_precedence** — correct a never-seen serial from the supplier's own OCR-confusion history.
- **format_class_join** — stop a mixed-code field losing its whole learned format. **⚠ census 2026-09-12: M=0 + index-join proven, BUT broader blast radius than its pins claim (re-arms total-format checks on unrelated invoices → 7 review-bound total notes) — stays OFF pending a look.**

**Type / heading / layout:**
- **type_uninstalled_heading_fold** — re-detect a type from a dropped printed heading.
- **type_split_teach_scope_suppress** — stop re-asking "file as X?" for a type you already taught.
- **anchor_bare_label_fuzzy** — locate a value from a bare label by fuzzy match.
- **anchor_labelless_currency_refuse** — refuse to grab a stray number as a labelless amount.
- **inline_disagree_corrob_soften** — soften an inline-disagreement note when a family backs the value.
- **teach_angle_compose_null_abstain** — abstain safely when a template's tilt is unknown.
- **template_fragment_containment_yield** — a code fragment yields to the full code (CAD8 ⊂ CAD832694).
- **template_locate_role_qualifier** — stop a Net-Total locate stealing the wrong total.

**Names:**
- **template_name_grow_band_pick** — pick the right row when a name re-read grows.
- **template_name_cut_defer_cap** — cap a proven-cut name read for review.
- **keyword_superstring_name_note** — note a zero-OCR keyword-superstring name.

**Sweep / reprocess:**
- **sweep_inview_recheck** — re-offer the auto-file countdown when the view settles on a ready doc.
- **quick_reprocess_enabled** — the imageless quick-reprocess path (kept off; own gate).

## ⚪ PARKED — measured to do nothing on current docs; stays off unless a real case appears (1)
- **anchor_axis_lock** — reconstruct a free-text value's left edge from the label column. _Censused zero fires; needs a real docket corpus before it's worth flipping._

---

## ✅ DONE — already turned on and shipping (for reassurance)
Recent fixes that passed their test and made it into the product: **filing_sanity_confusable_soften** (reclassify a
one-glyph confusable — census passed, shipped), **ocr_parallel_import_enabled** (faster imports), **money_sign_capture**
(read `CR` / parentheses as a credit sign). The pad-window reads that make clipped crops read correctly
(**template_pad_window_read/code**) and the projection-variance straightener are also on by default. So the pipeline
*is* delivering fixes to customers — the dark list is the queue behind them, not a graveyard.

---

## Not built (decided against, for completeness)
- **The auto-file "release" leg** of the false-absent fix — Oracle DO NOTHING (would be inert + could misfile). Parked.
- **The suspect-code label re-read arc** — Oracle DO NOTHING (premise false: the value was already shape-valid). Parked.
