<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$db = getDB();
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'member_growth':
        $months = max(3, min(24, (int)($_GET['months'] ?? 12)));
        $stmt = $db->prepare("
            SELECT
                DATE_FORMAT(created_at, '%Y-%m') as month,
                COUNT(*) as new_members,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_new,
                COUNT(CASE WHEN status = 'visitor' THEN 1 END) as visitor_new
            FROM members
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY month ASC
        ");
        $stmt->execute([$months]);
        $growth = $stmt->fetchAll();

        $cumulative = $db->query("
            SELECT
                DATE_FORMAT(created_at, '%Y-%m') as month,
                (SELECT COUNT(*) FROM members m2 WHERE m2.created_at <= LAST_DAY(CONCAT(DATE_FORMAT(m.created_at, '%Y-%m'), '-01'))) as cumulative_total
            FROM members m
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL $months MONTH)
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY month ASC
        ")->fetchAll();

        $totalMembers = $db->query("SELECT COUNT(*) FROM members")->fetchColumn();
        $activeMembers = $db->query("SELECT COUNT(*) FROM members WHERE status = 'active'")->fetchColumn();

        jsonResponse([
            'growth' => $growth,
            'cumulative' => $cumulative,
            'total_members' => (int)$totalMembers,
            'active_members' => (int)$activeMembers,
        ]);
        break;

    case 'engagement':
        $period = $_GET['period'] ?? '3';
        $months = max(1, min(12, (int)$period));

        $stmt = $db->prepare("
            SELECT
                m.id, m.first_name, m.last_name, m.status as member_status, m.family_group,
                COUNT(DISTINCT s.id) as total_services,
                COUNT(CASE WHEN a.status = 'present' OR a.status = 'late' THEN 1 END) as attended,
                COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent,
                MAX(CASE WHEN a.status = 'present' OR a.status = 'late' THEN s.date END) as last_attended
            FROM members m
            LEFT JOIN attendance a ON a.member_id = m.id
            LEFT JOIN services s ON a.service_id = s.id AND s.date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
            WHERE m.status IN ('active', 'non_member_attendee')
            GROUP BY m.id
            ORDER BY attended DESC, m.last_name ASC
        ");
        $stmt->execute([$months]);
        $members = $stmt->fetchAll();

        $totalServices = $db->prepare("
            SELECT COUNT(*) FROM services WHERE date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
        ");
        $totalServices->execute([$months]);
        $svcCount = (int)$totalServices->fetchColumn();

        foreach ($members as &$m) {
            $m['attendance_rate'] = $svcCount > 0
                ? round(((int)$m['attended'] / $svcCount) * 100, 1)
                : 0;
        }
        unset($m);

        jsonResponse([
            'members' => $members,
            'total_services' => $svcCount,
            'period_months' => $months,
        ]);
        break;

    case 'inactive':
        $days = max(7, min(365, (int)($_GET['days'] ?? 30)));

        $stmt = $db->prepare("
            SELECT
                m.id, m.first_name, m.last_name, m.phone, m.email, m.family_group,
                MAX(CASE WHEN a.status = 'present' OR a.status = 'late' THEN s.date END) as last_attended,
                DATEDIFF(CURDATE(), MAX(CASE WHEN a.status = 'present' OR a.status = 'late' THEN s.date END)) as days_absent
            FROM members m
            LEFT JOIN attendance a ON a.member_id = m.id
            LEFT JOIN services s ON a.service_id = s.id
            WHERE m.status IN ('active', 'non_member_attendee')
            GROUP BY m.id
            HAVING last_attended IS NULL OR days_absent >= ?
            ORDER BY days_absent DESC
        ");
        $stmt->execute([$days]);
        $inactive = $stmt->fetchAll();

        jsonResponse(['inactive_members' => $inactive, 'threshold_days' => $days]);
        break;

    case 'directory':
        $stmt = $db->query("
            SELECT id, first_name, last_name, email, phone, address, city, state, zip,
                   gender, date_of_birth, family_group, membership_date, status
            FROM members
            ORDER BY last_name ASC, first_name ASC
        ");
        jsonResponse(['members' => $stmt->fetchAll()]);
        break;

    case 'attendance_summary':
        $from = $_GET['from'] ?? date('Y-m-01', strtotime('-3 months'));
        $to = $_GET['to'] ?? date('Y-m-d');

        $stmt = $db->prepare("
            SELECT s.id, s.name, s.date, s.time, s.type, s.visitor_count, s.head_count,
                COUNT(CASE WHEN a.status = 'present' OR a.status = 'late' THEN 1 END) as attended,
                COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent,
                COUNT(a.id) as total_marked,
                COUNT(CASE WHEN (a.status = 'present' OR a.status = 'late') AND m.status = 'active' THEN 1 END) as members_attended,
                COUNT(CASE WHEN (a.status = 'present' OR a.status = 'late') AND m.status = 'non_member_attendee' THEN 1 END) as non_members_attended
            FROM services s
            LEFT JOIN attendance a ON a.service_id = s.id
            LEFT JOIN members m ON a.member_id = m.id
            WHERE s.date BETWEEN ? AND ?
            GROUP BY s.id
            ORDER BY s.date DESC, s.time DESC
        ");
        $stmt->execute([$from, $to]);
        $services = $stmt->fetchAll();

        $totalAttended = array_sum(array_column($services, 'attended'));
        $totalAbsent = array_sum(array_column($services, 'absent'));
        $totalVisitors = array_sum(array_column($services, 'visitor_count'));
        $totalMembersAttended = array_sum(array_column($services, 'members_attended'));
        $totalNonMembersAttended = array_sum(array_column($services, 'non_members_attended'));

        jsonResponse([
            'services' => $services,
            'summary' => [
                'total_services' => count($services),
                'total_attended' => $totalAttended,
                'total_absent' => $totalAbsent,
                'total_visitors' => (int)$totalVisitors,
                'total_members_attended' => $totalMembersAttended,
                'total_non_members_attended' => $totalNonMembersAttended,
                'avg_attendance' => count($services) > 0 ? round($totalAttended / count($services), 1) : 0,
            ],
            'from' => $from,
            'to' => $to,
        ]);
        break;

    default:
        jsonResponse(['error' => 'Invalid action. Use: member_growth, engagement, inactive, directory, attendance_summary'], 400);
}
