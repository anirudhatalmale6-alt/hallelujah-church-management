<?php
require_once __DIR__ . '/config.php';
$db = getDB();

try {
    // Add card_title column to members
    $db->exec("ALTER TABLE members ADD COLUMN card_title VARCHAR(100) DEFAULT NULL AFTER photo_url");
    echo "card_title column added to members.\n";
} catch (Exception $e) {
    if (strpos($e->getMessage(), 'Duplicate column') !== false) {
        echo "card_title column already exists.\n";
    } else {
        echo "Error: " . $e->getMessage() . "\n";
    }
}
