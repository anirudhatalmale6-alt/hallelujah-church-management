<?php
require_once __DIR__ . '/config.php';
$db = getDB();
$results = [];

// Add duration_hours to services table
try {
    $db->exec("ALTER TABLE services ADD COLUMN duration_hours DECIMAL(4,1) NOT NULL DEFAULT 2.0 AFTER head_count");
    $results[] = 'Added duration_hours to services';
} catch (Exception $e) {
    $results[] = 'duration_hours: ' . $e->getMessage();
}

// Add marked_by to attendance table
try {
    $db->exec("ALTER TABLE attendance ADD COLUMN marked_by INT NULL AFTER notes");
    $results[] = 'Added marked_by to attendance';
} catch (Exception $e) {
    $results[] = 'marked_by: ' . $e->getMessage();
}

// Add index on marked_by
try {
    $db->exec("ALTER TABLE attendance ADD INDEX idx_marked_by (marked_by)");
    $results[] = 'Added index on marked_by';
} catch (Exception $e) {
    $results[] = 'idx_marked_by: ' . $e->getMessage();
}

header('Content-Type: application/json');
echo json_encode(['results' => $results]);
