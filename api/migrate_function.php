<?php
// Adds function_title (a person's role/office e.g. President, Senior Pastor)
// to the members table. Separate from card_title (ID card) on purpose.
// Idempotent. Guarded by a key. Remove from server after running.
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');
if (($_GET['key'] ?? '') !== 'hitc-function-2026') {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}
$db = getDB();
$done = [];
try {
    $cols = $db->query("SHOW COLUMNS FROM members")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('function_title', $cols)) {
        $db->exec("ALTER TABLE members ADD COLUMN function_title VARCHAR(100) NULL DEFAULT NULL AFTER card_title");
        $done[] = 'added function_title';
    } else {
        $done[] = 'function_title already present';
    }
    echo json_encode(['success' => true, 'steps' => $done]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage(), 'steps' => $done]);
}
