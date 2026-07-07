<?php
/**
 * Hallelujah In The City - Follow-up reminders cron
 *
 * Sends an email and/or SMS reminder to the assigned user a configurable number
 * of days before a follow-up's due date, so they don't forget to act on it.
 *
 * Schedule daily, e.g.:
 *   curl -s "https://system.hallelujahinthecity.org/system/api/cron_followup_reminders.php?key=hitc-followup-reminders-2026"
 */
require_once __DIR__ . '/config.php';

$secret = $_GET['key'] ?? '';
if ($secret !== 'hitc-followup-reminders-2026') {
    http_response_code(403);
    echo json_encode(['error' => 'Unauthorized']);
    exit();
}

$db = getDB();

// ---- messaging helpers (self-contained copies of messaging.php) ----
function fr_getSettings($db) {
    $settings = [];
    try {
        $rows = $db->query("SELECT `key` as k, `value` as v FROM settings WHERE `key` LIKE 'msg_%' OR `key` = 'church_name'")->fetchAll();
        foreach ($rows as $r) $settings[$r['k']] = $r['v'];
    } catch (Exception $e) {}
    return $settings;
}
function fr_formatPhone($phone) {
    $digits = preg_replace('/[^0-9]/', '', $phone);
    if (strlen($digits) === 10) return '+1' . $digits;
    if (strlen($digits) === 11 && $digits[0] === '1') return '+' . $digits;
    if (strpos($phone, '+') === 0) return $phone;
    return '+1' . $digits;
}
function fr_sendEmail($to, $toName, $from, $fromName, $subject, $htmlBody, $apiKey) {
    $data = [
        'personalizations' => [['to' => [['email' => $to, 'name' => $toName]]]],
        'from' => ['email' => $from, 'name' => $fromName],
        'subject' => $subject,
        'content' => [['type' => 'text/html', 'value' => $htmlBody]],
    ];
    $ch = curl_init('https://api.sendgrid.com/v3/mail/send');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($data),
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $apiKey, 'Content-Type: application/json'],
    ]);
    curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $httpCode >= 200 && $httpCode < 300;
}
function fr_sendSMS($to, $body, $sid, $token, $fromNumber) {
    $to = fr_formatPhone($to);
    $ch = curl_init("https://api.twilio.com/2010-04-01/Accounts/$sid/Messages.json");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query(['To' => $to, 'From' => $fromNumber, 'Body' => $body]),
        CURLOPT_USERPWD => "$sid:$token",
    ]);
    curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $httpCode >= 200 && $httpCode < 300;
}

$settings = fr_getSettings($db);
$churchName = $settings['church_name'] ?? 'Hallelujah In The City';
$sgKey = $settings['msg_sendgrid_key'] ?? '';
$fromEmail = $settings['msg_from_email'] ?? '';
$fromName = $settings['msg_from_name'] ?? $churchName;
$twSid = $settings['msg_twilio_sid'] ?? '';
$twToken = $settings['msg_twilio_token'] ?? '';
$twNumber = $settings['msg_twilio_number'] ?? '';

$emailReady = !empty($sgKey) && !empty($fromEmail);
$smsReady = !empty($twSid) && !empty($twToken) && !empty($twNumber);

// Find due reminders: active follow-ups whose reminder window has opened and
// that haven't been reminded yet.
$stmt = $db->query("
    SELECT f.id, f.subject, f.due_date, f.reminder_days_before, f.remind_email, f.remind_sms,
           f.notes, f.priority,
           u.name as user_name, u.email as user_email, u.phone as user_phone,
           m.first_name, m.last_name
    FROM followups f
    JOIN users u ON u.id = f.assigned_to
    LEFT JOIN members m ON m.id = f.member_id
    WHERE f.status IN ('pending','contacted')
      AND f.due_date IS NOT NULL
      AND f.reminder_sent_at IS NULL
      AND (f.remind_email = 1 OR f.remind_sms = 1)
      AND DATE_SUB(f.due_date, INTERVAL f.reminder_days_before DAY) <= CURDATE()
      AND f.due_date >= CURDATE()
");
$due = $stmt->fetchAll();

$sent = 0;
$log = [];
$markStmt = $db->prepare("UPDATE followups SET reminder_sent_at = NOW() WHERE id = ?");

foreach ($due as $f) {
    $memberName = trim(($f['first_name'] ?? '') . ' ' . ($f['last_name'] ?? ''));
    $who = $memberName !== '' ? " for $memberName" : '';
    $daysLeft = (int)round((strtotime($f['due_date']) - strtotime(date('Y-m-d'))) / 86400);
    $dueHuman = date('D, M j, Y', strtotime($f['due_date']));
    $inDays = $daysLeft <= 0 ? 'today' : ($daysLeft === 1 ? 'tomorrow' : "in $daysLeft days");

    $anySent = false;

    if ($f['remind_email'] && $emailReady && !empty($f['user_email'])) {
        $subject = "Reminder: Follow-up due $inDays — " . $f['subject'];
        $html = "<div style='font-family:Arial,sans-serif;font-size:15px;color:#222'>"
            . "<p>Hi " . htmlspecialchars($f['user_name']) . ",</p>"
            . "<p>This is a reminder that the follow-up <strong>" . htmlspecialchars($f['subject']) . "</strong>$who is due on <strong>$dueHuman</strong> ($inDays).</p>"
            . ($f['notes'] ? "<p style='color:#555'>Notes: " . htmlspecialchars($f['notes']) . "</p>" : '')
            . "<p>Please log in to the church system to complete it.</p>"
            . "<p style='color:#888;font-size:13px'>— $churchName</p></div>";
        if (fr_sendEmail($f['user_email'], $f['user_name'], $fromEmail, $fromName, $subject, $html, $sgKey)) {
            $anySent = true;
            $log[] = "email -> {$f['user_email']} (followup #{$f['id']})";
        }
    }

    if ($f['remind_sms'] && $smsReady && !empty($f['user_phone'])) {
        $body = "$churchName reminder: Follow-up \"" . $f['subject'] . "\"$who is due $dueHuman ($inDays). Please complete it in the church system.";
        if (fr_sendSMS($f['user_phone'], $body, $twSid, $twToken, $twNumber)) {
            $anySent = true;
            $log[] = "sms -> {$f['user_phone']} (followup #{$f['id']})";
        }
    }

    if ($anySent) {
        $markStmt->execute([$f['id']]);
        $sent++;
    }
}

$result = [
    'message' => "$sent reminder(s) sent",
    'candidates' => count($due),
    'email_ready' => $emailReady,
    'sms_ready' => $smsReady,
    'log' => $log,
    'run_at' => date('Y-m-d H:i:s'),
];
error_log('Follow-up reminders cron: ' . json_encode($result));
jsonResponse($result);
