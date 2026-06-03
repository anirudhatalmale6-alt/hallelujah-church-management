<?php
require_once __DIR__ . '/config.php';

$secret = $_GET['key'] ?? '';
if ($secret !== 'hitc-migrate-2026') {
    jsonResponse(['error' => 'Unauthorized'], 403);
}

$db = getDB();
$results = [];

try {
    // Chart of Accounts table
    $db->exec("
        CREATE TABLE IF NOT EXISTS accounts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            parent_id INT DEFAULT NULL,
            account_type ENUM('asset','liability','income','expense','equity') NOT NULL,
            account_number VARCHAR(20) DEFAULT NULL,
            name VARCHAR(150) NOT NULL,
            description VARCHAR(500) DEFAULT NULL,
            opening_balance DECIMAL(12,2) DEFAULT 0,
            current_balance DECIMAL(12,2) DEFAULT 0,
            fund_type VARCHAR(30) DEFAULT 'general',
            is_active TINYINT(1) DEFAULT 1,
            sort_order INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (parent_id) REFERENCES accounts(id) ON DELETE CASCADE,
            INDEX idx_account_type (account_type),
            INDEX idx_parent_id (parent_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'accounts table created';

    // Seed default accounts if empty
    $check = (int)$db->query("SELECT COUNT(*) FROM accounts")->fetchColumn();
    if ($check == 0) {
        // Top-level asset
        $db->exec("INSERT INTO accounts (account_type, account_number, name, description, parent_id, sort_order) VALUES ('asset','1000','Assets','All church assets',NULL,1)");
        $assetId = (int)$db->lastInsertId();

        // Asset sub-accounts
        $assetSubs = [
            ['1100', 'Cash & Reserves', 'Cash on hand and reserves', 2],
            ['1200', 'Checking Account', 'Primary checking account', 3],
            ['1300', 'Savings Account', 'Church savings account', 4],
            ['1400', 'Endowments', 'Endowment funds', 5],
            ['1500', 'Investments', 'Church investments', 6],
        ];
        $stmt = $db->prepare("INSERT INTO accounts (account_type, account_number, name, description, parent_id, sort_order) VALUES ('asset',?,?,?,?,?)");
        foreach ($assetSubs as $s) {
            $stmt->execute([$s[0], $s[1], $s[2], $assetId, $s[3]]);
        }

        // Top-level liability
        $db->exec("INSERT INTO accounts (account_type, account_number, name, description, parent_id, sort_order) VALUES ('liability','2000','Liabilities','All church liabilities',NULL,10)");
        $liabilityId = (int)$db->lastInsertId();

        // Liability sub-accounts
        $liabSubs = [
            ['2100', 'Loans', 'Outstanding loans', 11],
            ['2200', 'Mortgages', 'Property mortgages', 12],
        ];
        $stmt = $db->prepare("INSERT INTO accounts (account_type, account_number, name, description, parent_id, sort_order) VALUES ('liability',?,?,?,?,?)");
        foreach ($liabSubs as $s) {
            $stmt->execute([$s[0], $s[1], $s[2], $liabilityId, $s[3]]);
        }

        // Top-level equity
        $db->exec("INSERT INTO accounts (account_type, account_number, name, description, parent_id, sort_order) VALUES ('equity','3000','Net Assets','Church net assets (equity)',NULL,20)");
        $equityId = (int)$db->lastInsertId();

        $eqSubs = [
            ['3100', 'Unrestricted Net Assets', 'General fund balance', 21],
            ['3200', 'Restricted Net Assets', 'Restricted fund balance', 22],
        ];
        $stmt = $db->prepare("INSERT INTO accounts (account_type, account_number, name, description, parent_id, sort_order) VALUES ('equity',?,?,?,?,?)");
        foreach ($eqSubs as $s) {
            $stmt->execute([$s[0], $s[1], $s[2], $equityId, $s[3]]);
        }

        // Top-level income (links to donation categories conceptually)
        $db->exec("INSERT INTO accounts (account_type, account_number, name, description, parent_id, sort_order) VALUES ('income','4000','Revenue','All church income/revenue',NULL,30)");
        $incomeId = (int)$db->lastInsertId();

        // Seed income sub-accounts from existing donation_categories
        $donCats = $db->query("SELECT id, name, description FROM donation_categories WHERE is_active = 1 ORDER BY sort_order")->fetchAll();
        $num = 4100;
        $ord = 31;
        $stmt = $db->prepare("INSERT INTO accounts (account_type, account_number, name, description, parent_id, sort_order) VALUES ('income',?,?,?,?,?)");
        foreach ($donCats as $c) {
            $stmt->execute([(string)$num, $c['name'], $c['description'] ?: $c['name'], $incomeId, $ord]);
            $num += 100;
            $ord++;
        }

        // Top-level expense
        $db->exec("INSERT INTO accounts (account_type, account_number, name, description, parent_id, sort_order) VALUES ('expense','5000','Expenses','All church expenses',NULL,50)");
        $expenseId = (int)$db->lastInsertId();

        // Seed expense sub-accounts from existing expense_categories
        $expCats = $db->query("SELECT id, name, description FROM expense_categories WHERE is_active = 1 ORDER BY sort_order")->fetchAll();
        $num = 5100;
        $ord = 51;
        $stmt = $db->prepare("INSERT INTO accounts (account_type, account_number, name, description, parent_id, sort_order) VALUES ('expense',?,?,?,?,?)");
        foreach ($expCats as $c) {
            $stmt->execute([(string)$num, $c['name'], $c['description'] ?: $c['name'], $expenseId, $ord]);
            $num += 100;
            $ord++;
        }

        $results[] = 'Seeded Chart of Accounts with assets, liabilities, equity, income, and expense accounts';
    } else {
        $results[] = 'Accounts already seeded (' . $check . ' accounts)';
    }

} catch (Exception $e) {
    $results[] = 'Error: ' . $e->getMessage();
}

jsonResponse(['results' => $results]);
