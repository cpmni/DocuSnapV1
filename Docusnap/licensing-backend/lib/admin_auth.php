<?php
// licensing-backend/lib/admin_auth.php
// ---------------------------------------------------------------------------
// Minimal, self-contained admin gate + shared HTML chrome for the backend web
// admin pages (public/admin/*). This backend had NO web auth system, so this
// adds exactly ONE: a single admin credential verified against a bcrypt hash
// kept OUTSIDE the web docroot — keys/admin_password.hash, or the
// LICENSING_ADMIN_PASSWORD_HASH environment variable. No plaintext password is
// ever stored or logged. Lives in lib/ (a sibling of public/, not web-served).
declare(strict_types=1);

// ── Session ────────────────────────────────────────────────────────────────
function admin_session_boot(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    session_name('LICADMIN');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        // Hard-coded true (SEC-14): behind a proxy that doesn't reflect HTTPS into
        // $_SERVER['HTTPS'], the old conditional shipped LICADMIN without Secure.
        // The console is HTTPS-only in every real deployment; a plain-HTTP dev hit
        // simply gets a cookie the browser won't send back — sign in over HTTPS.
        'secure'   => true,
    ]);
    session_start();
}

// Bcrypt hash of the admin password, from env first, then a file outside the
// docroot. Returns null when not provisioned (the gate then fails closed).
function admin_password_hash(): ?string
{
    $env = getenv('LICENSING_ADMIN_PASSWORD_HASH');
    if (is_string($env) && $env !== '') {
        return $env;
    }
    $file = __DIR__ . '/../keys/admin_password.hash'; // sits beside the signing seed, outside docroot
    if (is_file($file)) {
        $h = trim((string) file_get_contents($file));
        if ($h !== '') {
            return $h;
        }
    }
    return null;
}

// Server-side inactivity timeout for an authenticated admin session (seconds).
const ADMIN_IDLE_TIMEOUT = 300;          // 5 minutes
// Max wrong TOTP/recovery attempts before the pending 2FA state is dropped.
// (SESSION-scoped belt only — the REAL wall is the persisted admin_throttle below,
// which an attacker cannot reset by re-POSTing the password with a fresh cookie jar.)
const ADMIN_2FA_MAX_TRIES = 5;
// Lifetime of the password→code window. The pending 2FA state self-expires after
// this, independent of (and shorter than) the authenticated-session timeout.
const ADMIN_2FA_PENDING_TTL = 180; // 3 minutes

// ── SEC-01: persisted brute-force lockout (fixed window, IP + global keyed) ───
// The old defence was a 0.4s usleep only — no counter survived the request, so an
// attacker could hammer the password (and reset the session TOTP cap at will).
// Attempts are now counted in the rate_limits table via rate_hit_strict:
//   admin_<stage>_ip:<ip>  — per-source cap
//   admin_<stage>_global   — cross-source cap (rotating-proxy defence; this is a
//                            single-credential console, so a global cap is meaningful)
// Counting ATTEMPTS (not just failures) keeps this a single pre-verify call with no
// success/failure race; the caps are far above any human's legitimate use.
const ADMIN_RL_WINDOW     = 900;  // 15-minute fixed window
const ADMIN_RL_IP_MAX     = 10;   // attempts per IP per window
const ADMIN_RL_GLOBAL_MAX = 50;   // attempts across ALL IPs per window

