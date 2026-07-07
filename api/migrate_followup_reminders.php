<?php
require_once __DIR__ . '/config.php';
$db = getDB();
$result = [];

$alters = [
    "ALTER TABLE followups ADD COLUMN remind_email TINYINT(1) NOT NULL DEFAULT 0 AFTER can_edit",
    "ALTER TABLE followups ADD COLUMN remind_sms TINYINT(1) NOT NULL DEFAULT 0 AFTER remind_email",
    "ALTER TABLE followups ADD COLUMN reminder_days_before INT NOT NULL DEFAULT 7 AFTER remind_sms",
    "ALTER TABLE followups ADD COLUMN reminder_sent_at DATETIME DEFAULT NULL AFTER reminder_days_before",
    // phone for staff/leaders so SMS reminders can reach the assigned user
    "ALTER TABLE users ADD COLUMN phone VARCHAR(30) DEFAULT NULL AFTER name",
];

foreach ($alters as $sql) {
    try {
        $db->exec($sql);
        $result[] = ['sql' => $sql, 'status' => 'ok'];
    } catch (Exception $e) {
        $result[] = ['sql' => $sql, 'status' => 'skipped', 'message' => $e->getMessage()];
    }
}

header('Content-Type: application/json');
echo json_encode(['results' => $result]);
