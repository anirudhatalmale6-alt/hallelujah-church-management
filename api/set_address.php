<?php
require_once __DIR__ . '/config.php';
$db = getDB();

try {
    $stmt = $db->prepare("INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)");
    $stmt->execute(['church_address', '8683 Torresdale Ave - Philadelphia PA 19136']);
    echo "Church address set.\n";

    $stmt2 = $db->prepare("SELECT `key`, value FROM settings WHERE `key` IN ('church_name', 'church_address')");
    $stmt2->execute();
    foreach ($stmt2->fetchAll() as $row) {
        echo $row['key'] . ': ' . $row['value'] . "\n";
    }
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
