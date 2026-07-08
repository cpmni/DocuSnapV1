<?php
// POST /v1/polar/webhook (also reachable as /v1/polar_webhook.php) — Polar.sh adapter.
// Polar (Merchant of Record) handles payment + tax; THIS turns a paid order/subscription
// into YOUR account + entitlement, then the existing offline /v1/activate path issues the
// device-bound token (unchanged). Standard-Webhooks signature is verified BEFORE any
// state change; the webhook-id header is the idempotency key (a replay is a no-op);
// commerce is the CALLER — no payment/checkout here. DORMANT until keys/polar_webhook_secret.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/ratelimit.php';
require __DIR__ . '/../../lib/polar.php';
require __DIR__ . '/../../lib/entitlements.php';

function _polar_headers(): array
{
    if (function_exists('getallheaders')) { $h = getallheaders(); if (is_array($h)) return $h; }
    $out = [];
    foreach ($_SERVER as $k => $v) {
        if (strncmp($k, 'HTTP_', 5) === 0) $out[strtolower(str_replace('_', '-', substr($k, 5)))] = $v;
    }
    return $out;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    send_json(405, ['error' => ['code' => 'method_not_allowed', 'message' => 'POST only', 'request_id' => bin2hex(random_bytes(8))]]);
    return;
}

$secret = polar_secret();
if ($secret === null) {   // safe to deploy before Polar is wired
    send_json(503, ['error' => ['code' => 'not_configured', 'message' => 'Polar receiver is not configured', 'request_id' => bin2hex(random_bytes(8))]]);
    return;
}

