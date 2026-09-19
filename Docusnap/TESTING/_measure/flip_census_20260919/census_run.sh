#!/usr/bin/env bash
# Flip census 2026-09-19 @ HEAD (mig 186): baseline OFF (RR_APP_ENV=1) then ONE switch ON per arm (shell env),
# over the 400 test docs of the migrated 700-corpus copy. Sequential (shared CPU). Targets:
#   154 trust_ref_role_shape       -> TRUST_REF_ROLE_SHAPE
#   157 template_drift_override_guard -> TEMPLATE_DRIFT_OVERRIDE_GUARD
set -u
cd "c:/GIT Projects/Docusnap"
DIR="TESTING/_measure/flip_census_20260919"
IDS="$(cat "$DIR/rr_ids_700.txt")"
DB="$DIR/warm_700_mig.db"
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
run_arm base_env1 -
run_arm on154_env1 TRUST_REF_ROLE_SHAPE
run_arm on157_env1 TEMPLATE_DRIFT_OVERRIDE_GUARD
echo "CENSUS DONE $(date +%H:%M:%S)"
