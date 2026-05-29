<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

switch ($method) {
    case 'GET':
        $stmt = $db->query("
            SELECT cp.*, u.name as closed_by_name
            FROM closed_periods cp
            LEFT JOIN users u ON u.id = cp.closed_by
            ORDER BY cp.year_month DESC
        ");
        jsonResponse(['periods' => $stmt->fetchAll()]);
        break;

    case 'POST':
        requireRole($currentUser, ['pastor', 'admin']);
        $data = getRequestBody();
        $yearMonth = $data['year_month'] ?? '';

        if (!preg_match('/^\d{4}-\d{2}$/', $yearMonth)) {
            jsonResponse(['error' => 'Invalid format. Use YYYY-MM'], 400);
        }

        $check = $db->prepare("SELECT id FROM closed_periods WHERE year_month = ?");
        $check->execute([$yearMonth]);
        if ($check->fetch()) {
            jsonResponse(['error' => 'This period is already closed'], 400);
        }

        $stmt = $db->prepare("INSERT INTO closed_periods (year_month, closed_by, notes) VALUES (?, ?, ?)");
        $stmt->execute([$yearMonth, $currentUser['user_id'], $data['notes'] ?? null]);

        jsonResponse(['message' => "Period $yearMonth has been closed", 'id' => $db->lastInsertId()], 201);
        break;

    case 'DELETE':
        requireRole($currentUser, ['pastor', 'admin']);
        $id = isset($_GET['id']) ? (int)$_GET['id'] : null;
        if (!$id) jsonResponse(['error' => 'Period ID required'], 400);

        $stmt = $db->prepare("DELETE FROM closed_periods WHERE id = ?");
        $stmt->execute([$id]);
        if ($stmt->rowCount() === 0) jsonResponse(['error' => 'Period not found'], 404);

        jsonResponse(['message' => 'Period reopened']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
