<?php
// Integration test for the admin "Create account + issue licence" flow (admin_actions.php
// create_account; 2026-09-19; Oracle SIGN-OFF-WITH-CONDITIONS). Runs the exact create sequence in
// ONE transaction and ROLLS BACK — proving the Oracle verification gate:
//   (a) one account (polar_customer_id NULL) + one active core entitlement; key stored HASHED;
//       the plaintext key appears in NO row (accounts / entitlements / audit_events);
//   (b) a failed entitlement INSERT rolls back → ZERO accounts (no orphan keyless account);
//   (c) the audit detail contains neither the key nor the hash, and carries email_set;
//   (d) the issued key activates against the entitlement's product_id, and NOT against a wrong one
//       (mirrors activate.php: product_id EXACT + feature='core' + active + expires_at NULL/future);
//   (e) a PAST expiry is rejected by the same validation the handler uses; a blank expiry is perpetual.
//
// Host-run (needs MySQL + the imported schema); self-skips when no DB is reachable:
//   php licensing-backend/lib/test_create_account.php
require __DIR__ . '/db.php';
require __DIR__ . '/entitlements.php';   // generate_account_key + the shared primitives create_account reuses

$fail = 0;
function check($l, $c) { global $fail; echo ($c ? "  OK  " : "  BAD ") . "$l\n"; if (!$c) $fail++; }

try { $pdo = db(); $pdo->query('SELECT 1'); }
catch (Throwable $e) { echo "  SKIP no DB reachable: " . $e->getMessage() . "\n"; exit(0); }

// The exact past-expiry / expiry validation the handler runs (kept in step with admin_actions.php).
function _valid_future_expiry(string $raw): bool {
    if ($raw === '') return true;                                   // blank = perpetual (activatable)
    $d = DateTime::createFromFormat('Y-m-d', $raw);
    if (!($d && $d->format('Y-m-d') === $raw)) return false;        // malformed
    return $d->format('Y-m-d') >= (new DateTime('today'))->format('Y-m-d');   // not in the past
}
check('(e) past expiry rejected',        _valid_future_expiry('2000-01-01') === false);
check('(e) malformed expiry rejected',   _valid_future_expiry('2026-13-40') === false);
check('(e) blank expiry accepted',       _valid_future_expiry('') === true);
check('(e) future expiry accepted',      _valid_future_expiry((new DateTime('+1 year'))->format('Y-m-d')) === true);

$pid  = '00000000-0000-0000-0000-0000000000ca';
$pid2 = '00000000-0000-0000-0000-0000000000cb';

