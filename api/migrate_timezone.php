<?php
/**
 * ONE-TIME: repair timestamps after pinning the MySQL session timezone to
 * Philadelphia (see dbTimezoneOffset() in config.php).
 *
 * Background: the MySQL server runs on UTC, PHP on America/New_York. So the same
 * instant was being stored two different ways:
 *   - MySQL NOW() / DEFAULT CURRENT_TIMESTAMP  -> a true UTC instant  (correct)
 *   - PHP date('Y-m-d H:i:s') passed as a value -> Philadelphia digits stored
 *     as if they were UTC (i.e. the instant is 4-5h off, but the digits read back
 *     the right wall clock while the session was also UTC)
 *
 * The system now stores UTC everywhere and converts to church time on output, so
 * the PHP-written rows are the odd ones out: their digits are a Philadelphia wall
 * clock sitting in a column that is supposed to hold UTC. Left alone they would
 * display 4-5 hours early.
 *
 * Method: for each of those rows, reinterpret the digits as Philadelphia time and
 * store the real UTC instant (churchToUtc). PHP's timezone database supplies the
 * right offset for each row's own date, so EST and EDT rows are both correct.
 *
 * Targets (PHP-literal writers only):
 *   attendance.check_in_time     - mixed writers; a row is PHP-written when
 *                                  created_at - check_in_time == the UTC offset
 *   checkin_logs.check_in_time   - same discriminator against created_at
 *   checkin_logs.check_out_time  - same
 *   sms_conversations.read_at    - same
 *   service_checklists.checked_at- single writer (checklist.php), all rows
 *
 * Usage: ?key=...&mode=dry  (report only)   ?key=...&mode=apply
 */

require_once __DIR__ . '/config.php';

if (($_GET['key'] ?? '') !== 'hitc-tzfix-2026') { http_response_code(404); exit('Not found'); }
$mode = ($_GET['mode'] ?? 'dry') === 'apply' ? 'apply' : 'dry';

$db = getDB();
$TZ = new DateTimeZone(date_default_timezone_get());
$MARKER = 'tz_repair_2026_08_10';

// Guard: never let this run twice, it would shift the same rows again.
$done = null;
try {
    $s = $db->prepare("SELECT value FROM settings WHERE `key` = ?");
    $s->execute([$MARKER]);
    $done = $s->fetchColumn();
} catch (Exception $e) { /* settings table missing -> treat as not run */ }
if ($done && $mode === 'apply') {
    echo json_encode(['error' => 'Already applied on ' . $done . ' - refusing to run again'], JSON_PRETTY_PRINT);
    exit;
}

/** Offset in seconds between Philadelphia and UTC for a given local wall clock. */
function offsetSecondsFor(string $wallClock, DateTimeZone $tz): int {
    return abs((new DateTime($wallClock, $tz))->getOffset());
}

$report = [];

/**
 * Rows whose $col is a PHP-written Philadelphia literal, detected by the gap to a
 * sibling UTC column written at the same moment.
 */
function philadelphiaLiteralRows(PDO $db, DateTimeZone $tz, string $table, string $col, string $sibling): array {
    $rows = $db->query("SELECT id, `$col` AS v, `$sibling` AS sib FROM `$table`
                        WHERE `$col` IS NOT NULL AND `$sibling` IS NOT NULL")->fetchAll();
    $hits = [];
    foreach ($rows as $r) {
        $gap = strtotime($r['sib']) - strtotime($r['v']);
        $expected = offsetSecondsFor($r['v'], $tz);
        // Written in the same request, so the gap is the offset give or take seconds.
        if (abs($gap - $expected) <= 180) $hits[] = ['id' => $r['id'], 'v' => $r['v']];
    }
    return $hits;
}

$plan = [
    ['attendance',          'check_in_time',  'created_at'],
    ['checkin_logs',        'check_in_time',  'created_at'],
    ['checkin_logs',        'check_out_time', 'created_at'],
    ['sms_conversations',   'read_at',        'created_at'],
];

$work = [];
foreach ($plan as [$table, $col, $sibling]) {
    try {
        $hits = philadelphiaLiteralRows($db, $TZ, $table, $col, $sibling);
        $total = (int)$db->query("SELECT COUNT(`$col`) FROM `$table`")->fetchColumn();
        $work[] = ['table' => $table, 'col' => $col, 'rows' => $hits];
        $report["$table.$col"] = ['php_written' => count($hits), 'total_non_null' => $total,
                                  'left_alone' => $total - count($hits),
                                  'sample' => array_map(fn($h) => $h['v'] . ' (Philadelphia) -> ' . churchToUtc($h['v']) . ' UTC', array_slice($hits, 0, 3))];
    } catch (Exception $e) { $report["$table.$col"] = ['error' => $e->getMessage()]; }
}

// service_checklists.checked_at has a single writer (checklist.php, PHP date()),
// so every row is a Philadelphia literal - no sibling needed.
try {
    $hits = $db->query("SELECT id, checked_at AS v FROM service_checklists WHERE checked_at IS NOT NULL")->fetchAll();
    $hits = array_map(fn($r) => ['id' => $r['id'], 'v' => $r['v']], $hits);
    $work[] = ['table' => 'service_checklists', 'col' => 'checked_at', 'rows' => $hits];
    $report['service_checklists.checked_at'] = ['php_written' => count($hits), 'total_non_null' => count($hits),
                                                'left_alone' => 0,
                                                'sample' => array_map(fn($h) => $h['v'] . ' (Philadelphia) -> ' . churchToUtc($h['v']) . ' UTC', array_slice($hits, 0, 3))];
} catch (Exception $e) { $report['service_checklists.checked_at'] = ['error' => $e->getMessage()]; }

$report['_mode'] = $mode;
$report['_already_applied'] = $done ?: false;

if ($mode === 'dry') {
    echo json_encode($report, JSON_PRETTY_PRINT);
    exit;
}

// Reinterpret each Philadelphia literal as the real UTC instant.
$updated = [];
$db->beginTransaction();
try {
    foreach ($work as $w) {
        if (empty($w['rows'])) { $updated["{$w['table']}.{$w['col']}"] = 0; continue; }
        $stmt = $db->prepare("UPDATE `{$w['table']}` SET `{$w['col']}` = ? WHERE id = ?");
        $n = 0;
        foreach ($w['rows'] as $r) { $stmt->execute([churchToUtc($r['v']), $r['id']]); $n++; }
        $updated["{$w['table']}.{$w['col']}"] = $n;
    }
    $db->prepare("INSERT INTO settings (`key`, value) VALUES (?, ?)
                  ON DUPLICATE KEY UPDATE value = VALUES(value)")
       ->execute([$MARKER, date('Y-m-d H:i:s')]);
    $db->commit();
} catch (Exception $e) {
    $db->rollBack();
    echo json_encode(['error' => 'Rolled back: ' . $e->getMessage(), 'report' => $report], JSON_PRETTY_PRINT);
    exit;
}

echo json_encode(['applied' => $updated, 'report' => $report], JSON_PRETTY_PRINT);
