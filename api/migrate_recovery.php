<?php
// Adds security-question recovery columns to the users table (idempotent).
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');
$db = getDB();
$done = [];
try {
    $cols = $db->query("SHOW COLUMNS FROM users")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('recovery_question', $cols)) {
        $db->exec("ALTER TABLE users ADD COLUMN recovery_question VARCHAR(255) NULL DEFAULT NULL");
        $done[] = 'added recovery_question';
    } else {
        $done[] = 'recovery_question already present';
    }
    if (!in_array('recovery_answer_hash', $cols)) {
        $db->exec("ALTER TABLE users ADD COLUMN recovery_answer_hash VARCHAR(255) NULL DEFAULT NULL");
        $done[] = 'added recovery_answer_hash';
    } else {
        $done[] = 'recovery_answer_hash already present';
    }
    echo json_encode(['success' => true, 'steps' => $done]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage(), 'steps' => $done]);
}
