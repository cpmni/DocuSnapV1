<?php
// Shared placeholder for Phase 0. Each /v1 endpoint includes this and returns
// 501 not_implemented. No business logic, no signing — contract is visible in
// CONTRACT.md and the real handlers arrive in later phases.
function respond_not_implemented(string $endpoint): void
{
    http_response_code(501);
    header('Content-Type: application/json');
    echo json_encode([
        'error' => [
            'code'       => 'not_implemented',
            'message'    => "Endpoint $endpoint is scaffolded but not implemented yet (Phase 0).",
            'request_id' => bin2hex(random_bytes(8)),
        ],
    ]);
}
