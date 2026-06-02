<?php
require_once __DIR__ . '/config.php';

$secret = $_GET['key'] ?? '';
if ($secret !== 'hitc-migrate-2026') {
    jsonResponse(['error' => 'Unauthorized'], 403);
}

$db = getDB();
$results = [];

try {
    $db->exec("
        CREATE TABLE IF NOT EXISTS donation_categories (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL UNIQUE,
            description VARCHAR(255) DEFAULT NULL,
            sort_order INT DEFAULT 0,
            is_active TINYINT(1) DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'donation_categories table created';

    $db->exec("
        CREATE TABLE IF NOT EXISTS donations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            member_id INT DEFAULT NULL,
            service_id INT DEFAULT NULL,
            category_id INT NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            payment_method VARCHAR(30) DEFAULT 'cash',
            reference_number VARCHAR(100) DEFAULT NULL,
            donor_name VARCHAR(200) DEFAULT NULL,
            notes TEXT DEFAULT NULL,
            donation_date DATE NOT NULL,
            recorded_by INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL,
            FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
            FOREIGN KEY (category_id) REFERENCES donation_categories(id),
            FOREIGN KEY (recorded_by) REFERENCES users(id),
            INDEX idx_donation_date (donation_date),
            INDEX idx_member_id (member_id),
            INDEX idx_service_id (service_id),
            INDEX idx_category_id (category_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'donations table created';

    $check = $db->query("SELECT COUNT(*) FROM donation_categories")->fetchColumn();
    if ($check == 0) {
        $cats = [
            ['Tithe', 'Regular tithe (10% of income)', 1],
            ['Offering', 'General offering', 2],
            ['Special Seed', 'Special seed offering', 3],
            ['Building Fund', 'Church building and renovation fund', 4],
            ['Missions', 'Missions and outreach support', 5],
            ['Youth Fund', 'Youth ministry fund', 6],
            ['Benevolence', 'Help for members in need', 7],
            ['Other', 'Other donations', 8],
        ];
        $stmt = $db->prepare("INSERT INTO donation_categories (name, description, sort_order) VALUES (?, ?, ?)");
        foreach ($cats as $c) {
            $stmt->execute($c);
        }
        $results[] = 'Seeded 8 default donation categories';
    }

    $adminUsers = $db->query("SELECT id FROM users WHERE role IN ('pastor', 'admin')")->fetchAll();
    $checkPerm = $db->prepare("SELECT COUNT(*) FROM user_permissions WHERE user_id = ? AND permission = 'finance'");
    $insertPerm = $db->prepare("INSERT INTO user_permissions (user_id, permission) VALUES (?, 'finance')");
    foreach ($adminUsers as $u) {
        $checkPerm->execute([$u['id']]);
        if ($checkPerm->fetchColumn() == 0) {
            $insertPerm->execute([$u['id']]);
        }
    }
    $results[] = 'Finance permission added to admin users';

} catch (Exception $e) {
    $results[] = 'Error: ' . $e->getMessage();
}

jsonResponse(['results' => $results]);
