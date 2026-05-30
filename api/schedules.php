<?php
/**
 * Hallelujah In The City - Church Management System
 * Service Schedules API - Recurring service management
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$action = $_GET['action'] ?? '';
$db = getDB();

$dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

switch ($method) {
    case 'GET':
        if ($action === 'generate_preview') {
            // Preview what services would be auto-created
            $weeksAhead = min(8, max(1, (int)($_GET['weeks'] ?? 4)));
            $schedules = $db->query("SELECT * FROM service_schedules WHERE is_active = 1 ORDER BY day_of_week ASC, time ASC")->fetchAll();

            $preview = [];
            $today = new DateTime();

            foreach ($schedules as $sched) {
                for ($w = 0; $w < $weeksAhead; $w++) {
                    $dates = getScheduleDates($sched, $today, $w);
                    foreach ($dates as $date) {
                        $dateStr = $date->format('Y-m-d');
                        // Check if already exists
                        $exists = $db->prepare("SELECT id FROM services WHERE date = ? AND type = ? AND time = ?");
                        $exists->execute([$dateStr, $sched['type'], $sched['time']]);
                        $existingId = $exists->fetchColumn();

                        $preview[] = [
                            'schedule_id' => $sched['id'],
                            'name' => $sched['name'],
                            'type' => $sched['type'],
                            'date' => $dateStr,
                            'time' => $sched['time'],
                            'day_name' => $dayNames[$sched['day_of_week']],
                            'already_exists' => $existingId ? true : false,
                            'existing_service_id' => $existingId ?: null,
                        ];
                    }
                }
            }

            usort($preview, fn($a, $b) => strcmp($a['date'] . $a['time'], $b['date'] . $b['time']));
            jsonResponse(['preview' => $preview, 'weeks_ahead' => $weeksAhead]);

        } elseif ($id) {
            $stmt = $db->prepare("SELECT * FROM service_schedules WHERE id = ?");
            $stmt->execute([$id]);
            $schedule = $stmt->fetch();
            if (!$schedule) jsonResponse(['error' => 'Schedule not found'], 404);
            jsonResponse(['schedule' => $schedule]);
        } else {
            $schedules = $db->query("SELECT * FROM service_schedules ORDER BY day_of_week ASC, time ASC")->fetchAll();
            jsonResponse(['schedules' => $schedules]);
        }
        break;

    case 'POST':
        requireRole($currentUser, ['pastor', 'admin']);

        if ($action === 'generate') {
            // Auto-create services from schedules
            $weeksAhead = min(8, max(1, (int)($_GET['weeks'] ?? 4)));
            $schedules = $db->query("SELECT * FROM service_schedules WHERE is_active = 1")->fetchAll();

            $created = 0;
            $skipped = 0;
            $today = new DateTime();

            foreach ($schedules as $sched) {
                for ($w = 0; $w < $weeksAhead; $w++) {
                    $dates = getScheduleDates($sched, $today, $w);
                    foreach ($dates as $date) {
                        $dateStr = $date->format('Y-m-d');
                        $exists = $db->prepare("SELECT COUNT(*) FROM services WHERE date = ? AND type = ? AND time = ?");
                        $exists->execute([$dateStr, $sched['type'], $sched['time']]);
                        if ($exists->fetchColumn() > 0) {
                            $skipped++;
                            continue;
                        }

                        $insert = $db->prepare("INSERT INTO services (name, date, time, type) VALUES (?, ?, ?, ?)");
                        $insert->execute([$sched['name'], $dateStr, $sched['time'], $sched['type']]);
                        $created++;
                    }
                }
            }

            jsonResponse(['message' => "$created service(s) created, $skipped already existed", 'created' => $created, 'skipped' => $skipped]);

        } else {
            $data = getRequestBody();
            $error = validateRequired($data, ['name', 'type', 'day_of_week', 'time']);
            if ($error) jsonResponse(['error' => $error], 400);

            $stmt = $db->prepare("INSERT INTO service_schedules (name, type, day_of_week, time, frequency) VALUES (?, ?, ?, ?, ?)");
            $stmt->execute([
                trim($data['name']),
                $data['type'],
                (int)$data['day_of_week'],
                $data['time'],
                $data['frequency'] ?? 'weekly',
            ]);

            jsonResponse(['message' => 'Schedule created', 'id' => (int)$db->lastInsertId()], 201);
        }
        break;

    case 'PUT':
        requireRole($currentUser, ['pastor', 'admin']);
        if (!$id) jsonResponse(['error' => 'Schedule ID required'], 400);

        $data = getRequestBody();
        $fields = [];
        $params = [];
        $allowed = ['name', 'type', 'day_of_week', 'time', 'frequency', 'is_active', 'auto_create_weeks_ahead'];

        foreach ($allowed as $field) {
            if (array_key_exists($field, $data)) {
                $fields[] = "$field = ?";
                $params[] = $data[$field];
            }
        }

        if (empty($fields)) jsonResponse(['error' => 'No fields to update'], 400);

        $params[] = $id;
        $db->prepare("UPDATE service_schedules SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
        jsonResponse(['message' => 'Schedule updated']);
        break;

    case 'DELETE':
        requireRole($currentUser, ['pastor', 'admin']);
        if (!$id) jsonResponse(['error' => 'Schedule ID required'], 400);

        $db->prepare("DELETE FROM service_schedules WHERE id = ?")->execute([$id]);
        jsonResponse(['message' => 'Schedule deleted']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}

function getScheduleDates($schedule, $today, $weekOffset) {
    $dates = [];
    $freq = $schedule['frequency'];
    $dayOfWeek = (int)$schedule['day_of_week'];

    if ($freq === 'weekly') {
        $target = clone $today;
        $currentDow = (int)$target->format('w');
        $diff = $dayOfWeek - $currentDow;
        if ($diff < 0) $diff += 7;
        $target->modify("+{$diff} days");
        $target->modify("+{$weekOffset} weeks");
        if ($target >= $today) $dates[] = $target;

    } elseif ($freq === 'biweekly') {
        if ($weekOffset % 2 === 0) {
            $target = clone $today;
            $currentDow = (int)$target->format('w');
            $diff = $dayOfWeek - $currentDow;
            if ($diff < 0) $diff += 7;
            $target->modify("+{$diff} days");
            $target->modify("+{$weekOffset} weeks");
            if ($target >= $today) $dates[] = $target;
        }

    } elseif ($freq === 'monthly') {
        if ($weekOffset === 0) {
            $target = new DateTime($today->format('Y-m') . '-01');
            while ((int)$target->format('w') !== $dayOfWeek) {
                $target->modify('+1 day');
            }
            if ($target < $today) {
                $target = new DateTime($today->format('Y-m-01'));
                $target->modify('+1 month');
                while ((int)$target->format('w') !== $dayOfWeek) {
                    $target->modify('+1 day');
                }
            }
            $dates[] = $target;
        }
    }

    return $dates;
}
