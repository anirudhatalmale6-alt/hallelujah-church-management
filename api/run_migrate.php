<?php
require_once __DIR__ . '/config.php';

$secret = $_GET['key'] ?? '';
if ($secret !== 'hitc-migrate-2026') {
    jsonResponse(['error' => 'Unauthorized'], 403);
}

$db = getDB();
$results = [];

// Include the calcAccountBalance function
function calcBal($db, $accountId) {
    $accStmt = $db->prepare("SELECT opening_balance FROM accounts WHERE id = ?");
    $accStmt->execute([$accountId]);
    $opening = (float)$accStmt->fetchColumn();

    $donations = (float)$db->query("SELECT COALESCE(SUM(amount), 0) FROM donations WHERE routed_account_id = $accountId")->fetchColumn();

    $expenses = 0;
    try { $expenses = (float)$db->query("SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE source_account_id = $accountId")->fetchColumn(); } catch (Exception $e) {}

    $ledger = 0;
    try { $ledger = (float)$db->query("SELECT COALESCE(SUM(amount), 0) FROM account_ledger WHERE account_id = $accountId AND entry_type != 'opening' AND reference_type != 'donation' AND reference_type != 'expense'")->fetchColumn(); } catch (Exception $e) {}

    return $opening + $donations - $expenses + $ledger;
}

try {
    $accounts = $db->query("
        SELECT a.id, a.name, a.opening_balance, a.current_balance
        FROM accounts a
        WHERE a.account_type IN ('asset', 'liability')
        AND (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) = 0
        AND a.parent_id IS NOT NULL
    ")->fetchAll();

    foreach ($accounts as $acc) {
        $correct = calcBal($db, (int)$acc['id']);
        $old = (float)$acc['current_balance'];
        $opening = (float)$acc['opening_balance'];

        $db->prepare("UPDATE accounts SET current_balance = ? WHERE id = ?")->execute([$correct, $acc['id']]);

        // Count transactions
        $donCount = (int)$db->query("SELECT COUNT(*) FROM donations WHERE routed_account_id = {$acc['id']}")->fetchColumn();
        $expCount = 0;
        try { $expCount = (int)$db->query("SELECT COUNT(*) FROM expenses WHERE source_account_id = {$acc['id']}")->fetchColumn(); } catch (Exception $e) {}

        $results[] = "{$acc['name']}: opening={$opening}, donations={$donCount}, expenses={$expCount}, old_bal={$old}, new_bal={$correct}";
    }
} catch (Exception $e) {
    $results[] = 'Error: ' . $e->getMessage();
}

jsonResponse(['results' => $results]);
