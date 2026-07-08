<?php
// licensing-backend/lib/webhook.php — Phase 2b purchase-webhook foundation: PURE,
// testable helpers (secret loading, HMAC signature verification, payload validation).
// No DB and no HTTP here — the endpoint (public/v1/webhook.php) wires these to the
// request + the entitlement mutation. DORMANT until a secret is configured, so the
// foundation is safe to deploy before any commerce system exists.

// Shared HMAC secret, loaded like the admin password (env first, else a file OUTSIDE
// the web docroot). Returns null when unconfigured -> the endpoint stays DORMANT and
// rejects every request.
function webhook_secret(): ?string
{
    $env = getenv('LICENSING_WEBHOOK_SECRET');
    if (is_string($env) && $env !== '') return $env;
    $file = __DIR__ . '/../keys/webhook_secret'; // sibling of the signing seed, never web-served
    if (is_file($file)) {
        $s = trim((string) file_get_contents($file));
        if ($s !== '') return $s;
    }
    return null;
}

// Constant-time HMAC-SHA256 verification over the RAW request body. The header value is
// "sha256=<hex>" (GitHub/Stripe style). Returns false on any shape/secret problem.
function webhook_signature_ok(string $rawBody, ?string $providedSig, ?string $secret): bool
{
    if ($secret === null || $secret === '' || $providedSig === null || $providedSig === '') return false;
    $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $secret);
    return hash_equals($expected, $providedSig);   // constant-time
}

// Validate + normalise the decoded JSON event. Returns ['ok'=>true,'event'=>[...]] or
// ['ok'=>false,'error'=>'...']. Replay window: the event timestamp must be within
// +/- $skew seconds of now (combined with the event_id PK this also blocks delayed
// replays of a previously captured-but-unseen event).
function webhook_validate_payload(array $data, int $skew = 300, ?int $now = null): array
{
    $now     = $now ?? time();
    $eventId = isset($data['event_id']) ? trim((string) $data['event_id']) : '';
    $type    = isset($data['type']) ? trim((string) $data['type']) : '';
    $acctKey = isset($data['account_key']) ? (string) $data['account_key'] : '';
    $product = isset($data['product_id']) ? trim((string) $data['product_id']) : '';
    $ts      = $data['timestamp'] ?? null;

    if ($eventId === '' || strlen($eventId) > 190) return ['ok' => false, 'error' => 'event_id required (<=190 chars)'];
    if ($type === '' || strlen($type) > 60)        return ['ok' => false, 'error' => 'type required'];
    if ($product === '')                           return ['ok' => false, 'error' => 'product_id required'];
    if ($acctKey === '')                           return ['ok' => false, 'error' => 'account_key required'];

    // timestamp: accept epoch seconds or an ISO-8601 string.
    $epoch = is_numeric($ts) ? (int) $ts : (is_string($ts) ? strtotime($ts) : false);
    if ($epoch === false || $epoch === null)       return ['ok' => false, 'error' => 'timestamp required (epoch or ISO-8601)'];
    if (abs($now - $epoch) > $skew)                return ['ok' => false, 'error' => 'timestamp outside the replay window'];

    // features: optional map of WHITELISTED feature_key => non-negative seat count
    // (the additive mutation). Anything else is ignored — the caller cannot set
    // arbitrary state.
    $features = [];
    if (isset($data['features']) && is_array($data['features'])) {
        foreach (['core', 'search', 'workflow'] as $f) {
            if (array_key_exists($f, $data['features'])) {
                $n = $data['features'][$f];
                if (!is_numeric($n) || $n < 0 || $n > 100000) return ['ok' => false, 'error' => "features.$f must be 0..100000"];
                $features[$f] = (int) $n;
            }
        }
    }
    if (isset($features['workflow'], $features['search']) && $features['workflow'] > $features['search']) {
        return ['ok' => false, 'error' => 'workflow seats cannot exceed search seats'];
    }

    return ['ok' => true, 'event' => [
        'event_id'   => $eventId, 'type' => $type, 'account_key' => $acctKey,
        'product_id' => $product, 'features' => $features,
    ]];
}
