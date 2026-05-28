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

switch ($method) {
    case 'GET':
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
