<?php
// licensing-backend/lib/ratelimit.php — minimal MySQL fixed-window rate limiter.
// Prepared statements only; no external store (no Redis). Backs the F-03 phase-1
// anti-automation layer on the /v1 endpoints (trial farming + account-key guessing).
//
// Design notes:
//  - A "bucket" is a caller-namespaced key string, e.g. "trial_ip:1.2.3.4" or
//    "trial_new:2026-06-20". One row per bucket, counting events in the current
//    fixed window; the window rolls when window_start + window <= now.
//  - rate_hit() INCREMENTS and reports whether the bucket is now OVER its limit.
//  - rate_count() is a read-only peek (for an escalating-backoff pre-check).
//  - FAIL OPEN: a limiter error (e.g. table missing on an un-migrated host) must
//    NEVER take the licensing API down — it returns "allowed" and logs server-side.
//
// ⚠ DEPLOYMENT REQUIREMENT — rate limiting is INERT until the `rate_limits` table
//   exists. Because the limiter FAILS OPEN (a missing table must never break
//   activation), a host that has NOT imported the current schema.sql accepts
//   UNLIMITED traffic with NO throttling and NO error. Import schema.sql on every
//   deploy (Configure-WampBackend.ps1 -ImportDatabase creates the table) for F-03 to
//   take effect, then confirm: SHOW TABLES LIKE 'rate_limits';

function client_ip(): string
{
    // REMOTE_ADDR only — do not trust X-Forwarded-* unless a known proxy sets it
    // (out of scope for phase 1; document for the deploy that fronts this).
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

/**
 * Increment the bucket's counter for the current window and report the verdict.
 * @return array{allowed:bool, retry_after:int}
 */
function rate_hit(PDO $pdo, string $bucket, int $limit, int $windowSeconds): array
{
    try {
        $now = time();
        // Atomic upsert: start a fresh window (count=1) when the previous window has
        // rolled, otherwise increment. `count` is assigned first and references the
        // OLD window_start; `window_start` is assigned after, so the ordering is safe.
        $pdo->prepare(
            'INSERT INTO rate_limits (bucket, count, window_start)
             VALUES (:b, 1, :now0)
             ON DUPLICATE KEY UPDATE
               count        = IF(window_start + :w1 <= :now1, 1, count + 1),
               window_start = IF(window_start + :w2 <= :now2, :now3, window_start)'
        )->execute([
            ':b' => $bucket, ':now0' => $now,
            ':w1' => $windowSeconds, ':now1' => $now,
            ':w2' => $windowSeconds, ':now2' => $now, ':now3' => $now,
        ]);

        $sel = $pdo->prepare('SELECT count, window_start FROM rate_limits WHERE bucket = ?');
        $sel->execute([$bucket]);
        $row = $sel->fetch();
        if (!$row) {
            return ['allowed' => true, 'retry_after' => 0];
        }
        $count   = (int) $row['count'];
        $resetIn = max(1, ((int) $row['window_start'] + $windowSeconds) - $now);
        if ($count > $limit) {
            return ['allowed' => false, 'retry_after' => $resetIn];
        }
        return ['allowed' => true, 'retry_after' => 0];
    } catch (Throwable $e) {
        error_log('rate_hit error: ' . $e->getMessage());
        return ['allowed' => true, 'retry_after' => 0]; // fail open
    }
}

/** Read-only current count for a bucket's window (0 if absent or on error). */
function rate_count(PDO $pdo, string $bucket): int
{
    try {
        $sel = $pdo->prepare('SELECT count, window_start FROM rate_limits WHERE bucket = ?');
        $sel->execute([$bucket]);
        $row = $sel->fetch();
        return $row ? (int) $row['count'] : 0;
    } catch (Throwable $e) {
        return 0;
    }
}

/** Emit a 429 (Retry-After + the standard error body) and stop. */
function too_many_requests(int $retryAfter): void
{
    $retryAfter = max(1, $retryAfter);
    http_response_code(429);
    header('Content-Type: application/json');
    header('Retry-After: ' . $retryAfter);
    echo json_encode(['error' => [
        'code'                => 'rate_limited',
        'message'             => 'Too many requests. Please slow down and try again later.',
        'retry_after_seconds' => $retryAfter,
        'request_id'          => bin2hex(random_bytes(8)),
    ]]);
}
