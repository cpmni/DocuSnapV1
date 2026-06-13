#requires -Version 5.1
<#
  Configure-WampBackend.ps1
  -------------------------
  Deploys and configures the licensing backend onto a local WAMP (Apache + MySQL +
  PHP) install on Windows. Idempotent and re-runnable.

  Safety: does NOT start/restart services, does NOT generate or embed private
  keys, does NOT import the database unless explicitly asked (-ImportDatabase),
  and backs up any config it overwrites. Targets only the backend deployment.

  Examples:
    .\Configure-WampBackend.ps1 -DryRun
    .\Configure-WampBackend.ps1 -DbName licensing -DbUser root
    .\Configure-WampBackend.ps1 -WampWwwPath 'D:\wamp64\www' -Backup -IncludeKeys
    .\Configure-WampBackend.ps1 -ImportDatabase      # gated DB create + schema import
#>

[CmdletBinding()]
param(
    [string]$BackendSrc,                  # licensing-backend root; auto-detected if omitted
    [string]$WampWwwPath,                 # auto-detected if omitted (C:\wamp64\www, C:\wamp\www)
    [string]$SiteFolder = 'licensing',    # subfolder under www; Apache docroot -> <deploy>\public
    [string]$DbHost     = '127.0.0.1',
    [string]$DbName     = 'licensing',
    [string]$DbUser     = 'root',
    [string]$DbPass     = '',             # WAMP root default is an empty password
    [string]$ActiveKid  = 'k1',
    [switch]$IncludeKeys,                 # opt-in: also copy existing private keys/seeds
    [switch]$ImportDatabase,              # opt-in: create DB + import schema.sql via mysql.exe
    [string]$MysqlExe,                    # mysql client path; auto-detected when -ImportDatabase
    [switch]$Backup,                      # back up an existing deploy before changing it
    [switch]$DryRun                       # print intended actions without making changes
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Write-Step($m) { Write-Host "[*] $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Note($m) { Write-Host "    --  $m" -ForegroundColor Yellow }

# Run a mutating action, or just describe it under -DryRun.
function Invoke-Action([string]$desc, [scriptblock]$action) {
    if ($DryRun) { Write-Host "    [dry-run] $desc" -ForegroundColor DarkGray }
    else { & $action; Write-Ok $desc }
}

# --- Resolve the backend source (location-independent) ---
if (-not $BackendSrc) {
    $candidates = @(
        (Split-Path -Parent $PSScriptRoot),          # script lives in licensing-backend\scripts\
        (Join-Path $PSScriptRoot '..\licensing-backend'),
        (Join-Path (Split-Path -Parent $PSScriptRoot) 'licensing-backend')
    )
    $BackendSrc = $candidates | Where-Object { Test-Path (Join-Path $_ 'public\index.php') } | Select-Object -First 1
}
if (-not $BackendSrc -or -not (Test-Path (Join-Path $BackendSrc 'public\index.php'))) {
    throw "Backend source not found. Pass it explicitly: -BackendSrc 'C:\path\to\licensing-backend'."
}
$BackendSrc = (Resolve-Path $BackendSrc).Path
Write-Step "Backend source: $BackendSrc"

# --- Resolve the WAMP www root ---
if (-not $WampWwwPath) {
    $WampWwwPath = @('C:\wamp64\www', 'C:\wamp\www') | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $WampWwwPath -or -not (Test-Path $WampWwwPath)) {
    throw "WAMP www root not found. Pass it explicitly, e.g. -WampWwwPath 'C:\wamp64\www'."
}
$Deploy = Join-Path $WampWwwPath $SiteFolder
Write-Step "Deploy target: $Deploy"
Write-Note "Apache docroot / vhost should point at: $Deploy\public"

# --- Optional full backup of an existing deploy ---
if ($Backup -and (Test-Path $Deploy)) {
    Invoke-Action "backed up existing deploy -> $Deploy.bak.$stamp" {
        Copy-Item $Deploy "$Deploy.bak.$stamp" -Recurse -Force
    }
}

# --- Ensure directories (keys\ sits BESIDE public\, never inside the docroot) ---
Write-Step "Ensuring backend directories"
foreach ($d in @($Deploy, "$Deploy\public", "$Deploy\public\v1", "$Deploy\lib", "$Deploy\keys")) {
    if (Test-Path $d) { Write-Note "exists: $d" }
    else { Invoke-Action "created: $d" { New-Item -ItemType Directory -Path $d -Force | Out-Null } }
}

# --- Copy code artifacts (private keys handled separately, below) ---
Write-Step "Copying backend code (no private keys)"
Invoke-Action "copied public\ (endpoints + .htaccess)" { Copy-Item "$BackendSrc\public\*" "$Deploy\public" -Recurse -Force }
Invoke-Action "copied lib\ (db.php, jws.php)"          { Copy-Item "$BackendSrc\lib\*"    "$Deploy\lib"    -Recurse -Force }
foreach ($f in @('schema.sql', 'README.md', 'CONTRACT.md')) {
    if (Test-Path "$BackendSrc\$f") { Invoke-Action "copied $f" { Copy-Item "$BackendSrc\$f" $Deploy -Force } }
}

# --- Private keys: opt-in only; never generated or embedded ---
$seedName = "ed25519_${ActiveKid}_sodium_seed.b64"
if ($IncludeKeys) {
    if (Test-Path "$BackendSrc\keys\*") {
        Invoke-Action "copied private keys/seeds -> $Deploy\keys" { Copy-Item "$BackendSrc\keys\*" "$Deploy\keys" -Force }
        Write-Note "Restrict NTFS permissions on '$Deploy\keys' to the Apache service account only."
    } else {
        Write-Note "No keys in source. Generate on the host first (not committed, not web-served):"
        Write-Note "  node `"$BackendSrc\scripts\generate_keys.js`" $ActiveKid"
        Write-Note "  node `"$BackendSrc\scripts\export_sodium_seed.js`" $ActiveKid"
    }
} else {
    Write-Note "Private keys NOT copied (pass -IncludeKeys to copy them). Place the signing seed at:"
    Write-Note "  $Deploy\keys\$seedName   (must stay outside the web docroot and out of git)"
}

# --- DB connection config via Apache SetEnv in the deployed public\.htaccess ---
# db.php reads getenv('LICENSING_DB_*') with WAMP-default fallbacks, so a stock
# WAMP often needs nothing here. Production: prefer SetEnv in httpd.conf OUTSIDE
# the docroot so credentials are not in a web-served file.
Write-Step "Writing DB connection config (Apache SetEnv, idempotent block)"
$ht     = Join-Path $Deploy 'public\.htaccess'
$beginM = '# >>> licensing DB config (managed by Configure-WampBackend.ps1) >>>'
$endM   = '# <<< licensing DB config (managed by Configure-WampBackend.ps1) <<<'
$body   = @($beginM,
    "SetEnv LICENSING_DB_HOST $DbHost",
    "SetEnv LICENSING_DB_NAME $DbName",
    "SetEnv LICENSING_DB_USER $DbUser")
if ($DbPass -ne '') { $body += "SetEnv LICENSING_DB_PASS $DbPass" }
else { $body += '# LICENSING_DB_PASS omitted (empty) - matches the default WAMP root password' }
$body += $endM
$block = ($body -join "`r`n")

if ($DryRun) {
    Write-Host "    [dry-run] would back up then write this block into $ht :" -ForegroundColor DarkGray
    $block -split "`r`n" | ForEach-Object { Write-Host "        $_" -ForegroundColor DarkGray }
} else {
    $cur = if (Test-Path $ht) {
        Invoke-Action "backed up .htaccess -> $ht.bak.$stamp" { Copy-Item $ht "$ht.bak.$stamp" -Force }
        Get-Content $ht -Raw
    } else { '' }
    # Strip any previous managed block, then append the fresh one (idempotent).
    $pattern = "(?s)\r?\n*" + [regex]::Escape($beginM) + ".*?" + [regex]::Escape($endM)
    $cur = [regex]::Replace($cur, $pattern, '')
    $cur = ($cur.TrimEnd() + "`r`n`r`n" + $block + "`r`n")
    Invoke-Action "wrote DB SetEnv block -> $ht" { Set-Content -Path $ht -Value $cur -Encoding ASCII }
}

# --- Optional database create + schema import (OFF by default, gated) ---
if ($ImportDatabase) {
    Write-Step "Database create + schema import (gated by -ImportDatabase)"
    if (-not $MysqlExe) {
        $MysqlExe = Get-ChildItem -Path 'C:\wamp64\bin\mysql', 'C:\wamp\bin\mysql' -Recurse -Filter 'mysql.exe' -ErrorAction SilentlyContinue |
                    Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $MysqlExe -or -not (Test-Path $MysqlExe)) {
        throw "mysql.exe not found. Pass it: -MysqlExe 'C:\wamp64\bin\mysql\mysqlX.Y.Z\bin\mysql.exe'."
    }
    $schema  = Join-Path $Deploy 'schema.sql'
    if (-not (Test-Path $schema) -and -not $DryRun) { throw "schema.sql not found at $schema (copy step must run first)." }
    # Password passed as an arg array element only when set; never echoed.
    $authArgs = @("--user=$DbUser"); if ($DbPass -ne '') { $authArgs += "--password=$DbPass" }

    # mysql.exe returns a native exit code; a failed command does NOT raise a
    # PowerShell error (even under -EA Stop), so Invoke-Action would print a
    # false OK. Run the step, leave mysql's stderr on the console (not
    # swallowed), then judge success solely by $LASTEXITCODE: OK on 0, else FAIL
    # + record it so the script exits nonzero. Steps stay idempotent (the SQL
    # below uses IF NOT EXISTS).
    $script:DbFailed = $false
    function Invoke-Mysql([string]$desc, [scriptblock]$action) {
        if ($DryRun) { Write-Host "    [dry-run] $desc" -ForegroundColor DarkGray; return }
        & $action
        if ($LASTEXITCODE -eq 0) { Write-Ok $desc }
        else {
            Write-Host "    FAIL $desc (mysql exit $LASTEXITCODE)" -ForegroundColor Red
            $script:DbFailed = $true
        }
    }

    Invoke-Mysql "created database '$DbName' (if not exists)" {
        & $MysqlExe @authArgs "--host=$DbHost" -e "CREATE DATABASE IF NOT EXISTS $DbName"
    }
    Invoke-Mysql "imported schema.sql into '$DbName'" {
        Get-Content $schema -Raw | & $MysqlExe @authArgs "--host=$DbHost" $DbName
    }
} else {
    Write-Note "Database import skipped (default). Pass -ImportDatabase to create '$DbName' and import schema.sql."
}

# --- Summary + remaining manual steps (intentionally not automated) ---
Write-Step "Done. Remaining manual steps (this script does not perform these):"
if (-not $ImportDatabase) {
    Write-Note "* Create the DB + import schema (or re-run with -ImportDatabase):"
    Write-Note "    mysql -u $DbUser $(if($DbPass){'-p '}) -e `"CREATE DATABASE IF NOT EXISTS $DbName`""
    Write-Note "    mysql -u $DbUser $(if($DbPass){'-p '}) $DbName < `"$Deploy\schema.sql`""
}
Write-Note "* Seed an account + entitlement for activation testing (see README.md)."
Write-Note "* Point an Apache vhost/docroot at '$Deploy\public'; enable mod_rewrite and php_sodium."
Write-Note "* Ensure the signing seed exists: $Deploy\keys\$seedName"
Write-Note "* Restart Apache yourself when ready."
if ($DryRun) { Write-Host "`n[dry-run] No changes were made." -ForegroundColor DarkGray }

# Fail loudly if any DB step errored — files may have deployed, but the import
# did not. Don't let a green-looking summary mask an unreachable/failed MySQL.
if ($script:DbFailed) {
    Write-Host "`nDatabase step(s) FAILED (see FAIL lines above). Ensure MySQL is running and reachable, then re-run with -ImportDatabase." -ForegroundColor Red
    exit 1
}
