<?php
require_once __DIR__ . '/config.php';
$db = getDB();
$results = [];

// Migrate remaining visitor status -> active (keep person_type as is)
try {
    $db->exec("UPDATE members SET status = 'active' WHERE status = 'visitor'");
    $affected = $db->query("SELECT ROW_COUNT()")->fetchColumn();
    $results[] = ['step' => 'migrate_remaining_visitors', 'status' => 'ok', 'affected' => $affected];
} catch (Exception $e) {
    $results[] = ['step' => 'migrate_remaining_visitors', 'status' => 'error', 'message' => $e->getMessage()];
}

// Show final distribution
try {
    $dist = $db->query("SELECT person_type, status, COUNT(*) as cnt FROM members GROUP BY person_type, status ORDER BY person_type, status")->fetchAll();
    $results[] = ['step' => 'final_distribution', 'data' => $dist];
} catch (Exception $e) {
    $results[] = ['step' => 'final_distribution', 'status' => 'error', 'message' => $e->getMessage()];
}

jsonResponse(['message' => 'Status migration v2 complete', 'results' => $results]);
