<?php
// public/admin/trial.php — single in-app trial detail (a device_registrations row that
// carries a trial window). Shows the captured customer identity, the trial clock, and —
// the reason this page exists — whether the trial DEVICE has since activated a paid
// licence (its fp_hash bound to a seat under an entitlement/account). Extend/revoke run
// through the shared dispatcher (from=detail keeps the operator on this page). Read-only
// otherwise; no key material exposed (the fingerprint is shown truncated, like the list).
require __DIR__ . '/../../lib/admin_auth.php';
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/admin_actions.php';
require __DIR__ . '/../../lib/admin_view.php';
require __DIR__ . '/../../lib/jws.php';   // TRIAL_SEARCH_SEATS default (function defs only — no side effects)
require_admin();

$pdo = db();
admin_handle_post($pdo);

$trialId = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);

$trial = null;
$converted = [];
if ($trialId) {
    $st = $pdo->prepare(
        'SELECT d.id, d.fp_hash, d.product_id, p.name_internal, d.first_seen, d.last_seen,
                d.trial_start, d.trial_end, d.customer_name, d.contact_name, d.email,
                d.trial_search_seats,
                (d.trial_end > NOW()) AS is_active,
                CONCAT(SUBSTRING(d.fp_hash, 1, 16), "…") AS fp_short
         FROM device_registrations d LEFT JOIN products p ON p.product_id = d.product_id
         WHERE d.id = ? AND d.trial_start IS NOT NULL'
    );
    $st->execute([$trialId]);
    $trial = $st->fetch();

    if ($trial) {
        // Has this trial DEVICE activated a paid licence? Match the trial fingerprint to
        // a seat under an entitlement → account. A released seat nulls its fp_hash, so
        // this shows currently-bound conversions — the trial→paid link the admin couldn't
        // see before.
        $cs = $pdo->prepare(
            'SELECT s.id AS seat_id, s.status AS seat_status, s.bound_at, s.released_at,
                    e.id AS ent_id, e.account_id, e.feature, e.seats_total, e.expires_at, e.status,
                    p.name_internal
             FROM seats s
             JOIN entitlements e ON e.id = s.entitlement_id
             LEFT JOIN products p ON p.product_id = e.product_id
             WHERE s.fp_hash = ?
             ORDER BY s.id'
        );
        $cs->execute([$trial['fp_hash']]);
        $converted = $cs->fetchAll();
    }
}

admin_page_open('Trial');
admin_nav('trials');
?>
<p style="margin:0 0 10px;"><a href="trials.php">&larr; Trials</a></p>
<?php if (!$trialId || !$trial): ?>
  <h1>Trial <?= $trialId ? '#' . (int) $trialId : '' ?></h1>
  <div class="empty"><?= $trialId ? 'That trial does not exist.' : 'No trial selected.' ?></div>
<?php else:
  $active = (int) $trial['is_active'] === 1;
  $left   = temp_days_left($trial['trial_end']);
  $searchOverride = $trial['trial_search_seats'];                           // NULL = default
  $searchEff      = $searchOverride !== null ? (int) $searchOverride : TRIAL_SEARCH_SEATS;
