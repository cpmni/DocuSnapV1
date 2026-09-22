# Full pin suite: Python (pytest-style files via pytest; script-style files as modules) then JS (Electron-as-Node).
# Writes one line per file to tmp/runs/suite_python.txt / suite_js.txt; a FAIL line = non-zero exit.
$REPO = 'C:\GIT Projects\Docusnap'
$RUNS = 'C:\Users\cmccu\.claude\jobs\a8d11584\tmp\runs'
$env:PYTHONIOENCODING = 'utf-8'
Set-Location "$REPO\python_backend"
$py = "$RUNS\suite_python.txt"
"# python suite $(Get-Date -Format 'HH:mm:ss')" | Set-Content -Encoding utf8 $py
$files = Get-ChildItem tests -Filter 'test_*.py' | Sort-Object Name
$pyt = @(); $scr = @()
foreach ($f in $files) { if (Select-String -Path $f.FullName -Pattern '^def test_' -Quiet) { $pyt += $f } else { $scr += $f } }
"# pytest-style: $($pyt.Count) files; script-style: $($scr.Count) files" | Add-Content -Encoding utf8 $py
foreach ($f in $pyt) {
  $out = & py -3.12 -m pytest $f.FullName -q -p no:cacheprovider 2>&1 | Out-String
  $tail = (($out -split "`n") | Where-Object { $_.Trim() } | Select-Object -Last 1)
  "$(if ($LASTEXITCODE -eq 0) {'PASS'} else {'FAIL'}) pytest $($f.Name) :: $($tail.Trim())" | Add-Content -Encoding utf8 $py
}
foreach ($f in $scr) {
  $mod = 'tests.' + $f.BaseName
  $out = & py -3.12 -m $mod 2>&1 | Out-String
  $tail = (($out -split "`n") | Where-Object { $_.Trim() } | Select-Object -Last 1)
  "$(if ($LASTEXITCODE -eq 0) {'PASS'} else {'FAIL'}) script $($f.Name) :: $($tail.Trim())" | Add-Content -Encoding utf8 $py
}
"# python done $(Get-Date -Format 'HH:mm:ss')" | Add-Content -Encoding utf8 $py

Set-Location $REPO
$js = "$RUNS\suite_js.txt"
"# js suite $(Get-Date -Format 'HH:mm:ss')" | Set-Content -Encoding utf8 $js
$env:ELECTRON_RUN_AS_NODE = '1'
$jsFiles = @()
$jsFiles += Get-ChildItem database\modules -Filter 'test_*.js'
$jsFiles += Get-ChildItem src\modules -Recurse -Filter 'test_*.js'
$jsFiles += Get-ChildItem src\services -Filter 'test_*.js' -ErrorAction SilentlyContinue
$jsFiles += Get-ChildItem src\windows -Recurse -Filter 'test_*.js'
$jsFiles += Get-ChildItem src\lib -Recurse -Filter 'test_*.js' -ErrorAction SilentlyContinue
foreach ($f in ($jsFiles | Sort-Object FullName)) {
  $rel = $f.FullName.Substring($REPO.Length + 1)
  $out = cmd /c "node_modules\.bin\electron.cmd `"$($f.FullName)`" 2>&1" | Out-String
  $code = $LASTEXITCODE
  $tail = (($out -split "`n") | Where-Object { $_.Trim() -and $_ -notmatch 'JS migration' } | Select-Object -Last 1)
  "$(if ($code -eq 0) {'PASS'} else {'FAIL'}) $rel :: $(if ($tail) { $tail.Trim() } else { '' })" | Add-Content -Encoding utf8 $js
}
"# js done $(Get-Date -Format 'HH:mm:ss')" | Add-Content -Encoding utf8 $js
Write-Output 'SUITE DONE'
