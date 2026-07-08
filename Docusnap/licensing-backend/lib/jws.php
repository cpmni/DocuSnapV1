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

// Trial entitlement policy: the in-app 14-day trial INCLUDES this many detached
// SEARCH client seats by DEFAULT (the workflow add-on is NOT included in a trial).
// A per-trial override (device_registrations.trial_search_seats, set by an admin) can
// raise or lower this for a specific trial. Granted only while the trial is active —
// an expired trial grants none, so the capability lasts exactly the trial duration.
// Carried in the signed token's features map (below) so the desktop enforces it
// identically to a paid seat (token.featuresOf).
const TRIAL_SEARCH_SEATS = 2;

/**
 * Per-feature capacity granted to a trial, given its current state. Same
 * {core|search|workflow => count} shape the seat token carries. $searchSeats is the
 * per-trial override; NULL falls back to the TRIAL_SEARCH_SEATS default. Negatives are
 * floored at 0.
 */
function trial_features(string $state, ?int $searchSeats = null): array
{
    $active = $state === 'active';
    $seats  = $searchSeats === null ? TRIAL_SEARCH_SEATS : max(0, $searchSeats);
    return [
        'core'     => 1,
        'search'   => $active ? $seats : 0,
        'workflow' => 0,
    ];
}

/**
 * Build the standard trial claim set. not_after == grace_until == issued_at+7d
 * (v1), both retained. Times are ISO-8601 UTC, server-stamped.
 *
 * When $features is non-empty the claim set carries schema_version 2 + a SIGNED
 * features map (tamper-proof, offline-verifiable) so the desktop grants the trial's
 * detached-client capacity exactly as it does for a paid seat. Omitting it leaves the
 * claim set byte-identical to the pre-feature trial token (backward compatible).
 */
function trial_claims(string $productId, string $fpHash, string $state, string $trialStart, string $trialEnd, array $features = []): array
{
    $now   = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $grace = $now->add(new DateInterval('P7D'));
    $iso   = fn(DateTimeInterface $d) => $d->format('Y-m-d\TH:i:s\Z');
    $claims = [
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
    if ($features) {
        $claims['schema_version'] = 2;
        $claims['features']       = (object) $features;
    }
    return $claims;
}

/**
 * Build the standard SEAT claim set. The fp binding is carried in fp_hash (the
 * subject is the seat id); the client verifier requires fp_hash === local fp.
 * expires_at may be null (no hard expiry).
 */
function seat_claims(
    string $productId, string $fpHash, string $state, $entitlementId,
    $seatId, int $seatsTotal, int $seatsUsed, ?string $expiresAt,
    array $features = []
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
        // Phase 2: per-feature seat capacity, SIGNED (tamper-proof, offline-verifiable)
        // so the desktop enforces it without trusting the unsigned JSON response.
        // Additive — a verifier that doesn't know the claim ignores it; schema_version
        // 2 marks its presence. Map of feature_key => seats_total (core|search|workflow).
        'schema_version' => 2,
        'features'       => (object) $features,
        'issued_at'      => $iso($now),
        'not_after'      => $iso($grace),
        'grace_until'    => $iso($grace),
        'nonce'          => bin2hex(random_bytes(12)),
    ];
}
