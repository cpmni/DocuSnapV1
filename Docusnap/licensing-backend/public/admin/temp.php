<?php
// public/admin/temp.php — temporary (time-limited) licences: create + list + extend/
// revoke. Part of the multi-page admin split. The one-time key callout renders HERE
// because create_temp_license redirects here. Keys are shown once, stored only as a hash.
require __DIR__ . '/../../lib/admin_auth.php';
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/admin_actions.php';
require __DIR__ . '/../../lib/admin_view.php';
require_admin();

$pdo = db();
admin_handle_post($pdo);

$allProducts = $pdo->query('SELECT product_id, name_internal FROM products ORDER BY name_internal')->fetchAll();

// Temporary / time-limited licences = any entitlement that carries an expiry.
// Admin temporary licences ONLY: an expiring entitlement that is NOT a Polar subscription
// (polar_ref IS NULL). Polar subs also carry an expiry (their period end) but belong on the
// account / a Subscriptions view, not here. Name falls back to the account name.
$tempLicenses = $pdo->query(
    'SELECT e.id, e.account_id, e.product_id, p.name_internal, e.seats_total, e.expires_at, e.status,
        COALESCE(NULLIF(e.customer_name, ""), a.name) AS customer_name, e.device_label, e.customer_email, e.notes,
        (SELECT COUNT(*) FROM seats s WHERE s.entitlement_id = e.id AND s.status = "bound") AS seats_used
     FROM entitlements e
       LEFT JOIN products p ON p.product_id = e.product_id
       LEFT JOIN accounts a ON a.id = e.account_id
     WHERE e.expires_at IS NOT NULL AND e.polar_ref IS NULL ORDER BY e.id DESC LIMIT 200'
)->fetchAll();

admin_page_open('Temporary licenses');
admin_nav('temp');
?>
<?php
$tmp_total = count($tempLicenses);
$tmp_active = 0; $tmp_soon = 0;
foreach ($tempLicenses as $t) {
    if ($t['status'] !== 'revoked') {
        $tl = temp_days_left($t['expires_at']);
        if ($tl > 0) { $tmp_active++; if ($tl <= 7) $tmp_soon++; }
    }
}
admin_page_head('temp', 'Temporary Licenses', 'Time-limited keys — create one below, then extend or revoke as needed.');
admin_chips([
    ['n' => $tmp_total,  'l' => 'total'],
    ['n' => $tmp_active, 'l' => 'active',      'tone' => 'ok'],
    ['n' => $tmp_soon,   'l' => 'expiring 7d', 'tone' => 'warn'],
]);
?>
<?php
// One-time key callout — shown once, immediately after creation, then cleared.
$issued = $_SESSION['issued_key'] ?? null;
unset($_SESSION['issued_key']);
if ($issued):
?>
<div class="keynote">
  <div class="keynote-title">✓ New license key — copy it now</div>
  <span class="keynote-key"><?= h($issued['key']) ?></span>
  <div class="keynote-meta"><?= h($issued['meta']) ?> · this key will not be shown again.</div>
</div>
<?php endif; ?>
<p class="muted">
  Time-limited keys (any entitlement with an expiry) — separate from the perpetual
  paid-seat flow and the in-app 14-day customer trial. Creating one mints a new
  account + key for the chosen product, valid for the chosen window (default 14
  days) with 1 seat. The key is shown <strong>once</strong> on creation and stored
  only as a hash. The desktop activates with it like any paid key and is allowed in
  until it expires or is revoked.
</p>

<details style="margin-bottom:16px;">
  <summary style="cursor:pointer; font-weight:600; color:var(--accent-ink); padding:8px 0;">+ Create a temporary license</summary>