// FAIL CLOSED (SEC-06): unlike the /v1 limiter (availability-first, fail-open), an
// admin-console limiter that cannot run — rate_limits table missing, DB down — DENIES.
// The console is DB-backed anyway (nothing in it works without MySQL), so failing
// closed costs nothing and turns the "silently inert limiter" hole into a loud stop.
// Returns null when the attempt may proceed; retry-after seconds when blocked.
function admin_throttle(string $stage): ?int
{
    try {
        require_once __DIR__ . '/db.php';
        require_once __DIR__ . '/ratelimit.php';
        $pdo = db();
        $ip  = client_ip();
        // ORDER IS LOAD-BEARING (Oracle C1): the IP bucket is hit FIRST and a deny
        // RETURNS before the global bucket is ever touched — otherwise one already-
        // denied IP keeps inflating the global counter and a single address can lock
        // the console for everyone (the griefing bar must be ≥ GLOBAL/IP distinct
        // sources, not one). Audit only the FIRST crossing per window (Oracle C2 —
        // one row per lockout event, not one per denied request; the rest error_log).
        $a = rate_hit_strict($pdo, 'admin_' . $stage . '_ip:' . $ip, ADMIN_RL_IP_MAX, ADMIN_RL_WINDOW);
        if (!$a['allowed']) {
            if ((int) $a['count'] === ADMIN_RL_IP_MAX + 1) {
                admin_audit('admin.login_throttled', $stage . ' ip=' . $ip);
            } else {
                error_log('admin_throttle deny (ip bucket) stage=' . $stage . ' ip=' . $ip);
            }
            return max($a['retry_after'], 1);
        }
        $b = rate_hit_strict($pdo, 'admin_' . $stage . '_global', ADMIN_RL_GLOBAL_MAX, ADMIN_RL_WINDOW);
        if (!$b['allowed']) {
            if ((int) $b['count'] === ADMIN_RL_GLOBAL_MAX + 1) {
                admin_audit('admin.login_throttled', $stage . ' global (distributed)');
            } else {
                error_log('admin_throttle deny (global bucket) stage=' . $stage . ' ip=' . $ip);
            }
            return max($b['retry_after'], 1);
        }
        return null;
    } catch (\Throwable $e) {
        error_log('admin_throttle FAIL-CLOSED (limiter unavailable): ' . $e->getMessage());
        return 60; // deny — never let a broken limiter mean unlimited attempts
    }
}

// ── SEC-01: 2FA is REQUIRED by default for this internet-facing console ───────
// Password-only sign-in is refused while keys/admin_2fa.json is unprovisioned,
// UNLESS the break-glass env LICENSING_ADMIN_ALLOW_NO_2FA=1 is set (first-run
// provisioning path: set the env, sign in, provision 2FA on the Security page,
// REMOVE the env). Fail-closed per the 2026-07-17 audit adjudication.
function admin_2fa_required(): bool
{
    $v = getenv('LICENSING_ADMIN_ALLOW_NO_2FA');
    return !(is_string($v) && ($v === '1' || strtolower($v) === 'true' || strtolower($v) === 'on'));
}

function admin_is_authed(): bool
{
    if (empty($_SESSION['admin_authed'])) {
        return false;
    }
    // Authoritative inactivity expiry (the page gate below also enforces this and
    // shows a message; this keeps any other caller honest too).
    $last = (int) ($_SESSION['last_activity'] ?? 0);
    if ($last > 0 && (time() - $last) > ADMIN_IDLE_TIMEOUT) {
        unset($_SESSION['admin_authed']);
        return false;
    }
    return true;
}

// Promote a verified session to fully authenticated. Used after a password-only
// login (no 2FA) and after a successful 2FA challenge.
function admin_finalize_login(): void
{
    session_regenerate_id(true); // prevent fixation
    $_SESSION['admin_authed']  = true;
    $_SESSION['last_activity'] = time();
    unset($_SESSION['admin_2fa_pending'], $_SESSION['admin_2fa_tries'], $_SESSION['admin_2fa_started']);
}

// True only while a 2FA challenge is outstanding AND within its short TTL. Clears
// the pending state once it has expired, so a stale challenge cannot be resumed.
function admin_2fa_pending_active(): bool
{
    if (empty($_SESSION['admin_2fa_pending'])) {
        return false;
    }
    $started = (int) ($_SESSION['admin_2fa_started'] ?? 0);
    if ($started > 0 && (time() - $started) > ADMIN_2FA_PENDING_TTL) {
        unset($_SESSION['admin_2fa_pending'], $_SESSION['admin_2fa_tries'], $_SESSION['admin_2fa_started']);
        return false;
    }
    return true;
}

