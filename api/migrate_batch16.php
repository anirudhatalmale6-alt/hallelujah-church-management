<?php
require_once __DIR__ . '/config.php';
$db = getDB();
$results = [];

// Create meeting_notes table
try {
    $db->exec("CREATE TABLE IF NOT EXISTS meeting_notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        meeting_date DATE NOT NULL,
        subjects JSON DEFAULT NULL,
        content LONGTEXT DEFAULT NULL,
        created_by INT NOT NULL,
        updated_by INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_meeting_date (meeting_date),
        INDEX idx_created_by (created_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $results[] = 'Created meeting_notes table';
} catch (Exception $e) {
    $results[] = 'meeting_notes table: ' . $e->getMessage();
}

// Create meeting_note_attachments table
try {
    $db->exec("CREATE TABLE IF NOT EXISTS meeting_note_attachments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        note_id INT NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_size INT DEFAULT 0,
        file_type VARCHAR(100) DEFAULT NULL,
        uploaded_by INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_note_id (note_id),
        CONSTRAINT fk_mna_note FOREIGN KEY (note_id) REFERENCES meeting_notes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $results[] = 'Created meeting_note_attachments table';
} catch (Exception $e) {
    $results[] = 'meeting_note_attachments table: ' . $e->getMessage();
}

header('Content-Type: application/json');
echo json_encode(['results' => $results]);