<div class="card" style="margin:8px 0 0; max-width:720px;">
  <p class="muted" style="margin:0 0 4px; font-size:13px;">Generates a new key valid for the chosen period (default 14 days), with one device seat. The key appears once below after you create it.</p>
  <form method="post" action="temp.php"
        style="margin-top:14px; display:grid; grid-template-columns:1fr 1fr; gap:16px;">
    <?= csrf_field() ?>
    <input type="hidden" name="action" value="create_temp_license">
    <div class="field" style="grid-column:1 / -1;">
      <label for="tl_customer">Customer or company name</label>
      <input type="text" id="tl_customer" name="customer_name" maxlength="190" required
             placeholder="e.g. ACME Ltd or Jane Smith">
      <small>Shown in the license manager to help identify this license.</small>
    </div>
    <div class="field">
      <label for="tl_product">Product</label>
      <select id="tl_product" name="product_id" required>
        <option value="">Choose…</option>
        <?php foreach ($allProducts as $p): ?>
          <option value="<?= h($p['product_id']) ?>"><?= h($p['name_internal']) ?></option>
        <?php endforeach; ?>
      </select>
      <small>Select the product or plan this license applies to.</small>
    </div>
    <div class="field">
      <label for="tl_days">License period (days)</label>
      <input type="number" id="tl_days" name="days" min="1" max="3650" value="14" required>
      <small>How long this temporary license should stay active.</small>
    </div>
    <div class="field">
      <label for="tl_label">Customer device name</label>
      <input type="text" id="tl_label" name="device_label" maxlength="120" placeholder="e.g. Reception PC">
      <small>Optional. Helps identify the device this license is tied to.</small>
    </div>
    <div class="field">
      <label for="tl_email">Customer email</label>
      <input type="email" id="tl_email" name="customer_email" maxlength="190" placeholder="name@company.com">
      <small>Optional. Used for support and expiry reminders only.</small>
    </div>
    <div class="field" style="grid-column:1 / -1;">
      <label for="tl_notes">Notes</label>
      <input type="text" id="tl_notes" name="notes" maxlength="2000" placeholder="e.g. Pilot for ACME Ltd">
      <small>Internal use only.</small>
    </div>
    <div style="grid-column:1 / -1;">
      <button class="btn" type="submit">Create 14-day license</button>
    </div>
  </form>
</div>
</details>

<?php if (!$tempLicenses): ?>
  <div class="empty">No temporary licenses yet.</div>
<?php else: ?>
<table>
  <thead><tr><th>Lic #</th><th>Customer / Company</th><th>Product</th><th>Account</th><th>Expiry</th><th>Remaining</th><th>Seats</th><th>State</th><th>Actions</th></tr></thead>
  <tbody>
  <?php foreach ($tempLicenses as $t): $left = temp_days_left($t['expires_at']); ?>
    <tr>
      <td class="mono">#<?= (int) $t['id'] ?></td>
      <td>
        <strong><?= $t['customer_name'] ? h($t['customer_name']) : '<span class="muted" style="font-weight:400;">(unnamed)</span>' ?></strong>
        <?php if ($t['device_label']): ?><br><span class="muted"><?= h($t['device_label']) ?></span><?php endif; ?>
        <?php if ($t['customer_email']): ?><br><span class="muted mono"><?= h($t['customer_email']) ?></span><?php endif; ?>
        <?php if ($t['notes']): ?><br><span class="muted" title="<?= h($t['notes']) ?>">note: <?= h(mb_strimwidth((string) $t['notes'], 0, 32, '…')) ?></span><?php endif; ?>
      </td>
      <td><?= h($t['name_internal'] ?? '(unknown)') ?></td>
      <td class="mono"><a href="account.php?account=<?= (int) $t['account_id'] ?>">#<?= (int) $t['account_id'] ?></a></td>
      <td class="mono muted"><?= h($t['expires_at']) ?></td>
      <td class="mono"><?= $t['status'] === 'revoked' ? '—' : $left . ' day(s)' ?></td>
      <td class="mono"><?= (int) $t['seats_used'] ?> / <?= (int) $t['seats_total'] ?></td>
      <td><?= ent_state_pill($t) ?></td>
      <td>
        <?php if ($t['status'] !== 'revoked'): ?>
        <form method="post" action="temp.php" class="inline" style="margin-right:6px;">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="extend_temp_license">
          <input type="hidden" name="entitlement_id" value="<?= (int) $t['id'] ?>">
          <input type="number" name="days" min="1" max="3650" value="14" style="width:64px;" title="Days to add">
          <button class="btn secondary" type="submit">Extend expiry</button>
        </form>
        <form method="post" action="temp.php" class="inline"
              onsubmit="return confirm('Revoke temporary license #<?= (int) $t['id'] ?> now? The bound device locks on its next online check.');">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="revoke_entitlement">
          <input type="hidden" name="entitlement_id" value="<?= (int) $t['id'] ?>">
          <button class="btn danger" type="submit">Revoke license</button>
        </form>
        <?php endif; ?>
      </td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php endif; ?>
<?php admin_page_close();
