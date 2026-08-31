# realdoc-605 ON arm for BUYER_ISSUED_CONVENTION_NOTE. Launch ONLY after _cellbelow_on2.ps1
# printed ON2 ARMS DONE (same DB copy). OFF == cb_off by construction. Gate: M unchanged;
# would-file unchanged EXCEPT buyer-issued docs gaining the note (each enumerated — the count of
# live POs lacking the licence is the owner's trade-off surface).
$REPO = 'C:\GIT Projects\Docusnap'
$RUNS = 'C:\Users\cmccu\.claude\jobs\a8d11584\tmp\runs'
try { Start-Transcript -Path "$RUNS\gary_ab.log" -Force | Out-Null } catch {}
$env:RR_DB = 'C:\Users\cmccu\.claude\jobs\a8d11584\tmp\realdoc_cellbelow.db'
$env:RR_APP_ENV = '1'
$env:OCR_RENDER_DPI = '200'
$env:ELECTRON_RUN_AS_NODE = '1'
$env:KEYWORD_CELL_BELOW = '0'
$env:MONEY_SIGN_PARENS = '0'
$env:MONEY_SIGN_CR = '0'
$env:BUYER_ISSUED_CONVENTION_NOTE = '1'
$env:RR_IDS = (Get-Content 'C:\GIT Projects\Docusnap\TESTING\_measure\reslice_20260830\runs\rr_ids_dedup.txt' -Raw).Trim()
Set-Location $REPO
# Oracle C2: arm 1 pins the deskew retry OFF so "ON differs only by gaining the note" is provable;
# arm 2 lets the live profile's retry run and its diffs are ENUMERATED (skewed buyer-issued POs
# may adopt straightened reads — review-bound, but counted).
foreach ($arm in @('gary', 'gary_deskew')) {
  Write-Output "=== $arm arm === $(Get-Date -Format 'HH:mm:ss')"
  $env:DESKEW_REVIEW_RETRY = if ($arm -eq 'gary') { '0' } else { '1' }
  $env:RR_DUMP = Join-Path $RUNS "cb_${arm}_dump.jsonl"
  $env:RR_CONSENSUS = Join-Path $RUNS "cb_${arm}_consensus.jsonl"
  foreach ($f in @($env:RR_DUMP, $env:RR_CONSENSUS)) { if (Test-Path $f) { Remove-Item $f -Force } }
  cmd /c "node_modules\.bin\electron.cmd stress_test\realdoc_regression.js > `"$RUNS\cb_${arm}_console.txt`" 2>&1"
  Copy-Item -Force 'stress_test\out\realdoc_regression.md' (Join-Path $RUNS "cb_$arm.md")
  Write-Output "$arm done $(Get-Date -Format 'HH:mm:ss')"
}
Write-Output 'GARY ARM DONE'
try { Stop-Transcript | Out-Null } catch {}
