<?php
require_once __DIR__ . '/config.php';
$db = getDB();
$results = [];

// Add 'forsaking' to status ENUM
try {
    $db->exec("ALTER TABLE members MODIFY COLUMN status ENUM('active', 'inactive', 'revoked', 'restored', 'visitor', 'non_member_attendee', 'forsaking') NOT NULL DEFAULT 'active'");
    $results[] = ['step' => 'add_forsaking_enum', 'status' => 'ok'];
} catch (Exception $e) {
    $results[] = ['step' => 'add_forsaking_enum', 'status' => 'error', 'message' => $e->getMessage()];
}

// Show distribution
try {
    $dist = $db->query("SELECT status, COUNT(*) as cnt FROM members GROUP BY status ORDER BY status")->fetchAll();
    $results[] = ['step' => 'distribution', 'data' => $dist];
} catch (Exception $e) {
    $results[] = ['step' => 'distribution', 'status' => 'error', 'message' => $e->getMessage()];
}

jsonResponse(['message' => 'Forsaking status migration complete', 'results' => $results]);
