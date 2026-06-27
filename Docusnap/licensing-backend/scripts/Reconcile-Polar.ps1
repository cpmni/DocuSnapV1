<#
.SYNOPSIS
  Run the Polar.sh reconciliation sweep (heals missed webhooks: grants/extends from
  Polar's active subscriptions). Intended for Windows Task Scheduler (e.g. hourly).

.DESCRIPTION
  Dry-run by default (prints what it WOULD change, writes nothing). Pass -Apply to write.
  Requires keys/polar_api_token + keys/polar_map.json on the host (see lib/polar.php /
  lib/polar_reconcile.php). Never auto-revokes — see the safety note in polar_reconcile.php.

.PARAMETER Apply
  Actually apply grants/extends (otherwise dry-run).

.PARAMETER Php
  Path to php.exe. Defaults to the newest php under C:\wamp64\bin\php, else `php` on PATH.

.EXAMPLE
  powershell -File scripts\Reconcile-Polar.ps1            # dry run
  powershell -File scripts\Reconcile-Polar.ps1 -Apply     # write
#>
[CmdletBinding()]
param(
    [switch] $Apply,
    [string] $Php
)
$ErrorActionPreference = 'Stop'

if (-not $Php) {
    $cand = Get-ChildItem -Path 'C:\wamp64\bin\php' -Recurse -Filter php.exe -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
    if (-not $cand) { $cand = (Get-Command php -ErrorAction SilentlyContinue).Source }
    $Php = $cand
}
if (-not $Php -or -not (Test-Path $Php)) { Write-Error 'php.exe not found — pass -Php <path>.'; exit 2 }

$script = Join-Path $PSScriptRoot '..\lib\polar_reconcile.php'
$argsList = @($script)
if ($Apply) { $argsList += '--apply' }

Write-Host ("Reconcile-Polar: {0} {1}" -f $Php, ($argsList -join ' '))
& $Php @argsList
exit $LASTEXITCODE
