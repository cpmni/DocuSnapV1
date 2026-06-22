<?php
// POST /v1/webhook — Phase 2b purchase-webhook foundation. A FUTURE commerce system
// posts a SIGNED, idempotent event to additively grow an account's per-feature seats.
// Server-authoritative: the HMAC signature is verified BEFORE any state change, only
// whitelisted feature seats are mutated (workflow <= search), a repeated event_id is a
// NO-OP, and an unknown account is safely quarantined. DORMANT until a webhook secret
// is configured. NO payment/checkout here — commerce is the CALLER; this only mutates
// entitlements (the same records admin/activate manage).

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/ratelimit.php';
require __DIR__ . '/../../lib/webhook.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    send_json(405, ['error' => ['code' => 'method_not_allowed', 'message' => 'POST only', 'request_id' => bin2hex(random_bytes(8))]]);
    return;
}

$secret = webhook_secret();
if ($secret === null) {
    // DORMANT: no secret configured -> accept nothing (safe to deploy before commerce
    // exists). Not the caller's fault, so it's a 503, not a 4xx.
    send_json(503, ['error' => ['code' => 'not_configured', 'message' => 'Webhook receiver is not configured', 'request_id' => bin2hex(random_bytes(8))]]);
    return;
}

try {
    $pdo = db();
    $ip  = client_ip();
    // Anti-abuse: the signature is the real gate; this just caps brute-forcing the HMAC.
    // Generous — a real commerce system sends few events.
    $gen = rate_hit($pdo, "webhook_ip:$ip", 120, 3600);
    if (!$gen['allowed']) { too_many_requests($gen['retry_after']); return; }
    if (rate_count($pdo, "webhook_fail_ip:$ip") > 30) { too_many_requests(900); return; }

    // Verify the signature over the EXACT raw bytes BEFORE trusting anything in the body.
    $raw = file_get_contents('php://input');
    if ($raw === false) $raw = '';
    $sig = $_SERVER['HTTP_X_SIGNATURE'] ?? null;
    if (!webhook_signature_ok($raw, $sig, $secret)) {
        rate_hit($pdo, "webhook_fail_ip:$ip", 30, 3600);
        send_json(401, ['error' => ['code' => 'invalid_signature', 'message' => 'Signature verification failed', 'request_id' => bin2hex(random_bytes(8))]]);
        return;
    }

    $data = json_decode($raw, true);
    if (!is_array($data)) { bad_request('Body must be a JSON object'); return; }
    $v = webhook_validate_payload($data);
    if (!$v['ok']) { bad_request($v['error']); return; }
    $ev = $v['event'];

    // Idempotency + mutation in ONE transaction. The event_id PRIMARY KEY is the guard:
    // a duplicate INSERT (replay) throws 23000, we roll back and return the PRIOR outcome.
    $pdo->beginTransaction();
    $inserted = false;
    try {
        $pdo->prepare('INSERT INTO webhook_events (event_id, event_type) VALUES (?, ?)')
            ->execute([$ev['event_id'], $ev['type']]);
        $inserted = true;
    } catch (PDOException $e) {
        $dup = $e->getCode() === '23000' || (isset($e->errorInfo[1]) && (int) $e->errorInfo[1] === 1062);
        if (!$dup) throw $e;   // a real DB error -> the outer catch
    }
    if (!$inserted) {
        $pdo->rollBack();
        $prior = $pdo->prepare('SELECT status FROM webhook_events WHERE event_id = ?');
        $prior->execute([$ev['event_id']]);
        $row = $prior->fetch() ?: ['status' => 'received'];
        send_json(200, ['status' => 'already_processed', 'event_status' => $row['status']]); // deterministic no-op
        return;
    }

    // Resolve the account (hash the key; never store/log the plaintext — like activate).
    $acc = $pdo->prepare('SELECT id, status FROM accounts WHERE account_key_hash = ?');
    $acc->execute([hash('sha256', $ev['account_key'])]);
    $account = $acc->fetch();

    if (!$account || $account['status'] !== 'active') {
        // Safely quarantine: record the event as rejected (NO state change) so a replay
        // is a no-op and an admin can see the bad mapping. Delivery was fine -> 422.
        $pdo->prepare('UPDATE webhook_events SET product_id = ?, status = "rejected", detail = ? WHERE event_id = ?')
            ->execute([$ev['product_id'], 'unknown_or_inactive_account', $ev['event_id']]);
        $pdo->commit();
        audit_event($pdo, null, null, 'webhook.rejected', "event={$ev['event_id']} type={$ev['type']} reason=unknown_account");
        send_json(422, ['status' => 'rejected', 'reason' => 'unknown_account']);
        return;
    }
    $accountId = (int) $account['id'];

    // Additive mutation: upsert the WHITELISTED per-feature seat counts (workflow <=
    // search already enforced in validation). Server-authoritative — the caller can only
    // set these counts on a KNOWN account, nothing else. Setting a feature to 0 retires it.
    $applied = [];
    foreach ($ev['features'] as $feature => $seats) {
        $sel = $pdo->prepare('SELECT id FROM entitlements WHERE account_id = ? AND product_id = ? AND feature = ? AND status = "active" ORDER BY id LIMIT 1');
        $sel->execute([$accountId, $ev['product_id'], $feature]);
        $row = $sel->fetch();
        if ($seats > 0) {
            if ($row) $pdo->prepare('UPDATE entitlements SET seats_total = ? WHERE id = ?')->execute([$seats, (int) $row['id']]);
            else      $pdo->prepare('INSERT INTO entitlements (account_id, product_id, feature, seats_total, status) VALUES (?, ?, ?, ?, "active")')
                          ->execute([$accountId, $ev['product_id'], $feature, $seats]);
        } elseif ($row) {
            $pdo->prepare('UPDATE entitlements SET status = "revoked" WHERE id = ?')->execute([(int) $row['id']]);
        }
        $applied[] = "$feature=$seats";
    }
    $detail = $applied ? implode(' ', $applied) : 'no_feature_change';
    $pdo->prepare('UPDATE webhook_events SET account_id = ?, product_id = ?, status = "applied", detail = ? WHERE event_id = ?')
        ->execute([$accountId, $ev['product_id'], $detail, $ev['event_id']]);
    $pdo->commit();

    audit_event($pdo, $accountId, null, 'webhook.applied', "event={$ev['event_id']} type={$ev['type']} $detail");
    send_json(200, ['status' => 'applied', 'event_id' => $ev['event_id']]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    error_log('webhook error: ' . $e->getMessage());
    send_json(500, ['error' => ['code' => 'server_error', 'message' => 'webhook failed', 'request_id' => bin2hex(random_bytes(8))]]);
}
