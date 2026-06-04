<?php
require_once __DIR__ . '/config.php';

$secret = $_GET['key'] ?? '';
if ($secret !== 'hitc-migrate-2026') {
    jsonResponse(['error' => 'Unauthorized'], 403);
}

$db = getDB();
$results = [];

try {
    // Sync: create accounts for any expense categories missing from Chart of Accounts
    $expenseParent = $db->query("SELECT id FROM accounts WHERE account_type = 'expense' AND parent_id IS NULL LIMIT 1")->fetchColumn();
    if ($expenseParent) {
        $cats = $db->query("SELECT name, description, fund_type FROM expense_categories WHERE is_active = 1")->fetchAll();
        foreach ($cats as $c) {
            $exists = $db->prepare("SELECT COUNT(*) FROM accounts WHERE account_type = 'expense' AND name = ?");
            $exists->execute([$c['name']]);
            if ((int)$exists->fetchColumn() === 0) {
                $maxOrder = (int)$db->query("SELECT COALESCE(MAX(sort_order), 0) FROM accounts WHERE account_type = 'expense'")->fetchColumn() + 1;
                $nextNum = (int)$db->query("SELECT COALESCE(MAX(CAST(account_number AS UNSIGNED)), 5000) FROM accounts WHERE account_type = 'expense'")->fetchColumn() + 100;
                $db->prepare("INSERT INTO accounts (parent_id, account_type, account_number, name, description, fund_type, sort_order) VALUES (?, 'expense', ?, ?, ?, ?, ?)")
                    ->execute([$expenseParent, (string)$nextNum, $c['name'], $c['description'], $c['fund_type'] ?: 'general', $maxOrder]);
                $results[] = "Created expense account: {$c['name']}";
            }
        }
    }

    // Sync: create accounts for any donation categories missing from Chart of Accounts
    $incomeParent = $db->query("SELECT id FROM accounts WHERE account_type = 'income' AND parent_id IS NULL LIMIT 1")->fetchColumn();
    if ($incomeParent) {
        $cats = $db->query("SELECT name, description, fund_type FROM donation_categories WHERE is_active = 1")->fetchAll();
        foreach ($cats as $c) {
            $exists = $db->prepare("SELECT COUNT(*) FROM accounts WHERE account_type = 'income' AND name = ?");
            $exists->execute([$c['name']]);
            if ((int)$exists->fetchColumn() === 0) {
                $maxOrder = (int)$db->query("SELECT COALESCE(MAX(sort_order), 0) FROM accounts WHERE account_type = 'income'")->fetchColumn() + 1;
                $nextNum = (int)$db->query("SELECT COALESCE(MAX(CAST(account_number AS UNSIGNED)), 4000) FROM accounts WHERE account_type = 'income'")->fetchColumn() + 100;
                $db->prepare("INSERT INTO accounts (parent_id, account_type, account_number, name, description, fund_type, sort_order) VALUES (?, 'income', ?, ?, ?, ?, ?)")
                    ->execute([$incomeParent, (string)$nextNum, $c['name'], $c['description'], $c['fund_type'] ?: 'general', $maxOrder]);
                $results[] = "Created income account: {$c['name']}";
            }
        }
    }

    if (empty($results)) $results[] = 'All categories already synced to Chart of Accounts';

} catch (Exception $e) {
    $results[] = 'Error: ' . $e->getMessage();
}

jsonResponse(['results' => $results]);
