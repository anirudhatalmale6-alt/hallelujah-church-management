<?php
/**
 * Batch 25 - make Schedule actually work
 *
 * Two things the scheduler needs that the table did not have:
 *
 * 1. messages.merge_data. A message scheduled for tomorrow morning has to carry
 *    its own per-person figures with it - the gift amount on a thank-you, the
 *    balance on a pledge reminder. Those used to live only in the request that
 *    sent the message, so a scheduled one would have gone out with the literal
 *    text {amount} in it.
 *
 * 2. Times already in the queue. scheduled_at was being written as Philadelphia
 *    wall clock while every other stamp in this system is UTC, so a message set
 *    for 6:28am was stored as 6:28am UTC - 2:28am here. Anything already queued
 *    is shifted to the UTC instant the person actually meant.
 */
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

$currentUser = authenticate();
requireRole($currentUser, ['admin', 'pastor']);

$db = getDB();
$apply = ($_GET['mode'] ?? 'dry') === 'apply';
$out = ['mode' => $apply ? 'apply' : 'dry', 'steps' => []];

// ---- 1. merge_data ----------------------------------------------------------
try {
    $has = $db->query("SELECT COUNT(*) FROM information_schema.columns
                       WHERE table_schema = DATABASE() AND table_name = 'messages'
                       AND column_name = 'merge_data'")->fetchColumn();
    if ($has) {
        $out['steps'][] = 'merge_data already present';
    } elseif ($apply) {
        $db->exec("ALTER TABLE messages ADD COLUMN merge_data TEXT NULL AFTER recipient_filter");
        $out['steps'][] = 'merge_data added';
    } else {
        $out['steps'][] = 'would add merge_data';
    }
} catch (Exception $e) {
    $out['steps'][] = 'merge_data FAILED: ' . $e->getMessage();
}

// ---- 2. repair the queued times --------------------------------------------
// Only rows still queued: a sent message's scheduled_at is history and moving it
// would rewrite the record of when something actually went out. A marker in
// settings stops this running twice and shifting the same rows again.
const TZ_MARKER = 'sched_tz_repair_2026_08_26';
try {
    $done = $db->prepare("SELECT COUNT(*) FROM settings WHERE `key` = ?");
    $done->execute([TZ_MARKER]);
    if ($done->fetchColumn()) {
        $out['steps'][] = 'scheduled_at already repaired - skipped';
    } else {
        $rows = $db->query("SELECT id, scheduled_at FROM messages
                            WHERE status = 'queued' AND scheduled_at IS NOT NULL")->fetchAll();
        $changes = [];
        foreach ($rows as $r) {
            $utc = churchToUtc($r['scheduled_at']);
            if (!$utc || $utc === $r['scheduled_at']) continue;
            $changes[] = ['id' => (int)$r['id'], 'was' => $r['scheduled_at'], 'now' => $utc];
            if ($apply) {
                $db->prepare("UPDATE messages SET scheduled_at = ? WHERE id = ?")
                   ->execute([$utc, (int)$r['id']]);
            }
        }
        $out['steps'][] = ($apply ? 'shifted ' : 'would shift ') . count($changes) . ' queued message time(s)';
        $out['changes'] = $changes;
        if ($apply) {
            $db->prepare("INSERT INTO settings (`key`, `value`) VALUES (?, ?)
                          ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)")
               ->execute([TZ_MARKER, utcNow()]);
        }
    }
} catch (Exception $e) {
    $out['steps'][] = 'scheduled_at repair FAILED: ' . $e->getMessage();
}

// ---- what is sitting in the queue right now ---------------------------------
try {
    $q = $db->query("SELECT id, subject, message_type, scheduled_at, total_recipients, created_at
                     FROM messages WHERE status IN ('queued','sending') ORDER BY scheduled_at")->fetchAll();
    $out['still_queued'] = $q;
} catch (Exception $e) {}

jsonResponse($out);
