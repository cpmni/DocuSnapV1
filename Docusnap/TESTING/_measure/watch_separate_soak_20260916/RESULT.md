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

## Seam found (follow-up, NOT a blocker — logged in pendingfeatures.md)
The hold is an IMPORT-TIME skip only (`autoFileRun=false`): a held segment carries no durable mark, so a later
"File all ready" click or the scope sweep (`scope_sweep_enabled`, ON on the owner's install) can file a merged
100 %-clean segment nobody opened. Proposed belt: stamp watch-produced segments with a review-required mark that
`isAutoFileEligible` honours until a human opens the doc (the `put_back_at` shape). Separator accuracy itself
(the sibling fingerprint floor) is a separate improvement item.
