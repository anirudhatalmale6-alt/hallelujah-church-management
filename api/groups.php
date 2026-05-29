<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = getDB();

switch ($method) {
    case 'GET':
        $stmt = $db->query("SELECT * FROM `groups` ORDER BY name ASC");
        $groups = $stmt->fetchAll();
        jsonResponse(['groups' => $groups]);
        break;

    case 'POST':
        requireRole($currentUser, ['pastor', 'admin', 'leader']);
        $data = getRequestBody();
        $error = validateRequired($data, ['name']);
        if ($error) jsonResponse(['error' => $error], 400);

        $name = trim($data['name']);
        $desc = $data['description'] ?? null;

        $check = $db->prepare("SELECT id FROM `groups` WHERE name = ?");
        $check->execute([$name]);
        if ($check->fetch()) {
            jsonResponse(['error' => 'A group with this name already exists'], 400);
        }

        $stmt = $db->prepare("INSERT INTO `groups` (name, description) VALUES (?, ?)");
        $stmt->execute([$name, $desc]);
        $newId = $db->lastInsertId();

        $stmt = $db->prepare("SELECT * FROM `groups` WHERE id = ?");
        $stmt->execute([$newId]);
        jsonResponse(['group' => $stmt->fetch(), 'message' => 'Group created'], 201);
        break;

    case 'PUT':
        requireRole($currentUser, ['pastor', 'admin', 'leader']);
        if (!$id) jsonResponse(['error' => 'Group ID required'], 400);
        $data = getRequestBody();

        $fields = [];
        $params = [];
        foreach (['name', 'description'] as $f) {
            if (array_key_exists($f, $data)) {
                $fields[] = "$f = ?";
                $params[] = $data[$f];
            }
        }
        if (empty($fields)) jsonResponse(['error' => 'No fields to update'], 400);

        if (isset($data['name'])) {
            $old = $db->prepare("SELECT name FROM `groups` WHERE id = ?");
            $old->execute([$id]);
            $oldName = $old->fetchColumn();

            $params[] = $id;
            $db->prepare("UPDATE `groups` SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);

            if ($oldName && $oldName !== $data['name']) {
                $db->prepare("UPDATE members SET family_group = ? WHERE family_group = ?")
                   ->execute([trim($data['name']), $oldName]);
            }
        } else {
            $params[] = $id;
            $db->prepare("UPDATE `groups` SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
        }

        $stmt = $db->prepare("SELECT * FROM `groups` WHERE id = ?");
        $stmt->execute([$id]);
        jsonResponse(['group' => $stmt->fetch(), 'message' => 'Group updated']);
        break;

    case 'DELETE':
        requireRole($currentUser, ['pastor', 'admin']);
        if (!$id) jsonResponse(['error' => 'Group ID required'], 400);

        $stmt = $db->prepare("SELECT name FROM `groups` WHERE id = ?");
        $stmt->execute([$id]);
        $group = $stmt->fetch();
        if (!$group) jsonResponse(['error' => 'Group not found'], 404);

        $db->prepare("UPDATE members SET family_group = NULL WHERE family_group = ?")->execute([$group['name']]);
        $db->prepare("DELETE FROM `groups` WHERE id = ?")->execute([$id]);
        jsonResponse(['message' => 'Group deleted']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
