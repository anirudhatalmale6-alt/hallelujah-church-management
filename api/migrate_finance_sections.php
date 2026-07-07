<?php
require_once __DIR__ . '/config.php';
$db = getDB();

try {
    $db->exec("
        CREATE TABLE IF NOT EXISTS user_finance_sections (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            section VARCHAR(50) NOT NULL,
            UNIQUE KEY unique_user_section (user_id, section),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    echo "user_finance_sections table created.\n";
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
