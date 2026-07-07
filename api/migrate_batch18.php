<?php
require_once __DIR__ . '/config.php';
$db = getDB();

try {
    // Add subject column to followups table
    $cols = $db->query("SHOW COLUMNS FROM followups LIKE 'subject'")->fetchAll();
    if (empty($cols)) {
        $db->exec("ALTER TABLE followups ADD COLUMN subject VARCHAR(255) NULL AFTER member_id");
        echo "Added 'subject' column.\n";
    } else {
        echo "'subject' column already exists.\n";
    }

    // Make member_id nullable
    $db->exec("ALTER TABLE followups MODIFY COLUMN member_id INT NULL");
    echo "Made member_id nullable.\n";

    // Backfill subject from member names for existing follow-ups without subject
    $db->exec("
        UPDATE followups f
        JOIN members m ON m.id = f.member_id
        SET f.subject = CONCAT(m.first_name, ' ', m.last_name)
        WHERE f.subject IS NULL
    ");
    echo "Backfilled subjects from member names.\n";

    echo "Migration batch 18 complete.\n";
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
