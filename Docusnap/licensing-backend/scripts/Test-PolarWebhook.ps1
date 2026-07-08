<#
.SYNOPSIS
  Send a correctly-signed Standard-Webhooks POST to the Polar webhook endpoint, to verify
  signature + payload parsing + DB end-to-end WITHOUT needing Polar's dashboard.

.DESCRIPTION
  Uses a 'checkout.updated' event, which the endpoint maps to IGNORE — so it proves the
  whole path (signature verified, body parsed, idempotency row written to the DB) while
  creating NO account/entitlement and sending no email. Interpret the result:
    HTTP 200 {"status":"ignored"}      -> ✅ working (secret matches, DB reachable)
    HTTP 401 invalid_signature         -> secret wrong / has a BOM or whitespace
    HTTP 503 not_configured            -> keys/polar_webhook_secret missing on the server
    HTTP 500                           -> DB problem (set-env.php creds / schema not imported)

.PARAMETER Secret
  The Polar signing secret (whsec_… or the raw base64 value).

.PARAMETER Url
  Webhook URL. Defaults to the production direct-file URL.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\Test-PolarWebhook.ps1 -Secret 'whsec_xxx'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Secret,
  [string]$Url = 'https://licensing.scanfinder.co.uk/v1/polar_webhook.php'
)

$id   = 'msg_test_' + ([guid]::NewGuid().ToString('N').Substring(0, 16))
# True UTC Unix seconds. (Do NOT use Get-Date -UFormat %s — in Windows PowerShell 5.1 it is
# offset by the local timezone, pushing the timestamp outside the endpoint's +/-5min replay
# window, which surfaces as a 401 invalid_signature.)
$ts   = [string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$body = '{"type":"checkout.updated","data":{}}'    # IGNORE type -> nothing is created
$signed = "$id.$ts.$body"

# Derive the HMAC key: strip whsec_, base64-decode; fall back to raw bytes (matches lib/polar.php).
$s = $Secret
if ($s.StartsWith('whsec_')) { $s = $s.Substring(6) }
try { $key = [Convert]::FromBase64String($s) } catch { $key = [Text.Encoding]::UTF8.GetBytes($Secret) }

$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = $key
$sig = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($signed)))

$headers = @{ 'webhook-id' = $id; 'webhook-timestamp' = $ts; 'webhook-signature' = "v1,$sig" }

Write-Host "POST $Url"
Write-Host "  webhook-id: $id   timestamp: $ts"
try {
  $r = Invoke-WebRequest -Uri $Url -Method POST -Headers $headers -ContentType 'application/json' -Body $body -UseBasicParsing
  Write-Host ("HTTP {0}  {1}" -f [int]$r.StatusCode, $r.Content) -ForegroundColor Green
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    $code = [int]$resp.StatusCode
    $txt  = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
    Write-Host ("HTTP {0}  {1}" -f $code, $txt) -ForegroundColor Yellow
  } else {
    Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red
  }
}
