<?php
/**
 * Hallelujah In The City - scheduled message sender
 *
 * The missing half of Schedule. Compose stores a message as 'queued' together
 * with the time it should go out and the recipients already worked out; this is
 * what comes back later and actually sends it. Until this existed, a scheduled
 * message sat at "queued" for ever and nobody was told - which is exactly what
 * happened to every message scheduled before 26 Aug 2026.
 *
 * Run it every five minutes:
 *   curl -s "https://hallelujahinthecity.org/system/api/cron_scheduled_messages.php?key=hitc-scheduler-2026"
 */
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/messaging_core.php';

/**
 * Two ways in, because the host offers two kinds of cron job.
 *
 * Over HTTP the key is the only thing standing between this and the open
 * internet, so it is required. Run from the command line by the server's own
 * cron there is no query string at all - PHP's CLI mode never fills $_GET - so
 * requiring one would mean the PHP option silently 403s for ever. Reaching this
 * file from a shell already means having the account, which is more authority
 * than the key represents, so the key is optional there.
 */
if (PHP_SAPI === 'cli') {
    $secret = 'hitc-scheduler-2026';
    foreach (array_slice($argv ?? [], 1) as $arg) {
        if (strpos($arg, 'key=') === 0) { $secret = substr($arg, 4); }
    }
} else {
    $secret = $_GET['key'] ?? '';
}
if ($secret !== 'hitc-scheduler-2026') {
    http_response_code(403);
    echo json_encode(['error' => 'Unauthorized']);
    exit();
}

/**
 * How late is too late to send something without being asked.
 *
 * If the cron stops for two days - the host reboots, the account is suspended,
 * somebody deletes the job - then the moment it comes back it would fire off
 * every message it missed. A "see you at service this morning" text arriving
 * two mornings later is worse than one that never arrives, because the church
 * cannot take it back. So anything older than this is left alone and shown on
 * the Communication page as overdue, with a Send Now button next to it. A person
 * decides, not the clock.
 */
const HOLD_AFTER_HOURS = 6;

/**
 * A message left mid-send by a crash or a timeout. Safe to pick up again:
 * dispatchMessage only touches recipients still marked pending, so anybody
 * already texted is skipped.
 */
const STUCK_AFTER_MINUTES = 30;

$db = getDB();
$nowUtc = utcNow();
$now = strtotime($nowUtc);
$report = ['checked_at' => $nowUtc, 'sent' => [], 'held' => [], 'recovered' => 0];

// Put anything abandoned mid-send back in the queue first, so it gets picked up
// by the run below instead of sitting at 'sending' for ever.
try {
    $stuck = $db->prepare("
        UPDATE messages SET status = 'queued'
        WHERE status = 'sending'
          AND COALESCE(sent_at, created_at) < DATE_SUB(?, INTERVAL ? MINUTE)
    ");
    $stuck->execute([$nowUtc, STUCK_AFTER_MINUTES]);
    $report['recovered'] = $stuck->rowCount();
} catch (Exception $e) {
    $report['recover_error'] = $e->getMessage();
}

$due = $db->prepare("
    SELECT id, subject, scheduled_at, total_recipients
    FROM messages
    WHERE status = 'queued'
      AND scheduled_at IS NOT NULL
      AND scheduled_at <= ?
    ORDER BY scheduled_at ASC
    LIMIT 25
");
$due->execute([$nowUtc]);

foreach ($due->fetchAll() as $m) {
    $messageId = (int)$m['id'];
    $lateHours = ($now - strtotime($m['scheduled_at'])) / 3600;

    if ($lateHours > HOLD_AFTER_HOURS) {
        $report['held'][] = [
            'id' => $messageId,
            'subject' => $m['subject'],
            'hours_late' => round($lateHours, 1),
            'why' => 'Too old to send unasked - use Send Now on the Communication page.',
        ];
        continue;
    }

    // Claim it, so a slow run and the next run five minutes later can never both
    // be sending the same message.
    $claim = $db->prepare("UPDATE messages SET status = 'sending' WHERE id = ? AND status = 'queued'");
    $claim->execute([$messageId]);
    if ($claim->rowCount() === 0) continue;

    try {
        $result = dispatchMessage($db, $messageId);
        $report['sent'][] = [
            'id' => $messageId,
            'subject' => $m['subject'],
            'sent' => $result['sent'],
            'failed' => $result['failed'],
        ];
    } catch (Exception $e) {
        // Back in the queue rather than lost. Recipients already delivered to are
        // marked sent and will not be repeated on the next attempt.
        $db->prepare("UPDATE messages SET status = 'queued' WHERE id = ?")->execute([$messageId]);
        $report['sent'][] = ['id' => $messageId, 'error' => $e->getMessage()];
    }
}

header('Content-Type: application/json');
echo json_encode($report, JSON_PRETTY_PRINT);
