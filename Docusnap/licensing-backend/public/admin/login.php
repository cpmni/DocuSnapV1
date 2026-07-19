<?php
// public/admin/login.php — admin sign-in for the licensing web admin.
// Two stages: (1) password, then (2) a TOTP / recovery-code challenge when 2FA
// is enabled. The session is only promoted to authenticated (admin_authed) after
// the challenge passes — see lib/admin_auth.php.
require __DIR__ . '/../../lib/admin_auth.php';
admin_session_boot();

if (admin_is_authed()) {
    header('Location: index.php');
    exit;
}

// "Start over" link on the 2FA step abandons the pending challenge.
if (isset($_GET['cancel'])) {
    unset($_SESSION['admin_2fa_pending'], $_SESSION['admin_2fa_tries'], $_SESSION['admin_2fa_started']);
    header('Location: login.php');
    exit;
}

// Surface a one-shot flash (e.g. the inactivity-timeout message from
// require_admin); the login chrome renders with showNav=false, which otherwise
// skips flashes. A POST error below takes precedence.
$flash = flash_take();
$err   = ($flash && ($flash['type'] ?? '') === 'err') ? (string) $flash['msg'] : null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_check()) {
        $err = 'Security check failed. Please try again.';
    } elseif (!empty($_SESSION['admin_2fa_pending'])) {
        // Stage 2 — TOTP or one-time recovery code. The PERSISTED throttle runs
        // BEFORE any verification (SEC-01): the session 5-try cap alone could be
        // reset with a fresh cookie jar + a re-POST of the (known) password.
        $retry = admin_throttle('2fa');
        if ($retry !== null) {
            $err = 'Too many attempts. Try again in ' . max(1, (int) ceil($retry / 60)) . ' minute(s).';
        } elseif (!admin_2fa_pending_active()) {
            // The password→code window expired; pending state is now cleared.
            $err = 'That sign-in timed out. Please sign in again.';
        } elseif (admin_complete_2fa((string) ($_POST['code'] ?? ''))) {
            header('Location: index.php');
            exit;
        } else {
            usleep(400000); // constant-ish delay to blunt guessing
            if ((int) ($_SESSION['admin_2fa_tries'] ?? 0) >= ADMIN_2FA_MAX_TRIES) {
                unset($_SESSION['admin_2fa_pending'], $_SESSION['admin_2fa_tries'], $_SESSION['admin_2fa_started']);
                $err = 'Too many incorrect codes. Please sign in again.';
            } else {
                $err = 'Invalid authentication code.';
            }
        }
    } else {
        // Stage 1 — password. Throttle BEFORE verifying anything (SEC-01: the old
        // 0.4s usleep was the only brake — no counter survived the request).
        $retry = admin_throttle('pw');
        if ($retry !== null) {
            $err = 'Too many attempts. Try again in ' . max(1, (int) ceil($retry / 60)) . ' minute(s).';
        } else {
            $status = admin_login((string) ($_POST['password'] ?? ''));
            if ($status === 'ok') {
                header('Location: index.php');
                exit;
            }
            if ($status === 'fail') {
                usleep(400000);
                $err = 'Incorrect password.';
            }
            if ($status === 'no_2fa') {
                // Correct password, but 2FA is mandatory and unprovisioned (SEC-01
                // fail-closed). First-run path: set LICENSING_ADMIN_ALLOW_NO_2FA=1,
                // sign in, provision 2FA under Security, then REMOVE the env.
                $err = 'Two-factor authentication is required but not yet set up. '
                     . 'Set the LICENSING_ADMIN_ALLOW_NO_2FA=1 environment variable temporarily, '
                     . 'sign in, enable 2FA under Security, then remove the variable.';
            }
            // 'need_2fa' → fall through and render the challenge below.
        }
    }
}

$stage       = admin_2fa_pending_active() ? '2fa' : 'password';
$provisioned = admin_password_hash() !== null;

admin_page_open('Sign in', false);
?>
<h1>Licensing Admin</h1>
<p class="muted">Administrative access only.</p>

<?php if ($err): ?>
  <div class="flash err"><?= h($err) ?></div>
<?php endif; ?>

<?php if (!$provisioned): ?>
  <div class="flash err">
    No admin password is configured. Set one outside the web root, then reload:
    <br><code>keys/admin_password.hash</code> (a PHP <code>password_hash()</code> bcrypt string),
    or the <code>LICENSING_ADMIN_PASSWORD_HASH</code> environment variable.
  </div>
<?php elseif ($stage === '2fa'): ?>
  <div class="card" style="max-width:360px; margin-top:14px;">
    <form method="post" action="login.php">
      <?= csrf_field() ?>
      <div class="field" style="margin-bottom:12px;">
        <label for="code">Authentication code</label>
        <input type="text" id="code" name="code" inputmode="numeric" autocomplete="one-time-code"
               autofocus required pattern="[0-9A-Za-z\- ]+">
        <small>Enter the 6-digit code from your authenticator app, or a one-time recovery code.</small>
      </div>
      <button class="btn" type="submit">Verify</button>
      <a class="btn secondary" href="login.php?cancel=1" style="margin-left:8px;">Start over</a>
    </form>
  </div>
<?php else: ?>
  <div class="card" style="max-width:360px; margin-top:14px;">
    <form method="post" action="login.php">
      <?= csrf_field() ?>
      <div class="field" style="margin-bottom:12px;">
        <label for="password">Admin password</label>
        <input type="password" id="password" name="password" autocomplete="current-password" autofocus required>
      </div>
      <button class="btn" type="submit">Sign in</button>
    </form>
  </div>
<?php endif; ?>
<?php
admin_page_close();
