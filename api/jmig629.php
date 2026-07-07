<?php
require_once __DIR__ . '/config.php';
$db = getDB();
$results = [];
try {
    $db->exec("CREATE TABLE IF NOT EXISTS journal_entries (id INT AUTO_INCREMENT PRIMARY KEY, entry_date DATE NOT NULL, description VARCHAR(500) NOT NULL, reference_number VARCHAR(100) DEFAULT NULL, created_by INT DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_entry_date (entry_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $results[] = 'Created journal_entries';
} catch (Exception $e) { $results[] = 'journal_entries: ' . $e->getMessage(); }
try {
    $db->exec("CREATE TABLE IF NOT EXISTS journal_entry_lines (id INT AUTO_INCREMENT PRIMARY KEY, journal_entry_id INT NOT NULL, account_id INT NOT NULL, debit DECIMAL(12,2) DEFAULT 0.00, credit DECIMAL(12,2) DEFAULT 0.00, memo VARCHAR(255) DEFAULT NULL, INDEX idx_journal_entry_id (journal_entry_id), INDEX idx_account_id (account_id), FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $results[] = 'Created journal_entry_lines';
} catch (Exception $e) { $results[] = 'journal_entry_lines: ' . $e->getMessage(); }
header('Content-Type: application/json');
echo json_encode(['ok' => true, 'results' => $results]);
