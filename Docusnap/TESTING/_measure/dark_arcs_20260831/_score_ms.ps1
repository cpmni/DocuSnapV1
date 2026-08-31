$REPO = 'C:\GIT Projects\Docusnap'
$TMPD = 'C:\Users\cmccu\.claude\jobs\a8d11584\tmp'
$env:RR_DB = "$TMPD\live_20260831.db"
$env:ELECTRON_RUN_AS_NODE = '1'
$env:OCR_RENDER_DPI = '200'
$env:KEYWORD_CELL_BELOW = '1'
$env:MONEY_SIGN_PARENS = '1'
$env:MONEY_SIGN_CR = '1'
Set-Location $REPO
foreach ($arm in @(@('scan', 'cold'), @('digital', 'cold'))) {
  $r = $arm[0]; $m = $arm[1]
  Write-Output "=== MS $r $m === $(Get-Date -Format 'HH:mm:ss')"
  cmd /c "node_modules\.bin\electron.cmd stress_test\score_hard_set.js $r $m > `"$TMPD\runs\hardscore_MS_${r}_${m}.txt`" 2>&1"
  Write-Output "$r $m done exit=$LASTEXITCODE $(Get-Date -Format 'HH:mm:ss')"
}
Write-Output 'MONEYSIGN ARMS DONE'