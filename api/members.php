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

            // Groups this person belongs to, with the department each one serves
            $stmt = $db->prepare("
                SELECT g.id, g.name, g.category, g.department_id, d.name AS department_name,
                       mg.function_title
                FROM member_groups mg
                JOIN `groups` g ON g.id = mg.group_id
                LEFT JOIN departments d ON d.id = g.department_id
                WHERE mg.member_id = ?
                ORDER BY g.sort_order ASC, g.name ASC
            ");
            $stmt->execute([$id]);
            $member['groups'] = $stmt->fetchAll();
            $member['group_ids'] = array_map('intval', array_column($member['groups'], 'id'));

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

            if ($search !== '') {
                // Split the query into words and require EACH word to appear
                // somewhere in the person's name / email / phone. This lets a
                // full-name search like "Marc Bien" match a first name of
                // "Marc Hubert" and a last name of "Bien Aime" (previously the
                // words were matched per-column, so any cross-field full name
                // returned nothing). Phone digits are also matched with spaces
                // and punctuation stripped so "215 478" finds "2154785996".
                $haystack = "CONCAT_WS(' ', first_name, last_name, email, phone)";
                $phoneDigits = "REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '')";
                $tokens = preg_split('/\s+/', trim($search));
                foreach ($tokens as $token) {
                    if ($token === '') continue;
                    $digits = preg_replace('/[^0-9]/', '', $token);
                    if ($digits !== '') {
                        // Token has digits: match the name haystack OR the
                        // digit-only phone (so "215-478" finds "2154785996").
                        $where[] = "($haystack LIKE ? OR $phoneDigits LIKE ?)";
                        $params[] = '%' . $token . '%';
                        $params[] = '%' . $digits . '%';
                    } else {
                        $where[] = "$haystack LIKE ?";
                        $params[] = '%' . $token . '%';
                    }
                }
            }
            if ($status) {
                $where[] = "status = ?";
                $params[] = $status;
            }
            // Filter by group. Prefer the real join table; accept either a group
            // id (?group_id=) or a name (?family_group=, kept for older callers).
            $groupId = isset($_GET['group_id']) ? (int)$_GET['group_id'] : 0;
            if (!$groupId && $family_group) {
                $g = $db->prepare("SELECT id FROM `groups` WHERE name = ?");
                $g->execute([$family_group]);
                $groupId = (int)$g->fetchColumn();
            }
            if ($groupId) {
                $where[] = "id IN (SELECT member_id FROM member_groups WHERE group_id = ?)";
                $params[] = $groupId;
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

            // Groups for the filter dropdown and the group picker on the form
            $groupRows = $db->query("
                SELECT g.id, g.name, g.category, g.department_id, d.name AS department_name
                FROM `groups` g
                LEFT JOIN departments d ON d.id = g.department_id
                WHERE g.is_active = 1
                ORDER BY g.sort_order ASC, g.name ASC
            ")->fetchAll();
            $familyGroups = array_column($groupRows, 'name');

            // Attach each member's group ids so the form can pre-tick the boxes
            if ($members) {
                $ids = array_column($members, 'id');
                $in  = implode(',', array_fill(0, count($ids), '?'));
                $mg  = $db->prepare("SELECT member_id, group_id FROM member_groups WHERE member_id IN ($in)");
                $mg->execute($ids);
                $map = [];
                foreach ($mg->fetchAll() as $row) {
                    $map[(int)$row['member_id']][] = (int)$row['group_id'];
                }
                foreach ($members as &$m) {
                    $m['group_ids'] = $map[(int)$m['id']] ?? [];
                }
                unset($m);
            }

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
                'groups' => $groupRows,
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

        // Duplicate guard: if someone with the same name or the same phone number
        // already exists, stop and warn the user (409) so they can decide. Sending
        // force=1 (the "Register anyway" button) skips this and inserts.
        if (empty($data['force'])) {
            $fn = trim($data['first_name']);
            $ln = trim($data['last_name']);
            $phoneDigits = preg_replace('/\D+/', '', (string)($data['phone'] ?? ''));
            $matches = [];

            // Same full name (case-insensitive, trimmed)
            $nameStmt = $db->prepare("
                SELECT id, first_name, last_name, phone, email, person_type, status
                FROM members
                WHERE LOWER(TRIM(first_name)) = LOWER(?) AND LOWER(TRIM(last_name)) = LOWER(?)
            ");
            $nameStmt->execute([$fn, $ln]);
            foreach ($nameStmt->fetchAll() as $r) {
                $r['match'] = 'name';
                $matches[$r['id']] = $r;
            }

            // Same phone number (compare digits only; ignore very short numbers)
            if (strlen($phoneDigits) >= 7) {
                $phoneStmt = $db->query("
                    SELECT id, first_name, last_name, phone, email, person_type, status
                    FROM members
                    WHERE phone IS NOT NULL AND phone <> ''
                ");
                foreach ($phoneStmt->fetchAll() as $r) {
                    if (preg_replace('/\D+/', '', (string)$r['phone']) === $phoneDigits) {
                        if (isset($matches[$r['id']])) {
                            $matches[$r['id']]['match'] = 'name+phone';
                        } else {
                            $r['match'] = 'phone';
                            $matches[$r['id']] = $r;
                        }
                    }
                }
            }

            if (!empty($matches)) {
                jsonResponse([
                    'error' => 'A person with the same name or phone number already exists.',
                    'duplicate' => true,
                    'matches' => array_values($matches),
                ], 409);
            }
        }

        // Blank date/select boxes arrive as empty strings; store them as NULL so a
        // cleared birthday really is cleared instead of becoming 0000-00-00.
        foreach ([
            'date_of_birth', 'membership_date', 'card_expiry_date', 'baptism_date',
            'salvation_date', 'first_visit_date', 'membership_class_date',
            'dedication_date', 'wedding_date', 'gender', 'household_role',
        ] as $nullable) {
            if (isset($data[$nullable]) && $data[$nullable] === '') {
                $data[$nullable] = null;
            }
        }

        $stmt = $db->prepare("
            INSERT INTO members (first_name, last_name, email, phone, address, city, state, zip, gender, date_of_birth, family_group, household_id, household_role, membership_date, status, notes, photo_url, card_title, function_title, card_expiry_date, baptism_date, salvation_date, first_visit_date, membership_class_date, dedication_date, wedding_date, person_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            (isset($data['function_title']) && $data['function_title'] !== '') ? $data['function_title'] : null,
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

        // Consent isn't part of the INSERT column list, so stamp it here -
        // otherwise ticking the box on a brand-new person would be dropped.
        if (!empty($data['sms_consent'])) {
            $db->prepare("
                UPDATE members
                SET sms_consent = 1,
                    sms_consent_at = NOW(),
                    sms_consent_source = ?,
                    sms_consent_proof = ?,
                    sms_consent_by = ?
                WHERE id = ?
            ")->execute([
                $data['sms_consent_source'] ?? 'paper_form',
                $data['sms_consent_proof'] ?? null,
                $currentUser['user_id'],
                $newId,
            ]);
        }

        if (array_key_exists('group_ids', $data) && is_array($data['group_ids'])) {
            $titles = (isset($data['group_titles']) && is_array($data['group_titles'])) ? $data['group_titles'] : null;
            syncMemberGroups($db, (int)$newId, $data['group_ids'], $titles);
        }

        $stmt = $db->prepare("SELECT * FROM members WHERE id = ?");
        $stmt->execute([$newId]);
        $member = $stmt->fetch();
        $member['group_ids'] = memberGroupIds($db, (int)$newId);

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

        // SMS consent is not a plain field: turning it ON has to stamp WHEN it
        // was given, HOW, and WHO recorded it, because that record is the proof
        // the carriers can demand. Turning it off records the opt-out instead.
        if (array_key_exists('sms_consent', $data)) {
            $wants = !empty($data['sms_consent']) ? 1 : 0;
            $had = (int)$db->query("SELECT sms_consent FROM members WHERE id = " . (int)$id)->fetchColumn();

            if ($wants === 1 && $had === 0) {
                $stmt = $db->prepare("
                    UPDATE members
                    SET sms_consent = 1,
                        sms_consent_at = NOW(),
                        sms_consent_source = ?,
                        sms_consent_proof = ?,
                        sms_consent_by = ?,
                        sms_opted_out_at = NULL
                    WHERE id = ?
                ");
                $stmt->execute([
                    $data['sms_consent_source'] ?? 'paper_form',
                    $data['sms_consent_proof'] ?? null,
                    $currentUser['user_id'],
                    $id,
                ]);
            } elseif ($wants === 0 && $had === 1) {
                $db->prepare("
                    UPDATE members
                    SET sms_consent = 0, sms_opted_out_at = NOW()
                    WHERE id = ?
                ")->execute([$id]);
            }
            unset($data['sms_consent'], $data['sms_consent_source'], $data['sms_consent_proof']);
            $consentTouched = true;
        }

        $consentTouched = $consentTouched ?? false;
        $fields = [];
        $params = [];
        $allowedFields = [
            'first_name', 'last_name', 'email', 'phone', 'address', 'city',
            'state', 'zip', 'gender', 'date_of_birth', 'family_group',
            'household_id', 'household_role',
            'membership_date', 'status', 'notes', 'photo_url', 'card_title', 'function_title',
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

        $hasGroups = array_key_exists('group_ids', $data) && is_array($data['group_ids']);

        if (empty($fields) && !$hasGroups && !$consentTouched) {
            jsonResponse(['error' => 'No fields to update'], 400);
        }

        if ($fields) {
            $params[] = $id;
            $sql = "UPDATE members SET " . implode(', ', $fields) . " WHERE id = ?";
            $stmt = $db->prepare($sql);
            $stmt->execute($params);
        }

        // Runs after the UPDATE so it also refreshes the family_group cache and
        // the derived headline title from the per-group roles.
        if ($hasGroups) {
            $titles = (isset($data['group_titles']) && is_array($data['group_titles'])) ? $data['group_titles'] : null;
            syncMemberGroups($db, (int)$id, $data['group_ids'], $titles);
        }

        $stmt = $db->prepare("SELECT * FROM members WHERE id = ?");
        $stmt->execute([$id]);
        $member = $stmt->fetch();
        $member['group_ids'] = memberGroupIds($db, (int)$id);

        jsonResponse(['member' => $member, 'message' => 'Member updated successfully']);
        break;

    case 'DELETE':
        requireRole($currentUser, ['pastor', 'admin']);

        // Accept a single ?id= or a comma-separated ?ids=1,2,3 for bulk delete.
        $ids = [];
        if (!empty($_GET['ids'])) {
            foreach (explode(',', $_GET['ids']) as $part) {
                $n = (int)trim($part);
                if ($n > 0) $ids[] = $n;
            }
        } elseif ($id) {
            $ids[] = $id;
        }
        $ids = array_values(array_unique($ids));

        if (!$ids) {
            jsonResponse(['error' => 'Member ID required'], 400);
        }

        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $db->prepare("DELETE FROM members WHERE id IN ($placeholders)");
        $stmt->execute($ids);

        if ($stmt->rowCount() === 0) {
            jsonResponse(['error' => 'Member not found'], 404);
        }

        $n = $stmt->rowCount();
        jsonResponse([
            'message' => $n . ' ' . ($n === 1 ? 'person' : 'people') . ' deleted successfully',
            'deleted' => $n,
        ]);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
