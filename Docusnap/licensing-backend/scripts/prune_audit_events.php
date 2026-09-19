<?php
// scripts/prune_audit_events.php — bound the growth of audit_events (2026-09-19; Part C).
// audit_events gets ONE row per /v1 call — a row per app launch via 'license.validated' — so it grows
// forever. This deletes ONLY old 'license.validated' rows (the high-volume, low-value ones) beyond a
// retention window, in BATCHES so it never long-locks the live table. Every MEANINGFUL event is KEPT:
// activations, revokes, trials, admin.*, webhook.*, and every *_failed. DRY-RUN by default — you must
// pass --apply to actually delete, so a scheduled job can't silently erase history until you opt in.
//
//   php licensing-backend/scripts/prune_audit_events.php                    # dry-run, default 90 days
//   php licensing-backend/scripts/prune_audit_events.php --days=60 --apply  # actually prune >60 days
//   cron (once you're happy with the dry-run counts): nightly --apply
//
// Retention days: --days=N, else env LICENSING_AUDIT_RETENTION_DAYS, else 90. Needs the idx_action_created
// index (schema.sql) for the DELETE to be index-driven. Host-run; self-fails cleanly with no DB.
require __DIR__ . '/../lib/db.php';

$days  = 90;
$apply = false;
foreach ($argv as $a) {
    if ($a === '--apply') { $apply = true; }
    elseif (preg_match('/^--days=(\d+)$/', $a, $m)) { $days = max(1, (int) $m[1]); }
}
$envDays = getenv('LICENSING_AUDIT_RETENTION_DAYS');
if ($envDays !== false && ctype_digit((string) $envDays) && (int) $envDays >= 1) { $days = (int) $envDays; }

try { $pdo = db(); $pdo->query('SELECT 1'); }
catch (Throwable $e) { fwrite(STDERR, 'No DB reachable: ' . $e->getMessage() . "\n"); exit(1); }

// Refuse if the supporting index is missing — an un-indexed cleanup would full-scan the live table
// on every batch. Run the schema.sql ALTER (idx_action_created) first (Oracle §5.5).
if (!$pdo->query("SHOW INDEX FROM audit_events WHERE Key_name = 'idx_action_created'")->fetch()) {
    fwrite(STDERR, "Index idx_action_created is MISSING — add the audit_events indexes (schema.sql ALTER) first, then re-run.\n");
    exit(1);
}

$cutoff = (new DateTime("-$days days"))->format('Y-m-d H:i:s');
$c = $pdo->prepare("SELECT COUNT(*) FROM audit_events WHERE action = 'license.validated' AND created_at < ?");
$c->execute([$cutoff]);
$target = (int) $c->fetchColumn();
$allRows = (int) $pdo->query('SELECT COUNT(*) FROM audit_events')->fetchColumn();

echo "audit_events: $allRows row(s) total; $target 'license.validated' older than $days day(s) (before $cutoff).\n";
if (!$apply) { echo "DRY RUN — nothing deleted. Re-run with --apply to prune them.\n"; exit(0); }
if ($target === 0) { echo "Nothing to prune.\n"; exit(0); }

// Batched, exact-action DELETE — LIMIT keeps each statement short + index-driven; the pause between
// batches yields the table so live /v1 writes are never blocked for long.
$del = $pdo->prepare("DELETE FROM audit_events WHERE action = 'license.validated' AND created_at < ? LIMIT 5000");
$removed = 0;
do {
    $del->execute([$cutoff]);
    $n = $del->rowCount();
    $removed += $n;
    if ($n > 0) { echo "  deleted $removed / $target …\n"; usleep(200000); }   // 0.2s between batches
} while ($n > 0);

echo "Done — pruned $removed old 'license.validated' row(s). Kept every activation, revoke, trial, failure, admin and webhook event.\n";
exit(0);
