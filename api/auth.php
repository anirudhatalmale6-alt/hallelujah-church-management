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

    // Load the live per-user access flags so changes take effect immediately and
    // old tokens still honour them. Wrapped in try/catch for pre-migration safety.
    $payload['view_only'] = 0;
    $payload['hide_sensitive'] = 0;
    $payload['section_access'] = [];
    try {
        $db = getDB();
        $u = $db->prepare("SELECT status, view_only, hide_sensitive FROM users WHERE id = ?");
        $u->execute([$payload['user_id']]);
        $row = $u->fetch();
        if ($row) {
            if (isset($row['status']) && $row['status'] !== 'active') {
                jsonResponse(['error' => 'Account is inactive. Contact administrator.'], 403);
            }
            $payload['view_only'] = (int)($row['view_only'] ?? 0);
            $payload['hide_sensitive'] = (int)($row['hide_sensitive'] ?? 0);
        }
        // Per-section sub-permissions (e.g. members => ['view'] means view-only).
        $saStmt = $db->prepare("SELECT section, sub_permission FROM user_section_access WHERE user_id = ?");
        $saStmt->execute([$payload['user_id']]);
        foreach ($saStmt->fetchAll() as $sa) {
            $payload['section_access'][$sa['section']][] = $sa['sub_permission'];
        }
    } catch (Exception $e) { /* columns may not exist yet */ }

    // View-only accounts may read but not write. Admin/pastor are never view-only.
    // auth.php defines ALLOW_VIEW_ONLY_WRITE so users can still change their own password.
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $isAdminRole = in_array($payload['role'] ?? '', ['admin', 'pastor']);
    if (!empty($payload['view_only']) && !$isAdminRole
        && in_array($method, ['POST', 'PUT', 'DELETE', 'PATCH'])
        && !defined('ALLOW_VIEW_ONLY_WRITE')) {
        jsonResponse(['error' => 'Your account is view-only. You can look at everything but cannot make changes. Ask an administrator if you need edit access.'], 403);
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
 * Does this user have a given sub-permission on a section?
 * Admin/pastor always yes. If the user has NO sub-permissions saved for the
 * section, they have full access (matches the frontend hasSectionAccess). If
 * they DO have some, they only have the ones listed.
 */
function sectionAllows(array $user, string $section, string $subPerm): bool {
    if (in_array($user['role'] ?? '', ['admin', 'pastor'])) return true;
    $sa = $user['section_access'][$section] ?? null;
    if (empty($sa)) return true;
    return in_array($subPerm, $sa);
}

/**
 * Guard a write action: 403 unless the user has the sub-permission on the section.
 * $subPerms can be one key or several (any match passes, e.g. add_edit OR manage).
 */
function requireSectionEdit(array $user, string $section, $subPerms): void {
    foreach ((array)$subPerms as $sp) {
        if (sectionAllows($user, $section, $sp)) return;
    }
    jsonResponse(['error' => 'You have view-only access to this section. Ask an administrator if you need to make changes here.'], 403);
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
    try {
        $stmt = $db->prepare("SELECT id, email, password_hash, name, role, status, view_only, hide_sensitive FROM users WHERE email = ?");
        $stmt->execute([$data['email']]);
        $user = $stmt->fetch();
    } catch (Exception $e) {
        // Pre-migration fallback (columns not added yet).
        $stmt = $db->prepare("SELECT id, email, password_hash, name, role, status FROM users WHERE email = ?");
        $stmt->execute([$data['email']]);
        $user = $stmt->fetch();
    }

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

    $permissions = [];
    $financeSections = [];
    if (in_array($user['role'], ['leader', 'volunteer'])) {
        try {
            $permStmt = $db->prepare("SELECT permission FROM user_permissions WHERE user_id = ?");
            $permStmt->execute([$user['id']]);
            $permissions = array_column($permStmt->fetchAll(), 'permission');
        } catch (Exception $e) {}
    }
    try {
        $fsStmt = $db->prepare("SELECT section FROM user_finance_sections WHERE user_id = ?");
        $fsStmt->execute([$user['id']]);
        $financeSections = array_column($fsStmt->fetchAll(), 'section');
    } catch (Exception $e) {}

    $sectionAccess = [];
    try {
        $saStmt = $db->prepare("SELECT section, sub_permission FROM user_section_access WHERE user_id = ?");
        $saStmt->execute([$user['id']]);
        foreach ($saStmt->fetchAll() as $row) {
            $sectionAccess[$row['section']][] = $row['sub_permission'];
        }
    } catch (Exception $e) {}

    jsonResponse([
        'token' => $token,
        'user' => [
            'id' => $user['id'],
            'email' => $user['email'],
            'name' => $user['name'],
            'role' => $user['role'],
            'view_only' => (int)($user['view_only'] ?? 0),
            'hide_sensitive' => (int)($user['hide_sensitive'] ?? 0),
            'permissions' => $permissions,
            'finance_sections' => $financeSections,
            'section_access' => $sectionAccess,
        ]
    ]);
}

/**
 * Handle forgot password request - sends reset email
 */
function handleForgotPassword(): void {
    $data = getRequestBody();
    $email = trim($data['email'] ?? '');
    if (!$email) {
        jsonResponse(['error' => 'Email is required'], 400);
    }

    $db = getDB();
    $stmt = $db->prepare("SELECT id, name, email FROM users WHERE email = ? AND status = 'active'");
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    // Always return success to prevent email enumeration
    if (!$user) {
        jsonResponse(['message' => 'If that email exists, a reset link has been sent.']);
    }

    // Generate token
    $token = bin2hex(random_bytes(32));
    $expiresAt = date('Y-m-d H:i:s', time() + 3600); // 1 hour

    // Invalidate old tokens
    $db->prepare("UPDATE password_resets SET used = 1 WHERE email = ? AND used = 0")->execute([$email]);

    // Store new token
    $db->prepare("INSERT INTO password_resets (email, token, expires_at) VALUES (?, ?, ?)")
       ->execute([$email, $token, $expiresAt]);

    // Get church name for email
    $churchName = 'Hallelujah In The City';
    try {
        $s = $db->prepare("SELECT value FROM settings WHERE `key` = 'church_name'");
        $s->execute();
        $r = $s->fetch();
        if ($r) $churchName = $r['value'];
    } catch (Exception $e) {}

    // Build reset URL
    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'hallelujahinthecity.org';
    $resetUrl = "$protocol://$host/system/public/reset-password?token=$token";

    // Send email
    $subject = "$churchName - Password Reset";
    $htmlBody = "
    <div style='font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;'>
        <h2 style='color: #4f1d0a;'>Password Reset</h2>
        <p>Hello {$user['name']},</p>
        <p>You requested a password reset for your $churchName account.</p>
        <p><a href='$resetUrl' style='display: inline-block; padding: 12px 24px; background-color: #4f1d0a; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;'>Reset My Password</a></p>
        <p style='color: #666; font-size: 13px;'>This link expires in 1 hour. If you didn't request this, please ignore this email.</p>
        <p style='color: #666; font-size: 13px;'>If the button doesn't work, copy and paste this link:<br>$resetUrl</p>
        <hr style='border: none; border-top: 1px solid #eee; margin: 20px 0;'>
        <p style='color: #999; font-size: 12px;'>$churchName Church Management System</p>
    </div>";

    $headers = "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
    $headers .= "From: $churchName <noreply@" . preg_replace('/^www\./', '', $host) . ">\r\n";

    @mail($user['email'], $subject, $htmlBody, $headers);

    jsonResponse(['message' => 'If that email exists, a reset link has been sent.']);
}

/**
 * Verify a reset token is valid
 */
function handleVerifyReset(): void {
    $token = $_GET['token'] ?? '';
    if (!$token) {
        jsonResponse(['error' => 'Token is required'], 400);
    }

    $db = getDB();
    $stmt = $db->prepare("SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > NOW()");
    $stmt->execute([$token]);
    $reset = $stmt->fetch();

    if (!$reset) {
        jsonResponse(['valid' => false, 'error' => 'Invalid or expired reset link'], 400);
    }

    jsonResponse(['valid' => true, 'email' => $reset['email']]);
}

/**
 * Reset password with token
 */
function handleResetPassword(): void {
    $data = getRequestBody();
    $token = trim($data['token'] ?? '');
    $password = $data['password'] ?? '';

    if (!$token || !$password) {
        jsonResponse(['error' => 'Token and new password are required'], 400);
    }
    if (strlen($password) < 6) {
        jsonResponse(['error' => 'Password must be at least 6 characters'], 400);
    }

    $db = getDB();
    $stmt = $db->prepare("SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > NOW()");
    $stmt->execute([$token]);
    $reset = $stmt->fetch();

    if (!$reset) {
        jsonResponse(['error' => 'Invalid or expired reset link. Please request a new one.'], 400);
    }

    // Update password
    $hash = password_hash($password, PASSWORD_BCRYPT);
    $db->prepare("UPDATE users SET password_hash = ? WHERE email = ?")->execute([$hash, $reset['email']]);

    // Mark token as used
    $db->prepare("UPDATE password_resets SET used = 1 WHERE id = ?")->execute([$reset['id']]);

    jsonResponse(['message' => 'Password has been reset successfully. You can now sign in.']);
}

/**
 * Change the signed-in user's own password (requires their current password).
 */
function handleChangePassword(): void {
    $user = authenticate();
    $data = getRequestBody();
    $current = $data['current_password'] ?? '';
    $new = $data['new_password'] ?? '';
    if (!$current || !$new) {
        jsonResponse(['error' => 'Current and new password are required'], 400);
    }
    if (strlen($new) < 6) {
        jsonResponse(['error' => 'New password must be at least 6 characters'], 400);
    }
    $db = getDB();
    $stmt = $db->prepare("SELECT password_hash FROM users WHERE id = ?");
    $stmt->execute([$user['user_id']]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($current, $row['password_hash'])) {
        jsonResponse(['error' => 'Your current password is not correct'], 400);
    }
    $hash = password_hash($new, PASSWORD_BCRYPT);
    $db->prepare("UPDATE users SET password_hash = ? WHERE id = ?")->execute([$hash, $user['user_id']]);
    jsonResponse(['message' => 'Password changed successfully.']);
}

/**
 * Get the signed-in user's current security question (so the Settings form can
 * show whether one is set). Returns null when none is configured.
 */
function handleGetMyRecovery(): void {
    $user = authenticate();
    $db = getDB();
    try {
        $stmt = $db->prepare("SELECT recovery_question FROM users WHERE id = ?");
        $stmt->execute([$user['user_id']]);
        $q = $stmt->fetchColumn();
        jsonResponse(['recovery_question' => $q ?: null]);
    } catch (Exception $e) {
        jsonResponse(['recovery_question' => null]);
    }
}

/**
 * Set / update the signed-in user's security question + answer. The answer is
 * hashed (never stored in plain text) and matched case-insensitively at reset.
 */
function handleSetRecovery(): void {
    $user = authenticate();
    $data = getRequestBody();
    $question = trim($data['recovery_question'] ?? '');
    $answer = trim($data['recovery_answer'] ?? '');
    if ($question === '' || $answer === '') {
        jsonResponse(['error' => 'Both a security question and an answer are required'], 400);
    }
    if (strlen($answer) < 2) {
        jsonResponse(['error' => 'Please choose a slightly longer answer'], 400);
    }
    $hash = password_hash(mb_strtolower($answer), PASSWORD_BCRYPT);
    $db = getDB();
    $db->prepare("UPDATE users SET recovery_question = ?, recovery_answer_hash = ? WHERE id = ?")
       ->execute([$question, $hash, $user['user_id']]);
    jsonResponse(['message' => 'Security question saved. You can now recover your password with it any time.']);
}

/**
 * Public: look up the security question for an email so a locked-out user can
 * answer it. Returns a generic message when none is set (no account enumeration
 * benefit — the question itself is only shown when one exists).
 */
function handleRecoveryQuestion(): void {
    $email = trim($_GET['email'] ?? '');
    if (!$email) {
        jsonResponse(['error' => 'Email is required'], 400);
    }
    $db = getDB();
    try {
        $stmt = $db->prepare("SELECT recovery_question FROM users WHERE email = ? AND status = 'active'");
        $stmt->execute([$email]);
        $q = $stmt->fetchColumn();
        if (!$q) {
            jsonResponse(['error' => 'No security question is set for this account. Use the email reset option instead.'], 404);
        }
        jsonResponse(['recovery_question' => $q]);
    } catch (Exception $e) {
        jsonResponse(['error' => 'No security question is set for this account. Use the email reset option instead.'], 404);
    }
}

/**
 * Public: reset a password by answering the security question — no email needed.
 */
function handleResetWithRecovery(): void {
    $data = getRequestBody();
    $email = trim($data['email'] ?? '');
    $answer = trim($data['answer'] ?? '');
    $new = $data['new_password'] ?? '';
    if (!$email || !$answer || !$new) {
        jsonResponse(['error' => 'Email, answer and new password are required'], 400);
    }
    if (strlen($new) < 6) {
        jsonResponse(['error' => 'New password must be at least 6 characters'], 400);
    }
    $db = getDB();
    $stmt = $db->prepare("SELECT id, recovery_answer_hash FROM users WHERE email = ? AND status = 'active'");
    $stmt->execute([$email]);
    $row = $stmt->fetch();
    if (!$row || empty($row['recovery_answer_hash']) || !password_verify(mb_strtolower($answer), $row['recovery_answer_hash'])) {
        jsonResponse(['error' => 'That answer does not match. Please try again.'], 400);
    }
    $hash = password_hash($new, PASSWORD_BCRYPT);
    $db->prepare("UPDATE users SET password_hash = ? WHERE id = ?")->execute([$hash, $row['id']]);
    jsonResponse(['message' => 'Password has been reset successfully. You can now sign in.']);
}

// Route handling - only when auth.php is accessed directly
if (basename($_SERVER['SCRIPT_FILENAME']) === 'auth.php') {
    // Auth actions (login, logout, change own password, recovery) are self-service,
    // so a view-only account is still allowed to perform them.
    if (!defined('ALLOW_VIEW_ONLY_WRITE')) define('ALLOW_VIEW_ONLY_WRITE', true);
    $method = $_SERVER['REQUEST_METHOD'];
    $action = $_GET['action'] ?? '';

    if ($method === 'POST' && $action === 'login') {
        handleLogin();
    } elseif ($method === 'POST' && $action === 'forgot_password') {
        handleForgotPassword();
    } elseif ($method === 'POST' && $action === 'reset_password') {
        handleResetPassword();
    } elseif ($method === 'GET' && $action === 'verify_reset') {
        handleVerifyReset();
    } elseif ($method === 'POST' && $action === 'change_password') {
        handleChangePassword();
    } elseif ($method === 'GET' && $action === 'my_recovery') {
        handleGetMyRecovery();
    } elseif ($method === 'POST' && $action === 'set_recovery') {
        handleSetRecovery();
    } elseif ($method === 'GET' && $action === 'recovery_question') {
        handleRecoveryQuestion();
    } elseif ($method === 'POST' && $action === 'reset_with_recovery') {
        handleResetWithRecovery();
    } elseif ($method === 'GET' && $action === 'me') {
        $user = authenticate();
        $db = getDB();
        try {
            $stmt = $db->prepare("SELECT id, email, name, role, status, view_only, hide_sensitive, created_at FROM users WHERE id = ?");
            $stmt->execute([$user['user_id']]);
            $userData = $stmt->fetch();
        } catch (Exception $e) {
            $stmt = $db->prepare("SELECT id, email, name, role, status, created_at FROM users WHERE id = ?");
            $stmt->execute([$user['user_id']]);
            $userData = $stmt->fetch();
        }
        if (!$userData) {
            jsonResponse(['error' => 'User not found'], 404);
        }
        $userData['view_only'] = (int)($userData['view_only'] ?? 0);
        $userData['hide_sensitive'] = (int)($userData['hide_sensitive'] ?? 0);
        $perms = [];
        $fSections = [];
        if (in_array($userData['role'], ['leader', 'volunteer'])) {
            try {
                $permStmt = $db->prepare("SELECT permission FROM user_permissions WHERE user_id = ?");
                $permStmt->execute([$userData['id']]);
                $perms = array_column($permStmt->fetchAll(), 'permission');
            } catch (Exception $e) {}
        }
        try {
            $fsStmt = $db->prepare("SELECT section FROM user_finance_sections WHERE user_id = ?");
            $fsStmt->execute([$userData['id']]);
            $fSections = array_column($fsStmt->fetchAll(), 'section');
        } catch (Exception $e) {}
        $userData['permissions'] = $perms;
        $userData['finance_sections'] = $fSections;
        $sAccess = [];
        try {
            $saStmt = $db->prepare("SELECT section, sub_permission FROM user_section_access WHERE user_id = ?");
            $saStmt->execute([$userData['id']]);
            foreach ($saStmt->fetchAll() as $row) {
                $sAccess[$row['section']][] = $row['sub_permission'];
            }
        } catch (Exception $e) {}
        $userData['section_access'] = $sAccess;
        jsonResponse(['user' => $userData]);
    } else {
        jsonResponse(['error' => 'Invalid auth action'], 400);
    }
}
