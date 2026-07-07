<?php
require_once __DIR__ . '/config.php';

$db = getDB();

$queries = [
    // Member check-in codes (QR + PIN)
    "CREATE TABLE IF NOT EXISTS member_checkin_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        member_id INT NOT NULL UNIQUE,
        qr_code VARCHAR(64) NOT NULL UNIQUE,
        pin_code VARCHAR(6) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
        INDEX idx_qr (qr_code),
        INDEX idx_pin (pin_code)
    ) ENGINE=InnoDB",

    // Check-in / check-out logs
    "CREATE TABLE IF NOT EXISTS checkin_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        member_id INT NOT NULL,
        service_id INT DEFAULT NULL,
        check_in_time DATETIME NOT NULL,
        check_out_time DATETIME DEFAULT NULL,
        checkin_method ENUM('qr', 'pin', 'manual') NOT NULL DEFAULT 'manual',
        checked_in_by INT DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
        INDEX idx_member (member_id),
        INDEX idx_service (service_id),
        INDEX idx_checkin_time (check_in_time)
    ) ENGINE=InnoDB",

    // Follow-ups
    "CREATE TABLE IF NOT EXISTS followups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        member_id INT NOT NULL,
        assigned_to INT DEFAULT NULL,
        type ENUM('new_member', 'visitor', 'absent', 'pastoral', 'other') NOT NULL DEFAULT 'other',
        status ENUM('pending', 'contacted', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
        priority ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
        notes TEXT DEFAULT NULL,
        due_date DATE DEFAULT NULL,
        completed_at DATETIME DEFAULT NULL,
        completed_by INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
        INDEX idx_status (status),
        INDEX idx_type (type),
        INDEX idx_assigned (assigned_to),
        INDEX idx_due (due_date)
    ) ENGINE=InnoDB",

    // Documents
    "CREATE TABLE IF NOT EXISTS documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category ENUM('sermon', 'meeting_notes', 'policy', 'form', 'other') NOT NULL DEFAULT 'other',
        file_path VARCHAR(500) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_size INT DEFAULT 0,
        file_type VARCHAR(100) DEFAULT NULL,
        description TEXT DEFAULT NULL,
        uploaded_by INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (uploaded_by) REFERENCES users(id),
        INDEX idx_category (category),
        INDEX idx_created (created_at)
    ) ENGINE=InnoDB",
];

$results = [];
foreach ($queries as $sql) {
    try {
        $db->exec($sql);
        preg_match('/CREATE TABLE IF NOT EXISTS (\w+)/', $sql, $m);
        $results[] = ['table' => $m[1] ?? '?', 'status' => 'ok'];
    } catch (Exception $e) {
        preg_match('/CREATE TABLE IF NOT EXISTS (\w+)/', $sql, $m);
        $results[] = ['table' => $m[1] ?? '?', 'status' => 'error', 'message' => $e->getMessage()];
    }
}

jsonResponse(['message' => 'Migration complete', 'results' => $results]);
