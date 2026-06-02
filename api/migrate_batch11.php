<?php
/**
 * Migration Batch 11 - User display titles, checklist categories table
 */
require_once __DIR__ . '/config.php';

$db = getDB();
$results = [];

// Add display_title to users
try {
    $db->exec("ALTER TABLE users ADD COLUMN display_title VARCHAR(100) DEFAULT NULL AFTER role");
    $results[] = "Added display_title to users";
} catch (Exception $e) {
    $results[] = "display_title: " . $e->getMessage();
}

// Create checklist_categories table
try {
    $db->exec("
        CREATE TABLE IF NOT EXISTS checklist_categories (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            color VARCHAR(50) DEFAULT 'bg-gray-100 text-gray-700',
            sort_order INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = "Created checklist_categories table";
} catch (Exception $e) {
    $results[] = "checklist_categories: " . $e->getMessage();
}

// Seed default categories
try {
    $db->exec("INSERT IGNORE INTO checklist_categories (name, color, sort_order) VALUES
        ('Technical', 'bg-blue-100 text-blue-700', 1),
        ('Facility', 'bg-green-100 text-green-700', 2),
        ('Worship', 'bg-purple-100 text-purple-700', 3),
        ('Ministry', 'bg-yellow-100 text-yellow-700', 4),
        ('Safety', 'bg-red-100 text-red-700', 5),
        ('General', 'bg-gray-100 text-gray-700', 6)
    ");
    $results[] = "Seeded default checklist categories";
} catch (Exception $e) {
    $results[] = "seed categories: " . $e->getMessage();
}

echo json_encode(['results' => $results], JSON_PRETTY_PRINT);
