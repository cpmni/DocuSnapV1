<?php
// licensing-backend/lib/admin_view.php — shared admin VIEW helpers (Slice 1). The
// entitlement/seat state pills + the temp-days helper, extracted VERBATIM from
// public/admin/index.php so every page renders them identically, plus admin_nav(): the
// real section navigation that replaces the old in-page #anchor links (used by the
// per-page split in later slices). Pure presentation — no DB, no state change.

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

// Makes every <tr data-href="…"> in the page navigate on click (whole-row clickable).
// Clicks landing on an interactive control (link/button/form field inside the row —
// e.g. the trials Extend/Revoke forms) are ignored, so inline actions still work.
// Call ONCE after a table whose rows carry data-href. Pure presentation.
function admin_row_links(): void
{
    echo <<<'HTML'
<script>
(function () {
  document.querySelectorAll('tr[data-href]').forEach(function (tr) {
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', function (e) {
      if (e.target.closest('a, button, input, select, textarea, label, form')) return;
      window.location = tr.getAttribute('data-href');
    });
  });
})();
</script>
HTML;
}

// Top-of-page section nav, current page highlighted (solid vs outline — both .btn classes
// already exist in admin_page_open's CSS). Call right after admin_page_open() on each page.
function admin_nav(string $current): void
{
    // NO-OP since the sidebar redesign (2026-08). The section navigation now lives in
    // the shared chrome (admin_page_open in lib/admin_auth.php) as a left sidebar, with
    // the active item derived from the running script. Kept as a no-op so the existing
    // per-page admin_nav('key') calls stay valid; the $current arg is intentionally ignored.
    unset($current);
}

// Section-page header: an icon tile + title + optional subtitle (mirrors the sidebar
// icons + the dashboard look). Call in place of a bare <h1> at the top of a page.
function admin_page_head(string $iconKey, string $title, string $subtitle = ''): void
{
    static $icons = [
        'dashboard'   => '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
        'accounts'    => '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M17 6.5a3 3 0 0 1 0 5.6M18.5 20a5 5 0 0 0-3-4.6"/>',
        'trials'      => '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        'temp'        => '<path d="M7 3h10M7 21h10M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9"/>',
        'subs'        => '<path d="M21 12a9 9 0 1 1-2.6-6.3M21 4v4h-4"/>',
        'products'    => '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
        'activity'    => '<path d="M3 12h4l2.5 6 5-13L17 12h4"/>',
        'diagnostics' => '<path d="M4.5 4.5v6a5 5 0 0 0 5 5 3 3 0 0 0 3-3v-1"/><path d="M8.5 4.5v6M20 13.5a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0z"/>',
        'releases'    => '<path d="M12 3v11M8 10l4 4 4-4M5 20h14"/>',
        'security'    => '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
    ];
    $svg = $icons[$iconKey] ?? $icons['dashboard'];
    echo '<div class="pagehead"><div class="ic"><svg viewBox="0 0 24 24" aria-hidden="true">' . $svg . '</svg></div><div><h1>' . h($title) . '</h1>';
    if ($subtitle !== '') {
        echo '<div class="sub">' . h($subtitle) . '</div>';
    }
    echo '</div></div>';
}

// Context chips row: each chip = ['n' => count, 'l' => label, 'tone' => ''|'ok'|'warn'|'accent'].
// Pure presentation over counts the page already computed.
function admin_chips(array $chips): void
{
    if (!$chips) {
        return;
    }
    echo '<div class="chips">';
    foreach ($chips as $c) {
        $tone = isset($c['tone']) && in_array($c['tone'], ['ok', 'warn', 'accent'], true) ? ' ' . $c['tone'] : '';
        echo '<span class="cstat' . $tone . '"><span class="d"></span><span class="n">'
            . h((string) ($c['n'] ?? '')) . '</span> <span class="l">'
            . h((string) ($c['l'] ?? '')) . '</span></span>';
    }
    echo '</div>';
}
