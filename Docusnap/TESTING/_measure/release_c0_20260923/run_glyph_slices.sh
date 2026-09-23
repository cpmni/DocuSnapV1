#!/usr/bin/env bash
# LOOK AT THE CROPS (2026-09-23 night): re-run the 16 false-hold docs + the 9 soften docs with the second reader ON,
# the trace on, and the dev-inspector slice dump on, so the EXACT crop PP was handed can be eyeballed.
set -u
cd "c:/GIT Projects/Docusnap"
DB="stress_test/out/c0_live_copy/docusnap.db"
D="stress_test/out/c0_release"; S="$D/glyph_slices"
mkdir -p "$S"
OUT="$D/glyph_slices.jsonl"; TR="$D/glyph_slices.trace.jsonl"; LOG="$D/glyph_slices.log"
: > "$OUT"; : > "$TR"
env RR_DB="$DB" RR_IDS="${RR_IDS:-78,198,204,181,245,230,221,240,459,417,596,653,679,658,852,818,45,620,612,605,702,692,690,830,829}" \
    OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_CONSENSUS="$OUT" RR_TRACE_OUT="$TR" RR_SLICE_DIR="$S" \
    GLYPH_FALLBACK_ENABLED=1 GLYPH_CONFUSABLE_RESOLVE=1 \
    TESS="C:/Program Files/Tesseract-OCR/tesseract.exe" \
    ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >"$LOG" 2>&1
echo "rows=$(wc -l < "$OUT") trace=$(wc -l < "$TR") slices=$(ls "$S" | wc -l)"
