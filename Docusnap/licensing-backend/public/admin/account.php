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
    $st = $pdo->prepare('SELECT id, status, polar_customer_id, email, name FROM accounts WHERE id = ?');
    $st->execute([$account]);
    $selAccount = $st->fetch();
    if ($selAccount) {
        $st = $pdo->prepare('SELECT e.id, e.product_id, e.feature, p.name_internal, e.seats_total, e.expires_at, e.status, e.polar_ref,
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
$entInforce = 0;                       // active AND non-expired entitlements (a licence in force)
$isPolarManaged = false;              // any active entitlement tied to a Polar subscription/order
foreach ($entitlements as $e) {
    if (($e['status'] ?? '') !== 'active') continue;
    if ($e['expires_at'] === null || strtotime((string) $e['expires_at']) > time()) $entInforce++;
    if (!empty($e['polar_ref'])) $isPolarManaged = true;
    $pid = (string) $e['product_id'];
    if (!isset($featProducts[$pid])) $featProducts[$pid] = ['core' => 0, 'search' => 0, 'workflow' => 0];
    $f = $e['feature'] ?? 'core';
    // SUM per feature (an account can hold several per-subscription rows for one feature).
    if (isset($featProducts[$pid][$f])) $featProducts[$pid][$f] += (int) $e['seats_total'];
}
// Honest, licence-aware status for the header (NOT the account record's own flag).
if (($selAccount['status'] ?? '') !== 'active') { $statusPill = ['err', (string) ($selAccount['status'] ?? 'unknown')]; }
elseif ($entInforce > 0)        { $statusPill = ['ok', 'active']; }
elseif ($entitlements)          { $statusPill = ['warn', 'lapsed']; }
else                            { $statusPill = ['', 'no licence']; }
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
  <?php $issued = $_SESSION['issued_key'] ?? null; unset($_SESSION['issued_key']); if ($issued): ?>
  <div class="keynote">
    <div class="keynote-title">&#10003; New license key — copy it now</div>
    <span class="keynote-key"><?= h($issued['key']) ?></span>
    <div class="keynote-meta"><?= h($issued['meta']) ?> · this key will not be shown again.</div>
  </div>
  <?php endif; ?>

  <h1>Account #<?= (int) $selAccount['id'] ?>
      <span class="pill <?= $statusPill[0] ?>"><?= h($statusPill[1]) ?></span>
  </h1>
  <div class="row" style="justify-content:space-between; align-items:center; margin:0 0 12px;">
    <div class="muted" style="font-size:12px; line-height:1.6;">
      <?php if (!empty($selAccount['name']) || !empty($selAccount['email'])): ?>
        <strong style="color:var(--text,#1b1f2a);"><?= h($selAccount['name'] ?: '(no name)') ?></strong>
        <?php if (!empty($selAccount['email'])): ?> &nbsp;·&nbsp; <a href="mailto:<?= h($selAccount['email']) ?>"><?= h($selAccount['email']) ?></a><?php endif; ?>
        <br>
      <?php endif; ?>
      <?php if (!empty($selAccount['polar_customer_id'])): ?>
        Polar customer: <span class="mono"><?= h($selAccount['polar_customer_id']) ?></span>
      <?php else: ?>
        <span class="muted">Not linked to a Polar customer (admin/trial account).</span>
      <?php endif; ?>
    </div>
    <form method="post" action="account.php" class="inline"
          onsubmit="return confirm('Issue a NEW key for this account? The current key stops working immediately.');">
      <?= csrf_field() ?>
      <input type="hidden" name="action" value="reissue_account_key">
      <input type="hidden" name="account_id" value="<?= (int) $selAccount['id'] ?>">
      <button class="btn" type="submit">Reissue key</button>
    </form>
  </div>

  <!-- Licensed features: read-only TOTALS (the SUM of subscriptions + any complimentary grants) -->
  <?php
    $tot = ['core' => 0, 'search' => 0, 'workflow' => 0];
    foreach ($featProducts as $c) { $tot['core'] += $c['core']; $tot['search'] += $c['search']; $tot['workflow'] += $c['workflow']; }
    $defaultProduct = $preProduct !== '' ? $preProduct : (count($featProducts) ? (string) array_key_first($featProducts) : '');
  ?>
  <div class="card" style="margin:6px 0 18px;">
    <strong>Licensed features</strong>
    <div class="muted" style="margin:4px 0 8px; max-width:640px;">Totals in force on this account — the <strong>sum</strong> of all active entitlements (Polar subscriptions plus any complimentary grants below). The desktop enforces these on its next online check.</div>
    <div class="row" style="gap:28px; margin-top:8px;">
      <div><div class="muted">Core (installs)</div><strong style="font-size:18px;"><?= (int) $tot['core'] ?></strong></div>
      <div><div class="muted">Search clients</div><strong style="font-size:18px;"><?= (int) $tot['search'] ?></strong></div>
      <div><div class="muted">Workflow add-on</div><strong style="font-size:18px;"><?= (int) $tot['workflow'] ?></strong></div>
    </div>
  </div>

  <!-- Grant complimentary (manual) seats — a SEPARATE entitlement row that SUMS on top of any
       subscriptions. To remove or change one, use its "Revoke entitlement" card below. -->
  <div class="card" style="margin:6px 0 18px;">
    <strong>Grant complimentary seats</strong>
    <div class="muted" style="margin:4px 0 8px; max-width:640px;">Give seats free of charge (e.g. a negotiated deal). This adds a manual entitlement that <strong>sums on top</strong> of any subscription seats. To remove or change a grant, use its <em>Revoke entitlement</em> below. Leave expiry blank for no expiry. (Search = client seats; core install seats normally come from a subscription.)</div>
    <form method="post" action="account.php" class="row" style="margin-top:6px; align-items:flex-end;">
      <?= csrf_field() ?>
      <input type="hidden" name="action" value="grant_manual_seats">
      <input type="hidden" name="account_id" value="<?= (int) $selAccount['id'] ?>">
      <div class="field">
        <label for="mp">Product</label>
        <select id="mp" name="product_id" required>
          <?php foreach ($allProducts as $p): ?>
            <option value="<?= h($p['product_id']) ?>" <?= (string) $p['product_id'] === $defaultProduct ? 'selected' : '' ?>><?= h($p['name_internal']) ?></option>
          <?php endforeach; ?>
        </select>
      </div>
      <div class="field">
        <label for="mf">Feature</label>
        <select id="mf" name="feature" required>
          <option value="search">Search clients</option>
          <option value="workflow">Workflow add-on</option>
          <option value="core">Core installs</option>
        </select>
      </div>
      <div class="field">
        <label for="mq">Quantity</label>
        <input type="number" id="mq" name="qty" min="1" max="100000" value="1" required style="width:80px;">
      </div>
      <div class="field">
        <label for="md">Expiry (days)</label>
        <input type="number" id="md" name="days" min="1" max="3650" placeholder="never" style="width:90px;">
      </div>
      <button class="btn" type="submit">Grant</button>
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
  <?php else: foreach ($entitlements as $e):
    $seats  = $seatsByEnt[$e['id']] ?? [];
    $feat   = $e['feature'] ?? 'core';
    $isCore = $feat === 'core';
    $featTitle = ['core' => 'Core — desktop install', 'search' => 'Search clients', 'workflow' => 'Workflow add-on'][$feat] ?? ucfirst($feat);
    $featBlurb = [
      'core'     => 'One install seat per device (binds the device fingerprint) — the app itself.',
      'search'   => 'Concurrent search / detached-client capacity — a count the core app enforces; no device binding here.',
      'workflow' => 'Approval and mailbox add-on — capacity rides a search seat (cannot exceed search).',
    ][$feat] ?? '';
  ?>
    <div class="card" style="margin-bottom:14px;">
      <div class="row" style="justify-content:space-between; align-items:flex-start;">
        <div>
          <strong><?= h($featTitle) ?></strong> &nbsp;
          <span class="pill"><?= h($feat) ?></span> &nbsp; <?= ent_state_pill($e) ?>
          <?= empty($e['polar_ref']) ? '&nbsp; <span class="pill">complimentary</span>' : '' ?>
          &nbsp; <span class="mono muted" style="font-size:12px;">entitlement #<?= (int) $e['id'] ?></span><br>
          <?php if ($featBlurb): ?><span class="muted" style="font-size:12px;"><?= h($featBlurb) ?></span><br><?php endif; ?>
          <span class="muted">Product:</span> <?= h($e['name_internal'] ?? '(unknown)') ?>
          <span class="mono muted">(<?= h($e['product_id']) ?>)</span><br>
          <span class="muted"><?= $isCore ? 'Device seats (bound / total):' : 'Capacity (total):' ?></span>
          <span class="mono"><?= $isCore ? ((int) $e['seats_used'] . ' / ' . (int) $e['seats_total']) : (int) $e['seats_total'] ?></span>
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

      <?php if ($isCore): ?>
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
          <div class="empty">No device has bound a seat under this licence yet.</div>
        <?php endif; ?>
      <?php else: ?>
        <div class="empty">Capacity only — enforced by the core app for connected clients; nothing is device-bound here.</div>
      <?php endif; ?>
    </div>
  <?php endforeach; endif; ?>

  <div style="margin-top:28px; padding:16px 18px; border:1px solid #e3b4b4; border-radius:10px; background:#fcf0f0;">
    <div style="font-weight:700; color:#b23b3b; margin-bottom:6px;">Danger zone</div>
    <p class="muted" style="font-size:13px; margin:0 0 12px;">Permanently delete this account and all of its entitlements and seats. This cannot be undone. A device still using a licence from this account keeps working until its next online check, then locks.</p>
    <form method="post" action="account.php"
          onsubmit="return confirm('Permanently DELETE account #<?= (int) $selAccount['id'] ?> and everything it owns? This cannot be undone.');">
      <?= csrf_field() ?>
      <input type="hidden" name="action" value="delete_account">
      <input type="hidden" name="account_id" value="<?= (int) $selAccount['id'] ?>">
      <button class="btn danger" type="submit">Delete account</button>
    </form>
  </div>
<?php endif; ?>
<?php admin_page_close();
