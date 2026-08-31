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
<?php
// ── Dashboard presentation helpers (friendly label, relative time, event colour) ──
$actLabel = [
    'license.activate' => 'Licence activated', 'license.revoke' => 'Licence revoked',
    'license.validate' => 'Licence validated', 'license.status' => 'Status checked',
    'trial.start' => 'Trial started', 'trial.extend' => 'Trial extended',
    'admin.login_success' => 'Admin signed in', 'admin.login_failed' => 'Failed sign-in',
    'admin.login_throttled' => 'Sign-in throttled', 'admin.login_refused' => 'Sign-in refused',
    'admin.recovery_used' => 'Recovery code used',
];
$relTime = static function (?string $ts): string {
    if (!$ts) return '';
    $t = strtotime($ts);
    if ($t === false) return $ts;
    $d = time() - $t;
    if ($d < 60)     return 'just now';
    if ($d < 3600)   return (int) floor($d / 60) . ' min ago';
    if ($d < 86400)  return (int) floor($d / 3600) . ' h ago';
    if ($d < 172800) return 'yesterday';
    return (int) floor($d / 86400) . ' d ago';
};
$actKind = static function (string $a): array {   // [dot-class, icon-svg-inner]
    if (str_contains($a, 'revoke') || str_contains($a, 'fail') || str_contains($a, 'refused'))
        return ['err', '<path d="M6 6l12 12M18 6L6 18"/>'];
    if (str_contains($a, 'activate') || str_contains($a, 'success') || str_contains($a, 'validate'))
        return ['ok', '<path d="M5 13l4 4L19 7"/>'];
    if (str_contains($a, 'trial'))
        return ['warn', '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/>'];
    return ['neutral', '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/>'];
};
?>
<style>
  :root { --accent-weak:#f6e6d7; --teal-weak:#e2ede9; }
  .dash .hero { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; flex-wrap:wrap; }
  .dash .hero h1 { margin-bottom:5px; }
  .health { display:inline-flex; align-items:center; gap:7px; font-size:12px; font-weight:600; padding:6px 12px; border-radius:999px; border:1px solid; white-space:nowrap; }
  .health.ok  { background:var(--ok-bg);  color:var(--ok);  border-color:var(--ok-border); }
  .health.err { background:var(--err-bg); color:var(--err); border-color:var(--err-border); }
  .health .hdot { width:7px; height:7px; border-radius:50%; background:currentColor; }
  .tiles { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
  .tile { position:relative; background:var(--surface); border:1px solid var(--line); border-radius:var(--r); padding:18px 20px; box-shadow:var(--shadow); text-decoration:none; color:inherit; display:flex; flex-direction:column; gap:7px; transition:transform .16s, border-color .16s, box-shadow .16s; }
  .tile:hover { transform:translateY(-3px); border-color:var(--line-2); box-shadow:var(--shadow-lg); }
  .tile .ic { width:36px; height:36px; border-radius:11px; display:grid; place-items:center; background:var(--teal-weak); color:var(--teal); }
  .tile .ic svg { width:19px; height:19px; stroke:currentColor; stroke-width:1.8; fill:none; }
  .tile .v { font-family:var(--display); font-size:34px; font-weight:600; letter-spacing:-.02em; line-height:1; }
  .tile .k { font-weight:600; font-size:13.5px; }
  .tile .ctx { color:var(--muted); font-size:12px; }
  .tile .go { position:absolute; top:16px; right:16px; color:var(--muted); font-size:16px; opacity:0; transition:opacity .16s; }
  .tile:hover .go { opacity:1; }
  .tile.warn .ic { background:var(--warn-bg); color:var(--warn); }
  .tile.warn .v { color:var(--warn); }
  .actions { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
  .qa { background:var(--surface); border:1px solid var(--line); border-radius:var(--r); padding:18px 20px; box-shadow:var(--shadow); display:flex; flex-direction:column; gap:10px; }
  .qa .ic { width:36px; height:36px; border-radius:11px; display:grid; place-items:center; background:var(--accent-weak); color:var(--accent); }
  .qa .ic svg { width:19px; height:19px; stroke:currentColor; stroke-width:1.8; fill:none; }
  .qa h3 { font-family:var(--display); font-size:16px; font-weight:600; margin:0; }
  .qa p { margin:0; color:var(--ink-soft); font-size:13px; flex:1; }
  .qa .btn { align-self:flex-start; }
  .feed { background:var(--surface); border:1px solid var(--line); border-radius:var(--r); box-shadow:var(--shadow); overflow:hidden; }
  .feed .item { display:flex; gap:13px; align-items:center; padding:12px 16px; border-bottom:1px solid var(--line); }
  .feed .item:last-child { border-bottom:0; }
  .feed .dt { width:30px; height:30px; border-radius:50%; flex:none; display:grid; place-items:center; }
  .feed .dt svg { width:15px; height:15px; stroke:currentColor; stroke-width:2; fill:none; }
  .feed .dt.ok { background:var(--ok-bg); color:var(--ok); }
  .feed .dt.err { background:var(--err-bg); color:var(--err); }
  .feed .dt.warn { background:var(--warn-bg); color:var(--warn); }
  .feed .dt.neutral { background:var(--surface2); color:var(--muted); }
  .feed .bd { flex:1; min-width:0; }
  .feed .act { font-weight:600; font-size:13px; }
  .feed .det { color:var(--muted); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .feed .rt { color:var(--muted); font-family:var(--mono); font-size:11.5px; white-space:nowrap; }
  .h2row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  @media (max-width:920px) { .tiles, .actions { grid-template-columns:1fr; } }
</style>

<div class="dash">
<div class="hero">
  <div>
    <h1>License management</h1>
    <p class="lead">Everything at a glance. Pick a task below, or jump to a section on the left.
       Activation keys are shown once at creation and are never stored or displayed again.</p>
  </div>
  <?php if ($rateLimiterOk): ?>
    <span class="health ok"><span class="hdot"></span>All systems normal</span>
  <?php else: ?>
    <span class="health err"><span class="hdot"></span>Rate limiting OFF</span>
  <?php endif; ?>
</div>

<?php if (!$rateLimiterOk): ?>
  <div class="flash err" style="margin-top:16px;"><strong>Rate limiting is OFF:</strong> the <code>rate_limits</code> table is
    missing, so every /v1 throttle (trial caps, key-guess protection) is silently inert. Import
    <code>schema.sql</code> on this host to enable it.</div>
<?php endif; ?>

<h2>At a glance</h2>
<div class="tiles">
  <a class="tile" href="accounts.php">
    <div class="ic"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M17 6.5a3 3 0 0 1 0 5.6M18.5 20a5 5 0 0 0-3-4.6"/></svg></div>
    <div class="v"><?= $accountsTotal ?></div>
    <div class="k">Accounts</div>
    <div class="ctx">Customers with a licence on file</div>
    <span class="go">&rarr;</span>
  </a>
  <a class="tile" href="trials.php">
    <div class="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg></div>
    <div class="v"><?= $trialsActive ?></div>
    <div class="k">Active trials</div>
    <div class="ctx">On the in-app 14-day trial right now</div>
    <span class="go">&rarr;</span>
  </a>
  <a class="tile<?= $expiringSoon > 0 ? ' warn' : '' ?>" href="temp.php">
    <div class="ic"><svg viewBox="0 0 24 24"><path d="M7 3h10M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9"/></svg></div>
    <div class="v"><?= $expiringSoon ?></div>
    <div class="k">Temp licences expiring</div>
    <div class="ctx">Within the next 7 days<?= $expiringSoon > 0 ? ' &middot; review soon' : '' ?></div>
    <span class="go">&rarr;</span>
  </a>
</div>

<h2>Common tasks</h2>
<div class="actions">
  <div class="qa">
    <div class="ic"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10"/></svg></div>
    <h3>Issue or upgrade a licence</h3>
    <p>Find an account and set its core / search / workflow seats. Adding seats is additive &mdash; the customer's key is unchanged.</p>
    <a class="btn" href="accounts.php">Go to Accounts</a>
  </div>
  <div class="qa">
    <div class="ic"><svg viewBox="0 0 24 24"><path d="M7 3h10M7 21h10M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9"/></svg></div>
    <h3>Create a temporary licence</h3>
    <p>Mint a time-limited key for an evaluation or pilot. The key is shown once, so copy it there and then.</p>
    <a class="btn" href="temp.php">New temporary licence</a>
  </div>
  <div class="qa">
    <div class="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg></div>
    <h3>Review trials</h3>
    <p>See who's on the 14-day trial, and extend or revoke a device when you need to.</p>
    <a class="btn secondary" href="trials.php">Go to Trials</a>
  </div>
</div>

<div class="h2row"><h2 style="margin-bottom:0;">Recent activity</h2><a class="btn secondary" style="font-size:12px; padding:6px 12px;" href="activity.php">View all &rarr;</a></div>
<?php if (!$recent): ?>
  <div class="empty" style="margin-top:13px;">No activity recorded yet.</div>
<?php else: ?>
<div class="feed" style="margin-top:13px;">
  <?php foreach ($recent as $ev):
      [$kind, $icon] = $actKind((string) $ev['action']);
      $lbl = $actLabel[$ev['action']] ?? (string) $ev['action']; ?>
    <div class="item">
      <div class="dt <?= $kind ?>"><svg viewBox="0 0 24 24"><?= $icon ?></svg></div>
      <div class="bd">
        <div class="act"><?= h($lbl) ?></div>
        <div class="det"><?= h($ev['detail'] ?? '') ?></div>
      </div>
      <div class="rt"><?= h($relTime($ev['created_at'] ?? null)) ?></div>
    </div>
  <?php endforeach; ?>
</div>
<?php endif; ?>
</div>
<?php admin_page_close();