try {
    $pdo = db();

    // NO rate-limiting here. The HMAC signature IS the gate — a valid signature means the
    // request genuinely came from Polar. Polar legitimately sends BURSTS (backlog
    // redelivery, many subscription events at once) and RETRIES any non-2xx, so throttling
    // its deliveries just yields 429s -> more retries -> Polar AUTO-DISABLES the endpoint
    // (the bug this replaces). Forged/unsigned requests are cheaply rejected by the
    // signature check below before any DB work, so a limiter adds no real protection.
    $raw     = file_get_contents('php://input'); if ($raw === false) $raw = '';
    $headers = _polar_headers();
    if (!polar_signature_ok($raw, $headers, $secret)) {
        send_json(401, ['error' => ['code' => 'invalid_signature', 'message' => 'Signature verification failed', 'request_id' => bin2hex(random_bytes(8))]]);
        return;
    }
    // webhook-id is the Standard-Webhooks delivery id → our idempotency key.
    $hl        = []; foreach ($headers as $k => $v) $hl[strtolower((string) $k)] = is_array($v) ? (string) reset($v) : (string) $v;
    $webhookId = trim((string) ($hl['webhook-id'] ?? ''));
    if ($webhookId === '') { bad_request('missing webhook-id'); return; }

    $data = json_decode($raw, true);
    if (!is_array($data)) { bad_request('Body must be a JSON object'); return; }
    $type = isset($data['type']) ? substr(trim((string) $data['type']), 0, 60) : 'unknown';

    // Idempotency + mutation in ONE transaction (mirrors /v1/webhook). The event_id PK is
    // the guard: a duplicate INSERT (replay) rolls back and returns the recorded outcome.
    $pdo->beginTransaction();
    $inserted = false;
    try {
        $pdo->prepare('INSERT INTO webhook_events (event_id, event_type) VALUES (?, ?)')->execute([$webhookId, $type]);
        $inserted = true;
    } catch (PDOException $e) {
        $dup = $e->getCode() === '23000' || (isset($e->errorInfo[1]) && (int) $e->errorInfo[1] === 1062);
        if (!$dup) throw $e;
    }
    if (!$inserted) {
        $pdo->rollBack();
        $prior = $pdo->prepare('SELECT status FROM webhook_events WHERE event_id = ?');
        $prior->execute([$webhookId]);
        $row = $prior->fetch() ?: ['status' => 'received'];
        send_json(200, ['status' => 'already_processed', 'event_status' => $row['status']]);
        return;
    }

    $pv = polar_parse_event($data);
    if (!$pv['ok']) {
        $pdo->prepare('UPDATE webhook_events SET status = "rejected", detail = ? WHERE event_id = ?')
            ->execute([substr('parse_error: ' . $pv['error'], 0, 250), $webhookId]);
        $pdo->commit();
        audit_event($pdo, null, null, 'polar.rejected', "event=$webhookId type=$type reason=parse_error");
        // ACK with 2xx: this is a PERMANENT condition (retrying the same payload won't help),
        // so returning a 4xx would only rack up delivery failures and get the endpoint
        // auto-disabled. It's recorded as "rejected" for the admin to see + redeliver.
        send_json(200, ['status' => 'rejected', 'reason' => 'unprocessable_event']);
        return;
    }
    $ev     = $pv['event'];
    $action = $ev['action'];

    // ── IGNORE: a delivered-but-uninteresting event (checkout.*, past_due, …). Record so
    //    a replay is a no-op; 200 so Polar stops retrying.
    if ($action === 'ignore') {
        $pdo->prepare('UPDATE webhook_events SET status = "applied", detail = "ignored" WHERE event_id = ?')->execute([$webhookId]);
        $pdo->commit();
        send_json(200, ['status' => 'ignored', 'type' => $ev['type']]);
        return;
    }

    // ── REVOKE: cancel / refund — end every entitlement tied to the Polar object. The
    //    client locks on its next online /v1/validate within grace.
    if ($action === 'revoke') {
        $n = revoke_polar($pdo, (string) ($ev['grant_ref'] ?? ''));
        $pdo->prepare('UPDATE webhook_events SET status = "applied", detail = ? WHERE event_id = ?')->execute(["revoked=$n", $webhookId]);
        $pdo->commit();
        audit_event($pdo, null, null, 'polar.revoked', "event=$webhookId type={$ev['type']} ref={$ev['grant_ref']} rows=$n");
        send_json(200, ['status' => 'revoked', 'rows' => $n]);
        return;
    }

    // ── GRANT: order.paid / subscription.active|created|updated — map EVERY line item (a
    //    basket grants all of them), find/create the account, grant/extend each.
    $map    = polar_load_map();
    $grants = [];
    foreach ($ev['items'] as $it) {
        $sku = polar_map_sku($map, (string) $it['price_id'], (string) $it['product_id']);
        if ($sku && $sku['product_id'] !== '') {
            $grants[] = ['sku' => $sku, 'price_id' => (string) $it['price_id'], 'qty' => (int) ($it['quantity'] ?? 1)];
        }
    }
    if (!$grants) {
        $pdo->prepare('UPDATE webhook_events SET status = "rejected", detail = ? WHERE event_id = ?')
            ->execute([substr('unmapped_sku price=' . $ev['price_id'] . ' product=' . $ev['product_id'], 0, 250), $webhookId]);
        $pdo->commit();
        audit_event($pdo, null, null, 'polar.rejected', "event=$webhookId reason=unmapped_sku price={$ev['price_id']}");
        // ACK with 2xx (recorded as rejected): an unmapped SKU is a config gap, not a
        // transient error — retrying won't fix it, and a 4xx would get the endpoint
        // auto-disabled. Fix polar_map.json, then REDELIVER this event from Polar.
        send_json(200, ['status' => 'rejected', 'reason' => 'unmapped_sku']);
        return;
    }

    [$accountId, $newKey] = find_or_create_polar_account($pdo, (string) $ev['customer_id'], $ev['email'] ?? null, $ev['name'] ?? null);
    if ($accountId === 0) { throw new RuntimeException('account resolve failed'); }

    // Grant each mapped line item. For a MULTI-item order, suffix the link ref with the price
    // id so each line gets its OWN entitlement row (and two lines of the same feature don't
    // overwrite); a single-item order keeps the bare grant_ref unchanged. revoke_polar matches
    // both the bare ref and the suffixed refs, so a cancellation still clears all lines.
    $multi     = count($grants) > 1;
    $details   = [];
    $expiresAt = null;
    foreach ($grants as $g) {
        $exp       = $g['sku']['term'] === 'perpetual' ? null : polar_normalize_period_end($ev['period_end']);
        $expiresAt = $exp;
        $ref       = $multi ? ($ev['grant_ref'] . ':' . $g['price_id']) : $ev['grant_ref'];
        $details[] = grant_polar_entitlements($pdo, $accountId, $g['sku'], $ref, $g['price_id'], $exp, $g['qty']);
    }
    $detail = implode(' | ', $details);

    $pdo->prepare('UPDATE webhook_events SET account_id = ?, product_id = ?, status = "applied", detail = ? WHERE event_id = ?')
        ->execute([$accountId, $grants[0]['sku']['product_id'], substr($detail, 0, 250), $webhookId]);
    $pdo->commit();   // grant is durable BEFORE we attempt delivery (mail must not hold/rollback it)

    // Deliver the key to a NEW account only, best-effort and AFTER commit (we never store
    // the plaintext, so a failure → admin "reissue key", never a lost grant).
    $delivered = null;
    if ($newKey !== null) {
        try { $delivered = deliver_account_key($ev['email'], $newKey, "account #$accountId"); }
        catch (Throwable $e) { $delivered = false; error_log('polar key email error: ' . $e->getMessage()); }
        audit_event($pdo, $accountId, null, $delivered ? 'polar.key_emailed' : 'polar.key_email_failed', "event=$webhookId email_set=" . ($ev['email'] ? '1' : '0'));
    }
    audit_event($pdo, $accountId, null, 'polar.granted', "event=$webhookId type={$ev['type']} $detail expires=" . ($expiresAt ?? 'never'));
    send_json(200, ['status' => 'applied', 'account_id' => $accountId, 'new_account' => $newKey !== null, 'key_emailed' => $delivered]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    error_log('polar webhook error: ' . $e->getMessage());
    send_json(500, ['error' => ['code' => 'server_error', 'message' => 'polar webhook failed', 'request_id' => bin2hex(random_bytes(8))]]);
}
