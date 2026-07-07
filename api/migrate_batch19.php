<?php
require_once __DIR__ . '/config.php';
$db = getDB();

try {
    $cols = $db->query("SHOW COLUMNS FROM followups LIKE 'custom_type'")->fetchAll();
    if (empty($cols)) {
        $db->exec("ALTER TABLE followups ADD COLUMN custom_type VARCHAR(100) NULL AFTER type");
        echo "Added 'custom_type' column.\n";
    } else {
        echo "'custom_type' column already exists.\n";
    }
    echo "Migration batch 19 complete.\n";
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
