<?php
/**
 * Hallelujah In The City - Church Management System
 * Users API - CRUD for system users (admin/pastor only)
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? 'list';
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = getDB();

if ($method === 'POST' && $action === 'reset_password') {
    requireRole($currentUser, ['pastor', 'admin']);
    $data = getRequestBody();
    $targetId = $data['user_id'] ?? null;
    $newPassword = $data['password'] ?? null;
    if (!$targetId || !$newPassword) {
        jsonResponse(['error' => 'user_id and password are required'], 400);
    }
    if (strlen($newPassword) < 6) {
        jsonResponse(['error' => 'Password must be at least 6 characters'], 400);
    }
    $stmt = $db->prepare("SELECT id, name FROM users WHERE id = ?");
    $stmt->execute([$targetId]);
    $target = $stmt->fetch();
    if (!$target) {
        jsonResponse(['error' => 'User not found'], 404);
    }
    $hash = password_hash($newPassword, PASSWORD_BCRYPT);
    $db->prepare("UPDATE users SET password_hash = ? WHERE id = ?")->execute([$hash, $targetId]);
    jsonResponse(['message' => "Password reset for {$target['name']}"]);
}

switch ($method) {
    case 'GET':
        if ($id) {
            // Get single user
            $stmt = $db->prepare("SELECT id, email, name, role, status, created_at, updated_at FROM users WHERE id = ?");
            $stmt->execute([$id]);
            $user = $stmt->fetch();
            if (!$user) {
                jsonResponse(['error' => 'User not found'], 404);
            }
            jsonResponse(['user' => $user]);
        } else {
            // List all users
            requireRole($currentUser, ['pastor', 'admin']);
            $stmt = $db->query("SELECT id, email, name, role, status, created_at, updated_at FROM users ORDER BY name ASC");
            $users = $stmt->fetchAll();
            jsonResponse(['users' => $users]);
        }
        break;

    case 'POST':
        requireRole($currentUser, ['pastor', 'admin']);
        $data = getRequestBody();
        $error = validateRequired($data, ['email', 'password', 'name', 'role']);
        if ($error) {
            jsonResponse(['error' => $error], 400);
        }

        // Validate role
        $validRoles = ['pastor', 'admin', 'leader', 'volunteer'];
        if (!in_array($data['role'], $validRoles)) {
            jsonResponse(['error' => 'Invalid role'], 400);
        }

        // Check duplicate email
        $stmt = $db->prepare("SELECT id FROM users WHERE email = ?");
        $stmt->execute([$data['email']]);
        if ($stmt->fetch()) {
            jsonResponse(['error' => 'Email already exists'], 409);
        }

        $passwordHash = password_hash($data['password'], PASSWORD_BCRYPT);
        $stmt = $db->prepare("INSERT INTO users (email, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)");
        $stmt->execute([
            $data['email'],
            $passwordHash,
            $data['name'],
            $data['role'],
            $data['status'] ?? 'active'
        ]);

        $newId = $db->lastInsertId();
        $stmt = $db->prepare("SELECT id, email, name, role, status, created_at FROM users WHERE id = ?");
        $stmt->execute([$newId]);
        $user = $stmt->fetch();

        jsonResponse(['user' => $user, 'message' => 'User created successfully'], 201);
        break;

    case 'PUT':
        if (!$id) {
            jsonResponse(['error' => 'User ID required'], 400);
        }

        // Users can update their own profile, admins can update anyone
        if ($currentUser['user_id'] != $id) {
            requireRole($currentUser, ['pastor', 'admin']);
        }

        $data = getRequestBody();

        // Build update query dynamically
        $fields = [];
        $params = [];

        if (isset($data['name']) && trim($data['name']) !== '') {
            $fields[] = "name = ?";
            $params[] = $data['name'];
        }
        if (isset($data['email']) && trim($data['email']) !== '') {
            // Check duplicate email
            $stmt = $db->prepare("SELECT id FROM users WHERE email = ? AND id != ?");
            $stmt->execute([$data['email'], $id]);
            if ($stmt->fetch()) {
                jsonResponse(['error' => 'Email already exists'], 409);
            }
            $fields[] = "email = ?";
            $params[] = $data['email'];
        }
        if (isset($data['password']) && trim($data['password']) !== '') {
            $fields[] = "password_hash = ?";
            $params[] = password_hash($data['password'], PASSWORD_BCRYPT);
        }
        if (isset($data['role']) && in_array($currentUser['role'], ['pastor', 'admin'])) {
            $validRoles = ['pastor', 'admin', 'leader', 'volunteer'];
            if (in_array($data['role'], $validRoles)) {
                $fields[] = "role = ?";
                $params[] = $data['role'];
            }
        }
        if (isset($data['status']) && in_array($currentUser['role'], ['pastor', 'admin'])) {
            $fields[] = "status = ?";
            $params[] = $data['status'];
        }

        if (empty($fields)) {
            jsonResponse(['error' => 'No fields to update'], 400);
        }

        $params[] = $id;
        $sql = "UPDATE users SET " . implode(', ', $fields) . " WHERE id = ?";
        $stmt = $db->prepare($sql);
        $stmt->execute($params);

        $stmt = $db->prepare("SELECT id, email, name, role, status, created_at, updated_at FROM users WHERE id = ?");
        $stmt->execute([$id]);
        $user = $stmt->fetch();

        jsonResponse(['user' => $user, 'message' => 'User updated successfully']);
        break;

    case 'DELETE':
        requireRole($currentUser, ['pastor', 'admin']);
        if (!$id) {
            jsonResponse(['error' => 'User ID required'], 400);
        }

        // Prevent self-deletion
        if ($currentUser['user_id'] == $id) {
            jsonResponse(['error' => 'Cannot delete your own account'], 400);
        }

        $stmt = $db->prepare("DELETE FROM users WHERE id = ?");
        $stmt->execute([$id]);

        if ($stmt->rowCount() === 0) {
            jsonResponse(['error' => 'User not found'], 404);
        }

        jsonResponse(['message' => 'User deleted successfully']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
