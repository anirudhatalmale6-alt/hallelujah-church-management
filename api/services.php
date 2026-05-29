<?php
/**
 * Hallelujah In The City - Church Management System
 * Services API - CRUD for church services
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = getDB();

switch ($method) {
    case 'GET':
        if ($id) {
            // Get single service with attendance count
            $stmt = $db->prepare("
                SELECT s.*,
                    (SELECT COUNT(*) FROM attendance a WHERE a.service_id = s.id AND (a.status = 'present' OR a.status = 'late')) as attended_count,
                    (SELECT COUNT(*) FROM attendance a WHERE a.service_id = s.id) as total_marked
                FROM services s
                WHERE s.id = ?
            ");
            $stmt->execute([$id]);
            $service = $stmt->fetch();
            if (!$service) {
                jsonResponse(['error' => 'Service not found'], 404);
            }
            jsonResponse(['service' => $service]);
        } else {
            // List services with filters
            $type = $_GET['type'] ?? '';
            $from = $_GET['from'] ?? '';
            $to = $_GET['to'] ?? '';
            $page = max(1, (int)($_GET['page'] ?? 1));
            $limit = min(100, max(10, (int)($_GET['limit'] ?? 50)));
            $offset = ($page - 1) * $limit;

            $where = [];
            $params = [];

            if ($type) {
                $where[] = "s.type = ?";
                $params[] = $type;
            }
            if ($from) {
                $where[] = "s.date >= ?";
                $params[] = $from;
            }
            if ($to) {
                $where[] = "s.date <= ?";
                $params[] = $to;
            }

            $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

            // Count
            $countStmt = $db->prepare("SELECT COUNT(*) as total FROM services s $whereClause");
            $countStmt->execute($params);
            $total = $countStmt->fetch()['total'];

            // Fetch with attendance counts
            $sql = "
                SELECT s.*,
                    (SELECT COUNT(*) FROM attendance a WHERE a.service_id = s.id AND (a.status = 'present' OR a.status = 'late')) as attended_count,
                    (SELECT COUNT(*) FROM attendance a WHERE a.service_id = s.id) as total_marked
                FROM services s
                $whereClause
                ORDER BY s.date DESC, s.time DESC
                LIMIT $limit OFFSET $offset
            ";
            $stmt = $db->prepare($sql);
            $stmt->execute($params);
            $services = $stmt->fetchAll();

            $typesStmt = $db->query("SELECT DISTINCT type FROM services WHERE type IS NOT NULL AND type != '' ORDER BY type");
            $distinctTypes = $typesStmt->fetchAll(PDO::FETCH_COLUMN);

            jsonResponse([
                'services' => $services,
                'total' => (int)$total,
                'page' => $page,
                'limit' => $limit,
                'pages' => ceil($total / $limit),
                'distinct_types' => $distinctTypes,
            ]);
        }
        break;

    case 'POST':
        requireRole($currentUser, ['pastor', 'admin', 'leader']);
        $data = getRequestBody();
        $error = validateRequired($data, ['name', 'date', 'time', 'type']);
        if ($error) {
            jsonResponse(['error' => $error], 400);
        }

        if (empty(trim($data['type']))) {
            jsonResponse(['error' => 'Service type is required'], 400);
        }

        $isAdmin = in_array($currentUser['role'], ['pastor', 'admin']);
        if (!$isAdmin && isClosedPeriod($db, $data['date'])) {
            $period = substr($data['date'], 0, 7);
            $id = createPendingChange($db, [
                'entity_type' => 'service',
                'action_type' => 'create',
                'change_data' => $data,
                'description' => "Create service: " . trim($data['name']) . " on " . $data['date'],
                'period' => $period,
                'requested_by' => $currentUser['user_id'],
            ]);
            jsonResponse(['message' => 'This period is closed. Your change has been submitted for approval.', 'pending_id' => $id, 'pending' => true], 202);
        }

        $stmt = $db->prepare("INSERT INTO services (name, date, time, type, notes, visitor_count, head_count) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            trim($data['name']),
            $data['date'],
            $data['time'],
            $data['type'],
            $data['notes'] ?? null,
            (int)($data['visitor_count'] ?? 0),
            (int)($data['head_count'] ?? 0),
        ]);

        $newId = $db->lastInsertId();
        $stmt = $db->prepare("SELECT * FROM services WHERE id = ?");
        $stmt->execute([$newId]);
        $service = $stmt->fetch();

        jsonResponse(['service' => $service, 'message' => 'Service created successfully'], 201);
        break;

    case 'PUT':
        requireRole($currentUser, ['pastor', 'admin', 'leader']);
        if (!$id) {
            jsonResponse(['error' => 'Service ID required'], 400);
        }

        $stmt = $db->prepare("SELECT * FROM services WHERE id = ?");
        $stmt->execute([$id]);
        $existingService = $stmt->fetch();
        if (!$existingService) {
            jsonResponse(['error' => 'Service not found'], 404);
        }

        $data = getRequestBody();

        $isAdmin = in_array($currentUser['role'], ['pastor', 'admin']);
        if (!$isAdmin && isClosedPeriod($db, $existingService['date'])) {
            $period = substr($existingService['date'], 0, 7);
            $pendingId = createPendingChange($db, [
                'entity_type' => 'service',
                'entity_id' => $id,
                'action_type' => 'update',
                'change_data' => $data,
                'description' => "Update service: " . $existingService['name'] . " (" . $existingService['date'] . ")",
                'period' => $period,
                'requested_by' => $currentUser['user_id'],
            ]);
            jsonResponse(['message' => 'This period is closed. Your change has been submitted for approval.', 'pending_id' => $pendingId, 'pending' => true], 202);
        }

        $fields = [];
        $params = [];
        $allowed = ['name', 'date', 'time', 'type', 'notes', 'visitor_count', 'head_count'];

        foreach ($allowed as $field) {
            if (array_key_exists($field, $data)) {
                $fields[] = "$field = ?";
                $params[] = $data[$field];
            }
        }

        if (empty($fields)) {
            jsonResponse(['error' => 'No fields to update'], 400);
        }

        $params[] = $id;
        $sql = "UPDATE services SET " . implode(', ', $fields) . " WHERE id = ?";
        $stmt = $db->prepare($sql);
        $stmt->execute($params);

        $stmt = $db->prepare("SELECT * FROM services WHERE id = ?");
        $stmt->execute([$id]);
        $service = $stmt->fetch();

        jsonResponse(['service' => $service, 'message' => 'Service updated successfully']);
        break;

    case 'DELETE':
        requireRole($currentUser, ['pastor', 'admin']);
        if (!$id) {
            jsonResponse(['error' => 'Service ID required'], 400);
        }

        $stmt = $db->prepare("SELECT * FROM services WHERE id = ?");
        $stmt->execute([$id]);
        $existingService = $stmt->fetch();
        if (!$existingService) {
            jsonResponse(['error' => 'Service not found'], 404);
        }

        $isAdmin = in_array($currentUser['role'], ['pastor', 'admin']);
        if (!$isAdmin && isClosedPeriod($db, $existingService['date'])) {
            $period = substr($existingService['date'], 0, 7);
            $pendingId = createPendingChange($db, [
                'entity_type' => 'service',
                'entity_id' => $id,
                'action_type' => 'delete',
                'change_data' => ['name' => $existingService['name'], 'date' => $existingService['date']],
                'description' => "Delete service: " . $existingService['name'] . " (" . $existingService['date'] . ")",
                'period' => $period,
                'requested_by' => $currentUser['user_id'],
            ]);
            jsonResponse(['message' => 'This period is closed. Your change has been submitted for approval.', 'pending_id' => $pendingId, 'pending' => true], 202);
        }

        $stmt = $db->prepare("DELETE FROM services WHERE id = ?");
        $stmt->execute([$id]);

        jsonResponse(['message' => 'Service deleted successfully']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
