<?php
// GET /v1/status?product_id=&fp_hash= — read-only display snapshot (UNSIGNED,
// never used for gating). Returns the current trial state for the fingerprint,
// or state="none" if it has never started a trial. Seat fields are null in
// Phase 1 (seats arrive in Phase 3).

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/ratelimit.php';
require __DIR__ . '/../../lib/release.php';

$productId = isset($_GET['product_id']) ? trim((string) $_GET['product_id']) : '';
$fpHash    = isset($_GET['fp_hash']) ? strtolower(trim((string) $_GET['fp_hash'])) : '';
$channel   = isset($_GET['channel']) ? (string) $_GET['channel'] : 'msstore';

if ($productId === '' || !preg_match('/^[0-9a-f]{64}$/', $fpHash)) {
    bad_request('product_id and a 64-hex fp_hash are required');
    return;
}

try {
    $pdo = db();
    // Anti-automation (F-03): generous per-IP cap on the read-only status probe.
    $ipHit = rate_hit($pdo, 'status_ip:' . client_ip(), 240, 3600);
    if (!$ipHit['allowed']) { too_many_requests($ipHit['retry_after']); return; }
    $sel = $pdo->prepare(
        'SELECT trial_start, trial_end FROM device_registrations
         WHERE product_id = ? AND fp_hash = ?'
    );
    $sel->execute([$productId, $fpHash]);
    $row = $sel->fetch();

    // Advisory update block (exception-proof; null when unset). Shown alongside the trial
    // snapshot so the Settings "License Status" view can also surface an available update.
    $update = release_info($pdo, $channel);

    if (!$row || $row['trial_end'] === null) {
        send_json(200, [
            'state'          => 'none',
            'days_remaining' => 0,
            'seats_total'    => null,
            'seats_used'     => null,
            'update'         => $update,
        ]);
        return;
    }

    $now           = new DateTimeImmutable('now');
    $end           = new DateTimeImmutable($row['trial_end']);
    $state         = ($now < $end) ? 'active' : 'expired';
    $daysRemaining = max(0, (int) ceil(($end->getTimestamp() - $now->getTimestamp()) / 86400));

    send_json(200, [
        'state'          => $state,
        'trial_start'    => $row['trial_start'],
        'trial_end'      => $row['trial_end'],
        'days_remaining' => $daysRemaining,
        'seats_total'    => null,
        'seats_used'     => null,
        'update'         => $update,
    ]);
} catch (Throwable $e) {
    error_log('status error: ' . $e->getMessage());
    send_json(500, ['error' => [
        'code'       => 'server_error',
        'message'    => 'status failed',
        'request_id' => bin2hex(random_bytes(8)),
    ]]);
}
