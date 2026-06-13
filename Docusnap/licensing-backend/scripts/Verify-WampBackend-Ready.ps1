#requires -Version 5.1
<#
  Verify-WampBackend-Ready.ps1
  ----------------------------
  Read-only readiness check for the licensing backend on a local WAMP install,
  to run AFTER Configure-WampBackend.ps1 and BEFORE activation testing.

  Safety: makes NO changes. No writes, no service starts/restarts, no DB writes.
  The only database access is read-only COUNT(*) queries. Where a check cannot
  be made reliably from the filesystem it prints a MANUAL CHECK line rather
  than guessing.

  Exit code: 0 if every required check PASSes, otherwise non-zero
  (number of failed required checks).

  Examples:
    .\Verify-WampBackend-Ready.ps1
    .\Verify-WampBackend-Ready.ps1 -WampWwwPath 'D:\wamp64\www'
    .\Verify-WampBackend-Ready.ps1 -DbName licensing -DbUser root
#>

[CmdletBinding()]
param(
    [string]$WampRoot,                    # e.g. C:\wamp64 ; auto-detected if omitted
    [string]$WampWwwPath,                 # e.g. C:\wamp64\www ; auto-detected if omitted
    [string]$SiteFolder = 'licensing',    # subfolder under www; docroot -> <deploy>\public
    [string]$ActiveKid  = 'k1',           # signing seed kid (ed25519_<kid>_sodium_seed.b64)
    [string]$DbHost     = '127.0.0.1',
    [string]$DbName     = 'licensing',
    [string]$DbUser     = 'root',
    [string]$DbPass     = '',             # WAMP root default is an empty password
    [string]$MysqlExe,                    # mysql client; auto-detected if omitted
    [string]$PhpExe                       # php CLI; auto-detected if omitted
)

$ErrorActionPreference = 'Stop'

# --- Result tracking -------------------------------------------------------
$script:failures = 0
function Pass($m)   { Write-Host ("  PASS         " + $m) -ForegroundColor Green }
function Fail($m)   { Write-Host ("  FAIL         " + $m) -ForegroundColor Red; $script:failures++ }
function Manual($m) { Write-Host ("  MANUAL CHECK " + $m) -ForegroundColor Yellow }
function Info($m)   { Write-Host ("  --           " + $m) -ForegroundColor DarkGray }
function Section($m){ Write-Host "`n[*] $m" -ForegroundColor Cyan }

# --- Resolve WAMP locations ------------------------------------------------
if (-not $WampRoot) {
    $WampRoot = @('C:\wamp64', 'C:\wamp') | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $WampWwwPath) {
    if ($WampRoot -and (Test-Path (Join-Path $WampRoot 'www'))) { $WampWwwPath = Join-Path $WampRoot 'www' }
    else { $WampWwwPath = @('C:\wamp64\www', 'C:\wamp\www') | Where-Object { Test-Path $_ } | Select-Object -First 1 }
}

$Deploy   = if ($WampWwwPath) { Join-Path $WampWwwPath $SiteFolder } else { "C:\wamp64\www\$SiteFolder" }
$Docroot  = Join-Path $Deploy 'public'
$SeedName = "ed25519_${ActiveKid}_sodium_seed.b64"
$SeedPath = Join-Path $Deploy "keys\$SeedName"

Write-Host "DocuSnap licensing backend - WAMP readiness check (read-only)" -ForegroundColor White
Info ("WAMP root : " + ($(if ($WampRoot) { $WampRoot } else { '(not found)' })))
Info ("Deploy    : $Deploy")

# --- 1. Deploy root exists -------------------------------------------------
Section "1. Deploy root"
if (Test-Path -PathType Container $Deploy) { Pass "deploy root exists: $Deploy" }
else { Fail "deploy root missing: $Deploy" }

# --- 2. Apache docroot / vhost target --------------------------------------
Section "2. Apache docroot target"
if (Test-Path -PathType Container $Docroot) {
    Pass "docroot exists: $Docroot"
    if (Test-Path (Join-Path $Docroot 'index.php')) { Pass "docroot has index.php" }
    else { Fail "docroot has no index.php: $Docroot\index.php" }
    Manual "confirm an Apache vhost/DocumentRoot actually points at: $Docroot"
} else {
    Fail "docroot missing: $Docroot"
}

