<?php
require_once __DIR__ . '/config.php';
$db = getDB();

try {
    // Find all duplicate budget entries (same category_type, category_id, year, month IS NULL)
    $dupes = $db->query("
        SELECT category_type, category_id, year, COUNT(*) as cnt,
               MAX(id) as keep_id, GROUP_CONCAT(id) as all_ids
        FROM budgets
        WHERE month IS NULL
        GROUP BY category_type, category_id, year
        HAVING COUNT(*) > 1
    ")->fetchAll();

    echo "Found " . count($dupes) . " categories with duplicates.\n";

    $totalDeleted = 0;
    foreach ($dupes as $d) {
        // Keep the latest entry (highest ID), delete the rest
        $stmt = $db->prepare("DELETE FROM budgets WHERE category_type = ? AND category_id = ? AND year = ? AND month IS NULL AND id != ?");
        $stmt->execute([$d['category_type'], $d['category_id'], $d['year'], $d['keep_id']]);
        $deleted = $stmt->rowCount();
        $totalDeleted += $deleted;
        echo "  {$d['category_type']} #{$d['category_id']} year {$d['year']}: kept ID {$d['keep_id']}, deleted $deleted dupes (was: {$d['all_ids']})\n";
    }

    echo "\nTotal deleted: $totalDeleted duplicate rows.\n";
    echo "Done.\n";
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
