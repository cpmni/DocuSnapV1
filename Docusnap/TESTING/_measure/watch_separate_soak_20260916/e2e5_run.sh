#!/bin/bash
# e2e5_run.sh — restart the SANDBOX app on the current code (the handler loads split_plan.js at start), sign in, then run
# e2e5_tail.sh (the blur-pair re-run). Detached: PowerShell Start-Process bash e2e5_run.sh; watch e2e5_run.log.
set -u
SP="C:/Users/cmccu/AppData/Local/Temp/claude/c--GIT-Projects-Docusnap/2d87d505-1b3b-4522-b756-384e51badc0d/scratchpad"
REPO="C:/GIT Projects/Docusnap"; M="$REPO/TESTING/_measure/watch_separate_soak_20260916"
VP="$REPO/tools/video_tutorials/.venv/Scripts/python.exe"
UD="$SP/soak/userData"; LOG="$M/e2e5_run.log"; PORT=9223
log() { echo "$(date +%H:%M:%S) $*" >> "$LOG"; }
: > "$LOG"; log "restart start"
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*remote-debugging-port=9223*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1
sleep 4
powershell -NoProfile -Command "\$env:DOCUSNAP_USERDATA='$(cygpath -w "$UD")'; Start-Process cmd -ArgumentList '/c','npm start -- --remote-debugging-port=$PORT' -WorkingDirectory '$(cygpath -w "$REPO")' -WindowStyle Hidden -RedirectStandardOutput '$(cygpath -w "$SP/soak/app6.log")' -RedirectStandardError '$(cygpath -w "$SP/soak/app6.err")'"
for i in $(seq 1 60); do sleep 3; "$VP" "$M/e2e_cdp.py" $PORT windows/login "1" >/dev/null 2>&1 && break; done
"$VP" "$M/e2e_cdp.py" $PORT windows/login "window.docusnap.authLogin({username:'admin', password:'Scan-Finder-2026'}).then(r => { window.__login = JSON.stringify(r); if (r && r.success) window.docusnap.authEnterApp(); }, e => { window.__login = 'ERR ' + e; }); 'sent'" >> "$LOG" 2>&1
for i in $(seq 1 40); do sleep 3; "$VP" "$M/e2e_cdp.py" $PORT windows/main "1" >/dev/null 2>&1 && break; done
sleep 8
log "main window: $("$VP" "$M/e2e_cdp.py" $PORT --list 2>&1 | tr '\n' ' ' | cut -c1-200)"
bash "$M/e2e5_tail.sh"
