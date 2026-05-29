<?php
/**
 * Hallelujah In The City - Church Management System
 * Dashboard API - Statistics and overview data
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$db = getDB();

// Total members by status
$memberStats = $db->query("
    SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive,
        COUNT(CASE WHEN status = 'visitor' THEN 1 END) as visitors
    FROM members
")->fetch();

// Members added this month
$newThisMonth = $db->query("
    SELECT COUNT(*) as count FROM members
    WHERE created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
")->fetch()['count'];

// Recent services (last 5)
$recentServices = $db->query("
    SELECT s.*,
        (SELECT COUNT(*) FROM attendance a WHERE a.service_id = s.id AND (a.status = 'present' OR a.status = 'late')) as attended,
        (SELECT COUNT(*) FROM attendance a WHERE a.service_id = s.id) as total_marked
    FROM services s
    ORDER BY s.date DESC, s.time DESC
    LIMIT 5
")->fetchAll();

// Average attendance (last 4 weeks)
$avgAttendance = $db->query("
    SELECT
        AVG(attended) as avg_attendance
    FROM (
        SELECT s.id,
            COUNT(CASE WHEN a.status = 'present' OR a.status = 'late' THEN 1 END) as attended
        FROM services s
        LEFT JOIN attendance a ON a.service_id = s.id
        WHERE s.date >= DATE_SUB(CURDATE(), INTERVAL 4 WEEK)
        GROUP BY s.id
    ) sub
")->fetch()['avg_attendance'];

// Attendance trend (last 8 services)
$attendanceTrend = $db->query("
    SELECT s.id, s.name, s.date, s.type,
        COUNT(CASE WHEN a.status = 'present' OR a.status = 'late' THEN 1 END) as attended,
        COUNT(a.id) as total_marked
    FROM services s
    LEFT JOIN attendance a ON a.service_id = s.id
    GROUP BY s.id
    ORDER BY s.date DESC, s.time DESC
    LIMIT 8
")->fetchAll();
$attendanceTrend = array_reverse($attendanceTrend);

// Gender distribution
$genderDist = $db->query("
    SELECT
        COUNT(CASE WHEN gender = 'male' THEN 1 END) as male,
        COUNT(CASE WHEN gender = 'female' THEN 1 END) as female,
        COUNT(CASE WHEN gender = 'other' OR gender IS NULL THEN 1 END) as other
    FROM members WHERE status = 'active'
")->fetch();

// Upcoming services (next 5)
$upcomingServices = $db->query("
    SELECT * FROM services
    WHERE date >= CURDATE()
    ORDER BY date ASC, time ASC
    LIMIT 5
")->fetchAll();

// Birthday members this month
$birthdays = $db->query("
    SELECT id, first_name, last_name, date_of_birth
    FROM members
    WHERE status = 'active'
    AND MONTH(date_of_birth) = MONTH(CURDATE())
    ORDER BY DAY(date_of_birth) ASC
    LIMIT 10
")->fetchAll();

// Total system users
$totalUsers = $db->query("SELECT COUNT(*) as count FROM users WHERE status = 'active'")->fetch()['count'];

// Pending changes count (for admin notification)
$pendingCount = 0;
try {
    $pendingCount = (int)$db->query("SELECT COUNT(*) as cnt FROM pending_changes WHERE status = 'pending'")->fetch()['cnt'];
} catch (Exception $e) {
    // Table may not exist yet
}

jsonResponse([
    'members' => [
        'total' => (int)$memberStats['total'],
        'active' => (int)$memberStats['active'],
        'inactive' => (int)$memberStats['inactive'],
        'visitors' => (int)$memberStats['visitors'],
        'new_this_month' => (int)$newThisMonth,
    ],
    'attendance' => [
        'avg_last_4_weeks' => $avgAttendance ? round((float)$avgAttendance, 1) : 0,
        'trend' => $attendanceTrend,
    ],
    'recent_services' => $recentServices,
    'upcoming_services' => $upcomingServices,
    'gender_distribution' => $genderDist,
    'birthdays_this_month' => $birthdays,
    'total_users' => (int)$totalUsers,
    'pending_changes_count' => $pendingCount,
]);
