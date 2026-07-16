<?php
/**
 * Splits the printed card's barcode away from its QR code.
 *
 * Until now a member had ONE code (`qr_code`) that was rendered both as the QR
 * on the card front and as the barcode on the back, plus a separate `pin_code`.
 * Regenerating a member's code changed that single value, which invalidated the
 * QR, the barcode AND (together with the PIN reset) the whole printed card at
 * once - so a card already handed out became useless.
 *
 * This adds a distinct `barcode_code` so the three tokens (QR, barcode, PIN) can
 * be regenerated independently. Existing cards keep working because we backfill
 * barcode_code = qr_code, so today they still carry the same value.
 *
 * Run once:  /system/api/migrate_barcode_code.php?key=hitc-barcode-2026
 */

require_once __DIR__ . '/config.php';

if (($_GET['key'] ?? '') !== 'hitc-barcode-2026') {
    http_response_code(403);
    exit('Forbidden');
}

header('Content-Type: text/plain');
$db = getDB();
$out = [];

function colExists(PDO $db, string $table, string $col): bool {
    $stmt = $db->prepare("
        SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
    ");
    $stmt->execute([$table, $col]);
    return (int)$stmt->fetchColumn() > 0;
}

function indexExists(PDO $db, string $table, string $index): bool {
    $stmt = $db->prepare("
        SELECT COUNT(*) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
    ");
    $stmt->execute([$table, $index]);
    return (int)$stmt->fetchColumn() > 0;
}

if (colExists($db, 'member_checkin_codes', 'barcode_code')) {
    $out[] = "member_checkin_codes.barcode_code already exists, skipped";
} else {
    $db->exec("ALTER TABLE member_checkin_codes ADD COLUMN `barcode_code` VARCHAR(64) NULL DEFAULT NULL AFTER `qr_code`");
    $out[] = "member_checkin_codes.barcode_code ADDED";
}

// Backfill: existing cards were printed with the barcode carrying the qr_code
// value, so keep them identical. New independence only kicks in on regeneration.
$affected = $db->exec("UPDATE member_checkin_codes SET barcode_code = qr_code WHERE barcode_code IS NULL OR barcode_code = ''");
$out[] = "Backfilled barcode_code = qr_code for $affected rows";

// Index so barcode scans match as fast as QR scans.
if (indexExists($db, 'member_checkin_codes', 'idx_barcode')) {
    $out[] = "idx_barcode already exists, skipped";
} else {
    $db->exec("ALTER TABLE member_checkin_codes ADD INDEX `idx_barcode` (`barcode_code`)");
    $out[] = "idx_barcode ADDED";
}

$total = (int)$db->query("SELECT COUNT(*) FROM member_checkin_codes")->fetchColumn();
$split = (int)$db->query("SELECT COUNT(*) FROM member_checkin_codes WHERE barcode_code <> qr_code")->fetchColumn();
$out[] = "";
$out[] = "Codes: $total total | $split currently have a barcode different from their QR (expected 0 right after migration)";
$out[] = "DONE";

echo implode("\n", $out) . "\n";
