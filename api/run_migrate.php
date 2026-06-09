<?php
require_once __DIR__ . '/config.php';
$secret = $_GET['key'] ?? '';
if ($secret !== 'hitc-migrate-2026') { jsonResponse(['error' => 'Unauthorized'], 403); }
$db = getDB();
$results = [];
try {
    // Check settings table structure
    $cols = $db->query("SHOW COLUMNS FROM settings")->fetchAll(PDO::FETCH_COLUMN);
    $results[] = 'Settings columns: ' . implode(', ', $cols);

    // Check if unique key exists on setting_key
    $indexes = $db->query("SHOW INDEX FROM settings WHERE Column_name = 'setting_key'")->fetchAll();
    $results[] = 'Indexes on setting_key: ' . count($indexes);

    // Ensure unique key
    if (count($indexes) == 0) {
        try {
            $db->exec("ALTER TABLE settings ADD UNIQUE KEY uk_setting_key (setting_key)");
            $results[] = 'Added unique key on setting_key';
        } catch (Exception $e) {
            $results[] = 'Unique key: ' . $e->getMessage();
        }
    }

    // Show current msg_ settings
    $settings = $db->query("SELECT setting_key, LEFT(setting_value, 10) as val_preview FROM settings WHERE setting_key LIKE 'msg_%'")->fetchAll();
    $results[] = 'Current msg settings: ' . count($settings);
    foreach ($settings as $s) {
        $results[] = "  {$s['setting_key']} = {$s['val_preview']}...";
    }
} catch (Exception $e) {
    $results[] = 'Error: ' . $e->getMessage();
}
jsonResponse(['results' => $results]);
