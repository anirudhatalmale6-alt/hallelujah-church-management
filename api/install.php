<?php
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

    // Step 2: Create tables
    $rawDb->exec("
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(255) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            role ENUM('pastor', 'admin', 'leader', 'volunteer') NOT NULL DEFAULT 'volunteer',
            status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_email (email),
            INDEX idx_role (role),
            INDEX idx_status (status)
        ) ENGINE=InnoDB
    ");

    $rawDb->exec("
        CREATE TABLE IF NOT EXISTS members (
            id INT AUTO_INCREMENT PRIMARY KEY,
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            email VARCHAR(255) DEFAULT NULL,
            phone VARCHAR(30) DEFAULT NULL,
            address VARCHAR(255) DEFAULT NULL,
            city VARCHAR(100) DEFAULT NULL,
            state VARCHAR(100) DEFAULT NULL,
            zip VARCHAR(20) DEFAULT NULL,
            gender ENUM('male', 'female', 'other') DEFAULT NULL,
            date_of_birth DATE DEFAULT NULL,
            family_group VARCHAR(100) DEFAULT NULL,
            membership_date DATE DEFAULT NULL,
            status ENUM('active', 'inactive', 'visitor') NOT NULL DEFAULT 'active',
            notes TEXT DEFAULT NULL,
            photo_url VARCHAR(500) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_name (last_name, first_name),
            INDEX idx_status (status),
            INDEX idx_family_group (family_group),
            INDEX idx_email (email)
        ) ENGINE=InnoDB
    ");

    $rawDb->exec("
        CREATE TABLE IF NOT EXISTS services (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            date DATE NOT NULL,
            time TIME NOT NULL,
            type VARCHAR(100) NOT NULL DEFAULT 'sunday_1st',
            notes TEXT DEFAULT NULL,
            visitor_count INT NOT NULL DEFAULT 0,
            head_count INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_date (date),
            INDEX idx_type (type)
        ) ENGINE=InnoDB
    ");

    $rawDb->exec("
        CREATE TABLE IF NOT EXISTS `groups` (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL UNIQUE,
            description VARCHAR(255) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    ");

    $rawDb->exec("
        CREATE TABLE IF NOT EXISTS attendance (
            id INT AUTO_INCREMENT PRIMARY KEY,
            service_id INT NOT NULL,
            member_id INT NOT NULL,
            status ENUM('present', 'absent', 'late') NOT NULL DEFAULT 'present',
            check_in_time TIMESTAMP NULL DEFAULT NULL,
            notes VARCHAR(255) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
            UNIQUE KEY uk_service_member (service_id, member_id),
            INDEX idx_service (service_id),
            INDEX idx_member (member_id),
            INDEX idx_status (status)
        ) ENGINE=InnoDB
    ");

    $rawDb->exec("
        CREATE TABLE IF NOT EXISTS settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            `key` VARCHAR(100) NOT NULL UNIQUE,
            value TEXT DEFAULT NULL,
            INDEX idx_key (`key`)
        ) ENGINE=InnoDB
    ");

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
