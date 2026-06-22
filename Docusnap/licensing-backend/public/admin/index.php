<?php
// public/admin/index.php — admin dashboard for the licensing backend.
// Read-only screens (products / accounts / entitlements / seats) plus explicit,
// CSRF-protected, server-validated write actions (create/revoke entitlement,
// revoke seat). Reuses the existing PDO connection, schema and audit helper.
// Never displays account_key_hash or any plaintext key.
require __DIR__ . '/../../lib/admin_auth.php';
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/admin_actions.php';
require __DIR__ . '/../../lib/admin_view.php';
require_admin();

$pdo = db();

// Write actions (POST -> redirect -> GET) — shared dispatcher (lib/admin_actions.php).
admin_handle_post($pdo);

// ── Read queries (GET) ───────────────────────────────────────────────────────
$aq      = trim((string) ($_GET['aq'] ?? ''));        // account id search
$astatus = trim((string) ($_GET['astatus'] ?? ''));   // account status filter
$account = filter_input(INPUT_GET, 'account', FILTER_VALIDATE_INT); // selected account

// Products list for the create-temp + set-features dropdowns (search lives on products.php).
$allProducts = $pdo->query('SELECT product_id, name_internal FROM products ORDER BY name_internal')->fetchAll();

// Accounts list with aggregate seat usage (no key material exposed)
$accSql = 'SELECT a.id, a.status,
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
$accSql .= ' ORDER BY a.id LIMIT 500';
$st = $pdo->prepare($accSql);
$st->execute($args);
$accounts = $st->fetchAll();

// Temporary / time-limited licences = any entitlement that carries an expiry.
$tempLicenses = $pdo->query(
    'SELECT e.id, e.account_id, e.product_id, p.name_internal, e.seats_total, e.expires_at, e.status,
        e.customer_name, e.device_label, e.customer_email, e.notes,
        (SELECT COUNT(*) FROM seats s WHERE s.entitlement_id = e.id AND s.status = "bound") AS seats_used
     FROM entitlements e LEFT JOIN products p ON p.product_id = e.product_id
     WHERE e.expires_at IS NOT NULL ORDER BY e.id DESC LIMIT 200'
)->fetchAll();

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

