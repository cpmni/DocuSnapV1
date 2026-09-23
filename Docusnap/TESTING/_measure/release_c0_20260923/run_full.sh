#!/usr/bin/env bash
# C0 FULL arm (Oracle 2026-09-23, confusable RELEASE flip gate): every CONFIRMED doc in the read-only live-DB COPY
# (stress_test/out/c0_live_copy/, gitignored), app operating point (RR_APP_ENV=1), glyph switches OFF (baseline),
# corroboration record captured per ref/date (RR_CONSENSUS `corrob`). Output stays under stress_test/out.
set -u
cd "c:/GIT Projects/Docusnap"
DB="stress_test/out/c0_live_copy/docusnap.db"
D="stress_test/out/c0_release"
OUT="$D/full.jsonl"; LOG="$D/full.log"
: > "$OUT"
echo "START $(date)" > "$D/full.status"
env RR_DB="$DB" OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_CONSENSUS="$OUT" TESS="C:/Program Files/Tesseract-OCR/tesseract.exe" \
    ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js >"$LOG" 2>&1
echo "END $(date) rows=$(wc -l < "$OUT")" >> "$D/full.status"
touch "$D/FULL_DONE.flag"
