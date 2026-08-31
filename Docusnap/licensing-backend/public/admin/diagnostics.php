<?php
// public/admin/diagnostics.php — opt-in diagnostics feed (read-only). Part of the
// admin console. DOCUMENT-DATA-FREE: only enumerated app/error events with typed
// props, tied to an anonymous device id (fp_hash) — never document content, names,
// references, totals, dates or file paths. See DIAGNOSTICS_PLAN.md.
require __DIR__ . '/../../lib/admin_auth.php';
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/admin_view.php';
require_admin();

$pdo = db();

// The table is OPTIONAL on an un-migrated host — degrade gracefully, never 500.
$hasTable = false;
try { $pdo->query('SELECT 1 FROM telemetry_events LIMIT 1'); $hasTable = true; } catch (Throwable $e) {}

$rows = []; $summary = []; $devices = 0; $name = '';
if ($hasTable) {
    $name = isset($_GET['name']) ? preg_replace('/[^a-z0-9_]/', '', (string) $_GET['name']) : '';
    if ($name !== '') {
        $st = $pdo->prepare('SELECT received_at, fp_hash, name, props_json FROM telemetry_events WHERE name = ? ORDER BY id DESC LIMIT 300');
        $st->execute([$name]);
        $rows = $st->fetchAll();
    } else {
        $rows = $pdo->query('SELECT received_at, fp_hash, name, props_json FROM telemetry_events ORDER BY id DESC LIMIT 300')->fetchAll();
    }
    $summary = $pdo->query('SELECT name, COUNT(*) AS n, COUNT(DISTINCT fp_hash) AS devices FROM telemetry_events GROUP BY name ORDER BY n DESC')->fetchAll();
    $devices = (int) $pdo->query('SELECT COUNT(DISTINCT fp_hash) FROM telemetry_events')->fetchColumn();
}

admin_page_open('Diagnostics');
admin_nav('diagnostics');
?>
<?php admin_page_head('diagnostics', 'Diagnostics', 'Opt-in health and processing feed from installed apps.'); ?>
<p class="lead">Opt-in, anonymous app diagnostics — app/error events only, tied to an anonymous
  device id. Never document content, names, references, totals, dates or file paths.</p>

<?php if (!$hasTable): ?>
  <div class="empty">The <code>telemetry_events</code> table isn't present yet — import
    <code>schema.sql</code> on this host to enable diagnostics ingest.</div>
<?php elseif (!$rows): ?>
  <div class="empty">No diagnostics received yet (clients send only when a user opts in).</div>
<?php else: ?>
  <p class="muted"><?= count($rows) ?> recent events · <?= (int) $devices ?> device(s)<?php if ($name !== ''): ?>
    · filtered to <span class="mono"><?= h($name) ?></span> (<a href="diagnostics.php">clear</a>)<?php endif; ?></p>

  <h2>By event</h2>
  <table>
    <thead><tr><th>Event</th><th style="width:120px;">Count</th><th style="width:120px;">Devices</th></tr></thead>
    <tbody>
    <?php foreach ($summary as $s): ?>
      <tr>
        <td class="mono"><a href="diagnostics.php?name=<?= h($s['name']) ?>"><?= h($s['name']) ?></a></td>
        <td class="mono"><?= (int) $s['n'] ?></td>
        <td class="mono muted"><?= (int) $s['devices'] ?></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table>

  <h2>Recent events</h2>
  <table>
    <thead><tr><th style="width:160px;">Received</th><th style="width:90px;">Device</th><th style="width:180px;">Event</th><th>Details</th></tr></thead>
    <tbody>
    <?php foreach ($rows as $r): ?>
      <tr>
        <td class="mono muted"><?= h($r['received_at']) ?></td>
        <td class="mono muted"><?= h(substr((string) $r['fp_hash'], 0, 8)) ?></td>
        <td class="mono"><?= h($r['name']) ?></td>
        <td class="muted mono" style="font-size:11px;"><?= h($r['props_json'] ?? '') ?></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table>
<?php endif; ?>
<?php admin_page_close();
