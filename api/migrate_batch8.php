<?php
/**
 * Migration Batch 8 - Recurring Services, Departments, Department Reports
 */
ini_set('display_errors', 1);
error_reporting(E_ALL);
header('Content-Type: application/json');

require_once __DIR__ . '/config.php';

$db = getDB();

try {
    $db->beginTransaction();

    // Service Schedules - recurring service definitions
    $db->exec("CREATE TABLE IF NOT EXISTS service_schedules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        day_of_week TINYINT NOT NULL,
        time TIME NOT NULL,
        frequency VARCHAR(50) NOT NULL DEFAULT 'weekly',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        auto_create_weeks_ahead INT NOT NULL DEFAULT 4,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Departments
    $db->exec("CREATE TABLE IF NOT EXISTS departments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        leader_user_id INT,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (leader_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Department report templates (checklist items per department)
    $db->exec("CREATE TABLE IF NOT EXISTS department_report_templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        department_id INT NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Department reports (one per department per service)
    $db->exec("CREATE TABLE IF NOT EXISTS department_reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        department_id INT NOT NULL,
        service_id INT NOT NULL,
        submitted_by INT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        remarks TEXT,
        reviewed_by INT,
        reviewed_at TIMESTAMP NULL,
        review_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_dept_service (department_id, service_id),
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
        FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Department report items (checklist + notes per report)
    $db->exec("CREATE TABLE IF NOT EXISTS department_report_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        report_id INT NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        is_checked TINYINT(1) NOT NULL DEFAULT 0,
        notes TEXT,
        sort_order INT NOT NULL DEFAULT 0,
        FOREIGN KEY (report_id) REFERENCES department_reports(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Insert default departments
    $depts = [
        ['Ushers', 'Welcome and seating of members and visitors', 1],
        ['Maintenance', 'Building and facility maintenance', 2],
        ['Worship Team', 'Music and worship ministry', 3],
        ['Media/Tech', 'Sound, projection, recording, and streaming', 4],
        ['Children Ministry', 'Sunday school and children activities', 5],
        ['Security', 'Safety and security of the premises', 6],
        ['Hospitality', 'Refreshments and fellowship coordination', 7],
        ['Prayer Team', 'Intercessory prayer ministry', 8],
    ];

    $checkExisting = $db->query("SELECT COUNT(*) FROM departments")->fetchColumn();
    if ($checkExisting == 0) {
        $insertDept = $db->prepare("INSERT INTO departments (name, description, sort_order) VALUES (?, ?, ?)");
        foreach ($depts as $dept) {
            $insertDept->execute($dept);
        }

        // Insert default report template items for each department
        $deptTemplates = [
            'Ushers' => ['Greeters positioned at entrance', 'Bulletins/programs distributed', 'Seating arrangement checked', 'Offering collection prepared', 'Visitor cards available'],
            'Maintenance' => ['Building inspected', 'Restrooms cleaned and stocked', 'HVAC/temperature checked', 'Lights working properly', 'Parking lot clean'],
            'Worship Team' => ['Song list prepared', 'Instruments tuned', 'Team rehearsal completed', 'Lyrics loaded on projector', 'Microphones tested'],
            'Media/Tech' => ['Sound system tested', 'Projector/screens ready', 'Recording equipment set up', 'Livestream tested', 'Presentation slides loaded'],
            'Children Ministry' => ['Classroom prepared', 'Materials/supplies ready', 'Check-in system ready', 'Snacks prepared', 'Teachers briefed'],
            'Security' => ['Premises walked and inspected', 'Emergency exits clear', 'First aid kit stocked', 'Parking lot monitored', 'Doors locked after service'],
            'Hospitality' => ['Refreshments prepared', 'Fellowship area set up', 'Serving supplies ready', 'Cleanup crew assigned'],
            'Prayer Team' => ['Prayer room prepared', 'Prayer requests collected', 'Team members assigned positions', 'Post-service prayer coverage ready'],
        ];

        $getDeptId = $db->prepare("SELECT id FROM departments WHERE name = ?");
        $insertItem = $db->prepare("INSERT INTO department_report_templates (department_id, item_name, sort_order) VALUES (?, ?, ?)");

        foreach ($deptTemplates as $deptName => $items) {
            $getDeptId->execute([$deptName]);
            $deptId = $getDeptId->fetchColumn();
            if ($deptId) {
                foreach ($items as $i => $item) {
                    $insertItem->execute([$deptId, $item, $i + 1]);
                }
            }
        }
    }

    // Insert default service schedules
    $checkSchedules = $db->query("SELECT COUNT(*) FROM service_schedules")->fetchColumn();
    if ($checkSchedules == 0) {
        $insertSchedule = $db->prepare("INSERT INTO service_schedules (name, type, day_of_week, time, frequency) VALUES (?, ?, ?, ?, ?)");
        $insertSchedule->execute(['Sunday 1st Service', 'sunday_1st', 0, '09:00:00', 'weekly']);
        $insertSchedule->execute(['Sunday 2nd Service', 'sunday_2nd', 0, '11:00:00', 'weekly']);
        $insertSchedule->execute(['Bible Study', 'bible_study', 3, '19:00:00', 'weekly']);
        $insertSchedule->execute(['Fasting Service', 'fasting', 5, '09:00:00', 'monthly']);
    }

    $db->commit();
    echo json_encode(['success' => true, 'message' => 'Migration batch 8 completed successfully']);

} catch (Exception $e) {
    $db->rollBack();
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
