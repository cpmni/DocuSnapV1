<?php
// licensing-backend/lib/entitlements.php — SHARED entitlement-mutation helpers (DB).
// Used by BOTH the generic purchase webhook (public/v1/webhook.php) and the Polar
// adapter (public/v1/polar_webhook.php), so the seat/feature logic lives in one place.
// Pure HTTP-free; callers pass the PDO. No secrets are logged here. Account keys are
// generated and IMMEDIATELY hashed — the plaintext is returned ONCE to the caller (to
// deliver) and never stored.

// Issue a fresh account key. Format is cosmetic (the value is hashed at rest); a clear
// "SF-" prefix + grouped hex makes it copy/paste friendly and recognisable in support.
function generate_account_key(): string
{
    $hex = strtoupper(bin2hex(random_bytes(10)));   // 20 hex chars
    return 'SF-' . implode('-', str_split($hex, 4)); // SF-XXXX-XXXX-XXXX-XXXX-XXXX
}

// Additive per-feature seat upsert — the EXACT loop the generic webhook used, factored
// out verbatim. With no $extra it is byte-identical to the old inline behaviour. The
// Polar adapter passes $extra to ALSO stamp polar_ref / polar_price_id / expires_at on
// the same row (so renewals extend it and cancels can target it). Setting a feature to
// 0 retires it. Returns a human-readable applied summary.
function webhook_apply_features(PDO $pdo, int $accountId, string $productId, array $features, array $extra = []): string
{
    $hasExtra = $extra !== [];
    $polarRef = $extra['polar_ref'] ?? null;
    $priceId  = $extra['polar_price_id'] ?? null;
    $setExp   = array_key_exists('expires_at', $extra);   // distinguish "set NULL" from "leave as-is"
    $expires  = $extra['expires_at'] ?? null;

    // A Polar grant tied to a subscription/order keys its row by polar_ref, so each
    // SUBSCRIPTION gets its OWN row per feature — multiple client purchases STACK (validate
    // SUMs them) and a renewal updates only its own row. The admin path (no polar_ref) keeps
    // a single row per (account, product, feature).
    $byRef = $hasExtra && $polarRef !== null && $polarRef !== '';
    $applied = [];
    foreach ($features as $feature => $seats) {
        $seats = (int) $seats;
        if ($byRef) {
            $sel = $pdo->prepare('SELECT id FROM entitlements WHERE account_id = ? AND product_id = ? AND feature = ? AND polar_ref = ? AND status = "active" ORDER BY id LIMIT 1');
            $sel->execute([$accountId, $productId, $feature, $polarRef]);
        } else {
            $sel = $pdo->prepare('SELECT id FROM entitlements WHERE account_id = ? AND product_id = ? AND feature = ? AND status = "active" ORDER BY id LIMIT 1');
            $sel->execute([$accountId, $productId, $feature]);
        }
        $row = $sel->fetch();
        if ($seats > 0) {
            if ($row) {
                $id = (int) $row['id'];
                $pdo->prepare('UPDATE entitlements SET seats_total = ? WHERE id = ?')->execute([$seats, $id]);
                if ($hasExtra) {
                    if ($setExp) $pdo->prepare('UPDATE entitlements SET polar_ref = ?, polar_price_id = ?, expires_at = ? WHERE id = ?')->execute([$polarRef, $priceId, $expires, $id]);
                    else         $pdo->prepare('UPDATE entitlements SET polar_ref = ?, polar_price_id = ? WHERE id = ?')->execute([$polarRef, $priceId, $id]);
                }
            } elseif ($hasExtra) {
                $pdo->prepare('INSERT INTO entitlements (account_id, product_id, feature, seats_total, status, polar_ref, polar_price_id, expires_at) VALUES (?, ?, ?, ?, "active", ?, ?, ?)')
                    ->execute([$accountId, $productId, $feature, $seats, $polarRef, $priceId, $setExp ? $expires : null]);
            } else {
                $pdo->prepare('INSERT INTO entitlements (account_id, product_id, feature, seats_total, status) VALUES (?, ?, ?, ?, "active")')
                    ->execute([$accountId, $productId, $feature, $seats]);
            }
        } elseif ($row) {
            $pdo->prepare('UPDATE entitlements SET status = "revoked" WHERE id = ?')->execute([(int) $row['id']]);
        }
        $applied[] = "$feature=$seats";
    }
    return $applied ? implode(' ', $applied) : 'no_feature_change';
}

// Find the account linked to a Polar customer, or create one (minting + hashing a fresh
// key). Returns [accountId, $plaintextKeyOrNull] — the key is non-null ONLY for a
// newly-created account (so the caller delivers it exactly once). Concurrency-safe: a
// racing duplicate insert (uq_polar_customer) is caught and resolved by re-select.
function find_or_create_polar_account(PDO $pdo, string $polarCustomerId, ?string $email = null, ?string $name = null): array
{
    $email = ($email !== null && trim($email) !== '') ? trim($email) : null;
    $name  = ($name  !== null && trim($name)  !== '') ? trim($name)  : null;
    $sel = $pdo->prepare('SELECT id FROM accounts WHERE polar_customer_id = ?');
    $sel->execute([$polarCustomerId]);
    if ($row = $sel->fetch()) {
        _polar_refresh_contact($pdo, (int) $row['id'], $email, $name);   // keep contact current; never re-issue
        return [(int) $row['id'], null];
    }

    $key = generate_account_key();
    try {
        $pdo->prepare('INSERT INTO accounts (account_key_hash, status, polar_customer_id, email, name) VALUES (?, "active", ?, ?, ?)')
            ->execute([hash('sha256', $key), $polarCustomerId, $email, $name]);
        return [(int) $pdo->lastInsertId(), $key];
    } catch (PDOException $e) {
        $dup = $e->getCode() === '23000' || (isset($e->errorInfo[1]) && (int) $e->errorInfo[1] === 1062);
        if (!$dup) throw $e;
        $sel->execute([$polarCustomerId]);                 // lost the race — use the winner
        $row = $sel->fetch();
        if ($row) _polar_refresh_contact($pdo, (int) $row['id'], $email, $name);
        return [$row ? (int) $row['id'] : 0, null];
    }
}

