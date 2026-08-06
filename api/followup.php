<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];

// Per-section access: "View" only can't create/edit/delete follow-ups.
if (in_array($method, ['POST', 'PUT', 'DELETE'])) {
    requireSectionEdit($currentUser, 'followup', 'manage');
}
$action = $_GET['action'] ?? '';
$db = getDB();

$isAdmin = in_array($currentUser['role'], ['pastor', 'admin']);

/**
 * When a recurring follow-up is completed, create its next occurrence.
 * Returns the new follow-up id, or null if it isn't recurring / has no due date.
 */
function spawnNextRecurrence(PDO $db, int $id): ?int {
    $stmt = $db->prepare("SELECT * FROM followups WHERE id = ?");
    $stmt->execute([$id]);
    $fu = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$fu) return null;

    $recurrence = $fu['recurrence'] ?? 'none';
    $intervals = [
        'daily'     => '+1 day',
        'weekly'    => '+1 week',
        'biweekly'  => '+2 weeks',
        'monthly'   => '+1 month',
        'quarterly' => '+3 months',
        'yearly'    => '+1 year',
    ];
    if (!isset($intervals[$recurrence]) || empty($fu['due_date'])) return null;

    // Advance from the current due date, then keep stepping until it lands in
    // the future so a task finished late doesn't reappear already overdue.
    try {
        $next = new DateTime($fu['due_date']);
    } catch (Exception $e) {
        return null;
    }
    $today = new DateTime('today');
    do {
        $next->modify($intervals[$recurrence]);
    } while ($next <= $today);
    $nextDue = $next->format('Y-m-d');

    $ins = $db->prepare("
        INSERT INTO followups
            (member_id, subject, assigned_to, type, custom_type, status, priority, notes, due_date,
             can_edit, remind_email, remind_sms, reminder_days_before, recurrence, recurrence_parent_id)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $ins->execute([
        $fu['member_id'],
        $fu['subject'],
        $fu['assigned_to'],
        $fu['type'],
        $fu['custom_type'],
        $fu['priority'],
        $fu['notes'],
        $nextDue,
        $fu['can_edit'],
        $fu['remind_email'],
        $fu['remind_sms'],
        $fu['reminder_days_before'],
        $recurrence,
        $id,
    ]);
    return (int)$db->lastInsertId();
}

