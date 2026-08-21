<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$db = getDB();

$uploadDir = __DIR__ . '/../uploads/documents/';
if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0755, true);
}

// Typed notes need two extra columns (batch 22). This system is also cloned for the
// Love & Healing site, so never assume the migration has been run there - check, and
// fall back to plain upload behaviour rather than breaking the whole page.
function notesColumnsExist(PDO $db): bool {
    static $exists = null;
    if ($exists !== null) return $exists;
    try {
        $s = $db->query("SELECT COUNT(*) FROM information_schema.columns
                         WHERE table_schema = DATABASE() AND table_name = 'documents'
                         AND column_name IN ('is_note', 'note_content')");
        $exists = ((int)$s->fetchColumn() === 2);
    } catch (Exception $e) {
        $exists = false;
    }
    return $exists;
}

function requireNotesSupport(PDO $db): void {
    if (!notesColumnsExist($db)) {
        jsonResponse(['error' => 'Typed notes are not set up on this database yet. An administrator needs to open api/migrate_batch22.php once.'], 400);
    }
}

// The downloadable copy of a typed note. Plain text on purpose - it opens on any
// phone, any computer, with no program to install.
function noteToText(string $title, string $content, string $author): string {
    $lines = [
        $title,
        str_repeat('=', max(3, min(70, strlen($title)))),
        'Hallelujah In The City' . ($author !== '' ? '  |  ' . $author : ''),
        'Last saved ' . date('F j, Y \a\t g:i A'),
        '',
        $content,
        '',
    ];
    return implode("\r\n", $lines);
}

switch ($method) {
    case 'GET':
        if ($action === 'download') {
            $id = (int)($_GET['id'] ?? 0);
            if (!$id) jsonResponse(['error' => 'ID required'], 400);

            $stmt = $db->prepare("SELECT * FROM documents WHERE id = ?");
            $stmt->execute([$id]);
            $doc = $stmt->fetch();
            if (!$doc) jsonResponse(['error' => 'Document not found'], 404);

            $filePath = $doc['file_path'];
            if (!file_exists($filePath)) {
                jsonResponse(['error' => 'File not found on server'], 404);
            }

            header('Content-Type: ' . ($doc['file_type'] ?: 'application/octet-stream'));
            header('Content-Disposition: attachment; filename="' . $doc['file_name'] . '"');
            header('Content-Length: ' . filesize($filePath));
            header_remove('Access-Control-Allow-Origin');
            readfile($filePath);
            exit();

        } elseif ($action === 'view') {
            // Same file, served inline so it can be read inside the system
            // (PDF viewer / image preview) instead of downloading it.
            $id = (int)($_GET['id'] ?? 0);
            if (!$id) jsonResponse(['error' => 'ID required'], 400);

            $stmt = $db->prepare("SELECT * FROM documents WHERE id = ?");
            $stmt->execute([$id]);
            $doc = $stmt->fetch();
            if (!$doc) jsonResponse(['error' => 'Document not found'], 404);

            $filePath = $doc['file_path'];
            if (!file_exists($filePath)) {
                jsonResponse(['error' => 'File not found on server'], 404);
            }

            $type = $doc['file_type'] ?: (function_exists('mime_content_type') ? mime_content_type($filePath) : 'application/octet-stream');
            header('Content-Type: ' . $type);
            header('Content-Disposition: inline; filename="' . $doc['file_name'] . '"');
            header('Content-Length: ' . filesize($filePath));
            header('X-Content-Type-Options: nosniff');
            header_remove('Access-Control-Allow-Origin');
            readfile($filePath);
            exit();

        } elseif ($action === 'note') {
            // Full text of one typed note, fetched only when it is opened.
            requireNotesSupport($db);
            $id = (int)($_GET['id'] ?? 0);
            if (!$id) jsonResponse(['error' => 'ID required'], 400);
            $stmt = $db->prepare("
                SELECT d.*, u.name as uploaded_by_name
                FROM documents d JOIN users u ON u.id = d.uploaded_by
                WHERE d.id = ? AND d.is_note = 1
            ");
            $stmt->execute([$id]);
            $note = $stmt->fetch();
            if (!$note) jsonResponse(['error' => 'Note not found'], 404);
            jsonResponse(['note' => $note]);

        } elseif ($action === 'categories') {
            jsonResponse(['categories' => [
                ['value' => 'sermon', 'label' => 'Sermons'],
                ['value' => 'meeting_notes', 'label' => 'Meeting Notes'],
                ['value' => 'policy', 'label' => 'Policies'],
                ['value' => 'form', 'label' => 'Forms'],
                ['value' => 'other', 'label' => 'Other'],
            ]]);

        } else {
            // List documents
            $category = $_GET['category'] ?? '';
            $search = $_GET['search'] ?? '';

            $where = [];
            $params = [];

            // Folder-level access: non-admin users only see their assigned folders
            $allowedFolders = [];
            if (!in_array($currentUser['role'], ['pastor', 'admin'])) {
                $fStmt = $db->prepare("SELECT folder FROM user_document_folders WHERE user_id = ?");
                $fStmt->execute([$currentUser['user_id']]);
                $allowedFolders = array_column($fStmt->fetchAll(), 'folder');
                if (!empty($allowedFolders)) {
                    $placeholders = implode(',', array_fill(0, count($allowedFolders), '?'));
                    $where[] = "d.category IN ($placeholders)";
                    $params = array_merge($params, $allowedFolders);
                }
            }

            if ($category) {
                $where[] = "d.category = ?";
                $params[] = $category;
            }
            $hasNotes = notesColumnsExist($db);

            if ($search) {
                // Typed notes are searched by their text too, which is the whole point
                // of having them in here rather than as loose files.
                $s = "%$search%";
                if ($hasNotes) {
                    $where[] = "(d.title LIKE ? OR d.description LIKE ? OR d.file_name LIKE ? OR d.note_content LIKE ?)";
                    $params = array_merge($params, [$s, $s, $s, $s]);
                } else {
                    $where[] = "(d.title LIKE ? OR d.description LIKE ? OR d.file_name LIKE ?)";
                    $params = array_merge($params, [$s, $s, $s]);
                }
            }

            $whereStr = $where ? 'WHERE ' . implode(' AND ', $where) : '';

            // note_content is deliberately left out of the list - a few long sermons
            // would make this response huge for no benefit. A short preview comes
            // along instead, and the full text is fetched when a note is opened.
            $noteCols = $hasNotes
                ? "COALESCE(d.is_note, 0) AS is_note, LEFT(COALESCE(d.note_content, ''), 240) AS note_preview,"
                : "0 AS is_note, '' AS note_preview,";
            $stmt = $db->prepare("
                SELECT d.id, d.title, d.category, d.file_name, d.file_size, d.file_type,
                       d.description, d.uploaded_by, d.created_at,
                       $noteCols
                       u.name as uploaded_by_name
                FROM documents d
                JOIN users u ON u.id = d.uploaded_by
                $whereStr
                ORDER BY d.created_at DESC
            ");
            $stmt->execute($params);
            jsonResponse(['documents' => $stmt->fetchAll(), 'allowed_folders' => $allowedFolders]);
        }
        break;

    case 'POST':
        if ($action === 'upload') {
            if (empty($_FILES['file'])) {
                jsonResponse(['error' => 'No file uploaded'], 400);
            }

            $file = $_FILES['file'];
            $title = $_POST['title'] ?? pathinfo($file['name'], PATHINFO_FILENAME);
            $category = $_POST['category'] ?? 'other';
            $description = $_POST['description'] ?? '';

            $validCategories = ['sermon', 'meeting_notes', 'policy', 'form', 'other'];
            if (!in_array($category, $validCategories)) $category = 'other';

            // Max 50MB
            if ($file['size'] > 50 * 1024 * 1024) {
                jsonResponse(['error' => 'File too large. Maximum 50MB.'], 400);
            }

            $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
            $safeName = time() . '_' . preg_replace('/[^a-zA-Z0-9._-]/', '_', $file['name']);
            $destPath = $uploadDir . $safeName;

            if (!move_uploaded_file($file['tmp_name'], $destPath)) {
                jsonResponse(['error' => 'Failed to save file'], 500);
            }

            $stmt = $db->prepare("
                INSERT INTO documents (title, category, file_path, file_name, file_size, file_type, description, uploaded_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                $title,
                $category,
                $destPath,
                $file['name'],
                $file['size'],
                $file['type'] ?: mime_content_type($destPath),
                $description,
                $currentUser['user_id'],
            ]);

            jsonResponse(['message' => 'Document uploaded', 'id' => (int)$db->lastInsertId()], 201);

        } elseif ($action === 'create_note') {
            // A note typed in the system rather than uploaded. It becomes an ordinary
            // row in documents so search, the category cards and folder permissions
            // all keep working, plus a plain .txt copy on disk so Download still
            // hands over a real file.
            requireNotesSupport($db);
            $data = getRequestBody();
            $title = trim($data['title'] ?? '');
            if ($title === '') jsonResponse(['error' => 'A title is required'], 400);

            $category = $data['category'] ?? 'other';
            $validCategories = ['sermon', 'meeting_notes', 'policy', 'form', 'other'];
            if (!in_array($category, $validCategories)) $category = 'other';

            $content = (string)($data['content'] ?? '');
            $description = $data['description'] ?? '';

            $safeName = time() . '_' . preg_replace('/[^a-zA-Z0-9._-]/', '_', $title) . '.txt';
            $destPath = $uploadDir . $safeName;
            if (@file_put_contents($destPath, noteToText($title, $content, $currentUser['name'] ?? '')) === false) {
                jsonResponse(['error' => 'Could not save the note on the server'], 500);
            }

            $stmt = $db->prepare("
                INSERT INTO documents (title, category, file_path, file_name, file_size, file_type, description, uploaded_by, is_note, note_content)
                VALUES (?, ?, ?, ?, ?, 'text/plain', ?, ?, 1, ?)
            ");
            $stmt->execute([
                $title, $category, $destPath, $title . '.txt',
                filesize($destPath) ?: 0, $description, $currentUser['user_id'], $content,
            ]);

            jsonResponse(['message' => 'Note saved', 'id' => (int)$db->lastInsertId()], 201);

        } elseif ($action === 'update_note') {
            requireNotesSupport($db);
            $id = (int)($_GET['id'] ?? 0);
            if (!$id) jsonResponse(['error' => 'ID required'], 400);

            $stmt = $db->prepare("SELECT * FROM documents WHERE id = ? AND is_note = 1");
            $stmt->execute([$id]);
            $note = $stmt->fetch();
            if (!$note) jsonResponse(['error' => 'Note not found'], 404);

            $data = getRequestBody();
            $title = trim($data['title'] ?? $note['title']);
            if ($title === '') jsonResponse(['error' => 'A title is required'], 400);
            $content = array_key_exists('content', $data) ? (string)$data['content'] : (string)$note['note_content'];
            $category = $data['category'] ?? $note['category'];
            $validCategories = ['sermon', 'meeting_notes', 'policy', 'form', 'other'];
            if (!in_array($category, $validCategories)) $category = 'other';
            $description = array_key_exists('description', $data) ? $data['description'] : $note['description'];

            // Rewrite the downloadable copy in place so it never drifts from the text
            // being read on screen.
            @file_put_contents($note['file_path'], noteToText($title, $content, $currentUser['name'] ?? ''));

            $db->prepare("
                UPDATE documents SET title = ?, category = ?, description = ?, note_content = ?, file_name = ?, file_size = ?
                WHERE id = ?
            ")->execute([
                $title, $category, $description, $content, $title . '.txt',
                @filesize($note['file_path']) ?: 0, $id,
            ]);

            jsonResponse(['message' => 'Note updated']);

        } else {
            jsonResponse(['error' => 'Use action=upload with multipart form data'], 400);
        }
        break;

    case 'PUT':
        // Move a whole selection into another folder in one go. Doing it one file
        // at a time through the Edit form is fine for one, painful for twenty.
        if ($action === 'bulk_move') {
            $data = getRequestBody();
            $category = trim((string)($data['category'] ?? ''));
            $valid = ['sermon', 'meeting_notes', 'policy', 'form', 'other'];
            if (!in_array($category, $valid, true)) jsonResponse(['error' => 'Pick a folder to move them into.'], 400);

            $ids = [];
            foreach ((array)($data['ids'] ?? []) as $raw) {
                $n = (int)$raw;
                if ($n > 0) $ids[] = $n;
            }
            $ids = array_values(array_unique($ids));
            if (!$ids) jsonResponse(['error' => 'No documents selected.'], 400);

            // A leader may only move files out of the folders they can actually see,
            // otherwise the folder permissions could be side-stepped by a bulk move.
            if (!in_array($currentUser['role'], ['pastor', 'admin'])) {
                $fStmt = $db->prepare("SELECT folder FROM user_document_folders WHERE user_id = ?");
                $fStmt->execute([$currentUser['user_id']]);
                $allowed = array_column($fStmt->fetchAll(), 'folder');
                if (empty($allowed) || !in_array($category, $allowed, true)) {
                    jsonResponse(['error' => 'You do not have access to that folder.'], 403);
                }
                $ph = implode(',', array_fill(0, count($ids), '?'));
                $aph = implode(',', array_fill(0, count($allowed), '?'));
                $chk = $db->prepare("SELECT COUNT(*) FROM documents WHERE id IN ($ph) AND category NOT IN ($aph)");
                $chk->execute(array_merge($ids, $allowed));
                if ((int)$chk->fetchColumn() > 0) {
                    jsonResponse(['error' => 'Some of those files are in a folder you do not have access to.'], 403);
                }
            }

            $ph = implode(',', array_fill(0, count($ids), '?'));
            $stmt = $db->prepare("UPDATE documents SET category = ? WHERE id IN ($ph)");
            $stmt->execute(array_merge([$category], $ids));
            $moved = $stmt->rowCount();

            jsonResponse([
                'message' => $moved . ' ' . ($moved === 1 ? 'item' : 'items') . ' moved',
                'moved' => $moved,
                'category' => $category,
            ]);
        }

        $id = (int)($_GET['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'ID required'], 400);

        $data = getRequestBody();
        $fields = [];
        $params = [];

        foreach (['title', 'category', 'description'] as $field) {
            if (array_key_exists($field, $data)) {
                $fields[] = "$field = ?";
                $params[] = $data[$field];
            }
        }

        if (empty($fields)) jsonResponse(['error' => 'No fields to update'], 400);

        $params[] = $id;
        $stmt = $db->prepare("UPDATE documents SET " . implode(', ', $fields) . " WHERE id = ?");
        $stmt->execute($params);

        jsonResponse(['message' => 'Document updated']);
        break;

    case 'DELETE':
        // Accept a single ?id= or a comma-separated ?ids=1,2,3 for bulk delete.
        $ids = [];
        if (!empty($_GET['ids'])) {
            foreach (explode(',', $_GET['ids']) as $part) {
                $n = (int)trim($part);
                if ($n > 0) $ids[] = $n;
            }
        } elseif (!empty($_GET['id'])) {
            $ids[] = (int)$_GET['id'];
        }
        $ids = array_values(array_unique($ids));
        if (!$ids) jsonResponse(['error' => 'ID required'], 400);

        $placeholders = implode(',', array_fill(0, count($ids), '?'));

        // Remove the underlying files first, then the rows.
        $sel = $db->prepare("SELECT file_path FROM documents WHERE id IN ($placeholders)");
        $sel->execute($ids);
        foreach ($sel->fetchAll() as $doc) {
            if ($doc['file_path'] && file_exists($doc['file_path'])) {
                unlink($doc['file_path']);
            }
        }

        $del = $db->prepare("DELETE FROM documents WHERE id IN ($placeholders)");
        $del->execute($ids);
        $n = $del->rowCount();
        jsonResponse([
            'message' => $n . ' ' . ($n === 1 ? 'document' : 'documents') . ' deleted',
            'deleted' => $n,
        ]);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
