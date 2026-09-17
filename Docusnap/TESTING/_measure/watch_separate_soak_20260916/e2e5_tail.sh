#!/bin/bash
# e2e5_tail.sh — the blur-pair re-run after the "unreadable predecessor" arm (2026-09-17): import Manual_E2E5 (the two
# ctrl5_blur_* controls) into the ALREADY signed-in sandbox app (port 9223; the app must have been RESTARTED on the new
# split_plan.js first — the handler requires split_plan at load), score with soak_e2e_check.js against gt_e2e5.json.
set -u
SP="C:/Users/cmccu/AppData/Local/Temp/claude/c--GIT-Projects-Docusnap/2d87d505-1b3b-4522-b756-384e51badc0d/scratchpad"
REPO="C:/GIT Projects/Docusnap"; M="$REPO/TESTING/_measure/watch_separate_soak_20260916"
VP="$REPO/tools/video_tutorials/.venv/Scripts/python.exe"; EL="$REPO/node_modules/electron/dist/electron.exe"
UD="$SP/soak/userData"; LOG="$M/e2e5_run.log"; PORT=9223
log() { echo "$(date +%H:%M:%S) $*" >> "$LOG"; }
: > "$LOG"; trap 'log "EXIT status $? at line $LINENO"' EXIT
cd "$REPO"
MINID=$(ELECTRON_RUN_AS_NODE=1 "$EL" "$SP/sandbox_settings.js" "$UD/docusnap.db" 2>/dev/null | grep "max doc id" | sed -E 's/.*max doc id ([0-9]+).*/\1/')
log "start minId=$MINID"
FOLDER="$SP/soak/Manual_E2E5"
"$VP" "$M/e2e_cdp.py" $PORT windows/main "window.__e2e = null; window.docusnap.processFolder('$FOLDER').then(r => { window.__e2e = JSON.stringify(r); }, e => { window.__e2e = 'ERR ' + e; }); 'started'" >> "$LOG" 2>&1
log "import started on $FOLDER"
for i in $(seq 1 40); do
  sleep 15
  R=$("$VP" "$M/e2e_cdp.py" $PORT windows/main "window.__e2e" 2>/dev/null || true)
  if [ -n "$R" ] && [ "$R" != "null" ]; then log "import result: $(echo "$R" | cut -c1-300)"; break; fi
done
sleep 20
ELECTRON_RUN_AS_NODE=1 "$EL" "$M/soak_e2e_check.js" "$UD/docusnap.db" "$MINID" "$SP/soak/gt_e2e5.json" > "$M/e2e5_result.txt" 2>&1
log "checker done: $(tail -1 "$M/e2e5_result.txt" | cut -c1-200)"
echo E2E5-DONE >> "$LOG"
