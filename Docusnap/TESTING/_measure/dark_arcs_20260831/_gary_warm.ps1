$REPO = 'C:\GIT Projects\Docusnap'
$TMPD = 'C:\Users\cmccu\.claude\jobs\a8d11584\tmp'
$HS = 'C:\Users\cmccu\Desktop\Hard Set'
$env:ELECTRON_RUN_AS_NODE = '1'
$env:OCR_RENDER_DPI = '200'
$env:BUYER_ISSUED_CONVENTION_NOTE = '1'
Set-Location $REPO
$env:RR_DB = "$TMPD\live_20260831.db"
Write-Output "=== gary warm LIVE === $(Get-Date -Format 'HH:mm:ss')"
cmd /c "node_modules\.bin\electron.cmd stress_test\score_hard_set.js scan warm > `"$TMPD\runs\hardscore_GARY_live.txt`" 2>&1"
Copy-Item -Force "$HS\score_scan_warm.md" "$HS\score_scan_warm_GARY_LIVE.md"
Copy-Item -Force "$HS\score_scan_warm.jsonl" "$HS\score_scan_warm_GARY_LIVE.jsonl"
$env:RR_DB = "$TMPD\stripped_gary.db"
Write-Output "=== gary warm STRIPPED === $(Get-Date -Format 'HH:mm:ss')"
cmd /c "node_modules\.bin\electron.cmd stress_test\score_hard_set.js scan warm > `"$TMPD\runs\hardscore_GARY_stripped.txt`" 2>&1"
Copy-Item -Force "$HS\score_scan_warm.md" "$HS\score_scan_warm_GARY_STRIPPED.md"
Copy-Item -Force "$HS\score_scan_warm.jsonl" "$HS\score_scan_warm_GARY_STRIPPED.jsonl"
Write-Output 'GARY WARM ARMS DONE'