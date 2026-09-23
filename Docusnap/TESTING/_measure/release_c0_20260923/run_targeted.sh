#!/usr/bin/env bash
# C0 targeted arm (Oracle 2026-09-23, confusable RELEASE): reprocess the 5 census soften-set docs that exist as
# CONFIRMED docs in a READ-ONLY COPY of the live DB (stress_test/out/c0_live_copy/, gitignored), at the app's
# operating point (RR_APP_ENV=1 mirrors the copy's switch state; glyph switches OFF = baseline), and capture the
# ref's corroboration record (RR_CONSENSUS `corrob`) so "flagged" can be split into "also held by disagreeing-read"
# vs "the soften note was the only blocker". Output stays under stress_test/out (gitignored — real values).
set -u
cd "c:/GIT Projects/Docusnap"
DB="stress_test/out/c0_live_copy/docusnap.db"
OUT="stress_test/out/c0_release/targeted.jsonl"; LOG="stress_test/out/c0_release/targeted.log"
rm -f "$OUT"
env RR_DB="$DB" RR_IDS="${RR_IDS:-45,504,235,248,250}" OCR_RENDER_DPI=200 RR_APP_ENV=1 \
    RR_CONSENSUS="$OUT" TESS="C:/Program Files/Tesseract-OCR/tesseract.exe" \
    ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >"$LOG" 2>&1
echo "rows: $(wc -l < "$OUT" 2>/dev/null || echo 0)"