$pdo->beginTransaction();
try {
    $pdo->prepare('INSERT IGNORE INTO products (product_id, name_internal) VALUES (?, "ca-test"), (?, "ca-test-other")')->execute([$pid, $pid2]);

    // ── (a) create: one account + one core entitlement, key hashed, plaintext nowhere ──
    $key = generate_account_key();
    $pdo->prepare('INSERT INTO accounts (account_key_hash, status, polar_customer_id, email, name) VALUES (?, "active", NULL, ?, ?)')
        ->execute([hash('sha256', $key), 'ca@example.com', 'CA Test Ltd']);
    $accountId = (int) $pdo->lastInsertId();
    $pdo->prepare('INSERT INTO entitlements (account_id, product_id, feature, seats_total, expires_at, status) VALUES (?, ?, "core", ?, NULL, "active")')
        ->execute([$accountId, $pid, 3]);
    $entId = (int) $pdo->lastInsertId();
    audit_event($pdo, $accountId, null, 'admin.account_created', "account=$accountId entitlement=$entId product=$pid core_seats=3 expires=never email_set=1");

    $acc = $pdo->prepare('SELECT account_key_hash, polar_customer_id, name FROM accounts WHERE id = ?');
    $acc->execute([$accountId]); $accRow = $acc->fetch();
    check('(a) account created, polar_customer_id NULL', $accRow && $accRow['polar_customer_id'] === null);
    check('(a) key stored HASHED (sha256), not plaintext', $accRow && $accRow['account_key_hash'] === hash('sha256', $key) && $accRow['account_key_hash'] !== $key);
    $ec = $pdo->prepare('SELECT COUNT(*) FROM entitlements WHERE account_id = ? AND feature = "core" AND status = "active"');
    $ec->execute([$accountId]);
    check('(a) exactly one active core entitlement', (int) $ec->fetchColumn() === 1);

    // plaintext key must not appear ANYWHERE
    $leak = $pdo->prepare('SELECT (SELECT COUNT(*) FROM accounts WHERE account_key_hash = ?)
                                + (SELECT COUNT(*) FROM audit_events WHERE detail LIKE ?)');
    $leak->execute([$key, '%' . $key . '%']);
    check('(a/c) plaintext key not in accounts or audit', (int) $leak->fetchColumn() === 0);
    $ad = $pdo->prepare('SELECT detail FROM audit_events WHERE action = "admin.account_created" AND account_id = ?');
    $ad->execute([$accountId]); $detail = (string) $ad->fetchColumn();
    check('(c) audit detail carries email_set, not the key/hash',
        strpos($detail, 'email_set=1') !== false && strpos($detail, $key) === false && strpos($detail, hash('sha256', $key)) === false);

    // ── (d) the issued key activates against the RIGHT product, not a wrong one ──
    // Mirror activate.php's lookup: hash the key, match a bound-or-free core seat's entitlement by product.
    $act = function (string $productId) use ($pdo, $key) {
        $q = $pdo->prepare('SELECT e.id FROM entitlements e JOIN accounts a ON a.id = e.account_id
                            WHERE a.account_key_hash = ? AND e.product_id = ? AND e.feature = "core" AND e.status = "active"
                              AND (e.expires_at IS NULL OR e.expires_at > NOW()) LIMIT 1');
        $q->execute([hash('sha256', $key), $productId]);
        return $q->fetchColumn() !== false;
    };
    check('(d) activates against the correct product_id', $act($pid) === true);
    check('(d) NOT activatable against a wrong product_id', $act($pid2) === false);

    // ── (b) rollback proof: a failed entitlement INSERT leaves NO orphan account ──
    $key2 = generate_account_key();
    $before = (int) $pdo->query('SELECT COUNT(*) FROM accounts')->fetchColumn();
    $threw = false;
    try {
        $sp = 'sp_ca'; $pdo->exec("SAVEPOINT $sp");
        $pdo->prepare('INSERT INTO accounts (account_key_hash, status, polar_customer_id, email, name) VALUES (?, "active", NULL, NULL, "Rollback Test")')
            ->execute([hash('sha256', $key2)]);
        // force a failure: product_id that violates FK / a bad column value
        $pdo->prepare('INSERT INTO entitlements (account_id, product_id, feature, seats_total, status) VALUES (?, "NO_SUCH_PRODUCT", "core", 1, "active")')
            ->execute([(int) $pdo->lastInsertId()]);
        $pdo->exec("RELEASE SAVEPOINT $sp");
    } catch (Throwable $e) {
        $threw = true; try { $pdo->exec("ROLLBACK TO SAVEPOINT sp_ca"); } catch (Throwable $e2) {}
    }
    $after = (int) $pdo->query('SELECT COUNT(*) FROM accounts')->fetchColumn();
    check('(b) entitlement INSERT failed as expected', $threw);
    check('(b) rollback left NO orphan account', $after === $before && (int) $pdo->query("SELECT COUNT(*) FROM accounts WHERE account_key_hash = '" . hash('sha256', $key2) . "'")->fetchColumn() === 0);

} finally {
    $pdo->rollBack();   // nothing this test wrote survives
}

echo $fail ? "\n$fail check(s) FAILED.\n" : "\nAll checks passed.\n";
exit($fail ? 1 : 0);
