<?php
/**
 * Hallelujah In The City - Church Management System
 * Dashboard API - Statistics and overview data
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$db = getDB();

$isAdmin = in_array($currentUser['role'], ['pastor', 'admin']);

// Get user permissions for non-admin users
$userPerms = [];
if (!$isAdmin) {
    $permStmt = $db->prepare("SELECT permission FROM user_permissions WHERE user_id = ?");
    $permStmt->execute([$currentUser['user_id']]);
    $userPerms = array_column($permStmt->fetchAll(), 'permission');
}

$hasPerm = function($section) use ($isAdmin, $userPerms) {
    if ($isAdmin) return true;
    if (empty($userPerms)) return true;
    return in_array($section, $userPerms);
};

// Total members by status
$memberStats = ['total' => 0, 'active' => 0, 'inactive' => 0, 'visitors' => 0, 'non_member_attendees' => 0];
$newThisMonth = 0;
if ($hasPerm('members')) {
    $memberStats = $db->query("
        SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
            COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive,
            COUNT(CASE WHEN status = 'visitor' THEN 1 END) as visitors,
            COUNT(CASE WHEN status = 'non_member_attendee' THEN 1 END) as non_member_attendees
        FROM members
    ")->fetch();

    $newThisMonth = $db->query("
        SELECT COUNT(*) as count FROM members
        WHERE created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
    ")->fetch()['count'];
}

// Average attendance (last 4 weeks)
$avgAttendance = 0;
$attendanceTrend = [];
if ($hasPerm('attendance')) {
    $avgAttendance = $db->query("
        SELECT AVG(attended) as avg_attendance
        FROM (
            SELECT s.id,
                COUNT(CASE WHEN a.status = 'present' OR a.status = 'late' THEN 1 END) as attended
            FROM services s
            LEFT JOIN attendance a ON a.service_id = s.id
            WHERE s.date >= DATE_SUB(CURDATE(), INTERVAL 4 WEEK)
            GROUP BY s.id
        ) sub
    ")->fetch()['avg_attendance'];

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
}

// Upcoming services (next 5)
$upcomingServices = [];
if ($hasPerm('services')) {
    $upcomingServices = $db->query("
        SELECT * FROM services
        WHERE date >= CURDATE()
        ORDER BY date ASC, time ASC
        LIMIT 5
    ")->fetchAll();
}

// Birthday members this month + upcoming week
$birthdays = [];
$birthdaysThisWeek = [];
$anniversaries = [];
if ($hasPerm('members')) {
    $birthdays = $db->query("
        SELECT id, first_name, last_name, date_of_birth
        FROM members
        WHERE status IN ('active', 'non_member_attendee')
        AND MONTH(date_of_birth) = MONTH(CURDATE())
        ORDER BY DAY(date_of_birth) ASC
        LIMIT 15
    ")->fetchAll();

    $birthdaysThisWeek = $db->query("
        SELECT id, first_name, last_name, date_of_birth
        FROM members
        WHERE status IN ('active', 'non_member_attendee')
        AND date_of_birth IS NOT NULL
        AND DATE_FORMAT(date_of_birth, '%m-%d') BETWEEN DATE_FORMAT(CURDATE(), '%m-%d') AND DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 7 DAY), '%m-%d')
        ORDER BY DATE_FORMAT(date_of_birth, '%m-%d') ASC
        LIMIT 10
    ")->fetchAll();

    $anniversaries = $db->query("
        SELECT id, first_name, last_name, wedding_date
        FROM members
        WHERE status IN ('active', 'non_member_attendee')
        AND wedding_date IS NOT NULL
        AND MONTH(wedding_date) = MONTH(CURDATE())
        ORDER BY DAY(wedding_date) ASC
        LIMIT 10
    ")->fetchAll();
}

// Pending changes count (for admin notification)
$pendingCount = 0;
if ($isAdmin) {
    try {
        $pendingCount = (int)$db->query("SELECT COUNT(*) as cnt FROM pending_changes WHERE status = 'pending'")->fetch()['cnt'];
    } catch (Exception $e) {}
}

// Department reports pending review (admin)
$pendingReports = 0;
if ($isAdmin) {
    try {
        $pendingReports = (int)$db->query("SELECT COUNT(*) FROM department_reports WHERE status = 'submitted'")->fetchColumn();
    } catch (Exception $e) {}
}

// Services without attendance (upcoming that haven't been filled)
$servicesWithoutAttendance = [];
if ($hasPerm('services') || $hasPerm('attendance')) {
    $servicesWithoutAttendance = $db->query("
        SELECT s.id, s.name, s.date, s.time, s.type
        FROM services s
        LEFT JOIN attendance a ON a.service_id = s.id
        WHERE s.date < CURDATE()
        AND s.date >= DATE_SUB(CURDATE(), INTERVAL 2 WEEK)
        GROUP BY s.id
        HAVING COUNT(a.id) = 0
        ORDER BY s.date DESC
        LIMIT 5
    ")->fetchAll();
}

jsonResponse([
    'members' => [
        'total' => (int)($memberStats['total'] ?? 0),
        'active' => (int)($memberStats['active'] ?? 0),
        'inactive' => (int)($memberStats['inactive'] ?? 0),
        'visitors' => (int)($memberStats['visitors'] ?? 0),
        'non_member_attendees' => (int)($memberStats['non_member_attendees'] ?? 0),
        'new_this_month' => (int)$newThisMonth,
    ],
    'attendance' => [
        'avg_last_4_weeks' => $avgAttendance ? round((float)$avgAttendance, 1) : 0,
        'trend' => $attendanceTrend,
    ],
    'upcoming_services' => $upcomingServices,
    'birthdays_this_month' => $birthdays,
    'birthdays_this_week' => $birthdaysThisWeek,
    'anniversaries_this_month' => $anniversaries,
    'pending_changes_count' => $pendingCount,
    'pending_reports_count' => $pendingReports,
    'services_without_attendance' => $servicesWithoutAttendance,
    'user_permissions' => $isAdmin ? ['all'] : $userPerms,
]);
