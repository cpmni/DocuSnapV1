#!/usr/bin/env bash
# D1 safety census (REF_CONFUSABLE_HISTORY_DISARM, mig 201). OFF baseline = base_env1.jsonl (D1 env unset =
# byte-identical; migs 199-201 are additive non-reading). Run ONE arm with D1 ON, then compare.
# Corpus proves SAFETY only (no variable-length mixed-prefix repeat sender reachable) — efficacy = the pins.
set -u
cd "c:/GIT Projects/Docusnap"
DIR="TESTING/_measure/flip_census_20260921"
exec > "$DIR/d1_run.out" 2>&1
echo "D1 CENSUS STARTED $(date)"
rm -f "$DIR/D1_DONE.flag"
IDS="$(cat "$DIR/rr_ids_700.txt")"
DB="$DIR/warm_700_mig.db"
TESS="C:/Program Files/Tesseract-OCR/tesseract.exe"
OUT="$DIR/d1_on.jsonl"; rm -f "$OUT"
echo "=== d1_on start $(date +%H:%M:%S)"
env REF_CONFUSABLE_HISTORY_DISARM=1 RR_DB="$DB" RR_IDS="$IDS" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_ALLOW_ARMED=1 \
    RR_CONSENSUS="$OUT" TESS="$TESS" \
    ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >"$DIR/d1_on.log" 2>&1
echo "   -> $(wc -l < "$OUT" 2>/dev/null || echo 0) rows, end $(date +%H:%M:%S)"
echo "=== compare base_env1 vs d1_on ==="
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe \
    TESTING/_measure/flip_corpus_20260912/rerun_20260916/compare.js \
    "$DIR/base_env1.jsonl" "$OUT" 'confusable|disarm' > "$DIR/d1_compare.txt" 2>&1
echo "D1 CENSUS DONE $(date +%H:%M:%S)"
touch "$DIR/D1_DONE.flag"
