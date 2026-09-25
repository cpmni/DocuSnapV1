#!/bin/bash
# Oracle C4 — the separation pre-pass arms OFF vs ON of TYPE_OWNER_UNINSTALLED_BLOCK: the 2026-09-16 soak census
# (seg_census3.py = the SHIPPED segmentation functions + walk_boundaries) re-run under the PRODUCT type env, with the
# block the ONLY difference. Boundaries must be identical, or every diff explained as a page whose only first-page
# witness was a WRONG trusted title (the under-split class).
# Inputs: the repo copies of doctypes.json / known3_sandbox.json / gt.json / controls{,2..5}; the soak's PDF bundles
# (scratchpad, PDFs only); templates = templates.getAll() exported from the owner's LIVE DB copy (job scratch —
# real supplier data, never committed).
export PYTHONIOENCODING=utf-8
export TYPE_UNINSTALLED_HEADING_FOLD=1 TYPE_CAPTION_MENTION_ONLY=1 TYPE_HEADING_ANY_SEGMENT=1 TYPE_TIE_HEADING_PREF=1 TYPE_TITLE_OWNER_PRECEDENCE=1 HEADING_TITLE_GAP_COLLAPSE=1
SP="C:/Users/cmccu/AppData/Local/Temp/claude/c--GIT-Projects-Docusnap/2d87d505-1b3b-4522-b756-384e51badc0d/scratchpad"
S="C:/GIT Projects/Docusnap/TESTING/_measure/watch_separate_soak_20260916"
M="C:/GIT Projects/Docusnap/TESTING/_measure/type_owner_block_20260925"
G="C:/Users/cmccu/.claude/jobs/68b38f39/tmp"
CFG="C:/GIT Projects/Docusnap/config/keyword_patterns.json"
TPL="$G/templates_live727.json"
cd "C:/GIT Projects/Docusnap/python_backend" || exit 1
run_arm () {
  local arm="$1"
  if [ "$arm" = "on" ]; then export TYPE_OWNER_UNINSTALLED_BLOCK=1; else unset TYPE_OWNER_UNINSTALLED_BLOCK; fi
  C() { py -3.12 -X utf8 "$S/seg_census3.py" "$TPL" "$S/doctypes.json" "$CFG" "$S/known3_sandbox.json" "$1" "$2" $3 2>&1; }
  { echo "== stacks"; C "$S/gt.json" "$SP/soak/Bundles" "tb_,bundle_"; echo "== real/singles"; C "$S/gt.json" "$SP/soak/Bundles" "real_,single_";
    for k in "" 2 3 4 5; do echo "== controls$k"; C "$S/controls$k/gt_controls$k.json" "$S/controls$k"; done; } > "$M/c4_$arm.txt"
  echo "arm $arm done: $(grep -c . "$M/c4_$arm.txt") lines, $(grep -c 'Traceback' "$M/c4_$arm.txt") tracebacks, $(grep -c '^TOTAL' "$M/c4_$arm.txt") TOTAL lines"
}
run_arm off
run_arm on
if diff "$M/c4_off.txt" "$M/c4_on.txt" > "$M/c4_diff.txt"; then echo "C4: OFF == ON (boundaries identical)"; else echo "C4: DIFF ($(grep -c '^[<>]' "$M/c4_diff.txt") lines) — see c4_diff.txt"; fi
grep "^TOTAL" "$M/c4_off.txt" | cut -c1-200
