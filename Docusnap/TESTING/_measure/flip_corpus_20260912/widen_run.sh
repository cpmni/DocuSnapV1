#!/usr/bin/env bash
# Widen safety+efficacy census: each DARK switch ON alone vs the RR_APP_ENV=1 baseline, over the 400
# test docs. Sequential (shared CPU). Consensus -> widen_<ENV>.jsonl. Analysis done after by the caller.
set -u
cd "c:/GIT Projects/Docusnap"
SP="C:/Users/cmccu/AppData/Local/Temp/claude/c--GIT-Projects-Docusnap/46f261df-90c6-45b9-87c4-6c9b00a6bdef/scratchpad"
IDS="$(cat "$SP/rr_ids_700.txt")"
DB="C:/Users/cmccu/Desktop/Flip Corpus 700/warm_700.db"
TESS="C:/Program Files/Tesseract-OCR/tesseract.exe"
SWITCHES="TEMPLATE_DATE_LEFT_CLIP_GROW TEMPLATE_PAD_DATE_ADOPT TEMPLATE_CODE_READ_WIDEN TEMPLATE_LOCATE_ROLE_QUALIFIER ANCHOR_LABELLESS_CURRENCY_REFUSE TEMPLATE_FRAGMENT_CONTAINMENT_YIELD TYPE_UNINSTALLED_HEADING_FOLD"
for SW in $SWITCHES; do
  OUT="$SP/widen_${SW}.jsonl"
  rm -f "$OUT"
  echo "=== $SW ==="
  env "$SW=1" RR_DB="$DB" RR_IDS="$IDS" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_ALLOW_ARMED=1 \
    RR_CONSENSUS="$OUT" TESS="$TESS" \
    ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >/dev/null 2>&1
  echo "   -> $(wc -l < "$OUT" 2>/dev/null || echo 0) rows"
done
echo "WIDEN DONE"
