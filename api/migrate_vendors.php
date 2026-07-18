<?php
/**
 * Creates the vendors registry.
 *
 * Until now a "vendor" was just a distinct value typed into expenses.vendor -
 * there was no place to keep a business's contact details (address, phone,
 * email, website) and no clean way to attach a business name (like "HC Store"
 * or "Amazon") to an income record without accidentally turning it into a
 * person in the People list.
 *
 * This adds a real `vendors` table and backfills it from the vendor names that
 * already exist on expenses, so the autocomplete keeps working with no gaps.
 *
 * Run once:  /system/api/migrate_vendors.php?key=hitc-vendors-2026
 */

require_once __DIR__ . '/config.php';

if (($_GET['key'] ?? '') !== 'hitc-vendors-2026') {
    http_response_code(403);
    exit('Forbidden');
}

header('Content-Type: text/plain');
$db = getDB();
$out = [];

try {
    $db->exec("
        CREATE TABLE IF NOT EXISTS vendors (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(150) NOT NULL,
            category VARCHAR(100) NULL,
            phone VARCHAR(50) NULL,
            email VARCHAR(150) NULL,
            website VARCHAR(200) NULL,
            address VARCHAR(300) NULL,
            notes TEXT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_by INT NULL,
            created_at DATETIME NULL,
            updated_at DATETIME NULL,
            UNIQUE KEY uniq_vendor_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $out[] = 'vendors table ready';
} catch (Exception $e) {
    $out[] = 'ERROR creating table: ' . $e->getMessage();
}

// Backfill from existing expense vendor names (skip ones already present).
$added = 0;
try {
    $names = $db->query("SELECT DISTINCT TRIM(vendor) AS v FROM expenses WHERE vendor IS NOT NULL AND TRIM(vendor) <> ''")->fetchAll(PDO::FETCH_COLUMN);
    $exists = $db->prepare("SELECT 1 FROM vendors WHERE LOWER(name) = LOWER(?) LIMIT 1");
    $ins = $db->prepare("INSERT INTO vendors (name, is_active, created_at) VALUES (?, 1, NOW())");
    foreach ($names as $n) {
        $exists->execute([$n]);
        if ($exists->fetchColumn()) continue;
        try { $ins->execute([$n]); $added++; } catch (Exception $e) { /* race/dupe */ }
    }
    $out[] = "backfilled $added vendor(s) from expenses";
} catch (Exception $e) {
    $out[] = 'ERROR backfilling: ' . $e->getMessage();
}

$total = (int)$db->query("SELECT COUNT(*) FROM vendors")->fetchColumn();
$out[] = "total vendors now: $total";

echo implode("\n", $out) . "\n\nDone.\n";
