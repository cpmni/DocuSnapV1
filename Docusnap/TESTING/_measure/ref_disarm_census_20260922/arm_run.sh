#!/usr/bin/env bash
# mig-204 census: REF_CONFUSABLE_CONFIRMED_LITERAL_DISARM efficacy+safety on the 700 corpus.
# Baseline = the 09-21 base_env1.jsonl (disarm OFF, ref_confusable_flag ON, RR_APP_ENV=1). This arm =
# IDENTICAL env + the disarm ON. Delta = purely the disarm. Bar: M=0 (no NEW wrong auto-file), and any
# fire is eyeballed. HARD dep REF_CONFUSABLE_FLAG=1 set explicitly.
set -u
cd "c:/GIT Projects/Docusnap"
SRC="TESTING/_measure/flip_census_20260921"
DIR="TESTING/_measure/ref_disarm_census_20260922"
mkdir -p "$DIR"
exec > "$DIR/arm_run.out" 2>&1
echo "STARTED $(date)"
rm -f "$DIR/DONE.flag"
IDS="$(cat "$SRC/rr_ids_700.txt")"
DB="$SRC/warm_700_mig.db"
TESS="C:/Program Files/Tesseract-OCR/tesseract.exe"
OUT="$DIR/disarm_on.jsonl" LOG="$DIR/disarm_on.log"
rm -f "$OUT"
echo "=== disarm_on start $(date +%H:%M:%S)"
env REF_CONFUSABLE_FLAG=1 REF_CONFUSABLE_CONFIRMED_LITERAL_DISARM=1 \
    RR_DB="$DB" RR_IDS="$IDS" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_ALLOW_ARMED=1 \
    RR_CONSENSUS="$OUT" TESS="$TESS" \
    ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >"$LOG" 2>&1
echo "   -> $(wc -l < "$OUT" 2>/dev/null || echo 0) rows, end $(date +%H:%M:%S)"
echo "DONE $(date +%H:%M:%S)"
touch "$DIR/DONE.flag"
