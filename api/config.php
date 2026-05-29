<?php
/**
 * Hallelujah In The City - Church Management System
 * Configuration & Database Connection
 */

// Error reporting (disable display in production)
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

// Database Configuration
define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('DB_NAME') ?: 'u802978444_church_mgmt');
define('DB_USER', getenv('DB_USER') ?: 'u802978444_hallelujah');
define('DB_PASS', getenv('DB_PASS') ?: 'FMlEjeV:1');

// JWT Configuration
define('JWT_SECRET', getenv('JWT_SECRET') ?: 'hitc-church-mgmt-secret-2026-change-in-production');
define('JWT_EXPIRY', 86400); // 24 hours in seconds

// CORS Configuration
$allowed_origins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://hallelujahinthecity.org',
    'https://www.hallelujahinthecity.org',
    'https://system.hallelujahinthecity.org',
    'http://system.hallelujahinthecity.org',
];

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed_origins)) {
    header("Access-Control-Allow-Origin: $origin");
} else {
    // Allow same-origin requests (when frontend is served from same domain)
    header("Access-Control-Allow-Origin: *");
}

header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With");
header("Access-Control-Allow-Credentials: true");
header("Content-Type: application/json; charset=UTF-8");
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Pragma: no-cache");
header("Expires: 0");

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

/**
 * Get database connection (PDO)
 */
function getDB(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        try {
            $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4";
            $pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
            exit();
        }
    }
    return $pdo;
}

/**
 * Get raw database connection (without selecting database) for install
 */
function getRawDB(): PDO {
    try {
        $dsn = "mysql:host=" . DB_HOST . ";charset=utf8mb4";
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        return $pdo;
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
        exit();
    }
}

/**
 * Send JSON response
 */
function jsonResponse(mixed $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit();
}

/**
 * Get JSON request body
 */
function getRequestBody(): array {
    $body = file_get_contents('php://input');
    $data = json_decode($body, true);
    return $data ?: [];
}

/**
 * Validate required fields
 */
function validateRequired(array $data, array $fields): ?string {
    foreach ($fields as $field) {
        if (!isset($data[$field]) || trim((string)$data[$field]) === '') {
            return "Field '$field' is required.";
        }
    }
    return null;
}

function isClosedPeriod(PDO $db, string $date): bool {
    $yearMonth = substr($date, 0, 7);
    $stmt = $db->prepare("SELECT id FROM closed_periods WHERE year_month = ?");
    $stmt->execute([$yearMonth]);
    return (bool)$stmt->fetch();
}

function createPendingChange(PDO $db, array $params): int {
    $stmt = $db->prepare("
        INSERT INTO pending_changes (entity_type, entity_id, action_type, change_data, description, period, requested_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([
        $params['entity_type'],
        $params['entity_id'] ?? null,
        $params['action_type'],
        json_encode($params['change_data']),
        $params['description'],
        $params['period'],
        $params['requested_by'],
    ]);
    return (int)$db->lastInsertId();
}
