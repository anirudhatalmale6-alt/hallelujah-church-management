<?php
/**
 * Hallelujah In The City - Church Management System
 * Settings API - System configuration
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

$action = $_GET['action'] ?? '';

switch ($method) {
    case 'GET':
        if ($action === 'person_types') {
            jsonResponse(['person_types' => getPersonTypes($db)]);
        }
        $stmt = $db->query("SELECT `key`, value FROM settings ORDER BY `key`");
        $rows = $stmt->fetchAll();
        $settings = [];
        foreach ($rows as $row) {
            $settings[$row['key']] = $row['value'];
        }
        jsonResponse(['settings' => $settings]);
        break;

    case 'PUT':
        requireRole($currentUser, ['pastor', 'admin']);
        $data = getRequestBody();

        if ($action === 'person_types') {
            if (!isset($data['person_types']) || !is_array($data['person_types'])) {
                jsonResponse(['error' => 'person_types array required'], 400);
            }
            // Normalize + de-duplicate
            $clean = [];
            $seen = [];
            foreach ($data['person_types'] as $t) {
                $label = trim($t['label'] ?? '');
                if ($label === '') continue;
                $value = trim($t['value'] ?? '');
                if ($value === '') $value = strtolower(str_replace(' ', '_', $label));
                $value = preg_replace('/[^a-z0-9_]/', '', strtolower(str_replace(' ', '_', $value)));
                if ($value === '' || isset($seen[$value])) continue;
                $seen[$value] = true;
                $clean[] = [
                    'value'       => $value,
                    'label'       => $label,
                    'auto_absent' => !empty($t['auto_absent']),
                    'builtin'     => !empty($t['builtin']),
                ];
            }
            // Guarantee the two required built-ins remain
            foreach (defaultPersonTypes() as $d) {
                if (($d['value'] === 'church_member' || $d['value'] === 'non_member_attendee') && !isset($seen[$d['value']])) {
                    $clean[] = $d;
                    $seen[$d['value']] = true;
                }
            }
            $db->prepare("INSERT INTO settings (`key`, value) VALUES ('person_types', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)")
               ->execute([json_encode($clean)]);
            jsonResponse(['message' => 'Person types saved', 'person_types' => $clean]);
        }

        if (!isset($data['settings']) || !is_array($data['settings'])) {
            jsonResponse(['error' => 'Settings object required'], 400);
        }

        $stmt = $db->prepare("
            INSERT INTO settings (`key`, value) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE value = VALUES(value)
        ");

        $count = 0;
        foreach ($data['settings'] as $key => $value) {
            // Don't allow modifying 'installed' flag
            if ($key === 'installed') continue;
            $stmt->execute([$key, $value]);
            $count++;
        }

        jsonResponse(['message' => "$count settings updated"]);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
