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
                COUNT(CASE WHEN status = 'visitor' OR person_type = 'non_member_attendee' THEN 1 END) as visitor_new,
                COUNT(CASE WHEN person_type = 'church_member' THEN 1 END) as type_church_member,
                COUNT(CASE WHEN person_type = 'non_member_attendee' THEN 1 END) as type_non_member,
                COUNT(CASE WHEN person_type = 'companion' THEN 1 END) as type_companion,
                COUNT(CASE WHEN person_type = 'community' THEN 1 END) as type_community,
                COUNT(CASE WHEN person_type NOT IN ('church_member','non_member_attendee','companion','community') OR person_type IS NULL THEN 1 END) as type_other
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

        // Type breakdown
        $typeBreakdown = $db->query("
            SELECT person_type, COUNT(*) as total,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count,
                COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive_count,
                COUNT(CASE WHEN status = 'forsaking' THEN 1 END) as forsaking_count,
                COUNT(CASE WHEN status = 'revoked' THEN 1 END) as revoked_count,
                COUNT(CASE WHEN status = 'restored' THEN 1 END) as restored_count
            FROM members
            GROUP BY person_type
            ORDER BY total DESC
        ")->fetchAll();

        // Status breakdown
        $statusBreakdown = $db->query("
            SELECT status, COUNT(*) as count FROM members GROUP BY status ORDER BY count DESC
        ")->fetchAll();

        jsonResponse([
            'growth' => $growth,
            'cumulative' => $cumulative,
            'total_members' => (int)$totalMembers,
            'active_members' => (int)$activeMembers,
            'type_breakdown' => $typeBreakdown,
            'status_breakdown' => $statusBreakdown,
        ]);
        break;

    case 'engagement':
        $period = $_GET['period'] ?? '3';
        $months = max(1, min(12, (int)$period));
        // Optional: measure engagement against a specific service type only (e.g. Sunday services).
        // Empty = count every service type (default).
        $svcType = trim($_GET['service_type'] ?? '');
        $typeJoin = $svcType ? " AND s.type = ?" : "";
        $typeWhere = $svcType ? " AND type = ?" : "";

        $memberParams = $svcType ? [$months, $svcType] : [$months];
        $stmt = $db->prepare("
            SELECT
                m.id, m.first_name, m.last_name, m.status as member_status, m.family_group,
                COUNT(DISTINCT s.id) as total_services,
                COUNT(CASE WHEN (a.status = 'present' OR a.status = 'late') AND s.id IS NOT NULL THEN 1 END) as attended,
                COUNT(CASE WHEN a.status = 'absent' AND s.id IS NOT NULL THEN 1 END) as absent,
                MAX(CASE WHEN (a.status = 'present' OR a.status = 'late') AND s.id IS NOT NULL THEN s.date END) as last_attended
            FROM members m
            LEFT JOIN attendance a ON a.member_id = m.id
            LEFT JOIN services s ON a.service_id = s.id AND s.date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH) AND s.date <= CURDATE()$typeJoin
            WHERE m.status IN ('active', 'restored')
            GROUP BY m.id
            ORDER BY attended DESC, m.last_name ASC
        ");
        $stmt->execute($memberParams);
        $members = $stmt->fetchAll();

        // Denominator: only services that have already occurred (exclude future-dated services)
        $totalServices = $db->prepare("
            SELECT COUNT(*) FROM services WHERE date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH) AND date <= CURDATE()$typeWhere
        ");
        $totalServices->execute($memberParams);
        $svcCount = (int)$totalServices->fetchColumn();

        // List of service types available for the filter dropdown
        $svcTypes = $db->query("SELECT DISTINCT type FROM services WHERE type IS NOT NULL AND type != '' ORDER BY type")->fetchAll(PDO::FETCH_COLUMN);

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
            'service_type' => $svcType,
            'service_types' => $svcTypes,
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
            WHERE m.status IN ('active', 'restored')
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
                COUNT(CASE WHEN (a.status = 'present' OR a.status = 'late') AND m.person_type = 'non_member_attendee' THEN 1 END) as non_members_attended
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

    case 'department_health':
        $months = max(1, min(12, (int)($_GET['months'] ?? 3)));
        $deptId = isset($_GET['department_id']) ? (int)$_GET['department_id'] : null;
        $startDate = date('Y-m-d', strtotime("-{$months} months"));

        $depts = $db->query("SELECT id, name FROM departments WHERE is_active = 1 ORDER BY sort_order ASC")->fetchAll();
        $svcStmt = $db->prepare("SELECT COUNT(*) FROM services WHERE date >= ?");
        $svcStmt->execute([$startDate]);
        $totalSvc = (int)$svcStmt->fetchColumn();

        $deptStats = [];
        foreach ($depts as $dept) {
            if ($deptId && $dept['id'] != $deptId) continue;
            $stmt = $db->prepare("
                SELECT dr.id, dr.status, s.date as service_date, s.name as service_name,
                    (SELECT COUNT(*) FROM department_report_items ri WHERE ri.report_id = dr.id) as total_items,
                    (SELECT COUNT(*) FROM department_report_items ri WHERE ri.report_id = dr.id AND ri.is_checked = 1) as checked_items
                FROM department_reports dr
                JOIN services s ON dr.service_id = s.id
                WHERE dr.department_id = ? AND s.date >= ?
                ORDER BY s.date ASC
            ");
            $stmt->execute([$dept['id'], $startDate]);
            $deptReports = $stmt->fetchAll();

            $submitted = count($deptReports);
            $reviewed = count(array_filter($deptReports, fn($r) => $r['status'] === 'reviewed'));
            $ti = array_sum(array_column($deptReports, 'total_items'));
            $ci = array_sum(array_column($deptReports, 'checked_items'));

            $monthly = [];
            foreach ($deptReports as $r) {
                $m = substr($r['service_date'], 0, 7);
                if (!isset($monthly[$m])) $monthly[$m] = ['reports' => 0, 'checked' => 0, 'total' => 0];
                $monthly[$m]['reports']++;
                $monthly[$m]['checked'] += (int)$r['checked_items'];
                $monthly[$m]['total'] += (int)$r['total_items'];
            }

            $deptStats[] = [
                'department_id' => (int)$dept['id'],
                'department_name' => $dept['name'],
                'reports_submitted' => $submitted,
                'reports_reviewed' => $reviewed,
                'submission_rate' => $totalSvc > 0 ? round(($submitted / $totalSvc) * 100, 1) : 0,
                'total_items' => $ti,
                'checked_items' => $ci,
                'completion_rate' => $ti > 0 ? round(($ci / $ti) * 100, 1) : 0,
                'monthly_breakdown' => $monthly,
            ];
        }

        jsonResponse([
            'departments' => $deptStats,
            'total_services' => (int)$totalSvc,
            'months' => $months,
            'start_date' => $startDate,
        ]);
        break;

    case 'engagement_by_service':
        $from = $_GET['from'] ?? date('Y-m-01', strtotime('-6 months'));
        $to = $_GET['to'] ?? date('Y-m-d');
        $serviceType = $_GET['service_type'] ?? '';

        $typeWhere = $serviceType ? "AND s.type = ?" : "";
        $typeParams = $serviceType ? [$from, $to, $serviceType] : [$from, $to];

        // Summary by service type
        $typeSummary = $db->prepare("
            SELECT s.type,
                COUNT(DISTINCT s.id) as service_count,
                COALESCE(AVG(sub.attended), 0) as avg_attendance,
                COALESCE(MAX(sub.attended), 0) as max_attendance,
                COALESCE(MIN(sub.attended), 0) as min_attendance
            FROM services s
            LEFT JOIN (
                SELECT a.service_id, COUNT(*) as attended
                FROM attendance a WHERE a.status IN ('present', 'late')
                GROUP BY a.service_id
            ) sub ON sub.service_id = s.id
            WHERE s.date BETWEEN ? AND ? $typeWhere
            GROUP BY s.type
            ORDER BY service_count DESC
        ");
        $typeSummary->execute($typeParams);
        $byType = $typeSummary->fetchAll();

        // Detailed services
        $detailParams = $serviceType ? [$from, $to, $serviceType] : [$from, $to];
        $detailStmt = $db->prepare("
            SELECT s.id, s.name, s.date, s.time, s.type, s.visitor_count, s.head_count,
                COUNT(CASE WHEN a.status IN ('present','late') THEN 1 END) as attended,
                COUNT(a.id) as total_marked,
                COALESCE(s.visitor_count, 0) as visitors
            FROM services s
            LEFT JOIN attendance a ON a.service_id = s.id
            WHERE s.date BETWEEN ? AND ? $typeWhere
            GROUP BY s.id
            ORDER BY s.date DESC, s.time ASC
        ");
        $detailStmt->execute($detailParams);
        $details = $detailStmt->fetchAll();

        // People who attend multiple service types
        $crossAttendance = $db->prepare("
            SELECT m.id, m.first_name, m.last_name,
                GROUP_CONCAT(DISTINCT s.type) as service_types,
                COUNT(DISTINCT s.type) as type_count,
                COUNT(CASE WHEN a.status IN ('present','late') THEN 1 END) as total_attended
            FROM attendance a
            JOIN members m ON m.id = a.member_id
            JOIN services s ON s.id = a.service_id
            WHERE s.date BETWEEN ? AND ? AND a.status IN ('present','late')
            GROUP BY m.id
            HAVING type_count > 1
            ORDER BY type_count DESC, total_attended DESC
            LIMIT 50
        ");
        $crossAttendance->execute([$from, $to]);
        $crossAttenders = $crossAttendance->fetchAll();

        // Top attenders per service type
        $topByType = [];
        foreach ($byType as $bt) {
            $topStmt = $db->prepare("
                SELECT m.id, m.first_name, m.last_name,
                    COUNT(CASE WHEN a.status IN ('present','late') THEN 1 END) as times_attended
                FROM attendance a
                JOIN members m ON m.id = a.member_id
                JOIN services s ON s.id = a.service_id
                WHERE s.date BETWEEN ? AND ? AND s.type = ? AND a.status IN ('present','late')
                GROUP BY m.id
                ORDER BY times_attended DESC
                LIMIT 10
            ");
            $topStmt->execute([$from, $to, $bt['type']]);
            $topByType[$bt['type']] = $topStmt->fetchAll();
        }

        jsonResponse([
            'by_type' => $byType,
            'details' => $details,
            'cross_attenders' => $crossAttenders,
            'top_by_type' => $topByType,
            'from' => $from,
            'to' => $to,
        ]);
        break;

    case 'member_growth_detailed':
        $from = $_GET['from'] ?? date('Y-m-01', strtotime('-12 months'));
        $to = $_GET['to'] ?? date('Y-m-d');

        $growth = $db->prepare("
            SELECT DATE_FORMAT(created_at, '%Y-%m') as month,
                COUNT(*) as total_new,
                COUNT(CASE WHEN person_type = 'church_member' THEN 1 END) as new_members,
                COUNT(CASE WHEN person_type = 'community' THEN 1 END) as new_community,
                COUNT(CASE WHEN person_type = 'companion' THEN 1 END) as new_companions
            FROM members
            WHERE created_at BETWEEN ? AND ?
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY month ASC
        ");
        $growth->execute([$from, $to . ' 23:59:59']);

        $totalsByType = $db->query("
            SELECT person_type, status, COUNT(*) as count
            FROM members
            GROUP BY person_type, status
        ")->fetchAll();

        jsonResponse([
            'monthly' => $growth->fetchAll(),
            'totals_by_type' => $totalsByType,
            'from' => $from,
            'to' => $to,
        ]);
        break;

    default:
        jsonResponse(['error' => 'Invalid action'], 400);
}
