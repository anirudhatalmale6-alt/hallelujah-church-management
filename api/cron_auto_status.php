<?php
require_once __DIR__ . '/config.php';

$secret = $_GET['key'] ?? '';
if ($secret !== 'hitc-auto-status-2026') {
    http_response_code(403);
    echo json_encode(['error' => 'Unauthorized']);
    exit();
}

$db = getDB();
$changes = [];

// Active -> Inactive: 3 months no attendance
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
        $changes[] = $m['first_name'] . ' ' . $m['last_name'] . ': active -> inactive';
    }
}

// Inactive -> Forsaking: 6 months no attendance
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
        $changes[] = $m['first_name'] . ' ' . $m['last_name'] . ': inactive -> forsaking';
    }
}

// Forsaking -> Restored: 3+ months of attendance after forsaking
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
        $changes[] = $m['first_name'] . ' ' . $m['last_name'] . ': forsaking -> restored';
    }
}

$result = [
    'message' => count($changes) . ' status changes applied',
    'changes' => $changes,
    'run_at' => date('Y-m-d H:i:s'),
];

// Log the run
error_log('Auto-status cron: ' . json_encode($result));

jsonResponse($result);
