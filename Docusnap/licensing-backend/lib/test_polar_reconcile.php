<?php
// Integration test for the reconcile CORE (lib/polar_reconcile.php) with a FAKE fetcher
// (no Polar token/network). Runs grant→in-sync→extend→unmapped→dry-run against the DB in
// ONE transaction, then ROLLS BACK. Run on the HOST after importing the schema:
//   php licensing-backend/lib/test_polar_reconcile.php
require __DIR__ . '/polar_reconcile.php';   // pulls in db + polar + entitlements

$fail = 0;
function check($l, $c) { global $fail; echo ($c ? "  OK  " : "  BAD ") . "$l\n"; if (!$c) $fail++; }

try { $pdo = db(); $pdo->query('SELECT 1'); }
catch (Throwable $e) { echo "  SKIP no DB reachable: " . $e->getMessage() . "\n"; exit(0); }

$pid = '00000000-0000-0000-0000-0000000000bb';
$map = ['prices' => ['price_r' => ['product_id' => $pid, 'features' => ['core' => 1, 'search' => 3], 'term' => 'sub']]];
$emails = [];
$deliver = function ($e, $k, $m) use (&$emails) { $emails[] = [$e, $k, $m]; return true; };

$pdo->beginTransaction();
try {
    $pdo->prepare('INSERT IGNORE INTO products (product_id, name_internal) VALUES (?, "recon-test")')->execute([$pid]);
    $cust = 'cus_r_' . bin2hex(random_bytes(4));
    $sub  = 'sub_r_' . bin2hex(random_bytes(4));
    $mk = fn($end) => [['id' => $sub, 'customer_id' => $cust, 'customer' => ['email' => 'r@x.com'], 'product_price_id' => 'price_r', 'current_period_end' => $end]];

    // 1. missed grant (APPLY)
    $s = polar_reconcile($pdo, fn() => $mk('2027-01-01T00:00:00Z'), $map, true, $deliver);
    check('granted a missed sub', $s['granted'] === 1 && $s['active_subs'] === 1);
    $row = $pdo->prepare('SELECT feature, expires_at FROM entitlements WHERE polar_ref = ? AND status = "active" ORDER BY feature');
    $row->execute([$sub]); $ent = $row->fetchAll();
    check('two entitlements created (core + search)', count($ent) === 2);
    check('expiry set from period end', $ent[0]['expires_at'] === '2027-01-01 00:00:00');
    check('key delivered for the new account', count($emails) === 1);

    // 2. re-run → in sync, no change
    $s = polar_reconcile($pdo, fn() => $mk('2027-01-01T00:00:00Z'), $map, true, $deliver);
    check('second run is in_sync', $s['in_sync'] === 1 && $s['granted'] === 0 && $s['extended'] === 0);

    // 3. drifted renewal → extend
    $s = polar_reconcile($pdo, fn() => $mk('2028-06-01T00:00:00Z'), $map, true, $deliver);
    check('renewal extended', $s['extended'] === 1);
    $e2 = $pdo->prepare('SELECT expires_at FROM entitlements WHERE polar_ref = ? AND feature = "core"');
    $e2->execute([$sub]);
    check('expiry pushed out', $e2->fetchColumn() === '2028-06-01 00:00:00');

    // 4. unmapped sub → counted, not granted
    $s = polar_reconcile($pdo, fn() => [['id' => 'sub_x', 'customer_id' => 'c', 'product_price_id' => 'price_nope', 'current_period_end' => '2027-01-01T00:00:00Z']], $map, true, $deliver);
    check('unmapped sub counted, not granted', $s['unmapped'] === 1 && $s['granted'] === 0);

    // 5. DRY RUN plans but writes nothing
    $sub2 = 'sub_dry_' . bin2hex(random_bytes(4));
    $dry = polar_reconcile($pdo, fn() => [['id' => $sub2, 'customer_id' => 'cdry', 'product_price_id' => 'price_r', 'current_period_end' => '2027-01-01T00:00:00Z']], $map, false, $deliver);
    check('dry-run plans a grant', $dry['granted'] === 1);
    $chk = $pdo->prepare('SELECT COUNT(*) FROM entitlements WHERE polar_ref = ?'); $chk->execute([$sub2]);
    check('dry-run wrote nothing', (int) $chk->fetchColumn() === 0);
} finally {
    $pdo->rollBack();
}
echo $fail ? "\n$fail FAILED\n" : "\nAll Polar reconcile checks passed (rolled back)\n";
exit($fail ? 1 : 0);
