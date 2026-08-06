<?php
// One-time helper: convert existing transfers INTO the Accounts Receivable
// account into proper loan records (so they carry borrower/purpose/notes and a
// repayment history), WITHOUT double-counting — the transfer's two ledger rows
// are re-pointed to the new loan and the raw transfer row is removed.
// Idempotent-ish: only touches transfers whose destination is a receivable account.
// Guarded by a key. Remove from server after running.
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');
if (($_GET['key'] ?? '') !== 'hitc-convert-ar-2026') {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}
$db = getDB();
$done = [];
try {
    // Receivable account(s): asset accounts named like "receivable" or account_number 1200.
    $recv = $db->query("SELECT id FROM accounts WHERE account_type = 'asset' AND (LOWER(name) LIKE '%receivable%' OR account_number = '1200')")->fetchAll(PDO::FETCH_COLUMN);
    if (!$recv) { echo json_encode(['success' => true, 'steps' => ['no receivable account found — nothing to convert']]); exit; }
    $place = implode(',', array_fill(0, count($recv), '?'));

    $transfers = $db->prepare("SELECT * FROM account_transfers WHERE to_account_id IN ($place)");
    $transfers->execute($recv);
    $rows = $transfers->fetchAll();
    if (!$rows) { echo json_encode(['success' => true, 'steps' => ['no transfers into a receivable account — nothing to convert']]); exit; }

    foreach ($rows as $t) {
        $db->beginTransaction();
        try {
            $db->prepare("INSERT INTO loans (direction, member_id, borrower_name, amount, loan_date, purpose, notes, bank_account_id, ledger_account_id, booked, status, created_by, created_at)
                          VALUES ('lent', NULL, NULL, ?, ?, 'Imported from a transfer — add the borrower', ?, ?, ?, 1, 'open', ?, NOW())")
                ->execute([(float)$t['amount'], $t['transfer_date'], ($t['notes'] ?? null), $t['from_account_id'], $t['to_account_id'], $t['created_by']]);
            $loanId = (int)$db->lastInsertId();
            // Re-point the two transfer ledger rows to this loan (no balance change).
            $db->prepare("UPDATE account_ledger SET reference_type = 'loan_issue', reference_id = ? WHERE reference_type = 'transfer' AND reference_id = ?")
                ->execute([$loanId, $t['id']]);
            // Remove the raw transfer row so it no longer shows separately in History.
            $db->prepare("DELETE FROM account_transfers WHERE id = ?")->execute([$t['id']]);
            $db->commit();
            $done[] = "transfer #{$t['id']} (\${$t['amount']}) -> loan #$loanId";
        } catch (Exception $e) {
            $db->rollBack();
            $done[] = "transfer #{$t['id']} FAILED: " . $e->getMessage();
        }
    }
    echo json_encode(['success' => true, 'steps' => $done]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage(), 'steps' => $done]);
}
