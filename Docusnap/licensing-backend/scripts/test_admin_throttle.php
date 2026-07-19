<?php
// licensing-backend/scripts/test_admin_throttle.php — SEC-01/SEC-06 verification gate
// (Oracle-required). Run with WAMP MySQL up:  php scripts\test_admin_throttle.php
//
// Proves, against a SCRATCH database it creates and drops itself (never touches the
// real licensing DB):
//   1. 11th same-IP attempt is DENIED (ADMIN_RL_IP_MAX=10 fixed window).
//   2. Oracle C1: 60 denied POSTs from ONE IP do NOT deny a second IP — the IP bucket
//      short-circuits before the global bucket, so one address can never inflate the
//      global counter past its own cap and lock the console for everyone.
//   3. Oracle C2: a hammering IP produces at most ONE audit row per window
//      (first-crossing only), not one per denied request.
//   4. SEC-06 seam: with the rate_limits table DROPPED, admin_throttle FAILS CLOSED
//      (denies, 60s) while rate_hit (the /v1 wrapper) still FAILS OPEN (allows) —
//      a regression that re-unifies the two paths fails here loudly.
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { die("cli only\n"); }

$SCRATCH = 'licensing_throttle_test';
putenv('LICENSING_DB_NAME=' . $SCRATCH);   // db() reads env — point it at the scratch DB

$host = getenv('LICENSING_DB_HOST') ?: '127.0.0.1';
$user = getenv('LICENSING_DB_USER') ?: 'root';
$pass = getenv('LICENSING_DB_PASS') ?: '';

$fail = 0;
function check(string $label, bool $cond): void
{
    global $fail;
    echo '  ' . ($cond ? 'OK ' : 'BAD') . ' ' . $label . "\n";
    if (!$cond) { $fail++; }
}

try {
    $root = new PDO("mysql:host={$host};charset=utf8mb4", $user, $pass,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
} catch (Throwable $e) {
    die("Cannot connect to MySQL on {$host} (is WAMP running?): {$e->getMessage()}\n");
}

$root->exec("DROP DATABASE IF EXISTS `{$SCRATCH}`");
$root->exec("CREATE DATABASE `{$SCRATCH}` CHARACTER SET utf8mb4");
$root->exec("USE `{$SCRATCH}`");
$root->exec('CREATE TABLE rate_limits (
    bucket VARCHAR(190) NOT NULL PRIMARY KEY,
    count INT NOT NULL DEFAULT 0,
    window_start BIGINT NOT NULL DEFAULT 0)');
// admin_audit writes here best-effort; give it the real shape's essentials.
$root->exec('CREATE TABLE audit_events (
    id INT AUTO_INCREMENT PRIMARY KEY, fp_hash VARCHAR(64) NULL, account_id INT NULL,
    action VARCHAR(80) NOT NULL, detail TEXT NULL, ip VARCHAR(45) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');

require __DIR__ . '/../lib/admin_auth.php';   // pulls ratelimit.php + db.php lazily

$stage = 'tst' . substr(bin2hex(random_bytes(3)), 0, 6);   // unique buckets per run

echo "1. per-IP cap ({$stage})\n";
$_SERVER['REMOTE_ADDR'] = '198.51.100.10';
$denied = null;
for ($i = 1; $i <= ADMIN_RL_IP_MAX; $i++) { $denied = admin_throttle($stage); }
check('attempts 1..' . ADMIN_RL_IP_MAX . ' all allowed', $denied === null);
$r = admin_throttle($stage);
check('attempt ' . (ADMIN_RL_IP_MAX + 1) . ' DENIED with retry-after', is_int($r) && $r >= 1);

echo "2. Oracle C1 — one IP cannot lock the console globally\n";
for ($i = 0; $i < 60; $i++) { admin_throttle($stage); }   // keep hammering from IP A
$db = db();
$g = (int) $db->query("SELECT count FROM rate_limits WHERE bucket = 'admin_{$stage}_global'")->fetchColumn();
check("global bucket stayed at <= IP_MAX after 70 one-IP attempts (got {$g})", $g <= ADMIN_RL_IP_MAX);
$_SERVER['REMOTE_ADDR'] = '203.0.113.99';   // a DIFFERENT source
check('a second IP is still allowed', admin_throttle($stage) === null);

echo "3. Oracle C2 — audit first-crossing only\n";
$a = (int) $db->query("SELECT COUNT(*) FROM audit_events WHERE action = 'admin.login_throttled'")->fetchColumn();
check("<= 2 audit rows despite ~70 denies (got {$a})", $a >= 1 && $a <= 2);

echo "4. SEC-06 seam — admin fails CLOSED, /v1 fails OPEN\n";
$db->exec('DROP TABLE rate_limits');
$_SERVER['REMOTE_ADDR'] = '192.0.2.55';
$r = admin_throttle($stage);
check('admin_throttle with NO table => DENY 60s (fail closed)', $r === 60);
$open = rate_hit($db, 'v1_test_bucket', 5, 60);
check('rate_hit with NO table => allowed (fail open, /v1 availability)', $open['allowed'] === true);

$root->exec("DROP DATABASE IF EXISTS `{$SCRATCH}`");
echo $fail ? "\n{$fail} check(s) FAILED\n" : "\nAll admin-throttle checks passed.\n";
exit($fail ? 1 : 0);
