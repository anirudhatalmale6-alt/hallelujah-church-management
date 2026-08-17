<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$db = getDB();

function getUtcRangeForLocalDate(string $localDate): array {
    $tz = new DateTimeZone('America/New_York');
    $start = new DateTime($localDate . ' 00:00:00', $tz);
    $start->setTimezone(new DateTimeZone('UTC'));
    $end = new DateTime($localDate . ' 00:00:00', $tz);
    $end->modify('+1 day');
    $end->setTimezone(new DateTimeZone('UTC'));
    return [$start->format('Y-m-d H:i:s'), $end->format('Y-m-d H:i:s')];
}

// Determine attendance status based on check-in time vs service start time.
// $checkinUtc lets a correction to an old log be judged against when the person
// actually arrived. Without it the comparison used "now", so fixing last Sunday's
// record today would have stamped everybody "late".
function getAttendanceStatus($db, $serviceId, ?string $checkinUtc = null) {
    if (!$serviceId) return 'present';
    $svc = $db->prepare("SELECT date, time FROM services WHERE id = ?");
    $svc->execute([$serviceId]);
    $service = $svc->fetch();
    if (!$service || !$service['time']) return 'present';

    $serviceStart = strtotime($service['date'] . ' ' . $service['time']);
    $arrived = time();
    if ($checkinUtc) {
        try {
            $arrived = (new DateTime($checkinUtc, new DateTimeZone('UTC')))->getTimestamp();
        } catch (Exception $e) { /* fall back to now */ }
    }
    $diffMinutes = ($arrived - $serviceStart) / 60;

    // If check-in is more than 15 minutes after service start -> late
    if ($diffMinutes > 15) return 'late';
    return 'present';
}

// A single small setting read/written straight from here rather than through
// settings.php, because settings.php is pastor/admin only and a volunteer running
// the kiosk still has to be able to see - and set - which service check-ins go to.
function getSetting(PDO $db, string $key, ?string $default = null): ?string {
    try {
        $stmt = $db->prepare("SELECT value FROM settings WHERE `key` = ?");
        $stmt->execute([$key]);
        $v = $stmt->fetchColumn();
        return ($v === false || $v === null || $v === '') ? $default : (string)$v;
    } catch (Exception $e) {
        return $default;
    }
}

function putSetting(PDO $db, string $key, ?string $value): void {
    $db->prepare("INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)")
       ->execute([$key, $value]);
}

// 'auto'   = when a service finishes, anyone still showing as checked in is
//            closed out at the service end time (what the pastor expects today).
// 'manual' = nobody is closed automatically; you check people out yourself with
//            the Check Out button, or by scanning their QR / barcode / PIN again.
function getCheckoutMode(PDO $db): string {
    return getSetting($db, 'checkout_mode', 'auto') === 'manual' ? 'manual' : 'auto';
}

// The end of a service as a UTC timestamp. Service date/time are stored in
// church-local time, so they have to be converted, not compared raw.
function serviceEndUtc(array $svc): ?string {
    if (empty($svc['time'])) return null;
    $hours = (float)($svc['duration_hours'] ?? 0);
    if ($hours <= 0) $hours = 2.0;
    $endLocalTs = strtotime($svc['date'] . ' ' . $svc['time']) + (int)round($hours * 3600);
    if ($endLocalTs === false) return null;
    return churchToUtc(date('Y-m-d H:i:s', $endLocalTs));
}

