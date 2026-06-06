<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = getDB();

// Calculate account balance from actual transactions (single source of truth)
function calcAccountBalance($db, $accountId, $upToDate = null) {
    $accStmt = $db->prepare("SELECT opening_balance FROM accounts WHERE id = ?");
    $accStmt->execute([$accountId]);
    $opening = (float)$accStmt->fetchColumn();

    $dateCond = $upToDate ? " AND donation_date <= '$upToDate'" : "";
    $donations = (float)$db->query("SELECT COALESCE(SUM(amount), 0) FROM donations WHERE routed_account_id = $accountId $dateCond")->fetchColumn();

    $dateCond2 = $upToDate ? " AND expense_date <= '$upToDate'" : "";
    $expenses = 0;
    try { $expenses = (float)$db->query("SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE source_account_id = $accountId $dateCond2")->fetchColumn(); } catch (Exception $e) {}

    $dateCond3 = $upToDate ? " AND entry_date <= '$upToDate'" : "";
    $ledger = 0;
    try { $ledger = (float)$db->query("SELECT COALESCE(SUM(amount), 0) FROM account_ledger WHERE account_id = $accountId AND entry_type != 'opening' AND reference_type != 'donation' AND reference_type != 'expense' $dateCond3")->fetchColumn(); } catch (Exception $e) {}

    return $opening + $donations - $expenses + $ledger;
}

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

            // Recalculate balances for asset/liability leaf accounts
            foreach ($accounts as &$acc) {
                if (in_array($acc['account_type'], ['asset', 'liability']) && (int)$acc['child_count'] === 0 && $acc['parent_id']) {
                    $acc['current_balance'] = calcAccountBalance($db, (int)$acc['id']);
                }
            }
            unset($acc);

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

        // --- ACCOUNT TRANSACTIONS ---
        if ($action === 'account_transactions') {
            if (!$id) jsonResponse(['error' => 'Account ID required'], 400);
            $dateFrom = $_GET['date_from'] ?? date('Y-01-01');
            $dateTo = $_GET['date_to'] ?? date('Y-12-31');

            $stmt = $db->prepare("SELECT * FROM accounts WHERE id = ?");
            $stmt->execute([$id]);
            $account = $stmt->fetch();
            if (!$account) jsonResponse(['error' => 'Account not found'], 404);

            // Calculate balance from formula
            $account['current_balance'] = calcAccountBalance($db, $id);

            $transactions = [];

            // Routed donations
            try {
                $routedStmt = $db->prepare("
                    SELECT d.donation_date, d.amount,
                        CONCAT(dc.name, ' - ', COALESCE(CONCAT(m.first_name, ' ', m.last_name), d.donor_name, 'Anonymous'),
                            ' (', d.payment_method, ')') as description
                    FROM donations d
                    JOIN donation_categories dc ON dc.id = d.category_id
                    LEFT JOIN members m ON m.id = d.member_id
                    WHERE d.routed_account_id = ? AND d.donation_date BETWEEN ? AND ?
                    ORDER BY d.donation_date DESC
                ");
                $routedStmt->execute([$id, $dateFrom, $dateTo]);
                foreach ($routedStmt->fetchAll() as $d) {
                    $transactions[] = [
                        'type' => 'deposit',
                        'date' => $d['donation_date'],
                        'description' => $d['description'],
                        'amount' => (float)$d['amount'],
                        'reference' => '',
                        'notes' => '',
                        'created_by' => '',
                    ];
                }
            } catch (Exception $e) {}

            // Expenses paid from this account
            try {
                $expStmt = $db->prepare("
                    SELECT e.expense_date as donation_date, -e.amount as amount,
                        CONCAT(ec.name, ' - ', COALESCE(e.vendor, 'Expense')) as description
                    FROM expenses e
                    JOIN expense_categories ec ON ec.id = e.category_id
                    WHERE e.source_account_id = ? AND e.expense_date BETWEEN ? AND ?
                    ORDER BY e.expense_date DESC
                ");
                $expStmt->execute([$id, $dateFrom, $dateTo]);
                foreach ($expStmt->fetchAll() as $d) {
                    $transactions[] = [
                        'type' => 'withdrawal',
                        'date' => $d['donation_date'],
                        'description' => $d['description'],
                        'amount' => (float)$d['amount'],
                        'reference' => '',
                        'notes' => '',
                        'created_by' => '',
                    ];
                }
            } catch (Exception $e) {}

            // Transfer ledger entries (exclude donation/expense refs)
            try {
                $ledgerStmt = $db->prepare("
                    SELECT al.*, u.name as created_by_name
                    FROM account_ledger al
                    LEFT JOIN users u ON u.id = al.created_by
                    WHERE al.account_id = ?
                    AND al.entry_date BETWEEN ? AND ?
                    AND al.entry_type != 'opening'
                    AND al.reference_type NOT IN ('donation', 'expense')
                    ORDER BY al.entry_date DESC
                ");
                $ledgerStmt->execute([$id, $dateFrom, $dateTo]);
                foreach ($ledgerStmt->fetchAll() as $entry) {
                    $transactions[] = [
                        'type' => $entry['entry_type'],
                        'date' => $entry['entry_date'],
                        'description' => $entry['description'],
                        'amount' => (float)$entry['amount'],
                        'reference' => '',
                        'notes' => '',
                        'created_by' => $entry['created_by_name'] ?? '',
                    ];
                }
            } catch (Exception $e) {}

            usort($transactions, function($a, $b) { return strcmp($b['date'], $a['date']); });

            jsonResponse([
                'account' => $account,
                'transactions' => $transactions,
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
            ]);
        }

        // --- BALANCE SHEET ---
        if ($action === 'balance_sheet') {
            $dateFrom = $_GET['date_from'] ?? null;
            $dateTo = $_GET['date_to'] ?? $_GET['as_of'] ?? date('Y-m-d');
            if (!$dateFrom) {
                $dateFrom = substr($dateTo, 0, 4) . '-01-01';
            }

            $fetchAccounts = function($type) use ($db) {
                return $db->query("
                    SELECT a.*, (SELECT COUNT(*) FROM accounts c WHERE c.parent_id = a.id) as child_count
                    FROM accounts a WHERE a.account_type = '$type' AND a.is_active = 1
                    ORDER BY a.sort_order ASC
                ")->fetchAll();
            };

            $assets = $fetchAccounts('asset');
            $liabilities = $fetchAccounts('liability');
            $equity = $fetchAccounts('equity');

            $calcBalance = function(&$accounts) use ($db, $dateTo) {
                foreach ($accounts as &$acc) {
                    if ((int)$acc['child_count'] === 0 && $acc['parent_id']) {
                        $acc['calculated_balance'] = calcAccountBalance($db, (int)$acc['id'], $dateTo);
                    } else {
                        $acc['calculated_balance'] = 0;
                    }
                }
                unset($acc);
            };

            $calcBalance($assets);
            $calcBalance($liabilities);
            $calcBalance($equity);

            $totalAssets = 0;
            $totalLiabilities = 0;
            $totalEquity = 0;
            foreach ($assets as $a) {
                if ($a['parent_id'] && (int)$a['child_count'] === 0) $totalAssets += $a['calculated_balance'];
            }
            foreach ($liabilities as $l) {
                if ($l['parent_id'] && (int)$l['child_count'] === 0) $totalLiabilities += $l['calculated_balance'];
            }
            foreach ($equity as $e) {
                if ($e['parent_id'] && (int)$e['child_count'] === 0) $totalEquity += $e['calculated_balance'];
            }

            $netAssets = $totalAssets - $totalLiabilities;

            $incStmt = $db->prepare("SELECT COALESCE(SUM(amount), 0) FROM donations WHERE donation_date BETWEEN ? AND ?");
            $incStmt->execute([$dateFrom, $dateTo]);
            $periodIncome = (float)$incStmt->fetchColumn();
            $periodExpenses = 0;
            try {
                $expStmt = $db->prepare("SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE expense_date BETWEEN ? AND ?");
                $expStmt->execute([$dateFrom, $dateTo]);
                $periodExpenses = (float)$expStmt->fetchColumn();
            } catch (Exception $e) {}
            $periodNetIncome = $periodIncome - $periodExpenses;

            jsonResponse([
                'assets' => $assets,
                'liabilities' => $liabilities,
                'equity' => $equity,
                'total_assets' => $totalAssets,
                'total_liabilities' => $totalLiabilities,
                'total_equity' => $totalEquity,
                'net_assets' => $netAssets,
                'period_income' => $periodIncome,
                'period_expenses' => $periodExpenses,
                'period_net_income' => $periodNetIncome,
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
            ]);
        }

        // --- ACCOUNT REPORT (ledger + donation/expense based) ---
        if ($action === 'account_report') {
            if (!$id) jsonResponse(['error' => 'Account ID required'], 400);
            $dateFrom = $_GET['date_from'] ?? date('Y-01-01');
            $dateTo = $_GET['date_to'] ?? date('Y-12-31');

            $stmt = $db->prepare("SELECT * FROM accounts WHERE id = ?");
            $stmt->execute([$id]);
            $account = $stmt->fetch();
            if (!$account) jsonResponse(['error' => 'Account not found'], 404);

            $entries = [];
            $openingBalance = 0;

            if ($account['account_type'] === 'income') {
                // For income accounts, find matching donation category and pull donations
                $catName = $account['name'];
                $catStmt = $db->prepare("SELECT id FROM donation_categories WHERE name = ? LIMIT 1");
                $catStmt->execute([$catName]);
                $catId = $catStmt->fetchColumn();

                if ($catId) {
                    $openStmt = $db->prepare("SELECT COALESCE(SUM(amount), 0) FROM donations WHERE category_id = ? AND donation_date < ?");
                    $openStmt->execute([$catId, $dateFrom]);
                    $openingBalance = (float)$openStmt->fetchColumn();

                    $donStmt = $db->prepare("
                        SELECT d.id, d.donation_date as entry_date, 'donation' as entry_type, d.amount,
                            CONCAT(COALESCE(CONCAT(m.first_name, ' ', m.last_name), d.donor_name, 'Anonymous'), ' - ', d.payment_method) as description,
                            u.name as created_by_name, 'donation' as source, 'donation' as reference_type, d.id as reference_id
                        FROM donations d
                        LEFT JOIN members m ON m.id = d.member_id
                        LEFT JOIN users u ON u.id = d.recorded_by
                        WHERE d.category_id = ? AND d.donation_date BETWEEN ? AND ?
                        ORDER BY d.donation_date ASC, d.id ASC
                    ");
                    $donStmt->execute([$catId, $dateFrom, $dateTo]);
                    $entries = $donStmt->fetchAll();
                }
            } elseif ($account['account_type'] === 'expense') {
                // For expense accounts, find matching expense category and pull expenses
                $catName = $account['name'];
                $catStmt = $db->prepare("SELECT id FROM expense_categories WHERE name = ? LIMIT 1");
                $catStmt->execute([$catName]);
                $catId = $catStmt->fetchColumn();

                if ($catId) {
                    $openStmt = $db->prepare("SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE category_id = ? AND expense_date < ?");
                    $openStmt->execute([$catId, $dateFrom]);
                    $openingBalance = (float)$openStmt->fetchColumn();

                    $expStmt = $db->prepare("
                        SELECT e.id, e.expense_date as entry_date, 'expense' as entry_type, e.amount,
                            CONCAT(COALESCE(e.vendor, ''), ' - ', COALESCE(e.description, '')) as description,
                            u.name as created_by_name, 'expense' as source, 'expense' as reference_type, e.id as reference_id
                        FROM expenses e
                        LEFT JOIN users u ON u.id = e.recorded_by
                        WHERE e.category_id = ? AND e.expense_date BETWEEN ? AND ?
                        ORDER BY e.expense_date ASC, e.id ASC
                    ");
                    $expStmt->execute([$catId, $dateFrom, $dateTo]);
                    $entries = $expStmt->fetchAll();
                }
            } else {
                // For asset/liability/equity accounts
                // Opening balance = calculated balance as of day before period start
                $dayBefore = date('Y-m-d', strtotime($dateFrom . ' -1 day'));
                $openingBalance = calcAccountBalance($db, $id, $dayBefore);

                $entries = [];

                // Routed donations in period
                try {
                    $routedStmt = $db->prepare("
                        SELECT d.id, d.donation_date as entry_date, 'deposit' as entry_type, d.amount,
                            CONCAT(dc.name, ' - ', COALESCE(CONCAT(m.first_name, ' ', m.last_name), d.donor_name, 'Anonymous'),
                                ' (', d.payment_method, ')') as description,
                            u.name as created_by_name,
                            'donation' as source, 'donation' as reference_type, d.id as reference_id
                        FROM donations d
                        JOIN donation_categories dc ON dc.id = d.category_id
                        LEFT JOIN members m ON m.id = d.member_id
                        LEFT JOIN users u ON u.id = d.recorded_by
                        WHERE d.routed_account_id = ? AND d.donation_date BETWEEN ? AND ?
                        ORDER BY d.donation_date ASC
                    ");
                    $routedStmt->execute([$id, $dateFrom, $dateTo]);
                    $entries = array_merge($entries, $routedStmt->fetchAll());
                } catch (Exception $e) {}

                // Expenses paid from this account in period
                try {
                    $expFromStmt = $db->prepare("
                        SELECT e.id, e.expense_date as entry_date, 'withdrawal' as entry_type, -e.amount as amount,
                            CONCAT(COALESCE(e.vendor, ''), ' - ', ec.name) as description,
                            u.name as created_by_name,
                            'expense' as source, 'expense' as reference_type, e.id as reference_id
                        FROM expenses e
                        JOIN expense_categories ec ON ec.id = e.category_id
                        LEFT JOIN users u ON u.id = e.recorded_by
                        WHERE e.source_account_id = ? AND e.expense_date BETWEEN ? AND ?
                        ORDER BY e.expense_date ASC
                    ");
                    $expFromStmt->execute([$id, $dateFrom, $dateTo]);
                    $entries = array_merge($entries, $expFromStmt->fetchAll());
                } catch (Exception $e) {}

                // Transfer ledger entries (exclude donation/expense refs - already covered above)
                try {
                    $ledgerStmt = $db->prepare("
                        SELECT al.id, al.entry_date, al.entry_type, al.amount, al.description,
                            al.reference_type, al.reference_id, u.name as created_by_name,
                            'ledger' as source
                        FROM account_ledger al
                        LEFT JOIN users u ON u.id = al.created_by
                        WHERE al.account_id = ? AND al.entry_date BETWEEN ? AND ?
                        AND al.entry_type != 'opening'
                        AND al.reference_type NOT IN ('donation', 'expense')
                        ORDER BY al.entry_date ASC, al.id ASC
                    ");
                    $ledgerStmt->execute([$id, $dateFrom, $dateTo]);
                    $entries = array_merge($entries, $ledgerStmt->fetchAll());
                } catch (Exception $e) {}

                usort($entries, function($a, $b) { return strcmp($a['entry_date'], $b['entry_date']); });
            }

            $periodIn = 0;
            $periodOut = 0;
            foreach ($entries as $e) {
                $amt = (float)$e['amount'];
                if ($amt >= 0) $periodIn += $amt;
                else $periodOut += $amt;
            }

            $endingBalance = $openingBalance + $periodIn + $periodOut;

            jsonResponse([
                'account' => $account,
                'entries' => $entries,
                'opening_balance' => $openingBalance,
                'period_in' => $periodIn,
                'period_out' => abs($periodOut),
                'ending_balance' => $endingBalance,
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
            ]);
        }

        // --- PLEDGES ---
        if ($action === 'pledges') {
            $status = $_GET['status'] ?? 'active';
            $memberId = $_GET['member_id'] ?? '';

            $where = ['p.status = ?'];
            $params = [$status];
            if ($memberId) { $where[] = 'p.member_id = ?'; $params[] = (int)$memberId; }

            $whereClause = implode(' AND ', $where);
            $stmt = $db->prepare("
                SELECT p.*, m.first_name, m.last_name, dc.name as category_name,
                    u.name as created_by_name
                FROM pledges p
                JOIN members m ON m.id = p.member_id
                JOIN donation_categories dc ON dc.id = p.category_id
                LEFT JOIN users u ON u.id = p.created_by
                WHERE $whereClause
                ORDER BY p.start_date DESC
            ");
            $stmt->execute($params);
            $pledges = $stmt->fetchAll();

            // Calculate fulfillment for each pledge
            foreach ($pledges as &$pledge) {
                $totalPaid = (float)$db->prepare("
                    SELECT COALESCE(SUM(amount), 0) FROM donations
                    WHERE member_id = ? AND category_id = ?
                    AND donation_date >= ? AND donation_date <= COALESCE(?, CURDATE())
                ")->execute([$pledge['member_id'], $pledge['category_id'], $pledge['start_date'], $pledge['end_date']]) ?
                    (float)$db->query("SELECT COALESCE(SUM(amount), 0) FROM donations WHERE member_id = {$pledge['member_id']} AND category_id = {$pledge['category_id']} AND donation_date >= '{$pledge['start_date']}'" . ($pledge['end_date'] ? " AND donation_date <= '{$pledge['end_date']}'" : ""))->fetchColumn() : 0;

                $startDate = new DateTime($pledge['start_date']);
                $endDate = $pledge['end_date'] ? new DateTime($pledge['end_date']) : new DateTime();
                $now = new DateTime();
                $effectiveEnd = min($endDate, $now);

                $expectedPayments = 0;
                switch ($pledge['frequency']) {
                    case 'weekly':
                        $expectedPayments = max(1, floor($startDate->diff($effectiveEnd)->days / 7));
                        break;
                    case 'monthly':
                        $expectedPayments = max(1, ($effectiveEnd->format('Y') - $startDate->format('Y')) * 12 + $effectiveEnd->format('n') - $startDate->format('n') + 1);
                        break;
                    case 'quarterly':
                        $months = ($effectiveEnd->format('Y') - $startDate->format('Y')) * 12 + $effectiveEnd->format('n') - $startDate->format('n') + 1;
                        $expectedPayments = max(1, ceil($months / 3));
                        break;
                    case 'annually':
                        $expectedPayments = max(1, $effectiveEnd->format('Y') - $startDate->format('Y') + 1);
                        break;
                }

                $expectedTotal = (float)$pledge['amount'] * $expectedPayments;
                $pledge['total_paid'] = $totalPaid;
                $pledge['expected_total'] = $expectedTotal;
                $pledge['expected_payments'] = $expectedPayments;
                $pledge['fulfillment_pct'] = $expectedTotal > 0 ? round(($totalPaid / $expectedTotal) * 100, 1) : 0;
                $pledge['is_behind'] = $totalPaid < $expectedTotal;
            }
            unset($pledge);

            jsonResponse(['pledges' => $pledges]);
        }

        // --- PLEDGE ALERTS (for dashboard) ---
        if ($action === 'pledge_alerts') {
            try {
                $behindPledges = $db->query("
                    SELECT p.id, p.member_id, p.amount, p.frequency, p.start_date,
                        m.first_name, m.last_name, dc.name as category_name,
                        COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.member_id = p.member_id AND d.category_id = p.category_id AND d.donation_date >= p.start_date), 0) as total_paid
                    FROM pledges p
                    JOIN members m ON m.id = p.member_id
                    JOIN donation_categories dc ON dc.id = p.category_id
                    WHERE p.status = 'active'
                    ORDER BY m.last_name, m.first_name
                ")->fetchAll();

                $alerts = [];
                foreach ($behindPledges as $p) {
                    $startDate = new DateTime($p['start_date']);
                    $now = new DateTime();
                    $monthsElapsed = max(1, ($now->format('Y') - $startDate->format('Y')) * 12 + $now->format('n') - $startDate->format('n') + 1);

                    $expectedPayments = $monthsElapsed;
                    if ($p['frequency'] === 'weekly') $expectedPayments = max(1, floor($startDate->diff($now)->days / 7));
                    if ($p['frequency'] === 'quarterly') $expectedPayments = max(1, ceil($monthsElapsed / 3));
                    if ($p['frequency'] === 'annually') $expectedPayments = max(1, $now->format('Y') - $startDate->format('Y') + 1);

                    $expectedTotal = (float)$p['amount'] * $expectedPayments;
                    $totalPaid = (float)$p['total_paid'];

                    if ($totalPaid < $expectedTotal) {
                        $alerts[] = [
                            'member_name' => $p['first_name'] . ' ' . $p['last_name'],
                            'category' => $p['category_name'],
                            'expected' => $expectedTotal,
                            'paid' => $totalPaid,
                            'behind_by' => $expectedTotal - $totalPaid,
                            'frequency' => $p['frequency'],
                            'pledge_amount' => (float)$p['amount'],
                        ];
                    }
                }
                jsonResponse(['alerts' => $alerts, 'count' => count($alerts)]);
            } catch (Exception $e) {
                jsonResponse(['alerts' => [], 'count' => 0]);
            }
        }

        // --- ROUTING RULES ---
        if ($action === 'routing_rules') {
            try {
                $stmt = $db->query("
                    SELECT pr.*, a.name as account_name, dc.name as category_name
                    FROM payment_routing pr
                    LEFT JOIN accounts a ON a.id = pr.account_id
                    LEFT JOIN donation_categories dc ON dc.id = pr.category_id
                    ORDER BY pr.payment_method ASC, pr.category_id ASC
                ");
                $rules = $stmt->fetchAll();
                jsonResponse(['rules' => $rules]);
            } catch (Exception $e) {
                jsonResponse(['rules' => [], 'note' => 'payment_routing table may not exist yet']);
            }
        }

        // --- GENERAL JOURNAL ---
        if ($action === 'journal') {
            $dateFrom = $_GET['date_from'] ?? date('Y-m-01');
            $dateTo = $_GET['date_to'] ?? date('Y-m-d');
            $page = max(1, (int)($_GET['page'] ?? 1));
            $limit = 50;
            $offset = ($page - 1) * $limit;

            $entries = [];

            // Donations
            $stmt = $db->prepare("
                SELECT d.id, d.donation_date as date, 'donation' as type,
                    CONCAT(dc.name, ' - ', COALESCE(CONCAT(m.first_name,' ',m.last_name), d.donor_name, 'Anonymous')) as description,
                    d.amount, d.payment_method, u.name as recorded_by
                FROM donations d
                JOIN donation_categories dc ON dc.id = d.category_id
                LEFT JOIN members m ON m.id = d.member_id
                LEFT JOIN users u ON u.id = d.recorded_by
                WHERE d.donation_date BETWEEN ? AND ?
                ORDER BY d.donation_date DESC, d.created_at DESC
            ");
            $stmt->execute([$dateFrom, $dateTo]);
            foreach ($stmt->fetchAll() as $r) {
                $entries[] = [
                    'date' => $r['date'],
                    'type' => 'Income',
                    'source' => 'donation',
                    'record_id' => (int)$r['id'],
                    'description' => $r['description'],
                    'debit' => (float)$r['amount'],
                    'credit' => 0,
                    'method' => $r['payment_method'],
                    'recorded_by' => $r['recorded_by'],
                ];
            }

            // Expenses
            try {
                $stmt = $db->prepare("
                    SELECT e.id, e.expense_date as date, 'expense' as type,
                        CONCAT(ec.name, COALESCE(CONCAT(' - ', e.vendor), '')) as description,
                        e.amount, e.payment_method, u.name as recorded_by, e.status
                    FROM expenses e
                    JOIN expense_categories ec ON ec.id = e.category_id
                    LEFT JOIN users u ON u.id = e.recorded_by
                    WHERE e.expense_date BETWEEN ? AND ?
                    ORDER BY e.expense_date DESC, e.created_at DESC
                ");
                $stmt->execute([$dateFrom, $dateTo]);
                foreach ($stmt->fetchAll() as $r) {
                    $entries[] = [
                        'date' => $r['date'],
                        'type' => 'Expense',
                        'source' => 'expense',
                        'record_id' => (int)$r['id'],
                        'description' => $r['description'],
                        'debit' => 0,
                        'credit' => (float)$r['amount'],
                        'method' => $r['payment_method'],
                        'recorded_by' => $r['recorded_by'],
                    ];
                }
            } catch (Exception $e) {}

            // Transfers
            try {
                $stmt = $db->prepare("
                    SELECT t.*, u.name as created_by_name,
                        fa.name as from_name, ta.name as to_name
                    FROM account_transfers t
                    LEFT JOIN users u ON u.id = t.created_by
                    LEFT JOIN accounts fa ON fa.id = t.from_account_id
                    LEFT JOIN accounts ta ON ta.id = t.to_account_id
                    WHERE t.transfer_date BETWEEN ? AND ?
                    ORDER BY t.transfer_date DESC
                ");
                $stmt->execute([$dateFrom, $dateTo]);
                foreach ($stmt->fetchAll() as $r) {
                    $entries[] = [
                        'date' => $r['transfer_date'],
                        'type' => 'Transfer',
                        'source' => 'transfer',
                        'record_id' => (int)$r['id'],
                        'description' => 'Transfer: ' . $r['from_name'] . ' → ' . $r['to_name'],
                        'debit' => (float)$r['amount'],
                        'credit' => (float)$r['amount'],
                        'method' => '',
                        'recorded_by' => $r['created_by_name'],
                    ];
                }
            } catch (Exception $e) {}

            usort($entries, function($a, $b) { return strcmp($b['date'], $a['date']); });

            $totalDebit = array_sum(array_column($entries, 'debit'));
            $totalCredit = array_sum(array_column($entries, 'credit'));
            $totalEntries = count($entries);
            $pagedEntries = array_slice($entries, $offset, $limit);

            jsonResponse([
                'entries' => $pagedEntries,
                'total' => $totalEntries,
                'total_debit' => $totalDebit,
                'total_credit' => $totalCredit,
                'page' => $page,
                'pages' => max(1, ceil($totalEntries / $limit)),
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
            ]);
        }

        // --- TRANSFERS LIST ---
        if ($action === 'transfers') {
            $dateFrom = $_GET['date_from'] ?? date('Y-01-01');
            $dateTo = $_GET['date_to'] ?? date('Y-12-31');
            try {
                $stmt = $db->prepare("
                    SELECT t.*, u.name as created_by_name,
                        fa.name as from_account_name, ta.name as to_account_name
                    FROM account_transfers t
                    LEFT JOIN users u ON u.id = t.created_by
                    LEFT JOIN accounts fa ON fa.id = t.from_account_id
                    LEFT JOIN accounts ta ON ta.id = t.to_account_id
                    WHERE t.transfer_date BETWEEN ? AND ?
                    ORDER BY t.transfer_date DESC
                ");
                $stmt->execute([$dateFrom, $dateTo]);
                jsonResponse(['transfers' => $stmt->fetchAll()]);
            } catch (Exception $e) {
                jsonResponse(['transfers' => [], 'note' => 'transfers table may not exist yet']);
            }
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
        // --- CREATE PLEDGE ---
        if ($action === 'pledge') {
            $data = getRequestBody();
            if (empty($data['member_id']) || empty($data['category_id']) || empty($data['amount']) || empty($data['start_date'])) {
                jsonResponse(['error' => 'member_id, category_id, amount, and start_date are required'], 400);
            }
            $stmt = $db->prepare("
                INSERT INTO pledges (member_id, category_id, amount, frequency, start_date, end_date, notes, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                (int)$data['member_id'],
                (int)$data['category_id'],
                (float)$data['amount'],
                $data['frequency'] ?? 'monthly',
                $data['start_date'],
                $data['end_date'] ?? null,
                $data['notes'] ?? null,
                $currentUser['user_id'],
            ]);
            jsonResponse(['message' => 'Pledge created', 'id' => (int)$db->lastInsertId()], 201);
        }

        // --- TRANSFER BETWEEN ACCOUNTS ---
        if ($action === 'transfer') {
            $data = getRequestBody();
            if (empty($data['from_account_id']) || empty($data['to_account_id']) || empty($data['amount']) || empty($data['transfer_date'])) {
                jsonResponse(['error' => 'from_account_id, to_account_id, amount, and transfer_date are required'], 400);
            }
            if ((float)$data['amount'] <= 0) jsonResponse(['error' => 'Amount must be positive'], 400);
            if ($data['from_account_id'] == $data['to_account_id']) jsonResponse(['error' => 'Cannot transfer to the same account'], 400);

            $amount = (float)$data['amount'];
            $db->beginTransaction();
            try {
                $db->prepare("INSERT INTO account_transfers (from_account_id, to_account_id, amount, transfer_date, reference_number, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
                    ->execute([
                        (int)$data['from_account_id'],
                        (int)$data['to_account_id'],
                        $amount,
                        $data['transfer_date'],
                        $data['reference_number'] ?? null,
                        $data['notes'] ?? null,
                        $currentUser['user_id'],
                    ]);
                $transferId = (int)$db->lastInsertId();

                $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")->execute([$amount, (int)$data['from_account_id']]);
                $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?")->execute([$amount, (int)$data['to_account_id']]);

                // Create ledger entries for both accounts
                $fromAcct = $db->prepare("SELECT name FROM accounts WHERE id = ?")->execute([(int)$data['from_account_id']]) ? $db->query("SELECT name FROM accounts WHERE id = " . (int)$data['from_account_id'])->fetchColumn() : '';
                $toAcct = $db->prepare("SELECT name FROM accounts WHERE id = ?")->execute([(int)$data['to_account_id']]) ? $db->query("SELECT name FROM accounts WHERE id = " . (int)$data['to_account_id'])->fetchColumn() : '';

                $ledgerStmt = $db->prepare("INSERT INTO account_ledger (account_id, entry_date, entry_type, amount, description, reference_type, reference_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
                // Debit from source (negative)
                $ledgerStmt->execute([
                    (int)$data['from_account_id'],
                    $data['transfer_date'],
                    'withdrawal',
                    -$amount,
                    'Transfer to ' . $toAcct,
                    'transfer',
                    $transferId,
                    $currentUser['user_id'],
                ]);
                // Credit to destination (positive)
                $ledgerStmt->execute([
                    (int)$data['to_account_id'],
                    $data['transfer_date'],
                    'deposit',
                    $amount,
                    'Transfer from ' . $fromAcct,
                    'transfer',
                    $transferId,
                    $currentUser['user_id'],
                ]);

                $db->commit();
                jsonResponse(['message' => 'Transfer completed'], 201);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Transfer failed: ' . $e->getMessage()], 500);
            }
        }

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
                $catId = (int)$db->lastInsertId();

                // Auto-create matching account in Chart of Accounts
                $incomeParent = $db->query("SELECT id FROM accounts WHERE account_type = 'income' AND parent_id IS NULL LIMIT 1")->fetchColumn();
                if ($incomeParent) {
                    $maxAcctOrder = (int)$db->query("SELECT COALESCE(MAX(sort_order), 0) FROM accounts WHERE account_type = 'income'")->fetchColumn() + 1;
                    $nextNum = (int)$db->query("SELECT COALESCE(MAX(CAST(account_number AS UNSIGNED)), 4000) FROM accounts WHERE account_type = 'income'")->fetchColumn() + 100;
                    $db->prepare("INSERT INTO accounts (parent_id, account_type, account_number, name, description, fund_type, sort_order) VALUES (?, 'income', ?, ?, ?, ?, ?)")
                        ->execute([$incomeParent, (string)$nextNum, $name, $data['description'] ?? null, $data['fund_type'] ?? 'general', $maxAcctOrder]);
                }

                jsonResponse(['message' => 'Category created', 'id' => $catId], 201);
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
                $catId = (int)$db->lastInsertId();

                // Auto-create matching account in Chart of Accounts
                $expenseParent = $db->query("SELECT id FROM accounts WHERE account_type = 'expense' AND parent_id IS NULL LIMIT 1")->fetchColumn();
                if ($expenseParent) {
                    $maxAcctOrder = (int)$db->query("SELECT COALESCE(MAX(sort_order), 0) FROM accounts WHERE account_type = 'expense'")->fetchColumn() + 1;
                    $nextNum = (int)$db->query("SELECT COALESCE(MAX(CAST(account_number AS UNSIGNED)), 5000) FROM accounts WHERE account_type = 'expense'")->fetchColumn() + 100;
                    $db->prepare("INSERT INTO accounts (parent_id, account_type, account_number, name, description, fund_type, sort_order) VALUES (?, 'expense', ?, ?, ?, ?, ?)")
                        ->execute([$expenseParent, (string)$nextNum, $name, $data['description'] ?? null, $data['fund_type'] ?? 'general', $maxAcctOrder]);
                }

                jsonResponse(['message' => 'Expense category created', 'id' => $catId], 201);
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

            $amount = (float)$data['amount'];
            $sourceAccountId = !empty($data['source_account_id']) ? (int)$data['source_account_id'] : null;

            $stmt = $db->prepare("
                INSERT INTO expenses (category_id, amount, description, vendor, payment_method, reference_number, expense_date, receipt_note, recorded_by, source_account_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                (int)$data['category_id'],
                $amount,
                $data['description'] ?? null,
                $data['vendor'] ?? null,
                $data['payment_method'] ?? 'check',
                $data['reference_number'] ?? null,
                $data['expense_date'],
                $data['receipt_note'] ?? null,
                $currentUser['user_id'],
                $sourceAccountId,
            ]);
            $expenseId = (int)$db->lastInsertId();

            // Deduct from source bank account
            if ($sourceAccountId) {
                $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")
                    ->execute([$amount, $sourceAccountId]);
                $db->prepare("INSERT INTO account_ledger (account_id, entry_date, entry_type, amount, description, reference_type, reference_id, created_by) VALUES (?, ?, 'withdrawal', ?, ?, 'expense', ?, ?)")
                    ->execute([$sourceAccountId, $data['expense_date'], -$amount, ($data['vendor'] ?? '') . ' - ' . ($data['description'] ?? 'Expense'), $expenseId, $currentUser['user_id']]);
            }

            jsonResponse(['message' => 'Expense recorded', 'id' => $expenseId], 201);
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

        // --- CREATE/UPDATE ROUTING RULE ---
        if ($action === 'routing_rule') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            if (empty($data['payment_method']) || empty($data['account_id'])) {
                jsonResponse(['error' => 'payment_method and account_id are required'], 400);
            }

            $categoryId = !empty($data['category_id']) ? (int)$data['category_id'] : null;

            $stmt = $db->prepare("
                INSERT INTO payment_routing (payment_method, category_id, account_id)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE account_id = VALUES(account_id)
            ");
            $stmt->execute([
                $data['payment_method'],
                $categoryId,
                (int)$data['account_id'],
            ]);

            jsonResponse(['message' => 'Routing rule saved'], 201);
        }

        // --- LOAN TRANSACTION ---
        if ($action === 'loan_transaction') {
            $data = getRequestBody();
            if (empty($data['liability_account_id']) || empty($data['asset_account_id']) || empty($data['amount']) || empty($data['transaction_date']) || empty($data['transaction_type'])) {
                jsonResponse(['error' => 'liability_account_id, asset_account_id, amount, transaction_date, and transaction_type are required'], 400);
            }
            $amount = (float)$data['amount'];
            if ($amount <= 0) jsonResponse(['error' => 'Amount must be positive'], 400);

            $type = $data['transaction_type'];
            if (!in_array($type, ['loan_received', 'loan_payment'])) {
                jsonResponse(['error' => 'transaction_type must be loan_received or loan_payment'], 400);
            }

            $liabilityId = (int)$data['liability_account_id'];
            $assetId = (int)$data['asset_account_id'];
            $txDate = $data['transaction_date'];
            $description = $data['description'] ?? ($type === 'loan_received' ? 'Loan received' : 'Loan payment');
            $refNumber = $data['reference_number'] ?? null;

            $db->beginTransaction();
            try {
                $ledgerStmt = $db->prepare("INSERT INTO account_ledger (account_id, entry_date, entry_type, amount, description, reference_type, reference_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

                if ($type === 'loan_received') {
                    // Increase liability (positive on liability account)
                    $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?")->execute([$amount, $liabilityId]);
                    $ledgerStmt->execute([$liabilityId, $txDate, 'deposit', $amount, $description, 'loan', null, $currentUser['user_id']]);

                    // Increase asset (positive on asset account)
                    $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?")->execute([$amount, $assetId]);
                    $ledgerStmt->execute([$assetId, $txDate, 'deposit', $amount, $description, 'loan', null, $currentUser['user_id']]);
                } else {
                    // loan_payment: decrease liability
                    $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")->execute([$amount, $liabilityId]);
                    $ledgerStmt->execute([$liabilityId, $txDate, 'withdrawal', -$amount, $description, 'loan_payment', null, $currentUser['user_id']]);

                    // Decrease asset
                    $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")->execute([$amount, $assetId]);
                    $ledgerStmt->execute([$assetId, $txDate, 'withdrawal', -$amount, $description, 'loan_payment', null, $currentUser['user_id']]);
                }

                $db->commit();
                jsonResponse(['message' => 'Loan transaction recorded'], 201);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Loan transaction failed: ' . $e->getMessage()], 500);
            }
        }

        // --- SET OPENING BALANCE ---
        if ($action === 'opening_balance') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            if (empty($data['account_id']) || !isset($data['amount'])) {
                jsonResponse(['error' => 'account_id and amount are required'], 400);
            }

            $accountId = (int)$data['account_id'];
            $amount = (float)$data['amount'];

            try {
                // Set opening_balance only, then recalculate current_balance from transactions
                $db->prepare("UPDATE accounts SET opening_balance = ? WHERE id = ?")->execute([$amount, $accountId]);
                $newBalance = calcAccountBalance($db, $accountId);
                $db->prepare("UPDATE accounts SET current_balance = ? WHERE id = ?")->execute([$newBalance, $accountId]);

                jsonResponse(['message' => 'Opening balance set to ' . number_format($amount, 2) . '. Current balance: ' . number_format($newBalance, 2), 'current_balance' => $newBalance], 201);
            } catch (Exception $e) {
                jsonResponse(['error' => 'Failed: ' . $e->getMessage()], 500);
            }
        }

        // --- BULK DONATIONS ---
        if ($action === 'bulk') {
            $data = getRequestBody();
            $records = $data['records'] ?? [];
            if (empty($records)) jsonResponse(['error' => 'No records provided'], 400);

            // Load payment routing (with category-specific rules)
            $routing = [];
            $routingDefault = [];
            try {
                $routingRows = $db->query("SELECT payment_method, category_id, account_id FROM payment_routing")->fetchAll();
                foreach ($routingRows as $rr) {
                    if ($rr['category_id']) {
                        $routing[$rr['payment_method'] . '_' . $rr['category_id']] = (int)$rr['account_id'];
                    } else {
                        $routingDefault[$rr['payment_method']] = (int)$rr['account_id'];
                    }
                }
            } catch (Exception $e) {}

            $stmt = $db->prepare("
                INSERT INTO donations (member_id, service_id, category_id, amount, payment_method, reference_number, donor_name, notes, donation_date, recorded_by, routed_account_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");

            $ledgerStmt = $db->prepare("INSERT INTO account_ledger (account_id, entry_date, entry_type, amount, description, reference_type, reference_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

            $accountUpdates = [];
            $count = 0;
            foreach ($records as $r) {
                if (empty($r['amount']) || (float)$r['amount'] <= 0) continue;
                $method = $r['payment_method'] ?? 'cash';
                $categoryId = (int)$r['category_id'];
                // Manual deposit_to overrides automatic routing
                $routedAccountId = !empty($r['deposit_to']) ? (int)$r['deposit_to'] :
                    ($routing[$method . '_' . $categoryId] ?? $routingDefault[$method] ?? null);
                $amount = (float)$r['amount'];
                $donationDate = $r['donation_date'] ?? date('Y-m-d');

                $stmt->execute([
                    !empty($r['member_id']) ? (int)$r['member_id'] : null,
                    !empty($r['service_id']) ? (int)$r['service_id'] : null,
                    $categoryId,
                    $amount,
                    $method,
                    $r['reference_number'] ?? null,
                    $r['donor_name'] ?? null,
                    $r['notes'] ?? null,
                    $donationDate,
                    $currentUser['user_id'],
                    $routedAccountId,
                ]);
                $donationId = (int)$db->lastInsertId();

                if ($routedAccountId) {
                    if (!isset($accountUpdates[$routedAccountId])) $accountUpdates[$routedAccountId] = 0;
                    $accountUpdates[$routedAccountId] += $amount;

                    // Create ledger entry for the routed account
                    $donorName = $r['donor_name'] ?? 'Anonymous';
                    $ledgerStmt->execute([
                        $routedAccountId,
                        $donationDate,
                        'deposit',
                        $amount,
                        'Donation: ' . $donorName . ' (' . $method . ')',
                        'donation',
                        $donationId,
                        $currentUser['user_id'],
                    ]);
                }
                $count++;
            }

            // Update account balances
            $updateStmt = $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?");
            foreach ($accountUpdates as $accId => $total) {
                $updateStmt->execute([$total, $accId]);
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
        // --- PLEDGE UPDATE ---
        if ($action === 'pledge') {
            if (!$id) jsonResponse(['error' => 'Pledge ID required'], 400);
            $data = getRequestBody();
            $fields = [];
            $params = [];
            $allowed = ['amount', 'frequency', 'start_date', 'end_date', 'notes', 'status'];
            foreach ($allowed as $f) {
                if (array_key_exists($f, $data)) {
                    $fields[] = "$f = ?";
                    $params[] = $f === 'amount' ? (float)$data[$f] : $data[$f];
                }
            }
            if (empty($fields)) jsonResponse(['error' => 'Nothing to update'], 400);
            $params[] = $id;
            $db->prepare("UPDATE pledges SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
            jsonResponse(['message' => 'Pledge updated']);
        }

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

            $isFinanceAdmin = in_array($currentUser['role'], ['pastor', 'admin']);
            if (!$isFinanceAdmin) {
                $ageCheck = $db->prepare("SELECT created_at FROM expenses WHERE id = ?");
                $ageCheck->execute([$id]);
                $created = $ageCheck->fetchColumn();
                if ($created && strtotime($created) < strtotime('-24 hours')) {
                    jsonResponse(['error' => 'This record is older than 24 hours. Only the finance administrator can edit it.'], 403);
                }
            }

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

        // 24-hour edit lock: non-admin users can't edit records older than 24h
        $isFinanceAdmin = in_array($currentUser['role'], ['pastor', 'admin']);
        if (!$isFinanceAdmin) {
            $ageCheck = $db->prepare("SELECT created_at FROM donations WHERE id = ?");
            $ageCheck->execute([$id]);
            $created = $ageCheck->fetchColumn();
            if ($created && strtotime($created) < strtotime('-24 hours')) {
                jsonResponse(['error' => 'This record is older than 24 hours. Only the finance administrator can edit it.'], 403);
            }
        }

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
        // --- DELETE LEDGER ENTRY (and reverse balance + delete source record) ---
        if ($action === 'ledger_entry') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Ledger entry ID required'], 400);

            $entry = $db->prepare("SELECT * FROM account_ledger WHERE id = ?")->execute([$id]) ?
                $db->query("SELECT * FROM account_ledger WHERE id = $id")->fetch() : null;

            if (!$entry) jsonResponse(['error' => 'Ledger entry not found'], 404);

            $db->beginTransaction();
            try {
                // Reverse balance on account
                $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")
                    ->execute([(float)$entry['amount'], $entry['account_id']]);

                // Delete the ledger entry
                $db->prepare("DELETE FROM account_ledger WHERE id = ?")->execute([$id]);

                // If it references a donation, delete that too
                if ($entry['reference_type'] === 'donation' && $entry['reference_id']) {
                    $db->prepare("DELETE FROM donations WHERE id = ?")->execute([$entry['reference_id']]);
                }

                // If it references a transfer, delete the paired entry and reverse the other account
                if ($entry['reference_type'] === 'transfer' && $entry['reference_id']) {
                    $paired = $db->prepare("SELECT * FROM account_ledger WHERE reference_type = 'transfer' AND reference_id = ? AND id != ?");
                    $paired->execute([$entry['reference_id'], $id]);
                    $pairedEntry = $paired->fetch();
                    if ($pairedEntry) {
                        $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")
                            ->execute([(float)$pairedEntry['amount'], $pairedEntry['account_id']]);
                        $db->prepare("DELETE FROM account_ledger WHERE id = ?")->execute([$pairedEntry['id']]);
                    }
                    $db->prepare("DELETE FROM account_transfers WHERE id = ?")->execute([$entry['reference_id']]);
                }

                $db->commit();
                jsonResponse(['message' => 'Entry deleted and balance reversed']);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Failed: ' . $e->getMessage()], 500);
            }
        }

        // --- DELETE TRANSFER ---
        if ($action === 'transfer') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Transfer ID required'], 400);

            $transfer = $db->prepare("SELECT * FROM account_transfers WHERE id = ?");
            $transfer->execute([$id]);
            $t = $transfer->fetch();
            if (!$t) jsonResponse(['error' => 'Transfer not found'], 404);

            $db->beginTransaction();
            try {
                // Reverse balances
                $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?")
                    ->execute([(float)$t['amount'], $t['from_account_id']]);
                $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")
                    ->execute([(float)$t['amount'], $t['to_account_id']]);
                // Delete ledger entries
                $db->prepare("DELETE FROM account_ledger WHERE reference_type = 'transfer' AND reference_id = ?")->execute([$id]);
                // Delete transfer
                $db->prepare("DELETE FROM account_transfers WHERE id = ?")->execute([$id]);
                $db->commit();
                jsonResponse(['message' => 'Transfer deleted and balances reversed']);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Failed: ' . $e->getMessage()], 500);
            }
        }

        // --- DELETE ROUTED DONATION (from account report) ---
        if ($action === 'routed_donation') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Donation ID required'], 400);

            $donation = $db->prepare("SELECT * FROM donations WHERE id = ?");
            $donation->execute([$id]);
            $don = $donation->fetch();
            if (!$don) jsonResponse(['error' => 'Donation not found'], 404);

            $db->beginTransaction();
            try {
                // Reverse account balance if routed
                if ($don['routed_account_id']) {
                    $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")
                        ->execute([(float)$don['amount'], $don['routed_account_id']]);
                }
                // Delete associated ledger entries
                $db->prepare("DELETE FROM account_ledger WHERE reference_type = 'donation' AND reference_id = ?")->execute([$id]);
                // Delete the donation
                $db->prepare("DELETE FROM donations WHERE id = ?")->execute([$id]);
                $db->commit();
                jsonResponse(['message' => 'Donation and ledger entry deleted']);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Failed: ' . $e->getMessage()], 500);
            }
        }

        // --- DELETE PLEDGE ---
        if ($action === 'pledge') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Pledge ID required'], 400);
            $db->prepare("DELETE FROM pledges WHERE id = ?")->execute([$id]);
            jsonResponse(['message' => 'Pledge deleted']);
        }

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

        // --- DELETE ROUTING RULE ---
        if ($action === 'routing_rule') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Routing rule ID required'], 400);
            $db->prepare("DELETE FROM payment_routing WHERE id = ?")->execute([$id]);
            jsonResponse(['message' => 'Routing rule deleted']);
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
