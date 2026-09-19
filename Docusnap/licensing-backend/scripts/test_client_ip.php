<?php
// licensing-backend/scripts/test_client_ip.php — Cloudflare real-client-IP resolver gate
// (2026-09-19, Oracle SIGN-OFF-W/COND C3). Run:  php scripts\test_client_ip.php
//
// No database needed (db() is lazy) — this is a pure-function test of client_ip() /
// remote_is_cloudflare() / ip_in_cidr() in lib/db.php.
//
// THE LOAD-BEARING CASE (must FAIL on the bug): a direct-to-origin request (REMOTE_ADDR
// NOT a Cloudflare edge) carrying a FORGED CF-Connecting-IP must be IGNORED — client_ip()
// returns REMOTE_ADDR. Trusting the header there would let an attacker who found the origin
// IP mint a fresh client IP per request and evade the per-IP anti-automation brakes.
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { die("cli only\n"); }

require __DIR__ . '/../lib/db.php';

$fail = 0;
function check(string $label, bool $cond): void
{
    global $fail;
    echo '  ' . ($cond ? 'OK ' : 'BAD') . ' ' . $label . "\n";
    if (!$cond) { $fail++; }
}
function with_server(array $vars, callable $fn)
{
    $saved = $_SERVER;
    // Clear the two keys we drive so a stale value never leaks between cases.
    unset($_SERVER['REMOTE_ADDR'], $_SERVER['HTTP_CF_CONNECTING_IP']);
    foreach ($vars as $k => $v) { $_SERVER[$k] = $v; }
    try { return $fn(); } finally { $_SERVER = $saved; }
}

echo "1. ip_in_cidr — IPv4/IPv6 boundaries + family mismatch\n";
check('172.68.1.2 in 172.64.0.0/13',            ip_in_cidr('172.68.1.2', '172.64.0.0/13'));
check('162.158.99.9 in 162.158.0.0/15',         ip_in_cidr('162.158.99.9', '162.158.0.0/15'));
check('141.101.70.1 in 141.101.64.0/18',        ip_in_cidr('141.101.70.1', '141.101.64.0/18'));
check('172.63.255.255 NOT in 172.64.0.0/13',   !ip_in_cidr('172.63.255.255', '172.64.0.0/13'));
check('172.72.0.0 boundary NOT in 172.64/13',  !ip_in_cidr('172.72.0.0', '172.64.0.0/13'));
check('8.8.8.8 NOT in 172.64.0.0/13',          !ip_in_cidr('8.8.8.8', '172.64.0.0/13'));
check('2606:4700::1 in 2606:4700::/32',         ip_in_cidr('2606:4700::1', '2606:4700::/32'));
check('2606:4701::1 NOT in 2606:4700::/32',    !ip_in_cidr('2606:4701::1', '2606:4700::/32'));
check('v4 IP vs v6 range → false',             !ip_in_cidr('172.68.1.2', '2606:4700::/32'));
check('v6 IP vs v4 range → false',             !ip_in_cidr('2606:4700::1', '172.64.0.0/13'));
check('garbage cidr → false',                  !ip_in_cidr('172.68.1.2', 'not-a-cidr'));

echo "2. remote_is_cloudflare\n";
check('CF v4 edge is CF',                        remote_is_cloudflare('172.68.1.2'));
check('CF v6 edge is CF',                        remote_is_cloudflare('2803:f800::5'));
check('public non-CF IP is NOT CF',             !remote_is_cloudflare('203.0.113.7'));
check('RFC5737 TEST-NET is NOT CF',             !remote_is_cloudflare('198.51.100.10'));
check('garbage is NOT CF',                      !remote_is_cloudflare('not-an-ip'));

echo "3. client_ip — the security cases\n";
// LOAD-BEARING: direct-to-origin + forged header → header IGNORED.
check('non-CF origin + forged CF header → REMOTE_ADDR (header ignored)',
    with_server(['REMOTE_ADDR' => '203.0.113.7', 'HTTP_CF_CONNECTING_IP' => '9.9.9.9'],
        fn() => client_ip() === '203.0.113.7'));
// Genuine Cloudflare hop → the real client wins.
check('CF edge + valid CF header → real client IP',
    with_server(['REMOTE_ADDR' => '172.68.1.2', 'HTTP_CF_CONNECTING_IP' => '81.2.3.4'],
        fn() => client_ip() === '81.2.3.4'));
check('CF edge + valid IPv6 CF header → real client IP',
    with_server(['REMOTE_ADDR' => '162.158.9.9', 'HTTP_CF_CONNECTING_IP' => '2001:db8::42'],
        fn() => client_ip() === '2001:db8::42'));
// CF edge but a broken/absent header → fall back to REMOTE_ADDR (the edge), never blank.
check('CF edge + garbage CF header → REMOTE_ADDR',
    with_server(['REMOTE_ADDR' => '172.68.1.2', 'HTTP_CF_CONNECTING_IP' => 'xxx'],
        fn() => client_ip() === '172.68.1.2'));
check('CF edge + no CF header → REMOTE_ADDR',
    with_server(['REMOTE_ADDR' => '172.68.1.2'],
        fn() => client_ip() === '172.68.1.2'));
check('no CF, no header → REMOTE_ADDR unchanged (today\'s behaviour)',
    with_server(['REMOTE_ADDR' => '198.51.100.10'],
        fn() => client_ip() === '198.51.100.10'));

echo "4. env override (LICENSING_CF_IPS) patches a stale range with no code deploy\n";
$savedEnv = getenv('LICENSING_CF_IPS');
putenv('LICENSING_CF_IPS=5.6.7.0/24 2001:db8:abcd::/48');
check('overridden range makes 5.6.7.9 a CF edge',        remote_is_cloudflare('5.6.7.9'));
check('a real CF edge NOT in the override is now non-CF', !remote_is_cloudflare('172.68.1.2'));
check('override + valid header → real client',
    with_server(['REMOTE_ADDR' => '5.6.7.9', 'HTTP_CF_CONNECTING_IP' => '81.2.3.4'],
        fn() => client_ip() === '81.2.3.4'));
if ($savedEnv === false) { putenv('LICENSING_CF_IPS'); } else { putenv('LICENSING_CF_IPS=' . $savedEnv); }

echo "\n" . ($fail === 0 ? "ALL OK\n" : "FAILURES: {$fail}\n");
exit($fail === 0 ? 0 : 1);
