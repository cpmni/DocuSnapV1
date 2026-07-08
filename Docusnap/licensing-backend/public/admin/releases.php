<?php
// public/admin/releases.php — control the in-app "update available" banner.
// One row per distribution channel; the app compares `latest_version` against its own version
// and shows a dismissible banner linking to `update_url`. Advisory only, non-gating: an empty
// latest_version turns the banner OFF. Feeds lib/release.php → /v1 validate+status. Write action
// `set_release` lives in admin_actions.php (CSRF-gated).
require __DIR__ . '/../../lib/admin_auth.php';
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/admin_actions.php';
require __DIR__ . '/../../lib/admin_view.php';
require_admin();

$pdo = db();
admin_handle_post($pdo);

// Ensure both channel rows exist to render (schema seeds msstore; nsis may be absent).
$rows = [];
foreach (['msstore' => 'Microsoft Store', 'nsis' => 'Direct download (NSIS)'] as $ch => $label) {
    $st = $pdo->prepare('SELECT channel, latest_version, update_url, min_supported_version, updated_at FROM releases WHERE channel = ?');
    $st->execute([$ch]);
    $r = $st->fetch() ?: ['channel' => $ch, 'latest_version' => '', 'update_url' => '', 'min_supported_version' => null, 'updated_at' => null];
    $r['_label'] = $label;
    $rows[$ch] = $r;
}

admin_page_open('App releases');
admin_nav('releases');
?>
<h1>App releases</h1>
<p class="lead">Tell installed apps that a newer version is available. The app checks this during its
normal licence check (it never sends its version to the server) and shows a calm, dismissible
banner linking to the update. Leave <span class="mono">Latest version</span> blank to turn the
banner off for a channel. The Microsoft Store still auto-updates the app itself — this is just the
in-app nudge.</p>

<?php foreach ($rows as $ch => $r): ?>
<div class="card" style="margin:0 0 18px; max-width:720px;">
  <strong><?= h($r['_label']) ?></strong>
  <span class="pill <?= trim((string) $r['latest_version']) === '' ? '' : 'ok' ?>" style="margin-left:8px;">
    <?= trim((string) $r['latest_version']) === '' ? 'banner off' : 'advertising ' . h($r['latest_version']) ?>
  </span>
  <form method="post" action="releases.php" style="margin-top:10px;">
    <?= csrf_field() ?>
    <input type="hidden" name="action" value="set_release">
    <input type="hidden" name="channel" value="<?= h($ch) ?>">
    <div class="field" style="margin-bottom:8px;">
      <label>Latest version <span class="muted">(3-part, e.g. 2.1.0 — blank = banner off)</span></label>
      <input type="text" name="latest_version" value="<?= h((string) $r['latest_version']) ?>" placeholder="2.1.0" class="mono" style="max-width:160px;">
    </div>
    <div class="field" style="margin-bottom:8px;">
      <label>Update URL <span class="muted">(<?= $ch === 'msstore' ? 'ms-windows-store://pdp/?ProductId=… or an https store listing' : 'https download page' ?>)</span></label>
      <input type="text" name="update_url" value="<?= h((string) $r['update_url']) ?>" placeholder="<?= $ch === 'msstore' ? 'ms-windows-store://pdp/?ProductId=XXXX' : 'https://scanfinder.co.uk/download' ?>" style="width:100%; max-width:560px;">
    </div>
    <div class="field" style="margin-bottom:10px;">
      <label>Minimum supported version <span class="muted">(reserved — forced-update, not yet enforced by the app; leave blank)</span></label>
      <input type="text" name="min_supported_version" value="<?= h((string) ($r['min_supported_version'] ?? '')) ?>" placeholder="(blank)" class="mono" style="max-width:160px;">
    </div>
    <button class="btn" type="submit">Save <?= h($r['_label']) ?></button>
    <?php if ($r['updated_at']): ?><span class="muted" style="margin-left:10px;">last changed <?= h($r['updated_at']) ?></span><?php endif; ?>
  </form>
</div>
<?php endforeach; ?>

<p class="muted" style="max-width:720px;">Bump <span class="mono">Latest version</span> right after a
new build reaches the Store (or your download page). Clients pick it up on their next licence
check; each user can dismiss a version and is re-notified only when a newer one is published.</p>
<?php admin_page_close();
