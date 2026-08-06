<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];

// Per-section access: "View" only can't add/edit/delete households.
if ($method === 'DELETE') {
    requireSectionEdit($currentUser, 'households', 'delete');
} elseif (in_array($method, ['POST', 'PUT'])) {
    requireSectionEdit($currentUser, 'households', 'add_edit');
}
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = getDB();

switch ($method) {
    case 'GET':
        if ($id) {
            $stmt = $db->prepare("SELECT * FROM households WHERE id = ?");
            $stmt->execute([$id]);
            $household = $stmt->fetch();
            if (!$household) jsonResponse(['error' => 'Household not found'], 404);

            $stmt = $db->prepare("
                SELECT id, first_name, last_name, email, phone, household_role, status, date_of_birth, gender
                FROM members WHERE household_id = ?
                ORDER BY FIELD(household_role, 'head', 'spouse', 'child', 'relative', 'other'), first_name
            ");
            $stmt->execute([$id]);
            $household['members'] = $stmt->fetchAll();

            jsonResponse(['household' => $household]);
        } else {
            $search = $_GET['search'] ?? '';
            $where = '';
            $params = [];
            if ($search) {
                $where = "WHERE h.name LIKE ?";
                $params[] = "%$search%";
            }

            $stmt = $db->prepare("
                SELECT h.*, COUNT(m.id) as member_count
                FROM households h
                LEFT JOIN members m ON m.household_id = h.id
                $where
                GROUP BY h.id
                ORDER BY h.name ASC
            ");
            $stmt->execute($params);
            $households = $stmt->fetchAll();

            jsonResponse(['households' => $households]);
        }
        break;

    case 'POST':
        requireRole($currentUser, ['pastor', 'admin', 'leader']);
        $data = getRequestBody();
        $error = validateRequired($data, ['name']);
        if ($error) jsonResponse(['error' => $error], 400);

        $stmt = $db->prepare("INSERT INTO households (name, address, city, state, zip, phone, notes) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            trim($data['name']),
            $data['address'] ?? null,
            $data['city'] ?? null,
            $data['state'] ?? null,
            $data['zip'] ?? null,
            $data['phone'] ?? null,
            $data['notes'] ?? null,
        ]);

        $newId = $db->lastInsertId();

        if (!empty($data['member_ids']) && is_array($data['member_ids'])) {
            foreach ($data['member_ids'] as $mid) {
                $role = $data['member_roles'][$mid] ?? 'other';
                $db->prepare("UPDATE members SET household_id = ?, household_role = ? WHERE id = ?")
                   ->execute([$newId, $role, (int)$mid]);
            }
        }

        $stmt = $db->prepare("SELECT * FROM households WHERE id = ?");
        $stmt->execute([$newId]);
        jsonResponse(['household' => $stmt->fetch(), 'message' => 'Household created'], 201);
        break;

    case 'PUT':
        requireRole($currentUser, ['pastor', 'admin', 'leader']);
        if (!$id) jsonResponse(['error' => 'Household ID required'], 400);

        $stmt = $db->prepare("SELECT id FROM households WHERE id = ?");
        $stmt->execute([$id]);
        if (!$stmt->fetch()) jsonResponse(['error' => 'Household not found'], 404);

        $data = getRequestBody();
        $fields = [];
        $params = [];
        $allowed = ['name', 'address', 'city', 'state', 'zip', 'phone', 'notes'];

        foreach ($allowed as $f) {
            if (array_key_exists($f, $data)) {
                $fields[] = "$f = ?";
                $params[] = $data[$f] === '' ? null : $data[$f];
            }
        }

        if (!empty($fields)) {
            $params[] = $id;
            $db->prepare("UPDATE households SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
        }

        if (isset($data['member_ids']) && is_array($data['member_ids'])) {
            $db->prepare("UPDATE members SET household_id = NULL, household_role = NULL WHERE household_id = ?")->execute([$id]);
            foreach ($data['member_ids'] as $mid) {
                $role = $data['member_roles'][$mid] ?? 'other';
                $db->prepare("UPDATE members SET household_id = ?, household_role = ? WHERE id = ?")
                   ->execute([$id, $role, (int)$mid]);
            }
        }

        $stmt = $db->prepare("SELECT * FROM households WHERE id = ?");
        $stmt->execute([$id]);
        jsonResponse(['household' => $stmt->fetch(), 'message' => 'Household updated']);
        break;

    case 'DELETE':
        requireRole($currentUser, ['pastor', 'admin']);
        if (!$id) jsonResponse(['error' => 'Household ID required'], 400);

        $db->prepare("UPDATE members SET household_id = NULL, household_role = NULL WHERE household_id = ?")->execute([$id]);
        $stmt = $db->prepare("DELETE FROM households WHERE id = ?");
        $stmt->execute([$id]);

        if ($stmt->rowCount() === 0) jsonResponse(['error' => 'Household not found'], 404);
        jsonResponse(['message' => 'Household deleted']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
