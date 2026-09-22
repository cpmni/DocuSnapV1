#!/bin/bash
# COLD arms of the efficiency-bundle gate (AUDIT_FIX_PLAN §4 3.4, Oracle C6) — customer_corpus_score.js on its NATIVE corpus
# Desktop\Customer Doc Test (11,000 PDFs; the stratified SAMPLE=300 / SEED=7 sample is identical across arms — the
# 09-08 first attempt pointed at the 605 realdoc corpus whose GT shape the harness cannot read).
#   A eff_serial200 (baseline, DPI from the fresh-install DB = 200)  ·  B eff_pools200 (+DS_OCR_PARALLEL_*)  ·  C eff_serial300
#   Determinism: B ×10 on SET=scanned SAMPLE=40 → identical jsonl sha256.
# Never beside a build. Logs: this folder.
set -u
cd "/c/GIT Projects/Docusnap"
D="/c/GIT Projects/Docusnap/TESTING/_measure/efficiency_bundle_20260908"
E="./node_modules/electron/dist/electron.exe"
export CORPUS_DIR="C:/Users/cmccu/Desktop/Customer Doc Test"
export ELECTRON_RUN_AS_NODE=1
ccs() { local tag="$1" set="$2" sample="$3"; shift 3
  echo "=== ccs $tag (SET=$set SAMPLE=$sample $*) start $(date +%H:%M:%S) ==="
  env TAG="$tag" SET="$set" SAMPLE="$sample" SEED=7 OMP_THREAD_LIMIT=1 "$@" "$E" stress_test/customer_corpus_score.js > "$D/ccs_$tag.log" 2>&1
  echo "exit=$? $(date +%H:%M:%S)"; grep -m1 "operating point" "$D/ccs_$tag.log" | cut -c1-260; grep -m1 "^Processed" "stress_test/out/customer_score_$tag.md" 2>/dev/null
  cp "stress_test/out/customer_score_$tag.jsonl" "stress_test/out/customer_score_$tag.md" "$D/" 2>/dev/null
}
ccs eff_serial200 both 300
ccs eff_pools200  both 300 DS_OCR_PARALLEL_FULLPAGE=1 DS_OCR_PARALLEL_FIELDS=1
ccs eff_serial300 both 300 OCR_RENDER_DPI=300
echo "=== A vs B (the pin, --strict) ==="; node stress_test/ccs_arm_diff.js "$D/customer_score_eff_serial200.jsonl" "$D/customer_score_eff_pools200.jsonl" --strict | tail -8
echo "=== A vs C (200 vs 300, informational) ==="; node stress_test/ccs_arm_diff.js "$D/customer_score_eff_serial200.jsonl" "$D/customer_score_eff_serial300.jsonl" | head -8
echo "=== per-lane tables A / C ==="; for t in eff_serial200 eff_serial300; do echo "--- $t"; sed -n '/^| lane/,/^$/p' "$D/customer_score_$t.md"; done
echo "=== determinism: B ×10 on SET=scanned SAMPLE=40 ==="
for i in 1 2 3 4 5 6 7 8 9 10; do
  env TAG="det_$i" SET=scanned SAMPLE=40 SEED=7 OMP_THREAD_LIMIT=1 DS_OCR_PARALLEL_FULLPAGE=1 DS_OCR_PARALLEL_FIELDS=1 "$E" stress_test/customer_corpus_score.js > "$D/det_$i.log" 2>&1
  sha256sum "stress_test/out/customer_score_det_$i.jsonl" 2>/dev/null | cut -c1-16
done | sort | uniq -c | sed 's/^/  /'
echo "COLD CHAIN DONE $(date +%H:%M:%S)"
