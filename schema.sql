-- Hallelujah In The City - Church Management System
-- Database Schema v1.0

CREATE DATABASE IF NOT EXISTS church_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE church_management;

-- System Users (login accounts)
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
) ENGINE=InnoDB;

-- Church Members
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
) ENGINE=InnoDB;

-- Church Services
CREATE TABLE IF NOT EXISTS services (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    time TIME NOT NULL,
    type ENUM('sunday_1st', 'sunday_2nd', 'bible_study', 'fasting', 'special') NOT NULL DEFAULT 'sunday_1st',
    notes TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_date (date),
    INDEX idx_type (type)
) ENGINE=InnoDB;

-- Attendance Records
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
) ENGINE=InnoDB;

-- System Settings
CREATE TABLE IF NOT EXISTS settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    `key` VARCHAR(100) NOT NULL UNIQUE,
    value TEXT DEFAULT NULL,
    INDEX idx_key (`key`)
) ENGINE=InnoDB;

-- Default Settings
INSERT INTO settings (`key`, value) VALUES
('church_name', 'Hallelujah In The City'),
('church_address', ''),
('church_phone', ''),
('church_email', 'info@hallelujahinthecity.org'),
('timezone', 'America/Toronto'),
('installed', '1');
