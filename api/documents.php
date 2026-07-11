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
            if ($search) {
                $where[] = "(d.title LIKE ? OR d.description LIKE ? OR d.file_name LIKE ?)";
                $s = "%$search%";
                $params[] = $s;
                $params[] = $s;
                $params[] = $s;
            }

            $whereStr = $where ? 'WHERE ' . implode(' AND ', $where) : '';

            $stmt = $db->prepare("
                SELECT d.*, u.name as uploaded_by_name
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

        } else {
            jsonResponse(['error' => 'Use action=upload with multipart form data'], 400);
        }
        break;

    case 'PUT':
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
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'ID required'], 400);

        $stmt = $db->prepare("SELECT file_path FROM documents WHERE id = ?");
        $stmt->execute([$id]);
        $doc = $stmt->fetch();

        if ($doc && $doc['file_path'] && file_exists($doc['file_path'])) {
            unlink($doc['file_path']);
        }

        $db->prepare("DELETE FROM documents WHERE id = ?")->execute([$id]);
        jsonResponse(['message' => 'Document deleted']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
