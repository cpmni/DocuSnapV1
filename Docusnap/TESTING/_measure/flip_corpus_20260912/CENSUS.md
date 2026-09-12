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

## format_class_join finding (for the morning)
Its env flag changes `total_amount` format-checking on suppliers with NO joined scope (Meadowvale +
Quillstone invoices), adding review-bound "format differs from the usual" notes on correctly-read totals
— broader than the "OFF==ON byte-identical except the joined scope" pin asserts. M=0 / no wrong file
(fail-toward-review), but real added friction. Needs a look at the blast radius before any flip.
