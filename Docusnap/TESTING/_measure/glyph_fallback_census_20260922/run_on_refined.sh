#!/usr/bin/env bash
# Re-run ONLY the ON arm with the refined predicate (alnum-normalize + same-length). OFF baseline unchanged.
set -u
cd "c:/GIT Projects/Docusnap"
SRC="TESTING/_measure/flip_census_20260921"
DIR="TESTING/_measure/glyph_fallback_census_20260922"
exec > "$DIR/run_refined.out" 2>&1
echo "STARTED $(date)"
rm -f "$DIR/DONE_REFINED.flag" "$DIR/on2.jsonl" "$DIR/fires2.jsonl"
IDS="$(cat "$SRC/rr_ids_700.txt")"
DB="$SRC/warm_700_mig.db"
TESS="C:/Program Files/Tesseract-OCR/tesseract.exe"
ELEC="./node_modules/electron/dist/electron.exe"
echo "=== ON arm (refined) $(date +%H:%M:%S) ==="
env RR_DB="$DB" RR_IDS="$IDS" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_ALLOW_ARMED=1 TESS="$TESS" \
    GLYPH_FALLBACK_ENABLED=1 RR_LOG_MATCH="Glyph disagreement hold" RR_LOG_OUT="$DIR/fires2.jsonl" \
    RR_CONSENSUS="$DIR/on2.jsonl" \
    ELECTRON_RUN_AS_NODE=1 "$ELEC" stress_test/realdoc_regression.js >"$DIR/on2.log" 2>&1
echo "  on2 rows: $(wc -l < "$DIR/on2.jsonl" 2>/dev/null || echo 0)  fires: $(wc -l < "$DIR/fires2.jsonl" 2>/dev/null || echo 0)"
echo "DONE $(date +%H:%M:%S)"
touch "$DIR/DONE_REFINED.flag"
