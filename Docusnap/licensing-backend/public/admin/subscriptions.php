<?php
// public/admin/subscriptions.php — ACCOUNTS that have Polar-managed (subscription-backed)
// entitlements. One row per account with a seat summary; click through to the account page to
// see and manage its individual subscriptions. Keeps subscriptions OUT of the Temporary
// licences view (which is admin-created time-limited keys only).
require __DIR__ . '/../../lib/admin_auth.php';
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/admin_view.php';
require_admin();

$pdo = db();

$rows = $pdo->query(
    'SELECT a.id, COALESCE(NULLIF(a.name, ""), a.email) AS who, a.email,
        COUNT(*) AS sub_count,
        SUM(CASE WHEN e.feature = "search"   THEN e.seats_total ELSE 0 END)             AS f_search,
        SUM(CASE WHEN e.feature = "workflow" THEN e.seats_total ELSE 0 END)             AS f_workflow,
        SUM(CASE WHEN e.feature = "core" OR e.feature IS NULL THEN e.seats_total ELSE 0 END) AS f_core,
        MIN(e.expires_at) AS next_renewal
     FROM entitlements e JOIN accounts a ON a.id = e.account_id
     WHERE e.polar_ref IS NOT NULL AND e.status = "active"
     GROUP BY a.id, a.name, a.email
     ORDER BY a.id DESC
     LIMIT 500'
)->fetchAll();

admin_page_open('Subscriptions');
admin_nav('subs');
?>
<h1>Subscriptions</h1>
<p class="muted" style="max-width:780px;">Accounts with active Polar subscriptions — one row per account. Click an account to see and manage its individual subscriptions. Seats are the sum across the account's subscriptions; change them by editing or cancelling the customer's subscription in Polar (a cancellation revokes the matching rows automatically).</p>

<?php if (!$rows): ?>
  <div class="empty">No accounts have active subscriptions yet.</div>
<?php else: ?>
<table>
  <thead><tr>
    <th>ID</th><th>Customer / Company</th><th>Subs</th>
    <th>Seats — core &middot; clients &middot; workflow</th><th>Next renewal / end</th><th></th>
  </tr></thead>
  <tbody>
  <?php foreach ($rows as $r): ?>
    <tr data-href="account.php?account=<?= (int) $r['id'] ?>">
      <td class="mono">#<?= (int) $r['id'] ?></td>
      <td><strong><?= $r['who'] ? h($r['who']) : '<span class="muted" style="font-weight:400;">(unnamed)</span>' ?></strong>
        <?php if (!empty($r['email']) && $r['email'] !== $r['who']): ?><br><span class="mono muted" style="font-size:11px;"><?= h($r['email']) ?></span><?php endif; ?></td>
      <td class="mono"><?= (int) $r['sub_count'] ?></td>
      <td class="mono"><?= (int) $r['f_core'] ?> &middot; <?= (int) $r['f_search'] ?> &middot; <?= (int) $r['f_workflow'] ?></td>
      <td class="mono muted"><?= $r['next_renewal'] ? h($r['next_renewal']) : 'never' ?></td>
      <td><a href="account.php?account=<?= (int) $r['id'] ?>">View &rarr;</a></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php endif; ?>
<?php admin_page_close();