// Stage 1. Returns 'ok' (fully signed in, no 2FA), 'need_2fa' (password correct,
// a TOTP challenge is required next), 'no_2fa' (password correct but 2FA is
// unprovisioned and required — sign-in REFUSED, see admin_2fa_required), or
// 'fail'. Never sets admin_authed while a 2FA challenge is outstanding.
function admin_login(string $password): string
{
    $hash = admin_password_hash();
    if ($hash === null || !password_verify($password, $hash)) {
        admin_audit('admin.login_failed', 'password');
        return 'fail';
    }
    if (admin_2fa_enabled()) {
        $_SESSION['admin_2fa_pending'] = true;
        $_SESSION['admin_2fa_tries']   = 0;
        $_SESSION['admin_2fa_started'] = time();   // starts the short pending TTL
        unset($_SESSION['admin_authed']);
        return 'need_2fa';
    }
    if (admin_2fa_required()) {
        // Correct password, but the console is 2FA-mandatory and 2FA isn't set up.
        // Fail CLOSED (SEC-01): a password-only internet-facing console is the
        // exposure the audit flagged. The login page explains the break-glass path.
        admin_audit('admin.login_refused', 'no_2fa_provisioned');
        return 'no_2fa';
    }
    admin_finalize_login();
    admin_audit('admin.login_success', 'password (2FA break-glass env active)');
    return 'ok';
}

// Stage 2. Completes login from the pending state with a TOTP code or a one-time
// recovery code. Server-side only — never trusts client state. Throttled.
function admin_complete_2fa(string $code): bool
{
    if (!admin_2fa_pending_active()) {   // missing, or expired past the pending TTL
        return false;
    }
    if ((int) ($_SESSION['admin_2fa_tries'] ?? 0) >= ADMIN_2FA_MAX_TRIES) {
        return false;
    }
    $_SESSION['admin_2fa_tries'] = (int) ($_SESSION['admin_2fa_tries'] ?? 0) + 1;

    $state = admin_2fa_load();
    if (!is_array($state) || empty($state['enabled']) || empty($state['secret'])) {
        return false;
    }
    $code = preg_replace('/\s+/', '', $code);

    if ($code !== '' && ctype_digit($code) && totp_verify((string) $state['secret'], $code)) {
        admin_finalize_login();
        admin_audit('admin.login_success', '2fa=totp');
        return true;
    }
    if ($code !== '' && admin_recovery_consume($code)) {
        admin_finalize_login();
        admin_audit('admin.recovery_used', '');
        admin_audit('admin.login_success', '2fa=recovery');
        return true;
    }
    admin_audit('admin.login_failed', '2fa');
    return false;
}

function admin_logout(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'] ?? '', (bool) $p['secure'], (bool) $p['httponly']);
    }
    session_destroy();
}

// Gate guard: call at the top of every protected page.
function require_admin(): void
{
    admin_session_boot();
    // Never cache an authenticated admin page (browser history / bfcache): after
    // the inactivity timeout, back/refresh must re-hit this gate, not show a stale
    // page. Sent before any page output (require_admin runs at the top of pages).
    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('Pragma: no-cache');
    if (empty($_SESSION['admin_authed'])) {
        header('Location: login.php');
        exit;
    }
    // 5-minute server-side inactivity timeout (authoritative).
    $last = (int) ($_SESSION['last_activity'] ?? 0);
    if ($last > 0 && (time() - $last) > ADMIN_IDLE_TIMEOUT) {
        unset($_SESSION['admin_authed'], $_SESSION['admin_2fa_pending'], $_SESSION['admin_2fa_tries']);
        flash_set('err', 'Session expired due to inactivity. Please sign in again.');
        header('Location: login.php');
        exit;
    }
    $_SESSION['last_activity'] = time(); // sliding inactivity window
}

