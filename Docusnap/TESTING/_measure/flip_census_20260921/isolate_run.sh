#!/usr/bin/env bash
# Per-switch isolation for the HEAL-group switches that FIRED in the union arm, so a flip can be attributed
# to ONE switch. Baseline already exists (base_env1.jsonl). Each arm = ONE switch ON.
set -u
cd "c:/GIT Projects/Docusnap"
DIR="TESTING/_measure/flip_census_20260921"
exec > "$DIR/isolate_run.out" 2>&1
echo "ISOLATE STARTED $(date)"
rm -f "$DIR/ISOLATE_DONE.flag"
IDS="$(cat "$DIR/rr_ids_700.txt")"
DB="$DIR/warm_700_mig.db"
TESS="C:/Program Files/Tesseract-OCR/tesseract.exe"
run_one() {  # name ENVVAR
  local NAME="$1" SW="$2"
  local OUT="$DIR/${NAME}.jsonl" LOG="$DIR/${NAME}.log"
  rm -f "$OUT"
  echo "=== $NAME ($SW) start $(date +%H:%M:%S)"
  env "$SW=1" RR_DB="$DB" RR_IDS="$IDS" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_ALLOW_ARMED=1 RR_CONSENSUS="$OUT" TESS="$TESS" \
    ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >"$LOG" 2>&1
  echo "   -> $(wc -l < "$OUT" 2>/dev/null || echo 0) rows, end $(date +%H:%M:%S)"
}
run_one on_readwiden   TEMPLATE_CODE_READ_WIDEN
run_one on_edgeclip    TEMPLATE_EDGE_CLIP_HEAL
echo "ISOLATE DONE $(date +%H:%M:%S)"
touch "$DIR/ISOLATE_DONE.flag"
