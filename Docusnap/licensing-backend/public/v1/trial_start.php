<?php
// POST /v1/trial/start — start OR RESUME a trial for (product_id, fp_hash).
// Idempotent: if the fingerprint already exists, the EXISTING window is returned
// unchanged (never re-minted). The backend is the source of truth for the trial
// clock, so deleting the client's local DB can never reset the trial.
//
// Phase 1: returns a readable trial snapshot (state, trial_start, trial_end,
// days_remaining). Signed-JWS issuance is added in Phase 2 alongside client-side
// verification. Only product_id + fp_hash are accepted; no raw fingerprint.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/jws.php';

const TRIAL_DAYS = 14;
const ACTIVE_KID = 'k1';

$body      = read_json_body();
$productId = isset($body['product_id']) ? trim((string) $body['product_id']) : '';
$fpHash    = isset($body['fp_hash']) ? strtolower(trim((string) $body['fp_hash'])) : '';

if ($productId === '' || !preg_match('/^[0-9a-f]{64}$/', $fpHash)) {
    bad_request('product_id and a 64-hex fp_hash are required');
    return;
}

try {
    $pdo = db();
    // Ensure the product row exists (FK target). Brand-neutral default name.
    $pdo->prepare('INSERT IGNORE INTO products (product_id, name_internal) VALUES (?, ?)')
        ->execute([$productId, 'product']);

    $sel = $pdo->prepare(
        'SELECT trial_start, trial_end FROM device_registrations
         WHERE product_id = ? AND fp_hash = ?'
    );
    $sel->execute([$productId, $fpHash]);
    $row = $sel->fetch();

    if ($row && $row['trial_start'] !== null) {
        // RESUME — touch last_seen only; never move the window.
        $pdo->prepare(
            'UPDATE device_registrations SET last_seen = NOW()
             WHERE product_id = ? AND fp_hash = ?'
        )->execute([$productId, $fpHash]);
        $trialStart = $row['trial_start'];
        $trialEnd   = $row['trial_end'];
        $resumed    = true;
    } else {
        // CREATE — first time this fingerprint is seen for this product.
        $pdo->prepare(
            'INSERT INTO device_registrations
                (fp_hash, product_id, first_seen, last_seen, trial_start, trial_end)
             VALUES (?, ?, NOW(), NOW(), NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))
             ON DUPLICATE KEY UPDATE last_seen = NOW()'
        )->execute([$fpHash, $productId, TRIAL_DAYS]);

        $re = $pdo->prepare(
            'SELECT trial_start, trial_end FROM device_registrations
             WHERE product_id = ? AND fp_hash = ?'
        );
        $re->execute([$productId, $fpHash]);
        $r = $re->fetch();
        $trialStart = $r['trial_start'];
        $trialEnd   = $r['trial_end'];
        $resumed    = false;
    }

    $now           = new DateTimeImmutable('now');
    $end           = new DateTimeImmutable($trialEnd);
    $state         = ($now < $end) ? 'active' : 'expired';
    $daysRemaining = max(0, (int) ceil(($end->getTimestamp() - $now->getTimestamp()) / 86400));

    $claims = trial_claims($productId, $fpHash, $state, $trialStart, $trialEnd);
    $token  = jws_sign($claims, ACTIVE_KID);

    audit_event($pdo, null, $fpHash, 'license.trial_started', 'resumed=' . ($resumed ? '1' : '0') . " state=$state");

    send_json(200, [
        'token'          => $token,
        'kind'           => 'trial',
        'state'          => $state,
        'trial_start'    => $trialStart,
        'trial_end'      => $trialEnd,
        'days_remaining' => $daysRemaining,
        'resumed'        => $resumed,
    ]);
} catch (Throwable $e) {
    error_log('trial_start error: ' . $e->getMessage());
    send_json(500, ['error' => [
        'code'       => 'server_error',
        'message'    => 'trial/start failed',
        'request_id' => bin2hex(random_bytes(8)),
    ]]);
}
