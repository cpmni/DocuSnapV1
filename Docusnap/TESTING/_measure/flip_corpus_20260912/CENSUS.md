# Flip-test corpus — census results (2026-09-12 night)

The synthetic 700-doc warm corpus + the OFF/ON safety+efficacy censuses. Built this session; run
autonomously overnight under the standing night-run autonomy protocol. **Everything stays DARK — no
promotion migration was written (a customer-default flip is approval-class → logged for the morning).**

## The corpus + the harness (reproducible)
- Corpus: `Desktop\Flip Corpus 700\` — 10 issuers × their types, 700 docs (`--manual 6 --live 8`), ×2
  renditions (1,400 files). GT is correct-by-construction. Injectors on 3 dedicated pairs (see below).
  Regen: `CORPUS_OUT="…/Flip Corpus 700" py -3.12 stress_test/gen_customer_test.py --manual 6 --live 8
  --inject ref_confusable=Harrowgate-Timber/sales_order --inject format_class_join=Silverbeck-Cleaning/sales_order
  --inject name_nonname=Pelican-Office/invoice`
- Warm DB: `Desktop\Flip Corpus 700\warm_700.db` — 50 templates, 300 history (confirmed, learning-ON),
  400 test (confirmed, learning-excluded). Build: `CORPUS=… OUT_DB=… GRAD_WINDOW=3 TESS=… ELECTRON_RUN_AS_NODE=1
  electron.exe stress_test/build_warm_db.js`. Test ids in `rr_ids_700.txt` (scratchpad).
- **The OPERATING POINT matters (vacuous-arm trap):** the baseline MUST be `RR_APP_ENV=1` (mirrors the
  app's ~112 shipped default-ON reading switches). `RR_APP_ENV=0` (no-env) collapses reads to ref 47% /
  8-autofile — NOT what the app does. Confirmed on a 32-doc subset: env0 ref 15/32; env1 ref 31/32.
- **Arm mechanism:** OFF = `RR_APP_ENV=1`; ON = `RR_APP_ENV=1` + the ONE switch's env var in the SHELL.
  A DARK switch is `'false'` in the warm DB, so the handler bridge never emits its env var → `appEnv`
  omits it → the shell value survives (no clobber). DB-setting writes do NOT reach Python for the three
  proven switches (they read at handler.js:376/386/680, outside the mirrored functions) — shell env only.
- Baseline consensus: `base700_env1.jsonl`. `OCR_RENDER_DPI=200` in every arm.

## Baseline health (RR_APP_ENV=1, 400 test docs) — corpus is SOUND
ref **97%** (389/399) · date **99%** (398/400) · **179/400 auto-file** · wrong auto-files on FILING
fields (ref/date) = **0** (the harness's "36 wrong" are all `total`/optional rounding noise, out of
scope for filing safety) · 1 silent regression (#166 invoice ref → null, one hard scan).

## Censuses (M = a correct-OFF ref/date that reads WRONG ON; the safety gate is M=0)

| fix | mig | M | efficacy on this corpus | verdict |
|---|---|---|---|---|
| **ref_confusable_flag** | 159 | **0** | fires on 6 injected `S0-#####` refs; **#134,#139 flip file→hold** (OFF silently auto-files a confusable ref, ON holds it) | **PASS — flip-ready** |
| **name_role_nonname_flag** | 156 | **0** | fires `+nonname_flag` on 5 postcode reads; **#460 flips file→hold**; correctly skips caption/owner-name/OCR-garble non-postcodes | **PASS — flip-ready** |
| **format_class_join** | 120 | **0** (filing) | index-join proven (Silverbeck/sales_order freetext→alphanum_sep) | **HOLD** — broader blast radius than its pins claim: re-arms `total_amount` format checks on UNRELATED invoices (7 review-bound total notes; #531 file→hold). Understand before flip. |
| **trust_ref_role_shape** | 154 | **0** | INERT (synthetic refs are high-cardinality, never the 'constant' duplicate case) | SAFETY PASS; efficacy = live Thornbury re-judge (done 09-10) |
| **template_drift_override_guard** | 157 | **0** | fires on 2 docs (holds #638,#640) | SAFETY PASS; efficacy = live #243 (done 09-10) |

## Flip-ready (LOGGED FOR MORNING APPROVAL — not flipped autonomously)
**mig 159 `ref_confusable_flag`** and **mig 156 `name_role_nonname_flag`** both: (a) already carry Oracle
SIGN-OFF-W/COND from their build; (b) census M=0 + a real fire + a clean file→hold efficacy delta; (c)
0 new filers, no collateral. The flip = a promotion migration UPSERTing the setting `'true'` + removing
the key from `dark_switches.js` `TEST_SWITCH_KEYS` in the same commit (the release gate forbids the
`'true'` write while the key is still listed). NOT done autonomously (non-DARK customer-default =
approval-class). Owner: approve the flip commits + push.

## Widen batch (partial — 2 of 7; stopped to free CPU for the Chris vet + the QuickFile build)
Same arm mechanism, over all 400. Reusable runner: `widen_run.sh`.
- **template_pad_date_adopt (mig 143): PASS** — M=0, **1 correct date HEAL** (#279 `13-04-2020`→`23-04-2026`),
  0 new wrong files. A real efficacy fire → flip candidate.
- **template_date_left_clip_grow: M=0, inert** (no fire on this corpus) — safety pass only.
- NOT run: template_code_read_widen, template_locate_role_qualifier, anchor_labelless_currency_refuse,
  template_fragment_containment_yield, type_uninstalled_heading_fold (geometry-inert on the synthetic set;
  low value). Re-run: `bash TESTING/_measure/flip_corpus_20260912/widen_run.sh` (edit the SWITCHES list).

## 2026-09-16 RE-RUN at HEAD (mig 171) → 156 + 159 FLIPPED (migs 172/173)
Owner: "continue with the switch testing … then flip 156 and 159". Same corpus + method; the Desktop warm DB
was 3 migrations stale (pre-`intake`), so it was COPIED to scratch + migrated 163→171 (`rerun_20260916/mig.js`;
the owner's file untouched). Runner `rerun_20260916/census_run.sh` (baseline OFF = `RR_APP_ENV=1`, then ONE
switch ON per arm via shell env), analysis `rerun_20260916/compare.js` (per-doc OFF-vs-ON: M / heals /
file→hold / hold→file / fires / every field value+note diff). ~10 min per arm, 8 shards.

**Baseline is deterministic:** identical to the 09-15 date-fix census — 192/400 would-file, the same 13
disagreeing docs (1 silent, #166), 36 `total`-rounding noise, M_type 0.

| fix | mig | M | value changes | fires | file→hold | hold→file | verdict |
|---|---|---|---|---|---|---|---|
| **ref_confusable_flag** | 159 | **0** | 0 | 6 (all six injected `S0-#####` Harrowgate sales orders) | 2 (#134, #139) | 0 | **PASS ×2 → FLIPPED, mig 173** |
| **name_role_nonname_flag** | 156 | **0** | 0 | 5 (all five injected `BT1 1HE` Pelican customer_name) | 1 (#460) | 0 | **PASS ×2 → FLIPPED, mig 172** |
| deskew_corrob_autofile | — | **0** | 0 | **0** (the 3 straighten-changed fields #63/#65/#67 all KEPT their confirm-once hold under ON) | 0 | 0 | SAFETY PASS, **EFFICACY VACUOUS** — byte-identical to OFF; stays DARK (zero fires ⇒ no flip evidence here; the 09-01 owner-DB census is still the only efficacy signal) |
| **template_pad_date_adopt** | 143 | **0** | 1 | 1 | 0 | 0 | **PASS ×2 → FLIPPED, mig 174** — the same real heal as 09-12 (#279 statement date `13-04-2020` → `23-04-2026`, `template_mapping_padadopt`), 0 new filers (the "fire" is the pre-existing `padcodeflag` note on #532, present in both arms) |

Results per arm: `rerun_20260916/cmp_{159,156,DCA,143}.txt`; the raw consensus rows (`base_env1.jsonl`,
`on{159,156,DCA,143}_env1.jsonl`, 400 rows each) stayed in the session scratchpad
(`…/2d87d505-1b3b-4522-b756-384e51badc0d/scratchpad/`).

**The flips:** mig 172 + 173 (`764b397`), then mig 174 (owner: "flip 143 as well") UPSERT the settings `'true'`
under `// @DEFAULT_FLIP` labels; all three keys DELISTED from `dark_switches.js` (release gate → "47 DARK keys
guarded"); pins: `database/test_default_flip_156_159.js` (fresh-install ON, upgrade-from-seeded-false ON, kill
durable, delisted, labelled, gate-clean, handler bridge — covers all three), `test_migration156_nonname_flag.js` +
`test_migration143_pad_date_adopt.js` reworked to the graduated contract, the two count pins 50→47. Ledger
`docs/DARK_SWITCH_LEDGER.md` updated. `watch_separate_enabled` = a soak (not a
700-census); its owner-run soak already PASSED — flip is the owner's call.

## format_class_join finding (for the morning)
Its env flag changes `total_amount` format-checking on suppliers with NO joined scope (Meadowvale +
Quillstone invoices), adding review-bound "format differs from the usual" notes on correctly-read totals
— broader than the "OFF==ON byte-identical except the joined scope" pin asserts. M=0 / no wrong file
(fail-toward-review), but real added friction. Needs a look at the blast radius before any flip.
