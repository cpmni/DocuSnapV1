<?php
// public/admin/index.php — admin dashboard for the licensing backend.
// Read-only screens (products / accounts / entitlements / seats) plus explicit,
// CSRF-protected, server-validated write actions (create/revoke entitlement,
// revoke seat). Reuses the existing PDO connection, schema and audit helper.
// Never displays account_key_hash or any plaintext key.
require __DIR__ . '/../../lib/admin_auth.php';
require __DIR__ . '/../../lib/db.php';
require_admin();

$pdo = db();

// ── Write actions (POST → redirect → GET) ────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $backAccount = filter_input(INPUT_POST, 'account_id', FILTER_VALIDATE_INT);
    $back = $backAccount ? ('index.php?account=' . $backAccount) : 'index.php';

    if (!csrf_check()) {
        flash_set('err', 'Security check failed. Please retry.');
        header('Location: ' . $back);
        exit;
    }

    $action = (string) ($_POST['action'] ?? '');
    try {
        if ($action === 'create_entitlement') {
            $accountId = filter_input(INPUT_POST, 'account_id', FILTER_VALIDATE_INT);
            $productId = trim((string) ($_POST['product_id'] ?? ''));
            $seats     = filter_input(INPUT_POST, 'seats_total', FILTER_VALIDATE_INT);
            $expiresRw = trim((string) ($_POST['expires_at'] ?? ''));

            if (!$accountId)                      throw new RuntimeException('Choose a valid account.');
            if ($productId === '')                throw new RuntimeException('Choose a product.');
            if ($seats === false || $seats === null || $seats < 1 || $seats > 100000) {
                throw new RuntimeException('Seats must be a whole number between 1 and 100000.');
            }

            $chk = $pdo->prepare('SELECT 1 FROM accounts WHERE id = ?');
            $chk->execute([$accountId]);
            if (!$chk->fetchColumn()) throw new RuntimeException('Account not found.');

            $chk = $pdo->prepare('SELECT 1 FROM products WHERE product_id = ?');
            $chk->execute([$productId]);
            if (!$chk->fetchColumn()) throw new RuntimeException('Product not found.');

            $expiresAt = null;
            if ($expiresRw !== '') {
                $d = DateTime::createFromFormat('Y-m-d', $expiresRw);
                $valid = $d && $d->format('Y-m-d') === $expiresRw;
                if (!$valid) throw new RuntimeException('Expiry must be YYYY-MM-DD, or left blank.');
                $expiresAt = $expiresRw . ' 23:59:59';
            }

            $pdo->prepare('INSERT INTO entitlements (account_id, product_id, seats_total, expires_at, status)
                           VALUES (?, ?, ?, ?, "active")')
                ->execute([$accountId, $productId, $seats, $expiresAt]);
            $newId = (int) $pdo->lastInsertId();
            audit_event($pdo, $accountId, null, 'admin.entitlement_created',
                "entitlement=$newId product=$productId seats=$seats");
            flash_set('ok', "Entitlement #$newId created with $seats seat(s).");
            header('Location: index.php?account=' . $accountId);
            exit;
        }

        if ($action === 'revoke_entitlement') {
            $entId = filter_input(INPUT_POST, 'entitlement_id', FILTER_VALIDATE_INT);
            if (!$entId) throw new RuntimeException('Invalid entitlement.');
            $row = $pdo->prepare('SELECT account_id, status FROM entitlements WHERE id = ?');
            $row->execute([$entId]);
            $ent = $row->fetch();
            if (!$ent) throw new RuntimeException('Entitlement not found.');
            if ($ent['status'] === 'revoked') throw new RuntimeException('Entitlement is already revoked.');

            $pdo->beginTransaction();
            $pdo->prepare('UPDATE entitlements SET status = "revoked" WHERE id = ?')->execute([$entId]);
            // Release any seats currently bound under it (mirrors /v1/revoke).
            $pdo->prepare('UPDATE seats SET fp_hash = NULL, released_at = NOW(), status = "released"
                           WHERE entitlement_id = ? AND status = "bound"')->execute([$entId]);
            $pdo->commit();
            audit_event($pdo, (int) $ent['account_id'], null, 'admin.entitlement_revoked', "entitlement=$entId");
            flash_set('ok', "Entitlement #$entId revoked and its bound seats released.");
            header('Location: index.php?account=' . (int) $ent['account_id']);
            exit;
        }

        if ($action === 'revoke_seat') {
            $seatId = filter_input(INPUT_POST, 'seat_id', FILTER_VALIDATE_INT);
            if (!$seatId) throw new RuntimeException('Invalid seat.');
            $row = $pdo->prepare('SELECT s.status AS seat_status, e.id AS ent_id, e.account_id
                                  FROM seats s JOIN entitlements e ON e.id = s.entitlement_id
                                  WHERE s.id = ?');
            $row->execute([$seatId]);
            $seat = $row->fetch();
            if (!$seat) throw new RuntimeException('Seat not found.');
            if ($seat['seat_status'] !== 'bound') throw new RuntimeException('That seat is not currently bound.');

            $pdo->prepare('UPDATE seats SET fp_hash = NULL, released_at = NOW(), status = "released" WHERE id = ?')
                ->execute([$seatId]);
            audit_event($pdo, (int) $seat['account_id'], null, 'admin.seat_revoked',
                "seat=$seatId entitlement={$seat['ent_id']}");
            flash_set('ok', "Seat #$seatId released.");
            header('Location: index.php?account=' . (int) $seat['account_id']);
            exit;
        }

        if ($action === 'create_temp_license') {
            // A "temporary licence" is just an account + a 1-seat entitlement with an
            // expiry — it rides the existing activate/validate/revoke contract, so the
            // desktop treats it as a valid grant until it expires or is revoked.
            $productId = trim((string) ($_POST['product_id'] ?? ''));
            $days      = filter_input(INPUT_POST, 'days', FILTER_VALIDATE_INT);
            $custName  = trim((string) ($_POST['customer_name'] ?? ''));
            $label     = trim((string) ($_POST['device_label'] ?? ''));
            $email     = trim((string) ($_POST['customer_email'] ?? ''));
            $notes     = trim((string) ($_POST['notes'] ?? ''));
            if ($productId === '') throw new RuntimeException('Choose a product.');
            if ($days === false || $days === null || $days < 1 || $days > 3650) {
                throw new RuntimeException('Duration must be a whole number between 1 and 3650 days.');
            }
            // Required human-readable identity. Trim collapses whitespace-only to empty
            // (rejected); any normal punctuation/spacing is otherwise accepted.
            if ($custName === '') throw new RuntimeException('Enter a customer or company name.');
            if (mb_strlen($custName) > 190) throw new RuntimeException('Customer or company name is too long (max 190).');
            if (mb_strlen($label) > 120) throw new RuntimeException('Device label is too long (max 120).');
            if ($email !== '' && (mb_strlen($email) > 190 || !filter_var($email, FILTER_VALIDATE_EMAIL))) {
                throw new RuntimeException('Customer email is not a valid address (or leave it blank).');
            }
            if (mb_strlen($notes) > 2000) throw new RuntimeException('Notes are too long (max 2000).');
            $chk = $pdo->prepare('SELECT 1 FROM products WHERE product_id = ?');
            $chk->execute([$productId]);
            if (!$chk->fetchColumn()) throw new RuntimeException('Product not found.');

            // Generate the key; persist ONLY its SHA-256 hash (same scheme as /v1/activate).
            $key       = 'TEMP-' . strtoupper(bin2hex(random_bytes(8)));
            $keyHash   = hash('sha256', $key);
            $expiresAt = date('Y-m-d H:i:s', time() + $days * 86400);

            $pdo->beginTransaction();
            $pdo->prepare('INSERT INTO accounts (account_key_hash, status) VALUES (?, "active")')->execute([$keyHash]);
            $accId = (int) $pdo->lastInsertId();
            $pdo->prepare('INSERT INTO entitlements
                             (account_id, product_id, seats_total, expires_at, status, customer_name, device_label, customer_email, notes)
                           VALUES (?, ?, 1, ?, "active", ?, ?, ?, ?)')
                ->execute([$accId, $productId, $expiresAt, $custName,
                           $label !== '' ? $label : null,
                           $email !== '' ? $email : null,
                           $notes !== '' ? $notes : null]);
            $entId = (int) $pdo->lastInsertId();
            $pdo->commit();
            // Audit records issuance facts only — not the key, not the notes body.
            audit_event($pdo, $accId, null, 'admin.temp_license_created',
                "entitlement=$entId product=$productId days=$days expires=$expiresAt email_set=" . ($email !== '' ? '1' : '0'));
            // One-time display of the key — never stored in plaintext, never shown
            // again. Rendered as a success callout on the next page load, then dropped.
            $_SESSION['issued_key'] = ['key' => $key, 'meta' => "account #$accId · license #$entId · valid until $expiresAt"];
            flash_set('ok', 'Temporary license created — copy the key below now, it is shown only once.');
            header('Location: index.php');
            exit;
        }

        if ($action === 'extend_temp_license') {
            $entId = filter_input(INPUT_POST, 'entitlement_id', FILTER_VALIDATE_INT);
            $days  = filter_input(INPUT_POST, 'days', FILTER_VALIDATE_INT);
            if (!$entId) throw new RuntimeException('Invalid licence.');
            if ($days === false || $days === null || $days < 1 || $days > 3650) {
                throw new RuntimeException('Extension must be a whole number between 1 and 3650 days.');
            }
            $row = $pdo->prepare('SELECT account_id, expires_at, status FROM entitlements WHERE id = ?');
            $row->execute([$entId]);
            $ent = $row->fetch();
            if (!$ent) throw new RuntimeException('Licence not found.');
            if ($ent['expires_at'] === null) throw new RuntimeException('That entitlement is perpetual, not a temporary licence.');
            if ($ent['status'] === 'revoked') throw new RuntimeException('Cannot extend a revoked licence — create a new one.');

            // Extend from the later of now / current expiry: an expired key gets a full
            // fresh window; an active one is topped up.
            $base = max(time(), strtotime((string) $ent['expires_at']));
            $newExpiry = date('Y-m-d H:i:s', $base + $days * 86400);
            $pdo->prepare('UPDATE entitlements SET expires_at = ? WHERE id = ?')->execute([$newExpiry, $entId]);
            audit_event($pdo, (int) $ent['account_id'], null, 'admin.temp_license_extended',
                "entitlement=$entId plus{$days}d new_expires=$newExpiry");
            flash_set('ok', "Licence #$entId extended by $days day(s) — now expires $newExpiry.");
            header('Location: index.php');
            exit;
        }

        if ($action === 'extend_trial') {
            // Trials carry no `status` column; "active" is purely trial_end > NOW().
            // Extend reuses trial_end only (no schema change): push it out from the
            // later of now / current end, so an expired or revoked trial gets a full
            // fresh window and an active one is topped up. Trial start is untouched.
            $trialId = filter_input(INPUT_POST, 'trial_id', FILTER_VALIDATE_INT);
            $days    = filter_input(INPUT_POST, 'days', FILTER_VALIDATE_INT);
            if (!$trialId) throw new RuntimeException('Invalid trial.');
            if ($days === false || $days === null || $days < 1 || $days > 3650) {
                throw new RuntimeException('Extension must be a whole number between 1 and 3650 days.');
            }
            $row = $pdo->prepare('SELECT fp_hash, trial_start, trial_end FROM device_registrations WHERE id = ?');
            $row->execute([$trialId]);
            $tr = $row->fetch();
            if (!$tr || $tr['trial_start'] === null) throw new RuntimeException('Trial not found.');
            $base   = max(time(), strtotime((string) $tr['trial_end']));
            $newEnd = date('Y-m-d H:i:s', $base + $days * 86400);
            $pdo->prepare('UPDATE device_registrations SET trial_end = ? WHERE id = ?')->execute([$newEnd, $trialId]);
            audit_event($pdo, null, (string) $tr['fp_hash'], 'admin.trial_extended', "trial=$trialId plus{$days}d new_end=$newEnd");
            flash_set('ok', "Trial #$trialId extended by $days day(s) — now expires $newEnd.");
            header('Location: index.php#trials');
            exit;
        }

        if ($action === 'revoke_trial') {
            // Revoke = end the trial window now so is_active (trial_end > NOW) is false
            // immediately; reuses trial_end, no schema change. trial/start never
            // re-mints an existing window, so a revoked device cannot resume it.
            $trialId = filter_input(INPUT_POST, 'trial_id', FILTER_VALIDATE_INT);
            if (!$trialId) throw new RuntimeException('Invalid trial.');
            $row = $pdo->prepare('SELECT fp_hash, trial_start, trial_end FROM device_registrations WHERE id = ?');
            $row->execute([$trialId]);
            $tr = $row->fetch();
            if (!$tr || $tr['trial_start'] === null) throw new RuntimeException('Trial not found.');
            if (strtotime((string) $tr['trial_end']) <= time()) throw new RuntimeException('Trial is already inactive.');
            $pdo->prepare('UPDATE device_registrations SET trial_end = NOW() WHERE id = ?')->execute([$trialId]);
            audit_event($pdo, null, (string) $tr['fp_hash'], 'admin.trial_revoked', "trial=$trialId");
            flash_set('ok', "Trial #$trialId revoked — it is no longer active.");
            header('Location: index.php#trials');
            exit;
        }

        flash_set('err', 'Unknown action.');
        header('Location: ' . $back);
        exit;
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('admin db error: ' . $e->getMessage()); // log the cause, not to the user
        flash_set('err', 'Database error — the action was not completed.');
        header('Location: ' . $back);
        exit;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        flash_set('err', $e->getMessage()); // validation messages only (no secrets)
        header('Location: ' . $back);
        exit;
    }
}

// ── Read queries (GET) ───────────────────────────────────────────────────────
$pq      = trim((string) ($_GET['pq'] ?? ''));        // product search
$aq      = trim((string) ($_GET['aq'] ?? ''));        // account id search
$astatus = trim((string) ($_GET['astatus'] ?? ''));   // account status filter
$account = filter_input(INPUT_GET, 'account', FILTER_VALIDATE_INT); // selected account

// Products (for the list and the create-entitlement dropdown)
if ($pq !== '') {
    $st = $pdo->prepare('SELECT product_id, name_internal FROM products
                         WHERE name_internal LIKE ? OR product_id LIKE ? ORDER BY name_internal');
    $st->execute(['%' . $pq . '%', '%' . $pq . '%']);
} else {
    $st = $pdo->query('SELECT product_id, name_internal FROM products ORDER BY name_internal');
}
$products = $st->fetchAll();

$allProducts = $pq === '' ? $products
    : $pdo->query('SELECT product_id, name_internal FROM products ORDER BY name_internal')->fetchAll();

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

// Recent activity (read-only audit trail; details never contain key material).
$activity = $pdo->query(
    "SELECT action, detail, created_at FROM audit_events
     WHERE action LIKE 'license.%' OR action LIKE 'admin.%'
     ORDER BY id DESC LIMIT 15"
)->fetchAll();

// Selected account detail
$selAccount = null;
$entitlements = [];
$seatsByEnt = [];
if ($account) {
    $st = $pdo->prepare('SELECT id, status FROM accounts WHERE id = ?');
    $st->execute([$account]);
    $selAccount = $st->fetch();
    if ($selAccount) {
        $st = $pdo->prepare('SELECT e.id, e.product_id, p.name_internal, e.seats_total, e.expires_at, e.status,
            (SELECT COUNT(*) FROM seats s WHERE s.entitlement_id = e.id AND s.status = "bound") AS seats_used
          FROM entitlements e LEFT JOIN products p ON p.product_id = e.product_id
          WHERE e.account_id = ? ORDER BY e.id');
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

function ent_state_pill(array $e): string
{
    if ($e['status'] === 'revoked') return '<span class="pill err">revoked</span>';
    if ($e['expires_at'] !== null) {
        $secs = strtotime((string) $e['expires_at']) - time();
        if ($secs < 0)            return '<span class="pill">expired</span>';        // neutral — spent
        if ($secs <= 7 * 86400)   return '<span class="pill warn">expiring soon</span>'; // amber
    }
    return '<span class="pill ok">active</span>';
}

function temp_days_left(?string $expiresAt): int
{
    if ($expiresAt === null) return 0;
    return max(0, (int) ceil((strtotime($expiresAt) - time()) / 86400));
}

function seat_state_pill(string $status): string
{
    if ($status === 'bound')    return '<span class="pill ok">bound</span>';
    if ($status === 'released') return '<span class="pill">released</span>';
    return '<span class="pill">free</span>';
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

<!-- ── SECTION NAV ──────────────────────────────────────────────────────── -->
<nav style="display:flex; flex-wrap:wrap; gap:8px; margin:14px 0 4px;">
  <a class="btn secondary" href="#trials">Trial licenses</a>
  <a class="btn secondary" href="#temp">Temporary licenses</a>
  <a class="btn secondary" href="#accounts">Accounts</a>
  <a class="btn secondary" href="#products">Products</a>
  <a class="btn secondary" href="#activity">Recent activity</a>
</nav>

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

<!-- ── PRODUCTS ─────────────────────────────────────────────────────────── -->
<h2 id="products">Products</h2>
<form method="get" action="index.php" class="row" style="margin-bottom:6px;">
  <div class="field">
    <label for="pq">Search name or ID</label>
    <input type="text" id="pq" name="pq" value="<?= h($pq) ?>" placeholder="e.g. docusnap or 1d2e…">
  </div>
  <button class="btn secondary" type="submit">Search</button>
  <?php if ($pq !== ''): ?><a class="btn secondary" href="index.php">Clear</a><?php endif; ?>
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

<!-- ── RECENT ACTIVITY ──────────────────────────────────────────────────── -->
<h2 id="activity">Recent activity</h2>
<p class="lead" style="margin-bottom:8px;">Audit trail of license actions. Activation keys are never recorded.</p>
<?php if (!$activity): ?>
  <div class="empty">No activity recorded yet.</div>
<?php else: ?>
<table>
  <thead><tr><th style="width:170px;">When</th><th style="width:230px;">Action</th><th>Detail</th></tr></thead>
  <tbody>
  <?php foreach ($activity as $ev): ?>
    <tr>
      <td class="mono muted"><?= h($ev['created_at']) ?></td>
      <td class="mono"><?= h($ev['action']) ?></td>
      <td class="muted"><?= h($ev['detail'] ?? '') ?></td>
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
          <strong>Entitlement #<?= (int) $e['id'] ?></strong> &nbsp; <?= ent_state_pill($e) ?><br>
          <span class="muted">Product:</span> <?= h($e['name_internal'] ?? '(unknown)') ?>
          <span class="mono muted">(<?= h($e['product_id']) ?>)</span><br>
          <span class="muted">Seats:</span> <span class="mono"><?= (int) $e['seats_used'] ?> / <?= (int) $e['seats_total'] ?></span>
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

  <!-- Create entitlement -->
  <div class="card" style="margin-top:6px;">
    <strong>Create entitlement</strong>
    <form method="post" action="index.php" class="row" style="margin-top:10px;">
      <?= csrf_field() ?>
      <input type="hidden" name="action" value="create_entitlement">
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
        <label for="seats_total">Seats</label>
        <input type="number" id="seats_total" name="seats_total" min="1" max="100000" value="1" required style="width:90px;">
      </div>
      <div class="field">
        <label for="expires_at">Expiry (optional)</label>
        <input type="date" id="expires_at" name="expires_at">
      </div>
      <button class="btn" type="submit">Create</button>
    </form>
  </div>
<?php endif; ?>
<?php
admin_page_close();
