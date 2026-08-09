<?php
// POST /v1/revoke — release the seat bound to this fingerprint, freeing it for
// reactivation elsewhere (reinstall / hardware swap). The backend stays the
// source of truth for seat counts. Reactivate = revoke (here) then activate on
// the new fingerprint; NO new entitlement is created. Phase 4: owner releases
// via account_key (admin/support release path is future work).

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/ratelimit.php';

$body       = read_json_body();
$productId  = isset($body['product_id']) ? trim((string) $body['product_id']) : '';
$fpHash     = isset($body['fp_hash']) ? strtolower(trim((string) $body['fp_hash'])) : '';
$accountKey = isset($body['account_key']) ? (string) $body['account_key'] : '';

if ($productId === '' || !preg_match('/^[0-9a-f]{64}$/', $fpHash) || $accountKey === '') {
    bad_request('product_id, 64-hex fp_hash and account_key are required');
    return;
}

try {
    $pdo = db();
    // Anti-automation (F-03): same per-IP cap + failed-guess backoff as /v1/activate
    // (revoke also takes an account_key). Legitimate release of a real key is rare
    // and never trips the fail bucket.
    $ip = client_ip();
    $gen = rate_hit($pdo, "activate_ip:$ip", 30, 3600);
    if (!$gen['allowed']) { too_many_requests($gen['retry_after']); return; }
    if (rate_count($pdo, "activate_fail_ip:$ip", 3600) > 12) { too_many_requests(900); return; }
    $accountHash = hash('sha256', $accountKey); // never store/log the plaintext key

    $acc = $pdo->prepare('SELECT id, status FROM accounts WHERE account_key_hash = ?');
    $acc->execute([$accountHash]);
    $account = $acc->fetch();
    if (!$account || $account['status'] !== 'active') {
        rate_hit($pdo, "activate_fail_ip:$ip", 12, 3600); // count key-guessing attempts
        send_json(400, ['error' => ['code' => 'unknown_account', 'message' => 'Activation key not recognised', 'request_id' => bin2hex(random_bytes(8))]]);
        return;
    }
    $accountId = (int) $account['id'];

    $ent = $pdo->prepare(
        'SELECT id, seats_total FROM entitlements
         WHERE account_id = ? AND product_id = ? AND feature = "core" AND status = "active" ORDER BY id LIMIT 1'
    );
    $ent->execute([$accountId, $productId]);
    $entitlement = $ent->fetch();
    if (!$entitlement) {
        send_json(400, ['error' => ['code' => 'unknown_account', 'message' => 'No active entitlement', 'request_id' => bin2hex(random_bytes(8))]]);
        return;
    }
    $entId      = (int) $entitlement['id'];
    $seatsTotal = (int) $entitlement['seats_total'];

    $pdo->beginTransaction();
    $sel = $pdo->prepare('SELECT id FROM seats WHERE entitlement_id = ? AND fp_hash = ? AND status = "bound"');
    $sel->execute([$entId, $fpHash]);
    $seat = $sel->fetch();
    if (!$seat) {
        $pdo->commit();
        audit_event($pdo, $accountId, $fpHash, 'license.revoke_failed', 'not_bound');
        send_json(400, ['error' => ['code' => 'not_bound', 'message' => 'No seat bound to this device', 'request_id' => bin2hex(random_bytes(8))]]);
        return;
    }

    $pdo->prepare('UPDATE seats SET fp_hash = NULL, released_at = NOW(), status = "released" WHERE id = ?')
        ->execute([(int) $seat['id']]);
    $seatsUsed = (int) $pdo->query("SELECT COUNT(*) FROM seats WHERE entitlement_id = $entId AND status = 'bound'")->fetchColumn();
    $pdo->commit();

    audit_event($pdo, $accountId, $fpHash, 'license.revoked', "seat={$seat['id']} seats=$seatsUsed/$seatsTotal");

    send_json(200, [
        'released'    => true,
        'seats_total' => $seatsTotal,
        'seats_used'  => $seatsUsed,
    ]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) { $pdo->rollBack(); }
    error_log('revoke error: ' . $e->getMessage());
    send_json(500, ['error' => ['code' => 'server_error', 'message' => 'revoke failed', 'request_id' => bin2hex(random_bytes(8))]]);
}
