<?php

// migration_cache_bust_1782757888
/**
 * Hallelujah In The City - Church Management System
 * Installation Script - First-time setup
 *
 * This script:
 * 1. Creates the database (if it doesn't exist)
 * 2. Creates all required tables
 * 3. Inserts default settings
 * 4. Creates the default admin user
 *
 * Access via: POST /api/install.php
 * After installation, this endpoint is disabled.
 */

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $action = $_GET['action'] ?? '';

    // Migration endpoint (temp)
    if ($action === 'migrate20') {
        $db = getDB();
        $results = [];
        try {
            $db->exec("CREATE TABLE IF NOT EXISTS journal_entries (id INT AUTO_INCREMENT PRIMARY KEY, entry_date DATE NOT NULL, description VARCHAR(500) NOT NULL, reference_number VARCHAR(100) DEFAULT NULL, created_by INT DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_entry_date (entry_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
            $results[] = 'Created journal_entries';
        } catch (Exception $e) { $results[] = $e->getMessage(); }
        try {
            $db->exec("CREATE TABLE IF NOT EXISTS journal_entry_lines (id INT AUTO_INCREMENT PRIMARY KEY, journal_entry_id INT NOT NULL, account_id INT NOT NULL, debit DECIMAL(12,2) DEFAULT 0.00, credit DECIMAL(12,2) DEFAULT 0.00, memo VARCHAR(255) DEFAULT NULL, INDEX idx_journal_entry_id (journal_entry_id), INDEX idx_account_id (account_id), FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
            $results[] = 'Created journal_entry_lines';
        } catch (Exception $e) { $results[] = $e->getMessage(); }
        jsonResponse(['message' => 'Migration 20 done', 'results' => $results]);
    }

    // Check if already installed
    try {
        $db = getDB();
        $stmt = $db->prepare("SELECT value FROM settings WHERE `key` = 'installed'");
        $stmt->execute();
        $row = $stmt->fetch();
        if ($row && $row['value'] === '1') {
            jsonResponse(['installed' => true, 'message' => 'System is already installed']);
        }
    } catch (Exception $e) {
        // Database or table doesn't exist yet
    }
    jsonResponse(['installed' => false, 'message' => 'System needs installation']);
}

if ($method !== 'POST') {
    jsonResponse(['error' => 'Use POST to install'], 405);
}

try {
    // Step 1: Create database
    $rawDb = getRawDB();
    $rawDb->exec("CREATE DATABASE IF NOT EXISTS `" . DB_NAME . "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $rawDb->exec("USE `" . DB_NAME . "`");

    // Step 2: Create tables from schema.sql (every table the system uses).
    // The tables used to be hand-written here, which meant a fresh install only got the
    // handful that existed when this file was last touched - everything added since
    // (departments, groups/member_groups, finance, documents, check-in, follow-ups...)
    // was missing. schema.sql is the whole structure and is the single source of truth.
    $schemaPath = __DIR__ . '/../schema.sql';
    if (!is_readable($schemaPath)) {
        jsonResponse(['error' => 'schema.sql is missing - upload it next to the api folder'], 500);
    }

    $sql = file_get_contents($schemaPath);
    $sql = preg_replace('/^\s*--.*$/m', '', $sql);   // strip comments

    $created = 0;
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
        $rawDb->exec($stmt);
        if (stripos($stmt, 'CREATE TABLE') === 0) $created++;
    }

    // Step 3: Default settings (use INSERT IGNORE to not overwrite)
    $rawDb->exec("
        INSERT IGNORE INTO settings (`key`, value) VALUES
        ('church_name', 'Hallelujah In The City'),
        ('church_address', ''),
        ('church_phone', ''),
        ('church_email', 'info@hallelujahinthecity.org'),
        ('timezone', 'America/Toronto'),
        ('installed', '1')
    ");

    // Step 4: Create default admin user (if not exists)
    $defaultEmail = 'admin@hallelujahinthecity.org';
    $defaultPassword = 'Admin123!';
    $passwordHash = password_hash($defaultPassword, PASSWORD_BCRYPT);

    $stmt = $rawDb->prepare("SELECT id FROM users WHERE email = ?");
    $stmt->execute([$defaultEmail]);

    if (!$stmt->fetch()) {
        $stmt = $rawDb->prepare("
            INSERT INTO users (email, password_hash, name, role, status)
            VALUES (?, ?, ?, 'admin', 'active')
        ");
        $stmt->execute([$defaultEmail, $passwordHash, 'System Administrator']);
    }

    jsonResponse([
        'success' => true,
        'message' => 'Installation completed successfully!',
        'tables_created' => $created,
        'admin' => [
            'email' => $defaultEmail,
            'password' => $defaultPassword,
            'note' => 'Please change this password after first login.'
        ]
    ]);

} catch (Exception $e) {
    jsonResponse([
        'error' => 'Installation failed: ' . $e->getMessage()
    ], 500);
}
