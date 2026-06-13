<?php
// Health/version endpoint. Phase 0 scaffold — no business logic.
header('Content-Type: application/json');
echo json_encode([
    'service' => 'licensing',
    'api'     => 'v1',
    'status'  => 'ok',
    'phase'   => 'scaffold',
]);
