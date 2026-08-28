<?php
// public/admin/products.php — Products reference list (read-only). Part of the
// multi-page admin split: shared chrome via admin_page_open/close, nav via admin_nav,
// the (no-op here) POST gate via admin_handle_post. Never exposes key material.
require __DIR__ . '/../../lib/admin_auth.php';
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/admin_actions.php';
require __DIR__ . '/../../lib/admin_view.php';
require_admin();

$pdo = db();
admin_handle_post($pdo);   // no write actions here; the dispatcher no-ops on GET

$pq = trim((string) ($_GET['pq'] ?? ''));   // product name / id search
if ($pq !== '') {
    $st = $pdo->prepare('SELECT product_id, name_internal FROM products
                         WHERE name_internal LIKE ? OR product_id LIKE ? ORDER BY name_internal');
    $st->execute(['%' . $pq . '%', '%' . $pq . '%']);
} else {
    $st = $pdo->query('SELECT product_id, name_internal FROM products ORDER BY name_internal');
}
$products = $st->fetchAll();

admin_page_open('Products');
admin_nav('products');
?>
<?php admin_page_head('products', 'Products', 'The products and plans a licence can apply to.'); ?>
<p class="lead">Reference list — each product is an opaque <span class="mono">product_id</span> plus an internal name. (Products are provisioned out-of-band, not from here.)</p>
<form method="get" action="products.php" class="row" style="margin-bottom:6px;">
  <div class="field">
    <label for="pq">Search name or ID</label>
    <input type="text" id="pq" name="pq" value="<?= h($pq) ?>" placeholder="e.g. docusnap or 1d2e…">
  </div>
  <button class="btn secondary" type="submit">Search</button>
  <?php if ($pq !== ''): ?><a class="btn secondary" href="products.php">Clear</a><?php endif; ?>
</form>
<?php if (!$products): ?>
  <div class="empty">No products found.</div>
<?php else: ?>
<table>
  <thead><tr><th>Product ID</th><th>Internal name</th></tr></thead>
  <tbody>
  <?php foreach ($products as $p): ?>
    <tr>
      <td class="mono"><?= h($p['product_id']) ?></td>
      <td><?= h($p['name_internal']) ?></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php endif; ?>
<?php admin_page_close();
