<?php
require_once __DIR__ . '/config.php';
$db = getDB();
$results = [];

// 1. Update status ENUM to include revoked and restored
try {
    $db->exec("ALTER TABLE members MODIFY COLUMN status ENUM('active', 'inactive', 'revoked', 'restored', 'visitor', 'non_member_attendee') NOT NULL DEFAULT 'active'");
    $results[] = ['step' => 'alter_status_enum', 'status' => 'ok'];
} catch (Exception $e) {
    $results[] = ['step' => 'alter_status_enum', 'status' => 'error', 'message' => $e->getMessage()];
}

// 2. Migrate people with status='visitor' -> status='active', person_type='non_member_attendee' (if person_type not already set)
try {
    $db->exec("UPDATE members SET person_type = 'non_member_attendee', status = 'active' WHERE status = 'visitor' AND (person_type IS NULL OR person_type = '' OR person_type = 'church_member')");
    $results[] = ['step' => 'migrate_visitors', 'status' => 'ok', 'affected' => $db->query("SELECT ROW_COUNT()")->fetchColumn()];
} catch (Exception $e) {
    $results[] = ['step' => 'migrate_visitors', 'status' => 'error', 'message' => $e->getMessage()];
}

// 3. Migrate non_member_attendee status -> active status with person_type preserved
try {
    $db->exec("UPDATE members SET status = 'active' WHERE status = 'non_member_attendee'");
    $results[] = ['step' => 'migrate_nma_status', 'status' => 'ok', 'affected' => $db->query("SELECT ROW_COUNT()")->fetchColumn()];
} catch (Exception $e) {
    $results[] = ['step' => 'migrate_nma_status', 'status' => 'error', 'message' => $e->getMessage()];
}

// 4. Ensure person_type column exists and is VARCHAR
try {
    $col = $db->query("SHOW COLUMNS FROM members WHERE Field = 'person_type'")->fetch();
    if (!$col) {
        $db->exec("ALTER TABLE members ADD COLUMN person_type VARCHAR(50) DEFAULT 'church_member'");
    }
    $results[] = ['step' => 'ensure_person_type', 'status' => 'ok'];
} catch (Exception $e) {
    $results[] = ['step' => 'ensure_person_type', 'status' => 'error', 'message' => $e->getMessage()];
}

// 5. Show current distribution
try {
    $dist = $db->query("SELECT person_type, status, COUNT(*) as cnt FROM members GROUP BY person_type, status ORDER BY person_type, status")->fetchAll();
    $results[] = ['step' => 'distribution', 'data' => $dist];
} catch (Exception $e) {
    $results[] = ['step' => 'distribution', 'status' => 'error', 'message' => $e->getMessage()];
}

jsonResponse(['message' => 'Status migration complete', 'results' => $results]);
