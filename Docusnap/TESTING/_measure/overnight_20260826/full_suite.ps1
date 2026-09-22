$ErrorActionPreference = 'Continue'
Set-Location 'C:\GIT Projects\Docusnap'
$out = "C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\18994421-2524-48d2-a00f-9f1a01116677\scratchpad\suite"
New-Item -ItemType Directory -Force $out | Out-Null
$log = "$out\suite.log"
"START $((Get-Date).ToString('s'))" | Out-File $log -Encoding utf8

# ── JS suites (Electron-as-Node) ──
$env:ELECTRON_RUN_AS_NODE = '1'
$jsFiles = Get-ChildItem -Recurse -File -Filter 'test_*.js' -Path database, src | Where-Object { $_.FullName -notmatch '\\node_modules\\' }
$jsFail = @()
foreach ($f in $jsFiles) {
  $rel = $f.FullName.Substring((Get-Location).Path.Length + 1)
  $o = & .\node_modules\.bin\electron.cmd $f.FullName 2>&1 | Out-String
  $code = $LASTEXITCODE
  if ($code -ne 0) { $jsFail += $rel; "JS FAIL [$code] $rel`n$($o.Substring([Math]::Max(0, $o.Length - 600)))" | Out-File $log -Append -Encoding utf8 }
}
"JS: $($jsFiles.Count) files, $($jsFail.Count) failed" | Out-File $log -Append -Encoding utf8
$jsFail | Out-File "$out\js_failed.txt" -Encoding utf8

# ── Python script-style + pytest-style ──
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Set-Location 'C:\GIT Projects\Docusnap\python_backend'
$py = Get-ChildItem tests -Filter 'test_*.py' -File
$pyScript = @(); $pyTest = @()
foreach ($f in $py) { if (Select-String -Path $f.FullName -Pattern '^def test_' -Quiet) { $pyTest += $f } else { $pyScript += $f } }
$pyFail = @()
foreach ($f in $pyScript) {
  $o = & py -3.12 $f.FullName 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { $pyFail += $f.Name; "PY FAIL [$LASTEXITCODE] $($f.Name)`n$($o.Substring([Math]::Max(0, $o.Length - 600)))" | Out-File $log -Append -Encoding utf8 }
}
"PY script-style: $($pyScript.Count) files, $($pyFail.Count) failed" | Out-File $log -Append -Encoding utf8
$o = & py -3.12 -m pytest @($pyTest | ForEach-Object { $_.FullName }) -q -p no:cacheprovider 2>&1 | Out-String
"PYTEST: $($o.Substring([Math]::Max(0, $o.Length - 1500)))" | Out-File $log -Append -Encoding utf8
$pyFail | Out-File "$out\py_failed.txt" -Encoding utf8
"END $((Get-Date).ToString('s'))" | Out-File $log -Append -Encoding utf8
