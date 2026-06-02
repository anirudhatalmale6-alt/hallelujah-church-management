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
        // Categories
        if ($action === 'categories') {
            $stmt = $db->query("SELECT * FROM donation_categories ORDER BY sort_order ASC");
            jsonResponse(['categories' => $stmt->fetchAll()]);
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

        // Financial summary/reports
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
                    default: // month
                        $dateFrom = date('Y-m-01');
                        $dateTo = date('Y-m-t');
                }
            }

            // Total by category
            $stmt = $db->prepare("
                SELECT dc.name as category_name, dc.id as category_id,
                       COALESCE(SUM(d.amount), 0) as total,
                       COUNT(d.id) as count
                FROM donation_categories dc
                LEFT JOIN donations d ON d.category_id = dc.id AND d.donation_date BETWEEN ? AND ?
                WHERE dc.is_active = 1
                GROUP BY dc.id, dc.name
                ORDER BY dc.sort_order ASC
            ");
            $stmt->execute([$dateFrom, $dateTo]);
            $byCategory = $stmt->fetchAll();

            // Grand total
            $stmt = $db->prepare("SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM donations WHERE donation_date BETWEEN ? AND ?");
            $stmt->execute([$dateFrom, $dateTo]);
            $totals = $stmt->fetch();

            // By payment method
            $stmt = $db->prepare("
                SELECT payment_method, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
                FROM donations WHERE donation_date BETWEEN ? AND ?
                GROUP BY payment_method ORDER BY total DESC
            ");
            $stmt->execute([$dateFrom, $dateTo]);
            $byMethod = $stmt->fetchAll();

            // Monthly trend (last 12 months)
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

            // Top givers
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

            // Recent donations
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

            jsonResponse([
                'by_category' => $byCategory,
                'by_method' => $byMethod,
                'totals' => $totals,
                'monthly_trend' => $monthlyTrend,
                'top_givers' => $topGivers,
                'recent' => $recent,
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
                'period' => $period,
            ]);
        }

        // List donations with filters
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

        // Sum for filtered results
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
        if ($action === 'category') {
            requireRole($currentUser, ['pastor', 'admin']);
            $data = getRequestBody();
            $name = trim($data['name'] ?? '');
            if (!$name) jsonResponse(['error' => 'Category name required'], 400);

            $maxOrder = (int)$db->query("SELECT COALESCE(MAX(sort_order), 0) FROM donation_categories")->fetchColumn() + 1;
            try {
                $stmt = $db->prepare("INSERT INTO donation_categories (name, description, sort_order) VALUES (?, ?, ?)");
                $stmt->execute([$name, $data['description'] ?? null, $maxOrder]);
                jsonResponse(['message' => 'Category created', 'id' => (int)$db->lastInsertId()], 201);
            } catch (Exception $e) {
                jsonResponse(['error' => 'Category already exists'], 400);
            }
        }

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

        // Single donation
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
        if ($action === 'category') {
            requireRole($currentUser, ['pastor', 'admin']);
            if (!$id) jsonResponse(['error' => 'Category ID required'], 400);
            $data = getRequestBody();
            $fields = [];
            $params = [];
            if (isset($data['name'])) { $fields[] = 'name = ?'; $params[] = $data['name']; }
            if (isset($data['description'])) { $fields[] = 'description = ?'; $params[] = $data['description']; }
            if (isset($data['sort_order'])) { $fields[] = 'sort_order = ?'; $params[] = (int)$data['sort_order']; }
            if (isset($data['is_active'])) { $fields[] = 'is_active = ?'; $params[] = (int)$data['is_active']; }
            if (empty($fields)) jsonResponse(['error' => 'Nothing to update'], 400);
            $params[] = $id;
            $db->prepare("UPDATE donation_categories SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
            jsonResponse(['message' => 'Category updated']);
        }

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

        requireRole($currentUser, ['pastor', 'admin']);
        if (!$id) jsonResponse(['error' => 'Donation ID required'], 400);
        $db->prepare("DELETE FROM donations WHERE id = ?")->execute([$id]);
        jsonResponse(['message' => 'Donation deleted']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
