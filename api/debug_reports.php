<?php
require_once __DIR__ . '/config.php';
$db = getDB();

echo "=== MEMBER GROWTH (Last 6 months) ===\n";
$stmt = $db->prepare("
    SELECT
        DATE_FORMAT(created_at, '%Y-%m') as month,
        COUNT(*) as new_members,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_new
    FROM members
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
    GROUP BY DATE_FORMAT(created_at, '%Y-%m')
    ORDER BY month ASC
");
$stmt->execute();
echo json_encode($stmt->fetchAll(), JSON_PRETTY_PRINT) . "\n\n";

echo "=== MAY 2026 MEMBERS DETAIL ===\n";
$stmt = $db->query("
    SELECT id, first_name, last_name, status, person_type,
           DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at,
           membership_date
    FROM members
    WHERE DATE_FORMAT(created_at, '%Y-%m') = '2026-05'
    ORDER BY created_at ASC
");
echo json_encode($stmt->fetchAll(), JSON_PRETTY_PRINT) . "\n\n";

echo "=== TOTALS ===\n";
$total = $db->query("SELECT COUNT(*) FROM members")->fetchColumn();
$active = $db->query("SELECT COUNT(*) FROM members WHERE status = 'active'")->fetchColumn();
echo "Total: $total, Active: $active\n\n";

echo "=== TYPE BREAKDOWN ===\n";
$stmt = $db->query("
    SELECT person_type, COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count,
        COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive_count,
        COUNT(CASE WHEN status = 'forsaking' THEN 1 END) as forsaking_count,
        COUNT(CASE WHEN status = 'revoked' THEN 1 END) as revoked_count,
        COUNT(CASE WHEN status = 'restored' THEN 1 END) as restored_count
    FROM members
    GROUP BY person_type
    ORDER BY total DESC
");
echo json_encode($stmt->fetchAll(), JSON_PRETTY_PRINT) . "\n\n";

echo "=== STATUS BREAKDOWN ===\n";
$stmt = $db->query("SELECT status, COUNT(*) as count FROM members GROUP BY status ORDER BY count DESC");
echo json_encode($stmt->fetchAll(), JSON_PRETTY_PRINT) . "\n\n";

echo "=== CUMULATIVE TREND ===\n";
$stmt = $db->query("
    SELECT
        DATE_FORMAT(created_at, '%Y-%m') as month,
        COUNT(*) as new_this_month,
        (SELECT COUNT(*) FROM members m2 WHERE m2.created_at <= LAST_DAY(CONCAT(DATE_FORMAT(m.created_at, '%Y-%m'), '-01'))) as cumulative_total
    FROM members m
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
    GROUP BY DATE_FORMAT(created_at, '%Y-%m')
    ORDER BY month ASC
");
echo json_encode($stmt->fetchAll(), JSON_PRETTY_PRINT) . "\n";
