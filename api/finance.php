<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = getDB();

switch ($method) {
    case 'GET':
        // --- CHART OF ACCOUNTS ---
        if ($action === 'accounts') {
            $type = $_GET['type'] ?? '';
            $where = '';
            $params = [];
            if ($type) {
                $where = 'WHERE a.account_type = ?';
                $params[] = $type;
            }
            $stmt = $db->prepare("
                SELECT a.*, p.name as parent_name, p.account_number as parent_number,
                    (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) as child_count
                FROM accounts a
                LEFT JOIN accounts p ON p.id = a.parent_id
                $where
                ORDER BY a.sort_order ASC, a.name ASC
            ");
            $stmt->execute($params);
            $accounts = $stmt->fetchAll();
            jsonResponse(['accounts' => $accounts]);
        }

        if ($action === 'account') {
            if (!$id) jsonResponse(['error' => 'Account ID required'], 400);
            $stmt = $db->prepare("SELECT * FROM accounts WHERE id = ?");
            $stmt->execute([$id]);
            $account = $stmt->fetch();
            if (!$account) jsonResponse(['error' => 'Account not found'], 404);

            $children = $db->prepare("SELECT * FROM accounts WHERE parent_id = ? ORDER BY sort_order ASC");
            $children->execute([$id]);

            jsonResponse(['account' => $account, 'children' => $children->fetchAll()]);
        }

        // --- DONATION CATEGORIES ---
        if ($action === 'categories') {
            $stmt = $db->query("SELECT * FROM donation_categories ORDER BY sort_order ASC");
            jsonResponse(['categories' => $stmt->fetchAll()]);
        }

        // --- EXPENSE CATEGORIES ---
        if ($action === 'expense_categories') {
            $stmt = $db->query("SELECT * FROM expense_categories ORDER BY sort_order ASC");
            jsonResponse(['categories' => $stmt->fetchAll()]);
        }

        // --- EXPENSES LIST ---
        if ($action === 'expenses') {
            $page = max(1, (int)($_GET['page'] ?? 1));
            $limit = min(100, max(10, (int)($_GET['limit'] ?? 50)));
            $offset = ($page - 1) * $limit;

            $where = [];
            $params = [];

            if (!empty($_GET['category_id'])) {
                $where[] = 'e.category_id = ?';
                $params[] = (int)$_GET['category_id'];
            }
            if (!empty($_GET['date_from'])) {
                $where[] = 'e.expense_date >= ?';
                $params[] = $_GET['date_from'];
            }
            if (!empty($_GET['date_to'])) {
                $where[] = 'e.expense_date <= ?';
                $params[] = $_GET['date_to'];
            }
            if (!empty($_GET['status'])) {
                $where[] = 'e.status = ?';
                $params[] = $_GET['status'];
            }
            if (!empty($_GET['payment_method'])) {
                $where[] = 'e.payment_method = ?';
                $params[] = $_GET['payment_method'];
            }
            if (!empty($_GET['search'])) {
                $search = '%' . $_GET['search'] . '%';
                $where[] = "(e.description LIKE ? OR e.vendor LIKE ? OR e.reference_number LIKE ?)";
                $params = array_merge($params, [$search, $search, $search]);
            }

            $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

            $countStmt = $db->prepare("SELECT COUNT(*) FROM expenses e $whereClause");
            $countStmt->execute($params);
            $total = (int)$countStmt->fetchColumn();

            $stmt = $db->prepare("
                SELECT e.*, ec.name as category_name, ec.fund_type,
                       u1.name as recorded_by_name,
                       u2.name as approved_by_name
                FROM expenses e
                JOIN expense_categories ec ON ec.id = e.category_id
                LEFT JOIN users u1 ON u1.id = e.recorded_by
                LEFT JOIN users u2 ON u2.id = e.approved_by
                $whereClause
                ORDER BY e.expense_date DESC, e.created_at DESC
                LIMIT $limit OFFSET $offset
            ");
            $stmt->execute($params);
            $expenses = $stmt->fetchAll();

            $sumStmt = $db->prepare("SELECT COALESCE(SUM(e.amount), 0) FROM expenses e $whereClause");
            $sumStmt->execute($params);
            $filteredTotal = (float)$sumStmt->fetchColumn();

            jsonResponse([
                'expenses' => $expenses,
                'total' => $total,
                'filtered_total' => $filteredTotal,
                'page' => $page,
                'limit' => $limit,
                'pages' => max(1, ceil($total / $limit)),
            ]);
        }

        // --- BUDGETS ---
        if ($action === 'budgets') {
            $year = (int)($_GET['year'] ?? date('Y'));
            $stmt = $db->prepare("
                SELECT b.*,
                    CASE
                        WHEN b.category_type = 'income' THEN (SELECT name FROM donation_categories WHERE id = b.category_id)
                        WHEN b.category_type = 'expense' THEN (SELECT name FROM expense_categories WHERE id = b.category_id)
                    END as category_name,
                    CASE
                        WHEN b.category_type = 'income' THEN (SELECT fund_type FROM donation_categories WHERE id = b.category_id)
                        WHEN b.category_type = 'expense' THEN (SELECT fund_type FROM expense_categories WHERE id = b.category_id)
                    END as fund_type
                FROM budgets b
                WHERE b.year = ?
                ORDER BY b.category_type ASC, b.category_id ASC
            ");
            $stmt->execute([$year]);
            $budgets = $stmt->fetchAll();
            jsonResponse(['budgets' => $budgets, 'year' => $year]);
        }

        // --- INCOME STATEMENT ---
        if ($action === 'income_statement') {
            $dateFrom = $_GET['date_from'] ?? date('Y-01-01');
            $dateTo = $_GET['date_to'] ?? date('Y-m-d');

            $income = $db->prepare("
                SELECT dc.id, dc.name, dc.fund_type, COALESCE(SUM(d.amount), 0) as total
                FROM donation_categories dc
                LEFT JOIN donations d ON d.category_id = dc.id AND d.donation_date BETWEEN ? AND ?
                WHERE dc.is_active = 1
                GROUP BY dc.id, dc.name, dc.fund_type
                ORDER BY dc.sort_order ASC
            ");
            $income->execute([$dateFrom, $dateTo]);
            $incomeRows = $income->fetchAll();

            $expenses = $db->prepare("
                SELECT ec.id, ec.name, ec.fund_type, COALESCE(SUM(e.amount), 0) as total
                FROM expense_categories ec
                LEFT JOIN expenses e ON e.category_id = ec.id AND e.expense_date BETWEEN ? AND ?
                WHERE ec.is_active = 1
                GROUP BY ec.id, ec.name, ec.fund_type
                ORDER BY ec.sort_order ASC
            ");
            $expenses->execute([$dateFrom, $dateTo]);
            $expenseRows = $expenses->fetchAll();

            $totalIncome = array_sum(array_column($incomeRows, 'total'));
            $totalExpenses = array_sum(array_column($expenseRows, 'total'));

            $incomeByFund = [];
            foreach ($incomeRows as $r) {
                $fund = $r['fund_type'] ?: 'general';
                if (!isset($incomeByFund[$fund])) $incomeByFund[$fund] = 0;
                $incomeByFund[$fund] += (float)$r['total'];
            }
            $expensesByFund = [];
            foreach ($expenseRows as $r) {
                $fund = $r['fund_type'] ?: 'general';
                if (!isset($expensesByFund[$fund])) $expensesByFund[$fund] = 0;
                $expensesByFund[$fund] += (float)$r['total'];
            }

            jsonResponse([
                'income' => $incomeRows,
                'expenses' => $expenseRows,
                'total_income' => $totalIncome,
                'total_expenses' => $totalExpenses,
                'net_income' => $totalIncome - $totalExpenses,
                'income_by_fund' => $incomeByFund,
                'expenses_by_fund' => $expensesByFund,
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
            ]);
        }

        // --- BUDGET VS ACTUAL ---
        if ($action === 'budget_actual') {
            $year = (int)($_GET['year'] ?? date('Y'));
            $dateFrom = "$year-01-01";
            $dateTo = "$year-12-31";

            $incomeBudgets = $db->prepare("
                SELECT dc.id, dc.name, dc.fund_type,
                    COALESCE(SUM(d.amount), 0) as actual,
                    COALESCE((SELECT SUM(amount) FROM budgets WHERE category_type = 'income' AND category_id = dc.id AND year = ?), 0) as budget
                FROM donation_categories dc
                LEFT JOIN donations d ON d.category_id = dc.id AND d.donation_date BETWEEN ? AND ?
                WHERE dc.is_active = 1
                GROUP BY dc.id, dc.name, dc.fund_type
                ORDER BY dc.sort_order ASC
            ");
            $incomeBudgets->execute([$year, $dateFrom, $dateTo]);
            $incomeRows = $incomeBudgets->fetchAll();

            $expenseBudgets = $db->prepare("
                SELECT ec.id, ec.name, ec.fund_type,
                    COALESCE(SUM(e.amount), 0) as actual,
                    COALESCE((SELECT SUM(amount) FROM budgets WHERE category_type = 'expense' AND category_id = ec.id AND year = ?), 0) as budget
                FROM expense_categories ec
                LEFT JOIN expenses e ON e.category_id = ec.id AND e.expense_date BETWEEN ? AND ?
                WHERE ec.is_active = 1
                GROUP BY ec.id, ec.name, ec.fund_type
                ORDER BY ec.sort_order ASC
            ");
            $expenseBudgets->execute([$year, $dateFrom, $dateTo]);
            $expenseRows = $expenseBudgets->fetchAll();

            $totalIncomeBudget = array_sum(array_column($incomeRows, 'budget'));
            $totalIncomeActual = array_sum(array_column($incomeRows, 'actual'));
            $totalExpenseBudget = array_sum(array_column($expenseRows, 'budget'));
            $totalExpenseActual = array_sum(array_column($expenseRows, 'actual'));

            jsonResponse([
                'income' => $incomeRows,
                'expenses' => $expenseRows,
                'totals' => [
                    'income_budget' => $totalIncomeBudget,
                    'income_actual' => $totalIncomeActual,
                    'expense_budget' => $totalExpenseBudget,
                    'expense_actual' => $totalExpenseActual,
                    'net_budget' => $totalIncomeBudget - $totalExpenseBudget,
                    'net_actual' => $totalIncomeActual - $totalExpenseActual,
                ],
                'year' => $year,
            ]);
        }

        // --- EXPENSE SUMMARY ---
        if ($action === 'expense_summary') {
            $dateFrom = $_GET['date_from'] ?? date('Y-m-01');
            $dateTo = $_GET['date_to'] ?? date('Y-m-t');

            $byCategory = $db->prepare("
                SELECT ec.name as category_name, ec.id as category_id, ec.fund_type,
                       COALESCE(SUM(e.amount), 0) as total,
                       COUNT(e.id) as count
                FROM expense_categories ec
                LEFT JOIN expenses e ON e.category_id = ec.id AND e.expense_date BETWEEN ? AND ?
                WHERE ec.is_active = 1
                GROUP BY ec.id, ec.name, ec.fund_type
                ORDER BY ec.sort_order ASC
            ");
            $byCategory->execute([$dateFrom, $dateTo]);
            $byCategoryRows = $byCategory->fetchAll();

            $totalStmt = $db->prepare("SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM expenses WHERE expense_date BETWEEN ? AND ?");
            $totalStmt->execute([$dateFrom, $dateTo]);
            $totals = $totalStmt->fetch();

            $byMethod = $db->prepare("
                SELECT payment_method, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
                FROM expenses WHERE expense_date BETWEEN ? AND ?
                GROUP BY payment_method ORDER BY total DESC
            ");
            $byMethod->execute([$dateFrom, $dateTo]);
            $byMethodRows = $byMethod->fetchAll();

            $monthlyTrend = $db->query("
                SELECT DATE_FORMAT(expense_date, '%Y-%m') as month,
                       COALESCE(SUM(amount), 0) as total,
                       COUNT(*) as count
                FROM expenses
                WHERE expense_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
                GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
                ORDER BY month ASC
            ")->fetchAll();

            $pending = $db->prepare("
                SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
                FROM expenses WHERE status = 'recorded' AND expense_date BETWEEN ? AND ?
            ");
            $pending->execute([$dateFrom, $dateTo]);
            $pendingRow = $pending->fetch();

            jsonResponse([
                'by_category' => $byCategoryRows,
                'by_method' => $byMethodRows,
                'totals' => $totals,
                'monthly_trend' => $monthlyTrend,
                'pending_approval' => $pendingRow,
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
            ]);
        }

        // Member giving statement
        if ($action === 'member_statement') {
            $memberId = (int)($_GET['member_id'] ?? 0);
            if (!$memberId) jsonResponse(['error' => 'member_id required'], 400);

            $dateFrom = $_GET['date_from'] ?? date('Y-01-01');
            $dateTo = $_GET['date_to'] ?? date('Y-12-31');

            $stmt = $db->prepare("SELECT first_name, last_name, email, phone, address, city, state, zip FROM members WHERE id = ?");
            $stmt->execute([$memberId]);
            $member = $stmt->fetch();
            if (!$member) jsonResponse(['error' => 'Member not found'], 404);

            $stmt = $db->prepare("
                SELECT d.*, dc.name as category_name, s.name as service_name, s.date as service_date
                FROM donations d
                JOIN donation_categories dc ON dc.id = d.category_id
                LEFT JOIN services s ON s.id = d.service_id
                WHERE d.member_id = ? AND d.donation_date BETWEEN ? AND ?
                ORDER BY d.donation_date ASC
            ");
            $stmt->execute([$memberId, $dateFrom, $dateTo]);
            $donations = $stmt->fetchAll();

            $totalByCategory = [];
            $grandTotal = 0;
            foreach ($donations as $d) {
                $cat = $d['category_name'];
                if (!isset($totalByCategory[$cat])) $totalByCategory[$cat] = 0;
                $totalByCategory[$cat] += (float)$d['amount'];
                $grandTotal += (float)$d['amount'];
            }

            jsonResponse([
                'member' => $member,
                'donations' => $donations,
                'total_by_category' => $totalByCategory,
                'grand_total' => $grandTotal,
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
            ]);
        }

        // Financial summary/reports (donations)
        if ($action === 'summary') {
            $period = $_GET['period'] ?? 'month';
            $dateFrom = $_GET['date_from'] ?? null;
            $dateTo = $_GET['date_to'] ?? null;

            if (!$dateFrom || !$dateTo) {
                switch ($period) {
                    case 'week':
                        $dateFrom = date('Y-m-d', strtotime('monday this week'));
                        $dateTo = date('Y-m-d', strtotime('sunday this week'));
                        break;
                    case 'quarter':
                        $q = ceil(date('n') / 3);
                        $dateFrom = date('Y-' . str_pad(($q - 1) * 3 + 1, 2, '0', STR_PAD_LEFT) . '-01');
                        $dateTo = date('Y-m-t', strtotime($dateFrom . ' +2 months'));
                        break;
                    case 'year':
                        $dateFrom = date('Y-01-01');
                        $dateTo = date('Y-12-31');
                        break;
                    default:
                        $dateFrom = date('Y-m-01');
                        $dateTo = date('Y-m-t');
                }
            }

            $stmt = $db->prepare("
                SELECT dc.name as category_name, dc.id as category_id, dc.fund_type,
                       COALESCE(SUM(d.amount), 0) as total,
                       COUNT(d.id) as count
                FROM donation_categories dc
                LEFT JOIN donations d ON d.category_id = dc.id AND d.donation_date BETWEEN ? AND ?
                WHERE dc.is_active = 1
                GROUP BY dc.id, dc.name, dc.fund_type
                ORDER BY dc.sort_order ASC
            ");
            $stmt->execute([$dateFrom, $dateTo]);
            $byCategory = $stmt->fetchAll();

            $stmt = $db->prepare("SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM donations WHERE donation_date BETWEEN ? AND ?");
            $stmt->execute([$dateFrom, $dateTo]);
            $totals = $stmt->fetch();

            $stmt = $db->prepare("
                SELECT payment_method, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
                FROM donations WHERE donation_date BETWEEN ? AND ?
                GROUP BY payment_method ORDER BY total DESC
            ");
            $stmt->execute([$dateFrom, $dateTo]);
            $byMethod = $stmt->fetchAll();

            $stmt = $db->query("
                SELECT DATE_FORMAT(donation_date, '%Y-%m') as month,
                       COALESCE(SUM(amount), 0) as total,
                       COUNT(*) as count
                FROM donations
                WHERE donation_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
                GROUP BY DATE_FORMAT(donation_date, '%Y-%m')
                ORDER BY month ASC
            ");
            $monthlyTrend = $stmt->fetchAll();

            $stmt = $db->prepare("
                SELECT m.id, m.first_name, m.last_name, COALESCE(SUM(d.amount), 0) as total
                FROM donations d
                JOIN members m ON m.id = d.member_id
                WHERE d.donation_date BETWEEN ? AND ?
                GROUP BY m.id, m.first_name, m.last_name
                ORDER BY total DESC
                LIMIT 10
            ");
            $stmt->execute([$dateFrom, $dateTo]);
            $topGivers = $stmt->fetchAll();

            $stmt = $db->prepare("
                SELECT d.*, dc.name as category_name,
                       COALESCE(m.first_name, '') as member_first_name,
                       COALESCE(m.last_name, '') as member_last_name,
                       s.name as service_name
                FROM donations d
                JOIN donation_categories dc ON dc.id = d.category_id
                LEFT JOIN members m ON m.id = d.member_id
                LEFT JOIN services s ON s.id = d.service_id
                WHERE d.donation_date BETWEEN ? AND ?
                ORDER BY d.created_at DESC
                LIMIT 20
            ");
            $stmt->execute([$dateFrom, $dateTo]);
            $recent = $stmt->fetchAll();

            // Also get expense totals for the same period
            $expenseTotal = 0;
            try {
                $expStmt = $db->prepare("SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE expense_date BETWEEN ? AND ?");
                $expStmt->execute([$dateFrom, $dateTo]);
                $expenseTotal = (float)$expStmt->fetchColumn();
            } catch (Exception $e) {}

            jsonResponse([
                'by_category' => $byCategory,
                'by_method' => $byMethod,
                'totals' => $totals,
                'monthly_trend' => $monthlyTrend,
                'top_givers' => $topGivers,
                'recent' => $recent,
                'expense_total' => $expenseTotal,
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
                'period' => $period,
            ]);
        }

        // --- DEFAULT: List donations with filters ---
        $page = max(1, (int)($_GET['page'] ?? 1));
        $limit = min(100, max(10, (int)($_GET['limit'] ?? 50)));
        $offset = ($page - 1) * $limit;

        $where = [];
        $params = [];

        if (!empty($_GET['member_id'])) {
            $where[] = 'd.member_id = ?';
            $params[] = (int)$_GET['member_id'];
        }
        if (!empty($_GET['service_id'])) {
            $where[] = 'd.service_id = ?';
            $params[] = (int)$_GET['service_id'];
        }
        if (!empty($_GET['category_id'])) {
            $where[] = 'd.category_id = ?';
            $params[] = (int)$_GET['category_id'];
        }
        if (!empty($_GET['date_from'])) {
            $where[] = 'd.donation_date >= ?';
            $params[] = $_GET['date_from'];
        }
        if (!empty($_GET['date_to'])) {
            $where[] = 'd.donation_date <= ?';
            $params[] = $_GET['date_to'];
        }
        if (!empty($_GET['payment_method'])) {
            $where[] = 'd.payment_method = ?';
            $params[] = $_GET['payment_method'];
        }
        if (!empty($_GET['search'])) {
            $search = '%' . $_GET['search'] . '%';
            $where[] = "(m.first_name LIKE ? OR m.last_name LIKE ? OR d.donor_name LIKE ? OR d.reference_number LIKE ?)";
            $params = array_merge($params, [$search, $search, $search, $search]);
        }

        $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $countStmt = $db->prepare("SELECT COUNT(*) FROM donations d LEFT JOIN members m ON m.id = d.member_id $whereClause");
        $countStmt->execute($params);
        $total = (int)$countStmt->fetchColumn();

        $stmt = $db->prepare("
            SELECT d.*, dc.name as category_name,
                   COALESCE(m.first_name, '') as member_first_name,
                   COALESCE(m.last_name, '') as member_last_name,
                   d.donor_name,
                   s.name as service_name, s.date as service_date,
                   u.name as recorded_by_name
            FROM donations d
            JOIN donation_categories dc ON dc.id = d.category_id
            LEFT JOIN members m ON m.id = d.member_id
            LEFT JOIN services s ON s.id = d.service_id
            LEFT JOIN users u ON u.id = d.recorded_by
            $whereClause
            ORDER BY d.donation_date DESC, d.created_at DESC
            LIMIT $limit OFFSET $offset
        ");
        $stmt->execute($params);
        $donations = $stmt->fetchAll();

        $sumStmt = $db->prepare("SELECT COALESCE(SUM(d.amount), 0) as total FROM donations d LEFT JOIN members m ON m.id = d.member_id $whereClause");
        $sumStmt->execute($params);
        $filteredTotal = (float)$sumStmt->fetchColumn();

        jsonResponse([
            'donations' => $donations,
            'total' => $total,
            'filtered_total' => $filteredTotal,
            'page' => $page,
            'limit' => $limit,
            'pages' => max(1, ceil($total / $limit)),
        ]);
        break;

    case 'POST':
        // --- CREATE ACCOUNT ---
        if ($action === 'account') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            $name = trim($data['name'] ?? '');
            if (!$name) jsonResponse(['error' => 'Account name required'], 400);
            if (empty($data['account_type'])) jsonResponse(['error' => 'account_type required'], 400);

            $maxOrder = (int)$db->query("SELECT COALESCE(MAX(sort_order), 0) FROM accounts")->fetchColumn() + 1;
            $parentId = !empty($data['parent_id']) ? (int)$data['parent_id'] : null;

            $stmt = $db->prepare("
                INSERT INTO accounts (parent_id, account_type, account_number, name, description, opening_balance, current_balance, fund_type, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                $parentId,
                $data['account_type'],
                $data['account_number'] ?? null,
                $name,
                $data['description'] ?? null,
                (float)($data['opening_balance'] ?? 0),
                (float)($data['current_balance'] ?? $data['opening_balance'] ?? 0),
                $data['fund_type'] ?? 'general',
                $maxOrder,
            ]);
            jsonResponse(['message' => 'Account created', 'id' => (int)$db->lastInsertId()], 201);
        }

        // --- DONATION CATEGORY ---
        if ($action === 'category') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            $name = trim($data['name'] ?? '');
            if (!$name) jsonResponse(['error' => 'Category name required'], 400);

            $maxOrder = (int)$db->query("SELECT COALESCE(MAX(sort_order), 0) FROM donation_categories")->fetchColumn() + 1;
            try {
                $stmt = $db->prepare("INSERT INTO donation_categories (name, description, fund_type, sort_order) VALUES (?, ?, ?, ?)");
                $stmt->execute([$name, $data['description'] ?? null, $data['fund_type'] ?? 'general', $maxOrder]);
                jsonResponse(['message' => 'Category created', 'id' => (int)$db->lastInsertId()], 201);
            } catch (Exception $e) {
                jsonResponse(['error' => 'Category already exists'], 400);
            }
        }

        // --- EXPENSE CATEGORY ---
        if ($action === 'expense_category') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            $name = trim($data['name'] ?? '');
            if (!$name) jsonResponse(['error' => 'Category name required'], 400);

            $maxOrder = (int)$db->query("SELECT COALESCE(MAX(sort_order), 0) FROM expense_categories")->fetchColumn() + 1;
            try {
                $stmt = $db->prepare("INSERT INTO expense_categories (name, description, fund_type, sort_order) VALUES (?, ?, ?, ?)");
                $stmt->execute([$name, $data['description'] ?? null, $data['fund_type'] ?? 'general', $maxOrder]);
                jsonResponse(['message' => 'Expense category created', 'id' => (int)$db->lastInsertId()], 201);
            } catch (Exception $e) {
                jsonResponse(['error' => 'Category already exists'], 400);
            }
        }

        // --- RECORD EXPENSE ---
        if ($action === 'expense') {
            $data = getRequestBody();
            if (empty($data['category_id']) || empty($data['amount']) || empty($data['expense_date'])) {
                jsonResponse(['error' => 'category_id, amount, and expense_date are required'], 400);
            }
            if ((float)$data['amount'] <= 0) {
                jsonResponse(['error' => 'Amount must be positive'], 400);
            }

            $stmt = $db->prepare("
                INSERT INTO expenses (category_id, amount, description, vendor, payment_method, reference_number, expense_date, receipt_note, recorded_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                (int)$data['category_id'],
                (float)$data['amount'],
                $data['description'] ?? null,
                $data['vendor'] ?? null,
                $data['payment_method'] ?? 'check',
                $data['reference_number'] ?? null,
                $data['expense_date'],
                $data['receipt_note'] ?? null,
                $currentUser['user_id'],
            ]);

            jsonResponse(['message' => 'Expense recorded', 'id' => (int)$db->lastInsertId()], 201);
        }

        // --- SET BUDGET ---
        if ($action === 'budget') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            if (empty($data['category_type']) || empty($data['category_id']) || !isset($data['amount']) || empty($data['year'])) {
                jsonResponse(['error' => 'category_type, category_id, year, and amount are required'], 400);
            }

            $month = isset($data['month']) && $data['month'] !== '' ? (int)$data['month'] : null;

            $stmt = $db->prepare("
                INSERT INTO budgets (category_type, category_id, year, month, amount, notes)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE amount = VALUES(amount), notes = VALUES(notes)
            ");
            $stmt->execute([
                $data['category_type'],
                (int)$data['category_id'],
                (int)$data['year'],
                $month,
                (float)$data['amount'],
                $data['notes'] ?? null,
            ]);

            jsonResponse(['message' => 'Budget saved'], 201);
        }

        // --- BULK BUDGET ---
        if ($action === 'bulk_budget') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            $items = $data['items'] ?? [];
            if (empty($items)) jsonResponse(['error' => 'No items'], 400);

            $stmt = $db->prepare("
                INSERT INTO budgets (category_type, category_id, year, month, amount, notes)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE amount = VALUES(amount), notes = VALUES(notes)
            ");

            $count = 0;
            foreach ($items as $item) {
                if (!isset($item['amount']) || (float)$item['amount'] < 0) continue;
                $month = isset($item['month']) && $item['month'] !== '' ? (int)$item['month'] : null;
                $stmt->execute([
                    $item['category_type'],
                    (int)$item['category_id'],
                    (int)$item['year'],
                    $month,
                    (float)$item['amount'],
                    $item['notes'] ?? null,
                ]);
                $count++;
            }
            jsonResponse(['message' => "$count budget(s) saved", 'count' => $count], 201);
        }

        // --- BULK DONATIONS ---
        if ($action === 'bulk') {
            $data = getRequestBody();
            $records = $data['records'] ?? [];
            if (empty($records)) jsonResponse(['error' => 'No records provided'], 400);

            $stmt = $db->prepare("
                INSERT INTO donations (member_id, service_id, category_id, amount, payment_method, reference_number, donor_name, notes, donation_date, recorded_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");

            $count = 0;
            foreach ($records as $r) {
                if (empty($r['amount']) || (float)$r['amount'] <= 0) continue;
                $stmt->execute([
                    !empty($r['member_id']) ? (int)$r['member_id'] : null,
                    !empty($r['service_id']) ? (int)$r['service_id'] : null,
                    (int)$r['category_id'],
                    (float)$r['amount'],
                    $r['payment_method'] ?? 'cash',
                    $r['reference_number'] ?? null,
                    $r['donor_name'] ?? null,
                    $r['notes'] ?? null,
                    $r['donation_date'] ?? date('Y-m-d'),
                    $currentUser['user_id'],
                ]);
                $count++;
            }
            jsonResponse(['message' => "$count donation(s) recorded", 'count' => $count], 201);
        }

        // --- SINGLE DONATION ---
        $data = getRequestBody();
        if (empty($data['category_id']) || empty($data['amount'])) {
            jsonResponse(['error' => 'category_id and amount are required'], 400);
        }
        if ((float)$data['amount'] <= 0) {
            jsonResponse(['error' => 'Amount must be positive'], 400);
        }

        $stmt = $db->prepare("
            INSERT INTO donations (member_id, service_id, category_id, amount, payment_method, reference_number, donor_name, notes, donation_date, recorded_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([
            !empty($data['member_id']) ? (int)$data['member_id'] : null,
            !empty($data['service_id']) ? (int)$data['service_id'] : null,
            (int)$data['category_id'],
            (float)$data['amount'],
            $data['payment_method'] ?? 'cash',
            $data['reference_number'] ?? null,
            $data['donor_name'] ?? null,
            $data['notes'] ?? null,
            $data['donation_date'] ?? date('Y-m-d'),
            $currentUser['user_id'],
        ]);

        jsonResponse(['message' => 'Donation recorded', 'id' => (int)$db->lastInsertId()], 201);
        break;

    case 'PUT':
        // --- ACCOUNT UPDATE ---
        if ($action === 'account') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Account ID required'], 400);
            $data = getRequestBody();
            $fields = [];
            $params = [];
            $allowed = ['name', 'description', 'account_number', 'fund_type', 'opening_balance', 'current_balance', 'is_active', 'sort_order', 'parent_id'];
            foreach ($allowed as $f) {
                if (array_key_exists($f, $data)) {
                    $fields[] = "$f = ?";
                    $val = $data[$f];
                    if (in_array($f, ['opening_balance', 'current_balance'])) $val = (float)$val;
                    if (in_array($f, ['is_active', 'sort_order'])) $val = (int)$val;
                    if ($f === 'parent_id') $val = $val ? (int)$val : null;
                    $params[] = $val;
                }
            }
            if (empty($fields)) jsonResponse(['error' => 'Nothing to update'], 400);
            $params[] = $id;
            $db->prepare("UPDATE accounts SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
            jsonResponse(['message' => 'Account updated']);
        }

        // --- DONATION CATEGORY UPDATE ---
        if ($action === 'category') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Category ID required'], 400);
            $data = getRequestBody();
            $fields = [];
            $params = [];
            if (isset($data['name'])) { $fields[] = 'name = ?'; $params[] = $data['name']; }
            if (isset($data['description'])) { $fields[] = 'description = ?'; $params[] = $data['description']; }
            if (isset($data['fund_type'])) { $fields[] = 'fund_type = ?'; $params[] = $data['fund_type']; }
            if (isset($data['sort_order'])) { $fields[] = 'sort_order = ?'; $params[] = (int)$data['sort_order']; }
            if (isset($data['is_active'])) { $fields[] = 'is_active = ?'; $params[] = (int)$data['is_active']; }
            if (empty($fields)) jsonResponse(['error' => 'Nothing to update'], 400);
            $params[] = $id;
            $db->prepare("UPDATE donation_categories SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
            jsonResponse(['message' => 'Category updated']);
        }

        // --- EXPENSE CATEGORY UPDATE ---
        if ($action === 'expense_category') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Category ID required'], 400);
            $data = getRequestBody();
            $fields = [];
            $params = [];
            if (isset($data['name'])) { $fields[] = 'name = ?'; $params[] = $data['name']; }
            if (isset($data['description'])) { $fields[] = 'description = ?'; $params[] = $data['description']; }
            if (isset($data['fund_type'])) { $fields[] = 'fund_type = ?'; $params[] = $data['fund_type']; }
            if (isset($data['sort_order'])) { $fields[] = 'sort_order = ?'; $params[] = (int)$data['sort_order']; }
            if (isset($data['is_active'])) { $fields[] = 'is_active = ?'; $params[] = (int)$data['is_active']; }
            if (empty($fields)) jsonResponse(['error' => 'Nothing to update'], 400);
            $params[] = $id;
            $db->prepare("UPDATE expense_categories SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
            jsonResponse(['message' => 'Expense category updated']);
        }

        // --- EXPENSE UPDATE ---
        if ($action === 'expense') {
            if (!$id) jsonResponse(['error' => 'Expense ID required'], 400);
            $data = getRequestBody();
            $fields = [];
            $params = [];
            $allowed = ['category_id', 'amount', 'description', 'vendor', 'payment_method', 'reference_number', 'expense_date', 'receipt_note'];
            foreach ($allowed as $f) {
                if (array_key_exists($f, $data)) {
                    $fields[] = "$f = ?";
                    $val = $data[$f];
                    if ($f === 'amount') $val = (float)$val;
                    if ($f === 'category_id') $val = (int)$val;
                    $params[] = $val;
                }
            }
            if (empty($fields)) jsonResponse(['error' => 'Nothing to update'], 400);
            $params[] = $id;
            $db->prepare("UPDATE expenses SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
            jsonResponse(['message' => 'Expense updated']);
        }

        // --- APPROVE EXPENSE ---
        if ($action === 'approve_expense') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Expense ID required'], 400);
            $db->prepare("UPDATE expenses SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?")->execute([$currentUser['user_id'], $id]);
            jsonResponse(['message' => 'Expense approved']);
        }

        // --- BUDGET UPDATE ---
        if ($action === 'budget') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Budget ID required'], 400);
            $data = getRequestBody();
            $fields = [];
            $params = [];
            if (isset($data['amount'])) { $fields[] = 'amount = ?'; $params[] = (float)$data['amount']; }
            if (isset($data['notes'])) { $fields[] = 'notes = ?'; $params[] = $data['notes']; }
            if (empty($fields)) jsonResponse(['error' => 'Nothing to update'], 400);
            $params[] = $id;
            $db->prepare("UPDATE budgets SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
            jsonResponse(['message' => 'Budget updated']);
        }

        // --- DONATION UPDATE ---
        if (!$id) jsonResponse(['error' => 'Donation ID required'], 400);
        $data = getRequestBody();
        $fields = [];
        $params = [];
        $allowed = ['member_id', 'service_id', 'category_id', 'amount', 'payment_method', 'reference_number', 'donor_name', 'notes', 'donation_date'];
        foreach ($allowed as $f) {
            if (array_key_exists($f, $data)) {
                $fields[] = "$f = ?";
                $val = $data[$f];
                if ($f === 'amount') $val = (float)$val;
                if ($f === 'member_id' || $f === 'service_id' || $f === 'category_id') $val = $val ? (int)$val : null;
                $params[] = $val;
            }
        }
        if (empty($fields)) jsonResponse(['error' => 'Nothing to update'], 400);
        $params[] = $id;
        $db->prepare("UPDATE donations SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
        jsonResponse(['message' => 'Donation updated']);
        break;

    case 'DELETE':
        // --- DELETE ACCOUNT ---
        if ($action === 'account') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Account ID required'], 400);
            $childCount = (int)$db->prepare("SELECT COUNT(*) FROM accounts WHERE parent_id = ?")->execute([$id]) ? $db->query("SELECT COUNT(*) FROM accounts WHERE parent_id = $id")->fetchColumn() : 0;
            if ($childCount > 0) {
                jsonResponse(['error' => 'Cannot delete account with sub-accounts. Remove sub-accounts first or deactivate it.'], 400);
            }
            $db->prepare("DELETE FROM accounts WHERE id = ?")->execute([$id]);
            jsonResponse(['message' => 'Account deleted']);
        }

        // --- DELETE DONATION CATEGORY ---
        if ($action === 'category') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Category ID required'], 400);
            $check = $db->prepare("SELECT COUNT(*) FROM donations WHERE category_id = ?");
            $check->execute([$id]);
            if ((int)$check->fetchColumn() > 0) {
                jsonResponse(['error' => 'Cannot delete category that has donations. Deactivate it instead.'], 400);
            }
            $db->prepare("DELETE FROM donation_categories WHERE id = ?")->execute([$id]);
            jsonResponse(['message' => 'Category deleted']);
        }

        // --- DELETE EXPENSE CATEGORY ---
        if ($action === 'expense_category') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Category ID required'], 400);
            $check = $db->prepare("SELECT COUNT(*) FROM expenses WHERE category_id = ?");
            $check->execute([$id]);
            if ((int)$check->fetchColumn() > 0) {
                jsonResponse(['error' => 'Cannot delete category that has expenses. Deactivate it instead.'], 400);
            }
            $db->prepare("DELETE FROM expense_categories WHERE id = ?")->execute([$id]);
            jsonResponse(['message' => 'Expense category deleted']);
        }

        // --- DELETE EXPENSE ---
        if ($action === 'expense') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Expense ID required'], 400);
            $db->prepare("DELETE FROM expenses WHERE id = ?")->execute([$id]);
            jsonResponse(['message' => 'Expense deleted']);
        }

        // --- DELETE BUDGET ---
        if ($action === 'budget') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Budget ID required'], 400);
            $db->prepare("DELETE FROM budgets WHERE id = ?")->execute([$id]);
            jsonResponse(['message' => 'Budget deleted']);
        }

        // --- DELETE DONATION ---
        requireRole($currentUser, ['pastor', 'admin']);
        if (!$id) jsonResponse(['error' => 'Donation ID required'], 400);
        $db->prepare("DELETE FROM donations WHERE id = ?")->execute([$id]);
        jsonResponse(['message' => 'Donation deleted']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
