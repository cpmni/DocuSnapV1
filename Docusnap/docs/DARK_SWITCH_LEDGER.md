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
Two fixes PASSED (M=0 + a real fire + a clean file→hold): **`ref_confusable_flag` (159)** and
**`name_role_nonname_flag` (156)**. `format_class_join` is M=0 but showed a broader blast radius than its pins
claim (re-arms total-format checks on unrelated invoices) → stays WAITING pending a look. `trust_ref_role_shape`
(154) + `template_drift_override_guard` (157) safety-passed on the synthetic set (M=0); their efficacy is the
live re-judge already done 2026-09-10.

**2026-09-16 UPDATE — the two passers were RE-CENSUSED at the current code (mig 171) and FLIPPED ON.** Same
corpus (a migrated copy), same method, identical results to 09-12: 159 = M=0 / 6 fires / 2 file→hold; 156 = M=0 /
5 fires / 1 file→hold; neither changed a single value or let anything new auto-file. With the owner's go they
became customer defaults — **mig 172 (`name_role_nonname_flag`) + mig 173 (`ref_confusable_flag`)** — and left
the dark list. The same run re-checked two more: `deskew_corrob_autofile` did nothing on this corpus (stays off);
**`template_pad_date_adopt` passed for the second time** (M=0, its one change = the correct date, twice) and the
owner flipped it too — **mig 174**. Then `watch_separate_enabled` (mig 175) after its soak was actually run. Two
NEW dark keys landed the same day (migs 177/178, the scanned-stack splitting fixes below). **48 keys are dark.**

---

## 🟢 READY — safety test passed, awaiting your go (2)
- ~~**watch_separate_enabled**~~ — **✅ FLIPPED ON 2026-09-16 (mig 175)** after the soak was actually RUN (the 09-12
  "Soak test PASSED" line had no run behind it — corrected the same day). Result: analyzer PASS (16 bundles split,
  no loop / loss / error), the real 34-page bundle 34/34, 0 genuine single docs over-split, every produced segment
  held and none auto-filed. Full record: `TESTING/_measure/watch_separate_soak_20260916/RESULT.md`. See DONE below.
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
- ~~**name_role_nonname_flag**~~ — **✅ FLIPPED ON 2026-09-16 (mig 172)** — see DONE below.
- **note_topic_dedup** — collapse a wall of duplicate "check this code" notes into one.
- ~~**ref_confusable_flag**~~ — **✅ FLIPPED ON 2026-09-16 (mig 173)** — see DONE below.

**Dates:**
- **date_forms_wide** (2026-09-14, mig 167) — read a written-out date however it is punctuated: "23rd Aug 2026", "23, aug 26", "23-aug-26", "23.Aug.2026", "Aug. 23 2026", "23 Sept 2026", an OCR-glued "23Aug2026", with or without a leading day name. Only dates with a month NAME (numeric dates untouched). The desktop confirm door and the Review/Teach readers take these forms already, switch or not; this switch is the reading engine's half (credibility gate + keyword qualification + parse). Test (Oracle C5): the 605-doc M=0 + would-file set-equality OFF vs ON, plus the crop/keyword acceptance census OFF vs ON where every NEW acceptance is checked by eye against the page (a wider pattern must only ever admit a real date); run with the mig-166 date fix in its shipping (off) state so the two date fixes are measured apart. Then your go.
- **template_date_left_clip_grow** — recover a date whose leading digit was clipped.
- **template_pad_date_containment_flag** — flag a taught date box that's clipping a digit.
- **template_clip_commit_left_slack** — don't false-flag a correctly-read date with a clipped edge.
- ~~**template_pad_date_adopt**~~ — **✅ FLIPPED ON 2026-09-16 (mig 174)** — see DONE below.
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

**Scanned-stack splitting (2026-09-16, both built after the watch soak; `docs/designs/SEPARATOR_ACCURACY_2026-09-16.md`):**
- ~~**segment_continuation_veto**~~ (mig 177) — **✅ FLIPPED ON 2026-09-17 (mig 181), owner's go.** A page that says it is a
  continuation ("Page 2 of 2", "continued", "brought forward") is never cut off as its own document. Fixed a
  pre-existing silent truncation: a multi-page invoice whose page 2 repeats the letterhead was cut in two (6 of 6 test
  controls), and on a manual import page 1 filed as a one-page invoice with page 2 lost as an orphan. _Census: 0/14
  controls cut (was 10), nothing lost on the stacks, the 34-alert bundle unchanged, end-to-end truncation 0
  (RESULT.md "e2e"). See DONE below._
- **segment_title_slug** (mig 178) — the splitter now reads each page's own printed title before matching it to a
  template, so a supplier's less-common document types (a sales order after a worksheet from the same letterhead)
  are cut correctly instead of riding on the previous page. _Census: 72 → 79 of 95 boundaries, none lost, no new
  over-splits; the Oracle's feared side-effect on logo-only continuation pages measured 0. Flip gate: the same
  truncation count + the owner's go (the Oracle's alternative condition — a 0 delta on those controls — is met)._
