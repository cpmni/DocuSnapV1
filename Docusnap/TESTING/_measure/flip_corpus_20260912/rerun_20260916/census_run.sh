#!/usr/bin/env bash
# Flip census 2026-09-16 @ HEAD (mig 171): baseline OFF (RR_APP_ENV=1) then ONE switch ON per arm (shell env),
# over the 400 test docs of the migrated 700-corpus copy. Sequential (shared CPU).
set -u
cd "c:/GIT Projects/Docusnap"
SP="C:/Users/cmccu/AppData/Local/Temp/claude/c--GIT-Projects-Docusnap/2d87d505-1b3b-4522-b756-384e51badc0d/scratchpad"
IDS="$(cat "$SP/rr_ids_700.txt")"
DB="$SP/warm_700_mig.db"
TESS="C:/Program Files/Tesseract-OCR/tesseract.exe"
run_arm() {  # name  ENVVAR|-
  local NAME="$1" SW="$2"
  local OUT="$SP/${NAME}.jsonl" LOG="$SP/${NAME}.log"
  rm -f "$OUT"
  echo "=== $NAME ($SW) start $(date +%H:%M:%S)"
  if [ "$SW" = "-" ]; then
    RR_DB="$DB" RR_IDS="$IDS" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_ALLOW_ARMED=1 RR_CONSENSUS="$OUT" TESS="$TESS" \
      ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >"$LOG" 2>&1
  else
    env "$SW=1" RR_DB="$DB" RR_IDS="$IDS" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_ALLOW_ARMED=1 RR_CONSENSUS="$OUT" TESS="$TESS" \
      ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >"$LOG" 2>&1
  fi
  echo "   -> $(wc -l < "$OUT" 2>/dev/null || echo 0) rows, exit $? , end $(date +%H:%M:%S)"
}
run_arm base_env1 -
run_arm on159_env1 REF_CONFUSABLE_FLAG
run_arm on156_env1 NAME_ROLE_NONNAME_FLAG
run_arm onDCA_env1 DESKEW_CORROB_AUTOFILE
run_arm on143_env1 TEMPLATE_PAD_DATE_ADOPT
echo "CENSUS DONE $(date +%H:%M:%S)"
