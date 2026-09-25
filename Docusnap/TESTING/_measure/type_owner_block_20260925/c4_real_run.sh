#!/bin/bash
# C4 addendum — the REAL 34-page Print Tracker bundle (re-stitched from the soak's split pages into job scratch; the
# original real_34.pdf no longer sat in the scratch Bundles dir when the main pair ran). Same env, block OFF vs ON.
export PYTHONIOENCODING=utf-8
export TYPE_UNINSTALLED_HEADING_FOLD=1 TYPE_CAPTION_MENTION_ONLY=1 TYPE_HEADING_ANY_SEGMENT=1 TYPE_TIE_HEADING_PREF=1 TYPE_TITLE_OWNER_PRECEDENCE=1 HEADING_TITLE_GAP_COLLAPSE=1
S="C:/GIT Projects/Docusnap/TESTING/_measure/watch_separate_soak_20260916"
M="C:/GIT Projects/Docusnap/TESTING/_measure/type_owner_block_20260925"
G="C:/Users/cmccu/.claude/jobs/68b38f39/tmp"
CFG="C:/GIT Projects/Docusnap/config/keyword_patterns.json"
cd "C:/GIT Projects/Docusnap/python_backend" || exit 1
for arm in off on; do
  if [ "$arm" = "on" ]; then export TYPE_OWNER_UNINSTALLED_BLOCK=1; else unset TYPE_OWNER_UNINSTALLED_BLOCK; fi
  py -3.12 -X utf8 "$S/seg_census3.py" "$G/templates_live727.json" "$S/doctypes.json" "$CFG" "$S/known3_sandbox.json" "$S/gt.json" "$G/c4_real" "real_" > "$M/c4_real_$arm.txt" 2>&1
  echo "real arm $arm: $(grep -c . "$M/c4_real_$arm.txt") lines, $(grep -c Traceback "$M/c4_real_$arm.txt") tracebacks"
done
if diff "$M/c4_real_off.txt" "$M/c4_real_on.txt" > "$M/c4_real_diff.txt"; then echo "C4 real_34: OFF == ON"; else echo "C4 real_34: DIFF ($(grep -c '^[<>]' "$M/c4_real_diff.txt") lines)"; fi
grep "^TOTAL\|^real_34" "$M/c4_real_off.txt" | cut -c1-220
