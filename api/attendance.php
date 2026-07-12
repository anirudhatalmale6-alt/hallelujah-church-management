<?php
/**
 * Hallelujah In The City - Church Management System
 * Attendance API - Mark and retrieve attendance records
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

$action = $_GET['action'] ?? '';
$serviceId = isset($_GET['service_id']) ? (int)$_GET['service_id'] : null;
$memberId = isset($_GET['member_id']) ? (int)$_GET['member_id'] : null;

switch ($method) {
    case 'GET':
        if ($action === 'by_service' && $serviceId) {
            // Auto-sync: mark absent for ended services (uses per-service duration)
            try {
                $now = date('Y-m-d H:i:s');
                $svcCheck = $db->prepare("SELECT id, date, time, COALESCE(duration_hours, 2.0) as duration_hours FROM services WHERE id = ? AND time IS NOT NULL");
                $svcCheck->execute([$serviceId]);
                $svcInfo = $svcCheck->fetch();
                if ($svcInfo) {
                    $serviceEnd = strtotime($svcInfo['date'] . ' ' . $svcInfo['time']) + ($svcInfo['duration_hours'] * 3600);
                    if (time() > $serviceEnd) {
                        // Only auto-mark absent for person types configured with auto_absent
                        // (by default: church members and non-member attendees).
                        $aaTypes = autoAbsentPersonTypes($db);
                        $aaPlaceholders = implode(',', array_fill(0, count($aaTypes), '?'));
                        $missingStmt = $db->prepare("
                            SELECT m.id FROM members m
                            WHERE m.status IN ('active', 'restored') AND m.person_type IN ($aaPlaceholders)
                            AND m.id NOT IN (SELECT member_id FROM attendance WHERE service_id = ?)
                        ");
                        $missingStmt->execute([...$aaTypes, $serviceId]);
                        $missingMembers = $missingStmt->fetchAll(PDO::FETCH_COLUMN);
                        foreach ($missingMembers as $mId) {
                            try {
                                $db->prepare("INSERT INTO attendance (service_id, member_id, status, notes) VALUES (?, ?, 'absent', 'Auto-marked absent') ON DUPLICATE KEY UPDATE status = status")
                                    ->execute([$serviceId, $mId]);
                            } catch (Exception $e) {}
                        }
                    }
                }
            } catch (Exception $e) {}

            // Get attendance for a specific service
            $stmt = $db->prepare("
                SELECT a.*, m.first_name, m.last_name, m.email, m.phone, m.photo_url, m.status as member_status,
                       u.name as marked_by_name
                FROM attendance a
                JOIN members m ON a.member_id = m.id
                LEFT JOIN users u ON u.id = a.marked_by
                WHERE a.service_id = ?
                ORDER BY m.last_name ASC, m.first_name ASC
            ");
            $stmt->execute([$serviceId]);
            $attendance = $stmt->fetchAll();

            // Get service info
            $svcStmt = $db->prepare("SELECT * FROM services WHERE id = ?");
            $svcStmt->execute([$serviceId]);
            $service = $svcStmt->fetch();

            // Who recorded this service's attendance, and when. Records with no
            // marked_by came from the check-in kiosk (QR/PIN) or the auto-absent
            // sweep, so they are reported separately instead of being blamed on a user.
            $byStmt = $db->prepare("
                SELECT u.id as user_id, u.name, u.role, COUNT(*) as records, MAX(a.created_at) as last_at
                FROM attendance a
                JOIN users u ON u.id = a.marked_by
                WHERE a.service_id = ?
                GROUP BY u.id, u.name, u.role
                ORDER BY records DESC, u.name ASC
            ");
            $byStmt->execute([$serviceId]);
            $recordedBy = $byStmt->fetchAll();

            $selfStmt = $db->prepare("
                SELECT COUNT(*) FROM attendance
                WHERE service_id = ? AND marked_by IS NULL
                  AND check_in_time IS NOT NULL
                  AND (notes IS NULL OR notes <> 'Auto-marked absent')
            ");
            $selfStmt->execute([$serviceId]);
            $selfCheckins = (int)$selfStmt->fetchColumn();

            // Get all active members and non-member attendees for marking (those not yet marked)
            $unmarkedStmt = $db->prepare("
                SELECT m.id, m.first_name, m.last_name, m.email, m.phone, m.photo_url, m.status as member_status
                FROM members m
                WHERE m.status IN ('active', 'restored')
                AND m.id NOT IN (SELECT member_id FROM attendance WHERE service_id = ?)
                ORDER BY m.last_name ASC, m.first_name ASC
            ");
            $unmarkedStmt->execute([$serviceId]);
            $unmarked = $unmarkedStmt->fetchAll();

            jsonResponse([
                'service' => $service,
                'attendance' => $attendance,
                'unmarked_members' => $unmarked,
                'recorded_by' => $recordedBy,
                'self_checkins' => $selfCheckins,
                'summary' => [
                    'present' => count(array_filter($attendance, fn($a) => $a['status'] === 'present')),
                    'late' => count(array_filter($attendance, fn($a) => $a['status'] === 'late')),
                    'absent' => count(array_filter($attendance, fn($a) => $a['status'] === 'absent')),
                    'total_marked' => count($attendance),
                    'total_unmarked' => count($unmarked),
                ]
            ]);
        } elseif ($action === 'by_member' && $memberId) {
            // Get attendance history for a specific member
            $page = max(1, (int)($_GET['page'] ?? 1));
            $limit = min(100, max(10, (int)($_GET['limit'] ?? 50)));
            $offset = ($page - 1) * $limit;

            $stmt = $db->prepare("
                SELECT a.*, s.name as service_name, s.date as service_date, s.time as service_time, s.type as service_type
                FROM attendance a
                JOIN services s ON a.service_id = s.id
                WHERE a.member_id = ?
                ORDER BY s.date DESC, s.time DESC
                LIMIT $limit OFFSET $offset
            ");
            $stmt->execute([$memberId]);
            $records = $stmt->fetchAll();

            // Stats
            $statsStmt = $db->prepare("
                SELECT
                    COUNT(*) as total,
                    COUNT(CASE WHEN a.status = 'present' THEN 1 END) as present,
                    COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late,
                    COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent
                FROM attendance a
                JOIN services s ON a.service_id = s.id
                WHERE a.member_id = ?
            ");
            $statsStmt->execute([$memberId]);
            $stats = $statsStmt->fetch();

            jsonResponse([
                'records' => $records,
                'stats' => $stats,
                'page' => $page,
                'limit' => $limit,
            ]);
        } elseif ($action === 'history') {
            $from = $_GET['from'] ?? date('Y-m-01');
            $to = $_GET['to'] ?? date('Y-m-d');
            $groupBy = $_GET['group_by'] ?? 'service';

            if ($groupBy === 'week') {
                $stmt = $db->prepare("
                    SELECT
                        YEARWEEK(s.date, 1) as period_key,
                        MIN(s.date) as period_start,
                        MAX(s.date) as period_end,
                        COUNT(DISTINCT s.id) as service_count,
                        ROUND(AVG(sub.attended), 1) as avg_attended,
                        SUM(sub.attended) as total_attended,
                        SUM(sub.absent) as total_absent,
                        SUM(sub.total_marked) as total_marked
                    FROM services s
                    JOIN (
                        SELECT s2.id,
                            COUNT(CASE WHEN a.status = 'present' OR a.status = 'late' THEN 1 END) as attended,
                            COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent,
                            COUNT(a.id) as total_marked
                        FROM services s2
                        LEFT JOIN attendance a ON a.service_id = s2.id
                        WHERE s2.date BETWEEN ? AND ?
                        GROUP BY s2.id
                    ) sub ON sub.id = s.id
                    WHERE s.date BETWEEN ? AND ?
                    GROUP BY YEARWEEK(s.date, 1)
                    ORDER BY period_key DESC
                ");
                $stmt->execute([$from, $to, $from, $to]);
                $history = $stmt->fetchAll();
                jsonResponse(['history' => $history, 'group_by' => 'week']);

            } elseif ($groupBy === 'month') {
                $stmt = $db->prepare("
                    SELECT
                        DATE_FORMAT(s.date, '%Y-%m') as period_key,
                        MIN(s.date) as period_start,
                        MAX(s.date) as period_end,
                        COUNT(DISTINCT s.id) as service_count,
                        ROUND(AVG(sub.attended), 1) as avg_attended,
                        SUM(sub.attended) as total_attended,
                        SUM(sub.absent) as total_absent,
                        SUM(sub.total_marked) as total_marked
                    FROM services s
                    JOIN (
                        SELECT s2.id,
                            COUNT(CASE WHEN a.status = 'present' OR a.status = 'late' THEN 1 END) as attended,
                            COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent,
                            COUNT(a.id) as total_marked
                        FROM services s2
                        LEFT JOIN attendance a ON a.service_id = s2.id
                        WHERE s2.date BETWEEN ? AND ?
                        GROUP BY s2.id
                    ) sub ON sub.id = s.id
                    WHERE s.date BETWEEN ? AND ?
                    GROUP BY DATE_FORMAT(s.date, '%Y-%m')
                    ORDER BY period_key DESC
                ");
                $stmt->execute([$from, $to, $from, $to]);
                $history = $stmt->fetchAll();
                jsonResponse(['history' => $history, 'group_by' => 'month']);

            } else {
                $stmt = $db->prepare("
                    SELECT s.id, s.name, s.date, s.time, s.type, s.visitor_count,
                        COUNT(CASE WHEN a.status = 'present' OR a.status = 'late' THEN 1 END) as attended,
                        COUNT(CASE WHEN a.status = 'absent' THEN 1 END) as absent,
                        COUNT(a.id) as total_marked,
                        COUNT(CASE WHEN (a.status = 'present' OR a.status = 'late') AND m.person_type = 'non_member_attendee' THEN 1 END) as non_members_attended,
                        GROUP_CONCAT(DISTINCT u.name ORDER BY u.name SEPARATOR ', ') as recorded_by,
                        MAX(CASE WHEN a.marked_by IS NOT NULL THEN a.created_at END) as recorded_at
                    FROM services s
                    LEFT JOIN attendance a ON a.service_id = s.id
                    LEFT JOIN members m ON a.member_id = m.id
                    LEFT JOIN users u ON u.id = a.marked_by
                    WHERE s.date BETWEEN ? AND ?
                    GROUP BY s.id
                    ORDER BY s.date DESC, s.time DESC
                ");
                $stmt->execute([$from, $to]);
                $history = $stmt->fetchAll();
                jsonResponse(['history' => $history, 'group_by' => 'service']);
            }
        } else {
            jsonResponse(['error' => 'Invalid action. Use by_service, by_member, or history'], 400);
        }
        break;

    case 'POST':
        $data = getRequestBody();
        $action = $data['action'] ?? 'mark';
        $isAdmin = in_array($currentUser['role'], ['pastor', 'admin']);

        if ($action === 'bulk_mark') {
            if (!isset($data['service_id']) || !isset($data['records']) || !is_array($data['records'])) {
                jsonResponse(['error' => 'service_id and records array required'], 400);
            }

            $svcId = (int)$data['service_id'];

            $stmt = $db->prepare("SELECT id, date FROM services WHERE id = ?");
            $stmt->execute([$svcId]);
            $svc = $stmt->fetch();
            if (!$svc) {
                jsonResponse(['error' => 'Service not found'], 404);
            }

            if (!$isAdmin && isClosedPeriod($db, $svc['date'])) {
                $period = substr($svc['date'], 0, 7);
                $pendingId = createPendingChange($db, [
                    'entity_type' => 'attendance',
                    'action_type' => 'bulk_mark',
                    'change_data' => ['service_id' => $svcId, 'records' => $data['records']],
                    'description' => "Bulk mark attendance for service #$svcId (" . $svc['date'] . ")",
                    'period' => $period,
                    'requested_by' => $currentUser['user_id'],
                ]);
                jsonResponse(['message' => 'This period is closed. Your change has been submitted for approval.', 'pending_id' => $pendingId, 'pending' => true], 202);
            }

            $db->beginTransaction();
            try {
                $upsertStmt = $db->prepare("
                    INSERT INTO attendance (service_id, member_id, status, check_in_time, notes, marked_by)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE status = VALUES(status), check_in_time = VALUES(check_in_time), notes = VALUES(notes), marked_by = VALUES(marked_by)
                ");

                $count = 0;
                foreach ($data['records'] as $record) {
                    if (!isset($record['member_id']) || !isset($record['status'])) {
                        continue;
                    }
                    $checkInTime = ($record['status'] === 'present' || $record['status'] === 'late')
                        ? ($record['check_in_time'] ?? date('Y-m-d H:i:s'))
                        : null;
                    $upsertStmt->execute([
                        $svcId,
                        (int)$record['member_id'],
                        $record['status'],
                        $checkInTime,
                        $record['notes'] ?? null,
                        $currentUser['user_id'],
                    ]);
                    $count++;
                }

                $db->commit();
                jsonResponse(['message' => "$count attendance records saved", 'count' => $count]);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Failed to save attendance: ' . $e->getMessage()], 500);
            }
        } elseif ($action === 'mark') {
            $error = validateRequired($data, ['service_id', 'member_id', 'status']);
            if ($error) {
                jsonResponse(['error' => $error], 400);
            }

            $validStatuses = ['present', 'absent', 'late'];
            if (!in_array($data['status'], $validStatuses)) {
                jsonResponse(['error' => 'Invalid status'], 400);
            }

            $stmt = $db->prepare("SELECT id, date FROM services WHERE id = ?");
            $stmt->execute([(int)$data['service_id']]);
            $svc = $stmt->fetch();
            if ($svc && !$isAdmin && isClosedPeriod($db, $svc['date'])) {
                $period = substr($svc['date'], 0, 7);
                $pendingId = createPendingChange($db, [
                    'entity_type' => 'attendance',
                    'action_type' => 'mark',
                    'change_data' => $data,
                    'description' => "Mark attendance for member #{$data['member_id']} on service #" . $data['service_id'],
                    'period' => $period,
                    'requested_by' => $currentUser['user_id'],
                ]);
                jsonResponse(['message' => 'This period is closed. Your change has been submitted for approval.', 'pending_id' => $pendingId, 'pending' => true], 202);
            }

            $checkInTime = ($data['status'] === 'present' || $data['status'] === 'late')
                ? ($data['check_in_time'] ?? date('Y-m-d H:i:s'))
                : null;

            $stmt = $db->prepare("
                INSERT INTO attendance (service_id, member_id, status, check_in_time, notes, marked_by)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE status = VALUES(status), check_in_time = VALUES(check_in_time), notes = VALUES(notes), marked_by = VALUES(marked_by)
            ");
            $stmt->execute([
                (int)$data['service_id'],
                (int)$data['member_id'],
                $data['status'],
                $checkInTime,
                $data['notes'] ?? null,
                $currentUser['user_id'],
            ]);

            jsonResponse(['message' => 'Attendance marked successfully']);
        } else {
            jsonResponse(['error' => 'Invalid action'], 400);
        }
        break;

    case 'DELETE':
        $id = isset($_GET['id']) ? (int)$_GET['id'] : null;
        if (!$id) {
            jsonResponse(['error' => 'Attendance record ID required'], 400);
        }

        $stmt = $db->prepare("
            SELECT a.id, s.date FROM attendance a
            JOIN services s ON s.id = a.service_id
            WHERE a.id = ?
        ");
        $stmt->execute([$id]);
        $record = $stmt->fetch();
        if (!$record) {
            jsonResponse(['error' => 'Record not found'], 404);
        }

        $isAdmin = in_array($currentUser['role'], ['pastor', 'admin']);
        if (!$isAdmin && isClosedPeriod($db, $record['date'])) {
            $period = substr($record['date'], 0, 7);
            $pendingId = createPendingChange($db, [
                'entity_type' => 'attendance',
                'entity_id' => $id,
                'action_type' => 'delete',
                'change_data' => ['attendance_id' => $id],
                'description' => "Delete attendance record #$id",
                'period' => $period,
                'requested_by' => $currentUser['user_id'],
            ]);
            jsonResponse(['message' => 'This period is closed. Your change has been submitted for approval.', 'pending_id' => $pendingId, 'pending' => true], 202);
        }

        $stmt = $db->prepare("DELETE FROM attendance WHERE id = ?");
        $stmt->execute([$id]);

        jsonResponse(['message' => 'Attendance record deleted']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
