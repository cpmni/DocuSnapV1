<?php
// public/admin/api_activity.php — API activity: what the field apps are doing (2026-09-19; Part C).
// Read-only aggregate over audit_events (each /v1 call writes one row) so the owner can SEE call volume
// per endpoint + over time + top callers, instead of guessing at outages. No key material; IPs + counts
// only (device fingerprints are deliberately NOT shown). Uses idx_action_created / idx_created.
require __DIR__ . '/../../lib/admin_auth.php';
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/admin_view.php';
require_admin();

$pdo = db();

// Human labels for the audit action names the /v1 endpoints write.
$LABELS = [
    'license.validated'       => 'Validate (app launch / refresh)',
    'license.trial_started'   => 'Trial started',
    'license.activated'       => 'Activation',
    'license.activate_failed' => 'Activation failed',
    'license.revoked'         => 'Revoke',
    'license.revoke_failed'   => 'Revoke failed',
];

// Calls per endpoint: 24h + 7d, in one indexed pass over the last 7 days of license.* rows.
$perEndpoint = $pdo->query(
    "SELECT action,
            SUM(created_at >= NOW() - INTERVAL 24 HOUR) AS c24,
            COUNT(*)                                    AS c7d
       FROM audit_events
      WHERE action LIKE 'license.%' AND created_at >= NOW() - INTERVAL 7 DAY
      GROUP BY action
      ORDER BY c7d DESC"
)->fetchAll();

$calls24 = 0; $calls7d = 0;
foreach ($perEndpoint as $r) { $calls24 += (int) $r['c24']; $calls7d += (int) $r['c7d']; }

// Per-hour for the last 24h (small set — one temp-sort is fine).
$perHour = $pdo->query(
    "SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:00') AS hr, COUNT(*) AS n
       FROM audit_events
      WHERE action LIKE 'license.%' AND created_at >= NOW() - INTERVAL 24 HOUR
      GROUP BY hr ORDER BY hr"
)->fetchAll();
$hourMax = 0; foreach ($perHour as $h) { $hourMax = max($hourMax, (int) $h['n']); }

// Top calling IPs (last 24h). Aggregate counts only; no fingerprints.
$topIps = $pdo->query(
    "SELECT ip, COUNT(*) AS n
       FROM audit_events
      WHERE action LIKE 'license.%' AND created_at >= NOW() - INTERVAL 24 HOUR AND ip IS NOT NULL AND ip <> ''
      GROUP BY ip ORDER BY n DESC LIMIT 10"
)->fetchAll();

// Growth indicator (drives the pruning prompt). Approximate total from information_schema — a full
// COUNT(*) would scan the whole (potentially huge) table on EVERY admin page view (Oracle §2); the
// approximation is plenty for a growth signal. MIN(created_at) is index-driven via idx_created; $vOld
// is an exact-action + created_at range so it rides idx_action_created (both bounded, not full scans).
$total   = (int) ($pdo->query("SELECT TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_events'")->fetchColumn() ?: 0);
$oldest  = $pdo->query('SELECT MIN(created_at) FROM audit_events')->fetchColumn() ?: null;
$vOld    = (int) $pdo->query("SELECT COUNT(*) FROM audit_events WHERE action = 'license.validated' AND created_at < NOW() - INTERVAL 90 DAY")->fetchColumn();

admin_page_open('API activity');
admin_nav('api_activity');
admin_page_head('activity', 'API activity', 'What the field apps are calling — per endpoint, over time, and who by. Read-only.');
admin_chips([
    ['n' => $calls24, 'l' => 'calls (24h)'],
    ['n' => $calls7d, 'l' => 'calls (7d)'],
    ['n' => $total,   'l' => 'audit rows', 'tone' => $total > 500000 ? 'warn' : ''],
]);
?>
<p class="lead">Every <span class="mono">/v1</span> call writes one audit row; the app calls <strong>validate</strong> once per launch. 429s (rate-limited) are not counted here.</p>

<h3 style="margin:18px 0 8px;">Calls per endpoint</h3>
<?php if (!$perEndpoint): ?>
  <div class="empty">No API activity in the last 7 days.</div>
<?php else: ?>
<table>
  <thead><tr><th>Endpoint</th><th style="width:140px;">Last 24h</th><th style="width:140px;">Last 7 days</th></tr></thead>
  <tbody>
  <?php foreach ($perEndpoint as $r): ?>
    <tr>
      <td><?= h($LABELS[$r['action']] ?? $r['action']) ?> <span class="mono muted" style="font-size:11px;">(<?= h($r['action']) ?>)</span></td>
      <td class="mono"><?= (int) $r['c24'] ?></td>
      <td class="mono"><?= (int) $r['c7d'] ?></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php endif; ?>

<h3 style="margin:22px 0 8px;">Last 24 hours, by hour</h3>
<?php if (!$perHour): ?>
  <div class="empty">No calls in the last 24 hours.</div>
<?php else: ?>
<table>
  <thead><tr><th style="width:170px;">Hour</th><th>Calls</th></tr></thead>
  <tbody>
  <?php foreach ($perHour as $hh): $n = (int) $hh['n']; $w = $hourMax ? max(2, (int) round($n / $hourMax * 100)) : 0; ?>
    <tr>
      <td class="mono muted"><?= h($hh['hr']) ?></td>
      <td>
        <span style="display:inline-block; height:11px; width:<?= $w ?>%; min-width:2px; background:var(--accent); border-radius:3px; vertical-align:middle;"></span>
        <span class="mono" style="margin-left:8px;"><?= $n ?></span>
      </td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php endif; ?>

<h3 style="margin:22px 0 8px;">Top calling IPs (last 24h)</h3>
<?php if (!$topIps): ?>
  <div class="empty">No IP data in the last 24 hours.</div>
<?php else: ?>
<table>
  <thead><tr><th>IP address</th><th style="width:120px;">Calls</th></tr></thead>
  <tbody>
  <?php foreach ($topIps as $ipr): ?>
    <tr><td class="mono"><?= h($ipr['ip']) ?></td><td class="mono"><?= (int) $ipr['n'] ?></td></tr>
  <?php endforeach; ?>
  </tbody>
</table>
<p class="muted" style="font-size:12px; margin-top:6px;">A single office behind one NAT shows as one IP with many calls &mdash; not necessarily abuse.</p>
<?php endif; ?>

<h3 style="margin:22px 0 8px;">Table growth</h3>
<p class="muted">
  <strong>~<?= number_format($total) ?></strong> audit rows (approx)<?= $oldest ? ', oldest ' . h($oldest) : '' ?>.
  <?php if ($vOld > 0): ?>
    <br><?= number_format($vOld) ?> are <strong>validate</strong> rows older than 90 days &mdash; prune them with
    <span class="mono">scripts/prune_audit_events.php --apply</span> (keeps all activations, revokes, trials and failures). This bounds the table so the licensing site stays fast.
  <?php else: ?>
    <br>No old validate rows to prune yet.
  <?php endif; ?>
</p>
<?php admin_page_close();
