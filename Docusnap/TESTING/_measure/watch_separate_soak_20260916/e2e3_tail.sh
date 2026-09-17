#!/bin/bash
# e2e3_tail.sh MINID — steps 5-6 of e2e3_run.sh on an ALREADY signed-in sandbox app (main window open on port 9223):
# start the import of Manual_E2E3, poll the stashed result, score with soak_e2e_check.js. Logs every exit reason.
set -u
SP="C:/Users/cmccu/AppData/Local/Temp/claude/c--GIT-Projects-Docusnap/2d87d505-1b3b-4522-b756-384e51badc0d/scratchpad"
REPO="C:/GIT Projects/Docusnap"; M="$REPO/TESTING/_measure/watch_separate_soak_20260916"
VP="$REPO/tools/video_tutorials/.venv/Scripts/python.exe"; EL="$REPO/node_modules/electron/dist/electron.exe"
UD="$SP/soak/userData"; LOG="$M/e2e3_run.log"; PORT=9223; MINID="${1:?minId}"
log() { echo "$(date +%H:%M:%S) $*" >> "$LOG"; }
trap 'log "EXIT status $? at line $LINENO"' EXIT
log "tail start minId=$MINID"
FOLDER="$SP/soak/Manual_E2E3"
"$VP" "$M/e2e_cdp.py" $PORT windows/main "window.__e2e = null; window.docusnap.processFolder('$FOLDER').then(r => { window.__e2e = JSON.stringify(r); }, e => { window.__e2e = 'ERR ' + e; }); 'started'" >> "$LOG" 2>&1
log "import started on $FOLDER"
for i in $(seq 1 240); do
  sleep 30
  R=$("$VP" "$M/e2e_cdp.py" $PORT windows/main "window.__e2e" 2>/dev/null || true)
  if [ -n "$R" ] && [ "$R" != "null" ]; then log "import result: $(echo "$R" | cut -c1-300)"; break; fi
  if [ $((i % 4)) -eq 0 ]; then log "still importing… $(ELECTRON_RUN_AS_NODE=1 "$EL" "$SP/sandbox_settings.js" "$UD/docusnap.db" 2>/dev/null | grep -o 'max doc id [0-9]*' || true)"; fi
done
sleep 20
ELECTRON_RUN_AS_NODE=1 "$EL" "$M/soak_e2e_check.js" "$UD/docusnap.db" "$MINID" "$SP/soak/gt_e2e3.json" > "$M/e2e3_result.txt" 2>&1
log "checker done: $(tail -1 "$M/e2e3_result.txt" | cut -c1-200)"
echo E2E3-DONE >> "$LOG"