- **segment_known_supplier_change** (mig 179, 2026-09-17) — when a page in a scanned stack carries the name of one of
  YOUR OWN known suppliers (a company you have confirmed at least three times, or one of your taught layouts) and it is
  a different company from the page before, plus an invoice/order/docket number or date label, the splitter starts a
  new document there. Closes the case where a stack of documents from suppliers you have not taught a layout for was
  never split at all — it imported as one file and filed under the first page's company. Guards: junk names ("PT",
  "ME", "Chris Docs") never count; a "c/o …", "Delivered by …" or "Bill To" mention never counts; a name in the items
  table never counts; the same company with "Ltd" added is the same company; a page that says "Page 2 of 2" is never
  cut. _Census + end-to-end run: `TESTING/_measure/watch_separate_soak_20260916/RESULT.md` "Arc 3". Flip gate (Oracle
  C4-C6): every control set 0 over-splits with the shipped code + the stacks ≥ 91/95 with nothing lost + the 34-alert
  bundle 34/34 + the end-to-end run with all three splitter switches (no truncated cut, filed OR held) + your own
  multi-page PDFs re-planned OFF vs ON with every difference reviewed. Owner's go. RESULT 2026-09-17: stacks 91/95
  with nothing lost, every control set clean, your own PDFs unchanged except the wrongly-merged cuts, the end-to-end
  run added no truncation and the un-split whole files filed exactly as before — gate green for THIS switch. The same
  run also caught a PRE-EXISTING problem in today's shipping code: a 2-page order whose second page repeats the
  letterhead with no page number was cut in two and its page 1 FILED as a complete document (page 2 left in Review).
  That is not this switch; it is the next fix (pendingfeatures.md 2026-09-17)._
- **segment_pair_hold** (mig 180, 2026-09-17) — the fix for that last case. When the splitter cuts a page off on the
  strength of the LETTERHEAD ALONE (no address block, no email header, no different company on the page — the app now
  tags such cuts "weak"), the two halves are compared after both have been read: the same company, no date on the
  later page, and the same document number (or none) means "probably one document", so BOTH halves wait for one look
  with a note naming the other page and saying where the original scan is kept. A later page with its own number and
  date is a document of its own, so the earlier page is released to file as normal. Your Print Tracker alert bundle is
  never touched (every alert page carries an email header, so none of its cuts are "weak"). Trade accepted: a scan that
  was fed in twice in a row (same number, same date) now gets one look instead of filing as a -DUPLICATE. _Census with
  the shipped code (`weak_cut_census2.py`): the 4 exhibit cuts weak, 0 genuine cuts held (the ~22 weak genuine cuts on
  the stacks all read their own number + date → released), the 34-alert bundle 0 weak. End-to-end run
  `e2e4_result.txt`: no truncated half filed or unmarked. Flip gate (Oracle C9 + C12): the rasterised-bundle cell, a
  young-install stack cell, the "email-header-only" class arm, every sibling false cut held under 178+179+belt — AND a
  one-click "Re-import as one document" / Rejoin action shipped first, because today the only way back is the hidden
  `.sf_separated_originals` folder. Owner's go._

## ⚪ PARKED — measured to do nothing on current docs; stays off unless a real case appears (1)
- **anchor_axis_lock** — reconstruct a free-text value's left edge from the label column. _Censused zero fires; needs a real docket corpus before it's worth flipping._

---

## ✅ DONE — already turned on and shipping (for reassurance)
**2026-09-16 (mig 176) — `split_segment_multipage_hold`, a NEW belt that shipped ON from day one (not a dark seed):**
when the app splits a scanned stack into documents and one of the cuts has more than one page, that cut now waits
for one look before filing — because the splitter sometimes misses a boundary and leaves a stranger page riding
behind the first one (the soak caught it; with the belt off a manual import filed **12 of 16** such cuts at 100 %,
each one another company's page bound inside the wrong PDF). One-page cuts and cuts made with separator sheets are
untouched (the 34-alert stack still files with one click). Review says why ("pages 2–3 were cut from a multi-document
scan… use Split") and Confirm clears it. Off switch: `split_segment_multipage_hold = 'false'`. What it can NOT see: a
stack the splitter never cut at all (only page 1 recognised) still imports whole — that is the splitter's accuracy,
a separate item. Design record: `docs/designs/SPLIT_SEGMENT_HOLD_2026-09-16.md`.
**2026-09-16 (migs 172/173):** **name_role_nonname_flag** — a "name" field that is really a bare postcode / email /
VAT number / IBAN is now held for a look instead of filing silently (census: 5 fires, 1 held, nothing broken, twice);
**ref_confusable_flag** — a reference with an O-vs-0 / I-vs-1 / S-vs-5 look-alike in the wrong place is now held
instead of filing under a wrong name (census: 6 fires, 2 held, nothing broken, twice); **template_pad_date_adopt**
(mig 174) — a taught date box that clipped the first digit now takes the wider read when the page backs it up, so
the correct date files instead of waiting (census: one swap, it was the right date, twice); **watch_separate_enabled**
(mig 175) — a bundled scan dropped in the WATCH folder is now split into its documents like a manual import, each
one held for a look (soak: real 34-page bundle 34/34, nothing lost, nothing looped, nothing over-split, nothing
filed unseen); **segment_continuation_veto** (mig 181, 2026-09-17) — a page that says "Page 2 of 2" / "continued" /
"brought forward" is never cut off as a separate document, so a two-page invoice that repeats its letterhead stays
whole (census: 0 of 14 controls cut, nothing lost, end-to-end truncation 0). All five still switchable off. Earlier: **filing_sanity_confusable_soften** (reclassify a
one-glyph confusable — census passed, shipped), **ocr_parallel_import_enabled** (faster imports), **money_sign_capture**
(read `CR` / parentheses as a credit sign). The pad-window reads that make clipped crops read correctly
(**template_pad_window_read/code**) and the projection-variance straightener are also on by default. So the pipeline
*is* delivering fixes to customers — the dark list is the queue behind them, not a graveyard.

---

## Not built (decided against, for completeness)
- **The auto-file "release" leg** of the false-absent fix — Oracle DO NOTHING (would be inert + could misfile). Parked.
- **The suspect-code label re-read arc** — Oracle DO NOTHING (premise false: the value was already shape-valid). Parked.
