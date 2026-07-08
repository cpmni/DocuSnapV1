<?php
// licensing-backend/lib/polar.php — Polar.sh webhook ADAPTER: PURE, testable helpers
// (secret loading, Standard-Webhooks signature verification, event normalisation, SKU
// mapping). No DB and no HTTP here — the endpoint (public/v1/polar/webhook.php) wires
// these to the request + the entitlement mutation in lib/webhook.php.
//
// WHY a separate file from lib/webhook.php: that one is YOUR own signed-HMAC contract
// (a commerce system you control posts {account_key, features}). Polar is a THIRD party
// that signs with the Standard Webhooks scheme and posts ITS OWN payload that does NOT
// contain your account_key — a purchase CREATES the account. So Polar needs its own
// signature check + its own normaliser; the entitlement mutation is then SHARED.
//
// DORMANT until keys/polar_webhook_secret exists, so it is safe to deploy before Polar
// is wired (the endpoint returns 503 not_configured).
//
// ⚠ CONFIRM AGAINST A REAL POLAR PAYLOAD: the event-type names and the field PATHS in
// polar_parse_event() are taken from Polar's documented shape, but Polar versions its
// payloads. Capture one real delivery (Polar dashboard → Webhooks → a test event) and
// adjust EVENT_ACTIONS + the _dig() paths if anything differs. Everything is centralised
// here so that's a one-file change.

// ── Secret ───────────────────────────────────────────────────────────────────
// Polar's webhook signing secret (the "whsec_…" shown when you create the endpoint).
// Loaded env-first, else a file OUTSIDE the docroot — same convention as the admin
// password and the signing seed. Returns null when unconfigured (endpoint stays DORMANT).
function polar_secret(): ?string
{
    $env = getenv('POLAR_WEBHOOK_SECRET');
    if (is_string($env) && $env !== '') return $env;
    $file = __DIR__ . '/../keys/polar_webhook_secret'; // sibling of the signing seed, never web-served
    if (is_file($file)) {
        $s = trim((string) file_get_contents($file));
        if ($s !== '') return $s;
    }
    return null;
}

// Decode the Polar secret to the raw HMAC key bytes. Standard Webhooks secrets are
// "whsec_<base64>"; the key is the base64-decoded part. We tolerate a missing prefix and
// a non-base64 secret (use the raw bytes) so a copy/paste variant still verifies.
function _polar_key_bytes(string $secret): string
{
    $s = $secret;
    if (strncmp($s, 'whsec_', 6) === 0) $s = substr($s, 6);
    $decoded = base64_decode($s, true);
    return ($decoded !== false && $decoded !== '') ? $decoded : $secret;
}

// ── Signature (Standard Webhooks / svix scheme that Polar uses) ───────────────
// Headers (lower-cased keys expected): webhook-id, webhook-timestamp, webhook-signature.
// signedContent = "{id}.{timestamp}.{rawBody}"; expected = base64(HMAC-SHA256(key, content)).
// The webhook-signature header is a SPACE-delimited list of "v1,<base64sig>" tokens
// (multiple while a secret is rotating); accept if ANY v1 token matches (constant-time).
// Also enforces a +/- $skew second timestamp window to block replays.
function polar_signature_ok(string $rawBody, array $headers, ?string $secret, int $skew = 300, ?int $now = null): bool
{
    if ($secret === null || $secret === '') return false;
    $h = [];
    foreach ($headers as $k => $v) $h[strtolower((string) $k)] = is_array($v) ? (string) reset($v) : (string) $v;

    $id  = $h['webhook-id']        ?? '';
    $ts  = $h['webhook-timestamp'] ?? '';
    $sig = $h['webhook-signature'] ?? '';
    if ($id === '' || $ts === '' || $sig === '') return false;
    if (!ctype_digit((string) $ts)) return false;
    $now = $now ?? time();
    if (abs($now - (int) $ts) > $skew) return false;            // replay window

    $key      = _polar_key_bytes($secret);
    $signed   = $id . '.' . $ts . '.' . $rawBody;
    $expected = base64_encode(hash_hmac('sha256', $signed, $key, true));

    foreach (explode(' ', trim($sig)) as $token) {
        if ($token === '') continue;
        $parts = explode(',', $token, 2);                       // "v1,<sig>"
        $val   = count($parts) === 2 ? $parts[1] : $parts[0];   // tolerate a bare sig
        if (hash_equals($expected, $val)) return true;          // constant-time
    }
    return false;
}

