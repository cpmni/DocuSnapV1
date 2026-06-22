<?php
// public/admin/account.php — single account detail: licensed features (set/upgrade) +
// entitlements + device seats. Part of the multi-page admin split. The "Set licensed
// features" form LEADS the page and is pre-filled with the account's CURRENT per-feature
// counts, so an "add seats" edit is a safe edit-in-place (a field left at 0 RETIRES that
// feature). Write actions route through the shared dispatcher and redirect back here.
require __DIR__ . '/../../lib/admin_auth.php';
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/admin_actions.php';
require __DIR__ . '/../../lib/admin_view.php';
require_admin();

$pdo = db();
admin_handle_post($pdo);

$account     = filter_input(INPUT_GET, 'account', FILTER_VALIDATE_INT);
$allProducts = $pdo->query('SELECT product_id, name_internal FROM products ORDER BY name_internal')->fetchAll();

$selAccount   = null;
$entitlements = [];
$seatsByEnt   = [];
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

// Pre-fill the features form from the account's CURRENT active per-feature counts (keyed
// by product), so "add seats" is a safe edit-in-place — a field left at 0 RETIRES that
// feature. A single-product account pre-selects + seeds; the inline script reseeds the
// fields when a different product is chosen.
$featProducts = [];
foreach ($entitlements as $e) {
    if (($e['status'] ?? '') !== 'active') continue;
    $pid = (string) $e['product_id'];
    if (!isset($featProducts[$pid])) $featProducts[$pid] = ['core' => 0, 'search' => 0, 'workflow' => 0];
    $f = $e['feature'] ?? 'core';
    if (isset($featProducts[$pid][$f])) $featProducts[$pid][$f] = (int) $e['seats_total'];
}
$preProduct = count($featProducts) === 1 ? (string) array_key_first($featProducts) : '';
$preCounts  = $preProduct !== '' ? $featProducts[$preProduct] : ['core' => 1, 'search' => 0, 'workflow' => 0];
$preCounts['core'] = max(1, (int) $preCounts['core']);

admin_page_open('Account');
admin_nav('accounts');
?>
<p style="margin:0 0 10px;"><a href="accounts.php">&larr; Accounts</a></p>
<?php if (!$account || !$selAccount): ?>
  <h1>Account <?= $account ? '#' . (int) $account : '' ?></h1>
  <div class="empty"><?= $account ? 'That account does not exist.' : 'No account selected.' ?></div>
<?php else: ?>
  <h1>Account #<?= (int) $selAccount['id'] ?>
      <span class="pill <?= $selAccount['status'] === 'active' ? 'ok' : 'warn' ?>"><?= h($selAccount['status']) ?></span>
  </h1>

  <!-- Set licensed features (issue + upgrade in one step) — LEADS the page -->
  <div class="card" style="margin:6px 0 18px;">
    <strong>Set licensed features</strong>
    <div class="muted" style="margin:4px 0 8px; max-width:640px;">Core binds the install seat; <strong>search</strong> and <strong>workflow</strong> are capacity counts the desktop enforces for connected clients. Workflow cannot exceed search. Setting a feature to 0 retires it. Pre-filled with this account's current counts — change only what you're adding. Additive — the account key is unchanged, so the desktop picks up new counts on its next online check.</div>
    <form method="post" action="account.php" class="row" style="margin-top:6px;">
      <?= csrf_field() ?>
      <input type="hidden" name="action" value="set_account_features">
      <input type="hidden" name="account_id" value="<?= (int) $selAccount['id'] ?>">
      <div class="field">
        <label for="product_id">Product</label>
        <select id="product_id" name="product_id" required>
          <option value="">Choose…</option>
          <?php foreach ($allProducts as $p): ?>
            <option value="<?= h($p['product_id']) ?>" <?= (string) $p['product_id'] === $preProduct ? 'selected' : '' ?>><?= h($p['name_internal']) ?></option>
          <?php endforeach; ?>
        </select>
      </div>
      <div class="field">
        <label for="core">Core</label>
        <input type="number" id="core" name="core" min="1" max="100000" value="<?= (int) $preCounts['core'] ?>" required style="width:80px;">
      </div>
      <div class="field">
        <label for="search">Search</label>
        <input type="number" id="search" name="search" min="0" max="100000" value="<?= (int) $preCounts['search'] ?>" required style="width:80px;">
      </div>
      <div class="field">
        <label for="workflow">Workflow</label>
        <input type="number" id="workflow" name="workflow" min="0" max="100000" value="<?= (int) $preCounts['workflow'] ?>" required style="width:80px;">
      </div>
      <button class="btn" type="submit">Apply</button>
    </form>
  </div>
  <script>
  (function () {
    var counts = <?= json_encode($featProducts, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP) ?>;
    var sel = document.getElementById('product_id');
    if (!sel) return;
    sel.addEventListener('change', function () {
      var c = counts[this.value] || { core: 1, search: 0, workflow: 0 };
      document.getElementById('core').value = Math.max(1, c.core | 0);
      document.getElementById('search').value = c.search | 0;
      document.getElementById('workflow').value = c.workflow | 0;
    });
  })();
  </script>

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
        <form method="post" action="account.php" class="inline"
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
              <form method="post" action="account.php" class="inline"
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
<?php endif; ?>
<?php admin_page_close();
