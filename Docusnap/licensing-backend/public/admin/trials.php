<?php
// public/admin/trials.php — in-app 14-day device trials: list + extend/revoke. Part of
// the multi-page admin split; the extend_trial/revoke_trial actions run through the
// shared dispatcher (lib/admin_actions.php) and redirect back here. No key material shown.
require __DIR__ . '/../../lib/admin_auth.php';
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/admin_actions.php';
require __DIR__ . '/../../lib/admin_view.php';
require_admin();

$pdo = db();
admin_handle_post($pdo);

// In-app 14-day trials = device_registrations that carry a trial window. Newer
// rows carry the captured customer identity; pre-capture rows may show blanks.
// is_active drives the "on trial now" count. No tokens/secrets are selected.
$trials = $pdo->query(
    'SELECT d.id, d.product_id, p.name_internal, d.trial_start, d.trial_end,
            d.customer_name, d.contact_name, d.email,
            (d.trial_end > NOW()) AS is_active,
            CONCAT(SUBSTRING(d.fp_hash, 1, 10), "…") AS fp_short
     FROM device_registrations d LEFT JOIN products p ON p.product_id = d.product_id
     WHERE d.trial_start IS NOT NULL
     ORDER BY is_active DESC, d.trial_start DESC LIMIT 500'
)->fetchAll();
$trialsActive = 0;
foreach ($trials as $t) { if ((int) $t['is_active'] === 1) { $trialsActive++; } }

admin_page_open('Trials');
admin_nav('trials');
?>
<h1>Trial Licenses
  <span class="pill ok" style="font-size:12px; vertical-align:middle;"><?= (int) $trialsActive ?> active</span>
  <span class="pill" style="font-size:12px; vertical-align:middle;"><?= count($trials) ?> total</span>
</h1>
<p class="muted">
  In-app 14-day free trials, one device-bound row each, captured at trial start and
  resumed (never reset) when the device returns. Active trials are listed first.
  Click a row to see the trial's full details and whether the device has activated a paid licence.
</p>
<?php if (!$trials): ?>
  <div class="empty">No trials started yet.</div>
<?php else: ?>
<table>
  <thead><tr>
    <th>Customer / Company</th><th>User</th><th>Email</th>
    <th>Product</th><th>Trial start</th><th>Expiry</th><th>Remaining</th><th>Device</th><th>State</th><th>Actions</th>
  </tr></thead>
  <tbody>
  <?php foreach ($trials as $t): $active = (int) $t['is_active'] === 1; $left = temp_days_left($t['trial_end']); ?>
    <tr data-href="trial.php?id=<?= (int) $t['id'] ?>">
      <td><strong><?= $t['customer_name'] ? h($t['customer_name']) : '<span class="muted" style="font-weight:400;">(not captured)</span>' ?></strong></td>
      <td><?= $t['contact_name'] ? h($t['contact_name']) : '<span class="muted">—</span>' ?></td>
      <td class="mono"><?= $t['email'] ? h($t['email']) : '<span class="muted">—</span>' ?></td>
      <td><?= h($t['name_internal'] ?? '(unknown)') ?></td>
      <td class="mono muted"><?= h($t['trial_start']) ?></td>
      <td class="mono muted"><?= h($t['trial_end']) ?></td>
      <td class="mono"><?= $active ? $left . ' day(s)' : '—' ?></td>
      <td class="mono muted" title="device fingerprint (truncated)"><?= h($t['fp_short']) ?></td>
      <td><?= $active ? '<span class="pill ok">active</span>' : '<span class="pill">expired</span>' ?></td>
      <td>
        <form method="post" action="trials.php" class="inline" style="margin-right:6px;">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="extend_trial">
          <input type="hidden" name="trial_id" value="<?= (int) $t['id'] ?>">
          <input type="number" name="days" min="1" max="3650" value="14" style="width:60px;" title="Days to add">
          <button class="btn secondary" type="submit">Extend</button>
        </form>
        <?php if ($active): ?>
        <form method="post" action="trials.php" class="inline"
              onsubmit="return confirm('Revoke trial #<?= (int) $t['id'] ?> now? It will no longer count as active. The device cannot restart this trial.');">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="revoke_trial">
          <input type="hidden" name="trial_id" value="<?= (int) $t['id'] ?>">
          <button class="btn danger" type="submit">Revoke</button>
        </form>
        <?php endif; ?>
      </td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php admin_row_links(); ?>
<?php endif; ?>
<?php admin_page_close();
