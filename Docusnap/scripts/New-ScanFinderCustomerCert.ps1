<#
.SYNOPSIS
  Generate a per-customer TLS certificate set for the ScanFinder detached-client API.

.DESCRIPTION
  Each customer's core app is reached on its own LAN address, so each customer gets its
  OWN self-contained certificate authority (CA) plus a server certificate signed by that
  CA. This isolates customers (one customer's CA cannot impersonate another's server) and
  lets you re-issue a customer's server cert from the same CA WITHOUT re-distributing what
  their clients trust.

  Produces, in <OutDir>\<Customer>\:
    ca.crt      The customer's CA.     PIN THIS on each client (Connect screen -> Choose .crt).
    ca.key      The customer's CA key. KEEP PRIVATE (vendor side); used to re-issue server certs.
    server.crt  The server certificate (carries the customer's IP / hostname SANs).
    server.key  The server private key.
                -> core app: Settings > Licensing > Search client access > TLS cert / key.

  Requires OpenSSL (on PATH, or bundled with Git for Windows). Windows'
  New-SelfSignedCertificate is intentionally NOT used here: it emits IP SANs incorrectly,
  and a single self-signed leaf pinned as its own CA fails verification in Node (the
  client's TLS runtime) -- a proper CA -> server-cert chain is required.

.PARAMETER Customer
  Short customer name/slug (becomes the output folder name + CA common-name suffix).

.PARAMETER Address
  One or more addresses the server will be reached at. IPv4/IPv6 values become IP SANs,
  anything else becomes a DNS SAN. The FIRST entry is the certificate's CN.
  e.g. -Address 192.168.0.50            (IP only)
       -Address 10.0.0.5, sf.acme.local (IP + hostname)

.PARAMETER OutDir
  Base output directory (default: .\customer-certs). Each customer gets a subfolder.

.PARAMETER Days
  Server certificate validity in days (default 825 -- the max many TLS clients accept).

.EXAMPLE
  .\New-ScanFinderCustomerCert.ps1 -Customer acme -Address 192.168.0.50

.EXAMPLE
  .\New-ScanFinderCustomerCert.ps1 -Customer beta -Address 10.0.0.5, scanfinder.beta.local -OutDir D:\certs
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Customer,
  [Parameter(Mandatory)][string[]]$Address,
  [string]$OutDir = (Join-Path (Get-Location) 'customer-certs'),
  [int]$Days = 825,
  [switch]$ForceNewCa
)

# 'Continue' (not 'Stop') so OpenSSL's stderr progress output isn't wrapped into a
# terminating NativeCommandError by Windows PowerShell 5.1; each step is guarded by an
# explicit $LASTEXITCODE check + throw instead.
$ErrorActionPreference = 'Continue'

# --- locate openssl (PATH, then common Git for Windows locations) ---
$openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
if (-not $openssl) {
  foreach ($p in @(
    'C:\Program Files\Git\usr\bin\openssl.exe',
    'C:\Program Files\Git\mingw64\bin\openssl.exe',
    'C:\Program Files (x86)\Git\usr\bin\openssl.exe'
  )) { if (Test-Path $p) { $openssl = $p; break } }
}
if (-not $openssl) { throw "OpenSSL not found. Install Git for Windows (ships openssl) or add openssl to PATH." }

# Git's OpenSSL is an MSYS program -- stop it rewriting "/CN=..." into a filesystem path.
$env:MSYS_NO_PATHCONV = '1'

# --- output paths ---
$dir   = Join-Path $OutDir $Customer
New-Item -ItemType Directory -Force -Path $dir -ErrorAction Stop | Out-Null
$caKey="$dir\ca.key"; $caCrt="$dir\ca.crt"
$srvKey="$dir\server.key"; $srvCsr="$dir\server.csr"; $srvCrt="$dir\server.crt"; $ext="$dir\server.ext"

# --- classify each address into an IP or DNS SAN ---
$sans = @()
foreach ($a in $Address) {
  $a = $a.Trim(); if (-not $a) { continue }
  if ($a -as [ipaddress]) { $sans += "IP:$a" } else { $sans += "DNS:$a" }
}
if (-not $sans) { throw "No valid -Address values supplied." }
$cn = $Address[0].Trim()

Write-Host "Customer : $Customer"
Write-Host "CN       : $cn"
Write-Host "SANs     : $($sans -join ', ')"
Write-Host "Output   : $dir`n"

# --- 1) the customer's CA (10-year) ---
# Reuse an existing CA so re-issuing the server cert keeps clients' already-pinned
# ca.crt valid (rotation without re-distribution). -ForceNewCa replaces it.
if ((Test-Path $caCrt) -and (Test-Path $caKey) -and -not $ForceNewCa) {
  Write-Host "Reusing existing CA in this folder (clients keep trusting ca.crt). Pass -ForceNewCa to replace it.`n"
} else {
  & $openssl req -x509 -newkey rsa:2048 -nodes -keyout $caKey -out $caCrt -days 3650 `
    -subj "/CN=ScanFinder CA - $Customer" `
    -addext "basicConstraints=critical,CA:TRUE" `
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>$null
  if ($LASTEXITCODE) { throw "CA generation failed (openssl exit $LASTEXITCODE)." }
}

# --- 2) server key + CSR ---
& $openssl req -newkey rsa:2048 -nodes -keyout $srvKey -out $srvCsr -subj "/CN=$cn" 2>$null
if ($LASTEXITCODE) { throw "Server CSR generation failed (openssl exit $LASTEXITCODE)." }

# --- 3) server extensions: the SANs + a TLS server cert ---
@(
  "subjectAltName=$($sans -join ',')"
  "basicConstraints=CA:FALSE"
  "keyUsage=digitalSignature,keyEncipherment"
  "extendedKeyUsage=serverAuth"
) -join "`n" | Set-Content -Path $ext -Encoding ascii

# --- 4) sign the server cert with the customer's CA ---
& $openssl x509 -req -in $srvCsr -CA $caCrt -CAkey $caKey -CAcreateserial -out $srvCrt -days $Days -extfile $ext 2>$null
if ($LASTEXITCODE) { throw "Server certificate signing failed (openssl exit $LASTEXITCODE)." }

# --- verify the chain, then tidy intermediates ---
& $openssl verify -CAfile $caCrt $srvCrt
Remove-Item $srvCsr, $ext, "$dir\ca.srl" -ErrorAction SilentlyContinue

Write-Host "`nDeliver to customer '$Customer':"
Write-Host "  core app -> server.crt + server.key   (Settings > Search client access > TLS cert / key)"
Write-Host "  clients  -> ca.crt                     (Connect screen > Choose .crt)"
Write-Host "  KEEP PRIVATE (vendor) -> ca.key        (re-issue server certs without re-pinning clients)"
