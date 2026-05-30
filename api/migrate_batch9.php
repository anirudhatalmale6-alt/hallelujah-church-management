<?php
/**
 * Migration Batch 9 - Add specific_date to schedules, reporter_name to department_reports
 */
require_once __DIR__ . '/config.php';

$db = getDB();
$results = [];

// Add specific_date to service_schedules for one-time events
try {
    $db->exec("ALTER TABLE service_schedules ADD COLUMN specific_date DATE DEFAULT NULL AFTER frequency");
    $results[] = "Added specific_date to service_schedules";
} catch (Exception $e) {
    $results[] = "specific_date: " . $e->getMessage();
}

// Add reporter_name to department_reports
try {
    $db->exec("ALTER TABLE department_reports ADD COLUMN reporter_name VARCHAR(255) DEFAULT NULL AFTER submitted_by");
    $results[] = "Added reporter_name to department_reports";
} catch (Exception $e) {
    $results[] = "reporter_name: " . $e->getMessage();
}

echo json_encode(['results' => $results], JSON_PRETTY_PRINT);
