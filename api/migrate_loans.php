<?php
// Loans & Receivables register: money the church lends out (a receivable) or
// borrows, recorded with borrower, purpose, notes, and repayment history so the
// full detail is visible later (not just an amount on a transfer).
// Idempotent. Guarded by a key. Remove from server after running.
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');
if (($_GET['key'] ?? '') !== 'hitc-loans-2026') {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}
$db = getDB();
$done = [];
try {
    $db->exec("
        CREATE TABLE IF NOT EXISTS loans (
            id INT AUTO_INCREMENT PRIMARY KEY,
            direction VARCHAR(10) NOT NULL DEFAULT 'lent',
            member_id INT NULL,
            borrower_name VARCHAR(200) NULL,
            amount DECIMAL(12,2) NOT NULL DEFAULT 0,
            loan_date DATE NOT NULL,
            due_date DATE NULL,
            purpose VARCHAR(255) NULL,
            notes TEXT NULL,
            bank_account_id INT NULL,
            ledger_account_id INT NULL,
            booked TINYINT(1) NOT NULL DEFAULT 1,
            status VARCHAR(12) NOT NULL DEFAULT 'open',
            created_by INT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_member (member_id),
            INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $done[] = 'loans table ready';

    $db->exec("
        CREATE TABLE IF NOT EXISTS loan_repayments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            loan_id INT NOT NULL,
            amount DECIMAL(12,2) NOT NULL DEFAULT 0,
            repay_date DATE NOT NULL,
            notes VARCHAR(255) NULL,
            bank_account_id INT NULL,
            created_by INT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_loan (loan_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $done[] = 'loan_repayments table ready';

    echo json_encode(['success' => true, 'steps' => $done]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage(), 'steps' => $done]);
}
