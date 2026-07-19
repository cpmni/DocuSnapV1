<?php
// public/admin/index.php — admin landing dashboard for the licensing backend. At-a-glance
// counts + common-task cards + a recent-activity teaser; the section pages (accounts /
// account / trials / temp / products / activity) do the actual management. Shares the
// admin chrome (lib/admin_auth.php), the POST dispatcher (lib/admin_actions.php) and the
// view helpers + nav (lib/admin_view.php). Never displays key material.
require __DIR__ . '/../../lib/admin_auth.php';
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/admin_actions.php';
require __DIR__ . '/../../lib/admin_view.php';
require_admin();

$pdo = db();

// Write actions (POST -> redirect -> GET) — shared dispatcher (lib/admin_actions.php).
admin_handle_post($pdo);

// ── Dashboard summary (counts + a short activity teaser; no key material) ──────
$accountsTotal = (int) $pdo->query('SELECT COUNT(*) FROM accounts')->fetchColumn();
$trialsActive  = (int) $pdo->query(
    'SELECT COUNT(*) FROM device_registrations WHERE trial_start IS NOT NULL AND trial_end > NOW()'
)->fetchColumn();
$expiringSoon  = (int) $pdo->query(
    "SELECT COUNT(*) FROM entitlements
     WHERE expires_at IS NOT NULL AND status = 'active'
       AND expires_at > NOW() AND expires_at <= (NOW() + INTERVAL 7 DAY)"
)->fetchColumn();
$recent = $pdo->query(
    "SELECT action, detail, created_at FROM audit_events
     WHERE action LIKE 'license.%' OR action LIKE 'admin.%' OR action LIKE 'webhook.%'
     ORDER BY id DESC LIMIT 5"
)->fetchAll();

// SEC-06 health check (Oracle O1): the /v1 limiter FAILS OPEN, so a missing
// rate_limits table silently disables every /v1 throttle (trial farming, key
// guessing). Surface it here so V4 is a one-glance check. (The ADMIN limiter is
// unaffected — it fails CLOSED, so on a mis-migrated host you'd notice at login.)
$rateLimiterOk = false;
try {
    $rateLimiterOk = $pdo->query("SHOW TABLES LIKE 'rate_limits'")->fetchColumn() !== false;
} catch (\Throwable $e) { /* leave false — the warning below says what to do */ }

admin_page_open('Dashboard');
admin_nav('index');
?>
<h1>License management</h1>
<p class="lead">Overview of accounts, trials and temporary licences. Use the cards below or the
   top navigation to manage each area. Activation keys are shown once at creation and are
   never stored or displayed again.</p>

<?php if (!$rateLimiterOk): ?>
  <div class="flash err"><strong>Rate limiting is OFF:</strong> the <code>rate_limits</code> table is
    missing, so every /v1 throttle (trial caps, key-guess protection) is silently inert. Import
    <code>schema.sql</code> on this host to enable it.</div>
<?php endif; ?>

<!-- ── At-a-glance counts ───────────────────────────────────────────────── -->
<div class="row" style="gap:14px; flex-wrap:wrap; margin:6px 0 20px;">
  <a class="card" href="accounts.php" style="flex:1; min-width:170px; text-decoration:none;">
    <div class="muted">Accounts</div>
    <div style="font-size:28px; font-weight:600;"><?= $accountsTotal ?></div>
  </a>
  <a class="card" href="trials.php" style="flex:1; min-width:170px; text-decoration:none;">
    <div class="muted">Active trials</div>
    <div style="font-size:28px; font-weight:600;"><?= $trialsActive ?></div>
  </a>
  <a class="card" href="temp.php" style="flex:1; min-width:170px; text-decoration:none;">
    <div class="muted">Temp licences expiring ≤7 days</div>
    <div style="font-size:28px; font-weight:600;"><?= $expiringSoon ?></div>
  </a>
</div>

<!-- ── Common tasks ─────────────────────────────────────────────────────── -->
<h2>Common tasks</h2>
<div class="row" style="gap:14px; flex-wrap:wrap; margin-bottom:22px;">
  <div class="card" style="flex:1; min-width:230px;">
    <strong>Issue or upgrade a licence</strong>
    <div class="muted" style="margin:4px 0 10px;">Find an account and set its core / search / workflow seats. Adding seats is additive — the customer's key is unchanged.</div>
    <a class="btn" href="accounts.php">Go to Accounts</a>
  </div>
  <div class="card" style="flex:1; min-width:230px;">
    <strong>Create a temporary licence</strong>
    <div class="muted" style="margin:4px 0 10px;">Mint a time-limited key for an evaluation or pilot. The key is shown once.</div>
    <a class="btn" href="temp.php">New temporary licence</a>
  </div>
  <div class="card" style="flex:1; min-width:230px;">
    <strong>Review trials</strong>
    <div class="muted" style="margin:4px 0 10px;">See who's on the in-app 14-day trial; extend or revoke a device.</div>
    <a class="btn secondary" href="trials.php">Go to Trials</a>
  </div>
</div>

<!-- ── Recent activity (teaser) ─────────────────────────────────────────── -->
<h2 style="display:flex; align-items:center; gap:10px;">Recent activity
  <a class="btn secondary" style="font-size:12px;" href="activity.php">View all</a>
</h2>
<?php if (!$recent): ?>
  <div class="empty">No activity recorded yet.</div>
<?php else: ?>
<table>
  <thead><tr><th style="width:170px;">When</th><th style="width:230px;">Action</th><th>Detail</th></tr></thead>
  <tbody>
  <?php foreach ($recent as $ev): ?>
    <tr>
      <td class="mono muted"><?= h($ev['created_at']) ?></td>
      <td class="mono"><?= h($ev['action']) ?></td>
      <td class="muted"><?= h($ev['detail'] ?? '') ?></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php endif; ?>
<?php admin_page_close();
