<?php
// Unit test for the PURE Polar helpers (Standard-Webhooks signature, event
// normalisation, SKU mapping). No DB / no HTTP, so it runs with plain PHP:
//   php licensing-backend/lib/test_polar.php
// The DB-dependent paths (idempotency, account/entitlement upsert) are exercised by
// curl against the host, like test_webhook.php.
require __DIR__ . '/polar.php';

$fail = 0;
function check($label, $cond) { global $fail; echo ($cond ? "  OK  " : "  BAD ") . "$label\n"; if (!$cond) $fail++; }

// ── Standard-Webhooks signature ──────────────────────────────────────────────
// Build a valid signature the same way Polar/svix does, then assert verification.
$secretRaw = base64_encode('a-test-signing-key');        // the bytes after whsec_
$secret    = 'whsec_' . $secretRaw;
$id        = 'msg_123';
$ts        = (string) time();
$body      = '{"type":"order.paid","data":{"customer_id":"cus_1"}}';
$signed    = "$id.$ts.$body";
$sig       = base64_encode(hash_hmac('sha256', $signed, 'a-test-signing-key', true));
$hdr       = ['webhook-id' => $id, 'webhook-timestamp' => $ts, 'webhook-signature' => "v1,$sig"];

check('valid signature accepted',            polar_signature_ok($body, $hdr, $secret) === true);
check('whsec_ prefix tolerated == raw b64',  polar_signature_ok($body, $hdr, $secretRaw) === true);
check('tampered body rejected',              polar_signature_ok($body . ' ', $hdr, $secret) === false);
check('wrong secret rejected',               polar_signature_ok($body, $hdr, 'whsec_' . base64_encode('nope')) === false);
check('missing headers rejected',            polar_signature_ok($body, [], $secret) === false);
check('dormant (no secret) rejected',        polar_signature_ok($body, $hdr, null) === false);
$old = ['webhook-id' => $id, 'webhook-timestamp' => (string) (time() - 4000), 'webhook-signature' => "v1,$sig"];
check('stale timestamp rejected (replay)',   polar_signature_ok($body, $old, $secret) === false);
// multiple v1 tokens (key rotation): accept if any matches
$multi = ['webhook-id' => $id, 'webhook-timestamp' => $ts, 'webhook-signature' => "v1,deadbeef v1,$sig"];
check('one of several v1 sigs matches',      polar_signature_ok($body, $multi, $secret) === true);

// ── event-type → action ──────────────────────────────────────────────────────
check('order.paid -> grant',                 polar_event_action('order.paid') === 'grant');
check('subscription.canceled -> revoke',     polar_event_action('subscription.canceled') === 'revoke');
check('order.refunded -> revoke',            polar_event_action('order.refunded') === 'revoke');
check('unknown type -> ignore',              polar_event_action('checkout.updated') === 'ignore');

// ── event normalisation ──────────────────────────────────────────────────────
$order = polar_parse_event(['type' => 'order.paid', 'data' => [
    'customer_id' => 'cus_1', 'customer' => ['email' => 'a@b.com', 'name' => 'Jane Doe'],
    'product_price_id' => 'price_solo', 'product_id' => 'prod_x',
]]);
check('order.paid parses ok',                $order['ok'] === true);
check('  action grant',                      $order['event']['action'] === 'grant');
check('  customer + price extracted',        $order['event']['customer_id'] === 'cus_1' && $order['event']['price_id'] === 'price_solo');
check('  email extracted (nested path)',     $order['event']['email'] === 'a@b.com');
check('  name extracted (nested path)',      $order['event']['name'] === 'Jane Doe');
check('  one-time term',                     $order['event']['term'] === 'one_time');
check('  single line item from top-level',   count($order['event']['items']) === 1 && $order['event']['items'][0]['price_id'] === 'price_solo');