// ── Event-type → internal ACTION ──────────────────────────────────────────────
// Centralised so renaming/adding a Polar event is one edit. grant = create/extend an
// entitlement; revoke = end it; anything not listed is ignore (a safe no-op 200, so
// Polar stops retrying). NOTE one-time orders carry term via the SKU map, not here.
const POLAR_EVENT_ACTIONS = [
    'order.paid'             => 'grant',
    'order.created'          => 'ignore',   // wait for paid (avoid granting an unpaid order)
    'order.refunded'         => 'revoke',
    'subscription.created'   => 'grant',
    'subscription.active'    => 'grant',
    'subscription.updated'   => 'grant',    // renewal → extend period (handled by parse → period_end)
    'subscription.canceled'  => 'revoke',
    'subscription.revoked'   => 'revoke',
    'subscription.past_due'  => 'ignore',   // keep working until canceled/revoked (grace)
];
function polar_event_action(string $type): string
{
    return POLAR_EVENT_ACTIONS[$type] ?? 'ignore';
}

// Dig a value out of a nested array by trying several dot-paths (Polar nests differ by
// event type/version). Returns the first non-empty hit, else null.
function _polar_dig(array $data, array $paths)
{
    foreach ($paths as $path) {
        $cur = $data;
        $ok  = true;
        foreach (explode('.', $path) as $seg) {
            if (is_array($cur) && array_key_exists($seg, $cur)) { $cur = $cur[$seg]; }
            else { $ok = false; break; }
        }
        if ($ok && $cur !== null && $cur !== '') return $cur;
    }
    return null;
}

// ── Normalise a decoded Polar event into the fields the endpoint needs ─────────
// Returns ['ok'=>true,'event'=>[...]] or ['ok'=>false,'error'=>'...']. The idempotency
// key is the webhook-id HEADER (Standard Webhooks), NOT a body field — the endpoint
// passes it separately. period_end is the subscription's current-period end (ISO or
// epoch) used to set entitlements.expires_at; null for a perpetual one-time order.
function polar_parse_event(array $data): array
{
    $type = isset($data['type']) ? trim((string) $data['type']) : '';
    if ($type === '') return ['ok' => false, 'error' => 'missing event type'];
    $action = polar_event_action($type);

    $obj = is_array($data['data'] ?? null) ? $data['data'] : [];

    $isSub      = strpos($type, 'subscription.') === 0;
    $customerId = _polar_dig($obj, ['customer_id', 'customer.id', 'user_id', 'user.id', 'subscription.customer_id']);
    $email      = _polar_dig($obj, ['customer.email', 'user.email', 'customer_email', 'email']);
    $name       = _polar_dig($obj, ['customer.name', 'billing_name', 'customer.billing_name', 'user.public_name', 'name']);
    $priceId    = _polar_dig($obj, ['product_price_id', 'price.id', 'price_id', 'subscription.price_id', 'items.0.price_id']);
    $productId  = _polar_dig($obj, ['product_id', 'product.id', 'subscription.product_id', 'items.0.product_id']);
    // For a subscription event `data.id` IS the subscription; for an order event it's the
    // ORDER id, so only fall back to bare `id` on subscription events (else read an
    // explicit subscription_id, e.g. on a renewal order).
    $subPaths   = $isSub ? ['id', 'subscription_id', 'subscription.id'] : ['subscription_id', 'subscription.id'];
    $subId      = _polar_dig($obj, $subPaths);
    $orderId    = (strpos($type, 'order.') === 0) ? _polar_dig($obj, ['id']) : null;
    $periodEnd  = _polar_dig($obj, ['current_period_end', 'ends_at', 'subscription.current_period_end', 'cancel_at']);
    $term       = ($isSub || $subId) ? 'sub' : 'one_time';
    // grant_ref = the Polar object this entitlement is tied to (subscription id for subs,
    // order id for a one-time order). It's stored on the entitlement so a later renewal
    // extends the SAME row and a cancel/refund revokes the right one.
    $grantRef   = $subId ?? ($orderId !== null ? (string) $orderId : null);
    // Seat count on this subscription/order (per-seat SKUs). Defaults to 1 when Polar
    // doesn't send a quantity, so a single-unit purchase is unchanged.
    $q          = _polar_dig($obj, ['quantity', 'items.0.quantity', 'subscription.quantity', 'seats']);
    $quantity   = (is_numeric($q) && (int) $q > 0) ? (int) $q : 1;

    // LINE ITEMS: a basket / multi-item order grants EACH item. Build one entry per line
    // item (the price id alone is enough — the SKU map keys on it). A subscription event with
    // no items[] array falls back to a single item from the top-level ids, so a single-item
    // order/subscription yields exactly one item and behaviour is unchanged.
    $items = [];
    if (is_array($obj['items'] ?? null) && $obj['items']) {
        foreach ($obj['items'] as $li) {
            if (!is_array($li)) continue;
            $lp  = _polar_dig($li, ['product_price_id', 'price_id', 'price.id']);
            $lpr = _polar_dig($li, ['product_id', 'product.id', 'price.product_id']);
            $lq  = _polar_dig($li, ['quantity', 'seats']);
            if ($lp === null && $lpr === null) continue;
            $items[] = [
                'price_id'   => $lp !== null ? (string) $lp : '',
                'product_id' => $lpr !== null ? (string) $lpr : '',
                'quantity'   => (is_numeric($lq) && (int) $lq > 0) ? (int) $lq : $quantity,
            ];
        }
    }
    if (!$items) {
        $items[] = [
            'price_id'   => $priceId !== null ? (string) $priceId : '',
            'product_id' => $productId !== null ? (string) $productId : '',
            'quantity'   => $quantity,
        ];
    }

    // For a grant we MUST identify the customer + at least one SKU (any line item carrying a
    // price/product id — covers baskets with no top-level price); a revoke needs only the
    // subscription id (or customer). Be strict only where it matters.
    $hasSku = false;
    foreach ($items as $it) { if ($it['price_id'] !== '' || $it['product_id'] !== '') { $hasSku = true; break; } }
    if ($action === 'grant' && ($customerId === null || !$hasSku)) {
        return ['ok' => false, 'error' => 'grant event missing customer_id or any price/product id'];
    }

    return ['ok' => true, 'event' => [
        'type'            => $type,
        'action'          => $action,            // grant | revoke | ignore
        'customer_id'     => $customerId !== null ? (string) $customerId : null,
        'email'           => $email !== null ? (string) $email : null,
        'name'            => $name !== null ? (string) $name : null,
        'price_id'        => $priceId !== null ? (string) $priceId : '',
        'product_id'      => $productId !== null ? (string) $productId : '',
        'subscription_id' => $subId !== null ? (string) $subId : null,
        'order_id'        => $orderId !== null ? (string) $orderId : null,
        'grant_ref'       => $grantRef,          // entitlement link key (sub id or order id)
        'items'           => $items,             // one entry per line item (basket grants all)
        'quantity'        => $quantity,          // seats on this sub (per-seat SKUs scale by it)
        'period_end'      => $periodEnd,         // ISO-8601 or epoch; endpoint normalises to DATETIME
        'term'            => $term,              // 'sub' | 'one_time'
    ]];
}

