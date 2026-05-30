<?php
/**
 * Hallelujah In The City - Church Management System
 * Database Backup API
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
requireRole($currentUser, ['pastor', 'admin']);

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

$backupDir = __DIR__ . '/../backups';
if (!is_dir($backupDir)) {
    mkdir($backupDir, 0755, true);
    file_put_contents($backupDir . '/.htaccess', "Deny from all\n");
}

switch ($method) {
    case 'GET':
        if ($action === 'download') {
            $file = $_GET['file'] ?? '';
            $filePath = $backupDir . '/' . basename($file);
            if (!file_exists($filePath) || !preg_match('/^backup_\d{8}_\d{6}\.sql$/', basename($file))) {
                jsonResponse(['error' => 'Backup file not found'], 404);
            }
            header('Content-Type: application/octet-stream');
            header('Content-Disposition: attachment; filename="' . basename($file) . '"');
            header('Content-Length: ' . filesize($filePath));
            readfile($filePath);
            exit;
        }

        // List backups
        $files = glob($backupDir . '/backup_*.sql');
        $backups = [];
        foreach ($files as $f) {
            $backups[] = [
                'file' => basename($f),
                'size' => filesize($f),
                'size_formatted' => round(filesize($f) / 1024, 1) . ' KB',
                'date' => date('Y-m-d H:i:s', filemtime($f)),
            ];
        }
        usort($backups, fn($a, $b) => strcmp($b['filename'], $a['filename']));
        jsonResponse(['backups' => $backups]);
        break;

    case 'POST':
        $db = getDB();
        $timestamp = date('Ymd_His');
        $filename = "backup_{$timestamp}.sql";
        $filepath = $backupDir . '/' . $filename;

        $tables = $db->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
        $output = "-- Hallelujah In The City Database Backup\n";
        $output .= "-- Generated: " . date('Y-m-d H:i:s') . "\n";
        $output .= "-- Database: " . DB_NAME . "\n\n";
        $output .= "SET FOREIGN_KEY_CHECKS=0;\n\n";

        foreach ($tables as $table) {
            $createStmt = $db->query("SHOW CREATE TABLE `$table`")->fetch();
            $output .= "DROP TABLE IF EXISTS `$table`;\n";
            $output .= $createStmt['Create Table'] . ";\n\n";

            $rows = $db->query("SELECT * FROM `$table`")->fetchAll(PDO::FETCH_ASSOC);
            if (count($rows) > 0) {
                $cols = array_keys($rows[0]);
                $colList = implode('`, `', $cols);
                foreach ($rows as $row) {
                    $vals = array_map(function($v) use ($db) {
                        if ($v === null) return 'NULL';
                        return $db->quote($v);
                    }, array_values($row));
                    $output .= "INSERT INTO `$table` (`$colList`) VALUES (" . implode(', ', $vals) . ");\n";
                }
                $output .= "\n";
            }
        }

        $output .= "SET FOREIGN_KEY_CHECKS=1;\n";
        file_put_contents($filepath, $output);

        // Keep only the last 10 backups
        $files = glob($backupDir . '/backup_*.sql');
        usort($files, fn($a, $b) => strcmp(basename($b), basename($a)));
        foreach (array_slice($files, 10) as $old) {
            unlink($old);
        }

        jsonResponse([
            'message' => 'Backup created successfully',
            'backup' => [
                'filename' => $filename,
                'size_formatted' => round(filesize($filepath) / 1024, 1) . ' KB',
                'created_at' => date('Y-m-d H:i:s'),
            ],
        ]);
        break;

    case 'DELETE':
        $file = $_GET['file'] ?? '';
        $filePath = $backupDir . '/' . basename($file);
        if (!file_exists($filePath) || !preg_match('/^backup_\d{8}_\d{6}\.sql$/', basename($file))) {
            jsonResponse(['error' => 'Backup file not found'], 404);
        }
        unlink($filePath);
        jsonResponse(['message' => 'Backup deleted']);
        break;

    default:
        jsonResponse(['error' => 'Method not allowed'], 405);
}
