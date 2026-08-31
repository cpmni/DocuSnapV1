<?php
// public/admin/activity.php — full licence audit trail (read-only). Part of the
// multi-page admin split. Audit detail never contains key material; the dashboard shows
// only a recent teaser, this is the deeper feed.
require __DIR__ . '/../../lib/admin_auth.php';
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/admin_actions.php';
require __DIR__ . '/../../lib/admin_view.php';
require_admin();

$pdo = db();
admin_handle_post($pdo);   // read-only page; the dispatcher no-ops on GET

$activity = $pdo->query(
    "SELECT action, detail, created_at FROM audit_events
     WHERE action LIKE 'license.%' OR action LIKE 'admin.%' OR action LIKE 'webhook.%'
     ORDER BY id DESC LIMIT 200"
)->fetchAll();

admin_page_open('Activity');
admin_nav('activity');
?>
<?php admin_page_head('activity', 'Activity', 'Every licence, admin and webhook event — newest first.'); ?>
<p class="lead">Audit trail of licence actions. Activation keys are never recorded.</p>
<?php if (!$activity): ?>
  <div class="empty">No activity recorded yet.</div>
<?php else: ?>
<table>
  <thead><tr><th style="width:170px;">When</th><th style="width:230px;">Action</th><th>Detail</th></tr></thead>
  <tbody>
  <?php foreach ($activity as $ev): ?>
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
