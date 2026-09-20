#!/usr/bin/env bash
# anchor_code_left_grow (mig 192) SAFETY census: baseline OFF (RR_APP_ENV=1, mig-186/191 etc ON) vs the
# switch ON (shell ANCHOR_CODE_LEFT_GROW=1), same warm-corpus copy. M=0 = the ON arm never turns a would-file
# ref value WRONG; the delta should be confined to the converge class (a cleared crop_fullpage_disagree flag).
set -u
cd "c:/GIT Projects/Docusnap"
DIR="TESTING/_measure/anchor_left_grow_census_20260920"
IDS="$(cat "$DIR/rr_ids.txt")"
DB="$DIR/warm.db"
TESS="C:/Program Files/Tesseract-OCR/tesseract.exe"
run_arm() {  # name  ENVVAR|-
  local NAME="$1" SW="$2"
  local OUT="$DIR/${NAME}.jsonl" LOG="$DIR/${NAME}.log"
  rm -f "$OUT"
  echo "=== $NAME ($SW) start $(date +%H:%M:%S)"
  if [ "$SW" = "-" ]; then
    RR_DB="$DB" RR_IDS="$IDS" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_ALLOW_ARMED=1 RR_CONSENSUS="$OUT" TESS="$TESS" \
      ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >"$LOG" 2>&1
  else
    env "$SW=1" RR_DB="$DB" RR_IDS="$IDS" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_ALLOW_ARMED=1 RR_CONSENSUS="$OUT" TESS="$TESS" \
      ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >"$LOG" 2>&1
  fi
  echo "   -> $(wc -l < "$OUT" 2>/dev/null || echo 0) rows, end $(date +%H:%M:%S)"
}
run_arm base_off -
run_arm on_anchor ANCHOR_CODE_LEFT_GROW
echo "CENSUS DONE $(date +%H:%M:%S)"
