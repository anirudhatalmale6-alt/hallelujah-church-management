<?php
require_once __DIR__ . '/config.php';

$db = getDB();

try {
    // Convert existing 'financial_statements' finance section entries
    // to the 3 new granular permissions: income_statement, balance_sheet, budget_actual
    $stmt = $db->query("SELECT id, user_id FROM user_finance_sections WHERE section = 'financial_statements'");
    $rows = $stmt->fetchAll();

    if (count($rows) > 0) {
        $insert = $db->prepare("INSERT IGNORE INTO user_finance_sections (user_id, section) VALUES (?, ?)");
        foreach ($rows as $row) {
            $insert->execute([$row['user_id'], 'income_statement']);
            $insert->execute([$row['user_id'], 'balance_sheet']);
            $insert->execute([$row['user_id'], 'budget_actual']);
        }
        // Remove old entries
        $db->exec("DELETE FROM user_finance_sections WHERE section = 'financial_statements'");
        echo "Migrated " . count($rows) . " user(s) from 'financial_statements' to granular permissions.\n";
    } else {
        echo "No 'financial_statements' entries to migrate.\n";
    }

    echo "Migration batch 17 complete.\n";
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
