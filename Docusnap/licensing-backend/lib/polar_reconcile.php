<?php
// licensing-backend/lib/polar_reconcile.php — periodic Polar.sh reconciliation. Catches
// MISSED webhooks: pulls Polar's currently-active subscriptions and aligns the local
// entitlements (heals a missed grant, extends a drifted renewal expiry). Run as a cron /
// Task-Scheduler job (see scripts/Reconcile-Polar.ps1).
//
// SAFETY: DRY-RUN by default — it prints what it WOULD change and writes nothing. Pass
// --apply to write. It only ever GRANTS or EXTENDS from Polar's active set; it never
// auto-revokes (a missed cancel/refund is handled by the webhook, and a lapsed sub's
// expires_at is already in the past, so /v1/validate denies it anyway).
//
// The core is split from the HTTP fetch so it's unit-testable with a fake fetcher
// (tests/test_polar_reconcile.php) — no Polar token or network needed in tests.

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/polar.php';          // _polar_dig, polar_load_map, polar_map_sku
require_once __DIR__ . '/entitlements.php';   // find_or_create / grant / normalise / deliver

// ── Config: read-only Polar API token + base URL (env first, else keys/ files) ─────────
function polar_api_token(): ?string
{
    $env = getenv('POLAR_API_TOKEN');
    if (is_string($env) && $env !== '') return $env;
    $f = __DIR__ . '/../keys/polar_api_token';
    if (is_file($f)) { $s = trim((string) file_get_contents($f)); if ($s !== '') return $s; }
    return null;
}
function polar_api_base(): string
{
    $env = getenv('POLAR_API_BASE');
    if (is_string($env) && $env !== '') return rtrim($env, '/');
    $f = __DIR__ . '/../keys/polar_api_base';
    if (is_file($f)) { $s = trim((string) file_get_contents($f)); if ($s !== '') return rtrim($s, '/'); }
    return 'https://api.polar.sh';   // sandbox: https://sandbox-api.polar.sh
}

// ── HTTP fetch: Polar's active subscriptions (paginated). Tolerant of the two common
//    envelope shapes ({items,pagination} or {result:{...}}). ⚠ confirm the endpoint +
//    query params against Polar's current API docs. ─────────────────────────────────────
function _polar_api_get(string $url, string $token): array
{
    if (!function_exists('curl_init')) throw new RuntimeException('php-curl is required for reconcile');
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $token, 'Accept: application/json'],
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($body === false) throw new RuntimeException("Polar API call failed: $err");
    if ($code < 200 || $code >= 300) throw new RuntimeException("Polar API HTTP $code");
    $j = json_decode((string) $body, true);
    return is_array($j) ? $j : [];
}
function polar_fetch_active_subscriptions(string $token, string $base): array
{
    $out = [];
    $page = 1;
    do {
        $resp  = _polar_api_get($base . "/v1/subscriptions?active=true&page=$page&limit=100", $token);
        $items = $resp['items'] ?? ($resp['result']['items'] ?? []);
        if (!is_array($items)) $items = [];
        foreach ($items as $it) if (is_array($it)) $out[] = $it;
        $maxPage = (int) ($resp['pagination']['max_page'] ?? ($resp['result']['pagination']['max_page'] ?? 1));
        $page++;
    } while ($page <= $maxPage && $page <= 100);   // hard stop
    return $out;
}

