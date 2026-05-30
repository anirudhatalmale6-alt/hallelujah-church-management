<?php
/**
 * Migration Batch 10 - Department members (user-department assignments)
 */
require_once __DIR__ . '/config.php';

$db = getDB();
$results = [];

// Department members junction table
try {
    $db->exec("
        CREATE TABLE IF NOT EXISTS department_members (
            id INT AUTO_INCREMENT PRIMARY KEY,
            department_id INT NOT NULL,
            user_id INT NOT NULL,
            role VARCHAR(30) DEFAULT 'member',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_dept_user (department_id, user_id),
            FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = "Created department_members table";
} catch (Exception $e) {
    $results[] = "department_members: " . $e->getMessage();
}

// Add department_reports permission type
try {
    $db->exec("INSERT IGNORE INTO user_permissions (user_id, permission) SELECT id, 'department_reports' FROM users WHERE role IN ('pastor', 'admin')");
    $results[] = "Added department_reports permission to admins";
} catch (Exception $e) {
    $results[] = "permissions: " . $e->getMessage();
}

echo json_encode(['results' => $results], JSON_PRETTY_PRINT);
