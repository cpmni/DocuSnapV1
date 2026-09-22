# Customer-corpus score — TAG=eff_pools200 (SET=both, SAMPLE=288, SEED=7)

Processed 288/288 sampled docs (cold install — no learning/templates).

Operating point: DPI 200 · OMP 1 · pools true · 111 app env var(s) from the fresh-install DB (mig 139) · overrides {"OMP_THREAD_LIMIT":"1","DS_OCR_PARALLEL_FULLPAGE":"1","DS_OCR_PARALLEL_FIELDS":"1"}

| lane | digital | scanned | overall |
|---|---|---|---|
| ref | 79/144 (54.9%) | 84/144 (58.3%) | 163/288 (56.6%) |
| date | 138/144 (95.8%) | 130/144 (90.3%) | 268/288 (93.1%) |
| total | 53/108 (49.1%) | 39/108 (36.1%) | 92/216 (42.6%) |
| issuer | 16/144 (11.1%) | 75/144 (52.1%) | 91/288 (31.6%) |
| customer | 35/54 (64.8%) | 34/54 (63.0%) | 69/108 (63.9%) |
| vat_no | 119/144 (82.6%) | 113/144 (78.5%) | 232/288 (80.6%) |
| account_no | 54/144 (37.5%) | 54/144 (37.5%) | 108/288 (37.5%) |
| job_ref | 18/18 (100.0%) | 17/18 (94.4%) | 35/36 (97.2%) |
| po_ref | 36/36 (100.0%) | 36/36 (100.0%) | 72/72 (100.0%) |
| type | 144/144 (100.0%) | 140/144 (97.2%) | 284/288 (98.6%) |

## Heal/verify fires captured (1) — the per-fire census input
- Banner heading recovered: Service Worksheet (90%) [absent-title pixel re-read]
