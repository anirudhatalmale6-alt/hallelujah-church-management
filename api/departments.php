<?php
/**
 * Hallelujah In The City - Church Management System
 * Departments & Department Reports API
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$action = $_GET['action'] ?? '';
$db = getDB();
$isAdmin = in_array($currentUser['role'], ['pastor', 'admin']);

switch ($method) {
    case 'GET':
        if ($action === 'my_departments') {
            // Get departments assigned to the current user
            $stmt = $db->prepare("
                SELECT d.*, dm.role as my_role
                FROM department_members dm
                JOIN departments d ON dm.department_id = d.id
                WHERE dm.user_id = ? AND d.is_active = 1
                ORDER BY d.sort_order ASC
            ");
            $stmt->execute([$currentUser['user_id']]);
            jsonResponse(['departments' => $stmt->fetchAll()]);

        } elseif ($action === 'pending_alerts') {
            // Get services from 2+ days ago that are missing department reports for the user's departments
            $userId = $currentUser['user_id'];
            $stmt = $db->prepare("
                SELECT d.id as department_id, d.name as department_name, dm.role as my_role,
                    s.id as service_id, s.name as service_name, s.date as service_date, s.type as service_type
                FROM department_members dm
                JOIN departments d ON dm.department_id = d.id
                JOIN services s ON s.date <= DATE_SUB(CURDATE(), INTERVAL 2 DAY) AND s.date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
                LEFT JOIN department_reports dr ON dr.department_id = d.id AND dr.service_id = s.id
                WHERE dm.user_id = ? AND d.is_active = 1 AND dr.id IS NULL
                ORDER BY s.date DESC, d.sort_order ASC
                LIMIT 20
            ");
            $stmt->execute([$userId]);
            jsonResponse(['alerts' => $stmt->fetchAll()]);

        } elseif ($action === 'members' && $id) {
            // Get members of a department
            $stmt = $db->prepare("
                SELECT dm.*, u.name as user_name, u.email as user_email, u.role as user_role
                FROM department_members dm
                JOIN users u ON dm.user_id = u.id
                WHERE dm.department_id = ?
                ORDER BY dm.role ASC, u.name ASC
            ");
            $stmt->execute([$id]);
            jsonResponse(['members' => $stmt->fetchAll()]);

        } elseif ($action === 'health_report') {
            // Department health analytics over time
            $deptId = isset($_GET['department_id']) ? (int)$_GET['department_id'] : null;
            $months = max(1, min(12, (int)($_GET['months'] ?? 3)));
            $startDate = date('Y-m-d', strtotime("-{$months} months"));

            if ($deptId) {
                // Single department health
                $stmt = $db->prepare("
                    SELECT dr.id, dr.status, dr.reporter_name, dr.remarks,
                        s.name as service_name, s.date as service_date, s.type as service_type,
                        u.name as submitted_by_name,
                        (SELECT COUNT(*) FROM department_report_items ri WHERE ri.report_id = dr.id) as total_items,
                        (SELECT COUNT(*) FROM department_report_items ri WHERE ri.report_id = dr.id AND ri.is_checked = 1) as checked_items
                    FROM department_reports dr
                    JOIN services s ON dr.service_id = s.id
                    LEFT JOIN users u ON dr.submitted_by = u.id
                    WHERE dr.department_id = ? AND s.date >= ?
                    ORDER BY s.date DESC
                ");
                $stmt->execute([$deptId, $startDate]);
                $reports = $stmt->fetchAll();

                $dept = $db->prepare("SELECT name FROM departments WHERE id = ?");
                $dept->execute([$deptId]);
                $deptName = $dept->fetchColumn();

                $totalServices = $db->prepare("SELECT COUNT(*) FROM services WHERE date >= ?");
                $totalServices->execute([$startDate]);
                $svcCount = (int)$totalServices->fetchColumn();

                $totalChecked = 0;
                $totalItems = 0;
                foreach ($reports as $r) {
                    $totalChecked += (int)$r['checked_items'];
                    $totalItems += (int)$r['total_items'];
                }

                jsonResponse([
                    'department_name' => $deptName,
                    'reports' => $reports,
                    'total_services' => $svcCount,
                    'reports_submitted' => count($reports),
                    'submission_rate' => $svcCount > 0 ? round((count($reports) / $svcCount) * 100, 1) : 0,
                    'total_items' => $totalItems,
                    'total_checked' => $totalChecked,
                    'completion_rate' => $totalItems > 0 ? round(($totalChecked / $totalItems) * 100, 1) : 0,
                    'months' => $months,
                ]);

            } else {
                // All departments overview
                $depts = $db->query("SELECT id, name FROM departments WHERE is_active = 1 ORDER BY sort_order ASC")->fetchAll();

                $totalServices = $db->prepare("SELECT COUNT(*) FROM services WHERE date >= ?");
                $totalServices->execute([$startDate]);
                $svcCount = (int)$totalServices->fetchColumn();

                $result = [];
                foreach ($depts as $dept) {
                    $stmt = $db->prepare("
                        SELECT
                            COUNT(dr.id) as reports_submitted,
                            SUM((SELECT COUNT(*) FROM department_report_items ri WHERE ri.report_id = dr.id)) as total_items,
                            SUM((SELECT COUNT(*) FROM department_report_items ri WHERE ri.report_id = dr.id AND ri.is_checked = 1)) as checked_items
                        FROM department_reports dr
                        JOIN services s ON dr.service_id = s.id
                        WHERE dr.department_id = ? AND s.date >= ?
                    ");
                    $stmt->execute([$dept['id'], $startDate]);
                    $stats = $stmt->fetch();

                    $submitted = (int)($stats['reports_submitted'] ?? 0);
                    $totalItems = (int)($stats['total_items'] ?? 0);
                    $checkedItems = (int)($stats['checked_items'] ?? 0);

                    $result[] = [
                        'department_id' => (int)$dept['id'],
                        'department_name' => $dept['name'],
                        'reports_submitted' => $submitted,
                        'submission_rate' => $svcCount > 0 ? round(($submitted / $svcCount) * 100, 1) : 0,
                        'total_items' => $totalItems,
                        'checked_items' => $checkedItems,
                        'completion_rate' => $totalItems > 0 ? round(($checkedItems / $totalItems) * 100, 1) : 0,
                    ];
                }

                jsonResponse([
                    'departments' => $result,
                    'total_services' => $svcCount,
                    'months' => $months,
                ]);
            }

        } elseif ($action === 'report' && $id) {
            // Get a specific department report with items
            $stmt = $db->prepare("
                SELECT dr.*, d.name as department_name,
                    s.name as service_name, s.date as service_date, s.time as service_time, s.type as service_type,
                    u1.name as submitted_by_name, u2.name as reviewed_by_name
                FROM department_reports dr
                JOIN departments d ON dr.department_id = d.id
                JOIN services s ON dr.service_id = s.id
                LEFT JOIN users u1 ON dr.submitted_by = u1.id
                LEFT JOIN users u2 ON dr.reviewed_by = u2.id
                WHERE dr.id = ?
            ");
            $stmt->execute([$id]);
            $report = $stmt->fetch();
            if (!$report) jsonResponse(['error' => 'Report not found'], 404);

            $items = $db->prepare("SELECT * FROM department_report_items WHERE report_id = ? ORDER BY sort_order ASC");
            $items->execute([$id]);

            jsonResponse(['report' => $report, 'items' => $items->fetchAll()]);

        } elseif ($action === 'reports') {
            // List department reports with filters
            $deptId = isset($_GET['department_id']) ? (int)$_GET['department_id'] : null;
            $serviceId = isset($_GET['service_id']) ? (int)$_GET['service_id'] : null;
            $status = $_GET['status'] ?? '';

            $where = [];
            $params = [];

            if ($deptId) { $where[] = "dr.department_id = ?"; $params[] = $deptId; }
            if ($serviceId) { $where[] = "dr.service_id = ?"; $params[] = $serviceId; }
            if ($status) { $where[] = "dr.status = ?"; $params[] = $status; }

            $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

            $stmt = $db->prepare("
                SELECT dr.*, d.name as department_name,
                    s.name as service_name, s.date as service_date, s.time as service_time,
                    u.name as submitted_by_name
                FROM department_reports dr
                JOIN departments d ON dr.department_id = d.id
                JOIN services s ON dr.service_id = s.id
                LEFT JOIN users u ON dr.submitted_by = u.id
                $whereClause
                ORDER BY s.date DESC, d.sort_order ASC
                LIMIT 100
            ");
            $stmt->execute($params);
            jsonResponse(['reports' => $stmt->fetchAll()]);

        } elseif ($action === 'templates' && $id) {
            // Get templates for a department
            $stmt = $db->prepare("SELECT * FROM department_report_templates WHERE department_id = ? AND is_active = 1 ORDER BY sort_order ASC");
            $stmt->execute([$id]);
            jsonResponse(['templates' => $stmt->fetchAll()]);

        } elseif ($action === 'for_service') {
            // Get all department reports for a service (overview)
            $serviceId = isset($_GET['service_id']) ? (int)$_GET['service_id'] : null;
            if (!$serviceId) jsonResponse(['error' => 'service_id required'], 400);

            $depts = $db->query("SELECT * FROM departments WHERE is_active = 1 ORDER BY sort_order ASC")->fetchAll();

            $result = [];
            foreach ($depts as $dept) {
                $reportStmt = $db->prepare("
                    SELECT dr.*, u.name as submitted_by_name
                    FROM department_reports dr
                    LEFT JOIN users u ON dr.submitted_by = u.id
                    WHERE dr.department_id = ? AND dr.service_id = ?
                ");
                $reportStmt->execute([$dept['id'], $serviceId]);
                $report = $reportStmt->fetch();

                $result[] = [
                    'department' => $dept,
                    'report' => $report ?: null,
                ];
            }
            jsonResponse(['departments' => $result]);

        } elseif ($id) {
            // Get single department
            $stmt = $db->prepare("SELECT d.*, u.name as leader_name FROM departments d LEFT JOIN users u ON d.leader_user_id = u.id WHERE d.id = ?");
            $stmt->execute([$id]);
            $dept = $stmt->fetch();
            if (!$dept) jsonResponse(['error' => 'Department not found'], 404);
            jsonResponse(['department' => $dept]);

        } else {
            // List departments
            $depts = $db->query("
                SELECT d.*, u.name as leader_name,
                    (SELECT COUNT(*) FROM department_report_templates t WHERE t.department_id = d.id AND t.is_active = 1) as template_count
                FROM departments d
                LEFT JOIN users u ON d.leader_user_id = u.id
                ORDER BY d.sort_order ASC
            ")->fetchAll();
            jsonResponse(['departments' => $depts]);
        }
        break;

    case 'POST':
        if ($action === 'department') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            if (empty(trim($data['name'] ?? ''))) jsonResponse(['error' => 'Department name required'], 400);

            $stmt = $db->prepare("INSERT INTO departments (name, description, leader_user_id, sort_order) VALUES (?, ?, ?, ?)");
            $stmt->execute([
                trim($data['name']),
                $data['description'] ?? null,
                $data['leader_user_id'] ?? null,
                (int)($data['sort_order'] ?? 0),
            ]);
            jsonResponse(['message' => 'Department created', 'id' => (int)$db->lastInsertId()], 201);

        } elseif ($action === 'template') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            if (empty($data['department_id']) || empty(trim($data['item_name'] ?? ''))) {
                jsonResponse(['error' => 'department_id and item_name required'], 400);
            }

            $maxOrder = $db->prepare("SELECT MAX(sort_order) FROM department_report_templates WHERE department_id = ?");
            $maxOrder->execute([$data['department_id']]);
            $nextOrder = ((int)$maxOrder->fetchColumn()) + 1;

            $stmt = $db->prepare("INSERT INTO department_report_templates (department_id, item_name, sort_order) VALUES (?, ?, ?)");
            $stmt->execute([(int)$data['department_id'], trim($data['item_name']), $nextOrder]);
            jsonResponse(['message' => 'Template item added', 'id' => (int)$db->lastInsertId()], 201);

        } elseif ($action === 'assign_member') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            if (empty($data['department_id']) || empty($data['user_id'])) {
                jsonResponse(['error' => 'department_id and user_id required'], 400);
            }
            $role = $data['role'] ?? 'member';
            if (!in_array($role, ['member', 'leader', 'reporter'])) $role = 'member';

            try {
                $stmt = $db->prepare("INSERT INTO department_members (department_id, user_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = ?");
                $stmt->execute([(int)$data['department_id'], (int)$data['user_id'], $role, $role]);
                jsonResponse(['message' => 'Member assigned to department']);
            } catch (Exception $e) {
                jsonResponse(['error' => 'Failed to assign: ' . $e->getMessage()], 500);
            }

        } elseif ($action === 'submit_report') {
            $data = getRequestBody();
            if (empty($data['department_id']) || empty($data['service_id'])) {
                jsonResponse(['error' => 'department_id and service_id required'], 400);
            }

            $deptId = (int)$data['department_id'];
            $serviceId = (int)$data['service_id'];

            // Check if report already exists
            $existingStmt = $db->prepare("SELECT id FROM department_reports WHERE department_id = ? AND service_id = ?");
            $existingStmt->execute([$deptId, $serviceId]);
            $existingId = $existingStmt->fetchColumn();

            $reporterName = $data['reporter_name'] ?? null;

            $db->beginTransaction();
            try {
                if ($existingId) {
                    $reportId = $existingId;
                    $db->prepare("UPDATE department_reports SET submitted_by = ?, reporter_name = ?, status = 'submitted', remarks = ?, updated_at = NOW() WHERE id = ?")
                       ->execute([$currentUser['user_id'], $reporterName, $data['remarks'] ?? null, $reportId]);
                    $db->prepare("DELETE FROM department_report_items WHERE report_id = ?")->execute([$reportId]);
                } else {
                    $db->prepare("INSERT INTO department_reports (department_id, service_id, submitted_by, reporter_name, status, remarks) VALUES (?, ?, ?, ?, 'submitted', ?)")
                       ->execute([$deptId, $serviceId, $currentUser['user_id'], $reporterName, $data['remarks'] ?? null]);
                    $reportId = (int)$db->lastInsertId();
                }

                // Insert items
                if (!empty($data['items']) && is_array($data['items'])) {
                    $insertItem = $db->prepare("INSERT INTO department_report_items (report_id, item_name, is_checked, notes, sort_order) VALUES (?, ?, ?, ?, ?)");
                    foreach ($data['items'] as $i => $item) {
                        $insertItem->execute([
                            $reportId,
                            $item['item_name'] ?? '',
                            $item['is_checked'] ? 1 : 0,
                            $item['notes'] ?? null,
                            $i + 1,
                        ]);
                    }
                }

                $db->commit();
                jsonResponse(['message' => 'Report submitted', 'report_id' => $reportId]);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Failed to submit report: ' . $e->getMessage()], 500);
            }

        } else {
            jsonResponse(['error' => 'Invalid action'], 400);
        }
        break;

    case 'PUT':
        if ($action === 'department' && $id) {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            $fields = [];
            $params = [];
            $allowed = ['name', 'description', 'leader_user_id', 'is_active', 'sort_order'];

            foreach ($allowed as $field) {
                if (array_key_exists($field, $data)) {
                    $fields[] = "$field = ?";
                    $params[] = $data[$field];
                }
            }
            if (empty($fields)) jsonResponse(['error' => 'No fields to update'], 400);

            $params[] = $id;
            $db->prepare("UPDATE departments SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
            jsonResponse(['message' => 'Department updated']);

        } elseif ($action === 'review_report' && $id) {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            $newStatus = $data['status'] ?? 'reviewed';
            if (!in_array($newStatus, ['reviewed', 'pending'])) {
                jsonResponse(['error' => 'Invalid status'], 400);
            }

            $db->prepare("UPDATE department_reports SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_notes = ? WHERE id = ?")
               ->execute([$newStatus, $currentUser['user_id'], $data['review_notes'] ?? null, $id]);
            jsonResponse(['message' => 'Report reviewed']);

        } elseif ($action === 'template' && $id) {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            $fields = [];
            $params = [];

            if (isset($data['item_name'])) { $fields[] = "item_name = ?"; $params[] = $data['item_name']; }
            if (isset($data['is_active'])) { $fields[] = "is_active = ?"; $params[] = $data['is_active'] ? 1 : 0; }
            if (isset($data['sort_order'])) { $fields[] = "sort_order = ?"; $params[] = (int)$data['sort_order']; }

            if (empty($fields)) jsonResponse(['error' => 'No fields to update'], 400);
            $params[] = $id;
            $db->prepare("UPDATE department_report_templates SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
            jsonResponse(['message' => 'Template updated']);

        } else {
            jsonResponse(['error' => 'Invalid action'], 400);
        }
        break;

    case 'DELETE':
        requireRole($currentUser, ['pastor', 'admin']);

        if ($action === 'department' && $id) {
            $db->prepare("DELETE FROM departments WHERE id = ?")->execute([$id]);
            jsonResponse(['message' => 'Department deleted']);
        } elseif ($action === 'remove_member' && $id) {
            $db->prepare("DELETE FROM department_members WHERE id = ?")->execute([$id]);
            jsonResponse(['message' => 'Member removed from department']);
        } elseif ($action === 'template' && $id) {
            $db->prepare("DELETE FROM department_report_templates WHERE id = ?")->execute([$id]);
            jsonResponse(['message' => 'Template deleted']);
        } else {
            jsonResponse(['error' => 'Invalid action'], 400);
        }
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
