<?php
require_once __DIR__ . '/config.php';
$db = getDB();

try {
    $db->exec("
        CREATE TABLE IF NOT EXISTS user_document_folders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            folder VARCHAR(50) NOT NULL,
            UNIQUE KEY unique_user_folder (user_id, folder),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    echo "Table user_document_folders created.\n";
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