?>
  <h1>Trial #<?= (int) $trial['id'] ?>
    <?= $active ? '<span class="pill ok">active</span>' : '<span class="pill">expired</span>' ?>
  </h1>

  <div class="card" style="margin:6px 0 18px; max-width:720px;">
    <strong>Trial details</strong>
    <table style="margin-top:10px;">
      <tbody>
        <tr><td class="muted">Customer / Company</td><td><strong><?= $trial['customer_name'] ? h($trial['customer_name']) : '<span class="muted" style="font-weight:400;">(not captured)</span>' ?></strong></td></tr>
        <tr><td class="muted">User</td><td><?= $trial['contact_name'] ? h($trial['contact_name']) : '<span class="muted">—</span>' ?></td></tr>
        <tr><td class="muted">Email</td><td class="mono"><?= $trial['email'] ? h($trial['email']) : '<span class="muted">—</span>' ?></td></tr>
        <tr><td class="muted">Product</td><td><?= h($trial['name_internal'] ?? '(unknown)') ?> <span class="mono muted">(<?= h($trial['product_id']) ?>)</span></td></tr>
        <tr><td class="muted">Device fingerprint</td><td class="mono muted" title="SHA-256 device fingerprint (truncated)"><?= h($trial['fp_short']) ?></td></tr>
        <tr><td class="muted">Trial start</td><td class="mono muted"><?= h($trial['trial_start']) ?></td></tr>
        <tr><td class="muted">Expiry</td><td class="mono muted"><?= h($trial['trial_end']) ?></td></tr>
        <tr><td class="muted">Remaining</td><td class="mono"><?= $active ? $left . ' day(s)' : '—' ?></td></tr>
        <tr><td class="muted">First seen</td><td class="mono muted"><?= h($trial['first_seen']) ?></td></tr>
        <tr><td class="muted">Last seen</td><td class="mono muted"><?= h($trial['last_seen']) ?></td></tr>
      </tbody>
    </table>

    <div class="row" style="margin-top:14px; align-items:flex-end; gap:8px;">
      <form method="post" action="trial.php" class="inline">
        <?= csrf_field() ?>
        <input type="hidden" name="action" value="extend_trial">
        <input type="hidden" name="from" value="detail">
        <input type="hidden" name="trial_id" value="<?= (int) $trial['id'] ?>">
        <input type="number" name="days" min="1" max="3650" value="14" style="width:64px;" title="Days to add">
        <button class="btn secondary" type="submit">Extend</button>
      </form>
      <?php if ($active): ?>
      <form method="post" action="trial.php" class="inline"
            onsubmit="return confirm('Revoke trial #<?= (int) $trial['id'] ?> now? It will no longer count as active. The device cannot restart this trial.');">
        <?= csrf_field() ?>
        <input type="hidden" name="action" value="revoke_trial">
        <input type="hidden" name="from" value="detail">
        <input type="hidden" name="trial_id" value="<?= (int) $trial['id'] ?>">
        <button class="btn danger" type="submit">Revoke</button>
      </form>
      <?php endif; ?>
      <form method="post" action="trial.php" class="inline"
            onsubmit="return confirm('Permanently DELETE trial #<?= (int) $trial['id'] ?>? This removes its record. The device could then start a fresh trial — use Revoke instead for a real customer.');">
        <?= csrf_field() ?>
        <input type="hidden" name="action" value="delete_trial">
        <input type="hidden" name="trial_id" value="<?= (int) $trial['id'] ?>">
        <button class="btn danger" type="submit">Delete</button>
      </form>
    </div>
  </div>

  <div class="card" style="margin:0 0 18px; max-width:720px;">
    <strong>Included search clients</strong>
    <div class="muted" style="margin:4px 0 8px; max-width:560px;">
      Detached search-client seats this trial includes while it is active — raise or lower
      for this specific trial. Applies for the trial's duration and updates on the device's
      next online check. Set to 0 to include none.
      <?php if ($searchOverride === null): ?>
        Currently the policy default (<strong><?= (int) TRIAL_SEARCH_SEATS ?></strong>).
      <?php else: ?>
        Custom override set for this trial (default is <?= (int) TRIAL_SEARCH_SEATS ?>).
      <?php endif; ?>
    </div>
    <form method="post" action="trial.php" class="row" style="align-items:flex-end; gap:8px;">
      <?= csrf_field() ?>
      <input type="hidden" name="action" value="set_trial_search_seats">
      <input type="hidden" name="from" value="detail">
      <input type="hidden" name="trial_id" value="<?= (int) $trial['id'] ?>">
      <div class="field">
        <label for="search_seats">Search clients</label>
        <input type="number" id="search_seats" name="search_seats" min="0" max="1000" value="<?= (int) $searchEff ?>" style="width:90px;">
      </div>
      <button class="btn" type="submit">Apply</button>
    </form>
  </div>

  <h2 style="margin:0 0 8px;">Paid licence for this device</h2>
  <?php if (!$converted): ?>
    <div class="empty">This trial device has not activated a paid licence — no seat is bound to its fingerprint.</div>
  <?php else: ?>
    <p class="muted" style="margin:0 0 8px;">This trial device's fingerprint is bound to the following paid seat(s). The trial has converted to a paid account.</p>
    <table>
      <thead><tr><th>Account</th><th>Entitlement</th><th>Feature</th><th>Seat state</th><th>Capacity</th><th>Expires</th><th>State</th></tr></thead>
      <tbody>
      <?php foreach ($converted as $c): ?>
        <tr data-href="account.php?account=<?= (int) $c['account_id'] ?>">
          <td class="mono"><a href="account.php?account=<?= (int) $c['account_id'] ?>">#<?= (int) $c['account_id'] ?></a></td>
          <td class="mono muted">#<?= (int) $c['ent_id'] ?> · <?= h($c['name_internal'] ?? '(unknown)') ?></td>
          <td><span class="pill"><?= h($c['feature'] ?? 'core') ?></span></td>
          <td><?= seat_state_pill((string) $c['seat_status']) ?></td>
          <td class="mono"><?= (int) $c['seats_total'] ?></td>
          <td class="mono muted"><?= $c['expires_at'] ? h($c['expires_at']) : 'never' ?></td>
          <td><?= ent_state_pill($c) ?></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    <?php admin_row_links(); ?>
  <?php endif; ?>
<?php endif; ?>
<?php admin_page_close();