switch ($method) {
    case 'GET':
        if ($action === 'stats') {
            $where = '';
            $params = [];
            if (!$isAdmin) {
                $where = 'WHERE assigned_to = ?';
                $params[] = $currentUser['user_id'];
            }
            $stmt = $db->prepare("
                SELECT
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                    COUNT(CASE WHEN status = 'contacted' THEN 1 END) as contacted,
                    COUNT(CASE WHEN status = 'pending_approval' THEN 1 END) as pending_approval,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                    COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
                    COUNT(CASE WHEN priority = 'high' AND status IN ('pending','contacted') THEN 1 END) as `high_priority`,
                    COUNT(CASE WHEN due_date < CURDATE() AND status IN ('pending','contacted') THEN 1 END) as overdue
                FROM followups $where
            ");
            $stmt->execute($params);
            jsonResponse(['stats' => $stmt->fetch()]);

        } else {
            $status = $_GET['status'] ?? '';
            $type = $_GET['type'] ?? '';
            $assignedTo = $_GET['assigned_to'] ?? '';
            $priority = $_GET['priority'] ?? '';

            $where = [];
            $params = [];

            // Non-admins only see follow-ups assigned to them
            if (!$isAdmin) {
                $where[] = "f.assigned_to = ?";
                $params[] = $currentUser['user_id'];
            }

            if ($status) {
                $where[] = "f.status = ?";
                $params[] = $status;
            }
            if ($type) {
                $where[] = "f.type = ?";
                $params[] = $type;
            }
            if ($assignedTo && $isAdmin) {
                $where[] = "f.assigned_to = ?";
                $params[] = (int)$assignedTo;
            }
            if ($priority) {
                $where[] = "f.priority = ?";
                $params[] = $priority;
            }

            $whereStr = $where ? 'WHERE ' . implode(' AND ', $where) : '';

            $stmt = $db->prepare("
                SELECT f.*,
                       m.first_name, m.last_name, m.email as member_email, m.phone as member_phone, m.photo_url,
                       u.name as assigned_to_name, u.email as assigned_to_email,
                       cu.name as completed_by_name,
                       au.name as approved_by_name
                FROM followups f
                LEFT JOIN members m ON m.id = f.member_id
                LEFT JOIN users u ON u.id = f.assigned_to
                LEFT JOIN users cu ON cu.id = f.completed_by
                LEFT JOIN users au ON au.id = f.approved_by
                $whereStr
                ORDER BY
                    CASE f.status WHEN 'pending' THEN 0 WHEN 'contacted' THEN 1 WHEN 'pending_approval' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
                    CASE f.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                    f.due_date ASC, f.created_at DESC
            ");
            $stmt->execute($params);
            jsonResponse(['followups' => $stmt->fetchAll(), 'is_admin' => $isAdmin]);
        }
        break;

    case 'POST':
        $data = getRequestBody();

        if ($action === 'auto_generate') {
            if (!$isAdmin) jsonResponse(['error' => 'Admin only'], 403);
            $days = (int)($data['days'] ?? 7);
            $since = date('Y-m-d', strtotime("-$days days"));

            $stmt = $db->prepare("
                SELECT m.id FROM members m
                LEFT JOIN followups f ON f.member_id = m.id AND f.type = 'new_member'
                WHERE m.membership_date >= ? AND f.id IS NULL AND m.status = 'active'
            ");
            $stmt->execute([$since]);
            $newMembers = $stmt->fetchAll(PDO::FETCH_COLUMN);

            $stmt = $db->prepare("
                SELECT m.id FROM members m
                LEFT JOIN followups f ON f.member_id = m.id AND f.type = 'visitor'
                WHERE m.created_at >= ? AND m.status = 'visitor' AND f.id IS NULL
            ");
            $stmt->execute([$since]);
            $visitors = $stmt->fetchAll(PDO::FETCH_COLUMN);

            $created = 0;
            $dueDate = date('Y-m-d', strtotime('+3 days'));

            foreach ($newMembers as $mid) {
                $db->prepare("
                    INSERT INTO followups (member_id, type, priority, notes, due_date)
                    VALUES (?, 'new_member', 'high', 'Welcome call - new member', ?)
                ")->execute([$mid, $dueDate]);
                $created++;
            }

            foreach ($visitors as $mid) {
                $db->prepare("
                    INSERT INTO followups (member_id, type, priority, notes, due_date)
                    VALUES (?, 'visitor', 'medium', 'Follow up with visitor', ?)
                ")->execute([$mid, $dueDate]);
                $created++;
            }

            jsonResponse(['message' => "$created follow-ups created", 'new_members' => count($newMembers), 'visitors' => count($visitors)]);

        } elseif ($action === 'approve') {
            if (!$isAdmin) jsonResponse(['error' => 'Only administrators can approve follow-ups'], 403);
            $id = (int)($data['id'] ?? 0);
            if (!$id) jsonResponse(['error' => 'ID required'], 400);

            $db->prepare("UPDATE followups SET status = 'completed', approved_by = ?, approved_at = NOW() WHERE id = ? AND status = 'pending_approval'")
                ->execute([$currentUser['user_id'], $id]);
            $nextId = spawnNextRecurrence($db, $id);
            jsonResponse([
                'message' => $nextId ? 'Follow-up approved. Next occurrence scheduled.' : 'Follow-up approved',
                'next_followup_id' => $nextId,
            ]);

        } elseif ($action === 'reject_approval') {
            if (!$isAdmin) jsonResponse(['error' => 'Only administrators can reject approvals'], 403);
            $id = (int)($data['id'] ?? 0);
            if (!$id) jsonResponse(['error' => 'ID required'], 400);

            $newStatus = $data['revert_to'] ?? 'contacted';
            $db->prepare("UPDATE followups SET status = ?, completed_at = NULL, completed_by = NULL WHERE id = ? AND status = 'pending_approval'")
                ->execute([$newStatus, $id]);
            jsonResponse(['message' => 'Approval rejected, follow-up sent back']);

        } elseif ($action === 'mark_done') {
            // Leaders mark as done -> goes to pending_approval
            $id = (int)($data['id'] ?? 0);
            if (!$id) jsonResponse(['error' => 'ID required'], 400);

            // Verify the user is assigned to this follow-up (or is admin)
            if (!$isAdmin) {
                $check = $db->prepare("SELECT assigned_to FROM followups WHERE id = ?");
                $check->execute([$id]);
                $fu = $check->fetch();
                if (!$fu || (int)$fu['assigned_to'] !== (int)$currentUser['user_id']) {
                    jsonResponse(['error' => 'You can only mark your own assigned follow-ups as done'], 403);
                }
            }

            $completionNotes = $data['completion_notes'] ?? null;
            $db->prepare("UPDATE followups SET status = 'pending_approval', completed_at = NOW(), completed_by = ?, completion_notes = ? WHERE id = ?")
                ->execute([$currentUser['user_id'], $completionNotes, $id]);
            jsonResponse(['message' => 'Marked as done - pending administrator approval']);

        } elseif ($action === 'toggle_edit') {
            if (!$isAdmin) jsonResponse(['error' => 'Admin only'], 403);
            $id = (int)($data['id'] ?? 0);
            $canEdit = (int)($data['can_edit'] ?? 0);
            $db->prepare("UPDATE followups SET can_edit = ? WHERE id = ?")->execute([$canEdit, $id]);
            jsonResponse(['message' => $canEdit ? 'Edit permission granted' : 'Edit permission revoked']);

        } else {
            // Create follow-up (admin only)
            if (!$isAdmin) jsonResponse(['error' => 'Only administrators can create follow-ups'], 403);
            $error = validateRequired($data, ['subject', 'type']);
            if ($error) jsonResponse(['error' => $error], 400);

            $canEdit = (int)($data['can_edit'] ?? 0);
            $memberId = !empty($data['member_id']) ? (int)$data['member_id'] : null;
            $customType = ($data['type'] === 'other' && !empty($data['custom_type'])) ? $data['custom_type'] : null;
            $remindEmail = !empty($data['remind_email']) ? 1 : 0;
            $remindSms = !empty($data['remind_sms']) ? 1 : 0;
            $reminderDays = isset($data['reminder_days_before']) ? max(0, min(60, (int)$data['reminder_days_before'])) : 7;
            $validRecurrence = ['none', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
            $recurrence = in_array($data['recurrence'] ?? 'none', $validRecurrence, true) ? $data['recurrence'] : 'none';
            $stmt = $db->prepare("
                INSERT INTO followups (member_id, subject, assigned_to, type, custom_type, status, priority, notes, due_date, can_edit, remind_email, remind_sms, reminder_days_before, recurrence)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                $memberId,
                $data['subject'],
                $data['assigned_to'] ? (int)$data['assigned_to'] : null,
                $data['type'],
                $customType,
                $data['status'] ?? 'pending',
                $data['priority'] ?? 'medium',
                $data['notes'] ?? null,
                $data['due_date'] ?? null,
                $canEdit,
                $remindEmail,
                $remindSms,
                $reminderDays,
                $recurrence,
            ]);

            jsonResponse(['message' => 'Follow-up created', 'id' => (int)$db->lastInsertId()], 201);
        }
        break;

    case 'PUT':
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'ID required'], 400);

        $data = getRequestBody();

        // Check permissions for non-admins
        if (!$isAdmin) {
            $check = $db->prepare("SELECT assigned_to, can_edit, status FROM followups WHERE id = ?");
            $check->execute([$id]);
            $fu = $check->fetch();
            if (!$fu) jsonResponse(['error' => 'Follow-up not found'], 404);

            if ((int)$fu['assigned_to'] !== (int)$currentUser['user_id']) {
                jsonResponse(['error' => 'Not authorized to modify this follow-up'], 403);
            }

            if (!$fu['can_edit']) {
                // Without edit permission, leaders can only update status to contacted
                $allowedFields = ['status'];
                $allowedStatuses = ['contacted'];
                if (isset($data['status']) && !in_array($data['status'], $allowedStatuses)) {
                    jsonResponse(['error' => 'Use "Mark Done" to complete this follow-up'], 400);
                }
                // Filter to only allowed fields
                $data = array_intersect_key($data, array_flip($allowedFields));
                if (empty($data)) {
                    jsonResponse(['error' => 'You do not have edit permission for this follow-up. Ask admin to grant edit access.'], 403);
                }
            }
        }

        $fields = [];
        $params = [];

        foreach (['subject', 'assigned_to', 'type', 'custom_type', 'status', 'priority', 'notes', 'due_date', 'can_edit', 'remind_email', 'remind_sms', 'reminder_days_before', 'recurrence'] as $field) {
            if (array_key_exists($field, $data)) {
                if ($field === 'remind_email' || $field === 'remind_sms') {
                    $fields[] = "$field = ?";
                    $params[] = !empty($data[$field]) ? 1 : 0;
                } elseif ($field === 'reminder_days_before') {
                    $fields[] = "$field = ?";
                    $params[] = max(0, min(60, (int)$data[$field]));
                } else {
                    $fields[] = "$field = ?";
                    $params[] = $data[$field] ?: null;
                }
            }
        }
        // If reminder settings changed, allow the reminder to fire again
        if (array_key_exists('remind_email', $data) || array_key_exists('remind_sms', $data) || array_key_exists('reminder_days_before', $data) || array_key_exists('due_date', $data)) {
            $fields[] = "reminder_sent_at = NULL";
        }

        if (($data['status'] ?? '') === 'completed' && $isAdmin) {
            $fields[] = "completed_at = NOW()";
            $fields[] = "completed_by = ?";
            $params[] = $currentUser['user_id'];
            $fields[] = "approved_by = ?";
            $params[] = $currentUser['user_id'];
            $fields[] = "approved_at = NOW()";
        }

        if (empty($fields)) jsonResponse(['error' => 'No fields to update'], 400);

        $params[] = $id;
        $stmt = $db->prepare("UPDATE followups SET " . implode(', ', $fields) . " WHERE id = ?");
        $stmt->execute($params);

        // If an admin just completed it directly, schedule the next occurrence.
        $nextId = null;
        if (($data['status'] ?? '') === 'completed' && $isAdmin) {
            $nextId = spawnNextRecurrence($db, $id);
        }
        jsonResponse([
            'message' => $nextId ? 'Follow-up updated. Next occurrence scheduled.' : 'Follow-up updated',
            'next_followup_id' => $nextId,
        ]);
        break;

    case 'DELETE':
        if (!$isAdmin) jsonResponse(['error' => 'Only administrators can delete follow-ups'], 403);
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'ID required'], 400);

        $db->prepare("DELETE FROM followups WHERE id = ?")->execute([$id]);
        jsonResponse(['message' => 'Follow-up deleted']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
