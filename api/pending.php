<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

switch ($method) {
    case 'GET':
        $status = $_GET['status'] ?? '';
        $where = [];
        $params = [];

        if ($status) {
            $where[] = "pc.status = ?";
            $params[] = $status;
        }

        $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $stmt = $db->prepare("
            SELECT pc.*,
                   u1.name as requested_by_name,
                   u2.name as reviewed_by_name
            FROM pending_changes pc
            LEFT JOIN users u1 ON u1.id = pc.requested_by
            LEFT JOIN users u2 ON u2.id = pc.reviewed_by
            $whereClause
            ORDER BY pc.requested_at DESC
        ");
        $stmt->execute($params);
        $changes = $stmt->fetchAll();

        foreach ($changes as &$change) {
            if (is_string($change['change_data'])) {
                $change['change_data'] = json_decode($change['change_data'], true);
            }
        }

        $pendingCount = 0;
        $countStmt = $db->query("SELECT COUNT(*) as cnt FROM pending_changes WHERE status = 'pending'");
        $pendingCount = $countStmt->fetch()['cnt'];

        jsonResponse(['changes' => $changes, 'pending_count' => (int)$pendingCount]);
        break;

    case 'PUT':
        requireRole($currentUser, ['pastor', 'admin']);
        $data = getRequestBody();
        $id = isset($_GET['id']) ? (int)$_GET['id'] : null;
        if (!$id) jsonResponse(['error' => 'Change ID required'], 400);

        $action = $data['action'] ?? '';
        if (!in_array($action, ['approve', 'reject'])) {
            jsonResponse(['error' => 'Action must be approve or reject'], 400);
        }

        $stmt = $db->prepare("SELECT * FROM pending_changes WHERE id = ? AND status = 'pending'");
        $stmt->execute([$id]);
        $change = $stmt->fetch();
        if (!$change) {
            jsonResponse(['error' => 'Pending change not found or already processed'], 404);
        }

        $changeData = is_string($change['change_data']) ? json_decode($change['change_data'], true) : $change['change_data'];

        $db->beginTransaction();
        try {
            if ($action === 'approve') {
                // Apply the change
                $entityType = $change['entity_type'];
                $actionType = $change['action_type'];
                $entityId = $change['entity_id'];

                if ($entityType === 'service') {
                    if ($actionType === 'update' && $entityId) {
                        $fields = [];
                        $params = [];
                        $allowed = ['name', 'date', 'time', 'type', 'notes', 'visitor_count', 'head_count'];
                        foreach ($allowed as $field) {
                            if (array_key_exists($field, $changeData)) {
                                $fields[] = "$field = ?";
                                $params[] = $changeData[$field];
                            }
                        }
                        if ($fields) {
                            $params[] = $entityId;
                            $sql = "UPDATE services SET " . implode(', ', $fields) . " WHERE id = ?";
                            $db->prepare($sql)->execute($params);
                        }
                    } elseif ($actionType === 'delete' && $entityId) {
                        $db->prepare("DELETE FROM services WHERE id = ?")->execute([$entityId]);
                    } elseif ($actionType === 'create') {
                        $db->prepare("INSERT INTO services (name, date, time, type, notes, visitor_count, head_count) VALUES (?, ?, ?, ?, ?, ?, ?)")
                            ->execute([
                                $changeData['name'] ?? '',
                                $changeData['date'] ?? '',
                                $changeData['time'] ?? '',
                                $changeData['type'] ?? '',
                                $changeData['notes'] ?? null,
                                (int)($changeData['visitor_count'] ?? 0),
                                (int)($changeData['head_count'] ?? 0),
                            ]);
                    }
                } elseif ($entityType === 'attendance') {
                    if ($actionType === 'mark' || $actionType === 'bulk_mark') {
                        if (isset($changeData['records'])) {
                            $upsertStmt = $db->prepare("
                                INSERT INTO attendance (service_id, member_id, status, check_in_time, notes)
                                VALUES (?, ?, ?, ?, ?)
                                ON DUPLICATE KEY UPDATE status = VALUES(status), check_in_time = VALUES(check_in_time), notes = VALUES(notes)
                            ");
                            foreach ($changeData['records'] as $record) {
                                $checkInTime = ($record['status'] === 'present' || $record['status'] === 'late')
                                    ? ($record['check_in_time'] ?? date('Y-m-d H:i:s'))
                                    : null;
                                $upsertStmt->execute([
                                    (int)$changeData['service_id'],
                                    (int)$record['member_id'],
                                    $record['status'],
                                    $checkInTime,
                                    $record['notes'] ?? null,
                                ]);
                            }
                        } elseif (isset($changeData['service_id'])) {
                            $checkInTime = ($changeData['status'] === 'present' || $changeData['status'] === 'late')
                                ? ($changeData['check_in_time'] ?? date('Y-m-d H:i:s'))
                                : null;
                            $db->prepare("
                                INSERT INTO attendance (service_id, member_id, status, check_in_time, notes)
                                VALUES (?, ?, ?, ?, ?)
                                ON DUPLICATE KEY UPDATE status = VALUES(status), check_in_time = VALUES(check_in_time), notes = VALUES(notes)
                            ")->execute([
                                (int)$changeData['service_id'],
                                (int)$changeData['member_id'],
                                $changeData['status'],
                                $checkInTime,
                                $changeData['notes'] ?? null,
                            ]);
                        }
                    } elseif ($actionType === 'delete' && $entityId) {
                        $db->prepare("DELETE FROM attendance WHERE id = ?")->execute([$entityId]);
                    }
                }
            }

            // Update the pending change status
            $stmt = $db->prepare("UPDATE pending_changes SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_notes = ? WHERE id = ?");
            $newStatus = $action === 'approve' ? 'approved' : 'rejected';
            $stmt->execute([$newStatus, $currentUser['user_id'], $data['notes'] ?? null, $id]);

            $db->commit();
            jsonResponse(['message' => "Change $newStatus successfully"]);
        } catch (Exception $e) {
            $db->rollBack();
            jsonResponse(['error' => 'Failed to process change: ' . $e->getMessage()], 500);
        }
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
