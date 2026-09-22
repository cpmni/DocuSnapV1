#!/bin/bash
# THE GATE for the efficiency bundle — docs/designs/AUDIT_FIX_PLAN_2026-09-08.md §4 slice 3.4 (Oracle C6/C7).
#   Cold arms (customer_corpus_score.js at the fresh-install operating point, mig 137/138/139 applied on its throwaway DB):
#     A eff_serial200 (baseline)  ·  B eff_pools200 (+DS_OCR_PARALLEL_*)  ·  C eff_serial300 (OCR_RENDER_DPI=300, informational)
#   Determinism: B repeated 10× on SET=scanned SAMPLE=40 → identical jsonl sha256.
#   Warm arm (C7): realdoc_regression.js on the post-137 copy at 200 vs 300, switches OFF, pools OFF.
# Never runs beside a build (both need node_modules/electron). Logs: this folder.
set -u
cd "/c/GIT Projects/Docusnap"
D="/c/GIT Projects/Docusnap/TESTING/_measure/efficiency_bundle_20260908"
E="./node_modules/electron/dist/electron.exe"
export CORPUS_DIR="C:/Users/cmccu/Desktop/ScanFinder Test Corpus"
export ELECTRON_RUN_AS_NODE=1
ccs() { # TAG SET SAMPLE extra-env…
  local tag="$1" set="$2" sample="$3"; shift 3
  echo "=== ccs $tag (SET=$set SAMPLE=$sample $*) start $(date +%H:%M:%S) ==="
  env TAG="$tag" SET="$set" SAMPLE="$sample" SEED=7 OMP_THREAD_LIMIT=1 "$@" "$E" stress_test/customer_corpus_score.js > "$D/ccs_$tag.log" 2>&1
  echo "exit=$? $(date +%H:%M:%S)"; grep -m1 "operating point" "$D/ccs_$tag.log"; grep -m1 "^Processed" "stress_test/out/customer_score_$tag.md"
  cp "stress_test/out/customer_score_$tag.jsonl" "stress_test/out/customer_score_$tag.md" "$D/" 2>/dev/null
}
ccs eff_serial200 both 100000
ccs eff_pools200  both 100000 DS_OCR_PARALLEL_FULLPAGE=1 DS_OCR_PARALLEL_FIELDS=1
ccs eff_serial300 both 100000 OCR_RENDER_DPI=300
echo "=== A vs B (the pin, --strict) ==="; node stress_test/ccs_arm_diff.js "$D/customer_score_eff_serial200.jsonl" "$D/customer_score_eff_pools200.jsonl" --strict | tail -6
echo "=== A vs C (200 vs 300, informational) ==="; node stress_test/ccs_arm_diff.js "$D/customer_score_eff_serial200.jsonl" "$D/customer_score_eff_serial300.jsonl" | head -6
echo "=== determinism: B ×10 on SET=scanned SAMPLE=40 ==="
for i in 1 2 3 4 5 6 7 8 9 10; do
  env TAG="det_$i" SET=scanned SAMPLE=40 SEED=7 OMP_THREAD_LIMIT=1 DS_OCR_PARALLEL_FULLPAGE=1 DS_OCR_PARALLEL_FIELDS=1 "$E" stress_test/customer_corpus_score.js > "$D/det_$i.log" 2>&1
  sha256sum "stress_test/out/customer_score_det_$i.jsonl" | cut -c1-16
done | sort | uniq -c | sed 's/^/  /'
echo "=== warm arm (C7): post-137 copy, 200 vs 300, switches OFF, pools OFF ==="
W="/c/GIT Projects/Docusnap/TESTING/_measure/reset_arm_20260908/arm137.db"
for dpi in 200 300; do
  echo "--- warm $dpi start $(date +%H:%M:%S) ---"; rm -f "$D/warm_$dpi.jsonl"
  env RR_DB="$W" RR_APP_ENV=1 OCR_RENDER_DPI=$dpi RR_CONSENSUS="$D/warm_$dpi.jsonl" "$E" stress_test/realdoc_regression.js > "$D/warm_$dpi.log" 2>&1
  echo "exit=$?"; cp stress_test/out/realdoc_regression.md "$D/realdoc_warm_$dpi.md" 2>/dev/null; grep -n "Regressions" "$D/realdoc_warm_$dpi.md"
done
echo "=== warm 300 → 200 (would-file value diffs must be 0 or render-verified heals) ==="; node stress_test/reset_arm_compare.js "$D/warm_300.jsonl" "$D/warm_200.jsonl" | tail -8
echo "GATE CHAIN DONE $(date +%H:%M:%S)"