// ── CSRF (synchroniser token) ────────────────────────────────────────────────
function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf" value="' . h(csrf_token()) . '">';
}

function csrf_check(): bool
{
    $t = $_POST['csrf'] ?? '';
    return is_string($t) && $t !== '' && !empty($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $t);
}

// ── Flash messages (one-shot, survive the POST→redirect→GET) ──────────────────
function flash_set(string $type, string $msg): void
{
    $_SESSION['flash'] = ['type' => $type, 'msg' => $msg];
}

function flash_take(): ?array
{
    $f = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return is_array($f) ? $f : null;
}

// ── TOTP 2FA (RFC 6238, dependency-free) ─────────────────────────────────────
// Pure-PHP implementation using the built-in hash_hmac / random_bytes — no third-
// party code, so there is no licensing question and nothing to install. The
// shared secret and the hashed one-time recovery codes live in keys/admin_2fa.json,
// OUTSIDE the web docroot, mirroring keys/admin_password.hash and the signing
// seeds (the established secret-at-rest pattern for this backend).

function admin_2fa_path(): string
{
    return __DIR__ . '/../keys/admin_2fa.json'; // sibling of public/, never web-served
}

function admin_2fa_load(): ?array
{
    $f = admin_2fa_path();
    if (!is_file($f)) {
        return null;
    }
    $j = json_decode((string) file_get_contents($f), true);
    return is_array($j) ? $j : null;
}

function admin_2fa_save(array $state): bool
{
    $f   = admin_2fa_path();
    $tmp = $f . '.tmp';
    if (file_put_contents($tmp, json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), LOCK_EX) === false) {
        return false;
    }
    @chmod($tmp, 0600);
    return rename($tmp, $f); // atomic replace
}

function admin_2fa_enabled(): bool
{
    $s = admin_2fa_load();
    return is_array($s) && !empty($s['enabled']) && !empty($s['secret']);
}

function admin_2fa_disable(): void
{
    $f = admin_2fa_path();
    if (is_file($f)) {
        @unlink($f);
    }
}

// RFC 4648 base32 (no padding) — TOTP secrets are exchanged in base32.
function base32_encode(string $bin): string
{
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $out = ''; $val = 0; $bits = 0;
    for ($i = 0, $n = strlen($bin); $i < $n; $i++) {
        $val  = ($val << 8) | ord($bin[$i]);
        $bits += 8;
        while ($bits >= 5) {
            $bits -= 5;
            $out  .= $alphabet[($val >> $bits) & 31];
        }
    }
    if ($bits > 0) {
        $out .= $alphabet[($val << (5 - $bits)) & 31];
    }
    return $out;
}

function base32_decode(string $b32): string
{
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $b32 = strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $b32));
    $out = ''; $val = 0; $bits = 0;
    for ($i = 0, $n = strlen($b32); $i < $n; $i++) {
        $idx = strpos($alphabet, $b32[$i]);
        if ($idx === false) {
            continue;
        }
        $val  = ($val << 5) | $idx;
        $bits += 5;
        if ($bits >= 8) {
            $bits -= 8;
            $out  .= chr(($val >> $bits) & 0xFF);
        }
    }
    return $out;
}

function totp_generate_secret(int $bytes = 20): string
{
    return base32_encode(random_bytes($bytes)); // 160-bit, RFC-recommended length
}

function totp_at(string $secretBin, int $counter): string
{
    $msg  = pack('N*', 0) . pack('N*', $counter); // 8-byte big-endian counter
    $hash = hash_hmac('sha1', $msg, $secretBin, true);
    $off  = ord($hash[strlen($hash) - 1]) & 0x0F;
    $bin  = ((ord($hash[$off])     & 0x7F) << 24)
          | ((ord($hash[$off + 1]) & 0xFF) << 16)
          | ((ord($hash[$off + 2]) & 0xFF) << 8)
          |  (ord($hash[$off + 3]) & 0xFF);
    return str_pad((string) ($bin % 1000000), 6, '0', STR_PAD_LEFT);
}

