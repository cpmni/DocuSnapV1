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
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    session_name('LICADMIN');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => $https,
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

function admin_is_authed(): bool
{
    return !empty($_SESSION['admin_authed']);
}

function admin_login(string $password): bool
{
    $hash = admin_password_hash();
    if ($hash === null) {
        return false; // not provisioned -> deny
    }
    if (!password_verify($password, $hash)) {
        return false;
    }
    session_regenerate_id(true); // prevent fixation
    $_SESSION['admin_authed'] = true;
    return true;
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
    if (!admin_is_authed()) {
        header('Location: login.php');
        exit;
    }
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

// ── HTML helpers / shared chrome ─────────────────────────────────────────────
function h($s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

function admin_page_open(string $title, bool $showNav = true): void
{
    $flash = $showNav ? flash_take() : null;
    ?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title><?= h($title) ?> — Licensing Admin</title>
<style>
  /* Bright-only theme — this admin page never uses a dark palette and has no
     theme toggle. Colors are fixed light values (no prefers-color-scheme). */
  :root {
    color-scheme: light;
    --bg:#eef1f7; --surface:#ffffff; --surface2:#f5f8fd;
    --border:#e2e7f1; --border2:#cfd7e6;
    --accent:#2f6fed; --accent-weak:#eaf1fe; --accent-ink:#1d4ed8;
    --text:#1b2333; --muted:#5b6678;
    --ok:#15803d; --ok-bg:#e9f8ef; --ok-border:#bfe6cd;
    --warn:#9a5b08; --warn-bg:#fdf2e0; --warn-border:#f1d8aa;
    --err:#c0392b; --err-bg:#fdecea; --err-border:#f3c5bf;
    --shadow:0 1px 2px rgba(22,33,60,.04), 0 1px 3px rgba(22,33,60,.08);
    --shadow-lg:0 4px 12px rgba(22,33,60,.10);
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
         font:14px/1.55 system-ui,'Segoe UI',Roboto,sans-serif; }
  header.topbar { display:flex; align-items:center; justify-content:space-between;
    padding:14px 28px; background:var(--surface); border-bottom:1px solid var(--border); box-shadow:var(--shadow); }
  header.topbar .brand { font-weight:700; letter-spacing:.01em; color:var(--text); }
  header.topbar nav a { color:var(--muted); text-decoration:none; margin-left:18px; font-weight:500; }
  header.topbar nav a:hover { color:var(--accent); }
  main { max-width:1040px; margin:0 auto; padding:26px 24px 72px; }
  h1 { font-size:22px; font-weight:700; margin:0 0 6px; letter-spacing:-.01em; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.09em; color:var(--muted);
       font-weight:700; margin:30px 0 12px; }
  table { width:100%; border-collapse:separate; border-spacing:0; margin:6px 0 4px;
    background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; box-shadow:var(--shadow); }
  th,td { text-align:left; padding:11px 14px; border-bottom:1px solid var(--border); vertical-align:top; }
  thead th { background:var(--surface2); font-size:11px; text-transform:uppercase;
    letter-spacing:.06em; color:var(--muted); font-weight:600; }
  tbody tr:last-child td { border-bottom:none; }
  tbody tr:hover td { background:var(--surface2); }
  code,.mono { font-family:ui-monospace,Consolas,monospace; font-size:12px; }
  a { color:var(--accent-ink); }
  .pill { display:inline-block; font-size:11px; font-weight:600; padding:2px 10px; border-radius:999px;
          border:1px solid var(--border2); background:#f1f4fa; color:var(--muted); }
  .pill.ok   { color:var(--ok);   background:var(--ok-bg);   border-color:var(--ok-border); }
  .pill.warn { color:var(--warn); background:var(--warn-bg); border-color:var(--warn-border); }
  .pill.err  { color:var(--err);  background:var(--err-bg);  border-color:var(--err-border); }
  label, .field label { font-size:12px; color:var(--text); font-weight:600; letter-spacing:0; text-transform:none; }
  input,select { background:#fff; color:var(--text); border:1px solid var(--border2);
    border-radius:7px; padding:8px 11px; font:inherit; }
  input::placeholder { color:#9aa3b5; }
  input:focus,select:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-weak); }
  .btn { background:var(--accent); color:#fff; border:1px solid var(--accent);
    border-radius:8px; padding:9px 15px; cursor:pointer; font:inherit; font-weight:600; box-shadow:var(--shadow); }
  .btn:hover { background:var(--accent-ink); border-color:var(--accent-ink); }
  .btn.secondary { background:#fff; color:var(--text); border-color:var(--border2); box-shadow:none; }
  .btn.secondary:hover { border-color:var(--accent); color:var(--accent-ink); background:var(--accent-weak); }
  .btn.danger { background:#fff; color:var(--err); border-color:var(--err-border); box-shadow:none; }
  .btn.danger:hover { background:var(--err-bg); border-color:var(--err); }
  form.inline { display:inline; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:12px;
    padding:20px 22px; box-shadow:var(--shadow); }
  .row { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; }
  .field { display:flex; flex-direction:column; gap:5px; }
  .field small { display:block; margin-top:2px; font-size:12px; line-height:1.4; color:var(--muted); font-weight:400; }
  .flash { padding:12px 16px; border-radius:10px; margin:16px 0; border:1px solid; box-shadow:var(--shadow); }
  .flash.ok  { background:var(--ok-bg);  border-color:var(--ok-border);  color:#0f5c2e; }
  .flash.err { background:var(--err-bg); border-color:var(--err-border); color:#992017; }
  /* One-time key success callout */
  .keynote { background:var(--ok-bg); border:1px solid var(--ok-border); border-left:4px solid var(--ok);
    border-radius:10px; padding:14px 16px; margin:16px 0; box-shadow:var(--shadow); }
  .keynote .keynote-title { font-weight:700; color:#0f5c2e; margin-bottom:6px; }
  .keynote .keynote-key { display:inline-block; font-family:ui-monospace,Consolas,monospace; font-size:16px;
    font-weight:600; color:#0b3d20; background:#fff; border:1px solid var(--ok-border);
    border-radius:7px; padding:6px 12px; letter-spacing:.04em; }
  .keynote .keynote-meta { color:var(--muted); font-size:12px; margin-top:8px; }
  .muted { color:var(--muted); }
  .lead { color:var(--muted); font-size:14px; max-width:70ch; }
  .empty { color:var(--muted); padding:14px 2px; }
</style>
</head>
<body>
<?php if ($showNav): ?>
<header class="topbar">
  <span class="brand">Licensing Admin</span>
  <nav>
    <a href="index.php">Dashboard</a>
    <a href="logout.php">Sign out</a>
  </nav>
</header>
<?php endif; ?>
<main>
<?php if ($flash): ?>
  <div class="flash <?= h($flash['type'] === 'ok' ? 'ok' : 'err') ?>"><?= h($flash['msg']) ?></div>
<?php endif;
}

function admin_page_close(): void
{
    ?>
</main>
</body>
</html>
<?php
}
