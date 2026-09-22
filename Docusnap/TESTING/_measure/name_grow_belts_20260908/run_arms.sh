#!/bin/bash
# C6 gate for the NAME-GROW BELTS (docs/designs/KEYWORD_SUPERSTRING_GROW_2026-09-08.md §6): arms OFF / mapper / mapper+note
# on the post-137 reference copy (147 confirmed docs). Ref/date must be identical; would-file delta may only REMOVE;
# census entered>0 (non-vacuous). Never beside a build.
cd "/c/GIT Projects/Docusnap"
D="/c/GIT Projects/Docusnap/TESTING/_measure/name_grow_belts_20260908"
E="./node_modules/electron/dist/electron.exe"
W="/c/GIT Projects/Docusnap/TESTING/_measure/reset_arm_20260908/arm137.db"
run() { local arm="$1"; shift
  echo "=== arm $arm start $(date +%H:%M:%S) ==="; rm -rf "$D/census_$arm"; mkdir -p "$D/census_$arm"; rm -f "$D/consensus_$arm.jsonl"
  env RR_DB="$W" RR_APP_ENV=1 OCR_RENDER_DPI=200 RR_CONSENSUS="$D/consensus_$arm.jsonl" NAMEGROW_CENSUS_DIR="$(cygpath -w "$D/census_$arm")" "$@" "$E" stress_test/realdoc_regression.js > "$D/run_$arm.log" 2>&1
  echo "exit=$? $(date +%H:%M:%S) rows=$(wc -l < "$D/consensus_$arm.jsonl" 2>/dev/null)"; cp stress_test/out/realdoc_regression.md "$D/realdoc_$arm.md" 2>/dev/null
  echo "census outcomes:"; cat "$D/census_$arm"/*.jsonl 2>/dev/null | python -c "import sys,json,collections; c=collections.Counter(json.loads(l)['outcome'] for l in sys.stdin if l.strip()); print('  ', dict(c))"
}
run off
run mapper TEMPLATE_NAME_GROW_BAND_PICK=1 TEMPLATE_NAME_CUT_DEFER_CAP=1
run note TEMPLATE_NAME_GROW_BAND_PICK=1 TEMPLATE_NAME_CUT_DEFER_CAP=1 KEYWORD_SUPERSTRING_NAME_NOTE=1
echo "=== compare off vs mapper ==="; node stress_test/reset_arm_compare.js "$D/consensus_off.jsonl" "$D/consensus_mapper.jsonl" | head -12
echo "=== compare off vs note ==="; node stress_test/reset_arm_compare.js "$D/consensus_off.jsonl" "$D/consensus_note.jsonl" | head -12
echo "BELTS GATE DONE $(date +%H:%M:%S)"
