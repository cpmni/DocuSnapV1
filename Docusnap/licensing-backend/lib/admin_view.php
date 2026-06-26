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
    // Targets evolve per migration slice: a section still on the dashboard points at
    // index.php#anchor; once carved into its own page it points at that page.
    $items = [
        'index'    => ['index.php',          'Dashboard'],
        'accounts' => ['accounts.php',       'Accounts'],            // split (Slice 4)
        'trials'   => ['trials.php',         'Trials'],              // split (Slice 3)
        'temp'     => ['temp.php',           'Temporary licenses'],  // split (Slice 3)
        'products' => ['products.php',       'Products'],            // split (Slice 2)
        'activity' => ['activity.php',       'Activity'],            // split (Slice 2)
    ];
    echo '<nav style="display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 18px;">';
    foreach ($items as $key => [$href, $label]) {
        $cls = $key === $current ? 'btn' : 'btn secondary';
        echo '<a class="' . $cls . '" href="' . $href . '">' . h($label) . '</a>';
    }
    echo '</nav>';
}