// ── Core: align local entitlements to Polar's active subscriptions ─────────────────────
// $fetchActiveSubs() returns an array of Polar subscription objects. $deliver is the key
// emitter (injected so tests don't send mail). Returns a summary; with $apply=false it
// only PLANS (no writes). The caller owns any transaction (the test wraps + rolls back).
function polar_reconcile(PDO $pdo, callable $fetchActiveSubs, array $map, bool $apply, ?callable $deliver = null): array
{
    $deliver = $deliver ?? 'deliver_account_key';
    $sum = ['active_subs' => 0, 'granted' => 0, 'extended' => 0, 'in_sync' => 0, 'unmapped' => 0, 'errors' => 0, 'details' => []];

    foreach ($fetchActiveSubs() as $sub) {
        if (!is_array($sub)) { $sum['errors']++; continue; }
        $sum['active_subs']++;
        $subId     = (string) (_polar_dig($sub, ['id']) ?? '');
        $custId    = (string) (_polar_dig($sub, ['customer_id', 'customer.id', 'user_id', 'user.id']) ?? '');
        $priceId   = (string) (_polar_dig($sub, ['product_price_id', 'price.id', 'price_id', 'prices.0.id']) ?? '');
        $productId = (string) (_polar_dig($sub, ['product_id', 'product.id']) ?? '');
        $email     = _polar_dig($sub, ['customer.email', 'user.email', 'email']);
        $periodEnd = polar_normalize_period_end(_polar_dig($sub, ['current_period_end', 'ends_at']));
        if ($subId === '' || $custId === '') { $sum['errors']++; $sum['details'][] = "skip: sub missing id/customer"; continue; }

        $sku = polar_map_sku($map, $priceId, $productId);
        if (!$sku || $sku['product_id'] === '') { $sum['unmapped']++; $sum['details'][] = "unmapped sub=$subId price=$priceId"; continue; }
        $expiresAt = $sku['term'] === 'perpetual' ? null : $periodEnd;

        $sel = $pdo->prepare('SELECT id, account_id, expires_at FROM entitlements WHERE polar_ref = ? AND status = "active" LIMIT 1');
        $sel->execute([$subId]);
        $local = $sel->fetch();

        if (!$local) {                                   // MISSED GRANT → heal
            $sum['granted']++; $sum['details'][] = "GRANT sub=$subId cust=$custId product={$sku['product_id']}";
            if ($apply) {
                [$accId, $newKey] = find_or_create_polar_account($pdo, $custId);
                grant_polar_entitlements($pdo, $accId, $sku, $subId, $priceId, $expiresAt);
                if ($newKey !== null) { $deliver($email, $newKey, "account #$accId (reconciled)"); }
                audit_event($pdo, $accId, null, 'polar.reconcile_granted', "sub=$subId");
            }
        } elseif (($local['expires_at'] ?? null) !== $expiresAt) {  // DRIFTED RENEWAL → extend
            $sum['extended']++; $sum['details'][] = "EXTEND sub=$subId " . ($local['expires_at'] ?? 'never') . " -> " . ($expiresAt ?? 'never');
            if ($apply) {
                grant_polar_entitlements($pdo, (int) $local['account_id'], $sku, $subId, $priceId, $expiresAt);
                audit_event($pdo, (int) $local['account_id'], null, 'polar.reconcile_extended', "sub=$subId expires=" . ($expiresAt ?? 'never'));
            }
        } else {
            $sum['in_sync']++;
        }
    }
    return $sum;
}

// ── CLI runner (dry-run unless --apply) ────────────────────────────────────────────────
if (PHP_SAPI === 'cli' && isset($argv[0]) && realpath($argv[0]) === realpath(__FILE__)) {
    $apply = in_array('--apply', $argv, true);
    $token = polar_api_token();
    if ($token === null) { fwrite(STDERR, "No Polar API token (set POLAR_API_TOKEN or keys/polar_api_token).\n"); exit(2); }
    $base = polar_api_base();
    $map  = polar_load_map();
    if (empty($map)) { fwrite(STDERR, "No SKU map (keys/polar_map.json) — every sub would be unmapped.\n"); exit(2); }
    try {
        $pdo = db();
        echo ($apply ? "APPLY" : "DRY RUN (no writes; pass --apply to write)") . " — Polar reconcile @ $base\n";
        $sum = polar_reconcile($pdo, fn() => polar_fetch_active_subscriptions($token, $base), $map, $apply);
        foreach ($sum['details'] as $d) echo "  - $d\n";
        printf("active=%d granted=%d extended=%d in_sync=%d unmapped=%d errors=%d\n",
            $sum['active_subs'], $sum['granted'], $sum['extended'], $sum['in_sync'], $sum['unmapped'], $sum['errors']);
        exit($sum['errors'] > 0 ? 1 : 0);
    } catch (Throwable $e) {
        fwrite(STDERR, 'reconcile failed: ' . $e->getMessage() . "\n");
        exit(1);
    }
}
