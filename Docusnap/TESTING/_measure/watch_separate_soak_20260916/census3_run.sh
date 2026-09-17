#!/bin/bash
export PYTHONIOENCODING=utf-8
SP="C:/Users/cmccu/AppData/Local/Temp/claude/c--GIT-Projects-Docusnap/2d87d505-1b3b-4522-b756-384e51badc0d/scratchpad"; M="C:/GIT Projects/Docusnap/TESTING/_measure/watch_separate_soak_20260916"; cd "C:/GIT Projects/Docusnap/python_backend"
C() { py -3.12 -X utf8 "$M/seg_census3.py" "$SP/soak/templates.json" "$SP/soak/doctypes.json" "../config/keyword_patterns.json" "$SP/soak/known3.json" "$1" "$2" $3 2>&1; }
echo "== stacks" > "$M/census3_stacks.txt"; C "$SP/soak/gt.json" "$SP/soak/Bundles" "tb_,bundle_" >> "$M/census3_stacks.txt"
echo "== real/singles" > "$M/census3_real.txt"; C "$SP/soak/gt.json" "$SP/soak/Bundles" "real_,single_" >> "$M/census3_real.txt"
for k in "" 2 3 4 5; do echo "== controls$k" > "$M/census3_controls$k.txt"; C "$SP/soak/Controls$k/gt_controls$k.json" "$SP/soak/Controls$k" >> "$M/census3_controls$k.txt"; done
py -3.12 -X utf8 "$M/owner_diff.py" "$SP/soak/templates.json" "$SP/soak/doctypes.json" "../config/keyword_patterns.json" "$SP/soak/known3.json" "$APPDATA/ScanFinder/inbox" "$SP/soak/Filed" > "$M/census3_owner_diff.txt" 2>&1
echo CENSUS3-DONE >> "$M/census3_owner_diff.txt"
