#!/bin/bash
# e2e4_run.sh — the mig-180 (segment PAIR hold) end-to-end run (Oracle gate: truncatedAutoFiled = 0 AND truncatedUnmarked
# = 0; every merged cut marked; the auto-file set of every non-split file identical). Rebuilds Manual_E2E4 from the same
# 72 source files as e2e3 (gt_e2e3.json), restarts the SANDBOX app (a live-DB copy, sandbox paths) on the current code
# with the FOUR separator switches armed (177/178/179 already 'true' in the sandbox DB + 180 armed here; mig 176 default
# ON), imports through the app's own process-folder road over DevTools, scores with soak_e2e_check.js.
# Detached: PowerShell Start-Process bash e2e4_run.sh; watch e2e4_run.log. Never touches the live install.
set -u
SP="C:/Users/cmccu/AppData/Local/Temp/claude/c--GIT-Projects-Docusnap/2d87d505-1b3b-4522-b756-384e51badc0d/scratchpad"
REPO="C:/GIT Projects/Docusnap"; M="$REPO/TESTING/_measure/watch_separate_soak_20260916"
VP="$REPO/tools/video_tutorials/.venv/Scripts/python.exe"; EL="$REPO/node_modules/electron/dist/electron.exe"
UD="$SP/soak/userData"; LOG="$M/e2e4_run.log"; PORT=9223
log() { echo "$(date +%H:%M:%S) $*" >> "$LOG"; }
: > "$LOG"; log "start"
trap 'log "EXIT status $? at line $LINENO"' EXIT
# 0. rebuild the import folder from the gt keys (the e2e3 folder was consumed: drained + originals set aside)
FOLDER="$SP/soak/Manual_E2E4"; rm -rf "$FOLDER"; mkdir -p "$FOLDER"
for k in $(py -3.12 -c "import json,sys; print('\n'.join(json.load(open(sys.argv[1], encoding='utf-8')).keys()))" "$SP/soak/gt_e2e3.json"); do
  for d in Bundles Controls Controls2 Controls3 Controls4 Controls5; do
    if [ -f "$SP/soak/$d/$k" ]; then cp "$SP/soak/$d/$k" "$FOLDER/$k"; break; fi
  done
done
log "folder built: $(ls "$FOLDER" | wc -l) files"
# 1. stop the running sandbox app (every process whose command line carries the 9223 port)
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*remote-debugging-port=9223*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1
sleep 4
log "sandbox app stopped: $(powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*remote-debugging-port=9223*' }).Count") left"
# 2. arm the pair belt in the sandbox DB (177/178/179/176 already 'true' there; mig 180 seeds at boot — the setting write
#    here pre-empts the seed, INSERT OR IGNORE leaves it)
cd "$REPO"
ELECTRON_RUN_AS_NODE=1 "$EL" tools/video_tutorials/sandbox_setting.js "$UD" segment_pair_hold true >> "$LOG" 2>&1
for k in segment_continuation_veto segment_title_slug segment_known_supplier_change split_segment_multipage_hold; do
  ELECTRON_RUN_AS_NODE=1 "$EL" tools/video_tutorials/sandbox_setting.js "$UD" $k true >> "$LOG" 2>&1
done
MINID=$(ELECTRON_RUN_AS_NODE=1 "$EL" "$SP/sandbox_settings.js" "$UD/docusnap.db" 2>/dev/null | grep "max doc id" | sed -E 's/.*max doc id ([0-9]+).*/\1/')
log "minId=$MINID"; echo "$MINID" > "$M/e2e4_minid.txt"
# 3. launch the dev app on the sandbox userData (detached; its own log)
powershell -NoProfile -Command "\$env:DOCUSNAP_USERDATA='$(cygpath -w "$UD")'; Start-Process cmd -ArgumentList '/c','npm start -- --remote-debugging-port=$PORT' -WorkingDirectory '$(cygpath -w "$REPO")' -WindowStyle Hidden -RedirectStandardOutput '$(cygpath -w "$SP/soak/app5.log")' -RedirectStandardError '$(cygpath -w "$SP/soak/app5.err")'"
# 4. wait for the login page, sign in, wait for the main window
for i in $(seq 1 60); do sleep 3; "$VP" "$M/e2e_cdp.py" $PORT windows/login "1" >/dev/null 2>&1 && break; done
log "login page: $("$VP" "$M/e2e_cdp.py" $PORT --list 2>&1 | tr '\n' ' ' | cut -c1-300)"
"$VP" "$M/e2e_cdp.py" $PORT windows/login "window.docusnap.authLogin({username:'admin', password:'Scan-Finder-2026'}).then(r => { window.__login = JSON.stringify(r); if (r && r.success) window.docusnap.authEnterApp(); }, e => { window.__login = 'ERR ' + e; }); 'sent'" >> "$LOG" 2>&1
for i in $(seq 1 40); do sleep 3; "$VP" "$M/e2e_cdp.py" $PORT windows/main "1" >/dev/null 2>&1 && break; done
sleep 8
log "main window: $("$VP" "$M/e2e_cdp.py" $PORT --list 2>&1 | tr '\n' ' ' | cut -c1-300)"
# 5. one manual import of the whole folder through the app's own road (non-awaiting call; result stashed on window)
"$VP" "$M/e2e_cdp.py" $PORT windows/main "window.__e2e = null; window.docusnap.processFolder('$FOLDER').then(r => { window.__e2e = JSON.stringify(r); }, e => { window.__e2e = 'ERR ' + e; }); 'started'" >> "$LOG" 2>&1
log "import started on $FOLDER"
for i in $(seq 1 240); do
  sleep 30
  R=$("$VP" "$M/e2e_cdp.py" $PORT windows/main "window.__e2e" 2>/dev/null || true)
  if [ -n "$R" ] && [ "$R" != "null" ]; then log "import result: $(echo "$R" | cut -c1-300)"; break; fi
  if [ $((i % 4)) -eq 0 ]; then log "still importing… $(ELECTRON_RUN_AS_NODE=1 "$EL" "$SP/sandbox_settings.js" "$UD/docusnap.db" 2>/dev/null | grep -o 'max doc id [0-9]*' || true)"; fi
done
sleep 25   # let the last release re-invokes / IO tails settle
# 6. score
ELECTRON_RUN_AS_NODE=1 "$EL" "$M/soak_e2e_check.js" "$UD/docusnap.db" "$MINID" "$SP/soak/gt_e2e3.json" > "$M/e2e4_result.txt" 2>&1
log "checker done: $(tail -1 "$M/e2e4_result.txt" | cut -c1-200)"
echo E2E4-DONE >> "$LOG"
