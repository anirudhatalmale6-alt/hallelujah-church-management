<?php
/**
 * Batch 24 - let a message be parked as a draft
 *
 * messages.status is an ENUM. MySQL is not in strict mode on this host, so an
 * unknown value is stored as an empty string instead of being refused - the same
 * trap that silently blanked checkin_method in batch 23. Add 'draft' properly
 * before anything tries to save one.
 */
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
requireRole($currentUser, ['admin', 'pastor']);

$db = getDB();
$out = [];

try {
    $col = $db->query("SELECT COLUMN_TYPE FROM information_schema.columns
                       WHERE table_schema = DATABASE() AND table_name = 'messages'
                       AND column_name = 'status'")->fetchColumn();
    $out[] = 'was: ' . ($col ?: '(column not found)');

    if ($col && stripos($col, 'enum') === 0 && stripos($col, "'draft'") === false) {
        // Keep every value already allowed, just add 'draft' to the front.
        preg_match_all("/'((?:[^']|'')*)'/", $col, $m);
        $values = $m[1] ?? [];
        if (!in_array('draft', $values, true)) array_unshift($values, 'draft');
        $list = implode(',', array_map(fn($v) => "'" . str_replace("'", "''", $v) . "'", $values));
        $db->exec("ALTER TABLE messages MODIFY COLUMN status ENUM($list) NOT NULL DEFAULT 'queued'");
        $out[] = "'draft' added to messages.status (now $list)";
    } elseif ($col && stripos($col, 'enum') !== 0) {
        $out[] = 'not an ENUM - nothing to change';
    } else {
        $out[] = "'draft' already allowed - skipped";
    }
} catch (Exception $e) {
    $out[] = 'FAILED: ' . $e->getMessage();
}

jsonResponse(['message' => 'Batch 24 complete', 'steps' => $out]);
