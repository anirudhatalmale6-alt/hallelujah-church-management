<?php
/**
 * Hallelujah In The City - Church Management System
 * Configuration & Database Connection
 */

// Philadelphia / Eastern Time
date_default_timezone_set('America/New_York');

// Error reporting (disable display in production)
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

// Database Configuration
define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('DB_NAME') ?: 'u802978444_church_mgmt');
define('DB_USER', getenv('DB_USER') ?: 'u802978444_hallelujah');
define('DB_PASS', getenv('DB_PASS') ?: 'FMlEjeV:1');

// Server-only secrets (config.secret.php) are git-ignored so the login key never
// reaches the public GitHub repo. Falls back to an env var, then a clearly-invalid
// placeholder (so a misconfigured server fails safe instead of using a known key).
$__secretFile = __DIR__ . '/config.secret.php';
if (is_file($__secretFile)) { require $__secretFile; }

// JWT Configuration — real secret lives in config.secret.php on the server only.
define('JWT_SECRET', getenv('JWT_SECRET') ?: (defined('HITC_JWT_SECRET') ? HITC_JWT_SECRET : 'INSECURE-PLACEHOLDER-set-config.secret.php'));
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
    $stmt = $db->prepare("SELECT id FROM closed_periods WHERE `year_month` = ?");
    $stmt->execute([$yearMonth]);
    return (bool)$stmt->fetch();
}

/**
 * Default person types. `auto_absent` controls whether people of this type are
 * auto-marked absent when a service ends without a check-in.
 */
function defaultPersonTypes(): array {
    return [
        ['value' => 'church_member',       'label' => 'Church Member',        'auto_absent' => true,  'builtin' => true],
        ['value' => 'non_member_attendee', 'label' => 'Non-Member Attendee',  'auto_absent' => true,  'builtin' => true],
        ['value' => 'visitor',             'label' => 'Visitor',              'auto_absent' => false, 'builtin' => true],
        ['value' => 'ministry_partner',    'label' => 'Ministry Partner',     'auto_absent' => false, 'builtin' => true],
        ['value' => 'community',           'label' => 'Community',            'auto_absent' => false, 'builtin' => true],
        ['value' => 'companion',           'label' => 'Companion',            'auto_absent' => false, 'builtin' => true],
    ];
}

/**
 * Resolve the configured person types (custom list from settings, or defaults).
 * Always guarantees the two required built-ins (church_member, non_member_attendee) exist.
 */
function getPersonTypes(PDO $db): array {
    $list = null;
    try {
        $stmt = $db->prepare("SELECT value FROM settings WHERE `key` = 'person_types'");
        $stmt->execute();
        $raw = $stmt->fetchColumn();
        if ($raw) {
            $decoded = json_decode($raw, true);
            if (is_array($decoded) && count($decoded) > 0) {
                $list = [];
                foreach ($decoded as $t) {
                    if (empty($t['value'])) continue;
                    $list[] = [
                        'value'       => preg_replace('/[^a-z0-9_]/', '', strtolower(str_replace(' ', '_', $t['value']))),
                        'label'       => $t['label'] ?? $t['value'],
                        'auto_absent' => !empty($t['auto_absent']),
                        'builtin'     => !empty($t['builtin']),
                    ];
                }
            }
        }
    } catch (Exception $e) {}

    if ($list === null || count($list) === 0) {
        $list = defaultPersonTypes();
    }

    // Guarantee the two required built-ins are present
    $values = array_column($list, 'value');
    foreach (defaultPersonTypes() as $d) {
        if ($d['value'] === 'church_member' || $d['value'] === 'non_member_attendee') {
            if (!in_array($d['value'], $values, true)) $list[] = $d;
        }
    }
    return $list;
}

/**
 * Return the list of person_type values that should be auto-marked absent.
 */
