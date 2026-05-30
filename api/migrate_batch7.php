<?php
require_once __DIR__ . '/config.php';

$db = getDB();
$results = [];

// Checklist template items (default items for all services)
try {
    $db->exec("
        CREATE TABLE IF NOT EXISTS checklist_templates (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            category VARCHAR(50) DEFAULT 'general',
            sort_order INT DEFAULT 0,
            is_active TINYINT(1) DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    ");
    $results[] = 'Created checklist_templates table';
} catch (Exception $e) {
    $results[] = 'checklist_templates: ' . $e->getMessage();
}

// Service checklist (per-service checklist records)
try {
    $db->exec("
        CREATE TABLE IF NOT EXISTS service_checklists (
            id INT AUTO_INCREMENT PRIMARY KEY,
            service_id INT NOT NULL,
            item_name VARCHAR(100) NOT NULL,
            template_id INT DEFAULT NULL,
            is_checked TINYINT(1) DEFAULT 0,
            checked_by INT DEFAULT NULL,
            checked_at TIMESTAMP NULL DEFAULT NULL,
            notes VARCHAR(255) DEFAULT NULL,
            sort_order INT DEFAULT 0,
            FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
            FOREIGN KEY (checked_by) REFERENCES users(id) ON DELETE SET NULL,
            UNIQUE KEY uk_service_item (service_id, item_name)
        ) ENGINE=InnoDB
    ");
    $results[] = 'Created service_checklists table';
} catch (Exception $e) {
    $results[] = 'service_checklists: ' . $e->getMessage();
}

// User permissions table
try {
    $db->exec("
        CREATE TABLE IF NOT EXISTS user_permissions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            permission VARCHAR(50) NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE KEY uk_user_perm (user_id, permission)
        ) ENGINE=InnoDB
    ");
    $results[] = 'Created user_permissions table';
} catch (Exception $e) {
    $results[] = 'user_permissions: ' . $e->getMessage();
}

// Insert default checklist template items
try {
    $check = $db->query("SELECT COUNT(*) as cnt FROM checklist_templates");
    $count = $check->fetch()['cnt'];
    if ($count == 0) {
        $defaults = [
            ['Sound System Check', 'technical', 1],
            ['Projector / Screens Ready', 'technical', 2],
            ['Lighting Check', 'technical', 3],
            ['Microphones Tested', 'technical', 4],
            ['Live Stream / Recording Setup', 'technical', 5],
            ['Seating Arranged', 'facility', 6],
            ['Entrance / Parking Area Clear', 'facility', 7],
            ['Bathroom Cleaned & Stocked', 'facility', 8],
            ['Floors Swept / Mopped', 'facility', 9],
            ['HVAC / Temperature Set', 'facility', 10],
            ['Communion Supplies Prepared', 'worship', 11],
            ['Offering Baskets / Envelopes Ready', 'worship', 12],
            ['Bibles / Hymnals Available', 'worship', 13],
            ['Nursery / Kids Area Ready', 'ministry', 14],
            ['Welcome / Info Table Set Up', 'ministry', 15],
            ['First Aid Kit Accessible', 'safety', 16],
            ['Emergency Exits Clear', 'safety', 17],
        ];
        $stmt = $db->prepare("INSERT INTO checklist_templates (name, category, sort_order) VALUES (?, ?, ?)");
        foreach ($defaults as $item) {
            $stmt->execute($item);
        }
        $results[] = 'Inserted ' . count($defaults) . ' default checklist items';
    } else {
        $results[] = 'Default items already exist (' . $count . ')';
    }
} catch (Exception $e) {
    $results[] = 'Default items: ' . $e->getMessage();
}

jsonResponse(['results' => $results]);
