# watch_separate_enabled — SOAK RESULT (2026-09-16) → PASS → flipped ON by default (mig 175)

Gate: `docs/designs/WATCH_SEPARATE_SOAK_GATE_2026-09-02.md`. Run by Claude in a SANDBOX (owner: "run the soak first");
the ledger's earlier "Soak test PASSED" line (09-12) had no run behind it — this is the first real run.

## Setup (reproducible — scripts in this folder)
- Sandbox = a fresh COPY of the owner's live DB (28 templates incl. Print Tracker, 627 docs) at
  `<scratch>\soak\userData` (`soak_prep.js`: migrate → every path setting re-pointed into the sandbox — output
  `Filed`, watch `Watch`, processed '' — client API OFF, `watch_folder_enabled=1`, `watch_separate_enabled=true`,
  sandbox admin). The owner's live DB + output root were never touched. Dev app launched with
  `DOCUSNAP_USERDATA` on DevTools port 9223, signed in over CDP (`soak_cdp.py`). Dev app logs to the REPO-ROOT
  `processing.log`; this session's slice is `soak.log` (2,356 lines).
- Controlled set (`soak_bundles.py` + `soak_bundles2.py`, GT in `gt.json`):
  - `real_34.pdf` — the REAL 34-page scanned Print Tracker bundle the manual path split into 34 on 2026-09-01
  - `tb_01..08`, `tb_same_01/02` — 10 synthetic stacks of single-page SCANNED Demo Docs whose (supplier, type) IS
    templated (53 docs; the two `same` stacks = one supplier's types back to back, same logo every page)
  - `bundle_01..04`, `bundle_mp_01` — mixed stacks that include NON-templated (supplier, type) pages + one genuine
    2-page doc in the middle (the rider case)
  - `single_01..05` — genuine 2-page single documents (3 digital, 2 scanned) = the over-split control
  Dropped a few at a time (phase A, 4 files) and then ALL AT ONCE (phase B, 17 files = the concurrent-arrival case).

## Analyzer (`node stress_test/watch_separate_soak.js --log soak.log --watch-folder <Watch>`) — **PASS (rc 0)**
```
separations (banners) : 2   split PDFs: 16
batches               : 14   non-zero exit: 0
separation errors     : 0
files accepted        : 21 distinct   (>1×: 0)
re-tracked after done : 0   (recurring: 0)
.sf_separated_originals: 16   orphaned split-originals: 0
```
No re-import loop, no lost document (every input ends as segments in `Watch\Processed` + its original in
`.sf_separated_originals`), no separation error, no crash, no double-accept.

## Boundary check (`soak_check.js` vs `gt.json`; contact sheets `sheet_real_34.png`, `sheet_tb_.png`)
| set | files | boundary result |
|---|---|---|
| real 34-page bundle | 1 | **34/34 — every page its own Print Tracker alert** (= the manual path's 09-01 result) |
| genuine multi-page singles | 5 | **0 over-split** (5/5 kept as one document) |
| templated synthetic stacks | 10 | 2 fully right (5/5, 5/5); 8 under-split by 1–2 boundaries |
| mixed / non-templated stacks | 5 | every non-templated page rode on the previous document (expected) |
| segments produced / held / auto-filed | | **91 produced · 96 new docs ALL held · 0 auto-filed** |

Every under-split page was judged **"continuation"** by the separator itself (`segment_docs.py --file … ` reasons,
run directly on tb_03 / tb_04 / tb_same_01): the page did not clear the FIRST-PAGE fingerprint floor for the
template it matched (same-logo sibling types are the hard case by design — a multi-page invoice repeats its
logo). That is the separator's documented conservative rule (`ocr/segmentation.py`), IDENTICAL on manual import,
and never worse than the OFF behaviour (OFF = the whole stack imports as ONE document under page 1's identity and
auto-files at import if confident). With the flag ON such a merged segment is HELD (e.g. #633 Ridgeway worksheet
p2-3 @100 %, #698, #708, #712 — all needs_review, none filed).

## Verdict
PASS on the gate's automated criteria + the gate's own controlled bundle (the real one) + 0 over-split +
0 auto-filed. The synthetic-stack under-splits are a separator-ACCURACY limitation shared by both arrival paths,
not a property of the watch flag. Flip = mig 175 (`@DEFAULT_FLIP`, delisted, pin
`database/test_watch_separate_default_on.js`). Rollback = set `watch_separate_enabled` 'false'.

## The belt — `split_segment_multipage_hold` (mig 176, same day; gary → Oracle SIGN-OFF-W/COND C1-C10)
Same sandbox, same 22-file set (`gt.json`), the sandbox app restarted on the new code. `soak_on_check.js` buckets
every produced doc by the app's own `page_count` (the DB / drain uniquify a repeated name with a trailing `-N`, so a
name regex misreads `_split_p4-1`) and asserts: every multi-page cut marked + not filed + not eligible; no mark on
any 1-page cut or whole file.

| arm | docs | multi-page cuts | marked | auto-filed | eligible now | 1-page cuts auto-filed |
|---|---|---|---|---|---|---|
| manual import, belt OFF (old code; `manual_off.log`) | 102 | 16 | — | **12** (all @100 %) | — | 50 |
| watch, belt ON (`on_watch_result.txt`) | 104 | 14 | **14** | 0 | **0** | 0 (import-held as before; 55 already "ready" for the one-click File All) |
| manual import, belt ON (`on_manual_result.txt`, `manual_on.log`) | 104 | 14 | **14** | **0** | **0** | **55** (unchanged behaviour) |

VIOLATIONS 0 on both ON arms. The 5 genuine multi-page singles (never split) carry no mark. bundle_mp_01/02's
genuine 2-page doc rode inside a heuristic cut and is HELD — the pinned trade-off, observed. Reason panel: kind
`segment-hold` + "pages 2–3 were cut from a multi-document scan… use Split".

**Owner-run one-shot for rows imported BEFORE the belt** (go-forward only, never in a migration): in the dev
console, `H._stampSegmentHold(db, docId, document_type_id, {from,to})` per doc, or the SQL shape
`SELECT id, original_filename, page_count FROM documents WHERE status='needs_review' AND original_filename LIKE
'%\_split\_p%' ESCAPE '\' AND page_count >= 2` to list the candidates first.

## Separator accuracy — diagnosed (2026-09-16, later): TWO classes, one under-split and one OVER-split
Probes: `seg_probe.py` (per-page signals), `seg_probe1/3.py` (the matcher's raw return on a missed page),
`seg_probe2.py` / `seg_probe4.py` (A/B and the 4-arm per-PAGE census), `make_controls.py` + `controls/`.

**1. UNDER-split (the merged cuts) — root cause = a title-blind pre-pass.** Every missed boundary in the templated
stacks was a `type_refused` return from `identify_template`: the pre-pass passes no `detected_slug`/`title_trusted`
(the full pipeline does — the 2026-07-09 TYPE-PRECEDENCE fix never reached the separator), so the same-logo sibling
tie-break is a keyword coin flip; a wrong sibling trips the TYPE-PRESENCE VETO → refuse → the pre-pass reads it as
"no match" → continuation. 4-arm per-page census (`probe_4arm_stacks.txt`, 95 expected boundaries): base **72**;
pipeline recipe (slug even untrusted, no fallback) 78 but LOST 1 (tb_07 p3, a wrong trusted title → the
trusted-title refuse); trusted-only + fallback 77, 0 lost; **cascade (trusted → untrusted slug → baseline, each
falling back on None/refuse) 79, 0 lost**; 0 over-splits in every arm on the stacks; real_34 34/34 and the
non-templated singles unchanged in every arm (`probe_4arm_controls.txt`). Residual 5 misses = 150-DPI heading
garble ("WORKS HEET", "DELIVE") — an OCR-quality item, separate.

**2. OVER-split (NEW, pre-existing, all arms incl. today's baseline).** Six controls (`controls/`): a genuine 2-page
invoice / sales order from a supplier with 3-5 same-letterhead sibling templates whose page 2 repeats the
LETTERHEAD (logo + name + address), with (ii) or without (i) a repeated trusted heading. **`segment_docs.py`
itself cuts every one at page 2 — reason "first-page fingerprint"** (`probe_4arm_ctrl.txt`, 6/6 in all four
arms). Mechanism: `extract_keyword_fingerprint` IS the letterhead words, which the continuation page repeats, so
`fingerprint_overlap ≥ 0.5` on page 2; the type-presence veto protects only when the picked sibling's type has
learned heading stats. The docstring promise ("a continuation page carries the logo but NOT the first page's
keyword fingerprint") is false whenever the letterhead repeats. The soak's earlier "0 over-splits on singles" was
VACUOUS (those singles were non-templated suppliers → no match → no boundary). Consequence today on MANUAL import:
page 1 files as a 1-page document — the real invoice, silently missing its page 2 — and page 2 becomes a 1-page
orphan. The title fix (1) neither adds to nor removes this (identical 6/6). Oracle ruling on the layer: see the
oracle_log entry of 2026-09-16 (separator).

## Separator fixes — BUILT DARK the same day (migs 177/178) + the e2e truncation gate
`docs/designs/SEPARATOR_ACCURACY_2026-09-16.md` (both arcs, the Oracle's conditions, the six-arm census table).
**e2e (Oracle C6):** the sandbox restarted on the new code with BOTH switches armed (`segment_title_slug`,
`segment_continuation_veto` = 'true' in the sandbox DB) + mig 176; ONE manual import of all 40 files (the 22
stacks + the 14 controls; `gt_e2e.json`, 150 GT docs) → 134 documents (`soak_e2e_check.js`, `e2e_result.txt`):
- **TRUNCATION metric = 0** — no auto-filed document is shorter than its GT document; every genuine 2-page control
  stayed whole (the veto), the "Page 1 of 2" stacks cut exactly at doc B.
- 133 / 134 cuts exact; 67 one-page cuts auto-filed, every one with ref + date + supplier; every multi-page
  heuristic cut held + marked (mig 176).
- The 1 wrong cut = `bundle_05.pdf`: three NON-templated docs whose only recognised first page is page 1 → never
  split → imported WHOLE (3 pages) and auto-filed under page 1's identity. That is the pre-existing "class the
  belt cannot see" (pendingfeatures.md), untouched by either switch (base does the same) — the Oracle's slice 3
  belt / a separator-side signal is the lever.

## A third lever measured — identity change by a KNOWN SUPPLIER NAME (template-free) — `seg_probe5.py`
The remaining 16/95 stack misses are pages whose supplier has no template for that type (incl. the whole
non-templated 3-doc stack `bundle_05` that imports whole). Signal: a non-first page whose top band (12 lines)
names a known supplier (templates' names ∪ every confirmed `supplier_name`, 22 here) different from the current
document's → boundary; plus "current doc named nobody known, this page names one". Seven arms
(`probe_name7_stacks.txt`, `probe_name7_controls.txt`, `probe_name_ctrl3.txt`): stacks base 72 · cascade+veto
79 · **name (len / pos / top4 / ctx variants) 93 / 95**, ctx without the unknown→known sub-rule 91; 0 lost, 0
over-splits in every arm; real_34 34/34; every control set 0 over-splits in the name arms — including NEW B2B
controls (`controls3/`, `make_controls3.py`: page 1's "Bill To" names the OTHER known supplier; a letterhead-only
page 2 with/without "Page 2 of 2"; a true 2-doc switch). The one over-split in that set (a letterhead-only,
marker-less page 2) is in every arm incl. base — the Oracle's slice-3 residual, not the name rule. Design → gary →
Oracle (`docs/oracle_log.md`); not built at the time of writing.

## Arc 3 — BUILT DARK 2026-09-17: mig 179 `segment_known_supplier_change` (gary → Oracle SIGN-OFF-W/COND C1-C9)
Design + every guard: `docs/designs/SEPARATOR_ACCURACY_2026-09-16.md` "Arc 3"; the Oracle entry `docs/oracle_log.md`
2026-09-17 (incl. its ruling that replaced the 91/95 bar with "0 lost vs 177+178 AND every residual miss a named,
deliberate fail-safe trade"). Census = `seg_census3.py` — imports the SHIPPED `ocr.segmentation` (never the probe);
population = `known_names.js` = the shipped `learning.getKnownSupplierNames` on the sandbox at minConfirms 3
(`known_names_sandbox_min3.txt`: 20 names, 19 real suppliers + "PT" which admission kills; "Chris Docs"/"ME"/"Finances"
never enter). Arms: base · both (177+178) · three (177+178+179) · veto_known (179 ON, 178 OFF — a reachable customer state).

| set (`census3_*.txt`) | expected | base | both | **three** | veto_known | over-splits base → three |
|---|---|---|---|---|---|---|
| synthetic stacks (20 files) | 95 | 72 | 79 | **91** (0 lost) | 87 | 0 → 0 |
| real_34 + the 5 multi-page singles | 39 | 39 | 39 | 39 | 39 | 0 → 0 |
| controls (repeat-letterhead p2 ± heading, 6) | 6 | 6 | 6 | 6 | 6 | 6 → 0 |
| controls2 (logo-only / name-line / full-header / "Page 1 of 2", 8) | 10 | 9 | 10 | 10 | 9 | 4 → 0 |
| controls3 (B2B "Bill To" names the other known supplier; the true switch, 6) | 8 | 8 | 8 | 8 | 8 | 1 → 1 (the marker-less letterhead-only p2, every arm incl. base; the two `switch` files still cut under the wide set) |
| controls4 (c/o, delivered-by, bare c/o, 6) | 6 | 6 | 6 | 6 | 6 | 0 → 0 |

The 4 residual stack misses under `three`, each traced (`census3_stacks.txt` named/witness lines): `bundle_01` p3 =
Larkspur Interiors (0 confirms → not known — the population by design) · `bundle_05` p2 = the same-issuer type switch
(the Oracle's premise: a Thornbury PO after a Thornbury worksheet — structurally blind, the two-sided trusted-title
lever is in pendingfeatures.md) · `bundle_mp_01` p5 + p6 = after a base doc-start cut into a 2-page single whose pages
name nobody, the first-page SET resets to EMPTY (the DROP one document on; carrying the prior name across an unnamed cut
= the garbled-letterhead S4 class — REJECTED, do not restore). Before the Oracle-accepted third witness arm (a recipient
block + a real date shape) the count was 89: the two Saltmarsh delivery dockets print only a bare "Date 11/11/2026" +
"Deliver To" (no heading, no number) — `census3_stacks.txt` of the first run is superseded; the arm bought 0 new
over-splits anywhere (below).

| controls5 (the Oracle's C4 shapes + gary's, 20 files; `make_controls5.py`) | 25 | 22 | 22 | **25** | 25 | 3 → 3 (the 3 = a marker-less repeat-letterhead p2 on `billto`/`blur`/`supplier` Copperfield — the pre-existing residual, every arm incl. base; **0 NEW**) |

controls5 per shape (`census3_controls5.txt`): multi-line "Invoice To" block · a bare "c/o <known>" page WITH a repeated
Invoice No/Date · a "<SUP> LTD" prefix letterhead · a BLURRED page-1 letterhead + a clean page 2 (the unknown→known
DROP end-to-end) · a "Supplier: <known>" PO band · a logo-less item table naming a known supplier on an amount line and
ALONE on its line, with repeated Invoice No/Date and no page number · the window-envelope layout (recipient top-left
unlabelled, issuer top-right) · a known supplier's delivery docket whose only mark is "Docket No:" (MUST cut) · a
2-doc stack of two NON-templated known suppliers (MUST cut) · a 3-doc non-templated stack — every "must NOT split"
shape 0 cuts under `three`, every "MUST cut" shape cut (base cut none of the efficacy shapes).

**The owner's own PDFs — the segment-plan diff (`owner_diff.py`, `census3_owner_diff.txt`; Oracle C5 (b)):** every
multi-page PDF under the live `%APPDATA%\ScanFinder\inbox` (read-only) + the sandbox's filed output: 207 PDFs, 25
multi-page; 19 identical plans, 6 changed — every one of the 6 is a merged cut the belt-OFF replay had wrongly FILED
(e.g. `Copperfield … WS-69146.pdf` p2 = a Thornbury page; `Vellum … DN-77201.pdf` p2 = a Saltmarsh docket), each new
boundary a genuine different-known-supplier document. 0 unexplained deltas; the owner's inbox plans unchanged.

**The seam the controls found + closed:** `ctrl5_envelope_*` (an unlabelled recipient top-LEFT, the issuer top-RIGHT):
Tesseract PSM-3 emits the right-hand issuer block AFTER the item table, so the strict band (table-header cut + 6-line
bound) lost the issuer from page 1 → page 2's issuer letterhead looked like a stranger → 2/2 false cuts under the
first-name form. Fix = the current document's SET is a WIDE read (`known_names_on_page`: every admitted name in the
first 60 lines cut only at the counterparty markers; suppress-only → fail-safe), the cut page keeps the strict band.

### Arc 3 e2e (Oracle C6) — `e2e3_run.sh` + `e2e3_tail.sh` + `e2e_cdp.py`; `e2e3_result.txt`, `e2e_parity.js`
The sandbox app restarted on the new code (mig 179 applied at boot) with the THREE separator switches + mig 176 armed,
signed in over DevTools, ONE manual import of `Manual_E2E3` = 72 files (every stack + controls1-5, `gt_e2e3.json`, 189
GT docs) → 189 documents, 0 unmatched, **178 exact cuts**, 82 one-page cuts auto-filed every one with ref + date +
supplier, 3 merged cuts all HELD + marked, 39 whole files. `soak_e2e_check.js` now FAILS a held wrong cut too (C6).
- **`bundle_05` = a held, marked 2-page cut (p1-2, the same-issuer type switch) + a 1-page Northgate cut** ✓ (was a
  whole 3-page auto-file under page 1 in the two-switch run).
- **Auto-file parity (`e2e_parity.js`):** every source file imported WHOLE in both runs (17 in common) has an IDENTICAL
  outcome (status + page count) ✓.
- **Truncations = 8 wrong cuts on 4 files (1 AUTO-FILED, 7 held): `ctrl3_b2b_thornbury`, `ctrl5_billto_copperfield`,
  `ctrl5_blur_copperfield`, `ctrl5_supplier_copperfield` — every one the MARKER-LESS repeat-letterhead page-2 shape the
  census cuts IDENTICALLY under base and under 177+178 (reason "first-page fingerprint"; `census3_controls3/5.txt`).
  NOT a mig-179 effect (mig 179's delta = 0 truncations; the rule never fired on these pages — same supplier both
  sides). The 2026-09-16 "truncation = 0" held only because that 40-file set carried no marker-less repeat-letterhead
  page 2. And #1255 `ctrl5_supplier_copperfield_split_p1.pdf` AUTO-FILED = the S4 silent class CAUGHT LIVE on a
  manual import: a 2-page buyer-issued PO whose page 2 repeats the letterhead with no page number filed as a 1-page
  document, page 2 held as an orphan.** This is TODAY's behaviour (base does the same) and the Oracle's slice 3 /
  the recommended next arc (pendingfeatures.md 2026-09-17, second entry).
So: C6's three conditions — bundle_05 ✓, parity ✓, and "mig 179 adds no truncation" ✓ — while the literal "0
truncations" over this WIDER set is a pre-existing failure the wider set exposed, recorded rather than hidden.

## Seam found → CLOSED the same day (the belt above); the residual is separator ACCURACY
The hold is an IMPORT-TIME skip only (`autoFileRun=false`): a held segment carries no durable mark, so a later
"File all ready" click or the scope sweep (`scope_sweep_enabled`, ON on the owner's install) can file a merged
100 %-clean segment nobody opened. Proposed belt: stamp watch-produced segments with a review-required mark that
`isAutoFileEligible` honours until a human opens the doc (the `put_back_at` shape). Separator accuracy itself
(the sibling fingerprint floor) is a separate improvement item.
