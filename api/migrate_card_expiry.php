<?php
require_once __DIR__ . '/config.php';
$db = getDB();

try {
    $db->exec("ALTER TABLE members ADD COLUMN card_expiry_date DATE DEFAULT NULL AFTER card_title");
    echo json_encode(['success' => true, 'message' => 'Added card_expiry_date column to members']);
} catch (PDOException $e) {
    if (strpos($e->getMessage(), 'Duplicate column') !== false) {
        echo json_encode(['success' => true, 'message' => 'Column already exists']);
    } else {
        echo json_encode(['error' => $e->getMessage()]);
    }
}
