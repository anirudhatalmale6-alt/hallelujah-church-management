<?php
require_once __DIR__ . '/config.php';

$secret = $_GET['key'] ?? '';
if ($secret !== 'hitc-migrate-2026') {
    jsonResponse(['error' => 'Unauthorized'], 403);
}

$db = getDB();
$results = [];

try {
    $db->exec("
        CREATE TABLE IF NOT EXISTS pledges (
            id INT AUTO_INCREMENT PRIMARY KEY,
            member_id INT NOT NULL,
            category_id INT NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            frequency ENUM('weekly','monthly','quarterly','annually') DEFAULT 'monthly',
            start_date DATE NOT NULL,
            end_date DATE DEFAULT NULL,
            notes VARCHAR(500) DEFAULT NULL,
            status ENUM('active','completed','cancelled') DEFAULT 'active',
            created_by INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (member_id) REFERENCES members(id),
            FOREIGN KEY (category_id) REFERENCES donation_categories(id),
            FOREIGN KEY (created_by) REFERENCES users(id),
            INDEX idx_member (member_id),
            INDEX idx_status (status),
            INDEX idx_dates (start_date, end_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'pledges table created';

} catch (Exception $e) {
    $results[] = 'Error: ' . $e->getMessage();
}

jsonResponse(['results' => $results]);
