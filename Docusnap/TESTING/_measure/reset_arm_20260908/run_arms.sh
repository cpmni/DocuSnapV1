#!/bin/bash
cd "/c/GIT Projects/Docusnap"
D="/c/GIT Projects/Docusnap/TESTING/_measure/reset_arm_20260908"
E="./node_modules/electron/dist/electron.exe"
for arm in 136 137; do
  echo "=== arm $arm start $(date +%H:%M:%S) ===" 
  rm -f "$D/consensus_$arm.jsonl"
  RR_DB="$D/arm$arm.db" RR_APP_ENV=1 OCR_RENDER_DPI=200 RR_CONSENSUS="$D/consensus_$arm.jsonl" ELECTRON_RUN_AS_NODE=1 "$E" stress_test/realdoc_regression.js > "$D/run_$arm.log" 2>&1
  echo "exit=$?"
  cp stress_test/out/realdoc_regression.md "$D/realdoc_regression_$arm.md" 2>/dev/null
  echo "=== arm $arm done $(date +%H:%M:%S) lines=$(wc -l < "$D/consensus_$arm.jsonl" 2>/dev/null) ==="
done
echo "ALL ARMS DONE"
