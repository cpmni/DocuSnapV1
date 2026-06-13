<?php
// public/admin/logout.php — end the admin session.
require __DIR__ . '/../../lib/admin_auth.php';
admin_session_boot();
admin_logout();
header('Location: login.php');
exit;
