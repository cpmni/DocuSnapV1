<?php
// public/admin/2fa.php — enable / manage TOTP two-factor auth for the admin.
// Admin-only (require_admin), CSRF-protected, server-validated. The secret and
// hashed recovery codes live in keys/admin_2fa.json (outside the docroot).
require __DIR__ . '/../../lib/admin_auth.php';
require_admin();

$ISSUER = 'DocuSnap Licensing';
$LABEL  = 'admin';

$enabled      = admin_2fa_enabled();
$showCodes    = null;   // plaintext recovery codes, shown exactly once after enable
$showSetup    = isset($_GET['setup']);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_check()) {
        flash_set('err', 'Security check failed. Please try again.');
        header('Location: 2fa.php');
        exit;
    }
    $action = (string) ($_POST['action'] ?? '');

    if ($action === 'enable_confirm' && !$enabled) {
        // Confirm setup: the candidate secret was generated server-side and held
        // in the session; a valid code proves the authenticator is configured.
        $candidate = (string) ($_SESSION['admin_2fa_candidate'] ?? '');
        $code      = (string) ($_POST['code'] ?? '');
        if ($candidate === '') {
            flash_set('err', 'Setup expired. Please start again.');
            header('Location: 2fa.php?setup=1');
            exit;
        }
        if (!totp_verify($candidate, $code)) {
            usleep(300000);
            flash_set('err', 'That code did not match. Try again.');
            header('Location: 2fa.php?setup=1');
            exit;
        }
        // Verified — generate recovery codes, persist enabled state (secret +
        // hashed recovery codes), and show the codes once.
        $codes = recovery_generate(10);
        $ok = admin_2fa_save([
            'enabled'    => true,
            'secret'     => $candidate,
            'recovery'   => recovery_hash_all($codes),
            'created_at' => gmdate('c'),
        ]);
        unset($_SESSION['admin_2fa_candidate']);
        if (!$ok) {
            flash_set('err', 'Could not save 2FA settings (check keys/ is writable).');
            header('Location: 2fa.php');
            exit;
        }
        admin_audit('admin.2fa_enabled', '');
        $enabled   = true;
        $showCodes = $codes;   // render once below; never stored in plaintext
    } elseif ($action === 'disable' && $enabled) {
        // Disable requires BOTH the current password and a valid current TOTP.
        $pw   = (string) ($_POST['password'] ?? '');
        $code = (string) ($_POST['code'] ?? '');
        $hash = admin_password_hash();
        $state = admin_2fa_load();
        $okPw = $hash !== null && password_verify($pw, $hash);
        $okOt = is_array($state) && !empty($state['secret']) && totp_verify((string) $state['secret'], $code);
        if (!$okPw || !$okOt) {
            usleep(400000);
            flash_set('err', 'Password or authentication code was incorrect. 2FA is still on.');
            header('Location: 2fa.php');
            exit;
        }
        admin_2fa_disable();
        admin_audit('admin.2fa_disabled', '');
        flash_set('ok', 'Two-factor authentication has been disabled.');
        header('Location: 2fa.php');
        exit;
    }
}

// Generate (and remember for this setup session) a candidate secret for the
// enable screen.
$candidate = '';
if ($showSetup && !$enabled) {
    $candidate = (string) ($_SESSION['admin_2fa_candidate'] ?? '');
    if ($candidate === '') {
        $candidate = totp_generate_secret();
        $_SESSION['admin_2fa_candidate'] = $candidate;
    }
}

$qrFile = __DIR__ . '/qrcode.min.js';
$hasQr  = is_file($qrFile);

admin_page_open('Security');
?>
<h1>Two-factor authentication</h1>
<p class="lead">An authenticator-app code (TOTP) is required on sign-in, in addition to the admin password.</p>

<?php if ($showCodes !== null): ?>
  <div class="keynote">
    <div class="keynote-title">2FA is now ON — save your recovery codes</div>
    <p class="keynote-meta">Each code works <strong>once</strong> if you lose your authenticator. They are shown
       only now and stored hashed — they cannot be retrieved later.</p>
    <p style="margin:10px 0; display:flex; flex-wrap:wrap; gap:8px;">
      <?php foreach ($showCodes as $c): ?>
        <span class="keynote-key" style="font-size:14px;"><?= h($c) ?></span>
      <?php endforeach; ?>
    </p>
    <a class="btn" href="2fa.php">I've saved them</a>
  </div>

<?php elseif ($enabled): ?>
  <p><span class="pill ok">Enabled</span></p>
  <div class="card" style="max-width:420px; margin-top:14px;">
    <h2 style="margin-top:0;">Disable / reset 2FA</h2>
    <p class="muted">Requires your current password and a current authenticator code.</p>
    <form method="post" action="2fa.php">
      <?= csrf_field() ?>
      <input type="hidden" name="action" value="disable">
      <div class="field" style="margin-bottom:10px;">
        <label for="password">Admin password</label>
        <input type="password" id="password" name="password" autocomplete="current-password" required>
      </div>
      <div class="field" style="margin-bottom:12px;">
        <label for="code">Authenticator code</label>
        <input type="text" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required>
      </div>
      <button class="btn danger" type="submit">Disable 2FA</button>
    </form>
  </div>

<?php elseif ($showSetup): ?>
  <p><span class="pill warn">Disabled</span> — setting up</p>
  <div class="card" style="max-width:480px; margin-top:14px;">
    <h2 style="margin-top:0;">1 · Add to your authenticator app</h2>
    <?php $uri = totp_uri($candidate, $LABEL, $ISSUER); ?>
    <?php if ($hasQr): ?>
      <div id="qrcode" style="margin:8px 0;"></div>
      <script src="qrcode.min.js"></script>
      <script>new QRCode(document.getElementById('qrcode'), { text: <?= json_encode($uri) ?>, width: 200, height: 200 });</script>
    <?php else: ?>
      <p class="muted">Scan the QR by adding an MIT <code>qrcode.min.js</code> to <code>public/admin/</code>,
         or use manual entry below — both work.</p>
    <?php endif; ?>
    <p style="margin:10px 0;">Manual entry key:<br>
      <span class="keynote-key"><?= h($candidate) ?></span></p>
    <p class="muted" style="word-break:break-all;">Setup URI: <code><?= h($uri) ?></code></p>

    <h2>2 · Confirm a code</h2>
    <form method="post" action="2fa.php">
      <?= csrf_field() ?>
      <input type="hidden" name="action" value="enable_confirm">
      <div class="field" style="margin-bottom:12px;">
        <label for="code">6-digit code</label>
        <input type="text" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" autofocus required>
      </div>
      <button class="btn" type="submit">Enable 2FA</button>
      <a class="btn secondary" href="2fa.php" style="margin-left:8px;">Cancel</a>
    </form>
  </div>

<?php else: ?>
  <p><span class="pill warn">Disabled</span></p>
  <div class="card" style="max-width:420px; margin-top:14px;">
    <p>Protect this admin portal with an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis, etc.).</p>
    <a class="btn" href="2fa.php?setup=1">Enable 2FA</a>
  </div>
<?php endif; ?>
<?php
admin_page_close();
