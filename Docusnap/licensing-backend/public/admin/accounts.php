<?php
// public/admin/accounts.php — accounts list + search. Part of the multi-page admin split.
// Clicking an account opens its own detail page (account.php). No key material exposed.
require __DIR__ . '/../../lib/admin_auth.php';
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/admin_actions.php';
require __DIR__ . '/../../lib/admin_view.php';
require_admin();

$pdo = db();
admin_handle_post($pdo);

$aq      = trim((string) ($_GET['aq'] ?? ''));        // account id search
$astatus = trim((string) ($_GET['astatus'] ?? ''));   // account status filter

// Accounts list with aggregate seat usage (no key material exposed). A derived
// customer_name (from the most recent named entitlement) makes each account
// identifiable, and from_trial flags an account whose bound device started as an
// in-app trial (its seat fp_hash matches a trial device_registration), so a
// converted trial is visibly distinct from a directly-issued account.
$accSql = 'SELECT a.id, a.status,
    (SELECT e.customer_name FROM entitlements e
        WHERE e.account_id = a.id AND e.customer_name IS NOT NULL AND e.customer_name <> ""
        ORDER BY (e.status = "active") DESC, e.id DESC LIMIT 1) AS customer_name,
    (SELECT COUNT(*) FROM seats s JOIN entitlements e ON e.id = s.entitlement_id
        JOIN device_registrations d ON d.fp_hash = s.fp_hash AND d.trial_start IS NOT NULL
        WHERE e.account_id = a.id) AS from_trial,
    (SELECT COUNT(*) FROM entitlements e WHERE e.account_id = a.id AND e.status = "active") AS ent_active,
    (SELECT COALESCE(SUM(e.seats_total),0) FROM entitlements e WHERE e.account_id = a.id AND e.status = "active") AS seats_total,
    (SELECT COUNT(*) FROM seats s JOIN entitlements e ON e.id = s.entitlement_id
        WHERE e.account_id = a.id AND s.status = "bound") AS seats_used
  FROM accounts a';
$where = [];
$args  = [];
if ($aq !== '' && ctype_digit($aq)) { $where[] = 'a.id = ?'; $args[] = (int) $aq; }
if ($astatus !== '' && in_array($astatus, ['active', 'suspended', 'disabled'], true)) {
    $where[] = 'a.status = ?'; $args[] = $astatus;
}
if ($where) $accSql .= ' WHERE ' . implode(' AND ', $where);
$accSql .= ' ORDER BY from_trial DESC, a.id LIMIT 500';
$st = $pdo->prepare($accSql);
$st->execute($args);
$accounts = $st->fetchAll();

admin_page_open('Accounts');
admin_nav('accounts');
?>
<h1>Accounts</h1>
<form method="get" action="accounts.php" class="row" style="margin-bottom:6px;">
  <div class="field">
    <label for="aq">Account ID</label>
    <input type="text" id="aq" name="aq" value="<?= h($aq) ?>" placeholder="e.g. 1" inputmode="numeric">
  </div>
  <div class="field">
    <label for="astatus">Status</label>
    <select id="astatus" name="astatus">
      <option value="">Any</option>
      <?php foreach (['active', 'suspended', 'disabled'] as $s): ?>
        <option value="<?= $s ?>" <?= $astatus === $s ? 'selected' : '' ?>><?= $s ?></option>
      <?php endforeach; ?>
    </select>
  </div>
  <button class="btn secondary" type="submit">Search</button>
  <?php if ($aq !== '' || $astatus !== ''): ?><a class="btn secondary" href="accounts.php">Clear</a><?php endif; ?>
</form>
<?php if (!$accounts): ?>
  <div class="empty">No accounts found.</div>
<?php else: ?>
<table>
  <thead><tr><th>ID</th><th>Customer / Company</th><th>Origin</th><th>Status</th><th>Active entitlements</th><th>Seats used / total</th><th></th></tr></thead>
  <tbody>
  <?php foreach ($accounts as $a): ?>
    <tr data-href="account.php?account=<?= (int) $a['id'] ?>">
      <td class="mono">#<?= (int) $a['id'] ?></td>
      <td><strong><?= $a['customer_name'] ? h($a['customer_name']) : '<span class="muted" style="font-weight:400;">(unnamed)</span>' ?></strong></td>
      <td><?= (int) $a['from_trial'] > 0 ? '<span class="pill warn">from trial</span>' : '<span class="muted">direct</span>' ?></td>
      <td><span class="pill <?= $a['status'] === 'active' ? 'ok' : 'warn' ?>"><?= h($a['status']) ?></span></td>
      <td><?= (int) $a['ent_active'] ?></td>
      <td class="mono"><?= (int) $a['seats_used'] ?> / <?= (int) $a['seats_total'] ?></td>
      <td><a href="account.php?account=<?= (int) $a['id'] ?>">View &rarr;</a></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php admin_row_links(); ?>
<?php endif; ?>
<?php admin_page_close();
