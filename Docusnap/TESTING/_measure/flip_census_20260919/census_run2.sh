#!/usr/bin/env bash
# Flip census 2026-09-19 batch 2 @ HEAD (post-flip: 154+157 now defaults). Baseline = the NEW defaults
# (TRUST_REF_ROLE_SHAPE + TEMPLATE_DRIFT_OVERRIDE_GUARD on in EVERY arm), then ONE candidate ON per arm.
# Candidates (shell-env-armable, source-confirmed):
#   confusion_precedence         -> CONFUSION_PRECEDENCE
#   note_topic_dedup             -> NOTE_TOPIC_DEDUP
#   reread_hold_corrob_release   -> REREAD_HOLD_CORROB_RELEASE
set -u
cd "c:/GIT Projects/Docusnap"
DIR="TESTING/_measure/flip_census_20260919"
IDS="$(cat "$DIR/rr_ids_700.txt")"
DB="$DIR/warm_700_mig.db"
TESS="C:/Program Files/Tesseract-OCR/tesseract.exe"
DEF="TRUST_REF_ROLE_SHAPE=1 TEMPLATE_DRIFT_OVERRIDE_GUARD=1"   # the current defaults, on in every arm
run_arm() {  # name  extra-ENV|-
  local NAME="$1" SW="$2"
  local OUT="$DIR/${NAME}.jsonl" LOG="$DIR/${NAME}.log"
  rm -f "$OUT"
  echo "=== $NAME ($SW) start $(date +%H:%M:%S)"
  local EXTRA=""; [ "$SW" = "-" ] || EXTRA="$SW=1"
  env $DEF $EXTRA RR_DB="$DB" RR_IDS="$IDS" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_ALLOW_ARMED=1 RR_CONSENSUS="$OUT" TESS="$TESS" \
    ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >"$LOG" 2>&1
  echo "   -> $(wc -l < "$OUT" 2>/dev/null || echo 0) rows, end $(date +%H:%M:%S)"
}
run_arm base2_defaults -
run_arm on_confprec CONFUSION_PRECEDENCE
run_arm on_notededup NOTE_TOPIC_DEDUP
run_arm on_rereadrel REREAD_HOLD_CORROB_RELEASE
echo "CENSUS2 DONE $(date +%H:%M:%S)"
