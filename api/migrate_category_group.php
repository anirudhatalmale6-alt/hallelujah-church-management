<?php
// Adds category_group (e.g. "Utilities") to expense_categories so related
// categories (Electricity, Gas, Internet, Water) can be grouped and rolled up
// on reports. Idempotent. Guarded by a key. Remove from server after running.
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');
if (($_GET['key'] ?? '') !== 'hitc-category-group-2026') {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}
$db = getDB();
$done = [];
try {
    $cols = $db->query("SHOW COLUMNS FROM expense_categories")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('category_group', $cols)) {
        $db->exec("ALTER TABLE expense_categories ADD COLUMN category_group VARCHAR(100) NULL DEFAULT NULL AFTER description");
        $done[] = 'added expense_categories.category_group';
    } else {
        $done[] = 'category_group already present';
    }
    echo json_encode(['success' => true, 'steps' => $done]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage(), 'steps' => $done]);
}