// Selected account detail
$selAccount = null;
$entitlements = [];
$seatsByEnt = [];
if ($account) {
    $st = $pdo->prepare('SELECT id, status FROM accounts WHERE id = ?');
    $st->execute([$account]);
    $selAccount = $st->fetch();
    if ($selAccount) {
        $st = $pdo->prepare('SELECT e.id, e.product_id, e.feature, p.name_internal, e.seats_total, e.expires_at, e.status,
            (SELECT COUNT(*) FROM seats s WHERE s.entitlement_id = e.id AND s.status = "bound") AS seats_used
          FROM entitlements e LEFT JOIN products p ON p.product_id = e.product_id
          WHERE e.account_id = ? ORDER BY e.feature, e.id');
        $st->execute([$account]);
        $entitlements = $st->fetchAll();

        if ($entitlements) {
            $st = $pdo->prepare('SELECT id, entitlement_id, device_label, bound_at, released_at, status,
                CASE WHEN fp_hash IS NULL THEN NULL ELSE CONCAT(SUBSTRING(fp_hash,1,10),"…") END AS fp_short
              FROM seats WHERE entitlement_id = ? ORDER BY id');
            foreach ($entitlements as $e) {
                $st->execute([$e['id']]);
                $seatsByEnt[$e['id']] = $st->fetchAll();
            }
        }
    }
}


admin_page_open('Dashboard');
?>
<h1>License management</h1>
<p class="lead">Issue and manage temporary licenses, review accounts, and track activity.
   Activation keys are shown once at creation and are never stored or displayed again.</p>

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

<?php admin_nav('index'); ?>

<!-- ── TRIALS (in-app 14-day) ───────────────────────────────────────────── -->
<h2 id="trials">Trial Licenses
  <span class="pill ok" style="font-size:12px; vertical-align:middle;"><?= (int) $trialsActive ?> active</span>
  <span class="pill" style="font-size:12px; vertical-align:middle;"><?= count($trials) ?> total</span>
</h2>
<p class="muted">
  In-app 14-day free trials, one device-bound row each, captured at trial start and
  resumed (never reset) when the device returns. Active trials are listed first.
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
    <tr>
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
        <form method="post" action="index.php" class="inline" style="margin-right:6px;">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="extend_trial">
          <input type="hidden" name="trial_id" value="<?= (int) $t['id'] ?>">
          <input type="number" name="days" min="1" max="3650" value="14" style="width:60px;" title="Days to add">
          <button class="btn secondary" type="submit">Extend</button>
        </form>
        <?php if ($active): ?>
        <form method="post" action="index.php" class="inline"
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
<?php endif; ?>

<!-- ── ACCOUNTS ─────────────────────────────────────────────────────────── -->
<h2 id="accounts">Accounts</h2>
<form method="get" action="index.php" class="row" style="margin-bottom:6px;">
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
  <?php if ($aq !== '' || $astatus !== ''): ?><a class="btn secondary" href="index.php">Clear</a><?php endif; ?>
</form>
<?php if (!$accounts): ?>
  <div class="empty">No accounts found.</div>
<?php else: ?>
<table>
  <thead><tr><th>ID</th><th>Status</th><th>Active entitlements</th><th>Seats used / total</th><th></th></tr></thead>
  <tbody>
  <?php foreach ($accounts as $a): ?>
    <tr>
      <td class="mono">#<?= (int) $a['id'] ?></td>
      <td><span class="pill <?= $a['status'] === 'active' ? 'ok' : 'warn' ?>"><?= h($a['status']) ?></span></td>
      <td><?= (int) $a['ent_active'] ?></td>
      <td class="mono"><?= (int) $a['seats_used'] ?> / <?= (int) $a['seats_total'] ?></td>
      <td><a href="index.php?account=<?= (int) $a['id'] ?>">View &rarr;</a></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php endif; ?>

<!-- ── TEMPORARY LICENSES ───────────────────────────────────────────────── -->
<h2 id="temp">Temporary Licenses</h2>
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
  <form method="post" action="index.php"
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
      <td class="mono"><a href="index.php?account=<?= (int) $t['account_id'] ?>">#<?= (int) $t['account_id'] ?></a></td>
      <td class="mono muted"><?= h($t['expires_at']) ?></td>
      <td class="mono"><?= $t['status'] === 'revoked' ? '—' : $left . ' day(s)' ?></td>
      <td class="mono"><?= (int) $t['seats_used'] ?> / <?= (int) $t['seats_total'] ?></td>
      <td><?= ent_state_pill($t) ?></td>
      <td>
        <?php if ($t['status'] !== 'revoked'): ?>
        <form method="post" action="index.php" class="inline" style="margin-right:6px;">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="extend_temp_license">
          <input type="hidden" name="entitlement_id" value="<?= (int) $t['id'] ?>">
          <input type="number" name="days" min="1" max="3650" value="14" style="width:64px;" title="Days to add">
          <button class="btn secondary" type="submit">Extend expiry</button>
        </form>
        <form method="post" action="index.php" class="inline"
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

<!-- ── ACCOUNT DETAIL ───────────────────────────────────────────────────── -->
<?php if ($account && !$selAccount): ?>
  <h2>Account #<?= (int) $account ?></h2>
  <div class="empty">That account does not exist.</div>
<?php elseif ($selAccount): ?>
  <h2>Account #<?= (int) $selAccount['id'] ?>
      <span class="pill <?= $selAccount['status'] === 'active' ? 'ok' : 'warn' ?>"><?= h($selAccount['status']) ?></span>
  </h2>

  <?php if (!$entitlements): ?>
    <div class="empty">No entitlements yet for this account.</div>
  <?php else: foreach ($entitlements as $e): $seats = $seatsByEnt[$e['id']] ?? []; ?>
    <div class="card" style="margin-bottom:14px;">
      <div class="row" style="justify-content:space-between; align-items:flex-start;">
        <div>
          <strong>Entitlement #<?= (int) $e['id'] ?></strong> &nbsp;
          <span class="pill"><?= h($e['feature'] ?? 'core') ?></span> &nbsp; <?= ent_state_pill($e) ?><br>
          <span class="muted">Product:</span> <?= h($e['name_internal'] ?? '(unknown)') ?>
          <span class="mono muted">(<?= h($e['product_id']) ?>)</span><br>
          <span class="muted"><?= ($e['feature'] ?? 'core') === 'core' ? 'Seats (bound/total):' : 'Capacity:' ?></span>
          <span class="mono"><?= ($e['feature'] ?? 'core') === 'core' ? ((int) $e['seats_used'] . ' / ' . (int) $e['seats_total']) : (int) $e['seats_total'] ?></span>
          &nbsp;·&nbsp; <span class="muted">Expires:</span> <?= $e['expires_at'] ? h($e['expires_at']) : 'never' ?>
        </div>
        <?php if ($e['status'] !== 'revoked'): ?>
        <form method="post" action="index.php" class="inline"
              onsubmit="return confirm('Revoke entitlement #<?= (int) $e['id'] ?> and release its seats?');">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="revoke_entitlement">
          <input type="hidden" name="entitlement_id" value="<?= (int) $e['id'] ?>">
          <input type="hidden" name="account_id" value="<?= (int) $selAccount['id'] ?>">
          <button class="btn danger" type="submit">Revoke entitlement</button>
        </form>
        <?php endif; ?>
      </div>

      <?php if ($seats): ?>
      <table style="margin-top:12px;">
        <thead><tr><th>Seat</th><th>State</th><th>Device</th><th>Fingerprint</th><th>Bound</th><th>Released</th><th></th></tr></thead>
        <tbody>
        <?php foreach ($seats as $s): ?>
          <tr>
            <td class="mono">#<?= (int) $s['id'] ?></td>
            <td><?= seat_state_pill((string) $s['status']) ?></td>
            <td><?= $s['device_label'] ? h($s['device_label']) : '<span class="muted">—</span>' ?></td>
            <td class="mono muted"><?= $s['fp_short'] ? h($s['fp_short']) : '—' ?></td>
            <td class="mono muted"><?= $s['bound_at'] ? h($s['bound_at']) : '—' ?></td>
            <td class="mono muted"><?= $s['released_at'] ? h($s['released_at']) : '—' ?></td>
            <td>
              <?php if ($s['status'] === 'bound'): ?>
              <form method="post" action="index.php" class="inline"
                    onsubmit="return confirm('Release seat #<?= (int) $s['id'] ?>?');">
                <?= csrf_field() ?>
                <input type="hidden" name="action" value="revoke_seat">
                <input type="hidden" name="seat_id" value="<?= (int) $s['id'] ?>">
                <input type="hidden" name="account_id" value="<?= (int) $selAccount['id'] ?>">
                <button class="btn danger" type="submit">Release</button>
              </form>
              <?php endif; ?>
            </td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
      <?php else: ?>
        <div class="empty">No seats provisioned under this entitlement yet.</div>
      <?php endif; ?>
    </div>
  <?php endforeach; endif; ?>

  <!-- Set licensed features (issue + upgrade in one step) -->
  <div class="card" style="margin-top:6px;">
    <strong>Set licensed features</strong>
    <div class="muted" style="margin:4px 0 8px; max-width:640px;">Core binds the install seat; <strong>search</strong> and <strong>workflow</strong> are capacity counts the desktop enforces for connected clients. Workflow cannot exceed search. Setting a feature to 0 retires it. Additive — the account key is unchanged, so the desktop picks up new counts on its next online check.</div>
    <form method="post" action="index.php" class="row" style="margin-top:6px;">
      <?= csrf_field() ?>
      <input type="hidden" name="action" value="set_account_features">
      <input type="hidden" name="account_id" value="<?= (int) $selAccount['id'] ?>">
      <div class="field">
        <label for="product_id">Product</label>
        <select id="product_id" name="product_id" required>
          <option value="">Choose…</option>
          <?php foreach ($allProducts as $p): ?>
            <option value="<?= h($p['product_id']) ?>"><?= h($p['name_internal']) ?></option>
          <?php endforeach; ?>
        </select>
      </div>
      <div class="field">
        <label for="core">Core</label>
        <input type="number" id="core" name="core" min="1" max="100000" value="1" required style="width:80px;">
      </div>
      <div class="field">
        <label for="search">Search</label>
        <input type="number" id="search" name="search" min="0" max="100000" value="0" required style="width:80px;">
      </div>
      <div class="field">
        <label for="workflow">Workflow</label>
        <input type="number" id="workflow" name="workflow" min="0" max="100000" value="0" required style="width:80px;">
      </div>
      <button class="btn" type="submit">Apply</button>
    </form>
  </div>
<?php endif; ?>
<?php
admin_page_close();
