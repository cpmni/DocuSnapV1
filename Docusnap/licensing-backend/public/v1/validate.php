<?php
// POST /v1/validate — refresh/re-verify. Returns a FRESH signed token whose
// 7-day grace restarts from issue, plus a readable state. Source of truth for
// the trial clock; never re-mints the trial window. Phase 2: trial only (seats
// arrive in Phase 3). Accepts only product_id + fp_hash (+ optional token_id).

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/jws.php';
require __DIR__ . '/../../lib/ratelimit.php';

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
    // Anti-automation (F-03): generous per-IP cap — validate runs on app start and
    // online refresh, so the threshold is high enough never to affect a real client
    // while still bounding scripted abuse.
    $ipHit = rate_hit($pdo, 'validate_ip:' . client_ip(), 120, 3600);
    if (!$ipHit['allowed']) { too_many_requests($ipHit['retry_after']); return; }

    // Seat-aware: if a bound SEAT exists for this fingerprint, re-issue a fresh
    // seat token (this is what refreshes the 7-day grace for paid users online).
    $seatSel = $pdo->prepare(
        'SELECT s.id AS seat_id, s.entitlement_id, e.account_id, e.seats_total, e.expires_at
         FROM seats s JOIN entitlements e ON e.id = s.entitlement_id
         WHERE s.fp_hash = ? AND s.status = "bound" AND e.product_id = ? AND e.feature = "core" AND e.status = "active"
         LIMIT 1'
    );
    $seatSel->execute([$fpHash, $productId]);
    $seat = $seatSel->fetch();
    if ($seat) {
        $entId      = (int) $seat['entitlement_id'];
        $seatsTotal = (int) $seat['seats_total'];
        $expiresAt  = $seat['expires_at'];
        $seatsUsed  = (int) $pdo->query("SELECT COUNT(*) FROM seats WHERE entitlement_id = $entId AND status = 'bound'")->fetchColumn();
        // Per-feature capacity (search/workflow): SUM across ALL active, non-expired grants
        // so separate client purchases STACK (each subscription is its own row, see
        // entitlements.webhook_apply_features).
        $featSel = $pdo->prepare('SELECT feature, COALESCE(SUM(seats_total),0) AS total FROM entitlements WHERE account_id = ? AND product_id = ? AND status = "active" AND (expires_at IS NULL OR expires_at > NOW()) AND feature IN ("search","workflow") GROUP BY feature');
        $featSel->execute([(int) $seat['account_id'], $productId]);
        $features = ['core' => $seatsTotal, 'search' => 0, 'workflow' => 0];
        foreach ($featSel as $fr) { $features[$fr['feature']] = (int) $fr['total']; }
        $expired    = $expiresAt !== null && new DateTimeImmutable($expiresAt) <= new DateTimeImmutable('now');
        $state      = $expired ? 'expired' : 'active';
        $claims     = seat_claims($productId, $fpHash, $state, $entId, (int) $seat['seat_id'], $seatsTotal, $seatsUsed, $expiresAt, $features);
        $token      = jws_sign($claims, ACTIVE_KID);
        audit_event($pdo, null, $fpHash, 'license.validated', "kind=seat state=$state");
        send_json(200, ['token' => $token, 'kind' => 'seat', 'state' => $state,
            'entitlement_id' => $entId, 'seat_id' => (int) $seat['seat_id'],
            'seats_total' => $seatsTotal, 'seats_used' => $seatsUsed, 'expires_at' => $expiresAt,
            'features' => $features]);
        return;
    }

    $sel = $pdo->prepare(
        'SELECT trial_start, trial_end, trial_search_seats FROM device_registrations
         WHERE product_id = ? AND fp_hash = ?'
    );
    $sel->execute([$productId, $fpHash]);
    $row = $sel->fetch();

    if (!$row || $row['trial_end'] === null) {
        // No seat and no trial — client must call trial/start first. Not a grant.
        send_json(200, ['state' => 'none']);
        return;
    }

    $pdo->prepare('UPDATE device_registrations SET last_seen = NOW()
                   WHERE product_id = ? AND fp_hash = ?')->execute([$productId, $fpHash]);

    $now           = new DateTimeImmutable('now');
    $end           = new DateTimeImmutable($row['trial_end']);
    $state         = ($now < $end) ? 'active' : 'expired';
    $daysRemaining = max(0, (int) ceil(($end->getTimestamp() - $now->getTimestamp()) / 86400));

    // Trial includes detached search-client capacity for its duration (see jws.php);
    // honors the per-trial override when set, else the policy default. Re-issued on
    // every online refresh so the desktop caps stay current.
    $searchSeats = $row['trial_search_seats'] !== null ? (int) $row['trial_search_seats'] : null;
    $features = trial_features($state, $searchSeats);
    $claims = trial_claims($productId, $fpHash, $state, $row['trial_start'], $row['trial_end'], $features);
    $token  = jws_sign($claims, ACTIVE_KID);

    audit_event($pdo, null, $fpHash, 'license.validated', "kind=trial state=$state");

    send_json(200, [
        'token'          => $token,
        'kind'           => 'trial',
        'state'          => $state,
        'trial_start'    => $row['trial_start'],
        'trial_end'      => $row['trial_end'],
        'days_remaining' => $daysRemaining,
        'features'       => $features,
    ]);
} catch (Throwable $e) {
    error_log('validate error: ' . $e->getMessage());
    send_json(500, ['error' => [
        'code'       => 'server_error',
        'message'    => 'validate failed',
        'request_id' => bin2hex(random_bytes(8)),
    ]]);
}
