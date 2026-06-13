<?php
// licensing-backend/lib/jws.php — compact JWS (alg=EdDSA / Ed25519) signing.
// Uses libsodium with the raw 32-byte seed exported by
// scripts/export_sodium_seed.js. Produces the SAME standard JWS the desktop
// client verifies offline (src/lib/license/token.js).

function b64url(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function sodium_secret_key(string $kid): string
{
    $seedPath = __DIR__ . "/../keys/ed25519_{$kid}_sodium_seed.b64";
    $seedB64  = trim((string) file_get_contents($seedPath));
    $seed     = base64_decode($seedB64, true);
    if ($seed === false || strlen($seed) !== SODIUM_CRYPTO_SIGN_SEEDBYTES) {
        throw new RuntimeException('invalid signing seed');
    }
    $kp = sodium_crypto_sign_seed_keypair($seed);
    return sodium_crypto_sign_secretkey($kp);
}

/**
 * Sign a claims array into a compact JWS.
 * @param array $claims  full claim set (product_id, subject, kind, state, ...)
 * @param string $kid    key id (must match a pinned client key)
 */
function jws_sign(array $claims, string $kid): string
{
    $header = ['alg' => 'EdDSA', 'kid' => $kid, 'typ' => 'JWT'];
    $h = b64url(json_encode($header, JSON_UNESCAPED_SLASHES));
    $p = b64url(json_encode($claims, JSON_UNESCAPED_SLASHES));
    $signingInput = $h . '.' . $p;
    $sig = sodium_crypto_sign_detached($signingInput, sodium_secret_key($kid));
    return $signingInput . '.' . b64url($sig);
}

/**
 * Build the standard trial claim set. not_after == grace_until == issued_at+7d
 * (v1), both retained. Times are ISO-8601 UTC, server-stamped.
 */
function trial_claims(string $productId, string $fpHash, string $state, string $trialStart, string $trialEnd): array
{
    $now   = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $grace = $now->add(new DateInterval('P7D'));
    $iso   = fn(DateTimeInterface $d) => $d->format('Y-m-d\TH:i:s\Z');
    return [
        'product_id'  => $productId,
        'subject'     => 'trial:' . $fpHash,
        'kind'        => 'trial',
        'state'       => $state,
        'trial_start' => $trialStart,
        'trial_end'   => $trialEnd,
        'issued_at'   => $iso($now),
        'not_after'   => $iso($grace),
        'grace_until' => $iso($grace),
        'nonce'       => bin2hex(random_bytes(12)),
    ];
}

/**
 * Build the standard SEAT claim set. The fp binding is carried in fp_hash (the
 * subject is the seat id); the client verifier requires fp_hash === local fp.
 * expires_at may be null (no hard expiry).
 */
function seat_claims(
    string $productId, string $fpHash, string $state, $entitlementId,
    $seatId, int $seatsTotal, int $seatsUsed, ?string $expiresAt
): array {
    $now   = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $grace = $now->add(new DateInterval('P7D'));
    $iso   = fn(DateTimeInterface $d) => $d->format('Y-m-d\TH:i:s\Z');
    return [
        'product_id'     => $productId,
        'subject'        => 'seat:' . $seatId,
        'kind'           => 'seat',
        'state'          => $state,
        'fp_hash'        => $fpHash,
        'entitlement_id' => $entitlementId,
        'seat_id'        => $seatId,
        'seats_total'    => $seatsTotal,
        'seats_used'     => $seatsUsed,
        'expires_at'     => $expiresAt,
        'issued_at'      => $iso($now),
        'not_after'      => $iso($grace),
        'grace_until'    => $iso($grace),
        'nonce'          => bin2hex(random_bytes(12)),
    ];
}
