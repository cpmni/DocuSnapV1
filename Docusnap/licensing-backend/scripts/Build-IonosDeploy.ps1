<#
.SYNOPSIS
  Package the ScanFinder licensing backend into an IONOS-ready upload tree.

.DESCRIPTION
  Produces this exact structure (the IONOS subdomain document root is later
  pointed at public/; everything else stays ABOVE the docroot):

      <OutDir>/
        public/      web-served only: index.php, v1/, admin/, hardened .htaccess, .user.ini
        lib/         shared PHP includes: db.php, jws.php, admin_auth.php       (OUTSIDE docroot)
        keys/        ed25519 signing seeds + admin_password.hash                (OUTSIDE docroot)
        set-env.php  environment loader (auto_prepend_file)                     (OUTSIDE docroot)

  Idempotent / deterministic:
    * CODE  (public/*, lib/*)        : cleared and recopied from source every run.
    * SEEDS (keys/ed25519_*)         : copied unchanged from source every run.
    * SECRET admin_password.hash     : copied if found; otherwise PRESERVED if it
                                       already exists in the output; NEVER generated here.
    * CONFIG (set-env.php, .user.ini,
              public/.htaccess)      : written only if missing (use -Force to overwrite),
                                       so a re-run never clobbers values you filled in.

  Does NOT touch the desktop app or any backend runtime logic. Fails loudly if
  the source layout is unexpected, or if any sensitive file would land in public/.

.PARAMETER OutDir
  Output tree location. Default: <repo>\output\licensing-backend-ionos (git-ignored,
  because the tree contains secret material).

.PARAMETER AdminHashPath
  Optional path to the production bcrypt admin_password.hash to drop into keys/.

.PARAMETER Force
  Overwrite the generated config templates (set-env.php, .user.ini, .htaccess)
  even if they already exist.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\Build-IonosDeploy.ps1
#>
[CmdletBinding()]
param(
  [string]$OutDir,
  [string]$AdminHashPath,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)   # PHP/.htaccess must have NO BOM
function Write-File([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}
function Write-IfMissing([string]$Path, [string]$Content) {
  if ((Test-Path $Path) -and -not $Force) { return 'kept (exists)' }
  Write-File $Path $Content
  return 'written'
}

# ── Resolve source (this script lives in licensing-backend/scripts/) ──────────
$SrcRoot = Split-Path -Parent $PSScriptRoot          # licensing-backend\
$SrcPub  = Join-Path $SrcRoot 'public'
$SrcLib  = Join-Path $SrcRoot 'lib'
$SrcKeys = Join-Path $SrcRoot 'keys'

if (-not $OutDir) {
  $RepoRoot = Split-Path -Parent $SrcRoot
  $OutDir   = Join-Path $RepoRoot 'output\licensing-backend-ionos'
}

# ── Path-assumption checks: stop and report if the layout is not as expected ──
$required = @(
  (Join-Path $SrcPub 'index.php'),
  (Join-Path $SrcPub 'v1'),
  (Join-Path $SrcPub 'admin'),
  (Join-Path $SrcLib 'db.php'),
  (Join-Path $SrcLib 'jws.php'),
  (Join-Path $SrcLib 'admin_auth.php')
)
$missing = $required | Where-Object { -not (Test-Path $_) }
if ($missing) {
  throw ("Source layout not as expected. Missing:`n  " + ($missing -join "`n  ") +
         "`nRun this script from licensing-backend\scripts\ or pass -OutDir.")
}
$seedFiles = @(Get-ChildItem -Path $SrcKeys -Filter 'ed25519_*' -File -ErrorAction SilentlyContinue)
if ($seedFiles.Count -eq 0) {
  throw "No ed25519_* signing seeds found in $SrcKeys. They must move to keys/ unchanged; aborting."
}

# ── Output folders ────────────────────────────────────────────────────────────
$OutPublic = Join-Path $OutDir   'public'
$OutV1     = Join-Path $OutPublic 'v1'
$OutAdmin  = Join-Path $OutPublic 'admin'
$OutLib    = Join-Path $OutDir   'lib'
$OutKeys   = Join-Path $OutDir   'keys'
foreach ($d in @($OutDir,$OutPublic,$OutV1,$OutAdmin,$OutLib,$OutKeys)) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}

# ── CODE: rebuild deterministically (clear the code dirs, then copy) ──────────
Get-ChildItem $OutV1    -File -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem $OutAdmin -Recurse -File -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem $OutLib   -File -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem $OutPublic -File -Filter '*.php' -ErrorAction SilentlyContinue | Remove-Item -Force

Copy-Item (Join-Path $SrcPub 'index.php')  $OutPublic -Force
Copy-Item (Join-Path $SrcPub 'v1\*.php')    $OutV1    -Force
Copy-Item (Join-Path $SrcPub 'admin\*')     $OutAdmin -Recurse -Force
# ALL shared PHP includes EXCEPT the test_*.php unit tests (host-run only, never served).
# Wildcard so new libs (admin_actions, admin_view, ratelimit, webhook, polar,
# entitlements, polar_reconcile, …) ship automatically without editing this list.
Get-ChildItem (Join-Path $SrcLib '*.php') -File |
  Where-Object { $_.Name -notlike 'test_*.php' } |
  ForEach-Object { Copy-Item $_.FullName $OutLib -Force }

# ── SECRETS into keys/ (never into public/) ───────────────────────────────────
foreach ($f in $seedFiles) { Copy-Item $f.FullName $OutKeys -Force }

$outHash = Join-Path $OutKeys 'admin_password.hash'
$srcHash = if ($AdminHashPath) { $AdminHashPath } else { Join-Path $SrcKeys 'admin_password.hash' }
if (Test-Path $srcHash) {
  Copy-Item $srcHash $outHash -Force
  $hashStatus = "copied from $srcHash"
} elseif (Test-Path $outHash) {
  $hashStatus = 'preserved existing (not regenerated)'
} else {
  Write-File (Join-Path $OutKeys 'ADMIN-HASH-REQUIRED.txt') `
    "Place the production bcrypt admin_password.hash here (exact filename: admin_password.hash).`r`nThis script never generates or rotates it."
  $hashStatus = 'MISSING - placeholder written (provide admin_password.hash)'
}

# ── GENERATED CONFIG (write-if-missing; -Force to overwrite) ──────────────────
$SetEnv = @'
<?php
// set-env.php - production environment shim for the licensing backend.
// Loaded via auto_prepend_file (see public/.user.ini) BEFORE any page runs, so
// lib/db.php's getenv('LICENSING_DB_*') calls resolve on IONOS even when the
// hosting panel does not expose process environment variables to PHP.
// SECURITY: keep OUTSIDE the web docroot (sibling of public/). Never commit.
// Fill in the four production values, then delete the REPLACE_ markers.

putenv('LICENSING_DB_HOST=REPLACE_DB_HOST');   // IONOS DB hostname, e.g. dbNNNNNN.hosting-data.io (NOT localhost)
putenv('LICENSING_DB_NAME=REPLACE_DB_NAME');
putenv('LICENSING_DB_USER=REPLACE_DB_USER');   // dedicated DB user (not root)
putenv('LICENSING_DB_PASS=REPLACE_DB_PASS');   // strong DB password

// Admin password hash is read from keys/admin_password.hash (file fallback in
// admin_auth.php), so it need not be set here. To use env instead, uncomment:
// putenv('LICENSING_ADMIN_PASSWORD_HASH=REPLACE_BCRYPT_HASH');
'@

$UserIni = @'
; Licensing backend - production PHP settings (IONOS, PHP 8.x).
; .user.ini is honoured for scripts in this directory tree (the document root).

; set-env.php (DB credentials) is loaded automatically by lib/db.php via a RELATIVE
; path, so no absolute auto_prepend_file is required. If you prefer the prepend
; mechanism instead, uncomment the next line and set the ABSOLUTE server path to
; set-env.php (OUTSIDE the docroot):
; auto_prepend_file = "/homepages/REPLACE_ME/licensing/set-env.php"

display_errors = Off
log_errors     = On
date.timezone  = "Europe/London"   ; adjust to your timezone

; NOTE: expose_php is PHP_INI_SYSTEM and cannot be set here; disable it in the IONOS panel.
'@

$Htaccess = @'
# Licensing backend - production .htaccess (IONOS). Lives in the document root.
# (1) force HTTPS, (2) disable directory listing, (3) minimal safe headers,
# (4) preserve the exact /v1/* path contract.

RewriteEngine On

# (1) Force HTTPS - admin posts a password + TOTP; the session cookie only gains
#     the Secure flag under HTTPS. Skipped when already on HTTPS.
RewriteCond %{HTTPS} !=on
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]

# (2) No directory listing.
Options -Indexes

# (3) Minimal safe headers (no-op if mod_headers is unavailable).
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "DENY"
  Header always set Referrer-Policy "no-referrer"
  # HSTS - HTTPS is confirmed permanent here (valid Sectigo cert + HTTP->HTTPS
  # forced). 1 year; no includeSubDomains/preload (scope to this host only).
  Header always set Strict-Transport-Security "max-age=31536000"
</IfModule>

# (4) API path contract - unchanged from the dev .htaccess.
RewriteRule ^v1/trial/start/?$  v1/trial_start.php  [L]
RewriteRule ^v1/activate/?$     v1/activate.php     [L]
RewriteRule ^v1/validate/?$     v1/validate.php     [L]
RewriteRule ^v1/revoke/?$       v1/revoke.php       [L]
RewriteRule ^v1/status/?$       v1/status.php       [L]
RewriteRule ^v1/polar/webhook/?$ v1/polar_webhook.php [L]
'@

$setEnvStatus  = Write-IfMissing (Join-Path $OutDir   'set-env.php') $SetEnv
$userIniStatus = Write-IfMissing (Join-Path $OutPublic '.user.ini')  $UserIni
$htaccessStat  = Write-IfMissing (Join-Path $OutPublic '.htaccess')  $Htaccess

# ── GUARDRAIL: no sensitive file may exist anywhere under public/ ─────────────
$leak = Get-ChildItem $OutPublic -Recurse -File -Force | Where-Object {
  $_.Name -match '(?i)(\.pem$|sodium_seed|admin_password\.hash|admin_2fa\.json|^set-env\.php$|\.key$)'
}
if ($leak) {
  throw ("SECURITY ABORT: sensitive file(s) found under public/:`n  " +
         (($leak | ForEach-Object FullName) -join "`n  "))
}

# ── Verification report ───────────────────────────────────────────────────────
function Show-Dir([string]$Label, [string]$Path) {
  Write-Host ""
  Write-Host ("  {0}  ({1})" -f $Label, $Path) -ForegroundColor Cyan
  Get-ChildItem $Path -File -Force -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host ("    - " + $_.Name) }
}
Write-Host ""
Write-Host "================ IONOS deploy tree built ================" -ForegroundColor Green
Write-Host ("  OutDir: " + $OutDir)
Show-Dir 'public/'        $OutPublic
Show-Dir 'public/v1/'     $OutV1
Show-Dir 'public/admin/'  $OutAdmin
Show-Dir 'lib/   (outside docroot)' $OutLib
Show-Dir 'keys/  (outside docroot)' $OutKeys
Show-Dir 'root   (outside docroot)' $OutDir
Write-Host ""
Write-Host "  config: set-env.php=$setEnvStatus | public/.user.ini=$userIniStatus | public/.htaccess=$htaccessStat"
Write-Host "  admin_password.hash: $hashStatus"
Write-Host "  GUARDRAIL: no sensitive files under public/  -> PASS" -ForegroundColor Green
Write-Host ""
Write-Host "  Manual step left: point the IONOS subdomain document root at public/;" -ForegroundColor Yellow
Write-Host "  keep lib/, keys/, set-env.php ABOVE it. Fill REPLACE_ values before upload." -ForegroundColor Yellow
