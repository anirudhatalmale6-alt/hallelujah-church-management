<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = getDB();

$CATEGORIES = array_keys(groupCategories());

switch ($method) {
    case 'GET':
        // Members of one group (used by the expandable card on the Groups page)
        if (($_GET['action'] ?? '') === 'members' && $id) {
            // People with a function_title (President, Pastor, Assistant...) are
            // the "committee" running this group, so they list first.
            $stmt = $db->prepare("
                SELECT m.id, m.first_name, m.last_name, m.email, m.phone,
                       m.person_type, m.status, m.function_title
                FROM member_groups mg
                JOIN members m ON m.id = mg.member_id
                WHERE mg.group_id = ?
                ORDER BY (m.function_title IS NULL OR m.function_title = '') ASC,
                         mg.position ASC, m.last_name ASC, m.first_name ASC
            ");
            $stmt->execute([$id]);
            jsonResponse(['members' => $stmt->fetchAll()]);
        }

        $stmt = $db->query("
            SELECT g.*,
                   d.name AS department_name,
                   (SELECT COUNT(*) FROM member_groups mg WHERE mg.group_id = g.id) AS member_count
            FROM `groups` g
            LEFT JOIN departments d ON d.id = g.department_id
            ORDER BY g.sort_order ASC, g.name ASC
        ");
        $groups = $stmt->fetchAll();
        foreach ($groups as &$g) {
            $g['member_count']  = (int)$g['member_count'];
            $g['department_id'] = $g['department_id'] !== null ? (int)$g['department_id'] : null;
            $g['is_active']     = (int)$g['is_active'];
        }
        unset($g);

        jsonResponse([
            'groups'     => $groups,
            'categories' => groupCategories(),
        ]);
        break;

    case 'POST':
        requireRole($currentUser, ['pastor', 'admin', 'leader']);
        $data = getRequestBody();
        $error = validateRequired($data, ['name']);
        if ($error) jsonResponse(['error' => $error], 400);

        $name = trim($data['name']);

        $check = $db->prepare("SELECT id FROM `groups` WHERE name = ?");
        $check->execute([$name]);
        if ($check->fetch()) {
            jsonResponse(['error' => 'A group with this name already exists'], 400);
        }

        $category = in_array($data['category'] ?? '', $CATEGORIES, true) ? $data['category'] : 'ministry';
        $deptId   = !empty($data['department_id']) ? (int)$data['department_id'] : null;
        // A group is only a "serving team" if it actually points at a department
        if ($category === 'department' && !$deptId) $category = 'ministry';

        $stmt = $db->prepare("INSERT INTO `groups` (name, description, department_id, category, sort_order)
                              VALUES (?, ?, ?, ?, ?)");
        $stmt->execute([
            $name,
            $data['description'] ?? null,
            $deptId,
            $category,
            (int)($data['sort_order'] ?? 0),
        ]);
        $newId = (int)$db->lastInsertId();

        $stmt = $db->prepare("SELECT * FROM `groups` WHERE id = ?");
        $stmt->execute([$newId]);
        jsonResponse(['group' => $stmt->fetch(), 'message' => 'Group created'], 201);
        break;

    case 'PUT':
        requireRole($currentUser, ['pastor', 'admin', 'leader']);

        // Save the pastor's hand-picked order of GROUPS within a section.
        if (($_GET['action'] ?? '') === 'reorder') {
            $data = getRequestBody();
            $ids = array_values(array_filter(array_map('intval', $data['group_ids'] ?? [])));
            if ($ids) {
                $upd = $db->prepare("UPDATE `groups` SET sort_order = ? WHERE id = ?");
                foreach ($ids as $pos => $gid) $upd->execute([$pos, $gid]);
            }
            jsonResponse(['message' => 'Order saved', 'count' => count($ids)]);
        }

        // Save the pastor's hand-picked order of PEOPLE inside one group.
        if (($_GET['action'] ?? '') === 'reorder_members') {
            $data = getRequestBody();
            $gid = (int)($data['group_id'] ?? 0);
            $ids = array_values(array_filter(array_map('intval', $data['member_ids'] ?? [])));
            if (!$gid) jsonResponse(['error' => 'Group ID required'], 400);
            if ($ids) {
                $upd = $db->prepare("UPDATE member_groups SET position = ? WHERE group_id = ? AND member_id = ?");
                foreach ($ids as $pos => $mid) $upd->execute([$pos, $gid, $mid]);
            }
            jsonResponse(['message' => 'Order saved', 'count' => count($ids)]);
        }

        if (!$id) jsonResponse(['error' => 'Group ID required'], 400);
        $data = getRequestBody();

        $fields = [];
        $params = [];

        if (array_key_exists('name', $data)) {
            $newName = trim($data['name']);
            if ($newName === '') jsonResponse(['error' => 'Group name is required'], 400);

            $dupe = $db->prepare("SELECT id FROM `groups` WHERE name = ? AND id <> ?");
            $dupe->execute([$newName, $id]);
            if ($dupe->fetch()) jsonResponse(['error' => 'A group with this name already exists'], 400);

            $fields[] = "name = ?";
            $params[] = $newName;
        }

        if (array_key_exists('description', $data)) {
            $fields[] = "description = ?";
            $params[] = $data['description'];
        }

        if (array_key_exists('department_id', $data)) {
            $fields[] = "department_id = ?";
            $params[] = !empty($data['department_id']) ? (int)$data['department_id'] : null;
        }

        if (array_key_exists('category', $data) && in_array($data['category'], $CATEGORIES, true)) {
            $fields[] = "category = ?";
            $params[] = $data['category'];
        }

        if (array_key_exists('is_active', $data)) {
            $fields[] = "is_active = ?";
            $params[] = !empty($data['is_active']) ? 1 : 0;
        }

        if (array_key_exists('sort_order', $data)) {
            $fields[] = "sort_order = ?";
            $params[] = (int)$data['sort_order'];
        }

        if (empty($fields)) jsonResponse(['error' => 'No fields to update'], 400);

        $params[] = $id;
        $db->prepare("UPDATE `groups` SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);

        // A serving team must point at a department; otherwise it is a plain ministry
        $db->prepare("UPDATE `groups` SET category = 'ministry'
                      WHERE id = ? AND category = 'department' AND department_id IS NULL")->execute([$id]);

        // Memberships live in member_groups now, so a rename can no longer orphan
        // anyone - we just refresh the denormalised name cache.
        rebuildGroupCache($db);

        $stmt = $db->prepare("SELECT * FROM `groups` WHERE id = ?");
        $stmt->execute([$id]);
        jsonResponse(['group' => $stmt->fetch(), 'message' => 'Group updated']);
        break;

    case 'DELETE':
        requireRole($currentUser, ['pastor', 'admin']);
        if (!$id) jsonResponse(['error' => 'Group ID required'], 400);

        $stmt = $db->prepare("SELECT id FROM `groups` WHERE id = ?");
        $stmt->execute([$id]);
        if (!$stmt->fetch()) jsonResponse(['error' => 'Group not found'], 404);

        // member_groups rows cascade. Only THIS group is removed from each member
        // - their other groups survive. The old code blanked the whole
        // family_group field and wiped every group the person was in.
        $affected = $db->prepare("SELECT member_id FROM member_groups WHERE group_id = ?");
        $affected->execute([$id]);
        $memberIds = $affected->fetchAll(PDO::FETCH_COLUMN);

        $db->prepare("DELETE FROM `groups` WHERE id = ?")->execute([$id]);

        foreach ($memberIds as $mid) rebuildGroupCache($db, (int)$mid);

        jsonResponse([
            'message'         => 'Group deleted',
            'members_updated' => count($memberIds),
        ]);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
