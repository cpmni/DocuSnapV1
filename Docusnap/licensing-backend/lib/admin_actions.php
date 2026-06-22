<?php
// licensing-backend/lib/admin_actions.php — shared admin POST dispatcher (Slice 1 of the
// multi-page split). EXTRACTED VERBATIM from public/admin/index.php so every admin page
// routes its write actions through ONE place — CSRF check, POST->redirect->GET and the
// try/catch error funnel stay centralised (no per-page duplication). The caller MUST run
// require_admin() before calling this. A GET returns immediately; a POST validates CSRF,
// dispatches the matching action, redirects and exits. NB: deliberately NOT
// declare(strict_types=1) — the monolith was non-strict, so behaviour stays identical.
// Redirect targets are unchanged (still index.php*) — repointed to per-page files later.

function admin_handle_post(PDO $pdo): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        return;
    }
    $backAccount = filter_input(INPUT_POST, 'account_id', FILTER_VALIDATE_INT);
    $back = $backAccount ? ('account.php?account=' . $backAccount) : 'index.php';

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
            header('Location: account.php?account=' . $accountId);
            exit;
        }

        if ($action === 'set_account_features') {
            // Issue OR upgrade per-feature seat counts in one step: upserts the
            // (account, product, feature) entitlement for core/search/workflow.
            // Additive — the account key is unchanged, so the desktop picks up the
            // new counts on its next online validate. Enforces workflow <= search;
            // core is the only feature that binds a device seat (search/workflow are
            // capacity counts the core enforces). Setting a feature to 0 retires it.
            $accountId = filter_input(INPUT_POST, 'account_id', FILTER_VALIDATE_INT);
            $productId = trim((string) ($_POST['product_id'] ?? ''));
            $counts = [
                'core'     => filter_input(INPUT_POST, 'core', FILTER_VALIDATE_INT),
                'search'   => filter_input(INPUT_POST, 'search', FILTER_VALIDATE_INT),
                'workflow' => filter_input(INPUT_POST, 'workflow', FILTER_VALIDATE_INT),
            ];
            if (!$accountId)       throw new RuntimeException('Choose a valid account.');
            if ($productId === '') throw new RuntimeException('Choose a product.');
            foreach ($counts as $f => $v) {
                if ($v === false || $v === null || $v < 0 || $v > 100000) {
                    throw new RuntimeException("$f seats must be a whole number between 0 and 100000.");
                }
            }
            if ($counts['core'] < 1) throw new RuntimeException('Core seats must be at least 1.');
            if ($counts['workflow'] > $counts['search']) {
                throw new RuntimeException('Workflow seats cannot exceed search seats.');
            }
            $chk = $pdo->prepare('SELECT 1 FROM accounts WHERE id = ?');
            $chk->execute([$accountId]);
            if (!$chk->fetchColumn()) throw new RuntimeException('Account not found.');
            $chk = $pdo->prepare('SELECT 1 FROM products WHERE product_id = ?');
            $chk->execute([$productId]);
            if (!$chk->fetchColumn()) throw new RuntimeException('Product not found.');

            $pdo->beginTransaction();
            foreach ($counts as $feature => $seats) {
                $sel = $pdo->prepare('SELECT id FROM entitlements WHERE account_id = ? AND product_id = ? AND feature = ? AND status = "active" ORDER BY id LIMIT 1');
                $sel->execute([$accountId, $productId, $feature]);
                $row = $sel->fetch();
                if ($seats > 0) {
                    if ($row) {
                        $pdo->prepare('UPDATE entitlements SET seats_total = ? WHERE id = ?')->execute([$seats, (int) $row['id']]);
                    } else {
                        $pdo->prepare('INSERT INTO entitlements (account_id, product_id, feature, seats_total, status) VALUES (?, ?, ?, ?, "active")')
                            ->execute([$accountId, $productId, $feature, $seats]);
                    }
                } elseif ($row) {
                    // 0 seats → retire that feature and release any seats it had bound.
                    $pdo->prepare('UPDATE entitlements SET status = "revoked" WHERE id = ?')->execute([(int) $row['id']]);
                    $pdo->prepare('UPDATE seats SET fp_hash = NULL, released_at = NOW(), status = "released" WHERE entitlement_id = ? AND status = "bound"')->execute([(int) $row['id']]);
                }
            }
            $pdo->commit();
            audit_event($pdo, $accountId, null, 'admin.features_set',
                "product=$productId core={$counts['core']} search={$counts['search']} workflow={$counts['workflow']}");
            flash_set('ok', "Features updated — core {$counts['core']}, search {$counts['search']}, workflow {$counts['workflow']}.");
            header('Location: account.php?account=' . $accountId);
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
            header('Location: account.php?account=' . (int) $ent['account_id']);
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
            header('Location: account.php?account=' . (int) $seat['account_id']);
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
            header('Location: temp.php');
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
            header('Location: temp.php');
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
            header('Location: trials.php');
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
            header('Location: trials.php');
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
