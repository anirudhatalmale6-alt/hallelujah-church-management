<?php
require_once __DIR__ . '/config.php';

$db = getDB();
$results = [];

try {
    $db->exec("ALTER TABLE members MODIFY COLUMN status ENUM('active', 'inactive', 'visitor', 'non_member_attendee') NOT NULL DEFAULT 'active'");
    $results[] = 'Added non_member_attendee to status ENUM';
} catch (Exception $e) {
    $results[] = 'Status ENUM: ' . $e->getMessage();
}

try {
    $db->exec("ALTER TABLE members MODIFY COLUMN gender ENUM('male', 'female') DEFAULT NULL");
    $results[] = 'Removed other from gender ENUM';
} catch (Exception $e) {
    $results[] = 'Gender ENUM: ' . $e->getMessage();
}

jsonResponse(['results' => $results]);
