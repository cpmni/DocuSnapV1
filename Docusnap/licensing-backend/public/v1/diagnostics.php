<?php
// POST /v1/diagnostics — opt-in, DOCUMENT-DATA-FREE diagnostics ingest.
// Write-only, pseudonymous (fp_hash + TLS; deliberately NOT signed — it grants
// nothing, so a forger only writes junk rows that rate-limiting + the client-side
// allowlist already bound). The client has already reduced each event to its
// enumerated, validated shape; the server is purely defensive (caps + dedupe) and
// NEVER 400s on an unknown event name (forward-compat with newer clients).
// PRIVACY: client_ip() is used ONLY for rate-limiting; it is NEVER stored on a
// telemetry row (no IP↔telemetry profile). See DIAGNOSTICS_PLAN.md.

require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/ratelimit.php';

const DIAG_MAX_EVENTS = 100;   // events accepted per request
const DIAG_MAX_PROPS  = 2000;  // bytes of props_json kept per event
const DIAG_MAX_NAME   = 64;

$body      = read_json_body();
$productId = isset($body['product_id']) ? trim((string) $body['product_id']) : '';
$fpHash    = isset($body['fp_hash']) ? strtolower(trim((string) $body['fp_hash'])) : '';
$events    = (isset($body['events']) && is_array($body['events'])) ? $body['events'] : [];

if ($productId === '' || !preg_match('/^[0-9a-f]{64}$/', $fpHash)) {
    bad_request('product_id and a 64-hex fp_hash are required');
    return;
}

try {
    $pdo = db();

    // Generous per-IP cap — a real device flushes ~hourly, so this never affects a
    // genuine client while bounding a script. (IP used here only; not persisted.)
    $hit = rate_hit($pdo, 'diag_ip:' . client_ip(), 240, 3600);
    if (!$hit['allowed']) { too_many_requests($hit['retry_after']); return; }

    // The table is OPTIONAL on an un-migrated host: fail SOFT (accept nothing) rather
    // than 500 — mirrors ratelimit.php's "inert without its table" contract.
    $hasTable = false;
    try { $pdo->query('SELECT 1 FROM telemetry_events LIMIT 1'); $hasTable = true; }
    catch (Throwable $e) { $hasTable = false; }

    $accepted = 0;
    if ($hasTable) {
        $ins = $pdo->prepare(
            'INSERT IGNORE INTO telemetry_events (fp_hash, ts, name, props_json, event_uid)
             VALUES (?, ?, ?, ?, ?)'
        );
        $n = 0;
        foreach ($events as $ev) {
            if (++$n > DIAG_MAX_EVENTS) break;
            if (!is_array($ev)) continue;
            $name = isset($ev['name']) ? substr((string) $ev['name'], 0, DIAG_MAX_NAME) : '';
            if ($name === '') continue;
            $uid   = isset($ev['event_uid']) ? substr((string) $ev['event_uid'], 0, 32) : bin2hex(random_bytes(8));
            $ts    = isset($ev['ts']) ? substr((string) $ev['ts'], 0, 40) : gmdate('Y-m-d\TH:i:s\Z');
            $props = isset($ev['props']) ? json_encode($ev['props']) : '{}';
            if (!is_string($props)) { $props = '{}'; }
            if (strlen($props) > DIAG_MAX_PROPS) { $props = substr($props, 0, DIAG_MAX_PROPS); }
            $ins->execute([$fpHash, $ts, $name, $props, $uid]);
            $accepted += $ins->rowCount();   // 0 when the (fp_hash,event_uid) already existed
        }
    }

    send_json(200, ['accepted' => $accepted]);
} catch (Throwable $e) {
    error_log('diagnostics error: ' . $e->getMessage());
    send_json(500, ['error' => [
        'code'       => 'server_error',
        'message'    => 'diagnostics failed',
        'request_id' => bin2hex(random_bytes(8)),
    ]]);
}
