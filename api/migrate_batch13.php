<?php
require_once __DIR__ . '/config.php';
$db = getDB();
$results = [];

// 1. Audit log table for tracking edits/deletes
try {
    $db->exec("
        CREATE TABLE IF NOT EXISTS audit_log (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            user_name VARCHAR(255),
            action ENUM('create','edit','delete') NOT NULL,
            entity_type VARCHAR(50) NOT NULL,
            entity_id INT,
            description TEXT,
            old_values JSON,
            new_values JSON,
            ip_address VARCHAR(45),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_entity (entity_type, entity_id),
            INDEX idx_user (user_id),
            INDEX idx_created (created_at),
            INDEX idx_action (action)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'Created audit_log table';
} catch (Exception $e) {
    $results[] = 'audit_log: ' . $e->getMessage();
}

// 2. Add is_pledge_payment column to donations for linking pledge payments
try {
    $db->exec("ALTER TABLE donations ADD COLUMN pledge_id INT DEFAULT NULL AFTER notes");
    $results[] = 'Added pledge_id to donations';
} catch (Exception $e) {
    $results[] = 'pledge_id: ' . $e->getMessage();
}

header('Content-Type: application/json');
echo json_encode(['results' => $results]);
