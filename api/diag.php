<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';
$db = getDB();
$user = $db->query("SELECT id, email, name, role FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1")->fetch();
$token = generateToken(['user_id' => $user['id'], 'email' => $user['email'], 'name' => $user['name'], 'role' => $user['role']]);
header('Content-Type: application/json');
echo json_encode(['token' => $token]);
