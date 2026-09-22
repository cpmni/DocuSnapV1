#!/usr/bin/env bash
# S2 SAFETY census: glyph_fallback_enabled ON vs OFF on the 700 warm corpus. Only delta = shell env
# GLYPH_FALLBACK_ENABLED. Proves: no ref VALUE change, wouldFile(ON) ⊆ wouldFile(OFF), the newly-held set,
# fire count, wall-clock.
set -u
cd "c:/GIT Projects/Docusnap"
SRC="TESTING/_measure/flip_census_20260921"
DIR="TESTING/_measure/glyph_fallback_census_20260922"
exec > "$DIR/run.out" 2>&1
echo "STARTED $(date)"
rm -f "$DIR/DONE.flag" "$DIR/off.jsonl" "$DIR/on.jsonl" "$DIR/fires.jsonl"
IDS="$(cat "$SRC/rr_ids_700.txt")"
DB="$SRC/warm_700_mig.db"
TESS="C:/Program Files/Tesseract-OCR/tesseract.exe"
ELEC="./node_modules/electron/dist/electron.exe"

echo "=== OFF arm $(date +%H:%M:%S) ==="
env RR_DB="$DB" RR_IDS="$IDS" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_ALLOW_ARMED=1 TESS="$TESS" \
    RR_CONSENSUS="$DIR/off.jsonl" \
    ELECTRON_RUN_AS_NODE=1 "$ELEC" stress_test/realdoc_regression.js >"$DIR/off.log" 2>&1
echo "  off rows: $(wc -l < "$DIR/off.jsonl" 2>/dev/null || echo 0)"

echo "=== ON arm $(date +%H:%M:%S) ==="
env RR_DB="$DB" RR_IDS="$IDS" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_ALLOW_ARMED=1 TESS="$TESS" \
    GLYPH_FALLBACK_ENABLED=1 RR_LOG_MATCH="Glyph disagreement hold" RR_LOG_OUT="$DIR/fires.jsonl" \
    RR_CONSENSUS="$DIR/on.jsonl" \
    ELECTRON_RUN_AS_NODE=1 "$ELEC" stress_test/realdoc_regression.js >"$DIR/on.log" 2>&1
echo "  on rows: $(wc -l < "$DIR/on.jsonl" 2>/dev/null || echo 0)"
echo "  PP fires: $(wc -l < "$DIR/fires.jsonl" 2>/dev/null || echo 0)"
echo "DONE $(date +%H:%M:%S)"
touch "$DIR/DONE.flag"
