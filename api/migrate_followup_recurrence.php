<?php
/**
 * Adds a recurring option to follow-ups.
 *
 * A recurring follow-up (e.g. a monthly pastoral check-in) automatically spawns
 * its next occurrence when the current one is completed/approved, so the pastor
 * doesn't have to recreate it every time. recurrence_parent_id links each new
 * occurrence back to the one it grew from, just for traceability.
 *
 * Run once:  /system/api/migrate_followup_recurrence.php?key=hitc-followup-recurrence-2026
 */

require_once __DIR__ . '/config.php';

if (($_GET['key'] ?? '') !== 'hitc-followup-recurrence-2026') {
    http_response_code(403);
    exit('Forbidden');
}

header('Content-Type: text/plain');
$db = getDB();
$out = [];

function colExists(PDO $db, string $table, string $col): bool {
    $stmt = $db->prepare("
        SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
    ");
    $stmt->execute([$table, $col]);
    return (int)$stmt->fetchColumn() > 0;
}

$columns = [
    // none | daily | weekly | biweekly | monthly | quarterly | yearly
    'recurrence'           => "VARCHAR(20) NOT NULL DEFAULT 'none'",
    'recurrence_parent_id' => "INT NULL DEFAULT NULL",
];

foreach ($columns as $col => $ddl) {
    if (colExists($db, 'followups', $col)) {
        $out[] = "followups.$col already exists, skipped";
        continue;
    }
    $db->exec("ALTER TABLE followups ADD COLUMN `$col` $ddl");
    $out[] = "followups.$col ADDED";
}

$out[] = "DONE";
echo implode("\n", $out) . "\n";
