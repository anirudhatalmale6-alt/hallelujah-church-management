<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();
$action = $_GET['action'] ?? '';

switch ($method) {
    case 'GET':
        if ($action === 'templates') {
            $stmt = $db->query("SELECT * FROM checklist_templates ORDER BY sort_order ASC");
            jsonResponse(['templates' => $stmt->fetchAll()]);
        }

        $serviceId = (int)($_GET['service_id'] ?? 0);
        if (!$serviceId) jsonResponse(['error' => 'service_id required'], 400);

        $check = $db->prepare("SELECT COUNT(*) as cnt FROM service_checklists WHERE service_id = ?");
        $check->execute([$serviceId]);
        if ($check->fetch()['cnt'] == 0) {
            $templates = $db->query("SELECT * FROM checklist_templates WHERE is_active = 1 ORDER BY sort_order ASC")->fetchAll();
            $insert = $db->prepare("INSERT INTO service_checklists (service_id, item_name, template_id, sort_order) VALUES (?, ?, ?, ?)");
            foreach ($templates as $t) {
                $insert->execute([$serviceId, $t['name'], $t['id'], $t['sort_order']]);
            }
        }

        $stmt = $db->prepare("
            SELECT sc.*, u.name as checked_by_name
            FROM service_checklists sc
            LEFT JOIN users u ON u.id = sc.checked_by
            WHERE sc.service_id = ?
            ORDER BY sc.sort_order ASC
        ");
        $stmt->execute([$serviceId]);
        jsonResponse(['checklist' => $stmt->fetchAll(), 'service_id' => $serviceId]);
        break;

    case 'POST':
        if ($action === 'template') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            $name = trim($data['name'] ?? '');
            if (!$name) jsonResponse(['error' => 'Item name is required'], 400);

            $maxOrder = $db->query("SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM checklist_templates")->fetch()['next'];
            $stmt = $db->prepare("INSERT INTO checklist_templates (name, category, sort_order) VALUES (?, ?, ?)");
            $stmt->execute([$name, $data['category'] ?? 'general', $maxOrder]);
            jsonResponse(['message' => 'Template item added', 'id' => $db->lastInsertId()], 201);
        }

        if ($action === 'add_item') {
            $data = getRequestBody();
            $serviceId = (int)($data['service_id'] ?? 0);
            $name = trim($data['name'] ?? '');
            if (!$serviceId || !$name) jsonResponse(['error' => 'service_id and name required'], 400);

            $maxOrder = $db->prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM service_checklists WHERE service_id = ?");
            $maxOrder->execute([$serviceId]);
            $next = $maxOrder->fetch()['next'];

            $stmt = $db->prepare("INSERT INTO service_checklists (service_id, item_name, sort_order) VALUES (?, ?, ?)");
            $stmt->execute([$serviceId, $name, $next]);
            jsonResponse(['message' => 'Item added', 'id' => $db->lastInsertId()], 201);
        }

        jsonResponse(['error' => 'Invalid action'], 400);
        break;

    case 'PUT':
        if ($action === 'template') {
            requireRole($currentUser, ['pastor', 'admin']);
            $id = (int)($_GET['id'] ?? 0);
            if (!$id) jsonResponse(['error' => 'Template ID required'], 400);

            $data = getRequestBody();
            $fields = [];
            $params = [];
            if (isset($data['name'])) { $fields[] = 'name = ?'; $params[] = $data['name']; }
            if (isset($data['category'])) { $fields[] = 'category = ?'; $params[] = $data['category']; }
            if (isset($data['is_active'])) { $fields[] = 'is_active = ?'; $params[] = (int)$data['is_active']; }
            if (isset($data['sort_order'])) { $fields[] = 'sort_order = ?'; $params[] = (int)$data['sort_order']; }

            if (empty($fields)) jsonResponse(['error' => 'Nothing to update'], 400);

            $params[] = $id;
            $db->prepare("UPDATE checklist_templates SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
            jsonResponse(['message' => 'Template updated']);
        }

        $id = (int)($_GET['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'Checklist item ID required'], 400);

        $data = getRequestBody();
        $isChecked = isset($data['is_checked']) ? (int)$data['is_checked'] : null;

        if ($isChecked !== null) {
            $stmt = $db->prepare("
                UPDATE service_checklists
                SET is_checked = ?, checked_by = ?, checked_at = ?, notes = ?
                WHERE id = ?
            ");
            $stmt->execute([
                $isChecked,
                $isChecked ? $currentUser['user_id'] : null,
                $isChecked ? date('Y-m-d H:i:s') : null,
                $data['notes'] ?? null,
                $id
            ]);
            jsonResponse(['message' => $isChecked ? 'Item checked' : 'Item unchecked']);
        }

        jsonResponse(['error' => 'Nothing to update'], 400);
        break;

    case 'DELETE':
        if ($action === 'template') {
            requireRole($currentUser, ['pastor', 'admin']);
            $id = (int)($_GET['id'] ?? 0);
            if (!$id) jsonResponse(['error' => 'Template ID required'], 400);

            $db->prepare("DELETE FROM checklist_templates WHERE id = ?")->execute([$id]);
            jsonResponse(['message' => 'Template item deleted']);
        }

        $id = (int)($_GET['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'Item ID required'], 400);

        $db->prepare("DELETE FROM service_checklists WHERE id = ?")->execute([$id]);
        jsonResponse(['message' => 'Item removed']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
