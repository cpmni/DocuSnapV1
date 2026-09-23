#!/usr/bin/env bash
# S0 measurement (007 + oscar, 2026-09-23 night): the 727-doc owner-DB-copy arm with the second reader ON
# (mig 207 hold + mig 210 downgrade; RELEASE off) and the engine TRACE captured, after the geometry fix
# (taught_box centre->top-left, geometry follows the winner, anchor page 0, _crop_pages for every doc).
# Answers: glyph_check outcome histogram (agree / abstain:no_box / disagreement) by geom_src; on the 82
# disagreeing-read + 9 soften docs, does PP side with the box or the page, and which is right vs the confirmed GT.
set -u
cd "c:/GIT Projects/Docusnap"
DB="stress_test/out/c0_live_copy/docusnap.db"
D="stress_test/out/c0_release"
OUT="$D/glyph_on.jsonl"; TR="$D/glyph_on.trace.jsonl"; LOG="$D/glyph_on.log"
: > "$OUT"; : > "$TR"
echo "START $(date)" > "$D/glyph_on.status"
env RR_DB="$DB" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_CONSENSUS="$OUT" RR_TRACE_OUT="$TR" \
    GLYPH_FALLBACK_ENABLED=1 GLYPH_CONFUSABLE_RESOLVE=1 \
    TESS="C:/Program Files/Tesseract-OCR/tesseract.exe" \
    ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >"$LOG" 2>&1
echo "END $(date) rows=$(wc -l < "$OUT") trace=$(wc -l < "$TR")" >> "$D/glyph_on.status"
touch "$D/GLYPH_ON_DONE.flag"
