<?php
// licensing-backend/lib/db.php — MySQL (PDO) connection + small JSON helpers.
// Host-portable: connection settings come from environment variables with safe
// localhost defaults, so the same code runs on the WAMP dev VM and the future
// IONOS host with no code change (only env/config differs).

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $host = getenv('LICENSING_DB_HOST') ?: '127.0.0.1';
    $name = getenv('LICENSING_DB_NAME') ?: 'licensing';
    $user = getenv('LICENSING_DB_USER') ?: 'root';
    $pass = getenv('LICENSING_DB_PASS') ?: '';
    $dsn  = "mysql:host=$host;dbname=$name;charset=utf8mb4";
    $pdo  = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    return $pdo;
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function send_json(int $status, array $body): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($body);
}

function bad_request(string $message): void
{
    send_json(400, ['error' => [
        'code'       => 'bad_request',
        'message'    => $message,
        'request_id' => bin2hex(random_bytes(8)),
    ]]);
}

// Server-side audit (authoritative). Brand-neutral action names; never logs the
// plaintext account_key. ip is captured for support/investigation.
function audit_event(PDO $pdo, ?int $accountId, ?string $fpHash, string $action, string $detail): void
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? null;
    $pdo->prepare('INSERT INTO audit_events (fp_hash, account_id, action, detail, ip)
                   VALUES (?, ?, ?, ?, ?)')->execute([$fpHash, $accountId, $action, $detail, $ip]);
}
