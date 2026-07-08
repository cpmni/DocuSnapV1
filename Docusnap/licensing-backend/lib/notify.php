<?php
// licensing-backend/lib/notify.php — owner notification emails (best-effort).
//
// No composer / SMTP library (the backend is dependency-free), so this uses PHP's
// built-in mail(). Recipient/sender come from environment variables (set via
// set-env.php, like the DB settings), defaulting to licensing@scanfinder.co.uk.
//
// HARD RULE: best-effort only. A mail failure (or mail() not being configured, e.g.
// on the WAMP dev box) must NEVER break a /v1 request — every failure is swallowed
// and written to error_log, never surfaced to the caller. Never include secrets
// (account keys, raw fingerprints); fp_hash is already a hash and is fine.

function notify_owner(string $subject, string $body): void
{
    try {
        // Opt-out switch (default ON). Set LICENSING_NOTIFY_ENABLED=false to silence.
        $enabled = getenv('LICENSING_NOTIFY_ENABLED');
        if ($enabled !== false && strtolower(trim((string) $enabled)) === 'false') {
            return;
        }

        $to   = getenv('LICENSING_NOTIFY_TO')   ?: 'licensing@scanfinder.co.uk';
        $from = getenv('LICENSING_NOTIFY_FROM') ?: 'licensing@scanfinder.co.uk';

        // A single subject/header injection guard: strip CR/LF from anything that
        // reaches a header (subject + addresses come from config, but be safe).
        $clean = static fn(string $s): string => trim(str_replace(["\r", "\n"], ' ', $s));
        $to    = $clean($to);
        $from  = $clean($from);
        $subj  = '[Scan Finder] ' . $clean($subject);

        $headers  = 'From: Scan Finder Licensing <' . $from . ">\r\n";
        $headers .= 'Reply-To: ' . $from . "\r\n";
        $headers .= "MIME-Version: 1.0\r\n";
        $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
        $headers .= "X-Mailer: ScanFinder-Licensing\r\n";

        // The 5th arg sets the envelope sender (-f) so the Return-Path/SPF align with
        // the From domain. Only honoured where PHP/sendmail allows it; harmless otherwise.
        @mail($to, $subj, $body, $headers, '-f' . $from);
    } catch (Throwable $e) {
        error_log('notify_owner failed: ' . $e->getMessage());
    }
}
