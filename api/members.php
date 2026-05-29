<?php
/**
 * Hallelujah In The City - Church Management System
 * Members API - CRUD for church members
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
            // Get single member with attendance stats
            $stmt = $db->prepare("SELECT * FROM members WHERE id = ?");
            $stmt->execute([$id]);
            $member = $stmt->fetch();
            if (!$member) {
                jsonResponse(['error' => 'Member not found'], 404);
            }

            // Get recent attendance
            $stmt = $db->prepare("
                SELECT a.*, s.name as service_name, s.date as service_date, s.type as service_type
                FROM attendance a
                JOIN services s ON a.service_id = s.id
                WHERE a.member_id = ?
                ORDER BY s.date DESC
                LIMIT 20
            ");
            $stmt->execute([$id]);
            $member['recent_attendance'] = $stmt->fetchAll();

            // Attendance rate (last 3 months)
            $stmt = $db->prepare("
                SELECT
                    COUNT(CASE WHEN a.status = 'present' OR a.status = 'late' THEN 1 END) as attended,
                    COUNT(*) as total
                FROM attendance a
                JOIN services s ON a.service_id = s.id
                WHERE a.member_id = ? AND s.date >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
            ");
            $stmt->execute([$id]);
            $stats = $stmt->fetch();
            $member['attendance_rate'] = $stats['total'] > 0
                ? round(($stats['attended'] / $stats['total']) * 100, 1)
                : 0;

            // Get household info if member belongs to one
            if ($member['household_id']) {
                $stmt = $db->prepare("SELECT * FROM households WHERE id = ?");
                $stmt->execute([$member['household_id']]);
                $member['household'] = $stmt->fetch();

                $stmt = $db->prepare("
                    SELECT id, first_name, last_name, household_role, status
                    FROM members WHERE household_id = ? AND id != ?
                    ORDER BY FIELD(household_role, 'head', 'spouse', 'child', 'relative', 'other')
                ");
                $stmt->execute([$member['household_id'], $id]);
                $member['household_members'] = $stmt->fetchAll();
            }

            jsonResponse(['member' => $member]);
        } else {
            // List members with search/filter
            $search = $_GET['search'] ?? '';
            $status = $_GET['status'] ?? '';
            $family_group = $_GET['family_group'] ?? '';
            $page = max(1, (int)($_GET['page'] ?? 1));
            $limit = min(100, max(10, (int)($_GET['limit'] ?? 50)));
            $offset = ($page - 1) * $limit;

            $where = [];
            $params = [];

            if ($search) {
                $where[] = "(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ?)";
                $searchTerm = "%$search%";
                $params = array_merge($params, [$searchTerm, $searchTerm, $searchTerm, $searchTerm]);
            }
            if ($status) {
                $where[] = "status = ?";
                $params[] = $status;
            }
            if ($family_group) {
                $where[] = "family_group = ?";
                $params[] = $family_group;
            }

            $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

            // Count total
            $countStmt = $db->prepare("SELECT COUNT(*) as total FROM members $whereClause");
            $countStmt->execute($params);
            $total = $countStmt->fetch()['total'];

            // Sort
            $sort = $_GET['sort'] ?? 'last_name';
            $orderBy = match($sort) {
                'first_name' => 'first_name ASC, last_name ASC',
                'newest' => 'created_at DESC',
                default => 'last_name ASC, first_name ASC',
            };

            // Fetch members
            $sql = "SELECT * FROM members $whereClause ORDER BY $orderBy LIMIT $limit OFFSET $offset";
            $stmt = $db->prepare($sql);
            $stmt->execute($params);
            $members = $stmt->fetchAll();

            // Get family groups for filter dropdown
            $groupStmt = $db->query("SELECT DISTINCT family_group FROM members WHERE family_group IS NOT NULL AND family_group != '' ORDER BY family_group");
            $familyGroups = $groupStmt->fetchAll(PDO::FETCH_COLUMN);

            jsonResponse([
                'members' => $members,
                'total' => (int)$total,
                'page' => $page,
                'limit' => $limit,
                'pages' => ceil($total / $limit),
                'family_groups' => $familyGroups
            ]);
        }
        break;

    case 'POST':
        $data = getRequestBody();
        $error = validateRequired($data, ['first_name', 'last_name']);
        if ($error) {
            jsonResponse(['error' => $error], 400);
        }

        $stmt = $db->prepare("
            INSERT INTO members (first_name, last_name, email, phone, address, city, state, zip, gender, date_of_birth, family_group, household_id, household_role, membership_date, status, notes, photo_url, baptism_date, salvation_date, first_visit_date, membership_class_date, dedication_date, wedding_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([
            trim($data['first_name']),
            trim($data['last_name']),
            $data['email'] ?? null,
            $data['phone'] ?? null,
            $data['address'] ?? null,
            $data['city'] ?? null,
            $data['state'] ?? null,
            $data['zip'] ?? null,
            $data['gender'] ?? null,
            $data['date_of_birth'] ?? null,
            $data['family_group'] ?? null,
            $data['household_id'] ? (int)$data['household_id'] : null,
            $data['household_role'] ?? null,
            $data['membership_date'] ?? null,
            $data['status'] ?? 'active',
            $data['notes'] ?? null,
            $data['photo_url'] ?? null,
            $data['baptism_date'] ?? null,
            $data['salvation_date'] ?? null,
            $data['first_visit_date'] ?? null,
            $data['membership_class_date'] ?? null,
            $data['dedication_date'] ?? null,
            $data['wedding_date'] ?? null,
        ]);

        $newId = $db->lastInsertId();
        $stmt = $db->prepare("SELECT * FROM members WHERE id = ?");
        $stmt->execute([$newId]);
        $member = $stmt->fetch();

        jsonResponse(['member' => $member, 'message' => 'Member added successfully'], 201);
        break;

    case 'PUT':
        if (!$id) {
            jsonResponse(['error' => 'Member ID required'], 400);
        }

        // Check member exists
        $stmt = $db->prepare("SELECT id FROM members WHERE id = ?");
        $stmt->execute([$id]);
        if (!$stmt->fetch()) {
            jsonResponse(['error' => 'Member not found'], 404);
        }

        $data = getRequestBody();

        $fields = [];
        $params = [];
        $allowedFields = [
            'first_name', 'last_name', 'email', 'phone', 'address', 'city',
            'state', 'zip', 'gender', 'date_of_birth', 'family_group',
            'household_id', 'household_role',
            'membership_date', 'status', 'notes', 'photo_url',
            'baptism_date', 'salvation_date', 'first_visit_date',
            'membership_class_date', 'dedication_date', 'wedding_date'
        ];

        foreach ($allowedFields as $field) {
            if (array_key_exists($field, $data)) {
                $fields[] = "$field = ?";
                $value = $data[$field];
                // Convert empty strings to null for nullable fields
                if ($value === '' && !in_array($field, ['first_name', 'last_name', 'status'])) {
                    $value = null;
                }
                $params[] = $value;
            }
        }

        if (empty($fields)) {
            jsonResponse(['error' => 'No fields to update'], 400);
        }

        $params[] = $id;
        $sql = "UPDATE members SET " . implode(', ', $fields) . " WHERE id = ?";
        $stmt = $db->prepare($sql);
        $stmt->execute($params);

        $stmt = $db->prepare("SELECT * FROM members WHERE id = ?");
        $stmt->execute([$id]);
        $member = $stmt->fetch();

        jsonResponse(['member' => $member, 'message' => 'Member updated successfully']);
        break;

    case 'DELETE':
        requireRole($currentUser, ['pastor', 'admin']);
        if (!$id) {
            jsonResponse(['error' => 'Member ID required'], 400);
        }

        $stmt = $db->prepare("DELETE FROM members WHERE id = ?");
        $stmt->execute([$id]);

        if ($stmt->rowCount() === 0) {
            jsonResponse(['error' => 'Member not found'], 404);
        }

        jsonResponse(['message' => 'Member deleted successfully']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
