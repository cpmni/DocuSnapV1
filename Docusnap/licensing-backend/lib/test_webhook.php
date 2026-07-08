<?php
// Unit test for the PURE webhook helpers (signature + payload validation). No DB / no
// HTTP, so it runs with plain PHP: `php licensing-backend/lib/test_webhook.php`.
// The DB-dependent paths (idempotency, mutation) are exercised by curl on the host.
require __DIR__ . '/webhook.php';

$fail = 0;
function check($label, $cond) { global $fail; echo ($cond ? "  OK  " : "  BAD ") . "$label\n"; if (!$cond) $fail++; }

// ── HMAC signature ──────────────────────────────────────────────────────────────
$secret = 'topsecret';
$raw    = '{"event_id":"e1","type":"features.set"}';
$good   = 'sha256=' . hash_hmac('sha256', $raw, $secret);
check('valid signature accepted',          webhook_signature_ok($raw, $good, $secret) === true);
check('tampered body rejected',            webhook_signature_ok('{"event_id":"e2"}', $good, $secret) === false);
check('wrong secret rejected',             webhook_signature_ok($raw, $good, 'other') === false);
check('missing signature rejected',        webhook_signature_ok($raw, null, $secret) === false);
check('dormant (no secret) rejected',      webhook_signature_ok($raw, $good, null) === false);

// ── payload validation + replay window ──────────────────────────────────────────
$now  = 1_000_000;
$base = ['event_id' => 'e1', 'type' => 'features.set', 'account_key' => 'KEY',
         'product_id' => 'p', 'timestamp' => $now, 'features' => ['search' => 2, 'workflow' => 1]];

$v = webhook_validate_payload($base, 300, $now);
check('valid payload normalises',          $v['ok'] === true && $v['event']['features']['search'] === 2 && $v['event']['features']['workflow'] === 1);
check('ISO-8601 timestamp accepted',       webhook_validate_payload(['timestamp' => gmdate('c', $now)] + $base, 300, $now)['ok'] === true);
check('stale timestamp rejected (replay)', webhook_validate_payload(['timestamp' => $now - 1000] + $base, 300, $now)['ok'] === false);
check('future timestamp rejected',         webhook_validate_payload(['timestamp' => $now + 1000] + $base, 300, $now)['ok'] === false);
check('missing event_id rejected',         webhook_validate_payload(['event_id' => ''] + $base, 300, $now)['ok'] === false);
check('missing account_key rejected',      webhook_validate_payload(['account_key' => ''] + $base, 300, $now)['ok'] === false);
check('workflow > search rejected',        webhook_validate_payload(['features' => ['search' => 1, 'workflow' => 5]] + $base, 300, $now)['ok'] === false);
check('non-numeric seat rejected',         webhook_validate_payload(['features' => ['search' => 'lots']] + $base, 300, $now)['ok'] === false);
check('unknown feature key ignored',       (function () use ($base, $now) { $r = webhook_validate_payload(['features' => ['search' => 2, 'evil' => 9]] + $base, 300, $now); return $r['ok'] && !isset($r['event']['features']['evil']); })());

echo $fail ? "\n$fail FAILED\n" : "\nAll webhook helper checks passed.\n";
exit($fail ? 1 : 0);
