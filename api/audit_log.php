<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

switch ($method) {
    case 'GET':
        // List audit logs with filters
        $where = [];
        $params = [];

        if (!empty($_GET['date_from'])) {
            $where[] = 'DATE(a.created_at) >= ?';
            $params[] = $_GET['date_from'];
        }
        if (!empty($_GET['date_to'])) {
            $where[] = 'DATE(a.created_at) <= ?';
            $params[] = $_GET['date_to'];
        }
        if (!empty($_GET['action']) && $_GET['action'] !== 'all') {
            $where[] = 'a.action = ?';
            $params[] = $_GET['action'];
        }
        if (!empty($_GET['entity_type']) && $_GET['entity_type'] !== 'all') {
            $where[] = 'a.entity_type = ?';
            $params[] = $_GET['entity_type'];
        }
        if (!empty($_GET['user_id'])) {
            $where[] = 'a.user_id = ?';
            $params[] = (int)$_GET['user_id'];
        }

        $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $page = max(1, (int)($_GET['page'] ?? 1));
        $limit = min(100, max(10, (int)($_GET['limit'] ?? 50)));
        $offset = ($page - 1) * $limit;

        $countStmt = $db->prepare("SELECT COUNT(*) FROM audit_log a $whereClause");
        $countStmt->execute($params);
        $total = (int)$countStmt->fetchColumn();

        $stmt = $db->prepare("
            SELECT a.*
            FROM audit_log a
            $whereClause
            ORDER BY a.created_at DESC
            LIMIT $limit OFFSET $offset
        ");
        $stmt->execute($params);
        $logs = $stmt->fetchAll();

        // Decode JSON fields
        foreach ($logs as &$log) {
            $log['old_values'] = $log['old_values'] ? json_decode($log['old_values'], true) : null;
            $log['new_values'] = $log['new_values'] ? json_decode($log['new_values'], true) : null;
        }
        unset($log);

        jsonResponse([
            'logs' => $logs,
            'total' => $total,
            'page' => $page,
            'limit' => $limit,
            'pages' => max(1, ceil($total / $limit)),
        ]);
        break;

    case 'DELETE':
        // Admin only - delete one or many log entries. Accepts a single ?id=
        // or a comma-separated ?ids=1,2,3 for bulk deletion.
        requireRole($currentUser, ['pastor', 'admin']);

        $ids = [];
        if (!empty($_GET['ids'])) {
            foreach (explode(',', $_GET['ids']) as $part) {
                $n = (int)trim($part);
                if ($n > 0) $ids[] = $n;
            }
        } elseif (!empty($_GET['id'])) {
            $ids[] = (int)$_GET['id'];
        }
        $ids = array_values(array_unique($ids));

        if (!$ids) jsonResponse(['error' => 'Log ID required'], 400);

        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $db->prepare("DELETE FROM audit_log WHERE id IN ($placeholders)");
        $stmt->execute($ids);
        jsonResponse([
            'message' => $stmt->rowCount() . ' log ' . ($stmt->rowCount() === 1 ? 'entry' : 'entries') . ' deleted',
            'deleted' => $stmt->rowCount(),
        ]);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
