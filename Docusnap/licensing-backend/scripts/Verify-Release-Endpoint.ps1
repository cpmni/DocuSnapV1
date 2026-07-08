#requires -Version 5.1
<#
  Verify-Release-Endpoint.ps1
  ---------------------------
  One-command check that the update-detection wiring is live on the licensing backend:
  calls GET /v1/status and inspects the advisory `update` block that lib/release.php adds
  to the response. Read-only - it makes NO changes (a status probe with a throwaway
  fingerprint, which the endpoint answers with state="none" plus the update block).

  It distinguishes three states:
    * update field ABSENT   -> the updated validate/status.php + lib/release.php are NOT
                               deployed yet (or PHP OPcache is stale)              -> FAIL
    * update = null         -> deployed and INERT (no release advertised)          -> PASS
    * update = { ... }      -> a release IS advertised; sanity-checks the shape     -> PASS

  Defaults for -BaseUrl / -ProductId are read from ..\..\config\license.json (the same
  config the app uses), so with no arguments it checks the PRODUCTION backend. Override
  -BaseUrl to point at a local WAMP install.

  Exit code: 0 if all checks pass, otherwise the number of failed checks.

  Examples:
    powershell -ExecutionPolicy Bypass -File .\Verify-Release-Endpoint.ps1
    powershell -ExecutionPolicy Bypass -File .\Verify-Release-Endpoint.ps1 -BaseUrl 'https://localhost/licensing/public/v1' -Insecure
#>

[CmdletBinding()]
param(
    [string]$BaseUrl,                 # e.g. https://localhost/licensing/public/v1 ; default = config base_url
    [string]$ProductId,              # default = config product_id
    [string]$FpHash = ('0' * 64),    # any valid 64-hex; an unknown device still returns the update block
    [string]$Channel = 'msstore',    # which release channel to query
    [switch]$Insecure                # accept a self-signed / private-CA TLS cert (local WAMP diagnostics)
)

$ErrorActionPreference = 'Stop'

$script:failures = 0
function Pass($m)    { Write-Host ("  PASS  " + $m) -ForegroundColor Green }
function Fail($m)    { Write-Host ("  FAIL  " + $m) -ForegroundColor Red; $script:failures++ }
function Info($m)    { Write-Host ("  --    " + $m) -ForegroundColor DarkGray }
function Section($m) { Write-Host "`n[*] $m" -ForegroundColor Cyan }

# --- Resolve defaults from the app's own config -----------------------------
$cfgPath = Join-Path $PSScriptRoot '..\..\config\license.json'
if ((-not $BaseUrl -or -not $ProductId) -and (Test-Path $cfgPath)) {
    try {
        $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
        if (-not $BaseUrl)   { $BaseUrl   = $cfg.base_url }
        if (-not $ProductId) { $ProductId = $cfg.product_id }
    } catch { Info ("Could not read config/license.json (" + $_.Exception.Message + ") - pass -BaseUrl/-ProductId.") }
}

if (-not $BaseUrl)   { Fail 'No -BaseUrl given and none in config/license.json.'; exit 1 }
if (-not $ProductId) { Fail 'No -ProductId given and none in config/license.json.'; exit 1 }
if ($FpHash -notmatch '^[0-9a-fA-F]{64}$') { Fail 'FpHash must be exactly 64 hex characters.'; exit 1 }

$BaseUrl    = $BaseUrl.TrimEnd('/')
$encProduct = [uri]::EscapeDataString($ProductId)
$encChannel = [uri]::EscapeDataString($Channel)
$fpLower    = $FpHash.ToLower()
$url        = "$BaseUrl/status?product_id=$encProduct&fp_hash=$fpLower&channel=$encChannel"

# --- TLS ---------------------------------------------------------------------
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ($Insecure) { [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true } }

Section "Update-detection endpoint check"
Info "GET $url"

try {
    $resp = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 15
} catch {
    $msg = $_.Exception.Message
    Fail ("Request failed: " + $msg)
    if ($msg -match 'SSL|certificate|trust|secure channel') {
        Info 'TLS/cert error - for a local or private-CA backend, re-run with -Insecure.'
    }
    exit 1
}

Pass "Reached the backend (HTTP 200)"
Info ("state = " + $resp.state)

# A null-valued property is still PRESENT in the parsed object, so this cleanly separates
# "old code, no key" from "new code, key = null".
$hasUpdate = ($resp.PSObject.Properties.Name -contains 'update')
if (-not $hasUpdate) {
    Fail "Response has NO 'update' field."
    Info "The updated public/v1/{validate,status}.php + lib/release.php are not deployed, or PHP OPcache is stale."
    Info "Upload those files (and lib/release.php), then restart PHP/Apache or wait for OPcache to refresh."
    Section "Result"
    Write-Host ("  " + $script:failures + " check(s) failed.") -ForegroundColor Red
    exit $script:failures
}
Pass "Response carries the 'update' field - the update-detection wiring is deployed."

$u = $resp.update
if ($null -eq $u) {
    Pass "update = null -> banner is OFF (inert)."
    Info "Turn it on from the admin: App releases -> set Latest version (> the app's version) + an Update URL."
} else {
    Section "Advertised release ($Channel)"
    Info ("latest_version        = " + $u.latest_version)
    Info ("update_url            = " + $u.update_url)
    Info ("min_supported_version = " + $u.min_supported_version)

    if ($u.latest_version -match '^\d+\.\d+\.\d+$') { Pass "latest_version is a clean 3-part version." }
    else { Fail ("latest_version '" + $u.latest_version + "' is not a clean 3-part version - the app will NOT show a banner for it.") }

    if ($u.update_url -match '^(https://|ms-windows-store:)') { Pass "update_url uses an allowed scheme (https / ms-windows-store)." }
    else { Fail ("update_url '" + $u.update_url + "' scheme is not allowed by the client - the Update button won't open it.") }

    if ($u.min_supported_version) {
        Info ("NOTE: a forced-update floor is SET (" + $u.min_supported_version + "). Apps BELOW it will be LOCKED to the update screen")
        Info "      (fail-open: an OFFLINE app is never locked). Clear it if you did not intend a forced update."
    }
}

Section "Result"
if ($script:failures -eq 0) { Write-Host "  All checks passed." -ForegroundColor Green }
else { Write-Host ("  " + $script:failures + " check(s) failed.") -ForegroundColor Red }
exit $script:failures