// Update only the contact fields that have a fresh non-empty value (never clobber a stored
// value with null). Keeps email/name current across renewals without re-issuing the key.
function _polar_refresh_contact(PDO $pdo, int $accountId, ?string $email, ?string $name): void
{
    $sets = []; $args = [];
    if ($email !== null) { $sets[] = 'email = ?'; $args[] = $email; }
    if ($name  !== null) { $sets[] = 'name = ?';  $args[] = $name; }
    if (!$sets) return;
    $args[] = $accountId;
    $pdo->prepare('UPDATE accounts SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($args);
}

// The stored contact email for an account, or null. Used by admin Reissue to email the key.
function account_email(PDO $pdo, int $accountId): ?string
{
    $st = $pdo->prepare('SELECT email FROM accounts WHERE id = ?');
    $st->execute([$accountId]);
    $e = $st->fetchColumn();
    return ($e !== false && $e !== null && trim((string) $e) !== '') ? trim((string) $e) : null;
}

// Grant/extend the entitlements for a mapped SKU. expires_at = the subscription period
// end (sub) or NULL (perpetual one-time). $qty = seats bought on the subscription; each
// mapped feature is multiplied by it, so a per-seat SKU (e.g. one £12 client = search:1)
// scales (quantity 5 -> search:5). Defaults to 1, so single-unit SKUs are unchanged.
// Returns the applied summary.
function grant_polar_entitlements(PDO $pdo, int $accountId, array $sku, ?string $grantRef, string $priceId, ?string $expiresAt, int $qty = 1): string
{
    $qty = max(1, $qty);
    $features = [];
    foreach (($sku['features'] ?? []) as $f => $n) { $features[$f] = (int) $n * $qty; }
    return webhook_apply_features($pdo, $accountId, (string) $sku['product_id'], $features, [
        'polar_ref'      => $grantRef,
        'polar_price_id' => $priceId,
        'expires_at'     => $expiresAt,    // present key => set (NULL for perpetual)
    ]);
}

// Revoke every active entitlement tied to a Polar object (subscription id, or order id
// for a one-time refund). Returns the number of rows revoked. The client locks on its
// next online /v1/validate within grace — no extra wiring.
function revoke_polar(PDO $pdo, string $grantRef): int
{
    if ($grantRef === '') return 0;
    // Match the subscription/order ref EXACTLY and any per-line-item refs (grantRef:priceId)
    // used for multi-item baskets, so cancelling a subscription revokes all of its lines.
    $st = $pdo->prepare('UPDATE entitlements SET status = "revoked" WHERE status = "active" AND (polar_ref = ? OR polar_ref LIKE ?)');
    $st->execute([$grantRef, $grantRef . ':%']);
    return $st->rowCount();
}

// Normalise a Polar period end (epoch seconds or ISO-8601) to a MySQL DATETIME, or null.
function polar_normalize_period_end($val): ?string
{
    if ($val === null || $val === '') return null;
    $epoch = is_numeric($val) ? (int) $val : strtotime((string) $val);
    if ($epoch === false || $epoch <= 0) return null;
    return date('Y-m-d H:i:s', $epoch);
}

// Best-effort key delivery by email. Returns false (caller audits + an admin reissues)
// when there's no usable address or the MTA isn't configured (e.g. dev WAMP). The body
// carries ONLY the key + non-secret meta. Configure the From via LICENSING_MAIL_FROM.
function deliver_account_key(?string $email, string $key, string $meta): bool
{
    if ($email === null || $email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) return false;
    $from     = getenv('LICENSING_MAIL_FROM') ?: 'no-reply@scanfinder.app';
    $fromName = getenv('LICENSING_MAIL_FROM_NAME') ?: 'Scan Finder';
    $subject  = 'Your Scan Finder licence key';
    $body     = "Thank you for your purchase.\r\n\r\nYour licence key:\r\n\r\n    $key\r\n\r\n"
              . "Open Scan Finder, choose Activate, and enter this key. Keep it somewhere safe.\r\n\r\n($meta)\r\n";
    // From + Reply-To carry the configured address; the -f envelope sender (5th mail() arg)
    // sets the Return-Path so the host sends "as" this address and SPF aligns. NOTE: the
    // address MUST be a real mailbox/alias on the hosted domain — otherwise IONOS rewrites
    // the visible sender to its default account address.
    $headers  = 'From: ' . $fromName . ' <' . $from . '>' . "\r\n"
              . 'Reply-To: ' . $from . "\r\n"
              . 'MIME-Version: 1.0' . "\r\n"
              . 'Content-Type: text/plain; charset=utf-8';
    return @mail($email, $subject, $body, $headers, '-f' . $from);
}

// Admin "reissue key": mint a NEW key, replace the stored hash, return the plaintext for
// one-time display. Used when email delivery failed (we never keep the plaintext, so the
// only safe "resend" is a rotate). The old undelivered key stops working immediately.
function reissue_account_key(PDO $pdo, int $accountId): string
{
    $key = generate_account_key();
    $pdo->prepare('UPDATE accounts SET account_key_hash = ? WHERE id = ?')->execute([hash('sha256', $key), $accountId]);
    return $key;
}
