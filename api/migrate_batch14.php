<?php
require_once __DIR__ . '/config.php';
$db = getDB();
$results = [];

try {
    $db->exec("
        CREATE TABLE IF NOT EXISTS user_section_access (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            section VARCHAR(50) NOT NULL,
            sub_permission VARCHAR(50) NOT NULL,
            UNIQUE KEY unique_user_section_sub (user_id, section, sub_permission),
            INDEX idx_user (user_id),
            INDEX idx_section (section)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'Created user_section_access table';
} catch (Exception $e) {
    $results[] = 'user_section_access: ' . $e->getMessage();
}

header('Content-Type: application/json');
echo json_encode(['results' => $results]);
