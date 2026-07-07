<?php
require_once __DIR__ . '/config.php';
$db = getDB();

try {
    $db->exec("
        CREATE TABLE IF NOT EXISTS followups (
            id INT AUTO_INCREMENT PRIMARY KEY,
            member_id INT NOT NULL,
            assigned_to INT DEFAULT NULL,
            type ENUM('new_member', 'visitor', 'absent', 'pastoral', 'other') NOT NULL DEFAULT 'other',
            status ENUM('pending', 'contacted', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
            priority ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'medium',
            notes TEXT DEFAULT NULL,
            due_date DATE DEFAULT NULL,
            completed_at DATETIME DEFAULT NULL,
            completed_by INT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
            FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL,
            INDEX idx_status (status),
            INDEX idx_type (type),
            INDEX idx_member (member_id),
            INDEX idx_due_date (due_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    echo "followups table created.\n";
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
