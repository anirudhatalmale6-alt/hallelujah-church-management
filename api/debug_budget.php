<?php
require_once __DIR__ . '/config.php';
$db = getDB();

echo "=== BUDGETS TABLE STRUCTURE ===\n";
$cols = $db->query("SHOW CREATE TABLE budgets")->fetch();
echo $cols['Create Table'] . "\n\n";

echo "=== ALL BUDGET ENTRIES FOR 2026 ===\n";
$stmt = $db->query("SELECT b.*,
    CASE WHEN b.category_type = 'income' THEN (SELECT name FROM donation_categories WHERE id = b.category_id)
         WHEN b.category_type = 'expense' THEN (SELECT name FROM expense_categories WHERE id = b.category_id)
    END as category_name
FROM budgets b WHERE b.year = 2026 ORDER BY b.category_type, b.category_id");
$rows = $stmt->fetchAll();
echo json_encode($rows, JSON_PRETTY_PRINT) . "\n\n";

echo "=== BUDGET VS ACTUAL (EXPENSES) ===\n";
$stmt = $db->prepare("
    SELECT ec.id, ec.name,
        COALESCE(SUM(e.amount), 0) as actual,
        COALESCE((SELECT SUM(amount) FROM budgets WHERE category_type = 'expense' AND category_id = ec.id AND year = ?), 0) as budget,
        (SELECT COUNT(*) FROM budgets WHERE category_type = 'expense' AND category_id = ec.id AND year = ?) as budget_rows
    FROM expense_categories ec
    LEFT JOIN expenses e ON e.category_id = ec.id AND e.expense_date BETWEEN '2026-01-01' AND '2026-12-31'
    WHERE ec.is_active = 1
    GROUP BY ec.id, ec.name
    ORDER BY ec.sort_order ASC
");
$stmt->execute([2026, 2026]);
echo json_encode($stmt->fetchAll(), JSON_PRETTY_PRINT) . "\n";
