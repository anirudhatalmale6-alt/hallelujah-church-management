<?php
require_once __DIR__ . '/config.php';

$secret = $_GET['key'] ?? '';
if ($secret !== 'hitc-migrate-2026') {
    jsonResponse(['error' => 'Unauthorized'], 403);
}

$db = getDB();
$results = [];

try {
    // Account transfers table
    $db->exec("
        CREATE TABLE IF NOT EXISTS account_transfers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            from_account_id INT NOT NULL,
            to_account_id INT NOT NULL,
            amount DECIMAL(12,2) NOT NULL,
            transfer_date DATE NOT NULL,
            reference_number VARCHAR(100) DEFAULT NULL,
            notes VARCHAR(500) DEFAULT NULL,
            created_by INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (from_account_id) REFERENCES accounts(id),
            FOREIGN KEY (to_account_id) REFERENCES accounts(id),
            FOREIGN KEY (created_by) REFERENCES users(id),
            INDEX idx_transfer_date (transfer_date),
            INDEX idx_from_account (from_account_id),
            INDEX idx_to_account (to_account_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'account_transfers table created';

    // Add routed_account_id to donations
    try {
        $db->exec("ALTER TABLE donations ADD COLUMN routed_account_id INT DEFAULT NULL AFTER recorded_by");
        $results[] = 'Added routed_account_id to donations';
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'Duplicate column') !== false) {
            $results[] = 'routed_account_id already exists on donations';
        } else {
            $results[] = 'routed_account_id: ' . $e->getMessage();
        }
    }

    // Add routed_account_id to expenses
    try {
        $db->exec("ALTER TABLE expenses ADD COLUMN routed_account_id INT DEFAULT NULL AFTER recorded_by");
        $results[] = 'Added routed_account_id to expenses';
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'Duplicate column') !== false) {
            $results[] = 'routed_account_id already exists on expenses';
        } else {
            $results[] = 'routed_account_id: ' . $e->getMessage();
        }
    }

    // Payment method routing table
    $db->exec("
        CREATE TABLE IF NOT EXISTS payment_routing (
            id INT AUTO_INCREMENT PRIMARY KEY,
            payment_method VARCHAR(30) NOT NULL UNIQUE,
            account_id INT NOT NULL,
            FOREIGN KEY (account_id) REFERENCES accounts(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'payment_routing table created';

    // Seed default routing (cash → Cash & Reserves, check/zelle/etc → Checking)
    $routingCheck = (int)$db->query("SELECT COUNT(*) FROM payment_routing")->fetchColumn();
    if ($routingCheck == 0) {
        $cashAccount = $db->query("SELECT id FROM accounts WHERE account_number = '1100'")->fetchColumn();
        $checkingAccount = $db->query("SELECT id FROM accounts WHERE account_number = '1200'")->fetchColumn();

        if ($cashAccount && $checkingAccount) {
            $stmt = $db->prepare("INSERT INTO payment_routing (payment_method, account_id) VALUES (?, ?)");
            $stmt->execute(['cash', $cashAccount]);
            $stmt->execute(['check', $checkingAccount]);
            $stmt->execute(['card', $checkingAccount]);
            $stmt->execute(['zelle', $checkingAccount]);
            $stmt->execute(['cashapp', $checkingAccount]);
            $stmt->execute(['paypal', $checkingAccount]);
            $stmt->execute(['online', $checkingAccount]);
            $stmt->execute(['other', $cashAccount]);
            $results[] = 'Seeded payment routing (cash→Cash & Reserves, check/zelle/etc→Checking)';
        } else {
            $results[] = 'Warning: Could not find Cash & Reserves or Checking accounts for routing';
        }
    } else {
        $results[] = 'Payment routing already seeded';
    }

    // Add edit_locked_at to donations and expenses for 24h lock
    try {
        $db->exec("ALTER TABLE donations ADD COLUMN edit_locked_at DATETIME DEFAULT NULL");
        $results[] = 'Added edit_locked_at to donations';
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'Duplicate column') !== false) {
            $results[] = 'edit_locked_at already exists on donations';
        }
    }

    try {
        $db->exec("ALTER TABLE expenses ADD COLUMN edit_locked_at DATETIME DEFAULT NULL");
        $results[] = 'Added edit_locked_at to expenses';
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'Duplicate column') !== false) {
            $results[] = 'edit_locked_at already exists on expenses';
        }
    }

} catch (Exception $e) {
    $results[] = 'Error: ' . $e->getMessage();
}

jsonResponse(['results' => $results]);