# --- 3. mod_rewrite enabled ------------------------------------------------
Section "3. Apache mod_rewrite"
$httpdConf = $null
if ($WampRoot) {
    $httpdConf = Get-ChildItem -Path (Join-Path $WampRoot 'bin\apache') -Recurse -Filter 'httpd.conf' -ErrorAction SilentlyContinue |
                 Where-Object { $_.FullName -match '\\conf\\httpd\.conf$' } |
                 Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if ($httpdConf -and (Test-Path $httpdConf)) {
    $rewriteLine = Select-String -Path $httpdConf -Pattern '^\s*LoadModule\s+rewrite_module' -ErrorAction SilentlyContinue
    if ($rewriteLine) { Pass "mod_rewrite enabled in $httpdConf" }
    else {
        $commented = Select-String -Path $httpdConf -Pattern '^\s*#\s*LoadModule\s+rewrite_module' -ErrorAction SilentlyContinue
        if ($commented) { Fail "mod_rewrite is commented out in $httpdConf" }
        else { Manual "could not find a rewrite_module line in $httpdConf - verify in httpd.conf / WAMP tray" }
    }
} else {
    Manual "httpd.conf not found under '$WampRoot\bin\apache' - verify mod_rewrite via WAMP tray (Apache modules)"
}

# --- 4. php_sodium enabled -------------------------------------------------
Section "4. PHP sodium extension"
if (-not $PhpExe -and $WampRoot) {
    $PhpExe = Get-ChildItem -Path (Join-Path $WampRoot 'bin\php') -Recurse -Filter 'php.exe' -ErrorAction SilentlyContinue |
              Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if ($PhpExe -and (Test-Path $PhpExe)) {
    # Direct probe instead of `php -m`: php.ini is still loaded (so sodium can
    # load), but PHP startup warnings are silenced at the source
    # (display_startup_errors=0) and any remaining stderr is discarded, so an
    # unrelated warning (e.g. a failed Xdebug zend_extension load) cannot fail
    # this check. EAP is relaxed locally so a native stderr line can't surface
    # as a terminating NativeCommandError under the script's 'Stop' preference.
    $sodium  = $null
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $sodium = & $PhpExe -d display_errors=0 -d display_startup_errors=0 -r "echo extension_loaded('sodium') ? '1' : '0';" 2>$null
    } catch {
        $sodium = $null
    } finally {
        $ErrorActionPreference = $prevEAP
    }
    $sodium = ($sodium | Out-String).Trim()
    if     ($sodium -eq '1') { Pass "sodium loaded by PHP CLI ($PhpExe)" }
    elseif ($sodium -eq '0') { Fail "sodium NOT loaded by PHP CLI ($PhpExe)" }
    else   { Manual "could not probe sodium via $PhpExe - verify php_sodium via WAMP tray (PHP extensions)" }
    Manual "PHP CLI ini can differ from Apache's - confirm sodium is enabled for the Apache PHP module too"
} else {
    Manual "php.exe not found under '$WampRoot\bin\php' - verify php_sodium via WAMP tray (PHP extensions)"
}

# --- 5. Signing seed present -----------------------------------------------
Section "5. Signing seed"
if (Test-Path -PathType Leaf $SeedPath) {
    Pass "signing seed exists: $SeedPath"
    if ($Docroot -and $SeedPath.StartsWith($Docroot, [System.StringComparison]::OrdinalIgnoreCase)) {
        Fail "signing seed is INSIDE the web docroot - move it beside public\, not under it"
    }
} else {
    Fail "signing seed missing: $SeedPath"
}

# --- 6. Activation-test seed data (account + entitlement) ------------------
Section "6. Activation-test seed data (account + entitlement)"
if (-not $MysqlExe -and $WampRoot) {
    $MysqlExe = Get-ChildItem -Path (Join-Path $WampRoot 'bin\mysql') -Recurse -Filter 'mysql.exe' -ErrorAction SilentlyContinue |
                Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if ($MysqlExe -and (Test-Path $MysqlExe)) {
    $authArgs = @("--user=$DbUser"); if ($DbPass -ne '') { $authArgs += "--password=$DbPass" }
    $authArgs += @("--host=$DbHost", '--batch', '--skip-column-names')
    $query = 'SELECT (SELECT COUNT(*) FROM accounts), (SELECT COUNT(*) FROM entitlements);'
    try {
        $row = & $MysqlExe @authArgs $DbName -e $query 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $row) {
            Manual "could not query DB '$DbName' (server down, or schema not imported) - seed an account + entitlement per README.md"
        } else {
            $parts = ($row | Select-Object -First 1) -split "\s+"
            $accounts = [int]$parts[0]; $entitlements = [int]$parts[1]
            if ($accounts -gt 0 -and $entitlements -gt 0) {
                Pass "found $accounts account(s) and $entitlements entitlement(s) in '$DbName'"
            } else {
                Fail "DB '$DbName' has $accounts account(s) / $entitlements entitlement(s) - seed at least one of each for activation testing"
            }
        }
    } catch {
        Manual "DB query failed against '$DbName' - verify the schema is imported and seed data exists (README.md)"
    }
} else {
    Manual "mysql.exe not found under '$WampRoot\bin\mysql' - manually confirm an account + entitlement exist for activation testing"
}

# --- Summary ---------------------------------------------------------------
Section "Summary"
if ($script:failures -eq 0) {
    Write-Host "  All required checks passed. Backend looks ready for activation testing." -ForegroundColor Green
    exit 0
} else {
    Write-Host "  $($script:failures) required check(s) FAILED. Resolve the FAIL lines above before testing." -ForegroundColor Red
    exit $script:failures
}
