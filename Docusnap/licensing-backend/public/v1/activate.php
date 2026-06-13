<?php
// POST /v1/activate — bind a SEAT to this fingerprint (account with N seats).
// Idempotent: re-activating the same fingerprint returns its existing seat.
// Binds a free seat when available; otherwise seat_limit_reached. The backend is
// the source of truth for seat counts and bindings. account_key is hashed at
// rest (never stored or logged in plaintext). Phase 3: no revoke/re-seat here.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/jws.php';

const ACTIVE_KID = 'k1';

$body        = read_json_body();
$productId   = isset($body['product_id']) ? trim((string) $body['product_id']) : '';
$fpHash      = isset($body['fp_hash']) ? strtolower(trim((string) $body['fp_hash'])) : '';
$accountKey  = isset($body['account_key']) ? (string) $body['account_key'] : '';
$deviceLabel = isset($body['device_label']) && $body['device_label'] !== null
    ? substr(trim((string) $body['device_label']), 0, 120) : null;

if ($productId === '' || !preg_match('/^[0-9a-f]{64}$/', $fpHash) || $accountKey === '') {
    bad_request('product_id, 64-hex fp_hash and account_key are required');
    return;
}

try {
    $pdo = db();
    $accountHash = hash('sha256', $accountKey); // never store/log the plaintext key

    $acc = $pdo->prepare('SELECT id, status FROM accounts WHERE account_key_hash = ?');
    $acc->execute([$accountHash]);
    $account = $acc->fetch();
    if (!$account || $account['status'] !== 'active') {
        audit_event($pdo, $account['id'] ?? null, $fpHash, 'license.activate_failed', 'unknown_account');
        send_json(400, ['error' => ['code' => 'unknown_account', 'message' => 'Activation key not recognised', 'request_id' => bin2hex(random_bytes(8))]]);
        return;
    }
    $accountId = (int) $account['id'];

    $ent = $pdo->prepare(
        'SELECT id, seats_total, expires_at FROM entitlements
         WHERE account_id = ? AND product_id = ? AND status = "active"
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY id LIMIT 1'
    );
    $ent->execute([$accountId, $productId]);
    $entitlement = $ent->fetch();
    if (!$entitlement) {
        audit_event($pdo, $accountId, $fpHash, 'license.activate_failed', 'no_entitlement');
        send_json(400, ['error' => ['code' => 'unknown_account', 'message' => 'No active entitlement', 'request_id' => bin2hex(random_bytes(8))]]);
        return;
    }
    $entId      = (int) $entitlement['id'];
    $seatsTotal = (int) $entitlement['seats_total'];
    $expiresAt  = $entitlement['expires_at'];

    $pdo->beginTransaction();

    // Idempotent re-bind: a seat already bound to THIS fingerprint?
    $cur = $pdo->prepare('SELECT id FROM seats WHERE entitlement_id = ? AND fp_hash = ? AND status = "bound"');
    $cur->execute([$entId, $fpHash]);
    $seat = $cur->fetch();

    if ($seat) {
        $seatId = (int) $seat['id'];
        if ($deviceLabel !== null) {
            $pdo->prepare('UPDATE seats SET device_label = ? WHERE id = ?')->execute([$deviceLabel, $seatId]);
        }
    } else {
        $used = (int) $pdo->query("SELECT COUNT(*) FROM seats WHERE entitlement_id = $entId AND status = 'bound'")->fetchColumn();
        if ($used >= $seatsTotal) {
            $pdo->commit();
            audit_event($pdo, $accountId, $fpHash, 'license.activate_failed', 'seat_limit_reached');
            send_json(400, ['error' => ['code' => 'seat_limit_reached', 'message' => 'All seats are in use', 'request_id' => bin2hex(random_bytes(8))]]);
            return;
        }
        // Reuse a previously released seat row if any, else insert a new one.
        $freed = $pdo->prepare('SELECT id FROM seats WHERE entitlement_id = ? AND status = "released" ORDER BY id LIMIT 1');
        $freed->execute([$entId]);
        $f = $freed->fetch();
        if ($f) {
            $seatId = (int) $f['id'];
            $pdo->prepare('UPDATE seats SET fp_hash = ?, device_label = ?, bound_at = NOW(), released_at = NULL, status = "bound" WHERE id = ?')
                ->execute([$fpHash, $deviceLabel, $seatId]);
        } else {
            $pdo->prepare('INSERT INTO seats (entitlement_id, fp_hash, device_label, bound_at, status) VALUES (?, ?, ?, NOW(), "bound")')
                ->execute([$entId, $fpHash, $deviceLabel]);
            $seatId = (int) $pdo->lastInsertId();
        }
    }

    $seatsUsed = (int) $pdo->query("SELECT COUNT(*) FROM seats WHERE entitlement_id = $entId AND status = 'bound'")->fetchColumn();
    $pdo->commit();

    $claims = seat_claims($productId, $fpHash, 'active', $entId, $seatId, $seatsTotal, $seatsUsed, $expiresAt);
    $token  = jws_sign($claims, ACTIVE_KID);

    audit_event($pdo, $accountId, $fpHash, 'license.activated', "seat=$seatId seats=$seatsUsed/$seatsTotal");

    send_json(200, [
        'token'          => $token,
        'kind'           => 'seat',
        'state'          => 'active',
        'entitlement_id' => $entId,
        'seat_id'        => $seatId,
        'seats_total'    => $seatsTotal,
        'seats_used'     => $seatsUsed,
        'expires_at'     => $expiresAt,
    ]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) { $pdo->rollBack(); }
    error_log('activate error: ' . $e->getMessage());
    send_json(500, ['error' => ['code' => 'server_error', 'message' => 'activate failed', 'request_id' => bin2hex(random_bytes(8))]]);
}
