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
require __DIR__ . '/../../lib/ratelimit.php';

const TRIAL_DAYS = 14;
const ACTIVE_KID = 'k1';

$body      = read_json_body();
$productId = isset($body['product_id']) ? trim((string) $body['product_id']) : '';
$fpHash    = isset($body['fp_hash']) ? strtolower(trim((string) $body['fp_hash'])) : '';

// Trial customer identity (captured in the desktop license window before the
// trial is activated). Plain contact details only — never secrets/tokens.
$custName    = isset($body['customer_name']) ? trim((string) $body['customer_name']) : '';
$contactName = isset($body['contact_name'])  ? trim((string) $body['contact_name'])  : '';
$email       = isset($body['email'])         ? trim((string) $body['email'])         : '';

if ($productId === '' || !preg_match('/^[0-9a-f]{64}$/', $fpHash)) {
    bad_request('product_id and a 64-hex fp_hash are required');
    return;
}

// Server-authoritative capture validation (the client validates too, but the
// backend is the source of truth and must not silently store junk).
if ($custName === '') {
    bad_request('customer_name is required to start a trial');
    return;
}
if (mb_strlen($custName) > 190 || mb_strlen($contactName) > 190 || mb_strlen($email) > 190) {
    bad_request('customer_name, contact_name and email must each be 190 characters or fewer');
    return;
}
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    bad_request('email is not a valid address (or omit it)');
    return;
}
// Normalise empties to NULL for storage.
$contactNameVal = $contactName !== '' ? $contactName : null;
$emailVal       = $email !== '' ? $email : null;

try {
    $pdo = db();
    // Anti-automation (F-03): throttle trial/start per source IP. Covers both new
    // mint and resume; a normal user is far under this rate.
    $ip = client_ip();
    $ipHit = rate_hit($pdo, "trial_ip:$ip", 10, 3600);
    if (!$ipHit['allowed']) { too_many_requests($ipHit['retry_after']); return; }
    // Ensure the product row exists (FK target). Brand-neutral default name.
    $pdo->prepare('INSERT IGNORE INTO products (product_id, name_internal) VALUES (?, ?)')
        ->execute([$productId, 'product']);

    $sel = $pdo->prepare(
        'SELECT trial_start, trial_end, customer_name, contact_name, email, trial_search_seats
         FROM device_registrations WHERE product_id = ? AND fp_hash = ?'
    );
    $sel->execute([$productId, $fpHash]);
    $row = $sel->fetch();

    // Per-trial search-seat override (NULL = policy default). A brand-new trial has none.
    $searchSeats = ($row && $row['trial_search_seats'] !== null) ? (int) $row['trial_search_seats'] : null;

    if ($row && $row['trial_start'] !== null) {
        // RESUME — never move the window. Backfill the customer identity only
        // where it is still blank (e.g. a pre-capture / anonymous trial), so a
        // stored identity is preserved and admin keeps showing it.
        $pdo->prepare(
            'UPDATE device_registrations
                SET last_seen     = NOW(),
                    customer_name = COALESCE(customer_name, ?),
                    contact_name  = COALESCE(contact_name, ?),
                    email         = COALESCE(email, ?)
             WHERE product_id = ? AND fp_hash = ?'
        )->execute([$custName, $contactNameVal, $emailVal, $productId, $fpHash]);
        $trialStart = $row['trial_start'];
        $trialEnd   = $row['trial_end'];
        $resumed    = true;
    } else {
        // Global new-trial guardrail (F-03): cap brand-new trials minted per day.
        // A returning fingerprint RESUMES above and never reaches here, so legitimate
        // devices are unaffected; only fresh fp_hashes (the farming vector) count.
        $newCap = rate_hit($pdo, 'trial_new:' . gmdate('Y-m-d'), 500, 86400);
        if (!$newCap['allowed']) { too_many_requests($newCap['retry_after']); return; }
        // CREATE — first time this fingerprint is seen for this product. Store the
        // captured identity. ON DUPLICATE handles a row that exists without a
        // trial window yet (e.g. a bare device record): it opens the window now
        // and fills the identity.
        $pdo->prepare(
            'INSERT INTO device_registrations
                (fp_hash, product_id, first_seen, last_seen, trial_start, trial_end,
                 customer_name, contact_name, email)
             VALUES (?, ?, NOW(), NOW(), NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                last_seen     = NOW(),
                trial_start   = COALESCE(trial_start, NOW()),
                trial_end     = COALESCE(trial_end, DATE_ADD(NOW(), INTERVAL ' . TRIAL_DAYS . ' DAY)),
                customer_name = COALESCE(customer_name, VALUES(customer_name)),
                contact_name  = COALESCE(contact_name, VALUES(contact_name)),
                email         = COALESCE(email, VALUES(email))'
        )->execute([$fpHash, $productId, TRIAL_DAYS, $custName, $contactNameVal, $emailVal]);

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

    // Trial includes detached search-client capacity for its duration (see jws.php);
    // honors the per-trial override when set, else the policy default.
    $features = trial_features($state, $searchSeats);
    $claims = trial_claims($productId, $fpHash, $state, $trialStart, $trialEnd, $features);
    $token  = jws_sign($claims, ACTIVE_KID);

    audit_event($pdo, null, $fpHash, 'license.trial_started',
        'resumed=' . ($resumed ? '1' : '0') . " state=$state customer_set=1 email_set=" . ($emailVal !== null ? '1' : '0'));

    // Email the owner on a GENUINELY NEW trial only — a resume happens on every
    // re-check / reinstall, so notifying those would spam. Best-effort (notify_owner
    // never throws); it must not block or fail the trial response.
    if (!$resumed) {
        require_once __DIR__ . '/../../lib/notify.php';
        $body = implode("\n", [
            'A new 14-day Scan Finder trial has just been activated.',
            '',
            'Business:    ' . $custName,
            'Contact:     ' . ($contactNameVal ?? '-'),
            'Email:       ' . ($emailVal ?? '-'),
            'Product:     ' . $productId,
            'Device fp:   ' . $fpHash,
            'Trial start: ' . $trialStart,
            'Trial end:   ' . $trialEnd,
            'Client IP:   ' . $ip,
            '',
            'Automated notification from the Scan Finder licensing backend.',
        ]);
        notify_owner('New trial activated - ' . $custName, $body);
    }

    send_json(200, [
        'token'          => $token,
        'kind'           => 'trial',
        'state'          => $state,
        'trial_start'    => $trialStart,
        'trial_end'      => $trialEnd,
        'days_remaining' => $daysRemaining,
        'resumed'        => $resumed,
        'features'       => $features,
    ]);
} catch (Throwable $e) {
    error_log('trial_start error: ' . $e->getMessage());
    send_json(500, ['error' => [
        'code'       => 'server_error',
        'message'    => 'trial/start failed',
        'request_id' => bin2hex(random_bytes(8)),
    ]]);
}