// BASKET: a multi-item order yields one entry per line item (price id + per-item quantity).
$basket = polar_parse_event(['type' => 'order.paid', 'data' => [
    'customer_id' => 'cus_b', 'customer' => ['email' => 'b@b.com'],
    'items' => [
        ['product_price_id' => 'price_core'],
        ['product_price_id' => 'price_bundle', 'quantity' => 5],
    ],
]]);
check('basket parses 2 line items',          count($basket['event']['items']) === 2);
check('  basket item price ids',             $basket['event']['items'][0]['price_id'] === 'price_core' && $basket['event']['items'][1]['price_id'] === 'price_bundle');
check('  basket per-item quantity',          $basket['event']['items'][0]['quantity'] === 1 && $basket['event']['items'][1]['quantity'] === 5);

$sub = polar_parse_event(['type' => 'subscription.active', 'data' => [
    'id' => 'sub_9', 'customer_id' => 'cus_2', 'product_price_id' => 'price_team5',
    'current_period_end' => '2027-01-01T00:00:00Z',
]]);
check('subscription.active parses ok',        $sub['ok'] === true);
check('  subscription_id = data.id',          $sub['event']['subscription_id'] === 'sub_9');
check('  term sub + period_end carried',      $sub['event']['term'] === 'sub' && $sub['event']['period_end'] === '2027-01-01T00:00:00Z');

$bad = polar_parse_event(['type' => 'order.paid', 'data' => ['product_price_id' => 'price_solo']]); // no customer
check('grant missing customer rejected',      $bad['ok'] === false);
$cancel = polar_parse_event(['type' => 'subscription.canceled', 'data' => ['id' => 'sub_9']]);
check('revoke needs only sub id',             $cancel['ok'] === true && $cancel['event']['action'] === 'revoke');
check('sub grant_ref = subscription id',      $sub['event']['grant_ref'] === 'sub_9' && $sub['event']['order_id'] === null);

$o2 = polar_parse_event(['type' => 'order.paid', 'data' => ['id' => 'ord_1', 'customer_id' => 'c', 'product_price_id' => 'p']]);
check('one-time order grant_ref = order id',  $o2['event']['order_id'] === 'ord_1' && $o2['event']['grant_ref'] === 'ord_1' && $o2['event']['term'] === 'one_time');
$rf = polar_parse_event(['type' => 'order.refunded', 'data' => ['id' => 'ord_1']]);
check('refund revoke resolves by order id',   $rf['event']['action'] === 'revoke' && $rf['event']['grant_ref'] === 'ord_1');

# quantity (per-seat SKUs)
check('default quantity = 1',                 $sub['event']['quantity'] === 1);
$qs = polar_parse_event(['type' => 'subscription.active', 'data' => ['id' => 'sub_q', 'customer_id' => 'c', 'product_price_id' => 'price_client', 'quantity' => 5]]);
check('quantity parsed from event',           $qs['event']['quantity'] === 5);

// ── SKU mapping ──────────────────────────────────────────────────────────────
$map = [
    'prices' => [
        'price_solo'  => ['product_id' => 'P', 'features' => ['core' => 1], 'term' => 'sub'],
        'price_team5' => ['product_id' => 'P', 'features' => ['core' => 1, 'search' => 5, 'workflow' => 5], 'term' => 'sub'],
        'price_perp'  => ['product_id' => 'P', 'features' => ['core' => 1], 'term' => 'perpetual'],
    ],
    'products' => [ 'prod_x' => ['product_id' => 'P', 'features' => ['core' => 1], 'term' => 'sub'] ],
];
$solo = polar_map_sku($map, 'price_solo', 'prod_x');
check('price match wins',                     $solo['product_id'] === 'P' && $solo['features'] === ['core' => 1]);
$team = polar_map_sku($map, 'price_team5', '');
check('team maps client seats on top of core', $team['features'] === ['core' => 1, 'search' => 5, 'workflow' => 5]);
check('perpetual term carried',               polar_map_sku($map, 'price_perp', '')['term'] === 'perpetual');
check('product-id fallback when price absent', polar_map_sku($map, 'price_unknown', 'prod_x')['product_id'] === 'P');
check('unmapped SKU -> null',                 polar_map_sku($map, 'nope', 'nope') === null);

echo $fail ? "\n$fail FAILED\n" : "\nAll Polar helper checks passed\n";
exit($fail ? 1 : 0);
