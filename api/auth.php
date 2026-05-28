<?php
/**
 * Hallelujah In The City - Church Management System
 * Authentication: Login + JWT Token Middleware
 */

require_once __DIR__ . '/config.php';

/**
 * Base64 URL-safe encode
 */
function base64UrlEncode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

/**
 * Base64 URL-safe decode
 */
function base64UrlDecode(string $data): string {
    return base64_decode(strtr($data, '-_', '+/'));
}

/**
 * Generate JWT token
 */
function generateToken(array $payload): string {
    $header = json_encode(['typ' => 'JWT', 'alg' => 'HS256']);
    $payload['iat'] = time();
    $payload['exp'] = time() + JWT_EXPIRY;
    $payloadJson = json_encode($payload);

    $base64Header = base64UrlEncode($header);
    $base64Payload = base64UrlEncode($payloadJson);
    $signature = hash_hmac('sha256', "$base64Header.$base64Payload", JWT_SECRET, true);
    $base64Signature = base64UrlEncode($signature);

    return "$base64Header.$base64Payload.$base64Signature";
}

/**
 * Verify and decode JWT token
 */
function verifyToken(string $token): ?array {
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        return null;
    }

    [$base64Header, $base64Payload, $base64Signature] = $parts;

    // Verify signature
    $signature = hash_hmac('sha256', "$base64Header.$base64Payload", JWT_SECRET, true);
    $expectedSignature = base64UrlEncode($signature);

    if (!hash_equals($expectedSignature, $base64Signature)) {
        return null;
    }

    // Decode payload
    $payload = json_decode(base64UrlDecode($base64Payload), true);
    if (!$payload) {
        return null;
    }

    // Check expiry
    if (isset($payload['exp']) && $payload['exp'] < time()) {
        return null;
    }

    return $payload;
}

/**
 * Authentication middleware - returns user data or sends 401
 */
function authenticate(): array {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

    if (empty($authHeader)) {
        // Check for token in query string (fallback)
        $authHeader = isset($_GET['token']) ? 'Bearer ' . $_GET['token'] : '';
    }

    if (empty($authHeader) || !str_starts_with($authHeader, 'Bearer ')) {
        jsonResponse(['error' => 'Authentication required'], 401);
    }

    $token = substr($authHeader, 7);
    $payload = verifyToken($token);

    if (!$payload) {
        jsonResponse(['error' => 'Invalid or expired token'], 401);
    }

    return $payload;
}

/**
 * Require specific role(s)
 */
function requireRole(array $user, array $allowedRoles): void {
    if (!in_array($user['role'], $allowedRoles)) {
        jsonResponse(['error' => 'Insufficient permissions'], 403);
    }
}

/**
 * Handle login request
 */
function handleLogin(): void {
    $data = getRequestBody();

    $error = validateRequired($data, ['email', 'password']);
    if ($error) {
        jsonResponse(['error' => $error], 400);
    }

    $db = getDB();
    $stmt = $db->prepare("SELECT id, email, password_hash, name, role, status FROM users WHERE email = ?");
    $stmt->execute([$data['email']]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($data['password'], $user['password_hash'])) {
        jsonResponse(['error' => 'Invalid email or password'], 401);
    }

    if ($user['status'] !== 'active') {
        jsonResponse(['error' => 'Account is inactive. Contact administrator.'], 403);
    }

    $token = generateToken([
        'user_id' => $user['id'],
        'email' => $user['email'],
        'name' => $user['name'],
        'role' => $user['role'],
    ]);

    jsonResponse([
        'token' => $token,
        'user' => [
            'id' => $user['id'],
            'email' => $user['email'],
            'name' => $user['name'],
            'role' => $user['role'],
        ]
    ]);
}

// Route handling - only when auth.php is accessed directly
if (basename($_SERVER['SCRIPT_FILENAME']) === 'auth.php') {
    $method = $_SERVER['REQUEST_METHOD'];
    $action = $_GET['action'] ?? '';

    if ($method === 'POST' && $action === 'login') {
        handleLogin();
    } elseif ($method === 'GET' && $action === 'me') {
        $user = authenticate();
        $db = getDB();
        $stmt = $db->prepare("SELECT id, email, name, role, status, created_at FROM users WHERE id = ?");
        $stmt->execute([$user['user_id']]);
        $userData = $stmt->fetch();
        if (!$userData) {
            jsonResponse(['error' => 'User not found'], 404);
        }
        jsonResponse(['user' => $userData]);
    } else {
        jsonResponse(['error' => 'Invalid auth action'], 400);
    }
}
