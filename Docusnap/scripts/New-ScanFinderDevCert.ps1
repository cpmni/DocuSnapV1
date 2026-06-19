<#
.SYNOPSIS
  Generate a SELF-SIGNED TLS certificate for testing the detached-client /v1 API
  over the LAN. FOR DEVELOPMENT/TESTING ONLY — use an internal-CA-issued cert in
  production (see docs/DETACHED_CLIENT_HARDENING.md).

.DESCRIPTION
  Creates a self-signed cert for the given DNS name + IP, then exports server.crt
  (PEM) and server.key (PEM, unencrypted) for use with:
    SCANFINDER_API_TLS_CERT = <OutDir>\server.crt
    SCANFINDER_API_TLS_KEY  = <OutDir>\server.key
  Node's https server reads these directly.

.PARAMETER DnsName   Hostname clients will use (default: the machine's hostname).
.PARAMETER IpAddress Optional IP SAN to include.
.PARAMETER OutDir    Output directory (created if missing).

.EXAMPLE
  ./New-ScanFinderDevCert.ps1 -DnsName server-pc.lan -IpAddress 192.168.1.50 -OutDir C:\scanfinder-cert
#>
[CmdletBinding()]
param(
  [string]$DnsName = [System.Net.Dns]::GetHostName(),
  [string]$IpAddress,
  [string]$OutDir = (Join-Path (Get-Location) 'scanfinder-cert')
)

$ErrorActionPreference = 'Stop'
Write-Host "Generating self-signed dev cert for '$DnsName'$(if($IpAddress){" + $IpAddress"})..." -ForegroundColor Cyan
Write-Warning 'Self-signed — for development/testing only. Use an internal CA in production.'

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

$sans = @($DnsName)
if ($IpAddress) { $sans += $IpAddress }

$cert = New-SelfSignedCertificate `
  -Subject "CN=$DnsName" `
  -DnsName $sans `
  -KeyAlgorithm RSA -KeyLength 2048 `
  -NotAfter (Get-Date).AddYears(2) `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyExportPolicy Exportable

$pfxPath = Join-Path $OutDir 'server.pfx'
$pwd = [System.Guid]::NewGuid().ToString('N')
$securePwd = ConvertTo-SecureString -String $pwd -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePwd | Out-Null

# Convert the PFX into PEM cert + key that Node's https expects. Prefer openssl if
# available; otherwise tell the user how to proceed.
$openssl = (Get-Command openssl -ErrorAction SilentlyContinue)
if ($openssl) {
  & openssl pkcs12 -in $pfxPath -clcerts -nokeys  -out (Join-Path $OutDir 'server.crt') -passin "pass:$pwd"
  & openssl pkcs12 -in $pfxPath -nocerts -nodes   -out (Join-Path $OutDir 'server.key') -passin "pass:$pwd"
  Write-Host "Wrote server.crt and server.key to $OutDir" -ForegroundColor Green
  Write-Host "Set SCANFINDER_API_TLS_CERT / SCANFINDER_API_TLS_KEY to those paths." -ForegroundColor Green
} else {
  Write-Warning "openssl not found. PFX written to $pfxPath (password: $pwd)."
  Write-Warning "Convert to PEM with openssl, or load the PFX in your own start script."
}

# Print the SHA-256 thumbprint so a client can pin it if desired.
Write-Host "Cert SHA-256 thumbprint: $($cert.Thumbprint)" -ForegroundColor Yellow
