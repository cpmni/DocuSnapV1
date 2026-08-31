# realdoc-605: re-run of the cellbelow ON arm on the ORACLE-CONDITIONED build (C1-C3 applied),
# then the moneysign arm — both against the same copy the off arm used. Launch ONLY after
# _cellbelow_ab.ps1 printed CB ARMS DONE (same DB copy). Diff each vs cb_off (Oracle C6: every
# previously-non-empty field byte-identical INCLUDING confidence; diffs strictly empty->filled;
# M unchanged; would-file + corroboration diffs enumerated).
$REPO = 'C:\GIT Projects\Docusnap'
$RUNS = 'C:\Users\cmccu\.claude\jobs\a8d11584\tmp\runs'
# Self-logging (Start-Process stdout redirects proved unreliable here — the log file was never
# created and the child sat headless): the runner owns its own transcript.
try { Start-Transcript -Path "$RUNS\cb_on2.log" -Force | Out-Null } catch {}
$env:RR_DB = 'C:\Users\cmccu\.claude\jobs\a8d11584\tmp\realdoc_cellbelow.db'
$env:RR_APP_ENV = '1'
$env:OCR_RENDER_DPI = '200'
$env:ELECTRON_RUN_AS_NODE = '1'
$env:RR_IDS = (Get-Content 'C:\GIT Projects\Docusnap\TESTING\_measure\reslice_20260830\runs\rr_ids_dedup.txt' -Raw).Trim()
Set-Location $REPO
foreach ($arm in @('cellbelow2', 'moneysign')) {
  Write-Output "=== $arm arm === $(Get-Date -Format 'HH:mm:ss')"
  $env:KEYWORD_CELL_BELOW = if ($arm -eq 'cellbelow2') { '1' } else { '0' }
  $env:MONEY_SIGN_PARENS  = if ($arm -eq 'moneysign') { '1' } else { '0' }
  $env:MONEY_SIGN_CR      = if ($arm -eq 'moneysign') { '1' } else { '0' }
  $env:RR_DUMP = Join-Path $RUNS "cb_${arm}_dump.jsonl"
  $env:RR_CONSENSUS = Join-Path $RUNS "cb_${arm}_consensus.jsonl"
  foreach ($f in @($env:RR_DUMP, $env:RR_CONSENSUS)) { if (Test-Path $f) { Remove-Item $f -Force } }
  cmd /c "node_modules\.bin\electron.cmd stress_test\realdoc_regression.js > `"$RUNS\cb_${arm}_console.txt`" 2>&1"
  Copy-Item -Force 'stress_test\out\realdoc_regression.md' (Join-Path $RUNS "cb_$arm.md")
  Write-Output "$arm done $(Get-Date -Format 'HH:mm:ss')"
}
Write-Output 'ON2 ARMS DONE'
try { Stop-Transcript | Out-Null } catch {}
