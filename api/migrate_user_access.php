<?php
// Per-user access controls:
//  - view_only: the account can see information but cannot add/edit/delete.
//  - hide_sensitive: the account sees people's names only, not phone/email/address/etc.
// Idempotent. Guarded by a key. Remove from server after running.
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');
if (($_GET['key'] ?? '') !== 'hitc-user-access-2026') {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}
$db = getDB();
$done = [];
try {
    $cols = $db->query("SHOW COLUMNS FROM users")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('view_only', $cols)) {
        $db->exec("ALTER TABLE users ADD COLUMN view_only TINYINT(1) NOT NULL DEFAULT 0 AFTER role");
        $done[] = 'added users.view_only';
    } else { $done[] = 'view_only already present'; }
    if (!in_array('hide_sensitive', $cols)) {
        $db->exec("ALTER TABLE users ADD COLUMN hide_sensitive TINYINT(1) NOT NULL DEFAULT 0 AFTER view_only");
        $done[] = 'added users.hide_sensitive';
    } else { $done[] = 'hide_sensitive already present'; }
    echo json_encode(['success' => true, 'steps' => $done]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage(), 'steps' => $done]);
}
