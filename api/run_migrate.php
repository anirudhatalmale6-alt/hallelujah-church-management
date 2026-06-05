<?php
require_once __DIR__ . '/config.php';

$secret = $_GET['key'] ?? '';
if ($secret !== 'hitc-migrate-2026') {
    jsonResponse(['error' => 'Unauthorized'], 403);
}

$db = getDB();
$results = [];

try {
    // Reconcile all asset/liability leaf account balances
    $accounts = $db->query("
        SELECT a.id, a.name, a.account_type, a.opening_balance, a.current_balance
        FROM accounts a
        WHERE a.account_type IN ('asset', 'liability')
        AND (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) = 0
    ")->fetchAll();

    foreach ($accounts as $acc) {
        $accId = (int)$acc['id'];
        $opening = (float)$acc['opening_balance'];

        // Sum ALL non-opening ledger entries (includes transfers, withdrawals, deposits)
        $ledgerSum = (float)$db->query("SELECT COALESCE(SUM(amount), 0) FROM account_ledger WHERE account_id = $accId AND entry_type != 'opening'")->fetchColumn();

        // Find routed donations that DON'T have a corresponding ledger entry
        // (old donations recorded before the ledger system)
        $unledgeredDonations = (float)$db->query("
            SELECT COALESCE(SUM(d.amount), 0) FROM donations d
            WHERE d.routed_account_id = $accId
            AND NOT EXISTS (SELECT 1 FROM account_ledger al WHERE al.reference_type = 'donation' AND al.reference_id = d.id AND al.account_id = $accId)
        ")->fetchColumn();

        $correctBalance = $opening + $ledgerSum + $unledgeredDonations;
        $oldBalance = (float)$acc['current_balance'];

        if (abs($correctBalance - $oldBalance) > 0.001) {
            $db->prepare("UPDATE accounts SET current_balance = ? WHERE id = ?")->execute([$correctBalance, $accId]);
            $results[] = "{$acc['name']}: \${$oldBalance} -> \${$correctBalance} (opening: {$opening}, ledger: {$ledgerSum}, unledgered donations: {$unledgeredDonations})";
        } else {
            $results[] = "{$acc['name']}: \${$oldBalance} OK";
        }
    }

} catch (Exception $e) {
    $results[] = 'Error: ' . $e->getMessage();
}

jsonResponse(['results' => $results]);
