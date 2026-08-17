<?php
/**
 * Batch 23 - let a check-in be recorded as 'offline'
 *
 * checkin_logs.checkin_method was ENUM('qr','pin','manual'), but the offline
 * check-in sync sends 'offline'. MySQL is not in strict mode here, so instead of
 * refusing the value it silently stored an empty string - every check-in taken
 * offline and synced later showed a blank Method column in Today's Log.
 *
 * Adds 'offline' to the ENUM and repairs the rows that were blanked.
 */
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
requireRole($currentUser, ['admin', 'pastor']);

$db = getDB();
$out = [];

try {
    $col = $db->query("SELECT COLUMN_TYPE FROM information_schema.columns
                       WHERE table_schema = DATABASE() AND table_name = 'checkin_logs'
                       AND column_name = 'checkin_method'")->fetchColumn();
    $out[] = 'was: ' . ($col ?: '(column not found)');

    if ($col && stripos($col, "'offline'") === false) {
        $db->exec("ALTER TABLE checkin_logs
                   MODIFY COLUMN checkin_method ENUM('qr','pin','manual','offline') NOT NULL DEFAULT 'manual'");
        $out[] = "'offline' added to checkin_method";
    } else {
        $out[] = "'offline' already allowed - skipped";
    }

    // Rows blanked by the old ENUM. Only ever '' - a real method is never empty.
    $fix = $db->prepare("UPDATE checkin_logs SET checkin_method = 'offline' WHERE checkin_method = ''");
    $fix->execute();
    $out[] = $fix->rowCount() . ' blank row(s) relabelled as offline';
} catch (Exception $e) {
    $out[] = 'FAILED: ' . $e->getMessage();
}

jsonResponse(['message' => 'Batch 23 complete', 'steps' => $out]);
