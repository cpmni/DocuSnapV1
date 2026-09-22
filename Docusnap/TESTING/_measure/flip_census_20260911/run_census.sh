#!/usr/bin/env bash
# Flip-census runner — mig 154/156/157. See RUNME.md.
# Clean single-arc A/B on the arm137 baseline (RR_APP_ENV=0 → no DARK switch forwarded), one
# explicit env var the only OFF/ON difference. OCR_RENDER_DPI=200 forced in BOTH arms (product DPI).
# Harness opens the live DB read-only; run in the owner's un-sandboxed shell (app closed is safest).
set -u
cd "$(dirname "$0")/../../.." || exit 1          # repo root
REPO="$(pwd)"
OUTDIR="$REPO/stress_test/out/flip_census_20260911"
mkdir -p "$OUTDIR"
ELECTRON="./node_modules/.bin/electron"
HARNESS="stress_test/realdoc_regression.js"

declare -A ENVVAR=( [154]=TRUST_REF_ROLE_SHAPE [156]=NAME_ROLE_NONNAME_FLAG [157]=TEMPLATE_DRIFT_OVERRIDE_GUARD )
declare -A LABEL=( [154]="ref-role shape" [156]="non-name guard" [157]="drift-override guard" )

run_arm () {                                      # $1=arc  $2=off|on  $3=envval
  local arc="$1" arm="$2" val="$3"
  local dump="$OUTDIR/${arc}_${arm}.consensus.jsonl"
  local log="$OUTDIR/${arc}_${arm}.log"
  rm -f "$dump"                                    # RR_CONSENSUS appends — start fresh
  echo "  [$arc $arm] ${ENVVAR[$arc]}=$val  -> $dump"
  RR_APP_ENV=0 RR_ALLOW_ARMED=1 OCR_RENDER_DPI=200 \
    "${ENVVAR[$arc]}=$val" RR_CONSENSUS="$dump" \
    ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$HARNESS" > "$log" 2>&1
  # summary line the harness prints (silent regressions vs GT):
  grep -iE "silent|wrong|auto-file|M=|operating point" "$log" | tail -8
}

census_one () {
  local arc="$1"
  echo "=== mig $arc (${LABEL[$arc]}) : ${ENVVAR[$arc]} ==="
  # env-var assignment via `env` so the dynamic name expands correctly
  env RR_APP_ENV=0 RR_ALLOW_ARMED=1 OCR_RENDER_DPI=200 "${ENVVAR[$arc]}=0" \
      RR_CONSENSUS="$OUTDIR/${arc}_off.consensus.jsonl" \
      ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$HARNESS" > "$OUTDIR/${arc}_off.log" 2>&1
  rm -f "$OUTDIR/${arc}_off.consensus.jsonl.tmp" 2>/dev/null
  echo "  OFF done -> $OUTDIR/${arc}_off.consensus.jsonl"
  grep -iE "silent|wrong|auto-file|operating point" "$OUTDIR/${arc}_off.log" | tail -6
  env RR_APP_ENV=0 RR_ALLOW_ARMED=1 OCR_RENDER_DPI=200 "${ENVVAR[$arc]}=1" \
      RR_CONSENSUS="$OUTDIR/${arc}_on.consensus.jsonl" \
      ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$HARNESS" > "$OUTDIR/${arc}_on.log" 2>&1
  echo "  ON done  -> $OUTDIR/${arc}_on.consensus.jsonl"
  grep -iE "silent|wrong|auto-file|operating point" "$OUTDIR/${arc}_on.log" | tail -6
  echo "  --- OFF vs ON diff (M + filer-set) ---"
  ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$(dirname "$0")/diff_consensus.js" \
      "$OUTDIR/${arc}_off.consensus.jsonl" "$OUTDIR/${arc}_on.consensus.jsonl"
}

# NOTE: RR_CONSENSUS appends — census_one deletes via the shell before each arm.
rm -f "$OUTDIR"/*.consensus.jsonl 2>/dev/null

case "${1:-all}" in
  154|156|157) census_one "$1" ;;
  all) for a in 157 156 154; do census_one "$a"; echo; done ;;
  *) echo "usage: run_census.sh [154|156|157|all]"; exit 2 ;;
esac