// Verify a 6-digit code against a base32 secret, allowing ±1 step for clock skew.
function totp_verify(string $secretB32, string $code, int $window = 1): bool
{
    $code = preg_replace('/\D/', '', $code);
    if (strlen($code) !== 6) {
        return false;
    }
    $secretBin = base32_decode($secretB32);
    if ($secretBin === '') {
        return false;
    }
    $counter = (int) floor(time() / 30);
    for ($i = -$window; $i <= $window; $i++) {
        if (hash_equals(totp_at($secretBin, $counter + $i), $code)) {
            return true;
        }
    }
    return false;
}

function totp_uri(string $secretB32, string $label, string $issuer): string
{
    return 'otpauth://totp/' . rawurlencode($issuer . ':' . $label)
        . '?secret=' . rawurlencode($secretB32)
        . '&issuer=' . rawurlencode($issuer)
        . '&algorithm=SHA1&digits=6&period=30';
}

// ── One-time recovery codes (hashed at rest, single use) ─────────────────────
function recovery_generate(int $count = 10): array
{
    $codes = [];
    for ($i = 0; $i < $count; $i++) {
        $raw = bin2hex(random_bytes(5));                 // 10 hex chars
        $codes[] = substr($raw, 0, 5) . '-' . substr($raw, 5, 5);
    }
    return $codes;
}

function recovery_hash_all(array $codes): array
{
    return array_map(static fn($c) => password_hash((string) $c, PASSWORD_DEFAULT), $codes);
}

// Check a recovery code against the stored hashes; on match, remove it (single
// use) and persist. Returns true only on a successful, consumed match.
function admin_recovery_consume(string $code): bool
{
    $code  = strtolower(trim($code));
    $state = admin_2fa_load();
    if (!is_array($state) || empty($state['recovery']) || !is_array($state['recovery'])) {
        return false;
    }
    foreach ($state['recovery'] as $i => $hash) {
        if (is_string($hash) && password_verify($code, $hash)) {
            unset($state['recovery'][$i]);
            $state['recovery'] = array_values($state['recovery']);
            admin_2fa_save($state);
            return true;
        }
    }
    return false;
}

// ── Best-effort audit (reuses lib/db.php audit_events; never blocks auth) ─────
function admin_audit(string $action, string $detail = ''): void
{
    try {
        $dbFile = __DIR__ . '/db.php';
        if (is_file($dbFile)) {
            require_once $dbFile;
            if (function_exists('db') && function_exists('audit_event')) {
                audit_event(db(), null, null, $action, $detail);
            }
        }
    } catch (\Throwable $e) {
        error_log('admin_audit failed: ' . $e->getMessage());
    }
}

