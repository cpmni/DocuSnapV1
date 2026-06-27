<?php
// Integration test for the Polar DB helpers (lib/entitlements.php). Connects to the
// configured licensing DB, runs a full account→grant→renew→revoke→reissue scenario in
// ONE transaction, then ROLLS BACK — nothing is persisted. Run on the HOST AFTER
// importing the updated schema (it relies on the polar_* columns existing):
//   php licensing-backend/lib/test_polar_db.php
require __DIR__ . '/db.php';
require __DIR__ . '/entitlements.php';

$fail = 0;
function check($l, $c) { global $fail; echo ($c ? "  OK  " : "  BAD ") . "$l\n"; if (!$c) $fail++; }

try { $pdo = db(); $pdo->query('SELECT 1'); }
catch (Throwable $e) { echo "  SKIP no DB reachable: " . $e->getMessage() . "\n"; exit(0); }

$pid = '00000000-0000-0000-0000-0000000000aa';
$pdo->beginTransaction();
try {
    $pdo->prepare('INSERT IGNORE INTO products (product_id, name_internal) VALUES (?, "polar-test")')->execute([$pid]);

    $cust = 'cus_test_' . bin2hex(random_bytes(4));
    [$accId, $key1]  = find_or_create_polar_account($pdo, $cust, 'buyer@example.com', 'Buyer One');
    check('new account created with SF- key', $accId > 0 && $key1 !== null && strncmp($key1, 'SF-', 3) === 0);
    check('contact email stored on create', account_email($pdo, $accId) === 'buyer@example.com');
    $nm = $pdo->prepare('SELECT name FROM accounts WHERE id = ?');
    $nm->execute([$accId]); check('contact name stored on create', $nm->fetchColumn() === 'Buyer One');
    [$accId2, $key2] = find_or_create_polar_account($pdo, $cust, 'updated@example.com', 'Buyer Updated');
    check('same customer -> same account, no new key', $accId2 === $accId && $key2 === null);
    check('contact email refreshed on existing account', account_email($pdo, $accId) === 'updated@example.com');
    $nm->execute([$accId]); check('contact name refreshed on existing account', $nm->fetchColumn() === 'Buyer Updated');

    $sku = ['product_id' => $pid, 'features' => ['core' => 1, 'search' => 5, 'workflow' => 5], 'term' => 'sub'];
    grant_polar_entitlements($pdo, $accId, $sku, 'sub_1', 'price_team5', '2027-01-01 00:00:00');
    $sel = $pdo->prepare('SELECT feature, seats_total, polar_ref, polar_price_id, expires_at FROM entitlements WHERE account_id = ? AND status = "active" ORDER BY feature');
    $sel->execute([$accId]); $ent = $sel->fetchAll();
    check('three feature entitlements created', count($ent) === 3);
    $byf = []; foreach ($ent as $r) $byf[$r['feature']] = $r;
    check('core=1 search=5 workflow=5 (client seats on top of core)',
          (int) $byf['core']['seats_total'] === 1 && (int) $byf['search']['seats_total'] === 5 && (int) $byf['workflow']['seats_total'] === 5);
    check('polar_ref + price + expiry stamped on core',
          $byf['core']['polar_ref'] === 'sub_1' && $byf['core']['polar_price_id'] === 'price_team5' && $byf['core']['expires_at'] === '2027-01-01 00:00:00');

    // Renewal extends the SAME rows (no duplicates) and pushes out the period end.
    grant_polar_entitlements($pdo, $accId, $sku, 'sub_1', 'price_team5', '2028-01-01 00:00:00');
    $sel->execute([$accId]);
    check('renewal does not duplicate (still 3 active)', count($sel->fetchAll()) === 3);
    $e2 = $pdo->prepare('SELECT expires_at FROM entitlements WHERE account_id = ? AND feature = "core"');
    $e2->execute([$accId]);
    check('renewal extended the expiry', $e2->fetchColumn() === '2028-01-01 00:00:00');

    // Revoke by the Polar object ref.
    $n = revoke_polar($pdo, 'sub_1');
    check('revoke ended all 3 entitlements', $n === 3);
    $act = $pdo->prepare('SELECT COUNT(*) FROM entitlements WHERE account_id = ? AND status = "active"');
    $act->execute([$accId]);
    check('no active entitlements remain', (int) $act->fetchColumn() === 0);

    // Perpetual grant leaves expires_at NULL.
    grant_polar_entitlements($pdo, $accId, ['product_id' => $pid, 'features' => ['core' => 1], 'term' => 'perpetual'], 'ord_9', 'price_perp', null);
    $pe = $pdo->prepare('SELECT expires_at FROM entitlements WHERE polar_ref = "ord_9"'); $pe->execute();
    check('perpetual grant has NULL expiry', $pe->fetchColumn() === null);

    // Per-seat quantity: a "1 client" SKU bought x3 grants 3 search/workflow seats.
    grant_polar_entitlements($pdo, $accId, ['product_id' => $pid, 'features' => ['search' => 1, 'workflow' => 1], 'term' => 'sub'], 'sub_seats', 'price_client', '2027-01-01 00:00:00', 3);
    $sq = $pdo->prepare('SELECT feature, seats_total FROM entitlements WHERE polar_ref = "sub_seats" ORDER BY feature');
    $sq->execute(); $seatRows = [];
    foreach ($sq as $r) { $seatRows[$r['feature']] = (int) $r['seats_total']; }
    check('quantity x3 grants search=3 workflow=3', ($seatRows['search'] ?? 0) === 3 && ($seatRows['workflow'] ?? 0) === 3);

    // STACKING: a SECOND separate client subscription adds its OWN rows (does not overwrite),
    // so total search capacity is the SUM across active grants (the hardening fix).
    grant_polar_entitlements($pdo, $accId, ['product_id' => $pid, 'features' => ['search' => 1, 'workflow' => 1], 'term' => 'sub'], 'sub_client_b', 'price_client', '2027-06-01 00:00:00');
    $sumSel = $pdo->prepare('SELECT COALESCE(SUM(seats_total),0) FROM entitlements WHERE account_id = ? AND feature = "search" AND status = "active" AND (expires_at IS NULL OR expires_at > NOW())');
    $sumSel->execute([$accId]);
    check('second client subscription STACKS (search sums to 4)', (int) $sumSel->fetchColumn() === 4);
    // Cancelling ONE of the two leaves the other intact.
    revoke_polar($pdo, 'sub_seats');
    $sumSel->execute([$accId]);
    check('cancelling one client sub leaves the other (search = 1)', (int) $sumSel->fetchColumn() === 1);

    // BASKET: a multi-item order grants per-line rows keyed sub:price; revoking by the BARE
    // subscription ref must clear ALL of its lines (prefix match in revoke_polar).
    grant_polar_entitlements($pdo, $accId, ['product_id' => $pid, 'features' => ['search' => 1], 'term' => 'sub'], 'sub_basket:priceA', 'priceA', '2027-01-01 00:00:00');
    grant_polar_entitlements($pdo, $accId, ['product_id' => $pid, 'features' => ['search' => 5], 'term' => 'sub'], 'sub_basket:priceB', 'priceB', '2027-01-01 00:00:00');
    check('basket lines created as separate rows', (int) $pdo->query('SELECT COUNT(*) FROM entitlements WHERE polar_ref LIKE "sub_basket:%" AND status = "active"')->fetchColumn() === 2);
    check('revoke by bare sub ref clears all basket lines', revoke_polar($pdo, 'sub_basket') === 2);

    // Reissue rotates the stored hash (never the plaintext at rest).
    $h = $pdo->prepare('SELECT account_key_hash FROM accounts WHERE id = ?');
    $h->execute([$accId]); $before = $h->fetchColumn();
    $newKey = reissue_account_key($pdo, $accId);
    $h->execute([$accId]); $after = $h->fetchColumn();
    check('reissue rotates the stored hash', $after !== $before && hash('sha256', $newKey) === $after);
} finally {
    $pdo->rollBack();   // persist NOTHING
}
echo $fail ? "\n$fail FAILED\n" : "\nAll Polar DB checks passed (rolled back — nothing persisted)\n";
exit($fail ? 1 : 0);
