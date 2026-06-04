<?php
require_once __DIR__ . '/config.php';

$secret = $_GET['key'] ?? '';
if ($secret !== 'hitc-migrate-2026') {
    jsonResponse(['error' => 'Unauthorized'], 403);
}

$db = getDB();
$results = [];

try {
    // Clean up: zero out balances on parent accounts (accounts that have children)
    // Only leaf accounts should hold balances
    $parentAccounts = $db->query("
        SELECT a.id, a.name, a.current_balance, a.opening_balance
        FROM accounts a
        WHERE (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) > 0
        AND (a.current_balance != 0 OR a.opening_balance != 0)
    ")->fetchAll();

    foreach ($parentAccounts as $pa) {
        $db->prepare("UPDATE accounts SET current_balance = 0, opening_balance = 0 WHERE id = ?")->execute([$pa['id']]);
        $db->prepare("DELETE FROM account_ledger WHERE account_id = ? AND entry_type = 'opening'")->execute([$pa['id']]);
        $results[] = "Cleared balance on parent account: {$pa['name']} (was \${$pa['current_balance']})";
    }

    if (empty($parentAccounts)) {
        $results[] = 'No parent accounts with balances to clean up';
    }

} catch (Exception $e) {
    $results[] = 'Error: ' . $e->getMessage();
}

jsonResponse(['results' => $results]);
