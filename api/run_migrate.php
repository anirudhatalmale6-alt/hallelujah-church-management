<?php
require_once __DIR__ . '/config.php';

$secret = $_GET['key'] ?? '';
if ($secret !== 'hitc-migrate-2026') {
    jsonResponse(['error' => 'Unauthorized'], 403);
}

$db = getDB();
$results = [];

try {
    // Account ledger - tracks every balance change for historical reporting
    $db->exec("
        CREATE TABLE IF NOT EXISTS account_ledger (
            id INT AUTO_INCREMENT PRIMARY KEY,
            account_id INT NOT NULL,
            entry_date DATE NOT NULL,
            entry_type VARCHAR(30) NOT NULL,
            amount DECIMAL(12,2) NOT NULL,
            description VARCHAR(500) DEFAULT NULL,
            reference_type VARCHAR(30) DEFAULT NULL,
            reference_id INT DEFAULT NULL,
            created_by INT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (account_id) REFERENCES accounts(id),
            INDEX idx_account_date (account_id, entry_date),
            INDEX idx_entry_date (entry_date),
            INDEX idx_reference (reference_type, reference_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'account_ledger table created';

    // Upgrade payment_routing to support category-specific routing
    try {
        $db->exec("ALTER TABLE payment_routing DROP INDEX payment_method");
        $results[] = 'Dropped unique on payment_routing.payment_method';
    } catch (Exception $e) {
        $results[] = 'payment_routing unique already handled';
    }

    try {
        $db->exec("ALTER TABLE payment_routing ADD COLUMN category_id INT DEFAULT NULL AFTER payment_method");
        $results[] = 'Added category_id to payment_routing';
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'Duplicate column') !== false) {
            $results[] = 'category_id already exists on payment_routing';
        }
    }

    try {
        $db->exec("ALTER TABLE payment_routing ADD UNIQUE KEY uk_routing (payment_method, category_id)");
        $results[] = 'Added unique key on payment_routing (method + category)';
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'Duplicate key') !== false) {
            $results[] = 'uk_routing already exists';
        }
    }

    // Add source_account_id to expenses (which bank account the expense is paid from)
    try {
        $db->exec("ALTER TABLE expenses ADD COLUMN source_account_id INT DEFAULT NULL AFTER routed_account_id");
        $results[] = 'Added source_account_id to expenses';
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'Duplicate column') !== false) {
            $results[] = 'source_account_id already exists on expenses';
        }
    }

    // Seed opening balance ledger entries for existing accounts
    $existingLedger = (int)$db->query("SELECT COUNT(*) FROM account_ledger WHERE entry_type = 'opening'")->fetchColumn();
    if ($existingLedger == 0) {
        $accts = $db->query("SELECT id, opening_balance, current_balance FROM accounts WHERE opening_balance != 0 OR current_balance != 0")->fetchAll();
        $stmt = $db->prepare("INSERT INTO account_ledger (account_id, entry_date, entry_type, amount, description) VALUES (?, CURDATE(), 'opening', ?, 'Opening balance')");
        foreach ($accts as $a) {
            $bal = (float)$a['current_balance'] ?: (float)$a['opening_balance'];
            if ($bal != 0) {
                $stmt->execute([$a['id'], $bal]);
            }
        }
        $results[] = 'Seeded opening balance ledger entries for ' . count($accts) . ' accounts';
    }

} catch (Exception $e) {
    $results[] = 'Error: ' . $e->getMessage();
}

jsonResponse(['results' => $results]);
