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

// NO in-app geo lookup: we deliberately do NOT link IPs to any external geo service, so no customer IP
// is ever disclosed to a third party from this page (privacy / trustability). An admin who wants an
// address's location looks it up themselves, off-system.

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

// ── Who is behind each top IP (admin-only, read-only) ────────────────────────────────────────────
// Two sources, merged per (ip, account):
//   (1) fp_hash on ANY call -> seats -> entitlements -> account : names the customer behind the
//       validate traffic (which carries only a device fingerprint, no account_id). Prefers the
//       human customer_name from the entitlement.
//   (2) account_id on a `license.activated` row : the IP that customer SET UP from (the owner's ask —
//       "matches the IP used on setup"). Flagged with a "set up here" tag.
// Only REAL client IPs resolve — real-IP logging began 2026-09-19 (before that every row held a
// Cloudflare edge). Scoped to the <=10 top IPs; audit_events.ip is unindexed but this is an admin-only
// page over a small, pruned table, never the /v1 hot path.
$ipCustomers = [];   // ip => [ account_id => ['label'=>string, 'setup'=>bool] ]
if ($topIps) {
    $ips = array_column($topIps, 'ip');
    $ph  = implode(',', array_fill(0, count($ips), '?'));

    // (1) device-fingerprint chain (covers validate)
    $q1 = $pdo->prepare(
        "SELECT ae.ip AS ip, e.account_id AS aid,
                COALESCE(NULLIF(e.customer_name,''), a.email, NULLIF(e.customer_email,''), CONCAT('account #', e.account_id)) AS label
           FROM audit_events ae
           JOIN seats s        ON s.fp_hash = ae.fp_hash
           JOIN entitlements e ON e.id = s.entitlement_id
           LEFT JOIN accounts a ON a.id = e.account_id
          WHERE ae.ip IN ($ph) AND ae.fp_hash IS NOT NULL
            AND ae.created_at >= NOW() - INTERVAL 24 HOUR   -- the top IPs are already a 24h set; rides idx_created (no full scan)
            AND s.status = 'bound'                          -- released seats NULL their fp anyway; defensive + self-documenting
          GROUP BY ae.ip, e.account_id, label");
    $q1->execute($ips);
    foreach ($q1->fetchAll() as $r) {
        $ipCustomers[$r['ip']][$r['aid']] = ['label' => $r['label'], 'setup' => false];
    }

    // (2) activation (setup) IPs
    $q2 = $pdo->prepare(
        "SELECT ae.ip AS ip, ae.account_id AS aid, COALESCE(a.email, CONCAT('account #', ae.account_id)) AS label
           FROM audit_events ae
           JOIN accounts a ON a.id = ae.account_id
          WHERE ae.ip IN ($ph) AND ae.action = 'license.activated'
          GROUP BY ae.ip, ae.account_id, label");
    $q2->execute($ips);
    foreach ($q2->fetchAll() as $r) {
        if (isset($ipCustomers[$r['ip']][$r['aid']])) $ipCustomers[$r['ip']][$r['aid']]['setup'] = true;
        else $ipCustomers[$r['ip']][$r['aid']] = ['label' => $r['label'], 'setup' => true];
    }
}

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
  <thead><tr><th>IP address</th><th style="width:90px;">Calls</th><th>Customer</th></tr></thead>
  <tbody>
  <?php foreach ($topIps as $ipr): $cust = $ipCustomers[$ipr['ip']] ?? []; ?>
    <tr>
      <td class="mono"><?= h($ipr['ip']) ?></td>
      <td class="mono"><?= (int) $ipr['n'] ?></td>
      <td><?php
        if (!$cust) { echo '<span class="muted">&mdash;</span>'; }
        else {
            $out = []; $shown = 0;
            foreach ($cust as $c) {
                if ($shown++ >= 3) { $out[] = '<span class="muted">+' . (count($cust) - 3) . ' more</span>'; break; }
                $tag = $c['setup'] ? ' <span class="mono" style="font-size:10px; color:var(--accent2); border:1px solid var(--accent-border); border-radius:8px; padding:0 5px;">set up here</span>' : '';
                $out[] = h($c['label']) . $tag;
            }
            echo implode('<br>', $out);
        }
      ?></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<p class="muted" style="font-size:12px; margin-top:6px;">
  A customer is matched by their app's device fingerprint (on every check-in) or by the IP they set up from
  (<span class="mono">set up here</span>). After a resale or re-activation under a new account, a former owner may also be listed.
  Only real IPs resolve &mdash; real-IP logging began 2026-09-19, so older rows and Cloudflare edges show &ldquo;&mdash;&rdquo;.
  One office behind a shared connection appears as a single IP with many calls, not abuse.
</p>
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
