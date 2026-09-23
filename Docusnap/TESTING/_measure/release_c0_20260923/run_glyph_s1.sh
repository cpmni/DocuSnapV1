#!/usr/bin/env bash
# S1 re-census (Oracle C2/C10, 2026-09-23 night): the 727-doc owner-DB-copy arm with the second reader ON, the
# DOWNGRADE on, and SLICE INTEGRITY on (the reader's rect snapped to the page word boxes), every exit traced.
# Compare against glyph_on.* (C1-only, same floor) with analyse_glyph_on.js.
set -u
cd "c:/GIT Projects/Docusnap"
DB="stress_test/out/c0_live_copy/docusnap.db"
D="stress_test/out/c0_release"
OUT="$D/glyph_s1.jsonl"; TR="$D/glyph_s1.trace.jsonl"; LOG="$D/glyph_s1.log"
: > "$OUT"; : > "$TR"
echo "START $(date)" > "$D/glyph_s1.status"
env RR_DB="$DB" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_CONSENSUS="$OUT" RR_TRACE_OUT="$TR" \
    GLYPH_FALLBACK_ENABLED=1 GLYPH_CONFUSABLE_RESOLVE=1 GLYPH_SLICE_INTEGRITY=1 \
    TESS="C:/Program Files/Tesseract-OCR/tesseract.exe" \
    ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >"$LOG" 2>&1
echo "END $(date) rows=$(wc -l < "$OUT") trace=$(wc -l < "$TR")" >> "$D/glyph_s1.status"
touch "$D/GLYPH_S1_DONE.flag"
