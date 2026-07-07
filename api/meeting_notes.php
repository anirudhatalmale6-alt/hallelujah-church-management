<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$db = getDB();

$uploadDir = __DIR__ . '/../uploads/meeting_notes/';
if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0755, true);
}

// Access check: pastor/admin always allowed, others need meeting_notes folder access
$isAdmin = in_array($currentUser['role'], ['pastor', 'admin']);
if (!$isAdmin) {
    $fStmt = $db->prepare("SELECT folder FROM user_document_folders WHERE user_id = ? AND folder = 'meeting_notes'");
    $fStmt->execute([$currentUser['user_id']]);
    if (!$fStmt->fetch()) {
        jsonResponse(['error' => 'You do not have access to Meeting Notes'], 403);
    }
}

switch ($method) {
    case 'GET':
        if ($action === 'view' && isset($_GET['id'])) {
            $id = (int)$_GET['id'];
            $stmt = $db->prepare("
                SELECT mn.*, u.name as created_by_name, u2.name as updated_by_name
                FROM meeting_notes mn
                JOIN users u ON u.id = mn.created_by
                LEFT JOIN users u2 ON u2.id = mn.updated_by
                WHERE mn.id = ?
            ");
            $stmt->execute([$id]);
            $note = $stmt->fetch();
            if (!$note) jsonResponse(['error' => 'Note not found'], 404);

            if ($note['subjects']) {
                $note['subjects'] = json_decode($note['subjects'], true);
            }

            // Get attachments
            $attStmt = $db->prepare("
                SELECT mna.*, u.name as uploaded_by_name
                FROM meeting_note_attachments mna
                JOIN users u ON u.id = mna.uploaded_by
                WHERE mna.note_id = ?
                ORDER BY mna.created_at DESC
            ");
            $attStmt->execute([$id]);
            $note['attachments'] = $attStmt->fetchAll();

            jsonResponse(['note' => $note]);

        } elseif ($action === 'download_attachment' && isset($_GET['id'])) {
            $id = (int)$_GET['id'];
            $stmt = $db->prepare("SELECT * FROM meeting_note_attachments WHERE id = ?");
            $stmt->execute([$id]);
            $att = $stmt->fetch();
            if (!$att) jsonResponse(['error' => 'Attachment not found'], 404);

            if (!file_exists($att['file_path'])) {
                jsonResponse(['error' => 'File not found on server'], 404);
            }

            header('Content-Type: ' . ($att['file_type'] ?: 'application/octet-stream'));
            header('Content-Disposition: attachment; filename="' . $att['file_name'] . '"');
            header('Content-Length: ' . filesize($att['file_path']));
            header_remove('Access-Control-Allow-Origin');
            readfile($att['file_path']);
            exit();

        } else {
            // List meeting notes
            $search = $_GET['search'] ?? '';
            $from = $_GET['from'] ?? '';
            $to = $_GET['to'] ?? '';
            $page = max(1, (int)($_GET['page'] ?? 1));
            $limit = min(100, max(10, (int)($_GET['limit'] ?? 50)));
            $offset = ($page - 1) * $limit;

            $where = [];
            $params = [];

            if ($search) {
                $where[] = "(mn.title LIKE ? OR mn.content LIKE ? OR mn.subjects LIKE ?)";
                $s = "%$search%";
                $params = array_merge($params, [$s, $s, $s]);
            }
            if ($from) {
                $where[] = "mn.meeting_date >= ?";
                $params[] = $from;
            }
            if ($to) {
                $where[] = "mn.meeting_date <= ?";
                $params[] = $to;
            }

            $whereStr = $where ? 'WHERE ' . implode(' AND ', $where) : '';

            $countStmt = $db->prepare("SELECT COUNT(*) as total FROM meeting_notes mn $whereStr");
            $countStmt->execute($params);
            $total = $countStmt->fetch()['total'];

            $stmt = $db->prepare("
                SELECT mn.*, u.name as created_by_name,
                    (SELECT COUNT(*) FROM meeting_note_attachments WHERE note_id = mn.id) as attachment_count
                FROM meeting_notes mn
                JOIN users u ON u.id = mn.created_by
                $whereStr
                ORDER BY mn.meeting_date DESC, mn.created_at DESC
                LIMIT $limit OFFSET $offset
            ");
            $stmt->execute($params);
            $notes = $stmt->fetchAll();

            foreach ($notes as &$n) {
                if ($n['subjects']) {
                    $n['subjects'] = json_decode($n['subjects'], true);
                }
            }

            jsonResponse([
                'notes' => $notes,
                'total' => (int)$total,
                'page' => $page,
                'limit' => $limit,
                'pages' => ceil($total / $limit),
            ]);
        }
        break;

    case 'POST':
        if ($action === 'upload_attachment') {
            $noteId = (int)($_POST['note_id'] ?? 0);
            if (!$noteId) jsonResponse(['error' => 'note_id required'], 400);

            // Verify note exists
            $stmt = $db->prepare("SELECT id FROM meeting_notes WHERE id = ?");
            $stmt->execute([$noteId]);
            if (!$stmt->fetch()) jsonResponse(['error' => 'Note not found'], 404);

            if (empty($_FILES['file'])) {
                jsonResponse(['error' => 'No file uploaded'], 400);
            }

            $file = $_FILES['file'];
            if ($file['size'] > 50 * 1024 * 1024) {
                jsonResponse(['error' => 'File too large. Maximum 50MB.'], 400);
            }

            $safeName = time() . '_' . preg_replace('/[^a-zA-Z0-9._-]/', '_', $file['name']);
            $destPath = $uploadDir . $safeName;

            if (!move_uploaded_file($file['tmp_name'], $destPath)) {
                jsonResponse(['error' => 'Failed to save file'], 500);
            }

            $stmt = $db->prepare("
                INSERT INTO meeting_note_attachments (note_id, file_path, file_name, file_size, file_type, uploaded_by)
                VALUES (?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                $noteId,
                $destPath,
                $file['name'],
                $file['size'],
                $file['type'] ?: mime_content_type($destPath),
                $currentUser['user_id'],
            ]);

            jsonResponse(['message' => 'Attachment uploaded', 'id' => (int)$db->lastInsertId()], 201);

        } else {
            // Create meeting note
            $data = getRequestBody();
            $error = validateRequired($data, ['title', 'meeting_date']);
            if ($error) jsonResponse(['error' => $error], 400);

            $subjects = isset($data['subjects']) ? json_encode($data['subjects']) : null;

            $stmt = $db->prepare("
                INSERT INTO meeting_notes (title, meeting_date, subjects, content, created_by)
                VALUES (?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                trim($data['title']),
                $data['meeting_date'],
                $subjects,
                $data['content'] ?? '',
                $currentUser['user_id'],
            ]);

            $newId = (int)$db->lastInsertId();
            jsonResponse(['message' => 'Meeting note created', 'id' => $newId], 201);
        }
        break;

    case 'PUT':
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'ID required'], 400);

        $stmt = $db->prepare("SELECT id FROM meeting_notes WHERE id = ?");
        $stmt->execute([$id]);
        if (!$stmt->fetch()) jsonResponse(['error' => 'Note not found'], 404);

        $data = getRequestBody();
        $fields = [];
        $params = [];

        foreach (['title', 'meeting_date', 'content'] as $field) {
            if (array_key_exists($field, $data)) {
                $fields[] = "$field = ?";
                $params[] = $data[$field];
            }
        }

        if (array_key_exists('subjects', $data)) {
            $fields[] = "subjects = ?";
            $params[] = json_encode($data['subjects']);
        }

        if (empty($fields)) jsonResponse(['error' => 'No fields to update'], 400);

        $fields[] = "updated_by = ?";
        $params[] = $currentUser['user_id'];

        $params[] = $id;
        $stmt = $db->prepare("UPDATE meeting_notes SET " . implode(', ', $fields) . " WHERE id = ?");
        $stmt->execute($params);

        jsonResponse(['message' => 'Meeting note updated']);
        break;

    case 'DELETE':
        if ($action === 'attachment') {
            $id = (int)($_GET['id'] ?? 0);
            if (!$id) jsonResponse(['error' => 'Attachment ID required'], 400);

            $stmt = $db->prepare("SELECT file_path FROM meeting_note_attachments WHERE id = ?");
            $stmt->execute([$id]);
            $att = $stmt->fetch();

            if ($att && $att['file_path'] && file_exists($att['file_path'])) {
                unlink($att['file_path']);
            }

            $db->prepare("DELETE FROM meeting_note_attachments WHERE id = ?")->execute([$id]);
            jsonResponse(['message' => 'Attachment deleted']);

        } else {
            $id = (int)($_GET['id'] ?? 0);
            if (!$id) jsonResponse(['error' => 'Note ID required'], 400);

            // Delete attachment files first
            $attStmt = $db->prepare("SELECT file_path FROM meeting_note_attachments WHERE note_id = ?");
            $attStmt->execute([$id]);
            foreach ($attStmt->fetchAll() as $att) {
                if ($att['file_path'] && file_exists($att['file_path'])) {
                    unlink($att['file_path']);
                }
            }

            $db->prepare("DELETE FROM meeting_notes WHERE id = ?")->execute([$id]);
            jsonResponse(['message' => 'Meeting note deleted']);
        }
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
