<?php
// public/admin/login.php — admin sign-in for the licensing web admin.
require __DIR__ . '/../../lib/admin_auth.php';
admin_session_boot();

if (admin_is_authed()) {
    header('Location: index.php');
    exit;
}

$err = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_check()) {
        $err = 'Security check failed. Please try again.';
    } elseif (admin_login((string) ($_POST['password'] ?? ''))) {
        header('Location: index.php');
        exit;
    } else {
        usleep(400000); // small constant delay to blunt guessing
        $err = 'Incorrect password.';
    }
}

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
