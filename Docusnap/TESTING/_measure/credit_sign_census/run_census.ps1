# run_census.ps1 — the raw_value-on-keyword-money credit-sign census (commit 32ae95b).
#
# Isolates my change (keyword mint now emits raw_value → arms validator arm 2 on keyword totals) by
# running the SAME DB copy + corpus twice, differing ONLY in keyword.py:
#   OFF arm = keyword.py at 32ae95b^ (pre-change)   ON arm = HEAD
# Then census_credit_sign.js diffs: 0 committed-value diffs (additive) + the list of totals newly
# routed to Review (human-classify TRUE catch vs FALSE flag) + a non-vacuity guard.
#
# PREREQ: a db.backup() COPY of the live DB (NEVER the live file), py -3.12, Tesseract at the dev path.
# RUN (from anywhere):
#   powershell -File "C:\GIT Projects\Docusnap\TESTING\_measure\credit_sign_census\run_census.ps1" `
#       -DbCopy "C:\path\to\live_copy.db"
# Options: -Corpus <dir> (default the Test Corpus), -Types <regex> (folder filter), -Out <dir>.
param(
  [Parameter(Mandatory=$true)][string]$DbCopy,
  [string]$Corpus = "$env:USERPROFILE\Desktop\ScanFinder Test Corpus",
  [string]$Types  = 'invoice|credit_note|statement|sales_order|purchase_order|quote',
  [string]$Out    = "C:\GIT Projects\Docusnap\TESTING\_measure\credit_sign_census\runs"
)
$ErrorActionPreference = 'Stop'
$REPO_ROOT = 'C:\GIT Projects'                 # git toplevel (app lives under Docusnap/)
$APP       = 'C:\GIT Projects\Docusnap'
$KWSPEC    = 'Docusnap/python_backend/extraction/keyword.py'   # pathspec from the git root
$RUNDOCS   = Join-Path $APP 'TESTING\_measure\reslice_20260830\_run_docs.js'
$CENSUS    = Join-Path $APP 'TESTING\_measure\credit_sign_census\census_credit_sign.js'
$ELECTRON  = Join-Path $APP 'node_modules\.bin\electron.cmd'
$PYCACHE   = Join-Path $APP 'python_backend\extraction\__pycache__'

if (-not (Test-Path $DbCopy)) { throw "DbCopy not found: $DbCopy" }
if (-not (Test-Path $Corpus)) { throw "Corpus not found: $Corpus" }
New-Item -ItemType Directory -Force $Out | Out-Null

# Corpus PDFs, filtered to the money-bearing types (a total is the only field arm 2 flags).
$pdfs = Get-ChildItem -Path $Corpus -Recurse -Filter *.pdf |
        Where-Object { $_.Directory.Name -match $Types } |
        Select-Object -ExpandProperty FullName
if (-not $pdfs) { throw "no PDFs under $Corpus matching types /$Types/" }
$listFile = Join-Path $Out '_files.txt'
Set-Content -Path $listFile -Value $pdfs -Encoding utf8
Write-Output "corpus: $($pdfs.Count) PDFs (types /$Types/) -> $listFile"

# Product-faithful env: OCR at the product DPI (200); _run_docs.js mirrors the copy's app env otherwise.
# CREDIT_SIGN_COHERENCE is intentionally NOT forced here — it must come from the copy's own settings
# (money_sign_parens/cr → _reconcileEnv), so the run is faithful; the census flags a vacuous run.
$env:ELECTRON_RUN_AS_NODE = '1'
$env:OCR_RENDER_DPI = '200'

function Run-Arm([string]$label) {
  if (Test-Path $PYCACHE) { Remove-Item -Recurse -Force $PYCACHE }   # keyword.py changed between arms
  Write-Output "=== $label arm === $(Get-Date -Format 'HH:mm:ss')"
  & $ELECTRON $RUNDOCS $DbCopy $Out $label ("@" + $listFile)
  if (-not (Test-Path (Join-Path $Out "${label}_summary.json"))) { throw "$label arm produced no summary" }
}

try {
  # ON arm — tree is at HEAD (my change present)
  Run-Arm 'on'
  # OFF arm — check out ONLY keyword.py at the pre-change parent, run, then restore
  git -C $REPO_ROOT checkout '32ae95b^' -- $KWSPEC
  if ($LASTEXITCODE -ne 0) { throw 'git checkout of the pre-change keyword.py failed' }
  Run-Arm 'off'
}
finally {
  # ALWAYS restore HEAD keyword.py + clear the cache, even on error/Ctrl-C
  git -C $REPO_ROOT checkout HEAD -- $KWSPEC 2>$null
  if (Test-Path $PYCACHE) { Remove-Item -Recurse -Force $PYCACHE }
  Write-Output "restored keyword.py to HEAD"
}

Write-Output "`n=== census ==="
& node $CENSUS (Join-Path $Out 'off_summary.json') (Join-Path $Out 'on_summary.json')
Write-Output "`nsummaries: $Out\{on,off}_summary.json ; jsonl: $Out\{on,off}.jsonl"