// ── HTML helpers / shared chrome ─────────────────────────────────────────────
function h($s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

function admin_page_open(string $title, bool $showNav = true): void
{
    $flash = $showNav ? flash_take() : null;

    // Active sidebar item, derived from the running script (no per-page arg needed).
    // Detail pages fold onto their section (account->accounts, trial->trials).
    $cur    = strtolower(basename((string) ($_SERVER['SCRIPT_NAME'] ?? $_SERVER['PHP_SELF'] ?? '')));
    $alias  = ['account.php' => 'accounts.php', 'trial.php' => 'trials.php'];
    $active = $alias[$cur] ?? $cur;
    // Sidebar destinations (the same set the old header admin_nav() carried, now a no-op).
    // Each entry: [file, label, inline-SVG icon body].
    $navItems = [
        ['index.php',         'Dashboard',          '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'],
        ['accounts.php',      'Accounts',           '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M17 6.5a3 3 0 0 1 0 5.6M18.5 20a5 5 0 0 0-3-4.6"/>'],
        ['trials.php',        'Trials',             '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'],
        ['temp.php',          'Temporary licenses', '<path d="M7 3h10M7 21h10M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9"/>'],
        ['subscriptions.php', 'Subscriptions',      '<path d="M21 12a9 9 0 1 1-2.6-6.3M21 4v4h-4"/>'],
        ['products.php',      'Products',           '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>'],
        ['activity.php',      'Activity',           '<path d="M3 12h4l2.5 6 5-13L17 12h4"/>'],
        ['diagnostics.php',   'Diagnostics',        '<path d="M4.5 4.5v6a5 5 0 0 0 5 5 3 3 0 0 0 3-3v-1"/><path d="M8.5 4.5v6M20 13.5a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0z"/>'],
        ['releases.php',      'App releases',       '<path d="M12 3v11M8 10l4 4 4-4M5 20h14"/>'],
    ];
    ?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title><?= h($title) ?> — Scan Finder Licensing</title>
<style>
  /* Self-hosted OFL IBM Plex (woff2 in ./fonts) — NO external font CDN (this console
     must not phone out). Display uses a system serif: the website's Fraunces is not
     bundled server-side, and Georgia carries the same editorial-serif intent fully
     offline. Scan Finder "Warm Archive" palette (paper + ink + burnt amber). */
  @font-face{font-family:'IBM Plex Sans';font-weight:400;font-display:swap;src:url('fonts/IBMPlexSans-400.woff2') format('woff2');}
  @font-face{font-family:'IBM Plex Sans';font-weight:500;font-display:swap;src:url('fonts/IBMPlexSans-500.woff2') format('woff2');}
  @font-face{font-family:'IBM Plex Sans';font-weight:600;font-display:swap;src:url('fonts/IBMPlexSans-600.woff2') format('woff2');}
  @font-face{font-family:'IBM Plex Sans';font-weight:700;font-display:swap;src:url('fonts/IBMPlexSans-700.woff2') format('woff2');}
  @font-face{font-family:'IBM Plex Mono';font-weight:400;font-display:swap;src:url('fonts/IBMPlexMono-400.woff2') format('woff2');}
  @font-face{font-family:'IBM Plex Mono';font-weight:500;font-display:swap;src:url('fonts/IBMPlexMono-500.woff2') format('woff2');}
  :root {
    color-scheme: light;
    --paper:#f6f1e7; --paper-2:#efe7d6; --surface:#fffdf8; --surface2:#faf5ea;
    --ink:#20180f; --ink-soft:#5b4f41; --muted:#8a7d6b; --line:#e2d7c2; --line-2:#d3c4a8;
    --accent:#c2521b; --accent-2:#a23f12; --accent-ink:#fff6ee; --teal:#1f5b54;
    --ok:#2f7d4f; --ok-bg:#e9f4ea; --ok-border:#c2e0c6;
    --warn:#9a5b08; --warn-bg:#fbeeda; --warn-border:#ecd3a2;
    --err:#b23b2e; --err-bg:#fbe7e2; --err-border:#efc3ba;
    --display:Georgia,'Times New Roman',serif;
    --body:'IBM Plex Sans',system-ui,'Segoe UI',sans-serif;
    --mono:'IBM Plex Mono',ui-monospace,Consolas,monospace;
    --r:16px; --r-sm:10px;
    --shadow:0 1px 2px rgba(40,28,14,.05), 0 18px 40px -30px rgba(40,28,14,.5);
    --shadow-lg:0 24px 48px -30px rgba(40,28,14,.55);
    --sb-bg:#211812; --sb-line:#33271b; --sb-text:#e8dcc8; --sb-muted:#a3927b;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink);
         font:14px/1.55 var(--body); -webkit-font-smoothing:antialiased; }
  a { color:var(--accent-2); }
  .admin-shell { display:grid; grid-template-columns:250px 1fr; min-height:100vh; }
  .admin-shell.noside { grid-template-columns:1fr; }

  /* Sidebar (ink) */
  .sidebar { background:var(--sb-bg); color:var(--sb-text); border-right:1px solid var(--sb-line);
    display:flex; flex-direction:column; padding:20px 14px; position:sticky; top:0; height:100vh; }
  .sidebar .brand { display:flex; align-items:center; gap:11px; padding:6px 8px 18px; border-bottom:1px solid var(--sb-line); }
  .sidebar .brand img { width:34px; height:34px; flex:none; display:block; }
  .sidebar .brand .name { font-family:var(--display); font-weight:600; font-size:19px; letter-spacing:-.01em; line-height:1.05; color:#fff; }
  .sidebar .brand .sub { font-family:var(--mono); font-size:9.5px; letter-spacing:.18em; text-transform:uppercase; color:var(--sb-muted); margin-top:3px; }
  .sidebar nav { display:flex; flex-direction:column; gap:2px; margin-top:14px; flex:1; }
  .sidebar nav a { display:flex; align-items:center; gap:11px; padding:9px 11px; border-radius:9px; color:var(--sb-text);
    text-decoration:none; font-weight:500; font-size:13.5px; border-left:3px solid transparent; transition:background .14s, color .14s; }
  .sidebar nav a svg { width:17px; height:17px; flex:none; stroke:currentColor; stroke-width:1.7; fill:none; opacity:.85; }
  .sidebar nav a:hover { background:#2c2116; color:#fff; }
  .sidebar nav a.active { background:#2f2016; color:#fff; border-left-color:var(--accent); }
  .sidebar nav a.active svg { color:var(--accent); opacity:1; }
  .sidebar .spacer { flex:1; }
  .sidebar .foot { border-top:1px solid var(--sb-line); padding-top:10px; margin-top:10px; display:flex; flex-direction:column; gap:2px; }

  /* Content */
  .content { max-width:1180px; padding:30px 40px 72px; }
  .admin-shell.noside .content { max-width:440px; margin:9vh auto 0; padding:0 22px; }
  h1 { font-family:var(--display); font-size:30px; font-weight:600; margin:0 0 6px; letter-spacing:-.015em; }
  h2 { font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:.11em; color:var(--muted); font-weight:500; margin:30px 0 13px; }
  table { width:100%; border-collapse:separate; border-spacing:0; margin:6px 0 4px;
    background:var(--surface); border:1px solid var(--line); border-radius:var(--r); overflow:hidden; box-shadow:var(--shadow); }
  th,td { text-align:left; padding:12px 15px; border-bottom:1px solid var(--line); vertical-align:top; }
  thead th { background:var(--surface2); font-family:var(--mono); font-size:10.5px; text-transform:uppercase;
    letter-spacing:.07em; color:var(--muted); font-weight:500; }
  tbody tr:last-child td { border-bottom:none; }
  tbody tr:hover td { background:var(--surface2); }
  code,.mono { font-family:var(--mono); font-size:12px; }
  .pill { display:inline-block; font-size:11px; font-weight:600; padding:2px 10px; border-radius:999px;
          border:1px solid var(--line-2); background:#f2ead9; color:var(--ink-soft); }
  .pill.ok   { color:var(--ok);   background:var(--ok-bg);   border-color:var(--ok-border); }
  .pill.warn { color:var(--warn); background:var(--warn-bg); border-color:var(--warn-border); }
  .pill.err  { color:var(--err);  background:var(--err-bg);  border-color:var(--err-border); }
  label, .field label { font-size:12px; color:var(--ink); font-weight:600; letter-spacing:0; text-transform:none; }
  input,select { background:#fff; color:var(--ink); border:1px solid var(--line-2);
    border-radius:var(--r-sm); padding:9px 12px; font:inherit; }
  input::placeholder { color:#b3a892; }
  input:focus,select:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(194,82,27,.16); }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:.5rem;
    background:var(--accent); color:var(--accent-ink); border:1px solid transparent;
    border-radius:999px; padding:10px 17px; cursor:pointer; font:600 13.5px/1 var(--body);
    box-shadow:0 10px 22px -14px rgba(162,63,18,.8); transition:transform .16s, box-shadow .16s, background .16s; text-decoration:none; }
  .btn:hover { transform:translateY(-2px); background:var(--accent-2); }
  .btn.secondary { background:transparent; color:var(--ink); border-color:var(--line-2); box-shadow:none; }
  .btn.secondary:hover { background:var(--surface); border-color:var(--accent); color:var(--accent-2); transform:none; }
  .btn.danger { background:transparent; color:var(--err); border-color:var(--err-border); box-shadow:none; }
  .btn.danger:hover { background:var(--err-bg); border-color:var(--err); transform:none; }
  form.inline { display:inline; }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:var(--r);
    padding:20px 22px; box-shadow:var(--shadow); }
  a.card { text-decoration:none; color:inherit; transition:transform .16s, border-color .16s, box-shadow .16s; }
  a.card:hover { transform:translateY(-3px); border-color:var(--line-2); box-shadow:var(--shadow-lg); }
  .row { display:flex; flex-wrap:wrap; gap:14px; align-items:flex-end; }
  .field { display:flex; flex-direction:column; gap:5px; }
  .field small { display:block; margin-top:2px; font-size:12px; line-height:1.4; color:var(--muted); font-weight:400; }
  .flash { padding:12px 16px; border-radius:var(--r-sm); margin:0 0 18px; border:1px solid; box-shadow:var(--shadow); }
  .flash.ok  { background:var(--ok-bg);  border-color:var(--ok-border);  color:#1c5c34; }
  .flash.err { background:var(--err-bg); border-color:var(--err-border); color:#8f271c; }
  /* One-time key success callout */
  .keynote { background:var(--ok-bg); border:1px solid var(--ok-border); border-left:4px solid var(--ok);
    border-radius:var(--r-sm); padding:14px 16px; margin:16px 0; box-shadow:var(--shadow); }
  .keynote .keynote-title { font-weight:700; color:#1c5c34; margin-bottom:6px; }
  .keynote .keynote-key { display:inline-block; font-family:var(--mono); font-size:16px;
    font-weight:600; color:#123f24; background:#fff; border:1px solid var(--ok-border);
    border-radius:7px; padding:6px 12px; letter-spacing:.04em; }
  .keynote .keynote-meta { color:var(--muted); font-size:12px; margin-top:8px; }
  .muted { color:var(--muted); }
  .lead { color:var(--ink-soft); font-size:14.5px; max-width:74ch; }
  .empty { color:var(--muted); padding:14px 2px; }
</style>
</head>
<body>
<div class="admin-shell<?= $showNav ? '' : ' noside' ?>">
<?php if ($showNav): ?>
<aside class="sidebar">
  <div class="brand">
    <img src="assets/logo-mark-dark.svg" alt="Scan Finder" width="34" height="34">
    <div>
      <div class="name">Scan Finder</div>
      <div class="sub">Licensing</div>
    </div>
  </div>
  <nav>
    <?php foreach ($navItems as [$navFile, $navLabel, $navIcon]): ?>
      <a class="<?= $active === $navFile ? 'active' : '' ?>" href="<?= h($navFile) ?>"><svg viewBox="0 0 24 24" aria-hidden="true"><?= $navIcon ?></svg><?= h($navLabel) ?></a>
    <?php endforeach; ?>
    <div class="spacer"></div>
    <div class="foot">
      <a class="<?= $active === '2fa.php' ? 'active' : '' ?>" href="2fa.php"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>Security</a>
      <a href="logout.php"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/></svg>Sign out</a>
    </div>
  </nav>
</aside>
<?php endif; ?>
<main class="content">
<?php if ($flash): ?>
  <div class="flash <?= h($flash['type'] === 'ok' ? 'ok' : 'err') ?>"><?= h($flash['msg']) ?></div>
<?php endif;
}

function admin_page_close(): void
{
    ?>
</main>
</div>
</body>
</html>
<?php
}
