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

        $stmt = $db->prepare("INSERT INTO services (name, date, time, type, notes) VALUES (?, ?, ?, ?, ?)");
        $stmt->execute([
            trim($data['name']),
            $data['date'],
            $data['time'],
            $data['type'],
            $data['notes'] ?? null,
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

        $stmt = $db->prepare("SELECT id FROM services WHERE id = ?");
        $stmt->execute([$id]);
        if (!$stmt->fetch()) {
            jsonResponse(['error' => 'Service not found'], 404);
        }

        $data = getRequestBody();
        $fields = [];
        $params = [];
        $allowed = ['name', 'date', 'time', 'type', 'notes'];

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

        $stmt = $db->prepare("DELETE FROM services WHERE id = ?");
        $stmt->execute([$id]);

        if ($stmt->rowCount() === 0) {
            jsonResponse(['error' => 'Service not found'], 404);
        }

        jsonResponse(['message' => 'Service deleted successfully']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
