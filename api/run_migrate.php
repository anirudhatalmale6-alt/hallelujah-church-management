<?php
require_once __DIR__ . '/config.php';

$secret = $_GET['key'] ?? '';
if ($secret !== 'hitc-migrate-2026') {
    jsonResponse(['error' => 'Unauthorized'], 403);
}

$db = getDB();
$results = [];

try {
    // Add person_type to members
    try {
        $db->exec("ALTER TABLE members ADD COLUMN person_type VARCHAR(30) DEFAULT 'church_member' AFTER status");
        $results[] = 'Added person_type to members';
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'Duplicate column') !== false) {
            $results[] = 'person_type already exists';
        } else {
            $results[] = 'person_type: ' . $e->getMessage();
        }
    }

    // Set person_type for existing records based on status
    $db->exec("UPDATE members SET person_type = 'church_member' WHERE person_type IS NULL OR person_type = ''");
    $db->exec("UPDATE members SET person_type = 'community' WHERE status = 'non_member_attendee' AND (person_type IS NULL OR person_type = 'church_member')");
    $db->exec("UPDATE members SET person_type = 'community' WHERE status = 'visitor' AND (person_type IS NULL OR person_type = 'church_member')");
    $results[] = 'Updated person_type for existing records';

    // Add source field for tracking where contact was imported from
    try {
        $db->exec("ALTER TABLE members ADD COLUMN import_source VARCHAR(50) DEFAULT NULL AFTER person_type");
        $results[] = 'Added import_source to members';
    } catch (Exception $e) {
        if (strpos($e->getMessage(), 'Duplicate column') !== false) {
            $results[] = 'import_source already exists';
        }
    }

    // Messages table
    $db->exec("
        CREATE TABLE IF NOT EXISTS messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            subject VARCHAR(255) DEFAULT NULL,
            body TEXT NOT NULL,
            message_type ENUM('email','sms','both') DEFAULT 'email',
            send_type ENUM('now','scheduled','recurring') DEFAULT 'now',
            scheduled_at DATETIME DEFAULT NULL,
            recurring_pattern VARCHAR(50) DEFAULT NULL,
            status ENUM('draft','queued','sending','sent','failed') DEFAULT 'draft',
            recipient_type VARCHAR(30) DEFAULT 'individual',
            recipient_filter JSON DEFAULT NULL,
            attachment_path VARCHAR(500) DEFAULT NULL,
            total_recipients INT DEFAULT 0,
            sent_count INT DEFAULT 0,
            failed_count INT DEFAULT 0,
            created_by INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            sent_at DATETIME DEFAULT NULL,
            FOREIGN KEY (created_by) REFERENCES users(id),
            INDEX idx_status (status),
            INDEX idx_scheduled (scheduled_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'messages table created';

    // Message recipients
    $db->exec("
        CREATE TABLE IF NOT EXISTS message_recipients (
            id INT AUTO_INCREMENT PRIMARY KEY,
            message_id INT NOT NULL,
            member_id INT DEFAULT NULL,
            email VARCHAR(255) DEFAULT NULL,
            phone VARCHAR(30) DEFAULT NULL,
            name VARCHAR(200) DEFAULT NULL,
            channel ENUM('email','sms') NOT NULL,
            status ENUM('pending','sent','delivered','failed','bounced') DEFAULT 'pending',
            sent_at DATETIME DEFAULT NULL,
            error_message VARCHAR(500) DEFAULT NULL,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
            INDEX idx_message (message_id),
            INDEX idx_member (member_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'message_recipients table created';

    // Contact tags/statuses for inbox
    $db->exec("
        CREATE TABLE IF NOT EXISTS contact_tags (
            id INT AUTO_INCREMENT PRIMARY KEY,
            member_id INT NOT NULL,
            tag VARCHAR(50) NOT NULL,
            notes VARCHAR(500) DEFAULT NULL,
            created_by INT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
            INDEX idx_member (member_id),
            INDEX idx_tag (tag)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'contact_tags table created';

    // Surveys
    $db->exec("
        CREATE TABLE IF NOT EXISTS surveys (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            description TEXT DEFAULT NULL,
            questions JSON NOT NULL,
            status ENUM('draft','active','closed') DEFAULT 'draft',
            created_by INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            closed_at DATETIME DEFAULT NULL,
            FOREIGN KEY (created_by) REFERENCES users(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'surveys table created';

    // Survey responses
    $db->exec("
        CREATE TABLE IF NOT EXISTS survey_responses (
            id INT AUTO_INCREMENT PRIMARY KEY,
            survey_id INT NOT NULL,
            member_id INT DEFAULT NULL,
            respondent_name VARCHAR(200) DEFAULT NULL,
            answers JSON NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE,
            INDEX idx_survey (survey_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'survey_responses table created';

    // Workflows
    $db->exec("
        CREATE TABLE IF NOT EXISTS workflows (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            trigger_type VARCHAR(50) NOT NULL,
            steps JSON NOT NULL,
            is_active TINYINT(1) DEFAULT 1,
            created_by INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $results[] = 'workflows table created';

} catch (Exception $e) {
    $results[] = 'Error: ' . $e->getMessage();
}

jsonResponse(['results' => $results]);
