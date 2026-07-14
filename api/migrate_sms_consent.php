<?php
/**
 * Adds SMS consent tracking to members and backfills it from the web opt-in
 * CSV that sms-optin.php has been writing since the page went live.
 *
 * Consent is what carriers and TCR require us to be able to PROVE, so we store
 * when it was given, how it was given, and (for web sign-ups) the IP it came
 * from. Without this the messaging module would text anyone with a phone
 * number on file, which is exactly what gets a campaign shut down.
 *
 * Run once:  /system/api/migrate_sms_consent.php?key=hitc-sms-consent-2026
 */

require_once __DIR__ . '/config.php';

if (($_GET['key'] ?? '') !== 'hitc-sms-consent-2026') {
    http_response_code(403);
    exit('Forbidden');
}

header('Content-Type: text/plain');
$db = getDB();
$out = [];

function columnExists(PDO $db, string $table, string $col): bool {
    $stmt = $db->prepare("
        SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
    ");
    $stmt->execute([$table, $col]);
    return (int)$stmt->fetchColumn() > 0;
}

$columns = [
    'sms_consent'        => "TINYINT(1) NOT NULL DEFAULT 0",
    'sms_consent_at'     => "DATETIME NULL DEFAULT NULL",
    'sms_consent_source' => "VARCHAR(40) NULL DEFAULT NULL",  // web_form | paper_form | verbal | import
    'sms_consent_proof'  => "VARCHAR(255) NULL DEFAULT NULL", // IP for web, or where the signed card is filed
    'sms_consent_by'     => "INT NULL DEFAULT NULL",          // staff user who recorded a paper/verbal consent
    'sms_opted_out_at'   => "DATETIME NULL DEFAULT NULL",     // set when they reply STOP
];

foreach ($columns as $col => $ddl) {
    if (columnExists($db, 'members', $col)) {
        $out[] = "members.$col already exists, skipped";
        continue;
    }
    $db->exec("ALTER TABLE members ADD COLUMN `$col` $ddl");
    $out[] = "members.$col ADDED";
}

// --- Backfill from the web opt-in CSV (lives above the web root) ---------
// Row shape written by sms-optin.php:
//   timestamp, name, +1XXXXXXXXXX, ip, user agent, source
$csvCandidates = [
    __DIR__ . '/../../../hitc_sms_consent.csv',  // /system/api -> domain root
    __DIR__ . '/../../hitc_sms_consent.csv',
    '/home/u802978444/domains/hallelujahinthecity.org/hitc_sms_consent.csv',
];

$csv = null;
foreach ($csvCandidates as $c) {
    if (is_readable($c)) { $csv = $c; break; }
}

if (!$csv) {
    $out[] = "No consent CSV found (nobody has used the web form yet) - nothing to backfill";
} else {
    $out[] = "Reading consent CSV: $csv";
    $matched = 0; $unmatched = 0;

    // Match on the last 10 digits so formatting differences never lose a person.
    $find = $db->prepare("
        SELECT id FROM members
        WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', ''), 10) = ?
          AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', ''), 10) <> ''
        LIMIT 1
    ");
    $mark = $db->prepare("
        UPDATE members
        SET sms_consent = 1,
            sms_consent_at = ?,
            sms_consent_source = 'web_form',
            sms_consent_proof = ?
        WHERE id = ? AND sms_consent = 0
    ");

    $fh = fopen($csv, 'r');
    while (($row = fgetcsv($fh)) !== false) {
        if (count($row) < 3) continue;
        $ts     = trim(str_replace(' UTC', '', $row[0]));
        $phone  = preg_replace('/\D+/', '', $row[2] ?? '');
        $ip     = trim($row[3] ?? '');
        $last10 = substr($phone, -10);
        if (strlen($last10) !== 10) continue;

        $find->execute([$last10]);
        $memberId = $find->fetchColumn();

        if ($memberId) {
            $mark->execute([$ts ?: date('Y-m-d H:i:s'), $ip, $memberId]);
            $matched++;
        } else {
            // Signed up on the website but isn't in People yet - that's fine,
            // sms-optin.php now creates them going forward. Just report it.
            $unmatched++;
        }
    }
    fclose($fh);
    $out[] = "Backfill: $matched existing people marked consented, $unmatched web sign-ups not found in People";
}

$total     = (int)$db->query("SELECT COUNT(*) FROM members")->fetchColumn();
$withPhone = (int)$db->query("SELECT COUNT(*) FROM members WHERE phone IS NOT NULL AND phone <> ''")->fetchColumn();
$consented = (int)$db->query("SELECT COUNT(*) FROM members WHERE sms_consent = 1")->fetchColumn();

$out[] = "";
$out[] = "People: $total | with a phone number: $withPhone | consented to SMS: $consented";
$out[] = "The other " . ($withPhone - $consented) . " people with a phone number CANNOT legally be texted until they opt in.";
$out[] = "DONE";

echo implode("\n", $out) . "\n";
