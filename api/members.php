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
            $person_type = $_GET['person_type'] ?? '';
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
                $where[] = "FIND_IN_SET(?, REPLACE(family_group, ', ', ',')) > 0";
                $params[] = $family_group;
            }
            if ($person_type) {
                $where[] = "person_type = ?";
                $params[] = $person_type;
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

            // Get groups for filter dropdown (from groups table)
            $groupStmt = $db->query("SELECT DISTINCT name FROM `groups` ORDER BY name");
            $familyGroups = $groupStmt->fetchAll(PDO::FETCH_COLUMN);

            // Get counts by person type
            $typeCounts = $db->query("
                SELECT person_type, COUNT(*) as count
                FROM members
                GROUP BY person_type
            ")->fetchAll();
            $typeCountMap = [];
            foreach ($typeCounts as $tc) {
                $typeCountMap[$tc['person_type'] ?: 'unknown'] = (int)$tc['count'];
            }

            jsonResponse([
                'members' => $members,
                'total' => (int)$total,
                'page' => $page,
                'limit' => $limit,
                'pages' => ceil($total / $limit),
                'family_groups' => $familyGroups,
                'type_counts' => $typeCountMap,
            ]);
        }
        break;

    case 'POST':
        // Auto-update statuses based on attendance
        if (isset($_GET['action']) && $_GET['action'] === 'auto_status') {
            $changes = [];

            // Mark active members as inactive after 3 months of absence
            $stmt = $db->query("
                SELECT m.id, m.first_name, m.last_name
                FROM members m
                WHERE m.status = 'active'
                AND m.id NOT IN (
                    SELECT DISTINCT a.member_id FROM attendance a
                    JOIN services s ON s.id = a.service_id
                    WHERE (a.status = 'present' OR a.status = 'late')
                    AND s.date >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
                )
                AND m.created_at < DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
            ");
            $toInactive = $stmt->fetchAll();
            if ($toInactive) {
                $ids = array_column($toInactive, 'id');
                $placeholders = implode(',', array_fill(0, count($ids), '?'));
                $db->prepare("UPDATE members SET status = 'inactive' WHERE id IN ($placeholders)")->execute($ids);
                foreach ($toInactive as $m) {
                    $changes[] = ['id' => $m['id'], 'name' => $m['first_name'].' '.$m['last_name'], 'from' => 'active', 'to' => 'inactive'];
                }
            }

            // Mark inactive members as forsaking after 6 months of absence
            $stmt = $db->query("
                SELECT m.id, m.first_name, m.last_name
                FROM members m
                WHERE m.status = 'inactive'
                AND m.id NOT IN (
                    SELECT DISTINCT a.member_id FROM attendance a
                    JOIN services s ON s.id = a.service_id
                    WHERE (a.status = 'present' OR a.status = 'late')
                    AND s.date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
                )
                AND m.created_at < DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            ");
            $toForsaking = $stmt->fetchAll();
            if ($toForsaking) {
                $ids = array_column($toForsaking, 'id');
                $placeholders = implode(',', array_fill(0, count($ids), '?'));
                $db->prepare("UPDATE members SET status = 'forsaking' WHERE id IN ($placeholders)")->execute($ids);
                foreach ($toForsaking as $m) {
                    $changes[] = ['id' => $m['id'], 'name' => $m['first_name'].' '.$m['last_name'], 'from' => 'inactive', 'to' => 'forsaking'];
                }
            }

            // Mark forsaking members as restored if they returned and attended for 3+ months
            $stmt = $db->query("
                SELECT m.id, m.first_name, m.last_name
                FROM members m
                WHERE m.status = 'forsaking'
                AND (
                    SELECT COUNT(DISTINCT DATE_FORMAT(s.date, '%Y-%m'))
                    FROM attendance a
                    JOIN services s ON s.id = a.service_id
                    WHERE a.member_id = m.id
                    AND (a.status = 'present' OR a.status = 'late')
                    AND s.date >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
                ) >= 3
            ");
            $toRestored = $stmt->fetchAll();
            if ($toRestored) {
                $ids = array_column($toRestored, 'id');
                $placeholders = implode(',', array_fill(0, count($ids), '?'));
                $db->prepare("UPDATE members SET status = 'restored' WHERE id IN ($placeholders)")->execute($ids);
                foreach ($toRestored as $m) {
                    $changes[] = ['id' => $m['id'], 'name' => $m['first_name'].' '.$m['last_name'], 'from' => 'forsaking', 'to' => 'restored'];
                }
            }

            jsonResponse([
                'message' => count($changes) . ' status changes applied',
                'changes' => $changes,
                'summary' => [
                    'to_inactive' => count($toInactive),
                    'to_forsaking' => count($toForsaking ?? []),
                    'to_restored' => count($toRestored),
                ],
            ]);
        }

        // Handle bulk import action
        if (isset($_GET['action']) && $_GET['action'] === 'import') {
            $data = getRequestBody();
            $contacts = $data['contacts'] ?? [];
            if (!is_array($contacts) || empty($contacts)) {
                jsonResponse(['error' => 'contacts array is required'], 400);
            }

            $imported = 0;
            $skipped = 0;
            $errors = [];

            // Get existing emails for duplicate detection
            $existingEmails = [];
            $emailStmt = $db->query("SELECT LOWER(email) FROM members WHERE email IS NOT NULL AND email != ''");
            while ($row = $emailStmt->fetchColumn()) {
                $existingEmails[$row] = true;
            }

            $insertStmt = $db->prepare("
                INSERT INTO members (first_name, last_name, email, phone, person_type, import_source, status)
                VALUES (?, ?, ?, ?, ?, ?, 'active')
            ");

            foreach ($contacts as $i => $contact) {
                if (empty($contact['first_name']) || empty($contact['last_name'])) {
                    $errors[] = "Row $i: first_name and last_name are required";
                    $skipped++;
                    continue;
                }

                $email = !empty($contact['email']) ? trim($contact['email']) : null;

                // Skip duplicates by email
                if ($email && isset($existingEmails[strtolower($email)])) {
                    $skipped++;
                    continue;
                }

                try {
                    $insertStmt->execute([
                        trim($contact['first_name']),
                        trim($contact['last_name']),
                        $email,
                        $contact['phone'] ?? null,
                        $contact['person_type'] ?? 'community',
                        $contact['import_source'] ?? null,
                    ]);
                    $imported++;
                    // Track newly inserted email to avoid duplicates within same batch
                    if ($email) {
                        $existingEmails[strtolower($email)] = true;
                    }
                } catch (Exception $e) {
                    $errors[] = "Row $i: " . $e->getMessage();
                    $skipped++;
                }
            }

            jsonResponse([
                'message' => "Import complete: $imported imported, $skipped skipped",
                'imported' => $imported,
                'skipped' => $skipped,
                'errors' => $errors,
            ]);
            break;
        }

        // Photo upload
        if (isset($_GET['action']) && $_GET['action'] === 'upload_photo') {
            $memberId = (int)($_GET['id'] ?? $_POST['member_id'] ?? 0);
            if (!$memberId) jsonResponse(['error' => 'member_id required'], 400);

            if (empty($_FILES['photo'])) jsonResponse(['error' => 'No photo uploaded'], 400);

            $file = $_FILES['photo'];
            $allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
            if (!in_array($file['type'], $allowed)) {
                jsonResponse(['error' => 'Only JPEG, PNG, WebP and GIF images allowed'], 400);
            }
            if ($file['size'] > 5 * 1024 * 1024) {
                jsonResponse(['error' => 'Photo must be under 5MB'], 400);
            }

            $photoDir = __DIR__ . '/../uploads/photos/';
            if (!is_dir($photoDir)) mkdir($photoDir, 0755, true);

            // Delete old photo if exists
            $stmt = $db->prepare("SELECT photo_url FROM members WHERE id = ?");
            $stmt->execute([$memberId]);
            $old = $stmt->fetch();
            if ($old && $old['photo_url']) {
                $oldFile = __DIR__ . '/..' . parse_url($old['photo_url'], PHP_URL_PATH);
                if (strpos($oldFile, '/uploads/photos/') !== false && file_exists($oldFile)) {
                    @unlink($oldFile);
                }
            }

            $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION)) ?: 'jpg';
            $safeName = 'member_' . $memberId . '_' . time() . '.' . $ext;
            $destPath = $photoDir . $safeName;

            if (!move_uploaded_file($file['tmp_name'], $destPath)) {
                jsonResponse(['error' => 'Failed to save photo'], 500);
            }

            $photoUrl = '/system/uploads/photos/' . $safeName;
            $db->prepare("UPDATE members SET photo_url = ? WHERE id = ?")->execute([$photoUrl, $memberId]);

            jsonResponse(['message' => 'Photo uploaded', 'photo_url' => $photoUrl]);
        }

        $data = getRequestBody();
        $error = validateRequired($data, ['first_name', 'last_name']);
        if ($error) {
            jsonResponse(['error' => $error], 400);
        }

        $stmt = $db->prepare("
            INSERT INTO members (first_name, last_name, email, phone, address, city, state, zip, gender, date_of_birth, family_group, household_id, household_role, membership_date, status, notes, photo_url, card_title, card_expiry_date, baptism_date, salvation_date, first_visit_date, membership_class_date, dedication_date, wedding_date, person_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            $data['card_title'] ?? null,
            $data['card_expiry_date'] ?? null,
            $data['baptism_date'] ?? null,
            $data['salvation_date'] ?? null,
            $data['first_visit_date'] ?? null,
            $data['membership_class_date'] ?? null,
            $data['dedication_date'] ?? null,
            $data['wedding_date'] ?? null,
            $data['person_type'] ?? 'church_member',
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
            'membership_date', 'status', 'notes', 'photo_url', 'card_title',
            'card_expiry_date', 'baptism_date', 'salvation_date', 'first_visit_date',
            'membership_class_date', 'dedication_date', 'wedding_date',
            'person_type'
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
