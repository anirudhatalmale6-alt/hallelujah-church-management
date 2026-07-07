<?php
require_once __DIR__ . '/config.php';
$db = getDB();
$result = [];

try {
    $db->exec("ALTER TABLE followups MODIFY COLUMN status ENUM('pending','contacted','pending_approval','completed','cancelled') NOT NULL DEFAULT 'pending'");
    $result[] = 'Added pending_approval to status ENUM';
} catch (Exception $e) {
    $result[] = 'ENUM already updated or error: ' . $e->getMessage();
}

try {
    $db->exec("ALTER TABLE followups ADD COLUMN can_edit TINYINT(1) NOT NULL DEFAULT 0 AFTER completed_by");
    $result[] = 'Added can_edit column';
} catch (Exception $e) {
    $result[] = 'can_edit exists or error: ' . $e->getMessage();
}

try {
    $db->exec("ALTER TABLE followups ADD COLUMN approved_by INT DEFAULT NULL AFTER can_edit");
    $result[] = 'Added approved_by column';
} catch (Exception $e) {
    $result[] = 'approved_by exists or error: ' . $e->getMessage();
}

try {
    $db->exec("ALTER TABLE followups ADD COLUMN approved_at DATETIME DEFAULT NULL AFTER approved_by");
    $result[] = 'Added approved_at column';
} catch (Exception $e) {
    $result[] = 'approved_at exists or error: ' . $e->getMessage();
}

try {
    $db->exec("ALTER TABLE followups ADD COLUMN completion_notes TEXT DEFAULT NULL AFTER approved_at");
    $result[] = 'Added completion_notes column';
} catch (Exception $e) {
    $result[] = 'completion_notes exists or error: ' . $e->getMessage();
}

header('Content-Type: application/json');
echo json_encode(['results' => $result]);
