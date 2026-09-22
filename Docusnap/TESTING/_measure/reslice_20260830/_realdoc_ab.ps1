# Full realdoc A/B on the live-DB COPY, four arms (Oracle gate: each switch alone AND all-on):
#   off, sweep, discount, all  — strict-money is NEVER flipped in this arc (Oracle C11), so "all" = sweep + discount.
# Product-faithful: RR_APP_ENV=1 mirrors the app's spawn env from the copy; OCR_RENDER_DPI=200 (the harness never
# mirrors _ocrDpiEnv). Explicit '0' on the OFF legs (the != '0' idiom trap). Per arm: the report, RR_DUMP (per-doc
# would-file), RR_CONSENSUS (per-doc fields incl. method+note), RESLICE_CENSUS_DIR + XCHECK_DEMOTE_CENSUS_DIR.
$REPO = 'C:\GIT Projects\Docusnap'
$RUNS = 'C:\Users\cmccu\.claude\jobs\a8d11584\tmp\runs'
$env:RR_DB = 'C:\Users\cmccu\.claude\jobs\a8d11584\tmp\live_20260830_evening.db'
$env:RR_APP_ENV = '1'
$env:OCR_RENDER_DPI = '200'
$env:ELECTRON_RUN_AS_NODE = '1'
$env:TEMPLATE_FORMAT_FAIL_YIELD_STRICT_MONEY = '0'
# ONE representative per PAPER (owner 2026-08-30: most confirmed docs are re-imports of the same document —
# 1,940 files = 618 byte-distinct = 605 distinct (type, supplier, ref, date)). Built by _dedup_ids.py.
$env:RR_IDS = (Get-Content "$RUNS\rr_ids_dedup.txt" -Raw).Trim()
Set-Location $REPO
foreach ($arm in @('off', 'sweep', 'discount', 'all')) {
  Write-Output "=== $arm arm === $(Get-Date -Format 'HH:mm:ss')"
  $env:RESLICE_WITNESS_SWEEP = if ($arm -eq 'sweep' -or $arm -eq 'all') { '1' } else { '0' }
  $env:CORROB_DISCOUNT_INVALID_WITNESS = if ($arm -eq 'discount' -or $arm -eq 'all') { '1' } else { '0' }
  $cdir = Join-Path $RUNS "census_realdoc_$arm"
  New-Item -ItemType Directory -Force $cdir | Out-Null
  $env:RESLICE_CENSUS_DIR = $cdir
  $env:XCHECK_DEMOTE_CENSUS_DIR = $cdir
  $env:RR_DUMP = Join-Path $RUNS "realdoc_${arm}_dump.jsonl"
  $env:RR_CONSENSUS = Join-Path $RUNS "realdoc_${arm}_consensus.jsonl"
  foreach ($f in @($env:RR_DUMP, $env:RR_CONSENSUS)) { if (Test-Path $f) { Remove-Item $f -Force } }
  $console = Join-Path $RUNS "realdoc_${arm}_console.txt"
  cmd /c "node_modules\.bin\electron.cmd stress_test\realdoc_regression.js > `"$console`" 2>&1"
  Copy-Item -Force 'stress_test\out\realdoc_regression.md' (Join-Path $RUNS "realdoc_$arm.md")
  Write-Output "$arm done $(Get-Date -Format 'HH:mm:ss')"
}
Write-Output 'ALL ARMS DONE'
