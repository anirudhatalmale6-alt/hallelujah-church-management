<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

// Number of pledge payments DUE so far. Counts every period whose start date has
// arrived, INCLUDING the current in-progress one — a period's payment is due from
// the moment that period begins. So a member who has fully paid the current period
// is on track (0 behind), one who paid only part of it is behind by the remainder,
// and the next period isn't counted until it actually starts.
// e.g. a monthly pledge starting July 1: on any day in July, July's payment is due;
// August is not counted until August 1.
function pledgeExpectedPayments($frequency, $startDateStr, $endDateStr = null) {
    try {
        $start = new DateTime($startDateStr); $start->setTime(0, 0, 0);
    } catch (Exception $e) { return 0; }
    $now = new DateTime(); $now->setTime(0, 0, 0);
    $end = $now;
    if ($endDateStr && $endDateStr !== '0000-00-00') {
        try {
            $ed = new DateTime($endDateStr); $ed->setTime(0, 0, 0);
            if ($ed < $now) $end = $ed;
        } catch (Exception $e) { $end = $now; }
    }
    if ($end < $start) return 0; // pledge hasn't started yet
    $monthsElapsed = ($end->format('Y') - $start->format('Y')) * 12 + ((int)$end->format('n') - (int)$start->format('n'));
    // +1 so the current period counts from its start (not only completed periods).
    switch ($frequency) {
        case 'weekly':    return (int)floor($start->diff($end)->days / 7) + 1;
        case 'quarterly': return (int)floor($monthsElapsed / 3) + 1;
        case 'annually':  return (int)floor($monthsElapsed / 12) + 1;
        case 'monthly':
        default:          return (int)$monthsElapsed + 1;
    }
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

$currentUser = authenticate();
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

/**
 * When a donation is recorded for a named person who isn't a church member yet,
 * make sure that person exists in the People list so they can be searched,
 * texted, or emailed later. Returns a member_id to link the donation to, or
 * null if the name should stay a plain donor_name (blank, or a known
 * expense vendor / business such as "Amazon", "Twilio Inc").
 */
function ensurePersonForDonor($db, $donorName, $recordedBy) {
    $name = trim($donorName ?? '');
    if ($name === '') return null;

    // Don't turn expense vendors / businesses (refund sources) into people.
    try {
        $vs = $db->prepare("SELECT 1 FROM expenses WHERE LOWER(TRIM(vendor)) = LOWER(?) LIMIT 1");
        $vs->execute([$name]);
        if ($vs->fetchColumn()) return null;
    } catch (Exception $e) { /* expenses table optional */ }

    // Don't turn a registered vendor / business (e.g. "Amazon", "HC Store") into a person.
    try {
        $vt = $db->prepare("SELECT 1 FROM vendors WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1");
        $vt->execute([$name]);
        if ($vt->fetchColumn()) return null;
    } catch (Exception $e) { /* vendors table optional */ }

    // Reuse an existing person with the same full name (avoid duplicates).
    try {
        $ms = $db->prepare("SELECT id FROM members WHERE LOWER(TRIM(CONCAT(first_name, ' ', last_name))) = LOWER(?) ORDER BY id ASC LIMIT 1");
        $ms->execute([$name]);
        $existing = $ms->fetchColumn();
        if ($existing) return (int)$existing;
    } catch (Exception $e) { return null; }

    // Split "First Middle Last" -> first_name = first token, last_name = remainder.
    $parts = preg_split('/\s+/', $name, 2);
    $first = $parts[0];
    $last = $parts[1] ?? '';

    try {
        $ins = $db->prepare("
            INSERT INTO members (first_name, last_name, person_type, status, import_source, notes)
            VALUES (?, ?, 'non_member_attendee', 'active', 'donation', 'Auto-added from a recorded donation')
        ");
        $ins->execute([$first, $last]);
        return (int)$db->lastInsertId();
    } catch (Exception $e) {
        return null;
    }
}

/**
 * A loan is stored as TWO account_ledger rows (the liability side and the
 * asset side). They are grouped by reference_id so the pair can be edited or
 * deleted together. Older loans were recorded before reference_id was used, so
 * fall back to matching on date + amount + description.
 *
 * Returns the rows of the loan this ledger id belongs to (liability row first).
 */
function loanLedgerGroup($db, $ledgerId) {
    $stmt = $db->prepare("SELECT * FROM account_ledger WHERE id = ?");
    $stmt->execute([$ledgerId]);
    $entry = $stmt->fetch();
    if (!$entry || !in_array($entry['reference_type'], ['loan', 'loan_payment'])) return [];

    if (!empty($entry['reference_id'])) {
        $rows = $db->prepare("
            SELECT * FROM account_ledger
            WHERE reference_type IN ('loan', 'loan_payment') AND reference_id = ?
            ORDER BY id ASC
        ");
        $rows->execute([$entry['reference_id']]);
        $group = $rows->fetchAll();
        if (count($group) >= 1) return $group;
    }

    // Legacy loans: pair the two rows written together for the same transaction.
    $rows = $db->prepare("
        SELECT * FROM account_ledger
        WHERE reference_type = ?
          AND entry_date = ?
          AND ABS(amount) = ABS(?)
          AND (description = ? OR (description IS NULL AND ? IS NULL))
          AND (reference_id IS NULL OR reference_id = ?)
        ORDER BY ABS(id - ?) ASC, id ASC
        LIMIT 2
    ");
    $rows->execute([
        $entry['reference_type'], $entry['entry_date'], $entry['amount'],
        $entry['description'], $entry['description'],
        $entry['reference_id'], $ledgerId,
    ]);
    return $rows->fetchAll();
}

/** Which side of the loan a ledger row sits on, based on its account type. */
function loanRowAccountType($db, $accountId) {
    $s = $db->prepare("SELECT account_type FROM accounts WHERE id = ?");
    $s->execute([$accountId]);
    return $s->fetchColumn() ?: '';
}

/* ─── Loans & Receivables register helpers ───
 * A "lent" loan moves cash OUT of a bank account and INTO a receivable account;
 * repayments move cash back. A "borrowed" loan is the mirror (cash in, liability up).
 * We only touch the ledger when BOTH a bank account and a ledger (receivable/liability)
 * account are chosen — otherwise the loan is tracking-only. Every ledger row stores its
 * balance delta as a signed amount, so reversing = subtract that stored amount. */
function loanPartyName($db, $loan) {
    if (!empty($loan['member_id'])) {
        $s = $db->prepare("SELECT TRIM(CONCAT(COALESCE(first_name,''),' ',COALESCE(last_name,''))) FROM members WHERE id = ?");
        $s->execute([$loan['member_id']]);
        $n = $s->fetchColumn();
        if ($n) return trim($n);
    }
    return !empty($loan['borrower_name']) ? $loan['borrower_name'] : 'someone';
}
function loanReverseLedger($db, $refType, $refId) {
    $rows = $db->prepare("SELECT id, account_id, amount FROM account_ledger WHERE reference_type = ? AND reference_id = ?");
    $rows->execute([$refType, $refId]);
    $sub = $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?");
    $del = $db->prepare("DELETE FROM account_ledger WHERE id = ?");
    foreach ($rows->fetchAll() as $r) {
        $sub->execute([(float)$r['amount'], $r['account_id']]);
        $del->execute([$r['id']]);
    }
}
function loanBookIssue($db, $loan) {
    if (empty($loan['bank_account_id']) || empty($loan['ledger_account_id'])) return;
    $amt = (float)$loan['amount'];
    if ($amt <= 0) return;
    $bank = (int)$loan['bank_account_id'];
    $led = (int)$loan['ledger_account_id'];
    $date = $loan['loan_date'];
    $by = $loan['created_by'] ?? null;
    $party = loanPartyName($db, $loan);
    $ins = $db->prepare("INSERT INTO account_ledger (account_id, entry_date, entry_type, amount, description, reference_type, reference_id, created_by) VALUES (?, ?, ?, ?, ?, 'loan_issue', ?, ?)");
    if (($loan['direction'] ?? 'lent') === 'borrowed') {
        $desc = 'Loan borrowed from ' . $party;
        $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?")->execute([$amt, $bank]);
        $ins->execute([$bank, $date, 'deposit', $amt, $desc, $loan['id'], $by]);
        $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?")->execute([$amt, $led]);
        $ins->execute([$led, $date, 'deposit', $amt, $desc, $loan['id'], $by]);
    } else {
        $desc = 'Loan to ' . $party;
        $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")->execute([$amt, $bank]);
        $ins->execute([$bank, $date, 'withdrawal', -$amt, $desc, $loan['id'], $by]);
        $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?")->execute([$amt, $led]);
        $ins->execute([$led, $date, 'deposit', $amt, $desc, $loan['id'], $by]);
    }
}
function loanBookRepay($db, $loan, $rep) {
    if (empty($rep['bank_account_id']) || empty($loan['ledger_account_id'])) return;
    $amt = (float)$rep['amount'];
    if ($amt <= 0) return;
    $bank = (int)$rep['bank_account_id'];
    $led = (int)$loan['ledger_account_id'];
    $date = $rep['repay_date'];
    $by = $rep['created_by'] ?? null;
    $party = loanPartyName($db, $loan);
    $ins = $db->prepare("INSERT INTO account_ledger (account_id, entry_date, entry_type, amount, description, reference_type, reference_id, created_by) VALUES (?, ?, ?, ?, ?, 'loan_repay', ?, ?)");
    if (($loan['direction'] ?? 'lent') === 'borrowed') {
        $desc = 'Loan repayment to ' . $party;
        $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")->execute([$amt, $bank]);
        $ins->execute([$bank, $date, 'withdrawal', -$amt, $desc, $rep['id'], $by]);
        $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")->execute([$amt, $led]);
        $ins->execute([$led, $date, 'withdrawal', -$amt, $desc, $rep['id'], $by]);
    } else {
        $desc = 'Loan repayment from ' . $party;
        $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?")->execute([$amt, $bank]);
        $ins->execute([$bank, $date, 'deposit', $amt, $desc, $rep['id'], $by]);
        $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")->execute([$amt, $led]);
        $ins->execute([$led, $date, 'withdrawal', -$amt, $desc, $rep['id'], $by]);
    }
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
            $runningBal = $openingBalance;
            for ($i = 0; $i < count($entries); $i++) {
                $amt = (float)$entries[$i]['amount'];
                if ($amt >= 0) $periodIn += $amt;
                else $periodOut += $amt;
                $runningBal += $amt;
                $entries[$i]['running_balance'] = $runningBal;
            }

            $endingBalance = $openingBalance + $periodIn + $periodOut;

            $entries = array_reverse($entries);

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
                // Ongoing pledges store end_date as NULL or '0000-00-00' — treat those as no end date.
                $endDate = (!empty($pledge['end_date']) && $pledge['end_date'] !== '0000-00-00') ? $pledge['end_date'] : null;

                $tpSql = "SELECT COALESCE(SUM(amount), 0) FROM donations
                          WHERE member_id = ? AND category_id = ? AND donation_date >= ?";
                $tpParams = [$pledge['member_id'], $pledge['category_id'], $pledge['start_date']];
                if ($endDate) { $tpSql .= " AND donation_date <= ?"; $tpParams[] = $endDate; }
                $tpStmt = $db->prepare($tpSql);
                $tpStmt->execute($tpParams);
                $totalPaid = (float)$tpStmt->fetchColumn();

                $amount = (float)$pledge['amount'];
                $expectedPayments = pledgeExpectedPayments($pledge['frequency'], $pledge['start_date'], $endDate);
                $expectedTotal = $amount * $expectedPayments;          // amount DUE so far (through the current period)
                $displayExpected = $expectedTotal > 0 ? $expectedTotal : $amount; // never 0, so the bar/label stays sensible
                $behindBy = max(0, round($expectedTotal - $totalPaid, 2));

                $pledge['total_paid'] = $totalPaid;
                $pledge['expected_total'] = $expectedTotal;
                $pledge['display_expected'] = $displayExpected;
                $pledge['expected_payments'] = $expectedPayments;
                $pledge['behind_by'] = $behindBy;
                $pledge['fulfillment_pct'] = $displayExpected > 0 ? min(100, round(($totalPaid / $displayExpected) * 100, 1)) : 0;
                $pledge['is_behind'] = $behindBy > 0.005;
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
                    $expectedPayments = pledgeExpectedPayments($p['frequency'], $p['start_date']);
                    $expectedTotal = (float)$p['amount'] * $expectedPayments;
                    $totalPaid = (float)$p['total_paid'];
                    $behindBy = round($expectedTotal - $totalPaid, 2);

                    if ($behindBy > 0.005) {
                        $alerts[] = [
                            'member_name' => $p['first_name'] . ' ' . $p['last_name'],
                            'category' => $p['category_name'],
                            'expected' => $expectedTotal,
                            'paid' => $totalPaid,
                            'behind_by' => $behindBy,
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

        // --- ALL TRANSACTIONS (unified) ---
        if ($action === 'all_transactions') {
            $dateFrom = $_GET['date_from'] ?? date('Y-m-01');
            $dateTo = $_GET['date_to'] ?? date('Y-m-d');
            $typeFilter = $_GET['type'] ?? '';
            $searchFilter = $_GET['search'] ?? '';
            $page = max(1, (int)($_GET['page'] ?? 1));
            $limit = 50;
            $fetchAll = !empty($_GET['all']); // PDF / print export wants every matching row

            $entries = [];

            // Donations
            if (!$typeFilter || $typeFilter === 'income') {
                $stmt = $db->prepare("
                    SELECT d.id, d.donation_date as date, d.amount, d.payment_method, d.notes,
                        d.created_at, d.recorded_by, d.routed_account_id,
                        COALESCE(CONCAT(m.first_name, ' ', m.last_name), d.donor_name, 'Anonymous') as who,
                        dc.name as category_name, u.name as recorded_by_name,
                        a.name as account_name
                    FROM donations d
                    JOIN donation_categories dc ON dc.id = d.category_id
                    LEFT JOIN members m ON m.id = d.member_id
                    LEFT JOIN users u ON u.id = d.recorded_by
                    LEFT JOIN accounts a ON a.id = d.routed_account_id
                    WHERE d.donation_date BETWEEN ? AND ?
                    ORDER BY d.donation_date DESC, d.created_at DESC
                ");
                $stmt->execute([$dateFrom, $dateTo]);
                foreach ($stmt->fetchAll() as $r) {
                    $entries[] = [
                        'id' => (int)$r['id'], 'source' => 'donation', 'type' => 'Income',
                        'date' => $r['date'], 'amount' => (float)$r['amount'],
                        'description' => $r['category_name'] . ' - ' . $r['who'],
                        'method' => $r['payment_method'], 'account' => $r['account_name'] ?: '',
                        'routed_account_id' => $r['routed_account_id'] ? (int)$r['routed_account_id'] : null,
                        'recorded_by' => $r['recorded_by_name'], 'created_at' => $r['created_at'],
                        'status' => 'recorded', 'notes' => $r['notes'],
                    ];
                }
            }

            // Expenses
            if (!$typeFilter || $typeFilter === 'expense') {
                try {
                    $stmt = $db->prepare("
                        SELECT e.id, e.expense_date as date, e.amount, e.payment_method, e.description as notes,
                            e.vendor, e.status, e.created_at, e.approved_by, e.approved_at,
                            ec.name as category_name, u.name as recorded_by_name,
                            a.name as account_name, u2.name as approved_by_name
                        FROM expenses e
                        JOIN expense_categories ec ON ec.id = e.category_id
                        LEFT JOIN users u ON u.id = e.recorded_by
                        LEFT JOIN accounts a ON a.id = e.source_account_id
                        LEFT JOIN users u2 ON u2.id = e.approved_by
                        WHERE e.expense_date BETWEEN ? AND ?
                        ORDER BY e.expense_date DESC, e.created_at DESC
                    ");
                    $stmt->execute([$dateFrom, $dateTo]);
                    foreach ($stmt->fetchAll() as $r) {
                        $entries[] = [
                            'id' => (int)$r['id'], 'source' => 'expense', 'type' => 'Expense',
                            'date' => $r['date'], 'amount' => (float)$r['amount'],
                            'description' => $r['category_name'] . ($r['vendor'] ? ' - ' . $r['vendor'] : ''),
                            'method' => $r['payment_method'], 'account' => $r['account_name'] ?: '',
                            'recorded_by' => $r['recorded_by_name'], 'created_at' => $r['created_at'],
                            'status' => $r['status'], 'notes' => $r['notes'],
                            'approved_by_name' => $r['approved_by_name'],
                        ];
                    }
                } catch (Exception $e) {}
            }

            // Transfers
            if (!$typeFilter || $typeFilter === 'transfer') {
                try {
                    $stmt = $db->prepare("
                        SELECT t.id, t.transfer_date as date, t.amount, t.notes, t.reference_number, t.created_at,
                            t.from_account_id, t.to_account_id,
                            fa.name as from_name, ta.name as to_name, u.name as recorded_by_name
                        FROM account_transfers t
                        LEFT JOIN accounts fa ON fa.id = t.from_account_id
                        LEFT JOIN accounts ta ON ta.id = t.to_account_id
                        LEFT JOIN users u ON u.id = t.created_by
                        WHERE t.transfer_date BETWEEN ? AND ?
                        ORDER BY t.transfer_date DESC
                    ");
                    $stmt->execute([$dateFrom, $dateTo]);
                    foreach ($stmt->fetchAll() as $r) {
                        $entries[] = [
                            'id' => (int)$r['id'], 'source' => 'transfer', 'type' => 'Transfer',
                            'date' => $r['date'], 'amount' => (float)$r['amount'],
                            'description' => $r['from_name'] . ' -> ' . $r['to_name'],
                            'method' => '', 'account' => '',
                            'from_account_id' => (int)$r['from_account_id'], 'to_account_id' => (int)$r['to_account_id'],
                            'reference_number' => $r['reference_number'],
                            'recorded_by' => $r['recorded_by_name'], 'created_at' => $r['created_at'],
                            'status' => 'recorded', 'notes' => $r['notes'],
                        ];
                    }
                } catch (Exception $e) {}
            }

            // Loans (received / repaid). Shown so they can be edited or deleted
            // like any other transaction; they are not income or expense, so
            // they stay out of the Income/Expense/Net totals.
            if (!$typeFilter || $typeFilter === 'loan') {
                try {
                    $stmt = $db->prepare("
                        SELECT al.id, al.entry_date as date, al.amount, al.description, al.reference_type,
                            al.reference_id, al.created_at, al.account_id,
                            a.name as account_name, a.account_type, u.name as recorded_by_name
                        FROM account_ledger al
                        LEFT JOIN accounts a ON a.id = al.account_id
                        LEFT JOIN users u ON u.id = al.created_by
                        WHERE al.entry_date BETWEEN ? AND ?
                          AND al.reference_type IN ('loan', 'loan_payment')
                        ORDER BY al.entry_date DESC, al.id ASC
                    ");
                    $stmt->execute([$dateFrom, $dateTo]);

                    // Each loan writes two ledger rows (liability + asset side).
                    // Show one line per loan, on the asset (cash) side.
                    $seenLoans = [];
                    foreach ($stmt->fetchAll() as $r) {
                        $groupKey = $r['reference_id']
                            ? 'g' . $r['reference_id']
                            : $r['reference_type'] . '|' . $r['date'] . '|' . abs((float)$r['amount']) . '|' . $r['description'];
                        if (isset($seenLoans[$groupKey])) {
                            // Prefer the asset row for display (it names the bank account).
                            if ($r['account_type'] !== 'liability') {
                                $idx = $seenLoans[$groupKey];
                                $entries[$idx]['id'] = (int)$r['id'];
                                $entries[$idx]['account'] = $r['account_name'] ?: '';
                            }
                            continue;
                        }
                        $isPayment = $r['reference_type'] === 'loan_payment';
                        $entries[] = [
                            'id' => (int)$r['id'], 'source' => 'loan',
                            'type' => $isPayment ? 'Loan Payment' : 'Loan Received',
                            'date' => $r['date'], 'amount' => abs((float)$r['amount']),
                            'description' => $r['description'] ?: ($isPayment ? 'Loan payment' : 'Loan received'),
                            'method' => '', 'account' => $r['account_name'] ?: '',
                            'recorded_by' => $r['recorded_by_name'], 'created_at' => $r['created_at'],
                            'status' => 'recorded', 'notes' => $r['description'],
                        ];
                        $seenLoans[$groupKey] = count($entries) - 1;
                    }
                } catch (Exception $e) {}
            }

            // Filter by search
            if ($searchFilter) {
                $search = strtolower($searchFilter);
                $entries = array_filter($entries, function($e) use ($search) {
                    return strpos(strtolower($e['description']), $search) !== false
                        || strpos(strtolower($e['method'] ?? ''), $search) !== false
                        || strpos(strtolower($e['account'] ?? ''), $search) !== false;
                });
                $entries = array_values($entries);
            }

            usort($entries, function($a, $b) { return strcmp($b['date'], $a['date']) ?: strcmp($b['created_at'], $a['created_at']); });

            $totalIncome = array_sum(array_map(fn($e) => $e['type'] === 'Income' ? $e['amount'] : 0, $entries));
            $totalExpense = array_sum(array_map(fn($e) => $e['type'] === 'Expense' ? $e['amount'] : 0, $entries));
            $totalTransfer = array_sum(array_map(fn($e) => $e['type'] === 'Transfer' ? $e['amount'] : 0, $entries));
            $totalEntries = count($entries);

            $offset = ($page - 1) * $limit;
            $pagedEntries = $fetchAll ? $entries : array_slice($entries, $offset, $limit);

            jsonResponse([
                'entries' => $pagedEntries,
                'total' => $totalEntries,
                'total_income' => $totalIncome,
                'total_expense' => $totalExpense,
                'total_transfer' => $totalTransfer,
                'page' => $page,
                'pages' => max(1, ceil($totalEntries / $limit)),
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
            ]);
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
            $fetchAll = !empty($_GET['all']); // PDF / print export wants every matching row

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

            // Loan and other ledger entries (loan_payment, loan, manual adjustments)
            try {
                $stmt = $db->prepare("
                    SELECT al.id, al.entry_date as date, al.entry_type, al.amount, al.description,
                        al.reference_type, al.account_id, a.name as account_name, u.name as recorded_by
                    FROM account_ledger al
                    LEFT JOIN accounts a ON a.id = al.account_id
                    LEFT JOIN users u ON u.id = al.created_by
                    WHERE al.entry_date BETWEEN ? AND ?
                    AND al.entry_type != 'opening'
                    AND al.reference_type IN ('loan', 'loan_payment')
                    ORDER BY al.entry_date DESC
                ");
                $stmt->execute([$dateFrom, $dateTo]);
                $seen = [];
                foreach ($stmt->fetchAll() as $r) {
                    $key = $r['reference_type'] . '_' . $r['date'] . '_' . abs((float)$r['amount']);
                    if (isset($seen[$key])) continue;
                    $seen[$key] = true;
                    $amt = abs((float)$r['amount']);
                    $isPayment = $r['reference_type'] === 'loan_payment';
                    $entries[] = [
                        'date' => $r['date'],
                        'type' => $isPayment ? 'Loan Payment' : 'Loan Received',
                        'source' => 'ledger',
                        'record_id' => (int)$r['id'],
                        'description' => $r['description'] ?: ($isPayment ? 'Loan Payment' : 'Loan Received') . ' - ' . $r['account_name'],
                        'debit' => $isPayment ? $amt : 0,
                        'credit' => $isPayment ? 0 : $amt,
                        'method' => '',
                        'recorded_by' => $r['recorded_by'],
                    ];
                }
            } catch (Exception $e) {}

            // Manual journal entries
            try {
                $stmt = $db->prepare("
                    SELECT je.id, je.entry_date as date, je.description, je.reference_number, u.name as recorded_by,
                        GROUP_CONCAT(CONCAT(a.name, ':', jel.debit, ':', jel.credit, ':', IFNULL(jel.contact_name, '')) SEPARATOR '||') as line_details
                    FROM journal_entries je
                    LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
                    LEFT JOIN accounts a ON a.id = jel.account_id
                    LEFT JOIN users u ON u.id = je.created_by
                    WHERE je.entry_date BETWEEN ? AND ?
                    GROUP BY je.id
                    ORDER BY je.entry_date DESC
                ");
                $stmt->execute([$dateFrom, $dateTo]);
                foreach ($stmt->fetchAll() as $r) {
                    $totalDebit = 0;
                    $totalCredit = 0;
                    $lineInfo = [];
                    if ($r['line_details']) {
                        foreach (explode('||', $r['line_details']) as $ld) {
                            $parts = explode(':', $ld);
                            $acctName = $parts[0] ?? '';
                            $dr = (float)($parts[1] ?? 0);
                            $cr = (float)($parts[2] ?? 0);
                            $contactName = $parts[3] ?? '';
                            $totalDebit += $dr;
                            $totalCredit += $cr;
                            $detail = $acctName;
                            if ($contactName) $detail .= ' (' . $contactName . ')';
                            if ($dr > 0) $detail .= ' DR $' . number_format($dr, 2);
                            if ($cr > 0) $detail .= ' CR $' . number_format($cr, 2);
                            $lineInfo[] = $detail;
                        }
                    }
                    $desc = $r['description'];
                    if ($r['reference_number']) $desc .= ' (Ref: ' . $r['reference_number'] . ')';
                    if (!empty($lineInfo)) $desc .= ' | ' . implode(', ', $lineInfo);
                    $entries[] = [
                        'date' => $r['date'],
                        'type' => 'Journal',
                        'source' => 'journal_entry',
                        'record_id' => (int)$r['id'],
                        'description' => $desc,
                        'debit' => $totalDebit,
                        'credit' => $totalCredit,
                        'method' => '',
                        'recorded_by' => $r['recorded_by'],
                    ];
                }
            } catch (Exception $e) {}

            usort($entries, function($a, $b) { return strcmp($b['date'], $a['date']); });

            $totalDebit = array_sum(array_column($entries, 'debit'));
            $totalCredit = array_sum(array_column($entries, 'credit'));
            $totalEntries = count($entries);
            $pagedEntries = $fetchAll ? $entries : array_slice($entries, $offset, $limit);

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

        // --- VENDORS LIST (names only, for autocomplete) ---
        // Combines the registered vendor list with any legacy expense.vendor
        // values so old expenses keep working before/without a migration.
        if ($action === 'vendors') {
            $search = trim($_GET['search'] ?? '');
            $names = [];
            try {
                $sql = "SELECT name FROM vendors WHERE is_active = 1";
                $params = [];
                if ($search !== '') { $sql .= " AND name LIKE ?"; $params[] = "%$search%"; }
                $sql .= " ORDER BY name ASC LIMIT 200";
                $stmt = $db->prepare($sql);
                $stmt->execute($params);
                $names = $stmt->fetchAll(PDO::FETCH_COLUMN);
            } catch (Exception $e) { /* vendors table not created yet */ }

            // Fold in distinct expense vendors that aren't in the table yet.
            try {
                $sql = "SELECT DISTINCT vendor FROM expenses WHERE vendor IS NOT NULL AND vendor != ''";
                $params = [];
                if ($search !== '') { $sql .= " AND vendor LIKE ?"; $params[] = "%$search%"; }
                $sql .= " ORDER BY vendor ASC LIMIT 200";
                $stmt = $db->prepare($sql);
                $stmt->execute($params);
                foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $v) { $names[] = $v; }
            } catch (Exception $e) { /* expenses table optional */ }

            // De-dupe case-insensitively, keep first spelling, sort alphabetically.
            $seen = []; $vendors = [];
            foreach ($names as $n) {
                $k = strtolower(trim($n));
                if ($k === '' || isset($seen[$k])) continue;
                $seen[$k] = true; $vendors[] = $n;
            }
            sort($vendors, SORT_NATURAL | SORT_FLAG_CASE);
            jsonResponse(['vendors' => $vendors]);
        }

        // --- VENDORS FULL (registry records for the Vendors tab) ---
        if ($action === 'vendors_full') {
            $search = trim($_GET['search'] ?? '');
            try {
                $sql = "SELECT v.*,
                            (SELECT COUNT(*) FROM expenses e WHERE LOWER(TRIM(e.vendor)) = LOWER(TRIM(v.name))) AS expense_count,
                            (SELECT COUNT(*) FROM donations d WHERE LOWER(TRIM(d.donor_name)) = LOWER(TRIM(v.name))) AS donation_count
                        FROM vendors v";
                $params = [];
                if ($search !== '') {
                    $sql .= " WHERE v.name LIKE ? OR v.category LIKE ?";
                    $params[] = "%$search%"; $params[] = "%$search%";
                }
                $sql .= " ORDER BY v.is_active DESC, v.name ASC";
                $stmt = $db->prepare($sql);
                $stmt->execute($params);
                jsonResponse(['vendors' => $stmt->fetchAll()]);
            } catch (Exception $e) {
                // Table missing -> empty list (migration not run yet).
                jsonResponse(['vendors' => [], 'needs_migration' => true]);
            }
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

        // --- ONE TRANSFER (for the edit form) ---
        if ($action === 'transfer_entry') {
            $tid = (int)($_GET['id'] ?? 0);
            if (!$tid) jsonResponse(['error' => 'Transfer ID required'], 400);
            $stmt = $db->prepare("
                SELECT t.*, fa.name as from_account_name, ta.name as to_account_name
                FROM account_transfers t
                LEFT JOIN accounts fa ON fa.id = t.from_account_id
                LEFT JOIN accounts ta ON ta.id = t.to_account_id
                WHERE t.id = ?
            ");
            $stmt->execute([$tid]);
            $t = $stmt->fetch();
            if (!$t) jsonResponse(['error' => 'Transfer not found'], 404);
            jsonResponse(['transfer' => $t]);
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
                SELECT ec.id, ec.name, ec.fund_type, ec.category_group, COALESCE(SUM(e.amount), 0) as total
                FROM expense_categories ec
                LEFT JOIN expenses e ON e.category_id = ec.id AND e.expense_date BETWEEN ? AND ?
                WHERE ec.is_active = 1
                GROUP BY ec.id, ec.name, ec.fund_type, ec.category_group
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

        // --- CATEGORY TRANSACTIONS (for drill-down in financial statements) ---
        if ($action === 'category_transactions') {
            $catId = (int)($_GET['category_id'] ?? 0);
            $catType = $_GET['category_type'] ?? ''; // 'income' or 'expense'
            $dateFrom = $_GET['date_from'] ?? date('Y-01-01');
            $dateTo = $_GET['date_to'] ?? date('Y-m-d');
            if (!$catId || !$catType) jsonResponse(['error' => 'category_id and category_type required'], 400);

            $transactions = [];
            if ($catType === 'income') {
                $stmt = $db->prepare("
                    SELECT d.id, d.donation_date as date, d.amount,
                        COALESCE(CONCAT(m.first_name, ' ', m.last_name), d.donor_name, 'Anonymous') as description,
                        d.payment_method, d.notes
                    FROM donations d
                    LEFT JOIN members m ON m.id = d.member_id
                    WHERE d.category_id = ? AND d.donation_date BETWEEN ? AND ?
                    ORDER BY d.donation_date DESC
                ");
                $stmt->execute([$catId, $dateFrom, $dateTo]);
                $transactions = $stmt->fetchAll();
            } elseif ($catType === 'expense') {
                $stmt = $db->prepare("
                    SELECT e.id, e.expense_date as date, e.amount,
                        COALESCE(e.vendor, e.description, '-') as description,
                        e.payment_method, e.description as notes
                    FROM expenses e
                    WHERE e.category_id = ? AND e.expense_date BETWEEN ? AND ?
                    ORDER BY e.expense_date DESC
                ");
                $stmt->execute([$catId, $dateFrom, $dateTo]);
                $transactions = $stmt->fetchAll();
            }
            jsonResponse(['transactions' => $transactions]);
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
                SELECT ec.name as category_name, ec.id as category_id, ec.fund_type, ec.category_group,
                       COALESCE(SUM(e.amount), 0) as total,
                       COUNT(e.id) as count
                FROM expense_categories ec
                LEFT JOIN expenses e ON e.category_id = ec.id AND e.expense_date BETWEEN ? AND ?
                WHERE ec.is_active = 1
                GROUP BY ec.id, ec.name, ec.fund_type, ec.category_group
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
            $donorName = trim($_GET['donor_name'] ?? '');
            if (!$memberId && $donorName === '') jsonResponse(['error' => 'member_id or donor_name required'], 400);

            $dateFrom = $_GET['date_from'] ?? date('Y-01-01');
            $dateTo = $_GET['date_to'] ?? date('Y-12-31');

            // Optional category filter (comma-separated category ids). Empty = all categories.
            $catIds = array_values(array_filter(array_map('intval', explode(',', $_GET['category_ids'] ?? '')), fn($v) => $v > 0));
            $catClause = '';
            if ($catIds) {
                $catClause = ' AND d.category_id IN (' . implode(',', array_fill(0, count($catIds), '?')) . ')';
            }

            // Either an actual church member, or a non-member donor recorded by name only.
            if ($memberId) {
                $stmt = $db->prepare("SELECT first_name, last_name, email, phone, address, city, state, zip FROM members WHERE id = ?");
                $stmt->execute([$memberId]);
                $member = $stmt->fetch();
                if (!$member) jsonResponse(['error' => 'Member not found'], 404);
                $whoClause = 'd.member_id = ?';
                $whoParams = [$memberId];
            } else {
                // Non-member donor: build a lightweight "member" object from the donor name.
                $member = [
                    'first_name' => $donorName, 'last_name' => '', 'email' => null, 'phone' => null,
                    'address' => null, 'city' => null, 'state' => null, 'zip' => null,
                    'is_non_member' => true,
                ];
                $whoClause = 'd.donor_name = ? AND d.member_id IS NULL';
                $whoParams = [$donorName];
            }

            $stmt = $db->prepare("
                SELECT d.*, dc.name as category_name, s.name as service_name, s.date as service_date
                FROM donations d
                JOIN donation_categories dc ON dc.id = d.category_id
                LEFT JOIN services s ON s.id = d.service_id
                WHERE $whoClause AND d.donation_date BETWEEN ? AND ?$catClause
                ORDER BY d.donation_date ASC
            ");
            $stmt->execute(array_merge($whoParams, [$dateFrom, $dateTo], $catIds));
            $donations = $stmt->fetchAll();

            $totalByCategory = [];
            $grandTotal = 0;
            foreach ($donations as $d) {
                $cat = $d['category_name'];
                if (!isset($totalByCategory[$cat])) $totalByCategory[$cat] = 0;
                $totalByCategory[$cat] += (float)$d['amount'];
                $grandTotal += (float)$d['amount'];
            }

            // This member's active pledges that are behind schedule (same math as the
            // Pledges tab). Lets the statement optionally show what they still owe.
            $pledgesBehind = [];
            $pledgeBehindTotal = 0;
            try {
                $pStmt = $db->prepare("
                    SELECT p.id, p.member_id, p.category_id, p.amount, p.frequency, p.start_date, p.end_date,
                           dc.name as category_name
                    FROM pledges p
                    JOIN donation_categories dc ON dc.id = p.category_id
                    WHERE p.member_id = ? AND p.status = 'active'
                ");
                $pStmt->execute([$memberId]);
                foreach ($pStmt->fetchAll() as $pl) {
                    $endDate = (!empty($pl['end_date']) && $pl['end_date'] !== '0000-00-00') ? $pl['end_date'] : null;
                    $tpSql = "SELECT COALESCE(SUM(amount),0) FROM donations WHERE member_id = ? AND category_id = ? AND donation_date >= ?";
                    $tpParams = [$pl['member_id'], $pl['category_id'], $pl['start_date']];
                    if ($endDate) { $tpSql .= " AND donation_date <= ?"; $tpParams[] = $endDate; }
                    $ts = $db->prepare($tpSql); $ts->execute($tpParams);
                    $paid = (float)$ts->fetchColumn();
                    $exp = (float)$pl['amount'] * pledgeExpectedPayments($pl['frequency'], $pl['start_date'], $endDate);
                    $behind = max(0, round($exp - $paid, 2));
                    if ($behind > 0.005) {
                        $pledgesBehind[] = [
                            'category_name' => $pl['category_name'],
                            'frequency' => $pl['frequency'],
                            'amount' => (float)$pl['amount'],
                            'expected_total' => $exp,
                            'total_paid' => $paid,
                            'behind_by' => $behind,
                        ];
                        $pledgeBehindTotal += $behind;
                    }
                }
            } catch (Exception $e) { /* pledges optional on statement */ }

            jsonResponse([
                'member' => $member,
                'donations' => $donations,
                'total_by_category' => $totalByCategory,
                'grand_total' => $grandTotal,
                'pledges_behind' => $pledgesBehind,
                'pledge_behind_total' => round($pledgeBehindTotal, 2),
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
            ]);
        }

        if ($action === 'all_members_statement') {
            $dateFrom = $_GET['date_from'] ?? date('Y-01-01');
            $dateTo = $_GET['date_to'] ?? date('Y-12-31');
            $sortBy = $_GET['sort_by'] ?? 'name';

            $catIds = array_values(array_filter(array_map('intval', explode(',', $_GET['category_ids'] ?? '')), fn($v) => $v > 0));
            $catClause = '';
            if ($catIds) {
                $catClause = ' AND d.category_id IN (' . implode(',', array_fill(0, count($catIds), '?')) . ')';
            }

            $memberTotals = [];
            $grandTotal = 0;

            // Church members
            $stmt = $db->prepare("
                SELECT m.id, m.first_name, m.last_name,
                       dc.name as category_name,
                       SUM(d.amount) as total_amount,
                       COUNT(d.id) as donation_count
                FROM donations d
                JOIN members m ON m.id = d.member_id
                JOIN donation_categories dc ON dc.id = d.category_id
                WHERE d.donation_date BETWEEN ? AND ?$catClause
                GROUP BY m.id, m.first_name, m.last_name, dc.name
                ORDER BY m.last_name, m.first_name, dc.name
            ");
            $stmt->execute(array_merge([$dateFrom, $dateTo], $catIds));
            foreach ($stmt->fetchAll() as $r) {
                $key = 'm' . $r['id'];
                if (!isset($memberTotals[$key])) {
                    $memberTotals[$key] = [
                        'id' => $key,
                        'name' => trim($r['first_name'] . ' ' . $r['last_name']),
                        'is_non_member' => false,
                        'categories' => [],
                        'total' => 0,
                    ];
                }
                $memberTotals[$key]['categories'][$r['category_name']] = (float)$r['total_amount'];
                $memberTotals[$key]['total'] += (float)$r['total_amount'];
                $grandTotal += (float)$r['total_amount'];
            }

            // Non-member donors (recorded by name only, no member_id)
            $stmt = $db->prepare("
                SELECT d.donor_name,
                       dc.name as category_name,
                       SUM(d.amount) as total_amount,
                       COUNT(d.id) as donation_count
                FROM donations d
                JOIN donation_categories dc ON dc.id = d.category_id
                WHERE d.member_id IS NULL
                  AND d.donor_name IS NOT NULL AND TRIM(d.donor_name) <> ''
                  AND d.donation_date BETWEEN ? AND ?$catClause
                GROUP BY d.donor_name, dc.name
                ORDER BY d.donor_name, dc.name
            ");
            $stmt->execute(array_merge([$dateFrom, $dateTo], $catIds));
            foreach ($stmt->fetchAll() as $r) {
                $key = 'n:' . strtolower($r['donor_name']);
                if (!isset($memberTotals[$key])) {
                    $memberTotals[$key] = [
                        'id' => $key,
                        'name' => $r['donor_name'],
                        'is_non_member' => true,
                        'categories' => [],
                        'total' => 0,
                    ];
                }
                $memberTotals[$key]['categories'][$r['category_name']] = (float)$r['total_amount'];
                $memberTotals[$key]['total'] += (float)$r['total_amount'];
                $grandTotal += (float)$r['total_amount'];
            }

            $members = array_values($memberTotals);

            if ($sortBy === 'amount') {
                usort($members, fn($a, $b) => ($b['total'] <=> $a['total']));
            } else {
                // name / type: alphabetical by display name
                usort($members, fn($a, $b) => strcasecmp($a['name'], $b['name']));
            }

            jsonResponse([
                'members' => $members,
                'grand_total' => $grandTotal,
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
                'count' => count($members),
            ]);
        }

        if ($action === 'non_givers') {
            $dateFrom = $_GET['date_from'] ?? date('Y-01-01');
            $dateTo = $_GET['date_to'] ?? date('Y-12-31');

            // Optional category filter: members who gave nothing in the SELECTED categories.
            $catIds = array_values(array_filter(array_map('intval', explode(',', $_GET['category_ids'] ?? '')), fn($v) => $v > 0));
            $catClause = '';
            if ($catIds) {
                $catClause = ' AND d.category_id IN (' . implode(',', array_fill(0, count($catIds), '?')) . ')';
            }

            $stmt = $db->prepare("
                SELECT m.id, m.first_name, m.last_name, m.email, m.phone, m.person_type, m.status
                FROM members m
                WHERE m.status = 'active'
                  AND m.id NOT IN (
                    SELECT DISTINCT d.member_id FROM donations d
                    WHERE d.member_id IS NOT NULL AND d.donation_date BETWEEN ? AND ?$catClause
                  )
                ORDER BY m.last_name, m.first_name
            ");
            $stmt->execute(array_merge([$dateFrom, $dateTo], $catIds));
            $nonGivers = $stmt->fetchAll();

            jsonResponse([
                'members' => $nonGivers,
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
                'count' => count($nonGivers),
            ]);
        }

        // Distinct non-member donor names (recorded by name only, no member_id).
        // Powers the individual-statement selector so statements can be run for
        // donors who are not church members.
        if ($action === 'statement_donors') {
            $stmt = $db->query("
                SELECT TRIM(donor_name) as donor_name,
                       COUNT(*) as gift_count,
                       SUM(amount) as total_amount,
                       MAX(donation_date) as last_gift
                FROM donations
                WHERE member_id IS NULL
                  AND donor_name IS NOT NULL AND TRIM(donor_name) <> ''
                GROUP BY TRIM(donor_name)
                ORDER BY donor_name ASC
            ");
            jsonResponse(['donors' => $stmt->fetchAll()]);
        }

        // Vendor statement: everything the church spent WITH a vendor (expenses)
        // plus anything received FROM that business recorded by name (donations),
        // over a date range. Mirrors the member giving statement but for vendors.
        if ($action === 'vendor_statement') {
            $vendorName = trim($_GET['vendor_name'] ?? '');
            if ($vendorName === '') jsonResponse(['error' => 'vendor_name required'], 400);

            $dateFrom = $_GET['date_from'] ?? date('Y-01-01');
            $dateTo = $_GET['date_to'] ?? date('Y-12-31');

            // Registered contact details, if this vendor is in the registry.
            $vendor = ['name' => $vendorName, 'registered' => false];
            try {
                $vs = $db->prepare("SELECT name, category, phone, email, website, address, notes FROM vendors WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1");
                $vs->execute([$vendorName]);
                if ($row = $vs->fetch()) {
                    $vendor = array_merge($row, ['registered' => true]);
                }
            } catch (Exception $e) { /* vendors table optional */ }

            // Purchases / bills paid to this vendor.
            $purchases = [];
            $totalPaid = 0;
            try {
                $pStmt = $db->prepare("
                    SELECT e.id, e.expense_date, e.amount, e.description, e.payment_method,
                           e.reference_number, ec.name AS category_name,
                           a.name AS account_name
                    FROM expenses e
                    LEFT JOIN expense_categories ec ON ec.id = e.category_id
                    LEFT JOIN accounts a ON a.id = e.source_account_id
                    WHERE LOWER(TRIM(e.vendor)) = LOWER(?)
                      AND e.expense_date BETWEEN ? AND ?
                    ORDER BY e.expense_date ASC, e.id ASC
                ");
                $pStmt->execute([$vendorName, $dateFrom, $dateTo]);
                foreach ($pStmt->fetchAll() as $r) {
                    $purchases[] = $r;
                    $totalPaid += (float)$r['amount'];
                }
            } catch (Exception $e) { /* ignore */ }

            // Money received from this business, recorded as a name-only donation.
            $income = [];
            $totalReceived = 0;
            try {
                $iStmt = $db->prepare("
                    SELECT d.id, d.donation_date, d.amount, d.payment_method,
                           d.reference_number, d.notes, dc.name AS category_name
                    FROM donations d
                    LEFT JOIN donation_categories dc ON dc.id = d.category_id
                    WHERE d.member_id IS NULL
                      AND LOWER(TRIM(d.donor_name)) = LOWER(?)
                      AND d.donation_date BETWEEN ? AND ?
                    ORDER BY d.donation_date ASC, d.id ASC
                ");
                $iStmt->execute([$vendorName, $dateFrom, $dateTo]);
                foreach ($iStmt->fetchAll() as $r) {
                    $income[] = $r;
                    $totalReceived += (float)$r['amount'];
                }
            } catch (Exception $e) { /* ignore */ }

            jsonResponse([
                'vendor' => $vendor,
                'purchases' => $purchases,
                'income' => $income,
                'total_paid' => round($totalPaid, 2),
                'total_received' => round($totalReceived, 2),
                'net' => round($totalReceived - $totalPaid, 2),
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
            ]);
        }

        // --- ONE LOAN TRANSACTION (for the edit form) ---
        if ($action === 'loan_entry') {
            $id = (int)($_GET['id'] ?? 0);
            if (!$id) jsonResponse(['error' => 'Ledger entry ID required'], 400);

            $group = loanLedgerGroup($db, $id);
            if (empty($group)) jsonResponse(['error' => 'Loan transaction not found'], 404);

            $liabilityId = null;
            $assetId = null;
            foreach ($group as $row) {
                $type = loanRowAccountType($db, $row['account_id']);
                if ($type === 'liability') $liabilityId = (int)$row['account_id'];
                else $assetId = (int)$row['account_id'];
            }

            $first = $group[0];
            jsonResponse(['loan' => [
                'ledger_ids' => array_map(fn($r) => (int)$r['id'], $group),
                'transaction_type' => $first['reference_type'] === 'loan_payment' ? 'loan_payment' : 'loan_received',
                'transaction_date' => $first['entry_date'],
                'amount' => abs((float)$first['amount']),
                'description' => $first['description'],
                'liability_account_id' => $liabilityId,
                'asset_account_id' => $assetId,
                'complete' => count($group) >= 2 && $liabilityId && $assetId,
            ]]);
        }

        // --- LOANS & RECEIVABLES: list ---
        if ($action === 'loans') {
            try {
                $rows = $db->query("
                    SELECT l.*,
                        TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,''))) as member_name,
                        ba.name as bank_account_name, la.name as ledger_account_name,
                        u.name as created_by_name,
                        (SELECT COALESCE(SUM(amount),0) FROM loan_repayments r WHERE r.loan_id = l.id) as total_repaid
                    FROM loans l
                    LEFT JOIN members m ON m.id = l.member_id
                    LEFT JOIN accounts ba ON ba.id = l.bank_account_id
                    LEFT JOIN accounts la ON la.id = l.ledger_account_id
                    LEFT JOIN users u ON u.id = l.created_by
                    ORDER BY (l.status = 'paid') ASC, l.loan_date DESC, l.id DESC
                ")->fetchAll();
                foreach ($rows as &$r) {
                    $r['borrower'] = $r['member_name'] ?: ($r['borrower_name'] ?: '');
                    $r['total_repaid'] = round((float)$r['total_repaid'], 2);
                    $r['balance'] = round((float)$r['amount'] - (float)$r['total_repaid'], 2);
                }
                unset($r);
                $outstanding = 0; $lentTotal = 0; $borrowedTotal = 0;
                foreach ($rows as $r) {
                    if ($r['direction'] === 'borrowed') $borrowedTotal += (float)$r['balance'];
                    else $lentTotal += (float)$r['balance'];
                    $outstanding += (float)$r['balance'];
                }
                jsonResponse([
                    'loans' => $rows,
                    'outstanding_total' => round($outstanding, 2),
                    'lent_outstanding' => round($lentTotal, 2),
                    'borrowed_outstanding' => round($borrowedTotal, 2),
                ]);
            } catch (Exception $e) {
                jsonResponse(['loans' => [], 'note' => 'loans table may not exist yet']);
            }
        }

        // --- LOANS & RECEIVABLES: one loan + its repayment history ---
        if ($action === 'loan_detail') {
            $id = (int)($_GET['id'] ?? 0);
            if (!$id) jsonResponse(['error' => 'Loan ID required'], 400);
            $l = $db->prepare("
                SELECT l.*,
                    TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,''))) as member_name,
                    m.phone as member_phone,
                    ba.name as bank_account_name, la.name as ledger_account_name,
                    u.name as created_by_name
                FROM loans l
                LEFT JOIN members m ON m.id = l.member_id
                LEFT JOIN accounts ba ON ba.id = l.bank_account_id
                LEFT JOIN accounts la ON la.id = l.ledger_account_id
                LEFT JOIN users u ON u.id = l.created_by
                WHERE l.id = ?
            ");
            $l->execute([$id]);
            $loan = $l->fetch();
            if (!$loan) jsonResponse(['error' => 'Loan not found'], 404);
            $reps = $db->prepare("
                SELECT r.*, ba.name as bank_account_name, u.name as created_by_name
                FROM loan_repayments r
                LEFT JOIN accounts ba ON ba.id = r.bank_account_id
                LEFT JOIN users u ON u.id = r.created_by
                WHERE r.loan_id = ? ORDER BY r.repay_date ASC, r.id ASC
            ");
            $reps->execute([$id]);
            $repayments = $reps->fetchAll();
            $totalRepaid = 0; foreach ($repayments as $rp) $totalRepaid += (float)$rp['amount'];
            $loan['borrower'] = $loan['member_name'] ?: ($loan['borrower_name'] ?: '');
            $loan['total_repaid'] = round($totalRepaid, 2);
            $loan['balance'] = round((float)$loan['amount'] - $totalRepaid, 2);
            jsonResponse(['loan' => $loan, 'repayments' => $repayments]);
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
        // --- SYNC ACCOUNTS TO CATEGORIES ---
        if ($action === 'sync_accounts') {
            requireRole($currentUser, ['pastor', 'admin']);
            $synced = 0;

            // Sync income accounts to donation_categories
            $incAccounts = $db->query("SELECT name, description, fund_type FROM accounts WHERE account_type = 'income' AND parent_id IS NOT NULL AND is_active = 1")->fetchAll();
            foreach ($incAccounts as $acc) {
                $exists = $db->prepare("SELECT id FROM donation_categories WHERE name = ?");
                $exists->execute([$acc['name']]);
                if (!$exists->fetchColumn()) {
                    $catOrder = (int)$db->query("SELECT COALESCE(MAX(sort_order), 0) FROM donation_categories")->fetchColumn() + 1;
                    $db->prepare("INSERT INTO donation_categories (name, description, fund_type, sort_order) VALUES (?, ?, ?, ?)")
                        ->execute([$acc['name'], $acc['description'], $acc['fund_type'] ?? 'general', $catOrder]);
                    $synced++;
                }
            }

            // Sync expense accounts to expense_categories
            $expAccounts = $db->query("SELECT name, description, fund_type FROM accounts WHERE account_type = 'expense' AND parent_id IS NOT NULL AND is_active = 1")->fetchAll();
            foreach ($expAccounts as $acc) {
                $exists = $db->prepare("SELECT id FROM expense_categories WHERE name = ?");
                $exists->execute([$acc['name']]);
                if (!$exists->fetchColumn()) {
                    $catOrder = (int)$db->query("SELECT COALESCE(MAX(sort_order), 0) FROM expense_categories")->fetchColumn() + 1;
                    $db->prepare("INSERT INTO expense_categories (name, description, fund_type, sort_order) VALUES (?, ?, ?, ?)")
                        ->execute([$acc['name'], $acc['description'], $acc['fund_type'] ?? 'general', $catOrder]);
                    $synced++;
                }
            }

            jsonResponse(['message' => "$synced account(s) synced to categories", 'synced' => $synced]);
        }

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

        // --- CREATE / UPDATE A VENDOR (registry) ---
        if ($action === 'vendor_save') {
            $data = getRequestBody();
            $name = trim($data['name'] ?? '');
            if ($name === '') jsonResponse(['error' => 'Vendor name is required'], 400);
            $vid = isset($data['id']) ? (int)$data['id'] : 0;

            // No duplicate names (case-insensitive), except when editing that same row.
            $dupe = $db->prepare("SELECT id FROM vendors WHERE LOWER(TRIM(name)) = LOWER(?) AND id <> ? LIMIT 1");
            $dupe->execute([$name, $vid]);
            if ($dupe->fetchColumn()) jsonResponse(['error' => 'A vendor with that name already exists'], 409);

            $fields = [
                $name,
                trim($data['category'] ?? '') ?: null,
                trim($data['phone'] ?? '') ?: null,
                trim($data['email'] ?? '') ?: null,
                trim($data['website'] ?? '') ?: null,
                trim($data['address'] ?? '') ?: null,
                trim($data['notes'] ?? '') ?: null,
                isset($data['is_active']) ? (int)!!$data['is_active'] : 1,
            ];

            if ($vid) {
                $stmt = $db->prepare("UPDATE vendors SET name=?, category=?, phone=?, email=?, website=?, address=?, notes=?, is_active=?, updated_at=NOW() WHERE id=?");
                $stmt->execute(array_merge($fields, [$vid]));
                jsonResponse(['message' => 'Vendor updated', 'id' => $vid]);
            } else {
                $stmt = $db->prepare("INSERT INTO vendors (name, category, phone, email, website, address, notes, is_active, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())");
                $stmt->execute(array_merge($fields, [$currentUser['user_id']]));
                jsonResponse(['message' => 'Vendor added', 'id' => (int)$db->lastInsertId()], 201);
            }
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

        // --- MANUAL JOURNAL ENTRY ---
        if ($action === 'journal_entry') {
            requireRole($currentUser, ['pastor', 'admin']);
            // Auto-create tables if they don't exist
            try {
                $db->exec("CREATE TABLE IF NOT EXISTS journal_entries (id INT AUTO_INCREMENT PRIMARY KEY, entry_date DATE NOT NULL, description VARCHAR(500) NOT NULL, reference_number VARCHAR(100) DEFAULT NULL, created_by INT DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_entry_date (entry_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
                $db->exec("CREATE TABLE IF NOT EXISTS journal_entry_lines (id INT AUTO_INCREMENT PRIMARY KEY, journal_entry_id INT NOT NULL, account_id INT NOT NULL, debit DECIMAL(12,2) DEFAULT 0.00, credit DECIMAL(12,2) DEFAULT 0.00, memo VARCHAR(255) DEFAULT NULL, contact_name VARCHAR(255) DEFAULT NULL, INDEX idx_journal_entry_id (journal_entry_id), INDEX idx_account_id (account_id), FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
                try { $db->exec("ALTER TABLE journal_entry_lines ADD COLUMN contact_name VARCHAR(255) DEFAULT NULL"); } catch (Exception $e) {}
            } catch (Exception $e) {}
            $data = getRequestBody();
            if (empty($data['entry_date']) || empty($data['description']) || empty($data['lines']) || !is_array($data['lines'])) {
                jsonResponse(['error' => 'entry_date, description, and lines are required'], 400);
            }
            $totalDebit = 0;
            $totalCredit = 0;
            foreach ($data['lines'] as $line) {
                if (empty($line['account_id'])) jsonResponse(['error' => 'Each line must have an account_id'], 400);
                $totalDebit += (float)($line['debit'] ?? 0);
                $totalCredit += (float)($line['credit'] ?? 0);
            }
            if (abs($totalDebit - $totalCredit) > 0.01) {
                jsonResponse(['error' => 'Total debits (' . number_format($totalDebit, 2) . ') must equal total credits (' . number_format($totalCredit, 2) . ')'], 400);
            }
            if ($totalDebit <= 0) {
                jsonResponse(['error' => 'Entry must have amounts'], 400);
            }

            $db->beginTransaction();
            try {
                $stmt = $db->prepare("
                    INSERT INTO journal_entries (entry_date, description, reference_number, created_by)
                    VALUES (?, ?, ?, ?)
                ");
                $stmt->execute([
                    $data['entry_date'],
                    $data['description'],
                    $data['reference_number'] ?? null,
                    $currentUser['user_id'],
                ]);
                $entryId = (int)$db->lastInsertId();

                $lineStmt = $db->prepare("
                    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo, contact_name)
                    VALUES (?, ?, ?, ?, ?, ?)
                ");
                $ledgerStmt = $db->prepare("
                    INSERT INTO account_ledger (account_id, entry_date, entry_type, amount, description, reference_type, reference_id, created_by)
                    VALUES (?, ?, ?, ?, ?, 'journal', ?, ?)
                ");

                foreach ($data['lines'] as $line) {
                    $accountId = (int)$line['account_id'];
                    $debit = (float)($line['debit'] ?? 0);
                    $credit = (float)($line['credit'] ?? 0);
                    $memo = $line['memo'] ?? null;
                    $contactName = !empty($line['contact_name']) ? $line['contact_name'] : null;

                    $lineStmt->execute([$entryId, $accountId, $debit, $credit, $memo, $contactName]);

                    $account = $db->query("SELECT account_type FROM accounts WHERE id = $accountId")->fetch();
                    $accType = $account['account_type'] ?? '';

                    // Determine balance impact: assets/expenses increase with debit, decrease with credit
                    // Liabilities/income/equity increase with credit, decrease with debit
                    if (in_array($accType, ['asset', 'expense'])) {
                        $netAmount = $debit - $credit;
                    } else {
                        $netAmount = $credit - $debit;
                    }

                    if ($netAmount != 0) {
                        $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?")->execute([$netAmount, $accountId]);
                        $entryType = $netAmount > 0 ? 'deposit' : 'withdrawal';
                        $ledgerStmt->execute([$accountId, $data['entry_date'], $entryType, $netAmount, $data['description'], $entryId, $currentUser['user_id']]);
                    }
                }

                $db->commit();
                jsonResponse(['message' => 'Journal entry recorded', 'id' => $entryId], 201);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Failed to record journal entry: ' . $e->getMessage()], 500);
            }
        }

        // --- DELETE JOURNAL ENTRY ---
        if ($action === 'delete_journal_entry') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            $entryId = (int)($data['id'] ?? $_GET['id'] ?? 0);
            if (!$entryId) jsonResponse(['error' => 'Entry ID required'], 400);

            $db->beginTransaction();
            try {
                // Reverse ledger entries and account balances
                $ledgerEntries = $db->prepare("SELECT * FROM account_ledger WHERE reference_type = 'journal' AND reference_id = ?");
                $ledgerEntries->execute([$entryId]);
                foreach ($ledgerEntries->fetchAll() as $le) {
                    $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")->execute([(float)$le['amount'], (int)$le['account_id']]);
                }
                $db->prepare("DELETE FROM account_ledger WHERE reference_type = 'journal' AND reference_id = ?")->execute([$entryId]);
                $db->prepare("DELETE FROM journal_entry_lines WHERE journal_entry_id = ?")->execute([$entryId]);
                $db->prepare("DELETE FROM journal_entries WHERE id = ?")->execute([$entryId]);
                $db->commit();
                jsonResponse(['message' => 'Journal entry deleted and balances reversed']);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Failed to delete: ' . $e->getMessage()], 500);
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
            $newAccountId = (int)$db->lastInsertId();

            // Auto-create matching category for income/expense subaccounts
            if ($parentId && $data['account_type'] === 'income') {
                $exists = $db->prepare("SELECT id FROM donation_categories WHERE name = ?");
                $exists->execute([$name]);
                if (!$exists->fetchColumn()) {
                    $catOrder = (int)$db->query("SELECT COALESCE(MAX(sort_order), 0) FROM donation_categories")->fetchColumn() + 1;
                    $db->prepare("INSERT INTO donation_categories (name, description, fund_type, sort_order) VALUES (?, ?, ?, ?)")
                        ->execute([$name, $data['description'] ?? null, $data['fund_type'] ?? 'general', $catOrder]);
                }
            }
            if ($parentId && $data['account_type'] === 'expense') {
                $exists = $db->prepare("SELECT id FROM expense_categories WHERE name = ?");
                $exists->execute([$name]);
                if (!$exists->fetchColumn()) {
                    $catOrder = (int)$db->query("SELECT COALESCE(MAX(sort_order), 0) FROM expense_categories")->fetchColumn() + 1;
                    $db->prepare("INSERT INTO expense_categories (name, description, fund_type, sort_order) VALUES (?, ?, ?, ?)")
                        ->execute([$name, $data['description'] ?? null, $data['fund_type'] ?? 'general', $catOrder]);
                }
            }

            jsonResponse(['message' => 'Account created', 'id' => $newAccountId], 201);
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
            $catGroup = trim($data['category_group'] ?? '');
            try {
                $stmt = $db->prepare("INSERT INTO expense_categories (name, description, category_group, fund_type, sort_order) VALUES (?, ?, ?, ?, ?)");
                $stmt->execute([$name, $data['description'] ?? null, ($catGroup !== '' ? $catGroup : null), $data['fund_type'] ?? 'general', $maxOrder]);
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

            $year = (int)($items[0]['year'] ?? date('Y'));

            $db->beginTransaction();
            try {
                $delStmt = $db->prepare("DELETE FROM budgets WHERE category_type = ? AND category_id = ? AND year = ? AND month IS NULL");
                $insStmt = $db->prepare("INSERT INTO budgets (category_type, category_id, year, month, amount, notes) VALUES (?, ?, ?, NULL, ?, ?)");

                $count = 0;
                foreach ($items as $item) {
                    if (!isset($item['amount']) || (float)$item['amount'] < 0) continue;
                    $delStmt->execute([$item['category_type'], (int)$item['category_id'], (int)$item['year']]);
                    $insStmt->execute([
                        $item['category_type'],
                        (int)$item['category_id'],
                        (int)$item['year'],
                        (float)$item['amount'],
                        $item['notes'] ?? null,
                    ]);
                    $count++;
                }
                $db->commit();
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => $e->getMessage()], 500);
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
                $ids = [];

                if ($type === 'loan_received') {
                    // Increase liability (positive on liability account)
                    $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?")->execute([$amount, $liabilityId]);
                    $ledgerStmt->execute([$liabilityId, $txDate, 'deposit', $amount, $description, 'loan', null, $currentUser['user_id']]);
                    $ids[] = (int)$db->lastInsertId();

                    // Increase asset (positive on asset account)
                    $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?")->execute([$amount, $assetId]);
                    $ledgerStmt->execute([$assetId, $txDate, 'deposit', $amount, $description, 'loan', null, $currentUser['user_id']]);
                    $ids[] = (int)$db->lastInsertId();
                } else {
                    // loan_payment: decrease liability
                    $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")->execute([$amount, $liabilityId]);
                    $ledgerStmt->execute([$liabilityId, $txDate, 'withdrawal', -$amount, $description, 'loan_payment', null, $currentUser['user_id']]);
                    $ids[] = (int)$db->lastInsertId();

                    // Decrease asset
                    $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")->execute([$amount, $assetId]);
                    $ledgerStmt->execute([$assetId, $txDate, 'withdrawal', -$amount, $description, 'loan_payment', null, $currentUser['user_id']]);
                    $ids[] = (int)$db->lastInsertId();
                }

                // Group both sides under one reference so the loan can be edited/deleted as one.
                $groupId = $ids[0];
                $upd = $db->prepare("UPDATE account_ledger SET reference_id = ? WHERE id = ?");
                foreach ($ids as $lid) $upd->execute([$groupId, $lid]);

                $db->commit();
                jsonResponse(['message' => 'Loan transaction recorded', 'ledger_ids' => $ids], 201);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Loan transaction failed: ' . $e->getMessage()], 500);
            }
        }

        // --- LOANS & RECEIVABLES: create / update a loan record ---
        if ($action === 'loan_save') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            $amount = (float)($data['amount'] ?? 0);
            if ($amount <= 0) jsonResponse(['error' => 'Amount must be positive'], 400);
            if (empty($data['loan_date'])) jsonResponse(['error' => 'Loan date is required'], 400);
            $direction = (($data['direction'] ?? 'lent') === 'borrowed') ? 'borrowed' : 'lent';
            $memberId = !empty($data['member_id']) ? (int)$data['member_id'] : null;
            $borrowerName = trim($data['borrower_name'] ?? '');
            if (!$memberId && $borrowerName === '') jsonResponse(['error' => 'Please choose a person or type a name'], 400);
            $bankId = !empty($data['bank_account_id']) ? (int)$data['bank_account_id'] : null;
            $ledgerId = !empty($data['ledger_account_id']) ? (int)$data['ledger_account_id'] : null;
            $editId = !empty($data['id']) ? (int)$data['id'] : 0;
            $dueDate = !empty($data['due_date']) ? $data['due_date'] : null;
            $purpose = isset($data['purpose']) ? trim($data['purpose']) : null;
            $notes = isset($data['notes']) ? $data['notes'] : null;

            $db->beginTransaction();
            try {
                if ($editId) {
                    $old = $db->prepare("SELECT * FROM loans WHERE id = ?"); $old->execute([$editId]);
                    if (!$old->fetch()) { $db->rollBack(); jsonResponse(['error' => 'Loan not found'], 404); }
                    $db->prepare("UPDATE loans SET direction=?, member_id=?, borrower_name=?, amount=?, loan_date=?, due_date=?, purpose=?, notes=?, bank_account_id=?, ledger_account_id=? WHERE id=?")
                        ->execute([$direction, $memberId, ($borrowerName !== '' ? $borrowerName : null), $amount, $data['loan_date'], $dueDate, $purpose, $notes, $bankId, $ledgerId, $editId]);
                    // Re-book the issue so balances follow any change to amount/accounts.
                    loanReverseLedger($db, 'loan_issue', $editId);
                    $fresh = $db->prepare("SELECT * FROM loans WHERE id = ?"); $fresh->execute([$editId]);
                    loanBookIssue($db, $fresh->fetch());
                    $db->commit();
                    jsonResponse(['message' => 'Loan updated', 'id' => $editId]);
                } else {
                    $db->prepare("INSERT INTO loans (direction, member_id, borrower_name, amount, loan_date, due_date, purpose, notes, bank_account_id, ledger_account_id, booked, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'open', ?, NOW())")
                        ->execute([$direction, $memberId, ($borrowerName !== '' ? $borrowerName : null), $amount, $data['loan_date'], $dueDate, $purpose, $notes, $bankId, $ledgerId, $currentUser['user_id']]);
                    $loanId = (int)$db->lastInsertId();
                    $fresh = $db->prepare("SELECT * FROM loans WHERE id = ?"); $fresh->execute([$loanId]);
                    loanBookIssue($db, $fresh->fetch());
                    $db->commit();
                    jsonResponse(['message' => 'Loan recorded', 'id' => $loanId], 201);
                }
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Loan save failed: ' . $e->getMessage()], 500);
            }
        }

        // --- LOANS & RECEIVABLES: record a repayment ---
        if ($action === 'loan_repay') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            $loanId = !empty($data['loan_id']) ? (int)$data['loan_id'] : 0;
            $amount = (float)($data['amount'] ?? 0);
            if (!$loanId) jsonResponse(['error' => 'loan_id is required'], 400);
            if ($amount <= 0) jsonResponse(['error' => 'Amount must be positive'], 400);
            if (empty($data['repay_date'])) jsonResponse(['error' => 'Repayment date is required'], 400);
            $l = $db->prepare("SELECT * FROM loans WHERE id = ?"); $l->execute([$loanId]); $loan = $l->fetch();
            if (!$loan) jsonResponse(['error' => 'Loan not found'], 404);
            $bankId = !empty($data['bank_account_id']) ? (int)$data['bank_account_id'] : ($loan['bank_account_id'] ? (int)$loan['bank_account_id'] : null);

            $db->beginTransaction();
            try {
                $db->prepare("INSERT INTO loan_repayments (loan_id, amount, repay_date, notes, bank_account_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())")
                    ->execute([$loanId, $amount, $data['repay_date'], ($data['notes'] ?? null), $bankId, $currentUser['user_id']]);
                $repId = (int)$db->lastInsertId();
                loanBookRepay($db, $loan, ['id' => $repId, 'amount' => $amount, 'repay_date' => $data['repay_date'], 'bank_account_id' => $bankId, 'created_by' => $currentUser['user_id']]);
                $paid = (float)$db->query("SELECT COALESCE(SUM(amount),0) FROM loan_repayments WHERE loan_id = " . $loanId)->fetchColumn();
                $status = ($paid + 0.005 >= (float)$loan['amount']) ? 'paid' : 'open';
                $db->prepare("UPDATE loans SET status = ? WHERE id = ?")->execute([$status, $loanId]);
                $db->commit();
                jsonResponse(['message' => 'Repayment recorded', 'id' => $repId, 'status' => $status], 201);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Repayment failed: ' . $e->getMessage()], 500);
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

                // Auto-add a named non-member donor to the People list so they're
                // searchable / contactable. Businesses & vendors stay as donor_name.
                $rowMemberId = !empty($r['member_id']) ? (int)$r['member_id'] : null;
                $rowDonorName = $r['donor_name'] ?? null;
                if (!$rowMemberId && trim((string)$rowDonorName) !== '') {
                    $newId = ensurePersonForDonor($db, $rowDonorName, $currentUser['user_id']);
                    if ($newId) { $rowMemberId = $newId; $rowDonorName = null; }
                }

                $stmt->execute([
                    $rowMemberId,
                    !empty($r['service_id']) ? (int)$r['service_id'] : null,
                    $categoryId,
                    $amount,
                    $method,
                    $r['reference_number'] ?? null,
                    $rowDonorName,
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

        // Auto-add a named non-member donor to the People list (vendors stay as donor_name).
        $singleMemberId = !empty($data['member_id']) ? (int)$data['member_id'] : null;
        $singleDonorName = $data['donor_name'] ?? null;
        if (!$singleMemberId && trim((string)$singleDonorName) !== '') {
            $newId = ensurePersonForDonor($db, $singleDonorName, $currentUser['user_id']);
            if ($newId) { $singleMemberId = $newId; $singleDonorName = null; }
        }

        $stmt = $db->prepare("
            INSERT INTO donations (member_id, service_id, category_id, amount, payment_method, reference_number, donor_name, notes, donation_date, recorded_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([
            $singleMemberId,
            !empty($data['service_id']) ? (int)$data['service_id'] : null,
            (int)$data['category_id'],
            (float)$data['amount'],
            $data['payment_method'] ?? 'cash',
            $data['reference_number'] ?? null,
            $singleDonorName,
            $data['notes'] ?? null,
            $data['donation_date'] ?? date('Y-m-d'),
            $currentUser['user_id'],
        ]);

        jsonResponse(['message' => 'Donation recorded', 'id' => (int)$db->lastInsertId()], 201);
        break;

    case 'PUT':
        // --- EDIT A LOAN TRANSACTION (both sides at once) ---
        if ($action === 'loan_transaction') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Ledger entry ID required'], 400);

            $group = loanLedgerGroup($db, $id);
            if (empty($group)) jsonResponse(['error' => 'Loan transaction not found'], 404);

            $data = getRequestBody();
            $first = $group[0];

            $type = $data['transaction_type'] ?? ($first['reference_type'] === 'loan_payment' ? 'loan_payment' : 'loan_received');
            if (!in_array($type, ['loan_received', 'loan_payment'])) {
                jsonResponse(['error' => 'transaction_type must be loan_received or loan_payment'], 400);
            }

            $amount = isset($data['amount']) ? (float)$data['amount'] : abs((float)$first['amount']);
            if ($amount <= 0) jsonResponse(['error' => 'Amount must be positive'], 400);

            $txDate = $data['transaction_date'] ?? $first['entry_date'];
            $description = array_key_exists('description', $data) ? $data['description'] : $first['description'];

            // Work out which account is on which side today, so the caller can
            // keep them or move the loan to different accounts.
            $currentLiability = null;
            $currentAsset = null;
            foreach ($group as $row) {
                if (loanRowAccountType($db, $row['account_id']) === 'liability') $currentLiability = (int)$row['account_id'];
                else $currentAsset = (int)$row['account_id'];
            }
            $liabilityId = !empty($data['liability_account_id']) ? (int)$data['liability_account_id'] : $currentLiability;
            $assetId = !empty($data['asset_account_id']) ? (int)$data['asset_account_id'] : $currentAsset;
            if (!$liabilityId || !$assetId) {
                jsonResponse(['error' => 'This loan is missing one of its two sides. Please delete it and record it again.'], 400);
            }

            $signed = $type === 'loan_received' ? $amount : -$amount;
            $entryType = $type === 'loan_received' ? 'deposit' : 'withdrawal';
            $refType = $type === 'loan_received' ? 'loan' : 'loan_payment';
            $groupId = !empty($first['reference_id']) ? (int)$first['reference_id'] : (int)$first['id'];

            $db->beginTransaction();
            try {
                $revert = $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?");
                $apply = $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?");
                $del = $db->prepare("DELETE FROM account_ledger WHERE id = ?");

                // Back out the old entries entirely, then write the loan fresh.
                foreach ($group as $row) {
                    $revert->execute([(float)$row['amount'], $row['account_id']]);
                    $del->execute([$row['id']]);
                }

                $ins = $db->prepare("INSERT INTO account_ledger (account_id, entry_date, entry_type, amount, description, reference_type, reference_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
                $newIds = [];
                foreach ([$liabilityId, $assetId] as $acctId) {
                    $ins->execute([$acctId, $txDate, $entryType, $signed, $description, $refType, $groupId, $currentUser['user_id']]);
                    $newIds[] = (int)$db->lastInsertId();
                    $apply->execute([$signed, $acctId]);
                }

                $db->commit();
                jsonResponse(['message' => 'Loan transaction updated', 'ledger_ids' => $newIds]);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Failed to update loan: ' . $e->getMessage()], 500);
            }
        }

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
            if (array_key_exists('category_group', $data)) { $fields[] = 'category_group = ?'; $params[] = (trim($data['category_group']) !== '' ? trim($data['category_group']) : null); }
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

            // Fetch old values for audit log
            $oldStmt = $db->prepare("SELECT * FROM expenses WHERE id = ?");
            $oldStmt->execute([$id]);
            $oldRecord = $oldStmt->fetch();

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

            $db->beginTransaction();
            try {
                $db->prepare("UPDATE expenses SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);

                // Re-sync the bank ledger so balances follow any change to the amount or
                // source account. Reverse every existing ledger row for this expense
                // (an expense is a withdrawal = negative), then re-create one for its
                // current amount + source account. Idempotent when nothing money-related changed.
                $existing = $db->prepare("SELECT id, account_id, amount FROM account_ledger WHERE reference_type = 'expense' AND reference_id = ?");
                $existing->execute([$id]);
                $revert = $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?");
                $delLedger = $db->prepare("DELETE FROM account_ledger WHERE id = ?");
                foreach ($existing->fetchAll() as $er) {
                    // Row amount is negative for a withdrawal; subtracting it adds the money back.
                    $revert->execute([(float)$er['amount'], $er['account_id']]);
                    $delLedger->execute([$er['id']]);
                }
                $newExp = $db->prepare("SELECT amount, source_account_id, expense_date, vendor, description FROM expenses WHERE id = ?");
                $newExp->execute([$id]);
                $ex = $newExp->fetch();
                if ($ex && $ex['source_account_id']) {
                    $amt = (float)$ex['amount'];
                    $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")->execute([$amt, (int)$ex['source_account_id']]);
                    $db->prepare("INSERT INTO account_ledger (account_id, entry_date, entry_type, amount, description, reference_type, reference_id, created_by) VALUES (?, ?, 'withdrawal', ?, ?, 'expense', ?, ?)")
                        ->execute([(int)$ex['source_account_id'], $ex['expense_date'], -$amt, (($ex['vendor'] ?? '') . ' - ' . ($ex['description'] ?? 'Expense')), $id, $currentUser['user_id']]);
                }
                $db->commit();
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Expense update failed: ' . $e->getMessage()], 500);
            }

            // Audit log
            try {
                $db->prepare("INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, description, old_values, new_values, ip_address, created_at) VALUES (?, ?, 'edit', ?, ?, ?, ?, ?, ?, NOW())")
                    ->execute([
                        $currentUser['user_id'],
                        $currentUser['name'],
                        'expense',
                        $id,
                        'Edited expense #' . $id,
                        json_encode($oldRecord),
                        json_encode($data),
                        $_SERVER['REMOTE_ADDR'] ?? '',
                    ]);
            } catch (Exception $e) { /* don't fail the main operation */ }

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

        // --- EDIT TRANSFER (re-route / change amount / date / notes) ---
        if ($action === 'transfer') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Transfer ID required'], 400);
            $data = getRequestBody();

            $cur = $db->prepare("SELECT * FROM account_transfers WHERE id = ?");
            $cur->execute([$id]);
            $t = $cur->fetch();
            if (!$t) jsonResponse(['error' => 'Transfer not found'], 404);

            // New values fall back to the existing ones when not supplied.
            $fromId = (isset($data['from_account_id']) && $data['from_account_id'] !== '') ? (int)$data['from_account_id'] : (int)$t['from_account_id'];
            $toId   = (isset($data['to_account_id'])   && $data['to_account_id']   !== '') ? (int)$data['to_account_id']   : (int)$t['to_account_id'];
            $newAmount = (isset($data['amount']) && $data['amount'] !== '') ? (float)$data['amount'] : (float)$t['amount'];
            $tdate  = !empty($data['transfer_date']) ? $data['transfer_date'] : $t['transfer_date'];
            $notes  = array_key_exists('notes', $data) ? $data['notes'] : $t['notes'];
            $ref    = array_key_exists('reference_number', $data) ? $data['reference_number'] : $t['reference_number'];

            if ($newAmount <= 0) jsonResponse(['error' => 'Amount must be positive'], 400);
            if ($fromId == $toId) jsonResponse(['error' => 'Cannot transfer to the same account'], 400);

            $db->beginTransaction();
            try {
                // 1. Reverse the OLD balance movement.
                $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?")->execute([(float)$t['amount'], $t['from_account_id']]);
                $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")->execute([(float)$t['amount'], $t['to_account_id']]);

                // 2. Save the edited transfer.
                $db->prepare("UPDATE account_transfers SET from_account_id = ?, to_account_id = ?, amount = ?, transfer_date = ?, reference_number = ?, notes = ? WHERE id = ?")
                    ->execute([$fromId, $toId, $newAmount, $tdate, $ref, $notes, $id]);

                // 3. Apply the NEW balance movement.
                $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?")->execute([$newAmount, $fromId]);
                $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?")->execute([$newAmount, $toId]);

                // 4. Rebuild the two ledger rows so account reports stay correct.
                $db->prepare("DELETE FROM account_ledger WHERE reference_type = 'transfer' AND reference_id = ?")->execute([$id]);
                $nameStmt = $db->prepare("SELECT name FROM accounts WHERE id = ?");
                $nameStmt->execute([$fromId]); $fromName = $nameStmt->fetchColumn() ?: '';
                $nameStmt->execute([$toId]);   $toName   = $nameStmt->fetchColumn() ?: '';
                $ledgerStmt = $db->prepare("INSERT INTO account_ledger (account_id, entry_date, entry_type, amount, description, reference_type, reference_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
                $ledgerStmt->execute([$fromId, $tdate, 'withdrawal', -$newAmount, 'Transfer to ' . $toName, 'transfer', $id, $currentUser['user_id']]);
                $ledgerStmt->execute([$toId, $tdate, 'deposit', $newAmount, 'Transfer from ' . $fromName, 'transfer', $id, $currentUser['user_id']]);

                $db->commit();
                jsonResponse(['message' => 'Transfer updated']);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Transfer update failed: ' . $e->getMessage()], 500);
            }
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

        // Fetch old values for audit log
        $oldStmt = $db->prepare("SELECT * FROM donations WHERE id = ?");
        $oldStmt->execute([$id]);
        $oldRecord = $oldStmt->fetch();

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

        // "Deposit To" = which bank account the money lands in (routed_account_id).
        // Accept it as deposit_to (what the form sends) or routed_account_id. Empty = unassigned.
        $changingRouting = array_key_exists('deposit_to', $data) || array_key_exists('routed_account_id', $data);
        if ($changingRouting) {
            $rawRoute = array_key_exists('deposit_to', $data) ? $data['deposit_to'] : $data['routed_account_id'];
            $newRoutedAccountId = ($rawRoute === '' || $rawRoute === null) ? null : (int)$rawRoute;
            $fields[] = "routed_account_id = ?";
            $params[] = $newRoutedAccountId;
        }

        if (empty($fields)) jsonResponse(['error' => 'Nothing to update'], 400);
        $params[] = $id;

        $db->beginTransaction();
        try {
            $db->prepare("UPDATE donations SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);

            // Re-sync the account ledger so balances follow any change to amount or
            // deposit account. Reverse every existing ledger row for this donation,
            // then re-create one for its current routing. Idempotent when nothing changed.
            $existing = $db->prepare("SELECT id, account_id, amount FROM account_ledger WHERE reference_type = 'donation' AND reference_id = ?");
            $existing->execute([$id]);
            $revert = $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?");
            $delLedger = $db->prepare("DELETE FROM account_ledger WHERE id = ?");
            foreach ($existing->fetchAll() as $er) {
                $revert->execute([(float)$er['amount'], $er['account_id']]);
                $delLedger->execute([$er['id']]);
            }

            // Reload the donation (post-update) for its current amount + routing.
            $cur = $db->prepare("
                SELECT d.*, COALESCE(CONCAT(m.first_name, ' ', m.last_name), d.donor_name, 'Anonymous') as who
                FROM donations d LEFT JOIN members m ON m.id = d.member_id WHERE d.id = ?
            ");
            $cur->execute([$id]);
            $don = $cur->fetch();

            if ($don && !empty($don['routed_account_id'])) {
                $acctId = (int)$don['routed_account_id'];
                $amt = (float)$don['amount'];
                $db->prepare("INSERT INTO account_ledger (account_id, entry_date, entry_type, amount, description, reference_type, reference_id, created_by) VALUES (?, ?, 'deposit', ?, ?, 'donation', ?, ?)")
                    ->execute([$acctId, $don['donation_date'], $amt, 'Donation: ' . $don['who'] . ' (' . $don['payment_method'] . ')', $id, $currentUser['user_id']]);
                $db->prepare("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?")->execute([$amt, $acctId]);
            }

            $db->commit();
        } catch (Exception $e) {
            $db->rollBack();
            jsonResponse(['error' => 'Failed to update donation: ' . $e->getMessage()], 500);
        }

        // Audit log
        try {
            $db->prepare("INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, description, old_values, new_values, ip_address, created_at) VALUES (?, ?, 'edit', ?, ?, ?, ?, ?, ?, NOW())")
                ->execute([
                    $currentUser['user_id'],
                    $currentUser['name'],
                    'donation',
                    $id,
                    'Edited donation #' . $id,
                    json_encode($oldRecord),
                    json_encode($data),
                    $_SERVER['REMOTE_ADDR'] ?? '',
                ]);
        } catch (Exception $e) { /* don't fail the main operation */ }

        jsonResponse(['message' => 'Donation updated']);
        break;

    case 'DELETE':
        // --- DELETE A VENDOR (registry) ---
        // Names already recorded on donations/expenses are stored as plain text,
        // so removing the registry row never touches existing transactions.
        if ($action === 'vendor') {
            if (!$id) jsonResponse(['error' => 'Vendor ID required'], 400);
            $db->prepare("DELETE FROM vendors WHERE id = ?")->execute([$id]);
            jsonResponse(['message' => 'Vendor deleted']);
        }

        // --- DELETE A LOAN TRANSACTION (both sides at once) ---
        if ($action === 'loan_transaction') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Ledger entry ID required'], 400);

            $group = loanLedgerGroup($db, $id);
            if (empty($group)) jsonResponse(['error' => 'Loan transaction not found'], 404);

            $db->beginTransaction();
            try {
                $revert = $db->prepare("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?");
                $del = $db->prepare("DELETE FROM account_ledger WHERE id = ?");
                foreach ($group as $row) {
                    $revert->execute([(float)$row['amount'], $row['account_id']]);
                    $del->execute([$row['id']]);
                }
                $db->commit();
                jsonResponse(['message' => 'Loan transaction deleted and balances reversed']);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Failed to delete loan: ' . $e->getMessage()], 500);
            }
        }

        // --- LOANS & RECEIVABLES: delete a whole loan (+ its repayments) ---
        if ($action === 'loan_record') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Loan ID required'], 400);
            $db->beginTransaction();
            try {
                $reps = $db->prepare("SELECT id FROM loan_repayments WHERE loan_id = ?"); $reps->execute([$id]);
                foreach ($reps->fetchAll() as $rp) loanReverseLedger($db, 'loan_repay', $rp['id']);
                $db->prepare("DELETE FROM loan_repayments WHERE loan_id = ?")->execute([$id]);
                loanReverseLedger($db, 'loan_issue', $id);
                $db->prepare("DELETE FROM loans WHERE id = ?")->execute([$id]);
                $db->commit();
                jsonResponse(['message' => 'Loan deleted and balances reversed']);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Failed to delete loan: ' . $e->getMessage()], 500);
            }
        }

        // --- LOANS & RECEIVABLES: delete one repayment ---
        if ($action === 'loan_repayment') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Repayment ID required'], 400);
            $r = $db->prepare("SELECT * FROM loan_repayments WHERE id = ?"); $r->execute([$id]); $rep = $r->fetch();
            if (!$rep) jsonResponse(['error' => 'Repayment not found'], 404);
            $db->beginTransaction();
            try {
                loanReverseLedger($db, 'loan_repay', $id);
                $db->prepare("DELETE FROM loan_repayments WHERE id = ?")->execute([$id]);
                $loanId = (int)$rep['loan_id'];
                $amt = (float)$db->query("SELECT amount FROM loans WHERE id = " . $loanId)->fetchColumn();
                $paid = (float)$db->query("SELECT COALESCE(SUM(amount),0) FROM loan_repayments WHERE loan_id = " . $loanId)->fetchColumn();
                $db->prepare("UPDATE loans SET status = ? WHERE id = ?")->execute([($paid + 0.005 >= $amt ? 'paid' : 'open'), $loanId]);
                $db->commit();
                jsonResponse(['message' => 'Repayment removed and balances reversed']);
            } catch (Exception $e) {
                $db->rollBack();
                jsonResponse(['error' => 'Failed to delete repayment: ' . $e->getMessage()], 500);
            }
        }

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

                // Audit log
                try {
                    $db->prepare("INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, description, old_values, new_values, ip_address, created_at) VALUES (?, ?, 'delete', ?, ?, ?, ?, NULL, ?, NOW())")
                        ->execute([
                            $currentUser['user_id'],
                            $currentUser['name'],
                            'donation',
                            $id,
                            'Deleted routed donation #' . $id,
                            json_encode($don),
                            $_SERVER['REMOTE_ADDR'] ?? '',
                        ]);
                } catch (Exception $e) { /* don't fail the main operation */ }

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

            // Fetch old values for audit log
            $oldStmt = $db->prepare("SELECT * FROM expenses WHERE id = ?");
            $oldStmt->execute([$id]);
            $oldRecord = $oldStmt->fetch();

            $db->prepare("DELETE FROM expenses WHERE id = ?")->execute([$id]);

            // Audit log
            try {
                $db->prepare("INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, description, old_values, new_values, ip_address, created_at) VALUES (?, ?, 'delete', ?, ?, ?, ?, NULL, ?, NOW())")
                    ->execute([
                        $currentUser['user_id'],
                        $currentUser['name'],
                        'expense',
                        $id,
                        'Deleted expense #' . $id,
                        json_encode($oldRecord),
                        $_SERVER['REMOTE_ADDR'] ?? '',
                    ]);
            } catch (Exception $e) { /* don't fail the main operation */ }

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

        // Fetch old values for audit log
        $oldStmt = $db->prepare("SELECT * FROM donations WHERE id = ?");
        $oldStmt->execute([$id]);
        $oldRecord = $oldStmt->fetch();

        $db->prepare("DELETE FROM donations WHERE id = ?")->execute([$id]);

        // Audit log
        try {
            $db->prepare("INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, description, old_values, new_values, ip_address, created_at) VALUES (?, ?, 'delete', ?, ?, ?, ?, NULL, ?, NOW())")
                ->execute([
                    $currentUser['user_id'],
                    $currentUser['name'],
                    'donation',
                    $id,
                    'Deleted donation #' . $id,
                    json_encode($oldRecord),
                    $_SERVER['REMOTE_ADDR'] ?? '',
                ]);
        } catch (Exception $e) { /* don't fail the main operation */ }

        jsonResponse(['message' => 'Donation deleted']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
 
