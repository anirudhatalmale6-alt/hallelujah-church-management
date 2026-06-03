<?php
require_once __DIR__ . '/config.php';

$secret = $_GET['key'] ?? '';
if ($secret !== 'hitc-migrate-2026') {
    jsonResponse(['error' => 'Unauthorized'], 403);
}

$db = getDB();
$results = [];

try {
    // Add fund_type to donation_categories
    try {
        $db->exec("ALTER TABLE donation_categories ADD COLUMN fund_type VARCHAR(30) DEFAULT 'general' AFTER description");
        $results[] = 'Added fund_type to donation_categories';
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'Duplicate column') !== false) {
            $results[] = 'fund_type column already exists';
        } else {
            $results[] = 'fund_type: ' . $e->getMessage();
        }
    }

    // Expense categories table
    $db->exec("
        CREATE TABLE IF NOT EXISTS expense_categories (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL UNIQUE,
            description VARCHAR(255) DEFAULT NULL,
            fund_type VARCHAR(30) DEFAULT 'general',
            sort_order INT DEFAULT 0,
            is_active TINYINT(1) DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'expense_categories table created';

    // Seed default expense categories
    $check = $db->query("SELECT COUNT(*) FROM expense_categories")->fetchColumn();
    if ($check == 0) {
        $cats = [
            ['Rent/Mortgage', 'Facility rent or mortgage payments', 'general', 1],
            ['Utilities', 'Electric, water, gas, internet', 'general', 2],
            ['Salaries & Wages', 'Staff compensation', 'general', 3],
            ['Supplies', 'Office and church supplies', 'general', 4],
            ['Maintenance', 'Building and equipment maintenance', 'general', 5],
            ['Ministry Programs', 'Ministry and outreach program costs', 'general', 6],
            ['Events', 'Church event expenses', 'general', 7],
            ['Insurance', 'Property and liability insurance', 'general', 8],
            ['Missions', 'Missions support disbursements', 'restricted', 9],
            ['Benevolence', 'Member assistance disbursements', 'restricted', 10],
            ['Equipment', 'Equipment purchases', 'general', 11],
            ['Other', 'Miscellaneous expenses', 'general', 12],
        ];
        $stmt = $db->prepare("INSERT INTO expense_categories (name, description, fund_type, sort_order) VALUES (?, ?, ?, ?)");
        foreach ($cats as $c) {
            $stmt->execute($c);
        }
        $results[] = 'Seeded 12 default expense categories';
    }

    // Expenses table
    $db->exec("
        CREATE TABLE IF NOT EXISTS expenses (
            id INT AUTO_INCREMENT PRIMARY KEY,
            category_id INT NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            description VARCHAR(500) DEFAULT NULL,
            vendor VARCHAR(200) DEFAULT NULL,
            payment_method VARCHAR(30) DEFAULT 'check',
            reference_number VARCHAR(100) DEFAULT NULL,
            expense_date DATE NOT NULL,
            receipt_note VARCHAR(500) DEFAULT NULL,
            status VARCHAR(20) DEFAULT 'recorded',
            approved_by INT DEFAULT NULL,
            approved_at DATETIME DEFAULT NULL,
            recorded_by INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (category_id) REFERENCES expense_categories(id),
            FOREIGN KEY (recorded_by) REFERENCES users(id),
            FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
            INDEX idx_expense_date (expense_date),
            INDEX idx_category_id (category_id),
            INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'expenses table created';

    // Budgets table
    $db->exec("
        CREATE TABLE IF NOT EXISTS budgets (
            id INT AUTO_INCREMENT PRIMARY KEY,
            category_type VARCHAR(20) NOT NULL,
            category_id INT NOT NULL,
            year INT NOT NULL,
            month INT DEFAULT NULL,
            amount DECIMAL(10,2) NOT NULL DEFAULT 0,
            notes VARCHAR(255) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_budget (category_type, category_id, year, month),
            INDEX idx_year (year)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'budgets table created';

} catch (Exception $e) {
    $results[] = 'Error: ' . $e->getMessage();
}

jsonResponse(['results' => $results]);
