#!/usr/bin/env bash
# CORROB_DATE_FOLD_WIDE census: safety on the 700 corpus. Baseline = the 09-21 base_env1.jsonl (WIDE unset =
# OFF). This arm = the SAME env + CORROB_DATE_FOLD_WIDE=1. Delta = purely the wide date fold. Bar: M=0 (no new
# wrong auto-file; the fold can only heal a same-calendar-date format difference). gary → Oracle SIGN-OFF-W/COND.
set -u
cd "c:/GIT Projects/Docusnap"
SRC="TESTING/_measure/flip_census_20260921"
DIR="TESTING/_measure/corrob_date_fold_census_20260922"
mkdir -p "$DIR"
exec > "$DIR/arm_run.out" 2>&1
echo "STARTED $(date)"
rm -f "$DIR/DONE.flag"
IDS="$(cat "$SRC/rr_ids_700.txt")"
DB="$SRC/warm_700_mig.db"
TESS="C:/Program Files/Tesseract-OCR/tesseract.exe"
OUT="$DIR/wide_on.jsonl" LOG="$DIR/wide_on.log"
rm -f "$OUT"
echo "=== wide_on start $(date +%H:%M:%S)"
env CORROB_DATE_FOLD_WIDE=1 \
    RR_DB="$DB" RR_IDS="$IDS" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_ALLOW_ARMED=1 \
    RR_CONSENSUS="$OUT" TESS="$TESS" \
    ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >"$LOG" 2>&1
echo "   -> $(wc -l < "$OUT" 2>/dev/null || echo 0) rows, end $(date +%H:%M:%S)"
echo "DONE $(date +%H:%M:%S)"
touch "$DIR/DONE.flag"