function autoAbsentPersonTypes(PDO $db): array {
    $types = getPersonTypes($db);
    $out = [];
    foreach ($types as $t) {
        if (!empty($t['auto_absent'])) $out[] = $t['value'];
    }
    if (count($out) === 0) $out[] = 'church_member';
    return $out;
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

/* ---------------------------------------------------------------------------
 * Group membership (member_groups is the source of truth; members.family_group
 * is a denormalised cache kept in sync so older read paths - CSV export, ID
 * cards, reports - keep working without change).
 * ------------------------------------------------------------------------- */

function groupCategories(): array {
    return [
        'department' => 'Serving Team (Department)',
        'leadership' => 'Leadership & Governance',
        'ministry'   => 'Ministry & Fellowship',
    ];
}

/** Rebuild members.family_group for one member (or all when $memberId is null). */
function rebuildGroupCache(PDO $db, ?int $memberId = null): void {
    $sql = "UPDATE members m
            LEFT JOIN (
                SELECT mg.member_id, GROUP_CONCAT(g.name ORDER BY g.name SEPARATOR ', ') AS names
                FROM member_groups mg JOIN `groups` g ON g.id = mg.group_id
                GROUP BY mg.member_id
            ) x ON x.member_id = m.id
            SET m.family_group = x.names";
    if ($memberId !== null) {
        $sql .= " WHERE m.id = ?";
        $db->prepare($sql)->execute([$memberId]);
    } else {
        $db->exec($sql);
    }
}

/**
 * Replace a member's groups with $groupIds and refresh the cache.
 * $titles, when given, is a map of group_id => role/title for THIS person in
 * THAT group (per-group function title). A blank/absent title clears the role
 * for that group. Titles for groups not in the map are left untouched.
 */
function syncMemberGroups(PDO $db, int $memberId, array $groupIds, ?array $titles = null): void {
    $ids = array_values(array_unique(array_filter(array_map('intval', $groupIds))));

    if ($ids) {
        $in = implode(',', array_fill(0, count($ids), '?'));
        $del = $db->prepare("DELETE FROM member_groups WHERE member_id = ? AND group_id NOT IN ($in)");
        $del->execute(array_merge([$memberId], $ids));

        $ins = $db->prepare("INSERT IGNORE INTO member_groups (member_id, group_id) VALUES (?, ?)");
        foreach ($ids as $gid) $ins->execute([$memberId, $gid]);
    } else {
        $db->prepare("DELETE FROM member_groups WHERE member_id = ?")->execute([$memberId]);
    }

    if ($titles !== null) {
        $upd = $db->prepare("UPDATE member_groups SET function_title = ? WHERE member_id = ? AND group_id = ?");
        foreach ($ids as $gid) {
            if (!array_key_exists($gid, $titles)) continue;
            $t = trim((string)$titles[$gid]);
            $upd->execute([$t === '' ? null : $t, $memberId, $gid]);
        }
    }

    rebuildGroupCache($db, $memberId);
    refreshMemberPrimaryTitle($db, $memberId);
}

/** Group ids a member belongs to. */
function memberGroupIds(PDO $db, int $memberId): array {
    $s = $db->prepare("SELECT group_id FROM member_groups WHERE member_id = ?");
    $s->execute([$memberId]);
    return array_map('intval', $s->fetchAll(PDO::FETCH_COLUMN));
}

/**
 * Keep members.function_title as a derived "headline" title = the person's
 * first non-empty per-group role (by group order). This is only a cache so the
 * member list / profile keep showing a title; the Groups page uses the real
 * per-group titles. Called whenever a person's group titles change.
 */
/** Last 10 digits of a phone, for loose matching regardless of formatting. */
function phoneLast10(?string $phone): string {
    return substr(preg_replace('/\D/', '', (string)$phone), -10);
}

/** Find the member whose phone matches (by last 10 digits). Null if none. */
function findMemberByPhone(PDO $db, ?string $phone): ?int {
    $d10 = phoneLast10($phone);
    if (strlen($d10) < 10) return null;
    foreach ($db->query("SELECT id, phone FROM members WHERE phone IS NOT NULL AND phone <> ''")->fetchAll() as $row) {
        if (phoneLast10($row['phone']) === $d10) return (int)$row['id'];
    }
    return null;
}

/** Record one SMS (incoming or outgoing) in the conversation log. Never throws. */
function logSmsConversation(PDO $db, ?int $memberId, string $phone, string $direction, string $body, ?string $sid = null, ?int $createdBy = null, bool $read = false): void {
    try {
        $db->prepare("INSERT INTO sms_conversations (member_id, phone, direction, body, twilio_sid, created_by, read_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?)")
           ->execute([$memberId, $phone, $direction, $body, $sid, $createdBy, $read ? date('Y-m-d H:i:s') : null]);
    } catch (Exception $e) { /* a logging failure must never break sending */ }
}

function refreshMemberPrimaryTitle(PDO $db, int $memberId): void {
    $s = $db->prepare("
        SELECT mg.function_title
        FROM member_groups mg
        JOIN `groups` g ON g.id = mg.group_id
        WHERE mg.member_id = ? AND mg.function_title IS NOT NULL AND mg.function_title <> ''
        ORDER BY g.sort_order ASC, g.name ASC
        LIMIT 1
    ");
    $s->execute([$memberId]);
    $t = $s->fetchColumn();
    $db->prepare("UPDATE members SET function_title = ? WHERE id = ?")
       ->execute([$t !== false ? $t : null, $memberId]);
}
