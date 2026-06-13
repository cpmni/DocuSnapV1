#requires -Version 5.1
<#
  Test-ConfigureWampBackend-DbFailure.ps1
  ---------------------------------------
  Self-check / regression guard for the DB error-handling fix in
  Configure-WampBackend.ps1: a failing mysql.exe must be reported as FAIL and
  cause a nonzero exit (never a false OK).

  How: runs Configure-WampBackend.ps1 with -ImportDatabase against a stub that
  stands in for mysql.exe and always exits nonzero. All deploy writes are
  redirected to a throwaway temp folder, and the stub never touches a real
  database, so this is safe to run against a live WAMP box.

  Exit code: 0 if the script correctly failed loudly, 1 if the failure was
  swallowed (regression).
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

$scriptDir  = $PSScriptRoot
$configPs1  = Join-Path $scriptDir 'Configure-WampBackend.ps1'
$backendSrc = Split-Path -Parent $scriptDir
if (-not (Test-Path $configPs1)) { throw "Configure-WampBackend.ps1 not found beside this test ($configPs1)." }

# Isolated workspace: deploy target + the failing mysql stub live here only.
$work = Join-Path ([IO.Path]::GetTempPath()) ("ds_cfgtest_" + [guid]::NewGuid().ToString('N').Substring(0,8))
$www  = Join-Path $work 'www'
New-Item -ItemType Directory -Path $www -Force | Out-Null

# Stub for mysql.exe: emit an error to stderr (proving stderr isn't swallowed)
# and exit nonzero. It ignores its args and never connects to anything.
$stub = Join-Path $work 'mysql_fail.cmd'
@'
@echo off
echo ERROR 9999 (HY000): simulated mysql failure 1>&2
exit /b 1
'@ | Set-Content -Path $stub -Encoding ASCII

try {
    Write-Host "[*] Running Configure-WampBackend.ps1 with a failing mysql stub (temp deploy: $www)" -ForegroundColor Cyan

    # Child process so the script's own `exit` code is captured cleanly without
    # affecting this test runner.
    $psArgs = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $configPs1,
        '-BackendSrc',   $backendSrc,
        '-WampWwwPath',  $www,
        '-ImportDatabase',
        '-MysqlExe',     $stub
    )
    & powershell.exe @psArgs | Out-Host
    $code = $LASTEXITCODE

    Write-Host ""
    if ($code -ne 0) {
        Write-Host "PASS: failing mysql.exe surfaced as a nonzero exit ($code)." -ForegroundColor Green
        exit 0
    } else {
        Write-Host "FAIL (regression): mysql failure was swallowed - script exited 0." -ForegroundColor Red
        exit 1
    }
} finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