// ── SKU mapping: Polar price/product id → your entitlement shape ───────────────
// Per-deployment config in keys/polar_map.json (gitignored, host-specific — it holds
// YOUR Polar price ids and product UUIDs). See lib/polar_map.sample.json for the shape.
// Returns [] when absent so the endpoint can fail safe (rejected, admin-visible).
function polar_load_map(): array
{
    $file = __DIR__ . '/../keys/polar_map.json';
    if (!is_file($file)) return [];
    $j = json_decode((string) file_get_contents($file), true);
    return is_array($j) ? $j : [];
}

// Pure lookup (the test injects a map): match by price_id first (most specific), else
// product_id. Returns ['product_id'=>..,'features'=>['core'=>..,'search'=>..,'workflow'=>..],
// 'term'=>'sub'|'perpetual'] or null when the SKU is not mapped.
function polar_map_sku(array $map, string $priceId, string $productId): ?array
{
    $byPrice   = $map['prices']   ?? [];
    $byProduct = $map['products'] ?? [];
    $hit = ($priceId !== '' && isset($byPrice[$priceId])) ? $byPrice[$priceId]
         : (($productId !== '' && isset($byProduct[$productId])) ? $byProduct[$productId] : null);
    if (!is_array($hit)) return null;

    $features = [];
    foreach (['core', 'search', 'workflow'] as $f) {
        if (isset($hit['features'][$f]) && is_numeric($hit['features'][$f])) {
            $features[$f] = max(0, (int) $hit['features'][$f]);
        }
    }
    if (empty($features)) $features = ['core' => 1];   // a paid SKU always grants core
    return [
        'product_id' => (string) ($hit['product_id'] ?? ''),
        'features'   => $features,
        'term'       => ($hit['term'] ?? 'sub') === 'perpetual' ? 'perpetual' : 'sub',
    ];
}
