# Flip census 2026-09-19 — RESULT

**Corpus:** the 700-doc warm corpus (`Desktop\Flip Corpus 700\warm_700.db`) copied + migrated to HEAD **mig 186**
(`warm_700_mig.db`), 400 test docs (`learning_excluded_at` stamped). Harness `realdoc_regression.js`, `RR_APP_ENV=1
RR_ALLOW_ARMED=1 OCR_RENDER_DPI=200`. Baseline = both switches OFF (env unset). One switch on per arm (shell env).
Comparator = `../flip_corpus_20260912/rerun_20260916/compare.js`.

## Results (baseline vs switch ON, 400 docs)

| Switch | env | M (right→wrong) | heals | wouldFile OFF→ON | value chg | verdict |
|---|---|---|---|---|---|---|
| **154 `trust_ref_role_shape`** | `TRUST_REF_ROLE_SHAPE` | **0** | 0 | 189→189 | 0 | byte-identical on corpus — safe |
| **157 `template_drift_override_guard`** | `TEMPLATE_DRIFT_OVERRIDE_GUARD` | **0** | 0 | 189→**187** | 0 | safe; 2 credit-notes → review |

### 157 detail — the 2 file→hold
`#638` + `#640` (credit_notes). ref (`credit_note_number`) and date both read **correctly** (template_mapping,
conf 90/98) under both arms. They move to review only because `total_amount` gains a note
*"adjusted to the total that balances against the line amounts — please verify"* → `flagged`. Fail-toward-review
(a total-balance check), not a wrong identity read. No value changed.

## Reading
Both **M=0** (the safety gate). The synthetic corpus does not contain the situation either switch was built for,
so heals=0 here — efficacy is proven **live**: 154 = the 20 held Thornbury invoices; 157 = the CH1 2HU
customer_name postcode-drift root fix (#243). 154 is byte-identical on the corpus; 157 adds a 0.5% friction
(2/400 credit-note total re-checks), in the safe direction.

## Decision (owner, 2026-09-19)
**FLIP BOTH to customer defaults.** mig **187** `trust_ref_role_shape` + mig **188** `template_drift_override_guard`
(UPSERT 'true', `@DEFAULT_FLIP`), both delisted from `dark_switches.js` TEST_SWITCH_KEYS (→47), pinned in
`database/test_default_flip_187_188.js`.

## Artifacts
`base_env1.jsonl` / `on154_env1.jsonl` / `on157_env1.jsonl` (400 rows each) + `.log`, `setup.js`, `census_run.sh`,
`rr_ids_700.txt`, `warm_700_mig.db`.

---

## Batch 2 (2026-09-19, post-187/188) — baseline = the new defaults (154+157 on in every arm)

| Switch | env | M | heals | wouldFile | verdict |
|---|---|---|---|---|---|
| **confusion_precedence** (119) | `CONFUSION_PRECEDENCE` | 0 | 0 | 187→187 | byte-identical (0 fires — no correction history) |
| **note_topic_dedup** (158) | `NOTE_TOPIC_DEDUP` | 0 | 0 | 187→187 | byte-identical (0 fires — no stacked notes) |
| **reread_hold_corrob_release** (130) | `REREAD_HOLD_CORROB_RELEASE` | 0 | 0 | 187→187 | byte-identical (0 fires — no held-with-corrob docs) |

All three M=0. The synthetic corpus is **exhausted for these** — they only fire on specific real-world shapes the
corpus lacks, so the census proves SAFETY, not value.

**Decision (owner, 2026-09-19):** FLIP the two low-risk note/hold switches — mig **189** `note_topic_dedup` +
mig **190** `reread_hold_corrob_release` (UPSERT true, `@DEFAULT_FLIP`, delisted → TEST_SWITCH_KEYS 45, pinned
`test_default_flip_189_190.js`). **HOLD `confusion_precedence`** — it changes a REFERENCE value (corrects a
never-seen serial from mined confusion facts), so flipping on zero corpus/live evidence is not warranted; it
awaits live evidence. Further remaining flips are best driven by the owner's live docs, not more synthetic runs.