// Closes out anyone left hanging. Cheap enough to run whenever the log is opened,
// which matters because there is no cron job on this hosting plan - if it only ran
// from a scheduler it would never run at all.
function autoCheckoutSweep(PDO $db): int {
    if (getCheckoutMode($db) !== 'auto') return 0;
    $closed = 0;
    try {
        $services = $db->query("
            SELECT id, date, time, COALESCE(duration_hours, 2.0) AS duration_hours
            FROM services
            WHERE time IS NOT NULL AND date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
        ")->fetchAll();

        $nowUtc = utcNow();
        foreach ($services as $svc) {
            $endUtc = serviceEndUtc($svc);
            if (!$endUtc || $endUtc >= $nowUtc) continue;  // still running
            // GREATEST guards the odd case of someone scanned in after the service
            // already ended - that gets a zero-length visit rather than a negative one.
            $stmt = $db->prepare("
                UPDATE checkin_logs SET check_out_time = GREATEST(?, check_in_time)
                WHERE service_id = ? AND check_out_time IS NULL
            ");
            $stmt->execute([$endUtc, $svc['id']]);
            $closed += $stmt->rowCount();
        }

        // Check-ins recorded without a service have no end time to work from, so
        // they are given the default two hours, and only once their day is over -
        // today's are left alone so the live "Currently Checked In" list stays real.
        [$todayStartUtc] = getUtcRangeForLocalDate(date('Y-m-d'));
        $stmt = $db->prepare("
            UPDATE checkin_logs SET check_out_time = DATE_ADD(check_in_time, INTERVAL 2 HOUR)
            WHERE service_id IS NULL AND check_out_time IS NULL AND check_in_time < ?
        ");
        $stmt->execute([$todayStartUtc]);
        $closed += $stmt->rowCount();
    } catch (Exception $e) {
        // Never let the sweep break the page that triggered it.
        error_log('autoCheckoutSweep: ' . $e->getMessage());
    }
    return $closed;
}

// Kiosk endpoints - no auth required
if ($method === 'GET' && $action === 'active_services') {
    // Show services up to and including today, newest first — you check people in
    // for today's or a recent service, not future ones. The list reveals gradually
    // as real services take place instead of jumping weeks ahead.
    $today = date('Y-m-d');
    $stmt = $db->prepare("SELECT * FROM services WHERE date <= ? ORDER BY date DESC, time DESC LIMIT 20");
    $stmt->execute([$today]);
    $services = $stmt->fetchAll();
    jsonResponse(['services' => $services]);
}

// Which service everyone's check-ins are going into right now. Kept on the server
// on purpose: with three people checking people in from three different phones, a
// choice made on one device has to show up on all of them, or half the morning
// lands on the wrong service (or on no service at all).
if ($method === 'GET' && $action === 'active_service') {
    $sid = getSetting($db, 'checkin_active_service');
    $setAt = getSetting($db, 'checkin_active_service_at');
    $service = null;

    if ($sid) {
        $stmt = $db->prepare("SELECT id, name, date, time, COALESCE(duration_hours, 2.0) AS duration_hours FROM services WHERE id = ?");
        $stmt->execute([(int)$sid]);
        $service = $stmt->fetch() ?: null;
    }
    // Back-filling an older service on purpose is legitimate, so the choice is never
    // overridden - but a pick left over from a previous week would quietly file today's
    // attendance under an old service, so the screen is told to warn about it.
    $isToday = $service ? ($service['date'] === date('Y-m-d')) : null;

    // Nothing chosen yet for today: suggest the sensible one instead of making the
    // volunteer guess. Preference order is the service running now, then the next
    // one due today, then today's last one.
    $suggested = null;
    if (!$service) {
        $stmt = $db->prepare("
            SELECT id, name, date, time, COALESCE(duration_hours, 2.0) AS duration_hours
            FROM services WHERE date = ? AND time IS NOT NULL ORDER BY time ASC
        ");
        $stmt->execute([date('Y-m-d')]);
        $todays = $stmt->fetchAll();
        $nowTs = time();
        foreach ($todays as $t) {
            $startTs = strtotime($t['date'] . ' ' . $t['time']);
            $endTs = $startTs + (int)round(((float)$t['duration_hours'] ?: 2.0) * 3600);
            if ($nowTs >= $startTs - 3600 && $nowTs <= $endTs) { $suggested = $t; break; }
        }
        if (!$suggested) {
            foreach ($todays as $t) {
                if (strtotime($t['date'] . ' ' . $t['time']) > $nowTs) { $suggested = $t; break; }
            }
        }
        if (!$suggested && $todays) $suggested = end($todays);
    }

    jsonResponse([
        'service_id' => $service ? (int)$service['id'] : null,
        'service' => $service,
        'is_today' => $isToday,
        'suggested' => $suggested,
        'set_at' => $setAt,
        'set_by' => getSetting($db, 'checkin_active_service_by'),
        'checkout_mode' => getCheckoutMode($db),
    ]);
}

if ($method === 'POST' && $action === 'quick_register') {
    $data = getRequestBody();
    if (empty($data['first_name']) || empty($data['last_name']) || empty($data['phone'])) {
        jsonResponse(['error' => 'First name, last name, and phone are required'], 400);
    }

    $firstName = trim($data['first_name']);
    $lastName = trim($data['last_name']);
    $phone = trim($data['phone']);
    $email = isset($data['email']) ? trim($data['email']) : null;

    $dup = $db->prepare("SELECT id FROM members WHERE first_name = ? AND last_name = ? AND phone = ?");
    $dup->execute([$firstName, $lastName, $phone]);
    if ($dup->fetch()) {
        jsonResponse(['error' => 'This person already exists in the system'], 400);
    }

    $stmt = $db->prepare("
        INSERT INTO members (first_name, last_name, phone, email, person_type, status, first_visit_date)
        VALUES (?, ?, ?, ?, 'non_member_attendee', 'active', CURDATE())
    ");
    $stmt->execute([$firstName, $lastName, $phone, $email]);
    $newId = (int)$db->lastInsertId();

    // The person is standing at the kiosk and ticks this box themselves, so it
    // is first-party consent - the strongest kind. Record when and how, and
    // write the same proof line the website sign-up writes.
    if (!empty($data['sms_consent'])) {
        $db->prepare("
            UPDATE members
            SET sms_consent = 1,
                sms_consent_at = NOW(),
                sms_consent_source = 'checkin_kiosk',
                sms_consent_proof = ?
            WHERE id = ?
        ")->execute([$_SERVER['REMOTE_ADDR'] ?? '', $newId]);

        $digits = preg_replace('/\D+/', '', $phone);
        if (strlen($digits) === 11 && $digits[0] === '1') $digits = substr($digits, 1);
        $row = [
            gmdate('Y-m-d H:i:s') . ' UTC',
            "$firstName $lastName",
            (strlen($digits) === 10 ? '+1' . $digits : $phone),
            $_SERVER['REMOTE_ADDR'] ?? '',
            substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 200),
            'check-in kiosk (new person registration)',
        ];
        @file_put_contents(
            __DIR__ . '/../../../hitc_sms_consent.csv',
            '"' . implode('","', array_map(fn($v) => str_replace('"', '""', $v), $row)) . "\"\n",
            FILE_APPEND | LOCK_EX
        );
    }

    $qrCode = strtoupper(bin2hex(random_bytes(8)));
    $attempts = 0;
    do {
        $pin = str_pad(random_int(1000, 9999), 4, '0', STR_PAD_LEFT);
        $pinCheck = $db->prepare("SELECT id FROM member_checkin_codes WHERE pin_code = ?");
        $pinCheck->execute([$pin]);
        $attempts++;
    } while ($pinCheck->fetch() && $attempts < 100);

    $db->prepare("INSERT INTO member_checkin_codes (member_id, qr_code, barcode_code, pin_code) VALUES (?, ?, ?, ?)")
       ->execute([$newId, $qrCode, $qrCode, $pin]);

    $serviceId = $data['service_id'] ?? null;
    $db->prepare("INSERT INTO checkin_logs (member_id, service_id, check_in_time, checkin_method) VALUES (?, ?, NOW(), 'manual')")
       ->execute([$newId, $serviceId]);

    if ($serviceId) {
        $attStatus = getAttendanceStatus($db, $serviceId);
        $db->prepare("INSERT INTO attendance (service_id, member_id, status, check_in_time) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE status = VALUES(status), check_in_time = NOW()")
           ->execute([$serviceId, $newId, $attStatus]);
    }

    jsonResponse([
        'action' => 'check_in',
        'message' => "$firstName $lastName registered and checked in",
        'member' => ['member_id' => $newId, 'first_name' => $firstName, 'last_name' => $lastName],
        'pin_code' => $pin,
    ]);
}

// QR check-in endpoint doesn't require auth (kiosk mode)
if ($method === 'POST' && ($action === 'qr_checkin' || $action === 'pin_checkin')) {
    $data = getRequestBody();

    if ($action === 'qr_checkin') {
        if (empty($data['qr_code'])) {
            jsonResponse(['error' => 'QR code required'], 400);
        }
        // A scan can come from the QR (front) or the barcode (back). Since the
        // two can now be regenerated independently they may differ, so match
        // either. COALESCE keeps this working for rows migrated before the split.
        $scanned = $data['qr_code'];
        $stmt = $db->prepare("
            SELECT c.member_id, m.first_name, m.last_name, m.photo_url
            FROM member_checkin_codes c
            JOIN members m ON m.id = c.member_id
            WHERE c.qr_code = ? OR COALESCE(c.barcode_code, c.qr_code) = ?
        ");
        $stmt->execute([$scanned, $scanned]);
    } else {
        if (empty($data['pin_code'])) {
            jsonResponse(['error' => 'PIN code required'], 400);
        }
        $stmt = $db->prepare("
            SELECT c.member_id, m.first_name, m.last_name, m.photo_url
            FROM member_checkin_codes c
            JOIN members m ON m.id = c.member_id
            WHERE c.pin_code = ?
        ");
        $stmt->execute([$data['pin_code']]);
    }

    $member = $stmt->fetch();
    if (!$member) {
        jsonResponse(['error' => 'Invalid code. Person not found.'], 404);
    }

    $serviceId = $data['service_id'] ?? null;
    $checkinMethod = $action === 'qr_checkin' ? 'qr' : 'pin';

    // Check if already checked in today for this service
    [$utcStart, $utcEnd] = getUtcRangeForLocalDate(date('Y-m-d'));
    $existsStmt = $db->prepare("
        SELECT id, check_out_time FROM checkin_logs
        WHERE member_id = ? AND check_in_time >= ? AND check_in_time < ?
        AND (service_id = ? OR (service_id IS NULL AND ? IS NULL))
        AND check_out_time IS NULL
        ORDER BY check_in_time DESC LIMIT 1
    ");
    $existsStmt->execute([$member['member_id'], $utcStart, $utcEnd, $serviceId, $serviceId]);
    $existing = $existsStmt->fetch();

    if ($existing) {
        // Already checked in, do check-out
        $stmt = $db->prepare("UPDATE checkin_logs SET check_out_time = NOW() WHERE id = ?");
        $stmt->execute([$existing['id']]);

        // Also mark attendance as present
        if ($serviceId) {
            $attStmt = $db->prepare("
                INSERT INTO attendance (service_id, member_id, status, check_in_time)
                VALUES (?, ?, 'present', NOW())
                ON DUPLICATE KEY UPDATE status = 'present'
            ");
            $attStmt->execute([$serviceId, $member['member_id']]);
        }

        jsonResponse([
            'action' => 'check_out',
            'message' => $member['first_name'] . ' ' . $member['last_name'] . ' checked out',
            'member' => $member,
        ]);
    }

    // Check in
    $stmt = $db->prepare("
        INSERT INTO checkin_logs (member_id, service_id, check_in_time, checkin_method)
        VALUES (?, ?, NOW(), ?)
    ");
    $stmt->execute([$member['member_id'], $serviceId, $checkinMethod]);

    // Also mark attendance
    if ($serviceId) {
        $attStatus = getAttendanceStatus($db, $serviceId);
        $attStmt = $db->prepare("
            INSERT INTO attendance (service_id, member_id, status, check_in_time)
            VALUES (?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE status = VALUES(status), check_in_time = NOW()
        ");
        $attStmt->execute([$serviceId, $member['member_id'], $attStatus]);
    }

    jsonResponse([
        'action' => 'check_in',
        'message' => $member['first_name'] . ' ' . $member['last_name'] . ' checked in',
        'member' => $member,
    ]);
}

// All other endpoints require auth
$currentUser = authenticate();

switch ($method) {
    case 'GET':
        if ($action === 'codes') {
            // Make sure EVERY member has a code so the card list is complete
            // (any status/person type). Previously only active members ever got
            // codes, so people without one never appeared on the print list.
            $missing = $db->query("
                SELECT m.id FROM members m
                LEFT JOIN member_checkin_codes c ON c.member_id = m.id
                WHERE c.id IS NULL
            ")->fetchAll(PDO::FETCH_COLUMN);
            foreach ($missing as $mid) {
                $qrCode = strtoupper(bin2hex(random_bytes(8)));
                $attempts = 0;
                do {
                    $pin = str_pad(random_int(1000, 9999), 4, '0', STR_PAD_LEFT);
                    $pinCheck = $db->prepare("SELECT id FROM member_checkin_codes WHERE pin_code = ?");
                    $pinCheck->execute([$pin]);
                    $attempts++;
                } while ($pinCheck->fetch() && $attempts < 100);
                $ins = $db->prepare("INSERT INTO member_checkin_codes (member_id, qr_code, barcode_code, pin_code) VALUES (?, ?, ?, ?)");
                $ins->execute([(int)$mid, $qrCode, $qrCode, $pin]);
            }

            // Get all member codes
            $stmt = $db->query("
                SELECT c.*, m.first_name, m.last_name, m.email, m.phone, m.photo_url, m.person_type, m.card_title, m.card_expiry_date, m.status as member_status
                FROM member_checkin_codes c
                JOIN members m ON m.id = c.member_id
                ORDER BY m.last_name, m.first_name
            ");
            jsonResponse(['codes' => $stmt->fetchAll()]);

        } elseif ($action === 'member_code') {
            $memberId = (int)($_GET['member_id'] ?? 0);
            if (!$memberId) jsonResponse(['error' => 'member_id required'], 400);

            $stmt = $db->prepare("SELECT * FROM member_checkin_codes WHERE member_id = ?");
            $stmt->execute([$memberId]);
            $code = $stmt->fetch();
            jsonResponse(['code' => $code ?: null]);

        } elseif ($action === 'logs') {
            // Close out finished services before reading, so the log the pastor is
            // looking at is already correct. No-op when check-out mode is manual.
            autoCheckoutSweep($db);

            // Get check-in logs with filters
            $dateFrom = $_GET['date_from'] ?? date('Y-m-d');
            $dateTo = $_GET['date_to'] ?? date('Y-m-d');
            $memberId = $_GET['member_id'] ?? null;
            $serviceId = $_GET['service_id'] ?? null;

            [$rangeStart] = getUtcRangeForLocalDate($dateFrom);
            [, $rangeEnd] = getUtcRangeForLocalDate($dateTo);
            $where = ["cl.check_in_time >= ? AND cl.check_in_time < ?"];
            $params = [$rangeStart, $rangeEnd];

            if ($memberId) {
                $where[] = "cl.member_id = ?";
                $params[] = (int)$memberId;
            }
            if ($serviceId) {
                $where[] = "cl.service_id = ?";
                $params[] = (int)$serviceId;
            }

            $whereStr = implode(' AND ', $where);
            $stmt = $db->prepare("
                SELECT cl.*, m.first_name, m.last_name, m.photo_url,
                       s.name as service_name, s.date as service_date,
                       u.name as checked_in_by_name
                FROM checkin_logs cl
                JOIN members m ON m.id = cl.member_id
                LEFT JOIN services s ON s.id = cl.service_id
                LEFT JOIN users u ON u.id = cl.checked_in_by
                WHERE $whereStr
                ORDER BY cl.check_in_time DESC
            ");
            $stmt->execute($params);
            jsonResponse(['logs' => $stmt->fetchAll()]);

        } elseif ($action === 'hours_report') {
            // Hours report for clock-in/out
            $dateFrom = $_GET['date_from'] ?? date('Y-m-01');
            $dateTo = $_GET['date_to'] ?? date('Y-m-d');
            $memberId = $_GET['member_id'] ?? null;

            [$hRangeStart] = getUtcRangeForLocalDate($dateFrom);
            [, $hRangeEnd] = getUtcRangeForLocalDate($dateTo);
            $where = ["cl.check_in_time >= ? AND cl.check_in_time < ?", "cl.check_out_time IS NOT NULL"];
            $params = [$hRangeStart, $hRangeEnd];

            if ($memberId) {
                $where[] = "cl.member_id = ?";
                $params[] = (int)$memberId;
            }

            $whereStr = implode(' AND ', $where);
            $stmt = $db->prepare("
                SELECT cl.member_id, m.first_name, m.last_name,
                       COUNT(*) as sessions,
                       SUM(TIMESTAMPDIFF(MINUTE, cl.check_in_time, cl.check_out_time)) as total_minutes,
                       MIN(cl.check_in_time) as first_checkin,
                       MAX(cl.check_out_time) as last_checkout
                FROM checkin_logs cl
                JOIN members m ON m.id = cl.member_id
                WHERE $whereStr
                GROUP BY cl.member_id
                ORDER BY total_minutes DESC
            ");
            $stmt->execute($params);
            $report = $stmt->fetchAll();

            foreach ($report as &$row) {
                $hours = floor($row['total_minutes'] / 60);
                $mins = $row['total_minutes'] % 60;
                $row['total_hours'] = $hours . 'h ' . $mins . 'm';
            }

            jsonResponse(['report' => $report, 'date_from' => $dateFrom, 'date_to' => $dateTo]);

        } elseif ($action === 'today') {
            autoCheckoutSweep($db);

            // Today's check-ins for dashboard
            [$utcStart, $utcEnd] = getUtcRangeForLocalDate(date('Y-m-d'));
            $stmt = $db->prepare("
                SELECT cl.*, m.first_name, m.last_name, m.photo_url,
                       s.name as service_name
                FROM checkin_logs cl
                JOIN members m ON m.id = cl.member_id
                LEFT JOIN services s ON s.id = cl.service_id
                WHERE cl.check_in_time >= ? AND cl.check_in_time < ?
                ORDER BY cl.check_in_time DESC
            ");
            $stmt->execute([$utcStart, $utcEnd]);
            $logs = $stmt->fetchAll();

            $checkedIn = count(array_filter($logs, fn($l) => !$l['check_out_time']));
            $checkedOut = count(array_filter($logs, fn($l) => $l['check_out_time']));

            jsonResponse([
                'logs' => $logs,
                'summary' => ['checked_in' => $checkedIn, 'checked_out' => $checkedOut, 'total' => count($logs)]
            ]);

        } else {
            jsonResponse(['error' => 'Invalid action'], 400);
        }
        break;

    case 'POST':
        $data = getRequestBody();

        if ($action === 'generate_codes') {
            // Generate QR + PIN codes for members who don't have them
            $memberIds = $data['member_ids'] ?? [];
            if (empty($memberIds)) {
                // Generate for all active members without codes
                $stmt = $db->query("
                    SELECT m.id FROM members m
                    LEFT JOIN member_checkin_codes c ON c.member_id = m.id
                    WHERE m.status IN ('active', 'restored') AND c.id IS NULL
                ");
                $memberIds = $stmt->fetchAll(PDO::FETCH_COLUMN);
            }

            $generated = 0;
            foreach ($memberIds as $mid) {
                $mid = (int)$mid;
                // Check if already exists
                $check = $db->prepare("SELECT id FROM member_checkin_codes WHERE member_id = ?");
                $check->execute([$mid]);
                if ($check->fetch()) continue;

                $qrCode = strtoupper(bin2hex(random_bytes(8)));
                // Generate unique 4-digit PIN
                $attempts = 0;
                do {
                    $pin = str_pad(random_int(1000, 9999), 4, '0', STR_PAD_LEFT);
                    $pinCheck = $db->prepare("SELECT id FROM member_checkin_codes WHERE pin_code = ?");
                    $pinCheck->execute([$pin]);
                    $attempts++;
                } while ($pinCheck->fetch() && $attempts < 100);

                $stmt = $db->prepare("INSERT INTO member_checkin_codes (member_id, qr_code, barcode_code, pin_code) VALUES (?, ?, ?, ?)");
                $stmt->execute([$mid, $qrCode, $qrCode, $pin]);
                $generated++;
            }

            jsonResponse(['message' => "$generated codes generated", 'count' => $generated]);

        } elseif ($action === 'manual_checkin') {
            $error = validateRequired($data, ['member_id']);
            if ($error) jsonResponse(['error' => $error], 400);

            $memberId = (int)$data['member_id'];
            $serviceId = $data['service_id'] ?? null;
            $method = in_array($data['method'] ?? '', ['manual', 'offline']) ? $data['method'] : 'manual';
            $checkinTime = !empty($data['check_in_time']) ? churchToUtc($data['check_in_time']) : utcNow();

            $stmt = $db->prepare("
                INSERT INTO checkin_logs (member_id, service_id, check_in_time, checkin_method, checked_in_by, notes)
                VALUES (?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([$memberId, $serviceId, $checkinTime, $method, $currentUser['user_id'], $data['notes'] ?? null]);

            if ($serviceId) {
                // A staff member checked this person in by hand, so the attendance
                // record carries their name (a QR/PIN self check-in leaves it empty).
                $attStatus = getAttendanceStatus($db, $serviceId, $checkinTime);
                $attStmt = $db->prepare("
                    INSERT INTO attendance (service_id, member_id, status, check_in_time, marked_by)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE status = VALUES(status), check_in_time = VALUES(check_in_time), marked_by = VALUES(marked_by)
                ");
                $attStmt->execute([$serviceId, $memberId, $attStatus, $checkinTime, $currentUser['user_id']]);
            }

            $stmt = $db->prepare("SELECT first_name, last_name FROM members WHERE id = ?");
            $stmt->execute([$memberId]);
            $m = $stmt->fetch();

            jsonResponse(['message' => ($m['first_name'] ?? '') . ' ' . ($m['last_name'] ?? '') . ' checked in']);

        } elseif ($action === 'set_active_service') {
            // Deliberately not restricted to pastor/admin: anyone trusted to check
            // people in has to be able to say which service they are checking in for.
            $sid = $data['service_id'] ?? null;
            $sid = ($sid === '' || $sid === null) ? null : (int)$sid;
            if ($sid) {
                $chk = $db->prepare("SELECT id FROM services WHERE id = ?");
                $chk->execute([$sid]);
                if (!$chk->fetch()) jsonResponse(['error' => 'Service not found'], 404);
            }
            putSetting($db, 'checkin_active_service', $sid ? (string)$sid : '');
            putSetting($db, 'checkin_active_service_at', utcNow());
            putSetting($db, 'checkin_active_service_by', $currentUser['name'] ?? ($currentUser['username'] ?? ''));
            jsonResponse(['message' => 'Active service updated', 'service_id' => $sid]);

        } elseif ($action === 'set_checkout_mode') {
            requireRole($currentUser, ['pastor', 'admin']);
            $mode = ($data['mode'] ?? 'auto') === 'manual' ? 'manual' : 'auto';
            putSetting($db, 'checkout_mode', $mode);
            $closed = $mode === 'auto' ? autoCheckoutSweep($db) : 0;
            jsonResponse(['message' => 'Check-out mode set to ' . $mode, 'mode' => $mode, 'closed' => $closed]);

        } elseif ($action === 'auto_checkout') {
            $closed = autoCheckoutSweep($db);
            jsonResponse([
                'message' => $closed . ' check-in(s) closed out',
                'closed' => $closed,
                'mode' => getCheckoutMode($db),
            ]);

        } elseif ($action === 'manual_checkout') {
            $logId = (int)($data['log_id'] ?? 0);
            if (!$logId) jsonResponse(['error' => 'log_id required'], 400);

            $stmt = $db->prepare("UPDATE checkin_logs SET check_out_time = NOW() WHERE id = ? AND check_out_time IS NULL");
            $stmt->execute([$logId]);

            if ($stmt->rowCount() === 0) {
                jsonResponse(['error' => 'Log not found or already checked out'], 404);
            }
            jsonResponse(['message' => 'Checked out successfully']);

        } elseif ($action === 'mark_absent') {
            try {
                $now = utcNow();
                $endedServices = $db->prepare("
                    SELECT id, name, date, time, COALESCE(duration_hours, 2.0) as duration_hours
                    FROM services
                    WHERE time IS NOT NULL
                    AND CAST(ADDTIME(CONCAT(date, ' ', time), SEC_TO_TIME(COALESCE(duration_hours, 2.0) * 3600)) AS DATETIME) < CAST(? AS DATETIME)
                    AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                ");
                $endedServices->execute([$now]);
                $services = $endedServices->fetchAll();

                $marked = 0;
                foreach ($services as $svc) {
                    $missingStmt = $db->prepare("
                        SELECT m.id
                        FROM members m
                        WHERE m.status IN ('active', 'restored')
                        AND m.person_type = 'church_member'
                        AND m.id NOT IN (
                            SELECT member_id FROM attendance WHERE service_id = ?
                        )
                    ");
                    $missingStmt->execute([$svc['id']]);
                    $missingMembers = $missingStmt->fetchAll(PDO::FETCH_COLUMN);

                    foreach ($missingMembers as $memberId) {
                        try {
                            $db->prepare("INSERT INTO attendance (service_id, member_id, status, notes) VALUES (?, ?, 'absent', 'Auto-marked absent') ON DUPLICATE KEY UPDATE status = status")
                                ->execute([$svc['id'], $memberId]);
                            $marked++;
                        } catch (Exception $e) {}
                    }
                }
                jsonResponse(['message' => "$marked member(s) marked as absent", 'count' => $marked, 'services_checked' => count($services)]);
            } catch (Exception $e) {
                jsonResponse(['error' => 'mark_absent failed: ' . $e->getMessage()], 500);
            }

        } elseif ($action === 'edit_log') {
            $logId = (int)($data['log_id'] ?? 0);
            if (!$logId) jsonResponse(['error' => 'log_id required'], 400);

            $updates = [];
            $params = [];
            // The screen sends church-local wall-clock time, because that is what the
            // person typed. Storage is UTC, so it has to be converted - without this
            // every hand-edited time was saved four hours out.
            if (isset($data['check_in_time']) && $data['check_in_time']) {
                $updates[] = "check_in_time = ?";
                $params[] = churchToUtc($data['check_in_time']);
            }
            if (isset($data['check_out_time'])) {
                if ($data['check_out_time']) {
                    $updates[] = "check_out_time = ?";
                    $params[] = churchToUtc($data['check_out_time']);
                } else {
                    $updates[] = "check_out_time = NULL";
                }
            }
            // Lets the pastor rescue a check-in that was recorded with no service
            // (or against the wrong one) instead of deleting and redoing it.
            $serviceChanged = array_key_exists('service_id', $data);
            $newServiceId = null;
            if ($serviceChanged) {
                $newServiceId = ($data['service_id'] === '' || $data['service_id'] === null) ? null : (int)$data['service_id'];
                $updates[] = "service_id = ?";
                $params[] = $newServiceId;
            }
            if (empty($updates)) jsonResponse(['error' => 'Nothing to update'], 400);

            $existing = $db->prepare("SELECT member_id, service_id FROM checkin_logs WHERE id = ?");
            $existing->execute([$logId]);
            $before = $existing->fetch();

            $params[] = $logId;
            $stmt = $db->prepare("UPDATE checkin_logs SET " . implode(', ', $updates) . " WHERE id = ?");
            $stmt->execute($params);

            // Keep the attendance register in step: moving a check-in onto a service
            // has to actually mark the person present for it, otherwise the log looks
            // right while the attendance report stays wrong.
            if ($serviceChanged && $before) {
                $after = $db->prepare("SELECT check_in_time FROM checkin_logs WHERE id = ?");
                $after->execute([$logId]);
                $ci = $after->fetchColumn() ?: utcNow();

                if ($newServiceId) {
                    $db->prepare("
                        INSERT INTO attendance (service_id, member_id, status, check_in_time, marked_by)
                        VALUES (?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE status = VALUES(status), check_in_time = VALUES(check_in_time), marked_by = VALUES(marked_by)
                    ")->execute([$newServiceId, $before['member_id'], getAttendanceStatus($db, $newServiceId, $ci), $ci, $currentUser['user_id']]);
                }
                // The old service keeps its record only if another check-in still
                // backs it up; otherwise the person was never there.
                if (!empty($before['service_id']) && (int)$before['service_id'] !== (int)$newServiceId) {
                    $others = $db->prepare("SELECT COUNT(*) FROM checkin_logs WHERE member_id = ? AND service_id = ? AND id <> ?");
                    $others->execute([$before['member_id'], $before['service_id'], $logId]);
                    if ((int)$others->fetchColumn() === 0) {
                        $db->prepare("DELETE FROM attendance WHERE service_id = ? AND member_id = ?")
                           ->execute([$before['service_id'], $before['member_id']]);
                    }
                }
            }

            jsonResponse(['message' => 'Check-in log updated']);

        } elseif ($action === 'regenerate_code') {
            $memberId = (int)($data['member_id'] ?? 0);
            if (!$memberId) jsonResponse(['error' => 'member_id required'], 400);

            // The pastor picks which of the three tokens to regenerate so a card
            // that's already printed can keep the parts that haven't changed.
            // Default (no targets given) = regenerate everything, matching the
            // old behaviour for any caller that hasn't been updated.
            $targets = $data['targets'] ?? ['qr', 'barcode', 'pin'];
            if (!is_array($targets)) $targets = [$targets];
            $doQr      = in_array('qr', $targets, true);
            $doBarcode = in_array('barcode', $targets, true);
            $doPin     = in_array('pin', $targets, true);
            if (!$doQr && !$doBarcode && !$doPin) {
                jsonResponse(['error' => 'Choose at least one of QR code, barcode or PIN to regenerate'], 400);
            }

            // Make sure a row exists (and backfill barcode_code for legacy rows).
            $has = $db->prepare("SELECT id FROM member_checkin_codes WHERE member_id = ?");
            $has->execute([$memberId]);
            if (!$has->fetch()) {
                $seedQr = strtoupper(bin2hex(random_bytes(8)));
                $seedPin = str_pad(random_int(1000, 9999), 4, '0', STR_PAD_LEFT);
                $db->prepare("INSERT INTO member_checkin_codes (member_id, qr_code, barcode_code, pin_code) VALUES (?, ?, ?, ?)")
                   ->execute([$memberId, $seedQr, $seedQr, $seedPin]);
            }
            $db->prepare("UPDATE member_checkin_codes SET barcode_code = qr_code WHERE member_id = ? AND (barcode_code IS NULL OR barcode_code = '')")
               ->execute([$memberId]);

            $sets = [];
            $params = [];

            $uniqueHex = function ($column) use ($db, $memberId) {
                $attempts = 0;
                do {
                    $val = strtoupper(bin2hex(random_bytes(8)));
                    // Neither token may collide with any QR or barcode in use.
                    $chk = $db->prepare("SELECT id FROM member_checkin_codes WHERE (qr_code = ? OR barcode_code = ?) AND member_id != ?");
                    $chk->execute([$val, $val, $memberId]);
                    $attempts++;
                } while ($chk->fetch() && $attempts < 100);
                return $val;
            };

            $newQr = $newBarcode = $newPin = null;
            if ($doQr)      { $newQr = $uniqueHex('qr_code');           $sets[] = 'qr_code = ?';      $params[] = $newQr; }
            if ($doBarcode) { $newBarcode = $uniqueHex('barcode_code'); $sets[] = 'barcode_code = ?'; $params[] = $newBarcode; }
            if ($doPin) {
                $attempts = 0;
                do {
                    $newPin = str_pad(random_int(1000, 9999), 4, '0', STR_PAD_LEFT);
                    $pinCheck = $db->prepare("SELECT id FROM member_checkin_codes WHERE pin_code = ? AND member_id != ?");
                    $pinCheck->execute([$newPin, $memberId]);
                    $attempts++;
                } while ($pinCheck->fetch() && $attempts < 100);
                $sets[] = 'pin_code = ?';
                $params[] = $newPin;
            }

            $params[] = $memberId;
            $db->prepare("UPDATE member_checkin_codes SET " . implode(', ', $sets) . " WHERE member_id = ?")
               ->execute($params);

            // Return the full current row so the UI always shows the live values.
            $cur = $db->prepare("SELECT qr_code, barcode_code, pin_code FROM member_checkin_codes WHERE member_id = ?");
            $cur->execute([$memberId]);
            $row = $cur->fetch();
            jsonResponse([
                'message'   => 'Code regenerated',
                'qr_code'   => $row['qr_code'],
                'barcode_code' => $row['barcode_code'],
                'pin_code'  => $row['pin_code'],
                'regenerated' => array_values(array_keys(array_filter(['qr' => $doQr, 'barcode' => $doBarcode, 'pin' => $doPin]))),
            ]);

        } else {
            jsonResponse(['error' => 'Invalid action'], 400);
        }
        break;

    case 'DELETE':
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'ID required'], 400);

        if ($action === 'code') {
            $stmt = $db->prepare("DELETE FROM member_checkin_codes WHERE id = ?");
            $stmt->execute([$id]);
            jsonResponse(['message' => 'Code deleted']);
        } else {
            $stmt = $db->prepare("DELETE FROM checkin_logs WHERE id = ?");
            $stmt->execute([$id]);
            jsonResponse(['message' => 'Log deleted']);
        }
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
