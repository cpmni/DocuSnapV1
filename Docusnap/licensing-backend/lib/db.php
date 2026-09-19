<?php
// licensing-backend/lib/db.php — MySQL (PDO) connection + small JSON helpers.
// Host-portable: connection settings come from environment variables with safe
// localhost defaults, so the same code runs on the WAMP dev VM and the future
// IONOS host with no code change (only env/config differs).

// Load the production env shim (set-env.php) by a RELATIVE path so the deploy works
// regardless of any .user.ini auto_prepend_file absolute path. set-env.php is a sibling
// of lib/ (i.e. <app>/set-env.php). INERT on dev where the file does not exist, and
// idempotent (require_once) if .user.ini also prepended it. Every entry point that needs
// the DB requires db.php, so this guarantees getenv('LICENSING_DB_*') is populated.
$__ds_env = __DIR__ . '/../set-env.php';
if (is_file($__ds_env)) { require_once $__ds_env; }
unset($__ds_env);

// Runtime hardening (SEC-13/SEC-15): display_errors off, baseline security headers, and a
// last-resort fatal handler that emits a detail-free 500 instead of leaking server paths.
// Loaded here because EVERY entry point requires db.php — one chokepoint, nothing to forget.
require_once __DIR__ . '/harden.php';

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $host = getenv('LICENSING_DB_HOST') ?: '127.0.0.1';
    $name = getenv('LICENSING_DB_NAME') ?: 'licensing';
    $user = getenv('LICENSING_DB_USER') ?: 'root';
    $pass = getenv('LICENSING_DB_PASS') ?: '';
    $dsn  = "mysql:host=$host;dbname=$name;charset=utf8mb4";
    $pdo  = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    return $pdo;
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function send_json(int $status, array $body): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($body);
}

function bad_request(string $message): void
{
    send_json(400, ['error' => [
        'code'       => 'bad_request',
        'message'    => $message,
        'request_id' => bin2hex(random_bytes(8)),
    ]]);
}

// ── Real client IP behind Cloudflare (2026-09-19, Oracle SIGN-OFF-W/COND C2/C3) ──
// This site is proxied by Cloudflare, so $_SERVER['REMOTE_ADDR'] is a CF EDGE, never
// the customer. client_ip() is the ONE canonical resolver, defined HERE (db.php, the
// universal chokepoint that also holds audit_event) so BOTH the rate limiter buckets
// (lib/ratelimit.php) and the audit rows below get the real IP — including the admin /
// reconcile / prune pages that load db.php WITHOUT ratelimit.php. ratelimit.php keeps a
// function_exists-guarded fallback (dead in prod, safe for an ordered deploy).
//
// SECURITY (C3, load-bearing): CF-Connecting-IP is trusted ONLY when the request truly
// arrived THROUGH Cloudflare (REMOTE_ADDR is a CF edge). A direct-to-origin request could
// forge the header, so outside CF ranges we IGNORE it and fall back to REMOTE_ADDR — else
// an attacker who found the origin IP could mint a fresh client IP per request and evade
// the per-IP anti-automation brakes.

// Is $cidr's network prefix a match for $ip? Handles IPv4 and IPv6; a family mismatch
// (v4 IP vs v6 range, or vice-versa) returns false. inet_pton gives 4 or 16 network bytes.
function ip_in_cidr(string $ip, string $cidr): bool
{
    if (strpos($cidr, '/') === false) {
        return false;
    }
    [$net, $bitsRaw] = explode('/', $cidr, 2);
    $bits   = (int) $bitsRaw;
    $ipBin  = @inet_pton($ip);
    $netBin = @inet_pton($net);
    if ($ipBin === false || $netBin === false) {
        return false;
    }
    if (strlen($ipBin) !== strlen($netBin)) {
        return false;   // v4 vs v6 — never comparable
    }
    $maxBits = strlen($ipBin) * 8;   // 32 or 128
    if ($bits < 0 || $bits > $maxBits) {
        return false;
    }
    $whole = intdiv($bits, 8);
    $rem   = $bits % 8;
    if ($whole > 0 && substr($ipBin, 0, $whole) !== substr($netBin, 0, $whole)) {
        return false;
    }
    if ($rem === 0) {
        return true;
    }
    $mask = 0xff << (8 - $rem) & 0xff;
    return (ord($ipBin[$whole]) & $mask) === (ord($netBin[$whole]) & $mask);
}

// Cloudflare's published edge ranges. The env override (set-env.php) lets the owner patch
// a stale range with NO code deploy. Fail-safe direction (Oracle Q3): a NEW CF range absent
// from this list ⇒ that edge is treated as non-CF ⇒ CF-Connecting-IP ignored ⇒ client_ip
// returns REMOTE_ADDR = the CF edge = today's behaviour. Degrades to status quo, never worse.
function cf_ip_ranges(): array
{
    $env = getenv('LICENSING_CF_IPS');
    if (is_string($env) && trim($env) !== '') {
        $out = [];
        foreach (preg_split('/[\s,]+/', trim($env)) as $c) {
            if ($c !== '') { $out[] = $c; }
        }
        if ($out) {
            return $out;
        }
    }
    // Source: https://www.cloudflare.com/ips-v4 + /ips-v6 — fetched 2026-09-19.
    // Prune when Cloudflare REMOVES a range (a decommissioned-but-still-listed range
    // later reassigned would be a small trust hole).
    return [
        '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
        '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
        '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
        '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
        '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
        '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
    ];
}

function remote_is_cloudflare(string $ip): bool
{
    if ($ip === '' || filter_var($ip, FILTER_VALIDATE_IP) === false) {
        return false;
    }
    foreach (cf_ip_ranges() as $cidr) {
        if (ip_in_cidr($ip, $cidr)) {
            return true;
        }
    }
    return false;
}

// The real client IP for rate limiting + audit. REMOTE_ADDR unless the request came THROUGH
// a Cloudflare edge and carries a syntactically valid CF-Connecting-IP.
function client_ip(): string
{
    $remote = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    if (remote_is_cloudflare($remote)) {
        $cf = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? '';
        if (is_string($cf) && filter_var($cf, FILTER_VALIDATE_IP) !== false) {
            return $cf;
        }
    }
    return $remote;
}

// Server-side audit (authoritative). Brand-neutral action names; never logs the
// plaintext account_key. ip is captured for support/investigation — the REAL client IP
// (client_ip() unwraps Cloudflare), not the CF edge.
function audit_event(PDO $pdo, ?int $accountId, ?string $fpHash, string $action, string $detail): void
{
    $ip = client_ip();
    $pdo->prepare('INSERT INTO audit_events (fp_hash, account_id, action, detail, ip)
                   VALUES (?, ?, ?, ?, ?)')->execute([$fpHash, $accountId, $action, $detail, $ip]);
}
