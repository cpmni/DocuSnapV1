<?php
// licensing-backend/lib/harden.php — SEC-13 / SEC-15: server-independent runtime hardening.
// ---------------------------------------------------------------------------
// WHY THIS IS PHP AND NOT CONFIG. The two controls it replaces were both
// host-conditional and both had gaps:
//   * display_errors=Off lived only in public/admin/.user.ini — so a parse/require
//     FATAL in a /v1 endpoint (which happens BEFORE the handler's own try/catch can
//     run) would print the error, leaking absolute server paths, if the host's global
//     display_errors is On (SEC-13). .user.ini is also gitignored + per-host, so it
//     can never be a guaranteed control.
//   * The security headers and -Indexes exist only in .htaccess — Apache-only, and
//     only in the deploy script's copy, so they evaporate on nginx/LiteSpeed or on any
//     deploy that uses the committed file (SEC-15).
// Loaded by lib/db.php, which EVERY endpoint (v1 + admin) requires, so it applies
// everywhere with no per-file wiring to forget.
//
// Deliberately does NOT force HTTPS: a redirect belongs at the edge (.htaccess does it
// on Apache) and doing it here would break the loopback WAMP dev flow.

declare(strict_types=1);

// 1. Never render an error to the client. log_errors keeps them in the host's error log,
//    which is where they are useful and harmless.
@ini_set('display_errors', '0');
@ini_set('display_startup_errors', '0');
@ini_set('log_errors', '1');

// 2. Baseline response headers on every response, whatever the web server is. Cheap,
//    inert for JSON clients, and they survive a server swap.
if (!headers_sent()) {
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
}

// 3. Last-resort fatal handler. A fatal that escapes an endpoint's try/catch would
//    otherwise emit a blank 200 (or the host's error page). Emit a generic 500 with NO
//    detail — the detail goes to the error log. Shape matches the transport: JSON for
//    /v1 callers (the client parses it), minimal HTML for the admin console.
register_shutdown_function(static function (): void {
    $e = error_get_last();
    if ($e === null) {
        return;
    }
    $fatal = [E_ERROR, E_PARSE, E_CORE_ERROR, E_CORE_WARNING, E_COMPILE_ERROR, E_COMPILE_WARNING];
    if (!in_array($e['type'], $fatal, true)) {
        return;
    }
    error_log(sprintf('[fatal] %s in %s:%d', $e['message'], $e['file'], $e['line']));
    if (headers_sent()) {
        return;   // a partial response is already on the wire; do not corrupt it further
    }
    http_response_code(500);
    $uri = (string) ($_SERVER['REQUEST_URI'] ?? '');
    if (strpos($uri, '/v1/') !== false) {
        header('Content-Type: application/json');
        echo json_encode(['error' => [
            'code'       => 'internal',
            'message'    => 'Internal error.',
            'request_id' => bin2hex(random_bytes(8)),
        ]]);
    } else {
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><meta charset="utf-8"><title>Error</title><p>Internal error.';
    }
});
