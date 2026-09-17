#!/bin/bash
# e2e3_run.sh — the mig-179 end-to-end run (Oracle C6): restart the SANDBOX app (a live-DB copy, sandbox paths) on the
# current code with the THREE separator switches armed, import Manual_E2E3 (every stack + every control set, 72 files)
# through the app's own process-folder road over DevTools, then score with soak_e2e_check.js against gt_e2e3.json.
# Detached: PowerShell Start-Process bash e2e3_run.sh; watch e2e3_run.log. Never touches the live install.
set -u
SP="C:/Users/cmccu/AppData/Local/Temp/claude/c--GIT-Projects-Docusnap/2d87d505-1b3b-4522-b756-384e51badc0d/scratchpad"
REPO="C:/GIT Projects/Docusnap"; M="$REPO/TESTING/_measure/watch_separate_soak_20260916"
VP="$REPO/tools/video_tutorials/.venv/Scripts/python.exe"; EL="$REPO/node_modules/electron/dist/electron.exe"
UD="$SP/soak/userData"; LOG="$M/e2e3_run.log"; PORT=9223
log() { echo "$(date +%H:%M:%S) $*" >> "$LOG"; }
: > "$LOG"; log "start"
# 1. stop the running sandbox app (every process whose command line carries the 9223 port: npm cmd, node launcher, electron)
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*remote-debugging-port=9223*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1
sleep 4
log "sandbox app stopped: $(powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*remote-debugging-port=9223*' }).Count") left"
# 2. arm the third switch in the sandbox DB (177/178/176 already 'true' there)
cd "$REPO"
ELECTRON_RUN_AS_NODE=1 "$EL" tools/video_tutorials/sandbox_setting.js "$UD" segment_known_supplier_change true >> "$LOG" 2>&1
MINID=$(ELECTRON_RUN_AS_NODE=1 "$EL" "$SP/sandbox_settings.js" "$UD/docusnap.db" 2>/dev/null | grep "max doc id" | sed -E 's/.*max doc id ([0-9]+).*/\1/')
log "minId=$MINID"; echo "$MINID" > "$M/e2e3_minid.txt"
# 3. launch the dev app on the sandbox userData (detached; its own log)
powershell -NoProfile -Command "\$env:DOCUSNAP_USERDATA='$(cygpath -w "$UD")'; Start-Process cmd -ArgumentList '/c','npm start -- --remote-debugging-port=$PORT' -WorkingDirectory '$(cygpath -w "$REPO")' -WindowStyle Hidden -RedirectStandardOutput '$(cygpath -w "$SP/soak/app4.log")' -RedirectStandardError '$(cygpath -w "$SP/soak/app4.err")'"
# 4. wait for the login page, sign in, wait for the main window
for i in $(seq 1 60); do sleep 3; "$VP" "$M/e2e_cdp.py" $PORT windows/login "1" >/dev/null 2>&1 && break; done
log "login page: $("$VP" "$M/e2e_cdp.py" $PORT --list 2>&1 | tr '\n' ' ' | cut -c1-300)"
# authLogin only verifies; the login renderer then calls authEnterApp() to swap to the main window — do both.
"$VP" "$M/e2e_cdp.py" $PORT windows/login "window.docusnap.authLogin({username:'admin', password:'Scan-Finder-2026'}).then(r => { window.__login = JSON.stringify(r); if (r && r.success) window.docusnap.authEnterApp(); }, e => { window.__login = 'ERR ' + e; }); 'sent'" >> "$LOG" 2>&1
for i in $(seq 1 40); do sleep 3; "$VP" "$M/e2e_cdp.py" $PORT windows/main "1" >/dev/null 2>&1 && break; done
sleep 8
log "main window: $("$VP" "$M/e2e_cdp.py" $PORT --list 2>&1 | tr '\n' ' ' | cut -c1-300)"
# 5. one manual import of the whole folder through the app's own road (non-awaiting call; result stashed on window)
FOLDER="$SP/soak/Manual_E2E3"
"$VP" "$M/e2e_cdp.py" $PORT windows/main "window.__e2e = null; window.docusnap.processFolder('$FOLDER').then(r => { window.__e2e = JSON.stringify(r); }, e => { window.__e2e = 'ERR ' + e; }); 'started'" >> "$LOG" 2>&1
log "import started on $FOLDER"
for i in $(seq 1 240); do
  sleep 30
  R=$("$VP" "$M/e2e_cdp.py" $PORT windows/main "window.__e2e" 2>/dev/null)
  if [ -n "$R" ] && [ "$R" != "null" ]; then log "import result: $(echo "$R" | cut -c1-300)"; break; fi
  if [ $((i % 4)) -eq 0 ]; then log "still importing… docs now $(ELECTRON_RUN_AS_NODE=1 "$EL" "$SP/sandbox_settings.js" "$UD/docusnap.db" 2>/dev/null | grep -o 'max doc id [0-9]*')"; fi
done
sleep 20
# 6. score
ELECTRON_RUN_AS_NODE=1 "$EL" "$M/soak_e2e_check.js" "$UD/docusnap.db" "$MINID" "$SP/soak/gt_e2e3.json" > "$M/e2e3_result.txt" 2>&1
log "checker done: $(tail -1 "$M/e2e3_result.txt" | cut -c1-200)"
echo E2E3-DONE >> "$LOG"
