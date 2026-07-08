<?php
// lib/release.php — advisory "latest release" info for the in-app update banner.
//
// UNSIGNED, NON-GATING, and deliberately EXCEPTION-PROOF. It rides the /v1/validate and
// /v1/status responses that ALSO carry the licence token, and a thrown error there would 500
// the endpoint → the client would receive a tokenless response and, per decideAccess(), treat
// a reachable-but-tokenless reply as authoritative de-licensing (clearing the cached token).
// So EVERY failure path here returns null (the client then simply shows no banner) and this
// function can NEVER abort token minting. Do not let it throw.

/**
 * Return the advisory update block for a channel, or null when unset / on ANY error.
 *   ['latest_version' => 'X.Y.Z', 'update_url' => '...', 'min_supported_version' => '...'?]
 * `min_supported_version` is included when present but is NOT consumed by slice 1 of the client.
 */
function release_info($pdo, $channel) {
    try {
        $ch = in_array($channel, ['msstore', 'nsis'], true) ? $channel : 'msstore';
        $stmt = $pdo->prepare(
            'SELECT latest_version, update_url, min_supported_version FROM releases WHERE channel = ?'
        );
        $stmt->execute([$ch]);
        $row = $stmt->fetch();
        // No row, or an empty version → advertise nothing (banner stays hidden).
        if (!$row || $row['latest_version'] === null || trim((string) $row['latest_version']) === '') {
            return null;
        }
        $out = [
            'latest_version' => (string) $row['latest_version'],
            'update_url'     => (string) $row['update_url'],
        ];
        if ($row['min_supported_version'] !== null && trim((string) $row['min_supported_version']) !== '') {
            $out['min_supported_version'] = (string) $row['min_supported_version'];
        }
        return $out;
    } catch (Throwable $e) {
        // Missing table (migration ordering), bad query, PDO hiccup — advisory info is never
        // worth failing a licence validation over.
        error_log('release_info skipped: ' . $e->getMessage());
        return null;
    }
}
